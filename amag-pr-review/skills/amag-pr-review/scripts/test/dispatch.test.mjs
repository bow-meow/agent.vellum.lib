import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fill, roster, agentName, checklistFiles, languagesOf, extraMaterial, repoLines, formatLines, reviewerSlots,
  coverageOf, coverageStep, nothingToVerify, addUsage, findHumanizer, winPath, defaultDest, haveSlugs,
  reviewers, coverage, failed, usage, verify, recheck, fixReview, needs, needsAnswer, DOCS_ONLY, EXTRA_RULES,
} from '../dispatch.mjs';

const SKILL = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const names = list => list.map(agentName);

test('fill replaces every slot and refuses to leave one unfilled', () => {
  assert.equal(fill('a {{X}} b {{Y_Z}}', { X: 1, Y_Z: 'two' }), 'a 1 b two');
  assert.throws(() => fill('{{X}} {{MISSING}}', { X: 'x' }), /unfilled slot\(s\): MISSING/);
  assert.equal(fill('{{X}}', { X: '{{Y}}' }), '{{Y}}', 'a value is not filled again');
});

test('roster below 200 changed lines is combined plus ticket-fit and claims when they apply', () => {
  assert.deepEqual(names(roster({ changed: 199, ticket: false, prDescription: false })), ['combined']);
  assert.deepEqual(names(roster({ changed: 10, ticket: true, prDescription: false })), ['combined', 'ticket-fit', 'claims']);
  assert.deepEqual(names(roster({ changed: 10, ticket: false, prDescription: true })), ['combined', 'claims']);
});

test('roster from 200 to 1000 adds sql and styles only when they apply', () => {
  const base = { changed: 200, ticket: false, prDescription: false, sql: false, styles: 99 };
  assert.deepEqual(names(roster(base)),
    ['correctness', 'regression', 'concurrency-races', 'resources-performance', 'tests-design', 'security', 'docs']);
  const all = names(roster({ ...base, changed: 1000, ticket: true, prDescription: true, sql: true, styles: 100 }));
  for (const r of ['sql', 'ticket-fit', 'claims', 'styles', 'security', 'docs']) assert.ok(all.includes(r), r);
});

test('roster over 1000 runs the core set per chunk and ticket-fit, claims, docs and styles once', () => {
  const list = roster({ changed: 1001, ticket: true, prDescription: true, sql: true, styles: 150 }, 2);
  const n = names(list);
  for (const c of [1, 2]) for (const r of ['correctness', 'regression', 'concurrency-races', 'resources-performance', 'sql', 'tests-design', 'security'])
    assert.ok(n.includes(`${r}-${c}`), `${r}-${c}`);
  for (const r of ['ticket-fit', 'claims', 'docs', 'styles']) assert.equal(n.filter(x => x === r).length, 1, r);
  assert.ok(!n.some(x => /^(ticket-fit|claims|docs|styles)-\d/.test(x)));
});

test('checklistFiles maps reviewers to dimension files, languages, and stylesheets only for styles and combined', () => {
  const env = { skillDir: SKILL, languages: ['csharp-dotnet'], styles: 5 };
  const base = f => f.split('\\').slice(-2).join('/');
  assert.deepEqual(checklistFiles('tests-design', env).map(base),
    ['dimensions/tests-history.md', 'dimensions/design-quality.md', 'languages/csharp-dotnet.md']);
  const combined = checklistFiles('combined', env).map(base);
  assert.ok(!combined.includes('dimensions/ticket-fit.md') && !combined.includes('dimensions/claims.md'));
  assert.ok(combined.includes('languages/stylesheets.md'));
  assert.ok(!checklistFiles('combined', { ...env, styles: 0 }).map(base).includes('languages/stylesheets.md'));
  assert.deepEqual(checklistFiles('styles', env).map(base), ['languages/stylesheets.md', 'languages/csharp-dotnet.md']);
  assert.ok(!checklistFiles('correctness', env).map(base).includes('languages/stylesheets.md'));
  for (const f of checklistFiles('combined', { ...env, languages: ['go', 'cpp-embedded', 'typescript-angular'] })) assert.ok(existsSync(f), f);
});

