#!/usr/bin/env node
// Watches ticket-quest plan files for the human's review decision and exits when one appears,
// so the orchestrator gets a completion notification instead of polling or waiting to be pinged.
//
// Run it in the BACKGROUND right after opening plan(s) at the human-review gate:
//   node watch-plan-reviews.mjs <plans-dir> [--files ABC-1,ABC-2] [--interval 5] [--timeout 7200]
//
// A "decision" is any non-empty text below the plan's review marker line
// (the line containing: YOUR REVIEW (type below this line). It exits as soon as ANY watched
// plan's decision text CHANGES from what it was at startup — which covers both a first decision
// and a fresh decision on a reopened/revised plan. On exit it prints every watched plan's current
// state (DECIDED with the verbatim text, or PENDING) as human-readable lines plus one JSON line,
// so the orchestrator can act on the answered ones and re-arm the watcher for the rest.

import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const MARKER = 'YOUR REVIEW (type below this line';

function parseArgs(argv) {
  const args = { dir: null, files: null, interval: 5, timeout: 7200 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--files') args.files = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--interval') args.interval = Number(argv[++i]);
    else if (a === '--timeout') args.timeout = Number(argv[++i]);
    else rest.push(a);
  }
  args.dir = rest[0];
  return args;
}

// Text below the marker, trimmed. Empty string means "no decision yet".
function decisionOf(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return '';
  }
  const lines = text.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.includes(MARKER));
  if (idx === -1) return '';
  return lines.slice(idx + 1).join('\n').trim();
}

function resolvePlanFiles(dir, filesFilter) {
  // Match both fix plans (SYM-1.plan.md) and companion review docs (SYM-1.testplan.md) — both carry the marker.
  let names = readdirSync(dir).filter((n) => /\.(plan|testplan)\.md$/.test(n));
  if (filesFilter) {
    names = names.filter((n) => filesFilter.some((f) => n.includes(f)));
  }
  return names.map((n) => ({ ticket: basename(n).replace(/\.(plan|testplan)\.md$/, (m) => (m.includes('testplan') ? ' (testplan)' : '')), path: join(dir, n) }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { dir, files, interval, timeout } = parseArgs(process.argv.slice(2));
  if (!dir) {
    console.error('usage: node watch-plan-reviews.mjs <plans-dir> [--files ABC-1,ABC-2] [--interval 5] [--timeout 7200]');
    process.exit(2);
  }

  const plans = resolvePlanFiles(dir, files);
  if (plans.length === 0) {
    console.error(`No *.plan.md files found in ${dir}${files ? ` matching ${files.join(',')}` : ''}`);
    process.exit(2);
  }

  const baseline = new Map(plans.map((p) => [p.ticket, decisionOf(p.path)]));
  console.error(
    `[watch-plan-reviews] watching ${plans.length} plan(s) in ${dir}: ${plans.map((p) => p.ticket).join(', ')}` +
      ` (interval ${interval}s, timeout ${timeout}s)`
  );

  const startedAt = Date.now();
  while (true) {
    const changed = [];
    for (const p of plans) {
      const now = decisionOf(p.path);
      if (now !== baseline.get(p.ticket)) changed.push({ ...p, decision: now });
    }
    const timedOut = timeout > 0 && (Date.now() - startedAt) / 1000 >= timeout;

    if (changed.length > 0 || timedOut) {
      const state = plans.map((p) => ({ ticket: p.ticket, decision: decisionOf(p.path) }));
      const decided = state.filter((s) => s.decision);
      const pending = state.filter((s) => !s.decision);

      console.log('=== PLAN REVIEW DECISION DETECTED ===');
      if (timedOut && changed.length === 0) console.log('(reason: timeout — no decision arrived in the window)');
      console.log('DECIDED:');
      for (const s of decided) console.log(`- ${s.ticket}: ${s.decision.replace(/\n+/g, ' / ')}`);
      console.log('PENDING:');
      for (const s of pending) console.log(`- ${s.ticket}`);
      console.log('=====================================');
      // Machine-readable, single line, for reliable parsing.
      console.log('JSON ' + JSON.stringify({ changed: changed.map((c) => c.ticket), decided, pending, timedOut }));
      process.exit(0);
    }

    await sleep(interval * 1000);
  }
}

main();
