// Text over a picture that is placed already, for a whole clip: the frame's shots, each with its
// faces over time in px of the frame (a framing tool knows them), and where one place for the
// captions serves them all. A caption that jumps from shot to shot reads badly (published Shorts
// keep it in one place within a video), so the place is one for the clip; what may differ per shot
// is how high the shot's picture stands: a shot whose faces reach into the captions' area is
// raised (`lift`, px), as far as its framing allows (`room`) and as the zones allow. The hook
// finds its place on the shots it is shown over, beside the captions.
//
//   textOverTime({ zones, shots, needs, set, fixed }) → { caption, shots, hook, candidates,
//       changes, conflicts, notes }
//
// shots: [{ n?, start, end, weight?, picture?: [x, y, w, h], faces: [{ who, track: [{ t, box }] }],
//   room?: { free, ground? } | null }]: times in seconds of one clock, boxes in px of the frame
//   as the picture stands unraised; weight: the seconds of the shot the video shows (default
//   end − start); n: the shot's number in the caller's list, for the sentences; room: how far
//   the picture may be raised without a ground (free: the framing moves its window in the footage) and at most (ground: over a ground; default as far as the
//   ground stays under the apps' bottom), null or { none: true }: not at all (a shot shown whole,
//   two panels).
// needs: [{ role: "caption", lines }, { role: "hook", kind?, start, end }]
// fixed: what the caller decided: { y, font, lifts: { <shot index>: px } }
//
// The rules are layout's own (lib/text.mjs, lib/defaults.mjs): a face keeps text out of its box
// and the margins around it (DEFAULTS.free), the captions' area is as tall as captions' tallest
// style at the type and lines, the hook is a short text below the chin or above the head, else a
// card at the top (layoutText). What is new here is time: every moment of every face counts.

import { EPS, X1, Y1, area, inter, grow } from "./boxes.mjs";
import { DEFAULTS, merged, scaled } from "./defaults.mjs";
import { keepOut, captionHeight, layoutText } from "./text.mjs";

// What placing costs, in points; a second of text on a face outweighs everything else.
export const COSTS = {
  // a second in which the captions' area lies on a face's keep-out (its box with the margins),
  // and on top of it by how deep into the face's own box it reaches from the chin, a share of
  // its height: on the chin alone a little, on the mouth (a quarter up) much more
  touch: 10, cover: 30,
  // a second in which the captions reach above a face's mouth line (MOUTH): never taken while a
  // smaller type (down to caption.font.least) or another height avoids it; above its nose line
  // (NOSE: the nose and the eyes) never while any place avoids it
  mouth: 1000, nose: 100000,
  // raising a shot's picture, for every second of it and every tenth of the frame's height: by
  // moving its window in the footage (the face higher in the picture, nothing else changes), and
  // over a ground (a band of the blurred picture at the bottom, under the apps' bottom)
  liftFree: 1, liftGround: 4,
  // the captions' middle outside where published Shorts have it (60–75 % of the height), for every
  // per cent of the height and every ten seconds of the clip; type smaller than the usual, for
  // every px and every ten seconds
  away: 1, smaller: 1,
  // a place for the captions that changes at a cut: what one change costs, in seconds of text on a
  // face it must save
  change: 2,
};
// the usual place of the captions' middle, in shares of the frame's height (240 published Shorts:
// below the chin in 88 % of the frames with a face, the middle at 60–75 %, the place fixed within
// a video)
export const USUAL = [0.6, 0.75];
// smaller type the captions may take where it clears a face: 90 % and 80 % of the usual (the
// published middle half is 3.2–4.9 % of the height, the usual 4 %)
export const SMALLER = [0.9, 0.8, 0.7];
// The eyes and the nose are a hard limit at every size: the line through a face's nose, 70 % of the
// way down its eyes, nose and mouth (feat: the eyes at its top, the mouth at its bottom; a guess
// from that box), else 55 % of the face's box from its top (ten points above MOUTH).
export const NOSE_IN_FEAT = 0.7, NOSE = 0.55;
// The mouth line, a share of a face's box from its top: text below it lies on the chin or the neck,
// above it on the mouth, the nose or the eyes. On eleven stills of the five passages (2026-11-18)
// the mouth of a model's box (forehead to chin, followed in the frames) lay at 65–85 % of its
// height: the boxes run large and drift a little; the line takes the highest seen.
export const MOUTH = 0.65;
// How far a shot may be raised. moderate: while the whole head stays in the picture (the top of
// the face's box and the margin layout keeps above a head for the hair, DEFAULTS.free.above, stay
// below the frame's top); full: until the eyes reach the safe box's top, the head cut by the frame.
export const RAISE = ["moderate", "full"];
// Where a caller knows a face's eyes, nose and mouth (`feat`, a box of its own: clips' framing has
// them from the model's features_2d), they are taken instead of the shares of the box: the mouth
// line is the features' bottom, the eyes their top.
const mouthOf = (f) => (f.feat ? Y1(f.feat) : f.box[1] + MOUTH * f.box[3]);
const eyesOf = (f, D) => (f.feat ? f.feat[1] : f.box[1] + D.eyes * f.box[3]);
// the part of a face (its box raised by lift) from its top down to its mouth line
const upper = (f, lift) => [f.box[0], f.box[1] - lift, f.box[2], mouthOf(f) - f.box[1]];
const noseOf = (f) => (f.feat ? f.feat[1] + NOSE_IN_FEAT * f.feat[3] : f.box[1] + NOSE * f.box[3]);
const above = (f, lift) => [f.box[0], f.box[1] - lift, f.box[2], noseOf(f) - f.box[1]];

