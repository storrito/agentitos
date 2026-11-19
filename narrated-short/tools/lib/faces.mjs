// The faces of a beat, where `faces` found them (agentitos' clips: its frame.mjs --faces on the
// beat's stretch of the source), and what build does with them: the window of a `fill` or a
// zoomed `whole` moved so that it holds the faces that matter, and the faces in the frame over the
// film's time, to keep the captions and the hook off them. Pure geometry, no programs run here.
//
//   counted(list, [w, h], seconds) → { held: [person], small: [person] }: who the window must hold
//   planWindow({ frame, zoom, pan, zoomSet, panSet, size, held }) → what the beat's picture becomes
//   mapper({ frame, zoom, pan, x, size, bars }) → box of the source → box of the 1080×1920 clip
//   framed(…) → [{ t, boxes: [{ who, box, feat? }] }] on the film's clock, as the composition plays it
//   textOn(box, moments, from, to) → { seconds, nose, mouth, lip, chin, cost }: a text box on faces
//
// A box is [x, y, w, h]. Every list of faces is { step, faces: [{ t, boxes: [{ who, box, feat? }] }] }
// in px of the source and seconds of the stretch (0 = the beat's `at`).

export const SIZE = [1080, 1920];
// A person the window holds: seen in a quarter of the beat's moments at least, a face at least
// half as tall as the largest one's and MIN_FACE of the source's height (people walking far off,
// a face in a crowd: their place is no reason to move a picture). A doubt never moves it: a face
// the model saw on one still only is no reason either.
export const SEEN = 0.25, AS_TALL = 0.5, MIN_FACE = 0.04;
// room kept beside a face in the window: a share of its width each side (an ear, hair)
export const SIDE = 0.12;
// the frame's faces a text is checked against: at least this share of the frame's height
export const TEXT_FACE = 0.03;

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

export function counted(list, [, h], seconds) {
  const moments = Math.max(1, Math.round(seconds / (list?.step || 0.1)));
  const people = new Map();
  for (const f of list?.faces || []) for (const b of f.boxes || []) {
    const who = b.who ?? "a face";
    if (!people.has(who)) people.set(who, { who, boxes: [] });
    people.get(who).boxes.push(b.box);
  }
  const all = [...people.values()].map((p) => ({ ...p, n: p.boxes.length, h: median(p.boxes.map((b) => b[3])) }));
  const tallest = Math.max(0, ...all.filter((p) => p.n >= SEEN * moments).map((p) => p.h));
  const held = all.filter((p) => p.n >= SEEN * moments && p.h >= AS_TALL * tallest && p.h >= MIN_FACE * h);
  return { held, small: all.filter((p) => !held.includes(p)) };
}

// the stretch of the source's width the held faces need: [x0, x1], each face with SIDE of its width beside it
export function hullOf(held) {
  let x0 = Infinity, x1 = -Infinity;
  for (const p of held) for (const b of p.boxes) { x0 = Math.min(x0, b[0] - SIDE * b[2]); x1 = Math.max(x1, b[0] + b[2] + SIDE * b[2]); }
  return Number.isFinite(x0) ? [x0, x1] : null;
}

