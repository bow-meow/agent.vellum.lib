# Ticket fit

Does the change actually solve the ticket? You get the full Jira issue.

## Look for
- **Bug tickets**: follow the repro steps through the changed code. Does the change hit the root cause,
  or only a symptom (e.g. a null check where the ticket describes a missing cache invalidation)? Is
  there another path that still reaches the bug (a second caller, another message handler, the
  server-side and the panel-side)?
- **Acceptance criteria**: map each one to the code that satisfies it. List any criterion with no code.
- **Ticket comments**: the root cause and agreed approach are often worked out there. Does the change
  match what was agreed?
- **Sibling PRs**: a gap covered by another PR on the same ticket is not a gap. Say which PR covers it.
- **Scope creep**: changes unrelated to the ticket.

## Severity hints
- `blocking` only with a concrete repro trace through the code showing the bug still happens, or a
  criterion that is plainly not implemented anywhere (including siblings).
- Uncertain coverage ("not sure this covers X") → `terminal_only: true`, severity Low.
- Scope creep → Info.
- No ticket, or no description → write `[]`; the orchestrator notes it in the terminal.
- A gap with no natural line: anchor on the file most related to the criterion; if none fits, set
  `terminal_only: true`.

## Team history
- Cross-repo partners and merge order: esg-ng-core-m33 and esg-ng-core-linux changes to the same reader/tamper behaviour ship as paired PRs; esg-ng-ipc codec changes merge first and the m33 repo is then repointed at its main; amag.symmetry.nats changes need a version bump in symmetryclassic and a port to the active release branch. Check the partner PR exists and the order is stated.
- PR description vs branch: features, attributes or test guarantees the description advertises (an override attribute, "proves X against a Strict instance") that aren't actually in the diff. Either the file is missing or the description needs trimming.
- Behaviour changes that need a release note or technical-doc line: a service that now refuses to start (StopOrExit/os.Exit on a startup error), a new hard codegen failure every consumer hits on upgrade, JetStream storage limits changed in symmetrynats.conf, a configured value now handed to clients or devices differently for some installs, when they keep what they were given.
- Unrelated changes riding along: .vscode/launch.json edits, files touched only by variable renames, lines marked "hack" in CMakeLists.txt, unrelated package or NuGet bumps in common.build.props, whitespace-only hunks (trailing spaces, end-of-file blank lines) in files that also carry the real change (compare `git diff` with `git diff -w --ignore-blank-lines`).
- A performance fix that also rewrites code the measured path never executes (a trigger whose guard columns the hot-path UPDATE doesn't touch, a proc the benchmark doesn't call): it adds nothing to the ticket's numbers but changes behaviour, so it belongs under its own ticket where QA tests it on purpose.
- Known gaps left as an inline @todo or a "hardening follow-up" code comment: ask for a Jira ticket so the gap isn't lost.
