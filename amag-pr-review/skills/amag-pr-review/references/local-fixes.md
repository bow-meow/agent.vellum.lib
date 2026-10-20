# Local mode: applying fixes

The fixes go into the ticket worktree and are **never committed**. Source the local `env.sh` and
`mkdir -p $W` first (cleanup may have removed it). One finding at a time:

```bash
SNAP=$(node $S/scripts/local-findings.mjs snapshot $R_<repo>)
# apply this finding's fix, then:
node $S/scripts/local-findings.mjs record-fix $TICKET_DIR/review-findings.json <n> $R_<repo> $SNAP <repo-relative files it touched>
```

`record-fix` stores the fix's own diff on the finding, without the user's uncommitted work, so a later
review can tell code we wrote from code the author wrote. It exits 1 if the fix changed nothing.
Run the repo's quick checks if obvious (build of the touched project).

Then review the fixes before showing them:

```bash
node $S/scripts/local-findings.mjs fix-diff $TICKET_DIR/review-findings.json <n...> > $W/fixes.md
```

Dispatch one `pr-review-reader` with [prompts/fix-review.md](prompts/fix-review.md):
`FIXES_FILE` = `$W/fixes.md`, `CHECKLIST_FILES` = `<SKILL_DIR>/references/dimensions/correctness.md` plus the
absolute path of the language file for each touched file, `REPOS` and `SKILL_DIR` as in SKILL.md step 5, `OUT_FILE` = `$W/fix-review.json`.
For each `defect` or `incomplete`: rework that fix, `record-fix` it again against the snapshot in its
`fix.snapshot` (the record is replaced), and review the reworked fixes once more. Show each verdict
that isn't `ok` next to its finding, with what changed or why it stands.

Last, set each fixed finding's `state` to `fixed` and its `resolution` to a one-line what-changed
(Edit tool; leave the `fix` record as it is).
