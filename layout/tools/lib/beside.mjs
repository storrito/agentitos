// Material beside a speaker who stays visible: a card, a quote, a screenshot or a clip that shows
// for a few seconds while the person who talks stays in the picture. A card is no recording: it
// is made (HTML) and can be laid out into any box, so the material gets a FIELD, a box of the
// frame to lay itself out in, never a fixed picture scaled into a room. A picture of fixed size (a
// screenshot, a clip) gets the largest box of its own shape in that room. The speaker is a crop of
// the same footage as before, placed in a field of its own.
//
//   besideSolve({ zones, source, face, material, needs, before, set }) → the result, as written
//       into placement.json (README: "Material beside the speaker")
//     source    [w, h] of the speaker's footage; face [x, y, w, h] in its px, or its moments
//               [{ t, box }, …] (a face that moves: held by the hull of its boxes)
//     material  { min: [w, h] the smallest field it needs, in px of the frame | null,
//                 ratio: the shape it prefers, width / height | null,
//                 fixed: [w, h] of a picture of fixed size | null }
//     needs     [{ role: "caption", lines }]
//     before    { scale, left, top, window? }: how the speaker filled the frame just before; none: the
//               source covering the frame on the face, as `place` covers it
//   printBeside(result, tool, folder) → the candidates in words, for the agent
//
// The arrangements, by the frame's shape:
//   above   the material above, the speaker as a panel below it, the captions on the seam: what
//           published Shorts do most where a screen and a face show together (the face below the
//           screen in 35 of 53 frames, 18.0 % of the frame's height tall: usual, not shown to work).
//           The panel is built as screen-stacked builds it; in place of a screen scaled until it
//           reads, the material gets everything above the seam that the face's panel leaves.
//           Upright frames, 4:5 and 1:1; in 16:9 (nothing measured) only where the material's field
//           still has its smallest size, behind the column.
//   pip     the material over the frame, the speaker as a circle in a corner of it (a small
//           picture in or at the screen: 9 of the 53 frames). Behind `above`, unless the panel
//           would leave the face under `beside.faceMin`.
//   column  16:9 only: the speaker as a tall column at one side, the material beside it (a sketch:
//           no published 16:9 video was measured; side by side over the frame's height was seen in
//           none of 1,200 upright frames)
// Every candidate's boxes go through judge (platform-zones' rules), as every other candidate's.

import { EPS, X1, Y1, area, inter, clipBox, grow, clamp, r1, r2, pct, boxText } from "./boxes.mjs";
import { DEFAULTS, merged, scaled } from "./defaults.mjs";
import { holdAxis } from "./fits.mjs";
import { judge } from "./judge.mjs";
import { trackFace } from "./solve.mjs";
import { captionHeight, keepOut, inkRows } from "./text.mjs";

// What this command assumes beyond the solver's defaults (`--set beside.faceMin=0.1`):
//   faceMin  0.12: a panel never leaves the speaker's face smaller than this share of the frame's
//            height; where the material needs more height, the circle stands first. It is the
//            median face of the frames that show a screen with a small picture of the speaker in
//            it (12.0 %, 12 frames of 240 published Shorts): usual, not shown to work.
//   column   1/3: in 16:9 the speaker's column takes a third of the width, the material two
//            thirds (the catalogue's sketch, never measured)
//   look     0.1: a face whose middle lies more than this share of the source's width off the
//            source's middle is taken to look towards the other side (a person framed off-centre
//            usually faces the open side): the speaker's column goes to the side that has the
//            material in their look. A guess, nothing measured.
//   pipCrop  2: the circle shows a square two face heights tall around the face (the circle beside a
//            screen shows three: head and shoulders), so that the face reads at its small size.
//            A guess.
//   face     0: the face's target in the panel and the column is the usual one (18 % of the
//            frame's height below a screen; 23 % in the 16:9 column). A share of the frame's height
//            from faceMin to 0.5 asks for another ("the person larger": --set beside.face=0.22);
//            a target under faceMin, or one no panel or column can hold, ends in one sentence.
export const BESIDE = { faceMin: 0.12, column: 1 / 3, look: 0.1, pipCrop: 2, face: 0 };

const ORDER = { tall: ["above", "pip"], mid: ["above", "pip"], wide: ["column", "above", "pip"] };
const NAMES = { above: "the material above, the speaker as a panel below it", pip: "the material over the frame, the speaker as a circle in its corner", column: "the speaker as a column at one side, the material beside it" };
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const mid = (b) => [b[0] + b[2] / 2, b[1] + b[3] / 2];

