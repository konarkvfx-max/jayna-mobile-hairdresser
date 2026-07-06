/**
 * Webhook route (hardened)
 * POST /webhook — receives Waitwhile webhook events
 * Verifies HMAC-SHA256 signature against WAITWHILE_WEBHOOK_SECRET before trusting the payload.
 * Check Waitwhile's dashboard for the exact signature header name — commonly
 * 'x-waitwhile-signature' or 'x-webhook-signature'. Both are checked below.
 */

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { broadcast } = require('../lib/websocket');

function verifySignature(req) {
  const secret = process.env.WAITWHILE_WEBHOOK_SECRET;
  if (!secret) {
    // No secret configured: log loudly, still accept (broadcast-only impact),
    // but this should be configured in production.
    console.warn('[Webhook] WAITWHILE_WEBHOOK_SECRET not set — signature NOT verified');
    return true;
  }
  const sig = req.headers['x-waitwhile-signature']
           || req.headers['x-webhook-signature']
           || req.headers['x-signature'];
  if (!sig || !req.rawBody) return false;

  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

router.post('/', (req, res) => {
  try {
    if (!verifySignature(req)) {
      console.warn('[Webhook] Rejected: invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = req.body || {};
    const type = event.type || '';
    console.log('[Webhook] Received:', type || 'unknown', event.data?.id || '');

    if (type.includes('visit.created') || type.includes('visit.booked')) {
      broadcast('booking_created', { visitId: event.data?.id });
    } else if (type.includes('visit.updated') || type.includes('visit.confirmed')) {
      broadcast('booking_update', { visitId: event.data?.id, state: event.data?.state });
    } else if (type.includes('visit.cancelled') || type.includes('visit.removed')) {
      broadcast('booking_cancelled', { visitId: event.data?.id });
    } else if (type.includes('visit.completed')) {
      broadcast('booking_update', { visitId: event.data?.id, state: 'COMPLETED' });
    } else {
      broadcast('refresh', {});
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Webhook] Error:', err.message);
    res.status(200).json({ received: true });
  }
});

module.exports = router;
