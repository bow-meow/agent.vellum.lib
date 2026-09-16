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
const count = (hay, needle) => hay.split(needle).length - 1;
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
