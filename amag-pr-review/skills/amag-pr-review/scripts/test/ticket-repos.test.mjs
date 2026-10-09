import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveTicketDir, ticketRepos, ticketKeyOf, closestBase, repoSlug } from '../ticket-repos.mjs';

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'base-'));
  const g = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim();
  const commit = m => { writeFileSync(join(dir, 'f.txt'), m); g('add', '-A'); g('commit', '-qm', m); return g('rev-parse', 'HEAD'); };
  g('init', '-q', '-b', 'work');
  return { dir, g, commit };
}

test('closestBase picks the release branch the work was cut from, not master', () => {
  const { dir, g, commit } = gitRepo();
  commit('A'); const b = commit('B'); const c = commit('C');
  g('update-ref', 'refs/remotes/origin/master', c);
  g('checkout', '-q', b);
  const d = commit('D');
  g('update-ref', 'refs/remotes/origin/release/1.0', d);
  commit('E');
  const r = closestBase(dir);
  assert.equal(r.base, 'origin/release/1.0');
  assert.equal(r.ahead, 1);
  assert.equal(r.mergeBase, d);
});

test('closestBase returns null when there are no candidate remote branches', () => {
  const { dir, commit } = gitRepo();
  commit('A');
  assert.equal(closestBase(dir), null);
});

function repo(dir) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, '.git'), 'gitdir: elsewhere'); return dir; }

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'tw-'));
  const t = join(base, 'SYM-100');
  repo(join(t, 'symmetryclassic'));
  repo(join(t, 'INSTALL'));
  repo(join(t, '.claude'));
  mkdirSync(join(t, 'notes'));
  const shared = repo(join(base, 'shared-codejock'));
  symlinkSync(shared, join(t, 'codejock'), 'junction');
  repo(join(base, 'sym-200'));
  return base;
}

test('ticket keys resolve case-insensitively', () => {
  const base = fixture();
  assert.equal(resolveTicketDir('sym-100', base), join(base, 'SYM-100'));
  assert.equal(resolveTicketDir('SYM-200', base), join(base, 'sym-200'));
  assert.equal(resolveTicketDir('SYM-999', base), null);
});

test('child repos are listed, skipping junctions and non-work folders', () => {
  const base = fixture();
  assert.deepEqual(ticketRepos(join(base, 'SYM-100')), [join(base, 'SYM-100', 'symmetryclassic')]);
});

test('a ticket folder that is itself a repo is the repo', () => {
  const base = fixture();
  assert.deepEqual(ticketRepos(join(base, 'sym-200')), [join(base, 'sym-200')]);
});

test('ticketKeyOf finds the key in a path', () => {
  assert.equal(ticketKeyOf('C:\\repos\\ticket-work\\sym-10146\\symmetryclassic'), 'SYM-10146');
  assert.equal(ticketKeyOf('C:\\repos\\other'), null);
});

test('ticketKeyOf accepts project keys containing digits', () => {
  assert.equal(ticketKeyOf('C:\\repos\\ticket-work\\ab2-17\\repo'), 'AB2-17');
});

test('repoSlug handles scp-style, ssh:// and https remotes', () => {
  assert.equal(repoSlug('git@bitbucket.org:amag-engineering/symmetryclassic.git'), 'amag-engineering/symmetryclassic');
  assert.equal(repoSlug('ssh://git@bitbucket.org/amag-engineering/esg-ng-ipc.git'), 'amag-engineering/esg-ng-ipc');
  assert.equal(repoSlug('https://alex@bitbucket.org/amag-engineering/ui-library.git'), 'amag-engineering/ui-library');
  assert.equal(repoSlug('https://bitbucket.org/amag-engineering/ui-library'), 'amag-engineering/ui-library');
  assert.equal(repoSlug('https://github.com/x/y.git'), null);
});

test('closestBase sees nested release/x/y branches', () => {
  const { dir, g, commit } = gitRepo();
  commit('A'); const b = commit('B'); const c = commit('C');
  g('update-ref', 'refs/remotes/origin/master', c);
  g('checkout', '-q', b);
  const d = commit('D');
  g('update-ref', 'refs/remotes/origin/release/11.1/hotfix', d);
  commit('E');
  assert.equal(closestBase(dir).base, 'origin/release/11.1/hotfix');
});
