// Benchmark of the editorial-aware cap (CAP_G1, src/capselect.js) on a saved radar state. OFFLINE: no network, no model, nothing written to
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
import { clusterItems, buildStory } from '../src/cluster.js';
import { mergeSameEvent } from '../src/merge.js';
import { bigEvent, editorialBoost, markLocal, markLow, memberLocal } from '../src/editorial.js';
import { storyEvidence, storyCoverage } from '../src/roles.js';
import { editorialRank, loadRankConfig, loadVocabulary } from '../src/rank.js';
import { applyCap, capStories, mixValue, isIsraeli } from '../src/capselect.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const statePath = arg('--state');
if (!statePath) throw new Error('--state <state.json> is required');
const entitiesPath = arg('--entities', join(dirname(statePath), 'entities.json'));
const RUNS = Number(arg('--runs', 13));
const H = 3600e3;

const state = JSON.parse(readFileSync(statePath, 'utf8'));
const edb = JSON.parse(readFileSync(entitiesPath, 'utf8'));
const items = state.items.map((it) => ({ ...it, tr: state.tr?.[it.id] ? { en: state.tr[it.id].en } : null, athletes: it.athletes || [], teams: it.teams || [], ents: it.ents || [] }));
const end = Math.max(...items.map((i) => i.published));
const rankCfg = loadRankConfig(join(ROOT, 'config', 'editorial-rank.json'));
loadVocabulary(join(ROOT, 'config', 'vocabulary.json'));

const entById = new Map();
for (const [k, t] of Object.entries(edb.teams)) entById.set(`t${k}`, { k: 'team', id: `t${k}`, sport: t.sport });
for (const [k, p] of Object.entries(edb.players)) entById.set(`p${k}`, { k: 'player', id: `p${k}`, team: `t${p.team}` });
const COMP_OF_365 = { 42: 'c-ligat', 43: 'c-leumit', 7: 'c-epl', 11: 'c-laliga', 17: 'c-seriea', 25: 'c-bundes', 35: 'c-ligue1', 572: 'c-ucl', 573: 'c-uel', 7685: 'c-uecl', 47: 'c-winner', 569: 'c-euroleague', 329: 'c-eurocup', 103: 'c-nba' };
const teamComps = (id) => (edb.teams?.[String(id).slice(1)]?.comps || []).map((c) => COMP_OF_365[c]).filter(Boolean);
const compsOf = (members) => {
  const set = new Set();
  for (const m of members) for (const id of m.ents || []) {
    if (id.startsWith('c-')) set.add(id);
    const e = entById.get(id);
    if (e?.k === 'team') teamComps(id).forEach((c) => set.add(c));
    else if (e?.k === 'player' && e.team) teamComps(e.team).forEach((c) => set.add(c));
  }
  return [...set];
};
const tagsOf = (members) => {
  const count = new Map();
  for (const m of members) for (const id of new Set(m.ents || [])) count.set(id, (count.get(id) || 0) + 1);
  const minShare = members.length > 5 ? Math.ceil(members.length * 0.2) : 1;
  return [...count].filter(([id, n]) => n >= minShare && (id.startsWith('c-') || entById.get(id)?.k === 'team')).map(([id]) => ({ k: id.startsWith('c-') ? 'comp' : 'team', id }));
};

// the stories as the cap receives them at time T (the stages of src/collect.js before the cap), newest last article first
function eligibleAt(T) {
  const live = items.filter((i) => (i.seen ?? i.published) <= T && T - i.published <= 48 * H && !i.hidden);
  const merged = mergeSameEvent(clusterItems(live.map((i) => ({ ...i }))), {});
  const out = [];
  for (const members of merged) {
    let s = { ...buildStory(members, T), _members: members, comps: compsOf(members), tags: tagsOf(members) };
    if (T - s.latest > 36 * H) continue;
    s.big = s.sourceCount >= 3 || s.langs.length >= 3 || ((s.top || s.breaking) && s.sourceCount >= 2);
    if (s.sport === 'other' && !(s.israel || s.abroad || (s.sourceCount >= 8 && s.langs.length >= 3) || bigEvent(s))) continue;
    s = markLow(markLocal(editorialBoost(s), (m) => memberLocal(m, undefined)));
    if (s._members.every((m) => m.assist) && !(s.israel || s.abroad || s.teams.length)) continue;
    out.push(s);
  }
  return out.sort((a, b) => b.latest - a.latest);
}
const scoreOf = (s) => {
  const { roles: _r, ...ev } = storyEvidence(s, () => ({}));
  return editorialRank({ ...s, ev, cov: storyCoverage(s, { ok: false }, ev) }, { now: s._now, cfg: rankCfg }).score;
};

