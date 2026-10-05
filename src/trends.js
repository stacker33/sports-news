// 🔥 What people are searching for, sports only — for the editors' "Trends" panel.
//   • Google Trends (Israel + 9 countries, from signals.js): the free feed has no sports filter, so a trend counts only
//     when the news articles Google attaches to it come from sports sites / sports sections (most of them), or the
//     term names an Israeli abroad. Words alone are not enough ("rockets", "curry", "Barcelona" the festival…).
//   • Wikipedia most-viewed (yesterday, en + he): only sports pages; plus Israelis abroad whose views jumped.
//   • Reddit hot posts (r/soccer, r/nba, r/Euroleague).
// A sports trend with no story yet gets its own Google News search for a few hours (trendSources), so the stories
// arrive instead of just a search term.
import { gnews } from '../config/sources.js';

const GEO = {
  IL: { locale: 'he', lang: 'he' },
  GB: { locale: 'en-GB', lang: 'en' },
  US: { locale: 'en', lang: 'en' },
  ES: { locale: 'es', lang: 'es' },
  IT: { locale: 'it', lang: 'it' },
  DE: { locale: 'de', lang: 'de' },
  FR: { locale: 'fr', lang: 'fr' },
  TR: { locale: 'tr', lang: 'tr' },
  GR: { locale: 'el', lang: 'el' },
  BR: { locale: 'pt-BR', lang: 'pt' },
};
const SEARCH_HOURS = 6; // how long a trend keeps its own news search
const MAX_SEARCHES = 8;
// trends that are never sports news on their own, even with a sports word nearby
const NOT_NEWS = /\b(tickets?|stream(ing)?|live score|score|channel|tv|odds|betting|bet|horoscope|weather|lottery|לוטו|מזג|כרטיסים|שידור)\b/i;
// sports-only sites (general news sites count through their sports-section addresses, SPORT_PATH)
const host = (u) => { try { return new URL(u).hostname.replace(/^(www|m|amp)\./, ''); } catch { return ''; } };
const SPORT_HOSTS = new Set([
  'espn.com', 'marca.com', 'as.com', 'mundodeportivo.com', 'sport.es', 'relevo.com', 'gazzetta.it', 'corrieredellosport.it', 'tuttosport.com',
  'lequipe.fr', 'footmercato.net', 'rmcsport.bfmtv.com', 'kicker.de', 'sport1.de', 'transfermarkt.com', 'skysports.com', 'theathletic.com',
  'abola.pt', 'ojogo.pt', 'record.pt', 'maisfutebol.iol.pt', 'ge.globo.com', 'lance.com.br', 'fanatik.com.tr', 'fotomac.com.tr', 'sporx.com',
  'sport24.gr', 'gazzetta.gr', 'sdna.gr', 'sport5.co.il', 'one.co.il', 'sport1.maariv.co.il', 'cbssports.com', 'si.com', 'nba.com',
  'bleacherreport.com', 'goal.com', 'fourfourtwo.com', 'football-italia.net', 'eurohoops.net', 'basketnews.com', 'tennis.com', 'atptour.com',
  'formula1.com', 'motorsport.com', 'autosport.com', 'cyclingnews.com', 'olympics.com', 'uefa.com', 'fifa.com', 'euroleaguebasketball.net',
]);
const SPORT_PATH = /\/(sports?|deportes?|desporto|esportes?|spor|futbol|futebol|football|soccer|calcio|fussball|fu%C3%9Fball|basket(ball)?|baloncesto|nba|tennis|tenis|ciclismo|cycling|formula-?1|f1|motorsport|athletics|atletismo|olympics?|rugby|golf|boxing|mma|ufc|ספורט|αθλητικα)(\/|-|$)/i;
const sportyUrl = (u) => {
  const h = host(u);
  return [...SPORT_HOSTS].some((x) => h === x || h.endsWith('.' + x)) || SPORT_PATH.test(u) || /^sports?\./.test(h);
};
const NOT_SPORT_WIKI = /\((\d{4} )?(film|miniseries|tv series|television series|novel|band|singer|album|song|actor|actress|rapper|musician|politician|book)\)/i;
const SPORTY_WIKI = /\((association )?footballer|soccer|basketball|football club|f\.c\.|\bfc\b|tennis|cricketer|racing driver|boxer|cyclist|athlete|swimmer|golfer|coach|manager|baseball|american football|ice hockey|wrestler|fighter|olympics?|cup|championship|league|season\)|כדורגל|כדורסל|שחקן|ספורט|אולימפי/i;

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40);

// Is this Google trend about sport? → the reason, or null
function sportsTrend(tr, storiesWithTerm, isAbroad) {
  if (NOT_NEWS.test(tr.term)) return null;
  if (isAbroad(tr.term)) return 'abroad'; // names an Israeli abroad
  const urls = tr.urls || [];
  // people searching for a news site by name ("protothema") or a too-short word aren't a topic
  if (!tr.term.includes(' ') && (tr.term.length < 5 || urls.some((u) => host(u).includes(tr.term)))) return null;
  if (urls.length) {
    const sporty = urls.filter(sportyUrl).length;
    return sporty >= 1 && sporty * 2 >= urls.length ? 'sites' : null;
  }
  // no articles from Google: only when several of our (sports) stories carry the exact term in their headline
  return storiesWithTerm >= 2 && tr.term.length >= 6 ? 'stories' : null;
}

