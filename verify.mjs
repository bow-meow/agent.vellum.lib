#!/usr/bin/env node
// Throwaway plan-verification checker. Deleted in Task 8.
// Usage: node verify.mjs [--generalized] <plugin-name>...
import { readFileSync, existsSync } from 'node:fs';

const root = 'C:/repos/agent.vellum.lib';
const srcRoot = 'C:/repos/symmetry.world/claude-skills';

const argv = process.argv.slice(2);
const generalized = argv.includes('--generalized');
const expected = argv.filter((a) => a !== '--generalized');

// Manifests are intentionally UNVERSIONED: Claude Code uses the git SHA as the
// version, and a pinned `version` field freezes the cached copy until that
// string changes — so new commits would silently never reach installers.
// humanizer keeps its own 2.13.0 in its SKILL.md frontmatter, which is a
// different thing and stays.
//
// driftBudget is (lines removed + lines added) against the copy source, so a
// truncated or rewritten skill fails even though its manifest is well-formed.
// ticket-quest's budget only opens up once Task 5's edits land.
const EXPECT = {
  'code-comments': { driftBudget: 0 },
  'humanizer':     { driftBudget: 0 },
  'pr-respond':    { driftBudget: 2 },
  'ticket-quest':  { driftBudget: generalized ? 24 : 0 },
  // No copy source in symmetry.world — the existsSync guard skips its drift check.
  'design-tournament': { driftBudget: 0 },
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
  if ('version' in pj) fail(`${p.name}: plugin.json has a version field — manifests are unversioned (git SHA is the version; a pin freezes the cache)`);
  if ('version' in p) fail(`${p.name}: marketplace entry has a version field — same rule`);
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
