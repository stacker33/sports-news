// ✈️ Israelis abroad: editors' suggestions from the page. Shared by everyone, like added sites (src/usersources.js):
// the suggestion goes through the feedback channel, the admin gets a private Telegram message with signed ✅ / ❌
// links (public/approve.html), and an approved change applies from the next run on, for every editor.
// Three kinds: add a player / coach, move someone to a new team, remove someone (back in Israel, retired…).
// Nothing changes without the admin's ✅. The built-in list (config/athletes.json) is unchanged: approved moves and
// removals are applied on top of it (applyEdits); 🗑️ on an approved change undoes it.

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
  const kind = r.kind === 'move' || r.kind === 'remove' ? r.kind : 'add';
  const a = {
    kind,
    name: str(r.name, 60),
    name_he: str(r.name_he, 60),
    team: str(r.team, 60),
    team_he: str(r.team_he, 60),
    country: COUNTRIES[r.country] ? r.country : 'other',
    sport: r.sport === 'basketball' ? 'basketball' : 'football',
    role: r.role === 'coach' ? 'coach' : 'player',
  };
  if (a.name.length < 4) return null;
  // a new person: a name in Latin letters (as the foreign press writes it) and a team are needed to find the news
  if (kind === 'add' && (!/\p{Script=Latin}/u.test(a.name) || !a.name.includes(' ') || a.team.length < 2)) return null;
  if (kind === 'move' && a.team.length < 2) return null;
  return { ...a, note: str(r.note, 200), by: str(r.by, 30), at: r.at };
}

// all the ways a person is written (for "already on the list" / "who is this about")
const namesOf = (a) => [a.name, a.name_he, ...(a.alt || [])].map(key).filter((n) => n.includes(' '));
const samePerson = (a, b) => {
  const x = new Set(namesOf(a));
  return namesOf(b).some((n) => x.has(n));
};

// the athlete record: surnames as extra spellings (a surname alone counts only with the club named, src/athletes.js)
export function toAthlete(e) {
  const last = (n) => (n || '').trim().split(/\s+/).pop();
  const alt = [last(e.name), last(e.name_he)].filter((s) => s && s.length >= 3 && s !== e.name && s !== e.name_he);
  return { ...normalizeAthlete({ name: e.name, name_he: e.name_he, alt, team: e.team, team_he: e.team_he, team_alt: [], country: e.country, sport: e.sport, role: e.role }), user: true };
}

function requestText(e) {
  const who = `<b>${esc(e.name)}</b>${e.name_he ? ` (${esc(e.name_he)})` : ''}`;
  const from = e.by ? ` מ${esc(e.by)}` : '';
  let lines;
  if (e.kind === 'move') lines = [`🔁 <b>הצעה לעדכן קבוצה ברשימת הליגיונרים</b>${from}`, who, `${e.fromTeam ? `מ${esc(e.fromTeam)} ` : ''}ל<b>${esc(e.team)}</b>${e.team_he ? ` (${esc(e.team_he)})` : ''} · ${esc(COUNTRIES[e.country]?.label || e.country)}`];
  else if (e.kind === 'remove') lines = [`➖ <b>הצעה להסיר מרשימת הליגיונרים</b>${from}`, `${who}${e.fromTeam ? ` · ${esc(e.fromTeam)}` : ''}`];
  else {
    const role = e.role === 'coach' ? 'מאמן' : 'שחקן';
    const sport = e.sport === 'basketball' ? 'כדורסל' : 'כדורגל';
    lines = [`✈️ <b>הצעה להוסיף ${role} לליגיונרים</b>${from}`, who, `${esc(e.team)}${e.team_he ? ` (${esc(e.team_he)})` : ''} · ${sport} · ${esc(COUNTRIES[e.country]?.label || e.country)}`];
  }
  if (e.note) lines.push(`${e.kind === 'remove' ? 'סיבה' : 'הערה'}: ${esc(e.note)}`);
  return lines.join('\n');
}
const DONE = {
  add: { approved: '✅ <b>אושר</b>: במעקב בכל ריצה, אצל כל העורכים', rejected: '❌ <b>נדחה</b>', removed: '🗑️ <b>הוסר מהרשימה</b>' },
  move: { approved: '✅ <b>אושר</b>: הקבוצה עודכנה אצל כל העורכים', rejected: '❌ <b>נדחה</b>', removed: '↩️ <b>בוטל</b>: חזר לקבוצה הקודמת' },
  remove: { approved: '✅ <b>אושר</b>: הוסר מהרשימה אצל כל העורכים', rejected: '❌ <b>נדחה</b>', removed: '↩️ <b>בוטל</b>: חזר לרשימה' },
};

