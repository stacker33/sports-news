// Watchlist (discovery version): a verified registry of people and clubs, alias-aware matching with
// ambiguity context, and a bounded, rotated query planner. Built from config/watchlist.json
// (scripts/build-watchlist.mjs) and config/vocabulary.json.
//
// Rules that matter (from the editors' brief):
// - Only `verified` entries may assert an Israel link. `pending` entries are recognised but never
//   claim one; `source-only` entries (world stars, clubs) are for recognition and ranking only.
// - Ambiguous names (common names, several people with the same name) match only with sporting context.
// - Queries are bounded: a per-run budget, rotation by priority interval, failure backoff, and a
//   visible list of what was deferred and why.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gnews } from '../config/sources.js';

// ---------- names ----------
const FOLD = { 'ı': 'i', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ð': 'd', 'þ': 'th' };
// Lowercase, no accents, punctuation as spaces: "Gyökeres" = "gyokeres", "Nir'on" = "nir on", "T.J." = "t j"
export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[ıøłđßæœðþ]/g, (c) => FOLD[c])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ְ-ׇ]/g, '') // Hebrew vowel points
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Stable ID: the canonical name, type and sport. Adding or removing an alias never changes it;
// the same name in two sports (Maccabi Tel Aviv football / basketball) gives two IDs.
export function entryId(type, sport, name) {
  return `${type[0]}-${sport}-${norm(name).replace(/ /g, '-')}`;
}

// Canonical query ID: the same query text and locale always give the same ID, whatever the order of OR terms.
export function queryId(q, locale) {
  const key = `${locale}|${norm(q).split(' ').sort().join(' ')}`;
  return 'wq-' + createHash('sha1').update(key).digest('hex').slice(0, 10);
}

// Surnames shared by many athletes: these names match only with sporting context
export const COMMON_SURNAMES = new Set(['cohen', 'levi', 'levy', 'peretz', 'david', 'jones', 'james', 'williams', 'brown', 'davis', 'allen', 'smith', 'wolf', 'adam', 'ziv', 'green', 'harper', 'johnson', 'miller', 'martinez', 'garcia', 'silva', 'santos']);

export function needsContext(name, kbDuplicates = 0) {
  const parts = norm(name).split(' ');
  return parts.length < 2 || COMMON_SURNAMES.has(parts.at(-1)) || kbDuplicates > 1;
}

export async function loadWatchlist(root) {
  try {
    const j = JSON.parse(await readFile(join(root, 'config', 'watchlist.json'), 'utf8'));
    return j.entries || [];
  } catch {
    return [];
  }
}
export async function loadVocabulary(root) {
  try {
    return JSON.parse(await readFile(join(root, 'config', 'vocabulary.json'), 'utf8'));
  } catch {
    return { families: {}, multilingual: {}, querySets: {} };
  }
}

// ---------- matching ----------
const SPORT_CONTEXT = {
  football: /\b(football|soccer|futbol|futebol|calcio|fussball|voetbal|fotbal|fudbal|podosfairo|goal|striker|winger|midfielder|defender|goalkeeper|premier league|laliga|serie a|bundesliga|ligue 1|eredivisie|champions league|europa league|conference league|mls|fifa|uefa)\b|כדורגל|שער|ליגת העל/u,
  basketball: /\b(basketball|baloncesto|basket|basquete|basketbal|baschet|kosarka|kosarlabda|basketbol|nba|wnba|ncaa|euroleague|eurocup|fiba|guard|forward|center|rebounds?|assists?|points?|dunk|three pointer)\b|כדורסל|יורוליג|אן בי איי/u,
  other: /\b(tennis|atp|wta|formula 1|f1|grand prix|olympic|olympics|world championships?|judo|gymnastics|athletics|marathon|swimming|ufc|boxing|nfl|mlb|golf|cycling|tour de france|medal)\b|אולימפי|מדליה|טניס|ג'ודו|התעמלות/u,
};
const ISRAEL_CONTEXT = /\b(israel|israeli|israelis|maccabi|hapoel|beitar|ligat|israele|israeliano|israeli|israelisch|israelischer|israelien|israelienne|israeli|israelense|israelita|izrael|izraelski|israil|israilli)\b|ישראל|ישראלי|ליגיונר|מכבי|הפועל|בית"ר|ισραηλ/u;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function termTest(term) {
  const t = norm(term);
  if (!t) return null;
  const re = new RegExp(`(^| )${escapeRe(t)}($| )`, 'u');
  return (text) => re.test(text);
}

