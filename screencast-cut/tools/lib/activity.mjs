// Where and how much a source's picture changes, four times a second over the whole recording:
// the share of pixels that differ from the frame before by more than a little, and the box
// around them. A cursor, a click, typing, a page that loads count; a camera's noise does not.
// What changes tells which source is worth showing, its box where to zoom in.
//
//   measure(file, offset, size) → [{ t, c, b: [x0, y0, x1, y1] | null }]   t on the recording's
//   timeline, c the share of changed pixels, b their box in 0–1 of the frame

import { execFileSync } from "node:child_process";

export const RATE = 4; // samples a second
const WIDTH = 320;
const STEP = 14; // grey levels a pixel must change by
export const MOVING = 0.002; // the share of changed pixels from which the picture moves
// the share from which something happens on a screen at all: typing changes 0.05–0.2 % of a
// screen's pixels a frame, a screen that stands still (a blinking caret) about 0.01 %
export const ACTIVE = 0.0004;

export function measure(file, offset, { width, height }) {
  const h = Math.max(2, Math.round((WIDTH * height) / width / 2) * 2);
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-an", "-vf", `fps=${RATE},scale=${WIDTH}:${h},format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 2 ** 31 });
  const size = WIDTH * h, frames = Math.floor(raw.length / size), out = [];
  for (let k = 1; k < frames; k++) {
    let changed = 0, x0 = WIDTH, y0 = h, x1 = -1, y1 = -1;
    const a = (k - 1) * size, b = k * size;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const i = y * WIDTH + x;
        if (Math.abs(raw[a + i] - raw[b + i]) > STEP) {
          changed++;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    const c = changed / size;
    out.push({ t: +(offset + k / RATE).toFixed(2), c: +c.toFixed(5),
      b: c >= ACTIVE ? [x0 / WIDTH, y0 / h, (x1 + 1) / WIDTH, (y1 + 1) / h].map((v) => +v.toFixed(3)) : null });
  }
  return out;
}

const within = (samples, from, to) => samples.filter((s) => s.t > from && s.t <= to + 1e-6);

// how much a source moves in a span: the mean share of changed pixels
export function level(samples, from, to) {
  const s = within(samples, from, to);
  return s.length ? s.reduce((t, x) => t + x.c, 0) / s.length : 0;
}

// the share of a span's samples in which something happens on the source (typing counts)
export function busy(samples, from, to, threshold = ACTIVE) {
  const s = within(samples, from, to);
  return s.length ? s.filter((x) => x.c >= threshold).length / s.length : 0;
}

// The spans in which the picture moves: samples over MOVING, runs less than two seconds apart
// joined (the steps of one action), a quarter of a second added around each, within from–to.
export function moving(samples, from, to) {
  const spans = [];
  for (const s of within(samples, from, to)) {
    if (s.c < MOVING) continue;
    const a = s.t - 1 / RATE - 0.25, b = s.t + 0.25, last = spans.at(-1);
    if (last && a - last.to < 2) last.to = b;
    else spans.push({ from: a, to: b });
  }
  return spans.map((s) => ({ from: Math.max(from, s.from), to: Math.min(to, s.to) })).filter((s) => s.to - s.from > 0);
}

// Where a span's changes are: { box, centre }. The box around the boxes of its active samples,
// each weighed by how much it changed, the tenth to ninetieth percentile of their edges, so that
// one stray change (a notification, the cursor crossing) does not widen it; the centre is the
// weighted mean of their middles, where most happens. null when nothing changes.
export function focus(samples, from, to) {
  const s = within(samples, from, to).filter((x) => x.b);
  if (!s.length) return null;
  const pick = (k, q) => {
    const xs = s.map((x) => ({ v: x.b[k], w: x.c })).sort((a, b) => a.v - b.v);
    const total = xs.reduce((t, x) => t + x.w, 0);
    let acc = 0;
    for (const x of xs) { acc += x.w; if (acc >= q * total) return x.v; }
    return xs.at(-1).v;
  };
  const total = s.reduce((t, x) => t + x.c, 0);
  const centre = [0, 1].map((k) => s.reduce((t, x) => t + ((x.b[k] + x.b[k + 2]) / 2) * x.c, 0) / total);
  return { box: [pick(0, 0.1), pick(1, 0.1), pick(2, 0.9), pick(3, 0.9)], centre };
}
