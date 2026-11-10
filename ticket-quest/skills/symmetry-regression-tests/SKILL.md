---
name: symmetry-regression-tests
description: "Use when adding, updating, running or proving a test in the Symmetry end-to-end suite (Source\\Symmetry.EndToEnd\\ in symmetryclassic, symui), including ticket-quest's regression step. Triggers — \"write a regression test for SYM-1234\", \"run the regression tests\", \"rerun just this test\", \"prove the test can fail\", a test's requires, params or folder. SKIP for unit tests inside a product repo."
---

# Symmetry regression tests

The suite is `Source\Symmetry.EndToEnd\` in symmetryclassic. A ticket's test is written in the
ticket's own `symmetryclassic` worktree and committed with the ticket's change: one test per
feature, a JSON file of `symui` steps, runnable cold by an agent, a person or a build machine. Its
`CLAUDE.md` holds the working rules and `README.md` the ground truth for step verbs, locators,
setup steps, params, exit codes, the runner and what is not done yet. Read both before writing or
running a test; where they and this skill disagree, they win. Paths below are relative to the
suite folder.

When the ticket's worktree has no `Source\Symmetry.EndToEnd\` (its base branch predates the suite),
stop and ask the user where the test goes.

## Which tests exist

A test belongs to a ticket someone worked on: every such ticket adds or updates one test of the
behaviour the ticket exists for. A label change gets a test asserting the label; a logging-only or
diagnostics deliverable, one asserting the record appears; a hardware-only bug, one against a sim
panel. Smaller changes bundled into the ticket beside that behaviour don't each need one. A failing
test with no ticket (`"tickets": []`) is reported, not debugged, unless the user asks.

This is separate from the risk-based rules for tests in product repos: a label is still no risk
there and gets no repo test. The no-risk removal rule never applies to `Source\Symmetry.EndToEnd\` paths.

## Find before adding

The catalog is `symui list` (name, kind, folder, requires) plus each test's `feature` field: search
the `feature` fields under `tests\` for the feature the ticket changes, comparing features, not file
names. A feature is a behaviour as the user meets it in one place: a new rule on a form whose other
rules already have a test is that test's feature, so it extends that test. When a test covers it,
update it: extend its steps, add the ticket to its `tickets`, and widen or narrow `minVersion` for a
release-branch ticket instead of forking it. Add a test only when none covers the feature. A second
test of a covered feature is a duplicate, folded into the existing one.

## Kind

By what the ticket touched: `desktop` (the C# / MFC client through UI Automation, and the WebView2
dashboard inside it), `web` (the Symmetry web client), `service` (no UI: `nats-request` to the
service, `sql-expect` on the database), `panel` (ESG / Sentinel, the suite's own Docker sims
through `DiscoveredSimPanel` / `OnboardedSimPanel`, never a real panel and never anyone else's
`sentinel-sim-*`), `scenario` (a journey across ribbon slices, only under `tests\scenarios\`). A UI
ticket's test acts through the control the user uses, not the view model.

## What it asserts

The behaviour, with a checking step: `wait`, `absent`, `gone`, `expect-text`, `sql-expect`,
`nats-request` with `expectContains` / `expectNotContains`. A test of clicks with no checking step
verifies nothing. A rule (a validation, a limit, a permission) is asserted from both sides: a value
it refuses is refused, and a value it accepts is accepted, each from a clean field. A test of one
side passes against a build that refuses everything, or nothing. Where the check rests on what the
product's code defines (validation text, ids, rules), the step's `why` or the `description` quotes
that code.

Whoever specifies or reviews the test (an engineer prompt, a send-back) spells it out as its
concrete parts, never as a rule name ("both sides", "per the README") or a pointer to an earlier
message ("as in the prompt", "the gaps above"):

- each value with what the user sees for it: "`SUMMER!`: inline error shown, Save disabled;
  `SUMMER-25`: no error, Save enabled";
- the `requires` setup steps or profile by name (a profile over a single step it contains), in
  place of whatever the test starts, logs into or onboards itself;
- the test's file path in full, e.g.
  "`tests\install\access-control\device-management\panel-configuration\PanelLabelCharsetOverview.json`";
  "put it under Device Management" is not enough;
- the run requests below, for the run and each proof, which whoever is accountable runs: a
  send-back asks the engineer to fix the test, never to run it.

## Writing it

- Named by feature (`<Feature>.json`, PascalCase, `name` the same), not ticket, with the README's
  fields: `feature`, `kind`, `tickets`, `minVersion`, `requires`, `description`, `params`, `steps`.
- The folder is the test's area, sliced from the ribbon: `tests\<tab>\<group>\<command>\[<part>\]`
  (`install\access-control\device-management\...`), reusing existing folders' exact spelling; the
  page groups tests by it. A service or panel test sits in its feature's folder beside the desktop
  test, never in a folder of its own kind.
- Elements are found by `id` (AutomationId, the dashboard's element ids), then name, type, class,
  `row`; never screen position, and `"via": "Mouse"` only with a `why`. A held run's `elements.txt`
  or the dashboard's Angular templates show what is there.
- Setup is declared, not written: `requires` names the README's setup steps or profile (a logged-in
  client, an encrypted port, an open view, a discovered or onboarded sim), which the runner does
  before the steps. The test never starts the apps, logs in, onboards, or `include`s a scenario to
  get that state. Setup no step provides becomes a new step in `src\Symmetry.Runner\Setup.cs` (its
  needs, what it gives the steps, a unit test), so later tests reuse it; one a passing test leaves
  done for later tests is declared in `provides`.
- Something that changes asynchronously is checked with `wait`, `gone` or `click ... until` and a
  timeout, never a fixed delay.
- Tests in a run share one session: one that changes shared state (saves a configuration) puts it
  back in its own steps. No existing data, hardcoded path or ticket folder assumed; what it creates
  is made through the API (`nats-request`, names made unique with `${new:guid}`), SQL only where no
  API call exists (said in the `description`), and removed again by its last steps.
- The values a fail proof swaps in are `params`, used through `${name}`, so a proof's run shows
  what it was given.
- Framework changes (`src\`, the runner, the page) get their unit tests
  (`dotnet test src\Symmetry.Regression.Tests`) and a README update in the same change. Stop the
  page server and any run before rebuilding (`dotnet build src\Symmetry.UiCli -c Release`): they
  lock the DLLs.

## Running it, and shown failing once

The page first: `symui serve` (`src\Symmetry.UiCli\bin\Release\net8.0-windows\symui.exe`), elevated,
in the user's logged-in session, which shows every run. Runs start through its API, not `symui run`
directly: `POST http://127.0.0.1:8766/api/run` with header `x-token` from `web\.session.json` and
body `{"names": ["<test>"], "binDir": "<worktree bin, forward slashes>"}`; it answers the run id,
and results land in `runs\<id>\` (`status.json`, `<test>\test.log`, plus `screenshot.png` and
`elements.txt` on failure). The runner installs that worktree's database and restores the user's
afterwards; after a killed run, `symui restore`. A step run by hand with `symui click ...` is
diagnosis, not a result: it skips the install and setup. Whoever is accountable for the test runs
it; an engineer's own run is evidence to check, not the result. Nobody uses the desktop while a run
is going.

**One run at a time.** The machine has one SQL instance, one Symmetry stack and one desktop, so the
runner takes the machine-wide lock and a second run waits, shown as queued, until the first has
restored the databases. Don't run several by hand to save time, and don't stop a queued run to jump
it. A run is one build: tests of tickets in different worktrees are a run each, queued; tests on the
same build go in one run (`"names": ["a", "b"]`). When working several tickets, write each ticket's
test as its work finishes, start its runs, and carry on with the other tickets while they queue: the
ticket isn't verified until its runs are back (`written, queued` until then).

The test counts only after it exited 1 once against the unchanged behaviour: the base build, or a
param overridden so the expectation inverts when the base build can't run, as its own queued run
with `"params": {"<param>": "<value>"}` in the body (one test per proof run). A test of both sides
of a rule needs a proof per side: a value it must refuse given as accepted, and the reverse. Check
the step log for the values used, then that the failing step is the one the proof aims at. Exit 2
is the environment, not a failure proof. The proof and its run id go in the test's `description`.

When this machine can't run it (no test database, credentials or sim image), it is still written,
and reported as `written, not run`, with why and the request to run it.

## Records

- The test's `description`: its passing run id and each proof with its run id, `to be filled`
  until the runs are back.
- For a ticket with a `HANDOVER.md`, its `Regression tests` heading: `path | covers | run`, one row
  per test the ticket added, updated or relies on, the run being the API body (`names`, `binDir`,
  and `params` for each proof).

## Common mistakes

| Mistake | Instead |
|---|---|
| A test written outside the ticket's worktree, or left uncommitted | `Source\Symmetry.EndToEnd\tests\` in the ticket's `symmetryclassic` worktree, committed with the change |
| A new file for a new rule on a form whose validation already has a test | Extend that test; add the ticket to its `tickets` |
| The test logs in, onboards or `include`s a scenario for its setup | `requires` the README's profile or steps |
| Only the refused value is asserted | Assert an accepted value too, each from a clean field |
| "Ran it, exit 0" from `symui run` or hand-run steps | `POST /api/run` with `names` and `binDir`, page open |
| Several tickets' runs started by hand at once, or a ticket's lane held waiting for its run | Start each run and let the lock queue them; carry on with other tickets meanwhile |
| One proof for a two-sided test, or a proof that passed | A proof per side; read the values used; it must exit 1 on the step it aims at |
| A send-back that says "fix the gaps above" | Name each value and what it shows, the `requires`, the file path, the run requests |
