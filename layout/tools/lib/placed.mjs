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
//   measureOver({ shots, boxes }) → [{ name, box, start, end, seconds, nose, hair, maybe, mouth, lip,
//       chin, faces, moments }]: texts placed already (the caller's boxes), what they lie on
//
// shots: [{ n?, start, end, weight?, picture?: [x, y, w, h], faces: [{ who, track: [{ t, box, feat?, between? }] }],
//   room?: { free, ground? } | null }]: times in seconds of one clock, boxes in px of the frame
//   (feat: the eyes, nose and mouth; between: the two stills they are an estimate between, where
//   the caller's features are one, said with the seconds on the lower lip they give)
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
  // its height: on the chin alone a little, higher up much more
  touch: 10, cover: 30,
  // a second in which the captions reach above a face's mouth line (on the lower lip): never taken
  // while a smaller type (down to caption.font.least) or another height avoids it; above its lip
  // line (on the mouth, both lips) never while a raise or any place off the eyes and the forehead
  // avoids it; from its nose line up to the eyes' top with the brows (the nose and the eyes) never
  // while anything avoids it
  lip: 1000, mouth: 20000, nose: 100000,
  // a second in which they lie on the hair or the forehead (inside the head's box, above the eyes'
  // top, PARTS) and on nothing lower: half the eyes' cost, two and a half times the mouth's. Captions
  // belong below the chin (published Shorts: in 88 % of the frames with a face), and a line across
  // a forehead stands far above where they are read; before the parts were told apart (2026-11-19)
  // a forehead counted as the eyes, and above the mouth's cost no place on the chin, the lower lip
  // or the mouth gives way to one on a forehead it did not give way to then, unless that saves
  // more than two and a half times its seconds on a mouth. Large type (lib/area.mjs) weighs it
  // alike. A hook is weighed otherwise (leastBad): there a forehead is mild, a title over the hair
  // is what editors do where a head fills the frame.
  hair: 50000,
  // raising a shot's picture, for every second of it and every tenth of the frame's height: by
  // moving its window in the footage (the face higher in the picture, nothing else changes), and
  // over a ground (a band of the blurred picture at the bottom, under the apps' bottom)
  liftFree: 1, liftGround: 4,
  // a second of a shot raised past its head's top (moderately, for a mouth): more than the type
  // down to the floor costs, so that a smaller type comes first and the head is cut only where
  // even the floor would cover the mouth
  past: 50,
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
// smaller type the captions may take where it clears a face: 90 %, 80 % and 70 % of the usual,
// never below caption.font.least (the published middle half is 3.2–4.9 % of the height, the usual 4 %)
export const SMALLER = [0.9, 0.8, 0.7];
// The lines of a face, from its eyes, nose and mouth (feat: a box from the eyes' top to the
// mouth's bottom, clips' framing has it from the model's eyes, nose and mouth): the nose line 70 %
// of the way down it (text above it lies on the nose or the eyes), the lip line 88 % down (the
// middle of the mouth: text above it covers both lips), and the mouth line its bottom and OPEN of
// its height more (an open mouth's lower lip drops below the box the model gives of a still, and a
// head that tips between two stills carries its mouth lower in its box: on the rendered frames of
// three talk-show clips the lower lip stood up to 7, 8 and 28 % of that height below the box in
// nine frames of ten; text below that line lies on the chin). Without feat, the eyes, nose
// and mouth are taken from the box by the head's proportions (IMPLIED: from 38 % to 86 % of its
// height, the low end of the mouths measured on stills whose features were right, as clips'
// framing takes them where the model's do not hold), so that a line is never above the real one.
export const NOSE_IN_FEAT = 0.7, LIP_IN_FEAT = 0.88, OPEN = 0.15, IMPLIED = [0.38, 0.86];
// (the mouth line without feat, a share of the box from its top)
export const MOUTH = +(IMPLIED[0] + (1 + OPEN) * (IMPLIED[1] - IMPLIED[0])).toFixed(3);
// How far a shot may be raised, the caller's choice of three:
//   head  never so far that a head inside the picture goes over the frame's top (its box's top
//         and the margin layout keeps above a head for the hair, DEFAULTS.free.above), nor a head
//         the frame cuts already further: the type goes to its floor first, and what is left lies
//         on the chin or the lower lip, said;
//   mouth (the default) as head, and further, the head's top cut, where the captions would
//         otherwise lie on a mouth or a lower lip and that costs less than the seconds it saves,
//         never with the eyes above DEFAULTS.eyeLine of the height (a limit of composition);
//   full  until the chin is clear, as far as the eyes reach the safe box's top.
// "moderate" (the name of before) is mouth.
export const RAISE = ["head", "mouth", "full"];
export const raiseOf = (r) => (r === "moderate" ? "mouth" : r);
export const featOf = (f) => f.feat || [f.box[0] + 0.18 * f.box[2], f.box[1] + IMPLIED[0] * f.box[3], 0.64 * f.box[2], (IMPLIED[1] - IMPLIED[0]) * f.box[3]];
const lineOf = (f, k) => { const e = featOf(f); return e[1] + k * e[3]; };
export const noseOf = (f) => lineOf(f, NOSE_IN_FEAT), lipOf = (f) => lineOf(f, LIP_IN_FEAT), mouthOf = (f) => lineOf(f, 1 + OPEN);
export const eyesOf = (f, D) => (f.feat ? f.feat[1] : f.box[1] + D.eyes * f.box[3]);
// Where the eyes begin, with their brows: text inside the head's box above this line lies on the
// hair or the forehead, not on the eyes. With the eyes, nose and mouth (feat), their top: clips'
// framing asks the model for the eyes with their brows, and the box of all three begins there.
// Without them, BROWS of the head's height below its top: the high end of where the model's eyes
// with their brows began, so that the eyes are never taken to begin lower than they do. On 220
// stills of the three-way talk-show clips (version 4 answers, layout-data/layout-forehead) they
// began from 0.06 to 0.50 of the head's height down, 0.29 in the median, higher than 0.15 on 12
// stills (one in twenty); IMPLIED's 0.38, from which the nose and the mouth are taken, lay below
// the brows' top on three stills of four.
export const BROWS = 0.15;
export const eyesTopOf = (f) => (f.feat ? f.feat[1] : f.box[1] + BROWS * f.box[3]);
// Of a head known by its box alone the eyes may begin as high as BROWS_HIGH of it: the highest the
// model's eyes with their brows began on those 220 stills (0.059; a head tipped back). From there
// down to where IMPLIED puts them they may be (the hook's onFace.maybe); text there that the parts
// count as the hair or forehead (above BROWS) is said as perhaps on the brows, this head's eyes
// not known (maybe), and weighed as the forehead.
export const BROWS_HIGH = 0.06;
export const eyesMayOf = (f) => (f.feat ? f.feat[1] : f.box[1] + BROWS_HIGH * f.box[3]);
// the box from where the eyes (with the brows) may begin down to the mouth's bottom
export const featuresOf = (f) => { const e = featOf(f), top = eyesMayOf(f); return [e[0], top, e[2], Y1(e) - top]; };
// whether a text box lies in a box-only head's band above BROWS where its eyes may begin
const inMaybe = (f, lift, box) => !f.feat && inter([f.box[0], eyesMayOf(f) - lift, f.box[2], eyesTopOf(f) - eyesMayOf(f)], box) > 0;
// The parts of a face a text lies on, from the mildest to the worst for captions and large type
// (COSTS), each only where the text overlaps it, as wide as the head's box: the chin (below the
// mouth line, and the margins kept around the box: the hair above it, the ears, the neck), the
// lower lip (above the mouth line), the mouth (both lips, above the lip line), the hair or the
// forehead (inside the box, above the eyes' top), the eyes or the nose (from the eyes' top with
// the brows down to the nose line).
export const PARTS = ["chin", "lip", "mouth", "hair", "nose"];
// the worst part of a face (its box raised by lift) a text box lies on, an index of PARTS: a text
// that reaches from the forehead into the eyes lies on the eyes
export function partOf(f, lift, box) {
  const across = (y0, y1) => y1 > y0 && inter([f.box[0], y0 - lift, f.box[2], y1 - y0], box) > 0;
  const eyes = eyesTopOf(f), nose = noseOf(f), lip = lipOf(f);
  return across(eyes, nose) ? 4 : across(nose, lip) ? 2 : across(lip, mouthOf(f)) ? 1 : across(f.box[1], eyes) ? 3 : 0;
}

