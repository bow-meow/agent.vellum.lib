import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findingsFile } from '../local-findings.mjs';

const script = fileURLToPath(new URL('../local-findings.mjs', import.meta.url));

const verified = { findings: [
  { id: 'f1', verdict: 'confirmed', repo: 'a', path: 'z.cs', line: 9, side: 'new', severity: 'Low', terminal_only: false },
  { id: 'f2', verdict: 'dropped', repo: 'a', path: 'y.cs', line: 1 },
  { id: 'f3', verdict: 'confirmed', repo: 'a', path: 'b.cs', line: 40, side: 'new', severity: 'Medium', terminal_only: true },
  { id: 'f4', verdict: 'confirmed', repo: 'a', path: 'a.cs', line: 5, side: 'new', severity: 'Low', terminal_only: false },
] };
const built = [
  { id: 'f1', status: 'suggestion', reviewers: ['correctness'], confidence: 'high', tokens: 1000, body: '🟡 **suggestion** · 🤖 AI:Opus 5.5 · 🔎 correctness\n\nLate one.\n\n**Fix:** do it.' },
  { id: 'f3', status: 'blocking', reviewers: ['ticket-fit'], confidence: 'low', tokens: 2000, body: '🟠 **blocking** · 🤖 AI:Opus 5.5\n\nWorst one.' },
  { id: 'f4', status: 'suggestion', reviewers: ['security'], confidence: 'medium', tokens: 3000, body: '🟡 **suggestion** · 🤖 AI:Opus 5.5\n\nEarly one.' },
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
