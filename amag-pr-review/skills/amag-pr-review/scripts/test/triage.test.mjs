import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDiff } from '../anchors.mjs';
import { changedRuns, clipRuns } from '../coverage.mjs';
import {
  hintsOf, checkTriage, applyTriage, scopeText, triage, triageCheck, reviewers, coverage, failed, TRIAGED, CHUNK_SIZE,
} from '../dispatch.mjs';

const SKILL = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function fileDiff(path, lines, start = 1) {
  const out = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, `@@ -${start},1 +${start},${lines.length + 1} @@`, ' keep'];
  for (const l of lines) out.push(`+${l}`);
  return out.join('\n');
}

const filler = (n, word = 'line') => Array.from({ length: n }, (_, i) => `var x${i} = ${word}${i};`);

// 250 changed lines: A.cs has a lock at new line 3, B.cs a query at new line 2, C.cs nothing.
const DIFF = [
  fileDiff('src/A.cs', ['int a = 1;', 'lock (gate) {', '  count++;', '}', ...filler(80)]),
  fileDiff('src/B.cs', ['var q = "SELECT * FROM BADGE";', ...filler(80)]),
  fileDiff('src/C.cs', filler(85)),
].join('\n') + '\n';

function workDir({ diff = DIFF, sql = true, changed = 250 } = {}) {
  const w = mkdtempSync(join(tmpdir(), 'triage-w-'));
  const wt = join(w, 'wt');
  writeFileSync(join(w, 'repos.json'), JSON.stringify({
    mode: 'pr', dryRun: false, pr: { ws: 'amag-engineering', repo: 'symmetryclassic', id: 42, title: 'T' },
    ticketKey: null, ticketDir: null,
    repos: [{ name: 'symmetryclassic', ws: 'amag-engineering', repo: 'symmetryclassic', clone: wt, wt, dest: 'master', mb: 'a', head: 'b', diff: join(w, 'context.diff') }],
  }));
  writeFileSync(join(w, 'context.json'), JSON.stringify({ changed, styles: 0, languages: ['csharp-dotnet'], sql, ticketKey: null }));
  writeFileSync(join(w, 'context.diff'), diff);
  return w;
}

const goodTriage = {
  ranges: {
    'concurrency-races': [{ path: 'src/A.cs', side: 'new', from: 2, to: 6, why: 'lock around a shared counter' }],
    'resources-performance': [],
    security: [],
    sql: [{ path: 'src/B.cs', side: 'new', from: 2, to: 2, why: 'query text' }],
  },
  dismissed: [],
};

test('clipRuns keeps only the parts of runs inside the scope', () => {
  const runs = [{ path: 'src/A.cs', side: 'new', from: 10, to: 20 }, { path: 'src/B.cs', side: 'new', from: 1, to: 5 }];
  assert.deepEqual(clipRuns(runs, [{ path: 'src/A.cs', side: 'new', from: 15, to: 30 }]), [{ path: 'src/A.cs', side: 'new', from: 15, to: 20 }]);
  assert.deepEqual(clipRuns(runs, [{ path: 'src/A.cs', side: 'old', from: 1, to: 30 }]), []);
});

test('hintsOf matches added lines per reviewer and treats every .sql line as a sql hint', () => {
  const diff = [fileDiff('src/A.cs', ['int a = 1;', 'lock (gate) {', 'await Task.WhenAll(jobs);', 'var s = "SELECT 1";', 'await SaveAsync();']),
    fileDiff('db/Proc.sql', ['-- nothing that looks like a query', 'GO'])].join('\n');
  const hints = hintsOf(parseDiff(diff), TRIAGED);
  const by = r => hints.filter(h => h.reviewer === r).map(h => [h.path, h.from, h.to]);
  assert.deepEqual(by('concurrency-races'), [['src/A.cs', 3, 4]], 'lock and await merge into one run');
  assert.deepEqual(by('sql'), [['src/A.cs', 5, 5], ['db/Proc.sql', 2, 3]]);
  assert.deepEqual(by('security'), []);
});