// prev = { list: [entry], queue: [request] }; decisions = [{ a, id, s }] from the approve page
// entry = { id, kind, name, name_he, team, team_he, country, sport, role, fromTeam?, status, at, decided?, msg? }
// status: pending | approved | rejected | removed (undone) | exists (already on the list / already asked)
// onList: the current list (built-in + approved changes): what "already on the list" and "who is this" check against
export async function processAthleteRequests(prev = {}, requests = [], { now = Date.now(), onList = [], env = process.env, tg = tgCall, decisions = [] } = {}) {
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
    if (e.msg) await call('editMessageText', { chat_id: admin, message_id: e.msg, text: `${requestText(e)}\n\n${DONE[e.kind || 'add'][e.status]}`, parse_mode: 'HTML', reply_markup: keyboardFor(e, env, 'p') }).catch(() => {});
  }

  // 2. new suggestions
  const open = () => st.list.filter((e) => e.status === 'pending' || (e.status === 'approved' && (e.kind || 'add') === 'add'));
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
    const base = { id: randomBytes(4).toString('hex'), kind: r.kind, name: r.name, name_he: r.name_he, team: r.team, team_he: r.team_he, country: r.country, sport: r.sport, role: r.role, at: now };
    let e;
    if (r.kind === 'add') {
      // already on the list, or already suggested
      if ([...onList, ...open().filter((x) => (x.kind || 'add') === 'add')].some((a) => samePerson(a, r))) {
        st.list.push({ ...base, status: 'exists' });
        changed++;
        continue;
      }
      e = { ...base, status: 'pending' };
    } else {
      // a move / removal is about someone on the list (by any of his names); one open change per person at a time
      const who = onList.find((a) => samePerson(a, r));
      if (!who) continue;
      if (st.list.some((x) => x.status === 'pending' && x.kind !== 'add' && samePerson(x, who))) {
        st.list.push({ ...base, status: 'exists' });
        changed++;
        continue;
      }
      e = { ...base, name: who.name, name_he: who.name_he, sport: who.sport, fromTeam: who.team, ...(r.kind === 'remove' ? { team: '', team_he: '' } : {}), status: 'pending' };
    }
    try {
      const msg = await call('sendMessage', { chat_id: admin, text: requestText({ ...e, by: r.by, note: r.note }), parse_mode: 'HTML', reply_markup: keyboardFor(e, env, 'p') });
      e.msg = msg?.message_id;
      st.list.push(e);
      changed++;
    } catch (err) {
      st.error = String(err.message || err).slice(0, 200);
      later.push(raw); // Telegram unreachable: ask again next run
    }
  }
  st.queue = later;
  return { userAthletes: st, changed };
}

// approved new people, as athlete records (skipping anyone the built-in list already has)
export function userAthletes(st = {}, builtin = []) {
  return (st.list || []).filter((e) => e.status === 'approved' && (e.kind || 'add') === 'add' && !builtin.some((a) => samePerson(a, e))).map(toAthlete);
}

// approved moves and removals, applied to the list in the order they were approved
export function applyEdits(athletes, st = {}) {
  let out = [...athletes];
  const edits = (st.list || []).filter((e) => e.status === 'approved' && (e.kind === 'move' || e.kind === 'remove')).sort((a, b) => a.decided - b.decided);
  for (const e of edits) {
    if (e.kind === 'remove') out = out.filter((a) => !samePerson(a, e));
    else
      out = out.map((a) => {
        if (!samePerson(a, e)) return a;
        // a new team: its own 365Scores id is looked up again; a pinned id or a second team belonged to the old one
        const { team365: _a, team2: _b, team2_alt: _c, team2_365: _d, ...rest } = a;
        return { ...rest, team: e.team, team_he: e.team_he, team_alt: [], country: e.country, moved: true };
      });
  }
  return out;
}

// for the page: what was suggested and what happened (no editor names)
export const publicAthleteList = (st = {}) => (st.list || []).map((e) => ({ kind: e.kind || 'add', name: e.name, name_he: e.name_he, team: e.team, fromTeam: e.fromTeam || null, role: e.role, status: e.status, at: e.at, decided: e.decided || null }));
