// The fits of one picture in a frame, each searched for the placement that holds the faces in
// the safe box and leaves the text room:
//   full    the source covering the frame, unzoomed, centred
//   zoom    a source of the frame's shape, larger: the smallest scale that holds the faces, and
//           the smallest at which the text finds room
//   crop    a source of another shape covering the frame around the faces ("9:16", "4:5", "1:1":
//           which shape; "band": a band across or down the frame, ground beside it)
//   inset   the whole picture smaller, over a ground
//   panel   an upright picture as a tall panel at one side of a wide frame
//
//   pictureFits(ctx, { all, cropsOnly, always }) → { out: [candidate], notes }
//   holdAxis(…) → one axis of a picture in a stretch of the frame (parts.mjs and screen.mjs use it too)

import { EPS, X1, Y1, clamp, ratioOf, r2 } from "./boxes.mjs";
import { evaluate, cmpRank } from "./evaluate.mjs";
import { captionHeight } from "./text.mjs";

// The placements a fit allows along one axis. `cover`: the picture covers the frame's length;
// `inside`: it lies inside it. pick(t): the offset nearest to t at which the faces lie in the safe
// box (by `pad` more where the fit leaves room for it).
function axis(s, L, src, f0, f1, S0, S1, mode, pad) {
  const span = s * src;
  let lo = mode === "cover" ? L - span : 0, hi = mode === "cover" ? 0 : L - span;
  if (lo > hi) lo = hi = (lo + hi) / 2;
  if (f0 === null) return { lo, hi, pick: (t) => clamp(t, lo, hi) };
  const fLo = S0 - s * f0, fHi = S1 - s * f1;
  return {
    lo, hi,
    // exact: a hold the text asks for to the px, where the face may touch the safe box's edge
    pick(t, exact = false) {
      let v = t;
      if (!exact && fLo + pad <= fHi - pad) v = clamp(v, fLo + pad, fHi - pad);
      else if (fLo <= fHi) v = clamp(v, fLo, fHi);
      else v = (fLo + fHi) / 2;
      return clamp(v, lo, hi);
    },
  };
}

// the smallest scale at which a covering picture can hold f0–f1 inside S0–S1 along one axis
function minScale(L, src, f0, f1, S0, S1) {
  const a = src - f1 > EPS ? (L - S1) / (src - f1) : L - S1 > EPS ? Infinity : 0;
  const b = f0 > EPS ? S0 / f0 : S0 > EPS ? Infinity : 0;
  return Math.max(a, b);
}

