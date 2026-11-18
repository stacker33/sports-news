import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { capStories as capFromCollect } from '../src/collect.js';
import {
  capStories, selectPool, applyCap, pinInto, capG1Mode, mixValue, listFor, listForIlmon, freshness, telegramPinIds, israeliOnlyStory,
  POOL_TABS, SLIDER_POSITIONS, STICKY_RANKS, TG_PIN_HOURS, TG_PIN_MAX,
} from '../src/capselect.js';

const H = 3600e3;
const NOW = Date.UTC(2026, 9, 19, 22, 0, 0);
let n = 0;
// a story as the cap receives it (newest last article first); _ed is its editorial score
const story = (over = {}) => {
  const id = over.id || `s${String(++n).padStart(6, '0')}`;
  return { id, title: id, sport: 'football', first: NOW - H, latest: NOW - H, sourceCount: 1, langs: ['en'], israel: false, abroad: false, big: false, _ed: 30, ...over };
};
const newestFirst = (list) => [...list].sort((a, b) => b.latest - a.latest || (a.id < b.id ? -1 : 1));
const scoreOf = (s) => s._ed;
const ids = (list) => list.map((s) => s.id);
const info = (stories, now = NOW) => new Map(stories.map((s) => [s, { ed: s._ed, fresh: freshness(s, now), israeliOnly: !!s._israeliOnly }]));

// A day like the saved state: Israeli stories, a lot of fresh football of little value, and a thin basketball tab.
function day({ israeli = 100, football = 1500, basketball = 120, olderStars = 30 } = {}) {
  const list = [];
  for (let i = 0; i < israeli; i++) list.push(story({ israel: true, latest: NOW - (5 + (i % 30)) * H, first: NOW - (6 + (i % 30)) * H, _ed: 60 }));
  for (let i = 0; i < football; i++) list.push(story({ latest: NOW - (i % 150) * 60e3 - 1000, first: NOW - (i % 150) * 60e3 - 2000, _ed: 8 + (i % 7), title: 'football lineup' }));
  for (let i = 0; i < basketball; i++) list.push(story({ sport: 'basketball', latest: NOW - (4 + i * 0.2) * H, first: NOW - (5 + i * 0.2) * H, _ed: 20 + (i % 40), title: 'basketball' }));
  for (let i = 0; i < olderStars; i++) list.push(story({ latest: NOW - (3 + (i % 3)) * H, first: NOW - (4 + (i % 3)) * H, _ed: 75 - (i % 5), sourceCount: 6, title: 'important story' }));
  return newestFirst(list);
}

test('the flag is off unless explicitly set; shadow and on are recognised', () => {
  assert.equal(capG1Mode({}), 'off');
  assert.equal(capG1Mode({ CAP_G1: '' }), 'off');
  assert.equal(capG1Mode({ CAP_G1: '0' }), 'off');
  assert.equal(capG1Mode({ CAP_G1: 'shadow' }), 'shadow');
  for (const v of ['1', 'true', 'ON', ' yes ']) assert.equal(capG1Mode({ CAP_G1: v }), 'on');
});

test('flag off and shadow publish exactly the legacy list (same objects, same order); off never scores anything', () => {
  const stories = day();
  const legacy = capStories(stories, 1200);
  let calls = 0;
  const spy = (s) => { calls++; return s._ed; };
  const off = applyCap(stories, { mode: 'off', max: 1200, now: NOW, scoreOf: spy });
  assert.equal(calls, 0, 'off computes no editorial score');
  assert.equal(capFromCollect, capStories); // src/collect.js still exports the same function
  const shadow = applyCap(stories, { mode: 'shadow', max: 1200, now: NOW, scoreOf: spy });
  for (const r of [off, shadow]) {
    assert.ok(r.published.length === legacy.length && r.published.every((s, i) => s === legacy[i]));
    assert.ok(r.core.every((s, i) => s === legacy[i]) && r.union.every((s, i) => s === legacy[i]));
  }
  assert.equal(shadow.stats.pool, 1200); // shadow still reports what the pool would be
  assert.ok(shadow.stats.recallPool.mean > shadow.stats.recallLegacy.mean);
  assert.equal(shadow.keptIds.length, 1200);
  assert.equal(off.keptIds, null);
});

