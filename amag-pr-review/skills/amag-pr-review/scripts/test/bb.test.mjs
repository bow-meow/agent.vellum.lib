import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API, BbError, findCreds, makeClient } from '../bb.mjs';

function fakeFetch(responses = []) {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url, ...opts });
    const r = responses.shift() ?? { status: 200, body: '' };
    return { ok: r.status < 300, status: r.status, text: async () => r.body };
  };
  f.calls = calls;
  return f;
}
const creds = { u: 'me', p: 'secret' };
const pr = `${API}repositories/ws/repo/pullrequests/7`;

test('findCreds prefers env vars', () => {
  assert.deepEqual(findCreds({ BITBUCKET_USERNAME: 'a', BITBUCKET_PASSWORD: 'b' }), { u: 'a', p: 'b' });
});

test('findCreds falls back to a nested entry in the claude config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-'));
  const cfg = join(dir, 'c.json');
  writeFileSync(cfg, JSON.stringify({ mcpServers: { bitbucket: { env: { BITBUCKET_USERNAME: 'x', BITBUCKET_PASSWORD: 'y' } } } }));
  assert.deepEqual(findCreds({ CLAUDE_CONFIG: cfg }), { u: 'x', p: 'y' });
});

test('findCreds returns null when nothing is configured', () => {
  assert.equal(findCreds({ CLAUDE_CONFIG: join(tmpdir(), 'does-not-exist.json') }), null);
});

test('approve is a bodiless POST with no Content-Type', async () => {
  const f = fakeFetch();
  await makeClient({ creds, fetchImpl: f }).approve('ws', 'repo', 7);
  assert.equal(f.calls[0].url, `${pr}/approve`);
  assert.equal(f.calls[0].method, 'POST');
  assert.equal(f.calls[0].body, undefined);
  assert.equal(f.calls[0].headers['Content-Type'], undefined);
  assert.match(f.calls[0].headers.Authorization, /^Basic /);
});

test('unapprove is a DELETE on the approve endpoint', async () => {
  const f = fakeFetch([{ status: 204, body: '' }]);
  await makeClient({ creds, fetchImpl: f }).unapprove('ws', 'repo', 7);
  assert.equal(f.calls[0].method, 'DELETE');
  assert.equal(f.calls[0].url, `${pr}/approve`);
});

test('request-changes is a bodiless POST on the request-changes endpoint', async () => {
  const f = fakeFetch();
  await makeClient({ creds, fetchImpl: f }).requestChanges('ws', 'repo', 7);
  assert.equal(f.calls[0].url, `${pr}/request-changes`);
  assert.equal(f.calls[0].method, 'POST');
  assert.equal(f.calls[0].body, undefined);
});

test('unrequest-changes is a DELETE on the request-changes endpoint', async () => {
  const f = fakeFetch([{ status: 204, body: '' }]);
  await makeClient({ creds, fetchImpl: f }).unrequestChanges('ws', 'repo', 7);
  assert.equal(f.calls[0].method, 'DELETE');
  assert.equal(f.calls[0].url, `${pr}/request-changes`);
});

