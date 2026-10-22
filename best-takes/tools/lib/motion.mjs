// How much the picture moves in a span of a video, a few times a second: the share of the
// frame's pixels that differ from the frame before by more than a little. A cursor that moves,
// a click, a page that loads count; the noise of a camera does not. For the pauses of a cut:
// where the picture stands still the pause can go, where it moves it shows something.

import { execFileSync } from "node:child_process";

export const SAMPLES = 4; // a second
const WIDTH = 160;
const STEP = 12; // grey levels a pixel must change by
export const MOVING = 0.002; // the share of changed pixels from which the picture moves

// [{ t, change }] for the span from–to of the video `file` (width × height)
export function activity(file, from, to, { width, height }) {
  if (to - from < 2 / SAMPLES) return [];
  const h = Math.max(2, Math.round((WIDTH * height) / width / 2) * 2);
  const raw = execFileSync("ffmpeg", ["-v", "error", "-ss", String(from), "-t", String(to - from), "-i", file, "-an",
    "-vf", `fps=${SAMPLES},scale=${WIDTH}:${h},format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 });
  const size = WIDTH * h, frames = Math.floor(raw.length / size), out = [];
  for (let k = 1; k < frames; k++) {
    let changed = 0;
    for (let i = 0, a = (k - 1) * size, b = k * size; i < size; i++) if (Math.abs(raw[a + i] - raw[b + i]) > STEP) changed++;
    out.push({ t: from + k / SAMPLES, change: changed / size });
  }
  return out;
}

// The spans in which the picture moves: samples over MOVING, runs less than two seconds apart
// joined (the steps of one action: a click, the page, the next click), a quarter of a second
// added around each, within from–to.
export function moving(samples, from, to) {
  const spans = [];
  for (const s of samples) {
    if (s.change < MOVING) continue;
    const a = s.t - 1 / SAMPLES - 0.25, b = s.t + 0.25, last = spans.at(-1);
    if (last && a - last.to < 2) last.to = b;
    else spans.push({ from: a, to: b });
  }
  return spans.map((s) => ({ from: Math.max(from, s.from), to: Math.min(to, s.to) })).filter((s) => s.to - s.from > 0);
}

// How fast a moving span plays: up to 2.5 s as it is, longer ones in about a third of their
// time, 2 to 6 s, at most ten times as fast (HyperFrames' limit).
export function speed(seconds) {
  if (seconds <= 2.5) return 1;
  return Math.min(10, seconds / Math.min(6, Math.max(2, seconds / 3)));
}
