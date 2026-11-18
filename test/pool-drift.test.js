import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { tabAccepts, mixAt, freshness, listFor, listSize, offbeat, LIST_SIZE, LIST_SIZE_HIGH, HIGH_FROM, DEFAULT_POSITION, FRESH_HALF_H, POOL_TABS, SLIDER_POSITIONS } from '../src/capselect.js';

// The pool (src/capselect.js) copies the page's ranking formulas. These tests run the PAGE'S OWN functions, taken from public/app.js,
// and compare them with the copy, so a change to the page that the collector does not follow fails here.
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const NOW = Date.UTC(2026, 9, 19, 22, 0, 0);

// a top-level function (up to its closing brace at column 0) or a one-line const
function grab(re) {
  const m = re.exec(app);
  assert.ok(m, `public/app.js no longer has ${re}`);
  if (!/^function/.test(m[0])) return app.slice(m.index, app.indexOf('\n', m.index));
  const end = app.indexOf('\n}\n', m.index);
  return app.slice(m.index, end + 2);
}
function page(stateOver = {}) {
  const state = { tab: 'top', mix: 40, mixF: 50, teamNews: false, ...stateOver };
  const sandbox = {
    state, topics: [], activeTopic: () => null, matchTopic: () => false, athleteSport: () => 'football', ABROAD: { abroad: 'football', abroadB: 'basketball' },
    Date: class extends Date { static now() { return NOW; } },
    Math, Set, Number,
  };
  vm.createContext(sandbox);
  const code = [
    grab(/^const israeliAngle = .*$/m),
    grab(/^function foreignOnly\(s\) \{/m),
    grab(/^function inTab\(s, tab\) \{/m),
    grab(/^const OFFBEAT_TABS = .*$/m),
    grab(/^const EDITORIAL_TABS = .*$/m),
    grab(/^const editorialTab = .*$/m),
    grab(/^const mixVal = .*$/m),
    grab(/^function rankMix\(list\) \{/m),
  ].join('\n');
  vm.runInContext(`${code}\nglobalThis.api = { israeliAngle, foreignOnly, inTab, rankMix, mixVal, editorialTab, OFFBEAT_TABS, EDITORIAL_TABS };`, sandbox);
  return { state, api: sandbox.api };
}

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const mkStories = (n) => Array.from({ length: n }, (_, i) => ({
  id: `s${String(i).padStart(4, '0')}`,
  sport: ['football', 'football', 'basketball', 'other'][Math.floor(rnd() * 4)],
  big: rnd() < 0.3, israel: rnd() < 0.1, abroad: rnd() < 0.05, watchIsrael: rnd() < 0.03,
  local: rnd() < 0.15, low: rnd() < 0.05, minor: rnd() < 0.1,
  first: NOW - Math.floor(rnd() * 40 * 3600e3), latest: NOW - Math.floor(rnd() * 20 * 3600e3),
  ed: { score: Math.round(rnd() * 8000) / 100 + i * 1e-7 }, // distinct, so the page's stable sort and the pool's tie-break order cannot differ
  sources: [{ o: 'fo' }],
}));

test('the page still has the ranking constants the pool copies (slider default, list sizes, tabs, collapsed stories)', () => {
  assert.match(app, /mixF: Number\(store\.get\('mixF', (\d+)\)\)/);
  assert.equal(Number(/mixF: Number\(store\.get\('mixF', (\d+)\)\)/.exec(app)[1]), DEFAULT_POSITION);
  const slice = /list\.slice\(0, mixVal\(\) >= (\d+) \? (\d+) : (\d+)\)/.exec(app);
  assert.ok(slice, 'the list slice changed');
  assert.deepEqual([Number(slice[1]), Number(slice[2]), Number(slice[3])], [HIGH_FROM, LIST_SIZE_HIGH, LIST_SIZE]);
  assert.match(app, /list\.filter\(\(s\) => !s\.local && !s\.low && !s\.minor\)/); // what offbeat() copies
  const { api } = page();
  assert.deepEqual([...api.OFFBEAT_TABS].sort(), [...POOL_TABS].sort());
  for (const tab of POOL_TABS) assert.ok(api.EDITORIAL_TABS.has(tab), `${tab} is no longer an editorial-rank tab`);
  assert.match(app, /sw\[state\.tab\]/); // the football / basketball switch exists; its default is "all" (state.sw)
});

test('the tab rules are the page\'s: Top, Football and Basketball accept exactly the stories the page\'s inTab accepts', () => {
  const { api } = page();
  const stories = mkStories(600).flatMap((s) => [s, { ...s, id: `${s.id}b`, big: !s.big, abroad: !s.abroad }]);
  for (const s of stories) for (const tab of POOL_TABS) assert.equal(tabAccepts(tab, s, false), !!api.inTab(s, tab), `${tab} ${JSON.stringify(s)}`);
  assert.equal(tabAccepts('top', stories[0], true), false); // the page's foreignOnly step
});

test('the mix is the page\'s rankMix: same value at every slider position, in each editorial tab', () => {
  const stories = mkStories(300);
  for (const tab of POOL_TABS) for (const p of [0, 10, 25, 33, 50, 65, 75, 90, 100]) {
    const { api } = page({ tab, mixF: p });
    assert.equal(api.editorialTab(), true);
    const mix = api.rankMix(stories);
    for (const s of stories) assert.ok(Math.abs(mix(s) - mixAt(p, s.ed.score, freshness(s, NOW))) < 1e-12, `${tab}@${p}`);
  }
  assert.equal(FRESH_HALF_H, 6);
});

test('the lists are the page\'s: running the page\'s own filter, rankMix and slice gives the list the pool uses, at every slider position', () => {
  const stories = mkStories(900);
  const info = new Map(stories.map((s) => [s, { ed: s.ed.score, fresh: freshness(s, NOW), israeliOnly: false }]));
  for (const tab of POOL_TABS) for (const p of [0, 25, 50, 69, 70, 75, 100]) {
    const { api } = page({ tab, mixF: p });
    // public/app.js visibleStories for a tab with no search, topic or filter: inTab, the top-tab rule, the off-beat collapse, sort, slice
    let list = stories.filter((s) => api.inTab(s, tab));
    if (tab === 'top') list = list.filter((s) => s.sport !== 'other' || s.big);
    list = list.filter((s) => !s.local && !s.low && !s.minor);
    const mix = api.rankMix(list);
    list.sort((a, b) => mix(b) - mix(a));
    const pageList = list.slice(0, api.mixVal() >= 70 ? 120 : 300).map((s) => s.id);
    assert.deepEqual(listFor(stories, info, tab, p).map((s) => s.id), pageList, `${tab}@${p}`);
    assert.equal(pageList.length <= listSize(p), true);
  }
  assert.deepEqual(SLIDER_POSITIONS, [0, 25, 50, 75, 100]);
  assert.ok(stories.every((s) => offbeat(s) === (!s.local && !s.low && !s.minor)));
});

test('foreignOnly: a story only Israeli sites carry is left out of the three tabs by the page, as the pool assumes', () => {
  const { api } = page();
  const base = { sport: 'football', big: true };
  assert.equal(api.foreignOnly({ ...base, sources: [{ o: 'il' }] }), null); // Israeli sites only: not in Top / Football / Basketball
  assert.ok(api.foreignOnly({ ...base, sources: [{ o: 'fo' }] })); // a foreign report: shown
  assert.ok(api.foreignOnly({ ...base, sources: [{ o: 'il' }, { o: 'fo' }], fv: { title: 'x', link: 'y' } })); // both: shown with the foreign report
  assert.equal(api.foreignOnly({ ...base, sources: [{ o: 'il' }, { o: 'fo' }] }), null); // both but no foreign report from the collector: left out
});

// ---------- the Israeli monitoring tab, which the pool also lists (at the default slider of the tabs outside EDITORIAL_TABS) ----------
import { listForIlmon, ILMON_POSITION } from '../src/capselect.js';
import { storyViews } from '../src/roles.js';

test('the Israeli monitoring tab: default slider, membership and ordering are the page\'s', () => {
  assert.equal(Number(/mix: Number\(store\.get\('mix', (\d+)\)\)/.exec(app)[1]), ILMON_POSITION);
  const stories = mkStories(700).map((s, i) => ({ ...s, pop: Math.round(rnd() * 5000) / 10 + i * 1e-7, il: rnd() < 0.3 }));
  // membership: the page's inTab uses the views the collector computes (roles.js storyViews: an Israeli-origin report or an Israeli subject)
  const { api } = page({ tab: 'ilmon', mix: ILMON_POSITION });
  assert.equal(api.editorialTab(), false, 'the tab sorts by popularity, not by the editorial score');
  for (const s of stories) {
    const ev = { il: s.il ? 2 : 0, foreign: 1 };
    assert.equal(!!api.inTab({ v: storyViews(s, ev) }, 'ilmon'), s.il || !!s.israel);
  }
  // ordering and slice: the page's own filter, rankMix (popularity formula) and slice
  let list = stories.filter((s) => api.inTab({ ...s, v: storyViews(s, { il: s.il ? 2 : 0 }) }, 'ilmon'));
  const mix = api.rankMix(list);
  list.sort((a, b) => mix(b) - mix(a));
  const pageList = list.slice(0, api.mixVal() >= 70 ? 120 : 300).map((s) => s.id);
  const info = new Map(stories.map((s) => [s, { ed: s.ed.score, fresh: freshness(s, NOW), israeliOnly: false, ilmon: s.il || !!s.israel }]));
  assert.deepEqual(listForIlmon(stories, info).map((s) => s.id), pageList);
});
