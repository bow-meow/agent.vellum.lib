import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ticketKeyFrom, ticketKeyOf, prDescription, languagesOf, styleLines, touchesSql, historyFiles,
  excludeSelf, siblingSlugs, releaseRefspecs, parseArgs, run,
} from '../context.mjs';

const fileDiff = (path, added = [], removed = []) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,${removed.length} +1,${added.length} @@\n`
  + removed.map(l => `-${l}\n`).join('') + added.map(l => `+${l}\n`).join('');

test('ticketKeyFrom prefers the branch, then the title, then the description', () => {
  assert.equal(ticketKeyFrom({ branch: 'feature/SYM-1234-badge', title: 'ESG-9 x', description: 'IDM-1' }), 'SYM-1234');
  assert.equal(ticketKeyFrom({ branch: 'feature/no-key', title: 'ESG-99: fix', description: 'IDM-1' }), 'ESG-99');
  assert.equal(ticketKeyFrom({ branch: 'tidy', title: 'Tidy up', description: 'Closes IDM-7.' }), 'IDM-7');
  assert.equal(ticketKeyFrom({}), null);
});

test('ticketKeyFrom reads lower-case keys from branches only', () => {
  assert.equal(ticketKeyFrom({ branch: 'anm/sym-10498_token_expiry' }), 'SYM-10498');
  assert.equal(ticketKeyFrom({ branch: 'x', title: 'Store as utf-8', description: 'sym-12' }), null);
  assert.equal(ticketKeyFrom({ branch: 'fix-12-SYM-77' }), 'SYM-77');
  assert.equal(ticketKeyFrom({ branch: 'x', title: 'S-1 and sym-5' }), null);
});

test('ticketKeyOf uses repos.json first and needs a PR otherwise', () => {
  const pr = { source: { branch: { name: 'feature/SYM-5' } }, title: 't', description: '' };
  assert.equal(ticketKeyOf({ ticketKey: 'ESG-1' }, pr), 'ESG-1');
  assert.equal(ticketKeyOf({ ticketKey: null }, pr), 'SYM-5');
  assert.equal(ticketKeyOf({ ticketKey: null }, null), null);
  assert.equal(ticketKeyOf({}, { title: 'x', summary: { raw: 'see SYM-8' } }), 'SYM-8');
});

test('prDescription is the title and description', () => {
  assert.equal(prDescription({ title: 'Add badge', description: 'Body' }), '# Add badge\n\nBody\n');
  assert.equal(prDescription({ title: 'T' }), '# T\n\n\n');
});

test('languagesOf maps extensions to the language guide names', () => {
  assert.deepEqual(languagesOf(['a/B.cs', 'x.csproj', 'y.sln']), ['csharp-dotnet']);
  assert.deepEqual(languagesOf(['m.go', 'fw/x.h', 'fw/x.c', 'p.cc', 'q.hpp', 'r.cpp']), ['cpp-embedded', 'go']);
  assert.deepEqual(languagesOf(['app/x.component.ts', 'README.md', 'a.sql']), ['typescript-angular']);
  assert.deepEqual(languagesOf(['w.tsx']), ['typescript-angular']);
  assert.deepEqual(languagesOf([]), []);
});

test('languagesOf counts .html as Angular only beside TypeScript or in an Angular workspace', () => {
  assert.deepEqual(languagesOf(['Mail/Welcome.html', 'Mail/Sender.cs']), ['csharp-dotnet']);
  assert.deepEqual(languagesOf(['a.component.html', 'a.component.ts']), ['typescript-angular']);
  assert.deepEqual(languagesOf(['web/a.component.html'], p => p.startsWith('web/')), ['typescript-angular']);
});

test('styleLines adds added and removed lines of stylesheets only', () => {
  const files = [
    { path: 'a.scss', added: 3, removed: 2 }, { path: 'b.CSS', added: 1, removed: 0 },
    { path: 'c.sass', added: 0, removed: 4 }, { path: 'd.less', added: 1, removed: 1 },
    { path: 'e.ts', added: 50, removed: 50 }, { path: 'scss.md', added: 9, removed: 9 },
  ];
  assert.equal(styleLines(files), 12);
  assert.equal(styleLines([]), 0);
});

test('touchesSql: a .sql file in the diff, or an added line with a SQL word', () => {
  assert.equal(touchesSql(fileDiff('db/Proc.sql', ['-- comment'])), true);
  assert.equal(touchesSql('diff --git a/db/U16.sql b/db/U16.sql\nBinary files a/db/U16.sql and b/db/U16.sql differ\n'), true);
  assert.equal(touchesSql(fileDiff('Repo.cs', ['var q = "SELECT * FROM BADGE";'])), true);
  assert.equal(touchesSql(fileDiff('Repo.cs', ['conn.Query<Badge>(sql); // Dapper'])), true);
  assert.equal(touchesSql(fileDiff('Repo.cs', ['new SqlCommand(text)'])), true);
  assert.equal(touchesSql(fileDiff('Repo.cs', ['var x = 1;'], ['var q = "DELETE FROM X";'])), false);
  assert.equal(touchesSql(fileDiff('Repo.cs', ['select the item'])), false);
  assert.equal(touchesSql(''), false);
});

test('historyFiles skips generated files', () => {
  const d = fileDiff('src/A.cs', ['x']) + fileDiff('src/A.Designer.cs', ['y']) + fileDiff('package-lock.json', ['{']);
  assert.deepEqual(historyFiles(d), ['src/A.cs']);
});

test('excludeSelf drops this PR in PR mode and the reviewed branch in local mode', () => {
  const sibs = [
    { id: 12, repo: 'amag-engineering/symmetryclassic', source: 'f/SYM-1' },
    { id: 12, repo: 'amag-engineering/esg-ng-ipc', source: 'f/SYM-1' },
    { id: 13, repo: 'amag-engineering/symmetryclassic', source: 'f/SYM-1-b' },
  ];
  assert.deepEqual(excludeSelf(sibs, [{ slug: 'AMAG-engineering/SymmetryClassic', id: '12' }]).map(s => `${s.repo}#${s.id}`),
    ['amag-engineering/esg-ng-ipc#12', 'amag-engineering/symmetryclassic#13']);
  assert.deepEqual(excludeSelf(sibs, [{ slug: 'amag-engineering/symmetryclassic', branch: 'f/SYM-1-b' }]).map(s => s.id), [12, 12]);
  assert.equal(excludeSelf(sibs, [{ slug: 'amag-engineering/symmetryclassic', branch: null }]).length, 3);
  assert.equal(excludeSelf(sibs, []).length, 3);
});

