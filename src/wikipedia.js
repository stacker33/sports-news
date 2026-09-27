// Wikipedia attention (free Wikimedia pageview API). Daily data, so it reflects yesterday.
//   • Top-viewed articles on English + Hebrew Wikipedia, with the change vs the day before
//   • Every Israeli abroad: yesterday's views vs their normal level (e.g. ×200 after a red card)
const UA = 'SportsRadar/1.0 (https://github.com/stacker33/sports-news)';
const REFRESH_MS = 60 * 60000;
const WIKIS = [
  { wiki: 'en', min: 20000 },
  { wiki: 'he', min: 1500 },
];
const SKIP = /^(Main_Page|עמוד_ראשי|Special:|Wikipedia:|Portal:|File:|Help:|מיוחד:|ויקיפדיה:|קובץ:|פורטל:)/;

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
const ymd = (d, sep = '/') => [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, '0'), String(d.getUTCDate()).padStart(2, '0')].join(sep);
const daysAgo = (n, now) => new Date(now - n * 86400e3);

async function topList(wiki, day) {
  const j = await getJson(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${wiki}.wikipedia/all-access/${ymd(day)}`);
  return j.items?.[0]?.articles || [];
}

async function topArticles(now) {
  const out = [];
  for (const { wiki, min } of WIKIS) {
    // yesterday's list may not be published yet early in the day → fall back one day
    let y = [], before = [];
    for (const back of [1, 2]) {
      try {
        y = await topList(wiki, daysAgo(back, now));
        before = await topList(wiki, daysAgo(back + 1, now)).catch(() => []);
        break;
      } catch {}
    }
    const prev = new Map(before.map((a) => [a.article, a.views]));
    for (const a of y) {
      if (a.views < min || SKIP.test(a.article)) continue;
      const title = a.article.replace(/_/g, ' ');
      if (!title.includes(' ')) continue; // single words ("Israel", "Sukkot") match too much
      out.push({ wiki, title, views: a.views, prev: prev.get(a.article) || 0 });
    }
  }
  return out;
}

// Find the Wikipedia article for an athlete (cached)
async function resolveTitle(wiki, query) {
  const j = await getJson(`https://${wiki}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=${encodeURIComponent(query)}`);
  return j.query?.search?.[0]?.title || null;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const PER_RUN = 2; // athletes refreshed per run, gently (Wikimedia rate-limits bursts)

// Updates `cache` ({ [name]: { at, views, normal, ratio } }) for a few athletes whose data is older than an hour.
async function athleteViews(athletes, titles, cache, now) {
  const start = ymd(daysAgo(16, now), ''), end = ymd(daysAgo(1, now), '');
  const stale = athletes.filter((a) => !cache[a.name] || now - cache[a.name].at > REFRESH_MS).slice(0, PER_RUN);
  for (const a of stale) {
    let yesterday = 0, normal = 0;
    for (const [wiki, name, hint] of [['en', a.name, a.sport === 'basketball' ? 'basketball' : 'footballer'], ['he', a.name_he, '']]) {
      if (!name) continue;
      const key = `${wiki}|${name}`;
      if (titles[key] === undefined) {
        titles[key] = await resolveTitle(wiki, `${name} ${hint}`.trim()); // throws on 429 → stop this run
        await pause(1500);
      }
      if (!titles[key]) continue;
      const j = await getJson(
        `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${wiki}.wikipedia/all-access/user/${encodeURIComponent(titles[key].replace(/ /g, '_'))}/daily/${start}/${end}`
      ).catch((e) => (/HTTP 404/.test(e.message) ? { items: [] } : Promise.reject(e)));
      await pause(1500);
      const views = (j.items || []).map((x) => x.views);
      if (!views.length) continue;
      const last = views[views.length - 1];
      const past = views.slice(0, -1).sort((x, y) => x - y);
      yesterday += last;
      normal += past.length ? past[Math.floor(past.length / 2)] : last; // median of the previous days
    }
    cache[a.name] = { at: now, views: yesterday, normal, ratio: yesterday ? Math.round((yesterday / Math.max(normal, 20)) * 10) / 10 : 0 };
  }
}

export async function loadWikipedia(prev = {}, athletes = [], now = Date.now()) {
  if (prev.cooldownUntil && now < prev.cooldownUntil) return prev;
  const out = { ...prev, titles: prev.titles || {}, athletes: { ...(prev.athletes || {}) } };
  // forget athletes removed from the list
  const names = new Set(athletes.map((a) => a.name));
  for (const n of Object.keys(out.athletes)) if (!names.has(n)) delete out.athletes[n];
  try {
    if (!prev.topAt || now - prev.topAt > REFRESH_MS) {
      out.top = await topArticles(now);
      out.topAt = now;
    }
    await athleteViews(athletes, out.titles, out.athletes, now);
  } catch (e) {
    if (/HTTP 429/.test(e.message)) out.cooldownUntil = now + 10 * 60000; // back off
  }
  return out;
}
