// Telegram: posts to a channel the user owns (friends join the channel — no subscriber list to store).
// Needs TELEGRAM_BOT_TOKEN (GitHub secret) and TELEGRAM_CHAT (repository variable: "@channel_name" or "-100…");
// without them nothing is sent.
//
// - ☀️ Morning briefing once a day after 06:00 Israel time: the night's top stories (world first) + how the Israelis
//   abroad did. The same list is pinned on the site until noon (morningBrief → news.json "brief").
// - 🔔 Alerts (01:00–06:00 silently, without a sound): the stories at the top of the site's main page — a story is posted the first time it
//   is in the main page's top 10 (same order as the page), and reporters' scoops (🔴) at once. At most 4 per run,
//   12 an hour by day, 4 at night, 250 a day; every story / event once.

import { isScoop } from './editorial.js';

const API = 'https://api.telegram.org/bot';
const PER_RUN = 4;
// Spread over the day so the daily cap is never reached in practice: 19 day hours × 12 + 5 night hours × 4 = 248.
// The daily cap is a safety net against a bug flooding the channel. (Until 2026-10-25: 15 an hour, 120 a day, and
// the cap ran out by ~10:00.) When more stories wait than fit, the highest on the main page go first.
const PER_HOUR = 12;
const PER_HOUR_NIGHT = 4;
const PER_DAY = 250;
const QUIET = [1, 6]; // 01:00–05:59 Israel time: alerts still go out, but silently (no sound / vibration)
// competitions the editors follow (tag ids from src/entities.js)
const BRIEF_HOUR = 6; // the morning editor starts at 6

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const ilParts = (ts) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(ts).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
};

const icon = (s, hot = true) => `${hot && isScoop(s) ? '🔴 ' : ''}${s.israel ? '🇮🇱' : s.abroad ? '✈️' : '🌍'}${s.sport === 'football' ? '⚽' : s.sport === 'basketball' ? '🏀' : '🏅'}${hot && s.big ? '🔥' : ''}`;
// Hebrew headline: the model's, else a Hebrew article's, else the machine translation, else this run's translation
let heMap = new Map();
const titleHe = (s) => (s.lang === 'he' ? s.title : s.ai?.he?.title || s.t?.he?.title || heMap.get(s)) || s.title;

// The same event from another outlet / language is not a new post (Coventry 4-1 Newcastle went out 7 times on
// 2026-10-13). A story's fingerprint: its clubs / players, the words of its Hebrew headline, the scores in it.
const RECENT_H = 12;
const scoresIn = (t) => [...String(t).matchAll(/(\d{1,3})\s*[-–:]\s*(\d{1,3})/g)].map((m) => [m[1], m[2]].sort().join('-'));
export function fingerprint(s) {
  const he = titleHe(s) || '';
  return {
    ids: [...new Set([...(s.tags || []).filter((g) => g.k === 'team' || g.k === 'player' || g.k === 'a').map((g) => g.id), ...(s.athletes || [])])],
    words: [...new Set(he.replace(/[^\p{L}\d\s]/gu, ' ').split(/\s+/).filter((w) => w.length >= 3))],
    scores: [...new Set([he, s.title].flatMap(scoresIn))],
    // the subject the language model gave it ("Cristiano Ronaldo Al Nassr") and the numbers in the headline (981)
    about: [...new Set(String(s.aiDesk?.about || '').toLowerCase().split(/[^a-zÀ-ɏ]+/).filter((w) => w.length >= 4))],
    nums: [...new Set((he.match(/\d{2,}/g) || []).filter((n) => !/^20\d\d$/.test(n)))],
  };
}
export function sameEvent(a, b) {
  const shared = a.ids.filter((x) => b.ids.includes(x)).length;
  const inter = a.words.filter((w) => b.words.includes(w)).length;
  const jac = inter / Math.max(1, new Set([...a.words, ...b.words]).size);
  const sameScore = a.scores.some((x) => b.scores.includes(x));
  const sameAbout = (a.about || []).filter((w) => (b.about || []).includes(w)).length >= 2;
  const sameNum = (a.nums || []).some((n) => (b.nums || []).includes(n));
  return shared >= 2 || ((shared >= 1 || sameAbout) && (jac >= 0.25 || sameScore || sameNum)) || jac >= 0.5;
}
// not a story for a summary: a live-score update ("דקה 31: לבאנטה - סביליה 1:0", "Minute 31'") or a stream link
const LIVE_ITEM = /^\s*(דקה|minute|minuto|minuut|dakika|λεπτό)\s*\d+|\d+'\s*[:|-]|צפו בשידור|שידור חי|\blive\s*(stream|score|blog)?\s*[:|]|\bEN VIVO\b|\bUŽIVO\b|\bCANLI\b|ΖΩΝΤΑΝΑ/i;

