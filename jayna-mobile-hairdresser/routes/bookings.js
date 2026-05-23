/**
 * Bookings routes
 * GET  /bookings              — all upcoming bookings (today + 30 days)
 * POST /bookings/create       — create a new booking
 * POST /bookings/:id/confirm  — confirm a pending booking
 * POST /bookings/:id/cancel   — cancel a booking
 */

const express = require('express');
const router = express.Router();
const { getVisits, getServices, confirmVisit, cancelVisit, createVisit, parseVisit } = require('../lib/waitwhile');
const { broadcast } = require('../lib/websocket');

// ── Adelaide date helper ─────────────────────────────────────
function getAdelaideDate(offsetDays = 0) {
  const now = new Date();
  const shifted = new Date(now.getTime() + offsetDays * 86400000);
  const parts = {};
  new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Adelaide',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(shifted).forEach(p => {
    if (p.type !== 'literal') parts[p.type] = p.value;
  });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// ── Service catalogue cache ──────────────────────────────────
let cachedServices = [];
let servicesCachedAt = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function getCachedServices() {
  if (Date.now() - servicesCachedAt < CACHE_TTL && cachedServices.length > 0) {
    return cachedServices;
  }
  try {
    cachedServices = await getServices();
    servicesCachedAt = Date.now();
  } catch (err) {
    console.error('[Services] Cache refresh failed:', err.message);
  }
  return cachedServices;
}

// ── GET /bookings ────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const fromDate = getAdelaideDate(0);
    const toDate = getAdelaideDate(30);

    const [visits, services] = await Promise.all([
      getVisits(fromDate, toDate),
      getCachedServices(),
    ]);

    const bookings = visits
      .filter(v => {
        const state = (v.state || '').toUpperCase();
        return state !== 'CANCELLED' && state !== 'NOSHOW';
      })
      .map(v => parseVisit(v, services));

    res.json(bookings);
  } catch (err) {
    console.error('[GET /bookings] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch bookings', detail: err.message });
  }
});

// ── POST /bookings/create ────────────────────────────────────
router.post('/create', async (req, res) => {
  try {
    const { services: serviceIds, client, startTime, customFields } = req.body;

    if (!client?.name) {
      return res.status(400).json({ error: 'Client name is required' });
    }

    const visit = await createVisit({
      services: serviceIds,
      client,
      startTime,
      customFields,
    });

    broadcast('booking_created', { visitId: visit.id });

    res.json({ success: true, visit });
  } catch (err) {
    console.error('[POST /bookings/create] Error:', err.message);
    res.status(500).json({ error: 'Failed to create booking', detail: err.message });
  }
});

// ── POST /bookings/:id/confirm ───────────────────────────────
router.post('/:id/confirm', async (req, res) => {
  try {
    const visit = await confirmVisit(req.params.id);
    broadcast('booking_update', { visitId: req.params.id, state: 'BOOKED' });
    res.json({ success: true, visit });
  } catch (err) {
    console.error(`[POST /bookings/${req.params.id}/confirm] Error:`, err.message);
    res.status(500).json({ error: 'Failed to confirm booking', detail: err.message });
  }
});

// ── POST /bookings/:id/cancel ────────────────────────────────
router.post('/:id/cancel', async (req, res) => {
  try {
    const visit = await cancelVisit(req.params.id);
    broadcast('booking_cancelled', { visitId: req.params.id });
    res.json({ success: true, visit });
  } catch (err) {
    console.error(`[POST /bookings/${req.params.id}/cancel] Error:`, err.message);
    res.status(500).json({ error: 'Failed to cancel booking', detail: err.message });
  }
});

module.exports = router;
