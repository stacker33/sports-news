// Player cards for the Israelis abroad: club + league position, last game (minutes, rating), next game,
// season stats in the club's league, contract. From 365Scores (player pages, league tables, fixtures),
// refreshed gently: a few players per run, each about once an hour.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const API = 'https://webws.365scores.com/web';
const HOUR = 3600e3;
const PER_RUN = 3;
const SPORT_ID = { football: 1, basketball: 2 };
// National-team competitions (their stats don't go on the club line)
const NATIONAL_COMPS = /nations league|world cup|euro\b|qualif|friendl|eurobasket|fiba/i;

async function get(path, params) {
  const qs = new URLSearchParams({ appTypeId: 5, timezoneName: 'UTC', userCountryId: 6, ...params });
  const res = await fetch(`${API}/${path}/?${qs}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`365 ${path} HTTP ${res.status}`);
  return res.json();
}

const nm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim();

async function findAthleteId(a) {
  const j = await get('search', { langId: 1, query: a.name });
  const want = [a.name, ...(a.alt || [])].filter((n) => n.includes(' ')).map(nm);
  const hit = (j.athletes || []).find((x) => x.sportId === SPORT_ID[a.sport] && want.includes(nm(x.name))) ||
    (j.athletes || []).find((x) => x.sportId === SPORT_ID[a.sport]);
  return hit?.id || null;
}

const stat = (list, name) => list.find((s) => s.name === name)?.value;
const teamName = (c) => ({ id: c.id, name: c.name });

// One language's view of a player page → the parts we show
function readPage(p) {
  const club = p.clubId;
  // season line: the club competition where he has the most minutes
  const clubComps = (p.highlightStats || []).filter((h) => !NATIONAL_COMPS.test(h.name));
  const main = clubComps.sort((a, b) => (parseFloat(stat(b.stats, 'Minutes Played')) || 0) - (parseFloat(stat(a.stats, 'Minutes Played')) || 0))[0];
  const season = main && {
    comp: main.name,
    compId: main.competitionId,
    apps: stat(main.stats, 'Appearances'),
    goals: stat(main.stats, 'Goals'),
    assists: stat(main.stats, 'Assists'),
    rating: stat(main.stats, 'Rating'),
    minutes: stat(main.stats, 'Minutes Played'),
    points: stat(main.stats, 'Points'), // basketball
  };
  // last game he actually played (and, separately, a more recent game he sat out)
  const games = p.lastMatches?.games || [];
  const lm = games.find((x) => x.played) || games[0];
  const skipped = games[0] && !games[0].played && games[0] !== lm ? games[0] : null;
  const val = (type) => lm?.athleteStats?.find((s) => s.type === type)?.value;
  const missed = skipped && {
    start: Date.parse(skipped.game.startTime),
    home: skipped.game.homeCompetitor.name,
    away: skipped.game.awayCompetitor.name,
  };
  const last = lm && {
    missed,
    id: lm.game.id,
    start: Date.parse(lm.game.startTime),
    comp: lm.game.competitionDisplayName,
    home: teamName(lm.game.homeCompetitor),
    away: teamName(lm.game.awayCompetitor),
    score: [lm.game.homeCompetitor.score, lm.game.awayCompetitor.score],
    forTeam: lm.relatedCompetitor,
    played: !!lm.played,
    minutes: val(229),
    rating: val(0),
  };
  return { club, season, last, contract: p.contractUntil ? p.contractUntil.slice(0, 7) : null, position: p.position?.name || '' };
}

// cards: { [athleteName]: card } (mutated); state: { ids, at, standings }
export async function loadPlayerCards(athletes, teamCache, prevState = {}, now = Date.now()) {
  const st = { ids: { ...(prevState.ids || {}) }, at: { ...(prevState.at || {}) }, cards: { ...(prevState.cards || {}) }, standings: prevState.standings || {} };
  const names = new Set(athletes.map((a) => a.name));
  for (const n of Object.keys(st.cards)) if (!names.has(n)) delete st.cards[n];

  const due = athletes.filter((a) => !st.at[a.name] || now - st.at[a.name] > HOUR).slice(0, PER_RUN);
  for (const a of due) {
    try {
      if (!st.ids[a.name]) st.ids[a.name] = await findAthleteId(a);
      const id = st.ids[a.name];
      if (!id) { st.at[a.name] = now; continue; }
      const [en, he] = await Promise.all([
        get('athletes', { langId: 1, athletes: id, fullDetails: true }),
        get('athletes', { langId: 2, athletes: id, fullDetails: true }),
      ]);
      const pe = readPage(en.athletes?.[0] || {}), ph = readPage(he.athletes?.[0] || {});
      // next club game (fixtures of his club)
      let next = null;
      const clubId = pe.club || teamCache[`${a.sport}|${a.team}`]?.id;
      if (clubId) {
        const [fe, fh] = await Promise.all([get('games/current', { langId: 1, competitors: clubId }), get('games/current', { langId: 2, competitors: clubId })]);
        const g = (fe.games || []).filter((x) => x.statusGroup === 2 || x.statusGroup === 3).sort((x, y) => Date.parse(x.startTime) - Date.parse(y.startTime))[0];
        const gh = g && (fh.games || []).find((x) => x.id === g.id);
        if (g) {
          next = {
            id: g.id, start: Date.parse(g.startTime), live: g.statusGroup === 3,
            comp: { en: g.competitionDisplayName, he: gh?.competitionDisplayName || g.competitionDisplayName },
            home: { id: g.homeCompetitor.id, en: g.homeCompetitor.name, he: gh?.homeCompetitor.name || g.homeCompetitor.name },
            away: { id: g.awayCompetitor.id, en: g.awayCompetitor.name, he: gh?.awayCompetitor.name || g.awayCompetitor.name },
          };
        }
      }
      // club's league position (cached ~3h per league)
      let table = null;
      const compId = pe.season?.compId;
      if (compId && clubId) {
        const cached = st.standings[compId];
        if (!cached || now - cached.at > 3 * HOUR) {
          const sj = await get('standings', { langId: 1, competitions: compId });
          const rows = (sj.standings || []).flatMap((s) => s.rows || []).filter((r) => r.competitor); // skip separator rows
          st.standings[compId] = { at: now, rows: rows.map((r) => [r.competitor.id, r.position, r.points]), size: rows.length };
        }
        const row = st.standings[compId].rows.find((r) => r[0] === clubId);
        if (row) table = { pos: row[1], of: st.standings[compId].size, pts: row[2] };
      }
      st.cards[a.name] = {
        athleteId: id,
        clubId,
        position: { en: pe.position, he: ph.position || pe.position },
        contract: pe.contract,
        season: pe.season && { ...pe.season, comp: { en: pe.season.comp, he: ph.season?.comp || pe.season.comp } },
        last: pe.last && {
          ...pe.last,
          comp: { en: pe.last.comp, he: ph.last?.comp || pe.last.comp },
          home: { ...pe.last.home, he: ph.last?.home?.name || pe.last.home.name },
          away: { ...pe.last.away, he: ph.last?.away?.name || pe.last.away.name },
          missed: pe.last.missed && {
            start: pe.last.missed.start,
            home: { en: pe.last.missed.home, he: ph.last?.missed?.home || pe.last.missed.home },
            away: { en: pe.last.missed.away, he: ph.last?.missed?.away || pe.last.missed.away },
          },
        },
        next,
        table,
        at: now,
      };
      st.at[a.name] = now;
    } catch (e) {
      if (process.env.DEBUG_CARDS) console.error(a.name, e);
      if (/HTTP (429|403)/.test(e.message)) break; // slow down: continue next run
      st.at[a.name] = now - HOUR + 10 * 60000; // retry in ~10 minutes
    }
  }
  return st;
}
