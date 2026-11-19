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
//       captionArea  a band the captions stand in already ({ left, width, top, bottom, size, lines }
//                 in px of the frame, captions' area.json): the captions go there or have no
//                 place, and the picture is placed around them; none: the solver finds their place
//       pick      "speaker": the candidates in the order for a picture of one speaker (pickSpeaker
//                 below), each with its `pick`, the result with `pick`; none: layout's own order
//       cover     { scale, left, top }: with pick, the picture the caller draws today covering the
//                 frame, judged as the candidate "cover" and first wherever it passes
//       set       { "dotted.key": value } over the defaults; weights: readWeights(file)
//   trackFace(moments) → a moving face's hull and usual box
//   alike(a, b, px, ds) → whether two candidates show the same frame to the eye (DEFAULTS.same)
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
import { cmpRank, evaluate } from "./evaluate.mjs";
import { MOUTH } from "./placed.mjs";
import { pictureFits } from "./fits.mjs";
import { splitFits } from "./parts.mjs";
import { screenFits, screenStacked } from "./screen.mjs";

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

// What another first candidate changes against the first, in words: another fit, or the same fit
// at another scale, moved, its text elsewhere
const fitName = (c) => `${c.fit}${c.crop ? ` ${c.crop}` : ""}${c.closer ? " closer" : ""}${c.speaker ? ` on face ${c.speaker}` : ""}`;
function whatChanges(alt, cur) {
  if (fitName(alt) !== fitName(cur)) return `another candidate would come first: ${fitName(alt)} at ${alt.parts ? alt.parts.map((q) => `${q.scale}×`).join(" and ") : `${alt.scale}×`} instead of ${fitName(cur)}`;
  const out = [], sa = alt.parts ? alt.parts.map((q) => q.scale) : [alt.scale], sc = cur.parts ? cur.parts.map((q) => q.scale) : [cur.scale];
  if (sa.some((v, i) => Math.abs(v - sc[i]) > 1e-4)) out.push(`the picture at ${sa.join(" and ")}× instead of ${sc.join(" and ")}×`);
  const pa = alt.parts || [alt], pc = cur.parts || [cur];
  pa.forEach((q, i) => {
    const dx = Math.round(q.left - pc[i].left), dy = Math.round(q.top - pc[i].top), part = pa.length > 1 ? ` of part ${i + 1}` : "";
    if (dx || dy) out.push(`the picture${part} ${[dx ? `${Math.abs(dx)} px ${dx < 0 ? "further left" : "further right"}` : "", dy ? `${Math.abs(dy)} px ${dy < 0 ? "higher" : "lower"}` : ""].filter(Boolean).join(" and ")}`);
  });
  alt.text.forEach((t) => {
    const u = cur.text.find((x) => x.role === t.role);
    if (!u) out.push(`the ${t.role} placed ${t.where}`);
    else if (u.where !== t.where) out.push(`the ${t.role} ${t.where} instead of ${u.where}`);
    else if (Math.round(t.box[1] - u.box[1])) out.push(`the ${t.role} ${Math.abs(Math.round(t.box[1] - u.box[1]))} px ${t.box[1] < u.box[1] ? "higher" : "lower"}`);
  });
  for (const u of cur.text) if (!alt.text.some((t) => t.role === u.role)) out.push(`no place for the ${u.role}`);
  return `the first candidate stays ${fitName(cur)} but ${out.length ? out.join(", ") : "moves by less than a px"}`;
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
    const tf = trackFace(Array.isArray(f) ? f : f.at), info = { face: n, source: si + 1, ...tf.track, times: tf.at.map((m) => m.t), boxes: tf.at.map((m) => ({ t: m.t, box: m.box })), placed: short(res.candidates[0]), decides: [] };
    const by = new Map();
    for (const [edge, t] of Object.entries(tf.track.edges)) by.set(t, [...(by.get(t) || []), edge]);
    for (const [t, edges] of by) {
      const less = tf.at.filter((m) => m.t !== t);
      if (!less.length) continue;
      const alt = solveOnce({ ...args, source: undefined, faces: undefined, sources: list.map((q2, i2) => ({ size: q2.size, faces: (q2.faces || []).map((f2, j2) => (i2 === si && j2 === fi ? less : f2)) })) }).candidates[0];
      if (sig(alt) !== sig(res.candidates[0])) info.decides.push({ t, edges, without: short(alt), says: whatChanges(alt, res.candidates[0]), change: Math.round(changeOf(alt, res.candidates[0])) });
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

function solveOnce({ zones: Z, source = null, faces = [], sources = null, region = null, minTextHeight = 0, needs = [], set = {}, all = false, weights = null, speaker = null, merge = true, captionArea = null, pick = null, cover = null }) {
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
    W, H, Z, D, sw, sh, s0, merge: merge && !all, faces: main.faces, fb: main.faces.length ? hullOf(main.faces) : null, sources: srcs, tall: W <= H, speakerNamed: speaker != null, speakerFace: speaker != null ? speaker - 1 : null,
    cap: needs.find((n) => n.role === "caption") || null, hook: needs.find((n) => n.role === "hook") || null,
  };
  // a fixed band holds the captions in its own lines
  if (captionArea) Object.assign(ctx, { captionArea, cap: { role: "caption", lines: captionArea.lines } });
  const rs = sw / sh, rf = W / H, same = Math.abs(rs / rf - 1) < 0.02;
  const out = [], notes = [];
  ctx.readable = D.readable.height * W / D.readable.per;
  if (main.screen) {
    // a screen and its region; the webcam: the second source's face, or a face given with the screen
    // (a face given with the screen is a webcam baked into the screen recording: the circle shows
    // that part of the screen's own picture)
    const cam = srcs[1] ? { size: srcs[1].size, face: srcs[1].faces[0] || null } : main.webcam ? { size: main.size, face: main.webcam, baked: true } : null;
    if (cam?.baked) ctx.baked = cam.face;
    // the webcam as a source of its own, for the panel below the screen (baked: the screen's file)
    const camSrc = srcs[1] ? { ...srcs[1], label: "webcam" } : cam ? { size: main.size, faces: [cam.face], heights: [cam.face[3]], first: 0, label: "webcam", baked: true } : null;
    ctx.sources = camSrc ? [main, camSrc] : [main];
    out.push(...screenFits(ctx, cam, notes));
    if (camSrc?.faces[0]) out.push(...screenStacked(ctx, camSrc, notes));
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
        // close: about the same size (the same distance from the camera: the smaller face at least
        // `D.togetherSize` of the larger) and near each other both ways, the gaps between their
        // boxes measured against their mean face: across at most `together` widths, up or down at
        // most one height
        const [a, b] = order.map((i) => main.faces[i]);
        const mw = (a[2] + b[2]) / 2, mh = (a[3] + b[3]) / 2, size = Math.min(a[3], b[3]) / Math.max(a[3], b[3]);
        const gx = Math.max(0, b[0] - X1(a)), gy = Math.max(0, Math.max(a[1], b[1]) - Math.min(Y1(a), Y1(b)));
        if (size >= D.togetherSize && gx <= D.together * mw && gy <= mh) {
          ctx.close = true;
          notes.push(`faces 1 and 2 stand close together: about the same size (the smaller ${pct(size)} of the larger; same distance from the camera from ${pct(D.togetherSize)}), their boxes ${Math.round(gx)} px apart across (${r2(gx / mw)} of their mean width; close up to ${D.together}) and ${Math.round(gy)} px up or down (close up to one face's height). One picture holds both, so stacked, which would split them into two halves of the same shot, is listed behind every candidate that shows both in one picture. Stacking is for people far apart, at different distances, or filmed apart`);
        }
        out.push(...splitFits(ctx, "stacked", order.map((i) => ({ src: 0, own: [i] }))));
      } else if (main.faces.length > 2) notes.push(`stacked parts are built for two people, not for ${main.faces.length}`);
    }
  }
  const res = ranked(ctx, out, notes, { needs: captionArea ? [...needs.filter((n) => n.role !== "caption"), ctx.cap] : needs, srcs });
  return pick ? pickSpeaker(ctx, res, cover) : res;
}

