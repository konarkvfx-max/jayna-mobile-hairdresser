/**
 * Webhook route
 * POST /webhook — receives Waitwhile webhook events
 * Broadcasts updates to connected WebSocket clients
 */

const express = require('express');
const router = express.Router();
const { broadcast } = require('../lib/websocket');

router.post('/', (req, res) => {
  try {
    const event = req.body;

    console.log('[Webhook] Received:', event.type || 'unknown', event.data?.id || '');

    // Map Waitwhile webhook event types to our broadcast types
    const type = event.type || '';

    if (type.includes('visit.created') || type.includes('visit.booked')) {
      broadcast('booking_created', { visitId: event.data?.id });
    } else if (type.includes('visit.updated') || type.includes('visit.confirmed')) {
      broadcast('booking_update', { visitId: event.data?.id, state: event.data?.state });
    } else if (type.includes('visit.cancelled') || type.includes('visit.removed')) {
      broadcast('booking_cancelled', { visitId: event.data?.id });
    } else if (type.includes('visit.completed')) {
      broadcast('booking_update', { visitId: event.data?.id, state: 'COMPLETED' });
    } else {
      // Generic refresh for any other event
      broadcast('refresh', {});
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Webhook] Error:', err.message);
    res.status(200).json({ received: true }); // Always 200 so Waitwhile doesn't retry
  }
});

module.exports = router;