test('siblingSlugs is SIBLING_REPOS plus the request, without duplicates', () => {
  const s = siblingSlugs(['amag-engineering/esg-ng-ipc', 'other/repo', 'OTHER/repo']);
  assert.equal(s.length, 7);
  assert.equal(s[0], 'amag-engineering/symmetryclassic');
  assert.equal(s.at(-1), 'other/repo');
});

test('releaseRefspecs adds the template prefix for a template destination', () => {
  const rel = '+refs/heads/release/*:refs/remotes/origin/release/*';
  assert.deepEqual(releaseRefspecs('release/11.1.0-dash'), [rel]);
  assert.deepEqual(releaseRefspecs('master'), [rel]);
  assert.deepEqual(releaseRefspecs('template/fullsample/1.0.0'),
    [rel, '+refs/heads/template/fullsample/*:refs/remotes/origin/template/fullsample/*']);
  assert.deepEqual(releaseRefspecs('origin/template/x/2.1.0-y'), [rel, '+refs/heads/template/x/*:refs/remotes/origin/template/x/*']);
  assert.deepEqual(releaseRefspecs('-x/../1.0.0'), [rel]);
  assert.deepEqual(releaseRefspecs(undefined), [rel]);
});

test('parseArgs takes W and comma-separated --siblings slugs', () => {
  assert.deepEqual(parseArgs(['/w']), { w: '/w', siblings: [] });
  assert.deepEqual(parseArgs(['/w', '--siblings', 'a/b,c/d']), { w: '/w', siblings: ['a/b', 'c/d'] });
  assert.equal(parseArgs([]), null);
  assert.equal(parseArgs(['/w', '--siblings']), null);
  assert.equal(parseArgs(['/w', '--siblings', 'a/b;rm']), null);
  assert.equal(parseArgs(['/w', '--other']), null);
});