// the best of the holds one fit allows at one scale
function bestVariant(ctx, fit, s, modeX, modeY, extra = {}) {
  const { W, H, Z, D, sw, sh, fb, tall, cap, hook } = ctx;
  const S = Z.safe, g = D.gap;
  const ax = axis(s, W, sw, fb ? fb[0] : null, fb ? fb[2] : null, S[0], X1(S), modeX, modeX === "cover" ? D.facePad : 0);
  const ay = axis(s, H, sh, fb ? fb[1] : null, fb ? fb[3] : null, S[1], Y1(S), modeY, D.facePad);
  const centredX = (W - s * sw) / 2, centredY = (H - s * sh) / 2;
  // horizontally: the picture centred (a crop: the face centred); in a wide frame also the face as
  // far left and right as the fit allows, which frees a column beside it
  const faceX = fb && extra.aroundFace ? (extra.onSafe ? S[0] + S[2] / 2 : W / 2) - s * (fb[0] + fb[2]) / 2 : centredX;
  let xs = extra.sides ? [-Infinity, Infinity] : extra.centre ? [centredX] : tall && !extra.across ? [faceX] : [faceX, -Infinity, Infinity];
  // vertically: centred (a crop that may choose: eyes on the upper third), the face as low and as
  // high as the fit allows, the chin just high enough for the captions below it, and for a picture
  // smaller than the frame: ending above the captions, starting below the hook
  const eyes = fb ? fb[1] + D.eyes * (fb[3] - fb[1]) : 0;
  const ys = [fb && extra.aroundFace && modeY === "cover" ? H / 3 - s * eyes : centredY, Infinity, -Infinity];
  const capH = captionHeight(ctx);
  const under = fb ? Math.max(D.free.belowMin, D.free.below * s * (fb[3] - fb[1])) : 0;
  if (cap && fb) ys.push(Y1(S) - capH - under - s * fb[3]);
  // and for a hook as text: the chin just high enough for it below, alone and above the captions;
  // the head just low enough for it above, at its size and at its smallest
  if (hook && tall && hook.kind !== "card" && fb) {
    const ht = D.hookText, hookH = ht.font * ht.heightEm, over = Math.max(D.free.aboveMin, D.free.above * s * (fb[3] - fb[1]));
    ys.push(Y1(S) - hookH - under - s * fb[3]);
    if (cap) ys.push(Y1(S) - capH - g - hookH - under - s * fb[3]);
    ys.push(S[1] + hookH + over - s * fb[1], S[1] + ht.minFont * ht.heightEm + over - s * fb[1]);
  }
  if (modeY === "inside") {
    if (cap) ys.push(Y1(S) - capH - g - s * sh);
    if (hook && tall) { const top = (Z.wide || S)[1]; ys.push(top + D.hookCard.font * D.hookCard.heightEm + g, top + D.hookCard.minFont * D.hookCard.heightEm + g); }
    // the picture starting below a hook text on the ground above it, and below the captions as well
    if (hook && tall && hook.kind !== "card") for (const font of [D.hookText.font, D.hookText.minFont]) { const hookH = font * D.hookText.heightEm; ys.push({ exact: S[1] + hookH + g }); if (cap) ys.push({ exact: S[1] + hookH + g + capH + g }); }
  }
  let best = null, bestFull = null, n = 0, first = [0, 0];
  const seen = new Set();
  for (const ty of ys) for (const tx of xs) {
    const left = ax.pick(tx), top = typeof ty === "object" ? ay.pick(ty.exact, true) : ay.pick(ty), key = `${Math.round(left * 10)},${Math.round(top * 10)}`;
    // how far this hold is from the fit's usual one (the first: centred), the last tie-break
    const variant = n++ ? Math.round(Math.abs(left - first[0]) + Math.abs(top - first[1])) : 0;
    if (!variant) first = [left, top];
    if (seen.has(key)) continue;
    seen.add(key);
    const win = [modeX === "cover" ? 0 : left, modeY === "cover" ? 0 : top, modeX === "cover" ? W : s * sw, modeY === "cover" ? H : s * sh];
    const c = evaluate(ctx, { fit, s, left, top, win, variant, ratio: extra.ratio, speaker: ctx.speaker, side: extra.sides ? (left + s * sw / 2 < W / 2 ? "left" : "right") : undefined, onGround: !!extra.onGround });
    if (!best || cmpRank(c, best) < 0) best = c;
    // the best hold at which every text stands at its full size (it may differ from the best one)
    if (!c.hard && !c.unmet.length && c.fullSize && (!bestFull || cmpRank(c, bestFull) < 0)) bestFull = c;
  }
  best.full = bestFull;
  return best;
}

