// Gemini efficiency audit. OFFLINE: no request leaves this machine (fetch is replaced by a stub), nothing is written to the radar's data.
//
//   node scripts/gemini-audit.mjs --state <state.json> [--json docs/gemini-audit.json] [--cool5 10]
//
// Part A  what a saved production state shows (measured): the AI outputs per day / hour and per kind, the counter, the attempts in `hourly`.
// Part B  the REAL aiSummaries() (src/ai.js, unchanged) replayed over 24 hours of 5-minute runs on the stories of the saved state, against a stub
//         that answers like Gemini does in six situations. Request counts, outputs, pacing blocks and per-story delay are measured on the real code;
//         the seconds of waiting use ASSUMED latencies (LAT below), so they are labelled as assumptions.
// Part C  the same replay with ONE candidate change (a bounded cooldown after an all-models 5xx run), applied to a throw-away copy of ai.js.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clusterItems, buildStory } from '../src/cluster.js';
import { mergeSameEvent } from '../src/merge.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const statePath = arg('--state');
if (!statePath) throw new Error('--state <state.json> is required');
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const H = 3600e3, RUN = 5 * 60e3;
const out = { state: statePath, savedAt: new Date(state.savedAt).toISOString() };

// ---------- Part A: saved state ----------
{
  const a = state.ai || {};
  const byDay = (o) => { const d = {}; for (const r of Object.values(o || {})) { const k = new Date(r.at).toISOString().slice(0, 10); d[k] = (d[k] || 0) + 1; } return d; };
  const byHour = (o, day) => { const d = {}; for (const r of Object.values(o || {})) { const k = new Date(r.at).toISOString(); if (k.startsWith(day)) d[k.slice(11, 13)] = (d[k.slice(11, 13)] || 0) + 1; } return d; };
  const day = a.day;
  const hourly = (a.hourly || []).slice().sort((x, y) => x - y);
  const pairs = hourly.filter((t, i) => hourly[i + 1] === t || hourly[i - 1] === t).length;
  out.saved = {
    day, counterUsed: a.used, tokens: a.tokens, cardCounter: a.cls, strong: a.strong, altOff: !!a.altOff, mainOffDay: a.mainOffDay || null, model: a.model,
    cooldownUntil: a.cooldownUntil ? new Date(a.cooldownUntil).toISOString() : null,
    outputsPerDay: { summaries: byDay(a.res), headlines: byDay(a.heads), cards: byDay(a.desk) },
    outputsPerHourOnDay: { summaries: byHour(a.res, day), headlines: byHour(a.heads, day), cards: byHour(a.desk, day) },
    hourlyWindow: { entries: hourly.length, paceLimit: Math.ceil(400 / 20), entriesSharingATimestamp: pairs, note: 'two entries with the same timestamp are two attempts of ONE call (the strong model failed, the light one answered)' },
  };
  const todaySummaries = (byDay(a.res)[day] || 0), todayHeads = (byDay(a.heads)[day] || 0), todayCards = (byDay(a.desk)[day] || 0);
  out.saved.requestsPerOutput = { counterAttempts: a.used, summariesAndHeadlines: todaySummaries + todayHeads, summaryCallsAtLeast: Math.ceil(todaySummaries / 5) + Math.ceil(todayHeads / 30), cardCallsAtLeast: Math.ceil(todayCards / 20), cardCounter: a.cls?.used };
}

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
    const f = scn(b.model, run.k);
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

// ---------- Part B: the real code ----------
process.env.AI_API_KEY = 'audit-key';
delete process.env.AI_RICH_SUMMARIES;
const real = await import(pathToFileURL(fileURLToPath(new URL('../src/ai.js', import.meta.url))).href);
out.replayCurrentCode = {};
for (const [name, scn] of Object.entries(SCEN)) out.replayCurrentCode[name] = await replay(real, scn);
// the state the saved production record had: the backup strong model switched off for good (altOff), the strong model out of quota
out.replayCurrentCode['strong model 429 and altOff already true (the saved state)'] = await replay(real, SCEN['strong model 429 (not "per day" in the text), all day'], { init: { altOff: true } });
out.replayCurrentCode['3 stories whose answers are always rejected'] = await replay(real, SCEN.healthy, { poison: true });

// ---------- Part C: one candidate, on a copy of ai.js, for several cooldown lengths ----------
// After a run in which the summary path failed with a 5xx / timeout on every model it tried, no summary-path request for N minutes (the existing
// `cooldownUntil` that already follows a 429); a card request that fails the same way stops the card path for the same time (`clsCooldown`).
const srcPath = fileURLToPath(new URL('../src/ai.js', import.meta.url));
out.replayCooldown5xx = {};
for (const mins of [5, 10, 15, 30]) {
  let patched = readFileSync(srcPath, 'utf8');
  const need = (a, b) => { if (!patched.includes(a)) throw new Error('anchor not found: ' + a.slice(0, 50)); patched = patched.replace(a, b); };
  need("if (/HTTP 429/.test(st.error)) st.cooldownUntil = now + 30 * 60000; // both models rate-limited: wait a while", `if (/HTTP 429/.test(st.error)) st.cooldownUntil = now + 30 * 60000; // both models rate-limited: wait a while
    else if (/HTTP 5\\d\\d|abort|timeout/i.test(st.error)) st.cooldownUntil = now + ${mins} * 60000;`);
  need("if (/HTTP 429/.test(e.message)) st.clsCooldown = now + 30 * 60000;", `if (/HTTP 429/.test(e.message)) st.clsCooldown = now + 30 * 60000;
      else if (/HTTP 5\\d\\d|abort|timeout/i.test(e.message)) st.clsCooldown = now + ${mins} * 60000;`);
  const copy = fileURLToPath(new URL(`../src/.ai-audit-variant-${mins}.mjs`, import.meta.url));
  writeFileSync(copy, patched);
  try {
    const variant = await import(pathToFileURL(copy).href);
    const r = (out.replayCooldown5xx[`${mins} min`] = {});
    for (const name of ['all models 503 all day', 'all models 503, 3 bursts of 2 h', 'strong model 503 all day', 'healthy']) r[name] = await replay(variant, SCEN[name]);
  } finally { rmSync(copy, { force: true }); }
}

const text = JSON.stringify(out, null, 1);
console.log(text);
if (arg('--json')) writeFileSync(arg('--json'), text);
