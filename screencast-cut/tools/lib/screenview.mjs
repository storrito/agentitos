// A screen keep (the screen shown whole, or a "zoom" box of it) placed through agentitos' layout
// skill (its place.mjs, run as a program; placement.mjs finds it): the screen's size, the zoom box
// in the screen's pixels as the region (the whole screen where there is none), the keep's "text"
// (how tall a capital of the smallest text that must be read is, in px of the screen) as
// --min-text-height, the webcam with the face face.mjs found as a second source (for the circle),
// the captions' band as captions built it, the platforms. Which picture a keep shows:
//   1. the one the keep names ("layout": a candidate's name, or "as before");
//   2. the picture this skill drew before it asked layout (layout.spread, "as before") where it
//      passes: the region inside the safe box across (or inside the zones' wide stretch), the
//      circle and a label that is on off the region, nothing of it under an app's bar, and, where
//      the keep says how tall its text is, that text at the height layout says reads in this frame;
//   3. else the first other picture that removes a fault the one as before has and adds none (of
//      those, the one with the fewest left): the picture as before with the circle in a free
//      corner, the same moved across inside the margins at its scale, then layout's candidates the
//      composition draws (screen-zoom, screen-fit; screen-whole only for the whole screen) without
//      a hard fault; the list says what was wrong with the picture as before. Where none does
//      (layout's has the label on the region too, or is smaller and its text no better), the
//      picture as before stays and the list says what remains wrong.
// The circle keeps main's place and size in every picture where that place is off the region and
// off the label, and moves to a corner off them only where it is not (decided 2026-11-19,
// circle-still); layout's own circle is not taken.
// Whatever goes wrong (no layout skill, place stops, runs over its time, refuses the box, gives no
// candidate to draw) the keep is drawn as before, with one sentence: the build never stops for it.
// screen-stacked (the screen above, the speaker in a panel below) is not drawn: with the captions
// at the safe box's bottom it has no place for them (layout marks it –).
// The stack (decided 2026-11-19, stack-916): in 9:16 and 4:5 layout's screen-panel, asked in a call of
// its own (--screen-panel), draws the screen above and the speaker's panel below it down to the
// caption line where layout offers it and its screen is no smaller than main's (stackOne).
//
//   beforePicture(c, src, areas, pip)        → the picture as before as a placement
//   judge(pic, { zones, labels, text, readable, width, height }) → { faults, under, textHeight, ground }
//   placeScreen({ tool, folder, src, crop, text, cam, width, height, area, platforms }) → { res } | { why }
//   choose(before, list, { asked, text }) → { pic, why, named?, missing? }
//   textSentence(pic, { text, readable, note }) → what a line of the screen becomes here
//   screenView(dir, cut, pieces, sources, { width, height, platforms, area, zones, areas, labels }) → lines

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { layoutTool, PLACE_TIMEOUT, softOf, FACE_MIN } from "./placement.mjs";
import { spread, largest, labelBox } from "./layout.mjs";
import { clock } from "./media.mjs";

// a line of a desktop's usual type, in px of the screen, for the plain fact where the keep does
// not say how tall its text is
export const LINE = 18;
export const BEFORE = "as before";
export const DRAWN = /^screen-(zoom|fit|whole)$/;

const r0 = (v) => Math.round(v), r1 = (v) => +v.toFixed(1), r2 = (v) => +v.toFixed(2);
const pct = (v) => `${Math.round(v * 100)} %`;
const meets = (a, b) => Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]) > 0.5 && Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]) > 0.5;
const span = (b) => `x ${r0(b[0])}–${r0(b[0] + b[2])}`;

// the picture composition.shots drew for a screen's part before this step: what matters (the crop
// c, 0–1 of the source) as large as the safe room allows, at most 2×, the rest of the screen out to
// the frame's edges above the captions; the circle at the areas' place
export function beforePicture(c, src, a, pip) {
  const rooms = pip ? [...a.content, ...(a.beside || [])] : a.solo || a.content;
  const at = spread(rooms, a.bleed || largest(a.content), c, src, { maxScale: 2, near: !!a.line });
  const scale = at.width / src.width;
  return { fit: BEFORE, scale: +scale.toFixed(4), left: at.left, top: at.top, window: at.box.map(r1),
    region: [at.left + c[0] * at.width, at.top + c[1] * at.height, (c[2] - c[0]) * at.width, (c[3] - c[1]) * at.height].map(r1),
    circle: pip ? [a.pip[0], a.pip[1], a.pip[2]] : null };
}

// The circle in another corner of the safe box (between its top and the captions' band, as the
// areas keep it), in the order the layout skill tries them (upright: bottom left, bottom right, top
// left, top right; else top right, top left, bottom right, bottom left): the first that lies off
// the region and off the labels; over the rest of the screen is allowed. null where none is free.
// The bottom corners end the skill's gap above the captions' band as built (band: its top, from
// captions/area.json, which can lie above the areas' estimate: 772 against 800 in 16:9), and a
// corner keeps that gap from a label too. With one caption line (areas().line) they end where the
// band for two lines ended (areas.floor), so a moved circle stands as on main.
export function freeCorner(pic, { zones, areas, labels = [], width, height, band = null }) {
  if (!pic.circle) return null;
  const gap = Math.round(Math.min(width, height) * 0.022);
  const [sx, sy, sw] = zones.safe, d = pic.circle[2];
  const bottom = Math.min(areas.floor ?? (areas.bleed ? areas.bleed[3] : sy + zones.safe[3]), Number.isFinite(band) ? band - gap : Infinity);
  const near = labels.map((l) => [l[0] - gap, l[1] - gap, l[2] + 2 * gap, l[3] + 2 * gap]);
  const order = height >= width * 1.5 ? ["bottom left", "bottom right", "top left", "top right"] : ["top right", "top left", "bottom right", "bottom left"];
  for (const corner of order) {
    const c = [corner.endsWith("left") ? sx : sx + sw - d, corner.startsWith("top") ? sy : bottom - d, d];
    const sq = [c[0], c[1], d, d];
    if (Math.abs(c[0] - pic.circle[0]) < 1 && Math.abs(c[1] - pic.circle[1]) < 1) continue;
    if (corner.startsWith("bottom") && bottom - d < sy) continue;
    if (meets(sq, pic.region) || near.some((l) => meets(l, sq))) continue;
    return { circle: c, corner };
  }
  return null;
}

