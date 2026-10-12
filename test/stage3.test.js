// Discovery version, stage 3: watch controls (overrides), provenance metrics, structured feedback, the evaluation
// replay and the story cap. Network is mocked (ntfy); nothing is sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateOverrides, activeNow } from '../public/watchlist-rules.js';
import { applyOverrides, candidateQueries, entryId, searchable, entryLocales } from '../src/watchlist.js';
import { queryMetrics, discoveryDelay, usefulness, lowRankReasons } from '../src/metrics.js';
import { loadFeedback, votesFile } from '../src/feedback.js';
import { evaluate } from '../scripts/evaluate.mjs';
import { capStories } from '../src/collect.js';

const now = Date.parse('2026-10-08T12:00:00Z');
const P = (name, extra = {}) => ({ id: entryId('player', 'football', name), name, aliases: [], type: 'player', sport: 'football', category: 'israeli-candidate', status: 'verified', israelLink: { basis: 'kb-nationality' }, team: { en: 'Ajax', country: 7 }, ...extra });

test('overrides: validation rejects unknown fields, bad values and unsupported verification', () => {
  const ok = validateOverrides({ entries: { a: { enabled: false, priority: 'high', langs: ['en', 'nl'], until: '2026-10-20' } }, families: { exceptional: { enabled: false } } }, new Set(['a']));
  assert.ok(ok.ok, ok.errors.join());
  const bad = validateOverrides({ entries: { a: { enabled: 'no', priority: 'urgent', langs: ['xx'], colour: 1 }, ghost: { enabled: true } }, families: { nope: {} } }, new Set(['a']));
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 6);
  assert.deepEqual(bad.clean.entries, {});
  // verifying needs a basis and a note: nationality is never assumed
  const v = validateOverrides({ entries: { a: { status: 'verified' } } });
  assert.ok(!v.ok && !v.clean.entries.a);
  assert.ok(validateOverrides({ entries: { a: { status: 'verified', israelLink: { basis: 'editor', note: 'confirmed by the desk' } } } }).ok);
  assert.ok(!validateOverrides([]).ok);
});

test('overrides change the searches: disable, languages, priority, temporary expiry, families', () => {
  const gl = P('Oscar Gloukh');
  const base = candidateQueries([gl], {});
  assert.deepEqual(base.map((q) => q.locale).sort(), ['en', 'nl']); // English + the club's country language
  assert.equal(candidateQueries(applyOverrides([gl], { entries: { [gl.id]: { enabled: false } } }), {}).length, 0);
  const langs = candidateQueries(applyOverrides([gl], { entries: { [gl.id]: { langs: ['es', 'it'], priority: 'low' } } }), {});
  assert.deepEqual(langs.map((q) => q.locale).sort(), ['es', 'it']);
  assert.ok(langs.every((q) => q.priority === 'low' && q.why.startsWith('name search')));
  // temporary tracking: active until the date, then off (and the page shows it as expired)
  const live = applyOverrides([gl], { entries: { [gl.id]: { until: '2026-10-09' } } }, now);
  const gone = applyOverrides([gl], { entries: { [gl.id]: { until: '2026-10-07' } } }, now);
  assert.equal(candidateQueries(live, {}).length, 2);
  assert.equal(candidateQueries(gone, {}).length, 0);
  assert.equal(searchable(gone[0]).why, 'temporary tracking expired');
  assert.ok(activeNow({ until: '2026-10-09' }, now) && !activeNow({ until: '2026-10-07' }, now));
  // families
  const vocab = { querySets: { israeliAngle: [{ lang: 'es', q: 'israelí fútbol' }], exceptional: [{ lang: 'en', q: '"world record"' }] } };
  assert.equal(candidateQueries([], vocab).length, 2);
  assert.equal(candidateQueries([], { ...vocab, familyOverrides: { exceptional: { enabled: false } } }).length, 1);
  assert.equal(candidateQueries([], { ...vocab, familyOverrides: { israeliAngle: { priority: 'high' } } }).find((q) => q.family === 'israeliAngle').priority, 'high');
  // every query says why it exists
  assert.ok(candidateQueries([gl], vocab).every((q) => q.why));
  assert.deepEqual(entryLocales({ team: { country: 6 } }), ['en']);
});

test('searchable: why an entry is or is not searched', () => {
  assert.equal(searchable(P('A B')).yes, true);
  assert.match(searchable(P('A B', { status: 'pending' })).why, /pending/);
  assert.match(searchable(P('A B', { status: 'source-only' })).why, /recognition/);
  assert.match(searchable(P('A B'), new Set(['a b'])).why, /editors/);
  assert.match(searchable(P('A B', { enabled: false })).why, /disabled/);
});

