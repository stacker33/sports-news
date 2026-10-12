// Watchlist override rules, shared by the collector (src/watchlist.js, scripts/build-watchlist.mjs) and the
// watchlist page in the browser (watch.html). One place decides what a valid change is.
//
// config/watchlist-overrides.json:
//   { "entries":  { "<entry id>": { enabled?, priority?, langs?, until?, status?, israelLink?, note? } },
//     "families": { "<query family>": { enabled?, priority? } } }

export const PRIORITIES = ['high', 'normal', 'low'];
export const STATUSES = ['verified', 'pending', 'excluded'];
// Google News locales the collector supports (config/sources.js GN_LOCALES)
export const LOCALES = ['en', 'en-GB', 'he', 'es', 'it', 'de', 'fr', 'nl', 'pt', 'ro', 'sr', 'hu', 'el', 'tr', 'pl'];
export const FAMILIES = ['israeliAngle', 'exceptional'];
const ENTRY_FIELDS = new Set(['enabled', 'priority', 'langs', 'until', 'status', 'israelLink', 'note']);

// Is a temporary entry still active? (`until` = an ISO date or timestamp; no `until` = permanent)
export const activeNow = (o, now = Date.now()) => !o?.until || new Date(o.until).getTime() > now;

// → { ok, errors: [string], clean } - `clean` keeps only valid fields
export function validateOverrides(raw, knownIds = null) {
  const errors = [];
  const clean = { entries: {}, families: {} };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['not a JSON object'], clean };
  for (const [id, o] of Object.entries(raw.entries || {})) {
    if (knownIds && !knownIds.has(id)) {
      errors.push(`${id}: unknown entry`);
      continue;
    }
    if (!o || typeof o !== 'object') {
      errors.push(`${id}: not an object`);
      continue;
    }
    const c = {};
    for (const [k, v] of Object.entries(o)) {
      if (!ENTRY_FIELDS.has(k)) errors.push(`${id}: unknown field "${k}"`);
      else if (k === 'enabled' && typeof v !== 'boolean') errors.push(`${id}: enabled must be true or false`);
      else if (k === 'priority' && !PRIORITIES.includes(v)) errors.push(`${id}: priority must be ${PRIORITIES.join(' / ')}`);
      else if (k === 'langs' && (!Array.isArray(v) || !v.length || v.some((l) => !LOCALES.includes(l)))) errors.push(`${id}: langs must be a non-empty list of ${LOCALES.join(', ')}`);
      else if (k === 'until' && Number.isNaN(new Date(v).getTime())) errors.push(`${id}: until must be a date`);
      else if (k === 'status' && !STATUSES.includes(v)) errors.push(`${id}: status must be ${STATUSES.join(' / ')}`);
      else if (k === 'note' && typeof v !== 'string') errors.push(`${id}: note must be text`);
      else if (k === 'israelLink' && !(v && typeof v.basis === 'string' && v.basis && typeof v.note === 'string' && v.note.trim())) errors.push(`${id}: israelLink needs a basis and a note`);
      else c[k] = v;
    }
    // verifying a person needs a stated basis: nationality and links are never assumed
    if (c.status === 'verified' && !c.israelLink) {
      errors.push(`${id}: status "verified" needs israelLink { basis, note }`);
      delete c.status;
    }
    if (Object.keys(c).length) clean.entries[id] = c;
  }
  for (const [fam, o] of Object.entries(raw.families || {})) {
    if (!FAMILIES.includes(fam)) {
      errors.push(`family ${fam}: unknown (known: ${FAMILIES.join(', ')})`);
      continue;
    }
    const c = {};
    if ('enabled' in (o || {})) {
      if (typeof o.enabled === 'boolean') c.enabled = o.enabled;
      else errors.push(`family ${fam}: enabled must be true or false`);
    }
    if ('priority' in (o || {})) {
      if (PRIORITIES.includes(o.priority)) c.priority = o.priority;
      else errors.push(`family ${fam}: priority must be ${PRIORITIES.join(' / ')}`);
    }
    if (Object.keys(c).length) clean.families[fam] = c;
  }
  return { ok: errors.length === 0, errors, clean };
}
