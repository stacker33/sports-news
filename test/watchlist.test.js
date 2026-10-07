// Discovery version, stage 1: the watchlist registry, matching, bounded queries and the contextual filter fixes.
// No network: everything here is pure functions on synthetic data (plus a read of the built registry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { norm, entryId, queryId, needsContext, buildWatchMatchers, annotateWatch, candidateQueries, planQueries, recordQueries, watchSources, PRIORITY_HOURS } from '../src/watchlist.js';
import { editorialBoost, markLocal, memberLocal, bigEvent } from '../src/editorial.js';
import { videoKind } from '../src/youtube.js';

const E = (name, extra = {}) => ({ id: entryId(extra.type || 'player', extra.sport || 'football', name), name, aliases: [], type: 'player', sport: 'football', category: 'israeli-candidate', status: 'verified', israelLink: { basis: 'kb-nationality' }, ...extra });
const ENTRIES = [
  E('Oscar Gloukh', { aliases: ['Oscar Glukh'], he: 'אוסקר גלוך', team: { en: 'Ajax', country: 7 } }),
  E('Tamir Blatt', { sport: 'basketball', he: 'תמיר בלאט', team: { en: 'Hapoel Tel Aviv', country: 6 } }),
  E('Danny Wolf', { sport: 'basketball', ambiguous: true, context: [], team: { en: 'Brooklyn Nets', country: 18 } }),
  E('Viktor Gyokeres', { aliases: ['Viktor Gyökeres'], category: 'world-star', status: 'source-only', israelLink: undefined }),
  E('Marta', { women: true, category: 'world-star', status: 'source-only', ambiguous: true, context: [], israelLink: undefined }),
  E('Will Rayman', { sport: 'basketball', status: 'pending', israelLink: undefined }),
];
const match = buildWatchMatchers(ENTRIES);
const ids = (text, sport) => match(text, sport).map((h) => h.name);

test('names: aliases, accents, Hebrew, whole words only', () => {
  assert.deepEqual(ids('Oscar Glukh scores again for Ajax'), ['Oscar Gloukh']);
  assert.deepEqual(ids('Gyökeres hat-trick: Viktor Gyökeres on fire'), ['Viktor Gyokeres']);
  assert.deepEqual(ids('VIKTOR GYOKERES'), ['Viktor Gyokeres']);
  assert.deepEqual(ids('שער של אוסקר גלוך'), ['Oscar Gloukh']);
  assert.deepEqual(ids('Oscar Gloukhov signs'), []); // not a substring match
  assert.equal(norm("Omer Nir'on"), 'omer nir on');
  assert.equal(norm('Šarūnas Jasikevičius'), 'sarunas jasikevicius');
  assert.equal(norm('Yıldız'), 'yildiz');
});

test('name-only matching for an unambiguous verified Israeli', () => {
  const [h] = match('Tamir Blatt: "I want to win the title"', 'basketball');
  assert.equal(h.via, 'name');
  assert.equal(h.israelLink, true);
});

test('ambiguous names need sporting context', () => {
  assert.deepEqual(ids('Danny Wolf, the wildlife photographer, wins award'), []);
  assert.deepEqual(ids('Danny Wolf drops 20 for the Brooklyn Nets'), ['Danny Wolf']);
  assert.equal(match('Israeli big man Danny Wolf impresses', 'basketball')[0].via, 'name+israel+sport');
  assert.deepEqual(ids('Marta in Madrid: tourism numbers rise'), []);
  assert.deepEqual(ids('Marta scores a stunner for Orlando Pride', 'football'), ['Marta']);
  // a football name inside a basketball story is a namesake
  assert.deepEqual(ids('Oscar Gloukh at the game courtside', 'basketball'), []);
});

test('clubs: the same name in two sports matches only the story\'s sport', () => {
  const clubs = buildWatchMatchers([
    E('Hapoel Jerusalem', { type: 'club', category: 'israeli-club', team: { en: 'Hapoel Jerusalem', country: 6 } }),
    E('Hapoel Jerusalem', { type: 'club', sport: 'basketball', category: 'israeli-club', team: { en: 'Hapoel Jerusalem', country: 6 } }),
  ]);
  assert.deepEqual(clubs('Hapoel Jerusalem beat Bnei Herzliya 88-80', 'basketball').map((h) => h.id), ['c-basketball-hapoel-jerusalem']);
  assert.deepEqual(clubs('Hapoel Jerusalem 2-0 Maccabi Netanya', 'football').map((h) => h.id), ['c-football-hapoel-jerusalem']);
});

