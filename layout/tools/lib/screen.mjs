// A screen recording with the region that matters (and, with a webcam, its face as a circle).
// The screen lies between the text's bands (the hook at the top, the captions ending on the safe
// box's bottom: a screen's own text would show through them) and runs to the frame's edges where
// it is large enough; the region lies inside the safe box (or the wide stretch above the buttons).
//   screen-zoom   the smallest scale at which the screen's smallest text reads
//   screen-fit    the region as large as its room allows, where that is smaller (the text then
//                 does not read) or where no text height is given
//   screen-whole  the whole screen
// The circle stands in a corner of the safe box between the bands: bottom left first in an upright
// frame, top right first in the others (where screencast-cut puts it). The region keeps the text's
// gap to it: it takes the room above, below or beside the circle. Of the corners, the first at
// which the screen still fills the frame around the region; where the region fits beside no
// corner's circle, the circle is made smaller (down to circle.min).
//
//   screenFits(ctx, webcam, notes) → [candidate]   webcam: { size, face } | null
//
// screen-stacked: the screen across the upper part of an upright frame, the webcam's picture as a
// panel under it, the captions on the seam, a hook as a card above the screen. What published
// Shorts do where a screen and a face show together: the face below the screen in 35 of 53
// frames, about 18 % of the frame's height tall, the screen about half the frame (layout study of
// 240 Shorts, 2026-11-17). The panel takes at most half the frame; the webcam is enlarged towards
// a face 18 % tall, never past the soft limit, and covers its panel; the screen stands right
// above the seam, as large as reads (else as its room allows), the region inside the safe box.
//   screenStacked(ctx, camSource, notes) → [candidate]   camSource: { size, faces: [face], baked? }

import { X1, Y1, area, inter, contains, clipBox, grow, clamp, r1, r2 } from "./boxes.mjs";
import { evaluate } from "./evaluate.mjs";
import { holdAxis } from "./fits.mjs";
import { captionHeight } from "./text.mjs";

