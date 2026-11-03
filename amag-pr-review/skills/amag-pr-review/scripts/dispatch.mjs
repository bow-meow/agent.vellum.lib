#!/usr/bin/env node
// Fills the triage, reviewer, verify, recheck and fix-review prompts from the work dir, and does the
// after-dispatch mechanics: triage checks, coverage rounds, repo requests, token usage. Usage: see USAGE.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGenerated, parseDiff, splitDiff, stats } from './anchors.mjs';
import { changedRuns, clipRuns, samePath, uncovered } from './coverage.mjs';
import { nativePath } from './env.mjs';
import { levelName, levelOf } from './levels.mjs';
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
  'failure-paths': ['correctness', 'regression'],
  quick: ['correctness', 'concurrency-races', 'resources-performance', 'security'],
  styles: [],
};
const MULTI = new Set(['specialists', 'quick', 'failure-paths']);
// Reviewers handed the callers of changed functions: the ones that trace what a change reaches.
const TRACERS = new Set(['correctness', 'regression', 'failure-paths', 'quick', 'combined', 'specialists', 'concurrency-races', 'resources-performance']);
const dimensionsOf = r => CHECKLISTS[r] ?? [r];

const NO_COVERAGE = new Set(['ticket-fit', 'claims', 'styles']);

// Specialists that only see the ranges triage assigns them. The rest always read the whole diff, so a
// range triage misses can still be caught by correctness or regression.
export const TRIAGED = ['concurrency-races', 'resources-performance', 'security', 'sql'];

