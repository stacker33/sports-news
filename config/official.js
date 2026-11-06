// Official websites of clubs, leagues and federations: what the club itself published. Read through Google News
// (free: `site:` searches), grouped by the site's language (Google's edition decides which sites it returns).
// Only the main address counts: shop., tickets., store. and other subdomains are not announcements.
// Checked 2026-11-07: every host here had articles in Google News in the last 7 days. Sites Google doesn't index
// (most small Israeli clubs, Crvena Zvezda basketball, Monaco basketball, FCSB, Dinamo Bucharest, Anorthosis,
// Amed, Charlotte FC, Twente, Machida) are not here; their YouTube channels are the alternative.
//
// [name, host, locale, sport]  sport: 'football' | 'basketball' | '' (both / a league site)
export const OFFICIAL_SITES = [
  // ---------- Israel ----------
  ['ההתאחדות לכדורגל', 'football.org.il', 'he', 'football'],
  ['מנהלת ליגת העל בכדורסל', 'basket.co.il', 'he', 'basketball'],
  ['מכבי תל אביב', 'maccabi-tlv.co.il', 'he', 'football'],
  ['מכבי חיפה', 'mhaifafc.com', 'he', 'football'],
  ['הפועל באר שבע', 'hbs.co.il', 'he', 'football'],
  ['בית"ר ירושלים', 'beitarfc.co.il', 'he', 'football'],
  ['הפועל חיפה', 'hapoelhaifa.co.il', 'he', 'football'],
  ['מכבי תל אביב כדורסל', 'maccabi.co.il', 'he', 'basketball'],
  ['הפועל ירושלים כדורסל', 'hapoel.co.il', 'he', 'basketball'],
  ['הפועל באר שבע כדורסל', 'hbsfc.co.il', 'he', 'basketball'],

  // ---------- football: leagues and federations ----------
  ['UEFA', 'uefa.com', 'en', 'football'],
  ['FIFA', 'inside.fifa.com', 'en', 'football'],
  ['Premier League', 'premierleague.com', 'en', 'football'],
  ['LaLiga', 'laliga.com', 'es', 'football'],
  ['Bundesliga', 'bundesliga.com', 'de', 'football'],
  ['Lega Serie A', 'legaseriea.it', 'it', 'football'],
  ['MLS', 'mlssoccer.com', 'en', 'football'],

  // ---------- football: the biggest clubs (and the Champions League) ----------
  ['Real Madrid', 'realmadrid.com', 'en', ''],
  ['FC Barcelona', 'fcbarcelona.com', 'en', ''],
  ['Atlético de Madrid', 'atleticodemadrid.com', 'es', 'football'],
  ['Villarreal', 'villarrealcf.es', 'es', 'football'],
  ['Real Betis', 'realbetisbalompie.es', 'es', 'football'],
  ['Manchester City', 'mancity.com', 'en', 'football'],
  ['Manchester United', 'manutd.com', 'en', 'football'],
  ['Chelsea', 'chelseafc.com', 'en', 'football'],
  ['Arsenal', 'arsenal.com', 'en', 'football'],
  ['Liverpool', 'liverpoolfc.com', 'en', 'football'],
  ['Tottenham', 'tottenhamhotspur.com', 'en', 'football'],
  ['Aston Villa', 'avfc.co.uk', 'en', 'football'],
  ['Newcastle', 'nufc.co.uk', 'en', 'football'],
  ['Juventus', 'juventus.com', 'it', 'football'],
  ['AC Milan', 'acmilan.com', 'it', 'football'],
  ['Inter', 'inter.it', 'it', 'football'],
  ['Napoli', 'sscnapoli.it', 'it', 'football'],
  ['Roma', 'asroma.com', 'it', 'football'],
  ['Como', 'comofootball.com', 'it', 'football'],
  ['Bayern Munich', 'fcbayern.com', 'de', ''],
  ['Bayer Leverkusen', 'bayer04.de', 'de', 'football'],
  ['Borussia Dortmund', 'bvb.de', 'de', 'football'],
  ['VfB Stuttgart', 'vfb.de', 'de', 'football'],
  ['RB Leipzig', 'rbleipzig.com', 'de', 'football'],
  ['PSG', 'psg.fr', 'fr', 'football'],
  ['Marseille', 'om.fr', 'fr', 'football'],
  ['Lens', 'rclens.fr', 'fr', 'football'],
  ['Lille', 'losc.fr', 'fr', 'football'],
  ['Porto', 'fcporto.pt', 'pt', 'football'],
  ['Sporting CP', 'sporting.pt', 'pt', 'football'],
  ['Benfica', 'slbenfica.pt', 'pt', 'football'],
  ['PSV', 'psv.nl', 'nl', 'football'],
  ['Feyenoord', 'feyenoord.com', 'nl', 'football'],
  ['Club Brugge', 'clubbrugge.be', 'nl', 'football'],
  ['Galatasaray', 'galatasaray.org', 'tr', 'football'],
  ['Fenerbahçe', 'fenerbahce.org', 'tr', ''],

  // ---------- football: clubs of Israelis abroad (config/athletes.json) ----------
  ['Ajax', 'ajax.nl', 'nl', 'football'],
  ['West Ham', 'whufc.com', 'en', 'football'],
  ['Crystal Palace', 'cpfc.co.uk', 'en', 'football'],
  ['Southampton', 'southamptonfc.com', 'en', 'football'],
  ['Bristol City', 'bcfc.co.uk', 'en', 'football'],
  ['Elche', 'elchecf.es', 'es', 'football'],
  ['Real Valladolid', 'realvalladolid.es', 'es', 'football'],
  ['Lecce', 'uslecce.it', 'it', 'football'],
  ['Saint-Étienne', 'asse.fr', 'fr', 'football'],
  ['Crvena Zvezda', 'crvenazvezdafk.com', 'sr', 'football'],
  ['New England Revolution', 'revolutionsoccer.net', 'en', 'football'],
  ['D.C. United', 'dcunited.com', 'en', 'football'],
  ['Colorado Rapids', 'coloradorapids.com', 'en', 'football'],
  ['Sporting Kansas City', 'sportingkc.com', 'en', 'football'],

  // ---------- basketball ----------
  ['NBA', 'nba.com', 'en', 'basketball'], // the league and all 30 teams' pages (nba.com/blazers, /nets, /kings...)
  ['EuroLeague', 'euroleaguebasketball.net', 'en', 'basketball'],
  ['Olimpia Milano', 'olimpiamilano.com', 'it', 'basketball'],
  ['Virtus Bologna', 'virtus.it', 'it', 'basketball'],
  ['ASVEL', 'ldlcasvel.com', 'fr', 'basketball'],
  ['Paris Basketball', 'parisbasketball.com', 'fr', 'basketball'],
  ['Anadolu Efes', 'anadoluefessk.org', 'tr', 'basketball'],
  ['Panathinaikos', 'paobc.gr', 'el', 'basketball'],
  ['Olympiacos', 'olympiacosbc.gr', 'el', 'basketball'],
  ['Žalgiris', 'zalgiris.lt', 'lt', 'basketball'],
  ['Partizan', 'partizan.basketball', 'sr', 'basketball'],
  ['Baskonia', 'baskonia.com', 'es', 'basketball'],
  ['Valencia Basket', 'valenciabasket.com', 'es', 'basketball'],
  ['Dubai Basketball', 'dubaibasketball.com', 'en', 'basketball'],

  // ---------- basketball: US colleges of Israelis abroad ----------
  ['Purdue', 'purduesports.com', 'en', 'basketball'],
  ['Florida State', 'seminoles.com', 'en', 'basketball'],
  ['Utah', 'utahutes.com', 'en', 'basketball'],
  ['Tennessee', 'utsports.com', 'en', 'basketball'],
  ['Seton Hall', 'shupirates.com', 'en', 'basketball'],
  ['Harvard', 'gocrimson.com', 'en', 'basketball'],
  ['Saint Louis', 'slubillikens.com', 'en', 'basketball'],
  ['Pepperdine', 'pepperdinewaves.com', 'en', 'basketball'],
  ['San Francisco', 'usfdons.com', 'en', 'basketball'],
  ['Florida Atlantic', 'fausports.com', 'en', 'basketball'],
  ['Middle Tennessee', 'goblueraiders.com', 'en', 'basketball'],
  ['Duquesne', 'goduquesne.com', 'en', 'basketball'],
  ['Lipscomb', 'lipscombsports.com', 'en', 'basketball'],
  ['Little Rock', 'lrtrojans.com', 'en', 'basketball'],
  ['Idaho State', 'isubengals.com', 'en', 'basketball'],
  ['Mercyhurst', 'hurstathletics.com', 'en', 'basketball'],
  ['Bryant', 'bryantbulldogs.com', 'en', 'basketball'],
];

