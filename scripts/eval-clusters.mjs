// Grouping evaluation: replays the radar's own grouping code (src/cluster.js → src/merge.js → src/storyids.js) on a
// saved set of real articles and scores it against hand-labelled pairs. Nothing is fetched and nothing is written
// to the radar's data: no network, no language model, no state.
//
//   node scripts/eval-clusters.mjs                    the report, compared with the saved baseline
//   node scripts/eval-clusters.mjs --misses           also lists every wrong pair
//   node scripts/eval-clusters.mjs --compare          before (the frozen pre-Step-1 grouping) against now, pair by pair
//   node scripts/eval-clusters.mjs --json             the numbers as JSON
//   node scripts/eval-clusters.mjs --write-baseline   saves the current numbers as the baseline (after a reviewed change)
//   node scripts/eval-clusters.mjs --markdown <file>  writes the report as a Markdown file
//   node scripts/eval-clusters.mjs --review-csv <file>  a sheet of every real pair for an editor to confirm or correct
//
// The data (test/fixtures/cluster-eval/):
//   corpus.json.gz        real articles from the radar's memory of 2026-10-20 (the stories the labelled articles
//                         were in) and the story cards the language model had written by then
//   pairs.json            the labelled pairs (see its "about")
//   synthetic.json        invented cases for situations the real data did not have; scored apart, never mixed in
//   baseline.json         the numbers of the current grouping code, under the editor-approved rules: the gate
//   baseline-step0.json   history: the numbers of Step 0 (the first labels, the code before Step 1)
//   before-step1/         a frozen copy of the grouping code before Step 1, for before / after replays
//
// Labels. "policy" is what the scores use: the label under the clustering rules a Sport5 editor approved
// (docs/cluster-eval-baseline.md):
//   same        one story: the same happening, or more facts about the same ongoing event
//   different   separate stories: another happening, another phase of the match (before / live / after), or a
//               significant new development (they can still be related: see "relation")
//   review      the headlines are not enough to decide. Never counted as right or wrong.
// "label" is the first reading of Step 0 (same | different | same-match | related), kept for the record.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clusterItems } from '../src/cluster.js';
import { mergeSameEvent } from '../src/merge.js';
import { assignStoryIds } from '../src/storyids.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DIR = join(ROOT, 'test', 'fixtures', 'cluster-eval');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export function loadCorpus(dir = DIR) {
  const c = JSON.parse(gunzipSync(readFileSync(join(dir, 'corpus.json.gz'))).toString('utf8'));
  // the grouping code reads the English text from item.tr.en
  for (const it of c.items) it.tr = it.en ? { en: it.en } : null;
  return c;
}
export const loadPairs = (dir = DIR) => readJson(join(dir, 'pairs.json'));
export const loadSynthetic = (dir = DIR) => readJson(join(dir, 'synthetic.json'));
export const loadBaseline = (dir = DIR) => (existsSync(join(dir, 'baseline.json')) ? readJson(join(dir, 'baseline.json')) : null);
// the grouping code as it was before Step 1 (a frozen copy)
export const loadBefore = async (dir = DIR) => (await import(pathToFileURL(join(dir, 'before-step1', 'cluster.js')).href)).clusterItems;

// The radar's grouping, exactly as src/collect.js calls it. Articles are copied: the grouping code writes on them.
// cluster: the word-grouping function to use (the current one, or the frozen one for a before / after replay)
export function runGrouping(items, cards = {}, cluster = clusterItems) {
  const base = cluster(items.map((i) => ({ ...i })));
  const merged = mergeSameEvent(base, cards);
  const baseOf = new Map(), storyOf = new Map();
  base.forEach((c, i) => c.forEach((m) => baseOf.set(m.id, i)));
  merged.forEach((c, i) => c.forEach((m) => storyOf.set(m.id, i)));
  return { base, merged, baseOf, storyOf };
}

const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);

