import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDiff } from '../anchors.mjs';
import { changedRuns, uncovered } from '../coverage.mjs';

const diff = [
  'diff --git a/src/A.cs b/src/A.cs', '--- a/src/A.cs', '+++ b/src/A.cs',
  '@@ -10,6 +10,7 @@ class A',
  ' keep10',
  '-old11',
  '+new11',
  '+new12',
  ' keep13',
  ' keep14',
  '-gone14',
  '-gone15',
  ' keep17',
  '@@ -40,2 +41,4 @@ class A',
  ' keep41',
  '+new42',
  '+new43',
  ' keep44',
  'diff --git a/README.md b/README.md', '--- a/README.md', '+++ b/README.md',
  '@@ -1,1 +1,2 @@', ' # T', '+More text',
  'diff --git a/package-lock.json b/package-lock.json', '--- a/package-lock.json', '+++ b/package-lock.json',
  '@@ -1,1 +1,2 @@', ' {', '+"x": 1',
  '',
].join('\n');

test('changedRuns lists added runs on the new side and removal-only runs on the old side', () => {
  const runs = changedRuns(parseDiff(diff));
  assert.deepEqual(runs, [
    { path: 'src/A.cs', side: 'new', from: 11, to: 12 },
    { path: 'src/A.cs', side: 'old', from: 14, to: 15 },
    { path: 'src/A.cs', side: 'new', from: 42, to: 43 },
    { path: 'README.md', side: 'new', from: 2, to: 2 },
  ]);
});

test('uncovered returns the lines no ledger entry spans, merged into ranges', () => {
  const runs = changedRuns(parseDiff(diff));
  const ledger = [
    { path: 'src/A.cs', side: 'new', from: 9, to: 11, checked: 'x' },
    { path: 'src\\A.cs', from: 40, to: 50, checked: 'x' },
    { path: 'README.md', side: 'new', from: 1, to: 3, checked: 'x' },
  ];
  assert.deepEqual(uncovered(runs, ledger), [
    { path: 'src/A.cs', side: 'new', from: 12, to: 12 },
    { path: 'src/A.cs', side: 'old', from: 14, to: 15 },
  ]);
});

test('an entry without a checked note does not count', () => {
  const runs = changedRuns(parseDiff(diff)).filter(r => r.path === 'README.md');
  assert.deepEqual(uncovered(runs, [{ path: 'README.md', side: 'new', from: 1, to: 3 }]), runs);
});

test('cli check exits 1 with the gaps, 0 when covered, and --only limits the files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cov-'));
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'coverage.mjs');
  writeFileSync(join(dir, 'd.diff'), diff);
  writeFileSync(join(dir, 'c.json'), JSON.stringify([{ path: 'README.md', from: 2, to: 2, checked: 'read' }]));
  let out;
  try { execFileSync('node', [script, 'check', join(dir, 'd.diff'), join(dir, 'c.json')], { encoding: 'utf8' }); assert.fail('expected exit 1'); }
  catch (e) { assert.equal(e.status, 1); out = JSON.parse(e.stdout); }
  assert.equal(out.missing.length, 3);
  out = JSON.parse(execFileSync('node', [script, 'check', join(dir, 'd.diff'), join(dir, 'c.json'), '--only', '\\.md$'], { encoding: 'utf8' }));
  assert.deepEqual(out, { required: 1, missing: [] });
});

test('a missing or malformed ledger counts as nothing covered', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cov-'));
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'coverage.mjs');
  writeFileSync(join(dir, 'd.diff'), diff);
  try { execFileSync('node', [script, 'check', join(dir, 'd.diff'), join(dir, 'none.json')], { encoding: 'utf8' }); assert.fail('expected exit 1'); }
  catch (e) { assert.equal(e.status, 1); assert.equal(JSON.parse(e.stdout).missing.length, 4); }
});

test('blank and brace-only added lines need no ledger entry', () => {
  const d = ['diff --git a/B.cs b/B.cs', '--- a/B.cs', '+++ b/B.cs', '@@ -0,0 +1,6 @@',
    '+void A() {', '+}', '+', '+   ', '+void B() {', '+}', ''].join('\n');
  const runs = changedRuns(parseDiff(d));
  assert.deepEqual(runs, [{ path: 'B.cs', side: 'new', from: 1, to: 1 }, { path: 'B.cs', side: 'new', from: 5, to: 5 }]);
  assert.deepEqual(uncovered(runs, [{ path: 'B.cs', from: 1, to: 2, checked: 'A' }, { path: 'B.cs', from: 5, to: 6, checked: 'B' }]), []);
});
