import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { capStories as capFromCollect } from '../src/collect.js';
import { capStories, selectG1, applyCap, pinInto, capG1Mode, mixValue, KEEP_BONUS } from '../src/capselect.js';

const H = 3600e3;
const NOW = Date.UTC(2026, 9, 19, 22, 0, 0);
let n = 0;
// a story as the cap receives it: newest last article first
const story = (over = {}) => {
  const id = over.id || `s${String(++n).padStart(6, '0')}`;
  return { id, title: id, first: NOW - H, latest: NOW - H, sourceCount: 1, langs: ['en'], israel: false, abroad: false, ...over, _ed: over._ed ?? 30 };
};
const newestFirst = (list) => [...list].sort((a, b) => b.latest - a.latest || (a.id < b.id ? -1 : 1));
const scoreOf = (s) => s._ed;
const ids = (list) => list.map((s) => s.id);

// A day like the saved state: Israeli stories, fresh low-value stories, and older high-importance ones.
function day({ israeli = 100, fresh = 1500, importantOld = 40 } = {}) {
  const list = [];
  for (let i = 0; i < israeli; i++) list.push(story({ israel: true, latest: NOW - (5 + (i % 30)) * H, first: NOW - (6 + (i % 30)) * H, _ed: 60 }));
  for (let i = 0; i < fresh; i++) list.push(story({ latest: NOW - (i % 120) * 60e3 - 1000, first: NOW - (i % 120) * 60e3 - 2000, _ed: 8 + (i % 7), title: 'local league lineup' })); // fresh, editorially low
  for (let i = 0; i < importantOld; i++) list.push(story({ latest: NOW - (3 + (i % 3)) * H, first: NOW - (4 + (i % 3)) * H, _ed: 75 - (i % 5), sourceCount: 6, title: 'important older story' })); // a few hours old, editorially high (the mix is 50% freshness, so a day-old story does not win: docs/g1-cap.md)
  return newestFirst(list);
}

test('the flag is off unless explicitly set; shadow and on are recognised', () => {
  assert.equal(capG1Mode({}), 'off');
  assert.equal(capG1Mode({ CAP_G1: '' }), 'off');
  assert.equal(capG1Mode({ CAP_G1: '0' }), 'off');
  assert.equal(capG1Mode({ CAP_G1: 'shadow' }), 'shadow');
  for (const v of ['1', 'true', 'ON', ' yes ']) assert.equal(capG1Mode({ CAP_G1: v }), 'on');
});

test('flag off: the cap is exactly the legacy cap (same function, same stories, same order) and nothing is recorded', () => {
  const stories = day();
  const r = applyCap(stories, { mode: 'off', max: 1200, now: NOW, scoreOf });
  assert.deepEqual(ids(r.published), ids(capStories(stories, 1200)));
  assert.equal(r.published, r.core);
  assert.equal(r.union, r.core);
  assert.equal(r.keptIds, null);
  assert.equal(r.stats, null);
  assert.equal(capFromCollect, capStories); // src/collect.js still exports the same function
});

test('G1 keeps the total at exactly 1,200 and keeps every Israeli story the legacy cap keeps, in the same tier', () => {
  const stories = day();
  const g = applyCap(stories, { mode: 'on', max: 1200, now: NOW, scoreOf });
  const legacy = capStories(stories, 1200);
  assert.equal(g.published.length, 1200);
  const israeliLegacy = legacy.filter((s) => s.israel);
  const publishedSet = new Set(g.published);
  assert.ok(israeliLegacy.every((s) => publishedSet.has(s)), 'no Israeli story lost');
  assert.equal(g.published.filter((s) => s.israel).length, israeliLegacy.length);
  // the published list is in the legacy order (newest last article first): the files and the app's tie-breaks do not change
  assert.deepEqual(ids(g.published), ids(newestFirst(g.published)));
});

