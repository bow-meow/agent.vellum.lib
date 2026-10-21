import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyse, cacheUsable, classify, fetchThreads, loadEntries, outcomes, prsOf, report, saysFixed } from '../calibrate.mjs';

const me = { account_id: 'me' };
const author = { account_id: 'author' };
const other = { account_id: 'bob' };
const ours = (id, extra = {}) => ({ id, user: me, content: { raw: `🟠 **change needed** · 🤖 AI:Opus 5.5\n\nfinding ${id}` }, ...extra });
const reply = (id, parent, user, raw = 'ok') => ({ id, user, parent: { id: parent }, content: { raw } });
const fixedReply = (id, parent) => reply(id, parent, me, '🔵 **note** · 🤖 AI:Opus 5.5\n\nFixed in `abc12345`.');

const at = (state, values) => ({ pr: { state, author }, values });

test('classify: a "Fixed in" reply wins, even on a thread the author resolved', () => {
  assert.equal(classify(1, at('OPEN', [ours(1, { resolution: { user: author } }), fixedReply(2, 1)])), 'fixed');
});

test('saysFixed reads a hand-written or pr-respond "fixed" reply, and nothing else', () => {
  for (const s of ['👍 Fixed in 9c7fd8b: both banners', 'Fixed: the help lists it', 'done', '✅ **fixed** · 🤖 AI:Opus 5.5\n\nmoved it', '**Fixed**, thanks'])
    assert.equal(saysFixed(s), true, s);
  for (const s of ['Not fixing: by design', 'Leaving this one', '↩️ **push-back** · 🤖 AI:Opus 5.5', 'Fixes are in a follow-up', ''])
    assert.equal(saysFixed(s), false, s);
});

test('classify: the author\'s last reply saying fixed counts, ahead of how the thread was resolved', () => {
  const t = [ours(1, { resolution: { user: author } }), reply(2, 1, author, 'Leaving it?'), reply(3, 2, author, '👍 Fixed in abc: moved it')];
  assert.equal(classify(1, at('MERGED', t)), 'author says fixed');
  assert.equal(classify(1, at('MERGED', [ours(1), reply(2, 1, author, 'Fixed now'), reply(3, 1, author, 'Actually leaving it')])), 'pushed back');
});

test('classify: an author resolve is a push-back with a reply after ours, and taken up without one', () => {
  assert.equal(classify(1, at('OPEN', [ours(1, { resolution: { user: author } }), reply(2, 1, author, 'keeping it')])), 'pushed back');
  assert.equal(classify(1, at('OPEN', [ours(1, { resolution: { user: author } })])), 'resolved by author');
  assert.equal(classify(1, at('OPEN', [ours(1, { resolution: {} })])), 'resolved by author');
  assert.equal(classify(1, at('OPEN', [ours(1, { resolution: { user: other } })])), 'closed by reviewer');
});

test('classify: our "Fixed in" reply is found under the footer-style header too', () => {
  const newFixed = reply(2, 1, me, '🔵 **note**\n\nFixed in `abc12345`.\n\n_AI review · Opus 5.5_');
  assert.equal(classify(1, at('OPEN', [ours(1), newFixed])), 'fixed');
});

test('classify: our own resolve after conceding still counts as the author pushing back', () => {
  const t = [ours(1, { resolution: { user: me } }), reply(2, 1, author, 'It is guarded in the caller'), reply(3, 2, me, '🔵 **note** · 🤖 AI:Opus 5.5\n\nFair point.')];
  assert.equal(classify(1, at('OPEN', t)), 'pushed back');
});

