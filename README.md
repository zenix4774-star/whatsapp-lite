# WhatsApp Lite — deployment guide

This is a real, server-backed messaging app: Node.js + Express + SQLite.
No localStorage-as-database, no fake data, no client-side frameworks.
The chat page auto-reloads every 5 seconds (`<meta http-equiv="refresh">`) so
messages sent from one device show up on another without needing modern
JavaScript.

## Files

- `server.js` — the entire backend (auth, sessions, chat pages, message API)
- `package.json` — dependencies
- `public/style.css` — styling
- `data.db` — created automatically on first run (the real database file)

## 1. Deploy on Render.com (recommended — free tier, persistent disk)

1. Create a new GitHub repo and push these files to it.
2. Go to https://render.com → **New** → **Web Service** → connect your repo.
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
4. **Important — add a persistent disk** (Render dashboard → your service →
   "Disks" → Add Disk), mount path `/opt/render/project/src`, size 1GB. Without
   this, `data.db` is wiped every time Render redeploys/restarts your app.
5. Add an environment variable `SESSION_SECRET` set to any long random string
   (this signs the login cookie).
6. Click **Create Web Service**. Render gives you a public HTTPS URL like
   `https://whatsapp-lite.onrender.com` — that's your real, hosted app.

## 2. Alternative: Railway.app

1. https://railway.app → New Project → Deploy from GitHub repo.
2. Add a **Volume**, mount it at `/app` (or wherever your working directory
   is), so `data.db` persists across deploys.
3. Set `SESSION_SECRET` in the Variables tab.
4. Railway gives you a public URL automatically.

## 3. Running locally first (optional, to test)

```
npm install
npm start
```

Then open `http://localhost:3000` in a regular browser to confirm everything
works before deploying.

## How it behaves on an old/feature-phone browser

- Register/login/logout/send-message are plain HTML `<form>` submissions —
  they work even with JavaScript fully disabled.
- The chat thread page reloads itself automatically every 5 seconds via a
  `<meta http-equiv="refresh">` tag, so a message sent from a PC will appear
  on the phone within ~5 seconds, and vice versa.
- No fetch, no ES modules, no arrow functions, no `let`/`const`, no
  frameworks — every page is rendered as complete HTML on the server.

## Security notes

- Passwords are hashed with bcrypt before storage — never stored in plain text.
- Sessions are stored in a signed cookie; change `SESSION_SECRET` to your own
  long random value in production.
- Each user can only see conversations where they are the sender or
  recipient — enforced by the SQL query and session check on every route.
