#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEVERITIES, stripHeader } from './comment.mjs';

export const FILE_NAME = 'review-findings.json';

// The terminal table and "fix 1,3" both use `n`, so the order has to be stable: worst first, then by place.
const rank = f => [SEVERITIES.indexOf(f.severity), f.repo ?? '', f.path ?? '', f.line ?? 0];
const compare = (a, b) => {
  const [x, y] = [rank(a), rank(b)];
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
};

export function findingsFile({ ticketKey, verified, built, repos, now = new Date() }) {
  const builtById = new Map(built.map(b => [b.id, b]));
  const findings = verified.findings
    .filter(f => f.verdict === 'confirmed' && builtById.has(f.id))
    .map(f => {
      const b = builtById.get(f.id);
      return {
        id: f.id, repo: f.repo ?? null, path: f.path ?? null, line: f.line ?? null, side: f.side ?? 'new',
        severity: f.severity, status: b.status, reviewers: b.reviewers, confidence: b.confidence,
        tokens: b.tokens ?? null, terminalOnly: !!f.terminal_only, text: stripHeader(b.body),
        state: 'open', resolution: null,
      };
    })
    .sort(compare)
    .map((f, i) => ({ n: i + 1, ...f }));
  return { ticketKey, reviewedAt: now.toISOString(), repos, findings };
}

// A later round re-raises what the user already settled unless the reviewers see the decision.
export function decisions(previous) {
  return (previous?.findings ?? [])
    .filter(f => f.resolution?.startsWith('User decision:'))
    .map(f => {
      const gist = (f.text ?? '').match(/^[^\n]*?[.!?](?=\s|$)|^[^\n]*/)[0];
      return `- ${f.repo}/${f.path}: "${gist}" → ${f.resolution}`;
    });
}

