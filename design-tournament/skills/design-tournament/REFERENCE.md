# design-tournament reference

Read this when running a tournament and you need the exact mechanics, or when changing how
anonymisation, validation, or scoring works.

## Why fresh judges rather than cross-review

When the same model generates and judges, it rates its own output higher — self-preference bias.
Two companions make it worse: verbosity bias rewards longer designs regardless of merit, which
selects for over-engineering; position bias rewards whichever design is seen first or last.

| Bias | Mitigation | Strength |
|---|---|---|
| Self-preference | Judges wrote nothing | Strong — removes the cause |
| Self-preference (residual) | Identity and stance labels stripped | Partial — style is still recognisable |
| Verbosity | Hard word cap, enforced before judging | Strong — structural |
| Position | Independent rotation per judge | Strong |
| Criteria drift | Rubric fixed and confirmed before designs exist | Strong |

The length cap matters more than it looks. Without it, "more thorough" and "longer" are
indistinguishable to a judge, and the tournament reliably selects for over-engineering.

## The design template

Each designer returns `{body, citations}`. The body must:

- stay within the word cap (600 by default) — over-length is returned for compression, not judged
- cite real `file:line` references; a design citing nothing is disqualified before judging
- argue from its assigned stance without hedging toward the middle

## Entry validation

`validateEntries(designs, cap)` in `scripts/tally.mjs` returns `{accepted, rejected}`, where each
rejection carries `reason: 'no-citation' | 'over-length'`. The workflow applies the same two gates
inline before judging — it cannot import the module, because workflow scripts run without
filesystem access. The `CITATION` regex is therefore duplicated in both files, and
`scripts/tests/workflow-syntax.test.mjs` asserts the two literals stay identical.

If fewer than two designs survive validation, the run aborts: a tournament of one is not a
tournament.

## Tally rules

`tally(judges)` returns one of three outcomes:

- `inadequate` — a majority of judges set `adequate: false`. Takes precedence over any ranking.
- `tie` — no single design holds strictly the most first-place rankings.
- `winner` — one design leads on first-place rankings; `grafts` collects each judge's nominated
  idea from designs that did NOT win.

Scores are never summed across judges. Averaging independent scales invents precision that is not
there, and a genuine split is information about the decision rather than noise to flatten.

## Synthesis

The synthesiser receives the winner, every graft nomination, and all dissent, and returns:

- **The synthesised design** — winner as spine, grafts merged where they do not conflict with it.
  Conflicts resolve in favour of the spine and are recorded, not dropped.
- **The minority report** — surviving objections, including judges' concerns about the winner.

## Running the tests

Name the test files explicitly. `node --test <dir>` tries to load the directory as a module and
fails with `MODULE_NOT_FOUND`:

```
cd scripts/tests
node --test tally.test.mjs workflow-syntax.test.mjs
```

`node --check` cannot validate `tournament-workflow.mjs` — it rejects the top-level `return` and
`await` that the Workflow runtime makes legal by wrapping the script in an async function. The
syntax test mirrors that wrapper instead.
