#!/usr/bin/env node
// Fills the reviewer, verify, recheck and fix-review prompts from the work dir, and does the
// after-dispatch mechanics: coverage rounds, repo requests, token usage. Usage: see USAGE.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDiff, splitDiff, stats } from './anchors.mjs';
import { changedRuns, uncovered } from './coverage.mjs';
import { nativePath } from './env.mjs';
import { contested } from './recheck.mjs';
import { pendingNeeds, reposLines, slugOf } from './xrepo.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const OWN_SKILL_DIR = dirname(HERE);

export const SMALL = 200;
export const LARGE = 1000;
export const CHUNK_SIZE = 800;
export const STYLES_REVIEWER_MIN = 100;
export const MAX_ROUNDS = 2;
export const DOCS_ONLY = '\\.(md|markdown|txt|rst|adoc|resx)$';

export const CHECKLISTS = {
  combined: ['correctness', 'regression', 'concurrency-races', 'resources-performance', 'sql', 'security', 'tests-history', 'design-quality', 'docs'],
  'tests-design': ['tests-history', 'design-quality'],
  styles: [],
};
const dimensionsOf = r => CHECKLISTS[r] ?? [r];

const NO_COVERAGE = new Set(['ticket-fit', 'claims', 'styles']);

export const EXTRA_RULES = {
  'ticket-fit': 'Uncertain coverage goes in with terminal_only: true.',
  claims: 'Your units are the facts in the PR description and the ticket, not the diff. Write one ledger entry per text (path "PR description" or "ticket", side "new", from/to 0) whose checked lists each fact as: fact → holds | doesn\'t hold: <the code\'s worst case>. Each fact that doesn\'t hold is also a candidate, at the code that decides it.',
  styles: 'Your scope is the changed stylesheets and the template classes they style or that no stylesheet styles; read other files only as context.',
};

const LANGUAGE_EXT = [
  [/\.(cs|csproj|sln)$/i, 'csharp-dotnet'],
  [/\.(cpp|cc|h|hpp|c)$/i, 'cpp-embedded'],
  [/\.go$/i, 'go'],
  [/\.(ts|tsx|html)$/i, 'typescript-angular'],
  [/\.(scss|css|sass|less)$/i, 'stylesheets'],
];

// Git Bash hands node "C:/x" for "/c/x" arguments, but paths inside JSON files keep the MSYS form,
// which node on Windows would read as "C:\c\x".
export const winPath = p => String(p).replace(/^\/([A-Za-z])(?=\/|$)/, (_, d) => `${d.toUpperCase()}:`).replace(/\//g, '\\');
const trimDir = p => String(p).replace(/[\\/]+$/, '');

export function fill(template, values) {
  const missing = new Set();
  const out = template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
    const v = values[k];
    if (v === undefined || v === null) { missing.add(k); return m; }
    return String(v);
  });
  if (missing.size) throw new Error(`unfilled slot(s): ${[...missing].join(', ')}`);
  return out;
}

export function roster({ changed, ticket, prDescription, sql, styles }, chunks = 0) {
  const once = [ticket && 'ticket-fit', (prDescription || ticket) && 'claims'];
  if (changed < SMALL) return ['combined', ...once].filter(Boolean).map(reviewer => ({ reviewer, chunk: null }));
  const perChunk = ['correctness', 'regression', 'concurrency-races', 'resources-performance', sql && 'sql', 'tests-design', 'security'].filter(Boolean);
  once.push('docs', (styles ?? 0) >= STYLES_REVIEWER_MIN && 'styles');
  const single = once.filter(Boolean).map(reviewer => ({ reviewer, chunk: null }));
  if (changed <= LARGE) return [...perChunk.map(reviewer => ({ reviewer, chunk: null })), ...single];
  const out = [];
  for (let n = 1; n <= chunks; n++) for (const reviewer of perChunk) out.push({ reviewer, chunk: n });
  return [...out, ...single];
}

export const agentName = ({ reviewer, chunk }) => (chunk ? `${reviewer}-${chunk}` : reviewer);

