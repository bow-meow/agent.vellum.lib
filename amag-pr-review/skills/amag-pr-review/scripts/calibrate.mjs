#!/usr/bin/env node
// Joins the run logs with what happened to each posted comment on Bitbucket, to see whether confidence
// means what it says and which reviewers earn their tokens.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findAccountId, findCreds, makeClient } from './bb.mjs';
import { isOurs, stripHeader } from './comment.mjs';
import { logDir } from './runlog.mjs';
import { threadRoots } from './state.mjs';

export const MIN_SETTLED = 20;
const FINAL_PR_STATES = new Set(['MERGED', 'DECLINED', 'SUPERSEDED']);
const OPEN_CACHE_MS = 60 * 60 * 1000;
export const OUTCOMES = ['fixed', 'author says fixed', 'resolved by author', 'pushed back', 'closed by us', 'closed by reviewer', 'ignored', 'deleted', 'pending'];

// Authors answer by hand ("👍 Fixed in 9c7fd8b: …", "Done") or through amag-pr-respond ("✅ **fixed**").
const SAYS_FIXED = /^\W*(?:\*\*)?(?:fixed|done|addressed|updated|changed it|good catch,? fixed)\b/i;
export const saysFixed = raw => SAYS_FIXED.test(String(raw ?? '').trim());

export function loadEntries(dir, { since = null } = {}) {
  const entries = [];
  let bad = 0;
  if (!existsSync(dir)) return { entries, bad };
  for (const f of readdirSync(dir).filter(f => f.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (!since || e.at >= since) entries.push(e);
      } catch { bad++; }
    }
  }
  entries.sort((a, b) => (a.at < b.at ? -1 : 1));
  return { entries, bad };
}

// Ordered: our "Fixed in" reply beats everything, then the author's last word, then who resolved it.
export function classify(commentId, { pr, values }, meId = null) {
  const byId = new Map(values.map(c => [c.id, c]));
  const ours = byId.get(commentId);
  if (!ours || ours.deleted) return 'deleted';
  const roots = threadRoots(values);
  const thread = values.filter(c => !c.deleted && roots.get(c.id) === roots.get(commentId));
  const after = thread.filter(c => c.id > commentId);
  if (after.some(c => isOurs(c.content?.raw) && /^(?:\*\*)?Fixed(?:\*\*)? in\b/.test(stripHeader(c.content?.raw)))) return 'fixed';
  const authorId = pr.author?.account_id ?? null;
  const fromAuthor = authorId == null ? [] : after.filter(c => c.user?.account_id === authorId);
  if (fromAuthor.length && saysFixed(fromAuthor.at(-1).content?.raw)) return 'author says fixed';
  const authorReplied = fromAuthor.length > 0;
  const root = byId.get(roots.get(commentId)) ?? ours;
  if (root.resolution) {
    // We resolve our own thread when we concede, so who resolved it matters only without an author reply.
    if (authorReplied) return 'pushed back';
    const by = root.resolution.user?.account_id ?? null;
    if (by === null || by === authorId) return 'resolved by author';
    return meId != null && by === meId ? 'closed by us' : 'closed by reviewer';
  }
  if (!FINAL_PR_STATES.has(pr.state)) return 'pending';
  return authorReplied ? 'pushed back' : 'ignored';
}

const tally = () => Object.fromEntries(OUTCOMES.map(o => [o, 0]));

function group(rows, keyOf) {
  const out = new Map();
  for (const r of rows) for (const k of [keyOf(r)].flat()) {
    if (!out.has(k)) out.set(k, tally());
    out.get(k)[r.outcome]++;
  }
  return out;
}

const settledOf = t => OUTCOMES.filter(o => o !== 'pending').reduce((n, o) => n + t[o], 0);
// "Resolved by author" with no reply is most often a fix the next review never saw, so it counts as taken up.
const takenUp = t => t.fixed + t['author says fixed'] + t['resolved by author'];
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');
const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2)) : null;
};

