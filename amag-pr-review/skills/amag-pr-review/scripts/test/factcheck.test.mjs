import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { facts, factCheck, buildPairs, build, estimateTokens } from '../factcheck.mjs';

const script = fileURLToPath(new URL('../factcheck.mjs', import.meta.url));
const draft = '`SaveCardholder` checks then inserts without a unique constraint on BADGE_ID, so two saves at line 212 will create duplicates. Add a unique index or use `MERGE ... WITH (HOLDLOCK)`.';

test('facts extracts code spans, identifiers and numbers, not the header', () => {
  const f = facts('**blocking** · AI:Opus 5.5\n\n' + draft);
  assert.deepEqual(f.code, ['SaveCardholder', 'MERGE ... WITH (HOLDLOCK)']);
  assert.ok(f.idents.includes('BADGE_ID'));
  assert.ok(f.numbers.includes('212'));
  assert.ok(!f.numbers.includes('5'));
});

test('a faithful rewrite passes', () => {
  const final = "`SaveCardholder` checks then inserts, and there's no unique constraint on BADGE_ID, so two saves hitting line 212 at once will create duplicates. Add a unique index or use `MERGE ... WITH (HOLDLOCK)`.";
  assert.deepEqual(factCheck(draft, final), { ok: true, missing: [], certaintyDropped: false });
});

test('dropped identifiers and numbers are reported', () => {
  const r = factCheck(draft, '`SaveCardholder` can create duplicates. Add a unique index or use `MERGE ... WITH (HOLDLOCK)`.');
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes('BADGE_ID'));
  assert.ok(r.missing.includes('212'));
});

test('softened certainty is reported', () => {
  const r = factCheck(draft, draft.replace('will create', 'might create'));
  assert.equal(r.certaintyDropped, true);
  assert.equal(r.ok, false);
});

test('an identifier moved from prose into a code span still counts', () => {
  assert.deepEqual(factCheck('allow $JS.FC.OBJ_applications.> here', 'allow `$JS.FC.OBJ_applications.>` here').missing, []);
});

test('a number is not satisfied by a longer number', () => {
  assert.ok(factCheck('off by 2 here', 'off by 21 here').missing.includes('2'));
});

test('a fact moved between issue and fix still counts', () => {
  const verified = { findings: [{ id: 'f1', verdict: 'confirmed', severity: 'Medium', sources: ['c-1'], issue: 'Two saves race.', fix: 'Index BADGE_ID.' }] };
  const [p] = buildPairs(verified, [{ id: 'c-1', issue: 'Two saves race on BADGE_ID.', fix: 'Add an index.' }]);
  assert.equal(factCheck(p.draft.text, p.final.text).ok, true);
});

test('buildPairs takes the draft from the reviewer candidate and the status from the verifier severity', () => {
  const verified = { findings: [
    { id: 'f1', verdict: 'confirmed', severity: 'Low', sources: ['correctness-1'], issue: 'tidy issue', fix: 'tidy fix' },
    { id: 'f2', verdict: 'dropped', sources: ['x-1'] },
  ] };
  const cands = [{ id: 'correctness-1', issue: 'Original issue with BADGE_ID.', fix: 'Original fix.' }];
  const [p, ...rest] = buildPairs(verified, cands);
  assert.equal(rest.length, 0);
  assert.equal(p.status, 'change');
  assert.deepEqual(p.draft, { issue: 'Original issue with BADGE_ID.', fix: 'Original fix.', text: 'Original issue with BADGE_ID.\nOriginal fix.' });
  assert.deepEqual(p.final, { issue: 'tidy issue', fix: 'tidy fix', text: 'tidy issue\ntidy fix' });
});

test('a legacy candidate with only a comment is used as the issue', () => {
  const verified = { findings: [{ id: 'f1', verdict: 'confirmed', severity: 'Low/nit', sources: ['c-1'], issue: 'i', fix: '' }] };
  const [p] = buildPairs(verified, [{ id: 'c-1', comment: 'Old style body.' }]);
  assert.deepEqual(p.draft, { issue: 'Old style body.', fix: '', text: 'Old style body.' });
});

