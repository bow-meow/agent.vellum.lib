#!/usr/bin/env node
// SKILL.md step 9 and references/spend.md: compares a run's tokens with logged runs of the same level
// and size, and keeps notes on the repairs made to the skill, so a later run can tell if one worked.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEntries } from './calibrate.mjs';
import { nativePath } from './env.mjs';
import { runlogArgs } from './finish.mjs';
import { levelName, levelOf } from './levels.mjs';
import { logDir, runContext, skillVersion } from './runlog.mjs';
import { stateRoot } from './state.mjs';

export const SIZE_BANDS = [100, 400, 1000, 2500, Infinity];
export const MIN_SAMPLE = 3;
export const HIGH_RATIO = 1.3;
export const AGENT_HIGH_RATIO = 2;
export const AGENT_MIN_EXCESS = 100000;
export const VERDICTS = ['worked', 'no-effect', 'worse', 'reverted'];
export const PLUGIN = 'amag-pr-review';

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p, fallback = null) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);
const sum = o => Object.values(o ?? {}).reduce((s, n) => s + (Number(n) || 0), 0);
const round2 = n => Math.round(n * 100) / 100;
const k = n => `${Math.round(n / 1000)}k`;

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const bandOf = changed => SIZE_BANDS.findIndex(b => changed < b);

// Runs logged before levels existed have no run.level; they were medium. Runs logged before the reviewer
// model was recorded ran Sonnet at low and Opus otherwise.
export const levelOfEntry = e => e.run?.level ?? 'medium';
export const modelOfEntry = e => e.run?.reviewerModel ?? (levelOfEntry(e) === 'low' ? 'sonnet' : 'opus');

// Only runs on the same reviewer model compare: a model change moves every agent's tokens at once.
export function baseline(entries, level, changed, model = null) {
  const atLevel = entries.filter(e => levelOfEntry(e) === level && (!model || modelOfEntry(e) === model) && e.usage && e.run?.changed != null);
  const band = atLevel.filter(e => bandOf(e.run.changed) === bandOf(changed));
  const thin = band.length < MIN_SAMPLE;
  const perKey = {};
  for (const e of thin ? atLevel : band) for (const [key, v] of Object.entries(e.usage)) (perKey[key] ??= []).push(Number(v) || 0);
  return {
    sample: band.length, thin, total: thin ? null : median(band.map(e => sum(e.usage))),
    agents: Object.fromEntries(Object.entries(perKey).map(([key, v]) => [key, median(v)])),
  };
}

// Several reviewer agents (one per chunk) report under one usage key, so a key's expected calls is
// how many dispatched agents share it; anything above that is a retry or a coverage send-back.
export function assess({ usage, calls = {}, expectedCalls = {}, promptBytes = {}, base }) {
  const total = sum(usage);
  const agents = Object.entries(usage).map(([key, tokens]) => {
    const typical = base.agents[key] ?? null;
    return { key, tokens, typical, ratio: typical ? round2(tokens / typical) : null, calls: calls[key] ?? null,
      expectedCalls: expectedCalls[key] ?? 1, promptKB: promptBytes[key] != null ? Math.round(promptBytes[key] / 1024) : null };
  }).sort((a, b) => (b.tokens - (b.typical ?? b.tokens)) - (a.tokens - (a.typical ?? a.tokens)) || b.tokens - a.tokens);
  const ratio = base.total ? round2(total / base.total) : null;
  const why = [];
  if (ratio != null && ratio >= HIGH_RATIO) why.push(`total ${k(total)} is ${ratio}× the typical ${k(base.total)} for this level and size`);
  if (!base.thin) {
    for (const a of agents) {
      if (a.ratio != null && a.ratio >= AGENT_HIGH_RATIO && a.tokens - a.typical >= AGENT_MIN_EXCESS) why.push(`${a.key}: ${k(a.tokens)}, ${a.ratio}× its typical ${k(a.typical)}`);
    }
  }
  for (const a of agents) if (a.calls != null && a.calls > a.expectedCalls) why.push(`${a.key}: ${a.calls} reports for ${a.expectedCalls} agent(s), so retries or coverage send-backs`);
  return { total, typical: base.total, ratio, sample: base.sample, thin: base.thin, high: why.length > 0, why, agents };
}

