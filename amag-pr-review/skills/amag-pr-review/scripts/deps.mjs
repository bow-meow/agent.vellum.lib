#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

// Packages from these hosts are public; reviewers already know them, so only private-registry
// packages are worth fetching.
const PUBLIC_HOSTS = new Set(['registry.npmjs.org', 'registry.yarnpkg.com', 'registry.npmmirror.com']);
const CODE_EXT = /\.(m?[jt]sx?|cjs|cts|mts|scss|sass|less|css)$/i;

// Everything below comes from the PR author's lockfile and reaches a shell on Windows, so it is
// validated against npm's own grammar before use.
const NAME_RE = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const VERSION_RE = /^[0-9A-Za-z.+-]+$/;
const REGISTRY_RE = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._~%\/-]*$/;

export function packageOf(spec) {
  if (!spec || /^[./]/.test(spec) || /^[a-z]+:/i.test(spec)) return null;
  const s = spec.replace(/^~/, '');
  const parts = s.split('/');
  const name = s.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return NAME_RE.test(name) ? name : null;
}

export function importsIn(text) {
  const out = new Set();
  const re = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|@(?:use|forward|import)\s+)['"]([^'"\n]+)['"]/g;
  for (const m of text.matchAll(re)) { const p = packageOf(m[1]); if (p) out.add(p); }
  return out;
}

export function changedFiles(diffText) {
  const files = new Map();
  let cur = null;
  for (const l of diffText.split(/\r?\n/)) {
    const h = l.match(/^\+\+\+ b\/(.+)$/);
    if (h) { cur = h[1]; if (!files.has(cur)) files.set(cur, []); continue; }
    if (l.startsWith('+++ ')) { cur = null; continue; }
    if (cur && l.startsWith('+')) files.get(cur).push(l.slice(1));
  }
  return files;
}

export function depNamesInAddedPackageJsonLines(lines) {
  const out = new Set();
  for (const l of lines) { const m = l.match(/^\s*"([^"]+)"\s*:\s*"[^"]*"/); if (m) { const p = packageOf(m[1]); if (p) out.add(p); } }
  return out;
}

export function lockEntry(lock, name) {
  const e = lock.packages?.[`node_modules/${name}`] ?? lock.dependencies?.[name];
  return e?.version ? { version: e.version, resolved: e.resolved ?? null } : null;
}

export function isPublic(resolved) {
  try { return PUBLIC_HOSTS.has(new URL(resolved).hostname); } catch { return true; }
}

export function registryOf(resolved, name) {
  const i = resolved.indexOf(`/${name}/-/`);
  return i > 0 ? resolved.slice(0, i + 1) : null;
}

// A registry counts as trusted only when the user's own npm config already names it; the
// worktree's .npmrc is PR data and is never consulted.
export function trustedRegistry(registry, npmrcText) {
  const bare = registry.replace(/^https?:/, '');
  const keys = [...npmrcText.matchAll(/^\s*(\/\/[^\s:=]+)\S*\s*=|^\s*@?[\w.-]*:?registry\s*=\s*https?:(\/\/\S+)/gm)]
    .map(m => (m[1] ?? m[2]).replace(/\/?$/, '/'));
  return keys.some(k => bare.startsWith(k));
}

