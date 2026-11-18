// The solver: what matters in a recording (a face, several, a face that moves, a region of a
// screen) and the frame it goes to → every way to place the picture and the text that holds,
// judged against the zones and ranked by the weights, each with its reasons.
//
//   solve({ zones, source, faces, needs, speaker, set, weights })
//   solve({ zones, sources: [{ size, faces | region, minTextHeight }, …], needs, … })
//     → { frame, size, platforms, source, faces, needs, defaults, notes, candidates, tracks? }
//       zones     from askZones (lib/zones.mjs)
//       needs     [{ role: "caption", lines }, { role: "hook" }]
//       source    [w, h]; faces: [[x, y, w, h] | [{ t, box }, …], …] in px of the source; two
//                 people as two files, or a screen and its webcam: sources
//       speaker   the face (from 1) a crop on one of several people is made for (none: one each)
//       set       { "dotted.key": value } over the defaults; weights: readWeights(file)
//   trackFace(moments) → a moving face's hull and usual box
//
// A candidate: { fit, scale, left, top, window, faceInFrame, text: [{ role, where, box, font,
//   style, … }], problems, hard, soft, unmet, notes?, terms, cost, score, why, behind }
//   fit    "full" | "zoom" | "inset" | "crop" (crop: "9:16" | "4:5" | "1:1" | "band"; speaker: N for
//          a crop on one of several people) | "panel" (side) | "stacked" | "side-by-side" (parts:
//          [{ source, scale, left, top, window }], seam) | "screen-zoom" | "screen-fit" |
//          "screen-whole" (textHeight, circle: { box, d, corner, crop })
//   scale  frame px per source px; left, top: where the source's corner lies in the frame;
//          window: what of the frame the sharp picture fills (the rest is ground)
//   where  "above-head" | "below-chin" | "beside" | "between" (two faces) | "seam" (two stacked
//          parts) | "band-below" | "band-above" (on the ground) | "free" (no face)
//   style  "cap" (captions) | "text" (a hook as two lines of big type) | "card" (a hook as a card
//          across the top) | "big" (a hook as two big lines beside the picture, 16:9)
//   cost   the ranking's points, smaller first, with its terms; a hard problem, an unmet need
//          and, with no speaker named, a person left out rank before it (weights.json says how)
//   notes  what the caller should know of this candidate: a caption area narrower than a long word

import { X1, Y1, area, hullOf, median, r1, r2, pct } from "./boxes.mjs";
import { DEFAULTS, merged, scaled } from "./defaults.mjs";
import { cmpRank } from "./evaluate.mjs";
import { pictureFits } from "./fits.mjs";
import { splitFits } from "./parts.mjs";
import { screenFits } from "./screen.mjs";

// A face as it is given: a box [x, y, w, h], or its box at several moments [{ t, box }, …] (a
// face that moves). A moving face is held by the hull of its boxes, so that the placement and the
// text hold for the whole clip; its usual box (the median of each edge) says how large it is.
export function trackFace(moments) {
  const at = (Array.isArray(moments) ? moments : []).map((m) => ({ t: Number(m?.t ?? NaN), box: (Array.isArray(m?.box) ? m.box : []).map(Number) })).sort((a, b) => a.t - b.t);
  if (!at.length || at.some((m) => !Number.isFinite(m.t) || m.box.length !== 4 || m.box.some((v) => !Number.isFinite(v)) || m.box[2] <= 0 || m.box[3] <= 0)) throw new Error("A moving face is a list of { t, box: [x, y, w, h] } with one moment at least.");
  const h = hullOf(at.map((m) => m.box)), hull = [h[0], h[1], h[2] - h[0], h[3] - h[1]];
  const e = [median(at.map((m) => m.box[0])), median(at.map((m) => m.box[1])), median(at.map((m) => X1(m.box))), median(at.map((m) => Y1(m.box)))];
  const usual = [e[0], e[1], e[2] - e[0], e[3] - e[1]].map(r1);
  const first = (f) => at.reduce((a, m) => (f(m.box) < f(a.box) ? m : a)).t;
  return {
    box: hull, height: usual[3],
    track: {
      moments: at.length, from: at[0].t, to: at.at(-1).t, usual, hull,
      growth: { width: r2(hull[2] / usual[2]), height: r2(hull[3] / usual[3]), area: r2(area(hull) / area(usual)) },
      // the moment that gives the hull each of its edges
      edges: { top: first((b) => b[1]), bottom: first((b) => -Y1(b)), left: first((b) => b[0]), right: first((b) => -X1(b)) },
    },
    at,
  };
}

