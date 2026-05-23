/**
 * Waitwhile API wrapper
 * Handles: fetching bookings, services, confirming, cancelling, creating visits
 * API docs: https://developers.waitwhile.com/reference/listvisits.md
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

// ── Fetch visits for a single state ──────────────────────────
async function fetchVisitsByState(state, fromBookingDate, toBookingDate) {
  const params = new URLSearchParams({
    locationId: process.env.WAITWHILE_LOCATION_ID,
    fromBookingDate,  // YYYY-MM-DDThh:mm format
    toBookingDate,    // YYYY-MM-DDThh:mm format
    state,            // single value only: BOOKED, PENDING, WAITING, SERVING, COMPLETE, DRAFT
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
  return data.results || [];
}

// ── Fetch all active visits (BOOKED + DRAFT) in parallel ─────
// API only accepts one state at a time, so we make multiple calls
async function getVisits(fromDate, toDate) {
  // Convert ISO dates to YYYY-MM-DDThh:mm local format for booking date filter
  const fmt = (isoStr) => {
    const dt = new Date(isoStr);
    const adelaideFmt = new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Adelaide',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = {};
    adelaideFmt.formatToParts(dt).forEach(p => { if (p.type !== 'literal') parts[p.type] = p.value; });
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  };

  const from = fmt(fromDate);
  const to = fmt(toDate);

  // Fetch BOOKED and DRAFT in parallel (these are the relevant states for upcoming bookings)
  const [booked, draft] = await Promise.all([
    fetchVisitsByState('BOOKED', from, to).catch(() => []),
    fetchVisitsByState('DRAFT', from, to).catch(() => []),
  ]);

  // Deduplicate by id
  const seen = new Set();
  const all = [...booked, ...draft].filter(v => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });

  return all;
}

// ── Fetch service catalogue for the location ─────────────────
// Correct endpoint: GET /v2/services?locationId=X
async function getServices() {
  const params = new URLSearchParams({
    locationId: process.env.WAITWHILE_LOCATION_ID,
    limit: '100',
  });

  const res = await fetch(`${WAITWHILE_BASE}/services?${params}`, {
    headers: headers(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Waitwhile GET /services failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.results || data || [];
}

// ── Confirm a pending visit (DRAFT → BOOKED) ─────────────────
async function confirmVisit(visitId) {
  const res = await fetch(`${WAITWHILE_BASE}/visits/${visitId}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ state: 'BOOKED' }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Waitwhile POST /visits/${visitId} failed (${res.status}): ${body}`);
  }

  return res.json();
}

// ── Cancel a visit (add CANCELLED tag + set COMPLETE) ────────
async function cancelVisit(visitId) {
  const res = await fetch(`${WAITWHILE_BASE}/visits/${visitId}/cancel`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Waitwhile POST /visits/${visitId}/cancel failed (${res.status}): ${body}`);
  }

  return res.json();
}

// ── Create a new visit ────────────────────────────────────────
async function createVisit({ services, client, startTime, customFields }) {
  // Convert startTime to YYYY-MM-DDThh:mm format
  const dt = new Date(startTime);
  const adelaideFmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Adelaide',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = {};
  adelaideFmt.formatToParts(dt).forEach(p => { if (p.type !== 'literal') parts[p.type] = p.value; });
  const dateFormatted = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;

  const body = {
    locationId: process.env.WAITWHILE_LOCATION_ID,
    serviceIds: services || [],
    firstName: client?.name || 'Walk-in',
    phone: client?.phone || '',
    date: dateFormatted,           // YYYY-MM-DDThh:mm
    state: 'DRAFT',                // DRAFT = booking request (requires approval)
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

  // Parse booking date — Waitwhile returns 'date' as YYYY-MM-DDThh:mm local time
  // and duration in seconds
  let startDt, endDt;
  if (visit.date) {
    // visit.date is local time string in YYYY-MM-DDThh:mm — treat as Adelaide local
    // Append timezone offset for Adelaide (UTC+9:30 or UTC+10:30 DST)
    const localStr = visit.date; // e.g. "2026-05-24T09:00"
    startDt = new Date(localStr + ':00+09:30'); // ACST base (will be close enough)
    const durationSecs = visit.duration || 3600;
    endDt = new Date(startDt.getTime() + durationSecs * 1000);
  } else {
    startDt = new Date();
    endDt = new Date(startDt.getTime() + 3600000);
  }

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

  // Status mapping — state + tags
  const state = (visit.state || '').toUpperCase();
  const tags = (visit.tags || []).map(t => t.toUpperCase());
  let status = 'confirmed';
  if (state === 'DRAFT') status = 'pending';
  else if (state === 'WAITING' || state === 'SERVING') status = 'confirmed';
  else if (tags.includes('CANCELLED') || tags.includes('NO-SHOW')) status = 'cancelled';

  return {
    id: visit.id,
    client: name,
    initials,
    avatarTone: tones[toneIdx],
    services: serviceNames,
    duration: visit.duration ? Math.round(visit.duration / 60) : 60, // convert seconds to minutes
    price: totalPrice || (visit.orderValue ? visit.orderValue.value : 0),
    date: dateIso,
    time: timeStr,
    timeEnd: timeEndStr,
    address,
    phone: visit.phone || '',
    notes: visit.notes || '',
    status,
    state: visit.state,
    tags: visit.tags || [],
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