export function untar(buf, dest) {
  const root = resolve(dest);
  const written = [];
  for (let off = 0; off + 512 <= buf.length;) {
    const h = buf.subarray(off, off + 512);
    if (h.every(b => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const name = [str(345, 500), str(0, 100)].filter(Boolean).join('/');
    const body = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type !== '0' && type !== '\0') continue;
    const target = resolve(root, normalize(name));
    if (!target.startsWith(root + sep)) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
    written.push(target);
  }
  return written;
}

// Angular's packager embeds the original .ts/.html in the sourcemap; unpacking it gives
// reviewers real source instead of the compiled bundle.
export function writeSources(mapText, dest) {
  let map;
  try { map = JSON.parse(mapText); } catch { return 0; }
  const root = resolve(dest);
  let n = 0;
  (map.sources ?? []).forEach((s, i) => {
    const content = map.sourcesContent?.[i];
    if (typeof content !== 'string') return;
    const rel = s.replace(/^[a-z]+:\/\/\/?/i, '').replace(/^(\.\.?\/)+/, '');
    const target = resolve(root, normalize(rel));
    if (!target.startsWith(root + sep)) return;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    n++;
  });
  return n;
}

function findLock(worktree, file) {
  const top = resolve(worktree);
  for (let d = dirname(resolve(top, file)); d.startsWith(top); d = dirname(d)) {
    if (existsSync(join(d, 'package-lock.json'))) return d;
    if (d === top) break;
  }
  return null;
}

function npm(args) {
  const win = process.platform === 'win32';
  return execFileSync(win ? 'npm.cmd' : 'npm', args, { encoding: 'utf8', shell: win, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
}

function userNpmrc() {
  const p = process.env.NPM_CONFIG_USERCONFIG || join(homedir(), '.npmrc');
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

function fetchPackage(name, version, registry, cacheDir) {
  const dir = join(cacheDir, `${name.replace('/', '+')}@${version}`);
  if (existsSync(join(dir, 'package', 'package.json'))) return { path: dir, cached: true };
  const tmp = mkdtempSync(join(tmpdir(), 'deps-'));
  try {
    const out = JSON.parse(npm(['pack', `${name}@${version}`, '--registry', registry, '--pack-destination', tmp, '--json', '--ignore-scripts']));
    const buf = gunzipSync(readFileSync(join(tmp, out[0].filename)));
    rmSync(dir, { recursive: true, force: true });
    const files = untar(buf, dir);
    let sources = 0;
    for (const f of files.filter(f => f.endsWith('.mjs.map') || f.endsWith('.js.map')))
      sources += writeSources(readFileSync(f, 'utf8'), join(dir, 'src'));
    return { path: dir, cached: false, sources };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function plan(worktree, diffText) {
  const wanted = new Map();
  for (const [file, added] of changedFiles(diffText)) {
    if (!added.length) continue;
    let names;
    if (/(^|\/)package\.json$/.test(file)) names = depNamesInAddedPackageJsonLines(added);
    else if (CODE_EXT.test(file) && existsSync(join(worktree, file))) names = importsIn(readFileSync(join(worktree, file), 'utf8'));
    else continue;
    const project = findLock(worktree, file);
    if (!project || !names.size) continue;
    const lock = JSON.parse(readFileSync(join(project, 'package-lock.json'), 'utf8'));
    for (const name of names) {
      const e = lockEntry(lock, name);
      if (!e?.resolved || isPublic(e.resolved)) continue;
      const key = `${name}@${e.version}`;
      if (!wanted.has(key)) wanted.set(key, { name, version: e.version, registry: registryOf(e.resolved, name), usedBy: [] });
      wanted.get(key).usedBy.push(file);
    }
  }
  return [...wanted.values()];
}

export function run(worktree, diffText, cacheDir) {
  const npmrc = userNpmrc();
  return plan(worktree, diffText).map(p => {
    const rec = { name: p.name, version: p.version, registry: p.registry, usedBy: p.usedBy };
    if (!VERSION_RE.test(p.version) || !p.registry || !REGISTRY_RE.test(p.registry)) return { ...rec, error: 'unrecognised version or registry in package-lock.json' };
    if (!trustedRegistry(p.registry, npmrc)) return { ...rec, error: 'registry is not configured in the user .npmrc' };
    try { return { ...rec, ...fetchPackage(p.name, p.version, p.registry, cacheDir) }; }
    catch (e) { return { ...rec, error: String(e.stderr || e.message).trim().split(/\r?\n/).slice(-1)[0] }; }
  });
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  const [worktree, diffFile, cacheDir] = process.argv.slice(2);
  if (!worktree || !diffFile || !cacheDir) { console.error('usage: deps.mjs <worktree> <diff-file> <cache-dir>'); process.exit(2); }
  console.log(JSON.stringify(run(worktree, readFileSync(diffFile, 'utf8'), cacheDir), null, 2));
}
