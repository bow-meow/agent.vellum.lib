# vellum — a personal Claude Code skill marketplace

**Date:** 2026-09-16
**Status:** approved, ready for implementation planning
**Repo:** `agent.vellum.lib` (`github.com/bow-meow/agent.vellum.lib`)

## Context

`agent.vellum.lib` is an empty repo — no files, no commits. Four Claude Code skills
currently live in the `symmetry.world` dotfiles repo under `claude-skills/`, junctioned
into `~/.claude/skills/` by `global-claude/setup-links.ps1`. They are bare `SKILL.md`
directories, not packaged plugins, so they cannot be installed by anyone else or on
another machine without cloning a personal dotfiles repo.

This turns `agent.vellum.lib` into a published Claude Code plugin marketplace and makes
it the single home for those skills.

A working reference already exists: `amag-claude-skills` (Bitbucket, AMAG Engineering)
is a marketplace of ~25 plugins with the same structure. Its layout is the model here.

## Goals

- A marketplace installable via `/plugin marketplace add bow-meow/agent.vellum.lib`.
- Each of the four skills independently installable.
- One source of truth per skill — no copy drifting against another copy.
- A fast local edit loop, since these skills are edited frequently.
- The two work-flavoured skills readable by someone outside AMAG.

## Non-goals

- Third-party contributions. No `CONTRIBUTING.md`, no skill template, no validation CI,
  no author namespacing. This is a personal catalogue; that machinery is speculative
  maintenance until somebody actually asks to contribute.
- A website, catalogue UI, ratings, or payments. Distribution is git; discovery happens
  inside Claude Code.
- Preserving per-skill git history across the repo move. History stays readable in
  `symmetry.world`; provenance is recorded in the migration commit message instead.
- Restructuring any skill's content beyond the `ticket-quest` generalization below.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| What is being built | Claude Code plugin marketplace | Smallest path to something real; matches the proven `amag-claude-skills` shape |
| Source of truth | Move skills out of `symmetry.world` | One home, zero drift; daily use dogfoods the marketplace |
| Packaging | One plugin per skill | Pick-and-choose granularity is the point of a marketplace — `humanizer` shouldn't drag in Jira machinery |
| Audience | Personal catalogue, publicly installable | Sole author; contributor surface is speculative |
| Dev loop | Test local-path marketplace, fall back to junctions | Installed plugins are cached and SHA-pinned, so naive `/plugin install` would force a push cycle per edit |
| `ticket-quest` scope | Generalize lightly; quarantine the environment-specific block | Full generalization needs a config mechanism — too large a change |

### Marketplace name

The catalogue's `name` field is **`vellum`**, not `agent.vellum.lib`. Installs then read
`/plugin install humanizer@vellum`. The repo keeps its own name; only the manifest is
shortened.

## Repo layout

```
agent.vellum.lib/
  .claude-plugin/marketplace.json
  README.md
  .gitignore
  docs/superpowers/specs/          (this document)
  code-comments/
    .claude-plugin/plugin.json
    skills/code-comments/SKILL.md
  humanizer/
    .claude-plugin/plugin.json
    LICENSE
    skills/humanizer/SKILL.md
  pr-respond/
    .claude-plugin/plugin.json
    skills/pr-respond/SKILL.md
    skills/pr-respond/scripts/bb.mjs
  ticket-quest/
    .claude-plugin/plugin.json
    skills/ticket-quest/SKILL.md
    skills/ticket-quest/scripts/watch-plan-reviews.mjs
```

`skills/<name>/SKILL.md` with `scripts/` alongside mirrors `amag-symmetry-logs` exactly.

## Manifests

`.claude-plugin/marketplace.json`:

```json
{
  "name": "vellum",
  "owner": { "name": "bow-meow" },
  "plugins": [
    { "name": "code-comments", "source": "./code-comments", "description": "..." },
    { "name": "humanizer",     "source": "./humanizer",     "description": "..." },
    { "name": "pr-respond",    "source": "./pr-respond",    "description": "..." },
    { "name": "ticket-quest",  "source": "./ticket-quest",  "description": "..." }
  ]
}
```

Each `description` is the skill's own frontmatter `description`, condensed to a single
line — no new prose is invented for the catalogue, so the trigger wording a user reads in
the marketplace is the wording that actually fires the skill.

Each plugin's `.claude-plugin/plugin.json` carries `name`, `description`, `version`, and
`author`.

### Versions

| Plugin | Version | Note |
|---|---|---|
| `code-comments` | `1.0.0` | |
| `humanizer` | `2.13.0` | Already self-versioned in frontmatter; resetting would discard real history |
| `pr-respond` | `1.0.0` | |
| `ticket-quest` | `1.0.0` | |

`humanizer` keeps its existing MIT `LICENSE` file.

### The one cross-skill dependency

`pr-respond/SKILL.md:127` instructs Claude to invoke the `code-comments` skill before
writing any comment. Claude Code marketplaces have no dependency resolution, and bundling
would not fix it (any grouping that puts `pr-respond` and `code-comments` in separate
plugins has the same problem, and grouping them together defeats the granularity goal).

Resolution: document it. There are no per-plugin READMEs; the root `README.md`'s
`pr-respond` entry names `code-comments` as a recommended companion. The skill text
degrades gracefully when it is absent — it is an instruction to invoke a skill, not a
hard call.

## `ticket-quest` generalization

Three tiers, roughly a dozen edits, no restructuring and no behaviour change on the
author's machine.

