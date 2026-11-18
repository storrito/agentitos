// Two people, each in one part of the frame: stacked (one above the other, the captions on the
// seam between them, as platform-zones' pattern "Two people stacked") or side by side. Each part
// is a crop of its person's source around the face: covering its part at the smallest scale that
// holds the face in the safe box's part of it, clear of the text's room, and keeps the other
// person of the same source out; smaller than covering (ground beside it, under what the apps
// cover where that helps) only where no covering scale up to the forbidden enlargement does.
//   people: [{ src, own }] (own: the faces of that source this person is; none: all of them)
//
//   splitFits(ctx, kind, people) → [candidate]   kind: "stacked" | "side-by-side"

import { EPS, X1, Y1, clipBox, hullOf } from "./boxes.mjs";
import { evaluate, cmpRank } from "./evaluate.mjs";
import { holdAxis } from "./fits.mjs";
import { captionHeight } from "./text.mjs";

export function splitFits(ctx, kind, people) {
  const { W, H, Z, D, cap, hook, tall } = ctx, S = Z.safe;
  const halves = kind === "stacked" ? [[0, 0, W, H / 2], [0, H / 2, W, H / 2]] : [[0, 0, W / 2, H], [W / 2, 0, W / 2, H]];
  const seam = kind === "stacked" ? H / 2 : null;
  const capH = captionHeight(ctx);
  // the hook's room above the heads of the upper row: at its size, at its smallest, none kept
  const hookTop = tall ? (Z.wide || S)[1] : S[1];
  const hookHs = !hook ? [0] : tall ? [D.hookCard.font * D.hookCard.heightEm, D.hookCard.minFont * D.hookCard.heightEm, 0] : [D.hookBig.font * D.hookBig.heightEm, D.hookBig.minFont * D.hookBig.heightEm, 0];
  const persons = people.map((q) => {
    const src = ctx.sources[q.src];
    return { ...q, size: src.size, fb: hullOf(q.own ? q.own.map((i) => src.faces[i]) : src.faces), others: q.own ? src.faces.filter((_, i) => !q.own.includes(i)) : [] };
  });
  const oneSource = people[0].src === people[1].src;

  // loose: the picture may leave uncovered what of its part lies above the safe box's top and
  // below its bottom (where the apps lay their bars): ground shows there
  const place = (k, s, hookH, loose = false) => {
    const P = persons[k], half = halves[k], [sw, sh] = P.size, [fx0, fy0, fx1, fy1] = P.fb, fh = s * (fy1 - fy0);
    const up = Math.max(D.free.aboveMin, D.free.above * fh), down = Math.max(D.free.belowMin, D.free.below * fh);
    const A = clipBox(S, half);
    let ay0 = A[1], ay1 = Y1(A);
    if (hookH && (kind !== "stacked" || k === 0)) ay0 = Math.max(ay0, hookTop + hookH + up);
    if (cap && kind === "stacked") { if (k === 0) ay1 = Math.min(ay1, seam - capH / 2 - down); else ay0 = Math.max(ay0, seam + capH / 2 + up); }
    else if (cap) ay1 = Math.min(ay1, Y1(S) - capH - down);
    // the other person of the same source stays out of this part: across where the two stand side by side, else down
    const across = P.others.every((o) => X1(o) <= fx0 || o[0] >= fx1);
    // where it would like to be: the face on the part's middle, the eyes a third down the part; a
    // picture smaller than its part: in the part's middle
    const tx = s * sw >= half[2] ? half[0] + half[2] / 2 - s * (fx0 + fx1) / 2 : half[0] + (half[2] - s * sw) / 2;
    const ty = s * sh >= half[3] ? half[1] + half[3] / 3 - s * (fy0 + D.eyes * (fy1 - fy0)) : half[1] + (half[3] - s * sh) / 2;
    const hold = (x0, x1, y0, y1) => [
      holdAxis(s, half[0], half[2], sw, fx0, fx1, x0, x1, tx, D.facePad, across ? P.others.map((o) => [o[0], X1(o)]) : []),
      holdAxis(s, half[1], half[3], sh, fy0, fy1, y0, y1, ty, D.facePad, across ? [] : P.others.map((o) => [o[1], Y1(o)]), loose ? [Math.max(0, S[1] - half[1]), Math.max(0, Y1(half) - Y1(S))] : [0, 0]),
    ];
    // first inside what a feed or a grid shows of the frame too, then inside the safe box alone
    const B = Z.crops.reduce((a, c) => a && clipBox(a, c.box), A);
    let [x, y] = B ? hold(B[0], X1(B), Math.max(ay0, B[1]), Math.min(ay1, Y1(B))) : [{ ok: false }, { ok: false }];
    if (!(x.ok && y.ok)) [x, y] = hold(A[0], X1(A), ay0, ay1);
    const wx = Math.max(half[0], x.v), wy = Math.max(half[1], y.v);
    return {
      src: P.src, own: P.own, s, left: x.v, top: y.v, ok: x.ok && y.ok, fits: x.fits && y.fits,
      win: [wx, wy, Math.min(X1(half), x.v + s * sw) - wx, Math.min(Y1(half), y.v + s * sh) - wy],
      cover: x.v <= half[0] + EPS && y.v <= half[1] + EPS && x.v + s * sw >= X1(half) - EPS && y.v + s * sh >= Y1(half) - EPS,
    };
  };
  // the scales the persons `ks` may share, each a way to hold them: covering their parts (up from
  // the covering scale while every face fits its room, at most to where enlargement is forbidden);
  // the same, leaving uncovered what the apps' bars cover; smaller than covering. Of the covering
  // scales that hold, the smallest and the largest up to where the smallest face is as tall as
  // published faces are (subject.from) without enlarging the source past softFrom: the search
  // once stopped at the smallest, so that the same two people came out half as large when no
  // hook asked for a larger scale. The ranking chooses among them.
  const scalesFor = (ks, hookH) => {
    const cover = Math.max(...ks.map((k) => Math.max(halves[k][2] / persons[k].size[0], halves[k][3] / persons[k].size[1])));
    const step = D.zoomStep * cover, lim = Math.max(cover, D.weights.enlarge.forbiddenFrom);
    const smallest = Math.min(...ks.map((k) => persons[k].fb[3] - persons[k].fb[1]));
    const upTo = Math.max(cover, Math.min(D.weights.enlarge.softFrom, D.weights.subject.from / 100 * H / smallest));
    const at = (s, loose) => ks.map((k) => place(k, s, hookH, loose));
    const ways = [];
    let modes = 0;
    for (const loose of [false, true]) {
      let first = null, large = null;
      for (let s = cover; s <= lim * (1 + 1e-9); s += step) {
        const q = at(s, loose);
        if (q.every((x) => x.ok)) { first ||= q; if (s <= upTo * (1 + 1e-9)) large = q; else break; }
        else if (first && s > upTo) break;
        if (q.some((x) => !x.fits)) break;
      }
      if (first) { modes++; ways.push(first); if (large && large !== first) ways.push(large); }
    }
    for (let i = 1; i <= 60 && modes < 2; i++) { const q = at(cover * (1 - i * D.insetStep), true); if (q.every((x) => x.ok)) { ways.push(q); break; } }
    return ways.length ? ways : [at(cover, false)];
  };
  const builds = (hookH) => {
    if (oneSource) return scalesFor([0, 1], hookH);
    const list = [];
    for (const a of scalesFor([0], hookH)) for (const b of scalesFor([1], hookH)) {
      const ps = [a[0], b[0]];
      // two sources: the smaller face is brought up to the larger one's size, as far as its part
      // holds it and without enlarging into what is soft for that alone
      if (ps.every((q) => q.ok)) {
        const hOf = (k) => ps[k].s * (persons[k].fb[3] - persons[k].fb[1]);
        const small = hOf(0) < hOf(1) ? 0 : 1, ratio = hOf(1 - small) / hOf(small), s0 = ps[small].s;
        const target = Math.min(s0 * ratio, Math.max(s0, D.weights.enlarge.softFrom));
        for (let s = target; ratio > 1.1 && s > s0 * 1.005; s -= s0 * D.zoomStep) { const q = [place(small, s, hookH), place(small, s, hookH, true)].find((x) => x.ok); if (q) { ps[small] = q; break; } }
      }
      list.push(ps);
    }
    return list;
  };
  let best = null, n = 0;
  for (const hookH of hookHs) for (const parts of builds(hookH)) {
    const c = evaluate(ctx, { fit: kind, parts, seam, variant: n++ });
    if (!best || cmpRank(c, best) < 0) best = c;
  }
  return [best];
}
