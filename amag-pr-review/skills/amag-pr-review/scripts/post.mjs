#!/usr/bin/env node
// SKILL.md steps 7 and 8: read the user's answer, post what they picked, propose the decision.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findAccountId, findCreds, makeClient } from './bb.mjs';
import { followup, readModel } from './comment.mjs';
import { nativePath } from './env.mjs';
import { levelName, levelOf } from './levels.mjs';

// repos.json carries the Git Bash spelling; node and git.exe need the drive-letter one.
export function readJson(p, fallback = null) {
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}

export const readText = p => (existsSync(p) ? readFileSync(p, 'utf8') : '');
export const sameId =(a, b) => a != null && b != null && String(a) === String(b);
export const oneLine = (s, max = 160) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export const emptyPicks = () => ({ items: [], settled: [], stillOpen: [], notPosted: [], rules: [] });
export const loadPicks = w => ({ ...emptyPicks(), ...readJson(join(w, 'picks.json'), {}) });
export const loadOutcome = w => readJson(join(w, 'outcome.json'), []);
export const saveJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2));

const nonEmpty = v => (Array.isArray(v) ? v.length > 0 : v && typeof v === 'object' ? Object.keys(v).length > 0 : !!v);

// A missing verified.json only means "skipped" when there was nothing to verify (SKILL.md step 6);
// a contested list with no recheck.json or verified-orig.json means recheck never got as far as apply.
// A failure the files can't show (apply rejecting recheck's answer twice) is a <step>.failed marker.
export function reviewProblems(w) {
  const problems = [];
  const has = f => existsSync(join(w, f));
  for (const [file, step] of [['verify.failed', 'verify'], ['recheck.failed', 'recheck'], ['factcheck.failed', 'factcheck']])
    if (has(file)) problems.push(`${step} failed`);
  const uncovered = readJson(join(w, 'uncovered.json'), null);
  if (nonEmpty(uncovered)) {
    const names = Array.isArray(uncovered) ? uncovered.map(u => (typeof u === 'string' ? u : u?.dimension ?? u?.reviewer ?? JSON.stringify(u)))
      : Object.keys(uncovered);
    problems.push(`uncovered: ${names.join(', ')}`);
  }
  const files = existsSync(w) ? readdirSync(w) : [];
  const cands = files.filter(f => /^cand-.+\.json$/.test(f));
  const nothingToVerify = cands.every(f => !nonEmpty(readJson(join(w, f), []))) && !has('previous-recheck.json');
  const verified = readJson(join(w, 'verified.json'), null);
  if (!verified && !nothingToVerify && !problems.includes('verify failed')) problems.push('verify failed: no verified.json');
  if (nonEmpty(readJson(join(w, 'contested.json'), [])) && !(has('recheck.json') && has('verified-orig.json')) && !problems.includes('recheck failed'))
    problems.push('recheck failed: contested findings were never applied');
  const postable = (verified?.findings ?? []).some(f => f.verdict === 'confirmed' && (f.issue || f.fix));
  if (postable && !has('factcheck.json') && !problems.includes('factcheck failed')) problems.push('factcheck failed: no factcheck.json');
  return problems;
}

const COUNTS_WHEN_POSTED = new Set(['still-applies', 'reopen', 'answer']);

// `outcome` may be hypothetical (every item but the outside group posted) for the
// "post everything" line shown before the user picks.
export function openFindings({ items, stillOpen = [], outcome }) {
  const byN = new Map(outcome.map(o => [o.n, o]));
  let open = 0;
  for (const it of items) {
    const r = byN.get(it.n)?.result;
    if (r === 'posted') {
      if ((it.kind === 'new' || it.kind === 'reply') && it.status === 'change') open++;
      else if (COUNTS_WHEN_POSTED.has(it.kind)) open++;
    } else if (r === 'declined') {
      // A push-back kept open: an answer not posted, or an agreement whose resolve the user turned down.
      if (it.kind === 'answer' || (it.kind === 'resolve' && (it.verdict === 'conceded' || it.verdict === 'disputed'))) open++;
    }
  }
  return open + stillOpen.length;
}

