# Context scans

Read from SKILL.md step 4. Run both before dispatching reviewers.

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
