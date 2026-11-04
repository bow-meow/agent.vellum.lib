#!/usr/bin/env node
// Runs ifttt-lint, the LINT.IfChange/ThenChange checker symmetryclassic's PR pipeline runs, over one repo's
// changes since its merge base, uncommitted ones included. Each diagnostic becomes a candidate.
// Usage: ifttt.mjs <worktree> --base <sha> [--prefix <repo>] [--tool <exe>]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { whichOnPath } from './static.mjs';

// The version bitbucket-pipelines.yml pins; another one can disagree with the PR's pipeline.
export const VERSION = '0.11.3';
const TOOL_PATHS = [process.env.IFTTT_LINT, join(homedir(), 'tools', 'ifttt-lint', 'bin', 'ifttt-lint.exe')];
const INSTALL = `cargo install ifttt-lint --version ${VERSION} --locked --root ~/tools/ifttt-lint`;

export function findTool(explicit = null, { exists = existsSync, which = whichOnPath } = {}) {
  for (const p of [explicit, ...TOOL_PATHS]) if (p && exists(p)) return p;
  return which('ifttt-lint');
}

// raw: ifttt-lint's --format json output. read(path) returns a worktree file's text, or null.
export function toCandidates(raw, { prefix = null, read = () => null } = {}) {
  return (raw.diagnostics ?? []).map(d => {
    const path = prefix ? `${prefix}/${d.file}` : d.file;
    const lines = String(read(d.file) ?? '').split(/\r?\n/);
    const to = Math.min(d.target?.then_change_line ?? d.line, d.line + 5);
    const evidence = lines.slice(d.line - 1, to).join('\n').trim();
    const target = String(d.target?.raw ?? '').replace(/^\/\//, '');
    const base = {
      repo: prefix ?? null, dimension: 'correctness', path, line: d.line, side: 'new', evidence,
      confidence: 'medium', terminal_only: false, rule: 'ifttt-lint',
    };
    if (d.severity === 'warning' && target) return {
      ...base, severity: 'Medium',
      claim: `The LINT.IfChange block at line ${d.line} changed, but its paired code at ${target} wasn't changed in this diff.`,
      failure: `The markers say ${target} must change with this block; after this edit it still holds the old values or logic, so the two sides disagree at runtime.`,
      issue: `Lines inside this \`LINT.IfChange\` block changed with no change at \`${target}\`.`,
      impact: 'The code the markers keep in step drifts apart, and the PR pipeline\'s IfThisThenThat Lint step fails.',
      fix: `Make the matching change at ${target}, or say in the PR why this edit doesn't affect it.`,
      confidence_reason: 'ifttt-lint: the block has changed lines and the diff has none in the ThenChange target\'s block',
    };
    return {
      ...base, severity: 'Low', failure: '',
      claim: `ifttt-lint: ${d.message}.`,
      issue: `A broken LINT.IfChange/ThenChange pair: ${d.message}.`,
      impact: 'The pairing no longer points at the code it guards, and the PR pipeline\'s IfThisThenThat Lint step fails.',
      fix: 'Point the ThenChange at where the paired code lives now, close the block, or remove both markers if the pairing is gone.',
      confidence_reason: 'ifttt-lint: a structural check of the markers',
    };
  });
}

export function lint(wt, base, { prefix = null, tool = findTool(), run = runTool } = {}) {
  if (!tool) return { skipped: true, why: `no ifttt-lint found (set IFTTT_LINT, or ${INSTALL})`, candidates: [] };
  const raw = run(tool, ['--vcs', 'git', '--diff', base, '--format', 'json'], wt);
  const read = p => { try { return readFileSync(join(wt, p), 'utf8'); } catch { return null; } };
  return { tool, candidates: toCandidates(raw, { prefix, read }) };
}

function runTool(tool, args, cwd) {
  let out;
  try { out = execFileSync(tool, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 }); }
  catch (e) {
    // Exit 1 means diagnostics, printed to stdout; 2 is a bad range or an I/O failure.
    if (e.status !== 1 || !e.stdout) throw new Error(String(e.stderr || e.message).trim().split(/\r?\n/).slice(-1)[0]);
    out = e.stdout;
  }
  // A clean run prints nothing, even with --format json.
  return out.trim() ? JSON.parse(out) : { diagnostics: [] };
}

function main(argv) {
  const a = [...argv];
  const opt = name => { const i = a.indexOf(name); if (i < 0) return null; const v = a[i + 1]; a.splice(i, 2); return v; };
  const base = opt('--base'), prefix = opt('--prefix'), tool = opt('--tool');
  const [wt] = a;
  if (!wt || !base) { console.error('usage: ifttt.mjs <worktree> --base <sha> [--prefix <repo>] [--tool <exe>]'); process.exit(2); }
  return lint(resolve(wt), base, { prefix, tool: findTool(tool) });
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  try { console.log(JSON.stringify(main(process.argv.slice(2)), null, 2)); }
  catch (e) { console.error(`ifttt.mjs: ${e.message}`); process.exit(1); }
}
