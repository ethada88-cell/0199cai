# Online CS (native deploy notes)

Customer service system deployed natively on the server (no Docker): FastAPI + PostgreSQL + Redis + Nginx.

## Visitor page embed

The visitor chat page (`/c/...`) embeds the **mobile** site inside a phone-width stage:

1. Chat opens full-screen inside the phone frame.
2. Tap **看官网** to hide chat and browse the mobile site.
3. Tap the red **客服** button to return to chat.

Mobile site is served via reverse proxy with an iPhone User-Agent:

- `https://m.ojy0871.com/` → proxies `https://0199w.com/` (mobile HTML + CDN assets)

This avoids loading the desktop PC site when opening the link on a computer.

## Useful URLs

- Console: `https://cs.ojy0871.com/login/`
- Visitor example: `https://cs.ojy0871.com/c/<company>/`
- Mobile embed proxy: `https://m.ojy0871.com/#/`

## Local mirrors in this repo

- `web/c/index.html` — visitor page (synced from server)
- `deploy/online-cs.conf` — Nginx vhost (synced from server)
