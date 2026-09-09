'use strict';

/* ================================ A-Chat client ================================ */

const $ = (id) => document.getElementById(id);

const joinScreen = $('joinScreen');
const app = $('app');
const nameInput = $('nameInput');
const joinBtn = $('joinBtn');
const chatListEl = $('chatList');
const connBanner = $('connBanner');
const emptyState = $('emptyState');
const chatView = $('chatView');
const chatAvatar = $('chatAvatar');
const chatTitle = $('chatTitle');
const chatStatus = $('chatStatus');
const messagesEl = $('messages');
const msgInput = $('msgInput');
const sendBtn = $('sendBtn');
const micBtn = $('micBtn');
const emojiBtn = $('emojiBtn');
const attachBtn = $('attachBtn');
const emojiPanel = $('emojiPanel');
const searchInput = $('searchInput');
const themeBtn = $('themeBtn');
const logoutBtn = $('logoutBtn');
const backBtn = $('backBtn');
const toastEl = $('toast');

/* ---------------------------------- state ---------------------------------- */

const state = {
  me: null,
  ws: null,
  connected: false,
  users: [],            // [{name, online, bot, lastSeen}]
  chats: new Map(),     // name -> {messages: [], unread: 0, lastTs: 0}
  active: null,
  lastDateLabel: null,
};

const AVATAR_COLORS = ['#00a884', '#0088cc', '#8e44ad', '#e67e22', '#e91e63', '#16a085', '#c0392b', '#2c3e50'];
function avatarColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
const initialOf = (name) => (name.trim()[0] || '?').toUpperCase();

const TICK_SINGLE = `<svg viewBox="0 0 16 11" class="tick"><path d="M14.5 1 6 9.5 1.5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const TICK_DOUBLE = `<svg viewBox="0 0 20 11" class="tick"><path d="M11.5 1 4.5 9.5 1.2 6.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 1 11.5 9.5 10.2 8.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function tickSVG(m) {
  if (m.from !== state.me) return '';
  if (m.read) return TICK_DOUBLE.replace('class="tick"', 'class="tick read"');
  if (m.delivered) return TICK_DOUBLE;
  return TICK_SINGLE;
}

/* ------------------------------ tiny helpers ------------------------------- */

function timeHM(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dateLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 864e5);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function listTime(ts) {
  const label = dateLabel(ts);
  return label === 'Today' ? timeHM(ts) : label === 'Yesterday' ? 'Yesterday' : new Date(ts).toLocaleDateString();
}

let toastTimer = null;
function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
}

/* message sounds */
let actx = null;
function pop(freq) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.07, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.14);
    o.connect(g).connect(actx.destination);
    o.start();
    o.stop(actx.currentTime + 0.15);
  } catch { /* audio not available */ }
}

function getChat(name) {
  if (!state.chats.has(name)) state.chats.set(name, { messages: [], unread: 0, lastTs: 0 });
  return state.chats.get(name);
}

function findUser(name) {
  return state.users.find((u) => u.name === name);
}

/* ------------------------------ websocket ---------------------------------- */

function wsSend(payload) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(payload));
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  state.ws = new WebSocket(`${proto}://${location.host}`);
  state.ws.onopen = () => {
    state.connected = true;
    setConnUI();
    if (state.me) wsSend({ type: 'join', name: state.me });
  };
  state.ws.onmessage = (e) => {
    try { handle(JSON.parse(e.data)); } catch (err) { console.error(err); }
  };
  state.ws.onclose = () => {
    state.connected = false;
    setConnUI();
    setTimeout(connect, 1600); // auto-reconnect
  };
  state.ws.onerror = () => state.ws.close();
}

function setConnUI() {
  const joined = !!state.me;
  connBanner.classList.toggle('hidden', state.connected || !joined);
}

/* ------------------------------ join flow ---------------------------------- */

joinBtn.addEventListener('click', startJoin);
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startJoin(); });

nameInput.value = localStorage.getItem('achat-name') || '';
nameInput.focus();

function startJoin() {
  const name = nameInput.value.trim();
  if (!name) { toast('Please enter a name'); return; }
  state.me = name;
  localStorage.setItem('achat-name', name);
  if (state.connected) wsSend({ type: 'join', name });
  // otherwise onopen will send it
}

/* --------------------------- server event handler -------------------------- */