// pairs: [{ id, a, b, label, policy, relation, phaseA, phaseB, group, editor }]. field: 'policy' (the approved
// rules) or 'label' (the first reading). A pair whose article is not in the data is "missing", never a miss.
export function scorePairs(pairs, run, { field = 'policy' } = {}) {
  const rows = pairs.map((p) => {
    const present = run.storyOf.has(p.a) && run.storyOf.has(p.b);
    const together = present && run.storyOf.get(p.a) === run.storyOf.get(p.b);
    // where they were joined: by the word grouping, or only by the language-model card merge
    const stage = !together ? null : run.baseOf.get(p.a) === run.baseOf.get(p.b) ? 'words' : 'cards';
    return { ...p, want: p[field] ?? p.label, present, together, stage };
  });
  const live = rows.filter((r) => r.present);
  const of = (want) => live.filter((r) => r.want === want);
  const same = of('same'), diff = of('different'), review = of('review');
  const tp = same.filter((r) => r.together), fn = same.filter((r) => !r.together);
  const fp = diff.filter((r) => r.together), tn = diff.filter((r) => !r.together);
  const n = (l, f) => l.filter(f).length;
  // the match rule: two articles about one match in different phases must not share a story
  const phased = live.filter((r) => r.relation === 'same-match' && r.phaseA && r.phaseB && r.phaseA !== 'unknown' && r.phaseB !== 'unknown');
  const crossPhase = phased.filter((r) => r.phaseA !== r.phaseB);
  const followUps = diff.filter((r) => r.relation === 'follow-up');
  const byGroup = {};
  for (const r of live) {
    const g = (byGroup[r.group] ||= { same: 0, found: 0, different: 0, falseMerges: 0, review: 0, reviewTogether: 0 });
    if (r.want === 'same') { g.same++; if (r.together) g.found++; }
    if (r.want === 'different') { g.different++; if (r.together) g.falseMerges++; }
    if (r.want === 'review') { g.review++; if (r.together) g.reviewTogether++; }
  }
  const out = {
    rows,
    pairs: rows.length,
    missing: rows.length - live.length,
    same: same.length,
    different: diff.length,
    correctMerges: tp.length,
    missedMerges: fn.length,
    falseMerges: fp.length,
    correctlyApart: tn.length,
    // of the scored pairs the radar put in one story, how many belong together
    precision: pct(tp.length, tp.length + fp.length),
    // of the pairs that belong together, how many the radar put in one story
    recall: pct(tp.length, same.length),
    mergedByWords: n(tp, (r) => r.stage === 'words'),
    mergedByCards: n(tp, (r) => r.stage === 'cards'),
    falseMergesByWords: n(fp, (r) => r.stage === 'words'),
    falseMergesByCards: n(fp, (r) => r.stage === 'cards'),
    // never scored: what the radar does with the pairs a person still has to decide
    review: review.length,
    reviewTogether: n(review, (r) => r.together),
    // one match, two phases (before / live / after): how many the radar still puts in one story
    crossPhase: crossPhase.length,
    crossPhaseTogether: n(crossPhase, (r) => r.together),
    samePhase: phased.length - crossPhase.length,
    // a separate, related story (a signing after the talks, a reaction to a quote) joined to the first one
    followUps: followUps.length,
    followUpsTogether: n(followUps, (r) => r.together),
    editorConfirmed: n(rows, (r) => r.editor === 'confirmed'),
    byGroup,
  };
  // the first reading's extra kinds (same-match, related), for the Step 0 history
  if (field === 'label') {
    const m = of('same-match'), rel = of('related');
    Object.assign(out, { sameMatch: m.length, sameMatchTogether: n(m, (r) => r.together), related: rel.length, relatedTogether: n(rel, (r) => r.together) });
  }
  return out;
}

