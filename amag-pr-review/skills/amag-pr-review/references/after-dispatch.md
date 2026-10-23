# As each reviewer finishes

Read from SKILL.md step 5, before step 6.

Chunks are kept small on purpose: a reviewer checks every unit of its diff (the coverage ledger
below), and 800 changed lines is about what one agent traces in full. A later run over a few fixes
reads its small diff closely; the first pass has to read every chunk the same way.

A reviewer that errors or writes no file: re-dispatch once. A second failure → record the dimension as
**uncovered** (blocks approval).

**Coverage check**, as each reviewer finishes (all but ticket-fit, claims and styles):
`node $S/scripts/coverage.mjs check <its DIFF_FILE> $W/cov-<name>.json` (docs adds
`--only '\.(md|markdown|txt|rst|adoc|resx)$'`: its ledger covers the prose files). Exit 0 → done.
Exit 1 → `SendMessage` that same agent the `missing` ranges, telling it to check those units the same
way and add their candidates and ledger entries to its two files; then check again. After two rounds,
what is still missing is **uncovered** for that dimension: list the ranges in the terminal and hold
approval, as for a failed reviewer. Never write ledger entries yourself.

**Repo requests**, once the coverage check passes (and once for verify when it finishes): if any
`$W/needs-*.json` exists, run `node $S/scripts/xrepo.mjs needs $W --dest <DEST> --have <slugs>`
(`--dest`: `$DEST` in PR mode; in local mode the symmetryclassic repo's `DEST_<name>`, or leave it out,
which makes `same-as-dest` repos ask). Rename each handled needs file to `needs-<agent>.done.json` so the
next agent's call doesn't repeat it. Per request, by `kind`:
- a `ref` (`release-match`, `rule`): `xrepo.mjs add $W <slug> <ref> <kind> --why "asked by <agents>"`.
  The agents' questions are their output, so they never go on the command line; the terminal line
  quotes them from the `needs` output instead.
- `ask`: the branch can't be worked out. Ask the user, one AskUserQuestion for all `ask` requests in this
  round, one question per repo: the repo, its `why`, the agents' questions, and up to three of its
  `options` (in the order given) plus "Skip". The pick → `add` with kind `user-picked`; Skip → nothing.
  Asking posts nothing, so it happens on `--dry-run` too.
- `over-cap`, `error`, and everything under `rejected`: no worktree. List them on the terminal's
  Other repos line.

Then `SendMessage` each agent whose request got a worktree: the new `REPOS` lines (`xrepo.mjs repos $W`),
and "answer the question you wrote with this code; update your candidates, ledger or output file, and
write no new requests". One round per agent. A finding whose request was skipped keeps its "Not
confirmed" line.

**Token usage**: each agent's completion notification carries `<subagent_tokens>`. Keep
`$W/usage.json` as `{"<reviewer>": tokens, ..., "verify": tokens}` (Write tool), keyed by the reviewer
name that prefixes its candidate ids; chunked runs and retries add to the same key.
