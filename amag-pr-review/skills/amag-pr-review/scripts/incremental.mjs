#!/usr/bin/env node
// Re-review: which previous findings are closed or re-checked, and the re-review scope.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dropFormattingOnly } from './anchors.mjs';
import { parseHeader } from './comment.mjs';
import { filterDelta } from './delta.mjs';
import { nativePath } from './env.mjs';
import { binarySqlPaths, textDiffs } from './sql-index-map.mjs';
import { locateFingerprint } from './state.mjs';

// Paths in env.sh and repos.json are Git Bash spellings; node and git.exe don't translate "/c/...".
export function parseEnvSh(text) {
  const env = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith("'")) v = v.replace(/'\\''/g, "'").replace(/^'|'$/g, '');
    else if (v.startsWith('"')) v = v.replace(/^"|"$/g, '');
    env[m[1]] = v;
  }
  return env;
}

// repos.json is the shared source; env.sh is the fallback for a work dir written before it existed.
export function runContext(reposJson, envSh) {
  const r = reposJson?.repos?.[0];
  const env = parseEnvSh(envSh);
  return {
    authorId: reposJson?.pr?.authorId ?? env.AUTHOR_ID ?? null,
    wt: r?.wt ?? env.WT ?? null,
    mb: r?.mb ?? env.MB ?? null,
    head: r?.head ?? env.HEAD_SHA ?? null,
  };
}

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

// Without a state file only the comment's header is left, and it carries the public status, not the
// internal severity: only a note (Info) and an old "nit" map back to one.
export function severityFromComment(raw) {
  const status = parseHeader(raw)?.status;
  if (status === 'note' || status === 'info') return 'Info';
  if (status === 'nit') return 'Low/nit';
  return null;
}

export function previousFindings(state, ours) {
  if (state) return { findings: (state.findings ?? []).filter(f => f.status === 'open' || f.status === 'pending'), bestEffort: false };
  const top = (ours ?? []).filter(c => c.parent == null);
  return {
    findings: top.map(c => ({
      commentId: c.id, parentId: null, path: c.path, line: c.line, side: c.side,
      severity: severityFromComment(c.raw), status: 'open', pushbackSeen: 0, fingerprint: null,
    })),
    bestEffort: top.length > 0,
  };
}

// Resolving is not fixing: an author's resolve (or one Bitbucket doesn't attribute) stays open.
export function classify(findings, ours, authorId) {
  if (authorId == null && findings.length) throw new Error('AUTHOR_ID is needed to tell an author resolve from a reviewer one');
  const closed = [], kept = [];
  for (const f of findings) {
    const c = (ours ?? []).find(o => sameId(o.id, f.commentId));
    const close = why => closed.push({ commentId: f.commentId, path: f.path, line: f.line, why });
    if (!c) { close('deleted'); continue; }
    if (c.resolved && f.severity === 'Info') { close('resolved Info'); continue; }
    if (c.resolved && c.resolvedBy != null && !sameId(c.resolvedBy, authorId)) { close(`resolved by ${c.resolvedBy}`); continue; }
    const seen = Number(f.pushbackSeen ?? 0) || 0;
    const authorReplies = (c.authorReplies ?? []).filter(r => Number(r.id) > seen);
    kept.push({ finding: f, authorResolved: Boolean(c.resolved), authorReplies });
  }
  return { closed, kept };
}

// readFile returns null when the file is gone at head; that's changed code too.
export function locateFinding(f, readFile) {
  if (f.side === 'old' || !f.fingerprint) return { line: f.line, codeChanged: true };
  const text = readFile(f.path);
  const at = text == null ? null : locateFingerprint(text, f.fingerprint, Number(f.line));
  return at == null ? { line: f.line, codeChanged: true } : { line: at, codeChanged: false };
}

export function buildRecheck(kept, readFile) {
  return kept.map(({ finding: f, authorResolved, authorReplies }) => {
    const { line, codeChanged } = locateFinding(f, readFile);
    return {
      commentId: f.commentId, parentId: f.parentId ?? null, path: f.path, line, side: f.side ?? null,
      severity: f.severity ?? null, codeChanged, authorResolved, authorReplies,
    };
  });
}

