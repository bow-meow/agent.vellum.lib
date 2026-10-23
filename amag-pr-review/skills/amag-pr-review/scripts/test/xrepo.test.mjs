import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validRef, slugOf, pendingNeeds, repoFromLink, headOptions, resolveRef, planFromSiblings, collectNeeds, worktreePath, addWorktree, cleanup, reposLines, readLedger, CAP } from '../xrepo.mjs';

test('validRef accepts branch names and rejects option-like or traversing refs', () => {
  for (const r of ['main', 'release/11.1.0-device-management-dashboard', 'anm/SYM-10498_token_expiry_prune']) assert.equal(validRef(r), true, r);
  for (const r of ['-x', '--upload-pack=evil', 'a..b', 'a//b', 'a/', 'x.lock', 'a b', 'a;rm', '', null]) assert.equal(validRef(r), false, String(r));
});

test('slugOf maps bare names and slugs onto the allowlist only', () => {
  assert.equal(slugOf('amag.symmetry.nats'), 'amag-engineering/amag.symmetry.nats');
  assert.equal(slugOf('amag-engineering/esg-ng-ipc'), 'amag-engineering/esg-ng-ipc');
  assert.equal(slugOf('someone-else/esg-ng-ipc'), 'amag-engineering/esg-ng-ipc');
  assert.equal(slugOf('esg-ng'), null);
  assert.equal(slugOf('../../etc'), null);
  assert.equal(slugOf(undefined), null);
});

test('repoFromLink reads the workspace and repo out of a PR link', () => {
  assert.equal(repoFromLink('https://bitbucket.org/amag-engineering/esg-ng-core-linux/pull-requests/812'), 'amag-engineering/esg-ng-core-linux');
  assert.equal(repoFromLink('https://example.com/x'), null);
});

test('headOptions keeps main and release/template branches, main first, newest release next', () => {
  const heads = ['feat/x', 'release/9.12.0-NATS', 'master', 'release/11.2.0-pacs', 'release/11.1.0-dash', 'template/fullsample/1.0.0'];
  assert.deepEqual(headOptions(heads), ['master', 'release/11.2.0-pacs', 'release/11.1.0-dash', 'release/9.12.0-NATS', 'template/fullsample/1.0.0']);
});

test('resolveRef follows the rule table and asks when the rule has no branch', () => {
  const nats = ['master', 'release/11.1.0-device-management-dashboard'];
  assert.deepEqual(resolveRef('amag.symmetry.nats', 'release/11.1.0-device-management-dashboard', nats), { ref: 'release/11.1.0-device-management-dashboard', kind: 'release-match' });
  assert.equal(resolveRef('amag.symmetry.nats', 'release/12.0.0-new', nats).kind, 'ask');
  assert.equal(resolveRef('amag.symmetry.nats', undefined, nats).kind, 'ask');
  assert.deepEqual(resolveRef('esg-ng-core-linux', 'release/11.1.0-x', ['main', 'release/1.00T1X20-rebuild']), { ref: 'main', kind: 'rule' });
  assert.equal(resolveRef('esg-ng-ipc', 'release/x', ['master']).kind, 'ask');
  const cg = resolveRef('natscodegen', 'release/x', ['main', 'template/fullsample/1.0.0']);
  assert.equal(cg.kind, 'ask');
  assert.deepEqual(cg.options, ['main', 'template/fullsample/1.0.0']);
  assert.equal(resolveRef('symmetryclassic', 'release/x', ['release/x']).kind, 'ask');
});

test('planFromSiblings adds one entry per sibling repo, skipping repos already present', () => {
  const sib = [
    { id: 812, source: 'anm/SYM-1', link: 'https://bitbucket.org/amag-engineering/esg-ng-core-linux/pull-requests/812' },
    { id: 813, source: 'anm/SYM-1b', link: 'https://bitbucket.org/amag-engineering/esg-ng-core-linux/pull-requests/813' },
    { id: 90, source: 'anm/SYM-1', link: 'https://bitbucket.org/amag-engineering/symmetryclassic/pull-requests/90' },
    { id: 5, source: '--evil', link: 'https://bitbucket.org/amag-engineering/esg-ng-ipc/pull-requests/5' },
    { id: 6, source: 'x', link: 'https://bitbucket.org/other/unlisted/pull-requests/6' },
  ];
  assert.deepEqual(planFromSiblings(sib, ['amag-engineering/symmetryclassic']), [
    { slug: 'amag-engineering/esg-ng-core-linux', ref: 'anm/SYM-1', kind: 'sibling-pr', why: 'sibling PR #812' },
    { slug: 'amag-engineering/esg-ng-ipc', kind: 'invalid', why: 'sibling PR #5 has an unusable branch name' },
  ]);
});