test('the pool keeps the total at exactly 1,200, keeps every Israeli story the legacy cap keeps, and is in the legacy order', () => {
  const stories = day();
  const g = applyCap(stories, { mode: 'on', max: 1200, now: NOW, scoreOf });
  const legacy = capStories(stories, 1200);
  assert.equal(g.published.length, 1200);
  const pub = new Set(g.published);
  const il = legacy.filter((s) => s.israel);
  assert.ok(il.every((s) => pub.has(s)), 'no Israeli story lost');
  assert.equal(g.published.filter((s) => s.israel).length, il.length);
  assert.deepEqual(ids(g.published), ids(newestFirst(g.published)));
});

test('every slider list of the Top, Football and Basketball tabs is in the pool (the legacy cap serves the thin Basketball tab badly)', () => {
  const stories = day();
  const inf = info(stories);
  const legacy = new Set(capStories(stories, 1200));
  const g = applyCap(stories, { mode: 'on', max: 1200, now: NOW, scoreOf });
  const pool = new Set(g.published);
  let legacyBasket = 0, poolBasket = 0, listsChecked = 0;
  for (const tab of POOL_TABS) for (const p of SLIDER_POSITIONS) {
    const want = listFor(stories, inf, tab, p);
    const inPool = want.filter((s) => pool.has(s)).length;
    assert.ok(inPool / want.length >= 0.97, `${tab}@${p}: ${inPool}/${want.length}`);
    listsChecked++;
    if (tab === 'basketball') { legacyBasket += want.filter((s) => legacy.has(s)).length / want.length; poolBasket += inPool / want.length; }
  }
  assert.equal(listsChecked, 15);
  assert.ok(legacyBasket / 5 < 0.7 && poolBasket / 5 > 0.97, `basketball legacy ${legacyBasket / 5}, pool ${poolBasket / 5}`);
  // positions the pool was not built for are served as well
  for (const p of [10, 35, 65, 85]) for (const tab of POOL_TABS) {
    const want = listFor(stories, inf, tab, p);
    assert.ok(want.filter((s) => pool.has(s)).length / want.length >= 0.9, `${tab}@${p}`);
  }
});

test('high-importance stories the legacy cap loses are in the pool; low-value, off-beat and Israeli-only stories take no slots from them', () => {
  const stories = day();
  const legacy = new Set(capStories(stories, 1200));
  const pool = new Set(applyCap(stories, { mode: 'on', max: 1200, now: NOW, scoreOf }).published);
  const stars = stories.filter((s) => s.title === 'important story');
  assert.equal(stars.filter((s) => legacy.has(s)).length, 0, 'the scenario: the legacy cap loses them');
  assert.equal(stars.filter((s) => pool.has(s)).length, stars.length);
  // stories the page would never list (collapsed local / low / minor, or only Israeli sites carry them) are not chosen for the lists
  const junk = Array.from({ length: 400 }, (_, i) => story({ latest: NOW - 60e3 * i, first: NOW - 60e3 * i, _ed: 90, local: i % 3 === 0, low: i % 3 === 1, minor: i % 3 === 2, title: 'collapsed' }));
  const onlyIsraeli = Array.from({ length: 100 }, (_, i) => story({ latest: NOW - 60e3 * i, first: NOW - 60e3 * i, _ed: 95, _israeliOnly: true, title: 'israeli only' }));
  const all = newestFirst([...stories, ...junk, ...onlyIsraeli]);
  const sc = (s) => ({ score: s._ed, israeliOnly: !!s._israeliOnly });
  const p2 = new Set(applyCap(all, { mode: 'on', max: 1200, now: NOW, scoreOf: sc }).published);
  const inf2 = new Map(all.map((s) => [s, { ed: s._ed, fresh: freshness(s, NOW), israeliOnly: !!s._israeliOnly }]));
  for (const tab of POOL_TABS) for (const p of SLIDER_POSITIONS) assert.ok(listFor(all, inf2, tab, p).every((s) => s.title !== 'collapsed' && s.title !== 'israeli only'), `${tab}@${p}: the page never lists them`);
  assert.equal(stars.filter((s) => p2.has(s)).length, stars.length, 'they take no slot from the listed stories');
  for (const tab of POOL_TABS) for (const p of SLIDER_POSITIONS) { const want = listFor(all, inf2, tab, p); assert.ok(want.filter((s) => p2.has(s)).length / want.length >= 0.97, `${tab}@${p}`); }
});

