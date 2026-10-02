// Collector: fetch feeds → tag → merge duplicates → rank → write public/data/*.json
// Each source has its own interval (`every` minutes); sources not due keep their items from last run.
// Run once:  node src/collect.js
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SOURCES } from '../config/sources.js';
import { fetchFeed, pool } from './feeds.js';
import { classify } from './classify.js';
import { clusterItems, buildStory, tokens } from './cluster.js';
import { translateItems } from './translate.js';
import { findRivalGames, rivalSources } from './rivals.js';
import { loadSignals } from './signals.js';
import { loadWikipedia } from './wikipedia.js';
import { loadEntityDb, refreshEntityDb, buildEntityIndex, findEntities } from './entities.js';
import { fillSummaries } from './summaries.js';
import { athleteSuggestions } from './suggest.js';
import { translateTexts } from './translate.js';
import { loadGameInfo } from './gameinfo.js';

// The entity index is rebuilt only when the knowledge base changes
let entityCache = { key: '', index: null };
function entityIndex(db) {
  const key = `${db.teamsAt}|${Object.keys(db.players || {}).length}`;
  if (entityCache.key !== key) entityCache = { key, index: buildEntityIndex(db) };
  return entityCache.index;
}
import { loadAthletes, resolveTeams, athleteSources, buildMatchers, COUNTRIES } from './athletes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'public', 'data');
const KEEP_ITEMS_H = 48; // raw items remembered between runs
const KEEP_STORIES_H = 36; // stories shown in the app
const MAX_STORIES = 1200;
const COOLDOWN_MIN = 15; // after a source errors (e.g. Google rate-limit)

const itemId = (link, title) => {
  let key = link;
  try {
    const u = new URL(link);
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|ref$|at_|cmpid|ito$|xtor)/i.test(p)) u.searchParams.delete(p);
    key = u.toString();
  } catch {}
  return createHash('sha1').update(key + '|' + title).digest('hex').slice(0, 16);
};

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(path, data) {
  const tmp = path + '.tmp';
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, path);
}

