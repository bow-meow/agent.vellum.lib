#!/usr/bin/env node
// SKILL.md step 4, all but the Jira read: siblings, history,
// commit messages, size, languages, SQL, packages, other repos, newer release branches and
// stylesheet facts, summarised in $W/context.json.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGenerated, parseDiff, stats } from './anchors.mjs';
import { DOCS_ONLY } from './dispatch.mjs';
import { nativePath } from './env.mjs';
import { familyOf } from './forward-scan.mjs';
import { diffLines } from './styles-scan.mjs';
import { ALLOWED as SIBLING_REPOS, arOf } from './xrepo.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// ticket-quest's TICKET_RE (^[A-Z][A-Z0-9]+-\d+$), unanchored so it can be found inside text.
const TICKET_IN_TEXT = /(?<![A-Za-z0-9])[A-Z][A-Z0-9]+-\d+(?!\d)/;

// Branch names are often lower-cased (feature/sym-1234-x); titles and descriptions are prose, where
// a case-insensitive match would take "utf-8" for a key.
export function ticketKeyFrom({ branch, title, description } = {}) {
  const b = String(branch ?? '');
  const m = b.match(TICKET_IN_TEXT) ?? b.toUpperCase().match(TICKET_IN_TEXT)
    ?? String(title ?? '').match(TICKET_IN_TEXT) ?? String(description ?? '').match(TICKET_IN_TEXT);
  return m ? m[0] : null;
}

export function ticketKeyOf(repos, pr) {
  if (repos.ticketKey) return repos.ticketKey;
  if (!pr) return null;
  return ticketKeyFrom({ branch: pr.source?.branch?.name, title: pr.title, description: prDescriptionText(pr) });
}

const prDescriptionText = pr => pr.description ?? pr.summary?.raw ?? '';

export function prDescription(pr) {
  return `# ${pr.title ?? ''}\n\n${prDescriptionText(pr)}\n`;
}

const LANGUAGES = [
  [/\.(cs|csproj|sln)$/i, 'csharp-dotnet'],
  [/\.(cpp|cc|h|hpp|c)$/i, 'cpp-embedded'],
  [/\.go$/i, 'go'],
  [/\.tsx?$/i, 'typescript-angular'],
];

// An .html file is Angular only next to TypeScript or inside an Angular workspace; a C# repo's
// e-mail templates are not.
export function languagesOf(paths, isAngularHtml = () => false) {
  const found = new Set();
  const hasTs = paths.some(p => /\.tsx?$/i.test(p));
  for (const p of paths) {
    for (const [re, name] of LANGUAGES) if (re.test(p)) found.add(name);
    if (/\.html$/i.test(p) && (hasTs || isAngularHtml(p))) found.add('typescript-angular');
  }
  return LANGUAGES.map(([, n]) => n).filter((n, i, a) => a.indexOf(n) === i && found.has(n));
}

const STYLE_EXT = /\.(scss|css|sass|less)$/i;

export function styleLines(statFiles) {
  return statFiles.filter(f => STYLE_EXT.test(f.path)).reduce((n, f) => n + f.added + f.removed, 0);
}

