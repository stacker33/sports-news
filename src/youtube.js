// YouTube as a source — a short, curated list of official channels read through their free feeds
// (youtube.com/feeds/videos.xml?channel_id=…: latest 15 videos, no key, no quota). Never a YouTube search.
//
// Only some videos are worth showing:
//   press   — press conferences, interviews, reactions, announcements → kept
//   highlights — kept from Israeli channels; from the big global ones (NBA, EuroLeague) only if an Israeli
//               club or player is in it (decided in collect.js, after tagging)
//   everything else (Shorts, compilations, top-10s, live streams, podcasts, archive games…) → dropped
// Videos then go through the normal clustering: a video about a story already in the feed joins that story
// (shown as 🎥 on its card); a video on its own needs an Israeli angle or a known team/player (source "assist").

export const ytFeed = (channelId) => `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

const DROP = /#shorts|\btop ?\d+\b|\bevery (goal|nets|player)\b|\ball (the )?goals\b|compilation|\bskills\b|\bgotm\b|goal of the month|\blive\b|🔴|🚨|full game|full match|משחק מלא|שידור חי|podcast|פודקאסט|\bepisode\b|\bep\.? ?\d|פרק \d|\btapes\b|behind the scenes|\bvlog\b|\bwomen\b|vrouwen|\b[uo]1[6-9]\b|\b[uo]2[13]\b|academy|נשים|נוער|ילדים|unboxing|giveaway|\bkit\b|\bmerch|\bticket|\bpredict|\bquiz\b|reaction video|\bmic'?d up\b|הרמת כוסית|ראש השנה|חגיגות|\bwsl\b|כל השערים שלנו|לפי סדר השערים|ללא שדרים|^\d+ שערים|\b(19\d\d|[5-9]\d\/[5-9]\d)\b/i;
const PRESS = /press conference|news conference|media availability|media day|\binterview|\breacts?\b|\breaction\b|\bspeaks\b|\bexplains\b|\bon why\b|announce|\bofficial\b|\bsigns\b|signing|injury|update|pre-?match|post-?match|post-?game|pre-?game|מסיבת עיתונאים|מסע["״]?ת|ראיון|מדבר|הצהרה|רשמי|פציעה|חתם|לקראת|אחרי המשחק|לאחר/i;
const HIGHLIGHTS = /highlights|extended|\bhl\b|samenvatting|תקציר|השערים|כל השערים מהמשחק|\d+\s*[-:]\s*\d+/i;

// 'press' | 'highlights' | null (drop)
export function videoKind(title) {
  if (!title || DROP.test(title)) return null;
  if (PRESS.test(title)) return 'press';
  if (HIGHLIGHTS.test(title)) return 'highlights';
  return null;
}

// Backup for when YouTube's feeds are down (they sometimes answer 404 for every channel): the channel's
// public "Videos" page carries the same latest uploads in its embedded data. Ages there are relative
// ("3 hours ago", "1d ago"), so the times are approximate.
export const ytPage = (channelId) => `https://www.youtube.com/channel/${channelId}/videos?hl=en&gl=US`;

const UNIT = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3, w: 7 * 86400e3, mo: 30 * 86400e3, y: 365 * 86400e3 };
export function relAge(s, now = Date.now()) {
  const m = String(s || '').match(/(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|wk?s?|w|months?|mo|years?|yrs?|y)\b\s*ago/i);
  if (!m) return null;
  const u = m[2].toLowerCase();
  const k = u.startsWith('mo') ? 'mo' : u.startsWith('mi') || u === 'm' ? 'm' : u[0];
  return now - Number(m[1]) * UNIT[k];
}

export function parseChannelPage(html, now = Date.now()) {
  const raw = html.match(/var ytInitialData\s*=\s*(\{.*?\});\s*<\/script>/s)?.[1];
  if (!raw) return [];
  let data;
  try { data = JSON.parse(raw); } catch { return []; }
  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
  const grid = tabs.find((t) => t.tabRenderer?.selected)?.tabRenderer?.content?.richGridRenderer?.contents || [];
  const out = [];
  for (const it of grid) {
    const c = it.richItemRenderer?.content || {};
    const l = c.lockupViewModel;
    const v = c.videoRenderer;
    let id, title, age, image;
    if (l) {
      const md = l.metadata?.lockupMetadataViewModel;
      id = l.contentId;
      title = md?.title?.content;
      age = (md?.metadata?.contentMetadataViewModel?.metadataRows || []).flatMap((r) => r.metadataParts || []).map((p) => p.text?.content || '').find((x) => /ago/i.test(x));
      image = l.contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url;
    } else if (v) {
      id = v.videoId;
      title = v.title?.runs?.map((r) => r.text).join('');
      age = v.publishedTimeText?.simpleText;
      image = v.thumbnail?.thumbnails?.[0]?.url;
    }
    if (!id || !title) continue;
    out.push({ id, title, published: relAge(age, now), image: image ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null });
  }
  return out.slice(0, 15);
}