// The picture as before moved across, at its scale, by as little as brings its region inside the
// safe box (or inside the zones' wide stretch above the buttons, where it lies above them), the
// rest of the screen still to the frame's edges; null where the region is wider than both, or
// where it needs no move (decided 2026-11-19, circle-still: a shift comes before a shrink)
export function shiftedInside(pic, src, zones, areas, width) {
  const R = pic.region, Wd = zones.wide;
  // of the boxes that hold it (the wide stretch only where the region lies above the buttons), the
  // smallest shift: 60 px into the wide stretch rather than 192 px into the safe box in 9:16
  const into = [zones.safe, ...(Wd && R[1] + R[3] <= Wd[1] + Wd[3] + 0.5 ? [Wd] : [])].filter((b) => R[2] <= b[2] + 0.5);
  if (!into.length) return null;
  const dx = into.map(([sx, , sw]) => Math.max(sx - R[0], Math.min(0, sx + sw - (R[0] + R[2])))).reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
  if (Math.abs(dx) < 0.5) return null;
  const left = pic.left + dx, w = src.width * pic.scale, h = src.height * pic.scale;
  const [bx, by, bw, bh] = areas.bleed || [0, 0, width, pic.window[1] + pic.window[3]];
  const x0 = Math.max(left, bx), y0 = Math.max(pic.top, by), x1 = Math.min(left + w, bx + bw), y1 = Math.min(pic.top + h, by + bh);
  return { ...pic, fit: `${BEFORE}, inside the margins`, shift: r0(dx), left: r1(left), window: [x0, y0, x1 - x0, y1 - y0].map(r1), region: [R[0] + dx, R[1], R[2], R[3]].map(r1) };
}

// The circle at main's place and main's size (decided 2026-11-19, circle-still: it stands still
// between keeps); only where that place lies on the picture's region or on a label, in the first
// free corner (freeCorner). main: areas().pip ([x, y, d]) or null without the circle.
export function seat(pic, main, { zones, areas, labels = [], width, height, band = null }) {
  const at = { ...pic, circle: main ? [main[0], main[1], main[2]] : null };
  delete at.corner;
  if (!main) return at;
  const sq = [main[0], main[1], main[2], main[2]];
  if (!meets(sq, at.region) && !labels.some((l) => meets(l, sq))) return at;
  const free = freeCorner(at, { zones, areas, labels, width, height, band });
  return free ? { ...at, circle: free.circle, corner: free.corner } : at;
}

// What a picture shows of the screen and what lies on it: the region past the safe box's margins
// across, the circle or a label on the region, the region under an app's bar (platform-zones'
// covers), the keep's text under the height that reads (layout's, for this frame). ground: the
// share of the frame the sharp picture leaves.
export function judge(pic, { zones, labels = [], text = 0, readable = 0, width, height }) {
  const R = pic.region, S = zones.safe, Wd = zones.wide, faults = [];
  const inX = (b) => R[0] >= b[0] - 0.5 && R[0] + R[2] <= b[0] + b[2] + 0.5;
  if (!(inX(S) || (Wd && inX(Wd) && R[1] + R[3] <= Wd[1] + Wd[3] + 0.5)))
    faults.push({ code: "across", said: `its region runs ${span(R)}, past the safe box's margins (${span(S)}${Wd ? `, above the buttons ${span(Wd)}` : ""})` });
  const sq = pic.circle && [pic.circle[0], pic.circle[1], pic.circle[2], pic.circle[2]];
  if (sq && meets(sq, R)) faults.push({ code: "circle", said: "the webcam's circle lies on its region" });
  else if (sq && labels.some((l) => meets(l, sq))) faults.push({ code: "circle", said: "the webcam's circle lies on the label" });
  if (labels.some((l) => meets(l, R))) faults.push({ code: "label", said: "the label lies on its region" });
  const names = Object.fromEntries((zones.platforms || []).map((p) => [p.id, p.name]));
  const under = [...new Set((zones.covers || []).filter((c) => meets(c.box, R)).map((c) => names[c.platform] || c.platform))];
  if (under.length) faults.push({ code: "bars", said: `its region lies under the bars of ${under.join(", ")}` });
  const textHeight = text ? r1(text * pic.scale) : null;
  if (text && readable && textHeight < readable - 0.05) faults.push({ code: "text", said: `its text (${text} px on the screen) is ${textHeight} px tall, under the ${readable} px from which text begins to read` });
  const [x, y, w, h] = pic.window;
  const seen = Math.max(0, Math.min(x + w, width) - Math.max(x, 0)) * Math.max(0, Math.min(y + h, height) - Math.max(y, 0));
  return { faults, under, textHeight, ground: r2(1 - seen / (width * height)) };
}

// the zoom box in px of the screen, inside it (layout refuses a box past the source's edge)
export function regionPx(c, src) {
  const x0 = Math.max(0, Math.floor(c[0] * src.width)), y0 = Math.max(0, Math.floor(c[1] * src.height));
  const x1 = Math.min(src.width, Math.ceil(c[2] * src.width)), y1 = Math.min(src.height, Math.ceil(c[3] * src.height));
  return [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)];
}

