import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseEnvSh, runContext, severityFromComment, previousFindings, classify, locateFinding,
  buildRecheck, buildOursPrevious, prepare, scope,
} from '../incremental.mjs';
import { fingerprint } from '../state.mjs';
import { formatComment, header, footer } from '../comment.mjs';
import { posixPath } from '../env.mjs';

const SCRIPT = fileURLToPath(new URL('../incremental.mjs', import.meta.url));
const finding = (o = {}) => ({ commentId: 1, parentId: null, path: 'a.cs', line: 10, side: 'new', severity: 'Medium', status: 'open', pushbackSeen: 0, fingerprint: null, ...o });
const comment = (o = {}) => ({ id: 1, parent: null, path: 'a.cs', line: 10, side: 'new', author: 'Me', raw: '', resolved: false, resolvedBy: null, outdated: false, authorReplied: false, authorReplies: [], ...o });
const noFile = () => null;

test('only open and pending state findings are previous findings; fixed ones are done', () => {
  const state = { findings: [finding({ commentId: 1 }), finding({ commentId: 2, status: 'pending' }), finding({ commentId: 3, status: 'fixed' })] };
  const { findings, bestEffort } = previousFindings(state, []);
  assert.deepEqual(findings.map(f => f.commentId), [1, 2]);
  assert.equal(bestEffort, false);
});

test('a previous finding whose comment is gone from comments-ours.json is closed as deleted', () => {
  const { closed, kept } = classify([finding({ commentId: 5, path: 'x.cs', line: 7 })], [comment({ id: 6 })], 'author');
  assert.deepEqual(closed, [{ commentId: 5, path: 'x.cs', line: 7, why: 'deleted' }]);
  assert.deepEqual(kept, []);
});

test('resolved by someone other than the author is closed; by the author or by nobody named it stays open as authorResolved', () => {
  const findings = [finding({ commentId: 1 }), finding({ commentId: 2 }), finding({ commentId: 3 }), finding({ commentId: 4 })];
  const ours = [
    comment({ id: 1, resolved: true, resolvedBy: 'reviewer' }),
    comment({ id: 2, resolved: true, resolvedBy: 'author' }),
    comment({ id: 3, resolved: true, resolvedBy: null }),
    comment({ id: 4 }),
  ];
  const { closed, kept } = classify(findings, ours, 'author');
  assert.deepEqual(closed.map(c => [c.commentId, c.why]), [[1, 'resolved by reviewer']]);
  assert.deepEqual(kept.map(k => [k.finding.commentId, k.authorResolved]), [[2, true], [3, true], [4, false]]);
});

test('a resolved Info finding is closed whoever resolved it; an unresolved one is not', () => {
  const findings = [finding({ commentId: 1, severity: 'Info' }), finding({ commentId: 2, severity: 'Info' }), finding({ commentId: 3, severity: 'Info' })];
  const ours = [comment({ id: 1, resolved: true, resolvedBy: 'author' }), comment({ id: 2, resolved: true, resolvedBy: null }), comment({ id: 3 })];
  const { closed, kept } = classify(findings, ours, 'author');
  assert.deepEqual(closed.map(c => [c.commentId, c.why]), [[1, 'resolved Info'], [2, 'resolved Info']]);
  assert.deepEqual(kept.map(k => k.finding.commentId), [3]);
});

test('only author replies above pushbackSeen are new, at any severity; absent pushbackSeen means 0', () => {
  const replies = [{ id: 20, raw: 'old' }, { id: 30, raw: 'fixed it' }];
  const findings = [
    finding({ commentId: 1, severity: 'Low', pushbackSeen: 20 }),
    finding({ commentId: 2, severity: 'Low/nit', pushbackSeen: undefined }),
    finding({ commentId: 3, severity: 'High', pushbackSeen: 30 }),
  ];
  const ours = [1, 2, 3].map(id => comment({ id, authorReplies: replies }));
  const { kept } = classify(findings, ours, 'author');
  assert.deepEqual(kept.map(k => k.authorReplies.map(r => r.id)), [[30], [20, 30], []]);
});

test('a reply does not close a finding on its own', () => {
  const { closed, kept } = classify([finding({ severity: 'Low' })], [comment({ authorReplies: [{ id: 9, raw: 'wontfix' }] })], 'author');
  assert.equal(closed.length, 0);
  assert.equal(kept.length, 1);
});

test('classify refuses to guess without the author id, since every resolve would then look like a reviewer one', () => {
  assert.throws(() => classify([finding()], [comment()], null), /AUTHOR_ID/);
  assert.deepEqual(classify([], [], null), { closed: [], kept: [] });
});