test('stories that only the pool admits are display-only: the consumer list (core) is exactly what the legacy cap builds', () => {
  const stories = day();
  const legacy = capStories(stories, 1200);
  const g = applyCap(stories, { mode: 'on', max: 1200, now: NOW, scoreOf });
  assert.deepEqual(ids(g.core), ids(legacy)); // Telegram, summaries, translations, brief, trends, source report read this
  const L = new Set(legacy);
  const extra = g.published.filter((s) => !L.has(s));
  assert.ok(extra.length > 0 && extra.every((s) => !g.core.includes(s)), 'no pool-only story reaches a notification, a model call or the brief');
  for (const mode of ['off', 'shadow', 'on']) assert.deepEqual(ids(applyCap(stories, { mode, max: 1200, now: NOW, scoreOf }).core), ids(legacy), mode);
});

test('deterministic: the same input twice, or in another order, gives the same selection', () => {
  const stories = day({ football: 1400 });
  const a = applyCap(stories, { mode: 'on', max: 1200, now: NOW, scoreOf });
  const b = applyCap(stories, { mode: 'on', max: 1200, now: NOW, scoreOf });
  assert.deepEqual(ids(a.published), ids(b.published));
  const shuffled = [...stories].sort((x, y) => (x.id < y.id ? 1 : -1));
  const c = selectPool(shuffled, { max: 1200, now: NOW, scoreOf });
  assert.deepEqual(new Set([...c.keep].map((s) => s.id)), new Set(ids(a.published)));
  assert.deepEqual(ids(c.ranked), ids(selectPool(stories, { max: 1200, now: NOW, scoreOf }).ranked), 'the priority order is the same too');
});

test('a story with a missing field (NaN score or time) sorts last and never breaks the order', () => {
  const t = [story({ id: 'good', _ed: 40 }), story({ id: 'nan1', _ed: NaN }), story({ id: 'nan2', _ed: 'x' }), story({ id: 'notime', first: undefined, latest: undefined, _ed: 90 })];
  const sel = selectPool(t, { max: 1, now: NOW, scoreOf });
  assert.equal(sel.keep.size, 1);
  assert.equal(mixValue({ first: NaN }, 50, NOW), -1);
  assert.doesNotThrow(() => applyCap(day(), { mode: 'on', max: 1200, now: NOW, scoreOf: (s) => (s.id.endsWith('7') ? undefined : s._ed) }));
});

test('little churn: consecutive runs overlap closely, and a story the previous run published is not displaced by a marginal newcomer', () => {
  const jac = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };
  const base = day({ football: 1400 });
  let prev = new Set(), prevPlain = new Set(), sumWith = 0, sumWithout = 0, runs = 0;
  for (let k = 0; k <= 20; k++) {
    const now = NOW + k * 300e3;
    const jitter = base.map((s, i) => ({ ...s, _ed: s._ed + ((i * 7 + k * 3) % 5) * 0.15, latest: s.latest + k * 300e3 * ((i % 4) === 0 ? 1 : 0) })); // a few stories get a new article each run
    const list = newestFirst(jitter);
    const w = new Set(ids([...selectPool(list, { max: 1200, now, scoreOf, prevKept: prev }).keep]));
    const o = new Set(ids([...selectPool(list, { max: 1200, now, scoreOf }).keep]));
    if (prev.size) { sumWith += jac(w, prev); sumWithout += jac(o, prevPlain); runs++; }
    prev = w;
    prevPlain = o;
  }
  assert.ok(sumWith / runs >= sumWithout / runs, 'remembering the previous pool never makes the selection less stable');
  assert.ok(sumWith / runs > 0.95, `consecutive overlap ${(sumWith / runs).toFixed(3)}`);
  assert.equal(STICKY_RANKS, 3);
});

