import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selfCheck } from '../src/selfcheck.js';
import { abroadEvents, telegramPost, GROUPING } from '../src/telegram.js';

const noon = Date.parse('2026-11-04T10:00:00Z'); // 12:00 in Israel
const h = 3600e3;

test('self-check: a quiet channel in the day, a near cap, a backup start, AI down, a slow run; each once a day', () => {
  const r1 = selfCheck({ now: noon, tg: { lastPost: noon - 3 * h, dayCount: 230 }, ai: { error: 'quota' }, stateFrom: 'backup', tookMs: 7 * 60e3 }, {});
  for (const k of ['tg-quiet', 'tg-cap', 'state', 'ai', 'slow']) assert.ok(r1.selfAlerts[k], k);
  assert.match(r1.message, /לא פרסם כבר 3 שעות/);
  assert.match(r1.message, /230 מתוך 250/);
  const r2 = selfCheck({ now: noon + 600e3, tg: { lastPost: noon - 3 * h, dayCount: 231 }, ai: { error: 'quota' }, stateFrom: 'backup', tookMs: 7 * 60e3 }, r1.selfAlerts);
  assert.equal(r2.message, null); // already told today
  const tomorrow = selfCheck({ now: noon + 24 * h, tg: { lastPost: noon + 20 * h } }, r2.selfAlerts);
  assert.match(tomorrow.message, /לא פרסם כבר 4 שעות/); // a new day: told again
});

test('self-check: all fine → no message; a quiet channel at night is not a problem', () => {
  assert.equal(selfCheck({ now: noon, tg: { lastPost: noon - 30 * 60e3, dayCount: 40 }, stateFrom: 'cache', tookMs: 150e3 }, {}).message, null);
  const night = Date.parse('2026-11-04T01:00:00Z'); // 03:00 in Israel
  assert.equal(selfCheck({ now: night, tg: { lastPost: night - 4 * h } }, {}).message, null);
  assert.match(selfCheck({ now: noon, tg: { error: 'bot is not an admin' } }, {}).message, /לא מפרסם: bot is not an admin/);
});

const athletes = [{ name: 'Oscar Gloukh', name_he: 'אוסקר גלוך', team: 'Ajax', team_he: 'אייאקס', sport: 'football' }, { name: 'Deni Avdija', name_he: 'דני אבדיה', team: 'Portland', sport: 'basketball' }];
const game = (players, extra = {}) => ({ g1: { home: { name: 'Ajax', score: 2 }, away: { name: 'PSV', score: 1 }, comp: 'Eredivisie', players, ...extra } });

test('live events: goals, assists and red cards of Israelis abroad, in Hebrew with the score', () => {
  const ev = abroadEvents(game({ 'Oscar Gloukh': { s: 'start', goals: ["34'"], assists: ["71'"], rc: [] }, 'Deni Avdija': { goals: ['x'] } }), athletes);
  assert.deepEqual(ev.map((e) => e.key), ["g1|Oscar Gloukh|g|34'", "g1|Oscar Gloukh|a|71'"]); // basketball: not here
  assert.match(ev[0].text, /שער של אוסקר גלוך!.*אייאקס.*34'/);
  assert.match(ev[0].text, /Ajax 2:1 PSV · Eredivisie/);
  assert.match(ev[1].text, /בישול של אוסקר גלוך/);
});

test('live events go to the channel once each; what is already in the data when this starts is not posted', async () => {
  const sent = [];
  const before = globalThis.fetch;
  const env = { ...process.env };
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_CHAT = '@test';
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/sendMessage')) sent.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ ok: true, result: {} }) };
  };
  const ready = { chatOk: true, chatFor: '@test', sent: {}, rule: 'main-top', grouping: GROUPING, recent: [] };
  const post = (gi, prev) => telegramPost([], { athletes, cards: {}, gameInfo: gi, siteUrl: 'https://x.test/' }, prev, noon);
  try {
    const first = await post(game({ 'Oscar Gloukh': { goals: ["10'"] } }), ready); // the first run with this feature
    assert.equal(sent.length, 0);
    const second = await post(game({ 'Oscar Gloukh': { goals: ["10'", "55'"] } }), first.tg);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /55'/);
    assert.ok(second.tg.lastPost);
    await post(game({ 'Oscar Gloukh': { goals: ["10'", "55'"] } }), second.tg);
    assert.equal(sent.length, 1); // once
  } finally {
    globalThis.fetch = before;
    process.env = env;
  }
});