// a foreign world story waits for the language model's verdict on what it is about (src/ai.js; the next run),
// so a misfiled non-sport item (an actor's obituary) or a routine one is not posted; after 15 minutes without a
// verdict (the model down / out of quota) it can go as before
const AI_WAIT_MS = 15 * 60000;
const needsVerdict = (s, now) =>
  (s.sport === 'football' || s.sport === 'basketball') && !s.aiDesk && !(s.israel || s.abroad || s.watchIsrael) && !(s.langs || []).includes('he') && now - s.first < AI_WAIT_MS;
const isHe = (t) => /[א-ת]/.test(t || '');
const storyKey = (s) => [...s._members].sort((a, b) => a.published - b.published || (a.id < b.id ? -1 : 1))[0].id;

function alertText(s, siteUrl, heName = new Map()) {
  const who = s.athletes?.length ? `👤 ${s.athletes.map((n) => heName.get(n) || n).join(', ')}\n` : '';
  const sum = s.ai?.he?.sum ? `\n${esc(s.ai.he.sum)}\n` : '';
  const more = s.sourceCount > 1 ? ` +${s.sourceCount - 1}` : '';
  const video = s.video ? ` · <a href="${esc(s.video)}">🎥 וידאו</a>` : '';
  // Sport5 status (the editors' first question)
  const s5 = !s.s5 ? '🔴 לא נמצאה התאמה בספורט 5' : s.s5.where === 'channel' ? '📱 רק בטלגרם/יוטיוב של ספורט 5 (לא באתר)' : s.s5.newer >= 2 ? `🟡 באתר ספורט 5 · ${s.s5.newer} פרסומים נוספים מאז` : s.s5.probable ? '☑️ כנראה באתר ספורט 5' : '✅ כבר באתר ספורט 5';
  const s5Line = s.s5 ? `<a href="${esc(s.s5.link)}">${s5}</a>` : s5;
  const he = titleHe(s);
  const head = isHe(s.title) || he === s.title ? `<b>${esc(he)}</b>` : `<b>${esc(s.title)}</b>\n🇮🇱 ${esc(he)}`;
  return `${icon(s)} ${head}\n${s5Line}\n${who}${sum}\n<a href="${esc(s.realLink || s.link)}">${esc(s.sources[0]?.name || '')}${more}</a>${video} · <a href="${esc(siteUrl)}">רדאר ספורט</a>`;
}

// One line per Israeli abroad who had a game in the last 24h
function abroadLines(athletes, cards, gameInfo, now) {
  const lines = [];
  for (const a of athletes) {
    const l = cards[a.name]?.last;
    if (!l || now - l.start > 24 * 3600e3 || l.start > now) continue;
    const name = a.name_he || a.name;
    const g = gameInfo[l.id]?.players?.[a.name];
    const home = l.home?.he || l.home?.name;
    const away = l.away?.he || l.away?.name;
    const score = l.score ? ` · ${home} ${l.score[0]}:${l.score[1]} ${away}` : '';
    // minutes on the clock count as played (a basketball bench player has no substitution event)
    if (!l.played && !(g?.min > 0 && !g?.dnp)) {
      const why = g?.reason || '';
      lines.push(`▫️ ${esc(name)} — לא שיחק${why ? ` (${esc(why)})` : ''}${esc(score)}`);
      continue;
    }
    const bits = [];
    if (g?.goals?.length) bits.push(`⚽ ${g.goals.length > 1 ? `×${g.goals.length}` : g.goals[0]}`);
    if (g?.assists?.length) bits.push(`🅰️ ${g.assists.length > 1 ? `×${g.assists.length}` : g.assists[0]}`);
    if (g?.box) bits.push(`${g.box.pts} נק' · ${g.box.reb} ריב' · ${g.box.ast} אס'`);
    if (l.minutes || g?.min > 0) bits.push(`${l.minutes || g.min} דק'`);
    if (l.rating) bits.push(`ציון ${l.rating}`);
    lines.push(`${a.sport === 'basketball' ? '🏀' : '⚽'} <b>${esc(name)}</b> — ${esc(bits.join(' · ') || 'שיחק')}${esc(score)}`);
  }
  return lines;
}