export const buildOursPrevious = recheck =>
  recheck.map(({ commentId, parentId, path, line, side, severity }) => ({ commentId, parentId, path, line, side, severity }));

export function prepare({ state, ours, authorId, readFile }) {
  const { findings, bestEffort } = previousFindings(state, ours);
  const { closed, kept } = classify(findings, ours, authorId);
  const recheck = buildRecheck(kept, readFile);
  const files = {};
  if (recheck.length) {
    files['previous-recheck.json'] = recheck;
    files['ours-previous.json'] = buildOursPrevious(recheck);
  }
  if (Array.isArray(state?.dropped) && state.dropped.length) files['dropped-previous.json'] = state.dropped;
  return {
    files,
    summary: {
      previous: recheck.length,
      closed,
      authorResolved: recheck.filter(r => r.authorResolved).map(r => r.commentId),
      bestEffort,
      reviewedCommit: state?.reviewedCommit ?? null,
    },
  };
}

// git(args) returns stdout and throws on a non-zero exit; textDiff(base, head, diffText) returns the
// decoded UTF-16 .sql diffs to append.
export function scope({ reviewedCommit, mb, head }, { git, textDiff }) {
  const rc = String(reviewedCommit ?? '');
  const exists = () => { try { git(['cat-file', '-e', `${rc}^{commit}`]); return true; } catch { return false; } };
  // A value that isn't a hex sha would be read by git as an option or a ref name.
  if (!/^[0-9a-f]{7,64}$/i.test(rc) || !exists()) return { gone: true };
  const h = head || 'HEAD';
  const pr = git(['diff', '-U3', mb, h]);
  const prU3 = pr + textDiff(mb, h, pr);
  const s = git(['diff', '-U0', rc, h]);
  const since = s + textDiff(rc, h, s);
  const { text, kept } = filterDelta(prU3, since);
  return { gone: false, prU3, since, context: text, kept };
}

const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);
const readText = p => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const loadContext = W => runContext(readJson(join(W, 'repos.json'), null), readText(join(W, 'env.sh')));

function runPrepare(W) {
  const ctx = loadContext(W);
  const wt = nativePath(ctx.wt);
  const readFile = p => { try { return readFileSync(join(wt, p), 'utf8'); } catch { return null; } };
  const { files, summary } = prepare({
    state: readJson(join(W, 'state-prev.json'), null),
    ours: readJson(join(W, 'comments-ours.json'), []),
    authorId: ctx.authorId,
    readFile,
  });
  for (const [name, data] of Object.entries(files)) writeFileSync(join(W, name), JSON.stringify(data, null, 2));
  return summary;
}

function runScope(W) {
  const ctx = loadContext(W);
  const wt = nativePath(ctx.wt);
  const state = readJson(join(W, 'state-prev.json'), null);
  const git = args => execFileSync('git', ['-C', wt, ...args], { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] });
  const textDiff = (base, head, diffText) => textDiffs(wt, base, head, binarySqlPaths(diffText));
  const r = scope({ reviewedCommit: state?.reviewedCommit, mb: ctx.mb, head: ctx.head }, { git, textDiff });
  // dispatch.mjs reads this to tell reviewers the diff is a re-review slice.
  const record = out => (writeFileSync(join(W, 'scope.json'), JSON.stringify(out, null, 2)), out);
  if (r.gone) return record({ gone: true });
  writeFileSync(join(W, 'pr-u3.diff'), r.prU3);
  writeFileSync(join(W, 'since.diff'), r.since);
  const formatted = dropFormattingOnly(r.context);
  writeFileSync(join(W, 'context.diff'), formatted.text);
  console.error(JSON.stringify(r.kept));
  return record({ gone: false, since: state.reviewedCommit, keptHunks: r.kept, formattingOnly: formatted.dropped, empty: formatted.text.trim() === '' });
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  const [cmd, W] = process.argv.slice(2);
  if (!W || (cmd !== 'prepare' && cmd !== 'scope')) {
    console.error('usage: incremental.mjs prepare <W> | scope <W>');
    process.exit(2);
  }
  try {
    console.log(JSON.stringify(cmd === 'prepare' ? runPrepare(W) : runScope(W), null, 2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
