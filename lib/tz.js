/**
 * Timezone helpers — correct DST handling via Intl (no hand-rolled day-of-year math).
 * TIMEZONE is configurable; defaults to Adelaide. Set TZ_NAME=Australia/Brisbane if needed.
 */

const TZ = process.env.TZ_NAME || 'Australia/Adelaide';

/**
 * Get the real UTC offset (e.g. "+10:30" or "+09:30") for a given local date/time
 * in the configured timezone. DST-correct for any year.
 */
function getOffset(dateStr, timeStr = '12:00') {
  // Build a rough UTC guess, then read the actual offset Intl reports for that instant
  const guess = new Date(`${dateStr}T${timeStr}:00Z`);
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ,
    timeZoneName: 'longOffset',
  });
  const part = fmt.formatToParts(guess).find(p => p.type === 'timeZoneName');
  // part.value looks like "GMT+10:30" or "GMT+10"
  const m = part.value.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return '+09:30'; // safe fallback
  const sign = m[1];
  const hh = m[2].padStart(2, '0');
  const mm = m[3] || '00';
  return `${sign}${hh}:${mm}`;
}

/**
 * Build an ISO-8601 local timestamp with the correct offset:
 * buildLocalTime('2026-07-06', '14:30') -> '2026-07-06T14:30:00+09:30'
 */
function buildLocalTime(dateStr, timeStr) {
  return `${dateStr}T${timeStr}:00${getOffset(dateStr, timeStr)}`;
}

/** Today's date (YYYY-MM-DD) in the configured timezone, offset by N days */
function getLocalDate(offsetDays = 0) {
  const shifted = new Date(Date.now() + offsetDays * 86400000);
  const parts = {};
  new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(shifted).forEach(p => { if (p.type !== 'literal') parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

module.exports = { getOffset, buildLocalTime, getLocalDate, TZ };