test('inline comment on a new-side line uses inline.to', async () => {
  const f = fakeFetch([{ status: 201, body: '{"id":1}' }]);
  await makeClient({ creds, fetchImpl: f }).comment('ws', 'repo', 7, { raw: 'hi', path: 'a b/c.cs', side: 'new', line: 12 });
  assert.equal(f.calls[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(f.calls[0].body), { content: { raw: 'hi' }, inline: { path: 'a b/c.cs', to: 12 } });
});

test('inline comment on a deleted line uses inline.from', async () => {
  const f = fakeFetch([{ status: 201, body: '{"id":1}' }]);
  await makeClient({ creds, fetchImpl: f }).comment('ws', 'repo', 7, { raw: 'x', path: 'p.sql', side: 'old', line: 3 });
  assert.deepEqual(JSON.parse(f.calls[0].body).inline, { path: 'p.sql', from: 3 });
});

test('reply threads under the parent id', async () => {
  const f = fakeFetch([{ status: 201, body: '{"id":2}' }]);
  await makeClient({ creds, fetchImpl: f }).reply('ws', 'repo', 7, 99, 'more');
  assert.deepEqual(JSON.parse(f.calls[0].body), { content: { raw: 'more' }, parent: { id: 99 } });
});

test('edit PUTs only the new content to the comment, keeping its anchor and thread', async () => {
  const f = fakeFetch([{ status: 200, body: '{"id":5}' }]);
  await makeClient({ creds, fetchImpl: f }).edit('ws', 'repo', 7, 5, 'new text');
  assert.equal(f.calls[0].url, `${pr}/comments/5`);
  assert.equal(f.calls[0].method, 'PUT');
  assert.deepEqual(JSON.parse(f.calls[0].body), { content: { raw: 'new text' } });
});

test('resolve POSTs to the comment resolve endpoint', async () => {
  const f = fakeFetch();
  await makeClient({ creds, fetchImpl: f }).resolve('ws', 'repo', 7, 5);
  assert.equal(f.calls[0].url, `${pr}/comments/5/resolve`);
  assert.equal(f.calls[0].method, 'POST');
});

test('reopen is a DELETE on the comment resolve endpoint', async () => {
  const f = fakeFetch();
  await makeClient({ creds, fetchImpl: f }).reopen('ws', 'repo', 7, 5);
  assert.equal(f.calls[0].url, `${pr}/comments/5/resolve`);
  assert.equal(f.calls[0].method, 'DELETE');
});

test('get follows next links and merges values', async () => {
  const f = fakeFetch([
    { status: 200, body: JSON.stringify({ values: [1, 2], next: 'https://api.bitbucket.org/2.0/p2' }) },
    { status: 200, body: JSON.stringify({ values: [3] }) },
  ]);
  const out = await makeClient({ creds, fetchImpl: f }).get('repositories/ws/repo/pullrequests/7/comments');
  assert.deepEqual(out.values, [1, 2, 3]);
  assert.equal(out.next, undefined);
  assert.equal(f.calls[1].url, 'https://api.bitbucket.org/2.0/p2');
});

test('get stops paginating once max values are collected', async () => {
  const f = fakeFetch([{ status: 200, body: JSON.stringify({ values: [1, 2], next: 'https://api.bitbucket.org/2.0/p2' }) }]);
  const out = await makeClient({ creds, fetchImpl: f }).get('x', { max: 2 });
  assert.deepEqual(out.values, [1, 2]);
  assert.equal(f.calls.length, 1);
});

test('diff returns raw text, not JSON', async () => {
  const f = fakeFetch([{ status: 200, body: 'diff --git a/x b/x\n' }]);
  assert.equal(await makeClient({ creds, fetchImpl: f }).diff('ws', 'repo', 7), 'diff --git a/x b/x\n');
  assert.equal(f.calls[0].url, `${pr}/diff`);
});

test('searchPrs encodes the query and repeats state params', async () => {
  const f = fakeFetch([{ status: 200, body: '{"values":[]}' }]);
  await makeClient({ creds, fetchImpl: f }).searchPrs('ws', 'repo', 'SYM-1234');
  const u = new URL(f.calls[0].url);
  assert.equal(u.searchParams.get('q'), 'source.branch.name ~ "SYM-1234"');
  assert.deepEqual(u.searchParams.getAll('state'), ['OPEN', 'MERGED']);
});

test('me falls back to a configured account id when /user is forbidden', async () => {
  const f = fakeFetch([{ status: 403, body: 'scope' }]);
  const me = await makeClient({ creds, fetchImpl: f, accountId: '712020:abc' }).me();
  assert.deepEqual(me, { account_id: '712020:abc', source: 'config' });
});

test('me rethrows 403 when no account id is configured', async () => {
  const f = fakeFetch([{ status: 403, body: 'scope' }]);
  await assert.rejects(makeClient({ creds, fetchImpl: f }).me(), e => e.status === 403);
});

test('HTTP errors throw BbError carrying the status', async () => {
  const f = fakeFetch([{ status: 401, body: 'nope' }]);
  await assert.rejects(makeClient({ creds, fetchImpl: f }).me(), e => e instanceof BbError && e.status === 401);
});

test('general posts a top-level comment with no inline anchor or parent', async () => {
  const f = fakeFetch([{ status: 201, body: '{"id":3}' }]);
  await makeClient({ creds, fetchImpl: f }).general('ws', 'repo', 7, 'notice');
  assert.equal(f.calls[0].url, `${pr}/comments`);
  assert.equal(f.calls[0].method, 'POST');
  assert.deepEqual(JSON.parse(f.calls[0].body), { content: { raw: 'notice' } });
});

test('remove is a DELETE on the comment', async () => {
  const f = fakeFetch([{ status: 204, body: '' }]);
  await makeClient({ creds, fetchImpl: f }).remove('ws', 'repo', 7, 3);
  assert.equal(f.calls[0].url, `${pr}/comments/3`);
  assert.equal(f.calls[0].method, 'DELETE');
});