// head + dirty let a later reader tell whether line numbers may have moved since the review.
export function repoState(name, path, dest) {
  const git = (...a) => execFileSync('git', ['-C', path, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  return { name, path, dest, head: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') !== '' };
}

function gitIn(path, args, okStatuses = [0]) {
  try {
    return execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if (okStatuses.includes(e.status)) return e.stdout;
    throw e;
  }
}

// stash create writes a commit of the working tree without touching any ref, the index or a file, so
// each fix can be diffed against the tree just before it while the user's uncommitted work stays put.
export function snapshot(path) {
  return gitIn(path, ['stash', 'create']).trim() || gitIn(path, ['rev-parse', 'HEAD']).trim();
}

// stash create leaves untracked files out, so a file missing from the snapshot is diffed whole.
export function fixPatch(path, snap, files) {
  return files.map(f => {
    let inSnapshot = true;
    try { gitIn(path, ['cat-file', '-e', `${snap}:${f}`]); } catch { inSnapshot = false; }
    return inSnapshot
      ? gitIn(path, ['diff', snap, '--', f])
      : gitIn(path, ['diff', '--no-index', '--', '/dev/null', f], [0, 1]);
  }).join('');
}

const normalised = p => resolve(p).replace(/\\/g, '/').toLowerCase();

export function recordFix(file, n, fix) {
  const finding = file.findings.find(f => f.n === n);
  if (!finding) throw new Error(`no finding ${n}`);
  if (!fix.patch.trim()) throw new Error(`finding ${n}: the fix changed nothing in ${fix.files.join(', ')}`);
  finding.fix = fix;
  return file;
}

export function fixDiff(file, ns = []) {
  const fence = '```';
  return file.findings
    .filter(f => f.fix && (!ns.length || ns.includes(f.n)))
    .map(f => [`## Finding ${f.n} (${f.id}): ${f.repo}/${f.path}:${f.line}`, '', f.text, '',
      `${fence}diff`, f.fix.patch.trimEnd(), fence, ''].join('\n'))
    .join('\n');
}

function addedLines(patch, path) {
  const lines = new Set();
  let inFile = false;
  for (const l of patch.split('\n')) {
    if (l.startsWith('+++ ')) inFile = l.slice(4).replace(/^b\//, '') === path;
    else if (inFile && l.startsWith('+')) lines.add(l.slice(1).trim());
  }
  return lines;
}

// Matched by content, not line number: the flagged code may have moved or been committed since.
// Short lines ("}", "else {") would match any fix, so they don't count.
export function provenance(sources, repo, path, flagged) {
  const wanted = flagged.map(l => l.trim()).filter(l => l.length >= 8);
  const hits = [];
  for (const { source, file } of sources) {
    for (const f of file.findings ?? []) {
      if (!f.fix || f.fix.repo !== repo) continue;
      const lines = addedLines(f.fix.patch, path);
      if (wanted.some(l => lines.has(l))) hits.push({ source, n: f.n, id: f.id, finding: f.text, resolution: f.resolution ?? null });
    }
  }
  return hits;
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  const args = process.argv.slice(2);
  if (args[0] === 'decisions') {
    if (existsSync(args[1])) for (const line of decisions(JSON.parse(readFileSync(args[1], 'utf8')))) console.log(line);
    process.exit(0);
  }
  const fail = msg => { console.error(msg); process.exit(1); };
  if (args[0] === 'snapshot') {
    console.log(snapshot(args[1]));
    process.exit(0);
  }
  if (args[0] === 'record-fix') {
    const [, out, n, path, snap, ...files] = args;
    if (!files.length) fail('usage: local-findings.mjs record-fix <findings.json> <n> <repo-path> <snapshot> <file>...');
    const file = JSON.parse(readFileSync(out, 'utf8'));
    const repo = (file.repos ?? []).find(r => normalised(r.path) === normalised(path))?.name ?? basename(resolve(path));
    try {
      recordFix(file, Number(n), { repo, snapshot: snap, files, patch: fixPatch(path, snap, files) });
    } catch (e) { fail(e.message); }
    writeFileSync(out, JSON.stringify(file, null, 2) + '\n');
    process.exit(0);
  }
  if (args[0] === 'fix-diff') {
    const text = fixDiff(JSON.parse(readFileSync(args[1], 'utf8')), args.slice(2).map(Number));
    if (!text) fail('no recorded fix to review');
    process.stdout.write(text);
    process.exit(0);
  }
  if (args[0] === 'provenance') {
    const [, worktree, repo, path, from, to, ...files] = args;
    if (!files.length) fail('usage: local-findings.mjs provenance <worktree> <repo-name> <path> <from> <to> <findings.json>...');
    const flagged = readFileSync(resolve(worktree, path), 'utf8').split(/\r?\n/).slice(Number(from) - 1, Number(to));
    const sources = files.filter(f => existsSync(f)).map(f => ({ source: f, file: JSON.parse(readFileSync(f, 'utf8')) }));
    console.log(JSON.stringify(provenance(sources, repo, path, flagged)));
    process.exit(0);
  }
  const usage = 'usage: local-findings.mjs decisions <prev.json> | snapshot <repo-path> | record-fix | fix-diff | provenance | save <verified.json> <factcheck.json> <out.json> --ticket <KEY> (--repo <name> <path> <dest>)...';
  const ticketAt = args.indexOf('--ticket');
  const ticketKey = ticketAt >= 0 ? args.splice(ticketAt, 2)[1] : null;
  const repos = [];
  for (let i = args.indexOf('--repo'); i >= 0; i = args.indexOf('--repo')) {
    const [name, path, dest] = args.splice(i, 4).slice(1);
    if (!dest) { console.error(usage); process.exit(2); }
    repos.push(repoState(name, path, dest));
  }
  const [cmd, verifiedFile, builtFile, outFile] = args;
  if (cmd !== 'save' || !outFile || !ticketKey || !repos.length) { console.error(usage); process.exit(2); }
  const file = findingsFile({
    ticketKey, repos,
    verified: JSON.parse(readFileSync(verifiedFile, 'utf8')),
    built: JSON.parse(readFileSync(builtFile, 'utf8')),
  });
  writeFileSync(outFile, JSON.stringify(file, null, 2) + '\n');
  console.log(JSON.stringify(file.findings.map(({ n, id, status, path, line }) => ({ n, id, status, path, line }))));
}
