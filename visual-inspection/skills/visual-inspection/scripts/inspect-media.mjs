#!/usr/bin/env node
// Local screenshot and video evidence for the visual-inspection skill. Zero dependencies beyond
// Node 18+, ImageMagick 7 (`magick`) and, for video, FFmpeg (`ffmpeg`, `ffprobe`).
// Every command prints one compact JSON object on stdout. Exit codes: 0 ok, 1 failed, 2 bad usage,
// 3 a required tool is missing.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.mov', '.webm', '.avi', '.m4v', '.wmv', '.flv', '.mpg', '.mpeg', '.ts']);
const NUMERIC = new Set(['threshold', 'minArea', 'pad', 'maxRegions', 'maxEdge', 'zoom', 'frames', 'start', 'end',
  'at', 'limit', 'minSeconds', 'noise']);
const USAGE = `usage: inspect-media.mjs <command> [args]
  doctor
  probe FILE
  compare BEFORE AFTER [--threshold PCT=1] [--min-area PX=16] [--pad PX=8] [--max-regions N=2] [--max-edge PX=1280]
  crop FILE --box WxH+X+Y [--max-edge PX=1280] [--zoom N=1]
  pixel FILE... --xy X,Y
  video FILE [--start S] [--end S] [--frames N=8] [--max-edge PX=480]
  frame FILE --at S [--box WxH+X+Y] [--max-edge PX=1280]
  scenes FILE [--start S] [--end S] [--threshold 0..1=0.3] [--limit N=20]
  static FILE [--start S] [--end S] [--min-seconds S=2] [--noise 0..1=0.001]
all take [--out DIR]; default output is ~/.visual-inspection/<run>/`;

export class UsageError extends Error {}
export class MissingToolError extends Error {}

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const positional = [];
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const v = rest[++i];
    if (v === undefined || v.startsWith('--')) throw new UsageError(`${a} needs a value`);
    if (NUMERIC.has(key)) {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new UsageError(`${a} must be a number, got "${v}"`);
      opts[key] = n;
    } else opts[key] = v;
  }
  return { cmd, positional, opts };
}

export function parseBox(s) {
  const m = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(String(s ?? '').trim());
  if (!m || +m[1] === 0 || +m[2] === 0) throw new UsageError(`box must be WIDTHxHEIGHT+X+Y with a non-zero size, got "${s}"`);
  return { w: +m[1], h: +m[2], x: +m[3], y: +m[4] };
}

export function parsePoint(s) {
  const m = /^(\d+),(\d+)$/.exec(String(s ?? '').trim());
  if (!m) throw new UsageError(`point must be X,Y, got "${s}"`);
  return { x: +m[1], y: +m[2] };
}

export const formatBox = b =>`${b.w}x${b.h}+${b.x}+${b.y}`;

export function clipBox(b, width, height) {
  const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y);
  const x1 = Math.min(width, b.x + b.w), y1 = Math.min(height, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return null;
  const box = { w: x1 - x0, h: y1 - y0, x: x0, y: y0 };
  return { box, clipped: box.w !== b.w || box.h !== b.h || box.x !== b.x || box.y !== b.y };
}

// The mask is black where nothing changed, so only white objects are differences.
export function parseComponents(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*\d+:\s+(\d+)x(\d+)\+(\d+)\+(\d+)\s+\S+\s+(\d+)\s+(\S+)/.exec(line);
    if (!m || !/^(gray\((255|100%)\)|srgb\(255,255,255\)|white)$/i.test(m[6])) continue;
    out.push({ box: { w: +m[1], h: +m[2], x: +m[3], y: +m[4] }, area: +m[5] });
  }
  return out;
}

const gap = (a, b) => Math.max(
  Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)),
  Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h)));
const union = (a, b) => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

export function groupRegions(components, { pad, minArea, width, height }) {
  let groups = components.map(c => ({ box: { ...c.box }, changedPixels: c.area }));
  // A merged box can reach a change none of its members did, so merge until nothing moves.
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (gap(groups[i].box, groups[j].box) > pad) continue;
        groups[i] = { box: union(groups[i].box, groups[j].box), changedPixels: groups[i].changedPixels + groups[j].changedPixels };
        groups.splice(j, 1);
        merged = true;
        j = i;
      }
    }
  }
  const kept = groups.filter(g => g.changedPixels >= minArea);
  const ignoredPixels = groups.filter(g => g.changedPixels < minArea).reduce((s, g) => s + g.changedPixels, 0);
  const regions = kept
    .map(g => ({
      box: clipBox({ x: g.box.x - pad, y: g.box.y - pad, w: g.box.w + 2 * pad, h: g.box.h + 2 * pad }, width, height).box,
      core: g.box,
      changedPixels: g.changedPixels,
    }))
    .sort((a, b) => b.changedPixels - a.changedPixels);
  return { regions, ignoredPixels };
}

