#!/usr/bin/env node
// Read-only worktrees of other repos, for reviewers whose findings depend on code outside the
// reviewed repo. Usage: see USAGE.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ALLOWED = [
  'amag-engineering/symmetryclassic', 'amag-engineering/esg-ng-core-linux',
  'amag-engineering/esg-ng-core-m33', 'amag-engineering/esg-ng-ipc',
  'amag-engineering/amag.symmetry.nats', 'amag-engineering/natscodegen',
];

// The branch of each repo that matches what ships with the reviewed release, when no sibling PR
// says otherwise. 'same-as-dest' repos cut release branches named like symmetryclassic's; the
// firmware repos ship from main. Anything not listed, or a rule whose branch is missing, is asked.
export const REF_RULES = {
  'amag.symmetry.nats': 'same-as-dest',
  'esg-ng-core-linux': 'main',
  'esg-ng-core-m33': 'main',
  'esg-ng-ipc': 'main',
  'natscodegen': 'ask',
};

export const CAP = 3;

// Refs come from PR branch names and agent output, and reach git's command line.
export function validRef(ref) {
  return typeof ref === 'string' && /^[A-Za-z0-9._\/-]+$/.test(ref) && !ref.startsWith('-')
    && !ref.includes('..') && !ref.includes('//') && !ref.endsWith('/') && !ref.endsWith('.lock');
}

