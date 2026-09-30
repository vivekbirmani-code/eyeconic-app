#!/usr/bin/env node
/**
 * Phase 0 spike — replay footage generator (PC-side; spike-only tooling).
 *
 * Turns a prerecorded video (needs ffmpeg on PATH) OR an existing folder of
 * JPEG frames into a generated data module the spike screen's REPLAY mode
 * consumes:
 *
 *   video:   node scripts/make-spike-replay.mjs interview.mp4 c2
 *   folder:  node scripts/make-spike-replay.mjs .\frames c2
 *
 * Output: services/proctoringSpike/replayData/<name>.ts exporting
 * REPLAY_FRAMES_<NAME> (base64 JPEGs, ≤640 px long edge, one frame per
 * ~1.8 s by default so N frames ≈ N × 1.8 s of equivalent replay time; the
 * Phase 0 C/D protocol needs ≥60 s ⇒ ≥34 frames).
 *
 * Footage guidance (matches the live Run-3 side-by-side framing): all faces
 * at a normal seated distance from the camera, fully in frame, similar size,
 * ≥60 s of footage with the people present throughout.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const CADENCE_MS = 1800;
const MAX_DIM = 640;
const MIN_FRAMES_60S = Math.ceil(60_000 / CADENCE_MS);
const TARGETS = new Set(['c2', 'd3']);

const [rawInput, rawTarget] = process.argv.slice(2);
if (!rawInput || !TARGETS.has(rawTarget ?? '')) {
  console.error('Usage: node scripts/make-spike-replay.mjs <video.mp4 | framesDir> <c2|d3>');
  process.exit(1);
}
const target = rawTarget;
const input = resolve(rawInput);
if (!existsSync(input)) {
  console.error(`Input not found: ${input}`);
  process.exit(1);
}

// ---- collect JPEG frames ---------------------------------------------------
const tempDir = resolve('node_modules', '.cache', `spike-replay-${target}`);
let frameFiles = [];
const isDir = statSync(input).isDirectory();

if (isDir) {
  frameFiles = readdirSync(input)
    .filter((f) => /\.jpe?g$/i.test(f))
    .sort()
    .map((f) => resolve(input, f));
  if (frameFiles.length === 0) {
    console.error(`No .jpg files in ${input}`);
    process.exit(1);
  }
  console.log(`Using ${frameFiles.length} frame images from ${input}`);
} else {
  // Video → frames via ffmpeg (sampled at the replay cadence, downscaled).
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    console.error(
      'ffmpeg not found on PATH. Install it (winget install Gyan.FFmpeg), or extract frames yourself into a folder and pass the folder instead.'
    );
    process.exit(1);
  }
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });
  const fps = `1000/${CADENCE_MS}`;
  execFileSync(
    'ffmpeg',
    [
      '-y', '-i', input,
      '-vf', `fps=${fps},scale='min(${MAX_DIM},iw)':-2`,
      '-q:v', '5',
      resolve(tempDir, 'frame_%04d.jpg'),
    ],
    { stdio: 'inherit' }
  );
  frameFiles = readdirSync(tempDir)
    .filter((f) => f.endsWith('.jpg'))
    .sort()
    .map((f) => resolve(tempDir, f));
  if (frameFiles.length === 0) {
    console.error('ffmpeg produced no frames — check the video file.');
    process.exit(1);
  }
}

if (frameFiles.length < MIN_FRAMES_60S) {
  console.warn(
    `WARNING: ${frameFiles.length} frames = ~${((frameFiles.length * CADENCE_MS) / 1000).toFixed(1)}s of equivalent replay time — below the 60 s protocol minimum (${MIN_FRAMES_60S} frames).`
  );
}

// ---- emit the generated module ---------------------------------------------
const chunks = [];
let totalBytes = 0;
for (const file of frameFiles) {
  const buf = readFileSync(file);
  totalBytes += buf.length;
  chunks.push(buf.toString('base64'));
}
const avgKb = Math.round(totalBytes / frameFiles.length / 1024);
if (avgKb > 300) {
  console.warn(
    `WARNING: frames average ${avgKb} KB — pass a VIDEO (auto-scaled to ≤${MAX_DIM}px) or pre-scaled images; oversized frames bloat the bundle.`
  );
}

const varName = `REPLAY_FRAMES_${target.toUpperCase()}`;
const outPath = resolve('services', 'proctoringSpike', 'replayData', `${target}.ts`);
const header = [
  '/**',
  ` * GENERATED FILE — Phase 0 synthetic replay footage (scenario ${target === 'c2' ? 'C, two people' : 'D, three people'}).`,
  ` * Source: ${basename(input)} · ${frameFiles.length} frames · ~${((frameFiles.length * CADENCE_MS) / 1000).toFixed(1)}s equivalent · generated ${new Date().toISOString()}`,
  ' * Overwritten by scripts/make-spike-replay.mjs; do not edit by hand.',
  ' */',
].join('\n');

const body = `export const ${varName}: string[] = [\n${chunks
  .map((c) => `  '${c}',`)
  .join('\n')}\n];\n`;
writeFileSync(outPath, `${header}\n${body}`);
console.log(
  `Wrote ${outPath}\n  ${frameFiles.length} frames (${(totalBytes / 1024 / 1024).toFixed(2)} MB raw, ${varName})\n  Equivalent replay time: ~${((frameFiles.length * CADENCE_MS) / 1000).toFixed(1)} s at ${CADENCE_MS} ms cadence\n  Next: reload Metro, open the spike screen → Replay validation → run ${target.toUpperCase()}.`
);
if (!isDir) rmSync(tempDir, { recursive: true, force: true });