export function checklistFiles(reviewer, { skillDir, languages = [], styles = 0 }) {
  const ref = (...p) => winPath(join(skillDir, 'references', ...p));
  const files = dimensionsOf(reviewer).map(d => ref('dimensions', `${d}.md`));
  if (reviewer === 'styles' || (reviewer === 'combined' && styles > 0)) files.push(ref('languages', 'stylesheets.md'));
  for (const l of languages) if (l !== 'stylesheets') files.push(ref('languages', `${l}.md`));
  return files;
}

export function languagesOf(paths) {
  const out = [];
  for (const p of paths) {
    const hit = LANGUAGE_EXT.find(([re]) => re.test(p));
    if (hit && !out.includes(hit[1])) out.push(hit[1]);
  }
  return out;
}

export function extraMaterial(reviewer, { sql, material: m }) {
  const parts = [];
  const list = xs => xs.join(', ');
  if (reviewer === 'ticket-fit' && m.siblings) parts.push(`Sibling PRs: ${m.siblings}`);
  if ((reviewer === 'sql' || (reviewer === 'combined' && sql)) && m.indexMaps.length) parts.push(`Index maps: ${list(m.indexMaps)}`);
  if (['sql', 'correctness', 'combined'].includes(reviewer) && m.forward.length) parts.push(`Forward-scan: ${list(m.forward)}`);
  if (['combined', 'tests-design'].includes(reviewer)) {
    if (m.history) parts.push(`History file: ${m.history}`);
    if (m.commits) parts.push(`Commit messages: ${m.commits}`);
  }
  if (['styles', 'combined'].includes(reviewer) && m.stylesFacts.length)
    parts.push(`Stylesheet facts (leads to confirm, not findings): ${list(m.stylesFacts)}`);
  return parts.join('; ') || 'none';
}

export function repoLines(repos, depsByRepo = {}, xrepoLines = []) {
  const lines = repos.map(r => `${r.name}: ${winPath(r.wt)}`);
  for (const r of repos) {
    for (const p of depsByRepo[r.name] ?? []) {
      if (!p || p.error) continue;
      if (p.local) lines.push(`${p.name} (in ${r.name}, imported by the changed code): ${winPath(`${r.wt}/${p.local}`)}`);
      else if (p.path) lines.push(`${p.name}@${p.version} (published package, read-only; original source under src/): ${p.path}`);
    }
  }
  return [...lines, ...xrepoLines];
}

export const formatLines = lines => (lines.length === 1 ? lines[0] : lines.map(l => `\n  - ${l}`).join(''));

const oneLine = s => String(s).trim().replace(/\s*\r?\n\s*/g, ' ');

// env: what the work dir holds, already resolved to slot text (see loadWork).
export function reviewerSlots({ reviewer, chunk, diffFile }, env) {
  const agent = agentName({ reviewer, chunk });
  const blind = reviewer === 'regression';
  const mode = env.mode === 'pr'
    ? (blind ? `PR mode (#${env.pr.id})` : `PR mode (#${env.pr.id}: ${env.pr.title})`)
      + (env.reReview ? ', re-review: the diff holds only what changed since the last review; read around it in the worktree' : '')
    : `local mode (${env.ticketKey}, uncommitted changes included)`;
  return {
    REVIEWER: reviewer,
    SKILL_DIR: winPath(env.skillDir),
    ID_START: chunk ? `${chunk}01` : '1',
    CHECKLIST_FILES: existing(checklistFiles(reviewer, env)),
    MODE: mode,
    REPOS: env.repos,
    NEEDS_FILE: `${env.w}/needs-${agent}.json`,
    TICKET_SUMMARY: blind ? 'none' : env.ticketSummary,
    TICKET_FILE: blind ? 'none' : env.ticketFile,
    PR_DESCRIPTION_FILE: blind ? 'none' : env.prDescriptionFile,
    DIFF_FILE: winPath(diffFile),
    OUT_FILE: `${env.w}/cand-${agent}.json`,
    COVERAGE_FILE: `${env.w}/cov-${agent}.json`,
    EXTRA_MATERIAL: extraMaterial(reviewer, env),
    EXTRA_RULES: EXTRA_RULES[reviewer] ?? 'none',
  };
}