test('collectNeeds merges requests per repo and rejects unlisted or present repos', () => {
  const { requests, rejected } = collectNeeds([
    { agent: 'security', entries: [{ repo: 'amag.symmetry.nats', question: 'Is exp enforced?', candidates: ['security-2'] }] },
    { agent: 'verify', entries: [{ repo: 'amag-engineering/amag.symmetry.nats', question: 'Where is the revoked list read?' }, { repo: 'evil/thing' }, { repo: 'symmetryclassic' }] },
    { agent: 'broken', entries: { not: 'an array' } },
  ], ['amag-engineering/symmetryclassic']);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].slug, 'amag-engineering/amag.symmetry.nats');
  assert.deepEqual(requests[0].asks.map(a => a.agent), ['security', 'verify']);
  assert.deepEqual(requests[0].asks[1].candidates, []);
  assert.deepEqual(rejected.map(r => r.why), ['not in SIBLING_REPOS', 'already in REPOS']);
});

test('pendingNeeds skips handled .done files and other files', () => {
  assert.deepEqual(pendingNeeds(['needs-security.json', 'needs-verify.done.json', 'needs-sql-2.json', 'cand-sql.json', 'needs-.json']),
    [{ file: 'needs-security.json', agent: 'security' }, { file: 'needs-sql-2.json', agent: 'sql-2' }]);
});

test('worktreePath sits beside the clones, keyed by the review', () => {
  assert.equal(worktreePath('/ar', 'amag-engineering/esg-ng-ipc', 'local-SYM-1'), join('/ar', 'esg-ng-ipc-x-local-SYM-1'));
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'xrepo-'));
  const origin = join(root, 'origin');
  const g = (...a) => execFileSync('git', a, { cwd: origin, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  mkdirSync(origin);
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  writeFileSync(join(origin, 'a.txt'), 'one\n');
  g('add', '.'); g('commit', '-q', '-m', 'one');
  g('switch', '-q', '-c', 'release/1.0');
  writeFileSync(join(origin, 'a.txt'), 'release\n');
  g('commit', '-q', '-am', 'rel');
  g('switch', '-q', 'main');
  const w = join(root, 'ar', '.work', 'amag-engineering-symmetryclassic-PR1');
  mkdirSync(w, { recursive: true });
  return { root, url: pathToFileURL(origin).href, w, ar: join(root, 'ar') };
}

test('addWorktree clones once, checks out the ref detached, records it, and cleanup removes it', () => {
  const { url, w, ar } = fixture();
  const rec = addWorktree(w, 'amag-engineering/esg-ng-ipc', 'release/1.0', 'user-picked', 'exp check', { url });
  assert.equal(rec.path, join(ar, 'esg-ng-ipc-x-amag-engineering-symmetryclassic-PR1'));
  assert.equal(readFileSync(join(rec.path, 'a.txt'), 'utf8').replace(/\r/g, ''), 'release\n');
  assert.match(rec.sha, /^[0-9a-f]{40}$/);
  assert.equal(addWorktree(w, 'amag-engineering/esg-ng-ipc', 'main', 'rule', '', { url }).reused, true);
  assert.equal(readLedger(w).length, 1);
  assert.match(reposLines(w)[0], /^esg-ng-ipc@[0-9a-f]{8} \(user-picked: release\/1\.0; read-only context, not under review\): /);
  assert.deepEqual(cleanup(w), [rec.path]);
  assert.equal(existsSync(rec.path), false);
  assert.deepEqual(readLedger(w), []);
});

test('addWorktree refuses unlisted repos, bad refs and going past the cap', () => {
  const { url, w } = fixture();
  assert.throws(() => addWorktree(w, 'other/repo', 'main', 'rule', '', { url }), /not in SIBLING_REPOS/);
  assert.throws(() => addWorktree(w, 'amag-engineering/esg-ng-ipc', '--upload-pack=x', 'rule', '', { url }), /unusable ref/);
  const slugs = ['amag-engineering/esg-ng-ipc', 'amag-engineering/natscodegen', 'amag-engineering/esg-ng-core-m33'];
  for (const s of slugs.slice(0, CAP)) addWorktree(w, s, 'main', 'rule', '', { url });
  assert.throws(() => addWorktree(w, 'amag-engineering/esg-ng-core-linux', 'main', 'rule', '', { url }), /cap of 3/);
  cleanup(w);
});
