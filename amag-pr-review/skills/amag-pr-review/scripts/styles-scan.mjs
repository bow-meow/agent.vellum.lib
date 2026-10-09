#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STYLE_EXT = /\.(scss|css|sass|less)$/i;
const TEMPLATE_EXT = /\.(html|tsx?|jsx?)$/i;
// Classes a component library adds at runtime; no template in the repo sets them. A bare `mat-`
// prefix is not enough: apps name their own classes `mat-something` too, so only Angular
// Material's component roots count.
const MATERIAL = 'autocomplete|badge|bottom-sheet|button|button-toggle|calendar|card|checkbox|chip|chips|datepicker|date-range|dialog|divider|drawer|expansion|focus-indicator|form-field|grid|header|icon|input|list|menu|mini-fab|fab|option|optgroup|paginator|progress|pseudo-checkbox|radio|ripple|row|cell|column|select|sidenav|slide-toggle|slider|snack-bar|sort|step|stepper|tab|table|toolbar|tooltip|tree|footer-row|header-row|no-data-row|elevation|app-background|overlay|primary|accent|warn|end|start|small|active|focused|selected|expanded|disabled|checked|indeterminate|error|invalid';
const LIBRARY_PREFIX = new RegExp(`^(mdc-|cdk-|ng-|mat-mdc-|mat-(${MATERIAL})(-|$))`);
const CAP = 40;

export function diffLines(diffText) {
  const files = new Map();
  let cur = null, oldLn = 0, newLn = 0, oldLeft = 0, newLeft = 0;
  for (const l of diffText.split(/\r?\n/)) {
    if (oldLeft > 0 || newLeft > 0) {
      const c = l[0];
      if (c === '\\') continue;
      if (c === '+') { cur.added.push({ line: newLn++, text: l.slice(1) }); newLeft--; }
      else if (c === '-') { cur.removed.push({ line: oldLn++, text: l.slice(1) }); oldLeft--; }
      else { newLn++; oldLn++; newLeft--; oldLeft--; }
      continue;
    }
    let m;
    if (l.startsWith('diff --git ')) { cur = null; continue; }
    if ((m = l.match(/^\+\+\+ b\/(.+)$/))) { cur = { added: [], removed: [] }; files.set(m[1], cur); continue; }
    if (l.startsWith('+++ ')) { cur = { added: [], removed: [] }; continue; }
    if (cur && (m = l.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/))) {
      oldLn = +m[1]; oldLeft = m[2] === undefined ? 1 : +m[2];
      newLn = +m[3]; newLeft = m[4] === undefined ? 1 : +m[4];
    }
  }
  return files;
}

const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:"'])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));

// A minimal nested-block reader: enough to know each declaration's selector chain and line.
export function parseBlocks(css) {
  const text = stripComments(css);
  const blocks = [], stack = [];
  let buf = '', bufStart = -1, line = 1, bufLine = 1;
  const flushDecl = () => {
    const t = buf.trim();
    const m = t.match(/^([-\w]+)\s*:\s*([^{}]+)$/);
    if (m && stack.length) stack[stack.length - 1].decls.push({ prop: m[1], value: m[2].trim().replace(/\s+/g, ' '), line: bufLine });
    buf = ''; bufStart = -1;
  };
  for (const ch of text) {
    if (ch === '{') {
      const sel = buf.trim().replace(/\s+/g, ' ');
      const parent = stack[stack.length - 1];
      const chain = parent ? [...parent.chain, sel] : [sel];
      const b = { selector: sel, chain, line: bufLine, decls: [], at: sel.startsWith('@') };
      blocks.push(b); stack.push(b); buf = ''; bufStart = -1;
    } else if (ch === '}') { flushDecl(); stack.pop(); }
    else if (ch === ';') flushDecl();
    else {
      if (bufStart < 0 && !/\s/.test(ch)) { bufStart = 0; bufLine = line; }
      buf += ch;
    }
    if (ch === '\n') line++;
  }
  return blocks;
}

