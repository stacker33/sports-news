// Editors' feedback during the pilot, through a public ntfy.sh topic (the same no-account mechanism as corrections):
//   - 📣 reports ("this story was missed / is in the wrong place / wrong label") → forwarded to the admin's private
//     Telegram chat (the text is not kept in the public state)
//   - 👍 / 👎 votes per story ("worth covering" / "not relevant to us") → aggregated in data/votes.json: the labelled
//     set for measuring the radar (which top stories editors find useful) and, later, for ranking
// Limits per device per day keep a flood from taking over.

const TOPIC = 'https://ntfy.sh/sports-radar-feedback-3c0ee38ff1eb27f8';
const KEEP_DAYS = 30;
const VOTES_PER_DEVICE_DAY = 200;
const REPORTS_PER_DEVICE_DAY = 20;
const SEARCHES_PER_DEVICE_DAY = 20;

const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

// prev = { since, perDevice: { day, [device]: n }, votes: { storyId: { up: [devices], down: [devices], title, sport, israel, s5, link, t } } }
export async function loadFeedback(prev = {}, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const st = { since: prev.since || '12h', perDevice: prev.perDevice?.day === day ? { ...prev.perDevice } : { day }, votes: { ...(prev.votes || {}) } };
  for (const [id, v] of Object.entries(st.votes)) if (now - v.t > KEEP_DAYS * 864e5) delete st.votes[id];
  const reports = [];
  const searches = []; // "follow this search in the radar" (🌐 from the web)
  try {
    const res = await fetch(`${TOPIC}/json?poll=1&since=${encodeURIComponent(st.since)}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    for (const line of (await res.text()).split('\n')) {
      let m, j;
      try {
        m = JSON.parse(line);
        if (m.event !== 'message') continue;
        st.since = m.id;
        j = JSON.parse(m.message);
      } catch {
        continue;
      }
      if (j?.v !== 1) continue;
      const device = str(j.device, 24) || '?';
      const key = `${j.type}:${device}`;
      if (j.type === 'vote' && typeof j.id === 'string' && [1, -1, 0].includes(j.vote)) {
        if ((st.perDevice[key] || 0) >= VOTES_PER_DEVICE_DAY) continue;
        st.perDevice[key] = (st.perDevice[key] || 0) + 1;
        const v = st.votes[j.id] || { up: [], down: [] };
        // one vote per device per story: the latest one counts (0 = withdrawn)
        v.up = v.up.filter((d) => d !== device);
        v.down = v.down.filter((d) => d !== device);
        if (j.vote === 1) v.up.push(device);
        if (j.vote === -1) v.down.push(device);
        Object.assign(v, { title: str(j.title, 200), sport: str(j.sport, 12), israel: !!j.israel, s5: str(j.s5, 12), link: str(j.link, 600), t: now });
        st.votes[j.id] = v;
      } else if (j.type === 'search' && str(j.q, 80).length >= 2) {
        if ((st.perDevice[key] || 0) >= SEARCHES_PER_DEVICE_DAY) continue;
        st.perDevice[key] = (st.perDevice[key] || 0) + 1;
        searches.push({ q: str(j.q, 80), at: m.time * 1000 });
      } else if (j.type === 'report' && str(j.text, 1000)) {
        if ((st.perDevice[key] || 0) >= REPORTS_PER_DEVICE_DAY) continue;
        st.perDevice[key] = (st.perDevice[key] || 0) + 1;
        reports.push({ name: str(j.name, 30), text: str(j.text, 1000), link: str(j.link, 600), page: str(j.page, 40), at: m.time * 1000 });
      }
    }
  } catch {
    // ntfy unreachable: try again next run
  }
  return { feedback: st, reports, searches };
}

// the public file: per story the vote counts and what the story was (no device ids)
export const votesFile = (st, now) => ({
  generatedAt: now,
  stories: Object.fromEntries(Object.entries(st.votes).filter(([, v]) => v.up.length || v.down.length).map(([id, v]) => [id, { up: v.up.length, down: v.down.length, title: v.title, sport: v.sport, israel: v.israel, s5: v.s5, link: v.link, t: v.t }])),
});
