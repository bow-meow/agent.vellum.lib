import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDiff } from '../anchors.mjs';
import { changedRuns } from '../coverage.mjs';
import { estimate, estimateFor, extraMaterial, hunksAt, removedBlocksText, reviewers, triage, ESTIMATE_ASK, MAX_REMOVED_LISTED } from '../dispatch.mjs';
import { changedFunctions, callers, MAX_HITS, TOO_COMMON } from '../callers.mjs';
import { findTool, sortHits, stagedName, scan } from '../static.mjs';

const SKILL = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const diff = [
  'diff --git a/src/Q.CPP b/src/Q.CPP', '--- a/src/Q.CPP', '+++ b/src/Q.CPP',
  '@@ -10,4 +10,4 @@ void CQueue::SendCommand(int id)', ' keep', '-  oldCall();', '-  other();', '+  newCall();', ' keep',
  '@@ -40,3 +40,2 @@ void CQueue::Drain()', ' keep', '-  gone();', ' keep',
  'diff --git a/db/P.sql b/db/P.sql', '--- a/db/P.sql', '+++ b/db/P.sql',
  '@@ -1,1 +1,3 @@', ' keep', '+IF @x <= 0', '+  SELECT 1',
  '',
].join('\n');

test('removedBlocksText lists removed-only blocks and says none when there are none', () => {
  const runs = changedRuns(parseDiff(diff));
  assert.equal(removedBlocksText(runs), '\n  - src/Q.CPP old lines 41-41');
  assert.equal(removedBlocksText(runs.filter(r => r.side === 'new')), 'none');
  const many = Array.from({ length: MAX_REMOVED_LISTED + 3 }, (_, i) => ({ path: 'a', side: 'old', from: i, to: i }));
  assert.match(removedBlocksText(many), /and 3 more in the diff$/);
});

test('estimateFor adds typical agent, verify and recheck tokens and asks over the threshold', () => {
  assert.equal(estimateFor({ agents: 2, recheck: false }).estimate, 500000);
  assert.equal(estimateFor({ agents: 2, spent: 100000, recheck: true }).estimate, 700000);
  assert.equal(estimateFor({ agents: 20 }).ask, true);
  assert.equal(estimateFor({ agents: 3 }).ask, false);
  assert.equal(estimateFor({ agents: 1 }).askOver, ESTIMATE_ASK);
});

test('hunksAt returns the new-side span of each hunk holding a hint', () => {
  const files = parseDiff(diff);
  assert.deepEqual(hunksAt(files, [{ path: 'db/P.sql', from: 2, to: 2 }]), [{ path: 'db/P.sql', side: 'new', from: 1, to: 3 }]);
  assert.deepEqual(hunksAt(files, [{ path: 'src/Q.CPP', from: 99, to: 99 }]), []);
});

test('extraMaterial hands callers to tracing reviewers and static output to everyone', () => {
  const m = { indexMaps: [], forward: [], stylesFacts: [], callers: ['W/callers-a.json'], staticCands: 'W/cand-static.json', staticLeads: 'W/static-leads.json' };
  assert.match(extraMaterial('quick', { material: m }), /Callers of the changed functions.*W\/callers-a\.json/);
  assert.ok(!extraMaterial('ticket-fit', { material: m }).includes('Callers'));
  assert.match(extraMaterial('ticket-fit', { material: m }), /Already raised by static analysis.*cand-static\.json.*leads.*static-leads\.json/);
});

test('changedFunctions reads hunk function context and added definitions, skipping keywords and macros', () => {
  const d = [
    'diff --git a/a.cpp b/a.cpp', '--- a/a.cpp', '+++ b/a.cpp',
    '@@ -1,1 +1,4 @@ void CView::CheckForCommand()', ' keep',
    '+void CAction::Execute(int x)', '+bool CAction::ReadyToSend() const', '+  if (ready(x)) IMPLEMENT_THING(x);',
    '',
  ].join('\n');
  assert.deepEqual([...changedFunctions(parseDiff(d)).keys()].sort(), ['CheckForCommand', 'ReadyToSend']);
});

test('callers lists sites, caps them, counts common names, and prefixes paths in local mode', () => {
  const d = ['diff --git a/a.cpp b/a.cpp', '--- a/a.cpp', '+++ b/a.cpp', '@@ -1,1 +1,2 @@ void A::Rare()', ' k', '+x', '',
    'diff --git a/b.cpp b/b.cpp', '--- a/b.cpp', '+++ b/b.cpp', '@@ -1,1 +1,2 @@ void B::Common()', ' k', '+y', ''].join('\n');
  const grep = (wt, name) => Array.from({ length: name === 'Common' ? TOO_COMMON + 1 : MAX_HITS + 2 }, (_, i) => ({ path: 'x.cpp', line: i + 1, text: `${name}();` }));
  const out = callers('/wt', d, { prefix: 'repo', grep });
  assert.equal(out.Rare.sites.length, MAX_HITS);
  assert.equal(out.Rare.more, 2);
  assert.equal(out.Rare.sites[0].path, 'repo/x.cpp');
  assert.deepEqual(out.Common, { changedIn: ['repo/b.cpp'], tooCommon: TOO_COMMON + 1 });
});

test('stagedName lower-cases only the extension', () => {
  assert.equal(stagedName('Source/Txn/TXNALMVW.CPP'), 'Source/Txn/TXNALMVW.cpp');
  assert.equal(stagedName('db/P.sql'), 'db/P.sql');
});