// Stories over time: the grouping is run again at each step, as the radar does every few minutes, with only the
// articles and cards it had by then, and the story ids are carried over (src/storyids.js).
//   moved       articles that were in the last step and now have another story id
//   lostStories stories of 2+ articles whose id is gone although most of their articles are still there: what was
//               saved under that id (a vote, "I'm on it", "seen") no longer finds its story
//   looksNew    stories with a new id made mostly of articles the radar already had: they can look new again
//               ("new since your visit"; Telegram has its own same-event check, so this is a risk, not a count of
//               repeated posts)
// startIds: story ids to start from (article id → story id), e.g. the ids another grouping gave at that moment:
// the first step then shows what switching to this grouping does to stories that already exist.
export function replayOverTime(corpus, { stepHours = 3, steps = 12, cluster = clusterItems, startIds = null } = {}) {
  const end = corpus.savedAt;
  let prev = startIds || {}, prevIds = startIds ? new Set(Object.values(startIds)) : null, prevSize = new Map();
  if (startIds) for (const id of Object.values(startIds)) prevSize.set(id, (prevSize.get(id) || 0) + 1);
  const out = [];
  let last = null;
  for (let k = steps - 1; k >= 0; k--) {
    const t = end - k * stepHours * 3600e3;
    const items = corpus.items.filter((i) => i.seen <= t && t - i.published <= 48 * 3600e3);
    const cards = Object.fromEntries(Object.entries(corpus.cards).filter(([, c]) => c.at <= t));
    const { merged } = runGrouping(items, cards, cluster);
    const { ids, map } = assignStoryIds(merged, prev);
    const row = { at: t, articles: items.length, stories: merged.length };
    if (prevIds) {
      const kept = items.filter((i) => prev[i.id]);
      row.moved = kept.filter((i) => map[i.id] !== prev[i.id]).length;
      row.kept = kept.length;
      const now = new Set(ids);
      const still = new Map(); // old story id → how many of its articles are still in the data
      for (const i of kept) still.set(prev[i.id], (still.get(prev[i.id]) || 0) + 1);
      row.lostStories = [...prevSize].filter(([id, n]) => n >= 2 && !now.has(id) && (still.get(id) || 0) >= n / 2).length;
      const again = merged.filter((c, i) => c.length >= 2 && !prevIds.has(ids[i]) && c.filter((m) => prev[m.id]).length >= c.length / 2);
      row.looksNew = again.length;
      // of those, the ones young enough for the Telegram channel (their first article is up to 3 hours old)
      row.looksNewFresh = again.filter((c) => t - Math.min(...c.map((m) => m.published)) <= 3 * 3600e3).length;
    }
    out.push(row);
    prev = map;
    prevIds = new Set(ids);
    prevSize = new Map();
    for (const id of Object.values(map)) prevSize.set(id, (prevSize.get(id) || 0) + 1);
    last = map;
  }
  const sum = (f) => out.reduce((n, r) => n + (r[f] || 0), 0);
  return { stepHours, steps: out, moved: sum('moved'), kept: sum('kept'), movedPct: pct(sum('moved'), sum('kept')), lostStories: sum('lostStories'), looksNew: sum('looksNew'), looksNewFresh: sum('looksNewFresh'), ids: last };
}

// Shape of the stories: how big they get, and how long a story keeps taking articles (drift)
export function shape(run) {
  const sizes = run.merged.map((c) => c.length).sort((a, b) => b - a);
  const outlets = (c) => new Set(c.map((m) => String(m.publisher || '').toLowerCase())).size;
  const span = (c) => (Math.max(...c.map((m) => m.published)) - Math.min(...c.map((m) => m.published))) / 3600e3;
  const spans = run.merged.filter((c) => c.length >= 2).map(span).sort((a, b) => b - a);
  return {
    articles: sizes.reduce((a, b) => a + b, 0),
    stories: sizes.length,
    singleArticle: sizes.filter((n) => n === 1).length,
    biggest: sizes.slice(0, 5),
    over100Articles: sizes.filter((n) => n > 100).length,
    over50Outlets: run.merged.filter((c) => outlets(c) > 50).length,
    // hours between a story's first and last article
    longestSpansH: spans.slice(0, 5).map((h) => Math.round(h)),
    over24h: spans.filter((h) => h > 24).length,
    // the word grouping alone (before the card merge): groups that kept taking articles for more than 20 hours
    wordGroupsOver20h: run.base.filter((c) => c.length >= 2 && span(c) > 20.01).length,
    longestWordGroupH: Math.round(Math.max(0, ...run.base.filter((c) => c.length >= 2).map(span))),
    joinedByCards: run.base.length - run.merged.length,
  };
}

export function evaluate({ dir = DIR, cluster = clusterItems, time = true } = {}) {
  const corpus = loadCorpus(dir);
  const { pairs } = loadPairs(dir);
  const t0 = Date.now();
  const run = runGrouping(corpus.items, corpus.cards, cluster);
  const groupingMs = Date.now() - t0;
  const syn = loadSynthetic(dir);
  for (const it of syn.items) it.tr = it.en ? { en: it.en } : null;
  const synRun = runGrouping(syn.items, syn.cards || {}, cluster);
  return {
    corpus, run, groupingMs,
    real: scorePairs(pairs, run),
    firstLabels: scorePairs(pairs, run, { field: 'label' }),
    synthetic: scorePairs(syn.pairs, synRun),
    time: time ? replayOverTime(corpus, { cluster }) : null,
    shape: shape(run),
  };
}

// the numbers kept as the baseline (no article text, nothing that changes between two runs)
export function numbers(e) {
  const pick = ({ rows: _r, ...rest }) => rest;
  return { real: pick(e.real), synthetic: pick(e.synthetic), ...(e.time ? { time: { ...e.time, steps: undefined, ids: undefined } } : {}), shape: e.shape };
}

