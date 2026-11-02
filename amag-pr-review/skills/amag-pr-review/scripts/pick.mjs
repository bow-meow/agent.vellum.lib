#!/usr/bin/env node
// SKILL.md step 7: the numbered pick list and the terminal table.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inScope, parseDiff, placeAnchor } from './anchors.mjs';
import { SEVERITIES } from './comment.mjs';
import { findingsFile, repoState } from './local-findings.mjs';
import { nativePath } from './env.mjs';
import { decision, everythingPosted, oneLine, readJson, reviewProblems, saveJson } from './post.mjs';

const rank = sev => { const i = SEVERITIES.indexOf(sev); return i < 0 ? SEVERITIES.length : i; };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// Worst first, then by place: the same order local-findings.mjs numbers by, so both modes read alike.
const tableOrder = (a, b) => rank(a.severity) - rank(b.severity) || cmp(a.path ?? '', b.path ?? '') || (a.line ?? 0) - (b.line ?? 0);
const LOWISH = new Set(['Low', 'Low/nit']);

export function toPlace(verified) {
  return (verified.findings ?? [])
    .filter(f => f.verdict === 'confirmed' && f.match === 'new' && !f.terminal_only)
    .map(f => ({ id: f.id, path: f.path, line: f.line, side: f.side ?? 'new' }));
}

// The same result as `anchors.mjs place <bb.diff> <to-place.json> [--scope <context.diff>]`.
export function place(list, prDiffText, scopeText = null) {
  const files = parseDiff(prDiffText);
  const scope = scopeText == null ? null : parseDiff(scopeText);
  return list.map(f => {
    const anchor = placeAnchor(files, f);
    return scope && anchor ? { ...f, anchor, outOfScope: !inScope(scope, anchor) } : { ...f, anchor };
  });
}

const latestReply = replies => (replies ?? []).reduce((a, r) => (a == null || Number(r.id) > Number(a.id) ? r : a), null);

const item = fields => ({
  n: null, group: null, kind: null, origKind: null, findingId: null, commentId: null, parentId: null, path: null, line: null,
  side: 'new', severity: null, status: null, verdict: null, claim: null, body: null, replyKind: null, pattern: null, ruleId: null,
  authorResolved: false, ownOpen: false, point: null, flipped: false, edited: false, ...fields,
});