function dispatchFacts(W) {
  const list = readJson(join(W, 'dispatch.json'), []) ?? [];
  const keyOf = new Map(list.map(a => [a.agent, a.usageKey ?? a.reviewer ?? a.agent]));
  const expectedCalls = {};
  for (const key of keyOf.values()) expectedCalls[key] = (expectedCalls[key] ?? 0) + 1;
  const promptBytes = {};
  const dir = join(W, 'prompts');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter(f => f.endsWith('.md'))) {
      const name = f.slice(0, -3);
      const key = keyOf.get(name) ?? name;
      promptBytes[key] = (promptBytes[key] ?? 0) + statSync(join(dir, f)).size;
    }
  }
  return { expectedCalls, promptBytes };
}

export function findSource({ env = process.env, root = stateRoot(), skillDir = SKILL_DIR } = {}) {
  const cfg = readJson(join(root, '.spend', 'config.json'), {}) ?? {};
  const self = /[\\/]plugins[\\/]cache[\\/]/i.test(skillDir) ? null : resolve(skillDir, '..', '..', '..');
  return [env.PR_REVIEW_SOURCE, cfg.source, self].filter(Boolean)
    .find(c => existsSync(join(c, PLUGIN, 'skills', PLUGIN, 'SKILL.md'))) ?? null;
}

const defaultGit = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function sourceState(path, git = defaultGit) {
  if (!path) return null;
  try {
    return { path, branch: git(path, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), head: git(path, ['rev-parse', 'HEAD']).trim(),
      clean: git(path, ['status', '--porcelain']).trim() === '' };
  } catch { return null; }
}

// notes.jsonl is append-only: a note line, then a settle line for the same id once a later run judges it.
export const notesPath = (root = stateRoot()) => join(root, '.spend', 'notes.jsonl');

export function loadNotes(path = notesPath()) {
  if (!existsSync(path)) return [];
  const byId = new Map();
  for (const line of readFileSync(path, 'utf8').split('\n').filter(l => l.trim())) {
    const e = JSON.parse(line);
    if (e.type === 'note') byId.set(e.id, { ...e, settled: null });
    else if (e.type === 'settle' && byId.has(e.id)) byId.get(e.id).settled = e;
  }
  return [...byId.values()];
}

const ratiosFor = (a, keys) => Object.fromEntries(keys.map(key => [key, a.agents.find(x => x.key === key)?.ratio ?? null]));

// live: whether the installed skill already contains the repair's commit, so this run measured it.
export function openNotes(notes, { level, a, source, installed, git = defaultGit }) {
  return notes.filter(n => !n.settled && n.level === level).map(n => {
    let live = null;
    if (n.commit && source && installed) {
      try { git(source, ['merge-base', '--is-ancestor', n.commit, installed]); live = true; } catch { live = false; }
    }
    return { id: n.id, at: n.at, cause: n.cause, repair: n.repair, targets: n.targets, commit: n.commit, live,
      before: n.before, now: { ratio: a.ratio, agents: ratiosFor(a, n.targets ?? []) } };
  });
}

export function report(w, { entries = loadEntries(logDir()).entries, notes = loadNotes(), source = sourceState(findSource()),
  installed = skillVersion(), git = defaultGit } = {}) {
  const W = nativePath(w);
  const usage = readJson(join(W, 'usage.json'), null);
  if (!usage || !Object.keys(usage).length) return { skipped: true, why: 'no usage.json: no agent tokens were recorded this run' };
  const run = runContext(W);
  const level = levelName(run.level);
  const { expectedCalls, promptBytes } = dispatchFacts(W);
  const model = run.reviewerModel ?? levelOf(level).reviewerModel;
  const base = baseline(entries, level, run.changed ?? 0, model);
  const a = assess({ usage, calls: run.calls, expectedCalls, promptBytes, base });
  const repos = readJson(join(W, 'repos.json'), null);
  const runKey = repos ? runlogArgs(repos, [])[0] : null;
  const out = { level, model, context: run.context, changed: run.changed, chunks: run.chunks, runKey, ...a, installed,
    source, notes: openNotes(notes, { level, a, source: source?.path, installed, git }) };
  writeFileSync(join(W, 'spend.json'), JSON.stringify(out, null, 2));
  return out;
}

