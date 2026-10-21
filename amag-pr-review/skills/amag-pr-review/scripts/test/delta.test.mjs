import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filterDelta, parseHunks } from '../delta.mjs';

const lines = n => Array.from({ length: n }, (_, i) => `line ${String(i + 1).padStart(3, '0')} of the file`);

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'delta-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'core.autocrlf', 'false');
  const write = (f, ls) => writeFileSync(join(dir, f), ls.join('\n') + '\n');
  const commit = msg => { git('add', '-A'); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD').trim(); };
  return { dir, git, write, commit };
}

test('a re-review keeps the PR hunks changed since the last review, not earlier ones or base-branch merges', () => {
  const { dir, git, write, commit } = repo();
  const a = lines(200), b = lines(50);
  write('a.cs', a); write('b.cs', b); write('c.cs', lines(30));
  commit('base');
  git('checkout', '-q', '-b', 'feature');
  a[20] = 'first round change, already reviewed';
  b[10] = 'first round change in b, already reviewed';
  write('a.cs', a); write('b.cs', b);
  const reviewed = commit('round 1');
  git('checkout', '-q', 'main');
  const main = lines(30); main[5] = 'a change on main that a merge brings in';
  write('c.cs', main);
  commit('main moves');
  git('checkout', '-q', 'feature');
  git('merge', '-q', '--no-edit', 'main');
  a[150] = 'second round change, not reviewed yet';
  a.splice(100, 1);
  write('a.cs', a);
  commit('round 2');
  const mb = git('merge-base', 'main', 'HEAD').trim();
  const pr = git('diff', '-U3', mb, 'HEAD');
  const since = git('diff', '-U0', reviewed, 'HEAD');
  const { text, kept } = filterDelta(pr, since);
  assert.deepEqual(kept.map(k => [k.path, k.hunks, k.of]), [['a.cs', 2, 3]]);
  assert.match(text, /\+second round change, not reviewed yet/);
  assert.match(text, /-line 101 of the file/);
  assert.doesNotMatch(text, /first round change/);
  assert.doesNotMatch(text, /a change on main/);
  assert.doesNotMatch(text, /b\.cs|c\.cs/);
  writeFileSync(join(dir, 'slice.diff'), text);
  git('apply', '-R', '--check', 'slice.diff');
});

test('a file the PR adds keeps only the slices around lines changed since, and the result still applies', () => {
  const { dir, git, write, commit } = repo();
  write('base.cs', lines(5));
  commit('base');
  git('checkout', '-q', '-b', 'feature');
  const added = lines(300);
  write('New.cs', added);
  const reviewed = commit('round 1 adds a file');
  added[40] = 'edited near the top';
  added[250] = 'edited near the bottom';
  write('New.cs', added);
  commit('round 2');
  const mb = git('merge-base', 'main', 'HEAD').trim();
  const { text, kept } = filterDelta(git('diff', '-U3', mb, 'HEAD'), git('diff', '-U0', reviewed, 'HEAD'));
  assert.deepEqual(kept, [{ path: 'New.cs', hunks: 2, of: 1, changed: 14 }]);
  assert.match(text, /^@@ -0,0 \+38,7 @@$/m);
  assert.match(text, /\+edited near the top/);
  assert.doesNotMatch(text, /line 150 of the file/);
  assert.equal(parseHunks(text)[0].hunks.length, 2, 'the slices parse back as hunks');
});

test('nothing changed since the last review gives an empty diff', () => {
  const { git, write, commit } = repo();
  write('a.cs', lines(20)); const base = commit('base');
  const a = lines(20); a[3] = 'the change'; write('a.cs', a); const head = commit('pr');
  assert.deepEqual(filterDelta(git('diff', '-U3', base, head), git('diff', '-U0', head, head)), { text: '', kept: [] });
});

test('a short removed line matching elsewhere does not pull a hunk in', () => {
  const pr = 'diff --git a/x.cs b/x.cs\n--- a/x.cs\n+++ b/x.cs\n@@ -5,2 +5,1 @@\n }\n-}\n';
  const since = 'diff --git a/x.cs b/x.cs\n--- a/x.cs\n+++ b/x.cs\n@@ -40 +39,0 @@\n-}\n';
  assert.equal(filterDelta(pr, since).text, '');
});

test('parseHunks reads a renamed file under its new path and counts added lines on the head side', () => {
  const text = 'diff --git a/old.cs b/new.cs\nsimilarity index 90%\nrename from old.cs\nrename to new.cs\n--- a/old.cs\n+++ b/new.cs\n@@ -1,2 +1,3 @@\n keep\n+added one\n+added two\n';
  const [f] = parseHunks(text);
  assert.equal(f.path, 'new.cs');
  assert.deepEqual(f.hunks[0].added, [2, 3]);
});
