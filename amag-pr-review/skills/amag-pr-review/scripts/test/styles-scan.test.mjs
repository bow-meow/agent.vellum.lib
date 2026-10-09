import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffLines, parseBlocks, classesInSelector, classesInTemplate, tagsIn, physicalProps, longComments, repeats, urlChecks, isVendored, scan } from '../styles-scan.mjs';

test('diffLines numbers added lines on the new side and removed lines on the old side', () => {
  const d = ['diff --git a/a.scss b/a.scss', '--- a/a.scss', '+++ b/a.scss', '@@ -3,2 +3,2 @@', ' keep', '-old', '+new', ''].join('\n');
  assert.deepEqual(diffLines(d).get('a.scss'), { added: [{ line: 4, text: 'new' }], removed: [{ line: 4, text: 'old' }] });
});

test('parseBlocks tracks nesting, declarations and lines, ignoring comments', () => {
  const css = ['.a {', '  // c: d;', '  color: red;', '  .b { top: 1px; }', '}', '@media x { .c { left: 0; } }'].join('\n');
  const b = parseBlocks(css);
  assert.deepEqual(b.map(x => [x.selector, x.line, x.decls.map(d => `${d.prop}:${d.value}@${d.line}`)]), [
    ['.a', 1, ['color:red@3']], ['.b', 4, ['top:1px@4']], ['@media x', 6, []], ['.c', 6, ['left:0@6']],
  ]);
  assert.deepEqual(b[1].chain, ['.a', '.b']);
});

test('classesInSelector ignores attribute selector contents', () => {
  assert.deepEqual(classesInSelector('.a:not(.b) [data-x=".c"] > .d'), ['a', 'b', 'd']);
});

test('classesInTemplate reads class, [class.x], ngClass keys and panelClass', () => {
  const t = `<div class="one {{ dyn }} two" [class.three]="x" [ngClass]="{ 'four': a, five: b }"></div><mat-select panelClass="six">`;
  assert.deepEqual([...classesInTemplate(t)].sort(), ['five', 'four', 'one', 'six', 'three', 'two']);
});

test('tagsIn finds element names', () => {
  assert.deepEqual([...tagsIn('<select name="x"><option>1</option></select><app-x/>')].sort(), ['app-x', 'option', 'select']);
});

test('physicalProps flags every physical direction property and not logical ones', () => {
  const added = [{ line: 1, text: '  padding-right: 4px;' }, { line: 2, text: '  padding-inline-end: 4px;' }, { line: 3, text: '  right: 0;' },
    { line: 4, text: '  text-align: left;' }, { line: 5, text: '  border-left-color: red;' }, { line: 6, text: '  // margin-left: 1px' }];
  assert.deepEqual(physicalProps('a.scss', added).map(f => f.line), [1, 3, 4, 5]);
});

test('longComments flags blocks over two lines, three sentences or 160 characters', () => {
  const long = 'x'.repeat(170);
  const added = [
    { line: 1, text: '// one' }, { line: 2, text: '// two' }, { line: 3, text: '// three' }, { line: 4, text: 'a: b;' },
    { line: 5, text: '// First. Second. Third.' }, { line: 6, text: 'c: d;' },
    { line: 7, text: `// ${long}` }, { line: 8, text: 'e: f;' },
    { line: 9, text: '// short' },
  ];
  assert.deepEqual(longComments('a.scss', added).map(f => f.line), [1, 5, 7]);
});

test('repeats reports copied blocks, repeated fences and token declarations touched by the diff', () => {
  const fence = ':where(.field:not(.date-range, .dialog *))';
  const a = [
    `${fence} .x { --tok: var(--a); }`,
    `${fence} .y { --tok: var(--a); }`,
    `${fence} .z { --tok: var(--a); display: flex; }`,
    '.p { display: flex; }', '.q { display: flex; }', '.r { display: flex; }',
  ].join('\n');
  const b = '.lbl { font-weight: 400; margin-bottom: 0.5rem; }';
  const c = '.lbl2 { font-weight: 400; margin-bottom: 0.5rem; }';
  const d = '.lbl3 { font-weight: 400; margin-bottom: 0.5rem; }';
  const files = new Map([['a.scss', a], ['b.scss', b], ['c.scss', c], ['d.scss', d]]);
  const added = new Map([['a.scss', new Set([1])], ['b.scss', new Set([1])]]);
  const out = repeats(files, added);
  const checks = out.map(f => f.check).sort();
  assert.deepEqual(checks, ['repeated-block', 'repeated-declaration', 'repeated-fence', 'repeated-fence']);
  assert.match(out.find(f => f.check === 'repeated-declaration').detail, /--tok: var\(--a\) is set in 3 rules/);
  assert.match(out.find(f => f.check === 'repeated-block').detail, /^3 rules declare/);
  assert.equal(repeats(files, new Map()).length, 0);
});

test('urlChecks reports whether a referenced file exists at base and head', () => {
  const sets = { base: new Set(['src/assets/a.svg']), head: new Set(['src/assets/b.svg']) };
  const lines = [{ line: 3, text: "background: url('/assets/a.svg') no-repeat, url(data:image/png;base64,xx);" }, { line: 4, text: 'mask: url("~assets/b.svg");' }];
  assert.deepEqual(urlChecks('x.scss', lines, 'new', sets).map(f => f.detail), [
    '/assets/a.svg: at base exists, at head MISSING', '~assets/b.svg: at base MISSING, at head exists',
  ]);
});

test('isVendored skips minified files', () => {
  assert.equal(isVendored('lib.min.css', ''), true);
  assert.equal(isVendored('swagger-ui.css', 'a'.repeat(1200)), true);
  assert.equal(isVendored('app.scss', '.a { b: c; }'), false);
});

test('scan finds rules left dead by a removed element and classes nothing styles', () => {
  const wt = mkdtempSync(join(tmpdir(), 'scan-'));
  const git = (...a) => execFileSync('git', ['-C', wt, ...a], { encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  mkdirSync(join(wt, 'src'));
  writeFileSync(join(wt, 'src', 'a.html'), '<select class="old"></select>\n');
  writeFileSync(join(wt, 'src', 'a.scss'), 'select { padding: 5px; }\n.old { color: red; }\n');
  writeFileSync(join(wt, 'src', 'b.scss'), '.kept { color: blue; }\n');
  git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  writeFileSync(join(wt, 'src', 'a.html'), '<mat-select class="fresh"></mat-select>\n');
  writeFileSync(join(wt, 'src', 'b.scss'), '.kept { color: blue; }\n.ghost { margin-left: 2px; }\n.mat-search-bar .mat-form-field-flex { top: 0; }\n');
  git('add', '.'); git('commit', '-qm', 'head');
  const diff = git('diff', '-U40', base, 'HEAD');
  const { facts } = scan(wt, diff, base);
  const got = facts.map(f => `${f.check} ${f.path}:${f.line}`).sort();
  assert.deepEqual(got, [
    'physical-direction src/b.scss:2',
    'rule-for-removed-class src/a.scss:2',
    'rule-for-removed-element src/a.scss:1',
    'unused-selector-class src/b.scss:2',
    'unused-selector-class src/b.scss:3',
    'unused-template-class src/a.html:1',
  ]);
});
