import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildState, claimOf, cleanupWork, progressId, runlogArgs, stateFor, unanswered } from '../finish.mjs';
import { flipItem } from '../post.mjs';

const it = (n, group, kind, fields = {}) => ({ n, group, kind, origKind: null, findingId: null, commentId: null, parentId: null, path: 'a.cs',
  line: n * 10, side: 'new', severity: 'Medium', status: null, verdict: null, claim: `item ${n}`, body: null, replyKind: null, pattern: null,
  ruleId: null, authorResolved: false, ownOpen: false, point: null, flipped: false, edited: false, ...fields });

const picks = {
  items: [
    it(1, 'finding', 'new', { findingId: 'f1', status: 'change' }),
    it(2, 'finding', 'reply', { findingId: 'f3', status: 'change', parentId: 900, severity: 'High' }),
    it(3, 'finding', 'new', { findingId: 'f2', status: 'note', severity: 'Info', claim: 'claim f2' }),
    it(4, 'followup', 'still-applies', { commentId: 101, verdict: 'still-applies' }),
    it(5, 'followup', 'reopen', { commentId: 103, verdict: 'still-applies', authorResolved: true }),
    it(6, 'answer', 'answer', { commentId: 104, verdict: 'disputed', ownOpen: true }),
    it(7, 'resolve', 'resolve', { commentId: 105, verdict: 'conceded', ownOpen: true }),
    it(8, 'resolve', 'resolve', { commentId: 106, verdict: 'fixed', ownOpen: true }),
    it(9, 'outside', 'new', { findingId: 'f4', status: 'change', side: 'old' }),
  ],
  settled: [
    { n: null, commentId: 107, verdict: 'fixed' },
    { n: 10, commentId: 108, verdict: 'conceded', note: 'ticket accepts it', path: 'i.cs', line: 1 },
  ],
  stillOpen: [{ commentId: 102 }], notPosted: [], rules: [],
};
const verified = {
  findings: [{ id: 'f9', verdict: 'dropped', path: 'a.cs', line: 4, claim: 'claim f9', reason: 'guarded in caller' }, { id: 'f1', verdict: 'confirmed' }],
  previous: [
    { comment_id: 101, status: 'still-applies', line: 21, codeChanged: true },
    { comment_id: 102, status: 'still-applies', line: 30, codeChanged: false },
    { comment_id: 103, status: 'still-applies', line: 40, codeChanged: false },
    { comment_id: 104, status: 'disputed', line: 50, severity: 'Medium', reply: 'x' },
    { comment_id: 105, status: 'conceded', note: 'guard exists in caller' },
    { comment_id: 106, status: 'fixed', note: 'guard added' },
    { comment_id: 107, status: 'fixed' },
    { comment_id: 108, status: 'conceded', note: 'ticket accepts it' },
  ],
};
const rc = (commentId, path, line, extra = {}) => ({ commentId, parentId: null, path, line, side: 'new', severity: 'Low', codeChanged: false,
  authorResolved: false, authorReplies: [], ...extra });
const recheck = [rc(101, 'd.cs', 18), rc(102, 'd.cs', 30), rc(103, 'e.cs', 40), rc(104, 'e.cs', 50, { authorReplies: [{ id: 300 }, { id: 310 }] }),
  rc(105, 'f.cs', 1), rc(106, 'g.cs', 1), rc(107, 'h.cs', 2, { parentId: 50 }), rc(108, 'i.cs', 1), rc(111, 'k.cs', 5)];
const prev = { reviewedCommit: 'old', findings: [{ commentId: 101, pushbackSeen: 200, fingerprint: 'fp101' }, { commentId: 106, fingerprint: 'fp106' },
  { commentId: 111, path: 'k.cs', line: 5, status: 'open', severity: 'Low', fingerprint: 'fp111' }] };
