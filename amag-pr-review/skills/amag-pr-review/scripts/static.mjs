#!/usr/bin/env node
// Runs Opengrep (or Semgrep) with the skill's rules over one repo's changed files and keeps the hits on
// added lines. Usage: static.mjs <worktree> --diff <diff> [--prefix <repo>] [--rules <dir>] [--tool <exe>]
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGenerated, parseDiff } from './anchors.mjs';
import { changedRuns } from './coverage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const RULES_DIR = join(dirname(HERE), 'rules');
const TOOL_PATHS = [process.env.OPENGREP, join(homedir(), 'tools', 'opengrep', 'opengrep.exe')];

export function findTool(explicit = null, { exists = existsSync, which = whichOnPath } = {}) {
  for (const p of [explicit, ...TOOL_PATHS]) if (p && exists(p)) return p;
  for (const name of ['opengrep', 'semgrep']) { const p = which(name); if (p) return p; }
  return null;
}

export function whichOnPath(name) {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    return execFileSync(cmd, [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)[0].trim() || null;
  } catch { return null; }
}

// Opengrep picks a parser by extension, case-sensitively, so FOO.CPP would be skipped as unknown.
export const stagedName = p => p.slice(0, p.length - extname(p).length) + extname(p).toLowerCase();

export function changedFiles(files) {
  return [...files.values()].filter(f => !f.binary && !f.deleted && !isGenerated(f)).map(f => f.path);
}

const overlapsAdded = (runs, path, from, to) => runs.some(r => r.side === 'new' && r.path === path && r.from <= to && from <= r.to);

// raw: Opengrep's --json output. byStaged maps a staged path back to the diff's path.
export function sortHits(raw, { runs, byStaged, prefix = null }) {
  const candidates = [], leads = [];
  const norm = p => String(p).replace(/\\/g, '/').replace(/^\.\//, '');
  for (const m of raw.results ?? []) {
    const path = byStaged.get(norm(m.path));
    if (!path) continue;
    const from = m.start?.line, to = m.end?.line ?? from;
    if (!overlapsAdded(runs, path, from, to)) continue;
    const meta = m.extra?.metadata ?? {};
    const rule = String(m.check_id).split('.').pop();
    const shown = prefix ? `${prefix}/${path}` : path;
    const code = String(m.extra?.lines ?? '').split(/\r?\n/).slice(0, 6).join('\n').trim();
    if (meta.kind === 'candidate') {
      candidates.push({
        repo: prefix ?? null, severity: meta.severity ?? 'Low', dimension: meta.dimension ?? 'correctness',
        path: shown, line: from, side: 'new', claim: meta.claim ?? m.extra?.message ?? rule, evidence: code,
        failure: meta.failure ?? '', issue: meta.issue ?? '', impact: meta.impact ?? '', fix: meta.fix ?? '',
        confidence: 'medium', confidence_reason: `static rule ${rule}: a pattern match at this line, not traced through the code`,
        terminal_only: false, rule,
      });
    } else {
      leads.push({ rule, dimension: meta.dimension ?? null, path: shown, from, to, lead: meta.lead ?? m.extra?.message ?? rule, code });
    }
  }
  return { candidates, leads };
}

export function scan(wt, diffText, { prefix = null, rules = RULES_DIR, tool = findTool(), run = runTool } = {}) {
  if (!tool) return { skipped: true, why: 'no opengrep or semgrep found (set OPENGREP, or install to ~/tools/opengrep)', candidates: [], leads: [] };
  const files = parseDiff(diffText);
  const runs = changedRuns(files);
  const paths = changedFiles(files).filter(p => existsSync(join(wt, p)));
  if (!paths.length) return { tool, candidates: [], leads: [], errors: 0 };
  const stage = mkdtempSync(join(tmpdir(), 'static-'));
  const byStaged = new Map();
  try {
    for (const p of paths) {
      const s = stagedName(p);
      mkdirSync(dirname(join(stage, s)), { recursive: true });
      copyFileSync(join(wt, p), join(stage, s));
      byStaged.set(s, p);
    }
    // One path per file overflows the Windows command line on a large diff, so scan the folder. An empty
    // .semgrepignore turns off the default ignores (tests/, build/, node_modules/...) a folder scan applies.
    writeFileSync(join(stage, '.semgrepignore'), '');
    const raw = run(tool, ['scan', '--quiet', '--json', '--config', rules, '.'], stage);
    return { tool, ...sortHits(raw, { runs, byStaged, prefix }), errors: (raw.errors ?? []).filter(e => !/PartialParsing/.test(e.type)).length };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function runTool(tool, args, cwd) {
  let out;
  try { out = execFileSync(tool, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 }); }
  catch (e) {
    // Exit 1 means findings with some tools; the JSON is still on stdout.
    if (!e.stdout) throw new Error(String(e.stderr || e.message).trim().split(/\r?\n/).slice(-1)[0]);
    out = e.stdout;
  }
  return JSON.parse(out);
}

function main(argv) {
  const a = [...argv];
  const opt = name => { const i = a.indexOf(name); if (i < 0) return null; const v = a[i + 1]; a.splice(i, 2); return v; };
  const diff = opt('--diff'), prefix = opt('--prefix'), rules = opt('--rules') ?? RULES_DIR, tool = opt('--tool');
  const [wt] = a;
  if (!wt || !diff) { console.error('usage: static.mjs <worktree> --diff <diff> [--prefix <repo>] [--rules <dir>] [--tool <exe>]'); process.exit(2); }
  return scan(resolve(wt), readFileSync(diff, 'utf8'), { prefix, rules, tool: findTool(tool) });
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  try { console.log(JSON.stringify(main(process.argv.slice(2)), null, 2)); }
  catch (e) { console.error(`static.mjs: ${e.message}`); process.exit(1); }
}
