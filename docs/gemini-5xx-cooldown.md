# Bounded pause for repeated Gemini 5xx / timeouts

Branch `gemini-5xx-cooldown`, from `origin/main` at `7c482a4` (plus the audit commit `8ac80e4` it builds on: `docs/gemini-audit.md`, `scripts/gemini-audit.mjs`, `test/gemini-accounting.test.js`). Labels: **(M)** measured, **(A)** assumption.

## 1. How much runtime is really spent waiting on failed 503 requests?

**It is not known, and the 13-second figure in the audit must not be used as a measurement.** I derived it by dividing the production AI stage (39,359 ms, 3 failing requests) by 3. That was wrong in principle: the `ai` mark of the `[timing]` line covers **everything between "rank" and "notify"**: the page fetches of `fillSummaries` (up to 8 in a row, 10 s timeout each, plus Google News decoding), the translation of summaries, the name preparation **and** `aiSummaries`. The line does not split them, so the 39.4 s cannot be attributed to the Gemini requests.

What exists, and what it shows (M):
- **No per-request timing is stored anywhere**: only the last strong call's `ms` in the private state, and `tookMs` of the whole run in the public `sources.json`.
- **Public Actions step times** of the 14 most recent runs (the "Collect" step): 83, 119, 83, 101, 57, 81, 98, 78, 76, 129, 135, 142, 111, 151 s (mean 103 s, standard deviation about 30 s). Which of them had an AI outage is not recorded. The run-to-run spread (57 to 151 s) is far larger than any 3 x 3 s to 3 x 30 s effect, so the totals cannot show it.
- **Live samples** (public `sources.json`, 22:40 to 22:55 UTC): runs of 100, 82 (two instant 429s), 118 and 83 s; the last two made no Gemini request at all (paused after a 429). The difference between 118 and 83 s with the same Gemini activity is the noise.
- The only latencies actually observed: a 429 answers in **134 ms** (saved state). A 503 failure time is bounded only by the code: at most 75 s (strong model timeout) or 90 s (default), at least ~0.1 s.

So the wasted wait is `failed requests avoided x L`, with L unknown. The tables below show it for **L = 3, 13 and 30 s (all assumptions)**. This change adds the measurement itself: collect.js now logs one line per run, `[ai] N requests (F failed) in X ms, failed ones Y ms · paused ...` (`src/collect.js`), so the first runs after deploy give the real L and the real AI time. It is a log line only: no published file and no state field is read from it.

## 2. One cooldown or one per path?

The three Gemini request paths fail differently: **cards** use only the light model; **summaries** go strong, then backup, then light (a failure is only recorded when the whole chain fails, i.e. the light model failed too); **headlines** use the light model. A card prompt (20 stories) and a summaries prompt differ in size and model, so one can fail while the other is fine (benchmark scenarios below). A shared pause would stop the healthy path: with cards alone failing, a shared pause would hold back the summaries and headlines for about two thirds of the day (arithmetic from the pause schedule, not simulated), against 0 lost with separate pauses (M: 1,305 summaries and 4,785 headlines are produced identically).

Decision: **one pause per path** (`cards`, `summaries`, `headlines`), kept in `state.ai.pause`. One deliberate link: **headlines are also held while summaries are paused**, because the headline request goes to the light model, the last link of the summaries chain: if that chain is paused, the light model has just failed, and without this link the headline path (which never ran during an outage, because the summaries call threw first) would send new failing requests: extra requests, which this change must not add.

## 3. The change (`src/ai.js`, `src/collect.js`)

- **Trigger:** a path that ends a run with a 5xx or a timeout (the call itself threw it after trying every model) counts one failing run. After **3 failing runs in a row** (`COOL_5XX_AFTER`) the path asks nothing for **15 minutes** (`COOL_5XX_MS`). 2 would also pause a path that is only flaky: at 30% failing requests it cost 19% of the cards, 3 costs 9% with the same outage savings (M, benchmark).
- **Not a trigger:** a failure that another model covers (strong 503, backup or light answers: the call succeeds, nothing is recorded); a 4xx (the check `HTTP 4xx` excludes 429, 400, 404 text that happens to contain "timeout"); failures older than 45 minutes do not count as "in a row" (nine runs ago).
- **Recovery, automatic:** the pause ends by time; the next run asks once (a probe). One success lifts the pause and clears the count; a failing probe pauses again at once (the count is kept), so an outage costs one probe per 15 minutes. Nothing needs to be reset by hand.
- **Persistence:** `state.ai.pause = { cards|summaries|headlines: { n, at, until } }`, saved with the rest of the AI state, so it holds across runs (tests save and load it as JSON between runs). A state without the field loads as before; older code ignores it (rollback-safe).
- **Unchanged:** 429 handling (`cooldownUntil`, `clsCooldown`, the daily-quota logic), the 400/day and 450/day caps, the 20/hour pace, models, prompts, order of fallbacks, retry behaviour, outputs. No new request: a pause only removes requests (M: requests never rise in any scenario).
- **Logging:** the `[ai]` line above (new `stats` returned by `aiSummaries`).