const r0 = (v) => Math.round(v);
const r1 = (v) => Math.round(v * 10) / 10;

// the moments of a shot: every face's boxes, with how long each stands (half the gap to its
// neighbours, within the shot)
function momentsOf(shot) {
  const ts = [...new Set(shot.faces.flatMap((f) => f.track.map((m) => m.t)))].sort((a, b) => a - b);
  if (!ts.length) return [];
  return ts.map((t, i) => {
    const a = i ? (ts[i - 1] + t) / 2 : shot.start, b = i < ts.length - 1 ? (t + ts[i + 1]) / 2 : shot.end;
    const faces = shot.faces.map((f) => { const m = f.track.find((q) => Math.abs(q.t - t) < 1e-6) || nearest(f.track, t); return m?.box ? { who: f.who, box: m.box, ...(m.feat ? { feat: m.feat } : {}) } : null; }).filter(Boolean);
    return { t, dt: Math.max(0, b - a), faces };
  });
}
function nearest(track, t) {
  let best = null;
  for (const m of track) if (!best || Math.abs(m.t - t) < Math.abs(best.t - t)) best = m;
  // a face not tracked near this moment is not there
  return best && Math.abs(best.t - t) <= 0.26 ? best : null;
}
const up = (b, d) => [b[0], b[1] - d, b[2], b[3]];
const overlapsX = (a, b) => Math.min(X1(a), X1(b)) - Math.max(a[0], b[0]) > EPS;

// how far a shot may be raised: its room, and what the zones allow: the ground stays under the
// apps' bottom (below the safe box), and every face's eyes stay below the safe box's top
function maxLift(shot, moments, ctx) {
  const room = shot.room;
  if (!room || room.none) return { most: 0, by: "none" };
  const free = Math.max(0, room.free || 0);
  const ground = room.ground != null ? Math.max(0, room.ground) : ctx.H - Y1(ctx.Z.safe);
  let most = free + ground, by = "room";
  for (const m of moments) for (const f of m.faces) {
    const eyes = eyesOf(f, ctx.D) - ctx.Z.safe[1];
    if (eyes < most) { most = eyes; by = "eyes"; }
    if (ctx.raise !== "full") {
      const head = f.box[1] - Math.max(ctx.D.free.aboveMin, ctx.D.free.above * f.box[3]);
      if (head < most) { most = head; by = "head"; }
    }
  }
  return { most: Math.max(0, Math.floor(most)), by };
}