test('comment ids match across number and string spellings', () => {
  const { kept } = classify([finding({ commentId: '7' })], [comment({ id: 7, resolved: true, resolvedBy: 'author' })], 'author');
  assert.equal(kept[0].authorResolved, true);
});

const src = ['a', 'b', 'c', 'target', 'e', 'f', 'g'];

test('a fingerprint found at head means unchanged at the located line, even when moved', () => {
  const fp = fingerprint(src.join('\n'), 4);
  const moved = ['x', 'y', ...src].join('\n');
  assert.deepEqual(locateFinding(finding({ line: 4, fingerprint: fp }), () => moved), { line: 6, codeChanged: false });
});

test('a fingerprint not found, or a file gone at head, means changed at the old line', () => {
  const fp = fingerprint(src.join('\n'), 4);
  const edited = src.join('\n').replace('target', 'changed');
  assert.deepEqual(locateFinding(finding({ line: 4, fingerprint: fp }), () => edited), { line: 4, codeChanged: true });
  assert.deepEqual(locateFinding(finding({ line: 4, fingerprint: fp }), noFile), { line: 4, codeChanged: true });
});

test('old-side findings and findings without a fingerprint are codeChanged without reading the file', () => {
  const read = () => { throw new Error('should not read'); };
  assert.deepEqual(locateFinding(finding({ side: 'old', line: 3, fingerprint: null }), read), { line: 3, codeChanged: true });
  assert.deepEqual(locateFinding(finding({ side: 'new', line: 3, fingerprint: null }), read), { line: 3, codeChanged: true });
});

test('buildRecheck writes every kept finding with its fields, authorResolved and new replies, else []', () => {
  const fp = fingerprint(src.join('\n'), 4);
  const kept = [
    { finding: finding({ commentId: 1, parentId: 99, path: 'a.cs', line: 4, fingerprint: fp, severity: 'Low' }), authorResolved: true, authorReplies: [{ id: 5, raw: 'no' }] },
    { finding: finding({ commentId: 2, path: 'b.cs', line: 8, side: 'old', severity: 'High' }), authorResolved: false, authorReplies: [] },
  ];
  const recheck = buildRecheck(kept, p => (p === 'a.cs' ? src.join('\n') : null));
  assert.deepEqual(recheck, [
    { commentId: 1, parentId: 99, path: 'a.cs', line: 4, side: 'new', severity: 'Low', codeChanged: false, authorResolved: true, authorReplies: [{ id: 5, raw: 'no' }] },
    { commentId: 2, parentId: null, path: 'b.cs', line: 8, side: 'old', severity: 'High', codeChanged: true, authorResolved: false, authorReplies: [] },
  ]);
  assert.deepEqual(buildOursPrevious(recheck), [
    { commentId: 1, parentId: 99, path: 'a.cs', line: 4, side: 'new', severity: 'Low' },
    { commentId: 2, parentId: null, path: 'b.cs', line: 8, side: 'old', severity: 'High' },
  ]);
});

test('prepare: closed findings go to the terminal list only; open ones to previous-recheck and ours-previous; dropped copied', () => {
  const state = {
    reviewedCommit: 'abc1234',
    findings: [
      finding({ commentId: 1 }), finding({ commentId: 2, path: 'gone.cs', line: 3 }),
      finding({ commentId: 3, status: 'fixed' }), finding({ commentId: 4 }),
    ],
    dropped: [{ path: 'a.cs', line: 1, claim: 'c', reason: 'r' }],
  };
  const ours = [comment({ id: 1 }), comment({ id: 4, resolved: true, resolvedBy: null })];
  const { files, summary } = prepare({ state, ours, authorId: 'author', readFile: noFile });
  assert.deepEqual(summary, {
    previous: 2, closed: [{ commentId: 2, path: 'gone.cs', line: 3, why: 'deleted' }],
    authorResolved: [4], bestEffort: false, reviewedCommit: 'abc1234',
  });
  assert.deepEqual(files['previous-recheck.json'].map(r => r.commentId), [1, 4]);
  assert.deepEqual(files['ours-previous.json'].map(r => r.commentId), [1, 4]);
  assert.deepEqual(files['dropped-previous.json'], state.dropped);
});

test('prepare writes no dropped-previous.json without dropped entries, and no recheck files when nothing is open', () => {
  const { files, summary } = prepare({ state: { reviewedCommit: 'abc1234', findings: [finding({ status: 'fixed' })], dropped: [] }, ours: [], authorId: 'a', readFile: noFile });
  assert.deepEqual(files, {});
  assert.equal(summary.previous, 0);
});

