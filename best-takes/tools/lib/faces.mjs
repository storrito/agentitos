// Faces in the cut, where a skill that framed the videos knows them (clips' place writes
// source/faces.json: for each video, every face's box in px of its frame, every tenth of a
// second). Two uses: a punch-in grows the picture away from the captions instead of pushing a chin
// into them, and the check names text that lies on a face.
//
//   readFaces(dir) → { "01.mp4": { size, faces: [{ t, boxes: [{ who, box }] }] } } or null
//   facesAt(list, t) → the boxes nearest t (within 0.15 s)
//   punchPlan({ faces, scale, frame, cap, safeTop, raise }) → { scale, origin, why? }: how a punch-in grows, or that it may not
//   punchOrigin(…) → its origin alone
//   textOnFaces({ pieces, clips, faces, texts, frame, step }) → [{ role, who, from, to, seconds, share, nose, mouth, lip, chin, hair }]
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

// A face's lines, as agentitos' layout takes them (copied: a skill never imports another's code):
// from its eyes, nose and mouth (feat, a box from the eyes' top to the mouth's bottom) the nose
// line 70 % down it (text above it lies on the nose or the eyes), the lip line 88 % down (the middle
// of the mouth: text above it covers both lips) and the mouth line its bottom and OPEN of its height
// more (an open mouth's lower lip drops below the box of a still: text below the line lies on the
// chin). Without feat, from the box by the head's proportions (IMPLIED: 38 % to 86 % of its height).
export const NOSE_IN_FEAT = 0.7, LIP_IN_FEAT = 0.88, OPEN = 0.15, IMPLIED = [0.38, 0.86];
export const EYES = 0.42, ABOVE = 0.35, MOUTH = +(IMPLIED[0] + (1 + OPEN) * (IMPLIED[1] - IMPLIED[0])).toFixed(3);
const featOf = (b, feat) => feat || [b[0] + 0.18 * b[2], b[1] + IMPLIED[0] * b[3], 0.64 * b[2], (IMPLIED[1] - IMPLIED[0]) * b[3]];
const lineOf = (b, feat, k) => { const e = featOf(b, feat); return e[1] + k * e[3]; };
export const noseOf = (b, feat) => lineOf(b, feat, NOSE_IN_FEAT);
export const lipOf = (b, feat) => lineOf(b, feat, LIP_IN_FEAT);
export const mouthOf = (b, feat) => lineOf(b, feat, 1 + OPEN);