// Leads for triage, not a verdict: every hit has to land in a range or be dismissed with a reason.
export const HINTS = {
  'concurrency-races': /\b(lock|Monitor\.|Interlocked|volatile|async void|Task\.(Run|WhenAll|WhenAny|Factory)|Thread|ThreadPool|Parallel\.|Concurrent\w+|Semaphore\w*|Mutex|ReaderWriterLock\w*|Timer|Dispatcher|BeginInvoke|CancellationToken\w*|std::(thread|mutex|atomic|async|condition_variable|lock_guard|unique_lock)|pthread_\w+|go func|chan|sync\.\w+|setTimeout|setInterval|Promise|HOLDLOCK|UPDLOCK|NOLOCK|BEGIN TRAN\w*)\b|\bstatic\s+(?!(readonly|const|class|void|async|extern|inline|bool|int|string)\b)[\w<>,[\] ]+\s\w+\s*[=;]/,
  'resources-performance': /\bnew\s+(Sql\w+|\w*Stream|\w*Reader|\w*Writer|HttpClient|Timer|Bitmap|Process|\w*Connection|CancellationTokenSource)\b|\b(IDisposable|Dispose|using\s*\(|using var|malloc|calloc|realloc|free\(|fopen|fclose|Unsubscribe|AddHandler|RemoveHandler|addEventListener|removeEventListener|unsubscribe|ngOnDestroy|takeUntil|Thread\.Sleep|\.Result\b|\.Wait\(\)|defer\b|ToList\(\)|ToArray\(\))|\w\s*\+=\s*(new\b|\w*(Handler|On\w+)\b|\([^)]*\)\s*=>|\w+\s*=>)|\bstatic\s+[\w.]*(List|Dictionary|Cache|HashSet|Map)\b/,
  security: /\[(Authorize|AllowAnonymous|Http(Get|Post|Put|Delete|Patch)|Route|FromBody|FromQuery)\b|\b(Permission\w*|Privilege\w*|Grant\w*|Password\w*|Secret\w*|Credential\w*|ApiKey|Encrypt\w*|Decrypt\w*|Crypto\w*|Certificate\w*|Sanitiz\w*|Deserializ\w*|BinaryFormatter|Process\.Start|system\(|popen|exec[lv]p?\(|Path\.Combine|File\.(Read|Write|Open|Delete|Copy|Move)\w*|strcpy|strcat|sprintf|memcpy|gets\(|innerHTML|bypassSecurityTrust\w*|eval\(|Subscribe\w*|Controller|Request\.)/,
  sql: /\b(SELECT|INSERT|UPDATE|DELETE|MERGE|EXEC|EXECUTE|SqlCommand|SqlParameter|FromSql\w*|ExecuteSql\w*|Dapper|QueryAsync|CommandText|CREATE (TABLE|INDEX|PROC\w*)|ALTER (TABLE|PROC\w*)|JOIN|WHERE|TRANSACTION|DbContext|SaveChanges\w*)\b/,
};
const HINT_GAP = 3;

export const EXTRA_RULES = {
  'ticket-fit': 'Uncertain coverage goes in with terminal_only: true.',
  claims: 'Your units are the facts in the PR description and the ticket, not the diff. Write one ledger entry per text (path "PR description" or "ticket", side "new", from/to 0) whose checked lists each fact as: fact → holds | doesn\'t hold: <the code\'s worst case>. Each fact that doesn\'t hold is also a candidate, at the code that decides it.',
  'failure-paths': 'You are a second, independent pass over the same code as the correctness and regression reviewers, and you will not see their findings. Work from failure rather than from the checklist order: for each unit, ask what happens when a call it makes fails, times out, returns empty or stale data, runs twice, runs late, or runs at the same time as another, and follow that into the callee and framework code even when it lies outside the diff. Set each candidate\'s `dimension` to correctness or regression, never failure-paths.',
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

export function roster({ changed, ticket, prDescription, sql, styles }, chunks = 0, level = null) {
  const { lean, quick, secondPass } = levelOf(level);
  const second = secondPass ? ['failure-paths'] : [];
  const once = [ticket && 'ticket-fit', !lean && (prDescription || ticket) && 'claims'];
  if (changed < SMALL) return ['combined', ...second, ...once].filter(Boolean).map(reviewer => ({ reviewer, chunk: null }));
  const perChunk = (quick
    ? ['quick', 'regression', sql && 'sql']
    : ['correctness', 'regression', ...second, 'concurrency-races', 'resources-performance', sql && 'sql', !lean && 'tests-design', 'security']
  ).filter(Boolean);
  if (!lean) once.push('docs', (styles ?? 0) >= STYLES_REVIEWER_MIN && 'styles');
  const single = once.filter(Boolean).map(reviewer => ({ reviewer, chunk: null }));
  if (changed <= LARGE) return [...perChunk.map(reviewer => ({ reviewer, chunk: null })), ...single];
  const out = [];
  for (let n = 1; n <= chunks; n++) for (const reviewer of perChunk) out.push({ reviewer, chunk: n });
  return [...out, ...single];
}

export const agentName = ({ reviewer, chunk }) => (chunk ? `${reviewer}-${chunk}` : reviewer);

export function checklistFiles(reviewer, { skillDir, languages = [], styles = 0 }, dimensions = dimensionsOf(reviewer)) {
  const ref = (...p) => winPath(join(skillDir, 'references', ...p));
  const files = dimensions.map(d => ref('dimensions', `${d}.md`));
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

export function extraMaterial(reviewer, { sql, material: m }, dimensions = dimensionsOf(reviewer)) {
  const parts = [];
  const list = xs => xs.join(', ');
  const coversSql = reviewer === 'sql' || (reviewer === 'specialists' && dimensions.includes('sql'));
  if (reviewer === 'ticket-fit' && m.siblings) parts.push(`Sibling PRs: ${m.siblings}`);
  if ((coversSql || (reviewer === 'combined' && sql)) && m.indexMaps.length) parts.push(`Index maps: ${list(m.indexMaps)}`);
  if ((coversSql || ['correctness', 'combined', 'failure-paths', 'quick'].includes(reviewer)) && m.forward.length) parts.push(`Forward-scan: ${list(m.forward)}`);
  if (TRACERS.has(reviewer) && m.callers?.length) parts.push(`Callers of the changed functions (read before searching for them yourself): ${list(m.callers)}`);
  if (m.staticCands) parts.push(`Already raised by static analysis, so don't raise again: ${m.staticCands}`);
  if (m.staticLeads) parts.push(`Static-analysis leads to confirm or rule out at your units: ${m.staticLeads}`);
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
// Removed-only blocks are the units reviewers skipped most often: listing them up front saves a send-back.
export const MAX_REMOVED_LISTED = 60;
export function removedBlocksText(runs) {
  const old = runs.filter(r => r.side === 'old');
  if (!old.length) return 'none';
  const shown = old.slice(0, MAX_REMOVED_LISTED).map(r => `\n  - ${r.path} old lines ${r.from}-${r.to}`).join('');
  return shown + (old.length > MAX_REMOVED_LISTED ? `\n  - and ${old.length - MAX_REMOVED_LISTED} more in the diff` : '');
}

export function reviewerSlots({ reviewer, chunk, diffFile, scope = null, dimensions = dimensionsOf(reviewer), removed = 'none' }, env) {
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
    CHECKLIST_FILES: existing(checklistFiles(reviewer, env, dimensions)),
    MODE: mode,
    REPOS: env.repos,
    NEEDS_FILE: `${env.w}/needs-${agent}.json`,
    TICKET_SUMMARY: blind ? 'none' : env.ticketSummary,
    TICKET_FILE: blind ? 'none' : env.ticketFile,
    PR_DESCRIPTION_FILE: blind ? 'none' : env.prDescriptionFile,
    DIFF_FILE: winPath(diffFile),
    SCOPE: scopeText(scope),
    REMOVED_BLOCKS: removed,
    OUT_FILE: `${env.w}/cand-${agent}.json`,
    COVERAGE_FILE: `${env.w}/cov-${agent}.json`,
    EXTRA_MATERIAL: extraMaterial(reviewer, env, dimensions),
    EXTRA_RULES: EXTRA_RULES[reviewer] ?? (MULTI.has(reviewer)
      ? `You cover the checklists ${dimensions.join(', ')}. Go through every one of them on each unit, and set each candidate's \`dimension\` to the checklist it falls under, never \`${reviewer}\`.`
      : 'none'),
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
    level: levelName(repos?.level),
    languages: ctx.languages ?? [], styles: ctx.styles ?? 0, sql: !!ctx.sql, changed: ctx.changed,
    material: {
      siblings: has('siblings.json') ? `${w}/siblings.json` : null,
      indexMaps: files(/^index-map-.+\.json$/),
      forward: files(/^forward-.+\.json$/),
      history: has('history.txt') ? `${w}/history.txt` : null,
      commits: has('commits.txt') ? `${w}/commits.txt` : null,
      stylesFacts: files(/^styles-facts-.+\.json$/),
      callers: files(/^callers-.+\.json$/),
      staticCands: has('cand-static.json') ? `${w}/cand-static.json` : null,
      staticLeads: has('static-leads.json') && readJson(at('static-leads.json'), []).length ? `${w}/static-leads.json` : null,
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

export const triageRoster = env => TRIAGED.filter(r => r !== 'sql' || env.sql);

// Added lines that match a reviewer's hint pattern, merged into runs. Every line of a .sql file is a
// sql hint, whatever it says.
export function hintsOf(files, reviewers) {
  const out = [];
  for (const f of files.values()) {
    if (f.binary || isGenerated(f)) continue;
    const sqlFile = /\.sql$/i.test(f.path);
    const open = {};
    const flush = r => { if (open[r]) { out.push(open[r]); delete open[r]; } };
    let newLn = 0;
    for (const line of f.raw) {
      const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (h) { reviewers.forEach(flush); newLn = +h[1]; continue; }
      if (!newLn || (line[0] !== '+' && line[0] !== ' ')) continue;
      if (line[0] === '+') {
        const text = line.slice(1);
        for (const r of reviewers) {
          if (!((r === 'sql' && sqlFile) || HINTS[r].test(text))) continue;
          if (open[r] && newLn - open[r].to <= HINT_GAP) open[r].to = newLn;
          else { flush(r); open[r] = { reviewer: r, path: f.path, side: 'new', from: newLn, to: newLn, sample: text.trim().slice(0, 120) }; }
        }
      }
      newLn++;
    }
    reviewers.forEach(flush);
  }
  return out;
}

// The new-side span of every hunk that holds one of the hints, as scope ranges.
export function hunksAt(files, hints) {
  const out = [];
  for (const f of files.values()) {
    const mine = hints.filter(h => samePath(h.path, f.path));
    if (!mine.length) continue;
    for (const line of f.raw) {
      const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (!m) continue;
      const from = +m[1], to = from + (m[2] === undefined ? 1 : +m[2]) - 1;
      if (to >= from && mine.some(h => +h.from <= to && from <= +h.to)) out.push({ path: f.path, side: 'new', from, to });
    }
  }
  return out;
}

const overlaps = (a, b) => samePath(a.path, b.path) && (a.side ?? 'new') === (b.side ?? 'new') && +a.from <= +b.to && +b.from <= +a.to;

function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a.path.localeCompare(b.path) || a.side.localeCompare(b.side) || a.from - b.from);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last.path === r.path && last.side === r.side && r.from <= last.to + 1) {
      last.to = Math.max(last.to, r.to);
      if (!last.why.includes(r.why)) last.why += `; ${r.why}`;
    } else out.push({ ...r });
  }
  return out;
}

const changedLines = (runs, scope) => clipRuns(runs, scope).reduce((n, r) => n + r.to - r.from + 1, 0);

// triage.json: {ranges: {<reviewer>: [{path, side, from, to, why}]}, dismissed: [{reviewer, path, side, from, to, why}]}.
// Returns the merged ranges per reviewer, or the errors to send back.
export function checkTriage(out, { reviewers, runs, hints }) {
  const ranges = out?.ranges;
  if (!ranges || typeof ranges !== 'object' || Array.isArray(ranges)) return { errors: ['triage.json has no "ranges" object'] };
  const dismissed = Array.isArray(out.dismissed) ? out.dismissed : [];
  const errors = [];
  const result = {};
  for (const r of reviewers) {
    const list = ranges[r];
    if (!Array.isArray(list)) { errors.push(`ranges["${r}"] is missing; write [] when nothing in the diff is for it`); continue; }
    const good = [];
    list.forEach((x, i) => {
      const at = `ranges["${r}"][${i}]`;
      const side = x?.side ?? 'new';
      if (!x?.path || !Number.isInteger(+x.from) || !Number.isInteger(+x.to) || +x.from > +x.to || !['new', 'old'].includes(side))
        return errors.push(`${at} needs path, side "new" or "old", and whole-number from <= to`);
      if (!String(x.why ?? '').trim()) return errors.push(`${at} has no "why"`);
      const s = { path: x.path, side, from: +x.from, to: +x.to };
      const run = runs.find(c => c.side === side && samePath(c.path, x.path));
      if (!run || !clipRuns(runs, [s]).length) return errors.push(`${at}: ${x.path} ${x.from}-${x.to} (${side}) holds no changed line`);
      good.push({ ...s, path: run.path, why: String(x.why).trim() });
    });
    result[r] = mergeRanges(good);
  }
  for (const h of hints) {
    if (!reviewers.includes(h.reviewer)) continue;
    const kept = (result[h.reviewer] ?? []).some(x => overlaps(x, h))
      || dismissed.some(d => d?.reviewer === h.reviewer && String(d.why ?? '').trim() && overlaps(d, h));
    if (!kept) errors.push(`hint ${h.reviewer} ${h.path}:${h.from}-${h.to} ("${h.sample}") is in no range and not dismissed`);
  }
  return errors.length ? { errors } : { ranges: result };
}

export function triage(w, opts = {}) {
  const env = loadWork(w, opts);
  const files = parseDiff(readFileSync(join(env.W, 'context.diff'), 'utf8'));
  const changed = Number.isFinite(env.changed) ? env.changed : stats(files).changed;
  if (changed < SMALL) return { skip: true, why: `under ${SMALL} changed lines: the combined reviewer reads everything` };
  const list = triageRoster(env);
  const leads = readJson(join(env.W, 'static-leads.json'), [])
    .filter(l => list.includes(l.dimension))
    .map(l => ({ reviewer: l.dimension, path: l.path, side: 'new', from: l.from, to: l.to, sample: `static ${l.rule}: ${l.lead}`.slice(0, 160) }));
  const hints = [...hintsOf(files, list), ...leads];
  writeFileSync(join(env.W, 'triage-hints.json'), JSON.stringify(hints, null, 2));
  if (!levelOf(env.level).llmTriage) {
    // Only sql is scoped at this level; the quick reviewer reads every changed line for the rest.
    const sql = mergeRanges(hunksAt(files, hints.filter(h => h.reviewer === 'sql')).map(s => ({ ...s, why: 'sql hint in this hunk' })));
    writeFileSync(join(env.W, 'triage-checked.json'), JSON.stringify({ sql }, null, 2));
    return { skip: true, why: `${env.level} level: sql scoped by script hints, no triage agent`, scoped: { sql: sql.length } };
  }
  const slots = {
    SKILL_DIR: winPath(env.skillDir),
    REVIEWERS: list.map(r => `\n  - \`${r}\`: ${winPath(join(env.skillDir, 'references', 'dimensions', `${r}.md`))}`).join(''),
    REPOS: env.repos,
    TICKET_SUMMARY: env.ticketSummary,
    DIFF_FILE: winPath(`${env.w}/context.diff`),
    HINTS_FILE: winPath(`${env.w}/triage-hints.json`),
    OUT_FILE: `${env.w}/triage.json`,
  };
  const promptFile = writePrompt(env, 'triage', fill(readTemplate(env.skillDir, 'triage'), slots));
  return { skip: false, promptFile, outFile: slots.OUT_FILE, usageKey: 'triage', model: 'sonnet', reviewers: list, hints: hints.length };
}

export function triageCheck(w, opts = {}) {
  const env = loadWork(w, opts);
  const reviewers = triageRoster(env);
  const runs = changedRuns(parseDiff(readFileSync(join(env.W, 'context.diff'), 'utf8')));
  const out = readJson(join(env.W, 'triage.json'), null);
  if (!out) return { ok: false, errors: ['triage.json is missing or not valid JSON'] };
  const res = checkTriage(out, { reviewers, runs, hints: readJson(join(env.W, 'triage-hints.json'), []) });
  if (res.errors) return { ok: false, errors: res.errors };
  writeFileSync(join(env.W, 'triage-checked.json'), JSON.stringify(res.ranges, null, 2));
  return {
    ok: true,
    scoped: Object.fromEntries(reviewers.filter(r => res.ranges[r].length)
      .map(r => [r, { ranges: res.ranges[r].length, changedLines: changedLines(runs, res.ranges[r]) }])),
    notRun: reviewers.filter(r => !res.ranges[r].length),
  };
}

export function scopeText(scope) {
  if (!scope) return 'Your scope is every changed unit in the diff.';
  return 'Your scope is the ranges below, which a triage pass picked from the diff for your dimension. '
    + 'Your diff holds only the hunks around them; read the worktree for anything else you need. Your units, '
    + 'your ledger and the coverage check cover these ranges only. A defect in your dimension that you see '
    + 'outside them while tracing is still a candidate.'
    + scope.map(s => `\n  - ${s.path} lines ${s.from}-${s.to} (${s.side}): ${s.why}`).join('');
}

// The hunks of a diff that overlap any scope range, each with its file header.
export function scopedDiff(files, scope) {
  const parts = [];
  for (const f of files.values()) {
    const mine = scope.filter(s => samePath(s.path, f.path) || ((s.side ?? 'new') === 'old' && samePath(s.path, f.oldPath)));
    if (!mine.length) continue;
    const head = [], hunks = [];
    let cur = null;
    for (const line of f.raw) {
      const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (m) {
        const span = (start, n) => [+start, +start + (n === undefined ? 1 : +n) - 1];
        cur = { lines: [line], old: span(m[1], m[2]), new: span(m[3], m[4]) };
        hunks.push(cur);
      } else (cur ? cur.lines : head).push(line);
    }
    const keep = hunks.filter(h => mine.some(s => {
      const [a, b] = h[s.side ?? 'new'];
      return +s.from <= b && a <= +s.to;
    }));
    if (keep.length) parts.push([...head, ...keep.flatMap(h => h.lines)].join('\n').replace(/\n+$/, ''));
  }
  return parts.join('\n') + '\n';
}

// Specialists whose ranges add up to no more than this run as one agent with all their checklists,
// which pays the fixed reading and the tracing of shared code once. The level sets it (levels.mjs).
export const MERGE_MAX = levelOf(null).mergeMax;

function mergeSpecialists(present, triaged, runs, mergeMax) {
  const picked = [];
  let union = [];
  for (const r of TRIAGED) {
    if (!present.has(r) || !triaged[r]?.length) continue;
    const next = mergeRanges([...union, ...triaged[r].map(s => ({ ...s, why: `${r}: ${s.why}` }))]);
    if (changedLines(runs, next) > mergeMax) continue;
    picked.push(r);
    union = next;
  }
  return picked.length > 1 ? { reviewer: 'specialists', chunk: null, scope: union, dimensions: picked } : null;
}

// A triaged reviewer runs only where triage gave it ranges. Over 1000 lines, one whose ranges fit in a
// chunk's worth of changed lines runs once over the whole diff instead of once per chunk. Specialists
// with small scopes are merged into one agent (mergeMax).
export function applyTriage(list, triaged, { runs, chunkRuns, mergeMax = MERGE_MAX }) {
  if (!triaged) return list.map(a => ({ ...a, scope: null }));
  const out = [];
  const once = new Set();
  const merged = mergeSpecialists(new Set(list.map(a => a.reviewer)), triaged, runs, mergeMax);
  for (const a of list) {
    const ranges = TRIAGED.includes(a.reviewer) && Array.isArray(triaged[a.reviewer]) ? triaged[a.reviewer] : null;
    if (!ranges) { out.push({ ...a, scope: null }); continue; }
    if (!ranges.length) continue;
    if (merged?.dimensions.includes(a.reviewer)) {
      if (!once.has('specialists')) { once.add('specialists'); out.push(merged); }
      continue;
    }
    if (!a.chunk) { out.push({ ...a, scope: ranges }); continue; }
    if (changedLines(runs, ranges) <= CHUNK_SIZE) {
      if (!once.has(a.reviewer)) { once.add(a.reviewer); out.push({ reviewer: a.reviewer, chunk: null, scope: ranges }); }
      continue;
    }
    const mine = ranges.filter(s => clipRuns(chunkRuns[a.chunk - 1], [s]).length);
    if (mine.length) out.push({ ...a, scope: mine });
  }
  return out;
}

// The checked triage, or null when triage didn't run, failed, or never passed its check.
function loadTriage(W) {
  if (existsSync(join(W, 'triage.failed'))) return null;
  return readJson(join(W, 'triage-checked.json'), null);
}

export function reviewers(w, opts = {}) {
  const env = loadWork(w, opts);
  const template = readTemplate(env.skillDir, 'reviewer');
  const whole = `${env.w}/context.diff`;
  let changed = env.changed;
  let parsed = null;
  const files = () => (parsed ??= parseDiff(readFileSync(join(env.W, 'context.diff'), 'utf8')));
  if (!Number.isFinite(changed)) changed = stats(files()).changed;
  let chunkFiles = [];
  let chunkRuns = [];
  let chunkTexts = [];
  if (changed > LARGE) {
    mkdirSync(join(env.W, 'chunks'), { recursive: true });
    const chunks = splitDiff(files(), CHUNK_SIZE);
    chunkRuns = chunks.map(c => changedRuns(parseDiff(c.text)));
    chunkTexts = chunks.map(c => c.text);
    chunkFiles = chunks.map((c, i) => {
      writeFileSync(join(env.W, 'chunks', `chunk-${i + 1}.diff`), c.text);
      return `${env.w}/chunks/chunk-${i + 1}.diff`;
    });
  }
  const triaged = loadTriage(env.W);
  const list = applyTriage(
    roster({ changed, ticket: env.ticket, prDescription: env.prDescription, sql: env.sql, styles: env.styles }, chunkFiles.length, env.level),
    triaged, { runs: triaged ? changedRuns(files()) : [], chunkRuns, mergeMax: levelOf(env.level).mergeMax });
  const out = list.map(a => {
    const agent = agentName(a);
    let diffFile = a.chunk ? chunkFiles[a.chunk - 1] : whole;
    let runs;
    if (a.scope) {
      mkdirSync(join(env.W, 'scoped'), { recursive: true });
      const text = scopedDiff(files(), a.scope);
      writeFileSync(join(env.W, 'scoped', `${agent}.diff`), text);
      diffFile = `${env.w}/scoped/${agent}.diff`;
      runs = clipRuns(changedRuns(parseDiff(text)), a.scope);
    } else runs = changedRuns(a.chunk ? parseDiff(chunkTexts[a.chunk - 1]) : files());
    const cov = coverageOf(a.reviewer);
    const removed = cov.coverage === 'skip' || cov.only ? 'none' : removedBlocksText(runs);
    const slots = reviewerSlots({ ...a, diffFile, removed }, env);
    const promptFile = writePrompt(env, agent, fill(template, slots));
    return {
      agent, reviewer: a.reviewer, usageKey: a.reviewer, promptFile, model: levelOf(env.level).reviewerModel,
      outFile: slots.OUT_FILE, covFile: slots.COVERAGE_FILE, needsFile: slots.NEEDS_FILE, diffFile,
      ...cov, scope: a.scope,
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
  let runs = changedRuns(parseDiff(readFileSync(nativePath(entry.diffFile), 'utf8')), entry.only ? new RegExp(entry.only, 'i') : null);
  if (entry.scope) runs = clipRuns(runs, entry.scope);
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
  if (['triage', 'verify', 'recheck', 'factcheck'].includes(agent)) {
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

// Typical tokens per agent, from measured runs (SYM-10359, November 2026). An estimate to ask on, not a budget.
export const TYPICAL_TOKENS = { reviewer: 160000, verify: 200000, recheck: 50000 };
export const ESTIMATE_ASK = 2000000;

export function estimateFor({ agents, spent = 0, recheck = true }) {
  const total = spent + agents * TYPICAL_TOKENS.reviewer + TYPICAL_TOKENS.verify + (recheck ? TYPICAL_TOKENS.recheck : 0);
  return { agents, spentSoFar: spent, estimate: Math.round(total / 100000) * 100000, ask: total > ESTIMATE_ASK, askOver: ESTIMATE_ASK };
}

export function estimate(w, opts = {}) {
  const env = loadWork(w, opts);
  const list = readJson(join(env.W, 'dispatch.json'), null);
  if (!list) throw new Error(`no dispatch.json in ${w}; run dispatch.mjs reviewers first`);
  const spent = Object.values(readJson(join(env.W, 'usage.json'), {})).reduce((n, v) => n + (Number(v) || 0), 0);
  return { level: env.level, model: levelOf(env.level).reviewerModel, ...estimateFor({ agents: list.length, spent, recheck: levelOf(env.level).recheck }) };
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
  if (!levelOf(env.level).recheck) return { skip: true, why: `${env.level} level: no recheck; low-confidence findings stay unposted` };
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
  dispatch.mjs triage <W>                        write <W>/triage-hints.json and fill the triage prompt, or { skip: true } under ${SMALL} lines
  dispatch.mjs triage-check <W>                  check <W>/triage.json; on ok writes <W>/triage-checked.json for reviewers
  dispatch.mjs reviewers <W>                     fill a reviewer prompt per agent (splits > ${LARGE} changed lines into <W>/chunks)
  dispatch.mjs estimate <W>                      typical tokens for the dispatched roster; ask: true over the threshold
  dispatch.mjs coverage <W> <agent>              check that agent's ledger; counts rounds, records <W>/uncovered.json
  dispatch.mjs needs <W> [--dest <branch>]       handle needs-*.json: auto-add refs, list asks and skips
  dispatch.mjs needs-answer <W> <ws/repo> <ref>  add the branch the user picked for an ask
  dispatch.mjs failed <W> <agent|triage|verify|recheck|factcheck>   record an agent that failed twice
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
    case 'triage': return triage(w);
    case 'triage-check': return triageCheck(w);
    case 'reviewers': return reviewers(w);
    case 'estimate': return estimate(w);
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
