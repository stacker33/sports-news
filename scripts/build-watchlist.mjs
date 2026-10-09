// Build config/watchlist.json (and docs/watchlist-review.md) from the candidate corpus.
//   node scripts/build-watchlist.mjs
// Every candidate in config/watchlist-seed.json is checked against:
//   1. config/athletes.json - the editors' ליגיונרים list (already verified by editors)
//   2. config/watchlist-overrides.json - entries an editor confirmed or rejected by hand
//   3. public/data/entities.json - the 365Scores knowledge base (nationality, club, Hebrew name)
// Nothing is inferred: a candidate that is not found, or found without Israeli nationality,
// stays `pending` and never claims an Israel link.
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { norm, entryId, needsContext } from '../src/watchlist.js';
import { validateOverrides } from '../public/watchlist-rules.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = async (p, fallback) => {
  try {
    return JSON.parse(await readFile(join(ROOT, p), 'utf8'));
  } catch {
    return fallback;
  }
};

const seed = await read('config/watchlist-seed.json');
const athletes = await read('config/athletes.json', []);
// editor decisions, validated (an invalid change is reported and skipped, never half-applied)
const checked = validateOverrides(await read('config/watchlist-overrides.json', { entries: {} }));
for (const err of checked.errors) console.warn('override skipped:', err);
const overrides = checked.clean;
const kb = await read('public/data/entities.json', { players: {}, teams: {}, countries: {} });
const ISRAEL = 6;
const FRESH_DAYS = 45; // a club older than this in the knowledge base is reported as possibly stale

const players = Object.values(kb.players || {});
const teams = kb.teams || {};
const byName = new Map();
for (const p of players) {
  const k = norm(p.en);
  byName.set(k, [...(byName.get(k) || []), p]);
}
const teamsByName = new Map();
for (const t of Object.values(teams)) {
  const k = `${t.sport}|${norm(t.en)}`;
  teamsByName.set(k, [...(teamsByName.get(k) || []), t]);
}
const editors = new Map();
for (const a of athletes) for (const n of [a.name, ...(a.alt || [])]) if (/[a-z]/i.test(n) && n.includes(' ')) editors.set(norm(n), a);

const ISRAELI_CATS = new Set(['israeli-candidate', 'israeli-women-candidate']);
const entries = [];
const seen = new Set();
const day = (t) => (t ? new Date(t).toISOString().slice(0, 10) : null);

for (const g of seed.groups) {
  for (const raw of g.names) {
    const [name, ...aliases] = Array.isArray(raw) ? raw : [raw];
    const id = entryId(g.type, g.sport, name);
    if (seen.has(id)) continue; // listed twice in the brief
    seen.add(id);
    const e = { id, name, aliases, type: g.type, sport: g.sport, category: g.category, ...(g.women ? { women: true } : {}) };
    const keys = [name, ...aliases].map(norm);
    const ov = overrides.entries?.[id];

    if (g.type === 'club') {
      const t = keys.map((k) => teamsByName.get(`${g.sport}|${k}`)).find((l) => l?.length === 1)?.[0];
      if (t) Object.assign(e, { he: t.he, team: { id: t.id, en: t.en, he: t.he, country: t.country }, kb365: t.id });
      if (g.category === 'israeli-club') {
        e.status = t && t.country === ISRAEL ? 'verified' : 'pending';
        if (e.status === 'verified') e.israelLink = { basis: 'kb-club-country', note: `365Scores: club in Israel` };
        else e.why = t ? 'club found, country is not Israel' : 'club not found in the knowledge base';
      } else {
        e.status = 'source-only';
      }
      e.ambiguous = needsContext(name);
      if (e.ambiguous) e.context = [g.sport];
    } else {
      const ed = keys.map((k) => editors.get(k)).find(Boolean);
      const found = keys.map((k) => byName.get(k)).find((l) => l?.length) || [];
      // only players whose club plays this sport
      const sameSport = found.filter((p) => !teams[p.team] || teams[p.team].sport === g.sport || g.sport === 'other');
      const kbHit = sameSport.length === 1 ? sameSport[0] : null;
      if (kbHit) {
        const t = teams[kbHit.team];
        e.he = kbHit.he || '';
        e.kb365 = kbHit.id;
        if (t) {
          e.team = { id: t.id, en: t.en, he: t.he, country: t.country };
          e.squadAt = day(t.squadAt);
          if (t.squadAt && Date.now() - t.squadAt > FRESH_DAYS * 864e5) e.stale = true;
        }
      }
      e.ambiguous = needsContext(name, sameSport.length);
      if (e.ambiguous && sameSport.length > 1) e.why = `${sameSport.length} people with this name in the knowledge base`;
      if (ed) {
        e.he = ed.name_he || e.he;
        e.team = e.team || { en: ed.team, he: ed.team_he };
        e.editors = true;
      }
      if (g.category === 'world-star' || g.category === 'foreign-relevance-candidate') {
        e.status = 'source-only'; // recognition and ranking only - never labelled ex-Israel or Israel-linked
      } else if (ed && ISRAELI_CATS.has(g.category)) {
        e.status = 'verified';
        e.israelLink = { basis: 'editors-list', note: 'on the editors\' ליגיונרים list' };
      } else if (kbHit && kbHit.nat === ISRAEL && ISRAELI_CATS.has(g.category)) {
        e.status = 'verified';
        e.israelLink = { basis: 'kb-nationality', note: `365Scores nationality: Israel${e.squadAt ? `; squad data ${e.squadAt}` : ''}` };
      } else {
        e.status = 'pending';
        e.why = e.why || (kbHit ? (ISRAELI_CATS.has(g.category) ? 'found, but nationality is not Israel in the knowledge base' : 'role and Israel link need an editor') : 'not found in the knowledge base');
      }
    }
    if (e.ambiguous && !e.context) e.context = [];
    if (ov) {
      Object.assign(e, ov, { override: true });
      if (ov.status !== 'verified') delete e.israelLink;
    }
    entries.push(e);
  }
}

