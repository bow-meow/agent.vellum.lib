#!/usr/bin/env node
// SKILL.md step 9: save state, then clean up.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripHeader } from './comment.mjs';
import { nativePath } from './env.mjs';
import { defaultBb, loadOutcome, loadPicks, oneLine, readJson, reviewProblems } from './post.mjs';
import { fingerprint, saveState, statePath } from './state.mjs';
import { cleanup as xrepoCleanup } from './xrepo.mjs';

const latestReplyId = replies => (replies ?? []).reduce((a, r) => (a == null || Number(r.id) > a ? Number(r.id) : a), null);

// The comment's own text, so a later verify can match a re-raised candidate to this conceded one.
export function claimOf(raw) {
  const first = stripHeader(raw).split(/\n/).map(l => l.trim()).find(Boolean) ?? '';
  return oneLine(first.replace(/^\*\*[^*]+:\*\*\s*/, ''), 200) || null;
}

export function unanswered(picks, outcome) {
  const seen = new Set(outcome.map(o => o.n));
  return picks.items.filter(it => it.kind !== 'none' && !seen.has(it.n)).map(it => it.n);
}

export function buildState({ verified, picks, outcome, prev = null, droppedPrevious = [], recheck = [], ours = [], head, now = new Date(),
  fingerprintAt = () => null }) {
  const byN = new Map(outcome.map(o => [o.n, o]));
  const fp = (path, line, side) => (side === 'old' || !path || line == null ? null : fingerprintAt(path, Number(line)));
  const findings = [];
  const dropped = (verified.findings ?? []).filter(f => f.verdict === 'dropped')
    .map(f => ({ path: f.path ?? null, line: f.line ?? null, claim: f.claim ?? null, reason: f.reason ?? null }));

  for (const it of picks.items.filter(i => i.kind === 'new' || i.kind === 'reply')) {
    const o = byN.get(it.n);
    if (o?.result === 'posted') {
      findings.push({ commentId: o.postedId, parentId: it.kind === 'reply' ? it.parentId : null, path: it.path, line: it.line, side: it.side,
        severity: it.severity, status: 'open', pushbackSeen: null, fingerprint: fp(it.path, it.line, it.side) });
    } else if (o?.result === 'declined') {
      dropped.push({ path: it.path, line: it.line, claim: it.claim, reason: `User chose not to post${o.reason ? `: ${o.reason}` : ''}` });
    }
  }

  const recheckById = new Map(recheck.map(e => [String(e.commentId ?? e.comment_id), e]));
  const prevById = new Map((prev?.findings ?? []).map(f => [String(f.commentId), f]));
  const oursById = new Map(ours.map(c => [String(c.id), c]));
  const itemById = new Map(picks.items.filter(i => i.commentId != null && !i.findingId).map(i => [String(i.commentId), i]));
  const decided = new Set();
  for (const p of verified.previous ?? []) {
    const key = String(p.comment_id);
    decided.add(key);
    const e = recheckById.get(key) ?? {};
    const sf = prevById.get(key) ?? {};
    const base = { commentId: p.comment_id, parentId: e.parentId ?? sf.parentId ?? null, path: e.path ?? sf.path ?? null,
      line: p.line ?? e.line ?? sf.line ?? null, side: e.side ?? sf.side ?? 'new', severity: p.severity ?? e.severity ?? sf.severity ?? null };
    const pushbackSeen = latestReplyId(e.authorReplies) ?? sf.pushbackSeen ?? null;
    const keepOpen = () => findings.push({ ...base, status: 'open', pushbackSeen, fingerprint: fp(base.path, base.line, base.side) });
    const concede = () => dropped.push({ path: base.path, line: base.line, claim: claimOf(oursById.get(key)?.raw) ?? p.note ?? null,
      reason: `Conceded to the author: ${p.note ?? ''}`.trim() });
    const it = itemById.get(key);
    const result = it ? byN.get(it.n)?.result : null;

    if (p.status === 'fixed') {
      findings.push({ ...base, status: 'fixed', pushbackSeen, fingerprint: sf.fingerprint ?? null });
    } else if (p.status === 'still-applies') {
      // A declined reopen is the user accepting the author's resolve, like a thread a human closed.
      if (it?.kind === 'reopen' && result === 'declined') continue;
      keepOpen();
    } else if (p.status === 'conceded' || (p.status === 'disputed' && it?.flipped)) {
      if (it?.kind === 'answer') keepOpen();
      else if (it?.kind === 'resolve' && result !== 'posted') keepOpen();
      else concede();
    } else {
      keepOpen();
    }
  }
  // Re-checked but left without a verdict: still on the PR, so still open.
  for (const e of recheck) {
    const key = String(e.commentId ?? e.comment_id);
    if (decided.has(key)) continue;
    const sf = prevById.get(key);
    if (sf) findings.push({ ...sf, status: 'open' });
  }

  dropped.push(...droppedPrevious);
  const failed = outcome.some(o => o.result === 'failed');
  const reviewedCommit = failed ? prev?.reviewedCommit ?? null : head;
  return { ...(reviewedCommit ? { reviewedCommit } : {}), reviewedAt: now.toISOString(), findings, dropped };
}