test('build formats the body from whichever side passed, and lints its style', () => {
  const verified = { findings: [
    { id: 'f1', verdict: 'confirmed', severity: 'Medium', sources: ['c-1'], issue: 'Two saves race on BADGE_ID at line 212.', fix: 'Add a unique index.' },
    { id: 'f2', verdict: 'confirmed', severity: 'Low/nit', sources: ['c-2'], issue: 'Rename it.', fix: '' },
  ] };
  const cands = [
    { id: 'c-1', issue: 'Two saves race on BADGE_ID at line 212.', fix: 'Add a unique index.' },
    { id: 'c-2', issue: 'Rename `fooBar` — it hides the field.', fix: 'Call it `barCount`.' },
  ];
  const [a, b] = build(verified, cands, 'Opus 5.5');
  assert.equal(a.use, 'final');
  assert.equal(a.body, '🟠 **change needed** · 🤖 AI:Opus 5.5 · 🔎 c\n\nTwo saves race on BADGE_ID at line 212.\n\n**Fix:** Add a unique index.');
  assert.deepEqual(a.style, []);
  assert.equal(b.use, 'draft');
  assert.ok(b.body.startsWith('🟠 **change needed** · 🤖 AI:Opus 5.5 · 🔎 c\n\nRename `fooBar`'));
  assert.ok(b.style.includes('em dash'));
});

test('estimateTokens charges each reviewer to its findings and shares the rest, adding up to the total', () => {
  const reviewersById = new Map([['f1', ['correctness']], ['f2', ['correctness', 'ticket-fit']], ['f3', ['tests-design']]]);
  const usage = { correctness: 100000, 'ticket-fit': 40000, 'tests-design': 20000, security: 30000, verify: 60000, recheck: 30000 };
  // Shared pool: security (no finding) + verify + recheck = 120000, 40000 each.
  const t = estimateTokens(reviewersById, usage);
  assert.equal(t.get('f1'), 50000 + 40000);
  assert.equal(t.get('f2'), 50000 + 40000 + 40000);
  assert.equal(t.get('f3'), 20000 + 40000);
  assert.equal([...t.values()].reduce((a, b) => a + b), 280000);
  assert.equal(estimateTokens(reviewersById, null).size, 0);
});

test('build puts each finding\'s attributed share in its header', () => {
  const verified = { findings: [
    { id: 'f1', verdict: 'confirmed', severity: 'Low', sources: ['correctness-1'], issue: 'Rename it.', fix: '' },
    { id: 'f2', verdict: 'confirmed', severity: 'Low/nit', sources: ['ticket-fit-1'], issue: 'Drop it.', fix: '' },
  ] };
  const cands = [{ id: 'correctness-1', issue: 'Rename it.', fix: '' }, { id: 'correctness-2' }, { id: 'ticket-fit-1', issue: 'Drop it.', fix: '' }];
  const out = build(verified, cands, 'Opus 5.5', { correctness: 100000, 'ticket-fit': 60000, verify: 40000 });
  assert.deepEqual(out.map(e => e.tokens), [120000, 80000]);
});

test('build records the token estimate but keeps it out of the header', () => {
  const verified = { findings: [{ id: 'f1', verdict: 'confirmed', severity: 'Low', sources: ['correctness-1'], issue: 'Rename it.', fix: '' }] };
  const [e] = build(verified, [{ id: 'correctness-1', issue: 'Rename it.', fix: '' }], 'Opus 5.5', { correctness: 50000, verify: 1500 });
  assert.equal(e.tokens, 51500);
  assert.ok(e.body.startsWith('🟠 **change needed** · 🤖 AI:Opus 5.5 · 🔎 correctness\n\n'));
});

