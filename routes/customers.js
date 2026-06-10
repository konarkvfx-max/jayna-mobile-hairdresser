/**
 * Customers routes
 * GET  /customers         — fetch all customers from Waitwhile
 * PATCH /customers/:id/notes — update customer custom fields (notes)
 */

const express = require('express');
const router = express.Router();

const WAITWHILE_BASE = 'https://api.waitwhile.com/v2';

// ── GET /customers — fetch all customers from Waitwhile ────────
router.get('/', async (req, res) => {
  try {
    const params = new URLSearchParams({
      locationId: process.env.WAITWHILE_LOCATION_ID,
      limit: '100',
    });

    const apiRes = await fetch(`${WAITWHILE_BASE}/customers?${params}`, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.WAITWHILE_API_KEY,
      },
    });

    if (!apiRes.ok) {
      const errBody = await apiRes.text();
      throw new Error(`Waitwhile GET /customers failed (${apiRes.status}): ${errBody}`);
    }

    const data = await apiRes.json();
    const customers = (data.results || data || []).map(c => ({
      id: c.id,
      name: [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Client',
      phone: c.phone || '',
      email: c.email || '',
      lastVisit: c.lastVisitDate || null,
    }));

    res.json(customers);
  } catch (err) {
    console.error('[GET /customers] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch customers', detail: err.message });
  }
});


// ── PATCH /customers/:id/notes ───────────────────────────────
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
