// Weekly source report for the admin: which feeds bring news that others confirm, which bring scoops, which bring
// noise. Measured, not guessed, from data the radar already has. Nothing is removed automatically.
//
// Once a day (the first run after 07:00 Israel time) yesterday's stories are tallied per feed. A story counts on the
// day it first broke, so it had at least 7 hours to be picked up by others. On Sunday morning the last 7 days go to
// the admin's Telegram.
//
// Per feed and day:
//   got    articles collected that day
//   shown  stories it was in (after the junk filters)
//   conf   of those, stories 3+ different outlets published (others confirmed it)
//   first  of those, it was the first to publish (a scoop the others followed)
//   alone  stories only one outlet ever had
//   s5     stories Sport5 published too
//   down   editors' 👎 on its stories

import { ilParts } from './telegram.js';

const KEEP_DAYS = 8;
const DAY_HOUR = 7;
const WEEK_DAY = 0; // Sunday
const MIN_SHOWN = 10; // fewer stories in a week than this: too little to judge

const outlets = (s) => new Set(s._members.map((m) => String(m.publisher || '').toLowerCase())).size;

// stories: this run's stories (with _members); items: this run's raw items; nameOf(sourceId) → feed name
export function tallyDay(day, { stories, items, nameOf, votes = {} }) {
  const out = {};
  const row = (k) => (out[k] ||= { got: 0, shown: 0, conf: 0, first: 0, alone: 0, s5: 0, down: 0 });
  for (const it of items) if (ilParts(it.published).day === day && nameOf(it.sourceId)) row(nameOf(it.sourceId)).got++;
  for (const s of stories) {
    if (s.dateUnknown || ilParts(s.first).day !== day) continue;
    const n = outlets(s);
    const dated = s._members.filter((m) => !m.dateUnknown);
    const firstT = Math.min(...dated.map((m) => m.published));
    const feeds = new Set(s._members.map((m) => nameOf(m.sourceId)).filter(Boolean));
    const firstFeeds = new Set(dated.filter((m) => m.published === firstT).map((m) => nameOf(m.sourceId)));
    const down = votes[s.id]?.down?.length || 0;
    for (const f of feeds) {
      const r = row(f);
      r.shown++;
      if (n >= 3) r.conf++;
      if (n >= 3 && firstFeeds.has(f)) r.first++;
      if (n === 1) r.alone++;
      if (s.s5) r.s5++;
      r.down += down;
    }
  }
  return out;
}

const sum = (days) => {
  const t = {};
  for (const d of Object.values(days)) for (const [k, r] of Object.entries(d)) {
    const x = (t[k] ||= { got: 0, shown: 0, conf: 0, first: 0, alone: 0, s5: 0, down: 0 });
    for (const f of Object.keys(x)) x[f] += r[f] || 0;
  }
  return t;
};
const pct = (a, b) => Math.round((100 * a) / Math.max(1, b));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// days: { 'YYYY-MM-DD': tally } → the Hebrew Telegram message
export function weeklyReport(days) {
  const t = Object.entries(sum(days));
  const judged = t.filter(([, r]) => r.shown >= MIN_SHOWN);
  const line = ([k, r], what) => `• ${esc(k)}: ${what(r)}`;
  const scoops = judged.filter(([, r]) => r.first >= 2).sort((a, b) => b[1].first - a[1].first).slice(0, 8);
  const confirmed = judged.filter(([, r]) => pct(r.conf, r.shown) >= 40).sort((a, b) => pct(b[1].conf, b[1].shown) - pct(a[1].conf, a[1].shown)).slice(0, 8);
  const noisy = judged.filter(([, r]) => pct(r.alone, r.shown) >= 80 && r.s5 === 0).sort((a, b) => b[1].shown - a[1].shown).slice(0, 8);
  const disliked = t.filter(([, r]) => r.down >= 3).sort((a, b) => b[1].down - a[1].down).slice(0, 8);
  const silent = t.filter(([, r]) => r.got >= 30 && r.shown === 0).sort((a, b) => b[1].got - a[1].got).slice(0, 8);
  const n = Object.keys(days).length;
  const parts = [
    `📊 <b>רדאר ספורט: דוח מקורות שבועי</b> (${n} ימים, ${t.length} מקורות)`,
    scoops.length && `\n🥇 <b>מביאים סקופים</b> (פרסמו ראשונים, ואחרים הלכו אחריהם):\n${scoops.map((x) => line(x, (r) => `${r.first} פעמים ראשונים`)).join('\n')}`,
    confirmed.length && `\n✅ <b>אמינים</b> (כלי תקשורת אחרים פרסמו את אותן ידיעות):\n${confirmed.map((x) => line(x, (r) => `${pct(r.conf, r.shown)}% מ-${r.shown} ידיעות`)).join('\n')}`,
    noisy.length && `\n🔇 <b>אולי רעש</b> (כמעט אף אחד אחר לא פרסם, וספורט 5 לא השתמש):\n${noisy.map((x) => line(x, (r) => `${pct(r.alone, r.shown)}% לבד מ-${r.shown} ידיעות`)).join('\n')}`,
    disliked.length && `\n👎 <b>קיבלו הכי הרבה 👎 מהעורכים</b>:\n${disliked.map((x) => line(x, (r) => `${r.down} 👎`)).join('\n')}`,
    silent.length && `\n🕳️ <b>שולחים הרבה ושום דבר לא מגיע לאתר</b> (המסננים זורקים הכל):\n${silent.map((x) => line(x, (r) => `${r.got} ידיעות, 0 באתר`)).join('\n')}`,
    `\nזה רק מספרים: ידיעה שרק מקור אחד פרסם יכולה להיות גם בלעדית או נישה. שום מקור לא הוסר. מקורות עם פחות מ-${MIN_SHOWN} ידיעות בשבוע לא נבדקו.`,
  ];
  return parts.filter(Boolean).join('\n');
}

// prev: state.srcReport = { days: {day: tally}, sentWeek }. Returns { srcReport, message|null }
export function sourceReportStep(now, prev = {}, data) {
  const st = { days: { ...(prev.days || {}) }, sentWeek: prev.sentWeek };
  const { day, hour } = ilParts(now);
  const yesterday = ilParts(now - 24 * 3600e3).day;
  if (hour >= DAY_HOUR && !st.days[yesterday]) st.days[yesterday] = tallyDay(yesterday, data);
  for (const d of Object.keys(st.days).sort().slice(0, -KEEP_DAYS)) delete st.days[d];
  let message = null;
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  if (weekday === WEEK_DAY && hour >= DAY_HOUR && st.sentWeek !== day && Object.keys(st.days).length >= 3) { // a first week with 1-2 days waits
    const last7 = Object.fromEntries(Object.entries(st.days).sort().slice(-7));
    message = weeklyReport(last7);
    st.sentWeek = day;
  }
  return { srcReport: st, message };
}
