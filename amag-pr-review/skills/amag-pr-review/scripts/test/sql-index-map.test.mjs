import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decode, normTable, tablesInSql, tablesFromDiff, indexesIn, buildIndexMap, binarySqlPaths, textDiffs } from '../sql-index-map.mjs';

test('normTable strips schema and brackets', () => {
  assert.equal(normTable('[dbo].[BADGE]'), 'badge');
  assert.equal(normTable('dbo.Events'), 'events');
});

test('tablesInSql finds targets and skips temp tables and table variables', () => {
  const t = tablesInSql('SELECT * FROM dbo.BADGE b JOIN [dbo].[EMP] e ON 1=1; INSERT INTO #tmp SELECT 1; UPDATE @t SET x=1; MERGE INTO AUDITLOG AS t USING x;');
  assert.deepEqual([...t].sort(), ['auditlog', 'badge', 'emp']);
});

test('tablesInSql handles INSERT without INTO', () => {
  const t = tablesInSql("INSERT [dbo].[TimeZoneInfoTable] ([TimeZoneInfoId]) VALUES (89); INSERT INTO #x VALUES (1)");
  assert.deepEqual([...t], ['timezoneinfotable']);
});

test('tablesFromDiff reads added lines only', () => {
  const d = ['diff --git a/p.sql b/p.sql', '--- a/p.sql', '+++ b/p.sql', '@@ -1,2 +1,2 @@', '-SELECT * FROM OLDTABLE', '+SELECT * FROM NEWTABLE', ' GO', ''].join('\n');
  assert.deepEqual([...tablesFromDiff(d)], ['newtable']);
});

test('indexesIn parses CREATE INDEX with INCLUDE', () => {
  const [ix] = indexesIn('CREATE NONCLUSTERED INDEX [IX_Badge_Emp] ON [dbo].[BADGE] ([EMPID] ASC, [STATUS]) INCLUDE ([ACTIVATE])', 'a.sql');
  assert.deepEqual(ix, { table: 'badge', name: 'IX_Badge_Emp', kind: 'index', clustered: false, columns: ['empid', 'status'], include: ['activate'], file: 'a.sql' });
});

test('indexesIn attributes constraints and inline keys to the owning table', () => {
  const sql = [
    'CREATE TABLE [dbo].[EVENTS] (',
    '  [ID] int NOT NULL PRIMARY KEY,',
    '  [SERIAL] int NOT NULL,',
    ')',
    'GO',
    'CREATE TABLE dbo.EMP (',
    '  EMPID int NOT NULL,',
    '  CONSTRAINT PK_EMP PRIMARY KEY CLUSTERED (EMPID)',
    ')',
    'ALTER TABLE dbo.EMP ADD CONSTRAINT UQ_EMP_SSNO UNIQUE NONCLUSTERED (SSNO)',
  ].join('\n');
  const got = indexesIn(sql, 'b.sql').map(i => [i.table, i.kind, i.columns.join(',')]);
  assert.deepEqual(got.sort(), [['emp', 'pk', 'empid'], ['emp', 'unique', 'ssno'], ['events', 'pk', 'id']].sort());
});

test('decode handles UTF-16 LE with and without BOM, and UTF-8 BOM', () => {
  const s = 'CREATE INDEX IX ON T (A)';
  assert.equal(decode(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')])), s);
  assert.equal(decode(Buffer.from(s, 'utf16le')), s);
  assert.equal(decode(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(s)])), s);
});

test('textDiffs turns binary UTF-16 .sql diffs into readable text diffs', () => {
  const root = mkdtempSync(join(tmpdir(), 'sqltxt-'));
  const g = (...a) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim();
  const utf16 = s => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
  g('init', '-q');
  mkdirSync(join(root, 'Db Procs'));
  const p = 'Db Procs/Get.sql';
  writeFileSync(join(root, p), utf16('SELECT 1\r\nFROM dbo.EVENTS\r\n'));
  g('add', '-A'); g('commit', '-qm', 'a');
  const base = g('rev-parse', 'HEAD');
  writeFileSync(join(root, p), utf16('SELECT 2\r\nFROM dbo.EVENTS\r\n'));
  g('commit', '-qam', 'b');
  const binDiff = g('diff', base, 'HEAD');
  assert.match(binDiff, /Binary files/);
  assert.deepEqual(binarySqlPaths(binDiff), [p]);
  const committed = textDiffs(root, base, 'HEAD', [p]);
  assert.match(committed, /^diff --git a\/Db Procs\/Get\.sql b\/Db Procs\/Get\.sql/m);
  assert.match(committed, /^\+SELECT 2/m);
  assert.match(committed, /^-SELECT 1/m);
  writeFileSync(join(root, p), utf16('SELECT 3\r\nFROM dbo.EVENTS\r\n'));
  assert.match(textDiffs(root, base, null, [p]), /^\+SELECT 3/m);
});

test('buildIndexMap scans tracked .sql files, including UTF-16 ones in folders with spaces', () => {
  const root = mkdtempSync(join(tmpdir(), 'sqlmap-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  mkdirSync(join(root, 'Advanced Auditing'));
  writeFileSync(join(root, 'Advanced Auditing', 'Idx.sql'),
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('CREATE INDEX IX_A ON dbo.AUDITLOG (EVTTIME)', 'utf16le')]));
  writeFileSync(join(root, 'other.SQL'), 'CREATE UNIQUE INDEX UX_B ON BADGE (ID)');
  execFileSync('git', ['add', '-A'], { cwd: root });
  const out = buildIndexMap(root, ['auditlog', 'badge', 'nothere']);
  assert.equal(out.tables.auditlog[0].name, 'IX_A');
  assert.equal(out.tables.auditlog[0].file, 'Advanced Auditing/Idx.sql');
  assert.equal(out.tables.badge[0].kind, 'unique-index');
  assert.deepEqual(out.noIndexFound, ['nothere']);
});

test('tablesInSql handles DELETE without FROM and ignores cascades and LINQ', () => {
  const t = tablesInSql('DELETE dbo.BADGE WHERE ID=1; ALTER TABLE A ADD CONSTRAINT F FOREIGN KEY (X) REFERENCES B (Y) ON DELETE CASCADE ON UPDATE CASCADE; var q = from c in cards select c;');
  assert.deepEqual([...t], ['badge']);
});