test('G1 brings in high-importance older stories and drops low-value fresh ones the legacy cap kept', () => {
  const stories = day();
  const legacy = new Set(capStories(stories, 1200));
  const g = applyCap(stories, { mode: 'on', max: 1200, now: NOW, scoreOf });
  const pub = new Set(g.published);
  const important = stories.filter((s) => s.title === 'important older story');
  assert.equal(important.filter((s) => legacy.has(s)).length, 0, 'the legacy cap loses them all (the scenario)');
  assert.equal(important.filter((s) => pub.has(s)).length, important.length, 'G1 keeps them all');
  const lowFresh = stories.filter((s) => s.title === 'local league lineup');
  assert.ok(lowFresh.filter((s) => pub.has(s)).length < lowFresh.filter((s) => legacy.has(s)).length, 'low-value fresh stories give up slots');
  assert.ok(g.stats.added >= important.length, `added ${g.stats.added}`);
  assert.equal(g.stats.dropped, g.stats.added); // same total: every addition displaces one
});

test('stories that only G1 admits are display-only: the consumer list (core) is exactly what the legacy cap builds', () => {
  const stories = day();
  const legacy = capStories(stories, 1200);
  const g = applyCap(stories, { mode: 'on', max: 1200, now: NOW, scoreOf });
  assert.deepEqual(ids(g.core), ids(legacy)); // Telegram, summaries, translations, brief, trends, source report read this
  const extra = g.published.filter((s) => !new Set(legacy).has(s));
  assert.ok(extra.length > 0);
  assert.ok(extra.every((s) => !g.core.includes(s)), 'no G1-only story reaches a notification, a model call or the brief');
  // the union (what gets enriched) holds both
  assert.ok([...g.core, ...g.published].every((s) => g.union.includes(s)));
});

test('shadow publishes the legacy list and still reports what G1 would have done', () => {
  const stories = day();
  const r = applyCap(stories, { mode: 'shadow', max: 1200, now: NOW, scoreOf });
  assert.deepEqual(ids(r.published), ids(capStories(stories, 1200)));
  assert.equal(r.stats.g1, 1200);
  assert.ok(r.stats.added > 0 && r.stats.dropped > 0);
  assert.equal(r.keptIds.length, 1200);
});

test('deterministic: the same input twice, or the input in another order, gives the same selection; ties break on last article then id', () => {
  const stories = day({ fresh: 1400 });
  const a = applyCap(stories, { mode: 'on', max: 1200, now: NOW, scoreOf });
  const b = applyCap(stories, { mode: 'on', max: 1200, now: NOW, scoreOf });
  assert.deepEqual(ids(a.published), ids(b.published));
  const shuffled = [...stories].sort((x, y) => (x.id < y.id ? 1 : -1)); // a different input order
  const c = selectG1(shuffled, { max: 1200, now: NOW, scoreOf });
  const aSet = new Set(ids(a.published));
  assert.deepEqual([...c.keep].map((s) => s.id).filter((i) => aSet.has(i)).length, 1200 > aSet.size ? aSet.size : 1200);
  assert.deepEqual(new Set([...c.keep].map((s) => s.id)), aSet);
  // identical mix value, identical last article: the smaller id wins the last slot
  const t = [story({ id: 'a', israel: true, _ed: 50 }), story({ id: 'c', _ed: 50 }), story({ id: 'b', _ed: 50 })].map((s) => ({ ...s, first: NOW - H, latest: NOW - H }));
  const sel = selectG1(t, { max: 2, now: NOW, scoreOf });
  assert.deepEqual([...sel.keep].map((s) => s.id).sort(), ['a', 'b']);
});

test('a story with a missing field (NaN score or time) sorts last and never breaks the order', () => {
  const t = [story({ id: 'good', _ed: 40 }), story({ id: 'nan1', _ed: NaN }), story({ id: 'nan2', _ed: 'x' }), story({ id: 'notime', first: undefined, latest: undefined, _ed: 90 })];
  const sel = selectG1(t, { max: 1, now: NOW, scoreOf });
  assert.deepEqual([...sel.keep].map((s) => s.id), ['good']);
  assert.equal(mixValue({ first: NaN }, 50, NOW), -1);
});

