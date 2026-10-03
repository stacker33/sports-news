// Topic tags for every story: competitions, teams, players (Hebrew + English names).
// Knowledge base built from 365Scores (league tables + squads), cached in public/data/entities.json
// and refreshed weekly, a few teams per run.
import { readFile, writeFile, rename } from 'node:fs/promises';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const API = 'https://webws.365scores.com/web';
const WEEK = 7 * 86400e3;
const SQUADS_PER_RUN = 8;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Leagues whose teams (and their players) we recognise
const LEAGUES = {
  football: [42, 43, 7, 1, 11, 17, 25, 35, 57, 104, 572, 573, 7685], // Israel ×2, EPL, Championship, LaLiga, Serie A, Bundesliga, Ligue 1, Eredivisie, MLS, UCL, UEL, UECL
  basketball: [47, 569, 329, 103], // Winner League, EuroLeague, EuroCup, NBA
};

// Sport of each competition; some names are shared with another sport's competition ("ליגת העל", "World Cup",
// "Champions", "גביע המדינה") so they don't count as evidence of the sport on their own
const COMP_SPORT = {
  'c-ucl': 'football', 'c-uel': 'football', 'c-uecl': 'football', 'c-unl': 'football', 'c-wc': 'football', 'c-epl': 'football',
  'c-laliga': 'football', 'c-seriea': 'football', 'c-bundes': 'football', 'c-ligue1': 'football', 'c-ligat': 'football',
  'c-leumit': 'football', 'c-statecup': 'football', 'c-toto': 'football', 'c-mls': 'football',
  'c-euroleague': 'basketball', 'c-eurocup': 'basketball', 'c-nba': 'basketball', 'c-winner': 'basketball', 'c-wcup': 'basketball',
  'c-f1': 'other',
};
const COMP_NO_EVIDENCE = new Set(['c-ucl', 'c-wc', 'c-ligat', 'c-statecup']);

// Competitions: names/aliases as written in headlines
const COMPETITIONS = [
  { id: 'c-ucl', en: 'Champions League', he: 'ליגת האלופות', aliases: ['UCL', 'Champions League', 'Ligue des champions', 'Liga de Campeones', 'Champions', 'ליגת האלופות'] },
  { id: 'c-uel', en: 'Europa League', he: 'הליגה האירופית', aliases: ['Europa League', 'הליגה האירופית', 'הליגה האירופאית'] },
  { id: 'c-uecl', en: 'Conference League', he: 'ליגת הקונפרנס', aliases: ['Conference League', 'ליגת הקונפרנס', 'הקונפרנס ליג'] },
  { id: 'c-unl', en: 'Nations League', he: 'ליגת האומות', aliases: ['Nations League', 'ליגת האומות', 'Liga de Naciones', 'Ligue des nations', 'Nazioni League'] },
  { id: 'c-wc', en: 'World Cup', he: 'המונדיאל', aliases: ['World Cup', 'מונדיאל', 'גביע העולם', 'Mundial', 'Coupe du monde', 'Weltmeisterschaft'] },
  { id: 'c-epl', en: 'Premier League', he: 'פרמייר ליג', aliases: ['Premier League', 'פרמייר ליג', 'הפרמייר ליג', 'פרמיירליג'] },
  { id: 'c-laliga', en: 'LaLiga', he: 'לה ליגה', aliases: ['LaLiga', 'La Liga', 'לה ליגה', 'הליגה הספרדית'] },
  { id: 'c-seriea', en: 'Serie A', he: 'סרייה א', aliases: ['Serie A', "סרייה א'", 'סרייה א', 'הליגה האיטלקית'] },
  { id: 'c-bundes', en: 'Bundesliga', he: 'בונדסליגה', aliases: ['Bundesliga', 'בונדסליגה', 'הבונדסליגה'] },
  { id: 'c-ligue1', en: 'Ligue 1', he: 'ליג 1', aliases: ['Ligue 1', 'ליג 1', 'הליגה הצרפתית'] },
  { id: 'c-ligat', en: 'Israeli Premier League', he: 'ליגת העל', aliases: ['Ligat HaAl', "Ligat Ha'Al", 'Israeli Premier League', 'ליגת העל'] },
  { id: 'c-leumit', en: 'Liga Leumit', he: 'הליגה הלאומית', aliases: ['Liga Leumit', 'הליגה הלאומית', 'ליגה לאומית'] },
  { id: 'c-statecup', en: 'State Cup', he: 'גביע המדינה', aliases: ['State Cup', 'גביע המדינה'] },
  { id: 'c-toto', en: 'Toto Cup', he: 'גביע הטוטו', aliases: ['Toto Cup', 'גביע הטוטו'] },
  { id: 'c-euroleague', en: 'EuroLeague', he: 'יורוליג', aliases: ['EuroLeague', 'Euroleague', 'יורוליג', 'היורוליג', 'Евролига', 'Evroliga', 'Euroliga', 'Euroligue'] },
  { id: 'c-eurocup', en: 'EuroCup', he: 'יורוקאפ', aliases: ['EuroCup', 'Eurocup', 'יורוקאפ', 'היורוקאפ'] },
  { id: 'c-nba', en: 'NBA', he: 'NBA', aliases: ['NBA', 'אן.בי.איי', 'WNBA'] },
  { id: 'c-winner', en: 'Winner League', he: 'ליגת ווינר', aliases: ['Winner League', 'ליגת ווינר', 'ליגת העל בכדורסל'] },
  { id: 'c-wcup', en: 'Winner Cup', he: 'גביע ווינר', aliases: ['Winner Cup', 'גביע ווינר'] },
  { id: 'c-mls', en: 'MLS', he: 'MLS', aliases: ['MLS', 'Major League Soccer'] },
  { id: 'c-f1', en: 'Formula 1', he: 'פורמולה 1', aliases: ['Formula 1', 'Formula One', 'F1', 'פורמולה 1', 'Fórmula 1', 'Formel 1'] },
];

