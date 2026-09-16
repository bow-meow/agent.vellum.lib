import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tally, hasCitation, validateEntries } from '../tally.mjs';

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

test('a file:line citation is recognised', () => {
  assert.equal(hasCitation('as in src/app.ts:42 the handler returns early'), true);
  assert.equal(hasCitation('see README.md:1'), true);
  assert.equal(hasCitation('C:\\repos\\thing\\x.mjs:10 does it'), true);
});

test('prose with no citation is not a citation', () => {
  assert.equal(hasCitation('This design introduces a service layer.'), false);
  assert.equal(hasCitation(''), false);
});

test('a bare version number is not mistaken for a citation', () => {
  assert.equal(hasCitation('bumped to 1.0:2 in the changelog'), false);
});

test('an uncited design is rejected before judging', () => {
  const r = validateEntries([
    { id: 'A', body: 'Refactor via src/index.mjs:12 and split the module.' },
    { id: 'B', body: 'A truly elegant layered architecture.' },
  ]);
  assert.deepEqual(r.accepted.map((d) => d.id), ['A']);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].id, 'B');
  assert.equal(r.rejected[0].reason, 'no-citation');
});

test('an over-length design is rejected for compression, not judged long', () => {
  const long = 'word '.repeat(700) + 'src/a.mjs:1';
  const r = validateEntries([{ id: 'A', body: long }], 600);
  assert.equal(r.accepted.length, 0);
  assert.equal(r.rejected[0].reason, 'over-length');
  assert.ok(r.rejected[0].words > 600);
});

test('a design at exactly the cap is accepted', () => {
  const body = 'src/a.mjs:1 ' + 'word '.repeat(599);
  const r = validateEntries([{ id: 'A', body }], 600);
  assert.equal(r.accepted.length, 1);
});