// layout's candidates for one screen part, or the reason there are none (place's own words kept
// in the folder's place.log). cam: the webcam ({ width, height, face }) where the circle shows,
// its face (0–1) for the crop; without a known face, the webcam's middle, a little high, stands in.
export function placeScreen({ tool, folder, src, crop, text = 0, cam = null, faces = null, width, height, area = null, platforms = [], timeout = PLACE_TIMEOUT, extra = [] }) {
  try {
    fs.mkdirSync(folder, { recursive: true });
    const R = regionPx(crop, src);
    const f = cam ? (cam.face || [0.35, 0.2, 0.65, 0.65]) : null;
    const px = (b) => [b[0] * cam.width, b[1] * cam.height, (b[2] - b[0]) * cam.width, (b[3] - b[1]) * cam.height].map((v) => r0(v));
    // faces: every person of the webcam's picture (0–1 boxes) where more than one was seen (the stack)
    const boxes = cam ? (faces?.length ? faces : [f]).map(px) : [];
    const args = [tool, "place", folder, "--frame", `${width}x${height}`, "--source", `${src.width}x${src.height}`, ...(text ? ["--min-text-height", String(text)] : []), "--region", R.join(","),
      ...(cam ? ["--source", `${cam.width}x${cam.height}`, ...boxes.flatMap((b) => ["--face", b.join(",")])] : []),
      ...(area ? ["--caption-area", area] : []), ...(platforms.length ? ["--platform", platforms.join(",")] : []), ...extra, "--json"];
    const r = spawnSync(process.execPath, args, { encoding: "utf8", maxBuffer: 64 << 20, timeout: timeout * 1000 });
    if (r.error?.code === "ETIMEDOUT" || r.signal) return { why: `layout's place ran over ${timeout} s for it and was stopped` };
    if (r.status !== 0 || r.error) {
      fs.writeFileSync(path.join(folder, "place.log"), `${r.error ? `${r.error.message}\n` : ""}${r.stdout || ""}${r.stderr || ""}`);
      return { why: `layout's place gave no candidates for it (its words in ${path.join(folder, "place.log")})` };
    }
    return { res: JSON.parse(r.stdout) };
  } catch (e) {
    return { why: `the placement stopped (${e.message.split("\n")[0]})` };
  }
}

const markOf = (c) => (c.hard ? "✗" : c.unmet?.length ? "–" : c.soft ? "!" : "✓");
const box4 = (b) => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite);
// a candidate of layout's the composition can draw: a drawn fit, a positive scale, its place, a
// window that is not empty and the region in the frame; anything else is left out
export const drawable = (c) => !!c && typeof c === "object" && DRAWN.test(c.fit) && Number.isFinite(c.scale) && c.scale > 0 && Number.isFinite(c.left) && Number.isFinite(c.top)
  && box4(c.window) && c.window[2] > 0 && c.window[3] > 0 && box4(c.faceInFrame?.[0]);
// a candidate of layout's as a picture the composition draws; its own circle is not taken (the
// circle stays at main's place and size, seat())
export function pictureOf(c) {
  const mark = markOf(c);
  return { fit: c.fit, scale: c.scale, left: c.left, top: c.top, window: c.window, region: c.faceInFrame[0], circle: null, mark, hard: c.hard || 0, ...(mark === "!" && softOf(c) ? { soft: softOf(c) } : {}) };
}

// a fault in a few words, for the lists
export const shortFault = (x, f) => (f.code === "text" ? `text ${x.j.textHeight} px` : f.code === "across" ? `region ${span(x.region)}` : f.code === "bars" ? "under the apps' bars" : `the ${f.code} on the region`);

// Which picture: the one the keep names; else the picture as before where it passes; else the
// first of the others that removes a fault the picture as before has and adds none (of those, the
// first with the fewest faults left): the picture as before with the circle moved, the same shifted
// inside the margins (own, in that order: the circle moves before the picture does, a shift comes
// before a shrink), then layout's in its order (not ✗; for a zoom box not the whole screen, unless
// named). The text of a picture held inside the margins at no less than nine tenths of the scale
// as before may come out under the height that reads (decided 2026-11-19, screen-text: what must
// be read stays inside the safe box across, even at a tenth less size). Where none does, the
// picture as before stays, with what remains wrong. before and every item carry their judgement (j).
// keepOff: main's picture for this keep has the circle off its region (one caption line, where the
// room grew: review of 2026-11-19, the 3440 corners): a picture with the circle on the region
// counts as adding that fault even where the picture as before has it too
export function choose(before, list, { asked = null, zoomed = false, own = [], keepOff = false } = {}) {
  if (asked === BEFORE) return { pic: before, named: true };
  const named = asked ? list.find((x) => x.fit === asked) : null;
  if (named) return { pic: named, named: true };
  const missing = asked || null;
  const had = before.j.faults.map((f) => f.code);
  if (!had.length) return { pic: before, missing };
  const usable = [...own, ...list.filter((x) => !x.hard && !(zoomed && x.fit === "screen-whole"))];
  const codes = (x) => x.j.faults.map((f) => f.code);
  const added = (x) => codes(x).filter((c) => (!had.includes(c) || (keepOff && c === "circle")) && !(c === "text" && had.includes("across") && !codes(x).includes("across") && x.scale >= before.scale * 0.9 - 1e-4));
  const removes = (x) => had.some((c) => !codes(x).includes(c));
  const better = usable.filter((x) => !added(x).length && removes(x));
  const pick = better.reduce((b, x) => (b && b.j.faults.length <= x.j.faults.length ? b : x), null);
  if (pick) return { pic: pick, missing };
  if (!usable.length) return { pic: before, missing, why: "none of layout's pictures for it passes layout's checks" };
  return { pic: before, missing, why: `no other picture removes a fault without adding one (${usable.slice(0, 2).map((x) => `${x.fit} at ${r2(x.scale)}×: ${x.j.faults.map((f) => shortFault(x, f)).join(", ")}`).join("; ")})` };
}

// The most a zoom enlarges the screen's pixels (composition.shots, layout's screen-zoom)
export const MOST = 2;

