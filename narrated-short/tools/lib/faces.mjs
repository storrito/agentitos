// The faces of a beat, where `faces` found them (agentitos' clips: its frame.mjs --faces on the
// beat's stretch of the source), and what build does with them: the picture of a `fill` (or the
// first beat's zoomed `whole`) placed so that it shows the faces that matter, and the faces in the
// frame over the film's time, to keep the captions and the hook off them. Pure geometry: the one
// program it needs (layout's place, for a crop) is run by the caller and handed in as `crop`.
//
//   sane(list, [w, h]) → { list, dropped: Map who → moments }: the boxes that can be faces
//   counted(list, [w, h], seconds) → { main, held: [person], small: [person] }: who the picture must show
//   looking(people, seconds, step) → { who, share } | { who, unknown } | null: whether the main face looks into the camera
//   planWindow({ frame, zoom, pan, zoomSet, panSet, size, people, captions, crop }) → what the beat's picture becomes
//   mapper({ frame, zoom, pan, x, box, size }) → box of the source → box of the 1080×1920 clip
//   framed(…) → [{ t, boxes: [{ who, box, feat? }] }] on the film's clock, as the composition plays it
//   textOn(box, moments, from, to) → { seconds, nose, mouth, lip, hair, chin, talk, cost, hard }: a text box on faces
//
// A box is [x, y, w, h]. Every list of faces is { step, faces: [{ t, boxes: [{ who, box, feat? }] }] }
// in px of the source and seconds of the stretch (0 = the beat's `at`).
//
// In a narrated short nobody shown is heard: every clip is cut without its sound and a voice tells
// the story. So a caption may lie on a mouth, a mask or a chin; only the eyes and nose must stay
// clear. Except where a speaker talks into the camera (an interview, a webcam): a moving mouth under
// the captions reads as a mistake, though nobody hears it, so there the mouth weighs as the eyes do
// (looking, below).

export const SIZE = [1080, 1920];
// Who the picture must show. The main face: the tallest of those seen in half of the beat's moments
// or more (else of those seen in a quarter). Another face counts only where it is seen in HELD_SEEN
// of the moments and is of a size like the main one's, SIMILAR of its height or more, and MIN_FACE of
// the source's height (people walking far off, a face in a crowd: no reason to change a picture).
// SIMILAR stands on two beats (2026-11-19): the review's b3, a blurred woman at a laptop behind a
// panel's speaker, 53 % as tall as him, must not count (she made a band of a fill that showed him
// whole and large); the author's crew4 b5, two women side by side, the smaller 78 % as tall as the
// other, must both be shown. A face the model saw on one still only moves nothing either.
// HELD_SEEN, a face that enters, leaves or passes counting by the time it is there, stands on the
// same beats: crew4 b5's passer-by, seen in 25 % of its moments (its first 0.7 s), must not count (he
// widened the picture to a band at 1.1× where a crop on the two women held them larger); every
// second person really there in the people beats of crew4, epps2 and the review's short is seen in
// 94 % of the moments or more (the review's b2, b4, b7, b9; crew4 b5's two women).
// Time alone misses one who enters late and stays: the review's h1, a woman seen from a cut 1.7 s
// into the beat to its end, 43 % of the moments. A face there at the beat's last moment, without a
// break (no gap over GAP) for STAY seconds and SEEN of the moments or more, is held as one seen in
// half of it: the beat ends on her, the picture should show her. STAY stands on that beat (1.1 s, so
// it must count) and on crew4 b5's passer-by (the first 0.7 s, then gone: not there at the end); a
// face that comes in for the last half second is no presence.
export const SEEN = 0.25, MAIN_SEEN = 0.5, HELD_SEEN = 0.5, SIMILAR = 0.7, MIN_FACE = 0.04, STAY = 1, GAP = 0.25;
// A face that does not count is said by why: "in the background" only where it is smaller than
// BEHIND of the main face's height (the review's b3: the woman at the laptop, 53 %, the panel far
// behind, 25 to 32 %); one larger than that is beside the others (the review's b9: a fourth man
// walking at the side of three, 67 %), one seen too briefly a passer-by.
export const BEHIND = 0.6;
// room kept beside a face in a band's window: a share of its width each side (an ear, hair)
export const SIDE = 0.12;
// the frame's faces a text is checked against: at least this share of the frame's height
export const TEXT_FACE = 0.03;
// a main face this share of the source's height or more is a close-up: said where it ends as a small band
export const CLOSE = 0.25;
// how far a fill may be raised to clear the captions of the eyes and noses (the ground shows below it)
export const MAX_LIFT = 640;
// the last rows of a raised fill that go over into the ground below it, px of the frame (build's
// clip): no hard line where the picture ends (crew4 b3, raised 90 px: a line at y 1830, below the
// captions, where the apps write the post's description)
export const FADE = 96;
// the margin kept between a nose line and the captions' top, px of the frame (layout's least margin)
const MARGIN = 24;
// every clip grows by a twenty-fifth while it runs, about the frame's middle (the composition's move)
const MOVE = 1.04;

