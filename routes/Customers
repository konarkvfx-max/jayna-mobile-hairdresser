/**
 * Customers routes
 * PATCH /customers/:id/notes — update customer custom fields (notes)
 */

const express = require('express');
const router = express.Router();

const WAITWHILE_BASE = 'https://api.waitwhile.com/v2';

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