// Text too small to read even at the most a zoom enlarges (text × MOST under readable): no narrower
// "zoom" helps (the run of 2026-11-19 in 16:9: 12 px at 2× is 24 px, under the 42.7 px that read in
// a 1920 px wide frame; the build's "narrower zoom" sent the agent round in a circle). What is true
// and what can be done: accept it, or a frame where it reads (layout's height that reads goes with
// the frame's width: 24 px in 1080). null where a zoom can make it read.
export function beyondZoom({ text, readable, width = 0 }) {
  if (!text || !readable || text * MOST >= readable - 0.05) return null;
  const narrow = width > 1080 ? r1((readable * 1080) / width) : null;
  const there = narrow && text * MOST >= narrow - 0.05 ? `, or show it in a frame where it reads: in one 1080 px wide (9:16, 4:5, 1:1) a capital reads from ${narrow} px, which this text reaches at ${MOST}× (a zoom box small enough to be shown at ${MOST}× there)` : "";
  return `a zoom enlarges at most ${MOST}×, where this text (${text} px on the screen) is ${r1(text * MOST)} px, under the ${readable} px from which text begins to read in this frame: it cannot be shown larger here, and a narrower "zoom" does not help. Accept it (the words say what it shows)${there}`;
}

// What a line of the screen becomes in the frame: the keep's text where it says how tall (and
// whether it reads), else a line of LINE px, and from what height a capital reads here
export function textSentence(pic, { text = 0, readable = 0, narrower = null, size = null, width = 0 }) {
  const at = `the screen${size ? ` (${size.width}×${size.height})` : ""} at ${r2(pic.scale)}×`;
  if (text) {
    const h = r1(text * pic.scale);
    if (!readable) return `${at}: its text (${text} px on the screen, "text") is ${h} px tall here`;
    if (h >= readable - 0.05) return `${at}: its text (${text} px on the screen, "text") is ${h} px tall here, it reads (from ${readable} px)`;
    const beyond = beyondZoom({ text, readable, width });
    if (beyond) return `${at}: its text (${text} px on the screen, "text") is ${h} px tall here; ${beyond}`;
    return `${at}: its text (${text} px on the screen, "text") is ${h} px tall here, under the ${readable} px from which text begins to read: for it to read surely, give a narrower "zoom" on what is talked about${narrower ? ` (${narrower} reads)` : ""}, or split the keep where the words move on`;
  }
  // without "text" nothing is claimed about reading: the plain fact, and what to do with it
  const line = r1(LINE * pic.scale);
  const from = readable ? `, and a capital reads here from ${Math.ceil(readable / pic.scale)} px tall on the screen` : "";
  return `${at}: a line ${LINE} px tall on the screen is ${line} px here${from}; where its text is smaller, zoom on what is talked about, and say how tall its smallest text is with "text" (px of a capital, off the sheet's grid) to have it checked`;
}

// Every screen piece's picture (each part of a piece that spans a scene change for itself); sets
// p.screenPic (or seg.screenPic) where layout's picture is drawn and p.screen (what check prints)
// on every screen piece; returns the lines the build prints.
// a piece that shows a screen (not a phone's: a tall source; not another video, not the face)
export const isScreenPiece = (p, sources) => !p.show && p.view !== "face" && !!p.source && p.source !== "webcam" && !!sources[p.source]?.video && !(sources[p.source].height > sources[p.source].width * 1.25);

export function screenView(dir, cut, pieces, sources, { width, height, platforms = [], area = null, zones, areas, labels = [], tool = layoutTool(), timeout = PLACE_TIMEOUT }) {
  const ps = pieces.filter((p) => isScreenPiece(p, sources));
  if (!ps.length) return [];
  const cam = sources.webcam?.video ? sources.webcam : null;
  const said = [`Screen (${tool ? `the layout skill, ${area ? "around the captions as built" : "no captions"}` : "as before: agentitos' layout skill is not beside this one, or LAYOUT_TOOL naming its tools/place.mjs"}): the picture as before where it passes (its region inside the safe box across, the circle and the label off it, its text read where the keep's "text" says how tall); else, where the circle lies on the region, the circle in a corner off it; where the region runs past the margins, the same picture moved inside them; else the layout skill's first that removes a fault and adds none, unless a keep names another with "layout"; the circle stays at its place and size wherever it is off the region:`];
  const done = new Map(), folders = [];
  // the captions' band as built: a moved circle ends above it (freeCorner)
  let band = null;
  try { band = area && fs.existsSync(area) ? Number(JSON.parse(fs.readFileSync(area, "utf8")).top) : null; } catch { band = null; }
  const keepSpan = (k) => { const own = pieces.filter((p) => p.keep === k); return `${clock(own[0].start)}–${clock(own.at(-1).start + own.at(-1).duration)}`; };
  // first every picture (a keep's parts that agree share one), then, where a stacked keep has a label,
  // every other stacked keep asked again with that label's room (stack-label-still), then the lines
  const jobs = [];
  for (const p of ps) {
    const keep = cut.keep?.[p.keep] || {};
    const text = Number(keep.text) > 0 ? Number(keep.text) : 0;
    const pip = !!cam && p.pip !== false;
    const on = areas.label ? labels.filter((l) => p.start < l.start + l.duration - 0.001 && p.start + p.duration > l.start + 0.001).map((l) => labelBox(l.text, areas, width, height)) : [];
    const parts = p.segments?.length ? p.segments : [p];
    // for the stack (stack-916): where the keep's label ends, and the face view's picture just before
    const labelBottom = on.length ? Math.max(...on.map((l) => l[1] + l[3])) : null;
    const prev = pieces[pieces.indexOf(p) - 1];
    const before = prev && prev.view === "face" && prev.picture && [prev.picture.scale, prev.picture.left, prev.picture.top].every(Number.isFinite) ? prev.picture : null;
    for (const [i, part] of parts.entries()) {
      const c = part.crop || [0, 0, 1, 1], src = sources[p.source];
      const key = JSON.stringify([p.keep, p.source, c, pip, on]);
      let job = done.get(key);
      if (!job) {
        // the folder is named by the keep (screen-3 for keep 3; screen-3-2 for its second picture)
        const m = folders.filter((k) => k === p.keep).length;
        folders.push(p.keep);
        const args = { dir, name: `screen-${p.keep + 1}${m ? `-${m + 1}` : ""}`, c, src, text, pip, cam, on, keep, tool, timeout, width, height, platforms, area, band, zones, areas, labelBottom, before };
        job = { args, got: placeOne(args), p, c, refs: [] };
        done.set(key, job);
        jobs.push(job);
      }
      job.refs.push({ part, first: i === 0, p });
    }
  }
  // the stacked keeps of one cut stand still: where one of them has a label, every one keeps the
  // room of the cut's tallest label above its screen (decided 2026-11-19 from pull request 113's
  // review, beside circle-still); a keep that is then not offered keeps main's picture, said
  const stacked = (j) => j.got.pic.fit === STACK;
  const room = Math.max(-Infinity, ...jobs.filter((j) => stacked(j) && Number.isFinite(j.args.labelBottom)).map((j) => j.args.labelBottom));
  if (Number.isFinite(room)) for (const j of jobs) {
    if (!stacked(j) || (Number.isFinite(j.args.labelBottom) && j.args.labelBottom >= room - 0.5)) continue;
    j.args = { ...j.args, labelBottom: room, labelRoom: true };
    j.got = placeOne(j.args);
  }
  for (const j of jobs) {
    const { got, p, c } = j;
    said.push(...got.lines.map((l, i) => (i ? `    ${l}` : `  keep ${p.keep + 1} (${keepSpan(p.keep)}${c.join() === "0,0,1,1" ? ", the whole screen" : `, zoom [${c.join(", ")}]`}): ${l}`)));
    for (const r of j.refs) {
      if (got.pic.fit !== BEFORE) r.part.screenPic = got.pic;
      if (r.first) r.p.screen = got.facts;
    }
  }
  if (tool) said.push(`  (every candidate with its reasons: ${path.relative(process.cwd(), path.join(dir, "placement"))}/screen-<keep>/placement.json${jobs.some((j) => j.got.facts.stack !== undefined) ? "; the stack's, with what was chosen: screen-<keep>/stack/placement.json" : ""})`);
  return said;
}