export function solve(args) {
  const res = solveOnce(args);
  // a face that moves: how much larger its hull is than its usual box, and the moment that decides
  // the placement: of the moments that give the hull an edge, each is left out in turn and the
  // case solved again; a moment decides when the first candidate is then another
  const list = args.sources || [{ size: args.source, faces: args.faces || [] }];
  const tracks = [];
  const sig = (c) => JSON.stringify([c.fit, c.crop, c.speaker, c.scale, c.left, c.top, c.parts, c.text.map((t) => [t.role, t.where, t.box, t.font])]);
  const short = (c) => `${c.fit}${c.crop ? ` ${c.crop}` : ""}${c.speaker ? ` on face ${c.speaker}` : ""} ${c.parts ? c.parts.map((q) => `${q.scale}×`).join(" and ") : `${c.scale}× at ${c.left}/${c.top}`}${c.text.length ? `, ${c.text.map((t) => `${t.role} ${t.where} y ${Math.round(t.box[1])}–${Math.round(Y1(t.box))}${t.role === "hook" ? ` (${t.font} px)` : ""}`).join(", ")}` : ""}${c.unmet.length ? `, ${c.unmet.join(" and ")} unmet` : ""}${c.hard ? ", fails" : ""}`;
  // how far two placements are apart: another fit counts most, then the scale (in per cent), then
  // how far the picture and the text moved (in px)
  const changeOf = (a, b) => (a.fit !== b.fit || a.crop !== b.crop ? 10000 : 0) + 100 * Math.abs(a.scale / b.scale - 1) * 100 + Math.abs(a.left - b.left) + Math.abs(a.top - b.top)
    + (a.unmet.length !== b.unmet.length || a.text.length !== b.text.length ? 1000 : a.text.reduce((n, t, i) => n + Math.abs(t.box[0] - b.text[i].box[0]) + Math.abs(t.box[1] - b.text[i].box[1]) + 10 * Math.abs(t.font - b.text[i].font), 0));
  let n = 0;
  list.forEach((q, si) => (q.faces || []).forEach((f, fi) => {
    n++;
    if (typeof f[0] === "number") return;
    const tf = trackFace(Array.isArray(f) ? f : f.at), info = { face: n, source: si + 1, ...tf.track, placed: short(res.candidates[0]), decides: [] };
    const by = new Map();
    for (const [edge, t] of Object.entries(tf.track.edges)) by.set(t, [...(by.get(t) || []), edge]);
    for (const [t, edges] of by) {
      const less = tf.at.filter((m) => m.t !== t);
      if (!less.length) continue;
      const alt = solveOnce({ ...args, source: undefined, faces: undefined, sources: list.map((q2, i2) => ({ size: q2.size, faces: (q2.faces || []).map((f2, j2) => (i2 === si && j2 === fi ? less : f2)) })) }).candidates[0];
      if (sig(alt) !== sig(res.candidates[0])) info.decides.push({ t, edges, without: short(alt), change: Math.round(changeOf(alt, res.candidates[0])) });
    }
    // the moment whose absence changes the most comes first: that one decides
    info.decides.sort((a, b) => b.change - a.change);
    tracks.push(info);
    const g = tf.track.growth;
    res.notes.push(`face ${n} moves (${tf.track.moments} moments, ${tf.track.from}–${tf.track.to} s): placed for the hull of its boxes, ${g.width}× as wide and ${g.height}× as tall as its usual box (${g.area}× the area)${g.area > res.defaults.track.far ? `: it moves far, one placement for the whole clip holds it small; cut the clip where it moves or follow the face` : ""}`);
  }));
  if (tracks.length) res.tracks = tracks;
  return res;
}

