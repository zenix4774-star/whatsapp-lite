# WhatsApp Lite — deployment guide (100% free path)

Real, server-backed messaging app: Node.js + Express + Turso (hosted
SQLite-compatible database). No localStorage-as-database, no fake data,
no client-side frameworks, and no credit card needed anywhere.

The chat page auto-reloads every 5 seconds (`<meta http-equiv="refresh">`)
so messages sent from one device show up on another without needing modern
JavaScript.

## Files

- `server.js` — the entire backend (auth, sessions, chat pages, message logic)
- `package.json` — dependencies
- `public/style.css` — styling

## Why Turso instead of a local database file

Render's **free** web service tier does not support persistent disks (that
requires a paid plan). Without a disk, a local SQLite file gets wiped every
time the app restarts. Turso solves this: it's a real hosted database, its
free tier requires no credit card, and your app talks to it over the network
— so the free Render web service (with no disk at all) works perfectly.

## 1. Create your free Turso database

1. Go to https://turso.tech and sign up (no card required).
2. In the dashboard, create a new database (any name, e.g. `whatsapp-lite`).
3. Once created, find:
   - The **Database URL** (starts with `libsql://...`)
   - An **Auth Token** (generate one from the database's settings page)
4. Keep both values handy — you'll paste them into Render as environment
   variables in the next step.

## 2. Push your code to GitHub

(Skip if you've already done this.)

```
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/whatsapp-lite.git
git push -u origin main
```

## 3. Deploy on Render (free web service, no disk needed)

1. Go to https://render.com → **New** → **Web Service** → connect your
   `whatsapp-lite` GitHub repo.
2. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
3. Go to the **Environment** tab and add three variables:
   - `TURSO_DATABASE_URL` → your Turso database URL
   - `TURSO_AUTH_TOKEN` → your Turso auth token
   - `SESSION_SECRET` → any long random string (signs the login cookie)
4. Click **Create Web Service**. No disk, no payment method — Render will
   build and deploy on the free tier.
5. Render gives you a public HTTPS URL like
   `https://whatsapp-lite-xxxx.onrender.com` — that's your live app.

## Running locally first (optional, to test)

Create a `.env` file or export the same three variables in your terminal,
then:

```
npm install
npm start
```

Open `http://localhost:3000` to test before deploying.

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
- Sessions are stored in a signed cookie; set your own long random
  `SESSION_SECRET` in production.
- Each user can only see conversations where they are the sender or
  recipient — enforced by the SQL query and session check on every route.

## Note on Render's free tier

Free web services on Render "sleep" after a period of inactivity and take
a few seconds to wake up on the next request — this is normal and doesn't
affect your data, which lives safely in Turso regardless of whether Render
is asleep or awake.