## 4. Benchmark (M for counts, outputs and delays; the seconds are L x requests, A)

24 hours of 5-minute runs of the real `aiSummaries()` (baseline = `origin/main`) on the stories of the saved state, Gemini stubbed (`scripts/gemini-cooldown-bench.mjs`, `docs/gemini-cooldown-bench.json`). "Top-100 coverage" and "p90" are the share of the 100 highest-scoring foreign stories that got a summary and the slowest 10% of them (minutes after arrival): the **publication latency of AI text**.

| Scenario | Requests | Failed requests | Summaries | Headlines | Cards | Top-100 covered | p90 min |
|---|---|---|---|---|---|---|---|
| healthy | 902 → 902 | 0 → 0 | 1,420 → 1,420 | 3,378 → 3,378 | 9,159 → 9,159 | 99 → 99 | 5 → 5 |
| strong model 503, light answers | 913 → 913 | 290 → 290 | same | same | same | 76 → 76 | 20 → 20 |
| **all models 503 all day** | 731 → **388** | 731 → **388 (-47%)** | 0 | 0 | 0 | 0 | - |
| **all models 503, 3 bursts of 2 h** | 875 → 812 | 197 → **113 (-43%)** | 930 → **1,005** | 3,065 → 3,499 | 7,342 → 7,182 | 87 → **99** | 61 → 60 |
| only the card path 503 | 724 → 534 | 287 → **97 (-66%)** | 1,305 → 1,305 | 4,785 → 4,785 | 0 | 84 → 84 | 5 → 5 |
| only summaries + headlines 503 | 917 → 764 | 444 → 291 (-34%) | 0 | 0 | 9,159 → **9,159** | - | - |
| intermittent, 15% of requests 503 | 886 → 886 | 134 → 134 | 1,225 → 1,265 | 2,930 → 2,819 | 7,609 → 7,545 | 89 → 89 | 5 → 5 |
| intermittent, 30% of requests 503 | 875 → 838 | 258 → 247 | 1,105 → 1,145 | 2,242 → 2,002 | 6,085 → 5,565 (-9%) | 87 → 86 | 10 → 7 |

- **Wasted requests:** none in healthy and in single-model outages; -43% to -66% in real outages of a path.
- **AI output:** unchanged where the pause does not act; in bursts it is **higher** (the failing attempts no longer use the hourly pace of 20 and the daily cap), and the top stories are covered more (87 → 99). The cost is the flaky regime: at 30% failing requests the cards fall 9% (a pause that starts on bad luck and hides requests that would have succeeded).
- **Publication latency of AI text:** unchanged or better (p90 61 → 60 min in bursts, 10 → 7 at 30%). Time added after an outage ends: the first probe waits at most 15 minutes (mean about 7).
- **Run time (assumed L):** a skipped run avoids up to 4 failing requests (1 card + 3 summary attempts): about 12 s at L = 3, 52 s at L = 13, 120 s at L = 30. Mean per run over a day of total outage: **3.6 s (L=3), 15.5 s (L=13), 35.7 s (L=30)**; bursts of 2 h three times: 0.9 / 3.8 / 8.8 s; card path only: 2 / 8.6 / 19.8 s. Since the `ai` stage precedes publishing, that time is also publication time of every story on the skipped runs.

## 5. Tests (`test/gemini-cooldown.test.js`, 10; `test/gemini-accounting.test.js`, 8 pinned behaviours still pass; full suite 348 pass)

Isolated failure covered by another model (no record); one and two failing runs (no pause, same requests again); total outage (3 runs pause every path 15 minutes, the next two runs make no request, a failing probe pauses again); recovery (healthy again: still paused until the end of the 15 minutes, then the first success lifts it and the summaries resume; a later single failure is isolated again); partial outage: card path failing / summaries chain failing, each pausing alone while the other path keeps working; 429 untouched (30-minute cooldowns, no 5xx pause entry); a failure two hours ago does not count; a state without the field; fewer requests than the unpaused code; consecutive runs with the state saved and loaded as JSON between them.

## 6. Deploy and roll back

Merge `gemini-5xx-cooldown` into `main` and push (the collector runs from `main`; no variable, secret or workflow change). The first run after the merge reads the existing state (no `pause` field). Check the Actions log: one `[ai] ...` line per run when Gemini was asked or a path is paused; `[ai] ... paused after repeated 5xx/timeouts: ...` only after 3 failing runs in a row; the `failed ones ... ms` figure is the first real measure of what a failing request costs. The dashboard, `sources.json` and the published files do not change.

Roll back: `git revert <merge commit>` and push. The extra `ai.pause` field in the saved state is ignored by the old code; nothing to clean.

## 7. Remaining uncertainty
- Real per-request 503 latency (the new log line will show it).
- The replay's outages are idealized (all-day, bursts); real 503s are often intermittent, where the pause rarely acts (15%: no change) and, at 30%, slightly reduces cards.
- A 5xx that is really a quota problem reported as 503, or a model that answers 503 only for large prompts, would pause the whole path for 15 minutes at a time.
- The dashboard still shows the AI as healthy during a pause (the existing behaviour during a 429 pause); not changed here.