test('checkTriage needs a key per reviewer, ranges on changed lines, and every hint placed or dismissed', () => {
  const runs = changedRuns(parseDiff(DIFF));
  const hints = hintsOf(parseDiff(DIFF), TRIAGED);
  assert.ok(checkTriage(goodTriage, { reviewers: TRIAGED, runs, hints }).ranges);

  const missingKey = { ranges: { ...goodTriage.ranges } };
  delete missingKey.ranges.security;
  assert.match(checkTriage(missingKey, { reviewers: TRIAGED, runs, hints }).errors.join('\n'), /ranges\["security"\] is missing/);

  const offDiff = { ranges: { ...goodTriage.ranges, security: [{ path: 'src/A.cs', side: 'new', from: 900, to: 950, why: 'x' }] } };
  assert.match(checkTriage(offDiff, { reviewers: TRIAGED, runs, hints }).errors.join('\n'), /holds no changed line/);

  const dropped = { ranges: { ...goodTriage.ranges, sql: [] } };
  assert.match(checkTriage(dropped, { reviewers: TRIAGED, runs, hints }).errors.join('\n'), /hint sql src\/B\.cs:2-2 .* not dismissed/);
  const dismissed = { ...dropped, dismissed: [{ reviewer: 'sql', path: 'src/B.cs', side: 'new', from: 2, to: 2, why: 'a log string' }] };
  assert.ok(checkTriage(dismissed, { reviewers: TRIAGED, runs, hints }).ranges);
  const noReason = { ...dropped, dismissed: [{ reviewer: 'sql', path: 'src/B.cs', from: 2, to: 2 }] };
  assert.ok(checkTriage(noReason, { reviewers: TRIAGED, runs, hints }).errors);
});

test('checkTriage merges overlapping ranges for a reviewer', () => {
  const runs = changedRuns(parseDiff(DIFF));
  const out = { ranges: { 'concurrency-races': [
    { path: 'src/A.cs', side: 'new', from: 2, to: 4, why: 'lock' },
    { path: 'src/A.cs', side: 'new', from: 4, to: 8, why: 'counter' },
  ] } };
  assert.deepEqual(checkTriage(out, { reviewers: ['concurrency-races'], runs, hints: [] }).ranges['concurrency-races'],
    [{ path: 'src/A.cs', side: 'new', from: 2, to: 8, why: 'lock; counter' }]);
});

test('triage skips under 200 changed lines, else writes hints and a prompt with no unfilled slot', () => {
  assert.equal(triage(workDir({ changed: 50 }), { skillDir: SKILL }).skip, true);
  const w = workDir();
  const t = triage(w, { skillDir: SKILL });
  assert.equal(t.model, 'sonnet');
  assert.deepEqual(t.reviewers, TRIAGED);
  assert.ok(t.hints >= 2);
  const text = readFileSync(t.promptFile, 'utf8');
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(text));
  assert.match(text, /`concurrency-races`: .*concurrency-races\.md/);
  assert.deepEqual(triage(workDir({ sql: false }), { skillDir: SKILL }).reviewers, TRIAGED.filter(r => r !== 'sql'));
});