test('languagesOf reads languages from file extensions', () => {
  assert.deepEqual(languagesOf(['a/B.cs', 'x.h', 'y.go', 'c.component.html', 'd.scss', 'e.csproj']),
    ['csharp-dotnet', 'cpp-embedded', 'go', 'typescript-angular', 'stylesheets']);
  assert.deepEqual(languagesOf(['README.md']), []);
});

test('extraMaterial gives each reviewer its own files', () => {
  const env = { sql: true, material: {
    siblings: 'W/siblings.json', indexMaps: ['W/index-map-a.json', 'W/index-map-b.json'], forward: ['W/forward-a.json'],
    history: 'W/history.txt', commits: 'W/commits.txt', stylesFacts: ['W/styles-facts-a.json'] } };
  assert.equal(extraMaterial('ticket-fit', env), 'Sibling PRs: W/siblings.json');
  assert.equal(extraMaterial('sql', env), 'Index maps: W/index-map-a.json, W/index-map-b.json; Forward-scan: W/forward-a.json');
  assert.equal(extraMaterial('correctness', env), 'Forward-scan: W/forward-a.json');
  assert.equal(extraMaterial('tests-design', env), 'History file: W/history.txt; Commit messages: W/commits.txt');
  assert.equal(extraMaterial('styles', env), 'Stylesheet facts (leads to confirm, not findings): W/styles-facts-a.json');
  assert.equal(extraMaterial('combined', env).split('; ').length, 5);
  assert.ok(!extraMaterial('combined', { ...env, sql: false }).includes('Index maps'));
  assert.equal(extraMaterial('security', env), 'none');
});

test('repoLines lists repos, fetched and local packages, then other-repo lines', () => {
  const lines = repoLines([{ name: 'web', wt: '/c/wt/web' }], {
    web: [
      { name: '@amag/ui', version: '1.2.3', path: 'C:/deps/@amag+ui@1.2.3' },
      { name: '@amag/sdk', local: 'libs/sdk' },
      { name: '@amag/broken', version: '2.0.0', error: 'nope' },
    ],
  }, ['natscodegen@abcd1234 (ask: main; read-only context, not under review): C:/x']);
  assert.deepEqual(lines, [
    String.raw`web: C:\wt\web`,
    '@amag/ui@1.2.3 (published package, read-only; original source under src/): C:/deps/@amag+ui@1.2.3',
    String.raw`@amag/sdk (in web, imported by the changed code): C:\wt\web\libs\sdk`,
    'natscodegen@abcd1234 (ask: main; read-only context, not under review): C:/x',
  ]);
  assert.equal(formatLines(['one']), 'one');
  assert.equal(formatLines(['a', 'b']), '\n  - a\n  - b');
});

