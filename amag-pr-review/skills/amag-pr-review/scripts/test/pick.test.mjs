import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLocal, buildPicks, buildPr, closedByHuman, place, renderPickTable, toPlace, verdictLines } from '../pick.mjs';

const addedFile = (path, n) => `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${n} @@\n${Array.from({ length: n }, (_, i) => `+line ${i + 1}`).join('\n')}\n`;
const prDiff = addedFile('a.cs', 12) + addedFile('b.cs', 6) + addedFile('c.cs', 4);
const scopeDiff = addedFile('a.cs', 12) + addedFile('b.cs', 6);

const confirmed = (id, severity, path, line, extra = {}) => ({ id, verdict: 'confirmed', severity, path, line, side: 'new', match: 'new',
  claim: `claim ${id}`, issue: `issue ${id}`, impact: 'it breaks', fix: 'fix it', confidence: 'high', ...extra });

export const verified = {
  findings: [
    confirmed('f1', 'Medium', 'a.cs', 10),
    confirmed('f2', 'Info', 'b.cs', 5),
    confirmed('f3', 'High', 'z.cs', 1, { match: 'reply', parent_id: 900 }),
    confirmed('f4', 'Low', 'c.cs', 3),
    confirmed('f5', 'Low', 'a.cs', 99),
    confirmed('f6', 'Medium', 'a.cs', 2, { match: 'already-raised', raised_by: 'Ann' }),
    confirmed('f7', 'Medium', 'a.cs', 3, { match: 'ours-previous', parent_id: 101 }),
    confirmed('f8', 'Low', 'ticket', 0, { terminal_only: true }),
    { id: 'f9', verdict: 'dropped', severity: 'High', path: 'a.cs', line: 4, claim: 'claim f9', reason: 'guarded in caller' },
    { id: 'f10', verdict: 'dropped', unconfirmed: true, severity: 'Low', path: 'a.cs', line: 5, claim: 'claim f10', reason: 'no caller found' },
  ],
  previous: [
    { comment_id: 101, status: 'still-applies', line: 20, codeChanged: true, note: 'still unguarded' },
    { comment_id: 102, status: 'still-applies', line: 30, codeChanged: false, note: 'nothing moved' },
    { comment_id: 103, status: 'still-applies', line: 40, codeChanged: false, note: 'author resolved, not fixed' },
    { comment_id: 104, status: 'disputed', line: 50, codeChanged: false, note: 'import path still unguarded', reply: 'The import path at L50 still skips the check.' },
    { comment_id: 105, status: 'conceded', codeChanged: false, note: 'guard exists in caller', pattern: 'Don\'t flag a null check the caller already does' },
    { comment_id: 106, status: 'fixed', codeChanged: true, note: 'guard added' },
    { comment_id: 107, status: 'fixed', codeChanged: true, note: 'fixed, in a human thread' },
    { comment_id: 108, status: 'conceded', codeChanged: false, note: 'ticket accepts it', pattern: 'Don\'t flag an accepted trade-off' },
  ],
};
const rc = (commentId, severity, path, line, extra = {}) => ({ commentId, parentId: null, path, line, side: 'new', severity, codeChanged: false,
  authorResolved: false, authorReplies: [], ...extra });
export const recheck = [
  rc(101, 'Medium', 'd.cs', 18), rc(102, 'Medium', 'd.cs', 30), rc(103, 'Low', 'e.cs', 40, { authorResolved: true }),
  rc(104, 'Low', 'e.cs', 50, { authorResolved: true, authorReplies: [{ id: 300, raw: 'old' }, { id: 310, raw: 'It is\nguarded upstream' }] }),
  rc(105, 'Medium', 'f.cs', 1, { authorReplies: [{ id: 320, raw: 'The caller checks it.' }] }),
  rc(106, 'Low', 'g.cs', 1), rc(107, 'Low', 'h.cs', 1, { parentId: 50 }),
  rc(108, 'Low', 'i.cs', 1, { authorResolved: true, authorReplies: [{ id: 330, raw: 'Accepted in the ticket.' }] }),
];
export const ours = [{ id: 105, resolved: false }, { id: 106, resolved: false }, { id: 108, resolved: true }];
const built = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'].map(id => ({ id, status: id === 'f2' ? 'note' : 'change', reviewers: ['correctness'], confidence: 'high' }));