const ours = [{ id: 105, raw: '🐛 **Correctness · change needed**\n\n**Issue:** `Save` runs twice.\n\n**Fix:** guard it\n\n_AI review · M_' }];
const fingerprintAt = (path, line) => `fp:${path}:${line}`;
const outcome = [
  { n: 1, result: 'posted', postedId: 2001 }, { n: 2, result: 'posted', postedId: 2002 }, { n: 3, result: 'declined', reason: 'too picky' },
  { n: 4, result: 'declined' }, { n: 5, result: 'declined' }, { n: 6, result: 'declined' }, { n: 7, result: 'posted' },
  { n: 8, result: 'declined' }, { n: 9, result: 'declined' },
];
const now = new Date('2026-11-02T10:00:00Z');
const build = (o = outcome, p = picks) => buildState({ verified, picks: p, outcome: o, prev, droppedPrevious: [{ path: 'z.cs', line: 1, claim: 'old', reason: 'r' }],
  recheck, ours, head: 'HEAD1', now, fingerprintAt });
const byId = s => new Map(s.findings.map(f => [f.commentId, f]));

test('posted findings are saved open with fingerprints; declined ones go to dropped', () => {
  const s = build();
  const f = byId(s);
  assert.deepEqual(f.get(2001), { commentId: 2001, parentId: null, path: 'a.cs', line: 10, side: 'new', severity: 'Medium', status: 'open', pushbackSeen: null, fingerprint: 'fp:a.cs:10' });
  assert.equal(f.get(2002).parentId, 900);
  assert.deepEqual(s.dropped.slice(0, 3), [
    { path: 'a.cs', line: 4, claim: 'claim f9', reason: 'guarded in caller' },
    { path: 'a.cs', line: 30, claim: 'claim f2', reason: 'User chose not to post: too picky' },
    { path: 'a.cs', line: 90, claim: 'item 9', reason: 'User chose not to post' }]);
  assert.deepEqual(s.dropped.at(-1), { path: 'z.cs', line: 1, claim: 'old', reason: 'r' }, 'dropped-previous carried over');
  assert.deepEqual([s.reviewedCommit, s.reviewedAt], ['HEAD1', '2026-11-02T10:00:00.000Z']);
});

test('previous findings per choosing.md §4', () => {
  const f = byId(build());
  assert.deepEqual([f.get(101).status, f.get(101).line, f.get(101).fingerprint, f.get(101).pushbackSeen], ['open', 21, 'fp:d.cs:21', 200], 'declined still-applies stays open');
  assert.equal(f.get(102).status, 'open', 'still open from the last review');
  assert.equal(f.has(103), false, 'declined reopen: the user accepted the author\'s resolve');
  assert.deepEqual([f.get(104).status, f.get(104).pushbackSeen, f.get(104).severity], ['open', 310, 'Medium'], 'answer declined stays open, latest reply seen');
  assert.equal(f.has(105), false, 'conceded and resolved: dropped');
  assert.deepEqual([f.get(106).status, f.get(106).fingerprint], ['fixed', 'fp106'], 'fixed, resolve declined');
  assert.equal(f.get(107).status, 'fixed');
  assert.equal(f.get(107).parentId, 50);
  assert.equal(f.has(108), false, 'settled conceded: dropped');
  assert.deepEqual([f.get(111).status, f.get(111).fingerprint], ['open', 'fp111'], 're-checked without a verdict stays as it was');
  const s = build();
  assert.ok(s.dropped.some(d => d.reason === 'Conceded to the author: guard exists in caller' && d.claim === '`Save` runs twice.' && d.path === 'f.cs'));
  assert.ok(s.dropped.some(d => d.reason === 'Conceded to the author: ticket accepts it' && d.claim === 'ticket accepts it'));
});

test('a conceded resolve the user declines stays open; a flipped one is an answer and stays open', () => {
  const declined = outcome.map(o => (o.n === 7 ? { ...o, result: 'declined' } : o));
  assert.equal(byId(build(declined)).get(105).status, 'open');
  const flipped = flipItem(picks, 10);
  const s = build([...outcome, { n: 10, result: 'posted', postedId: 3000 }], flipped);
  assert.equal(byId(s).get(108).status, 'open');
  assert.ok(!s.dropped.some(d => d.reason.includes('ticket accepts it')));
});

