// applySignals with the per-run headline token cache must return exactly what the uncached function returned.
// `reference` is the function as it was before the change (frozen here); the real one is imported from src/collect.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokens } from '../src/cluster.js';
import { applySignals, signalTokenizer } from '../src/collect.js';

const GENERIC = new Set(['football', 'soccer', 'nba', 'basketball', 'live', 'score', 'scores', 'game', 'match', 'today', 'news', 'tv', 'israel', 'ישראל', 'weather', 'מזג אוויר']);
const overlap = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };
function reference(s, signals) {
  const text = ' ' + [s.t?.en?.title, s.title, s.t?.he?.title].filter(Boolean).join(' ').toLowerCase() + ' ';
  const tok = tokens(s.t?.en?.title || s.title);
  let boost = 1 + 0.2 * Math.max(0, s.langs.length - 1);
  let trending = null;
  for (const tr of signals.trends || []) {
    if (GENERIC.has(tr.term) || (!tr.term.includes(' ') && tr.term.length < 7)) continue;
    const inText = text.includes(' ' + tr.term + ' ') || text.includes(' ' + tr.term);
    const viaNews = !inText && tr.news.some((h) => overlap(tokens(h), tok) >= 4);
    if ((inText || viaNews) && (!trending || tr.traffic > trending.traffic)) trending = { term: tr.term, traffic: tr.traffic, geo: tr.geo };
  }
  if (trending) boost *= 1 + Math.min(0.6, Math.log10(Math.max(trending.traffic, 10)) / 8);
  let reddit = null;
  for (const r of signals.reddit || []) {
    const t2 = tokens(r.title);
    const shared = overlap(t2, tok);
    if (shared >= 3 && shared / Math.min(t2.size, tok.size) >= 0.5 && (!reddit || r.rank < reddit.rank)) reddit = { rank: r.rank, sub: r.sub };
  }
  if (reddit) boost *= 1 + (31 - reddit.rank) / 60;
  let wikipedia = null;
  for (const w of signals.wiki?.top || []) {
    const title = w.title.toLowerCase().replace(/ \(.*\)$/, '');
    if (text.includes(title) && (!wikipedia || w.views > wikipedia.views)) wikipedia = { title: w.title, wiki: w.wiki, views: w.views, ratio: w.prev ? Math.round((w.views / w.prev) * 10) / 10 : null };
  }
  for (const name of s.athletes) {
    const a = signals.wiki?.athletes?.[name];
    if (a && a.ratio >= 3 && (!wikipedia || a.views > wikipedia.views)) wikipedia = { title: name, wiki: 'en+he', views: a.views, ratio: a.ratio };
  }
  if (wikipedia) boost *= 1 + Math.min(0.5, Math.log10(Math.max(wikipedia.views, 10)) / 12) * ((wikipedia.ratio || 1) >= 2 ? 1.3 : 1);
  const r2 = (x) => Math.round(x * 100) / 100;
  return { ...s, trending, reddit, wikipedia, score: r2(s.score * boost), pop: r2(s.pop * boost) };
}

const story = (title, extra = {}) => ({ title, langs: ['en'], athletes: [], score: 3, pop: 2, ...extra });
const STORIES = [
  story('Real Madrid beat Arsenal in the Champions League final', { langs: ['en', 'es', 'he'] }),
  story('Maccabi Tel Aviv sign striker from Ajax', { t: { en: { title: 'Maccabi Tel Aviv sign striker from Ajax' }, he: { title: 'מכבי תל אביב חותמת על חלוץ' } } }),
  story('Messi scores twice as Inter Miami win again', { athletes: ['Lionel Messi'] }),
  story('Unrelated cricket news'),
  story('Real Madrid beat Arsenal in the Champions League final'), // same text as story 0
  story(''),
];
const SIGNALS = {
  trends: [
    { term: 'champions league final', traffic: 200000, geo: 'IL', news: ['Real Madrid beat Arsenal in the Champions League final', 'Real Madrid beat Arsenal in the Champions League final'] }, // duplicate headline
    { term: 'maccabi tel aviv', traffic: 50000, geo: 'IL', news: ['Maccabi Tel Aviv sign striker from Ajax Amsterdam'] },
    { term: 'israel', traffic: 900000, geo: 'IL', news: ['x'] }, // generic: skipped
    { term: 'inter miami', traffic: 80000, geo: 'US', news: [] },
  ],
  reddit: [
    { title: 'Real Madrid beat Arsenal in the final', rank: 3, sub: 'soccer' },
    { title: 'Real Madrid beat Arsenal in the final', rank: 1, sub: 'soccer' }, // duplicate title, better rank
    { title: 'Messi scores twice as Inter Miami win again', rank: 7, sub: 'MLS' },
  ],
  wiki: { top: [{ title: 'Lionel Messi', wiki: 'en', views: 900000, prev: 300000 }], athletes: { 'Lionel Messi': { views: 500000, ratio: 4 } } },
};

