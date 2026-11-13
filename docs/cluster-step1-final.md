# Grouping, Step 1: final validation and deployment plan

13 November 2026. Everything here is local: nothing was pushed, deployed, or written to live data. All tests and
replays use saved files and read-only copies.

**Recommendation: READY.** The first version of this report was CONDITIONAL on one thing: the Griezmann patch. The editor approved it and it is applied
(commit `ee2f8b3`), with two regression tests (13 November, later the same day). The figures below include the patch. The plan is in section 7.

## 1. The editor's decisions

A Sport5 editor approved all 95 pairs, every one matching the assistant's recommendation:

| Decision | Pairs | Meaning for the score |
|---|---|---|
| MERGE | 10 | one story |
| SEPARATE BUT RELATED | 83 | two stories, never merged automatically |
| SEPARATE | 2 | two stories |

**Source.** No separate export file was provided. The decisions were read from the review document the editor was
given (`docs/cluster-editor-review.html`, which holds every recommendation), and the editor reported that all 95
match it. They are stored in `test/fixtures/cluster-eval/editor-decisions.json`. There are no per-pair notes.

**How the labels were updated.**

- `label` (first reading) and `policy` (the assistant's reading under the approved rules) are untouched.
- Each of the 95 pairs gets `editorDecision` and `editorAt`, and `editor`: `confirmed` (decision equals the policy
  label, 69), `decided` (the pair was `review`, 25) or `corrected` (decision differs, 1).
- The one correction is r153: the radar's data says two articles on Arnautović's miss are separate, the editor says
  MERGE. (The first translation had read "disgraced himself" as "got dressed".)
- Both separate kinds count as "must not merge". Related stories are not merged. A new line in the report counts
  how many "separate but related" pairs end up in one story.
- The other 169 pairs have no editor decision. They keep the assistant's labels and are reported as **unverified**
  everywhere (`UNREVIEWED` in the report, `UNVERIFIED` in the sheet).
- No new clustering rule was added to improve these numbers.

The review sheet `docs/cluster-eval-review.csv` now lists the 95 decided pairs first, then the 169 unverified ones,
with a column an editor can use to confirm or correct those.

## 2. Exact results

The frozen grouping from before Step 1 against the current code, on the same data, under the editor's decisions.
Reproduce with `node scripts/eval-clusters.mjs --compare` (the pair-by-pair output is in
`docs/cluster-step1-compare.md`). These are hard cases picked where the radar is most likely to be wrong, not
whole-site rates.

### All 264 real pairs (65 must merge, 199 must not)

| Measure | Before | After |
|---|---|---|
| Precision | 31.7% | 62.5% |
| Recall | 50.8% | 46.2% |
| False merges | 71 of 199 | **18** |
| Missed merges | 32 of 65 | 35 |
| Correct merges | 33 | 30 |
| "Separate but related" pairs in one story | 38 of 83 | 8 |
| Two phases of one match in one story | 16 of 32 | 2 |

### Editor-approved pairs (95: 10 must merge, 85 must not)

| Measure | Before | After |
|---|---|---|
| False merges | 38 of 85 | **8** |
| Correct merges | 1 of 10 | **0 of 10** |
| Precision / recall | 2.6% / 10% | 0% / 0% |

This is the weak spot, and it is not hidden: the radar joins **none** of the 10 pairs the editor said must merge.
Step 1 lost one of them (r065, two live blogs of one match). The other 9 were never joined by either version; they
are the same event in different wording (Stankovic, Pedri's two remarks, Zoma's injury and its diagnosis, Alisson Santos's
injury and the club statement, Leko, Peretz), which is the job of Steps 2 to 4, not Step 1.

### Unreviewed pairs (169: 55 must merge, 114 must not), assistant labels, unverified

| Measure | Before | After |
|---|---|---|
| False merges | 33 of 114 | 10 |
| Correct merges | 32 of 55 | 30 |
| Precision / recall | 49.2% / 58.2% | 75.0% / 54.5% |

### Invented pairs (24: 12 must merge, 12 must not)

False merges 4 → 1, missed merges 0 → 0. Scored apart; they show how the code treats a described situation, not how
often it happens.

### The 18 false merges that remain

Eight are editor-approved "separate but related" pairs (a ninth, r289, the Griezmann clip and quote, was fixed by the patch of section 4):

| Pair | What |
|---|---|
| r004 | fitness tests for three players, then the squad list |
| r010 | the NFL's statement, then a reaction to it |
| r019 | broadcast of the track cycling championships, then the medal table |
| r028 | two match pages whose headlines do not show the phase |
| r043 | result vs. preview of Once Caldas–Medellín |
| r051 | Spalletti's reply to Bremer vs. the Juventus–Lazio result |
| r086 | Ajax–Groningen result vs. the live blog |
| r292 | analysis of Botafogo's win vs. a player's comment on it |

Ten are unreviewed pairs, mostly unrelated stories that share ordinary words (a boat accident and a car on a pitch,
two national-team coach searches, two salary rankings).

## 3. Deployment safety: the story-ID transition

The earlier replay said about 750 multi-article stories would get new IDs. That is true, but what it costs editors
depends on what is stored under a story ID. I checked each kind of state.

| State | Where it lives | Keyed by | Effect of an ID change |
|---|---|---|---|
| "I'm on it" | editors' browsers and the notification topic | story ID **and** the story's article links (`claimFor`, `public/app.js`) | **Survives.** A claim also matches any story sharing one of its links. |
| Category corrections | editors' browsers | story ID **and** links (`fixFor`) | **Survives**, same reason. |
| 👍 / 👎 votes | server file `data/votes.json`, and each editor's own highlight | story ID | The vote record keeps its own title and link, so the labelled set is not lost. The count shown on a split-off card, and a person's highlighted thumb, restart. **15 votes exist today and none is on a story that is still visible**, so there is nothing to lose now. |
| "New since your visit" | editors' browsers | story ID, but only for stories whose first article is newer than the last visit | A split-off part holds old articles, so it is not flagged new. A "+N sources" badge needs a story to grow, which a split does not cause. |
| Telegram history | server memory (`tg.sent`, `tg.recent`) | the story's earliest article, plus a 12-hour headline fingerprint check | A split-off story has a new key; only the fingerprint check stood between it and a repeated post. **Now covered by a quiet run** (below). |
| Story IDs | server memory (`storyIds`) | article → story | Unchanged in format. IDs are re-derived every run. |

How much changes. Every story that existed under the old grouping on 20 October, with 2+ articles and visible
(4,750 of them), checked after one run of the new grouping, with the radar's real IDs:

| What happened to the story's ID | Old grouping run again (control) | New grouping |
|---|---|---|
| Same ID, 80%+ of the story's articles still under it | 87.0% | 77.8% |
| Same ID, 50-80% of them | 2.7% | 11.0% |
| Same ID, but under 50% (it now points at a small part) | 2.5% | 7.9% |
| ID gone | 7.7% | 3.3% |

The control is not zero because the radar's code on 20 October was older than both versions. About 9 percentage
points more stories are affected by the new grouping: roughly 1 in 11.

**Minimal, reversible mechanism, implemented:** `src/telegram.js` has a new constant `GROUPING = 2`. The first run
after it changes posts nothing and marks what is on the page as sent, exactly as the radar already does when the
posting rule changes (`firstRun || switching`). One quiet run (about 5 minutes), then normal. A test covers it.
Cost: a story that first appears in that single run is not posted. Undo: set the constant back, or bump it again.

**What I did not build, and why.** A server field that carries "this story continues story X" plus frontend code to
inherit seen marks and votes. The measurements above show claims and corrections already survive, nothing is voted
on visible stories today, and the "new" badge is protected by the first-article time. It would add frontend code to
protect state that is not at risk. If editors later report lost thumbs after a split, this is the next step.

Nothing is reset or re-keyed. No production file was read except public site data (GET), and none was written.

## 4. The Griezmann pair (r289)

**Cause.** Not Step 1. The two articles are each alone in their word group. The AI-card merge in `src/merge.js` then
joins them: same player tag, the same subject ("Antoine Griezmann"), and two shared words that are only the
player's name. On the full 47,708-article memory this pair was already joined before Step 1. Step 1 changes the
word groups the card merge sees, which exposes it on the hard-case set.

**A broad rule is not safe.** "A quote headline and a non-quote headline are separate events" would fix it but
splits six merged stories on the set, and four of the six look like true merges on their headlines (Haaland and the mate
drink, Kees Smit's contract, two Arteta quotes, Koloko's signing). Rejected.

**Narrow rule, tested.** A goal / video clip ("Goal: ...", "VIDEO ...", "Watch ...") against a quote with a named
speaker ("Ojeda: “...”"), unless they share a score or a number. It lives in `src/merge.js`, outside Step 1, so it was
proposed as a patch file, `docs/proposed-merge-clip-vs-quote.patch` (two regular expressions and one condition), and
applied only after the editor approved it (commit `ee2f8b3`).

| With the patch applied | Result |
|---|---|
| Tests | all pass (213 with the two regression tests below) |
| Hard-case set | false merges 19 → 18; correct merges 30 → 30; one story changes (the Griezmann one) |
| Full memory (47,708 articles) | exactly one merged story changes (the 13-article Griezmann story); no other labelled pair or story changes; no story is newly joined |
| Editor-approved false merges | 9 → 8 |

**Regression tests.** `test/merge.test.js` checks the rule on the real Griezmann headlines (the clip and the quote stay apart in either order, the clip and a
plain report of the same goal still join, and the whole merge step agrees). `test/cluster-eval.test.js` checks r289 through the whole pipeline on the
saved data. Without the patch three tests fail (these two and the baseline gate); with it all pass.

## 5. Final validation

The whole saved memory of 20 October (47,708 articles, 20,932 word groups) was grouped by the old code and by the
current code, with the editor's labels and the radar's real story IDs and Telegram history. Read-only.

| Check | Result |
|---|---|
| **Clustering accuracy** (264 pairs, full memory) | precision 31.8% → 59.6%; recall 52.3% → 47.7%; false merges 73 → 20 (of 199); missed merges 31 → 34; correct merges 34 → 31. 53 false merges fixed, **no new false merge**, the same 3 correct merges lost (r065, r088, r291) as on the set. The full-memory run was made before the patch (73 → 21, precision 59.6%); the pair-by-pair comparison then showed r289 as the only labelled pair the patch changes, so the figures here follow from it. |
| **Cluster drift** | biggest story 721 → 268 articles; stories over 100 articles 35 → 20; word groups that grew past 20 hours 575 → 52; stories spanning over 24 hours 446 → 58. |
| **Story IDs** | day to day (12 steps of 3 hours, the set): articles changing ID 1.6% → 1.7%; stories losing their ID 71 → 49. The one-time switch: 24.0% of articles change ID (old code run again: 15.8%); 168 stories of 2+ articles lose their ID (control 408); 750 multi-article stories get a new ID (control 96). |
| **Editorial state** | claims and category corrections match by article links and survive; no vote exists on a visible story; the "new" badge needs a newer first article (section 3). Nothing was reset or re-keyed. |
| **Duplicate Telegram posts** | 170 stories the channel had posted are still in the data: 165 keep their ID. 42 new-ID stories contain an article of a posted story, 7 of them under 3 hours old. Those 7 were the posting risk; the quiet first run (section 3) now marks everything on the page as sent, so none of them can post. Residual risk: a split-off story that enters the top 10 only in a later run, which the 12-hour headline check still covers. |
| **Run time** (full memory, this machine, two runs) | word grouping 8.3-8.8 s → 7.1-7.7 s; card merge 33.5-33.9 s → 38.8-41.5 s; both 41.8-42.7 s → 46.5-48.6 s. About 5-7 s more. A whole run takes about 2.5 minutes and the job is stopped at 8, so there is room. The live memory is smaller than this one. The added time comes from the card merge getting 12% more groups. Measured before the Griezmann patch, which adds two small regular-expression tests per group and was not timed separately. |
| **Backward compatibility** | the radar's code changed in three files only: `src/cluster.js` (Step 1), `src/telegram.js` (the quiet run) and `src/merge.js` (the Griezmann rule). Nothing new is stored on articles or stories; the only new saved field is `grouping` in the Telegram state (older code ignores it). Card format, site data files and the frontend are unchanged. |
| **New paid services, new network calls, new dependencies** | none (checked in the diff). |
| **AI summaries** | untouched: `src/ai.js`, `src/summaries.js` and the prompts did not change, and no AI request was added. |
| **Tests** | 213 pass (203 before Step 0, plus the evaluation, phase, Telegram and Griezmann tests). |

## 6. Remaining known problems

- **0 of 10** editor MERGE pairs are joined by the radar. Step 1 lost one (r065). Steps 2 to 4 address the rest.
- 18 false merges remain. Ten are the word similarity itself and are outside Step 1.
- The radar shows more cards: about 12% more stories on the full memory. Previews, live coverage and results are now
  separate cards by design, and some same-event reports in different wording show as separate cards until
  Steps 2 to 4.
- The first run after deploy re-IDs roughly 1 in 5 visible stories (see section 3). A personal thumb highlight on a
  split story can restart.
- The 169 unreviewed pairs are the assistant's labels. The data is from 20 October, before several junk filters, so
  the live gain will be smaller than on this set.
- Phase detection reads English headline words. A headline that does not say the phase can still mix.

## 7. Deployment and rollback

**Before pushing**

1. The Griezmann patch is already in (commit `ee2f8b3`); there is nothing to decide first.
2. `npm test` and `node scripts/eval-clusters.mjs` both pass on the commit you push.

**Deploy.** This is the isolated deployment branch `step1-deploy` (worktree `C:\Users\avrah\sr-deploy`), built from `origin/main`
(`8e93271`) with five cherry-picked commits and nothing else: the evaluation set (`aa48894`), Step 1 (`95e516b`), the editor's
decisions with the Telegram guard (`8863a18`), the Griezmann patch (`ee2f8b3`) and the maintenance commit (regression tests, new
baseline). The athlete and official-site changes for Gal Raviv, Aviv Aronov, Miami and Eastern Michigan are not in it; they stay
on the original branch. One command pushes it:

```powershell
cd C:\Users\avrah\sr-deploy; git push origin HEAD:main
```

Best at a quiet hour for editors (the channel is silent 01:00 to 06:00 Israel time anyway). I would not deploy
during a big match evening.

**After the first runs (about 15 minutes)**

- `data/status.json`: the run time (`tookMs`) should stay under about 3 minutes and well under the 8-minute limit.
- The number of stories in `data/news.json` should rise by roughly 10%, not by multiples.
- The Telegram channel should post nothing in the first run, then posts as usual. A burst of posts means stop and roll back.
- No self-check alert to the admin about a slow run or a quiet channel in the next hours.
- Ask one editor whether "I'm on it" marks and category fixes still show.

**Rollback.** The memory format is unchanged, so no data needs restoring. Nothing is rewritten: the rollback is new commits on
top of `main`, and it keeps the Telegram guard so the rollback run is quiet too (IDs change back once more, and the same
table of section 3 applies in reverse). The five deployment commits, newest first: the one titled "Step 1 maintenance"
(find it with `git log --format=%h --grep="Step 1 maintenance"`), `ee2f8b3`, `8863a18`, `95e516b`, `aa48894`.

```powershell
git fetch
git checkout -b rollback origin/main
git revert --no-commit <maintenance> ee2f8b3 8863a18 95e516b aa48894
git checkout <maintenance> -- src/telegram.js test/telegram-main.test.js test/selfcheck-events.test.js
```

Then set `GROUPING` in `src/telegram.js` from `2` to `3` (the tests follow the constant), commit, and push with
`git push origin HEAD:main`.

This was tested on a throwaway branch: the five reverts apply without conflict, `src/cluster.js` and `src/merge.js` are
back to their pre-deployment versions, the tree differs from the pre-deployment `main` only in the Telegram guard and its two
test files, and 204 tests pass (the 203 older ones plus the quiet-run test).

## 8. Files changed in this step

The five commits of the isolated deployment branch `step1-deploy` (section 7). Not pushed.

| File | Change |
|---|---|
| `src/telegram.js` | `GROUPING` constant; the first run after it changes posts nothing |
| `test/telegram-main.test.js`, `test/selfcheck-events.test.js` | the saved state they use carries `grouping: 2`; one new test |
| `scripts/eval-clusters.mjs` | scores by the editor's decision; editor-approved, unreviewed and "separate but related" reported apart; new review-sheet format |
| `src/merge.js` | the Griezmann rule: a goal / video clip and a later named quote do not merge (12 added lines, commit `ee2f8b3`) |
| `test/merge.test.js` | new: the rule on the real Griezmann headlines, with controls |
| `test/cluster-eval.test.js` | checks for the 95 decisions and what each means for the score; r289 through the whole pipeline |
| `test/fixtures/cluster-eval/pairs.json` | `editorDecision`, `editorAt`, `editor` on the 95 pairs; original labels kept |
| `test/fixtures/cluster-eval/editor-decisions.json` | new: the 95 decisions with their source |
| `test/fixtures/cluster-eval/baseline.json` | the gate: the current code (Step 1 plus the patch) under the editor's decisions: 18 false merges |
| `test/fixtures/cluster-eval/baseline-step0.json`, `baseline-step1-assistant-labels.json`, `baseline-step1-editor-labels.json` | history: Step 0; Step 1 under the assistant's labels; Step 1 under the editor's decisions before the patch |
| `docs/cluster-step1-final.md` | this report |
| `docs/proposed-merge-clip-vs-quote.patch` | the `src/merge.js` patch as proposed; applied in `ee2f8b3`, kept as a record |
| `docs/cluster-editor-review.html` | the Hebrew review page the editor used |
| `docs/cluster-eval-review.csv`, `docs/cluster-step1-compare.md` | regenerated |
| `docs/cluster-step1.md`, `docs/cluster-eval-baseline.md` | a note pointing to this report |
