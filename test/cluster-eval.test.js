import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, numbers, regressions, loadCorpus, loadPairs, loadSynthetic, loadBaseline, loadBefore, scorePairs, runGrouping, finalLabel } from '../scripts/eval-clusters.mjs';

const FIRST = ['same', 'different', 'same-match', 'related'];
const POLICY = ['same', 'different', 'review'];
const count = (l, f) => l.filter(f).length;

test('grouping evaluation: the data is whole (every labelled article exists, labels and their source are stated)', () => {
  const corpus = loadCorpus();
  const ids = new Set(corpus.items.map((i) => i.id));
  assert.equal(ids.size, corpus.items.length);
  const { pairs } = loadPairs();
  assert.ok(pairs.length >= 150);
  assert.equal(new Set(pairs.map((p) => p.id)).size, pairs.length);
  for (const p of pairs) {
    assert.ok(ids.has(p.a) && ids.has(p.b) && p.a !== p.b, p.id);
    assert.ok(FIRST.includes(p.label), p.id);
    assert.ok(POLICY.includes(p.policy), p.id);
    assert.equal(p.by, 'assistant', p.id); // the first label: read and decided by the assistant
    assert.equal(p.policyBy, 'assistant', p.id); // the approved rules, applied to this pair by the assistant
    assert.ok([null, 'confirmed', 'corrected', 'decided'].includes(p.editor), p.id); // an editor's review, when there is one
    // an editor's decision comes with its status; a pair nobody reviewed has neither
    assert.equal(!!p.editorDecision, p.editor !== null, p.id);
    if (p.editorDecision) assert.ok(['MERGE', 'SEPARATE_BUT_RELATED', 'SEPARATE'].includes(p.editorDecision), p.id);
    // a label the rules changed, or a case for a person, says why
    if (p.policy !== p.label) assert.ok(p.policyNote, p.id);
    if (p.phaseA) assert.ok(['pre_match', 'live_match', 'post_match', 'unknown'].includes(p.phaseA) && ['pre_match', 'live_match', 'post_match', 'unknown'].includes(p.phaseB), p.id);
  }
  // the 95 editor decisions: exactly the pairs that were "review" or whose label the rules changed
  const decided = pairs.filter((p) => p.editorDecision);
  assert.equal(decided.length, 95);
  assert.deepEqual(['MERGE', 'SEPARATE_BUT_RELATED', 'SEPARATE'].map((d) => count(decided, (p) => p.editorDecision === d)), [10, 83, 2]);
  for (const p of pairs) assert.equal(!!p.editorDecision, p.policy === 'review' || p.policy !== p.label, p.id);
  assert.equal(count(pairs, (p) => p.policy === 'review'), 25); // the assistant's policy label is kept: those 25 stay "review" there
  assert.equal(count(decided, (p) => p.editor === 'corrected'), 1); // r153
  // the file of decisions and the pairs agree
  const file = JSON.parse(readFileSync(new URL('./fixtures/cluster-eval/editor-decisions.json', import.meta.url), 'utf8'));
  assert.equal(file.decisions.length, 95);
  for (const d of file.decisions) assert.equal(pairs.find((p) => p.id === d.id).editorDecision, d.decision, d.id);
  // what each decision means for the score: both separate kinds must not merge, only MERGE must
  assert.deepEqual(['MERGE', 'SEPARATE_BUT_RELATED', 'SEPARATE'].map((d) => finalLabel({ editorDecision: d, policy: 'review' })), ['same', 'different', 'different']);
  assert.equal(finalLabel({ policy: 'same' }), 'same'); // unreviewed: the assistant's label, unverified
  // the first reading of Step 0 is kept as it was
  // (the 264 pairs of Step 0 / Step 1; the Step 2 review pairs are a separate group, unverified, below)
  const original = pairs.filter((p) => p.group !== 'step2-review');
  assert.equal(original.length, 264);
  assert.deepEqual(FIRST.map((l) => count(original, (p) => p.label === l)), [57, 114, 53, 40]);
  const step2 = pairs.filter((p) => p.group === 'step2-review');
  assert.equal(step2.length, 19);
  for (const p of step2) assert.ok(!p.editorDecision && p.editor === null && p.by === 'assistant' && p.label === p.policy && ['same', 'different'].includes(p.label), p.id); // unverified
  // the approved rules: same-match and related pairs were classified one by one, never all one way
  const moved = pairs.filter((p) => p.label === 'same-match' || p.label === 'related');
  for (const l of POLICY) assert.ok(count(moved, (p) => p.policy === l) > 0, l);
  // two phases of one match are never "same"
  for (const p of pairs) if (p.phaseA && p.phaseA !== 'unknown' && p.phaseB !== 'unknown' && p.phaseA !== p.phaseB) assert.equal(p.policy, 'different', p.id);
  // both kinds of pairs, in every hard group the set was built for
  for (const l of ['same', 'different']) assert.ok(count(pairs, (p) => p.policy === l) >= 50, l);
  for (const g of ['multilingual', 'big-cluster', 'same-subject', 'hebrew-vs-foreign', 'same-player', 'transfer', 'late-source']) assert.ok(pairs.some((p) => p.group === g), g);
  // invented cases are marked as invented and live in their own file with their own articles
  const syn = loadSynthetic();
  const synIds = new Set(syn.items.map((i) => i.id));
  for (const p of syn.pairs) {
    assert.equal(p.by, 'synthetic', p.id);
    assert.ok(['same', 'different'].includes(p.policy), p.id);
    assert.ok(synIds.has(p.a) && synIds.has(p.b) && !ids.has(p.a) && !ids.has(p.b), p.id);
  }
});