export function note(w, file, { path = notesPath(), now = new Date() } = {}) {
  const spend = readJson(join(nativePath(w), 'spend.json'), null);
  if (!spend || spend.skipped) throw new Error(`no spend.json in ${w}: run spend.mjs report first`);
  const n = readJson(nativePath(file), null);
  for (const f of ['cause', 'repair']) if (!n?.[f]) throw new Error(`${file} needs a "${f}"`);
  const targets = Array.isArray(n.targets) ? n.targets : [];
  const id = `r${loadNotes(path).length + 1}`;
  const entry = { type: 'note', id, at: now.toISOString(), level: spend.level, runKey: spend.runKey, skill: spend.installed,
    cause: n.cause, repair: n.repair, targets, commit: n.commit ?? null, expect: n.expect ?? null,
    before: { total: spend.total, ratio: spend.ratio, changed: spend.changed, agents: ratiosFor(spend, targets) } };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + '\n');
  return { noted: id, path };
}

export function settle(w, id, verdict, why, { path = notesPath(), now = new Date() } = {}) {
  if (!VERDICTS.includes(verdict)) throw new Error(`verdict must be one of ${VERDICTS.join(', ')}`);
  const n = loadNotes(path).find(x => x.id === id);
  if (!n) throw new Error(`no repair note ${id}`);
  if (n.settled) throw new Error(`${id} is already settled: ${n.settled.verdict}`);
  const spend = readJson(join(nativePath(w), 'spend.json'), null);
  const after = spend && !spend.skipped ? { total: spend.total, ratio: spend.ratio, changed: spend.changed, agents: ratiosFor(spend, n.targets ?? []) } : null;
  appendFileSync(path, JSON.stringify({ type: 'settle', id, at: now.toISOString(), verdict, why: why || null, runKey: spend?.runKey ?? null, after }) + '\n');
  return { settled: id, verdict };
}

export const COMPARE_BY = {
  context: e => e.run?.context ?? 'not logged',
  model: modelOfEntry,
};

// Logged runs of one level side by side, per size band, grouped by a setting: what the setting costs in
// tokens and what it finds. Runs differ in what they review, so read it as a trend, not a verdict.
export function compare(entries, { level, by }) {
  if (!COMPARE_BY[by]) throw new Error(`compare by ${Object.keys(COMPARE_BY).join(' or ')}`);
  const rows = new Map();
  for (const e of entries.filter(e => levelOfEntry(e) === level && e.usage && e.run?.changed != null)) {
    const [band, value] = [bandOf(e.run.changed), COMPARE_BY[by](e)];
    const key = `${band}|${value}`;
    if (!rows.has(key)) rows.set(key, { band, value, runs: [] });
    rows.get(key).runs.push(e);
  }
  return [...rows.values()].map(({ band, value, runs }) => {
    const confirmed = e => (e.findings ?? []).filter(f => f.verdict === 'confirmed');
    return {
      lines: `${band > 0 ? SIZE_BANDS[band - 1] : 0}-${SIZE_BANDS[band] === Infinity ? '' : SIZE_BANDS[band] - 1}`, [by]: value, runs: runs.length,
      tokens: median(runs.map(e => sum(e.usage))),
      tokensPer100Lines: median(runs.map(e => Math.round(sum(e.usage) / Math.max(e.run.changed, 1) * 100))),
      confirmedHighMedium: median(runs.map(e => confirmed(e).filter(f => /^(High|Medium)$/.test(f.severity ?? '')).length)),
      confirmed: median(runs.map(e => confirmed(e).length)),
      dropped: median(runs.map(e => (e.findings ?? []).filter(f => f.verdict === 'dropped').length)),
    };
  }).sort((a, b) => a.lines.localeCompare(b.lines, undefined, { numeric: true }) || String(a[by]).localeCompare(String(b[by])));
}

