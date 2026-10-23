import { test } from 'node:test';
import assert from 'node:assert/strict';
import { telegramPost, mainPage, MAIN_TOP } from '../src/telegram.js';

const now = Date.parse('2026-10-24T10:00:00Z'); // 13:00 in Israel: not quiet hours, not the morning briefing
const min = 60e3;
let n = 0;
// a story as the collector hands it to the channel
const story = (title, { ed = 50, age = 30, sport = 'football', il = false, ...rest } = {}) => {
  const id = `s${++n}`;
  return {
    id, title, sport, lang: 'he', link: `https://x.test/${id}`, first: now - age * min, latest: now - age * min, sourceCount: 2, ed: { score: ed },
    sources: [{ name: il ? 'ONE' : 'BBC', link: `https://x.test/${id}`, o: il ? 'il' : 'w' }], tags: [], athletes: [],
    _members: [{ id: `m${id}`, published: now - age * min }], ...rest,
  };
};

test('the main page order: Israeli-only stories, other sports and off-beat stories are not on it; half rank, half newness', () => {
  const a = story('א', { ed: 90, age: 60 });
  const b = story('ב', { ed: 40, age: 5 });
  const c = story('ג', { ed: 95, age: 600 }); // strong but 10 hours old
  const il = story('ישראלי בלבד', { ed: 99, il: true });
  const other = story('טניס', { ed: 99, sport: 'other' });
  const local = story('מקומי', { ed: 99, local: true });
  const page = mainPage([a, b, c, il, other, local], now);
  assert.deepEqual(page.map((s) => s.title), ['א', 'ב', 'ג']);
});

async function run(stories, prev) {
  const sent = [];
  const before = globalThis.fetch;
  const env = { ...process.env };
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_CHAT = '@test';
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/sendMessage')) sent.push(JSON.parse(opts.body).text);
    return { ok: true, json: async () => ({ ok: true, result: {} }) };
  };
  try {
    const r = await telegramPost(stories, { athletes: [], cards: {}, gameInfo: {}, siteUrl: 'https://x.test/' }, prev, now);
    return { ...r, sent };
  } finally {
    globalThis.fetch = before;
    process.env = env;
  }
}
const ready = { chatOk: true, chatFor: '@test', sent: {}, rule: 'main-top', recent: [] };

test('the channel posts what is in the main page top 10, in its order; not what is below it', async () => {
  // 12 distinct stories: the top 10 (by the page's order) can go, the last two can't
  const heads = ['מכבי חיפה ניצחה בדרבי', 'ריאל מדריד הפסידה בבית', 'ליברפול רכשה בלם חדש', 'אבדיה קלע שלושים נקודות', 'מאמן יובנטוס פוטר הבוקר', 'ברצלונה הודיעה על פציעה', 'ארסנל חתמה על קשר', 'מילאן מובילה את הטבלה', 'באיירן ניצחה בדקה האחרונה', 'צ׳לסי הדיחה את השוער', 'פריז מתעניינת בחלוץ', 'דורטמונד שברה שיא'];
  const list = heads.map((h, i) => story(h, { ed: 90 - i * 5, age: 20 }));
  const r = await run(list, ready);
  assert.equal(r.posted, 4); // at most 4 per run
  assert.match(r.sent[0], /מכבי חיפה/);
  assert.match(r.sent[3], /אבדיה/);
  const next = await run(list, r.tg);
  const r3 = await run(list, next.tg);
  const all = [...r.sent, ...next.sent, ...r3.sent];
  assert.equal(all.length, MAIN_TOP); // 10 over three runs, then nothing more
  assert.ok(!all.some((t) => /פריז|דורטמונד/.test(t)));
});

test('a story older than 3 hours is not posted even in the top; switching to the rule posts nothing at once', async () => {
  const old = story('ישנה מאוד', { ed: 99, age: 200 });
  assert.equal((await run([old], ready)).posted, 0);
  const fresh = story('חדשה', { ed: 80, age: 10 });
  const sw = await run([fresh], { ...ready, rule: undefined }); // the first run after this change
  assert.equal(sw.posted, 0);
  assert.equal(sw.tg.rule, 'main-top');
  assert.equal((await run([fresh], sw.tg)).posted, 0); // marked: not posted later either
});

test('at night (01:00–06:00 in Israel) stories still go out, silently; by day with a sound', async () => {
  const bodies = [];
  const before = globalThis.fetch;
  const env = { ...process.env };
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_CHAT = '@test';
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/sendMessage')) bodies.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ ok: true, result: {} }) };
  };
  try {
    const night = Date.parse('2026-10-24T00:30:00Z'); // 03:30 in Israel
    const s1 = { ...story('גול בדקה האחרונה בלילה', { ed: 90, age: 10 }), first: night - 20 * min, latest: night - 20 * min, langs: ['he'] };
    await telegramPost([s1], { athletes: [], cards: {}, gameInfo: {}, siteUrl: 'https://x.test/' }, ready, night);
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].disable_notification, true);
    const s2 = story('הודעה רשמית בצהריים', { ed: 90, age: 20 });
    await telegramPost([s2], { athletes: [], cards: {}, gameInfo: {}, siteUrl: 'https://x.test/' }, ready, now);
    assert.equal(bodies[1].disable_notification, undefined);
  } finally {
    globalThis.fetch = before;
    process.env = env;
  }
});
