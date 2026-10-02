// Israelis abroad in their club games: starting / bench / came on / injured / suspended, goals, cards, rating,
// plus the Israeli TV channel. Read server-side from 365Scores game details (the browser isn't allowed to).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const API = 'https://webws.365scores.com/web';
const DAY = 86400e3;

async function get(path, params) {
  const qs = new URLSearchParams({ appTypeId: 5, langId: 1, timezoneName: 'UTC', userCountryId: 6, ...params });
  const res = await fetch(`${API}/${path}/?${qs}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`365 ${path} HTTP ${res.status}`);
  return res.json();
}

const nm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim();

// One player's part in one game (null if he isn't listed at all)
function playerInGame(det, a, teamId) {
  const names = [a.name, ...(a.alt || [])].filter((n) => n && n.includes(' ')).map(nm);
  const member = (det.members || []).find((m) => names.includes(nm(m.name)));
  if (!member) return null;
  const side = [det.homeCompetitor, det.awayCompetitor].find((c) => c.id === teamId);
  const lu = (side?.lineups?.members || []).find((x) => x.id === member.id);
  if (!lu) return null;
  if (lu.status === 3) {
    const inj = lu.injury || {};
    const reason = inj.reason || '';
    return {
      s: 'missing',
      reason,
      ret: /unknown/i.test(inj.expectedReturn || '') ? '' : inj.expectedReturn || '',
      susp: /suspen/i.test(reason),
      nat: /national team/i.test(reason), // 365Scores sometimes says it outright
    };
  }
  if (lu.status !== 1 && lu.status !== 2) return null;
  const out = { s: lu.status === 1 ? 'start' : 'bench', goals: [], assists: [], yc: [], rc: [] };
  for (const e of det.events || []) {
    const mine = e.playerId === member.id, extra = (e.extraPlayers || []).includes(member.id);
    if (!mine && !extra) continue;
    const t = e.eventType?.name || '', min = e.gameTimeDisplay || `${e.gameTime}'`;
    if (e.eventType?.id === 1000 || t === 'Substitution') out.sub = min;
    else if (t === 'Goal' && mine && !/own/i.test(e.eventType?.subTypeName || '')) out.goals.push(min);
    else if (t === 'Goal' && extra) out.assists.push(min);
    else if (/yellow/i.test(t) && mine) out.yc.push(min);
    else if (/red/i.test(t) && mine) out.rc.push(min);
  }
  if (lu.ranking > 0) out.rating = lu.ranking;
  if (lu.hasHighestRanking) out.best = true;
  return out;
}

// prev: { games: { [id]: info } } — finished games are kept, live/upcoming ones refreshed every run
export async function loadGameInfo(athletes, teamCache, prev = {}, now = Date.now()) {
  const byTeam = new Map();
  for (const a of athletes) {
    const id = teamCache[`${a.sport}|${a.team}`]?.id;
    if (id) (byTeam.get(id) || byTeam.set(id, []).get(id)).push(a);
  }
  if (!byTeam.size) return { at: now, games: {} };
  const cur = await get('games/current', { competitors: [...byTeam.keys()].join(',') });
  const games = {};
  const recent = (cur.games || []).filter((g) => Math.abs(Date.parse(g.startTime) - now) < 2.5 * DAY);
  for (const g of recent) {
    const old = prev.games?.[g.id];
    if (old?.final) { games[g.id] = old; continue; }
    try {
      const det = (await get('game', { gameId: g.id })).game;
      const players = {};
      for (const teamId of [g.homeCompetitor.id, g.awayCompetitor.id]) {
        for (const a of byTeam.get(teamId) || []) {
          const p = playerInGame(det, a, teamId);
          if (p) players[a.name] = p;
        }
      }
      const hasLineup = [det.homeCompetitor, det.awayCompetitor].some((c) => c.lineups?.members?.length);
      games[g.id] = {
        tv: (det.tvNetworks || []).map((t) => t.name).filter(Boolean).slice(0, 2),
        lineup: hasLineup,
        players,
        final: det.statusGroup === 4 && hasLineup, // keep finished games once their lineups are in
      };
    } catch {
      if (old) games[g.id] = old;
    }
  }
  return { at: now, games };
}
