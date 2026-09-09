'use strict';

/**
 * A-Chat — WhatsApp-style realtime chat server.
 * Express serves the static client; a WebSocket endpoint routes messages
 * between users, tracks typing / delivered / read state, and runs a few
 * demo bots so the app is fun with a single user. History is persisted
 * to data/messages.json so conversations survive restarts.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'messages.json');
const MAX_HISTORY = 500; // per conversation

/* ---------------------------------- bots ---------------------------------- */

const BOTS = [
  {
    name: 'Aria',
    subtitle: 'A-Chat Support',
    rules: [
      { keys: ['hi', 'hello', 'hey', 'yo'], replies: [
        'Hey {u}! 👋 How can I help you today?',
        'Hi {u}! Great to see you on A-Chat 💬',
      ] },
      { keys: ['help', 'feature', 'how'], replies: [
        'Here is what A-Chat can do: realtime messaging, read receipts ✓✓, typing indicators, emoji 😄 and a dark mode toggle in the sidebar. Tip: open A-Chat in a second tab with a different name and chat with yourself live!',
      ] },
      { keys: ['music', 'song', 'play', 'playlist'], replies: [
        'For tunes, our resident DJ is the one to ask — say "play" to DJ Nova 🎧',
      ] },
      { keys: ['thank'], replies: ['Anytime, {u}! 💚', 'You are very welcome!'] },
      { keys: ['bye', 'later', 'cya'], replies: ['See you soon, {u}! 👋', 'Bye {u}! I am here whenever you need me.'] },
    ],
    fallback: [
      'Interesting — tell me more! 😄',
      'Got it. Anything else I can help with? Type "help" to see what I know.',
      'I am only a demo bot, but I am all ears 👂',
    ],
  },
  {
    name: 'Max',
    subtitle: 'Buddy',
    rules: [
      { keys: ['hi', 'hello', 'hey', 'yo', 'sup'], replies: ['yo {u}!! what\'s up 🙌', 'heyyy {u} 🔥'] },
      { keys: ['lol', 'haha', 'funny', 'lmao'], replies: ['😂😂😂', 'lmaooo stop'] },
      { keys: ['yes', 'yeah', 'yep'], replies: ['let\'s gooo', 'knew it 😎'] },
      { keys: ['no', 'nope', 'nah'], replies: ['aww ok 😅', 'fair enough lol'] },
      { keys: ['bye', 'later', 'cya'], replies: ['cya! ✌️', 'okok later {u} 🤙'] },
    ],
    fallback: [
      'lol true',
      'fr fr',
      'no way 😅',
      'ok but have you tried the dark mode toggle yet 🌙',
      'haha nice',
      'say less',
    ],
  },
  {
    name: 'DJ Nova',
    subtitle: 'Music Bot',
    rules: [
      { keys: ['play', 'song', 'music', 'playlist', 'recommend', 'track'], replies: [
        '🎵 Today\'s pick: "Midnight City" — M83. Instant vibe.',
        '🎧 Queue this: Tame Impala — "The Less I Know The Better".',
        '🔥 Try Dua Lipa — "Levitating" and thank me later.',
        '🎶 Chill mix idea: lo-fi beats + rain sounds. You\'re welcome.',
        '🎸 Feeling loud? "Seven Nation Army" — The White Stripes.',
        '🎹 Something smooth: Norah Jones — "Come Away With Me".',
      ] },
      { keys: ['hi', 'hello', 'hey'], replies: ['Yo {u}! 🎧 Need a track? Just say "play".'] },
      { keys: ['love', 'great', 'nice', 'cool'], replies: ['Told you I had taste 😎🎶'] },
    ],
    fallback: [
      'Say "play" and I\'ll drop a recommendation 🎶',
      'I live for the bass 🎛️ — ask me for a song!',
    ],
  },
];

function pickBotReply(bot, userName, text) {
  const t = text.toLowerCase();
  for (const rule of bot.rules) {
    if (rule.keys.some((k) => t.includes(k))) {
      return rule.replies[Math.floor(Math.random() * rule.replies.length)].replaceAll('{u}', userName);
    }
  }
  return bot.fallback[Math.floor(Math.random() * bot.fallback.length)].replaceAll('{u}', userName);
}

/* ---------------------------------- state --------------------------------- */

const clients = new Map();       // name -> ws
const lastSeen = new Map();      // name -> ts (also lists offline users)
const conversations = new Map(); // convoKey -> message[]
let nextId = 1;

function convoKey(a, b) {
  return [a, b].sort().join('::');
}

/* ------------------------------- persistence ------------------------------ */

try {
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  for (const [key, msgs] of Object.entries(raw)) {
    if (Array.isArray(msgs) && msgs.length) conversations.set(key, msgs);
  }
  const all = [...conversations.values()].flat();
  if (all.length) nextId = Math.max(...all.map((m) => m.id || 0)) + 1;
  console.log(`Loaded ${all.length} messages from disk.`);
} catch {
  /* first run — no history yet */
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(Object.fromEntries(conversations)));
    } catch (err) {
      console.error('Save failed:', err.message);
    }
  }, 400);
}

/* --------------------------------- helpers -------------------------------- */

function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function pushMessage(msg) {
  const key = convoKey(msg.from, msg.to);
  if (!conversations.has(key)) conversations.set(key, []);
  const arr = conversations.get(key);
  arr.push(msg);
  if (arr.length > MAX_HISTORY) arr.splice(0, arr.length - MAX_HISTORY);
  scheduleSave();
}

