import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { areaOf, header, footer, formatComment, parseHeader, isOurs, stripHeader, styleIssues, followup, readModel, progress, isProgress, localTimestamp, statusOf } from '../comment.mjs';

const script = fileURLToPath(new URL('../comment.mjs', import.meta.url));
const FOOT = '\n\n_AI review · Opus 5.5_';

test('statusOf makes every severity but Info a change, and Info a note', () => {
  for (const s of ['High', 'Medium', 'Low', 'Low/nit']) assert.equal(statusOf(s), 'change');
  assert.equal(statusOf('Info'), 'note');
  assert.throws(() => statusOf('blocking'), /severity/);
});

test('areaOf takes the first known name, a dimension or a reviewer, and falls back to a plain review', () => {
  assert.deepEqual(areaOf('design-quality', 'tests-design'), ['🏗️', 'Design']);
  assert.deepEqual(areaOf(null, 'tests-design'), ['🧪', 'Tests']);
  assert.deepEqual(areaOf('combined', 'msbuild-invalidation'), ['🔎', 'Review']);
  assert.deepEqual(areaOf(), ['🔎', 'Review']);
});

test('header is the area icon, the area and the status; a follow-up has the status alone', () => {
  assert.equal(header('change', ['🧪', 'Tests']), '🧪 **Tests · change needed**');
  assert.equal(header('note', ['📄', 'Docs']), '📄 **Docs · note**');
  assert.equal(header('note'), '🔵 **note**');
  assert.equal(footer('Opus 5.5'), '_AI review · Opus 5.5_');
});

test('formatComment puts Issue, Impact, Not confirmed and Fix on labelled lines, the AI footer last', () => {
  const body = formatComment({ status: 'change', model: 'Opus 5.5', area: ['🐛', 'Correctness'], issue: 'Two saves race on BADGE_ID.',
    impact: 'Two badges end up with the same id.', unconfirmed: 'Whether imports run in parallel.', fix: 'Add a unique index.' });
  assert.equal(body, '🐛 **Correctness · change needed**\n\n**Issue:** Two saves race on BADGE_ID.  \n'
    + '**Impact:** Two badges end up with the same id.  \n**Not confirmed:** Whether imports run in parallel.  \n**Fix:** Add a unique index.' + FOOT);
});

test('formatComment leaves confidence, tokens and reviewer names out of the comment', () => {
  const body = formatComment({ status: 'change', model: 'Opus 5.5', area: ['🐛', 'Correctness'], confidence: 'high', tokens: 42000, issue: 'x', impact: 'y' });
  assert.doesNotMatch(body, /confidence|tokens|🎯|🪙|🤖/);
});

test('formatComment drops the parts it has no text for', () => {
  assert.equal(formatComment({ status: 'change', model: 'm', issue: 'i', impact: 'b', fix: '  ' }), '🟠 **change needed**\n\n**Issue:** i  \n**Impact:** b\n\n_AI review · m_');
});

test('formatComment puts a multi-line part, such as a code snippet, below its label', () => {
  const fix = 'Guard it:\n```cs\nif (x == null) return;\n```';
  assert.equal(formatComment({ status: 'change', model: 'm', issue: 'i', impact: 'b', fix }),
    `🟠 **change needed**\n\n**Issue:** i  \n**Impact:** b\n\n**Fix:**\n\n${fix}\n\n_AI review · m_`);
});

test('formatComment leaves a note or follow-up unlabelled', () => {
  assert.equal(formatComment({ status: 'note', model: 'Opus 5.5', area: ['📄', 'Docs'], issue: 'Scope creep.' }), '📄 **Docs · note**\n\nScope creep.' + FOOT);
});

test('formatComment rejects an unknown status, the retired ones included', () => {
  assert.throws(() => formatComment({ status: 'advisory', model: 'Opus 5.5', issue: 'x' }), /status/);
  assert.throws(() => formatComment({ status: 'nit', model: 'Opus 5.5', issue: 'x' }), /status/);
});

test('parseHeader reads the current header with its footer, and stripHeader removes both', () => {
  const body = formatComment({ status: 'change', model: 'Opus 5.5', area: ['🧪', 'Tests'], issue: 'i', impact: 'b' });
  assert.deepEqual(parseHeader(body), { status: 'change', model: 'Opus 5.5', area: 'Tests' });
  assert.equal(stripHeader(body), '**Issue:** i  \n**Impact:** b');
  const fixed = followup('fixed', { model: 'Opus 5.5', sha: 'abcdef1234' });
  assert.deepEqual(parseHeader(fixed), { status: 'note', model: 'Opus 5.5', area: null });
  assert.equal(stripHeader(fixed), 'Fixed in `abcdef12`.');
});

test('a look-alike header without our footer is not ours', () => {
  assert.equal(isOurs('🧪 **Tests · change needed**\n\nI think this needs a test.'), false);
  assert.equal(isOurs('🟠 **change needed**\n\nplease fix'), false);
});

