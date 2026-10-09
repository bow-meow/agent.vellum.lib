import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint, locateFingerprint, statePath, loadState, saveState, splitComments } from '../state.mjs';

const text = ['a', 'b', 'c', 'target', 'e', 'f', 'g'].join('\n');

test('fingerprint ignores whitespace and CRLF', () => {
  const spaced = ['a', 'b', '  c ', 'target\t', 'e', ' f', 'g'].join('\r\n');
  assert.equal(fingerprint(text, 4), fingerprint(spaced, 4));
});

test('fingerprint changes when the window changes', () => {
  assert.notEqual(fingerprint(text, 4), fingerprint(text.replace('\ne\n', '\nE!\n'), 4));
  assert.equal(fingerprint(text, 4), fingerprint(text.replace('a', 'zzz'), 4));
});

test('fingerprint is null out of range and clamps at file edges', () => {
  assert.equal(fingerprint(text, 0), null);
  assert.equal(fingerprint(text, 99), null);
  assert.equal(typeof fingerprint(text, 1), 'string');
});

test('state round-trips and missing state is null', () => {
  const root = mkdtempSync(join(tmpdir(), 'st-'));
  const p = statePath('ws', 'repo', 7, root);
  assert.equal(loadState(p), null);
  const s = { reviewedCommit: 'abc', reviewedAt: '2026-09-30T00:00:00Z', findings: [] };
  saveState(p, s);
  assert.deepEqual(loadState(p), s);
  assert.match(p, /[\\/]\.state[\\/]ws-repo-PR7\.json$/);
});

test('ours = my account AND the AI tag; deleted comments dropped', () => {
  const values = [
    { id: 1, user: { account_id: 'me', display_name: 'Me' }, content: { raw: '[blocking, AI:Opus 5.5] race here' }, inline: { path: 'a.cs', to: 5 } },
    { id: 2, user: { account_id: 'me', display_name: 'Me' }, content: { raw: 'my own manual note' }, inline: { path: 'a.cs', to: 6 } },
    { id: 3, user: { account_id: 'bob', display_name: 'Bob' }, content: { raw: '[nit, AI:Opus 5.5] copied?' }, parent: { id: 1 } },
    { id: 4, user: { account_id: 'bob', display_name: 'Bob' }, content: { raw: 'x' }, deleted: true },
    { id: 5, user: { account_id: 'me', display_name: 'Me' }, content: { raw: '[info, AI:Opus 5.5] old' }, inline: { path: 'b.cs', from: 9, outdated: true }, resolution: { type: 'comment_resolution', user: { account_id: 'author' } } },
    { id: 6, user: { account_id: 'me', display_name: 'Me' }, content: { raw: '**suggestion** · AI:Opus 5.5\n\nnew header' }, inline: { path: 'c.cs', to: 3 } },
  ];
  const { ours, others } = splitComments(values, 'me');
  assert.deepEqual(ours.map(c => c.id), [1, 5, 6]);
  assert.deepEqual(others.map(c => c.id), [2, 3]);
  assert.deepEqual(ours[1], { id: 5, parent: null, path: 'b.cs', line: 9, side: 'old', author: 'Me', raw: '[info, AI:Opus 5.5] old', resolved: true, resolvedBy: 'author', outdated: true });
  assert.equal(ours[0].resolvedBy, null);
  assert.equal(others[1].parent, 1);
});

test('locateFingerprint finds moved code, prefers the nearest match, and misses changed code', () => {
  const orig = ['a', 'b', 'c', 'target', 'e', 'f', 'g'].join('\n');
  const fp = fingerprint(orig, 4);
  const moved = ['x', 'y', 'a', 'b', 'c', 'target', 'e', 'f', 'g'].join('\n');
  assert.equal(locateFingerprint(moved, fp, 4), 6);
  assert.equal(locateFingerprint(moved.replace('target', 'changed'), fp, 4), null);
});

test('splitComments sets aside our in-progress notice instead of treating it as a finding or a human comment', () => {
  const notice = '⏳ **review in progress** · 🤖 AI:Opus 5.5\n\nStarted 2026-10-02 09:05 UTC+01:00. Findings will follow as inline comments.';
  const values = [
    { id: 1, user: { account_id: 'me' }, content: { raw: notice } },
    { id: 2, user: { account_id: 'other' }, content: { raw: notice } },
    { id: 3, user: { account_id: 'me' }, content: { raw: notice }, deleted: true },
  ];
  const { ours, others, progress } = splitComments(values, 'me');
  assert.deepEqual(progress, [1]);
  assert.deepEqual(ours, []);
  assert.deepEqual(others.map(c => c.id), [2]);
});
