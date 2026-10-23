// Where things sit in the frame, for each view, and how far a shot zooms in.
//
// The views: "screen" and "phone" show that source in a box, the webcam small in a circle beside
// it; "face" shows the webcam over the whole frame. The boxes come from what the platforms the
// video goes to lay over it (agentitos' platform-zones, tools/lib/zones.mjs): everything that must
// be seen (the shot, the circle, a label, the captions) sits inside the zones' safe box, the
// captions' band at its bottom (where the captions skill puts their lowest line) stays free, and
// the shot is as large as the rest allows, edge to edge where the frame is narrower than it. The
// space the apps cover (their bar at the top, their caption and buttons at the bottom) is left to
// them.
//
// A zoom is a crop of the source: the region whose changes the shot is about (activity.focus),
// padded, never smaller than MIN_CROP of the source's width, in the box's shape. The crop
// decides the box's shape too: a box is the area's largest rectangle of the crop's aspect.

import { hottest } from "./activity.mjs";

export const FRAMES = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080], "4:5": [1080, 1350] };

const MIN_CROP = 0.38; // of the source's width: at most about 2.6 times as large
const PAD = 0.1; // around the region, of its size

// The areas of a frame, in pixels: content (where a screen may go: one area or several to choose
// the largest shot from), tall (a phone's screen), the webcam's circle (pip: x, y, diameter), the
// label's corner. zones: platform-zones' answer for this frame and the platforms the video goes
// to; captions, labels: whether the cut has them (their room is kept only then).
export function areas(width, height, zones, { captions = true, labels = false } = {}) {
  const [sx, sy, sw, sh] = zones.safe;
  const short = Math.min(width, height), gap = Math.round(short * 0.022);
  // the captions' band: their lowest line at the safe box's bottom, room for two lines above it
  // (a wide frame's captions are smaller and mostly one line)
  const capTop = captions ? sy + sh - Math.round(short * (height > width * 0.9 ? 0.2 : 0.12)) : sy + sh;
  const label = [sx, sy];
  const top = sy + (labels ? Math.round(short * 0.065) + gap : 0);
  if (height >= width * 1.5) {
    // 9:16: the circle above the captions on the left, a phone's screen beside it. A screen goes
    // across the whole width where no app has buttons on the right (a Story), else either across
    // the whole width above the buttons' column (the zones' wide stretch) or inside the safe box,
    // whichever shows it larger
    const d = Math.round(width * 0.22);
    const pip = [sx, capTop - gap - d, d];
    const bottom = pip[1] - gap;
    const column = zones.margins.right > zones.margins.left + 40;
    const content = !column ? [[0, top, width, bottom - top]]
      : [[sx, top, sw, bottom - top], ...(zones.wide && Math.min(bottom, zones.wide[1] + zones.wide[3]) > top
        ? [[0, top, width, Math.min(bottom, zones.wide[1] + zones.wide[3]) - top]] : [])];
    return { content, tall: [sx + d + gap, top, sw - d - gap, capTop - gap - top], pip, label };
  }
  if (height > width * 0.9) {
    // 4:5 and 1:1: the circle in the safe box's top right corner, beside the label, the shot
    // across the whole width below them, above the captions (a feed lays nothing at the sides)
    const d = Math.round(short * 0.16);
    const pip = [sx + sw - d, sy, d];
    const below = sy + Math.max(top - sy, d + gap);
    return { content: [[0, below, width, capTop - gap - below]], tall: [sx, below, sw, capTop - gap - below], pip, label };
  }
  // wide: the shot across the width between the apps' bar at the top and the captions (the safe
  // box's bottom without them), the circle in the safe box's top right corner and the label in
  // its top left one, over the shot's corners where they meet
  const d = Math.round(short * 0.2);
  const pip = [sx + sw - d, sy, d];
  return { content: [[0, sy, width, (captions ? capTop - gap : sy + sh) - sy]], tall: [sx, top, sw - d - gap, capTop - gap - top], pip, label };
}

// the largest box of `aspect` (width / height) inside `area`, centred; of several areas, the one
// that holds the largest
export function fit(area, aspect) {
  if (Array.isArray(area[0])) return area.map((a) => fit(a, aspect)).reduce((b, c) => (c[2] * c[3] > b[2] * b[3] ? c : b));
  const [x, y, w, h] = area;
  const bw = Math.min(w, h * aspect), bh = bw / aspect;
  return [x + (w - bw) / 2, y + (h - bh) / 2, bw, bh];
}

