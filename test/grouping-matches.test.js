import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterItems, headlineFixture, fixtureOf, otherMatch, matchPhase } from '../src/cluster.js';
import { mergeSameEvent, sameEventStrict, eventPrint } from '../src/merge.js';

const T0 = Date.parse('2026-10-21T10:00:00Z');
let n = 0;
const art = (title, ents = [], min = 0, extra = {}) => ({ id: `a${++n}`, title, lang: 'en', published: T0 + min * 60e3, ents, sport: 'football', ...extra });

test('the match is read from the headline shape, not from a dash in a sentence', () => {
  assert.deepEqual(headlineFixture('Wolverhampton - Portsmouth: typy, kursy, absencje, zapowiedź - 20.10.2026'), [['wolverhampton'], ['portsmouth']]);
  assert.deepEqual(headlineFixture('Torino-Monza: orario e dove vederla in TV e streaming'), [['torino'], ['monza']]);
  assert.deepEqual(headlineFixture('Dallas Mavericks vs Houston Rockets Prediction 10/21/2026 Today’s NBA Picks')?.map((s) => s[0]), ['dalla', 'houston']);
  assert.deepEqual(headlineFixture('FC Volendam - Utrecht II - statystyki meczu 23.10.2026'), [['volendam'], ['utrecht']]); // "FC", "II" are not names
  assert.equal(headlineFixture('Barak Yitzhaki - the new coach of Anorthosis after a long search'), null);
  assert.equal(headlineFixture('Arsenal handed huge Champions League advantage over Bayern'), null);
});

test('two different matches conflict; the same match in other words does not', () => {
  assert.equal(otherMatch({ ents: 't1+t2' }, { ents: 't1+t3' }), true);
  assert.equal(otherMatch({ ents: 't1+t2' }, { ents: 't1+t2' }), false);
  assert.equal(otherMatch(fixtureOf(art('Como vs Man Utd: Preview')), fixtureOf(art('Como vs Manchester United: team news'))), false);
  assert.equal(otherMatch(fixtureOf(art('Torino-Monza: orario')), fixtureOf(art('Como-Manchester United: orario'))), true);
  assert.equal(otherMatch(null, { ents: 't1+t2' }), false); // an article naming no match never conflicts
});

test('betting / TV-listing templates for different matches become separate stories', () => {
  const items = [
    art('Wolverhampton - Portsmouth: typy, kursy, absencje, zapowiedź - 20.10.2026', [], 0),
    art('Graafschap - Waalwijk: typy, kursy, absencje, zapowiedź - 23.10.2026', [], 1),
    art('Vitesse - FC Emmen: typy, kursy, absencje, zapowiedź - 23.10.2026', [], 2),
    art('Wolverhampton - Portsmouth: typy kursy absencje zapowiedź meczu', [], 3),
  ];
  const groups = clusterItems(items).map((g) => g.map((x) => x.title.split(':')[0]).sort());
  assert.equal(groups.length, 3);
  assert.ok(groups.some((g) => g.length === 2 && g.every((t) => t.startsWith('Wolverhampton'))));
});

test('two matches tagged with team ids never share a story, even with the same template words', () => {
  const items = [
    art('Real Madrid vs RB Leipzig: Preview, Predictions and Lineups', ['t131', 't7171'], 0),
    art('Bayern Munich vs Arsenal: Preview, Predictions and Lineups', ['t104', 't331'], 1),
    art('Real Madrid vs RB Leipzig: Date, Time and Everything You Need to Know', ['t131', 't7171'], 2),
  ];
  const groups = clusterItems(items);
  assert.equal(groups.length, 2);
  for (const g of groups) assert.equal(new Set(g.map((x) => x.ents.join('+'))).size, 1);
});

// The editors' rule since 2026-11-12 (it used to be "one match, one story"): the coverage before a match, during it
// and after it are separate stories; inside one phase, reports of the same thing are one story.
test('one match: the previews are one story, the live coverage another, the results a third', () => {
  const M = ['t478', 't945'];
  const items = [
    art('Lille v Galatasaray: preview and predicted line-ups', M, 0),
    art('Lille v Galatasaray: confirmed line-ups', M, 30),
    art('Lille - Galatasaray: where to watch, TV channel and kick-off time', M, 40),
    art('Lille v Galatasaray LIVE: Osimhen puts the visitors in front', M, 150),
    art('LIVE! Lille - Galatasaray: second half under way', M, 170),
    art('Lille 2-4 Galatasaray: Osimhen double seals it', M, 210),
    art('Galatasaray beat Lille with four goals', M, 215),
    art('Lille - Galatasaray 2-4: goals and highlights', M, 230),
  ];
  const groups = clusterItems(items).map((g) => g.map((x) => matchPhase(x.title)));
  assert.equal(groups.length, 3);
  for (const g of groups) assert.equal(new Set(g).size, 1); // never two phases in one story
  assert.deepEqual(groups.map((g) => `${g[0]}:${g.length}`).sort(), ['live_match:2', 'post_match:3', 'pre_match:3']);
});

test('the phase is read from the headline; a time or a date is not a score; a TV listing that says "live" is before the match', () => {
  const p = (t) => matchPhase(t);
  assert.equal(p('Real Madrid vs Sevilla: preview and predicted line-ups'), 'pre_match');
  assert.equal(p('Juventus-Lazio at 8.45pm: here are the official lineups'), 'pre_match');
  assert.equal(p('Fiorentina Como LIVE FOLLOW | On which channel, at what time, where to watch?'), 'pre_match');
  assert.equal(p('LIVE! Real starts with Endrick against Sevilla'), 'live_match');
  assert.equal(p('Milan 2:0 Atalanta, the second half has started'), 'live_match');
  assert.equal(p('Real Madrid 4-1 Sevilla: goals and highlights'), 'post_match');
  assert.equal(p('Partizan 80:66 Baskonia'), 'post_match');
  assert.equal(p('Real convincingly beat Sevilla, two goals from Mbappe'), 'post_match');
  assert.equal(p('Kick-off 19:00 Trabzonspor - Besiktas'), null);
  assert.equal(p('Match of 18/10/2026: Brighton - Palace'), null);
  assert.equal(p('Mourinho: There is and cannot be peace in Real Madrid'), null);
});

