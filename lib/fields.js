/**
 * Waitwhile custom-field IDs — single source of truth, server-side only.
 * The frontend sends semantic keys ({ address, price, notes }); the server maps them.
 * Whitelisting here means the API can never be used to write arbitrary fields.
 */

const FIELD_IDS = {
  address: 'Tsg5TJ2XhBD523zVvenw',
  price:   'ZCuDrgB7eDIpoDxDV90v',
  notes:   'EsyazvahjsF62K862TEy',
};

/**
 * Convert { address, price, notes } -> Waitwhile customFields array.
 * Ignores unknown keys. Coerces values to trimmed strings, caps length.
 */
function toCustomFields(obj = {}) {
  const out = [];
  for (const [key, id] of Object.entries(FIELD_IDS)) {
    if (obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim() !== '') {
      out.push({ id, values: [String(obj[key]).trim().slice(0, 500)] });
    }
  }
  return out;
}

module.exports = { FIELD_IDS, toCustomFields };
