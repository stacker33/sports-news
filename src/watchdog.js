// Watchdog (its own workflow, every 15 minutes): is the live site still updating?
// The collector can't report its own outage — on 2026-10-06 one run got stuck "waiting" on the Pages deployment and
// the site stayed frozen for 23 hours without a word. So, from outside:
//   1. read the live data's age (news.json generatedAt)
//   2. older than 30 minutes → cancel collect runs stuck for 12+ minutes and start a fresh one (self-repair)
//      if collect runs SUCCEEDED after the data's time yet the site is still old, publishing is jammed: GitHub Pages
//      keys deployments by commit SHA, and once one deployment of a SHA failed, later deploys of that SHA "succeed"
//      without publishing (2026-10-11). A new, empty commit gives a new SHA and unjams it, so the watchdog makes one.
//   3. tell the admin on Telegram: at once, again after 2h and 6h (then every 24h), and once when it's back
// State (when it went stale, when we last alerted) is kept between runs in the Actions cache (.watchdog/state.json).
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const SITE = process.env.SITE_URL || 'https://stacker33.github.io/sports-news';
const REPO = process.env.REPO || 'stacker33/sports-news';
const GH = process.env.GH_TOKEN;
const STALE_MIN = 30;
const STUCK_MIN = 12;
const BUMP_MIN = 30; // at most one unjamming commit per half hour
const RECENT_MIN = 8; // a collect run started this recently: don't start another next to it
const REMIND_H = [2, 6]; // reminders: 2h and 6h after the first alert, then every 24h
const STATE = '.watchdog/state.json';
const DRY = !!process.env.DRY_RUN;

const now = Date.now();
const mins = (ms) => Math.round(ms / 60000);
const ago = (m) => (m < 120 ? `${m} דק׳` : `${Math.round(m / 60)} שעות`);

async function gh(path, opts = {}) {
  if (!GH) throw new Error('no GH_TOKEN');
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...opts,
    headers: { authorization: `Bearer ${GH}`, accept: 'application/vnd.github+json', 'user-agent': 'sports-radar-watchdog', ...(opts.headers || {}) },
  });
  if (!res.ok && res.status !== 202 && res.status !== 204) throw new Error(`GitHub ${res.status} ${path}`);
  return res.status === 204 || res.status === 202 ? null : res.json();
}

// A new commit on main with the same files (an empty commit), so the next deploy has a new SHA.
// Made with the Actions token, so it does not trigger the push workflow; the caller dispatches collect.
async function emptyCommit() {
  const head = (await gh('/git/ref/heads/main')).object.sha;
  const tree = (await gh(`/git/commits/${head}`)).tree.sha;
  const c = await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message: 'watchdog: empty commit to unjam GitHub Pages publishing', tree, parents: [head] }) });
  await gh('/git/refs/heads/main', { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) });
  console.log(`empty commit ${c.sha} on main (was ${head})`);
}

async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_ADMIN_CHAT;
  // REPAIR_ONLY (the discovery trial): self-repair still runs, messages only go to the run log
  if (DRY || process.env.REPAIR_ONLY || !token || !chat) return console.log('[telegram]', text);
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
  });
  if (!res.ok) console.error('telegram', res.status, await res.text());
}

// When should we (re)alert? First alert at once; then 2h, 6h after it, then every 24h.
export function alertDue(st, now) {
  if (!st.lastAlert) return true;
  const sinceFirst = (now - st.firstAlert) / 3600e3;
  const next = st.alerts <= REMIND_H.length ? REMIND_H[st.alerts - 1] : 24 * (st.alerts - REMIND_H.length); // 2h, 6h, 24h, 48h…
  return sinceFirst >= next;
}

async function main() {
  let st = {};
  try { st = JSON.parse(await readFile(STATE, 'utf8')); } catch {}

  let age, generatedAt;
  try {
    const j = await (await fetch(`${SITE}/data/news.json?t=${now}`, { cache: 'no-store' })).json();
    generatedAt = j.generatedAt;
    age = mins(now - generatedAt);
  } catch (e) {
    age = null; // the site itself didn't answer
  }
  console.log(`live data age: ${age ?? 'unreachable'} min`);

  if (age !== null && age < STALE_MIN) {
    if (st.staleSince) await telegram(`✅ <b>רדאר ספורט חזר להתעדכן</b>\nהנתונים בני ${age} דק׳ (האתר היה תקוע ${ago(mins(now - st.staleSince))}).`);
    st = {};
  } else {
    st.staleSince ||= now - (age ?? STALE_MIN) * 60000;
    // self-repair: cancel collect runs stuck for a while, then start a fresh one
    let repair = '';
    try {
      const runs = [];
      for (const status of ['in_progress', 'queued', 'waiting']) {
        const r = await gh(`/actions/workflows/collect.yml/runs?status=${status}&per_page=20`);
        runs.push(...(r.workflow_runs || []));
      }
      const stuck = runs.filter((r) => now - Date.parse(r.run_started_at || r.created_at) > STUCK_MIN * 60000);
      for (const r of stuck) if (!DRY) await gh(`/actions/runs/${r.id}/cancel`, { method: 'POST' });
      // Don't start a run next to one that just started: the newer would cancel the older, possibly in the middle
      // of publishing (that left the site on a failed deployment on 2026-10-11)
      const recent = (await gh('/actions/workflows/collect.yml/runs?per_page=10')).workflow_runs || [];
      // jammed publishing: a run succeeded (published "successfully") well after the data on the site was made
      const jammed = generatedAt && recent.some((r) => r.conclusion === 'success' && Date.parse(r.updated_at) > generatedAt + 5 * 60000);
      let bumped = false;
      if (jammed && !(st.lastBump && now - st.lastBump < BUMP_MIN * 60000)) {
        if (!DRY) await emptyCommit();
        st.lastBump = now;
        bumped = true;
      }
      const fresh = !bumped && recent.find((r) => !stuck.some((s) => s.id === r.id) && now - Date.parse(r.created_at) < RECENT_MIN * 60000 && r.conclusion !== 'cancelled');
      if (fresh) {
        repair = `${stuck.length ? `ביטלתי ${stuck.length} ריצות תקועות; ` : ''}ריצת איסוף כבר התחילה לפני ${mins(now - Date.parse(fresh.created_at))} דק׳, לא הפעלתי עוד אחת.`;
      } else {
        if (!DRY) await gh('/actions/workflows/collect.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
        repair = `${stuck.length ? `ביטלתי ${stuck.length} ריצות תקועות ו` : ''}${bumped ? 'הפרסום היה תקוע: יצרתי commit ריק ו' : ''}הפעלתי ריצת איסוף חדשה.`;
      }
      console.log('repair:', repair, stuck.map((r) => `${r.id}:${r.status}`).join(' '));
    } catch (e) {
      repair = `לא הצלחתי לתקן אוטומטית (${e.message}).`;
      console.error(e);
    }
    if (alertDue(st, now)) {
      st.firstAlert ||= now;
      st.alerts = (st.alerts || 0) + 1;
      st.lastAlert = now;
      await telegram(`⚠️ <b>רדאר ספורט לא מתעדכן</b>\n${age === null ? 'האתר לא עונה.' : `הנתונים באתר בני ${ago(age)}.`}\n${repair}\nhttps://github.com/${REPO}/actions`);
    }
  }
  if (!DRY) {
    await mkdir('.watchdog', { recursive: true });
    await writeFile(STATE, JSON.stringify(st));
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('watchdog.js')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