export function screenFits(ctx, webcam, notes) {
  const { W, H, Z, D, sw, sh, cap, hook, tall } = ctx, S = Z.safe, g = D.gap;
  const main = ctx.sources[0], R = main.faces[0];
  const sRead = main.minText ? Math.ceil(ctx.readable / main.minText * 1e4) / 1e4 : 0;
  const capH = captionHeight(ctx);
  const top0 = hook ? (tall ? (Z.wide || S)[1] + D.hookCard.font * D.hookCard.heightEm : S[1] + D.hookBig.font * D.hookBig.heightEm) + g : 0;
  const bottom0 = cap ? Y1(S) - capH - g : H;
  const bleed = [0, top0, W, bottom0 - top0];
  const rooms = [clipBox(S, bleed), Z.wide && clipBox(Z.wide, bleed)].filter(Boolean);
  if (!rooms.length) { notes.push("the text leaves the screen no room"); return []; }
  const fitOf = (room) => Math.min(room[2] / R[2], room[3] / R[3]);
  const fitsIn = (s, room) => room[2] > 0 && room[3] > 0 && fitOf(room) >= s - 1e-9;
  const sMost = Math.max(...rooms.map(fitOf)), sWhole = Math.min(bleed[2] / sw, bleed[3] / sh);
  // the screen at scale s, its region in `room`: in the room's middle as far as the screen then
  // still fills the frame between the bands (fills: it does); a screen smaller than that stretch
  // lies in its middle. Where it cannot both fill the frame and hold the region, the region wins
  // and ground shows.
  const placeIn = (s, room) => {
    const axisOf = (w0, wL, src, f0, f1, a0, a1) => {
      const target = s * src >= wL ? (a0 + a1) / 2 - s * (f0 + f1) / 2 : w0 + (wL - s * src) / 2;
      const h = holdAxis(s, w0, wL, src, f0, f1, a0, a1, target, 0);
      return h.ok ? h : { v: clamp(target, Math.min(a0 - s * f0, a1 - s * f1), Math.max(a0 - s * f0, a1 - s * f1)), ok: false };
    };
    const x = axisOf(bleed[0], bleed[2], sw, R[0], X1(R), room[0], X1(room)), y = axisOf(bleed[1], bleed[3], sh, R[1], Y1(R), room[1], Y1(room));
    return { s, left: x.v, top: y.v, win: clipBox([x.v, y.v, s * sw, s * sh], bleed), fills: x.ok && y.ok };
  };
  // without a circle: the safe box first, else the room that holds the most of the region
  const place = (s) => placeIn(s, rooms.find((r) => fitsIn(s, r)) || rooms.reduce((a, b) => (fitOf(b) > fitOf(a) ? b : a)));
  const upright = H >= W * 1.5, short = Math.min(W, H);
  const between = [S[0], Math.max(S[1], top0), S[2], Math.min(Y1(S), bottom0) - Math.max(S[1], top0)];
  const order = upright ? ["bottom-left", "bottom-right", "top-left", "top-right"] : ["top-right", "top-left", "bottom-right", "bottom-left"];
  const at = (corner, d) => [corner.endsWith("left") ? between[0] : X1(between) - d, corner.startsWith("top") ? between[1] : Y1(between) - d, d, d];
  const full = Math.round(upright ? D.circle.tall * W : (H > W * 0.9 ? D.circle.square : D.circle.wide) * short), least = Math.round(D.circle.min * short);
  const sizes = [];
  for (let d = full; d > least; d -= Math.max(1, Math.round(0.01 * short))) sizes.push(d);
  sizes.push(Math.min(full, least));
  const withCircle = (s) => {
    for (const d of sizes) {
      const tries = [];
      for (const corner of order) {
        const C = at(corner, d), off = grow(C, g);
        for (const room of rooms) {
          // what of the room the circle leaves: all of it where the circle is elsewhere, else the part above or below it and the part beside it
          const parts = !inter(room, off) ? [room] : [
            corner.startsWith("top") ? [room[0], Y1(off), room[2], Y1(room) - Y1(off)] : [room[0], room[1], room[2], off[1] - room[1]],
            corner.endsWith("left") ? [X1(off), room[1], X1(room) - X1(off), room[3]] : [room[0], room[1], off[0] - room[0], room[3]],
          ];
          for (const part of parts) if (fitsIn(s, part)) tries.push({ q: placeIn(s, part), circle: { box: C, d, corner, covers: 0 } });
        }
      }
      const hit = tries.find((t) => t.q.fills) || tries[0];
      if (hit) return hit;
    }
    return null;
  };
  const circleOf = (found) => {
    // what of the webcam's picture the circle shows: a square around the face, three faces high (head and shoulders), at most the picture's shorter side
    if (webcam.size && webcam.face) {
      const [ww, wh] = webcam.size, f = webcam.face, side = Math.min(ww, wh, 3 * f[3]);
      found.crop = [clamp(f[0] + f[2] / 2 - side / 2, 0, ww - side), clamp(f[1] + D.eyes * f[3] - 0.42 * side, 0, wh - side), side, side].map(r1);
      found.enlargement = r2(found.d / side);
      found.faceHeight = Math.round(f[3] * found.d / side);
    }
    return { ...found, first: order[0], size: full };
  };
  const out = [];
  const add = (fit, s) => {
    let q = place(s), circle = null;
    if (webcam) {
      const w = withCircle(s);
      if (w) { q = w.q; circle = circleOf(w.circle); }
      else {
        // the region leaves no corner: the circle where it covers the least of it, at its smallest
        const region = [q.left + s * R[0], q.top + s * R[1], s * R[2], s * R[3]];
        circle = circleOf(order.map((corner) => ({ box: at(corner, sizes.at(-1)), d: sizes.at(-1), corner, covers: Math.max(1e-4, inter(at(corner, sizes.at(-1)), region) / area(region)) })).sort((a, b) => a.covers - b.covers)[0]);
      }
    }
    const c = evaluate(ctx, { fit, s: q.s, left: q.left, top: q.top, win: q.win, circle });
    out.push(c);
    return c;
  };
  if (sRead && sRead <= sMost + 1e-9) {
    if (sRead > sWhole + 1e-9) {
      const c = add("screen-zoom", sRead);
      // the circle finds no corner beside the region at that size: also the largest scale at which it does
      if (c.circle?.covers > 0) for (let s = sRead * (1 - D.insetStep); s > sWhole; s -= sRead * D.insetStep) if (withCircle(s)) { add("screen-fit", s); notes.push(`at the size that reads (${r2(sRead)}×) the region leaves the webcam's circle no corner: with the circle, at most ${r2(s)}×, the text then ${r1(s * main.minText)} px tall`); break; }
    }
  } else {
    add("screen-fit", sMost);
    if (sRead) {
      // the part of the screen that does read at that size: what the larger room holds of it
      const room = rooms.reduce((a, b) => (Math.min(b[2] / R[2], b[3] / R[3]) > Math.min(a[2] / R[2], a[3] / R[3]) ? b : a));
      const nw = Math.floor(Math.min(R[2], room[2] / sRead)), nh = Math.floor(Math.min(R[3], room[3] / sRead));
      notes.push(`at the size that reads (${r2(sRead)}×) the region would be ${Math.round(sRead * R[2])}×${Math.round(sRead * R[3])} px, larger than the room the frame leaves it (${rooms.map((r) => `${Math.round(r[2])}×${Math.round(r[3])}`).join(" or ")} px): at most ${r2(sMost)}×, the text then ${r1(sMost * main.minText)} px tall. A narrower region reads: at most ${nw}×${nh} px of the source (this one is ${R[2]}×${R[3]}); give the part that matters at this moment, and another region for the next`);
    }
  }
  // the whole screen: as large as the room between the bands allows, smaller where the region would leave the safe box
  for (let i = 0; i <= 50; i++) {
    const s = sWhole * (1 - i * D.insetStep), q = webcam ? withCircle(s)?.q : place(s);
    if (!q) continue;
    const region = [q.left + s * R[0], q.top + s * R[1], s * R[2], s * R[3]];
    if (rooms.some((r) => contains(r, region)) && contains(bleed, [q.left, q.top, s * sw, s * sh])) { add("screen-whole", s); break; }
  }
  return out;
}

