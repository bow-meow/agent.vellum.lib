---
name: ticket-quest
description: >-
  Use when taking one or more assigned Jira tickets from investigation through to a verified implementation — a single issue or a whole backlog batch, each worked in its own git worktree. Triggers — "run ticket-quest", "work this ticket", "take my assigned tickets", "work my backlog", or being handed one or more `PROJ-####` issues to implement. SKIP for: a Jira question with no code to write, or a trivial change you would just make directly.
model: haiku
---

# ticket-quest — Jira tickets to a verified implementation

Run 1..N assigned Jira tickets end to end: an isolated git worktree per ticket, bounded engineering
tasks delegated to an Opus engineer, a Fable advisor consulted only when the evidence calls for it,
and you verifying every claim before a ticket is called done. Commit only when the user says so.
One ticket or ten, the disciplines are the same; with one you run one lane.

**Haiku owns. Opus builds. Fable advises.** Delegate execution, not ownership: you stay responsible
for the plan, the progress, the verification, and the decision that the work is complete.

## Roles

| Role | Who | Does | Does not |
|---|---|---|---|
| Orchestrator | You, the main session. This skill switches the turn to Haiku; if the model did not change (auto mode can refuse it), run `/model haiku` first. | Understands the goal; searches and reads; tracks the plan across tickets; delegates bounded work; integrates; verifies; decides "done". Simple mechanical edits and config changes. | Substantial implementation. |
| Engineer | `ticket-quest:engineer` (Opus) | Features, bug fixes, refactors, debugging, tests, build/test failures, multi-file changes; a fresh-eyes review of another engineer's diff. | Orchestrate; commit; decide architecture. |
| Advisor | `ticket-quest:advisor` (Fable) | Architecture, design review, hard diagnosis, ambiguity, trade-offs, disagreement between analyses, review of risky cross-cutting change. | Routine work; editing the repo. |

## The Iron Law

```
THE ORCHESTRATOR DELEGATES EVERY SUBSTANTIAL BUILD AND VERIFIES EVERY DELEGATED CLAIM ITSELF.
```

**Violating the letter of this rule is violating its spirit.** No exceptions:

- Not "the engineer said the tests pass" — run them in the worktree, or read the output it pasted
  and check it says what the report claims.
- Not "it reported one file changed" — `git status` the worktree yourself. Observed: one file
  reported, 33 in the tree, because a build had regenerated SDKs.
- Not "I've already read the code, it's quicker to fix it myself" — your diagnosis is context to
  hand the engineer, not a licence to build.
- Not "one more variation will work" after a corrective attempt failed — that is the escalation
  trigger, not a reason to burn another engineer.

## Workflow

Keep one task list for all tickets; every ticket has its own lane and its own worktree. Independent
tickets progress at different speeds; never block one on another.

