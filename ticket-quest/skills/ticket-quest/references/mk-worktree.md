# mk-worktree.mjs

Read before creating a ticket's worktrees with the bundled script. Make one call once the repos, a base
per repo and the slug are confirmed (path relative to the skill's directory):

```
node scripts/mk-worktree.mjs <TICKET> <slug> --repo <clone>[=<base>] [--repo ...]
     [--root C:\repos\ticket-work] [--prefix akt] [--dry-run]
```

- **Layout:** `<root>\<TICKET>\<basename of clone>` per repo
  (e.g. `C:\repos\ticket-work\SYM-9713\esg-ng-core-linux`); `<TICKET>` must match
  `^[A-Z][A-Z0-9]+-\d+$`. **Branch:** `<prefix>/<TICKET>_<slug>` in every repo, `--no-track`.
  `<prefix>` is your initials or handle (default `akt`). Derive the slug from the ticket summary
  and **confirm it** with the user first.
- **Base:** pass the confirmed base for every repo (see the skill's Base defaults). Omitted, it falls
  back to the clone's `origin/HEAD`, which is wrong for any repo whose default says to ask.
- `--dry-run` prints the plan without creating anything; show it to the user when the set is
  non-obvious. Read the worktree paths from the JSON summary on the last stdout line.
- **Exit codes:** `0` created · `1` bad arguments or a base that won't resolve, nothing was
  created · `2` git failed part-way, already rolled back: fix the cause and re-run ·
  `3` the ticket dir or branch **already exists**: surface it and let the user choose build-on vs
  start-fresh. Never clobber, and never delete the existing one yourself to get past a `3`.
