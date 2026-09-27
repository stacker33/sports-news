'use strict';
// Live scoreboard from 365Scores' public web API (free, no key, CORS-enabled).
// Exposes window.Scores = { load(opts), render(el, opts) }.

(function () {
  const API = 'https://webws.365scores.com/web/games/allscores/';
  const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem';

  // Competitions, in display order. Ids from 365Scores.
  const COMPS = [
    { id: 42, group: 'il' }, // Ligat HaAl
    { id: 43, group: 'il' }, // Liga Leumit
    { id: 546, group: 'il' }, // Toto Cup
    { id: 47, group: 'il' }, // Winner League (basketball)
    { id: 609, group: 'il' }, // Winner Cup
    { id: 51, group: 'il' }, // State Cup (basketball)
    { id: 7016, group: 'eu' }, // Nations League
    { id: 572, group: 'eu' }, // Champions League
    { id: 573, group: 'eu' }, // Europa League
    { id: 7685, group: 'eu' }, // Conference League
    { id: 569, group: 'eu' }, // EuroLeague
    { id: 329, group: 'eu' }, // EuroCup
    { id: 7, group: 'world' }, // Premier League
    { id: 11, group: 'world' }, // LaLiga
    { id: 17, group: 'world' }, // Serie A
    { id: 25, group: 'world' }, // Bundesliga
    { id: 35, group: 'world' }, // Ligue 1
    { id: 57, group: 'world' }, // Eredivisie
    { id: 103, group: 'world' }, // NBA
  ];
  const ORDER = Object.fromEntries(COMPS.map((c, i) => [c.id, i]));

  const img = (kind, id, v) =>
    `https://imagecache.365scores.com/image/upload/f_png,w_40,h_40,c_limit,q_auto:eco,dpr_2,d_${kind}:default1.png/v${v || 1}/${kind}/${id}`;

  const ddmmyyyy = (d) =>
    `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

  async function get(params) {
    const qs = new URLSearchParams({ appTypeId: 5, timezoneName: TZ, userCountryId: 6, showOdds: 'false', ...params });
    const res = await fetch(`${API}?${qs}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('scores ' + res.status);
    return res.json();
  }

  // opts: { lang: 'he'|'en', dayOffset: -1|0|1, teamIds: [..] }
  async function load({ lang, dayOffset = 0, teamIds = [] }) {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    const date = ddmmyyyy(d);
    const base = { langId: lang === 'he' ? 2 : 1, startDate: date, endDate: date };
    const [comps, teams] = await Promise.all([
      get({ ...base, competitions: COMPS.map((c) => c.id).join(',') }),
      teamIds.length ? get({ ...base, competitors: teamIds.join(',') }).catch(() => ({ games: [] })) : { games: [] },
    ]);
    const compInfo = {};
    for (const j of [comps, teams]) for (const c of j.competitions || []) compInfo[c.id] = c;
    const byId = new Map();
    for (const g of [...(comps.games || []), ...(teams.games || [])]) byId.set(g.id, g);
    const games = [...byId.values()];
    return { games, compInfo, live: games.some((g) => g.statusGroup === 3) };
  }

  function gameUrl(g, comp, lang) {
    const sport = g.sportId === 2 ? 'basketball' : 'football';
    const h = g.homeCompetitor, a = g.awayCompetitor;
    const compSlug = comp?.nameForURL ? `${comp.nameForURL}-${g.competitionId}` : `competition-${g.competitionId}`;
    return `https://www.365scores.com/${lang === 'he' ? 'he/' : ''}${sport}/match/${compSlug}/${h.nameForURL}-${a.nameForURL}-${h.id}-${a.id}-${g.competitionId}#id=${g.id}`;
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function status(g, lang) {
    if (g.statusGroup === 3) {
      const min = g.gameTimeDisplay || (g.gameTime > 0 ? `${Math.floor(g.gameTime)}'` : '');
      return `<span class="st live">${esc(min || g.shortStatusText || 'LIVE')}</span>`;
    }
    if (g.statusGroup === 4) return `<span class="st done">${esc(g.shortStatusText || 'FT')}</span>`;
    const t = new Date(g.startTime);
    const hhmm = t.toLocaleTimeString(lang === 'he' ? 'he-IL' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
    const note = g.statusGroup === 2 ? '' : ` ${g.shortStatusText || ''}`;
    return `<span class="st">${esc(hhmm + note)}</span>`;
  }

  function team(c, winner) {
    return `<span class="tm${winner ? ' win' : ''}"><img src="${img('Competitors', c.id, c.imageVersion)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><span>${esc(c.name)}</span></span>`;
  }

  function row(g, comp, lang, star) {
    const h = g.homeCompetitor, a = g.awayCompetitor;
    const started = g.statusGroup === 3 || g.statusGroup === 4;
    const score = started ? `${h.score < 0 ? '-' : h.score} : ${a.score < 0 ? '-' : a.score}` : '–';
    return `<a class="game${g.statusGroup === 3 ? ' is-live' : ''}" href="${esc(gameUrl(g, comp, lang))}" target="_blank" rel="noopener">
      ${status(g, lang)}
      <span class="teams">${team(h, g.statusGroup === 4 && h.score > a.score)}${team(a, g.statusGroup === 4 && a.score > h.score)}</span>
      <span class="sc">${esc(score)}</span>
      ${star ? `<span class="star">⭐ ${esc(star)}</span>` : ''}
    </a>`;
  }

  // players: [{ name, name_he, teamId }]
  function render(el, data, { lang, players = [], labels }) {
    if (!data) {
      el.innerHTML = `<p class="muted pad">${esc(labels.loading)}</p>`;
      return;
    }
    const playersByTeam = {};
    for (const p of players) if (p.teamId) (playersByTeam[p.teamId] ||= []).push(lang === 'he' && p.name_he ? p.name_he : p.name);
    const starOf = (g) => [...(playersByTeam[g.homeCompetitor.id] || []), ...(playersByTeam[g.awayCompetitor.id] || [])].join(', ');

    const sortGames = (a, b) => (b.statusGroup === 3) - (a.statusGroup === 3) || new Date(a.startTime) - new Date(b.startTime);
    const abroad = data.games.filter((g) => starOf(g)).sort(sortGames);

    const groups = new Map();
    for (const g of data.games) {
      if (ORDER[g.competitionId] === undefined) continue;
      if (!groups.has(g.competitionId)) groups.set(g.competitionId, []);
      groups.get(g.competitionId).push(g);
    }
    const compIds = [...groups.keys()].sort((a, b) => ORDER[a] - ORDER[b]);

    let html = '';
    if (abroad.length) {
      html += `<div class="comp"><div class="comp-h">⭐ ${esc(labels.abroad)}</div>${abroad
        .map((g) => row(g, data.compInfo[g.competitionId], lang, starOf(g)))
        .join('')}</div>`;
    }
    for (const id of compIds) {
      const c = data.compInfo[id];
      html += `<div class="comp"><div class="comp-h"><img src="${img('Competitions', id, c?.imageVersion)}" alt="" onerror="this.remove()">${esc(c?.name || '')}</div>${groups
        .get(id)
        .sort(sortGames)
        .map((g) => row(g, c, lang, ''))
        .join('')}</div>`;
    }
    el.innerHTML = html || `<p class="muted pad">${esc(labels.noGames)}</p>`;
  }

  window.Scores = { load, render };
})();
