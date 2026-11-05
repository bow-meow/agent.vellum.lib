# Engineering guidelines

How code gets changed, tested and verified, whoever is changing it: ticket-quest's engineer on a
ticket, or amag-pr-respond fixing a review comment. Nothing here creates worktrees, touches Jira or
writes a handover; those belong to ticket-quest's workflow.

## Before changing code

- **Read the module map first.** When a folder on the path to a file you are about to open has its
  own `CLAUDE.md`, read it before the file: a worktree outside the launch repo gets no automatic
  injection of nested `CLAUDE.md` files.
- **Behaviour baseline:** what the code does today on every path the change touches: its callers,
  the modes and products it runs in (a shared file runs in each of them), the inputs and config
  values it reads, and its failure paths.
- **Impact list**, per unit the change touches: who calls it, on which thread or loop, and what else
  that thread must keep doing while a call now waits; what each wait does if the thing it waits on
  never returns, not only if it is slow; what it now holds or allocates; what it now logs or stops
  logging; which contracts change (API, message, schema, config key, default); which other products
  or repos share it.
- **Unverifiable root cause:** for an intermittent or hardware-only bug that has already failed QA,
  go logging-first: ship diagnostic instrumentation, reproduce, read the logs, then fix.

## Risk-based testing

A test costs upkeep for as long as the code lives. Write one only where its absence is a risk: where a
regression would be **silent or found late**, and would **cost something** when it is found. Every
other behaviour gets no new test, characterization or otherwise. These rules govern tests in product
repos; the regression suite is a separate obligation (the `symmetry-regression-tests` skill, in
`../../symmetry-regression-tests/SKILL.md` from here).

**A risk, so it gets a test:**

- the behaviour the change exists to fix or manage (the bug the ticket reports, the wrong total, the
  stale cache), including its edge cases: boundaries, midpoints, empty and null, negative values,
  the error path, the concurrent case;
- a contract other code or systems rely on: API, message, schema, file format, config key, default;
- shared code: a file other products, modes or repos also run;
- concurrency, waits and timeouts: anything that can block, race, hang or leak;
- money, data integrity, security and permissions;
- branching logic easy to get wrong: parsers, calculations, state machines, business rules;
- code whose history shows earlier fixes or reverts.

**Not a risk, so no test:**

- the failure is loud and immediate: a compile error, a crash on start, a page that won't render;
- the result is visible at once to whoever next looks: UI text, labels, layout, a UI-only default;
- the test could only restate the code: a constant, a literal, a log message, a mock verifying a call
  was made;
- one-line delegation to code already tested with the same inputs;
- generated code, wiring, configuration plumbing.

A behaviour on the first list stays a risk however small its diff; one on the second stays out
however easy its test would be. When unsure, say which list it falls on and why in one line, then
act on that.

**The tests a risk gets:**

- **Characterization first.** A risky path with no test gets a test pinning today's behaviour,
  written before the change, passing on the base branch. The change keeps it passing or lists each
  one it deliberately alters, old and new behaviour.
- **Through the real entry point.** At least one test per risk reaches the change the way users and
  the system do (the public API, the real start and stop, the page handler), not an internal call,
  and drives each failure the impact list names to its worst form: stuck, not slow; across the
  deadline, not short of it. A test that passes without reaching that case doesn't verify it.
- **A bug fix adds a regression test** that fails on the old code, when the bug is a risk by the
  list above.

**Tests that don't earn their place come out.** A test this change added for a behaviour on the
not-a-risk list is removed from the diff, not counted as coverage. Pre-existing tests stay.

Prefer fast integration tests, smoke tests and targeted regression tests; unit tests for
deterministic logic; end-to-end tests only for critical user paths. No coverage targets, no tests
that mirror implementation details. Run targeted tests while iterating and broad validation before
calling the work done.

## Making the change

- The smallest change that solves the task, in the codebase's own idiom.
- Comments follow the `code-comments` skill: invoke it before writing any.
- No debug or temporary code left behind.
- A full build can regenerate artifacts (SDKs, generated code): revert them so the diff is only the
  real change.
- Repro, seed and other helper scripts never go in the repo or a `justfile` recipe. In ticket-quest
  they go where its helper table says; elsewhere, in the scratchpad.

## Verifying

- Run the narrowest build and tests that cover the touched code, in the component's real build
  environment (a Linux service or firmware may build in WSL, not on the host). "It can't build or
  test here" is a claim to test, not to state.
- Run `git status` and `git diff --stat` yourself; a reported file count is a lead, not a fact.
- Record exactly what was and wasn't verified. A gap is reported, never silently omitted.
