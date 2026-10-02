// Fetch + parse RSS / Atom feeds into plain items.
import { XMLParser } from 'fast-xml-parser';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  cdataPropName: false,
  processEntities: false, // decoded by cleanText (avoids entity-expansion limit on big feeds)
  trimValues: true,
});

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const text = (x) => {
  if (x == null) return '';
  if (typeof x === 'string' || typeof x === 'number') return String(x);
  if (Array.isArray(x)) return text(x[0]);
  return String(x['#text'] ?? '');
};

const ACCENTS = { grave: '\u0300', acute: '\u0301', circ: '\u0302', tilde: '\u0303', uml: '\u0308', cedil: '\u0327', ring: '\u030A' };
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  ndash: '–', mdash: '—', hellip: '…', euro: '€', pound: '£',
};
export function decodeEntities(s) {
  return String(s || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (ENTITIES[e.toLowerCase()]) return ENTITIES[e.toLowerCase()];
    // accented letters: &agrave; &Eacute; &ccedil; &ouml; …
    const acc = e.match(/^([a-z])(grave|acute|circ|tilde|uml|cedil|ring)$/i);
    if (acc) return (acc[1] + ACCENTS[acc[2].toLowerCase()]).normalize('NFC');
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return m;
  });
}

export function cleanText(s) {
  // decode → strip tags → decode again (some feeds escape their HTML, some double-escape &amp;)
  return decodeEntities(decodeEntities(String(s || '')).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function findImage(it) {
  const media = arr(it['media:content']).concat(arr(it['media:thumbnail']), arr(it['media:group']?.['media:content']));
  for (const m of media) if (m?.['@url'] && !/\.(mp4|mp3)(\?|$)/i.test(m['@url'])) return decodeEntities(m['@url']);
  for (const e of arr(it.enclosure)) if (e?.['@url'] && /image/i.test(e['@type'] || 'image')) return decodeEntities(e['@url']);
  const html = text(it.description) + text(it['content:encoded']);
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? decodeEntities(m[1]) : null;
}

// Time-zone abbreviations Date.parse doesn't know
const TZ_ABBR = { BST: '+0100', CET: '+0100', CEST: '+0200', EET: '+0200', EEST: '+0300', IDT: '+0300', WET: '+0000', WEST: '+0100', MSK: '+0300' };

// Offset (ms) of an IANA zone at a given instant, e.g. Asia/Jerusalem → +3h in summer
function zoneOffset(ts, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(ts)
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

// tz: the feed writes local wall-clock time but labels it GMT (e.g. Walla) → reinterpret in that zone
export function parseDate(s, tz) {
  if (!s) return null;
  let str = String(s).trim().replace(/\b([A-Z]{3,4})$/, (m, abbr) => TZ_ABBR[abbr] || abbr);
  let t = Date.parse(str);
  if (!Number.isFinite(t)) return null;
  if (tz) {
    // treat the written clock time as local time in `tz`
    const wall = Date.parse(str.replace(/\s*(GMT|UTC|Z|[+-]\d{2}:?\d{2})$/i, '') + ' UTC');
    if (Number.isFinite(wall)) {
      t = wall - zoneOffset(wall, tz);
      t = wall - zoneOffset(t, tz); // second pass handles DST edges
    }
  }
  return t;
}

// Sport5 has no RSS: read the homepage (articles are listed newest first; no times → first-seen time)
function parseSport5(html) {
  const re = /<a[^>]+href="((?:https:\/\/www\.sport5\.co\.il)?\/articles\.aspx\?FolderID=\d+&(?:amp;)?docID=(\d+))"[^>]*>([\s\S]{0,600}?)<\/a>/g;
  const best = new Map();
  let m;
  while ((m = re.exec(html))) {
    const title = cleanText(m[3]);
    if (title.length > (best.get(m[2])?.title.length || 15)) {
      best.set(m[2], { title, link: `https://www.sport5.co.il/articles.aspx?FolderID=${m[1].match(/FolderID=(\d+)/)[1]}&docID=${m[2]}` });
    }
  }
  return [...best.values()].map((a) => ({ ...a, summary: '', published: null, image: null, publisher: 'ספורט 5' }));
}

// ---------- direct sources without RSS ----------

// ESPN's public JSON news feed (per league)
function parseEspn(j, source) {
  return (j.articles || [])
    .filter((a) => a.type !== 'Media' && a.links?.web?.href) // skip video clips
    .map((a) => ({
      title: cleanText(a.headline),
      link: a.links.web.href,
      summary: cleanText(a.description || '').slice(0, 280),
      published: parseDate(a.published),
      image: a.images?.[0]?.url || null,
      publisher: source.name,
    }));
}

// WordPress sites expose their posts as JSON (e.g. sport1)
function parseWordPress(j, source) {
  return (Array.isArray(j) ? j : []).map((p) => ({
    title: cleanText(p.title?.rendered || ''),
    link: p.link,
    summary: cleanText(p.excerpt?.rendered || '').slice(0, 280),
    published: parseDate(p.date_gmt ? p.date_gmt + 'Z' : p.date),
    image: null,
    publisher: source.name,
  }));
}

// Social posts read as headlines: first line / first ~180 characters
function postTitle(text) {
  const t = cleanText(String(text || '').replace(/\n+/g, ' \n '))
    .replace(/[​-‍﻿]/g, '') // invisible joiners some channels start posts with
    .replace(/\s*—\s*[^\n—]{1,40}\(@\w+\)[\s\S]*$/, '') // tweet-embed signature: "— Name (@handle) Oct 2, 2026"
    .replace(/\s*(>{2,}|»)?\s*https?:\/\/\S+/g, '') // "click for more >>> https://…"
    .replace(/(\s*\n\s*)+$/, '')
    .replace(/\s*\n\s*/g, ' — ');
  if (t.length <= 180) return t;
  const cut = t.slice(0, 180);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf(' — '));
  return (end > 80 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '')) + '…';
}

// Bluesky public API (no account needed): a reporter's latest posts
function parseBluesky(j, source) {
  return (j.feed || [])
    .filter((x) => !x.reason && x.post?.record?.text) // own posts only, not reposts
    .map(({ post }) => {
      const rkey = post.uri.split('/').pop();
      const embed = post.embed?.external || post.embed?.media?.external;
      const img = post.embed?.images?.[0]?.thumb || embed?.thumb || null;
      return {
        title: postTitle(post.record.text),
        link: `https://bsky.app/profile/${post.author.handle}/post/${rkey}`,
        summary: post.record.text.length > 180 ? cleanText(post.record.text).slice(0, 280) : '',
        published: parseDate(post.record.createdAt),
        image: img,
        publisher: source.name,
        social: true,
      };
    })
    .filter((p) => p.title.length >= 20);
}

// Public Telegram channel preview page (t.me/s/<channel>)
function parseTelegram(html, source) {
  const out = [];
  const blocks = html.split('<div class="tgme_widget_message_wrap').slice(1);
  for (const b of blocks) {
    const post = b.match(/data-post="([^"]+)"/)?.[1];
    const text = b.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    const time = b.match(/<time datetime="([^"]+)"/)?.[1];
    if (!post || !text) continue;
    const plain = cleanText(text.replace(/<br\s*\/?>/gi, '\n'));
    out.push({
      title: postTitle(text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')),
      link: `https://t.me/${post}`,
      summary: plain.length > 180 ? plain.slice(0, 280) : '',
      published: parseDate(time),
      image: b.match(/background-image:url\('([^']+)'\)/)?.[1] || null,
      publisher: source.name,
      social: true,
    });
  }
  return out.filter((p) => p.title.length >= 20);
}