// A change must not put more "different" pairs in one story, and must not lose correct merges
export function regressions(now, base) {
  const out = [];
  if (!base) return out;
  if (now.real.falseMerges > base.real.falseMerges) out.push(`false merges ${base.real.falseMerges} → ${now.real.falseMerges}`);
  if (now.real.correctMerges < base.real.correctMerges) out.push(`correct merges ${base.real.correctMerges} → ${now.real.correctMerges}`);
  if (now.synthetic.falseMerges > base.synthetic.falseMerges) out.push(`synthetic false merges ${base.synthetic.falseMerges} → ${now.synthetic.falseMerges}`);
  if (now.synthetic.correctMerges < base.synthetic.correctMerges) out.push(`synthetic correct merges ${base.synthetic.correctMerges} → ${now.synthetic.correctMerges}`);
  return out;
}

const textOf = (corpus, extra = []) => {
  const by = new Map([...corpus.items, ...extra].map((i) => [i.id, i]));
  return (id) => { const i = by.get(id); return i ? `[${i.lang}] ${i.publisher}: ${(i.lang === 'en' || i.lang === 'he' ? i.title : i.en || i.title).slice(0, 110)}` : id; };
};

// Before (the frozen grouping) against now, on the same data: every pair whose result changed, the stories' shape,
// what the switch itself does to stories that already exist, and the time the grouping takes
export async function compare({ dir = DIR } = {}) {
  const before = await loadBefore(dir);
  const a = evaluate({ dir, cluster: before }), b = evaluate({ dir });
  const changed = (x, y) => x.rows.map((r, i) => ({ ...r, was: r.together, now: y.rows[i].together })).filter((r) => r.present && r.was !== r.now);
  const real = changed(a.real, b.real), syn = changed(a.synthetic, b.synthetic);
  const kinds = (l) => ({
    fixed: l.filter((r) => r.want === 'different' && r.was && !r.now), // a false merge that is gone
    broken: l.filter((r) => r.want === 'same' && r.was && !r.now), // a correct merge that is lost
    newFalse: l.filter((r) => r.want === 'different' && !r.was && r.now), // a new false merge
    gained: l.filter((r) => r.want === 'same' && !r.was && r.now), // a new correct merge
    review: l.filter((r) => r.want === 'review'),
  });
  // the switch: stories that exist under the old grouping (its ids at the end of the data), then one run of the
  // new grouping on the same articles
  const corpus = a.corpus;
  const oldEnd = replayOverTime(corpus, { cluster: before, steps: 1 }).ids;
  const sw = replayOverTime(corpus, { steps: 1, startIds: oldEnd });
  return { before: a, after: b, real: kinds(real), synthetic: kinds(syn), switch: { moved: sw.moved, kept: sw.kept, movedPct: sw.movedPct, lostStories: sw.lostStories, looksNew: sw.looksNew, looksNewFresh: sw.looksNewFresh } };
}