test('only verified entries carry an Israel link; pending ones are recognised but never claim one', () => {
  const [h] = match('Will Rayman scores 18', 'basketball');
  assert.equal(h.status, 'pending');
  assert.equal(h.israelLink, false);
  const s = annotateWatch({ title: 'Will Rayman scores 18', sport: 'basketball', _members: [] }, match);
  assert.ok(!s.watchIsrael);
  const star = annotateWatch({ title: 'Viktor Gyokeres brace', sport: 'football', _members: [] }, match);
  assert.ok(star.watchStar && !star.watchIsrael);
});

test('stable IDs: alias edits and OR order never change them; two sports give two IDs', () => {
  assert.equal(entryId('player', 'football', 'Oscar Gloukh'), 'p-football-oscar-gloukh');
  assert.notEqual(entryId('club', 'football', 'Maccabi Tel Aviv'), entryId('club', 'basketball', 'Maccabi Tel Aviv'));
  assert.equal(queryId('("A B" OR "C D") when:2d', 'en'), queryId('("C D" OR "A B") when:2d', 'en'));
  assert.notEqual(queryId('"A B" when:2d', 'en'), queryId('"A B" when:2d', 'es'));
  assert.ok(needsContext('Marta') && needsContext('Josh Cohen') && needsContext('Mike James') && !needsContext('Oscar Gloukh'));
  assert.ok(needsContext('Some Player', 2)); // two people with this name in the knowledge base
});

test('queries: bounded, deduplicated, ambiguous names with their team, editors\' list skipped', () => {
  const vocab = { querySets: { israeliAngle: [{ lang: 'en', q: '("Israeli footballer") football' }], exceptional: [] } };
  const c = candidateQueries(ENTRIES, vocab, { skipNames: new Set(['tamir blatt']) });
  assert.ok(c.every((x) => x.q.length <= 400 && /when:[23]d$/.test(x.q)));
  assert.ok(c.some((x) => x.q === '"Danny Wolf" "Brooklyn Nets" when:2d'));
  assert.ok(!c.some((x) => x.q.includes('Tamir Blatt')));
  assert.ok(!c.some((x) => x.q.includes('Rayman') || x.q.includes('Marta'))); // pending / source-only are never searched
  assert.ok(c.some((x) => x.locale === 'nl' && x.q.includes('Oscar Gloukh'))); // the club's country language
  assert.equal(new Set(c.map((x) => x.id)).size, c.length);
  const many = Array.from({ length: 40 }, (_, i) => E(`Player Number${i} Longname${i}`, { team: { en: 'X', country: 1 } }));
  const big = candidateQueries(many, {});
  assert.ok(big.length >= 7 && big.every((x) => x.q.length <= 400));
  const src = watchSources(c.slice(0, 2));
  assert.ok(src.every((s) => s.watch && s.google && s.url.startsWith('https://news.google.com/rss/search?')));
});

test('scheduling: budget, rotation by priority, deferral reasons, backoff and expiry', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  const cand = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, q: `q${i}`, locale: 'en', mode: 'A', priority: i < 3 ? 'high' : 'low' }));
  const first = planQueries(cand, {}, { now, budget: 4 });
  assert.equal(first.run.length, 4);
  assert.equal(first.deferred.length, 6);
  assert.ok(first.deferred.every((d) => d.why));
  // after running, those queries are not due again until their interval passes
  let sched = recordQueries({}, first.run, first.run.map(() => ({ ok: true, count: 3 })), now);
  const second = planQueries(cand, sched, { now: now + 60e3, budget: 4 });
  assert.ok(second.run.every((c) => !first.run.some((f) => f.id === c.id)));
  assert.ok(second.deferred.some((d) => d.why === 'not due yet'));
  // high priority comes back sooner than low
  sched = recordQueries({}, cand, cand.map(() => ({ ok: true })), now);
  const later = planQueries(cand, sched, { now: now + PRIORITY_HOURS.high * 3600e3 + 1, budget: 10 });
  assert.deepEqual(later.run.map((c) => c.id).sort(), ['q0', 'q1', 'q2']);
  // failures back off exponentially
  const failed = recordQueries(recordQueries({}, [cand[0]], [{ ok: false }], now), [cand[0]], [{ ok: false }], now);
  assert.equal(failed.q0.fails, 2);
  const retry = planQueries([cand[0]], failed, { now: now + 2 * 3600e3, budget: 5 });
  assert.equal(retry.run.length, 0);
  assert.match(retry.deferred[0].why, /backoff/);
  // a query no longer generated (an entry removed from the registry) is forgotten
  const kept = recordQueries({ old: { last: now } }, [], [], now, new Set(['q0']));
  assert.ok(!('old' in kept));
});