function placeOne({ dir, name, c, src, text, pip, cam, on, keep, tool, timeout, width, height, platforms, area, band, zones, areas, labelBottom = null, labelRoom = false, before: faceBefore = null }) {
  const before = beforePicture(c, src, areas, pip);
  const facts = (pic, j, extra = {}) => ({ fit: pic.fit, scale: r2(pic.scale), ground: j.ground, region: pic.region.map(r0), ...(text ? { text, textHeight: j.textHeight } : {}),
    ...(extra.readable ? { readable: extra.readable } : {}), under: j.under, faults: j.faults.map((f) => f.code), ...(pic.mark ? { mark: pic.mark } : {}), ...(extra.named ? { named: true } : {}) });
  // the two names of the stack's question ("screen-panel", "screen-circle") are not pictures of
  // main's list: main's rule picks for them
  const asked = typeof keep.layout === "string" ? keep.layout.trim() : null;
  const mainKeep = asked === STACK || asked === CIRCLE ? { ...keep, layout: undefined } : keep;
  const asBefore = (why) => {
    const j = judge(before, { zones, labels: on, text, width, height });
    return { pic: before, facts: facts(before, j), lines: [`as before, because ${why}; ${textSentence(before, { text, size: src })}`] };
  };
  // main's picture for the keep, exactly as main draws it; then, in 9:16 and 4:5, the stack
  const got = mainOne();
  return stackOne({ got, name, dir, c, src, text, cam, on, keep, asked, tool, timeout, width, height, platforms, area, zones, areas, labelBottom, labelRoom, faceBefore, facts, pip });
  function mainOne() {
    if (!tool) return asBefore("the layout skill is missing");
    const placed = placeScreen({ tool, folder: path.join(dir, "placement", name), src, crop: c, text, cam: pip ? cam : null, width, height, area: area && fs.existsSync(area) ? area : null, platforms, timeout });
    if (placed.why) return asBefore(placed.why);
    if (!placed.res || typeof placed.res !== "object" || Array.isArray(placed.res)) return asBefore("layout's place answered no placement for it");
    try {
      return chosen({ before, res: placed.res, c, src, text, pip, on, keep: mainKeep, width, height, band, zones, areas, facts }) || asBefore("layout's place gave no picture to draw for it");
    } catch (e) {
      return asBefore(`layout's answer for it could not be drawn (${String(e?.message || e).split("\n")[0]})`);
    }
  }
}

// ------------------------------------------------------------------------------------- the stack
// Decided 2026-11-19 (stack-916, stack-panel): in 9:16 and 4:5 a keep that shows the whole screen or
// a wide zoom is drawn as the screen above and the speaker in a panel below it down to the caption
// line, across the frame, the captions where they stand, the label above the screen; the layout skill
// computes it (place --screen-panel: its candidate screen-panel) and says where it is not offered (a
// tight zoom: the screen's part over its limit; a panel or a face in it too small). It is asked for
// in its own call beside main's, so that main's picture stays what main draws; whatever goes wrong in
// it (no layout skill, a refusal, a timeout, nonsense) leaves main's picture, with one sentence.
export const STACK = "screen-panel", CIRCLE = "screen-circle";

// Why the stack is not asked for this keep, or null where it is (upright: { ask: true }); null
// altogether (no clause in the line) where the question does not arise: a wide or square frame, a
// keep without the circle, a keep that names one of main's pictures
export function stackQuestion({ width, height, areas, cam, pip, asked }) {
  if (height < 1.2 * width || !pip || !cam) return null;
  if (asked && asked !== STACK && asked !== CIRCLE) return null;
  if (asked === CIRCLE) return { why: `the keep names "${CIRCLE}"` };
  if (!areas.line) return { why: "the captions are not one line as the captions skill built it (two lines, or none): the panel ends on that line" };
  if (!cam.face) return { why: "the webcam's face is not known: the panel is cut around it" };
  if (cam.face[3] - cam.face[1] < FACE_MIN) return { why: `the face in the webcam is ${Math.round((cam.face[3] - cam.face[1]) * 100)} % of its height, under the ${FACE_MIN * 100} % of a speaker at the camera` };
  return { ask: true };
}