test('a flipped disputed one is an agreement: dropped when resolved or nothing to post, open when its resolve is declined', () => {
  const none = flipItem(picks, 6);
  assert.equal(none.items[5].kind, 'resolve');
  const resolved = build(outcome.map(o => (o.n === 6 ? { ...o, result: 'posted' } : o)), none);
  assert.equal(byId(resolved).has(104), false);
  assert.equal(byId(build(outcome, none)).get(104).status, 'open');
  const notOurs = flipItem({ ...picks, items: picks.items.map(i => (i.n === 6 ? { ...i, ownOpen: false } : i)) }, 6);
  assert.equal(byId(build(outcome.filter(o => o.n !== 6), notOurs)).has(104), false);
});

test('a failed post keeps the previous reviewedCommit, or none on a first run', () => {
  const failed = outcome.map(o => (o.n === 1 ? { ...o, result: 'failed', postedId: null } : o));
  const s = build(failed);
  assert.equal(s.reviewedCommit, 'old');
  assert.equal(s.findings.some(f => f.commentId == null), false, 'the failed one is not saved');
  const first = buildState({ verified: { findings: [], previous: [] }, picks: { items: [it(1, 'finding', 'new', { findingId: 'f1' })] },
    outcome: [{ n: 1, result: 'failed' }], head: 'H', now });
  assert.equal('reviewedCommit' in first, false);
});

test('claimOf strips the header, footer and label', () => {
  assert.equal(claimOf(ours[0].raw), '`Save` runs twice.');
  assert.equal(claimOf(undefined), null);
});

test('unanswered lists items with no outcome', () => {
  assert.deepEqual(unanswered(picks, outcome.filter(o => o.n !== 4)), [4]);
});

const work = () => {
  const root = mkdtempSync(join(tmpdir(), 'finish-'));
  const w = join(root, '.work', 'ws-repo-PR7');
  mkdirSync(w, { recursive: true });
  const put = (f, v) => writeFileSync(join(w, f), typeof v === 'string' ? v : JSON.stringify(v));
  return { root, w, put };
};
const prRepos = (extra = {}) => ({ mode: 'pr', dryRun: false, pr: { ws: 'ws', repo: 'repo', id: 7, state: 'OPEN', mine: false, myState: null },
  repos: [{ name: 'repo', wt: '/nowhere/wt', clone: '/nowhere/clone', head: 'HEAD1' }], ...extra });

test('stateFor refuses on a dry run, a tooling problem or an unanswered item, and saves otherwise', () => {
  const { w, put } = work();
  put('repos.json', prRepos({ dryRun: true }));
  assert.deepEqual(stateFor(w), { skipped: true, why: 'dry run' });
  put('repos.json', prRepos());
  put('cand-correctness.json', '[{"id":"correctness-1"}]');
  assert.match(stateFor(w).why, /^verify failed: no verified.json: the next run must review this code again$/);
  put('verified.json', { findings: [], previous: [] });
  put('uncovered.json', ['sql']);
  assert.match(stateFor(w).why, /uncovered: sql/);
  put('uncovered.json', []);
  put('picks.json', { items: [it(1, 'finding', 'new', { findingId: 'f1' })] });
  assert.match(stateFor(w).why, /no answer recorded for 1/);
  put('outcome.json', [{ n: 1, result: 'posted', postedId: 5 }]);
  const saves = [];
  const r = stateFor(w, { now, save: (...a) => { saves.push(a); return 'saved-path'; } });
  assert.deepEqual(r, { saved: 'saved-path', findings: 1, dropped: 0, reviewedCommit: 'HEAD1' });
  assert.deepEqual(saves[0].slice(0, 3), ['ws', 'repo', 7]);
  assert.deepEqual(JSON.parse(readFileSync(join(w, 'state.json'), 'utf8')), saves[0][3]);
});