test('parseHeader still reads every older header: the robot one, retired statuses, and the bracket tag', () => {
  const robot = '🟠 **change needed** · 🤖 AI:Opus 5.5 · 🔎 correctness · 🎯 high confidence · 🪙 ~51k tokens\n\nbody';
  assert.deepEqual(parseHeader(robot), { status: 'change', model: 'Opus 5.5', area: null });
  assert.equal(stripHeader(robot), 'body');
  assert.deepEqual(parseHeader('🔵 **note** · 🤖 AI:Opus 5.5\n\nbody'), { status: 'note', model: 'Opus 5.5', area: null });
  assert.deepEqual(parseHeader('🟡 **suggestion** · 🤖 AI:Opus 5.5 · 🪙 ~51k tokens\n\nbody'), { status: 'suggestion', model: 'Opus 5.5', area: null });
  assert.deepEqual(parseHeader('🟠 **blocking** · 🤖 AI:Opus 5.5 · 🔎 ticket-fit\n\nbody'), { status: 'blocking', model: 'Opus 5.5', area: null });
  assert.deepEqual(parseHeader('**nit** · AI:Opus 5.5\n\nbody'), { status: 'nit', model: 'Opus 5.5', area: null });
  assert.deepEqual(parseHeader('[critical, AI:Opus 5.5] body'), { status: 'critical', model: 'Opus 5.5', area: null });
  assert.equal(parseHeader('`🟡 ADVISORY` `🟣 AI`\n\nbody'), null);
  assert.equal(isOurs('plain human comment'), false);
});

test('styleIssues flags em dashes and chatbot phrases but ignores code spans', () => {
  assert.deepEqual(styleIssues('Use `a — b` here.'), []);
  const got = styleIssues('This could potentially break — hope this helps!');
  assert.ok(got.includes('em dash'));
  assert.ok(got.includes('"hope this helps"'));
  assert.ok(got.includes('"could potentially"'));
});

test('followup builds the fixed, still-applies and needs-reply replies', () => {
  assert.equal(followup('fixed', { model: 'Opus 5.5', sha: '6276fe0b144e647b' }), '🔵 **note**\n\nFixed in `6276fe0b`.' + FOOT);
  assert.equal(followup('still-applies', { model: 'Opus 5.5', severity: 'Medium', line: 130 }), '🟠 **change needed**\n\nStill applies at L130.' + FOOT);
  assert.equal(followup('needs-reply', { model: 'Opus 5.5', severity: 'Low/nit', line: 7 }),
    "🟠 **change needed**\n\nStill applies at L7. If you're leaving it as it is, reply here with why and resolve it again." + FOOT);
});

test('readModel takes the MODEL line from severity.md', () => {
  assert.match(readModel(), /^\S.*\S$/);
});

test('CLI followup prints a body ready to redirect into bb.mjs', () => {
  const out = execFileSync('node', [script, 'followup', 'still-applies', 'Low', '42'], { encoding: 'utf8' });
  assert.match(out, /^🟠 \*\*change needed\*\*\n\nStill applies at L42\.\n\n_AI review · .+_$/);
});

test('a conceded reply is a note and a disputed one keeps the finding\'s status, both from text on stdin', () => {
  assert.equal(followup('conceded', { model: 'Opus 5.5', severity: 'High', text: 'Fair point: `Save` is only called under the lock.' }),
    '🔵 **note**\n\nFair point: `Save` is only called under the lock.' + FOOT);
  assert.equal(followup('disputed', { model: 'Opus 5.5', severity: 'Medium', text: 'The import job calls it without the lock.' }),
    '🟠 **change needed**\n\nThe import job calls it without the lock.' + FOOT);
  assert.throws(() => followup('conceded', { model: 'm', severity: 'Low', text: '  ' }), /reply text/);
  const out = execFileSync('node', [script, 'followup', 'disputed', 'Low'], { input: 'It still `throws` at L9.', encoding: 'utf8' });
  assert.match(out, /^🟠 \*\*change needed\*\*\n\nIt still `throws` at L9\.\n\n_AI review · .+_$/);
});

test('progress notice says when the review started, with the same footer', () => {
  const at = new Date(2026, 9, 2, 9, 5);
  const body = progress({ model: 'Opus 5.5', at });
  assert.equal(body, `⏳ **Review in progress**\n\nStarted ${localTimestamp(at)}. Findings will follow as inline comments.` + FOOT);
  assert.match(localTimestamp(at), /^2026-10-02 09:05 UTC[+-]\d\d:\d\d$/);
});

test('progress notice is recognised as the notice, the old one too, and never as a finding', () => {
  const body = progress({ model: 'Opus 5.5' });
  assert.equal(isProgress(body), true);
  assert.equal(isProgress('⏳ **review in progress** · 🤖 AI:Opus 5.5\n\nStarted 2026-10-02 09:05 UTC+01:00.'), true);
  assert.equal(isOurs(body), false);
  assert.equal(isProgress(formatComment({ status: 'note', model: 'Opus 5.5', issue: 'x' })), false);
});
