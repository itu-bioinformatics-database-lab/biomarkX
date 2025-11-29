const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const SECRET_KEY = process.env.JWT_SECRET || 'change_this_secret_in_prod';
const SHORT_TOKEN_EXPIRY = '24h';  // 1 day for normal login
const LONG_TOKEN_EXPIRY = '30d';   // 30 days for "remember me"

// Email validation regex
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Helpers
const findAccountByEmail = (email) => db.prepare('SELECT * FROM accounts WHERE email = ?').get(email);
const findAccountByUsername = (username) => db.prepare('SELECT * FROM accounts WHERE username = ?').get(username);
const findAccountByEmailOrUsername = (identifier) => {
  const account = db.prepare('SELECT * FROM accounts WHERE email = ? OR username = ?').get(identifier, identifier);
  return account;
};
const findAccountById = (id) => db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
const createAccount = (email, passwordHash, username) => {
  const accountId = uuidv4();
  const stmt = db.prepare('INSERT INTO accounts (id, email, password_hash, username) VALUES (?, ?, ?, ?)');
  stmt.run(accountId, email, passwordHash, username);
  return accountId;
};

router.post('/signup', async (req, res) => {
  const { email, password, username } = req.body;
  
  // Validation
  if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password required' });
  if (!username) return res.status(400).json({ success: false, message: 'Username required' });
  
  // Validate email format
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email format' });
  }
  
  // Validate username (alphanumeric and underscore, 3-20 characters)
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  if (!usernameRegex.test(username)) {
    return res.status(400).json({ 
      success: false, 
      message: 'Username must be 3-20 characters and contain only letters, numbers, and underscores' 
    });
  }

  // Check if email already exists
  const existingEmail = findAccountByEmail(email);
  if (existingEmail) return res.status(400).json({ success: false, message: 'Email already in use' });
  
  // Check if username already exists
  const existingUsername = findAccountByUsername(username);
  if (existingUsername) return res.status(400).json({ success: false, message: 'Username already taken' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const userId = createAccount(email, hash, username);
    const { rememberMe } = req.body;
    const tokenExpiry = rememberMe ? LONG_TOKEN_EXPIRY : SHORT_TOKEN_EXPIRY;
    const token = jwt.sign({ userId }, SECRET_KEY, { expiresIn: tokenExpiry });
    return res.json({ success: true, token });
  } catch (err) {
    console.error('Signup error', err);
    return res.status(500).json({ success: false, message: 'Signup failed' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password, rememberMe } = req.body;
  
  // Find account by email or username
  const account = findAccountByEmailOrUsername(email);
  if (!account) return res.status(400).json({ success: false, message: 'Invalid credentials' });

  const match = await bcrypt.compare(password, account.password_hash);
  if (!match) return res.status(400).json({ success: false, message: 'Invalid credentials' });

  const tokenExpiry = rememberMe ? LONG_TOKEN_EXPIRY : SHORT_TOKEN_EXPIRY;
  const token = jwt.sign({ userId: account.id }, SECRET_KEY, { expiresIn: tokenExpiry });
  return res.json({ success: true, token });
});

// Provide a "whoami" endpoint for the client to verify token and get basic info
router.get('/me', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ success: false, error: 'Missing token' });
  const token = auth.split(' ')[1];
  
  // Check if it's a guest token (UUID format, no dots)
  if (!token.includes('.')) {
    // Guest token - just verify it exists in the users table
    const user = db.prepare('SELECT * FROM users WHERE session_id = ?').get(token);
    if (user) {
      return res.json({ 
        success: true, 
        user: { 
          id: user.session_id,
          username: 'Guest',
          isGuest: true
        } 
      });
    }
    return res.status(401).json({ success: false, error: 'Invalid guest token' });
  }
  
  // JWT token - verify and get account info
  try {
    const payload = jwt.verify(token, SECRET_KEY);
    const account = findAccountById(payload.userId);
    if (!account) return res.status(404).json({ success: false, error: 'Account not found' });
    return res.json({ 
      success: true, 
      user: { 
        id: account.id, 
        email: account.email,
        username: account.username 
      } 
    });
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
});

// Guest login
router.post('/guest', (req, res) => {
  const sessionId = uuidv4();

  // Save session in DB
  db.prepare('INSERT INTO users (session_id) VALUES (?)').run(sessionId);

  // Return a token (or just session ID)
  res.json({ token: sessionId, guest: true });
});

// Update profile
router.put('/update-profile', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ success: false, message: 'Missing token' });
  
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, SECRET_KEY);
    const userId = payload.userId;
    const { username, email, currentPassword, newPassword } = req.body;
    
    // Get current account
    const account = findAccountById(userId);
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
    
    // Validate username if changed
    if (username && username !== account.username) {
      const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
      if (!usernameRegex.test(username)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Username must be 3-20 characters and contain only letters, numbers, and underscores' 
        });
      }
      
      const existingUsername = findAccountByUsername(username);
      if (existingUsername) {
        return res.status(400).json({ success: false, message: 'Username already taken' });
      }
    }
    
    // Validate email if changed
    if (email && email !== account.email) {
      if (!isValidEmail(email)) {
        return res.status(400).json({ success: false, message: 'Invalid email format' });
      }
      
      const existingEmail = findAccountByEmail(email);
      if (existingEmail) {
        return res.status(400).json({ success: false, message: 'Email already in use' });
      }
    }
    
    // Handle password change
    let newPasswordHash = account.password_hash;
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, message: 'Current password required to change password' });
      }
      
      const match = await bcrypt.compare(currentPassword, account.password_hash);
      if (!match) {
        return res.status(400).json({ success: false, message: 'Current password is incorrect' });
      }
      
      newPasswordHash = await bcrypt.hash(newPassword, 10);
    }
    
    // Update account
    db.prepare('UPDATE accounts SET username = ?, email = ?, password_hash = ? WHERE id = ?')
      .run(username || account.username, email || account.email, newPasswordHash, userId);
    
    return res.json({ success: true, message: 'Profile updated successfully' });
  } catch (err) {
    console.error('Profile update error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
});

module.exports = router;
