// Strict loading of the collector's saved state (public/data/state.json).
//
// Before: a missing, cut-off or corrupt state silently became an empty one (`readJson(path, { items: [] })`), and
// that run then published and saved the empty state over the radar's memory. Now any such state stops the run with
// a StateError before collection, notifications, state writes or publication.
//
// Only what the collector needs without a fallback is required (src/collect.js uses every other field as
// `state.x || default`): `items` must be an array of articles, each with a string id (the dedupe key), a string link
// (src/sport5.js calls link.replace), a string title (clustering tokenises it) and a finite published time (the
// 48-hour expiry; a missing one would silently drop the article). Checked against the saved production state of
// 2026-10-20: 52,118 articles, no violations.
//
// Error messages name the rule and the article index only, never content or identifiers.
import { readFile } from 'node:fs/promises';

export class StateError extends Error {
  constructor(code, detail) {
    super(`state ${code}${detail ? `: ${detail}` : ''}`);
    this.code = code; // missing | read | parse | shape
  }
}

export function validateState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new StateError('shape', 'not an object');
  if (!Array.isArray(s.items)) throw new StateError('shape', 'items is not an array');
  for (let i = 0; i < s.items.length; i++) {
    const it = s.items[i];
    if (!it || typeof it !== 'object') throw new StateError('shape', `items[${i}] is not an object`);
    if (typeof it.id !== 'string' || !it.id) throw new StateError('shape', `items[${i}].id`);
    if (typeof it.link !== 'string') throw new StateError('shape', `items[${i}].link`);
    if (typeof it.title !== 'string') throw new StateError('shape', `items[${i}].title`);
    if (!Number.isFinite(it.published)) throw new StateError('shape', `items[${i}].published`);
  }
  return s;
}

export function parseState(text) {
  if (!String(text).trim()) throw new StateError('parse', 'empty file');
  let s;
  try {
    s = JSON.parse(text);
  } catch {
    throw new StateError('parse', 'not valid JSON (truncated or corrupt)');
  }
  return validateState(s);
}

export async function loadStateStrict(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    throw new StateError(e.code === 'ENOENT' ? 'missing' : 'read', e.code === 'ENOENT' ? 'no state file' : 'cannot read the state file');
  }
  return parseState(text);
}

// Warning only: how old the restored state is. An old state is still valid (articles past 48 hours expire as usual).
export function stateAgeNote(s, now = Date.now()) {
  if (!Number.isFinite(s.savedAt)) return 'state: no savedAt (warning only)';
  const h = (now - s.savedAt) / 3600e3;
  return h > 1 ? `state: restored state is ${Math.round(h)} h old (warning only)` : null;
}

// Diagnostic only (never blocks): of the articles the restored state held that are still inside the collector's
// expiry window at the collector's own `now`, how many are in the state about to be saved. Same rule as
// src/collect.js (now - published <= keep), applied to a baseline captured at load. Counts only.
export function survivorDiagnostic(baseline, nextItems, now, keepMs) {
  const next = new Set(nextItems.map((i) => i.id));
  const inWindow = baseline.filter((b) => now - b.published <= keepMs);
  const kept = inWindow.filter((b) => next.has(b.id)).length;
  const pct = inWindow.length ? Math.round((1000 * kept) / inWindow.length) / 10 : 100;
  return { inWindow: inWindow.length, kept, pct, text: `state survivors (diagnostic): ${kept} of ${inWindow.length} in-window articles kept (${pct}%)` };
}