### Tier 1 — example strings, no logic

`scripts/watch-plan-reviews.mjs` mentions `SYM-1,SYM-2` in a header comment (line 6) and
in its usage string (line 62). `resolvePlanFiles` matches `\.(plan|testplan)\.md$` and
contains no project key. Swap both to `ABC-1,ABC-2`. No logic change.

### Tier 2 — the ticket-key pattern

The only genuine constraint. Four sites in `SKILL.md`:

- frontmatter `description` (line 4) — `SYM-/ESG-` and `SYM-#### / ESG-####`
- line 22 — ``(`SYM-####` / `ESG-####`)``
- line 67 example path — `C:\repos\ticket-work\SYM-9713\esg-ng-core-linux`
- line 67 regex — `^(SYM|ESG)-\d+$`

The regex becomes the standard Jira key shape:

```
^[A-Z][A-Z0-9]+-\d+$
```

The frontmatter matters most: it is what fires the skill, so `SYM-####/ESG-####` there
makes a stranger's `ABC-123` match less readily. It becomes "a single Jira issue" and
"`PROJ-####` issues".

Same tier, also environment-specific: the branch prefix `akt/<ticket>_<slug>` (author
initials) and the hardcoded worktree root `C:\repos\ticket-work\`. Both become named
conventions with the current values as the stated default, so nothing changes in practice.

### Tier 3 — quarantine the environment-specific block

`SKILL.md` lines 78–112: the codejock symlink, robocopy seeds of `Source\bin\debug` and
`INSTALL`, `.sym-target`, `just mk-worktree`, and a base-defaults table naming
`symmetryclassic` and `esg-ng-core-linux`.

Generalizing this properly would require inventing a per-repo config mechanism. That is
out of proportion to the goal. Instead the content stays **verbatim**, reframed by its
heading as a worked example:

> **Build/run conveniences (environment-specific — this section is an example).** A bare
> worktree often can't be built or tested until you seed it. What that takes depends on
> your repos; here's what mine need, as an illustration of the pattern.

Behaviour is identical for the author. A stranger reads it as "I need to seed my worktree
somehow" rather than as instructions naming two repos they do not have.

The base-defaults table stays as-is — it is already self-describing and carries an
edit-me marker comment.

## Security review of the migrated content

Checked before deciding to publish. No hardcoded credentials, tokens, internal hostnames,
or Bitbucket workspace names in any of the four skills. `bb.mjs` reads
`BITBUCKET_USERNAME` / `BITBUCKET_PASSWORD` from the environment or a config file outside
the repo. The only work-specific identifiers are the Jira project keys handled above.
Publishing is safe.

## Development loop

Installed plugins are copied into `~/.claude/plugins/cache/<marketplace>/<plugin>/<sha>/`
and pinned to a git commit SHA. Consuming these skills purely through `/plugin install`
would therefore make every edit a commit → push → `/plugin update` → restart cycle — worst
for exactly the skills that are edited most.

**Resolution, in order:**

1. Register `C:/repos/agent.vellum.lib` as a **local-path marketplace**, edit a
   `SKILL.md`, restart, and check whether the change takes effect.
2. **If it loads live from disk** — that is the dev loop. No junctions. The real plugin
   code path gets exercised on every edit.
3. **If it caches like the git-sourced ones** — fall back to junctioning
   `~/.claude/skills/<name>` → `agent.vellum.lib/<plugin>/skills/<name>` via
   `setup-links.ps1`, exactly as today but pointed at the new repo. The marketplace is
   then purely a distribution channel.

Under the fallback, do not also `/plugin install` a junctioned skill on this machine — the
same skill name would load twice.

## Migration sequence

Ordered so nothing is deleted before its replacement is proven.

1. Build the new repo: copy the four skill directories into the layout above, write the
   manifests, `README.md`, and `.gitignore`.
2. Apply the `ticket-quest` generalization.
3. Commit and push to `github.com/bow-meow/agent.vellum.lib`.
4. **Gate:** add the marketplace from GitHub on this machine and install a skill.
   Confirm it works. Nothing is removed from `symmetry.world` until this passes.
5. Run the local-marketplace test and record the outcome.
6. `git rm -r claude-skills/` in `symmetry.world`.
7. Update `symmetry.world/global-claude/setup-links.ps1` — either drop the four skill
   junctions (if local marketplaces load live) or repoint them at `agent.vellum.lib`
   (if they do not). The `output-styles` junction is untouched either way.

## Risks

| Risk | Mitigation |
|---|---|
| Local-path marketplace behaviour is unverified | Step 5 is an explicit test with a defined fallback; neither outcome blocks the migration |
| Deleting `claude-skills/` breaks the author's daily workflow | Step 4 gate proves the new home works first; step 7 is last |
| Same skill loaded twice (junction + installed plugin) | Documented in README; only one mechanism is used per machine |
| `ticket-quest` edits change behaviour unintentionally | Tier 1 is comments only, Tier 3 is a heading change only; Tier 2's regex is a strict superset of `^(SYM\|ESG)-\d+$` |

## Verification

- `marketplace.json` and all four `plugin.json` files parse as valid JSON.
- `/plugin marketplace add bow-meow/agent.vellum.lib` lists four plugins.
- Each of the four installs individually.
- An installed skill fires on its trigger phrase.
- `ticket-quest`'s generalized regex still matches `SYM-9713` and `ESG-1234`, and now also
  matches `ABC-1`.
- `setup-links.ps1` runs clean after editing.
