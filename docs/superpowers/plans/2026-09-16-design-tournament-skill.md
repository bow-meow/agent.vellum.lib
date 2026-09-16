# design-tournament Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `design-tournament` as a fifth plugin in the vellum marketplace — a skill that runs three stance-diverse designers, three fresh judges, and a synthesis stage to produce one design better than any single agent would write.

**Architecture:** The decision logic (winner, tie, adequacy, disqualification, length cap) lives in a pure, zero-dependency Node module that is unit-tested. The agent orchestration lives in a `Workflow` script. The `SKILL.md` carries only the gates and the judgement at each pause — it does not restate mechanics the script performs.

**Tech Stack:** Zero-dependency ESM `.mjs`, `node:test`, the Claude Code `Workflow` tool, plugin manifests.

**Spec:** `docs/superpowers/specs/2026-09-16-design-tournament-skill-design.md`

## Global Constraints

- **No `version` field** in `plugin.json` or the marketplace entry — git SHA is the version; a pin freezes the cache. The packaging linter errors on it.
- **Manifest lockstep:** `plugin.json`, the `marketplace.json` entry, and the root `README.md` section are created together, never one without the others.
- `author.name` is `bow-meow`; marketplace `name` is `vellum`.
- Plugin layout is `design-tournament/skills/design-tournament/SKILL.md` with `scripts/` alongside.
- **`SKILL.md` must pass** `node <writing-skills+ dir>/scripts/lint-skill.mjs design-tournament/skills/design-tournament/` with zero errors AND zero warnings (body cap: 500 lines / 24000 chars).
- Helpers are **zero-dep ESM**: pure exported functions plus a CLI guard (`import.meta.url === pathToFileURL(process.argv[1]).href`).
- **No hardcoded machine paths** in any SKILL.md or reference body. Plain relative paths only (`scripts/tally.mjs`).
- Scripts are referenced by plain relative path from the skill directory — `CLAUDE_PLUGIN_ROOT`-style variables substitute in manifests only and expand to empty in a SKILL.md body.
- 7 dispatched agents per run: 3 designers, 3 judges, 1 synthesiser.
- Adequacy threshold: a **majority** of judges returning `adequate: false` aborts the run. With 3 judges that is 2.
- Design length cap: **600 words**. Over-length designs are returned for compression, not judged long.

**Working directory:** `C:/repos/agent.vellum.lib`, on `main` (already pushed; branch before starting per Task 7).

---

### Task 1: Tally logic — winner, tie, adequacy

The heart of the skill. Everything else is prompting; this is the part that can be wrong in a way tests catch.

**Files:**
- Create: `design-tournament/skills/design-tournament/scripts/tally.mjs`
- Test: `design-tournament/skills/design-tournament/scripts/tests/tally.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `tally(judges)` → one of
  - `{ outcome: 'inadequate', inadequate: number, total: number }`
  - `{ outcome: 'tie', leaders: string[], firstPlaces: Record<string,number> }`
  - `{ outcome: 'winner', winner: string, firstPlaces: Record<string,number>, grafts: Array<{from: string, idea: string}> }`

  Task 2 adds more exports to the same file. Task 3's workflow consumes `tally`.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/tally.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tally } from '../tally.mjs';

const judge = (id, ranking, adequate = true, graft = null) => ({ id, ranking, adequate, graft });

test('a 3-0 sweep wins', () => {
  const r = tally([
    judge('j1', ['B', 'A', 'C']),
    judge('j2', ['B', 'C', 'A']),
    judge('j3', ['B', 'A', 'C']),
  ]);
  assert.equal(r.outcome, 'winner');
  assert.equal(r.winner, 'B');
  assert.equal(r.firstPlaces.B, 3);
});

test('a 2-1 split wins', () => {
  const r = tally([
    judge('j1', ['B', 'A', 'C']),
    judge('j2', ['A', 'B', 'C']),
    judge('j3', ['B', 'A', 'C']),
  ]);
  assert.equal(r.outcome, 'winner');
  assert.equal(r.winner, 'B');
});

test('a three-way split is a tie, not a coin flip', () => {
  const r = tally([
    judge('j1', ['A', 'B', 'C']),
    judge('j2', ['B', 'C', 'A']),
    judge('j3', ['C', 'A', 'B']),
  ]);
  assert.equal(r.outcome, 'tie');
  assert.deepEqual(r.leaders.sort(), ['A', 'B', 'C']);
});

test('a majority calling it inadequate aborts, even with a clear ranking winner', () => {
  const r = tally([
    judge('j1', ['B', 'A', 'C'], false),
    judge('j2', ['B', 'A', 'C'], false),
    judge('j3', ['B', 'A', 'C'], true),
  ]);
  assert.equal(r.outcome, 'inadequate');
  assert.equal(r.inadequate, 2);
  assert.equal(r.total, 3);
});

test('a single dissenter does not abort', () => {
  const r = tally([
    judge('j1', ['B', 'A', 'C'], false),
    judge('j2', ['B', 'A', 'C'], true),
    judge('j3', ['B', 'A', 'C'], true),
  ]);
  assert.equal(r.outcome, 'winner');
  assert.equal(r.winner, 'B');
});

test('grafts exclude ideas from the winning design', () => {
  const r = tally([
    judge('j1', ['B', 'A', 'C'], true, { from: 'A', idea: 'migration strategy' }),
    judge('j2', ['B', 'A', 'C'], true, { from: 'C', idea: 'rollback path' }),
    judge('j3', ['B', 'A', 'C'], true, { from: 'B', idea: 'should be dropped' }),
  ]);
  assert.equal(r.outcome, 'winner');
  assert.deepEqual(r.grafts.map((g) => g.from).sort(), ['A', 'C']);
});

test('no judges is an error, not an empty winner', () => {
  assert.throws(() => tally([]), /at least one judge/);
});

test('a judge with no ranking is an error', () => {
  assert.throws(() => tally([{ id: 'j1', adequate: true, ranking: [] }]), /no ranking/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd C:/repos/agent.vellum.lib
node --test design-tournament/skills/design-tournament/scripts/tests/tally.test.mjs
```

