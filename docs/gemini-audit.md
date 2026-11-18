# Gemini efficiency audit

Branch `gemini-audit`, from `origin/main` at `7c482a4`. **Audit only: production behaviour unchanged, nothing pushed or deployed, no Gemini call made** (the real `aiSummaries()` was replayed against a stub; the radar's own public `sources.json` was read for the live figures). Labels: **(M)** measured on saved data, the live site or the real code; **(A)** assumption.

Evidence used: the saved production state of 2026-10-19 (the newest copy available offline: 2,447 summaries, 555 headlines, 13,432 cards, the counters); the live `data/sources.json` and `news.json` of the radar on 2026-11-18, sampled every minute for ~15 minutes; the source of `src/ai.js`; an offline replay (`scripts/gemini-audit.mjs`, results in `docs/gemini-audit.json`). Not available: the Actions logs (a token is needed) and today's private state; the exact text of the 429 answers is cut to 120/200 characters everywhere it is stored.

## 1. Every Gemini request path (M, from the code)

All requests go through `callModel()` in `src/ai.js` (`chat/completions`, the free-tier key). Nothing else in `src/` calls Gemini (translation of titles and summaries uses Google's web translate endpoints, not Gemini; `scripts/check-gemini-models.mjs` and `eval-summaries-live.mjs` are manual tools, not run by the collector).

| # | Path | Model | Per run | Counted in the "n/400"? | Own cap |
|---|---|---|---|---|---|
| 0 | **Cards**: Hebrew headline + 1-2 sentence summary + desk verdict + sport for new foreign stories (20 per request) | light (`gemini-flash-lite-latest`) | up to 2 (second only with a backlog of 20+) | **No** (own counter `cls.used`) | `AI_CLASSIFY_CAP`, 450 a day |
| 1 | **Summaries**: Hebrew title, summary, English summary, facts, quotes for up to 5 stories (new, older prompt version, or outlets doubled) | strong (`gemini-flash-latest`), on failure the backup (`gemini-2.5-flash`, unless `altOff`), then the light model | at most 1 call, up to 3 attempts | **Yes**, every attempt | 400 a day, 20 an hour |
| 2 | **Headlines**: Hebrew headline for 30 foreign stories with no AI text at all (needs 5+) | light | at most 1 | **Yes** | same |

Retries: none in the usual sense. A "retry" is the fall-through inside one summaries call: strong, then backup, then light, taken on 5xx, timeout (75 s), 429 or 400/404 of the strong model. A 400 mentioning reasoning is retried once with the next reasoning level. Cached results are never re-requested: a story is asked again only if it has no summary, an older prompt version, or its outlet count doubled (flag `AI_RICH_SUMMARIES` is off by default and not used in these paths).

## 2. What the counter measures (M)

`ai.used` (shown in the page as "n / 400" and published in `sources.json`) is incremented **before** each attempt of paths 1 and 2, so it counts failed attempts, fall-through attempts and the attempts the model answered with an error. It does **not** count cards (path 0), cached results (they make no request), or runs that make no request. It resets at 00:00 UTC. Two more numbers use the same list of attempts: the **hourly pace** (`hourly`, 20 attempts per rolling hour; two attempts of one call carry the same timestamp) and the cooldown.

So "269/400" is **not** the quota use: cards are extra (**Oct 19: 358 counted + 277 card requests = 635 requests that day (M)**), and Google's real limits (per model, per minute, per day, per token) are separate and lower or different. **Live evidence (M):** at 22:45 UTC on 2026-11-18 the radar counted 271/400 and the run ended with `HTTP 429 "You exceeded your current quota…"` from the light model. The binding limit was Google's, not the 400.

## 3. Accounting by operation (M, saved state of 2026-10-19)

| | Requests | Useful outputs | Tokens |
|---|---|---|---|
| Counter (summaries + headlines) | 358 attempts | 734 summaries + 182 headlines = at least 154 successful calls | 799,621 |
| Cards | 277 | 4,138 cards (at least 207 calls) | 1,670,256 |
| Total | **635** | | **2.47 M** (68% in cards) |

- **2.3 attempts per successful summary/headline call (M):** 358 attempts / at least 154 calls. The saved `hourly` list shows 18 of its 20 entries as same-timestamp pairs: the strong model failed instantly (`strong`: HTTP 429 after **134 ms**) and the light model answered, every time. `altOff` was `true`, so the backup model was never tried. Those pairs also fill the hourly pace (20 attempts = only ~10 calls an hour).
- Outputs per hour ranged from 4 to 54 summaries (Oct 19), so the work is paced, not continuous.
- Live today (M, `sources.json`, 22:40-22:50 UTC): 269 → 271 (+2, a call whose both attempts got 429) → 271 (+0: cooldown). Whole runs took 82-118 s.

## 4. Why a run makes requests but writes zero new summaries (M by code + replay)

Normal (no error):
1. **Nothing to do.** Every story in the 18-hour window already has its summary or card: no request at all (replay and `test/gemini-accounting.test.js`). `[collect] AI summaries: 0 new` is the normal line of a quiet run.
2. **Pacing.** 20 counted attempts in the last hour, or 400 today: no summary request (in the replay of a healthy day the summary path is blocked in 143 of 288 runs, by design: the day's budget is spread).
3. **Cooldown.** After a 429 (both models) the summary path waits 30 minutes (live: the 22:50 run: +0 requests).
4. **Headlines path** needs 5+ stories with no AI text: usually skipped because cards already gave them a headline.

Errors / waste:
5. **Failed attempt** (503, timeout, 429): counted, no output; no cooldown after a 503 (M by test): the same requests are made again 5 minutes later.
6. **Rejected answer.** A Hebrew check (`goodHe`) rejects an answer (Latin letter glued to Hebrew, no Hebrew); the story stays "without summary" and is asked again **on every run** with no attempt counter (M by test; the replay with 3 always-rejected top stories sends them 148 times a day, taking up to 3 of the 5 slots of about half of the calls, and 1,272 summaries instead of 1,420, **A** that such stories exist: no log of rejections exists to measure it).
7. **Dashboard quirk (M, live):** during a cooldown the run clears `error` (`st.error = null` after the skipped block), so the dashboard shows OK although the AI paused.

## 5. Repeated HTTP 503 (M by replay, wait time A)

The replay runs the real code for 24 hours of 5-minute runs on the stories of the saved state; Gemini is a stub in six situations.

| Situation (current code) | Requests | Failed | Summaries / headlines / cards written | Runs with zero new summaries |
|---|---|---|---|---|
| healthy | 902 | 0 | 1,420 / 3,378 / 9,159 | 4 |
| strong model 503 all day | 913 | 290 | 725 / 68 / 9,159 | 143 |
| **all models 503 all day** | **731** | **731** | 0 / 0 / 0 | 288 |
| all models 503 in 3 two-hour bursts | 875 | 197 | 930 / 3,065 / 7,342 | 102 |
| strong 429 (saved-state pattern: `altOff` true) | 913 | 218 | 1,090 / 48 / 9,159 | 70 |

(The replay pool is the Oct 19 volume, 10.8 k foreign stories, so the healthy day hits the 400 cap; today's volume is lower.) In an all-model outage the code makes **3 failing summary-path requests plus 1 failing card request per run** (the card loop stops at its first failure): 731 failed requests a day (M). Per run: production's AI stage was 39.4 s with these 3 requests, i.e. about **13 s per failing request (derived from the given production timing, A that it is evenly spread)**, which I used as the failure latency (LAT in the script); a 429 answers in 0.2 s (M, 134 ms in the saved state). Failed attempts also eat the hourly pace: in the burst day, 190 runs are blocked by pace/cap.

**Does a bounded cooldown save time without delaying useful work?** Candidate: after a run in which the summary path ended in a 5xx/timeout (every model tried failed), no summary-path request for N minutes (the existing `cooldownUntil` that already follows a 429); a failed card request stops the card path the same way. Replay (changed copy of `ai.js`, `docs/gemini-audit.json`):

| Cooldown | All models 503 all day: requests | assumed wait | 3 two-hour bursts: failed requests | summaries written | p90 minutes to a summary (top-100 stories) |
|---|---|---|---|---|---|
| none (today) | 731 | 9,503 s | 197 | 930 | 61 |
| 5 min | 731 | 9,503 s | 197 | 930 | 61 (no effect: the next run is exactly 5 minutes later) |
| 10 min | 576 (-21%) | 7,488 s | 144 | 1,025 | 51 |
| **15 min** | **384 (-47%)** | **4,992 s (-47%)** | **96 (-51%)** | **1,025 (+10%)** | **51** |
| 30 min | 192 (-74%) | 2,496 s | 48 | 975 | 51 |

Healthy days are byte-identical in counts (902 requests, same outputs) with every cooldown: the change cannot fire unless a run failed with a 5xx/timeout. Useful work is **not** delayed in the burst replay (more summaries, slightly better p90) because the failed attempts no longer use the hourly pace; the price is that after an outage ends, the first AI request waits up to N minutes (mean N/2). A real 503 is often intermittent; the replay's all-day outage is the worst case.

## 6. Failed or duplicate requests repeated across runs (M)

- 503 / timeout: repeated every run (no cooldown), 3-4 requests a run (section 5).
- Always-rejected answers: repeated every run (section 4, point 6).
- A strong-model 429 that is not recognised as a **daily** one (the text must match `per day|PerDay|daily` within the first 700 characters) is retried on every call all day (the saved state: 134 ms instant failures, 2 counted attempts per call). Not time lost (0.2 s) but counter and pace.
- `altOff` is set by one 400/404 of the backup model and **never cleared** (kept in the state; M by test, and `true` in the saved production state). A 400 that is really a reasoning-parameter reject also sets it, so the backup could have been disabled by a transient or parameter problem (A: not verifiable offline, the original error is not stored).
- No duplicate request for cached results was found: a story with a current result is never asked again.

## 7. Where the free allowance could do more (A unless noted)

1. The real limit is Google's per model/minute/day, not the 400 counter (M, 22:45 429 at 271): the first thing to know is **which quota** (`quotaMetric` / `quotaId` in the 429 body). It is cut off in every stored string.
2. Cards take 68% of the tokens and 44% of the requests (277 of 635) on Oct 19 (M) for verdicts and headlines of every foreign story; the strong model's summaries (the most editorial work) get 5 stories per attempt and lose half of their attempts to instant failures when the strong model is out of quota (M).
3. The headline path is nearly redundant with cards (it only serves stories without a card).
These need the real 429 text and per-operation counters before any reallocation; none is proposed yet.

## 8. Recommendation: the first improvement

**A bounded 15-minute cooldown after an all-models 5xx/timeout run, for the summary path and the card path** (the 429 cooldown already works this way; the change is two lines at the two existing `catch` sites). Not the models, prompts, caps or outputs.

- Benefit (M requests, A latency): in an all-day outage, requests 731 → 384 (-47%), failed attempts that cost 13 s each: about -26 s per run on average in production terms (2 of 3 runs skip the 39 s AI stage), publication 39 s earlier on skipped runs, and the cap/pace are no longer eaten by failures. In bursts: -51% failed requests, +10% summaries, p90 time to summary not worse. No effect on healthy runs.
- Risk: AI text and cards resume up to 15 minutes (mean ~7) after Gemini recovers; during an outage nothing is produced anyway. The cooldown is set only when the summary call itself threw a 5xx/timeout after trying every model; the first success after it clears the error as today. Editor-facing output, Telegram, ranking, clustering, CAP_G1 untouched.
- To confirm before building: read the real 503 failure time from an Actions log (does a failing request really take ~13 s?).

Ranked next steps (not proposed for now): (2) publish the card counter and per-operation ok/fail counts and the 429 `quotaId` (diagnostics only, no behaviour change); (3) expire `altOff` and remember "strong 429 this hour" to stop doomed attempts (saves counter and pace, not time); (4) after two rejected answers, wait 6 hours for that story (the rule `AI_RICH_SUMMARIES` already has); (5) do not clear `error` during a cooldown.

## 9. Files
`scripts/gemini-audit.mjs` (saved-state accounting, replay of the real `aiSummaries()` against a stub, cooldown sweep on a temporary copy of `ai.js`), `test/gemini-accounting.test.js` (8 tests that pin today's counter, retry, cooldown, `altOff`, no-request and rejected-answer behaviour; full suite 338 pass), `docs/gemini-audit.json`, this file. `node scripts/gemini-audit.mjs --state <state.json> --json docs/gemini-audit.json` (about 2 minutes, offline).