test('query value is attributed conservatively', () => {
  const qa = 'wq-a';
  const stories = [
    { ed: { score: 70 }, _members: [{ paths: [qa], via: { src: qa, at: now } }] }, // only qa found it: unique
    { ed: { score: 70 }, _members: [{ paths: [qa, 'one'], via: { src: 'one', at: now } }] }, // also a feed: not unique, redundant
    { ed: { score: 10 }, _members: [{ paths: [qa], via: { src: qa, at: now, approx: true } }] }, // unique, not relevant
  ];
  const m = queryMetrics(stories, new Set([qa]), [{ sid: qa, why: 'general-feed' }, { sid: 'x', why: 'junk' }])[qa];
  assert.deepEqual({ ...m, rejected: undefined }, { items: 3, redundant: 1, stories: 3, relevant: 2, unique: 2, uniqueRelevant: 1, firstFound: 1, rejected: undefined });
  assert.deepEqual(m.rejected, { 'general-feed': 1 });
});

test('discovery delay uses trustworthy times only', () => {
  const d = discoveryDelay([
    { published: now - 30 * 60000, via: { src: 'wq-a', at: now } },
    { published: now - 90 * 60000, via: { src: 'one', at: now }, google: false },
    { published: now - 10 * 60000, via: { src: 'one', at: now }, dateUnknown: true }, // unknown time
    { published: now + 60000, via: { src: 'one', at: now } }, // in the future
    { published: now - 60000, via: { src: 'one', at: now, approx: true } }, // collected before provenance existed
  ]);
  assert.deepEqual(d.watch, { n: 1, medianMin: 30 });
  assert.deepEqual(d.direct, { n: 1, medianMin: 90 });
  assert.equal(d.google.n, 0);
});

test('usefulness always carries its sample size and says when it is too small', () => {
  const u = usefulness({ a: { up: ['d1', 'd2'], down: [], why: { useful: ['d1', 'd2'] } }, b: { up: [], down: ['d1'], why: { covered: ['d1'] } } }, [{ id: 'a', v: ['f'] }, { id: 'b', v: ['i'] }]);
  assert.deepEqual([u.all.n, u.all.useful, u.all.rate, u.all.enough], [2, 1, 50, false]);
  assert.deepEqual(u.all.why, { useful: 2, covered: 1 });
  assert.equal(u.foreign.n, 1);
  const r = lowRankReasons([{ v: ['f'], ed: { score: 20, limits: [{ k: 'single' }, { k: 'headline' }] } }], [{ why: 'junk' }]);
  assert.deepEqual(r, { rejected: { junk: 1 }, lowRanked: 1, lowRankLimits: { single: 1 } });
});

test('structured vote reasons: a fixed list, one per device, nothing free-form', async () => {
  const msgs = [
    { device: 'd1', type: 'vote', id: 's1', vote: -1 },
    { device: 'd1', type: 'vote', id: 's1', vote: -1, reason: 'covered' },
    { device: 'd2', type: 'vote', id: 's1', vote: -1, reason: 'my private note' }, // not on the list: ignored
    { device: 'd3', type: 'vote', id: 's1', vote: 1 },
  ];
  const body = msgs.map((m, i) => JSON.stringify({ event: 'message', id: `m${i}`, time: now / 1000, message: JSON.stringify({ v: 1, ...m }) })).join('\n');
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => body });
  try {
    const { feedback } = await loadFeedback({}, now);
    const v = feedback.votes.s1;
    assert.deepEqual([v.up, v.down], [['d3'], ['d1', 'd2']]);
    assert.deepEqual(v.why, { covered: ['d1'], useful: ['d3'] });
    assert.deepEqual(votesFile(feedback, now).stories.s1.why, { covered: 1, useful: 1 });
  } finally {
    globalThis.fetch = real;
  }
});

test('evaluation replay: each miss is put down to the right cause (synthetic fixtures)', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/eval-synthetic.json', import.meta.url), 'utf8'));
  const out = evaluate(fx.examples, { ...fx.data, now: Date.parse(fx.now) });
  for (const r of out.results) assert.equal(r.cause, fx.expected[r.id], `${r.id}: ${r.detail}`);
  assert.equal(out.judged, 7);
  // the real set exists, is separate and labelled as observed
  const real = JSON.parse(readFileSync(new URL('./fixtures/eval-real.json', import.meta.url), 'utf8'));
  assert.ok(real.examples.length >= 10 && real.examples.every((e) => e.observed && e.match && e.expect));
});

test('story cap keeps Israeli-angle stories, then the newest, in order', () => {
  const st = Array.from({ length: 10 }, (_, i) => ({ id: i, latest: 100 - i, ...(i >= 8 ? { abroad: true } : {}) }));
  const kept = capStories(st, 5);
  assert.deepEqual(kept.map((s) => s.id), [0, 1, 2, 8, 9]);
  assert.equal(capStories(st, 20).length, 10);
});