// Headline nicknames for big clubs (365Scores name → extra names)
// Israeli clubs as Hebrew headlines write them (by the club's Hebrew name in 365Scores). A name shared by the
// football and basketball clubs (הפועל ב"ש) then counts for both and isn't taken as evidence of either sport.
const HE_TEAM_ALIASES = {
  'מכבי תל אביב': ['מכבי ת"א', "מכבי ת''א"],
  'הפועל תל אביב': ['הפועל ת"א', "הפועל ת''א"],
  'הפועל ירושלים': ['הפועל י-ם'],
  'בית"ר ירושלים': ['בית"ר י-ם', 'ביתר ירושלים'],
  'מכבי פתח תקוה': ['מכבי פ"ת', 'מכבי פתח תקווה'],
  'הפועל פתח תקוה': ['הפועל פ"ת', 'הפועל פתח תקווה'],
  'הפועל באר שבע': ['הפועל ב"ש'],
  'הפועל באר שבע/דימונה': ['הפועל באר שבע', 'הפועל ב"ש'],
  'עירוני קרית שמונה': ['עירוני ק"ש', 'קריית שמונה', 'עירוני קריית שמונה'],
  'מכבי ראשון לציון': ['מכבי ראשל"צ'],
  'הפועל ראשון לציון': ['הפועל ראשל"צ'],
  'מכבי עירוני רמת גן': ['מכבי ר"ג', 'מכבי רמת גן'],
  'הפועל רמת גן': ['הפועל ר"ג'],
  'מכבי אשדוד/באר טוביה': ['מכבי אשדוד'],
  'מ.ס. אשדוד': ['מ.ס אשדוד'],
  'הפועל עירוני אילת': ['הפועל אילת'],
  'הפועל כפר-שלם': ['הפועל כפר שלם'],
  'בני יהודה ת"א': ['בני יהודה'],
  'עירוני קרית אתא': ['עירוני קריית אתא'],
  'הפועל גליל עליון': ['גליל עליון'],
  'מכבי בני ריינה': ['בני ריינה'],
};

