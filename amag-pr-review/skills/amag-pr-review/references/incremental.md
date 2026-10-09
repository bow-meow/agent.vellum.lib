# Incremental scope (PR mode)

Read from SKILL.md step 2 when `state-prev.json` is not `null`, or when it is `null` but
`comments-ours.json` has top-level comments.

- Previous findings = state findings with `status` `open` or `pending` only; `fixed` ones are done.
- **Resolved or deleted threads**: a previous finding whose comment isn't in `comments-ours.json`
  (deleted), or is there with `resolved: true` and either a `resolvedBy` that is neither `AUTHOR_ID`
  nor `null` (a reviewer or I resolved it; we only resolve our own when `fixed`, which state already
  records) or a severity below Medium (the author declining a suggestion is their call), is
  **closed**: not blocking, not re-reviewed, listed in the terminal as "closed by a human".
- **High/Medium resolved by the author** (`resolvedBy` is `AUTHOR_ID`, or `null` because Bitbucket
  didn't say who): not closed. Resolving is not fixing, and the author would otherwise clear their
  own blockers. Mark it `authorResolved` and treat it like any other open previous finding below.
- For each remaining previous finding with a `fingerprint`, locate it at head:
  `node $S/scripts/state.mjs locate "$WT/<path>" <fingerprint> <line>` → `{line}`. A line back means
  the code is unchanged (possibly moved): mark it `unchanged` at that line. `null` means the code
  changed: it goes to `$W/previous-changed.json` (comment id, parentId, path, old line, severity) for
  the verify agent. Findings on old-side lines (no fingerprint) also go there.
- Write every open previous finding (comment id, parentId, path, line, severity) to
  `$W/ours-previous.json` so verify can match fresh candidates against them.
- Review scope: if `git -C $WT merge-base --is-ancestor <reviewedCommit> HEAD` succeeds, review
  only PR files in `git -C $WT diff --name-only <reviewedCommit> HEAD` (regenerate
  `git -C $WT diff -U40 $MB HEAD -- <those files> > $W/context.diff`; empty → skip step 5 and go
  straight to previous-finding handling). If it fails (the branch was rebased or force-pushed), review
  the whole PR diff; the fingerprints above still keep unchanged findings from being re-posted, and
  verify's `ours-previous` match covers the rest. Say "rebased: full re-review" in the terminal.
- No state file but `comments-ours.json` has top-level comments (`parent == null`; our "Fixed in" and
  "Still applies" replies are not findings): treat those as previous findings without fingerprints, so
  all of them go to `previous-changed.json`, and review the whole PR diff. Best effort; say so in the
  terminal.
