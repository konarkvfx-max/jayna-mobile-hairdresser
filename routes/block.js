// Replace /routes/block.js with this:

const express = require('express');
const router = express.Router();
const { broadcast } = require('../lib/websocket');
const WAITWHILE_BASE = 'https://api.waitwhile.com/v2';

function timeToDuration(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
  if (totalMinutes <= 0) throw new Error('End time must be after start time');
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  let duration = 'PT';
  if (hours > 0) duration += `${hours}H`;
  if (minutes > 0) duration += `${minutes}M`;
  return duration;
}

function buildAdelaideTime(dateStr, timeStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
  const isDaylight = dayOfYear >= 274 || dayOfYear < 121;
  const offset = isDaylight ? '+10:30' : '+09:30';
  return `${dateStr}T${timeStr}:00${offset}`;
}

router.post('/', async (req, res) => {
  try {
    const { date, start, end, reason } = req.body;
    if (!date || !start || !end) {
      return res.status(400).json({ error: 'date, start, and end are required' });
    }

    const duration = timeToDuration(start, end);
    const startTime = buildAdelaideTime(date, start);

    const body = {
      locationId: process.env.WAITWHILE_LOCATION_ID,
      name: `⛔ ${reason || 'Blocked'}`,
      phone: '+61000000000', // Dummy phone
      startTime,
      duration,
      status: 'confirmed', // Use valid Waitwhile status
      serviceIds: [],
      customFields: [],
      resourceIds: [], // If you have resource blocking, add here
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