test('analyse counts conceded and disputed push-backs by the reviewer that raised them, and your overrides', () => {
  const first = entry([f('f1', { commentId: 10, reviewers: ['sql'] }), f('f2', { commentId: 11 })]);
  const later = entry([], { previous: [
    { commentId: 10, status: 'conceded', posted: true, flipped: true },
    { commentId: 11, status: 'disputed', posted: true, flipped: true },
    { commentId: 99, status: 'conceded', posted: true },
    { commentId: 11, status: 'still-applies', posted: null },
  ] });
  const a = analyse([first, later], new Map());
  assert.deepEqual(a.pushbacks.get('sql'), { conceded: 1, disputed: 0, keptByYou: 1, withdrawnByYou: 0 });
  assert.deepEqual(a.pushbacks.get('correctness'), { conceded: 0, disputed: 1, keptByYou: 0, withdrawnByYou: 1 });
  assert.equal(a.pushbacks.get('unknown').conceded, 1);
  assert.match(report(a), /## Push-backs on re-review/);
});

test('classify: resolution sits on the thread root when our finding was a reply', () => {
  const values = [reply(1, 0, other, 'human comment'), ours(2, { parent: { id: 1 } }), reply(3, 2, author, 'no')];
  values[0] = { ...values[0], parent: undefined, resolution: { user: author } };
  assert.equal(classify(2, at('OPEN', values)), 'pushed back');
});

test('classify: an open thread is pending on an open PR, ignored once merged, deleted when gone', () => {
  assert.equal(classify(1, at('OPEN', [ours(1)])), 'pending');
  assert.equal(classify(1, at('MERGED', [ours(1)])), 'ignored');
  assert.equal(classify(1, at('MERGED', [ours(1), reply(2, 1, author)])), 'pushed back');
  assert.equal(classify(1, at('MERGED', [])), 'deleted');
  assert.equal(classify(1, at('MERGED', [ours(1, { deleted: true })])), 'deleted');
});

const entry = (findings, extra = {}) => ({ v: 1, at: '2026-10-21T10:00:00Z', mode: 'pr', pr: { ws: 'ws', repo: 'r', id: 1 },
  usage: { correctness: 6000, verify: 2000 }, totalTokens: 8000, run: { changed: 400 }, findings, ...extra });
const f = (id, extra) => ({ id, verdict: 'confirmed', severity: 'Medium', reviewers: ['correctness'], confidence: 'high', posted: true, commentId: null, ...extra });

test('analyse tallies outcomes, picks, verdicts and cost', () => {
  const entries = [
    entry([f('f1', { commentId: 10 }), f('f2', { commentId: 11, confidence: 'medium' }), f('f3', { posted: false, edited: false }),
      { id: 'f4', verdict: 'dropped', reviewers: ['correctness'], posted: null }, { id: 'f5', verdict: 'dropped', unconfirmed: true, reviewers: ['correctness'], posted: null }]),
    entry([f('f1', { commentId: 12, edited: true })], { mode: 'local', pr: null, totalTokens: 4000, run: { changed: 100 }, usage: { correctness: 4000 } }),
  ];
  const a = analyse(entries, new Map([[10, 'fixed'], [11, 'pushed back'], [12, 'fixed']]));
  assert.deepEqual([a.runs, a.posted, a.settled], [{ total: 2, pr: 1, local: 1 }, 2, 2]);
  assert.deepEqual([a.byConfidence.get('high').fixed, a.byConfidence.get('medium')['pushed back']], [1, 1]);
  assert.deepEqual(a.picks.get('correctness'), { shown: 3, posted: 2, declined: 1, edited: 0 });
  assert.deepEqual(a.verdicts.get('correctness'), { confirmed: 4, dropped: 1, unconfirmed: 1 });
  assert.deepEqual([a.cost.medianPerRun, a.cost.medianPer100Lines], [6000, 3000]);
  assert.deepEqual(a.cost.agents.get('correctness'), { tokens: 10000, runs: 2, posted: 2 });
});

test('report warns below the settled threshold and renders every section', () => {
  const a = analyse([entry([f('f1', { commentId: 10 })])], new Map([[10, 'fixed']]));
  const text = report(a, { bad: 1, unreachable: ['ws/r#2'] });
  for (const s of ['Fewer than 20 settled', '1 unreadable', "Couldn't fetch: ws/r#2", '## Outcome by confidence', '## Your picks', '## Cost'])
    assert.ok(text.includes(s), s);
  assert.match(text, /\| high \| 1 \| 1 \|/);
});

test('loadEntries reads every log, skips bad lines and filters by date', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cal-'));
  writeFileSync(join(dir, 'a.jsonl'), JSON.stringify({ at: '2026-10-01T00:00:00Z' }) + '\nnot json\n');
  writeFileSync(join(dir, 'b.jsonl'), JSON.stringify({ at: '2026-10-20T00:00:00Z' }) + '\n');
  assert.deepEqual(loadEntries(dir).entries.length, 2);
  assert.equal(loadEntries(dir).bad, 1);
  assert.equal(loadEntries(dir, { since: '2026-10-10' }).entries.length, 1);
  assert.deepEqual(loadEntries(join(dir, 'none')), { entries: [], bad: 0 });
});

test('cacheUsable keeps a finished PR forever and an open one for an hour', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  assert.equal(cacheUsable({ pr: { state: 'MERGED' }, fetchedAt: '2026-01-01T00:00:00Z' }, { now }), true);
  assert.equal(cacheUsable({ pr: { state: 'OPEN' }, fetchedAt: '2026-10-21T11:30:00Z' }, { now }), true);
  assert.equal(cacheUsable({ pr: { state: 'OPEN' }, fetchedAt: '2026-10-21T10:00:00Z' }, { now }), false);
  assert.equal(cacheUsable({ pr: { state: 'MERGED' }, fetchedAt: '2026-01-01T00:00:00Z' }, { now, refresh: true }), false);
});

test('fetchThreads fetches each PR once, caches it, and reports one it could not reach', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cal-'));
  const calls = [];
  const client = { get: async p => {
    calls.push(p);
    if (p.includes('/pullrequests/2')) throw new Error('HTTP 404 x\nbody');
    return p.includes('/comments') ? { values: [ours(10)] } : { state: 'MERGED', author };
  } };
  const prs = prsOf([entry([f('f1', { commentId: 10 })]), entry([f('f1', { commentId: 10 })]), entry([f('f1', { commentId: 20 })], { pr: { ws: 'ws', repo: 'r', id: 2 } })]);
  assert.equal(prs.length, 2);
  const first = await fetchThreads(client, prs, dir);
  assert.deepEqual(first.unreachable, ['ws/r#2 (HTTP 404 x)']);
  assert.equal(calls.filter(c => c.includes('/pullrequests/1')).length, 2);
  const again = await fetchThreads(client, prs.slice(0, 1), dir);
  assert.equal(calls.length, 3 + 0, 'the merged PR came from the cache');
  assert.equal(outcomes([entry([f('f1', { commentId: 10 })])], again.threads, dir).get(10), 'ignored');
  const offline = await fetchThreads(null, prs, dir, { offline: true });
  assert.deepEqual(offline.unreachable, ['ws/r#2']);
});
