// Can the "Newest <-> Editorial rank" slider control which stories are AVAILABLE, not only how the same preselected 1,200 are ordered?
// OFFLINE replay on a saved state (see scripts/replay-lib.mjs); no network, no model, nothing written to the radar's data.
//
//   node scripts/bench-sorting-aware.mjs --state <state.json> [--json out.json]
//
// What the front end does (public/app.js): it loads news.json (newest 300 + Israeli) and news-more.json, puts them in one array
// (state.data.stories), and every tab, filter, search and slider position works on that array. The slider re-sorts by
// val = w * editorialScore/100 + (1 - w) * exp(-(now - first)/6h) (rankMix) and shows the first 300 (120 when the slider is 70 or more).
// The Top / football / basketball tabs first take out local, low and minor stories (OFFBEAT_TABS).
//
// Approaches compared, all with the same Israeli-first tier:
//   A  today: the newest non-Israeli stories up to 1,200
//   B  G1: the non-Israeli stories with the best mix at slider 50, up to 1,200 (src/capselect.js)
//   C  sorting-aware: the union of the lists the slider can show at positions 0, 25, 50, 75, 100 on the Top, football and basketball
//      tabs (the existing formulas, no new rule); its size is whatever the union is
//   C+ C topped up to 1,200 with B's next-best stories when it is smaller (a pool of exactly 1,200 that contains C)
//   CL  C plus, for each league the app can filter on (Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Champions League,
//       Europa League, NBA, Euroleague), the top 100 of that league at slider 0, 50 and 100 (size is whatever the union is)
//   C1200 C trimmed to exactly 1,200 when it is larger: the same lists taken in turn, best story of each list first, until the cap is reached
// Each is scored on how much of the TRUE list (built from every eligible story) it contains, at positions it was built for
// and at positions it was not (10, 35, 65, 85), so the pool is not just fitted to the test.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadReplay, H } from './replay-lib.mjs';
import { applyCap, capStories, isIsraeli } from '../src/capselect.js';
import { storyEvidence, storyCoverage } from '../src/roles.js';
import { editorialRank, loadRankConfig, loadVocabulary } from '../src/rank.js';

const ROOT = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const statePath = arg('--state');
if (!statePath) throw new Error('--state <state.json> is required');
const { end, eligibleAt } = loadReplay(statePath, arg('--entities', join(dirname(statePath), 'entities.json')));
const rankCfg = loadRankConfig(join(ROOT, 'config', 'editorial-rank.json'));
loadVocabulary(join(ROOT, 'config', 'vocabulary.json'));

// measured on the live site 2026-11-18 (1,200 stories): see docs/sorting-aware.md
const BYTES_RAW = 3028, BYTES_GZ = 843, PARSE_MS = 24 / 1200, HEAP_KB = 5.8;

const edOf = (s, T) => {
  const { roles: _r, ...ev } = storyEvidence(s, () => ({}));
  return editorialRank({ ...s, ev, cov: storyCoverage(s, { ok: false }, ev) }, { now: T, cfg: rankCfg });
};
const BUILD = [0, 25, 50, 75, 100];
const TEST = [0, 10, 25, 35, 50, 65, 75, 85, 100];
const TABS = {
  top: (s) => s.sport !== 'other' || s.big,
  football: (s) => !isIsraeli(s) && s.sport === 'football',
  basketball: (s) => !isIsraeli(s) && s.sport === 'basketball',
};
const offbeat = (s) => !s.local && !s.low && !s.minor;
const list = (stories, T, tab, p, ed) => {
  const w = p / 100;
  const v = (s) => w * (ed.get(s).score / 100) + (1 - w) * Math.exp(-(T - s.first) / (6 * H));
  return stories.filter((s) => TABS[tab](s) && offbeat(s)).sort((a, b) => v(b) - v(a) || (a.id < b.id ? -1 : 1)).slice(0, p >= 70 ? 120 : 300);
};
const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);
const mean = (a) => Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10;

