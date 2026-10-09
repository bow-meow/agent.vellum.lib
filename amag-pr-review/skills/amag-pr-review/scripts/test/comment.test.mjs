import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { header, formatComment, parseHeader, isOurs, stripHeader, styleIssues, followup, readModel, formatTokens, progress, isProgress, localTimestamp } from '../comment.mjs';

const script = fileURLToPath(new URL('../comment.mjs', import.meta.url));

test('header is status emoji and status, then the model, then the token estimate', () => {
  assert.equal(header('suggestion', 'Opus 5.5', 51234), '🟡 **suggestion** · 🤖 AI:Opus 5.5 · 🪙 ~51k tokens');
  assert.equal(header('critical', 'Opus 5.5', 900), '🔴 **critical** · 🤖 AI:Opus 5.5 · 🪙 ~900 tokens');
  assert.equal(header('blocking', 'Opus 5.5'), '🟠 **blocking** · 🤖 AI:Opus 5.5');
  assert.equal(header('nit', 'Opus 5.5'), '⚪ **nit** · 🤖 AI:Opus 5.5');
  assert.equal(header('info', 'Opus 5.5'), '🔵 **info** · 🤖 AI:Opus 5.5');
});

test('header names the reviewers that raised the finding, between the model and the tokens', () => {
  assert.equal(header('suggestion', 'Opus 5.5', 51234, ['correctness']), '🟡 **suggestion** · 🤖 AI:Opus 5.5 · 🔎 correctness · 🪙 ~51k tokens');
  assert.equal(header('blocking', 'Opus 5.5', null, ['correctness', 'concurrency-races']), '🟠 **blocking** · 🤖 AI:Opus 5.5 · 🔎 correctness + concurrency-races');
  assert.equal(header('nit', 'Opus 5.5', null, []), '⚪ **nit** · 🤖 AI:Opus 5.5');
});

test('header puts the confidence between the reviewers and the tokens', () => {
  assert.equal(header('suggestion', 'Opus 5.5', 51234, ['correctness'], 'high'), '🟡 **suggestion** · 🤖 AI:Opus 5.5 · 🔎 correctness · 🎯 high confidence · 🪙 ~51k tokens');
  assert.equal(header('blocking', 'Opus 5.5', null, [], 'low'), '🟠 **blocking** · 🤖 AI:Opus 5.5 · 🎯 low confidence');
  assert.equal(formatComment({ status: 'nit', model: 'Opus 5.5', reviewers: ['c'], confidence: 'medium', issue: 'x' }), '⚪ **nit** · 🤖 AI:Opus 5.5 · 🔎 c · 🎯 medium confidence\n\nx');
});

test('formatTokens rounds to a short estimate', () => {
  assert.equal(formatTokens(999), '~999');
  assert.equal(formatTokens(51499), '~51k');
  assert.equal(formatTokens(1250000), '~1.3M');
});

test('formatComment puts the issue and the fix on their own paragraphs under the header', () => {
  const body = formatComment({ status: 'blocking', model: 'Opus 5.5', tokens: 42000, issue: 'Two saves race on BADGE_ID.', fix: 'Add a unique index.' });
  assert.equal(body, '🟠 **blocking** · 🤖 AI:Opus 5.5 · 🪙 ~42k tokens\n\nTwo saves race on BADGE_ID.\n\n**Fix:** Add a unique index.');
});

test('formatComment leaves out the fix line when there is no fix', () => {
  assert.equal(formatComment({ status: 'info', model: 'Opus 5.5', issue: 'Scope creep.' }), '🔵 **info** · 🤖 AI:Opus 5.5\n\nScope creep.');
});

test('formatComment rejects an unknown status', () => {
  assert.throws(() => formatComment({ status: 'advisory', model: 'Opus 5.5', issue: 'x' }), /status/);
});

test('parseHeader reads the current header, the plain bold one and the legacy bracket tag', () => {
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

test('followup builds the fixed and still-applies replies', () => {
  assert.equal(followup('fixed', { model: 'Opus 5.5', sha: '6276fe0b144e647b' }), '🔵 **info** · 🤖 AI:Opus 5.5\n\nFixed in `6276fe0b`.');
  assert.equal(followup('still-applies', { model: 'Opus 5.5', status: 'blocking', line: 130 }), '🟠 **blocking** · 🤖 AI:Opus 5.5\n\nStill applies at L130.');
});

test('readModel takes the MODEL line from severity.md', () => {
  assert.match(readModel(), /^\S.*\S$/);
});

test('CLI followup prints a body ready to redirect into bb.mjs', () => {
  const out = execFileSync('node', [script, 'followup', 'still-applies', 'suggestion', '42'], { encoding: 'utf8' });
  assert.match(out, /^🟡 \*\*suggestion\*\* · 🤖 AI:.+\n\nStill applies at L42\.$/);
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
  assert.equal(isProgress(formatComment({ status: 'info', model: 'Opus 5.5', issue: 'x' })), false);
});
