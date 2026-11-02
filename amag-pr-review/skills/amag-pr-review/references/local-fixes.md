# Local mode: applying fixes

The fixes go into the ticket worktree and are **never committed**. Cleanup removed `$W` and its
`env.sh`, so set them again: `W=/c/repos/ai-review/.work/local-<TICKET>; mkdir -p $W`,
`F=<ticket folder>/review-findings.json`, and take each repo's path `R` from that file's `repos`
list. One finding at a time:

```bash
SNAP=$(node $S/scripts/local-findings.mjs snapshot $R)
# apply this finding's fix, then:
node $S/scripts/local-findings.mjs record-fix $F <n> $R $SNAP <repo-relative files it touched>
```

`record-fix` stores the fix's own diff on the finding, without the user's uncommitted work, so a later
review can tell code we wrote from code the author wrote. It exits 1 if the fix changed nothing.
Run the repo's quick checks if obvious (build of the touched project).

Then review the fixes before showing them:

```bash
node $S/scripts/local-findings.mjs fix-diff $F <n...> > $W/fixes.md
node $S/scripts/dispatch.mjs fix-review $W --findings $F <files the fixes touched>   # → {promptFile, outFile}
```

Dispatch one `pr-review-reader` with that prompt. For each `defect` or `incomplete` in `outFile`:
rework that fix, `record-fix` it again against the snapshot in its `fix.snapshot` (the record is
replaced), and review the reworked fixes once more. Show each verdict that isn't `ok` next to its
finding, with what changed or why it stands.

Last, set each fixed finding's `state` to `fixed` and its `resolution` to a one-line what-changed
(Edit tool; leave the `fix` record as it is).
