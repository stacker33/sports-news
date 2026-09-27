// Israeli teams vs foreign opponents: find upcoming/recent games on 365Scores and create
// news searches in the OPPONENT's country and language (Irish press for Israel–Ireland, Turkish for Maccabi–Beşiktaş…).
import { gnews, GN_LOCALES } from '../config/sources.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const API = 'https://webws.365scores.com/web/games/current/';

// Israel national teams + European club competitions where Israeli clubs play
const ISRAEL_NATIONAL = [5034, 1728]; // football, basketball
const EURO_COMPS = [572, 332, 573, 596, 7685, 569, 329]; // UCL (+qual), UEL (+qual), UECL, EuroLeague, EuroCup
const ISRAEL_COUNTRY_ID = 6;

// Opponent country (365Scores name) → Google News locale
const COUNTRY_LOCALE = {
  Ireland: 'en-IE', 'Republic of Ireland': 'en-IE', 'Northern Ireland': 'en-GB', England: 'en-GB', Scotland: 'en-GB', Wales: 'en-GB',
  Turkiye: 'tr', Turkey: 'tr', Greece: 'el', Cyprus: 'el', Spain: 'es', Serbia: 'sr', Montenegro: 'sr', Germany: 'de', Austria: 'de',
  Switzerland: 'de', France: 'fr', Monaco: 'fr', Italy: 'it', Portugal: 'pt', Netherlands: 'nl', Belgium: 'nl', Romania: 'ro',
  Hungary: 'hu', Poland: 'pl', Czechia: 'cs', 'Czech Republic': 'cs', Slovakia: 'sk', Slovenia: 'sl', Lithuania: 'lt', Latvia: 'lv',
  Bulgaria: 'bg', Sweden: 'sv', Norway: 'no', Ukraine: 'uk', USA: 'en', Japan: 'ja',
};
// "Israel" in the local language
const ISRAEL_WORD = {
  en: 'Israel', 'en-GB': 'Israel', 'en-IE': 'Israel', tr: 'İsrail', el: 'Ισραήλ', es: 'Israel', sr: 'Израел', de: 'Israel', fr: 'Israël',
  it: 'Israele', pt: 'Israel', nl: 'Israël', ro: 'Israel', hu: 'Izrael', pl: 'Izrael', cs: 'Izrael', sk: 'Izrael', sl: 'Izrael',
  lt: 'Izraelis', lv: 'Izraēla', bg: 'Израел', sv: 'Israel', no: 'Israel', uk: 'Ізраїль', ja: 'イスラエル',
};
const langOf = (locale) => locale.split('-')[0];

async function current(params) {
  const qs = new URLSearchParams({ appTypeId: 5, langId: 1, timezoneName: 'UTC', userCountryId: 6, ...params });
  const res = await fetch(`${API}?${qs}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`365 HTTP ${res.status}`);
  return res.json();
}

// → [{ gameId, sport, israeli, opponent, country, locale, start, national }]
export async function findRivalGames(now = Date.now()) {
  const [nat, euro] = await Promise.all([
    current({ competitors: ISRAEL_NATIONAL.join(',') }),
    current({ competitions: EURO_COMPS.join(',') }),
  ]);
  const countries = {};
  for (const j of [nat, euro]) for (const c of j.countries || []) countries[c.id] = c.name;
  const out = new Map();
  for (const g of [...(nat.games || []), ...(euro.games || [])]) {
    const start = Date.parse(g.startTime);
    if (!(start > now - 2 * 86400e3 && start < now + 4 * 86400e3)) continue; // 2 days back … 4 days ahead
    const h = g.homeCompetitor, a = g.awayCompetitor;
    const hIL = h.countryId === ISRAEL_COUNTRY_ID, aIL = a.countryId === ISRAEL_COUNTRY_ID;
    if (hIL === aIL) continue;
    const [il, op] = hIL ? [h, a] : [a, h];
    const country = countries[op.countryId] || '';
    const locale = COUNTRY_LOCALE[country] && GN_LOCALES[COUNTRY_LOCALE[country]] ? COUNTRY_LOCALE[country] : 'en';
    out.set(g.id, {
      gameId: g.id,
      sport: g.sportId === 2 ? 'basketball' : 'football',
      israeli: il.name,
      opponent: op.name,
      country,
      locale,
      start,
      national: ISRAEL_NATIONAL.includes(il.id),
      competition: g.competitionDisplayName,
    });
  }
  return [...out.values()];
}

// One news search per game, in the opponent's language (plus an English one when that's different)
export function rivalSources(games) {
  const out = [];
  for (const g of games) {
    const word = ISRAEL_WORD[g.locale] || 'Israel';
    const q = g.national
      ? `"${g.opponent}" ${word} when:2d`
      : `"${g.opponent}" ("${g.israeli}" OR ${word} OR Maccabi OR Hapoel OR Makabi) when:2d`;
    const base = { name: 'Google News', weight: 1, google: true, every: 6, israel: true, sport: g.sport, mixed: true, rival: { opponent: g.opponent, country: g.country } };
    out.push({ ...base, id: `rival-${g.gameId}-${g.locale}`, url: gnews(q, g.locale), lang: langOf(g.locale), country: g.country });
    if (langOf(g.locale) !== 'en') {
      out.push({ ...base, id: `rival-${g.gameId}-en`, url: gnews(`"${g.opponent}" "${g.israeli}" when:2d`), lang: 'en', country: g.country });
    }
  }
  return out;
}