test('Israeli priority is unchanged even when Israeli stories fill the cap, and with fewer stories than the cap nothing changes', () => {
  const stories = newestFirst([...Array.from({ length: 1250 }, (_, i) => story({ israel: true, latest: NOW - i * 1000, _ed: 10 })), ...Array.from({ length: 50 }, () => story({ _ed: 95, latest: NOW - 1000 }))]);
  const g = applyCap(stories, { mode: 'on', max: 1200, now: NOW, scoreOf });
  assert.deepEqual(ids(g.published), ids(capStories(stories, 1200)));
  const small = day({ israeli: 10, football: 20, basketball: 5, olderStars: 5 });
  for (const mode of ['off', 'shadow', 'on']) assert.deepEqual(ids(applyCap(small, { mode, max: 1200, now: NOW, scoreOf }).published), ids(small));
});

test('a failure of the new selection is caught by the caller and the legacy cap is used; a pool of the wrong size is an error', () => {
  const stories = day();
  assert.throws(() => applyCap(stories, { mode: 'on', max: 1200, now: NOW, scoreOf: () => { throw new Error('boom'); } }));
  const src = readFileSync(new URL('../src/collect.js', import.meta.url), 'utf8');
  assert.ok(src.includes('the legacy cap is used') && src.includes("cap = applyCap(stories, { mode: 'off'"));
  // the sanity check in applyCap: the pool must have exactly min(max, eligible) stories
  assert.ok(readFileSync(new URL('../src/capselect.js', import.meta.url), 'utf8').includes('the pool has'));
});

test('the Israeli-only rule mirrors the collector: only stories with Israeli outlets and no foreign article', () => {
  const roles = { a: ['il', 'x'], b: ['il', 'x'], c: ['foreign', 'x'] };
  assert.equal(israeliOnlyStory({ il: 2 }, [{ link: 'a' }, { link: 'b' }], roles), true);
  assert.equal(israeliOnlyStory({ il: 2 }, [{ link: 'a' }, { link: 'c' }], roles), false);
  assert.equal(israeliOnlyStory({ il: 0 }, [{ link: 'c' }], roles), false);
});

// ---------- the brief and Telegram ----------
test('the brief\'s stories stay in the published files; the total stays at the cap and Israeli stories are never given up', () => {
  const stories = day();
  const g = applyCap(stories, { mode: 'on', max: 1200, now: NOW, scoreOf });
  const dropped = g.core.filter((s) => !g.published.includes(s) && !s.israel).slice(0, 5);
  assert.equal(dropped.length, 5);
  const out = pinInto(g, dropped.map((s) => s.id), 1200);
  assert.equal(out.length, 1200);
  assert.ok(dropped.every((s) => out.includes(s)));
  assert.ok(g.published.filter((s) => s.israel).every((s) => out.includes(s)));
  assert.equal(pinInto(g, [], 1200), g.published);
});

test('telegramPinIds: bounded retention (12 h; up to 36 h while the legacy cap would show it; 60 at most), newest post first, only eligible stories', () => {
  const mk = (id) => ({ ...story({ id }), _members: [{ id: `m-${id}` }] });
  const keysOf = (s) => s._members.map((m) => m.id);
  const a = mk('a'), b = mk('b'), c = mk('c');
  const sent = { 'm-a': NOW - 20 * H, 'm-b': NOW - 20 * H, 'm-c': NOW - 40 * H };
  assert.deepEqual(telegramPinIds([a, b, c], sent, keysOf, NOW, { core: new Set([a, c]) }), ['a']);
  assert.deepEqual(telegramPinIds([a, b, c], sent, keysOf, NOW), []);
  assert.deepEqual(telegramPinIds([a], { 'm-a': NOW - 11 * H }, keysOf, NOW), ['a']);
  assert.equal(TG_PIN_HOURS, 12);
  const many = Array.from({ length: 80 }, (_, i) => mk(`z${i}`));
  const sentMany = Object.fromEntries(many.map((s, i) => [`m-${s.id}`, NOW - i * 60e3]));
  const pins = telegramPinIds(many, sentMany, keysOf, NOW, { core: new Set(many) });
  assert.equal(pins.length, TG_PIN_MAX);
  assert.equal(pins[0], 'z0');
  assert.deepEqual(telegramPinIds(many, undefined, keysOf, NOW), []);
  assert.deepEqual(telegramPinIds([a], { 'm-a': NOW + 10 * 60e3 }, keysOf, NOW), [], 'a post time in the future is ignored');
  // any article id of the story counts (a late older article can change the story's key)
  const s1 = { ...story({ id: 'x1' }), _members: [{ id: 'late-older' }, { id: 'posted-under-this' }] };
  assert.deepEqual(telegramPinIds([s1], { 'posted-under-this': NOW - 2 * H }, keysOf, NOW), ['x1']);
});

