# vellum Skill Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the empty `agent.vellum.lib` repo into a publicly installable Claude Code plugin marketplace named `vellum`, carrying four skills moved out of the `symmetry.world` dotfiles repo.

**Architecture:** A git repo whose root holds `.claude-plugin/marketplace.json` (the catalogue) and one directory per plugin, each containing `.claude-plugin/plugin.json` and `skills/<name>/SKILL.md`. No build step, no code to compile — the deliverable is manifests plus markdown. Skills are copied from `symmetry.world/claude-skills/`, then that source directory is deleted so exactly one copy exists.

**Tech Stack:** JSON manifests, markdown skills, two zero-dependency Node `.mjs` scripts (carried over unchanged), PowerShell for the junction script in `symmetry.world`.

**Spec:** `docs/superpowers/specs/2026-09-16-vellum-skill-marketplace-design.md`

## Global Constraints

- Marketplace `name` field is **`vellum`** — not `agent.vellum.lib`. Installs read `humanizer@vellum`.
- Plugin layout is **`<plugin>/skills/<name>/SKILL.md`** with `scripts/` alongside the SKILL.md, mirroring `amag-symmetry-logs`.
- **One plugin per skill.** Four plugins: `code-comments`, `humanizer`, `pr-respond`, `ticket-quest`.
- Plugin versions: `1.0.0` for all except `humanizer`, which is **`2.13.0`** (existing self-versioning, preserved).
- `author.name` is **`bow-meow`** in every `plugin.json` and in `marketplace.json`'s `owner`.
- Each catalogue `description` is the skill's own frontmatter `description` condensed to one line. Do not invent new prose.
- **No contributor surface.** Do not create `CONTRIBUTING.md`, `template/`, `.github/`, or any validation CI.
- **No per-plugin READMEs.** One root `README.md` only.
- Skill file contents are copied **byte-for-byte** except for the explicitly listed edits in Task 5 and Task 4 Step 4.
- **Nothing is deleted from `symmetry.world` until Task 6 passes.** Task 8 is the only task that removes anything.
- There is no test framework in this repo. "Tests" are verification commands — `node -e` JSON parses, regex behaviour checks, and `grep` assertions. Each must be run and seen to fail before the change, and seen to pass after.

**Source paths** (read-only until Task 8):

| Skill | Source |
|---|---|
| `code-comments` | `C:/repos/symmetry.world/claude-skills/code-comments/SKILL.md` |
| `humanizer` | `C:/repos/symmetry.world/claude-skills/humanizer/{SKILL.md,LICENSE}` |
| `pr-respond` | `C:/repos/symmetry.world/claude-skills/pr-respond/{SKILL.md,scripts/bb.mjs}` |
| `ticket-quest` | `C:/repos/symmetry.world/claude-skills/ticket-quest/{SKILL.md,scripts/watch-plan-reviews.mjs}` |

---

### Task 1: Repo skeleton and the first plugin

Delivers a valid one-plugin marketplace. `code-comments` goes first because it is a single file with no scripts, no licence, and no generalization work — it proves the skeleton before anything complicated lands on it.

**Files:**
- Create: `C:/repos/agent.vellum.lib/.gitignore`
- Create: `C:/repos/agent.vellum.lib/.claude-plugin/marketplace.json`
- Create: `C:/repos/agent.vellum.lib/README.md`
- Create: `C:/repos/agent.vellum.lib/code-comments/.claude-plugin/plugin.json`
- Create: `C:/repos/agent.vellum.lib/code-comments/skills/code-comments/SKILL.md`
- Create: `C:/repos/agent.vellum.lib/verify.mjs` (throwaway; deleted in Task 8)

**Interfaces:**
- Consumes: nothing.
- Produces: `marketplace.json` with a `plugins` array that Tasks 2–4 each append one entry to. `README.md` with a `## Skills` section that Tasks 2–4 each append one entry to.

- [ ] **Step 1: Write the verification script**

Create `C:/repos/agent.vellum.lib/verify.mjs` — a throwaway checker used by every task in this plan, deleted in Task 8.