Expected: FAIL — `Cannot find module '../tally.mjs'`.

- [ ] **Step 3: Write the minimal implementation**

Create `scripts/tally.mjs`:

```js
#!/usr/bin/env node
// Decision logic for design-tournament. Pure functions; the CLI guard at the
// bottom lets the skill run it on a judge-results JSON file.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// A majority of judges calling the top design inadequate aborts the run. The
// tournament reports failure rather than crowning the least-bad entry.
export function tally(judges) {
  if (!Array.isArray(judges) || judges.length === 0)
    throw new Error('tally: need at least one judge result');

  const inadequate = judges.filter((j) => j.adequate === false).length;
  if (inadequate * 2 > judges.length)
    return { outcome: 'inadequate', inadequate, total: judges.length };

  const firstPlaces = {};
  for (const j of judges) {
    const top = j.ranking?.[0];
    if (!top) throw new Error(`tally: judge ${j.id} has no ranking`);
    firstPlaces[top] = (firstPlaces[top] || 0) + 1;
  }

  const max = Math.max(...Object.values(firstPlaces));
  const leaders = Object.keys(firstPlaces).filter((d) => firstPlaces[d] === max);
  if (leaders.length > 1) return { outcome: 'tie', leaders, firstPlaces };

  const winner = leaders[0];
  const grafts = judges.map((j) => j.graft).filter((g) => g && g.from !== winner);
  return { outcome: 'winner', winner, firstPlaces, grafts };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node tally.mjs <judge-results.json>');
    process.exit(2);
  }
  console.log(JSON.stringify(tally(JSON.parse(readFileSync(file, 'utf8'))), null, 2));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test design-tournament/skills/design-tournament/scripts/tests/tally.test.mjs
```

Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
cd C:/repos/agent.vellum.lib
git add design-tournament/skills/design-tournament/scripts/
git commit -m "design-tournament: tally logic for winner, tie, and adequacy"
```

---

### Task 2: Entry validation — citations and the length cap

The two structural bias mitigations. Both are gates on a design *before* it reaches a judge, which is what makes them stronger than asking a judge to ignore length.

**Files:**
- Modify: `design-tournament/skills/design-tournament/scripts/tally.mjs` (add two exports)
- Modify: `design-tournament/skills/design-tournament/scripts/tests/tally.test.mjs` (add cases)

**Interfaces:**
- Consumes: `tally.mjs` from Task 1.
- Produces:
  - `hasCitation(body: string) → boolean` — true when the body cites at least one `path.ext:line`
  - `validateEntries(designs: Array<{id, body}>, cap = 600) → { accepted: [], rejected: Array<{id, reason: 'no-citation'|'over-length', words?: number}> }`

  Task 3's workflow calls `validateEntries` before judging.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/tests/tally.test.mjs`:

```js
import { hasCitation, validateEntries } from '../tally.mjs';

test('a file:line citation is recognised', () => {
  assert.equal(hasCitation('as in src/app.ts:42 the handler returns early'), true);
  assert.equal(hasCitation('see README.md:1'), true);
  assert.equal(hasCitation('C:\\repos\\thing\\x.mjs:10 does it'), true);
});

test('prose with no citation is not a citation', () => {
  assert.equal(hasCitation('This design introduces a service layer.'), false);
  assert.equal(hasCitation(''), false);
});

test('a bare version number is not mistaken for a citation', () => {
  assert.equal(hasCitation('bumped to 1.0:2 in the changelog'), false);
});

test('an uncited design is rejected before judging', () => {
  const r = validateEntries([
    { id: 'A', body: 'Refactor via src/index.mjs:12 and split the module.' },
    { id: 'B', body: 'A truly elegant layered architecture.' },
  ]);
  assert.deepEqual(r.accepted.map((d) => d.id), ['A']);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].id, 'B');
  assert.equal(r.rejected[0].reason, 'no-citation');
});

test('an over-length design is rejected for compression, not judged long', () => {
  const long = 'word '.repeat(700) + 'src/a.mjs:1';
  const r = validateEntries([{ id: 'A', body: long }], 600);
  assert.equal(r.accepted.length, 0);
  assert.equal(r.rejected[0].reason, 'over-length');
  assert.ok(r.rejected[0].words > 600);
});

test('a design at exactly the cap is accepted', () => {
  const body = 'src/a.mjs:1 ' + 'word '.repeat(599);
  const r = validateEntries([{ id: 'A', body }], 600);
  assert.equal(r.accepted.length, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test design-tournament/skills/design-tournament/scripts/tests/tally.test.mjs
```

