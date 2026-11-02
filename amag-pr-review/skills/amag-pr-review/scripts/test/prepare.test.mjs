import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDiff } from '../anchors.mjs';
import { BbError } from '../bb.mjs';
import { nativePath, posixPath } from '../env.mjs';
import {
  chooseDest, dryRunReasons, envVarName, isIncremental, myState, parseArgs, parsePrUrl,
  postProgress, prefixDiff, prepareLocal, preparePr, runGit, UserError,
} from '../prepare.mjs';

const script = fileURLToPath(new URL('../prepare.mjs', import.meta.url));
const tmp = p => mkdtempSync(join(tmpdir(), p));
const read = (...p) => readFileSync(join(...p), 'utf8');
const json = (...p) => JSON.parse(read(...p));

test('parsePrUrl accepts a PR link with a trailing tab and rejects unsafe names', () => {
  assert.deepEqual(parsePrUrl('https://bitbucket.org/amag-engineering/symmetry.web/pull-requests/42/diff'),
    { ws: 'amag-engineering', repo: 'symmetry.web', id: 42 });
  assert.throws(() => parsePrUrl('https://bitbucket.org/ws/re$po/pull-requests/1'), UserError);
  assert.throws(() => parsePrUrl('https://bitbucket.org/ws/repo/pull-requests/1x'), UserError);
  assert.throws(() => parsePrUrl('https://github.com/ws/repo/pull/1'), UserError);
});

test('parseArgs reads flags in any position and repeated --base', () => {
  const a = parseArgs(['local', 'SYM-1', '--base', 'core=release/1.0', '--base', 'ipc=origin/main', '--ar', 'C:/x']);
  assert.deepEqual(a.bases, { core: 'release/1.0', ipc: 'origin/main' });
  assert.equal(a.ar, 'C:/x');
  assert.equal(parseArgs(['--dry-run', 'pr', 'u']).dryRun, true);
  assert.throws(() => parseArgs(['pr']), UserError);
  assert.throws(() => parseArgs(['local', 'x', '--base', 'nobranch']), UserError);
  assert.throws(() => parseArgs(['nope', 'x']), UserError);
});

test('the CLI rejects a bad URL with a usage exit before touching the network', () => {
  let err;
  try { execFileSync('node', [script, 'pr', 'https://bitbucket.org/ws/repo/pull-requests/abc'], { encoding: 'utf8', stdio: 'pipe' }); }
  catch (e) { err = e; }
  assert.equal(err.status, 2);
  assert.match(err.stderr, /numeric/);
});

test('envVarName makes a folder name usable as a shell variable suffix', () => {
  assert.equal(envVarName('esg-ng-core-linux'), 'esg_ng_core_linux');
  assert.equal(envVarName('amag.symmetry.nats'), 'amag_symmetry_nats');
});

test('dry-run reasons: requested, not open, my own PR', () => {
  assert.deepEqual(dryRunReasons({ requested: false, state: 'OPEN', authorId: 'a', meId: 'b' }), []);
  assert.deepEqual(dryRunReasons({ requested: true, state: 'MERGED', authorId: 'me', meId: 'me' }),
    ['--dry-run requested', 'PR state is MERGED', 'my own PR']);
});

test('myState reads my participants entry', () => {
  const pr = { participants: [{ user: { account_id: 'x' }, state: 'approved' }, { user: { account_id: 'me' }, state: 'changes_requested' }] };
  assert.equal(myState(pr, 'me'), 'changes_requested');
  assert.equal(myState(pr, 'nobody'), null);
  assert.equal(myState({}, 'me'), null);
});

test('incremental when there is saved state, or our top-level comments but no state', () => {
  assert.equal(isIncremental({ findings: [] }, []), true);
  assert.equal(isIncremental(null, [{ id: 1, parent: null }]), true);
  assert.equal(isIncremental(null, [{ id: 2, parent: 1 }]), false);
  assert.equal(isIncremental(null, []), false);
});

