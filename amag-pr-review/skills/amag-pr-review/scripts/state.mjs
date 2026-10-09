#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOurs, isProgress } from './comment.mjs';

export function fingerprint(fileText, line) {
  const lines = fileText.split(/\r?\n/);
  if (!Number.isInteger(line) || line < 1 || line > lines.length) return null;
  const win = lines.slice(Math.max(0, line - 3), Math.min(lines.length, line + 2));
  const norm = win.map(l => l.replace(/\s+/g, ' ').trim()).join('\n');
  return createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

// Finds where fingerprinted code sits now, so unchanged-but-moved code (new lines above it, or a
// rebase) still counts as unchanged. Nearest match to the old line wins.
export function locateFingerprint(fileText, fp, oldLine) {
  const count = fileText.split(/\r?\n/).length;
  let best = null;
  for (let line = 1; line <= count; line++) {
    if (fingerprint(fileText, line) !== fp) continue;
    if (best === null || Math.abs(line - oldLine) < Math.abs(best - oldLine)) best = line;
  }
  return best;
}

export const stateRoot =(env = process.env) => env.PR_REVIEW_ROOT || 'C:\\repos\\ai-review';
export const statePath = (ws, repo, pr, root = stateRoot()) => join(root, '.state', `${ws}-${repo}-PR${pr}.json`);

export function loadState(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

export function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path + '.tmp', JSON.stringify(state, null, 2));
  renameSync(path + '.tmp', path);
}


export function splitComments(values, meAccountId) {
  const ours = [], others = [], progress = [];
  for (const c of values) {
    if (c.deleted) continue;
    if (c.user?.account_id === meAccountId && isProgress(c.content?.raw)) { progress.push(c.id); continue; }
    const inl = c.inline ?? null;
    const item = {
      id: c.id,
      parent: c.parent?.id ?? null,
      path: inl?.path ?? null,
      line: inl ? (inl.to ?? inl.from ?? null) : null,
      side: inl ? (inl.to != null ? 'new' : 'old') : null,
      author: c.user?.display_name ?? c.user?.nickname ?? 'unknown',
      raw: c.content?.raw ?? '',
      resolved: Boolean(c.resolution),
      resolvedBy: c.resolution?.user?.account_id ?? null,
      outdated: Boolean(inl?.outdated),
    };
    (c.user?.account_id === meAccountId && isOurs(item.raw) ? ours : others).push(item);
  }
  return { ours, others, progress };
}

function main([cmd, ...a]) {
  if (cmd === 'fingerprint' && a.length === 2) return { fingerprint: fingerprint(readFileSync(a[0], 'utf8'), Number(a[1])) };
  if (cmd === 'locate' && a.length === 3) {
    let text;
    try { text = readFileSync(a[0], 'utf8'); } catch { return { line: null }; }
    return { line: locateFingerprint(text, a[1], Number(a[2])) };
  }
  if (cmd === 'path' && a.length === 3) return { path: statePath(...a) };
  if (cmd === 'load' && a.length === 3) return loadState(statePath(...a));
  if (cmd === 'save' && a.length === 3) {
    const p = statePath(...a);
    saveState(p, JSON.parse(readFileSync(0, 'utf8')));
    return { saved: p };
  }
  if (cmd === 'split-comments' && a.length === 3) {
    const { values } = JSON.parse(readFileSync(a[0], 'utf8'));
    const me = JSON.parse(readFileSync(a[1], 'utf8')).account_id;
    const { ours, others, progress } = splitComments(values, me);
    mkdirSync(a[2], { recursive: true });
    writeFileSync(join(a[2], 'comments-ours.json'), JSON.stringify(ours, null, 2));
    writeFileSync(join(a[2], 'comments-others.json'), JSON.stringify(others, null, 2));
    return { ours: ours.length, others: others.length, staleProgress: progress };
  }
  console.error('usage: state.mjs fingerprint <file> <line> | locate <file> <fingerprint> <oldLine> | path|load|save <ws> <repo> <pr> | split-comments <comments.json> <me.json> <out-dir>');
  process.exit(2);
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase())
  console.log(JSON.stringify(main(process.argv.slice(2)), null, 2));