// `w` is only used to spell body paths.
export function buildPicks({ w, verified, built = [], placed = [], recheck = [], ours = [] }) {
  const builtById = new Map(built.map(b => [b.id, b]));
  const placedById = new Map(placed.map(p => [p.id, p]));
  const findings = [], outside = [], notPosted = [];
  const confirmed = (verified.findings ?? []).filter(f => f.verdict === 'confirmed').sort(tableOrder);
  for (const f of confirmed) {
    const b = builtById.get(f.id);
    const base = { findingId: f.id, path: f.path ?? null, line: f.line ?? null, side: f.side ?? 'new', severity: f.severity ?? null,
      status: b?.status ?? (f.severity === 'Info' ? 'note' : 'change'), claim: f.claim ?? null };
    const skip = why => notPosted.push({ ...base, why, raisedBy: f.raised_by ?? null });
    if (f.match === 'already-raised') { skip('already-raised'); continue; }
    if (f.match === 'ours-previous') { skip('ours-previous'); continue; }
    if (f.terminal_only) { skip('terminal-only'); continue; }
    if (!b) { skip('terminal-only: no comment body was built'); continue; }
    const body = join(w, `body-${f.id}.txt`);
    if (f.match === 'reply') {
      if (f.parent_id == null) { skip('terminal-only: a reply with no thread to reply to'); continue; }
      findings.push(item({ ...base, group: 'finding', kind: 'reply', parentId: f.parent_id, body }));
      continue;
    }
    if (f.match !== 'new') { skip(`terminal-only: match "${f.match}"`); continue; }
    const p = placedById.get(f.id);
    if (!p?.anchor) { skip('terminal-only: no anchor in the PR diff'); continue; }
    const it = item({ ...base, ...p.anchor, kind: 'new', body });
    if (p.outOfScope) outside.push({ ...it, group: 'outside' });
    else findings.push({ ...it, group: 'finding' });
  }

  const recheckById = new Map(recheck.map(e => [String(e.commentId ?? e.comment_id ?? e.id), e]));
  const resolvedById = new Map(ours.map(c => [String(c.id), !!c.resolved]));
  const followups = [], answers = [], agreements = [], settled = [], stillOpen = [], pushbacks = [];
  const previous = (verified.previous ?? []).map(p => {
    const e = recheckById.get(String(p.comment_id)) ?? {};
    const reply = latestReply(e.authorReplies);
    return {
      p, replies: e.authorReplies ?? [],
      info: { commentId: p.comment_id, parentId: e.parentId ?? e.parent_id ?? null, path: e.path ?? null, line: p.line ?? e.line ?? null,
        side: e.side ?? 'new', severity: p.severity ?? e.severity ?? null, verdict: p.status, claim: p.note ?? null,
        authorResolved: !!e.authorResolved, point: reply ? oneLine(reply.raw) : null },
      codeChanged: p.codeChanged ?? e.codeChanged ?? true,
    };
  }).sort((a, b) => tableOrder(a.info, b.info));
  for (const { p, info, replies, codeChanged } of previous) {
    const ownOpen = info.parentId == null && !info.authorResolved && !resolvedById.get(String(info.commentId));
    if (p.status === 'still-applies') {
      // A reply tells a Low author a reason is enough; one who already replied gets the plain follow-up.
      if (info.authorResolved) followups.push(item({ ...info, group: 'followup', kind: 'reopen', ownOpen,
        replyKind: LOWISH.has(info.severity) && !replies.length ? 'needs-reply' : 'still-applies' }));
      else if (codeChanged) followups.push(item({ ...info, group: 'followup', kind: 'still-applies', replyKind: 'still-applies', ownOpen }));
      else stillOpen.push({ ...info, note: p.note ?? null });
    } else if (p.status === 'disputed') {
      answers.push(item({ ...info, group: 'answer', kind: 'answer', replyKind: 'disputed', ownOpen, body: join(w, `body-pushback-${info.commentId}.txt`) }));
      pushbacks.push({ file: `pushback-${info.commentId}.txt`, text: String(p.reply ?? '').trim() });
    } else if (p.status === 'fixed' || p.status === 'conceded') {
      if (ownOpen) agreements.push(item({ ...info, group: 'resolve', kind: 'resolve', ownOpen, pattern: p.pattern ?? null }));
      else settled.push({ ...info, n: null, ownOpen, note: p.note ?? null, pattern: p.pattern ?? null, ruleId: null });
    } else {
      stillOpen.push({ ...info, note: p.note ?? null });
    }
  }

  let n = 0;
  const items = [...findings, ...followups, ...answers, ...agreements, ...outside].map(it => ({ ...it, n: ++n }));
  // Conceded ones get a number only so "flip N" can name them; nothing is posted for them.
  for (const s of settled) if (s.verdict === 'conceded') s.n = ++n;
  const rules = [];
  const conceded = [...items.filter(it => it.verdict === 'conceded'), ...settled.filter(s => s.verdict === 'conceded')].sort((a, b) => a.n - b.n);
  for (const c of conceded) {
    if (!c.pattern) continue;
    c.ruleId = `R${rules.length + 1}`;
    rules.push({ id: c.ruleId, line: c.pattern, from: c.n });
  }
  return { picks: { items, settled, stillOpen, notPosted, rules }, pushbacks };
}