// of several areas, the largest: its shape is the shape of a crop chosen for them
export const largest = (area) => (Array.isArray(area[0]) ? area.reduce((b, c) => (c[2] * c[3] > b[2] * b[3] ? c : b)) : area);

// The crop of a source (in 0–1 of its frame) for a region of interest `focus` ({ box, centre }
// from activity.focus), in the shape of `area`: the region padded, at least MIN_CROP wide, as
// wide as the area's shape needs, centred on where the changes are, moved inside the frame. A
// region that takes most of the frame: the whole frame, unless the frame is narrower than the
// source (a screen in a 9:16 video), where the whole would be too small to read: then at most
// `maxWidth` of the source's width.
export function crop(focus, source, area, { maxWidth = 1 } = {}) {
  area = largest(area);
  const full = [0, 0, 1, 1];
  if (!focus) return full;
  const [x0, y0, x1, y1] = focus.box;
  const sw = source.width, sh = source.height;
  // in pixels of the source
  let w = (x1 - x0) * sw, h = (y1 - y0) * sh;
  w *= 1 + 2 * PAD; h *= 1 + 2 * PAD;
  const aspect = area[2] / area[3];
  if (w / h < aspect) w = h * aspect; else h = w / aspect;
  if (w < MIN_CROP * sw) { h *= (MIN_CROP * sw) / w; w = MIN_CROP * sw; }
  if (w > maxWidth * sw) { w = maxWidth * sw; h = w / aspect; }
  if (w > sw) { w = sw; h = w / aspect; }
  if (h > sh) { h = sh; w = h * aspect; }
  // a crop of most of the frame is no zoom
  if (maxWidth >= 1 && (w * h) / (sw * sh) >= 0.55) return full;
  // the region whole when it fits, centred on it; else where the crop holds the most of what
  // changed; without a heat map, around its centre
  let left, top;
  const bw = (x1 - x0) * sw, bh = (y1 - y0) * sh;
  const best = (bw > w || bh > h) && focus.heat && hottest(focus.heat, w / sw, h / sh, focus.centre);
  if (bw <= w && bh <= h) {
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    left = clamp(((x0 + x1) / 2) * sw - w / 2, Math.max(0, x1 * sw - w), Math.min(x0 * sw, sw - w));
    top = clamp(((y0 + y1) / 2) * sh - h / 2, Math.max(0, y1 * sh - h), Math.min(y0 * sh, sh - h));
  } else if (best) { left = best.x * sw; top = best.y * sh; }
  else {
    const cx = focus.centre[0] * sw, cy = focus.centre[1] * sh;
    left = Math.min(Math.max(0, cx - w / 2), sw - w); top = Math.min(Math.max(0, cy - h / 2), sh - h);
  }
  return [left / sw, top / sh, (left + w) / sw, (top + h) / sh].map((v) => +v.toFixed(4));
}

// How a source's video element sits so that its crop fills `box`: its left, top, width and
// height in the frame, and the inset that clips it to the box (CSS clip-path, in the element's
// own pixels).
export function place(box, c, source) {
  const [bx, by, bw, bh] = box;
  const scale = bw / ((c[2] - c[0]) * source.width);
  const w = source.width * scale, h = source.height * scale;
  const left = bx - c[0] * w, top = by - c[1] * h;
  const r = (v) => +v.toFixed(1);
  return { left: r(left), top: r(top), width: r(w), height: r(h),
    inset: [by - top, left + w - (bx + bw), top + h - (by + bh), bx - left].map((v) => r(Math.max(0, v))) };
}

// the webcam over the whole frame: its crop in the frame's shape, centred, a little high
// (a face sits in the upper half of a webcam's picture)
export function cover(source, width, height) {
  const aspect = width / height, sa = source.width / source.height;
  if (sa > aspect) {
    const w = aspect / sa;
    return [(1 - w) / 2, 0, (1 + w) / 2, 1].map((v) => +v.toFixed(4));
  }
  const h = sa / aspect;
  const top = Math.max(0, Math.min(1 - h, 0.42 - h / 2));
  return [0, top, 1, top + h].map((v) => +v.toFixed(4));
}

// the webcam in a circle of diameter d at (x, y): a square crop of its middle
export function circle(source) {
  const s = Math.min(source.width, source.height);
  const w = s / source.width, h = s / source.height;
  return [(1 - w) / 2, Math.max(0, 0.45 - h / 2), (1 + w) / 2, Math.max(0, 0.45 - h / 2) + h].map((v) => +v.toFixed(4));
}