Expected: FAIL — `hasCitation` and `validateEntries` are not exported.

- [ ] **Step 3: Write the minimal implementation**

Add to `scripts/tally.mjs`, above the CLI guard:

```js
// A design must point at real code. The extension must start with a letter so
// version strings like "1.0:2" are not mistaken for a file reference.
const CITATION = /[\w./\\-]+\.[A-Za-z]\w*:\d+/;

export function hasCitation(body) {
  return CITATION.test(body ?? '');
}

// Length is capped structurally rather than left to a judge's discretion:
// without a cap, "more thorough" and "longer" are indistinguishable to a judge
// and the tournament reliably selects for over-engineering.
export function validateEntries(designs, cap = 600) {
  const accepted = [], rejected = [];
  for (const d of designs) {
    const words = (d.body ?? '').trim().split(/\s+/).filter(Boolean).length;
    if (!hasCitation(d.body)) rejected.push({ id: d.id, reason: 'no-citation' });
    else if (words > cap) rejected.push({ id: d.id, reason: 'over-length', words });
    else accepted.push(d);
  }
  return { accepted, rejected };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test design-tournament/skills/design-tournament/scripts/tests/tally.test.mjs
```

Expected: PASS — 14 tests.

- [ ] **Step 5: Live-smoke the CLI, not just the unit tests**

Unit tests pass while argv plumbing still fails. Run the real CLI against a real file:

```bash
cd C:/repos/agent.vellum.lib/design-tournament/skills/design-tournament/scripts
cat > /tmp/judges.json <<'JSON'
[
  {"id":"j1","ranking":["B","A","C"],"adequate":true,"graft":{"from":"A","idea":"migration strategy"}},
  {"id":"j2","ranking":["A","B","C"],"adequate":true,"graft":{"from":"C","idea":"rollback path"}},
  {"id":"j3","ranking":["B","A","C"],"adequate":true,"graft":{"from":"B","idea":"dropped"}}
]
JSON
node tally.mjs /tmp/judges.json
```

Expected: JSON with `"outcome": "winner"`, `"winner": "B"`, and exactly two grafts (`A` and `C`). Read the output; do not assert it looks right.

Then confirm the no-argument path:

```bash
node tally.mjs; echo "exit=$?"
```

Expected: the usage line on stderr and `exit=2`.

- [ ] **Step 6: Commit**

```bash
cd C:/repos/agent.vellum.lib
git add design-tournament/skills/design-tournament/scripts/
git commit -m "design-tournament: citation and length-cap entry validation"
```

---

### Task 3: The tournament workflow script

**Files:**
- Create: `design-tournament/skills/design-tournament/scripts/tournament-workflow.mjs`

**Interfaces:**
- Consumes: the rubric and stances passed in as `args` by the skill.
- Produces: a workflow invoked as `Workflow({scriptPath: "scripts/tournament-workflow.mjs", args: {problem, rubric, stances, cap}})`, returning `{designs, rejected, judges, synthesis}`.

**Workflow sandbox constraints — these bite:** scripts run in a restricted context with **no filesystem and no Node APIs**, so this script cannot `import` `tally.mjs`. `Date.now()`, `new Date()`, and `Math.random()` throw. The tally therefore runs *after* the workflow returns, in the main session, via the CLI from Task 2.

- [ ] **Step 1: Write the workflow script**