// what the app shows on the Top tab for a slider position, from a list of stories (public/app.js visibleStories / rankMix)
const topList = (list, T, mix, score) => {
  const w = mix / 100;
  const v = (s) => w * (score.get(s) / 100) + (1 - w) * Math.exp(-(T - s.first) / (6 * H));
  return list.filter((s) => (s.sport !== 'other' || s.big) && !s.local && !s.low && !s.minor).sort((a, b) => v(b) - v(a)).slice(0, mix >= 70 ? 120 : 300);
};
const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);
const mb = (b) => Math.round(b / 1048576);

const result = { state: statePath, runs: RUNS, replayed: [] };
let prev = new Set(), prevNoBonus = new Set(), legacyPrev = new Set();
const jac = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return a.size + b.size - i ? i / (a.size + b.size - i) : 1; };
const churn = { withBonus: [], withoutBonus: [], legacy: [] };
for (let k = RUNS - 1; k >= 0; k--) {
  const T = end - k * 5 * 60e3;
  const stories = eligibleAt(T);
  for (const s of stories) s._now = T;
  if (global.gc) global.gc();
  const mem0 = process.memoryUsage();
  const t0 = process.hrtime.bigint();
  const score = new Map();
  const cache = (s) => { if (!score.has(s)) score.set(s, scoreOf(s)); return score.get(s); };
  const g = applyCap(stories, { mode: 'on', max: 1200, now: T, scoreOf: cache, prevKept: prev });
  const totalMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const mem1 = process.memoryUsage();
  const gNo = applyCap(stories, { mode: 'on', max: 1200, now: T, scoreOf: cache, prevKept: new Set() });
  const legacy = capStories(stories, 1200);
  for (const s of stories) cache(s);
  const keptIds = new Set(g.published.map((s) => s.id));
  const noBonusIds = new Set(gNo.published.map((s) => s.id));
  const legacyIds = new Set(legacy.map((s) => s.id));
  if (prev.size) { churn.withBonus.push(jac(keptIds, prev)); churn.withoutBonus.push(jac(noBonusIds, prevNoBonus)); churn.legacy.push(jac(legacyIds, legacyPrev)); }
  prev = keptIds; prevNoBonus = noBonusIds; legacyPrev = legacyIds;
  if (k === 0 || k === RUNS - 1) {
    const recall = (mix, set) => { const want = topList(stories, T, mix, score); return pct(want.filter((s) => set.has(s)).length, want.length); };
    const L = new Set(legacy), G = new Set(g.published);
    result.replayed.push({ at: new Date(T).toISOString(), eligible: stories.length, israeli: stories.filter(isIsraeli).length, scoredInMs: Math.round(totalMs), heapUsedDeltaMB: mb(mem1.heapUsed - mem0.heapUsed), rssMB: mb(mem1.rss), selectionMs: g.stats.selectMs, overlapWithLegacy: g.stats.overlap, added: g.stats.added, dropped: g.stats.dropped, recallNewestTop300: { legacy: recall(0, L), g1: recall(0, G) }, recallDefaultTop300: { legacy: recall(50, L), g1: recall(50, G) }, recallEditorialTop120: { legacy: recall(100, L), g1: recall(100, G) } });
  } else result.replayed.push({ at: new Date(T).toISOString(), eligible: stories.length, scoredInMs: Math.round(totalMs), selectionMs: g.stats.selectMs, overlapWithLegacy: g.stats.overlap });
}
const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10000) / 10000 : null);
result.churn = { note: 'Jaccard overlap of the published sets of consecutive 5-minute runs (1.0 = identical)', legacy: avg(churn.legacy), g1WithKeepBonus: avg(churn.withBonus), g1WithoutBonus: avg(churn.withoutBonus), minLegacy: Math.min(...churn.legacy), minG1WithBonus: Math.min(...churn.withBonus), minG1WithoutBonus: Math.min(...churn.withoutBonus) };
result.cost = { scoredStories: result.replayed.map((r) => r.eligible).reduce((a, b) => Math.max(a, b), 0), medianScoringMs: [...result.replayed.map((r) => r.scoredInMs)].sort((a, b) => a - b)[Math.floor(RUNS / 2)], maxScoringMs: Math.max(...result.replayed.map((r) => r.scoredInMs)), peakRssMB: Math.max(...result.replayed.filter((r) => r.rssMB).map((r) => r.rssMB)) };
console.log(JSON.stringify(result, null, 1));
if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify(result, null, 1));
