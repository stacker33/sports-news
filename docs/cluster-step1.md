# Grouping, Step 1: stop wrong merges and mixed-topic blobs

Status: implemented and committed locally on 12 November 2026. **Not pushed, not deployed.**
Only one production file changed: `src/cluster.js`.

Step 1 does two things:

1. It applies the clustering rules a Sport5 editor approved to the evaluation set.
2. It changes the word grouping so that unrelated news stops piling into one story.

Steps 2 to 6 (Hebrew-led merges, the match schedule, event types, summaries) are not part of it.

## The editorial rules

Approved by a Sport5 editor on 12 November 2026.

**A. Matches.** The same match is not the same story. A match has three phases, and each is its own story:

| Phase | What it covers |
|---|---|
| `pre_match` | Previews, expected and confirmed line-ups, squads, pre-match press conferences |
| `live_match` | Live coverage, the running score, goals and cards during the game |
| `post_match` | The result, match reports, reactions and analysis after the game |

- Same match, same phase, same thing: one story.
- Same match, different phases: separate stories, never merged automatically.
- A match report and a separate disciplinary, transfer or injury story: separate, even if they come from that match.
- Two different matches of one team: separate.
- Same match and phase but clearly different events (two different coaches' press conferences): may stay separate.

**B. Follow-ups.**

- Several outlets on the same event: one story.
- More facts about the same ongoing event (new contract details, the diagnosis of an injury): the same story.
- A significant new event (the signing after the talks, a reaction to a quote, a return from injury weeks later):
  a separate, related story.
- Shared players, clubs or subjects alone are never a reason to merge.
- When unsure, keep stories separate.

## How the labels were updated

The first labels of Step 0 are kept in `label` and were not changed. A new field, `policy`, holds the label under
the rules above: `same`, `different`, or `review` (the headlines are not enough to decide).

Each of the 53 `same-match` pairs and the 40 `related` pairs was read again and classified on its own.

| First label (Step 0) | Pairs | → same | → different | → review |
|---|---|---|---|---|
| `same` | 57 | 55 | 0 | 2 |
| `different` | 114 | 0 | 114 | 0 |
| `same-match` | 53 | 2 | 38 | 13 |
| `related` | 40 | 2 | 28 | 10 |
| **Total** | **264** | **59** | **180** | **25** |

- The 2 `same-match` pairs that became `same` are two live blogs of one match, and two live updates of one game.
- The 38 that became `different` are two phases of one match (32), or one phase with clearly different events (6).
- The 13 for review are mostly a result report against a post-match quote or analysis: does a reaction belong
  in the report's story? The rules do not say, so a person must.
- The 2 `related` pairs that became `same` are an injury followed by its diagnosis (the editor's own example).
- 2 pairs first labelled `same` moved to review: "agreed with Red Star" in the morning and "signed" in the
  afternoon may be the talks and the completed signing, which the rules keep apart.

Also recorded per pair: `relation` (`same-match` or `follow-up`, so related stories can be linked later),
`phaseA` / `phaseB`, and `policyNote` (why).

**Who confirmed what.** The rules are editor-approved. Applying them to each pair was done by the assistant from
the headlines. **No pair has been confirmed by an editor (0 of 264).** The 25 `review` pairs are never counted
as right or wrong; they are reported on their own. The sheet for an editor is `docs/cluster-eval-review.csv`:
the 25 pairs that need a decision come first, then the 70 whose label the rules changed.

7 invented pairs were added to `synthetic.json` for the phase rules (two previews, two results, preview against
result, live against result, a match report against club news, two matches of one team).

## What changed in the code

`src/cluster.js`, about 60 lines. No other production file. No new service, no language-model call, no prompt
change, no change to what is collected or to the card format.

**1. The 20 hours count from a story's first article.**
Before, a story took any article published within 20 hours of its *newest* article, so every new article moved
the limit and a story could grow for the whole 48 hours the radar remembers. Now the limit is 20 hours from its
*first* article. The duration itself was tested, not assumed (see below).

**2. The phase of a match is read from the headline.**
A new function, `matchPhase`, reads the headline's English text (the original or the radar's free translation)
and returns `pre_match`, `live_match`, `post_match` or nothing. It looks for plain markers: "preview",
"line-ups", "where to watch"; "live", "half-time"; "beat", "highlights", a score like 3-1. A time (19:00) or a
date is not a score. A TV listing that says "live" is pre-match. A headline that does not say stays unknown.

**3. Two phases of one match never share a story.**
An article that names a match and has a known phase cannot join a story of another known phase.

**4. Club news does not join a match story on club names.**
A "match story" is one where most of its first articles name a match. An article that names no match can join
it only if it is a near copy of one of its first headlines (4 or more shared words, 70% of the shorter one), or
if it is clearly from the same phase and similar (a result report that tags only one of the two teams). The same
holds the other way round: a match article does not join a club-news story.

**5. The automatic "one story per match" join is now "one story per match phase".**
Groups about the same match are joined only when they are in the same known phase. Before, the preview, the
live coverage and the result were joined on purpose, and the join window slid forward too.

**Not stored anywhere.** The phase is computed during grouping and is not saved on articles or stories, so the
radar's memory and the site's data keep their format.

### The match relationship (rule A3)

The data model already carries it: an article that names a match has the two team tags, and the grouping code
turns them into one key (`fixtureOf`, for example `t131+t138`). Stories about the same match therefore share the
same two team tags and can be linked by them today. What is missing is an explicit field. The smallest
compatible addition, for a later step, is two optional fields on a story: `match` (that key) and `phase`.
Nothing was added now, to keep the card format unchanged. A match whose teams the radar does not both recognise
has no key; that is Step 3 (the match schedule).

## Before and after

Same data, same labels, the grouping before Step 1 (a frozen copy in
`test/fixtures/cluster-eval/before-step1/`) against the grouping now. Reproduce with:

```bash
node scripts/eval-clusters.mjs --compare
```

The full pair-by-pair output is in `docs/cluster-step1-compare.md`.

### Hard cases (the 264-pair set, 7,441 articles)

These are hard cases picked where the radar was most likely to be wrong. They are not a sample of the site.

| Measure | Before | After |
|---|---|---|
| Precision (of scored pairs the radar joined, the share that belong together) | 34.4% | **66.7%** |
| Recall (of pairs that belong together, the share the radar joined) | 55.9% | 50.8% |
| False merges, of 180 `different` pairs | 63 | **15** |
| Missed merges, of 59 `same` pairs | 26 | 29 |
| Correct merges | 33 | 30 |
| Two phases of one match in one story, of 32 | 16 | **2** |
| Separate follow-ups joined to the first story, of 28 | 10 | 3 |
| `review` pairs in one story, of 25 (not scored) | 8 | 4 |
| Synthetic: false merges, of 12 | 4 | 1 |
| Synthetic: missed merges, of 12 | 0 | 0 |

The Step 0 report gave 49.2% precision and 33 false merges. Those were under the first labels, where the 53
same-match pairs were not scored. They still reproduce exactly (`baseline-step0.json`). Under the approved
rules the same old code scores 34.4% and 63, because merging two phases of a match now counts as a mistake.

### Story sizes and drift

| Measure | Before | After |
|---|---|---|
| Stories from the 7,441 articles | 349 | 1,091 |
| Biggest story, articles | 721 | 249 |
| Stories over 100 articles | 15 | 14 |
| Stories spanning over 24 hours | 43 | 28 |
| Word groups that kept growing for over 20 hours | 55 | 33 |
| Longest word group, hours | 48 | 35 |

What the biggest stories are now: the pre-match coverage of Real Madrid–Sevilla (249 articles), the
Svitolina–Monfils divorce (225), the live coverage of Groningen–Ajax (198). Before, the biggest was 721 articles
mixing that match, Mourinho's possible replacement, a Neymar quote and a disciplinary ruling.

A match-phase story can still run past 20 hours: two same-phase groups of one match are joined when the second
starts within 20 hours of the first. A stricter version (the whole group inside 20 hours) was tested and
rejected: it lost 3 more correct merges, fixed no extra false merge, and doubled the story-id changes.

### The window duration

Tested with the limit counted from the first article, everything else as shipped in the first experiment round
(no match rules yet):

| Hours | False merges | Correct merges |
|---|---|---|
| 12 | 38 | 29 |
| 20 | 47 | 31 |
| 24 | 48 | 32 |
| 36 | 59 | 33 |
| 20, counted from the newest article (the old rule) | 63 | 33 |

With the match rules on, 20 hours gives 15 false merges and 30 correct merges; 24 hours gives 16 and 30;
16 hours gives about 11 and 27. 20 hours was kept: it is the existing value, and neither neighbour is better on both
counts.

### What each rule contributes

| Change | False merges | Correct merges |
|---|---|---|
| Nothing (before) | 63 | 33 |
| Window from the first article only | 47 | 31 |
| + no automatic match join at all | 22 | 26 |
| + club-news guard (near copy only) | 15 | 26 |
| + same-phase join and same-phase exception (as shipped) | **15** | **30** |

## Regressions

### Fixed: 49 false merges on the set

Examples:

- A table tennis championship in Brazil with Sarina Wiegman's new contract.
- Juventus–Lazio line-ups with a cycling stage.
- Ajax's match with Jong Ajax's match.
- A Beşiktaş under-19 result with the first team's squad news.
- The Real Madrid–Sevilla result with the confirmed line-up, and 13 more preview / live / result mixes.

### Lost: 3 correct merges

| Pair | What | Why |
|---|---|---|
| r065 | Two live blogs that each cover several Premier League matches | They name four or more teams, so no single match is recognised, and their wording differs. The old blob held them together. |
| r088 | Two Greek reports of Como's 3-1 win at Fiorentina | One tags only Como. The headlines share 4 words of 9, under the similarity bar. |
| r291 | Wanda Nara sells Icardi's shirt: a Spanish report, and a Greek one 33 hours later | Outside the 20 hours. |

### New: 1 false merge on the small set, none on the full memory

Pair r289 (a Griezmann goal clip, and a team-mate's quote 15 hours later) is in one story after the change and
was apart before, **on the 7,441-article set**. It is joined by the language-model card merge (`src/merge.js`),
which Step 1 does not change: the word grouping now hands it different groups. On the full memory of that day
(47,708 articles) this pair was already in one story before Step 1, and the change adds **no** new false merge
there.

### Still wrong: 15 false merges

- 10 are unrelated stories that share ordinary words: a boat accident and a car on a pitch ("dead"), a German
  veterans' team and a climbing gold ("World Cup"), two national-team coach searches. This is the word
  similarity itself, not one of Step 1's two targets.
- 2 are two phases of one match whose headline does not say the phase ("Ajax makes mincemeat of Groningen").
- 3 are follow-ups joined on wording (a league statement and a reaction to it).

13 of the 15 are joined by the word grouping and 2 by the card merge.

## Operational safety

Measured two ways: on the set over time, and as a one-time switch on the full memory with the radar's real
story ids and its real list of Telegram posts from that day.

### Day to day (the set, 12 steps of 3 hours)

| Measure | Before | After |
|---|---|---|
| Articles that changed story id between steps | 1.6% | 1.7% |
| Stories that lost their id (a vote or "I'm on it" would lose its story) | 71 | 49 |
| Stories that look new again (new id, mostly old articles) | 12 | 41 |
| Of them, young enough for Telegram (first article under 3 hours old) | 0 | 2 |

Fewer stories lose their id. More stories look new again, mostly old ones: when a story's first article passes
the 48 hours the radar remembers, the 20 hours are counted from its next article and the group can change.

### The switch itself (full memory, real ids)

The whole memory of 20 October (47,708 articles) was grouped once with the old code and once with the new one,
starting from the story ids the radar really had. The old code is the control: it is not zero, because the
radar's code on 20 October was older than both.

| Measure | Old code (control) | New code |
|---|---|---|
| Articles that change story id | 15.8% | 24.0% |
| Stories of 2+ articles whose id disappears | 408 | 168 |
| Stories with a new id made mostly of articles the radar had | 274 | 2,066 |
| Of them, with 2 or more articles | 96 | 750 |
| Of them, with a first article under 3 hours old | 10 | 122 |
| Stories already posted to Telegram that keep their id (of 170 still in the data) | 156 | 165 |
| New-id stories that contain an article of a posted story | 3 | 42 |
| Of them, under 3 hours old (could be posted again) | 0 | 7 |

On the full memory the pair results match the set: false merges 65 → 17, correct merges 34 → 31, no new false
merge, the same 3 correct merges lost. Stories 18,107 → 20,283 (+12%). Biggest story 721 → 268 articles.
Word groups that grew for over 20 hours: 575 → 52.

What this means:

- **The switch is a one-time reshuffle.** About 750 multi-article stories get a new id on the first run after a
  deploy, because blobs split. After that, day-to-day changes are as in the table above.

- **Votes, "I'm on it", "seen".** These are stored by story id. When a story splits, the bigger part keeps the
  id and the rest get new ids. So a mark stays with the biggest part of what was a blob.
- **"New since your visit".** On the day of the switch, the stories that split off get new ids and can show as
  new to an editor who had already seen the blob. This happens once.
- **Telegram.** The channel remembers posts by story id, and also checks every candidate against what it posted
  in the last 12 hours (same clubs / players and headline words, `src/telegram.js`). A split-off story has a new
  id, so only that second check stands between it and a repeated post. The numbers above are an upper bound: a
  story must also be in the main top 10 and under 3 hours old to be posted.
- **Nothing is reset.** No story id, vote or memory file was edited. The ids change only through the normal
  grouping on the next run after a deploy.

### Run time

Measured on the full memory of 20 October (47,708 articles), this machine, two runs each:

| Stage | Before | After |
|---|---|---|
| Word grouping (`src/cluster.js`, the changed code) | 6.1–6.3 s | 5.9 s |
| Card merge (`src/merge.js`, unchanged code) | 25 s | 28–35 s |
| Both | 31 s | 34–41 s |

The changed code is slightly faster. The card merge is slower by 3 to 10 seconds because it now gets more
groups to compare (20,932 instead of 18,630). A whole collection run takes about 2.5 minutes, the job is
stopped at 8 minutes, and the admin is warned at 6, so there is room. The radar's memory today is smaller
(about 37,000 articles), so the real added time should be at the low end. This is an estimate from old data,
not a measurement of a live run.

## Limits

- **Labels.** 0 of 264 confirmed by an editor. 25 pairs wait for a decision.
- **The data** is from 20 October, before several junk filters; today's site has smaller blobs, so the gain on
  the live site will be smaller than on this set, and so will the reshuffle on the day of the switch.
- **The phase** is read from words in the headline. A headline that does not say it ("Ajax makes mincemeat of
  Groningen") has no phase, and such articles can still mix. Reading kick-off times from the match schedule
  would fix that; it is Step 3.
- **More stories.** Splitting blobs means more cards: 349 → 1,091 on the set, +12% on the full memory. Some of
  the new cards are duplicates the blob used to hide (two reports of one result with different wording).
  Merging those is the job of Steps 2 to 4.

## Next step

The smallest safe follow-up is not code: an editor reviews the 25 `review` pairs and spot-checks the 70 pairs
whose label the rules changed (`docs/cluster-eval-review.csv`). The biggest open question is whether a
post-match quote or analysis belongs in the result's story (6 of the 25).

After that, Step 2 as planned: let stories led by a Hebrew article take part in the card merge, strict rule
only. It targets the 7 missed Hebrew-against-foreign pairs and touches `src/merge.js` only.