test('no state: our top-level comments become best-effort previous findings, all codeChanged; replies are skipped', () => {
  const change = formatComment({ status: 'change', model: 'm', issue: 'i', impact: 'b' });
  const note = formatComment({ status: 'note', model: 'm', issue: 'n' });
  const ours = [
    comment({ id: 1, raw: change, authorReplies: [{ id: 4, raw: 'why?' }] }),
    comment({ id: 2, raw: note, path: 'b.cs', line: 5, side: 'old' }),
    comment({ id: 3, parent: 1, raw: `**Still applies** at line 12.\n\n${footer('m')}` }),
    comment({ id: 5, raw: change, resolved: true, resolvedBy: 'reviewer' }),
  ];
  const { files, summary } = prepare({ state: null, ours, authorId: 'author', readFile: () => { throw new Error('no fingerprints to locate'); } });
  assert.equal(summary.bestEffort, true);
  assert.equal(summary.reviewedCommit, null);
  assert.deepEqual(summary.closed.map(c => c.commentId), [5]);
  assert.deepEqual(files['previous-recheck.json'], [
    { commentId: 1, parentId: null, path: 'a.cs', line: 10, side: 'new', severity: null, codeChanged: true, authorResolved: false, authorReplies: [{ id: 4, raw: 'why?' }] },
    { commentId: 2, parentId: null, path: 'b.cs', line: 5, side: 'old', severity: 'Info', codeChanged: true, authorResolved: false, authorReplies: [] },
  ]);
  assert.equal(files['dropped-previous.json'], undefined);
});

test('no state and no top-level comments of ours: nothing to do and not best effort', () => {
  const { files, summary } = prepare({ state: null, ours: [comment({ parent: 9 })], authorId: null, readFile: noFile });
  assert.deepEqual(files, {});
  assert.deepEqual(summary, { previous: 0, closed: [], authorResolved: [], bestEffort: false, reviewedCommit: null });
});

test('severityFromComment maps only the statuses that name a severity', () => {
  assert.equal(severityFromComment(formatComment({ status: 'note', model: 'm', issue: 'x' })), 'Info');
  assert.equal(severityFromComment('[info, AI:Opus 5.5] old'), 'Info');
  assert.equal(severityFromComment('[nit, AI:Opus 5.5] old'), 'Low/nit');
  assert.equal(severityFromComment(`${header('change')}\n\nx\n\n${footer('m')}`), null);
  assert.equal(severityFromComment('plain'), null);
});

test('parseEnvSh undoes env.mjs single quoting; runContext prefers repos.json', () => {
  const env = "AUTHOR_ID='{abc}'\nWT='/c/ai/it'\\''s'\nHEAD_SHA=deadbeef\nMB=cafe\n";
  assert.deepEqual(parseEnvSh(env), { AUTHOR_ID: '{abc}', WT: "/c/ai/it's", HEAD_SHA: 'deadbeef', MB: 'cafe' });
  assert.deepEqual(runContext(null, env), { authorId: '{abc}', wt: "/c/ai/it's", mb: 'cafe', head: 'deadbeef' });
  const repos = { pr: { authorId: '{x}' }, repos: [{ wt: '/c/wt', mb: 'm1', head: 'h1' }] };
  assert.deepEqual(runContext(repos, env), { authorId: '{x}', wt: '/c/wt', mb: 'm1', head: 'h1' });
});

function fakeGit(responses, calls = []) {
  return args => {
    calls.push(args);
    const key = args.join(' ');
    if (!(key in responses)) throw new Error(`git ${key} failed`);
    return responses[key];
  };
}

test('scope: a reviewedCommit missing locally means gone, and nothing is diffed', () => {
  const calls = [];
  const r = scope({ reviewedCommit: 'abc1234', mb: 'mb', head: 'h' }, { git: fakeGit({}, calls), textDiff: () => '' });
  assert.deepEqual(r, { gone: true });
  assert.deepEqual(calls, [['cat-file', '-e', 'abc1234^{commit}']]);
});

test('scope: no reviewedCommit, or one that is not a sha, is gone without asking git', () => {
  const calls = [];
  for (const rc of [undefined, null, '', '--output=x', 'main'])
    assert.deepEqual(scope({ reviewedCommit: rc, mb: 'mb', head: 'h' }, { git: fakeGit({}, calls), textDiff: () => '' }), { gone: true });
  assert.deepEqual(calls, []);
});

