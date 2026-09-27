// Israelis abroad: load the editable list, resolve each team on 365Scores (for the scoreboard),
// and generate news sources for every player and every team.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { gnews } from '../config/sources.js';

export const COUNTRIES = {
  england: { locale: 'en-GB', label: 'England' },
  scotland: { locale: 'en-GB', label: 'Scotland' },
  usa: { locale: 'en', label: 'USA' },
  spain: { locale: 'es', label: 'Spain' },
  italy: { locale: 'it', label: 'Italy' },
  germany: { locale: 'de', label: 'Germany' },
  france: { locale: 'fr', label: 'France' },
  netherlands: { locale: 'nl', label: 'Netherlands' },
  belgium: { locale: 'nl', label: 'Belgium' },
  portugal: { locale: 'pt', label: 'Portugal' },
  romania: { locale: 'ro', label: 'Romania' },
  serbia: { locale: 'sr', label: 'Serbia' },
  hungary: { locale: 'hu', label: 'Hungary' },
  greece: { locale: 'el', label: 'Greece' },
  turkey: { locale: 'tr', label: 'Turkey' },
  poland: { locale: 'pl', label: 'Poland' },
  austria: { locale: 'de', label: 'Austria' },
  switzerland: { locale: 'de', label: 'Switzerland' },
  japan: { locale: 'ja', label: 'Japan' },
  other: { locale: 'en', label: 'Other' },
};

// Sport word per language, so "Elche" finds the club and not the city
const SPORT_WORD = {
  football: { en: 'football OR soccer', 'en-GB': 'football', es: 'fútbol', it: 'calcio', nl: 'voetbal', de: 'Fußball', fr: 'football', pt: 'futebol', ro: 'fotbal', sr: 'fudbal', hu: 'foci', el: 'ποδόσφαιρο', tr: 'futbol', pl: 'piłka', ja: 'サッカー' },
  basketball: { en: 'NBA OR basketball', 'en-GB': 'basketball', es: 'baloncesto', it: 'basket', nl: 'basketbal', de: 'Basketball', fr: 'basket', pt: 'basquetebol', ro: 'baschet', sr: 'košarka', hu: 'kosárlabda', el: 'μπάσκετ', tr: 'basketbol', pl: 'koszykówka', ja: 'バスケットボール' },
};

const SPORT_ID = { football: 1, basketball: 2 };
const LOCALE_LANG = (locale) => (locale === 'en-GB' ? 'en' : locale);

export async function loadAthletes(root) {
  try {
    const list = JSON.parse(await readFile(join(root, 'config', 'athletes.json'), 'utf8'));
    return list.filter((a) => a && a.name).map(normalizeAthlete);
  } catch (e) {
    console.error('athletes.json unreadable:', e.message);
    return [];
  }
}

export function normalizeAthlete(a) {
  const str = (v) => String(v ?? '').trim();
  return {
    name: str(a.name),
    name_he: str(a.name_he),
    alt: (Array.isArray(a.alt) ? a.alt : String(a.alt || '').split(',')).map(str).filter(Boolean),
    team: str(a.team),
    team_he: str(a.team_he),
    team_alt: (Array.isArray(a.team_alt) ? a.team_alt : String(a.team_alt || '').split(',')).map(str).filter(Boolean),
    country: COUNTRIES[a.country] ? a.country : 'other',
    sport: a.sport === 'basketball' ? 'basketball' : 'football',
  };
}

export async function saveAthletes(root, list) {
  const path = join(root, 'config', 'athletes.json');
  const clean = list.map(normalizeAthlete).filter((a) => a.name);
  const body = '[\n' + clean.map((a) => '  ' + JSON.stringify(a)).join(',\n') + '\n]\n';
  await writeFile(path + '.tmp', body);
  await rename(path + '.tmp', path);
  return clean;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

// Find a team on 365Scores → { id, name, imageVersion }
async function resolveTeam(team, sport) {
  const url = `https://webws.365scores.com/web/search/?appTypeId=5&langId=1&timezoneName=UTC&userCountryId=6&query=${encodeURIComponent(team)}`;
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`365 search HTTP ${res.status}`);
  const j = await res.json();
  const candidates = (j.competitors || []).filter(
    (c) => c.sportId === SPORT_ID[sport] && !/\((W|U\d+)\)|\bU\d\d\b|Women|Reserves|Ilicitano|\bII\b/i.test(c.name)
  );
  const best = candidates[0];
  return best ? { id: best.id, name: best.name, imageVersion: best.imageVersion || 1 } : null;
}

