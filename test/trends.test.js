import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trendBoard, nextTrendSearches, trendSources } from '../src/trends.js';

const now = Date.parse('2026-10-05T10:00:00Z');
const tr = (term, geo, traffic, urls, news = ['headline']) => ({ term, geo, traffic, urls, news });
const noAbroad = () => false;

test('only sports trends: judged by the sites Google links to them', () => {
  const signals = {
    trends: [
      tr('carlos alcaraz', 'ES', 20000, ['https://as.com/tenis/alcaraz-munar', 'https://www.marca.com/tenis/2026/10/05/x.html']),
      tr('primavera sound', 'ES', 50000, ['https://www.thelineofbestfit.com/news/primavera-sound-barcelona']),
      tr('enflasyon', 'TR', 50000, ['https://www.hurriyet.com.tr/ekonomi/enflasyon']),
      tr('protothema', 'GR', 2000, ['https://www.protothema.gr/sports/article/1']),
      tr('ángel arroyo', 'ES', 5000, ['https://www.elconfidencial.com/deportes/ciclismo/2026-10-05/x/', 'https://www.elnortedecastilla.es/deportes/ciclismo/x.html']),
      tr('johnathan motley', 'IL', 200, ['https://www.sport5.co.il/articles.aspx?FolderID=403&docID=1']),
    ],
  };
  const stories = [{ id: 'a1', title: 'Carlos Alcaraz beats Munar in Tokyo', score: 5, t: {} }];
  const b = trendBoard(signals, stories, noAbroad, [], now);
  const terms = [...b.google.il, ...b.google.world].map((g) => g.term);
  assert.deepEqual(terms.sort(), ['carlos alcaraz', 'johnathan motley', 'ángel arroyo'].sort());
  assert.deepEqual(b.google.world.find((g) => g.term === 'carlos alcaraz').ids, ['a1']);
  assert.equal(b.google.il[0].term, 'johnathan motley');
});

test('weather is never a sports trend, even when sports stories mention it', () => {
  const signals = { trends: [{ term: 'מזג האוויר', geo: 'IL', traffic: 200, news: ['התחזית'] }] };
  const stories = [{ id: 'w1', title: 'המשחק נדחה בגלל מזג האוויר', t: {} }, { id: 'w2', title: 'מזג האוויר ישפיע על המשחק', t: {} }];
  assert.equal(trendBoard(signals, stories, noAbroad, [], now).google.il.length, 0);
});

test('a sports trend with no story gets a news search for a few hours', () => {
  const b = { google: { il: [], world: [{ term: 'ángel arroyo', geo: 'ES', n: 0 }, { term: 'carlos alcaraz', geo: 'ES', n: 3 }] } };
  const s1 = nextTrendSearches(b, {}, now);
  assert.deepEqual(Object.keys(s1), ['ángel arroyo']);
  const src = trendSources(s1);
  assert.equal(src[0].lang, 'es');
  assert.ok(src[0].trend && src[0].assist && src[0].url.includes('news.google.com'));
  // dropped after 6 hours
  assert.deepEqual(Object.keys(nextTrendSearches({ google: { il: [], world: [] } }, s1, now + 7 * 3600e3)), []);
});

test('Wikipedia: sports pages only', () => {
  const signals = { trends: [], wiki: { top: [
    { wiki: 'en', title: 'Harry Kane', views: 25000, prev: 10000 },
    { wiki: 'en', title: 'Digger (2026 film)', views: 225000, prev: 1000 },
    { wiki: 'en', title: 'Julian Hall (soccer)', views: 36000, prev: 5000 },
    { wiki: 'en', title: 'Sass Jordan', views: 224000, prev: 1000 },
  ] } };
  const stories = [{ id: 'k1', title: 'Harry Kane scores twice', t: {} }, { id: 'k2', title: 'Harry Kane on his future', t: {} }];
  const b = trendBoard(signals, stories, noAbroad, [], now);
  assert.deepEqual(b.wiki.map((w) => w.title).sort(), ['Harry Kane', 'Julian Hall (soccer)']);
});