test('build names each reviewer behind a merged finding once, in source order', () => {
  const verified = { findings: [{ id: 'f1', verdict: 'confirmed', severity: 'Low', sources: ['correctness-1', 'security-2', 'correctness-3'], issue: 'Rename it.', fix: '' }] };
  const cands = [{ id: 'correctness-1', issue: 'Rename it.', fix: '' }, { id: 'security-2' }, { id: 'correctness-3' }];
  const [e] = build(verified, cands, 'Opus 5.5');
  assert.equal(e.reviewers.join(','), 'correctness,security');
  assert.ok(e.body.startsWith('🟠 **change needed** · 🤖 AI:Opus 5.5 · 🔎 correctness + security\n\n'));
});

test('build takes verify\'s confidence and reason over the reviewer\'s, and keeps them out of the header', () => {
  const verified = { findings: [{ id: 'f1', verdict: 'confirmed', severity: 'Low', sources: ['correctness-1'], issue: 'Rename it.', fix: '',
    confidence: 'high', confidence_reason: 'traced both callers' }] };
  const [e] = build(verified, [{ id: 'correctness-1', issue: 'Rename it.', fix: '', confidence: 'medium' }], 'Opus 5.5', { correctness: 50000, verify: 1500 });
  assert.deepEqual([e.confidence, e.confidenceReason], ['high', 'traced both callers']);
  assert.ok(e.body.startsWith('🟠 **change needed** · 🤖 AI:Opus 5.5 · 🔎 correctness\n\n'));
});

test('a medium finding posts what was not confirmed between the issue and the fix', () => {
  const verified = { findings: [{ id: 'f1', verdict: 'confirmed', severity: 'Medium', sources: ['c-1'], issue: 'Import throws on ownerless badges.',
    fix: 'Skip them.', confidence: 'medium', confidence_reason: 'Whether the import can run before owner sync.' }] };
  const [e] = build(verified, [{ id: 'c-1', issue: 'Import throws on ownerless badges.', fix: 'Skip them.' }], 'Opus 5.5');
  assert.equal(e.body, '🟠 **change needed** · 🤖 AI:Opus 5.5 · 🔎 c\n\nImport throws on ownerless badges.\n\n'
    + '**Not confirmed:** Whether the import can run before owner sync.\n\n**Fix:** Skip them.');
});

test('a high finding posts no not-confirmed line, even with a reason', () => {
  const verified = { findings: [{ id: 'f1', verdict: 'confirmed', severity: 'Medium', sources: ['c-1'], issue: 'i', fix: 'f',
    confidence: 'high', confidence_reason: 'traced the caller at a.cs:3' }] };
  assert.doesNotMatch(build(verified, [{ id: 'c-1', issue: 'i', fix: 'f' }], 'Opus 5.5')[0].body, /Not confirmed/);
});

test('build refuses a low finding, which recheck should have settled, and a medium one with no reason', () => {
  const at = (confidence, confidence_reason) => ({ findings: [{ id: 'f1', verdict: 'confirmed', severity: 'Low', sources: ['c-1'], issue: 'i', fix: '', confidence, confidence_reason }] });
  const cands = [{ id: 'c-1', issue: 'i', fix: '' }];
  assert.throws(() => build(at('low'), cands, 'Opus 5.5'), /low confidence: run recheck/);
  assert.throws(() => build(at('medium'), cands, 'Opus 5.5'), /confidence_reason/);
  assert.throws(() => build(at(undefined), [{ ...cands[0], confidence: 'low' }], 'Opus 5.5'), /low confidence/);
});

