---
name: ticket-quest
description: >-
  Use when taking one or more assigned Jira tickets from investigation through to a verified implementation — a single issue or a whole backlog batch, each worked in its own git worktree. Triggers — "run ticket-quest", "work this ticket", "take my assigned tickets", "work my backlog", or being handed one or more `PROJ-####` issues to implement. SKIP for: a Jira question with no code to write, or a trivial change you would just make directly.
---

# ticket-quest — Jira tickets to a verified implementation

Run 1..N assigned Jira tickets end to end: an isolated git worktree per ticket, bounded engineering
tasks delegated to the cheapest model that can do them, a Fable advisor consulted only when the
evidence calls for it, and you verifying every claim before a ticket is called done. Commit only
when the user says so. One ticket or ten, the disciplines are the same; with one you run one lane.

**Sonnet owns and builds. Haiku looks and runs. Opus takes the hard and the sensitive. Fable
advises.** Delegate execution, not ownership: you stay responsible for the plan, the progress, the
verification, and the decision that the work is complete.

## Roles

| Role | Who | Does | Does not |
|---|---|---|---|
| Orchestrator | You, the main session, on Sonnet. A skill's `model:` lasts one turn, so if your system prompt names another model, ask the user to run `/model sonnet` and wait. | Understands the goal; plans; tracks the plan across tickets; delegates bounded work; integrates; verifies; decides "done". Simple mechanical edits and config changes. | Substantial implementation. |
| Scout | `ticket-quest:scout` (Haiku) | Targeted exploration (find files, symbols, callers, dependencies); running builds and tests and reporting the output verbatim. | Edit anything; judge whether a result is good enough. |
| Engineer | `ticket-quest:engineer` (Sonnet by default; Opus when [model routing](#model-routing) says so) | Features, bug fixes, refactors, debugging, tests, build/test failures, multi-file changes; a fresh-eyes review of another engineer's diff. | Orchestrate; commit; decide architecture. |
| Advisor | `ticket-quest:advisor` (Fable) | Architecture, design review, hard diagnosis, ambiguity, trade-offs, disagreement between analyses, review of risky cross-cutting change. | Routine work; editing the repo. |

## Model routing

Before the first delegation, read [references/model-routing.md](references/model-routing.md): it
says which model takes which task. The engineer defaults to Sonnet and you set the model on each
dispatch. A few risk-free lines in one file you make yourself; a scout only reports, so its claims
still go through the Iron Law; and after one Sonnet attempt and one corrective attempt the task
goes to Opus or the advisor, never a third try on the same model.

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
   On build-on, read the ticket dir's `HANDOVER.md` before anything else, then run its `Regression
   tests` rows before changing code; on a new ticket, create it (see
   [Handover and tools](#handover-and-tools)).
3. **Establish context yourself** — or, when the user asked to be quizzed, through
   [Quiz mode](#quiz-mode). Search, read the relevant sections, locate the implementation,
   note exact files and lines, prior attempts, and what QA saw. A sweep across many files, callers
   or naming conventions goes to a scout; you read what it finds and own the conclusion. When a search hit sits under a
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
     config values it reads, and its failure paths.
   - **Impact list**, per unit the change touches: who calls it, on which thread or loop, and what
     else that thread must keep doing (heartbeats, timers, other requests) while a call now waits;
     what each wait does if the thing it waits on never returns, not only if it is slow; what it now
     holds or allocates; what it now logs or stops logging; which contracts change (API, message,
     schema, config key, default); which other products or repos share it.
   - **Test plan:** each behaviour from the baseline and impact list, marked risk or no risk by
     [Risk-based testing](#risk-based-testing), with a one-line reason. A risk gets tests, and a
     risky path with no test gets a characterization test pinning today's behaviour, written before
     the change. A no-risk behaviour gets no repo test of any kind.
   - **Regression test:** whatever the risks, the `<root>\_regression\` test to update (its index
     Feature covers what the ticket changes) or else add: path, kind, what it asserts of the
     behaviour the ticket exists for, not each change it bundles. **REQUIRED SUB-SKILL:**
     `symmetry-regression-tests` ([its SKILL.md](../symmetry-regression-tests/SKILL.md)) first.

   When verifying needs a script (repro, load driver, seeding), read
   `<root>\_tools\README.md` now and note the shared script, by path, that does each job; only a
   job none does gets a new helper.

   Then route. Routine (step 4) means an impact list with no contract change, no shared code and no
   new wait on a caller's thread. Any of those sends the design to step 6 before anything is built,
   as does another [advisor trigger](#when-to-consult-the-advisor). Approval, a tested prototype or
   a deadline doesn't make a change routine: they say the idea was liked, not what it does to its
   callers. Only the build waits for the advisor: the characterization task (step 4) goes to the
   engineer now, either way: it tests today's code, which no design decision changes.
4. **Delegate a bounded task to the engineer,** on the model [model routing](#model-routing)
   gives it. When the test plan names a risky path with no
   test, the first task on the ticket is the characterization task: tests against the unchanged
   code pinning each of those behaviours, done when they pass on the base branch. The change comes
   next, and keeps them passing or lists each one it deliberately alters. The prompt carries: the
   goal; worktree path(s) and base; the files, lines, and evidence you found; the path of every
   module `CLAUDE.md` the task touches; the behaviour baseline, impact list and open items this
   task covers; the test plan, naming the tests to write and each behaviour that gets none; the
   regression test line, spelled out as that sub-skill says, and its SKILL.md path;
   the path of [references/engineering-guidelines.md](references/engineering-guidelines.md) for
   the engineer to follow; constraints (compatibility, conventions, generated
   artifacts to leave alone); each shared script from step 3 by path and exact command (never a
   ticket script or wrapper for its job), and each new helper's kind and place from the
   [helper table](#handover-and-tools);
   exactly which build and tests to run and in which
   environment (see [Non-negotiables](#non-negotiables)); and that it returns the
   [engineer report](#engineer-report). Give it your findings, not the whole conversation. One
   engineer per ticket at a time; never two mutating the same files.
5. **Verify the report yourself** before accepting it: `git status` and `git diff --stat` in each
   worktree, read the diff, run the build and the targeted tests (or read the pasted output
   critically; a long or noisy run can go to a scout, whose output you then read yourself),
   reproduce the original bug where possible. You, not the engineer, queue its
   regression run and a proof per side. Revert regenerated artifacts so the diff
   is only the real change, then update `HANDOVER.md`. For significant or risky work, dispatch
   **one fresh engineer** to
   review the diff — never the one that wrote it, on the model the routing table gives that diff
   (Opus for security-sensitive code). A trivial edit gets no reviewer agent: your own read is the
   review. A gap goes back to step 4 with the specific gap
   named; a trigger goes to step 6.
6. **Escalate to the advisor** with the [advisor request](#advisor-request), with the
   characterization task already delegated: the advisor holds up the build, not that task. Convert
   its recommendation into bounded engineer tasks. The advisor does not build.
7. **Completion gate**, per ticket. All must hold, or you report exactly which do not:
   - the requested behaviour exists and is integrated;
   - build and checks succeed and the appropriate tests pass, verified by you;
   - every risk in the test plan has its tests, and nothing else got one: a repo test the change
     added for a no-risk behaviour (a label, a constant, a log line, a mock verifying a call) is
     sent back to be removed from the diff, not counted as coverage. A missing test on a no-risk
     behaviour fails nothing;
   - the ticket's regression test, one item: added or updated in `<root>\_regression\`, asserts
     the behaviour the ticket exists for, written per the sub-skill, its queued runs
     back as expected (till then `written, queued`; `written, not run` with why); no
     duplicate of an indexed feature; index row current;
   - the characterization tests from step 3 were added before the change and still pass, or each
     one the change deliberately alters is listed with its old and new behaviour;
   - for each risk, at least one test reaches the change through the entry point it is used by (the
     public API, the real start and stop, the UI), not an internal call, and drives each failure the
     impact list names, and each edge case the risk has, to its worst form (stuck, not just slow).
     A test that passes without reaching that case is listed as not verifying it;
   - every open item from step 3 is done, or listed in the report as not done, with why;
   - no known blocking issue, no temporary or debug code in the repos, and the diff is coherent
     and scoped to the ticket, with any module-map change (see [Module maps](#module-maps))
     verified and listed apart from the ticket change;
   - copy the report's files-changed list and label each path `fix`, `test`, `regression` (a
     `_regression\` path) or `helper` (anything else, repro scripts too): a `helper` or
     `justfile` path in a worktree fails this item. Then
     a row per `helper`, and one per shared script the task ran: `path | kind | goes to | command
     line`, from the [helper table](#handover-and-tools) (shared: kind `shared`, stays). A
     `duplicate` fails this item. No row says "or".
8. **Close out honestly.** Jira status and worklog match reality: a logging-only or partial
   deliverable is not "fixed". Commit, push, or PR only on the user's explicit say-so. Report per
   ticket: what changed, what you verified and how, what you could not verify, each open item and
   its state, each impact-list entry and how the change handles it, any behaviour the change
   deliberately alters, and which module
   maps were added or refreshed — they go in their own commit in the same PR when the user commits.
   Write it into `HANDOVER.md` and say in the report what went under each heading: `Changed and
   verified`, `Left and next step`, `Regression tests`: `path | covers | command line`,
   `Tools`: the step-7 rows bar duplicates, copied in at their
   final paths as `path | what it does | command line`, e.g.
   `<root>\_tools\net\Send-Traffic.ps1 | sends requests at a set rate | Send-Traffic.ps1 -Rate 50`.
   If the ticket taught a reusable technique, write an article by
   `C:\repos\articles\WRITING.md` when it exists.

## Quiz mode

Opt-in per run: the user asks to be quizzed on the approach ("quiz me", "quiz mode").
Otherwise never quiz. When asked, read [references/quiz-mode.md](references/quiz-mode.md) before
step 3: a scan agent maps the code, you quiz the user on what it leaves open, and answers
constrain the build.

## Handover and tools

The ticket dir (`<root>\<TICKET>\`, beside the worktrees, in no repo, never committed) holds:

- **`HANDOVER.md`**: created with the worktrees, updated after each verified task and at close-out,
  read first on pickup. Headings, each filled: `Goal and repos` · `Open items, baseline, impact`
  (each with its state) · `Changed and verified` · `Left and next step` · `Regression tests` ·
  `Tools` (rows as in step 8). Each update rewrites every heading to the current state, a
  snapshot: stale lines replaced, done or superseded ones removed; history is in git. Handover
  notes live only here, never on the Jira ticket.
- **`tools\`**: this ticket's `repro` and `seed` helpers (below).

Every helper is a `.ps1` with a help block (`.SYNOPSIS`, `.EXAMPLE`) and parameters, never a repo
script or a `justfile` recipe, whoever asks; non-.ps1 ones are rewritten, not moved. Its
kind, the first that fits, decides where it goes:

| Kind | What it does | Goes to |
|---|---|---|
| `duplicate` | the job a row of `<root>\_tools\README.md` describes (compare jobs, not names), even wrapped or hardcoded | nowhere: call or extend that script |
| `repro`, `seed` | reproduces this bug, or inserts this ticket's test data | the ticket's `tools\` |
| `driver`, `monitor`, `probe` | anything else, e.g. samples a counter or pokes a service | `<root>\_tools\`, hardcoded values made parameters, a row in its `README.md` index |

E.g. `tools\blast.ps1` sending requests at a fixed rate, the job `_tools\net\Send-Traffic.ps1`'s
row describes, is a `duplicate` (call that); `tools\repro-crash.ps1` is a `repro` (stays); `tools\ping-api.ps1` with its URL
hardcoded is a `probe` (to `_tools\` with `-Url`, plus an index row), even if only this ticket ran it.

## Module maps

A module's `CLAUDE.md` is a ≤15-line orientation. Write or refresh one, as its own engineer task
after the main change, when the work opened three or more files in a module that has none, or the
diff made a module's map say something false (a module only grepped through gets none). Read
[references/module-map.md](references/module-map.md) before dispatching it, name it in the task,
and verify the map with its checks yourself.

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

## Risk-based testing

A test is upkeep for as long as the code lives; only a risk earns one. **Risk:** a regression would
be silent or found late, and cost something. The behaviour the ticket exists to fix, with its edge
cases (boundaries, midpoints, null, negatives, the error path, the concurrent case); a contract (API,
message, schema, config key, default); shared code; waits and concurrency; money, data, security,
permissions; easy-to-get-wrong logic (parsers, calculations, state machines); code with earlier
fixes or reverts. **No risk:** the failure is loud and immediate (compile error, crash on start),
visible at once (UI text, layout, a UI-only default), or the test could only restate the code (a
constant, a log message, a mock verifying a call); one-line delegation to tested code; generated
code and wiring. Size decides nothing: one line changing how money rounds is a risk.

The full rules, shared with amag-pr-respond, are in
[references/engineering-guidelines.md](references/engineering-guidelines.md).

<!-- Same risk lists as engineering-guidelines.md: change both. -->

## Worktree mechanics

Create worktrees with the bundled `scripts/mk-worktree.mjs`, never by hand-running git. Once the
repos, a base per repo (see [Base defaults](#base-defaults)) and the user-confirmed slug are
settled, read [references/mk-worktree.md](references/mk-worktree.md) for the command and exit codes.
Exit `3` means the ticket dir or branch exists: the user chooses build-on vs start-fresh; never
clobber or delete it yourself. For a ticket that needs building or sim-testing, first read
[references/build-conveniences.md](references/build-conveniences.md): seeding, and the
`just mk-worktree` that replaces the script when `C:\repos\symmetry.world` exists.

### Base defaults

Before confirming bases, read [references/base-defaults.md](references/base-defaults.md): the
default per repo, and how to persist a new one when the user asks.


## Non-negotiables

Each of these is here because an agent was observed violating it, not because it was imagined.

- **Do not commit to an unverifiable root cause.** For an intermittent or hardware-only bug that
  has already failed QA, go **logging-first**: ship diagnostic instrumentation, reproduce, read the
  logs, *then* fix. A reproduction you authored proves your hypothesis is *fixable*, not that it is
  the bug the field actually hits.
- **Verify for real.** "It can't build/test here" is a claim to *test*, not state: a component may
  build in a **different environment than the host** (a Linux service or firmware in WSL).
- **Honest state.** Don't move a logging-only or partial deliverable to a status that signals
  "fixed"; it misleads QA. Estimates and worklogs reflect real scope and real time.

## Rationalisations — rejected

| Excuse | Reality |
|---|---|
| "The cause is obviously X, let me write the fix." | On a bug that already failed QA, confirm X first. Obvious-but-unconfirmed is how the third QA failure happens. |
| "My unit test reproduces it, so it's fixed." | Your test reproduces *your hypothesis*, not necessarily the field bug. |
| "Let the engineer try one more thing." | A reasonable attempt and a reasonable correction have failed. Escalate; variations burn context. |
| "I'll hand the engineer the whole ticket and let it drive." | Bounded tasks. The engineer builds; you own the plan. |
| "The engineer can review its own diff, it knows the change best." | That is why it cannot. A review pass is a fresh engineer or nothing. |
| "The ticket already proposes the fix; build it as written." | The proposal covers what the ticket asked. Most regressions are behaviour nobody listed: the baseline and impact list are still yours to write. |
| "Clear cause, bounded change, approved and tested: routine, the open items are just verification." | Observed in testing: written right after noting the change blocks its callers. A new wait on a caller's thread, a contract change or shared code goes to the advisor, whoever approved it and whenever it's due. |
| "It has no tests, so there's nothing to break." | No tests means nothing will tell you it broke. Pin today's behaviour on the risky paths you touch before changing them. |
| "More tests can't hurt." / "They're written and pass; leave them." | Each is upkeep. A test of a label, constant or log call fails only on a deliberate edit. Not in the plan, out of the diff. |
| "Only a label change: no regression test." | Every ticket gets one; here it asserts the label. |
| "It clicked through without errors, so it passes." | A test without an assertion verifies nothing. |
| "The repro script is a tool QA needs, not production code; it can stay in the repo." | Not the fix and not its test, so it's a helper: it leaves the repo and is redone as `tools\<name>.ps1`, listed in `HANDOVER.md`. |
| "It's hardcoded for this ticket, so it stays in `tools\`." | Observed in testing. Only a repro or seed stays; hardcoded values become parameters. |
| "The tests pass." | Through which entry point, and which failure? Tests that use an internal shortcut, or only a mild form of the failure, pass while the real path breaks. |
| "The grep hit is right there, I'll open the code." | The module's `CLAUDE.md` is ~400 tokens and names the trap you are about to re-derive over five reads. Read it first. |

## Red Flags — STOP and re-check

- About to make more than a mechanical edit yourself.
- About to accept "tests pass" or "N files changed" without running or `git status`-ing yourself.
- About to dispatch a third variation after a corrective attempt failed.
- About to send the advisor a question without Evidence and Attempts.
- Consulting the advisor on something the engineer has not tried.
- About to commit, push, or transition to a done-ish status without the user asking.
- About to delegate a change with no behaviour baseline or impact list, or with an open item that
  has no owner.
- About to change code on an untested risky path before a characterization test pins it.
- About to ask for, or accept, a repo test of a label, constant, log line or UI default.
- About to skip a test on a risk because the diff is small.
- About to close a ticket with no `_regression\` test added or updated.
- About to add a regression test for a feature the index covers.
- Quiz mode: building before the user answered, or asking what a convention settles.
- A test that reaches the change in a way users and the system never do.
- About to run `git worktree add` by hand instead of `mk-worktree.mjs`.
- About to open a file in a folder that has a `CLAUDE.md` you have not read.

## Anti-patterns

- Agent ping-pong: agents asked to reassess the same information. You decide unless there is
  genuinely new evidence or expertise.
