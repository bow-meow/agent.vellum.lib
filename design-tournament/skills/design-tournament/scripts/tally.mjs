#!/usr/bin/env node
// Decision logic for design-tournament. Pure functions; the CLI guard at the
// bottom lets the skill run it on a judge-results JSON file.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// A majority of judges calling the top design inadequate aborts the run. The
// tournament reports failure rather than crowning the least-bad entry.
export function tally(judges) {
  if (!Array.isArray(judges) || judges.length === 0)
    throw new Error('tally: need at least one judge result');

  const inadequate = judges.filter((j) => j.adequate === false).length;
  if (inadequate * 2 > judges.length)
    return { outcome: 'inadequate', inadequate, total: judges.length };

  const firstPlaces = {};
  for (const j of judges) {
    const top = j.ranking?.[0];
    if (!top) throw new Error(`tally: judge ${j.id} has no ranking`);
    firstPlaces[top] = (firstPlaces[top] || 0) + 1;
  }

  const max = Math.max(...Object.values(firstPlaces));
  const leaders = Object.keys(firstPlaces).filter((d) => firstPlaces[d] === max);
  if (leaders.length > 1) return { outcome: 'tie', leaders, firstPlaces };

  const winner = leaders[0];
  const grafts = judges.map((j) => j.graft).filter((g) => g && g.from !== winner);
  return { outcome: 'winner', winner, firstPlaces, grafts };
}

// A design must point at real code. The extension must start with a letter so
// version strings like "1.0:2" are not mistaken for a file reference.
const CITATION = /[\w./\\-]+\.[A-Za-z]\w*:\d+/;

export function hasCitation(body) {
  return CITATION.test(body ?? '');
}

// Length is capped structurally rather than left to a judge's discretion:
// without a cap, "more thorough" and "longer" are indistinguishable to a judge
// and the tournament reliably selects for over-engineering.
export function validateEntries(designs, cap = 600) {
  const accepted = [], rejected = [];
  for (const d of designs) {
    const words = (d.body ?? '').trim().split(/\s+/).filter(Boolean).length;
    if (!hasCitation(d.body)) rejected.push({ id: d.id, reason: 'no-citation' });
    else if (words > cap) rejected.push({ id: d.id, reason: 'over-length', words });
    else accepted.push(d);
  }
  return { accepted, rejected };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node tally.mjs <judge-results.json>');
    process.exit(2);
  }
  console.log(JSON.stringify(tally(JSON.parse(readFileSync(file, 'utf8'))), null, 2));
}