test('reviewerSlots keeps regression blind and numbers chunk ids from <n>01', () => {
  const env = { w: 'C:/w', skillDir: SKILL, mode: 'pr', pr: { id: 7, title: 'Fix it' }, ticketKey: 'SYM-1', repos: 'r: C:/wt',
    ticketSummary: 'sum', ticketFile: 'C:\\w\\ticket.md', prDescriptionFile: 'C:\\w\\pr-description.md',
    languages: [], styles: 0, sql: false, material: { indexMaps: [], forward: [], stylesFacts: [] } };
  const reg = reviewerSlots({ reviewer: 'regression', chunk: 3, diffFile: 'C:/w/chunks/chunk-3.diff' }, env);
  assert.equal(reg.MODE, 'PR mode (#7)');
  assert.equal(reg.TICKET_SUMMARY, 'none');
  assert.equal(reg.TICKET_FILE, 'none');
  assert.equal(reg.PR_DESCRIPTION_FILE, 'none');
  assert.equal(reg.ID_START, '301');
  assert.equal(reg.OUT_FILE, 'C:/w/cand-regression-3.json');
  assert.equal(reg.COVERAGE_FILE, 'C:/w/cov-regression-3.json');
  assert.equal(reg.NEEDS_FILE, 'C:/w/needs-regression-3.json');
  assert.equal(reg.DIFF_FILE, 'C:\\w\\chunks\\chunk-3.diff');
  const cor = reviewerSlots({ reviewer: 'correctness', chunk: null, diffFile: 'C:/w/context.diff' }, env);
  assert.equal(cor.MODE, 'PR mode (#7: Fix it)');
  assert.equal(cor.ID_START, '1');
  assert.equal(cor.TICKET_SUMMARY, 'sum');
  const again = reviewerSlots({ reviewer: 'regression', chunk: null, diffFile: 'x' }, { ...env, reReview: true });
  assert.match(again.MODE, /^PR mode \(#7\), re-review: the diff holds only what changed since the last review/);
  assert.equal(reviewerSlots({ reviewer: 'claims', chunk: null, diffFile: 'x' }, env).EXTRA_RULES, EXTRA_RULES.claims);
  const local = reviewerSlots({ reviewer: 'regression', chunk: null, diffFile: 'x' }, { ...env, mode: 'local' });
  assert.equal(local.MODE, 'local mode (SYM-1, uncommitted changes included)');
});

test('coverageOf skips ticket-fit, claims and styles and limits docs to prose files', () => {
  assert.deepEqual(coverageOf('claims'), { coverage: 'skip', only: null });
  assert.deepEqual(coverageOf('styles'), { coverage: 'skip', only: null });
  assert.deepEqual(coverageOf('docs'), { coverage: 'check', only: DOCS_ONLY });
  assert.ok(new RegExp(DOCS_ONLY, 'i').test('a/Strings.resx') && !new RegExp(DOCS_ONLY, 'i').test('a.cs'));
  assert.deepEqual(coverageOf('combined'), { coverage: 'check', only: null });
});

test('coverageStep sends a reviewer back twice, then calls the rest uncovered', () => {
  const m = [{ path: 'a', side: 'new', from: 1, to: 2 }];
  let s = coverageStep(0, m);
  assert.deepEqual(s.result, { ok: false, missing: m, round: 1 });
  s = coverageStep(s.failures, m);
  assert.deepEqual(s.result, { ok: false, missing: m, round: 2 });
  s = coverageStep(s.failures, m);
  assert.deepEqual(s.result, { uncovered: true, missing: m });
  assert.deepEqual(coverageStep(1, []).result, { ok: true, missing: [] });
});

test('nothingToVerify only when every candidate file is [] and no previous findings to recheck', () => {
  assert.equal(nothingToVerify([[], []], false), true);
  assert.equal(nothingToVerify([[], []], true), false);
  assert.equal(nothingToVerify([[], [{ id: 'x' }]], false), false);
  assert.equal(nothingToVerify([undefined], false), false, 'an unreadable file is not empty');
});

test('addUsage adds to an existing key', () => {
  assert.deepEqual(addUsage({ correctness: 100 }, 'correctness', 50), { correctness: 150 });
  assert.deepEqual(addUsage({}, 'verify', 7), { verify: 7 });
});

test('winPath turns MSYS and forward-slash paths into Windows paths', () => {
  assert.equal(winPath('/c/repos/ai-review/.work/x/ticket.md'), 'C:\\repos\\ai-review\\.work\\x\\ticket.md');
  assert.equal(winPath('C:/repos/x'), 'C:\\repos\\x');
});

test('defaultDest and haveSlugs read repos.json', () => {
  assert.equal(defaultDest({ mode: 'pr', repos: [{ dest: 'release/11.1.0' }] }), 'release/11.1.0');
  assert.equal(defaultDest({ mode: 'local', repos: [{ name: 'web', dest: 'main' }, { name: 'symmetryclassic', dest: 'release/11' }] }), 'release/11');
  assert.equal(defaultDest({ mode: 'local', repos: [{ name: 'web', dest: 'main' }] }), null);
  assert.deepEqual(haveSlugs({ repos: [{ ws: 'amag-engineering', repo: 'symmetryclassic', name: 'symmetryclassic' }] }), ['amag-engineering/symmetryclassic']);
});

test('findHumanizer prefers the installed plugin, else searches the plugins folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-plug-'));
  const inst = join(dir, 'cache', 'v', 'humanizer', 'abc');
  mkdirSync(join(inst, 'skills', 'humanizer'), { recursive: true });
  writeFileSync(join(inst, 'skills', 'humanizer', 'SKILL.md'), '#');
  const other = join(dir, 'cache', 'v', 'humanizer', 'zzz', 'skills', 'humanizer');
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, 'SKILL.md'), '#');
  assert.ok(findHumanizer(dir).endsWith('SKILL.md'));
  writeFileSync(join(dir, 'installed_plugins.json'), JSON.stringify({ plugins: { 'humanizer@v': [{ installPath: inst }] } }));
  assert.equal(findHumanizer(dir), join(inst, 'skills', 'humanizer', 'SKILL.md'));
  assert.equal(findHumanizer(join(dir, 'missing')), null);
});