test('reviewers drops triaged reviewers with no ranges, scopes the rest, and leaves the others whole', () => {
  const w = workDir();
  triage(w, { skillDir: SKILL });
  writeFileSync(join(w, 'triage.json'), JSON.stringify(goodTriage));
  const res = triageCheck(w, { skillDir: SKILL });
  assert.deepEqual(res, { ok: true, scoped: { 'concurrency-races': { ranges: 1, changedLines: 4 }, sql: { ranges: 1, changedLines: 1 } }, notRun: ['resources-performance', 'security'] });
  const out = reviewers(w, { skillDir: SKILL });
  const names = out.map(o => o.agent);
  assert.ok(!names.includes('security') && !names.includes('resources-performance'));
  assert.ok(names.includes('correctness') && names.includes('regression'));
  assert.equal(out.find(o => o.agent === 'correctness').scope, null);
  assert.match(readFileSync(out.find(o => o.agent === 'correctness').promptFile, 'utf8'), /Your scope is every changed unit in the diff\./);
  const conc = out.find(o => o.agent === 'concurrency-races');
  assert.match(readFileSync(conc.promptFile, 'utf8'), /src\/A\.cs lines 2-6 \(new\): lock around a shared counter/);

  assert.deepEqual(coverage(w, 'concurrency-races'), { ok: false, missing: [{ path: 'src/A.cs', side: 'new', from: 2, to: 4 }, { path: 'src/A.cs', side: 'new', from: 6, to: 6 }], round: 1 });
  writeFileSync(conc.covFile.replace(/^\/([a-z])\//i, '$1:/'), JSON.stringify([{ path: 'src/A.cs', side: 'new', from: 1, to: 7, checked: 'lock' }]));
  assert.deepEqual(coverage(w, 'concurrency-races'), { ok: true, missing: [] });
});

test('a failed or unchecked triage leaves every reviewer reading the whole diff', () => {
  const w = workDir();
  writeFileSync(join(w, 'triage.json'), JSON.stringify({ ranges: {} }));
  assert.equal(triageCheck(w, { skillDir: SKILL }).ok, false);
  assert.ok(reviewers(w, { skillDir: SKILL }).some(o => o.agent === 'security' && o.scope === null));

  writeFileSync(join(w, 'triage.json'), JSON.stringify(goodTriage));
  triageCheck(w, { skillDir: SKILL });
  failed(w, 'triage');
  assert.ok(existsSync(join(w, 'triage.failed')));
  assert.ok(reviewers(w, { skillDir: SKILL }).some(o => o.agent === 'security' && o.scope === null));
});

test('applyTriage over 1000 lines runs a small scope once and splits a large one across its chunks', () => {
  const list = [1, 2].flatMap(chunk => ['correctness', 'security', 'concurrency-races'].map(reviewer => ({ reviewer, chunk })));
  const runs = [{ path: 'a/A.cs', side: 'new', from: 1, to: 900 }, { path: 'b/B.cs', side: 'new', from: 1, to: 900 }];
  const chunkRuns = [[runs[0]], [runs[1]]];
  const triaged = {
    security: [{ path: 'a/A.cs', side: 'new', from: 1, to: 10, why: 's' }],
    'concurrency-races': [{ path: 'a/A.cs', side: 'new', from: 1, to: 900, why: 'c' }, { path: 'b/B.cs', side: 'new', from: 1, to: 10, why: 'c' }],
  };
  assert.ok(900 + 10 > CHUNK_SIZE);
  const out = applyTriage(list, triaged, { runs, chunkRuns });
  const sec = out.filter(a => a.reviewer === 'security');
  assert.deepEqual(sec.map(a => a.chunk), [null]);
  const conc = out.filter(a => a.reviewer === 'concurrency-races');
  assert.deepEqual(conc.map(a => [a.chunk, a.scope.map(s => s.path)]), [[1, ['a/A.cs']], [2, ['b/B.cs']]]);
  assert.deepEqual(out.filter(a => a.reviewer === 'correctness').map(a => a.chunk), [1, 2]);
  assert.ok(applyTriage(list, null, { runs, chunkRuns }).every(a => a.scope === null));
});

test('scopeText lists each range with its reason', () => {
  assert.equal(scopeText(null), 'Your scope is every changed unit in the diff.');
  assert.match(scopeText([{ path: 'x.cs', side: 'old', from: 3, to: 4, why: 'removed lock' }]), /\n  - x\.cs lines 3-4 \(old\): removed lock$/);
});
