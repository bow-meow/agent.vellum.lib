import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVELS, levelName, levelOf } from '../levels.mjs';
import { applyTriage, agentName, recheck, reviewers, roster } from '../dispatch.mjs';
import { decision } from '../post.mjs';
import { buildState } from '../finish.mjs';
import { parseArgs } from '../prepare.mjs';

const SKILL = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const names = list => list.map(agentName);
const big = { changed: 500, ticket: true, prDescription: true, sql: true, styles: 150 };

test('levelName defaults to medium and refuses an unknown level', () => {
  assert.equal(levelName(undefined), 'medium');
  assert.equal(levelOf(null), LEVELS.medium);
  assert.throws(() => levelName('extreme'), /unknown level "extreme"/);
});

test('low runs a quick reviewer beside regression, sql and ticket-fit, and nothing else', () => {
  const low = names(roster(big, 0, 'low'));
  assert.deepEqual(low, ['quick', 'regression', 'sql', 'ticket-fit']);
  assert.deepEqual(names(roster({ ...big, changed: 1500 }, 2, 'low')), ['quick-1', 'regression-1', 'sql-1', 'quick-2', 'regression-2', 'sql-2', 'ticket-fit']);
  assert.deepEqual(names(roster({ ...big, changed: 50 }, 0, 'low')), ['combined', 'ticket-fit']);
});

test('medium is the roster that ran before levels existed', () => {
  assert.deepEqual(names(roster(big, 0, 'medium')), names(roster(big)));
  assert.ok(names(roster(big)).includes('tests-design') && names(roster(big)).includes('docs'));
});

test('high adds a failure-paths pass beside correctness, per chunk over 1000 lines, and under 200 lines', () => {
  assert.deepEqual(names(roster(big, 0, 'high')).filter(n => /failure-paths/.test(n)), ['failure-paths']);
  assert.deepEqual(names(roster({ ...big, changed: 1500 }, 2, 'high')).filter(n => /failure-paths/.test(n)), ['failure-paths-1', 'failure-paths-2']);
  assert.deepEqual(names(roster({ ...big, changed: 50 }, 0, 'high')), ['combined', 'failure-paths', 'ticket-fit']);
});

test('the merge threshold follows the level: medium merges small scopes, low and high never merge', () => {
  const list = ['concurrency-races', 'resources-performance', 'sql'].map(reviewer => ({ reviewer, chunk: null }));
  const runs = [{ path: 'a.cs', side: 'new', from: 1, to: 3000 }];
  const r = (from, to) => [{ path: 'a.cs', side: 'new', from, to, why: 'w' }];
  const triaged = { 'concurrency-races': r(1, 100), 'resources-performance': r(200, 300), sql: r(1000, 1900) };
  const at = level => applyTriage(list, triaged, { runs, mergeMax: levelOf(level).mergeMax }).map(a => a.reviewer);
  assert.deepEqual(at('low'), ['concurrency-races', 'resources-performance', 'sql']);
  assert.deepEqual(at('medium'), ['specialists', 'sql']);
  assert.deepEqual(at('high'), ['concurrency-races', 'resources-performance', 'sql']);
});

function workDir(level, changed = 300) {
  const w = mkdtempSync(join(tmpdir(), 'levels-w-'));
  const diff = ['diff --git a/src/A.cs b/src/A.cs', '--- a/src/A.cs', '+++ b/src/A.cs', `@@ -1,1 +1,${changed + 1} @@`, ' keep',
    ...Array.from({ length: changed }, (_, i) => `+var x${i} = ${i};`), ''].join('\n');
  writeFileSync(join(w, 'repos.json'), JSON.stringify({
    mode: 'local', dryRun: false, level, pr: null, ticketKey: 'SYM-9', ticketDir: null,
    repos: [{ name: 'symmetryclassic', clone: join(w, 'wt'), wt: join(w, 'wt'), dest: 'master', mb: 'a', head: null, diff: join(w, 'context.diff') }],
  }));
  writeFileSync(join(w, 'context.json'), JSON.stringify({ changed, styles: 0, languages: ['csharp-dotnet'], sql: false, ticketKey: 'SYM-9' }));
  writeFileSync(join(w, 'context.diff'), diff);
  return w;
}

test('reviewers reads the level from repos.json and high fills a failure-paths prompt', () => {
  const out = reviewers(workDir('high'), { skillDir: SKILL });
  const fp = out.find(o => o.agent === 'failure-paths');
  assert.equal(fp.coverage, 'check');
  const prompt = readFileSync(fp.promptFile, 'utf8');
  assert.match(prompt, /second, independent pass/);
  assert.match(prompt, /dimensions[\\/]correctness\.md.*dimensions[\\/]regression\.md/);
  assert.ok(!reviewers(workDir('low'), { skillDir: SKILL }).some(o => o.agent === 'tests-design'));
});

test('recheck is skipped at low level', () => {
  const w = workDir('low');
  writeFileSync(join(w, 'verified.json'), JSON.stringify({ findings: [] }));
  const r = recheck(w, { skillDir: SKILL });
  assert.equal(r.skip, true);
  assert.match(r.why, /low level: no recheck/);
});

test('a low-level review with nothing open holds instead of approving, but still requests changes', () => {
  const pr = { ws: 'w', repo: 'r', id: 1, state: 'OPEN', myState: null };
  const base = { items: [], stillOpen: [], outcome: [], pr };
  const low = decision({ ...base, level: 'low' });
  assert.equal(low.action, 'hold');
  assert.match(low.why, /low-level review can't approve/);
  assert.deepEqual(low.calls, []);
  assert.equal(decision({ ...base, level: 'medium' }).action, 'approve');
  assert.equal(decision({ ...base, stillOpen: [{}], level: 'low' }).action, 'request-changes');
});

test('a low-level review keeps the previous reviewedCommit so the next review reads the whole change', () => {
  const args = { verified: { findings: [] }, picks: { items: [] }, outcome: [], head: 'new', prev: { reviewedCommit: 'old' } };
  assert.equal(buildState({ ...args, level: 'low' }).reviewedCommit, 'old');
  assert.equal(buildState({ ...args, level: 'high' }).reviewedCommit, 'new');
  assert.equal(buildState({ ...args, prev: null, level: 'low' }).reviewedCommit, undefined);
});

test('prepare takes --level and refuses a missing or unknown one', () => {
  assert.equal(parseArgs(['local', 'SYM-1', '--level', 'high']).level, 'high');
  assert.equal(parseArgs(['local', 'SYM-1']).level, null);
  assert.throws(() => parseArgs(['local', 'SYM-1', '--level']), /--level takes/);
  assert.throws(() => parseArgs(['pr', 'x', '--level', 'max']), /unknown level/);
});