const num = (v) => Number.isFinite(v);
const inFrame = (b, W, H) => box4(b) && b[2] > 0 && b[3] > 0 && b[0] >= -1 && b[1] >= -1 && b[0] + b[2] <= W + 1 && b[1] + b[3] <= H + 1;
// layout's answer for the stack as a picture the composition draws, or the reason it is not one
export function stackPicture(res, { width, height }) {
  const v = res && typeof res === "object" && !Array.isArray(res) ? res.screenPanel : null;
  if (!v || typeof v !== "object") return { why: "the layout skill's answer has no verdict on it (an older layout skill?)" };
  if (v.offered !== true) return { why: typeof v.why === "string" && v.why ? v.why : "the layout skill does not offer it here", code: v.code || null };
  const c = (Array.isArray(res.candidates) ? res.candidates : []).find((x) => x && x.fit === STACK);
  const s = c?.stack, sp = Array.isArray(c?.parts) ? c.parts[0] : null, cam = s?.camera;
  const ok = s && sp && num(sp.scale) && sp.scale > 0 && num(sp.left) && num(sp.top) && inFrame(s.screen?.box, width, height) && inFrame(s.panel?.box, width, height)
    && cam && num(cam.scale) && cam.scale > 0 && num(cam.left) && num(cam.top) && inFrame(cam.window, width, height) && num(s.face?.height) && s.face.height > 0 && num(s.ground);
  if (!ok) return { why: "the layout skill's answer for it could not be read" };
  return { pic: { fit: STACK, scale: sp.scale, left: sp.left, top: sp.top, window: s.screen.box, region: s.screen.box, circle: null, mark: markOf(c), ...(c.soft && softOf(c) ? { soft: softOf(c) } : {}),
    stack: { panel: s.panel.box, camera: { scale: cam.scale, left: cam.left, top: cam.top, window: cam.window }, ...(Array.isArray(cam.crop) ? { crop: cam.crop } : {}),
      face: { box: s.face.box, height: s.face.height, pct: s.face.pct }, ground: s.ground, ...(s.change?.says && !s.change.before?.assumed ? { change: s.change.says } : {}) } } };
}

// The people in the webcam's picture for the panel: the circle's face, and each of the model's boxes
// (faceAt) that lies further than a face's width or height from it and from those already taken
// (another person, as placement.speakerMoments tells them apart): the layout skill stands those
// who fit in the panel together and refuses the stack where they do not (decided 2026-11-19 in its
// pull request 112). null for one person.
export function webcamPeople(cam) {
  if (!cam?.face || !Array.isArray(cam.faceAt)) return null;
  const far = (a, b) => Math.abs((a[0] + a[2]) / 2 - (b[0] + b[2]) / 2) > b[2] - b[0] || Math.abs((a[1] + a[3]) / 2 - (b[1] + b[3]) / 2) > b[3] - b[1];
  const people = [cam.face];
  for (const m of cam.faceAt) if (Array.isArray(m?.box) && m.box.length === 4 && m.box.every(Number.isFinite) && people.every((p) => far(m.box, p))) people.push(m.box);
  return people.length > 1 ? people : null;
}

// The screen's part of a stack is never flatter than 16:9 of its width (decided 2026-11-19 from pull
// request 113's review: a region alone cut a slide's title mid-letter and left a strip): where the
// keep's region is flatter, the window is the screen around it, as wide as the region (so the same
// scale), grown above and below it up to 16:9 as far as the screen goes (where one side ends, on the
// other: a shift before a shrink). The stack's call gets the window as its region; what must be read
// stays the keep's region. → { crop (0–1), region, window (px of the screen), grown }
export function stackWindow(c, src) {
  // (a region within 2 px of 16:9 is 16:9: a box's rounding grows nothing)
  const R = regionPx(c, src), want = Math.min(src.height, Math.round(R[2] * 9 / 16));
  if (R[3] >= want - 2) return { crop: c, region: R, window: R, grown: false };
  const y = Math.min(Math.max(0, Math.round(R[1] - (want - R[3]) / 2)), src.height - want);
  const window = [R[0], y, R[2], want];
  return { crop: [R[0] / src.width, y / src.height, (R[0] + R[2]) / src.width, (y + want) / src.height], region: R, window, grown: true };
}