```js
#!/usr/bin/env node
// Throwaway plan-verification checker. Deleted in Task 8.
// Usage: node verify.mjs [--generalized] <plugin-name>...
import { readFileSync, existsSync } from 'node:fs';

const root = 'C:/repos/agent.vellum.lib';
const srcRoot = 'C:/repos/symmetry.world/claude-skills';

const argv = process.argv.slice(2);
const generalized = argv.includes('--generalized');
const expected = argv.filter((a) => a !== '--generalized');

// version is pinned exactly, not shape-matched — humanizer must stay 2.13.0.
// driftBudget is (lines removed + lines added) against the copy source, so a
// truncated or rewritten skill fails even though its manifest is well-formed.
// ticket-quest's budget only opens up once Task 5's edits land.
const EXPECT = {
  'code-comments': { version: '1.0.0',  driftBudget: 0 },
  'humanizer':     { version: '2.13.0', driftBudget: 0 },
  'pr-respond':    { version: '1.0.0',  driftBudget: 2 },
  'ticket-quest':  { version: '1.0.0',  driftBudget: generalized ? 24 : 0 },
};

let bad = 0;
const fail = (m) => { console.error('FAIL ' + m); bad++; };

// Multiset line comparison — immune to the line-number shifts that an
// insertion causes, unlike a positional diff.
function drift(aText, bText) {
  const norm = (s) => s.split('\n').map((l) => l.trimEnd()).filter(Boolean);
  const tally = (ls) => ls.reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const a = tally(norm(aText)), b = tally(norm(bText));
  let n = 0;
  for (const [l, c] of a) n += Math.max(0, c - (b.get(l) || 0));
  for (const [l, c] of b) n += Math.max(0, c - (a.get(l) || 0));
  return n;
}

const mk = JSON.parse(readFileSync(`${root}/.claude-plugin/marketplace.json`, 'utf8'));
if (mk.name !== 'vellum') fail(`marketplace name is "${mk.name}", expected "vellum"`);
if (mk.owner?.name !== 'bow-meow') fail(`owner is "${mk.owner?.name}", expected "bow-meow"`);

const names = mk.plugins.map((p) => p.name);
if (names.join(',') !== expected.join(',')) fail(`plugins are [${names}], expected [${expected}]`);

for (const p of mk.plugins) {
  const want = EXPECT[p.name];
  if (!want) { fail(`${p.name}: unknown plugin`); continue; }

  if (p.source !== `./${p.name}`) fail(`${p.name}: source is "${p.source}", expected "./${p.name}"`);
  if (!p.description?.trim()) fail(`${p.name}: empty catalogue description`);

  const pjPath = `${root}/${p.name}/.claude-plugin/plugin.json`;
  if (!existsSync(pjPath)) { fail(`${p.name}: no plugin.json`); continue; }
  const pj = JSON.parse(readFileSync(pjPath, 'utf8'));
  if (pj.name !== p.name) fail(`${p.name}: plugin.json name is "${pj.name}"`);
  if (pj.author?.name !== 'bow-meow') fail(`${p.name}: author is "${pj.author?.name}"`);
  if (pj.version !== want.version) fail(`${p.name}: version is "${pj.version}", expected "${want.version}"`);
  if (pj.description !== p.description) fail(`${p.name}: plugin.json and catalogue descriptions differ`);

  const skillPath = `${root}/${p.name}/skills/${p.name}/SKILL.md`;
  if (!existsSync(skillPath)) { fail(`${p.name}: no skills/${p.name}/SKILL.md`); continue; }
  const skill = readFileSync(skillPath, 'utf8');
  if (!skill.startsWith('---\n')) fail(`${p.name}: SKILL.md lacks frontmatter`);
  const declared = skill.match(/^name:\s*(\S+)/m)?.[1];
  if (declared !== p.name) fail(`${p.name}: SKILL.md declares name "${declared}"`);

  const srcPath = `${srcRoot}/${p.name}/SKILL.md`;
  if (existsSync(srcPath)) {
    const d = drift(readFileSync(srcPath, 'utf8'), skill);
    if (d > want.driftBudget)
      fail(`${p.name}: SKILL.md drifts ${d} line(s) from source, budget ${want.driftBudget}`);
  }
}

console.log(bad ? `${bad} failure(s)` : `OK — ${names.length} plugin(s): ${names.join(', ')}`);
process.exit(bad ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node C:/repos/agent.vellum.lib/verify.mjs code-comments
```

Expected: FAIL — `ENOENT` on `.claude-plugin/marketplace.json`, because nothing exists yet.

This is the weakest red in the plan: it fails because the checker cannot run at all, not because an assertion tripped. That is unavoidable when bootstrapping an empty repo — from Task 2 onward every red is a real assertion failure.

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
*.log
.DS_Store
Thumbs.db
```

- [ ] **Step 4: Write `.claude-plugin/marketplace.json`**

```json
{
  "name": "vellum",
  "owner": {
    "name": "bow-meow"
  },
  "plugins": [
    {
      "name": "code-comments",
      "source": "./code-comments",
      "description": "Comment discipline for any language — what earns a comment and what gets deleted. Sweeps comment noise out of changed code before a commit or while fixing PR feedback."
    }
  ]
}
```

- [ ] **Step 5: Copy the skill and write its plugin.json**

```bash
mkdir -p C:/repos/agent.vellum.lib/code-comments/.claude-plugin
mkdir -p C:/repos/agent.vellum.lib/code-comments/skills/code-comments
cp C:/repos/symmetry.world/claude-skills/code-comments/SKILL.md \
   C:/repos/agent.vellum.lib/code-comments/skills/code-comments/SKILL.md
```

`code-comments/.claude-plugin/plugin.json`:

```json
{
  "name": "code-comments",
  "description": "Comment discipline for any language — what earns a comment and what gets deleted. Sweeps comment noise out of changed code before a commit or while fixing PR feedback.",
  "version": "1.0.0",
  "author": {
    "name": "bow-meow"
  }
}
```

- [ ] **Step 6: Write `README.md`**

````markdown
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

## Layout

```
<plugin>/
  .claude-plugin/plugin.json
  skills/<name>/SKILL.md      (+ scripts/ where a skill needs them)
