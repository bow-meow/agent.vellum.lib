#!/usr/bin/env node
// Creates a ticket's git worktrees, one per repo, all on one branch — non-interactively, so the
// orchestrator can run it without a console:
//
//   node mk-worktree.mjs <TICKET> <slug> --repo <clone>[=<base>] [--repo ...]
//                        [--root C:\repos\ticket-work] [--prefix akt] [--dry-run]
//
// Each worktree lands at <root>\<TICKET>\<basename of clone> on branch <prefix>/<TICKET>_<slug>.
// A base left off defaults to the clone's origin/HEAD; pass it explicitly for repos with no stable
// default. Nothing is created until every base resolves, and a failure part-way through rolls back
// what this run made, so a fixed re-run is never blocked by leftovers.
//
// Exit codes: 0 created; 1 bad arguments or a base that won't resolve; 2 git failed (rolled back);
// 3 the ticket dir or branch already exists — ask the user build-on vs start-fresh, never clobber.
// The last stdout line is always a JSON summary.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TICKET_RE = /^[A-Z][A-Z0-9]+-\d+$/;
export const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class ExitError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function git(clone, args) {
  return execFileSync('git', ['-C', clone, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function tryGit(clone, args) {
  try {
    return { ok: true, out: git(clone, args) };
  } catch (e) {
    return { ok: false, out: String(e.stderr || e.message).trim() };
  }
}

export function parseArgs(argv) {
  const opts = { ticket: null, slug: null, repos: [], root: 'C:\\repos\\ticket-work', prefix: 'akt', dryRun: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new ExitError(1, `${a} needs a value`);
      return argv[++i];
    };
    if (a === '--repo') {
      const spec = value();
      // Split on the first '=' after the drive letter so C:\repos\x=origin/main parses.
      const eq = spec.indexOf('=', 2);
      opts.repos.push(eq === -1 ? { clone: spec, base: '' } : { clone: spec.slice(0, eq), base: spec.slice(eq + 1) });
    } else if (a === '--root') opts.root = value();
    else if (a === '--prefix') opts.prefix = value();
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a.startsWith('--')) throw new ExitError(1, `unknown flag ${a}`);
    else positional.push(a);
  }
  [opts.ticket, opts.slug] = positional;
  if (!opts.ticket || !opts.slug || positional.length > 2) {
    throw new ExitError(1, 'usage: mk-worktree.mjs <TICKET> <slug> --repo <clone>[=<base>] [--repo ...] [--root <dir>] [--prefix <p>] [--dry-run]');
  }
  if (!TICKET_RE.test(opts.ticket)) throw new ExitError(1, `ticket must match ${TICKET_RE} (got '${opts.ticket}')`);
  if (!SLUG_RE.test(opts.slug)) throw new ExitError(1, `slug must match ${SLUG_RE} (got '${opts.slug}')`);
  if (opts.repos.length === 0) throw new ExitError(1, 'at least one --repo is required');
  return opts;
}

export function defaultBase(clone) {
  const r = tryGit(clone, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (!r.ok || !r.out) {
    throw new ExitError(1, `${clone}: no origin/HEAD to default to — pass the base explicitly (--repo ${clone}=<base>)`);
  }
  return r.out;
}

export function plan(opts) {
  const ticketDir = join(resolve(opts.root), opts.ticket);
  const branch = `${opts.prefix}/${opts.ticket}_${opts.slug}`;
  const repos = opts.repos.map(({ clone, base }) => {
    const abs = resolve(clone);
    if (!tryGit(abs, ['rev-parse', '--git-dir']).ok) throw new ExitError(1, `${abs} is not a git clone`);
    return { clone: abs, base, dir: basename(abs) };
  });
  const dirs = repos.map((r) => r.dir.toLowerCase());
  const dup = dirs.find((d, i) => dirs.indexOf(d) !== i);
  if (dup) throw new ExitError(1, `two repos would share the worktree dir '${dup}'`);

  const existing = [];
  if (existsSync(ticketDir)) existing.push(`ticket dir ${ticketDir}`);
  for (const r of repos) {
    if (tryGit(r.clone, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok) {
      existing.push(`branch ${branch} in ${r.clone}`);
    }
  }
  if (existing.length) throw new ExitError(3, `already exists: ${existing.join('; ')}`);

  // Fetch before resolving so a base named on a just-pushed remote branch is found; a failed fetch
  // (offline) only matters if the base then doesn't resolve, which is checked next.
  for (const r of repos) {
    const f = tryGit(r.clone, ['fetch', '--quiet']);
    if (!f.ok) console.log(`warning: fetch failed in ${r.clone}: ${f.out}`);
  }
  for (const r of repos) {
    r.base ||= defaultBase(r.clone);
    if (!tryGit(r.clone, ['rev-parse', '--verify', '--quiet', `${r.base}^{commit}`]).ok) {
      throw new ExitError(1, `${r.clone}: base '${r.base}' does not resolve to a commit`);
    }
    r.path = join(ticketDir, r.dir);
  }
  return { ticket: opts.ticket, branch, ticketDir, repos };
}

export function create(p) {
  const made = [];
  for (const r of p.repos) {
    const res = tryGit(r.clone, ['worktree', 'add', '--no-track', '-b', p.branch, r.path, r.base]);
    if (!res.ok) {
      // Everything in `made` was created by this run, so it is safe to delete outright.
      for (const m of made) {
        tryGit(m.clone, ['worktree', 'remove', '--force', m.path]);
        tryGit(m.clone, ['worktree', 'prune']);
        tryGit(m.clone, ['branch', '-D', p.branch]);
      }
      if (existsSync(p.ticketDir) && readdirSync(p.ticketDir).length === 0) rmSync(p.ticketDir, { recursive: true });
      throw new ExitError(2, `${r.clone}: worktree add failed, rolled back ${made.length} worktree(s): ${res.out}`);
    }
    made.push(r);
  }
  return made;
}

export function main(argv) {
  let summary;
  let code = 0;
  try {
    const opts = parseArgs(argv);
    const p = plan(opts);
    console.log(`${opts.dryRun ? 'Would create' : 'Creating'} ${p.ticket} worktrees on ${p.branch}:`);
    for (const r of p.repos) console.log(`  ${r.path} <- ${r.base}`);
    if (!opts.dryRun) create(p);
    summary = {
      ok: true,
      dryRun: opts.dryRun,
      ticket: p.ticket,
      branch: p.branch,
      ticketDir: p.ticketDir,
      worktrees: p.repos.map(({ clone, base, path }) => ({ clone, base, path })),
    };
  } catch (e) {
    if (!(e instanceof ExitError)) throw e;
    code = e.code;
    console.log(`error: ${e.message}`);
    summary = { ok: false, code, error: e.message };
  }
  console.log(JSON.stringify(summary));
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