function approaches(stories, T, ed) {
  const A = new Set(capStories(stories, 1200));
  const g = applyCap(stories, { mode: 'on', max: 1200, now: T, scoreOf: (s) => ed.get(s).score });
  const B = new Set(g.published);
  const israeli = new Set(stories.filter(isIsraeli));
  const C = new Set(israeli);
  for (const tab of Object.keys(TABS)) for (const p of BUILD) for (const s of list(stories, T, tab, p, ed)) C.add(s);
  const Cplus = new Set(C);
  for (const r of g.ranked) if (Cplus.size < 1200) Cplus.add(r.s);
  // C trimmed to the cap: the Israeli tier, then the lists in turn (rank 1 of every list, rank 2 of every list ...) until 1,200
  const lists = [];
  for (const tab of Object.keys(TABS)) for (const p of BUILD) lists.push(list(stories, T, tab, p, ed).filter((s) => !israeli.has(s)));
  const C1200 = new Set([...israeli].slice(0, 1200));
  for (let r = 0; r < 300 && C1200.size < 1200; r++) for (const l of lists) if (r < l.length && C1200.size < 1200) C1200.add(l[r]);
  for (const r of g.ranked) if (C1200.size < 1200) C1200.add(r.s);
  const CL = new Set(C);
  for (const comp of ['c-epl', 'c-laliga', 'c-seriea', 'c-bundes', 'c-ligue1', 'c-ucl', 'c-uel', 'c-nba', 'c-euroleague']) for (const p of [0, 50, 100]) {
    const w = p / 100;
    const v = (s) => w * (ed.get(s).score / 100) + (1 - w) * Math.exp(-(T - s.first) / (6 * H));
    for (const s of stories.filter((s) => s.comps?.includes(comp) && TABS.top(s) && offbeat(s)).sort((a, b) => v(b) - v(a) || (a.id < b.id ? -1 : 1)).slice(0, 100)) CL.add(s);
  }
  return { A, B, C, 'C+': Cplus, C1200, CL, ranked: g.ranked };
}

