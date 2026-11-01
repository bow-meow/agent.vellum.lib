# Base defaults

Per repo, offer the default below or let the user pick another; `mk-worktree.mjs` refuses a base
that doesn't resolve. If the user picks a **non-default** base, ask whether to **persist it as the
new default**: on yes, edit the table below.

<!-- BASE-DEFAULTS: edit this table when the user asks to change a repo's default base -->

| Repo | Default base |
|---|---|
| `esg-ng-core-linux` | `origin/main` |
| `symmetryclassic` | **List the live `release/*` branches and let the user pick**: read [release-bases.md](release-bases.md) for how; never hardcode one |
| any other repo | `origin/HEAD` (ask) |
