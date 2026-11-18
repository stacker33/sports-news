// The bounded 15-minute pause for repeated 5xx / timeout failures (src/ai.js). Offline: fetch is a stub.
// Rules under test: three failing runs in a row pause that request path for 15 minutes; an isolated failure that another model covers never
// counts; cards, summaries and headlines pause on their own; 429 handling is untouched; the pause survives a save/load of the state and lifts
// by itself (time, or one success).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.AI_API_KEY = 'test-key';
delete process.env.AI_RICH_SUMMARIES;
const { aiSummaries, COOL_5XX_MS, COOL_5XX_AFTER } = await import('../src/ai.js');

const MIN = 60e3;
const T0 = Date.parse('2026-11-18T12:00:00Z');
const STRONG = 'gemini-flash-latest', ALT = 'gemini-2.5-flash', LIGHT = 'gemini-flash-lite-latest';
const member = (i) => ({ id: `m${i}`, title: `Headline number ${i} about a match`, lang: 'en', publisher: `pub${i}`, weight: 1, published: T0 - 10 * MIN, summary: '' });
const story = (i, t) => ({ title: `Headline number ${i} about a match`, lang: 'en', score: 100 - i, first: t - 10 * MIN, sourceCount: 1, langs: ['en'], athletes: [], tags: [], _members: [{ ...member(i), published: t - 10 * MIN }] });
// a different set of stories every run, so each run has new work for every path
const batch = (k, n = 8, t = T0 + k * 5 * MIN) => Array.from({ length: n }, (_, i) => story(k * 100 + i, t));

