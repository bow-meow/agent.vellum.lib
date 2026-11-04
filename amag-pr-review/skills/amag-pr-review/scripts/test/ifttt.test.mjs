import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findTool, lint, toCandidates } from '../ifttt.mjs';

const tool = findTool();

test('toCandidates makes an unchanged ThenChange target Medium and a broken pair Low, with the block as evidence', () => {
  const raw = { diagnostics: [
    { file: 'src/A.cs', line: 2, severity: 'warning', message: 'changes in this block may need to be reflected in src/B.cs:w',
      target: { label: 'w', raw: '//src/B.cs:w', then_change_line: 4 } },
    { file: 'src/A.cs', line: 6, severity: 'error', message: 'LINT.IfChange without matching ThenChange' },
  ] };
  const read = p => (p === 'src/A.cs' ? 'x\n// LINT.IfChange(w)\nint W = 2;\n// LINT.ThenChange(//src/B.cs:w)\nx\n// LINT.IfChange(c)\n' : null);
  const [warn, err] = toCandidates(raw, { prefix: 'repo', read });
  assert.deepEqual([warn.severity, warn.path, warn.line, warn.repo, warn.rule], ['Medium', 'repo/src/A.cs', 2, 'repo', 'ifttt-lint']);
  assert.match(warn.claim, /paired code at src\/B\.cs:w wasn't changed/);
  assert.ok(warn.failure);
  assert.equal(warn.evidence, '// LINT.IfChange(w)\nint W = 2;\n// LINT.ThenChange(//src/B.cs:w)');
  assert.deepEqual([err.severity, err.failure, err.evidence], ['Low', '', '// LINT.IfChange(c)']);
  assert.match(err.claim, /without matching ThenChange/);
});

test('lint skips cleanly with no tool, and findTool takes an explicit path first', () => {
  assert.equal(lint('/wt', 'abc1234', { tool: null }).skipped, true);
  assert.equal(findTool('/x/il.exe', { exists: p => p === '/x/il.exe', which: () => null }), '/x/il.exe');
  assert.equal(findTool(null, { exists: () => false, which: n => (n === 'ifttt-lint' ? '/bin/ifttt-lint' : null) }), '/bin/ifttt-lint');
});

test('lint flags a changed block whose target was left alone, committed or not', { skip: !tool && 'no ifttt-lint installed' }, () => {
  const wt = mkdtempSync(join(tmpdir(), 'ifttt-'));
  const g = (...a) => execFileSync('git', ['-C', wt, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' }).trim();
  const pair = (w, other) => `// LINT.IfChange(w)\nint W = ${w};\n// LINT.ThenChange(//src/${other}:w)\n`;
  mkdirSync(join(wt, 'src'));
  g('init', '-q');
  writeFileSync(join(wt, 'src', 'A.cs'), pair(1, 'B.cs'));
  writeFileSync(join(wt, 'src', 'B.cs'), pair(1, 'A.cs'));
  g('add', '-A'); g('commit', '-qm', 'base');
  const base = g('rev-parse', 'HEAD');
  writeFileSync(join(wt, 'src', 'A.cs'), pair(2, 'B.cs'));
  g('commit', '-qam', 'change A');
  assert.deepEqual(lint(wt, base, { tool }).candidates.map(c => [c.severity, c.path, c.line]), [['Medium', 'src/A.cs', 1]]);
  writeFileSync(join(wt, 'src', 'B.cs'), pair(2, 'A.cs'));
  assert.deepEqual(lint(wt, base, { tool }).candidates, [], 'an uncommitted change to the target counts');
});
