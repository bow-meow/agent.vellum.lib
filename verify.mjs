#!/usr/bin/env node
// Marketplace consistency check. Usage: node verify.mjs <plugin-name>... (in catalogue order)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const expected = process.argv.slice(2);

// Manifests are intentionally UNVERSIONED: Claude Code uses the git SHA as the
// version, and a pinned `version` field freezes the cached copy until that
// string changes — so new commits would silently never reach installers.
// humanizer keeps its own 2.13.0 in its SKILL.md frontmatter, which is a
// different thing and stays.

let bad = 0;
const fail = (m) => { console.error('FAIL ' + m); bad++; };

const mk = JSON.parse(readFileSync(`${root}/.claude-plugin/marketplace.json`, 'utf8'));
if (mk.name !== 'vellum') fail(`marketplace name is "${mk.name}", expected "vellum"`);
if (mk.owner?.name !== 'bow-meow') fail(`owner is "${mk.owner?.name}", expected "bow-meow"`);

const names = mk.plugins.map((p) => p.name);
if (names.join(',') !== expected.join(',')) fail(`plugins are [${names}], expected [${expected}]`);

for (const p of mk.plugins) {
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
  if (p.name.startsWith('amag-') !== /AMAG-specific\.$/.test(p.description))
    fail(`${p.name}: an amag- name and an "AMAG-specific." description go together`);
}

console.log(bad ? `${bad} failure(s)` : `OK — ${names.length} plugin(s): ${names.join(', ')}`);
process.exit(bad ? 1 : 0);
