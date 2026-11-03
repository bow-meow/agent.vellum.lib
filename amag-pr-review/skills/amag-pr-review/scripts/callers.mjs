#!/usr/bin/env node
// Lists the call sites of the functions a diff changes, so reviewers don't spend tool calls finding
// them. Usage: callers.mjs <worktree> --diff <diff> [--prefix <repo>]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGenerated, parseDiff } from './anchors.mjs';

export const MAX_NAMES = 40;
export const MAX_HITS = 15;
// A name called from more places than this is a class, macro or utility: its sites are counted, not listed.
export const TOO_COMMON = 60;
const CODE = /\.(c|cc|cpp|cxx|h|hpp|cs|ts|tsx|go)$/i;
const NOT_NAMES = new Set(['if', 'for', 'while', 'switch', 'return', 'sizeof', 'catch', 'new', 'delete', 'using', 'throw',
  'else', 'case', 'static', 'const', 'void', 'public', 'private', 'protected', 'internal', 'override', 'virtual', 'async',
  'function', 'constructor', 'get', 'set', 'main', 'Execute', 'Run', 'Open', 'Close', 'Init', 'Dispose', 'ToString', 'Equals']);

// The function a hunk sits in (git's funcname context after the second @@), and functions the added
// lines define.
export function changedFunctions(files) {
  const names = new Map();
  const add = (name, path) => {
    if (!name || name.length < 4 || NOT_NAMES.has(name) || /^[A-Z0-9_]+$/.test(name)) return;
    if (!names.has(name)) names.set(name, new Set());
    names.get(name).add(path);
  };
  const callee = text => [...String(text).matchAll(/([A-Za-z_~][\w]*)\s*\(/g)].map(m => m[1]).filter(n => !NOT_NAMES.has(n)).pop();
  for (const f of files.values()) {
    if (f.binary || isGenerated(f) || !CODE.test(f.path)) continue;
    for (const line of f.raw) {
      const h = line.match(/^@@ [^@]+ @@\s*(.*)$/);
      if (h) { add(callee(h[1]), f.path); continue; }
      if (line[0] !== '+') continue;
      const def = line.match(/^\+\s*(?:[\w:<>,*&~\s]+?\s)?(?:\w+::)?(~?[A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const\s*)?(?:override\s*)?(?:\{.*)?$/);
      if (def && !/^\+\s*(return|if|for|while|switch|else|case|throw|delete|new)\b/.test(line)) add(def[1], f.path);
    }
  }
  return names;
}

export function callers(wt, diffText, { prefix = null, grep = gitGrep } = {}) {
  const names = [...changedFunctions(parseDiff(diffText)).entries()].slice(0, MAX_NAMES);
  const show = p => (prefix ? `${prefix}/${p}` : p);
  const out = {};
  for (const [name, files] of names) {
    const hits = grep(wt, name);
    if (hits.length > TOO_COMMON) { out[name] = { changedIn: [...files].map(show), tooCommon: hits.length }; continue; }
    out[name] = {
      changedIn: [...files].map(show),
      sites: hits.slice(0, MAX_HITS).map(h => ({ path: show(h.path), line: h.line, text: h.text.trim().slice(0, 160) })),
      more: Math.max(0, hits.length - MAX_HITS),
    };
  }
  return out;
}

function gitGrep(wt, name) {
  let out = '';
  try {
    out = execFileSync('git', ['-C', wt, 'grep', '-n', '-w', '-I', '-e', `${name}`, '--', '*.c', '*.cc', '*.cpp', '*.CPP', '*.cxx', '*.h', '*.H', '*.hpp', '*.cs', '*.ts', '*.go'],
      { encoding: 'utf8', maxBuffer: 1 << 27, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { out = e.stdout ?? ''; }
  return out.split(/\r?\n/).filter(Boolean).map(l => {
    const m = l.match(/^(.+?):(\d+):(.*)$/);
    return m ? { path: m[1], line: +m[2], text: m[3] } : null;
  }).filter(Boolean);
}

function main(argv) {
  const a = [...argv];
  const opt = n => { const i = a.indexOf(n); if (i < 0) return null; const v = a[i + 1]; a.splice(i, 2); return v; };
  const diff = opt('--diff'), prefix = opt('--prefix');
  const [wt] = a;
  if (!wt || !diff) { console.error('usage: callers.mjs <worktree> --diff <diff> [--prefix <repo>]'); process.exit(2); }
  return callers(resolve(wt), readFileSync(diff, 'utf8'), { prefix });
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  try { console.log(JSON.stringify(main(process.argv.slice(2)), null, 2)); }
  catch (e) { console.error(`callers.mjs: ${e.message}`); process.exit(1); }
}