// The order for a picture of one speaker (pick: "speaker"), the rule best-takes and screencast-cut
// share: an editor fills the frame's width before anything else and keeps the captions off the
// eyes, nose and mouth.
//   1. the picture the caller draws today (cover: the frame covered), kept outright where it
//      passes, is enlarged no more than layout's crisp limit (weights.enlarge.softFrom, 1.5×) and
//      holds the face at most SPEAKER.coverFace of the frame's height: what worked stays as it was;
//   2. the pictures across the frame's full width (the frame covered, a crop over a ground) at 1×
//      or more (SPEAKER.wideFrom; at the covering scale where a source larger than the frame
//      covers it below 1×), the caller's cover among them up to 2×, the face nearest the usual
//      size (weights.subject.to of the frame's height: the upper end of published talking heads),
//      larger or smaller alike; among equals the caller's cover, then layout's order;
//   3. a picture narrower than the frame, or the source shrunk below 1× over a ground (an inset,
//      a band of the whole picture), in the same order: only where nothing of 1 and 2 passes, and
//      the result says so in a note;
//   4. what does not pass, in layout's order (a cover that fails last).
// Passing: no hard problem (so never enlarged past enlarge.forbiddenFrom; for the caller's cover the
// apps' bars over the face do not count) and every need met; with
// a fixed caption band, captions that lie on the chin or in the margin layout keeps below a face
// pass too, as long as the band stays below every moment's mouth line (placed.mjs' MOUTH: the
// lower lip, from the head's proportions).
// coverFace: a face over 45 % of the frame's height is larger than a speaker's picture needs; it is
// a judgement (published Shorts keep it at 34 % or less in three of four: the upper quartile, the
// weights' subject.to), set on screencast-cut's close webcam in 4:5, whose cover at 1.875× held
// the face at 53 % with the captions on the chin, where the square at 1.5× holds it at 39 %.
export const SPEAKER = { coverFace: 0.45, wideFrom: 0.99 };

