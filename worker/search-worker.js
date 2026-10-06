// Sports Radar — instant web search (Cloudflare Worker, free plan).
// The site is static (GitHub Pages), so the browser can't read Google News itself (no CORS). This tiny proxy does:
//   GET /search?q=<words>&langs=he,en&when=7d  →  { q, items: [{ title, he, link, source, published, lang }] }
// - Google News RSS per language, merged, duplicates dropped, newest first (max 40)
// - foreign headlines get a quick Hebrew machine translation (`he`)
// - answers only the site's own pages (CORS), caches each search for 2 minutes, keeps no data and needs no keys
// Setup: worker/README.md

const ALLOWED = ['https://stacker33.github.io', 'http://localhost:3000'];
const LOCALES = {
  he: ['he', 'IL', 'IL:he'],
  en: ['en-US', 'US', 'US:en'],
  es: ['es', 'ES', 'ES:es'],
  it: ['it', 'IT', 'IT:it'],
  fr: ['fr', 'FR', 'FR:fr'],
  de: ['de', 'DE', 'DE:de'],
  pt: ['pt-PT', 'PT', 'PT:pt-150'],
  ru: ['ru', 'RU', 'RU:ru'],
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const decode = (s) =>
  String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
const tag = (xml, name) => decode(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]);

async function googleNews(q, lang, when) {
  const [hl, gl, ceid] = LOCALES[lang];
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${when}`)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  const res = await fetch(url, { headers: { 'user-agent': UA }, cf: { cacheTtl: 120 } });
  if (!res.ok) return [];
  const xml = await res.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 25).map(([, it]) => {
    const source = tag(it, 'source');
    let title = tag(it, 'title');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const published = Date.parse(tag(it, 'pubDate')) || null;
    return { title, link: tag(it, 'link'), source, published, lang };
  });
}

// one request for all foreign headlines (Google's free web translator, the endpoint the collector uses; best effort)
async function toHebrew(titles) {
  if (!titles.length) return [];
  try {
    const body = new URLSearchParams();
    for (const t of titles) body.append('q', t);
    const res = await fetch('https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=iw', {
      method: 'POST',
      headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) return [];
    const j = await res.json();
    const out = (titles.length === 1 && !Array.isArray(j[0]) ? [j[0]] : j).map((x) => String(Array.isArray(x) ? x[0] : x).trim());
    return out.length === titles.length ? out : [];
  } catch {
    return [];
  }
}

const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// betting / predictions / karaoke & lyrics pages that Google News sometimes returns
const JUNK = /\b(odds|betting|bet365|predictions?|tips|picks|karaoke|lyrics|horoscope)\b|הימורים|ניחושים/i;

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('origin') || '';
    const cors = {
      'access-control-allow-origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
      'access-control-allow-methods': 'GET, OPTIONS',
      vary: 'origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);
    if (url.pathname !== '/search') return new Response('Sports Radar search proxy: GET /search?q=…', { headers: cors });

    const q = (url.searchParams.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const langs = [...new Set((url.searchParams.get('langs') || 'he,en').split(','))].filter((l) => LOCALES[l]).slice(0, 4);
    const when = ['1h', '1d', '7d'].includes(url.searchParams.get('when')) ? url.searchParams.get('when') : '7d';
    const json = (body, extra = {}) => new Response(JSON.stringify(body), { headers: { ...cors, 'content-type': 'application/json; charset=utf-8', ...extra } });
    if (q.length < 2) return json({ q, items: [] });

    // same search within 2 minutes → the cached answer
    const cache = caches.default;
    const key = new Request(`https://cache.sports-radar/search?q=${encodeURIComponent(q.toLowerCase())}&l=${langs.join(',')}&w=${when}`);
    const hit = await cache.match(key);
    if (hit) {
      const body = await hit.text();
      return new Response(body, { headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'x-cache': 'hit' } });
    }

    const lists = await Promise.all(langs.map((l) => googleNews(q, l, when).catch(() => [])));
    const seen = new Set();
    const items = lists
      .flat()
      .filter((x) => x.title && x.link && !JUNK.test(x.title))
      .filter((x) => {
        const k = norm(x.title).slice(0, 80);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => (b.published || 0) - (a.published || 0))
      .slice(0, 40);
    const foreign = items.filter((x) => x.lang !== 'he' && !/[א-ת]/.test(x.title));
    const he = await toHebrew(foreign.map((x) => x.title));
    foreign.forEach((x, i) => he[i] && (x.he = he[i]));

    const body = JSON.stringify({ q, langs, when, at: Date.now(), items });
    ctx.waitUntil(cache.put(key, new Response(body, { headers: { 'cache-control': 'max-age=120', 'content-type': 'application/json' } })));
    return new Response(body, { headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } });
  },
};