const TEAM_ALIASES = {
  'Manchester City': ['Man City'], 'Manchester United': ['Man Utd', 'Man United'], 'Tottenham Hotspur': ['Tottenham', 'Spurs'], Tottenham: ['Spurs'],
  PSG: ['Paris Saint-Germain', 'Paris SG', "פ.ס.ז'", 'פריז סן ז׳רמן'], 'FC Barcelona': ['Barcelona', 'Barca', 'Barça', 'ברצלונה'],
  'Inter Milan': ['Inter', 'Internazionale'], Inter: ['Inter Milan'], Juventus: ['Juve'], 'Bayern Munich': ['Bayern', 'Bayern München'],
  'Atletico Madrid': ['Atletico', 'Atlético', 'Atlético Madrid'], 'Borussia Dortmund': ['Dortmund', 'BVB'], 'AC Milan': ['Milan'],
  'West Ham United': ['West Ham'], 'Wolverhampton Wanderers': ['Wolves'], Wolverhampton: ['Wolves'], 'Newcastle United': ['Newcastle'],
  'Nottingham Forest': ['Forest'], 'Leeds United': ['Leeds'], 'Crvena Zvezda': ['Red Star', 'Zvezda', 'Црвена звезда', 'Звезда'],
  'KK Crvena Zvezda': ['Red Star', 'Zvezda', 'Crvena Zvezda', 'Звезда'], 'KK Partizan': ['Partizan', 'Партизан'], Olympiacos: ['Olympiakos'],
  'Fenerbahçe': ['Fenerbahce'], 'Maccabi Tel Aviv': ['Maccabi TA'], 'Hapoel Tel Aviv': ['Hapoel TA'], 'Hapoel Beer Sheva': ['Beersheba', "Be'er Sheva", 'Hapoel Beersheba'],
  'Real Madrid': ['Real'], 'Sporting CP': ['Sporting Lisbon'], 'Bayer Leverkusen': ['Leverkusen'], 'RB Leipzig': ['Leipzig'],
};

// Single words that look like names but are ordinary words
const COMMON = new Set(
  `real city united sporting inter star rice silva king kings james white green young brown black hill wood gray grey little
  may will mark rose hope park bay love cash case best more most over under well hall long short field ward stones walker
  ball cup win game home away big new top show league match final power young gold rock stone moon sun sky day night
  jesus santos gomes costa ruben rodri pedro diego carlos lucas luis david daniel alex ben sam joe tom max
  israel ireland england spain france italy germany brazil argentina portugal holland belgium turkey greece serbia austria
  kosovo scotland wales croatia poland mexico japan china egypt morocco nigeria ghana senegal colombia uruguay chile
  ישראל אירלנד אנגליה ספרד צרפת איטליה גרמניה ברזיל ארגנטינה פורטוגל הולנד בלגיה טורקיה יוון סרביה אוסטריה קוסובו`.split(/\s+/)
);