function handle(msg) {
  switch (msg.type) {
    case 'joined': {
      state.me = msg.name;
      state.users = msg.users || [];
      joinScreen.classList.add('hidden');
      app.classList.remove('hidden');
      renderMe();
      renderChatList();
      break;
    }

    case 'users': {
      state.users = msg.users || [];
      renderChatList();
      updateActiveHeader();
      break;
    }

    case 'message': {
      const m = msg.message;
      const other = m.from === state.me ? m.to : m.from;
      const chat = getChat(other);
      chat.messages.push(m);
      chat.lastTs = m.ts;
      clearTyping(other);

      if (other === state.active && !chatView.classList.contains('hidden')) {
        appendMessage(m, chat.messages[chat.messages.length - 2]);
        maybeScroll(m);
        if (m.to === state.me && document.hasFocus()) {
          wsSend({ type: 'read', with: other });
        } else if (m.to === state.me) {
          chat.unread++;
        }
      } else if (m.to === state.me) {
        chat.unread++;
      }

      if (m.from === state.me) pop(520);
      else if (other !== state.active || !document.hasFocus()) pop(880);

      renderChatList();
      updateTitleBadge();
      break;
    }

    case 'history': {
      const chat = getChat(msg.with);
      chat.messages = msg.messages || [];
      chat.lastTs = chat.messages.length ? chat.messages[chat.messages.length - 1].ts : 0;
      if (state.active === msg.with) {
        renderMessages(chat);
        wsSend({ type: 'read', with: msg.with });
        chat.unread = 0;
        renderChatList();
        updateTitleBadge();
      }
      break;
    }

    case 'status':
    case 'read': {
      const chatName = msg.with || msg.by;
      const chat = getChat(chatName);
      const m = chat.messages.find((x) => x.id === msg.id);
      if (m) {
        if (msg.type === 'read') m.read = true;
        else { m.delivered = msg.delivered; m.read = msg.read; }
        const el = messagesEl.querySelector(`[data-id="${m.id}"] .meta .ticks`);
        if (el) el.innerHTML = tickSVG(m);
      }
      renderChatList();
      break;
    }

    case 'typing': {
      if (msg.from === state.active) showTyping(msg.from, msg.isTyping);
      break;
    }

    case 'kicked': {
      state.me = null;
      toast(msg.reason || 'Signed in elsewhere');
      app.classList.add('hidden');
      joinScreen.classList.remove('hidden');
      break;
    }
  }
}

/* ------------------------------ rendering ---------------------------------- */

function renderMe() {
  $('myName').textContent = state.me;
  const av = $('myAvatar');
  av.textContent = initialOf(state.me);
  av.style.background = avatarColor(state.me);
}

function contacts() {
  return state.users
    .filter((u) => u.name !== state.me)
    .map((u) => ({ ...u, chat: getChat(u.name) }))
    .sort((a, b) => (b.chat.lastTs - a.chat.lastTs) || a.name.localeCompare(b.name));
}

function renderChatList() {
  const filter = searchInput.value.trim().toLowerCase();
  chatListEl.innerHTML = '';
  let any = false;

  for (const c of contacts()) {
    if (filter && !c.name.toLowerCase().includes(filter)) continue;
    any = true;
    const item = document.createElement('div');
    item.className = 'chat-item' + (c.name === state.active ? ' active' : '');
    item.addEventListener('click', () => openChat(c.name));

    const av = document.createElement('div');
    av.className = 'avatar';
    av.style.background = avatarColor(c.name);
    av.textContent = initialOf(c.name);

    const body = document.createElement('div');
    body.className = 'ci-body';

    const top = document.createElement('div');
    top.className = 'ci-top';
    const nameEl = document.createElement('span');
    nameEl.className = 'ci-name';
    nameEl.textContent = c.name;
    if (c.bot) {
      const tag = document.createElement('span');
      tag.className = 'bot-tag';
      tag.textContent = 'BOT';
      nameEl.appendChild(tag);
    }
    const timeEl = document.createElement('span');
    timeEl.className = 'ci-time' + (c.chat.unread ? ' unread' : '');
    if (c.chat.lastTs) timeEl.textContent = listTime(c.chat.lastTs);
    top.append(nameEl, timeEl);

    const bottom = document.createElement('div');
    bottom.className = 'ci-bottom';
    const prev = document.createElement('span');
    prev.className = 'ci-preview';
    const last = c.chat.messages[c.chat.messages.length - 1];
    if (last) {
      if (last.from === state.me) {
        const t = document.createElement('span');
        t.innerHTML = tickSVG(last);
        prev.appendChild(t);
      }
      const txt = document.createElement('span');
      txt.textContent = last.text;
      prev.appendChild(txt);
    } else {
      prev.textContent = c.online ? (c.bot ? 'bot • online' : 'online') : 'tap to start chatting';
    }
    bottom.appendChild(prev);
    if (c.chat.unread) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = c.chat.unread;
      bottom.appendChild(badge);
    }

    body.append(top, bottom);
    item.append(av, body);
    chatListEl.appendChild(item);
  }

  if (!any) {
    const note = document.createElement('div');
    note.className = 'list-note';
    note.textContent = filter
      ? 'No contacts match your search.'
      : 'No contacts yet — open this page in another tab with a different name to add people.';
    chatListEl.appendChild(note);
  }
}

