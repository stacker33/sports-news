// Offline profile of one collector run on a SAVED state sized like production. No live request, nothing written to the radar's data.
//
//   node scripts/profile-collector.mjs --state <state.json> [--items 33219] [--new-titles 70] [--ai-503] [--cpu] [--json out.json]
//
// What it does
//   1. copies the saved state into a temp directory, keeps the newest --items articles, and moves every timestamp in it forward so the articles
//      are as fresh as they were when the state was saved (otherwise the 48-hour expiry would empty it);
//   2. drops the translation cache of the newest --new-titles articles (about what a real run collects), so translation has work to do;
//   3. runs the REAL collector (src/collect.js, a temporary copy with extra timer marks inside the stages; the marks change no behaviour) in a
//      child process with the network replaced by test/fixtures/profile-fetch.mjs: it counts every request by purpose and stage, answers
//      translation requests with a copy of the text, and answers Gemini with HTTP 503 (--ai-503) or nothing, with no waiting;
//   3. reads the [timing] line (stages and sub-steps), the request counts and, with --cpu, a V8 CPU profile (self time by function and file).
// Because the network answers at once, the times are the LOCAL CPU work (plus the collector's own pauses, which are counted separately).
// Compare with the production [timing] line to see how much of a stage is waiting for the network.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, existsSync, readdirSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(k);
const statePath = arg('--state');
if (!statePath) throw new Error('--state <state.json> is required');
const ITEMS = Number(arg('--items', 33219));
const NEW_TITLES = Number(arg('--new-titles', 70));

// the extra marks: [anchor text, name of the step that ENDS at the anchor]. Each anchor must exist exactly once.
const MARKS = [
  ['  // Topic tags (competitions, teams, players) from the 365Scores knowledge base', 'enrich.translateTitles'],
  ['  const eindex = entityIndex(edb);', 'enrich.entityDb'],
  ['  // Readers\' \u{1F3F7}\u{FE0F} corrections', 'enrich.entityIndex'],
  ['  // (Re-)tag every item:', 'enrich.corrections'],
  ['  // Pass 2: a word model trained', 'enrich.pass1Tagging'],
  ['  const decisions = items.map(', 'enrich.trainModel'],
  ['  // What\'s in the news right now: a club that exists in both sports', 'enrich.predictSport'],
  ['  // Double-check names: a surname alone', 'enrich.sportAssign'],
  ['  const liveIds = new Set(items.map((i) => i.id));', 'enrich.nameCheck'],
  ['  // Popularity signals (Google Trends + Reddit)', 'enrich.trCacheClean'],
  ['  // What the story is about, most relevant first', 'enrich.signalsWiki'],
  ['  const { ids: storyIdList, map: storyIds } = assignStoryIds(clusters, state.storyIds);', 'cluster.mergeSameEvent'],
  ['  const stories = clusters\n', 'cluster.storyIds'],
  ['  // foreign-language summaries → Hebrew + English (cached with the summary)', 'ai.fillSummaries'],
  ['  // Hebrew headline + 2–3 sentence summary by a language model', 'ai.translateSummaries'],
  ['  const { ai, done: aiDone } = await aiSummaries(', 'ai.prepareNames'],
];

function instrument(src) {
  let s = src;
  for (const [anchor, name] of MARKS) {
    const n = s.split(anchor).length - 1;
    if (n !== 1) throw new Error(`profile anchor found ${n} times (expected 1): ${anchor.slice(0, 60)}`);
    s = s.replace(anchor, () => `  timer.mark('${name}');\n${anchor}`);
  }
  // the clustering call split in two (grouping, then the same-event merge)
  const call = 'const clusters = mergeSameEvent(clusterItems(items.filter((i) => !i.hidden)), state.ai?.desk);';
  if (!s.includes(call)) throw new Error('clustering call not found');
  s = s.replace(call, () => "const __grouped = clusterItems(items.filter((i) => !i.hidden));\n  timer.mark('cluster.clusterItems');\n  const clusters = mergeSameEvent(__grouped, state.ai?.desk);");
  // aiSummaries is timed on its own: the mark after it already exists as 'ai'
  // every timer.mark(name) also tells the network mock which step is next (requests are counted per step)
  s = s.replace(/timer\.mark\('([^']+)'\);/g, (m, name) => `timer.mark('${name}'); globalThis.__after = '${name}';`);
  return s;
}

