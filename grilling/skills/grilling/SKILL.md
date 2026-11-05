---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Word each question so "yes" accepts your recommended answer.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent with a fresh context window to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

**Resolve the user's local checkout before exploring.** Work here lives in per-ticket worktrees under `C:\repos\ticket-work`, so a pasted ticket key or PR link names a checkout you must find, never one to clone or read from `main`:

- Ticket key (`SYM-1234`, any case): the folder `C:\repos\ticket-work\<KEY>` (a suffixed sibling like `SYM-1234-j2` is a second worktree for the same ticket). Its git repos are the subfolders holding a `.git`; skip `install`, `build` and symlinks.
- Bitbucket PR URL (`bitbucket.org/<ws>/<repo>/pull-requests/<id>`): read the PR's source branch and ticket key from Bitbucket, then pick the `C:\repos\ticket-work` worktree whose `git -C <dir> branch --show-current` equals it.
- No match: say so and explore read-only from what you can reach. Never create a checkout uninvited, and never stash or discard a dirty worktree.

Point every exploring sub-agent at the resolved path. Ticket folders also hold the user's own plans, handovers and `review-findings.json`; read those before asking the user about intent.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
