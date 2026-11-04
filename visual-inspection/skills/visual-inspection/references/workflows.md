# Visual inspection: options, signals and limits

Read this only for a scene or static-picture question, an option the SKILL.md doesn't cover, or a missing tool.

## Commands

Every command prints one JSON line. Exit codes: 0 ok (including `changed`), 1 failed, 2 bad usage, 3 a tool is
missing. All commands take `--out DIR`; the default is `~/.visual-inspection/<timestamp>-<command>-<file>/`.

| Command | Options (default) | Returns |
|---|---|---|
| `doctor` | | each tool's path and version, `missing`, `canImages`, `canVideo` |
| `probe FILE` | | image: format, size, colorspace, alpha, frames, mean, stddev, a near-uniform warning. Video: duration, codec, size, fps, audio |
| `compare BEFORE AFTER` | `--threshold` % per channel (1), `--min-area` px (16), `--pad` px (8), `--max-regions` (2), `--max-edge` (1280) | `status`, `changedPixels`, `changedPercent`, `ignoredBelowMinArea`, detailed `regions`, `omitted`, `overview`, `report` |
| `crop FILE --box WxH+X+Y` | `--max-edge` (1280), `--zoom` (1) | output file, the box after clipping, `clipped` |
| `pixel FILE... --xy X,Y` | | the colour (`#RRGGBB`) and alpha at that point in each file |
| `video FILE` | `--start`, `--end` (whole video), `--frames` (8), `--max-edge` per frame (480) | frames with times and `duplicateOf`, `distinct`, contact sheet `overview` (capped at 1280 px; `contact-sheet-full.png` beside it is full size), a coverage note |
| `frame FILE --at S` | `--box`, `--max-edge` (1280) | the crop or fitted frame, plus the full-resolution frame path |
| `scenes FILE` | `--start`, `--end`, `--threshold` 0–1 (0.3), `--limit` (20) | times where the picture changes sharply |
| `static FILE` | `--start`, `--end`, `--min-seconds` (2), `--noise` 0–1 (0.001) | spans where the picture stays still; `open: true` means it was still static at the interval's end |

## How `compare` decides

- A pixel counts as changed when any colour channel differs by more than `--threshold` percent. Alpha is ignored,
  so a change only in transparency does not show.
- Changed pixels within `--pad` of each other merge into one region; a region with fewer than `--min-area` changed
  pixels is dropped and counted in `ignoredBelowMinArea`. Status `below-min-area` means pixels changed but every
  region was too small.
- Each region has `core`, the exact box of its changed pixels, and `box`, that box grown by `--pad` and clipped to
  the image, which is what the crop shows.
- Regions are ranked by changed pixels. The top `--max-regions` get a detail crop; the rest are in `omitted` and
  `report.json`. The overview draws all of them, red with a detail crop and orange without.
- Raise `--pad` when one change is split into many small regions (scattered text edits); lower it when unrelated
  changes merge into one huge box.
- Antialiasing and font hinting produce faint edge differences: the default 1% threshold hides most of them. Use
  `--threshold 0` only when you are hunting a one-pixel bug.

## Scene changes and static pictures

`scenes` uses FFmpeg's scene score: 0 means identical frames, 1 completely different. The default 0.3 catches cuts and
dialogs opening; lower it (0.1) for subtle changes, raise it (0.5) for noisy recordings. Use the returned times as
`--at` values for `frame`, or as a narrow `--start`/`--end` for `video`.

`static` uses FFmpeg's freezedetect. `--noise` is the difference allowed between frames (0.001 tolerates compression
noise; raise it for grainy video). A span shows only that the pixels did not change: a blinking cursor, a clock or an
animation will break it, and a frozen application with a moving cursor won't show as static.

Both read every frame in the interval, so on a long recording run them over a narrow interval first.

## Limits

- `video` samples interval midpoints, so the very first and last frames are never shown; ask for a narrow interval
  around them.
- Frame times come from seeking, which lands on the nearest decodable frame; treat them as accurate to about one frame.
- Multi-frame images (GIF, TIFF) are read as their first frame only.
- Coordinates are in the original, auto-oriented image; a thumbnail's coordinates must be scaled back before use.

## Installing the tools

Ask the user before installing anything.

- **Windows:** `winget install ImageMagick.ImageMagick` and `winget install Gyan.FFmpeg`. Where winget is unavailable,
  the portable builds work unpacked anywhere: ImageMagick's `portable-Q16-x64` archive from its GitHub releases, and an
  FFmpeg `win64-gpl` build. The helper also finds them unpacked at `%LOCALAPPDATA%\Programs\ImageMagick\` and
  `%LOCALAPPDATA%\Programs\ffmpeg\bin\` without PATH changes.
- **macOS:** `brew install imagemagick ffmpeg`.
- **Linux:** the distribution's `imagemagick` and `ffmpeg` packages; check `magick -version` reports 7.x, since some
  distributions still ship 6, which has no `magick` command.
- Any other location: set `VISUAL_INSPECTION_MAGICK`, `VISUAL_INSPECTION_FFMPEG`, `VISUAL_INSPECTION_FFPROBE` to the
  executables.