// entries → match(storyText, storySport) → [{ id, name, status, israelLink, via }]
export function buildWatchMatchers(entries) {
  const list = entries
    .filter((e) => e.status !== 'excluded')
    .map((e) => {
      const terms = [e.name, ...(e.aliases || []), e.he].filter(Boolean);
      // context = the person's club (a club's own name is not context for itself)
      const own = new Set(terms.map(norm));
      const ctxTerms = [...(e.context || []), e.team?.en, e.team?.he].filter((t) => t && !own.has(norm(t)));
      return { e, tests: terms.map(termTest).filter(Boolean), ctx: ctxTerms.map(termTest).filter(Boolean) };
    });
  return (rawText, storySport) => {
    const text = ' ' + norm(rawText) + ' ';
    const hits = [];
    for (const { e, tests, ctx } of list) {
      if (!tests.some((f) => f(text))) continue;
      let via = 'name';
      if (e.ambiguous) {
        // an ambiguous name needs its team, or Israel plus the right sport, or (for one-word names) the right sport
        const teamHit = ctx.some((f) => f(text));
        const sportHit = storySport ? storySport === e.sport : SPORT_CONTEXT[e.sport]?.test(text);
        const single = norm(e.name).split(' ').length < 2;
        if (teamHit) via = 'name+team';
        else if (sportHit && (single || ISRAEL_CONTEXT.test(text))) via = single ? 'name+sport' : 'name+israel+sport';
        else continue;
      } else if (e.sport !== 'other' && storySport && storySport !== e.sport && !ctx.some((f) => f(text))) {
        continue; // a football name inside a basketball story: a namesake
      }
      hits.push({ id: e.id, name: e.name, he: e.he || '', type: e.type, status: e.status, category: e.category, israelLink: e.status === 'verified' && !!e.israelLink, via });
    }
    return hits;
  };
}

// Annotate a story with watchlist hits. Only verified Israel-linked entries may set Israel-link reasons.
export function annotateWatch(s, match) {
  const text = [s.title, ...(s._members || []).map((m) => `${m.title} ${m.summary || ''}`)].join(' \n ');
  const hits = match(text, s.sport);
  if (!hits.length) return s;
  s.watch = hits.map(({ id, name, he, type, status, israelLink, via, category }) => ({ id, name, he, type, status, israelLink, via, category }));
  if (hits.some((h) => h.israelLink)) s.watchIsrael = true;
  if (hits.some((h) => h.category === 'world-star')) s.watchStar = true;
  return s;
}

// ---------- queries ----------
const MAX_Q = 400; // Google News handles long queries badly; split rather than truncate
const LOCALE_OF = { england: 'en-GB', scotland: 'en-GB', usa: 'en', spain: 'es', italy: 'it', germany: 'de', france: 'fr', netherlands: 'nl', belgium: 'nl', portugal: 'pt', romania: 'ro', serbia: 'sr', hungary: 'hu', greece: 'el', turkey: 'tr', poland: 'pl', austria: 'de', switzerland: 'de' };
const KB_COUNTRY = { 1: 'england', 2: 'spain', 3: 'italy', 4: 'germany', 5: 'france', 7: 'netherlands', 8: 'scotland', 11: 'portugal', 12: 'turkey', 13: 'greece', 15: 'switzerland', 16: 'belgium', 18: 'usa' };
export const PRIORITY_HOURS = { high: 1, normal: 3, low: 8 }; // how often each priority's query is due

const quote = (s) => (/\s/.test(s) ? `"${s}"` : s);

// OR-groups of names that fit under the length limit
function orGroups(terms, extra = '', size = 6) {
  const groups = [];
  let cur = [];
  const len = (g) => `(${g.map(quote).join(' OR ')}) ${extra} when:2d`.length;
  for (const t of terms) {
    if (cur.length && (cur.length >= size || len([...cur, t]) > MAX_Q)) {
      groups.push(cur);
      cur = [];
    }
    cur.push(t);
  }
  if (cur.length) groups.push(cur);
  return groups;
}

