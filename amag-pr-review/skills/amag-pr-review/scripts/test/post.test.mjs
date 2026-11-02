import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyDecision, closeOutcome, decision, decisionCalls, everythingPosted, flipItem, openFindings, parseAnswer, reviewProblems, runPosts,
} from '../post.mjs';

const it = (n, group, kind, fields = {}) => ({ n, group, kind, origKind: null, findingId: null, commentId: null, parentId: null, path: 'a.cs',
  line: n * 10, side: 'new', severity: 'Medium', status: null, verdict: null, claim: `item ${n}`, body: null, replyKind: null, pattern: null,
  ruleId: null, authorResolved: false, ownOpen: false, point: null, flipped: false, edited: false, ...fields });

const makePicks = (w = '/w') => ({
  items: [
    it(1, 'finding', 'new', { findingId: 'f1', status: 'change', body: join(w, 'body-f1.txt') }),
    it(2, 'finding', 'reply', { findingId: 'f3', status: 'change', parentId: 900, body: join(w, 'body-f3.txt') }),
    it(3, 'finding', 'new', { findingId: 'f2', status: 'note', severity: 'Info', body: join(w, 'body-f2.txt') }),
    it(4, 'followup', 'still-applies', { commentId: 101, verdict: 'still-applies', replyKind: 'still-applies', ownOpen: true }),
    it(5, 'followup', 'reopen', { commentId: 103, parentId: 60, verdict: 'still-applies', severity: 'Low', replyKind: 'needs-reply', authorResolved: true }),
    it(6, 'answer', 'answer', { commentId: 104, verdict: 'disputed', replyKind: 'disputed', authorResolved: true }),
    it(7, 'resolve', 'resolve', { commentId: 105, verdict: 'conceded', ownOpen: true, pattern: 'p1', ruleId: 'R1' }),
    it(8, 'resolve', 'resolve', { commentId: 106, verdict: 'fixed', ownOpen: true }),
    it(9, 'outside', 'new', { findingId: 'f4', status: 'change', body: join(w, 'body-f4.txt') }),
  ],
  settled: [
    { n: null, commentId: 107, verdict: 'fixed', parentId: 50, path: 'h.cs', line: 1 },
    { n: 10, commentId: 108, verdict: 'conceded', parentId: null, path: 'i.cs', line: 1, severity: 'Low', note: 'ticket accepts it', pattern: 'p2', ruleId: 'R2', authorResolved: true },
  ],
  stillOpen: [{ commentId: 102 }],
  notPosted: [],
  rules: [{ id: 'R1', line: 'p1', from: 7 }, { id: 'R2', line: 'p2', from: 10 }],
});
const picks = makePicks();
const P = s => parseAnswer(s, picks);

