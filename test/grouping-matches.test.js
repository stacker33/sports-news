import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterItems, headlineFixture, fixtureOf, otherMatch } from '../src/cluster.js';
import { mergeSameEvent } from '../src/merge.js';

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

test('the preview, the live updates and the result of one match stay one story', () => {
  const items = [
    art('Lille - Galatasaray | UEFA Champions League', ['t478', 't945'], 0),
    art('Lille v Galatasaray: confirmed line-ups', ['t478', 't945'], 30),
    art('Galatasaray stun Lille with four goals', ['t478', 't945'], 200),
    art('Lille 2-4 Galatasaray: Osimhen double seals it', ['t478', 't945'], 210),
  ];
  const groups = clusterItems(items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 4);
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
