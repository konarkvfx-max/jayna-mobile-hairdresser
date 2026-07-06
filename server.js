/**
 * Jayna Mobile Hairdresser — Server (hardened)
 *
 * Security layers:
 * - helmet security headers
 * - CORS locked to configured origin (ALLOWED_ORIGIN env, defaults same-origin only)
 * - Rate limiting on all API routes
 * - Bearer-token auth on all API routes (except /health and /webhook)
 * - Webhook HMAC signature verification (raw body preserved)
 * - Generic error responses (details logged server-side only)
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const path = require('path');
const { init: initWS } = require('./lib/websocket');
const { requireAuth } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

app.set('trust proxy', 1); // Railway sits behind a proxy — needed for correct client IPs in rate limiting

// ── Security headers ──────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'], // tighten to 'self' after moving to a build step
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      connectSrc: ["'self'", 'wss:', 'ws:'],
      imgSrc: ["'self'", 'data:'],
    },
  },
}));

// ── CORS: locked. Same-origin deploys need no cross-origin at all. ──
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN; // e.g. https://jayna.up.railway.app
app.use(cors({
  origin: ALLOWED_ORIGIN ? [ALLOWED_ORIGIN] : false, // false = no cross-origin requests allowed
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Body parsing — preserve raw body for webhook signature verification ──
app.use(express.json({
  limit: '100kb',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

// ── Rate limiting ─────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120, // generous for a single user, hostile to abuse
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30, // brute-force protection on 401s
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Static frontend (no auth — the PIN gate is in the app itself) ──
app.use(express.static(path.join(__dirname, 'public')));

// ── Health check (public, no secrets leaked) ──────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Webhook (public but signature-verified inside the route) ──
app.use('/webhook', apiLimiter, require('./routes/webhook'));

// ── Authenticated API routes ──────────────────────────────────
app.use('/bookings',                 authLimiter, apiLimiter, requireAuth, require('./routes/bookings'));
app.use('/customers',                authLimiter, apiLimiter, requireAuth, require('./routes/customers'));
app.use('/services',                 authLimiter, apiLimiter, requireAuth, require('./routes/services'));
app.use('/schedule-with-drive-times',authLimiter, apiLimiter, requireAuth, require('./routes/schedule'));
app.use('/block',                    authLimiter, apiLimiter, requireAuth, require('./routes/block'));

// ── SPA fallback ──────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global error handler — never leak internals ───────────────
app.use((err, req, res, next) => {
  console.error('[Unhandled]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── WebSocket (token-verified in lib/websocket.js) ────────────
initWS(server);

// ── Start ─────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n  ✂️  Jayna server running on port ${PORT}`);
  console.log(`  🔐 Auth token:   ${process.env.APP_AUTH_TOKEN ? 'configured' : '⛔ MISSING — all API requests will be rejected'}`);
  console.log(`  📡 Waitwhile:    ${process.env.WAITWHILE_API_KEY ? 'configured' : '⚠️  MISSING'}`);
  console.log(`  🗺️  Google Maps:  ${process.env.GOOGLE_MAPS_API_KEY ? 'configured' : '⚠️  MISSING'}`);
  console.log(`  🪝 Webhook sig:  ${process.env.WAITWHILE_WEBHOOK_SECRET ? 'configured' : '⚠️  unverified'}\n`);
});
