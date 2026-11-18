import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The real collector (src/collect.js) run in a child process: its data directory is a temp folder and the network is replaced by
// test/fixtures/reliability-fetch.mjs, which answers only the sources a test names (the rest fail at once, like any failing source).
// Nothing leaves the machine.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const preload = pathToFileURL(fileURLToPath(new URL('./fixtures/reliability-fetch.mjs', import.meta.url))).href;
const MIN = 60e3;
const H = 60 * MIN;

const rss = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items.map((i) => `<item><title>${i.t}</title><link>${i.l}</link><pubDate>${new Date(i.d).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
const newDir = () => mkdtempSync(join(tmpdir(), 'rel-'));
const stateOf = (dir) => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
const save = (dir, st) => writeFileSync(join(dir, 'state.json'), JSON.stringify(st));
const item = (id, over = {}) => ({ id, title: `Article number ${id} about a football match`, link: `https://example.com/${id}`, publisher: 'Example', sourceId: 'one', lang: 'en', weight: 1, published: Date.now() - H, seen: Date.now() - H, sport: 'football', ...over });
// the saved clock of a run is the real one; to let time pass between two runs the saved timestamps are moved back
function shift(dir, ms) {
  const st = stateOf(dir);
  for (const m of Object.values(st.meta || {})) for (const k of ['last', 'cooldownUntil', 'lastOk', 'failSince']) if (m[k]) m[k] -= ms;
  for (const it of st.items) for (const k of ['published', 'seen']) it[k] -= ms;
  save(dir, st);
}
function run(dir, scenario) {
  const scen = join(dir, 'scenario.json');
  writeFileSync(scen, JSON.stringify(scenario));
  const r = spawnSync(process.execPath, ['--import', preload, join(ROOT, 'src', 'collect.js')], { cwd: ROOT, env: { PATH: process.env.PATH, RADAR_DATA_DIR: dir, MOCK_SCENARIO: scen, STATE_ERROR_FILE: join(dir, '.err') }, encoding: 'utf8', timeout: 120000 });
  const asked = JSON.parse((r.stdout.match(/ASKED (\[.*\])/) || [, '[]'])[1]);
  return { status: r.status, out: r.stdout, err: r.stderr, asked, lines: r.stdout.split('\n') };
}
const HEALTHY = (now) => ({ 'one.co.il/rss': { status: 200, body: rss([{ t: 'A healthy feed brings an article today', l: 'https://one/x', d: now - 3 * MIN }]) } });

test('timing: one [timing] line per run with the stages measured at the real boundaries, adding up to the total', () => {
  const dir = newDir();
  save(dir, { savedAt: Date.now() - 5 * MIN, items: [] });
  const r = run(dir, {});
  assert.equal(r.status, 0, r.err);
  const lines = r.lines.filter((l) => l.startsWith('[timing] '));
  assert.equal(lines.length, 1);
  const t = JSON.parse(lines[0].slice('[timing] '.length));
  assert.deepEqual(Object.keys(t), ['setup', 'fetch', 'parse', 'enrich', 'cluster', 'rank', 'ai', 'notify', 'publish', 'total']);
  for (const v of Object.values(t)) assert.ok(Number.isFinite(v) && v >= 0);
  const sum = Object.entries(t).filter(([k]) => k !== 'total').reduce((a, [, v]) => a + v, 0);
  assert.ok(Math.abs(t.total - sum) <= 3, `stages ${sum} ms, total ${t.total} ms`);
});

test('backoff end to end: a source that answers 403 is parked, a 429 with Retry-After waits as asked, a healthy feed is never delayed, a parked source is retried and recovers', () => {
  const dir = newDir();
  const now = Date.now();
  save(dir, { savedAt: now - 5 * MIN, items: [], meta: { ghanasoccernet: { last: now - 15 * MIN, ok: false, error: 'HTTP 403', failStreak: 980, cooldownUntil: now - 1000, okOnce: true } } });
  const scenario = { ...HEALTHY(now), 'ghanasoccernet.com': { status: 403 }, 'maisfutebol.iol.pt': { status: 429, headers: { 'Retry-After': '7200' } } };

  // run 1: the long-dead source is asked once more and parked for 24 hours; the 429 waits the 2 hours the server asked for
  const r1 = run(dir, scenario);
  assert.equal(r1.status, 0, r1.err);
  assert.ok(r1.asked.includes('ghanasoccernet.com') && r1.asked.includes('maisfutebol.iol.pt') && r1.asked.includes('one.co.il/rss'));
  let m = stateOf(dir).meta;
  assert.ok(Math.abs(m.ghanasoccernet.cooldownUntil - m.ghanasoccernet.last - 24 * H) < 1000, 'parked for 24 hours, not 15 minutes');
  assert.equal(m.ghanasoccernet.failKind, 'access');
  assert.ok(Math.abs(m.maisfutebol.cooldownUntil - m.maisfutebol.last - 2 * H) < 1000, 'Retry-After: 7200 respected');
  assert.equal(m.maisfutebol.failKind, 'rate');
  assert.equal(m.one.ok, true);
  assert.equal(m.one.failStreak, 0);

  // run 2, ten minutes later: the parked sources are not asked; the healthy feed (due again after a minute) is
  shift(dir, 10 * MIN);
  const r2 = run(dir, scenario);
  assert.ok(!r2.asked.includes('ghanasoccernet.com') && !r2.asked.includes('maisfutebol.iol.pt'), `asked: ${r2.asked}`);
  assert.ok(r2.asked.includes('one.co.il/rss'), 'a healthy feed is polled as before');

  // run 3, 2 hours 5 minutes after run 1: the 429 wait is over (asked again, still limited: it waits again), the 403 source still parked
  shift(dir, 2 * H - 5 * MIN);
  const r3 = run(dir, scenario);
  assert.ok(r3.asked.includes('maisfutebol.iol.pt') && !r3.asked.includes('ghanasoccernet.com'));
  assert.equal(stateOf(dir).meta.maisfutebol.kindStreak, 2);

  // run 4, a day later: the parked source is retried (never switched off) and, answering at last, its record is clean again
  shift(dir, 24 * H);
  const r4 = run(dir, { ...HEALTHY(Date.now()), 'ghanasoccernet.com': { status: 200, body: rss([{ t: 'The feed is back after ten days', l: 'https://g/1', d: Date.now() - 2 * MIN }]) } });
  assert.ok(r4.asked.includes('ghanasoccernet.com'));
  m = stateOf(dir).meta;
  assert.equal(m.ghanasoccernet.ok, true);
  assert.equal(m.ghanasoccernet.failStreak, 0);
  assert.equal(m.ghanasoccernet.failKind, undefined);
  assert.equal(m.ghanasoccernet.cooldownUntil, undefined);
});

test('a new source that fails twice is not penalised: it is asked again after the usual 15 minutes', () => {
  const dir = newDir();
  const now = Date.now();
  save(dir, { savedAt: now - 5 * MIN, items: [], meta: {} });
  const sc = { 'ghanasoccernet.com': { status: 404 } };
  run(dir, sc);
  shift(dir, 16 * MIN);
  const r = run(dir, sc);
  assert.ok(r.asked.includes('ghanasoccernet.com'));
  const g = stateOf(dir).meta.ghanasoccernet;
  assert.equal(g.kindStreak, 2);
  assert.ok(Math.abs(g.cooldownUntil - g.last - 15 * MIN) < 1000);
});

test('feeds that lose the PM end to end: an evening article is restored, a morning one and an old one are left, the feed\'s own date is kept, the first read is not touched', () => {
  const dir = newDir();
  const now = Date.now();
  const feed = rss([
    { t: 'Evening article that the feed dated twelve hours early', l: 'https://v/evening', d: now - 12 * H - 1 * MIN },
    { t: 'Morning article that the feed dated correctly today', l: 'https://v/morning', d: now - 2 * MIN },
    { t: 'An old article that really is a day old, left alone', l: 'https://v/old', d: now - 20 * H },
  ]);
  // the source has been read before: its articles are judged one by one
  save(dir, { savedAt: now - 5 * MIN, items: [], meta: { voetbalkrant: { last: now - 10 * MIN, ok: true, okOnce: true, count: 3, lastOk: now - 10 * MIN, failStreak: 0 } } });
  const r = run(dir, { 'voetbalkrant.com': { status: 200, body: feed } });
  assert.equal(r.status, 0, r.err);
  const by = Object.fromEntries(stateOf(dir).items.map((i) => [i.link, i]));
  const seen = by['https://v/evening'].seen;
  assert.ok(Math.abs(by['https://v/evening'].published - (seen - 1 * MIN)) < 5000, 'restored to about a minute before it was seen');
  assert.ok(Math.abs(by['https://v/evening'].feedPublished - (seen - 12 * H - 1 * MIN)) < 5000, 'the feed\'s own date is kept');
  assert.ok(Math.abs(by['https://v/morning'].published - (seen - 2 * MIN)) < 5000);
  assert.equal(by['https://v/morning'].feedPublished, undefined);
  assert.ok(Math.abs(by['https://v/old'].published - (seen - 20 * H)) < 5000);
  assert.equal(by['https://v/old'].feedPublished, undefined);

  // the first read of a source: nothing is corrected
  const dir2 = newDir();
  save(dir2, { savedAt: now - 5 * MIN, items: [], meta: {} });
  run(dir2, { 'voetbalkrant.com': { status: 200, body: feed } });
  const first = Object.fromEntries(stateOf(dir2).items.map((i) => [i.link, i]));
  assert.ok(first['https://v/evening'].published < first['https://v/evening'].seen - 11 * H, 'left as the feed gave it');
  assert.equal(first['https://v/evening'].feedPublished, undefined);

  // an article seen before keeps the time it was given: the feed repeats the wrong date, 45 minutes later the bare rule would no longer fit
  shift(dir, 45 * MIN); // all saved times 45 minutes older
  const feed2 = rss([{ t: 'Evening article that the feed dated twelve hours early', l: 'https://v/evening', d: Date.now() - 12 * H - 46 * MIN }]);
  const before = stateOf(dir).items.find((i) => i.link === 'https://v/evening');
  run(dir, { 'voetbalkrant.com': { status: 200, body: feed2 } });
  const after = stateOf(dir).items.find((i) => i.link === 'https://v/evening');
  assert.equal(after.published, before.published, 'not reset to the feed\'s wrong date');
  assert.equal(after.feedPublished, before.feedPublished);
});

test('state cleanup end to end: stale trend entries go, active and recent ones and other kinds stay, no article is lost or duplicated, nothing is fetched again', () => {
  const dir = newDir();
  const now = Date.now();
  const old = now - 5 * 24 * H;
  const items = [item('a1', { sourceId: 'trend-stale-one', via: { src: 'trend-stale-one', at: now - 3 * H }, paths: ['trend-stale-one'] }), item('a2', { via: { src: 'one', at: now - 3 * H }, paths: ['one', 'trend-stale-two'] })];
  const meta = {
    'trend-stale-one': { last: old, ok: true, okOnce: true },
    'trend-stale-two': { last: old, ok: false, error: 'HTTP 503', failStreak: 1 },
    'trend-stale-three': { last: old, ok: true },
    'trend-recent': { last: now - H, ok: true, okOnce: true },
    'trend-active-term': { last: old, ok: true, okOnce: true },
    'team-old': { last: now - 10 * 24 * H, ok: true, okOnce: true },
    one: { last: now - 10 * 1000, ok: true, okOnce: true, count: 3, lastOk: now - 10 * 1000, failStreak: 0 }, // polled seconds ago: not due
  };
  save(dir, { savedAt: now - 5 * MIN, items, meta, trendSearch: { 'active term': { geo: 'US', at: now - H } } });
  const r1 = run(dir, { ...HEALTHY(now) });
  assert.equal(r1.status, 0, r1.err);
  assert.ok(r1.out.includes('[meta] removed 3 stale trend-search entries'), r1.out.split('\n').filter((l) => /meta/.test(l)).join('|'));
  let st = stateOf(dir);
  for (const gone of ['trend-stale-one', 'trend-stale-two', 'trend-stale-three']) assert.ok(!(gone in st.meta), gone);
  for (const kept of ['trend-recent', 'trend-active-term', 'team-old', 'one']) assert.ok(kept in st.meta, kept);
  assert.deepEqual(st.items.map((i) => i.id).sort(), ['a1', 'a2'], 'no article lost');
  assert.deepEqual(st.items.find((i) => i.id === 'a1').via, { src: 'trend-stale-one', at: now - 3 * H }, 'provenance kept');
  assert.ok(!r1.asked.includes('one.co.il/rss'), 'a source polled seconds ago is not fetched again');
  // a second run changes nothing: nothing more to remove, no duplicates, nothing new
  const r2 = run(dir, { ...HEALTHY(now) });
  assert.ok(!r2.out.includes('[meta] removed'));
  st = stateOf(dir);
  assert.equal(st.items.length, 2);
  assert.ok(/ 0 new items /.test(r2.out), r2.out.split('\n').find((l) => l.includes('[collect] fetched')));
});

test('an old state (records without the new fields, a saved failing streak) is read safely: nothing throws, healthy sources are untouched', () => {
  const dir = newDir();
  const now = Date.now();
  save(dir, { savedAt: now - 5 * MIN, items: [item('z1')], meta: { 'sky-football': { last: now - 20 * MIN, ok: true, okOnce: true, count: 20, lastOk: now - 20 * MIN, failStreak: 0 }, maisfutebol: { last: now - 30 * MIN, ok: false, error: 'HTTP 503', failStreak: 4, cooldownUntil: now - 1 } } });
  const r = run(dir, { 'skysports.com/rss/11095': { status: 200, body: rss([{ t: 'Healthy feed article from the saved state run', l: 'https://s/1', d: now - 4 * MIN }]) }, 'maisfutebol.iol.pt': { status: 503 } });
  assert.equal(r.status, 0, r.err);
  const m = stateOf(dir).meta;
  assert.equal(m['sky-football'].ok, true);
  assert.equal(m.maisfutebol.failKind, 'transient');
  assert.ok(Math.abs(m.maisfutebol.cooldownUntil - m.maisfutebol.last - 15 * MIN) < 1000, 'a transient error keeps the flat 15 minutes');
  assert.equal(m.maisfutebol.failStreak, 5);
});
