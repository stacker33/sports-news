// Benchmark of the sorting-aware pool (src/capselect.js selectPool, CAP_G1) against today's cap and the earlier G1 fill.
// OFFLINE replay on a saved state (see scripts/replay-lib.mjs); no network, no model, nothing written to the radar's data.
//
//   node scripts/bench-sorting-aware.mjs --state <state.json> [--json out.json]
//
// Approaches, all with the same Israeli-first tier and a total of 1,200:
//   A     today: the newest non-Israeli stories
//   B     the earlier G1 fill: the non-Israeli stories with the best 50/50 mix (kept here only for comparison)
//   POOL  the production selection: the union of the lists the slider can show on the Top, Football and Basketball tabs at slider
//         positions 0, 25, 50, 75, 100, taken in turn (src/capselect.js)
//   CL    POOL's lists plus the top 100 of each league the app can filter on (an uncapped comparison: its size is whatever the union is)
// Each is scored on how much of the TRUE list (built from every eligible story, with the page's own formulas) it contains, at the
// positions the pool is built for and at positions it is not (10, 35, 65, 85), so it is not just fitted to the test.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadReplay, H } from './replay-lib.mjs';
import { israeliOnlyStory, applyCap, capStories, isIsraeli, listFor, listForIlmon, mixAt, freshness, tabAccepts, offbeat, POOL_TABS, SLIDER_POSITIONS, listSize } from '../src/capselect.js';
import { storyEvidence, storyCoverage, storyViews } from '../src/roles.js';
import { editorialRank, loadRankConfig, loadVocabulary } from '../src/rank.js';
import { SOURCES } from '../config/sources.js';

const ROOT = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const statePath = arg('--state');
if (!statePath) throw new Error('--state <state.json> is required');
const { end, eligibleAt } = loadReplay(statePath, arg('--entities', join(dirname(statePath), 'entities.json')));
const rankCfg = loadRankConfig(join(ROOT, 'config', 'editorial-rank.json'));
loadVocabulary(join(ROOT, 'config', 'vocabulary.json'));
const srcById = new Map(SOURCES.map((x) => [x.id, x]));
// measured on the live site 2026-11-18 (1,200 stories): see docs/sorting-aware.md
const BYTES_RAW = 3028, BYTES_GZ = 843, PARSE_MS = 24 / 1200, HEAP_KB = 5.8;

const edOf = (s, T) => {
  const { roles, ...ev } = storyEvidence(s, (m) => srcById.get(m.sourceId));
  const r = editorialRank({ ...s, ev, cov: storyCoverage(s, { ok: false }, ev) }, { now: T, cfg: rankCfg });
  return { score: r.score, dims: r.dims, israeliOnly: israeliOnlyStory(ev, s._members, roles), ilmon: storyViews(s, ev).includes('i') };
};
const BUILD = SLIDER_POSITIONS;
const TEST = [0, 10, 25, 35, 50, 65, 75, 85, 100];
const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);
const mean = (a) => Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10;
const infoOf = (stories, ed, T) => new Map(stories.map((s) => [s, { ed: ed.get(s).score, fresh: freshness(s, T), israeliOnly: ed.get(s).israeliOnly, ilmon: ed.get(s).ilmon }]));

