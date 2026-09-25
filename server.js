var express = require('express');
var createClient = require('@libsql/client').createClient;
var bcrypt = require('bcryptjs');
var cookieSession = require('cookie-session');
var path = require('path');

var app = express();

var db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

function setup() {
  return db.execute(
    "CREATE TABLE IF NOT EXISTS users (" +
    "id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "username TEXT UNIQUE NOT NULL," +
    "password_hash TEXT NOT NULL," +
    "created_at INTEGER NOT NULL)"
  ).then(function () {
    return db.execute(
      "CREATE TABLE IF NOT EXISTS messages (" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT," +
      "sender_id INTEGER NOT NULL," +
      "recipient_id INTEGER NOT NULL," +
      "body TEXT NOT NULL," +
      "created_at INTEGER NOT NULL)"
    );
  });
}

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

function getUserByUsername(username) {
  return db.execute({
    sql: 'SELECT * FROM users WHERE username = ?',
    args: [username]
  }).then(function (result) {
    return result.rows[0] || null;
  });
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
  getUserByUsername(username).then(function (existing) {
    if (existing) {
      res.redirect('/register?error=' + encodeURIComponent('Username already taken'));
      return;
    }
    var hash = bcrypt.hashSync(password, 10);
    db.execute({
      sql: 'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)',
      args: [username, hash, Date.now()]
    }).then(function (result) {
      req.session.userId = Number(result.lastInsertRowid);
      req.session.username = username;
      res.redirect('/chats');
    });
  }).catch(function (err) {
    console.error(err);
    res.redirect('/register?error=' + encodeURIComponent('Something went wrong'));
  });
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
  getUserByUsername(username).then(function (user) {
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      res.redirect('/login?error=' + encodeURIComponent('Invalid username or password'));
      return;
    }
    req.session.userId = Number(user.id);
    req.session.username = user.username;
    res.redirect('/chats');
  }).catch(function (err) {
    console.error(err);
    res.redirect('/login?error=' + encodeURIComponent('Something went wrong'));
  });
});

app.get('/logout', function (req, res) {
  req.session = null;
  res.redirect('/login');
});

// ---------- Chat list ----------
app.get('/chats', requireLogin, function (req, res) {
  var myId = req.session.userId;
  db.execute({
    sql:
      "SELECT u.username AS other, MAX(m.created_at) AS last_time " +
      "FROM messages m " +
      "JOIN users u ON u.id = CASE WHEN m.sender_id = ? THEN m.recipient_id ELSE m.sender_id END " +
      "WHERE m.sender_id = ? OR m.recipient_id = ? " +
      "GROUP BY u.username ORDER BY last_time DESC",
    args: [myId, myId, myId]
  }).then(function (result) {
    var rows = result.rows;
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
  }).catch(function (err) {
    console.error(err);
    res.status(500).send('Server error');
  });
});

app.get('/find', requireLogin, function (req, res) {
  var q = (req.query.q || '').trim();
  if (!q) { res.redirect('/chats'); return; }
  if (q === req.session.username) {
    res.redirect('/chats?error=' + encodeURIComponent('That is you'));
    return;
  }
  getUserByUsername(q).then(function (user) {
    if (!user) {
      res.redirect('/chats?error=' + encodeURIComponent('User not found'));
      return;
    }
    res.redirect('/chat/' + encodeURIComponent(q));
  }).catch(function (err) {
    console.error(err);
    res.redirect('/chats?error=' + encodeURIComponent('Something went wrong'));
  });
});

// ---------- Chat thread ----------
app.get('/chat/:username', requireLogin, function (req, res) {
  getUserByUsername(req.params.username).then(function (other) {
    if (!other) { res.redirect('/chats?error=' + encodeURIComponent('User not found')); return; }
    var myId = req.session.userId;
    var otherId = Number(other.id);

    return db.execute({
      sql:
        "SELECT * FROM messages " +
        "WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?) " +
        "ORDER BY created_at ASC",
      args: [myId, otherId, otherId, myId]
    }).then(function (result) {
      var msgs = result.rows;
      var list = '';
      for (var i = 0; i < msgs.length; i++) {
        var mine = Number(msgs[i].sender_id) === myId;
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
  }).catch(function (err) {
    console.error(err);
    res.status(500).send('Server error');
  });
});

app.post('/chat/:username/send', requireLogin, function (req, res) {
  getUserByUsername(req.params.username).then(function (other) {
    if (!other) { res.redirect('/chats'); return; }
    var text = (req.body.body || '').trim();
    if (!text) {
      res.redirect('/chat/' + encodeURIComponent(other.username));
      return;
    }
    return db.execute({
      sql: 'INSERT INTO messages (sender_id, recipient_id, body, created_at) VALUES (?, ?, ?, ?)',
      args: [req.session.userId, Number(other.id), text, Date.now()]
    }).then(function () {
      res.redirect('/chat/' + encodeURIComponent(other.username));
    });
  }).catch(function (err) {
    console.error(err);
    res.status(500).send('Server error');
  });
});

app.get('/', function (req, res) {
  res.redirect(req.session && req.session.userId ? '/chats' : '/login');
});

var PORT = process.env.PORT || 3000;
setup().then(function () {
  app.listen(PORT, function () {
    console.log('WhatsApp Lite running on port ' + PORT);
  });
}).catch(function (err) {
  console.error('Failed to set up database:', err);
  process.exit(1);
});