function openChat(name) {
  state.active = name;
  emptyState.classList.add('hidden');
  chatView.classList.remove('hidden');
  document.body.classList.add('chat-open');

  const u = findUser(name);
  chatTitle.textContent = name;
  chatAvatar.textContent = initialOf(name);
  chatAvatar.style.background = avatarColor(name);
  updateActiveHeader();

  const chat = getChat(name);
  chat.unread = 0;
  if (chat.messages.length) {
    renderMessages(chat);
    wsSend({ type: 'read', with: name });
  } else {
    messagesEl.innerHTML = '';
    state.lastDateLabel = null;
  }
  wsSend({ type: 'history', with: name }); // refresh from server + mark delivered

  renderChatList();
  updateTitleBadge();
  msgInput.focus();
}

function updateActiveHeader() {
  if (!state.active) return;
  const u = findUser(state.active);
  if (!u) { chatStatus.textContent = ''; return; }
  if (chatStatus.dataset.typing === '1') return; // don't stomp typing indicator
  chatStatus.className = 'chat-status';
  if (u.online) {
    chatStatus.textContent = 'online';
    chatStatus.classList.add('online');
  } else if (u.lastSeen) {
    chatStatus.textContent = `last seen ${listTime(u.lastSeen)}`;
  } else {
    chatStatus.textContent = 'offline';
  }
}

/* ---- messages pane ---- */

function daySep(label) {
  const sep = document.createElement('div');
  sep.className = 'day-sep';
  const s = document.createElement('span');
  s.textContent = label;
  sep.appendChild(s);
  return sep;
}

function buildBubble(m, prev) {
  const out = m.from === state.me;
  const row = document.createElement('div');
  row.className = 'msg-row ' + (out ? 'out' : 'in');

  const bubble = document.createElement('div');
  const newGroup = !prev || prev.from !== m.from || dateLabel(prev.ts) !== dateLabel(m.ts);
  bubble.className = 'bubble' + (newGroup ? ' tail' : '');

  const text = document.createElement('span');
  text.textContent = m.text;
  bubble.appendChild(text);

  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.dataset.id = m.id;
  const t = document.createElement('span');
  t.textContent = timeHM(m.ts);
  meta.appendChild(t);
  if (out) {
    const ticks = document.createElement('span');
    ticks.className = 'ticks';
    ticks.innerHTML = tickSVG(m);
    meta.appendChild(ticks);
  }
  bubble.appendChild(meta);

  row.appendChild(bubble);
  return row;
}

function renderMessages(chat) {
  messagesEl.innerHTML = '';
  state.lastDateLabel = null;
  let prev = null;
  for (const m of chat.messages) {
    const label = dateLabel(m.ts);
    if (label !== state.lastDateLabel) {
      messagesEl.appendChild(daySep(label));
      state.lastDateLabel = label;
    }
    messagesEl.appendChild(buildBubble(m, prev));
    prev = m;
  }
  scrollBottom(true);
}

function appendMessage(m, prev) {
  const label = dateLabel(m.ts);
  if (label !== state.lastDateLabel) {
    messagesEl.appendChild(daySep(label));
    state.lastDateLabel = label;
    prev = null; // tail after separator
  }
  removeTypingRow();
  messagesEl.appendChild(buildBubble(m, prev));
}

function scrollBottom(force) {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function maybeScroll(m) {
  const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 160;
  if (m.from === state.me || nearBottom) scrollBottom();
}

/* ---- typing indicator ---- */

let typingRowEl = null;
let typingTimer = null;

function showTyping(from, isTyping) {
  if (isTyping) {
    chatStatus.textContent = 'typing…';
    chatStatus.className = 'chat-status typing';
    chatStatus.dataset.typing = '1';
    if (!typingRowEl) {
      typingRowEl = document.createElement('div');
      typingRowEl.className = 'msg-row in';
      typingRowEl.innerHTML = '<div class="bubble typing"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
    }
    removeTypingRow();
    messagesEl.appendChild(typingRowEl);
    scrollBottom();
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => clearTyping(from), 5000); // safety
  } else {
    clearTyping(from);
  }
}