export function decisionCalls(action, myState, { ws, repo, id }) {
  const call = cmd => [cmd, ws, repo, String(id)];
  if (action === 'request-changes')
    return [...(myState === 'approved' ? [call('unapprove')] : []), ...(myState === 'changes_requested' ? [] : [call('request-changes')])];
  if (action === 'approve')
    return [...(myState === 'changes_requested' ? [call('unrequest-changes')] : []), ...(myState === 'approved' ? [] : [call('approve')])];
  return [];
}

export function decision({ items, stillOpen, outcome, problems = [], pr, dryRun = false, level = null }) {
  const failed = outcome.filter(o => o.result === 'failed').map(o => `post of ${o.n} failed`);
  const holds = [...failed, ...problems];
  const open = openFindings({ items, stillOpen, outcome });
  const noApprove = open === 0 && !holds.length && !levelOf(level).approve;
  if (noApprove) holds.push(`a ${levelName(level)}-level review can't approve; review at medium or high to approve`);
  const action = holds.length ? 'hold' : open > 0 ? 'request-changes' : 'approve';
  const why = holds.length ? `Holding: ${holds.join('; ')}`
    : open > 0 ? `Request changes: ${open} open finding${open === 1 ? '' : 's'}` : 'Approve: nothing open';
  const res = { action, why, open, myState: pr?.myState ?? null, calls: [] };
  if (!pr) return { ...res, dryRun: true, why: `${why} (no PR)` };
  if (dryRun || pr.mine || (pr.state && pr.state !== 'OPEN')) {
    const reason = pr.mine ? ' (my own PR)' : dryRun ? '' : ` (PR is ${pr.state})`;
    return { ...res, dryRun: true, why: `Dry run${reason}: would ${action === 'hold' ? 'hold' : action === 'approve' ? 'approve' : 'request changes'}. ${why}` };
  }
  return { ...res, dryRun: false, calls: action === 'hold' ? [] : decisionCalls(action, pr.myState ?? null, pr) };
}

export const everythingPosted = items =>
  items.filter(it => it.group !== 'outside' && it.kind !== 'none').map(it => ({ n: it.n, result: 'posted' }));

const KEYWORDS = 'post|edit|flip|rules?|none|nothing';
const TEXT_KINDS = new Set(['new', 'reply', 'answer']);

const blank = () => ({ post: [], edit: [], flip: [], rules: [], voice: null, none: false, unclear: null });
const unclear = why => ({ ...blank(), unclear: why });

export function isFlippable(picks, n) {
  const it = picks.items.find(i => i.n === n);
  if (it) return it.kind === 'answer' || it.flipped || (it.kind === 'resolve' && it.verdict === 'conceded');
  return picks.settled.some(s => s.n === n && s.verdict === 'conceded');
}