export function sampleTimes(start, end, n) {
  if (!(end > start) || !(n >= 1)) throw new UsageError(`empty sampling interval ${start}..${end} or frame count ${n}`);
  const step = (end - start) / n;
  return Array.from({ length: n }, (_, i) => Math.round((start + step * (i + 0.5)) * 1000) / 1000);
}

export function duplicatesOf(signatures) {
  const first = new Map();
  return signatures.map((s, i) => {
    if (first.has(s)) return first.get(s);
    first.set(s, i);
    return null;
  });
}

export const parseSceneTimes = stderr => [...stderr.matchAll(/Parsed_showinfo.*?pts_time:\s*(-?[\d.]+)/g)].map(m => Number(m[1]));

export function parseFreezes(stderr) {
  const out = [];
  for (const m of stderr.matchAll(/lavfi\.freezedetect\.freeze_(start|duration|end):\s*(-?[\d.]+)/g)) {
    const v = Number(m[2]);
    if (m[1] === 'start') out.push({ start: v, end: null, duration: null });
    else if (out.length) out[out.length - 1][m[1]] = v;
  }
  return out;
}

export function zoomFor(b) {
  const edge = Math.max(b.w, b.h);
  return edge < 60 ? 6 : edge < 150 ? 3 : edge < 300 ? 2 : 1;
}

export const isVideo = f => VIDEO_EXT.has(extname(f).toLowerCase());

const ENV_OVERRIDE = { magick: 'VISUAL_INSPECTION_MAGICK', ffmpeg: 'VISUAL_INSPECTION_FFMPEG', ffprobe: 'VISUAL_INSPECTION_FFPROBE' };

export function toolCandidates(name, env, platform, listDir = d => (existsSync(d) ? readdirSync(d) : [])) {
  const exe = platform === 'win32' ? `${name}.exe` : name;
  const c = [];
  if (env[ENV_OVERRIDE[name]]) c.push(env[ENV_OVERRIDE[name]]);
  for (const d of (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':')) if (d) c.push(join(d, exe));
  if (platform === 'win32') {
    // Portable installs that never reached PATH, or reached it after this shell started.
    if (name === 'magick') {
      if (env.LOCALAPPDATA) c.push(join(env.LOCALAPPDATA, 'Programs', 'ImageMagick', exe));
      if (env.ProgramFiles) for (const d of listDir(env.ProgramFiles)) if (/^ImageMagick/i.test(d)) c.push(join(env.ProgramFiles, d, exe));
    } else if (env.LOCALAPPDATA) {
      c.push(join(env.LOCALAPPDATA, 'Programs', 'ffmpeg', 'bin', exe), join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', exe));
    }
  }
  return c;
}

const findTool = name => toolCandidates(name, process.env, process.platform).find(p => existsSync(p)) ?? null;

function tool(name) {
  const p = findTool(name);
  if (!p) throw new MissingToolError(`${name} not found (PATH, or set ${ENV_OVERRIDE[name]})`);
  return p;
}

function run(exe, args, { allowFail = false } = {}) {
  const r = spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, windowsHide: true });
  if (r.error) throw r.error;
  if (r.status !== 0 && !allowFail) {
    throw new Error(`${basename(exe)} exited ${r.status}: ${(r.stderr || r.stdout).trim().slice(-600)}`);
  }
  return r;
}

const magick = args => run(tool('magick'), args).stdout;

function outDir(opts, cmd, file) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const dir = resolve(opts.out ?? join(homedir(), '.visual-inspection', `${stamp}-${cmd}-${basename(file, extname(file))}`));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function need(file) {
  if (!file) throw new UsageError('missing FILE');
  if (!existsSync(file)) throw new UsageError(`no such file: ${file}`);
  return resolve(file);
}

// [0] keeps multi-frame files (GIF, TIFF) to their first frame; -auto-orient makes every
// coordinate refer to the image as it is displayed.
const img = f => [`${f}[0]`, '-auto-orient'];

function imageSize(file) {
  const [w, h] = magick([...img(file), '-format', '%w %h', 'info:']).trim().split(' ').map(Number);
  return { w, h };
}

const fit = edge => ['-resize', `${edge}x${edge}>`];