function fakeRunners({ search = {}, deps = {}, plan = [], addFail = [], fetchFail = false } = {}) {
  const calls = [];
  const ok = stdout => ({ status: 0, stdout, stderr: '' });
  const node = (script, args) => {
    calls.push([script, ...args]);
    if (script === 'bb.mjs' && args[0] === 'search-prs') {
      const v = search[`${args[1]}/${args[2]}`];
      return v === 'fail' ? { status: 1, stdout: '', stderr: 'bb.mjs: HTTP 404\n' } : ok(JSON.stringify(v ?? []));
    }
    if (script === 'bb.mjs' && args[0] === 'diff') return ok(`diff of ${args[2]}#${args[3]}\n`);
    if (script === 'deps.mjs') return ok(JSON.stringify(deps[args[0]] ?? []));
    if (script === 'xrepo.mjs' && args[0] === 'plan') return ok(JSON.stringify(plan));
    if (script === 'xrepo.mjs' && args[0] === 'add') {
      if (addFail.includes(args[2])) return { status: 1, stdout: JSON.stringify({ slug: args[2], ref: args[3], error: 'Permission denied' }), stderr: '' };
      return ok(JSON.stringify({ slug: args[2], repo: args[2].split('/')[1], ref: args[3], sha: 'abcdef0123', kind: args[4], path: `/ar/${args[2]}` }));
    }
    if (script === 'sql-index-map.mjs') return ok('{"tables":{},"noIndexFound":[]}');
    if (script === 'forward-scan.mjs') return ok(JSON.stringify({ dest: args[2], branches: [] }));
    if (script === 'styles-scan.mjs') return ok('{"counts":{},"facts":[]}');
    throw new Error(`unexpected ${script}`);
  };
  const git = args => {
    calls.push(['git', ...args]);
    const cmd = args[2];
    if (cmd === 'log' && args[3] === '--oneline') return ok(`abc123 fix ${args.at(-1)}\n`);
    if (cmd === 'log') return ok('--- abc123\nSYM-1 do it\n\n');
    if (cmd === 'fetch') return fetchFail ? { status: 1, stdout: '', stderr: 'fatal: no remote\n' } : ok('');
    if (cmd === 'rev-parse') return ok('feature/SYM-1-x\n');
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  return { calls, runners: { node, git, exists: () => false } };
}

function prWorkDir(diff, { pr = {}, ticketKey = null } = {}) {
  const w = join(mkdtempSync(join(tmpdir(), 'ctx-')), '.work', 'amag-engineering-symmetryclassic-PR42');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'context.diff'), diff);
  writeFileSync(join(w, 'pr.json'), JSON.stringify({ title: 'Badge fix', description: 'Fixes SYM-1.', source: { branch: { name: 'feature/SYM-1-x' } }, ...pr }));
  writeFileSync(join(w, 'repos.json'), JSON.stringify({
    mode: 'pr', dryRun: false, ticketKey,
    pr: { ws: 'amag-engineering', repo: 'symmetryclassic', id: 42 },
    repos: [{ name: 'symmetryclassic', ws: 'amag-engineering', repo: 'symmetryclassic', clone: '/ar/symmetryclassic', wt: '/ar/symmetryclassic-PR42', dest: 'template/full/1.0.0', mb: 'aaaaaaa1', head: 'bbbbbbb2', diff: join(w, 'context.diff') }],
  }));
  return w;
}