const build = () => {
  const placed = place(toPlace(verified), prDiff, scopeDiff);
  return buildPicks({ w: '/w', verified, built, placed, recheck, ours });
};

test('toPlace takes confirmed new findings that are not terminal-only', () => {
  assert.deepEqual(toPlace(verified).map(f => f.id), ['f1', 'f2', 'f4', 'f5']);
});

test('place anchors in the PR diff and marks what lies outside the re-review scope', () => {
  const placed = place(toPlace(verified), prDiff, scopeDiff);
  assert.deepEqual(placed.map(p => [p.id, p.anchor?.line ?? null, p.outOfScope]), [['f1', 10, false], ['f2', 5, false], ['f4', 3, true], ['f5', null, undefined]]);
  assert.equal(place(toPlace(verified), prDiff).find(p => p.id === 'f4').outOfScope, undefined);
});

test('groups are numbered findings, follow-ups, answers, agreements, then the outside group', () => {
  const { picks } = build();
  assert.deepEqual(picks.items.map(it => [it.n, it.group, it.kind, it.findingId ?? it.commentId]), [
    [1, 'finding', 'reply', 'f3'], [2, 'finding', 'new', 'f1'], [3, 'finding', 'new', 'f2'],
    [4, 'followup', 'still-applies', 101], [5, 'followup', 'reopen', 103],
    [6, 'answer', 'answer', 104],
    [7, 'resolve', 'resolve', 105], [8, 'resolve', 'resolve', 106],
    [9, 'outside', 'new', 'f4'],
  ]);
  assert.equal(picks.items[0].parentId, 900);
  assert.equal(picks.items[1].body.replace(/\\/g, '/'), '/w/body-f1.txt');
  assert.deepEqual([picks.items[3].line, picks.items[3].path], [20, 'd.cs'], 'the follow-up uses verify\'s current line');
});

test('a Low author-resolved still-applies reopens with needs-reply; with a reply or a higher severity, still-applies', () => {
  assert.equal(build().picks.items.find(i => i.commentId === 103).replyKind, 'needs-reply');
  const r2 = recheck.map(e => (e.commentId === 103 ? { ...e, severity: 'Medium' } : e));
  const v2 = { ...verified, previous: verified.previous.map(p => (p.comment_id === 103 ? { ...p, severity: undefined } : p)) };
  assert.equal(buildPicks({ w: '/w', verified: v2, built, recheck: r2, ours }).picks.items.find(i => i.commentId === 103).replyKind, 'still-applies');
});

test('nothing-to-post categories: still open, settled, not posted', () => {
  const { picks } = build();
  assert.deepEqual(picks.stillOpen.map(s => s.commentId), [102]);
  assert.deepEqual(picks.settled.map(s => [s.commentId, s.verdict, s.n]), [[107, 'fixed', null], [108, 'conceded', 10]]);
  assert.deepEqual(picks.notPosted.map(x => [x.findingId, x.why.split(':')[0]]), [
    ['f6', 'already-raised'], ['f7', 'ours-previous'], ['f5', 'terminal-only'], ['f8', 'terminal-only']]);
});

test('an agreement is only a resolve on our own open thread', () => {
  const ours2 = [{ id: 105, resolved: true }, { id: 106, resolved: false }];
  const { picks } = buildPicks({ w: '/w', verified, built, recheck, ours: ours2 });
  assert.deepEqual(picks.items.filter(i => i.kind === 'resolve').map(i => i.commentId), [106]);
  assert.ok(picks.settled.some(s => s.commentId === 105));
});

