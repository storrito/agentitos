// What is wrong with how a frame is laid out, against the zones of the platforms it goes to: the
// boxes come from tools/measure.js (text by its letters, Storrito's stickers, faces).
//
//   checkLayout(zones, boxes, { story })  → [{ level: "✗" | "!", label, kind, box, what }]
//
// ✗ is what a viewer would see broken: text, a sticker or a face under what an app lays over the
// video, text cut off or out of the frame, text on text, text on a face, stickers on each other.
// ! is what to fix when it costs nothing: something in the safe box's margin (a buffer for other
// phones), text centred in the safe box instead of on the frame, stickers closer than Storrito's
// 40 px, text a feed's crop cuts, a sticker on a frame that is not a Story.

import { check } from "./zones.mjs";

const area = (b) => b[2] * b[3];
const overlap = (a, b) => {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
};
// the gap between two boxes, 0 when they touch or overlap
const gap = (a, b) => Math.max(0, Math.max(a[0], b[0]) - Math.min(a[0] + a[2], b[0] + b[2]), Math.max(a[1], b[1]) - Math.min(a[1] + a[3], b[1] + b[3]));
const name = (b) => (b.kind === "text" ? `"${b.label}"` : b.label);

// Storrito's spacing between stickers (its component reference)
const STICKER_GAP = 40;
// a box this close to an edge of a zone counts as on it (rounding of fonts and transforms)
const SLACK = 2;

export function checkLayout(z, boxes, { story = false } = {}) {
  const [W] = z.size;
  const found = [];
  const add = (level, b, what) => found.push({ level, kind: b.kind, label: b.label, box: b.box, what });
  const [sx, , sw] = z.safe;
  const even = Math.abs(sx + sw / 2 - W / 2) < 1;

  for (const b of boxes) {
    if (area(b.box) <= 0) { if (b.kind === "sticker") add("✗", b, "has no size: Instagram would show it invisible or not tappable"); continue; }
    // at most the slack, and never so much that a thin box (a dash, a rule) has no size left
    const sw = Math.min(SLACK, (b.box[2] - 1) / 2), sh = Math.min(SLACK, (b.box[3] - 1) / 2);
    const shrunk = [b.box[0] + sw, b.box[1] + sh, b.box[2] - 2 * sw, b.box[3] - 2 * sh];
    const r = check(z, shrunk);
    if (r.offFrame > 0.001) add("✗", b, `${Math.round(r.offFrame * 100)} % outside the frame`);
    if (b.clipped) add("✗", b, "is cut off by its box: make the box larger or the text smaller");
    const under = r.covered.filter((c) => c.share > 0);
    if (under.length) add("✗", b, `under ${[...new Set(under.map((c) => `${c.what} (${c.platform})`))].join("; ")}`);
    else if (!r.inside && !(r.offFrame > 0.001)) add("!", b, `in the safe box's margin (${Object.entries(r.outside).map(([k, v]) => `${v} px past the ${k}`).join(", ")}): no app lays anything there, pull it in when it costs nothing`);
    for (const c of r.cut) if (b.kind !== "sticker") add("!", b, `${Math.round(c.share * 100)} % cut where ${c.where} shows ${c.ratio}`);
    if (b.kind === "sticker" && !story) add("!", b, "stickers exist only on Stories: on this frame Instagram shows no sticker");
    // centred in the uneven safe box, not on the frame
    if (b.kind === "text" && b.centred && !even) {
      const mid = b.box[0] + b.box[2] / 2;
      if (Math.abs(mid - (sx + sw / 2)) <= 6 && Math.abs(mid - W / 2) > 12) add("!", b, `centred in the safe box, ${Math.round(W / 2 - mid)} px left of the frame's middle: centre it on the frame, at most ${z.centred[2]} px wide`);
    }
  }

  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const o = overlap(a.box, b.box), small = Math.min(area(a.box), area(b.box));
    const kinds = [a.kind, b.kind].sort().join("+");
    if (kinds === "face+face") continue;
    if (kinds === "sticker+sticker") {
      if (o > 0) add("✗", a, `overlaps ${name(b)}: both are hard to tap`);
      else if (gap(a.box, b.box) < STICKER_GAP) add("!", a, `${gap(a.box, b.box)} px from ${name(b)}: keep ${STICKER_GAP} px between stickers`);
      continue;
    }
    if (!o || o < 0.02 * small) continue;
    if (kinds === "text+text") add("✗", a, `overlaps ${name(b)}`);
    else if (kinds === "face+text") add("✗", a.kind === "text" ? a : b, `lies on ${name(a.kind === "face" ? a : b)}`);
    else if (kinds === "sticker+text") add("✗", a.kind === "sticker" ? a : b, `covers ${name(a.kind === "text" ? a : b)}`);
    else if (kinds === "face+sticker") add("!", a.kind === "sticker" ? a : b, `covers ${name(a.kind === "face" ? a : b)}`);
  }
  return found;
}
