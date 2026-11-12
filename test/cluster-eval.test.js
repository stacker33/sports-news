import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, numbers, regressions, loadCorpus, loadPairs, loadSynthetic, loadBaseline, scorePairs, runGrouping } from '../scripts/eval-clusters.mjs';

const LABELS = ['same', 'different', 'same-match', 'related'];

test('grouping evaluation: the data is whole (every labelled article exists, labels and their source are stated)', () => {
  const corpus = loadCorpus();
  const ids = new Set(corpus.items.map((i) => i.id));
  assert.equal(ids.size, corpus.items.length);
  const { pairs } = loadPairs();
  assert.ok(pairs.length >= 150);
  assert.equal(new Set(pairs.map((p) => p.id)).size, pairs.length);
  for (const p of pairs) {
    assert.ok(ids.has(p.a) && ids.has(p.b) && p.a !== p.b, p.id);
    assert.ok(LABELS.includes(p.label), p.id);
    assert.equal(p.by, 'assistant', p.id); // read and decided by the assistant
    assert.ok([null, 'confirmed', 'corrected'].includes(p.editor), p.id); // an editor's review, when there is one
  }
  // both kinds of pairs, in every hard group the set was built for
  for (const l of ['same', 'different']) assert.ok(pairs.filter((p) => p.label === l).length >= 50, l);
  for (const g of ['multilingual', 'big-cluster', 'same-subject', 'hebrew-vs-foreign', 'same-player', 'transfer', 'late-source']) assert.ok(pairs.some((p) => p.group === g), g);
  // invented cases are marked as invented and live in their own file with their own articles
  const syn = loadSynthetic();
  const synIds = new Set(syn.items.map((i) => i.id));
  for (const p of syn.pairs) {
    assert.equal(p.by, 'synthetic', p.id);
    assert.ok(synIds.has(p.a) && synIds.has(p.b) && !ids.has(p.a) && !ids.has(p.b), p.id);
  }
});

test('grouping evaluation: runs with no network, gives the same numbers every time, and is not worse than the baseline', () => {
  const before = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('the evaluation must not use the network'); };
  try {
    const a = numbers(evaluate());
    const b = numbers(evaluate());
    assert.deepEqual(a, b);
    const base = loadBaseline();
    assert.ok(base, 'baseline.json is missing: node scripts/eval-clusters.mjs --write-baseline');
    assert.deepEqual(regressions(a, base), []);
  } finally {
    globalThis.fetch = before;
  }
});

test('grouping evaluation: the score counts what it says', () => {
  const items = [1, 2, 3, 4].map((n) => ({ id: `a${n}`, title: n < 3 ? `Riverside United sack coach Molina after five defeats ${n}` : `Tennis final in Shanghai goes to three sets ${n}`, lang: 'en', publisher: `p${n}`, published: 1e12 + n * 60e3, sport: 'football', sportSure: false, ents: [] }));
  const s = scorePairs([
    { id: 'x1', a: 'a1', b: 'a2', label: 'same' }, // joined: a correct merge
    { id: 'x2', a: 'a1', b: 'a3', label: 'same' }, // apart: a missed merge
    { id: 'x3', a: 'a3', b: 'a4', label: 'different' }, // joined: a false merge
    { id: 'x4', a: 'a2', b: 'a4', label: 'different' }, // apart: right
    { id: 'x5', a: 'a1', b: 'zz', label: 'same' }, // an article that is not in the data: not counted
  ], runGrouping(items));
  assert.deepEqual([s.correctMerges, s.missedMerges, s.falseMerges, s.correctlyApart, s.missing], [1, 1, 1, 1, 1]);
  assert.equal(s.precision, 50);
  assert.equal(s.recall, 50);
});
