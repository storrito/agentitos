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
//   3. else layout's first candidate the composition draws (screen-zoom, screen-fit; screen-whole
//      only for the whole screen) without a hard fault and off the label, and the list says what was
//      wrong with the picture as before. The picture as before stays where its only fault is text
//      too small and layout's shows it no larger (a smaller one would read no better), and where
//      layout's pictures all have the label on the region while the one as before has nothing on
//      it (only its margins or its text at fault): layout does not know the label.
// Whatever goes wrong (no layout skill, place stops, runs over its time, refuses the box, gives no
// candidate to draw) the keep is drawn as before, with one sentence: the build never stops for it.
// screen-stacked (the screen above, the speaker in a panel below) is not drawn: with the captions
// at the safe box's bottom it has no place for them (layout marks it –).
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
import { layoutTool, PLACE_TIMEOUT } from "./placement.mjs";
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
  const at = spread(rooms, a.bleed || largest(a.content), c, src, { maxScale: 2 });
  const scale = at.width / src.width;
  return { fit: BEFORE, scale: +scale.toFixed(4), left: at.left, top: at.top, window: at.box.map(r1),
    region: [at.left + c[0] * at.width, at.top + c[1] * at.height, (c[2] - c[0]) * at.width, (c[3] - c[1]) * at.height].map(r1),
    circle: pip ? [a.pip[0], a.pip[1], a.pip[2]] : null };
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
  if (pic.circle && meets([pic.circle[0], pic.circle[1], pic.circle[2], pic.circle[2]], R)) faults.push({ code: "circle", said: "the webcam's circle lies on its region" });
  if (labels.some((l) => meets(l, R))) faults.push({ code: "label", said: "the label lies on its region" });
  const names = Object.fromEntries((zones.platforms || []).map((p) => [p.id, p.name]));
  const under = [...new Set((zones.covers || []).filter((c) => meets(c.box, R)).map((c) => names[c.platform] || c.platform))];
  if (under.length) faults.push({ code: "bars", said: `its region lies under the bars of ${under.join(", ")}` });
  const textHeight = text ? r1(text * pic.scale) : null;
  if (text && readable && textHeight < readable - 0.05) faults.push({ code: "text", said: `its text (${text} px on the screen) is ${textHeight} px tall, under the ${readable} px that read` });
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
export function placeScreen({ tool, folder, src, crop, text = 0, cam = null, width, height, area = null, platforms = [], timeout = PLACE_TIMEOUT }) {
  try {
    fs.mkdirSync(folder, { recursive: true });
    const R = regionPx(crop, src);
    const f = cam ? (cam.face || [0.35, 0.2, 0.65, 0.65]) : null;
    const face = f && [f[0] * cam.width, f[1] * cam.height, (f[2] - f[0]) * cam.width, (f[3] - f[1]) * cam.height].map((v) => r0(v));
    const args = [tool, "place", folder, "--frame", `${width}x${height}`, "--source", `${src.width}x${src.height}`, ...(text ? ["--min-text-height", String(text)] : []), "--region", R.join(","),
      ...(cam ? ["--source", `${cam.width}x${cam.height}`, "--face", face.join(",")] : []),
      ...(area ? ["--caption-area", area] : []), ...(platforms.length ? ["--platform", platforms.join(",")] : []), "--json"];
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
// a candidate of layout's as a picture the composition draws
export function pictureOf(c) {
  return { fit: c.fit, scale: c.scale, left: c.left, top: c.top, window: c.window, region: c.faceInFrame[0],
    circle: c.circle ? [c.circle.box[0], c.circle.box[1], c.circle.d] : null, mark: markOf(c), hard: c.hard || 0 };
}

// which picture: see the head of this file. before and every item of list carry their judgement (j)
export function choose(before, list, { asked = null, text = 0, zoomed = false } = {}) {
  if (asked === BEFORE) return { pic: before, named: true };
  const named = asked ? list.find((x) => x.fit === asked) : null;
  if (named) return { pic: named, named: true };
  const missing = asked ? asked : null;
  if (!before.j.faults.length) return { pic: before, missing };
  // a zoom box is not answered by the whole screen (screen-whole: the region small in a sea of
  // the rest), unless the keep names it
  const usable = list.filter((x) => !x.hard && !(zoomed && x.fit === "screen-whole"));
  const labelled = (x) => x.j.faults.some((f) => f.code === "label");
  if (!usable.length) return { pic: before, missing, why: "none of layout's pictures for it passes layout's checks" };
  // layout does not know the label: a picture it lies on stands only where the one as before has
  // something on its region too (the circle, the label, an app's bar), not for a region that only
  // reaches into the safe box's margins or a text too small
  const first = usable.find((x) => !labelled(x)) || (before.j.faults.some((f) => ["circle", "label", "bars"].includes(f.code)) ? usable[0] : null);
  if (!first) return { pic: before, missing, why: "layout's picture would have the label on the region" };
  const only = before.j.faults.every((f) => f.code === "text");
  if (only && text && first.scale <= before.scale + 1e-4) return { pic: before, missing, why: "layout's pictures show the text no larger" };
  return { pic: first, missing, left: before.j.faults };
}

// What a line of the screen becomes in the frame: the keep's text where it says how tall (and
// whether it reads), else a line of LINE px, and from what height a capital reads here
export function textSentence(pic, { text = 0, readable = 0, narrower = null, size = null }) {
  const at = `the screen${size ? ` (${size.width}×${size.height})` : ""} at ${r2(pic.scale)}×`;
  if (text) {
    const h = r1(text * pic.scale);
    if (!readable) return `${at}: its text (${text} px on the screen, "text") is ${h} px tall here`;
    if (h >= readable - 0.05) return `${at}: its text (${text} px on the screen, "text") is ${h} px tall here, it reads (from ${readable} px)`;
    return `${at}: its text (${text} px on the screen, "text") is ${h} px tall here, under the ${readable} px that read: give a narrower "zoom" on what is talked about${narrower ? ` (${narrower} reads)` : ""}, or split the keep where the words move on`;
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
  const said = [`Screen (${tool ? `the layout skill, ${area ? "around the captions as built" : "no captions"}` : "as before: agentitos' layout skill is not beside this one, or LAYOUT_TOOL naming its tools/place.mjs"}): the picture as before where it passes (its region inside the safe box across, the circle and the label off it, its text read where the keep's "text" says how tall), else the layout skill's first, unless a keep names another with "layout":`];
  const done = new Map();
  const keepSpan = (k) => { const own = pieces.filter((p) => p.keep === k); return `${clock(own[0].start)}–${clock(own.at(-1).start + own.at(-1).duration)}`; };
  for (const p of ps) {
    const keep = cut.keep?.[p.keep] || {};
    const text = Number(keep.text) > 0 ? Number(keep.text) : 0;
    const pip = !!cam && p.pip !== false;
    const on = areas.label ? labels.filter((l) => p.start < l.start + l.duration - 0.001 && p.start + p.duration > l.start + 0.001).map((l) => labelBox(l.text, areas, width, height)) : [];
    const parts = p.segments?.length ? p.segments : [p];
    for (const [i, part] of parts.entries()) {
      const c = part.crop || [0, 0, 1, 1], src = sources[p.source];
      const key = JSON.stringify([p.keep, p.source, c, pip, on]);
      let got = done.get(key);
      if (!got) {
        got = placeOne({ dir, k: p.keep, n: done.size + 1, c, src, text, pip, cam, on, keep, tool, timeout, width, height, platforms, area, zones, areas });
        done.set(key, got);
        said.push(...got.lines.map((l, j) => (j ? `    ${l}` : `  keep ${p.keep + 1} (${keepSpan(p.keep)}${c.join() === "0,0,1,1" ? ", the whole screen" : `, zoom [${c.join(", ")}]`}): ${l}`)));
      }
      if (got.pic.fit !== BEFORE) part.screenPic = got.pic;
      if (i === 0) p.screen = got.facts;
    }
  }
  if (tool) said.push(`  (every candidate with its reasons: ${path.relative(process.cwd(), path.join(dir, "placement"))}/screen-<n>/placement.json)`);
  return said;
}

function placeOne({ dir, k, n, c, src, text, pip, cam, on, keep, tool, timeout, width, height, platforms, area, zones, areas }) {
  const before = beforePicture(c, src, areas, pip);
  const facts = (pic, j, extra = {}) => ({ fit: pic.fit, scale: r2(pic.scale), ground: j.ground, region: pic.region.map(r0), ...(text ? { text, textHeight: j.textHeight } : {}),
    ...(extra.readable ? { readable: extra.readable } : {}), under: j.under, faults: j.faults.map((f) => f.code), ...(pic.mark ? { mark: pic.mark } : {}), ...(extra.named ? { named: true } : {}) });
  const asBefore = (why) => {
    const j = judge(before, { zones, labels: on, width, height });
    return { pic: before, facts: facts(before, j), lines: [`as before, because ${why}; ${textSentence(before, { text, size: src })}`] };
  };
  if (!tool) return asBefore("the layout skill is missing");
  const placed = placeScreen({ tool, folder: path.join(dir, "placement", `screen-${n}`), src, crop: c, text, cam: pip ? cam : null, width, height, area: area && fs.existsSync(area) ? area : null, platforms, timeout });
  if (placed.why) return asBefore(placed.why);
  const res = placed.res, readable = res.screen?.readable || 0;
  const opts = { zones, labels: on, text, readable, width, height };
  before.j = judge(before, opts);
  const list = (res.candidates || []).filter((x) => DRAWN.test(x.fit) && Number.isFinite(x.scale) && x.window && x.faceInFrame?.[0]).map((x) => { const pic = pictureOf(x); pic.j = judge(pic, opts); return pic; });
  if (!list.length) { const r = asBefore("layout's place gave no picture to draw for it"); return r; }
  const asked = typeof keep.layout === "string" ? keep.layout.trim() : null;
  const got = choose(before, list, { asked, text, zoomed: c.join() !== "0,0,1,1" });
  const pic = got.pic, j = pic.j;
  const narrower = res.notes?.find((x) => /A narrower region reads/.test(x))?.match(/at most \d+×\d+ px of the source/)?.[0]?.replace(" of the source", " of the screen") || null;
  const lines = [];
  const where = `the region ${span(pic.region)}, ${pct(j.ground)} ground${pic.circle ? `, the circle ${pic.circle[2]} px at x ${r0(pic.circle[0])}, y ${r0(pic.circle[1])}` : ""}`;
  const faultsSaid = (x) => x.j.faults.map((f) => f.said).join("; ");
  if (pic === before) {
    lines.push(`${got.named ? "as before, as the keep names it" : "as before"} at ${r2(pic.scale)}×, ${where}${j.faults.length ? `: ${faultsSaid(pic)}${got.why ? ` (it stays: ${got.why})` : ""}` : ""}`);
  } else {
    lines.push(`${pic.mark} ${pic.fit} at ${r2(pic.scale)}× (the layout skill's${got.named ? ", as the keep names it" : ""}), ${where}${pic.j.faults.length ? `; ${faultsSaid(pic)}` : ""}${got.named ? "" : `; as before (${r2(before.scale)}×) ${faultsSaid(before)}`}`);
  }
  if (got.missing) lines.push(`! "layout": "${got.missing}" is not among this screen's pictures in this frame (${width}×${height}), so it takes the rule's; its names here: ${[BEFORE, ...new Set(list.map((x) => x.fit))].map((x) => `"${x}"`).join(", ")}`);
  lines.push(`text: ${textSentence(pic, { text, readable, narrower, size: src })}`);
  const others = [before, ...list].filter((x) => x !== pic).slice(0, 3).map((x) => `${x === before ? "" : `${x.mark} `}${x.fit} at ${r2(x.scale)}× (${x.j.faults.length ? x.j.faults.map((f) => f.code === "text" ? `text ${x.j.textHeight} px` : f.code === "across" ? `region ${span(x.region)}` : f.code === "bars" ? "under the apps' bars" : `${f.code} on the region`).join(", ") : `${pct(x.j.ground)} ground`})`);
  if (others.length) lines.push(`also: ${others.join("; ")}`);
  return { pic, facts: facts(pic, j, { readable, named: got.named }), lines };
}