```

## Notes

These are my working skills, published because they may be useful, not because they are
general-purpose products. Some carry conventions from my own setup — where that happens the skill
says so and tells you what to change.
````

- [ ] **Step 7: Run verification to confirm it passes**

```bash
node C:/repos/agent.vellum.lib/verify.mjs code-comments
```

Expected: `OK — 1 plugin(s): code-comments`

- [ ] **Step 8: Commit**

```bash
cd C:/repos/agent.vellum.lib
git add .gitignore .claude-plugin README.md code-comments verify.mjs
git commit -m "Add vellum marketplace skeleton and code-comments plugin"
```

---

### Task 2: humanizer plugin

**Files:**
- Create: `C:/repos/agent.vellum.lib/humanizer/.claude-plugin/plugin.json`
- Create: `C:/repos/agent.vellum.lib/humanizer/LICENSE`
- Create: `C:/repos/agent.vellum.lib/humanizer/skills/humanizer/SKILL.md`
- Modify: `C:/repos/agent.vellum.lib/.claude-plugin/marketplace.json`
- Modify: `C:/repos/agent.vellum.lib/README.md`

**Interfaces:**
- Consumes: `marketplace.json` and `README.md` from Task 1.
- Produces: a second `plugins` entry. The version is **`2.13.0`**, not `1.0.0`. `verify.mjs` pins this exactly, so writing `1.0.0` fails the build rather than slipping through.

- [ ] **Step 1: Run verification to see the expected failure**

```bash
node C:/repos/agent.vellum.lib/verify.mjs code-comments humanizer
```

Expected: FAIL — `plugins are [code-comments], expected [code-comments,humanizer]`

- [ ] **Step 2: Copy the skill and its licence**

```bash
mkdir -p C:/repos/agent.vellum.lib/humanizer/.claude-plugin
mkdir -p C:/repos/agent.vellum.lib/humanizer/skills/humanizer
cp C:/repos/symmetry.world/claude-skills/humanizer/SKILL.md \
   C:/repos/agent.vellum.lib/humanizer/skills/humanizer/SKILL.md
cp C:/repos/symmetry.world/claude-skills/humanizer/LICENSE \
   C:/repos/agent.vellum.lib/humanizer/LICENSE
```

- [ ] **Step 3: Write `humanizer/.claude-plugin/plugin.json`**

The SKILL.md frontmatter already declares `license: MIT` and `metadata.version: "2.13.0"`. The version below must match that frontmatter.

```json
{
  "name": "humanizer",
  "description": "Edit outbound prose so it reads human-written, not AI-generated — PR replies, commit messages, Jira/Confluence comments, emails, docs. Based on Wikipedia's \"Signs of AI writing\" guide.",
  "version": "2.13.0",
  "author": {
    "name": "bow-meow"
  },
  "license": "MIT"
}
```

- [ ] **Step 4: Append the marketplace entry**

Add to the `plugins` array in `.claude-plugin/marketplace.json`, after `code-comments`:

```json
    {
      "name": "humanizer",
      "source": "./humanizer",
      "description": "Edit outbound prose so it reads human-written, not AI-generated — PR replies, commit messages, Jira/Confluence comments, emails, docs. Based on Wikipedia's \"Signs of AI writing\" guide."
    }
```

- [ ] **Step 5: Append the README entry**

Add under `## Skills`, after the `code-comments` entry:

```markdown
### `humanizer`
Strips AI writing patterns out of prose headed somewhere permanent — PR replies, commit messages,
emails, docs. Based on Wikipedia's "Signs of AI writing". MIT licensed.
```

- [ ] **Step 6: Prove the version pin actually fails when wrong**

Temporarily set `"version": "1.0.0"` in `humanizer/.claude-plugin/plugin.json` and run:

```bash
node C:/repos/agent.vellum.lib/verify.mjs code-comments humanizer
```

Expected: FAIL — `humanizer: version is "1.0.0", expected "2.13.0"`.

This confirms the pin is load-bearing rather than decorative. Restore `2.13.0` before Step 7.

Then confirm the manifest and the skill's own frontmatter agree:

```bash
grep -n 'version' C:/repos/agent.vellum.lib/humanizer/.claude-plugin/plugin.json
grep -n 'version' C:/repos/agent.vellum.lib/humanizer/skills/humanizer/SKILL.md
```

Expected: both report `2.13.0`.

- [ ] **Step 7: Run verification**

```bash
node C:/repos/agent.vellum.lib/verify.mjs code-comments humanizer
```

Expected: `OK — 2 plugin(s): code-comments, humanizer`

- [ ] **Step 8: Commit**

```bash
cd C:/repos/agent.vellum.lib
git add .claude-plugin README.md humanizer
git commit -m "Add humanizer plugin (keeps its own 2.13.0 versioning and MIT licence)"
```

---

### Task 3: pr-respond plugin

Carries the first `scripts/` directory and the only cross-skill dependency in the catalogue.

**Files:**
- Create: `C:/repos/agent.vellum.lib/pr-respond/.claude-plugin/plugin.json`
- Create: `C:/repos/agent.vellum.lib/pr-respond/skills/pr-respond/SKILL.md`
- Create: `C:/repos/agent.vellum.lib/pr-respond/skills/pr-respond/scripts/bb.mjs`
- Modify: `C:/repos/agent.vellum.lib/.claude-plugin/marketplace.json`
- Modify: `C:/repos/agent.vellum.lib/README.md`

**Interfaces:**
- Consumes: `marketplace.json` and `README.md` from Tasks 1–2.
- Produces: a third `plugins` entry. The README's `pr-respond` section is the *only* place the `code-comments` companion relationship is recorded — the plugin system has no dependency mechanism.

- [ ] **Step 1: Run verification to see the expected failure**

```bash
node C:/repos/agent.vellum.lib/verify.mjs code-comments humanizer pr-respond
```

Expected: FAIL — `plugins are [code-comments,humanizer], expected [code-comments,humanizer,pr-respond]`

- [ ] **Step 2: Copy the skill and its script**

```bash
mkdir -p C:/repos/agent.vellum.lib/pr-respond/.claude-plugin
mkdir -p C:/repos/agent.vellum.lib/pr-respond/skills/pr-respond/scripts
cp C:/repos/symmetry.world/claude-skills/pr-respond/SKILL.md \
   C:/repos/agent.vellum.lib/pr-respond/skills/pr-respond/SKILL.md
cp C:/repos/symmetry.world/claude-skills/pr-respond/scripts/bb.mjs \
   C:/repos/agent.vellum.lib/pr-respond/skills/pr-respond/scripts/bb.mjs
```

