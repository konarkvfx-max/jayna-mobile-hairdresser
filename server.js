require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());

// Webhook route needs raw body for HMAC verification
app.use('/webhook', express.raw({ type: '*/*' }));
app.use(express.json());

const PORT = process.env.PORT || 3001;
const WAITWHILE_API_KEY = process.env.WAITWHILE_API_KEY;
const WAITWHILE_LOCATION_ID = process.env.WAITWHILE_LOCATION_ID;
const WAITWHILE_WEBHOOK_SECRET = process.env.WAITWHILE_WEBHOOK_SECRET;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

const AVATAR_TONES = ['#E8DFD2', '#D8DFD7', '#EBD9C6', '#DDD3E0', '#E0DACB', '#D6DDD5'];

// Services catalogue cache: { [serviceId]: { name, price } }
// Refreshed every 60 minutes so new services Jayna adds are picked up without restart
let serviceCatalogue = null;

function scheduleServiceRefresh() {
  setTimeout(() => {
    serviceCatalogue = null;
    scheduleServiceRefresh();
  }, 60 * 60 * 1000);
}

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  ws.on('close', () => console.log('WebSocket client disconnected'));
});

function broadcast(payload) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(payload));
    }
  });
}

// Returns today's date as YYYY-MM-DD in AEST (Brisbane)
function getTodayAEST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(new Date());
}

// Returns YYYY-MM-DD for N days from now in AEST
function getFutureDateAEST(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(d);
}

async function waitwhileFetch(path, options = {}) {
  const url = `https://api.waitwhile.com/v2${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'apikey': WAITWHILE_API_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Waitwhile API error: ${response.status} ${text}`);
  }
  return response.json();
}

async function getServiceCatalogue() {
  if (serviceCatalogue) return serviceCatalogue;
  try {
    const data = await waitwhileFetch(`/services?locationId=${WAITWHILE_LOCATION_ID}`);
    const services = data.results || data || [];
    serviceCatalogue = {};
    for (const s of services) {
      serviceCatalogue[s.id] = { name: s.name || s.id, price: s.price || 0, duration: s.duration || 3600 };
    }
    scheduleServiceRefresh();
    console.log(`Loaded ${services.length} services from catalogue`);
  } catch (err) {
    console.error('Failed to fetch service catalogue:', err.message);
    serviceCatalogue = {};
  }
  return serviceCatalogue;
}

// Real Waitwhile visit shape:
// - date: "2026-05-29T15:00" (local AEST, no timezone suffix)
// - duration: seconds (not minutes)
// - state: "BOOKED" | "PENDING" | "SERVING" | "COMPLETE" | "EXPIRED" | "CANCELLED"
// - services: { [serviceId]: quantity } — names fetched separately
// - orderValue: { currency, value } — price
// - dataFields: [{ id, values: [address] }]
// - type: "BOOKING" | "BLOCK" — skip BLOCK
function mapVisitToBooking(visit, index, catalogue) {
  const firstName = visit.firstName || '';
  const lastName = visit.lastName || '';
  const client = `${firstName} ${lastName}`.trim() || visit.name || 'Unknown';
  const initials = (firstName.charAt(0) + lastName.charAt(0)).toUpperCase() || 'XX';
  const avatarTone = AVATAR_TONES[index % AVATAR_TONES.length];

  // date field: "2026-05-29T15:00" — split on T
  const [dateStr, timeStr] = (visit.date || '').split('T');

  // Calculate timeEnd by adding duration (seconds) to start time
  let timeEndStr = '';
  if (timeStr && visit.duration) {
    const [h, m] = timeStr.split(':').map(Number);
    const totalMinutes = h * 60 + m + Math.round(visit.duration / 60);
    const endH = Math.floor(totalMinutes / 60) % 24;
    const endM = totalMinutes % 60;
    timeEndStr = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
  }

  const durationMinutes = Math.round((visit.duration || 0) / 60);

  // services map: { serviceId: qty } — look up names and prices from catalogue
  const serviceIds = Object.keys(visit.services || {});
  const serviceLabels = serviceIds.map(id => catalogue[id]?.name || id);

  // Sum service prices from catalogue; fall back to orderValue (deposit) if catalogue has no prices
  const catalogueTotal = serviceIds.reduce((sum, id) => sum + (catalogue[id]?.price || 0), 0);
  const price = catalogueTotal > 0 ? catalogueTotal : (visit.orderValue?.value || 0);

  // Address and extra client fields live in dataFields in order
  const address          = visit.dataFields?.[0]?.values?.[0] || '';
  const hairDescription  = visit.dataFields?.[1]?.values?.[0] || '';
  const colourHistory    = visit.dataFields?.[2]?.values?.[0] || '';
  const mobilityNeeds    = visit.dataFields?.[3]?.values?.[0] || '';
  const extraNotes       = visit.dataFields?.[4]?.values?.[0] || '';

  const phone = visit.phone || '';
  const notes = visit.notes || '';

  // state → status mapping
  const state = visit.state || '';
  let status = 'pending';
  if (state === 'BOOKED' || state === 'SERVING') status = 'confirmed';

  const today = getTodayAEST();
  const when = dateStr === today ? 'today' : 'upcoming';

  return {
    id: visit.id,
    client,
    initials,
    avatarTone,
    services: serviceLabels,
    duration: durationMinutes,
    price,
    date: dateStr,
    time: timeStr ? timeStr.substring(0, 5) : '',
    timeEnd: timeEndStr,
    address,
    phone,
    notes,
    hairDescription,
    colourHistory,
    mobilityNeeds,
    extraNotes,
    status,
    when,
  };
}

