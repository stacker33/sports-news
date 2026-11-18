// What the Gemini request counter counts, as the code does it today (docs/gemini-audit.md). These pin the CURRENT behaviour so a later change
// to retries / cooldowns shows exactly what it changed. Offline: fetch is a stub, no request leaves the machine.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.AI_API_KEY = 'test-key';
delete process.env.AI_RICH_SUMMARIES;
const { aiSummaries } = await import('../src/ai.js');

const NOW = Date.parse('2026-11-18T12:00:00Z');
const member = (i, lang = 'en') => ({ id: `m${i}`, title: `Headline number ${i} about a match`, lang, publisher: `pub${i}`, weight: 1, published: NOW - 600e3, summary: '' });
const story = (i, lang = 'en') => ({ title: `Headline number ${i} about a match`, lang, score: 100 - i, first: NOW - 600e3, sourceCount: 1, langs: [lang], athletes: [], tags: [], _members: [member(i, lang)] });
const stories = (n) => Array.from({ length: n }, (_, i) => story(i));

let calls;
const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }], usage: { total_tokens: 10 } }) });
const err = (status, message = 'x') => ({ ok: false, status, text: async () => JSON.stringify({ error: { code: status, message } }) });
const opOf = (b) => (/story cards for the world-sports desk/.test(b.messages[0].content) ? 'cards' : /numbered sports headlines/.test(b.messages[0].content) ? 'headlines' : 'summaries');
const good = (b, user) => {
  const op = opOf(b);
  if (op === 'summaries') return { stories: [...user.matchAll(/### id: (s\d+)/g)].map((m) => ({ id: m[1], title_he: 'כותרת בדיקה קצרה', summary_he: 'סיכום בדיקה קצר מאוד כאן', summary_en: 'Test', facts_he: [], quotes_he: [] })) };
  if (op === 'cards') return { items: [...user.matchAll(/### id: (\d+)/g)].map((m) => ({ id: m[1], title_he: 'כותרת כרטיס בדיקה', summary_he: 'משפט בדיקה', about: 'a', about_he: 'א', desk: true, sport: 'football' })) };
  return { titles: [...user.matchAll(/^(\d+)\. /gm)].map((m) => ({ id: m[1], title_he: 'כותרת בדיקה קצרה' })) };
};
// handler(model, op, bodyObj) -> response | undefined (= answer normally)
const install = (handler = () => undefined) => {
  calls = [];
  globalThis.fetch = async (url, opts) => {
    const b = JSON.parse(opts.body);
    const op = opOf(b);
    calls.push({ model: b.model, op });
    return handler(b.model, op, b) || ok(good(b, b.messages[1].content));
  };
};
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const run = (st, prev = {}, now = NOW) => aiSummaries(st, {}, prev, now, new Map(), { styleHeads: [], rich: false });
const STRONG = 'gemini-flash-latest', LIGHT = 'gemini-flash-lite-latest', ALT = 'gemini-2.5-flash';

test('the counter (used) counts summary-path attempts; cards use their own counter and are not in it', async () => {
  install();
  const { ai } = await run(stories(8));
  const by = (op) => calls.filter((c) => c.op === op).length;
  assert.equal(by('cards'), 1);
  assert.equal(by('summaries'), 1);
  assert.equal(ai.used, 1, 'one summary call = 1; the card call is not counted here');
  assert.equal(ai.cls.used, 1, 'the card call counts against its own cap (AI_CLASSIFY_CAP, 450)');
});

test('a failed attempt is counted: strong and backup both overloaded = three counted attempts for one call', async () => {
  install((m, op) => ((m === STRONG || m === ALT) && op === 'summaries' ? err(503) : undefined));
  const { ai } = await run(stories(8));
  const sum = calls.filter((c) => c.op === 'summaries').map((c) => c.model);
  assert.deepEqual(sum, [STRONG, ALT, LIGHT]);
  assert.equal(ai.used, 3, 'every attempt, successful or not, is counted before it is sent');
  assert.equal(Object.keys(ai.res).length, 5, 'the light model still wrote the summaries (5 stories per request)');
});

test('with the backup model switched off, a strong failure still costs two counted attempts per call', async () => {
  install((m) => (m === STRONG ? err(429, 'You exceeded your current quota, please check your plan and billing details.') : undefined));
  const { ai } = await run(stories(8), { altOff: true });
  assert.deepEqual(calls.filter((c) => c.op === 'summaries').map((c) => c.model), [STRONG, LIGHT]);
  assert.equal(ai.used, 2);
  assert.equal(ai.hourly.length, 2, 'both attempts use the hourly pace (20 an hour) as well');
});

test('altOff, once set, is kept in the state for good (also across days)', async () => {
  install((m) => (m === ALT ? err(404, 'models/gemini-2.5-flash is not found') : m === STRONG ? err(503) : undefined));
  const r1 = await run(stories(8));
  assert.equal(r1.ai.altOff, true);
  install();
  const nextDay = await run(stories(8), r1.ai, NOW + 36 * 3600e3);
  assert.equal(nextDay.ai.altOff, true, 'nothing ever clears it');
});

test('a 503 sets no cooldown, a 429 sets one (30 minutes): the next run asks again after a 503', async () => {
  install(() => err(503));
  const r1 = await run(stories(8));
  assert.match(r1.ai.error, /HTTP 503/);
  assert.ok(!r1.ai.cooldownUntil, 'no cooldown after a 503');
  const first = calls.length;
  await run(stories(8), r1.ai, NOW + 300e3);
  assert.ok(calls.length > first, 'the same requests are made again five minutes later');
  install(() => err(429));
  const r2 = await run(stories(8));
  assert.equal(r2.ai.cooldownUntil, NOW + 30 * 60000);
  install();
  const r3 = await run(stories(8), r2.ai, NOW + 300e3);
  assert.equal(calls.filter((c) => c.op === 'summaries').length, 0, 'no summary request during the cooldown');
});

test('a run with nothing to write makes no request at all (zero new summaries is normal then)', async () => {
  install();
  const s = stories(5);
  const r1 = await run(s);
  const before = calls.length;
  const r2 = await run(s, r1.ai, NOW + 300e3);
  assert.equal(calls.length, before, 'every story already has its summary / card: no request');
  assert.equal(r2.done, 0);
  assert.equal(r2.ai.used, r1.ai.used);
});

test('an answer that fails the Hebrew check is not saved and the same story is asked again on every run', async () => {
  install((m, op, b) => (op === 'summaries' ? ok({ stories: [...b.messages[1].content.matchAll(/### id: (s\d+)/g)].map((x) => ({ id: x[1], title_he: 'bad title', summary_he: 'bad', summary_en: 'x', facts_he: [] })) }) : undefined));
  let prev = {};
  for (let k = 0; k < 3; k++) prev = (await run(stories(3), prev, NOW + k * 300e3)).ai;
  assert.equal(calls.filter((c) => c.op === 'summaries').length, 3, 'asked on each of the three runs');
  assert.equal(Object.keys(prev.res).length, 0);
  assert.equal(prev.used, 3);
});

test('the hourly pace and the daily cap stop the summary path', async () => {
  install();
  const { ai } = await run(stories(8), { hourly: Array(20).fill(NOW - 60e3), day: '2026-11-18', used: 20 });
  assert.equal(calls.filter((c) => c.op === 'summaries').length, 0, '20 attempts in the last hour: no room');
  assert.equal(ai.used, 20);
});
