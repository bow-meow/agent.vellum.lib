#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDiff, stats } from './anchors.mjs';
import { BbError, findAccountId, findCreds, makeClient } from './bb.mjs';
import { progress, readModel } from './comment.mjs';
import { nativePath, posixPath, prEnv, shellQuote } from './env.mjs';
import { binarySqlPaths, textDiffs } from './sql-index-map.mjs';
import { loadState, splitComments, statePath } from './state.mjs';
import { closestBase, repoSlug, resolveTicketDir, ticketKeyOf, ticketRepos } from './ticket-repos.mjs';

export const DEFAULT_AR = '/c/repos/ai-review';
const NAME_RE = /^[A-Za-z0-9._-]+$/;

// A wrong base drags in every commit since the real fork point, which runs to tens of thousands of
// lines; the biggest genuine tickets reach a few thousand (the >1000 split exists for those).
export const SUSPICIOUS_CHANGED = 5000;

export class UserError extends Error {}

// env.sh and repos.json carry the Git Bash spelling the model sources; node and git.exe need the
// drive-letter one.
export const envVarName = name => String(name).replace(/[^A-Za-z0-9_]/g, '_');

export function parsePrUrl(url) {
  const m = String(url ?? '').match(/bitbucket\.org\/([^/]+)\/([^/]+)\/pull-requests\/([^/?#]+)/);
  if (!m) throw new UserError(`not a bitbucket.org pull request URL: ${url}`);
  const [, ws, repo, id] = m;
  if (!NAME_RE.test(ws) || !NAME_RE.test(repo)) throw new UserError(`workspace and repo must match ${NAME_RE}: ${url}`);
  if (!/^\d+$/.test(id)) throw new UserError(`pull request id must be numeric: ${url}`);
  return { ws, repo, id: Number(id) };
}

export function runGit(args, { ok = [0] } = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if (ok.includes(e.status) && typeof e.stdout === 'string') return e.stdout;
    const err = new Error(`git ${args.join(' ')}: ${String(e.stderr || e.message).trim()}`);
    err.stderr = String(e.stderr ?? '');
    throw err;
  }
}

const sqlTextDiff = (repo, base, head, diff) => textDiffs(repo, base, head, binarySqlPaths(diff));
const isDubious = e => /dubious ownership/i.test(`${e?.stderr ?? ''}\n${e?.message ?? ''}`);
const writeJson = (file, v) => writeFileSync(file, JSON.stringify(v, null, 2) + '\n');

// Prefix a git path token (quoted or not) with the repo, after its a/ or b/ when it has one.
function prefixToken(tok, repo, ab) {
  if (tok === '/dev/null') return tok;
  const q = tok.startsWith('"');
  const body = q ? tok.slice(1) : tok;
  const lead = ab && /^[ab]\//.test(body) ? body.slice(0, 2) : '';
  return `${q ? '"' : ''}${lead}${repo}/${body.slice(lead.length)}`;
}

function splitHeaderPaths(rest) {
  if (rest.startsWith('"')) {
    let i = 1;
    while (i < rest.length && rest[i] !== '"') i += rest[i] === '\\' ? 2 : 1;
    return [rest.slice(0, i + 1), rest.slice(i + 2)];
  }
  const q = rest.lastIndexOf(' "b/');
  if (q >= 0 && rest.endsWith('"')) return [rest.slice(0, q), rest.slice(q + 1)];
  const len = (rest.length - 5) / 2;
  if (Number.isInteger(len) && len > 0 && rest.slice(2 + len, 5 + len) === ' b/' && rest.slice(2, 2 + len) === rest.slice(5 + len))
    return [rest.slice(0, 2 + len), rest.slice(3 + len)];
  const i = rest.lastIndexOf(' b/');
  return i >= 0 ? [rest.slice(0, i), rest.slice(i + 1)] : [rest, ''];
}

// Reviewers see several repos in one diff, so each path names its repo. Hunk counters keep a
// removed "--- x" content line from being taken for a file header.
export function prefixDiff(text, repo) {
  let oldLeft = 0, newLeft = 0;
  const out = [];
  for (const line of text.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      const c = line[0];
      if (c === '+') newLeft--;
      else if (c === '-') oldLeft--;
      else if (c !== '\\') { oldLeft--; newLeft--; }
      out.push(line);
      continue;
    }
    let m;
    if (line.startsWith('diff --git ')) {
      const [a, b] = splitHeaderPaths(line.slice('diff --git '.length));
      out.push(`diff --git ${prefixToken(a, repo, true)} ${prefixToken(b, repo, true)}`);
    } else if ((m = line.match(/^(---|\+\+\+) ([^\t]*)(\t.*)?$/))) {
      out.push(`${m[1]} ${prefixToken(m[2], repo, true)}${m[3] ?? ''}`);
    } else if ((m = line.match(/^(rename from|rename to|copy from|copy to) (.*)$/))) {
      out.push(`${m[1]} ${prefixToken(m[2], repo, false)}`);
    } else if ((m = line.match(/^Binary files (.*) and (.*) differ$/))) {
      out.push(`Binary files ${prefixToken(m[1], repo, true)} and ${prefixToken(m[2], repo, true)} differ`);
    } else {
      if ((m = line.match(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/))) {
        oldLeft = m[1] === undefined ? 1 : +m[1];
        newLeft = m[2] === undefined ? 1 : +m[2];
      }
      out.push(line);
    }
  }
  return out.join('\n');
}

export function dryRunReasons({ requested, state, authorId, meId }) {
  const why = [];
  if (requested) why.push('--dry-run requested');
  if (state !== 'OPEN') why.push(`PR state is ${state}`);
  if (authorId && meId && authorId === meId) why.push('my own PR');
  return why;
}

export const myState = (pr, meId) =>
  (pr.participants ?? []).find(p => p.user?.account_id === meId)?.state ?? null;

export function isIncremental(statePrev, ours) {
  return statePrev !== null || ours.some(c => c.parent == null);
}

function meOrFail(bb) {
  return bb.me().catch(e => {
    if (e instanceof BbError && e.status === 401)
      throw new UserError('401 Unauthorized from Bitbucket: check BITBUCKET_USERNAME / BITBUCKET_PASSWORD');
    if (e instanceof BbError && e.status === 403)
      throw new UserError('403 from Bitbucket /user: the token lacks read:user; set BITBUCKET_ACCOUNT_ID to your Bitbucket account id');
    throw e;
  });
}

export async function preparePr({ ws, repo, id, ar = DEFAULT_AR, skill, dryRun = false }, deps = {}) {
  const { bb, git = runGit, textDiff = sqlTextDiff, stateFile = statePath } = deps;
  const AR = posixPath(ar);
  const W = `${AR}/.work/${ws}-${repo}-PR${id}`;
  const w = nativePath(W);
  const at = f => join(w, f);
  const notes = [];

  rmSync(w, { recursive: true, force: true });
  mkdirSync(w, { recursive: true });

  const prPath = `repositories/${ws}/${repo}/pullrequests/${id}`;
  const fetchPr = async () => {
    const pr = await bb.get(prPath);
    writeJson(at('pr.json'), pr);
    writeFileSync(at('env.sh'), prEnv(pr, { ws, repo, pr: id, ar: AR, skill }));
    return pr;
  };
  let pr = await fetchPr();
  const me = await meOrFail(bb);
  writeJson(at('me.json'), me);
  writeFileSync(at('bb.diff'), await bb.diff(ws, repo, id));
  const comments = await bb.get(`${prPath}/comments?pagelen=100&fields=%2Bvalues.resolution.user.account_id`);
  writeJson(at('comments.json'), comments);

  const authorId = pr.author?.account_id ?? null;
  const { ours, others, progress: stale } = splitComments(comments.values ?? [], me.account_id, authorId);
  writeJson(at('comments-ours.json'), ours);
  writeJson(at('comments-others.json'), others);
  writeJson(at('split-comments.json'), { ours: ours.length, others: others.length, staleProgress: stale });

  const statePrev = loadState(stateFile(ws, repo, id));
  writeJson(at('state-prev.json'), statePrev);

  const dest = pr.destination?.branch?.name;
  const srcHash = pr.source?.commit?.hash ?? '';
  const clone = `${AR}/${repo}`, wt = `${AR}/${repo}-PR${id}`;
  const c = nativePath(clone), t = nativePath(wt);
  if (!existsSync(join(c, '.git'))) git(['clone', '-q', `git@bitbucket.org:${ws}/${repo}.git`, c]);
  git(['-C', c, 'fetch', '-q', 'origin', dest]);
  git(['-C', c, 'fetch', '-q', `git@bitbucket.org:${pr.source?.repository?.full_name}.git`, pr.source?.branch?.name]);
  const head = git(['-C', c, 'rev-parse', 'FETCH_HEAD']).trim();
  git(['-C', c, 'worktree', 'prune']);
  if (existsSync(t)) {
    try { git(['-C', c, 'worktree', 'remove', '--force', t]); } catch { rmSync(t, { recursive: true, force: true }); }
    git(['-C', c, 'worktree', 'prune']);
  }
  git(['-C', c, 'worktree', 'add', '-q', '--detach', t, head]);
  const mb = git(['-C', t, 'merge-base', `origin/${dest}`, 'HEAD']).trim();
  const diff = git(['-C', t, 'diff', '-U40', mb, 'HEAD']);
  writeFileSync(at('context.diff'), diff + textDiff(t, mb, 'HEAD', diff));
  const headLines = `HEAD_SHA=${shellQuote(head)}\nMB=${shellQuote(mb)}\n`;
  appendFileSync(at('env.sh'), headLines);

  const headMoved = !head.startsWith(srcHash) || !srcHash;
  if (headMoved) {
    pr = await fetchPr();
    appendFileSync(at('env.sh'), headLines);
    writeFileSync(at('bb.diff'), await bb.diff(ws, repo, id));
    const now = pr.source?.commit?.hash ?? '';
    notes.push(now && head.startsWith(now)
      ? `branch moved since the PR was fetched; re-fetched pr.json, env.sh and bb.diff at ${head.slice(0, 12)}`
      : `branch moved since the PR was fetched and the re-fetched PR (${now || 'no hash'}) still differs from ${head.slice(0, 12)}`);
  }

  const state = pr.state;
  const mine = Boolean(authorId && authorId === me.account_id);
  const why = dryRunReasons({ requested: dryRun, state, authorId, meId: me.account_id });
  if (state !== 'OPEN') notes.push(`PR is ${state}: continue only if the user explicitly asked; treated as --dry-run`);
  if (mine) notes.push('this is my own PR, so nothing is posted: local mode (review <TICKET>) reviews my own work and pr-respond handles reviewer comments');

  const repos = {
    mode: 'pr', dryRun: why.length > 0,
    pr: {
      ws, repo, id, title: pr.title ?? '', state, authorId, mine, myState: myState(pr, me.account_id),
      url: pr.links?.html?.href ?? `https://bitbucket.org/${ws}/${repo}/pull-requests/${id}`,
    },
    ticketKey: null, ticketDir: null,
    repos: [{ name: repo, ws, repo, clone, wt, dest, mb, head, diff: `${W}/context.diff` }],
  };
  writeJson(at('repos.json'), repos);

  return {
    w: W, env: `${W}/env.sh`, dryRun: repos.dryRun, dryRunWhy: why.length ? why.join('; ') : null,
    staleProgress: stale, incremental: isIncremental(statePrev, ours), headMoved, notes,
  };
}

export async function postProgress(W, deps = {}) {
  const { bb, model = () => readModel(), now = new Date() } = deps;
  const w = nativePath(posixPath(W));
  const at = f => join(w, f);
  const { dryRun, pr } = JSON.parse(readFileSync(at('repos.json'), 'utf8'));
  if (dryRun) return { posted: null, deleted: [], skipped: 'dryRun', notes: [] };
  const notes = [], deleted = [];
  let stale = [];
  try { stale = JSON.parse(readFileSync(at('split-comments.json'), 'utf8')).staleProgress ?? []; } catch { }
  for (const cid of stale) {
    try { await bb.remove(pr.ws, pr.repo, pr.id, cid); deleted.push(cid); }
    catch (e) { notes.push(`couldn't delete stale progress notice ${cid}: ${e.message.split('\n')[0]}`); }
  }
  let joke = '';
  try { joke = readFileSync(at('joke.txt'), 'utf8'); } catch { }
  const body = progress({ model: model(), joke, at: now });
  writeFileSync(at('body-progress.txt'), body);
  try {
    const r = await bb.general(pr.ws, pr.repo, pr.id, body);
    appendFileSync(at('env.sh'), `PROGRESS_ID=${shellQuote(r.id)}\n`);
    return { posted: r.id, link: r.links?.html?.href ?? null, deleted, notes };
  } catch (e) {
    notes.push(`in-progress notice not posted: ${e.message.split('\n')[0]}`);
    return { posted: null, deleted, notes };
  }
}

const stripOrigin = b => String(b).replace(/^origin\//, '');

export function chooseDest({ branch, prs = [], override = null, closest = null }) {
  if (override) return { dest: stripOrigin(override), base: `origin/${stripOrigin(override)}`, from: 'user', runnersUp: [] };
  const hit = prs.find(p => (p.source?.branch?.name ?? p.source) === branch);
  if (hit) {
    const dest = hit.destination?.branch?.name ?? hit.destination;
    return { dest, base: `origin/${dest}`, from: 'pr', prId: hit.id, runnersUp: [] };
  }
  if (closest) return { dest: stripOrigin(closest.base), base: closest.base, from: 'closest', runnersUp: closest.runnersUp ?? [] };
  return null;
}

export function localRepoDiff(R, mb, { git = runGit, textDiff = sqlTextDiff } = {}) {
  let diff = git(['-C', R, 'diff', '-U40', mb]);
  const untracked = git(['-C', R, 'ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  for (const f of untracked) diff += git(['-C', R, 'diff', '--no-index', '-U40', '--', '/dev/null', f], { ok: [0, 1] });
  return diff + textDiff(R, mb, null, diff);
}

export async function prepareLocal(arg, { ar = DEFAULT_AR, skill, bases = {} } = {}, deps = {}) {
  const { bb, git = runGit, textDiff = sqlTextDiff, closest = closestBase, ticketBase } = deps;
  const ticketDir = ticketBase ? resolveTicketDir(arg, ticketBase) : resolveTicketDir(arg);
  if (!ticketDir) throw new UserError(`no ticket folder for ${arg}`);
  const ticketKey = ticketKeyOf(ticketDir);
  if (!ticketKey) throw new UserError(`no ticket key (like SYM-1234) in ${ticketDir}`);
  const paths = ticketRepos(ticketDir);
  if (!paths.length) throw new UserError(`no git repos in ${ticketDir}`);

  const AR = posixPath(ar);
  const W = `${AR}/.work/local-${ticketKey}`;
  const w = nativePath(W);
  const TD = posixPath(ticketDir);
  // A previous run's candidates, verdicts and coverage counts would be read as this run's.
  rmSync(w, { recursive: true, force: true });
  mkdirSync(w, { recursive: true });
  const envFile = join(w, 'env.sh');
  writeFileSync(envFile, Object.entries({ S: skill, AR, W, TICKET_KEY: ticketKey, TICKET_DIR: TD })
    .map(([k, v]) => `${k}=${shellQuote(v)}`).join('\n') + '\n');
  const findings = join(ticketDir, 'review-findings.json');
  if (existsSync(findings)) renameSync(findings, join(ticketDir, 'review-findings.prev.json'));

  const notes = [], asks = [], out = [], entries = [];
  let combined = '', total = 0;
  for (const R of paths) {
    const name = basename(R);
    try {
      const branch = git(['-C', R, 'rev-parse', '--abbrev-ref', 'HEAD']).trim();
      let slug = null;
      try { slug = repoSlug(git(['-C', R, 'remote', 'get-url', 'origin'])); } catch (e) { if (isDubious(e)) throw e; }
      const [ws, repo] = slug ? slug.split('/') : [null, null];
      let prs = [];
      if (!bases[name] && slug && branch !== 'HEAD' && bb) {
        try { prs = (await bb.searchPrs(ws, repo, branch, ['OPEN'])).values ?? []; }
        catch (e) { notes.push(`${name}: open-PR lookup failed, using the closest base: ${e.message.split('\n')[0]}`); }
      }
      if (!slug) notes.push(`${name}: origin is not a bitbucket.org remote; no open-PR lookup`);
      const pick = chooseDest({ branch, prs, override: bases[name] })
        ?? chooseDest({ branch, closest: closest(R) });
      if (!pick) { asks.push({ ask: 'base', repo: name, runnersUp: [] }); continue; }

      git(['-C', R, 'fetch', '-q', 'origin', pick.dest]);
      const mb = git(['-C', R, 'merge-base', 'HEAD', `origin/${pick.dest}`]).trim();
      const diff = localRepoDiff(R, mb, { git, textDiff });
      writeFileSync(join(w, `${name}.diff`), diff);
      const changed = stats(parseDiff(diff)).changed;
      total += changed;
      if (diff) combined += prefixDiff(diff, name).replace(/\n?$/, '\n');

      const v = envVarName(name), RP = posixPath(R);
      appendFileSync(envFile, `R_${v}=${shellQuote(RP)}\nDEST_${v}=${shellQuote(pick.dest)}\nMB_${v}=${shellQuote(mb)}\n`);
      entries.push({ name, ws, repo, clone: RP, wt: RP, dest: pick.dest, mb, head: null, diff: `${W}/${name}.diff` });
      out.push({ name, dest: pick.dest, base: pick.base, from: pick.from, ...(pick.prId ? { prId: pick.prId } : {}), runnersUp: pick.runnersUp, changed });
    } catch (e) {
      if (!isDubious(e)) throw e;
      notes.push(`${name}: skipped, git reports "dubious ownership" for ${R}; not adding safe.directory, fix the folder's owner or review it by hand`);
    }
  }
  writeFileSync(join(w, 'context.diff'), combined);
  writeJson(join(w, 'repos.json'), { mode: 'local', dryRun: false, pr: null, ticketKey, ticketDir: TD, repos: entries });
  const suspicious = total > SUSPICIOUS_CHANGED;
  if (suspicious) notes.push(`${total} changed lines is far more than one ticket: the base is probably wrong, check before reviewing`);
  return { w: W, env: `${W}/env.sh`, ticketKey, repos: out, asks, notes, suspicious };
}

const ownSkillDir = () => posixPath(dirname(dirname(fileURLToPath(import.meta.url))));

const USAGE = `usage:
  prepare.mjs pr <bitbucket PR url> [--dry-run] [--ar <ai-review root>]
  prepare.mjs progress <W>
  prepare.mjs local <ticket key or path> [--base <repo>=<branch>]... [--ar <ai-review root>]`;

export function parseArgs(argv) {
  const a = [...argv];
  const opts = { ar: DEFAULT_AR, dryRun: false, bases: {} };
  const pos = [];
  while (a.length) {
    const x = a.shift();
    if (x === '--dry-run') opts.dryRun = true;
    else if (x === '--ar') { opts.ar = a.shift(); if (!opts.ar) throw new UserError('--ar needs a path'); }
    else if (x === '--base') {
      const m = String(a.shift() ?? '').match(/^([^=]+)=(.+)$/);
      if (!m) throw new UserError('--base takes <repo>=<branch>');
      opts.bases[m[1]] = m[2];
    } else if (x.startsWith('--')) throw new UserError(`unknown option ${x}`);
    else pos.push(x);
  }
  const [cmd, target, ...extra] = pos;
  if (!['pr', 'progress', 'local'].includes(cmd) || !target || extra.length) throw new UserError('wrong arguments');
  return { cmd, target, ...opts };
}

function client() {
  const creds = findCreds();
  if (!creds) throw new UserError('set BITBUCKET_USERNAME and BITBUCKET_PASSWORD (or configure the bitbucket MCP in ~/.claude.json)');
  return makeClient({ creds, accountId: findAccountId() });
}

async function main(argv) {
  let args;
  try { args = parseArgs(argv); }
  catch (e) { console.error(`prepare.mjs: ${e.message}\n${USAGE}`); process.exit(2); }
  if (args.cmd === 'pr') {
    try { parsePrUrl(args.target); }
    catch (e) { console.error(`prepare.mjs: ${e.message}\n${USAGE}`); process.exit(2); }
  }
  try {
    let out;
    if (args.cmd === 'pr') out = await preparePr({ ...parsePrUrl(args.target), ar: args.ar, skill: ownSkillDir(), dryRun: args.dryRun }, { bb: client() });
    else if (args.cmd === 'progress') out = await postProgress(args.target, { bb: client() });
    else {
      let bb = null;
      try { bb = client(); } catch (e) { console.error(`prepare.mjs: ${e.message}; choosing bases without the open-PR lookup`); }
      out = await prepareLocal(args.target, { ar: args.ar, skill: ownSkillDir(), bases: args.bases }, { bb });
    }
    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    console.error(`prepare.mjs: ${e.message}`);
    process.exit(1);
  }
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) await main(process.argv.slice(2));