// main address only: "www.realmadrid.com" and "realmadrid.com" count, "shop.realmadrid.com" doesn't;
// en.atleticodemadrid.com / en.legaseriea.it (a language version) do
const LANG_SUB = /^(www|en|es|it|de|fr|pt|he|ar|tr|el|nl|lt|sr)\./;
const byHost = new Map(OFFICIAL_SITES.map(([name, host]) => [host, name]));
export function officialName(url) {
  let h;
  try { h = new URL(url).hostname.toLowerCase(); } catch { return null; }
  if (byHost.has(h)) return byHost.get(h);
  const base = h.replace(LANG_SUB, '');
  return base !== h && byHost.has(base) ? byHost.get(base) : null;
}

const GROUP = 6; // sites per search: a busy day of 6 clubs stays under Google's 100 results
// sites with 100 articles a week or more (2026-11-07) get a search of their own
const BUSY = new Set(['football.org.il', 'realmadrid.com', 'fcbarcelona.com', 'psg.fr', 'fcporto.pt', 'slbenfica.pt', 'nba.com', 'whufc.com', 'mlssoccer.com', 'euroleaguebasketball.net', 'uefa.com', 'fcbayern.com']);
const LOCALE_LANG = { sr: 'sr', el: 'el', tr: 'tr', lt: 'lt' };
export function officialSources(gnews) {
  const byLocale = {};
  for (const [, host, locale] of OFFICIAL_SITES) (byLocale[locale] ||= []).push(host);
  const out = [];
  for (const [locale, all] of Object.entries(byLocale)) {
    const groups = all.filter((h) => BUSY.has(h)).map((h) => [h]);
    const rest = all.filter((h) => !BUSY.has(h));
    for (let i = 0; i < rest.length; i += GROUP) groups.push(rest.slice(i, i + GROUP));
    for (const [i, part] of groups.entries()) {
      out.push({
        id: `official-${locale}-${part.length === 1 ? part[0].split('.')[0] : i + 1}`,
        name: 'Google News',
        url: gnews(`(${part.map((h) => `site:${h}`).join(' OR ')}) when:1d`, locale),
        lang: LOCALE_LANG[locale] || locale,
        weight: 1,
        google: true,
        official: true,
        officialSite: true, // official only when the article's own address is on the list (officialName)
        assist: true,
        every: 15,
      });
    }
  }
  return out;
}