```js
export const meta = {
  name: 'design-tournament',
  description: 'Three stance-diverse designs, judged blind by fresh agents, then synthesised',
  phases: [
    { title: 'Design', detail: 'one agent per assigned stance, each reading real code' },
    { title: 'Judge', detail: 'fresh agents score anonymized designs against the fixed rubric' },
  ],
};

// Synthesis is NOT a phase here. It needs the tally, and the tally lives in
// scripts/tally.mjs which this sandbox cannot import (no filesystem). The skill
// runs the tally after this workflow returns, then dispatches the synthesiser —
// the 7th agent — with the winner and grafts in hand.

const { problem, rubric, stances, cap = 600 } = args;

// Mirrors CITATION in scripts/tally.mjs. It is duplicated because the sandbox
// cannot import that module, and the gate has to run before judging. A test in
// Task 3 Step 3 asserts the two literals stay identical.
const CITATION = /[\w./\\-]+\.[A-Za-z]\w*:\d+/;

const DESIGN_SCHEMA = {
  type: 'object',
  required: ['body', 'citations'],
  properties: {
    body: { type: 'string', description: `The design. HARD CAP ${cap} words.` },
    citations: { type: 'array', items: { type: 'string' },
      description: 'Real file:line references this design is grounded in' },
  },
};

const JUDGE_SCHEMA = {
  type: 'object',
  required: ['ranking', 'adequate', 'scores'],
  properties: {
    ranking: { type: 'array', items: { type: 'string' },
      description: 'Design ids, best first' },
    adequate: { type: 'boolean',
      description: 'Does the top-ranked design clear the bar? false aborts the run if a majority agree' },
    scores: { type: 'object', description: 'designId -> criterion -> {score 1-5, why}' },
    graft: { type: 'object', description: 'The strongest idea in a design you did NOT rank first',
      properties: { from: { type: 'string' }, idea: { type: 'string' } } },
    concerns: { type: 'array', items: { type: 'string' },
      description: 'Surviving objections, including about the design you ranked first' },
  },
};

phase('Design');
const designs = await parallel(stances.map((s, i) => () =>
  agent(
    `You are designing a solution to this problem:\n\n${problem}\n\n` +
    `Your assigned stance is **${s.name}**: ${s.brief}\n` +
    `Design from that stance genuinely — do not hedge toward the middle.\n\n` +
    `You MUST read the real code before designing, and cite specific file:line ` +
    `references. A design citing nothing is disqualified without being judged.\n` +
    `HARD LIMIT: ${cap} words. Over-length designs are returned for compression, not judged.`,
    { label: `design:${s.name}`, phase: 'Design', schema: DESIGN_SCHEMA }
  ).then((d) => d && ({ id: String.fromCharCode(65 + i), stance: s.name, ...d }))
));

// The grounding and verbosity gates, enforced BEFORE any judge sees a design.
const returned = designs.filter(Boolean);
const rejected = [], entries = [];
for (const d of returned) {
  const words = (d.body ?? '').trim().split(/\s+/).filter(Boolean).length;
  if (!CITATION.test(d.body ?? '')) rejected.push({ id: d.id, reason: 'no-citation' });
  else if (words > cap) rejected.push({ id: d.id, reason: 'over-length', words });
  else entries.push(d);
}
if (rejected.length) log(`rejected before judging: ${rejected.map((r) => `${r.id} (${r.reason})`).join(', ')}`);

if (entries.length < 2) {
  return { aborted: 'fewer than 2 designs survived — a tournament of one is not a tournament',
           designs: returned, rejected };
}

// Anonymized and independently ordered per judge: identity and stance labels are
// stripped, and the rotation removes position bias.
const anonymized = entries.map((d) => ({ id: d.id, body: d.body, citations: d.citations }));
const rotate = (arr, n) => arr.slice(n).concat(arr.slice(0, n));

phase('Judge');
const judges = await parallel([0, 1, 2].map((n) => () => {
  const shown = rotate(anonymized, n % anonymized.length);
  return agent(
    `You are judging candidate designs for this problem:\n\n${problem}\n\n` +
    `You did not write any of them. Score every design against this rubric, ` +
    `which was fixed before any design existed and may not be changed:\n\n${rubric}\n\n` +
    `Designs:\n\n` +
    shown.map((d) => `### Design ${d.id}\n${d.body}\n\nCitations: ${(d.citations || []).join(', ')}`).join('\n\n') +
    `\n\nScore each 1-5 per criterion with a one-sentence justification. Then rank them. ` +
    `Scores inform your ranking but do not mechanically determine it — one disqualifying ` +
    `flaw may outweigh a better average, provided you say why.\n` +
    `Then name the single strongest idea in a design you did NOT rank first.\n` +
    `Finally: does your top-ranked design actually clear the bar? Answer honestly — ` +
    `"none of these is adequate" is a valid and useful result.`,
    { label: `judge:${n + 1}`, phase: 'Judge', schema: JUDGE_SCHEMA }
  ).then((v) => v && ({ id: `judge-${n + 1}`, ...v }));
}));

const verdicts = judges.filter(Boolean);
if (verdicts.length === 0) return { aborted: 'no judge returned a verdict', designs: entries };

log(`${entries.length} designs judged by ${verdicts.length} judges`);

return { designs: entries, rejected, judges: verdicts };
```

- [ ] **Step 2: Verify the script parses and respects the sandbox**

**`node --check` does not work on this file** — it rejects top-level `return` and `await`, which are legal here only because the Workflow runtime wraps the script in an async function. Checking it that way reports a false `SyntaxError: Illegal return statement`.

The check has to mirror the wrapper instead, so it lives in a test file alongside the drift checks. Create `scripts/tests/workflow-syntax.test.mjs` with five tests: the wrapped-parse check, `meta` being a first-statement pure literal, no sandbox-forbidden calls (`Date.now()`, `new Date()`, `Math.random()`), and the two anti-drift checks from Step 3.

```bash
cd C:/repos/agent.vellum.lib
node --test design-tournament/skills/design-tournament/scripts/tests/workflow-syntax.test.mjs
```

Expected: PASS — 5 tests.

- [ ] **Step 3: Write the anti-drift test**

The citation regex now exists in two files because the sandbox cannot import. Pin them together so a future edit to one is caught. Append to `scripts/tests/tally.test.mjs`:

```js
import { readFileSync } from 'node:fs';