test('no churn: a story kept by the previous run stays unless clearly beaten; the boundary does not flip between runs', () => {
  // 1,300 stories whose mix values are within a hair of each other around the boundary, drifting a little each run
  const base = [];
  for (let i = 0; i < 1300; i++) base.push(story({ id: `b${String(i).padStart(4, '0')}`, latest: NOW - i * 1000, first: NOW - 2 * H - i * 1000, _ed: 40 }));
  const run = (shift, prev) => {
    const list = newestFirst(base.map((s, i) => ({ ...s, _ed: 40 + ((i * 7 + shift * 3) % 5) * 0.2 }))); // tiny, run-to-run jitter in the editorial score
    return selectG1(list, { max: 1200, now: NOW + shift * 300e3, scoreOf, prevKept: prev, bonus: prev.size ? KEEP_BONUS : 0 });
  };
  const jac = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };
  let prevWith = new Set(), prevWithout = new Set(), sumWith = 0, sumWithout = 0;
  const first = run(0, new Set());
  prevWith = new Set([...first.keep].map((s) => s.id));
  prevWithout = new Set(prevWith);
  for (let k = 1; k <= 20; k++) {
    const w = new Set([...run(k, prevWith).keep].map((s) => s.id));
    const o = new Set([...run(k, new Set()).keep].map((s) => s.id));
    sumWith += jac(w, prevWith);
    sumWithout += jac(o, prevWithout);
    prevWith = w;
    prevWithout = o;
  }
  assert.ok(sumWith / 20 >= sumWithout / 20, 'the keep bonus never makes the selection less stable');
  assert.ok(sumWith / 20 > 0.97, `consecutive selections overlap by ${(sumWith / 20).toFixed(3)}`);
});

test('Israeli priority is unchanged even when Israeli stories fill the cap: nothing else gets in, as today', () => {
  const stories = newestFirst([...Array.from({ length: 1250 }, (_, i) => story({ israel: true, latest: NOW - i * 1000, _ed: 10 })), ...Array.from({ length: 50 }, () => story({ _ed: 95, latest: NOW - 1000 }))]);
  const g = applyCap(stories, { mode: 'on', max: 1200, now: NOW, scoreOf });
  assert.deepEqual(ids(g.published), ids(capStories(stories, 1200)));
  assert.equal(g.published.filter((s) => !s.israel).length, 0);
});

test('fewer stories than the cap: nothing is cut or reordered in any mode', () => {
  const stories = day({ israeli: 10, fresh: 20, importantOld: 5 });
  for (const mode of ['off', 'shadow', 'on']) assert.deepEqual(ids(applyCap(stories, { mode, max: 1200, now: NOW, scoreOf }).published), ids(stories));
});

test('the brief\'s stories stay in the published files; the total stays at the cap', () => {
  const stories = day();
  const g = applyCap(stories, { mode: 'on', max: 1200, now: NOW, scoreOf });
  const droppedLegacy = g.core.filter((s) => !g.published.includes(s) && !s.israel).slice(0, 5);
  assert.equal(droppedLegacy.length, 5);
  const out = pinInto(g, droppedLegacy.map((s) => s.id), 1200);
  assert.equal(out.length, 1200);
  assert.ok(droppedLegacy.every((s) => out.includes(s)));
  assert.ok(g.published.filter((s) => s.israel).every((s) => out.includes(s)), 'Israeli stories are never the ones given up');
  assert.equal(pinInto(g, [], 1200), g.published);
});

test('the wiring in collect.js: notifications, summaries, translations, brief, trends and the source report read `core`; the files read `published`', () => {
  const src = readFileSync(new URL('../src/collect.js', import.meta.url), 'utf8');
  for (const call of ['telegramPost(core,', 'aiSummaries(core,', 'morningBrief(core,', 'trendBoard(signals, core,', 'const needTr = core.filter', 'const priority = [...core]', 'fillSummaries([...priority, ...core.filter', 'stories: core, items']) assert.ok(src.includes(call), call);
  for (const call of ['stories: published.filter((s) => firstIds.has(s.id))', 'stories: published.filter((s) => !firstIds.has(s.id))']) assert.ok(src.includes(call), call);
  assert.ok(!/telegramPost\(stories|aiSummaries\(stories|morningBrief\(stories|fillSummaries\(\[\.\.\.priority, \.\.\.stories/.test(src), 'no consumer reads the raw list');
  assert.ok(src.includes('const capMode = capG1Mode();'));
  assert.ok(src.includes('the legacy cap is used'), 'a failure of the new selection falls back to the legacy cap');
  // the saved state is unchanged when the flag is off
  assert.ok(src.includes('...(cap.keptIds ? { capKept:'));
});
