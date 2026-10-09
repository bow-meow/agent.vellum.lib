import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageOf, importsIn, changedFiles, depNamesInAddedPackageJsonLines, lockEntry, isPublic, registryOf, trustedRegistry, untar, writeSources, plan } from '../deps.mjs';

const REG = 'https://pkgs.dev.azure.com/acme/_packaging/feed/npm/registry/';

test('packageOf keeps the package name and rejects relative and URL specifiers', () => {
  assert.equal(packageOf('@acme/ui-services'), '@acme/ui-services');
  assert.equal(packageOf('@acme/ui-services/testing'), '@acme/ui-services');
  assert.equal(packageOf('~@acme/theme/styles'), '@acme/theme');
  assert.equal(packageOf('rxjs/operators'), 'rxjs');
  assert.equal(packageOf('./local'), null);
  assert.equal(packageOf('node:fs'), null);
  assert.equal(packageOf('@acme/x; rm -rf /'), null);
});

test('importsIn finds ES, dynamic, require and SCSS imports', () => {
  const t = [
    "import { DialogService } from '@acme/ui-services';",
    "const m = await import('@acme/lazy');",
    "const x = require('lodash');",
    "import 'zone.js';",
    "@use '@acme/theme' as theme;",
    "import { a } from './a';",
  ].join('\n');
  assert.deepEqual([...importsIn(t)].sort(), ['@acme/lazy', '@acme/theme', '@acme/ui-services', 'lodash', 'zone.js']);
});

test('changedFiles collects added lines per new-side path and ignores deletions', () => {
  const d = ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', '-old', '+new',
    'diff --git a/gone.ts b/gone.ts', '--- a/gone.ts', '+++ /dev/null', '@@ -1 +0,0 @@', '-bye', ''].join('\n');
  assert.deepEqual([...changedFiles(d)], [['a.ts', ['new']]]);
});

test('depNamesInAddedPackageJsonLines reads dependency keys', () => {
  assert.deepEqual([...depNamesInAddedPackageJsonLines(['    "@acme/ui-services": "0.0.101",', '  "version": "1.0.0",'])].sort(), ['@acme/ui-services', 'version']);
});

test('lockEntry reads lockfile v2/v3 and v1 shapes', () => {
  assert.deepEqual(lockEntry({ packages: { 'node_modules/@acme/x': { version: '1.2.3', resolved: 'r' } } }, '@acme/x'), { version: '1.2.3', resolved: 'r' });
  assert.deepEqual(lockEntry({ dependencies: { y: { version: '2.0.0' } } }, 'y'), { version: '2.0.0', resolved: null });
  assert.equal(lockEntry({ packages: {} }, 'z'), null);
});

test('isPublic and registryOf', () => {
  assert.equal(isPublic('https://registry.npmjs.org/rxjs/-/rxjs-7.8.1.tgz'), true);
  assert.equal(isPublic(`${REG}@acme/x/-/x-1.0.0.tgz`), false);
  assert.equal(isPublic('not a url'), true);
  assert.equal(registryOf(`${REG}@acme/x/-/x-1.0.0.tgz`, '@acme/x'), REG);
});

test('trustedRegistry accepts only registries named in the user npmrc', () => {
  const rc = '//pkgs.dev.azure.com/acme/_packaging/feed/npm/registry/:_authToken=abc\n@other:registry=https://npm.other.example/\n';
  assert.equal(trustedRegistry(REG, rc), true);
  assert.equal(trustedRegistry('https://npm.other.example/', rc), true);
  assert.equal(trustedRegistry('https://evil.example/registry/', rc), false);
  assert.equal(trustedRegistry(REG, ''), false);
});

function tarEntry(name, body) {
  const h = Buffer.alloc(512);
  h.write(name, 0, 'utf8');
  h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136); h.write('0', 156); h.write('ustar\0', 257);
  const pad = Buffer.alloc(Math.ceil(body.length / 512) * 512 - body.length);
  return Buffer.concat([h, Buffer.from(body), pad]);
}

test('untar writes regular files and refuses paths outside the destination', () => {
  const dest = mkdtempSync(join(tmpdir(), 'deps-t-'));
  const buf = Buffer.concat([tarEntry('package/package.json', '{}'), tarEntry('../escape.txt', 'x'), Buffer.alloc(1024)]);
  const written = untar(buf, join(dest, 'out'));
  assert.equal(written.length, 1);
  assert.equal(readFileSync(join(dest, 'out', 'package', 'package.json'), 'utf8'), '{}');
  assert.equal(existsSync(join(dest, 'escape.txt')), false);
});

test('writeSources restores sourcemap sources, strips leading ../ and refuses absolute paths', () => {
  const dest = mkdtempSync(join(tmpdir(), 'deps-s-'));
  const map = JSON.stringify({ sources: ['../../../../libs/x/src/a.ts', 'webpack:///src/b.ts', '/etc/abs.ts', 'no-content.ts'], sourcesContent: ['A', 'B', 'C', null] });
  assert.equal(writeSources(map, dest), 2);
  assert.equal(readFileSync(join(dest, 'libs', 'x', 'src', 'a.ts'), 'utf8'), 'A');
  assert.equal(readFileSync(join(dest, 'src', 'b.ts'), 'utf8'), 'B');
  assert.equal(writeSources('not json', dest), 0);
});

test('plan picks private packages imported by changed files and skips public ones', () => {
  const wt = mkdtempSync(join(tmpdir(), 'deps-p-'));
  mkdirSync(join(wt, 'web', 'src'), { recursive: true });
  writeFileSync(join(wt, 'web', 'package-lock.json'), JSON.stringify({ packages: {
    'node_modules/@acme/ui-services': { version: '0.0.101', resolved: `${REG}@acme/ui-services/-/ui-services-0.0.101.tgz` },
    'node_modules/rxjs': { version: '7.8.1', resolved: 'https://registry.npmjs.org/rxjs/-/rxjs-7.8.1.tgz' },
  } }));
  writeFileSync(join(wt, 'web', 'src', 'd.ts'), "import { DialogService } from '@acme/ui-services';\nimport { of } from 'rxjs';\nexport const x = 1;\n");
  writeFileSync(join(wt, 'web', 'src', 'u.ts'), "import { DialogService } from '@acme/ui-services';\n");
  const diff = ['diff --git a/web/src/d.ts b/web/src/d.ts', '--- a/web/src/d.ts', '+++ b/web/src/d.ts', '@@ -3 +3 @@', '-export const x = 0;', '+export const x = 1;', ''].join('\n');
  assert.deepEqual(plan(wt, diff), [{ name: '@acme/ui-services', version: '0.0.101', registry: REG, usedBy: ['web/src/d.ts'] }]);
  assert.deepEqual(plan(wt, ''), []);
});
