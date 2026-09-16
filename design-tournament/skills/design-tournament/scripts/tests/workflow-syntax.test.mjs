import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dir = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const WF = 'tournament-workflow.mjs';
const src = readFileSync(dir + WF, 'utf8');

test('the workflow parses as a workflow body', () => {
  // `node --check` rejects this file: it uses top-level return and await, which
  // are illegal in a plain module but legal here because the Workflow runtime
  // wraps the script in an async function. Mirror that wrapper to syntax-check.
  const body = src.replace(/^export const meta = /m, 'const meta = ');
  assert.doesNotThrow(() => {
    new Function(
      'args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow',
      `return (async () => {\n${body}\n})()`
    );
  });
});

test('meta is the first statement and is a pure literal', () => {
  assert.match(src, /^export const meta = \{/, 'meta must be the first statement');
  const meta = src.slice(0, src.indexOf('\n};') + 3);
  assert.doesNotMatch(meta, /\$\{|\w+\(|\.\.\./, 'meta must be a pure literal — no calls, spreads, or interpolation');
});

test('no sandbox-forbidden calls', () => {
  // These throw inside the workflow sandbox because they would break resume.
  for (const banned of ['Date.now()', 'new Date()', 'Math.random()']) {
    assert.ok(!src.includes(banned), `${banned} is unavailable in the workflow sandbox`);
  }
});

test('the workflow inlines exactly the same citation regex as tally.mjs', () => {
  const grab = (f) => {
    const m = readFileSync(dir + f, 'utf8').match(/const CITATION = (\/.*\/);/);
    assert.ok(m, `no CITATION literal found in ${f}`);
    return m[1];
  };
  assert.equal(grab(WF), grab('tally.mjs'),
    'CITATION drifted between the workflow and tally.mjs — they must stay identical');
});

test('the workflow and tally.mjs agree on the default word cap', () => {
  assert.match(src, /cap = 600/, 'workflow default cap is not 600');
  assert.match(readFileSync(dir + 'tally.mjs', 'utf8'), /cap = 600/, 'tally default cap is not 600');
});