export function besideSolve({ zones: Z, source, face, material = {}, needs = [], before = null, set = {} }) {
  const [W, H] = Z.size;
  const D = scaled(merged({ ...DEFAULTS, beside: BESIDE }, set), Z.size);
  const S = Z.safe, g = D.gap, B = D.beside, WT = D.weights, soft = WT.enlarge.softFrom, forbidden = WT.enlarge.forbiddenFrom;
  const [sw, sh] = source;
  if (!(B.faceMin > 0 && B.faceMin < 1 && B.column > 0 && B.column < 1 && B.pipCrop > 0)) throw new Error("beside.faceMin and beside.column are shares of the frame (between 0 and 1), beside.pipCrop a number of face heights over 0.");
  // a face that moves is held by the hull of its boxes; its usual box says how large it is
  const moving = typeof face[0] !== "number";
  const tf = moving ? trackFace(face) : null;
  const hull = moving ? tf.box : face, usual = moving ? tf.track.usual : face;
  const fam = H >= 1.5 * W ? "tall" : W >= 1.5 * H ? "wide" : "mid";
  // the face's target asked for (none: the usual one of each arrangement), and what each could hold
  const asked = B.face > 0 ? B.face : null, holds = {};
  if (asked !== null && (asked < B.faceMin - 1e-9 || asked > 0.5)) throw new Error(`--set beside.face is the speaker's face as a share of the frame's height, from ${B.faceMin} (the least a panel gives it) to 0.5; ${asked} is outside that.`);
  const cap = needs.find((n) => n.role === "caption") || null, upright = W <= H;
  const capH = captionHeight({ cap, D, tall: upright }), capF = upright ? D.caption.font.tall : D.caption.font.wide;
  // what every feed's and grid's crop of the frame shows
  const crops = Z.crops || [];
  const cx0 = Math.max(0, ...crops.map((c) => c.box[0])), cx1 = Math.min(W, ...crops.map((c) => X1(c.box)));
  const cy0 = Math.max(0, ...crops.map((c) => c.box[1])), cy1 = Math.min(H, ...crops.map((c) => Y1(c.box)));
  const cropBox = [cx0, cy0, cx1 - cx0, cy1 - cy0];
  const mat = { min: material.min || null, ratio: material.fixed ? material.fixed[0] / material.fixed[1] : material.ratio || null, fixed: material.fixed || null };
  const notes = [], limits = { faceMin: Math.round(B.faceMin * H) }, most = {};
  const above = (fh) => Math.max(D.free.aboveMin, D.free.above * fh), below = (fh) => Math.max(D.free.belowMin, D.free.below * fh);
  const inFrame = (s, l, t, b) => [l + s * b[0], t + s * b[1], s * b[2], s * b[3]];
  const ux = usual[0] + usual[2] / 2, ue = usual[1] + D.eyes * usual[3];

  // the speaker just before, full-frame: as the caller gives it, else the source covering the
  // frame, the face in the middle across and its eyes a third down
  const s0 = Math.max(W / sw, H / sh);
  const prev = before ? { scale: before.scale, left: before.left, top: before.top, window: before.window || [0, 0, W, H], given: true }
    : { scale: r4(s0), left: r1(clamp(W / 2 - s0 * ux, W - s0 * sw, 0)), top: r1(clamp(H / 3 - s0 * ue, H - s0 * sh, 0)), window: [0, 0, W, H], given: false };
  const prevFace = inFrame(prev.scale, prev.left, prev.top, usual);

  // The material's field in a room: all of it, or the largest box of the shape it prefers (a
  // picture of fixed size: its own), in the room's middle.
  const fieldIn = (room) => {
    if (!mat.ratio) return room;
    const w = Math.min(room[2], room[3] * mat.ratio), h = w / mat.ratio;
    return [room[0] + (room[2] - w) / 2, room[1] + (room[3] - h) / 2, w, h];
  };
  const meets = (f) => !mat.min || (f[2] >= mat.min[0] - 0.5 && f[3] >= mat.min[1] - 0.5);
  // The best field in the stretches given: inside the safe box (or the wide stretch above the
  // buttons), inside what every feed's crop shows where the field keeps its smallest size there.
  // One that has its smallest size first, then the larger.
  const bestField = (stretches) => {
    const opts = [];
    for (const st of stretches) for (const zone of [S, Z.wide].filter(Boolean)) {
      const room = st[2] > 0 && st[3] > 0 ? clipBox(zone, st) : null;
      if (!room) continue;
      const inCrop = clipBox(room, cropBox);
      if (inCrop) opts.push({ room: inCrop, field: fieldIn(inCrop), inCrop: true });
      opts.push({ room, field: fieldIn(room), inCrop: false });
    }
    for (const o of opts) o.meets = meets(o.field);
    opts.sort((a, b) => (b.meets - a.meets) || (a.meets && b.meets ? b.inCrop - a.inCrop : 0) || area(b.field) - area(a.field));
    return opts[0] || null;
  };

  // The speaker's source at scale s in its field: covering the field where the face can then lie
  // inside `band` (as near to the target offsets tx, ty as that allows), else placed by the face
  // alone, smaller than the field or moved, with ground beside it. slackBelow: how much of the
  // field's bottom (under the apps' bars) the picture may leave uncovered.
  const placeIn = (s, field, band, tx, ty, slackBelow = 0) => {
    const axis = (cover, w0, wL, src, f0, f1, a0, a1, t, slack) => {
      if (cover) { const h = holdAxis(s, w0, wL, src, f0, f1, a0, a1, t, D.facePad, [], slack); if (h.ok) return h; }
      const lo = a0 - s * f0, hi = a1 - s * f1;
      return { v: clamp(t, Math.min(lo, hi), Math.max(lo, hi)), ok: lo <= hi + 0.05 };
    };
    const x = axis(s * sw >= field[2] - EPS, field[0], field[2], sw, hull[0], X1(hull), band[0], X1(band), tx, [0, 0]);
    const y = axis(s * sh >= field[3] - EPS, field[1], field[3], sh, hull[1], Y1(hull), band[1], Y1(band), ty, [0, slackBelow]);
    return { s, left: x.v, top: y.v, win: clipBox([x.v, y.v, s * sw, s * sh], field) || field, ok: x.ok && y.ok };
  };

  // captions as the solver sets them: centred, as wide as `centred` and every feed's crop allow
  const capW = Math.min(Z.centred[2], D.caption.maxEm * capF, Math.max(upright ? D.caption.minWidth.tall : D.caption.minWidth.wide, 2 * Math.min(W / 2 - cx0, cx1 - W / 2)));
  const caption = (y, where, x = W / 2 - capW / 2, w = capW) => {
    const rows = inkRows(y + D.caption.padEm * capF / 2, cap.lines, D.caption.line, capF);
    return { role: "caption", where, box: [x, y, w, capH], ink: [x, rows[0], w, rows[1] - rows[0]], lines: cap.lines, font: capF, style: "cap", align: "center" };
  };

  // ---- above: the material above, the speaker's panel below, the captions on the seam ----
  function aboveOf() {
    const capHalf = cap ? capH / 2 : 0, gapUp = capHalf + g;
    const stretch = (seam) => [0, S[1], W, seam - gapUp - S[1]];
    // the seam at which a face (its hull) at scale s just fits below it: the captions' lower half,
    // the margin kept above a head, the face, the margin below the chin, inside the safe box
    const fh = (s) => s * hull[3];
    const seamOf = (s) => Y1(S) - below(fh(s)) - fh(s) - above(fh(s)) - capHalf;
    // and the largest scale that fits below a seam
    const sAt = (seam) => { let s = (Y1(S) - seam - capHalf) / (hull[3] * (1 + D.free.above + D.free.below)); while (s > 1e-4 && seamOf(s) < seam - 1e-6) s *= 0.995; return Math.max(s, 0); };
    // The panel never leaves the face under faceMin: the lowest seam is the one at which it has that
    const sMin = B.faceMin * H / usual[3], seamLast = seamOf(sMin);
    const atLast = bestField([stretch(seamLast)]);
    if (atLast) { most.above = atLast.field; limits.above = { field: atLast.field.map(Math.round), says: `with the speaker's face at ${pct(B.faceMin)} of the frame's height (${limits.faceMin} px) the material's field is at most ${Math.round(atLast.field[2])}×${Math.round(atLast.field[3])} px` }; }
    // the highest seam that leaves the material its smallest field
    let seamMat = null;
    for (let seam = S[1] + gapUp + 1; seam <= seamLast + 1e-6; seam += 2) { const f = bestField([stretch(seam)]); if (f?.meets) { seamMat = seam; break; } }
    if (seamMat === null) {
      notes.push(`no material above the speaker: ${atLast ? `even with the speaker's face at ${pct(B.faceMin)} of the frame's height (the least a panel gives it) the field above is ${Math.floor(atLast.field[2])}×${Math.floor(atLast.field[3])} px` : "the frame leaves no room above the panel"}, under the ${mat.min[0]}×${mat.min[1]} it needs`);
      return null;
    }
    // The speaker's scale: the one it had full-frame where it covers the panel's width and fits
    // (the picture then only moves); else covering the panel's width at the least, the face as
    // tall as below a screen in published Shorts, never enlarged past the soft limit; and where
    // covering does not fit, the face at that size with ground beside the picture.
    const sCover = W / sw, sTarget = (asked ?? D.screenFace.height) * H / usual[3], sRoom = sAt(seamMat);
    holds.above = sRoom * usual[3] / H;
    if (asked !== null && sTarget > sRoom + 1e-9) { notes.push(`no panel: a face of ${pct(asked)} of the frame's height does not fit below a material of its smallest field; it holds ${pct(holds.above)} at most`); return null; }
    const keep = asked === null && prev.scale >= sCover - 1e-9 && prev.scale <= Math.min(soft, sRoom) + 1e-9 && prev.scale * usual[3] >= B.faceMin * H - EPS;
    let s = keep ? prev.scale : sCover <= Math.min(soft, sRoom) + 1e-9 ? Math.min(soft, Math.max(sTarget, sCover)) : Math.min(soft, sTarget);
    s = Math.min(s, sRoom);
    // the seam as low as the face at that scale allows: the material gets all the rest
    const seam = Math.max(seamMat, seamOf(s));
    const panel = [0, seam, W, H - seam], f = fh(s);
    const band = [S[0], seam + capHalf + above(f), S[2], Y1(S) - below(f) - (seam + capHalf + above(f))];
    // across, the face where it was full-frame (it does not jump sideways); down, its eyes a third
    // into the panel
    const sp = placeIn(s, panel, band, mid(prevFace)[0] - s * ux, seam + panel[3] / 3 - s * ue, H - Y1(S));
    return build("above", { field: bestField([stretch(seam)]).field, area: [0, 0, W, seam], speaker: { ...sp, field: panel, shape: "rect" }, caption: cap ? caption(seam - capHalf, "seam") : null, seam, keep });
  }

  // ---- pip: the material over the frame, the speaker as a circle in a corner ----
  function pipOf() {
    const short = Math.min(W, H);
    const d = Math.round(fam === "tall" ? D.circle.tall * W : (fam === "mid" ? D.circle.square : D.circle.wide) * short);
    const bottom = cap ? Y1(S) - capH - g : Y1(S);
    // where screencast-cut and the circle beside a screen put it: bottom left in an upright frame,
    // top right in the others
    const corner = fam === "tall" ? "bottom-left" : "top-right";
    // (inside what every feed's crop shows, where the circle fits there)
    const R = clipBox(S, cropBox), Rc = R && R[2] >= d && R[3] >= d ? R : S;
    const C = corner === "bottom-left" ? [Rc[0], Math.min(bottom, Y1(Rc)) - d, d, d] : [X1(Rc) - d, Rc[1], d, d];
    const off = grow(C, g);
    // the material: the part of the room above (below) the circle across the frame, or beside it
    const stretches = corner === "bottom-left"
      ? [[0, S[1], W, off[1] - S[1]], [X1(off), S[1], W - X1(off), bottom - S[1]]]
      : [[0, Y1(off), W, bottom - Y1(off)], [0, S[1], off[0], bottom - S[1]]];
    const fld = bestField(stretches);
    if (!fld) { notes.push("no circle: the frame leaves the material no room beside it"); return null; }
    most.pip = fld.field;
    // the speaker: a square around the face, pipCrop faces tall, its eyes where the circle beside a
    // screen has them (0.42 of the square down)
    const side = Math.min(sw, sh, B.pipCrop * hull[3]);
    const crop = [clamp(hull[0] + hull[2] / 2 - side / 2, 0, sw - side), clamp(hull[1] + D.eyes * hull[3] - 0.42 * side, 0, sh - side), side, side];
    const s = d / side;
    return build("pip", { field: fld.field, area: [0, 0, W, H], speaker: { s, left: C[0] - crop[0] * s, top: C[1] - crop[1] * s, win: C, ok: true, field: C, shape: "circle", corner, crop }, caption: cap ? caption(Y1(S) - capH, "below") : null });
  }

  // ---- column (16:9): the speaker at one side over the frame's height, the material beside ----
  function columnOf() {
    const cw = Math.round(B.column * W);
    // which way the speaker looks, as far as the face's place in the source tells
    const off = ux / sw - 0.5, looks = off < -B.look ? "right" : off > B.look ? "left" : null;
    const side = looks === "left" ? "right" : "left";
    const col = side === "left" ? [0, 0, cw, H] : [W - cw, 0, cw, H];
    const band = [Math.max(S[0], col[0]), S[1], Math.min(X1(S), X1(col)) - Math.max(S[0], col[0]), S[3]];
    const sCover = Math.max(cw / sw, H / sh);
    const fits = (s) => s * hull[2] <= band[2] - 2 * EPS && s * hull[3] <= band[3] - 2 * EPS;
    // the scale it had full-frame where that covers the column (the picture is then only cut to
    // the column and moved), else covering the column, the face as tall as published talking
    // heads keep theirs where that needs more, never past the soft limit; smaller where the face
    // would not fit the column
    const sMost = Math.min(band[2] / hull[2], band[3] / hull[3]) * (1 - 1e-6);
    holds.column = sMost * usual[3] / H;
    if (asked !== null && asked * H / usual[3] > sMost + 1e-9) { notes.push(`no column: a face of ${pct(asked)} of the frame's height does not fit the column; it holds ${pct(holds.column)} at most`); return null; }
    const keep = asked === null && prev.scale >= sCover - 1e-9 && prev.scale <= soft + 1e-9 && fits(prev.scale);
    let s = keep ? prev.scale : Math.max(sCover, Math.min(soft, (asked ?? WT.subject.from / 100) * H / usual[3]));
    while (s > 1e-4 && !fits(s)) s *= 0.99;
    // across, the face in the column's middle; down, at the height it had full-frame
    const sp = placeIn(s, col, band, col[0] + cw / 2 - s * ux, prevFace[1] - s * usual[1]);
    const bottom = cap ? Y1(S) - capH - g : Y1(S);
    const mx0 = side === "left" ? X1(col) + g : S[0], mx1 = side === "left" ? X1(S) : col[0] - g;
    const fld = bestField([[mx0, S[1], mx1 - mx0, bottom - S[1]]]);
    if (!fld) { notes.push("no column: the frame leaves the material no room beside the speaker"); return null; }
    most.column = fld.field;
    const w = Math.min(mx1 - mx0, D.caption.maxEm * capF);
    return build("column", { field: fld.field, area: side === "left" ? [cw, 0, W - cw, H] : [0, 0, W - cw, H], speaker: { ...sp, field: col, shape: "rect" }, caption: cap ? caption(Y1(S) - capH, "under-material", (mx0 + mx1) / 2 - w / 2, w) : null, side, looks, keep });
  }

  // ---- one candidate, judged and costed ----
  function build(arr, p) {
    const sp = p.speaker, s = sp.s;
    const faceBox = inFrame(s, sp.left, sp.top, hull), faceUsual = inFrame(s, sp.left, sp.top, usual);
    const problems = judge(Z, [
      { kind: "face", label: "material", box: p.field },
      { kind: "face", label: "speaker", box: faceBox },
      ...(sp.shape === "circle" ? [{ kind: "face", label: "speaker's circle", box: sp.field }] : []),
      ...(p.caption ? [{ kind: "text", label: "caption", box: p.caption.box, ink: p.caption.ink }] : []),
    ]);
    // what only the solver knows: the face cut by its own field, enlargement, the captions in the
    // margin kept above a head, the material's field under its smallest size, a panel's face small
    const cut = 1 - inter(faceBox, sp.field) / area(faceBox);
    if (cut > 0.001) problems.push({ level: "hard", code: "cut", kind: "face", of: "speaker", what: `${pct(cut)} cut off by the edge of the speaker's field` });
    const scales = [["speaker", s], ...(mat.fixed ? [["material", p.field[2] / mat.fixed[0]]] : [])];
    for (const [of, v] of scales) {
      if (v > forbidden + 1e-9) problems.push({ level: "hard", code: "enlarged", kind: "picture", of, what: `the ${of}'s pixels are enlarged ${r2(v)}× (over ${forbidden}×: too soft to publish)` });
      else if (v > soft + 1e-9) problems.push({ level: "soft", code: "enlarged", kind: "picture", of, what: `the ${of}'s pixels are enlarged ${r2(v)}× (over ${soft}×: soft)` });
    }
    if (p.caption && inter(p.caption.box, keepOut(faceBox, D)) > 0) problems.push({ level: "unmet", code: "no-room", kind: "text", of: "caption", what: "lies in the margin kept around the speaker's face: no free place for the captions" });
    if (!meets(p.field)) problems.push({ level: "unmet", code: "small", kind: "picture", of: "material", what: `its field is ${Math.floor(p.field[2])}×${Math.floor(p.field[3])} px, under the ${mat.min[0]}×${mat.min[1]} it needs` });
    const faceH = s * usual[3], small = arr !== "pip" && faceH < B.faceMin * H - EPS;
    if (small) problems.push({ level: "soft", code: "small", kind: "face", of: "speaker", what: `the face is ${pct(faceH / H)} of the frame's height, under the ${pct(B.faceMin)} below which the circle stands first` });
    const hard = problems.filter((q) => q.level === "hard").length, softN = problems.filter((q) => q.level === "soft").length;
    const unmet = problems.filter((q) => q.level === "unmet").map((q) => (q.of === "caption" ? "caption" : "material"));
    // The cost, in the points of weights.json: enlargement as everywhere; ground beside the
    // speaker's picture in its field (the material's own ground is the material's); a face short of
    // its target (a panel: as tall as below a screen; a column: the lower end of published talking
    // heads, measured upright only; the circle: none); soft problems.
    const target = arr === "pip" ? null : asked !== null ? 100 * asked : arr === "above" ? 100 * D.screenFace.height : WT.subject.from;
    const ground = Math.max(0, area(sp.field) - area(sp.win)) / (W * H);
    const sMax = Math.max(...scales.map(([, v]) => v));
    const terms = {
      enlargement: Math.max(0, (sMax - soft) / (forbidden - soft)) * WT.enlarge.costAtForbidden,
      ground: WT.ground.cost * 100 * ground,
      subject: target == null ? 0 : WT.subject.smaller * Math.max(0, target - 100 * faceH / H),
      soft: WT.soft.cost * problems.filter((q) => q.level === "soft" && q.code !== "enlarged").length,
    };
    for (const k of Object.keys(terms)) terms[k] = Math.round(terms[k] * 1000) / 1000 || 0;
    const cost = Math.round(Object.values(terms).reduce((a, b) => a + b, 0) * 1000) / 1000;
    // The order before the cost: no hard problem, every need met, then the usual order of the
    // frame's arrangements (the panel before the circle; in 16:9 the column first), where a panel
    // whose face is under faceMin stands behind the circle.
    const order = small ? 9 : ORDER[fam].indexOf(arr);
    const crop = sp.crop || clipBox([(sp.win[0] - sp.left) / s, (sp.win[1] - sp.top) / s, sp.win[2] / s, sp.win[3] / s], [0, 0, sw, sh]);
    const [fx, fy] = mid(faceUsual), [bx, by] = mid(prevFace), zoom = s / prev.scale, kept = Math.abs(zoom - 1) < 1e-4;
    const dx = r1(fx - bx), dy = r1(fy - by);
    const c = {
      fit: `beside-${arr}`, arrangement: arr, ...(p.side ? { side: p.side, looks: p.looks } : {}),
      material: { field: p.field.map(r1), area: p.area.map(r1), share: +(area(p.field) / (W * H)).toFixed(3), ...(mat.fixed ? { scale: r4(p.field[2] / mat.fixed[0]) } : {}) },
      speaker: { field: sp.field.map(r1), shape: sp.shape, ...(sp.corner ? { corner: sp.corner } : {}), scale: r4(s), left: r1(sp.left), top: r1(sp.top), window: sp.win.map(r1), crop: crop.map(r1), face: faceUsual.map(r1), ...(moving ? { hull: faceBox.map(r1) } : {}), faceHeight: Math.round(faceH), facePct: r1(100 * faceH / H), share: +(area(sp.field) / (W * H)).toFixed(3), ground: +ground.toFixed(3) },
      captions: p.caption ? { where: p.caption.where, box: p.caption.box.map(r1), font: p.caption.font, lines: p.caption.lines, align: p.caption.align } : null,
      ...(p.seam != null ? { seam: r1(p.seam) } : {}),
      change: {
        before: { scale: prev.scale, left: prev.left, top: prev.top, window: prev.window, face: prevFace.map(r1), ...(prev.given ? {} : { assumed: true }) },
        after: { scale: r4(s), left: r1(sp.left), top: r1(sp.top), window: sp.field.map(r1), ...(sp.shape === "circle" ? { round: true } : {}), face: faceUsual.map(r1) },
        face: { dx, dy, zoom: r2(zoom) },
        says: `the face moves ${Math.abs(dx) < 1 ? "not across" : `${Math.round(Math.abs(dx))} px to the ${dx < 0 ? "left" : "right"}`} and ${Math.abs(dy) < 1 ? "not up or down" : `${Math.round(Math.abs(dy))} px ${dy < 0 ? "up" : "down"}`}, ${kept ? "at the same scale: the picture is only cut to the field and moved" : `and becomes ${r2(zoom)}× as large`}`,
      },
      // as place's candidates carry them, so that page and captions read this one too
      scale: r4(s), left: r1(sp.left), top: r1(sp.top), window: sp.win.map(r1),
      faceInFrame: [p.field.map(r1), faceBox.map(r1)],
      ...(sp.shape === "circle" ? { circle: { box: sp.field.map(r1), d: Math.round(sp.field[2]), corner: sp.corner, crop: crop.map(r1), of: "speaker", enlargement: r2(s), faceHeight: Math.round(faceH) } } : {}),
      text: p.caption ? [{ ...p.caption, box: p.caption.box.map(r1), ink: p.caption.ink.map(r1) }] : [],
      problems, hard, soft: softN, unmet, terms, cost, rank: [hard ? 1 : 0, unmet.length, order, Math.round(cost * 1000)],
    };
    c.why = [
      hard ? `fails: ${problems.filter((q) => q.level === "hard").map((q) => `${q.of} ${q.what}`).join("; ")}` : "no hard problem",
      NAMES[arr] + (arr === "above" ? " (what published Shorts do most where a screen and a face show together: usual, not shown to work)" : arr === "pip" ? " (a small picture in or at the screen: the rarer form in published Shorts)" : ` (${p.looks ? `the face sits off the source's middle, so the speaker likely looks ${p.looks}, towards the material` : "the face's place in the source tells no look: left, the default"}; unmeasured)`),
      `the material's field is ${Math.round(p.field[2])}×${Math.round(p.field[3])} px (${pct(c.material.share)} of the frame)${mat.min ? (meets(p.field) ? `, at least the ${mat.min[0]}×${mat.min[1]} it needs` : `, under the ${mat.min[0]}×${mat.min[1]} it needs`) : ""}`,
      `the speaker's face is ${Math.round(faceH)} px (${pct(faceH / H)} of the frame's height${target != null ? `; ${r1(target)} % is ${asked !== null ? `the target asked for (beside.face; the usual is ${arr === "above" ? `${r1(100 * D.screenFace.height)} % below a screen` : `${WT.subject.from} %, the lower end of published talking heads`})` : arr === "above" ? "the usual below a screen" : "the lower end of published talking heads, measured upright"}` : ""})${s > 1 + 1e-9 ? `, the footage enlarged ${r2(s)}×` : ""}${asked !== null && s >= soft - 1e-9 && faceH < asked * H - 1 ? `: the footage gives no more without enlarging past ${soft}×` : ""}`,
      ...(p.keep ? ["the speaker keeps the scale it had full-frame"] : []),
      ...(ground ? [`${pct(ground)} of the frame is ground beside the speaker's picture`] : []),
      ...(cap ? [unmet.includes("caption") ? "the captions find no free place" : `the captions ${p.caption.where === "seam" ? "on the seam" : p.caption.where === "below" ? "at the safe box's bottom" : "under the material"}`] : []),
      `cost ${cost} (${Object.entries(terms).filter(([, v]) => v).map(([k, v]) => `${k} +${v}`).join(", ") || "no term"})`,
    ];
    return c;
  }

  const built = (fam === "wide" ? [columnOf(), aboveOf(), pipOf()] : [aboveOf(), pipOf()]).filter(Boolean);
  if (asked !== null && !built.some((c) => c.arrangement !== "pip") && Object.keys(holds).length) {
    const most = Math.max(...Object.values(holds));
    throw new Error(`A face of ${pct(asked)} of the frame's height fits no ${fam === "wide" ? "column or panel" : "panel"} in ${Z.frame} beside a material of ${mat.min ? `${mat.min[0]}×${mat.min[1]} px` : "this size"}: ${most >= B.faceMin ? `at most ${Math.floor(100 * most)} % (--set beside.face=${Math.floor(100 * most) / 100})` : "not even the least a panel gives"}; ask for a smaller face or a smaller field.`);
  }
  const cands = built.sort((a, b) => { for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i]; return 0; });
  cands.forEach((c, i) => {
    c.score = c.hard || c.unmet.length ? 0 : +(100 - c.cost).toFixed(3);
    if (!i) return;
    const top = cands[0];
    c.behind = c.rank[0] !== top.rank[0] ? "behind the first because it has a hard problem" : c.rank[1] !== top.rank[1] ? "behind the first because it leaves a need unmet" : c.rank[2] !== top.rank[2] ? (c.rank[2] === 9 ? "behind the first because its panel leaves the face under the least a panel gives it" : `behind the first by the usual order of this frame (${ORDER[fam].join(", then ")})`) : `behind the first by ${r2(c.cost - top.cost)} points`;
  });
  if (fam === "mid") notes.push(`in ${W}×${H} the panel holds the face at ${pct(B.faceMin)} of the frame's height or more while the material's field is at most ${limits.above ? `${limits.above.field[2]}×${limits.above.field[3]} px` : "nothing"}; a material that needs more height gets the circle (nothing was measured in this frame)`);
  if (fam === "wide") notes.push("nothing in 16:9 was measured: the column is the catalogue's sketch, the panel below the material is offered only where the material keeps its smallest field");
  if (!prev.given) notes.push(`no --before: the speaker full-frame before is taken as the source covering the frame (${prev.scale}× at ${prev.left}, ${prev.top}); give the placement you used, as --before scale,left,top, for the change's numbers`);
  const res = {
    kind: "beside", frame: Z.frame, size: Z.size, platforms: Z.platforms.map((p) => p.name), fallback: Z.fallback,
    source, faces: [hull],
    sources: [{ size: source, faces: [hull] }, { size: mat.fixed || null, material: true }],
    speaker: { source, face: usual, ...(moving ? { hull } : {}) },
    material: { min: mat.min, ratio: mat.ratio ? r4(mat.ratio) : null, fixed: mat.fixed },
    before: { ...prev, face: prevFace.map(r1) },
    needs, notes, limits, candidates: cands, defaults: D,
    ...(moving ? { tracks: [{ face: 1, source: 1, ...tf.track, times: tf.at.map((m) => m.t), boxes: tf.at.map((m) => ({ t: m.t, box: m.box })) }] } : {}),
  };
  // no arrangement gives the material its smallest field: one sentence, with the most each gives
  if (mat.min && !cands.some((c) => !c.unmet.includes("material"))) {
    const list = Object.entries(most).map(([k, f]) => `${Math.floor(f[2])}×${Math.floor(f[3])} px ${k === "above" ? "above the speaker" : k === "pip" ? "beside the speaker's circle" : "beside the speaker's column"}`);
    res.none = `No arrangement gives the material a field of ${mat.min[0]}×${mat.min[1]} px in ${Z.frame} with the speaker in the picture: the most is ${list.join(", or ") || "nothing"}; ask for a smaller field, or show the material alone for its seconds.`;
  }
  return res;
}