const SAMPLE = [
  'diff --git a/src/a.cs b/src/a.cs',
  'index 1..2 100644',
  '--- a/src/a.cs',
  '+++ b/src/a.cs',
  '@@ -1,3 +1,3 @@',
  ' x',
  '--- a/not/a/header.sql',
  '+++ b/not/a/header.sql',
  ' y',
  'diff --git a/old name.cs b/new name.cs',
  'similarity index 100%',
  'rename from old name.cs',
  'rename to new name.cs',
  'diff --git "a/caf\\303\\251.cs" "b/caf\\303\\251.cs"',
  'Binary files "a/caf\\303\\251.cs" and "b/caf\\303\\251.cs" differ',
  'diff --git a/new.txt b/new.txt',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/new.txt',
  '@@ -0,0 +1 @@',
  '+hello',
  '',
].join('\n');

test('prefixDiff puts the repo in front of every path and parseDiff still reads it', () => {
  const out = prefixDiff(SAMPLE, 'core');
  assert.match(out, /^--- a\/core\/src\/a\.cs$/m);
  assert.match(out, /^\+\+\+ b\/not\/a\/header\.sql$/m, 'content lines inside a hunk stay as they were');
  assert.doesNotMatch(out, /core\/not/);
  assert.match(out, /^rename to core\/new name\.cs$/m);
  assert.match(out, /^--- \/dev\/null$/m);
  const files = parseDiff(out);
  assert.deepEqual([...files.keys()], ['core/src/a.cs', 'core/new name.cs', 'core/café.cs', 'core/new.txt']);
  const a = files.get('core/src/a.cs');
  assert.equal(a.added, 1);
  assert.equal(a.removed, 1);
  assert.equal(files.get('core/café.cs').binary, true);
  assert.deepEqual([...files.get('core/new.txt').newLines], [1]);
});

test('chooseDest prefers the user, then the open PR from this branch, then the closest base', () => {
  const prs = [{ id: 3, source: { branch: { name: 'other' } }, destination: { branch: { name: 'master' } } },
    { id: 4, source: { branch: { name: 'feature/SYM-1' } }, destination: { branch: { name: 'release/11.4' } } }];
  assert.deepEqual(chooseDest({ branch: 'feature/SYM-1', prs }),
    { dest: 'release/11.4', base: 'origin/release/11.4', from: 'pr', prId: 4, runnersUp: [] });
  assert.equal(chooseDest({ branch: 'feature/SYM-1', prs, override: 'origin/develop' }).dest, 'develop');
  assert.deepEqual(chooseDest({ branch: 'x', prs, closest: { base: 'origin/main', runnersUp: ['origin/master (+3)'] } }),
    { dest: 'main', base: 'origin/main', from: 'closest', runnersUp: ['origin/master (+3)'] });
  assert.equal(chooseDest({ branch: 'x', prs }), null);
});

function fakeGit(handlers, calls = []) {
  return (args, opts) => {
    calls.push(args);
    for (const [pred, out] of handlers) if (pred(args)) return typeof out === 'function' ? out(args, opts) : out;
    return '';
  };
}

function prFixture(hash = 'abc123def456') {
  return {
    id: 7, title: 'Fix it', state: 'OPEN', author: { account_id: 'author' },
    source: { repository: { full_name: 'fork/repo' }, branch: { name: "fe'at" }, commit: { hash } },
    destination: { branch: { name: 'master' } },
    participants: [{ user: { account_id: 'me' }, state: 'approved' }],
    links: { html: { href: 'https://bitbucket.org/ws/repo/pull-requests/7' } },
  };
}

function fakeBb({ prs = [prFixture()], me = { account_id: 'me' }, comments = [] } = {}) {
  const log = [];
  let n = 0;
  return {
    log,
    get: async p => { log.push(['get', p]); return p.includes('/comments') ? { values: comments } : prs[Math.min(n++, prs.length - 1)]; },
    me: async () => { if (me instanceof Error) throw me; return me; },
    diff: async () => { log.push(['diff']); return 'BBDIFF\n'; },
    general: async (ws, repo, id, body) => { log.push(['general', ws, repo, id, body]); return { id: 99, links: { html: { href: 'L' } } }; },
    remove: async (ws, repo, id, cid) => { log.push(['remove', cid]); },
  };
}

const prGit = head => fakeGit([
  [a => a.includes('rev-parse') && a.includes('FETCH_HEAD'), `${head}\n`],
  [a => a.includes('merge-base'), 'mb000\n'],
  [a => a.includes('diff'), 'diff --git a/x b/x\n'],
]);

