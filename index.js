// Gem Rush: bot de Telegram para Acurast (Node.js 20, un solo archivo, sin dependencias).
// Responde a /start y /jugar con el botón "🎮 Jugar" que abre tu juego como Mini App,
// registra referidos (?start=ref_ID) y muestra monedas.
//
// Prueba local:  BOT_TOKEN=... GAME_URL=https://tu-usuario.github.io/gem-rush/ node index.js

const fs = require('fs');
const path = require('path');

// En Acurast las variables secretas llegan por _STD_.env; en local, por process.env
const isAcurast = typeof _STD_ !== 'undefined';
const env = (k, d) => (isAcurast ? _STD_.env[k] : process.env[k]) || d;

const TOKEN = env('BOT_TOKEN');
const GAME_URL = env('GAME_URL');
const RUN_SECONDS = Number(env('RUN_SECONDS', '50')); // cuánto escucha cada ejecución
const REF_BONUS = 50;

const log = (...a) => console.log(...a); // nunca imprimas el token

if (!TOKEN || !GAME_URL) {
  log('Faltan BOT_TOKEN o GAME_URL');
  process.exit(1);
}

// ---------- Almacenamiento sencillo (archivo JSON) ----------
// OJO: en un procesador de Acurast este archivo puede no conservarse entre ejecuciones
// ni entre dispositivos. Para datos importantes (monedas, retiros) usa una base de datos externa.
const dir = (isAcurast && _STD_.job && _STD_.job.storageDir) || './data';
fs.mkdirSync(dir, { recursive: true });
const FILE = path.join(dir, 'game.json');

let db = { users: {}, referrals: {}, offset: 0 };
try {
  db = { ...db, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
} catch (e) {
  /* primera ejecución */
}
const save = () => fs.writeFileSync(FILE, JSON.stringify(db));
const user = (id) => (db.users[id] = db.users[id] || { coins: 0 });

// ---------- Telegram ----------
const api = async (method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return r.json();
};

const playKeyboard = { inline_keyboard: [[{ text: '🎮 Jugar', web_app: { url: GAME_URL } }]] };
let botUsername = '';

async function onMessage(m) {
  const id = m.from.id;
  const [rawCmd, arg] = (m.text || '').trim().split(/\s+/);
  const cmd = (rawCmd || '').split('@')[0];

  if (cmd === '/start' || cmd === '/jugar') {
    user(id);
    if (arg && arg.startsWith('ref_')) {
      const inviter = Number(arg.slice(4));
      // Solo cuenta una vez, no se permite el auto-referido y el invitador debe existir
      if (inviter && inviter !== id && !db.referrals[id] && db.users[inviter]) {
        db.referrals[id] = inviter;
        user(inviter).coins += REF_BONUS;
        await api('sendMessage', {
          chat_id: inviter,
          text: `🎉 ${m.from.first_name} se unió con tu enlace. ¡+${REF_BONUS} 🪙!`,
        });
      }
    }
    save();
    await api('sendMessage', {
      chat_id: m.chat.id,
      text: `¡Hola ${m.from.first_name}! 🍓 Combina frutas, gana monedas 🪙 y canjea premios.`,
      reply_markup: playKeyboard,
    });
  } else if (cmd === '/invitar') {
    user(id);
    save();
    await api('sendMessage', {
      chat_id: m.chat.id,
      text: `Tu enlace de invitación:\nhttps://t.me/${botUsername}?start=ref_${id}\n\nGanas ${REF_BONUS} 🪙 por cada amigo.`,
    });
  } else if (cmd === '/monedas') {
    await api('sendMessage', { chat_id: m.chat.id, text: `Tienes ${user(id).coins} 🪙` });
  }
}

async function main() {
  const me = await api('getMe');
  if (!me.ok) throw new Error('Token inválido o revocado');
  botUsername = me.result.username;

  const end = Date.now() + RUN_SECONDS * 1000;
  while (Date.now() < end) {
    const res = await api('getUpdates', { offset: db.offset, timeout: 20, allowed_updates: ['message'] });
    if (!res.ok) {
      log('Error de Telegram:', res.description);
      break;
    }
    for (const u of res.result) {
      db.offset = u.update_id + 1;
      if (u.message) await onMessage(u.message).catch((e) => log('Error:', e.message));
    }
    if (res.result.length) save();
  }
  save();
}

main().catch((e) => log('Fallo:', e.message));