function removeTypingRow() {
  if (typingRowEl && typingRowEl.parentNode) typingRowEl.parentNode.removeChild(typingRowEl);
}

function clearTyping(from) {
  clearTimeout(typingTimer);
  removeTypingRow();
  if (from === state.active) {
    delete chatStatus.dataset.typing;
    updateActiveHeader();
  }
}

/* ------------------------------ composer ----------------------------------- */

function autoResize() {
  msgInput.style.height = 'auto';
  msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
  const hasText = msgInput.value.trim().length > 0;
  sendBtn.classList.toggle('hidden', !hasText);
  micBtn.classList.toggle('hidden', hasText);
}

function sendMessage() {
  const text = msgInput.value.replace(/\s+$/, '');
  if (!text.trim() || !state.active) return;
  wsSend({ type: 'message', to: state.active, text });
  msgInput.value = '';
  autoResize();
  sendTyping(false);
  msgInput.focus();
}

sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('input', () => { autoResize(); sendTyping(true); });
msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

micBtn.addEventListener('click', () => toast('🎙️ Voice messages coming soon!'));
attachBtn.addEventListener('click', () => toast('📎 Attachments coming soon!'));

/* typing notifications (throttled) */
let lastTypingSent = 0;
let typingStopTimer = null;
function sendTyping(isTyping) {
  if (!state.active) return;
  const now = Date.now();
  if (isTyping) {
    if (now - lastTypingSent > 1800) {
      wsSend({ type: 'typing', to: state.active, isTyping: true });
      lastTypingSent = now;
    }
    clearTimeout(typingStopTimer);
    typingStopTimer = setTimeout(() => wsSend({ type: 'typing', to: state.active, isTyping: false }), 1800);
  } else {
    clearTimeout(typingStopTimer);
    wsSend({ type: 'typing', to: state.active, isTyping: false });
  }
}

/* ------------------------------ emoji panel -------------------------------- */

const EMOJIS = ['😀','😂','🤣','😊','😍','😘','😎','🤔','😅','😭','😡','🥺','😴','🤯','😇','🙃','😉','🤗','🤫','🤭','👍','👎','👌','✌️','🙏','👏','🙌','🤝','💪','🫶','❤️','💔','💯','🔥','✨','🎉','🎂','🎁','🎧','🎵','🎶','⚽','🏆','🌙','☀️','🌈','⭐','🍕'];

for (const emo of EMOJIS) {
  const b = document.createElement('button');
  b.textContent = emo;
  b.addEventListener('click', () => {
    const start = msgInput.selectionStart || msgInput.value.length;
    msgInput.value = msgInput.value.slice(0, start) + emo + msgInput.value.slice(msgInput.selectionEnd || start);
    autoResize();
    msgInput.focus();
    msgInput.selectionStart = msgInput.selectionEnd = start + emo.length;
  });
  emojiPanel.appendChild(b);
}

emojiBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  emojiPanel.classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  if (!emojiPanel.contains(e.target)) emojiPanel.classList.add('hidden');
});

/* ------------------------------ sidebar ------------------------------------ */

searchInput.addEventListener('input', renderChatList);

themeBtn.addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  localStorage.setItem('achat-theme', dark ? 'dark' : 'light');
  themeBtn.textContent = dark ? '☀️' : '🌙';
});
document.documentElement.dataset.theme = localStorage.getItem('achat-theme') || 'light';
themeBtn.textContent = document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙';

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('achat-name');
  location.reload();
});

backBtn.addEventListener('click', () => document.body.classList.remove('chat-open'));

/* ------------------------------ misc --------------------------------------- */

function updateTitleBadge() {
  let total = 0;
  for (const chat of state.chats.values()) total += chat.unread;
  document.title = total ? `(${total}) A-Chat` : 'A-Chat';
}

window.addEventListener('focus', () => {
  if (state.active) {
    const chat = getChat(state.active);
    if (chat.unread) {
      chat.unread = 0;
      renderChatList();
      updateTitleBadge();
    }
    wsSend({ type: 'read', with: state.active });
  }
});

connect();