const r2 = (x) => Math.round(x * 100) / 100;
// the part of the source's width a frame shows: [x0, x1] in px of the source (after the black bars)
export function shown({ frame, zoom = 1, pan = 0.5, x = null, size: [cw, ch] }) {
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

// Where the window goes for the faces that matter, and what is said. The agent's own `pan` stands
// (only a warning where it cuts a face); a `fill` from the middle that would cut one moves to the
// faces, or, where they are wider apart than its window, becomes the whole picture as a band as
// large as holds them all; a zoomed band moves to them, and the first beat's own 1.6× becomes less
// where they need it. A zoom the tool chooses also keeps every chin (and a margin below it) above
// `chinsAbove`, the captions' top: a band grown over the captions would push a close face into
// them, and the captions stand in one place for the whole short. Nothing changes where the window
// holds them already.
// → { frame, zoom, pan, x (fill's crop in px of the scaled source, or null), changed, said, cut: [who] }
export function planWindow({ frame, zoom = 1, pan = 0.5, zoomSet = false, panSet = false, size: [cw, ch], held, chinsAbove = null }) {
  const out = { frame, zoom, pan, x: null, changed: false, said: "", cut: [] };
  const hull = hullOf(held);
  if (!hull || frame === "native") return out;
  const names = (ps) => ps.map((p) => p.who).join(", ");
  const inside = (win) => held.filter((p) => p.boxes.some((b) => b[0] < win[0] - 1 || b[0] + b[2] > win[1] + 1));
  const now = shown({ frame, zoom, pan, size: [cw, ch] });
  const width = now[1] - now[0], need = hull[1] - hull[0], middle = (hull[0] + hull[1]) / 2;
  // the largest zoom of a band that holds them across, and keeps their chins above the captions
  const most = Math.min(3, cw / need, chinZoom(held, [cw, ch], chinsAbove));
  const down = (z) => Math.max(1, Math.floor(z * 100) / 100);
  const held_ = hull[0] >= now[0] - 1 && hull[1] <= now[1] + 1;
  if (held_ && !(frame === "whole" && !zoomSet && zoom > 1 && zoom > most + 0.005)) { out.said = `the faces (${names(held)}) are in the picture as it is`; return out; }
  if (panSet || (frame === "whole" && zoomSet && need > width)) {
    const cut = inside(now);
    out.cut = cut.map((p) => p.who);
    if (cut.length) out.said = `${panSet ? "your \"pan\"" : `your "zoom": ${zoom}`} cuts ${names(cut)}`;
    return out;
  }
  if (frame === "fill") {
    if (need <= width) {
      const k = SIZE[1] / ch, ws = 2 * Math.round((cw * k) / 2);
      out.x = Math.max(0, Math.min(ws - SIZE[0] - 2, Math.round((middle - width / 2) * k)));
      out.changed = true;
      out.said = `the crop moved to the faces (${names(held)}): from the middle it cut them`;
      return out;
    }
    // wider than a fill's window: the whole picture, as large as holds them all
    out.frame = "whole";
    out.zoom = down(most);
    out.pan = 0.5;
    out.changed = true;
    out.said = `a fill would cut ${names(held)} (${held.length > 1 ? "they stand" : "the face takes"} ${Math.round((need / cw) * 100)} % of the width): the whole picture as a band${out.zoom > 1 ? `, ${out.zoom} times larger` : ""}${out.zoom < down(cw / need) ? ", its chins above the captions" : ""}`;
    return placePan(out, hull, cw);
  }
  // a zoomed band: as large as it was where that holds them, else less
  if (need > width || (!zoomSet && zoom > most + 0.005)) {
    out.zoom = down(Math.min(zoom, most));
    out.changed = true;
    out.said = `the band ${out.zoom > 1 ? `${out.zoom} times larger instead of ${zoom}` : `at its whole width instead of ${zoom} times larger`}, so that it holds ${names(held)}${need <= cw / out.zoom && most < cw / need ? " with the chins above the captions" : ""}`;
    return out.zoom > 1 ? placePan(out, hull, cw) : { ...out, pan: 0.5 };
  }
  out.changed = true;
  out.said = `the band's window moved to the faces (${names(held)}): from the middle it cut them`;
  return placePan(out, hull, cw);
}

// The largest zoom of a band at which every chin of the held faces, and a margin below it (layout's:
// a twelfth of the face's height, 24 px at least), stays above y `above` of the frame (Infinity: no limit).
// A band's middle is the frame's: a point y of the source lands at 960 + (y − ch/2) · k, k = 1080 · zoom / cw.
export function chinZoom(held, [cw, ch], above) {
  if (above == null) return Infinity;
  let k = Infinity;
  for (const p of held) for (const b of p.boxes) {
    const below = b[1] + b[3] - ch / 2 + 0.08 * b[3], room = above - SIZE[1] / 2 - 24;
    if (below > 0) k = Math.min(k, room / below);
  }
  return Number.isFinite(k) ? Math.max(0, (k * cw) / SIZE[0]) : Infinity;
}

// the band's pan that puts the hull's middle in the middle of the window, within the picture
function placePan(out, hull, cw) {
  const w = Math.round((SIZE[0] * out.zoom) / 2) * 2;
  if (w === SIZE[0]) return { ...out, pan: 0.5 };
  const k = w / cw, play = w - SIZE[0];
  const left = Math.max(0, Math.min(play, ((hull[0] + hull[1]) / 2) * k - SIZE[0] / 2));
  return { ...out, pan: Math.round((left / play) * 1000) / 1000 };
}

// where a band stands in the frame, top to bottom (the rest is its blurred copy)
export function bandOf({ zoom = 1, size: [cw, ch] }) {
  const w = Math.round((SIZE[0] * zoom) / 2) * 2, bandH = 2 * Math.round((ch * (w / cw)) / 2);
  const top = Math.floor((SIZE[1] - bandH) / 2);
  return [top, top + bandH];
}

// a box of the source (before the black bars were cut) → the clip's frame
export function mapper({ frame, zoom = 1, pan = 0.5, x = null, size: [cw, ch], bars = [0, 0] }) {
  let k, dx, dy;
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
export function framed({ list, place, from, seconds, speed = 1, move = [1, 1], band = null }) {
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
      boxes.push({ who: b.who ?? "a face", box: box.map((v) => Math.round(v)), ...(feat ? { feat: feat.map((v) => Math.round(v)) } : {}) });
    }
    if (boxes.length) out.push({ t: Math.round((from + c) * 1000) / 1000, step: (list.step || 0.1) / speed, boxes });
  }
  return out;
}