export function coverageOf(reviewer) {
  if (NO_COVERAGE.has(reviewer)) return { coverage: 'skip', only: null };
  return { coverage: 'check', only: reviewer === 'docs' ? DOCS_ONLY : null };
}

// A failing check before any send-back is round 0; the check after the second send-back is the last.
export function coverageStep(failures, missing) {
  if (!missing.length) return { failures, result: { ok: true, missing: [] } };
  const n = failures + 1;
  if (n > MAX_ROUNDS) return { failures: n, result: { uncovered: true, missing } };
  return { failures: n, result: { ok: false, missing, round: n } };
}

export function nothingToVerify(candidates, hasPreviousRecheck) {
  return !hasPreviousRecheck && candidates.every(c => Array.isArray(c) && c.length === 0);
}

export function addUsage(usage, key, tokens) {
  return { ...usage, [key]: (Number(usage[key]) || 0) + tokens };
}

export function findHumanizer(pluginsDir) {
  const skill = p => join(p, 'skills', 'humanizer', 'SKILL.md');
  try {
    const installed = JSON.parse(readFileSync(join(pluginsDir, 'installed_plugins.json'), 'utf8')).plugins ?? {};
    for (const [k, list] of Object.entries(installed)) {
      if (!k.startsWith('humanizer@')) continue;
      for (const e of list ?? []) if (e?.installPath && existsSync(skill(e.installPath))) return skill(e.installPath);
    }
  } catch { /* no install record: search the folder */ }
  let best = null;
  const walk = (d, depth) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = join(d, e.name);
      if (e.name === 'humanizer' && existsSync(join(p, 'SKILL.md'))) {
        const t = statSync(join(p, 'SKILL.md')).mtimeMs;
        if (!best || t > best.t) best = { p: join(p, 'SKILL.md'), t };
      }
      if (depth > 0) walk(p, depth - 1);
    }
  };
  walk(pluginsDir, 6);
  return best?.p ?? null;
}

const readJson = (p, fallback) => {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
};
const listW = (W, re) => (existsSync(W) ? readdirSync(W).filter(n => re.test(n)).sort() : []);

export function loadWork(w, { skillDir = OWN_SKILL_DIR, fixFindings = null } = {}) {
  w = trimDir(w);
  const W = nativePath(w);
  const at = n => join(W, n);
  const has = n => existsSync(at(n));
  const repos = readJson(at('repos.json'), null);
  const ctx = readJson(at('context.json'), {});
  let repoList = repos?.repos ?? null;
  if (!repoList && fixFindings) repoList = (readJson(nativePath(fixFindings), {}).repos ?? []).map(r => ({ name: r.name, wt: r.path }));
  if (!repoList?.length) throw new Error(`no repos: ${w}/repos.json is missing or empty`);
  const deps = Object.fromEntries(repoList.map(r => [r.name, readJson(at(`deps-${r.name}.json`), [])]));
  const ticket = has('ticket.md');
  const mode = repos?.mode ?? 'local';
  const prDescription = mode === 'pr' && has('pr-description.md');
  const files = re => listW(W, re).map(n => `${w}/${n}`);
  return {
    w, W, skillDir, mode, repos: formatLines(repoLines(repoList, deps, reposLines(W))), repoList, raw: repos ?? {},
    pr: repos?.pr ?? null,
    reReview: readJson(at('scope.json'), null)?.gone === false,
    ticketKey: ctx.ticketKey ?? repos?.ticketKey ?? null,
    ticket, prDescription,
    ticketSummary: ticket && has('ticket-summary.txt') ? oneLine(readFileSync(at('ticket-summary.txt'), 'utf8')) || 'none' : 'none',
    ticketFile: ticket ? winPath(`${w}/ticket.md`) : 'none',
    prDescriptionFile: prDescription ? winPath(`${w}/pr-description.md`) : 'none',
    languages: ctx.languages ?? [], styles: ctx.styles ?? 0, sql: !!ctx.sql, changed: ctx.changed,
    material: {
      siblings: has('siblings.json') ? `${w}/siblings.json` : null,
      indexMaps: files(/^index-map-.+\.json$/),
      forward: files(/^forward-.+\.json$/),
      history: has('history.txt') ? `${w}/history.txt` : null,
      commits: has('commits.txt') ? `${w}/commits.txt` : null,
      stylesFacts: files(/^styles-facts-.+\.json$/),
    },
    optional: n => (has(n) ? `${w}/${n}` : 'none'),
  };
}

