# Module map — the shape of a module's `CLAUDE.md`

A module is a directory that is a unit of build or schema: a project folder (`.csproj`/`.vcxproj`/
`package.json`), a database folder, or a shared-source pool consumers compile themselves. Leaf folders
inside a module get no map. The map is orientation for someone already inside the module, so it
answers "what would I have guessed wrong?" and nothing `ls` already answers.

## Shape — at most 15 lines

```markdown
# <folder name>

<What it is and what it is for, 1–2 lines. Name the kind of thing: Windows service, client plugin,
C++ DLL, shared source pool, schema folder.>

**Entry points:** `relative/path` — why you open it first; up to three.
**Talks to:** other modules, services, queues, tables — only where the names don't make it obvious.
**Traps:**
- One per bullet: a place where the name, structure or history misleads. Anything inferred rather
  than read in the code carries `(unverified)`.
```

Paths are relative to the module folder, or repo-relative when they leave it. If the file already
holds rules (`**When …**:` lines), the map goes under its own `## Map` heading beneath them and the
rules are not touched — rules belong to the environment's CLAUDE.md-authoring skill.

## Not in a map

- File listings, or a line that restates a file name ("`CardQueryDA.cpp` — card query data access").
- Rules or process ("When adding a column: …"). Those are the CLAUDE.md-authoring skill's territory.
- Cross-module redirects ("the thing you want is in module X"). Those belong in the repo's code map.
- Anything the agent only grepped through. A map records understanding that was actually earned.

If a hook refuses the write until a CLAUDE.md-authoring skill has been invoked (here:
amag-claude-authoring's `writing-claude`), invoke it and retry. A map is prose, not a rule, so that
skill's rule gates do not apply; its linter still must pass.

## Verification before the map counts as done

1. The environment's CLAUDE.md lint passes (here: `lint-rules.mjs` from amag-claude-authoring).
2. Every backticked path resolves from the module folder or the repo root.
3. At least one trap is confirmed in the code by the orchestrator, not the engineer who wrote it.
4. Line count ≤ 15.
