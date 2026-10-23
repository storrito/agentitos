// Where things sit in the frame, for each view, and how far a shot zooms in.
//
// The views: "screen" and "phone" show that source in a box above the captions' band, the
// webcam small in a circle below it; "face" shows the webcam over the whole frame. The boxes
// leave the band free in which the captions skill sets the captions (a 9:16 frame: the
// captions' lower edge at 70 % of the height), and keep clear of the platforms' buttons along
// the bottom and the right edge, so that the captions never cover what the shot shows.
//
// A zoom is a crop of the source: the region whose changes the shot is about (activity.focus),
// padded, never smaller than MIN_CROP of the source's width, in the box's shape. The crop
// decides the box's shape too: a box is the area's largest rectangle of the crop's aspect.

import { hottest } from "./activity.mjs";

export const FRAMES = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080], "4:5": [1080, 1350] };

const MIN_CROP = 0.38; // of the source's width: at most about 2.6 times as large
const PAD = 0.1; // around the region, of its size

// the areas of a frame, in pixels: content (screen, phone), the webcam's circle, a label
export function areas(width, height) {
  const r = height / width;
  if (r >= 1.5) { // 9:16
    return { content: [0.037 * width, 0.115 * height, 0.926 * width, 0.465 * height], tall: [0.2 * width, 0.095 * height, 0.6 * width, 0.49 * height],
      pip: [0.06 * width, 0.725 * height, 0.27 * width], label: [0.06 * width, 0.045 * height] };
  }
  // 4:5 and 1:1: the captions sit 14 % above the bottom and take about a quarter of the height
  // above it, so the circle goes to the top right, beside the label, and the content stops
  // above them
  if (r >= 1.1) { // 4:5
    return { content: [0.04 * width, 0.155 * height, 0.92 * width, 0.5 * height], tall: [0.25 * width, 0.105 * height, 0.5 * width, 0.545 * height],
      pip: [0.82 * width, 0.02 * height, 0.15 * width], label: [0.05 * width, 0.035 * height] };
  }
  if (r >= 0.9) { // 1:1
    return { content: [0.04 * width, 0.175 * height, 0.92 * width, 0.415 * height], tall: [0.25 * width, 0.115 * height, 0.5 * width, 0.475 * height],
      pip: [0.84 * width, 0.02 * height, 0.14 * width], label: [0.05 * width, 0.03 * height] };
  }
  // 16:9: the content above the captions, the circle at the top right, beside it
  return { content: [0.13 * width, 0.09 * height, 0.74 * width, 0.72 * height], tall: [0.3 * width, 0.03 * height, 0.4 * width, 0.78 * height],
    pip: [0.875 * width, 0.09 * height, 0.11 * width], label: [0.025 * width, 0.04 * height] };
}

// the largest box of `aspect` (width / height) inside `area`, centred
export function fit(area, aspect) {
  const [x, y, w, h] = area;
  const bw = Math.min(w, h * aspect), bh = bw / aspect;
  return [x + (w - bw) / 2, y + (h - bh) / 2, bw, bh];
}

// The crop of a source (in 0–1 of its frame) for a region of interest `focus` ({ box, centre }
// from activity.focus), in the shape of `area`: the region padded, at least MIN_CROP wide, as
// wide as the area's shape needs, centred on where the changes are, moved inside the frame. A
// region that takes most of the frame: the whole frame, unless the frame is narrower than the
// source (a screen in a 9:16 video), where the whole would be too small to read: then at most
// `maxWidth` of the source's width.
export function crop(focus, source, area, { maxWidth = 1 } = {}) {
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
