#!/usr/bin/env node
// Checks a reviewer's coverage ledger against its diff: every added line, and every block of removed
// lines with nothing added in its place, must sit inside an entry the reviewer wrote after checking it.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDiff, isGenerated } from './anchors.mjs';

const TRIVIAL = /^\s*[{}();,]*\s*$/;

export function changedRuns(files, only = null) {
  const runs = [];
  for (const f of files.values()) {
    if (f.binary || isGenerated(f) || (only && !only.test(f.path))) continue;
    let oldLn = 0, newLn = 0, added = null, removed = null;
    const close = () => {
      if (added) runs.push({ path: f.path, side: 'new', ...added });
      else if (removed) runs.push({ path: f.path, side: 'old', ...removed });
      added = removed = null;
    };
    for (const line of f.raw) {
      const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (h) { close(); oldLn = +h[1]; newLn = +h[2]; continue; }
      if (!oldLn && !newLn) continue;
      // A blank or brace-only line holds nothing to check, and ledgers that end one unit before the
      // blank line separating it from the next would otherwise come back with a gap there.
      const empty = TRIVIAL.test(line.slice(1));
      if (line[0] === '+') { if (empty) { if (added) close(); } else added = added ? { ...added, to: newLn } : { from: newLn, to: newLn }; newLn++; }
      else if (line[0] === '-') { if (empty) { if (removed && !added) close(); } else removed = removed ? { ...removed, to: oldLn } : { from: oldLn, to: oldLn }; oldLn++; }
      else if (line[0] === ' ') { close(); oldLn++; newLn++; }
    }
    close();
  }
  return runs;
}

const norm = p => String(p ?? '').replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
const samePath = (a, b) => { a = norm(a); b = norm(b); return a === b || a.endsWith('/' + b) || b.endsWith('/' + a); };

export function uncovered(runs, ledger) {
  const entries = (Array.isArray(ledger) ? ledger : []).filter(e => e && String(e.checked ?? '').trim()
    && Number.isFinite(+e.from) && Number.isFinite(+e.to));
  const out = [];
  for (const r of runs) {
    const mine = entries.filter(e => samePath(e.path, r.path) && (e.side ?? 'new') === r.side);
    let gap = null;
    for (let ln = r.from; ln <= r.to; ln++) {
      if (mine.some(e => +e.from <= ln && ln <= +e.to)) { if (gap) { out.push(gap); gap = null; } continue; }
      gap = gap ? { ...gap, to: ln } : { path: r.path, side: r.side, from: ln, to: ln };
    }
    if (gap) out.push(gap);
  }
  return out;
}

function main([cmd, diffFile, ledgerFile, ...rest]) {
  if (cmd !== 'check' || !diffFile || !ledgerFile) {
    console.error('usage: coverage.mjs check <diff> <ledger.json> [--only <path regex>]');
    process.exit(2);
  }
  const i = rest.indexOf('--only');
  const only = i >= 0 && rest[i + 1] ? new RegExp(rest[i + 1], 'i') : null;
  let ledger = [];
  try { ledger = JSON.parse(readFileSync(ledgerFile, 'utf8')); } catch { /* missing or malformed: nothing covered */ }
  const runs = changedRuns(parseDiff(readFileSync(diffFile, 'utf8')), only);
  const missing = uncovered(runs, ledger);
  console.log(JSON.stringify({ required: runs.length, missing }));
  process.exit(missing.length ? 1 : 0);
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) main(process.argv.slice(2));