export const classesInSelector = sel => [...sel.replace(/\[[^\]]*\]/g, '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(m => m[1]);

export function classesInTemplate(text) {
  const out = new Set();
  const add = s => s.replace(/\{\{[\s\S]*?\}\}/g, ' ').split(/\s+/).filter(c => /^-?[_a-zA-Z][\w-]*$/.test(c)).forEach(c => out.add(c));
  for (const m of text.matchAll(/\bclass\s*=\s*"([^"]*)"/g)) add(m[1]);
  for (const m of text.matchAll(/\bclass\s*=\s*'([^']*)'/g)) add(m[1]);
  for (const m of text.matchAll(/\[class\.([\w-]+)\]/g)) out.add(m[1]);
  for (const m of text.matchAll(/\[ngClass\]\s*=\s*"\{([^"]*)\}"/g)) for (const k of m[1].matchAll(/['"]?([\w-]+)['"]?\s*:/g)) out.add(k[1]);
  for (const m of text.matchAll(/(?:panelClass|classList\.(?:add|toggle))\s*[=:(]\s*['"]([^'"]+)['"]/g)) add(m[1]);
  return out;
}

export const tagsIn = text => new Set([...text.matchAll(/<([a-z][\w-]*)[\s>/]/g)].map(m => m[1]));

const word = name => new RegExp(`(^|[^\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`);
const elementRe = tag => new RegExp(`(^|[\\s,>+~(])${tag}(?=[\\s,.:#\\[>+~)]|$)`);

export function physicalProps(path, added) {
  return added.filter(a => /(^|[\s;{])((margin|padding|border)-(left|right)[\w-]*|left|right)\s*:|text-align\s*:\s*(left|right)\b|float\s*:\s*(left|right)\b/.test(stripComments(a.text)))
    .map(a => ({ check: 'physical-direction', path, line: a.line, detail: a.text.trim() }));
}

export function longComments(path, added) {
  const out = [];
  let run = [];
  const end = () => {
    if (!run.length) return;
    const text = run.map(r => r.text.trim().replace(/^(\/\/+|\/\*+|\*+\/?)\s*/, '')).join(' ');
    const sentences = (text.match(/[.!?](\s|$)/g) ?? []).length;
    const longest = Math.max(...run.map(r => r.text.trim().length));
    if (run.length > 2 || sentences >= 3 || longest > 160)
      out.push({ check: 'long-comment', path, line: run[0].line, detail: `${run.length} line(s), ${sentences} sentence(s), longest line ${longest} chars` });
    run = [];
  };
  for (const a of added) {
    const t = a.text.trim();
    const prev = run[run.length - 1];
    if (/^(\/\/|\/\*|\*)/.test(t) && (!prev || prev.line === a.line - 1)) run.push(a);
    else { end(); if (/^(\/\/|\/\*|\*)/.test(t)) run.push(a); }
  }
  end();
  return out;
}

function fences(selector) {
  const out = [];
  for (const m of selector.matchAll(/:(where|not|is)\(/g)) {
    let depth = 0, i = m.index + m[0].length - 1;
    for (; i < selector.length; i++) { if (selector[i] === '(') depth++; else if (selector[i] === ')' && --depth === 0) break; }
    const f = selector.slice(m.index, i + 1);
    if (f.length >= 25) out.push(f);
  }
  return out;
}

export function repeats(styleFiles, addedByPath) {
  const out = [];
  const isAdded = (p, l) => addedByPath.get(p)?.has(l);
  const blockKeys = new Map(), fenceUse = new Map(), declUse = new Map();
  for (const [path, css] of styleFiles) {
    for (const b of parseBlocks(css)) {
      if (b.at) continue;
      if (b.decls.length >= 2) {
        const key = b.decls.map(d => `${d.prop}: ${d.value}`).sort().join('; ');
        if (!blockKeys.has(key)) blockKeys.set(key, []);
        blockKeys.get(key).push({ path, line: b.line, n: b.decls.length });
      }
      for (const f of fences(b.selector)) {
        const k = f.replace(/\s+/g, '');
        if (!fenceUse.has(k)) fenceUse.set(k, []);
        fenceUse.get(k).push({ path, line: b.line });
      }
      // Only design-token declarations: plain ones like `display: flex` repeat harmlessly everywhere.
      for (const d of b.decls) {
        if (!d.prop.startsWith('--') && !d.value.includes('var(--')) continue;
        const k = `${path}|${d.prop}|${d.value}`;
        if (!declUse.has(k)) declUse.set(k, []);
        declUse.get(k).push({ path, line: d.line, prop: d.prop, value: d.value });
      }
    }
  }
  for (const [key, uses] of blockKeys) {
    const min = uses[0].n >= 4 ? 2 : 3;
    if (uses.length >= min && uses.some(u => isAdded(u.path, u.line)))
      out.push({ check: 'repeated-block', path: uses.find(u => isAdded(u.path, u.line)).path, line: uses.find(u => isAdded(u.path, u.line)).line, detail: `${uses.length} rules declare { ${key} }: ${uses.map(u => `${u.path}:${u.line}`).join(', ')}` });
  }
  for (const [f, uses] of fenceUse) {
    if (uses.length >= 3 && uses.some(u => isAdded(u.path, u.line)))
      out.push({ check: 'repeated-fence', path: uses[0].path, line: uses[0].line, detail: `${f} appears in ${uses.length} selectors: ${uses.map(u => `${u.path}:${u.line}`).join(', ')}` });
  }
  for (const uses of declUse.values()) {
    const lines = [...new Set(uses.map(u => u.line))];
    if (lines.length < 3 || !uses.some(u => isAdded(u.path, u.line))) continue;
    out.push({ check: 'repeated-declaration', path: uses[0].path, line: uses.find(u => isAdded(u.path, u.line)).line, detail: `${uses[0].prop}: ${uses[0].value} is set in ${lines.length} rules, at lines ${lines.join(', ')}` });
  }
  return out;
}

function git(wt, args) {
  try { return execFileSync('git', ['-C', wt, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return ''; }
}

export function urlChecks(path, lines, side, fileSets) {
  const out = [];
  for (const a of lines) for (const m of a.text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    const u = m[1];
    if (/^(data:|https?:|#|\$|var\()/.test(u)) continue;
    const tail = u.replace(/^[~./]+/, '').split(/[?#]/)[0];
    const exists = s => [...s].some(f => f === tail || f.endsWith('/' + tail));
    out.push({ check: 'url', path, line: a.line, side, detail: `${u}: at base ${exists(fileSets.base) ? 'exists' : 'MISSING'}, at head ${exists(fileSets.head) ? 'exists' : 'MISSING'}` });
  }
  return out;
}

// Minified or vendored stylesheets are not the team's code and would flood every check.
export const isVendored = (path, css) => /\.min\.css$/i.test(path) || css.split('\n').some(l => l.length > 1000);

function libText(dirs) {
  const out = [];
  const walk = d => {
    let entries = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(m?js|ts|html)$/.test(e.name)) { try { out.push(readFileSync(p, 'utf8')); } catch { } }
    }
  };
  dirs.forEach(walk);
  return out.join('\n');
}

export function scan(wt, diffText, base, libDirs = []) {
  const changed = diffLines(diffText);
  const headFiles = git(wt, ['ls-files']).split(/\r?\n/).filter(Boolean);
  const read = p => { try { return readFileSync(join(wt, p), 'utf8'); } catch { return ''; } };
  const styles = new Map(headFiles.filter(f => STYLE_EXT.test(f)).map(f => [f, read(f)]).filter(([f, css]) => !isVendored(f, css)));
  const templates = new Map(headFiles.filter(f => TEMPLATE_EXT.test(f) && !/\.spec\./.test(f)).map(f => [f, read(f)]));
  // Library source (from deps.mjs) sets classes at runtime that no repo template mentions.
  const allTemplateText = [...templates.values()].join('\n') + '\n' + libText(libDirs);
  const allStyleText = [...styles.values()].join('\n');
  const fileSets = { head: new Set(headFiles), base: new Set(base ? git(wt, ['ls-tree', '-r', '--name-only', base]).split(/\r?\n/).filter(Boolean) : []) };
  const addedByPath = new Map([...changed].map(([p, f]) => [p, new Set(f.added.map(a => a.line))]));
  const facts = [];

  for (const [path, f] of changed) {
    if (STYLE_EXT.test(path)) {
      facts.push(...physicalProps(path, f.added), ...longComments(path, f.added));
      facts.push(...urlChecks(path, f.added, 'new', fileSets), ...urlChecks(path, f.removed, 'old', fileSets));
      for (const b of parseBlocks(styles.get(path) ?? '')) {
        if (b.at || !addedByPath.get(path).has(b.line)) continue;
        for (const c of classesInSelector(b.selector))
          if (!LIBRARY_PREFIX.test(c) && !word(c).test(allTemplateText))
            facts.push({ check: 'unused-selector-class', path, line: b.line, detail: `.${c} is set by no template or code` });
      }
    }
    if (TEMPLATE_EXT.test(path) && !STYLE_EXT.test(path)) {
      for (const a of f.added) for (const c of classesInTemplate(a.text))
        if (!LIBRARY_PREFIX.test(c) && !new RegExp(`\\.${c.replace(/[-]/g, '\\-')}(?![\\w-])`).test(allStyleText)
          && ![...templates].some(([p, t]) => p !== path && /\.tsx?$/.test(p) && word(c).test(t)))
          facts.push({ check: 'unused-template-class', path, line: a.line, detail: `class ${c} has no rule in any stylesheet` });
      const removedText = f.removed.map(r => r.text).join('\n');
      for (const tag of tagsIn(removedText)) {
        if (new RegExp(`<${tag}[\\s>/]`).test(allTemplateText)) continue;
        for (const [sp, css] of styles) for (const b of parseBlocks(css))
          if (!b.at && elementRe(tag).test(b.selector)) facts.push({ check: 'rule-for-removed-element', path: sp, line: b.line, detail: `<${tag}> no longer appears in any template; rule "${b.selector.slice(0, 80)}" targets it` });
      }
      for (const c of classesInTemplate(removedText)) {
        if (LIBRARY_PREFIX.test(c) || word(c).test(allTemplateText)) continue;
        for (const [sp, css] of styles) for (const b of parseBlocks(css))
          if (!b.at && classesInSelector(b.selector).includes(c)) facts.push({ check: 'rule-for-removed-class', path: sp, line: b.line, detail: `class ${c} was removed from the last template using it; rule "${b.selector.slice(0, 80)}" targets it` });
      }
    }
  }
  facts.push(...repeats(styles, addedByPath));

  const byCheck = new Map();
  for (const f of facts) { const k = `${f.check}|${f.path}|${f.line}|${f.detail}`; if (!byCheck.has(k)) byCheck.set(k, f); }
  const counts = {};
  const kept = [...byCheck.values()].filter(f => (counts[f.check] = (counts[f.check] ?? 0) + 1) <= CAP);
  return { counts, facts: kept };
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  const [wt, diffFile, base, ...rest] = process.argv.slice(2);
  if (!wt || !diffFile || !base) { console.error('usage: styles-scan.mjs <worktree> <diff-file> <merge-base> [--lib <dir>]...'); process.exit(2); }
  const libDirs = rest.flatMap((a, i) => a === '--lib' && rest[i + 1] ? [rest[i + 1]] : []);
  console.log(JSON.stringify(scan(wt, readFileSync(diffFile, 'utf8'), base, libDirs), null, 2));
}
