# Grouping evaluation: the baseline

> **History.** This is the Step 0 report, kept as written. Since Step 1 (`docs/cluster-step1.md`) every pair
> also has a `policy` label under the rules a Sport5 editor approved, the scores use it, and the gate file
> `baseline.json` holds the numbers after Step 1. The numbers below are in `baseline-step0.json` and still
> reproduce from the first labels.
> Since 13 November 2026 95 pairs carry an editor's decision (`editorDecision`, `editor-decisions.json`); the other 169
> are the assistant's labels and stay marked unverified. See `docs/cluster-step1-final.md`.

Step 0 of the grouping plan. This measures how the radar groups articles into stories **today**, before any
change, so that every later change can be judged on the same data.

Nothing here touches the live radar. The evaluation reads saved articles from the repository, runs the radar's
own grouping code on them, and compares the result with hand labels. It uses no network and no language model.

## How to run it

```bash
node scripts/eval-clusters.mjs
```

```bash
node scripts/eval-clusters.mjs --misses
```

```bash
npm test
```

The first prints the numbers and says whether they are worse than the saved baseline. The second also lists
every wrong pair with both headlines. The test suite fails if a change adds a false merge or loses a correct one.

## What is in the set

All files are in `test/fixtures/cluster-eval/`.

| File | What it holds |
|---|---|
| `corpus.json.gz` | 7,441 real articles from the radar's memory saved on 20 October 2026, and the 1,017 story cards the language model had written by then. Headlines, outlets and times only. |
| `pairs.json` | 264 labelled pairs of those articles. |
| `synthetic.json` | 17 invented pairs (21 invented articles) for situations the real data did not have. Scored apart. |
| `baseline.json` | The numbers below, as the code produced them when the set was made. |

`docs/cluster-eval-review.csv` is the same 264 pairs as a sheet for an editor, with an empty column to confirm
or correct each label.

### A pair

```json
{ "id": "r118", "a": "<article id>", "b": "<article id>", "label": "same", "group": "same-subject",
  "note": "the same Mourinho answer about Arda Guler", "by": "assistant", "editor": null }
```

### Labels

| Label | Meaning | Pairs |
|---|---|---|
| `same` | Both articles report the same happening. They belong in one story. | 57 |
| `different` | Different happenings, even about the same player or club. They must not share a story. | 114 |
| `same-match` | The same match, another phase or angle: preview, live, result, a post-match quote. | 53 |
| `related` | A follow-up of the same affair (a rumour, then the signing). Not scored. | 40 |

### Groups (how each pair was picked)

| Group | Picked from | Pairs |
|---|---|---|
| `multilingual` | Two languages inside one story of the radar | 42 |
| `big-cluster` | Two articles inside one of the 14 biggest stories | 45 |
| `late-source` | The first and the last article of a story that kept getting sources for 6+ hours | 20 |
| `same-subject` | Two stories the language model gave the same subject, kept apart | 53 |
| `hebrew-vs-foreign` | A Hebrew-led story and a foreign one that share a club or player and wording | 41 |
| `same-player` | Two separate stories about one player | 30 |
| `transfer` | Two separate stories about a move or contract of one player | 33 |

### Who decided the labels

- **`by: "assistant"`** (all 264 real pairs): Claude read both headlines, foreign ones in the radar's machine
  translation, and decided. It did not open the articles.
- **`by: "synthetic"`** (17 pairs): invented headlines. They show how the code treats a described situation,
  not how often it happens.
- **`editor`**: `null` on every pair. **No label has been confirmed by a Sport5 editor yet.** The numbers are a
  careful first reading, not ground truth.

29 candidates were dropped as unclear or junk. Nothing was labelled by a rule without being read.

## Baseline numbers

Measured on the code as it was on 12 November 2026 (commit `00a09d8`).

### Real pairs

| Measure | Result |
|---|---|
| Precision: of the labelled pairs the radar joined, the share that belong together | **49.2%** (32 of 65) |
| Recall: of the pairs that belong together, the share the radar joined | **56.1%** (32 of 57) |
| False merges: `different` pairs in one story | **33 of 114** |
| Missed merges: `same` pairs in separate stories | **25 of 57** |
| Correct merges made by the word grouping | 30 |
| Correct merges made by the language-model card merge | 2 |
| `same-match` pairs in one story | 28 of 53 |
| `related` pairs in one story | 11 of 40 |
| If a match counts as one story: precision / recall | 64.5% / 54.5% |

### Where it goes wrong

- **Pairs the radar had joined** (`multilingual`, `big-cluster`, `late-source`): 32 belong together, 33 do not.
  Examples of the 33: a table tennis championship with Sarina Wiegman's contract; a boat accident with a car
  on a football pitch; Juventus–Lazio line-ups with a cycling stage; Ajax's match with Jong Ajax's match.
- **Pairs the radar had kept apart** (the other four groups): 24 of 105 scored pairs belong together.
  9 of them are a Hebrew article and its foreign report (Semenyo's injury, the Manchester City punishment
  report, Koloko signing for Red Star). 7 are the same contract or transfer news (Courtois, Kees Smit, Nmecha).
  2 are the same Mourinho answer about Arda Güler in Spanish, Bulgarian and Serbian.
  The 25th missed merge is a `multilingual` pair that the smaller data set splits (see below).

### Story sizes on this data

7,441 articles become 349 stories. The five biggest have 721, 563, 529, 440 and 417 articles.
15 stories have more than 100 articles, and 15 have more than 50 outlets.

### Story ids over time

The grouping was run again every 3 hours over the last 36 hours of the data, as the radar does every few
minutes, carrying the story ids over.

| Measure | Result |
|---|---|
| Articles that changed story id between two steps | 818 of 51,081 (1.6%) |
| Stories of 2+ articles that lost their id while most of their articles were still there | 71 |
| Stories with a new id made mostly of articles the radar already had | 12 |

The second line is what can orphan a vote, an "I'm on it" or a "seen" mark. The third is what can look new
again on the site. Telegram has its own same-event check, so the third line is a risk, not a count of repeated
posts.

### Synthetic pairs

0 false merges of 6, 0 missed merges of 10. The code handles the simple, clearly worded versions of these
situations. The real data is where it fails.

## How to read these numbers

- **The set is a probe of hard cases, not a random sample.** Pairs were picked where the radar was most likely
  to be wrong. 49% precision does not mean half the site is wrong. It means that on these hard cases the code is
  right about half the time.
- **The data is from 20 October**, before several junk filters. The live site today has smaller blobs. The
  set leaves out stream-spam headlines, as the radar does now, but other old junk (squad pages, betting pages)
  is still in it.
- **The smaller data set is not the full memory.** On the full memory of that day, 3 of the 264 pairs come out
  differently (precision 50.0%, recall 57.9%).
- **Use it to compare, not to grade.** The same data, the same labels, old code against new code.

## Open questions for an editor

1. **Is a match one story?** Today the code tries to keep the preview, the live updates and the result of one
   match in one story. 53 pairs depend on this rule. Until an editor decides, they are counted on their own.
2. **Is a follow-up the same story?** A rumour, then the signing. An injury, then the diagnosis. 40 pairs.
3. **The 264 labels** need a review. The sheet is `docs/cluster-eval-review.csv`.

## The rule for the next steps

A change to the grouping passes when, on this set:

- false merges do not go up (33 today), and
- correct merges do not go down (32 today).

A change that is meant to improve the grouping should also lower false merges or missed merges. After a
reviewed change, the new numbers are saved as the baseline with `--write-baseline`.