test('scope: builds pr-u3 and since with the sql text-diff appended, and filters them through delta', () => {
  const prDiff = 'diff --git a/a.cs b/a.cs\n--- a/a.cs\n+++ b/a.cs\n@@ -1,2 +1,3 @@\n x\n+new line here\n y\n';
  const sinceDiff = 'diff --git a/a.cs b/a.cs\n--- a/a.cs\n+++ b/a.cs\n@@ -1,0 +2 @@\n+new line here\n';
  const git = fakeGit({
    'cat-file -e abc1234^{commit}': '',
    'diff -U3 mb h': prDiff,
    'diff -U0 abc1234 h': sinceDiff,
  });
  const textCalls = [];
  const textDiff = (base, head, text) => { textCalls.push([base, head, text]); return base === 'mb' ? '<sql-pr>' : '<sql-since>'; };
  const r = scope({ reviewedCommit: 'abc1234', mb: 'mb', head: 'h' }, { git, textDiff });
  assert.equal(r.gone, false);
  assert.equal(r.prU3, prDiff + '<sql-pr>');
  assert.equal(r.since, sinceDiff + '<sql-since>');
  assert.deepEqual(textCalls, [['mb', 'h', prDiff], ['abc1234', 'h', sinceDiff]]);
  assert.deepEqual(r.kept, [{ path: 'a.cs', hunks: 1, of: 1, changed: 1 }]);
  assert.match(r.context, /\+new line here/);
});

test('scope: nothing changed since the review gives an empty context; no head falls back to HEAD', () => {
  const git = fakeGit({ 'cat-file -e abc1234^{commit}': '', 'diff -U3 mb HEAD': 'diff --git a/a.cs b/a.cs\n--- a/a.cs\n+++ b/a.cs\n@@ -1 +1,2 @@\n x\n+y\n', 'diff -U0 abc1234 HEAD': '' });
  const r = scope({ reviewedCommit: 'abc1234', mb: 'mb', head: null }, { git, textDiff: () => '' });
  assert.equal(r.context, '');
  assert.deepEqual(r.kept, []);
});

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'incr-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'core.autocrlf', 'false');
  const write = (f, ls) => writeFileSync(join(dir, f), ls.join('\n') + '\n');
  const commit = msg => { git('add', '-A'); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD').trim(); };
  return { dir, git, write, commit };
}

const run = (...a) => JSON.parse(execFileSync(process.execPath, [SCRIPT, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));

test('CLI prepare and scope against a real worktree and work dir', () => {
  const { dir, write, commit } = repo();
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1} of the file`);
  write('a.cs', lines);
  const mb = commit('base');
  lines[5] = 'first round change, reviewed';
  write('a.cs', lines);
  const reviewed = commit('round 1');
  const fp = fingerprint(readFileSync(join(dir, 'a.cs'), 'utf8'), 6);
  lines[30] = 'second round change';
  write('a.cs', lines);
  const head = commit('round 2');

  const W = mkdtempSync(join(tmpdir(), 'incr-w-'));
  writeFileSync(join(W, 'env.sh'), `AUTHOR_ID='author'\nWT='${posixPath(dir)}'\nHEAD_SHA='${head}'\nMB='${mb}'\n`);
  writeFileSync(join(W, 'state-prev.json'), JSON.stringify({ reviewedCommit: reviewed, findings: [finding({ commentId: 1, line: 6, fingerprint: fp })], dropped: [] }));
  writeFileSync(join(W, 'comments-ours.json'), JSON.stringify([comment({ id: 1, line: 6 })]));

  const p = run('prepare', W);
  assert.deepEqual(p, { previous: 1, closed: [], authorResolved: [], bestEffort: false, reviewedCommit: reviewed });
  const recheck = JSON.parse(readFileSync(join(W, 'previous-recheck.json'), 'utf8'));
  assert.deepEqual(recheck.map(r => [r.line, r.codeChanged]), [[6, false]]);
  assert.ok(existsSync(join(W, 'ours-previous.json')));
  assert.ok(!existsSync(join(W, 'dropped-previous.json')));

  const s = run('scope', W);
  assert.equal(s.gone, false);
  assert.equal(s.empty, false);
  assert.deepEqual(s.keptHunks.map(k => k.path), ['a.cs']);
  const ctx = readFileSync(join(W, 'context.diff'), 'utf8');
  assert.match(ctx, /second round change/);
  assert.doesNotMatch(ctx, /first round change/);
  assert.ok(existsSync(join(W, 'pr-u3.diff')) && existsSync(join(W, 'since.diff')));
  assert.equal(JSON.parse(readFileSync(join(W, 'scope.json'), 'utf8')).gone, false);

  writeFileSync(join(W, 'context.diff'), 'untouched');
  writeFileSync(join(W, 'state-prev.json'), JSON.stringify({ reviewedCommit: 'f'.repeat(40), findings: [] }));
  assert.deepEqual(run('scope', W), { gone: true });
  assert.equal(readFileSync(join(W, 'context.diff'), 'utf8'), 'untouched');
  assert.deepEqual(JSON.parse(readFileSync(join(W, 'scope.json'), 'utf8')), { gone: true });
});

test('CLI usage error exits 2', () => {
  assert.throws(() => execFileSync(process.execPath, [SCRIPT, 'bogus'], { stdio: 'ignore' }), e => e.status === 2);
});