test('the workflow inlines exactly the same citation regex as tally.mjs', () => {
  const dir = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const grab = (f) => {
    const m = readFileSync(dir + f, 'utf8').match(/const CITATION = (\/.*\/);/);
    assert.ok(m, `no CITATION literal found in ${f}`);
    return m[1];
  };
  assert.equal(grab('tournament-workflow.mjs'), grab('tally.mjs'),
    'CITATION drifted between the workflow and tally.mjs — they must stay identical');
});

test('the workflow and tally.mjs agree on the default word cap', () => {
  const dir = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const wf = readFileSync(dir + 'tournament-workflow.mjs', 'utf8');
  const tl = readFileSync(dir + 'tally.mjs', 'utf8');
  assert.match(wf, /cap = 600/, 'workflow default cap is not 600');
  assert.match(tl, /cap = 600/, 'tally default cap is not 600');
});
```

Run it:

```bash
node --test design-tournament/skills/design-tournament/scripts/tests/tally.test.mjs
```

Expected: PASS — 16 tests.

- [ ] **Step 4: Commit**

```bash
cd C:/repos/agent.vellum.lib
git add design-tournament/skills/design-tournament/scripts/tournament-workflow.mjs
git commit -m "design-tournament: the workflow — stance-diverse designers, blind judges"
```

---

### Task 4: SKILL.md and its reference file

**Gate:** invoke `amag-claude-authoring:writing-skills-` (which hard-gates to `superpowers:writing-skills`) BEFORE writing. A `PreToolUse` hook rejects the write otherwise. Do not work around it by writing `SKILL.md.txt` and renaming.

**Files:**
- Create: `design-tournament/skills/design-tournament/SKILL.md`
- Create: `design-tournament/skills/design-tournament/REFERENCE.md`

**Interfaces:**
- Consumes: `scripts/tally.mjs` and `scripts/tournament-workflow.mjs`.
- Produces: the skill body. Task 5 copies its `description` verbatim into both manifests.

- [ ] **Step 1: Write the description first and check it against the gates**

The highest-leverage decision. It must carry triggers and a hard SKIP, and must NOT summarise the workflow — a description that states the procedure gets followed *instead of* the body.

```yaml
description: >-
  Use when a code-design decision has a genuinely wide solution space, high blast radius, and
  expensive reversal — and one opinion is not enough. Triggers — "run a design tournament",
  "get competing designs", "have agents compete on this design", "I want more than one option
  for this architecture". SKIP for: ordinary approach choices (superpowers:brainstorming already
  proposes 2-3 with trade-offs), bounded changes, and anything a single paragraph of trade-offs
  settles. Costs 7 agents.
```

Check it aloud: "I should load this skill **when** a design decision is wide, high-blast-radius and hard to reverse." That completes, so the trigger is present.

- [ ] **Step 2: Write `SKILL.md`**

Body under 500 lines and 24000 chars. It carries the gates and the judgement at each pause — **not** the mechanics the workflow performs.

```markdown
---
name: design-tournament
description: >-
  Use when a code-design decision has a genuinely wide solution space, high blast radius, and
  expensive reversal — and one opinion is not enough. Triggers — "run a design tournament",
  "get competing designs", "have agents compete on this design", "I want more than one option
  for this architecture". SKIP for: ordinary approach choices (superpowers:brainstorming already
  proposes 2-3 with trade-offs), bounded changes, and anything a single paragraph of trade-offs
  settles. Costs 7 agents.
---

# design-tournament — competing designs, judged blind

Three designers with deliberately different stances each design a solution. Three agents that
wrote nothing then score the designs blind against a rubric fixed beforehand. The winner becomes
the spine of a synthesis that grafts on the best ideas from the designs that lost.

## The Iron Law

```
NO DESIGN IS JUDGED BY ITS OWN AUTHOR, AND NO RUBRIC IS WRITTEN AFTER A DESIGN EXISTS.
```

**Violating the letter of this rule is violating its spirit.** No exceptions:

- Not "the designers are the best-informed judges" — they are, and they also favour their own work.
- Not "I'll let designers vote but forbid self-votes" — self-preference survives that; models
  recognise their own reasoning style with the name stripped off.
- Not "the rubric is obvious, I'll write it after" — criteria written after designs exist get
  retrofitted to justify a favourite.
- Not "only two designs came back, close enough" — a tournament of one is not a tournament.

## When to use

Use when ALL of these hold:
- The solution space is genuinely wide — several materially different designs could work.
- Blast radius is high, and reversal is expensive.
- You cannot already name the answer.

If you can name the answer, or `superpowers:brainstorming`'s 2-3 approaches would settle it,
this skill is the wrong tool and costs 7 agents to tell you what you knew.

## Gate 1 — rubric and cost, before anything is dispatched

Draft the rubric from the actual problem, then put it in front of the user **with the agent count**
and wait. Nothing is dispatched before they confirm.

Default criteria (add problem-specific ones; never remove one after designs exist):