function stackOne({ got, name, dir, c, src, text, cam, on, keep, asked, tool, timeout, width, height, platforms, area, zones, areas, labelBottom, labelRoom = false, faceBefore, facts, pip }) {
  const q = stackQuestion({ width, height, areas, cam, pip, asked });
  const refused = (why) => {
    if (!q) return got;
    const lines = [...got.lines];
    lines[0] += `; not the stack (the screen above, the speaker in a panel below): ${why}`;
    if (asked === STACK) lines.push(`! "layout": "${STACK}" is not drawn here (${why}), so the keep keeps the circle`);
    return { ...got, lines, facts: { ...got.facts, stack: null, notStacked: why } };
  };
  if (!q) {
    if (asked === STACK) return { ...got, lines: [...got.lines, `! "layout": "${STACK}" (the screen above, the speaker in a panel below) is for 9:16 and 4:5 with the webcam shown, so the keep keeps the circle`] };
    return got;
  }
  if (q.why) return refused(q.why);
  if (!tool) return refused("the layout skill is missing");
  const b = faceBefore && [faceBefore.scale, faceBefore.left, faceBefore.top, ...(box4(faceBefore.window) && !(faceBefore.window[0] === 0 && faceBefore.window[1] === 0 && faceBefore.window[2] === width && faceBefore.window[3] === height) ? faceBefore.window : [])];
  const folder = path.join(dir, "placement", name, "stack");
  const win = stackWindow(c, src);
  const placed = placeScreen({ tool, folder, src, crop: win.crop, text, cam, faces: webcamPeople(cam), width, height, area: area && fs.existsSync(area) ? area : null, platforms, timeout,
    extra: ["--screen-panel", "frame", ...(Number.isFinite(labelBottom) ? ["--label-bottom", String(Math.round(labelBottom))] : []), ...(b ? ["--before", b.map((v) => +(+v).toFixed(4)).join(",")] : [])] });
  if (placed.why) return refused(placed.why.replace(/ for it/, " for the stack"));
  let st;
  try { st = stackPicture(placed.res, { width, height }); } catch (e) { st = { why: `the layout skill's answer for it could not be read (${String(e?.message || e).split("\n")[0]})` }; }
  const record = (chosen) => { try { const f = path.join(folder, "placement.json"); const j = JSON.parse(fs.readFileSync(f, "utf8")); fs.writeFileSync(f, JSON.stringify({ ...j, chosen }, null, 1) + "\n"); } catch {} };
  if (st.why) { record({ picture: got.pic.fit, why: st.why }); return refused(st.why); }
  const pic = st.pic, main = got.pic;
  // what must be read: the keep's own region, where the window shows the screen around it
  const R = win.region;
  pic.region = [pic.left + R[0] * pic.scale, pic.top + R[1] * pic.scale, R[2] * pic.scale, R[3] * pic.scale].map(r1);
  // no text of the screen smaller than main's, no fault main's picture has not (unless the keep names the stack)
  const opts = { zones, labels: on, text, readable: got.facts.readable || 0, width, height };
  pic.j = judge(pic, opts);
  const mainJ = main.j || judge(main, opts);
  const added = pic.j.faults.filter((f) => f.code !== "text" && !mainJ.faults.some((g) => g.code === f.code));
  const named = asked === STACK;
  if (!named && pic.scale < main.scale - 1e-4) { const why = `its screen would be ${r2(pic.scale)}×, under main's ${r2(main.scale)}×, and its text smaller`; record({ picture: main.fit, why }); return refused(why); }
  if (!named && added.length) { const why = `its screen would have ${added.map((f) => f.said).join("; ")}`; record({ picture: main.fit, why }); return refused(why); }
  record({ picture: STACK, scale: pic.scale, screen: pic.window, ...(win.grown ? { window: win.window, region: R } : {}), ...(labelRoom ? { labelRoom: Math.round(labelBottom) } : {}), panel: pic.stack.panel, camera: pic.stack.camera, face: pic.stack.face, ground: pic.stack.ground, instead: main.fit });
  const sb = pic.window, pb = pic.stack.panel;
  const lines = [`${pic.mark} ${STACK} (the layout skill's stack${named ? ", as the keep names it" : ""}${pic.soft ? `; ${pic.soft}` : ""}): the screen ${r0(sb[2])}×${r0(sb[3])} at ${r2(pic.scale)}× (y ${r0(sb[1])}–${r0(sb[1] + sb[3])}), the speaker in a panel ${r0(pb[2])}×${r0(pb[3])} ${pb[2] >= width - 1 ? "across the frame" : "as wide as the screen"} below it (y ${r0(pb[1])}–${r0(pb[1] + pb[3])}), the face ${r0(pic.stack.face.height)} px (${pct(pic.stack.face.height / height)} of the frame's height), ${pct(pic.stack.ground)} ground${added.length ? `; ${added.map((f) => f.said).join("; ")}` : ""}${win.grown ? `; the screen's part shows the screen around the region (its ${R[2]}×${R[3]} px grown to ${win.window[2]}×${win.window[3]}, 16:9 at most)` : ""}${labelRoom ? `; under the room of the cut's label (from y ${Math.round(labelBottom)}), as every stacked keep of this cut, so that the screen and the speaker stand still at the cuts` : ""}; with the circle ("layout": "${CIRCLE}") ${main.fit} at ${r2(main.scale)}×, ${pct(got.facts.ground)} ground`];
  lines.push(`text: ${textSentence(pic, { text, readable: got.facts.readable || 0, size: src, width })}`);
  if (pic.stack.change) lines.push(`at the cut from the face view before: ${pic.stack.change}`);
  const f = facts(pic, pic.j, { readable: got.facts.readable, named });
  return { pic, lines, facts: { ...f, ground: r2(pic.stack.ground), stack: { screen: sb.map(r0), ...(win.grown ? { window: win.window } : {}), ...(labelRoom ? { labelRoom: Math.round(labelBottom) } : {}), panel: pb.map(r0), face: r0(pic.stack.face.height), facePct: r1(100 * pic.stack.face.height / height), camera: pic.stack.camera, ...(pic.stack.crop ? { crop: pic.stack.crop } : {}) }, instead: { fit: main.fit, scale: r2(main.scale), ground: got.facts.ground } } };
}

