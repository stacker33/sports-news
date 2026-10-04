// Telegram: posts to a channel the user owns (friends join the channel — no subscriber list to store).
// Needs TELEGRAM_BOT_TOKEN (GitHub secret) and TELEGRAM_CHAT (repository variable: "@channel_name" or "-100…");
// without them nothing is sent.
//
// - ☀️ Morning briefing once a day after 08:00 Israel time: the night's top stories + how the Israelis abroad did.
// - 🔔 Alerts (not 01:00–06:00), world news first: reporters' scoops (🔴), stories spreading across countries /
//   trending, the big leagues / Champions League / NBA / EuroLeague, important Israeli and Israelis-abroad news; the biggest
//   world stories. At most 3 per run, 8 per hour, 40 per day; every story once.

const API = 'https://api.telegram.org/bot';
const PER_RUN = 4;
const PER_HOUR = 15;
const PER_DAY = 120;
const QUIET = [1, 6]; // no alerts from 01:00 to 05:59 Israel time
// competitions the editors follow (tag ids from src/entities.js)
const MAJOR = new Set(['c-ucl', 'c-uel', 'c-epl', 'c-laliga', 'c-seriea', 'c-bundes', 'c-ligue1', 'c-nba', 'c-euroleague', 'c-wc', 'c-unl']);
const BRIEF_HOUR = 8;

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ilParts = (ts) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(ts).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
};

const icon = (s, hot = true) => `${hot && isScoop(s) ? '🔴 ' : ''}${s.israel ? '🇮🇱' : s.abroad ? '✈️' : '🌍'}${s.sport === 'football' ? '⚽' : s.sport === 'basketball' ? '🏀' : '🏅'}${hot && s.big ? '🔥' : ''}`;
// Hebrew headline: the model's, else a Hebrew article's, else the machine translation, else this run's translation
let heMap = new Map();
// a reporter's own post (Romano, Shams, Ornstein…) about a signing / injury / official news
const SCOOP = /here we go|official|confirmed|agreed|agreement|deal (done|agreed)|signs|signed|completes?|medical|exclusive|breaking|ruled out|injur|sacked|fired|appointed|traded|trade|waived|extension|רשמי|חתם|סוכם|הסכם|בלעדי|נפצע|פוטר|מונה/i;
const isScoop = (s) => (s.social || []).some((p) => !/[א-ת]/.test(p)) && SCOOP.test(s.title);
const major = (s) => s.tags?.some((g) => MAJOR.has(g.id));
// how much an editor wants this right now (world stories are first-class)
const urgency = (s) => s.score + (!s.s5 || s.s5.probable || s.s5.where === 'channel' ? 2 : 0) + (s.s5?.newer >= 2 ? 1 : 0) + (isScoop(s) ? 6 : 0) + (s.trending || s.reddit || s.wikipedia ? 3 : 0) + (s.langs?.length >= 3 ? 2 : 0) + (major(s) ? 1.5 : 0);
const titleHe = (s) => s.ai?.he?.title || s.t?.he?.title || heMap.get(s) || s.title;
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
    if (!l.played) {
      const why = g?.reason || '';
      lines.push(`▫️ ${esc(name)} — לא שיחק${why ? ` (${esc(why)})` : ''}${esc(score)}`);
      continue;
    }
    const bits = [];
    if (g?.goals) bits.push(`⚽ ${g.goals}`);
    if (g?.assists) bits.push(`🅰️ ${g.assists}`);
    if (l.minutes) bits.push(`${l.minutes} דק'`);
    if (l.rating) bits.push(`ציון ${l.rating}`);
    lines.push(`${a.sport === 'basketball' ? '🏀' : '⚽'} <b>${esc(name)}</b> — ${esc(bits.join(' · ') || 'שיחק')}${esc(score)}`);
  }
  return lines;
}

