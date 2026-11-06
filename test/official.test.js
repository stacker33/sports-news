import { test } from 'node:test';
import assert from 'node:assert/strict';
import { officialName, officialSources, OFFICIAL_SITES } from '../config/official.js';
import { gnews, SOURCES } from '../config/sources.js';
import { fetchFeed } from '../src/feeds.js';

test('official: the main address (or a language version) counts, the shop and the tickets do not', () => {
  assert.equal(officialName('https://www.realmadrid.com'), 'Real Madrid');
  assert.equal(officialName('https://realmadrid.com/x'), 'Real Madrid');
  assert.equal(officialName('https://en.atleticodemadrid.com'), 'Atlético de Madrid');
  assert.equal(officialName('https://shop.realmadrid.com'), null);
  assert.equal(officialName('https://us.shop.realmadrid.com'), null);
  assert.equal(officialName('https://tickets.mhaifafc.com'), null);
  assert.equal(officialName('https://billetterie.om.fr'), null);
  assert.equal(officialName('https://www.marca.com'), null);
  assert.equal(officialName('not a url'), null);
});

test('official: every site is in exactly one search, by language', () => {
  const src = officialSources(gnews);
  const q = src.map((s) => decodeURIComponent(s.url));
  for (const [, host] of OFFICIAL_SITES) assert.equal(q.filter((u) => u.includes(`site:${host} `) || u.includes(`site:${host})`)).length, 1, host);
  assert.equal(new Set(src.map((s) => s.id)).size, src.length);
  assert.ok(src.every((s) => s.officialSite && s.official && s.assist && s.google));
  assert.ok(SOURCES.some((s) => s.id === src[0].id));
});

test('official: a Google News item is official only from the main address; section pages are dropped', async () => {
  const item = (title, url, name) => `<item><title>${title} - ${name}</title><link>https://news.google.com/rss/articles/x${Math.random()}</link><pubDate>Fri, 06 Nov 2026 15:35:00 GMT</pubDate><source url="${url}">${name}</source></item>`;
  const xml = `<?xml version="1.0"?><rss><channel>${[
    item('Official statement: Rafael Nadal joins the club board', 'https://www.realmadrid.com', 'Real Madrid CF | Web Oficial'),
    item('New home shirt 2026-27 now available in all stores', 'https://shop.realmadrid.com', 'Real Madrid Shop'),
    item('Basket-TV', 'https://basket.co.il', 'מנהלת ליגת העל בכדורסל'),
  ].join('')}</channel></rss>`;
  const before = globalThis.fetch;
  globalThis.fetch = async () => new Response(xml, { status: 200, headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
  try {
    const r = await fetchFeed({ id: 't', name: 'Google News', url: 'https://news.google.com/x', google: true, official: true, officialSite: true });
    const items = r.items || r;
    assert.equal(items.length, 1);
    assert.equal(items[0].publisher, 'Real Madrid');
    assert.equal(items[0].official, true);
    assert.equal(items[0].title, 'Official statement: Rafael Nadal joins the club board');
  } finally {
    globalThis.fetch = before;
  }
});
