#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BLOCKING = new Set(['High', 'Medium']);
const RANK = { High: 0, Medium: 1, Low: 2, 'Low/nit': 3, Info: 4 };
const STATUS = { High: 'critical', Medium: 'blocking', Low: 'suggestion', 'Low/nit': 'nit', Info: 'info' };

const worst = cands => cands.reduce((a, c) => (a && RANK[a] <= RANK[c.severity] ? a : c.severity), null);

// A blocking candidate that verify dropped, graded below blocking, or never accounted for at all.
export function contested(verified, candidates) {
  const byId = new Map(candidates.map(c => [c.id, c]));
  const out = [];
  const seen = new Set();
  for (const f of verified.findings) {
    const srcs = (f.sources ?? []).map(id => byId.get(id)).filter(Boolean);
    srcs.forEach(c => seen.add(c.id));
    const from = worst(srcs);
    if (!BLOCKING.has(from)) continue;
    if (f.verdict === 'confirmed' && BLOCKING.has(f.severity)) continue;
    out.push({ id: f.id, kind: f.verdict === 'dropped' ? 'dropped' : 'downgraded', candidates: srcs,
      verdict: f.verdict, severity: f.severity, reason: f.reason ?? '' });
  }
  for (const c of candidates)
    if (!seen.has(c.id) && BLOCKING.has(c.severity))
      out.push({ id: c.id, kind: 'omitted', candidates: [c], verdict: null, severity: null, reason: '' });
  return out;
}

function checkOverturn(r) {
  const f = r.finding;
  if (!f || f.verdict !== 'confirmed' || !BLOCKING.has(f.severity) || !f.issue || !f.match)
    throw new Error(`overturn of ${r.id} needs a confirmed High/Medium finding with issue and match`);
}

export function apply(verified, decisions, contestedList) {
  const pending = new Map(contestedList.map(c => [c.id, c]));
  const findings = verified.findings.map(f => ({ ...f }));
  let n = 0;
  for (const r of decisions) {
    const c = pending.get(r.id);
    if (!c) throw new Error(`recheck decision for ${r.id}, which was not contested`);
    pending.delete(r.id);
    if (r.decision === 'uphold') continue;
    if (r.decision !== 'overturn') throw new Error(`decision for ${r.id} must be uphold or overturn`);
    checkOverturn(r);
    const restored = { ...r.finding, status: STATUS[r.finding.severity], recheck: r.reason ?? '' };
    if (c.kind === 'omitted') {
      findings.push({ ...restored, id: `r${++n}`, sources: [c.id] });
    } else {
      const i = findings.findIndex(f => f.id === c.id);
      findings[i] = { ...restored, id: c.id, sources: findings[i].sources };
    }
  }
  if (pending.size) throw new Error(`no recheck decision for: ${[...pending.keys()].join(', ')}`);
  return { ...verified, findings };
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  const [cmd, verifiedFile, ...rest] = process.argv.slice(2);
  const read = f => JSON.parse(readFileSync(f, 'utf8'));
  try {
    if (cmd === 'contested' && verifiedFile && rest.length) {
      console.log(JSON.stringify(contested(read(verifiedFile), rest.flatMap(read)), null, 2));
    } else if (cmd === 'apply' && rest.length === 2) {
      console.log(JSON.stringify(apply(read(verifiedFile), read(rest[0]), read(rest[1])), null, 2));
    } else {
      console.error('usage: recheck.mjs contested <verified.json> <cand-*.json...> | apply <verified.json> <recheck.json> <contested.json>');
      process.exit(2);
    }
  } catch (e) { console.error(`recheck.mjs: ${e.message}`); process.exit(1); }
}
