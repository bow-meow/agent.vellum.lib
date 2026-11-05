---
name: symmetry-regression-tests
description: "Use when adding, updating, running or proving a test in the local Symmetry regression suite (<root>\\_regression\\ beside the ticket worktrees), including ticket-quest's regression step. Triggers — \"write a regression test for SYM-1234\", \"run the regression tests\", \"rerun just this test\", \"prove the test can fail\", a test's Requires or Area header. SKIP for unit tests inside a product repo."
---

# Symmetry regression tests

`<root>\_regression\` sits beside `_tools\` and the ticket worktrees, in no repo, never committed:
one test per feature, runnable cold by an agent, a person or a build machine. Its `README.md` holds
the index and the ground truth for header fields, setup steps, exit codes, env vars, the runner and
the `lib\` modules. Read it before writing or running a test; where it and this skill disagree, the
README wins.

## Which tests exist

A test belongs to a ticket someone worked on: every such ticket adds or updates one test of the
behaviour the ticket exists for. A label change gets a test asserting the label; a logging-only or
diagnostics deliverable, one asserting the record appears; a hardware-only bug, one against a sim
panel. Smaller changes bundled into the ticket beside that behaviour don't each need one. A failing
test with no ticket (`Tickets: -`) is reported, not debugged, unless the user asks.

This is separate from the risk-based rules for tests in product repos: a label is still no risk
there and gets no repo test. The no-risk removal rule never applies to `_regression\` paths.

## Find before adding

Search the index's Feature column for the feature the ticket changes, comparing features, not file
names. A feature is a behaviour as the user meets it in one place: a new rule on a form whose other
rules already have a test is that test's feature, so it extends that test. When a row covers it,
update that test: extend its assertions, add the ticket to its `Tickets` header and index row, and
widen or narrow `MinVersion` for a release-branch ticket instead of forking it. Add a test only when
no row covers the feature. A second test of an indexed feature is a duplicate, folded into the
existing one.

## Kind

By what the ticket touched: `desktop` (C# desktop UI, through MSAA and
`Start-RegressionClientSession`), `web` (the Symmetry web client, Playwright), `service` (no UI:
drive the service, check the database), `panel` (ESG / Sentinel, Docker sims through
`Start-RegressionSims`, never a real panel). A UI ticket's test acts through the control the user
uses, not the view model.

## What it asserts

The behaviour, with `Assert-Regression` (or a spec's `expect`): a state, a value, a row. A script
that clicks through and prints "Done" verifies nothing. A rule (a validation, a limit, a permission)
is asserted from both sides: a value it refuses is refused, and a value it accepts is accepted, each
from a clean field. A test of one side passes against a build that refuses everything, or nothing.

Whoever specifies or reviews the test (an engineer prompt, a send-back) spells it out as its
concrete parts, never as a rule name ("both sides", "per the README"):

- each value with what the user sees for it: "`SUMMER!`: inline error shown, Save disabled;
  `SUMMER-25`: no error, Save enabled";
- the `Requires` profile or steps by name, in place of whatever the test starts or logs into itself;
- the `Area` path, written out under the index's existing branch;
- the runner and proof commands below.

## Writing it

- Named by feature (`Test-<Feature>.ps1`), not ticket, with the README's header fields: `Feature`,
  `Area`, `Tickets`, `MinVersion`, `Kind`, and `Requires` when it needs setup.
- `Area` is a path, broad to narrow (`<product area> > <page> > <tab or part>`), reusing an existing
  branch's exact spelling from the index; the regression page groups tests by it. A test of the
  service behind a page goes under that page.
- Setup is declared, not written: `Requires` names the README's setup steps or profile (a logged-in
  client, an open view, an onboarded panel), which `Invoke-RegressionTest` runs before the body and
  passes in as `$Setup`. The test never starts the apps, logs in or onboards itself. Setup no step
  provides becomes a new step in `lib\SymmetrySetup.psm1` (its `Needs`, its result, a unit test),
  so later tests reuse it.
- A web test that needs setup is a `tests\web\Test-*.ps1` that runs its spec from `web\driven\`
  (`Invoke-RegressionDrivenSpec`). Steps reuse an earlier test's view, so the spec reloads it first
  (`refreshDashboard`) and targets elements that are unique on the page.
- Tests in a run share one session: one that changes shared state (saves a configuration) puts it
  back. No existing data, hardcoded path or ticket folder assumed; data through
  `New-RegressionObject` (API first; SQL only where no API call exists, named in the help block);
  anything else it creates gets a `Register-RegressionCleanup`.
- The values a fail proof swaps in are test-only parameters, and the test logs the values it used
  (`Write-RegressionLog`), so a proof shows what it was given.
- Framework changes (`lib\`, the runner, the page) get their unit tests (`Invoke-Pester .\lib.tests`)
  and a README update in the same change.

## Running it, and shown failing once

From `<root>\_regression\`: `.\Start-RegressionUi.ps1` first, which opens the page showing the run,
then `.\Run-Regression.ps1 -BinDir <worktree bin> -Name <test>` (or `-Ticket`, `-Area`). The runner
installs that worktree's database and restores the user's afterwards. A direct `powershell -File`
run of a test is no result: it skips the install and the setup steps. Whoever is accountable for the
test runs it; an engineer's own run is evidence to check, not the result.

The test counts only after it exited 1 once against the unchanged behaviour: the base build, or the
test's expectation inverted when the base build can't run, through
`.\runs\proof.ps1 -Test <test> -TestArgs '-<Param> "<value>"'` (double quotes inside: `-File` keeps
single quotes as part of the value). A test of both sides of a rule needs a proof per side: a value
it must refuse given as accepted, and the reverse. Check the logged values, then that the failure is
the assertion the proof aims at. Exit 2 is the environment, not a failure proof.

When this machine can't run it (no test database, credentials or sim image), it is still written,
and reported as `written, not run`, with why and the command to run it.

## Records

- The test's index row (Feature, Area, Requires, Tickets, MinVersion, Command) is added or made
  current.
- For a ticket with a `HANDOVER.md`, its `Regression tests` heading: `path | covers | command line`,
  one row per test the ticket added, updated or relies on, the command being the
  `Run-Regression.ps1` line.

## Common mistakes

| Mistake | Instead |
|---|---|
| A new file for a new rule on a form whose validation already has a test | Extend that test; add the ticket to its row |
| The test starts the apps or logs in itself | `Requires:` the README's profile or steps |
| Only the refused value is asserted | Assert an accepted value too, each from a clean field |
| "Ran it, exit 0" from `powershell -File` | `Run-Regression.ps1 -BinDir <worktree bin> -Name <test>`, page open |
| One proof for a two-sided test, or a proof that passed | A proof per side; read the logged values; it must exit 1 on its assertion |
| A send-back that says "fix the gaps above" | Name each value and what it shows, the Requires, the Area path, the commands |
