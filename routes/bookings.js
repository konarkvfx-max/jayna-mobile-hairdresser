/**
 * Bookings routes (hardened)
 * - Semantic customFields ({ address, price, notes }) mapped server-side via lib/fields
 * - Input validation on create/edit
 * - Generic error responses; upstream details logged only
 * - No PII in production logs
 */

const express = require('express');
const router  = express.Router();
const { getVisits, getServices, confirmVisit, completeVisit, cancelVisit, createVisit, parseVisit } = require('../lib/waitwhile');
const { broadcast } = require('../lib/websocket');
const { toCustomFields } = require('../lib/fields');
const { getLocalDate, TZ } = require('../lib/tz');

const WAITWHILE_BASE = 'https://api.waitwhile.com/v2';
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DEBUG = process.env.DEBUG === 'true';

function validId(req, res) {
  if (!ID_RE.test(req.params.id)) {
    res.status(400).json({ error: 'Invalid booking id' });
    return false;
  }
  return true;
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
router.get('/', async (req, res) => {
  try {
    const fromDate = getLocalDate(0);
    const toDate   = getLocalDate(365);

    const [visits, services] = await Promise.all([getVisits(fromDate, toDate), getCachedServices()]);

    const bookings = visits
      .filter(v => {
        const state = (v.state || '').toUpperCase();
        return state !== 'CANCELLED' && state !== 'NOSHOW';
      })
      .map(v => parseVisit(v, services));

    res.json(bookings);
  } catch (err) {
    console.error('[GET /bookings] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// ── POST /bookings/create ─────────────────────────────────────
// Body: { services: [ids], client: { name, phone }, startTime, duration, address?, price?, notes? }
router.post('/create', async (req, res) => {
  try {
    const { services: serviceIds, client, startTime, address, price, notes } = req.body || {};

    if (!client?.name || typeof client.name !== 'string' || client.name.length > 120) {
      return res.status(400).json({ error: 'Valid client name is required' });
    }
    if (client.phone && (typeof client.phone !== 'string' || client.phone.length > 20)) {
      return res.status(400).json({ error: 'Invalid phone' });
    }
    if (startTime && isNaN(Date.parse(startTime))) {
      return res.status(400).json({ error: 'Invalid startTime' });
    }
    if (serviceIds && (!Array.isArray(serviceIds) || !serviceIds.every(s => ID_RE.test(s)))) {
      return res.status(400).json({ error: 'Invalid service ids' });
    }

    const customFields = toCustomFields({ address, price, notes });

    const visit = await createVisit({ services: serviceIds, client, startTime, customFields });
    broadcast('booking_created', { visitId: visit.id });
    res.json({ success: true, visit });
  } catch (err) {
    console.error('[POST /bookings/create] Error:', err.message);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// ── State transitions ─────────────────────────────────────────
router.post('/:id/confirm', async (req, res) => {
  if (!validId(req, res)) return;
  try {
    const visit = await confirmVisit(req.params.id);
    broadcast('booking_update', { visitId: req.params.id, state: 'BOOKED' });
    res.json({ success: true, visit });
  } catch (err) {
    console.error(`[confirm ${req.params.id}]`, err.message);
    res.status(500).json({ error: 'Failed to confirm booking' });
  }
});

router.post('/:id/complete', async (req, res) => {
  if (!validId(req, res)) return;
  try {
    const visit = await completeVisit(req.params.id);
    broadcast('booking_update', { visitId: req.params.id, state: 'COMPLETE' });
    res.json({ success: true, visit });
  } catch (err) {
    console.error(`[complete ${req.params.id}]`, err.message);
    res.status(500).json({ error: 'Failed to complete booking' });
  }
});

router.post('/:id/cancel', async (req, res) => {
  if (!validId(req, res)) return;
  try {
    const visit = await cancelVisit(req.params.id);
    broadcast('booking_cancelled', { visitId: req.params.id });
    res.json({ success: true, visit });
  } catch (err) {
    console.error(`[cancel ${req.params.id}]`, err.message);
    res.status(500).json({ error: 'Failed to cancel booking' });
  }
});

// ── POST /bookings/:id/edit ───────────────────────────────────
// Body: { phone?, startTime?, duration? (minutes), services?, address?, price?, notes? }
router.post('/:id/edit', async (req, res) => {
  if (!validId(req, res)) return;
  try {
    const { id } = req.params;
    const { phone, startTime, duration, services, address, price } = req.body || {};

    const visitBody = {};

    if (startTime) {
      if (isNaN(Date.parse(startTime))) return res.status(400).json({ error: 'Invalid startTime' });
      const dt  = new Date(startTime);
      const fmt = new Intl.DateTimeFormat('en-AU', {
        timeZone: TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      });
      const parts = {};
      fmt.formatToParts(dt).forEach(p => { if (p.type !== 'literal') parts[p.type] = p.value; });
      visitBody.date = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    }

    if (duration !== undefined) {
      const mins = Number(duration);
      if (!Number.isFinite(mins) || mins < 5 || mins > 720) {
        return res.status(400).json({ error: 'duration must be 5–720 minutes' });
      }
      visitBody.duration = mins * 60;
    }

    if (services) {
      if (!Array.isArray(services) || !services.every(s => ID_RE.test(s))) {
        return res.status(400).json({ error: 'Invalid service ids' });
      }
      if (services.length > 0) visitBody.serviceIds = services;
    }

    if (phone) {
      if (typeof phone !== 'string' || phone.length > 20) return res.status(400).json({ error: 'Invalid phone' });
      visitBody.phone = phone;
    }

    const customFields = toCustomFields({ address, price });
    if (customFields.length > 0) visitBody.dataFields = customFields;

    if (DEBUG) console.log(`[edit ${id}] Sending:`, JSON.stringify(visitBody)); // PII — debug only

    const apiRes = await fetch(`${WAITWHILE_BASE}/visits/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': process.env.WAITWHILE_API_KEY },
      body: JSON.stringify(visitBody),
    });

    if (!apiRes.ok) {
      console.error(`[edit ${id}] Waitwhile error:`, apiRes.status, await apiRes.text());
      return res.status(502).json({ error: 'Failed to update booking' });
    }

    const data = await apiRes.json();
    broadcast('booking_update', { visitId: id });
    res.json(data);
  } catch (err) {
    console.error('[POST /bookings/:id/edit]', err.message);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

module.exports = router;