test('news about a club that plays in a match does not join the match story on the club names alone', () => {
  const M = ['t131', 't138'];
  const match = [
    art('Real Madrid vs Sevilla: preview and predicted line-ups', M, 0),
    art('Real Madrid - Sevilla: confirmed line-ups', M, 20),
    art('Real Madrid vs Sevilla: where to watch and kick-off time', M, 30),
  ];
  const club = [
    art('Real Madrid have a replacement for Mourinho in mind, report says', ['t131'], 40),
    art('Real Madrid and Sevilla fans clash with police outside the stadium', ['t131'], 50), // both names, no match named
    art('Real Madrid agree a new deal with Courtois until 2028', ['t131'], 60),
  ];
  const groups = clusterItems([...match, ...club]);
  const of = (a) => groups.find((g) => g.includes(a));
  assert.equal(of(match[0]).length, 3); // the match story keeps its three
  for (const c of club) assert.ok(!of(match[0]).includes(c), c.title);
  // a report of the same phase that tags only one of the two teams still joins the result story
  const res = [
    art('Real Madrid 4-1 Sevilla: Mbappe double in a big win', M, 200),
    art('Real Madrid - Sevilla 4-1: goals and highlights', M, 205),
    art('Mbappe double as Real Madrid beat Sevilla 4-1 in a big win', ['t131'], 210),
  ];
  const g2 = clusterItems(res);
  assert.equal(g2.length, 1);
});

test('a story takes articles for 20 hours from its first article, however many keep coming', () => {
  // one article every 3 hours for two days, each a near copy of the last: the old limit moved with every article
  const items = Array.from({ length: 16 }, (_, i) => art(`Transfer saga: Atletico Norte and Sporting Oeste still in talks over Marco Valdes, update ${i}`, [], i * 180));
  const groups = clusterItems(items);
  assert.ok(groups.length >= 2);
  for (const g of groups) assert.ok(g[g.length - 1].published - g[0].published <= 20 * 3600e3);
  // inside the 20 hours it is still one story
  assert.equal(groups[0].length, 7); // 0h, 3h … 18h
});

test('the cross-language merge does not join stories about two different matches', () => {
  const a = [art('Como vs Man Utd: Preview', ['t105', 't6117'], 0, { id: 'k1' })];
  const b = [art('Bayern vs Arsenal: Preview', ['t104', 't331'], 5, { id: 'k2' })];
  const cards = { k1: { title_he: 'קומו נגד מנצ׳סטר יונייטד: תצוגה מקדימה ליגת האלופות', about: 'champions league preview' }, k2: { title_he: 'באיירן נגד ארסנל: תצוגה מקדימה ליגת האלופות', about: 'champions league preview' } };
  // shared subject words, a shared (fake) player id: the strict check alone could join them
  a[0].ents.push('p1');
  b[0].ents.push('p1');
  assert.equal(mergeSameEvent([a, b], cards).length, 2);
});

test('nearly the same Hebrew headline from many outlets is one story, even when its words are common; not when the scores differ', () => {
  const card = (id, he, about) => [[{ id, title: 'x', lang: 'sr', published: T0, ents: ['t5509'], sport: 'basketball' }], { [id]: { title_he: he, about } }];
  const [a, ca] = card('p1', 'פרטיזן בלגרד תארח את מכבי תל אביב ביורוליג', 'Partizan Belgrade Maccabi Tel Aviv EuroLeague');
  const [b, cb] = card('p2', 'פרטיזן בלגרד מארחת את מכבי תל אביב ביורוליג', 'Partizan vs Maccabi Tel Aviv');
  const [c, cc] = card('p3', 'פרטיזן בלגרד פוגשת את מכבי תל אביב ביורוליג', 'Partizan Belgrade Maccabi Tel Aviv EuroLeague');
  // many other cards with the same words make them "common" (that used to block the merge)
  const others = Array.from({ length: 30 }, (_, i) => card(`o${i}`, `מכבי תל אביב ביורוליג ${i} פרטיזן בלגרד ידיעה אחרת לגמרי מספר ${i}`, `Other ${i}`));
  const cards = Object.assign({}, ca, cb, cc, ...others.map((o) => o[1]));
  const merged = mergeSameEvent([a, b, c, ...others.map((o) => o[0])], cards);
  assert.ok(merged.some((g) => ['p1', 'p2', 'p3'].every((id) => g.some((m) => m.id === id))));
  // with common words (no rare ones), only the near-same-headline rule can join: not when the headlines' scores differ
  const fp = (he) => eventPrint([{ ents: ['t131'], title: 'x' }], { title_he: he, about: 'Real Madrid Sevilla' });
  assert.equal(sameEventStrict(fp('ריאל מדריד ניצחה 2:0 את סביליה בליגה הספרדית'), fp('ריאל מדריד ניצחה 3:1 את סביליה בליגה הספרדית'), new Set()), false);
  assert.equal(sameEventStrict(fp('ריאל מדריד ניצחה 2:0 את סביליה בליגה הספרדית'), fp('ריאל מדריד ניצחה 2:0 את סביליה בליגה'), new Set()), true);
});
