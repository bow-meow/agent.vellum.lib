# Release bases for `symmetryclassic`

Read when confirming the base for a `symmetryclassic` worktree.

`esg-ng-core-linux` has only `origin/main` (no `master`), so it has a fixed default.
`symmetryclassic` releases from a moving set of `release/*` branches (one per version line), so
there is no single stable default: enumerate them and let the user choose.

**Do NOT hardcode a base.** After `git -C <clone> fetch`, list the current non-backup release
branches and present the relevant version lines as options:

```
git -C <clone> branch -r | grep -E 'origin/release/' | grep -v backup | sort
```

Filter out the old `9.x`/`10.x` lines unless the ticket clearly targets them; offer the current
major/minor lines (e.g. the `11.x` branches) as the picks. Bias the recommendation using the
ticket's **parent epic version** when it names one (e.g. a v11.1 epic → `release/11.1.0-*`).