const r0 = (v) => Math.round(v);
const r1 = (v) => Math.round(v * 10) / 10;

// the moments of a shot: every face's boxes, with how long each stands: half the gap to its
// neighbours, within the shot. A face known at one moment is not a face there for one moment: a
// sample is cut short only where its own track shows the face was there briefly, that is where the
// track is dense elsewhere in the shot (its usual gap, the median) and this sample stands alone,
// further than the larger of REACH and that usual gap from the samples (or the shot's edge) on
// both sides; it then reaches that far either way. A dense track that stops early stands to the
// shot's end as before. A shot with a single sample, or a track evenly sparse (one sample in two
// seconds), counts as before (the model saw the face on the shot's still: it is most likely there).
// (A reach fixed at REACH, the review of 2026-11-19, undercounted sparse tracks and changed
// captions: a mouth under them for 0.4 s that a raise had cleared.)
const REACH = 0.26;
function usualGap(track) {
  const gaps = track.slice(1).map((m, k) => m.t - track[k].t).filter((g) => g > 1e-6).sort((x, y) => x - y);
  return gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
}
export function momentsOf(shot) {
  const ts = [...new Set(shot.faces.flatMap((f) => f.track.map((m) => m.t)))].sort((a, b) => a - b);
  if (!ts.length) return [];
  const sorted = shot.faces.map((f) => [...f.track].sort((p, q) => p.t - q.t));
  const reach = sorted.map((tr) => { const g = usualGap(tr); return g == null ? Infinity : Math.max(REACH, g); });
  return ts.map((t, i) => {
    const a = i ? (ts[i - 1] + t) / 2 : shot.start, b = i < ts.length - 1 ? (t + ts[i + 1]) / 2 : shot.end;
    let from = Infinity, to = -Infinity;
    const faces = shot.faces.map((f, k) => {
      const m = f.track.find((q) => Math.abs(q.t - t) < 1e-6) || nearest(f.track, t);
      if (!m?.box) return null;
      const tr = sorted[k], j = tr.indexOf(m), prev = tr[j - 1], next = tr[j + 1], r = reach[k];
      const back = prev ? (m.t - prev.t) / 2 : m.t - shot.start, ahead = next ? (next.t - m.t) / 2 : shot.end - m.t;
      const alone = back > r && ahead > r;
      from = Math.min(from, alone ? m.t - r : -Infinity);
      to = Math.max(to, alone ? m.t + r : Infinity);
      return { who: f.who, box: m.box, ...(m.feat ? { feat: m.feat } : {}), ...(m.feat && m.between ? { between: m.between } : {}), ...(m.zoom ? { zoom: m.zoom } : {}), ...(m.eye != null ? { eye: m.eye } : {}) };
    }).filter(Boolean);
    return { t, dt: faces.length ? Math.max(0, Math.min(b, to) - Math.max(a, from)) : Math.max(0, b - a), faces };
  });
}
function nearest(track, t) {
  let best = null;
  for (const m of track) if (!best || Math.abs(m.t - t) < Math.abs(best.t - t)) best = m;
  // a face not tracked near this moment is not there
  return best && Math.abs(best.t - t) <= REACH ? best : null;
}
export const up = (b, d) => [b[0], b[1] - d, b[2], b[3]];
export const overlapsX = (a, b) => Math.min(X1(a), X1(b)) - Math.max(a[0], b[0]) > EPS;