// the desk's focus list: mark the entries and add the editors' spellings as aliases
for (const [name, extra] of seed.focus?.names || []) {
  const hits = entries.filter((e) => e.name === name);
  if (!hits.length) console.warn('focus name not in the registry:', name);
  for (const e of hits) {
    e.focus = true;
    e.aliases = [...new Set([...e.aliases, ...extra])].filter((a) => norm(a) !== norm(e.name));
  }
}

const count = (s) => entries.filter((e) => e.status === s).length;
const out = { about: 'Generated by scripts/build-watchlist.mjs - edit config/watchlist-seed.json or config/watchlist-overrides.json, not this file.', builtAt: new Date().toISOString(), kbAt: day(kb.teamsAt), counts: { verified: count('verified'), pending: count('pending'), 'source-only': count('source-only') }, entries };
await writeFile(join(ROOT, 'config', 'watchlist.json'), JSON.stringify(out, null, 1) + '\n');

// Human review list
const row = (e) => `| ${e.name}${e.aliases.length ? ` (${e.aliases.join(', ')})` : ''} | ${e.he || ''} | ${e.sport} | ${e.team?.en || ''} | ${e.israelLink?.note || e.why || ''}${e.ambiguous ? ' - needs context' : ''}${e.stale ? ' - club data may be stale' : ''} |`;
const section = (title, list) => [`## ${title} (${list.length})`, '', '| Name | Hebrew | Sport | Club | Basis / reason |', '|---|---|---|---|---|', ...list.map(row), ''].join('\n');
const md = [
  '# Watchlist review',
  '',
  `Generated ${out.builtAt.slice(0, 10)} from the candidate corpus. Knowledge base: ${out.kbAt}.`,
  '',
  'Only **verified** entries are searched by name and may show an Israel link. **Pending** entries are recognised in stories but never claim an Israel link and are not searched. **Source-only** entries (world stars, clubs) are for recognition and ranking.',
  '',
  'To confirm or reject an entry, add it to `config/watchlist-overrides.json` by its ID, for example:',
  '',
  '```json',
  '{ "entries": { "p-basketball-oded-kattash": { "status": "verified", "israelLink": { "basis": "editor", "note": "Israeli coach, confirmed by the desk" } } } }',
  '```',
  '',
  'then run `node scripts/build-watchlist.mjs`.',
  '',
  section('Verified', entries.filter((e) => e.status === 'verified')),
  section('Pending', entries.filter((e) => e.status === 'pending')),
  section('Source-only', entries.filter((e) => e.status === 'source-only')),
  `## Excluded from the brief (${seed.excluded.length})`,
  '',
  ...seed.excluded.map((x) => `- ${x.name}: ${x.why}`),
  '',
  '## Corrections applied',
  '',
  ...seed.corrections.map((c) => `- ${c}`),
  '',
].join('\n');
await writeFile(join(ROOT, 'docs', 'watchlist-review.md'), md);
console.log(JSON.stringify(out.counts), 'ambiguous:', entries.filter((e) => e.ambiguous).length);
