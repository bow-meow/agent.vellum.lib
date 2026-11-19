---
name: symmetry-regression-tests
description: "Use when adding, updating, running or proving a test in the Symmetry end-to-end suite (Source\\Symmetry.TAS\\ in symmetryclassic, tas), including ticket-quest's regression step. Triggers — \"write a regression test for SYM-1234\", \"run the regression tests\", \"rerun just this test\", \"prove the test can fail\", a test's requires, checks, proofs or folder. SKIP for unit tests inside a product repo."
---

# Symmetry regression tests

The suite is `Source\Symmetry.TAS\` in symmetryclassic (`tas.exe`); its tests are the `symmetry` app
under `symmetry\`. A ticket's test is written in the ticket's own `symmetryclassic` worktree and
committed with the ticket's change: one test per feature, a JSON file of `tas` steps, runnable cold
by an agent, a person or a build machine. The suite's `CLAUDE.md` holds the working rules,
`symmetry\README.md` where a test is filed, and `README.md` the ground truth for step verbs,
locators, blocks, checks and proofs, params, the page API, exit codes and what is not done yet.
Read all three before writing or running a test; where they and this skill disagree, they win.
Paths below are relative to the suite folder.

When the ticket's worktree has no `Source\Symmetry.TAS\` (its base branch predates the suite), stop
and ask the user where the test goes.

## Which tests exist

A test belongs to a ticket someone worked on: every such ticket adds or updates one test of the
behaviour the ticket exists for. A label change gets a test asserting the label; a logging-only or
diagnostics deliverable, one asserting the record appears; a hardware-only bug, one against a sim
panel. Smaller changes bundled into the ticket beside that behaviour don't each need one. A failing
test with no ticket (`"tickets": []`) is reported, not debugged, unless the user asks.

Behaviour only the API exposes (a request no page sends, a rule no screen reaches) is not a TAS
test: per `symmetry\README.md` its regression test is a SymmetryApi integration test (e.g.
`Source\SymmetryApi\DeviceManagement\DeviceManagement.IntegrationTests\`), held to the same
find-before-adding, assert and prove rules below.

This is separate from the risk-based rules for tests in product repos: a label is still no risk
there and gets no repo test. The no-risk removal rule never applies to `Source\Symmetry.TAS\` paths.

## Find before adding

The catalog is `tas list` (or the page's catalogue) plus each test's `feature` field: search the
`feature` fields under `symmetry\` for the feature the ticket changes, comparing features, not file
names. A feature is a behaviour as the user meets it in one place: a new rule on a form whose other
rules already have a test is that test's feature, so it extends that test. When a test covers it,
update it: extend its steps and `checks`, add a proof for each new check, add the ticket to its
`tickets`, and widen or narrow `minVersion` for a release-branch ticket instead of forking it. Add a
test only when none covers the feature. A second test of a covered feature is a duplicate, folded
into the existing one.

## What it asserts

The behaviour, as `checks` claims on the steps that assert them (`wait`, `absent`, `gone`,
`expect-text`, `sql-expect`, `nats-request` with an `expect*` field, `click ... until`). A test with
no checked step verifies nothing. A rule (a validation, a limit, a permission) is asserted from both
sides: a value it refuses is refused, and a value it accepts is accepted, each from a clean field,
each its own check. A test of one side passes against a build that refuses everything, or nothing.
Where the check rests on what the product's code defines (validation text, ids, rules), the step's
`why` quotes that code.

Whoever specifies or reviews the test (an engineer prompt, a send-back) spells it out as its
concrete parts, never as a rule name ("both sides", "per the README") or a pointer to an earlier
message ("as in the prompt", "the gaps above"):

- each value with what the user sees for it: "`SUMMER!`: inline error shown, Save disabled;
  `SUMMER-25`: no error, Save enabled";
- each check key with its claim, and the proof (param and value) that must make it fail;
- the `requires` blocks by name (`OnboardedSimPanel`, `DeviceListOpen`, ...), in place of whatever
  the test starts, logs into or onboards itself;
- the test's file path in full, e.g.
  "`symmetry\install\access-control\device-management\panel-configuration\PanelOverviewTab.json`";
  "put it under Device Management" is not enough;
- the run requests below, for the run and the proofs, which whoever is accountable runs: a
  send-back asks the engineer to fix the test, never to run it.

## Running it, and proved

The page first: `tas serve`, in the user's logged-in session, which shows every run. Runs start
through its API, not `tas run` directly: `POST http://127.0.0.1:8766/api/run` with header `x-token`
from `web\.session.json` and body `{"names": ["<test>"]}`; it answers the run id, and results land
in the run's `status.json` (with `test.log`, `screenshot.png` and `elements.txt` on failure). The
build is the app's `program`, the suite tree's own `Source\bin\Debug\ANSI`, so the request names no
build folder: the worktree's build is what runs. After a killed run, `tas restore`. A step run by
hand is diagnosis, not a result: it skips the install and blocks. Whoever is accountable for the
test runs it; an engineer's own run is evidence to check, not the result. Nobody uses the desktop
while a run is going.

**One run at a time.** The machine has one SQL instance, one Symmetry stack and one desktop, so a
second run waits, queued, until the first has restored the databases. Don't run several by hand to
save time, and don't stop a queued run to jump it. A run is one build: tests of tickets in different
worktrees are a run each, queued; tests on the same build go in one run (`"names": ["a", "b"]`).
When working several tickets, write each ticket's test as its work finishes, start its runs, and
carry on with the other tickets while they queue: the ticket isn't verified until its runs are back
(`written, queued` until then).

The test counts only when it passes and its proofs are proved: a second run with exactly one name
and `"proofs": "all"`, where each entry must end **proved** (exit 0) on a step carrying that proof's
check. A test of both sides of a rule needs a proof per side. Read each entry's values and failing
step; exit 2 is the environment, not a proof. A check no param can make fail stays unproved and is
named as a gap, never padded.

When this machine can't run it (no test database, credentials or sim image), it is still written,
and reported as `written, not run`, with why and the request to run it.

## Records

The loader refuses run ids and fail proofs in a test's `description`, so they live outside the test:
for a ticket with a `HANDOVER.md`, its `Regression tests` heading has one row per test the ticket
added, updated or relies on: `path | covers | run`, the run being the API body for the run and for
the proofs, with each run id and result, `to be filled` until the runs are back.

## Common mistakes

| Mistake | Instead |
|---|---|
| A test written outside the ticket's worktree, or left uncommitted | `Source\Symmetry.TAS\symmetry\<tab>\<group>\<command>\` in the ticket's `symmetryclassic` worktree, committed with the change |
| A new file for a new rule on a form whose validation already has a test | Extend that test: steps, a check, a proof; add the ticket to its `tickets` |
| The test logs in, onboards or repeats another test's steps for its setup | `requires` the block that gives it |
| Only the refused value is asserted | Assert an accepted value too, each its own check from a clean field |
| "Ran it, exit 0" from `tas run` or hand-run steps | `POST /api/run` with `names`, page open, then the `"proofs": "all"` run |
| Run ids or the fail proof written into the test's `description` | The `HANDOVER.md` `Regression tests` row |
| An API-only behaviour forced into a TAS page test | A SymmetryApi integration test |
| Several tickets' runs started by hand at once, or a ticket's lane held waiting for its run | Start each run and let the queue order them; carry on with other tickets meanwhile |
| A send-back that says "fix the gaps above" | Name each value and what it shows, each check and its proof, the `requires`, the file path, the run requests |