// how far a shot may be raised: its room, and what the zones allow: the ground stays under the
// apps' bottom (below the safe box), and every face's eyes stay below the safe box's top
// (most: by the rule of the raise; beyond: by the eyes alone, for a mouth the captions would cover)
export function maxLift(shot, moments, ctx) {
  const room = shot.room;
  if (!room || room.none) return { most: 0, beyond: 0, by: "none", beyondBy: "none" };
  const free = Math.max(0, room.free || 0);
  const ground = room.ground != null ? Math.max(0, room.ground) : ctx.H - Y1(ctx.Z.safe);
  let most = free + ground, by = "room";
  // (a moment's zoom: the picture grows after the raise there, and the lift with it)
  for (const m of moments) for (const f of m.faces) {
    const eyes = (eyesOf(f, ctx.D) - ctx.Z.safe[1]) / (f.zoom || 1);
    if (eyes < most) { most = eyes; by = "eyes"; }
  }
  // mouth: the eyes no higher than where published Shorts have them at the most (eyeLine), a
  // limit of composition; full keeps the apps' top bar as its limit
  if (ctx.raise === "mouth") for (const m of moments) for (const f of m.faces) {
    const eyes = (eyesOf(f, ctx.D) - ctx.D.eyeLine * ctx.H) / (f.zoom || 1);
    if (eyes < most) { most = eyes; by = "eyeLine"; }
  }
  // (what limits beyond: the head's top below does not)
  let beyond = Math.max(0, Math.floor(most)), beyondBy = by;
  if (ctx.raise !== "full") for (const m of moments) for (const f of m.faces) {
    const head = (f.box[1] - Math.max(ctx.D.free.aboveMin, ctx.D.free.above * f.box[3])) / (f.zoom || 1);
    if (head < most) { most = head; by = "head"; }
  }
  most = Math.max(0, Math.floor(most));
  // head: not past the head's top for a mouth either
  if (ctx.raise === "head") { beyond = most; beyondBy = by; }
  return { most, beyond, by, beyondBy };
}

// One shot under one caption box: the least lift that clears it (within `most`), the seconds and
// the share of a face the box still lies on, and of those the seconds on each part: the nose or the
// eyes, the hair or the forehead, the mouth (both lips), the lower lip. Where that lift leaves the
// captions on a mouth or a nose or the lower lip, the shot goes higher, to `beyond` at most, until
// every mouth line clears them, where that costs less than it saves (`past`: the head's top cut by
// the frame for it).
function shotUnder(cap, moments, most, D, exact = false, beyond = most, price = null) {
  let need = 0, needMouth = 0, below = false;
  for (const m of moments) for (const f of m.faces) {
    const k = keepOut(f.box, D);
    // a face whose middle stands above the captions' middle is cleared by raising it; one below
    // (captions above a head) is not
    const higher = f.box[1] + f.box[3] / 2 < cap[1] + cap[3] / 2;
    if (higher && overlapsX(f.box, cap)) needMouth = Math.max(needMouth, mouthOf(f) - cap[1]);
    if (!overlapsX(k, cap) || inter(k, cap) <= 0) continue;
    if (higher) need = Math.max(need, Y1(k) - cap[1]);
    else below = true;
  }
  const measure = (lift) => {
    let seconds = 0, share = 0, mouth = 0, nose = 0, hair = 0, maybe = 0, lip = 0, lipEst = 0;
    const who = new Map();
    for (const m of moments) {
      let on = false, part = 0, est = false, may = false;
      for (const f of m.faces) {
        if (inter(keepOut(up(f.box, lift), D), cap) <= 0) continue;
        on = true;
        const b = up(f.box, lift);
        // the part reached (PARTS): 4 the eyes or the nose, 3 the hair or the forehead, 2 the mouth,
        // 1 the lower lip, 0 the chin or below
        const p = partOf(f, lift, cap);
        part = Math.max(part, p);
        // how deep into the face from its chin: a share of its height (0 where the box is not reached)
        const s = inter(b, cap) > 0 ? Math.min(1, Math.max(0, (Y1(b) - Math.max(cap[1], b[1])) / b[3])) : 0;
        share = Math.max(share, s);
        const w = who.get(f.who) || { who: f.who, seconds: 0, share: 0, nose: 0, hair: 0, maybe: 0, mouth: 0, lip: 0, lipEst: 0, stills: null, from: m.t, to: m.t };
        w.seconds += m.dt; w.share = Math.max(w.share, s); w.from = Math.min(w.from, m.t); w.to = Math.max(w.to, m.t);
        if (p === 4) w.nose += m.dt; else if (p === 3) w.hair += m.dt; else if (p === 2) w.mouth += m.dt; else if (p === 1) w.lip += m.dt;
        if (p === 3 && inMaybe(f, lift, cap)) { w.maybe += m.dt; may = true; }
        // on the lower lip by features that are an estimate between two stills (the caller's
        // between): the mouth may open lower there, onto the captions
        if (p === 1 && f.between) { w.lipEst += m.dt; w.stills ||= []; if (!w.stills.some((x) => x[0] === f.between[0] && x[1] === f.between[1])) w.stills.push([...f.between]); est = true; }
        who.set(f.who, w);
      }
      if (on) seconds += m.dt;
      if (part === 4) nose += m.dt; else if (part === 3) { hair += m.dt; if (may) maybe += m.dt; } else if (part === 2) mouth += m.dt; else if (part === 1) { lip += m.dt; if (est) lipEst += m.dt; }
    }
    return { seconds, share, nose, hair, maybe, mouth, lip, lipEst, who: [...who.values()] };
  };
  let lift = exact ? most : Math.min(most, Math.ceil(need)), past = false;
  let r = measure(lift);
  // past the head's top, as far as the mouth line clears or the eyes allow, where that costs less
  // than what it saves on the mouth and the lower lip (price: the caller's points of a result)
  if (!exact && price && (r.mouth > 0 || r.nose > 0 || r.hair > 0 || r.lip > 0) && beyond > lift) {
    const higher = Math.min(beyond, Math.max(lift, Math.ceil(needMouth)));
    if (higher > lift) { const q = measure(higher); if (price(q, higher, true) < price(r, lift, false)) { r = q; lift = higher; past = true; } }
  }
  return { ...r, lift: Math.max(0, lift), need: Math.ceil(need), needMouth: Math.ceil(needMouth), past, below };
}

// The largest type whose captions, ending where these end (cap: its box, font and lines), keep off
// the lower lip of every face they reach in a shot raised by lift: the area shrinks from its top,
// so the type must make it end below the lowest mouth line. { font: px (0: none), lip: that line }
function lipClearing(cap, moments, lift, D) {
  let lip = -Infinity;
  for (const m of moments) for (const f of m.faces) {
    if (!overlapsX(f.box, cap.box) || inter(keepOut(up(f.box, lift), D), cap.box) <= 0) continue;
    lip = Math.max(lip, mouthOf(f) - lift);
  }
  if (!Number.isFinite(lip)) return { font: cap.font, lip: null };
  const em = cap.lines * D.caption.line + D.caption.padEm;
  return { font: Math.max(0, Math.floor((Y1(cap.box) - lip) / em)), lip };
}

