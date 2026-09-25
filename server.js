var express = require('express');
var Database = require('better-sqlite3');
var bcrypt = require('bcryptjs');
var cookieSession = require('cookie-session');
var path = require('path');

var app = express();
var db = new Database(path.join(__dirname, 'data.db'));

db.exec(
  "CREATE TABLE IF NOT EXISTS users (" +
  "id INTEGER PRIMARY KEY AUTOINCREMENT," +
  "username TEXT UNIQUE NOT NULL," +
  "password_hash TEXT NOT NULL," +
  "created_at INTEGER NOT NULL)"
);

db.exec(
  "CREATE TABLE IF NOT EXISTS messages (" +
  "id INTEGER PRIMARY KEY AUTOINCREMENT," +
  "sender_id INTEGER NOT NULL," +
  "recipient_id INTEGER NOT NULL," +
  "body TEXT NOT NULL," +
  "created_at INTEGER NOT NULL)"
);

app.use(express.urlencoded({ extended: false }));
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'change-this-secret-please'],
  maxAge: 30 * 24 * 60 * 60 * 1000
}));
app.use('/static', express.static(path.join(__dirname, 'public')));

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(title, bodyHtml, extraHead) {
  return '<!DOCTYPE html><html><head>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    (extraHead || '') +
    '<title>' + escapeHtml(title) + '</title>' +
    '<link rel="stylesheet" href="/static/style.css">' +
    '</head><body>' + bodyHtml + '</body></html>';
}

function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    res.redirect('/login');
    return;
  }
  next();
}

// ---------- Register ----------
app.get('/register', function (req, res) {
  var body = '<div class="wrap"><h1>WhatsApp Lite</h1>' +
    '<h2>Create account</h2>' +
    (req.query.error ? '<p class="err">' + escapeHtml(req.query.error) + '</p>' : '') +
    '<form method="post" action="/register">' +
    '<input name="username" placeholder="Username" maxlength="20" required><br>' +
    '<input name="password" type="password" placeholder="Password" required><br>' +
    '<button type="submit">Sign up</button>' +
    '</form>' +
    '<p><a href="/login">Already have an account? Log in</a></p></div>';
  res.send(page('Register', body));
});

app.post('/register', function (req, res) {
  var username = (req.body.username || '').trim();
  var password = req.body.password || '';
  if (!username || !password || username.length > 20) {
    res.redirect('/register?error=' + encodeURIComponent('Please fill both fields'));
    return;
  }
  var existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    res.redirect('/register?error=' + encodeURIComponent('Username already taken'));
    return;
  }
  var hash = bcrypt.hashSync(password, 10);
  var info = db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(username, hash, Date.now());
  req.session.userId = info.lastInsertRowid;
  req.session.username = username;
  res.redirect('/chats');
});

// ---------- Login ----------
app.get('/login', function (req, res) {
  var body = '<div class="wrap"><h1>WhatsApp Lite</h1>' +
    '<h2>Log in</h2>' +
    (req.query.error ? '<p class="err">' + escapeHtml(req.query.error) + '</p>' : '') +
    '<form method="post" action="/login">' +
    '<input name="username" placeholder="Username" required><br>' +
    '<input name="password" type="password" placeholder="Password" required><br>' +
    '<button type="submit">Log in</button>' +
    '</form>' +
    '<p><a href="/register">Create an account</a></p></div>';
  res.send(page('Log in', body));
});

app.post('/login', function (req, res) {
  var username = (req.body.username || '').trim();
  var password = req.body.password || '';
  var user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.redirect('/login?error=' + encodeURIComponent('Invalid username or password'));
    return;
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  res.redirect('/chats');
});

app.get('/logout', function (req, res) {
  req.session = null;
  res.redirect('/login');
});

// ---------- Chat list ----------
app.get('/chats', requireLogin, function (req, res) {
  var myId = req.session.userId;
  var rows = db.prepare(
    "SELECT u.username AS other, MAX(m.created_at) AS last_time " +
    "FROM messages m " +
    "JOIN users u ON u.id = CASE WHEN m.sender_id = ? THEN m.recipient_id ELSE m.sender_id END " +
    "WHERE m.sender_id = ? OR m.recipient_id = ? " +
    "GROUP BY u.username ORDER BY last_time DESC"
  ).all(myId, myId, myId);

  var list = '';
  for (var i = 0; i < rows.length; i++) {
    list += '<li><a href="/chat/' + encodeURIComponent(rows[i].other) + '">' +
      escapeHtml(rows[i].other) + '</a></li>';
  }
  if (!rows.length) list = '<li class="muted">No conversations yet</li>';

  var body = '<div class="wrap">' +
    '<div class="topbar"><b>' + escapeHtml(req.session.username) + '</b>' +
    '<a class="logout" href="/logout">Logout</a></div>' +
    '<form method="get" action="/find">' +
    '<input name="q" placeholder="Search username" required>' +
    '<button type="submit">Chat</button>' +
    '</form>' +
    (req.query.error ? '<p class="err">' + escapeHtml(req.query.error) + '</p>' : '') +
    '<ul class="chatlist">' + list + '</ul>' +
    '</div>';
  res.send(page('Chats', body));
});

app.get('/find', requireLogin, function (req, res) {
  var q = (req.query.q || '').trim();
  if (!q) { res.redirect('/chats'); return; }
  if (q === req.session.username) {
    res.redirect('/chats?error=' + encodeURIComponent('That is you'));
    return;
  }
  var user = db.prepare('SELECT id FROM users WHERE username = ?').get(q);
  if (!user) {
    res.redirect('/chats?error=' + encodeURIComponent('User not found'));
    return;
  }
  res.redirect('/chat/' + encodeURIComponent(q));
});

// ---------- Chat thread ----------
app.get('/chat/:username', requireLogin, function (req, res) {
  var other = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!other) { res.redirect('/chats?error=' + encodeURIComponent('User not found')); return; }
  var myId = req.session.userId;

  var msgs = db.prepare(
    "SELECT m.* FROM messages m " +
    "WHERE (m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?) " +
    "ORDER BY m.created_at ASC"
  ).all(myId, other.id, other.id, myId);

  var list = '';
  for (var i = 0; i < msgs.length; i++) {
    var mine = msgs[i].sender_id === myId;
    list += '<div class="msg ' + (mine ? 'mine' : 'theirs') + '">' +
      escapeHtml(msgs[i].body) + '</div>';
  }

  var body = '<div class="wrap">' +
    '<div class="topbar"><a href="/chats">&lt; Back</a> <b>' + escapeHtml(other.username) + '</b></div>' +
    '<div class="msgs">' + list + '</div>' +
    '<form method="post" action="/chat/' + encodeURIComponent(other.username) + '/send">' +
    '<input name="body" placeholder="Message" maxlength="1000" autocomplete="off" required>' +
    '<button type="submit">Send</button>' +
    '</form>' +
    '</div>';

  res.send(page(other.username, body, '<meta http-equiv="refresh" content="5">'));
});

app.post('/chat/:username/send', requireLogin, function (req, res) {
  var other = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!other) { res.redirect('/chats'); return; }
  var text = (req.body.body || '').trim();
  if (text) {
    db.prepare('INSERT INTO messages (sender_id, recipient_id, body, created_at) VALUES (?, ?, ?, ?)')
      .run(req.session.userId, other.id, text, Date.now());
  }
  res.redirect('/chat/' + encodeURIComponent(other.username));
});

app.get('/', function (req, res) {
  res.redirect(req.session && req.session.userId ? '/chats' : '/login');
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log('WhatsApp Lite running on port ' + PORT);
});