| Criterion | Question |
|---|---|
| Correctness | Does it solve the stated problem, including the edge cases in the brief? |
| Fit | Does it look like the surrounding code, or import a foreign idiom? |
| Blast radius | How much must change, and how much of that is code nobody wants to touch? |
| Reversibility | If this is wrong in three months, what does undoing it cost? |
| Testability | Can it be verified, and does the design say how? |
| Complexity cost | What must be maintained forever that does not exist today? |

Present: the rubric, the three stances, and "this costs 7 agents — proceed?"

## Run it

Invoke the workflow with the confirmed rubric:

`Workflow({scriptPath: "scripts/tournament-workflow.mjs", args: {problem, rubric, stances, cap: 600}})`

Default stances — assign one per designer, and do not let them converge:

| Stance | Brief |
|---|---|
| Minimal | The smallest change that solves it. YAGNI hard. Prefer removing an option to adding one. |
| Conventional | Follow the existing codebase's patterns closely, even at some cost in elegance. |
| Structural | Restructure for clarity or extensibility where it demonstrably pays — and justify the cost. |

The workflow enforces the grounding and length gates itself, then returns
`{designs, rejected, judges}`. Tally the verdicts deterministically — do not eyeball the ranking:

`node scripts/tally.mjs <judge-results.json>`

On `outcome: 'winner'`, dispatch the seventh and last agent — the synthesiser — giving it the
winning design, every graft the tally collected, and all judges' concerns. It returns the
synthesised design plus the minority report. Conflicts between a graft and the winning spine
resolve in favour of the spine, and get recorded rather than dropped.

On `tie` or `inadequate`, **do not synthesise.** Go straight to Gate 2 with the outcome.

## Gate 2 — the decision is the user's

Present the synthesis, the ranking with scores, and the minority report. **Never proceed to
implementation.** The terminal state is the user choosing.

What to hand them depends on the outcome:

| Outcome | What you present |
|---|---|
| `winner` | The synthesis: winner as spine, grafted ideas from the losers, minority report. |
| `tie` | Both leaders with their trade-offs. Do not break the tie yourself. |
| `inadequate` | The run failed. Report what was learned and what the designs missed. Do not crown the least-bad. |

If the three designs came back materially the same, say so plainly: the tournament added nothing
and the decision was not actually contested. That is a real result, not a failure to hide.

## Anti-patterns to refuse

- Letting a designer judge, or judging with the stance labels still attached.
- Editing the rubric once designs exist — including "just clarifying" a criterion.
- Summing scores across judges to break a tie; independent scales do not average.
- Discarding the minority report because a winner emerged. The surviving objection is often the
  most valuable output of the run.
- Proceeding to implement the winner without the user choosing it.

## Rationalisations — rejected

| Excuse | Reality |
|---|---|
| "Designers know the designs best, let them vote." | True, and they still rate their own work higher. Fresh judges remove the cause rather than mitigating it. |
| "Anonymising is enough, designers can judge." | Partial at best — style is recognisable with the name stripped. It is defence in depth, not the mitigation. |
| "Three designs are nearly identical, I'll pick the nicest." | Convergence is the finding. Report it; do not manufacture a ranking from noise. |
| "Two judges said inadequate but one design is clearly least-bad." | A majority said the bar was not cleared. Crowning the least-bad is exactly the failure this skill exists to prevent. |
| "The rubric missed something important, I'll add a criterion." | After designs exist, a new criterion is a retrofit that favours whichever design already satisfies it. |
| "The user is busy, I'll pick the winner for them." | Gate 2 is the point. The skill produces a recommendation, never a decision. |

## Red Flags — STOP

- About to dispatch a designer before the user confirmed the rubric
- About to add or reword a rubric criterion after seeing a design
- About to average scores across judges
- About to drop the minority report because "the winner is clear"
- About to start implementing the winning design
- Reaching for this skill on a decision you could settle in a paragraph

For the judge prompt, the design template, and the anonymisation mechanics, see
[REFERENCE.md](REFERENCE.md).
```

- [ ] **Step 3: Write `REFERENCE.md`**

```markdown
# design-tournament reference

Read this when running a tournament and you need the exact prompts, or when changing how
anonymisation or scoring works.

## Why fresh judges rather than cross-review

When the same model generates and judges, it rates its own output higher — self-preference bias.
Two companions make it worse: verbosity bias rewards longer designs regardless of merit, which
selects for over-engineering; position bias rewards whichever design is seen first or last.

| Bias | Mitigation | Strength |
|---|---|---|
| Self-preference | Judges wrote nothing | Strong — removes the cause |
| Self-preference (residual) | Identity and stance labels stripped | Partial — style is still recognisable |
| Verbosity | Hard word cap, enforced before judging | Strong — structural |
| Position | Independent rotation per judge | Strong |
| Criteria drift | Rubric fixed and confirmed before designs exist | Strong |

## The design template

Each designer returns `{body, citations}`. The body must:
- stay within the word cap (600 by default) — over-length is returned for compression, not judged
- cite real `file:line` references; a design citing nothing is disqualified before judging
- argue from its assigned stance without hedging toward the middle