// A box that cannot be a face, as best-takes refuses them (copied: a skill never imports another's
// code): no size, less than half of it inside the picture; and one as large as the whole picture
// (a model's answer that names the frame itself). Such boxes are left out, each person's counted.
export function sane(list, [w, h]) {
  const dropped = new Map();
  const ok = (b) => {
    if (!(Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[2] > 0 && b[3] > 0)) return false;
    const inside = Math.max(0, Math.min(w, b[0] + b[2]) - Math.max(0, b[0])) * Math.max(0, Math.min(h, b[1] + b[3]) - Math.max(0, b[1]));
    return inside >= 0.5 * b[2] * b[3] && !(b[2] >= 0.9 * w && b[3] >= 0.9 * h);
  };
  const faces = [];
  for (const f of list?.faces || []) {
    const boxes = (f.boxes || []).filter((x) => ok(x.box) || (dropped.set(x.who ?? "a face", (dropped.get(x.who ?? "a face") || 0) + 1), false));
    if (boxes.length) faces.push({ ...f, boxes });
  }
  return { list: { ...list, faces }, dropped };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
// the eyes, nose and mouth of a face: the model's, else from the head's proportions (as layout takes them)
const IMPLIED = [0.38, 0.86];
const featOf = (b, feat) => feat || [b[0] + 0.18 * b[2], b[1] + IMPLIED[0] * b[3], 0.64 * b[2], (IMPLIED[1] - IMPLIED[0]) * b[3]];
const noseOf = (e) => e[1] + 0.7 * e[3];
// the lowest line of a face that text must keep off: the nose's, or of one who talks into the
// camera the mouth's (its lower lip and 15 % more, as partsOn takes it)
const lowOf = (p, e) => (p.talks ? e[1] + 1.15 * e[3] : noseOf(e));

export function counted(list, [, h], seconds) {
  const moments = Math.max(1, Math.round(seconds / (list?.step || 0.1)));
  const people = new Map();
  for (const f of list?.faces || []) for (const b of f.boxes || []) {
    const who = b.who ?? "a face";
    if (!people.has(who)) people.set(who, { who, boxes: [], feats: [], ts: [], looks: [] });
    const p = people.get(who);
    p.boxes.push(b.box); p.feats.push(featOf(b.box, b.feat)); p.ts.push(f.t); p.looks.push(b.looks ?? null);
  }
  const all = [...people.values()].map((p) => ({ ...p, n: p.boxes.length, h: median(p.boxes.map((b) => b[3])) }));
  const tallest = (ps) => ps.reduce((a, p) => (!a || p.h > a.h ? p : a), null);
  const main = tallest(all.filter((p) => p.n >= MAIN_SEEN * moments)) || tallest(all.filter((p) => p.n >= SEEN * moments));
  // there long enough: in half of the moments, or there at the end since a real stretch (STAY)
  const step = list?.step || 0.1, end = (moments - 1) * step;
  const stays = (p) => {
    const ts = [...p.ts].sort((a, b) => a - b);
    if (!ts.length || ts.at(-1) < end - GAP) return false;
    let k = ts.length - 1;
    while (k > 0 && ts[k] - ts[k - 1] <= GAP) k--;
    return ts.at(-1) - ts[k] + step >= STAY && p.n >= SEEN * moments;
  };
  const there = (p) => p.n >= HELD_SEEN * moments || stays(p);
  const held = main ? all.filter((p) => p === main || (there(p) && p.h >= SIMILAR * main.h && p.h >= MIN_FACE * h)) : [];
  // why a face does not count: behind (small against the main face, or a speck), passing (seen too briefly), side (a little smaller than to count)
  const why = (p) => (!main || p.h < BEHIND * main.h || p.h < MIN_FACE * h ? "behind" : !there(p) ? "passing" : "side");
  return { main: held.length ? main : null, held, small: all.filter((p) => !held.includes(p)).map((p) => ({ ...p, why: why(p) })) };
}

// A speaker to the camera: the main face looks into it (the model's "camera") in TALK_SEEN of the
// beat's moments or more, and is shown TALK_FACE of the frame's height or more in the picture the
// beat gets without it (talksIn). Its mouth then weighs as its eyes: the picture gives way for it
// as for them, and captions and the hook keep off it. TALK_FACE stands on the test shorts
// (2026-11-19): Jeanette Epps' interview as a fill, 38 % (the model: "camera" on every still), and
// a council member alone at her webcam in a Zoom recording as a fill, 16 % (her lower lip under the
// captions 2.4 s before), must count; two faces of that Zoom gallery shown together as a band at
// 1.48× (11 %) or in a 1:1 crop (13 %), and the small figures of the crew's B-roll looking towards
// the lens (2 %), must not: their mouths are too small under the type to read as moving.
export const TALK_SEEN = 0.5, TALK_FACE = 0.15;
// → { who, share } where the main face looks into the camera that long, { who, unknown: true }
// where its faces say nothing of where it looks (found before they did), else null
export function looking(people, seconds, step = 0.1) {
  const main = people?.main;
  if (!main) return null;
  if (!main.looks?.some(Boolean)) return { who: main.who, unknown: true };
  const moments = Math.max(1, Math.round(seconds / step)), n = main.looks.filter((l) => l === "camera").length;
  return n >= TALK_SEEN * moments ? { who: main.who, share: Math.min(1, n / moments) } : null;
}
// how tall a person's face is shown in a beat's picture: the median of its boxes there, a share of the frame's height
export const shownShare = (place, p) => median(p.boxes.map((b) => mapper(place)(b)[3])) / SIZE[1];
// the people with the main face as one who talks into the camera (its mouth kept clear as its eyes)
export function talksIn(people) {
  const main = { ...people.main, talks: true };
  return { ...people, main, held: people.held.map((p) => (p === people.main ? main : p)) };
}

// the stretch of the source's width the held faces need: [x0, x1], each face with SIDE of its width beside it
export function hullOf(held) {
  let x0 = Infinity, x1 = -Infinity;
  for (const p of held) for (const b of p.boxes) { x0 = Math.min(x0, b[0] - SIDE * b[2]); x1 = Math.max(x1, b[0] + b[2] + SIDE * b[2]); }
  return Number.isFinite(x0) ? [x0, x1] : null;
}
// the stretch of the source's width their eyes, nose and mouth take over the beat
export function featHull(ps) {
  let x0 = Infinity, x1 = -Infinity;
  for (const p of ps) for (const e of p.feats) { x0 = Math.min(x0, e[0]); x1 = Math.max(x1, e[0] + e[2]); }
  return Number.isFinite(x0) ? [x0, x1] : null;
}

const r2 = (x) => Math.round(x * 100) / 100;
const even = (v) => 2 * Math.round(v / 2);
// the part of the source's width a frame shows: [x0, x1] in px of the source (after the black bars)
export function shown({ frame, zoom = 1, pan = 0.5, x = null, box = null, size: [cw, ch] }) {
  if (frame === "crop") return [box.src[0], box.src[0] + box.src[2]];
  if (frame === "fill") {
    const k = SIZE[1] / ch, ws = 2 * Math.round((cw * k) / 2);
    const left = x != null ? x : (ws - SIZE[0]) * pan;
    return [left / k, (left + SIZE[0]) / k];
  }
  if (frame === "whole") {
    const w = Math.round((SIZE[0] * zoom) / 2) * 2;
    if (w === SIZE[0]) return [0, cw];
    const k = w / cw, left = Math.floor((w - SIZE[0]) * pan);
    return [left / k, (left + SIZE[0]) / k];
  }
  const k = Math.max(SIZE[0] / cw, SIZE[1] / ch), left = (cw * k - SIZE[0]) / 2;
  return [left / k, (left + SIZE[0]) / k];
}

// a part of the source (src, px) shown in a part of the frame (at): { src: [x, y, w, h], at: [x, y, w, h] },
// the sizes even for the encoder, inside the source
export function cropBox(src, at, [cw, ch]) {
  const a = [Math.round(at[0]), even(at[1]), even(at[2]), even(at[3])];
  const w = Math.min(even(src[2]), cw - (cw % 2)), h = Math.min(even(src[3]), ch - (ch % 2));
  const x = Math.max(0, Math.min(cw - w, Math.round(src[0]))), y = Math.max(0, Math.min(ch - h, Math.round(src[1])));
  return { src: [x, y, w, h], at: a };
}
// layout's candidate (the source drawn `scale` times its size at left, top, seen in `window`) as such a box
export const cropOf = (c, size) => cropBox([(c.window[0] - c.left) / c.scale, (c.window[1] - c.top) / c.scale, c.window[2] / c.scale, c.window[3] / c.scale], c.window, size);

// Where the picture of a beat with faces goes, and what is said. The agent's own `pan` and `zoom`
// stand (a `!` where they cut a face's eyes, nose or mouth). A `fill` goes, in this order, to:
//   1. a fill that shows the eyes, nose and mouth of every face that counts (an ear, the back of a
//      head or a smaller face in the background may be cut): from the middle where that does, else
//      moved; where the main face's are shown from the middle and the others' cannot be with it,
//      the fill stays: never a smaller picture than that;
//   2. a 4:5 or 1:1 crop that holds the faces, placed high above the captions (layout's `place`
//      proposes it: `crop(held)` gives its candidate or null);
//   3. the whole picture as a band, as large as holds them and keeps their eyes and noses above the
//      captions' top: the last, said as such where a close-up became a small band.
// A fill whose eyes or noses would lie under the captions is raised (the same size, ground below it)
// as far as MAX_LIFT. The first beat's own 1.6× band moves its window to the faces, or becomes
// smaller where they need it. Nothing changes where the picture shows them already.
// captions: their box in the frame, or null.
// → { frame, zoom, pan, x (a fill's crop in px of the scaled source, or null), box (a crop's), changed, said, cut: [who], flag }
export function planWindow({ frame, zoom = 1, pan = 0.5, zoomSet = false, panSet = false, size: [cw, ch], people, captions = null, crop = null }) {
  const out = { frame, zoom, pan, x: null, box: null, changed: false, said: "", cut: [], flag: false };
  const held = people?.held || [], main = people?.main;
  if (!held.length || frame === "native") return out;
  const names = (ps) => ps.map((p) => p.who).join(", ");
  const within = (win, hull) => hull[0] >= win[0] - 1 && hull[1] <= win[1] + 1;
  const featsCut = (win, ps) => ps.filter((p) => !within(win, featHull([p])));
  const boxCut = (win, ps) => ps.some((p) => p.boxes.some((b) => b[0] < win[0] - 1 || b[0] + b[2] > win[1] + 1));
  // the faces that do not count, seen a quarter as often as those that do, whose features a window
  // cuts, by why: the smaller ones "in the background", the ones seen too briefly passers-by
  const cutOf = (win, why) => (people.small || []).filter((p) => (p.why || "behind") === why && p.n >= 0.25 * Math.max(...held.map((q) => q.n)) && !within(win, featHull([p])));
  const few = (ps) => (ps.length > 2 ? `${names(ps.slice(0, 2))} and ${ps.length - 2} more` : names(ps));
  const passing = (win) => { const ps = cutOf(win, "passing"); return ps.length ? [`${ps.length > 1 ? "passers-by" : "a passer-by"} not held (${few(ps)})`] : []; };
  // a face a little smaller than to count, beside the held ones: how many count and are held, and that it is cut
  const beside = (win) => {
    const ps = cutOf(win, "side");
    if (!ps.length) return [];
    const tall = ps.length > 1 ? `${ps.map((p) => Math.round((p.h / main.h) * 100)).join(" and ")} %` : `${Math.round((ps[0].h / main.h) * 100)} %`;
    return [`${held.length > 1 ? `the ${held.length} faces that count` : "the face that counts"} held, ${ps.length > 1 ? `the ${ps.length} at the side` : "the one at the side"} cut (${few(ps)}: ${tall} as tall as the largest, too small to count)`];
  };
  const notes = (win) => [boxCut(win, held) ? (held.length > 1 ? "ears or the backs of heads cut" : "an ear cut") : "", cutOf(win, "behind").length ? `${cutOf(win, "behind").length > 1 ? "faces" : "a face"} in the background cut (${few(cutOf(win, "behind"))})` : "", ...beside(win), ...passing(win)].filter(Boolean);
  const now = shown({ frame, zoom, pan, size: [cw, ch] });
  if (panSet || (frame === "whole" && zoomSet)) {
    const cut = featsCut(now, held);
    out.cut = cut.map((p) => p.who);
    if (cut.length) out.said = `${panSet ? "your \"pan\"" : `your "zoom": ${zoom}`} cuts the eyes, nose or mouth of ${names(cut)}`;
    return out;
  }
  if (frame === "fill") {
    const k = SIZE[1] / ch, ws = 2 * Math.round((cw * k) / 2), width = now[1] - now[0];
    const lifted = (o, win) => raiseFill(o, win, held, [cw, ch], captions);
    const all = featHull(held);
    if (!featsCut(now, held).length) {
      out.said = [`the faces (${names(held)}) are in the picture as it is`, ...notes(now)].join("; ");
      return lifted(out, now);
    }
    if (all[1] - all[0] <= width) {
      // the faces with the room beside them where that fits the window, else their eyes, nose and mouth
      const room = hullOf(held), around = room[1] - room[0] <= width ? room : all;
      out.x = Math.max(0, Math.min(ws - SIZE[0] - 2, Math.round(((around[0] + around[1]) / 2 - width / 2) * k)));
      const win = shown({ frame, x: out.x, size: [cw, ch] });
      out.changed = true;
      out.said = [`the crop moved to the faces (${names(held)}): from the middle it cut ${held.length > 1 ? "them" : "it"}`, ...notes(win).map((n) => (n === "an ear cut" ? "close-up kept, an ear cut" : n))].join("; ");
      return lifted(out, win);
    }
    const others = held.filter((p) => p !== main);
    if (!featsCut(now, [main]).length) {
      out.cut = featsCut(now, others).map((p) => p.who);
      out.said = `close-up kept on ${main.who}: ${names(featsCut(now, others))} ${out.cut.length > 1 ? "stand" : "stands"} too far from it for one fill and ${out.cut.length > 1 ? "are" : "is"} cut (a smaller picture to show them all: "frame": "whole")`;
      return lifted(out, now);
    }
    const share = Math.min(100, Math.round(((hullOf(held)[1] - hullOf(held)[0]) / cw) * 100));
    const band = bandPlan(held, [cw, ch], captions, 3);
    const c = crop ? crop(held) : null;
    if (c && ["4:5", "1:1"].includes(c.crop) && c.scale >= (SIZE[0] * band.zoom) / cw - 1e-6) {
      const box = cropOf(c, [cw, ch]);
      if (cropHolds(box, held, captions)) {
        out.frame = "crop"; out.box = box; out.changed = true;
        out.said = `a fill would cut ${names(featsCut(now, held))} (${held.length > 1 ? "they stand" : "the face takes"} ${share} % of the width): a ${c.crop} crop placed high instead, the ${held.length > 1 ? "largest face" : "face"} ${Math.round((main.h * (box.at[3] / box.src[3]) / SIZE[1]) * 100)} % of the frame's height`;
        out.said = [out.said, ...passing([box.src[0], box.src[0] + box.src[2]])].join("; ");
        return out;
      }
    }
    Object.assign(out, { frame: "whole", zoom: band.zoom, pan: 0.5, changed: true });
    const small = main.h >= CLOSE * ch ? Math.round(((main.h * SIZE[0] * band.zoom) / cw / SIZE[1]) * 100) : null;
    out.flag = small != null;
    out.said = `a fill would cut ${names(featsCut(now, held))} (${held.length > 1 ? "they stand" : "the face takes"} ${share} % of the width): the whole picture as a band${out.zoom > 1 ? `, ${out.zoom} times larger` : ""}${band.limited ? `, ${held.length > 1 ? "their eyes" : "the eyes"} above the captions` : ""}${small != null ? `; close-up became a small band (the face ${small} % of the frame's height): another stretch?` : ""}`;
    const banded = placePan(out, hullOf(held), cw);
    banded.said = [banded.said, ...passing(shown({ frame: "whole", zoom: banded.zoom, pan: banded.pan, size: [cw, ch] }))].join("; ");
    return banded;
  }
  // a zoomed band (the first beat's own): as large as it was where that holds them, else less
  const h = hullOf(held), hull = [Math.max(0, h[0]), Math.min(cw, h[1])];
  const need = hull[1] - hull[0], width = now[1] - now[0];
  const most = bandPlan(held, [cw, ch], captions, 3).zoom;
  if (within(now, hull) && !(zoom > 1 && zoom > most + 0.005)) { out.said = `the faces (${names(held)}) are in the picture as it is`; return out; }
  if (need > width || zoom > most + 0.005) {
    out.zoom = Math.max(1, Math.min(zoom, most));
    out.changed = true;
    out.said = `the band ${out.zoom > 1 ? `${out.zoom} times larger instead of ${zoom}` : `at its whole width instead of ${zoom} times larger`}, so that it holds ${names(held)}${need <= cw / out.zoom && most < cw / need ? " with the eyes above the captions" : ""}`;
    return out.zoom > 1 ? placePan(out, hull, cw) : { ...out, pan: 0.5 };
  }
  out.changed = true;
  out.said = `the band's window moved to the faces (${names(held)}): from the middle it cut ${held.length > 1 ? "them" : "it"}`;
  return placePan(out, hull, cw);
}

// a band's largest zoom (at most `upTo`) that holds the faces across and keeps their eyes and noses above the captions
function bandPlan(held, [cw, ch], captions, upTo) {
  const h = hullOf(held), need = Math.min(cw, h[1]) - Math.max(0, h[0]);
  const across = cw / need, eyes = noseZoom(held, [cw, ch], captions ? captions[1] : null);
  const z = Math.max(1, Math.floor(Math.min(upTo, across, eyes) * 100) / 100);
  return { zoom: z, limited: eyes < Math.min(upTo, across) };
}

// The largest zoom of a band at which every nose line of the held faces, and a margin below it,
// stays above y `above` of the frame (Infinity: no limit). A band's middle is the frame's: a point
// y of the source lands at 960 + (y − ch/2) · k · MOVE at most, k = 1080 · zoom / cw.
export function noseZoom(held, [cw, ch], above) {
  if (above == null) return Infinity;
  let k = Infinity;
  for (const p of held) for (const e of p.feats) {
    const below = (lowOf(p, e) - ch / 2) * MOVE, room = above - SIZE[1] / 2 - MARGIN;
    if (below > 0) k = Math.min(k, room / below);
  }
  return Number.isFinite(k) ? Math.max(0, (k * cw) / SIZE[0]) : Infinity;
}

// the y of the frame a point y of the source comes to at most while a clip grows about the middle
const grown = (y) => (y > SIZE[1] / 2 ? SIZE[1] / 2 + (y - SIZE[1] / 2) * MOVE : y);
const overX = (e, cap, k, x0) => Math.min((e[0] + e[2] - x0) * k, cap[0] + cap[2]) > Math.max((e[0] - x0) * k, cap[0]);
// whether eyes from y `eyes` to a nose line at `nose` (px of the frame) reach into the captions (with the margin)
const under = (eyes, nose, cap) => eyes < cap[1] + cap[3] && grown(nose) + MARGIN > cap[1];

// A fill whose held eyes or noses would lie under the captions, raised as far as clears them (the
// same size; its bottom shows the ground), up to MAX_LIFT; beyond that it stays and the captions
// are placed around the faces.
function raiseFill(out, win, held, [cw, ch], captions) {
  if (!captions) return out;
  const k = SIZE[1] / ch;
  let lift = 0;
  for (const p of held) for (const e of p.feats) if (overX(e, captions, k, win[0]) && under(e[1] * k, lowOf(p, e) * k, captions)) lift = Math.max(lift, grown(lowOf(p, e) * k) + MARGIN - captions[1]);
  if (lift <= 0) return out;
  lift = even(Math.ceil(lift));
  if (lift > MAX_LIFT) { out.said += `; the eyes would lie under the captions, too low to raise the picture for (${lift} px)`; return out; }
  const box = { ...cropBox([win[0], lift / k, win[1] - win[0], (SIZE[1] - lift) / k], [0, 0, SIZE[0], SIZE[1] - lift], [cw, ch]), fade: FADE };
  return { ...out, frame: "crop", box, x: null, changed: true, said: `${out.said}; raised ${lift} px, so that the captions lie on no eyes or nose${held.some((p) => p.talks) ? " or the mouth of who talks" : ""} (the ground below it)` };
}

// whether a crop shows the eyes, nose and mouth of every held face, their eyes inside it and their noses above the captions
function cropHolds(box, held, captions) {
  const [sx, sy, sw, sh] = box.src, [wx, wy, ww, wh] = box.at, kx = ww / sw, ky = wh / sh;
  for (const p of held) for (const e of p.feats) {
    if (e[0] < sx - 1 || e[0] + e[2] > sx + sw + 1 || e[1] < sy - 1) return false;
    if (captions && under(wy + (e[1] - sy) * ky, wy + (lowOf(p, e) - sy) * ky, captions) && Math.min(wx + (e[0] + e[2] - sx) * kx, captions[0] + captions[2]) > Math.max(wx + (e[0] - sx) * kx, captions[0])) return false;
  }
  return true;
}

// the band's pan that puts the hull's middle in the middle of the window, within the picture
function placePan(out, hull, cw) {
  const w = Math.round((SIZE[0] * out.zoom) / 2) * 2;
  if (w === SIZE[0]) return { ...out, pan: 0.5 };
  const k = w / cw, play = w - SIZE[0];
  const left = Math.max(0, Math.min(play, ((hull[0] + hull[1]) / 2) * k - SIZE[0] / 2));
  return { ...out, pan: Math.round((left / play) * 1000) / 1000 };
}

// where the sharp picture stands in the frame, top to bottom (the rest is its blurred copy)
export function bandOf({ frame = "whole", zoom = 1, box = null, size: [cw, ch] }) {
  if (frame === "crop") return [box.at[1], box.at[1] + box.at[3]];
  const w = Math.round((SIZE[0] * zoom) / 2) * 2, bandH = 2 * Math.round((ch * (w / cw)) / 2);
  const top = Math.floor((SIZE[1] - bandH) / 2);
  return [top, top + bandH];
}

// a box of the source (before the black bars were cut) → the clip's frame
export function mapper({ frame, zoom = 1, pan = 0.5, x = null, box = null, size: [cw, ch], bars = [0, 0] }) {
  let k, ky, dx, dy;
  if (frame === "crop") {
    k = box.at[2] / box.src[2]; ky = box.at[3] / box.src[3];
    dx = box.at[0] - box.src[0] * k; dy = box.at[1] - box.src[1] * ky;
    return (b) => [(b[0] - bars[0]) * k + dx, (b[1] - bars[1]) * ky + dy, b[2] * k, b[3] * ky];
  }
  if (frame === "fill") {
    k = SIZE[1] / ch;
    const ws = 2 * Math.round((cw * k) / 2);
    dx = -(x != null ? x : (ws - SIZE[0]) * pan); dy = 0;
  } else if (frame === "whole") {
    const w = Math.round((SIZE[0] * zoom) / 2) * 2;
    k = w / cw;
    const bandH = 2 * Math.round((ch * k) / 2);
    dx = w === SIZE[0] ? 0 : -Math.floor((w - SIZE[0]) * pan); dy = Math.floor((SIZE[1] - bandH) / 2);
  } else {
    k = Math.max(SIZE[0] / cw, SIZE[1] / ch);
    dx = -(cw * k - SIZE[0]) / 2; dy = -(ch * k - SIZE[1]) / 2;
  }
  return (b) => [(b[0] - bars[0]) * k + dx, (b[1] - bars[1]) * k + dy, b[2] * k, b[3] * k];
}

// the visible part of a box in the frame (a band's face outside the band shows only blurred: cut to the band)
function clip(b, top = 0, bottom = SIZE[1]) {
  const x0 = Math.max(0, b[0]), y0 = Math.max(top, b[1]), x1 = Math.min(SIZE[0], b[0] + b[2]), y1 = Math.min(bottom, b[1] + b[3]);
  return x1 - x0 >= 1 && y1 - y0 >= 1 ? [x0, y0, x1 - x0, y1 - y0] : null;
}

// The faces of a beat in the frame on the film's clock: the stretch's second s plays at the film's
// from + s / speed; every clip moves by a twenty-fifth while it runs (scale `move` [from, to] about
// the frame's middle), as the composition does. Only faces TEXT_FACE of the frame tall or more.
// `talks`: who talks into the camera in the beat (its boxes marked `talks`), or null.
export function framed({ list, place, from, seconds, speed = 1, move = [1, 1], band = null, talks = null }) {
  const out = [];
  const to = mapper(place);
  for (const f of list?.faces || []) {
    const c = f.t / speed;
    if (c < 0 || c >= seconds) continue;
    const s = move[0] + (move[1] - move[0]) * (c / seconds);
    const grow = (b) => [SIZE[0] / 2 + (b[0] - SIZE[0] / 2) * s, SIZE[1] / 2 + (b[1] - SIZE[1] / 2) * s, b[2] * s, b[3] * s];
    const boxes = [];
    for (const b of f.boxes || []) {
      const box = clip(grow(to(b.box)), band?.[0], band?.[1]);
      if (!box || box[3] < TEXT_FACE * SIZE[1]) continue;
      const feat = b.feat ? grow(to(b.feat)) : null;
      boxes.push({ who: b.who ?? "a face", box: box.map((v) => Math.round(v)), ...(feat ? { feat: feat.map((v) => Math.round(v)) } : {}), ...(talks != null && (b.who ?? "a face") === talks ? { talks: true } : {}) });
    }
    if (boxes.length) out.push({ t: Math.round((from + c) * 1000) / 1000, step: (list.step || 0.1) / speed, boxes });
  }
  return out;
}

// A face's lines, as agentitos' layout takes them (copied: a skill never imports another's code):
// from its eyes, nose and mouth (feat) the nose line 70 % down it, the lip line 88 %, the mouth
// line its bottom and 15 % more; without feat, from the box (the eyes' top at 38 %, the mouth's
// bottom at 86 % of its height).
const overlaps = (a, b) => Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]) > 0 && Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]) > 0;
// what a second on each part weighs (a guess, to tell two places apart): the eyes or nose most;
// the mouth little, since nobody shown is heard (above), but the mouth and lower lip of one who
// talks into the camera (talk) as much as the eyes; the hair or forehead (and the side of a head,
// beside the eyes, nose and mouth) is a part of its own and mild: a text there covers no feature
export const WEIGHT = { nose: 100, mouth: 2, lip: 1, hair: 0.5, chin: 0.2, talk: 100 };

