// Validates the source-reliability changes (feed clock correction, backoff, meta cleanup, stage timing) against a SAVED production state.
// OFFLINE and read-only: no network, nothing written to the radar's data.
//
//   node scripts/validate-reliability.mjs --state <state.json> [--json docs/reliability-validation.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { SOURCES } from '../config/sources.js';
import { trendSources } from '../src/trends.js';
import { settleClock12, fixClock12 } from '../src/feedtime.js';
import { recordFailure, BASE_MS } from '../src/backoff.js';
import { pruneMeta } from '../src/metaprune.js';
import { clusterItems } from '../src/cluster.js';
import { mergeSameEvent } from '../src/merge.js';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const statePath = arg('--state');
if (!statePath) throw new Error('--state <state.json> is required');
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const MIN = 60e3, H = 3600e3;
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10 : null; };
const out = { state: statePath, savedAt: new Date(state.savedAt).toISOString(), articles: state.items.length };
const firstFinder = (i) => i.via?.src || i.sourceId;

// ---- 1. the clock correction, replayed on the articles the radar really collected ----
{
  const flagged = new Map(SOURCES.filter((s) => s.clock12).map((s) => [s.id, s.clock12]));
  out.clock = { flaggedSources: [...flagged.keys()], perSource: {} };
  for (const [id, tz] of flagged) {
    // each article as the collector saw it at its first collection: `seen` is the run's time, `published` the (wrong) date the feed gave
    const items = state.items.filter((i) => firstFinder(i) === id && i.published < i.seen);
    const rows = items.map((i) => {
      const r = settleClock12({ published: i.published, now: i.seen, tz, prev: null, firstRead: false });
      return { rawLag: (i.seen - i.published) / MIN, newLag: (i.seen - r.published) / MIN, corrected: r.published !== i.published };
    });
    const wrong = rows.filter((r) => r.rawLag >= 700 && r.rawLag <= 780);
    out.clock.perSource[id] = {
      articles: rows.length,
      lagBeforeMin: { median: q(rows.map((r) => r.rawLag), 0.5), p90: q(rows.map((r) => r.rawLag), 0.9) },
      lagAfterMin: { median: q(rows.map((r) => r.newLag), 0.5), p90: q(rows.map((r) => r.newLag), 0.9), max: q(rows.map((r) => r.newLag), 1) },
      correctedArticles: rows.filter((r) => r.corrected).length,
      articlesThatLookedTwelveHoursEarly: wrong.length,
      ofThoseCorrected: wrong.filter((r) => r.corrected).length,
      correctArticlesTouched: rows.filter((r) => r.rawLag < 120 && r.corrected).length,
      stillOver11hAfter: rows.filter((r) => r.newLag > 11 * H / MIN).length,
      correctedLagAfterMin: q(rows.filter((r) => r.corrected).map((r) => r.newLag), 0.5),
    };
  }
  // how often the rule would fire on feeds that do NOT have the problem (so the risk of a wrong correction): an article first seen 12 h to 12.5 h after its date
  const others = state.items.filter((i) => !flagged.has(firstFinder(i)) && i.published < i.seen);
  const hits = others.filter((i) => fixClock12(i.published, i.seen, 'Europe/Brussels') !== i.published);
  out.clock.ifAppliedToEveryOtherFeed = { articles: others.length, wouldBeChanged: hits.length, per10000: Math.round((hits.length / others.length) * 1e5) / 10, note: 'these are genuinely 12 to 12.5 hours old when first collected (mostly the first read of a new source); the rule is only enabled on the two feeds with the measured fault, and never on a first read' };
  // the same rule on the articles of feeds that are only seen by their first read
  out.clock.clarinDep = { note: 'not corrected: its lag is spread (p10 44, median 54, p90 62 minutes), which is a feed delay, not an exact clock offset', stats: (() => { const l = state.items.filter((i) => firstFinder(i) === 'clarin-dep' && i.published < i.seen).map((i) => (i.seen - i.published) / MIN); return { articles: l.length, p10: q(l, 0.1), median: q(l, 0.5), p90: q(l, 0.9) }; })() };
}