const LEAGUES = ['c-epl', 'c-laliga', 'c-seriea', 'c-bundes', 'c-ligue1', 'c-ucl', 'c-uel', 'c-nba', 'c-euroleague'];
function approaches(stories, T, ed, info) {
  const A = new Set(capStories(stories, 1200));
  const israeli = new Set(stories.filter(isIsraeli));
  // B: the earlier G1 fill
  const B = new Set([...israeli].slice(0, 1200));
  for (const s of [...stories].filter((s) => !B.has(s)).sort((a, b) => mixAt(50, ed.get(b).score, freshness(b, T)) - mixAt(50, ed.get(a).score, freshness(a, T)) || b.latest - a.latest || (a.id < b.id ? -1 : 1))) if (B.size < 1200) B.add(s);
  const g = applyCap(stories, { mode: 'on', max: 1200, now: T, scoreOf: (s) => ed.get(s) });
  const POOL = new Set(g.published);
  // the untrimmed union (what the lists hold before the cap trims it) and CL
  const union = new Set(israeli);
  for (const tab of POOL_TABS) for (const p of BUILD) for (const s of listFor(stories, info, tab, p)) union.add(s);
  const CL = new Set(union);
  for (const comp of LEAGUES) for (const p of [0, 50, 100]) {
    const w = p / 100;
    const v = (s) => w * (ed.get(s).score / 100) + (1 - w) * freshness(s, T);
    for (const s of stories.filter((s) => s.comps?.includes(comp) && tabAccepts('top', s, ed.get(s).israeliOnly) && offbeat(s)).sort((a, b) => v(b) - v(a) || (a.id < b.id ? -1 : 1)).slice(0, 100)) CL.add(s);
  }
  return { A, B, POOL, CL, unionSize: union.size, stats: g.stats };
}

const NAMES = ['A', 'B', 'POOL', 'CL'];
const FILTERS = { 'league: Premier League': (s) => s.comps?.includes('c-epl'), 'league: NBA': (s) => s.comps?.includes('c-nba'), 'league: Euroleague': (s) => s.comps?.includes('c-euroleague'), 'league: Champions League': (s) => s.comps?.includes('c-ucl'), 'language: Hebrew': (s) => s.langs.includes('he') };
const acc = Object.fromEntries(NAMES.map((n) => [n, { size: [], recall: {}, minRecall: [], older: [] }]));
const filtered = {};
const unionSizes = [];
const SNAPS = [0, 3, 6, 9, 12].map((h) => end - h * H);
const out = { state: statePath, snapshots: [], perApproach: {} };
for (const T of SNAPS) {
  const stories = eligibleAt(T);
  const ed = new Map(stories.map((s) => [s, edOf(s, T)]));
  const info = infoOf(stories, ed, T);
  const set = approaches(stories, T, ed, info);
  unionSizes.push(set.unionSize);
  for (const name of NAMES) {
    acc[name].size.push(set[name].size);
    const all = [];
    for (const tab of POOL_TABS) for (const p of TEST) {
      const want = listFor(stories, info, tab, p);
      const r = pct(want.filter((s) => set[name].has(s)).length, want.length);
      (acc[name].recall[`${tab}@${p}${BUILD.includes(p) ? '' : ' (not used to build the pool)'}`] ||= []).push(r);
      all.push(r);
    }
    {
      const want = listForIlmon(stories, info);
      const r = pct(want.filter((s) => set[name].has(s)).length, want.length);
      (acc[name].recall['ilmon@40 (Israeli monitoring, default slider)'] ||= []).push(r);
      all.push(r);
    }
    acc[name].minRecall.push(Math.min(...all));
  }
  for (const [fname, f] of Object.entries(FILTERS)) for (const p of [0, 50, 100]) {
    const w = p / 100;
    const v = (s) => w * (ed.get(s).score / 100) + (1 - w) * freshness(s, T);
    const want = stories.filter((s) => tabAccepts('top', s, ed.get(s).israeliOnly) && offbeat(s) && f(s)).sort((a, b) => v(b) - v(a) || (a.id < b.id ? -1 : 1)).slice(0, listSize(p));
    if (!want.length) continue;
    for (const name of NAMES) ((filtered[`${fname} @${p}`] ||= {})[name] ||= []).push(pct(want.filter((s) => set[name].has(s)).length, want.length));
  }
  // older high-value stories: the ones today's cap cut whose timeless editorial score (no freshness, no Sport5 check) reaches the shown top 10%
  const KEYS = ['israel', 'importance', 'news', 'attention', 'evidence'];
  const tw = KEYS.reduce((x, k) => x + rankCfg.weights[k], 0);
  const timeless = (s) => (100 * KEYS.reduce((x, k) => x + rankCfg.weights[k] * (ed.get(s).dims[k] ?? 0), 0)) / tw * (s.local || s.minor ? 0.5 : s.routine ? 0.75 : 1);
  const shownA = [...set.A].filter((s) => !isIsraeli(s)).map(timeless).sort((x, y) => x - y);
  const p90 = shownA[Math.floor(shownA.length * 0.9)];
  const cutA = stories.filter((s) => !set.A.has(s) && !s.low && timeless(s) >= p90);
  for (const name of NAMES) acc[name].older.push(pct(cutA.filter((s) => set[name].has(s)).length, cutA.length));
  out.snapshots.push({ at: new Date(T).toISOString(), eligible: stories.length, israeli: stories.filter(isIsraeli).length, unionBeforeTrim: set.unionSize, israeliOnlyStories: stories.filter((s) => ed.get(s).israeliOnly).length, olderHighValueCutByToday: cutA.length });
}
for (const [name, a] of Object.entries(acc)) {
  const recall = Object.fromEntries(Object.entries(a.recall).map(([k, v]) => [k, mean(v)]));
  const size = mean(a.size);
  out.perApproach[name] = {
    publishedStories: size,
    extraOver1200: Math.round(size - 1200),
    extraRawKB: Math.round(((size - 1200) * BYTES_RAW) / 1024),
    extraGzipKB: Math.round(((size - 1200) * BYTES_GZ) / 1024),
    extraParseMs: Math.round((size - 1200) * PARSE_MS * 10) / 10,
    extraHeapMB: Math.round(((size - 1200) * HEAP_KB) / 1024 * 10) / 10,
    minimumRecallAnyTabAnyPosition: mean(a.minRecall),
    meanRecallTopTab: mean(Object.entries(recall).filter(([k]) => k.startsWith('top@')).map(([, v]) => v)),
    meanRecallFootball: mean(Object.entries(recall).filter(([k]) => k.startsWith('football@')).map(([, v]) => v)),
    meanRecallBasketball: mean(Object.entries(recall).filter(([k]) => k.startsWith('basketball@')).map(([, v]) => v)),
    recall,
    olderHighValueStoriesRestored: mean(a.older),
  };
}
out.unionBeforeTrim = { mean: mean(unionSizes), note: 'stories in the Israeli tier plus every list, before the cap trims to 1,200' };
out.filteredViews = Object.fromEntries(Object.entries(filtered).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([n, a]) => [n, mean(a)]))]));

