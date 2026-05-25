/**
 * Bookings routes
 * GET  /bookings              — all bookings (today to 12 months ahead)
 * POST /bookings/create       — create a new booking
 * POST /bookings/:id/confirm  — confirm a pending booking
 * POST /bookings/:id/complete — mark a booking as complete
 * POST /bookings/:id/cancel   — cancel a booking
 * POST /bookings/:id/edit     — edit a booking
 */

const express = require('express');
const router  = express.Router();
const { getVisits, getServices, confirmVisit, completeVisit, cancelVisit, createVisit, parseVisit } = require('../lib/waitwhile');
const { broadcast } = require('../lib/websocket');

const WAITWHILE_BASE = 'https://api.waitwhile.com/v2';

// ── Adelaide date helper ──────────────────────────────────────
function getAdelaideDate(offsetDays = 0) {
  const now     = new Date();
  const shifted = new Date(now.getTime() + offsetDays * 86400000);
  const parts   = {};
  new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Adelaide',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(shifted).forEach(p => { if (p.type !== 'literal') parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// ── Service catalogue cache ───────────────────────────────────
let cachedServices  = [];
let servicesCachedAt = 0;
const CACHE_TTL     = 10 * 60 * 1000;

async function getCachedServices() {
  if (Date.now() - servicesCachedAt < CACHE_TTL && cachedServices.length > 0) return cachedServices;
  try {
    cachedServices   = await getServices();
    servicesCachedAt = Date.now();
  } catch (err) {
    console.error('[Services] Cache refresh failed:', err.message);
  }
  return cachedServices;
}

// ── GET /bookings ─────────────────────────────────────────────
// Fetches today → 12 months ahead so Jayna can book regulars year-round
router.get('/', async (req, res) => {
  try {
    const fromDate = getAdelaideDate(0);
    const toDate   = getAdelaideDate(365); // 12 months

    const [visits, services] = await Promise.all([
      getVisits(fromDate, toDate),
      getCachedServices(),
    ]);

    const bookings = visits
      .filter(v => {
        const state = (v.state || '').toUpperCase();
        // Show everything except hard-cancelled/noshow
        return state !== 'CANCELLED' && state !== 'NOSHOW';
      })
      .map(v => parseVisit(v, services));

    res.json(bookings);
  } catch (err) {
    console.error('[GET /bookings] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch bookings', detail: err.message });
  }
});

// ── POST /bookings/create ─────────────────────────────────────
router.post('/create', async (req, res) => {
  try {
    const { services: serviceIds, client, startTime, customFields } = req.body;

    if (!client?.name) return res.status(400).json({ error: 'Client name is required' });

    const visit = await createVisit({ services: serviceIds, client, startTime, customFields });
    broadcast('booking_created', { visitId: visit.id });
    res.json({ success: true, visit });
  } catch (err) {
    console.error('[POST /bookings/create] Error:', err.message);
    res.status(500).json({ error: 'Failed to create booking', detail: err.message });
  }
});

// ── POST /bookings/:id/confirm ────────────────────────────────
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

// ── POST /bookings/:id/complete ───────────────────────────────
router.post('/:id/complete', async (req, res) => {
  try {
    const visit = await completeVisit(req.params.id);
    broadcast('booking_update', { visitId: req.params.id, state: 'COMPLETE' });
    res.json({ success: true, visit });
  } catch (err) {
    console.error(`[POST /bookings/${req.params.id}/complete] Error:`, err.message);
    res.status(500).json({ error: 'Failed to complete booking', detail: err.message });
  }
});

// ── POST /bookings/:id/cancel ─────────────────────────────────
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

// ── POST /bookings/:id/edit ───────────────────────────────────
// Waitwhile uses POST (not PATCH) to update visits
router.post('/:id/edit', async (req, res) => {
  try {
    const { id } = req.params;
    const { phone, startTime, duration, services, customFields } = req.body;

    const visitBody = {};

    if (startTime) {
      const dt          = new Date(startTime);
      const adelaideFmt = new Intl.DateTimeFormat('en-AU', {
        timeZone: 'Australia/Adelaide',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      });
      const parts = {};
      adelaideFmt.formatToParts(dt).forEach(p => { if (p.type !== 'literal') parts[p.type] = p.value; });
      visitBody.date = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    }

    if (duration)                        visitBody.duration    = duration * 60; // minutes → seconds
    if (services && services.length > 0) visitBody.serviceIds  = services;
    if (phone)                           visitBody.phone       = phone;
    if (customFields)                    visitBody.dataFields  = customFields;

    console.log(`[POST /bookings/${id}/edit] Sending:`, JSON.stringify(visitBody, null, 2));

    const apiRes = await fetch(`${WAITWHILE_BASE}/visits/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': process.env.WAITWHILE_API_KEY },
      body: JSON.stringify(visitBody),
    });

    if (!apiRes.ok) {
      const errBody = await apiRes.text();
      console.error(`[POST /bookings/${id}/edit] Waitwhile error:`, errBody);
      throw new Error(`Waitwhile POST failed (${apiRes.status}): ${errBody}`);
    }

    const data = await apiRes.json();
    broadcast('booking_update', { visitId: id });
    res.json(data);
  } catch (err) {
    console.error('[POST /bookings/:id/edit]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
