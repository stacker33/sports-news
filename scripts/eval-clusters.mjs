// Grouping evaluation: replays the radar's own grouping code (src/cluster.js → src/merge.js → src/storyids.js) on a
// saved set of real articles and scores it against hand-labelled pairs. Nothing is fetched and nothing is written
// to the radar's data: no network, no language model, no state.
//
//   node scripts/eval-clusters.mjs                    the report, compared with the saved baseline
//   node scripts/eval-clusters.mjs --misses           also lists every wrong pair
//   node scripts/eval-clusters.mjs --json             the numbers as JSON
//   node scripts/eval-clusters.mjs --write-baseline   saves the current numbers as the baseline (after a reviewed change)
//   node scripts/eval-clusters.mjs --markdown <file>  writes the report as a Markdown file
//   node scripts/eval-clusters.mjs --review-csv <file>  a sheet of every real pair for an editor to confirm or correct
//
// The data (test/fixtures/cluster-eval/):
//   corpus.json.gz  real articles from the radar's memory of 2026-10-20 (the stories the labelled articles were in)
//                   and the story cards the language model had written by then
//   pairs.json      the labelled pairs (see its "about")
//   synthetic.json  invented cases for situations the real data did not have; scored apart, never mixed in
//   baseline.json   the numbers of the code as it was when the set was made
//
// What a label means (pairs.json):
//   same        both articles report the same happening: they belong in one story
//   different   different happenings, even about the same player / club: they must not share a story
//   same-match  the same match, another phase or angle (preview / live / result / a post-match quote). Whether a
//               match should be ONE story is an editorial rule, so these are counted on their own
//   related     a follow-up of the same affair (a rumour, then the signing). Not scored: either way is defensible

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clusterItems } from '../src/cluster.js';
import { mergeSameEvent, clusterKey } from '../src/merge.js';
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

// The radar's grouping, exactly as src/collect.js calls it. Articles are copied: the grouping code writes on them.
export function runGrouping(items, cards = {}) {
  const base = clusterItems(items.map((i) => ({ ...i })));
  const merged = mergeSameEvent(base, cards);
  const baseOf = new Map(), storyOf = new Map();
  base.forEach((c, i) => c.forEach((m) => baseOf.set(m.id, i)));
  merged.forEach((c, i) => c.forEach((m) => storyOf.set(m.id, i)));
  return { base, merged, baseOf, storyOf };
}

const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);

// pairs: [{ id, a, b, label, group, by, editor }]. A pair whose article is not in the data is "missing", never a miss.
export function scorePairs(pairs, run) {
  const rows = pairs.map((p) => {
    const present = run.storyOf.has(p.a) && run.storyOf.has(p.b);
    const together = present && run.storyOf.get(p.a) === run.storyOf.get(p.b);
    // where they were joined: by the word grouping, or only by the language-model card merge
    const stage = !together ? null : run.baseOf.get(p.a) === run.baseOf.get(p.b) ? 'words' : 'cards';
    return { ...p, present, together, stage };
  });
  const of = (label, f = () => true) => rows.filter((r) => r.present && r.label === label && f(r));
  const same = of('same'), diff = of('different'), match = of('same-match'), rel = of('related');
  const tp = same.filter((r) => r.together), fn = same.filter((r) => !r.together);
  const fp = diff.filter((r) => r.together), tn = diff.filter((r) => !r.together);
  const matchTogether = match.filter((r) => r.together);
  const byGroup = {};
  for (const r of rows.filter((x) => x.present)) {
    const g = (byGroup[r.group] ||= { same: 0, found: 0, different: 0, falseMerges: 0, sameMatch: 0, sameMatchTogether: 0, related: 0, relatedTogether: 0 });
    if (r.label === 'same') { g.same++; if (r.together) g.found++; }
    if (r.label === 'different') { g.different++; if (r.together) g.falseMerges++; }
    if (r.label === 'same-match') { g.sameMatch++; if (r.together) g.sameMatchTogether++; }
    if (r.label === 'related') { g.related++; if (r.together) g.relatedTogether++; }
  }
  return {
    rows,
    pairs: rows.length,
    missing: rows.filter((r) => !r.present).length,
    same: same.length,
    different: diff.length,
    correctMerges: tp.length,
    missedMerges: fn.length,
    falseMerges: fp.length,
    correctlyApart: tn.length,
    // of the labelled pairs the radar put in one story, how many belong together
    precision: pct(tp.length, tp.length + fp.length),
    // of the pairs that belong together, how many the radar put in one story
    recall: pct(tp.length, same.length),
    mergedByWords: tp.filter((r) => r.stage === 'words').length,
    mergedByCards: tp.filter((r) => r.stage === 'cards').length,
    sameMatch: match.length,
    sameMatchTogether: matchTogether.length,
    related: rel.length,
    relatedTogether: rel.filter((r) => r.together).length,
    // if a match is one story (the rule src/cluster.js follows today): same-match pairs count as "same"
    matchIsOneStory: {
      precision: pct(tp.length + matchTogether.length, tp.length + matchTogether.length + fp.length),
      recall: pct(tp.length + matchTogether.length, same.length + match.length),
    },
    editorConfirmed: rows.filter((r) => r.editor === 'confirmed').length,
    byGroup,
  };
}

