// Where the faces of the framed clip are in the short's frame, over time: the framing's tracks
// (framed.json: every face of a shot, its middle and size in the footage's pixels, ten times a
// second) through each piece's window, the way frame.mjs's render draws it: a window that
// follows its face, a shot shown whole between FIT_TOP and FIT_BOTTOM, two panels one above the
// other, and a piece raised by its `lift`.
//
//   framedShots(framed, { outW, outH, step, height, unlifted }) → [{ shot, start, end, kind, picture, faces:
//       [{ who, speaker, track: [{ t, box: [x, y, w, h] }] }], room }]  (px of the frame,
//       seconds of the clip; picture: the part of the frame the sharp picture fills; room: how
//       far the shot's picture may be raised, { free, ground }: by moving the window down in
//       the footage, and over a ground)
//   inFrame(window, shot, t, opts) → the faces at t in px of the frame

import { faceAt, windowAt, roomBelow, FIT_TOP, FIT_BOTTOM, PANEL, SEAM } from "../frame.mjs";

const box = (f) => [f.x - f.w / 2, f.y - f.h / 2, f.w, f.h];

// a face's box in the footage drawn through a crop (x, y, w, h of the footage) into a rectangle
// of the frame (X, Y, W, H): scaled as the crop is, cut off where the rectangle ends (null when
// nothing of it is left)
function through(b, crop, rect) {
  const k = rect[2] / crop.w;
  const x0 = rect[0] + (b[0] - crop.x) * k, y0 = rect[1] + (b[1] - crop.y) * k;
  const x1 = x0 + b[2] * k, y1 = y0 + b[3] * k;
  const cx0 = Math.max(x0, rect[0]), cy0 = Math.max(y0, rect[1]), cx1 = Math.min(x1, rect[0] + rect[2]), cy1 = Math.min(y1, rect[1] + rect[3]);
  if (cx1 - cx0 < 1 || cy1 - cy0 < 1) return null;
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
        const f = faceAt(p, t);
        const b = f && through(box(f), crop, rect);
        if (b) out.push({ who: p.who ?? p.speaker, speaker: p.speaker, box: b });
      }
    });
    return out;
  }
  if (w.fit) {
    const rect = fitRect(w.fit, { outW, outH });
    for (const p of people) {
      const f = faceAt(p, t);
      const b = f && through(box(f), w.fit, rect);
      if (b) out.push({ who: p.who ?? p.speaker, speaker: p.speaker, box: b });
    }
    return out;
  }
  const win = windowAt(w, t), lift = w.lift?.ground || 0;
  // a window moved down in the footage by lift.free is in its keys already; lift.ground raises
  // the picture over a ground
  const rect = [0, -lift, outW, outH];
  for (const p of people) {
    const f = faceAt(p, t);
    const b = f && through(box(f), win, rect);
    if (b) out.push({ who: p.who ?? p.speaker, speaker: p.speaker, box: b });
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
        tracks.get(key).track.push({ t: +t.toFixed(3), box: f.box });
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
