// Keeps the Israelis-abroad list up to date by comparing it with current squads (365Scores knowledge base):
//   • "returned"  — a listed player is now in an Israeli club → suggest removing
//   • "moved"     — a listed player is now at a different club abroad → suggest updating the club
//   • "new"       — an Israeli player (by nationality) at a club abroad who isn't on the list → suggest adding
// The user decides; dismissed suggestions are remembered (private/ignored.json).
import { norm } from './entities.js';

const ISRAEL = 6; // 365Scores country id
const ISRAELI_LEAGUES = new Set([42, 43, 47]);
// 365Scores country name → our country key (config/athletes.json)
const COUNTRY_KEY = {
  England: 'england', Scotland: 'scotland', USA: 'usa', Spain: 'spain', Italy: 'italy', Germany: 'germany', France: 'france',
  Netherlands: 'netherlands', Belgium: 'belgium', Portugal: 'portugal', Romania: 'romania', Serbia: 'serbia', Hungary: 'hungary',
  Greece: 'greece', Turkiye: 'turkey', Turkey: 'turkey', Poland: 'poland', Austria: 'austria', Switzerland: 'switzerland', Japan: 'japan',
};

export function athleteSuggestions(athletes, teamCache, db, ignored = []) {
  const players = Object.values(db.players || {});
  const teams = db.teams || {};
  const isIsraeliClub = (t) => (t?.comps || []).some((c) => ISRAELI_LEAGUES.has(c)) || t?.country === ISRAEL;
  const countryKey = (t) => COUNTRY_KEY[db.countries?.[t?.country]] || 'other';
  const byName = new Map();
  for (const p of players) for (const n of [p.en, p.he]) if (n) byName.set(norm(n), p);

  const out = [];
  const listed = new Set();
  for (const a of athletes) {
    const p = [a.name, a.name_he, ...(a.alt || [])].filter((n) => n && n.includes(' ')).map((n) => byName.get(norm(n))).find(Boolean);
    if (!p) continue;
    listed.add(p.id);
    const club = teams[p.team];
    if (!club) continue;
    const listedTeamId = teamCache[`${a.sport}|${a.team}`]?.id;
    if (isIsraeliClub(club)) {
      out.push({ key: `returned|${a.name}|${club.id}`, type: 'returned', name: a.name, name_he: a.name_he, team: club.en, team_he: club.he });
    } else if (listedTeamId && listedTeamId !== club.id) {
      out.push({
        key: `moved|${a.name}|${club.id}`, type: 'moved', name: a.name, name_he: a.name_he,
        from: a.team, from_he: a.team_he, team: club.en, team_he: club.he, country: countryKey(club),
      });
    }
  }
  for (const p of players) {
    if (p.nat !== ISRAEL || listed.has(p.id)) continue;
    const club = teams[p.team];
    if (!club || isIsraeliClub(club)) continue;
    out.push({ key: `new|${p.en}|${club.id}`, type: 'new', name: p.en, name_he: p.he, team: club.en, team_he: club.he, country: countryKey(club), sport: club.sport });
  }
  const skip = new Set(ignored);
  return out.filter((s) => !skip.has(s.key));
}
