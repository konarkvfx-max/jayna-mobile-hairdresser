/**
 * Services route
 * GET /services — returns the service catalogue from Waitwhile
 */

const express = require('express');
const router = express.Router();
const { getServices } = require('../lib/waitwhile');

router.get('/', async (req, res) => {
  try {
    const services = await getServices();

    // Map to a clean shape for the frontend
    const catalogue = services.map(s => ({
      id: s.id,
      name: s.name,
      price: s.price || 0,
      duration: s.duration || 60,
      description: s.description || '',
    }));

    res.json(catalogue);
  } catch (err) {
    console.error('[GET /services] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch services', detail: err.message });
  }
});

module.exports = router;