// Anything that doesn't map to numbers or contradicts itself comes back as `unclear`,
// so the model asks rather than guesses.
export function parseAnswer(answer, picks) {
  let s = String(answer ?? '').trim();
  if (!s) return unclear('empty answer');
  const edits = [];
  // Edit text keeps its own commas; only a comma that opens another clause ends it.
  s = s.replace(new RegExp(`\\bedit\\s+(\\d+)\\s*:\\s*([^;\\n]*?)(?=\\s*[;\\n]|\\s*,\\s*(?:${KEYWORDS}|as)\\b|$)`, 'gi'), (_, n, t) => { edits.push({ n: Number(n), text: t.trim() }); return ' ; '; });
  if (/\bedit\b/i.test(s)) return unclear('"edit" needs a number and what to change: "edit 2: <what to change>"');
  const voices = [];
  s = s.replace(new RegExp(`\\bas\\s+([^;,\\n]+?)\\s*(?=$|[;,\\n]|\\s+(?:and\\s+)?(?:${KEYWORDS})\\b)`, 'gi'), (_, v) => {
    const t = v.trim().replace(/\s+/g, ' ');
    voices.push(/^random each$/i.test(t) ? 'random each' : /^random$/i.test(t) ? 'random' : t);
    return ' ; ';
  });

  const tokens = s.toLowerCase().match(/r\d+|\d+\s*[-–]\s*\d+|\d+|[a-z]+|[^\s\w]/g) ?? [];
  let cmd = null, all = false, but = false, none = false, sawCommand = false;
  const include = [], exclude = [], flips = [], rules = [];
  for (const t of tokens) {
    if ([',', ';', '.', '&', ':', 'and', 'also', 'please', 'then'].includes(t)) continue;
    if (t === 'post') { cmd = 'post'; but = false; sawCommand = true; continue; }
    if (t === 'flip') { cmd = 'flip'; sawCommand = true; continue; }
    if (t === 'rule' || t === 'rules') { cmd = 'rule'; sawCommand = true; continue; }
    if (t === 'none' || t === 'nothing') { none = true; cmd = null; sawCommand = true; continue; }
    if (t === 'all' && cmd === 'post') { all = true; continue; }
    if (['but', 'except', 'excluding', 'without'].includes(t) && cmd === 'post' && all) { but = true; continue; }
    const range = t.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range || /^\d+$/.test(t)) {
      if (cmd === 'post') (but ? exclude : include).push(range ? { from: +range[1], to: +range[2] } : { n: +t });
      else if (cmd === 'flip' && !range) flips.push(+t);
      else if (cmd === 'rule' && !range) rules.push(`R${t}`);
      else return unclear(`"${t}" isn't tied to post, flip or rule`);
      continue;
    }
    if (/^r\d+$/.test(t) && cmd === 'rule') { rules.push(t.toUpperCase()); continue; }
    return unclear(`can't read "${t}"`);
  }
  if (!sawCommand && !edits.length) return unclear('no post, edit, flip, rule or none in the answer');
  if (none && (include.length || all || edits.length || flips.length || rules.length))
    return unclear('"none" contradicts the rest of the answer');
  if (tokens.includes('post') && !all && !include.length) return unclear('"post" without numbers or "all"');

  const byN = new Map(picks.items.map(it => [it.n, it]));
  const postable = n => { const it = byN.get(n); return it && it.kind !== 'none'; };
  const post = new Set();
  for (const x of include) {
    if (x.n != null) {
      if (!postable(x.n)) return unclear(byN.has(x.n) || picks.settled.some(st => st.n === x.n) ? `${x.n} has nothing to post` : `there is no item ${x.n}`);
      post.add(x.n);
      continue;
    }
    if (x.from > x.to) return unclear(`range ${x.from}-${x.to} runs backwards`);
    const inRange = picks.items.filter(it => it.n >= x.from && it.n <= x.to && it.group !== 'outside' && it.kind !== 'none');
    if (!inRange.length) return unclear(`nothing to post in ${x.from}-${x.to}`);
    inRange.forEach(it => post.add(it.n));
  }
  const excluded = new Set();
  for (const x of exclude) {
    const ns = x.n != null ? [x.n] : picks.items.filter(it => it.n >= x.from && it.n <= x.to).map(it => it.n);
    for (const n of ns) {
      if (!byN.has(n)) return unclear(`there is no item ${n} to leave out`);
      if (post.has(n)) return unclear(`${n} is both posted and left out`);
      excluded.add(n);
    }
  }
  if (all) for (const it of picks.items) if (it.group !== 'outside' && it.kind !== 'none' && !excluded.has(it.n)) post.add(it.n);

  const seenEdit = new Set();
  for (const e of edits) {
    const it = byN.get(e.n);
    if (!it || !TEXT_KINDS.has(it.kind)) return unclear(`${e.n} has no comment text to edit`);
    if (!e.text) return unclear(`edit ${e.n} doesn't say what to change`);
    if (seenEdit.has(e.n)) return unclear(`${e.n} is edited twice`);
    if (excluded.has(e.n)) return unclear(`${e.n} is both left out and edited`);
    seenEdit.add(e.n);
  }
  for (const n of flips) {
    if (!isFlippable(picks, n)) return unclear(`${n} isn't a push-back, so there's nothing to flip`);
    if (excluded.has(n)) return unclear(`${n} is both left out and flipped`);
  }
  for (const r of rules) {
    const rule = picks.rules.find(x => x.id === r);
    if (!rule) return unclear(`there is no rule suggestion ${r}`);
    if (flips.includes(rule.from)) return unclear(`${r} is withdrawn when you flip ${rule.from}`);
  }
  if (voices.length > 1) return unclear(`more than one voice: ${voices.join(', ')}`);
  if (voices.length && !post.size && !edits.length) return unclear('a voice goes with a post answer');

  // An edit or flip waits for its own confirmation, so it isn't posted with the plain picks.
  const waiting = new Set([...edits.map(e => e.n), ...flips]);
  return {
    post: [...post].filter(n => !waiting.has(n)).sort((a, b) => a - b),
    edit: edits, flip: [...new Set(flips)], rules: [...new Set(rules)], voice: voices[0] ?? null, none, unclear: null,
  };
}