function chosen({ before, res, c, src, text, pip, on, keep, width, height, band, zones, areas, facts }) {
  const readable = Number.isFinite(res.screen?.readable) && res.screen.readable > 0 ? res.screen.readable : 0;
  const opts = { zones, labels: on, text, readable, width, height };
  const env = { zones, areas, labels: on, width, height, band };
  const main = pip ? areas.pip : null;
  before.j = judge(before, opts);
  const asJudged = (pic) => Object.assign(pic, { j: judge(pic, opts) });
  // layout's pictures, each with the circle at main's place and size (moved where that lies on its region)
  const list = (Array.isArray(res.candidates) ? res.candidates : []).filter(drawable).map((x) => asJudged(seat(pictureOf(x), main, env)));
  if (!list.length) return null;
  const asked = typeof keep.layout === "string" ? keep.layout.trim() : null;
  // the picture as before with the circle moved off the region, and the same moved inside the
  // margins at its scale (decided 2026-11-19: screen-circle-169, circle-still)
  const own = [];
  const moved = seat(before, main, env);
  if (moved.corner) own.push(asJudged({ ...moved, fit: `${BEFORE}, the circle ${moved.corner}`, circleOnly: true, mark: "✓" }));
  const shifted = before.j.faults.some((f) => f.code === "across") ? shiftedInside(before, src, zones, areas, width) : null;
  if (shifted) { const s = seat(shifted, main, env); own.push(asJudged({ ...s, fit: `${s.fit}${s.corner ? `, the circle ${s.corner}` : ""}`, mark: "✓" })); }
  for (const x of own) if (x.j.faults.length) x.mark = "!";
  // one caption line (areas.main: the areas with the band for two lines): main's picture for this
  // keep as main's own rule draws it (as before, its circle moved off the region, or shifted inside
  // the margins); where that has the circle off the region, no picture here may have it on the
  // region; where none has it off, the keep keeps main's picture (its scale, its band)
  let atMain = null;
  if (areas.main && main) {
    const envM = { ...env, areas: areas.main, band: null };
    const b0 = asJudged(beforePicture(c, src, areas.main, pip));
    const m0 = [b0, asJudged(seat(b0, main, envM))];
    const sh0 = b0.j.faults.some((f) => f.code === "across") ? shiftedInside(b0, src, zones, areas.main, width) : null;
    if (sh0) m0.push(asJudged(seat(sh0, main, envM)));
    atMain = m0.filter((x) => !x.j.faults.some((f) => f.code === "circle")).sort((a, b) => a.j.faults.length - b.j.faults.length)[0] || null;
  }
  const got = choose(before, list, { asked, zoomed: c.join() !== "0,0,1,1", own, keepOff: !!atMain });
  if (atMain && !got.named && got.pic.j.faults.some((f) => f.code === "circle")) {
    got.pic = asJudged({ ...atMain, fit: `${BEFORE} at main's scale`, circleOnly: false, atMain: true, mark: atMain.j.faults.length ? "!" : "✓" });
    own.push(got.pic);
  }
  const pic = got.pic, j = pic.j;
  const narrower = (Array.isArray(res.notes) ? res.notes : []).find((x) => /A narrower region reads/.test(x))?.match(/at most \d+×\d+ px of the source/)?.[0]?.replace(" of the source", " of the screen") || null;
  const lines = [];
  const where = `the region ${span(pic.region)}, ${pct(j.ground)} ground`;
  // the list names the circle only where it moved
  const circleSaid = pic.corner ? `, the circle moved to the ${pic.corner} (x ${r0(pic.circle[0])}, y ${r0(pic.circle[1])}): where it stands as before (x ${r0(main[0])}, y ${r0(main[1])}) it would lie on the region${on.some((l) => meets(l, [main[0], main[1], main[2], main[2]])) ? " or the label" : ""}` : "";
  const faultsSaid = (x) => x.j.faults.map((f) => f.said).join("; ");
  if (pic.atMain) {
    lines.push(`as with two caption lines at ${r2(pic.scale)}×${pic.corner ? `, the circle moved to the ${pic.corner} (x ${r0(pic.circle[0])}, y ${r0(pic.circle[1])})` : ""}: in the room of one line the circle would lie on the region and no corner is free of it; ${where}${j.faults.length ? `; ${faultsSaid(pic)}` : ""}`);
  } else if (own.includes(pic)) {
    lines.push(`${pic.circleOnly ? "as before" : `as before, moved ${Math.abs(pic.shift)} px ${pic.shift < 0 ? "left" : "right"} to hold the region inside the safe box's margins,`} at ${r2(pic.scale)}×${circleSaid}; ${where}${j.faults.length ? `; ${faultsSaid(pic)}` : ""}; as before ${faultsSaid(before)}`);
  } else if (pic === before) {
    lines.push(`${got.named ? "as before, as the keep names it" : "as before"} at ${r2(pic.scale)}×, ${where}${j.faults.length ? `: ${faultsSaid(pic)}${got.why ? ` (it stays: ${got.why})` : ""}` : ""}`);
    // the circle stays on the region where nothing fixes it yet: said, with what the agent can do
    if (j.faults.some((f) => f.code === "circle") && !got.named) lines.push(`! the circle lies on the region for these words: name a wider "zoom", or leave the circle out for them ("circle": false)`);
  } else {
    lines.push(`${pic.mark} ${pic.fit} at ${r2(pic.scale)}× (the layout skill's${got.named ? ", as the keep names it" : ""}${pic.soft ? `; ${pic.soft}` : ""})${circleSaid}, ${where}${pic.j.faults.length ? `; ${faultsSaid(pic)}` : ""}${got.named ? "" : `; as before (${r2(before.scale)}×) ${faultsSaid(before)}`}`);
  }
  if (got.missing) lines.push(`! "layout": "${got.missing}" is not among this screen's pictures in this frame (${width}×${height}), so it takes the rule's; its names here: ${[BEFORE, ...new Set(list.map((x) => x.fit)), ...(pip && height >= 1.2 * width ? [STACK, CIRCLE] : [])].map((x) => `"${x}"`).join(", ")}`);
  lines.push(`text: ${textSentence(pic, { text, readable, narrower, size: src, width })}`);
  const others = [before, ...own, ...list].filter((x) => x !== pic).slice(0, 3).map((x) => `${x === before ? "" : `${x.mark} `}${x.fit} at ${r2(x.scale)}× (${x.soft ? `${x.soft}, ` : ""}${x.j.faults.length ? x.j.faults.map((f) => shortFault(x, f)).join(", ") : `${pct(x.j.ground)} ground`})`);
  if (others.length) lines.push(`also: ${others.join("; ")}`);
  return { pic, facts: facts(pic, j, { readable, named: got.named }), lines };
}
