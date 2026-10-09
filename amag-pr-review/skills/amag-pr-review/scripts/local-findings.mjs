#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATUSES, stripHeader } from './comment.mjs';

export const FILE_NAME = 'review-findings.json';

// The terminal table and "fix 1,3" both use `n`, so the order has to be stable: worst first, then by place.
const rank = f => [STATUSES.indexOf(f.status), f.repo ?? '', f.path ?? '', f.line ?? 0];
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

// head + dirty let a later reader tell whether line numbers may have moved since the review.
export function repoState(name, path, dest) {
  const git = (...a) => execFileSync('git', ['-C', path, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  return { name, path, dest, head: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') !== '' };
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  const args = process.argv.slice(2);
  const usage = 'usage: local-findings.mjs save <verified.json> <factcheck.json> <out.json> --ticket <KEY> (--repo <name> <path> <dest>)...';
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