// A flipped conceded item becomes an answer (its rule suggestion withdrawn); a flipped
// disputed one becomes an agreement, a resolve only when the thread is our own open one.
export function flipItem(picks, n) {
  const items = picks.items.map(it => ({ ...it }));
  let it = items.find(i => i.n === n);
  let settled = picks.settled;
  if (!it) {
    const s = settled.find(x => x.n === n && x.verdict === 'conceded');
    if (!s) throw new Error(`${n} isn't a push-back`);
    settled = settled.filter(x => x !== s);
    it = { n, group: 'answer', kind: 'answer', origKind: null, findingId: null, commentId: s.commentId, parentId: s.parentId ?? null,
      path: s.path, line: s.line, side: s.side ?? 'new', severity: s.severity, status: null, verdict: 'conceded', claim: s.note ?? null,
      body: null, replyKind: 'disputed', pattern: s.pattern ?? null, ruleId: null, authorResolved: !!s.authorResolved,
      ownOpen: !!s.ownOpen, flipped: true, edited: false };
    items.push(it);
    items.sort((a, b) => a.n - b.n);
  } else if (it.flipped) {
    it.kind = it.origKind;
    it.flipped = false;
  } else if (it.kind === 'resolve' && it.verdict === 'conceded') {
    Object.assign(it, { origKind: 'resolve', kind: 'answer', replyKind: 'disputed', ruleId: null, flipped: true });
  } else if (it.kind === 'answer') {
    Object.assign(it, { origKind: 'answer', kind: it.ownOpen ? 'resolve' : 'none', replyKind: null, flipped: true });
  } else throw new Error(`${n} isn't a push-back`);
  const rules = picks.rules.filter(r => !(r.from === n && it.flipped));
  return { ...picks, items, settled, rules };
}

const linkOf = r => r?.links?.html?.href ?? null;

