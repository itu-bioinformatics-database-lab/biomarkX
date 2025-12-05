const jwt = require('jsonwebtoken');
const db = require('../db/database');
const SECRET_KEY = process.env.JWT_SECRET || 'change_this_secret_in_prod';

// Middleware for all routes
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  // No authorization header → anonymous session not yet known
  if (!authHeader) {
    req.userId = null;
    req.session_id = null;
    return next();
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ success: false, error: 'Invalid Authorization header format' });
  }

  const token = parts[1];

  // Try to verify JWT first (registered users)
  try {
    const payload = jwt.verify(token, SECRET_KEY);
    req.userId = payload.userId;
    req.session_id = null; // JWT users don't need a session ID
    return next();
  } catch (jwtError) {
    // If JWT fails, check if it's a guest session integer ID
    const parsedId = parseInt(token, 10);
    if (!isNaN(parsedId)) {
      try {
        const result = await db.query('SELECT session_id FROM users WHERE session_id = $1', [parsedId]);
        if (result.rows.length > 0) {
          req.userId = null;
          req.session_id = result.rows[0].session_id;
          return next();
        }
      } catch (dbError) {
        console.error('Database error checking guest session:', dbError);
      }
    }

    console.warn('Invalid token provided:', token);
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

// Middleware to verify user is authenticated (not guest)
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ success: false, message: 'Missing token' });
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    const payload = jwt.verify(token, SECRET_KEY);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

module.exports = authMiddleware;
module.exports.verifyToken = verifyToken;