function pickSpeaker(ctx, res, cover) {
  const { W, H, D } = ctx, main = ctx.sources[0], CA = ctx.captionArea;
  if (main.screen || ctx.sources.length > 1) throw new Error("--pick speaker orders the pictures of one recording with a speaker in it: leave it out for a screen or for two files.");
  const usual = D.weights.subject.to / 100, keepScale = D.weights.enlarge.softFrom;
  // across the width at 1× or more; a source larger than the frame covers it below 1×
  const wideFrom = SPEAKER.wideFrom * Math.min(1, ctx.s0), wideSaid = ctx.s0 < 1 ? `${r2(ctx.s0)}×, the scale that covers the frame,` : "1×";
  const list = res.candidates.map((c, i) => ({ c, n: i + 1 }));
  if (cover) {
    const { scale: s, left, top } = cover;
    if (!(s > 0) || left > 0.5 || top > 0.5 || left + s * ctx.sw < W - 0.5 || top + s * ctx.sh < H - 0.5) throw new Error(`--cover ${s},${left},${top} does not cover the frame of ${W}×${H} with the source of ${ctx.sw}×${ctx.sh}: give the scale, left and top of the picture as you draw it covering the frame.`);
    const c = evaluate(ctx, { fit: "cover", s, left, top, win: [0, 0, W, H] });
    c.score = c.hard || c.unmet.length ? 0 : +(100 - c.cost).toFixed(3);
    c.why = why(c, ctx);
    list.push({ c, n: 0, cover: true });
  }
  // every moment of every face, in px of the source: the band is judged against each
  const moments = (main.given || []).flatMap((g) => (g.at ? g.at.map((m) => m.box) : [g.box]));
  const lowest = (c) => {
    let mouth = -Infinity, chin = -Infinity;
    if (!CA || c.parts) return null;
    for (const b of moments) {
      const x0 = c.left + c.scale * b[0], x1 = x0 + c.scale * b[2], y = c.top + c.scale * b[1], h = c.scale * b[3];
      if (x1 <= CA.left || x0 >= CA.left + CA.width) continue;
      mouth = Math.max(mouth, y + MOUTH * h); chin = Math.max(chin, y + h);
    }
    return { mouth, chin };
  };
  const pct0 = (v) => `${Math.round(v * 100)} %`;
  for (const x of list) {
    const c = x.c, face = c.faceHeight / H, low = lowest(c);
    const other = c.unmet.filter((u) => u !== "caption");
    const capOk = !c.unmet.includes("caption") || (low && low.mouth <= CA.top + 1e-6);
    // (the caller's cover is held to what it promised: at most 2× and the text off the face; the
    // apps' bars over a head that fills the frame are said, not held against it: a phone's own
    // take is filmed so, and its caller raises it under the text)
    const hard = c.problems.filter((q) => q.level === "hard" && !(x.cover && q.code === "covered" && q.kind === "face"));
    x.passes = !hard.length && !other.length && capOk;
    x.wide = !c.parts && c.fit !== "inset" && c.window[0] <= 0.5 && c.window[0] + c.window[2] >= W - 0.5;
    x.off = Math.abs(face - usual);
    x.face = face;
    const capSaid = c.unmet.includes("caption") ? (capOk ? `; the captions ${low.chin > CA.top ? "on the chin" : "in the margin kept below the face"}, clear of the mouth` : low && low.mouth > CA.top ? "; the captions on the mouth, the nose or the eyes" : "") : "";
    const fails = () => `does not pass (${[...hard.map((q) => `${q.of} ${q.what}`), ...other.map((u) => `no place for the ${u}`), ...(capOk ? [] : [low && low.mouth > CA.top ? `the captions' band lies on the mouth, the nose or the eyes (the mouth line at y ${Math.round(low.mouth)}, the band from ${CA.top})` : "no place for the captions"])].join("; ")})`;
    // the cover outright: crisp and the face not larger than a speaker needs
    const outright = x.cover && c.scale <= keepScale + 1e-6 && face <= SPEAKER.coverFace + 1e-9;
    x.big = x.wide && c.scale >= wideFrom;
    x.tier = !x.passes ? 3 : outright ? 0 : x.big ? 1 : 2;
    const bars = hard.length < c.hard ? "; the apps' bars lie over the face" : "";
    x.why = x.cover
      ? (!x.passes ? `the frame covered as the caller draws it ${fails()}`
        : outright ? `the frame covered as the caller draws it, enlarged ${c.scale}×, the face ${pct0(face)} of the height, passes${capSaid}${bars}: it stays`
        : `the frame covered as the caller draws it passes, enlarged ${c.scale}×, the face ${pct0(face)} of the height${capSaid}${bars}; it stays outright only up to ${keepScale}× and a face of ${pct0(SPEAKER.coverFace)}, so it is ranked among the pictures across the frame's width (the usual face ${pct0(usual)})`)
      : !x.passes ? fails()
      : x.big ? `spans the frame's width, the face ${pct0(face)} of the height (the usual ${pct0(usual)})${capSaid}`
      : `${c.fit === "inset" ? `the whole picture ${c.scale < 1 ? "shrunk to" : "at"} ${c.scale}× over a ground` : x.wide ? `spans the frame's width shrunk to ${c.scale}× over a ground` : "narrower than the frame"}, the face ${pct0(face)} of the height${capSaid}: only where nothing across the frame's width at ${wideSaid} or more passes`;
  }
  // among equals the caller's cover first where it passes (what worked stays), last where it fails
  const by = (a, b) => a.tier - b.tier || (a.tier === 1 || a.tier === 2 ? a.off - b.off : 0) || ((a.cover ? 1 : 0) - (b.cover ? 1 : 0)) * (a.tier === 3 ? 1 : -1) || a.n - b.n;
  const order = list.sort(by);
  const out = order.map((x, i) => {
    const c = x.c;
    delete c.behind;
    c.pick = { place: i + 1, layout: x.n, passes: x.passes, ...(x.cover ? { cover: true } : {}), across: x.wide, tier: x.tier, face: +x.face.toFixed(3), why: x.why };
    return c;
  });
  const first = order[0], nameOf = (c) => `${c.fit}${c.crop ? ` ${c.crop}` : ""}${c.closer ? " closer" : ""}${c.onGround ? ", text on the ground" : ""}`;
  const note = !first.passes ? `for a speaker: nothing passes, so the first is ${nameOf(first.c)} at ${first.c.scale}× (${first.why.replace(/^does not pass \((.*)\)$/, "$1")}): look at its page and give the captions another place, or name a candidate`
    : first.tier === 2 ? `for a speaker: no picture across the frame's full width passes at ${wideSaid} or more, so the first is ${first.c.fit === "inset" ? `the whole picture ${first.c.scale < 1 ? "shrunk to" : "at"} ${first.c.scale}× over a ground` : first.wide ? `${nameOf(first.c)} shrunk to ${first.c.scale}× over a ground` : `${nameOf(first.c)}, narrower than the frame`} (the face ${pct0(first.face)} of the height): look at its page, and where the face is too small there, name a wider candidate below with its problem in mind or give the captions another place`
    : null;
  return { ...res, pick: { for: "speaker", usual, ...(cover ? { cover: { scale: cover.scale, left: cover.left, top: cover.top } } : {}), first: nameOf(first.c), ...(note ? { note } : {}) }, candidates: out };
}

// rank, and say why
function ranked(ctx, out, notes, { needs, srcs }) {
  const { Z, D } = ctx, main = srcs[0];
  const seen = new Set();
  const sorted = out.filter((c) => { delete c.full; return true; }).filter((c) => { const k = `${c.fit}|${c.scale}|${c.left}|${c.top}|${c.window}|${c.speaker || ""}|${JSON.stringify(c.parts || "")}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort(cmpRank);
  // a candidate a viewer cannot tell from one before it is that one (DEFAULTS.same); --all keeps
  // them, and so does merge: false (the tests, to look at one fit)
  const cands = [];
  for (const c of sorted) {
    const twin = !ctx.merge ? null : cands.find((k) => alike(k, c, D.same.px * Math.min(ctx.W, ctx.H), D.same.scale));
    if (twin) (twin.alike ||= []).push({ fit: c.fit, ...(c.crop ? { crop: c.crop } : {}), ...(c.speaker ? { speaker: c.speaker } : {}), scale: c.scale, left: c.left, top: c.top, apart: Math.round(apart(twin, c)) });
    else cands.push(c);
  }
  // the score: 100 less the cost for a candidate that passes (so that larger is better and the
  // distance between two is the difference of their costs in points), 0 for one that does not
  cands.forEach((c, i) => {
    c.score = c.hard || c.unmet.length ? 0 : +(100 - c.cost).toFixed(3);
    c.why = why(c, ctx);
    if (i) c.behind = behind(c, cands[0]);
  });
  return {
    frame: Z.frame, size: Z.size, platforms: Z.platforms.map((p) => p.name), fallback: Z.fallback,
    source: main.size, faces: main.faces,
    ...(main.screen ? { screen: { region: main.faces[0], minTextHeight: main.minText, readable: r1(ctx.readable) } } : {}),
    // the sources in the order given; a screen's webcam is the second (baked: the screen's own file)
    ...(ctx.sources.length > 1 ? { sources: ctx.sources.map((q) => ({ size: q.size, faces: q.faces, ...(q.screen ? { screen: true } : {}), ...(q.baked ? { baked: true } : {}) })) } : {}),
    needs, ...(ctx.captionArea ? { captionArea: ctx.captionArea } : {}), defaults: D, notes, candidates: cands,
  };
}

// whether two candidates show the same frame to the eye: their scales within `ds`, the picture,
// its window, the parts, the circle and the text within `px`; apart: how far, in px
const boxesOf = (c) => [[c.left, c.top], c.window, ...(c.parts || []).flatMap((q) => [[q.left, q.top], q.window]), ...(c.circle ? [c.circle.box] : []), ...c.text.map((t) => t.box)];
function apart(a, b) { const A = boxesOf(a), B = boxesOf(b); return Math.max(...A.map((x, i) => Math.max(...x.map((v, k) => Math.abs(v - B[i][k]))))); }
export function alike(a, b, px, ds) {
  const scales = (c) => (c.parts ? c.parts.map((q) => q.scale) : [c.scale]);
  const sa = scales(a), sb = scales(b);
  if (sa.length !== sb.length || sa.some((v, i) => Math.abs(v / sb[i] - 1) > ds)) return false;
  if (!!a.circle !== !!b.circle || a.text.length !== b.text.length || a.text.some((t, i) => t.role !== b.text[i].role || t.style !== b.text[i].style || t.font !== b.text[i].font)) return false;
  if (a.hard !== b.hard || a.unmet.length !== b.unmet.length) return false;
  return boxesOf(a).length === boxesOf(b).length && apart(a, b) <= px;
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
  else if (c.faceInFrame.length) out.push(`the ${ctx.speakerFace != null ? `speaker's face (face ${ctx.speakerFace + 1})` : `${c.faceInFrame.length > 1 ? "smallest " : ""}face`} is ${c.faceHeight} px tall (${pct(c.faceHeight / ctx.H)} of the frame's height)`);
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
  if (!d) return c.rank[5] !== top.rank[5] ? "equal in cost to the first, which is the crop made for the speaker" : c.variant !== top.variant ? "equal in cost to the first, further from the usual hold" : "equal to the first";
  // the terms that put it behind, the largest first
  const diff = Object.keys(TERM).map((k) => [k, Math.round(((c.terms[k] || 0) - (top.terms[k] || 0)) * 1000) / 1000]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  return `behind the first by ${d} points (${diff.map(([k, v]) => `${TERM[k]} +${v}`).join(", ")})`;
}