// one shot under one caption box: the least lift that clears it (within `most`), the seconds and
// the share of a face the box still lies on
function shotUnder(cap, moments, most, D, exact = false) {
  let need = 0, below = false;
  for (const m of moments) for (const f of m.faces) {
    const k = keepOut(f.box, D);
    if (!overlapsX(k, cap) || inter(k, cap) <= 0) continue;
    // a face whose middle stands above the captions' middle is cleared by raising it; one below
    // (captions above a head) is not
    if (f.box[1] + f.box[3] / 2 < cap[1] + cap[3] / 2) need = Math.max(need, Y1(k) - cap[1]);
    else below = true;
  }
  const lift = exact ? most : Math.min(most, Math.ceil(need));
  let seconds = 0, share = 0, mouth = 0, nose = 0;
  const who = new Map();
  for (const m of moments) {
    let on = false, onMouth = false, onNose = false;
    for (const f of m.faces) {
      if (inter(keepOut(up(f.box, lift), D), cap) <= 0) continue;
      on = true;
      const b = up(f.box, lift);
      // the part of the box above its mouth line
      if (inter(upper(f, lift), cap) > 0) onMouth = true;
      if (inter(above(f, lift), cap) > 0) onNose = true;
      // how deep into the face from its chin: a share of its height (0 where the box is not reached)
      const s = inter(b, cap) > 0 ? Math.min(1, Math.max(0, (Y1(b) - Math.max(cap[1], b[1])) / b[3])) : 0;
      share = Math.max(share, s);
      const w = who.get(f.who) || { who: f.who, seconds: 0, share: 0, mouth: 0, from: m.t, to: m.t };
      w.seconds += m.dt; w.share = Math.max(w.share, s); w.from = Math.min(w.from, m.t); w.to = Math.max(w.to, m.t);
      if (inter(upper(f, lift), cap) > 0) w.mouth += m.dt;
      who.set(f.who, w);
    }
    if (on) seconds += m.dt;
    if (onMouth) mouth += m.dt;
    if (onNose) nose += m.dt;
  }
  return { lift: Math.max(0, lift), need: Math.ceil(need), seconds, share, mouth, nose, below, who: [...who.values()] };
}

// whether captions stand above the heads more often than below the chins
function aboveHeads(cap, list) {
  let above = 0, below = 0;
  for (const s of list) for (const m of s.moments) for (const f of m.faces) {
    if (Y1(cap) <= f.box[1] + f.box[3] / 2) above += m.dt; else below += m.dt;
  }
  return above > below;
}