test('sortHits keeps hits on added lines only, splits candidates from leads, and prefixes paths', () => {
  const runs = changedRuns(parseDiff(diff));
  const byStaged = new Map([['src/Q.cpp', 'src/Q.CPP'], ['db/P.sql', 'db/P.sql']]);
  const hit = (path, line, meta) => ({ check_id: `rules.${meta.kind}-rule`, path, start: { line }, end: { line }, extra: { lines: 'code', message: 'm', metadata: meta } });
  const raw = { results: [
    hit('src/Q.cpp', 11, { kind: 'candidate', severity: 'Medium', dimension: 'correctness', claim: 'c', failure: 'f', issue: 'i', impact: 'p', fix: 'x' }),
    hit('src/Q.cpp', 12, { kind: 'candidate', severity: 'Medium' }),
    hit('db/P.sql', 2, { kind: 'lead', dimension: 'sql', lead: 'look' }),
    hit('elsewhere.cpp', 1, { kind: 'candidate' }),
  ] };
  const { candidates, leads } = sortHits(raw, { runs, byStaged, prefix: 'repo' });
  assert.equal(candidates.length, 1, 'line 12 is context, and an unknown path is dropped');
  assert.deepEqual([candidates[0].path, candidates[0].line, candidates[0].severity, candidates[0].failure, candidates[0].confidence], ['repo/src/Q.CPP', 11, 'Medium', 'f', 'medium']);
  assert.deepEqual(leads.map(l => [l.path, l.dimension, l.lead]), [['repo/db/P.sql', 'sql', 'look']]);
});

test('scan skips cleanly with no tool, and findTool takes an explicit path first', () => {
  assert.equal(scan('/wt', diff, { tool: null }).skipped, true);
  assert.equal(findTool('/x/og.exe', { exists: p => p === '/x/og.exe', which: () => null }), '/x/og.exe');
  assert.equal(findTool(null, { exists: () => false, which: n => (n === 'semgrep' ? '/bin/semgrep' : null) }), '/bin/semgrep');
});

test('scan hands the tool the staging folder, not a path per file, with the default ignores off', () => {
  const wt = mkdtempSync(join(tmpdir(), 'static-wt-'));
  mkdirSync(join(wt, 'src'));
  mkdirSync(join(wt, 'db'));
  writeFileSync(join(wt, 'src', 'Q.CPP'), 'x');
  writeFileSync(join(wt, 'db', 'P.sql'), 'x');
  let seen;
  const run = (tool, args, cwd) => {
    seen = { args, ignore: readFileSync(join(cwd, '.semgrepignore'), 'utf8') };
    return { results: [{ check_id: 'rules.r', path: 'src\\Q.cpp', start: { line: 11 }, end: { line: 11 }, extra: { lines: 'c', metadata: { kind: 'lead' } } }] };
  };
  const out = scan(wt, diff, { tool: 'og', run });
  assert.equal(seen.args.at(-1), '.');
  assert.ok(!seen.args.some(a => /Q\.cpp|P\.sql/.test(a)), 'no file paths on the command line');
  assert.equal(seen.ignore, '');
  assert.deepEqual(out.leads.map(l => [l.path, l.from]), [['src/Q.CPP', 11]]);
});

function workDir(level) {
  const w = mkdtempSync(join(tmpdir(), 'cost-w-'));
  const lines = Array.from({ length: 300 }, (_, i) => `+var x${i} = "SELECT ${i}";`);
  const d = ['diff --git a/src/A.cs b/src/A.cs', '--- a/src/A.cs', '+++ b/src/A.cs', '@@ -1,3 +1,302 @@', ' keep', ...lines, ' keep2', '-removed', ''].join('\n');
  writeFileSync(join(w, 'repos.json'), JSON.stringify({ mode: 'local', dryRun: false, level, pr: null, ticketKey: 'SYM-9', ticketDir: null,
    repos: [{ name: 'r', clone: join(w, 'wt'), wt: join(w, 'wt'), dest: 'master', mb: 'a', head: null, diff: join(w, 'context.diff') }] }));
  writeFileSync(join(w, 'context.json'), JSON.stringify({ changed: 301, styles: 0, languages: ['csharp-dotnet'], sql: true, ticketKey: 'SYM-9' }));
  writeFileSync(join(w, 'context.diff'), d);
  return w;
}

test('low level scopes sql from script hints without a triage agent, and reviewers run on its model', () => {
  const w = workDir('low');
  const t = triage(w, { skillDir: SKILL });
  assert.equal(t.skip, true);
  assert.match(t.why, /low level: sql scoped by script hints/);
  assert.deepEqual(JSON.parse(readFileSync(join(w, 'triage-checked.json'), 'utf8')).sql.map(s => [s.from, s.to]), [[1, 302]]);
  const out = reviewers(w, { skillDir: SKILL });
  assert.deepEqual(out.map(o => o.agent), ['quick', 'regression', 'sql']);
  assert.ok(out.every(o => o.model === 'sonnet'));
  assert.ok(out.find(o => o.agent === 'sql').scope);
  assert.match(readFileSync(out.find(o => o.agent === 'quick').promptFile, 'utf8'), /src\/A\.cs old lines 3-3/);
  assert.match(readFileSync(out.find(o => o.agent === 'quick').promptFile, 'utf8'), /You cover the checklists correctness, concurrency-races, resources-performance, security/);
  const e = estimate(w, { skillDir: SKILL });
  assert.deepEqual([e.level, e.model, e.agents, e.estimate], ['low', 'sonnet', 3, 700000]);
});

test('medium reviewers run on sonnet; high reviewers stay on opus', () => {
  assert.ok(reviewers(workDir('medium'), { skillDir: SKILL }).every(o => o.model === 'sonnet'));
  assert.ok(reviewers(workDir('high'), { skillDir: SKILL }).every(o => o.model === 'opus'));
});