async function postItem(w, pr, it, { bb, model }) {
  const { ws, repo, id } = pr;
  const readBody = f => readFileSync(f, 'utf8').trim();
  const reply = async (body, file) => {
    writeFileSync(join(w, file), body);
    return bb.reply(ws, repo, id, Number(it.commentId), body.trim());
  };
  const reopenFirst = () => bb.reopen(ws, repo, id, Number(it.parentId ?? it.commentId));
  switch (it.kind) {
    case 'new': {
      const r = await bb.comment(ws, repo, id, { raw: readBody(it.body), path: it.path, side: it.side, line: it.line });
      return { postedId: r.id, link: linkOf(r) };
    }
    case 'reply': {
      const r = await bb.reply(ws, repo, id, Number(it.parentId), readBody(it.body));
      return { postedId: r.id, link: linkOf(r) };
    }
    case 'still-applies': {
      const r = await reply(followup('still-applies', { model, line: it.line }), `body-still-${it.commentId}.txt`);
      return { postedId: r.id, link: linkOf(r) };
    }
    case 'reopen': {
      await reopenFirst();
      const kind = it.replyKind === 'needs-reply' ? 'needs-reply' : 'still-applies';
      try {
        const r = await reply(followup(kind, { model, line: it.line }), `body-still-${it.commentId}.txt`);
        return { postedId: r.id, link: linkOf(r) };
      } catch (e) { throw new Error(`reopened, but the reply failed: ${e.message}`); }
    }
    case 'answer': {
      const body = followup('disputed', { model, text: readFileSync(join(w, `pushback-${it.commentId}.txt`), 'utf8') });
      if (it.authorResolved) await reopenFirst();
      const r = await reply(body, `body-pushback-${it.commentId}.txt`);
      return { postedId: r.id, link: linkOf(r) };
    }
    case 'resolve': {
      if (it.parentId != null) throw new Error('not our thread: never resolved');
      await bb.resolve(ws, repo, id, Number(it.commentId));
      return { postedId: null, link: null };
    }
    default: throw new Error(`nothing to post for kind ${it.kind}`);
  }
}

export const outcomeEntry = (it, fields) => ({
  n: it.n, kind: it.kind, findingId: it.findingId ?? null, commentId: it.commentId ?? null,
  result: 'declined', postedId: null, link: null, error: null, flipped: !!it.flipped, edited: !!it.edited, reason: null, ...fields,
});

// Each item is posted once: a failure is reported, never retried into a duplicate comment.
export async function runPosts(w, ns, { picks, outcome, pr, bb, model }) {
  const done = new Map(outcome.map(o => [o.n, o]));
  const skipped = [], todo = [];
  for (const n of ns) {
    const it = picks.items.find(i => i.n === n);
    const prior = done.get(n);
    if (!it) skipped.push({ n, why: 'no such item' });
    else if (it.kind === 'none') skipped.push({ n, why: 'nothing to post' });
    else if (prior?.result === 'posted') skipped.push({ n, why: 'already posted' });
    else if (prior?.result === 'failed') skipped.push({ n, why: 'failed earlier; not retried, so it can\'t post twice' });
    else if (it.kind === 'answer' && !readText(join(w, `pushback-${it.commentId}.txt`)).trim())
      skipped.push({ n, why: `write the reply to $W/pushback-${it.commentId}.txt first` });
    else todo.push(it);
  }
  const results = await Promise.all(todo.map(async it => {
    try { return outcomeEntry(it, { result: 'posted', ...(await postItem(w, pr, it, { bb, model })) }); }
    catch (e) { return outcomeEntry(it, { result: 'failed', error: String(e.message ?? e).split('\n')[0] }); }
  }));
  const posted = new Set(results.map(r => r.n));
  return { outcome: [...outcome.filter(o => !posted.has(o.n)), ...results].sort((a, b) => a.n - b.n), results, skipped };
}

export function closeOutcome(picks, outcome, reason = null) {
  const seen = new Set(outcome.map(o => o.n));
  const added = picks.items.filter(it => !seen.has(it.n) && it.kind !== 'none').map(it => outcomeEntry(it, { result: 'declined', reason }));
  return { outcome: [...outcome, ...added].sort((a, b) => a.n - b.n), added };
}

export function loadContext(w) {
  const repos = readJson(join(w, 'repos.json'), null);
  if (!repos) throw new Error(`no repos.json in ${w}`);
  return repos;
}

export const defaultBb = () => {
  const creds = findCreds();
  if (!creds) throw new Error('set BITBUCKET_USERNAME and BITBUCKET_PASSWORD (or configure the bitbucket MCP in ~/.claude.json)');
  return makeClient({ creds, accountId: findAccountId() });
};

export function decideFor(w) {
  const repos = loadContext(w);
  const picks = loadPicks(w);
  return decision({ items: picks.items, stillOpen: picks.stillOpen, outcome: loadOutcome(w), problems: reviewProblems(w),
    pr: repos.pr, dryRun: !!repos.dryRun, level: repos.level ?? null });
}

