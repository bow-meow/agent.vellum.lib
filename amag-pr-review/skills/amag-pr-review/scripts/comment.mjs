#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EMOJI = { change: '🟠', note: '🔵' };
const LABEL = { change: 'change needed', note: 'note' };
export const STATUSES = Object.keys(EMOJI);
export const CONFIDENCES = ['high', 'medium', 'low'];
export const SEVERITIES = ['High', 'Medium', 'Low', 'Low/nit', 'Info'];

// Every severity but Info asks the author for a change; how bad it is stays internal.
export function statusOf(severity) {
  if (!SEVERITIES.includes(severity)) throw new Error(`unknown severity "${severity}"`);
  return severity === 'Info' ? 'note' : 'change';
}

// Comments posted before the two public statuses carry one of these and are still ours.
const OLD_STATUSES = ['critical', 'blocking', 'suggestion', 'nit', 'info'];
const S = [...Object.values(LABEL), ...OLD_STATUSES].join('|');
const fromLabel = token => Object.keys(LABEL).find(k => LABEL[k] === token) ?? token;
// Emoji, reviewer, confidence and token parts optional: the plain bold header was posted before they existed.
const HEADER_RE = new RegExp(`^\\s*(?:\\S+ )?\\*\\*(${S})\\*\\* · (?:🤖 )?AI:(.+?)(?: · 🔎 [^·\\n]+?)?(?: · 🎯 [^·\\n]+?)?(?: · 🪙 [^\\n]*)?\\s*(?:\\n|$)`);
// Comments posted before the header format; still ours, so incremental re-review keeps tracking them.
const LEGACY_RE = new RegExp(`^\\s*\\[(${OLD_STATUSES.join('|')}), AI:([^\\]]+)\\]`);

export function header(status, model, reviewers = []) {
  const parts = [`${EMOJI[status]} **${LABEL[status]}**`, `🤖 AI:${model}`];
  if (reviewers.length) parts.push(`🔎 ${reviewers.join(' + ')}`);
  return parts.join(' · ');
}

export function parseHeader(text) {
  const m = String(text ?? '').match(HEADER_RE) ?? String(text ?? '').match(LEGACY_RE);
  return m ? { status: fromLabel(m[1]), model: m[2].trim() } : null;
}

export const isOurs = text => parseHeader(text) !== null;

export const stripHeader = text => String(text ?? '').replace(HEADER_RE, '').replace(LEGACY_RE, '').trim();

export function formatComment({ status, model, reviewers = [], issue, unconfirmed = '', fix }) {
  if (!STATUSES.includes(status)) throw new Error(`unknown status "${status}"`);
  const parts = [header(status, model, reviewers), String(issue ?? '').trim()];
  if (unconfirmed && unconfirmed.trim()) parts.push(`**Not confirmed:** ${unconfirmed.trim()}`);
  if (fix && fix.trim()) parts.push(`**Fix:** ${fix.trim()}`);
  return parts.join('\n\n');
}

const PHRASES = [
  'let me know if', 'hope this helps', 'happy to', 'great catch', 'nice work', 'great job',
  'could potentially', 'might possibly', 'may potentially', "it's not just", 'it is worth noting',
  "it's worth noting", 'it looks like', 'in order to', 'additionally,', 'furthermore,',
  'moreover,', 'crucial', 'delve', 'leverage', 'robust', 'seamless',
];

// Mechanical tells only; the verify agent does the judgement pass with the humanizer skill.
export function styleIssues(text) {
  const prose = stripHeader(text).replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
  const found = [];
  if (/—/.test(prose)) found.push('em dash');
  if (/\s–\s/.test(prose)) found.push('en dash used as a dash');
  const lower = prose.toLowerCase();
  for (const p of PHRASES) if (lower.includes(p)) found.push(`"${p}"`);
  return found;
}

export function readModel(severityFile = fileURLToPath(new URL('../references/severity.md', import.meta.url))) {
  const m = readFileSync(severityFile, 'utf8').match(/^MODEL = (.+)$/m);
  if (!m) throw new Error(`no "MODEL = ..." line in ${severityFile}`);
  return m[1].trim();
}

export function followup(kind, { model, sha, severity, line }) {
  if (kind === 'fixed') return formatComment({ status: 'note', model, issue: `Fixed in \`${String(sha).slice(0, 8)}\`.` });
  if (kind === 'still-applies') return formatComment({ status: statusOf(severity), model, issue: `Still applies at L${line}.` });
  if (kind === 'needs-reply')
    return formatComment({ status: statusOf(severity), model,
      issue: `Still applies at L${line}. If you're leaving it as it is, reply here with why and resolve it again.` });
  throw new Error(`unknown followup "${kind}"`);
}

// Not a finding: posted when a review starts and deleted at cleanup, so it never needs a status.
const PROGRESS_RE = /^\s*⏳ \*\*review in progress\*\* · 🤖 AI:/;

export function localTimestamp(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const zone = `UTC${off < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} ${zone}`;
}

export function progress({ model, at = new Date() }) {
  return `⏳ **review in progress** · 🤖 AI:${model}\n\nStarted ${localTimestamp(at)}. Findings will follow as inline comments.`;
}

export const isProgress = text => PROGRESS_RE.test(String(text ?? ''));

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  const [cmd, kind, a, b] = process.argv.slice(2);
  const usage = 'usage: comment.mjs followup fixed <sha> | comment.mjs followup still-applies|needs-reply <severity> <line> | comment.mjs progress';
  const model = readModel();
  if (cmd === 'progress') { process.stdout.write(progress({ model })); process.exit(0); }
  if (cmd !== 'followup' || !kind) { console.error(usage); process.exit(2); }
  try {
    process.stdout.write(kind === 'fixed' ? followup('fixed', { model, sha: a }) : followup(kind, { model, severity: a, line: b }));
  } catch (e) { console.error(`${e.message}\n${usage}`); process.exit(2); }
}
