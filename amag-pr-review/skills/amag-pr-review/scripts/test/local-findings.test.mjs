import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decisions, findingsFile } from '../local-findings.mjs';

const script = fileURLToPath(new URL('../local-findings.mjs', import.meta.url));

const verified = { findings: [
  { id: 'f1', verdict: 'confirmed', repo: 'a', path: 'z.cs', line: 9, side: 'new', severity: 'Low', terminal_only: false },
  { id: 'f2', verdict: 'dropped', repo: 'a', path: 'y.cs', line: 1 },
  { id: 'f3', verdict: 'confirmed', repo: 'a', path: 'b.cs', line: 40, side: 'new', severity: 'Medium', terminal_only: true },
  { id: 'f4', verdict: 'confirmed', repo: 'a', path: 'a.cs', line: 5, side: 'new', severity: 'Low', terminal_only: false },
] };
const built = [
  { id: 'f1', status: 'change', reviewers: ['correctness'], confidence: 'high', tokens: 1000, body: '🟠 **change needed** · 🤖 AI:Opus 5.5 · 🔎 correctness\n\nLate one.\n\n**Fix:** do it.' },
  { id: 'f3', status: 'change', reviewers: ['ticket-fit'], confidence: 'low', tokens: 2000, body: '🟠 **change needed** · 🤖 AI:Opus 5.5\n\nWorst one.' },
  { id: 'f4', status: 'change', reviewers: ['security'], confidence: 'medium', tokens: 3000, body: '🟠 **change needed** · 🤖 AI:Opus 5.5\n\nEarly one.' },
];

test('findingsFile keeps confirmed findings, numbered worst first then by path and line', () => {
  const f = findingsFile({ ticketKey: 'SYM-1', verified, built, repos: [], now: new Date('2026-10-07T10:00:00Z') });
  assert.deepEqual(f.findings.map(x => [x.n, x.id]), [[1, 'f3'], [2, 'f4'], [3, 'f1']]);
  assert.equal(f.reviewedAt, '2026-10-07T10:00:00.000Z');
});

test('findingsFile stores the posted text without its header, open and unresolved', () => {
  const [worst, , late] = findingsFile({ ticketKey: 'SYM-1', verified, built, repos: [] }).findings;
  assert.equal(late.text, 'Late one.\n\n**Fix:** do it.');
  assert.equal(worst.terminalOnly, true);
  assert.equal(worst.state, 'open');
  assert.equal(worst.resolution, null);
  assert.deepEqual(worst.reviewers, ['ticket-fit']);
});

test('CLI save records each repo\'s head and whether it was dirty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lf-'));
  const repo = join(dir, 'a');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x']);
  writeFileSync(join(repo, 'new.txt'), 'x');
  writeFileSync(join(dir, 'verified.json'), JSON.stringify(verified));
  writeFileSync(join(dir, 'factcheck.json'), JSON.stringify(built));
  const out = join(dir, 'review-findings.json');
  execFileSync('node', [script, 'save', join(dir, 'verified.json'), join(dir, 'factcheck.json'), out, '--ticket', 'SYM-1', '--repo', 'a', repo, 'develop']);
  const f = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(f.ticketKey, 'SYM-1');
  assert.equal(f.repos[0].dest, 'develop');
  assert.match(f.repos[0].head, /^[0-9a-f]{40}$/);
  assert.equal(f.repos[0].dirty, true);
  assert.equal(f.findings.length, 3);
});

test('CLI save refuses without a ticket or a repo', () => {
  assert.throws(() => execFileSync('node', [script, 'save', 'v.json', 'f.json', 'o.json'], { stdio: 'pipe' }));
});

const previous = { findings: [
  { n: 1, repo: 'a', path: 'x.ts', text: 'No release note for the template change. More detail.\n\n**Fix:** add one.', state: 'dismissed', resolution: 'User decision: no release notes.' },
  { n: 2, repo: 'a', path: 'y.ts', text: 'A real bug.', state: 'fixed', resolution: 'Guard added.' },
  { n: 3, repo: 'b', path: 'z.ps1', text: 'Pin needs the release first.', state: 'open', resolution: 'User decision: note it in the PR description.' },
  { n: 4, repo: 'b', path: 'w.ts', text: 'Untouched.', state: 'open', resolution: null },
] };

test('decisions lists only the user\'s decisions, each with the finding it settled', () => {
  assert.deepEqual(decisions(previous), [
    '- a/x.ts: "No release note for the template change." → User decision: no release notes.',
    '- b/z.ps1: "Pin needs the release first." → User decision: note it in the PR description.',
  ]);
});

test('CLI decisions prints nothing when there is no earlier round', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lf-'));
  assert.equal(execFileSync('node', [script, 'decisions', join(dir, 'missing.json')], { encoding: 'utf8' }), '');
  writeFileSync(join(dir, 'prev.json'), JSON.stringify(previous));
  assert.equal(execFileSync('node', [script, 'decisions', join(dir, 'prev.json')], { encoding: 'utf8' }).trim().split('\n').length, 2);
});

