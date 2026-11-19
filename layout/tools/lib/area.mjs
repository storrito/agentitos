// Large type over a picture that is placed already, for a whole clip: kinetic type (phrase after
// phrase set big and moving, across the safe box's width) has one area from the safe box's bottom
// up, not a caption line. Its top is one for the clip, so that the type sits in one place a viewer
// can follow; what may differ per shot is how high the shot's picture stands (its lift), as for
// the captions (lib/placed.mjs).
//
//   areaOverTime({ zones, shots, area: { top?, bottom? }, set, fixed: { top, lifts }, raise })
//     → { area, shots, candidates, conflicts, notes }
//
// shots: as textOverTime takes them (times in seconds, boxes in px of the frame as the picture
// stands unraised, feat: the eyes, nose and mouth; zoom on a moment: how much larger the picture
// shows there than as it is raised, where it grows after the raise, as a push-in: a lift of L px
// moves that moment's faces L × zoom up, and every lift here is in px of the picture before it
// grows; eye on a moment: the y of the middle of the eyes' own box, for what the list says of
// the eyes). area.top: the usual top, where the caller sets
// its type without faces (the area is never taller); area.bottom: its bottom (default the safe
// box's). fixed.top: a top the caller chose; fixed.lifts: { <shot index>: px }.
//
// What "clear of a face" is for such type: never on the eyes, the nose or the mouth (the lower lip
// with it: the mouth line, which holds an open mouth); on the chin, the neck and the body below a
// face it may lie. The hair or the forehead above the eyes (where a face's eyes stand below the
// area) is weighed as for captions (COSTS.hair): said, not a fault, and taken only where it spares
// eyes or a mouth. Avoided by the area going lower (smaller type, never under area.least of the
// height) or the shot's picture going up (by the caller's --raise: head, mouth, full, as for the
// captions, past the head's top for the mouth where the rule allows it), whichever costs less
// (area.smaller against liftGround: lower first where the shot that needs it holds nine tenths of
// the clip); what is left is said per shot with its seconds.

import { X1, Y1, inter } from "./boxes.mjs";
import { DEFAULTS, merged, scaled } from "./defaults.mjs";
import { keepOut } from "./text.mjs";
import { COSTS, RAISE, raiseOf, momentsOf, maxLift, mouthOf, eyesOf, partOf, PARTS, up, overlapsX, returnsOf } from "./placed.mjs";

const r0 = (v) => Math.round(v);
const r1 = (v) => Math.round(v * 10) / 10;

// One shot under an area box: the least lift (within most) that brings every mouth line above the
// area's top, and the seconds on each part at that lift (placed.mjs's PARTS): the eyes or the nose,
// the hair or the forehead (inside the head's box, above the eyes' top: only where the face's eyes
// stand below the area), the mouth (both lips), the lower lip, the chin, the neck or beside the
// face (its keep-out)
function shotUnder(box, moments, most, D, exact = false) {
  let need = 0;
  for (const m of moments) for (const f of m.faces) if (overlapsX(f.box, box) && f.box[1] < Y1(box)) need = Math.max(need, (mouthOf(f) - box[1]) / (f.zoom || 1));
  const lift = Math.max(0, exact ? most : Math.min(most, Math.ceil(need)));
  const sum = { nose: 0, hair: 0, mouth: 0, lip: 0, chin: 0 };
  const who = new Map();
  for (const m of moments) {
    let part = -1;
    for (const f of m.faces) {
      const by = lift * (f.zoom || 1);
      if (inter(keepOut(up(f.box, by), D), box) <= 0) continue;
      const p = partOf(f, by, box);
      part = Math.max(part, p);
      const w = who.get(f.who) || { who: f.who, from: m.t, to: m.t, seconds: 0, nose: 0, hair: 0, mouth: 0, lip: 0, chin: 0 };
      w.seconds += m.dt; w.from = Math.min(w.from, m.t); w.to = Math.max(w.to, m.t);
      w[PARTS[p]] += m.dt;
      who.set(f.who, w);
    }
    if (part >= 0) sum[PARTS[part]] += m.dt;
  }
  return { lift, need: Math.ceil(need), ...sum, who: [...who.values()] };
}