// Stories over time: the grouping is run again at each step, as the radar does every few minutes, with only the
// articles and cards it had by then, and the story ids are carried over (src/storyids.js).
//   moved       articles that were in the last step and now have another story id
//   lostStories stories of 2+ articles whose id is gone although most of their articles are still there: what was
//               saved under that id (a vote, "I'm on it", "seen") no longer finds its story
//   looksNew    stories with a new id made mostly of articles the radar already had: they can look new again
//               ("new since your visit"; Telegram has its own same-event check, so this is a risk, not a count of
//               repeated posts)
export function replayOverTime(corpus, { stepHours = 3, steps = 12 } = {}) {
  const end = corpus.savedAt;
  let prev = {}, prevIds = null, prevSize = new Map();
  const out = [];
  for (let k = steps - 1; k >= 0; k--) {
    const t = end - k * stepHours * 3600e3;
    const items = corpus.items.filter((i) => i.seen <= t && t - i.published <= 48 * 3600e3);
    const cards = Object.fromEntries(Object.entries(corpus.cards).filter(([, c]) => c.at <= t));
    const { merged } = runGrouping(items, cards);
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
      row.looksNew = merged.filter((c, i) => c.length >= 2 && !prevIds.has(ids[i]) && c.filter((m) => prev[m.id]).length >= c.length / 2).length;
    }
    out.push(row);
    prev = map;
    prevIds = new Set(ids);
    prevSize = new Map();
    for (const id of Object.values(map)) prevSize.set(id, (prevSize.get(id) || 0) + 1);
  }
  const sum = (f) => out.reduce((n, r) => n + (r[f] || 0), 0);
  return { stepHours, steps: out, moved: sum('moved'), kept: sum('kept'), movedPct: pct(sum('moved'), sum('kept')), lostStories: sum('lostStories'), looksNew: sum('looksNew') };
}

// Shape of the stories: how big they get (one very big story usually means several happenings in one)
export function shape(run) {
  const sizes = run.merged.map((c) => c.length).sort((a, b) => b - a);
  const outlets = (c) => new Set(c.map((m) => String(m.publisher || '').toLowerCase())).size;
  return {
    articles: sizes.reduce((a, b) => a + b, 0),
    stories: sizes.length,
    singleArticle: sizes.filter((n) => n === 1).length,
    biggest: sizes.slice(0, 5),
    over100Articles: sizes.filter((n) => n > 100).length,
    over50Outlets: run.merged.filter((c) => outlets(c) > 50).length,
    joinedByCards: run.base.length - run.merged.length,
  };
}

export function evaluate({ dir = DIR } = {}) {
  const corpus = loadCorpus(dir);
  const { pairs } = loadPairs(dir);
  const run = runGrouping(corpus.items, corpus.cards);
  const syn = loadSynthetic(dir);
  for (const it of syn.items) it.tr = it.en ? { en: it.en } : null;
  const synRun = runGrouping(syn.items, syn.cards || {});
  return { corpus, run, real: scorePairs(pairs, run), synthetic: scorePairs(syn.pairs, synRun), time: replayOverTime(corpus), shape: shape(run) };
}

// the numbers kept as the baseline (no article text)
export function numbers(e) {
  const pick = ({ rows: _r, ...rest }) => rest;
  return { real: pick(e.real), synthetic: pick(e.synthetic), time: { ...e.time, steps: undefined }, shape: e.shape };
}

// A change must not put more "different" pairs in one story, and must not lose correct merges
export function regressions(now, base) {
  const out = [];
  if (!base) return out;
  if (now.real.falseMerges > base.real.falseMerges) out.push(`false merges ${base.real.falseMerges} → ${now.real.falseMerges}`);
  if (now.real.correctMerges < base.real.correctMerges) out.push(`correct merges ${base.real.correctMerges} → ${now.real.correctMerges}`);
  if (now.synthetic.falseMerges > base.synthetic.falseMerges) out.push(`synthetic false merges ${base.synthetic.falseMerges} → ${now.synthetic.falseMerges}`);
  return out;
}

const textOf = (corpus) => {
  const by = new Map(corpus.items.map((i) => [i.id, i]));
  return (id) => { const i = by.get(id); return i ? `[${i.lang}] ${i.publisher}: ${(i.lang === 'en' || i.lang === 'he' ? i.title : i.en || i.title).slice(0, 110)}` : id; };
};