// ---------- the main page ("ראשי") ----------
// The channel follows the site: a story is posted when it first reaches the top of the main page. Same rules as the
// page (public/app.js: inTab 'top', foreignOnly, the off-beat filter, rankMix at the default slider 50): stories
// with a foreign report (Israeli-only ones are in "Israeli monitoring", not on the main page), football / basketball
// or a big other-sport story, not local / minor / low; ordered by half the editorial rank, half newness.
export const MAIN_TOP = 10;
const onMainPage = (s) => {
  const src = s.sources || [];
  if (src.some((x) => x.o === 'il') && !src.some((x) => x.o !== 'il')) return false; // Israeli sites only
  if (src.some((x) => x.o === 'il') && !s.fv) return false;
  return (s.sport !== 'other' || s.big) && !s.local && !s.low && !s.minor;
};
export const mainScore = (s, now) => 0.5 * ((s.ed?.score ?? 0) / 100) + 0.5 * Math.exp(-(now - s.first) / (6 * 3600e3));
export function mainPage(stories, now) {
  return stories.filter(onMainPage).sort((a, b) => mainScore(b, now) - mainScore(a, now));
}

// The night's 10 biggest stories (since ~21:00): world first — at most 3 Israeli ones
export function briefingTop(stories, now) {
  const rank = (s) => s.ed?.score ?? 0; // the main page's editorial rank (src/rank.js)
  let il = 0;
  // one place per event (2026-10-13: Coventry - Newcastle took 3 of the 10: the preview, a live update, the result),
  // the result rather than the preview; no live-score updates or "watch the stream" items
  const picked = [];
  for (const s of stories
    .filter((s) => onMainPage(s) && !s.dateUnknown && now - s.first < 10 * 3600e3)
    .filter((s) => !LIVE_ITEM.test(titleHe(s) || '') && !LIVE_ITEM.test(s.title || ''))
    .sort((a, b) => rank(b) - rank(a))) {
    const fp = fingerprint(s);
    const i = picked.findIndex((p) => sameEvent(p.fp, fp));
    if (i < 0) picked.push({ s, fp });
    else if (!picked[i].fp.scores.length && fp.scores.length) picked[i] = { s, fp }; // the result replaces the preview
  }
  return picked
    .map((p) => p.s)
    .filter((s) => !s.israel || ++il <= 3)
    .slice(0, 10);
}
// For the site: the morning's list, fixed once a day at the first run after 06:00; kept until noon
export function morningBrief(stories, prev, now) {
  const il = ilParts(now);
  if (il.hour < BRIEF_HOUR || il.hour >= 12) return null;
  if (prev?.day === il.day) return prev;
  const ids = briefingTop(stories, now).map((s) => s.id);
  return ids.length >= 3 ? { day: il.day, at: now, ids } : null;
}
function briefingText(top, athletes, cards, gameInfo, now, siteUrl) {
  const lines = top.map((s) => `${icon(s, false)} <a href="${esc(s.realLink || s.link)}">${esc(titleHe(s))}</a>`);
  const abroad = abroadLines(athletes, cards, gameInfo, now);
  return `☀️ <b>בוקר טוב — מה קרה בלילה בעולם</b>\n\n${lines.join('\n')}${abroad.length ? `\n\n✈️ <b>הליגיונרים</b>\n${abroad.join('\n')}` : ''}\n\n<a href="${esc(siteUrl)}">לכל החדשות ברדאר ספורט</a>`;
}

async function send(token, chat, text, preview, silent = false) {
  const res = await fetch(`${API}${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', link_preview_options: { is_disabled: !preview }, ...(silent ? { disable_notification: true } : {}) }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram ${res.status}: ${j.description || 'error'}`);
}

