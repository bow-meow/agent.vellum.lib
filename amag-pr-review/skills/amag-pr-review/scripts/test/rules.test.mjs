import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { findTool, RULES_DIR } from '../static.mjs';

const tool = findTool();

// Each rules/<name>.yml has a <name>.<ext> fixture whose "ruleid:" and "ok:" comments pin what it matches.
test('every rule matches its fixture lines and nothing else', { skip: !tool && 'no opengrep or semgrep installed' }, () => {
  const r = spawnSync(tool, ['scan', '--test', RULES_DIR], { encoding: 'utf8', timeout: 600000 });
  const out = `${r.stdout}\n${r.stderr}`;
  assert.match(out, /All tests passed/, out.split(/\r?\n/).slice(-20).join('\n'));
});