// ---- the state: newest N articles, timestamps moved to now ----
console.error('reading the saved state ...');
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const items = [...state.items].sort((a, b) => b.published - a.published).slice(0, ITEMS);
const keep = new Set(items.map((i) => i.id));
state.items = items;
const NOW = Number(arg('--freeze', 0)) || Date.now(); // --freeze <epoch ms>: the child's clock stands still there, so two runs of different code are comparable
const delta = NOW - 10 * 60e3 - state.savedAt; // as if the state had been saved 10 minutes ago
const LO = state.savedAt - 20 * 864e5, HI = state.savedAt + 864e5;
const shift = (v) => {
  if (typeof v === 'number') return v >= LO && v <= HI ? v + delta : v;
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = shift(v[i]); return v; }
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = shift(v[k]); return v; }
  return v;
};
for (const k of Object.keys(state)) if (k !== 'items') state[k] = shift(state[k]);
for (const it of state.items) { it.published = shift(it.published); it.seen = shift(it.seen); if (it.via) it.via.at = shift(it.via.at); }
state.savedAt = shift(state.savedAt);
if (state.ai) state.ai.day = new Date(NOW).toISOString().slice(0, 10);
// the translation cache: only the articles still in memory, minus the newest few (what a real run has to translate)
const newest = new Set(items.slice(0, NEW_TITLES).map((i) => i.id));
state.tr = Object.fromEntries(Object.entries(state.tr || {}).filter(([id]) => keep.has(id) && !newest.has(id)));
const data = mkdtempSync(join(tmpdir(), 'profile-'));
writeFileSync(join(data, 'state.json'), JSON.stringify(state));
const ent = join(dirname(statePath), 'entities.json');
if (existsSync(ent)) copyFileSync(ent, join(data, 'entities.json'));

// ---- the instrumented collector ----
const copy = join(ROOT, 'src', '.collect-profile.mjs');
writeFileSync(copy, instrument(readFileSync(join(ROOT, 'src', 'collect.js'), 'utf8')));
const preload = pathToFileURL(join(ROOT, 'test', 'fixtures', 'profile-fetch.mjs')).href;
const cpuDir = mkdtempSync(join(tmpdir(), 'cpuprof-'));
const nodeArgs = [...(flag('--cpu') ? ['--cpu-prof', `--cpu-prof-dir=${cpuDir}`, '--cpu-prof-interval=500'] : []), '--import', preload, copy];
console.error(`running the collector on ${items.length} articles ...`);
const t0 = Date.now();
const r = spawnSync(process.execPath, nodeArgs, { cwd: ROOT, env: { PATH: process.env.PATH, RADAR_DATA_DIR: data, CAP_G1: 'on', AI_API_KEY: 'profile-key', MOCK_AI: flag('--ai-503') ? '503' : '', MOCK_TRANSLATE: '1', STATE_ERROR_FILE: join(data, '.err'), ...(flag('--freeze') ? { FREEZE_NOW: String(NOW) } : {}) }, encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 28 });
const wall = Date.now() - t0;
rmSync(copy, { force: true });
if (r.status !== 0) { console.error(r.stderr.slice(-2000)); throw new Error(`collector exited ${r.status}`); }

const timingLine = r.stdout.split('\n').find((l) => l.startsWith('[timing] '));
const timing = JSON.parse(timingLine.slice(9));
const mockLine = r.stdout.split('\n').find((l) => l.startsWith('PROFILE_FETCH '));
const mock = JSON.parse(mockLine.slice('PROFILE_FETCH '.length));
const out = { state: statePath, articlesInMemory: items.length, newTitlesToTranslate: NEW_TITLES, wallMs: wall, maxRssMB: mock.maxRssMB, stageMs: timing, requests: mock.requests, requestsByStage: mock.byStage, aiCalls: mock.ai, translateBatches: mock.translateBatches };