export function screenStacked(ctx, cam, notes) {
  const { W, H, Z, D, sw, sh, cap, hook } = ctx, S = Z.safe, g = D.gap;
  if (H < 1.5 * W) { notes.push(`no screen above a webcam's panel (screen-stacked): it is built for upright frames as 9:16, not for ${W}×${H}; the circle stands for the webcam here`); return []; }
  const main = ctx.sources[0], R = main.faces[0], f = cam.faces[0], [cw, ch] = cam.size;
  const soft = D.weights.enlarge.softFrom, capH = captionHeight(ctx);
  const sCam = Math.max(W / cw, Math.min(D.screenFace.height * H / f[3], soft));
  // a webcam baked into the screen shows only a corner of it: a panel of its head and shoulders
  // (three faces high, as the circle shows it) as wide as half the frame at the least
  if (cam.baked && 3 * f[3] * soft < W / 2) {
    notes.push(`no panel under the screen: the speaker baked into the screen is ${f[3]} px tall, and head and shoulders (${3 * f[3]} px) would fill half the frame's width only enlarged ${r2(W / 2 / (3 * f[3]))}×; the circle shows him`);
    return [];
  }
  // the screen: as large as reads and at least as wide as the frame, but its region never wider
  // than the safe box; where that makes it narrower than the frame, it stands in the middle with
  // ground beside it
  const sRead = main.minText ? ctx.readable / main.minText : 0;
  const s = Math.min(S[2] / R[2] * (1 - 1e-9), Math.max(W / sw, sRead));
  const top0 = hook ? (Z.wide || S)[1] + D.hookCard.font * D.hookCard.heightEm + g : 0;
  // the seam: the panel takes at most half the frame and no more than the webcam covers; the
  // screen's part above keeps room for the region, the captions' upper half and the gaps
  const capHalf = cap ? capH / 2 : 0;
  const needUp = Math.max(top0, S[1]) + s * R[3] + 2 * g + capHalf;
  if (H - needUp < 0.25 * H) { notes.push(`no panel under the screen: the region at ${r2(s)}× and the text need ${Math.round(needUp)} px of the frame's height above the seam, which leaves the webcam less than a quarter of the frame; a shorter region gives room for one`); return []; }
  // across: a screen narrower than the frame has its region on the safe box's middle and may run
  // past one of the frame's edges (ground at the other); one as wide holds it as any covering picture
  const tx = W / 2 - s * (R[0] + R[2] / 2), xLo = S[0] - s * R[0], xHi = X1(S) - s * X1(R);
  const x = s * sw < W ? { v: clamp(tx, Math.min(xLo, xHi), Math.max(xLo, xHi)), ok: xLo <= xHi + 0.05 } : holdAxis(s, 0, W, sw, R[0], X1(R), S[0], X1(S), tx, 0);
  const win = (l, t, sc, w, h, part) => clipBox([l, t, sc * w, sc * h], part) || part;
  // the webcam: from the scale that makes its face 18 % of the frame down to half the one that
  // covers the frame's width (below that one the panel is narrower than the frame, ground beside
  // it), the first at which the face stands in the safe box below the seam's captions and the
  // margin kept above a head
  let best = null;
  const least = 0.5 * W / cw;
  for (let sc = sCam; ; sc = Math.max(least, sc - D.zoomStep * sCam)) {
    // the seam: the panel takes at most half the frame, less where the screen's part needs more;
    // a webcam's picture shorter than its panel leaves ground below it, under the apps' bars
    const seam = Math.max(needUp, H - D.screenFace.panel * H), panelH = H - seam;
    const up = [0, 0, W, seam], down = [0, seam, W, panelH];
    const ry1 = seam - capHalf - g, ry0 = Math.max(S[1], top0);
    const y = holdAxis(s, up[1], up[3], sh, R[1], Y1(R), ry0, ry1, ry1 - s * Y1(R), 0, [], [up[3], 0]);
    const fh = sc * f[3], above = Math.max(D.free.aboveMin, D.free.above * fh), below = Math.max(D.free.belowMin, D.free.below * fh);
    // (a webcam's picture smaller than its panel is placed by its face alone, clipped to the panel)
    const free = (t, a0, a1, f0, f1) => { const lo = a0 - sc * f0, hi = a1 - sc * f1; return { v: clamp(t, Math.min(lo, hi), Math.max(lo, hi)), ok: lo <= hi + 0.05 }; };
    const fx = sc * cw < W ? free(W / 2 - sc * (f[0] + f[2] / 2), S[0], X1(S), f[0], X1(f)) : holdAxis(sc, 0, W, cw, f[0], X1(f), S[0], X1(S), W / 2 - sc * (f[0] + f[2] / 2), D.facePad);
    // (below the safe box's bottom, under the apps' bars, the panel may leave ground: a face low in
    // the webcam's picture comes up above the captions' line)
    const ty = seam + panelH / 3 - sc * (f[1] + D.eyes * f[3]);
    const fy = sc * ch < panelH ? free(ty, seam + capHalf + above, Y1(S) - below, f[1], Y1(f)) : holdAxis(sc, seam, panelH, ch, f[1], Y1(f), seam + capHalf + above, Y1(S) - below, ty, D.facePad, [], [0, Math.max(0, H - Y1(S))]);
    const build = { seam, parts: [
      { src: 0, s, left: x.v, top: y.v, win: win(x.v, y.v, s, sw, sh, up), own: null },
      { src: 1, s: sc, left: fx.v, top: fy.v, win: win(fx.v, fy.v, sc, cw, ch, down), own: null },
    ] };
    best ||= build;
    if (fx.ok && fy.ok && y.ok) { best = build; break; }
    if (sc <= least + 1e-9) break;
  }
  return [evaluate(ctx, { fit: "screen-stacked", parts: best.parts, seam: cap ? best.seam : null })];
}
