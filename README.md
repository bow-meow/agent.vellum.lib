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

**Recommended companions:** `code-comments`, which it invokes before writing any comment;
`amag-pr-review`, which local mode and the retro step depend on; and `ticket-quest`, whose
engineering guidelines (risk-based testing among them) every fix follows.

Both this and `ticket-quest` write up a reusable technique the work turned up as a short, generic
article, when `C:\repos\articles\WRITING.md` exists; that file holds the rules and the site's build
script refuses duplicates.

### `ticket-quest`
Runs assigned Jira tickets end to end, routing each task to the cheapest model that can do it: a
Sonnet orchestrator that owns the plan and verifies every claim, a Haiku scout for targeted
exploration and running builds and tests, a Sonnet engineer that does the building in an isolated
git worktree per ticket (Opus for architectural, shared-code, hard-to-diagnose and security-sensitive
changes), and a Fable advisor consulted only for architecture, hard diagnosis, or after two failed
attempts. No human gate before implementation unless you ask it to quiz you: then a scan agent
maps the code first, and you answer the approach decisions it leaves open before anything is
built. Commit and push stay on your say-so.

Every ticket also adds or updates a test in a regression suite kept beside the worktrees. How those
tests are written, run and shown failing is a second skill in the plugin,
`symmetry-regression-tests`, which also loads on its own when you ask for a regression test or a
run. It assumes a suite laid out like mine (`_regression\` with its own README, runner and setup
steps).

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

### `visual-inspection`
Looks at screenshots and screen recordings without paying to send whole images to the model. A
Node helper compares before/after screenshots locally, crops each changed region into a
before | after strip, samples a recording into one contact sheet, and finds scene changes or
stretches where the picture stays still. The skill then views only those crops, within a default
budget of one overview and two detail images.

Needs Node 18+ and ImageMagick 7 (`magick`); video also needs FFmpeg and ffprobe. Run the helper's
`doctor` command to check what it found. It does not capture the screen itself.

### `grilling`
Interviews you about a plan, decision or idea until nothing is left assumed. It maps the decisions
as a tree and asks every question it can answer the prerequisites for in one round, each with a
recommended answer, looking up facts itself rather than asking you for them. Copied unchanged from
[Matt Pocock's skills](https://github.com/mattpocock/skills). MIT licensed.

### `domain-modeling`
Keeps a project's vocabulary and decisions written down while you design. It challenges terms
that are vague or that conflict with `GLOSSARY.md`, tests them against invented edge cases and the
code, updates the glossary as each term is settled, and offers an ADR only for decisions that are
hard to reverse, surprising, and the result of a real trade-off. Copied unchanged from
[Matt Pocock's skills](https://github.com/mattpocock/skills). MIT licensed.

### `grill-with-docs`
Starts `grilling` and `domain-modeling` together, so the interview also leaves a glossary and ADRs
behind. Run it with `/grill-with-docs`; it never loads on its own. Needs both of those plugins
installed. From [Matt Pocock's skills](https://github.com/mattpocock/skills), with the two skills it
loads renamed to their plugin names. MIT licensed.

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