// the stills an estimate lies between, said: [[a, b], …] (a = b: before the first still or after
// the last, from that one alone)
export const stillsText = (pairs, f = r1) => {
  const two = pairs.filter(([a, b]) => a !== b), one = pairs.filter(([a, b]) => a === b);
  return [two.length ? `between the stills at ${two.map(([a, b]) => `${f(a)} and ${f(b)} s`).join(", ")}` : "", one.length ? `from the still at ${one.map(([a]) => `${f(a)} s`).join(", ")} alone` : ""].filter(Boolean).join(" and ");
};

// Returns of one framing (the same face, the same size, the same place in the frame: the camera
// cut back to a close-up it showed before) stand at one height: a close-up that comes back
// higher or lower each time reads as a camera that moves. [[shot index, …], …] of two or more.
export function returnsOf(list, W, H) {
  const look = list.map((s) => {
    if (!s.room || s.room.none || !s.moments.length) return null;
    const boxes = s.moments.flatMap((m) => m.faces.map((f) => ({ who: f.who, box: f.box })));
    if (!boxes.length) return null;
    const big = boxes.reduce((a, b) => (b.box[3] > a.box[3] ? b : a));
    const of = boxes.filter((b) => b.who === big.who).map((b) => b.box), med = (k) => of.map((b) => b[k] + (k < 2 ? b[k + 2] / 2 : 0)).sort((x, y) => x - y)[of.length >> 1];
    return { who: big.who, x: med(0), y: med(1), h: med(3) };
  });
  const groups = [], seen = new Set();
  look.forEach((a, i) => {
    if (!a || seen.has(i)) return;
    const g = [i];
    look.forEach((b, j) => { if (j > i && b && !seen.has(j) && b.who === a.who && Math.abs(b.x - a.x) < 0.06 * W && Math.abs(b.y - a.y) < 0.06 * H && Math.abs(b.h - a.h) < 0.12 * a.h) { g.push(j); seen.add(j); } });
    if (g.length > 1) groups.push(g);
  });
  return groups;
}

// whether captions stand above the heads more often than below the chins
function aboveHeads(cap, list) {
  let above = 0, below = 0;
  for (const s of list) for (const m of s.moments) for (const f of m.faces) {
    if (Y1(cap) <= f.box[1] + f.box[3] / 2) above += m.dt; else below += m.dt;
  }
  return above > below;
}

