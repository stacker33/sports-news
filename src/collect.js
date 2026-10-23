// Collector: fetch feeds → tag → merge duplicates → rank → write public/data/*.json
// Each source has its own interval (`every` minutes); sources not due keep their items from last run.
// Run once:  node src/collect.js
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SOURCES } from '../config/sources.js';
import { fetchFeed, pool } from './feeds.js';
import { classify, JUNK_TITLE, SITE_TITLE, isStreamSpam } from './classify.js';
import { trimLocal } from './trim.js';
import { editorialBoost, bigEvent, markLocal, markLow, memberLocal } from './editorial.js';
import { features, trainModel, predict, entitySport, decideSport, SURE } from './triage.js';
import { loadCorrections } from './corrections.js';
import { aiSummaries, aiCap, attachDesk } from './ai.js';
import { mergeSameEvent } from './merge.js';
import { telegramPost, adminHealthAlerts, adminHello, adminReports, adminSend, morningBrief } from './telegram.js';
import { loadFeedback, votesFile } from './feedback.js';
import { mailEnabled, sendMails } from './mailer.js';
import { processSourceRequests, userSources, builtinHosts, publicList } from './usersources.js';
import { processAthleteRequests, userAthletes, publicAthleteList } from './userathletes.js';
import { assignStoryIds } from './storyids.js';
import { addHebrewNames } from './hebrew.js';
import { sport5Coverage, sport5Probable } from './sport5.js';
import { clusterItems, buildStory, tokens } from './cluster.js';
import { translateItems } from './translate.js';
import { findRivalGames, rivalSources } from './rivals.js';
import { loadSignals } from './signals.js';
import { trendBoard, nextTrendSearches, trendSources, nextUserSearches, userSearchSources, FOLLOW_HOURS, TOPIC_DAYS } from './trends.js';
import { queryMetrics, discoveryDelay, usefulness, lowRankReasons } from './metrics.js';
import { loadWikipedia } from './wikipedia.js';
import { loadEntityDb, refreshEntityDb, buildEntityIndex, findEntities } from './entities.js';
import { fillSummaries } from './summaries.js';
import { athleteSuggestions } from './suggest.js';
import { translateTexts } from './translate.js';
import { loadGameInfo } from './gameinfo.js';
import { loadPlayerCards } from './playercards.js';

// The entity index is rebuilt only when the knowledge base changes
let entityCache = { key: '', index: null };
function entityIndex(db) {
  const key = `${db.teamsAt}|${Object.keys(db.players || {}).length}`;
  if (entityCache.key !== key) entityCache = { key, index: buildEntityIndex(db) };
  return entityCache.index;
}
import { loadAthletes, resolveTeams, athleteSources, buildMatchers, COUNTRIES } from './athletes.js';
import { loadWatchlist, loadVocabulary, buildWatchMatchers, annotateWatch, candidateQueries, planQueries, recordQueries, watchSources, norm as watchNorm, entryLocales, entryPriority, searchable, loadOverrides } from './watchlist.js';
import { setTracked } from './youtube.js';
import { storyEvidence, storyCoverage, storyViews, sport5Check } from './roles.js';
import { editorialRank, loadRankConfig, loadVocabulary as loadRankVocabulary } from './rank.js';
import { loadStateStrict, stateAgeNote, survivorDiagnostic, StateError } from './statecheck.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.RADAR_DATA_DIR || join(ROOT, 'public', 'data'); // the override is for tests
const KEEP_ITEMS_H = 48; // raw items remembered between runs
const KEEP_STORIES_H = 36; // stories shown in the app
const MAX_STORIES = 1200;
const COOLDOWN_MIN = 15; // after a source errors (e.g. Google rate-limit)
const WATCH_BUDGET = 6; // watchlist / discovery queries per run (src/watchlist.js)


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

// Keep at most `max` stories (sorted newest first): Israeli-angle stories first, then the newest; order kept
export function capStories(stories, max) {
  if (stories.length <= max) return stories;
  const keep = new Set(stories.filter((s) => s.israel || s.abroad || s.watchIsrael).slice(0, max));
  for (const s of stories) if (keep.size < max) keep.add(s);
  return stories.filter((s) => keep.has(s));
}