export function compareReport(c) {
  const a = c.before, b = c.after;
  const row = (name, x, y) => `  ${name.padEnd(56)} ${String(x).padStart(8)} → ${String(y).padStart(8)}`;
  const L = ['BEFORE (frozen pre-Step-1 grouping) → NOW, same data, editor-approved rules'];
  L.push(row('precision %', a.real.precision, b.real.precision));
  L.push(row('recall %', a.real.recall, b.real.recall));
  L.push(row(`false merges (of ${b.real.different} "different")`, a.real.falseMerges, b.real.falseMerges));
  L.push(row(`missed merges (of ${b.real.same} "same")`, a.real.missedMerges, b.real.missedMerges));
  L.push(row('correct merges', a.real.correctMerges, b.real.correctMerges));
  L.push(row(`two phases of one match in one story (of ${b.real.crossPhase})`, a.real.crossPhaseTogether, b.real.crossPhaseTogether));
  L.push(row(`separate follow-ups joined (of ${b.real.followUps})`, a.real.followUpsTogether, b.real.followUpsTogether));
  L.push(row(`"review" pairs in one story (of ${b.real.review}, not scored)`, a.real.reviewTogether, b.real.reviewTogether));
  L.push(row(`synthetic: false merges (of ${b.synthetic.different})`, a.synthetic.falseMerges, b.synthetic.falseMerges));
  L.push(row(`synthetic: missed merges (of ${b.synthetic.same})`, a.synthetic.missedMerges, b.synthetic.missedMerges));
  L.push(row('stories', a.shape.stories, b.shape.stories));
  L.push(row('biggest story (articles)', a.shape.biggest[0], b.shape.biggest[0]));
  L.push(row('stories over 100 articles', a.shape.over100Articles, b.shape.over100Articles));
  L.push(row('stories over 50 outlets', a.shape.over50Outlets, b.shape.over50Outlets));
  L.push(row('stories spanning over 24 hours', a.shape.over24h, b.shape.over24h));
  L.push(row('longest story span (hours)', a.shape.longestSpansH[0], b.shape.longestSpansH[0]));
  L.push(row('word groups that grew for over 20 hours', a.shape.wordGroupsOver20h, b.shape.wordGroupsOver20h));
  L.push(row('longest word group (hours)', a.shape.longestWordGroupH, b.shape.longestWordGroupH));
  L.push(row('over time: articles that changed story id %', a.time.movedPct, b.time.movedPct));
  L.push(row('over time: stories that lost their id', a.time.lostStories, b.time.lostStories));
  L.push(row('over time: stories that look new again', a.time.looksNew, b.time.looksNew));
  L.push(row('  of them young enough for Telegram (under 3h)', a.time.looksNewFresh, b.time.looksNewFresh));
  L.push(row('one grouping run (ms, this machine)', a.groupingMs, b.groupingMs));
  L.push(`The switch itself (old stories, then one run of the new grouping): ${c.switch.moved} of ${c.switch.kept} articles change story id (${c.switch.movedPct}%), ${c.switch.lostStories} stories lose their id, ${c.switch.looksNew} look new (${c.switch.looksNewFresh} of them under 3 hours old).`);
  const txt = textOf(a.corpus, loadSynthetic().items);
  const list = (title, l) => { L.push('', `${title}: ${l.length}`); for (const x of l) L.push(`  ${x.id} ${x.group}${x.policyNote || x.note || x.case ? ` (${x.policyNote || x.note || x.case})` : ''}\n     ${txt(x.a)}\n     ${txt(x.b)}`); };
  list('FALSE MERGES FIXED (different, were in one story, now apart)', c.real.fixed);
  list('NEW FALSE MERGES (different, were apart, now in one story)', c.real.newFalse);
  list('CORRECT MERGES LOST (same, were in one story, now apart)', c.real.broken);
  list('CORRECT MERGES GAINED (same, were apart, now in one story)', c.real.gained);
  list('"REVIEW" PAIRS THAT CHANGED (not scored)', c.real.review);
  list('SYNTHETIC PAIRS THAT CHANGED', [...c.synthetic.fixed, ...c.synthetic.newFalse, ...c.synthetic.broken, ...c.synthetic.gained]);
  return L.join('\n');
}

