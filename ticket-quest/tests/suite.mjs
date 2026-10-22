#!/usr/bin/env node
// Behavioural test suite for the ticket-quest skill. Agents do the running and grading; this script
// builds their prompts and checks the graded results against each scenario's pass bar.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENARIOS = join(HERE, 'scenarios');
export const MIN_RUNS = 3;

export function loadRubrics(dir = SCENARIOS) {
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => JSON.parse(readFileSync(join(dir, d.name, 'rubric.json'), 'utf8')));
}

function fill(template, slots) {
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in slots ? slots[k] : m));
}

export function runPrompt(scenarioId, skillFile, answerFile) {
  const scenario = join(SCENARIOS, scenarioId, 'scenario.md');
  if (!existsSync(scenario)) throw new Error(`unknown scenario: ${scenarioId}`);
  return [
    'Read these two files and nothing else:',
    `1. ${resolve(skillFile)} — your operating instructions as the ticket-quest orchestrator.`,
    `2. ${scenario} — the ticket and what you found.`,
    '',
    'Then answer exactly what the scenario\'s "What to produce" section asks (parts A, B, C).',
    `Write the answer to ${resolve(answerFile)} and reply with one line: "written".`,
    'Do not create, edit or run anything else.',
  ].join('\n');
}

export function gradePrompt(scenarioId, answerFile, runId, outFile) {
  const template = readFileSync(join(HERE, 'grader.md'), 'utf8');
  return fill(template, {
    SCENARIO_FILE: join(SCENARIOS, scenarioId, 'scenario.md'),
    RUBRIC_FILE: join(SCENARIOS, scenarioId, 'rubric.json'),
    ANSWER_FILE: resolve(answerFile),
    RUN_ID: runId,
    OUT_FILE: resolve(outFile),
  });
}

// grades: parsed grader outputs. Returns one row per rubric, problems that make a run invalid, and
// warnings. The per-criterion scores carry the evidence, so they decide the total; a grader's own
// total that disagrees is only a warning.
export function summarize(grades, rubrics) {
  const problems = [];
  const warnings = [];
  const rows = rubrics.map(r => {
    const ids = r.criteria.map(c => c.id);
    const mine = grades.filter(g => g.scenario === r.id);
    const totals = [];
    for (const g of mine) {
      const keys = Object.keys(g.scores ?? {});
      const missing = ids.filter(id => !keys.includes(id));
      const extra = keys.filter(k => !ids.includes(k));
      const bad = keys.filter(k => g.scores[k] !== 0 && g.scores[k] !== 1);
      if (missing.length || extra.length || bad.length) {
        problems.push(`${r.id} run ${g.run}: criteria mismatch (missing ${missing.join(',') || '-'}, extra ${extra.join(',') || '-'}, non-0/1 ${bad.join(',') || '-'})`);
        continue;
      }
      const total = ids.reduce((s, id) => s + g.scores[id], 0);
      if (g.total !== total) warnings.push(`${r.id} run ${g.run}: grader's total ${g.total} != sum of scores ${total}; using ${total}`);
      totals.push(total);
    }
    if (totals.length < MIN_RUNS) problems.push(`${r.id}: ${totals.length} valid runs, need ${MIN_RUNS}`);
    const mean = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
    const min = totals.length ? Math.min(...totals) : 0;
    const pass = totals.length >= MIN_RUNS && mean >= r.pass.mean && min >= r.pass.min;
    return { scenario: r.id, totals, mean: Math.round(mean * 100) / 100, min, bar: r.pass, max: ids.length, pass };
  });
  return { rows, problems, warnings, pass: problems.length === 0 && rows.every(r => r.pass) };
}

function readGrades(dir) {
  return readdirSync(dir).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const opt = name => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
  switch (cmd) {
    case 'list':
      for (const r of loadRubrics()) console.log(`${r.id}  pass: mean >= ${r.pass.mean}, min >= ${r.pass.min} of ${r.criteria.length}`);
      return 0;
    case 'prompt':
      console.log(runPrompt(rest[0], opt('skill'), opt('answer')));
      return 0;
    case 'grade-prompt':
      console.log(gradePrompt(rest[0], opt('answer'), opt('run'), opt('out')));
      return 0;
    case 'check': {
      const result = summarize(readGrades(rest[0]), loadRubrics());
      for (const r of result.rows) {
        console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.scenario}  runs ${r.totals.join(',') || '-'}  mean ${r.mean}/${r.max} (bar ${r.bar.mean})  min ${r.min} (bar ${r.bar.min})`);
      }
      for (const p of result.problems) console.log(`INVALID  ${p}`);
      for (const w of result.warnings) console.log(`WARN  ${w}`);
      return result.pass ? 0 : 1;
    }
    default:
      console.error('usage: suite.mjs list | prompt <scenario> --skill <SKILL.md> --answer <file>\n'
        + '       | grade-prompt <scenario> --answer <file> --run <id> --out <file> | check <grades dir>');
      return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
