# Can the slider control which stories are available?

> **Implemented** as the pool in `src/capselect.js` (see `docs/g1-cap.md`, which has the final measurements). The tables below are the investigation that led to it, from the earlier `bench-sorting-aware` run; the implementation also lists the Israeli monitoring tab, which this investigation had not measured.

Investigation only. Nothing here changes production; `CAP_G1` stays off or `shadow`. Offline replay on the saved state of 2026-10-19 22:10 UTC (5 snapshots 3 hours apart, 13 consecutive 5-minute runs for churn). Reproduce: `node scripts/bench-sorting-aware.mjs --state <state.json> --json docs/sorting-aware-bench.json` (about 4 minutes). File sizes were measured on the live site (public GET requests only), 2026-11-18.

## 1. How the front end gets and uses the stories

- `news.json` holds the newest 300 stories by first-article time plus every Israeli story and the brief's stories (`src/collect.js` `firstIds`); `news-more.json` holds the rest. The page loads `news.json`, draws it, then loads `news-more.json` and joins the two into **one array**, `state.data.stories` (`public/app.js` `load`, `withMore`, lines about 1864 to 1935). Every tab, filter, search and slider position reads that array (`storiesFor`).
- Later updates arrive as `data/delta.json` (stories added, removed, patched, and the order of both files), applied by `public/delta.js`; the full files are fetched only when the delta does not fit.
- The slider re-sorts the array by `w x editorialScore/100 + (1 - w) x exp(-(now - first)/6h)` (`rankMix`, line 929) and shows the first **300 stories, or 120 when the slider is at 70 or more** (line 921). The Top, football and basketball tabs first remove local, low and minor stories (`OFFBEAT_TABS`). The football and basketball tabs exclude Israeli stories (`inTab`, line 664). League and language filters apply before the sort.
- So the slider chooses only **from what is in the array**. The array is exactly the cap's output. Nothing in the file format has to change to give different slider positions different candidates: the pool only has to contain what each position can show.

## 2. What today's 1,200 holds, by tab (final snapshot)

| Tab | Eligible non-Israeli stories (not off-beat) | In today's 1,200 | Oldest in it (hours since last article) |
|---|---|---|---|
| Football | 3,047 (1,159 in the last 12 h) | 285 | 3.9 |
| Basketball | 650 (241 in the last 12 h) | **69** | 3.8 |

The Basketball tab at "Newest" has about 3.8 hours of stories and the Football tab about the same, because the cap keeps the newest stories of all sports together. This, not the Top tab, is where the cap bites hardest.

## 3. Three approaches, measured

All keep the Israeli-first tier. "Recall" = share of the list the app would build from every eligible story that is present in the pool, at slider positions 0, 10, 25, 35, 50, 65, 75, 85, 100 on the Top, football and basketball tabs. The pool for approach C is built only from positions 0, 25, 50, 75, 100, so 10, 35, 65 and 85 test that it generalises.