test('build falls back to the first source reviewer\'s confidence and its reason, and leaves it out when there is none', () => {
  const cands = [{ id: 'correctness-1', issue: 'Rename it.', fix: '' }, { id: 'security-1', confidence: 'medium', confidence_reason: 'the public name' }];
  const merged = { findings: [{ id: 'f1', verdict: 'confirmed', severity: 'Low/nit', sources: ['correctness-1', 'security-1'], issue: 'Rename it.', fix: '' }] };
  const [m] = build(merged, cands, 'Opus 5.5');
  assert.equal(m.confidence, 'medium');
  assert.match(m.body, /\*\*Not confirmed:\*\* the public name/);
  const bogus = { findings: [{ id: 'f1', verdict: 'confirmed', severity: 'Low/nit', sources: ['correctness-1'], issue: 'Rename it.', fix: '', confidence: 'certain' }] };
  const [e] = build(bogus, cands, 'Opus 5.5');
  assert.equal(e.confidence, null);
  assert.ok(e.body.startsWith('🟠 **change needed** · 🤖 AI:Opus 5.5 · 🔎 correctness\n\n'));
});

test('CLI build --out writes one body file per finding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fc-'));
  writeFileSync(join(dir, 'verified.json'), JSON.stringify({ findings: [{ id: 'f1', verdict: 'confirmed', severity: 'Info', sources: ['c-1'], issue: 'Scope creep.', fix: '' }] }));
  writeFileSync(join(dir, 'cand-x.json'), JSON.stringify([{ id: 'c-1', issue: 'Scope creep.', fix: '' }]));
  const out = JSON.parse(execFileSync('node', [script, 'build', join(dir, 'verified.json'), join(dir, 'cand-x.json'), '--out', dir], { encoding: 'utf8' }));
  assert.equal(out[0].id, 'f1');
  writeFileSync(join(dir, 'usage.json'), JSON.stringify({ c: 3000, verify: 1000 }));
  execFileSync('node', [script, 'build', join(dir, 'verified.json'), join(dir, 'cand-x.json'), '--out', dir, '--usage', join(dir, 'usage.json')]);
  assert.match(readFileSync(join(dir, 'body-f1.txt'), 'utf8'), /^🔵 \*\*note\*\* · 🤖 AI:.+ · 🔎 c\n\nScope creep\.$/);
});

test('a fix verify corrected is posted, though it drops the wrong fix\'s identifiers', () => {
  const verified = { findings: [{ id: 'f1', verdict: 'confirmed', severity: 'Low', sources: ['c-1'],
    issue: 'Upgraded servers log no timestamps.', fix: 'Keep `AddConsole()` and set the default with `Configure<SimpleConsoleFormatterOptions>`.', fix_rewritten: true }] };
  const cands = [{ id: 'c-1', issue: 'Upgraded servers log no timestamps.', fix: 'Call `AddSimpleConsole(o => o.UseUtcTimestamp = true)`.' }];
  const [e] = build(verified, cands, 'Opus 5.5');
  assert.equal(e.use, 'final');
  assert.match(e.body, /Configure<SimpleConsoleFormatterOptions>/);
  assert.doesNotMatch(e.body, /AddSimpleConsole/);
});

test('a corrected fix still keeps the issue\'s facts', () => {
  const verified = { findings: [{ id: 'f1', verdict: 'confirmed', severity: 'Low', sources: ['c-1'],
    issue: 'Upgraded servers log nothing.', fix: 'Use `AddConsole()`.', fix_rewritten: true }] };
  const cands = [{ id: 'c-1', issue: 'Servers upgraded past 11.0 log no `Timestamp`.', fix: 'Call `AddSimpleConsole()`.' }];
  const [e] = build(verified, cands, 'Opus 5.5');
  assert.match(e.body, /11\.0/);
  assert.match(e.body, /`Timestamp`/);
  assert.match(e.body, /AddConsole\(\)/);
  assert.doesNotMatch(e.body, /AddSimpleConsole/);
});

test('buildPairs refuses candidates that share an id instead of drafting from the wrong one', () => {
  const verified = { findings: [{ id: 'f1', sources: ['c-1'], verdict: 'confirmed', severity: 'Low', issue: 'x', fix: 'y' }] };
  const dup = [{ id: 'c-1', issue: 'first', fix: 'a' }, { id: 'c-1', issue: 'second', fix: 'b' }];
  assert.throws(() => buildPairs(verified, dup), /duplicate candidate id c-1/);
});