export function textOverTime({ zones: Z, shots, needs = [], set = {}, fixed = {}, costs = COSTS, raise: asked = "mouth" }) {
  const raise = raiseOf(asked);
  if (!RAISE.includes(raise)) throw new Error(`raise is ${RAISE.join(", ")}, not "${asked}".`);
  const [W, H] = Z.size;
  const D = scaled(merged(DEFAULTS, set), Z.size);
  const tall = W <= H;
  const S = Z.safe, C = Z.centred;
  const ctx = { W, H, Z, D, tall, raise };
  const cap = needs.find((n) => n.role === "caption") || null, hook = needs.find((n) => n.role === "hook") || null;
  const list = shots.map((s, i) => {
    const moments = momentsOf(s);
    const ml = maxLift(s, moments, ctx);
    return { ...s, i, weight: s.weight ?? s.end - s.start, moments, most: fixed.lifts?.[i] != null ? Math.max(0, fixed.lifts[i]) : ml.most, beyond: fixed.lifts?.[i] != null ? Math.max(0, fixed.lifts[i]) : ml.beyond, by: fixed.lifts?.[i] != null ? "fixed" : ml.by, forced: fixed.lifts?.[i] != null };
  });
  const returns = returnsOf(list, W, H);
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
        let cost = 0, touch = 0, cover = 0, liftCost = 0, mouth = 0, nose = 0, hair = 0, lip = 0;
        // a lift the caller fixed stands as given
        // what a shot's result costs, for the raise past its head's top
        const price = (s) => (q, l, past) => q.nose * costs.nose + q.hair * costs.hair + q.mouth * costs.mouth + q.lip * costs.lip + (q.seconds - q.nose - q.hair - q.mouth - q.lip) * costs.touch
          + (s.end - s.start) * ((l * costs.liftGround) / (0.1 * H) + (past ? costs.past : 0));
        const raw = list.map((s) => shotUnder(box, s.moments, s.most, D, s.forced, s.beyond, price(s)));
        // the returns of one framing at one height: that of the one that needs most, as far as
        // every one of them may go (a return whose eyes would reach the top bar sooner holds the
        // others down with it); a return goes past its own head's top only for its own mouth
        for (const g of returns) {
          const free = g.filter((i) => !list[i].forced);
          if (free.length < 2) continue;
          const limit = (i) => (raw[i].past || raw[i].mouth + raw[i].lip + raw[i].nose + raw[i].hair > 0 ? list[i].beyond : list[i].most);
          const want = Math.min(Math.max(...free.map((i) => raw[i].lift)), ...free.map(limit));
          for (const i of free) if (raw[i].lift !== want) {
            const r = shotUnder(box, list[i].moments, want, D, true);
            raw[i] = { ...r, need: raw[i].need, needMouth: raw[i].needMouth, past: r.lift > list[i].most, below: raw[i].below, returned: true };
          }
        }
        const per = list.map((s, i) => {
          const r = raw[i];
          const free = Math.min(r.lift, Math.max(0, s.room?.free || 0)), ground = r.lift - free;
          const k = s.weight / Math.max(1e-6, s.end - s.start);
          const sec = r.seconds * k;
          touch += sec; cover += sec * r.share; mouth += r.mouth * k; nose += r.nose * k; hair += r.hair * k; lip += r.lip * k;
          liftCost += s.weight * (free * costs.liftFree + ground * costs.liftGround) / (0.1 * H) + (r.past ? s.weight * costs.past : 0);
          return { ...r, seconds: sec, nose: r.nose * k, hair: r.hair * k, maybe: (r.maybe || 0) * k, mouth: r.mouth * k, lip: r.lip * k, lipEst: (r.lipEst || 0) * k, free, ground };
        });
        const mid = (yb - h / 2) / H;
        const away = Math.max(0, USUAL[0] - mid, mid - USUAL[1]) * 100;
        cost = touch * costs.touch + cover * costs.cover + lip * costs.lip + mouth * costs.mouth + hair * costs.hair + nose * costs.nose + liftCost + (away * costs.away + (f0 - font) * costs.smaller) * total / 10;
        candidates.push({ box: box.map(r1), font, lines: cap.lines, cost, touch, cover, lip, mouth, hair, nose, liftCost, away, per });
      }
    }
    candidates.sort((a, b) => a.cost - b.cost || b.box[1] - a.box[1]);
  }
  let best = candidates[0] || null;

  // the hook beside the captions, on the shots it is shown over (each as the captions' place lifts
  // it): { h, until, why } with h null where no place is clear of the faces' margins
  // (spans: the stretches of the shots' clock the hook is shown over, where the cut plays them
  // out of their order: a line heard twice that opens the short, then the moment from its start)
  const spansOf = (from, to) => (hook.spans?.length > 1 && from === hook.start && to === hook.end ? hook.spans : [[from, to]]);
  const hookWith = (cand) => {
    const lifts = cand ? cand.per.map((r) => r.lift) : list.map(() => 0);
    const place = (from, to, any = false) => {
      const spans = spansOf(from, to), inside = (t, pad = 0) => spans.some(([a, b]) => t >= a - pad && t <= b + pad);
      const over = list.filter((s) => spans.some(([a, b]) => s.end > a + EPS && s.start < b - EPS));
      const faces = [], keep = [];
      for (const s of over) for (const m of s.moments) {
        if (!inside(m.t, 0.05)) continue;
        for (const f of m.faces) {
          const b = up(f.box, lifts[s.i]);
          faces.push(b); keep.push(keepOut(b, D));
          // eyes, nose and mouth where known (inside the box; kept apart in case a box was cut short)
          if (f.feat) keep.push(grow(up(f.feat, lifts[s.i]), D.gap));
        }
      }
      const r = layoutText({ ...ctx, cap: null, hook: hook.kind && !any ? { kind: hook.kind } : {} }, faces, keep, [0, 0, W, H], false, { placed: cand ? [cand.box] : [] });
      return r.placed[0] ? { ...r.placed[0], over: over.map((s) => s.i) } : null;
    };
    let h = null, until = hook.end, why = null;
    // the first shot changes within the hook's time and the next leaves it no place: it ends at the cut
    const first = hook.spans?.length > 1 ? hook.spans[0] : [hook.start, hook.end];
    const cut = list.find((s) => s.start > first[0] + 1.2 && s.start < first[1] - EPS);
    // the kind asked for is a wish: the whole time, then until the cut; only then the other kind
    for (const any of hook.kind ? [false, true] : [false]) {
      h = place(hook.start, hook.end, any);
      if (!h && cut) { h = place(hook.start, cut.start, any); if (h) { until = cut.start; why = `it ends at the cut at ${r1(cut.start)} s: the shot after it leaves it no place`; } }
      if (h) { if (any) h.instead = true; break; }
    }
    return { h, until, why, lifts };
  };
  // Where no place is clear of the faces' margins: the least bad of the hook's usual places beside
  // the captions' place cand, a text in the middle or a card at the top: never on the captions where
  // one is not, then on no eyes, nose or mouth (the features, else the head's proportions) where one
  // is not, whatever the share (a tight close-up: a text in the middle lay on the mouth for 12 % of
  // the face, a card at the top on the forehead for more), then the least on a face: the hair or
  // the forehead is mild for a hook. Of a head whose box alone is known the eyes may begin anywhere
  // from BROWS of it down to where IMPLIED puts them: a place there is said (maybe, the seconds),
  // and weighed after the places on the features the proportions name, before the rest. Counted as
  // the eyes it would tie with a text on the mouth below, which then won by its smaller share: a hook
  // on a mouth for one that most likely lies on the hair (the eyes begin lower than a card's
  // bottom on most heads).
  const leastBad = (cand, lifts) => {
    const tries = [];
    const ht = D.hookText, hc = D.hookCard, z0 = Z.wide || [C[0], S[1], C[2], S[3] / 2];
    const tw = Math.min(ht.width * W, C[2]);
    tries.push({ kind: "text", font: ht.minFont, box: [W / 2 - tw / 2, ht.centre * H - ht.minFont * ht.heightEm / 2, tw, ht.minFont * ht.heightEm], where: "middle" });
    tries.push({ kind: "card", font: hc.minFont, box: [z0[0], z0[1], z0[2], hc.minFont * hc.heightEm], where: "top" });
    for (const x of tries) {
      // (on the captions: more than a sliver of the hook's box over theirs)
      x.seconds = 0; x.share = 0; x.features = 0; x.maybe = 0; x.onCaptions = !!cand && inter(cand.box, x.box) > 0.05 * area(x.box);
      for (const s of list) for (const m of s.moments) {
        if (hook.spans?.length > 1 ? !hook.spans.some(([a, b]) => m.t >= a && m.t <= b) : m.t < hook.start || m.t > hook.end) continue;
        const on = m.faces.filter((f) => inter(up(f.box, lifts[s.i]), x.box) > 0);
        if (on.length) { x.seconds += m.dt; x.share = Math.max(x.share, ...on.map((f) => inter(up(f.box, lifts[s.i]), x.box) / area(f.box))); }
        if (on.some((f) => inter(up(featOf(f), lifts[s.i]), x.box) > 0)) x.features += m.dt;
        else if (on.some((f) => inter(up(featuresOf(f), lifts[s.i]), x.box) > 0)) x.maybe += m.dt;
      }
    }
    // (the kind asked for, hook:text or hook:card, is a wish: it comes first among places that lie on a face alike, never before one that clears it)
    const other = (x) => (hook.kind && x.kind !== hook.kind ? 1 : 0);
    tries.sort((a, b) => a.onCaptions - b.onCaptions || a.features - b.features || a.maybe - b.maybe || (a.seconds > 0) - (b.seconds > 0) || other(a) - other(b) || a.seconds * (1 + a.share) - b.seconds * (1 + b.share));
    return tries[0];
  };
  // how the hook fares beside a captions' place: 0 a place clear of the faces, else its least bad one
  // on no face (1), on a face but not its eyes, nose or mouth (2), on them (3), on the captions (4)
  const hookFare = (cand) => {
    const w = hookWith(cand);
    if (w.h) return 0;
    const x = leastBad(cand, w.lifts);
    return x.onCaptions ? 4 : x.features > 0 ? 3 : x.seconds > 0 ? 2 : 1;
  };
  // A captions' place that leaves the hook worse off (above a head that fills the frame there is room
  // for one of the two) gives way to the next that leaves it better, as long as that lies on the
  // faces no longer: else the hook went over the captions' line or onto a face (best-takes' own phone
  // take: the captions above the head, the hook's card over them for its four seconds)
  let gaveWay = null;
  // (a hook on no face but within a face's margin is not worth it: the hook shows for a few seconds,
  // the captions all through; and never a smaller type for it)
  if (hook && best && fixed.y == null && hookFare(best) >= 2) {
    const fare0 = hookFare(best);
    let alt = null, fare = fare0;
    for (const c of candidates.slice(1)) {
      if (!(c.font >= best.font && c.touch <= best.touch + 1e-6 && c.lip <= best.lip + 1e-6 && c.mouth <= best.mouth + 1e-6 && c.hair <= best.hair + 1e-6 && c.nose <= best.nose + 1e-6)) continue;
      const f = hookFare(c);
      if (f < fare) { alt = c; fare = f; if (!f) break; }
    }
    if (alt) {
      gaveWay = { from: best, to: alt };
      const mid = (c) => Math.round(((c.box[1] + c.box[3] / 2) / H) * 1000) / 10;
      notes.push(`The captions stand with their middle at ${mid(alt)} % of the height${alt.font !== best.font ? ` at ${alt.font} px` : ""}, not at ${mid(best)} %: there the hook would have ${["", "", "lain on a face", "lain on the eyes, nose or mouth or on the captions", "lain on the captions"][fare0]}${fare0 < 2 ? "found no place clear of the faces" : ""}, here it ${["finds a place clear of the faces", "lies on no face", "lies on a face, not on its eyes, nose or mouth", "lies on the eyes, nose or mouth"][fare]} (the captions on the faces no longer; ${r1(alt.cost - best.cost)} more of the cost).`);
      best = alt;
    }
  }

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
    const { h, until, why, lifts } = hookWith(best);
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
      const x = leastBad(best, lifts);
      hookOut = { kind: x.kind, box: x.box.map(r1), font: x.font, lines: 2, where: x.where, start: hook.start, until: r1(hook.end), onFace: { seconds: r1(x.seconds), share: Math.round(x.share * 100) / 100, features: r1(x.features), ...(x.maybe > 0.05 ? { maybe: r1(x.maybe) } : {}) },
        kindWhy: x.kind === "card" ? "a card at the top: no place clear of the faces' margins, this one lies least on them" : "a text in the middle: no place clear of the faces' margins, this one lies least on them" };
      // the calm rule holds here too: white type only over a calm picture
      if (x.kind === "text" && hook.calm === false) {
        const hc = D.hookCard;
        hookOut.kind = "card";
        hookOut.font = Math.max(hc.minFont, Math.min(x.font, Math.floor(x.box[3] / hc.heightEm)));
        hookOut.kindWhy = "a card in the middle: no place clear of the faces' margins, and behind it the picture is not calm (the caller said so)";
      }
      if (!(x.seconds > 0)) notes.push(`The hook found no place clear of the faces' margins on the shots it is shown over; it stands ${x.where === "top" ? "at the top" : "in the middle"}, on no face but within a face's margin (the hair, the ears, the neck): look at it on the sheet.`);
    }
    // the kind asked for not taken: said, with why
    if (hookOut && hook.kind && hookOut.kind !== hook.kind) {
      const why = h?.instead ? `a ${hook.kind} finds no place clear of the faces on these shots, a ${hookOut.kind} does`
        : !h ? `every place of a ${hook.kind} lies ${hookOut.onFace?.seconds > 0 ? "more" : ""} on a face${hookOut.onFace?.features > 0 ? "" : " or the captions"} than this one`
        : "behind its place the picture is not calm (the caller said so)";
      hookOut.asked = hook.kind;
      notes.push(`The hook is a ${hookOut.kind === "card" ? "card" : "text"}, not the ${hook.kind} asked for: ${why}.`);
    }
  }

  // what is left on a face, each in one sentence: a fault (conflicts, ✗) only where something can
  // still be done about it, what the rules leave said as such (notes)
  const conflicts = [];
  const shotsOut = list.map((s, i) => {
    const r = best ? best.per[i] : { lift: 0, free: 0, ground: 0, seconds: 0, share: 0, who: [], need: 0, nose: 0, hair: 0, mouth: 0, lip: 0 };
    // how far the frame cuts a head at the top: its box's top and the margin for the hair over the
    // frame's top, px at most and seconds, and how much of that the lift adds
    const headCut = { seconds: 0, px: 0, byLift: 0 };
    for (const m of s.moments) {
      let cut = 0, before = 0;
      for (const f of m.faces) {
        const top = f.box[1] - Math.max(D.free.aboveMin, D.free.above * f.box[3]);
        cut = Math.max(cut, -(top - r.lift)); before = Math.max(before, -top);
      }
      if (cut > 0.5) { headCut.seconds += m.dt; headCut.px = Math.max(headCut.px, cut); headCut.byLift = Math.max(headCut.byLift, cut - Math.max(0, before)); }
    }
    headCut.seconds = r1(headCut.seconds); headCut.px = r0(headCut.px); headCut.byLift = r0(headCut.byLift);
    // the eyes at their highest once raised, a share of the frame's height
    let eyesTop = Infinity;
    for (const m of s.moments) for (const f of m.faces) eyesTop = Math.min(eyesTop, eyesOf(f, D) - r.lift);
    const out = { shot: i, start: s.start, end: s.end, lift: r.lift, headCut, ...(Number.isFinite(eyesTop) ? { eyes: Math.round((eyesTop / H) * 1000) / 1000 } : {}), free: r.free, ground: r.ground, band: r.ground, most: s.most, limit: r.past ? "mouth" : s.by, ...(s.forced ? { fixed: true } : {}), ...(r.past ? { past: true } : {}), ...(r.returned ? { returned: true } : {}),
      touches: r.who.map((w) => ({ role: "caption", who: w.who, from: r1(w.from), to: r1(w.to), seconds: r1(w.seconds), nose: r1(w.nose), hair: r1(w.hair), ...(w.maybe > 0.05 ? { maybe: r1(w.maybe) } : {}), mouth: r1(w.mouth), lip: r1(w.lip), ...(w.lipEst > 0.05 ? { lipEst: r1(w.lipEst), stills: w.stills } : {}), share: Math.round(w.share * 100) / 100 })) };
    if (best && r.seconds > 0.05) {
      const who = [...new Set(r.who.map((w) => w.who))].join(" and "), short = r.need - r.lift;
      const span = `Shot ${s.n ?? i + 1} (${r1(s.start)}–${r1(s.end)} s)`;
      const chin = r1(Math.max(0, r.seconds - r.nose - r.hair - r.mouth - r.lip));
      // the seconds on each part, as the list says them
      out.on = { nose: r1(r.nose), hair: r1(r.hair), ...(r.maybe > 0.05 ? { maybe: r1(r.maybe) } : {}), mouth: r1(r.mouth), lip: r1(r.lip), ...(r.lipEst > 0.05 ? { lipEst: r1(r.lipEst) } : {}), chin };
      const hair = r.who.length && r.share === 0 && best.box[1] + best.box[3] / 2 < Math.min(...s.moments.flatMap((m) => m.faces.map((f) => f.box[1] + f.box[3] / 2)));
      const raised = r.past ? ` (raised ${r.lift} px, as far as the eyes allow ${raise === "mouth" ? `at ${Math.round(D.eyeLine * 100)} % of the height` : "below the apps' top bar"})` : "";
      if (r.nose > 0.05) {
        out.fault = "nose";
        conflicts.push(`${span}: the captions lie on ${who}'s nose or eyes for ${r1(r.nose)} s${raised} wherever they stand at a readable size. What would avoid it: ${s.by === "fixed" ? "a larger lift than the one fixed, " : raise === "head" ? "--raise mouth (the head's top cut for it), " : ""}a cut to another shot here, or a smaller type by hand (--font-size).`);
      } else if (r.mouth > 0.05) {
        out.fault = "mouth";
        conflicts.push(`${span}: the captions cover ${who}'s mouth for ${r1(r.mouth)} s${raised} at ${best.font} px${best.font <= D.caption.font.least + 1 ? " (the smallest readable size)" : ", the type that leaves the least on the faces of the whole clip"}. What would avoid it: ${s.by === "fixed" ? "a larger lift than the one fixed, " : raise === "head" ? "--raise mouth (the head's top cut for it), " : ""}a cut to another shot here, or a smaller type by hand (--font-size).`);
      } else if (r.lip > 0.05) {
        // on the lower lip: said, not a fault. Whether a smaller type would clear it is computed
        // for this shot, never said by default: in a tight close-up the lower lip can reach down
        // to where the captions end, and then no type clears it
        out.chin = true; out.lip = r1(r.lip);
        const c = lipClearing(best, s.moments, r.lift, D), least = D.caption.font.least;
        out.clearsAt = c.font;
        // with the whole head kept: whether the default raise, past the head's top as far as the
        // eye line allows, would clear it
        const viaMouth = raise === "head" && !s.forced && (() => { const ml = maxLift(s, s.moments, { ...ctx, raise: "mouth" }); const q = shotUnder(best.box, s.moments, ml.beyond, D, true); return q.lip + q.mouth + q.nose <= 0.05; })();
        // the lower lip from features that are an estimate between two stills: said, with the stills
        const est = r.lipEst > 0.05 ? r.who.filter((w) => w.lipEst > 0.05) : [];
        const estSaid = est.length ? ` (${r1(r.lipEst)} s of it ${stillsText(est.flatMap((w) => w.stills))}, where the mouth's place is an estimate that rides with the head's box: a mouth that opens there reaches lower, onto the captions; look at those seconds)` : "";
        const lead = `${span}: the captions lie on ${who}'s lower lip for ${r1(r.lip)} s${estSaid} and on the chin for ${chin} s, not on the mouth${r.past ? `; raised ${r.lift} px past the head's top for it` : ""}`;
        if (c.font >= least && c.font < best.font) notes.push(`${lead}, at ${best.font} px, the type that leaves the least on the faces of the whole clip: ${c.font} px or less (--font-size ${c.font}) would clear it at this place, and a cut to another shot would avoid it.`);
        else notes.push(`${lead}: not avoidable at a readable size (${best.font} px; the low end of published captions is ${least} px)${raise === "head" ? " with the whole head kept" : ""}. Nothing to fix; ${viaMouth ? "--raise mouth (the head's top cut for it) or " : ""}a cut to another shot would avoid it${raise === "head" && !viaMouth ? " (--raise mouth would not clear it either)" : ""}; ${c.font >= 1 ? `a smaller type only at ${c.font} px or less (--font-size ${c.font}), under that low end` : `no smaller type would: the lower lip reaches down to y ${r0(c.lip)} and the captions end at y ${r0(Y1(best.box))}`}.`);
      } else if (r.hair > 0.05) {
        // on the hair or the forehead inside the head's box, above the eyes: no eyes, nose or mouth
        // covered, said, not a fault; captions belong below the chin
        out.hair = true;
        notes.push(`${span}: the captions lie on ${who}'s hair or forehead for ${r1(r.hair)} s, above the eyes${r.maybe > 0.05 ? ` of most heads; for ${r1(r.maybe)} s of it where the eyes may begin (from ${Math.round(BROWS_HIGH * 100)} % of a head's height down, the brows of a head tipped back): this head is known by its box alone, its eyes are not known; look at those seconds on the sheet, or find the faces with their eyes, nose and mouth` : ""}${fixed.y != null ? `, at the height fixed (--caption-y): without it they stand where they lie least on the faces` : `: captions belong below the chin; a cut to another shot here, or a --caption-y below the chin, would avoid it`}.`);
      } else if (hair) {
        // above the face, within the margin kept for the hair: no face covered
        out.hair = true;
        notes.push(`${span}: the captions stand above ${who}'s face, on the hair, for ${r1(r.seconds)} s.`);
      } else if (s.room?.none) {
        out.fault = "face";
        conflicts.push(`${span}: the captions lie on ${who}'s face for ${r1(r.seconds)} s below the mouth, because its picture is shown whole or as two panels and is not raised. What would avoid it: a framing that follows the speaker in this shot (clips: reframe --follow).`);
      } else if (r.past || (short > 0 && (s.by === "head" || s.by === "eyes" || s.by === "fixed"))) {
        // on the chin or the neck, as far raised as the rule allows: said, not to be fixed
        out.chin = true;
        notes.push(`${span}: the captions lie on ${who}'s chin or neck for ${r1(r.seconds)} s, below the mouth${r.past ? `; raised ${r.lift} px past the head's top so that they keep off the mouth` : `: not avoidable without ${s.by === "head" ? "cutting the head by the frame's top (--raise full)" : s.by === "eyes" ? "the eyes going under the apps' top bar" : s.by === "eyeLine" ? `the eyes going above ${Math.round(D.eyeLine * 100)} % of the height (where published Shorts have them at the highest; --raise full goes to the apps' top bar)` : "a larger lift than the one fixed"} (raised ${r.lift} px, it would need ${r0(short)} px more)`}.`);
      } else {
        out.chin = true;
        notes.push(`${span}: the captions lie on ${who}'s chin or neck for ${r1(r.seconds)} s, below the mouth${short > 0 ? `; it would have to stand ${r0(short)} px higher than its framing and the apps' bottom allow` : ""}.`);
      }
    }
    return out;
  });
  if (hookOut?.onFace?.seconds > 0) conflicts.push(`The hook lies on a face for ${hookOut.onFace.seconds} s (up to ${Math.round(hookOut.onFace.share * 100)} % of it${hookOut.onFace.features > 0 ? `, on the eyes, nose or mouth for ${hookOut.onFace.features} s` : hookOut.onFace.maybe > 0 ? `, on the forehead or the hair, never on the nose or mouth; for ${hookOut.onFace.maybe} s it reaches more than ${Math.round(BROWS_HIGH * 100)} % down a head known by its box alone, where the eyes of some heads begin (with their brows): this head's eyes are not known; look at those seconds` : `, on the forehead or the hair, never on the eyes, nose or mouth`}) wherever it stands on the first shot: no hook (the first line carries the clip), a shorter one that ends before the face reaches it, or a start on another shot would avoid it.`);
  for (const c of changes) notes.push(`Shot ${list[c.shot].n ?? c.shot + 1} (${r1(c.start)}–${r1(c.end)} s) would keep its captions off the face with a place of its own (y ${r0(c.box[1])}–${r0(Y1(c.box))}), saving ${c.saves} s: proposed, not taken; a place that changes at a cut costs the reading the one place gives.`);

  const capOut = best ? {
    box: best.box, font: best.font, lines: best.lines, align: "center", least: tall ? D.caption.font.least : null,
    middle: Math.round(((best.box[1] + best.box[3] / 2) / H) * 1000) / 10,
    // no-face: the clip shows no face at all (a screen, a product, b-roll): nothing keeps the
    // captions from where published Shorts set them, as low as the safe box allows
    where: !list.some((s) => s.moments.some((m) => m.faces.length)) ? "no-face" : aboveHeads(best.box, list) ? "above-head" : "below-chin",
    // agentitos' captions: the lowest line ends at y, at most max-width wide, centred
    options: { y: r0(Y1(best.box)), "max-width": Math.floor(best.box[2]), "font-size": best.font, lines: best.lines },
    seconds: r1(best.touch), lifted: best.per.filter((r) => r.lift > 0).length,
  } : null;
  return {
    frame: `${W}x${H}`, size: [W, H], platforms: (Z.platforms || []).map((p) => p.name), safe: S, raise,
    caption: capOut, shots: shotsOut, hook: hookOut, changes, conflicts, notes,
    candidates: candidates.filter((c, i, a) => a.findIndex((d) => d.font === c.font && Math.abs(d.box[1] - c.box[1]) < H * 0.02) === i).slice(0, 5)
      .map((c) => ({ box: c.box, font: c.font, cost: r1(c.cost), seconds: r1(c.touch), lifted: c.per.filter((r) => r.lift > 0).length, liftPx: c.per.reduce((n, r) => n + r.lift, 0), middle: Math.round(((c.box[1] + c.box[3] / 2) / H) * 1000) / 10 })),
  };
}

