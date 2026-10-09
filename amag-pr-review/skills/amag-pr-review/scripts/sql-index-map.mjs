#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDiff } from './anchors.mjs';

// SQL Server tooling often saves scripts as UTF-16, with or without a BOM.
export function decode(buf) {
  const utf16 = b => b.subarray(0, b.length & ~1).toString('utf16le');
  if (buf[0] === 0xff && buf[1] === 0xfe) return utf16(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.subarray(2, 2 + ((buf.length - 2) & ~1))); b.swap16(); return b.toString('utf16le'); }
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  if (buf.length >= 4 && buf[1] === 0 && buf[3] === 0 && buf[0] !== 0) return utf16(buf);
  return buf.toString('utf8');
}

const NAME = String.raw`(?:\[[^\]]+\]|[\w#@]+)`;
const QUAL = String.raw`${NAME}(?:\s*\.\s*${NAME}){0,2}`;
const strip = n => n.replace(/[\[\]]/g, '');
const cols = s => s.split(',').map(c => strip(c.trim().replace(/\s+(ASC|DESC)$/i, '')).toLowerCase()).filter(Boolean);
export const normTable = q => strip(q.split('.').pop().trim()).toLowerCase();

export function tablesInSql(text) {
  const out = new Set();
  // ON DELETE/UPDATE CASCADE is a foreign-key action, and "from x in" is a LINQ range variable.
  const re = new RegExp(String.raw`\b(?:FROM|JOIN|(?<!\bON\s+)UPDATE|(?<!\bON\s+)DELETE(?:\s+FROM)?|MERGE(?:\s+INTO)?|INSERT(?:\s+INTO)?|INTO)\s+(${QUAL})(?!\s+in\b)`, 'gi');
  for (const m of text.matchAll(re)) {
    const t = normTable(m[1]);
    if (!/^[#@]/.test(t) && !/^(select|set|where|values|using)$/.test(t)) out.add(t);
  }
  return out;
}

export function tablesFromDiff(diffText) {
  const added = diffText.split(/\r?\n/).filter(l => l.startsWith('+') && !/^\+\+\+ (b\/|\/dev\/null|")/.test(l)).map(l => l.slice(1));
  return tablesInSql(added.join('\n'));
}

export function indexesIn(text, file) {
  const out = [];
  const idx = new RegExp(String.raw`CREATE\s+(UNIQUE\s+)?(?:(CLUSTERED|NONCLUSTERED)\s+)?INDEX\s+(${NAME})\s+ON\s+(${QUAL})\s*\(([^)]*)\)(?:\s*INCLUDE\s*\(([^)]*)\))?`, 'gi');
  for (const m of text.matchAll(idx))
    out.push({ table: normTable(m[4]), name: strip(m[3]), kind: m[1] ? 'unique-index' : 'index', clustered: /^clustered$/i.test(m[2] ?? ''), columns: cols(m[5]), include: m[6] ? cols(m[6]) : [], file });

  const owners = [...text.matchAll(new RegExp(String.raw`\b(?:CREATE|ALTER)\s+TABLE\s+(${QUAL})`, 'gi'))].map(m => ({ at: m.index, table: normTable(m[1]) }));
  const ownerAt = pos => owners.filter(o => o.at < pos).pop()?.table;

  const con = new RegExp(String.raw`CONSTRAINT\s+(${NAME})\s+(PRIMARY\s+KEY|UNIQUE)\s*(CLUSTERED|NONCLUSTERED)?\s*\(([^)]*)\)`, 'gi');
  for (const m of text.matchAll(con)) {
    const table = ownerAt(m.index);
    const pk = /^primary/i.test(m[2]);
    if (table) out.push({ table, name: strip(m[1]), kind: pk ? 'pk' : 'unique', clustered: m[3] ? /^clustered$/i.test(m[3]) : pk, columns: cols(m[4]), include: [], file });
  }

  const bare = /(?:^|,)\s*PRIMARY\s+KEY\s*(CLUSTERED|NONCLUSTERED)?\s*\(([^)]*)\)/gim;
  for (const m of text.matchAll(bare)) {
    const table = ownerAt(m.index);
    if (table) out.push({ table, name: null, kind: 'pk', clustered: !/^nonclustered$/i.test(m[1] ?? ''), columns: cols(m[2]), include: [], file });
  }

  const inline = new RegExp(String.raw`^\s*(${NAME})\s+[\w\[\]]+(?:\s*\([^)]*\))?[^,\n]*?\bPRIMARY\s+KEY\b`, 'gim');
  for (const m of text.matchAll(inline)) {
    if (/^(constraint|primary)$/i.test(strip(m[1]))) continue;
    const table = ownerAt(m.index);
    if (table) out.push({ table, name: null, kind: 'pk', clustered: true, columns: [strip(m[1]).toLowerCase()], include: [], file });
  }
  return out;
}

export function buildIndexMap(repoRoot, tables) {
  const want = [...new Set([...tables].map(t => t.toLowerCase()))];
  const files = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z', '--', ':(icase)*.sql'], { encoding: 'utf8', maxBuffer: 256 << 20 })
    .split('\0').filter(Boolean);
  const map = Object.fromEntries(want.map(t => [t, []]));
  for (const f of files) {
    const text = decode(readFileSync(join(repoRoot, f)));
    const lower = text.toLowerCase();
    if (!want.some(t => lower.includes(t))) continue;
    for (const ix of indexesIn(text, f)) if (ix.table in map) map[ix.table].push(ix);
  }
  return { tables: map, noIndexFound: want.filter(t => map[t].length === 0) };
}

export function binarySqlPaths(diffText) {
  return [...parseDiff(diffText).values()].filter(f => f.binary && /\.sql$/i.test(f.path)).map(f => f.path);
}

// git has no text driver for UTF-16 here, so it diffs those scripts as binary; decode both sides and
// diff them as text so reviewers see the change. head === null means the working tree.
export function textDiffs(repo, base, head, paths) {
  const tmp = mkdtempSync(join(tmpdir(), 'sqldiff-'));
  const show = rev => p => {
    try { return decode(execFileSync('git', ['-C', repo, 'show', `${rev}:${p}`], { stdio: ['ignore', 'pipe', 'ignore'] })); }
    catch { return ''; }
  };
  const readHead = head ? show(head) : p => (existsSync(join(repo, p)) ? decode(readFileSync(join(repo, p))) : '');
  let out = '';
  try {
    for (const p of paths) {
      const fa = join(tmp, 'a.sql'), fb = join(tmp, 'b.sql');
      writeFileSync(fa, show(base)(p));
      writeFileSync(fb, readHead(p));
      let d = '';
      try { execFileSync('git', ['diff', '--no-index', '-U40', '--', fa, fb], { encoding: 'utf8' }); }
      catch (e) { d = e.stdout ?? ''; }
      if (!d) continue;
      out += d.replace(/^diff --git .*$/m, `diff --git a/${p} b/${p}`)
        .replace(/^--- .*$/m, `--- a/${p}`)
        .replace(/^\+\+\+ .*$/m, `+++ b/${p}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return out;
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase() && process.argv[2] === 'text-diff') {
  const [, , , repo, diffFile, base, head] = process.argv;
  if (!repo || !diffFile || !base) { console.error('usage: sql-index-map.mjs text-diff <repo> <diff-file> <base> [head]   (no head = working tree)'); process.exit(2); }
  process.stdout.write(textDiffs(repo, base, head ?? null, binarySqlPaths(readFileSync(diffFile, 'utf8'))));
} else if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  const [root, flag, val] = process.argv.slice(2);
  let tables;
  if (flag === '--tables' && val) tables = val.split(',');
  else if (flag === '--diff' && val) tables = [...tablesFromDiff(readFileSync(val, 'utf8'))];
  else { console.error('usage: sql-index-map.mjs <repoRoot> --tables a,b | --diff <diff-file>'); process.exit(2); }
  console.log(JSON.stringify(tables.length ? buildIndexMap(root, tables) : { tables: {}, noIndexFound: [] }, null, 2));
}