const cell = s => String(s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim() || '—';
const POST_AS = { new: 'new', reply: 'reply', 'still-applies': 'still applies', reopen: 'reopen', answer: 'answer', resolve: 'resolve', none: '—' };
const STATUS = { change: 'change needed', note: 'note' };
const where = x => (x.path ? `${x.path}${x.line != null ? `:${x.line}` : ''}` : '—');
const list = xs => (xs.length ? xs.join(', ') : 'none');

export function renderPickTable(picks, built = []) {
  const builtById = new Map(built.map(b => [b.id, b]));
  const head = ['| # | Status | Reviewer | Confidence | Where | Finding | Post as |', '|---|--------|----------|------------|-------|---------|---------|'];
  const row = it => {
    const b = it.findingId ? builtById.get(it.findingId) : null;
    const status = it.findingId ? STATUS[it.status] ?? it.status : String(it.verdict ?? '').replace(/-/g, ' ');
    const reviewer = b ? b.reviewers?.join(', ') : it.findingId ? null : 'previous';
    return `| ${it.n} | ${cell(status)} | ${cell(reviewer)} | ${cell(b?.confidence)} | ${cell(where(it))} | ${cell(it.claim)} | ${POST_AS[it.kind] ?? it.kind} |`;
  };
  const main = picks.items.filter(it => it.group !== 'outside').map(row);
  const out = picks.items.filter(it => it.group === 'outside').map(row);
  return [...head, ...main, ...(out.length ? ['|  | **Outside this round\'s changes** (posts only when named by number) |  |  |  |  |  |', ...out] : [])];
}

export function renderUnderTable(picks, readText = () => '') {
  const lines = [];
  for (const it of picks.items.filter(i => i.kind === 'answer')) {
    lines.push(`${it.n}. Author: ${it.point ?? '(no reply text)'}`);
    const draft = oneLine(readText(`pushback-${it.commentId}.txt`), 400);
    lines.push(`   Our reply: ${draft || '(none yet: write $W/pushback-' + it.commentId + '.txt)'}`);
  }
  for (const r of picks.rules) lines.push(`${r.id}. ${r.line} (from ${r.from})`);
  if (picks.stillOpen.length)
    lines.push(`Still open from the last review: ${picks.stillOpen.map(s => `c${s.commentId} ${where(s)}${s.note ? ` (${oneLine(s.note, 100)})` : ''}`).join('; ')}`);
  const fixed = picks.settled.filter(s => s.verdict === 'fixed');
  const conceded = picks.settled.filter(s => s.verdict === 'conceded');
  if (fixed.length || conceded.length) {
    lines.push(`Settled, nothing to post: ${fixed.length} fixed${conceded.length ? '; conceded:' : ''}`);
    for (const c of conceded) lines.push(`  ${c.n}. c${c.commentId} ${where(c)}: ${c.point ?? c.note ?? ''}`);
  }
  return lines;
}

// Dropped / Overturned / Unconfirmed lines of the terminal table, from what verify and recheck left in $W.
export function verdictLines({ verified, contested = [], decisions = [] }) {
  const dec = new Map(decisions.map(d => [d.id, d]));
  const cont = new Map(contested.map(c => [c.id, c]));
  const upheld = id => cont.has(id) && dec.get(id)?.decision === 'uphold';
  const dropped = (verified.findings ?? []).filter(f => f.verdict === 'dropped' && !f.unconfirmed)
    .map(f => `${f.id}: ${oneLine(f.reason, 120)}${upheld(f.id) ? ' (upheld by recheck)' : ''}`);
  for (const c of contested) if (c.kind === 'omitted' && upheld(c.id)) dropped.push(`${c.id}: never taken up by verify (upheld by recheck)`);
  const overturned = decisions.filter(d => d.decision === 'overturn').map(d => `${d.id}: ${oneLine(d.reason, 120)}`);
  const unconfirmed = (verified.findings ?? []).filter(f => f.verdict === 'dropped' && f.unconfirmed).map(f => `${f.id}: ${oneLine(f.reason, 120)}`);
  return [
    `Dropped by verify (${dropped.length}): ${list(dropped)}`,
    `Overturned by recheck (${overturned.length}): ${list(overturned)}`,
    `Unconfirmed, not posted (${unconfirmed.length}): ${list(unconfirmed)}`,
  ];
}

// An open state finding that didn't make it into previous-recheck.json was closed.
export function closedByHuman(statePrev, recheck) {
  if (!statePrev) return [];
  const kept = new Set(recheck.map(e => String(e.commentId ?? e.comment_id)));
  return (statePrev.findings ?? []).filter(f => (f.status === 'open' || f.status === 'pending') && !kept.has(String(f.commentId)));
}

export function prLines({ picks, verified, contested, decisions, statePrev, recheck }) {
  const raised = picks.notPosted.filter(x => x.why === 'already-raised').map(x => `${oneLine(x.claim, 100)} → ${x.raisedBy ?? 'someone'}`);
  const terminal = picks.notPosted.filter(x => x.why.startsWith('terminal-only'))
    .map(x => `${x.findingId} ${where(x)}: ${oneLine(x.claim, 100)}${x.why === 'terminal-only' ? '' : ` (${x.why.slice('terminal-only: '.length)})`}`);
  const closed = closedByHuman(statePrev, recheck).map(f => `c${f.commentId} ${where(f)}`);
  const accepted = [...picks.items, ...picks.settled].filter(x => x.verdict === 'conceded' && !x.flipped)
    .map(x => `c${x.commentId}: ${oneLine(x.point ?? x.claim, 100)}`);
  const reopened = picks.items.filter(it => it.kind === 'reopen').map(it => `c${it.commentId} ${where(it)}`);
  return [
    ...verdictLines({ verified, contested, decisions }),
    `Already raised by others: ${list(raised)}`,
    `Terminal-only: ${list(terminal)}`,
    `Closed by a human: ${list(closed)}   Accepted push-backs: ${list(accepted)}`,
    `Reopened: ${list(reopened)}`,
  ];
}

export const QUESTION = 'Which should I post? ("post 1,3", "post all", "post all but 2", "edit 2: <what to change>", "flip 4", "rule R1", "none"; add "as <voice>", "as random" or "as random each" for a voice)';

export function renderLocal({ file, verified, built, contested, decisions, ticketDir }) {
  const byId = new Map((verified.findings ?? []).map(f => [f.id, f]));
  const lines = ['| # | Status | Reviewer | Confidence | Where | Finding |', '|---|--------|----------|------------|-------|---------|'];
  for (const f of file?.findings ?? []) {
    const repoPath = [f.repo, f.path].filter(Boolean).join('/');
    lines.push(`| ${f.n} | ${cell(STATUS[f.status] ?? f.status)} | ${cell(f.reviewers?.join(', '))} | ${cell(f.confidence)} | ${cell(repoPath ? `${repoPath}:${f.line}` : null)} | ${cell(byId.get(f.id)?.claim)} |`);
  }
  const terminal = (file?.findings ?? []).filter(f => f.terminalOnly).map(f => `${f.n} (${f.id})`);
  lines.push('', ...verdictLines({ verified, contested, decisions }), `Terminal-only: ${list(terminal)}`);
  if (file) lines.push('', `Saved to ${ticketDir}/review-findings.json. Which should I fix? (e.g. "fix 1,3", "fix all"; or later, "pr-respond ${file.ticketKey}")`);
  return lines.join('\n');
}

const readArr = p => { const v = readJson(p, []); return Array.isArray(v) ? v : []; };

export function buildPr(w) {
  const repos = readJson(join(w, 'repos.json'), null);
  const verified = readJson(join(w, 'verified.json'), { findings: [], previous: [] });
  const built = readArr(join(w, 'factcheck.json'));
  const recheck = readArr(join(w, 'previous-recheck.json'));
  const reReview = existsSync(join(w, 'previous-recheck.json'));
  const list = toPlace(verified);
  saveJson(join(w, 'to-place.json'), list);
  const prDiff = existsSync(join(w, 'bb.diff')) ? readFileSync(join(w, 'bb.diff'), 'utf8') : '';
  const scope = reReview && existsSync(join(w, 'context.diff')) ? readFileSync(join(w, 'context.diff'), 'utf8') : null;
  const placed = place(list, prDiff, scope);
  saveJson(join(w, 'placed.json'), placed);
  const { picks, pushbacks } = buildPicks({ w, verified, built, placed, recheck, ours: readArr(join(w, 'comments-ours.json')) });
  for (const p of pushbacks) writeFileSync(join(w, p.file), p.text);
  saveJson(join(w, 'picks.json'), picks);
  const readText = f => (existsSync(join(w, f)) ? readFileSync(join(w, f), 'utf8') : '');
  const d = decision({ items: picks.items, stillOpen: picks.stillOpen, outcome: everythingPosted(picks.items),
    problems: reviewProblems(w), pr: repos?.pr ?? null, dryRun: !!repos?.dryRun });
  const under = renderUnderTable(picks, readText);
  const lines = [
    ...renderPickTable(picks, built), '', ...(under.length ? [...under, ''] : []),
    ...prLines({ picks, verified, contested: readArr(join(w, 'contested.json')), decisions: readArr(join(w, 'recheck.json')),
      statePrev: readJson(join(w, 'state-prev.json'), null), recheck }),
    '', d.dryRun ? d.why : `If you post everything: ${d.why}.`,
  ];
  if (repos?.pr?.url) lines.push(repos.pr.url);
  if (!d.dryRun && picks.items.length) lines.push('', QUESTION);
  return lines.join('\n');
}

export function buildLocal(w, { repoStateFn = repoState } = {}) {
  const repos = readJson(join(w, 'repos.json'), null);
  if (!repos) throw new Error(`no repos.json in ${w}`);
  const verified = readJson(join(w, 'verified.json'), { findings: [], previous: [] });
  const builtFile = join(w, 'factcheck.json');
  const ticketDir = repos.ticketDir;
  let file = null;
  // Local mode: nothing is saved when there was nothing to verify.
  if (existsSync(builtFile)) {
    file = findingsFile({ ticketKey: repos.ticketKey, verified, built: readArr(builtFile),
      repos: repos.repos.map(r => repoStateFn(r.name, nativePath(r.wt ?? r.clone), r.dest)) });
    writeFileSync(join(nativePath(ticketDir), 'review-findings.json'), JSON.stringify(file, null, 2) + '\n');
  }
  return renderLocal({ file, verified, built: readArr(builtFile), contested: readArr(join(w, 'contested.json')),
    decisions: readArr(join(w, 'recheck.json')), ticketDir });
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  const args = process.argv.slice(2);
  const local = args.includes('--local');
  const [cmd, wArg] = args.filter(a => a !== '--local');
  if (cmd !== 'build' || !wArg) {
    console.error('usage: pick.mjs build <W> [--local]   writes to-place.json, placed.json, picks.json (PR) or review-findings.json (local); prints the terminal table');
    process.exit(2);
  }
  const w = nativePath(wArg);
  try {
    const mode = readJson(join(w, 'repos.json'), null)?.mode;
    process.stdout.write((local || mode === 'local' ? buildLocal(w) : buildPr(w)) + '\n');
  } catch (e) { console.error(`pick.mjs: ${e.message}`); process.exit(1); }
}