const git = (repo, ...a) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' }).trim();

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'lf-'));
  const repo = join(dir, 'a');
  execFileSync('git', ['init', '-q', repo]);
  writeFileSync(join(repo, 'Log.cs'), 'class Log\n{\n    void Setup() => builder.AddConsole();\n}\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'x');
  writeFileSync(join(repo, 'Log.cs'), 'class Log\n{\n    void Setup() => builder.AddConsole(); // user edit\n}\n');
  const findings = { ticketKey: 'SYM-1', repos: [{ name: 'a', path: repo }], findings: [
    { n: 1, id: 'f1', repo: 'a', path: 'Log.cs', line: 3, text: 'No UTC timestamps.\n\n**Fix:** pin the formatter.', state: 'open', resolution: null },
    { n: 2, id: 'f2', repo: 'a', path: 'Other.cs', line: 1, text: 'Untouched.', state: 'open', resolution: null },
  ] };
  const file = join(dir, 'review-findings.json');
  writeFileSync(file, JSON.stringify(findings));
  return { dir, repo, file };
}

const run = (...a) => execFileSync('node', [script, ...a], { encoding: 'utf8' });

test('snapshot names the tree as it stands, uncommitted edits included, and changes nothing', () => {
  const { repo } = fixture();
  const before = git(repo, 'status', '--porcelain');
  const snap = run('snapshot', repo).trim();
  assert.match(snap, /^[0-9a-f]{40}$/);
  assert.match(git(repo, 'show', `${snap}:Log.cs`), /user edit/);
  assert.equal(git(repo, 'status', '--porcelain'), before);
  assert.equal(git(repo, 'stash', 'list'), '');
});

test('record-fix stores only the fix\'s own change, not the user\'s uncommitted work', () => {
  const { repo, file } = fixture();
  const snap = run('snapshot', repo).trim();
  writeFileSync(join(repo, 'Log.cs'), 'class Log\n{\n    void Setup() => builder.AddSimpleConsole(o => o.UseUtcTimestamp = true); // user edit\n}\n');
  run('record-fix', file, '1', repo, snap, 'Log.cs');
  const f = JSON.parse(readFileSync(file, 'utf8')).findings[0];
  assert.equal(f.fix.repo, 'a');
  assert.equal(f.fix.snapshot, snap);
  assert.deepEqual(f.fix.files, ['Log.cs']);
  assert.match(f.fix.patch, /^\+.*AddSimpleConsole/m);
  assert.match(f.fix.patch, /^-.*AddConsole\(\); \/\/ user edit/m);
  assert.doesNotMatch(f.fix.patch, /^-.*AddConsole\(\);$/m);
});

test('record-fix includes a file the fix created', () => {
  const { repo, file } = fixture();
  const snap = run('snapshot', repo).trim();
  writeFileSync(join(repo, 'LogTests.cs'), 'class LogTests { }\n');
  run('record-fix', file, '1', repo, snap, 'LogTests.cs');
  const f = JSON.parse(readFileSync(file, 'utf8')).findings[0];
  assert.match(f.fix.patch, /^\+\+\+ b\/LogTests\.cs$/m);
  assert.match(f.fix.patch, /^\+class LogTests/m);
});

test('record-fix refuses a fix that changed nothing, and an unknown finding', () => {
  const { repo, file } = fixture();
  const snap = run('snapshot', repo).trim();
  assert.throws(() => execFileSync('node', [script, 'record-fix', file, '1', repo, snap, 'Log.cs'], { stdio: 'pipe' }));
  writeFileSync(join(repo, 'Log.cs'), 'changed\n');
  assert.throws(() => execFileSync('node', [script, 'record-fix', file, '9', repo, snap, 'Log.cs'], { stdio: 'pipe' }));
});

test('fix-diff lists each recorded fix under its finding, and fails when none is recorded', () => {
  const { repo, file } = fixture();
  assert.throws(() => execFileSync('node', [script, 'fix-diff', file], { stdio: 'pipe' }));
  const snap = run('snapshot', repo).trim();
  writeFileSync(join(repo, 'Log.cs'), 'class Log\n{\n    void Setup() => builder.AddSimpleConsole(); // user edit\n}\n');
  run('record-fix', file, '1', repo, snap, 'Log.cs');
  const out = run('fix-diff', file);
  assert.match(out, /^## Finding 1 \(f1\): a\/Log\.cs:3$/m);
  assert.match(out, /No UTC timestamps\./);
  assert.match(out, /```diff\n[\s\S]*AddSimpleConsole[\s\S]*```/);
  assert.doesNotMatch(out, /Finding 2/);
});

test('provenance names the fix that added the flagged lines, from either round\'s file', () => {
  const { dir, repo, file } = fixture();
  const snap = run('snapshot', repo).trim();
  writeFileSync(join(repo, 'Log.cs'), 'class Log\n{\n    void Setup() => builder.AddSimpleConsole(); // user edit\n}\n');
  run('record-fix', file, '1', repo, snap, 'Log.cs');
  const prev = join(dir, 'review-findings.prev.json');
  writeFileSync(prev, readFileSync(file));
  writeFileSync(file, JSON.stringify({ findings: [] }));
  git(repo, 'commit', '-qam', 'later');
  const hit = JSON.parse(run('provenance', repo, 'a', 'Log.cs', '3', '3', file, prev, join(dir, 'missing.json')));
  assert.equal(hit.length, 1);
  assert.equal(hit[0].n, 1);
  assert.equal(hit[0].source, prev);
  assert.match(hit[0].finding, /No UTC timestamps\./);
  assert.deepEqual(JSON.parse(run('provenance', repo, 'a', 'Log.cs', '1', '2', prev)), []);
});
