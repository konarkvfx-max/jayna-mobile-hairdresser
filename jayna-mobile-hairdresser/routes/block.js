/**
 * Block time route
 * POST /block — blocks a time slot on Jayna's schedule
 * Creates a "visit" in Waitwhile with a blocked/unavailable state
 */

const express = require('express');
const router = express.Router();
const { broadcast } = require('../lib/websocket');

const WAITWHILE_BASE = 'https://api.waitwhile.com/v2';

router.post('/', async (req, res) => {
  try {
    const { date, start, end, reason } = req.body;

    if (!date || !start || !end) {
      return res.status(400).json({ error: 'date, start, and end are required' });
    }

    // Calculate duration in minutes
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const durationMinutes = (eh * 60 + em) - (sh * 60 + sm);

    if (durationMinutes <= 0) {
      return res.status(400).json({ error: 'End time must be after start time' });
    }

    // Build ISO start time in Adelaide timezone
    const startTime = `${date}T${start}:00+09:30`;

    // Create a visit marked as a block/break
    const body = {
      locationId: process.env.WAITWHILE_LOCATION_ID,
      firstName: reason || 'Blocked',
      startTime,
      duration: durationMinutes,
      state: 'BOOKED',
      note: `BLOCKED: ${reason || 'Unavailable'}`,
      serviceIds: [],
    };

    const apiRes = await fetch(`${WAITWHILE_BASE}/visits`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.WAITWHILE_API_KEY,
      },
      body: JSON.stringify(body),
    });

    if (!apiRes.ok) {
      const errBody = await apiRes.text();
      throw new Error(`Waitwhile block failed (${apiRes.status}): ${errBody}`);
    }

    const visit = await apiRes.json();
    broadcast('booking_created', { visitId: visit.id, type: 'block' });

    res.json({ success: true, visit });
  } catch (err) {
    console.error('[POST /block] Error:', err.message);
    res.status(500).json({ error: 'Failed to block time', detail: err.message });
  }
});

module.exports = router;
