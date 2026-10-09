import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellQuote, prEnv } from '../env.mjs';

const script = fileURLToPath(new URL('../env.mjs', import.meta.url));

test('shellQuote survives quotes and command substitution when sourced by bash', () => {
  const v = `x'$(echo pwned)"\`id\``;
  const out = execFileSync('bash', ['-c', `V=${shellQuote(v)}; printf %s "$V"`], { encoding: 'utf8' });
  assert.equal(out, v);
});

test('the CLI default skill dir is this script\'s own folder as a POSIX path bash can use', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-'));
  const prFile = join(dir, 'pr.json');
  writeFileSync(prFile, JSON.stringify({ state: 'OPEN' }));
  const s = execFileSync('node', [script, 'pr', prFile, 'ws', 'repo', '7'], { encoding: 'utf8' });
  const out = execFileSync('bash', ['-c', `${s}\n[ -f "$S/scripts/env.mjs" ] && printf ok`], { encoding: 'utf8' });
  assert.equal(out, 'ok');
  assert.doesNotMatch(s, /^S='~/m);
});

test('prEnv writes PR fields as quoted assignments', () => {
  const pr = {
    state: 'OPEN', author: { account_id: 'u1' },
    source: { repository: { full_name: 'ws/fork' }, branch: { name: "feat/it's" }, commit: { hash: 'abc123' } },
    destination: { branch: { name: 'master' } },
  };
  const s = prEnv(pr, { ws: 'ws', repo: 'repo', pr: 7, ar: '/c/repos/ai-review', skill: '/c/skill' });
  assert.match(s, /^SRC_BRANCH='feat\/it'\\''s'$/m);
  assert.match(s, /^W='\/c\/repos\/ai-review\/\.work\/ws-repo-PR7'$/m);
  assert.match(s, /^WT='\/c\/repos\/ai-review\/repo-PR7'$/m);
  assert.match(s, /^DEST='master'$/m);
  const out = execFileSync('bash', ['-c', `${s}\nprintf '%s|%s|%s' "$SRC_BRANCH" "$SRC_FULL_NAME" "$AUTHOR_ID"`], { encoding: 'utf8' });
  assert.equal(out, "feat/it's|ws/fork|u1");
});