export function stateFor(w, { now = new Date(), save = (ws, repo, pr, state) => { const p = statePath(ws, repo, pr); saveState(p, state); return p; } } = {}) {
  const repos = readJson(join(w, 'repos.json'), null);
  if (!repos) return { skipped: true, why: `no repos.json in ${w}` };
  if (repos.mode !== 'pr') return { skipped: true, why: 'local mode saves review-findings.json instead' };
  if (repos.dryRun || repos.pr?.mine) return { skipped: true, why: repos.pr?.mine ? 'my own PR: treated as a dry run' : 'dry run' };
  const problems = reviewProblems(w);
  if (problems.length) return { skipped: true, why: `${problems.join('; ')}: the next run must review this code again` };
  const picks = loadPicks(w);
  const outcome = loadOutcome(w);
  const open = unanswered(picks, outcome);
  if (open.length) return { skipped: true, why: `no answer recorded for ${open.join(', ')}: run post.mjs close first` };
  const repo = repos.repos?.[0] ?? {};
  const wt = repo.wt ? nativePath(repo.wt) : null;
  const fingerprintAt = (path, line) => {
    if (!wt) return null;
    try { return fingerprint(readFileSync(join(wt, path), 'utf8'), line); } catch { return null; }
  };
  const state = buildState({
    verified: readJson(join(w, 'verified.json'), { findings: [], previous: [] }), picks, outcome,
    prev: readJson(join(w, 'state-prev.json'), null), droppedPrevious: readJson(join(w, 'dropped-previous.json'), []) ?? [],
    recheck: readJson(join(w, 'previous-recheck.json'), []) ?? [], ours: readJson(join(w, 'comments-ours.json'), []) ?? [],
    head: repo.head ?? null, now, fingerprintAt,
  });
  writeFileSync(join(w, 'state.json'), JSON.stringify(state, null, 2));
  const { ws, repo: name, id } = repos.pr;
  return { saved: save(ws, name, id, state), findings: state.findings.length, dropped: state.dropped.length, reviewedCommit: state.reviewedCommit ?? null };
}

// runlog ids: a finding by its id, a previous finding by c<comment_id>.
export function runlogArgs(repos, outcome, picks = { items: [] }) {
  const idOf = o => o.findingId ?? `c${o.commentId}`;
  const ids = pred => [...new Set(outcome.filter(pred).map(idOf))];
  const flipped = [...new Set([...outcome.filter(o => o.flipped).map(idOf),
    ...picks.items.filter(it => it.flipped).map(it => it.findingId ?? `c${it.commentId}`)])];
  const flags = [
    ['--posted', ids(o => o.result === 'posted')], ['--declined', ids(o => o.result === 'declined')],
    ['--edited', ids(o => o.edited)], ['--flipped', flipped],
    ['--comments', outcome.filter(o => o.result === 'posted' && o.postedId != null).map(o => `${idOf(o)}=${o.postedId}`)],
  ].filter(([, v]) => v.length).flatMap(([f, v]) => [f, v.join(',')]);
  if (repos.mode === 'local') return [`local-${repos.ticketKey}`, '--mode', 'local', '--ticket', repos.ticketKey];
  const { ws, repo, id } = repos.pr;
  const head = repos.repos?.[0]?.head;
  return [`${ws}-${repo}-PR${id}`, '--pr', `${ws}/${repo}/${id}`, ...(head ? ['--head', head] : []), ...flags];
}

export function progressId(envText) {
  const m = String(envText ?? '').match(/^PROGRESS_ID='?(\d+)'?\s*$/m);
  return m ? Number(m[1]) : null;
}

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const defaultRunlog = (w, args) => execFileSync(process.execPath, [join(SCRIPTS, 'runlog.mjs'), 'append', args[0], w, ...args.slice(1)],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const defaultGit = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// Every step runs even when one before it fails: cleanup also runs after errors (SKILL.md step 9).
export async function cleanupWork(w, { runlog = defaultRunlog, bb = null, git = defaultGit, xrepo = xrepoCleanup, rm = p => rmSync(p, { recursive: true, force: true }) } = {}) {
  if (basename(dirname(resolve(w))) !== '.work') throw new Error(`${w} isn't a review work dir (…/.work/<key>): not removing it`);
  const repos = readJson(join(w, 'repos.json'), null);
  const steps = {}, errors = [];
  const step = async (name, fn) => { try { steps[name] = await fn(); } catch (e) { errors.push(`${name}: ${String(e.message ?? e).split('\n')[0]}`); } };
  if (repos) await step('log', () => runlog(w, runlogArgs(repos, loadOutcome(w), loadPicks(w))));
  if (repos?.mode === 'pr') {
    const pid = progressId(existsSync(join(w, 'env.sh')) ? readFileSync(join(w, 'env.sh'), 'utf8') : '');
    if (pid != null) await step('progress', async () => { await (bb ?? defaultBb()).remove(repos.pr.ws, repos.pr.repo, repos.pr.id, pid); return pid; });
  }
  await step('xrepo', () => xrepo(w));
  const r = repos?.mode === 'pr' ? repos.repos?.[0] : null;
  if (r?.wt && r?.clone) {
    const [clone, wt] = [nativePath(r.clone), nativePath(r.wt)];
    await step('worktree', () => {
      try { git(['-C', clone, 'worktree', 'remove', '--force', wt]); }
      catch { rm(wt); git(['-C', clone, 'worktree', 'prune']); }
      return wt;
    });
  }
  await step('workDir', () => { rm(w); return w; });
  return { ...steps, errors };
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  const [cmd, wArg] = process.argv.slice(2);
  if (!['state', 'cleanup'].includes(cmd) || !wArg) {
    console.error('usage: finish.mjs state <W>     build $W/state.json and save it (or {skipped, why})\n'
      + '       finish.mjs cleanup <W>   run log, progress notice, xrepo worktrees, PR worktree, $W');
    process.exit(2);
  }
  const w = nativePath(wArg);
  try {
    const out = cmd === 'state' ? stateFor(w) : await cleanupWork(w);
    console.log(JSON.stringify(out, null, 2));
  } catch (e) { console.error(`finish.mjs: ${e.message}`); process.exit(1); }
}
