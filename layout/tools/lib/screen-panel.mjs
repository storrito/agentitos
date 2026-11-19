// screen-panel: the screen above, the speaker in a panel below it down to the caption line, the
// captions where the caller fixed them (--caption-area). For a keep of an upright screencast that
// shows the whole screen or a wide zoom; asked for with --screen-panel, never offered unasked.
// Decided from picture pairs (2026-11-19): in 9:16 and 4:5 it triples the speaker against the
// circle (6 → 18 % of the frame's height, the median face under a screen in published Shorts) and
// leaves about 40 % of the frame ground instead of 63–73 %, while the captions keep their place
// through the cut. Not the captions on the seam (screen-stacked, beside-above): they would jump
// across the face at every such keep.
//
//   the screen   its region inside the safe box across (or the zones' wide stretch above the
//                buttons where it ends above them), as wide as it fits there and at most 2× of the
//                screen's pixels, from the safe box's top (under the hook's card or a label's
//                bottom, --label-bottom, where there is one); only the region is drawn
//   the panel    from a gap under the screen down to the caption line's lower edge, across the
//                whole frame (width "frame", the default) or as wide as the screen above it
//                (width "screen": the edges aligned); the captions lie on its lower part
//   the face     towards 18 % of the frame's height (screenFace.height), more where the webcam's
//                picture covers the panel (its width and height) with the face up to weights.subject.to (34 %),
//                never past 2× of the webcam's pixels (over weights.enlarge.softFrom it is said);
//                its eyes a third down the panel, as near as the head with the margin kept above a
//                head (free.above) stays inside the panel and the face with the margin kept below a
//                chin (free.below) stays above the captions: the skill's own keep-out of a face,
//                so that the captions lie on the chest, never on eyes, nose or mouth. Where the
//                panel holds no such face at the size, the face is made smaller, down to the limit
//   the limit    the face at 18 % of the frame's height (or what 2× of the webcam's pixels give,
//                where that is less): under it the region is too tall for a panel below it and the
//                candidate is not offered (the pairs' tight zoom, a region at 2× whose text reads,
//                left the panel a face of 15 % in 9:16 and 17 % in 4:5; there the circle stays)
//
// Not offered, with one sentence in the notes and in res.screenPanel: in 16:9 and 1:1 (not decided
// there), without a face in the webcam's picture, with the webcam baked into the screen, with the
// captions on the screen's part, with a panel whose face stays under the limit.
//
//   screenPanel(ctx, camSrc, ask, notes) → [candidate]
//     ask: { width: "frame" | "screen", labelBottom: px | null, before: { scale, left, top, window? } | null }
//     sets ctx.panelVerdict: { offered, width, code?, why? }

import { X1, Y1, clipBox, clamp, r1, r2, pct } from "./boxes.mjs";
import { evaluate } from "./evaluate.mjs";
import { captionTop } from "./text.mjs";

export const PANEL_WIDTHS = ["frame", "screen"];

const r4 = (v) => +v.toFixed(4);
const mid = (b) => [b[0] + b[2] / 2, b[1] + b[3] / 2];

