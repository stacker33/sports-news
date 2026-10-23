// ✈️ Israelis abroad suggested by editors from the page. Shared by everyone, like added sites (src/usersources.js):
// the suggestion goes through the feedback channel, the admin gets a private Telegram message with signed ✅ / ❌
// links (public/approve.html), and an approved player / coach is tracked from the next run on, for every editor.
// Nothing joins the list without the admin's ✅. The built-in list (config/athletes.json) is unchanged.

import { randomBytes } from 'node:crypto';
import { normalizeAthlete, COUNTRIES } from './athletes.js';
import { keyboardFor, validDecision, tgCall } from './usersources.js';

const PER_RUN = 3;
const KEEP_DAYS = 14; // pending / rejected / removed entries are forgotten after this (approved ones stay)
const QUEUE_HOURS = 24;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const str = (v, n) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, n) : '');
const key = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// the fields an editor can send (everything else is ignored)
export function cleanRequest(r = {}) {
  const a = {
    name: str(r.name, 60),
    name_he: str(r.name_he, 60),
    team: str(r.team, 60),
    team_he: str(r.team_he, 60),
    country: COUNTRIES[r.country] ? r.country : 'other',
    sport: r.sport === 'basketball' ? 'basketball' : 'football',
    role: r.role === 'coach' ? 'coach' : 'player',
  };
  // a name in Latin letters (as the foreign press writes it) and a team are needed to find the news
  if (a.name.length < 4 || !/\p{Script=Latin}/u.test(a.name) || !a.name.includes(' ') || a.team.length < 2) return null;
  return { ...a, note: str(r.note, 200), by: str(r.by, 30), at: r.at };
}

// all the ways a person is written (for "already on the list")
const namesOf = (a) => [a.name, a.name_he, ...(a.alt || [])].map(key).filter((n) => n.includes(' '));

// the athlete record: surnames as extra spellings (a surname alone counts only with the club named, src/athletes.js)
export function toAthlete(e) {
  const last = (n) => (n || '').trim().split(/\s+/).pop();
  const alt = [last(e.name), last(e.name_he)].filter((s) => s && s.length >= 3 && s !== e.name && s !== e.name_he);
  return { ...normalizeAthlete({ name: e.name, name_he: e.name_he, alt, team: e.team, team_he: e.team_he, team_alt: [], country: e.country, sport: e.sport, role: e.role }), user: true };
}

function requestText(e) {
  const role = e.role === 'coach' ? 'מאמן' : 'שחקן';
  const sport = e.sport === 'basketball' ? 'כדורסל' : 'כדורגל';
  const lines = [
    `✈️ <b>הצעה להוסיף ${role} לליגיונרים</b>${e.by ? ` מ${esc(e.by)}` : ''}`,
    `<b>${esc(e.name)}</b>${e.name_he ? ` (${esc(e.name_he)})` : ''}`,
    `${esc(e.team)}${e.team_he ? ` (${esc(e.team_he)})` : ''} · ${sport} · ${esc(COUNTRIES[e.country]?.label || e.country)}`,
  ];
  if (e.note) lines.push(`הערה: ${esc(e.note)}`);
  return lines.join('\n');
}
const DONE = { approved: '✅ <b>אושר</b>: במעקב בכל ריצה, אצל כל העורכים', rejected: '❌ <b>נדחה</b>', removed: '🗑️ <b>הוסר מהרשימה</b>' };

// prev = { list: [entry], queue: [request] }; decisions = [{ a, id, s }] from the approve page
// entry = { id, name, name_he, team, team_he, country, sport, role, status, at, decided?, msg? }
// status: pending | approved | rejected | removed | exists (already on the list)
export async function processAthleteRequests(prev = {}, requests = [], { now = Date.now(), builtin = [], env = process.env, tg = tgCall, decisions = [] } = {}) {
  const st = {
    list: (prev.list || []).filter((e) => e.status === 'approved' || now - (e.decided || e.at) < KEEP_DAYS * 864e5),
    queue: [...(prev.queue || []), ...requests].filter((r) => now - r.at < QUEUE_HOURS * 3600e3),
    error: null,
  };
  const admin = env.TELEGRAM_ADMIN_CHAT;
  if (!env.TELEGRAM_BOT_TOKEN || !admin) return { userAthletes: { ...st, error: 'no admin chat' }, changed: 0 };
  const call = (m, b) => tg(m, b, { env });
  let changed = 0;

  // 1. the admin's decisions (signed links, checked here)
  for (const d of decisions.slice(0, 50)) {
    const e = st.list.find((x) => x.id === d.id);
    if (!e || !['ok', 'no', 'rm'].includes(d.a) || !validDecision(env.TELEGRAM_BOT_TOKEN, d.a, d.id, d.s)) continue;
    const next = d.a === 'ok' ? 'approved' : d.a === 'no' ? 'rejected' : 'removed';
    if (next === 'removed' ? e.status !== 'approved' : e.status !== 'pending') continue;
    e.status = next;
    e.decided = now;
    changed++;
    if (e.msg) await call('editMessageText', { chat_id: admin, message_id: e.msg, text: `${requestText(e)}\n\n${DONE[e.status]}`, parse_mode: 'HTML', reply_markup: keyboardFor(e, env, 'p') }).catch(() => {});
  }

  // 2. new suggestions: already on the list → noted; otherwise ask the admin
  const onList = new Set([...builtin, ...st.list.filter((e) => ['pending', 'approved'].includes(e.status))].flatMap(namesOf));
  const later = [];
  let done = 0;
  for (const raw of st.queue) {
    if (done >= PER_RUN) {
      later.push(raw);
      continue;
    }
    const r = cleanRequest(raw);
    if (!r) continue;
    done++;
    const base = { id: randomBytes(4).toString('hex'), name: r.name, name_he: r.name_he, team: r.team, team_he: r.team_he, country: r.country, sport: r.sport, role: r.role, at: now };
    if (namesOf(r).some((n) => onList.has(n))) {
      st.list.push({ ...base, status: 'exists' });
      changed++;
      continue;
    }
    const e = { ...base, status: 'pending' };
    try {
      const msg = await call('sendMessage', { chat_id: admin, text: requestText({ ...e, by: r.by, note: r.note }), parse_mode: 'HTML', reply_markup: keyboardFor(e, env, 'p') });
      e.msg = msg?.message_id;
      st.list.push(e);
      for (const n of namesOf(e)) onList.add(n);
      changed++;
    } catch (err) {
      st.error = String(err.message || err).slice(0, 200);
      later.push(raw); // Telegram unreachable: ask again next run
    }
  }
  st.queue = later;
  return { userAthletes: st, changed };
}

// approved people, as athlete records (skipping anyone the built-in list already has)
export function userAthletes(st = {}, builtin = []) {
  const have = new Set(builtin.flatMap(namesOf));
  return (st.list || []).filter((e) => e.status === 'approved' && !namesOf(e).some((n) => have.has(n))).map(toAthlete);
}

// for the page: what was suggested and what happened (no editor names)
export const publicAthleteList = (st = {}) => (st.list || []).map((e) => ({ name: e.name, name_he: e.name_he, team: e.team, role: e.role, status: e.status, at: e.at, decided: e.decided || null }));