test('R suggestions follow conceded items by number, resolve or settled', () => {
  const { picks } = build();
  assert.deepEqual(picks.rules, [
    { id: 'R1', line: 'Don\'t flag a null check the caller already does', from: 7 },
    { id: 'R2', line: 'Don\'t flag an accepted trade-off', from: 10 }]);
  assert.equal(picks.items.find(i => i.n === 7).ruleId, 'R1');
});

test('disputed push-backs get their draft reply as a pushback file and the author\'s latest point', () => {
  const { picks, pushbacks } = build();
  assert.deepEqual(pushbacks, [{ file: 'pushback-104.txt', text: 'The import path at L50 still skips the check.' }]);
  const a = picks.items.find(i => i.kind === 'answer');
  assert.equal(a.point, 'It is guarded upstream');
  assert.equal(a.authorResolved, true);
});

test('the table has the Post as column and the outside group under its own heading', () => {
  const { picks } = build();
  const t = renderPickTable(picks, built).join('\n');
  assert.match(t, /\| 2 \| change needed \| correctness \| high \| a\.cs:10 \| claim f1 \| new \|/);
  assert.match(t, /\| 3 \| note \|/);
  assert.match(t, /\| 4 \| still applies \| previous \| — \| d\.cs:20 \| still unguarded \| still applies \|/);
  assert.ok(t.indexOf('Outside this round') < t.indexOf('| 9 |'));
});

test('verdict lines mark recheck-upheld drops and list overturned and unconfirmed', () => {
  const lines = verdictLines({ verified, contested: [{ id: 'f9', kind: 'dropped' }, { id: 'sec-1', kind: 'omitted' }, { id: 'f1', kind: 'downgraded' }],
    decisions: [{ id: 'f9', decision: 'uphold' }, { id: 'sec-1', decision: 'uphold' }, { id: 'f1', decision: 'overturn', reason: 'verify missed the import path' }] });
  assert.equal(lines[0], 'Dropped by verify (2): f9: guarded in caller (upheld by recheck), sec-1: never taken up by verify (upheld by recheck)');
  assert.equal(lines[1], 'Overturned by recheck (1): f1: verify missed the import path');
  assert.equal(lines[2], 'Unconfirmed, not posted (1): f10: no caller found');
});

test('closedByHuman: open state findings that were not re-checked', () => {
  const prev = { findings: [{ commentId: 101, status: 'open' }, { commentId: 99, status: 'open', path: 'x.cs', line: 3 }, { commentId: 98, status: 'fixed' }] };
  assert.deepEqual(closedByHuman(prev, recheck).map(f => f.commentId), [99]);
  assert.deepEqual(closedByHuman(null, recheck), []);
});

const workDir = () => {
  const root = mkdtempSync(join(tmpdir(), 'pick-'));
  const w = join(root, '.work', 'ws-repo-PR7');
  mkdirSync(w, { recursive: true });
  const put = (f, v) => writeFileSync(join(w, f), typeof v === 'string' ? v : JSON.stringify(v));
  return { root, w, put };
};