test('run in PR mode writes the context pack and context.json', () => {
  const diff = fileDiff('src/Repo.cs', ['var q = "SELECT 1";']) + fileDiff('web/a.scss', ['a {}', 'b {}'], ['c {}']) + fileDiff('src/X.Designer.cs', ['y']);
  const w = prWorkDir(diff);
  const { calls, runners } = fakeRunners({
    search: {
      'amag-engineering/symmetryclassic': [{ id: 42, source: 'feature/SYM-1-x' }, { id: 7, source: 'feature/SYM-1-y', link: 'l' }],
      'amag-engineering/esg-ng-ipc': [{ id: 3, source: 'SYM-1' }],
      'amag-engineering/natscodegen': 'fail',
    },
    deps: { '/ar/symmetryclassic-PR42': [
      { name: '@amag/ui', version: '1.2.3', path: '/ar/.deps/@amag+ui@1.2.3' },
      { name: '@amag/broken', version: '0.1.0', error: 'registry is not configured in the user .npmrc' },
      { name: '@amag/local', local: 'libs/local' },
    ] },
    plan: [{ slug: 'amag-engineering/esg-ng-ipc', ref: 'SYM-1', kind: 'sibling-pr', why: 'sibling PR #3' },
      { slug: 'amag-engineering/esg-ng-core-m33', kind: 'invalid', why: 'sibling PR #9 has an unusable branch name' },
      { slug: 'amag-engineering/amag.symmetry.nats', ref: 'f', kind: 'sibling-pr', why: 'sibling PR #5' }],
    addFail: ['amag-engineering/amag.symmetry.nats'],
  });
  const ctx = run(w, { siblings: ['other/thing'] }, runners);

  assert.equal(ctx.ticketKey, 'SYM-1');
  assert.equal(ctx.changed, 4);
  assert.equal(ctx.styles, 3);
  assert.equal(ctx.sql, true);
  assert.deepEqual(ctx.languages, ['csharp-dotnet']);
  assert.equal(ctx.siblings, 2);
  assert.deepEqual(ctx.packages.map(p => `${p.repo}:${p.name}`), ['symmetryclassic:@amag/ui', 'symmetryclassic:@amag/broken', 'symmetryclassic:@amag/local']);
  assert.deepEqual(ctx.otherRepos.map(r => r.slug), ['amag-engineering/esg-ng-ipc']);
  assert.ok(ctx.notes.some(n => /natscodegen.*HTTP 404/.test(n)));
  assert.ok(ctx.notes.some(n => /@amag\/broken@0\.1\.0: registry/.test(n)));
  assert.ok(ctx.notes.some(n => /esg-ng-core-m33: invalid: sibling PR #9/.test(n)));
  assert.ok(ctx.notes.some(n => /amag\.symmetry\.nats@f: add failed: Permission denied/.test(n)));
  assert.deepEqual(JSON.parse(readFileSync(join(w, 'context.json'), 'utf8')), ctx);

  assert.equal(readFileSync(join(w, 'pr-description.md'), 'utf8'), '# Badge fix\n\nFixes SYM-1.\n');
  const sibs = JSON.parse(readFileSync(join(w, 'siblings.json'), 'utf8'));
  assert.deepEqual(sibs.map(s => `${s.repo}#${s.id}`), ['amag-engineering/symmetryclassic#7', 'amag-engineering/esg-ng-ipc#3']);
  assert.equal(readFileSync(join(w, 'siblings', 'symmetryclassic-7.diff'), 'utf8'), 'diff of symmetryclassic#7\n');
  assert.ok(existsSync(join(w, 'siblings', 'esg-ng-ipc-3.diff')));
  assert.ok(calls.some(c => c[0] === 'bb.mjs' && c[2] === 'other' && c[3] === 'thing'));

  const history = readFileSync(join(w, 'history.txt'), 'utf8');
  assert.equal(history, '## src/Repo.cs\nabc123 fix src/Repo.cs\n## web/a.scss\nabc123 fix web/a.scss\n');
  assert.equal(readFileSync(join(w, 'commits.txt'), 'utf8'), '--- abc123\nSYM-1 do it\n\n');
  assert.ok(calls.some(c => c.join(' ') === 'git -C /ar/symmetryclassic-PR42 log --format=--- %h%n%B aaaaaaa1..HEAD'));

  assert.ok(existsSync(join(w, 'index-map-symmetryclassic.json')));
  assert.ok(existsSync(join(w, 'deps-symmetryclassic.json')));
  assert.ok(existsSync(join(w, 'forward-symmetryclassic.json')));
  const fetch = calls.find(c => c[0] === 'git' && c[3] === 'fetch');
  assert.deepEqual(fetch.slice(1), ['-C', '/ar/symmetryclassic', 'fetch', '-q', 'origin',
    '+refs/heads/release/*:refs/remotes/origin/release/*', '+refs/heads/template/full/*:refs/remotes/origin/template/full/*']);
  const deps = calls.find(c => c[0] === 'deps.mjs');
  assert.equal(deps[3], join(w, '..', '..', '.deps'));
  const styles = calls.find(c => c[0] === 'styles-scan.mjs');
  assert.deepEqual(styles.slice(1), ['/ar/symmetryclassic-PR42', join(w, 'context.diff'), 'aaaaaaa1', '--lib', '/ar/.deps/@amag+ui@1.2.3']);
  const plan = calls.find(c => c[0] === 'xrepo.mjs' && c[1] === 'plan');
  assert.deepEqual(plan.slice(-2), ['--have', 'amag-engineering/symmetryclassic']);
  const adds = calls.filter(c => c[0] === 'xrepo.mjs' && c[1] === 'add');
  assert.deepEqual(adds[0].slice(2), [w, 'amag-engineering/esg-ng-ipc', 'SYM-1', 'sibling-pr', '--why', 'sibling PR #3']);
  assert.equal(adds.length, 2);
});

test('run without a ticket writes no siblings and skips SQL and styles scans when not needed', () => {
  const w = prWorkDir(fileDiff('cmd/main.go', ['x := 1']), { pr: { title: 'Tidy', description: '', source: { branch: { name: 'tidy' } } } });
  const { calls, runners } = fakeRunners({ fetchFail: true });
  const ctx = run(w, {}, runners);
  assert.equal(ctx.ticketKey, null);
  assert.equal(ctx.siblings, 0);
  assert.equal(ctx.sql, false);
  assert.equal(ctx.styles, 0);
  assert.deepEqual(ctx.languages, ['go']);
  assert.equal(readFileSync(join(w, 'siblings.json'), 'utf8'), '[]');
  assert.ok(!calls.some(c => c[0] === 'bb.mjs'));
  assert.ok(!calls.some(c => c[0] === 'sql-index-map.mjs' || c[0] === 'styles-scan.mjs'));
  assert.ok(calls.some(c => c[0] === 'forward-scan.mjs'));
  assert.ok(ctx.notes.some(n => /fetch failed: fatal: no remote/.test(n)));
  assert.ok(ctx.notes.some(n => /Ticket: none found/.test(n)));
});

test('run in local mode uses the ticket key, per-repo diffs and the reviewed branch', () => {
  const w = join(mkdtempSync(join(tmpdir(), 'ctx-')), '.work', 'local-SYM-9');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'a.diff'), fileDiff('A.cs', ['x']));
  writeFileSync(join(w, 'b.diff'), fileDiff('b.ts', ['y', 'z']));
  writeFileSync(join(w, 'context.diff'), fileDiff('A.cs', ['x']) + fileDiff('b.ts', ['y', 'z']));
  writeFileSync(join(w, 'repos.json'), JSON.stringify({
    mode: 'local', pr: null, ticketKey: 'SYM-9', ticketDir: '/c/repos/ticket-work/SYM-9',
    repos: [
      { name: 'a', ws: 'amag-engineering', repo: 'symmetryclassic', clone: '/t/a', wt: '/t/a', dest: 'release/11.1.0-x', mb: 'ccccccc3', head: null, diff: join(w, 'a.diff') },
      { name: 'b', ws: 'amag-engineering', repo: 'esg-ng-ipc', clone: '/t/b', wt: '/t/b', dest: 'main', mb: 'ddddddd4', head: null, diff: join(w, 'b.diff') },
    ],
  }));
  const { calls, runners } = fakeRunners({
    search: { 'amag-engineering/symmetryclassic': [{ id: 1, source: 'feature/SYM-1-x' }, { id: 2, source: 'other' }] },
  });
  const ctx = run(w, {}, runners);
  assert.equal(ctx.ticketKey, 'SYM-9');
  assert.equal(ctx.changed, 3);
  assert.deepEqual(ctx.languages, ['csharp-dotnet', 'typescript-angular']);
  assert.equal(ctx.siblings, 1);
  assert.ok(!existsSync(join(w, 'pr-description.md')));
  assert.equal(readFileSync(join(w, 'history.txt'), 'utf8'), '## a/A.cs\nabc123 fix A.cs\n## b/b.ts\nabc123 fix b.ts\n');
  assert.match(readFileSync(join(w, 'commits.txt'), 'utf8'), /^## a\n--- abc123[\s\S]*## b\n/);
  for (const f of ['deps-a.json', 'deps-b.json', 'forward-a.json', 'forward-b.json']) assert.ok(existsSync(join(w, f)), f);
  assert.deepEqual(calls.filter(c => c[0] === 'forward-scan.mjs').map(c => c[3]), ['release/11.1.0-x', 'main']);
});
