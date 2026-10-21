#!/usr/bin/env node
// Re-review scope: the parts of the PR's own diff (merge base..head) around lines changed since the
// last reviewed commit. Diffing the two commits alone would also pull in whatever a merge or rebase
// brought from the base branch, and the whole PR diff would re-review code we already passed.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTEXT = 3;
const unquote = p => p.replace(/^"(.*)"$/, '$1').replace(/^[ab]\//, '');

// Each body line keeps the old and new line numbers it sits at, so a slice of a hunk can be given a
// correct header of its own.
export function parseHunks(text) {
  const files = [];
  let cur = null, hunk = null, oldLeft = 0, newLeft = 0, oldLn = 0, newLn = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      const c = raw[0];
      if (c === '\\') { hunk.body.push({ raw, type: '\\', oldLn, newLn }); continue; }
      const type = c === '+' || c === '-' ? c : ' ';
      hunk.body.push({ raw, type, oldLn, newLn });
      if (type === '+') { hunk.added.push(newLn++); newLeft--; }
      else if (type === '-') { hunk.removed.push(raw.slice(1).trim()); oldLn++; oldLeft--; }
      else { oldLn++; newLn++; oldLeft--; newLeft--; }
      continue;
    }
    if (raw.startsWith('diff --git ')) {
      cur = { path: null, header: [raw], hunks: [] };
      hunk = null;
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    let m;
    if ((m = raw.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/))) {
      oldLeft = m[2] === undefined ? 1 : +m[2];
      newLeft = m[4] === undefined ? 1 : +m[4];
      // An empty side's start is the line before it; the counters track the next line.
      oldLn = +m[1] + (oldLeft === 0 ? 1 : 0);
      newLn = +m[3] + (newLeft === 0 ? 1 : 0);
      hunk = { header: raw, body: [], added: [], removed: [] };
      cur.hunks.push(hunk);
      continue;
    }
    if (hunk) continue;
    cur.header.push(raw);
    if ((m = raw.match(/^\+\+\+ (.*)$/)) && m[1] !== '/dev/null') cur.path = unquote(m[1]);
    else if ((m = raw.match(/^--- (.*)$/)) && m[1] !== '/dev/null' && !cur.path) cur.path = unquote(m[1]);
    else if ((m = raw.match(/^rename to (.*)$/))) cur.path = unquote(m[1]);
  }
  return files.filter(f => f.path);
}

// Added lines match by head line number, which both diffs share. Removed lines have no shared
// numbering (one diff counts from the merge base, the other from the last review), so they match
// by content within the same file. Short lines ("}", "else {") would match anywhere, so they don't count.
const distinctive = r => r.length >= 8;

// Contiguous runs of a hunk's body around its hits, each one a valid hunk. A file the PR adds is one
// hunk end to end, so without this one edit would put the whole file back in scope.
function slices(hunk, hit) {
  const idx = hunk.body.map((l, i) => (hit(l) ? i : -1)).filter(i => i >= 0);
  const windows = [];
  for (const i of idx) {
    const [from, to] = [Math.max(0, i - CONTEXT), Math.min(hunk.body.length - 1, i + CONTEXT)];
    const last = windows.at(-1);
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else windows.push([from, to]);
  }
  return windows.map(([from, to]) => {
    // A "\ No newline" marker belongs to the line before it.
    while (to + 1 < hunk.body.length && hunk.body[to + 1].type === '\\') to++;
    const lines = hunk.body.slice(from, to + 1);
    const oldCount = lines.filter(l => l.type === ' ' || l.type === '-').length;
    const newCount = lines.filter(l => l.type === ' ' || l.type === '+').length;
    const first = lines.find(l => l.type !== '\\');
    // git numbers an empty side from the line before it.
    const oldStart = oldCount ? first.oldLn : first.oldLn - 1;
    const newStart = newCount ? first.newLn : first.newLn - 1;
    return { text: [`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...lines.map(l => l.raw)], changed: lines.filter(l => l.type === '+' || l.type === '-').length };
  });
}

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
    const hit = l => (l.type === '+' && s.added.has(l.newLn)) || (l.type === '-' && distinctive(l.raw.slice(1).trim()) && s.removed.has(l.raw.slice(1).trim()));
    const parts = f.hunks.flatMap(h => slices(h, hit));
    if (!parts.length) continue;
    kept.push({ path: f.path, hunks: parts.length, of: f.hunks.length, changed: parts.reduce((n, p) => n + p.changed, 0) });
    out.push(...f.header, ...parts.flatMap(p => p.text));
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