## Entry validation

`validateEntries(designs, cap)` in `scripts/tally.mjs` returns `{accepted, rejected}`, where each
rejection carries `reason: 'no-citation' | 'over-length'`. Run it before judging. If fewer than
two designs survive, abort — a tournament of one is not a tournament.

## Tally rules

`tally(judges)` returns one of three outcomes:

- `inadequate` — a majority of judges set `adequate: false`. Takes precedence over any ranking.
- `tie` — no single design holds strictly the most first-place rankings.
- `winner` — one design leads on first-place rankings; `grafts` collects each judge's nominated
  idea from designs that did NOT win.

Scores are never summed across judges. Averaging independent scales invents precision that is not
there, and a genuine split is information about the decision rather than noise to flatten.

## Synthesis

The synthesiser receives the winner, every graft nomination, and all dissent, and returns:

- **The synthesised design** — winner as spine, grafts merged where they do not conflict with it.
  Conflicts resolve in favour of the spine and are recorded, not dropped.
- **The minority report** — surviving objections, including judges' concerns about the winner.
```

- [ ] **Step 4: Run the linter — zero errors AND zero warnings**

```bash
cd C:/repos/agent.vellum.lib
LINT="$HOME/.claude/plugins/cache/amag-claude-skills/amag-claude-authoring/01af6992bb76/skills/writing-skills+/scripts/lint-skill.mjs"
node "$LINT" design-tournament/skills/design-tournament/
```

Expected: `OK — 1 skill(s) passed all checks.`

If it reports the body over 500 lines or 24000 chars, move depth into `REFERENCE.md` — do not trim the Iron Law, rationalisations, or red flags, which are the parts that bind under pressure.

- [ ] **Step 5: Run `/doctor` and confirm nothing was dropped**

The description listing is a shared, silently-truncating budget. Run `/doctor` and confirm no
"N descriptions dropped" line appears. If one does, shorten this description — it is the newest
and therefore the one to cut.

- [ ] **Step 6: Commit**

```bash
cd C:/repos/agent.vellum.lib
git add design-tournament/skills/design-tournament/SKILL.md design-tournament/skills/design-tournament/REFERENCE.md
git commit -m "design-tournament: the skill body and reference"
```

---

### Task 5: Manifests in lockstep

**Files:**
- Create: `design-tournament/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `README.md`
- Modify: `verify.mjs` (add the fifth plugin to `EXPECT`)

**Gate:** invoke `amag-claude-authoring:writing-plugins` before touching either manifest — a `PreToolUse` hook rejects the write otherwise.

**Interfaces:**
- Consumes: the `description` written in Task 4.
- Produces: a five-plugin marketplace.

- [ ] **Step 1: Add the plugin to the checker and run it to see red**

In `verify.mjs`, add to `EXPECT`:

```js
  'design-tournament': { driftBudget: 0 },
```

`design-tournament` has no copy source in `symmetry.world`, so the drift check skips it — the
`existsSync(srcPath)` guard already handles that. Then:

```bash
cd C:/repos/agent.vellum.lib
node verify.mjs --generalized code-comments humanizer pr-respond ticket-quest design-tournament
```

Expected: FAIL — `plugins are [code-comments,humanizer,pr-respond,ticket-quest], expected [...,design-tournament]`.

- [ ] **Step 2: Write `design-tournament/.claude-plugin/plugin.json`**

No `version` field.

```json
{
  "name": "design-tournament",
  "description": "Run competing code designs through blind judging — three stance-diverse designers, three fresh judges scoring against a rubric fixed beforehand, then a synthesis that grafts the best ideas from the designs that lost.",
  "author": {
    "name": "bow-meow"
  }
}
```

- [ ] **Step 3: Append the marketplace entry**

Add to the `plugins` array in `.claude-plugin/marketplace.json`, after `ticket-quest`:

```json
    {
      "name": "design-tournament",
      "source": "./design-tournament",
      "description": "Run competing code designs through blind judging — three stance-diverse designers, three fresh judges scoring against a rubric fixed beforehand, then a synthesis that grafts the best ideas from the designs that lost."
    }
```

- [ ] **Step 4: Append the README section**

Add under `## Skills`, after the `ticket-quest` entry:

```markdown
### `design-tournament`
For a design decision with a genuinely wide solution space: three designers work from deliberately
different stances, three agents that wrote nothing judge the results blind against a rubric fixed
before any design existed, and a synthesis stage grafts the best ideas from the designs that lost
onto the winner.

Costs 7 agents per run, and asks before spending them. Reports "no adequate design" rather than
crowning the least-bad entry.
```

- [ ] **Step 5: Run the checker to verify it passes**

```bash
node verify.mjs --generalized code-comments humanizer pr-respond ticket-quest design-tournament
```

Expected: `OK — 5 plugin(s): code-comments, humanizer, pr-respond, ticket-quest, design-tournament`

- [ ] **Step 6: Commit**

```bash
cd C:/repos/agent.vellum.lib
git add .claude-plugin README.md verify.mjs design-tournament/.claude-plugin
git commit -m "design-tournament: register the plugin in the vellum marketplace"
```

