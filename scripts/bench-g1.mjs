// Benchmark of the sorting-aware pool cap (CAP_G1, src/capselect.js; 'g1' in the output names means the pool) on a saved radar state. OFFLINE: no network, no model, nothing written to
// the radar's data. Replays consecutive 5-minute collector runs (grouping, story filters, the cap) and reports
//   - time and memory of scoring every eligible story with editorialRank BEFORE the cap (the new cost),
//   - the time of the selection itself,
//   - how much of the app's default and newest lists (top 300) each policy contains (recall), legacy against G1,
//   - churn: overlap of consecutive runs, with and without the keep bonus.
//
//   node scripts/bench-g1.mjs --state <state.json> [--entities <entities.json>] [--runs 13] [--json out.json]
//
// What the saved state does not hold, so the replayed score differs from production's: the watchlist, the language-model desk labels,
// the Sport5 coverage check, the source countries. Production has all of them before the cap (the stories are annotated first), so
// the real score is the same function with more inputs. Use CAP_G1=shadow in production to measure with them.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadReplay, H } from './replay-lib.mjs';
import { applyCap, capStories, isIsraeli } from '../src/capselect.js';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const statePath = arg('--state');
if (!statePath) throw new Error('--state <state.json> is required');
const entitiesPath = arg('--entities', join(dirname(statePath), 'entities.json'));
const RUNS = Number(arg('--runs', 13));

const { end, eligibleAt, scoreOf } = loadReplay(statePath, entitiesPath);

// what the app shows on the Top tab for a slider position, from a list of stories (public/app.js visibleStories / rankMix)
const topList = (list, T, mix, score, full) => {
  const w = mix / 100;
  const v = (s) => w * (score.get(s) / 100) + (1 - w) * Math.exp(-(T - s.first) / (6 * H));
  return list.filter((s) => (s.sport !== 'other' || s.big) && !full.get(s)?.israeliOnly && !s.local && !s.low && !s.minor).sort((a, b) => v(b) - v(a)).slice(0, mix >= 70 ? 120 : 300);
};
const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);
const mb = (b) => Math.round(b / 1048576);

const result = { state: statePath, runs: RUNS, replayed: [] };
let prev = new Set(), prevNoBonus = new Set(), legacyPrev = new Set();
const jac = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return a.size + b.size - i ? i / (a.size + b.size - i) : 1; };
const churn = { withBonus: [], withoutBonus: [], legacy: [] };
const identity = { runs: 0, offSameAsLegacy: 0, shadowSameAsLegacy: 0, coreSameAsLegacyWhenOn: 0 }; // flag modes against the legacy cap, run by run
for (let k = RUNS - 1; k >= 0; k--) {
  const T = end - k * 5 * 60e3;
  const stories = eligibleAt(T);
  for (const s of stories) s._now = T;
  if (global.gc) global.gc();
  const mem0 = process.memoryUsage();
  const t0 = process.hrtime.bigint();
  const score = new Map();
  const full = new Map();
  const cache = (s) => { if (!full.has(s)) { const r = scoreOf(s); full.set(s, r); score.set(s, r.score); } return full.get(s); };
  const g = applyCap(stories, { mode: 'on', max: 1200, now: T, scoreOf: cache, prevKept: prev });
  const totalMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const mem1 = process.memoryUsage();
  const gNo = applyCap(stories, { mode: 'on', max: 1200, now: T, scoreOf: cache, prevKept: new Set() });
  const legacy = capStories(stories, 1200);
  {
    const same = (list) => list.length === legacy.length && list.every((x, i) => x === legacy[i]);
    identity.runs++;
    if (same(applyCap(stories, { mode: 'off', max: 1200, now: T, scoreOf: () => { throw new Error('off must not score'); } }).published)) identity.offSameAsLegacy++;
    if (same(applyCap(stories, { mode: 'shadow', max: 1200, now: T, scoreOf: cache }).published)) identity.shadowSameAsLegacy++;
    if (same(g.core)) identity.coreSameAsLegacyWhenOn++;
  }
  for (const s of stories) cache(s);
  const keptIds = new Set(g.published.map((s) => s.id));
  const noBonusIds = new Set(gNo.published.map((s) => s.id));
  const legacyIds = new Set(legacy.map((s) => s.id));
  if (prev.size) { churn.withBonus.push(jac(keptIds, prev)); churn.withoutBonus.push(jac(noBonusIds, prevNoBonus)); churn.legacy.push(jac(legacyIds, legacyPrev)); }
  prev = keptIds; prevNoBonus = noBonusIds; legacyPrev = legacyIds;
  if (k === 0 || k === RUNS - 1) {
    const recall = (mix, set) => { const want = topList(stories, T, mix, score, full); return pct(want.filter((s) => set.has(s)).length, want.length); };
    const L = new Set(legacy), G = new Set(g.published);
    result.replayed.push({ at: new Date(T).toISOString(), eligible: stories.length, israeli: stories.filter(isIsraeli).length, scoredInMs: Math.round(totalMs), heapUsedDeltaMB: mb(mem1.heapUsed - mem0.heapUsed), rssMB: mb(mem1.rss), selectionMs: g.stats.selectMs, overlapWithLegacy: g.stats.overlap, added: g.stats.added, dropped: g.stats.dropped, recallNewestTop300: { legacy: recall(0, L), g1: recall(0, G) }, recallDefaultTop300: { legacy: recall(50, L), g1: recall(50, G) }, recallEditorialTop120: { legacy: recall(100, L), g1: recall(100, G) }, listRecallAllTabsAllPositions: { legacy: g.stats.recallLegacy, pool: g.stats.recallPool } });
  } else result.replayed.push({ at: new Date(T).toISOString(), eligible: stories.length, scoredInMs: Math.round(totalMs), selectionMs: g.stats.selectMs, overlapWithLegacy: g.stats.overlap });
}
const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10000) / 10000 : null);
result.churn = { note: 'Jaccard overlap of the published sets of consecutive 5-minute runs (1.0 = identical)', legacy: avg(churn.legacy), g1WithKeepBonus: avg(churn.withBonus), g1WithoutBonus: avg(churn.withoutBonus), minLegacy: Math.min(...churn.legacy), minG1WithBonus: Math.min(...churn.withBonus), minG1WithoutBonus: Math.min(...churn.withoutBonus) };
result.identity = { note: 'runs in which the published list (off, shadow) and the list Telegram / summaries read (on) are exactly the legacy list: same stories, same order', ...identity };
result.cost = { scoredStories: result.replayed.map((r) => r.eligible).reduce((a, b) => Math.max(a, b), 0), medianScoringMs: [...result.replayed.map((r) => r.scoredInMs)].sort((a, b) => a - b)[Math.floor(RUNS / 2)], maxScoringMs: Math.max(...result.replayed.map((r) => r.scoredInMs)), peakRssMB: Math.max(...result.replayed.filter((r) => r.rssMB).map((r) => r.rssMB)) };
console.log(JSON.stringify(result, null, 1));
if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify(result, null, 1));
