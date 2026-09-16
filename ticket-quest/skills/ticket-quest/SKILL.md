---
name: ticket-quest
description: >-
  Use when taking one or more assigned Jira tickets from investigation through to implementation — a single issue or a whole backlog batch, each worked in its own git worktree. Triggers — "run ticket-quest", "work this ticket", "take my assigned tickets", "work my backlog", or being handed one or more `PROJ-####` issues to implement. SKIP for: a Jira question with no code to write, or a trivial change you would just make directly.
---

# ticket-quest — Jira tickets to a reviewed, approved implementation

Run 1..N assigned Jira tickets end to end: an isolated git worktree per ticket, a dedicated agent
that investigates and drafts a fix plan, **independent peer review until the plan holds up**, a
**human plan-approval gate**, then implement + verify — and commit only when the user says so. The
same disciplines apply whether you are handed one ticket or ten; with one you simply run one lane.

**Core principle (why this skill exists):** a lone capable agent reasons fine — it will refute a bad
theory and find the right build tool on its own. What sinks this work is **coordination and
over-confidence**: no independent challenge to a confident-but-unconfirmed conclusion, committing to
a fix for a bug never actually confirmed, trusting a sub-agent's self-report, and asserting limits
never tested. This skill is the **orchestrator's** disciplines for exactly those.

## When to use

- One or more Jira issues (`PROJ-####`) to take from investigation to a reviewable plan
  the user approves before any code is written.
- SKIP for a Jira question with no code, or a trivial change already scoped — just make it.

## Workflow

You (the main session) are the **orchestrator**. Dispatch sub-agents; do not do the per-ticket
investigation yourself.

