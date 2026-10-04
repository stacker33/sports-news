// "Did Sport5 already cover this?" — for the Sport5 editors who use the radar.
// A story counts as covered when one of its articles comes from Sport5 (site, Google results for the site,
// Telegram channel, YouTube channel). Sources that joined the story well after Sport5 published are "new since".

const SPORT5_SOURCES = new Set(['sport5-home', 'sport5', 'tg-sport5', 'yt-sport5']);
const isSport5 = (m) => SPORT5_SOURCES.has(m.sourceId) || /(^|\.)sport5\.co\.il\//.test(m.link.replace(/^https?:\/\//, ''));
const LATER = 20 * 60000; // a source counts as new if it was published 20+ minutes after Sport5's article
// the website (homepage, Google results for the site) vs Sport5's other channels (Telegram, YouTube)
const SITE_SOURCES = new Set(['sport5-home', 'sport5']);
const where = (m) => (SITE_SOURCES.has(m.sourceId) || /sport5\.co\.il/.test(m.link) ? 'site' : 'channel');

// → null (no match) or { at, link, newer, where } — where: 'site' (a website article) or 'channel' (only Sport5's
// Telegram / YouTube); newer = distinct outlets that published after Sport5 (more publications, not necessarily news)
export function sport5Coverage(story) {
  const all = story._members.filter(isSport5);
  if (!all.length) return null;
  const site = all.filter((m) => where(m) === 'site');
  const own = site.length ? site : all;
  const at = Math.min(...own.map((m) => m.published));
  const direct = own.find((m) => /sport5\.co\.il/.test(m.link)) || own.find((m) => !m.google) || own[0];
  const newer = new Set(story._members.filter((m) => !isSport5(m) && m.published > at + LATER).map((m) => m.publisher)).size;
  return { at, link: direct.link, newer, where: site.length ? 'site' : 'channel' };
}

// Second check for stories without a Sport5 article in their cluster: Sport5 often words the same story very
// differently ("Kane's hat-trick…" vs "England thrash Croatia 7-0"), so look for a Sport5 article from the same day
// that shares the score, players/teams, or enough distinctive headline words → "probably covered".
const scoreKey = (t) => [...String(t || '').matchAll(/(\d{1,3})\s*[:\-–]\s*(\d{1,3})/g)].map((m) => [+m[1], +m[2]].sort((a, b) => a - b).join('-'));
const DAY = 24 * 3600e3;

export function sport5Probable(stories, items, tokens) {
  const own = items
    .filter((m) => !m.hidden && isSport5(m))
    // only the start of a long post counts (a Telegram digest mentions everything)
    .map((m) => ({ m, tok: new Set([...tokens(m.tr?.en || m.title)].slice(0, 12)), ents: new Set((m.ents || []).filter((id) => !id.startsWith('c-'))), scores: scoreKey(m.title) }));
  if (!own.length) return 0;
  // words that appear in many Sport5 headlines say little ("Israel", "national team"…)
  const df = new Map();
  for (const o of own) for (const t of o.tok) df.set(t, (df.get(t) || 0) + 1);
  const common = (t) => (df.get(t) || 0) > Math.max(10, own.length * 0.06);
  let found = 0;
  for (const s of stories) {
    if (s.s5) continue;
    const members = s._members;
    const tok = new Set(members.slice(0, 6).flatMap((m) => [...tokens(m.tr?.en || (m.lang === 'en' ? m.title : '') || '')]));
    const ents = new Set(members.flatMap((m) => m.ents || []).filter((id) => !id.startsWith('c-')));
    const scores = new Set(members.flatMap((m) => scoreKey(m.title)));
    let best = null;
    for (const o of own) {
      if (Math.abs(o.m.published - s.first) > DAY) continue;
      let pts = 0;
      for (const t of o.tok) if (tok.has(t) && !common(t)) pts++;
      for (const id of o.ents) if (ents.has(id)) pts += 2;
      if (o.scores.some((k) => scores.has(k))) pts += 3; // the same result (with at least one more shared word or name)
      if (pts >= 4 && (!best || pts > best.pts)) best = { pts, o };
    }
    if (best) {
      const at = best.o.m.published;
      const newer = new Set(members.filter((m) => m.published > at + LATER).map((m) => m.publisher)).size;
      s.s5 = { at, link: best.o.m.link, newer, probable: true, where: where(best.o.m) };
      found++;
    }
  }
  return found;
}