1. **Scope.** Read the ticket(s), description and comments. Confirm **which repos** each touches —
   a ticket may span a service repo and a companion/firmware repo. **`symmetryclassic` is always
   in the set**, plus whatever other repos the ticket touches, even when the change lives entirely
   in a companion repo (e.g. `amag.symmetry.nats`): without it the ticket can't be targeted, built,
   run, or tested end to end. Confirm the **base ref per repo** (see [Base defaults](#base-defaults))
   and confirm the branch **slug**.
2. **Isolate — one git worktree per repo per ticket** (see [Worktree mechanics](#worktree-mechanics)).
   Detect a pre-existing ticket dir or branch and ask build-on vs start-fresh rather than clobbering.
   On build-on, read the ticket dir's `HANDOVER.md` before anything else; on a new ticket, create it
   (see [Handover and tools](#handover-and-tools)).
3. **Establish context yourself.** Search, read the relevant sections, locate the implementation,
   note exact files and lines, prior attempts, and what QA saw. When a search hit sits under a
   folder that has its own `CLAUDE.md`, read that file before opening anything else there: a
   worktree outside the launch repo gets no automatic injection of nested `CLAUDE.md` files, so
   nothing loads it for you (see [Module maps](#module-maps)). Move the ticket to In Development
   and set a Jira estimate from the scope you found. Write down three things before routing; a
   fix the ticket already proposes gets them too:
   - **Open items:** every check, question or untested case named in the ticket, its comments, and
     any notes or handover it links. Each one reaches the completion gate as done or not done. An
     ask there for a `just` recipe, a repo script or handover notes on the ticket is answered by a
     `tools\` script and `HANDOVER.md` instead: record it so, never pass it on as asked.
   - **Behaviour baseline:** what the code does today on every path the change touches: its
     callers, the modes and products it runs in (a shared file runs in each of them), the inputs and
     config values it reads, and its failure paths. A path with no test gets a characterization
     test that pins today's behaviour, written before the change.
   - **Impact list**, per unit the change touches: who calls it, on which thread or loop, and what
     else that thread must keep doing (heartbeats, timers, other requests) while a call now waits;
     what each wait does if the thing it waits on never returns, not only if it is slow; what it now
     holds or allocates; what it now logs or stops logging; which contracts change (API, message,
     schema, config key, default); which other products or repos share it.

   Then route. Routine (step 4) means an impact list with no contract change, no shared code and no
   new wait on a caller's thread. Any of those sends the design to step 6 before anything is built,
   as does another [advisor trigger](#when-to-consult-the-advisor). Approval, a tested prototype or
   a deadline doesn't make a change routine: they say the idea was liked, not what it does to its
   callers. Only the build waits for the advisor: the characterization task (step 4) goes to the
   engineer now, either way: it tests today's code, which no design decision changes.
4. **Delegate a bounded task to the engineer.** The first task on a ticket is always the
   characterization task: tests against the unchanged code pinning each behaviour the baseline
   named, done when they pass on the base branch. The change comes next, and keeps them passing or
   lists each one it deliberately alters. The prompt carries: the goal; worktree path(s) and
   base; the files, lines, and evidence you found; the path of every module `CLAUDE.md` the task
   touches; the behaviour baseline, impact list and open items this task covers, and the
   characterization tests to add first; constraints (compatibility, conventions, generated
   artifacts to leave alone); the ticket's `tools\` path, where any helper goes as a `.ps1`;
   exactly which build and tests to run and in which
   environment (see [Non-negotiables](#non-negotiables)); and that it returns the
   [engineer report](#engineer-report). Give it your findings, not the whole conversation. One
   engineer per ticket at a time. Parallel engineers only across tickets or on genuinely
   independent work; never two mutating the same files — parallel investigation, sequential
   mutation.
5. **Verify the report yourself** before accepting it: `git status` and `git diff --stat` in each
   worktree, read the diff, run the build and the targeted tests (or read the pasted output
   critically), reproduce the original bug where possible. Revert regenerated artifacts so the
   diff is only the real change, then update `HANDOVER.md`. For significant or risky work, dispatch
   **one fresh engineer** to
   review the diff — never the one that wrote it. A gap goes back to step 4 with the specific gap
   named; a trigger goes to step 6.
6. **Escalate to the advisor** with the [advisor request](#advisor-request), with the
   characterization task already delegated: the advisor holds up the build, not that task. Convert
   its recommendation into bounded engineer tasks. The advisor does not build.
7. **Completion gate**, per ticket. All must hold, or you report exactly which do not:
   - the requested behaviour exists and is integrated;
   - build and checks succeed and the appropriate tests pass, verified by you;
   - a regression test was added where practical, or you say why not;
   - the characterization tests from step 3 were added before the change and still pass, or each
     one the change deliberately alters is listed with its old and new behaviour;
   - at least one test reaches the change through the entry point it is used by (the public API,
     the real start and stop, the UI), not an internal call, and drives each failure the impact
     list names to its worst form (stuck, not just slow). A test that passes without reaching that
     case is listed as not verifying it;
   - every open item from step 3 is done, or listed in the report as not done, with why;
   - no known blocking issue, no temporary or debug code in the repos, and the diff is coherent
     and scoped to the ticket, with any module-map change (see [Module maps](#module-maps))
     verified and listed apart from the ticket change;
   - copy the report's files-changed list and label each path `fix`, `test` or `helper` (anything
     else, repro scripts too): a `helper` or `justfile` path in a worktree fails this item.
8. **Close out honestly.** Jira status and worklog match reality: a logging-only or partial
   deliverable is not "fixed". Commit, push, or PR only on the user's explicit say-so. Report per
   ticket: what changed, what you verified and how, what you could not verify, each open item and
   its state, each impact-list entry and how the change handles it, any behaviour the change
   deliberately alters, and which module
   maps were added or refreshed — they go in their own commit in the same PR when the user commits.
   Write it into `HANDOVER.md` and say in the report what went under each heading: `Changed and
   verified`, `Left and next step`, `Tools` (each script: what it does, how to run it). Notes
   never go on Jira.

## Handover and tools

The ticket dir (`<root>\<TICKET>\`, beside the worktrees, in no repo, never committed) holds:

- **`HANDOVER.md`**: created with the worktrees, updated after each verified task and at close-out,
  read first on pickup. Headings, each filled: `Goal and repos` · `Open items, baseline, impact`
  (each with its state) · `Changed and verified` · `Left and next step` · `Tools` (each script,
  what it does, how to run it). Handover notes live only here, never on the Jira ticket.
- **`tools\*.ps1`**: every repro, driver, seeding or test helper is a PowerShell script here with a
  help block (`.SYNOPSIS`, `.EXAMPLE`) and parameters. Never a repo script or a `justfile` recipe,
  whoever asks; a helper in another language is rewritten as `.ps1`, not moved.

## Module maps

A module's `CLAUDE.md` is a ≤15-line orientation — what it is, entry points, what it talks to,
traps — in the shape given in [references/module-map.md](references/module-map.md); read that file
before dispatching a map task. Ticket work maintains these maps as a side effect:

- **Read** one whenever step 3 or an engineer task enters a folder that has one (the rule in step 3).
- **Write or refresh** one when either holds: the context step or an engineer task opened three or
  more files in a module that has no `CLAUDE.md`; or the ticket's diff changed a module whose
  `CLAUDE.md` now says something false. Dispatch it as its own bounded engineer task after the
  main change, naming the reference file. A module only grepped through gets no map.
- **Verify** it yourself with the checks in the reference file before it counts as done.

## When to consult the advisor

| Consult when | Do not consult for |
|---|---|
| A real architectural choice: component boundaries, data ownership, API design, concurrency, persistence, networking, security, a significant dependency, a major refactor, a cross-cutting change. | Straightforward features, ordinary bug fixes, simple refactors, formatting, basic tests, searches, trivial config, obvious compiler errors, summarising. |
| Several reasonable designs exist and the wrong pick means significant rework. | Anything the engineer can reasonably finish itself. |
| The engineer investigated and the root cause is still unclear, the evidence contradicts the theory, or components interact unexpectedly. | A task that is merely large. Decompose it and delegate the pieces. |
| One reasonable attempt **and** one reasonable corrective attempt have failed. | A single failed attempt with an obvious next step. |
| Independent analyses materially disagree. | Every decision. Existing conventions and the engineer settle ordinary ones. |
| High risk: auth, data migrations, destructive operations, distributed state, public APIs. | |

Judgement, not a counter: escalate early when the evidence already says the direction is wrong;
do not escalate a trivial failure because an attempt failed.

### Advisor request

Curated context, not a repository dump, under seven headings: **Goal**; **Current architecture**
(only the relevant components); **Evidence** (code, errors, logs, failing tests, behaviour);
**Attempts** (what was tried, what happened); **Constraints**; **Already delegated** (the
characterization task running while you advise: each untested path and the behaviour its test
pins); **Question** — one specific question
("Given A, B and C, should X own this state or Y? Trade-offs and a recommended direction"), never
"look at this and tell me what you think". The advisor returns a recommendation, reasoning,
alternatives, trade-offs, risks, ordered next steps, and what to verify afterwards.

### Engineer report

Every delegated task returns: what changed; files changed; decisions; checks run, each with the
case it exercises and the entry point it used; results; risks; how the change handles each
impact-list entry it was given; any characterization test it had to change, and why; each script
it added to `tools\` and how to run it; anything needing an orchestrator decision. Treat it as a
lead for your verification, not as fact.

## Testing

Optimise confidence per unit of agent time. Prefer fast integration tests, smoke tests, targeted
regression tests, unit tests for deterministic logic (algorithms, parsers, calculations, state
transitions, business rules), and end-to-end tests only for critical user paths. A bug fix adds a
regression test where practical. No arbitrary coverage targets, no tests that mirror
implementation details, no full-suite runs on every change: targeted tests while iterating, broad
validation at milestones and before completion. TDD is not required universally.

## Worktree mechanics

Create worktrees with the bundled script, never by hand-running git — it needs no console, and it
owns the fetch, ref checks, and rollback. Where the environment has its own one-step worktree
command (see the build/run conveniences below), use that instead. Once the repos, a base per repo,
and the slug are confirmed, make one call (path relative to this skill's directory):

```
node scripts/mk-worktree.mjs <TICKET> <slug> --repo <clone>[=<base>] [--repo ...]
     [--root C:\repos\ticket-work] [--prefix akt] [--dry-run]
```

- **Layout:** `<root>\<TICKET>\<basename of clone>` per repo
  (e.g. `C:\repos\ticket-work\SYM-9713\esg-ng-core-linux`); `<TICKET>` must match
  `^[A-Z][A-Z0-9]+-\d+$`. **Branch:** `<prefix>/<TICKET>_<slug>` in every repo, `--no-track`.
  `<prefix>` is your initials or handle (default `akt`). Derive the slug from the ticket summary
  and **confirm it** with the user first.
- **Base:** pass the confirmed base for every repo (see [Base defaults](#base-defaults)). Omitted,
  it falls back to the clone's `origin/HEAD` — wrong for any repo whose default says to ask.
- `--dry-run` prints the plan without creating anything; show it to the user when the set is
  non-obvious. Read the worktree paths from the JSON summary on the last stdout line.
- **Exit codes:** `0` created · `1` bad arguments or a base that won't resolve — nothing was
  created · `2` git failed part-way — already rolled back, fix the cause and re-run ·
  `3` the ticket dir or branch **already exists**: surface it and let the user choose build-on vs
  start-fresh. Never clobber, and never delete the existing one yourself to get past a `3`.
- **Build/run conveniences.** A bare worktree often can't be built or sim-tested until it is
  seeded, and when `C:\repos\symmetry.world` exists its `just mk-worktree` replaces
  `mk-worktree.mjs`. Before creating worktrees for a ticket that will need building or
  sim-testing, read [references/build-conveniences.md](references/build-conveniences.md): the
  seeding steps, the one-step `just mk-worktree`, and its exit-`3` handling.

### Base defaults

Per repo, offer the default below or let the user pick another; `mk-worktree.mjs` refuses a base
that doesn't resolve. If the user picks a **non-default**
base, ask whether to **persist it as the new default** — on yes, edit the table below.

<!-- BASE-DEFAULTS: edit this table when the user asks to change a repo's default base -->

| Repo | Default base |
|---|---|
| `esg-ng-core-linux` | `origin/main` |
| `symmetryclassic` | **List the live `release/*` branches and let the user pick** (see below) |
| any other repo | `origin/HEAD` (ask) |

> These diverge on purpose: `esg-ng-core-linux` has only `origin/main` (no `master`).
> `symmetryclassic` releases from a moving set of `release/*` branches (one per version line), so
> there is no single stable default — enumerate them and let the user choose.

**For `symmetryclassic`, do NOT hardcode a base.** After `git -C <clone> fetch`, list the current
non-backup release branches and present the relevant version lines as options:

```
git -C <clone> branch -r | grep -E 'origin/release/' | grep -v backup | sort
```

Filter out the old `9.x`/`10.x` lines unless the ticket clearly targets them; offer the current
major/minor lines (e.g. the `11.x` branches) as the picks. Bias the recommendation using the
ticket's **parent epic version** when it names one (e.g. a v11.1 epic → `release/11.1.0-*`).


## Non-negotiables

Each of these is here because an agent was observed violating it, not because it was imagined.

- **Do not commit to an unverifiable root cause.** For an intermittent or hardware-only bug that
  has already failed QA, go **logging-first**: ship diagnostic instrumentation, reproduce, read the
  logs, *then* fix. A reproduction you authored proves your hypothesis is *fixable*, not that it is
  the bug the field actually hits.
- **Verify for real; never assert an untested limitation.** "It can't build/test here" is a claim
  to *test*, not state. A component may build in a **different environment than the host** (a
  Linux service or firmware that builds in WSL). A full build can regenerate **generated
  artifacts** (SDKs); revert those so the diff is only the real change.
- **Independently verify each worktree.** After an engineer reports, run `git status` and
  `git diff --stat` in that worktree **yourself**. The engineer's file count is a lead, not a fact.
- **Honest state.** Don't move a logging-only or partial deliverable to a status that signals
  "fixed"; it misleads QA. Estimates and worklogs reflect real scope and real time. Commit and push
  are the user's call, never a default.

## Rationalisations — rejected

| Excuse | Reality |
|---|---|
| "The cause is obviously X, let me write the fix." | On a bug that already failed QA, confirm X first. Obvious-but-unconfirmed is how the third QA failure happens. |
| "My unit test reproduces it, so it's fixed." | Your test reproduces *your hypothesis*, not necessarily the field bug. |
| "This can't be built/tested in this environment." | Did you try its *real* build environment? Test the claim before stating it. |
| "The engineer said N files changed and the tests pass." | Did *you* `git status` the worktree and run them? The report is a lead, not a fact. |
| "I've already read the code; quicker to fix it than to write the delegation." | Reading is your job. Building is not. Hand the engineer your diagnosis as context. |
| "It's a big ticket, better ask the advisor before starting." | Size is not a trigger. Decompose and delegate. |
| "Let the engineer try one more thing." | A reasonable attempt and a reasonable correction have failed. Escalate; variations burn context. |
| "I'll hand the engineer the whole ticket and let it drive." | Bounded tasks. The engineer builds; you own the plan. |
| "The advisor already understands the problem, I'll have it implement." | The advisor advises; the engineer implements. |
| "The engineer can review its own diff, it knows the change best." | That is why it cannot. A review pass is a fresh engineer or nothing. |
| "The ticket already proposes the fix; build it as written." | The proposal covers what the ticket asked. Most regressions are behaviour nobody listed: the baseline and impact list are still yours to write. |
| "Clear cause, bounded change, approved and tested: routine, the open items are just verification." | Observed in testing: written right after noting the change blocks its callers. A new wait on a caller's thread, a contract change or shared code goes to the advisor, whoever approved it and whenever it's due. |
| "It has no tests, so there's nothing to break." | No tests means nothing will tell you it broke. Pin today's behaviour on the paths you touch before changing them. |
| "The repro script is a tool QA needs, not production code; it can stay in the repo." | Not the fix and not its test, so it's a helper: it leaves the repo and is redone as `tools\<name>.ps1`, listed in `HANDOVER.md`. |
| "The tests pass." | Through which entry point, and which failure? Tests that use an internal shortcut, or only a mild form of the failure, pass while the real path breaks. |
| "I'll commit/push so it's ready when they're back." | Commit, push, and PR are the user's explicit call, never a default. |
| "The grep hit is right there, I'll open the code." | The module's `CLAUDE.md` is ~400 tokens and names the trap you are about to re-derive over five reads. Read it first. |

## Red Flags — STOP and re-check

- About to make more than a mechanical edit yourself.
- About to accept "tests pass" or "N files changed" without running or `git status`-ing yourself.
- About to dispatch a third variation after a corrective attempt failed.
- About to send the advisor a question without Evidence and Attempts.
- Consulting the advisor on something the engineer has not tried.
- Two engineers about to touch the same file.
- Asking the implementing engineer to review its own diff.
- About to commit, push, or transition to a done-ish status without the user asking.
- About to delegate a change with no behaviour baseline or impact list, or with an open item that
  has no owner.
- About to change code on an untested path before a characterization test pins it.
- A test that reaches the change in a way users and the system never do.
- About to run `git worktree add` by hand instead of `mk-worktree.mjs`.
- About to open a file in a folder that has a `CLAUDE.md` you have not read.

## Anti-patterns

- The orchestrator becomes the developer: substantial implementation done inline instead of
  delegated to the engineer.
- The engineer becomes the orchestrator: handed the whole project and told to finish everything.
- The advisor becomes another worker, spending its time on routine features.
- Advisor addiction: every decision sent up. Conventions and the engineer settle ordinary ones.
- Agent ping-pong: agents asked to reassess the same information. You decide unless there is
  genuinely new evidence or expertise.
- Test explosion: tests for implementation details, then time spent repairing them.
- One giant plan for all tickets. Each ticket is its own worktree, lane, and verification.
- Assuming the base branch, the repo set, or a build environment's limits instead of asking or
  testing.