- [ ] **Step 3: Confirm the dangling AMAG reference is present**

```bash
grep -n 'amag-pr-review' C:/repos/agent.vellum.lib/pr-respond/skills/pr-respond/SKILL.md
```

Expected: line 8 matches. `amag-pr-review:pr-review` lives only in a private Bitbucket marketplace, so it means nothing to anyone installing from GitHub.

- [ ] **Step 4: Remove the dangling reference**

In `pr-respond/skills/pr-respond/SKILL.md`, line 8. Replace exactly:

```
  for: reviewing someone else's PR (amag-pr-review:pr-review), reviewing uncommitted local changes
```

with:

```
  for: reviewing someone else's PR (use a PR-review skill instead), reviewing uncommitted local changes
```

This is the only edit to this file. Everything else is byte-for-byte.

- [ ] **Step 5: Confirm the reference is gone and nothing else changed**

```bash
grep -c 'amag' C:/repos/agent.vellum.lib/pr-respond/skills/pr-respond/SKILL.md
diff <(sed '8d' C:/repos/symmetry.world/claude-skills/pr-respond/SKILL.md) \
     <(sed '8d' C:/repos/agent.vellum.lib/pr-respond/skills/pr-respond/SKILL.md) && echo "IDENTICAL APART FROM LINE 8"
```

Expected: `grep -c` prints `0`; the diff prints `IDENTICAL APART FROM LINE 8`.

- [ ] **Step 6: Write `pr-respond/.claude-plugin/plugin.json`**

```json
{
  "name": "pr-respond",
  "description": "Address reviewer comments on your own Bitbucket pull request — cluster feedback by blast radius, investigate, fix, and reply. Recommended companion: code-comments.",
  "version": "1.0.0",
  "author": {
    "name": "bow-meow"
  }
}
```

- [ ] **Step 7: Append the marketplace entry**

Add to the `plugins` array, after `humanizer`:

```json
    {
      "name": "pr-respond",
      "source": "./pr-respond",
      "description": "Address reviewer comments on your own Bitbucket pull request — cluster feedback by blast radius, investigate, fix, and reply. Recommended companion: code-comments."
    }
```

- [ ] **Step 8: Append the README entry**

Add under `## Skills`, after the `humanizer` entry:

```markdown
### `pr-respond`
Works through reviewer comments on a Bitbucket PR you authored: clusters them by blast radius,
investigates, fixes, and replies. Bitbucket only — not GitHub.

Needs `BITBUCKET_USERNAME` (your Atlassian email) and `BITBUCKET_PASSWORD` (a scoped API token with
`read:repository`, `read:pullrequest`, `write:pullrequest`) in your environment.

**Recommended companion:** `code-comments`. This skill invokes it before writing any comment. It
works without it, but installing both is better.
```

- [ ] **Step 9: Run verification**

```bash
node C:/repos/agent.vellum.lib/verify.mjs code-comments humanizer pr-respond
```

Expected: `OK — 3 plugin(s): code-comments, humanizer, pr-respond`

- [ ] **Step 10: Commit**

```bash
cd C:/repos/agent.vellum.lib
git add .claude-plugin README.md pr-respond
git commit -m "Add pr-respond plugin, drop its private-marketplace skill reference"
```

---

### Task 4: ticket-quest plugin (verbatim copy)

Packaging only. The generalization is Task 5 so that a reviewer can accept the packaging and still reject the wording changes.

**Files:**
- Create: `C:/repos/agent.vellum.lib/ticket-quest/.claude-plugin/plugin.json`
- Create: `C:/repos/agent.vellum.lib/ticket-quest/skills/ticket-quest/SKILL.md`
- Create: `C:/repos/agent.vellum.lib/ticket-quest/skills/ticket-quest/scripts/watch-plan-reviews.mjs`
- Modify: `C:/repos/agent.vellum.lib/.claude-plugin/marketplace.json`
- Modify: `C:/repos/agent.vellum.lib/README.md`

**Interfaces:**
- Consumes: `marketplace.json` and `README.md` from Tasks 1–3.
- Produces: the fourth and final `plugins` entry. Task 5 edits the `SKILL.md` and `watch-plan-reviews.mjs` this task creates.

- [ ] **Step 1: Run verification to see the expected failure**

```bash
node C:/repos/agent.vellum.lib/verify.mjs code-comments humanizer pr-respond ticket-quest
```

Expected: FAIL — `plugins are [code-comments,humanizer,pr-respond], expected [...,ticket-quest]`

- [ ] **Step 2: Copy the skill and its script**

```bash
mkdir -p C:/repos/agent.vellum.lib/ticket-quest/.claude-plugin
mkdir -p C:/repos/agent.vellum.lib/ticket-quest/skills/ticket-quest/scripts
cp C:/repos/symmetry.world/claude-skills/ticket-quest/SKILL.md \
   C:/repos/agent.vellum.lib/ticket-quest/skills/ticket-quest/SKILL.md
cp C:/repos/symmetry.world/claude-skills/ticket-quest/scripts/watch-plan-reviews.mjs \
   C:/repos/agent.vellum.lib/ticket-quest/skills/ticket-quest/scripts/watch-plan-reviews.mjs
```

- [ ] **Step 3: Confirm the copy is byte-identical**

```bash
diff C:/repos/symmetry.world/claude-skills/ticket-quest/SKILL.md \
     C:/repos/agent.vellum.lib/ticket-quest/skills/ticket-quest/SKILL.md && echo "SKILL OK"
diff C:/repos/symmetry.world/claude-skills/ticket-quest/scripts/watch-plan-reviews.mjs \
     C:/repos/agent.vellum.lib/ticket-quest/skills/ticket-quest/scripts/watch-plan-reviews.mjs && echo "SCRIPT OK"
```