export function analyse(entries, outcomesByComment) {
  const posted = [];
  for (const e of entries) for (const f of e.findings ?? []) {
    if (e.mode !== 'pr' || f.posted !== true || f.commentId == null) continue;
    const outcome = outcomesByComment.get(f.commentId);
    if (outcome) posted.push({ ...f, outcome });
  }
  const shown = entries.filter(e => e.mode === 'pr').flatMap(e => (e.findings ?? []).filter(f => f.posted !== null));
  const all = entries.flatMap(e => e.findings ?? []);
  const agents = new Map();
  for (const e of entries) for (const [k, n] of Object.entries(e.usage ?? {})) {
    const a = agents.get(k) ?? { tokens: 0, runs: 0, posted: 0 };
    a.tokens += Number(n) || 0;
    a.runs++;
    agents.set(k, a);
  }
  for (const f of shown) if (f.posted) for (const r of f.reviewers ?? []) if (agents.has(r)) agents.get(r).posted++;
  const perRun = entries.filter(e => e.totalTokens != null);
  return {
    runs: { total: entries.length, pr: entries.filter(e => e.mode === 'pr').length, local: entries.filter(e => e.mode === 'local').length },
    posted: posted.length,
    settled: posted.filter(f => f.outcome !== 'pending').length,
    byConfidence: group(posted, f => f.confidence ?? 'none'),
    byReviewer: group(posted, f => f.reviewers?.length ? f.reviewers : ['unknown']),
    bySeverity: group(posted, f => f.severity ?? 'unknown'),
    picks: pickTable(shown),
    verdicts: verdictTable(all),
    pushbacks: pushbackTable(entries),
    cost: {
      medianPerRun: median(perRun.map(e => e.totalTokens)),
      medianPer100Lines: median(perRun.filter(e => e.run?.changed > 0).map(e => Math.round((100 * e.totalTokens) / e.run.changed))),
      agents,
    },
  };
}

function pickTable(shown) {
  const out = new Map();
  for (const f of shown) for (const r of f.reviewers?.length ? f.reviewers : ['unknown']) {
    const t = out.get(r) ?? { shown: 0, posted: 0, declined: 0, edited: 0 };
    t.shown++;
    if (f.posted) t.posted++; else t.declined++;
    if (f.edited) t.edited++;
    out.set(r, t);
  }
  return out;
}

// A re-check knows the comment, not who raised it, so the reviewer comes from the run that posted it.
function pushbackTable(entries) {
  const raisedBy = new Map();
  for (const e of entries) for (const f of e.findings ?? []) if (f.commentId != null && !raisedBy.has(f.commentId)) raisedBy.set(f.commentId, f);
  const out = new Map();
  for (const e of entries) for (const p of e.previous ?? []) {
    if (p.status !== 'conceded' && p.status !== 'disputed') continue;
    const f = raisedBy.get(p.commentId);
    for (const r of f?.reviewers?.length ? f.reviewers : ['unknown']) {
      const t = out.get(r) ?? { conceded: 0, disputed: 0, keptByYou: 0, withdrawnByYou: 0 };
      t[p.status]++;
      if (p.status === 'conceded' && (p.flipped || p.posted === false)) t.keptByYou++;
      if (p.status === 'disputed' && p.flipped) t.withdrawnByYou++;
      out.set(r, t);
    }
  }
  return out;
}

function verdictTable(all) {
  const out = new Map();
  for (const f of all) for (const r of f.reviewers?.length ? f.reviewers : ['unknown']) {
    const t = out.get(r) ?? { confirmed: 0, dropped: 0, unconfirmed: 0 };
    if (f.verdict === 'confirmed') t.confirmed++;
    else if (f.unconfirmed) t.unconfirmed++;
    else t.dropped++;
    out.set(r, t);
  }
  return out;
}

