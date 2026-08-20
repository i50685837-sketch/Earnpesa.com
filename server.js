const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public')); // put index.html and register.html in /public folder

// Connect DB
const db = new sqlite3.Database('./earnpesa.db');

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    mpesa TEXT,
    balance REAL DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS responses(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    question TEXT,
    answer TEXT,
    reward REAL DEFAULT 50,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
});

// 1. REGISTER
app.post('/api/register', (req, res) => {
  const {name, email, mpesa} = req.body;
  db.run('INSERT INTO users(name, email, mpesa) VALUES(?,?,?)', [name, email, mpesa], function(err){
    if(err) return res.status(400).json({error: 'Email already exists'});
    res.json({success: true, userId: this.lastID});
  });
});

// 2. LOGIN - just check email
app.post('/api/login', (req, res) => {
  const {email} = req.body;
  db.get('SELECT * FROM users WHERE email =?', [email], (err, user) => {
    if(!user) return res.status(404).json({error: 'User not found'});
    res.json(user);
  });
});

// 3. SUBMIT SURVEY - +50 KSh
app.post('/api/submit', (req, res) => {
  const {userId, question, answer} = req.body;
  db.run('INSERT INTO responses(user_id, question, answer) VALUES(?,?,?)', [userId, question, answer]);
  db.run('UPDATE users SET balance = balance + 50 WHERE id =?', [userId]);
  res.json({success: true, earned: 50});
});

// 4. GET USER DATA
app.get('/api/user/:id', (req, res) => {
  db.get('SELECT * FROM users WHERE id =?', [req.params.id], (err, user) => {
    res.json(user);
  });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`EarnPesa server running on http://localhost:${PORT}`));
