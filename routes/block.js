/**
 * Block route (hardened)
 * POST /block — block out time. Body: { date: 'YYYY-MM-DD', start: 'HH:MM', end: 'HH:MM', reason? }
 * - Full input validation
 * - DST-correct offsets via lib/tz (no hand-rolled day-of-year math)
 */

const express = require('express');
const router = express.Router();
const { broadcast } = require('../lib/websocket');
const { buildLocalTime } = require('../lib/tz');

const WAITWHILE_BASE = 'https://api.waitwhile.com/v2';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function timeToDuration(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
  if (totalMinutes <= 0) return null;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  let duration = 'PT';
  if (hours > 0) duration += `${hours}H`;
  if (minutes > 0) duration += `${minutes}M`;
  return duration;
}

router.post('/', async (req, res) => {
  try {
    const { date, start, end, reason } = req.body || {};

    if (!DATE_RE.test(date || '')) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    if (!TIME_RE.test(start || '')) return res.status(400).json({ error: 'start must be HH:MM (24h)' });
    if (!TIME_RE.test(end || ''))   return res.status(400).json({ error: 'end must be HH:MM (24h)' });
    if (reason !== undefined && (typeof reason !== 'string' || reason.length > 100)) {
      return res.status(400).json({ error: 'reason must be a string (max 100 chars)' });
    }

    const duration = timeToDuration(start, end);
    if (!duration) return res.status(400).json({ error: 'end time must be after start time' });

    const startTime = buildLocalTime(date, start);

    const body = {
      locationId: process.env.WAITWHILE_LOCATION_ID,
      name: `⛔ ${(reason || 'Blocked').trim()}`,
      phone: '+61000000000',
      startTime,
      duration,
      status: 'confirmed',
      serviceIds: [],
      customFields: [],
      resourceIds: [],
    };

    const apiRes = await fetch(`${WAITWHILE_BASE}/visits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': process.env.WAITWHILE_API_KEY },
      body: JSON.stringify(body),
    });

    if (!apiRes.ok) {
      console.error('[POST /block] Waitwhile error:', apiRes.status, await apiRes.text());
      return res.status(502).json({ error: 'Failed to block time' });
    }

    const visit = await apiRes.json();
    broadcast('booking_created', { visitId: visit.id, type: 'block' });
    res.json({ success: true, visit });
  } catch (err) {
    console.error('[POST /block] Error:', err.message);
    res.status(500).json({ error: 'Failed to block time' });
  }
});

module.exports = router;
