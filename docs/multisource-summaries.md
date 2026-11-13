# Multi-source AI summaries

Branch `multisource-summaries`, from production `33ed5c2` (Steps 1-3). The undeployed Step 4 is not included. No new request, no new
service, clustering (Steps 1-3), Telegram, scheduling, editor data and story ids are untouched.

## What the pipeline did before (checked in the code and on the saved state)

- `src/ai.js`: one summary request per run, 5 stories per request, the strong model (Gemini Flash) with Flash-Lite as fallback; 400 requests a
  day cap; separate card requests (Flash-Lite, 2 per run, 20 stories each). The input per story: up to 6 distinct headlines by weight and up to 3
  descriptions (confirmed). Output: Hebrew title, 2-3 sentence summary, English summary, facts, quotes.
- A summary was written again only when the outlet count doubled and grew by 3 (and 1 h passed): so a story with a new official statement or a
  new fee stayed as it was, and a story with six copies of one headline was refreshed.
- Real usage on 2026-10-19 (saved state): 358 of 400 summary requests, 800k tokens (about 2.2k tokens a request); the strong model's daily quota was
  already gone (HTTP 429) and the work ran on Flash-Lite. Cards: 277 requests, 1.67M tokens. So the provider is intermittently unavailable and
  every change here keeps the request count and degrades to the earlier summary.
- Only about a third of the articles have a feed description; articles found through Google News have none. Nothing reads full articles.

## What changed

`src/storysum.js` (new, no network) and small hooks in `src/ai.js`, `public/app.js`, `public/style.css`.

1. **Source selection** (stories with 3+ outlets; others use the old input). One article per outlet (the one with a description, official or journalist
   first); copies of a headline or description another outlet already gave are dropped (the earliest is the original candidate), unless the copy adds
   a number; then official sources, journalists, the earliest report, and greedily whatever adds the most new numbers, a quote, new words, within 8
   sources and 2,600 characters. Each source gets a stable id S1.. in time order. Recorded with the summary: which sources were sent, how many outlets
   exist, how many copies were dropped.
2. **Structured output**, asked in the same request: `claims` (a Hebrew fact, the source ids that say it, kind official / reported / rumor / analysis),
   `added` (what one outlet adds), `conflicts` (different values for one thing, or a denial). The old fields stay.
3. **Validation** against the sources that were sent: an invented source id rejects the claim (it is not trimmed); digits in a claim must be in the cited
   sources' text; "official" is kept only if a cited source is an official one; a conflict needs two valid sources and either different numbers or a denial
   word in the cited text. A deterministic amount conflict (two outlets, one differing amount each) is added without the model.
4. **Refresh** (`shouldRefresh`): a signature of the story's facts is saved with the summary. It is written again only for a new official source (not a club
   video), a new amount / duration / contract year, a status step (rumour, talks, agreed, official; not for match pages) or a first denial; never within 45
   minutes, never more than twice a day. More outlets alone never refreshes.
5. **Page**: `s.ai.he.rich` (only for such summaries) shows in the opened card: who reported what with the outlet names and a kind badge, extra details,
   contradictions, the outlets used, the basis ("headlines and RSS descriptions only, not the full articles") and why it was updated. Hebrew UI only; a story
   with one outlet looks as before.
6. **Older summaries** of stories that now have 3+ outlets are upgraded once, after the new stories.

## Example (illustrative: a hand-written answer in the mock format, over the real sources of one saved story, 2026-10-18)

Sources sent: S1 Yahoo Sports (reportedly torn Achilles in practice), S3 Shams Charania (journalist: "sources tell ESPN"), S5 Hoops Rumors (via Shams), S6 Sport5,
S8 The Athletic ("tears Achilles, expected to miss 2026-27; 30; one-year deal last month").

- summary: בן סימונס, שחקן סקרמנטו קינגס, נפצע באימון ביום ראשון, ולפי הדיווחים קרע את גיד האכילס. ESPN דיווחה על חשד לפציעה שתשבית אותו לעונה, ו-The Athletic מוסיף שהוא צפוי להחמיץ את כל עונת 2026/27.
- who reported what: חשד לקרע בגיד האכילס באימון (Yahoo Sports, Shams Charania, Hoops Rumors) [דיווח]; צפוי להחמיץ את כל העונה (The Athletic) [דיווח]
- added: The Athletic: בן 30, הצטרף לסקרמנטו לפני חודש בחוזה לשנה
- conflicts: none. Basis: 8 of 16 outlets, headlines and descriptions only.

## Measured (`node scripts/eval-summaries.mjs`; 38 real stories, 815 outlets; the model is mocked)

| | old | new |
|---|---|---|
| outlets the model sees | 21.3% | 35.8% |
| amounts, durations, contract years of the story present in the input (only 8 in 38 stories) | 3 of 8 | 3 of 8 (no gain; an earlier 42%→78% figure counted season years like 2026-27 and was wrong) |
| official / journalist sources included | 7 of 9 | 9 of 9 |
| outlets with a description included | 58 of 144 | 106 of 144 |
| input tokens per story (estimate) | avg 271, p95 376 | avg 345, p95 561 |
| invented sources / unsupported numbers caught (mock errors) | n/a | 38 of 38 / 38 of 38 |
| honest claims kept | n/a | 113 of 113 |
| refresh: 7 scripted changes (3 redundant, 4 meaningful), wrong decisions | 5 of 7 | 0 of 7 |
| refreshes replayed on 37 real stories | 33 | 6 |
| requests per run (summary / cards) | 1 / up to 2 | 1 / up to 2 |

