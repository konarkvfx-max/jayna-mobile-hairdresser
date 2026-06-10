/**
 * Customers routes
 * GET  /customers        — full customer list from Waitwhile (for search/autocomplete)
 * PATCH /customers/:id/notes — update customer custom fields (notes)
 */

const express = require('express');
const router  = require('express').Router();
const { getCustomers } = require('../lib/waitwhile');

const WAITWHILE_BASE = 'https://api.waitwhile.com/v2';

// ── Simple in-memory cache — rebuilds on restart (by design) ─
let cachedCustomers   = null;
let customersCachedAt = 0;
const CACHE_TTL       = 5 * 60 * 1000; // 5 minutes

// ── GET /customers ────────────────────────────────────────────
// Returns all Waitwhile customers, shaped for the frontend directory.
// Cached for 5 minutes — stale-on-restart is intentional (clears bad data).
router.get('/', async (req, res) => {
  try {
    const now = Date.now();
    if (cachedCustomers && (now - customersCachedAt) < CACHE_TTL) {
      return res.json(cachedCustomers);
    }

    const customers      = await getCustomers();
    cachedCustomers      = customers;
    customersCachedAt    = now;
    res.json(customers);
  } catch (err) {
    console.error('[GET /customers] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch customers', detail: err.message });
  }
});

// ── PATCH /customers/:id/notes ────────────────────────────────
router.patch('/:id/notes', async (req, res) => {
  try {
    const { id } = req.params;
    const apiRes = await fetch(`${WAITWHILE_BASE}/customers/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.WAITWHILE_API_KEY,
      },
      body: JSON.stringify(req.body),
    });
    if (!apiRes.ok) {
      const errBody = await apiRes.text();
      throw new Error(`Waitwhile customer PATCH failed (${apiRes.status}): ${errBody}`);
    }
    const data = await apiRes.json();
    res.json(data);
  } catch (err) {
    console.error('[PATCH /customers/:id/notes]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
