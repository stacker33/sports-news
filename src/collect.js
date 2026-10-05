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
import { features, trainModel, predict, entitySport, decideSport, SURE } from './triage.js';
import { loadCorrections } from './corrections.js';
import { aiSummaries, aiCap } from './ai.js';
import { telegramPost, adminHealthAlerts, adminHello, adminReports, morningBrief } from './telegram.js';
import { loadFeedback, votesFile } from './feedback.js';
import { assignStoryIds } from './storyids.js';
import { addHebrewNames } from './hebrew.js';
import { sport5Coverage, sport5Probable } from './sport5.js';
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
import { loadPlayerCards } from './playercards.js';

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

const SITE_TITLE = /^[-–\s]*[a-z0-9.-]+\.(com|net|org|co\.il|co\.uk)\s*$|אתר ערוץ הספורט/i;
const JUNK_TITLE = /\b(odds(?!-on)|betting tips|bet365|predictions? (and|&) (picks|tips)|picks and predictions?|live scores?|related matches|match centre|melhores odds|apuestas|pron[oó]stico|cuotas|quote e pronostici|scommesse|wettquoten|cotes|bahis oranlar[ıi]|στοίχημα|kvote|ao vivo|en vivo|en directo|minuto a minuto|in diretta|liveticker|per 90|stats for .{2,40}?\d{4}\/\d{4}|fantasy|start.{0,4}sit)\b/i;

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

  // Player cards (club, league position, last / next game, season stats), a few players per run
  const cards = await loadPlayerCards(athletes, teamCache, state.cards, now).catch(() => state.cards || { cards: {} });

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
  // what was filtered out and why (diagnostics for misses): article link → { t, src, title, link, why }
  const rejected = new Map((state.rejected || []).filter((r) => now - r.at < 24 * 3600e3).map((r) => [r.link, r]));
  const reject = (raw, src, why) => rejected.set(raw.link, { at: now, t: raw.published || now, src: src.name, title: String(raw.title).slice(0, 200), link: raw.link, why });
  let fresh = 0;

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
      if (JUNK_TITLE.test(raw.title)) { reject(raw, src, 'junk'); continue; }
      // a site's own name/homepage instead of a headline (Google sometimes returns "- sport5.co.il")
      if (SITE_TITLE.test(raw.title)) { reject(raw, src, 'site-title'); continue; }

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
      if (src.mixed && !tags.looksSport) { reject(raw, src, 'general-feed'); continue; }

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
  const clusters = clusterItems(items.filter((i) => !i.hidden));
  const { ids: storyIdList, map: storyIds } = assignStoryIds(clusters, state.storyIds);
  const stories = clusters
    .map((members, i) => ({ ...buildStory(members, now), id: storyIdList[i], tags: storyTags(members), _members: members }))
    .map((s) => ({ ...s, s5: sport5Coverage(s) })) // did Sport5 already cover it? (for the Sport5 editors)
    .filter((s) => now - s.latest <= KEEP_STORIES_H * 3600000)
    .map((s) => applySignals(s, signals))
    .map((s) => ({ ...s, big: s.sourceCount >= 3 || s.langs.length >= 3 || !!s.trending || ((s.top || s.breaking) && s.sourceCount >= 2) }))
    // Other sports: only the biggest headlines (anything Israeli is always kept)
    .filter((s) => s.sport !== 'other' || s.big || s.israel || s.abroad)
    // Direct national outlets ("assist"): their local-only stories need a known team/player or an Israeli angle
    .filter((s) => !s._members.every((m) => m.assist) || s.israel || s.abroad || s.teams.length || s.trending || s.tags.some((t) => t.k === 'team' || t.k === 'player'))
    .sort((a, b) => b.latest - a.latest)
    .slice(0, MAX_STORIES);

  // Sport5 coverage, second check: same-day Sport5 article about the same thing worded differently
  const s5probable = sport5Probable(stories, items, tokens);

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
  const { ai, done: aiDone } = await aiSummaries(stories, sums, state.ai, now, heOfAthlete).catch((e) => ({ ai: { ...(state.ai || {}), error: String(e.message) }, done: 0 }));
  // Telegram channel: morning briefing + alerts (only when the bot token and channel are configured)
  const { tg, posted: tgPosted } = await telegramPost(stories, { athletes, cards: cards.cards || {}, gameInfo: gameInfo.games || {}, siteUrl: 'https://stacker33.github.io/sports-news/', translate: (texts) => translateTexts(texts, 'auto', 'he') }, state.tg, now).catch((e) => ({ tg: { ...(state.tg || {}), error: String(e.message) }, posted: 0 }));
  // ☀️ the morning's list, pinned on the site until noon
  const brief = morningBrief(stories, state.brief, now);
  for (const s of stories) {
    if (s.sum) Object.assign(s.sum, { he: sums[s.sum.id]?.he, en: sums[s.sum.id]?.en });
    delete s._members;
  }
  for (const id of Object.keys(sums)) if (!liveIds.has(id)) delete sums[id];

  const health = sources.map((s) => ({ id: s.id, name: s.name, ok: meta[s.id]?.ok !== false, count: meta[s.id]?.count ?? 0, error: meta[s.id]?.error }));
  const okCount = health.filter((h) => h.ok).length;

  // What the app needs, nothing more (phones): ≤8 sources per story, no repeated links, no unused fields
  const slim = (s) => {
    const { summary: _s, seen: _seen, ...rest } = s;
    const t = {};
    for (const lang of ['he', 'en']) if (s.t?.[lang]) t[lang] = s.t[lang].link === s.link ? { ...s.t[lang], link: undefined } : s.t[lang];
    return {
      ...rest,
      t,
      sources: s.sources.slice(0, 8).map(({ name, title, link, published, unknown }) => ({ name, title, link, published, ...(unknown ? { unknown } : {}) })),
      sum: s.ai?.he?.sum ? undefined : s.sum, // the language model's summary replaces the feed blurb
    };
  };
  // First screen: the newest 300 + everything Israeli / Israelis abroad; the rest loads right after
  const byNew = [...stories].sort((a, b) => b.first - a.first);
  const firstIds = new Set([...byNew.slice(0, 300), ...stories.filter((s) => s.israel || s.abroad)].map((s) => s.id));
  const head = { generatedAt: now, tookMs: Date.now() - started, sources: { total: sources.length, ok: okCount, fetched: due.length } };
  await writeJson(join(DATA, 'news-more.json'), { generatedAt: now, stories: stories.filter((s) => !firstIds.has(s.id)).map(slim) });
  await writeJson(join(DATA, 'news.json'), {
    ...head,
    more: stories.length - firstIds.size, // how many stories news-more.json holds
    rivals: rivals.games,
    gameInfo: gameInfo.games,
    ...(brief ? { brief } : {}),
    wikiAthletes: wiki.athletes || {},
    stories: stories.filter((s) => firstIds.has(s.id)).map(slim),
  });
  // For the app: athlete list (+ 365Scores team ids for the scoreboard)
  await writeJson(join(DATA, 'athletes.json'), {
    countries: Object.fromEntries(Object.entries(COUNTRIES).map(([k, v]) => [k, v.label])),
    nationalSquad: ilSquad.names,
    cards: cards.cards,
    suggestions: athleteSuggestions(athletes, teamCache, edb, await readJson(join(ROOT, 'private', 'ignored.json'), [])),
    athletes: athletes.map((a) => ({ ...a, teamId: teamCache[`${a.sport}|${a.team}`]?.id ?? null, teamFull: teamCache[`${a.sport}|${a.team}`]?.name ?? null })),
  });
  // Source health for the "system" panel: last check, last success, consecutive failures; quiet ≠ failed
  const sourceHealth = sources.map((s) => {
    const m = meta[s.id] || {};
    return { id: s.id, name: s.name, ok: m.ok !== false, last: m.last || null, lastOk: m.lastOk || (m.ok ? m.last : null), failStreak: m.failStreak || 0, count: m.count ?? 0, error: m.ok === false ? m.error : undefined };
  });
  await writeJson(join(DATA, 'sources.json'), {
    generatedAt: now,
    tookMs: Date.now() - started,
    ai: { ok: !ai.error, error: ai.error || null, used: ai.used || 0, cap: aiCap(), tokens: ai.tokens || 0, model: ai.model || null },
    health: sourceHealth,
  });
  // Rejected items of the last 24h (filtered at intake + hidden later), newest first — diagnostics for misses
  for (const it of items) if (it.hidden && now - it.seen < 24 * 3600e3) rejected.set(it.link, { at: now, t: it.published, src: srcById.get(it.sourceId)?.name || it.publisher, title: it.title.slice(0, 200), link: it.link, why: it.hiddenWhy || 'hidden' });
  const rejectedList = [...rejected.values()].sort((a, b) => b.t - a.t).slice(0, 500);
  await writeJson(join(DATA, 'rejected.json'), { generatedAt: now, items: rejectedList });
  // Alert the admin (private Telegram chat) about sources down for 2h+ — once a day per source
  const healthAlerts = await adminHealthAlerts(sourceHealth, state.healthAlerts || {}, now).catch(() => state.healthAlerts || {});
  const adminGreeted = await adminHello(state.adminGreeted).catch(() => state.adminGreeted || null);
  // Editors' feedback: 📣 reports → admin's Telegram; 👍/👎 votes → data/votes.json (the pilot's labelled set)
  const { feedback, reports } = await loadFeedback(state.feedback, now);
  const reportsSent = await adminReports(reports).catch(() => 0);
  await writeJson(join(DATA, 'votes.json'), votesFile(feedback, now));
  await writeJson(statePath, { savedAt: now, meta, teamCache, rivals, ilSquad, gameInfo, cards, sums, signals: { ...signals, wiki: undefined }, wiki, tr, corrections, ai, tg, brief, storyIds, rejected: rejectedList.slice(0, 300), healthAlerts, adminGreeted, feedback, items: items.map(({ tr: _t, _tok, _key, ...rest }) => rest) });

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
  collect({ force: process.argv.includes('--force') }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