export function report(e, base, { misses = false } = {}) {
  const r = e.real, s = e.synthetic, t = e.time, sh = e.shape;
  const d = (now, was) => (base && was !== undefined && was !== now ? ` (baseline ${was})` : '');
  const b = base?.real || {};
  const L = [];
  L.push(`Real pairs: ${r.pairs} (${r.same} same, ${r.different} different, ${r.review} need a person; ${r.missing} not in the data)`);
  L.push(`  labels confirmed by an editor: ${r.editorConfirmed} of ${r.pairs} (the rules are editor-approved; the labels are the assistant's)`);
  L.push(`  precision  ${r.precision}%${d(r.precision, b.precision)}   of the scored pairs the radar joined, the share that belong together`);
  L.push(`  recall     ${r.recall}%${d(r.recall, b.recall)}   of the pairs that belong together, the share the radar joined`);
  L.push(`  false merges   ${r.falseMerges} of ${r.different}${d(r.falseMerges, b.falseMerges)} (${r.falseMergesByWords} by the word grouping, ${r.falseMergesByCards} by the card merge)`);
  L.push(`  missed merges  ${r.missedMerges} of ${r.same}${d(r.missedMerges, b.missedMerges)}`);
  L.push(`  correct merges ${r.correctMerges}${d(r.correctMerges, b.correctMerges)}: ${r.mergedByWords} by the word grouping, ${r.mergedByCards} by the card merge`);
  L.push(`  two phases of one match in one story: ${r.crossPhaseTogether} of ${r.crossPhase}; separate follow-ups joined: ${r.followUpsTogether} of ${r.followUps}`);
  L.push(`  not scored: ${r.reviewTogether} of the ${r.review} "review" pairs are in one story`);
  L.push('By group:');
  for (const [g, x] of Object.entries(r.byGroup)) L.push(`  ${g.padEnd(20)} same ${x.found}/${x.same} joined · different ${x.falseMerges}/${x.different} wrongly joined · review ${x.reviewTogether}/${x.review} joined`);
  L.push(`Synthetic pairs (invented, scored apart): ${s.pairs} · false merges ${s.falseMerges} of ${s.different} · missed merges ${s.missedMerges} of ${s.same}`);
  L.push(`Stories: ${sh.articles} articles → ${sh.stories} stories (${sh.singleArticle} of one article; ${sh.joinedByCards} joins by the card merge); biggest ${sh.biggest.join(', ')}; over 100 articles: ${sh.over100Articles}; over 50 outlets: ${sh.over50Outlets}; spanning over 24h: ${sh.over24h} (longest ${sh.longestSpansH[0]}h)`);
  if (t) L.push(`Over time (${t.steps.length} steps of ${t.stepHours}h): ${t.moved} of ${t.kept} articles changed story id (${t.movedPct}%) · ${t.lostStories} stories lost their id · ${t.looksNew} stories look new again`);
  const reg = regressions(numbers(e), base);
  L.push(base ? (reg.length ? `WORSE THAN THE BASELINE: ${reg.join('; ')}` : 'Not worse than the baseline.') : 'No baseline saved yet.');
  if (misses) {
    const txt = textOf(e.corpus);
    for (const [title, f] of [['FALSE MERGES (different, in one story)', (x) => x.want === 'different' && x.together], ['MISSED MERGES (same, in separate stories)', (x) => x.want === 'same' && x.present && !x.together]]) {
      L.push('', title);
      for (const x of r.rows.filter(f)) L.push(`  ${x.id} ${x.group}${x.policyNote || x.note ? ` (${x.policyNote || x.note})` : ''}\n     ${txt(x.a)}\n     ${txt(x.b)}`);
    }
  }
  return L.join('\n');
}

// A sheet an editor can open in Excel: both headlines of every real pair, the label under the approved rules and
// why, and empty columns to confirm or correct it (UTF-8 with a byte-order mark, so Hebrew shows right). The pairs
// that need a person come first.
export function reviewCsv(e) {
  const by = new Map(e.corpus.items.map((i) => [i.id, i]));
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = (id) => { const i = by.get(id); return `[${i.lang}] ${i.publisher}: ${i.title}${i.en && i.lang !== 'en' ? ` (${i.en})` : ''}`; };
  const order = { review: 0, different: 1, same: 2 };
  const changed = (r) => (r.label === r.policy ? 1 : 0);
  const rows = [...e.real.rows]
    .sort((x, y) => order[x.policy] - order[y.policy] || changed(x) - changed(y) || (x.id < y.id ? -1 : 1))
    .map((r) => [
      r.id, r.policy === 'review' ? 'NEEDS YOUR DECISION' : r.policy, r.policyNote || r.note || '', r.relation || '',
      r.phaseA ? `${r.phaseA} / ${r.phaseB}` : '', head(r.a), head(r.b), r.together ? 'one story' : 'separate', r.label, r.group, '', '',
    ].map(q).join(','));
  const NL = '\r\n'; // Excel line ends
  return '﻿' + 'pair,label under the approved rules,why,relation,match phases (A / B),article A,article B,radar today,first label (Step 0),group,EDITOR: same / different,EDITOR: note' + NL + rows.join(NL) + NL;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (f) => process.argv.includes(f);
  const after = (f) => process.argv[process.argv.indexOf(f) + 1];
  if (arg('--compare')) {
    const text = compareReport(await compare());
    if (arg('--markdown')) writeFileSync(after('--markdown'), '```\n' + text + '\n```\n');
    console.log(text);
  } else {
    const e = evaluate();
    const base = loadBaseline();
    if (arg('--write-baseline')) {
      writeFileSync(join(DIR, 'baseline.json'), JSON.stringify({ savedFor: 'the current grouping code, scored under the editor-approved rules (policy)', ...numbers(e) }, null, 2) + '\n');
      console.log('baseline saved');
    } else if (arg('--json')) console.log(JSON.stringify(numbers(e), null, 2));
    else if (arg('--review-csv')) {
      writeFileSync(after('--review-csv'), reviewCsv(e));
      console.log(`review sheet written: ${after('--review-csv')}`);
    } else {
      const text = report(e, base, { misses: arg('--misses') });
      if (arg('--markdown')) writeFileSync(after('--markdown'), '```\n' + text + '\n```\n');
      console.log(text);
    }
  }
}