// The parts of a face a text box lies on, top to bottom, each only where the box overlaps it: the
// hair or forehead (from the box's top to the eyes), the eyes or nose (to the nose line), the mouth
// (to the lip line), the lower lip (to the mouth line), the chin (below it). The eyes, nose, mouth
// and lip are as wide as the features; the rest of the head beside them counts as the hair.
export function partsOn(text, box, feat) {
  if (!overlaps(text, box)) return [];
  const e = featOf(box, feat), y0 = text[1], y1 = text[1] + text[3];
  const across = Math.min(text[0] + text[2], e[0] + e[2]) - Math.max(text[0], e[0]) > 0;
  const lines = [box[1], e[1], e[1] + 0.7 * e[3], e[1] + 0.88 * e[3], e[1] + 1.15 * e[3], Math.max(box[1] + box[3], e[1] + 1.15 * e[3])];
  const names = ["hair", "nose", "mouth", "lip", "chin"], out = new Set();
  names.forEach((n, i) => {
    if (!(Math.min(y1, lines[i + 1]) - Math.max(y0, lines[i]) > 0)) return;
    out.add(across || n === "hair" || n === "chin" ? n : "hair");
  });
  return [...out];
}

// a text box over [from, to) of the film on the faces of moments: seconds on a face and on each
// part (the worst it lies on; the mouth or lower lip of a face marked `talks` is "talk"), their
// weighed sum, and `hard`: the seconds on what must stay clear (the eyes or nose, a talking mouth)
export function textOn(box, moments, from = 0, to = Infinity) {
  const r = { seconds: 0, nose: 0, mouth: 0, lip: 0, hair: 0, chin: 0, talk: 0 };
  for (const m of moments) {
    if (m.t < from || m.t >= to) continue;
    let worst = null;
    for (const f of m.boxes) for (const p of partsOn(box, f.box, f.feat)) {
      const part = f.talks && (p === "mouth" || p === "lip") ? "talk" : p;
      if (!worst || WEIGHT[part] > WEIGHT[worst]) worst = part;
    }
    if (!worst) continue;
    r.seconds += m.step; r[worst] += m.step;
  }
  for (const k of Object.keys(r)) r[k] = r2(r[k]);
  r.cost = r2(Object.keys(WEIGHT).reduce((n, k) => n + WEIGHT[k] * r[k], 0));
  r.hard = r2(r.nose + r.talk);
  return r;
}

// What of a captions style's ink lies outside its line (em of the type), as clips' place takes it
// (copied): below the lowest line half the outline and the shadow's drop, at each side half the outline
export function inkOf(look) {
  if (!look) return null;
  const k = 1 / (look.size || 96), drop = Math.max(0, ...[...String(look.shadow || "").matchAll(/(?:^|,)\s*-?[\d.]+(?:px)?\s+(-?[\d.]+)px/g)].map((m) => Number(m[1])));
  return { line: look.lineHeight || 1.2, box: !!look.box, below: look.box ? 0 : +(((look.stroke || 0) / 2 + drop) * k + 0.05).toFixed(3), side: +(((look.stroke || 0) / 2) * k).toFixed(3) };
}
