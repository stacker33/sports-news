import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relAge, parseChannelPage, videoKind } from '../src/youtube.js';

const now = Date.parse('2026-10-05T12:00:00Z');

test('relative ages from the channel page', () => {
  assert.equal(relAge('5 minutes ago', now), now - 5 * 60e3);
  assert.equal(relAge('3 hours ago', now), now - 3 * 3600e3);
  assert.equal(relAge('1d ago', now), now - 86400e3);
  assert.equal(relAge('Streamed 2 days ago', now), now - 2 * 86400e3);
  assert.equal(relAge('1 month ago', now), now - 30 * 86400e3);
  assert.equal(relAge('160K views', now), null);
});

test('videos are read from the page data (new and old layouts)', () => {
  const data = {
    contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, content: { richGridRenderer: { contents: [
      { richItemRenderer: { content: { lockupViewModel: { contentId: 'abc123', contentImage: { thumbnailViewModel: { image: { sources: [{ url: 'x' }] } } },
        metadata: { lockupMetadataViewModel: { title: { content: 'Coach press conference' }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: '12K' } }, { text: { content: '2 hours ago' } }] }] } } } } } } } },
      { richItemRenderer: { content: { videoRenderer: { videoId: 'def456', title: { runs: [{ text: 'Highlights 2-1' }] }, publishedTimeText: { simpleText: '1 day ago' } } } } },
    ] } } } }] } },
  };
  const html = `<script>var ytInitialData = ${JSON.stringify(data)};</script>`;
  const v = parseChannelPage(html, now);
  assert.equal(v.length, 2);
  assert.deepEqual([v[0].id, v[0].title, v[0].published], ['abc123', 'Coach press conference', now - 2 * 3600e3]);
  assert.equal(v[0].image, 'https://i.ytimg.com/vi/abc123/hqdefault.jpg');
  assert.deepEqual([v[1].id, v[1].published], ['def456', now - 86400e3]);
  assert.deepEqual(parseChannelPage('<html>no data</html>', now), []);
});

test('youth-team videos are dropped (U17 / Dutch O17)', () => {
  assert.equal(videoKind('Highlights Ajax O17 - Feyenoord O17'), null);
  assert.equal(videoKind('Highlights U19: Arsenal 2-1 Chelsea'), null);
  assert.equal(videoKind('Ajax 2-1 Feyenoord | Highlights'), 'highlights');
});