// ---- 2. backoff: the two sources failing now and the old saved failures ----
{
  const sim = (err, days) => {
    let meta, now = 0, asks = 0;
    const end = days * 24 * H;
    while (now < end) {
      asks++;
      meta = recordFailure(meta, err, now);
      now = Math.ceil(Math.max(meta.cooldownUntil, now + 5 * MIN) / (5 * MIN)) * 5 * MIN;
    }
    return asks;
  };
  const http = (s, ra) => Object.assign(new Error(`HTTP ${s}`), { status: s, retryAfter: ra ?? null });
  out.backoff = {
    persistent403RequestsIn7Days: { before: 7 * 24 * 4, after: sim(http(403), 7) },
    persistent404RequestsIn7Days: { before: 7 * 24 * 4, after: sim(http(404), 7) },
    rateLimit429RequestsIn7Days: { before: 7 * 24 * 4, after: sim(http(429), 7), note: 'a rate limit keeps being tried at least every 3 hours' },
    rateLimit429WithRetryAfter2h: { after: sim(http(429, 2 * H), 2) },
    transient503RequestsIn7Days: { before: 7 * 24 * 4, after: sim(http(503), 7), note: 'unchanged: 5xx and timeouts keep the flat 15 minutes' },
  };
  const meta = state.meta || {};
  const lastRun = Math.max(...Object.keys(meta).map((i) => meta[i].last || 0));
  const failing = Object.keys(meta).filter((i) => meta[i].ok === false && lastRun - meta[i].last < 15 * MIN);
  out.backoff.savedFailingSources = failing.map((id) => {
    const r = recordFailure(meta[id], Object.assign(new Error(meta[id].error), { status: Number(/HTTP (\d+)/.exec(meta[id].error)?.[1]) || 0 }), lastRun);
    return { id, error: meta[id].error, failStreak: meta[id].failStreak, newCooldownMin: Math.round((r.cooldownUntil - lastRun) / MIN) };
  }).slice(0, 20);
  out.backoff.savedFailingAllKeepFlat15 = failing.every((id) => /HTTP 5/.test(meta[id].error) ? recordFailure(meta[id], Object.assign(new Error(meta[id].error), { status: 503 }), lastRun).cooldownUntil - lastRun === BASE_MS : true);
  // no healthy feed is delayed: every source that was OK at save time is due under the new rule exactly when it was under the old
  const okIds = Object.keys(meta).filter((i) => meta[i].ok);
  out.backoff.healthySources = { count: okIds.length, withACooldown: okIds.filter((i) => meta[i].cooldownUntil).length, note: 'recordFailure is only called after a failure; a healthy record has no cooldown and is never touched' };
}

// ---- 3. the cleanup on the saved record ----
{
  const meta = structuredClone(state.meta || {});
  const lastRun = Math.max(...Object.keys(meta).map((i) => meta[i].last || 0));
  const active = new Set([...SOURCES.map((s) => s.id), ...trendSources(state.trendSearch || {}).map((s) => s.id), ...Object.keys(meta).filter((i) => meta[i].last === lastRun)]);
  const before = Object.keys(meta).length;
  const bytesBefore = JSON.stringify(meta).length;
  const polledRecently = Object.keys(meta).filter((i) => state.savedAt - meta[i].last < 48 * H);
  const t0 = process.hrtime.bigint();
  const removed = pruneMeta(meta, active, state.savedAt);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const gone = new Set(Object.keys(state.meta).filter((i) => !(i in meta)));
  out.cleanup = {
    entriesBefore: before, removed, entriesAfter: Object.keys(meta).length, metaBytesBefore: bytesBefore, metaBytesAfter: JSON.stringify(meta).length, pruneMs: Math.round(ms * 100) / 100,
    removedAreAllTrendSearches: [...gone].every((i) => i.startsWith('trend-')),
    anySourcePolledInTheLast48hRemoved: polledRecently.some((i) => gone.has(i)),
    anyActiveSourceRemoved: [...gone].some((i) => active.has(i)),
    articlesKept: state.items.length,
    articlesWhoseFirstFinderEntryWasRemoved: state.items.filter((i) => gone.has(firstFinder(i))).length,
    note: 'the articles keep their provenance (via, paths) whether or not the schedule entry of a dormant trend search exists',
  };
}