test('preparePr writes every step-2 file, appends HEAD_SHA/MB and records the checkout', async () => {
  const ar = tmp('prep-ar-');
  const stateRoot = tmp('prep-state-');
  const calls = [];
  const comments = [
    { id: 5, user: { account_id: 'me' }, content: { raw: '⏳ **Review in progress**\n\nStarted.\n\n_AI review · m_' } },
    { id: 6, user: { account_id: 'other' }, content: { raw: 'hi' } },
  ];
  const bb = fakeBb({ comments });
  const git = (args, o) => { calls.push(args); return prGit('abc123def456ffff')(args, o); };
  const out = await preparePr({ ws: 'ws', repo: 'repo', id: 7, ar, skill: '/c/s' },
    { bb, git, textDiff: () => 'SQL\n', stateFile: () => join(stateRoot, 'none.json') });

  const W = `${posixPath(ar)}/.work/ws-repo-PR7`;
  const w = nativePath(W);
  assert.equal(out.w, W);
  assert.equal(out.dryRun, false);
  assert.equal(out.dryRunWhy, null);
  assert.deepEqual(out.staleProgress, [5]);
  assert.equal(out.incremental, false);
  assert.equal(out.headMoved, false);
  for (const f of ['pr.json', 'me.json', 'bb.diff', 'comments.json', 'comments-ours.json', 'comments-others.json', 'split-comments.json'])
    assert.ok(existsSync(join(w, f)), f);
  assert.equal(read(w, 'state-prev.json').trim(), 'null');
  assert.equal(read(w, 'context.diff'), 'diff --git a/x b/x\nSQL\n');
  const env = read(w, 'env.sh');
  assert.match(env, /^SRC_BRANCH='fe'\\''at'$/m);
  assert.match(env, /^HEAD_SHA='abc123def456ffff'\nMB='mb000'\n$/m);
  const sourced = execFileSync('bash', ['-c', `${env}\nprintf '%s|%s|%s' "$SRC_BRANCH" "$HEAD_SHA" "$W"`], { encoding: 'utf8' });
  assert.equal(sourced, `fe'at|abc123def456ffff|${W}`);
  assert.ok(bb.log.some(([k, p]) => k === 'get' && p.endsWith('comments?pagelen=100&fields=%2Bvalues.resolution.user.account_id')));

  const clone = nativePath(`${posixPath(ar)}/repo`);
  assert.deepEqual(calls[0], ['clone', '-q', 'git@bitbucket.org:ws/repo.git', clone]);
  assert.ok(calls.some(a => a.join(' ') === `-C ${clone} fetch -q git@bitbucket.org:fork/repo.git fe'at`));
  assert.ok(calls.some(a => a.includes('worktree') && a.includes('add') && a.includes('abc123def456ffff')));

  const repos = json(w, 'repos.json');
  assert.equal(repos.mode, 'pr');
  assert.deepEqual(repos.pr, {
    ws: 'ws', repo: 'repo', id: 7, title: 'Fix it', state: 'OPEN', authorId: 'author', mine: false,
    myState: 'approved', url: 'https://bitbucket.org/ws/repo/pull-requests/7',
  });
  assert.deepEqual(repos.repos, [{
    name: 'repo', ws: 'ws', repo: 'repo', clone: `${posixPath(ar)}/repo`, wt: `${posixPath(ar)}/repo-PR7`,
    dest: 'master', mb: 'mb000', head: 'abc123def456ffff', diff: `${W}/context.diff`,
  }]);
});

test('preparePr re-fetches once when the branch moved, and treats my own merged PR as a dry run', async () => {
  const ar = tmp('prep-ar-');
  const moved = { ...prFixture('0000'), state: 'MERGED', author: { account_id: 'me' } };
  const fresh = { ...prFixture('ffff1111'), state: 'MERGED', author: { account_id: 'me' } };
  const bb = fakeBb({ prs: [moved, fresh], comments: [{ id: 1, user: { account_id: 'me' }, content: { raw: '🐛 **Correctness · change needed**\n\nx\n\n_AI review · m_' } }] });
  const out = await preparePr({ ws: 'ws', repo: 'repo', id: 7, ar },
    { bb, git: prGit('ffff1111aaaa'), textDiff: () => '', stateFile: () => join(ar, 'none.json') });
  assert.equal(out.headMoved, true);
  assert.equal(bb.log.filter(([k, p]) => k === 'get' && !p.includes('comments')).length, 2);
  assert.equal(bb.log.filter(([k]) => k === 'diff').length, 2);
  const w = nativePath(out.w);
  assert.match(read(w, 'env.sh'), /SRC_HASH='ffff1111'[\s\S]*HEAD_SHA='ffff1111aaaa'/);
  assert.equal(out.dryRun, true);
  assert.equal(out.dryRunWhy, 'PR state is MERGED; my own PR');
  assert.equal(out.incremental, true);
  assert.equal(json(w, 'repos.json').pr.mine, true);
  assert.ok(out.notes.some(n => /local mode/.test(n)));
});

test('preparePr stops with the message when Bitbucket rejects /user', async () => {
  const ar = tmp('prep-ar-');
  const bb = fakeBb({ me: new BbError(401, 'u', 'nope') });
  await assert.rejects(preparePr({ ws: 'ws', repo: 'repo', id: 7, ar }, { bb, git: prGit('x') }),
    e => e instanceof UserError && /401/.test(e.message));
});

test('postProgress deletes stale notices, posts the joke notice and records PROGRESS_ID', async () => {
  const w = tmp('prep-w-');
  writeFileSync(join(w, 'repos.json'), JSON.stringify({ dryRun: false, pr: { ws: 'ws', repo: 'repo', id: 7 } }));
  writeFileSync(join(w, 'split-comments.json'), JSON.stringify({ staleProgress: [3, 4] }));
  writeFileSync(join(w, 'joke.txt'), 'A short joke.\n');
  writeFileSync(join(w, 'env.sh'), "W='x'\n");
  const bb = fakeBb();
  const out = await postProgress(w, { bb, model: () => 'm' });
  assert.equal(out.posted, 99);
  assert.deepEqual(out.deleted, [3, 4]);
  assert.match(read(w, 'env.sh'), /^PROGRESS_ID='99'$/m);
  const body = bb.log.find(([k]) => k === 'general')[4];
  assert.match(body, /Review in progress[\s\S]*🃏 A short joke\./);
  assert.equal(read(w, 'body-progress.txt'), body);
});

test('postProgress: a failed post is a note, and a dry run posts nothing', async () => {
  const w = tmp('prep-w-');
  writeFileSync(join(w, 'repos.json'), JSON.stringify({ dryRun: false, pr: { ws: 'ws', repo: 'repo', id: 7 } }));
  writeFileSync(join(w, 'env.sh'), '');
  const bb = { ...fakeBb(), general: async () => { throw new Error('HTTP 500 x\nbody'); } };
  const out = await postProgress(w, { bb, model: () => 'm' });
  assert.equal(out.posted, null);
  assert.deepEqual(out.notes, ['in-progress notice not posted: HTTP 500 x']);
  assert.equal(read(w, 'env.sh'), '');

  writeFileSync(join(w, 'repos.json'), JSON.stringify({ dryRun: true, pr: { ws: 'ws', repo: 'repo', id: 7 } }));
  const quiet = fakeBb();
  assert.equal((await postProgress(w, { bb: quiet, model: () => 'm' })).skipped, 'dryRun');
  assert.equal(quiet.log.length, 0);
});

function ticketFixture() {
  const base = tmp('prep-tw-');
  const ticket = join(base, 'SYM-77');
  mkdirSync(ticket);
  const g = (dir, ...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim();
  const repo = name => {
    const dir = join(ticket, name);
    mkdirSync(dir);
    g(dir, 'init', '-q', '-b', 'feature/SYM-77');
    g(dir, 'remote', 'add', 'origin', `git@bitbucket.org:amag/${name}.git`);
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    g(dir, 'add', '-A'); g(dir, 'commit', '-qm', 'base');
    g(dir, 'update-ref', 'refs/remotes/origin/release/1.0', 'HEAD');
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n');
    writeFileSync(join(dir, 'new.cs'), 'class N {}\n');
    return dir;
  };
  return { base, ticket, core: repo('esg-core'), ipc: repo('ipc') };
}

const noFetch = (args, opts) => (args.includes('fetch') ? '' : runGit(args, opts));

test('prepareLocal picks each base, diffs tracked and untracked changes, and prefixes paths by repo', async () => {
  const { base, ticket, core } = ticketFixture();
  writeFileSync(join(ticket, 'review-findings.json'), '{"old":true}');
  const ar = tmp('prep-ar-');
  const bb = {
    searchPrs: async (ws, repo, branch) => ({
      values: repo === 'esg-core'
        ? [{ id: 12, source: { branch: { name: branch } }, destination: { branch: { name: 'release/1.0' } } }]
        : [],
    }),
  };
  const out = await prepareLocal('sym-77', { ar, skill: '/c/s' }, {
    bb, git: noFetch, ticketBase: base, textDiff: () => '',
    closest: () => ({ base: 'origin/release/1.0', runnersUp: ['origin/master (+4)'] }),
  });
  assert.equal(out.ticketKey, 'SYM-77');
  assert.deepEqual(out.asks, []);
  assert.equal(out.suspicious, false);
  assert.deepEqual(out.repos.map(r => [r.name, r.dest, r.from, r.changed]),
    [['esg-core', 'release/1.0', 'pr', 2], ['ipc', 'release/1.0', 'closest', 2]]);
  assert.deepEqual(out.repos[1].runnersUp, ['origin/master (+4)']);
  assert.equal(read(ticket, 'review-findings.prev.json'), '{"old":true}');
  assert.ok(!existsSync(join(ticket, 'review-findings.json')));

  const w = nativePath(out.w);
  const files = parseDiff(read(w, 'context.diff'));
  assert.deepEqual([...files.keys()].sort(), ['esg-core/a.txt', 'esg-core/new.cs', 'ipc/a.txt', 'ipc/new.cs']);
  assert.match(read(w, 'esg-core.diff'), /^\+\+\+ b\/new\.cs$/m);

  const env = read(w, 'env.sh');
  const sourced = execFileSync('bash', ['-c', `${env}\nprintf '%s|%s|%s' "$TICKET_KEY" "$DEST_esg_core" "$R_ipc"`], { encoding: 'utf8' });
  assert.equal(sourced, `SYM-77|release/1.0|${posixPath(join(ticket, 'ipc'))}`);

  const repos = json(w, 'repos.json');
  assert.equal(repos.mode, 'local');
  assert.equal(repos.ticketDir, posixPath(ticket));
  assert.deepEqual(repos.repos[0], {
    name: 'esg-core', ws: 'amag', repo: 'esg-core', clone: posixPath(core), wt: posixPath(core),
    dest: 'release/1.0', mb: repos.repos[0].mb, head: null, diff: `${out.w}/esg-core.diff`,
  });
  assert.match(repos.repos[0].mb, /^[0-9a-f]{40}$/);
});

test('prepareLocal asks for a base it cannot find, takes the answer on rerun, and skips dubious repos', async () => {
  const { base } = ticketFixture();
  const ar = tmp('prep-ar-');
  const dubious = (args, opts) => {
    if (args[1].endsWith('ipc')) { const e = new Error('git: fatal: detected dubious ownership in repository'); throw e; }
    return noFetch(args, opts);
  };
  const first = await prepareLocal('SYM-77', { ar }, { git: dubious, ticketBase: base, textDiff: () => '', closest: () => null });
  assert.deepEqual(first.asks, [{ ask: 'base', repo: 'esg-core', runnersUp: [] }]);
  assert.deepEqual(first.repos, []);
  assert.ok(first.notes.some(n => /ipc: skipped.*dubious ownership/.test(n)));

  const again = await prepareLocal('SYM-77', { ar, bases: { 'esg-core': 'release/1.0' } },
    { git: dubious, ticketBase: base, textDiff: () => '', closest: () => null });
  assert.deepEqual(again.asks, []);
  assert.equal(again.repos[0].from, 'user');
  assert.equal(again.repos[0].dest, 'release/1.0');
});

test('prepareLocal flags a diff far bigger than one ticket', async () => {
  const { base, core } = ticketFixture();
  writeFileSync(join(core, 'big.txt'), Array.from({ length: 6000 }, (_, i) => `line ${i}`).join('\n') + '\n');
  const out = await prepareLocal('SYM-77', { ar: tmp('prep-ar-') },
    { git: noFetch, ticketBase: base, textDiff: () => '', closest: () => ({ base: 'origin/release/1.0', runnersUp: [] }) });
  assert.equal(out.suspicious, true);
});

test('prepareLocal reports an unknown ticket as a user error', async () => {
  await assert.rejects(prepareLocal('SYM-404', {}, { ticketBase: tmp('prep-tw-') }), UserError);
});
