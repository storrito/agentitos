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
  // where a screen's shot may lie around what matters: the whole frame above the captions (the
  // apps' buttons and bars over it are fine there, what matters stays in content)
  const bleed = [0, 0, width, capTop - gap];
  if (height >= width * 1.5) {
    // 9:16: the circle above the captions on the left, a phone's screen beside it. A screen goes
    // across the whole width where no app has buttons on the right (a Story), else either across
    // the whole width above the buttons' column (the zones' wide stretch) or inside the safe box,
    // whichever shows it larger; without the circle (solo) down to the captions
    const d = Math.round(width * 0.22);
    const pip = [sx, capTop - gap - d, d];
    const column = zones.margins.right > zones.margins.left + 40;
    const contentTo = (bottom) => (!column ? [[0, top, width, bottom - top]]
      : [[sx, top, sw, bottom - top], ...(zones.wide && Math.min(bottom, zones.wide[1] + zones.wide[3]) > top
        ? [[0, top, width, Math.min(bottom, zones.wide[1] + zones.wide[3]) - top]] : [])]);
    const tall = [sx + d + gap, top, sw - d - gap, capTop - gap - top];
    // a shot with room around it may also take the safe box beside the circle, down to the captions
    return { content: contentTo(pip[1] - gap), beside: [tall], solo: contentTo(capTop - gap), bleed, tall, pip, label };
  }
  if (height > width * 0.9) {
    // 4:5 and 1:1: the circle in the safe box's top right corner, beside the label, the shot
    // across the whole width below them, above the captions (a feed lays nothing at the sides)
    const d = Math.round(short * 0.16);
    const pip = [sx + sw - d, sy, d];
    const below = sy + Math.max(top - sy, d + gap);
    const content = [[0, below, width, capTop - gap - below]];
    return { content, solo: [[0, top, width, capTop - gap - top]], bleed, tall: [sx, below, sw, capTop - gap - below], pip, label };
  }
  // wide: the shot across the width between the apps' bar at the top and the captions (the safe
  // box's bottom without them), the circle in the safe box's top right corner and the label in
  // its top left one, over the shot's corners where they meet
  const d = Math.round(short * 0.2);
  const pip = [sx + sw - d, sy, d];
  const content = [[0, sy, width, (captions ? capTop - gap : sy + sh) - sy]];
  return { content, solo: content, bleed, tall: [sx, top, sw - d - gap, capTop - gap - top], pip, label };
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

// A screen's shot when the frame has room around what matters: `c` (0–1 of the source) is what
// must be seen; it is scaled to the largest it fits into `area` (the safe room, as for fit()),
// at most to `maxScale` source pixels per frame pixel, and the rest of the source shows around it
// as far as `bleed` (the frame where the screen may lie, under the apps' buttons too, not under
// the captions), moved so that it fills `bleed` where it can without pushing `c` out of `area`.
// Returns the element's geometry as place() does.
export function spread(area, bleed, c, source, { maxScale = Infinity } = {}) {
  const zw = (c[2] - c[0]) * source.width, zh = (c[3] - c[1]) * source.height;
  // the room that holds the box largest
  const rooms = Array.isArray(area[0]) ? area : [area];
  const room0 = rooms.reduce((b, a) => (fit(a, zw / zh)[2] > fit(b, zw / zh)[2] ? a : b));
  const scale = Math.min(fit(room0, zw / zh)[2] / zw, maxScale);
  const w = source.width * scale, h = source.height * scale;
  // where the box goes: centred in its room; then the source moved to fill the bleed, as far as
  // the box stays in the room
  const [bx, by, bw, bh] = bleed;
  const axis = (size, rLo, rSize, bLo, bSize, full, c0) => {
    const centred = rLo + (rSize - size) / 2 - c0 * full;
    const lo = rLo - c0 * full, hi = rLo + rSize - size - c0 * full; // the box inside its room
    const fLo = bLo + bSize - full, fHi = bLo; // the source covering the bleed
    const a = Math.max(lo, fLo), b = Math.min(hi, fHi);
    if (a <= b) return Math.min(Math.max(centred, a), b);
    // the source cannot cover the bleed on this axis: centred on the box, kept in the room
    return Math.min(Math.max(centred, lo), hi);
  };
  const left = axis(zw * scale, room0[0], room0[2], bx, bw, w, c[0]);
  const top = axis(zh * scale, room0[1], room0[3], by, bh, h, c[1]);
  // what shows: the source inside the bleed
  const x0 = Math.max(left, bx), y0 = Math.max(top, by), x1 = Math.min(left + w, bx + bw), y1 = Math.min(top + h, by + bh);
  const r = (v) => +v.toFixed(1);
  return { left: r(left), top: r(top), width: r(w), height: r(h), box: [x0, y0, x1 - x0, y1 - y0],
    inset: [y0 - top, left + w - x1, top + h - y1, x0 - left].map((v) => r(Math.max(0, v))) };
}

// a face box (0–1 of the webcam's picture, from sources.json) or the webcam's middle, a little high
const faceOf = (source) => source.face || [0.35, 0.2, 0.65, 0.65];

// the crop of `aspect` (width / height, in the source's pixels) of the largest size `most` (0–1
// of the source's side it is limited by) around the face: the face's middle across, its eyes a
// little above the middle
function around(source, aspect, most = 1) {
  const sa = source.width / source.height;
  let w = Math.min(1, aspect / sa) * most, h = (w * sa) / aspect;
  if (h > 1) { h = 1; w = aspect / sa; }
  const [fx0, fy0, fx1, fy1] = faceOf(source);
  const cx = (fx0 + fx1) / 2, cy = fy0 + (fy1 - fy0) * 0.45;
  const left = Math.min(Math.max(0, cx - w / 2), 1 - w), top = Math.min(Math.max(0, cy - h * 0.42), 1 - h);
  return [left, top, left + w, top + h].map((v) => +v.toFixed(4));
}

// the webcam over the whole frame: its crop in the frame's shape around the face. A face low in
// the picture (a camera set high) would sit on the captions' band: then the crop is closer, up to
// 1.6 times, until the face's middle is at most 45 % down the frame
export function cover(source, width, height) {
  const [, fy0, , fy1] = faceOf(source);
  const cy = fy0 + (fy1 - fy0) * 0.45;
  return around(source, width / height, Math.min(1, Math.max(1 / 1.6, (1 - cy) / 0.55)));
}

// the webcam in a circle: a square around the face, the head and shoulders (about three faces
// high), closer when the face sits low (its middle at most half way down), never more than the
// picture's shorter side
export function circle(source) {
  const [, fy0, , fy1] = faceOf(source);
  const cy = fy0 + (fy1 - fy0) * 0.45;
  const most = source.face ? Math.min(1, Math.max(0.45, Math.min((fy1 - fy0) * 3, (1 - cy) / 0.5))) : 1;
  return around(source, 1, most);
}
