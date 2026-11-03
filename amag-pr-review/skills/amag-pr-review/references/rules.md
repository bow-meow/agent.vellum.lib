# Adding a static-analysis rule

Read when a confirmed finding (SKILL.md step 7) or a defect a human reviewer caught
(amag-pr-respond's retro) has a fixed code shape. A rule in `rules/` runs on every later PR through
`scripts/static.mjs`, at no agent cost, on any model.

## Does it deserve a rule?

Yes when the defect is a **shape in the code**: a call checked the wrong way, a missing handler
around a call known to throw, a value built into SQL, a deprecated API, a setting that silently
overrides configuration. No when finding it needs the meaning of the change (a test that doesn't
cover the bug, a comment that's wrong, a ticket item not met): that's a checklist line, not a rule.

## Candidate or lead

- **candidate** (`metadata.kind: candidate`): a match is almost always the defect. It goes to verify
  as a finding with no reviewer spent on it, so it needs `severity`, `dimension`, `claim`, `issue`,
  `impact` and `fix`, written to severity.md's rules, and `failure` when the severity is High or
  Medium (verify downgrades a High/Medium without one).
- **lead** (`metadata.kind: lead`, plus `dimension` and `lead`): a match is a place worth checking.
  It becomes a triage hint and reviewer material. `lead` is the question the reviewer should answer
  there.

When unsure, write a lead: a noisy candidate costs a verify pass on every match.

## Write it

1. Add the rule to `rules/<language>.yml` (`csharp`, `cpp-mfc`, `sql`, ...), or to a file named for
   the project when it only applies to one (see Scope). T-SQL has no parser: use
   `languages: [generic]` with `pattern-regex`.
2. Add `ruleid: <id>` lines (must match) and `ok: <id>` lines (must not: the near misses, like the
   correct form of the same call) to the fixture `rules/<same name>.<ext>`. Opengrep pairs them by
   file name. In generic mode, write the annotations as `// ruleid:` even in a .sql fixture.
3. `opengrep scan --test rules/` (or `node --test scripts/test/rules.test.mjs`) must pass.
4. **Precision check:** run the rule over the whole repo the defect came from and read a sample of
   the matches: `opengrep scan --quiet --json --config rules/<file>.yml <repo>/Source`. Hundreds of
   matches mostly not the defect → narrow it (`pattern-not`, `pattern-not-inside`,
   `pattern-not-regex`, `paths.exclude`) or make it a lead, and add the false positive you excluded
   as an `ok:` fixture line. Only changed lines are kept in a review, but every legacy match is noise
   on the PR that touches it.
5. Commit the rule and its fixture together.

## Scope

A rule can name a project's types and calls; a checklist line can't. Keep a rule that only means
something in one repo from firing in others with `paths.include` on that repo's layout, and put it in
a file named for the project (`rules/natscodegen.yml` with fixture `natscodegen.cs`, whose name the
`paths.include` also lists so `--test` reaches it).

## No Opengrep installed

`scripts/static.mjs` looks for `OPENGREP`, `~/tools/opengrep/opengrep.exe`, then `opengrep` or
`semgrep` on PATH. With none, write the rule and fixture but don't commit them untested: put both in
the summary for the user.