test('grouping evaluation: runs with no network, gives the same numbers every time, and is not worse than the baseline', () => {
  const before = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('the evaluation must not use the network'); };
  try {
    const a = numbers(evaluate());
    const b = numbers(evaluate({ time: false }));
    assert.deepEqual({ ...a, time: undefined }, { ...b, time: undefined });
    const base = loadBaseline();
    assert.ok(base, 'baseline.json is missing: node scripts/eval-clusters.mjs --write-baseline');
    assert.deepEqual(regressions(a, base), []);
    // pairs a person still has to decide are never counted as right or wrong
    assert.equal(a.real.same + a.real.different + a.real.review + a.real.missing, a.real.pairs);
    assert.equal(a.real.correctMerges + a.real.missedMerges, a.real.same);
  } finally {
    globalThis.fetch = before;
  }
});

test('grouping evaluation, Step 1: fewer false merges than the grouping before it, on the same data', async () => {
  const old = numbers(evaluate({ cluster: await loadBefore(), time: false }));
  const now = numbers(evaluate({ time: false }));
  // The frozen copy freezes the word grouping only (src/cluster.js); the card merge is always the current one. Before
  // Step 2 this gave 33 correct merges; Step 2's Hebrew-led merge adds one to it (34). Under the editor's decisions.
  // With the 19 Step 2 review pairs (7 same, 12 different) added: 71 + 3 false, 34 + 7 correct.
  assert.deepEqual([old.real.falseMerges, old.real.correctMerges, old.shape.biggest[0]], [74, 41, 721]);
  assert.ok(now.real.falseMerges < old.real.falseMerges / 3, `false merges ${old.real.falseMerges} → ${now.real.falseMerges}`);
  assert.ok(now.real.crossPhaseTogether < old.real.crossPhaseTogether / 3, 'two phases of one match in one story');
  // on the pairs an editor decided, and apart from the ones nobody reviewed
  assert.ok(now.editorApproved.falseMerges < old.editorApproved.falseMerges / 3, `editor-approved false merges ${old.editorApproved.falseMerges} → ${now.editorApproved.falseMerges}`);
  assert.ok(now.unreviewed.falseMerges < old.unreviewed.falseMerges / 2, `unreviewed false merges ${old.unreviewed.falseMerges} → ${now.unreviewed.falseMerges}`);
  assert.ok(now.editorApproved.relatedSeparateTogether < old.editorApproved.relatedSeparateTogether / 3, 'related stories merged');
  assert.ok(now.synthetic.falseMerges < old.synthetic.falseMerges);
  assert.equal(now.synthetic.missedMerges, 0);
  // not at the price of the correct merges: at most 3 of the 33 are lost
  assert.ok(now.real.correctMerges >= old.real.correctMerges - 3, `correct merges ${old.real.correctMerges} → ${now.real.correctMerges}`);
  // the blobs are gone
  assert.ok(now.shape.biggest[0] < old.shape.biggest[0] / 2);
});

test('grouping evaluation: the score counts what it says', () => {
  const items = [1, 2, 3, 4].map((n) => ({ id: `a${n}`, title: n < 3 ? `Riverside United sack coach Molina after five defeats ${n}` : `Tennis final in Shanghai goes to three sets ${n}`, lang: 'en', publisher: `p${n}`, published: 1e12 + n * 60e3, sport: 'football', sportSure: false, ents: [] }));
  const s = scorePairs([
    { id: 'x1', a: 'a1', b: 'a2', policy: 'same' }, // joined: a correct merge
    { id: 'x2', a: 'a1', b: 'a3', policy: 'same' }, // apart: a missed merge
    { id: 'x3', a: 'a3', b: 'a4', policy: 'different' }, // joined: a false merge
    { id: 'x4', a: 'a2', b: 'a4', policy: 'different' }, // apart: right
    { id: 'x5', a: 'a1', b: 'zz', policy: 'same' }, // an article that is not in the data: not counted
    { id: 'x6', a: 'a1', b: 'a2', policy: 'review' }, // for a person to decide: not counted, reported apart
    { id: 'x7', a: 'a3', b: 'a4', policy: 'review', editorDecision: 'SEPARATE_BUT_RELATED' }, // the editor decided it: must not merge
  ], runGrouping(items));
  assert.deepEqual([s.correctMerges, s.missedMerges, s.falseMerges, s.correctlyApart, s.missing], [1, 1, 2, 1, 1]);
  assert.deepEqual([s.review, s.reviewTogether], [1, 1]);
  assert.deepEqual([s.relatedSeparate, s.relatedSeparateTogether, s.editorApproved, s.unverified], [1, 1, 1, 6]);
  assert.equal(s.precision, 33.3);
  assert.equal(s.recall, 50);
});

test('r289: the Griezmann goal clip and the later Ojeda quote stay two stories (the editor ruled: separate but related)', () => {
  const p = loadPairs().pairs.find((x) => x.id === 'r289');
  assert.equal(p.editorDecision, 'SEPARATE_BUT_RELATED'); // linked, never merged automatically
  const corpus = loadCorpus();
  const run = runGrouping(corpus.items, corpus.cards);
  assert.notEqual(run.storyOf.get(p.a), run.storyOf.get(p.b));
  // the saved gate records the fix: one false merge fewer than before the patch
  assert.equal(loadBaseline().editorApproved.falseMerges, 8);
});
