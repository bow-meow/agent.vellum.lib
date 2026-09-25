import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../mk-worktree.mjs';

const SCRIPT = fileURLToPath(new URL('../mk-worktree.mjs', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

let tmp, root, alpha, beta;

function makeClone(name) {
  const origin = join(tmp, `${name}.git`);
  const seed = join(tmp, `${name}-seed`);
  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '--quiet', '-b', 'main', seed]);
  git(seed, 'config', 'user.email', 't@t');
  git(seed, 'config', 'user.name', 't');
  writeFileSync(join(seed, 'f.txt'), name);
  git(seed, 'add', '.');
  git(seed, 'commit', '--quiet', '-m', 'init');
  git(seed, 'branch', 'release/1.0');
  git(seed, 'remote', 'add', 'origin', origin);
  git(seed, 'push', '--quiet', 'origin', 'main', 'release/1.0');
  const clone = join(tmp, name);
  execFileSync('git', ['clone', '--quiet', origin, clone]);
  return clone;
}

function run(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  return { code: r.status, out: r.stdout, summary: JSON.parse(lines.at(-1)) };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mkwt-'));
  root = join(tmp, 'ticket-work');
  alpha = makeClone('alpha');
  beta = makeClone('beta');
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

test('creates one worktree per repo on one branch, defaulting to origin/HEAD', () => {
  const r = run('ABC-12', 'fix_thing', '--repo', alpha, '--repo', `${beta}=origin/release/1.0`);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.summary.branch, 'akt/ABC-12_fix_thing');
  const [a, b] = r.summary.worktrees;
  assert.equal(a.base, 'origin/main');
  assert.equal(b.base, 'origin/release/1.0');
  assert.equal(a.path, join(root, 'ABC-12', 'alpha'));
  assert.equal(git(a.path, 'branch', '--show-current'), 'akt/ABC-12_fix_thing');
  assert.equal(git(b.path, 'branch', '--show-current'), 'akt/ABC-12_fix_thing');
});

test('does not set an upstream, so a push cannot land on the base branch', () => {
  const r = run('ABC-12', 'x', '--repo', alpha);
  assert.equal(r.code, 0, r.out);
  const up = spawnSync('git', ['-C', r.summary.worktrees[0].path, 'rev-parse', '--abbrev-ref', '@{upstream}']);
  assert.notEqual(up.status, 0);
});

test('--dry-run resolves everything but creates nothing', () => {
  const r = run('ABC-12', 'x', '--repo', alpha, '--dry-run');
  assert.equal(r.code, 0, r.out);
  assert.equal(r.summary.dryRun, true);
  assert.equal(existsSync(join(root, 'ABC-12')), false);
});

test('an unresolvable base fails before anything is created', () => {
  const r = run('ABC-12', 'x', '--repo', alpha, '--repo', `${beta}=origin/nope`);
  assert.equal(r.code, 1);
  assert.match(r.summary.error, /origin\/nope/);
  assert.equal(existsSync(join(root, 'ABC-12')), false);
  assert.equal(git(alpha, 'branch', '--list', 'akt/*'), '');
});

test('an existing ticket dir exits 3 and leaves it alone', () => {
  mkdirSync(join(root, 'ABC-12'), { recursive: true });
  writeFileSync(join(root, 'ABC-12', 'keep.txt'), 'mine');
  const r = run('ABC-12', 'x', '--repo', alpha);
  assert.equal(r.code, 3);
  assert.ok(existsSync(join(root, 'ABC-12', 'keep.txt')));
});

test('an existing branch exits 3', () => {
  git(alpha, 'branch', 'akt/ABC-12_x');
  const r = run('ABC-12', 'x', '--repo', alpha);
  assert.equal(r.code, 3);
  assert.match(r.summary.error, /akt\/ABC-12_x/);
});

test('a failure part-way rolls back the worktrees already made', () => {
  // A registered-but-missing worktree at beta's target makes its add fail after alpha's succeeded.
  git(beta, 'worktree', 'add', '--quiet', '--detach', join(root, 'ABC-99', 'beta'), 'origin/main');
  rmSync(join(root, 'ABC-99'), { recursive: true, force: true });
  const r = run('ABC-99', 'x', '--repo', alpha, '--repo', beta);
  assert.equal(r.code, 2, r.out);
  assert.equal(existsSync(join(root, 'ABC-99')), false);
  assert.equal(git(alpha, 'branch', '--list', 'akt/ABC-99_x'), '');
  assert.doesNotMatch(git(alpha, 'worktree', 'list'), /ABC-99/);
});

test('parseArgs rejects bad tickets, bad slugs, and missing repos', () => {
  assert.throws(() => parseArgs(['abc-12', 'x', '--repo', 'r']), /ticket must match/);
  assert.throws(() => parseArgs(['ABC-12', 'has space', '--repo', 'r']), /slug must match/);
  assert.throws(() => parseArgs(['ABC-12', 'x']), /--repo/);
  assert.throws(() => parseArgs(['ABC-12']), /usage/);
});

test('parseArgs splits a Windows clone path from its base on the first = after the drive', () => {
  const o = parseArgs(['ABC-12', 'x', '--repo', 'C:\\repos\\a=origin/release/1.0', '--repo', 'C:\\repos\\b']);
  assert.deepEqual(o.repos, [
    { clone: 'C:\\repos\\a', base: 'origin/release/1.0' },
    { clone: 'C:\\repos\\b', base: '' },
  ]);
});