function fileDiff(path, added) {
  const lines = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, `@@ -1,1 +1,${added + 1} @@`, ' keep'];
  for (let i = 0; i < added; i++) lines.push(`+line ${i}`);
  return lines.join('\n');
}

function workDir({ mode = 'pr', changed = 50, diff, ticket = true, extra = {} } = {}) {
  const w = mkdtempSync(join(tmpdir(), 'dispatch-w-'));
  const wt = join(w, 'wt');
  writeFileSync(join(w, 'repos.json'), JSON.stringify({
    mode, dryRun: false,
    pr: mode === 'pr' ? { ws: 'amag-engineering', repo: 'symmetryclassic', id: 42, title: 'Add {{thing}}' } : null,
    ticketKey: 'SYM-9', ticketDir: null,
    repos: [{ name: 'symmetryclassic', ws: 'amag-engineering', repo: 'symmetryclassic', clone: wt, wt, dest: 'release/11.1.0', mb: 'abc', head: 'def', diff: join(w, 'context.diff') }],
  }));
  writeFileSync(join(w, 'context.json'), JSON.stringify({ changed, styles: 0, languages: ['csharp-dotnet'], sql: false, ticketKey: 'SYM-9', ...extra }));
  writeFileSync(join(w, 'context.diff'), diff ?? fileDiff('src/A.cs', 3));
  if (ticket) {
    writeFileSync(join(w, 'ticket.md'), '# SYM-9');
    writeFileSync(join(w, 'ticket-summary.txt'), 'line one\nline {{two}}\n');
  }
  if (mode === 'pr') writeFileSync(join(w, 'pr-description.md'), 'desc');
  writeFileSync(join(w, 'siblings.json'), '[]');
  writeFileSync(join(w, 'deps-symmetryclassic.json'), JSON.stringify([{ name: '@amag/x', version: '1.0.0', path: 'C:/deps/x' }]));
  return w;
}

