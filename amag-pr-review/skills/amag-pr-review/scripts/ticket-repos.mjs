#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TICKET_BASE = 'C:\\repos\\ticket-work';
const SKIP = new Set(['install', 'build', 'baseline-head']);
const isRepo = d => existsSync(join(d, '.git'));

export function resolveTicketDir(arg, base = TICKET_BASE) {
  if (/[\\/]/.test(arg)) return existsSync(arg) ? resolve(arg) : null;
  const hit = readdirSync(base).find(n => n.toLowerCase() === arg.toLowerCase());
  return hit ? join(base, hit) : null;
}

export function ticketRepos(dir) {
  if (isRepo(dir)) return [dir];
  return readdirSync(dir)
    .filter(n => !n.startsWith('.') && !SKIP.has(n.toLowerCase()))
    .map(n => join(dir, n))
    .filter(p => {
      const st = lstatSync(p);
      return !st.isSymbolicLink() && st.isDirectory() && isRepo(p);
    });
}

export function ticketKeyOf(path) {
  const seg = path.split(/[\\/]/).find(s => /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(s));
  return seg ? seg.toUpperCase() : null;
}

export function repoSlug(remoteUrl) {
  const m = remoteUrl.trim().match(/^(?:git@bitbucket\.org:|ssh:\/\/git@bitbucket\.org\/|https:\/\/(?:[^@/]+@)?bitbucket\.org\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  return m ? m[1] : null;
}

// A bare prefix makes for-each-ref match every ref under it, nested release/x/y included; a "*"
// glob would stop at the first "/".
const BASE_REFS = ['refs/remotes/origin/master', 'refs/remotes/origin/main', 'refs/remotes/origin/develop', 'refs/remotes/origin/release'];

// origin/HEAD is wrong for branches cut from a release branch: pick the candidate the fewest
// commits behind HEAD, then the one whose merge-base is newest.
export function closestBase(repo) {
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const refs = git('for-each-ref', '--format=%(refname:short)', ...BASE_REFS).split('\n').filter(Boolean);
  const scored = [];
  for (const ref of refs) {
    let mergeBase;
    try { mergeBase = git('merge-base', 'HEAD', ref); } catch { continue; }
    scored.push({
      base: ref, mergeBase,
      ahead: Number(git('rev-list', '--count', `${mergeBase}..HEAD`)),
      behind: Number(git('rev-list', '--count', `${mergeBase}..${ref}`)),
    });
  }
  scored.sort((x, y) => x.ahead - y.ahead || x.behind - y.behind);
  return scored[0] ? { ...scored[0], runnersUp: scored.slice(1, 3).map(s => `${s.base} (+${s.ahead})`) } : null;
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase() && process.argv[2] === 'slug') {
  if (!process.argv[3]) { console.error('usage: ticket-repos.mjs slug <repo>'); process.exit(2); }
  const url = execFileSync('git', ['-C', process.argv[3], 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
  const slug = repoSlug(url);
  if (!slug) { console.error('ticket-repos.mjs: origin is not a bitbucket.org remote'); process.exit(1); }
  const [ws, repo] = slug.split('/');
  console.log(JSON.stringify({ ws, repo }));
} else if (invoked === fileURLToPath(import.meta.url).toLowerCase() && process.argv[2] === 'base') {
  if (!process.argv[3]) { console.error('usage: ticket-repos.mjs base <repo>'); process.exit(2); }
  const r = closestBase(process.argv[3]);
  if (!r) { console.error('ticket-repos.mjs: no origin/master|main|develop|release/* branch to compare against'); process.exit(1); }
  console.log(JSON.stringify(r, null, 2));
} else if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  const arg = process.argv[2];
  if (!arg) { console.error('usage: ticket-repos.mjs <ticket-key-or-path>'); process.exit(2); }
  const ticketDir = resolveTicketDir(arg);
  if (!ticketDir) { console.error(`ticket-repos.mjs: no ticket folder for ${arg} under ${TICKET_BASE}`); process.exit(1); }
  const repos = ticketRepos(ticketDir);
  if (!repos.length) { console.error(`ticket-repos.mjs: no git repos in ${ticketDir}`); process.exit(1); }
  console.log(JSON.stringify({ ticketDir, ticketKey: ticketKeyOf(ticketDir), repos }, null, 2));
}