// A shell or YAML comment needs the space after #, which keeps out C/C# preprocessor lines.
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|<!--|--|'''|"""|# )/;

// Changed lines in docs files plus added comment lines elsewhere: how much prose the docs reviewer has.
export function proseLines(diffText) {
  const docs = new RegExp(DOCS_ONLY, 'i');
  let n = 0;
  for (const [path, f] of diffLines(diffText)) {
    if (docs.test(path)) n += f.added.length + f.removed.length;
    else n += f.added.filter(a => COMMENT_LINE.test(a.text)).length;
  }
  return n;
}

const SQL_WORDS = /SELECT|INSERT|UPDATE|DELETE|MERGE|EXEC|SqlCommand|FromSql|Dapper/;

export function touchesSql(diffText) {
  if ([...parseDiff(diffText).values()].some(f => /\.sql$/i.test(f.path) || /\.sql$/i.test(f.oldPath))) return true;
  return [...diffLines(diffText).values()].some(f => f.added.some(a => SQL_WORDS.test(a.text)));
}

export const historyFiles = diffText => [...parseDiff(diffText).values()].filter(f => !isGenerated(f)).map(f => f.path);

// self: [{ slug, id }] in PR mode, [{ slug, branch }] in local mode (the open PR of the reviewed
// branch is this change, not a sibling).
export function excludeSelf(siblings, self) {
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  return siblings.filter(s => !self.some(x => same(x.slug, s.repo)
    && (x.id != null ? Number(s.id) === Number(x.id) : x.branch != null && s.source === x.branch)));
}

export function siblingSlugs(extra = []) {
  const out = [];
  for (const s of [...SIBLING_REPOS, ...extra]) if (!out.some(o => o.toLowerCase() === s.toLowerCase())) out.push(s);
  return out;
}

const PREFIX_OK = /^[A-Za-z0-9._\/-]+\/$/;

// A `template/<name>/1.0.0` destination's newer versions live under its own prefix, not release/.
export function releaseRefspecs(dest) {
  const specs = ['+refs/heads/release/*:refs/remotes/origin/release/*'];
  const fam = familyOf(dest ?? '');
  if (fam !== 'release/' && PREFIX_OK.test(fam) && !fam.startsWith('-') && !fam.includes('..') && !fam.includes('//'))
    specs.push(`+refs/heads/${fam}*:refs/remotes/origin/${fam}*`);
  return specs;
}

const lastLine = s => String(s ?? '').trim().split(/\r?\n/).pop() ?? '';
const why = r => lastLine(r.stderr) || lastLine(r.stdout) || `exit ${r.status}`;
const SHA = /^[0-9a-f]{7,40}$/i;

function spawn(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 30, windowsHide: true });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr || r.error?.message || '' };
}

export const defaultRunners = {
  node: (script, args) => spawn(process.execPath, [join(HERE, script), ...args]),
  git: args => spawn('git', args),
  exists: existsSync,
};

function angularHtml(wt, exists) {
  return p => {
    const top = resolve(wt);
    for (let d = dirname(resolve(top, p)); d.startsWith(top); d = dirname(d)) {
      if (exists(join(d, 'angular.json'))) return true;
      if (d === top) break;
    }
    return false;
  };
}

const readJson = f => JSON.parse(readFileSync(f, 'utf8'));
const readText = f => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };

export function run(wArg, { siblings: extra = [] } = {}, runners = defaultRunners) {
  const { node, git, exists = existsSync } = runners;
  const w = nativePath(wArg);
  const notes = [];
  const meta = readJson(join(w, 'repos.json'));
  const pr = meta.mode === 'pr' ? readJson(join(w, 'pr.json')) : null;
  const repos = (meta.repos ?? []).map(r => ({ ...r, wt: nativePath(r.wt), clone: nativePath(r.clone ?? r.wt), diff: nativePath(r.diff) }));
  const diffs = new Map(repos.map(r => [r.name, readText(r.diff)]));
  const many = repos.length > 1;

  const ticketKey = ticketKeyOf(meta, pr);
  if (pr) writeFileSync(join(w, 'pr-description.md'), prDescription(pr));

  let siblings = [];
  if (ticketKey) {
    const self = meta.mode === 'pr'
      ? [{ slug: `${meta.pr.ws}/${meta.pr.repo}`, id: meta.pr.id }]
      : repos.map(r => {
        const b = git(['-C', r.clone, 'rev-parse', '--abbrev-ref', 'HEAD']);
        return { slug: `${r.ws}/${r.repo}`, branch: b.status === 0 ? b.stdout.trim() : null };
      });
    for (const slug of siblingSlugs(extra)) {
      const [ws, repo] = slug.split('/');
      const r = node('bb.mjs', ['search-prs', ws, repo, ticketKey]);
      if (r.status !== 0) { notes.push(`Siblings: search of ${slug} failed: ${why(r)}`); continue; }
      let found;
      try { found = JSON.parse(r.stdout); } catch { notes.push(`Siblings: unreadable search result for ${slug}`); continue; }
      siblings.push(...excludeSelf(found.map(p => ({ ...p, repo: slug })), self));
    }
  }
  writeFileSync(join(w, 'siblings.json'), JSON.stringify(siblings, null, 2));
  if (siblings.length) mkdirSync(join(w, 'siblings'), { recursive: true });
  for (const s of siblings) {
    const [ws, repo] = s.repo.split('/');
    if (!/^\d+$/.test(String(s.id))) continue;
    const r = node('bb.mjs', ['diff', ws, repo, String(s.id)]);
    if (r.status === 0) writeFileSync(join(w, 'siblings', `${repo}-${s.id}.diff`), r.stdout);
    else notes.push(`Siblings: diff of ${s.repo}#${s.id} failed: ${why(r)}`);
  }

  let history = '', commits = '';
  for (const r of repos) {
    for (const file of historyFiles(diffs.get(r.name))) {
      const g = git(['-C', r.wt, 'log', '--oneline', '-n', '20', '-i', '-E', '--grep=fix|revert|regress', '--', file]);
      history += `## ${many ? `${r.name}/` : ''}${file}\n${g.status === 0 ? g.stdout : ''}`;
      if (history && !history.endsWith('\n')) history += '\n';
    }
    if (!r.mb || !SHA.test(r.mb)) { notes.push(`Commit messages: ${r.name} has no merge base`); continue; }
    const g = git(['-C', r.wt, 'log', '--format=--- %h%n%B', `${r.mb}..HEAD`]);
    if (g.status !== 0) { notes.push(`Commit messages: git log in ${r.name} failed: ${why(g)}`); continue; }
    commits += (many ? `## ${r.name}\n` : '') + g.stdout;
  }
  writeFileSync(join(w, 'history.txt'), history);
  writeFileSync(join(w, 'commits.txt'), commits);

  const perRepo = repos.map(r => ({ r, files: stats(parseDiff(diffs.get(r.name))).files }));
  const combined = readText(join(w, 'context.diff'));
  const changed = combined ? stats(parseDiff(combined)).changed
    : perRepo.reduce((n, { files }) => n + files.filter(f => !f.generated).reduce((m, f) => m + f.added + f.removed, 0), 0);
  const styles = perRepo.reduce((n, { files }) => n + styleLines(files), 0);
  const found = new Set(perRepo.flatMap(({ r, files }) => languagesOf(files.map(f => f.path), angularHtml(r.wt, exists))));
  const languages = LANGUAGES.map(([, n]) => n).filter((n, i, a) => a.indexOf(n) === i && found.has(n));
  const sql = repos.some(r => touchesSql(diffs.get(r.name)));
  const prose = repos.reduce((n, r) => n + proseLines(diffs.get(r.name)), 0);

  const scan = (script, args, out, fallback, label) => {
    const res = node(script, args);
    if (res.status === 0) { writeFileSync(join(w, out), res.stdout); return res.stdout; }
    notes.push(`${label}: ${why(res)}`);
    writeFileSync(join(w, out), JSON.stringify({ ...fallback, error: why(res) }, null, 2));
    return null;
  };

  if (sql) for (const r of repos)
    scan('sql-index-map.mjs', [r.wt, '--diff', r.diff], `index-map-${r.name}.json`, { tables: {}, noIndexFound: [] }, `Index map for ${r.name} failed`);

  const packages = [];
  const libs = new Map();
  for (const r of repos) {
    const res = node('deps.mjs', [r.wt, r.diff, join(arOf(w), '.deps')]);
    let recs = [];
    if (res.status === 0) { try { recs = JSON.parse(res.stdout); } catch { notes.push(`Packages in ${r.name}: unreadable deps output`); } }
    else notes.push(`Packages in ${r.name} failed: ${why(res)}`);
    writeFileSync(join(w, `deps-${r.name}.json`), JSON.stringify(recs, null, 2));
    for (const p of recs) {
      packages.push({ repo: r.name, ...p });
      if (p.error) notes.push(`Package ${p.name}@${p.version}: ${p.error}`);
    }
    libs.set(r.name, recs.filter(p => !p.error && !p.local && p.path).map(p => p.path));
  }

  const otherRepos = [];
  const have = repos.map(r => `${r.ws}/${r.repo}`).join(',');
  const plan = node('xrepo.mjs', ['plan', w, join(w, 'siblings.json'), ...(have ? ['--have', have] : [])]);
  let entries = [];
  if (plan.status === 0) { try { entries = JSON.parse(plan.stdout); } catch { notes.push('Other repos: unreadable plan'); } }
  else notes.push(`Other repos: plan failed: ${why(plan)}`);
  for (const e of entries) {
    if (!e.ref) { notes.push(`Other repo ${e.slug}: ${e.kind ?? 'skipped'}: ${e.why ?? ''}`.trim()); continue; }
    const res = node('xrepo.mjs', ['add', w, e.slug, e.ref, e.kind ?? 'sibling-pr', '--why', e.why ?? '']);
    let rec = null;
    try { rec = JSON.parse(res.stdout); } catch { /* reported below */ }
    if (res.status === 0 && rec && !rec.error) otherRepos.push(rec);
    else notes.push(`Other repo ${e.slug}@${e.ref}: add failed: ${rec?.error ?? why(res)}`);
  }

  for (const r of repos) {
    if (!r.dest) { notes.push(`Forward scan of ${r.name}: no destination branch`); continue; }
    const f = git(['-C', r.clone, 'fetch', '-q', 'origin', ...releaseRefspecs(r.dest)]);
    if (f.status !== 0) notes.push(`Release branches of ${r.name}: fetch failed: ${why(f)}`);
    scan('forward-scan.mjs', [r.clone, r.diff, r.dest, '--diffs', join(w, 'forward')], `forward-${r.name}.json`, { dest: r.dest, branches: [] }, `Forward scan of ${r.name} failed`);
  }

  if (styles >= 1) for (const r of repos) {
    if (!r.mb || !SHA.test(r.mb)) { notes.push(`Stylesheet scan of ${r.name}: no merge base`); continue; }
    scan('styles-scan.mjs', [r.wt, r.diff, r.mb, ...libs.get(r.name).flatMap(p => ['--lib', p])], `styles-facts-${r.name}.json`, { counts: {}, facts: [] }, `Stylesheet scan of ${r.name} failed`);
  }

  // Local mode's context.diff prefixes every path with its repo; PR mode's doesn't.
  const prefixArgs = r => (meta.mode === 'local' ? ['--prefix', r.name] : []);
  for (const r of repos)
    scan('callers.mjs', [r.wt, '--diff', r.diff, ...prefixArgs(r)], `callers-${r.name}.json`, {}, `Callers of ${r.name} failed`);

  const staticCands = [], staticLeads = [];
  let staticTool = null;
  for (const r of repos) {
    const out = scan('static.mjs', [r.wt, '--diff', r.diff, ...prefixArgs(r)], `static-${r.name}.json`, { candidates: [], leads: [] }, `Static analysis of ${r.name} failed`);
    if (!out) continue;
    let res;
    try { res = JSON.parse(out); } catch { notes.push(`Static analysis of ${r.name}: unreadable output`); continue; }
    if (res.skipped) { notes.push(`Static analysis: ${res.why}`); break; }
    staticTool = res.tool;
    if (res.errors) notes.push(`Static analysis of ${r.name}: ${res.errors} file(s) the tool couldn't read`);
    staticCands.push(...res.candidates.map(c => ({ ...c, repo: c.repo ?? r.name })));
    staticLeads.push(...res.leads);
  }
  for (const r of repos) {
    if (!r.mb || !SHA.test(r.mb)) { notes.push(`IfChange lint of ${r.name}: no merge base`); continue; }
    const out = scan('ifttt.mjs', [r.wt, '--base', r.mb, ...prefixArgs(r)], `ifttt-${r.name}.json`, { candidates: [] }, `IfChange lint of ${r.name} failed`);
    if (!out) continue;
    let res;
    try { res = JSON.parse(out); } catch { notes.push(`IfChange lint of ${r.name}: unreadable output`); continue; }
    if (res.skipped) { notes.push(`IfChange lint: ${res.why}`); break; }
    staticCands.push(...res.candidates.map(c => ({ ...c, repo: c.repo ?? r.name })));
  }
  // A reviewer's candidate file: verify reads it like any other, and no reviewer tokens went into it.
  if (staticCands.length) writeFileSync(join(w, 'cand-static.json'), JSON.stringify(staticCands.map((c, i) => ({ id: `static-${i + 1}`, ...c })), null, 2));
  writeFileSync(join(w, 'static-leads.json'), JSON.stringify(staticLeads, null, 2));
  const staticSummary = { tool: staticTool, candidates: staticCands.length, leads: staticLeads.length };

  if (!ticketKey) notes.push('Ticket: none found; no sibling search');
  const context = { changed, styles, prose, languages, sql, ticketKey, siblings: siblings.length, packages, otherRepos, static: staticSummary, notes };
  writeFileSync(join(w, 'context.json'), JSON.stringify(context, null, 2));
  return context;
}

const USAGE = 'usage: context.mjs <W> [--siblings ws/repo,...]   (reads <W>/repos.json, and <W>/pr.json in PR mode)';
const SLUG = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export function parseArgs(argv) {
  const [w, ...rest] = argv;
  if (!w || w.startsWith('--')) return null;
  let siblings = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] !== '--siblings' || !rest[i + 1]) return null;
    siblings = siblings.concat(rest[++i].split(',').map(s => s.trim()).filter(Boolean));
  }
  return siblings.every(s => SLUG.test(s)) ? { w, siblings } : null;
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  const args = parseArgs(process.argv.slice(2));
  if (!args) { console.error(USAGE); process.exit(2); }
  const ctx = run(args.w, { siblings: args.siblings });
  for (const n of ctx.notes) console.error(`context.mjs: ${n}`);
  console.log(JSON.stringify(ctx, null, 2));
}
