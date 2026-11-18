// Benchmark of the bounded 5xx pause: the code on origin/main (baseline) against this branch, on the same 24 hours of 5-minute runs.
// OFFLINE: the real aiSummaries() of each version runs against a stub of Gemini; no request leaves this machine.
//   node scripts/gemini-cooldown-bench.mjs --state <state.json> [--json docs/gemini-cooldown-bench.json]
// Request counts, outputs, pause behaviour and time-to-summary are measured on the real code. The SECONDS of waiting are not measured anywhere
// (see docs/gemini-5xx-cooldown.md): the wasted wait is reported as failed requests x an assumed latency L, for three values of L.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clusterItems, buildStory } from '../src/cluster.js';
import { mergeSameEvent } from '../src/merge.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const statePath = arg('--state');
if (!statePath) throw new Error('--state <state.json> is required');
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const H = 3600e3, RUN = 5 * 60e3;
const out = { state: statePath };
// ---------- the stories: the saved state, grouped as the collector groups them ----------
const items = state.items.filter((i) => !i.hidden).map((i) => ({ ...i, tr: state.tr?.[i.id] ? { en: state.tr[i.id].en } : null, athletes: i.athletes || [], teams: i.teams || [], ents: i.ents || [] }));
const tEnd = Math.max(...items.map((i) => i.seen || i.published));
const T0 = tEnd - 24 * H;
const clusters = mergeSameEvent(clusterItems(items.filter((i) => (i.seen || i.published) > T0 - 18 * H)), {});
const pool = clusters.map((c) => {
  const s = buildStory(c, tEnd);
  return { ...s, _members: c, _arrive: Math.min(...c.map((m) => m.seen || m.published)) };
}).filter((s) => s._arrive > T0 && s.first > T0 - 18 * H);
out.pool = { stories: pool.length, foreign: pool.filter((s) => s.lang !== 'he').length, window: [new Date(T0).toISOString(), new Date(tEnd).toISOString()] };

