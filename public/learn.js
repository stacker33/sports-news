'use strict';
// "For you": learns from the stories you open. Each open stores the story's features
// (sport, Israeli/abroad, players, teams, opponent, source, keywords). Old reads fade (half-life 30 days).
// Synced through the PC server (/api/profile) so the PC and the phone share one profile;
// if there is no server (cloud version) it works on this device only.
(function () {
  const KEY = 'sr.reads';
  const HALF_LIFE_DAYS = 30;
  const STOP = new Set(
    `the and for with from after before over into about than this that will would could have been says said report reports live latest news update
    game match team club player players league season first last more what when where their they them his her its new vs win wins beat
    של את על עם לא כי זה גם אבל או אם כל רק עוד היה היא הוא הם אחרי לפני מול בין עד כך מה מי משחק קבוצה שחקן ליגה צפו`.split(/\s+/)
  );

  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const save = (ev) => { try { localStorage.setItem(KEY, JSON.stringify(ev.slice(-2000))); } catch {} };
  let events = load(); // [{ id, ts, f: [...], synced? }]

  function words(text) {
    return (text || '')
      .toLowerCase()
      .replace(/['"׳״`’‘“”]/g, '')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w));
  }

  function features(s) {
    const f = new Set([`sport:${s.sport}`]);
    if (s.israel) f.add('cat:israel');
    if (s.abroad) f.add('cat:abroad');
    for (const a of s.athletes || []) if (!(s.tags || []).some((g) => g.id === `a:${a}`)) f.add(`ath:${a}`);
    for (const t of s.teams || []) f.add(`team:${t}`);
    if (s.rival) f.add(`rival:${s.rival.opponent}`);
    for (const g of s.tags || []) f.add(`tag:${g.id}`); // competition / team / player
    if (s.sources?.[0]?.name) f.add(`src:${s.sources[0].name}`);
    const text = [s.t?.en?.title, s.t?.he?.title, s.lang === 'en' || s.lang === 'he' ? s.title : ''].join(' ');
    for (const w of [...new Set(words(text))].slice(0, 10)) f.add(`kw:${w}`);
    return [...f];
  }

  function record(s) {
    if (!s || events.some((e) => e.id === s.id)) return;
    events.push({ id: s.id, ts: Date.now(), f: features(s) });
    save(events);
    sync();
  }

  let syncing = null;
  let retries = 0;
  async function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      try {
        const pending = events.filter((e) => !e.synced).map(({ synced, ...e }) => e);
        const res = pending.length
          ? await fetch('api/clicks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pending) })
          : await fetch('api/profile', { cache: 'no-store' });
        if (!res.ok) return;
        const server = (await res.json()).events || [];
        // server is the shared truth: everything it has is synced; keep local reads it doesn't have yet
        const ids = new Set(server.map((e) => e.id));
        events = [...server.map((e) => ({ ...e, synced: true })), ...events.filter((e) => !ids.has(e.id))].sort((a, b) => a.ts - b.ts);
        save(events);
        // reads made while this sync was running: send them too (a few retries at most)
        retries = events.some((e) => !e.synced) ? retries + 1 : 0;
        if (retries && retries <= 3) setTimeout(sync, 300);
      } catch {
        /* no server (cloud version / offline): local only */
      } finally {
        syncing = null;
      }
    })();
    return syncing;
  }

  async function reset() {
    events = [];
    save(events);
    try { await fetch('api/profile', { method: 'DELETE' }); } catch {}
  }

  // feature → interest weight (recent reads count more)
  function weights() {
    const w = new Map();
    const now = Date.now();
    for (const e of events) {
      const decay = Math.pow(0.5, (now - e.ts) / (HALF_LIFE_DAYS * 86400e3));
      for (const f of e.f) w.set(f, (w.get(f) || 0) + decay);
    }
    return w;
  }

  // stories → Map(id → { score 0..1, reasons: [feature] })
  function affinity(stories) {
    const w = weights();
    if (!w.size) return new Map();
    // features common across today's stories (e.g. "sport:football") matter less than specific ones (a player)
    const df = new Map();
    const feats = new Map(stories.map((s) => [s.id, features(s)]));
    for (const fs of feats.values()) for (const f of fs) df.set(f, (df.get(f) || 0) + 1);
    const n = stories.length;
    const out = new Map();
    let max = 0;
    for (const s of stories) {
      let score = 0;
      const parts = [];
      for (const f of feats.get(s.id)) {
        const wf = w.get(f);
        if (!wf) continue;
        const v = wf * Math.log(1 + n / (1 + df.get(f)));
        score += v;
        parts.push([f, v]);
      }
      if (score > 0) {
        max = Math.max(max, score);
        // explain with the most specific reasons first (a player / team / opponent before "football")
        const rank = (f) => (/^(tag|ath|rival):/.test(f) ? 0 : /^(team|kw):/.test(f) ? 1 : 2);
        const reasons = parts.sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1]).slice(0, 3).map((p) => p[0]);
        out.set(s.id, { score, reasons });
      }
    }
    for (const v of out.values()) v.score /= max;
    return out;
  }

  window.Learn = { record, sync, reset, affinity, count: () => events.length };
})();
