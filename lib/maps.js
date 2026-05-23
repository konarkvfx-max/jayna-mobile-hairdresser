/**
 * Google Maps Distance Matrix API wrapper
 * Calculates drive time between consecutive appointment addresses
 */

const MAPS_BASE = 'https://maps.googleapis.com/maps/api/distancematrix/json';

// Drive time conflict threshold (seconds) — flag if drive time > buffer
const CONFLICT_THRESHOLD_SECONDS = 30 * 60; // 30 minutes

/**
 * Get drive time between two addresses
 * Returns { durationText, durationSeconds } or null on failure
 */
async function getDriveTime(origin, destination) {
  if (!origin || !destination || !process.env.GOOGLE_MAPS_API_KEY) {
    return null;
  }

  try {
    const params = new URLSearchParams({
      origins: origin,
      destinations: destination,
      key: process.env.GOOGLE_MAPS_API_KEY,
      units: 'metric',
      region: 'au',
    });

    const res = await fetch(`${MAPS_BASE}?${params}`);
    if (!res.ok) return null;

    const data = await res.json();
    if (data.status !== 'OK') return null;

    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK') return null;

    return {
      durationText: element.duration.text,
      durationSeconds: element.duration.value,
      distanceText: element.distance?.text || '',
      distanceMeters: element.distance?.value || 0,
    };
  } catch (err) {
    console.error('Google Maps API error:', err.message);
    return null;
  }
}

/**
 * Calculate drive times between consecutive bookings
 * Mutates each booking to add driveTime and hasConflict fields
 */
async function addDriveTimesToSchedule(bookings) {
  if (!bookings || bookings.length < 2) {
    // Single or no bookings — no drive time needed
    bookings.forEach(b => {
      b.driveTime = null;
      b.hasConflict = false;
    });
    return bookings;
  }

  // First booking has no drive time
  bookings[0].driveTime = null;
  bookings[0].hasConflict = false;

  for (let i = 1; i < bookings.length; i++) {
    const prev = bookings[i - 1];
    const curr = bookings[i];

    if (prev.address && curr.address) {
      const dt = await getDriveTime(prev.address, curr.address);
      curr.driveTime = dt;

      if (dt) {
        // Check conflict: does drive time exceed the gap between appointments?
        const prevEnd = timeToMinutes(prev.timeEnd);
        const currStart = timeToMinutes(curr.time);
        const gapMinutes = currStart - prevEnd;
        const driveMinutes = Math.ceil(dt.durationSeconds / 60);
        curr.hasConflict = driveMinutes > gapMinutes;
      } else {
        curr.hasConflict = false;
      }
    } else {
      curr.driveTime = null;
      curr.hasConflict = false;
    }
  }

  return bookings;
}

/**
 * Convert "HH:MM" to minutes since midnight
 */
function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

module.exports = {
  getDriveTime,
  addDriveTimesToSchedule,
  CONFLICT_THRESHOLD_SECONDS,
};