// ---- the CPU profile: self time by function and by file ----
if (flag('--cpu')) {
  const f = readdirSync(cpuDir).find((x) => x.endsWith('.cpuprofile'));
  const prof = JSON.parse(readFileSync(join(cpuDir, f), 'utf8'));
  const dt = new Map();
  for (let i = 0; i < prof.samples.length; i++) dt.set(prof.samples[i], (dt.get(prof.samples[i]) || 0) + (prof.timeDeltas[i] || 0));
  const byFn = new Map(), byFile = new Map();
  let total = 0;
  for (const n of prof.nodes) {
    const us = dt.get(n.id) || 0;
    total += us;
    const cf = n.callFrame;
    const file = (cf.url || '(native)').replace(/^file:\/\/\/[A-Za-z]:\/[^/]+\/[^/]+\//, '').replace(/.*\/node_modules\//, 'node_modules/');
    const key = `${cf.functionName || '(anonymous)'} ${file}:${cf.lineNumber + 1}`;
    byFn.set(key, (byFn.get(key) || 0) + us);
    byFile.set(file, (byFile.get(file) || 0) + us);
  }
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, us]) => ({ k, ms: Math.round(us / 1000), pct: Math.round((1000 * us) / total) / 10 }));
  // inclusive time (the function and everything it calls) and the callers of the hottest functions
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const selfOf = (id) => (dt.get(id) || 0);
  const incl = new Map();
  const inclusive = (id) => { const n = byId.get(id); let t = selfOf(id); for (const c of n.children || []) t += inclusive(c); incl.set(id, t); return t; };
  inclusive(prof.nodes[0].id);
  const fnName = (id) => { const cf = byId.get(id).callFrame; return `${cf.functionName || '(anonymous)'}:${(cf.url || '').split('/').pop()}:${cf.lineNumber + 1}`; };
  const inclByName = new Map();
  for (const n of prof.nodes) {
    // count a function once per call path: skip when an ancestor is the same function (recursion)
    let anc = parent.get(n.id), rec = false;
    while (anc != null) { if (byId.get(anc).callFrame.functionName === n.callFrame.functionName && byId.get(anc).callFrame.url === n.callFrame.url) { rec = true; break; } anc = parent.get(anc); }
    if (!rec) inclByName.set(fnName(n.id), (inclByName.get(fnName(n.id)) || 0) + incl.get(n.id));
  }
  const callersOf = (name) => { const m = new Map(); for (const n of prof.nodes) if (n.callFrame.functionName === name && n.callFrame.url) { const p = parent.get(n.id); const pn = p != null ? fnName(p) : '(root)'; m.set(pn, (m.get(pn) || 0) + incl.get(n.id)); } return [...m].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, us]) => ({ caller: k, ms: Math.round(us / 1000) })); };
  const HOT = ['tokens', 'ilParts', 'findEntities', 'classify', 'applySignals', 'annotateWatch', 'buildStory', 'sport5Coverage', 'sport5Probable', 'editorialBoost', 'attachDesk', 'markLocal', 'markLow', 'clusterItems', 'mergeSameEvent', 'storyTags', 'storyComps', 'editorialRank', 'storyEvidence', 'telegramPost', 'morningBrief', 'trendBoard', 'trainModel', 'predict', 'decideSport', 'features'];
  out.cpuProfile = { totalMs: Math.round(total / 1000), topFunctions: top(byFn, 25), topFiles: top(byFile, 15), inclusiveMs: Object.fromEntries(HOT.map((h) => [h, Math.round([...inclByName].filter(([k]) => k.startsWith(h + ':') && !/node_modules/.test(k)).reduce((a2, [, us]) => a2 + us, 0) / 1000)])), callers: { tokens: callersOf('tokens'), ilParts: callersOf('ilParts'), findEntities: callersOf('findEntities'), norm: callersOf('norm') } };
}
if (arg('--keep-data')) cpSync(data, arg('--keep-data'), { recursive: true }); // the files the run wrote (published JSON, state)
rmSync(data, { recursive: true, force: true });
rmSync(cpuDir, { recursive: true, force: true });
console.log(JSON.stringify(out, null, 1));
if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify(out, null, 1));
