# Context scans

Read from SKILL.md step 4. Run all that apply before dispatching reviewers.

- **Packages**: per repo, `node $S/scripts/deps.mjs <worktree> <that repo's diff> $AR/.deps > $W/deps-<repo>.json`.
  It fetches, at the lockfile's version, the npm packages that changed files import from a registry
  other than the public one, so reviewers can read code the model has never seen. An import that
  `tsconfig` `paths` or a workspace link maps into the repo comes back as `local`: its package root
  (source, not the uncommitted `dist` the mapping names), with nothing fetched. It does nothing
  outside npm projects. A record with `error` is not a failure: note it in the terminal and carry on.
- **Newer release branches**: per repo, `git -C <clone> fetch -q origin '+refs/heads/release/*:refs/remotes/origin/release/*'`
  (and `<prefix>/*` for DEST `template/x/1.0.0`),
  then `node $S/scripts/forward-scan.mjs <clone> <that repo's diff> <its DEST> --diffs $W/forward > $W/forward-<repo>.json`.
  It lists widths a newer branch widened that the change keeps narrow, and files it also
  changed (with diff). None → `branches: []`; pass it anyway.
- **Stylesheet facts** (only if `styles` ≥ 1): per repo, after the packages step,
  `node $S/scripts/styles-scan.mjs <worktree> <that repo's diff> <its merge base> [--lib <path>]... > $W/styles-facts-<repo>.json`,
  with one `--lib` per fetched package path. It lists mechanical leads (physical direction properties,
  rules left dead by removed elements or classes, unused classes, repeated blocks, fences and token
  declarations, long comments, `url()` files missing at base or head) for the reviewer to confirm.
