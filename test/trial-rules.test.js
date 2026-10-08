// Trial site rules: the editors' keyword list in the ranking, players searched in their club country's language,
// and English headlines translated to Hebrew. Network is mocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { vocabMatchers, loadVocabulary, editorialRank } from '../src/rank.js';
import { athleteSources, normalizeAthlete } from '../src/athletes.js';
import { translateItems } from '../src/translate.js';

const vocab = JSON.parse(readFileSync(new URL('../config/vocabulary.json', import.meta.url), 'utf8'));
const fams = (t) => vocabMatchers(vocab).filter(([, , , , re]) => re.test(t)).map(([k]) => k);

test('the keyword list recognises story types in several languages, without generic words', () => {
  assert.ok(fams('Lemkin breaks silence in exclusive interview').includes('interviews'));
  assert.ok(fams('entrevista con Revivo').includes('interviews'));
  assert.ok(fams('Συνέντευξη Μπλατ').includes('interviews'));
  assert.ok(fams('Bizarre scenes as match abandoned').includes('unusual'));
  assert.ok(fams('Club fined after Palestine flag protest').includes('israel-institutions'));
  assert.deepEqual(fams('Talks continue over the offer'), []); // generic single words are not used
  assert.deepEqual(fams('Arsenal 2-1 Chelsea'), []);
});

test('keyword families raise news value in the editorial rank; leagues not followed stay far down', () => {
  loadVocabulary(new URL('../config/vocabulary.json', import.meta.url));
  const now = Date.now();
  const base = { first: now, pop: 3, ev: { outlets: 2 }, cov: { s5: 'none', checkedAt: now, comp: [] }, _members: [] };
  const odd = editorialRank({ ...base, title: 'Bizarre scenes as match abandoned' }, { now });
  const plain = editorialRank({ ...base, title: 'Arsenal 2-1 Chelsea' }, { now });
  assert.equal(odd.dims.news, 0.75);
  assert.equal(plain.dims.news, 0.4);
  assert.ok(odd.score > plain.score);
  const local = editorialRank({ ...base, title: 'Bizarre scenes as match abandoned', local: true }, { now });
  assert.ok(local.score < odd.score / 2 + 1e-9 && local.limits.some((l) => l.k === 'local'));
  const routine = editorialRank({ ...base, title: 'Arsenal 2-1 Chelsea', routine: true }, { now });
  assert.ok(routine.score < plain.score && routine.limits.some((l) => l.k === 'routine'));
});

test("players are searched by name in their club country's language (local script where needed)", () => {
  const list = [
    { name: 'Stav Lemkin', team: 'Twente', country: 'netherlands', sport: 'football', alt: ['Lemkin'] },
    { name: 'Neta Lavi', team: 'Machida Zelvia', country: 'japan', sport: 'football', local: ['ネタ・ラヴィ'] },
    { name: 'Mahmoud Jaber', team: 'Saint-Etienne', country: 'france', sport: 'football', alt: ['Mahmud Jaber', 'Jaber'] },
    { name: 'Manor Solomon', team: 'West Ham', country: 'england', sport: 'football' },
  ].map(normalizeAthlete);
  const q = (src) => decodeURIComponent(src.url.match(/q=([^&]*)/)[1]);
  const local = athleteSources(list, {}).filter((s) => /^abroad-(?!en-|he-)/.test(s.id));
  const by = Object.fromEntries(local.map((s) => [s.id.split('-')[1], { q: q(s), hl: s.url.match(/hl=([^&]*)/)[1] }]));
  assert.deepEqual(Object.keys(by).sort(), ['fr', 'ja', 'nl']); // England has no extra language search
  assert.equal(by.nl.q, '("Stav Lemkin") when:2d');
  assert.equal(by.ja.q, '("Neta Lavi" OR "ネタ・ラヴィ") when:2d');
  assert.equal(by.fr.q, '("Mahmoud Jaber" OR "Mahmud Jaber") when:2d'); // full alternative names, never a bare surname
  assert.equal(by.ja.hl, 'ja');
});

test('English headlines get a Hebrew translation too', async () => {
  const asked = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    asked.push(u.match(/sl=([^&]*)&tl=([^&]*)/).slice(1).join('>'));
    const n = opts?.body ? [...new URLSearchParams(opts.body).getAll('q')].length : 1;
    return { ok: true, json: async () => Array.from({ length: n }, (_, i) => [`תרגום ${i}`, 'en']) };
  };
  try {
    const cache = {};
    await translateItems([{ id: 'a', lang: 'en', title: 'Arsenal sign a striker', published: 1 }, { id: 'b', lang: 'he', title: 'מכבי ניצחה', published: 1 }], cache);
    assert.ok(cache.a?.he, 'English → Hebrew');
    assert.ok(!cache.a?.en, 'no English → English');
    assert.ok(cache.b?.en && !cache.b?.he, 'Hebrew → English only');
    assert.ok(asked.includes('en>iw'));
  } finally {
    globalThis.fetch = real;
  }
});
