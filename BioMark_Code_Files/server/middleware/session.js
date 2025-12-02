const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = (req, res, next) => {
  let sessionId = null;

  // Priority 1: Check Authorization header for guest UUID token
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      const token = parts[1];
      // Check if it's a guest UUID (not a JWT)
      if (!token.includes('.') && UUID_REGEX.test(token)) {
        sessionId = token; // Use the guest token as session ID
      }
      // If it's a JWT, session stays null (logged-in users don't use session_id for ownership)
    }
  }

  // Priority 2: Fall back to x-session-id header (legacy support)
  if (!sessionId) {
    sessionId = req.header('x-session-id');
    // Validate if provided
    if (sessionId && !UUID_REGEX.test(sessionId)) {
      return res.status(400).json({ success: false, error: 'Invalid session id format' });
    }
  }

  // Priority 3: Generate new session only if no auth at all
  if (!sessionId && !authHeader) {
    sessionId = uuidv4();
  }

  // Persist (or ensure) user row for session tracking
  if (sessionId) {
    try {
      db.prepare('INSERT OR IGNORE INTO users (session_id) VALUES (?)').run(sessionId);
    } catch (err) {
      console.error('DB error while inserting session', err);
    }
  }

  // Make session ID available to downstream handlers
  req.sessionId = sessionId;
  // Echo it back to the client (for legacy support)
  if (sessionId) {
    res.set('x-session-id', sessionId);
  }

  next();
}; 