// editors also filter (league, language) before sorting; the pool is built without knowing the filters, so this is the honest test of them
const FILTERS = { 'league: Premier League': (s) => s.comps?.includes('c-epl'), 'league: NBA': (s) => s.comps?.includes('c-nba'), 'league: Euroleague': (s) => s.comps?.includes('c-euroleague'), 'league: Champions League': (s) => s.comps?.includes('c-ucl'), 'language: Hebrew': (s) => s.langs.includes('he') };
const filtered = {};
const out = { state: statePath, snapshots: [], perAppoach: {} };
const SNAPS = [0, 3, 6, 9, 12].map((h) => end - h * H);
const acc = {};
const old = {};
for (const T of SNAPS) {
  const stories = eligibleAt(T);
  const ed = new Map(stories.map((s) => [s, edOf(s, T)]));
  const set = approaches(stories, T, ed);
  for (const name of ['A', 'B', 'C', 'C+', 'C1200', 'CL']) {
    const a = (acc[name] ||= { size: [], recall: {}, minRecall: [] });
    a.size.push(set[name].size);
    const all = [];
    for (const tab of Object.keys(TABS)) for (const p of TEST) {
      const want = list(stories, T, tab, p, ed);
      const r = pct(want.filter((s) => set[name].has(s)).length, want.length);
      (a.recall[`${tab}@${p}${BUILD.includes(p) ? '' : ' (not used to build C)'}`] ||= []).push(r);
      all.push(r);
    }
    a.minRecall.push(Math.min(...all));
  }
  for (const [fname, f] of Object.entries(FILTERS)) for (const p of [0, 50, 100]) {
    const w = p / 100;
    const v = (s) => w * (ed.get(s).score / 100) + (1 - w) * Math.exp(-(T - s.first) / (6 * H));
    const want = stories.filter((s) => TABS.top(s) && offbeat(s) && f(s)).sort((a, b) => v(b) - v(a) || (a.id < b.id ? -1 : 1)).slice(0, p >= 70 ? 120 : 300);
    if (!want.length) continue;
    for (const name of ['A', 'B', 'C', 'C1200', 'CL']) ((filtered[`${fname} @${p}`] ||= {})[name] ||= []).push(pct(want.filter((s) => set[name].has(s)).length, want.length));
  }
  // older high-value stories: the ones the old cap cut whose timeless editorial score (no freshness, no Sport5 check) reaches the shown top 10%
  const KEYS = ['israel', 'importance', 'news', 'attention', 'evidence'];
  const tw = KEYS.reduce((x, k) => x + rankCfg.weights[k], 0);
  const timeless = (s) => (100 * KEYS.reduce((x, k) => x + rankCfg.weights[k] * (ed.get(s).dims[k] ?? 0), 0)) / tw * (s.local || s.minor ? 0.5 : s.routine ? 0.75 : 1);
  const shownA = [...set.A].filter((s) => !isIsraeli(s)).map(timeless).sort((x, y) => x - y);
  const p90 = shownA[Math.floor(shownA.length * 0.9)];
  const cutA = stories.filter((s) => !set.A.has(s) && !s.low && timeless(s) >= p90);
  for (const name of ['A', 'B', 'C', 'C+', 'C1200', 'CL']) (old[name] ||= []).push(pct(cutA.filter((s) => set[name].has(s)).length, cutA.length));
  out.snapshots.push({ at: new Date(T).toISOString(), eligible: stories.length, israeli: stories.filter(isIsraeli).length, olderHighValueCutByToday: cutA.length });
}
for (const [name, a] of Object.entries(acc)) {
  const recall = Object.fromEntries(Object.entries(a.recall).map(([k, v]) => [k, mean(v)]));
  const size = mean(a.size);
  out.perAppoach[name] = {
    publishedStories: size,
    extraOver1200: Math.round(size - 1200),
    extraRawKB: Math.round(((size - 1200) * BYTES_RAW) / 1024),
    extraGzipKB: Math.round(((size - 1200) * BYTES_GZ) / 1024),
    extraParseMs: Math.round((size - 1200) * PARSE_MS * 10) / 10,
    extraHeapMB: Math.round(((size - 1200) * HEAP_KB) / 1024 * 10) / 10,
    minimumRecallAnyTabAnyPosition: mean(a.minRecall),
    meanRecallTopTab: mean(Object.entries(recall).filter(([k]) => k.startsWith('top@')).map(([, v]) => v)),
    recall,
    olderHighValueStoriesRestored: mean(old[name] || [0]),
  };
}

out.filteredViews = Object.fromEntries(Object.entries(filtered).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([n, a]) => [n, mean(a)]))]));
// churn between consecutive 5-minute runs, as a proxy for the size of data/delta.json (stories entering or leaving the published set)
{
  const chain = [];
  for (let k = 12; k >= 0; k--) {
    const T = end - k * 5 * 60e3;
    const stories = eligibleAt(T);
    const ed = new Map(stories.map((s) => [s, edOf(s, T)]));
    const set = approaches(stories, T, ed);
    chain.push(Object.fromEntries(['A', 'B', 'C', 'C+', 'C1200', 'CL'].map((n) => [n, new Set([...set[n]].map((s) => s.id))])));
  }
  out.churnPerRun = {};
  for (const n of ['A', 'B', 'C', 'C+', 'C1200', 'CL']) {
    let enter = 0, leave = 0;
    for (let i = 1; i < chain.length; i++) {
      for (const id of chain[i][n]) if (!chain[i - 1][n].has(id)) enter++;
      for (const id of chain[i - 1][n]) if (!chain[i][n].has(id)) leave++;
    }
    out.churnPerRun[n] = { entering: Math.round((enter / (chain.length - 1)) * 10) / 10, leaving: Math.round((leave / (chain.length - 1)) * 10) / 10 };
  }
}
console.log(JSON.stringify(out, null, 1));
if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify(out, null, 1));