function solveOnce({ zones: Z, source = null, faces = [], sources = null, region = null, minTextHeight = 0, needs = [], set = {}, all = false, weights = null, speaker = null }) {
  const [W, H] = Z.size;
  const D = scaled(merged(weights ? { ...DEFAULTS, weights } : DEFAULTS, set), Z.size);
  let count = 0;
  const srcs = (sources || [{ size: source, faces, region, minTextHeight }]).map((q) => {
    // a screen recording: its region is what the placement holds; a face given with it is the webcam's
    if (q.region) return { size: q.size, faces: [q.region], heights: [q.region[3]], tracks: [null], screen: true, minText: q.minTextHeight || 0, webcam: (q.faces || [])[0] || null, first: 0 };
    const fs = (q.faces || []).map((f) => (typeof f[0] === "number" ? { box: f, height: f[3], track: null } : trackFace(Array.isArray(f) ? f : f.at)));
    const o = { size: q.size, faces: fs.map((f) => f.box), heights: fs.map((f) => f.height), tracks: fs.map((f) => f.track), given: fs, first: count };
    count += fs.length;
    return o;
  });
  if (srcs.length > 2) throw new Error("More than two sources are not built: one picture, or two people as two files.");
  if (speaker != null && !(srcs.length === 1 && srcs[0].faces[speaker - 1])) throw new Error(`There is no face ${speaker} to crop on: ${srcs.length === 1 ? `${srcs[0].faces.length} given` : "a speaker is named among the faces of one source"}.`);
  const main = srcs[0], [sw, sh] = main.size;
  const s0 = Math.max(W / sw, H / sh);
  const ctx = {
    W, H, Z, D, sw, sh, s0, faces: main.faces, fb: main.faces.length ? hullOf(main.faces) : null, sources: srcs, tall: W <= H, speakerNamed: speaker != null,
    cap: needs.find((n) => n.role === "caption") || null, hook: needs.find((n) => n.role === "hook") || null,
  };
  const rs = sw / sh, rf = W / H, same = Math.abs(rs / rf - 1) < 0.02;
  const out = [], notes = [];
  ctx.readable = D.readable.height * W / D.readable.per;
  if (main.screen) {
    // a screen and its region; the webcam: the second source's face, or a face given with the screen
    const cam = srcs[1] ? { size: srcs[1].size, face: srcs[1].faces[0] || null } : main.webcam ? { size: null, face: main.webcam } : null;
    ctx.sources = [main];
    out.push(...screenFits(ctx, cam, notes));
    if (!main.minText) notes.push("no --min-text-height given: whether the screen's text reads is not judged");
  } else if (srcs.length === 2) {
    // two people as two files: stacked in an upright frame, side by side in a wide one, both tried between
    if (srcs.some((q) => !q.faces.length)) throw new Error("Two sources are two people: each needs a face.");
    for (const kind of rf <= 0.67 ? ["stacked"] : rf >= 1.5 ? ["side-by-side"] : ["stacked", "side-by-side"]) out.push(...splitFits(ctx, kind, [{ src: 0, own: null }, { src: 1, own: null }]));
  } else {
    // several people in one picture that is wider than the frame: besides the fits that hold them
    // all, a crop on one of them and, for two, both stacked
    const several = main.faces.length > 1 && !same && rs > rf;
    const r = pictureFits(ctx, { all, always: several });
    out.push(...r.out); notes.push(...r.notes);
    if (several) {
      for (const k of speaker != null ? [speaker - 1] : main.faces.map((_, i) => i)) {
        const f = main.faces[k], q = pictureFits({ ...ctx, fb: [f[0], f[1], X1(f), Y1(f)], own: [k], speaker: k }, { cropsOnly: true });
        out.push(...q.out); notes.push(...q.notes.map((n) => `a crop on face ${k + 1}: ${n}`));
      }
      if (speaker == null) notes.push(`no speaker named: the crops on one person are listed for each of the ${main.faces.length}, behind every candidate that shows them all: whom to leave out is yours to say (--speaker N lists only that person's crops, ranked with the rest)`);
      if (main.faces.length === 2 && ctx.tall) {
        const order = [0, 1].sort((a, b) => main.faces[a][0] + main.faces[a][2] / 2 - main.faces[b][0] - main.faces[b][2] / 2);
        // two who stand close together belong in one picture: stacked is listed behind every
        // candidate that shows both in one
        const [a, b] = order.map((i) => main.faces[i]), gap = b[0] - X1(a), width = Math.max(a[2], b[2]);
        if (gap <= D.together * width) {
          ctx.close = true;
          notes.push(`faces 1 and 2 stand close together (their boxes ${Math.max(0, Math.round(gap))} px apart, ${r2(Math.max(0, gap) / width)}× the wider face's width; close is up to ${D.together}×): one picture holds both, so stacked, which would split them into two halves of the same shot, is listed behind every candidate that shows both in one picture. Stacking is for people far apart or filmed apart`);
        }
        out.push(...splitFits(ctx, "stacked", order.map((i) => ({ src: 0, own: [i] }))));
      } else if (main.faces.length > 2) notes.push(`stacked parts are built for two people, not for ${main.faces.length}`);
    }
  }
  return ranked(ctx, out, notes, { needs, srcs });
}

