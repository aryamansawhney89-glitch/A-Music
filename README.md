# A-Chat 💬

A WhatsApp-style realtime chat web app: Node.js + Express + WebSocket backend and a
vanilla HTML/CSS/JS frontend that mirrors the WhatsApp Web experience.

## Features

- **Realtime messaging** between browser tabs / devices over WebSocket
- **WhatsApp Web UI** — chat list, message bubbles with tails, date separators, ✓ / ✓✓ / blue-tick receipts
- **Typing indicators** and **online / last-seen presence**
- **Unread badges** (sidebar + browser tab title)
- **Emoji picker**, auto-growing composer, Enter-to-send
- **Dark mode** toggle (persisted)
- **Message sounds** (Web Audio — no audio files needed)
- **Demo bots** — Aria (support), Max (your buddy) and DJ Nova (music picks 🎵) reply live so a single user can try everything immediately
- **Chat history persisted** to `data/messages.json` (survives server restarts)

## Run it

```bash
npm install
npm start        # serves on http://localhost:3000
```

Open the page, pick a name, and start chatting. Open a **second browser tab with a
different name** to chat live between two users — messages, typing indicators and
read receipts all update in real time.

## How it works

- `server.js` — Express static host + `ws` WebSocket router. Messages, presence,
  typing and read state travel as JSON frames; history is kept in memory and
  flushed to `data/messages.json`.
- `public/` — zero-build frontend (`index.html`, `style.css`, `app.js`).
- The client talks to the server over the same host/port (`ws://`/`wss://`), so it
  works behind any reverse proxy without extra config.

## Configuration

| Env var | Default | Description      |
|---------|---------|------------------|
| `PORT`  | `3000`  | HTTP/WS port     |