export function slugOf(repo) {
  const name = String(repo ?? '').trim().replace(/^.*\//, '');
  return ALLOWED.find(s => s.endsWith('/' + name)) ?? null;
}

export function repoFromLink(link) {
  const m = String(link ?? '').match(/bitbucket\.org\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/pull-requests\/\d+/);
  return m ? `${m[1]}/${m[2]}` : null;
}

export function headOptions(heads) {
  const keep = heads.filter(h => /^(main|master)$|^(release|template)\//.test(h));
  const rank = h => (/^(main|master)$/.test(h) ? 0 : 1);
  const ver = h => (h.match(/\d+/g) ?? []).map(Number);
  return keep.sort((a, b) => rank(a) - rank(b) || cmpDesc(ver(a), ver(b)) || a.localeCompare(b));
}

function cmpDesc(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (b[i] ?? -1) - (a[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

export function resolveRef(repoName, dest, heads) {
  const rule = REF_RULES[repoName] ?? 'ask';
  const ask = why => ({ kind: 'ask', why, options: headOptions(heads) });
  if (rule === 'same-as-dest') {
    if (!dest) return ask('no destination branch to match');
    return heads.includes(dest) ? { ref: dest, kind: 'release-match' } : ask(`no ${dest} branch`);
  }
  if (rule === 'ask') return ask('no branch rule for this repo');
  return heads.includes(rule) ? { ref: rule, kind: 'rule' } : ask(`no ${rule} branch`);
}

export function planFromSiblings(siblings, have = []) {
  const out = [];
  for (const s of siblings) {
    const slug = slugOf(repoFromLink(s.link) ?? s.repo);
    if (!slug || have.includes(slug) || out.some(o => o.slug === slug)) continue;
    if (!validRef(s.source)) { out.push({ slug, kind: 'invalid', why: `sibling PR #${s.id} has an unusable branch name` }); continue; }
    out.push({ slug, ref: s.source, kind: 'sibling-pr', why: `sibling PR #${s.id}` });
  }
  return out;
}

// needs-<agent>.done.json files were handled by an earlier round.
export function pendingNeeds(names) {
  return names.map(f => f.match(/^needs-(.+)\.json$/)).filter(m => m && !m[1].endsWith('.done')).map(m => ({ file: m[0], agent: m[1] }));
}

// Merges the agents' needs-<agent>.json files into one request per repo.
export function collectNeeds(files, have = []) {
  const byRepo = new Map();
  const rejected = [];
  for (const { agent, entries } of files) {
    for (const e of Array.isArray(entries) ? entries : []) {
      const slug = slugOf(e?.repo);
      if (!slug) { rejected.push({ agent, repo: e?.repo ?? null, why: 'not in SIBLING_REPOS' }); continue; }
      if (have.includes(slug)) { rejected.push({ agent, repo: slug, why: 'already in REPOS' }); continue; }
      if (!byRepo.has(slug)) byRepo.set(slug, { slug, asks: [] });
      byRepo.get(slug).asks.push({ agent, question: String(e.question ?? '').slice(0, 400), candidates: Array.isArray(e.candidates) ? e.candidates.map(String) : [] });
    }
  }
  return { requests: [...byRepo.values()], rejected };
}

export const keyOf = w => basename(resolve(w));
export const arOf = w => dirname(dirname(resolve(w)));
export const worktreePath = (ar, slug, key) => join(ar, `${slug.split('/')[1]}-x-${key}`);
const ledgerPath = w => join(w, 'xrepo.json');

export function readLedger(w) {
  try { return JSON.parse(readFileSync(ledgerPath(w), 'utf8')); } catch { return []; }
}

const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000, ...opts }).trim();
const sshUrl = slug => `git@bitbucket.org:${slug}.git`;

export function lsHeads(url) {
  return git(['ls-remote', '--heads', url]).split(/\r?\n/).map(l => l.split('refs/heads/')[1]).filter(Boolean);
}

export function addWorktree(w, slug, ref, kind, why, { url = sshUrl(slug) } = {}) {
  if (!ALLOWED.includes(slug)) throw new Error(`${slug} is not in SIBLING_REPOS`);
  if (!validRef(ref)) throw new Error(`unusable ref ${JSON.stringify(ref)}`);
  const ledger = readLedger(w);
  const existing = ledger.find(r => r.slug === slug);
  if (existing) return { ...existing, reused: true };
  if (ledger.length >= CAP) throw new Error(`cap of ${CAP} other repos reached`);
  const ar = arOf(w);
  const clone = join(ar, slug.split('/')[1]);
  if (!existsSync(join(clone, '.git'))) git(['clone', '-q', '--no-checkout', url, clone]);
  git(['-C', clone, 'fetch', '-q', url, `refs/heads/${ref}`]);
  const sha = git(['-C', clone, 'rev-parse', 'FETCH_HEAD']);
  const path = worktreePath(ar, slug, keyOf(w));
  git(['-C', clone, 'worktree', 'prune']);
  if (existsSync(path)) {
    try { git(['-C', clone, 'worktree', 'remove', '--force', path]); } catch { rmSync(path, { recursive: true, force: true }); }
    git(['-C', clone, 'worktree', 'prune']);
  }
  git(['-C', clone, 'worktree', 'add', '-q', '--detach', path, sha]);
  const rec = { slug, repo: slug.split('/')[1], ref, sha, kind, why: why ?? '', path, clone };
  writeFileSync(ledgerPath(w), JSON.stringify([...ledger, rec], null, 2));
  return rec;
}

export function cleanup(w) {
  const done = [];
  for (const r of readLedger(w)) {
    try { git(['-C', r.clone, 'worktree', 'remove', '--force', r.path]); }
    catch { rmSync(r.path, { recursive: true, force: true }); try { git(['-C', r.clone, 'worktree', 'prune']); } catch { /* clone gone */ } }
    done.push(r.path);
  }
  rmSync(ledgerPath(w), { force: true });
  return done;
}

export function reposLines(w) {
  return readLedger(w).map(r => `${r.repo}@${r.sha.slice(0, 8)} (${r.kind}: ${r.ref}; read-only context, not under review): ${r.path}`);
}

const USAGE = `usage:
  xrepo.mjs plan <W> <siblings.json> [--have <slug,...>]        sibling-PR repos to add
  xrepo.mjs needs <W> [--dest <branch>] [--have <slug,...>]     agents' repo requests, each with a ref or 'ask' + options
  xrepo.mjs add <W> <ws/repo> <ref> <kind> [--why <text>]       clone if needed, fetch, worktree; appends to <W>/xrepo.json
  xrepo.mjs repos <W>                                           REPOS slot lines for the added worktrees
  xrepo.mjs cleanup <W>                                         remove every worktree in <W>/xrepo.json`;

function opt(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

function main(argv) {
  const args = [...argv];
  const cmd = args.shift();
  const have = (opt(args, '--have') ?? '').split(',').map(slugOf).filter(Boolean);
  const dest = opt(args, '--dest');
  const why = opt(args, '--why');
  const w = args[0];
  if (!cmd || !w) { console.error(USAGE); process.exit(2); }
  const haveAll = [...have, ...readLedger(w).map(r => r.slug)];
  switch (cmd) {
    case 'plan': {
      const sib = JSON.parse(readFileSync(args[1], 'utf8'));
      return planFromSiblings(Array.isArray(sib) ? sib : [], haveAll);
    }
    case 'needs': {
      const files = pendingNeeds(readdirSync(w)).map(({ file, agent }) => {
        let entries = [];
        try { entries = JSON.parse(readFileSync(join(w, file), 'utf8')); } catch { /* unreadable → no requests */ }
        return { agent, entries };
      });
      const { requests, rejected } = collectNeeds(files, haveAll);
      let room = CAP - readLedger(w).length;
      const out = requests.map(r => {
        if (room <= 0) return { ...r, kind: 'over-cap' };
        room--;
        try { return { ...r, ...resolveRef(r.slug.split('/')[1], dest, lsHeads(sshUrl(r.slug))) }; }
        catch (e) { return { ...r, kind: 'error', why: String(e.stderr || e.message).trim().split(/\r?\n/).pop() }; }
      });
      return { requests: out, rejected };
    }
    case 'add': {
      const [, slug, ref, kind] = args;
      if (!slug || !ref || !kind) { console.error(USAGE); process.exit(2); }
      try { return addWorktree(w, slugOf(slug) ?? slug, ref, kind, why); }
      catch (e) { console.log(JSON.stringify({ slug, ref, error: String(e.stderr || e.message).trim().split(/\r?\n/).pop() })); process.exit(1); }
    }
    case 'repos': return reposLines(w).join('\n');
    case 'cleanup': return cleanup(w);
    default: console.error(USAGE); process.exit(2);
  }
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  const r = main(process.argv.slice(2));
  console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 2));
}
