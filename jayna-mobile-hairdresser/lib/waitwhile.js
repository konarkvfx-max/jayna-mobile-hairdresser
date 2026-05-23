/**
 * Waitwhile API wrapper
 * Handles: fetching bookings, services, confirming, cancelling, creating visits
 * API docs: https://developers.waitwhile.com/reference
 */

const WAITWHILE_BASE = 'https://api.waitwhile.com/v2';

function headers() {
  return {
    'Content-Type': 'application/json',
    'apikey': process.env.WAITWHILE_API_KEY,
  };
}

// ── Address field ID (hardcoded per Jayna's Waitwhile setup) ──
const ADDRESS_FIELD_ID = 'Tsg5TJ2XhBD523zVvenw';

// ── Fetch all visits for a location within a date range ──────
async function getVisits(fromDate, toDate) {
  const params = new URLSearchParams({
    locationId: process.env.WAITWHILE_LOCATION_ID,
    fromDate,
    toDate,
    state: 'all',
    limit: '100',
  });

  const res = await fetch(`${WAITWHILE_BASE}/visits?${params}`, {
    headers: headers(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Waitwhile GET /visits failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.results || data || [];
}

// ── Fetch service catalogue for the location ─────────────────
async function getServices() {
  const res = await fetch(
    `${WAITWHILE_BASE}/locations/${process.env.WAITWHILE_LOCATION_ID}/services`,
    { headers: headers() }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Waitwhile GET /services failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.results || data || [];
}

// ── Confirm a pending visit ──────────────────────────────────
async function confirmVisit(visitId) {
  const res = await fetch(`${WAITWHILE_BASE}/visits/${visitId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ state: 'BOOKED' }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Waitwhile PATCH /visits/${visitId} failed (${res.status}): ${body}`);
  }

  return res.json();
}

// ── Cancel a visit ───────────────────────────────────────────
async function cancelVisit(visitId) {
  const res = await fetch(`${WAITWHILE_BASE}/visits/${visitId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ state: 'CANCELLED' }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Waitwhile PATCH /visits/${visitId} (cancel) failed (${res.status}): ${body}`);
  }

  return res.json();
}

// ── Create a new visit ───────────────────────────────────────
async function createVisit({ services, client, startTime, customFields }) {
  const body = {
    locationId: process.env.WAITWHILE_LOCATION_ID,
    serviceIds: services || [],
    firstName: client?.name || 'Walk-in',
    phone: client?.phone || '',
    startTime,
    state: 'PENDING',
    dataFields: customFields || [],
  };

  const res = await fetch(`${WAITWHILE_BASE}/visits`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Waitwhile POST /visits failed (${res.status}): ${errBody}`);
  }

  return res.json();
}

// ── Parse a Waitwhile visit into our frontend-friendly shape ─
function parseVisit(visit, serviceCatalogue = []) {
  const name = [visit.firstName, visit.lastName].filter(Boolean).join(' ') || 'Client';
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  // Extract address from dataFields
  let address = '';
  if (visit.dataFields && Array.isArray(visit.dataFields)) {
    const addrField = visit.dataFields.find(f => f.id === ADDRESS_FIELD_ID);
    if (addrField && addrField.values && addrField.values.length > 0) {
      address = addrField.values[0];
    }
  }

  // Resolve service names and prices from catalogue
  const serviceNames = [];
  let totalPrice = 0;
  if (visit.serviceIds && Array.isArray(visit.serviceIds)) {
    for (const sid of visit.serviceIds) {
      const svc = serviceCatalogue.find(s => s.id === sid);
      if (svc) {
        serviceNames.push(svc.name);
        totalPrice += svc.price || 0;
      }
    }
  }
  if (serviceNames.length === 0) {
    serviceNames.push(visit.serviceName || 'Service');
  }

  // Parse start/end times into Adelaide local
  const startDt = visit.startTime ? new Date(visit.startTime) : new Date();
  const endDt = visit.endTime ? new Date(visit.endTime) : new Date(startDt.getTime() + (visit.duration || 60) * 60000);

  const fmt = (dt, opts) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Adelaide', ...opts }).format(dt);

  const dateParts = {};
  new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Adelaide', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(startDt).forEach(p => { if (p.type !== 'literal') dateParts[p.type] = p.value; });
  const dateIso = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;

  const timeStr = fmt(startDt, { hour: '2-digit', minute: '2-digit', hour12: false });
  const timeEndStr = fmt(endDt, { hour: '2-digit', minute: '2-digit', hour12: false });

  // Avatar tone — consistent per name
  const tones = ['#E8DFD2', '#D2E0E8', '#DDE8D2', '#E8D2D2', '#D8D2E8', '#E8E0D2', '#D2E8E0'];
  const toneIdx = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % tones.length;

  // Status mapping
  const state = (visit.state || '').toUpperCase();
  let status = 'confirmed';
  if (state === 'PENDING' || state === 'WAITING') status = 'pending';
  else if (state === 'CANCELLED' || state === 'NOSHOW') status = 'cancelled';

  // Extract notes from extra dataFields
  const getField = (label) => {
    if (!visit.dataFields) return '';
    const f = visit.dataFields.find(df => (df.label || '').toLowerCase().includes(label.toLowerCase()));
    return f?.values?.[0] || '';
  };

  return {
    id: visit.id,
    client: name,
    initials,
    avatarTone: tones[toneIdx],
    services: serviceNames,
    duration: visit.duration || Math.round((endDt - startDt) / 60000),
    price: totalPrice || visit.orderValue || 0,
    date: dateIso,
    time: timeStr,
    timeEnd: timeEndStr,
    address,
    phone: visit.phone || '',
    notes: visit.note || '',
    hairDescription: getField('hair'),
    colourHistory: getField('colour'),
    mobilityNeeds: getField('mobility'),
    extraNotes: getField('extra'),
    status,
    state: visit.state,
  };
}

module.exports = {
  getVisits,
  getServices,
  confirmVisit,
  cancelVisit,
  createVisit,
  parseVisit,
  ADDRESS_FIELD_ID,
};