// ---------- the stub ----------
const LAT = { okStrong: 20, okLight: 8, e503: 13, e429: 0.2, timeout: 75 }; // seconds, ASSUMED except 429 (the saved state shows 134 ms)
const MSG = {
  503: { error: { code: 503, message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.', status: 'UNAVAILABLE' } },
  429: { error: { code: 429, message: 'You exceeded your current quota, please check your plan and billing details.', status: 'RESOURCE_EXHAUSTED' } },
  '429d': { error: { code: 429, message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 250, PerDay PerModel', status: 'RESOURCE_EXHAUSTED' } },
};
// scenario(model, runIndex) -> null (ok) | '503' | '429' | '429d'
const SCEN = {
  healthy: () => null,
  'strong model 503 all day': (m) => (m === 'gemini-flash-latest' || m === 'gemini-2.5-flash' ? '503' : null),
  'all models 503 all day': () => '503',
  'all models 503, 3 bursts of 2 h': (m, k) => ((k >= 40 && k < 64) || (k >= 120 && k < 144) || (k >= 200 && k < 224) ? '503' : null),
  'strong model 429 (not "per day" in the text), all day': (m) => (m === 'gemini-flash-latest' ? '429' : null),
  'strong model 429 "per day"': (m) => (m === 'gemini-flash-latest' ? '429d' : null),
};

// stories whose answer is always rejected by goodHe (e.g. a Latin letter glued to a Hebrew word): the 3 highest-scoring foreign stories
const POISON = pool.filter((x) => x.lang !== 'he').sort((a, b) => b.score - a.score).slice(0, 3).map((x) => x.title);
function makeFetch(scn, run, counts) {
  return async (url, opts = {}) => {
    const b = JSON.parse(opts.body);
    const sys = b.messages[0].content, user = b.messages[1].content;
    const op = /story cards for the world-sports desk/.test(sys) ? 'cards' : /numbered sports headlines/.test(sys) ? 'headlines' : 'summaries';
    const strong = b.model === 'gemini-flash-latest' || b.model === 'gemini-2.5-flash';
    const f = scn(b.model, run.k, op);
    const key = `${op} ${b.model}`;
    const c = (counts[key] ||= { ok: 0, fail: 0 });
    const resp = (status, body) => ({ ok: status === 200, status, text: async () => JSON.stringify(body), json: async () => body });
    if (f) { c.fail++; counts._wait += f === '503' ? LAT.e503 : LAT.e429; return resp(f === '503' ? 503 : 429, MSG[f]); }
    c.ok++; counts._wait += strong ? LAT.okStrong : LAT.okLight;
    let content;
    if (op === 'summaries' && run.poison) for (const t of POISON) if (user.includes(t)) counts._poisonAsks = (counts._poisonAsks || 0) + 1;
    if (op === 'summaries') content = { stories: [...user.matchAll(/### id: (s\d+)(?:[\s\S]*?)(?=### id: |$)/g)].map((blk) => { const m = [blk[0].match(/### id: (s\d+)/)[0], blk[0].match(/### id: (s\d+)/)[1]]; const bad = run.poison && POISON.some((t) => blk[0].includes(t)); return ({ id: m[1], title_he: bad ? 'bad' : 'כותרת בדיקה קצרה', summary_he: 'סיכום בדיקה קצר מאוד כאן', summary_en: 'Test summary here', facts_he: ['עובדה בדיקה אחת'], quotes_he: [] }); }) };
    else if (op === 'cards') content = { items: [...user.matchAll(/### id: (\d+)/g)].map((m) => ({ id: m[1], title_he: 'כותרת כרטיס בדיקה', summary_he: 'משפט בדיקה על הכרטיס', about: 'test', about_he: 'בדיקה', desk: true, sport: 'football' })) };
    else content = { titles: [...user.matchAll(/^(\d+)\. /gm)].map((m) => ({ id: m[1], title_he: 'כותרת בדיקה קצרה' })) };
    return resp(200, { choices: [{ message: { content: JSON.stringify(content) } }], usage: { total_tokens: 1000 } });
  };
}

async function replay(mod, scn, { init = {}, poison = false } = {}) {
  const counts = { _wait: 0 };
  const run = { k: 0, poison };
  globalThis.fetch = makeFetch(scn, run, counts);
  let ai = { ...init };
  const firstSummaryAt = new Map(); // story id -> sim time of its first summary
  const stat = { runs: 0, runsNoRoom: 0, runsWithCalls: 0, zeroSummaryRuns: 0, zeroSummaryRunsWithACall: 0, zeroSummaryRunsNoCallNoNeed: 0, summaries: 0, headlines: 0, cards: 0 };
  const waits = [];
  for (let k = 0; k < 288; k++) {
    run.k = k;
    const now = T0 + k * RUN;
    const stories = pool.filter((s) => s._arrive <= now).sort((a, b) => b.score - a.score);
    const before = { res: Object.keys(ai.res || {}).length, heads: Object.keys(ai.heads || {}).length, desk: Object.keys(ai.desk || {}).length, used: ai.used || 0 };
    const w0 = counts._wait; const callsBefore = Object.entries(counts).filter(([x]) => x[0] !== '_').reduce((n, [, v]) => n + v.ok + v.fail, 0);
    const r = await mod.aiSummaries(stories, {}, ai, now, new Map(), { styleHeads: [], rich: false });
    ai = r.ai;
    const callsNow = Object.entries(counts).filter(([x]) => x[0] !== '_').reduce((n, [, v]) => n + v.ok + v.fail, 0);
    stat.runs++;
    const dRes = Object.keys(ai.res).length - before.res;
    stat.summaries += dRes; stat.headlines += Object.keys(ai.heads).length - before.heads; stat.cards += Object.keys(ai.desk).length - before.desk;
    if (callsNow > callsBefore) stat.runsWithCalls++;
    if (dRes === 0) { stat.zeroSummaryRuns++; if (callsNow > callsBefore) stat.zeroSummaryRunsWithACall++; }
    if (ai.hourly.length >= Math.ceil(400 / 20) || ai.used >= 400) stat.runsNoRoom++;
    waits.push(counts._wait - w0);
    for (const s of stories) if (!firstSummaryAt.has(s.id) && ai.res?.[s._members.slice().sort((a, b) => a.published - b.published || (a.id < b.id ? -1 : 1))[0].id]) firstSummaryAt.set(s.id, now);
  }
  // does each of the day's top stories (by score, foreign or Hebrew) get a summary, and how fast?
  const top = pool.filter((s) => s.lang !== 'he').sort((a, b) => b.score - a.score).slice(0, 100);
  const delays = top.filter((s) => firstSummaryAt.has(s.id)).map((s) => (firstSummaryAt.get(s.id) - s._arrive) / 60e3).sort((a, b) => a - b);
  const requests = Object.fromEntries(Object.entries(counts).filter(([x]) => x[0] !== '_'));
  const total = Object.values(requests).reduce((n, v) => n + v.ok + v.fail, 0);
  const fails = Object.values(requests).reduce((n, v) => n + v.fail, 0);
  return {
    requests, totalRequests: total, failedRequests: fails, counterEndOfDay: ai.used, cardCounterEndOfDay: ai.cls?.used,
    outputs: { summaries: stat.summaries, headlines: stat.headlines, cards: stat.cards },
    runs: { total: stat.runs, withAnyRequest: stat.runsWithCalls, summaryPathBlockedByPacingOrCap: stat.runsNoRoom, zeroNewSummaries: stat.zeroSummaryRuns, zeroNewSummariesDespiteARequest: stat.zeroSummaryRunsWithACall },
    waitSecondsAssumed: { perDay: Math.round(counts._wait), perRunMean: Math.round(counts._wait / 288 * 10) / 10 },
    top100ForeignStories: { withASummaryByEndOfDay: delays.length, medianMinutesToSummary: delays.length ? Math.round(delays[Math.floor(delays.length / 2)]) : null, p90Minutes: delays.length ? Math.round(delays[Math.floor(delays.length * 0.9)]) : null },
    ...(poison ? { alwaysRejectedStories: { count: POISON.length, timesSentToTheModel: counts._poisonAsks || 0 } } : {}),
    stateEnd: { altOff: !!ai.altOff, mainOffDay: ai.mainOffDay || null, cooldownUntilSet: !!ai.cooldownUntil, clsCooldownSet: !!ai.clsCooldown },
  };
}


// ---------- scenarios: (model, op, runIndex) -> failing status or null ----------
let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const SC = {
  'healthy': () => null,
  'strong model 503 all day (light answers)': (m) => (m === 'gemini-flash-latest' || m === 'gemini-2.5-flash' ? '503' : null),
  'all models 503 all day': () => '503',
  'all models 503 in 3 bursts of 2 h': (m, o, k) => ((k >= 40 && k < 64) || (k >= 120 && k < 144) || (k >= 200 && k < 224) ? '503' : null),
  'only the card path fails (503) all day': (m, o) => (o === 'cards' ? '503' : null),
  'only summaries+headlines fail (503) all day': (m, o) => (o !== 'cards' ? '503' : null),
  'intermittent: 15% of all requests 503': () => (rnd() < 0.15 ? '503' : null),
  'intermittent: 30% of all requests 503': () => (rnd() < 0.3 ? '503' : null),
};

async function loadBaseline() {
  const src = execFileSync('git', ['show', 'origin/main:src/ai.js'], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', maxBuffer: 1 << 26 });
  const copy = fileURLToPath(new URL('../src/.ai-baseline.mjs', import.meta.url));
  writeFileSync(copy, src);
  try { return [await import(pathToFileURL(copy).href + '?b'), copy]; } catch (e) { rmSync(copy, { force: true }); throw e; }
}
process.env.AI_API_KEY = 'bench-key';
delete process.env.AI_RICH_SUMMARIES;
const [baseline, baseCopy] = await loadBaseline();
const current = await import(pathToFileURL(fileURLToPath(new URL('../src/ai.js', import.meta.url))).href);
// the same file with the pause starting after 2 failing runs instead of 3 (to see what the threshold buys)
const cur = readFileSync(fileURLToPath(new URL('../src/ai.js', import.meta.url)), 'utf8');
if (!cur.includes('export const COOL_5XX_AFTER = 3;')) throw new Error('threshold anchor not found');
const copy3 = fileURLToPath(new URL('../src/.ai-after2.mjs', import.meta.url));
writeFileSync(copy3, cur.replace('export const COOL_5XX_AFTER = 3;', 'export const COOL_5XX_AFTER = 2;'));
const after2 = await import(pathToFileURL(copy3).href);
const rows = {};
try {
  for (const [name, scn] of Object.entries(SC)) {
    const run = async (mod) => { seed = 12345; return replay(mod, (m, k, op) => scn(m, op, k)); };
    const a = await run(baseline), b = await run(after2), c = await run(current); // b: pause after 2 failing runs, c: after 3 (this branch)
    const pct = (x, y) => (x ? Math.round(((y - x) / x) * 100) : 0);
    const chg = (r) => ({ failedRequests: pct(a.failedRequests, r.failedRequests), totalRequests: pct(a.totalRequests, r.totalRequests), summaries: pct(a.outputs.summaries, r.outputs.summaries), headlines: pct(a.outputs.headlines, r.outputs.headlines), cards: pct(a.outputs.cards, r.outputs.cards) });
    rows[name] = {
      baseline: summarize(a), pauseAfter2FailingRuns: summarize(b), pauseAfter3FailingRuns: summarize(c),
      changeAfter2: chg(b), changeAfter3: chg(c),
      wastedWaitSecondsPerDay: Object.fromEntries([3, 13, 30].map((L) => [`if a failing request takes ${L} s`, { baseline: a.failedRequests * L, after2: b.failedRequests * L, after3: c.failedRequests * L, savedPerRunMeanAfter2: Math.round(((a.failedRequests - b.failedRequests) * L) / 288 * 10) / 10, savedPerRunMeanAfter3: Math.round(((a.failedRequests - c.failedRequests) * L) / 288 * 10) / 10 }])),
    };
  }
} finally { rmSync(baseCopy, { force: true }); rmSync(copy3, { force: true }); }
function summarize(r) { return { requests: r.totalRequests, failed: r.failedRequests, outputs: r.outputs, runsWithAnyRequest: r.runs.withAnyRequest, runsZeroNewSummaries: r.runs.zeroNewSummaries, top100: r.top100ForeignStories, counterEndOfDay: r.counterEndOfDay }; }
out.scenarios = rows;
const text = JSON.stringify(out, null, 1);
console.log(text);
if (arg('--json')) writeFileSync(arg('--json'), text);