// churn between consecutive 5-minute runs (the production chain: each run remembers the previous run's pool)
{
  const chain = Object.fromEntries(NAMES.map((n) => [n, []]));
  let prev = new Set();
  for (let k = 12; k >= 0; k--) {
    const T = end - k * 5 * 60e3;
    const stories = eligibleAt(T);
    const ed = new Map(stories.map((s) => [s, edOf(s, T)]));
    const info = infoOf(stories, ed, T);
    const g = applyCap(stories, { mode: 'on', max: 1200, now: T, scoreOf: (s) => ed.get(s), prevKept: prev });
    prev = new Set(g.published.map((s) => s.id));
    const set = approaches(stories, T, ed, info);
    for (const n of NAMES) chain[n].push(n === 'POOL' ? prev : new Set([...set[n]].map((s) => s.id)));
  }
  out.churnPerRun = {};
  for (const n of NAMES) {
    let enter = 0, leave = 0;
    for (let i = 1; i < chain[n].length; i++) {
      for (const id of chain[n][i]) if (!chain[n][i - 1].has(id)) enter++;
      for (const id of chain[n][i - 1]) if (!chain[n][i].has(id)) leave++;
    }
    out.churnPerRun[n] = { entering: Math.round((enter / (chain[n].length - 1)) * 10) / 10, leaving: Math.round((leave / (chain[n].length - 1)) * 10) / 10 };
  }
}
console.log(JSON.stringify(out, null, 1));
if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify(out, null, 1));
