// Category corrections from the app's 🏷️ button.
// The app posts each correction to a public ntfy.sh topic (no account, works from GitHub Pages); every run we read
// the new messages and keep them per article link. They override the sport / Israeli flag / visibility of those
// articles and become training examples for the sport model.

const TOPIC = 'https://ntfy.sh/sports-radar-fix-b5e962ea3039dbb3';
const KEEP_DAYS = 14;
const MAX_PER_RUN = 300; // a flood of messages can't take over the feed
const SPORTS = new Set(['football', 'basketball', 'other']);

function parse(msg) {
  let j;
  try {
    j = JSON.parse(msg);
  } catch {
    return null;
  }
  if (j?.v !== 1 || !Array.isArray(j.links)) return null;
  const links = j.links.filter((l) => typeof l === 'string' && /^https?:\/\//.test(l) && l.length < 600).slice(0, 15);
  const fix = {};
  if (SPORTS.has(j.sport)) fix.sport = j.sport;
  if (typeof j.israel === 'boolean') fix.israel = j.israel;
  if (j.hide === true) fix.hide = true;
  return links.length && Object.keys(fix).length ? { links, fix } : null;
}

// prev = { since, byLink: { link: { sport?, israel?, hide?, t } } }
export async function loadCorrections(prev = {}, now = Date.now()) {
  const out = { since: prev.since || '12h', byLink: { ...(prev.byLink || {}) } };
  for (const [link, f] of Object.entries(out.byLink)) if (now - f.t > KEEP_DAYS * 864e5) delete out.byLink[link];
  let added = 0;
  try {
    const res = await fetch(`${TOPIC}/json?poll=1&since=${encodeURIComponent(out.since)}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    for (const line of (await res.text()).split('\n')) {
      if (!line.trim()) continue;
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      if (m.event !== 'message') continue;
      out.since = m.id;
      if (added >= MAX_PER_RUN) continue;
      const c = parse(m.message);
      if (!c) continue;
      added++;
      for (const link of c.links) out.byLink[link] = { ...c.fix, t: now }; // the app sends the full correction each time
    }
  } catch {
    // ntfy unreachable: keep what we have, try again next run
  }
  return { corrections: out, added };
}
