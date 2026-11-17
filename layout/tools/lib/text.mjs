// Where the text of one placement goes: captions and a hook, into the picture's free part or onto
// the ground beside it. The solver sees no pixels: free is what lies outside every face's box and
// the margins kept around it (DEFAULTS.free), outside a screen's region and a webcam's circle.
//
//   layoutText(ctx, faces, keep, win, isWin, { seam }) → { placed: [{ role, where, on, box, ink,
//       lines, font, style, align, shrunk? }], unmet: [role], penalty, fullSize }
//   keepOut(face, D) → the face's box with its margins: what text stays out of

import { EPS, X1, Y1, area, inter, contains, grow } from "./boxes.mjs";

// where the letters of n lines are inside their block (line height L em, font f px), from the
// font's metrics as measure.js reads them (Noto Sans 800: ascent 1.069, descent 0.293, ascenders
// 0.76, descenders 0.24 em); checked to ±3 px against what platform-zones measured on the layouts made by hand
const inkRows = (top, n, L, f) => [top + (L / 2 - 0.372) * f, top + (n - 1) * L * f + (L / 2 + 0.628) * f];

export function keepOut(f, D) {
  const up = Math.max(D.free.aboveMin, D.free.above * f[3]);
  const down = Math.max(D.free.belowMin, D.free.below * f[3]);
  const side = Math.max(D.free.besideMin, D.free.beside * f[2]);
  return [f[0] - side, f[1] - up, f[2] + 2 * side, f[3] + up + down];
}