// One axis of a picture in a stretch of the frame. The picture (src px long, at scale s) covers
// the stretch w0…w0+wL where it is long enough (else it lies anywhere inside it); the face f0…f1 (px
// of the source) lies inside a0…a1 (by pad more where there is room); the stretches of the source
// in `out` (another person's face) do not show in w0…w0+wL.
// → { v: the picture's origin, the nearest to target; ok: all of that holds; fits: the face is not
//   longer than a0…a1 }
export function holdAxis(s, w0, wL, src, f0, f1, a0, a1, target, pad, out = [], slack = [0, 0]) {
  // slack: how much of the stretch's start and end the picture may leave uncovered
  const span = s * src, fits = s * (f1 - f0) <= a1 - a0 + EPS;
  const lo = span >= wL ? w0 + wL - span - slack[1] : w0, hi = span >= wL ? w0 + slack[0] : w0 + wL - span;
  const fLo = a0 - s * f0, fHi = a1 - s * f1;
  let A = Math.max(lo, fLo + pad), B = Math.min(hi, fHi - pad);
  if (A > B + EPS) { A = Math.max(lo, fLo); B = Math.min(hi, fHi); }
  if (!fits || A > B + EPS) return { v: clamp(clamp(target, Math.min(fLo, fHi), Math.max(fLo, fHi)), lo, hi), ok: false, fits };
  let free = [[A, Math.max(A, B)]];
  for (const [o0, o1] of out) { const x0 = w0 - s * o1, x1 = w0 + wL - s * o0; free = free.flatMap(([a, b]) => [[a, Math.min(b, x0)], [Math.max(a, x1), b]].filter(([q, r]) => q <= r + EPS)); }
  if (!free.length) return { v: clamp(target, A, B), ok: false, fits };
  return { v: free.map(([a, b]) => clamp(target, a, b)).sort((q, r) => Math.abs(q - target) - Math.abs(r - target))[0], ok: true, fits };
}
// the fits of one picture in the frame (unchanged, zoom or crop, bands, inset, panel) around the
// faces ctx.fb spans; cropsOnly: only its crops (a crop on one of several people); always: also
// where the unchanged picture passes
export function pictureFits(ctx, { all = false, cropsOnly = false, always = false } = {}) {
  const { W, H, Z, D, sw, sh, s0, fb } = ctx, faces = ctx.own || ctx.faces;
  const sc = Math.min(W / sw, H / sh);
  const S = Z.safe, rs = sw / sh, rf = W / H, same = Math.abs(rs / rf - 1) < 0.02;
  const out = [], notes = [];
  const met = (c) => !c.hard && !c.unmet.length;
  // what a search for a smaller or larger picture stops at: the text placed and every face inside
  // the safe box (not only clear of what the apps cover)
  const clean = (c) => met(c) && !c.problems.some((q) => q.kind === "face" && q.code === "margin");

  // full: the source covering the frame, unzoomed, centred
  const full = evaluate(ctx, { fit: "full", s: s0, left: (W - s0 * sw) / 2, top: (H - s0 * sh) / 2, win: [0, 0, W, H] });
  if (!cropsOnly) out.push(full);
  if (cropsOnly && same) return { out, notes };

  // text is open while the unzoomed picture leaves a need unmet or a hook smaller than its size
  const textOpen = all || !(met(full) && full.fullSize);
  // a larger zoom than the faces need is looked for only where the unzoomed picture leaves text without a place
  const textUnmet = all || full.unmet.length > 0;
  if (all || always || cropsOnly || !(met(full) && !full.soft && full.fullSize)) {
    // zoom (a source of the frame's ratio) or crop (any other): the picture covers the frame, at the
    // smallest scale that holds every face in the safe box; and, where the text finds no room at
    // that scale, at the smallest one where it does
    {
      const name = same ? "zoom" : "crop", step = D.zoomStep * s0;
      const need = fb ? Math.max(s0, minScale(W, sw, fb[0], fb[2], S[0], X1(S)), minScale(H, sh, fb[1], fb[3], S[1], Y1(S))) : s0;
      const most = fb ? Math.min(S[2] / (fb[2] - fb[0]), S[3] / (fb[3] - fb[1])) : Infinity;
      if (!(need <= most + 1e-9)) {
        const pl = faces.length > 1, fw = fb ? fb[2] - fb[0] : 0, fh = fb ? fb[3] - fb[1] : 0;
        notes.push(need === Infinity ? `no ${name} that fills the frame holds the face${pl ? "s" : ""} in the safe box: a face touches the source's edge`
          : `no ${name} that fills the frame holds the face${pl ? "s" : ""} in the safe box: filling the frame with the face${pl ? "s" : ""} inside the box takes the source at ${r2(need)}× or more (${r2(need / s0)}× of what covers the frame), and there ${pl ? "they span" : "the face is"} ${Math.round(need * fw)}×${Math.round(need * fh)} px, more than the safe box's ${Math.round(S[2])}×${Math.round(S[3])}; ${pl ? "they fit" : "it fits"} the box only up to ${r2(most)}×, where the picture no longer fills the frame`);
      } else {
        let k = Math.ceil((need - s0) / step - 1e-6);
        if (same && k < 1) k = 1;
        const kMax = Math.floor((Math.min(most, s0 * D.zoomMax) - s0) / step + 1e-6);
        let first = null, hit = null;
        // where the unzoomed picture already holds the faces and the text, no zoom is looked for
        const wanted = !same || need > s0 + 1e-9 || textUnmet;
        for (; wanted && k <= Math.max(kMax, Math.ceil((need - s0) / step - 1e-6)); k++) {
          const c = bestVariant(ctx, name, s0 + k * step, "cover", "cover", { aroundFace: !same, ratio: same ? undefined : Z.frame });
          first ||= c;
          if (clean(c)) { hit = c; break; }
          if (s0 + k * step > most) break;
        }
        // the smallest zoom is a candidate where the faces need one (a crop always is)
        if (first && (!same || need > s0 + 1e-9)) out.push(first);
        if (hit && hit !== first && textUnmet) out.push(hit);
      }
    }
    // a picture smaller than the frame over a ground. How small: down to insetMin of where it
    // starts, and further while the smallest face is still insetFace % of the frame's height (the
    // lower end of what published faces are): a take with a large face finds room for its text
    // only well below half its size
    const faceSrc = ctx.faces.length ? Math.min(...(ctx.own ? ctx.own.map((k) => ctx.faces[k]) : ctx.faces).map((f) => f[3])) : 0;
    const floorOf = (from) => (faceSrc ? Math.min(D.insetMin, D.insetFace / 100 * H / faceSrc / from) : D.insetMin);
    const scanDown = (fit, from, floor, modeX, modeY, extra) => {
      let best = null, firstMet = null, firstFull = null;
      for (let k = from === s0 ? 1 : 0; ; k++) {
        const s = from * (1 - k * D.insetStep);
        if (s < from * floor - 1e-9) break;
        const c = bestVariant(ctx, fit, s, modeX, modeY, extra);
        if (!best || cmpRank(c, best) < 0) best = c;
        if (clean(c)) firstMet ||= c;
        if (c.full && clean(c.full)) { firstFull = c.full; break; }
      }
      out.push(firstMet || best);
      if (firstFull && firstFull !== firstMet) out.push(firstFull);
    };
    // between covering and whole: where no crop so far holds the faces and the text, the largest
    // picture that does: a band across the frame (or down it), ground beside it
    const between = () => {
      if (out.some((c) => c.fit === "crop" && clean(c))) return;
      for (let k = 1; ; k++) {
        const s = s0 * (1 - k * D.insetStep);
        if (s <= sc * (1 + 1e-9)) break;
        const c = bestVariant(ctx, "crop", s, s * sw >= W - EPS ? "cover" : "inside", s * sh >= H - EPS ? "cover" : "inside", { aroundFace: true, ratio: "band" });
        if (clean(c)) { out.push(c); break; }
      }
    };
    if (cropsOnly) {
      if (rs > rf && ctx.tall) for (const r of D.bands) {
        const wh = W / ratioOf(r);
        if (wh < H - 1 && rs > ratioOf(r) * 1.02) out.push(bestVariant(ctx, "crop", wh / sh, "cover", "inside", { aroundFace: true, ratio: r }));
      }
      between();
    } else if (same) { if (textOpen) scanDown("inset", s0, floorOf(s0), "inside", "inside"); }   // smaller on every side: only for the text's sake
    else if (rs > rf) {
      // a source wider than the frame's shape: crops as bands across an upright frame, and the whole source
      if (ctx.tall) for (const r of D.bands) {
        const wh = W / ratioOf(r);
        if (wh < H - 1 && rs > ratioOf(r) * 1.02) out.push(bestVariant(ctx, "crop", wh / sh, "cover", "inside", { aroundFace: true, ratio: r }));
      }
      between();
      out.push(bestVariant(ctx, "inset", sc, "inside", "inside"));
      // where neither a crop nor the whole source at the frame's width holds the faces and the
      // text, a smaller whole source may: a face near the source's edge comes into the safe box
      if (!out.some(met)) scanDown("inset", sc, floorOf(sc), "inside", "inside");
    } else if (!ctx.tall) {
      // a frame wider than the source: a panel at one side, the text beside it; and the whole
      // picture in the middle, the sides filled with ground, the captions over its bottom (as an
      // upright clip stands in a wide video)
      scanDown("panel", sc, D.panelMin, "inside", "inside", { sides: true });
      scanDown("inset", sc, D.panelMin, "inside", "inside", { centre: true });
    }
    else {
      // an upright source in a frame less upright (4:5, 1:1): between covering and whole, the
      // whole picture, and where even that leaves text without a place, a smaller one
      between();
      out.push(bestVariant(ctx, "inset", sc, "inside", "inside"));
      if (!out.some(met)) scanDown("inset", sc, floorOf(sc), "inside", "inside");
    }
    // Still nothing that passes, in an upright frame: the whole picture smaller and also at the
    // left and the right of the safe box, where so far it stood only in the frame's middle. A
    // face at one side of the picture then leaves the frame's middle to the text.
    if (!cropsOnly && ctx.tall && !out.some(met)) scanDown("inset", same ? s0 : sc, floorOf(same ? s0 : sc), "inside", "inside", { across: true });
  }

  // Closer in: from a source with pixels to spare (4K into 1080 px), covering the frame leaves
  // the face small. The closest crop (or, from a source of the frame's shape, zoom) that brings
  // the face whose size counts towards the size published faces have (subject.from), without
  // enlarging the source past softFrom, every face in the safe box with the margins kept beside
  // and above a head (a head at the box's very edge has its hair at the frame's edge); where the
  // text finds no room there, a little less close.
  // (pixels to spare: the source covers the frame below 1×, a 4K picture in a 1080 frame)
  if (fb && s0 < 1 - 1e-9 && !(cropsOnly && same)) {
    const src = ctx.sources?.[0], held = ctx.own ? ctx.own.map((k) => ctx.faces[k]) : ctx.faces;
    const idx = ctx.own || (ctx.speakerFace != null ? [ctx.speakerFace] : ctx.faces.map((_, k) => k));
    const per = Math.min(...idx.map((k) => (src?.heights ? src.heights[k] : ctx.faces[k][3])));
    const maxW = Math.max(...held.map((f) => f[2])), maxH = Math.max(...held.map((f) => f[3]));
    const room = Math.min(S[2] / (fb[2] - fb[0] + 2 * D.free.beside * maxW), S[3] / (fb[3] - fb[1] + D.free.above * maxH));
    const need = Math.max(s0, minScale(W, sw, fb[0], fb[2], S[0], X1(S)), minScale(H, sh, fb[1], fb[3], S[1], Y1(S)));
    const top = Math.min(D.weights.subject.from / 100 * H / per, D.weights.enlarge.softFrom, room), step = D.zoomStep * s0;
    for (let s = top; s > need + step; s -= step) {
      // (on the safe box's middle, where the margins beside the heads have room on both sides)
      const c = bestVariant(ctx, same ? "zoom" : "crop", s, "cover", "cover", { aroundFace: true, onSafe: true, ratio: same ? undefined : Z.frame });
      if (clean(c)) { c.closer = true; out.push(c); break; }
    }
  }
  // The text in the bands: where the picture stands smaller than an upright frame, the same
  // picture with the hook and the captions on the ground above and below it, so that the agent
  // can choose a calm band over the picture's own (candidate.groundShows says what lies there).
  if (ctx.tall && (ctx.cap || ctx.hook)) for (const c of [...out]) {
    if (!(c.ground > 0) || !(c.fit === "inset" || c.fit === "crop") || c.text.every((t) => t.on === "ground") && c.text.length) continue;
    const mx = c.window[2] >= W - EPS ? "cover" : "inside", my = c.window[3] >= H - EPS ? "cover" : "inside";
    const v = bestVariant(ctx, c.fit, c.scale, mx, my, { aroundFace: c.fit === "crop", ratio: c.crop, onGround: true });
    if (met(v) && v.text.some((t) => t.on === "ground")) { v.onGround = true; out.push(v); }
  }
  return { out, notes };
}