test('a story posted to Telegram that the pool would not keep stays in the published files; total 1,200, Israeli stories stay', () => {
  const stories = day();
  const g = applyCap(stories, { mode: 'on', max: 1200, now: NOW, scoreOf });
  const dropped = g.core.filter((s) => !g.published.includes(s) && !s.israel).slice(0, 5);
  const keyOf = (s) => [`key-${s.id}`];
  const sent = Object.fromEntries(dropped.map((s, i) => [keyOf(s)[0], NOW - (i + 1) * 20 * 60e3]));
  const pins = telegramPinIds(g.union, sent, keyOf, NOW);
  assert.deepEqual(pins.slice().sort(), dropped.map((s) => s.id).sort());
  const out = pinInto(g, pins, 1200);
  assert.equal(out.length, 1200);
  assert.ok(dropped.every((s) => out.includes(s)));
  assert.ok(g.published.filter((s) => s.israel).every((s) => out.includes(s)));
  assert.ok(dropped.every((s) => !g.published.includes(s)), 'without the pin they would have been absent');
});

test('the wiring in collect.js: notifications, summaries, translations, brief, trends and the source report read `core`; the files read `published`', () => {
  const src = readFileSync(new URL('../src/collect.js', import.meta.url), 'utf8');
  for (const call of ['telegramPost(core,', 'aiSummaries(core,', 'morningBrief(core,', 'trendBoard(signals, core,', 'const needTr = core.filter', 'const priority = [...core]', 'fillSummaries([...priority, ...core.filter', 'stories: core, items', 'translateTexts(']) assert.ok(src.includes(call), call);
  for (const call of ['stories: published.filter((s) => firstIds.has(s.id))', 'stories: published.filter((s) => !firstIds.has(s.id))']) assert.ok(src.includes(call), call);
  assert.ok(!/telegramPost\(stories|aiSummaries\(stories|morningBrief\(stories|fillSummaries\(\[\.\.\.priority, \.\.\.stories/.test(src), 'no consumer reads the raw list');
  assert.ok(src.includes('const capMode = capG1Mode();'));
  assert.ok(src.includes("const tgPins = capMode === 'on' ? telegramPinIds(stories, tg.sent, (s) => s._members.map((m) => m.id), now, { core: new Set(core) }) : [];"));
  assert.ok(src.includes('pinInto(cap, [...(brief?.ids || []), ...tgPins], MAX_STORIES)'));
  assert.ok(src.indexOf('const tgPins') < src.indexOf('delete s._members'), 'the story keys need _members');
  assert.ok(src.includes('...(cap.keptIds ? { capKept:'), 'the saved state is unchanged when the flag is off');
});

test('the Israeli monitoring tab\'s default list is in the pool too: stories only Israeli sites carry are not squeezed out by the three editorial tabs', () => {
  const stories = day();
  const onlyIsraeli = Array.from({ length: 150 }, (_, i) => story({ latest: NOW - (4 + i * 0.1) * H, first: NOW - (5 + i * 0.1) * H, _ed: 25, pop: 10 + (i % 50), _israeliOnly: true, title: 'israeli only' }));
  const all = newestFirst([...stories, ...onlyIsraeli]);
  const sc = (s) => ({ score: s._ed, israeliOnly: !!s._israeliOnly, ilmon: !!s._israeliOnly || !!s.israel });
  const g = applyCap(all, { mode: 'on', max: 1200, now: NOW, scoreOf: sc });
  const inf = new Map(all.map((s) => [s, { ed: s._ed, fresh: freshness(s, NOW), israeliOnly: !!s._israeliOnly, ilmon: !!s._israeliOnly || !!s.israel }]));
  const want = listForIlmon(all, inf);
  const pool = new Set(g.published);
  assert.ok(want.filter((s) => pool.has(s)).length / want.length >= 0.97, 'the Israeli monitoring list is in the pool');
  assert.equal(g.published.length, 1200);
  assert.ok(g.stats.recallPool.ilmon >= 97, `ilmon recall in the log: ${g.stats.recallPool.ilmon}`);
});