Expected: `SKILL OK` and `SCRIPT OK`, no diff output.

- [ ] **Step 4: Write `ticket-quest/.claude-plugin/plugin.json`**

```json
{
  "name": "ticket-quest",
  "description": "Take assigned Jira tickets from investigation through to implementation — an isolated git worktree per ticket, peer-reviewed fix plans, and a human approval gate before any code is written.",
  "version": "1.0.0",
  "author": {
    "name": "bow-meow"
  }
}
```

- [ ] **Step 5: Append the marketplace entry**

Add to the `plugins` array, after `pr-respond`:

```json
    {
      "name": "ticket-quest",
      "source": "./ticket-quest",
      "description": "Take assigned Jira tickets from investigation through to implementation — an isolated git worktree per ticket, peer-reviewed fix plans, and a human approval gate before any code is written."
    }
```

- [ ] **Step 6: Append the README entry**

Add under `## Skills`, after the `pr-respond` entry:

```markdown
### `ticket-quest`
Runs assigned Jira tickets end to end: an isolated git worktree per ticket, an agent that
investigates and drafts a fix plan, peer review until the plan holds up, then a human approval gate
before any code is written.

Shaped around my own setup — worktree root, branch prefix, and the worktree build-seeding steps are
conventions you will want to change. The skill flags each one.
```

- [ ] **Step 7: Run verification**

```bash
node C:/repos/agent.vellum.lib/verify.mjs code-comments humanizer pr-respond ticket-quest
```

Expected: `OK — 4 plugin(s): code-comments, humanizer, pr-respond, ticket-quest`

- [ ] **Step 8: Commit**

```bash
cd C:/repos/agent.vellum.lib
git add .claude-plugin README.md ticket-quest
git commit -m "Add ticket-quest plugin (verbatim copy; generalization follows)"
```

---

### Task 5: Generalize ticket-quest

Three tiers from the spec. No restructuring, no behaviour change on the author's machine.

**Files:**
- Modify: `C:/repos/agent.vellum.lib/ticket-quest/skills/ticket-quest/SKILL.md` (lines 4, 22, 66–69, 78–82)
- Modify: `C:/repos/agent.vellum.lib/ticket-quest/skills/ticket-quest/scripts/watch-plan-reviews.mjs` (lines 6, 62)
- Create: `C:/repos/agent.vellum.lib/check-ticket-regex.mjs` (throwaway; deleted in Task 8)

**Interfaces:**
- Consumes: the files created in Task 4.
- Produces: nothing later tasks depend on.

**Edit these by hand, not by script.** The replacement text contains `` `^[A-Z][A-Z0-9]+-\d+$` ``, and in JavaScript `String.replace(a, b)` the sequence `` $` `` means "insert everything before the match" — scripting this edit naively duplicates half the file into itself while still reporting success. If you must script it, pass a function as the replacement (`s.replace(a, () => b)`), which disables `$` substitution entirely. `sed` has the equivalent problem with `&` and backslashes. The drift budget in Step 10 is what catches this if it happens.

**Measured, not estimated:** applying the four edits below produces a drift of exactly **22** lines against a budget of 24, and preserves all seven tier-3 tokens. If your numbers differ, your edits differ.

- [ ] **Step 1: Write the regex behaviour check**

Create `C:/repos/agent.vellum.lib/check-ticket-regex.mjs`. Deleted in Task 8.

```js
#!/usr/bin/env node
// Throwaway check for the Task 5 generalization. Deleted in Task 8.
// Asserts three things: the pattern generalized, the author's own keys still
// match, and the tier-3 block was REFRAMED rather than deleted.
import { readFileSync } from 'node:fs';

const packaged = readFileSync(
  'C:/repos/agent.vellum.lib/ticket-quest/skills/ticket-quest/SKILL.md', 'utf8');
const source = readFileSync(
  'C:/repos/symmetry.world/claude-skills/ticket-quest/SKILL.md', 'utf8');

let bad = 0;
const fail = (m) => { console.error('FAIL ' + m); bad++; };

// Tier 2 — the pattern is generalized in the prose...
if (!/`\^\[A-Z\]\[A-Z0-9\]\+-\\d\+\$`/.test(packaged))
  fail('no generalized pattern ^[A-Z][A-Z0-9]+-\\d+$ in SKILL.md');
if (/\^\(SYM\|ESG\)/.test(packaged))
  fail('old hardcoded pattern ^(SYM|ESG)-\\d+$ still present');
if (/SYM-|ESG-/.test(packaged.split('\n').slice(0, 5).join('\n')))
  fail('frontmatter still names SYM-/ESG-');

// ...and it behaves correctly.
const re = /^[A-Z][A-Z0-9]+-\d+$/;
for (const t of ['SYM-9713', 'ESG-1234', 'ABC-1', 'PROJ-42', 'A1B-7'])
  if (!re.test(t)) fail(`should accept ${t}`);
for (const t of ['sym-9713', 'SYM9713', 'S-1', 'SYM-', '-123'])
  if (re.test(t)) fail(`should reject ${t}`);

// Tier 3 — reframed, not deleted. Every environment-specific detail that was in
// the source must still be in the packaged copy, at the same frequency.
const count = (hay, needle) =>
  hay.split(needle).length - 1;
for (const tok of ['codejock', 'robocopy', '.sym-target', 'mk-worktree',
                   'bin\\debug', 'INSTALL', 'release/*']) {
  const a = count(source, tok), b = count(packaged, tok);
  if (a !== b) fail(`"${tok}" appears ${b}x, source has ${a}x — tier-3 content lost`);
}
if (!/environment-specific/.test(packaged))
  fail('tier-3 block was not reframed (no "environment-specific" heading)');
