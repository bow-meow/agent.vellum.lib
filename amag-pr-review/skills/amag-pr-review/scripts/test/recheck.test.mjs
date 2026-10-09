import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contested, apply } from '../recheck.mjs';

const cands = [
  { id: 'security-1', severity: 'Medium' },
  { id: 'correctness-1', severity: 'High' },
  { id: 'correctness-2', severity: 'Low' },
  { id: 'concurrency-races-1', severity: 'Medium' },
  { id: 'sql-1', severity: 'High' },
];
const verified = {
  findings: [
    { id: 'f1', sources: ['security-1'], verdict: 'confirmed', severity: 'High', status: 'critical' },
    { id: 'f2', sources: ['correctness-1'], verdict: 'dropped', severity: 'High', reason: 'handled by middleware' },
    { id: 'f3', sources: ['correctness-2', 'concurrency-races-1'], verdict: 'confirmed', severity: 'Low', status: 'suggestion' },
  ],
  previous: [],
};

test('contested picks dropped, downgraded and omitted blocking candidates only', () => {
  const c = contested(verified, cands);
  assert.deepEqual(c.map(x => [x.id, x.kind]), [['f2', 'dropped'], ['f3', 'downgraded'], ['sql-1', 'omitted']]);
  assert.equal(c[1].candidates.length, 2);
});

test('a confirmed blocking finding and a Low candidate dropped as Low are not contested', () => {
  const v = { findings: [{ id: 'f1', sources: ['correctness-2'], verdict: 'dropped', severity: 'Low' }] };
  assert.deepEqual(contested(v, [{ id: 'correctness-2', severity: 'Low' }]), []);
});

const overturn = (id, severity = 'High') => ({
  id, decision: 'overturn', reason: 'no middleware covers the subject',
  finding: { verdict: 'confirmed', severity, path: 'a.cs', line: 3, side: 'new', match: 'new', issue: 'x', fix: 'y' },
});

test('apply restores overturned findings with the right status and keeps upheld ones dropped', () => {
  const c = contested(verified, cands);
  const out = apply(verified, [overturn('f2'), { id: 'f3', decision: 'uphold', reason: 'ok' }, overturn('sql-1', 'Medium')], c);
  const f2 = out.findings.find(f => f.id === 'f2');
  assert.equal(f2.verdict, 'confirmed');
  assert.equal(f2.status, 'critical');
  assert.deepEqual(f2.sources, ['correctness-1']);
  assert.equal(out.findings.find(f => f.id === 'f3').severity, 'Low');
  assert.deepEqual(out.findings.at(-1), { ...overturn('sql-1', 'Medium').finding, status: 'blocking', recheck: 'no middleware covers the subject', id: 'r1', sources: ['sql-1'] });
});

test('apply refuses a missing decision, an unknown id, or an overturn that is not blocking', () => {
  const c = contested(verified, cands);
  assert.throws(() => apply(verified, [overturn('f2')], c), /no recheck decision for: f3, sql-1/);
  assert.throws(() => apply(verified, [overturn('f9')], c), /not contested/);
  const low = overturn('f2', 'Low');
  assert.throws(() => apply(verified, [low, { id: 'f3', decision: 'uphold' }, { id: 'sql-1', decision: 'uphold' }], c), /High\/Medium/);
});