// rank, and say why
function ranked(ctx, out, notes, { needs, srcs }) {
  const { Z, D } = ctx, main = srcs[0];
  const seen = new Set();
  const cands = out.filter((c) => { delete c.full; return true; }).filter((c) => { const k = `${c.fit}|${c.scale}|${c.left}|${c.top}|${c.window}|${c.speaker || ""}|${JSON.stringify(c.parts || "")}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort(cmpRank);
  // the score: 100 less the cost for a candidate that passes (so that larger is better and the
  // distance between two is the difference of their costs in points), 0 for one that does not
  cands.forEach((c, i) => {
    c.score = c.hard || c.unmet.length ? 0 : +(100 - c.cost).toFixed(3);
    c.why = why(c, ctx);
    if (i) c.behind = behind(c, cands[0]);
  });
  return {
    frame: Z.frame, size: Z.size, platforms: Z.platforms.map((p) => p.name), fallback: Z.fallback,
    source: main.size, faces: main.faces, ...(main.screen ? { screen: { region: main.faces[0], minTextHeight: main.minText, readable: r1(ctx.readable) } } : srcs.length > 1 ? { sources: srcs.map((q) => ({ size: q.size, faces: q.faces })) } : {}),
    needs, defaults: D, notes, candidates: cands,
  };
}

const textLine = (t) => `${t.role === "caption" ? `${t.lines} caption line${t.lines > 1 ? "s" : ""}` : `hook ${t.style === "card" ? "card" : t.style === "text" ? "text" : "lines"} at ${t.font} px${t.shrunk ? " (smaller than its size)" : ""}`} ${t.where}`;
function why(c, ctx) {
  const D = ctx.D, out = [];
  const hard = c.problems.filter((q) => q.level === "hard");
  out.push(hard.length ? `fails: ${hard.map((q) => `${q.of} ${q.what}`).join("; ")}` : "no hard problem");
  const noPlace = c.unmet.filter((u) => u !== "readable");
  if (ctx.cap || ctx.hook) out.push(noPlace.length ? `text without a place: ${noPlace.join(", ")}${c.text.length ? ` (placed: ${c.text.map(textLine).join(", ")})` : ""}` : `every text need met: ${c.text.map(textLine).join(", ")}`);
  if (c.unmet.includes("readable")) out.push("the screen's smallest text does not read");
  out.push(c.enlargement <= 1 ? `the source's pixels are not enlarged (${c.enlargement}×)` : c.enlargement <= D.weights.enlarge.softFrom ? `the source's pixels are enlarged ${c.enlargement}×, not over the ${D.weights.enlarge.softFrom}× from where it shows` : `the source's pixels are enlarged ${c.enlargement}×`);
  if (ctx.sources?.[0].screen) { const b = c.faceInFrame[0]; out.push(`the region is ${Math.round(b[2])}×${Math.round(b[3])} px${c.textHeight != null ? `, its smallest text ${c.textHeight} px tall` : ""}`); }
  else if (c.faceInFrame.length) out.push(`the ${c.faceInFrame.length > 1 ? "smallest " : ""}face is ${c.faceHeight} px tall (${pct(c.faceHeight / ctx.H)} of the frame's height)`);
  if (c.circle) out.push(`the webcam's circle (${c.circle.d} px) ${c.circle.corner}${c.circle.corner !== c.circle.first ? `, not ${c.circle.first}: the region would not fit beside it there with the screen filling the frame` : ""}${c.circle.d < c.circle.size ? `, smaller than its ${c.circle.size} px` : ""}`);
  out.push(c.ground ? `${pct(c.ground)} of the frame is ground` : "the picture fills the frame");
  const soft = c.problems.filter((q) => q.level === "soft" && q.code !== "enlarged");
  if (soft.length) out.push(`soft: ${soft.map((q) => `${q.of} ${q.what}`).join("; ")}`);
  out.push(`cost ${c.cost} (${costText(c.terms)})`);
  return out;
}
const TERM = { enlargement: "enlargement", ground: "ground", subject: "subject", soft: "soft problems", text: "text away", hook: "hook smaller" };
const signed = (v) => `${v < 0 ? "−" : "+"}${Math.abs(v)}`;
const costText = (terms) => Object.entries(terms).filter(([, v]) => v).map(([k, v]) => `${TERM[k]} ${signed(v)}`).join(", ") || "no term";
const CRIT = ["it has a hard problem", "it leaves a need unmet", "it leaves a person out and no speaker is named", "it splits two people who stand close together into two parts"];
function behind(c, top) {
  for (let i = 0; i < CRIT.length; i++) if (c.rank[i] !== top.rank[i]) return `behind the first because ${CRIT[i]}`;
  const d = Math.round((c.cost - top.cost) * 1000) / 1000;
  if (!d) return c.variant !== top.variant ? "equal in cost to the first, further from the usual hold" : "equal to the first";
  // the terms that put it behind, the largest first
  const diff = Object.keys(TERM).map((k) => [k, Math.round(((c.terms[k] || 0) - (top.terms[k] || 0)) * 1000) / 1000]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  return `behind the first by ${d} points (${diff.map(([k, v]) => `${TERM[k]} +${v}`).join(", ")})`;
}