1. **Scope.** Read the ticket(s) (description + comments). For each ticket, confirm **which repos it
   touches** — a ticket may span more than one (a service repo plus a companion/firmware repo); don't
   assume a single repo. Confirm the **base ref per repo** (see [Base defaults](#base-defaults)) and
   derive + confirm the branch **slug**.
2. **Isolate — one git worktree per repo per ticket** (see [Worktree mechanics](#worktree-mechanics)).
   Detect a pre-existing ticket dir/branch and ask **build-on vs start-fresh** rather than clobbering.
3. **Investigate + draft (one agent per ticket, parallel for N).** Each agent: reads the ticket;
   moves it to In Development; sets a Jira estimate from the scope it finds; does a **full**
   investigation (root cause, exact files/lines); writes the plan file (see
   [Plan & gate](#plan-file--human-gate-contract)) with an explicit **"Files to change"** list.
4. **Peer-review to consensus.** For each draft, dispatch **2 independent reviewers** given the plan
   *and* the real files it names, each with a distinct lens (root-cause correctness;
   completeness/regression/scope). They return APPROVE or CHANGES-REQUESTED with file-anchored
   specifics. If either wants changes, the ticket agent revises and you re-review. Loop until **both
   approve**, capped at ~3 rounds; if it doesn't converge, surface the disagreement to the user — do
   not force it.
5. **Human review gate.** Open the approved plan in the user's editor, then **immediately start the
   review watcher in the background before you present the gate**. **Peer-review consensus is NOT this
   gate** — both reviewers approving is what lets the plan *reach* the user; it does not authorize
   building. The only thing that unblocks implementation is the **user's own decision, typed below the
   plan's marker**: `IMPLEMENT`/`APPROVED` (the user's word — never a reviewer's verdict) → build it;
   anything else → treat as change requests, revise, reopen, **clear the old decision text**, and
   **re-arm the watcher**. Independent tickets reach this gate at different times.
6. **Implement + verify for real.** The ticket agent applies the plan on its branch. Verify the
   build/tests **for real** in the correct environment (see [Non-negotiables](#non-negotiables)).
   Revert any regenerated artifacts (SDKs, generated code) so the diff is only the real change. Then
   **you** independently confirm each worktree's `git status`.
7. **Close out honestly.** Move tickets and log time only to match reality. Commit/push/PR only on
   explicit user say-so.

## Worktree mechanics

Create worktrees **generically, per involved repo** — this skill does not depend on any external
worktree tool.

- **Layout:** `<WORKTREE_ROOT>\<TICKET>\<repo>` per repo the ticket touches, where
  `<WORKTREE_ROOT>` defaults to `C:\repos\ticket-work`
  (e.g. `C:\repos\ticket-work\SYM-9713\esg-ng-core-linux`). `<TICKET>` is a Jira key, matching
  `^[A-Z][A-Z0-9]+-\d+$`.
- **Branch:** `<PREFIX>/<ticket>_<slug>`, where `<PREFIX>` is your initials or handle (default:
  `akt`). Derive the slug from the ticket summary and **confirm it** with the user before branching.
- **Create (per repo):**
  1. `git -C <clone> fetch`
  2. `git -C <clone> worktree add --no-track -b akt/<ticket>_<slug> <path> <base>`
  - On a partial multi-repo failure, roll back the worktrees/branches already created this run
    (`git worktree remove --force`, `git worktree prune`, `git branch -D`), and remove the ticket dir
    if it ends up empty — so a fixed re-run isn't blocked by leftovers.
- **Pre-existing** ticket dir or branch: surface it and let the user choose build-on vs start-fresh.
  Never clobber.
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
  `just mk-worktree <ticket> <slug> <classic_base> <core_base>` in `symmetry.world` does all four
  plus the worktrees in one step; when the worktrees already exist (created via the generic steps
  above), apply 1–4 to them directly — robocopy `/XO` is additive and never regresses a worktree's
  own freshly-built binaries.

### Base defaults

Per repo, offer the default below or let the user pick another. **Verify the chosen ref exists**
(`git -C <clone> rev-parse --verify <base>`) before branching. If the user picks a **non-default**
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

## Plan file & human-gate contract

- **Plan path:** `C:\repos\ticket-work\<TICKET>\<TICKET>.plan.md` — inside the ticket dir but
  **outside every repo subdir**, so it is never committed.
- **Marker footer (exact)** — end every plan file with this line and an empty section below it:

  `================ YOUR REVIEW (type below this line, then save) ================`

- **Open the plan:** `code --reuse-window "<ticket-dir>" "<plan-file>"` (exit 0 = opened). Any editor
  works; the watcher is editor-agnostic. If `code` is unavailable, ask the user to open the file.
- **Watch — YOU MUST run the bundled watcher, not eyeball the file.** After opening the plan, start
  this in the **background** (it exits the moment a decision appears, so the harness notifies you
  instead of you polling or waiting to be pinged):

  `node scripts/watch-plan-reviews.mjs "<ticket-dir>" --files <TICKET>`

  (resolve `scripts/watch-plan-reviews.mjs` against this skill's own directory). It treats any
  non-empty text below the marker as the decision; exits as soon as that text **changes** from
  startup; and prints each watched plan as `DECIDED` (verbatim text) or `PENDING`, plus one
  `JSON {...}` line for reliable parsing. Route each `DECIDED` plan to its ticket agent, then re-arm
  the watcher for any still `PENDING`.
- **Reopen nuance:** on a revise after change-requests, **clear/replace the old decision text under
  the marker** before re-arming — the watcher fires on a *change* from baseline, so re-saving the
  same word would not trip it.
- For N tickets, run one watcher per ticket dir; each exits and notifies independently.

## Non-negotiables

These are the disciplines baseline agents actually violated. Each is here because it was observed,
not imagined. **Violating the letter of a non-negotiable is violating its spirit.**

- **Independent review, not self-review.** A confident conclusion from one agent gets challenged by
  ≥2 *independent* reviewers before it reaches the user. The whole value is the second opinion that
  asks "are you sure it's this and not that?"
- **Do not commit to an unverifiable root cause.** For an intermittent / hardware-only bug that has
  already failed QA, go **logging-first**: ship diagnostic instrumentation, reproduce, read the logs,
  *then* fix. A reproduction you authored proves your hypothesis is *fixable* — not that it is the bug
  the field actually hits.
- **Verify for real; never assert an untested limitation.** "It can't build/test here" is a claim to
  *test*, not state. A component may build in a **different environment than the host** (e.g. a Linux
  service or firmware that builds in WSL). A full build can regenerate **generated artifacts** (e.g.
  SDKs); revert those so the committed diff is only your real change.
- **Independently verify each worktree — don't trust a sub-agent's self-report.** After an agent
  implements, run `git status`/`git diff --stat` in that worktree **yourself**. In practice an agent
  reported "1 file changed" while the tree had 33 (a build had regenerated SDKs). The agent's file
  count is a lead, not a fact.
- **Honest state.** Don't move a logging-only or partial deliverable to a status that signals "fixed"
  (it misleads QA). Set Jira estimates/worklogs to reflect real scope and real time. Commit/push is
  the user's call, not a default.

## Rationalizations — STOP if you catch yourself here

| Excuse | Reality |
|---|---|
| "The cause is obviously X, let me write the fix." | On a bug that already failed QA, confirm X first. Obvious-but-unconfirmed is how the third QA failure happens. |
| "My unit test reproduces it, so it's fixed." | Your test reproduces *your hypothesis*, not necessarily the field bug. |
| "This can't be built/tested in this environment." | Did you try its *real* build environment (e.g. WSL for a Linux component)? Test the claim before stating it. |
| "The agent said it changed N files." | Did *you* `git status` the worktree? The self-report is a lead, not a fact. |
| "Both reviewers approved, so the decision exists — I'll skip the watcher and build." | Reviewer consensus lets the plan *reach* the user; it is not the user's decision. Start the watcher and wait. |
| "It's just one ticket, I'll investigate inline and skip the reviewers." | One ticket still gets a sub-agent and ≥2 independent reviewers — the over-confidence failure is per-ticket, not per-batch. |
| "I'll commit/push so it's ready." | Commit/push/PR is the user's explicit call, never a default. |

## Red flags — STOP and re-check

- "The cause is obviously X, let me write the fix" — on a bug that already failed QA.
- "My unit test reproduces it, so it's fixed."
- "This can't be built/tested in this environment" — before trying its real build env.
- "The agent said it changed N files" — before you `git status` the worktree yourself.
- About to open a plan to the user without a second independent reviewer having seen it.
- About to present the plan at the gate without having started the watcher in the background.
- "Both reviewers approved, so I'll build" — reviewer APPROVE is not the human `APPROVED`.
- About to `commit`/`push`/transition-to-done without the user asking.
- About to base a branch on a ref without confirming it exists.

## Anti-patterns

- Doing the per-ticket investigation in the main session instead of one agent per ticket (context bloat).
- Showing the user a plan no independent reviewer challenged.
- One giant plan for all tickets — each ticket is its own worktree, plan, and review loop.
- Assuming the base branch, the repo set, or a build environment's limits instead of asking or testing.
- Committing/pushing/PR-ing, or flipping a ticket to a done-ish status, without the user's explicit go.
