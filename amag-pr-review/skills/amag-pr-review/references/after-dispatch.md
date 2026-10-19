# As each reviewer finishes

Read from SKILL.md step 5, before step 6.

Chunks are kept small on purpose: a reviewer checks every unit of its diff (the coverage ledger
below), and 800 changed lines is about what one agent traces in full. A later run over a few fixes
reads its small diff closely; the first pass has to read every chunk the same way.

A reviewer that errors or writes no file: re-dispatch once. A second failure → record the dimension as
**uncovered** (blocks approval).

**Coverage check**, as each reviewer finishes (all but ticket-fit and styles):
`node $S/scripts/coverage.mjs check <its DIFF_FILE> $W/cov-<name>.json` (docs adds
`--only '\.(md|markdown|txt|rst|adoc|resx)$'`: its ledger covers the prose files). Exit 0 → done.
Exit 1 → `SendMessage` that same agent the `missing` ranges, telling it to check those units the same
way and add their candidates and ledger entries to its two files; then check again. After two rounds,
what is still missing is **uncovered** for that dimension: list the ranges in the terminal and hold
approval, as for a failed reviewer. Never write ledger entries yourself.

**Token usage**: each agent's completion notification carries `<subagent_tokens>`. Keep
`$W/usage.json` as `{"<reviewer>": tokens, ..., "verify": tokens}` (Write tool), keyed by the reviewer
name that prefixes its candidate ids; chunked runs and retries add to the same key.