async function get(path, params) {
  const qs = new URLSearchParams({ appTypeId: 5, timezoneName: 'UTC', userCountryId: 6, ...params });
  const res = await fetch(`${API}/${path}/?${qs}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`365 ${path} HTTP ${res.status}`);
  return res.json();
}

export async function loadEntityDb(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return { teams: {}, players: {}, teamsAt: 0 };
  }
}

// Weekly: league tables → teams. Every run: a few squads → players.
export async function refreshEntityDb(db, path, now = Date.now()) {
  let changed = false;
  db.compsAt ||= {};
  if (db.schema !== 2) {
    // v2 adds club countries + player nationalities: reload the league tables once
    db.compsAt = {};
    db.schema = 2;
  }
  const leaguesDue = Object.entries(LEAGUES).flatMap(([sport, ids]) => ids.map((comp) => [sport, comp])).filter(([, comp]) => now - (db.compsAt[comp] || 0) > WEEK);
  if (leaguesDue.length) {
    const teams = { ...db.teams };
    for (const [sport, comp] of leaguesDue) {
      {
        try {
          const [en, he] = await Promise.all([get('standings', { langId: 1, competitions: comp }), get('standings', { langId: 2, competitions: comp })]);
          const heName = new Map((he.standings || []).flatMap((s) => s.rows || []).map((r) => [r.competitor.id, r.competitor.name]));
          db.countries ||= {};
          for (const ct of en.countries || []) db.countries[ct.id] = ct.name;
          for (const r of (en.standings || []).flatMap((s) => s.rows || [])) {
            const c = r.competitor;
            if (/\((W|U\d+)\)/.test(c.name)) continue;
            const prev = teams[c.id] || {};
            teams[c.id] = { id: c.id, en: c.name, he: heName.get(c.id) || prev.he || '', sport, comps: [...new Set([...(prev.comps || []), comp])], squadAt: prev.squadAt || 0, country: c.countryId, v: prev.v };
          }
          if ((en.standings || []).some((s) => s.rows?.length)) db.compsAt[comp] = now; // only a real table counts as done
          await pause(300);
        } catch {}
      }
    }
    db.teams = teams;
    db.teamsAt = now;
    changed = true;
  }
  // biggest competitions first (their players are in the news most)
  const PRIORITY = [572, 569, 103, 7, 11, 42, 47, 17, 25, 35, 573, 7685, 329, 57, 104, 43, 1];
  const rank = (t) => Math.min(...(t.comps || []).map((c) => (PRIORITY.includes(c) ? PRIORITY.indexOf(c) : 99)));
  const due = Object.values(db.teams)
    .filter((t) => now - (t.squadAt || 0) > WEEK || t.v !== 2) // v2 = squads with nationality
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, SQUADS_PER_RUN);
  for (const t of due) {
    try {
      const [en, he] = await Promise.all([get('squads', { langId: 1, competitors: t.id }), get('squads', { langId: 2, competitors: t.id })]);
      const heName = new Map((he.squads?.[0]?.athletes || []).map((a) => [a.id, a.name]));
      for (const a of en.squads?.[0]?.athletes || []) {
        db.players[a.id] = { id: a.id, en: a.name, short: a.shortName || '', he: heName.get(a.id) || '', team: t.id, nat: a.nationalityId };
      }
      t.squadAt = now;
      t.v = 2;
      // players who left this squad: forget them (they show up again with their new club)
      const ids = new Set((en.squads?.[0]?.athletes || []).map((a) => a.id));
      for (const [pid, p] of Object.entries(db.players)) if (p.team === t.id && !ids.has(Number(pid))) delete db.players[pid];
      changed = true;
      await pause(300);
    } catch {
      break; // try again next run
    }
  }
  if (changed) {
    await writeFile(path + '.tmp', JSON.stringify(db));
    await rename(path + '.tmp', path);
  }
  return db;
}

// ---------- matching ----------
// Spelling variants: Cyrillic → Latin, accents dropped, doubled letters collapsed (Mbappé / Mbape / Мбапе → "mbape")
const CYR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'dj', е: 'e', ж: 'z', з: 'z', и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r', с: 's', т: 't', ћ: 'c', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'c', џ: 'dz', ш: 's', й: 'j', ы: 'y', э: 'e', ю: 'ju', я: 'ja', ь: '', ъ: '', ё: 'e', щ: 'sc', і: 'i', ї: 'ji', є: 'je' };
export const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[Ѐ-ӿ]/g, (ch) => CYR[ch] ?? ch)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[׳'’`"״.]/g, '')
    .replace(/[-–—]/g, ' ')
    .replace(/([a-z])\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
const HE_PREFIXES = ['וה', 'שה', 'מה', 'לה', 'בה', 'כש', 'וב', 'ול', 'ומ', 'וש', 'ה', 'ו', 'ב', 'ל', 'מ', 'ש', 'כ'];

// Build a phrase → entities index (rebuilt when the knowledge base changes)
export function buildEntityIndex(db) {
  const index = new Map(); // normalized phrase → [{ entity, single, caps }]
  const add = (phrase, entity, { single = false } = {}) => {
    if (!phrase) return;
    const key = norm(phrase);
    if (key.length < 2) return;
    const oneWord = !key.includes(' ');
    if (oneWord && !single) return;
    if (oneWord && (COMMON.has(key) || key.length < 4)) return;
    const list = index.get(key) || [];
    if (!list.some((x) => x.entity.id === entity.id)) list.push({ entity, oneWord, caps: /[a-z]/i.test(phrase) });
    index.set(key, list);
  };

  for (const c of COMPETITIONS) {
    const e = { k: 'comp', id: c.id, en: c.en, he: c.he, sport: COMP_SPORT[c.id], ...(COMP_NO_EVIDENCE.has(c.id) ? { noEvidence: true } : {}) };
    for (const a of c.aliases) add(a, e, { single: true });
  }
  for (const t of Object.values(db.teams || {})) {
    const e = { k: 'team', id: `t${t.id}`, en: t.en, he: t.he || t.en, sport: t.sport };
    const names = [t.en, t.he, ...(TEAM_ALIASES[t.en] || []), ...(HE_TEAM_ALIASES[t.he] || [])];
    // "Manchester X" → "Man X", "X FC"/"FC X" → "X", "X United" → "X"
    const m = t.en.match(/^(?:FC |KK |BC |AC |AS |SS |SC |CF )?(.+?)(?: FC| CF| AFC| SC| BC)?$/);
    if (m && m[1] !== t.en) names.push(m[1]);
    if (/ United$/.test(t.en) && t.en.length > 12) names.push(t.en.replace(/ United$/, ''));
    for (const n of names) add(n, e, { single: true });
  }
  // players: full names always; the short name alone only when it is unique
  const shortCount = new Map();
  const heLast = (he) => he.split(/\s+/).pop();
  for (const p of Object.values(db.players || {})) {
    for (const s of [p.short && norm(p.short), p.he && norm(heLast(p.he))]) if (s) shortCount.set(s, (shortCount.get(s) || 0) + 1);
  }
  for (const p of Object.values(db.players || {})) {
    const team = db.teams[p.team];
    const e = { k: 'player', id: `p${p.id}`, en: p.en, he: p.he || p.en, sport: team?.sport, team: `t${p.team}` };
    add(p.en, e);
    add(p.he, e);
    // surnames shared by several players are kept too; the collector picks whoever is in the news
    if (p.short && p.short !== p.en && shortCount.get(norm(p.short)) <= 3) add(p.short, e, { single: true });
    if (p.he && p.he.includes(' ') && shortCount.get(norm(heLast(p.he))) <= 3 && heLast(p.he).length >= 4) add(heLast(p.he), e, { single: true });
  }
  return index;
}

// Find entities in a text. Latin single words must be Capitalised in the original.
export function findEntities(index, text, sport) {
  if (!text) return [];
  const raw = text.replace(/[-–—]/g, ' ').split(/[^\p{L}\p{N}'’׳".]+/u).filter((w) => norm(w));
  const words = raw.map(norm);
  const found = new Map();
  for (let i = 0; i < words.length; i++) {
    for (let n = 4; n >= 1; n--) {
      if (i + n > words.length) continue;
      const variants = [words.slice(i, i + n).join(' ')];
      // Hebrew attached prefixes: "לריאל מדריד" → "ריאל מדריד"
      if (/[א-ת]/.test(words[i])) {
        for (const p of HE_PREFIXES) if (words[i].startsWith(p) && words[i].length - p.length >= 2) variants.push([words[i].slice(p.length), ...words.slice(i + 1, i + n)].join(' '));
      }
      let hit = null;
      for (const v of variants) {
        const list = index.get(v);
        if (!list) continue;
        const ok = list.filter((x) => !x.oneWord || !x.caps || /^\p{Lu}/u.test(raw[i] || ''));
        if (!ok.length) continue;
        // same name in two sports (Barcelona, Real Madrid…) → prefer the story's sport
        const pick = ok.find((x) => !x.entity.sport || x.entity.sport === sport) || ok[0];
        hit = { ...pick.entity, single: pick.oneWord };
        // the same name exists in two sports (Maccabi Tel Aviv, Real Madrid…) → no evidence of the sport
        if (new Set(ok.map((x) => x.entity.sport).filter(Boolean)).size > 1) hit.amb = true;
        // surname only and several players share it → hand all candidates to the collector
        if (pick.oneWord && ok.length > 1) hit.alts = ok.map((x) => x.entity);
        break;
      }
      if (hit) {
        if (!found.has(hit.id) || found.get(hit.id).single) found.set(hit.id, hit); // a full-name match beats a surname-only one
        i += n - 1;
        break;
      }
    }
  }
  return [...found.values()];
}
