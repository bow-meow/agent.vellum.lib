import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BB = fileURLToPath(new URL('../bb.mjs', import.meta.url));

// No credentials, so a call that got as far as the network would exit 1, not the 2 of a refused header.
const env = { ...process.env, BITBUCKET_USERNAME: '', BITBUCKET_PASSWORD: '' };

function run(args, body = 'Fixed in abc123, renamed the flag.') {
  return spawnSync(process.execPath, [BB, ...args], { input: body, encoding: 'utf8', env });
}

test('preview puts the full header above the body', () => {
  const r = run(['preview', '--verdict', 'fixed', '--model', 'Opus 5.5', '--confidence', 'high', '--tokens', '1200']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '✅ **fixed** · 🤖 AI:Opus 5.5 · 🎯 high confidence · 🪙 ~1k tokens\n\nFixed in abc123, renamed the flag.\n');
});

test('confidence and tokens are optional', () => {
  const r = run(['preview', '--verdict', 'push-back', '--model', 'Opus 5.5']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^↩️ \*\*push-back\*\* · 🤖 AI:Opus 5\.5\n\n/);
});

test('token counts are rounded to k and M', () => {
  assert.match(run(['preview', '--verdict', 'clarify', '--model', 'm', '--tokens', '999']).stdout, /🪙 ~999 tokens/);
  assert.match(run(['preview', '--verdict', 'clarify', '--model', 'm', '--tokens', '2500000']).stdout, /🪙 ~2\.5M tokens/);
});

for (const [name, args, message] of [
  ['an unknown verdict', ['--verdict', 'done', '--model', 'm'], /--verdict must be one of/],
  ['a missing model', ['--verdict', 'fixed'], /--model is required/],
  ['an unknown confidence', ['--verdict', 'fixed', '--model', 'm', '--confidence', 'sure'], /--confidence must be one of/],
  ['non-numeric tokens', ['--verdict', 'fixed', '--model', 'm', '--tokens', '1.5k'], /--tokens must be a whole number/],
  ['an unknown flag', ['--verdict', 'fixed', '--model', 'm', '--colour', 'red'], /unknown flag --colour/],
]) {
  test(`preview refuses ${name}`, () => {
    const r = run(['preview', ...args]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, message);
  });
}

test('a body that already carries a header is refused', () => {
  const r = run(['preview', '--verdict', 'fixed', '--model', 'm'], '✅ **fixed** · 🤖 AI:m\n\nFixed it.');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /already starts with a header/);
});

test('an empty body is refused', () => {
  const r = run(['preview', '--verdict', 'fixed', '--model', 'm'], '   ');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /empty reply body/);
});

test('reply refuses to post without a valid header, before any network call', () => {
  const r = run(['reply', 'ws', 'repo', '12', '34']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--verdict must be one of/);
});