test('runlogArgs: ids by finding or c<comment_id>, flags only when non-empty', () => {
  const o = [
    { n: 1, findingId: 'f1', commentId: null, result: 'posted', postedId: 2001, edited: true, flipped: false },
    { n: 2, findingId: null, commentId: 104, result: 'posted', postedId: 2002, edited: false, flipped: true },
    { n: 3, findingId: 'f2', commentId: null, result: 'declined', postedId: null, edited: false, flipped: false },
    { n: 4, findingId: null, commentId: 105, result: 'posted', postedId: null, edited: false, flipped: false },
  ];
  assert.deepEqual(runlogArgs(prRepos(), o, { items: [{ n: 9, commentId: 106, findingId: null, flipped: true }] }), [
    'ws-repo-PR7', '--pr', 'ws/repo/7', '--head', 'HEAD1', '--posted', 'f1,c104,c105', '--declined', 'f2', '--edited', 'f1',
    '--flipped', 'c104,c106', '--comments', 'f1=2001,c104=2002']);
  assert.deepEqual(runlogArgs(prRepos(), []), ['ws-repo-PR7', '--pr', 'ws/repo/7', '--head', 'HEAD1']);
  assert.deepEqual(runlogArgs({ mode: 'local', ticketKey: 'SYM-1' }, []), ['local-SYM-1', '--mode', 'local', '--ticket', 'SYM-1']);
});

test('progressId reads the quoted id env.sh got appended', () => {
  assert.equal(progressId("S='/s'\nPROGRESS_ID='4242'\n"), 4242);
  assert.equal(progressId('PROGRESS_ID=17'), 17);
  assert.equal(progressId("S='/s'\n"), null);
});

test('cleanupWork: log, progress notice, xrepo, worktree, then $W, carrying on past a failed step', async () => {
  const { w, put } = work();
  put('repos.json', prRepos());
  put('env.sh', "W='/w'\nPROGRESS_ID='4242'\n");
  put('outcome.json', [{ n: 1, findingId: 'f1', result: 'posted', postedId: 9 }]);
  const seen = [];
  const r = await cleanupWork(w, {
    runlog: (dir, args) => { seen.push(['log', ...args]); return 'logged'; },
    bb: { remove: async (...a) => { seen.push(['remove', ...a]); throw new Error('HTTP 404'); } },
    xrepo: () => { seen.push(['xrepo']); return []; },
    git: args => { seen.push(['git', ...args]); if (args[3] === 'remove') throw new Error('not a worktree'); return ''; },
  });
  assert.deepEqual(seen[0], ['log', 'ws-repo-PR7', '--pr', 'ws/repo/7', '--head', 'HEAD1', '--posted', 'f1', '--comments', 'f1=9']);
  assert.deepEqual(seen[1], ['remove', 'ws', 'repo', 7, 4242]);
  assert.deepEqual(seen.slice(2).map(s => s.slice(0, 4).join(' ')).map(s => s.replace(/\\/g, '/')), ['xrepo', 'git -C /nowhere/clone worktree', 'git -C /nowhere/clone worktree']);
  assert.deepEqual(r.errors, ['progress: HTTP 404']);
  assert.equal(existsSync(w), false);
});

test('cleanupWork in local mode: log, xrepo and $W only; refuses a dir outside .work', async () => {
  const { root, w, put } = work();
  put('repos.json', { mode: 'local', ticketKey: 'SYM-1', repos: [{ name: 'r', wt: '/t', clone: '/t' }] });
  const seen = [];
  const r = await cleanupWork(w, { runlog: (d, a) => seen.push(a[0]), xrepo: () => seen.push('xrepo'), git: () => seen.push('git'),
    bb: { remove: async () => seen.push('remove') } });
  assert.deepEqual(seen, ['local-SYM-1', 'xrepo']);
  assert.deepEqual(r.errors, []);
  assert.equal(existsSync(w), false);
  await assert.rejects(cleanupWork(root), /isn't a review work dir/);
});