if (/Build\/run conveniences \(AMAG/.test(packaged))
  fail('tier-3 block still carries the AMAG-only heading');

console.log(bad ? `${bad} failure(s)`
                : 'OK — pattern generalized, old keys still match, tier-3 content preserved');
process.exit(bad ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node C:/repos/agent.vellum.lib/check-ticket-regex.mjs
```

Expected: FAIL — `no generalized pattern ^[A-Z][A-Z0-9]+-\d+$ in SKILL.md`, because the file still has `^(SYM|ESG)-\d+$`.

- [ ] **Step 3: Tier 2 — frontmatter description (line 4)**

Replace exactly:

```
  Use when taking one or more assigned Jira tickets from investigation through to implementation — a single SYM-/ESG- issue or a whole backlog batch, each worked in its own git worktree. Triggers — "run ticket-quest", "work this ticket", "take my assigned tickets", "work my backlog", or being handed one or more SYM-#### / ESG-#### issues to implement. SKIP for: a Jira question with no code to write, or a trivial change you would just make directly.
```

with:

```
  Use when taking one or more assigned Jira tickets from investigation through to implementation — a single issue or a whole backlog batch, each worked in its own git worktree. Triggers — "run ticket-quest", "work this ticket", "take my assigned tickets", "work my backlog", or being handed one or more `PROJ-####` issues to implement. SKIP for: a Jira question with no code to write, or a trivial change you would just make directly.
```

- [ ] **Step 4: Tier 2 — "When to use" (line 22)**

Replace exactly:

```
- One or more Jira issues (`SYM-####` / `ESG-####`) to take from investigation to a reviewable plan
```

with:

```
- One or more Jira issues (`PROJ-####`) to take from investigation to a reviewable plan
```

- [ ] **Step 5: Tier 2 — worktree layout and branch prefix (lines 66–69)**

Replace exactly:

```
- **Layout:** `C:\repos\ticket-work\<TICKET>\<repo>` per repo the ticket touches
  (e.g. `C:\repos\ticket-work\SYM-9713\esg-ng-core-linux`). `<TICKET>` matches `^(SYM|ESG)-\d+$`.
- **Branch:** `akt/<ticket>_<slug>`. Derive the slug from the ticket summary and **confirm it** with
  the user before branching.
```

with:

```
- **Layout:** `<WORKTREE_ROOT>\<TICKET>\<repo>` per repo the ticket touches, where
  `<WORKTREE_ROOT>` defaults to `C:\repos\ticket-work`
  (e.g. `C:\repos\ticket-work\SYM-9713\esg-ng-core-linux`). `<TICKET>` is a Jira key, matching
  `^[A-Z][A-Z0-9]+-\d+$`.
- **Branch:** `<PREFIX>/<ticket>_<slug>`, where `<PREFIX>` is your initials or handle (default:
  `akt`). Derive the slug from the ticket summary and **confirm it** with the user before branching.
```

- [ ] **Step 6: Tier 3 — quarantine the environment-specific block (line 78)**

Replace exactly:

```
- **Build/run conveniences (AMAG `symmetryclassic` / `esg-ng-core-linux` only).** A bare worktree
  cannot be built or sim-tested. When the ticket will need either, you MUST also wire up, per the
  repos it touches:
```

with:

```
- **Build/run conveniences (environment-specific — the four steps below are an example).** A bare
  worktree often cannot be built or tested until you seed it, and what that takes depends entirely
  on your repos. The steps below are what mine (`symmetryclassic` / `esg-ng-core-linux`) need,
  given as an illustration of the pattern rather than as instructions to follow literally. When the
  ticket will need building or sim-testing, wire up the equivalent for the repos it touches:
```

The four numbered sub-steps beneath it, the "Seed sources must be built first" paragraph, and the entire `### Base defaults` section stay **unchanged**. The base-defaults table is already self-describing and carries its own edit-me marker.

- [ ] **Step 7: Tier 1 — script example strings**

In `scripts/watch-plan-reviews.mjs`, line 6, replace `--files SYM-1,SYM-2` with `--files ABC-1,ABC-2`:

```js
//   node watch-plan-reviews.mjs <plans-dir> [--files ABC-1,ABC-2] [--interval 5] [--timeout 7200]
```

Line 62, the usage string, same swap:

```js
    console.error('usage: node watch-plan-reviews.mjs <plans-dir> [--files ABC-1,ABC-2] [--interval 5] [--timeout 7200]');
```

Line 49's comment (`SYM-1.plan.md` / `SYM-1.testplan.md`) may stay — it illustrates the filename shape, not a project key constraint. `resolvePlanFiles` matches `\.(plan|testplan)\.md$` and contains no project key, so no logic changes in this file.

- [ ] **Step 8: Run the regex check**

```bash
node C:/repos/agent.vellum.lib/check-ticket-regex.mjs
```

Expected: `OK — pattern generalized, old keys still match, tier-3 content preserved`

- [ ] **Step 9: Confirm the script still parses and the edits are comment-only**

```bash
node --check C:/repos/agent.vellum.lib/ticket-quest/skills/ticket-quest/scripts/watch-plan-reviews.mjs && echo "PARSES"
diff C:/repos/symmetry.world/claude-skills/ticket-quest/scripts/watch-plan-reviews.mjs \
     C:/repos/agent.vellum.lib/ticket-quest/skills/ticket-quest/scripts/watch-plan-reviews.mjs
```

Expected: `PARSES`, and the diff shows exactly two changed lines (6 and 62), both strings.

- [ ] **Step 10: Confirm the skill stayed within its drift budget**

Step 8 already asserted that the tier-3 content survived. This confirms the file as a whole was edited, not rewritten:

```bash
node C:/repos/agent.vellum.lib/verify.mjs --generalized code-comments humanizer pr-respond ticket-quest
```

Expected: `OK — 4 plugin(s): code-comments, humanizer, pr-respond, ticket-quest`

Without `--generalized` this same command fails with `ticket-quest: SKILL.md drifts N line(s) from source, budget 0` — run it both ways once to see the budget is real.

If the drift number exceeds 24, the edits went further than the plan specifies. Re-read Steps 3–6 rather than raising the budget.

- [ ] **Step 11: Commit**

```bash
cd C:/repos/agent.vellum.lib
git add ticket-quest check-ticket-regex.mjs
git commit -m "Generalize ticket-quest's Jira keys and quarantine its environment-specific block"
```

---

### Task 6: Publish and prove installation (gate)

**Nothing is deleted from `symmetry.world` until this task passes.** Pushing is outward-facing — confirm with the user before Step 2.

**Files:** none modified. This task publishes and verifies.

**Interfaces:**
- Consumes: the complete four-plugin repo from Tasks 1–5.
- Produces: a pushed `main` on `github.com/bow-meow/agent.vellum.lib`, and a proven install path that Task 8 depends on.

- [ ] **Step 1: Confirm the working tree is clean and review what will be published**

```bash
cd C:/repos/agent.vellum.lib
git status --porcelain
git log --oneline
node verify.mjs --generalized code-comments humanizer pr-respond ticket-quest
```

Expected: empty `git status`, six commits, verification OK. `--generalized` is required from Task 5 onward — without it, `ticket-quest` fails its drift budget by design.

- [ ] **Step 2: Ask the user before pushing**

This publishes to a public GitHub repo. Confirm, then:

```bash
cd C:/repos/agent.vellum.lib
git push -u origin main
```

- [ ] **Step 3: Add the marketplace from GitHub**

In Claude Code:

```
/plugin marketplace add bow-meow/agent.vellum.lib
```

Expected: the marketplace registers as `vellum` and lists four plugins.

- [ ] **Step 4: Install one plugin and restart**

```
/plugin install code-comments@vellum
```

Then restart Claude Code.

- [ ] **Step 5: Confirm the skill is live**

Check that `code-comments` appears in the available-skills list, and that
`~/.claude/plugins/known_marketplaces.json` now contains a `vellum` entry.

```bash
grep -n 'vellum' C:/Users/LocalAdmin/.claude/plugins/known_marketplaces.json
```

Expected: a `vellum` entry pointing at the GitHub repo.

**If any of Steps 3–5 fail, stop.** Fix the packaging and re-run this task. Task 8 must not start until this gate passes.

---

### Task 7: Decide the development loop

Answers the one open question in the spec. Both outcomes have a defined path, so neither blocks Task 8.

**Files:**
- Modify: `C:/repos/agent.vellum.lib/README.md` (append a `## Developing these skills` section)

**Interfaces:**
- Consumes: the proven install from Task 6.
- Produces: the decision Task 8 Step 4 branches on.

- [ ] **Step 1: Register the local path as a marketplace**

```
/plugin marketplace add C:/repos/agent.vellum.lib
```

- [ ] **Step 2: Make a visible edit to a skill**

Append a temporary marker line to the end of
`C:/repos/agent.vellum.lib/code-comments/skills/code-comments/SKILL.md`:

```markdown

<!-- DEV-LOOP-PROBE -->
```

Do not commit this.

- [ ] **Step 3: Restart Claude Code and check whether the edit is live**

```bash
grep -rn 'DEV-LOOP-PROBE' C:/Users/LocalAdmin/.claude/plugins/cache/ 2>/dev/null
```

- If the marker appears in the cache, or the loaded skill reflects the edit — **local marketplaces load live**. Record: junctions are not needed.
- If the cache holds an unmarked copy pinned to a SHA — **local marketplaces cache like git ones**. Record: junctions are needed.

- [ ] **Step 4: Remove the probe**

```bash
cd C:/repos/agent.vellum.lib
git checkout -- code-comments/skills/code-comments/SKILL.md
git status --porcelain
```

Expected: empty status — the probe is gone.

- [ ] **Step 5: Record the outcome in the README**

Append to `README.md`, choosing the branch that matches what Step 3 showed:

```markdown
## Developing these skills

Installed plugins are copied into `~/.claude/plugins/cache/` and pinned to a commit SHA, so a
plain `/plugin install` would mean commit → push → `/plugin update` → restart on every edit.

<!-- Keep ONE of the two paragraphs below, per the Task 7 probe result. -->

**Local marketplaces load live from disk**, so `/plugin marketplace add C:/repos/agent.vellum.lib`
is the development loop — edit a `SKILL.md`, restart, done. No junctions.

**Local marketplaces cache like git-sourced ones**, so development uses junctions:
`setup-links.ps1` in the `symmetry.world` repo points `~/.claude/skills/<name>` at
`<plugin>/skills/<name>` here. Do not also `/plugin install` a junctioned skill on the same
machine — the skill name would load twice.
```

- [ ] **Step 6: Commit**

```bash
cd C:/repos/agent.vellum.lib
git add README.md
git commit -m "Record the development-loop decision from the local-marketplace probe"
```

---

### Task 8: Retire the symmetry.world copies

The only task that deletes anything. Do not start until Task 6 has passed.

**Files:**
- Delete: `C:/repos/symmetry.world/claude-skills/` (all four skills)
- Modify: `C:/repos/symmetry.world/global-claude/setup-links.ps1`
- Delete: `C:/repos/agent.vellum.lib/verify.mjs`
- Delete: `C:/repos/agent.vellum.lib/check-ticket-regex.mjs`

**Interfaces:**
- Consumes: the proven install (Task 6) and the dev-loop decision (Task 7).
- Produces: a single source of truth.

- [ ] **Step 1: Confirm the new home is complete before deleting the old one**

```bash
for s in code-comments humanizer pr-respond ticket-quest; do
  test -f "C:/repos/agent.vellum.lib/$s/skills/$s/SKILL.md" \
    && echo "OK   $s" || echo "MISSING $s"
done
test -f C:/repos/agent.vellum.lib/pr-respond/skills/pr-respond/scripts/bb.mjs \
  && echo "OK   bb.mjs" || echo "MISSING bb.mjs"
test -f C:/repos/agent.vellum.lib/ticket-quest/skills/ticket-quest/scripts/watch-plan-reviews.mjs \
  && echo "OK   watch-plan-reviews.mjs" || echo "MISSING watch-plan-reviews.mjs"
```

Expected: six `OK` lines, no `MISSING`. **If anything is missing, stop.**

- [ ] **Step 2: Remove the throwaway checkers**

```bash
cd C:/repos/agent.vellum.lib
rm verify.mjs check-ticket-regex.mjs
git add -A
git commit -m "Remove plan-verification checkers"
```

- [ ] **Step 3: Delete the source copies**

```bash
cd C:/repos/symmetry.world
git rm -r --quiet claude-skills
```

- [ ] **Step 4: Update `setup-links.ps1`**

Remove these four entries from the `$links` array in
`C:/repos/symmetry.world/global-claude/setup-links.ps1`:

```powershell
    @{ Path = "$HOME\.claude\skills\ticket-quest"; Target = "$repo\claude-skills\ticket-quest" }
    @{ Path = "$HOME\.claude\skills\pr-respond";   Target = "$repo\claude-skills\pr-respond" }
    @{ Path = "$HOME\.claude\skills\humanizer";    Target = "$repo\claude-skills\humanizer" }
    @{ Path = "$HOME\.claude\skills\code-comments"; Target = "$repo\claude-skills\code-comments" }
```

**If Task 7 found local marketplaces load live**, delete all four lines — the `$links` array keeps only the `output-styles` entry.

**If Task 7 found they cache**, replace the four lines with these, repointed at the new repo:

```powershell
    @{ Path = "$HOME\.claude\skills\ticket-quest";  Target = "C:\repos\agent.vellum.lib\ticket-quest\skills\ticket-quest" }
    @{ Path = "$HOME\.claude\skills\pr-respond";    Target = "C:\repos\agent.vellum.lib\pr-respond\skills\pr-respond" }
    @{ Path = "$HOME\.claude\skills\humanizer";     Target = "C:\repos\agent.vellum.lib\humanizer\skills\humanizer" }
    @{ Path = "$HOME\.claude\skills\code-comments"; Target = "C:\repos\agent.vellum.lib\code-comments\skills\code-comments" }
```

The `output-styles` entry is untouched either way.

- [ ] **Step 5: Verify the script still parses**

```powershell
$p = 'C:\repos\symmetry.world\global-claude\setup-links.ps1'
$errs = $null
[System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$null, [ref]$errs) | Out-Null
if ($errs) { $errs } else { 'PARSES CLEAN' }
```

Expected: `PARSES CLEAN`.

- [ ] **Step 6: Run it and confirm it succeeds**

```powershell
& C:\repos\symmetry.world\global-claude\setup-links.ps1
```

Expected: no errors, and no warnings about real directories blocking a link. If Task 7 chose junctions, four `linked …` lines appear pointing at `agent.vellum.lib`.

- [ ] **Step 7: Confirm no stale junctions point at the deleted directory**

```bash
ls -la C:/Users/LocalAdmin/.claude/skills/ 2>/dev/null
```

Expected: nothing resolving to `symmetry.world\claude-skills`.

- [ ] **Step 8: Commit the symmetry.world change**

```bash
cd C:/repos/symmetry.world
git add global-claude/setup-links.ps1
git commit -m "Move claude-skills to agent.vellum.lib

The four skills (code-comments, humanizer, pr-respond, ticket-quest) now live in
github.com/bow-meow/agent.vellum.lib as the vellum plugin marketplace, installable
via /plugin. Their history up to this commit stays here."
```

- [ ] **Step 9: Final check across both repos**

```bash
cd C:/repos/agent.vellum.lib && git status --porcelain && git log --oneline
cd C:/repos/symmetry.world && git status --porcelain
test -d C:/repos/symmetry.world/claude-skills && echo "STILL THERE — investigate" || echo "OK removed"
```

Expected: both trees clean, `OK removed`.

---

## Verification (whole plan)

From the spec's verification section:

- [ ] `marketplace.json` and all four `plugin.json` files parse as valid JSON — covered by `verify.mjs` in Tasks 1–4.
- [ ] `/plugin marketplace add bow-meow/agent.vellum.lib` lists four plugins — Task 6 Step 3.
- [ ] Each of the four installs individually — Task 6 Step 4 installs one; install the remaining three the same way to complete this.
- [ ] An installed skill fires on its trigger phrase — Task 6 Step 5.
- [ ] `ticket-quest`'s generalized regex still matches `SYM-9713` and `ESG-1234`, and now also matches `ABC-1` — Task 5 Step 8.
- [ ] `setup-links.ps1` runs clean after editing — Task 8 Step 6.
