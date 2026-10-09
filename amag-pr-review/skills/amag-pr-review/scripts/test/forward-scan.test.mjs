import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseVersion, compareVersions, suffixOf, declarationsIn, widenings, groupWidenings, matchLeads, newerBranches, scan } from '../forward-scan.mjs';

test('parseVersion reads release branches with or without a suffix and ignores the rest', () => {
  assert.deepEqual(parseVersion('origin/release/11.1.0-device-management-dashboard'), [11, 1, 0]);
  assert.deepEqual(parseVersion('release/11.0.10'), [11, 0, 10]);
  assert.equal(parseVersion('master'), null);
  assert.equal(parseVersion('origin/backup/release/11.2.0-x'), null);
  assert.ok(compareVersions([11, 0, 10], [11, 0, 9]) > 0);
  assert.ok(compareVersions([11, 2, 0], [11, 10, 0]) < 0);
});

test('suffixOf takes the last word of a camel-case name', () => {
  assert.equal(suffixOf('@NodeName'), 'name');
  assert.equal(suffixOf('[ReaderGroupName]'), 'name');
  assert.equal(suffixOf('NODENAME'), 'nodename');
});

test('declarationsIn finds SQL parameters, variables and columns, skipping casts, MAX and comments', () => {
  const sql = [
    'CREATE PROCEDURE dbo.X @NodeName nvarchar(40), @Code VARCHAR (10)',
    'AS',
    '  DECLARE @T TABLE (ReaderName NVARCHAR(40) NOT NULL, Notes nvarchar(max))',
    '  SELECT CAST(x AS nvarchar(40)) -- @Old nvarchar(20)',
    '  /* @Gone nchar(5) */',
  ].join('\n');
  assert.deepEqual(declarationsIn(sql, 'a.sql').map(d => [d.name, d.family, d.width, d.line]), [
    ['NodeName', 'n', 40, 1], ['Code', '', 10, 1], ['ReaderName', 'n', 40, 3],
  ]);
});

test('declarationsIn finds C# SqlParameter widths and length attributes on string properties', () => {
  const cs = [
    'cmd.Parameters.Add("@NodeName", SqlDbType.NVarChar, 40);',
    '[StringLength(40)]',
    'public string ReaderName { get; set; }',
    '[MaxLength(10)] public int Count { get; set; }',
  ].join('\n');
  assert.deepEqual(declarationsIn(cs, 'a.cs').map(d => [d.name, d.width, d.line]), [['NodeName', 40, 1], ['ReaderName', 40, 2]]);
});

test('widenings reports a name that moved to a larger width, not one that kept its old width', () => {
  const before = '@GroupName nvarchar(40), @Other nvarchar(40), @Code varchar(10)';
  const after = '@GroupName nvarchar(100), @Other nvarchar(40), @Code varchar(5)';
  assert.deepEqual(widenings(before, after, 'a.sql'), [{ name: 'GroupName', family: 'n', from: 40, to: 100 }]);
});

test('matchLeads needs the exact name or a suffix pattern across several names, at the same old width', () => {
  const groups = groupWidenings([
    { path: 'a.sql', items: [{ name: 'GroupName', family: 'n', from: 40, to: 100 }, { name: 'FloorGroupName', family: 'n', from: 40, to: 100 }] },
    { path: 'b.sql', items: [{ name: 'AccessCodeName', family: 'n', from: 40, to: 100 }] },
    { path: 'c.sql', items: [{ name: 'Description', family: 'n', from: 50, to: 200 }] },
  ]);
  const leads = matchLeads([
    { name: 'NodeName', family: 'n', width: 40, path: 'p.sql', line: 3 },
    { name: 'NodeName', family: 'n', width: 100, path: 'p.sql', line: 4 },
    { name: 'NodeName', family: '', width: 40, path: 'p.sql', line: 5 },
    { name: 'NewDescription', family: 'n', width: 50, path: 'p.sql', line: 6 },
    { name: 'Description', family: 'n', width: 50, path: 'p.sql', line: 7 },
  ], groups);
  assert.deepEqual(leads.map(l => [l.line, l.widenedTo, l.match]), [[3, 100, 'pattern'], [7, 200, 'exact']]);
});