function readTemplate(skillDir, name) {
  return readFileSync(join(skillDir, 'references', 'prompts', `${name}.md`), 'utf8');
}

function writePrompt(env, name, text) {
  mkdirSync(join(env.W, 'prompts'), { recursive: true });
  writeFileSync(join(env.W, 'prompts', `${name}.md`), text);
  return `${env.w}/prompts/${name}.md`;
}

function existing(files) {
  for (const f of files) if (!existsSync(f)) throw new Error(`checklist file missing: ${f}`);
  return files.join(', ');
}

export function reviewers(w, opts = {}) {
  const env = loadWork(w, opts);
  const template = readTemplate(env.skillDir, 'reviewer');
  const whole = `${env.w}/context.diff`;
  let changed = env.changed;
  let diffText = null;
  const diff = () => (diffText ??= readFileSync(join(env.W, 'context.diff'), 'utf8'));
  if (!Number.isFinite(changed)) changed = stats(parseDiff(diff())).changed;
  let chunkFiles = [];
  if (changed > LARGE) {
    mkdirSync(join(env.W, 'chunks'), { recursive: true });
    chunkFiles = splitDiff(parseDiff(diff()), CHUNK_SIZE).map((c, i) => {
      writeFileSync(join(env.W, 'chunks', `chunk-${i + 1}.diff`), c.text);
      return `${env.w}/chunks/chunk-${i + 1}.diff`;
    });
  }
  const list = roster({ changed, ticket: env.ticket, prDescription: env.prDescription, sql: env.sql, styles: env.styles }, chunkFiles.length);
  const out = list.map(a => {
    const agent = agentName(a);
    const diffFile = a.chunk ? chunkFiles[a.chunk - 1] : whole;
    const slots = reviewerSlots({ ...a, diffFile }, env);
    const promptFile = writePrompt(env, agent, fill(template, slots));
    return {
      agent, reviewer: a.reviewer, usageKey: a.reviewer, promptFile,
      outFile: slots.OUT_FILE, covFile: slots.COVERAGE_FILE, needsFile: slots.NEEDS_FILE, diffFile,
      ...coverageOf(a.reviewer),
    };
  });
  writeFileSync(join(env.W, 'dispatch.json'), JSON.stringify(out, null, 2));
  return out;
}

export function coverage(w, agent) {
  const W = nativePath(trimDir(w));
  const entry = readJson(join(W, 'dispatch.json'), []).find(e => e.agent === agent);
  if (!entry) throw new Error(`${agent} is not in dispatch.json; run dispatch.mjs reviewers first`);
  if (entry.coverage === 'skip') return { ok: true, skipped: true, missing: [] };
  const runs = changedRuns(parseDiff(readFileSync(nativePath(entry.diffFile), 'utf8')), entry.only ? new RegExp(entry.only, 'i') : null);
  const missing = uncovered(runs, readJson(nativePath(entry.covFile), []));
  const roundsFile = join(W, 'coverage-rounds.json');
  const rounds = readJson(roundsFile, {});
  const { failures, result } = coverageStep(rounds[agent] ?? 0, missing);
  writeFileSync(roundsFile, JSON.stringify({ ...rounds, [agent]: failures }, null, 2));
  if (result.uncovered) {
    const file = join(W, 'uncovered.json');
    const list = readJson(file, []).filter(u => u.agent !== agent);
    writeFileSync(file, JSON.stringify([...list, { agent, reviewer: entry.reviewer, missing }], null, 2));
  }
  return result;
}

