#!/usr/bin/env node
// Leads from the release branches this change will be merged or rebased into: widths those branches
// widened that the change still declares at the old size, and files they have changed since forking.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, textDiffs } from './sql-index-map.mjs';
import { diffLines } from './styles-scan.mjs';

const SCANNED = /\.(sql|cs)$/i;
const NOT_NAMES = new Set(['as', 'returns', 'table', 'varying', 'cast', 'convert', 'null', 'not']);
const MAX_BRANCHES = 3;
const STALE_DAYS = 90;
const PATTERN_MIN = 3;
const CAP = 40;
const DIFF_BYTES = 200_000;

export function parseVersion(branch) {
  const m = String(branch).match(/^(?:origin\/)?release\/(\d+)\.(\d+)\.(\d+)/);
  return m ? m.slice(1, 4).map(Number) : null;
}

export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

const bare = name => name.replace(/^@/, '').replace(/^\[|\]$/g, '');
export const suffixOf = name => {
  const n = bare(name);
  return (n.match(/([A-Z][a-z0-9]+|[a-z0-9]+)$/)?.[1] ?? n).toLowerCase();
};
const family = type => (/^n/i.test(type) ? 'n' : '');

const stripSqlComments = t => t.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/--[^\n]*/g, '');

// `@Name nvarchar(40)`, `Name NVARCHAR(40) NOT NULL`, `"@Name", SqlDbType.NVarChar, 40`,
// `[StringLength(40)]` / `[MaxLength(40)]` above a property. MAX and untyped lengths are skipped.
export function declarationsIn(text, path) {
  const out = [];
  const lines = String(text).split(/\r?\n/);
  if (/\.sql$/i.test(path)) {
    const clean = stripSqlComments(lines.join('\n')).split('\n');
    const re = /(@?\[?[A-Za-z_]\w*\]?)\s+\[?((?:n)?(?:var)?char)\]?\s*\(\s*(\d+)\s*\)/gi;
    clean.forEach((l, i) => {
      for (const m of l.matchAll(re)) {
        if (NOT_NAMES.has(bare(m[1]).toLowerCase())) continue;
        out.push({ name: bare(m[1]), family: family(m[2]), width: +m[3], line: i + 1 });
      }
    });
  } else {
    lines.forEach((l, i) => {
      for (const m of l.matchAll(/"(@\w+)"\s*,\s*SqlDbType\.(N?(?:Var)?Char)\s*,\s*(\d+)/gi))
        out.push({ name: bare(m[1]), family: family(m[2]), width: +m[3], line: i + 1 });
      const a = l.match(/\[\s*(?:StringLength|MaxLength)\s*\(\s*(\d+)/);
      if (!a) return;
      for (let j = i; j < Math.min(lines.length, i + 4); j++) {
        const p = lines[j].match(/\b(?:public|internal|protected|private)\b[^=(]*\bstring\??\s+(\w+)\s*\{/);
        if (p) { out.push({ name: p[1], family: 'n', width: +a[1], line: i + 1 }); break; }
      }
    });
  }
  return out;
}

// Widened = a name declared at one width on the old side and only at a larger one on the new side.
export function widenings(oldText, newText, path) {
  const index = decls => {
    const m = new Map();
    for (const d of decls) {
      const k = `${d.name.toLowerCase()}|${d.family}`;
      if (!m.has(k)) m.set(k, { name: d.name, family: d.family, widths: new Set() });
      m.get(k).widths.add(d.width);
    }
    return m;
  };
  const before = index(declarationsIn(oldText, path)), after = index(declarationsIn(newText, path));
  const out = [];
  for (const [k, o] of before) {
    const n = after.get(k);
    if (!n) continue;
    for (const from of o.widths) {
      if (n.widths.has(from)) continue;
      const to = Math.min(...[...n.widths].filter(w => w > from));
      if (Number.isFinite(to)) out.push({ name: o.name, family: o.family, from, to });
    }
  }
  return out;
}

export function groupWidenings(perFile) {
  const groups = new Map();
  for (const { path, items } of perFile) for (const w of items) {
    const k = `${suffixOf(w.name)}|${w.family}|${w.from}|${w.to}`;
    if (!groups.has(k)) groups.set(k, { suffix: suffixOf(w.name), family: w.family, from: w.from, to: w.to, names: new Set(), files: new Set() });
    const g = groups.get(k);
    g.names.add(w.name);
    g.files.add(path);
  }
  return [...groups.values()];
}

// A lead needs the exact name widened, or a pattern across several names with the same suffix.
export function matchLeads(prDecls, groups) {
  const leads = [];
  for (const d of prDecls) {
    for (const g of groups) {
      if (g.family !== d.family || g.from !== d.width || g.suffix !== suffixOf(d.name)) continue;
      const exact = [...g.names].some(n => n.toLowerCase() === d.name.toLowerCase());
      if (!exact && g.names.size < PATTERN_MIN) continue;
      leads.push({ path: d.path, line: d.line, name: d.name, width: d.width, widenedTo: g.to, match: exact ? 'exact' : 'pattern', group: g });
    }
  }
  return leads;
}

const git = (repo, args, opts = {}) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 << 20, ...opts });

function readBlobs(repo, specs) {
  if (!specs.length) return [];
  const r = spawnSync('git', ['-C', repo, 'cat-file', '--batch'], { input: specs.join('\n') + '\n', maxBuffer: 1 << 30 });
  const buf = r.stdout, out = [];
  let pos = 0;
  for (let i = 0; i < specs.length; i++) {
    const nl = buf.indexOf(0x0a, pos);
    const head = buf.subarray(pos, nl).toString();
    pos = nl + 1;
    const m = head.match(/^\S+ blob (\d+)$/);
    if (!m) { out.push(''); continue; }
    out.push(decode(buf.subarray(pos, pos + +m[1])));
    pos += +m[1] + 1;
  }
  return out;
}

export function newerBranches(repo, dest, remote = 'origin') {
  const refs = git(repo, ['for-each-ref', '--format=%(refname:short) %(committerdate:unix)', `refs/remotes/${remote}/release/`])
    .split('\n').filter(Boolean).map(l => { const [ref, t] = l.split(' '); return { ref, time: +t, version: parseVersion(ref) }; })
    .filter(b => b.version && b.ref !== `${remote}/${dest}`);
  const fresh = Date.now() / 1000 - STALE_DAYS * 86400;
  const destVersion = parseVersion(dest);
  let picked = refs.filter(b => b.time >= fresh);
  if (destVersion) picked = picked.filter(b => compareVersions(b.version, destVersion) > 0);
  else picked = picked.filter(b => git(repo, ['rev-list', '--count', `${remote}/${dest}..${b.ref}`]).trim() !== '0');
  return picked.sort((a, b) => compareVersions(b.version, a.version) || b.time - a.time).slice(0, MAX_BRANCHES).map(b => b.ref);
}

function commitsTouching(repo, range, paths, max) {
  if (!paths.length) return [];
  return git(repo, ['log', `--max-count=${max}`, '--format=%h %s', range, '--', ...paths.slice(0, 100)]).split('\n').filter(Boolean);
}

export function scanBranch(repo, destRef, branch, prFiles, diffsDir = null) {
  const fork = git(repo, ['merge-base', destRef, branch]).trim();
  const range = `${fork}..${branch}`;
  const changed = git(repo, ['diff', '--name-only', '--diff-filter=M', fork, branch]).split('\n').filter(p => SCANNED.test(p));
  const blobs = readBlobs(repo, changed.flatMap(p => [`${fork}:${p}`, `${branch}:${p}`]));
  const perFile = changed.map((path, i) => ({ path, items: widenings(blobs[2 * i], blobs[2 * i + 1], path) })).filter(f => f.items.length);
  const groups = groupWidenings(perFile);
  const prDecls = [...prFiles].filter(([p]) => SCANNED.test(p))
    .flatMap(([path, f]) => f.added.flatMap(a => declarationsIn(a.text, path).map(d => ({ ...d, path, line: a.line }))));
  const leads = matchLeads(prDecls, groups);
  const commitsFor = new Map();
  for (const g of new Set(leads.map(l => l.group))) commitsFor.set(g, commitsTouching(repo, range, [...g.files], 5));

  const drift = [];
  const byPath = new Map();
  const prPaths = [...prFiles.keys()];
  for (let i = 0; i < prPaths.length; i += 100) {
    const chunk = prPaths.slice(i, i + 100);
    let cur = null;
    for (const l of git(repo, ['log', '--format=@%h %s', '--name-only', range, '--', ...chunk]).split('\n')) {
      if (l.startsWith('@')) cur = l.slice(1);
      else if (l && cur) { if (!byPath.has(l)) byPath.set(l, []); if (byPath.get(l).length < 3) byPath.get(l).push(cur); }
    }
  }
  // Without rename detection a moved file reads as deleted, and a merge or rebase follows the move anyway.
  const renames = new Map();
  if (byPath.size) for (const l of git(repo, ['diff', '-M', '--name-status', '--diff-filter=R', fork, branch]).split('\n')) {
    const [status, from, to] = l.split('\t');
    if (status?.startsWith('R') && byPath.has(from)) renames.set(from, { to, similarity: Number(status.slice(1)) });
  }
  for (const [path, commits] of byPath) {
    const entry = { path, commits };
    const rename = renames.get(path);
    if (rename) Object.assign(entry, { renamedTo: rename.to, similarity: rename.similarity, pureRename: rename.similarity === 100 });
    if (diffsDir) {
      let d = git(repo, ['diff', '-M', '-U20', fork, branch, '--', path, ...(rename ? [rename.to] : [])]);
      if (/\.sql$/i.test(path) && /^Binary files /m.test(d)) d = textDiffs(repo, fork, branch, [path]);
      if (d) {
        const file = join(diffsDir, `${branch.replace(/[^\w.-]+/g, '_')}__${path.replace(/[^\w.-]+/g, '_')}.diff`);
        mkdirSync(diffsDir, { recursive: true });
        writeFileSync(file, d.length > DIFF_BYTES ? d.slice(0, DIFF_BYTES) + '\n[truncated]\n' : d);
        entry.diffFile = file;
      }
    }
    drift.push(entry);
  }

  return {
    branch, fork: fork.slice(0, 10),
    widened: groups.filter(g => g.names.size >= PATTERN_MIN || leads.some(l => l.group === g)).slice(0, CAP)
      .map(g => ({ suffix: g.suffix, type: `${g.family}varchar`, from: g.from, to: g.to, names: [...g.names].slice(0, 8), nameCount: g.names.size, fileCount: g.files.size })),
    leads: leads.slice(0, CAP).map(({ group, ...l }) => ({
      ...l, branch,
      evidence: `${branch.replace(/^[^/]+\//, '')} widened ${group.names.size} ${group.suffix} declaration(s) from ${group.from} to ${group.to} in ${group.files.size} file(s), e.g. ${[...group.names].slice(0, 4).join(', ')}`,
      commits: commitsFor.get(group),
      alsoWidenedSameWidths: groups.filter(g => g !== group && g.family === group.family && g.from === group.from && g.to === group.to)
        .flatMap(g => [...g.names]).slice(0, 12),
    })),
    drift: drift.slice(0, CAP),
  };
}

export function scan(repo, diffText, dest, { remote = 'origin', diffsDir = null } = {}) {
  const prFiles = diffLines(diffText);
  const destRef = `${remote}/${dest}`;
  const branches = newerBranches(repo, dest, remote);
  return { dest, branches: branches.map(b => scanBranch(repo, destRef, b, prFiles, diffsDir)) };
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  const [repo, diffFile, dest, flag, diffsDir] = process.argv.slice(2);
  if (!repo || !diffFile || !dest || (flag && (flag !== '--diffs' || !diffsDir))) {
    console.error('usage: forward-scan.mjs <repo> <diff-file> <dest-branch> [--diffs <dir>]   (dest without "origin/")'); process.exit(2);
  }
  console.log(JSON.stringify(scan(repo, readFileSync(diffFile, 'utf8'), dest, { diffsDir: diffsDir ?? null }), null, 2));
}