test('reviewers fills a prompt per agent with every slot set and writes dispatch.json', () => {
  const w = workDir();
  const out = reviewers(w, { skillDir: SKILL });
  assert.deepEqual(out.map(o => o.agent), ['combined', 'ticket-fit', 'claims']);
  for (const o of out) {
    const text = readFileSync(o.promptFile, 'utf8');
    assert.ok(!/\{\{[A-Z_]+\}\}/.test(text), `${o.agent} has an unfilled slot`);
  }
  const combined = readFileSync(out[0].promptFile, 'utf8');
  assert.match(combined, /PR mode \(#42: Add \{\{thing\}\}\)/);
  assert.match(combined, /@amag\/x@1\.0\.0 \(published package/);
  assert.match(combined, /Ticket summary: line one line \{\{two\}\}/);
  assert.deepEqual(out.find(o => o.agent === 'claims').coverage, 'skip');
  assert.deepEqual(JSON.parse(readFileSync(join(w, 'dispatch.json'), 'utf8')), out);
});

test('reviewers splits a diff over 1000 lines into chunks and points each chunk agent at its chunk', () => {
  const diff = ['a/one/A.cs', 'b/two/B.cs', 'c/three/C.cs'].map(p => fileDiff(p, 500)).join('\n') + '\n';
  const w = workDir({ changed: 1500, diff, ticket: false });
  const out = reviewers(w, { skillDir: SKILL });
  assert.ok(readdirSync(join(w, 'chunks')).length >= 2);
  const c2 = out.find(o => o.agent === 'correctness-2');
  assert.match(c2.diffFile, /chunks\/chunk-2\.diff$/);
  assert.match(readFileSync(c2.promptFile, 'utf8'), /correctness-201/);
  const docs = out.find(o => o.agent === 'docs');
  assert.match(docs.diffFile, /context\.diff$/);
  assert.equal(docs.only, DOCS_ONLY);
  const reg = readFileSync(out.find(o => o.agent === 'regression-1').promptFile, 'utf8');
  assert.match(reg, /Mode: PR mode \(#42\)\n/);
  assert.match(reg, /PR description: `none`/);
});

test('coverage counts rounds per agent and records the agent as uncovered after two', () => {
  const w = workDir({ diff: fileDiff('src/A.cs', 3) + '\n' });
  reviewers(w, { skillDir: SKILL });
  const r1 = coverage(w, 'combined');
  assert.equal(r1.ok, false);
  assert.equal(r1.round, 1);
  assert.equal(coverage(w, 'combined').round, 2);
  const r3 = coverage(w, 'combined');
  assert.equal(r3.uncovered, true);
  assert.deepEqual(JSON.parse(readFileSync(join(w, 'uncovered.json'), 'utf8')).map(u => u.agent), ['combined']);
  writeFileSync(join(w, 'cov-combined.json'), JSON.stringify([{ path: 'src/A.cs', side: 'new', from: 1, to: 9, checked: 'ok' }]));
  assert.deepEqual(coverage(w, 'combined'), { ok: true, missing: [] });
  assert.equal(coverage(w, 'claims').skipped, true);
  assert.throws(() => coverage(w, 'nobody'), /not in dispatch\.json/);
});

test('usage adds tokens under a key in usage.json', () => {
  const w = workDir();
  usage(w, 'correctness', 1000);
  assert.deepEqual(usage(w, 'correctness', 500), { correctness: 1500 });
});

test('verify skips when there is nothing to verify, else fills the prompt', () => {
  const w = workDir();
  writeFileSync(join(w, 'cand-combined.json'), '[]');
  assert.deepEqual(verify(w, { skillDir: SKILL, pluginsDir: join(w, 'none') }), { skip: true });
  writeFileSync(join(w, 'previous-recheck.json'), '[]');
  const r = verify(w, { skillDir: SKILL, pluginsDir: join(w, 'none') });
  assert.equal(r.skip, false);
  const text = readFileSync(r.promptFile, 'utf8');
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(text));
  assert.match(text, /`none`: the full catalogue/);
  assert.match(text, /previous-recheck\.json/);
  assert.match(text, /Sibling PRs for ticket SYM-9/);
});

test('recheck writes contested.json and skips when nothing is contested', () => {
  const w = workDir();
  const cand = { id: 'correctness-1', severity: 'High', path: 'a', line: 1 };
  writeFileSync(join(w, 'cand-correctness.json'), JSON.stringify([cand]));
  assert.deepEqual(recheck(w, { skillDir: SKILL }), { skip: true }, 'verify skipped or failed: no verified.json');
  writeFileSync(join(w, 'verified.json'), JSON.stringify({ findings: [{ id: 'f1', sources: ['correctness-1'], verdict: 'confirmed', severity: 'High', confidence: 'high', confidence_reason: 'traced' }] }));
  assert.deepEqual(recheck(w, { skillDir: SKILL }), { skip: true });
  assert.deepEqual(JSON.parse(readFileSync(join(w, 'contested.json'), 'utf8')), []);
  writeFileSync(join(w, 'verified.json'), JSON.stringify({ findings: [{ id: 'f1', sources: ['correctness-1'], verdict: 'dropped', severity: 'High', reason: 'guarded' }] }));
  const r = recheck(w, { skillDir: SKILL });
  assert.equal(r.contested, 1);
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(readFileSync(r.promptFile, 'utf8')));
});

test('fix-review uses correctness plus each touched file\'s language, with repos from the findings file when repos.json is gone', () => {
  const w = mkdtempSync(join(tmpdir(), 'dispatch-fix-'));
  const findings = join(w, 'review-findings.json');
  writeFileSync(findings, JSON.stringify({ repos: [{ name: 'web', path: 'C:/t/web', dest: 'main' }] }));
  const r = fixReview(w, ['src/a.component.ts', 'src/b.scss'], { skillDir: SKILL, fixFindings: findings });
  const text = readFileSync(r.promptFile, 'utf8');
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(text));
  assert.match(text, /correctness\.md, .*typescript-angular\.md, .*stylesheets\.md/);
  assert.match(text, /web: C:\\t\\web/);
  assert.throws(() => fixReview(mkdtempSync(join(tmpdir(), 'dispatch-fix-')), ['a.cs'], { skillDir: SKILL }), /no repos/);
});

function fakeXrepo(w, needsResult) {
  const calls = [];
  const fn = args => {
    calls.push(args);
    if (args[0] === 'needs') return JSON.stringify(needsResult);
    if (args[0] === 'add') {
      const [, , slug, ref, kind] = args;
      if (ref === 'bad') { const e = new Error('exit 1'); e.stdout = JSON.stringify({ slug, ref, error: 'no such ref' }); throw e; }
      const ledger = join(w, 'xrepo.json');
      const prev = existsSync(ledger) ? JSON.parse(readFileSync(ledger, 'utf8')) : [];
      const rec = { slug, repo: slug.split('/')[1], ref, sha: 'abcdef1234567890', kind, why: args[6], path: `C:/ar/${slug.split('/')[1]}-x`, clone: 'C:/ar/c' };
      writeFileSync(ledger, JSON.stringify([...prev, rec]));
      return JSON.stringify(rec);
    }
    throw new Error(`unexpected ${args[0]}`);
  };
  return { fn, calls };
}

test('needs adds ref requests, lists asks and skips, renames handled files, and notifies each agent once', () => {
  const w = workDir();
  writeFileSync(join(w, 'needs-correctness.json'), JSON.stringify([{ repo: 'esg-ng-ipc', question: 'q1', candidates: ['correctness-1'] }]));
  writeFileSync(join(w, 'needs-security.json'), '[]');
  writeFileSync(join(w, 'needs-docs.done.json'), '[]');
  const { fn, calls } = fakeXrepo(w, {
    requests: [
      { slug: 'amag-engineering/esg-ng-ipc', asks: [{ agent: 'correctness', question: 'q1' }, { agent: 'security', question: 'q2' }], ref: 'main', kind: 'rule' },
      { slug: 'amag-engineering/natscodegen', asks: [{ agent: 'security', question: 'q3' }], kind: 'ask', why: 'no branch rule for this repo', options: ['main', 'release/2', 'release/1', 'template/x'] },
      { slug: 'amag-engineering/esg-ng-core-m33', asks: [{ agent: 'docs', question: 'q4' }], kind: 'over-cap' },
    ],
    rejected: [{ agent: 'docs', repo: null, why: 'not in SIBLING_REPOS' }],
  });
  const r = needs(w, { xrepo: fn });
  const needsCall = calls.find(c => c[0] === 'needs');
  assert.deepEqual(needsCall.slice(2), ['--dest', 'release/11.1.0', '--have', 'amag-engineering/symmetryclassic']);
  const add = calls.find(c => c[0] === 'add');
  assert.deepEqual(add.slice(2), ['amag-engineering/esg-ng-ipc', 'main', 'rule', '--why', 'asked by correctness, security']);
  assert.ok(!calls.some(c => c.includes('q1')), 'questions never reach a command line');
  assert.deepEqual(r.added.map(a => a.repo), ['amag-engineering/esg-ng-ipc']);
  assert.deepEqual(r.asks, [{ repo: 'amag-engineering/natscodegen', why: 'no branch rule for this repo', questions: [{ agent: 'security', question: 'q3' }], options: ['main', 'release/2', 'release/1'] }]);
  assert.deepEqual(r.skipped.map(s => s.kind), ['over-cap', 'rejected']);
  assert.deepEqual(r.agentsToNotify, ['correctness', 'security']);
  assert.equal(r.reposLines.length, 1);
  assert.match(r.reposLines[0], /^esg-ng-ipc@abcdef12 \(rule: main;/);
  const left = readdirSync(w).filter(n => n.startsWith('needs-'));
  assert.ok(left.includes('needs-correctness.done.json') && left.includes('needs-security.done.json') && !left.includes('needs-correctness.json'));

  const a = needsAnswer(w, 'natscodegen', 'release/2', { xrepo: fn });
  assert.deepEqual(a.added.map(x => [x.repo, x.kind]), [['amag-engineering/natscodegen', 'user-picked']]);
  assert.deepEqual(a.agentsToNotify, [], 'security was already sent its round');
  assert.equal(a.reposLines.length, 2);
  assert.throws(() => needsAnswer(w, 'natscodegen', 'main', { xrepo: fn }), /no open repo request/);
});

test('needs with no pending files calls nothing and reports a failed add as skipped', () => {
  const w = workDir();
  const { fn, calls } = fakeXrepo(w, { requests: [], rejected: [] });
  assert.deepEqual(needs(w, { xrepo: fn }), { added: [], asks: [], skipped: [], reposLines: [], agentsToNotify: [] });
  assert.equal(calls.length, 0);
  writeFileSync(join(w, 'needs-verify.json'), '[]');
  const bad = fakeXrepo(w, { requests: [{ slug: 'amag-engineering/esg-ng-ipc', asks: [{ agent: 'verify', question: 'q' }], ref: 'bad', kind: 'rule' }], rejected: [] });
  const r = needs(w, { xrepo: bad.fn, dest: 'other' });
  assert.deepEqual(bad.calls[0].slice(2, 4), ['--dest', 'other']);
  assert.deepEqual(r.skipped.map(s => [s.kind, s.why]), [['add-failed', 'no such ref']]);
  assert.deepEqual(r.agentsToNotify, []);
});

test('failed records a reviewer as uncovered and verify-type steps as a marker file', () => {
  const w = mkdtempSync(join(tmpdir(), 'dispatch-failed-'));
  writeFileSync(join(w, 'dispatch.json'), JSON.stringify([{ agent: 'correctness-2', reviewer: 'correctness' }]));
  failed(w, 'correctness-2');
  failed(w, 'correctness-2');
  assert.deepEqual(JSON.parse(readFileSync(join(w, 'uncovered.json'), 'utf8')),
    [{ agent: 'correctness-2', reviewer: 'correctness', missing: 'all', failed: true }]);
  failed(w, 'recheck');
  assert.ok(existsSync(join(w, 'recheck.failed')));
  assert.throws(() => failed(w, 'nobody'), /not in dispatch\.json/);
});
