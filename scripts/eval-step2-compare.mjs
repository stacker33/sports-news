// Step 2 before / after: the merge as it was before Step 2 (a frozen copy) against src/merge.js, on the same word
// groups and the same labelled pairs. No network, no language model, nothing written.
//
//   node scripts/eval-step2-compare.mjs                       the labelled pairs (the hard-case set)
//   SR_MEMORY=<state.json> node scripts/eval-step2-compare.mjs   also a full-memory replay of a saved radar state:
//                                                             extra joins, split stories, story-id changes, time
//
// The full memory is not in the repository (it is the radar's own saved state, tens of megabytes).

import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { clusterItems } from '../src/cluster.js';
import { assignStoryIds } from '../src/storyids.js';
import { isStreamSpam } from '../src/classify.js';
import * as NEW from '../src/merge.js';
import { loadCorpus, loadPairs, loadSynthetic, scorePairs } from './eval-clusters.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLD = await import(pathToFileURL(join(ROOT, 'test', 'fixtures', 'cluster-eval', 'before-step2', 'merge.js')).href);
const corpus = loadCorpus(); const { pairs } = loadPairs(); const syn = loadSynthetic();
for (const it of syn.items) it.tr = it.en ? { en: it.en } : null;

const mk = (M, items, cards) => {
  const base = clusterItems(items.map((i) => ({ ...i }))); const merged = M.mergeSameEvent(base, cards);
  const storyOf = new Map(), baseOf = new Map();
  merged.forEach((c, i) => c.forEach((m) => storyOf.set(m.id, i))); base.forEach((c, i) => c.forEach((m) => baseOf.set(m.id, i)));
  return { base, merged, storyOf, baseOf };
};
const line = (x) => `precision ${x.precision}% recall ${x.recall}% | correct merges ${x.correctMerges} of ${x.same} | false merges ${x.falseMerges} of ${x.different} | related merged ${x.relatedSeparateTogether}`;
export function compareSets() {
  const A = mk(OLD, corpus.items, corpus.cards), B = mk(NEW, corpus.items, corpus.cards);
  const sets = {
    'all pairs': pairs,
    'the 264 pairs of Steps 0 and 1': pairs.filter((p) => p.group !== 'step2-review'),
    'editor-approved (95)': pairs.filter((p) => p.editorDecision),
    'unreviewed, original (169, unverified)': pairs.filter((p) => p.group !== 'step2-review' && !p.editorDecision),
    'Step 2 review pairs (19, unverified)': pairs.filter((p) => p.group === 'step2-review'),
  };
  const out = [];
  for (const [n, p] of Object.entries(sets)) out.push({ n, before: scorePairs(p, A), after: scorePairs(p, B) });
  const sa = scorePairs(syn.pairs, mk(OLD, syn.items, syn.cards || {})), sb = scorePairs(syn.pairs, mk(NEW, syn.items, syn.cards || {}));
  const inB = new Map(); B.merged.forEach((c, i) => c.forEach((m) => inB.set(m.id, i)));
  const split = A.merged.filter((c) => new Set(c.map((m) => inB.get(m.id))).size > 1).length;
  return { out, synthetic: { before: sa, after: sb }, stories: [A.merged.length, B.merged.length], split };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = compareSets();
  for (const x of r.out) console.log(`${x.n}\n   before ${line(x.before)}\n   after  ${line(x.after)}`);
  console.log(`synthetic (24): false merges ${r.synthetic.before.falseMerges} → ${r.synthetic.after.falseMerges}, missed merges ${r.synthetic.before.missedMerges} → ${r.synthetic.after.missedMerges}`);
  console.log(`stories on the set: ${r.stories[0]} → ${r.stories[1]}; stories of the old merge split by the new one: ${r.split} (must be 0: Step 2 only adds)`);
  const mem = process.env.SR_MEMORY;
  if (mem && existsSync(mem)) {
    const st = JSON.parse(readFileSync(mem, 'utf8'));
    const items = st.items.filter((i) => !i.hidden && !isStreamSpam(i.title)).map((i) => ({ ...i, tr: st.tr?.[i.id] || null }));
    const desk = st.ai?.desk || {};
    const base = clusterItems(items.map((i) => ({ ...i })));
    let t0 = Date.now(); const FA = OLD.mergeSameEvent(base, desk); const msA = Date.now() - t0;
    t0 = Date.now(); const FB = NEW.mergeSameEvent(base, desk); const msB = Date.now() - t0;
    const inA = new Map(); FA.forEach((c, i) => c.forEach((m) => inA.set(m.id, i)));
    const inB = new Map(); FB.forEach((c, i) => c.forEach((m) => inB.set(m.id, i)));
    const split = FA.filter((c) => new Set(c.map((m) => inB.get(m.id))).size > 1).length;
    const joins = FB.filter((c) => new Set(c.map((m) => inA.get(m.id))).size > 1).length;
    console.log(`\nfull memory (${items.length} articles): ${FA.length} → ${FB.length} stories | extra joins ${joins} | old stories split ${split} | merge step ${msA} → ${msB} ms`);
    const prev = st.storyIds || {};
    const sw = (M) => { const { ids, map } = assignStoryIds(M, prev); const kept = items.filter((i) => prev[i.id]); const moved = kept.filter((i) => map[i.id] !== prev[i.id]).length; const sizes = new Map(); for (const i of kept) sizes.set(prev[i.id], (sizes.get(prev[i.id]) || 0) + 1); const now = new Set(ids); return { articlesChangingIdPct: Math.round((1000 * moved) / kept.length) / 10, storiesLosingTheirId: [...sizes].filter(([id, n]) => n >= 2 && !now.has(id)).length }; };
    console.log('story ids if the baseline merge ran now:', JSON.stringify(sw(FA)), '| with Step 2:', JSON.stringify(sw(FB)));
  }
}