// prev = { sent: { key: at }, hour: [ts…], day, dayCount, briefDay, error }
export async function telegramPost(stories, { athletes, cards, gameInfo, siteUrl, translate }, prev = {}, now = Date.now()) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT;
  const st = { sent: { ...(prev.sent || {}) }, hour: (prev.hour || []).filter((t) => now - t < 3600e3), day: prev.day, dayCount: prev.dayCount || 0, briefDay: prev.briefDay, rule: prev.rule, error: null };
  for (const [k, t] of Object.entries(st.sent)) if (now - t > 3 * 864e5) delete st.sent[k];
  st.recent = (prev.recent || []).filter((r) => now - r.at < RECENT_H * 3600e3); // what was posted: fingerprints
  if (!token || !chat) return { tg: { ...st, error: 'no TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT' }, posted: 0 };

  // once per channel: check (without posting) that the bot is an admin that may post there
  Object.assign(st, { chatOk: prev.chatOk, chatTitle: prev.chatTitle, chatFor: prev.chatFor });
  if (!(st.chatOk && st.chatFor === chat)) {
    try {
      const api = (m, q = '') => fetch(`${API}${token}/${m}${q}`, { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
      const me = await api('getMe');
      const info = await api('getChat', `?chat_id=${encodeURIComponent(chat)}`);
      const member = me.ok && (await api('getChatMember', `?chat_id=${encodeURIComponent(chat)}&user_id=${me.result.id}`));
      const canPost = member?.ok && (member.result.status === 'creator' || (member.result.status === 'administrator' && member.result.can_post_messages !== false));
      if (!me.ok) throw new Error(`bot token rejected: ${me.description}`);
      if (!info.ok) throw new Error(`channel not found / bot not in it: ${info.description}`);
      if (!canPost) throw new Error(`bot is not an admin with "post messages" in ${chat}`);
      Object.assign(st, { chatOk: true, chatTitle: info.result.title, chatFor: chat });
    } catch (e) {
      return { tg: { ...st, chatOk: false, error: String(e.message).slice(0, 200) }, posted: 0 };
    }
  }

  const il = ilParts(now);
  if (st.day !== il.day) Object.assign(st, { day: il.day, dayCount: 0 });
  let posted = 0;
  try {
    const wantBrief = il.hour >= BRIEF_HOUR && il.hour < 12 && st.briefDay !== il.day;
    const brief = wantBrief ? briefingTop(stories, now) : [];
    const keyOf = new Map(stories.map((s) => [s, storyKey(s)]));
    const firstRun = !prev.sent; // don't flood the channel with everything that's already there
    // What goes out: a story the first time it is in the main page's top MAIN_TOP (up to 3 hours old), and a reporter's
    // scoop at once (up to 90 minutes old) even before it climbs. In the order of the main page, scoops first.
    const page = mainPage(stories, now);
    const pos = new Map(page.map((s, i) => [s, i]));
    const top = new Set(page.slice(0, MAIN_TOP));
    const fresh = stories
      .filter((s) => !st.sent[keyOf.get(s)] && !s.dateUnknown && pos.has(s) && ((top.has(s) && now - s.first < 3 * 3600e3) || (isScoop(s) && now - s.first < 90 * 60000)))
      .sort((a, b) => (isScoop(b) ? 1 : 0) - (isScoop(a) ? 1 : 0) || pos.get(a) - pos.get(b));
    // Hebrew for headlines that only exist in English (one batch per run)
    heMap = new Map();
    const needHe = [...new Set([...brief, ...fresh.slice(0, PER_RUN * 2)])].filter((s) => !isHe(titleHe(s)));
    if (translate && needHe.length) {
      try {
        const out = await translate(needHe.map((s) => s.title));
        needHe.forEach((s, i) => out[i] && heMap.set(s, out[i]));
      } catch {}
    }
    // ☀️ morning briefing
    if (wantBrief) {
      await send(token, chat, briefingText(brief, athletes, cards, gameInfo, now, siteUrl), false);
      st.briefDay = il.day;
      posted++;
    }
    // 🔔 alerts
    const switching = prev.rule !== 'main-top';
    st.rule = 'main-top';
    if (firstRun || switching) fresh.forEach((s) => (st.sent[keyOf.get(s)] = now)); // first run / the switch to the main-page rule: no flood
    else {
      const silent = il.hour >= QUIET[0] && il.hour < QUIET[1]; // at night: posted without a sound
      const room = Math.min(PER_RUN, (silent ? PER_HOUR_NIGHT : PER_HOUR) - st.hour.length, PER_DAY - st.dayCount);
      let left = Math.max(0, room);
      for (const s of fresh.filter((x) => !needsVerdict(x, now))) {
        if (!left) break;
        const fp = fingerprint(s);
        if (st.recent.some((r) => sameEvent(fp, r))) {
          st.sent[keyOf.get(s)] = now; // already posted from another outlet: never post it
          continue;
        }
        await send(token, chat, alertText(s, siteUrl, new Map((athletes || []).map((a) => [a.name, a.name_he || a.name]))), true, silent);
        st.sent[keyOf.get(s)] = now;
        st.recent.push({ ...fp, at: now });
        st.hour.push(now);
        st.dayCount++;
        posted++;
        left--;
      }
    }
    // stories that were worth it but didn't fit stay unsent; once older than 90 minutes they're dropped
  } catch (e) {
    st.error = String(e.message).slice(0, 200);
  }
  return { tg: st, posted };
}

// ---------- admin alerts ----------
// Private messages to the person running the radar (TELEGRAM_ADMIN_CHAT = their Telegram user id; they must have
// pressed Start in the bot once). A source that hasn't succeeded for 2 hours is reported once a day.
const DOWN_AFTER = 2 * 3600e3;
export async function adminHealthAlerts(health, prev = {}, now = Date.now()) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const admin = process.env.TELEGRAM_ADMIN_CHAT;
  const sent = Object.fromEntries(Object.entries(prev).filter(([, at]) => now - at < 24 * 3600e3));
  if (!token || !admin) return sent;
  let down = health.filter((h) => !h.ok && h.failStreak >= 3 && (!h.lastOk || now - h.lastOk > DOWN_AFTER) && !sent[h.id]);
  // YouTube's RSS failing for most channels at once is an outage on YouTube's side: one message, not one per channel
  const yt = health.filter((h) => h.id.startsWith('yt-'));
  const ytDown = yt.filter((h) => !h.ok && h.failStreak >= 3);
  if (yt.length >= 4 && ytDown.length >= yt.length / 2) {
    if (!sent['yt-outage']) {
      await send(token, admin, `⚠️ <b>רדאר ספורט: יוטיוב לא זמין</b>\nפידי היוטיוב לא עונים ב-${ytDown.length} מתוך ${yt.length} ערוצים (${esc(ytDown[0].error || 'error')}). זו כנראה תקלה בצד של יוטיוב — האתר ממשיך לעבוד בלי סרטונים. לא תקבל על זה הודעה נוספת היום.`, false);
      sent['yt-outage'] = now;
    }
    for (const h of yt) sent[h.id] = sent[h.id] || now;
    down = down.filter((h) => !h.id.startsWith('yt-'));
  }
  if (!down.length) return sent;
  const lines = down.slice(0, 15).map((h) => `• ${esc(h.name)} (${esc(h.id)}): ${esc(h.error || 'error')}${h.lastOk ? ` — הצלחה אחרונה לפני ${Math.round((now - h.lastOk) / 3600e3)} שע׳` : ' — לא הצליח מעולם'}`);
  await send(token, admin, `⚠️ <b>רדאר ספורט: מקורות לא עובדים</b>\n${lines.join('\n')}${down.length > 15 ? `\n…ועוד ${down.length - 15}` : ''}`, false);
  for (const h of down) sent[h.id] = now;
  return sent;
}

