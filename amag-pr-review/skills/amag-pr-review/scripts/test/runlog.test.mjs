import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logEntry, logPath, parseArgs, runContext, skillVersion } from '../runlog.mjs';

const script = fileURLToPath(new URL('../runlog.mjs', import.meta.url));

const verified = { findings: [
  { id: 'f1', verdict: 'confirmed', severity: 'Medium', dimension: 'correctness', sources: ['correctness-1'], path: 'a.cs', line: 3, match: 'new', claim: 'race on save', impact: 'two saves keep one row' },
  { id: 'f2', verdict: 'confirmed', severity: 'Low/nit', sources: ['tests-design-2'], path: 'b.cs', line: 9, match: 'new' },
  { id: 'f3', verdict: 'dropped', severity: 'Low', sources: ['sql-1', 'sql-2'], reason: 'index exists', confidence: 'high', confidence_reason: 'saw IX_A' },
  { id: 'f4', verdict: 'dropped', unconfirmed: true, severity: 'Low', sources: ['security-1'], reason: 'no caller found' },
] };
const built = [
  { id: 'f1', status: 'change', reviewers: ['correctness'], confidence: 'medium', confidenceReason: 'whether sync runs first', tokens: 4000 },
  { id: 'f2', status: 'change', reviewers: ['tests-design'], confidence: 'high', confidenceReason: 'traced', tokens: 1000 },
];

test('logEntry keeps every finding with what the header leaves out, the pick, the edit and the comment id', () => {
  const e = logEntry({ key: 'ws-repo-PR7', mode: 'pr', pr: { ws: 'ws', repo: 'repo', id: 7 }, head: 'abc',
    skill: { version: 'v1', model: 'Opus 5.5' }, run: { changed: 120 }, verified, built, usage: { correctness: 3000, verify: 2000 },
    posted: ['f1'], declined: ['f2'], edited: ['f1'], comments: { f1: 555 }, now: new Date('2026-10-21T10:00:00Z') });
  assert.deepEqual([e.v, e.at, e.mode, e.pr.id, e.totalTokens, e.run.changed], [1, '2026-10-21T10:00:00.000Z', 'pr', 7, 5000, 120]);
  assert.deepEqual(e.findings.map(f => [f.id, f.verdict, f.confidence, f.posted, f.edited, f.commentId]), [
    ['f1', 'confirmed', 'medium', true, true, 555], ['f2', 'confirmed', 'high', false, false, null],
    ['f3', 'dropped', 'high', null, false, null], ['f4', 'dropped', null, null, false, null]]);
  assert.deepEqual([e.findings[0].claim, e.findings[0].impact, e.findings[0].confidenceReason, e.findings[0].tokens], ['race on save', 'two saves keep one row', 'whether sync runs first', 4000]);
  assert.deepEqual([e.findings[2].reviewers, e.findings[2].reason, e.findings[2].confidenceReason], [['sql'], 'index exists', 'saw IX_A']);
  assert.equal(e.findings[3].unconfirmed, true);
  assert.equal(e.findings[0].reason, null);
});

test('logEntry keeps the re-check verdict of each previous finding and its pick, by c<commentId>', () => {
  const v = { findings: [], previous: [
    { comment_id: 70, status: 'conceded', codeChanged: false, note: 'author is right: guarded in caller' },
    { comment_id: 71, status: 'disputed', codeChanged: false, note: 'still unguarded on import' },
    { comment_id: 72, status: 'still-applies', codeChanged: false },
  ] };
  const e = logEntry({ key: 'k', mode: 'pr', verified: v, built: [], posted: ['c70', 'c71'], declined: [], edited: ['c70'], flipped: ['c71'] });
  assert.deepEqual(e.previous.map(p => [p.commentId, p.status, p.posted, p.edited, p.flipped]),
    [[70, 'conceded', true, true, false], [71, 'disputed', true, false, true], [72, 'still-applies', null, false, false]]);
  assert.deepEqual(logEntry({ key: 'k', mode: 'local', verified: { findings: [] }, built: [] }).previous, []);
});