- **A. Today**: the newest non-Israeli stories up to 1,200.
- **B. G1**: the non-Israeli stories with the best 50/50 mix, up to 1,200 (`src/capselect.js`).
- **C. Sorting-aware**: the union of the lists the slider can show on the Top, football and basketball tabs at positions 0, 25, 50, 75 and 100 (the app's own formulas and slices; no new rule). **C1200** is the same trimmed to exactly 1,200 by taking the lists in turn (best story of each list first) until the cap is reached.

| | A today | B G1 | C | **C1200** |
|---|---|---|---|---|
| Stories published | 1,200 | 1,200 | 1,226 | **1,200** |
| Worst recall, any tab, any position | 19.3% | 21.8% | 96.0% | **93.1%** |
| Top tab, mean over positions | 96.6% | 100% | 100% | 100% |
| Football tab @ 0 / 50 / 100 | 71.9 / 73.5 / 65.3% | 99.7 / 100 / 81.7% | 100 / 100 / 100% | 96.9 / 97.8 / 100% |
| Basketball tab @ 0 / 50 / 100 | 19.8 / 19.5 / 26.7% | 21.8 / 21.8 / 30.2% | 100 / 100 / 100% | 96.2 / 97.2 / 100% |
| Positions not used to build C (10, 35, 65, 85), football and basketball | 19 to 97% | 22 to 100% | 96 to 100% | 93 to 100% |
| Older high-value stories restored (the cut stories at the timeless top 10%) | 0% | 6.2% | 19.7% | 19.7% |
| Stories entering / leaving the published set per 5-minute run | 17.3 / 17.3 | 14.2 / 14.2 | 8.6 / 8.5 | 9.3 / 9.3 |

G1 fixes the Top tab (the audit's measure) and does almost nothing for the basketball tab (21.8%), because it picks the best 1,200 of all sports together. C1200 serves every tab and slider position from the same 1,200, and changes less from run to run (the lists it is made of are stable), which helps `delta.json`.

**Filters.** League and language filters are applied before the sort, and a pool built without knowing them cannot hold every filtered list. Top tab, mean over the slider positions shown, today / G1 / C1200:

| Filtered view | A | B | C1200 |
|---|---|---|---|
| Premier League @ 0 / 50 / 100 | 30 / 39 / 71% | 44 / 53 / 82% | 35 / 46 / 88% |
| NBA @ 0 / 50 / 100 | 22 / 22 / 35% | 23 / 23 / 37% | **76 / 76 / 97%** |
| Euroleague @ 0 / 50 / 100 | 28 / 28 / 57% | 27 / 27 / 56% | **59 / 59 / 90%** |
| Champions League @ 0 / 50 / 100 | 45 / 48 / 67% | 82 / 85 / 82% | 58 / 62 / 91% |
| Hebrew articles @ 0 / 50 / 100 | 70 / 89 / 100% | 72 / 92 / 100% | 75 / 91 / 100% |

A fourth pool, **CL**, adds the top 100 of each league the app can filter on (nine leagues, positions 0, 50, 100). It reaches 47 / 59 / 96% for the Premier League and 49.5% of the older high-value stories, but costs 366 more stories (below). The league lists are just deeper than a 100-story slice, so filters stay a limit of every option here.

## 4. Cost

Measured on the live site (1,200 stories): `news.json` 2.23 MB raw, 515 KB gzip; `news-more.json` 1.78 MB raw, 528 KB gzip; `delta.json` 706 KB raw, 128 KB gzip; served by GitHub Pages with gzip and `Cache-Control: max-age=600` (the page adds `?t=` and `no-store`). That is **3.0 KB raw and about 0.84 KB gzip per story**. Parsing both files in Node: 24 ms, +7 MB heap (5.8 KB per story). Browsers will be slower, in the same proportion.

| | Extra stories | Extra raw | Extra gzip (per full download; today 1.04 MB) | Extra parse | Extra heap |
|---|---|---|---|---|---|
| A, B, **C1200** | 0 | 0 | 0 | 0 | 0 |
| C | +26 | +76 KB | +21 KB (+2%) | +0.5 ms | +0.1 MB |
| CL | +366 | +1.08 MB | +301 KB (+29%) | +7 ms | +2 MB |

GitHub Pages serves the files statically, so a larger file costs transfer only; I did not measure Pages' own limits or a real browser, and the replay's per-story size is today's (a story added from further down the list has the same shape). C1200 needs no additional bytes at all.

## 5. What stays the same

The Israeli tier and its priority; the filters, the search (still over the whole array) and the sorting controls; the front end (no change); story ids. Telegram, summaries, translations, the brief and trends read the legacy list, and the brief and Telegram pins work as in `docs/g1-cap.md`, because C1200 would replace only the choice of the non-Israeli stories inside the same `applyCap` structure. No new model calls: pool-only stories are display-only like G1's.

## 6. Recommendation

**Use C1200 instead of G1's fill, before enabling anything.** Same 1,200 total, same file sizes and format, no front-end change, no new ranking rule (it takes the app's own slider lists on its own tabs). It lifts the football and basketball tabs from about 20 to 73% recall to 93 to 100%, keeps the Top tab at 100%, and halves the churn. G1 on its own would leave the basketball tab at 22%, so it solves the measured problem only for the Top tab.

Do not do now: CL (+29% download) until league filters are shown to matter to the desk; the older high-value stories (19.7% restored) stay mostly out, as the 50/50 mix and the editorial score's own freshness weight keep old stories low at every slider position.

How it would be built (not done): a `selectPool` next to `selectG1` in `src/capselect.js` that takes, for each of the three tabs and the five slider positions, the app's list (same predicates and the same 300 / 120 slices), and merges them in turn up to 1,200 after the Israeli tier, then tops up with G1's order. Risks: the tab predicates and the slider formula are copied from `public/app.js` and would drift if the front end changes, so a test should read the constants from the page; the replay lacks the watchlist, desk labels and the Sport5 check; league and language filters remain partly served (table above); results are for one 48-hour window. Run it in `shadow` first and compare the recall the log reports with the table.