// One-time "alerts connected" message when TELEGRAM_ADMIN_CHAT is first set (or changed); returns the chat greeted
export async function adminHello(prevChat) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const admin = process.env.TELEGRAM_ADMIN_CHAT;
  if (!token || !admin || prevChat === admin) return prevChat || null;
  await send(token, admin, '✅ <b>רדאר ספורט: התראות המערכת מחוברות</b>\nתקבל כאן הודעה אם מקור לא עובד יותר משעתיים או אם ריצת איסוף נכשלת.', false);
  return admin;
}

// A plain private message to the admin (no-op without the bot token / admin chat)
export async function adminSend(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const admin = process.env.TELEGRAM_ADMIN_CHAT;
  if (!token || !admin) return false;
  await send(token, admin, text, false);
  return true;
}

// 📣 Editors' reports → the admin's private chat
export async function adminReports(reports) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const admin = process.env.TELEGRAM_ADMIN_CHAT;
  if (!token || !admin || !reports.length) return 0;
  for (const r of reports.slice(0, 10)) {
    const who = r.name ? esc(r.name) : 'עורך';
    await send(token, admin, `📣 <b>דיווח מ${who}</b>${r.page ? ` <i>(${esc(r.page)})</i>` : ''}\n${esc(r.text)}${r.link ? `\n${esc(r.link)}` : ''}`, false);
  }
  return Math.min(reports.length, 10);
}