function probeImage(file) {
  const [format, w, h, colorspace, alpha, depth, frames, mean, sd] = magick([`${file}[0]`, '-auto-orient', '-format',
    '%m|%w|%h|%[colorspace]|%A|%z|%n|%[fx:mean]|%[fx:standard_deviation]', 'info:']).trim().split('|');
  const stddev = Number(sd);
  return {
    kind: 'image', format, width: +w, height: +h, colorspace, alpha: alpha !== 'Undefined' && alpha !== 'False',
    depth: +depth, frames: +frames, mean: +Number(mean).toFixed(4), stddev: +stddev.toFixed(4),
    ...(stddev < 0.002 ? { warning: 'near-uniform image: possibly a blank or black capture' } : {}),
  };
}

function probeVideo(file) {
  const j = JSON.parse(run(tool('ffprobe'), ['-v', 'error', '-print_format', 'json', '-show_entries',
    'format=duration,format_name:stream=codec_type,codec_name,width,height,avg_frame_rate,nb_frames', file]).stdout);
  const v = j.streams?.find(s => s.codec_type === 'video');
  const [num, den] = String(v?.avg_frame_rate ?? '0/1').split('/').map(Number);
  return {
    kind: 'video', container: j.format?.format_name, duration: Number(j.format?.duration ?? 0),
    video: v ? { codec: v.codec_name, width: v.width, height: v.height, fps: den ? +(num / den).toFixed(3) : null } : null,
    audio: j.streams?.some(s => s.codec_type === 'audio') ?? false,
  };
}

function window(opts, duration) {
  const start = opts.start ?? 0;
  const end = Math.min(opts.end ?? duration, duration);
  if (!(end > start)) throw new UsageError(`interval ${start}..${end} is outside the ${duration}s video`);
  return { start, end };
}

