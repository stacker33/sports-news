# Sports Radar · רדאר ספורט

Live sports news and scores in one place, in Hebrew and English.

**News tabs**
- 🔥 Top
- 🇮🇱 Israeli football · 🇮🇱 Israeli basketball · 🇮🇱 Olympic & more
- ✈️ Israelis abroad: a button per player, plus optional news about their clubs
- ⚽ World football · 🏀 World basketball · 🏆 Other sports (biggest stories only)

**Side panel** (on a phone it's the bottom menu)
- 📊 **Live scores:** today, yesterday or tomorrow. Covers the Israeli leagues (football and basketball), the European cups, the top-5 leagues, the NBA and EuroLeague. Games of clubs with an Israeli player are pinned at the top with a ⭐. Data comes from 365Scores' public feed.
- ⚡ **Just in:** every new story the moment it's collected.

**Notifications (🔔):** choose which stories alert you: Israelis abroad, Israeli sport, big or breaking stories, goals and results for Israelis' clubs, or everything. They work while the app is open, including in the background.

**Sources:** about 100 feeds.
- Israeli: ONE, Walla, Ynet, Sport5, Sport1, Haaretz, Maariv, Israel Hayom, Kan, JPost.
- World: BBC, Sky, Guardian, Telegraph, ESPN, The Athletic, Yahoo, CBS, RealGM, Eurohoops, Marca, AS, Gazzetta, L'Équipe, kicker and more.
- Top reporters: Fabrizio Romano, David Ornstein and Shams Charania, via the outlets that report their scoops.
- Automatically, for each player abroad: Google News searches in English and Hebrew, their club's local press in its own language, and a BBC club feed for English clubs.

Stories that many outlets report are merged into one card and ranked higher.

**World coverage**
- Headlines in other languages are translated automatically into Hebrew and English, using Google Translate's free web endpoint.
- The same story is merged across languages. For example, English, Hebrew, Greek and Dutch articles about Israel–Ireland become one card.
- **Opponents' press:** before and after every game of Israel's national teams, and of Israeli clubs in Europe, the app automatically searches the opponent's own media, in its own language. For example, Irish press for Israel–Ireland, Turkish press for Maccabi–Beşiktaş. Filter it with the 🆚 buttons in the Israeli tabs.
- **Biggest sports stories in 10 other countries:** Spain, Italy, Germany, France, Portugal, Brazil, Argentina, Turkey, Greece and the Netherlands.

**Ranking ("🔥 Top")** combines:
- how many outlets report the story, weighted by reliability
- how many languages or countries it appears in
- how fast it spread
- Google Top Stories placement
- 📈 Google Trends search volume in 10 countries
- 👍 Reddit hot lists (r/soccer, r/nba, r/Euroleague)
- 📚 Wikipedia attention: yesterday's most-viewed articles (English and Hebrew), plus each Israeli abroad's views compared with their normal level
- freshness

**Topic tags on every story:** each story is tagged with what it's about, for example 🏆 La Liga · 🛡️ Real Madrid · 👤 Kylian Mbappé. Israeli clubs and Israelis abroad are highlighted in blue. Tap a tag to see only stories about it; tap it again to clear.
- Tags are recognized in any language, from the headline or its translation, including Hebrew with prefixes (e.g. "בריאל מדריד" → Real Madrid).
- The knowledge base comes from 365Scores league tables and squads, in Hebrew and English: about 330 teams in 17 leagues and all their players. It's stored in `public/data/entities.json` and refreshed weekly.

**The 🕒 ↔ 🔥 slider** changes the order in every tab, from "newest first" to "most popular". The middle mixes both.

**⭐ For you:** learns from the stories you open (players, teams, opponents, topics, sources). Each card explains "because you read about…". Older reads fade over about a month.
- When the PC version is running, your reading history syncs between the PC and a phone on the same Wi-Fi.
- It's stored only on your PC, in `private/profile.json`, which is never published.
- "Reset learning" clears it.

## Run on your PC

```bash
npm install
npm start
```

Open http://localhost:3000. The console also prints an address for your phone while it's on the same Wi-Fi. News updates every minute. Google News searches are spaced out (every 3–8 minutes) to avoid being blocked.

## Edit the Israelis-abroad list

In the app, go to **✈️ Israelis abroad → ✏️ Edit list**. You can add, remove or change players, their club, the club's country and alternative spellings. When you save, the app immediately starts collecting news for the players and their clubs, and adds their clubs' games to the scoreboard.

**Automatic updates:** the editor compares your list with the current squads on 365Scores and suggests changes, which you approve with one tap:
- 🔄 a player moved to another club abroad → update his club
- 🏠 a player returned to an Israeli club → remove him
- ➕ an Israeli (by nationality) is playing at a club abroad and isn't on your list → add him

"Ignore" hides a suggestion permanently. Coverage is the 17 leagues in the knowledge base; players in other leagues (Japan, Romania…) are still kept up to date by hand. The button shows the number of updates, e.g. "✏️ Edit list · 2 updates".

**📝 Summary on every story:** one or two sentences in a bubble, taken from the feed's description or from the article page (Google News links are decoded to the real article). Summaries in foreign languages are translated automatically. Missing summaries are fetched gradually, 8 per minute, most important stories first.

If a club shows "⚠ not found on the scoreboard", add its common short name under "Other team names" (for example, "DC United" for "D.C. United").

The list lives in `config/athletes.json`.

## Cloud version (GitHub, free, 24/7)

See `.github/workflows/collect.yml`. GitHub Actions collects news every ~5 minutes and GitHub Pages hosts the app. The cloud version can't save list edits from the app, so edit the list on the PC version and push it, or edit `config/athletes.json` on github.com.

## Customize

- `config/sources.js`: news sites, their reliability weight and how often each is fetched.
- `config/athletes.json`: Israelis abroad.
- `src/classify.js`: keywords that decide the sport, whether a story is Israeli, and breaking-news words.
- `public/scores.js`: which leagues appear on the scoreboard.