// force = fetch every source regardless of its interval (used after editing the athlete list)
export async function collect({ log = console.log, force = false } = {}) {
  const started = Date.now();
  await mkdir(DATA, { recursive: true });

  const statePath = join(DATA, 'state.json');
  const state = await readJson(statePath, { items: [] });
  const meta = state.meta || {}; // per-source { last, cooldownUntil, ok, count, error }
  const known = new Map(state.items.map((i) => [i.id, i]));

  // Israelis abroad
  const athletes = await loadAthletes(ROOT);
  const teamCache = await resolveTeams(athletes, state.teamCache || {});
  const ctx = {
    matchers: buildMatchers(athletes, teamCache),
    athleteSport: Object.fromEntries(athletes.map((a) => [a.name, a.sport])),
  };

  const now = Date.now();

  // Israeli teams vs foreign opponents → news from the opponent's country (refreshed every 30 min)
  let rivals = state.rivals || { at: 0, games: [] };
  if (force || now - rivals.at > 30 * 60000) {
    try {
      rivals = { at: now, games: await findRivalGames(now) };
    } catch {}
  }

  // Israel national team squads (football + basketball), refreshed daily: lets the scoreboard say
  // "with the national team" when an Israeli abroad misses a club game during an international window
  // Israelis abroad in their club games (lineups, goals, injuries, TV) for the scoreboard
  const gameInfo = await loadGameInfo(athletes, teamCache, state.gameInfo, now).catch(() => state.gameInfo || { games: {} });

  let ilSquad = state.ilSquad || { at: 0, names: [] };
  if (force || now - ilSquad.at > 24 * 3600e3) {
    try {
      ilSquad = { at: now, names: await nationalSquad() };
    } catch {}
  }

  const sources = [...SOURCES, ...athleteSources(athletes, teamCache), ...rivalSources(rivals.games)];
  const srcById = new Map(sources.map((s) => [s.id, s]));
  const due = sources.filter((s) => {
    const m = meta[s.id];
    if (!m || force) return true;
    if (m.cooldownUntil && now < m.cooldownUntil) return false;
    const every = s.every ?? (s.google ? 3 : 1);
    return now - (m.last || 0) >= every * 60000 - 15000;
  });

  const results = await pool(due, 12, (s) => fetchFeed(s));
  let fresh = 0;

  results.forEach((r, idx) => {
    const src = due[idx];
    if (!r.ok) {
      const error = String(r.error?.message || r.error).slice(0, 120);
      meta[src.id] = { ...meta[src.id], last: now, ok: false, error, cooldownUntil: now + COOLDOWN_MIN * 60000 };
      return;
    }
    const firstRead = !meta[src.id]?.okOnce; // never read this source successfully before
    meta[src.id] = { last: now, ok: true, okOnce: true, count: r.value.length };

    for (const raw of r.value) {
      // Skip navigation junk (e.g. 'News / EuroLeague / Leagues') and tiny titles
      if (raw.title.length < 12 || raw.title.split(' / ').length > 2) continue;

      const id = itemId(raw.link, raw.title);
      const prev = known.get(id);
      // Dates: trust the feed; if missing (or in the future) use the time we first saw it.
      // On the first read of a source we can't know when its existing articles appeared → "unknown".
      let published = raw.published && raw.published <= now + 5 * 60000 ? Math.min(raw.published, now) : null;
      let dateUnknown = false;
      if (published == null) {
        if (prev) ({ published, dateUnknown = false } = prev);
        else if (firstRead) [published, dateUnknown] = [now - 12 * 3600000, true];
        else published = now;
      }
      if (now - published > KEEP_ITEMS_H * 3600000) continue;

      const tags = classify(raw, src, ctx);
      if (src.mixed && !tags.looksSport) continue;

      const item = {
        id,
        title: raw.title,
        link: raw.link,
        summary: raw.summary,
        image: raw.image,
        publisher: raw.publisher,
        sourceId: src.id,
        lang: src.lang,
        weight: src.weight,
        google: !!src.google,
        top: !!src.top || !!prev?.top,
        published,
        dateUnknown,
        seen: prev?.seen ?? now, // when we first collected it
        sport: tags.sport,
        israel: tags.israel,
        israelOther: tags.israelOther,
        athletes: tags.athletes,
        teams: tags.teams,
        breaking: tags.breaking,
        rival: src.rival || prev?.rival || null,
        social: !!raw.social, // a reporter's own post (Telegram / Bluesky)
      };
      if (!prev) fresh++;
      known.set(id, item);
    }
  });

  const items = [...known.values()].filter((it) => now - it.published <= KEEP_ITEMS_H * 3600000);

  // Translate non-English headlines (newest first; cached per article)
  const tr = state.tr || {};
  items.sort((a, b) => b.published - a.published);
  const translated = await translateItems(items, tr, { maxTitles: 400 });

  // Topic tags (competitions, teams, players) from the 365Scores knowledge base
  const entityPath = join(DATA, 'entities.json');
  let edb = await loadEntityDb(entityPath);
  try {
    edb = await refreshEntityDb(edb, entityPath, now);
  } catch {}
  const eindex = entityIndex(edb);
  const entById = new Map();

  // (Re-)tag every item: uses the English translation for foreign languages, and picks up list edits immediately
  for (const it of items) {
    it.tr = tr[it.id] || null;
    const src = srcById.get(it.sourceId) || {};
    it.hidden = !!it.rival && !rivalRelevant(it);
    const en = it.lang !== 'en' && it.tr?.en ? ' ' + it.tr.en : '';
    const tags = classify({ title: it.title + en, summary: it.summary, link: it.link }, src, ctx);
    if (src.mixed && !tags.looksSport) it.hidden = true; // general-news feeds: sport only
    Object.assign(it, {
      sport: tags.sport, israel: tags.israel, israelOther: tags.israelOther,
      athletes: tags.athletes, teams: tags.teams, breaking: tags.breaking,
    });
    it._ents = [...findEntities(eindex, it.title, it.sport), ...findEntities(eindex, it.tr?.en, it.sport)];
  }
  // Double-check names: a surname alone ("Mancini", "George") counts only if that player's full name is in
  // the news somewhere, or their team is in the same headline; players never tag another sport's story (F1, tennis…)
  const fullSeen = new Map(); // player id → how many headlines name them in full
  for (const it of items) for (const e of it._ents) if (e.k === 'player' && !e.single) fullSeen.set(e.id, (fullSeen.get(e.id) || 0) + 1);
  for (const it of items) {
    const teamIds = new Set(it._ents.filter((e) => e.k === 'team').map((e) => e.id));
    // shared surname (Mbappé: Kylian or Ethan) → the one who is in the news / whose team is in the headline
    const resolved = it._ents.map((e) => {
      if (!e.alts) return e;
      const ok = e.alts.filter((a) => fullSeen.has(a.id) || teamIds.has(a.team)).sort((a, b) => (fullSeen.get(b.id) || 0) - (fullSeen.get(a.id) || 0));
      return ok[0] ? { ...ok[0], single: true } : e;
    });
    const keep = resolved.filter((e) => {
      if (e.k === 'comp') return true;
      if (it.sport === 'other') return false;
      if (e.sport && e.sport !== it.sport) return false;
      if (e.k === 'player' && e.single) return fullSeen.has(e.id) || teamIds.has(e.team);
      return true;
    });
    for (const e of keep) entById.set(e.id, e);
    it.ents = [...new Set(keep.map((e) => e.id))];
    delete it._ents;
  }
  const liveIds = new Set(items.map((i) => i.id));
  for (const id of Object.keys(tr)) if (!liveIds.has(id)) delete tr[id];

  // Popularity signals (Google Trends + Reddit), refreshed every 15 min
  const signals = await loadSignals(state.signals, now).catch(() => state.signals || {});
  const wiki = await loadWikipedia(state.wiki, athletes, now).catch(() => state.wiki || {});
  signals.wiki = wiki;

  // What the story is about, most relevant first: competition · teams · players (Israelis first)
  const ISRAELI_LEAGUES = new Set([42, 43, 47]);
  const heOfAthlete = new Map(athletes.map((a) => [a.name, a.name_he]));
  function storyTags(members) {
    const count = new Map();
    for (const m of members) for (const id of new Set(m.ents || [])) count.set(id, (count.get(id) || 0) + 1);
    // in big stories ignore names that only a few articles mention
    const minShare = members.length > 5 ? Math.ceil(members.length * 0.2) : 1;
    const ents = [...count].filter(([, n]) => n >= minShare).map(([id, n]) => ({ ...entById.get(id), n })).filter((e) => e.id);
    // rival game: the opponent + the competition
    const rival = members.find((m) => m.rival)?.rival;
    const game = rival && rivals.games.find((g) => g.opponent === rival.opponent);
    if (game) {
      for (const e of [...findEntities(eindex, game.israeli), ...findEntities(eindex, game.opponent), ...findEntities(eindex, game.competition)]) {
        if (!ents.some((x) => x.id === e.id)) ents.push({ ...e, n: members.length });
      }
    }
    const isIl = (e) => e.k === 'team' && (edb.teams[e.id.slice(1)]?.comps || []).some((c) => ISRAELI_LEAGUES.has(c));
    const byN = (a, b) => (isIl(b) ? 1 : 0) - (isIl(a) ? 1 : 0) || b.n - a.n;
    const comps = ents.filter((e) => e.k === 'comp').sort(byN).slice(0, 2);
    const teams = ents.filter((e) => e.k === 'team').sort(byN).slice(0, 3);
    // Israelis abroad from your list come first among players
    const ilPlayers = [...new Set(members.flatMap((m) => m.athletes || []))].map((name) => ({ k: 'player', id: `a:${name}`, en: name, he: heOfAthlete.get(name) || name, il: true }));
    const players = [...ilPlayers, ...ents.filter((e) => e.k === 'player' && !ilPlayers.some((p) => p.en === e.en)).sort(byN)].slice(0, 3);
    return [...comps, ...teams.map((e) => ({ ...e, il: isIl(e) || undefined })), ...players].map(({ k, id, en, he, il }) => ({ k, id, en, he, ...(il ? { il: true } : {}) }));
  }

  const stories = clusterItems(items.filter((i) => !i.hidden))
    .map((members) => ({ ...buildStory(members, now), tags: storyTags(members), _members: members }))
    .filter((s) => now - s.latest <= KEEP_STORIES_H * 3600000)
    .map((s) => applySignals(s, signals))
    .map((s) => ({ ...s, big: s.sourceCount >= 3 || s.langs.length >= 3 || !!s.trending || ((s.top || s.breaking) && s.sourceCount >= 2) }))
    // Other sports: only the biggest headlines (anything Israeli is always kept)
    .filter((s) => s.sport !== 'other' || s.big || s.israel || s.abroad)
    .sort((a, b) => b.latest - a.latest)
    .slice(0, MAX_STORIES);

  // Summaries: feed descriptions + article pages, most important stories first (Israeli / abroad, then popular & fresh)
  const sums = state.sums || {};
  const priority = [...stories]
    .filter((s) => now - s.first < 18 * 3600e3)
    .sort((a, b) => (b.israel || b.abroad ? 1 : 0) - (a.israel || a.abroad ? 1 : 0) || b.score - a.score);
  const summarized = await fillSummaries([...priority, ...stories.filter((s) => !priority.includes(s))], sums, { now }).catch(() => 0);
  // foreign-language summaries → Hebrew + English (cached with the summary)
  const needTr = stories.filter((s) => s.sum && s.sum.lang !== 'he' && s.sum.lang !== 'en' && !(sums[s.sum.id]?.he && sums[s.sum.id]?.en));
  const byLang = new Map();
  for (const s of needTr.slice(0, 150)) (byLang.get(s.sum.lang) || byLang.set(s.sum.lang, []).get(s.sum.lang)).push(s);
  for (const [lang, list] of byLang) {
    for (const to of ['he', 'en']) {
      try {
        const out = await translateTexts(list.map((s) => s.sum.text), lang, to);
        list.forEach((s, i) => ((sums[s.sum.id] ||= { at: now })[to] = out[i]));
      } catch {}
    }
  }
  for (const s of stories) {
    if (s.sum) Object.assign(s.sum, { he: sums[s.sum.id]?.he, en: sums[s.sum.id]?.en });
    delete s._members;
  }
  for (const id of Object.keys(sums)) if (!liveIds.has(id)) delete sums[id];

  const health = sources.map((s) => ({ id: s.id, name: s.name, ok: meta[s.id]?.ok !== false, count: meta[s.id]?.count ?? 0, error: meta[s.id]?.error }));
  const okCount = health.filter((h) => h.ok).length;

  await writeJson(join(DATA, 'news.json'), {
    generatedAt: now,
    tookMs: Date.now() - started,
    sources: { total: sources.length, ok: okCount, fetched: due.length },
    rivals: rivals.games,
    gameInfo: gameInfo.games,
    wikiAthletes: wiki.athletes || {},
    stories,
  });
  // For the app: athlete list (+ 365Scores team ids for the scoreboard)
  await writeJson(join(DATA, 'athletes.json'), {
    countries: Object.fromEntries(Object.entries(COUNTRIES).map(([k, v]) => [k, v.label])),
    nationalSquad: ilSquad.names,
    suggestions: athleteSuggestions(athletes, teamCache, edb, await readJson(join(ROOT, 'private', 'ignored.json'), [])),
    athletes: athletes.map((a) => ({ ...a, teamId: teamCache[`${a.sport}|${a.team}`]?.id ?? null, teamFull: teamCache[`${a.sport}|${a.team}`]?.name ?? null })),
  });
  await writeJson(join(DATA, 'sources.json'), { generatedAt: now, health });
  await writeJson(statePath, { savedAt: now, meta, teamCache, rivals, ilSquad, gameInfo, sums, signals: { ...signals, wiki: undefined }, wiki, tr, items: items.map(({ tr: _t, _tok, _key, ...rest }) => rest) });

  log(
    `[collect] fetched ${due.length}/${sources.length} sources (${results.filter((r) => !r.ok).length} failed) · ${fresh} new items · ${items.length} items · ${translated} translated · ${summarized} summaries fetched · ${stories.length} stories · ${Date.now() - started}ms`
  );
  results.forEach((r, i) => !r.ok && log(`   ✗ ${due[i].id}: ${String(r.error?.message || r.error).slice(0, 100)}`));
  return { stories: stories.length, fresh };
}