// force = fetch every source regardless of its interval (used after editing the athlete list)
export async function collect({ log = console.log, force = false } = {}) {
  const started = Date.now();
  await mkdir(DATA, { recursive: true });

  const statePath = join(DATA, 'state.json');
  // Required: a missing, cut-off or invalid state stops the run here, before any collection, notification, state
  // write or publication (src/statecheck.js). It never silently becomes an empty state.
  const state = await loadStateStrict(statePath);
  const ageNote = stateAgeNote(state);
  if (ageNote) log(ageNote);
  const baseline = state.items.map((i) => ({ id: i.id, published: i.published })); // for the survivor diagnostic
  const meta = state.meta || {}; // per-source { last, cooldownUntil, ok, count, error }
  const known = new Map(state.items.map((i) => [i.id, i]));

  // Israelis abroad
  const builtinAthletes = await loadAthletes(ROOT);
  // + players / coaches editors suggested from the page and the admin approved (src/userathletes.js)
  const athletes = [...builtinAthletes, ...userAthletes(state.userAthletes, builtinAthletes)];
  const teamCache = await resolveTeams(athletes, state.teamCache || {});
  const ctx = {
    matchers: buildMatchers(athletes, teamCache),
    athleteSport: Object.fromEntries(athletes.map((a) => [a.name, a.sport])),
  };

  // Watchlist (verified registry + bounded discovery queries); YouTube keeps a podcast / women's / youth video
  // only when it names someone tracked
  const watchEntries = await loadWatchlist(ROOT);
  const watchMatch = buildWatchMatchers(watchEntries);
  setTracked((title) => ctx.matchers.players(String(title).toLowerCase()).length > 0 || watchMatch(title).some((h) => h.israelLink));
  const editorsNames = new Set(athletes.map((a) => watchNorm(a.name)));
  const vocab = await loadVocabulary(ROOT);
  const watchCandidates = candidateQueries(watchEntries, vocab, { skipNames: editorsNames });

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

  // Player cards (club, league position, last / next game, season stats), a few players per run
  const cards = await loadPlayerCards(athletes, teamCache, state.cards, now).catch(() => state.cards || { cards: {} });

  let ilSquad = state.ilSquad || { at: 0, names: [] };
  if (force || now - ilSquad.at > 24 * 3600e3) {
    try {
      ilSquad = { at: now, names: await nationalSquad() };
    } catch {}
  }

  const watchPlan = planQueries(watchCandidates, state.watchSched, { now, budget: WATCH_BUDGET });
  // userSources: sites editors added from the page and the admin approved (src/usersources.js)
  const sources = [...SOURCES, ...userSources(state.userSources), ...athleteSources(athletes, teamCache), ...rivalSources(rivals.games), ...trendSources(state.trendSearch), ...userSearchSources(state.userSearch), ...watchSources(watchPlan.run)];
  const srcById = new Map(sources.map((s) => [s.id, s]));
  const due = sources.filter((s) => {
    const m = meta[s.id];
    if (!m || force) return true;
    if (m.cooldownUntil && now < m.cooldownUntil) return false;
    const every = s.every ?? (s.google ? 3 : 1);
    return now - (m.last || 0) >= every * 60000 - 15000;
  });

  const results = await pool(due, 12, (s) => fetchFeed(s));
  // watch query schedule: success resets, failure backs off; queries no longer generated are forgotten
  const watchRun = watchPlan.run.filter((c) => due.some((d) => d.id === c.id));
  const watchSched = recordQueries(state.watchSched, watchRun, watchRun.map((c) => {
    const r = results[due.findIndex((d) => d.id === c.id)];
    return r?.ok ? { ok: true, count: r.value.length } : { ok: false };
  }), now, new Set(watchCandidates.map((c) => c.id)));
  // what was filtered out and why (diagnostics for misses): article link → { t, src, title, link, why }
  const rejected = new Map((state.rejected || []).filter((r) => now - r.at < 24 * 3600e3).map((r) => [r.link, r]));
  const reject = (raw, src, why) => rejected.set(raw.link, { at: now, t: raw.published || now, src: src.name, sid: src.id, title: String(raw.title).slice(0, 200), link: raw.link, why });
  let fresh = 0;
  const dropped = Object.fromEntries(Object.entries(state.dropped || {}).filter(([, until]) => until > now));

  results.forEach((r, idx) => {
    const src = due[idx];
    if (!r.ok) {
      const error = String(r.error?.message || r.error).slice(0, 120);
      meta[src.id] = { ...meta[src.id], last: now, ok: false, error, cooldownUntil: now + COOLDOWN_MIN * 60000, failStreak: (meta[src.id]?.failStreak || 0) + 1 };
      return;
    }
    const firstRead = !meta[src.id]?.okOnce; // never read this source successfully before
    meta[src.id] = { last: now, ok: true, okOnce: true, count: r.value.length, lastOk: now, failStreak: 0 };

    for (const raw of r.value) {
      // Skip navigation junk (e.g. 'News / EuroLeague / Leagues') and tiny titles
      if (raw.title.length < 12 || raw.title.split(' / ').length > 2) continue;
      // betting / odds / live-score widget pages (any language) are not news
      if (JUNK_TITLE.test(raw.title) || isStreamSpam(raw.title)) { reject(raw, src, 'junk'); continue; }
      // a site's own name/homepage instead of a headline (Google sometimes returns "- sport5.co.il")
      if (SITE_TITLE.test(raw.title)) { reject(raw, src, 'site-title'); continue; }

      const id = itemId(raw.link, raw.title);
      if (dropped[id] > now) continue; // trimmed from the memory earlier (src/trim.js)
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
      if (src.mixed && !tags.looksSport) { reject(raw, src, 'general-feed'); continue; }

      const item = {
        id,
        title: raw.title,
        link: raw.link,
        summary: raw.summary,
        image: raw.image,
        publisher: raw.publisher,
        sourceId: src.id,
        // discovery provenance: the source / query that found it first, and every source that found it since
        // (items collected before provenance existed: their last source and first-seen time, marked approximate)
        via: prev?.via || (prev ? { src: prev.sourceId, at: prev.seen ?? prev.published, approx: true } : { src: src.id, at: now }),
        paths: [...new Set([...(prev?.paths || (prev ? [prev.sourceId] : [])), src.id])].slice(0, 10),
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
        reporter: src.reporter ?? !!raw.social, // a reporter (their own post, or their site); outlets' accounts set reporter: false
        official: !!src.official, // a club / league / federation channel
        video: raw.video || null, // YouTube: 'press' | 'highlights'
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
  // protect Hebrew names from prefix stripping ("מכבי" must not become "כבי") — src/hebrew.js
  addHebrewNames([...Object.values(edb.teams || {}).map((t) => t.he), ...Object.values(edb.players || {}).map((p) => p.he), ...athletes.flatMap((a) => [a.name_he, a.team_he])]);
  const entById = new Map();
  // every competition a story touches (for the league filter): named in an article, or a named team / a named
  // player's team plays in it (365Scores competition ids → our tags)
  const COMP_OF_365 = { 42: 'c-ligat', 43: 'c-leumit', 7: 'c-epl', 11: 'c-laliga', 17: 'c-seriea', 25: 'c-bundes', 35: 'c-ligue1', 572: 'c-ucl', 573: 'c-uel', 7685: 'c-uecl', 47: 'c-winner', 569: 'c-euroleague', 329: 'c-eurocup', 103: 'c-nba' };
  const teamComps = (teamId) => (edb.teams?.[String(teamId).slice(1)]?.comps || []).map((c) => COMP_OF_365[c]).filter(Boolean);
  const storyComps = (members) => {
    const set = new Set();
    for (const m of members) for (const id of m.ents || []) {
      if (id.startsWith('c-')) set.add(id);
      const e = entById.get(id);
      if (e?.k === 'team') teamComps(id).forEach((c) => set.add(c));
      else if (e?.k === 'player' && e.team) teamComps(e.team).forEach((c) => set.add(c));
    }
    return [...set];
  };

  // Readers' 🏷️ corrections (sport / Israeli / not relevant), per article link
  const { corrections, added: fixesAdded } = await loadCorrections(state.corrections, now);

  // (Re-)tag every item: uses the English translation for foreign languages, and picks up list edits immediately
  // Pass 1: keyword/section evidence + knowledge-base names (sport-neutral)
  for (const it of items) {
    it.tr = tr[it.id] || null;
    const src = srcById.get(it.sourceId) || {};
    it.hiddenWhy = SITE_TITLE.test(it.title) || JUNK_TITLE.test(it.title) ? 'junk' : it.rival && !rivalRelevant(it) ? 'rival' : null;
    it.hidden = !!it.hiddenWhy;
    const en = it.lang !== 'en' && it.tr?.en ? ' ' + it.tr.en : '';
    const tags = classify({ title: it.title + en, summary: it.summary, link: it.link }, src, ctx);
    if (src.mixed && !tags.looksSport) [it.hidden, it.hiddenWhy] = [true, 'general-feed']; // general-news feeds: sport only
    it.assist = !!src.assist;
    Object.assign(it, {
      sport: tags.sport, israel: tags.israel, israelOther: tags.israelOther,
      athletes: tags.athletes, teams: tags.teams, breaking: tags.breaking,
    });
    it._ev = tags.ev;
    const found = [...findEntities(eindex, it.title, null), ...findEntities(eindex, it.tr?.en, null)];
    it._entSport = entitySport(found);
    it._amb = [...new Set(found.filter((e) => e.amb && e.k === 'team').map((e) => e.en))]; // clubs in both sports
    it._feats = features(it);
    it._fix = corrections.byLink[it.link] || null;
  }
  // Pass 2: a word model trained on the articles whose sport is certain (site section, sport feed, or names)
  // (+ articles whose keywords point only to other sports: otherwise "other" has too few examples and
  //  unknown sports — baseball, tennis, motor racing — get guessed as football)
  const confirmedFix = (f) => (f?.sport && (f.devices?.length || 0) >= 2 ? f.sport : null);
  const onlyOther = (ev) => ev.kw.o >= 2 && !ev.kw.f && !ev.kw.b ? 'other' : null;
  const samples = items
    .filter((it) => confirmedFix(it._fix) || it._ev.url || it._ev.source || it._entSport || onlyOther(it._ev))
    .flatMap((it) => {
      const s = { feats: it._feats, sport: confirmedFix(it._fix) || it._ev.url || onlyOther(it._ev) || it._ev.source || it._entSport };
      return [s]; // (corrections train only when two devices agree — see the filter above)
    });
  const model = trainModel(samples);
  const decisions = items.map((it) => (it._fix?.sport ? { sport: it._fix.sport, why: 'user' } : decideSport(it._ev, it._entSport, predict(model, it._feats), it._feats)));
  // What's in the news right now: a club that exists in both sports (Maccabi Tel Aviv, Hapoel Tel Aviv…) is
  // usually in the news for one of them (EuroLeague week, football's international break). Certain articles
  // from the last 24h decide unclear ones.
  const recent = new Map(); // club → { football, basketball }
  items.forEach((it, i) => {
    const d = decisions[i];
    if (!SURE.has(d.why) || now - it.published > 24 * 3600e3 || (d.sport !== 'football' && d.sport !== 'basketball')) return;
    for (const club of it._amb) {
      const r = recent.get(club) || recent.set(club, { football: 0, basketball: 0 }).get(club);
      r[d.sport]++;
    }
  });
  const why = {};
  items.forEach((it, i) => {
    let d = decisions[i];
    if (!SURE.has(d.why) && !d.nonSport && it._amb.length && (d.sport === 'football' || d.sport === 'basketball' || d.why === 'none')) {
      const r = { football: 0, basketball: 0 };
      for (const club of it._amb) for (const s of ['football', 'basketball']) r[s] += recent.get(club)?.[s] || 0;
      const [top, n] = Object.entries(r).sort((a, b) => b[1] - a[1])[0];
      const other = r[top === 'football' ? 'basketball' : 'football'];
      if (n >= 3 && n >= 3 * other) d = { sport: top, why: 'in-the-news' };
    }
    it.sport = d.sport;
    it.sportSure = SURE.has(d.why);
    it.sportWhy = d.why; // kept for debugging the triage
    if (d.nonSport) [it.hidden, it.hiddenWhy] = [true, d.why === 'section' ? 'section' : 'no-sport']; // cars, politics… in a sports section
    why[d.why] = (why[d.why] || 0) + 1;
    it._ents = [...findEntities(eindex, it.title, it.sport), ...findEntities(eindex, it.tr?.en, it.sport)];
    delete it._ev;
    delete it._entSport;
    delete it._feats;
    delete it._amb;
  });
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
      if (e.k === 'comp') return !e.sport || it.sport === 'other' || e.sport === it.sport;
      if (it.sport === 'other') return false;
      if (e.sport && e.sport !== it.sport) return false;
      if (e.k === 'player' && e.single) return fullSeen.has(e.id) || teamIds.has(e.team);
      return true;
    });
    for (const e of keep) entById.set(e.id, e);
    // a foreign article about Maccabi / Hapoel / Beitar… → Israeli sport tabs too
    const ilTeam = keep.find((e) => e.k === 'team' && (edb.teams[e.id.slice(1)]?.comps || []).some((x) => x === 42 || x === 43 || x === 47));
    if (ilTeam) {
      it.israel = true;
      if (it.sport === 'other' && ilTeam.sport) it.sport = ilTeam.sport;
    }
    it.ents = [...new Set(keep.map((e) => e.id))];
    delete it._ents;
  }
  for (const it of items) {
    // highlights from the big global channels (NBA, EuroLeague…) only when an Israeli club or player is in them
    if (it.video === 'highlights' && !srcById.get(it.sourceId)?.israel && !it.israel && !it.athletes?.length) [it.hidden, it.hiddenWhy] = [true, 'video'];
    if (it._fix?.israel != null) it.israel = it._fix.israel;
    if (it._fix?.hide) [it.hidden, it.hiddenWhy] = [true, 'user'];
    delete it._fix;
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
    const seenName = new Set(); // same name in two sports (Real Madrid football + basketball) → show once
    return [...comps, ...teams.map((e) => ({ ...e, il: isIl(e) || undefined })), ...players].filter((e) => !seenName.has(e.k + e.en) && seenName.add(e.k + e.en)).map(({ k, id, en, he, il }) => ({ k, id, en, he, ...(il ? { il: true } : {}) }));
  }

  // stable story ids across runs (see src/storyids.js)
  // + the same event across languages, once the language model has written its card (src/merge.js)
  const clusters = mergeSameEvent(clusterItems(items.filter((i) => !i.hidden)), state.ai?.desk);
  const { ids: storyIdList, map: storyIds } = assignStoryIds(clusters, state.storyIds);
  const stories = clusters
    .map((members, i) => {
      const comps = storyComps(members);
      return { ...buildStory(members, now), id: storyIdList[i], tags: storyTags(members), ...(comps.length ? { comps } : {}), _members: members };
    })
    .map((s) => ({ ...s, s5: sport5Coverage(s) })) // did Sport5 already cover it? (for the Sport5 editors)
    .filter((s) => now - s.latest <= KEEP_STORIES_H * 3600000)
    .map((s) => applySignals(s, signals))
    .map((s) => ({ ...s, big: s.sourceCount >= 3 || s.langs.length >= 3 || !!s.trending || ((s.top || s.breaking) && s.sourceCount >= 2) }))
    // watchlist people / clubs named in the story (only verified entries may carry an Israel link)
    .map((s) => annotateWatch(s, watchMatch))
    // Other sports (NFL, MLB, NHL, tennis, cycling…): only big events — finals, Grand Slams, Grand Prix, Olympics… —
    // or a story carried internationally (8+ sources in 3+ languages); anything Israeli is always kept
    // other sports: only with a reason (an editor's topic search found it is one)
    .filter((s) => s.sport !== 'other' || s.israel || s.abroad || s.watchIsrael || (s.sourceCount >= 8 && s.langs.length >= 3) || bigEvent(s) || s._members.some((m) => srcById.get(m.sourceId)?.topic))
    // editors' priorities: big competitions, transfers and scoops up; betting / how-to-watch / live blogs down
    .map(editorialBoost)
    // what the story is about, judged by the language model on an earlier run (src/ai.js): decides off-beat first
    .map((s) => attachDesk([s], state.ai)[0])
    // local leagues (Greece, Portugal, Turkey…): low and out of Hot / brief / Telegram unless there's a reason
    .map((s) => markLocal(s, (m) => memberLocal(m, srcById.get(m.sourceId))))
    .map(markLow) // tickets, polls, live streams: collapsed in the world tabs
    // Direct national outlets ("assist"): their local-only stories need a known team/player or an Israeli angle
    .filter((s) => !s._members.every((m) => m.assist) || s.israel || s.abroad || s.teams.length || s.trending || s.tags.some((t) => t.k === 'team' || t.k === 'player'))
    .sort((a, b) => b.latest - a.latest);
  // The cap keeps the newest stories, but an Israeli-angle story inside the 36-hour window is never cut for space
  // (found by the evaluation set: a day-old Spanish story about Roy Revivo was dropped for space)
  stories.splice(0, stories.length, ...capStories(stories, MAX_STORIES));

  // Sport5 coverage, second check: same-day Sport5 article about the same thing worded differently
  const s5probable = sport5Probable(stories, items, tokens);
  // Source roles, evidence, truthful coverage, views and the editorial rank (src/roles.js, src/rank.js).
  // Votes come from the previous run's feedback (loaded later in this run).
  const s5check = sport5Check(meta, now);
  const rankCfg = loadRankConfig(join(ROOT, 'config', 'editorial-rank.json'));
  loadRankVocabulary(join(ROOT, 'config', 'vocabulary.json')); // the editors' keyword list for news value
  const heOf = new Map(athletes.filter((a) => a.name_he).map((a) => [a.name, a.name_he]));
  const heName = (n) => heOf.get(n) || n;
  for (const s of stories) {
    const { roles, ...ev } = storyEvidence(s, (m) => srcById.get(m.sourceId));
    for (const x of s.sources) if (roles[x.link]) [x.o, x.r] = roles[x.link];
    // Israeli sites are shown only in Israeli monitoring: for a story with both, the foreign report the other tabs
    // show instead (its own headline, translated; never an Israeli outlet's headline, link, picture or video)
    const foreignM = s._members.filter((m) => roles[m.link]?.[0] !== 'il');
    if (ev.il > 0 && foreignM.length) {
      const f = foreignM.find((m) => m.link === ev.lead?.link) || [...foreignM].sort((a, b) => (b.google ? 0 : 1) - (a.google ? 0 : 1) || b.weight - a.weight || a.published - b.published)[0];
      const trF = tr[f.id] || {};
      const pick = (lang) => (f.lang === lang ? { title: f.title, link: f.link } : trF[lang] ? { title: trF[lang], link: f.link, from: f.lang } : null);
      const pubs = new Set(foreignM.map((m) => String(m.publisher || '').toLowerCase()));
      s.fv = { title: f.title, link: f.link, lang: f.lang, t: { he: pick('he'), en: pick('en') }, image: f.image || foreignM.find((m) => m.image)?.image || null, video: foreignM.find((m) => m.video)?.link || null, sourceCount: pubs.size, langs: [...new Set(foreignM.map((m) => m.lang))] };
    }
    // found by an editor's topic search ("my topics"): the page marks these as new from the search
    const found = [...new Set(s._members.map((m) => srcById.get(m.sourceId)).filter((x) => x?.topic).map((x) => x.trend))];
    if (found.length) s.found = found;
    s.ev = ev;
    s.cov = storyCoverage(s, s5check, ev);
    s.v = storyViews(s, ev);
    s.ed = editorialRank(s, { now, cfg: rankCfg, votes: state.feedback?.votes?.[s.id], heName });
  }
  // quality numbers for the watchlist page (src/metrics.js): measured, never fed back into collection
  const rejectedNow = [...rejected.values()];
  const quality = {
    queries: queryMetrics(stories, new Set(watchCandidates.map((c) => c.id)), rejectedNow),
    delay: discoveryDelay(items),
    usefulness: usefulness(state.feedback?.votes, stories),
    low: lowRankReasons(stories, rejectedNow),
  };

  // Summaries: feed descriptions + article pages, most important stories first (Israeli / abroad, then popular & fresh)
  const sums = state.sums || {};
  const priority = [...stories]
    .filter((s) => now - s.first < 18 * 3600e3)
    .sort((a, b) => b.score - a.score); // most important first — world and Israeli alike
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
  // Hebrew headline + 2–3 sentence summary by a language model (GitHub Models, free tier; important stories first)
  // the knowledge base's Hebrew spelling of every team / player / competition named in the story → the model
  for (const s of stories) {
    const pairs = new Map();
    for (const m of s._members) for (const id of m.ents || []) {
      const e = entById.get(id);
      if (e?.en && e.he && e.he !== e.en && /[א-ת]/.test(e.he)) pairs.set(e.en, e.he);
    }
    s._names = [...pairs].slice(0, 14);
  }
  // today's Sport5 homepage headlines: the style the editors write in
  const styleHeads = items.filter((i) => i.sourceId === 'sport5-home' && i.title.length > 20).sort((a, b) => b.published - a.published).slice(0, 10).map((i) => i.title);
  const { ai, done: aiDone } = await aiSummaries(stories, sums, state.ai, now, heOfAthlete, { styleHeads }).catch((e) => ({ ai: { ...(state.ai || {}), error: String(e.message) }, done: 0 }));
  // Telegram channel: morning briefing + alerts (only when the bot token and channel are configured)
  const { tg, posted: tgPosted } = await telegramPost(stories, { athletes, cards: cards.cards || {}, gameInfo: gameInfo.games || {}, siteUrl: 'https://stacker33.github.io/sports-news/', translate: (texts) => translateTexts(texts, 'auto', 'he') }, state.tg, now).catch((e) => ({ tg: { ...(state.tg || {}), error: String(e.message) }, posted: 0 }));
  // 🔥 trends panel (sports only) + news searches for sports trends we have no story on yet
  const isAbroad = (text) => ctx.matchers.players(' ' + String(text).toLowerCase() + ' ').length > 0;
  const trends = trendBoard(signals, stories, isAbroad, athletes, now);
  const trendSearch = nextTrendSearches(trends, state.trendSearch, now);
  // ☀️ the morning's list, pinned on the site until noon
  const brief = morningBrief(stories, state.brief, now);
  const shownIds = new Set(); // articles in a published story (for the save-time trim)
  for (const s of stories) {
    for (const m of s._members) shownIds.add(m.id);
    if (s.sum) Object.assign(s.sum, { he: sums[s.sum.id]?.he, en: sums[s.sum.id]?.en });
    delete s._members;
    delete s._names;
  }
  for (const id of Object.keys(sums)) if (!liveIds.has(id)) delete sums[id];

  const health = sources.filter((s) => !s.trend && !s.watch).map((s) => ({ id: s.id, name: s.name, ok: meta[s.id]?.ok !== false, count: meta[s.id]?.count ?? 0, error: meta[s.id]?.error }));
  const okCount = health.filter((h) => h.ok).length;

  // evidence for the app: the lead points into the story's sources when it is one of them (no repeated long links)
  const slimEv = (s) => {
    const { lead, outlets, il, foreign, attrib, attribBy, official, reporter } = s.ev;
    const i = lead ? s.sources.slice(0, 8).findIndex((x) => x.link === lead.link) : -1;
    const l = lead && { name: lead.name, status: lead.status, origin: lead.origin, role: lead.role, ...(i >= 0 ? { i } : { link: lead.link }) };
    return { lead: l, outlets, il, foreign, ...(attrib ? { attrib, attribBy } : {}), ...(official ? { official } : {}), ...(reporter ? { reporter } : {}) };
  };
  // What the app needs, nothing more (phones): ≤8 sources per story, no repeated links, no unused fields
  const slim = (s) => {
    const { summary: _s, seen: _seen, ...rest } = s;
    const t = {};
    for (const lang of ['he', 'en']) if (s.t?.[lang]) t[lang] = s.t[lang].link === s.link ? { ...s.t[lang], link: undefined } : s.t[lang];
    return {
      ...rest,
      t,
      sources: s.sources.slice(0, 8).map(({ name, title, link, published, unknown, o, r }) => ({ name, title, link, published, ...(unknown ? { unknown } : {}), ...(o ? { o, r } : {}) })),
      sum: s.ai?.he?.sum ? undefined : s.sum, // the language model's summary replaces the feed blurb
      ...(s.ed ? { ed: { score: s.ed.score, reasons: s.ed.reasons, limits: s.ed.limits.map((l) => l.k).filter((k) => k !== 'headline'), ...(s.ed.votes ? { votes: s.ed.votes } : {}) } } : {}),
      ...(s.ev ? { ev: slimEv(s) } : {}),
    };
  };
  // First screen: the newest 300 + everything Israeli / Israelis abroad + the night summary's stories (they're from
  // the night, so mostly not among the newest: the summary card waited for the second file); the rest loads right after
  const byNew = [...stories].sort((a, b) => b.first - a.first);
  const briefIds = new Set(brief?.ids || []);
  const firstIds = new Set([...byNew.slice(0, 300), ...stories.filter((s) => s.israel || s.abroad || briefIds.has(s.id))].map((s) => s.id));
  const head = { generatedAt: now, tookMs: Date.now() - started, sources: { total: sources.length, ok: okCount, fetched: due.length } };
  // The watchlist page's data: every entry with its state, every query with why it exists, its schedule and its value
  const hitsBy = {};
  for (const s of stories) for (const h of s.watch || []) hitsBy[h.id] = (hitsBy[h.id] || 0) + 1;
  const deferredBy = new Map(watchPlan.deferred.map((d) => [d.id, d]));
  const ranIds = new Set(watchRun.map((c) => c.id));
  await writeJson(join(DATA, 'watch.json'), {
    generatedAt: now,
    registry: { verified: watchEntries.filter((e) => e.status === 'verified').length, pending: watchEntries.filter((e) => e.status === 'pending').length, sourceOnly: watchEntries.filter((e) => e.status === 'source-only').length },
    budget: WATCH_BUDGET,
    entries: watchEntries.map((e) => ({
      id: e.id, name: e.name, he: e.he || '', aliases: e.aliases || [], type: e.type, sport: e.sport, category: e.category, status: e.status,
      basis: e.israelLink?.basis || null, note: e.israelLink?.note || e.why || '', team: e.team?.en || '', ambiguous: !!e.ambiguous,
      enabled: e.enabled !== false, priority: entryPriority(e), langs: entryLocales(e), ...(e.until ? { until: e.until } : {}),
      searched: searchable(e, editorsNames), queries: watchCandidates.filter((c) => c.entryIds.includes(e.id)).map((c) => c.id), hits: hitsBy[e.id] || 0,
    })),
    queries: watchCandidates.map((c) => ({
      id: c.id, mode: c.mode, ...(c.family ? { family: c.family } : {}), priority: c.priority, locale: c.locale, q: c.q, why: c.why, entryIds: c.entryIds,
      last: watchSched[c.id]?.last || null, fails: watchSched[c.id]?.fails || 0, count: watchSched[c.id]?.count ?? null, error: meta[c.id]?.ok === false ? meta[c.id].error : null,
      state: ranIds.has(c.id) ? 'ran' : deferredBy.get(c.id)?.why || 'not due yet', nextAt: deferredBy.get(c.id)?.nextAt || null,
      value: quality.queries[c.id] || null,
    })),
    families: ['israeliAngle', 'exceptional'].map((key) => ({ key, enabled: vocab.familyOverrides?.[key]?.enabled !== false, priority: vocab.familyOverrides?.[key]?.priority || null, queries: (vocab.querySets?.[key] || []).length })),
    // temporary "follow in the radar" searches (an active collection subscription, unlike a saved display topic)
    follows: Object.entries(state.userSearch || {}).map(([q, t]) => ({ q, since: t.since, topic: !!t.topic, expires: t.since + (t.topic ? TOPIC_DAYS * 864e5 : FOLLOW_HOURS * 3600e3) })),
    overrides: await loadOverrides(ROOT), // the current editor decisions (the page starts its draft from these)
    hits: stories.filter((s) => s.watch).length,
    quality: { ...quality, queries: undefined },
  });
  await writeJson(join(DATA, 'news-more.json'), { generatedAt: now, stories: stories.filter((s) => !firstIds.has(s.id)).map(slim) });
  await writeJson(join(DATA, 'news.json'), {
    ...head,
    more: stories.length - firstIds.size, // how many stories news-more.json holds
    rivals: rivals.games,
    gameInfo: gameInfo.games,
    ...(brief ? { brief } : {}),
    trends,
    wikiAthletes: wiki.athletes || {},
    mail: mailEnabled(), // the page sends ✉️ through the radar's mailbox (otherwise it opens the editor's mail program)
    stories: stories.filter((s) => firstIds.has(s.id)).map(slim),
  });
  // the page checks this tiny file every 30 s and downloads the news files only when it changed
  await writeJson(join(DATA, 'version.json'), { generatedAt: now });
  // For the app: athlete list (+ 365Scores team ids for the scoreboard)
  await writeJson(join(DATA, 'athletes.json'), {
    countries: Object.fromEntries(Object.entries(COUNTRIES).map(([k, v]) => [k, v.label])),
    nationalSquad: ilSquad.names,
    cards: cards.cards,
    suggestions: athleteSuggestions(athletes, teamCache, edb, await readJson(join(ROOT, 'private', 'ignored.json'), [])),
    athletes: athletes.map((a) => ({ ...a, teamId: teamCache[`${a.sport}|${a.team}`]?.id ?? null, teamFull: teamCache[`${a.sport}|${a.team}`]?.name ?? null, ...(a.team2 ? { teamId2: teamCache[`${a.sport}|${a.team2}`]?.id ?? null } : {}) })),
  });
  // Source health for the "system" panel: last check, last success, consecutive failures; quiet ≠ failed
  const sourceHealth = sources.filter((s) => !s.trend && !s.watch).map((s) => {
    const m = meta[s.id] || {};
    return { id: s.id, name: s.name, ok: m.ok !== false, last: m.last || null, lastOk: m.lastOk || (m.ok ? m.last : null), failStreak: m.failStreak || 0, count: m.count ?? 0, error: m.ok === false ? m.error : undefined };
  });
  // Rejected items of the last 24h (filtered at intake + hidden later), newest first — diagnostics for misses
  for (const it of items) if (it.hidden && now - it.seen < 24 * 3600e3) rejected.set(it.link, { at: now, t: it.published, src: srcById.get(it.sourceId)?.name || it.publisher, title: it.title.slice(0, 200), link: it.link, why: it.hiddenWhy || 'hidden' });
  const rejectedList = [...rejected.values()].sort((a, b) => b.t - a.t).slice(0, 500);
  await writeJson(join(DATA, 'rejected.json'), { generatedAt: now, items: rejectedList });
  // Alert the admin (private Telegram chat) about sources down for 2h+ — once a day per source
  const healthAlerts = await adminHealthAlerts(sourceHealth, state.healthAlerts || {}, now).catch(() => state.healthAlerts || {});
  const adminGreeted = await adminHello(state.adminGreeted).catch(() => state.adminGreeted || null);
  // Editors' feedback: 📣 reports → admin's Telegram; 👍/👎 votes → data/votes.json (the pilot's labelled set)
  const { feedback, reports, searches, mails, sourceReqs, athleteReqs, decisions: srcDecisions } = await loadFeedback(state.feedback, now);
  const userSearch = nextUserSearches(state.userSearch, searches, now); // fetched from the next run on
  const reportsSent = await adminReports(reports).catch(() => 0);
  await writeJson(join(DATA, 'votes.json'), votesFile(feedback, now));
  // ✉️ stories editors sent to web@sport5.co.il, from the radar's own mailbox (src/mailer.js)
  const { mail, sent: mailsSent, newError: mailError } = await sendMails(state.mail, mails, now).catch((e) => ({ mail: { ...(state.mail || {}), error: String(e.message) }, sent: 0, newError: null }));
  if (mailError) await adminSend(`✉️ <b>רדאר ספורט: שליחת מייל נכשלה</b>\n${mailError.replace(/[<>&]/g, '')}\nהידיעות ממתינות וינסו שוב בריצות הבאות. לא תקבל על זה הודעה נוספת היום.`).catch(() => {});
  if (mailsSent) log(`[mail] sent ${mailsSent} to web@sport5.co.il`);
  // ➕ sites editors asked to add: the admin approves each one in Telegram; approved ones are read from the next run
  const { userSources: userSourcesSt } = await processSourceRequests(state.userSources, sourceReqs, { now, known: builtinHosts(SOURCES), decisions: srcDecisions }).catch((e) => ({ userSources: { ...(state.userSources || {}), error: String(e.message) } }));
  // ✈️ Israelis abroad editors suggested: the admin approves each one; approved ones are tracked from the next run
  const { userAthletes: userAthletesSt } = await processAthleteRequests(state.userAthletes, athleteReqs, { now, builtin: builtinAthletes, decisions: srcDecisions }).catch((e) => ({ userAthletes: { ...(state.userAthletes || {}), error: String(e.message) } }));
  await writeJson(join(DATA, 'sources.json'), {
    generatedAt: now,
    tookMs: Date.now() - started,
    ai: { ok: !ai.error, error: ai.error || null, used: ai.used || 0, cap: aiCap(), tokens: ai.tokens || 0, model: ai.model || null },
    health: sourceHealth,
    userSources: publicList(userSourcesSt),
    athleteRequests: publicAthleteList(userAthletesSt),
    // sites already read (built-in + approved): the page tells an editor at once that a site is already in the radar
    knownHosts: [...new Set([...builtinHosts(SOURCES), ...(userSourcesSt.list || []).filter((e) => e.status === 'approved' || e.status === 'pending').map((e) => e.host)])].sort(),
  });
  log(survivorDiagnostic(baseline, items, now, KEEP_ITEMS_H * 3600000).text); // diagnostic only, never blocks
  // Save-time trim (src/trim.js): local-source articles with nothing to show; their ids are remembered for 48 hours
  // so the feed can't bring them back as new
  const { keep: keepItems, trimmed } = trimLocal(items, { now, shownIds });
  for (const it of trimmed) dropped[it.id] = now + KEEP_ITEMS_H * 3600e3;
  for (const it of trimmed) delete tr[it.id];
  if (trimmed.length) log(`[trim] ${trimmed.length} local-source articles with nothing to show dropped from the memory`);
  await writeJson(statePath, { savedAt: now, meta, teamCache, rivals, ilSquad, gameInfo, cards, sums, signals: { ...signals, wiki: undefined }, wiki, tr, corrections, ai, tg, brief, trendSearch, userSearch, watchSched, storyIds, rejected: rejectedList.slice(0, 300), healthAlerts, adminGreeted, feedback, mail, userSources: userSourcesSt, userAthletes: userAthletesSt, dropped, items: keepItems.map(({ tr: _t, _tok, _key, _fix, _match, ...rest }) => rest) });

  log(
    `[collect] fetched ${due.length}/${sources.length} sources (${results.filter((r) => !r.ok).length} failed) · ${fresh} new items · ${items.length} items · ${translated} translated · ${summarized} summaries fetched · ${stories.length} stories · ${Date.now() - started}ms`
  );
  log(
    `   Sport5: +${s5probable} probably covered · Telegram: ${tgPosted} posted · reports forwarded: ${reportsSent}${tg.error ? ` (${tg.error})` : ''} · AI summaries: ${aiDone} new, ${ai.used || 0} requests today${ai.error ? ` (error: ${ai.error})` : ''} · ${Object.keys(corrections.byLink).length} corrected articles (${fixesAdded} new) · sport decided by: ${Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`
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
  collect({ force: process.argv.includes('--force') }).catch(async (e) => {
    console.error(e);
    // a state problem leaves a short sanitized code for the admin alert, outside the published directory
    if (e instanceof StateError) {
      await writeFile(process.env.STATE_ERROR_FILE || join(ROOT, '.state-error'), `state:${e.code}\n`).catch(() => {});
    }
    process.exit(1);
  });
}