test('one-source local-language interview with a verified Israeli is not "local"', () => {
  const greek = { country: 'Greece' };
  const m = { title: 'Ταμίρ Μπλατ: «Θέλουμε τον τίτλο» - συνέντευξη', summary: 'Tamir Blatt', lang: 'el', src: greek, ents: [] };
  let s = { score: 10, pop: 10, title: m.title, sport: 'basketball', langs: ['el'], _members: [m] };
  s = annotateWatch(s, match);
  assert.ok(s.watchIsrael);
  const out = markLocal(s, (x) => memberLocal(x, x.src));
  assert.ok(!out.local);
  assert.equal(out.score, 10);
  // the same interview with someone untracked stays local
  const other = markLocal({ ...s, watchIsrael: false, watch: undefined, title: 'Συνέντευξη παίκτη' }, (x) => memberLocal(x, x.src));
  assert.ok(other.local);
});

test('player ratings: low for a generic match, kept for a tracked Israeli', () => {
  const base = { score: 10, pop: 10, _members: [] };
  assert.equal(editorialBoost({ ...base, title: 'Arsenal player ratings vs Chelsea' }).score, 6);
  assert.equal(editorialBoost({ ...base, title: 'Ajax player ratings: Gloukh shines', watchIsrael: true }).score, 10);
  assert.equal(editorialBoost({ ...base, title: 'Le pagelle del Lecce', abroad: true }).score, 10);
});

test('YouTube: podcast / women / youth kept only with a tracked person; junk always rejected', () => {
  const tracked = (t) => /tamir blatt|sharon beck/i.test(t);
  assert.equal(videoKind('The Hoop Podcast ep. 41: Tamir Blatt', tracked), 'press');
  assert.equal(videoKind('The Hoop Podcast ep. 41: a random guest', tracked), null);
  assert.equal(videoKind('Women: Sharon Beck goal | Highlights 2-1', tracked), 'highlights');
  assert.equal(videoKind('Women highlights 2-1', tracked), null);
  assert.equal(videoKind('Highlights Ajax O17 - Feyenoord O17', tracked), null);
  // junk is never rescued by a name
  assert.equal(videoKind('#shorts Tamir Blatt dunk', tracked), null);
  assert.equal(videoKind('Tamir Blatt LIVE 🔴', tracked), null);
  assert.equal(videoKind('Tamir Blatt kit unboxing', tracked), null);
  // unchanged behaviour without a tracker
  assert.equal(videoKind('Coach press conference'), 'press');
});

test('language versus source country', () => {
  // an English-language article from a Greek outlet is local by the outlet's country
  assert.ok(memberLocal({ lang: 'en' }, { country: 'Greece' }));
  // a Spanish outlet is never local, even in another language
  assert.ok(!memberLocal({ lang: 'el' }, { country: 'Spain' }));
  // no country known: the language decides
  assert.ok(memberLocal({ lang: 'el' }, null));
  assert.ok(!memberLocal({ lang: 'en' }, null));
});

test('other sports: exceptional stories pass when spreading or about a star, not on a keyword alone', () => {
  const st = (title, extra = {}) => ({ title, sport: 'other', _members: [{ title }], ...extra });
  assert.ok(bigEvent(st('Duplantis breaks pole vault world record again', { watchStar: true })));
  assert.ok(bigEvent(st('Sprinter handed doping ban', { langs: ['en', 'fr'] })));
  assert.ok(!bigEvent(st('Backup linebacker retires')));
  assert.ok(!bigEvent(st('Odell Beckham Jr. agrees Giants used him as publicity stunt')));
});

test('built registry follows the brief\'s corrections and never asserts an unverified link', () => {
  const w = JSON.parse(readFileSync(new URL('../config/watchlist.json', import.meta.url), 'utf8'));
  const by = (name) => w.entries.filter((e) => e.name === name);
  assert.ok(w.entries.every((e) => e.status !== 'verified' || e.israelLink?.basis));
  assert.ok(w.entries.every((e) => e.status === 'verified' || !e.israelLink));
  assert.ok(!by('Danny Wolf')[0].aliases.includes('Daniel Wolf'));
  assert.ok(!by('Sophia Wilson')[0].aliases.includes('Sophia Smith'));
  assert.equal(by('Liel Abada')[0].sport, 'football');
  assert.equal(by('Ryan Turell')[0].sport, 'basketball');
  assert.equal(by('Alyssa Baron').length, 1);
  assert.equal(by('Alysha Clark').length, 1);
  assert.equal(by('Elad Madmon').length, 1);
  assert.ok(!w.entries.some((e) => /Ilay Madmon|Or Blayzer|Barbra Banda|Tessel Middag/.test(e.name)));
  // world stars and foreign-relevance players are recognition only
  assert.ok(w.entries.filter((e) => e.category === 'world-star' || e.category === 'foreign-relevance-candidate').every((e) => e.status === 'source-only'));
  // IDs are unique
  assert.equal(new Set(w.entries.map((e) => e.id)).size, w.entries.length);
});
