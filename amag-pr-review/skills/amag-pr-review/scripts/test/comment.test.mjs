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
  assert.deepEqual(areaOf('regression'), ['🔁', 'Regression']);
  assert.deepEqual(areaOf('claims'), ['📝', 'Claims']);
  assert.deepEqual(areaOf('combined', 'msbuild-invalidation'), ['🔎', 'Review']);
  assert.deepEqual(areaOf(), ['🔎', 'Review']);
});

test('header is the area icon, the area and the status, with a plain review as the fallback', () => {
  assert.equal(header('change', ['🧪', 'Tests']), '🧪 **Tests · change needed**');
  assert.equal(header('note', ['📄', 'Docs']), '📄 **Docs · note**');
  assert.equal(header('note'), '🔎 **Review · note**');
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
  assert.equal(formatComment({ status: 'change', model: 'm', issue: 'i', impact: 'b', fix: '  ' }), '🔎 **Review · change needed**\n\n**Issue:** i  \n**Impact:** b\n\n_AI review · m_');
});

test('formatComment puts a multi-line part, such as a code snippet, below its label', () => {
  const fix = 'Guard it:\n```cs\nif (x == null) return;\n```';
  assert.equal(formatComment({ status: 'change', model: 'm', issue: 'i', impact: 'b', fix }),
    `🔎 **Review · change needed**\n\n**Issue:** i  \n**Impact:** b\n\n**Fix:**\n\n${fix}\n\n_AI review · m_`);
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
});

test('a follow-up is ours by its opening words and footer, and keeps those words when stripped', () => {
  const still = followup('still-applies', { model: 'Opus 5.5', line: 9 });
  assert.deepEqual(parseHeader(still), { status: 'change', model: 'Opus 5.5', area: null });
  assert.equal(stripHeader(still), '**Still applies** at L9.');
  assert.equal(parseHeader(followup('disputed', { model: 'm', text: 'x' })).status, 'change');
  assert.equal(isOurs('**Still applies** here too, I think'), false, 'a human reply without our footer');
  // Follow-ups posted under the dot header before this layout.
  assert.equal(isOurs('🔵 **note**\n\nFixed in `abc12345`.\n\n_AI review · Opus 5.5_'), true);
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

test('styleIssues flags a labelled line over its word budget, counting a code span as one word', () => {
  const long = Array(31).fill('word').join(' ');
  const body = formatComment({ status: 'change', model: 'm', issue: long, impact: 'short', fix: '`a very long code span with many words in it` only' });
  assert.deepEqual(styleIssues(body), ['Issue is 31 words (budget 30)']);
  const snippet = formatComment({ status: 'change', model: 'm', issue: 'i', impact: 'b', fix: `${long}\n\`\`\`cs\nx();\n\`\`\`` });
  assert.deepEqual(styleIssues(snippet), [], 'a part below its label is a snippet and is not counted');
});

test('styleIssues flags a parenthetical aside in prose but not parentheses inside code', () => {
  assert.deepEqual(styleIssues('It breaks (or a `..` spelling does) here.'), ['parenthetical aside']);
  assert.deepEqual(styleIssues('Call `Find(path, cfg)` here.'), []);
});

test('styleIssues flags em dashes and chatbot phrases but ignores code spans', () => {
  assert.deepEqual(styleIssues('Use `a — b` here.'), []);
  const got = styleIssues('This could potentially break — hope this helps!');
  assert.ok(got.includes('em dash'));
  assert.ok(got.includes('"hope this helps"'));
  assert.ok(got.includes('"could potentially"'));
});

test('followup builds the still-applies and needs-reply replies as one sentence and the footer, and no agreement replies', () => {
  for (const kind of ['fixed', 'conceded']) assert.throws(() => followup(kind, { model: 'm' }), /unknown followup/);
  assert.equal(followup('still-applies', { model: 'Opus 5.5', line: 130 }), '**Still applies** at L130.' + FOOT);
  assert.equal(followup('needs-reply', { model: 'Opus 5.5', line: 7 }),
    "**Still applies** at L7. If you're leaving it as it is, reply here with why and resolve it again." + FOOT);
});

test('readModel takes the MODEL line from severity.md', () => {
  assert.match(readModel(), /^\S.*\S$/);
});

test('CLI followup prints a body ready to redirect into bb.mjs', () => {
  const out = execFileSync('node', [script, 'followup', 'still-applies', '42'], { encoding: 'utf8' });
  assert.match(out, /^\*\*Still applies\*\* at L42\.\n\n_AI review · .+_$/);
});

test('a disputed reply opens with "Still a problem", text from stdin', () => {
  assert.equal(followup('disputed', { model: 'Opus 5.5', text: 'The import job calls it without the lock.' }),
    '**Still a problem:** The import job calls it without the lock.' + FOOT);
  assert.throws(() => followup('disputed', { model: 'm', text: '  ' }), /reply text/);
  const out = execFileSync('node', [script, 'followup', 'disputed'], { input: 'It still `throws` at L9.', encoding: 'utf8' });
  assert.match(out, /^\*\*Still a problem:\*\* It still `throws` at L9\.\n\n_AI review · .+_$/);
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
