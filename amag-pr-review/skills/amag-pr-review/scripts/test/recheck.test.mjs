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
    { id: 'f1', sources: ['security-1'], verdict: 'confirmed', severity: 'High' },
    { id: 'f2', sources: ['correctness-1'], verdict: 'dropped', severity: 'High', reason: 'handled by middleware' },
    { id: 'f3', sources: ['correctness-2', 'concurrency-races-1'], verdict: 'confirmed', severity: 'Low' },
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
  finding: { verdict: 'confirmed', severity, path: 'a.cs', line: 3, side: 'new', match: 'new', issue: 'x', fix: 'y', confidence: 'high' },
});

test('apply restores overturned findings with the verifier schema and keeps upheld ones dropped', () => {
  const c = contested(verified, cands);
  const out = apply(verified, [overturn('f2'), { id: 'f3', decision: 'uphold', reason: 'ok' }, overturn('sql-1', 'Medium')], c);
  const f2 = out.findings.find(f => f.id === 'f2');
  assert.equal(f2.verdict, 'confirmed');
  assert.deepEqual(f2.sources, ['correctness-1']);
  assert.equal(out.findings.find(f => f.id === 'f3').severity, 'Low');
  assert.deepEqual(out.findings.at(-1), { ...overturn('sql-1', 'Medium').finding, recheck: 'no middleware covers the subject', id: 'r1', sources: ['sql-1'] });
});

test('apply refuses a missing decision, an unknown id, or an overturn that is not blocking', () => {
  const c = contested(verified, cands);
  assert.throws(() => apply(verified, [overturn('f2')], c), /no recheck decision for: f3, sql-1/);
  assert.throws(() => apply(verified, [overturn('f9')], c), /not contested/);
  const low = overturn('f2', 'Low');
  assert.throws(() => apply(verified, [low, { id: 'f3', decision: 'uphold' }, { id: 'sql-1', decision: 'uphold' }], c), /High\/Medium/);
});

test('an overturn must come back at high, or at medium with what it could not confirm', () => {
  const c = contested(verified, cands);
  const rest = [{ id: 'f3', decision: 'uphold' }, { id: 'sql-1', decision: 'uphold' }];
  const at = (confidence, confidence_reason) => {
    const o = overturn('f2');
    return { ...o, finding: { ...o.finding, confidence, confidence_reason } };
  };
  assert.throws(() => apply(verified, [at('low'), ...rest], c), /high or medium/);
  assert.throws(() => apply(verified, [at(undefined), ...rest], c), /high or medium/);
  assert.throws(() => apply(verified, [at('medium', ''), ...rest], c), /confidence_reason/);
  assert.equal(apply(verified, [at('medium', 'whether the job runs before sync'), ...rest], c).findings[1].verdict, 'confirmed');
});

const unsure = {
  findings: [
    { id: 'f1', sources: ['correctness-2'], verdict: 'confirmed', severity: 'Low', confidence: 'low', confidence_reason: 'no caller seen' },
    { id: 'f2', sources: ['correctness-1'], verdict: 'confirmed', severity: 'High', confidence: 'high' },
    { id: 'f3', sources: ['security-1'], verdict: 'confirmed', severity: 'Medium' },
  ],
};
const unsureCands = [
  { id: 'correctness-2', severity: 'Low' },
  { id: 'correctness-1', severity: 'High' },
  { id: 'security-1', severity: 'Medium', confidence: 'low' },
];

test('contested takes every confirmed finding at low confidence, verify\'s rating first, else the reviewer\'s', () => {
  const c = contested(unsure, unsureCands);
  assert.deepEqual(c.map(x => [x.id, x.kind]), [['f1', 'unconfirmed'], ['f3', 'unconfirmed']]);
  assert.equal(c[0].reason, 'no caller seen');
});

test('apply confirms an unconfirmed finding at any severity, or drops it as unconfirmed', () => {
  const c = contested(unsure, unsureCands);
  const confirm = { id: 'f1', decision: 'confirm', reason: 'the import job calls it',
    finding: { verdict: 'confirmed', severity: 'Medium', path: 'a.cs', line: 3, side: 'new', match: 'new', issue: 'x', fix: 'y',
      confidence: 'medium', confidence_reason: 'whether imports run before sync' } };
  const out = apply(unsure, [confirm, { id: 'f3', decision: 'drop', reason: 'no path reaches it' }], c);
  assert.equal(out.findings[0].severity, 'Medium');
  assert.deepEqual(out.findings[0].sources, ['correctness-2']);
  assert.equal(out.findings[0].recheck, 'the import job calls it');
  assert.deepEqual([out.findings[2].verdict, out.findings[2].unconfirmed, out.findings[2].reason], ['dropped', true, 'no path reaches it']);
  const asLow = { ...confirm, finding: { ...confirm.finding, confidence: 'low' } };
  assert.throws(() => apply(unsure, [asLow, { id: 'f3', decision: 'drop' }], c), /confirm it or drop it/);
  assert.throws(() => apply(unsure, [{ id: 'f1', decision: 'uphold' }, { id: 'f3', decision: 'drop' }], c), /confirm or drop/);
});

test('contested refuses candidates that share an id, which verify could not tell apart', () => {
  const dup = [{ id: 'correctness-1', severity: 'High' }, { id: 'correctness-1', severity: 'Low' }];
  assert.throws(() => contested({ findings: [] }, dup), /duplicate candidate id correctness-1/);
});
