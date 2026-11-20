# Build/run conveniences

Read before creating worktrees for a ticket that will need building or sim-testing.
Environment-specific: the five steps below are an example.

A bare worktree often cannot be built or tested until you seed it, and what that takes depends entirely
on your repos. The steps below are what mine (`symmetryclassic` / `esg-ng-core-linux`) need,
given as an illustration of the pattern rather than as instructions to follow literally. When the
ticket will need building or sim-testing, wire up the equivalent for the repos it touches:
1. **codejock symlink** — `<TICKET>\codejock` → `C:\repos\codejock` (classic MFC `.vcxproj`
   references CodeJock as a sibling of the checkout root; needs Developer Mode / elevation).
2. **classic `bin\debug` seed** — robocopy `/XO` from the complete build under
   `C:\repos\symmetry.build` that matches the worktree's base (e.g.
   `C:\repos\symmetry.build\11.1.0\symmetryclassic\Source\bin\debug` for a `release/11.1.0-*` base)
   → the classic worktree's `Source\bin\debug`, so the classic services need no build from source.
   `just seed-sym <build>` in `symmetry.world` does this without prompting. Never seed from
   `C:\repos\symmetryclassic`: its branch and build date drift, so the worktree runs a mix of fresh
   and stale binaries.
3. **`INSTALL` seed** — robocopy `/XO` `C:\repos\INSTALL` → `C:\repos\ticket-work\<TICKET>\INSTALL`.
   **Required for docker-sim testing:** the sims now *bind-mount* the worktree's build outputs
   (they no longer bake a WSL image), so an unseeded worktree cannot spin sims.
4. **`.sym-target` and COM registration** — `just target <TICKET>` sets the target, so `symmetry.world`
   `just` build/run/log recipes act on this worktree, and repoints the classic COM servers at its
   `bin\debug\ANSI`. Without the COM step a started service can come from another worktree or from
   the installed Symmetry in `C:\Program Files (x86)\Security Management System\` (an older version):
   observed, the client warned "version 10.x is not compatible with the database (11.2)" and the
   installed `SymmetryNats.exe` marked the newer NATS roles deleted, failing every integration test.
5. **API build** — `just build-sym debug` once seeded, so `SymmetryApi.Server` and the dashboard are the
   worktree's own code, not the seed's.

**Before trusting any run** (integration tests, TAS, a manual repro): after `just sym start`, list the
running Symmetry processes' paths (`Get-CimInstance Win32_Process`, `ExecutablePath`) and confirm every
one is under this worktree, none under `Program Files` or another ticket dir, and that the client
window shows no version warning. A mixed stack fails in ways that look like the change's fault.

Seed sources must be built first (the matching `symmetry.build` build + main esg). When
`C:\repos\symmetry.world` exists, create the worktrees there with
`just mk-wt <ticket> <slug> --repos classic=<base>[,<other>=<base>...] [--seed <build>]` instead of
`mk-worktree.mjs`: it does steps 1–4 plus the worktrees in one go and needs no console; step 5 and
the check above are still yours. The seed
build is inferred from the classic base; pass `--seed` when no `symmetry.build` build matches it.
It has no `--dry-run` and refuses an existing ticket dir, so show the user the plan first and treat
"already exists" as exit `3` above. Apply 1–5 by hand only when the worktrees already exist, setting
step 4 before step 2 because `seed-sym` follows the active target; robocopy `/XO` is additive and
never regresses a worktree's own freshly-built binaries.