// faces: the boxes text is named by (above the head, below the chin); keep: what text stays out of
// (a face with its margins, another person's visible part, a screen region, a webcam's circle);
// opts.seam: the y of the seam between two stacked parts, where captions stand first
export function layoutText(ctx, faces, keep, win, isWin, opts = {}) {
  const { W, Z, D, tall, cap, hook } = ctx;
  const S = Z.safe, C = Z.centred, g = D.gap;
  const want = (cap ? 1 : 0) + (hook ? 1 : 0);
  if (!want) return { placed: [], unmet: [], penalty: 0, fullSize: true };
  const topKeep = keep.length ? Math.min(...keep.map((k) => k[1])) : null;

  // A block is free when it lies inside its zone, touches no face's keep-out and no other text, and
  // does not run across the picture's top or bottom edge (in a wide frame nor its left or right
  // edge): it stands on the picture or on the ground, not on both.
  const crosses = (b) => {
    if (!isWin) return false;
    const ox = Math.min(X1(b), X1(win)) - Math.max(b[0], win[0]) > EPS, oy = Math.min(Y1(b), Y1(win)) - Math.max(b[1], win[1]) > EPS;
    const over = (lo, hi, edge) => lo < edge - EPS && hi > edge + EPS;
    if (ox && (over(b[1], Y1(b), win[1]) || over(b[1], Y1(b), Y1(win)))) return true;
    if (!tall && oy && (over(b[0], X1(b), win[0]) || over(b[0], X1(b), X1(win)))) return true;
    return false;
  };
  const free = (b, zone, placed) => {
    if (!(b[2] > 0 && b[3] > 0) || !contains(zone, b)) return false;
    for (const k of keep) if (inter(b, k) > 0) return false;
    for (const q of placed) if (inter(b, grow(q.box, g)) > 0) return false;
    return !crosses(b);
  };
  // how far down a block that starts at `top` and spans x0–x1 may reach
  const reach = (x0, x1, top, limit, placed) => {
    let y = limit;
    for (const o of [...keep, ...placed.map((q) => grow(q.box, g))]) {
      if (X1(o) <= x0 + EPS || o[0] >= x1 - EPS || Y1(o) <= top + EPS) continue;
      y = Math.min(y, o[1]);
    }
    if (isWin && Math.min(x1, X1(win)) - Math.max(x0, win[0]) > EPS) {
      if (top < win[1] - EPS) y = Math.min(y, win[1] - g);            // on the ground above the picture
      else if (top < Y1(win) - EPS) y = Math.min(y, Y1(win) - D.edgePad); // inside the picture
    }
    return y;
  };
  // columns beside the faces (inside the picture) and beside the picture (on the ground)
  const columns = (minW) => {
    const cols = [];
    const pl = isWin ? Math.max(S[0], win[0] + D.edgePad) : S[0], pr = isWin ? Math.min(X1(S), X1(win) - D.edgePad) : X1(S);
    if (keep.length) {
      const k0 = Math.min(...keep.map((k) => k[0])), k1 = Math.max(...keep.map((k) => X1(k)));
      cols.push({ x: Math.max(pl, k1), w: pr - Math.max(pl, k1) }, { x: pl, w: Math.min(pr, k0) - pl });
      // between two faces that stand apart
      const byX = [...keep].sort((a, b) => a[0] - b[0]);
      let end = X1(byX[0]);
      for (const k of byX.slice(1)) { if (k[0] > end + EPS) cols.push({ x: Math.max(pl, end), w: Math.min(pr, k[0]) - Math.max(pl, end) }); end = Math.max(end, X1(k)); }
    } else cols.push({ x: pl, w: pr - pl });
    if (isWin) {
      const side = Math.max(g, S[0]);
      cols.push({ x: X1(win) + side, w: X1(S) - X1(win) - side }, { x: S[0], w: win[0] - side - S[0] });
    }
    return cols.filter((c) => c.w >= minW - EPS).sort((a, b) => b.w - a.w);
  };

  // what every feed's and grid's crop of the frame shows, across: text set on the frame's middle
  // stays inside it where that leaves it room (a square's 3:4 grid crop is narrower than its safe box)
  const cx0 = Math.max(0, ...Z.crops.map((c) => c.box[0])), cx1 = Math.min(W, ...Z.crops.map((c) => X1(c.box)));

  // where captions may stand, in the order they are tried
  const capOpts = [];
  if (cap) {
    const f = tall ? D.caption.font.tall : D.caption.font.wide, h = cap.lines * f * D.caption.line;
    const w = Math.min(C[2], D.caption.maxEm * f, Math.max(D.caption.minEm * f, 2 * Math.min(W / 2 - cx0, cx1 - W / 2))), x = W / 2 - w / 2;
    const mk = (box, align, zone, pref) => ({ role: "caption", style: "cap", lines: cap.lines, font: f, box, align, zone, pref });
    if (opts.seam != null) capOpts.push({ ...mk([x, opts.seam - h / 2, w, h], "center", C, 0), seam: true });                  // on the seam between two stacked parts
    capOpts.push(mk([x, Y1(S) - h, w, h], "center", C, 0));                                                // lowest line on the safe box's bottom
    if (isWin && Y1(win) < Y1(S) - EPS) capOpts.push(mk([x, Y1(win) - D.edgePad - h, w, h], "center", C, 1)); // in the picture, at its bottom
    if (!tall) for (const col of columns(D.caption.minEm * f)) capOpts.push(mk([col.x, Y1(S) - h, Math.min(col.w, D.caption.maxEm * f), h], "left", S, 2));
    if (topKeep !== null) capOpts.push(mk([x, topKeep - h, w, h], "center", C, 3));                         // directly above the head
    if (isWin && win[1] > S[1] + EPS) capOpts.push(mk([x, win[1] - g - h, w, h], "center", C, 4));            // on the ground above the picture
  }

  const placeHook = (placed) => {
    const opts = [];
    if (tall) {
      // a card across `wide` (without one: across `centred`, in the upper half), from its top
      const hc = D.hookCard, z0 = Z.wide || [C[0], S[1], C[2], S[3] / 2];
      const zx0 = Math.max(z0[0], cx0), zx1 = Math.min(X1(z0), cx1);
      const zone = zx1 - zx0 >= 10 * hc.font ? [zx0, z0[1], zx1 - zx0, z0[3]] : z0;
      const tops = [zone[1]];
      if (isWin && win[1] > zone[1] + EPS) tops.push(win[1] + D.edgePad);
      tops.forEach((top, i) => {
        const font = Math.min(hc.font, Math.floor((reach(zone[0], X1(zone), top, Y1(zone), placed) - top) / hc.heightEm + 1e-6));
        if (font >= hc.minFont) opts.push({ role: "hook", style: "card", lines: 2, font, box: [zone[0], top, zone[2], font * hc.heightEm], align: "center", zone, pref: i, full: font >= hc.font });
      });
    } else {
      // two big lines: beside the face or the picture, else across the top
      const hb = D.hookBig;
      for (const col of columns(hb.widthEm * hb.minFont)) {
        const bottom = reach(col.x, col.x + col.w, S[1], Y1(S), placed);
        const font = Math.floor(Math.min(hb.font, col.w / hb.widthEm, (bottom - S[1]) / hb.heightEm) + 1e-6);
        if (font >= hb.minFont) opts.push({ role: "hook", style: "big", lines: 2, font, box: [col.x, S[1] + (bottom - S[1] - font * hb.heightEm) / 4, font * hb.widthEm, font * hb.heightEm], align: "left", zone: S, pref: 0, full: font >= hb.font });
      }
      const w0 = Math.min(C[2], hb.widthEm * hb.font);
      const bottom = reach(W / 2 - w0 / 2, W / 2 + w0 / 2, S[1], Y1(S), placed);
      const font = Math.floor(Math.min(hb.font, C[2] / hb.widthEm, (bottom - S[1]) / hb.heightEm) + 1e-6);
      if (font >= hb.minFont) opts.push({ role: "hook", style: "big", lines: 2, font, box: [W / 2 - font * hb.widthEm / 2, S[1], font * hb.widthEm, font * hb.heightEm], align: "center", zone: S, pref: 1, full: font >= hb.font });
    }
    return opts.filter((o) => free(o.box, o.zone, placed)).sort((a, b) => b.font - a.font || a.pref - b.pref)[0] || null;
  };

  let best = null;
  for (const c of cap ? [...capOpts, null] : [null]) {
    if (c && !free(c.box, c.zone, [])) continue;
    const placed = c ? [c] : [];
    const hk = hook ? placeHook(placed) : null;
    if (hk) placed.push(hk);
    const arr = { placed, met: placed.length, hookFont: hk ? hk.font : 0, penalty: placed.reduce((s, q) => s + q.pref, 0) };
    if (!best || arr.met > best.met || (arr.met === best.met && arr.hookFont > best.hookFont)) best = arr;
    if (best.met === want && (!hook || best.placed.at(-1).full)) break;
  }

  const top = faces.length ? Math.min(...faces.map((f) => f[1])) : Infinity, chin = faces.length ? Math.max(...faces.map((f) => Y1(f))) : -Infinity;
  const placed = best.placed.map((t) => {
    const [x, y, w, h] = t.box;
    const onPicture = !isWin || inter(t.box, win) >= 0.5 * area(t.box);
    const between = faces.length > 1 && faces.some((f) => X1(f) <= x + EPS) && faces.some((f) => f[0] >= x + w - EPS);
    const where = t.seam ? "seam" : onPicture
      ? (!faces.length ? "free" : Y1(t.box) <= top + EPS ? "above-head" : y >= chin - EPS ? "below-chin" : between ? "between" : "beside")
      : (Y1(t.box) <= win[1] + EPS ? "band-above" : y >= Y1(win) - EPS ? "band-below" : "beside");
    const L = t.style === "card" ? D.hookCard.line : t.style === "big" ? D.hookBig.line : D.caption.line;
    const rows = inkRows(t.style === "card" ? y + (h - 2 * L * t.font) / 2 : y, t.lines, L, t.font);
    return { role: t.role, where, on: onPicture ? "picture" : "ground", box: [x, y, w, h], ink: [x, rows[0], w, rows[1] - rows[0]], lines: t.lines, font: t.font, style: t.style, align: t.align, ...(t.role === "hook" && !t.full ? { shrunk: true } : {}) };
  });
  const roles = placed.map((t) => t.role);
  return {
    placed,
    unmet: [cap && !roles.includes("caption") ? "caption" : null, hook && !roles.includes("hook") ? "hook" : null].filter(Boolean),
    penalty: best.penalty,
    fullSize: !placed.some((t) => t.shrunk),
  };
}