test('post lists, all, all-but and ranges; all and ranges leave the outside group out', () => {
  assert.deepEqual(P('post 1,3').post, [1, 3]);
  assert.deepEqual(P('post all').post, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(P('post all but 2').post, [1, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(P('post all except 2, 4').post, [1, 3, 5, 6, 7, 8]);
  assert.deepEqual(P('post 3-9').post, [3, 4, 5, 6, 7, 8]);
  assert.deepEqual(P('post 1–2').post, [1, 2]);
  assert.deepEqual(P('post 9').post, [9], 'outside posts when named');
  assert.deepEqual(P('post all, 9').post, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(P('Post 1 and 3').post, [1, 3]);
  assert.equal(P('post all but 2').unclear, null);
});

test('edit, flip and rule; edited and flipped items wait for their own confirmation', () => {
  const r = P('post all, edit 2: say which caller, as yoda');
  assert.deepEqual(r.post, [1, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(r.edit, [{ n: 2, text: 'say which caller' }]);
  assert.equal(r.voice, 'yoda');
  const f = P('post 1, flip 6');
  assert.deepEqual([f.post, f.flip], [[1], [6]]);
  assert.deepEqual(P('flip 10').flip, [10], 'a settled conceded one flips by its listed number');
  assert.deepEqual(P('flip 7').flip, [7]);
  assert.deepEqual(P('rule R1').rules, ['R1']);
  assert.deepEqual(P('post 1 and rule r2').rules, ['R2']);
  assert.deepEqual(P('edit 1: Keep the `Foo.Bar` part, drop the rest').edit, [{ n: 1, text: 'Keep the `Foo.Bar` part, drop the rest' }]);
  assert.deepEqual(P('edit 1: phrase it as a question').edit, [{ n: 1, text: 'phrase it as a question' }]);
  assert.deepEqual(P('edit 1: shorter, flip 6').flip, [6]);
});

test('voices: a name, random, random each', () => {
  assert.equal(P('post all as random').voice, 'random');
  assert.equal(P('post all as Random Each').voice, 'random each');
  assert.equal(P('post 1 as the dude and flip 6').voice, 'the dude');
  assert.equal(P('post 1 as pinky and the brain').voice, 'pinky and the brain');
  assert.match(P('none as yoda').unclear, /voice goes with a post/);
  assert.match(P('post 1 as yoda; post 3 as barney').unclear, /more than one voice/);
});

test('none posts nothing and contradicts anything else', () => {
  assert.deepEqual(P('none'), { post: [], edit: [], flip: [], rules: [], voice: null, none: true, unclear: null });
  assert.match(P('none, post 1').unclear, /contradicts/);
});

test('anything unmappable or contradictory is unclear', () => {
  for (const [answer, re] of [
    ['', /empty/], ['1,3', /isn't tied/], ['looks good', /can't read "looks"/], ['post', /without numbers/],
    ['post 42', /no item 42/], ['post 10', /nothing to post/], ['post 5-3', /backwards/], ['post 11-20', /nothing to post in/],
    ['post all but 2, post 2', /both posted and left out/], ['post all but 42', /no item 42/], ['post 1 but 2', /can't read "but"/],
    ['flip 1', /isn't a push-back/], ['flip 8', /isn't a push-back/], ['rule R9', /no rule suggestion R9/],
    ['flip 7, rule R1', /withdrawn when you flip 7/], ['edit 4: shorter', /no comment text/], ['edit 2', /needs a number/],
    ['edit 2: a; edit 2: b', /edited twice/], ['post all but 2, edit 2: x', /left out and edited/], ['rule 1-2', /isn't tied/],
  ]) assert.match(P(answer).unclear ?? '', re, answer);
});

test('flipItem: conceded resolve → answer with its rule withdrawn; disputed → resolve on our open thread, else nothing; toggles back', () => {
  const a = flipItem(picks, 7);
  assert.deepEqual([a.items[6].kind, a.items[6].flipped, a.items[6].ruleId], ['answer', true, null]);
  assert.deepEqual(a.rules.map(r => r.id), ['R2']);
  assert.equal(flipItem(picks, 6).items[5].kind, 'none', 'not our open thread: nothing to post');
  const own = { ...picks, items: picks.items.map(i => (i.n === 6 ? { ...i, ownOpen: true, authorResolved: false } : i)) };
  assert.equal(flipItem(own, 6).items[5].kind, 'resolve');
  assert.equal(flipItem(flipItem(own, 6), 6).items[5].kind, 'answer');
  const s = flipItem(picks, 10);
  assert.deepEqual([s.items.at(-1).n, s.items.at(-1).kind, s.items.at(-1).commentId], [10, 'answer', 108]);
  assert.equal(s.settled.length, 1);
  assert.throws(() => flipItem(picks, 1), /isn't a push-back/);
});

test('openFindings counts posted change findings and follow-ups, declined push-backs, and still-open ones', () => {
  const o = (n, result) => ({ n, result });
  assert.equal(openFindings({ ...picks, outcome: everythingPosted(picks.items) }), 6);
  assert.equal(openFindings({ ...picks, outcome: [] }), 1, 'still open from the last review');
  assert.equal(openFindings({ ...picks, outcome: [o(3, 'posted'), o(8, 'posted'), o(7, 'posted'), o(9, 'declined')] }), 1, 'a note, resolves and declined findings don\'t count');
  assert.equal(openFindings({ ...picks, outcome: [o(6, 'declined'), o(7, 'declined'), o(8, 'declined'), o(4, 'declined')] }), 3, 'declined answer and conceded resolve stay open');
  assert.equal(openFindings({ items: picks.items, stillOpen: [], outcome: [o(9, 'posted')] }), 1, 'outside counts when posted');
});

const pr = { ws: 'ws', repo: 'repo', id: 7, state: 'OPEN', mine: false, myState: null };

test('decisionCalls per my current state', () => {
  const calls = (a, s) => decisionCalls(a, s, pr).map(c => c[0]);
  assert.deepEqual(calls('request-changes', null), ['request-changes']);
  assert.deepEqual(calls('request-changes', 'approved'), ['unapprove', 'request-changes']);
  assert.deepEqual(calls('request-changes', 'changes_requested'), []);
  assert.deepEqual(calls('approve', null), ['approve']);
  assert.deepEqual(calls('approve', 'changes_requested'), ['unrequest-changes', 'approve']);
  assert.deepEqual(calls('approve', 'approved'), []);
  assert.deepEqual(decisionCalls('approve', null, pr)[0], ['approve', 'ws', 'repo', '7']);
});

test('decision: hold on a failed post or tooling problem, else request changes or approve', () => {
  const d = (outcome, extra = {}) => decision({ items: picks.items, stillOpen: [], outcome, pr, ...extra });
  assert.deepEqual([d([{ n: 1, result: 'posted' }]).action, d([{ n: 1, result: 'posted' }]).why], ['request-changes', 'Request changes: 1 open finding']);
  assert.deepEqual(d([{ n: 3, result: 'posted' }]).action, 'approve');
  const h = d([{ n: 1, result: 'failed' }, { n: 3, result: 'posted' }]);
  assert.deepEqual([h.action, h.calls, h.why], ['hold', [], 'Holding: post of 1 failed']);
  assert.equal(d([], { problems: ['recheck failed'] }).why, 'Holding: recheck failed');
  const dry = d([{ n: 1, result: 'posted' }], { dryRun: true });
  assert.deepEqual([dry.dryRun, dry.calls], [true, []]);
  assert.match(dry.why, /^Dry run: would request changes/);
  assert.equal(d([], { pr: { ...pr, state: 'MERGED' } }).calls.length, 0);
  assert.deepEqual(d([], { pr: { ...pr, myState: 'changes_requested' } }).calls.map(c => c[0]), ['unrequest-changes', 'approve']);
});

const work = () => {
  const root = mkdtempSync(join(tmpdir(), 'post-'));
  const w = join(root, '.work', 'ws-repo-PR7');
  mkdirSync(w, { recursive: true });
  return w;
};

const fakeBb = (fail = {}) => {
  const calls = [];
  let next = 1000;
  const rec = (name, ...a) => {
    calls.push([name, ...a]);
    if (fail[name]) return Promise.reject(new Error(`${name} broke\ndetail`));
    return Promise.resolve({ id: ++next, links: { html: { href: `https://bb/${next}` } } });
  };
  return {
    calls,
    comment: (...a) => rec('comment', ...a), reply: (...a) => rec('reply', ...a), reopen: (...a) => rec('reopen', ...a),
    resolve: (...a) => rec('resolve', ...a), approve: (...a) => rec('approve', ...a), unapprove: (...a) => rec('unapprove', ...a),
    requestChanges: (...a) => rec('requestChanges', ...a), unrequestChanges: (...a) => rec('unrequestChanges', ...a),
  };
};

test('runPosts posts each kind from its body file and records the outcome', async () => {
  const w = work();
  const p = makePicks(w);
  for (const id of ['f1', 'f3']) writeFileSync(join(w, `body-${id}.txt`), `body ${id}\n`);
  writeFileSync(join(w, 'pushback-104.txt'), 'The import path still skips it.');
  const bb = fakeBb();
  const r = await runPosts(w, [1, 2, 4, 5, 6, 7], { picks: p, outcome: [], pr, bb, model: 'M' });
  const byName = name => bb.calls.filter(c => c[0] === name);
  assert.deepEqual(byName('comment')[0], ['comment', 'ws', 'repo', 7, { raw: 'body f1', path: 'a.cs', side: 'new', line: 10 }]);
  assert.deepEqual(byName('reopen').map(c => c[4]).sort(), [104, 60], 'reopen hits the thread root');
  assert.deepEqual(byName('resolve').map(c => c[4]), [105]);
  const replies = new Map(byName('reply').map(c => [c[4], c[5]]));
  assert.equal(replies.get(900), 'body f3');
  assert.equal(replies.get(101), '**Still applies** at L40.\n\n_AI review · M_');
  assert.match(replies.get(103), /^\*\*Still applies\*\* at L50\. If you're leaving it as it is, reply here/);
  assert.equal(replies.get(104), '**Still a problem:** The import path still skips it.\n\n_AI review · M_');
  assert.equal(readFileSync(join(w, 'body-pushback-104.txt'), 'utf8'), '**Still a problem:** The import path still skips it.\n\n_AI review · M_');
  assert.ok(readFileSync(join(w, 'body-still-101.txt'), 'utf8').startsWith('**Still applies** at L40.'));
  assert.deepEqual(r.outcome.map(o => [o.n, o.result]), [[1, 'posted'], [2, 'posted'], [4, 'posted'], [5, 'posted'], [6, 'posted'], [7, 'posted']]);
  assert.equal(r.outcome.find(o => o.n === 7).postedId, null);
  assert.ok(r.outcome.find(o => o.n === 1).link.startsWith('https://bb/'));
});

test('runPosts records a failure once and never retries it; posted and missing pushback are skipped', async () => {
  const w = work();
  const p = makePicks(w);
  writeFileSync(join(w, 'body-f1.txt'), 'b');
  const bb = fakeBb({ comment: true });
  const first = await runPosts(w, [1, 6], { picks: p, outcome: [], pr, bb, model: 'M' });
  assert.deepEqual(first.results.map(o => [o.n, o.result, o.error]), [[1, 'failed', 'comment broke']]);
  assert.deepEqual(first.skipped, [{ n: 6, why: 'write the reply to $W/pushback-104.txt first' }]);
  const again = await runPosts(w, [1], { picks: p, outcome: first.outcome, pr, bb: fakeBb(), model: 'M' });
  assert.equal(again.results.length, 0);
  assert.match(again.skipped[0].why, /not retried/);
});

test('runPosts: a reopen whose reply fails is a failure that says the thread was reopened; declined items can still post', async () => {
  const w = work();
  const p = makePicks(w);
  const r = await runPosts(w, [5], { picks: p, outcome: [{ n: 5, result: 'declined' }], pr, bb: fakeBb({ reply: true }), model: 'M' });
  assert.deepEqual([r.outcome.length, r.outcome[0].result], [1, 'failed']);
  assert.match(r.outcome[0].error, /reopened, but the reply failed/);
});

test('runPosts never resolves a thread that is not ours', async () => {
  const w = work();
  const p = makePicks(w);
  p.items[7].parentId = 55;
  const bb = fakeBb();
  const r = await runPosts(w, [8], { picks: p, outcome: [], pr, bb, model: 'M' });
  assert.equal(bb.calls.length, 0);
  assert.equal(r.outcome[0].error, 'not our thread: never resolved');
});

test('closeOutcome declines every item without an outcome, with the reason', () => {
  const p = flipItem(picks, 6);
  const r = closeOutcome(p, [{ n: 1, result: 'posted' }], 'not now');
  assert.deepEqual(r.added.map(o => o.n), [2, 3, 4, 5, 7, 8, 9], 'a flipped item with nothing to post is not declined');
  assert.equal(r.added[0].reason, 'not now');
  assert.deepEqual(r.outcome.map(o => o.n), [1, 2, 3, 4, 5, 7, 8, 9]);
});

test('reviewProblems: uncovered, missing verify, unapplied recheck, missing factcheck; nothing to verify is fine', () => {
  const w = work();
  writeFileSync(join(w, 'cand-correctness.json'), '[]');
  assert.deepEqual(reviewProblems(w), []);
  writeFileSync(join(w, 'cand-security.json'), '[{"id":"security-1"}]');
  assert.deepEqual(reviewProblems(w), ['verify failed: no verified.json']);
  writeFileSync(join(w, 'verified.json'), JSON.stringify({ findings: [{ id: 'f1', verdict: 'confirmed', issue: 'x' }] }));
  writeFileSync(join(w, 'contested.json'), '[{"id":"f1"}]');
  writeFileSync(join(w, 'uncovered.json'), '[{"dimension":"sql"}]');
  assert.deepEqual(reviewProblems(w), ['uncovered: sql', 'recheck failed: contested findings were never applied', 'factcheck failed: no factcheck.json']);
  writeFileSync(join(w, 'verify.failed'), '');
  assert.ok(reviewProblems(w).includes('verify failed'));
});

test('applyDecision runs the calls in order and stops at the first failure', async () => {
  const bb = fakeBb();
  const d = decision({ items: [], stillOpen: [{ commentId: 1 }], outcome: [], pr: { ...pr, myState: 'approved' } });
  assert.deepEqual(await applyDecision(d, bb), { action: 'request-changes', done: ['unapprove', 'request-changes'], failed: null, error: null });
  assert.deepEqual(bb.calls.map(c => c[0]), ['unapprove', 'requestChanges']);
  const r = await applyDecision(d, fakeBb({ unapprove: true }));
  assert.deepEqual([r.done, r.failed], [[], 'unapprove']);
});
