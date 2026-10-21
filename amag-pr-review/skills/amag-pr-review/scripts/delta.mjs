#!/usr/bin/env node
// Re-review scope: the PR's own hunks (merge base..head) that contain a line changed since the last
// reviewed commit. Diffing the two commits alone would also pull in whatever a merge or rebase brought
// from the base branch, and the whole PR diff would re-review code we already passed.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const unquote = p => p.replace(/^"(.*)"$/, '$1').replace(/^[ab]\//, '');

export function parseHunks(text) {
  const files = [];
  let cur = null, hunk = null, oldLeft = 0, newLeft = 0, newLn = 0;
  for (const line of text.split(/\r?\n/)) {
    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      hunk.lines.push(line);
      const c = line[0];
      if (c === '\\') continue;
      if (c === '+') { hunk.added.push(newLn++); newLeft--; }
      else if (c === '-') { hunk.removed.push(line.slice(1).trim()); oldLeft--; }
      else { newLn++; newLeft--; oldLeft--; }
      continue;
    }
    if (line.startsWith('diff --git ')) {
      cur = { path: null, header: [line], hunks: [] };
      hunk = null;
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    let m;
    if ((m = line.match(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/))) {
      oldLeft = m[1] === undefined ? 1 : +m[1];
      newLn = +m[2];
      newLeft = m[3] === undefined ? 1 : +m[3];
      hunk = { lines: [line], added: [], removed: [] };
      cur.hunks.push(hunk);
      continue;
    }
    if (hunk) continue;
    cur.header.push(line);
    if ((m = line.match(/^\+\+\+ (.*)$/)) && m[1] !== '/dev/null') cur.path = unquote(m[1]);
    else if ((m = line.match(/^--- (.*)$/)) && m[1] !== '/dev/null' && !cur.path) cur.path = unquote(m[1]);
    else if ((m = line.match(/^rename to (.*)$/))) cur.path = unquote(m[1]);
  }
  return files.filter(f => f.path);
}

// Added lines match by head line number, which both diffs share. Removed lines have no shared
// numbering (one diff counts from the merge base, the other from the last review), so they match
// by content within the same file. Short lines ("}", "else {") would match anywhere, so they don't count.
const distinctive = r => r.length >= 8;

export function filterDelta(prText, sinceText) {
  const since = new Map();
  for (const f of parseHunks(sinceText)) {
    const s = since.get(f.path) ?? { added: new Set(), removed: new Set() };
    for (const h of f.hunks) { h.added.forEach(n => s.added.add(n)); h.removed.filter(distinctive).forEach(r => s.removed.add(r)); }
    since.set(f.path, s);
  }
  const out = [];
  const kept = [];
  for (const f of parseHunks(prText)) {
    const s = since.get(f.path);
    if (!s) continue;
    const hunks = f.hunks.filter(h => h.added.some(n => s.added.has(n)) || h.removed.some(r => distinctive(r) && s.removed.has(r)));
    if (!hunks.length) continue;
    kept.push({ path: f.path, hunks: hunks.length, of: f.hunks.length });
    out.push(...f.header, ...hunks.flatMap(h => h.lines));
  }
  return { text: out.length ? out.join('\n') + '\n' : '', kept };
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  const [cmd, prFile, sinceFile] = process.argv.slice(2);
  if (cmd !== 'filter' || !prFile || !sinceFile) {
    console.error('usage: delta.mjs filter <merge-base..head diff> <last-reviewed..head diff>   (diff on stdout, kept hunks on stderr)');
    process.exit(2);
  }
  const { text, kept } = filterDelta(readFileSync(prFile, 'utf8'), readFileSync(sinceFile, 'utf8'));
  process.stdout.write(text);
  console.error(JSON.stringify(kept));
}
