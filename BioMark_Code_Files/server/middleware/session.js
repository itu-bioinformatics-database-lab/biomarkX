const db = require('../db/database');

module.exports = async (req, res, next) => {
  let sessionId = null;

  // Priority 1: Check Authorization header for guest integer token
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      const token = parts[1];
      // Check if it's a guest token (integer, not a JWT with dots)
      if (!token.includes('.')) {
        const parsedId = parseInt(token, 10);
        if (!isNaN(parsedId)) {
          sessionId = parsedId; // Use the guest token as session ID
        }
      }
      // If it's a JWT, session stays null (logged-in users don't use session_id for ownership)
    }
  }

  // Priority 2: Fall back to x-session-id header (legacy support)
  if (!sessionId) {
    const headerSessionId = req.header('x-session-id');
    if (headerSessionId) {
      const parsedId = parseInt(headerSessionId, 10);
      if (isNaN(parsedId)) {
        return res.status(400).json({ success: false, error: 'Invalid session id format' });
      }
      sessionId = parsedId;
    }
  }

  // Priority 3: Generate new session only if no auth at all
  if (!sessionId && !authHeader) {
    try {
      const result = await db.query('INSERT INTO users DEFAULT VALUES RETURNING session_id');
      sessionId = result.rows[0].session_id;
    } catch (err) {
      console.error('DB error while creating session', err);
      return res.status(500).json({ success: false, error: 'Failed to create session' });
    }
  }

  // Make session ID available to downstream handlers
  req.sessionId = sessionId;
  // Echo it back to the client (for legacy support)
  if (sessionId) {
    res.set('x-session-id', String(sessionId));
  }

  next();
}; 