// what the eyes' figure is, in words: "the eyes at 21 %", "the brows' top at 13 %" (the box of
// eyes, nose and mouth begins there), "the eyes at about 18 % (by the head's proportions)"
export const eyesText = (are, share) => are === "eyes" ? `the eyes at ${Math.round(share * 100)} % of the height`
  : are === "brows" ? `the brows' top at ${Math.round(share * 100)} % of the height (the eyes a little lower)`
  : `the eyes at about ${Math.round(share * 100)} % of the height (by the head's proportions)`;

export function areaOverTime({ zones: Z, shots, area: asked = {}, set = {}, fixed = {}, costs = COSTS, raise: r = "mouth" }) {
  const raise = raiseOf(r);
  if (!RAISE.includes(raise)) throw new Error(`raise is ${RAISE.join(", ")}, not "${r}".`);
  const [W, H] = Z.size;
  const D = scaled(merged(DEFAULTS, set), Z.size);
  const S = Z.safe, C = Z.centred;
  const ctx = { W, H, Z, D, raise };
  const bottom = asked.bottom ?? Y1(C);
  const usual = Math.max(C[1], asked.top ?? C[1]);
  const lowest = bottom - D.area.least * H;
  if (usual > lowest) throw new Error(`the area's top ${r0(usual)} leaves less than ${Math.round(D.area.least * 100)} % of the height above its bottom ${r0(bottom)}: give a higher top.`);
  if (fixed.top != null && !(fixed.top >= C[1] - 0.5 && fixed.top <= lowest + 0.5)) throw new Error(`a top of ${r0(fixed.top)} is outside what the area may be: from the safe box's top (${r0(C[1])}) to ${r0(lowest)}, where ${Math.round(D.area.least * 100)} % of the height is left above its bottom (${r0(bottom)}).`);
  const list = shots.map((s, i) => {
    const moments = momentsOf(s);
    const ml = maxLift(s, moments, ctx);
    // the area's purpose of a raise is always the mouth: past the head's top where the rule allows (mouth, full)
    const most = fixed.lifts?.[i] != null ? Math.max(0, fixed.lifts[i]) : raise === "head" ? ml.most : ml.beyond;
    // the limit of the lift used: beyond's (the eyes, the eye line, the room) unless head
    return { ...s, i, weight: s.weight ?? s.end - s.start, moments, most, by: fixed.lifts?.[i] != null ? "fixed" : raise === "head" ? ml.by : ml.beyondBy, forced: fixed.lifts?.[i] != null };
  });
  const returns = returnsOf(list, W, H);
  const total = list.reduce((n, s) => n + s.weight, 0) || 1;
  const step = Math.max(1, Math.round(H * 0.005));
  const tops = fixed.top != null ? [fixed.top] : [];
  if (fixed.top == null) for (let y = usual; y <= lowest + 1e-6; y += step) tops.push(y);
  // (the smallest area is always weighed, also where the steps pass it, and the top just below each
  // shot's lowest mouth line, where that shot needs no raise: a step's mix of lower type and a
  // raise of a few px is not cheaper than going down that little more)
  if (fixed.top == null && lowest - tops.at(-1) > 0.5) tops.push(lowest);
  if (fixed.top == null) for (const s of list) {
    let y = -Infinity;
    for (const m of s.moments) for (const f of m.faces) if (overlapsX(f.box, [C[0], 0, C[2], H])) y = Math.max(y, Math.ceil(mouthOf(f)));
    if (y > usual + 0.5 && y < lowest - 0.5 && !tops.some((t) => Math.abs(t - y) < 0.5)) tops.push(y);
  }
  const candidates = tops.map((y) => {
    const box = [C[0], y, C[2], bottom - y];
    const raw = list.map((s) => shotUnder(box, s.moments, s.most, D, s.forced));
    // the returns of one framing at one height: that of the one that needs most, as far as each may go
    for (const g of returns) {
      const free = g.filter((i) => !list[i].forced);
      if (free.length < 2) continue;
      const want = Math.min(Math.max(...free.map((i) => raw[i].lift)), ...free.map((i) => list[i].most));
      for (const i of free) if (raw[i].lift !== want) raw[i] = { ...shotUnder(box, list[i].moments, want, D, true), returned: true };
    }
    let cost = 0;
    const per = list.map((s, i) => {
      const q = raw[i], k = s.weight / Math.max(1e-6, s.end - s.start);
      const free = Math.min(q.lift, Math.max(0, s.room?.free || 0)), ground = q.lift - free;
      cost += k * (q.nose * costs.nose + q.hair * costs.hair + q.mouth * costs.mouth + q.lip * costs.lip + q.chin * D.area.chin)
        + s.weight * (free * costs.liftFree + ground * costs.liftGround) / (0.1 * H);
      return { ...q, nose: q.nose * k, hair: q.hair * k, mouth: q.mouth * k, lip: q.lip * k, chin: q.chin * k, free, ground };
    });
    // a smaller area than the usual: the type smaller for the whole clip, per cent of the height
    // and ten seconds (area.smaller)
    const lower = ((y - usual) / H) * 100;
    cost += lower * D.area.smaller * total / 10;
    return { box: box.map(r1), top: r1(y), cost, lower, per };
  });
  candidates.sort((a, b) => a.cost - b.cost || a.top - b.top);
  const best = candidates[0];

  const conflicts = [], notes = [];
  const shotsOut = list.map((s, i) => {
    const q = best.per[i];
    const headCut = { seconds: 0, px: 0, byLift: 0 };
    // the eyes at their highest as the list says them: the middle of the eyes' own box where the
    // faces have it, else the top of the box of eyes (with the brows), nose and mouth, else where
    // the head's proportions put the eyes (eyesAre says which); the limits of a raise keep the
    // top of that box, as before
    let eyesTop = Infinity, eyesAre = null;
    for (const m of s.moments) {
      let cut = 0, before = 0;
      for (const f of m.faces) {
        const top = f.box[1] - Math.max(D.free.aboveMin, D.free.above * f.box[3]);
        const by = q.lift * (f.zoom || 1);
        cut = Math.max(cut, by - top); before = Math.max(before, -top);
        const y = (f.eye != null ? f.eye : eyesOf(f, D)) - by;
        if (y < eyesTop) { eyesTop = y; eyesAre = f.eye != null ? "eyes" : f.feat ? "brows" : "head"; }
      }
      if (cut > 0.5) { headCut.seconds += m.dt; headCut.px = Math.max(headCut.px, cut); headCut.byLift = Math.max(headCut.byLift, cut - Math.max(0, before)); }
    }
    headCut.seconds = r1(headCut.seconds); headCut.px = r0(headCut.px); headCut.byLift = r0(headCut.byLift);
    const on = { nose: r1(q.nose), hair: r1(q.hair), mouth: r1(q.mouth), lip: r1(q.lip), chin: r1(q.chin) };
    const out = { shot: i, ...(s.n != null ? { n: s.n } : {}), start: s.start, end: s.end, lift: q.lift, free: q.free, ground: q.ground, most: s.most, limit: s.by, headCut,
      ...(Number.isFinite(eyesTop) ? { eyes: Math.round((eyesTop / H) * 1000) / 1000, eyesAre } : {}), ...(s.forced ? { fixed: true } : {}), ...(q.returned ? { returned: true } : {}), on,
      touches: q.who.map((w) => ({ who: w.who, from: r1(w.from), to: r1(w.to), seconds: r1(w.seconds), nose: r1(w.nose), hair: r1(w.hair), mouth: r1(w.mouth), lip: r1(w.lip), chin: r1(w.chin) })) };
    const span = `Shot ${s.n ?? i + 1} (${r1(s.start)}–${r1(s.end)} s)`;
    const who = [...new Set(q.who.map((w) => w.who))].join(" and ");
    const bad = q.nose + q.mouth + q.lip;
    if (bad > 0.05) {
      out.fault = q.nose > 0.05 ? "nose" : "mouth";
      const what = [q.nose > 0.05 ? `nose or eyes for ${r1(q.nose)} s` : "", q.mouth > 0.05 ? `mouth for ${r1(q.mouth)} s` : "", q.lip > 0.05 ? `lower lip for ${r1(q.lip)} s` : ""].filter(Boolean).join(", ");
      const atFloor = best.top >= lowest - step;
      const avoid = [s.forced ? "a larger lift than the one fixed" : raise !== "full" && s.by !== "room" && s.by !== "none" ? `--raise ${raise === "head" ? "mouth or full" : "full"} (the picture higher, the eyes nearer the apps' top bar)` : "",
        !atFloor ? "a lower top for the type (smaller type)" : "", "a cut to another shot here, or a moment without this stretch", !s.room || s.room.none ? "" : "the shot shown whole (smaller, its face clear of the type)"].filter(Boolean).join(", ");
      conflicts.push(`${span}: the type lies on ${who}'s ${what}${q.lift ? ` (raised ${q.lift} px, as far as ${s.by === "fixed" ? "fixed" : s.by === "eyeLine" ? `the eyes at ${Math.round(D.eyeLine * 100)} % of the height allow` : s.by === "eyes" ? "the eyes below the apps' top bar allow" : s.by === "head" ? "the head kept whole allows" : "the framing and the apps' bottom allow"})` : ""}${atFloor ? `, with the type at its smallest (${Math.round(D.area.least * 100)} % of the height)` : ""}. What would avoid it: ${avoid}.`);
    } else if (q.hair > 0.05 || q.chin > 0.05) notes.push(`${span}: the type lies on ${who}'s ${[q.hair > 0.05 ? `hair or forehead for ${r1(q.hair)} s, above the eyes` : "", q.chin > 0.05 ? `chin or neck for ${r1(q.chin)} s, below the mouth` : ""].filter(Boolean).join(", and on the ")}.`);
    if (headCut.byLift > 0) notes.push(`${span}: raised ${q.lift} px for the type, the frame cuts ${who ? `${who}'s` : "the"} head at the top by up to ${headCut.byLift} px more${Number.isFinite(eyesTop) ? `, ${eyesText(eyesAre, eyesTop / H)} at their highest` : ""}.`);
    return out;
  });
  if (best.lower > 0.25) notes.push(`The type's area starts at y ${r0(best.top)}, ${r0(best.top - usual)} px below its usual top (${r0(usual)}): its type is ${Math.round((1 - (bottom - best.top) / (bottom - usual)) * 100)} % smaller at most, so that it keeps off the faces' mouths.`);
  const faced = list.some((s) => s.moments.some((m) => m.faces.length));
  return {
    frame: `${W}x${H}`, size: [W, H], platforms: (Z.platforms || []).map((p) => p.name), safe: S, raise,
    area: { box: best.box, top: best.top, bottom: r1(bottom), height: r1(bottom - best.top), share: Math.round(((bottom - best.top) / H) * 1000) / 1000, usual: r1(usual), least: r1(lowest), lower: r1(best.top - usual), where: faced ? "below-mouths" : "no-face",
      seconds: { nose: r1(best.per.reduce((n, q) => n + q.nose, 0)), hair: r1(best.per.reduce((n, q) => n + q.hair, 0)), mouth: r1(best.per.reduce((n, q) => n + q.mouth, 0)), lip: r1(best.per.reduce((n, q) => n + q.lip, 0)), chin: r1(best.per.reduce((n, q) => n + q.chin, 0)) },
      lifted: best.per.filter((q) => q.lift > 0).length },
    shots: shotsOut, conflicts, notes,
    candidates: candidates.reduce((kept, c) => (kept.some((d) => Math.abs(d.top - c.top) < H * 0.02) ? kept : [...kept, c]), []).slice(0, 5)
      .map((c) => ({ top: c.top, share: Math.round(((bottom - c.top) / H) * 1000) / 1000, cost: r1(c.cost), mouth: r1(c.per.reduce((n, q) => n + q.nose + q.mouth + q.lip, 0)), chin: r1(c.per.reduce((n, q) => n + q.chin, 0)), lifted: c.per.filter((q) => q.lift > 0).length, liftPx: c.per.reduce((n, q) => n + q.lift, 0),
        // the type's size there against at the usual top, and which shot goes up how far
        size: Math.round(((bottom - c.top) / (bottom - usual)) * 1000) / 1000, lifts: c.per.map((q, i) => ({ shot: i, ...(list[i].n != null ? { n: list[i].n } : {}), px: q.lift })).filter((x) => x.px > 0) })),
  };
}
