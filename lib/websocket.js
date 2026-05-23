/**
 * WebSocket manager
 * Broadcasts booking updates to all connected frontend clients
 */

const WebSocket = require('ws');

let wss = null;

/**
 * Attach WebSocket server to an existing HTTP server
 */
function init(server) {
  wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    console.log('[WS] Client connected. Total:', wss.clients.size);

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('close', () => {
      console.log('[WS] Client disconnected. Total:', wss.clients.size);
    });

    ws.on('error', (err) => {
      console.error('[WS] Client error:', err.message);
    });
  });

  // Ping/pong keepalive every 30s
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));

  console.log('[WS] WebSocket server ready');
}

/**
 * Broadcast a message to all connected clients
 */
function broadcast(type, data = {}) {
  if (!wss) return;
  const message = JSON.stringify({ type, ...data, timestamp: Date.now() });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

module.exports = { init, broadcast };
