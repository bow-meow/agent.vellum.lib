# vellum

Claude Code skills, packaged as installable plugins.

```
/plugin marketplace add bow-meow/agent.vellum.lib
/plugin install code-comments@vellum
```

Each skill is its own plugin — install only what you want.

## Skills

### `code-comments`
Comment discipline for any language: what earns a comment, what gets deleted. Use it before a
commit or while fixing PR feedback.

### `humanizer`
Strips AI writing patterns out of prose headed somewhere permanent — PR replies, commit messages,
emails, docs. Based on Wikipedia's "Signs of AI writing". MIT licensed.

### `amag-pr-respond`
Works through review feedback on your own work: reviewer comments on a Bitbucket PR you authored,
or the findings a local `amag-pr-review` saved in a ticket folder. Clusters them by blast radius,
investigates, fixes, and replies with a header giving the verdict, model and confidence. Then it
writes each defect the human reviewer caught back into `amag-pr-review`'s checklists, so the next
automated review catches its kind. Bitbucket only, not GitHub.

Needs `BITBUCKET_USERNAME` (your Atlassian email) and `BITBUCKET_PASSWORD` (a scoped API token with
`read:repository`, `read:pullrequest`, `write:pullrequest`) in your environment. Local mode needs
neither.

**Recommended companions:** `code-comments`, which it invokes before writing any comment, and
`amag-pr-review`, which local mode and the retro step depend on.

### `ticket-quest`
Runs assigned Jira tickets end to end on three model roles: a Haiku orchestrator that owns the
plan and verifies every claim, an Opus engineer that does the building in an isolated git worktree
per ticket, and a Fable advisor consulted only for architecture, hard diagnosis, or after two failed
attempts. No human gate before implementation; commit and push stay on your say-so.

Shaped around my own setup — worktree root, branch prefix, and the worktree build-seeding steps are
conventions you will want to change. The skill flags each one.

### `design-tournament`
For a design decision with a genuinely wide solution space: three designers work from deliberately
different stances, three agents that wrote nothing judge the results blind against a rubric fixed
before any design existed, and a synthesis stage grafts the best ideas from the designs that lost
onto the winner.

Costs 7 agents per run, and asks before spending them. Reports "no adequate design" rather than
crowning the least-bad entry.

### `amag-raise-bug`
Raises bug tickets in AMAG's Symmetry Jira from a list of findings. It checks for existing tickets,
verifies every claim against the code, fills the fields the way the team's tickets do, and shows
the drafts before creating anything. The field IDs and version values are AMAG's; outside AMAG it
is only useful as a template.

**Recommended companion:** `humanizer`. This skill writes every ticket through it.

### `amag-pr-review`
Reviews a Bitbucket pull request, or your own ticket worktree under `C:\repos\ticket-work` before
you push. Opus reviewers each take one dimension (correctness, concurrency, SQL, security, tests and
more), a verify pass drops what doesn't hold up, and re-reviewing a PR only looks at the files changed
since the last review. Built around AMAG's Symmetry and Sentinel repos and the `C:\repos` layout.

Needs the same Bitbucket variables as `amag-pr-respond`. If your API token lacks `read:user`, also
set `BITBUCKET_ACCOUNT_ID`.

Not the same plugin as `amag-pr-review` in the AMAG team marketplace, which posts its findings with
no confirmation step. The two share a name, so install only one.

## Layout

```
<plugin>/
  .claude-plugin/plugin.json
  skills/<name>/SKILL.md      (+ scripts/ where a skill needs them)
```

Manifests carry no `version` field. Claude Code uses the git commit SHA as the version, so every
push reaches installers on their next update; a pinned version would freeze the cached copy until
that string changed, and new commits would silently never ship.

## Notes

These are my working skills, published because they may be useful, not because they are
general-purpose products. Some carry conventions from my own setup — where that happens the skill
says so and tells you what to change.
