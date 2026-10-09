#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIDENCES, formatComment, readModel, stripHeader, styleIssues } from './comment.mjs';

const CERTAIN = /\b(will|always|never|must|cannot|can't|won't|guaranteed)\b/gi;
const HEDGE = /\b(might|may|could|possibly|perhaps|potentially|probably|likely|seems?)\b/gi;
const IDENT = /\b(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+|[a-z]+[A-Z]\w*|[A-Z][a-z0-9]+[A-Z]\w*|[A-Za-z0-9]*_[A-Za-z0-9_]+|[A-Z]{2,}\d*)\b/g;

const count = (re, s) => (s.match(re) || []).length;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const present = (needle, hay) => new RegExp(`(^|[^\\w])${esc(needle)}([^\\w]|$)`).test(hay);

export function facts(text) {
  const body = stripHeader(text);
  const code = [...body.matchAll(/`([^`]+)`/g)].map(m => m[1]);
  const prose = body.replace(/`[^`]+`/g, ' ');
  return {
    code,
    idents: [...new Set(prose.match(IDENT) || [])],
    numbers: [...new Set(prose.match(/\b\d+(?:\.\d+)?\b/g) || [])],
  };
}

export function factCheck(original, rewritten) {
  const missing = [];
  const f = facts(original);
  const rest = stripHeader(rewritten);
  for (const c of f.code) if (!rest.includes('`' + c + '`')) missing.push(c);
  for (const x of f.idents) if (!present(x, rest)) missing.push(x);
  for (const x of f.numbers) if (!present(x, rest)) missing.push(x);
  const certaintyDropped = count(CERTAIN, original) > count(CERTAIN, rewritten) && count(HEDGE, rewritten) > count(HEDGE, original);
  return { ok: missing.length === 0 && !certaintyDropped, missing, certaintyDropped };
}

const side = (issue, fix) => {
  const i = String(issue ?? '').trim(), f = String(fix ?? '').trim();
  return { issue: i, fix: f, text: f ? `${i}\n${f}` : i };
};

// The draft comes from the reviewer's own wording, not the verifier's copy of it, so a verifier that
// drops a fact from both draft and final is still caught. The status is the verifier's: it re-grades.
export function buildPairs(verified, candidates) {
  const byId = new Map(candidates.map(c => [c.id, c]));
  return verified.findings
    .filter(f => f.verdict === 'confirmed' && (f.issue || f.fix))
    .map(f => {
      const src = (f.sources ?? []).map(id => byId.get(id)).find(Boolean);
      const final = side(f.issue, f.fix);
      const draft = src ? (src.issue != null ? side(src.issue, src.fix) : side(src.comment, '')) : final;
      const srcs = (f.sources ?? []).map(id => byId.get(id)).filter(Boolean);
      return { id: f.id, status: f.status, confidence: confidenceOf(f, srcs), draft, final };
    });
}

// Verify re-checked the finding, so its rating wins over the reviewers'.
const confidenceOf = (f, srcs) => [f.confidence, ...srcs.map(s => s.confidence)]
  .map(c => String(c ?? '').trim().toLowerCase())
  .find(c => CONFIDENCES.includes(c)) ?? null;

const reviewerOf = candidateId => candidateId.replace(/-\d+$/, '');

// Per-finding cost isn't observable, so it's attributed: each reviewer's tokens split over the findings
// it contributed to, and everything else (verify, recheck, reviewers with no finding) split evenly over
// all findings. Every token lands on some finding, so the comments add up to the review's total.
export function estimateTokens(reviewersById, usage) {
  const ids = [...reviewersById.keys()];
  if (!usage || !ids.length) return new Map();
  const shares = new Map(ids.map(id => [id, 0]));
  let pool = 0;
  for (const [key, raw] of Object.entries(usage)) {
    const n = Number(raw) || 0;
    const owners = ids.filter(id => reviewersById.get(id).includes(key));
    if (!owners.length) { pool += n; continue; }
    for (const id of owners) shares.set(id, shares.get(id) + n / owners.length);
  }
  return new Map(ids.map(id => [id, Math.round(shares.get(id) + pool / ids.length)]));
}

export function build(verified, candidates, model, usage = null) {
  const sourcesById = new Map(verified.findings.map(f => [f.id, f.sources ?? []]));
  const pairs = buildPairs(verified, candidates);
  const reviewersById = new Map(pairs.map(({ id }) => [id, [...new Set(sourcesById.get(id).map(reviewerOf))]]));
  const tokensById = estimateTokens(reviewersById, usage);
  return pairs.map(({ id, status, confidence, draft, final }) => {
    const r = factCheck(draft.text, final.text);
    const use = r.ok ? 'final' : 'draft';
    const chosen = use === 'final' ? final : draft;
    const reviewers = reviewersById.get(id);
    const tokens = tokensById.get(id) ?? null;
    const body = formatComment({ status, model, tokens, reviewers, confidence, issue: chosen.issue, fix: chosen.fix });
    return { id, status, use, tokens, reviewers, confidence, missing: r.missing, certaintyDropped: r.certaintyDropped, style: styleIssues(body), body };
  });
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  const args = process.argv.slice(2);
  const flag = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
  const outDir = flag('--out');
  const usageFile = flag('--usage');
  const [cmd, verifiedFile, ...candFiles] = args;
  if (cmd !== 'build' || !verifiedFile || !candFiles.length) {
    console.error('usage: factcheck.mjs build <verified.json> <cand-*.json...> [--out <dir>] [--usage <usage.json>]\n'
      + '  --out writes body-<id>.txt per finding; --usage ({"<reviewer>": tokens, "verify": tokens}) adds each finding\'s share of the total');
    process.exit(2);
  }
  const cands = candFiles.flatMap(f => JSON.parse(readFileSync(f, 'utf8')));
  const usage = usageFile ? JSON.parse(readFileSync(usageFile, 'utf8')) : null;
  const out = build(JSON.parse(readFileSync(verifiedFile, 'utf8')), cands, readModel(), usage);
  if (outDir) for (const e of out) writeFileSync(join(outDir, `body-${e.id}.txt`), e.body);
  console.log(JSON.stringify(out, null, 2));
}