const commands = {
  doctor() {
    const found = n => {
      const p = findTool(n);
      if (!p) return { found: false };
      const r = spawnSync(p, n === 'magick' ? ['-version'] : ['-hide_banner', '-version'], { encoding: 'utf8', windowsHide: true });
      return { found: true, path: p, version: (r.stdout ?? '').split(/\r?\n/)[0].trim() };
    };
    const tools = { magick: found('magick'), ffmpeg: found('ffmpeg'), ffprobe: found('ffprobe') };
    const missing = Object.entries(tools).filter(([, t]) => !t.found).map(([n]) => n);
    return {
      node: process.version, ...tools, missing,
      canImages: tools.magick.found, canVideo: tools.magick.found && tools.ffmpeg.found && tools.ffprobe.found,
      outRoot: join(homedir(), '.visual-inspection'),
    };
  },

  probe({ positional: [f] }) {
    const file = need(f);
    return { file, ...(isVideo(file) ? probeVideo(file) : probeImage(file)) };
  },

  compare({ positional: [b, a], opts }) {
    const before = need(b), after = need(a);
    const threshold = opts.threshold ?? 1, minArea = opts.minArea ?? 16, pad = opts.pad ?? 8;
    const maxRegions = opts.maxRegions ?? 2, maxEdge = opts.maxEdge ?? 1280;
    const sb = imageSize(before), sa = imageSize(after);
    const settings = { threshold, minArea, pad };
    if (sb.w !== sa.w || sb.h !== sa.h) {
      return { status: 'dimension-mismatch', before: { file: before, ...sb }, after: { file: after, ...sa }, ...settings,
        note: 'not compared: sizes differ, and resizing would hide the real difference' };
    }
    const cc = magick([...img(before), ...img(after), '-alpha', 'off', '-compose', 'difference', '-composite',
      '-separate', '-evaluate-sequence', 'max', '-threshold', `${threshold}%`,
      '-define', 'connected-components:verbose=true', '-connected-components', '8', 'null:']);
    const comps = parseComponents(cc);
    const changedPixels = comps.reduce((s, c) => s + c.area, 0);
    const { regions, ignoredPixels } = groupRegions(comps, { pad, minArea, width: sa.w, height: sa.h });
    const base = { size: sa, changedPixels, changedPercent: +(100 * changedPixels / (sa.w * sa.h)).toFixed(4), ...settings,
      ignoredBelowMinArea: ignoredPixels };
    if (!regions.length) return { status: changedPixels ? 'below-min-area' : 'unchanged', ...base };

    const dir = outDir(opts, 'compare', after);
    const stroke = Math.max(2, Math.round(Math.max(sa.w, sa.h) / 640));
    const draw = regions.flatMap((r, i) => {
      const { x, y, w, h } = r.box;
      return ['-fill', 'none', '-stroke', i < maxRegions ? 'red' : 'orange', '-strokewidth', `${stroke}`,
        '-draw', `rectangle ${x},${y} ${x + w - 1},${y + h - 1}`,
        '-stroke', 'none', '-fill', i < maxRegions ? 'red' : 'orange', '-pointsize', `${8 * stroke}`,
        '-annotate', `+${x + stroke}+${Math.max(8 * stroke, y - stroke)}`, `${i + 1}`];
    });
    const overview = join(dir, 'overview.png');
    magick([...img(after), ...draw, ...fit(maxEdge), overview]);

    const detailed = regions.slice(0, maxRegions).map((r, i) => {
      const g = formatBox(r.box), zoom = zoomFor(r.box);
      const detail = join(dir, `region-${i + 1}.png`);
      magick(['(', ...img(before), '-crop', g, '+repage', ')',
        '(', ...img(after), '-crop', g, '+repage', '-background', 'magenta', '-gravity', 'west', '-splice', '4x0', ')',
        '+gravity', '+append', ...(zoom > 1 ? ['-filter', 'point', '-resize', `${zoom * 100}%`] : fit(maxEdge)), detail]);
      return { id: i + 1, box: g, core: formatBox(r.core), changedPixels: r.changedPixels, zoom, detail };
    });
    const omitted = regions.slice(maxRegions);
    const report = join(dir, 'report.json');
    writeFileSync(report, JSON.stringify({ before, after, ...base, maxRegions,
      regions: regions.map((r, i) => ({ id: i + 1, box: formatBox(r.box), core: formatBox(r.core), changedPixels: r.changedPixels })) }, null, 1));
    return { status: 'changed', ...base, regions: detailed,
      omitted: { regions: omitted.length, changedPixels: omitted.reduce((s, r) => s + r.changedPixels, 0) },
      layout: 'each detail is before | after, split by a magenta bar', overview, report };
  },

  pixel({ positional, opts }) {
    if (!positional.length) throw new UsageError('missing FILE');
    const { x, y } = parsePoint(opts.xy);
    return { xy: `${x},${y}`, colors: positional.map(f => {
      const file = need(f);
      const size = imageSize(file);
      if (x >= size.w || y >= size.h) throw new UsageError(`${x},${y} is outside the ${size.w}x${size.h} image ${file}`);
      const [hex, alpha] = magick([...img(file), '-crop', `1x1+${x}+${y}`, '+repage', '-format',
        '#%[hex:u.p{0,0}]|%[fx:u.p{0,0}.a]', 'info:']).trim().split('|');
      return { file, hex: hex.slice(0, 7), alpha: +Number(alpha).toFixed(3) };
    }) };
  },

  crop({ positional: [f], opts }) {
    const file = need(f);
    const size = imageSize(file);
    const c = clipBox(parseBox(opts.box), size.w, size.h);
    if (!c) throw new UsageError(`box ${opts.box} is outside the ${size.w}x${size.h} image`);
    const zoom = opts.zoom ?? 1;
    const out = join(outDir(opts, 'crop', file), `crop-${formatBox(c.box).replace(/\+/g, '_')}.png`);
    magick([...img(file), '-crop', formatBox(c.box), '+repage',
      ...(zoom > 1 ? ['-filter', 'point', '-resize', `${zoom * 100}%`] : fit(opts.maxEdge ?? 1280)), out]);
    return { file: out, source: file, imageSize: size, box: formatBox(c.box), clipped: c.clipped, zoom, ...imageSize(out) };
  },

  video({ positional: [f], opts }) {
    const file = need(f);
    const info = probeVideo(file);
    const { start, end } = window(opts, info.duration);
    const times = sampleTimes(start, end, opts.frames ?? 8);
    const edge = opts.maxEdge ?? 480;
    const dir = outDir(opts, 'video', file);
    const ffmpeg = tool('ffmpeg');
    const frames = times.map((t, i) => {
      const out = join(dir, `frame-${String(i + 1).padStart(2, '0')}-${t.toFixed(3)}s.png`);
      run(ffmpeg, ['-v', 'error', '-y', '-ss', `${t}`, '-i', file, '-frames:v', '1',
        '-vf', `scale='min(iw,${edge})':'min(ih,${edge})':force_original_aspect_ratio=decrease`, out]);
      return { t, file: out };
    }).filter(fr => existsSync(fr.file));
    if (!frames.length) throw new Error('ffmpeg wrote no frames');
    const sigs = magick(['identify', '-format', '%#\n', ...frames.map(fr => fr.file)]).trim().split(/\r?\n/);
    const dup = duplicatesOf(sigs);
    frames.forEach((fr, i) => { fr.duplicateOf = dup[i] === null ? null : frames[dup[i]].t; });
    const distinct = frames.filter(fr => fr.duplicateOf === null);
    const overview = join(dir, 'contact-sheet.png');
    const sheet = join(dir, 'contact-sheet-full.png');
    magick(['montage', ...distinct.flatMap(fr => ['-label', `${fr.t.toFixed(2)}s`, fr.file]),
      '-tile', `${Math.min(4, distinct.length)}x`, '-geometry', '+4+4', '-background', '#e0e0e0', sheet]);
    magick([sheet, ...fit(1280), overview]);
    return { file, duration: info.duration, interval: { start, end }, sampled: frames.length, distinct: distinct.length,
      frames: frames.map(({ t, file: ff, duplicateOf }) => ({ t, file: ff, ...(duplicateOf === null ? {} : { duplicateOf }) })),
      overview, coverage: `${frames.length} instants in ${(end - start).toFixed(2)}s; anything between them is unseen` };
  },

  frame({ positional: [f], opts }) {
    const file = need(f);
    if (opts.at === undefined) throw new UsageError('frame needs --at SECONDS');
    const { duration } = probeVideo(file);
    if (opts.at < 0 || opts.at >= duration) throw new UsageError(`--at ${opts.at} is outside the ${duration}s video`);
    const dir = outDir(opts, 'frame', file);
    const full = join(dir, `frame-${opts.at.toFixed(3)}s.png`);
    run(tool('ffmpeg'), ['-v', 'error', '-y', '-ss', `${opts.at}`, '-i', file, '-frames:v', '1', full]);
    if (!existsSync(full)) throw new UsageError(`no frame at ${opts.at}s (past the end?)`);
    const size = imageSize(full);
    if (!opts.box) {
      const out = join(dir, `frame-${opts.at.toFixed(3)}s-fit.png`);
      magick([full, ...fit(opts.maxEdge ?? 1280), out]);
      return { file: out, fullResolution: full, at: opts.at, frameSize: size };
    }
    const c = clipBox(parseBox(opts.box), size.w, size.h);
    if (!c) throw new UsageError(`box ${opts.box} is outside the ${size.w}x${size.h} frame`);
    const out = join(dir, `frame-${opts.at.toFixed(3)}s-${formatBox(c.box).replace(/\+/g, '_')}.png`);
    magick([full, '-crop', formatBox(c.box), '+repage', ...fit(opts.maxEdge ?? 1280), out]);
    return { file: out, fullResolution: full, at: opts.at, frameSize: size, box: formatBox(c.box), clipped: c.clipped };
  },

  scenes({ positional: [f], opts }) {
    const file = need(f);
    const { start, end } = window(opts, probeVideo(file).duration);
    const threshold = opts.threshold ?? 0.3, limit = opts.limit ?? 20;
    const r = run(tool('ffmpeg'), ['-hide_banner', '-nostats', '-copyts', '-ss', `${start}`, '-t', `${end - start}`,
      '-i', file, '-an', '-vf', `select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-']);
    const times = parseSceneTimes(r.stderr);
    return { file, interval: { start, end }, threshold, count: times.length, changes: times.slice(0, limit),
      ...(times.length > limit ? { omitted: times.length - limit } : {}) };
  },

  static({ positional: [f], opts }) {
    const file = need(f);
    const { start, end } = window(opts, probeVideo(file).duration);
    const minSeconds = opts.minSeconds ?? 2, noise = opts.noise ?? 0.001;
    const r = run(tool('ffmpeg'), ['-hide_banner', '-nostats', '-copyts', '-ss', `${start}`, '-t', `${end - start}`,
      '-i', file, '-an', '-vf', `freezedetect=n=${noise}:d=${minSeconds}`, '-f', 'null', '-']);
    const spans = parseFreezes(r.stderr).map(s => (s.end === null ? { ...s, end, duration: +(end - s.start).toFixed(3), open: true } : s));
    return { file, interval: { start, end }, minSeconds, noise, count: spans.length, staticSpans: spans,
      note: 'a static span means the pixels did not change, not that the application froze' };
  },
};

function main(argv) {
  const known = commands[argv[0]] !== undefined;
  try {
    if (!known) throw new UsageError(argv[0] ? `unknown command "${argv[0]}"` : 'no command');
    const args = parseArgs(argv);
    process.stdout.write(JSON.stringify(commands[args.cmd](args)) + '\n');
    return 0;
  } catch (e) {
    const code = e instanceof UsageError ? 2 : e instanceof MissingToolError ? 3 : 1;
    process.stdout.write(JSON.stringify({ error: e.message, ...(known ? {} : { usage: USAGE }),
      ...(code === 3 ? { hint: 'run: node inspect-media.mjs doctor' } : {}) }) + '\n');
    return code;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