// Ranking boosts from real-world attention:
//   covered in several languages/countries, trending on Google searches, hot on Reddit
const GENERIC = new Set(['football', 'soccer', 'nba', 'basketball', 'live', 'score', 'scores', 'game', 'match', 'today', 'news', 'tv', 'israel', 'ישראל', 'weather', 'מזג אוויר']);
function applySignals(s, signals) {
  const text = ' ' + [s.t?.en?.title, s.title, s.t?.he?.title].filter(Boolean).join(' ').toLowerCase() + ' ';
  const tok = tokens(s.t?.en?.title || s.title);
  let boost = 1 + 0.2 * Math.max(0, s.langs.length - 1);

  // Google Trends: the trending term appears in the story, or the trend's own news headlines match it
  let trending = null;
  for (const tr of signals.trends || []) {
    // skip vague terms: single short words and generic ones ("Israel" would match everything)
    if (GENERIC.has(tr.term) || (!tr.term.includes(' ') && tr.term.length < 7)) continue;
    const inText = text.includes(' ' + tr.term + ' ') || text.includes(' ' + tr.term);
    const viaNews = !inText && tr.news.some((h) => overlap(tokens(h), tok) >= 4);
    if ((inText || viaNews) && (!trending || tr.traffic > trending.traffic)) trending = { term: tr.term, traffic: tr.traffic, geo: tr.geo };
  }
  if (trending) boost *= 1 + Math.min(0.6, Math.log10(Math.max(trending.traffic, 10)) / 8);

  // Reddit hot lists: similar headline near the top
  let reddit = null;
  for (const r of signals.reddit || []) {
    const t2 = tokens(r.title);
    const shared = overlap(t2, tok);
    if (shared >= 3 && shared / Math.min(t2.size, tok.size) >= 0.5 && (!reddit || r.rank < reddit.rank)) reddit = { rank: r.rank, sub: r.sub };
  }
  if (reddit) boost *= 1 + (31 - reddit.rank) / 60;

  // Wikipedia: a top-viewed article (yesterday) named in the story, or a spike for an Israeli abroad in it
  let wikipedia = null;
  for (const w of signals.wiki?.top || []) {
    const title = w.title.toLowerCase().replace(/ \(.*\)$/, ''); // "Name (footballer)" → "name"
    if (text.includes(title) && (!wikipedia || w.views > wikipedia.views)) {
      wikipedia = { title: w.title, wiki: w.wiki, views: w.views, ratio: w.prev ? Math.round((w.views / w.prev) * 10) / 10 : null };
    }
  }
  for (const name of s.athletes) {
    const a = signals.wiki?.athletes?.[name];
    if (a && a.ratio >= 3 && (!wikipedia || a.views > wikipedia.views)) wikipedia = { title: name, wiki: 'en+he', views: a.views, ratio: a.ratio };
  }
  if (wikipedia) boost *= 1 + Math.min(0.5, Math.log10(Math.max(wikipedia.views, 10)) / 12) * ((wikipedia.ratio || 1) >= 2 ? 1.3 : 1);

  const r2 = (x) => Math.round(x * 100) / 100;
  return { ...s, trending, reddit, wikipedia, score: r2(s.score * boost), pop: r2(s.pop * boost) };
}
// A rival-press article must name the opponent AND Israel / the Israeli team (in the original or the translation)
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function rivalRelevant(it) {
  const text = norm(`${it.title} ${it.tr?.en || ''}`);
  const words = norm(it.rival.opponent).split(/[^\p{L}]+/u).filter((w) => w.length >= 4);
  const namesOpponent = words.some((w) => text.includes(w));
  const namesIsrael = /israel|izrael|israil|maccabi|makabi|hapoel|ισραηλ|израел/.test(text);
  return namesOpponent && namesIsrael;
}
const overlap = (a, b) => {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
};

async function nationalSquad() {
  const names = [];
  for (const id of [5034, 1728]) {
    const res = await fetch(`https://webws.365scores.com/web/squads/?appTypeId=5&langId=1&timezoneName=UTC&userCountryId=6&competitors=${id}`, {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error('365 squads HTTP ' + res.status);
    for (const a of (await res.json()).squads?.[0]?.athletes || []) names.push(a.name);
  }
  return names;
}

// CLI
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  collect({ force: process.argv.includes('--force') }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
