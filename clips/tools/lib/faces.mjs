// Where the faces of the framed clip are in the short's frame, over time: the framing's tracks
// (framed.json: every face of a shot, its middle and size in the footage's pixels, ten times a
// second) through each piece's window, the way frame.mjs's render draws it: a window that
// follows its face, a shot shown whole between FIT_TOP and FIT_BOTTOM, two panels one above the
// other, and a piece raised by its `lift`.
//
//   framedShots(framed, { outW, outH, step, height, unlifted }) → [{ shot, start, end, kind, picture, faces:
//       [{ who, speaker, track: [{ t, box: [x, y, w, h], feat?, between? }] }], room }]  (px of the frame, feat:
//       the box of eyes, nose and mouth where the framing has them, between: the two stills of the
//       framing they are an estimate between, where t is further than FEAT_EST from both;
//       seconds of the clip; picture: the part of the frame the sharp picture fills; room: how
//       far the shot's picture may be raised, { free, ground }: by moving the window down in
//       the footage, and over a ground)
//   inFrame(window, shot, t, opts) → the faces at t in px of the frame

import { faceAt, windowAt, roomBelow, FIT_TOP, FIT_BOTTOM, PANEL, SEAM } from "../frame.mjs";

const box = (f) => [f.x - f.w / 2, f.y - f.h / 2, f.w, f.h];
// the eyes, nose and mouth (the framing's feat, from the model's features_2d) as a box
const featBox = (f) => (f?.feat ? [f.feat.x0, f.feat.y0, f.feat.x1 - f.feat.x0, f.feat.y1 - f.feat.y0] : null);
// a face drawn through: its box, and its features' box the same way (kept whole: they are inside the box)
const drawn = (p, f, crop, rect, whole = false) => {
  const b = f && through(box(f), crop, rect, whole);
  if (!b) return null;
  const fb = featBox(f), ft = fb && through(fb, crop, rect, true);
  // (between: the features are an estimate between these two stills of the framing)
  return { who: p.who ?? p.speaker, speaker: p.speaker, box: b, ...(ft ? { feat: ft } : {}), ...(ft && f.feat.between ? { between: f.feat.between } : {}) };
};

// a face's box in the footage drawn through a crop (x, y, w, h of the footage) into a rectangle
// of the frame (X, Y, W, H): scaled as the crop is, cut off where the rectangle ends (null when
// nothing of it is left). A window that fills the frame keeps the whole box (whole: true): a
// close-up's forehead over the frame's top still tells where the eyes are.
function through(b, crop, rect, whole = false) {
  const k = rect[2] / crop.w;
  const x0 = rect[0] + (b[0] - crop.x) * k, y0 = rect[1] + (b[1] - crop.y) * k;
  const x1 = x0 + b[2] * k, y1 = y0 + b[3] * k;
  const cx0 = Math.max(x0, rect[0]), cy0 = Math.max(y0, rect[1]), cx1 = Math.min(x1, rect[0] + rect[2]), cy1 = Math.min(y1, rect[1] + rect[3]);
  if (cx1 - cx0 < 1 || cy1 - cy0 < 1) return null;
  if (whole) return [x0, y0, x1 - x0, y1 - y0].map((v) => +v.toFixed(1));
  return [cx0, cy0, cx1 - cx0, cy1 - cy0].map((v) => +v.toFixed(1));
}

// the rectangle of the frame a shot shown whole fills, as render() places it
export function fitRect(fit, { outW, outH }) {
  const top = Math.round(outH * FIT_TOP), room = Math.round(outH * (FIT_BOTTOM - FIT_TOP));
  const scale = Math.min(outW / fit.w, room / fit.h);
  const fw = Math.round((fit.w * scale) / 2) * 2, fh = Math.round((fit.h * scale) / 2) * 2;
  return [Math.round((outW - fw) / 2), top + Math.round((room - fh) / 2), fw, fh];
}

// the faces of one piece of the framing at t, in px of the frame
export function inFrame(w, shot, t, { outW, outH }) {
  const out = [];
  const people = shot?.people || [];
  if (w.stack) {
    const panelH = Math.round((outH * PANEL) / 2) * 2;
    w.stack.forEach((crop, i) => {
      const rect = [0, i ? panelH + SEAM : 0, outW, panelH];
      for (const p of people) {
        if (w.speakers?.[i] != null && p.speaker !== w.speakers[i]) continue;
        const d = drawn(p, faceAt(p, t), crop, rect);
        if (d) out.push(d);
      }
    });
    return out;
  }
  if (w.fit) {
    const rect = fitRect(w.fit, { outW, outH });
    for (const p of people) {
      const d = drawn(p, faceAt(p, t), w.fit, rect);
      if (d) out.push(d);
    }
    return out;
  }
  const win = windowAt(w, t), lift = w.lift?.ground || 0;
  // a window moved down in the footage by lift.free is in its keys already; lift.ground raises
  // the picture over a ground
  const rect = [0, -lift, outW, outH];
  for (const p of people) {
    const d = drawn(p, faceAt(p, t), win, rect, true);
    if (d) out.push(d);
  }
  return out;
}

// every shot of the framing with its faces in the frame, sampled every `step` seconds and at
// each piece's first and last moment
// (unlifted: as the pictures stood before any shot was raised, for a placement made anew)
export function unlift(w, outW = 1080) {
  if (!w.lift) return w;
  const dy = ((w.lift.free || 0) * w.w) / outW;
  const { lift, ...rest } = w;
  return { ...rest, keys: w.keys.map((k) => ({ ...k, y: +(k.y - dy).toFixed(1) })) };
}

export function framedShots(framed, { outW = 1080, outH = 1920, step = 0.1, height = framed.size?.[1], unlifted = false } = {}) {
  const shots = framed.shots || [];
  return shots.map((s, k) => {
    const pieces = (framed.windows || []).filter((w) => w.shot === k).map((w) => (unlifted ? unlift(w, outW) : w));
    const tracks = new Map();
    let picture = [0, 0, outW, outH], kind = s.kind, free = Infinity;
    for (const w of pieces) {
      if (w.fit) { picture = fitRect(w.fit, { outW, outH }); kind = "whole"; }
      else if (w.stack) kind = "stack";
      free = Math.min(free, height ? roomBelow(w, height, outW) : 0);
      const ts = [];
      for (let t = w.start; t < w.end - 1e-6; t += step) ts.push(t);
      ts.push(Math.max(w.start, w.end - 1e-3));
      for (const t of ts) for (const f of inFrame(w, s, t, { outW, outH })) {
        const key = `${f.speaker ?? ""}|${f.who ?? ""}`;
        if (!tracks.has(key)) tracks.set(key, { who: f.who, speaker: f.speaker, track: [] });
        tracks.get(key).track.push({ t: +t.toFixed(3), box: f.box, ...(f.feat ? { feat: f.feat } : {}), ...(f.between ? { between: f.between } : {}) });
      }
    }
    const lift = pieces.find((w) => w.lift)?.lift;
    return {
      shot: k, start: s.start, end: s.end, kind, picture,
      faces: [...tracks.values()],
      // a shot shown whole or as two panels keeps its place: its picture is not raised
      room: kind === "people" ? { free: Number.isFinite(free) ? Math.round(free) : 0 } : { free: 0, none: true },
      ...(lift ? { lift } : {}),
    };
  });
}
