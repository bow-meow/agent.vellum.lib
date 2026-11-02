# As each reviewer finishes

Read from SKILL.md step 5, before step 6. `<agent>` and `<usageKey>` come from `dispatch.mjs reviewers`.

Chunks are kept small on purpose: a reviewer checks every unit of its diff (the coverage ledger),
and 800 changed lines is about what one agent traces in full. A later run over a few fixes reads its
small diff closely; the first pass has to read every chunk the same way.

**Tokens**: `node $S/scripts/dispatch.mjs usage $W <usageKey> <n>` with the `<subagent_tokens>` from
its completion notification, for every agent including retries, verify and recheck.

**Failure**: a reviewer that errors or writes no file: re-dispatch once. A second failure →
`node $S/scripts/dispatch.mjs failed $W <agent>` (uncovered, holds approval).

**Coverage**: `node $S/scripts/dispatch.mjs coverage $W <agent>`.
- `ok: true` → done.
- `ok: false` → `SendMessage` that same agent the `missing` ranges, telling it to check those units the
  same way and add their candidates and ledger entries to its two files; then run `coverage` again.
- `uncovered: true` → list the ranges in the terminal; the script has recorded it.

Never write ledger entries yourself.

**Repo requests**, once coverage is done (and once for verify when it finishes):
`node $S/scripts/dispatch.mjs needs $W` → `{added, asks, skipped, reposLines, agentsToNotify}`.
- `asks`: the branch can't be worked out. One AskUserQuestion for all of them, one question per repo:
  the repo, its `why`, the agents' questions, and its `options` (in the order given) plus "Skip". A
  pick → `dispatch.mjs needs-answer $W <repo> <ref>`; Skip → nothing. Asking posts nothing, so it
  happens on `--dry-run` too.
- `skipped`: list on the terminal's Other repos line, quoting the agents' questions.
- `agentsToNotify`: `SendMessage` each one the `reposLines` and "answer the question you wrote with
  this code; update your candidates, ledger or output file, and write no new requests". A finding
  whose request was skipped keeps its "Not confirmed" line.
