/**
 * Customers routes (hardened)
 * GET   /customers           — customer list (auth required upstream)
 * PATCH /customers/:id/notes — notes ONLY. Body: { notes: "..." }
 *
 * The old version forwarded req.body verbatim to Waitwhile — an authenticated
 * API proxy. This version whitelists exactly one field.
 */

const express = require('express');
const router  = express.Router();
const { getCustomers } = require('../lib/waitwhile');
const { FIELD_IDS } = require('../lib/fields');

const WAITWHILE_BASE = 'https://api.waitwhile.com/v2';
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

let cachedCustomers   = null;
let customersCachedAt = 0;
const CACHE_TTL       = 5 * 60 * 1000;

router.get('/', async (req, res) => {
  try {
    const now = Date.now();
    if (cachedCustomers && (now - customersCachedAt) < CACHE_TTL) {
      return res.json(cachedCustomers);
    }
    const customers   = await getCustomers();
    cachedCustomers   = customers;
    customersCachedAt = now;
    res.json(customers);
  } catch (err) {
    console.error('[GET /customers] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

router.patch('/:id/notes', async (req, res) => {
  try {
    const { id } = req.params;
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'Invalid customer id' });

    const notes = req.body?.notes;
    if (typeof notes !== 'string' || notes.length > 2000) {
      return res.status(400).json({ error: 'notes must be a string (max 2000 chars)' });
    }

    // Server maps semantic field -> Waitwhile field ID. Nothing else passes through.
    const body = { customFields: [{ id: FIELD_IDS.notes, values: [notes.trim()] }] };

    const apiRes = await fetch(`${WAITWHILE_BASE}/customers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': process.env.WAITWHILE_API_KEY },
      body: JSON.stringify(body),
    });
    if (!apiRes.ok) {
      console.error('[PATCH /customers/:id/notes] Waitwhile error:', apiRes.status, await apiRes.text());
      return res.status(502).json({ error: 'Failed to update notes' });
    }
    res.json(await apiRes.json());
  } catch (err) {
    console.error('[PATCH /customers/:id/notes]', err.message);
    res.status(500).json({ error: 'Failed to update notes' });
  }
});

module.exports = router;
