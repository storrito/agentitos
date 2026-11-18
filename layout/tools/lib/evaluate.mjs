// One placement of the picture, judged and costed: where its faces land in the frame, where the
// text finds room, what is wrong with it, and what it costs in the ranking.
//
//   evaluate(ctx, p) → a candidate: { fit, scale, left, top, window, faceInFrame, text, problems,
//       hard, soft, unmet, terms, cost, rank, … }
//     p: { fit, s, left, top, win: [x, y, w, h] (what of the frame the sharp picture fills), … },
//        or parts: [{ src, s, left, top, win, own }] for two people in two parts
//   cmpRank(a, b)    → which of two candidates comes first

import { EPS, X1, Y1, area, inter, clipBox, grow, r1, r2, pct } from "./boxes.mjs";
import { judge } from "./judge.mjs";
import { keepOut, layoutText } from "./text.mjs";

export function evaluate(ctx, p) {
  const { W, H, Z, D } = ctx, frame = [0, 0, W, H];
  const sources = ctx.sources || [{ size: [ctx.sw, ctx.sh], faces: ctx.faces, first: 0 }];
  // the parts of the frame: one picture, or one per person (stacked, side by side). A part:
  // { src, s, left, top, win, own }: own names the faces of its source it is about (none: all)
  const split = !!p.parts;
  const parts = p.parts || [{ src: 0, s: p.s, left: p.left, top: p.top, win: p.win || frame, own: p.own ?? ctx.own ?? null }];
  const win = split ? frame : parts[0].win;
  const isWin = !split && !(win[0] <= EPS && win[1] <= EPS && X1(win) >= W - EPS && Y1(win) >= H - EPS);
  const total = sources.reduce((n, q) => n + q.faces.length, 0);
  // faces: what the placement is about and must hold; others: people a crop on someone else still
  // shows (whole or cut by its edge): text keeps off them, they need not lie in the safe box
  const faces = [], others = [];
  parts.forEach((q, k) => {
    const src = sources[q.src], shown = clipBox(q.win, frame) || q.win;
    src.faces.forEach((f, i) => {
      const box = [q.left + q.s * f[0], q.top + q.s * f[1], q.s * f[2], q.s * f[3]];
      const label = src.screen ? "region" : total > 1 ? `face ${(src.first || 0) + i + 1}` : "face";
      if (!q.own || q.own.includes(i)) faces.push({ box, label, win: q.win, part: k, height: q.s * (src.heights ? src.heights[i] : f[3]), screen: !!src.screen });
      else { const part = clipBox(box, shown); if (part) others.push({ box: part, label, share: area(part) / area(box), height: q.s * (src.heights ? src.heights[i] : f[3]) }); }
    });
  });
  const keep = [...faces.map((f) => (f.screen ? grow(f.box, D.gap) : keepOut(f.box, D))), ...others.map((o) => keepOut(o.box, D)), ...(p.circle ? [grow(p.circle.box, D.gap)] : [])];
  const text = layoutText(ctx, [...faces, ...others].map((f) => f.box), keep, win, isWin, { seam: p.seam ?? null, card: split || !!sources[0].screen });
  // every face that shows is judged, whoever the placement is about: one under what an app covers
  // or in the safe box's margin is a finding also where it is another person's in a crop on one
  const problems = judge(Z, [
    ...faces.map((f) => ({ kind: "face", label: f.label, box: f.box })),
    ...others.map((o) => ({ kind: "face", label: o.label, box: o.box })),
    ...(p.circle ? [{ kind: "face", label: "webcam", box: p.circle.box }] : []),
    ...text.placed.map((t) => ({ kind: "text", label: t.role, box: t.box, ink: t.ink })),
  ]);
  if (p.circle?.covers > 0) problems.push({ level: "hard", code: "circle-on-region", kind: "face", of: "webcam", what: `${p.circle.covers < 0.005 ? "touches the region or its margin" : `covers ${pct(p.circle.covers)} of the region`}: the region leaves it no corner` });
  // a screen's smallest text, in px of the frame
  const screen = sources[0].screen ? sources[0] : null, textPx = screen?.minText ? parts[0].s * screen.minText : null;
  const unread = textPx !== null && textPx < ctx.readable - 0.05;
  // a face its picture's own edge cuts (the checker knows the frame, not the crop inside it)
  if (isWin || split) for (const f of faces) {
    const cut = 1 - inter(f.box, f.win) / area(f.box);
    if (cut > 0.001 && !problems.some((q) => q.code === "off-frame" && q.of === f.label)) problems.push({ level: "hard", code: "cut", kind: "face", of: f.label, what: `${pct(cut)} cut off by the picture's own edge` });
  }
  // another person in a crop on one, or in the other's part
  for (const o of others) {
    if (split) problems.push({ level: "soft", code: "other-shows", kind: "face", of: o.label, what: `shows in the other person's part (${pct(o.share)} of it)` });
    else if (o.share < 0.999) problems.push({ level: "soft", code: "other-cut", kind: "face", of: o.label, what: `is cut by the picture's edge (${pct(o.share)} of it shows)` });
  }
  const leftOut = !split && parts[0].own ? sources[0].faces.length - parts[0].own.length - others.filter((o) => o.share >= 0.999).length : 0;
  const sMax = Math.max(...parts.map((q) => q.s));
  p = { ...p, s: sMax, left: parts[0].left, top: parts[0].top };
  const Wt = D.weights, EN = Wt.enlarge;
  if (p.s > EN.forbiddenFrom + 1e-9) problems.push({ level: "hard", code: "enlarged", kind: "picture", of: "picture", what: `the source's pixels are enlarged ${r2(p.s)}× (over ${EN.forbiddenFrom}×: too soft to publish)` });
  else if (p.s > EN.softFrom + 1e-9) problems.push({ level: "soft", code: "enlarged", kind: "picture", of: "picture", what: `the source's pixels are enlarged ${r2(p.s)}× (over ${EN.softFrom}×: soft)` });
  for (const role of text.unmet) problems.push({ level: "unmet", code: "no-room", kind: "text", of: role, what: `no free place for the ${role === "caption" ? `${ctx.cap.lines} caption line${ctx.cap.lines > 1 ? "s" : ""}` : "hook"}` });
  if (unread) problems.push({ level: "unmet", code: "small", kind: "picture", of: "screen text", what: `the smallest text is ${r1(textPx)} px tall in the frame, under the ${r1(ctx.readable)} px that read` });
  // A caption area narrower than a long word needs at its type is handed over with a word of it:
  // captions sets a word that is wider than a line smaller for its moment, and in a narrow area
  // its grouping can leave a short word alone before a long one.
  const narrow = text.placed.filter((t) => t.role === "caption" && t.box[2] < D.caption.longWord * t.font - EPS).map((t) => `the captions' area is ${Math.round(t.box[2])} px wide: at ${t.font} px type a word of over ${Math.max(1, Math.floor((t.box[2] / t.font - 1) / 0.57))} letters is wider than a line of it, and captions sets such a word smaller for its moment`);
  const c = {
    fit: p.fit,
    scale: +p.s.toFixed(4),
    left: r1(p.left), top: r1(p.top),
    zoom: r2(p.s / ctx.s0),
    enlargement: r2(p.s),
    ...(p.ratio ? { crop: p.ratio } : {}),
    ...(p.side ? { side: p.side } : {}),
    window: win.map(r1),
    faceInFrame: faces.map((f) => f.box.map(r1)),
    ...(others.length ? { others: others.map((o) => ({ of: o.label, box: o.box.map(r1), shows: +o.share.toFixed(3) })) } : {}),
    ...(split ? { parts: parts.map((q) => ({ source: q.src + 1, scale: +q.s.toFixed(4), left: r1(q.left), top: r1(q.top), window: q.win.map(r1), ...(q.cover === false ? { smaller: true } : {}) })), ...(p.seam != null ? { seam: p.seam } : {}) } : {}),
    ...(p.speaker != null ? { speaker: p.speaker + 1 } : {}),
    ...(leftOut ? { leftOut } : {}),
    text: text.placed.map((t) => ({ ...t, box: t.box.map(r1), ink: t.ink.map(r1) })),
    problems,
    ...(narrow.length ? { notes: narrow } : {}),
    hard: problems.filter((q) => q.level === "hard").length,
    soft: problems.filter((q) => q.level === "soft").length,
    unmet: [...text.unmet, ...(unread ? ["readable"] : [])],
    fullSize: text.fullSize,
    ...(textPx !== null ? { textHeight: r1(textPx) } : {}),
    ...(p.circle ? { circle: { ...p.circle, box: p.circle.box.map(r1) } } : {}),
    ground: Math.max(0, +(1 - parts.reduce((a, q) => a + inter(q.win, frame), 0) / (W * H)).toFixed(3)),
    // the smallest face the picture shows whole: another person a crop on one shows whole is as
    // much in the picture as the one it is made for
    faceHeight: faces.length ? Math.round(Math.min(...faces.map((f) => f.height), ...(split ? [] : others.filter((o) => o.share >= 0.999).map((o) => o.height)))) : 0,
    textPenalty: text.penalty,
    variant: p.variant || 0,
  };
  // The ranking. First: no hard problem; then: every need met; then, where the caller named no
  // speaker: nobody left out of the picture (whom a crop on one of several people leaves out is
  // the caller's decision, never the ranking's). Then the cost in points, smaller first, from the
  // terms of weights.json:
  //   enlargement  0 up to enlarge.softFrom, rising to enlarge.costAtForbidden at enlarge.forbiddenFrom
  //   ground       ground.cost for every per cent of the frame the sharp picture does not fill
  //   subject      nothing while the face is as tall as published talking heads keep theirs (subject.from to
  //                subject.to per cent of the frame's height); subject.smaller for every per cent it falls
  //                short of that, subject.larger for every per cent over it. No reward for a larger face.
  //   soft         soft.cost for every soft problem other than enlargement
  //   text, hook   text.away for every step a text stands from its usual place, text.hookSmaller for a hook under its size
  // Last, among equals: the hold nearest the fit's usual one.
  const softOther = problems.filter((q) => q.level === "soft" && q.code !== "enlarged").length;
  // the subject's size: the face's height in per cent of the frame's (the smallest of several, its
  // usual size when it moves). A screen region has no measured band: the per cent of the frame's
  // width or height it spans, whichever is more, is the better the larger, up to subject.regionEnough.
  const size = screen ? 100 * Math.max(faces[0].box[2] / W, faces[0].box[3] / H) : 100 * c.faceHeight / H, SU = Wt.subject;
  const subject = screen ? SU.smaller * Math.max(0, SU.regionEnough - size) : faces.length ? SU.smaller * Math.max(0, SU.from - size) + SU.larger * Math.max(0, size - SU.to) : 0;
  c.terms = {
    enlargement: Math.max(0, (p.s - EN.softFrom) / (EN.forbiddenFrom - EN.softFrom)) * EN.costAtForbidden,
    ground: Wt.ground.cost * 100 * c.ground,
    subject,
    soft: Wt.soft.cost * softOther,
    text: Wt.text.away * c.textPenalty,
    hook: c.fullSize ? 0 : Wt.text.hookSmaller,
  };
  for (const k of Object.keys(c.terms)) c.terms[k] = Math.round(c.terms[k] * 1000) / 1000 || 0;
  c.cost = Math.round(Object.values(c.terms).reduce((a, b) => a + b, 0) * 1000) / 1000;
  // two people of one picture who stand close together, split into two parts (solve.mjs: ctx.close)
  if (split && ctx.close && parts.every((q) => q.src === 0)) c.splitsClose = true;
  c.rank = [c.hard ? 1 : 0, c.unmet.length, leftOut && !ctx.speakerNamed ? 1 : 0, c.splitsClose ? 1 : 0, Math.round(c.cost * 1000), c.variant];
  return c;
}

export const cmpRank = (a, b) => { for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i]; return 0; };
