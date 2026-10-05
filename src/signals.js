// Popularity signals for ranking ("traffic"), all free:
//   • Google Trends — what people are searching right now, with search volume, per country
//   • Reddit hot lists (r/soccer, r/nba) — what fans are voting up (best effort: Reddit rate-limits)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const TREND_GEOS = ['IL', 'GB', 'US', 'ES', 'IT', 'DE', 'FR', 'TR', 'GR', 'BR'];
const SUBREDDITS = ['soccer', 'nba', 'Euroleague'];
const REFRESH_MS = 15 * 60000;

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function trends() {
  const out = [];
  await Promise.all(
    TREND_GEOS.map(async (geo) => {
      try {
        const xml = await get(`https://trends.google.com/trending/rss?geo=${geo}`);
        for (const m of xml.matchAll(/<item>[\s\S]*?<title>([^<]*)<\/title>[\s\S]*?<ht:approx_traffic>([^<]*)<\/ht:approx_traffic>([\s\S]*?)<\/item>/g)) {
          const traffic = parseInt(m[2].replace(/[^\d]/g, ''), 10) || 0;
          // related news headlines help match terms written differently
          const news = [...m[3].matchAll(/<ht:news_item_title>([^<]*)<\/ht:news_item_title>/g)].map((x) => decode(x[1]));
          // their links tell whether the trend is about sport (sports sites / sports sections) — see trends.js
          const urls = [...m[3].matchAll(/<ht:news_item_url>([^<]*)<\/ht:news_item_url>/g)].map((x) => decode(x[1]));
          out.push({ term: decode(m[1]).toLowerCase(), traffic, geo, news, urls });
        }
      } catch {}
    })
  );
  return out;
}

async function reddit() {
  const out = [];
  for (const sub of SUBREDDITS) {
    try {
      const xml = await get(`https://www.reddit.com/r/${sub}/hot/.rss?limit=30`);
      [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].forEach((m, i) => {
        const title = m[1].match(/<title>([^<]*)<\/title>/)?.[1];
        const link = m[1].match(/<link href="([^"]+)"/)?.[1];
        if (title) out.push({ title: decode(title), rank: i + 1, sub, link: link ? decode(link) : null });
      });
    } catch {}
  }
  return out;
}

// Cached in state; refreshed every 15 minutes (keeps the previous list if a refresh fails)
export async function loadSignals(prev = {}, now = Date.now()) {
  if (prev.at && now - prev.at < REFRESH_MS) return prev;
  const [t, r] = await Promise.all([trends(), reddit()]);
  return { at: now, trends: t.length ? t : prev.trends || [], reddit: r.length ? r : prev.reddit || [] };
}
