# Discovery version (branch `discovery`)

A separate version of the radar, built in stages and reviewed after each. Nothing here is deployed,
pushed or sends notifications until the desk approves it.

## Stage 1 - registry, bounded queries, contextual filters

### Behaviour before this stage (baseline)

- People tracked: only the editors' ליגיונרים list (`config/athletes.json`, 40 names), searched by name in groups of 5.
- No registry of other Israel-linked people. Coaches, agents, former players, women and other-sport athletes were found only if a general feed carried them.
- No discovery searches for foreign reports with an Israeli angle (for example "Israeli footballer" in the local language).
- "Player ratings" headlines were always pushed down, including ratings of an Israeli abroad.
- YouTube podcasts, vlogs, women's and youth videos were always dropped, even with an Israeli in them.
- Local-league stories (Greece, Turkey, Portugal...) were exempt only through the editors' list, a big competition, spread or a short list of stars.
- Other sports were kept only for a named big event (final, Grand Slam, Olympics...) or wide spread.

### What changed

| Part | File | What it does |
|---|---|---|
| Candidate corpus | `config/watchlist-seed.json` | Every name from the brief's appendix A, grouped, with alias arrays, corrections and exclusions. Not a roster. |
| Vocabulary | `config/vocabulary.json` | Appendices B and C as editable families, plus the small discovery query set that actually runs. |
| Registry build | `scripts/build-watchlist.mjs` | Checks each candidate against the editors' list, `config/watchlist-overrides.json` and the 365Scores knowledge base, and writes `config/watchlist.json` and `docs/watchlist-review.md`. |
| Matching and queries | `src/watchlist.js` | Accent- and alias-aware matching; ambiguous names need sporting context; bounded, rotated queries. |
| Collector | `src/collect.js` | Runs the planned queries, records success and failure, annotates stories (`watch`, `watchIsrael`, `watchStar`), writes `public/data/watch.json`. |
| Filters | `src/editorial.js`, `src/youtube.js` | The contextual exceptions below. |

### Registry statuses

- **verified** (80): on the editors' list, or Israeli nationality in the knowledge base (players and Israeli clubs). Only these are searched by name and only these may carry an Israel link. Each records its basis (`editors-list`, `kb-nationality`, `kb-club-country`, or `editor` via overrides) and the squad-data date.
- **pending** (99): not found, found without Israeli nationality (for example Will Rayman, Max Heidegger, TJ Leaf: the knowledge base lists another nationality), or a coach, agent or former player whose role needs an editor. They are recognised in stories but never claim an Israel link and are never searched.
- **source-only** (282): world stars, world clubs and foreign-relevance players. Used for recognition and ranking only, never labelled ex-Israel.

Nationality, club, Israel link and active status are never inferred. Jewish identity is never treated as evidence of Israeli citizenship. To promote a pending entry, add it to `config/watchlist-overrides.json` with a basis and note, then run `node scripts/build-watchlist.mjs`.

### Matching

- Names are folded (case, accents, punctuation): "Gyökeres" = "Gyokeres", "Nir'on" = "Nir On". Whole words only.
- Hebrew names from the knowledge base or the editors' list are matched too.
- Ambiguous names (one-word names, common surnames, or several people with the name in the knowledge base) match only with their club named, or with Israel plus the right sport, or (one-word names) the right sport.
- A football name in a basketball story is treated as a namesake unless the person's club is named; clubs with the same name in two sports match only the story's sport.

### Queries (bounded)

- Mode A: verified people, name only, in groups that stay under 400 characters, in English plus the club's country language. People on the editors' list are skipped (they already have feeds). Ambiguous names are searched with their club.
- Mode C: discovery with an Israeli angle in 10 languages, and a few exceptional-story phrase sets. Results must pass the sports check (non-sports results are rejected and logged as `general-feed`).
- Mode B (name plus event families for pending figures) is not active: pending entries are not searched until verified.
- Each query has a canonical ID (the same text and locale give the same ID). Priorities: high every 1 hour (people abroad), normal every 3 hours, low every 8 hours (people at Israeli clubs, already covered by the Hebrew press).
- At most 6 queries per run. The most overdue go first; the rest are listed as deferred with the reason. A failing query backs off exponentially (up to a day). Queries no longer generated are forgotten.
- `public/data/watch.json` shows what ran (with result counts), what was deferred and why, and the registry counts.
- Note from testing: Google News returns nothing when an OR group is combined with another term, so each discovery query is a flat OR of phrases or two plain words.

### Contextual filter fixes

