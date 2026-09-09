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

## Run it locally

```bash
git clone https://github.com/aryamansawhney89-glitch/A-Music.git
cd A-Music
npm install
npm start        # serves on http://localhost:3000
```

Open the page, pick a name, and start chatting. Open a **second browser tab with a
different name** to chat live between two users — messages, typing indicators and
read receipts all update in real time.

## Deploy it (free, ~3 minutes)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Faryamansawhney89-glitch%2FA-Music)

1. Click the button above and sign in to **Render** with your GitHub account.
2. Render reads [`render.yaml`](render.yaml) and creates the web service automatically
   — just confirm the blueprint and click **Apply / Deploy**.
3. When the deploy finishes, Render gives you a public URL like
   `https://a-chat-xxxx.onrender.com` — **share that link with anyone**. 🌍

Or do it manually: [dashboard.render.com](https://dashboard.render.com) → **New +** →
**Web Service** → select the `A-Music` repo → Runtime **Node**, Build `npm install`,
Start `npm start`, Plan **Free** → **Deploy**.

> **Free-tier notes:** the app sleeps after ~15 min without visitors (the first visit
> takes up to a minute to wake it), and chat history resets on restarts/redeploys
> since the free plan has an ephemeral disk.

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