export async function fetchFeed(source, timeoutMs = 15000) {
  if (source.parser === 'sport5') {
    const res = await fetch(source.url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseSport5(await res.text());
  }
  if (['espn', 'wordpress', 'bluesky', 'telegram'].includes(source.parser)) {
    const res = await fetch(source.url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (source.parser === 'telegram') return parseTelegram(await res.text(), source);
    const j = await res.json();
    return source.parser === 'espn' ? parseEspn(j, source) : source.parser === 'wordpress' ? parseWordPress(j, source) : parseBluesky(j, source);
  }
  const res = await fetch(source.url, {
    headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await readText(res);
  const doc = parser.parse(xml);

  const rssItems = arr(doc?.rss?.channel?.item ?? doc?.['rdf:RDF']?.item);
  const atomItems = arr(doc?.feed?.entry);
  const out = [];

  for (const it of rssItems) {
    let title = cleanText(text(it.title));
    let publisher = source.name;
    if (source.google) {
      // Google News: "Headline - Publisher"
      const src = text(it.source);
      if (src) {
        publisher = cleanText(src);
        const suffix = ' - ' + publisher;
        if (title.endsWith(suffix)) title = title.slice(0, -suffix.length);
      } else {
        const m = title.match(/^(.*) - ([^-]+)$/);
        if (m) [title, publisher] = [m[1], m[2].trim()];
      }
    }
    out.push({
      title,
      link: decodeEntities(text(it.link) || text(it.guid) || arr(it['atom:link'])[0]?.['@href'] || '').trim(),
      summary: source.google ? '' : cleanText(text(it.description)).slice(0, 280),
      published: source.noDates ? null : parseDate(text(it.pubDate) || text(it['dc:date']), source.tz),
      image: findImage(it),
      publisher,
    });
  }
  for (const it of atomItems) {
    const links = arr(it.link);
    const alt = links.find((l) => !l['@rel'] || l['@rel'] === 'alternate') || links[0];
    out.push({
      title: cleanText(text(it.title)),
      link: decodeEntities(alt?.['@href'] || '').trim(),
      summary: cleanText(text(it.summary) || text(it.content)).slice(0, 280),
      published: source.noDates ? null : parseDate(text(it.published) || text(it.updated), source.tz),
      image: findImage(it),
      publisher: source.name,
    });
  }
  const ok = out.filter((i) => i.title && i.link);
  // big feeds (hundreds of items): keep only the newest
  return source.max ? ok.sort((a, b) => (b.published || 0) - (a.published || 0)).slice(0, source.max) : ok;
}

// Body as text in the feed's own encoding (some sites still use ISO-8859-1 / windows-1252)
async function readText(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 200).toString('latin1');
  const cs = ((res.headers.get('content-type') || '').match(/charset=([\w-]+)/i) || head.match(/encoding=["']([\w-]+)["']/i) || [])[1];
  try {
    return new TextDecoder(cs && !/utf-?8/i.test(cs) ? cs : 'utf-8').decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

// Run async tasks with limited concurrency
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await fn(items[i]) };
      } catch (e) {
        results[i] = { ok: false, error: e };
      }
    }
  });
  await Promise.all(workers);
  return results;
}
