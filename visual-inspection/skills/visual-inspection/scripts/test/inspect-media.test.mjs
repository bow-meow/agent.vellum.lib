import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  parseArgs, parseBox, parsePoint, formatBox, clipBox, parseComponents, groupRegions, sampleTimes,
  duplicatesOf, parseSceneTimes, parseFreezes, zoomFor, toolCandidates, isVideo,
} from '../inspect-media.mjs';

test('parseArgs splits the command, positionals and --options, coercing numbers', () => {
  const a = parseArgs(['compare', 'a.png', 'b.png', '--threshold', '0', '--min-area', '1', '--out', 'x']);
  assert.equal(a.cmd, 'compare');
  assert.deepEqual(a.positional, ['a.png', 'b.png']);
  assert.deepEqual(a.opts, { threshold: 0, minArea: 1, out: 'x' });
});

test('parseArgs keeps a box string a string and rejects an option with no value', () => {
  assert.equal(parseArgs(['crop', 'f.png', '--box', '600x300+100+200']).opts.box, '600x300+100+200');
  assert.throws(() => parseArgs(['crop', 'f.png', '--box']), /--box needs a value/);
});

test('parsePoint reads X,Y and refuses anything else', () => {
  assert.deepEqual(parsePoint('1000,600'), { x: 1000, y: 600 });
  for (const bad of ['1000', '-1,5', 'a,b', '']) assert.throws(() => parsePoint(bad), /X,Y/);
});

test('parseBox reads WIDTHxHEIGHT+X+Y and refuses anything else', () => {
  assert.deepEqual(parseBox('600x300+100+200'), { w: 600, h: 300, x: 100, y: 200 });
  assert.equal(formatBox({ w: 6, h: 3, x: 1, y: 2 }), '6x3+1+2');
  for (const bad of ['600x300', '0x10+0+0', '10x10-5+0', 'abc']) assert.throws(() => parseBox(bad), /box/);
});

test('clipBox trims a box to the image and reports when it had to', () => {
  assert.deepEqual(clipBox({ w: 50, h: 50, x: 80, y: 90 }, 100, 100),
    { box: { w: 20, h: 10, x: 80, y: 90 }, clipped: true });
  assert.deepEqual(clipBox({ w: 10, h: 10, x: 0, y: 0 }, 100, 100),
    { box: { w: 10, h: 10, x: 0, y: 0 }, clipped: false });
  assert.equal(clipBox({ w: 10, h: 10, x: 200, y: 0 }, 100, 100), null);
});

test('parseComponents keeps only the white (changed) objects from ImageMagick verbose output', () => {
  const out = [
    'Objects (id: bounding-box centroid area mean-color):',
    '  0: 120x80+0+0 59.9,39.7 9475 gray(0)',
    '  2: 2x31+51+10 51.5,25.0 62 gray(255)',
    '  3: 1x1+100+70 100.0,70.0 1 srgb(255,255,255)',
  ].join('\n');
  assert.deepEqual(parseComponents(out), [
    { box: { w: 2, h: 31, x: 51, y: 10 }, area: 62 },
    { box: { w: 1, h: 1, x: 100, y: 70 }, area: 1 },
  ]);
});

test('groupRegions merges changes within pad of each other, then drops groups under minArea', () => {
  const comps = [
    { box: { w: 2, h: 31, x: 10, y: 10 }, area: 62 },
    { box: { w: 2, h: 31, x: 16, y: 10 }, area: 62 },
    { box: { w: 1, h: 1, x: 100, y: 70 }, area: 1 },
  ];
  const { regions, ignoredPixels } = groupRegions(comps, { pad: 4, minArea: 2, width: 120, height: 80 });
  assert.equal(regions.length, 1);
  assert.equal(regions[0].changedPixels, 124);
  assert.deepEqual(regions[0].box, { w: 16, h: 39, x: 6, y: 6 });
  assert.deepEqual(regions[0].core, { w: 8, h: 31, x: 10, y: 10 });
  assert.equal(ignoredPixels, 1);
});