export function textOverTime({ zones: Z, shots, needs = [], set = {}, fixed = {}, costs = COSTS, raise = "moderate" }) {
  if (!RAISE.includes(raise)) throw new Error(`raise is ${RAISE.join(" or ")}, not "${raise}".`);
  const [W, H] = Z.size;
  const D = scaled(merged(DEFAULTS, set), Z.size);
  const tall = W <= H;
  const S = Z.safe, C = Z.centred;
  const ctx = { W, H, Z, D, tall, raise };
  const cap = needs.find((n) => n.role === "caption") || null, hook = needs.find((n) => n.role === "hook") || null;
  const list = shots.map((s, i) => {
    const moments = momentsOf(s);
    const ml = maxLift(s, moments, ctx);
    return { ...s, i, weight: s.weight ?? s.end - s.start, moments, most: fixed.lifts?.[i] != null ? Math.max(0, fixed.lifts[i]) : ml.most, by: fixed.lifts?.[i] != null ? "fixed" : ml.by, forced: fixed.lifts?.[i] != null };
  });
  const total = list.reduce((n, s) => n + s.weight, 0) || 1;
  const notes = [];

  // the captions' candidates: every height from the safe box's bottom up to its top in steps of
  // half a per cent, at the usual type and smaller (one place for the whole clip)
  const candidates = [];
  if (cap) {
    const f0 = tall ? D.caption.font.tall : D.caption.font.wide;
    // smaller type down to the low end of published captions (caption.font.least), never below: a
    // size given by hand (--font-size) is taken as it is
    const fonts = fixed.font ? [fixed.font] : [f0, ...SMALLER.map((k) => Math.round(f0 * k)).filter((f) => f >= (tall ? D.caption.font.least : 0))];
    const cx0 = Math.max(0, ...Z.crops.map((c) => c.box[0])), cx1 = Math.min(W, ...Z.crops.map((c) => X1(c.box)));
    for (const font of fonts) {
      const Df = { ...D, caption: { ...D.caption, font: { tall: font, wide: font } } };
      const h = captionHeight({ cap, D: Df, tall });
      const w = Math.min(C[2], D.caption.maxEm * font, Math.max(tall ? D.caption.minWidth.tall : D.caption.minWidth.wide, 2 * Math.min(W / 2 - cx0, cx1 - W / 2)));
      const step = Math.max(1, Math.round(H * 0.005));
      const ys = fixed.y != null ? [fixed.y] : [];
      if (fixed.y == null) for (let y = Y1(S); y - h >= S[1] - EPS; y -= step) ys.push(y);
      for (const yb of ys) {
        const box = [W / 2 - w / 2, yb - h, w, h];
        let cost = 0, touch = 0, cover = 0, liftCost = 0, mouth = 0, nose = 0;
        const per = list.map((s) => {
          // a lift the caller fixed stands as given
          const r = shotUnder(box, s.moments, s.most, D, s.forced);
          const free = Math.min(r.lift, Math.max(0, s.room?.free || 0)), ground = r.lift - free;
          const k = s.weight / Math.max(1e-6, s.end - s.start);
          const sec = r.seconds * k;
          touch += sec; cover += sec * r.share; mouth += r.mouth * k; nose += r.nose * k;
          liftCost += s.weight * (free * costs.liftFree + ground * costs.liftGround) / (0.1 * H);
          return { ...r, seconds: sec, free, ground };
        });
        const mid = (yb - h / 2) / H;
        const away = Math.max(0, USUAL[0] - mid, mid - USUAL[1]) * 100;
        cost = touch * costs.touch + cover * costs.cover + mouth * costs.mouth + nose * costs.nose + liftCost + (away * costs.away + (f0 - font) * costs.smaller) * total / 10;
        candidates.push({ box: box.map(r1), font, lines: cap.lines, cost, touch, cover, mouth, liftCost, away, per });
      }
    }
    candidates.sort((a, b) => a.cost - b.cost || b.box[1] - a.box[1]);
  }
  const best = candidates[0] || null;

  // a place that changes at a cut: proposed for a shot that the clip's place leaves on a face for
  // longer than a change costs, where another place clears it without raising it further
  const changes = [];
  if (best) list.forEach((s, i) => {
    const mine = best.per[i];
    if (mine.seconds <= costs.change || s.weight < 2 * costs.change) return;
    const alt = candidates.filter((c) => c.font === best.font).map((c) => ({ c, r: c.per[i] })).sort((a, b) => a.r.seconds - b.r.seconds || a.r.lift - b.r.lift)[0];
    if (alt && mine.seconds - alt.r.seconds > costs.change) changes.push({ shot: i, start: s.start, end: s.end, box: alt.c.box, saves: r1(mine.seconds - alt.r.seconds), lift: alt.r.lift });
  });

  // the hook: on the shots it is shown over (each as its lift raises it), beside the captions
  let hookOut = null;
  if (hook) {
    const lifts = best ? best.per.map((r) => r.lift) : list.map(() => 0);
    const place = (from, to) => {
      const over = list.filter((s) => s.end > from + EPS && s.start < to - EPS);
      const faces = [], keep = [];
      for (const s of over) for (const m of s.moments) {
        if (m.t < from - 0.05 || m.t > to + 0.05) continue;
        for (const f of m.faces) {
          const b = up(f.box, lifts[s.i]);
          faces.push(b); keep.push(keepOut(b, D));
          // eyes, nose and mouth where known (inside the box; kept apart in case a box was cut short)
          if (f.feat) keep.push(grow(up(f.feat, lifts[s.i]), D.gap));
        }
      }
      const r = layoutText({ ...ctx, cap: null, hook: hook.kind ? { kind: hook.kind } : {} }, faces, keep, [0, 0, W, H], false, { placed: best ? [best.box] : [] });
      return r.placed[0] ? { ...r.placed[0], over: over.map((s) => s.i) } : null;
    };
    let h = place(hook.start, hook.end), until = hook.end, why = null;
    if (!h) {
      // the first shot changes within the hook's time and the next leaves it no place: it ends at the cut
      const cut = list.find((s) => s.start > hook.start + 1.2 && s.start < hook.end - EPS);
      if (cut) { h = place(hook.start, cut.start); if (h) { until = cut.start; why = `it ends at the cut at ${r1(cut.start)} s: the shot after it leaves it no place`; } }
    }
    if (h) {
      hookOut = { kind: h.style === "card" ? "card" : "text", box: h.box.map(r1), font: h.font, lines: h.lines, where: h.where, start: hook.start, until: r1(until), ...(why ? { why } : {}), ...(h.shrunk ? { shrunk: true } : {}) };
      // a text over a picture that is not calm behind it (hands, objects, a photo: the caller says,
      // hook.calm) stands as a card in the same place: its own white ground reads over anything
      if (hookOut.kind === "text" && hook.calm === false) {
        const hc = D.hookCard;
        hookOut.kind = "card";
        hookOut.font = Math.max(hc.minFont, Math.min(h.font, Math.floor(h.box[3] / hc.heightEm)));
        hookOut.kindWhy = "a card in the text's place: behind it the picture is not calm (the caller said so)";
      } else hookOut.kindWhy = hookOut.kind === "text" ? "a text: behind it the picture is calm" : "a card: no place for a text clear of the faces";
    }
    else {
      // nowhere free: the least bad of the hook's usual places, with what it lies on
      const tries = [];
      const ht = D.hookText, hc = D.hookCard, z0 = Z.wide || [C[0], S[1], C[2], S[3] / 2];
      const tw = Math.min(ht.width * W, C[2]);
      tries.push({ kind: "text", font: ht.minFont, box: [W / 2 - tw / 2, ht.centre * H - ht.minFont * ht.heightEm / 2, tw, ht.minFont * ht.heightEm], where: "middle" });
      tries.push({ kind: "card", font: hc.minFont, box: [z0[0], z0[1], z0[2], hc.minFont * hc.heightEm], where: "top" });
      for (const x of tries) {
        x.seconds = 0; x.share = 0;
        for (const s of list) for (const m of s.moments) {
          if (m.t < hook.start || m.t > hook.end) continue;
          const on = m.faces.filter((f) => inter(up(f.box, lifts[s.i]), x.box) > 0);
          if (on.length) { x.seconds += m.dt; x.share = Math.max(x.share, ...on.map((f) => inter(up(f.box, lifts[s.i]), x.box) / area(f.box))); }
        }
      }
      tries.sort((a, b) => a.seconds * (1 + a.share) - b.seconds * (1 + b.share));
      const x = tries[0];
      hookOut = { kind: x.kind, box: x.box.map(r1), font: x.font, lines: 2, where: x.where, start: hook.start, until: r1(hook.end), onFace: { seconds: r1(x.seconds), share: Math.round(x.share * 100) / 100 } };
      if (!(x.seconds > 0)) notes.push(`The hook found no place clear of the faces' margins on the shots it is shown over; it stands ${x.where === "top" ? "at the top" : "in the middle"}, on no face but within a face's margin (the hair, the ears, the neck): look at it on the sheet.`);
    }
  }

  // what is left on a face, each in one sentence that says what would avoid it
  const conflicts = [];
  const shotsOut = list.map((s, i) => {
    const r = best ? best.per[i] : { lift: 0, free: 0, ground: 0, seconds: 0, share: 0, who: [], need: 0 };
    const out = { shot: i, start: s.start, end: s.end, lift: r.lift, free: r.free, ground: r.ground, band: r.ground, most: s.most, limit: s.by, ...(s.forced ? { fixed: true } : {}),
      touches: r.who.map((w) => ({ role: "caption", who: w.who, from: r1(w.from), to: r1(w.to), seconds: r1(w.seconds), mouth: r1(w.mouth), share: Math.round(w.share * 100) / 100 })) };
    if (best && r.seconds > 0.05) {
      const who = [...new Set(r.who.map((w) => w.who))].join(" and "), short = r.need - r.lift;
      const span = `Shot ${s.n ?? i + 1} (${r1(s.start)}–${r1(s.end)} s)`;
      if (r.nose > 0.05) {
        out.chin = false;
        conflicts.push(`${span}: the captions reach ${who}'s nose or eyes for ${r1(r.nose)} s wherever they stand. What would avoid it: a cut to another shot here, a smaller picture for this shot, or --raise full.`);
      } else if (r.mouth > 0.05) {
        // on the lower lip at a readable size: said, not a fault
        out.chin = true; out.lip = r1(r.mouth);
        notes.push(`${span}: the captions lie on ${who}'s chin for ${r1(r.seconds)} s and on the lower lip for ${r1(r.mouth)} s: not avoidable at a readable size (${best.font} px; the low end of published captions is ${D.caption.font.least} px)${s.by === "head" ? " without cutting the head" : ""}. Remedies: --raise full (the head cut by the frame), a cut to another shot, or a smaller type by hand (--font-size).`);
      } else if (r.who.length && r.share === 0 && best.box[1] + best.box[3] / 2 < Math.min(...s.moments.flatMap((m) => m.faces.map((f) => f.box[1] + f.box[3] / 2)))) {
        // above the face, within the margin kept for the hair: no face covered
        notes.push(`${span}: the captions stand above ${who}'s face, on the hair, for ${r1(r.seconds)} s.`);
      } else if (s.room?.none) {
        conflicts.push(`${span}: the captions lie on ${who}'s face for ${r1(r.seconds)} s below the mouth, because its picture is shown whole or as two panels and is not raised. What would avoid it: a framing that follows the speaker in this shot.`);
      } else if (short > 0 && (s.by === "head" || s.by === "eyes" || s.by === "fixed")) {
        // on the chin or the neck, as far raised as the rule allows: said, not to be fixed
        out.chin = true;
        notes.push(`${span}: the captions lie on ${who}'s chin or neck for ${r1(r.seconds)} s, below the mouth: not avoidable without ${s.by === "head" ? "cutting the head by the frame's top (--raise full)" : s.by === "eyes" ? "the eyes going under the apps' top bar" : "a larger lift than the one fixed"} or a smaller picture (raised ${r.lift} px, it would need ${r0(short)} px more).`);
      } else {
        conflicts.push(`${span}: the captions lie on ${who}'s face for ${r1(r.seconds)} s below the mouth${short > 0 ? `; it would have to stand ${r0(short)} px higher than its framing and the apps' bottom allow` : ""}. What would avoid it: a cut to another shot here, or a smaller picture for this shot.`);
      }
    }
    return out;
  });
  if (hookOut?.onFace?.seconds > 0) conflicts.push(`The hook lies on a face for ${hookOut.onFace.seconds} s (up to ${Math.round(hookOut.onFace.share * 100)} % of it) wherever it stands on the first shot: no hook (the first line carries the clip), a shorter one that ends before the face reaches it, or a start on another shot would avoid it.`);
  for (const c of changes) notes.push(`Shot ${list[c.shot].n ?? c.shot + 1} (${r1(c.start)}–${r1(c.end)} s) would keep its captions off the face with a place of its own (y ${r0(c.box[1])}–${r0(Y1(c.box))}), saving ${c.saves} s: proposed, not taken; a place that changes at a cut costs the reading the one place gives.`);

  const capOut = best ? {
    box: best.box, font: best.font, lines: best.lines, align: "center", least: tall ? D.caption.font.least : null,
    middle: Math.round(((best.box[1] + best.box[3] / 2) / H) * 1000) / 10,
    where: aboveHeads(best.box, list) ? "above-head" : "below-chin",
    // agentitos' captions: the lowest line ends at y, at most max-width wide, centred
    options: { y: r0(Y1(best.box)), "max-width": Math.floor(best.box[2]), "font-size": best.font, lines: best.lines },
    seconds: r1(best.touch), lifted: best.per.filter((r) => r.lift > 0).length,
  } : null;
  return {
    frame: `${W}x${H}`, size: [W, H], platforms: (Z.platforms || []).map((p) => p.name), safe: S,
    caption: capOut, shots: shotsOut, hook: hookOut, changes, conflicts, notes,
    candidates: candidates.filter((c, i, a) => a.findIndex((d) => d.font === c.font && Math.abs(d.box[1] - c.box[1]) < H * 0.02) === i).slice(0, 5)
      .map((c) => ({ box: c.box, font: c.font, cost: r1(c.cost), seconds: r1(c.touch), lifted: c.per.filter((r) => r.lift > 0).length, liftPx: c.per.reduce((n, r) => n + r.lift, 0), middle: Math.round(((c.box[1] + c.box[3] / 2) / H) * 1000) / 10 })),
  };
}