---

### Task 6: Prove it installs and runs

**Files:** none modified.

**Interfaces:**
- Consumes: the complete plugin from Tasks 1–5.
- Produces: evidence the skill loads and its workflow dispatches.

- [ ] **Step 1: Confirm the tree is clean and every check is green**

```bash
cd C:/repos/agent.vellum.lib
git status --porcelain
node --test design-tournament/skills/design-tournament/scripts/tests/tally.test.mjs
node verify.mjs --generalized code-comments humanizer pr-respond ticket-quest design-tournament
```

Expected: empty status, 14 tests passing, 5 plugins OK.

- [ ] **Step 2: Push, then install**

Confirm with the user before pushing — this publishes to a public repo.

```bash
git push
```

Then, in Claude Code:

```
/plugin marketplace update vellum
/plugin install design-tournament@vellum
```

Restart Claude Code (first-time registration of a new plugin needs a restart; `/reload-plugins`
only picks up changes to an already-installed plugin).

- [ ] **Step 3: Confirm the skill is registered with the right description**

```bash
grep -rn 'design-tournament' "$HOME/.claude/plugins/marketplaces/vellum/.claude-plugin/marketplace.json"
```

Expected: the entry, with no `version` field. Then confirm `design-tournament` appears in the
available-skills listing with the description from Task 4 — not a truncated version of it.

- [ ] **Step 4: Dry-run it against a decision whose answer is already known**

**This step dispatches 7 agents. Confirm with the user first.**

Run the skill on the packaging decision from this repo's own history: *"Should the vellum
marketplace ship one plugin per skill, or group them into themed bundles?"*

Verify by reading the output, not by asserting it looks right:
- Gate 1 fired — the rubric was presented and nothing dispatched until confirmed.
- Three designs came back with genuinely different stances, each citing real `file:line`.
- The judges' ranking surfaces the granularity argument that actually decided it.
- A minority report exists and is not empty.
- The run stopped at Gate 2 rather than proceeding to implement.

- [ ] **Step 5: Confirm the disqualification path**

Ask a designer for a design **without** giving it codebase access, and confirm the entry is
rejected with `reason: 'no-citation'` before judging — rather than being judged on its prose.

- [ ] **Step 6: Commit any fixes the dry run surfaced**

```bash
cd C:/repos/agent.vellum.lib
git add -A
git commit -m "design-tournament: fixes from the first live run"
```

---

### Task 7: Behavioural testing (requires agent permission)

`superpowers:writing-skills` has an Iron Law: no skill edit without a failing test first, where
the test is a pressure scenario run against a subagent. **This task cannot run under a standing
instruction not to dispatch agents — raise it with the user rather than skipping it silently.**

**Files:**
- Modify: `design-tournament/skills/design-tournament/SKILL.md` (rationalisations and red flags, from observed failures)

- [ ] **Step 1: Establish the baseline (RED)**

Give a fresh subagent the tournament *problem* with no skill present, plus pressure: "we've
already spent two days on this", "just pick the best one", "the user is waiting". Record verbatim
what it does — specifically whether it crowns a winner without a rubric, and whether it lets the
designs judge themselves.

- [ ] **Step 2: Re-run with the skill present (GREEN)**

Same scenarios, skill loaded. The agent should refuse to dispatch before the rubric is confirmed,
and should refuse to break a tie itself.

- [ ] **Step 3: Close whatever loopholes appeared (REFACTOR)**

Every new rationalisation the agent produced goes into the Rationalisations table **verbatim**.
Invented rows do not persuade a future agent under pressure; observed ones do.

- [ ] **Step 4: Re-lint and commit**

```bash
cd C:/repos/agent.vellum.lib
LINT="$HOME/.claude/plugins/cache/amag-claude-skills/amag-claude-authoring/01af6992bb76/skills/writing-skills+/scripts/lint-skill.mjs"
node "$LINT" design-tournament/skills/design-tournament/
git add design-tournament/skills/design-tournament/SKILL.md
git commit -m "design-tournament: close loopholes found in pressure testing"
```

---

## Verification (whole plan)

- [ ] `node --test .../tally.test.mjs` — 14 tests green (Tasks 1–2)
- [ ] `tally.mjs` CLI live-smoked against a real JSON file, output read (Task 2 Step 5)
- [ ] Workflow script contains no `Date.now()` / `new Date()` / `Math.random()` (Task 3 Step 2)
- [ ] `lint-skill.mjs` green with zero warnings (Task 4 Step 4)
- [ ] `/doctor` shows no dropped descriptions (Task 4 Step 5)
- [ ] `verify.mjs` reports 5 plugins, no `version` fields (Task 5 Step 5)
- [ ] Skill installs from the marketplace and appears in the listing (Task 6 Step 3)
- [ ] A live run stops at Gate 1 and again at Gate 2 (Task 6 Step 4)
- [ ] An uncited design is disqualified before judging (Task 6 Step 5)
- [ ] Pressure-test loopholes closed, or explicitly deferred with the user's agreement (Task 7)