/**
 * @param signals { trends:[{term,traffic,geo,news[]}], reddit:[{title,rank,sub,link}], wiki:{top:[{wiki,title,views,prev}], athletes:{name:{views,ratio}}} }
 * @param stories the final stories (with id, trending, wikipedia, score, title, t)
 * @param isAbroad (text) → true when it names an Israeli abroad
 */
export function trendBoard(signals, stories, isAbroad, athletes = [], now = Date.now()) {
  // Google Trends: one row per term (several countries → the biggest, with all flags)
  const byTerm = new Map();
  for (const tr of signals.trends || []) {
    const row = byTerm.get(tr.term);
    if (!row) byTerm.set(tr.term, { ...tr, geos: [tr.geo] });
    else {
      if (!row.geos.includes(tr.geo)) row.geos.push(tr.geo);
      if (tr.traffic > row.traffic) Object.assign(row, { traffic: tr.traffic, geo: tr.geo, news: tr.news.length ? tr.news : row.news });
    }
  }
  const storyText = stories.map((s) => ({ s, text: ' ' + [s.t?.en?.title, s.title, s.t?.he?.title].filter(Boolean).join(' ').toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ') + ' ' }));
  const google = [];
  for (const tr of byTerm.values()) {
    // our stories with the term in their headline (whole words)
    const linked = tr.term.length >= 4 ? storyText.filter(({ text }) => text.includes(' ' + tr.term + ' ')).map(({ s }) => s) : [];
    const why = sportsTrend(tr, linked.length, isAbroad);
    if (!why) continue;
    linked.sort((a, b) => b.score - a.score);
    google.push({ term: tr.term, traffic: tr.traffic, geo: tr.geo, geos: tr.geos, news: tr.news[0] || '', url: (tr.urls || []).find(sportyUrl) || (tr.urls || [])[0] || '', ids: linked.slice(0, 5).map((s) => s.id), n: linked.length, why });
  }
  google.sort((a, b) => b.traffic - a.traffic);
  const il = google.filter((g) => g.geos.includes('IL')).slice(0, 12);
  const world = google.filter((g) => !g.geos.includes('IL')).slice(0, 25);

  // Wikipedia: yesterday's most-viewed sports pages
  const wikiStory = new Map(stories.filter((s) => s.wikipedia?.title).map((s) => [s.wikipedia.title, s]));
  const inStories = (title) => {
    const t = ' ' + title.replace(/ \(.*\)$/, '').toLowerCase() + ' ';
    return storyText.filter(({ text }) => text.includes(t)).length >= 2;
  };
  const wiki = (signals.wiki?.top || [])
    .filter((w) => !NOT_SPORT_WIKI.test(w.title) && (SPORTY_WIKI.test(w.title) || isAbroad(w.title) || (w.title.includes(' ') && inStories(w.title))))
    .sort((a, b) => b.views - a.views)
    .slice(0, 15)
    .map((w) => ({ wiki: w.wiki, title: w.title, views: w.views, ratio: w.prev ? Math.round((w.views / w.prev) * 10) / 10 : null, id: wikiStory.get(w.title)?.id || null }));
  // Israelis abroad whose page views jumped (×3 and more)
  const heOf = new Map(athletes.map((a) => [a.name, a.name_he || a.name]));
  const spikes = Object.entries(signals.wiki?.athletes || {})
    .filter(([, a]) => a.ratio >= 3 && a.views >= 200)
    .sort((a, b) => b[1].ratio - a[1].ratio)
    .slice(0, 8)
    .map(([name, a]) => ({ name, he: heOf.get(name) || name, views: a.views, ratio: a.ratio }));

  // Reddit: the top of each list
  const reddit = ['soccer', 'nba', 'Euroleague'].flatMap((sub) =>
    (signals.reddit || []).filter((r) => r.sub === sub && !/^(daily|weekly|free talk|match thread|post match thread|game thread|post game thread)\b|\b(moan|discussion thread|megathread)\b/i.test(r.title)).slice(0, sub === 'Euroleague' ? 4 : 8).map((r) => ({ sub, title: r.title, link: r.link || null, rank: r.rank }))
  );

  return { at: now, google: { il, world }, wiki, spikes, reddit };
}

// Google News searches for sports trends that have no story yet (kept for SEARCH_HOURS, at most MAX_SEARCHES)
export function nextTrendSearches(board, prev = {}, now = Date.now()) {
  const out = {};
  for (const [term, t] of Object.entries(prev)) if (now - t.since < SEARCH_HOURS * 3600e3) out[term] = t;
  for (const g of [...board.google.il, ...board.google.world]) {
    if (g.n === 0 && !out[g.term] && GEO[g.geo]) out[g.term] = { geo: g.geo, since: now };
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1].since - a[1].since).slice(0, MAX_SEARCHES));
}

export function trendSources(searches = {}) {
  return Object.entries(searches).map(([term, t]) => {
    const g = GEO[t.geo] || GEO.US;
    return { id: `trend-${slug(term)}`, name: 'Google News', url: gnews(`"${term}" when:1d`, g.locale), lang: g.lang, weight: 1, google: true, every: 10, assist: true, trend: term };
  });
}