Tokens: a request of 5 multi-source stories is about 1.7k input tokens for the sources (old about 1.4k) plus about 330 for the added instructions and about 150
more answer tokens a story: roughly 3.0-3.3k tokens against the 2.2k measured, a 35-50 percent rise on the batches where every story is multi-source
(estimate, characters over a rough ratio). The request count is unchanged, so the daily cap is not touched. The news file grows by about 1 KB per
multi-source summary (up to a few hundred KB at most).

Behaviour when Gemini fails: the request throws, the earlier summary stays untouched, the error and the 30 minute cooldown are recorded, nothing is invented
(tested with a 429). The deterministic fallback is the story's own source list that the card already shows.

## What the automated tests cover (16 tests in `test/storysum.test.js`, mutation-checked) and what they do not

Covered: selection (dedupe, budget, official kept, copies, large cluster), validation of citations, numbers, kinds and conflicts, refresh decisions, throttle
and idempotence, the real model path with a mocked provider (one request, sources recorded, a second run asks nothing, a redundant outlet asks nothing, a new
official source asks once, a quota error keeps the old summary, one-outlet stories unchanged, old summaries upgraded after new ones), the page's data, and 38
real stories.

NOT covered, and needs editorial review: whether a Hebrew summary is true or well written (no real model was called: no quota spent, no secret used); whether a
claim's wording is faithful to its cited source (the check is "the id exists and the digits are there", not understanding); which outlet is the true original.

## Known limits

- Digits are matched, number words are not ("forty million"); a number that is in another sentence of the cited text passes.
- Conflicts: the deterministic detector found none in 38 real stories (it is strict on purpose); model-reported conflicts need a differing number or a denial
  word in the cited text, so a conflict about "completed or not" is only caught through a denial word.
- A refresh for new information in words only (no amount, status, official source or denial) is not detected: a growing vocabulary fired on most stories in the
  replay. An amount in a feature ("£116m player") does trigger it once.
- Rumour / official labels rest on the model plus the official flag; "original reporting" is only the earliest non-copy source.
- Two events wrongly merged into one story give the model both sets of sources; nothing here detects that.

## Deploy and roll back

Deploy: push the commit. Nothing is quiet-run: summaries of 3+ outlet stories are rewritten gradually (5 stories a request, new stories first). Roll back:
revert the commit; the saved summaries keep their old fields (the extra `rv`, `sig`, `rich`, `refreshes` fields are ignored by the old code).

## Editorial-quality validation (second round)

**Live Gemini was NOT run.** `AI_API_KEY` is a production secret that is not in this environment, and it is not mine to ask for or handle, so no
real summary exists to judge: Hebrew quality, claim support against the source text, invented details, missing uncertainty and omissions are
still UNVERIFIED. What was done instead:

- `scripts/eval-summaries-live.mjs`: run it in your own shell (`AI_API_KEY=... node scripts/eval-summaries-live.mjs --yes --n 12`, add
  `SR_MEMORY=<state.json>` to show the old-format summaries, 7 of the 38 saved stories have one). At most ceil(n/5) requests (3 for 12 stories),
  cards and headline requests off, an empty throw-away state (nothing read from or written to the radar's state), stops at the first error or 429.
  It writes a review sheet: sources as sent with their descriptions, the Hebrew summary, each claim with the TEXT of the source it cites, what the
  checks dropped, the old summary, and the real request / token / error / model counts. Tried with `--mock`: 12 stories, 3 requests.
- Review of what the model would be GIVEN, on the 38 real stories, found two real problems, both fixed narrowly:
  1. Many large stories are piles (template pages, other matches): a rugby fixture and a court hearing sat inside "Fiorentina vs Como". Sources that
     share no club / player tag and no topic word with the rest are now not sent (6+ outlets; an untranslated Hebrew source cannot be judged and stays).
     Applied to 15 of the 38 stories, 33 sources removed; piles remain (the cause is in the clustering, outside this work).
  2. Injuries had no steps of their own: "believed to have torn" to "tears, out for the season" is a development, and the status rule only knew transfer
     steps. An injury step (suspected, then confirmed / ruled out / surgery) now counts as a status change.
- Refresh against real historical developments (the saved memory, articles replayed in arrival order, summary written after the first fifth):
  Nuno Mendes (refresh at "ruled out of PSG-Barcelona", right), Ben Simmons (refreshes on the $3.5m and $1m figures; the Achilles confirmation was already in
  the first 39 articles), Alisson Santos (refresh at the return/relapse news), Kulusevski (refresh at his return), Sergio Ramos / Getafe (refresh when
  Getafe's interest appeared), Allegri (one refresh as the sack talk grew), Man City and Courtois had too few separate articles to replay. No clearly
  meaningful development was missed in these; two refreshes are debatable (an older fee quoted in a feature, a return from injury).