// Fetch all visits, filter to active bookings in date range
async function fetchBookings(fromDate, toDate) {
  const data = await waitwhileFetch(`/visits?locationId=${WAITWHILE_LOCATION_ID}`);
  const visits = data.results || [];
  const catalogue = await getServiceCatalogue();

  const activeStates = new Set(['BOOKED', 'PENDING', 'SERVING']);

  return visits
    .filter(v => {
      if (v.type !== 'BOOKING') return false;
      if (!activeStates.has(v.state)) return false;
      if (!v.date) return false;
      const dateStr = v.date.split('T')[0];
      if (fromDate && dateStr < fromDate) return false;
      if (toDate && dateStr > toDate) return false;
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((v, i) => mapVisitToBooking(v, i, catalogue));
}

async function getDriveTime(origin, destination) {
  if (!origin || !destination || !GOOGLE_MAPS_API_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&key=${GOOGLE_MAPS_API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK') return null;
    return {
      durationText: element.duration.text,
      durationSeconds: element.duration.value,
    };
  } catch {
    return null;
  }
}

// POST /webhook
app.post('/webhook', (req, res) => {
  try {
    const signature = req.headers['x-waitwhile-hmac-sha256'];
    const body = req.body;

    if (WAITWHILE_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', WAITWHILE_WEBHOOK_SECRET)
        .update(body)
        .digest('hex');
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const event = JSON.parse(body.toString());
    console.log('Webhook received:', event.type);
    broadcast({ type: event.type, data: event });
    // Invalidate catalogue cache on any webhook so service changes are picked up
    serviceCatalogue = null;
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /bookings — today + next 30 days
app.get('/bookings', async (req, res) => {
  try {
    const today = getTodayAEST();
    const endDate = getFutureDateAEST(30);
    const bookings = await fetchBookings(today, endDate);
    res.json(bookings);
  } catch (error) {
    console.error('GET /bookings error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /schedule — accepts optional ?date=YYYY-MM-DD, defaults to today AEST
app.get('/schedule', async (req, res) => {
  try {
    const date = req.query.date || getTodayAEST();
    const bookings = await fetchBookings(date, date);
    res.json(bookings);
  } catch (error) {
    console.error('GET /schedule error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /bookings/:id/confirm — move PENDING → BOOKED
app.post('/bookings/:id/confirm', async (req, res) => {
  try {
    await waitwhileFetch(`/visits/${req.params.id}`, {
      method: 'PUT',
      body: JSON.stringify({ state: 'BOOKED' }),
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Confirm error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /bookings/:id/cancel — move to CANCELLED
app.post('/bookings/:id/cancel', async (req, res) => {
  try {
    await waitwhileFetch(`/visits/${req.params.id}`, {
      method: 'PUT',
      body: JSON.stringify({ state: 'CANCELLED' }),
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Cancel error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /drive-time?origin=ADDRESS&destination=ADDRESS
app.get('/drive-time', async (req, res) => {
  const { origin, destination } = req.query;
  if (!origin || !destination) return res.json(null);
  res.json(await getDriveTime(origin, destination));
});

// GET /schedule-with-drive-times — accepts optional ?date=YYYY-MM-DD, defaults to today AEST
app.get('/schedule-with-drive-times', async (req, res) => {
  try {
    const date = req.query.date || getTodayAEST();
    const bookings = await fetchBookings(date, date);

    if (bookings.length === 0) return res.json([]);

    const withDriveTimes = await Promise.all(
      bookings.map(async (booking, index) => {
        if (index === 0) return { ...booking, driveTime: null, hasConflict: false };

        const prev = bookings[index - 1];
        const driveTime = await getDriveTime(prev.address, booking.address);

        let hasConflict = false;
        if (driveTime) {
          // Gap = time between end of prev and start of this booking (in seconds)
          const [ph, pm] = prev.timeEnd.split(':').map(Number);
          const [ch, cm] = booking.time.split(':').map(Number);
          const gapSeconds = (ch * 60 + cm - (ph * 60 + pm)) * 60;
          hasConflict = gapSeconds < driveTime.durationSeconds + 600;
        }

        return { ...booking, driveTime, hasConflict };
      })
    );

    res.json(withDriveTimes);
  } catch (error) {
    console.error('GET /schedule-with-drive-times error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /services — service catalogue for new booking form
app.get('/services', async (req, res) => {
  try {
    const catalogue = await getServiceCatalogue();
    const services = Object.entries(catalogue)
      .filter(([, svc]) => svc.price > 0)
      .map(([id, svc]) => ({ id, name: svc.name, price: svc.price, duration: svc.duration }));
    res.json(services);
  } catch (error) {
    console.error('GET /services error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /bookings/create — create a new visit in Waitwhile
app.post('/bookings/create', async (req, res) => {
  try {
    const { firstName, lastName, phone, address, serviceId, date, startTime } = req.body;
    const catalogue = await getServiceCatalogue();
    const svc = catalogue[serviceId];
    const duration = svc ? svc.duration : 3600;

    const [h, m] = startTime.split(':').map(Number);
    const totalSecs = h * 3600 + m * 60 + duration;
    const endH = Math.floor(totalSecs / 3600) % 24;
    const endM = Math.floor((totalSecs % 3600) / 60);
    const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

    const visit = await waitwhileFetch('/visits', {
      method: 'POST',
      body: JSON.stringify({
        locationId: WAITWHILE_LOCATION_ID,
        firstName,
        lastName: lastName || '',
        phone,
        serviceIds: [serviceId],
        startTime: `${date}T${startTime}`,
        endTime: `${date}T${endTime}`,
        state: 'BOOKED',
        dataFields: [{ id: 'Tsg5TJ2XhBD523zVvenw', values: [address] }],
      }),
    });

    res.json({ success: true, id: visit.id });
  } catch (error) {
    console.error('POST /bookings/create error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /block — block a time slot in Waitwhile
app.post('/block', async (req, res) => {
  try {
    const { date, startTime, endTime, note } = req.body;
    await waitwhileFetch('/visits', {
      method: 'POST',
      body: JSON.stringify({
        locationId: WAITWHILE_LOCATION_ID,
        type: 'BLOCK',
        startTime: `${date}T${startTime}`,
        endTime: `${date}T${endTime}`,
        notes: note || '',
      }),
    });
    res.json({ success: true });
  } catch (error) {
    console.error('POST /block error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