test('buildPr writes to-place, picks and pushback files, and prints the table, the post-everything decision and the question', () => {
  const { w, put } = workDir();
  put('repos.json', { mode: 'pr', dryRun: false, pr: { ws: 'ws', repo: 'repo', id: 7, state: 'OPEN', mine: false, myState: null, url: 'https://bitbucket.org/ws/repo/pull-requests/7' },
    repos: [{ name: 'repo', wt: w, clone: w, head: 'abc' }] });
  put('verified.json', verified); put('factcheck.json', built); put('previous-recheck.json', recheck); put('comments-ours.json', ours);
  put('bb.diff', prDiff); put('context.diff', scopeDiff);
  put('state-prev.json', { findings: [{ commentId: 77, status: 'open', path: 'old.cs', line: 9 }] });
  const out = buildPr(w);
  assert.deepEqual(JSON.parse(readFileSync(join(w, 'to-place.json'), 'utf8')).map(f => f.id), ['f1', 'f2', 'f4', 'f5']);
  assert.equal(JSON.parse(readFileSync(join(w, 'picks.json'), 'utf8')).items.length, 9);
  assert.equal(readFileSync(join(w, 'pushback-104.txt'), 'utf8'), 'The import path at L50 still skips the check.');
  // f3, f1 (change), 101, 103 (follow-ups), 104 (answer), 102 (still open): f2 is a note.
  assert.match(out, /If you post everything: Request changes: 6 open findings\./);
  assert.match(out, /Our reply: The import path at L50/);
  assert.match(out, /R1\. Don't flag a null check the caller already does \(from 7\)/);
  assert.match(out, /Still open from the last review: c102 d\.cs:30/);
  assert.match(out, /Settled, nothing to post: 1 fixed; conceded:\n {2}10\. c108 i\.cs:1: Accepted in the ticket\./);
  assert.match(out, /Already raised by others: claim f6 → Ann/);
  assert.match(out, /Closed by a human: c77 old\.cs:9/);
  assert.match(out, /Reopened: c103 e\.cs:40/);
  assert.match(out, /Which should I post\?/);
});

test('buildPr on a dry run says what it would do and asks nothing', () => {
  const { w, put } = workDir();
  put('repos.json', { mode: 'pr', dryRun: true, pr: { ws: 'ws', repo: 'repo', id: 7, state: 'OPEN', mine: true, myState: null }, repos: [] });
  put('verified.json', { findings: [], previous: [] });
  const out = buildPr(w);
  assert.match(out, /Dry run \(my own PR\): would approve/);
  assert.doesNotMatch(out, /Which should I post/);
});

test('buildPr holds when a dimension is uncovered', () => {
  const { w, put } = workDir();
  put('repos.json', { mode: 'pr', dryRun: false, pr: { ws: 'ws', repo: 'repo', id: 7, state: 'OPEN', mine: false, myState: null }, repos: [] });
  put('verified.json', { findings: [], previous: [] });
  put('uncovered.json', ['security']);
  assert.match(buildPr(w), /If you post everything: Holding: uncovered: security\./);
});

test('buildLocal saves review-findings.json and numbers the table by its n, without Post as', () => {
  const { root, w, put } = workDir();
  const ticketDir = join(root, 'ticket');
  mkdirSync(ticketDir);
  put('repos.json', { mode: 'local', dryRun: false, pr: null, ticketKey: 'SYM-1', ticketDir, repos: [{ name: 'repo', wt: '/r', clone: '/r', dest: 'master' }] });
  const v = { findings: [confirmed('f1', 'Low', 'a.cs', 3, { repo: 'repo' }), confirmed('f2', 'High', 'b.cs', 9, { repo: 'repo' }),
    confirmed('f3', 'Low', 'c.cs', 1, { repo: 'repo', terminal_only: true })] };
  put('verified.json', v);
  put('factcheck.json', ['f1', 'f2', 'f3'].map(id => ({ id, status: 'change', reviewers: ['correctness'], confidence: 'high', body: `x **Correctness · change needed**\n\nbody ${id}\n\n_AI review · M_` })));
  const out = buildLocal(w, { repoStateFn: (name, path, dest) => ({ name, path, dest, head: 'h', dirty: false }) });
  const saved = JSON.parse(readFileSync(join(ticketDir, 'review-findings.json'), 'utf8'));
  assert.deepEqual(saved.findings.map(f => [f.n, f.id]), [[1, 'f2'], [2, 'f1'], [3, 'f3']]);
  assert.match(out, /^\| # \| Status \| Reviewer \| Confidence \| Where \| Finding \|$/m);
  assert.match(out, /\| 1 \| change needed \| correctness \| high \| repo\/b\.cs:9 \| claim f2 \|/);
  assert.match(out, /Terminal-only: 3 \(f3\)/);
  assert.match(out, /Which should I fix\?/);
  assert.doesNotMatch(out, /Post as/);
});
