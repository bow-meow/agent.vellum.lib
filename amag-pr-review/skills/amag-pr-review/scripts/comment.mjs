#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = { change: 'change needed', note: 'note' };
export const STATUSES = Object.keys(LABEL);
export const CONFIDENCES = ['high', 'medium', 'low'];
export const SEVERITIES = ['High', 'Medium', 'Low', 'Low/nit', 'Info'];

// Every severity but Info asks the author for a change; how bad it is stays internal.
export function statusOf(severity) {
  if (!SEVERITIES.includes(severity)) throw new Error(`unknown severity "${severity}"`);
  return severity === 'Info' ? 'note' : 'change';
}

// Keyed by checklist dimension and by reviewer name, since a finding may carry either.
const AREAS = {
  correctness: ['🐛', 'Correctness'], 'tests-history': ['🧪', 'Tests'], 'tests-design': ['🧪', 'Tests'],
  'design-quality': ['🏗️', 'Design'], security: ['🔒', 'Security'], 'concurrency-races': ['🧵', 'Concurrency'],
  'resources-performance': ['⚡', 'Performance'], sql: ['🗄️', 'SQL'], docs: ['📄', 'Docs'],
  styles: ['🎨', 'Styles'], 'ticket-fit': ['🎫', 'Ticket fit'],
};
const NO_AREA = ['🔎', 'Review'];
export const areaOf = (...names) => names.map(n => AREAS[String(n ?? '').trim()]).find(Boolean) ?? NO_AREA;

// Comments posted before the two public statuses carry one of these and are still ours.
const OLD_STATUSES = ['critical', 'blocking', 'suggestion', 'nit', 'info'];
const S = [...Object.values(LABEL), ...OLD_STATUSES].join('|');
const fromLabel = token => Object.keys(LABEL).find(k => LABEL[k] === token) ?? token;
// The posted header names no model: the footer does, and a header alone (a human's look-alike) isn't ours.
const HEAD_RE = new RegExp(`^\\s*\\S+ \\*\\*(?:([^*·\\n]+?) · )?(${Object.values(LABEL).join('|')})\\*\\*[ \\t]*(?:\\n|$)`);
const FOOTER_RE = /\n[ \t]*_AI review · ([^_\n]+)_\s*$/;
// Headers posted before the footer existed; emoji, reviewer, confidence and token parts optional.
const OLD_HEADER_RE = new RegExp(`^\\s*(?:\\S+ )?\\*\\*(${S})\\*\\* · (?:🤖 )?AI:(.+?)(?: · 🔎 [^·\\n]+?)?(?: · 🎯 [^·\\n]+?)?(?: · 🪙 [^\\n]*)?\\s*(?:\\n|$)`);
// Comments posted before the header format; still ours, so incremental re-review keeps tracking them.
const LEGACY_RE = new RegExp(`^\\s*\\[(${OLD_STATUSES.join('|')}), AI:([^\\]]+)\\]`);

// A follow-up in one of our threads has no header: the opening words say what happened.
const REPLY_STATUS = { 'Still applies': 'change', 'Still a problem:': 'change' };
const REPLY_RE = new RegExp(`^\\s*\\*\\*(${Object.keys(REPLY_STATUS).join('|')})\\*\\*`);

export function header(status, area = NO_AREA) {
  const [icon, name] = area;
  return `${icon} **${name} · ${LABEL[status]}**`;
}

export const footer = model => `_AI review · ${model}_`;

export function parseHeader(text) {
  const s = String(text ?? '');
  const f = s.match(FOOTER_RE);
  const h = f && s.match(HEAD_RE);
  if (h) return { status: fromLabel(h[2]), model: f[1].trim(), area: h[1] ?? null };
  const r = f && s.match(REPLY_RE);
  if (r) return { status: REPLY_STATUS[r[1]], model: f[1].trim(), area: null };
  const m = s.match(OLD_HEADER_RE) ?? s.match(LEGACY_RE);
  return m ? { status: fromLabel(m[1]), model: m[2].trim(), area: null } : null;
}

export const isOurs = text => parseHeader(text) !== null;

// A follow-up keeps its opening words: they're the message, not a header.
export function stripHeader(text) {
  const s = String(text ?? '');
  if (FOOTER_RE.test(s) && HEAD_RE.test(s)) return s.replace(HEAD_RE, '').replace(FOOTER_RE, '').trim();
  if (FOOTER_RE.test(s) && REPLY_RE.test(s)) return s.replace(FOOTER_RE, '').trim();
  return s.replace(OLD_HEADER_RE, '').replace(LEGACY_RE, '').trim();
}

// Two trailing spaces are Markdown's hard break: a bare newline would run the labelled lines together.
const HARD_BREAK = '  \n';

