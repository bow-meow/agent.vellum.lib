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

### `pr-respond`
Works through reviewer comments on a Bitbucket PR you authored: clusters them by blast radius,
investigates, fixes, and replies. Bitbucket only — not GitHub.

Needs `BITBUCKET_USERNAME` (your Atlassian email) and `BITBUCKET_PASSWORD` (a scoped API token with
`read:repository`, `read:pullrequest`, `write:pullrequest`) in your environment.

**Recommended companion:** `code-comments`. This skill invokes it before writing any comment. It
works without it, but installing both is better.

### `ticket-quest`
Runs assigned Jira tickets end to end: an isolated git worktree per ticket, an agent that
investigates and drafts a fix plan, peer review until the plan holds up, then a human approval gate
before any code is written.

Shaped around my own setup — worktree root, branch prefix, and the worktree build-seeding steps are
conventions you will want to change. The skill flags each one.

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
