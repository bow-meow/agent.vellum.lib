# Build/run conveniences

Read before creating worktrees for a ticket that will need building or sim-testing.
Environment-specific: the four steps below are an example.

A bare worktree often cannot be built or tested until you seed it, and what that takes depends entirely
on your repos. The steps below are what mine (`symmetryclassic` / `esg-ng-core-linux`) need,
given as an illustration of the pattern rather than as instructions to follow literally. When the
ticket will need building or sim-testing, wire up the equivalent for the repos it touches:
1. **codejock symlink** — `<TICKET>\codejock` → `C:\repos\codejock` (classic MFC `.vcxproj`
   references CodeJock as a sibling of the checkout root; needs Developer Mode / elevation).
2. **classic `bin\debug` seed** — robocopy `/XO` from the complete build under
   `C:\repos\symmetry.build` that matches the worktree's base (e.g.
   `C:\repos\symmetry.build\11.1.0\symmetryclassic\Source\bin\debug` for a `release/11.1.0-*` base)
   → the classic worktree's `Source\bin\debug`, so `sym start` runs without a full classic build.
   `just seed-sym <build>` in `symmetry.world` does this without prompting. Never seed from
   `C:\repos\symmetryclassic`: its branch and build date drift, so the worktree runs a mix of fresh
   and stale binaries.
3. **`INSTALL` seed** — robocopy `/XO` `C:\repos\INSTALL` → `C:\repos\ticket-work\<TICKET>\INSTALL`.
   **Required for docker-sim testing:** the sims now *bind-mount* the worktree's build outputs
   (they no longer bake a WSL image), so an unseeded worktree cannot spin sims.
4. **`.sym-target`** — set to `<TICKET>` so `symmetry.world` `just` build/run/log recipes act on
   this worktree.
Seed sources must be built first (the matching `symmetry.build` build + main esg). When
`C:\repos\symmetry.world` exists, create the worktrees there with
`just mk-worktree <ticket> <slug> --repos classic=<base>[,<other>=<base>...] [--seed <build>]` instead of
`mk-worktree.mjs`: it does all four steps plus the worktrees in one go and needs no console. The seed
build is inferred from the classic base; pass `--seed` when no `symmetry.build` build matches it.
It has no `--dry-run` and refuses an existing ticket dir, so show the user the plan first and treat
"already exists" as exit `3` above. Apply 1–4 by hand only when the worktrees already exist, setting
step 4 before step 2 because `seed-sym` follows the active target; robocopy `/XO` is additive and
never regresses a worktree's own freshly-built binaries.