export function formatComment({ status, model, area = NO_AREA, issue, impact = '', unconfirmed = '', fix = '' }) {
  if (!STATUSES.includes(status)) throw new Error(`unknown status "${status}"`);
  const head = header(status, area);
  const foot = footer(model);
  const text = v => String(v ?? '').trim();
  const labelled = [['Impact', impact], ['Not confirmed', unconfirmed], ['Fix', fix]].filter(([, v]) => text(v));
  // A note or a follow-up reply is a single statement, so it goes in without labels.
  if (!labelled.length) return `${head}\n\n${text(issue)}\n\n${foot}`;
  // A code block has to start its own line, so a multi-line part drops below its label.
  const parts = [['Issue', issue], ...labelled].map(([label, v]) => {
    const t = text(v);
    return t.includes('\n') ? { block: true, s: `**${label}:**\n\n${t}` } : { block: false, s: `**${label}:** ${t}` };
  });
  const body = parts.reduce((acc, p, i) => (i === 0 ? p.s : acc + (p.block || parts[i - 1].block ? '\n\n' : HARD_BREAK) + p.s), '');
  return `${head}\n\n${body}\n\n${foot}`;
}

const PHRASES = [
  'let me know if', 'hope this helps', 'happy to', 'great catch', 'nice work', 'great job',
  'could potentially', 'might possibly', 'may potentially', "it's not just", 'it is worth noting',
  "it's worth noting", 'it looks like', 'in order to', 'additionally,', 'furthermore,',
  'moreover,', 'crucial', 'delve', 'leverage', 'robust', 'seamless',
];

// Word budgets per labelled line (severity.md). A code span counts as one word; a part that drops below
// its label is a snippet and isn't counted.
export const WORD_BUDGET = { Issue: 30, Impact: 20, 'Not confirmed': 15, Fix: 25 };
const words = s => s.replace(/`[^`]*`/g, 'CODE').split(/\s+/).filter(Boolean).length;

export function lengthIssues(text) {
  const found = [];
  for (const line of stripHeader(text).split(/\n/)) {
    const m = line.match(/^\*\*(Issue|Impact|Not confirmed|Fix):\*\* (.+?)\s*$/);
    if (!m) continue;
    const n = words(m[2]);
    if (n > WORD_BUDGET[m[1]]) found.push(`${m[1]} is ${n} words (budget ${WORD_BUDGET[m[1]]})`);
  }
  return found;
}

// Mechanical tells only; the verify agent does the judgement pass with the humanizer skill.
export function styleIssues(text) {
  const prose = stripHeader(text).replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
  const found = [];
  if (/—/.test(prose)) found.push('em dash');
  if (/\s–\s/.test(prose)) found.push('en dash used as a dash');
  if (/\([^)]*\s[^)]*\)/.test(prose)) found.push('parenthetical aside');
  const lower = prose.toLowerCase();
  for (const p of PHRASES) if (lower.includes(p)) found.push(`"${p}"`);
  return [...found, ...lengthIssues(text)];
}

export function readModel(severityFile = fileURLToPath(new URL('../references/severity.md', import.meta.url))) {
  const m = readFileSync(severityFile, 'utf8').match(/^MODEL = (.+)$/m);
  if (!m) throw new Error(`no "MODEL = ..." line in ${severityFile}`);
  return m[1].trim();
}

export function followup(kind, { model, line, text }) {
  // Agreeing (a fix that holds, a push-back we accept) is a silent resolve, so only disagreement is worded.
  const say = sentence => `${sentence}\n\n${footer(model)}`;
  if (kind === 'still-applies') return say(`**Still applies** at L${line}.`);
  if (kind === 'needs-reply') return say(`**Still applies** at L${line}. If you're leaving it as it is, reply here with why and resolve it again.`);
  if (kind === 'disputed') {
    const t = String(text ?? '').trim();
    if (!t) throw new Error('disputed needs the reply text on stdin');
    return say(`**Still a problem:** ${t}`);
  }
  throw new Error(`unknown followup "${kind}"`);
}

// Not a finding: posted when a review starts and deleted at cleanup, so it never needs a status.
// The second form is the notice from before the footer, which a crashed run may have left behind.
const PROGRESS_RE = /^\s*⏳ \*\*Review in progress\*\*[ \t]*\n[\s\S]*\n[ \t]*_AI review · [^_\n]+_\s*$|^\s*⏳ \*\*review in progress\*\* · 🤖 AI:/;

export function localTimestamp(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const zone = `UTC${off < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} ${zone}`;
}

export function progress({ model, at = new Date() }) {
  return `⏳ **Review in progress**\n\nStarted ${localTimestamp(at)}. Findings will follow as inline comments.\n\n${footer(model)}`;
}

export const isProgress = text => PROGRESS_RE.test(String(text ?? ''));

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  const [cmd, kind, a] = process.argv.slice(2);
  const usage = 'usage: comment.mjs followup still-applies|needs-reply <line>'
    + ' | comment.mjs followup disputed   (reply text on stdin) | comment.mjs progress';
  const model = readModel();
  if (cmd === 'progress') { process.stdout.write(progress({ model })); process.exit(0); }
  if (cmd !== 'followup' || !kind) { console.error(usage); process.exit(2); }
  try {
    const text = kind === 'disputed' ? readFileSync(0, 'utf8') : undefined;
    process.stdout.write(followup(kind, { model, line: a, text }));
  } catch (e) { console.error(`${e.message}\n${usage}`); process.exit(2); }
}