test('groupRegions folds in a change that only the merged box reaches, and sorts largest first', () => {
  const comps = [
    { box: { w: 10, h: 1, x: 0, y: 0 }, area: 10 },
    { box: { w: 1, h: 10, x: 9, y: 1 }, area: 10 },
    { box: { w: 1, h: 1, x: 2, y: 5 }, area: 1 },
    { box: { w: 1, h: 1, x: 40, y: 0 }, area: 1 },
    { box: { w: 5, h: 5, x: 50, y: 50 }, area: 25 },
  ];
  const { regions } = groupRegions(comps, { pad: 0, minArea: 1, width: 60, height: 60 });
  assert.deepEqual(regions.map(r => r.changedPixels), [25, 21, 1]);
  assert.deepEqual(regions[1].box, { w: 10, h: 11, x: 0, y: 0 });
});

test('sampleTimes takes interval midpoints so neither end frame is a black fade', () => {
  assert.deepEqual(sampleTimes(0, 8, 4), [1, 3, 5, 7]);
  assert.deepEqual(sampleTimes(20, 30, 1), [25]);
  assert.throws(() => sampleTimes(5, 5, 2), /interval/);
});

test('duplicatesOf points each exact repeat at the first frame with the same signature', () => {
  assert.deepEqual(duplicatesOf(['a', 'b', 'a', 'c', 'b']), [null, null, 0, null, 1]);
});

test('parseSceneTimes reads showinfo pts_time lines', () => {
  const err = '[Parsed_showinfo_1 @ 0x1] n:   0 pts:  12345 pts_time:12.345 duration:1\n'
    + 'noise\n[Parsed_showinfo_1 @ 0x1] n:   1 pts:  2 pts_time:20 duration:1\n';
  assert.deepEqual(parseSceneTimes(err), [12.345, 20]);
});

test('parseFreezes pairs freeze starts with their ends, leaving an unfinished one open', () => {
  const err = '[freezedetect @ 0x1] lavfi.freezedetect.freeze_start: 1.5\n'
    + '[freezedetect @ 0x1] lavfi.freezedetect.freeze_duration: 3\n'
    + '[freezedetect @ 0x1] lavfi.freezedetect.freeze_end: 4.5\n'
    + '[freezedetect @ 0x1] lavfi.freezedetect.freeze_start: 9\n';
  assert.deepEqual(parseFreezes(err), [{ start: 1.5, end: 4.5, duration: 3 }, { start: 9, end: null, duration: null }]);
});

test('zoomFor enlarges small regions only, a few-pixel one the most', () => {
  assert.equal(zoomFor({ w: 17, h: 17 }), 6);
  assert.equal(zoomFor({ w: 100, h: 40 }), 3);
  assert.equal(zoomFor({ w: 250, h: 40 }), 2);
  assert.equal(zoomFor({ w: 400, h: 400 }), 1);
});

test('toolCandidates tries the override, then PATH, then the Windows portable installs', () => {
  const env = { VISUAL_INSPECTION_MAGICK: 'C:\\x\\magick.exe', PATH: 'C:\\a;C:\\b', LOCALAPPDATA: 'C:\\L', ProgramFiles: 'C:\\P' };
  const c = toolCandidates('magick', env, 'win32', () => ['ImageMagick-7.1.2-Q16', 'Other']);
  assert.deepEqual(c, [
    'C:\\x\\magick.exe', join('C:\\a', 'magick.exe'), join('C:\\b', 'magick.exe'),
    join('C:\\L', 'Programs', 'ImageMagick', 'magick.exe'), join('C:\\P', 'ImageMagick-7.1.2-Q16', 'magick.exe'),
  ]);
  assert.deepEqual(toolCandidates('ffmpeg', { PATH: '/usr/bin' }, 'linux', () => []), [join('/usr/bin', 'ffmpeg')]);
});

test('isVideo goes by extension, treating GIF as an image', () => {
  assert.equal(isVideo('a.MP4'), true);
  assert.equal(isVideo('a.gif'), false);
  assert.equal(isVideo('a.png'), false);
});
