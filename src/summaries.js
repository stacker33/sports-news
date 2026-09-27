// One-to-two-sentence summary for every story.
//   1. the feed's own description (most direct feeds have one)
//   2. otherwise the article page's summary (og:description) — Google News links are decoded to the real article first
// Fetched gradually (most important stories first) and cached per article.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const RETRY_FAILED_MS = 6 * 3600e3;

const decodeHtml = (s) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

// Keep it short: first one or two sentences, ~260 characters max
export function shorten(text, title = '') {
  let t = decodeHtml(String(text || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  if (!t || t.length < 25) return '';
  // site-wide blurbs, not a summary of this article
  if (/^(get|read|find|see|check out|stay up to date with) (all )?(the )?latest|latest (news|headlines) (and|from|on)|click here|subscribe (now|to)|sign up for/i.test(t)) return '';
  if (title && t.toLowerCase().startsWith(title.toLowerCase().slice(0, 40))) t = t.slice(title.length).replace(/^[\s:.–-]+/, '');
  if (t.length < 25) return '';
  const sentences = t.match(/[^.!?。]+[.!?。]+["”’)]?\s*/g) || [t];
  let out = '';
  for (const s of sentences) {
    if (out && (out + s).length > 260) break;
    out += s;
    if (out.length > 140) break;
  }
  out = out.trim() || t;
  return out.length > 280 ? out.slice(0, 270).replace(/\s+\S*$/, '') + '…' : out;
}

// Google News RSS links point to Google; find the real article address
async function decodeGoogle(link) {
  const id = link.match(/\/articles\/([^?]+)/)?.[1];
  if (!id) return null;
  const page = await (await fetch(`https://news.google.com/rss/articles/${id}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) })).text();
  const sg = page.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = page.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sg || !ts) return null;
  const inner = JSON.stringify(['garturlreq', [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]);
  const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST',
    headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]])),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`google HTTP ${res.status}`);
  const line = (await res.text()).split('\n').find((l) => l.includes('garturlres'));
  return line ? JSON.parse(JSON.parse(line)[0][2])[1] : null;
}

// The page's own summary: og:description / twitter:description / description
async function pageSummary(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(10000), redirect: 'follow' });
  if (!res.ok) return '';
  const html = (await res.text()).slice(0, 400000);
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  const attr = (tag, name) => tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  const found = {};
  for (const m of metas) {
    const key = (attr(m, 'property') || attr(m, 'name'))?.slice(2).find(Boolean)?.toLowerCase();
    const val = attr(m, 'content')?.slice(2).find((x) => x !== undefined);
    if (key && val && !found[key]) found[key] = val;
  }
  return found['og:description'] || found['twitter:description'] || found['description'] || '';
}

// stories: ranked list; each has _members. cache: { [itemId]: { text, url?, at } } (mutated)
export async function fillSummaries(stories, cache, { maxFetch = 8, now = Date.now() } = {}) {
  // A site's generic blurb ("Get all the latest news from …") repeats on every article → not a summary
  const seen = new Map();
  for (const s of stories) for (const m of s._members) for (const t of [m.summary && shorten(m.summary, m.title), cache[m.id]?.text]) if (t) seen.set(t, (seen.get(t) || 0) + 1);
  const generic = (t) => (seen.get(t) || 0) >= 3;
  const todo = [];
  for (const s of stories) {
    const members = s._members;
    // 1) the feed's own description / something already fetched for any article in the story
    const rss = members.find((m) => m.summary && shorten(m.summary, m.title) && !generic(shorten(m.summary, m.title)));
    const cached = members.find((m) => cache[m.id]?.text && !generic(cache[m.id].text));
    if (rss) s.sum = { text: shorten(rss.summary, rss.title), lang: rss.lang, id: rss.id };
    else if (cached) s.sum = { text: cache[cached.id].text, lang: cached.lang, id: cached.id };
    if (cached && cache[cached.id].url) s.realLink = cache[cached.id].url;
    if (s.sum) continue;
    // 2) queue one article of this story for fetching (direct links first; skip recent failures)
    const pick = [...members]
      .sort((a, b) => (a.google ? 1 : 0) - (b.google ? 1 : 0) || b.weight - a.weight)
      .find((m) => !cache[m.id] || now - cache[m.id].at > RETRY_FAILED_MS);
    if (pick) todo.push([s, pick]);
  }
  let fetched = 0;
  for (const [s, m] of todo.slice(0, maxFetch)) {
    try {
      const url = m.google ? await decodeGoogle(m.link) : m.link;
      const text = url ? shorten(await pageSummary(url), m.title) : '';
      cache[m.id] = { text, url: m.google ? url : undefined, at: now };
      if (text) s.sum = { text, lang: m.lang, id: m.id };
      if (url && m.google) s.realLink = url;
      fetched++;
    } catch (e) {
      cache[m.id] = { text: '', at: now };
      if (/HTTP (429|403)/.test(e.message)) break; // Google is rate-limiting: stop for this run
    }
  }
  return fetched;
}