// What texts that stand where the caller put them lie on (measure: no place is sought, nothing is
// raised): for each box of the frame over [start, end) of the shots' clock, per moment (momentsOf,
// with how long it stands) the faces whose box it overlaps, each with the worst part of it the text
// reaches (PARTS, as the captions' list counts them; `maybe` where a head known by its box alone
// may have its eyes there), and the seconds per part over all, the worst part of a moment counting,
// and per face. For a caller that weighs the parts by rules of its own (narrated-short: nobody shown
// speaks, so a mouth may be covered, except of one who talks into the camera): it reads `moments`.
// boxes: [{ name, box: [x, y, w, h], start?, end? }]
export function measureOver({ shots, boxes }) {
  const r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
  const list = shots.map((s, i) => ({ i, moments: momentsOf(s) }));
  return boxes.map((b) => {
    const start = b.start ?? -Infinity, end = b.end ?? Infinity;
    const sum = { seconds: 0, nose: 0, hair: 0, maybe: 0, mouth: 0, lip: 0, chin: 0 }, who = new Map(), moments = [];
    for (const s of list) for (const m of s.moments) {
      if (m.t < start || m.t >= end) continue;
      const on = [];
      for (const f of m.faces) {
        if (inter(f.box, b.box) <= 0) continue;
        const part = PARTS[partOf(f, 0, b.box)], maybe = part === "hair" && inMaybe(f, 0, b.box);
        on.push({ who: f.who, part, ...(maybe ? { maybe: true } : {}) });
        const w = who.get(f.who) || { who: f.who, seconds: 0, nose: 0, hair: 0, maybe: 0, mouth: 0, lip: 0, chin: 0 };
        w.seconds += m.dt; w[part] += m.dt; if (maybe) w.maybe += m.dt;
        who.set(f.who, w);
      }
      if (!on.length) continue;
      const worst = on.reduce((a, x) => (PARTS.indexOf(x.part) > PARTS.indexOf(a.part) ? x : a));
      sum.seconds += m.dt; sum[worst.part] += m.dt; if (worst.maybe) sum.maybe += m.dt;
      moments.push({ t: r3(m.t), dt: r3(m.dt), shot: s.i, on });
    }
    const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? r2(v) : v]));
    return { name: b.name, box: b.box, ...(Number.isFinite(start) ? { start } : {}), ...(Number.isFinite(end) ? { end } : {}), ...round(sum), faces: [...who.values()].map(round), moments };
  });
}