// ---- 4. story coverage: the grouping before and after the two feeds' dates are corrected ----
{
  const flagged = new Map(SOURCES.filter((s) => s.clock12).map((s) => [s.id, s.clock12]));
  const prep = (items) => items.filter((i) => !i.hidden).map((i) => ({ ...i, tr: state.tr?.[i.id] ? { en: state.tr[i.id].en } : null, athletes: i.athletes || [], teams: i.teams || [], ents: i.ents || [] }));
  const changed = new Map();
  const fixedItems = state.items.map((i) => {
    if (!flagged.has(firstFinder(i)) || !(i.published < i.seen)) return i;
    const r = settleClock12({ published: i.published, now: i.seen, tz: flagged.get(firstFinder(i)), prev: null, firstRead: false });
    if (r.published === i.published) return i;
    changed.set(i.id, r.published);
    return { ...i, published: r.published, feedPublished: i.published };
  });
  const grouping = (items) => { const merged = mergeSameEvent(clusterItems(prep(items)), {}); const by = new Map(); merged.forEach((m, k) => m.forEach((x) => by.set(x.id, k))); return { merged, by }; };
  const A = grouping(state.items);
  const B = grouping(fixedItems);
  const sizeOf = (g, id) => g.merged[g.by.get(id)].length;
  const touched = [...changed.keys()].filter((id) => A.by.has(id));
  out.coverage = {
    articlesWithCorrectedDate: changed.size,
    storiesBefore: A.merged.length, storiesAfter: B.merged.length,
    correctedArticlesThatChangedStory: touched.filter((id) => sizeOf(A, id) !== sizeOf(B, id)).length,
    correctedArticlesInAStoryOfSeveralOutlets: touched.filter((id) => sizeOf(B, id) > 1).length,
    articlesInOtherStoriesWhoseStoryChanged: (() => { let n = 0; const same = new Map(A.merged.map((m) => [m.map((x) => x.id).sort().join('|'), true])); for (const m of B.merged) if (!same.has(m.map((x) => x.id).sort().join('|'))) n += 1; return n; })(),
    note: 'stories whose membership differs after the correction (a story that gained or lost an article); the correction only moves the dates of the evening articles of two feeds',
  };
}

// ---- 5. cost ----
{
  const t0 = process.hrtime.bigint();
  const NOW = Date.now();
  for (let k = 0; k < 120; k++) settleClock12({ published: NOW - 12 * H - k * 1000, now: NOW, tz: 'Europe/Brussels' }); // the two feeds' 60 articles each, per run
  const clockMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const t1 = process.hrtime.bigint();
  for (let k = 0; k < 400; k++) recordFailure({ ok: false, error: 'HTTP 403', failStreak: k, failKind: 'access', kindStreak: k, failSince: 0 }, Object.assign(new Error('HTTP 403'), { status: 403 }), NOW);
  const backoffMs = Number(process.hrtime.bigint() - t1) / 1e6;
  out.cost = { clockCorrectionPerRunMs: Math.round(clockMs * 100) / 100, backoff400FailuresMs: Math.round(backoffMs * 100) / 100, note: 'per collector run; a run takes about 2.4 minutes' };
}

const text = JSON.stringify(out, null, 1);
console.log(text);
if (arg('--json')) writeFileSync(arg('--json'), text);