const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
const runAll = (signals, fn) => STORIES.map((s) => fn(s, signals));

test('cached and uncached output is byte-identical; many stories share the same signals', () => {
  const want = runAll(SIGNALS, reference);
  const tk = signalTokenizer();
  same(runAll(SIGNALS, (s, g) => applySignals(s, g, tk)), want);
  same(runAll(SIGNALS, (s, g) => applySignals(s, g, tk)), want); // a second pass through the warm cache
  same(runAll(SIGNALS, (s, g) => applySignals(s, g)), want); // the default (no cache) is the old behaviour
  assert.ok(want[0].trending && want[0].reddit, 'the matching story is boosted');
  assert.equal(want[0].reddit.rank, 1, 'duplicate Reddit titles: the better rank wins as before');
  assert.equal(want[3].trending, null);
});

test('the cache holds one entry per distinct headline (duplicates share a result)', () => {
  const tk = signalTokenizer();
  assert.equal(tk('Real Madrid beat Arsenal'), tk('Real Madrid beat Arsenal'));
  assert.notEqual(tk('Real Madrid beat Arsenal'), tk('Real Madrid beat Ajax'));
  same([...tk('Real Madrid beat Arsenal')], [...tokens('Real Madrid beat Arsenal')]);
});

test('empty and malformed signals behave as before', () => {
  const cases = [{}, { trends: [], reddit: [] }, { trends: null, reddit: null, wiki: null }, { trends: [{ term: 'champions league final', traffic: 1, geo: 'x', news: [] }] }, { reddit: [{ title: '', rank: 1, sub: 's' }] }, { trends: [{ term: 'champions league final', traffic: 5, news: ['', '   ', '!!!'] }] }];
  for (const sig of cases) {
    const tk = signalTokenizer();
    same(runAll(sig, (s, g) => applySignals(s, g, tk)), runAll(sig, reference));
  }
});

test('malformed entries throw exactly where the old code threw', () => {
  const bad = { trends: [{ term: 'champions league final', traffic: 1 }] }; // no news array: old code threw when the term was not in the text
  const s = story('Something else entirely');
  assert.throws(() => reference(s, bad), TypeError);
  assert.throws(() => applySignals(s, bad, signalTokenizer()), TypeError);
  const inText = story('Champions league final tonight');
  same(applySignals(inText, bad, signalTokenizer()), reference(inText, bad)); // term in the text: news never read, no throw
});

test('consecutive runs with different signals: no stale tokens (one cache per run)', () => {
  const runA = SIGNALS;
  const runB = { ...SIGNALS, trends: [{ term: 'ajax amsterdam transfer', traffic: 1e6, geo: 'NL', news: ['Maccabi Tel Aviv sign striker from Ajax'] }], reddit: [{ title: 'Cricket scores today', rank: 2, sub: 'cricket' }] };
  const wantA = runAll(runA, reference), wantB = runAll(runB, reference);
  const tkA = signalTokenizer(), tkB = signalTokenizer(); // the collector makes a new one every run
  same(runAll(runA, (s, g) => applySignals(s, g, tkA)), wantA);
  same(runAll(runB, (s, g) => applySignals(s, g, tkB)), wantB);
  assert.notDeepEqual(wantA.map((x) => x.score), wantB.map((x) => x.score), 'the two runs really differ');
  // even a cache that was kept by mistake cannot return a wrong result: it is keyed by the headline text, and a changed headline is a new key
  const shared = signalTokenizer();
  same(runAll(runA, (s, g) => applySignals(s, g, shared)), wantA);
  same(runAll(runB, (s, g) => applySignals(s, g, shared)), wantB);
  same(runAll(runA, (s, g) => applySignals(s, g, shared)), wantA);
});

test('the cache is created per run in collect(), not at module level', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/collect.js', import.meta.url), 'utf8');
  const decl = src.indexOf('const sigTokens = signalTokenizer()');
  assert.ok(decl > src.indexOf('export async function collect('), 'declared inside collect()');
  assert.equal(src.split('signalTokenizer()').length - 1, 2, 'the definition and exactly one call site');
});