// A reviewer that failed twice covered nothing; verify, recheck and factcheck failures leave no file
// that post.mjs could tell apart from a run that never got that far.
export function failed(w, agent) {
  const W = nativePath(trimDir(w));
  if (['verify', 'recheck', 'factcheck'].includes(agent)) {
    writeFileSync(join(W, `${agent}.failed`), '');
    return { recorded: `${agent}.failed` };
  }
  const entry = readJson(join(W, 'dispatch.json'), []).find(e => e.agent === agent);
  if (!entry) throw new Error(`${agent} is not in dispatch.json; run dispatch.mjs reviewers first`);
  const file = join(W, 'uncovered.json');
  const list = readJson(file, []).filter(u => u.agent !== agent);
  writeFileSync(file, JSON.stringify([...list, { agent, reviewer: entry.reviewer, missing: 'all', failed: true }], null, 2));
  return { recorded: 'uncovered.json', agent };
}

export function usage(w, key, tokens) {
  const file = join(nativePath(trimDir(w)), 'usage.json');
  const next = addUsage(readJson(file, {}), key, tokens);
  writeFileSync(file, JSON.stringify(next, null, 2));
  return next;
}

function sharedSlots(env) {
  return {
    SKILL_DIR: winPath(env.skillDir),
    REPOS: env.repos,
    DIFF_FILE: winPath(`${env.w}/context.diff`),
    TICKET_FILE: env.ticketFile,
    PR_DESCRIPTION_FILE: env.prDescriptionFile,
    COMMENTS_OTHERS: env.mode === 'pr' ? env.optional('comments-others.json') : 'none',
    OURS_PREVIOUS: env.optional('ours-previous.json'),
    SIBLINGS: `${env.w}/siblings.json`,
  };
}

const candidateNames = W => listW(W, /^cand-.+\.json$/);

export function verify(w, { pluginsDir = join(homedir(), '.claude', 'plugins'), ...opts } = {}) {
  const env = loadWork(w, opts);
  const cands = candidateNames(env.W);
  const hasPrevious = existsSync(join(env.W, 'previous-recheck.json'));
  if (nothingToVerify(cands.map(n => readJson(join(env.W, n), undefined)), hasPrevious)) return { skip: true };
  const slots = {
    ...sharedSlots(env),
    CANDIDATE_FILES: cands.map(n => `${env.w}/${n}`).join(', '),
    PREVIOUS_RECHECK: env.optional('previous-recheck.json'),
    DROPPED_PREVIOUS: env.optional('dropped-previous.json'),
    TICKET_KEY: env.ticketKey ?? 'none',
    HUMANIZER: findHumanizer(pluginsDir) ?? 'none',
    NEEDS_FILE: `${env.w}/needs-verify.json`,
    OUT_FILE: `${env.w}/verified.json`,
  };
  const promptFile = writePrompt(env, 'verify', fill(readTemplate(env.skillDir, 'verify'), slots));
  return { skip: false, promptFile, outFile: slots.OUT_FILE, needsFile: slots.NEEDS_FILE, usageKey: 'verify', humanizer: slots.HUMANIZER };
}

export function recheck(w, opts = {}) {
  const env = loadWork(w, opts);
  // No verified.json: verify was skipped or failed, so nothing was taken off the blocking list.
  if (!existsSync(join(env.W, 'verified.json'))) return { skip: true };
  const verified = JSON.parse(readFileSync(join(env.W, 'verified.json'), 'utf8'));
  const cands = candidateNames(env.W).flatMap(n => JSON.parse(readFileSync(join(env.W, n), 'utf8')));
  const list = contested(verified, cands);
  writeFileSync(join(env.W, 'contested.json'), JSON.stringify(list, null, 2));
  if (!list.length) return { skip: true };
  const slots = {
    ...sharedSlots(env),
    CONTESTED_FILE: `${env.w}/contested.json`,
    VERIFIED_FILE: `${env.w}/verified.json`,
    OUT_FILE: `${env.w}/recheck.json`,
  };
  const promptFile = writePrompt(env, 'recheck', fill(readTemplate(env.skillDir, 'recheck'), slots));
  return { skip: false, contested: list.length, promptFile, outFile: slots.OUT_FILE, usageKey: 'recheck' };
}