function repoWithBranches() {
  const dir = mkdtempSync(join(tmpdir(), 'fwd-'));
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  mkdirSync(join(dir, 'sp'));
  const procs = ['ReaderGroup', 'FloorGroup', 'AccessGroup'];
  for (const p of procs) writeFileSync(join(dir, 'sp', `${p}.sql`), `CREATE PROCEDURE ${p} @${p}Name nvarchar(40) AS SELECT 1`);
  writeFileSync(join(dir, 'shared.cs'), 'class A {}');
  writeFileSync(join(dir, 'moved.cs'), Array.from({ length: 20 }, (_, i) => `// line ${i}`).join('\n'));
  g('add', '.'); g('commit', '-q', '-m', 'base');
  g('update-ref', 'refs/remotes/origin/release/11.1.0-x', 'HEAD');
  g('update-ref', 'refs/remotes/origin/release/11.0.10', 'HEAD');
  g('checkout', '-q', '-b', 'next');
  for (const p of procs) writeFileSync(join(dir, 'sp', `${p}.sql`), `CREATE PROCEDURE ${p} @${p}Name nvarchar(100) AS SELECT 1`);
  g('commit', '-q', '-am', 'Extend group names to 100 characters');
  writeFileSync(join(dir, 'shared.cs'), 'class A { int x; }');
  g('commit', '-q', '-am', 'Touch shared');
  mkdirSync(join(dir, 'lib'));
  g('mv', 'moved.cs', 'lib/moved.cs'); g('commit', '-q', '-m', 'Move moved.cs');
  g('update-ref', 'refs/remotes/origin/release/11.2.0-y', 'HEAD');
  return dir;
}

test('newerBranches keeps only higher release versions than the destination', () => {
  const dir = repoWithBranches();
  assert.deepEqual(newerBranches(dir, 'release/11.1.0-x'), ['origin/release/11.2.0-y']);
  assert.deepEqual(newerBranches(dir, 'release/11.0.10'), ['origin/release/11.2.0-y', 'origin/release/11.1.0-x']);
});

test('scan flags a new name parameter at the width the newer branch moved away from, and files it changed', () => {
  const dir = repoWithBranches();
  const diff = [
    'diff --git a/sp/NewProc.sql b/sp/NewProc.sql', '--- /dev/null', '+++ b/sp/NewProc.sql', '@@ -0,0 +1,2 @@',
    '+CREATE PROCEDURE NewProc @NodeName nvarchar(40)', '+AS SELECT 1',
    'diff --git a/shared.cs b/shared.cs', '--- a/shared.cs', '+++ b/shared.cs', '@@ -1 +1 @@', '-class A {}', '+class A { }', '',
  ].join('\n');
  const diffs = mkdtempSync(join(tmpdir(), 'fwd-diffs-'));
  const [b] = scan(dir, diff, 'release/11.1.0-x', { diffsDir: diffs }).branches;
  assert.equal(b.branch, 'origin/release/11.2.0-y');
  assert.deepEqual(b.leads.map(l => [l.path, l.line, l.name, l.widenedTo, l.match]), [['sp/NewProc.sql', 1, 'NodeName', 100, 'pattern']]);
  assert.match(b.leads[0].commits[0], /Extend group names to 100 characters/);
  assert.deepEqual(b.drift.map(d => [d.path, d.commits.map(c => c.replace(/^\S+ /, ''))]), [['shared.cs', ['Touch shared']]]);
  assert.match(readFileSync(b.drift[0].diffFile, 'utf8'), /^\+class A \{ int x; \}$/m);
});

test('scan reports a file the newer branch moved as a rename, not a deletion', () => {
  const dir = repoWithBranches();
  const diff = ['diff --git a/moved.cs b/moved.cs', '--- a/moved.cs', '+++ b/moved.cs', '@@ -1 +1,2 @@', ' // line 0', '+// added', ''].join('\n');
  const diffs = mkdtempSync(join(tmpdir(), 'fwd-diffs-'));
  const [entry] = scan(dir, diff, 'release/11.1.0-x', { diffsDir: diffs }).branches[0].drift;
  assert.deepEqual([entry.path, entry.renamedTo, entry.similarity, entry.pureRename], ['moved.cs', 'lib/moved.cs', 100, true]);
  assert.match(readFileSync(entry.diffFile, 'utf8'), /^rename to lib\/moved\.cs$/m);
});
