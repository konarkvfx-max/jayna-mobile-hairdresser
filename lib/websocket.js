/**
 * WebSocket manager (hardened)
 * - Token-verified upgrade handshake: connect with wss://host/?token=<APP_AUTH_TOKEN>
 * - Unauthenticated connections are rejected before the upgrade completes
 */

const WebSocket = require('ws');
const url = require('url');
const { isValidToken } = require('../middleware/auth');

let wss = null;

function init(server) {
  wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const { query } = url.parse(req.url, true);
    if (!isValidToken(query.token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    console.log('[WS] Client connected. Total:', wss.clients.size);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('close', () => console.log('[WS] Client disconnected. Total:', wss.clients.size));
    ws.on('error', (err) => console.error('[WS] Client error:', err.message));
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));
  console.log('[WS] WebSocket server ready (token-authenticated)');
}

function broadcast(type, data = {}) {
  if (!wss) return;
  const message = JSON.stringify({ type, ...data, timestamp: Date.now() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  });
}

module.exports = { init, broadcast };