const row = cells => `| ${cells.join(' | ')} |`;
const sortedEntries = m => [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

function outcomeTable(title, m) {
  if (!m.size) return [`## ${title}`, '', 'No posted findings with a known outcome yet.', ''];
  const cols = OUTCOMES;
  return [`## ${title}`, '',
    row(['', 'posted', ...cols, 'taken up']), row(['---', ...Array(cols.length + 2).fill('---:')]),
    ...sortedEntries(m).map(([k, t]) => row([k, settledOf(t) + t.pending, ...cols.map(c => t[c]), pct(takenUp(t), settledOf(t))])), ''];
}

export function report(a, { bad = 0, unreachable = [] } = {}) {
  const lines = [
    `# Review calibration`, '',
    `${a.runs.total} runs (${a.runs.pr} PR, ${a.runs.local} local). ${a.posted} posted findings with a comment id, ${a.settled} settled.`,
  ];
  if (a.settled < MIN_SETTLED) lines.push(`Fewer than ${MIN_SETTLED} settled findings: treat the percentages as anecdotes, not rates.`);
  if (bad) lines.push(`${bad} unreadable log line(s) skipped.`);
  if (unreachable.length) lines.push(`Couldn't fetch: ${unreachable.join(', ')}.`);
  lines.push('', '"Fixed" = our re-review confirmed it. "Taken up" = fixed + author says fixed + resolved by the author without a reply,'
    + ' over settled (everything but pending).', '');
  lines.push(...outcomeTable('Outcome by confidence', a.byConfidence));
  lines.push(...outcomeTable('Outcome by reviewer', a.byReviewer));
  lines.push(...outcomeTable('Outcome by severity', a.bySeverity));
  lines.push('## Your picks', '');
  if (a.picks.size) {
    lines.push(row(['reviewer', 'shown', 'posted', 'declined', 'edited', 'declined %']), row(['---', '---:', '---:', '---:', '---:', '---:']),
      ...sortedEntries(a.picks).map(([k, t]) => row([k, t.shown, t.posted, t.declined, t.edited, pct(t.declined, t.shown)])), '');
  } else lines.push('No PR runs with picks yet.', '');
  lines.push('## Push-backs on re-review', '');
  if (a.pushbacks.size) {
    lines.push(row(['reviewer', 'conceded', 'disputed', 'conceded, you kept it', 'disputed, you withdrew it']), row(['---', '---:', '---:', '---:', '---:']),
      ...sortedEntries(a.pushbacks).map(([k, t]) => row([k, t.conceded, t.disputed, t.keptByYou, t.withdrawnByYou])), '');
  } else lines.push('No push-backs judged yet.', '');
  lines.push('## Verify and recheck verdicts', '',
    row(['reviewer', 'confirmed', 'dropped', 'unconfirmed', 'kept %']), row(['---', '---:', '---:', '---:', '---:']),
    ...sortedEntries(a.verdicts).map(([k, t]) => row([k, t.confirmed, t.dropped, t.unconfirmed, pct(t.confirmed, t.confirmed + t.dropped + t.unconfirmed)])), '');
  lines.push('## Cost', '',
    `Median tokens per run: ${a.cost.medianPerRun ?? 'n/a'}. Median tokens per 100 changed lines: ${a.cost.medianPer100Lines ?? 'n/a'}.`, '',
    row(['agent', 'runs', 'tokens', 'tokens/run', 'posted findings', 'tokens/posted']), row(['---', '---:', '---:', '---:', '---:', '---:']),
    ...[...a.cost.agents.entries()].sort((x, y) => y[1].tokens - x[1].tokens).map(([k, t]) =>
      row([k, t.runs, t.tokens, Math.round(t.tokens / t.runs), t.posted, t.posted ? Math.round(t.tokens / t.posted) : 'n/a'])), '');
  return lines.join('\n');
}

const cacheFile = (dir, { ws, repo, id }) => join(dir, '.cache', `${ws}-${repo}-PR${id}.json`);

// A merged or declined PR never changes again; an open one is re-fetched once it's an hour stale.
export function cacheUsable(cached, { refresh = false, now = Date.now() } = {}) {
  if (!cached || refresh) return false;
  if (FINAL_PR_STATES.has(cached.pr?.state)) return true;
  return now - Date.parse(cached.fetchedAt) < OPEN_CACHE_MS;
}

export async function fetchThreads(client, prs, dir, { refresh = false, offline = false } = {}) {
  const out = new Map(), unreachable = [];
  for (const pr of prs) {
    const file = cacheFile(dir, pr);
    const cached = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    if (cacheUsable(cached, { refresh }) || (offline && cached)) { out.set(file, cached); continue; }
    if (offline || !client) { unreachable.push(`${pr.ws}/${pr.repo}#${pr.id}`); continue; }
    try {
      const base = `repositories/${pr.ws}/${pr.repo}/pullrequests/${pr.id}`;
      const info = await client.get(base);
      const comments = await client.get(`${base}/comments?pagelen=100&fields=%2Bvalues.resolution.user.account_id`);
      const data = { fetchedAt: new Date().toISOString(), pr: { state: info.state, author: { account_id: info.author?.account_id ?? null } }, values: comments.values ?? [] };
      mkdirSync(join(dir, '.cache'), { recursive: true });
      writeFileSync(file, JSON.stringify(data));
      out.set(file, data);
    } catch (e) {
      unreachable.push(`${pr.ws}/${pr.repo}#${pr.id} (${e.message.split('\n')[0]})`);
      if (cached) out.set(file, cached);
    }
  }
  return { threads: out, unreachable };
}

// Cached so an offline run can still tell our own resolves from other reviewers'.
export async function myAccountId(client, dir, { offline = false } = {}) {
  const file = join(dir, '.cache', 'me.json');
  const cached = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).account_id ?? null : null;
  if (offline || !client) return cached;
  try {
    const id = (await client.me()).account_id ?? null;
    if (id) { mkdirSync(join(dir, '.cache'), { recursive: true }); writeFileSync(file, JSON.stringify({ account_id: id })); }
    return id ?? cached;
  } catch { return cached; }
}