export function screenPanel(ctx, camSrc, ask, notes) {
  const { W, H, Z, D, hook, cap } = ctx, S = Z.safe, g = D.gap;
  const width = ask.width || "frame";
  const no = (code, why) => {
    notes.push(`no screen-panel (the screen above, the speaker in a panel down to the caption line): ${why}`);
    ctx.panelVerdict = { offered: false, width, code, why };
    return [];
  };
  if (H < 1.2 * W) return no("frame", `not offered in this frame (${W}×${H}): it was decided for 9:16 and 4:5 only; the circle stands for the webcam here`);
  if (!camSrc || camSrc.baked) return no("webcam", camSrc ? "the webcam is baked into the screen recording: the panel is built for a webcam recorded as a file of its own; the circle shows the speaker" : "there is no webcam: give it as a second --source with its --face");
  const f = camSrc.faces[0];
  if (!f) return no("face", "no face is known in the webcam's picture: read its box off grid and give it as --face after the webcam's --source");

  const main = ctx.sources[0], R = main.faces[0], [cw, ch] = camSrc.size;
  const forb = D.weights.enlarge.forbiddenFrom, soft = D.weights.enlarge.softFrom;

  // the screen: its region as wide as the safe box (or the wide stretch above the buttons, where it
  // ends above them) holds it, at most 2× of its pixels, centred in that box
  const top0 = Math.max(S[1], hook ? (Z.wide || S)[1] + D.hookCard.font * D.hookCard.heightEm + g : 0, Number.isFinite(ask.labelBottom) ? ask.labelBottom + g : 0);
  const scaleIn = (b) => Math.min(b[2] / R[2], forb);
  let box = S, s = scaleIn(S);
  if (Z.wide && scaleIn(Z.wide) > s && top0 + scaleIn(Z.wide) * R[3] <= Y1(Z.wide) + 0.5) { box = Z.wide; s = scaleIn(Z.wide); }
  const rw = s * R[2], rh = s * R[3], rx = box[0] + (box[2] - rw) / 2, ry = top0;
  const screen = { src: 0, s, left: rx - s * R[0], top: ry - s * R[1], win: [rx, ry, rw, rh], own: null };

  // the caption line: where the caller fixed it, else the band at the safe box's bottom; no
  // captions: the panel ends at the safe box's bottom
  const capTop = cap ? captionTop(ctx) : Y1(S), capBottom = cap ? (ctx.captionArea ? ctx.captionArea.bottom : Y1(S)) : Y1(S);
  const T = ry + rh + g;
  if (capTop < T + 1) return no("captions", `the captions (y ${Math.round(capTop)}–${Math.round(capBottom)}) stand on the screen's part, which reaches y ${Math.round(ry + rh)}: the region at ${r2(s)}× is too tall for a panel above the captions; the circle stands for the webcam`);
  const panel = width === "screen" ? [rx, T, rw, capBottom - T] : [0, T, W, capBottom - T];
  const P = panel[3];

  // the face: its aim, then smaller where the panel does not hold it, down to the limit
  const coverUpTo = D.weights.subject.to / 100;
  // (the scale at which the webcam's picture covers the panel: its width and its height)
  const aimPx = Math.max(D.screenFace.height * H, Math.min(Math.max(panel[2] / cw, P / ch) * f[3], coverUpTo * H));
  const sAim = Math.min(aimPx / f[3], forb);
  const least = Math.min(D.screenFace.height * H, forb * f[3]);
  const room = (sc) => {
    const fh = sc * f[3];
    const up = Math.max(D.free.aboveMin, D.free.above * fh), down = Math.max(D.free.belowMin, D.free.below * fh);
    // (above the head no more margin than the webcam's picture has there: its top edge then ends the panel's picture)
    return { fh, lo: T + Math.min(up, sc * f[1]), hi: capTop - fh - down };
  };
  let sc = sAim, q = room(sc);
  while (q.lo > q.hi + 0.05 && sc * f[3] > least) { sc = Math.max(least / f[3], sc - D.zoomStep * sAim); q = room(sc); }
  if (q.lo > q.hi + 0.05) {
    // the largest face the panel holds, for the sentence
    let m = least / f[3];
    while (m > D.zoomStep * sAim && room(m).lo > room(m).hi + 0.05) m -= D.zoomStep * sAim;
    const most = Math.max(0, m * f[3]);
    const because = least < D.screenFace.height * H - 0.5 ? `the ${Math.round(least)} px that 2× of the webcam's pixels give` : `the ${r1(100 * D.screenFace.height)} % of the frame's height (${Math.round(least)} px) the face has under a screen in published Shorts`;
    return no("small", `the region at ${r2(s)}× takes the frame down to y ${Math.round(ry + rh)}, and the panel from there to the captions' top (${Math.round(capTop - T)} px) holds the face at most ${Math.round(most)} px tall (${pct(most / H)} of the frame) with its head inside the panel and its chin above the captions, under ${because}; the circle stands for the webcam here (a region less tall leaves the panel its room)`);
  }
  const fh = q.fh;
  // the eyes a third down the panel, held between the head's margin and the captions
  const faceTop = clamp(T + P / 3 - D.eyes * fh, q.lo, q.hi);
  let top = faceTop - sc * f[1];
  // the webcam's picture covers the panel where the face's room lets it
  const tLo = Math.max(capBottom - sc * ch, q.lo - sc * f[1]), tHi = Math.min(T, q.hi - sc * f[1]);
  if (sc * ch >= P && tLo <= tHi + 0.05) top = clamp(top, tLo, tHi);
  // across: the face on the panel's middle, the picture covering the panel's width where it is as
  // wide; the face inside the safe box
  let left = panel[0] + panel[2] / 2 - sc * (f[0] + f[2] / 2);
  if (sc * cw >= panel[2]) left = clamp(left, X1(panel) - sc * cw, panel[0]);
  const fx0 = left + sc * f[0];
  if (fx0 < S[0] + D.facePad) left += Math.min(S[0] + D.facePad - fx0, X1(S) - D.facePad - (fx0 + sc * f[2]));
  else if (fx0 + sc * f[2] > X1(S) - D.facePad) left -= Math.min(fx0 + sc * f[2] - (X1(S) - D.facePad), fx0 - S[0] - D.facePad);
  const win = clipBox([left, top, sc * cw, sc * ch], panel) || panel;
  const cam = { src: 1, s: sc, left, top, win, own: null };

  const c = evaluate(ctx, { fit: "screen-panel", parts: [screen, cam], seam: null });
  const face = [left + sc * f[0], top + sc * f[1], sc * f[2], fh];
  const crop = [(win[0] - left) / sc, (win[1] - top) / sc, win[2] / sc, win[3] / sc];

  // the change from the speaker full-frame just before (the caller's --before, else the webcam
  // covering the frame, its face in the middle across and its eyes a third down)
  const s0 = Math.max(W / cw, H / ch);
  const prev = ask.before ? { scale: ask.before.scale, left: ask.before.left, top: ask.before.top, window: ask.before.window || [0, 0, W, H], given: true }
    : { scale: r4(s0), left: r1(clamp(W / 2 - s0 * (f[0] + f[2] / 2), W - s0 * cw, 0)), top: r1(clamp(H / 3 - s0 * (f[1] + D.eyes * f[3]), H - s0 * ch, 0)), window: [0, 0, W, H], given: false };
  const prevFace = [prev.left + prev.scale * f[0], prev.top + prev.scale * f[1], prev.scale * f[2], prev.scale * f[3]];
  const [ax, ay] = mid(prevFace), [bx, by] = mid(face), dx = r1(bx - ax), dy = r1(by - ay), zoom = sc / prev.scale;
  const textHeight = main.minText ? r1(s * main.minText) : null;
  const camNote = sc > soft + 1e-9 ? `the webcam's pixels are enlarged ${r2(sc)}× (over ${soft}×: soft)` : null;
  const held = fh < sAim * f[3] - 0.5;
  c.stack = {
    width,
    screen: { box: screen.win.map(r1), scale: r4(s), ...(textHeight != null ? { textHeight } : {}), in: box === S ? "safe" : "wide" },
    panel: { box: panel.map(r1), width },
    camera: { scale: r4(sc), left: r1(left), top: r1(top), window: win.map(r1), crop: crop.map(r1), enlargement: r2(sc), ...(camNote ? { soft: true } : {}) },
    face: { box: face.map(r1), height: Math.round(fh), pct: r1(100 * fh / H), aim: Math.round(sAim * f[3]), least: Math.round(least), ...(held ? { heldBy: "the panel's height" } : {}) },
    ground: c.ground,
    captions: cap ? { top: r1(capTop), bottom: r1(capBottom), ...(ctx.captionArea ? { fixed: true } : {}) } : null,
    change: {
      before: { scale: prev.scale, left: prev.left, top: prev.top, window: prev.window, face: prevFace.map(r1), ...(prev.given ? {} : { assumed: true }) },
      after: { scale: r4(sc), left: r1(left), top: r1(top), window: win.map(r1), face: face.map(r1) },
      face: { dx, dy, zoom: r2(zoom) },
      says: `the face moves ${Math.abs(dx) < 1 ? "not across" : `${Math.round(Math.abs(dx))} px to the ${dx < 0 ? "left" : "right"}`} and ${Math.abs(dy) < 1 ? "not up or down" : `${Math.round(Math.abs(dy))} px ${dy < 0 ? "up" : "down"}`}, ${Math.abs(zoom - 1) < 1e-4 ? "at the same scale" : `and becomes ${r2(zoom)}× as large`}`,
    },
    says: [
      `the screen's region ${Math.round(rw)}×${Math.round(rh)} at ${r2(s)}× inside the ${box === S ? "safe box" : "wide stretch above the buttons"} across, y ${Math.round(ry)}–${Math.round(ry + rh)}${textHeight != null ? `, its smallest text ${textHeight} px tall` : ""}`,
      `the speaker's panel ${width === "screen" ? "as wide as the screen" : "across the frame"}, ${Math.round(panel[2])}×${Math.round(P)} from y ${Math.round(T)} down to the caption line's foot, the face ${Math.round(fh)} px (${pct(fh / H)} of the frame's height)${held ? `, under its aim of ${Math.round(sAim * f[3])} px: the panel holds no more with the head inside it and the chin above the captions` : ""}${camNote ? `; ${camNote}` : ""}`,
      `from the speaker full-frame${prev.given ? "" : " (assumed: give --before)"}: the face moves ${Math.abs(dx) < 1 ? "not across" : `${Math.round(Math.abs(dx))} px ${dx < 0 ? "left" : "right"}`}, ${Math.abs(dy) < 1 ? "not up or down" : `${Math.round(Math.abs(dy))} px ${dy < 0 ? "up" : "down"}`}, ×${r2(zoom)}`,
    ],
  };
  if (!prev.given) c.stack.change.says += " (the speaker before assumed covering the frame: give --before)";
  ctx.panelVerdict = { offered: true, width };
  return [c];
}
