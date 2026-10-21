import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { header, formatComment, parseHeader, isOurs, stripHeader, styleIssues, followup, readModel, formatTokens, progress, isProgress, localTimestamp, statusOf } from '../comment.mjs';

const script = fileURLToPath(new URL('../comment.mjs', import.meta.url));

test('statusOf makes every severity but Info a change, and Info a note', () => {
  for (const s of ['High', 'Medium', 'Low', 'Low/nit']) assert.equal(statusOf(s), 'change');
  assert.equal(statusOf('Info'), 'note');
  assert.throws(() => statusOf('blocking'), /severity/);
});

test('header is status emoji and label, then the model, then the token estimate', () => {
  assert.equal(header('change', 'Opus 5.5', 51234), '🟠 **change needed** · 🤖 AI:Opus 5.5 · 🪙 ~51k tokens');
  assert.equal(header('change', 'Opus 5.5'), '🟠 **change needed** · 🤖 AI:Opus 5.5');
  assert.equal(header('note', 'Opus 5.5', 900), '🔵 **note** · 🤖 AI:Opus 5.5 · 🪙 ~900 tokens');
});

test('header names the reviewers that raised the finding, between the model and the tokens', () => {
  assert.equal(header('change', 'Opus 5.5', 51234, ['correctness']), '🟠 **change needed** · 🤖 AI:Opus 5.5 · 🔎 correctness · 🪙 ~51k tokens');
  assert.equal(header('change', 'Opus 5.5', null, ['correctness', 'concurrency-races']), '🟠 **change needed** · 🤖 AI:Opus 5.5 · 🔎 correctness + concurrency-races');
  assert.equal(header('note', 'Opus 5.5', null, []), '🔵 **note** · 🤖 AI:Opus 5.5');
});

test('header puts the confidence between the reviewers and the tokens', () => {
  assert.equal(header('change', 'Opus 5.5', 51234, ['correctness'], 'high'), '🟠 **change needed** · 🤖 AI:Opus 5.5 · 🔎 correctness · 🎯 high confidence · 🪙 ~51k tokens');
  assert.equal(header('change', 'Opus 5.5', null, [], 'low'), '🟠 **change needed** · 🤖 AI:Opus 5.5 · 🎯 low confidence');
  assert.equal(formatComment({ status: 'note', model: 'Opus 5.5', reviewers: ['c'], confidence: 'medium', issue: 'x' }), '🔵 **note** · 🤖 AI:Opus 5.5 · 🔎 c · 🎯 medium confidence\n\nx');
});

test('formatTokens rounds to a short estimate', () => {
  assert.equal(formatTokens(999), '~999');
  assert.equal(formatTokens(51499), '~51k');
  assert.equal(formatTokens(1250000), '~1.3M');
});

test('formatComment puts the issue and the fix on their own paragraphs under the header', () => {
  const body = formatComment({ status: 'change', model: 'Opus 5.5', tokens: 42000, issue: 'Two saves race on BADGE_ID.', fix: 'Add a unique index.' });
  assert.equal(body, '🟠 **change needed** · 🤖 AI:Opus 5.5 · 🪙 ~42k tokens\n\nTwo saves race on BADGE_ID.\n\n**Fix:** Add a unique index.');
});

test('formatComment leaves out the fix line when there is no fix', () => {
  assert.equal(formatComment({ status: 'note', model: 'Opus 5.5', issue: 'Scope creep.' }), '🔵 **note** · 🤖 AI:Opus 5.5\n\nScope creep.');
});

test('formatComment rejects an unknown status, the retired ones included', () => {
  assert.throws(() => formatComment({ status: 'advisory', model: 'Opus 5.5', issue: 'x' }), /status/);
  assert.throws(() => formatComment({ status: 'nit', model: 'Opus 5.5', issue: 'x' }), /status/);
});

test('parseHeader reads the two current labels as their status', () => {
  const change = '🟠 **change needed** · 🤖 AI:Opus 5.5 · 🔎 correctness · 🎯 high confidence · 🪙 ~51k tokens\n\nbody';
  assert.deepEqual(parseHeader(change), { status: 'change', model: 'Opus 5.5' });
  assert.equal(stripHeader(change), 'body');
  assert.deepEqual(parseHeader('🔵 **note** · 🤖 AI:Opus 5.5\n\nbody'), { status: 'note', model: 'Opus 5.5' });
});

