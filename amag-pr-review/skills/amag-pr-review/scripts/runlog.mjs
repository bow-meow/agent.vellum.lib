#!/usr/bin/env node
// One JSON line per review, kept outside the skill so later runs of calibrate.mjs can tune confidence
// and token cost from real reviews. Holds claims about other people's code: local disk only.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDiff, stats } from './anchors.mjs';
import { readModel } from './comment.mjs';
import { confidenceOf } from './recheck.mjs';
import { stateRoot } from './state.mjs';

export const LOG_VERSION = 1;
export const logDir = (root = stateRoot()) => join(root, '.log');

export function logPath(key, root = stateRoot()) {
  if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error(`log key "${key}" must be letters, digits, . _ -`);
  return join(logDir(root), `${key}.jsonl`);
}

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// An installed plugin sits in a cache folder named after its commit; a checkout can ask git.
export function skillVersion(skillDir = SKILL_DIR) {
  const pluginDir = resolve(skillDir, '..', '..');
  if (/[\\/]plugins[\\/]cache[\\/]/i.test(pluginDir)) return basename(pluginDir);
  try {
    return execFileSync('git', ['-C', skillDir, 'rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

const readJson = (p, fallback = null) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);

// Read back from what the run left in $W, so nothing here depends on the agent remembering it.
export function runContext(w) {
  const files = existsSync(w) ? readdirSync(w) : [];
  const reviewers = [...new Set(files.filter(f => /^cand-.+\.json$/.test(f)).map(f => f.slice(5, -5).replace(/-\d+$/, '')))].sort();
  const chunksDir = join(w, 'chunks');
  const diff = join(w, 'context.diff');
  return {
    changed: existsSync(diff) ? stats(parseDiff(readFileSync(diff, 'utf8'))).changed : null,
    reviewers,
    chunks: existsSync(chunksDir) ? readdirSync(chunksDir).length : 0,
    recheckItems: readJson(join(w, 'contested.json'), []).length,
  };
}

export function logEntry({ key, mode, pr = null, ticket = null, head = null, skill, run, verified, built, usage = null,
  posted = [], declined = [], edited = [], comments = {}, now = new Date() }) {
  const builtById = new Map(built.map(b => [b.id, b]));
  const findings = (verified.findings ?? []).map(f => {
    const b = builtById.get(f.id);
    const { confidence, reason } = b ? { confidence: b.confidence, reason: b.confidenceReason ?? '' } : confidenceOf(f);
    return {
      id: f.id, verdict: f.verdict, unconfirmed: !!f.unconfirmed, severity: f.severity ?? null, status: b?.status ?? null,
      dimension: f.dimension ?? null, reviewers: b?.reviewers ?? [...new Set((f.sources ?? []).map(s => s.replace(/-\d+$/, '')))],
      repo: f.repo ?? null, path: f.path ?? null, line: f.line ?? null, match: f.match ?? null, claim: f.claim ?? null,
      confidence, confidenceReason: reason, tokens: b?.tokens ?? null,
      reason: f.verdict === 'confirmed' ? null : f.reason ?? null, recheck: f.recheck ?? null,
      posted: posted.includes(f.id) ? true : declined.includes(f.id) ? false : null,
      edited: edited.includes(f.id), commentId: comments[f.id] ?? null,
    };
  });
  const totalTokens = usage ? Object.values(usage).reduce((s, n) => s + (Number(n) || 0), 0) : null;
  return { v: LOG_VERSION, at: now.toISOString(), key, mode, pr, ticket, head, skill, run, usage, totalTokens, findings };
}

export function appendLog(path, entry) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + '\n');
}

const list = v => String(v ?? '').split(',').map(s => s.trim()).filter(Boolean);

export function parseArgs(args) {
  const [cmd, key, w, ...rest] = args;
  if (cmd !== 'append' || !key || !w) return null;
  const o = { key, w, mode: 'pr', pr: null, ticket: null, head: null, posted: [], declined: [], edited: [], comments: {} };
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, v] = [rest[i], rest[i + 1]];
    if (v === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--mode') o.mode = v;
    else if (flag === '--pr') {
      const [ws, repo, id] = v.split('/');
      if (!ws || !repo || !/^\d+$/.test(id ?? '')) throw new Error(`--pr must be <ws>/<repo>/<id>, got "${v}"`);
      o.pr = { ws, repo, id: Number(id) };
    }
    else if (flag === '--ticket') o.ticket = v || null;
    else if (flag === '--head') o.head = v || null;
    else if (['--posted', '--declined', '--edited'].includes(flag)) o[flag.slice(2)] = list(v);
    else if (flag === '--comments') {
      for (const pair of list(v)) {
        const [id, cid] = pair.split('=');
        if (!id || !/^\d+$/.test(cid ?? '')) throw new Error(`--comments takes <finding>=<commentId>, got "${pair}"`);
        o.comments[id] = Number(cid);
      }
    }
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!['pr', 'local'].includes(o.mode)) throw new Error(`--mode must be pr or local`);
  return o;
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  const usage = 'usage: runlog.mjs append <key> <work-dir> [--mode pr|local] [--pr <ws>/<repo>/<id>] [--ticket <KEY>] [--head <sha>]\n'
    + '         [--posted f1,f2] [--declined f3] [--edited f2] [--comments f1=<commentId>,f2=<commentId>]';
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`runlog.mjs: ${e.message}\n${usage}`); process.exit(2); }
  if (!o) { console.error(usage); process.exit(2); }
  const verified = readJson(join(o.w, 'verified.json'));
  const built = readJson(join(o.w, 'factcheck.json'));
  if (!verified || !built) { console.log(JSON.stringify({ logged: null, reason: 'no verified.json or factcheck.json in the work dir' })); process.exit(0); }
  const entry = logEntry({ ...o, skill: { version: skillVersion(), model: readModel() }, run: runContext(o.w),
    verified, built, usage: readJson(join(o.w, 'usage.json')) });
  const p = logPath(o.key);
  appendLog(p, entry);
  console.log(JSON.stringify({ logged: p, findings: entry.findings.length }));
}