export function prsOf(entries) {
  const seen = new Map();
  for (const e of entries) if (e.mode === 'pr' && e.pr && (e.findings ?? []).some(f => f.commentId != null))
    seen.set(`${e.pr.ws}/${e.pr.repo}/${e.pr.id}`, e.pr);
  return [...seen.values()];
}

// A later run's re-check verdict beats what the thread shows: agreeing is a silent resolve now, so a
// confirmed fix or an accepted push-back leaves no reply of ours to find.
const FROM_RECHECK = { fixed: 'fixed', conceded: 'pushed back' };

export function outcomes(entries, threads, dir, meId = null) {
  const out = new Map();
  for (const e of entries) {
    if (e.mode !== 'pr' || !e.pr) continue;
    const t = threads.get(cacheFile(dir, e.pr));
    if (!t) continue;
    for (const f of e.findings ?? []) if (f.commentId != null) out.set(f.commentId, classify(f.commentId, t, meId));
  }
  for (const e of entries) for (const p of e.previous ?? [])
    if (FROM_RECHECK[p.status] && out.has(p.commentId) && out.get(p.commentId) !== 'deleted') out.set(p.commentId, FROM_RECHECK[p.status]);
  return out;
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  const args = process.argv.slice(2);
  const flag = name => args.includes(name);
  const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  if (flag('--help')) {
    console.log('usage: calibrate.mjs [--since YYYY-MM-DD] [--refresh] [--offline] [--json]\n'
      + '  reads the run logs under <PR_REVIEW_ROOT>/.log and the Bitbucket threads of their posted comments (cached)');
    process.exit(0);
  }
  const dir = logDir();
  const { entries, bad } = loadEntries(dir, { since: value('--since') });
  const creds = flag('--offline') ? null : findCreds();
  const client = creds ? makeClient({ creds, accountId: findAccountId() }) : null;
  const { threads, unreachable } = await fetchThreads(client, prsOf(entries), dir, { refresh: flag('--refresh'), offline: flag('--offline') || !creds });
  const meId = await myAccountId(client, dir, { offline: flag('--offline') || !creds });
  const a = analyse(entries, outcomes(entries, threads, dir, meId));
  if (flag('--json')) {
    const plain = JSON.parse(JSON.stringify(a, (k, v) => (v instanceof Map ? Object.fromEntries(v) : v)));
    console.log(JSON.stringify({ ...plain, bad, unreachable }, null, 2));
  } else console.log(report(a, { bad, unreachable }));
}
