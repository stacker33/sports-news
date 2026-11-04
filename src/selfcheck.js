// 🩺 The radar watches itself: a private Telegram message to the admin when something stops working quietly
// (2026-10-25: the channel's daily cap ran out by ~10:00 and nobody knew until the admin noticed the silence).
// Each problem at most once per Israel day; the message says what, since when, and what usually helps.

import { ilParts, PER_DAY } from './telegram.js';

const QUIET_HOURS = 2; // daytime without a channel post
const DAY_FROM = 8; // Israel time: the check for a quiet channel runs 08:00–22:59
const DAY_TO = 23;
const SLOW_MS = 6 * 60e3; // a run's limit is 8 minutes

// facts: { now, tg, ai, stateFrom, tookMs }; prev: { [key]: day } → { selfAlerts, message }
export function selfCheck(facts, prev = {}) {
  const { now, tg = {}, ai = {}, stateFrom = null, tookMs = 0 } = facts;
  const il = ilParts(now);
  const issues = [];
  if (tg.error) issues.push(['tg-error', `📵 ערוץ הטלגרם לא מפרסם: ${tg.error}`]);
  if (!tg.error && il.hour >= DAY_FROM && il.hour < DAY_TO && tg.lastPost && now - tg.lastPost > QUIET_HOURS * 3600e3)
    issues.push(['tg-quiet', `🔕 הערוץ לא פרסם כבר ${Math.floor((now - tg.lastPost) / 3600e3)} שעות, בשעות היום. אם אין סיבה ברורה (יום שקט מאוד), כדאי לבדוק.`]);
  if ((tg.dayCount || 0) >= PER_DAY * 0.9) issues.push(['tg-cap', `📈 הערוץ קרוב למגבלה היומית: ${tg.dayCount} מתוך ${PER_DAY} פרסומים היום.`]);
  if (stateFrom === 'backup' || stateFrom === 'site')
    issues.push(['state', `🗂️ הזיכרון של הרדאר נטען מ${stateFrom === 'backup' ? 'הגיבוי היומי' : 'האתר'} ולא מהעותק העדכני. הרדאר ממשיך לעבוד; ייתכן שחסרות ידיעות מהשעות האחרונות.`]);
  if (ai.error) issues.push(['ai', `🤖 סיכומי ה-AI לא פעילים: ${ai.error}. האתר ממשיך עם תרגום רגיל.`]);
  if (tookMs > SLOW_MS) issues.push(['slow', `⏱️ עדכון ארך ${Math.round(tookMs / 60e3)} דקות (המגבלה 8). אם זה חוזר, עדכונים עלולים להיכשל.`]);

  const selfAlerts = Object.fromEntries(Object.entries(prev).filter(([, day]) => day === il.day));
  const fresh = issues.filter(([k]) => !selfAlerts[k]);
  for (const [k] of fresh) selfAlerts[k] = il.day;
  const message = fresh.length ? `🩺 <b>רדאר ספורט: בדיקה עצמית</b>\n${fresh.map(([, t]) => `• ${t.replace(/[<>&]/g, '')}`).join('\n')}\n<i>הודעה אחת ביום לכל בעיה.</i>` : null;
  return { selfAlerts, message };
}
