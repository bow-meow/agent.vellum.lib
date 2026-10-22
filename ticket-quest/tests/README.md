# ticket-quest behavioural suite

Scenario tests for the skill itself. Each scenario is a ticket with the traps a real one had: a fix
the ticket already proposes, side effects the proposal doesn't mention, an open check in the notes,
and an engineer report whose tests miss the real case. An orchestrator run reads `SKILL.md` and the
scenario and writes what it would do; an independent grader scores that against the scenario's fixed
rubric.

## The rule

**No change to `skills/ticket-quest/SKILL.md` lands unless this suite passes on the changed file.**
Show the `check` output with the change. A change made because of a real miss also adds a scenario
for that miss (below), so the lesson is tested from then on and later edits can't quietly undo it.

## Running it

Per scenario (`node suite.mjs list`), `$OUT` being a scratch folder:

1. Three runs, in parallel. Each is one agent with `model: haiku` (the model ticket-quest's
   orchestrator runs on), given the output of
   `node suite.mjs prompt <scenario> --skill <path to SKILL.md under test> --answer $OUT/<scenario>-<n>.md`.
2. Three graders, one per answer, on a model other than Haiku, given
   `node suite.mjs grade-prompt <scenario> --answer $OUT/<scenario>-<n>.md --run <n> --out $OUT/grades/<scenario>-<n>.json`.
   A grader never sees which skill version produced the answer.
3. `node suite.mjs check $OUT/grades`: exit 0 means every scenario met its bar with valid grades.

Then append the run's totals to that scenario's `history` in `rubric.json`, with the commit the
skill was at. That history shows whether the skill is drifting. A change that failed the suite goes
in the history too, marked "not landed". A criterion that keeps failing despite fixes is listed under
`known_gaps` with what was tried and what the runs showed, so the next attempt starts from there.

`node --test suite.test.mjs` tests the script itself.

## Adding a scenario from a real miss

1. Write `scenarios/<ticket>-<slug>/scenario.md` in the shape of the others: a ticket in a
   different codebase from the real one, reproducing the shape of the miss, not its names.
2. Write `rubric.json` before running anything: one criterion per thing the orchestrator must say,
   each concrete enough that a grader can quote it, and a pass bar.
3. Run it against the current `SKILL.md` first. The criterion for the miss should fail; if it passes,
   the scenario doesn't reproduce the miss, so rework it before changing the skill.
4. Change the skill, then run the whole suite, not only the new scenario.

Scenarios here were first scored by hand on 2026-10-22 (`history` says so); runs from now on go
through the grader.