// ---- in words ----

export function printBeside(res, tool, folder) {
  const [W, H] = res.size, m = res.material;
  const mark = (c) => (c.hard ? "✗" : c.unmet.length ? "–" : c.soft ? "!" : "✓");
  console.log(`${res.frame} ${W}×${H} for ${res.platforms.join(", ")}${res.fallback ? " (no platform named: the usual ones of this frame)" : ""}`);
  console.log(`speaker ${res.speaker.source.join("×")}, face ${boxText(res.speaker.face)}${res.speaker.hull ? ` (moving: hull ${boxText(res.speaker.hull)})` : ""}; material: ${m.fixed ? `a picture of ${m.fixed.join("×")}` : "laid out into its field"}${m.min ? `, at least ${m.min.join("×")} px` : ""}${m.ratio && !m.fixed ? `, of the shape ${m.ratio}:1` : ""}; text: ${res.needs.length ? res.needs.map((n) => `${n.lines} caption line${n.lines > 1 ? "s" : ""}`).join(" + ") : "none"}`);
  for (const n of res.notes) console.log(`note: ${n}`);
  res.candidates.forEach((c, i) => {
    const q = c.speaker, f = c.material.field;
    console.log(`\n${i + 1}. ${mark(c)} ${c.fit}${c.side ? ` ${c.side}` : ""}  score ${c.score}`);
    console.log(`   material  field ${boxText(f)} (${Math.round(f[2])}×${Math.round(f[3])}, ${pct(c.material.share)} of the frame)${c.material.scale ? ` at ${c.material.scale}×` : ""}; its ground ${boxText(c.material.area)}`);
    console.log(`   speaker   ${q.shape === "circle" ? `circle ${Math.round(q.field[2])} px ${q.corner}` : "field"} ${boxText(q.field)}: the footage at ${q.scale}× (left ${q.left}, top ${q.top}), shows x ${Math.round(q.crop[0])}–${Math.round(q.crop[0] + q.crop[2])}, y ${Math.round(q.crop[1])}–${Math.round(q.crop[1] + q.crop[3])} of it; face ${boxText(q.face)} (${q.faceHeight} px, ${pct(q.faceHeight / H)})${q.ground ? `; ${pct(q.ground)} of the frame ground beside it` : ""}`);
    if (c.captions) console.log(`   caption   ${c.captions.where}, ${boxText(c.captions.box)}, ${c.captions.lines} line${c.captions.lines > 1 ? "s" : ""} at ${c.captions.font} px`);
    console.log(`   change    from full-frame (${c.change.before.scale}× at ${c.change.before.left}, ${c.change.before.top}${c.change.before.assumed ? ", assumed" : ""}): ${c.change.says}`);
    for (const p of c.problems) console.log(`   ${p.level === "hard" ? "✗" : p.level === "soft" ? "!" : "–"} ${p.of}: ${p.what}`);
    console.log(`   why: ${c.why.join("; ")}${c.behind ? `; ${c.behind}` : ""}`);
  });
  const pass = res.candidates.filter((c) => !c.hard && !c.unmet.length).length;
  console.log(`\n${folder}/placement.json: ${res.candidates.length} candidate${res.candidates.length === 1 ? "" : "s"}, ${pass} without a hard problem and with every need met.`);
  console.log(`The order is a suggestion. Look before you choose: ${tool} page ${folder} --still <speaker's video|image> [--still <the material as a picture>] writes the first three as pictures and has platform-zones check them; ${tool} captions ${folder} --candidate N gives the captions' options.`);
}