- Player ratings: still pushed down, unless the story has an Israeli angle or a verified watchlist person.
- YouTube: podcasts, episodes, vlogs, behind-the-scenes, women's and youth videos are kept when they name a tracked person (editors' list or verified watchlist). Shorts, live streams, compilations, merchandise and quizzes are always dropped, with or without a name.
- Local leagues: a verified watchlist person counts as an Israeli angle; registry world stars count as famous names (the short star list remains as fallback).
- Other sports: also kept for a verified Israeli, or an exceptional story (world record, doping ban, shock defeat, death...) that is spreading (2+ languages, 4+ sources) or about a registry star.

### Tests

`test/watchlist.test.js` (no network): aliases, accents, Hebrew, whole words, name-only, ambiguity, club sports, stable IDs, query bounds and dedup, scheduling with budget, rotation, deferral, backoff and expiry, a one-source Greek interview with a verified Israeli, player ratings, YouTube exceptions with junk still rejected, language versus source country, other-sports exceptionality, and the registry's corrections.

Stage 2 adds the tests for coverage labels (repeated reports are not independent confirmation; uncertain Sport5 coverage is never definitive absence), the views, and feedback weighting.

## Stage 2 - source roles, editorial rank, two views

### Source origin and role (`src/roles.js`)

- **Origin** (Israeli / foreign / unknown) comes from the outlet, never the language: a Hebrew publisher name, a known Israeli outlet (The Jerusalem Post, Times of Israel, i24NEWS, Israel Hayom, ynetnews, Haaretz...), an Israeli domain, or a Hebrew direct feed. The Jerusalem Post is Israeli in English; Marca writing about Maccabi is foreign.
- **Role**: Sport5 (the coverage reference), competitor (any other Israeli outlet), foreign press, official channel, reporter, aggregator (MSN, Yahoo...). Each story source in the app carries its origin and role.
- Sport5 articles reached through any Google search (publisher "ספורט 5") now count as Sport5 coverage. Before, they were missed: in the test run, Sport5 matches went from 49 to 55.

### Evidence

- **Spread is not corroboration.** The story counts outlets (Israeli / foreign) and never asserts that they are independent (`independent: "unknown"`).
- **Attribution** is explicit only: a reporting cue ("according to", "לפי", "דיווח", "según"...) together with an outlet name (Marca, The Athletic, Romano...; Hebrew spellings included). Similar titles alone prove nothing.
- **Lead source**: the cited outlet when its article is in the story ("attributed"); otherwise the earliest foreign report, labelled "originality unknown"; "cites X" when X is cited but its article was not collected.
- Only headlines and descriptions are read; every story says so.

### Coverage labels

- "Match found on Sport5", "Possible match on Sport5", "Found on Sport5 channels only", "No match found - last checked HH:MM", "Coverage check unavailable".
- "No match found" is used only when a Sport5 site source was read successfully in the last 90 minutes; otherwise the label is "unavailable". The app never says "not published".
- Competitors are listed separately ("Also found on competitors: ONE, Walla").
- The "no Sport5 match" filter keeps possible and channel-only matches, marked.

### Editorial rank (`src/rank.js`, `config/editorial-rank.json`)

- Separate dimensions, each 0-1:
  - Israeli relevance: verified connections only; pending people say "possibly Israel-linked (not verified)"
  - importance
  - news value: transfer, injury, coach change, interview, controversy, record; lower for live blogs, betting and generic ratings; reference pages are cut to 40%
  - freshness, halved when the publication time is unknown
  - attention and spread
  - Sport5 and competitor coverage
  - evidence: official, reporter, attributed, single source
- Weighted average to 0-100, with up to 4 human-readable reasons in Hebrew and English.
- Limitations are shown separately (single source, origin unknown, unverified "exclusive", time unknown, local league, check unavailable), so interest and evidence are not mixed.
- Editor votes adjust the rank only with 3+ distinct devices on the story, scaled by the number of voters, and capped at +-6 points. One device voting many times counts once.
- The popularity order is unchanged everywhere else.

### Views

- **גילוי מחו"ל / Foreign discovery**: stories with a foreign-origin report, including ones an Israeli outlet also covered. Sorted by the editorial rank. The slider has its own position here (default 80), so the other tabs keep theirs. The headline of an Israeli-led story opens the identified foreign report.
- **מעקב ישראלי / Israeli monitoring**: stories with an Israeli-origin report or an Israeli subject. Cards cross-link the foreign report when there is one.
- Cards in both views show why the story matters, the lead source and its status, outlet counts ("spread, not confirmation"), competitors, and limitations.
- Views only filter what is shown: every source, Israeli ones included, is still collected (tested).

### Tests

`test/roles.test.js`: origin versus language, roles, Israeli sources still collected and views, repeated reports versus confirmation, titles versus attribution, unavailable or uncertain Sport5 coverage never shown as absence, the local-interview example, "exclusive" and pending people, reference pages, Hebrew names, feedback sparsity and the cap.
