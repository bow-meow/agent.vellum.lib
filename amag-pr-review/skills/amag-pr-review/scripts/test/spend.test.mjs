import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assess, bandOf, baseline, commit, findSource, loadNotes, median, note, openNotes, report, settle } from '../spend.mjs';

const entry = (level, changed, usage) => ({ run: { level, changed }, usage });
const past = [
  entry('medium', 200, { correctness: 100000, verify: 80000 }),
  entry('medium', 250, { correctness: 120000, verify: 90000 }),
  entry(undefined, 300, { correctness: 110000, verify: 70000 }),
  entry('medium', 5000, { correctness: 900000, verify: 300000 }),
  entry('low', 220, { quick: 60000, verify: 40000 }),
];

function workDir(usage, extra = {}) {
  const w = join(mkdtempSync(join(tmpdir(), 'spend-')), '.work', 'k');
  mkdirSync(join(w, 'prompts'), { recursive: true });
  writeFileSync(join(w, 'usage.json'), JSON.stringify(usage));
  writeFileSync(join(w, 'repos.json'), JSON.stringify({ mode: 'local', ticketKey: 'SYM-1', level: 'medium', ...extra.repos }));
  writeFileSync(join(w, 'context.diff'), `diff --git a/x.cs b/x.cs\n--- a/x.cs\n+++ b/x.cs\n@@ -1,1 +1,${extra.lines ?? 250} @@\n a\n${'+b\n'.repeat((extra.lines ?? 250) - 1)}`);
  for (const [f, v] of Object.entries(extra.files ?? {})) writeFileSync(join(w, f), typeof v === 'string' ? v : JSON.stringify(v));
  return w;
}

test('median and bandOf', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
  assert.deepEqual([bandOf(0), bandOf(99), bandOf(100), bandOf(999), bandOf(1e6)], [0, 0, 1, 2, 4]);
});

test('baseline compares with runs of the same level and size band, counting unlabelled runs as medium', () => {
  const b = baseline(past, 'medium', 260);
  assert.deepEqual([b.sample, b.thin, b.total], [3, false, 180000]);
  assert.deepEqual(b.agents, { correctness: 110000, verify: 80000 });
  const thin = baseline(past, 'low', 230);
  assert.deepEqual([thin.sample, thin.thin, thin.total], [1, true, null]);
});

test('assess flags a high total, an agent far over its typical, and extra reports per key', () => {
  const base = baseline(past, 'medium', 260);
  const a = assess({ usage: { correctness: 400000, verify: 80000 }, calls: { correctness: 3, verify: 1 }, expectedCalls: { correctness: 2 }, base });
  assert.equal(a.high, true);
  assert.equal(a.agents[0].key, 'correctness');
  assert.deepEqual(a.why, [
    'total 480k is 2.67× the typical 180k for this level and size',
    'correctness: 400k, 3.64× its typical 110k',
    'correctness: 3 reports for 2 agent(s), so retries or coverage send-backs',
  ]);
  const normal = assess({ usage: { correctness: 100000, verify: 80000 }, calls: { correctness: 2, verify: 1 }, expectedCalls: { correctness: 2 }, base });
  assert.deepEqual([normal.high, normal.ratio, normal.why], [false, 1, []]);
});

test('assess does not judge agents against a thin baseline', () => {
  const a = assess({ usage: { quick: 500000 }, base: baseline(past, 'low', 230) });
  assert.deepEqual([a.high, a.ratio, a.thin], [false, null, true]);
});

test('report writes spend.json with prompt sizes and the run key, and skips without usage', () => {
  const w = workDir({ correctness: 400000, verify: 80000 }, {
    files: { 'dispatch.json': [{ agent: 'correctness-1', usageKey: 'correctness' }, { agent: 'correctness-2', usageKey: 'correctness' }],
      'usage-calls.json': { correctness: 2, verify: 1 } } });
  writeFileSync(join(w, 'prompts', 'correctness-1.md'), 'x'.repeat(2048));
  writeFileSync(join(w, 'prompts', 'correctness-2.md'), 'x'.repeat(2048));
  const r = report(w, { entries: past, notes: [], source: null, installed: 'abc' });
  assert.deepEqual([r.level, r.changed, r.runKey, r.high], ['medium', 249, 'local-SYM-1', true]);
  assert.deepEqual(r.agents.find(x => x.key === 'correctness'), { key: 'correctness', tokens: 400000, typical: 110000, ratio: 3.64, calls: 2, expectedCalls: 2, promptKB: 4 });
  assert.deepEqual(JSON.parse(readFileSync(join(w, 'spend.json'), 'utf8')).total, 480000);
  assert.equal(report(workDir({}), { entries: past, notes: [] }).skipped, true);
});

