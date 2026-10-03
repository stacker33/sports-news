// Telegram: posts to a channel the user owns (friends join the channel — no subscriber list to store).
// Needs TELEGRAM_BOT_TOKEN (GitHub secret) and TELEGRAM_CHAT (repository variable: "@channel_name" or "-100…");
// without them nothing is sent.
//
// - ☀️ Morning briefing once a day after 08:00 Israel time: the night's top stories + how the Israelis abroad did.
// - 🔔 Alerts during the day (not 00:00–07:00): important Israeli stories, Israelis-abroad news, the biggest
//   world stories. At most 3 per run, 8 per hour, 40 per day; every story once.

const API = 'https://api.telegram.org/bot';
const PER_RUN = 3;
const PER_HOUR = 8;
const PER_DAY = 40;
const BRIEF_HOUR = 8;

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ilParts = (ts) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(ts).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
};

const icon = (s, hot = true) => `${s.israel ? '🇮🇱' : s.abroad ? '✈️' : ''}${s.sport === 'football' ? '⚽' : s.sport === 'basketball' ? '🏀' : '🏅'}${hot && s.big ? '🔥' : ''}`;
// Hebrew headline: the model's, else a Hebrew article's, else the machine translation, else this run's translation
let heMap = new Map();
const titleHe = (s) => s.ai?.he?.title || s.t?.he?.title || heMap.get(s) || s.title;
const isHe = (t) => /[א-ת]/.test(t || '');
const storyKey = (s) => [...s._members].sort((a, b) => a.published - b.published || (a.id < b.id ? -1 : 1))[0].id;

function alertText(s, siteUrl) {
  const who = s.athletes?.length ? `👤 ${s.athletes.join(', ')}\n` : '';
  const sum = s.ai?.he?.sum ? `\n${esc(s.ai.he.sum)}\n` : '';
  const more = s.sourceCount > 1 ? ` +${s.sourceCount - 1}` : '';
  const video = s.video ? ` · <a href="${esc(s.video)}">🎥 וידאו</a>` : '';
  return `${icon(s)} <b>${esc(titleHe(s))}</b>\n${who}${sum}\n<a href="${esc(s.realLink || s.link)}">${esc(s.sources[0]?.name || '')}${more}</a>${video} · <a href="${esc(siteUrl)}">רדאר ספורט</a>`;
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
    .sort((a, b) => (b.israel || b.abroad ? 0.5 : 0) + (b.pop ?? b.score) - ((a.israel || a.abroad ? 0.5 : 0) + (a.pop ?? a.score)))
    .slice(0, 8);
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

  const il = ilParts(now);
  if (st.day !== il.day) Object.assign(st, { day: il.day, dayCount: 0 });
  let posted = 0;
  try {
    const wantBrief = il.hour >= BRIEF_HOUR && il.hour < 12 && st.briefDay !== il.day;
    const top = wantBrief ? briefingTop(stories, now) : [];
    const keyOf = new Map(stories.map((s) => [s, storyKey(s)]));
    const firstRun = !prev.sent; // don't flood the channel with everything that's already there
    const worth = (s) =>
      (s.abroad && (s.sourceCount >= 2 || s.social?.length)) ||
      (s.israel && (s.big || s.sourceCount >= 4 || (s.breaking && s.sourceCount >= 2))) ||
      (s.big && s.sourceCount >= 8);
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
    else if (il.hour >= 7) {
      const room = Math.min(PER_RUN, PER_HOUR - st.hour.length, PER_DAY - st.dayCount);
      for (const s of fresh.sort((a, b) => b.score - a.score).slice(0, Math.max(0, room))) {
        await send(token, chat, alertText(s, siteUrl), true);
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