const BB_METHOD = { approve: 'approve', unapprove: 'unapprove', 'request-changes': 'requestChanges', 'unrequest-changes': 'unrequestChanges' };

export async function applyDecision(d, bb) {
  const done = [];
  for (const [cmd, ws, repo, id] of d.calls) {
    try { await bb[BB_METHOD[cmd]](ws, repo, Number(id)); done.push(cmd); }
    catch (e) { return { action: d.action, done, failed: cmd, error: String(e.message ?? e).split('\n')[0] }; }
  }
  return { action: d.action, done, failed: null, error: null };
}

const USAGE = `usage:
  post.mjs parse <W> "<answer>"           the user's answer → {post, edit, flip, rules, voice, none, unclear}
  post.mjs run <W> <n...>                 post those items in parallel; results appended to outcome.json
  post.mjs flip <W> <n>                   the user overrules verify on push-back n (picks.json updated)
  post.mjs edited <W> <n...>              mark items whose body the user had rewritten
  post.mjs close <W> [--reason "<text>"]  every item without an outcome → declined
  post.mjs decide <W>                     {action, why, open, calls}: approve, request changes or hold
  post.mjs apply-decision <W>             run decide's calls (only after the user said yes)`;

async function main(argv) {
  const [cmd, wArg, ...rest] = argv;
  if (!cmd || !wArg) { console.error(USAGE); process.exit(2); }
  const w = nativePath(wArg);
  const nums = () => {
    const ns = rest.flatMap(a => a.split(',')).map(s => s.trim()).filter(Boolean);
    if (!ns.length || ns.some(s => !/^\d+$/.test(s))) { console.error(USAGE); process.exit(2); }
    return ns.map(Number);
  };
  switch (cmd) {
    case 'parse':
      if (rest.length !== 1) { console.error(USAGE); process.exit(2); }
      return parseAnswer(rest[0], loadPicks(w));
    case 'run': {
      const ns = nums();
      const r = await runPosts(w, ns, { picks: loadPicks(w), outcome: loadOutcome(w), pr: loadContext(w).pr, bb: defaultBb(), model: readModel() });
      saveJson(join(w, 'outcome.json'), r.outcome);
      return { results: r.results, skipped: r.skipped };
    }
    case 'flip': {
      const [n] = nums();
      try {
        const picks = flipItem(loadPicks(w), n);
        saveJson(join(w, 'picks.json'), picks);
        const it = picks.items.find(i => i.n === n);
        return { n, kind: it.kind, flipped: it.flipped,
          next: it.kind === 'answer' ? `ask the user what still fails, write the reply to $W/pushback-${it.commentId}.txt, show it, ask again` : null };
      } catch (e) { console.error(`post.mjs: ${e.message}`); process.exit(1); }
    }
    case 'edited': {
      const ns = nums();
      const picks = loadPicks(w);
      picks.items = picks.items.map(it => (ns.includes(it.n) ? { ...it, edited: true } : it));
      saveJson(join(w, 'picks.json'), picks);
      return { edited: ns };
    }
    case 'close': {
      const i = rest.indexOf('--reason');
      const reason = i >= 0 ? rest[i + 1] ?? null : null;
      const r = closeOutcome(loadPicks(w), loadOutcome(w), reason);
      saveJson(join(w, 'outcome.json'), r.outcome);
      return { declined: r.added.map(o => o.n) };
    }
    case 'decide': return decideFor(w);
    case 'apply-decision': {
      const d = decideFor(w);
      if (!d.calls.length) return { action: d.action, done: [], failed: null, error: null, why: d.why };
      const r = await applyDecision(d, defaultBb());
      saveJson(join(w, 'decision.json'), { ...d, ...r });
      if (r.error) { console.log(JSON.stringify(r, null, 2)); process.exit(1); }
      return r;
    }
    default: console.error(USAGE); process.exit(2);
  }
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  try { console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2)); }
  catch (e) { console.error(`post.mjs: ${e.message}`); process.exit(1); }
}
