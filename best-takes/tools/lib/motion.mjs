// How much the picture moves in a span of a video, a few times a second: the share of the
// frame's pixels that differ from the frame before by more than a little. A cursor that moves,
// a click, a page that loads count; the noise of a camera does not. For the pauses of a cut: a
// pause shows something only where its picture moves clearly more than while the person speaks.
// A screen stands still while someone talks over it, so there any movement counts; a camera on
// a person always moves a little (the hand that holds it, breathing, blinking), so there only
// what moves more than that does (something held into the picture, the person turning).

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

// A pause shows something from ABOVE times the picture's movement while speaking (the median of
// its samples) on. Measured in November 2026, the share of changed pixels while speaking → the
// most of any sample in a pause of the same clip: a phone held in the hand 7–9 % → 2.6 times
// that, single samples while speaking up to 3.1 times; a tripod interview 1.5 % → 1.2 times; a
// webcam 2.2 %, speech up to 4.8 times. Something to see moves more: the same phone moved by
// the hand 3.6–9 times, a gesture into an interview's picture 20–25 times. A screen recording
// moves 0.03 % while speaking: its limit stays MOVING, its pauses are cut as before.
export const ABOVE = 4;
// Under this many seconds of speech the movement while speaking is guesswork; more than
// BASE_LONGEST seconds of the keeps are not measured for it (each video is read once more).
export const BASE_SECONDS = 3;
export const BASE_LONGEST = 60;

// The middle of the samples' changes, 0 without any
export function median(samples) {
  const v = samples.map((s) => s.change).sort((a, b) => a - b);
  return v.length ? (v[(v.length - 1) >> 1] + v[v.length >> 1]) / 2 : 0;
}

// The change from which a sample of a pause shows something, given the movement while speaking
export const limit = (base) => Math.max(MOVING, ABOVE * base);

// The spans in which the picture moves: samples from `least` on (MOVING, or a pause's limit),
// runs less than two seconds apart joined (the steps of one action: a click, the page, the next
// click), a quarter of a second added around each, within from–to.
export function moving(samples, from, to, least = MOVING) {
  const spans = [];
  for (const s of samples) {
    if (s.change < least) continue;
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

// How fast a wait plays when its picture moves (a clock, a progress bar): in 3 to 5 s, at most
// ten times as fast, so that the viewer sees the time pass.
export function waitSpeed(seconds) {
  const span = Math.min(5, Math.max(3, seconds / 6));
  return Math.max(1, Math.min(10, seconds / span));
}

// The picture of a wait moves enough to play as a timelapse from this share of its time on.
export const WAIT_MOVING = 0.15;
// A wait whose picture stands still holds this long before the cut.
export const WAIT_HOLD = 3;
