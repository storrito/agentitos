// Faces in the cut, where a skill that framed the videos knows them (clips' place writes
// source/faces.json: for each video, every face's box in px of its frame, every tenth of a
// second). Two uses: a punch-in grows the picture away from the captions instead of pushing a chin
// into them, and the check names text that lies on a face.
//
//   readFaces(dir) → { "01.mp4": { size, faces: [{ t, boxes: [{ who, box }] }] } } or null
//   facesAt(list, t) → the boxes nearest t (within 0.15 s)
//   punchOrigin({ faces, from, to, scale, frame, top }) → the y of the punch-in's origin
//   textOnFaces({ pieces, clips, faces, texts, frame, step }) → [{ role, who, from, to, seconds, share }]
//
// A box is [x, y, w, h]. What is kept clear below a chin is layout's own margin (its
// DEFAULTS.free: a twelfth of the face's height, at least 24 px), copied here.

import fs from "node:fs";
import path from "node:path";

export const BELOW = 0.08, BELOW_MIN = 24;
// where a punch-in grows from when nothing says otherwise: the middle of the frame across, a third
// from the top (where clips frames a face)
export const ORIGIN_Y = 0.32;

export function readFaces(dir) {
  const f = path.join(dir, "source", "faces.json");
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
}

export function facesAt(list, t) {
  if (!list?.faces?.length) return [];
  const fs_ = list.faces;
  let lo = 0, hi = fs_.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (fs_[m].t < t) lo = m + 1; else hi = m; }
  let best = fs_[lo];
  if (lo > 0 && Math.abs(fs_[lo - 1].t - t) < Math.abs(best.t - t)) best = fs_[lo - 1];
  return best && Math.abs(best.t - t) <= 0.15 ? best.boxes : [];
}

// a box of the video's frame in the cut's frame, as object-fit cover shows the video
export function toFrame(b, size, [W, H]) {
  const k = Math.max(W / size[0], H / size[1]), dx = (W - size[0] * k) / 2, dy = (H - size[1] * k) / 2;
  return [dx + b[0] * k, dy + b[1] * k, b[2] * k, b[3] * k];
}

const scaled = (b, s, [ox, oy]) => [ox + (b[0] - ox) * s, oy + (b[1] - oy) * s, b[2] * s, b[3] * s];
const overlap = (a, b) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));

// The origin a punch-in of `scale` grows from, so that no face whose chin (and the margin below it)
// clears the captions' top before it reaches into them after: the lowest such origin at or below
// a third from the top; a face that lies on them already grows upwards from below its chin. At
// most the frame's bottom. `faces`: the boxes in px of the cut's frame over the piece; `cap`: the
// captions' area.
// It never grows from so low that a face's eyes (EYES of its box from the top) go above `safeTop`,
// under the apps' top bar: there a chin on the captions is the lesser harm.
export const EYES = 0.42;
export function punchOrigin({ faces, scale, frame: [W, H], cap, safeTop = 0 }) {
  const low = ORIGIN_Y * H;
  if (!cap || !(scale > 1)) return low;
  const top = cap[1];
  let y = low, most = H;
  for (const b of faces) {
    if (b[0] + b[2] <= cap[0] || b[0] >= cap[0] + cap[2]) continue;
    // only a face above the captions' middle: one below them (captions above a head) is not pushed into them by growing upwards
    if (b[1] + b[3] / 2 > top + cap[3] / 2) continue;
    const chin = b[1] + b[3] + Math.max(BELOW_MIN, BELOW * b[3]);
    y = Math.max(y, (scale * chin - top) / (scale - 1));
    most = Math.min(most, (scale * (b[1] + EYES * b[3]) - safeTop) / (scale - 1));
  }
  return Math.max(low, Math.min(H, y, most));
}

// the seconds in which a text lies on a face: texts [{ role, box, from, to }] on the cut's clock;
// pieces as edit.json has them, with their scale and origin; a face's share is how deep into it
// from its chin the text reaches, of its height
export function textOnFaces({ pieces, clips, faces, texts, frame, step = 0.1 }) {
  const found = new Map();
  const end = pieces.reduce((n, p) => Math.max(n, p.start + p.duration), 0);
  for (let t = 0; t < end; t += step) {
    const p = pieces.find((q) => t >= q.start && t < q.start + q.duration);
    if (!p) continue;
    const file = clips[p.clip]?.file, list = faces?.[file];
    if (!list) continue;
    const tf = p.in + (t - p.start) * (p.rate || 1);
    const boxes = facesAt(list, tf).map((f) => ({ who: f.who, box: scaled(toFrame(f.box, list.size, frame), p.scale || 1, [frame[0] / 2, p.origin ?? ORIGIN_Y * frame[1]]) }));
    for (const x of texts) {
      if (t < x.from || t >= x.to) continue;
      for (const f of boxes) {
        if (!(overlap(x.box, f.box) > 1)) continue;
        const share = Math.min(1, Math.max(0, (f.box[1] + f.box[3] - Math.max(x.box[1], f.box[1])) / f.box[3]));
        const key = `${x.role}|${f.who}`;
        const g = found.get(key) || { role: x.role, who: f.who, from: t, to: t, seconds: 0, share: 0 };
        g.to = t + step; g.seconds += step; g.share = Math.max(g.share, share);
        found.set(key, g);
      }
    }
  }
  return [...found.values()].map((g) => ({ ...g, from: +g.from.toFixed(1), to: +g.to.toFixed(1), seconds: +g.seconds.toFixed(1), share: Math.round(g.share * 100) / 100 }));
}