export function report(e, base, { misses = false } = {}) {
  const r = e.real, s = e.synthetic, t = e.time, sh = e.shape;
  const d = (now, was) => (base && was !== undefined && was !== now ? ` (baseline ${was})` : '');
  const b = base?.real || {};
  const L = [];
  L.push(`Real pairs: ${r.pairs} labelled (${r.same} same, ${r.different} different, ${r.sameMatch} same-match, ${r.related} related; ${r.missing} not in the data)`);
  L.push(`  labels confirmed by an editor: ${r.editorConfirmed} of ${r.pairs}`);
  L.push(`  precision  ${r.precision}%${d(r.precision, b.precision)}   of the labelled pairs the radar joined, the share that belong together`);
  L.push(`  recall     ${r.recall}%${d(r.recall, b.recall)}   of the pairs that belong together, the share the radar joined`);
  L.push(`  false merges   ${r.falseMerges} of ${r.different}${d(r.falseMerges, b.falseMerges)}`);
  L.push(`  missed merges  ${r.missedMerges} of ${r.same}${d(r.missedMerges, b.missedMerges)}`);
  L.push(`  correct merges ${r.correctMerges}: ${r.mergedByWords} by the word grouping, ${r.mergedByCards} by the card merge`);
  L.push(`  same match, another phase: ${r.sameMatchTogether} of ${r.sameMatch} in one story; follow-ups: ${r.relatedTogether} of ${r.related} in one story (not scored)`);
  L.push(`  if a match is one story: precision ${r.matchIsOneStory.precision}%, recall ${r.matchIsOneStory.recall}%`);
  L.push('By group:');
  for (const [g, x] of Object.entries(r.byGroup)) L.push(`  ${g.padEnd(26)} same ${x.found}/${x.same} joined · different ${x.falseMerges}/${x.different} wrongly joined · same-match ${x.sameMatchTogether}/${x.sameMatch} · related ${x.relatedTogether}/${x.related}`);
  L.push(`Synthetic pairs (invented, scored apart): ${s.pairs} · false merges ${s.falseMerges} of ${s.different} · missed merges ${s.missedMerges} of ${s.same}`);
  L.push(`Stories: ${sh.articles} articles → ${sh.stories} stories (${sh.singleArticle} of one article; ${sh.joinedByCards} joins by the card merge); biggest ${sh.biggest.join(', ')}; over 100 articles: ${sh.over100Articles}; over 50 outlets: ${sh.over50Outlets}`);
  L.push(`Over time (${t.steps.length} steps of ${t.stepHours}h): ${t.moved} of ${t.kept} articles changed story id (${t.movedPct}%) · ${t.lostStories} stories lost their id · ${t.looksNew} stories look new again`);
  const reg = regressions(numbers(e), base);
  L.push(base ? (reg.length ? `WORSE THAN THE BASELINE: ${reg.join('; ')}` : 'Not worse than the baseline.') : 'No baseline saved yet.');
  if (misses) {
    const txt = textOf(e.corpus);
    for (const [title, f] of [['FALSE MERGES (different, in one story)', (x) => x.label === 'different' && x.together], ['MISSED MERGES (same, in separate stories)', (x) => x.label === 'same' && x.present && !x.together]]) {
      L.push('', title);
      for (const x of r.rows.filter(f)) L.push(`  ${x.id} ${x.group}${x.note ? ` (${x.note})` : ''}\n     ${txt(x.a)}\n     ${txt(x.b)}`);
    }
  }
  return L.join('\n');
}

// A sheet an editor can open in Excel: both headlines of every real pair, the label, and an empty column to
// confirm or correct it (UTF-8 with a byte-order mark, so Hebrew shows right)
export function reviewCsv(e) {
  const by = new Map(e.corpus.items.map((i) => [i.id, i]));
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = (id) => { const i = by.get(id); return `[${i.lang}] ${i.publisher}: ${i.title}${i.en && i.lang !== 'en' ? ` (${i.en})` : ''}`; };
  const rows = e.real.rows.map((r) => [r.id, r.group, r.together ? 'one story' : 'separate', r.label, r.note || '', head(r.a), head(r.b), ''].map(q).join(','));
  const NL = '\r\n'; // Excel line ends
  return '\uFEFF' + 'pair,group,radar today,label (assistant),note,article A,article B,editor: confirm / correct to' + NL + rows.join(NL) + NL;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (f) => process.argv.includes(f);
  const e = evaluate();
  const base = loadBaseline();
  if (arg('--write-baseline')) {
    writeFileSync(join(DIR, 'baseline.json'), JSON.stringify({ savedFor: 'the grouping code as it was when this was written', ...numbers(e) }, null, 2) + '\n');
    console.log('baseline saved');
  } else if (arg('--json')) console.log(JSON.stringify(numbers(e), null, 2));
  else if (arg('--review-csv')) {
    const out = process.argv[process.argv.indexOf('--review-csv') + 1];
    writeFileSync(out, reviewCsv(e));
    console.log(`review sheet written: ${out}`);
  }
  else {
    const text = report(e, base, { misses: arg('--misses') });
    const i = process.argv.indexOf('--markdown');
    if (i > 0 && process.argv[i + 1]) writeFileSync(process.argv[i + 1], '```\n' + text + '\n```\n');
    console.log(text);
  }
}
