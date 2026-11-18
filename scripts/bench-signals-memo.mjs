// Benchmark: applySignals without and with the per-run headline token cache, on the stories of a saved production-sized state.
// OFFLINE, read-only.  node scripts/bench-signals-memo.mjs --state <state.json> [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { clusterItems } from '../src/cluster.js';
import { mergeSameEvent } from '../src/merge.js';
import { applySignals, signalTokenizer } from '../src/collect.js';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const state = JSON.parse(readFileSync(arg('--state'), 'utf8'));
const items = state.items.filter((i) => !i.hidden).map((i) => ({ ...i, tr: state.tr?.[i.id] ? { en: state.tr[i.id].en } : null, athletes: i.athletes || [], teams: i.teams || [], ents: i.ents || [] }));
const clusters = mergeSameEvent(clusterItems(items), {});
const stories = clusters.map((c) => { const lead = c[0]; return { title: lead.title, t: { en: { title: lead.tr?.en || lead.title } }, langs: [...new Set(c.map((x) => x.lang))], athletes: lead.athletes || [], score: 1 + c.length, pop: 1 + c.length / 2 }; });
const signals = state.signals || {};
const heap = () => { globalThis.gc?.(); return process.memoryUsage().heapUsed; };
const run = (mk) => { const f = mk(); const t0 = process.hrtime.bigint(); const out = stories.map((s) => applySignals(s, signals, f)); return [Number(process.hrtime.bigint() - t0) / 1e6, out]; };
const [msBefore, before] = run(() => undefined); // default tokens(): the old behaviour
const h0 = heap();
let tk; const [msAfter, after] = run(() => (tk = signalTokenizer()));
const h1 = heap();
const res = {
  stories: stories.length, signalHeadlines: (signals.trends || []).reduce((n, t) => n + (t.news || []).length, 0) + (signals.reddit || []).length,
  beforeMs: Math.round(msBefore), afterMs: Math.round(msAfter), speedup: Math.round((msBefore / msAfter) * 10) / 10,
  identicalOutput: JSON.stringify(before) === JSON.stringify(after), storiesWithTrendOrReddit: after.filter((s) => s.trending || s.reddit).length,
  cacheHeapKB: globalThis.gc ? Math.round((h1 - h0) / 1024) : 'run with --expose-gc to measure',
};
console.log(JSON.stringify(res, null, 1));
if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify(res, null, 1));
if (!res.identicalOutput) process.exit(1);