const statusPaths = text => text.split('\n').filter(Boolean).map(l => ({ code: l.slice(0, 2), path: l.slice(3).replace(/^"|"$/g, '').split(' -> ').at(-1) }));

const defaultTests = source => {
  const dir = join(source, PLUGIN, 'skills', PLUGIN, 'scripts', 'test');
  const files = readdirSync(dir).filter(f => f.endsWith('.test.mjs')).map(f => join(dir, f));
  execFileSync(process.execPath, ['--test', ...files], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
};

// Commits only a repair made on a tree that was clean at report time and has not moved since, touching
// only this plugin, with its tests passing; a failing repair is rolled back so the tree is clean again.
export function commit(w, messageFile, { git = defaultGit, tests = defaultTests, rm = p => rmSync(p, { recursive: true, force: true }) } = {}) {
  const spend = readJson(join(nativePath(w), 'spend.json'), null);
  const message = resolve(nativePath(messageFile));
  if (!existsSync(message)) throw new Error(`no commit message at ${message}`);
  const src = spend?.source;
  if (!src?.path) throw new Error('no source checkout: record the repair as a proposal in the note instead');
  if (!src.clean) throw new Error(`${src.path} had uncommitted changes at report time: not committing over them`);
  const now = sourceState(src.path, git);
  if (now?.head !== src.head || now?.branch !== src.branch) throw new Error(`${src.path} moved since the report (${src.branch}@${src.head.slice(0, 8)}): not committing`);
  const changed = statusPaths(git(src.path, ['status', '--porcelain', '-uall']));
  if (!changed.length) throw new Error('nothing changed in the source checkout');
  const outside = changed.filter(c => !c.path.startsWith(`${PLUGIN}/`));
  if (outside.length) throw new Error(`changes outside ${PLUGIN}/: ${outside.map(c => c.path).join(', ')}`);
  try { tests(src.path); } catch (e) {
    git(src.path, ['checkout', '--', PLUGIN]);
    for (const c of changed.filter(c => c.code === '??')) rm(join(src.path, c.path));
    const lines = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim().split('\n');
    const failed = lines.filter(l => /^\s*not ok\b/.test(l));
    const out = (failed.length ? failed : lines.slice(-15)).join('\n');
    throw new Error(`tests failed, repair rolled back:\n${out || e.message}`);
  }
  git(src.path, ['add', '-A', '--', PLUGIN]);
  git(src.path, ['commit', '-q', '-F', message]);
  return { committed: git(src.path, ['rev-parse', '--short=12', 'HEAD']).trim(), branch: src.branch, files: changed.map(c => c.path) };
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  const usageText = 'usage: spend.mjs report <W>                          this run against logged runs of its level and size → spend.json\n'
    + '       spend.mjs note <W> <note.json>               record a repair: {cause, repair, targets, commit?, expect?}\n'
    + '       spend.mjs settle <W> <id> <' + VERDICTS.join('|') + '> <why>\n'
    + '       spend.mjs commit <W> <message-file>          test and commit the repair in the source checkout\n'
    + '       spend.mjs compare <level> <context|model>    logged runs of a level by size band and setting: tokens and findings';
  const [cmd, w, ...rest] = process.argv.slice(2);
  const run = () => {
    if (cmd === 'report' && w) return report(w);
    if (cmd === 'note' && w && rest[0]) return note(w, rest[0]);
    if (cmd === 'settle' && w && rest.length >= 2) return settle(w, rest[0], rest[1], rest.slice(2).join(' '));
    if (cmd === 'commit' && w && rest[0]) return commit(w, rest[0]);
    if (cmd === 'compare' && w && rest[0]) return compare(loadEntries(logDir()).entries, { level: levelName(w), by: rest[0] });
    console.error(usageText);
    process.exit(2);
  };
  try { console.log(JSON.stringify(run(), null, 2)); } catch (e) { console.error(`spend.mjs: ${e.message}`); process.exit(1); }
}