test('runContext reads the reviewers, chunks, diff size and recheck load from the work dir', () => {
  const w = mkdtempSync(join(tmpdir(), 'rc-'));
  for (const f of ['cand-correctness-1.json', 'cand-correctness-2.json', 'cand-ticket-fit.json', 'cov-correctness.json']) writeFileSync(join(w, f), '[]');
  mkdirSync(join(w, 'chunks'));
  writeFileSync(join(w, 'chunks', '1.diff'), '');
  writeFileSync(join(w, 'chunks', '2.diff'), '');
  writeFileSync(join(w, 'contested.json'), JSON.stringify([{ id: 'f1' }]));
  writeFileSync(join(w, 'context.diff'), 'diff --git a/x.cs b/x.cs\n--- a/x.cs\n+++ b/x.cs\n@@ -1,1 +1,2 @@\n a\n+b\n');
  assert.deepEqual(runContext(w), { changed: 1, reviewers: ['correctness', 'ticket-fit'], chunks: 2, recheckItems: 1 });
  assert.deepEqual(runContext(join(w, 'missing')), { changed: null, reviewers: [], chunks: 0, recheckItems: 0 });
});

test('skillVersion names the plugin cache folder, which is the commit it was installed from', () => {
  assert.equal(skillVersion('C:\\Users\\x\\.claude\\plugins\\cache\\vellum\\amag-pr-review\\1e8b0b5abcde\\skills\\amag-pr-review'), '1e8b0b5abcde');
});

test('logPath refuses a key that could leave the log folder', () => {
  assert.match(logPath('local-SYM-1', 'R'), /[\\/]\.log[\\/]local-SYM-1\.jsonl$/);
  assert.throws(() => logPath('../x', 'R'), /log key/);
});

test('parseArgs reads the picks and comment ids, and refuses malformed ones', () => {
  const o = parseArgs(['append', 'k', 'w', '--pr', 'ws/repo/7', '--posted', 'f1,f2', '--declined', '', '--comments', 'f1=11,f2=12']);
  assert.deepEqual([o.pr, o.posted, o.declined, o.comments], [{ ws: 'ws', repo: 'repo', id: 7 }, ['f1', 'f2'], [], { f1: 11, f2: 12 }]);
  assert.equal(parseArgs(['other']), null);
  assert.throws(() => parseArgs(['append', 'k', 'w', '--pr', 'ws/repo']), /--pr/);
  assert.throws(() => parseArgs(['append', 'k', 'w', '--comments', 'f1=x']), /--comments/);
  assert.throws(() => parseArgs(['append', 'k', 'w', '--mode', 'dry']), /--mode/);
  assert.throws(() => parseArgs(['append', 'k', 'w', '--bogus', '1']), /unknown flag/);
});

test('CLI append writes one line per run under PR_REVIEW_ROOT, and skips a run that built nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'log-'));
  const w = mkdtempSync(join(tmpdir(), 'w-'));
  const env = { ...process.env, PR_REVIEW_ROOT: root };
  const run = extra => JSON.parse(execFileSync('node', [script, 'append', 'ws-repo-PR7', w, ...extra], { encoding: 'utf8', env }));
  assert.equal(run([]).logged, null);
  writeFileSync(join(w, 'verified.json'), JSON.stringify(verified));
  writeFileSync(join(w, 'factcheck.json'), JSON.stringify(built));
  assert.equal(run(['--pr', 'ws/repo/7', '--posted', 'f1', '--comments', 'f1=9']).findings, 4);
  run(['--mode', 'local', '--ticket', 'SYM-1']);
  const lines = readFileSync(join(root, '.log', 'ws-repo-PR7.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(lines.map(l => [l.mode, l.findings[0].commentId, l.usage]), [['pr', 9, null], ['local', null, null]]);
  assert.match(lines[0].skill.model, /\S/);
});