export function fixReview(w, files, opts = {}) {
  const env = loadWork(w, opts);
  const ref = (...p) => winPath(join(env.skillDir, 'references', ...p));
  const checklists = [ref('dimensions', 'correctness.md'), ...languagesOf(files).map(l => ref('languages', `${l}.md`))];
  const slots = {
    SKILL_DIR: winPath(env.skillDir),
    CHECKLIST_FILES: existing(checklists),
    FIXES_FILE: `${env.w}/fixes.md`,
    REPOS: env.repos,
    OUT_FILE: `${env.w}/fix-review.json`,
  };
  const promptFile = writePrompt(env, 'fix-review', fill(readTemplate(env.skillDir, 'fix-review'), slots));
  return { promptFile, outFile: slots.OUT_FILE };
}

export function defaultDest(repos) {
  const list = repos?.repos ?? [];
  if (repos?.mode === 'pr') return list[0]?.dest ?? null;
  return list.find(r => r.name === 'symmetryclassic')?.dest ?? null;
}

export const haveSlugs = repos => (repos?.repos ?? []).map(r => (r.ws && r.repo ? `${r.ws}/${r.repo}` : r.name)).filter(Boolean);

const uniq = xs => [...new Set(xs)];

export function runXrepo(args) {
  return execFileSync(process.execPath, [join(HERE, 'xrepo.mjs'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 900000 });
}

function addVia(xrepo, W, slug, ref, kind, why) {
  try { return JSON.parse(xrepo(['add', W, slug, ref, kind, '--why', why])); }
  catch (e) {
    try { return JSON.parse(e.stdout); } catch { return { slug, ref, error: String(e.stderr || e.message).trim().split(/\r?\n/).pop() }; }
  }
}

function notifyOnce(W, agents) {
  const file = join(W, 'needs-notified.json');
  const done = readJson(file, []);
  const fresh = uniq(agents).filter(a => !done.includes(a));
  writeFileSync(file, JSON.stringify([...done, ...fresh], null, 2));
  return fresh;
}

export function needs(w, { dest, xrepo = runXrepo } = {}) {
  const W = nativePath(trimDir(w));
  const repos = readJson(join(W, 'repos.json'), null);
  const pending = pendingNeeds(readdirSync(W));
  const result = { added: [], asks: [], skipped: [], reposLines: [], agentsToNotify: [] };
  if (pending.length) {
    const args = ['needs', W];
    const d = dest ?? defaultDest(repos);
    if (d) args.push('--dest', d);
    const have = haveSlugs(repos);
    if (have.length) args.push('--have', have.join(','));
    const { requests = [], rejected = [] } = JSON.parse(xrepo(args));
    for (const { file } of pending) renameSync(join(W, file), join(W, file.replace(/\.json$/, '.done.json')));
    const asksFile = join(W, 'needs-asks.json');
    const openAsks = readJson(asksFile, {});
    const notify = [];
    for (const r of requests) {
      const agents = uniq((r.asks ?? []).map(a => a.agent));
      const questions = (r.asks ?? []).map(a => ({ agent: a.agent, question: a.question }));
      if (r.kind === 'release-match' || r.kind === 'rule') {
        const rec = addVia(xrepo, W, r.slug, r.ref, r.kind, `asked by ${agents.join(', ')}`);
        if (rec.error) result.skipped.push({ repo: r.slug, kind: 'add-failed', why: rec.error, agents, questions });
        else { result.added.push({ repo: r.slug, ref: r.ref, kind: r.kind, sha: rec.sha ?? null, agents, questions }); notify.push(...agents); }
      } else if (r.kind === 'ask') {
        const options = (r.options ?? []).slice(0, 3);
        result.asks.push({ repo: r.slug, why: r.why, questions, options });
        const prev = openAsks[r.slug];
        openAsks[r.slug] = { why: r.why, options, agents: uniq([...(prev?.agents ?? []), ...agents]), questions: [...(prev?.questions ?? []), ...questions] };
      } else {
        result.skipped.push({ repo: r.slug, kind: r.kind, why: r.why ?? null, agents, questions });
      }
    }
    for (const x of rejected) result.skipped.push({ repo: x.repo, kind: 'rejected', why: x.why, agents: [x.agent], questions: [] });
    writeFileSync(asksFile, JSON.stringify(openAsks, null, 2));
    result.agentsToNotify = notify.length ? notifyOnce(W, notify) : [];
  }
  result.reposLines = reposLines(W);
  return result;
}

export function needsAnswer(w, slug, ref, { xrepo = runXrepo } = {}) {
  const W = nativePath(trimDir(w));
  const asksFile = join(W, 'needs-asks.json');
  const openAsks = readJson(asksFile, {});
  const key = slugOf(slug) ?? slug;
  const ask = openAsks[key];
  if (!ask) throw new Error(`no open repo request for ${slug}`);
  const result = { added: [], skipped: [], reposLines: [], agentsToNotify: [] };
  const rec = addVia(xrepo, W, key, ref, 'user-picked', `asked by ${ask.agents.join(', ')}`);
  if (rec.error) result.skipped.push({ repo: key, kind: 'add-failed', why: rec.error, agents: ask.agents, questions: ask.questions });
  else {
    result.added.push({ repo: key, ref, kind: 'user-picked', sha: rec.sha ?? null, agents: ask.agents, questions: ask.questions });
    delete openAsks[key];
    writeFileSync(asksFile, JSON.stringify(openAsks, null, 2));
    result.agentsToNotify = notifyOnce(W, ask.agents);
  }
  result.reposLines = reposLines(W);
  return result;
}

const USAGE = `usage:
  dispatch.mjs reviewers <W>                     fill a reviewer prompt per agent (splits > ${LARGE} changed lines into <W>/chunks)
  dispatch.mjs coverage <W> <agent>              check that agent's ledger; counts rounds, records <W>/uncovered.json
  dispatch.mjs needs <W> [--dest <branch>]       handle needs-*.json: auto-add refs, list asks and skips
  dispatch.mjs needs-answer <W> <ws/repo> <ref>  add the branch the user picked for an ask
  dispatch.mjs failed <W> <agent|verify|recheck|factcheck>   record an agent that failed twice
  dispatch.mjs usage <W> <key> <tokens>          add tokens to <W>/usage.json under key
  dispatch.mjs verify <W>                        fill the verify prompt, or { skip: true } when nothing to verify
  dispatch.mjs recheck <W>                       write <W>/contested.json and fill the recheck prompt, or { skip: true }
  dispatch.mjs fix-review <W> [--findings <review-findings.json>] <files...>   fill the fix-review prompt`;

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
  const dest = opt(args, '--dest');
  const findings = opt(args, '--findings');
  const [w, ...rest] = args;
  const usageExit = () => { console.error(USAGE); process.exit(2); };
  if (!w) usageExit();
  switch (cmd) {
    case 'reviewers': return reviewers(w);
    case 'coverage': return rest[0] ? coverage(w, rest[0]) : usageExit();
    case 'needs': return needs(w, { dest });
    case 'needs-answer': return rest.length === 2 ? needsAnswer(w, rest[0], rest[1]) : usageExit();
    case 'failed': return rest[0] ? failed(w, rest[0]) : usageExit();
    case 'usage': return rest.length === 2 && /^\d+$/.test(rest[1]) ? usage(w, rest[0], Number(rest[1])) : usageExit();
    case 'verify': return verify(w);
    case 'recheck': return recheck(w);
    case 'fix-review': return rest.length ? fixReview(w, rest, { fixFindings: findings }) : usageExit();
    default: return usageExit();
  }
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  try { console.log(JSON.stringify(main(process.argv.slice(2)), null, 2)); }
  catch (e) { console.error(`dispatch.mjs: ${e.message}`); process.exit(1); }
}