function userList() {
  const humans = [...lastSeen.keys()].map((name) => ({
    name,
    online: clients.has(name),
    bot: false,
    lastSeen: clients.has(name) ? null : lastSeen.get(name),
  }));
  const bots = BOTS.map((b) => ({ name: b.name, online: true, bot: true, lastSeen: null }));
  return [...bots, ...humans];
}

function broadcastUsers() {
  const payload = JSON.stringify({ type: 'users', users: userList() });
  for (const ws of clients.values()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

function notifyStatus(m) {
  send(clients.get(m.from), {
    type: 'status', id: m.id, with: m.to, delivered: m.delivered, read: m.read,
  });
}

function markDeliveredFor(name) {
  let changed = false;
  for (const msgs of conversations.values()) {
    for (const m of msgs) {
      if (m.to === name && !m.delivered) {
        m.delivered = true;
        changed = true;
        notifyStatus(m);
      }
    }
  }
  if (changed) scheduleSave();
}

function botSay(botName, to, text) {
  const m = {
    id: nextId++, from: botName, to, text, ts: Date.now(),
    delivered: clients.has(to), read: false,
  };
  pushMessage(m);
  send(clients.get(to), { type: 'message', message: m });
}

function scheduleBotReply(botName, userName, userText) {
  const bot = BOTS.find((b) => b.name === botName);
  if (!bot) return;
  const reply = pickBotReply(bot, userName, userText);
  const thinkMs = 500 + Math.min(2500, reply.length * 45) + Math.random() * 500;
  setTimeout(() => {
    send(clients.get(userName), { type: 'typing', from: botName, isTyping: true });
    setTimeout(() => {
      send(clients.get(userName), { type: 'typing', from: botName, isTyping: false });
      botSay(botName, userName, reply);
    }, thinkMs);
  }, 450);
}

/* ------------------------------ message router ---------------------------- */

function handle(ws, msg) {
  switch (msg.type) {
    case 'join': {
      let name = String(msg.name || '').trim().replace(/\s+/g, ' ').slice(0, 24);
      if (!name) name = 'Guest-' + Math.floor(Math.random() * 1000);
      if (BOTS.some((b) => b.name.toLowerCase() === name.toLowerCase())) name = name + ' (you)';
      const existing = clients.get(name);
      if (existing && existing !== ws) {
        send(existing, { type: 'kicked', reason: 'You signed in from another tab.' });
        existing.close();
      }
      ws.userName = name;
      clients.set(name, ws);
      lastSeen.set(name, Date.now());
      send(ws, { type: 'joined', name, users: userList() });
      broadcastUsers();
      markDeliveredFor(name);
      const key = convoKey(name, 'Aria');
      if (!conversations.has(key) || conversations.get(key).length === 0) {
        setTimeout(() => {
          if (clients.has(name)) {
            botSay('Aria', name,
              `Welcome to A-Chat, ${name}! 🎉 I'm Aria, the demo assistant. Pick any contact on the left to start chatting — or open this app in a second tab with a different name to chat live between users.`);
          }
        }, 1200);
      }
      break;
    }

    case 'message': {
      const from = ws.userName;
      if (!from) return;
      const to = String(msg.to || '').slice(0, 64);
      const text = String(msg.text || '').slice(0, 4000);
      if (!to || !text.trim()) return;
      const isBot = BOTS.some((b) => b.name === to);
      const m = { id: nextId++, from, to, text, ts: Date.now(), delivered: false, read: false };
      pushMessage(m);
      send(ws, { type: 'message', message: m }); // echo to sender (assigns id/ts)
      const target = clients.get(to);
      if (target && target.readyState === WebSocket.OPEN) {
        m.delivered = true;
        send(target, { type: 'message', message: m });
        notifyStatus(m);
        scheduleSave();
      }
      if (isBot) {
        m.delivered = true;
        m.read = true;
        notifyStatus(m);
        scheduleBotReply(to, from, text);
      }
      break;
    }

    case 'typing': {
      const to = clients.get(String(msg.to || ''));
      send(to, { type: 'typing', from: ws.userName, isTyping: !!msg.isTyping });
      break;
    }

    case 'read': {
      const me = ws.userName;
      const other = String(msg.with || '');
      const msgs = conversations.get(convoKey(me, other)) || [];
      let changed = false;
      for (const m of msgs) {
        if (m.to === me && !m.read) {
          m.read = true;
          changed = true;
          send(clients.get(m.from), { type: 'read', id: m.id, by: me });
        }
      }
      if (changed) scheduleSave();
      break;
    }

    case 'history': {
      const me = ws.userName;
      const other = String(msg.with || '');
      markDeliveredFor(me);
      send(ws, { type: 'history', with: other, messages: conversations.get(convoKey(me, other)) || [] });
      break;
    }
  }
}

/* --------------------------------- server --------------------------------- */

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_req, res) => res.json({ ok: true, users: clients.size }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    try {
      handle(ws, msg);
    } catch (err) {
      console.error('Handler error:', err);
    }
  });
  ws.on('close', () => {
    if (ws.userName && clients.get(ws.userName) === ws) {
      clients.delete(ws.userName);
      lastSeen.set(ws.userName, Date.now());
      broadcastUsers();
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`A-Chat listening on http://0.0.0.0:${PORT}`);
});
