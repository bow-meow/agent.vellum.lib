# Regression suite

`<root>\_regression\` sits beside `_tools\`, in no repo, never committed: one test per feature,
runnable cold by an agent, a person or a build machine. Its `README.md` (read at step 3) holds the
index and the ground truth for header fields, exit codes, env vars, the runner and `lib\` modules.

## Every ticket, no exemptions

Every ticket adds or updates one regression test of the behaviour the ticket exists for. A label
change gets a test asserting the label; a logging-only or diagnostics deliverable, one asserting the
record appears; a hardware-only bug, one against a sim panel. Smaller changes bundled into the
ticket beside that behaviour don't each need one.

This is separate from the risk-based rules, which govern tests in product repos only. A label is
still no risk there and gets no repo test; the regression test asserts it only when the label is
what the ticket exists for. The no-risk removal rule never applies to `_regression\` paths.

## Find before adding

Search the index's Feature column for the feature the ticket changes (compare features, not file
names). When a row covers it, update that test: extend its assertions, add the ticket to its
`Tickets` header and index row, and widen or narrow `MinVersion` for a release-branch ticket instead
of forking it. Add a test only when no row covers the feature. A second test of an indexed feature
is a duplicate, folded into the existing one.

## Kind

By what the ticket touched: `desktop` (C# desktop UI, through MSAA and
`Start-RegressionClientSession`), `web` (the Symmetry web client, Playwright), `service` (no UI:
drive the service, check the database), `panel` (ESG / Sentinel, Docker sims through
`Start-RegressionSims`, never a real panel). A UI ticket's test acts through the control the user
uses, not the view model.

## Writing it

- Named by feature (`Test-<Feature>.ps1`), not ticket, with the README's header fields.
- Self-contained inside `Invoke-RegressionTest`: `Start-SymmetryStack` (it runs
  `Assert-RegressionDatabase` first) or `Start-RegressionSims` starts only what is missing; no
  running client, existing data, hardcoded path or ticket folder assumed.
- Data through `New-RegressionObject` (API first; SQL only where no API call exists, named in the
  help block); anything else it creates gets a `Register-RegressionCleanup`.
- Asserts the behaviour with `Assert-Regression`: a state, a value, a row. A script that clicks
  through and prints "Done" verifies nothing.

## Shown failing once, or written and not run

The test counts only after it exited 1 once against the unchanged behaviour: the base build, or the
test's expectation inverted (a parameter such as `-ExpectTitle`) when the base build can't run. The
orchestrator runs both itself. Exit 2 is the environment, not a failure proof.

When this machine can't run it (no test database, credentials or sim image), it is still written,
and reported at the gate and in `HANDOVER.md` as `written, not run`, with why and the command to run
it. A missing test fails the gate; an unrun one with a reason does not.

## Records

- The test's index row (Feature, Tickets, MinVersion, Command) is added or made current.
- `HANDOVER.md`'s `Regression tests` heading: `path | covers | command line`, one row per test this
  ticket added, updated or relies on. On build-on these rows run before any code changes; a failure
  is recorded as the baseline.
