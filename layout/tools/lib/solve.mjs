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
import { BROWS, MOUTH, featOf, noseOf } from "./placed.mjs";
import { pictureFits } from "./fits.mjs";
import { splitFits } from "./parts.mjs";
import { screenFits, screenStacked } from "./screen.mjs";
import { screenPanel as panelBelow } from "./screen-panel.mjs";

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

function solveOnce({ zones: Z, source = null, faces = [], sources = null, region = null, minTextHeight = 0, needs = [], set = {}, all = false, weights = null, speaker = null, merge = true, captionArea = null, pick = null, cover = null, screenPanel = null }) {
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
    // asked for only (--screen-panel): the screen above, the speaker's panel down to the caption line
    if (screenPanel) out.push(...panelBelow(ctx, camSrc, screenPanel, notes));
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
  if (screenPanel && !main.screen) notes.push("no screen-panel: it is built for a screen with a --region and its webcam as a second --source");
  const res = ranked(ctx, out, notes, { needs: captionArea ? [...needs.filter((n) => n.role !== "caption"), ctx.cap] : needs, srcs });
  if (screenPanel) res.screenPanel = ctx.panelVerdict || { offered: false, width: screenPanel.width || "frame", code: "screen", why: "it is built for a screen with a --region and its webcam as a second --source" };
  return pick ? pickSpeaker(ctx, res, cover) : res;
}

// The order for a picture of one speaker (pick: "speaker"), the rule best-takes and screencast-cut
// share: a picture that fills the frame beats a picture with ground around it, as long as eyes,
// nose and mouth stay inside the frame and the captions stay off the eyes and the nose, and off the
// mouth for most of the clip (DECISIONS.md of layout-data's rig, 2026-11-19: lean-169, close-45,
// nod-45).
//   0. the picture the caller draws today (cover: the frame covered), kept where it is enlarged at
//      most SPEAKER.coverMax (2×), the eyes, nose and mouth of every moment lie inside the frame (a
//      head whose hair or top the frame cuts while it nods passes; its hull is not held against
//      it), and it passes, or its one fault is the captions' band on the mouth for at most
//      SPEAKER.mouthAtMost of the face's time (never on the nose or the eyes): what worked stays as
//      it was, and a large face is no reason to leave it;
//   1. the pictures across the frame's full width (the frame covered, a crop over a ground) at 1×
//      or more (SPEAKER.wideFrom; at the covering scale where a source larger than the frame
//      covers it below 1×), the face nearest the usual size (weights.subject.to of the frame's
//      height: the upper end of published talking heads), larger or smaller alike; among equals
//      the caller's cover, then layout's order;
//   2. a picture of 1 whose one fault is the band on the mouth for at most SPEAKER.mouthAtMost of
//      the face's time, the fewest seconds first, the seconds said in `mouth` and the note (with the
//      narrower picture that passes, by name): one picture for the whole clip is the caller's, and a
//      lean of a few seconds is no reason to shrink all of it;
//   3. a picture narrower than the frame, or the source shrunk below 1× over a ground (an inset,
//      a band of the whole picture), in the same order: only where nothing of 0 to 2 passes, and
//      the result says so in a note (where the head moves across most of the picture, `drift`);
//   4. what does not pass, in layout's order (a cover that fails last).
// Passing: no hard problem (so never enlarged past enlarge.forbiddenFrom; for the caller's cover the
// apps' bars over the face do not count, nor the face's hull past the frame while its eyes, nose
// and mouth stay inside) and every need met; with a fixed caption band, captions that lie on the
// chin or in the margin layout keeps below a face pass too, as long as the band stays below every
// moment's mouth line (placed.mjs' MOUTH: the lower lip, from the head's proportions).
// mouthAtMost: the share of the face's time the band may lie on the mouth, counted from the band's
// top (as high as its lines can be) against each moment's mouth line. The count is too high where
// the captions take fewer lines than the band holds, or none between phrases: on screencast-cut's
// public test in 16:9 (every caption one line, its ink from y 840 where the band begins at 772) it
// said 5.2 of 8.8 s where the render showed 3.5 s; how many lines each caption takes the captions
// skill does not say. Until it does, two thirds (decided: the inset only where the band lies on
// the mouth for more than half of a keep by an honest count).
// coverMax: 2×, the enlargement layout forbids above (weights.enlarge.forbiddenFrom); 1.875× of a
// 720p webcam is the softness the 4:5 crop has in 9:16, accepted there.
// drift: where nothing across the width passes because the face's boxes over the clip span at
// least DRIFT times its usual width, the note says that the head moves across the picture and that
// a clip cut where it moves gets larger pictures.
export const SPEAKER = { coverMax: 2, wideFrom: 0.99, mouthAtMost: 2 / 3, drift: 2 };