// A punch-in of `scale` (a CSS scale about a point on the frame's middle line, at height `origin`)
// moves every line of a face: y → origin + (y − origin) · scale. What it may do to a face whose box
// lies over the captions (`cap`, their area) and above their middle (one below them, captions over
// a head, is not pushed into them by growing upwards):
//   hard: its nose line, lip line and mouth line never go lower over the captions than they stood:
//         a line above the captions' top stays above it, one below it goes no further down. The
//         placement was made for the picture without the punch-in; the punch-in may not undo it.
//   eyes: its eyes (feat's top, else EYES of the box) stay below `safeTop`, under the apps' top bar;
//   moderate: a head inside the frame (its box's top and ABOVE of its height for the hair, layout's
//         margin) stays inside it, as far as the hard lines allow;
//   wish: its chin and the margin below it (layout's, BELOW of its height, BELOW_MIN at least)
//         clear the captions' top where they did; the origin as close to a third from the top as that allows.
// The origin lies in the frame (0 to its height): grown from below its bottom the picture would
// leave a band empty. punchPlan → { scale, origin } at the scale asked, at a smaller one (halfway)
// where the hard lines and the eyes leave no origin at it, or none (scale 1: the piece stays as it
// is) where they leave none at that either; `why` then says what kept it.
export function punchPlan({ faces, scale, frame: [W, H], cap, safeTop = 0, raise = "full" }) {
  const low = ORIGIN_Y * H;
  if (!cap || !(scale > 1)) return { scale, origin: low };
  const top = cap[1];
  let why = "";
  for (const s of [scale, 1 + (scale - 1) / 2]) {
    const from = (v, at) => (s * v - at) / (s - 1);
    // origin ≥ lower: the hard lines; origin ≤ upper: the eyes, the frame's bottom
    let lower = 0, upper = H, wish = low, headIn = H;
    for (const face of faces) {
      const b = Array.isArray(face) ? face : face.box, feat = Array.isArray(face) ? null : face.feat;
      if (b[0] + b[2] <= cap[0] || b[0] >= cap[0] + cap[2]) continue;
      if (b[1] + b[3] / 2 > top + cap[3] / 2) continue;
      // above the top: stays above it; below it: goes no lower (grown from the line or below it)
      for (const line of [noseOf(b, feat), lipOf(b, feat), mouthOf(b, feat)]) lower = Math.max(lower, line <= top ? from(line, top) : line);
      upper = Math.min(upper, from(feat ? feat[1] : b[1] + EYES * b[3], safeTop));
      // (a head the frame cuts already is not cut further to free a chin: the origin then stays at a third from the top, the hard lines aside)
      if (raise === "moderate") { const head = b[1] - ABOVE * b[3]; headIn = Math.min(headIn, head >= 0 ? from(head, 0) : low); }
      const chin = b[1] + b[3] + Math.max(BELOW_MIN, BELOW * b[3]);
      wish = Math.max(wish, from(chin, top));
    }
    if (lower > upper + 1e-6) { why ||= "the mouth or the nose would go into the captions, or the eyes under the apps' top bar"; continue; }
    const origin = Math.min(upper, Math.max(lower, low, Math.min(wish, headIn)));
    return { scale: s, origin, ...(s < scale ? { why: `smaller, ${s}× instead of ${scale}×: ${why}` } : {}) };
  }
  return { scale: 1, origin: low, why: `none: ${why}` };
}
// the origin alone, at the scale the plan takes
export function punchOrigin(o) { return punchPlan(o).origin; }

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
    const at = (b) => scaled(toFrame(b, list.size, frame), p.scale || 1, [frame[0] / 2, p.origin ?? ORIGIN_Y * frame[1]]);
    const boxes = facesAt(list, tf).map((f) => ({ who: f.who, box: at(f.box), ...(f.feat ? { feat: at(f.feat) } : {}) }));
    for (const x of texts) {
      if (t < x.from || t >= x.to) continue;
      for (const f of boxes) {
        if (!(overlap(x.box, f.box) > 1)) continue;
        const share = Math.min(1, Math.max(0, (f.box[1] + f.box[3] - Math.max(x.box[1], f.box[1])) / f.box[3]));
        // the highest part the text reaches: the nose or the eyes (above the nose line), the mouth
        // (above the lip line: both lips), the lower lip (above the mouth line), else the chin
        const reaches = (line) => x.box[1] < line && overlap(x.box, [f.box[0], f.box[1], f.box[2], line - f.box[1]]) > 1;
        const part = reaches(noseOf(f.box, f.feat)) ? "nose" : reaches(lipOf(f.box, f.feat)) ? "mouth" : reaches(mouthOf(f.box, f.feat)) ? "lip" : "chin";
        // above a head (the text's middle above the face's middle, its bottom above the eyes): the hair
        const hair = x.box[1] + x.box[3] / 2 < f.box[1] + f.box[3] / 2 && x.box[1] + x.box[3] <= (f.feat ? f.feat[1] : f.box[1] + EYES * f.box[3]);
        const key = `${x.role}|${f.who}`;
        const g = found.get(key) || { role: x.role, who: f.who, from: t, to: t, seconds: 0, share: 0, nose: 0, mouth: 0, lip: 0, hair: 0 };
        g.to = t + step; g.seconds += step; g.share = Math.max(g.share, share);
        if (hair) g.hair += step; else if (part !== "chin") g[part] += step;
        found.set(key, g);
      }
    }
  }
  const r1 = (v) => +v.toFixed(1);
  return [...found.values()].map((g) => ({ ...g, from: r1(g.from), to: r1(g.to), seconds: r1(g.seconds), nose: r1(g.nose), mouth: r1(g.mouth), lip: r1(g.lip), hair: r1(g.hair), chin: r1(Math.max(0, g.seconds - g.nose - g.mouth - g.lip - g.hair)), share: Math.round(g.share * 100) / 100 }));
}
