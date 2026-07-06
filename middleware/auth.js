/**
 * Auth middleware — single shared bearer token for a single-user app.
 * Set APP_AUTH_TOKEN in env (long random string: `openssl rand -hex 32`).
 * Timing-safe comparison to prevent token discovery via response timing.
 */

const crypto = require('crypto');

const TOKEN = process.env.APP_AUTH_TOKEN;

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    // Compare against self to keep timing constant, then fail
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function requireAuth(req, res, next) {
  if (!TOKEN) {
    // Fail CLOSED — refusing to run unauthenticated is the point
    console.error('[Auth] APP_AUTH_TOKEN not set — rejecting all API requests');
    return res.status(503).json({ error: 'Server auth not configured' });
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !timingSafeEqual(token, TOKEN)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/** Validate a raw token string (used by the WebSocket upgrade handshake) */
function isValidToken(token) {
  return !!TOKEN && !!token && timingSafeEqual(token, TOKEN);
}

module.exports = { requireAuth, isValidToken };