function pickSpeaker(ctx, res, cover) {
  const { W, H, D } = ctx, main = ctx.sources[0], CA = ctx.captionArea;
  if (main.screen || ctx.sources.length > 1) throw new Error("--pick speaker orders the pictures of one recording with a speaker in it: leave it out for a screen or for two files.");
  const usual = D.weights.subject.to / 100, coverMax = Math.min(SPEAKER.coverMax, D.weights.enlarge.forbiddenFrom);
  const most = SPEAKER.mouthAtMost, mostSaid = Math.abs(most - 2 / 3) < 1e-6 ? "two thirds" : Math.abs(most - 0.5) < 1e-6 ? "half" : `${Math.round(most * 100)} %`;
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
  // a moving face's moments in time, each standing for half the gap to its neighbours (the first
  // and the last as far out as in): the seconds the band lies on its mouth
  const timed = (main.given || []).flatMap((g) => (g.at ? [...g.at].sort((a, b) => a.t - b.t) : [])), steps = timed.map((m, i, l) => {
    const before = i ? (m.t - l[i - 1].t) / 2 : null, after = i < l.length - 1 ? (l[i + 1].t - m.t) / 2 : null;
    return [m.t - (before ?? after ?? 0), m.t + (after ?? before ?? 0)];
  });
  const onMouth = (c) => {
    if (!CA || c.parts || !timed.length) return null;
    let seconds = 0, from = null, to = null;
    const all = steps.reduce((a, [p, q]) => a + q - p, 0);
    timed.forEach((m, i) => {
      const b = m.box, x0 = c.left + c.scale * b[0], x1 = x0 + c.scale * b[2];
      if (x1 <= CA.left || x0 >= CA.left + CA.width || c.top + c.scale * (b[1] + MOUTH * b[3]) <= CA.top + 1e-6) return;
      seconds += steps[i][1] - steps[i][0]; from ??= m.t; to = m.t;
    });
    // a single moment stands for all of the face's time
    const share = all > 0 ? seconds / all : seconds > 0 || from !== null ? 1 : 0;
    return from === null ? null : { seconds: r1(seconds), of: r1(all), share: r2(share), from, to };
  };
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
  // the eyes (from BROWS of the head down), the nose and the mouth (to the mouth line) of every
  // moment inside the frame
  const featuresIn = (c) => !c.parts && moments.every((b) => {
    const e = featOf({ box: b }), x0 = c.left + c.scale * e[0], x1 = x0 + c.scale * e[2], y0 = c.top + c.scale * (b[1] + BROWS * b[3]), y1 = c.top + c.scale * (b[1] + MOUTH * b[3]);
    return x0 >= -0.5 && x1 <= W + 0.5 && y0 >= -0.5 && y1 <= H + 0.5;
  });
  // whether the band reaches the nose (or above it) at any moment of a face over it
  const onNose = (c) => !!CA && !c.parts && moments.some((b) => {
    const x0 = c.left + c.scale * b[0], x1 = x0 + c.scale * b[2];
    return !(x1 <= CA.left || x0 >= CA.left + CA.width) && c.top + c.scale * noseOf({ box: b }) > CA.top + 1e-6;
  });
  const pct0 = (v) => `${Math.round(v * 100)} %`;
  for (const x of list) {
    const c = x.c, face = c.faceHeight / H, low = lowest(c);
    const other = c.unmet.filter((u) => u !== "caption");
    const capOk = !c.unmet.includes("caption") || (low && low.mouth <= CA.top + 1e-6);
    // (the caller's cover is held to what it promised: at most 2×, the eyes, nose and mouth in the
    // frame and the text off the face; the apps' bars over a head that fills the frame are said,
    // not held against it: a phone's own take is filmed so, and its caller raises it under the
    // text; nor is the head's top or hair the frame cuts while the features stay inside)
    const fin = x.cover && featuresIn(c);
    x.cut = fin && c.problems.some((q) => q.level === "hard" && q.code === "off-frame" && q.kind === "face");
    const hard = c.problems.filter((q) => q.level === "hard" && !(x.cover && q.kind === "face" && (q.code === "covered" || (q.code === "off-frame" && fin))));
    x.passes = !hard.length && !other.length && capOk;
    x.wide = !c.parts && c.fit !== "inset" && c.window[0] <= 0.5 && c.window[0] + c.window[2] >= W - 0.5;
    x.off = Math.abs(face - usual);
    x.face = face;
    const capSaid = c.unmet.includes("caption") ? (capOk ? `; the captions ${low.chin > CA.top ? "on the chin" : "in the margin kept below the face"}, clear of the mouth` : low && low.mouth > CA.top ? "; the captions on the mouth, the nose or the eyes" : "") : "";
    const fails = () => `does not pass (${[...hard.map((q) => `${q.of} ${q.what}`), ...other.map((u) => `no place for the ${u}`), ...(capOk ? [] : [low && low.mouth > CA.top ? `the captions' band lies on the mouth, the nose or the eyes (the mouth line at y ${Math.round(low.mouth)}, the band from ${CA.top})` : "no place for the captions"])].join("; ")})`;
    // the cover kept: at most 2× and the eyes, nose and mouth inside the frame at every moment
    const keeps = fin && c.scale <= coverMax + 1e-6;
    x.big = x.wide && c.scale >= wideFrom;
    // a picture across the width whose one fault is the band on the mouth (never the nose or the
    // eyes) for at most mouthAtMost of the face's time: kept (the cover) or before the narrower
    // pictures, its seconds said (one picture for the clip)
    x.mouth = !x.passes && x.big && !hard.length && !other.length && low && low.mouth > CA.top ? onMouth(c) : null;
    x.partly = !!x.mouth && x.mouth.share <= most + 1e-9 && !onNose(c);
    x.tier = x.passes ? (keeps ? 0 : x.big ? 1 : 3) : x.partly ? (keeps ? 0 : 2) : 4;
    const bars = hard.length < c.hard ? "; the apps' bars lie over the face" : "";
    const top = x.cut ? "; the frame cuts the head's top at some moments, its eyes, nose and mouth inside at every one" : "";
    const lean = x.partly ? `but the captions' band lies on the mouth for ${x.mouth.seconds} s of the face's ${x.mouth.of} s (${x.mouth.from}–${x.mouth.to} s), at most ${mostSaid}` : "";
    x.why = x.cover
      ? (x.partly && keeps ? `the frame covered as the caller draws it, enlarged ${c.scale}×, the face ${pct0(face)} of the height${top}, ${lean}: it stays for all of it`
        : x.partly ? `the frame covered as the caller draws it, enlarged ${c.scale}×, the face ${pct0(face)} of the height, ${lean}: kept before the narrower pictures`
        : !x.passes ? `the frame covered as the caller draws it ${fails()}`
        : keeps ? `the frame covered as the caller draws it, enlarged ${c.scale}×, the face ${pct0(face)} of the height, passes${capSaid}${bars}${top}: it stays`
        : `the frame covered as the caller draws it passes, enlarged ${c.scale}×, the face ${pct0(face)} of the height${capSaid}${bars}; it is kept outright only up to ${coverMax}× with the eyes, nose and mouth inside the frame at every moment, so it is ranked among the pictures across the frame's width (the usual face ${pct0(usual)})`)
      : x.partly ? `spans the frame's width, the face ${pct0(face)} of the height, ${lean}: kept before the narrower pictures`
      : !x.passes ? fails()
      : x.big ? `spans the frame's width, the face ${pct0(face)} of the height (the usual ${pct0(usual)})${capSaid}`
      : `${c.fit === "inset" ? `the whole picture ${c.scale < 1 ? "shrunk to" : "at"} ${c.scale}× over a ground` : x.wide ? `spans the frame's width shrunk to ${c.scale}× over a ground` : "narrower than the frame"}, the face ${pct0(face)} of the height${capSaid}: only where nothing across the frame's width at ${wideSaid} or more passes`;
  }
  // among equals the caller's cover first where it passes (what worked stays), last where it fails
  const by = (a, b) => a.tier - b.tier || (a.tier === 2 ? a.mouth.seconds - b.mouth.seconds : 0) || (a.tier >= 1 && a.tier <= 3 ? a.off - b.off : 0) || ((a.cover ? 1 : 0) - (b.cover ? 1 : 0)) * (a.tier === 4 ? 1 : -1) || a.n - b.n;
  const order = list.sort(by);
  const out = order.map((x, i) => {
    const c = x.c;
    delete c.behind;
    c.pick = { place: i + 1, layout: x.n, passes: x.passes, ...(x.cover ? { cover: true } : {}), across: x.wide, tier: x.tier, face: +x.face.toFixed(3), ...(x.mouth ? { mouth: x.mouth } : {}), ...(x.partly ? { partly: true } : {}), ...(x.cut ? { headCut: true } : {}), why: x.why };
    return c;
  });
  const first = order[0], nameOf = (c) => `${c.fit}${c.crop ? ` ${c.crop}` : ""}${c.closer ? " closer" : ""}${c.onGround ? ", text on the ground" : ""}`;
  // a head that moves across most of the picture: the pictures across the width fail on the face
  // (outside the frame, under the apps' buttons), and its boxes span DRIFT times its usual width
  const track = (main.given || []).find((g) => g.track)?.track;
  const drift = first.tier === 3 && track && track.hull[2] >= SPEAKER.drift * track.usual[2]
    && order.some((y) => y.big && !y.passes && y.c.problems.some((q) => q.level === "hard" && q.kind === "face" && ["off-frame", "covered", "cut"].includes(q.code)))
    ? { from: r2(track.hull[0] / ctx.sw), to: r2((track.hull[0] + track.hull[2]) / ctx.sw), across: r2(track.hull[2] / ctx.sw), usual: r2(track.usual[2] / ctx.sw) } : null;
  const note = first.partly ? (() => {
      const smaller = order.find((y) => y.tier === 3);
      return `for a speaker: the first, ${nameOf(first.c)} at ${first.c.scale}× across the frame's width, has the captions' band on the mouth for ${first.mouth.seconds} s of the face's ${first.mouth.of} s (${first.mouth.from}–${first.mouth.to} s), at most ${mostSaid}, and is kept for all of it; to give those seconds another picture, cut the clip where they start${smaller ? `, or take ${nameOf(smaller.c)} at ${smaller.c.scale}× (it passes, the face ${pct0(smaller.face)} of the height) for all of it` : ""}`;
    })()
    : drift ? `for a speaker: the head moves across ${pct0(drift.across)} of the picture's width during the clip (its boxes from ${pct0(drift.from)} to ${pct0(drift.to)} of it, the face itself ${pct0(drift.usual)} wide), so no picture across the frame's full width holds it: the first is ${first.c.fit === "inset" ? `the whole picture ${first.c.scale < 1 ? "shrunk to" : "at"} ${first.c.scale}× over a ground` : `${nameOf(first.c)} ${first.c.scale < 1 ? "shrunk to" : "at"} ${first.c.scale}× over a ground`} (the face ${pct0(first.face)} of the height); cut the clip where the head moves, and each part gets a larger picture`
    : !first.passes ? `for a speaker: nothing passes, so the first is ${nameOf(first.c)} at ${first.c.scale}× (${first.why.replace(/^does not pass \((.*)\)$/, "$1")}): look at its page and give the captions another place, or name a candidate`
    : first.tier === 3 ? `for a speaker: no picture across the frame's full width passes at ${wideSaid} or more, so the first is ${first.c.fit === "inset" ? `the whole picture ${first.c.scale < 1 ? "shrunk to" : "at"} ${first.c.scale}× over a ground` : first.wide ? `${nameOf(first.c)} shrunk to ${first.c.scale}× over a ground` : `${nameOf(first.c)}, narrower than the frame`} (the face ${pct0(first.face)} of the height): look at its page, and where the face is too small there, name a wider candidate below with its problem in mind or give the captions another place`
    : null;
  return { ...res, pick: { for: "speaker", usual, mouthAtMost: r2(most), ...(cover ? { cover: { scale: cover.scale, left: cover.left, top: cover.top } } : {}), first: nameOf(first.c), ...(drift ? { drift } : {}), ...(note ? { note } : {}) }, candidates: out };
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
    if (c.stack) c.why.splice(c.why.length - 1, 0, ...c.stack.says);
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
