import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, loadRubrics, runPrompt, gradePrompt, MIN_RUNS } from './suite.mjs';

const rubric = { id: 's1', criteria: [{ id: 'a' }, { id: 'b' }], pass: { mean: 1.5, min: 1 } };
const grade = (run, a, b, total = a + b) => ({ scenario: 's1', run, scores: { a, b }, total });

test('passes when the mean and the lowest run both meet the bar', () => {
  const r = summarize([grade('1', 1, 1), grade('2', 1, 1), grade('3', 1, 0)], [rubric]);
  assert.equal(r.pass, true);
  assert.equal(r.rows[0].mean, 1.67);
});

test('one run under the minimum fails the scenario even when the mean is fine', () => {
  const r = summarize([grade('1', 1, 1), grade('2', 1, 1), grade('3', 0, 0)], [rubric]);
  assert.equal(r.rows[0].pass, false);
});

test('fewer runs than the minimum is invalid, not a pass', () => {
  const r = summarize([grade('1', 1, 1)], [rubric]);
  assert.equal(r.pass, false);
  assert.match(r.problems.join('\n'), new RegExp(`need ${MIN_RUNS}`));
});

test('a grade with missing or unknown criteria is invalid', () => {
  const bad = [
    { scenario: 's1', run: 'x', scores: { a: 1 }, total: 1 },
    { scenario: 's1', run: 'y', scores: { a: 1, b: 1, c: 1 }, total: 3 },
  ];
  const r = summarize(bad, [rubric]);
  assert.equal(r.problems.filter(p => /criteria mismatch/.test(p)).length, 2);
});

test('a grader total that disagrees with its scores is a warning, and the scores decide', () => {
  const r = summarize([grade('1', 1, 1), grade('2', 1, 1), grade('3', 1, 0, 0)], [rubric]);
  assert.equal(r.pass, true);
  assert.deepEqual(r.rows[0].totals, [2, 2, 1]);
  assert.ok(r.warnings.some(w => /total 0 != sum of scores 1/.test(w)));
});

test('every shipped scenario has a scenario file, unique criterion ids and a reachable bar', () => {
  for (const r of loadRubrics()) {
    const ids = r.criteria.map(c => c.id);
    assert.equal(new Set(ids).size, ids.length, r.id);
    assert.ok(r.pass.min <= r.pass.mean && r.pass.mean <= ids.length, r.id);
    assert.match(runPrompt(r.id, 'SKILL.md', 'answer.md'), /What to produce/);
    assert.match(gradePrompt(r.id, 'answer.md', '1', 'out.json'), /criteria/);
  }
});