// Resolve all teams (cached in state between runs)
export async function resolveTeams(athletes, cache = {}) {
  const out = { ...cache };
  const byKey = new Map(athletes.filter((a) => a.team).map((a) => [`${a.sport}|${a.team}`, a]));
  for (const [key, a] of byKey) {
    if (out[key]) continue; // found before (misses are retried every run)
    // Try the team name, then its alternative names, then without punctuation
    const queries = [...new Set([a.team, ...a.team_alt, a.team.replace(/[.]/g, '')])];
    for (const q of queries) {
      try {
        const found = await resolveTeam(q, a.sport);
        if (found) {
          out[key] = found;
          break;
        }
      } catch {
        break; // network problem: try again next run
      }
    }
  }
  return out;
}

const slug = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// News sources for every player (grouped) and every team
export function athleteSources(athletes, teamCache) {
  const out = [];
  for (let i = 0; i < athletes.length; i += 5) {
    const group = athletes.slice(i, i + 5);
    const n = i / 5 + 1;
    const en = group.map((a) => `"${a.name}"`).join(' OR ');
    const he = group.filter((a) => a.name_he).map((a) => `"${a.name_he}"`).join(' OR ');
    out.push({ id: `abroad-en-${n}`, name: 'Google News', url: gnews(`(${en}) when:2d`), lang: 'en', weight: 1, google: true, every: 4 });
    if (he) out.push({ id: `abroad-he-${n}`, name: 'Google News', url: gnews(`(${he}) when:2d`, 'he'), lang: 'he', weight: 1, google: true, every: 4 });
  }

  const teams = new Map();
  for (const a of athletes) if (a.team) teams.set(`${a.sport}|${a.team}`, a);
  for (const [key, a] of teams) {
    const full = teamCache[key]?.name || a.team;
    const locale = COUNTRIES[a.country].locale;
    const words = SPORT_WORD[a.sport];
    const tag = { team: a.team, sport: a.sport };
    const id = slug(key);
    // English press
    out.push({ id: `team-en-${id}`, name: 'Google News', url: gnews(`"${a.team}" (${words.en}) when:1d`), lang: 'en', weight: 1, google: true, every: 8, sport: a.sport, forTeam: tag });
    // Local press in the club's country
    if (locale !== 'en' && locale !== 'en-GB') {
      out.push({ id: `team-${locale}-${id}`, name: 'Google News', url: gnews(`"${a.team}" (${words[locale] || words.en}) when:1d`, locale), lang: LOCALE_LANG(locale), weight: 1, google: true, every: 8, sport: a.sport, forTeam: tag });
    }
    // BBC has a feed for every English/Scottish club
    if ((a.country === 'england' || a.country === 'scotland') && a.sport === 'football') {
      out.push({ id: `bbc-team-${id}`, name: 'BBC Sport', url: `https://feeds.bbci.co.uk/sport/football/teams/${slug(full)}/rss.xml`, lang: 'en', weight: 3, sport: 'football', every: 3, forTeam: tag });
    }
  }
  return out;
}

// Build fast matchers for tagging items with players and teams
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function matcher(term) {
  const t = term.toLowerCase();
  if (/[a-z]/.test(t)) {
    const re = new RegExp(`(^|[^\\p{L}])${escapeRe(t)}($|[^\\p{L}])`, 'u');
    return (text) => re.test(text);
  }
  return (text) => text.includes(t);
}

export function buildMatchers(athletes, teamCache) {
  const players = athletes.map((a) => ({
    name: a.name,
    test: [a.name, a.name_he, ...a.alt].filter(Boolean).map(matcher),
  }));
  const teams = new Map();
  for (const a of athletes) {
    if (!a.team || teams.has(a.team)) continue;
    const full = teamCache[`${a.sport}|${a.team}`]?.name;
    teams.set(a.team, { team: a.team, test: [a.team, a.team_he, full, ...a.team_alt].filter(Boolean).map(matcher) });
  }
  return {
    players: (text) => players.filter((p) => p.test.some((f) => f(text))).map((p) => p.name),
    teams: (text) => [...teams.values()].filter((t) => t.test.some((f) => f(text))).map((t) => t.team),
  };
}
