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
   a ticket may span a service repo and a companion/firmware repo. Confirm the **base ref per
   repo** (see [Base defaults](#base-defaults)) and confirm the branch **slug**.
2. **Isolate — one git worktree per repo per ticket** (see [Worktree mechanics](#worktree-mechanics)).
   Detect a pre-existing ticket dir or branch and ask build-on vs start-fresh rather than clobbering.
3. **Establish context yourself.** Search, read the relevant sections, locate the implementation,
   note exact files and lines, prior attempts, and what QA saw. Move the ticket to In Development
   and set a Jira estimate from the scope you found. Then route: routine (clear cause, bounded
   change) goes to step 4; an [advisor trigger](#when-to-consult-the-advisor) goes to step 6 first.
4. **Delegate a bounded task to the engineer.** The prompt carries: the goal; worktree path(s) and
   base; the files, lines, and evidence you found; constraints (compatibility, conventions,
   generated artifacts to leave alone); exactly which build and tests to run and in which
   environment (see [Non-negotiables](#non-negotiables)); and that it returns the
   [engineer report](#engineer-report). Give it your findings, not the whole conversation. One
   engineer per ticket at a time. Parallel engineers only across tickets or on genuinely
   independent work; never two mutating the same files — parallel investigation, sequential
   mutation.
5. **Verify the report yourself** before accepting it: `git status` and `git diff --stat` in each
   worktree, read the diff, run the build and the targeted tests (or read the pasted output
   critically), reproduce the original bug where possible. Revert regenerated artifacts so the
   diff is only the real change. For significant or risky work, dispatch **one fresh engineer** to
   review the diff — never the one that wrote it. A gap goes back to step 4 with the specific gap
   named; a trigger goes to step 6.
6. **Escalate to the advisor** with the [advisor request](#advisor-request). Convert its
   recommendation into bounded engineer tasks. The advisor does not build.
7. **Completion gate**, per ticket. All must hold, or you report exactly which do not:
   - the requested behaviour exists and is integrated;
   - build and checks succeed and the appropriate tests pass, verified by you;
   - a regression test was added where practical, or you say why not;
   - no known blocking issue, no temporary or debug code, and the diff is coherent and scoped to
     the ticket.
8. **Close out honestly.** Jira status and worklog match reality: a logging-only or partial
   deliverable is not "fixed". Commit, push, or PR only on the user's explicit say-so. Report per
   ticket: what changed, what you verified and how, and what you could not verify.

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

Curated context, not a repository dump, under six headings: **Goal**; **Current architecture**
(only the relevant components); **Evidence** (code, errors, logs, failing tests, behaviour);
**Attempts** (what was tried, what happened); **Constraints**; **Question** — one specific question
("Given A, B and C, should X own this state or Y? Trade-offs and a recommended direction"), never
"look at this and tell me what you think". The advisor returns a recommendation, reasoning,
alternatives, trade-offs, risks, ordered next steps, and what to verify afterwards.

### Engineer report

Every delegated task returns: what changed; files changed; decisions; checks run; results; risks;
anything needing an orchestrator decision. Treat it as a lead for your verification, not as fact.

## Testing

Optimise confidence per unit of agent time. Prefer fast integration tests, smoke tests, targeted
regression tests, unit tests for deterministic logic (algorithms, parsers, calculations, state
transitions, business rules), and end-to-end tests only for critical user paths. A bug fix adds a
regression test where practical. No arbitrary coverage targets, no tests that mirror
implementation details, no full-suite runs on every change: targeted tests while iterating, broad
validation at milestones and before completion. TDD is not required universally.

## Worktree mechanics

Create worktrees with the bundled script, never by hand-running git — it needs no console, and it
owns the fetch, ref checks, and rollback. Once the repos, a base per repo, and the slug are
confirmed, make one call (path relative to this skill's directory):

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
- **Build/run conveniences (environment-specific — the four steps below are an example).** A bare
  worktree often cannot be built or tested until you seed it, and what that takes depends entirely
  on your repos. The steps below are what mine (`symmetryclassic` / `esg-ng-core-linux`) need,
  given as an illustration of the pattern rather than as instructions to follow literally. When the
  ticket will need building or sim-testing, wire up the equivalent for the repos it touches:
  1. **codejock symlink** — `<TICKET>\codejock` → `C:\repos\codejock` (classic MFC `.vcxproj`
     references CodeJock as a sibling of the checkout root; needs Developer Mode / elevation).
  2. **classic `bin\debug` seed** — robocopy `/XO` `C:\repos\symmetryclassic\Source\bin\debug` →
     the classic worktree's `Source\bin\debug`, so `sym start` runs without a full classic build.
  3. **`INSTALL` seed** — robocopy `/XO` `C:\repos\INSTALL` → `C:\repos\ticket-work\<TICKET>\INSTALL`.
     **Required for docker-sim testing:** the sims now *bind-mount* the worktree's build outputs
     (they no longer bake a WSL image), so an unseeded worktree cannot spin sims.
  4. **`.sym-target`** — set to `<TICKET>` so `symmetry.world` `just` build/run/log recipes act on
     this worktree.
  Seed sources must be built first (main classic + main esg). For a **fresh** setup,
  `just mk-worktree <ticket> <slug> --repos classic=<base>,core=<base>` in `symmetry.world` does all
  four plus the worktrees in one step. It needs a console — it still prompts for which build to seed
  from — so with no TTY, or when the worktrees already exist (created by `mk-worktree.mjs`),
  apply 1–4 directly instead; robocopy `/XO` is additive and never regresses a worktree's own
  freshly-built binaries.

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
| "I'll commit/push so it's ready when they're back." | Commit, push, and PR are the user's explicit call, never a default. |

## Red Flags — STOP and re-check

- About to make more than a mechanical edit yourself.
- About to accept "tests pass" or "N files changed" without running or `git status`-ing yourself.
- About to dispatch a third variation after a corrective attempt failed.
- About to send the advisor a question without Evidence and Attempts.
- Consulting the advisor on something the engineer has not tried.
- Two engineers about to touch the same file.
- Asking the implementing engineer to review its own diff.
- About to commit, push, or transition to a done-ish status without the user asking.
- About to run `git worktree add` by hand instead of `mk-worktree.mjs`.

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
