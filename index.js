// index.js
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

// Ensure data dir + files exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({}));
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, JSON.stringify([]));

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) { return null; }
}
function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

app.use(express.json());
app.use(cookieParser());

// Session setup
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_to_env_secret';
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    // In production on HTTPS, set secure: true
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 // 1 day
  }
}));

// Passport Google OAuth
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'YOUR_GOOGLE_CLIENT_SECRET';
const CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback';

passport.use(new GoogleStrategy({
  clientID: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  callbackURL: CALLBACK_URL
}, (accessToken, refreshToken, profile, done) => {
  // profile.emails[0].value is email
  done(null, profile);
}));

app.use(passport.initialize());
app.use(passport.session());

// Static files (frontend in /public)
app.use(express.static('public'));

// Auth routes
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    // Successful auth, redirect to root (frontend handles UI)
    res.redirect('/');
  }
);

app.get('/logout', (req, res) => {
  req.logout(() => {});
  res.redirect('/');
});

// API: get current user (email + username if set)
app.get('/api/user', (req, res) => {
  if (!req.user || !req.user.emails || !req.user.emails.length) {
    return res.json({ authenticated: false });
  }
  const email = req.user.emails[0].value;
  const users = readJSON(USERS_FILE) || {};
  const username = users[email] || null;
  res.json({
    authenticated: true,
    email,
    name: req.user.displayName || null,
    username
  });
});

// API: set username for logged-in user
app.post('/api/set-username', (req, res) => {
  if (!req.user || !req.user.emails || !req.user.emails.length) {
    return res.status(401).json({ ok: false, error: 'not authenticated' });
  }
  const email = req.user.emails[0].value;
  const { username } = req.body;
  if (!username || typeof username !== 'string' || username.length < 2) {
    return res.status(400).json({ ok: false, error: 'invalid username' });
  }
  const users = readJSON(USERS_FILE) || {};
  users[email] = username;
  writeJSON(USERS_FILE, users);
  res.json({ ok: true, username });
});

// API: read last messages (useful fallback)
app.get('/api/messages', (req, res) => {
  const msgs = readJSON(MESSAGES_FILE) || [];
  res.json(msgs);
});

// SOCKET.IO real-time
io.on('connection', (socket) => {
  // Client should pass auth on connection: socket = io({ auth: { email, username }});
  const auth = socket.handshake.auth || {};
  const email = auth.email;
  const username = auth.username;

  // Validate that username matches stored mapping for email
  const users = readJSON(USERS_FILE) || {};
  if (!email || !username || users[email] !== username) {
    // refuse connection
    socket.emit('errorMsg', 'Authentication invalid. Please reload and login.');
    socket.disconnect();
    return;
  }

  // Send existing messages to the newly connected client
  const messages = readJSON(MESSAGES_FILE) || [];
  socket.emit('init', messages);

  // Broadcast join (optional)
  socket.broadcast.emit('system', { text: `${username} joined`, ts: Date.now() });

  socket.on('sendMessage', (text) => {
    if (!text || typeof text !== 'string') return;
    const messages = readJSON(MESSAGES_FILE) || [];
    const msg = {
      sender: username,
      email,
      text: text.trim(),
      ts: Date.now()
    };
    messages.push(msg);
    // Keep a cap so file doesn't explode
    const MAX = 500;
    while (messages.length > MAX) messages.shift();
    writeJSON(MESSAGES_FILE, messages);
    io.emit('message', msg);
  });

  socket.on('disconnect', () => {
    socket.broadcast.emit('system', { text: `${username} left`, ts: Date.now() });
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
