/**
 * Schedule route
 * GET /schedule-with-drive-times?date=YYYY-MM-DD
 * Returns day's bookings sorted by time with drive times between consecutive appointments
 */

const express = require('express');
const router = express.Router();
const { getVisits, getServices, parseVisit } = require('../lib/waitwhile');
const { addDriveTimesToSchedule } = require('../lib/maps');

router.get('/', async (req, res) => {
  try {
    const date = req.query.date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' });
    }

    const [visits, services] = await Promise.all([
      getVisits(date, date),
      getServices(),
    ]);

    let bookings = visits
      .filter(v => {
        const state = (v.state || '').toUpperCase();
        return state !== 'CANCELLED' && state !== 'NOSHOW';
      })
      .map(v => parseVisit(v, services))
      .filter(b => b.date === date)
      .sort((a, b) => a.time.localeCompare(b.time));

    // Add drive times between consecutive bookings
    bookings = await addDriveTimesToSchedule(bookings);

    res.json(bookings);
  } catch (err) {
    console.error('[GET /schedule-with-drive-times] Error:', err.message);
    res.status(500).json({ error: 'Failed to build schedule', detail: err.message });
  }
});

module.exports = router;