test('note records the run it came from, settle closes it with the later run, and open notes show both', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'notes-')), 'notes.jsonl');
  const w = workDir({ correctness: 400000, verify: 80000 });
  report(w, { entries: past, notes: [], source: null, installed: 'abc' });
  const nf = join(w, 'note.json');
  writeFileSync(nf, JSON.stringify({ cause: 'correctness re-read the whole diff per chunk', repair: 'chunk prompt names only its hunks', targets: ['correctness'], commit: 'c1' }));
  assert.deepEqual(note(w, nf, { path }), { noted: 'r1', path });
  const [n] = loadNotes(path);
  assert.deepEqual([n.level, n.runKey, n.before.ratio, n.before.agents], ['medium', 'local-SYM-1', 2.67, { correctness: 3.64 }]);

  const later = assess({ usage: { correctness: 120000, verify: 80000 }, base: baseline(past, 'medium', 260) });
  const git = (_, args) => { if (args[0] === 'merge-base' && args[3] !== 'live') throw new Error('not ancestor'); return ''; };
  const [open] = openNotes(loadNotes(path), { level: 'medium', a: later, source: 'src', installed: 'live', git });
  assert.deepEqual([open.live, open.now.agents], [true, { correctness: 1.09 }]);
  assert.equal(openNotes(loadNotes(path), { level: 'medium', a: later, source: 'src', installed: 'old', git })[0].live, false);
  assert.equal(openNotes(loadNotes(path), { level: 'low', a: later }).length, 0);

  assert.throws(() => settle(w, 'r1', 'great', '', { path }), /verdict must be/);
  assert.deepEqual(settle(w, 'r1', 'worked', 'correctness back to typical', { path }), { settled: 'r1', verdict: 'worked' });
  assert.equal(loadNotes(path)[0].settled.verdict, 'worked');
  assert.throws(() => settle(w, 'r1', 'worked', '', { path }), /already settled/);
  assert.throws(() => note(w, join(w, 'missing.json'), { path }), /needs a "cause"/);
});

test('findSource prefers the env var, then the config file, then the skill itself when not installed from the cache', () => {
  const root = mkdtempSync(join(tmpdir(), 'root-'));
  const src = mkdtempSync(join(tmpdir(), 'src-'));
  mkdirSync(join(src, 'amag-pr-review', 'skills', 'amag-pr-review'), { recursive: true });
  writeFileSync(join(src, 'amag-pr-review', 'skills', 'amag-pr-review', 'SKILL.md'), '');
  const cached = 'C:\\Users\\x\\.claude\\plugins\\cache\\vellum\\amag-pr-review\\abc\\skills\\amag-pr-review';
  assert.equal(findSource({ env: { PR_REVIEW_SOURCE: src }, root, skillDir: cached }), src);
  assert.equal(findSource({ env: {}, root, skillDir: cached }), null);
  mkdirSync(join(root, '.spend'));
  writeFileSync(join(root, '.spend', 'config.json'), JSON.stringify({ source: src }));
  assert.equal(findSource({ env: {}, root, skillDir: cached }), src);
  assert.equal(findSource({ env: {}, root: tmpdir(), skillDir: join(src, 'amag-pr-review', 'skills', 'amag-pr-review') }), src);
});

function fakeGit({ head = 'h1', status = ' M amag-pr-review/skills/amag-pr-review/references/prompts/reviewer.md\n' } = {}) {
  const calls = [];
  const git = (_, args) => {
    calls.push(args.join(' '));
    if (args[0] === 'rev-parse') return args[1] === '--abbrev-ref' ? 'main\n' : args.includes('--short=12') ? 'newcommit123\n' : `${head}\n`;
    if (args[0] === 'status') return args.includes('-uall') ? status : '';
    return '';
  };
  return { git, calls };
}

function spendWith(source) {
  const w = workDir({ correctness: 1 });
  writeFileSync(join(w, 'spend.json'), JSON.stringify({ source }));
  writeFileSync(join(w, 'msg.txt'), 'amag-pr-review: repair');
  return w;
}

test('commit tests and commits a repair confined to the plugin on an unmoved clean tree', () => {
  const w = spendWith({ path: 'src', branch: 'main', head: 'h1', clean: true });
  const { git, calls } = fakeGit();
  const out = commit(w, join(w, 'msg.txt'), { git, tests: () => {} });
  assert.deepEqual(out, { committed: 'newcommit123', branch: 'main', files: ['amag-pr-review/skills/amag-pr-review/references/prompts/reviewer.md'] });
  assert.ok(calls.includes('add -A -- amag-pr-review'));
  assert.ok(calls.some(c => c.startsWith('commit -q -F')));
});

test('commit refuses a dirty or moved tree, changes outside the plugin, and rolls back on failing tests', () => {
  const tests = () => {};
  const tryCommit = (source, opts) => { const w = spendWith(source); return commit(w, join(w, 'msg.txt'), opts); };
  assert.throws(() => commit(spendWith(null), 'nowhere.txt', { git: fakeGit().git, tests }), /no commit message/);
  assert.throws(() => tryCommit(null, { git: fakeGit().git, tests }), /no source checkout/);
  assert.throws(() => tryCommit({ path: 'src', branch: 'main', head: 'h1', clean: false }, { git: fakeGit().git, tests }), /uncommitted changes/);
  assert.throws(() => tryCommit({ path: 'src', branch: 'main', head: 'h0', clean: true }, { git: fakeGit().git, tests }), /moved since/);
  assert.throws(() => tryCommit({ path: 'src', branch: 'main', head: 'h1', clean: true }, { git: fakeGit({ status: ' M README.md\n' }).git, tests }), /outside amag-pr-review/);
  assert.throws(() => tryCommit({ path: 'src', branch: 'main', head: 'h1', clean: true }, { git: fakeGit({ status: '' }).git, tests }), /nothing changed/);

  const { git, calls } = fakeGit({ status: ' M amag-pr-review/a.md\n?? amag-pr-review/new.md\n' });
  const removed = [];
  const failing = () => { const e = new Error('fail'); e.stdout = 'not ok 1 - x'; throw e; };
  assert.throws(() => tryCommit({ path: 'src', branch: 'main', head: 'h1', clean: true }, { git, tests: failing, rm: p => removed.push(p) }), /tests failed, repair rolled back:\nnot ok 1 - x/);
  assert.ok(calls.includes('checkout -- amag-pr-review'));
  assert.deepEqual(removed, [join('src', 'amag-pr-review/new.md')]);
  assert.ok(!calls.some(c => c.startsWith('commit')));
});
