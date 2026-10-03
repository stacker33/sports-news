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

const DROP = /#shorts|\btop ?\d+\b|\bevery (goal|nets|player)\b|\ball (the )?goals\b|compilation|\bskills\b|\bgotm\b|goal of the month|\blive\b|🔴|🚨|full game|full match|משחק מלא|שידור חי|podcast|פודקאסט|\bepisode\b|\bep\.? ?\d|פרק \d|\btapes\b|behind the scenes|\bvlog\b|\bwomen\b|vrouwen|\bu1[6-9]\b|\bu2[13]\b|academy|נשים|נוער|ילדים|unboxing|giveaway|\bkit\b|\bmerch|\bticket|\bpredict|\bquiz\b|reaction video|\bmic'?d up\b|הרמת כוסית|ראש השנה|חגיגות|\bwsl\b|כל השערים שלנו|לפי סדר השערים|ללא שדרים|^\d+ שערים|\b(19\d\d|[5-9]\d\/[5-9]\d)\b/i;
const PRESS = /press conference|news conference|media availability|media day|\binterview|\breacts?\b|\breaction\b|\bspeaks\b|\bexplains\b|\bon why\b|announce|\bofficial\b|\bsigns\b|signing|injury|update|pre-?match|post-?match|post-?game|pre-?game|מסיבת עיתונאים|מסע["״]?ת|ראיון|מדבר|הצהרה|רשמי|פציעה|חתם|לקראת|אחרי המשחק|לאחר/i;
const HIGHLIGHTS = /highlights|extended|\bhl\b|samenvatting|תקציר|השערים|כל השערים מהמשחק|\d+\s*[-:]\s*\d+/i;

// 'press' | 'highlights' | null (drop)
export function videoKind(title) {
  if (!title || DROP.test(title)) return null;
  if (PRESS.test(title)) return 'press';
  if (HIGHLIGHTS.test(title)) return 'highlights';
  return null;
}
