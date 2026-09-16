import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tally } from '../tally.mjs';

const judge = (id, ranking, adequate = true, graft = null) => ({ id, ranking, adequate, graft });

test('a 3-0 sweep wins', () => {
  const r = tally([
    judge('j1', ['B', 'A', 'C']),
    judge('j2', ['B', 'C', 'A']),
    judge('j3', ['B', 'A', 'C']),
  ]);
  assert.equal(r.outcome, 'winner');
  assert.equal(r.winner, 'B');
  assert.equal(r.firstPlaces.B, 3);
});

test('a 2-1 split wins', () => {
  const r = tally([
    judge('j1', ['B', 'A', 'C']),
    judge('j2', ['A', 'B', 'C']),
    judge('j3', ['B', 'A', 'C']),
  ]);
  assert.equal(r.outcome, 'winner');
  assert.equal(r.winner, 'B');
});

test('a three-way split is a tie, not a coin flip', () => {
  const r = tally([
    judge('j1', ['A', 'B', 'C']),
    judge('j2', ['B', 'C', 'A']),
    judge('j3', ['C', 'A', 'B']),
  ]);
  assert.equal(r.outcome, 'tie');
  assert.deepEqual(r.leaders.sort(), ['A', 'B', 'C']);
});

test('a majority calling it inadequate aborts, even with a clear ranking winner', () => {
  const r = tally([
    judge('j1', ['B', 'A', 'C'], false),
    judge('j2', ['B', 'A', 'C'], false),
    judge('j3', ['B', 'A', 'C'], true),
  ]);
  assert.equal(r.outcome, 'inadequate');
  assert.equal(r.inadequate, 2);
  assert.equal(r.total, 3);
});

test('a single dissenter does not abort', () => {
  const r = tally([
    judge('j1', ['B', 'A', 'C'], false),
    judge('j2', ['B', 'A', 'C'], true),
    judge('j3', ['B', 'A', 'C'], true),
  ]);
  assert.equal(r.outcome, 'winner');
  assert.equal(r.winner, 'B');
});

test('grafts exclude ideas from the winning design', () => {
  const r = tally([
    judge('j1', ['B', 'A', 'C'], true, { from: 'A', idea: 'migration strategy' }),
    judge('j2', ['B', 'A', 'C'], true, { from: 'C', idea: 'rollback path' }),
    judge('j3', ['B', 'A', 'C'], true, { from: 'B', idea: 'should be dropped' }),
  ]);
  assert.equal(r.outcome, 'winner');
  assert.deepEqual(r.grafts.map((g) => g.from).sort(), ['A', 'C']);
});

test('no judges is an error, not an empty winner', () => {
  assert.throws(() => tally([]), /at least one judge/);
});

test('a judge with no ranking is an error', () => {
  assert.throws(() => tally([{ id: 'j1', adequate: true, ranking: [] }]), /no ranking/);
});