function briefingTop(stories, now) {
  return stories
    .filter((s) => now - s.first < 12 * 3600e3 && (s.sport !== 'other' || s.big))
    .sort((a, b) => (b.pop ?? b.score) + (b.langs?.length >= 3 ? 2 : 0) - ((a.pop ?? a.score) + (a.langs?.length >= 3 ? 2 : 0)))
    .slice(0, 10);
}
function briefingText(top, athletes, cards, gameInfo, now, siteUrl) {
  const lines = top.map((s) => `${icon(s, false)} <a href="${esc(s.realLink || s.link)}">${esc(titleHe(s))}</a>`);
  const abroad = abroadLines(athletes, cards, gameInfo, now);
  return `☀️ <b>בוקר טוב — מה קרה בלילה</b>\n\n${lines.join('\n')}${abroad.length ? `\n\n✈️ <b>הישראלים בחו"ל</b>\n${abroad.join('\n')}` : ''}\n\n<a href="${esc(siteUrl)}">לכל החדשות ברדאר ספורט</a>`;
}

async function send(token, chat, text, preview) {
  const res = await fetch(`${API}${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', link_preview_options: { is_disabled: !preview } }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram ${res.status}: ${j.description || 'error'}`);
}

// prev = { sent: { key: at }, hour: [ts…], day, dayCount, briefDay, error }
export async function telegramPost(stories, { athletes, cards, gameInfo, siteUrl, translate }, prev = {}, now = Date.now()) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT;
  const st = { sent: { ...(prev.sent || {}) }, hour: (prev.hour || []).filter((t) => now - t < 3600e3), day: prev.day, dayCount: prev.dayCount || 0, briefDay: prev.briefDay, error: null };
  for (const [k, t] of Object.entries(st.sent)) if (now - t > 3 * 864e5) delete st.sent[k];
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
    const top = wantBrief ? briefingTop(stories, now) : [];
    const keyOf = new Map(stories.map((s) => [s, storyKey(s)]));
    const firstRun = !prev.sent; // don't flood the channel with everything that's already there
    const worth = (s) =>
      isScoop(s) || // reporters' scoops, at once
      (s.sport !== 'other' && (s.big || s.trending || s.langs?.length >= 3 || (major(s) && s.sourceCount >= 3))) || // world: spreading / big leagues
      (s.sport === 'other' && s.big && s.sourceCount >= 6) || // other sports: only the biggest
      (s.abroad && (s.sourceCount >= 2 || s.social?.length)) ||
      (s.israel && (s.big || s.sourceCount >= 4 || (s.breaking && s.sourceCount >= 2)));
    const fresh = stories.filter((s) => !st.sent[keyOf.get(s)] && !s.dateUnknown && now - s.first < 90 * 60000 && worth(s));
    // Hebrew for headlines that only exist in English (one batch per run)
    heMap = new Map();
    const needHe = [...new Set([...top, ...fresh.slice(0, PER_RUN * 2)])].filter((s) => !isHe(titleHe(s)));
    if (translate && needHe.length) {
      try {
        const out = await translate(needHe.map((s) => s.title));
        needHe.forEach((s, i) => out[i] && heMap.set(s, out[i]));
      } catch {}
    }
    // ☀️ morning briefing
    if (wantBrief) {
      await send(token, chat, briefingText(top, athletes, cards, gameInfo, now, siteUrl), false);
      st.briefDay = il.day;
      posted++;
    }
    // 🔔 alerts
    if (firstRun) fresh.forEach((s) => (st.sent[keyOf.get(s)] = now));
    else if (il.hour < QUIET[0] || il.hour >= QUIET[1]) {
      const room = Math.min(PER_RUN, PER_HOUR - st.hour.length, PER_DAY - st.dayCount);
      for (const s of fresh.sort((a, b) => urgency(b) - urgency(a)).slice(0, Math.max(0, room))) {
        await send(token, chat, alertText(s, siteUrl, new Map((athletes || []).map((a) => [a.name, a.name_he || a.name]))), true);
        st.sent[keyOf.get(s)] = now;
        st.hour.push(now);
        st.dayCount++;
        posted++;
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
  const down = health.filter((h) => !h.ok && h.failStreak >= 3 && (!h.lastOk || now - h.lastOk > DOWN_AFTER) && !sent[h.id]);
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