// Every possible watch query (before budgeting). Editors' list athletes already have their own feeds,
// so they are skipped here (`skipNames`).
//  A - verified Israelis: name-only, English plus the club's country language
//  C - discovery: an Israeli angle or exceptional-story terms, always with sport context
export function candidateQueries(entries, vocab = {}, { skipNames = new Set() } = {}) {
  const out = [];
  const add = (mode, priority, q, locale, entryIds = []) => {
    if (q.length > MAX_Q) return;
    out.push({ id: queryId(q, locale), mode, priority, q, locale, lang: locale === 'en-GB' ? 'en' : locale, entryIds });
  };
  const verified = entries.filter((e) => e.status === 'verified' && e.type !== 'club' && !skipNames.has(norm(e.name)));
  for (const sport of ['football', 'basketball', 'other']) {
    const people = verified.filter((e) => e.sport === sport);
    // name-only, unambiguous names (ambiguous ones get their team as context)
    const plain = people.filter((e) => !e.ambiguous);
    // abroad first; players at Israeli clubs are already covered by the Hebrew press
    const prio = (e) => e.priority || (e.team?.country === 6 ? 'low' : e.team?.country ? 'high' : 'normal');
    for (const p of ['high', 'normal', 'low']) {
      const tier = plain.filter((e) => prio(e) === p);
      const names = tier.flatMap((e) => [e.name, ...(e.aliases || []).filter((a) => norm(a) !== norm(e.name))]);
      for (const g of orGroups([...new Set(names)])) add('A', p, `(${g.map(quote).join(' OR ')}) when:2d`, 'en', tier.filter((e) => g.includes(e.name)).map((e) => e.id));
    }
    for (const e of people.filter((x) => x.ambiguous && x.team?.en)) add('A', prio(e), `${quote(e.name)} ${quote(e.team.en)} when:2d`, 'en', [e.id]);
    // local-language press of the club's country (one query per country)
    const byLocale = new Map();
    for (const e of plain) {
      const loc = LOCALE_OF[KB_COUNTRY[e.team?.country]];
      if (!loc || loc === 'en' || loc === 'en-GB') continue;
      byLocale.set(loc, [...(byLocale.get(loc) || []), e]);
    }
    for (const [loc, list] of byLocale) {
      for (const g of orGroups(list.map((e) => e.name))) add('A', 'normal', `(${g.map(quote).join(' OR ')}) when:2d`, loc, list.filter((e) => g.includes(e.name)).map((e) => e.id));
    }
  }
  for (const { lang, q } of vocab.querySets?.israeliAngle || []) add('C', 'normal', `${q} when:3d`, lang);
  for (const { lang, q } of vocab.querySets?.exceptional || []) add('C', 'low', `${q} when:3d`, lang);
  // the same query twice (two groups producing identical text) runs once
  return [...new Map(out.map((x) => [x.id, x])).values()];
}

// Pick this run's queries: the most overdue first, within the budget. Failing queries back off
// (2^failStreak runs of their interval, up to a day). Everything not picked is returned as deferred, with the reason.
export function planQueries(candidates, sched = {}, { now = Date.now(), budget = 12 } = {}) {
  const scored = candidates.map((c) => {
    const s = sched[c.id] || {};
    const interval = PRIORITY_HOURS[c.priority] * 3600e3;
    const backoff = s.fails ? Math.min(24 * 3600e3, interval * 2 ** s.fails) : 0;
    const nextAt = (s.last || 0) + interval + backoff;
    return { ...c, nextAt, overdue: now - nextAt, why: s.fails ? `backoff after ${s.fails} failure(s)` : null };
  });
  const due = scored.filter((c) => c.overdue >= 0).sort((a, b) => b.overdue / PRIORITY_HOURS[b.priority] - a.overdue / PRIORITY_HOURS[a.priority] || a.id.localeCompare(b.id));
  const run = due.slice(0, budget);
  const deferred = [
    ...due.slice(budget).map((c) => ({ id: c.id, q: c.q, locale: c.locale, mode: c.mode, why: 'over this run\'s budget' })),
    ...scored.filter((c) => c.overdue < 0).map((c) => ({ id: c.id, q: c.q, locale: c.locale, mode: c.mode, why: c.why || 'not due yet', nextAt: c.nextAt })),
  ];
  return { run, deferred };
}

// Update the schedule after the run: success resets failures, failure counts up (for backoff)
export function recordQueries(sched = {}, run, results, now = Date.now(), keepIds = null) {
  const out = {};
  for (const [id, s] of Object.entries(sched)) if (!keepIds || keepIds.has(id)) out[id] = s;
  run.forEach((c, i) => {
    const ok = results[i]?.ok !== false;
    const prev = out[c.id] || {};
    out[c.id] = { last: now, fails: ok ? 0 : (prev.fails || 0) + 1, count: ok ? results[i]?.count ?? prev.count ?? 0 : prev.count ?? 0 };
  });
  return out;
}

// News sources for the planned queries (marked `watch`: kept out of the source-health lists)
export function watchSources(run) {
  return run.map((c) => ({ id: c.id, name: 'Google News', url: gnews(c.q, c.locale), lang: c.lang, weight: 1, google: true, mixed: c.mode === 'C', every: 1, watch: c.mode, watchIds: c.entryIds }));
}
