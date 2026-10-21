# Incremental scope (PR mode)

Read from SKILL.md step 2 when `state-prev.json` is not `null`, or when it is `null` but
`comments-ours.json` has top-level comments.

- Previous findings = state findings with `status` `open` or `pending` only; `fixed` ones are done.
- **Resolved or deleted threads**: a previous finding whose comment isn't in `comments-ours.json`
  (deleted), or is there with `resolved: true` and a `resolvedBy` that is neither `AUTHOR_ID` nor
  `null` (a reviewer or I resolved it; we only resolve our own when `fixed` or conceded, which state
  already records), is **closed**: not blocking, not re-reviewed, listed in the terminal as "closed
  by a human". So is a resolved Info finding, whoever resolved it: a note asks for nothing.
- **Low or Low/nit the author replied to** (`authorReplied: true`, resolved or not): **closed**. The
  reply is their reason for leaving it, and declining a Low with a reason is their call. Listed in
  the terminal as "closed by the author with a reply", and not saved in state, like any closed one.
- **Resolved by the author** (`resolvedBy` is `AUTHOR_ID`, or `null` because Bitbucket didn't say
  who) and not closed above: a Low or Low/nit with no reply, or any High/Medium. Resolving is not
  fixing, and the author would otherwise clear their own findings, so it isn't closed. Mark it
  `authorResolved` and treat it like any other open previous finding below. When a Low or Low/nit one
  is reopened, its follow-up is `comment.mjs followup needs-reply`, which tells the author that a reply
  with their reason closes it.
- **Push-back on a High/Medium**: its `authorReplies` in `comments-ours.json` with an id above the
  state's `pushbackSeen` (0 when absent) are new. Copy those into its re-check entry below; verify
  judges them. Older ones were already settled with the user on an earlier run.
- Every remaining previous finding is re-checked by verify, whether its code changed or not: a fix
  can land elsewhere (a guard in a caller, a config default). For each one with a `fingerprint`,
  locate it at head: `node $S/scripts/state.mjs locate "$WT/<path>" <fingerprint> <line>` → `{line}`.
  A line back means the code is unchanged, possibly moved: `codeChanged: false` at that line. `null`
  means it changed: `codeChanged: true` at the old line. Findings on old-side lines (no fingerprint)
  are `codeChanged: true`. Write them all to `$W/previous-recheck.json` (comment id, parentId, path,
  line, severity, `codeChanged`, `authorResolved`, and `authorReplies` from the bullet above, else `[]`).
- Write the previous state's `dropped` list (candidates an earlier verify rejected, with its reason)
  to `$W/dropped-previous.json`, if it has one.
- Write every open previous finding (comment id, parentId, path, line, severity) to
  `$W/ours-previous.json` so verify can match fresh candidates against them.
- **Review scope**: the reviewers see only the PR's hunks that changed since the last review. Code
  we already reviewed and didn't flag isn't reviewed again; code we flagged is covered by the
  re-check above. This works after a merge from the base branch, a rebase or a force-push, as long
  as `reviewedCommit` still exists locally (`git -C $WT cat-file -e <reviewedCommit>^{commit}`; an
  earlier fetch into `$AR/$REPO` usually kept it):

  ```bash
  git -C $WT diff -U3 $MB HEAD > $W/pr-u3.diff
  node $S/scripts/sql-index-map.mjs text-diff $WT $W/pr-u3.diff $MB HEAD >> $W/pr-u3.diff
  git -C $WT diff -U0 <reviewedCommit> HEAD > $W/since.diff
  node $S/scripts/sql-index-map.mjs text-diff $WT $W/since.diff <reviewedCommit> HEAD >> $W/since.diff
  node $S/scripts/delta.mjs filter $W/pr-u3.diff $W/since.diff > $W/context.diff
  ```

  Its stderr lists the kept hunks per file: show them in the terminal. Empty `context.diff` → skip
  step 5 and go straight to verify for the re-check. Set `MODE` to `PR mode (#<id>: <title>),
  re-review: the diff holds only what changed since the last review; read around it in the worktree`.
  `reviewedCommit` missing locally → review the whole PR diff and say "last reviewed commit gone:
  full re-review" in the terminal.
- No state file but `comments-ours.json` has top-level comments (`parent == null`; our "Fixed in" and
  "Still applies" replies are not findings): treat those as previous findings without fingerprints, so
  all of them go to `previous-recheck.json` with `codeChanged: true`, and review the whole PR diff.
  Best effort; say so in the terminal.