test('parseHeader still reads headers posted with the retired statuses, and the legacy bracket tag', () => {
  assert.deepEqual(parseHeader('🟡 **suggestion** · 🤖 AI:Opus 5.5 · 🪙 ~51k tokens\n\nbody'), { status: 'suggestion', model: 'Opus 5.5' });
  assert.deepEqual(parseHeader('🔵 **info** · 🤖 AI:Opus 5.5\n\nbody'), { status: 'info', model: 'Opus 5.5' });
  assert.deepEqual(parseHeader('🟡 **suggestion** · 🤖 AI:Opus 5.5 · 🔎 correctness + security · 🪙 ~51k tokens\n\nbody'), { status: 'suggestion', model: 'Opus 5.5' });
  assert.deepEqual(parseHeader('🟠 **blocking** · 🤖 AI:Opus 5.5 · 🔎 ticket-fit\n\nbody'), { status: 'blocking', model: 'Opus 5.5' });
  const withConfidence = '🟡 **suggestion** · 🤖 AI:Opus 5.5 · 🔎 combined · 🎯 high confidence · 🪙 ~76k tokens\n\nbody';
  assert.deepEqual(parseHeader(withConfidence), { status: 'suggestion', model: 'Opus 5.5' });
  assert.equal(stripHeader(withConfidence), 'body');
  assert.deepEqual(parseHeader('🟠 **blocking** · 🤖 AI:Opus 5.5 · 🎯 low confidence\n\nbody'), { status: 'blocking', model: 'Opus 5.5' });
  assert.deepEqual(parseHeader('**nit** · AI:Opus 5.5\n\nbody'), { status: 'nit', model: 'Opus 5.5' });
  assert.deepEqual(parseHeader('[critical, AI:Opus 5.5] body'), { status: 'critical', model: 'Opus 5.5' });
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
  assert.equal(followup('fixed', { model: 'Opus 5.5', sha: '6276fe0b144e647b' }), '🔵 **note** · 🤖 AI:Opus 5.5\n\nFixed in `6276fe0b`.');
  assert.equal(followup('still-applies', { model: 'Opus 5.5', severity: 'Medium', line: 130 }), '🟠 **change needed** · 🤖 AI:Opus 5.5\n\nStill applies at L130.');
  assert.equal(followup('needs-reply', { model: 'Opus 5.5', severity: 'Low/nit', line: 7 }),
    "🟠 **change needed** · 🤖 AI:Opus 5.5\n\nStill applies at L7. If you're leaving it as it is, reply here with why and resolve it again.");
});

test('readModel takes the MODEL line from severity.md', () => {
  assert.match(readModel(), /^\S.*\S$/);
});

test('CLI followup prints a body ready to redirect into bb.mjs', () => {
  const out = execFileSync('node', [script, 'followup', 'still-applies', 'Low', '42'], { encoding: 'utf8' });
  assert.match(out, /^🟠 \*\*change needed\*\* · 🤖 AI:.+\n\nStill applies at L42\.$/);
});

test('progress notice keeps only the status and model in its header and says when the review started', () => {
  const at = new Date(2026, 9, 2, 9, 5);
  const body = progress({ model: 'Opus 5.5', at });
  assert.equal(body, `⏳ **review in progress** · 🤖 AI:Opus 5.5\n\nStarted ${localTimestamp(at)}. Findings will follow as inline comments.`);
  assert.match(localTimestamp(at), /^2026-10-02 09:05 UTC[+-]\d\d:\d\d$/);
});

test('progress notice is recognised as the notice and never as a finding', () => {
  const body = progress({ model: 'Opus 5.5' });
  assert.equal(isProgress(body), true);
  assert.equal(isOurs(body), false);
  assert.equal(isProgress(formatComment({ status: 'note', model: 'Opus 5.5', issue: 'x' })), false);
});
