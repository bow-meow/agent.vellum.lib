export const meta = {
  name: 'design-tournament',
  description: 'Three stance-diverse designs, judged blind by fresh agents',
  phases: [
    { title: 'Design', detail: 'one agent per assigned stance, each reading real code' },
    { title: 'Judge', detail: 'fresh agents score anonymized designs against the fixed rubric' },
  ],
};

// Synthesis is NOT a phase here. It needs the tally, and the tally lives in
// scripts/tally.mjs which this sandbox cannot import (no filesystem). The skill
// runs the tally after this workflow returns, then dispatches the synthesiser —
// the 7th agent — with the winner and grafts in hand.

const { problem, rubric, stances, cap = 600 } = args;

// Mirrors CITATION in scripts/tally.mjs. It is duplicated because the sandbox
// cannot import that module, and the gate has to run before judging. A test in
// tests/tally.test.mjs asserts the two literals stay identical.
const CITATION = /[\w./\\-]+\.[A-Za-z]\w*:\d+/;

const DESIGN_SCHEMA = {
  type: 'object',
  required: ['body', 'citations'],
  properties: {
    body: { type: 'string', description: `The design. HARD CAP ${cap} words.` },
    citations: {
      type: 'array', items: { type: 'string' },
      description: 'Real file:line references this design is grounded in',
    },
  },
};

const JUDGE_SCHEMA = {
  type: 'object',
  required: ['ranking', 'adequate', 'scores'],
  properties: {
    ranking: {
      type: 'array', items: { type: 'string' },
      description: 'Design ids, best first',
    },
    adequate: {
      type: 'boolean',
      description: 'Does the top-ranked design clear the bar? false aborts the run if a majority agree',
    },
    scores: { type: 'object', description: 'designId -> criterion -> {score 1-5, why}' },
    graft: {
      type: 'object', description: 'The strongest idea in a design you did NOT rank first',
      properties: { from: { type: 'string' }, idea: { type: 'string' } },
    },
    concerns: {
      type: 'array', items: { type: 'string' },
      description: 'Surviving objections, including about the design you ranked first',
    },
  },
};

phase('Design');
const designs = await parallel(stances.map((s, i) => () =>
  agent(
    `You are designing a solution to this problem:\n\n${problem}\n\n` +
    `Your assigned stance is **${s.name}**: ${s.brief}\n` +
    `Design from that stance genuinely — do not hedge toward the middle.\n\n` +
    `You MUST read the real code before designing, and cite specific file:line ` +
    `references. A design citing nothing is disqualified without being judged.\n` +
    `HARD LIMIT: ${cap} words. Over-length designs are returned for compression, not judged.`,
    { label: `design:${s.name}`, phase: 'Design', schema: DESIGN_SCHEMA }
  ).then((d) => d && ({ id: String.fromCharCode(65 + i), stance: s.name, ...d }))
));

// The grounding and verbosity gates, enforced BEFORE any judge sees a design.
const returned = designs.filter(Boolean);
const rejected = [], entries = [];
for (const d of returned) {
  const words = (d.body ?? '').trim().split(/\s+/).filter(Boolean).length;
  if (!CITATION.test(d.body ?? '')) rejected.push({ id: d.id, reason: 'no-citation' });
  else if (words > cap) rejected.push({ id: d.id, reason: 'over-length', words });
  else entries.push(d);
}
if (rejected.length)
  log(`rejected before judging: ${rejected.map((r) => `${r.id} (${r.reason})`).join(', ')}`);

if (entries.length < 2) {
  return {
    aborted: 'fewer than 2 designs survived — a tournament of one is not a tournament',
    designs: returned, rejected,
  };
}

// Anonymized and independently ordered per judge: identity and stance labels are
// stripped, and the rotation removes position bias.
const anonymized = entries.map((d) => ({ id: d.id, body: d.body, citations: d.citations }));
const rotate = (arr, n) => arr.slice(n).concat(arr.slice(0, n));

phase('Judge');
const judges = await parallel([0, 1, 2].map((n) => () => {
  const shown = rotate(anonymized, n % anonymized.length);
  return agent(
    `You are judging candidate designs for this problem:\n\n${problem}\n\n` +
    `You did not write any of them. Score every design against this rubric, ` +
    `which was fixed before any design existed and may not be changed:\n\n${rubric}\n\n` +
    `Designs:\n\n` +
    shown.map((d) => `### Design ${d.id}\n${d.body}\n\nCitations: ${(d.citations || []).join(', ')}`).join('\n\n') +
    `\n\nScore each 1-5 per criterion with a one-sentence justification. Then rank them. ` +
    `Scores inform your ranking but do not mechanically determine it — one disqualifying ` +
    `flaw may outweigh a better average, provided you say why.\n` +
    `Then name the single strongest idea in a design you did NOT rank first.\n` +
    `Finally: does your top-ranked design actually clear the bar? Answer honestly — ` +
    `"none of these is adequate" is a valid and useful result.`,
    { label: `judge:${n + 1}`, phase: 'Judge', schema: JUDGE_SCHEMA }
  ).then((v) => v && ({ id: `judge-${n + 1}`, ...v }));
}));

const verdicts = judges.filter(Boolean);
if (verdicts.length === 0)
  return { aborted: 'no judge returned a verdict', designs: entries, rejected };

log(`${entries.length} designs judged by ${verdicts.length} judges`);

return { designs: entries, rejected, judges: verdicts };