// A face's lines, as agentitos' layout takes them (copied: a skill never imports another's code):
// from its eyes, nose and mouth (feat) the nose line 70 % down it, the lip line 88 %, the mouth
// line its bottom and 15 % more; without feat, from the box (the eyes' top at 38 %, the mouth's
// bottom at 86 % of its height).
const IMPLIED = [0.38, 0.86];
const featOf = (b, feat) => feat || [b[0] + 0.18 * b[2], b[1] + IMPLIED[0] * b[3], 0.64 * b[2], (IMPLIED[1] - IMPLIED[0]) * b[3]];
const lineOf = (b, feat, k) => { const e = featOf(b, feat); return e[1] + k * e[3]; };
const overlaps = (a, b) => Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]) > 0 && Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]) > 0;
// what a second on each part weighs, in the order layout weighs them (a guess, to tell two places apart)
export const WEIGHT = { nose: 100, mouth: 20, lip: 1, chin: 0.2 };

// a text box over [from, to) of the film on the faces of moments: seconds on a face and on each
// part (the highest it reaches), and their weighed sum
export function textOn(box, moments, from = 0, to = Infinity) {
  const r = { seconds: 0, nose: 0, mouth: 0, lip: 0, chin: 0 };
  for (const m of moments) {
    if (m.t < from || m.t >= to) continue;
    let worst = null;
    for (const f of m.boxes) {
      if (!overlaps(box, f.box)) continue;
      const reaches = (line) => box[1] < line;
      const part = reaches(lineOf(f.box, f.feat, 0.7)) ? "nose" : reaches(lineOf(f.box, f.feat, 0.88)) ? "mouth" : reaches(lineOf(f.box, f.feat, 1.15)) ? "lip" : "chin";
      if (!worst || WEIGHT[part] > WEIGHT[worst]) worst = part;
    }
    if (!worst) continue;
    r.seconds += m.step; r[worst] += m.step;
  }
  for (const k of Object.keys(r)) r[k] = r2(r[k]);
  r.cost = r2(Object.keys(WEIGHT).reduce((n, k) => n + WEIGHT[k] * r[k], 0));
  return r;
}

// What of a captions style's ink lies outside its line (em of the type), as clips' place takes it
// (copied): below the lowest line half the outline and the shadow's drop, at each side half the outline
export function inkOf(look) {
  if (!look) return null;
  const k = 1 / (look.size || 96), drop = Math.max(0, ...[...String(look.shadow || "").matchAll(/(?:^|,)\s*-?[\d.]+(?:px)?\s+(-?[\d.]+)px/g)].map((m) => Number(m[1])));
  return { line: look.lineHeight || 1.2, box: !!look.box, below: look.box ? 0 : +(((look.stroke || 0) / 2 + drop) * k + 0.05).toFixed(3), side: +(((look.stroke || 0) / 2) * k).toFixed(3) };
}
