/**
 * Jayna Mobile Hairdresser — Server
 *
 * Express + WebSocket server that:
 * - Serves the frontend (public/index.html)
 * - Proxies Waitwhile API for bookings, services, schedule
 * - Calculates drive times via Google Maps Distance Matrix
 * - Broadcasts live updates via WebSocket
 * - Receives Waitwhile webhooks
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { init: initWS } = require('./lib/websocket');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────
app.use(cors({
  origin: '*', // Railway serves frontend + API from same origin, but allow dev access too
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json());

// ── Static frontend ──────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ───────────────────────────────────────────────
app.use('/bookings', require('./routes/bookings'));
app.use('/customers', require('./routes/customers'));
app.use('/services', require('./routes/services'));
app.use('/schedule-with-drive-times', require('./routes/schedule'));
app.use('/webhook', require('./routes/webhook'));
app.use('/block', require('./routes/block'));

// ── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: {
      waitwhile: !!process.env.WAITWHILE_API_KEY,
      maps: !!process.env.GOOGLE_MAPS_API_KEY,
      location: !!process.env.WAITWHILE_LOCATION_ID,
    },
  });
});

// ── SPA fallback — serve index.html for any unmatched route ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── WebSocket ────────────────────────────────────────────────
initWS(server);

// ── Start ────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n  ✂️  Jayna server running on port ${PORT}`);
  console.log(`  📡 Waitwhile API: ${process.env.WAITWHILE_API_KEY ? 'configured' : '⚠️  MISSING'}`);
  console.log(`  🗺️  Google Maps:  ${process.env.GOOGLE_MAPS_API_KEY ? 'configured' : '⚠️  MISSING'}`);
  console.log(`  📍 Location ID:  ${process.env.WAITWHILE_LOCATION_ID || '⚠️  MISSING'}`);
  console.log(`  🌐 Frontend:     http://localhost:${PORT}\n`);
});