let calls;
const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }], usage: { total_tokens: 10 } }) });
const err = (status, message = 'x') => ({ ok: false, status, text: async () => JSON.stringify({ error: { code: status, message } }) });
const opOf = (b) => (/story cards for the world-sports desk/.test(b.messages[0].content) ? 'cards' : /numbered sports headlines/.test(b.messages[0].content) ? 'headlines' : 'summaries');
const answer = (b) => {
  const op = opOf(b), user = b.messages[1].content;
  if (op === 'summaries') return { stories: [...user.matchAll(/### id: (s\d+)/g)].map((m) => ({ id: m[1], title_he: 'כותרת בדיקה קצרה', summary_he: 'סיכום בדיקה קצר מאוד כאן', summary_en: 'Test', facts_he: [], quotes_he: [] })) };
  if (op === 'cards') return { items: [...user.matchAll(/### id: (\d+)/g)].map((m) => ({ id: m[1], title_he: 'כותרת כרטיס בדיקה', summary_he: 'משפט בדיקה', about: 'a', about_he: 'א', desk: true, sport: 'football' })) };
  return { titles: [...user.matchAll(/^(\d+)\. /gm)].map((m) => ({ id: m[1], title_he: 'כותרת בדיקה קצרה' })) };
};
// fail(model, op) -> status number to fail with, or falsy to answer
const install = (fail = () => 0) => {
  calls = [];
  globalThis.fetch = async (url, opts) => {
    const b = JSON.parse(opts.body), op = opOf(b);
    calls.push({ model: b.model, op });
    const f = fail(b.model, op);
    return f ? err(f, f === 429 ? 'You exceeded your current quota' : 'This model is currently experiencing high demand') : ok(answer(b));
  };
};
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const n = (op) => calls.filter((c) => c.op === op).length;
// one collector run, with the state saved and loaded between runs like the real one (JSON)
let saved;
const reset = () => { saved = {}; };
async function run(k, stories = batch(k), at = T0 + k * 5 * MIN) {
  const r = await aiSummaries(stories, {}, JSON.parse(JSON.stringify(saved)), at, new Map(), { styleHeads: [], rich: false });
  saved = r.ai;
  return r;
}
const down = () => 503; // every model overloaded
const strongOnly = (m) => (m === STRONG || m === ALT ? 503 : 0);

test('an isolated 503 that the next model covers never counts', async () => {
  reset(); install((m) => (m === STRONG ? 503 : 0));
  for (let k = 0; k < 4; k++) await run(k);
  assert.equal(saved.pause?.summaries, undefined, 'the light model answered each time: no failure recorded');
  assert.equal(n('summaries') > 0, true);
});

test('one or two failing runs are not enough: the same requests are made again on the next run', async () => {
  assert.equal(COOL_5XX_AFTER, 3);
  reset(); install(down);
  const r1 = await run(0);
  assert.equal(saved.pause.summaries.n, 1);
  assert.ok(!saved.pause.summaries.until, 'no pause after a single failing run');
  const first = calls.length;
  await run(1);
  assert.ok(calls.length > first);
  assert.equal(saved.pause.summaries.n, 2);
  assert.ok(!saved.pause.summaries.until, 'none after two either');
  const second = calls.length;
  await run(2);
  assert.ok(calls.length > second, 'the third failing run still asks; it is the one that starts the pause');
  assert.equal(r1.stats.failed, r1.stats.requests, 'every request of an outage run failed');
});

test('total outage: three failing runs in a row pause every path for 15 minutes, then it asks again', async () => {
  reset(); install(down);
  await run(0); await run(1);
  const r2 = await run(2);
  const until = T0 + 10 * MIN + COOL_5XX_MS;
  for (const p of ['summaries', 'cards']) assert.equal(saved.pause[p].until, until, `${p} paused until ${new Date(until).toISOString()}`);
  assert.deepEqual([...r2.stats.paused].sort(), ['cards', 'summaries']);
  // the next two runs (5 and 10 minutes later) make no request
  install(down);
  const r3 = await run(3), r4 = await run(4);
  assert.equal(calls.length, 0, 'paused: not one request');
  assert.equal(r3.stats.requests + r4.stats.requests, 0);
  // at the end of the pause: one probe run asks again, and a failing probe pauses again at once
  install(down);
  const r5 = await run(5); // 25 minutes after the first run = 15 minutes after the pause began
  assert.ok(calls.length > 0, 'the probe asks again');
  assert.equal(saved.pause.summaries.until, T0 + 5 * 5 * MIN + COOL_5XX_MS, 'a failed probe pauses another 15 minutes');
  assert.ok(r5.stats.paused.includes('summaries'));
});

test('recovery is automatic: the first success after the pause lifts it and the work resumes', async () => {
  reset(); install(down);
  await run(0); await run(1); await run(2);
  install(); // Gemini is healthy again; the pause (15 min) has not ended yet
  await run(3);
  assert.equal(calls.length, 0, 'still paused for the next 5 minutes');
  install();
  const r = await run(5); // pause over
  assert.ok(n('summaries') > 0 && n('cards') > 0);
  assert.equal(saved.pause.summaries, undefined);
  assert.equal(saved.pause.cards, undefined);
  assert.ok(r.done > 0, 'summaries were written again');
  assert.deepEqual(r.stats.paused, []);
  install(down); // one new failure after recovery is again an isolated one
  await run(6);
  assert.equal(saved.pause.summaries.n, 1);
  assert.ok(!saved.pause.summaries.until);
});

test('separate paths: a failing card path is paused and the healthy summaries path keeps working', async () => {
  reset(); install((m, op) => (op === 'cards' ? 503 : 0));
  await run(0); await run(1); await run(2);
  assert.ok(saved.pause.cards.until > T0, 'cards paused');
  assert.equal(saved.pause.summaries, undefined);
  install((m, op) => (op === 'cards' ? 503 : 0));
  const r = await run(3);
  assert.equal(n('cards'), 0);
  assert.ok(n('summaries') > 0, 'summaries were still requested');
  assert.ok(r.done > 0);
});

test('separate paths: a failing summaries chain is paused and the healthy card path keeps working', async () => {
  reset(); install((m, op) => (op === 'summaries' || op === 'headlines' ? 503 : 0));
  await run(0); await run(1); await run(2);
  assert.ok(saved.pause.summaries.until > T0);
  assert.equal(saved.pause.cards, undefined, 'the cards answered');
  install((m, op) => (op === 'summaries' || op === 'headlines' ? 503 : 0));
  await run(3);
  assert.equal(n('summaries'), 0);
  assert.ok(n('cards') > 0, 'cards still asked');
});

test('429 handling is unchanged: a 429 sets the old 30-minute cooldown and never a 5xx pause', async () => {
  reset(); install(() => 429);
  await run(0);
  assert.equal(saved.cooldownUntil, T0 + 30 * MIN);
  assert.equal(saved.clsCooldown, T0 + 30 * MIN);
  assert.equal(saved.pause.summaries, undefined);
  assert.equal(saved.pause.cards, undefined);
  install(() => 503);
  await run(7, batch(7), T0 + 40 * MIN); // after the 429 cooldown
  assert.ok(!saved.cooldownUntil || saved.cooldownUntil <= T0 + 30 * MIN, 'a 5xx does not touch the 429 cooldown field');
});

test('a failure long ago does not count as "in a row"', async () => {
  reset(); install(down);
  await run(0);
  assert.equal(saved.pause.summaries.n, 1);
  await run(20, batch(20), T0 + 2 * 3600e3); // two hours later
  assert.equal(saved.pause.summaries.n, 1, 'the old failure expired; this is a first failure again');
  assert.ok(!saved.pause.summaries.until);
});

test('a state saved before this change (no pause field) loads and behaves as before', async () => {
  install(down);
  saved = { day: '2026-11-18', used: 5, res: {}, heads: {}, hourly: [] };
  const r = await run(0);
  assert.ok(r.stats.requests > 0);
  assert.equal(saved.pause.summaries.n, 1);
});

test('the pause adds no request: the paused run asks less than an unpaused one would', async () => {
  reset(); install(down);
  let total = 0;
  for (let k = 0; k < 6; k++) { calls = []; await run(k); total += calls.length; }
  // without a pause every run asks 1 card + 3 summary attempts = 24 requests for 6 runs (12 + one probe of 4 with the pause)
  assert.ok(total < 24, `asked ${total}, fewer than the 24 an unpaused code asks`);
});
