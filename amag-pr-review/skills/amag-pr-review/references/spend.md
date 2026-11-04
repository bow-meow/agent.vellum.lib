# Token spend: check, repair, note

Read from SKILL.md step 9, before `cleanup` (it needs `$W`). Every run, including dry runs and runs
that failed part-way. This step's own tokens aren't added to `usage.json`.

```bash
node $S/scripts/spend.mjs report $W   # → {level, total, typical, ratio, sample, thin, high, why, agents, source, notes}
```

`skipped` → nothing to judge; go on to cleanup. Otherwise print one line:
`Spend: ~<total>k vs ~<typical>k typical at <level> for this size (<ratio>×, <sample> runs) · <normal | high: why>`.
With `thin: true`, say "too few logged runs of this size to compare", and still read `agents` by hand
(their `typical` comes from every run at this level).

## 1. Judge the open repair notes first

Each entry in `notes` is a repair an earlier review made at this level, with its `targets` (usage keys),
`before` (that run's ratios) and `now` (this run's).

| `live` | Do |
|---|---|
| `true` | The installed skill has the repair, so this run measured it. Settle it (below). |
| `false` | Not installed yet. Terminal: "r<n> (<commit>) not in the installed plugin yet: publish and update it to measure". Leave it open. |
| `null` | A proposal with no commit, or no source checkout to check. Terminal: the note's `repair`, still open. |

Settling compares each target's ratio in `now` with `before`, not raw tokens (runs differ in size):

```bash
node $S/scripts/spend.mjs settle $W <id> <worked|no-effect|worse> "<one line: before → now ratios>"
```

`worked`: the targets' ratios came down to about typical (≤ 1.2) or fell by a third or more.
`no-effect`: within that noise. `worse`: a target rose, or the run missed findings the repair's area
used to catch. `worse` makes reverting that commit this run's repair (section 3, `git revert --no-commit`).
One run is a small sample. When the size band is thin or the change looks like ordinary noise, leave the
note open for another run rather than settle on it.

## 2. Diagnose, only when `high`

`why` names what crossed the line. Find the cause from `agents` (sorted by excess over typical) and
`$W`. Read only what you need to name the cause; the diagnosis must cost far less than it saves.

| Signal | Likely cause | Where the repair goes |
|---|---|---|
| `calls` > `expectedCalls` | coverage send-backs (agent skipped units) or a retry after a failure | the coverage wording in `references/prompts/reviewer.md`; chunk size in `dispatch.mjs` |
| one key far over typical, one call | its checklist sends it reading too widely | `references/dimensions/<key>.md`, or its scope in triage |
| large `promptKB` for a key | a slot pastes a whole file where a path would do | the slot in `dispatch.mjs` or the template |
| many agents, each near typical | the roster or chunking fits this size badly | `levels.mjs` or the roster rules in `dispatch.mjs` |
| `verify` far over typical | too many candidates, mostly dropped | the dropping reviewer's checklist, or `references/severity.md`'s don't-flag list |

Not a repair: a cost the user chose (`--level high`, a requested re-run), a one-off cause (a cross-repo
request, an agent that crashed once), or a diff that is simply large for its band. Say which in the
terminal and stop here.

## 3. Repair: one change per run

Make the smallest change to the skill that removes the cause. A repair cuts tokens, never coverage:
no checklist line goes unless the run logs show it finds nothing (`node $S/scripts/calibrate.mjs`), and no
reviewer is dropped from a level. Skip a key that an open, not-yet-settled note already targets: stacking
repairs makes neither measurable.

- `source` is null, or `source.clean` is false: **propose only**. Don't edit anything; the repair is
  written into the note with `commit` left out.
- Otherwise edit files under `<source.path>/amag-pr-review/` with the Edit tool, write the commit
  message to `$W/spend-commit.txt` (subject `amag-pr-review: <what the repair does>`; body: the run, the
  cause with its numbers, the expected effect; then the Co-Authored-By line), and run:

```bash
node $S/scripts/spend.mjs commit $W $W/spend-commit.txt   # → {committed, branch, files}
```

`commit` refuses changes outside the plugin, a tree that moved since `report`, or failing tests, and
rolls a failed repair back. On a refusal, record it as a proposal instead; don't work around it. Never push.

## 4. Leave the note

Write `$W/spend-note.json` and record it:

```json
{ "cause": "correctness re-read every chunk's full diff: 3 reports for 2 agents, 3.6× typical",
  "repair": "reviewer.md: coverage send-back names the missing units only, not the whole chunk",
  "targets": ["correctness"], "commit": "<committed, if any>",
  "expect": "correctness back under 1.5× typical at medium" }
```

```bash
node $S/scripts/spend.mjs note $W $W/spend-note.json   # → {noted: "r<n>"}
```

`cause` and `repair` are what the next review reads to judge it, so state them as facts with numbers.
Terminal: `Repair r<n>: <repair> (<commit> on <branch>, not pushed)` or `Repair r<n> proposed: <repair>`.

If the user says a repair was wrong: `git -C <source> revert <commit>`, then settle its note `reverted`.
