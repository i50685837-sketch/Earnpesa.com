const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const axios = require('axios');
const moment = require('moment');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public')); // put index.html, register.html, dashboard.html here

const db = new sqlite3.Database('./earnpesa.db');

// === M-PESA B2C CONFIG - CHANGE THESE ===
const consumerKey = 'YOUR_CONSUMER_KEY';
const consumerSecret = 'YOUR_CONSUMER_SECRET';
const b2cShortCode = '603000'; // Sandbox B2C shortcode
const initiatorName = 'testapi';
const securityCredential = 'YOUR_ENCRYPTED_SECURITY_CREDENTIAL'; // Get from Safaricom portal

// 1. Create Tables
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
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS withdrawals(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount REAL,
    phone TEXT,
    status TEXT DEFAULT 'pending',
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
});

// 2. Get M-Pesa Access Token
async function getMpesaToken() {
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const url = 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';
  const res = await axios.get(url, { headers: { Authorization: `Basic ${auth}` } });
  return res.data.access_token;
}

// 3. REGISTER
app.post('/api/register', (req, res) => {
  const {name, email, mpesa} = req.body;
  db.run('INSERT INTO users(name, email, mpesa) VALUES(?,?,?)', [name, email, mpesa], function(err){
    if(err) return res.status(400).json({error: 'Email already exists'});
    res.json({success: true, userId: this.lastID});
  });
});

// 4. LOGIN
app.post('/api/login', (req, res) => {
  const {email} = req.body;
  db.get('SELECT * FROM users WHERE email =?', [email], (err, user) => {
    if(!user) return res.status(404).json({error: 'User not found'});
    res.json(user);
  });
});

// 5. SUBMIT SURVEY - Earn KSh 50
app.post('/api/submit', (req, res) => {
  const {userId, question, answer} = req.body;
  const reward = 50;
  db.run('INSERT INTO responses(user_id, question, answer, reward) VALUES(?,?,?,?)', [userId, question, answer, reward]);
  db.run('UPDATE users SET balance = balance + ? WHERE id =?', [reward, userId]);
  res.json({success: true, earned: reward});
});

// 6. GET USER DATA
app.get('/api/user/:id', (req, res) => {
  db.get('SELECT * FROM users WHERE id =?', [req.params.id], (err, user) => {
    res.json(user);
  });
});

// 7. WITHDRAW / B2C PAYOUT TO M-PESA
app.post('/api/withdraw', async (req, res) => {
  const {userId, amount, phone} = req.body; // phone: 2547xxxxxxxx
  
  // Check balance first
  db.get('SELECT balance FROM users WHERE id =?', [userId], async (err, user) => {
    if(!user || user.balance < amount) return res.status(400).json({error: 'Insufficient balance'});
    if(amount < 50) return res.status(400).json({error: 'Minimum withdrawal is KSh 50'});

    try {
      const token = await getMpesaToken();
      
      const payload = {
        InitiatorName: initiatorName,
        SecurityCredential: securityCredential,
        CommandID: "BusinessPayment",
        Amount: amount,
        PartyA: b2cShortCode,
        PartyB: phone,
        Remarks: "EarnPesa Survey Payout",
        QueueTimeOutURL: "https://yourdomain.com/api/timeout", // must be public
        ResultURL: "https://yourdomain.com/api/result" // must be public
      };

      const response = await axios.post(
        'https://sandbox.safaricom.co.ke/mpesa/b2c/v1/paymentrequest',
        payload,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Save withdrawal and deduct balance
      db.run('INSERT INTO withdrawals(user_id, amount, phone, status) VALUES(?,?,?,?)', [userId, amount, phone, 'pending']);
      db.run('UPDATE users SET balance = balance - ? WHERE id =?', [amount, userId]);
      
      res.json({success: true, message: 'Payout initiated. Check your phone', data: response.data});

    } catch (err) {
      res.status(500).json({error: err.response?.data || err.message});
    }
  });
});

// 8. M-PESA RESULT URL - Safaricom calls this
app.post('/api/result', (req, res) => {
  console.log("B2C RESULT:", JSON.stringify(req.body));
  // Here you can update withdrawal status to 'completed' or 'failed'
  res.json({ResultCode: 0, ResultDesc: "Received"});
});

app.post('/api/timeout', (req, res) => {
  console.log("B2C TIMEOUT:", req.body);
  res.json({ResultCode: 0, ResultDesc: "Received"});
});

const PORT = 3000;
app.listen(PORT, () => console.log(`EarnPesa server running on http://localhost:${PORT}`));
