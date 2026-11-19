#!/usr/bin/env node
// How a recording is placed in a frame, and where text can go: computed from where the faces (or
// the part of a screen that matters) are and from what the apps cover, judged, ranked, with the
// reasons. It builds no video and chooses nothing: an agent gets candidates and a still of each
// to look at, and chooses. The zones always come from agentitos' platform-zones.
//
//   node place.mjs grid <video|image> <out.jpg> [--at <s>]
//        one frame with a line every 10 %, labelled in px of the source: no tool here sees a
//        face, an agent reads the boxes off this picture
//   node place.mjs place <folder> --frame 9:16 --source 1080x1920 --face 300,570,600,900
//                  [--text caption] [--text hook] [--platform reels,tiktok] [--json]
//        (--text caption: one caption line, as most published Shorts set theirs; caption:2 for two.
//         --text hook: in an upright frame a short text in the middle, where the captions stand
//         afterwards, as published Shorts set it, else a card across the top; hook:text and
//         hook:card name one of the two)
//        the candidates, ranked, into <folder>/placement.json
//        (--caption-area <area.json>: captions built already, the picture placed around them;
//         --pick speaker [--cover scale,left,top]: in the order for a picture of one speaker, the
//         picture the caller draws today first where it passes, lib/solve.mjs pickSpeaker)
//   node place.mjs beside <folder> --frame 9:16 --source 1280x720 --face 555,150,180,195
//                  --material-min 600x340 [--material-ratio 16:9 | --material 1920x1080]
//                  [--text caption] [--before scale,left,top] [--platform …] [--json]
//        material (a card, a quote, a screenshot, a clip) beside a speaker who stays in the
//        picture: a field for the material, a field and a crop for the speaker, the captions,
//        and the numbers of the change from the speaker full-frame (lib/beside.mjs)
//        several people:    --face … --face … [--speaker 2]  |  --source A --face … --source B --face …
//        a face that moves: --face-at 0:300,570,600,900 --face-at 2.5:300,640,600,900 …  |  --face-track file.json
//                           (every --face-at of one source is the same face; two that move: one list each in the file)
//        a screen:          --source 1920x1080 --region 700,300,480,300 --min-text-height 14 [--readable 24]
//                           [--face … | --source 1280x720 --face …]   (the webcam: baked into the screen,
//                           or a file of its own; a circle in a free corner, a panel below the screen)
//        the ranking:       [--weights file.json] [--set weights.enlarge.costAtForbidden=5] [--set hookCard.minFont=76]
//                           [--all]   (every fit, also where the unchanged picture passes)
//   node place.mjs page <folder> [--candidate 1,2,3 | all] [--still <video|image>]… [--at <s>]…
//        (a face that moves: a picture at every moment its boxes were read at, or at each --at)
//        each candidate as a page of one frame (candidate-N.html) with a picture of it
//        (candidate-N.png), and what platform-zones' layout check says of the page
//   node place.mjs captions <folder> [--candidate 1] [--json]
//        the options that make agentitos' captions set its captions into the candidate's
//        caption area
//   node place.mjs text <folder> --frame 9:16 --shots <shots.json> [--text caption] [--text hook]
//                  [--platform …] [--caption-y <px>] [--font-size <px>] [--lift <shot>:<px>]… [--raise head|mouth|full] [--json]
//        the picture is placed already (a clip's framing): where the text goes over all its shots,
//        given every face over time; one place for the captions of the whole clip, how far each
//        shot's picture is to be raised to clear it, the hook's place over its first seconds,
//        and what still lies on a face, into <folder>/text.json (lib/placed.mjs)
//   node place.mjs text <folder> --frame 9:16 --shots <shots.json> --text area [--area-top <px>] [--area-bottom <px>]
//                  [--top <px>] [--lift <shot>:<px>]… [--raise head|mouth|full] [--platform …] [--json]
//        large type (kinetic type, phrase after phrase across the safe box's width) instead of
//        captions: one area for the clip from the safe box's bottom (or --area-bottom) up, never
//        higher than --area-top (where the caller sets its type without faces), its top below the
//        faces' mouths, the shots raised where that is not enough (lib/area.mjs)
//   node place.mjs text <folder> --frame 9:16 --shots <shots.json> --measure <boxes.json> [--json]
//        texts that stand where the caller put them ([{"name", "box": [x, y, w, h], "start"?, "end"?}]):
//        what each lies on, per moment, per face and over all (the parts as the captions' list
//        counts them), into <folder>/measure.json; nothing is placed or raised (lib/placed.mjs)
//
// Boxes are x,y,w,h in px of the source: a face from the hairline to the chin and from cheek to
// cheek. Every --face, --face-at, --face-track and --region belongs to the --source before it.
// What a candidate holds: lib/solve.mjs.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { Y1, boxText, pct } from "./lib/boxes.mjs";
import { readWeights } from "./lib/defaults.mjs";
import { compare } from "./lib/judge.mjs";
import { renderPage } from "./lib/page.mjs";
import { cutPng } from "./lib/png.mjs";
import { solve } from "./lib/solve.mjs";
import { textOverTime, stillsText, measureOver } from "./lib/placed.mjs";
import { areaOverTime, eyesText } from "./lib/area.mjs";
import { askZones, checkPage, chromePath, platformList } from "./lib/zones.mjs";
import { besideSolve, printBeside } from "./lib/beside.mjs";
import { areaFile, areaOfStyle } from "./lib/caption-area.mjs";
import { renderBeside } from "./lib/beside-page.mjs";

const fail = (msg) => { console.error(msg); process.exit(1); };
const rel = (p) => path.relative(process.cwd(), p) || ".";
const self = () => (rel(process.argv[1]).startsWith("..") ? process.argv[1] : rel(process.argv[1]));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// whether two paths are one file: a file the caller passed in is never removed or written over
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const sameFile = (a, b) => real(a) === real(b);

// ---- options ----

const FLAGS = new Set(["json", "all"]);
const MANY = new Set(["source", "face", "face-at", "face-track", "region", "text", "platform", "set", "still", "at", "lift"]);
const OPTIONS = {
  beside: ["frame", "source", "face", "face-at", "face-track", "material", "material-min", "material-ratio", "text", "caption-area", "caption-style", "before", "platform", "set", "json"],
  grid: ["at"],
  place: ["frame", "source", "face", "face-at", "face-track", "region", "min-text-height", "readable", "speaker", "text", "caption-area", "pick", "cover", "platform", "weights", "set", "all", "json"],
  page: ["candidate", "still", "at"],
  captions: ["candidate", "json"],
  text: ["frame", "shots", "text", "platform", "caption-y", "font-size", "lift", "raise", "area-top", "area-bottom", "top", "set", "measure", "json"],
};
function parseArgs(cmd, argv) {
  const o = { _: [], order: [] };
  for (const k of MANY) o[k] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { o._.push(a); continue; }
    const k = a.slice(2);
    if (!OPTIONS[cmd].includes(k)) fail(`${cmd} has no option --${k}: it takes ${OPTIONS[cmd].map((x) => `--${x}`).join(", ")}.`);
    if (FLAGS.has(k)) { o[k] = true; continue; }
    const v = argv[++i];
    if (v === undefined) fail(`--${k} needs a value.`);
    if (MANY.has(k)) { o[k].push(v); o.order.push([k, v]); } else o[k] = v;
  }
  return o;
}

// the sources in the order given: every --face belongs to the --source before it (faces before the
// first --source: to the first)
function parseSources(o, { clamp = false } = {}) {
  const sources = [], early = [];
  const box = (f, what) => { const b = String(f).split(",").map(Number); if (b.length !== 4 || b.some((v) => !Number.isFinite(v)) || b[2] <= 0 || b[3] <= 0) fail(`--${what} is x,y,w,h in px of the source, as 300,570,600,900.`); return b; };
  for (const [k, v] of o.order) {
    if (k === "source") { const m = String(v).match(/^(\d+)x(\d+)$/); if (!m || !+m[1] || !+m[2]) fail(`--source is width x height, as 1080x1920.`); sources.push({ size: [+m[1], +m[2]], faces: sources.length ? [] : early.splice(0) }); }
    else if (k === "face") (sources.at(-1)?.faces || early).push(box(v, "face"));
    else if (k === "region") { if (!sources.length) fail("--region comes after the --source it is a part of."); sources.at(-1).region = box(v, "region"); sources.at(-1).minTextHeight = Number(o["min-text-height"]) || 0; }
    else if (k === "face-at") {
      // the face's box at one moment: every --face-at of one source is the same, moving face
      const i = String(v).indexOf(":"), t = Number(String(v).slice(0, i));
      if (i < 1 || !Number.isFinite(t)) fail(`--face-at is seconds:x,y,w,h, as 2.5:310,560,600,900.`);
      const faces = sources.at(-1)?.faces || early;
      let track = faces.find((f) => f.cli);
      if (!track) faces.push((track = Object.assign([], { cli: true })));
      track.push({ t, box: box(String(v).slice(i + 1), "face-at") });
    } else if (k === "face-track") {
      // a file: one moving face [{ t, box }, …], or several [[…], […]] or { faces: [[…], […]] }
      let j;
      try { j = JSON.parse(fs.readFileSync(v, "utf8")); } catch (e) { fail(`--face-track ${v} cannot be read (${e.message}): it is a JSON list of { "t": seconds, "box": [x, y, w, h] }.`); }
      const tracks = Array.isArray(j) ? (Array.isArray(j[0]) ? j : [j]) : j && Array.isArray(j.faces) ? j.faces : null;
      const moment = (m) => m && typeof m === "object" && typeof m.t === "number" && Number.isFinite(m.t) && Array.isArray(m.box) && m.box.length === 4 && m.box.every((x) => typeof x === "number" && Number.isFinite(x)) && m.box[2] > 0 && m.box[3] > 0;
      if (!tracks || !tracks.length || tracks.some((t) => !Array.isArray(t) || !t.length || !t.every(moment))) fail(`--face-track ${v}: one moving face is a list of { "t": seconds, "box": [x, y, w, h] } with numbers in it; several faces are a list of such lists, or { "faces": [[…], …] }.`);
      (sources.at(-1)?.faces || early).push(...tracks);
    }
  }
  // A box past the source's edge places a face that is not there. beside (clamp) takes the part
  // of a face's box inside the picture and says so in a note (`clamped`), since its caller often
  // has a box from another tool; a box wholly outside stays an error.
  for (const q of sources) {
    const [sw, sh] = q.size;
    q.clamped = [];
    for (const b of [...q.faces.flatMap((f) => (typeof f[0] === "number" ? [f] : f.map((m) => m.box))), ...(q.region ? [q.region] : [])]) {
      if (!(b[0] < 0 || b[1] < 0 || b[0] + b[2] > sw || b[1] + b[3] > sh)) continue;
      if (!clamp || b === q.region) fail(`The box ${b.join(",")} reaches past the source of ${sw}×${sh}: a face or region the picture's edge cuts ends at that edge, read it again off the grid.`);
      const x0 = Math.max(0, b[0]), y0 = Math.max(0, b[1]), x1 = Math.min(sw, b[0] + b[2]), y1 = Math.min(sh, b[1] + b[3]);
      if (x1 - x0 < 1 || y1 - y0 < 1) fail(`The face's box ${b.join(",")} lies outside the source of ${sw}×${sh}: read it again off ${self()} grid.`);
      const was = b.join(","), given = b[3];
      b.splice(0, 4, x0, y0, x1 - x0, y1 - y0);
      // (the face is as large as given: only what can be shown is cut)
      b.givenHeight = given;
      q.clamped.push(`the face's box ${was} reaches past the source of ${sw}×${sh}: taken as ${b.map((v) => +v.toFixed(1)).join(",")}, its part inside the picture, the face's size still the ${given} px given`);
    }
  }
  return sources;
}
function parseNeeds(list) {
  return list.map((t) => {
    const [role, n] = String(t).split(":");
    if (role === "caption" || role === "captions") return { role: "caption", lines: Math.max(1, Number(n) || 1) };
    if (role === "hook" && (n === undefined || n === "text" || n === "card")) return { role: "hook", ...(n ? { kind: n } : {}) };
    if (role === "area" && n === undefined) return { role: "area" };
    fail(`--text is caption (one line of captions), caption:2 (two), hook (a short text in the middle, else a card at the top), hook:text or hook:card, or (text over a clip) area (large type in one area from the safe box's bottom up), not "${t}".`);
  });
}
const num = (v) => (v === "true" ? true : v === "false" ? false : Number.isFinite(Number(v)) ? Number(v) : v);

// ---- what is printed ----

const nameOf = (c) => `${c.fit}${c.crop ? ` ${c.crop}` : ""}${c.closer ? " closer" : ""}${c.onGround ? ", text on the ground" : ""}${c.side ? ` ${c.side}` : ""}${typeof c.speaker === "number" ? ` on face ${c.speaker}` : ""}`;
const markOf = (c) => (c.hard ? "✗" : c.unmet.length ? "–" : c.soft ? "!" : "✓");

function printResult(res) {
  const [W, H] = res.size;
  console.log(`${res.frame} ${W}×${H} for ${res.platforms.join(", ")}${res.fallback ? " (no platform named: the usual ones of this frame)" : ""}`);
  const srcLine = (q, i, n) => `source${n > 1 ? ` ${i + 1}` : ""} ${q.size.join("×")}, ${plural(q.faces.length, "face")}${q.faces.length ? ` (${q.faces.map((f) => boxText(f)).join("; ")})` : ""}`;
  console.log(`${res.screen ? `screen ${res.source.join("×")}, region ${boxText(res.screen.region)} (${res.screen.region[2]}×${res.screen.region[3]})${res.screen.minTextHeight ? `, smallest text ${res.screen.minTextHeight} px (reads from ${res.screen.readable} px in this frame)` : ""}` : (res.sources || [{ size: res.source, faces: res.faces }]).map((q, i, l) => srcLine(q, i, l.length)).join("; ")}; text: ${res.needs.length ? res.needs.map((n) => (n.role === "caption" ? plural(n.lines, "caption line") : n.kind ? `hook as ${n.kind}` : "hook")).join(" + ") : "none"}`);
  if (res.captionArea) { const a = res.captionArea; console.log(`captions: fixed in x ${a.left}–${a.left + a.width}, y ${a.top}–${a.bottom} (${a.from}, ${plural(a.lines, "line")} at ${a.size} px): there or nowhere, the picture placed around them`); }
  for (const n of res.notes) console.log(`note: ${n}`);
  if (res.pick) console.log(`ordered for a speaker: the picture you draw today first where it passes${res.pick.cover ? ` (--cover ${res.pick.cover.scale}, ${res.pick.cover.left}, ${res.pick.cover.top}: "cover")` : " (none given)"}, then the pictures across the frame's width, the face nearest ${pct(res.pick.usual)} of the height, then narrower ones; captions on the chin pass, on the mouth they do not${res.pick.note ? `\nnote: ${res.pick.note}` : ""}`);
  for (const tr of res.tracks || []) {
    console.log(`face ${tr.face}: usual box ${boxText(tr.usual)}, hull ${boxText(tr.hull)}; its edges come from: top ${tr.edges.top} s, bottom ${tr.edges.bottom} s, left ${tr.edges.left} s, right ${tr.edges.right} s`);
    if (!tr.decides.length) console.log(`   no single moment decides: with any one of them left out the first candidate stays (${tr.placed})`);
    tr.decides.forEach((d, i) => console.log(`   ${i ? "also" : "decides"}: the box at ${d.t} s, which gives the hull its ${d.edges.join(" and ")} edge. Placed without it, ${d.says}.`));
  }
  res.candidates.forEach((c, i) => {
    if (c.parts) {
      console.log(`\n${i + 1}. ${markOf(c)} ${c.fit}  score ${c.score}`);
      c.parts.forEach((q, k) => console.log(`   part ${k + 1}  ${boxText(q.window)}: source ${q.source} at scale ${q.scale}, left ${q.left}, top ${q.top}${q.smaller ? " (does not fill its part: ground beside it)" : ""}`));
      if (c.ground) console.log(`   ${pct(c.ground)} ground`);
    } else {
      console.log(`\n${i + 1}. ${markOf(c)} ${nameOf(c)}  scale ${c.scale} (${c.zoom}× of covering) at left ${c.left}, top ${c.top}  score ${c.score}`);
      if (c.ground) console.log(`   picture ${boxText(c.window)}, ${pct(c.ground)} ground`);
    }
    c.faceInFrame.forEach((f, k) => console.log(`   ${res.screen ? (k ? "webcam " : "region ") : "face   "} ${boxText(f)} (${Math.round(f[2])}×${Math.round(f[3])})${res.screen && !k && c.textHeight != null ? `, smallest text ${c.textHeight} px` : ""}`));
    if (c.circle) console.log(`   webcam  circle ${c.circle.d} px ${c.circle.corner}, ${boxText(c.circle.box)}${c.circle.crop ? `; shows ${boxText(c.circle.crop)} of the webcam's picture at ${c.circle.enlargement}×, the face ${c.circle.faceHeight} px tall` : ""}`);
    (c.others || []).forEach((f) => console.log(`   (${f.of}, not held: ${boxText(f.box)}, ${pct(f.shows)} of it shows)`));
    for (const t of c.text) console.log(`   ${t.role.padEnd(7)} ${t.where}, ${boxText(t.box)}${t.role === "hook" ? `, ${t.style === "text" ? "text" : t.style === "card" ? "a card" : "big lines"} at ${t.font} px${t.shrunk ? " (shrunk)" : ""}` : `, ${plural(t.lines, "line")} at ${t.font} px`}`);
    for (const q of c.problems) console.log(`   ${q.level === "hard" ? "✗" : q.level === "soft" ? "!" : "–"} ${q.of}: ${q.what}`);
    for (const n of c.notes || []) console.log(`   note: ${n}`);
    for (const b of c.groundShows?.behind || []) console.log(`   ground  behind the ${b.role}: ${b.shows} (the ground is ${c.groundShows.kind})`);
    if (c.alike) console.log(`   the same to the eye as ${c.alike.map((a) => `${nameOf(a)} at ${a.scale}× (${a.apart} px from it)`).join("; ")}: listed once`);
    console.log(`   why: ${c.why.join("; ")}${c.behind ? `; ${c.behind}` : ""}`);
    if (c.pick) console.log(`   for a speaker: ${c.pick.passes ? "passes" : "–"}, ${c.pick.why}${c.pick.layout ? ` (layout's ${c.pick.layout}.)` : ""}`);
  });
}

// ---- place ----

function cmdPlace(o) {
  const usage = `${self()} place <folder> --frame 9:16 --source 1080x1920 --face x,y,w,h [--face …] [--text caption] [--text hook] [--platform reels,tiktok] [--json]
  several people:    [--speaker N]  |  --source WxH --face … --source WxH --face …   (two files)
  a face that moves: --face-at seconds:x,y,w,h …   (one face per source; two that move: --face-track file.json, a list of moments each)
  a screen:          --source WxH --region x,y,w,h --min-text-height N [--readable N] [--face … | --source WxH --face …   (the webcam)]
  captions built:    --caption-area <area.json> | left,width,top,bottom,size,lines   (they stand there; the picture is placed around them)
  a speaker:         --pick speaker [--cover scale,left,top]   (the order for a picture of a speaker: the picture you draw today first where it passes, then across the frame's width)
  the ranking:       [--weights file.json] [--set weights.enlarge.softFrom=1.4]
The boxes are read off a frame: ${self()} grid <video|image> <out.jpg>.`;
  const [folder] = o._;
  const sources = parseSources(o);
  if (!folder || o._.length > 1 || !o.frame || !sources.length) fail(usage);
  if (fs.existsSync(folder) && !fs.statSync(folder).isDirectory()) fail(`${folder} is a file: place writes its placement.json into a folder, name one.`);
  if (!/^\d+(\.\d+)?:\d+(\.\d+)?$|^\d+x\d+$/.test(o.frame)) fail(`--frame is a ratio or a size, as 9:16 or 1080x1920.`);
  const platforms = platformList(o.platform);
  if (o.pick !== undefined && o.pick !== "speaker") fail(`--pick takes speaker (the order for a picture of one speaker), not "${o.pick}".`);
  if (o.cover !== undefined && o.pick === undefined) fail("--cover is the picture you draw today, judged in the order for a speaker: give --pick speaker with it.");
  let cover = null;
  if (o.cover !== undefined) {
    const v = String(o.cover).split(",").map(Number);
    if (v.length !== 3 || v.some((x) => !Number.isFinite(x)) || !(v[0] > 0)) fail(`--cover is scale,left,top of the picture covering the frame, in px of the frame, as 1.5,-120,0, not "${o.cover}".`);
    cover = { scale: v[0], left: v[1], top: v[2] };
  }
  let res;
  try {
    res = solve({
      ...(o.pick ? { pick: o.pick, cover } : {}),
      zones: askZones(o.frame, platforms), sources, needs: parseNeeds(o.text),
      ...(o["caption-area"] !== undefined ? { captionArea: areaFile(o["caption-area"]) } : {}),
      speaker: o.speaker !== undefined ? Number(o.speaker) : null,
      set: { ...(o.readable !== undefined ? { "readable.height": Number(o.readable) } : {}), ...Object.fromEntries(o.set.map((s) => { const i = s.indexOf("="); if (i < 1) fail(`--set is key=value, as weights.enlarge.softFrom=1.4.`); return [s.slice(0, i), num(s.slice(i + 1))]; })) },
      all: !!o.all, weights: o.weights ? readWeights(o.weights) : null,
    });
  } catch (e) { fail(e.message); }
  // what page and captions need to go on from the file alone
  res.asked = { frame: o.frame, platforms };
  const file = path.join(folder, "placement.json");
  try {
    fs.mkdirSync(folder, { recursive: true });
    // the pages and pictures of the placement that was here before belong to its candidates, not to these
    clearWritten(folder, readWritten(folder));
    fs.writeFileSync(file, JSON.stringify(res, null, 1));
  } catch (e) { fail(`${file} cannot be written (${e.code || e.message}): name a folder of yours.`); }
  if (o.json) return console.log(JSON.stringify(res, null, 1));
  printResult(res);
  const pass = res.candidates.filter((c) => !c.hard && !c.unmet.length).length;
  console.log(`\n${file}: ${plural(res.candidates.length, "candidate")}, ${pass} without a hard problem and with every need met (✓, or ! with a soft problem); – leaves a need unmet, ✗ fails.`);
  // why none passes, where the reason is one: the screen's text too small is not helped by less text
  if (!pass && res.screen && res.candidates.every((c) => c.hard || c.unmet.includes("readable"))) console.log(`None passes because the screen's text does not read at any size the frame leaves the region: take a narrower region${res.notes.find((n) => /A narrower region reads/.test(n)) ? ` (${res.notes.find((n) => /A narrower region reads/.test(n)).match(/at most \d+×\d+ px of the source/)[0]})` : ""}, not less text.`);
  console.log(`The order is a suggestion from measurements. Look before you choose: ${self()} page ${rel(folder)} --still <video|image> writes the first three as pictures and has platform-zones check them.`);
}

// ---- beside ----

// Material beside the speaker: a command of its own, not an option of place. Its input is no
// second recording with boxes but what the material needs (a field of a smallest size, a shape,
// or a picture's size), and its answer is no placement of a source but a field for each of the
// two and the change from the speaker full-frame. Its candidates carry the keys page and captions
// read, so both work on its folder as on place's.
function cmdBeside(o) {
  const usage = `${self()} beside <folder> --frame 9:16 --source WxH --face x,y,w,h (or --face-at s:x,y,w,h …) --material-min WxH [--material-ratio 16:9 | --material WxH] [--text caption] [--before scale,left,top] [--platform reels,tiktok] [--json]`;
  const [folder] = o._;
  // --face assumed: a caller without a face's box gets the usual framing of a talking head (the
  // face a fifth of the frame tall, in the middle across, its middle a third down, as the source
  // covers the frame), marked as assumed
  const assumed = o.order.some(([k, v]) => k === "face" && v === "assumed");
  if (assumed) {
    const src = o.order.find(([k]) => k === "source")?.[1], m = String(src || "").match(/^(\d+)x(\d+)$/);
    if (!m || !/^\d+(\.\d+)?:\d+(\.\d+)?$|^\d+x\d+$/.test(o.frame || "")) fail(usage);
    const [W, H] = askZones(o.frame, platformList(o.platform)).size, sw = +m[1], sh = +m[2], k = Math.max(W / sw, H / sh);
    const h = 0.2 * H, w = 0.75 * h, fx = (W / 2 - w / 2 - (W - k * sw) / 2) / k, fy = (H / 3 - h / 2 - (H - k * sh) / 2) / k;
    const box = [Math.max(0, fx), Math.max(0, fy), Math.min(w / k, sw), Math.min(h / k, sh)].map((v) => Math.round(v));
    o.order = o.order.map(([kk, v]) => (kk === "face" && v === "assumed" ? [kk, box.join(",")] : [kk, v]));
  }
  const sources = parseSources(o, { clamp: true });
  if (!folder || o._.length > 1 || !o.frame || !sources.length) fail(usage);
  if (sources.length > 1 || sources[0].faces.length !== 1) fail(`beside places one speaker from one recording: give one --source and one --face (or the moments of one face as --face-at), read off ${self()} grid.`);
  if (fs.existsSync(folder) && !fs.statSync(folder).isDirectory()) fail(`${folder} is a file: beside writes its placement.json into a folder, name one.`);
  if (!/^\d+(\.\d+)?:\d+(\.\d+)?$|^\d+x\d+$/.test(o.frame)) fail(`--frame is a ratio or a size, as 9:16 or 1080x1920.`);
  const size = (v, what) => { const m = String(v).match(/^(\d+)x(\d+)$/); if (!m || !+m[1] || !+m[2]) fail(`--${what} is width x height in px, as 600x340.`); return [+m[1], +m[2]]; };
  const material = { min: o["material-min"] !== undefined ? size(o["material-min"], "material-min") : null, fixed: o.material !== undefined ? size(o.material, "material") : null };
  if (o["material-ratio"] !== undefined) {
    const v = String(o["material-ratio"]), m = v.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/), r = m ? +m[1] / +m[2] : Number(v);
    if (!(r > 0) || !Number.isFinite(r)) fail(`--material-ratio is the shape the material prefers, as 16:9, 1:1 or 1.5.`);
    if (material.fixed) fail(`--material gives a picture's size, which is its shape: leave out --material-ratio.`);
    material.ratio = r;
  }
  if (!material.min && !material.fixed) fail(`beside needs what the material needs: --material-min WxH, the smallest field it reads in (px of the frame), or --material WxH, the size of a picture or clip of fixed size.`);
  const needs = parseNeeds(o.text);
  if (needs.some((n) => n.role === "hook")) fail(`beside sets captions only (--text caption or caption:2): a hook stands before the material shows, place it with ${self()} place.`);
  let before = null;
  if (o.before !== undefined) {
    const b = String(o.before).split(",").map(Number);
    if (![3, 7].includes(b.length) || b.some((v) => !Number.isFinite(v)) || !(b[0] > 0) || (b.length === 7 && !(b[5] > 0 && b[6] > 0))) fail(`--before is scale,left,top of the speaker just before, as place hands them over (1.875,-660,0), and its window as x,y,w,h after them where it did not fill the frame (1.875,-660,0,0,285,1080,1350).`);
    before = { scale: b[0], left: b[1], top: b[2], ...(b.length === 7 ? { window: b.slice(3) } : {}) };
  }
  const platforms = platformList(o.platform);
  // the captions' band as captions builds it: its area.json, or a style it measures
  if (o["caption-area"] !== undefined && o["caption-style"] !== undefined) fail(`--caption-area and --caption-style both give the captions' band: give one.`);
  let res, captionArea = null;
  try {
    const zones = askZones(o.frame, platforms);
    if (o["caption-area"] !== undefined) captionArea = areaFile(o["caption-area"]);
    else if (o["caption-style"] !== undefined) captionArea = areaOfStyle(o["caption-style"], needs.find((n) => n.role === "caption")?.lines, zones.size, platforms);
    res = besideSolve({
      zones, captionArea, faceAssumed: assumed, source: sources[0].size, face: sources[0].faces[0], faceSize: sources[0].faces[0].givenHeight ?? null, material, needs, before,
      set: Object.fromEntries(o.set.map((s) => { const i = s.indexOf("="); if (i < 1) fail(`--set is key=value, as beside.faceMin=0.1.`); return [s.slice(0, i), num(s.slice(i + 1))]; })),
    });
  } catch (e) { fail(e.message); }
  if (sources[0].clamped.length) res.notes.unshift(...sources[0].clamped);
  res.asked = { frame: o.frame, platforms };
  const file = path.join(folder, "placement.json");
  try {
    fs.mkdirSync(folder, { recursive: true });
    clearWritten(folder, readWritten(folder));
    fs.writeFileSync(file, JSON.stringify(res, null, 1));
  } catch (e) { fail(`${file} cannot be written (${e.code || e.message}): name a folder of yours.`); }
  if (o.json) return console.log(JSON.stringify(res, null, 1));
  printBeside(res, self(), rel(folder));
}

// ---- grid ----

// the picture's size as shown (a phone's rotation applied)
function probe(file) {
  if (!fs.existsSync(file)) fail(`There is no ${file}.`);
  const r = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", file], { encoding: "utf8" });
  if (r.error?.code === "ENOENT") fail("ffprobe is missing: install ffmpeg (it brings ffprobe), then run this again.");
  let v;
  try { v = JSON.parse(r.stdout).streams.find((s) => s.codec_type === "video"); } catch { v = null; }
  if (r.status !== 0 || !v) fail(`${file} is no video or image ffprobe can read.`);
  const turned = Math.abs(Number(v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0)) % 180 === 90;
  return turned ? [v.height, v.width] : [v.width, v.height];
}

// one frame of a video (or an image) as a JPEG, without any of the file's tags: a phone writes
// the place it filmed at into its files, and that never goes into a folder that is passed on
function frameOf(input, out, at, filters = []) {
  if (sameFile(input, out)) return "it would write over the file it reads";
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  // no picture of an earlier run passes for this one's
  fs.rmSync(out, { force: true });
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...(at !== undefined ? ["-ss", String(at)] : []), "-i", input, "-frames:v", "1", ...(filters.length ? ["-vf", filters.join(",")] : []), "-map_metadata", "-1", "-q:v", "3", "-update", "1", out], { encoding: "utf8" });
  if (r.error?.code === "ENOENT") fail("ffmpeg is missing: install ffmpeg, then run this again.");
  return r.status === 0 && fs.existsSync(out) ? null : (r.stderr || "").trim().split("\n").slice(-2).join(" ") || (at !== undefined ? `there is no picture at ${at} s` : "it wrote no picture");
}

function cmdGrid(o) {
  const [input, out] = o._;
  if (!input || !out || o._.length > 2) fail(`${self()} grid <video|image> <out.jpg> [--at <s>]`);
  if (o.at.length > 1) fail(`grid draws one moment: run it once for each --at, each into a picture of its own.`);
  o.at = o.at[0];
  if (sameFile(input, out)) fail(`${out} is the file to read: give the picture with the grid another name.`);
  const [w, h] = probe(input);
  const t = Math.max(2, Math.round(Math.min(w, h) / 360)), size = Math.max(16, Math.round(Math.min(w, h) / 36));
  // a line every tenth, each a dark line under a yellow one so that it shows on any picture; the
  // two middle lines red, to count from
  const lines = [], labels = [];
  for (let i = 1; i < 10; i++) {
    const x = Math.round(i * w / 10), y = Math.round(i * h / 10), colour = i === 5 ? "red@0.9" : "yellow@0.85";
    lines.push(`drawbox=x=${x - t}:y=0:w=${2 * t}:h=${h}:color=black@0.45:t=fill`, `drawbox=x=0:y=${y - t}:w=${w}:h=${2 * t}:color=black@0.45:t=fill`);
    lines.push(`drawbox=x=${x - Math.floor(t / 2)}:y=0:w=${t}:h=${h}:color=${colour}:t=fill`, `drawbox=x=0:y=${y - Math.floor(t / 2)}:w=${w}:h=${t}:color=${colour}:t=fill`);
    const text = (s, lx, ly) => `drawtext=text='${s}':x=${lx}:y=${ly}:fontsize=${size}:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=${Math.round(size / 5)}`;
    labels.push(text(x, x + t + 4, t + 4), text(y, t + 4, y + t + 4));
  }
  // an ffmpeg without text (no freetype) still draws the lines
  let labelled = true, err = frameOf(input, out, o.at, [...lines, ...labels]);
  if (err) { labelled = false; err = frameOf(input, out, o.at, lines); }
  if (err) fail(`ffmpeg could not draw the grid: ${err}`);
  console.log(`${out}: ${rel(input)}${o.at !== undefined ? ` at ${o.at} s` : ""}, ${w}×${h}, with a line every 10 %: every ${Math.round(w / 10)} px across and every ${Math.round(h / 10)} px down${labelled ? ", each labelled with its px in the source" : " (this ffmpeg draws no text: count the lines)"}; the red lines are the middle.`);
  console.log(`Look at it and read off, in px of the source (x,y of the top left corner, then width,height):`);
  console.log(`  a face: from the hairline to the chin, from cheek to cheek (not the hair, the ears or the neck)   → --face x,y,w,h`);
  console.log(`  a face that moves: the grid at several moments (--at), one box each   → --face-at <seconds>:x,y,w,h (all of them are one face)`);
  console.log(`  a screen: the part that matters → --region x,y,w,h, and how tall a capital letter of its smallest text is → --min-text-height <px>`);
  console.log(`  a webcam baked into the screen: its face → --face x,y,w,h after the screen's own --source (a webcam file of its own: a second --source with its face)`);
  console.log(`Then: ${self()} place <folder> --frame 9:16 --source ${w}x${h} --face … --text caption`);
}

// ---- page ----

function readPlacement(folder, cmd) {
  if (!folder) fail(`${self()} ${cmd} <folder>: the folder ${self()} place wrote into.`);
  const file = path.join(folder, "placement.json");
  if (!fs.existsSync(file)) fail(`There is no ${file}: run ${self()} place ${folder} … first.`);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { fail(`${file} cannot be read (${e.message}): run ${self()} place ${folder} … again.`); }
}

// What page wrote into a placement's folder (the pages, their pictures, the frames of the
// recording) is listed in placement.json, so that exactly these files are removed when the
// placement is made anew or other candidates are shown: never a file of another name, never one
// the caller passes in.
const OURS = /^(candidate-\d+(-at-\d+(\.\d+)?)?\.(html|png)|still(-\d+)?(-at-\d+(\.\d+)?)?\.jpg)$/;
function readWritten(folder) {
  try { const w = JSON.parse(fs.readFileSync(path.join(folder, "placement.json"), "utf8")).written; return Array.isArray(w) ? w.filter((n) => typeof n === "string" && OURS.test(n)) : []; } catch { return []; }
}
function clearWritten(folder, written, keep = []) {
  for (const name of written) {
    const file = path.join(folder, name);
    if (fs.existsSync(file) && !keep.some((k) => sameFile(k, file))) fs.rmSync(file, { force: true });
  }
}

// which candidates, from 1: "2", "1,3", "all"; none: the first `first`
function pick(res, value, first) {
  const n = res.candidates.length;
  if (!n) fail("The placement has no candidate.");
  if (value === undefined) return Array.from({ length: Math.min(first, n) }, (_, i) => i);
  if (value === "all") return res.candidates.map((_, i) => i);
  const list = String(value).split(",").map((s) => Number(s.trim()));
  for (const k of list) if (!Number.isInteger(k) || k < 1 || k > n) fail(`There is no candidate ${k}: the placement has ${n} (1–${n}).`);
  return list.map((k) => k - 1);
}

// A picture of a page as Chrome shows it, of the frame's size. The window is taller than the frame
// and the picture cut back to it: a Chrome that counts its own bars into the window shows less
// of the page than the window is high, and a picture of the frame's height would end in black.
const BARS = 240;
function picture(chrome, page, png, [W, H]) {
  fs.rmSync(png, { force: true });
  // Chrome puts a socket into TMPDIR, at most 107 bytes long: a deep TMPDIR gets the system's
  const env = (process.env.TMPDIR || "/tmp").length > 60 ? { ...process.env, TMPDIR: "/tmp" } : process.env;
  spawnSync(chrome, ["--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--allow-file-access-from-files", `--window-size=${W},${H + BARS}`, "--virtual-time-budget=5000", `--screenshot=${path.resolve(png)}`, pathToFileURL(path.resolve(page)).href], { encoding: "utf8", env, timeout: 90e3 });
  if (cutPng(png, H)) return true;
  fs.rmSync(png, { force: true });
  return false;
}

function cmdPage(o) {
  const [folder] = o._;
  const res = readPlacement(folder, "page");
  const picks = pick(res, o.candidate, 3);
  const chrome = chromePath();
  if (!chrome) fail("page needs Chrome, to measure the candidates' pages and to take their pictures: set CHROME=/path/to/chrome. Until then the candidates carry only the solver's own verdict.");
  if (!fs.existsSync(chrome)) fail(`CHROME names ${chrome}, and there is no such file: set it to a Chrome's path, or unset it to have one found.`);
  // (a webcam baked into the screen recording is no source of its own: the screen's still shows it)
  const sources = (res.sources || [{ size: res.source }]).filter((q) => !q.baked);
  const ats = o.at.map((v) => { const t = Number(v); if (!Number.isFinite(t) || t < 0) fail(`--at is a moment in seconds, as 2.5, not "${v}".`); return t; });
  const image = (f) => /\.(jpe?g|png|webp|bmp|gif)$/i.test(f);
  // The views: one frame of the recording per moment. A face that moves is looked at at each
  // moment its boxes were read at: with a video, page takes every moment given (--at), else every
  // moment of the placement's moving faces; with pictures of one source, one --at for each, in
  // their order. Each moment's files carry it in their names (candidate-1-at-2.5.png).
  let views;
  if (sources.length === 1 && o.still.length > 1 && o.still.every(image) && (res.tracks || []).length) {
    if (ats.length !== o.still.length) fail(`The placement has 1 source and ${o.still.length} pictures: if they are moments of a face that moves, give an --at for each, in the same order (--still a.jpg --at 2.5 --still b.jpg --at 4.5).`);
    views = o.still.map((f, k) => ({ at: ats[k], inputs: [f], seek: false }));
  } else {
    const order = res.kind === "beside" ? "the speaker's, then the material as a picture" : res.screen ? (sources.length > 1 ? "the screen's, then the webcam's" : "the screen's") : sources.length > 1 ? "the first --source's, then the second's" : "the recording's";
    if (o.still.length > sources.length) fail(`The placement has ${plural(sources.length, "source")}${res.sources?.some((q) => q.baked) ? " (the webcam baked into the screen shows in the screen's still)" : ""}: ${plural(o.still.length, "still")} ${o.still.length === 1 ? "is" : "are"} too many; give ${sources.length > 1 ? "one --still per source, in their order" : "one --still"}: ${order}${(res.tracks || []).length ? " (a face that moves: a video, or one picture per moment with an --at each)" : ""}.`);
    const moving = [...new Set((res.tracks || []).flatMap((t) => t.times || []))].sort((a, b) => a - b);
    const moments = ats.length ? ats : o.still.some((f) => !image(f)) && moving.length > 1 ? moving : [undefined];
    views = moments.map((t) => ({ at: t, inputs: o.still, seek: true }));
  }
  const multi = views.length > 1, tag = (v) => (multi ? `-at-${v.at}` : "");
  views.forEach((v) => { v.outs = v.inputs.map((_, i) => path.join(folder, `still${i ? `-${i + 1}` : ""}${tag(v)}.jpg`)); });
  const before = readWritten(folder), inputs = views.flatMap((v) => v.inputs);
  for (const v of views) v.inputs.forEach((input, i) => {
    // (material that is laid out into its field may come as a picture of any shape)
    const [w, h] = probe(input), [sw, sh] = sources[i].size || [w, h];
    if (Math.abs((w / h) / (sw / sh) - 1) > 0.02) fail(`${input} is ${w}×${h}; the placement was made for a source of ${sw}×${sh}, another shape: give the recording the boxes were read from.`);
    const over = views.flatMap((x) => x.outs).findIndex((out) => out !== v.outs[i] && sameFile(input, out));
    if (over >= 0) fail(`${input} is where page puts another frame: copy it out of ${folder} first, or give the stills in the order they lie there.`);
    // a file of that name that page did not write is the caller's: never written over
    if (fs.existsSync(v.outs[i]) && !sameFile(input, v.outs[i]) && !before.includes(path.basename(v.outs[i]))) fail(`${v.outs[i]} is a file of yours, where page puts the frame of ${input}: move it out of ${folder}, or pass it as --still.`);
  });
  // what an earlier call wrote here goes, except a frame that is passed in again now
  clearWritten(folder, before, inputs);
  const written = [], save = () => fs.writeFileSync(path.join(folder, "placement.json"), JSON.stringify({ ...res, written }, null, 1));
  for (const v of views) v.stills = v.inputs.map((input, i) => {
    // a frame that already lies where it belongs is used as it is, and stays the caller's unless an earlier call made it
    if (sameFile(input, v.outs[i])) { if (before.includes(path.basename(v.outs[i]))) written.push(path.basename(v.outs[i])); return v.outs[i]; }
    const err = frameOf(input, v.outs[i], v.seek && !image(input) ? v.at : undefined);
    if (err) { save(); fail(`ffmpeg could not take a frame of ${input}${v.at !== undefined ? ` at ${v.at} s` : ""}: ${err}`); }
    written.push(path.basename(v.outs[i]));
    return v.outs[i];
  });
  save();
  console.log(`${res.frame} ${res.size.join("×")} for ${res.platforms.join(", ")}${o.still.length ? `, on ${multi ? `the frames of ${views.length} moments (${views.map((v) => `${v.at} s`).join(", ")})` : `a frame of ${o.still.map(rel).join(" and ")}${views[0].at !== undefined ? ` at ${views[0].at} s` : ""}`}` : ", on a drawn surface with each face as an oval (--still <video|image> shows the recording)"}`);
  let differ = 0;
  for (const i of picks) for (const v of views) {
    const c = res.candidates[i], page = path.join(folder, `candidate-${i + 1}${tag(v)}.html`), png = path.join(folder, `candidate-${i + 1}${tag(v)}.png`);
    fs.writeFileSync(page, (res.kind === "beside" ? renderBeside : renderPage)(c, res, { stills: v.stills.length ? v.stills : null, page, at: v.at ?? null }));
    let checked;
    try { checked = checkPage(page, res.asked?.platforms || []); } catch (e) { written.push(path.basename(page)); save(); fail(e.message); }
    const shot = picture(chrome, page, png, res.size);
    written.push(path.basename(page), ...(shot ? [path.basename(png)] : []));
    const cmp = compare(c, checked);
    console.log(`\n${i + 1}. ${markOf(c)} ${nameOf(c)}${c.parts ? "" : ` ${c.scale}×`}${multi ? ` at ${v.at} s` : ""}: ${rel(page)}${shot ? `, ${rel(png)}` : " (Chrome took no picture of it: open the page)"}`);
    for (const t of c.text) console.log(`   ${t.role.padEnd(7)} ${t.where}, ${boxText(t.box)}`);
    console.log(`   solver:  ${c.problems.length ? c.problems.map((q) => `${q.level === "hard" ? "✗" : q.level === "soft" ? "!" : "–"} ${q.of} ${q.what}`).join("; ") : "✓ no problem"}`);
    // (beside's crops of a feed or grid are notes, not problems: the checker reports them as soft)
    if (c.crops?.length) console.log(`   note:    where the frame is shown cropped elsewhere, not a problem: ${c.crops.map((q) => `${q.of} ${q.what}`).join("; ")}`);
    console.log(`   checker: ${checked.findings.length ? checked.findings.map((f) => `${f.level} ${f.kind === "text" ? `"${f.label}"` : f.label} ${f.what}`).join("; ") : "✓ nothing under the apps' buttons, nothing on top of each other"}`);
    if (!cmp.verdictAgrees) { differ++; console.log(`   ✗ They differ: ${checked.ok ? "the checker passes what the solver fails" : "the checker fails what the solver passes"} (solver only: ${cmp.onlySolver.join(", ") || "nothing"}; checker only: ${cmp.onlyChecker.join(", ") || "nothing"}). The checker measured the page: do not take this candidate without looking at why.`); }
    else if (!cmp.agree) console.log(`   They agree on the verdict and differ in a finding (solver only: ${cmp.onlySolver.join(", ") || "nothing"}; checker only: ${cmp.onlyChecker.join(", ") || "nothing"}).`);
  }
  save();
  if (multi) console.log(`\nA face that moves: every candidate at each moment (${views.map((v) => `${v.at} s`).join(", ")}), its files named by the moment. The placement holds the boxes of every moment; look whether the text stays off the face and the picture holds at each.`);
  else if ((res.tracks || []).length && !o.still.some((f) => !image(f))) console.log(`\nA face that moves: look at it at every moment its boxes were read at (${[...new Set(res.tracks.flatMap((t) => t.times || []))].join(", ")} s): --still <video> alone takes them all, or one picture per moment with an --at each.`);
  console.log(`\nLook at ${picks.length > 1 ? "each picture" : "the picture"} before you choose. What no measurement here knows: whether the picture behind a text is calm (the solver sees boxes, no pixels), whether the box of a face was read right, and how wide the video's own words are: the pages show placeholder words (caption lines of three words, a hook of two short lines), and a block is taken as wide as its area.`);
  console.log(`Chosen: ${self()} captions ${rel(folder)} --candidate N gives the options for agentitos' captions; scale, left, top, window and the text's boxes of the candidate are in ${rel(path.join(folder, "placement.json"))} for the skill that builds the video.`);
  if (differ) process.exitCode = 1;
}

// ---- captions ----

function cmdCaptions(o) {
  const [folder] = o._;
  const res = readPlacement(folder, "captions");
  const [i] = pick(res, o.candidate, 1), c = res.candidates[i];
  const t = c.text.find((q) => q.role === "caption");
  const what = `Candidate ${i + 1} (${nameOf(c)}${c.parts ? "" : ` ${c.scale}×`})`;
  if (!t) fail(res.needs.some((n) => n.role === "caption") ? `${what} has no place for the captions asked for: take a candidate that has one (✓ or ! in ${self()} place), or fewer lines.` : `The placement asked for no captions: run ${self()} place ${folder} … again with --text caption.`);
  const centred = t.align === "center" && Math.abs(t.box[0] + t.box[2] / 2 - res.size[0] / 2) < 1;
  // rounded to the nearest px: the area is exactly as tall as the block, so a bottom rounded down
  // would lift its top out of the area; the lines run no wider
  const opts = { ...(centred ? {} : { x: Math.ceil(t.box[0]) }), y: Math.round(Y1(t.box)), "max-width": Math.floor(t.box[2] + 1e-6), ...(centred ? {} : { align: t.align === "center" ? "centre" : t.align }), "font-size": t.font, lines: t.lines };
  const args = Object.entries(opts).flatMap(([k, v]) => [`--${k}`, String(v)]);
  if (o.json) return console.log(JSON.stringify({ candidate: i + 1, fit: c.fit, where: t.where, box: t.box, options: opts, args, ...(c.notes ? { notes: c.notes } : {}) }, null, 1));
  console.log(`${what}: ${plural(t.lines, "caption line")} ${t.where}, ${boxText(t.box)}, ${t.font} px type, ${centred ? "centred on the frame" : `${t.align === "center" ? "centred" : `${t.align}-aligned`} in a column`}. --y is the area's bottom, where the lowest line ends (the area runs from y ${Math.round(t.box[1])} to ${opts.y}); --max-width its width${opts.x !== undefined ? ", --x its left edge" : ""}.`);
  console.log(`For agentitos' captions (build or project), with its --size ${res.size.join("x")}:`);
  console.log(`  ${args.join(" ")}`);
  if (c.hard) console.log(`! This candidate fails (${c.problems.filter((q) => q.level === "hard").map((q) => `${q.of} ${q.what}`).join("; ")}): its caption area is only as good as the candidate.`);
  for (const n of c.notes || []) console.log(`! ${n[0].toUpperCase()}${n.slice(1)}.`);
  if (t.lines > 2) console.log(`! captions sets at most two lines: place again with --text caption:2.`);
  console.log(`captions answers "Placed where asked: …" when it took them. A captions that answers nothing of the kind does not know these options and sets the lowest line on the safe box's bottom whatever is there: look at its frame then.`);
}

// ---- text: the picture placed already, faces over time ----

function cmdText(o) {
  const usage = `${self()} text <folder> --frame 9:16 --shots <shots.json> [--text caption] [--text hook] [--platform reels,tiktok] [--caption-y <px>] [--font-size <px>] [--lift <shot>:<px>] [--raise head|mouth|full] [--json]
  large type instead of captions: --text area [--area-top <px>] [--area-bottom <px>] [--top <px>] [--lift <shot>:<px>] [--raise …]
  texts placed already, measured where they stand: --measure <boxes.json> ([{"name", "box": [x, y, w, h], "start"?, "end"?}])
  shots.json: {"shots": [{"start": 0, "end": 4.2, "faces": [{"who": "A", "track": [{"t": 0, "box": [x, y, w, h]}, …]}], "room": {"free": 0}}, …], "hook": {"start": 0, "end": 3}}
  (boxes in px of the frame as the picture stands; room: how far a shot's picture may be raised, null where not at all;
  for --text area a moment's "zoom": how much larger the picture shows there than as it is raised, as a push-in after the raise)`;
  const [folder] = o._;
  if (!folder || o._.length > 1 || !o.frame || !o.shots) fail(usage);
  if (!/^\d+(\.\d+)?:\d+(\.\d+)?$|^\d+x\d+$/.test(o.frame)) fail(`--frame is a ratio or a size, as 9:16 or 1080x1920.`);
  let input;
  try { input = JSON.parse(fs.readFileSync(o.shots, "utf8")); } catch (e) { fail(`--shots ${o.shots} cannot be read (${e.message}): it is JSON, {"shots": [{"start", "end", "faces": [{"who", "track": [{"t", "box"}]}]}]}.`); }
  const shots = Array.isArray(input) ? input : input.shots;
  const goodBox = (b) => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[2] > 0 && b[3] > 0;
  if (!Array.isArray(shots) || !shots.length || shots.some((s) => !Number.isFinite(s.start) || !(s.end > s.start) || !Array.isArray(s.faces) || s.faces.some((f) => !Array.isArray(f.track) || f.track.some((m) => !Number.isFinite(m.t) || !goodBox(m.box) || (m.zoom !== undefined && !(m.zoom > 0))))))
    fail(`--shots ${o.shots}: every shot needs "start" < "end" in seconds and "faces", each a "track" of {"t": seconds, "box": [x, y, w, h]} in px of the frame (no face: an empty list).`);
  if (o.measure !== undefined) return textMeasure(o, folder, shots);
  const asked = parseNeeds(o.text.length ? o.text : ["caption"]);
  if (asked.some((n) => n.role === "area")) return textArea(o, folder, shots, asked);
  for (const k of ["area-top", "area-bottom", "top"]) if (o[k] !== undefined) fail(`--${k} belongs to --text area (large type in one area).`);
  const needs = asked.map((n) => {
    if (n.role !== "hook") return n;
    const h = input.hook;
    if (!h || !Number.isFinite(h.start) || !(h.end > h.start)) fail(`--text hook needs "hook": {"start": seconds, "end": seconds} in ${o.shots}: when the hook is shown, on the shots' clock.`);
    const spans = Array.isArray(h.spans) && h.spans.every((x) => Array.isArray(x) && x.length === 2 && x[1] > x[0]) ? h.spans : null;
    return { ...n, start: h.start, end: h.end, ...(spans ? { spans } : {}), ...(h.calm === false ? { calm: false } : {}) };
  });
  const lifts = {};
  for (const v of o.lift) {
    const m = String(v).match(/^(\d+):(\d+)$/);
    if (!m || +m[1] < 1 || +m[1] > shots.length) fail(`--lift is <shot>:<px>, the shot counted from 1 (of ${shots.length}) and how far its picture is raised, as 3:120 (3:0 not at all).`);
    lifts[+m[1] - 1] = +m[2];
  }
  const fixed = { ...(o["caption-y"] !== undefined ? { y: Number(o["caption-y"]) } : {}), ...(o["font-size"] !== undefined ? { font: Number(o["font-size"]) } : {}), lifts };
  if (fixed.y !== undefined && !(fixed.y > 0)) fail(`--caption-y is the y in px at which the captions' lowest line ends, as 1440.`);
  if (fixed.font !== undefined && !(fixed.font > 0)) fail(`--font-size is the captions' type in px, as 77.`);
  const platforms = platformList(o.platform);
  let res;
  try {
    const Z = askZones(o.frame, platforms);
    // under the safe box the apps lay their own text (the username, the caption, the sound)
    if (fixed.y !== undefined && fixed.y > Z.safe[1] + Z.safe[3]) fail(`--caption-y ${fixed.y} is below the safe box's bottom (y ${Z.safe[1] + Z.safe[3]} for ${Z.platforms.map((p) => p.name).join(", ")}), where the apps lay their own text: give ${Z.safe[1] + Z.safe[3]} or less.`);
    if (fixed.y !== undefined && fixed.y < Z.safe[1] + 40) fail(`--caption-y ${fixed.y} is above the safe box's top (y ${Z.safe[1]}) once a line stands on it: give more than ${Z.safe[1] + 40}.`);
    if (o.raise !== undefined && !["head", "mouth", "full", "moderate"].includes(o.raise)) fail(`--raise is head (never a head cut by the frame: the type to its floor first, the chin or lower lip said), mouth (the default: as head, and past the head's top where the captions would lie on a mouth) or full (until the chin is clear, the head cut).`);
    res = textOverTime({ zones: Z, shots, needs, fixed, raise: o.raise || "mouth", set: Object.fromEntries(o.set.map((x) => { const i = x.indexOf("="); if (i < 1) fail(`--set is key=value, as caption.padEm=0.6.`); return [x.slice(0, i), num(x.slice(i + 1))]; })) });
  } catch (e) { fail(e.message); }
  res.asked = { frame: o.frame, platforms, fixed, raise: o.raise || "mouth" };
  const file = path.join(folder, "text.json");
  try { fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(file, JSON.stringify(res, null, 1)); } catch (e) { fail(`${file} cannot be written (${e.code || e.message}): name a folder of yours.`); }
  if (o.json) return console.log(JSON.stringify(res, null, 1));
  const c = res.caption;
  console.log(`${res.frame} for ${res.platforms.join(", ")}, ${plural(shots.length, "shot")}`);
  if (c) console.log(`captions: one place for the clip, ${plural(c.lines, "line")} of ${c.font} px, ${boxText(c.box)} (its middle at ${c.middle} % of the height, ${c.where === "no-face" ? "no face in the clip: where published Shorts set them, as low as the safe box allows" : c.where}); ${c.seconds ? `on a face for ${c.seconds} s` : "on no face"}${c.lifted ? `, ${plural(c.lifted, "shot")} raised for it` : ""}`);
  for (const s of res.shots) {
    // the seconds on each part, the part named; a ✗ only where something can still be done
    const parts = (t) => [t.nose ? `the nose or eyes ${t.nose} s` : "", t.hair ? `the hair or forehead ${t.hair} s${t.maybe ? ` (${t.maybe} s of it where the eyes may begin: not known)` : ""}` : "", t.mouth ? `the mouth ${t.mouth} s` : "", t.lip ? `the lower lip ${t.lip} s${t.lipEst ? ` (${t.lipEst} s of it an estimate ${stillsText(t.stills)})` : ""}` : ""].filter(Boolean).join(", ");
    const on = s.touches.map((t) => `${t.who}'s face ${t.from}–${t.to} s (${t.seconds} s${parts(t) ? `, of them ${parts(t)}` : ""}, up to ${Math.round(t.share * 100)} % of it)`).join("; ");
    const what = s.fault === "nose" ? "✗ on the nose or eyes of" : s.fault === "mouth" ? "✗ on the mouth of" : s.fault ? "✗ on" : s.hair ? (s.on?.hair > 0.05 ? "above the eyes, on the hair or forehead of" : "above the head, on the hair of") : s.lip ? "on the lower lip and chin of" : "on the chin of";
    const cut = s.headCut?.seconds ? `; the head cut at the top ${s.headCut.px} px for ${s.headCut.seconds} s${s.headCut.byLift ? ` (${s.headCut.byLift} px of it by the raise)` : ""}` : "";
    console.log(`  shot ${s.shot + 1}  ${s.start.toFixed(2)}–${s.end.toFixed(2)} s  ${s.lift ? `raised ${s.lift} px${s.ground ? ` (a band of ${s.ground} px at the bottom)` : ""}${s.fixed ? ", as given" : s.past ? ", past the head's top to keep the mouth free" : s.returned ? ", as the other returns of this framing" : ""}` : "as it stands"}${cut}${on ? `  ${what} ${on}` : ""}`);
  }
  if (res.hook) console.log(`hook: ${res.hook.kind === "card" ? "a card" : "a text"} at ${res.hook.font} px, ${res.hook.where}, ${boxText(res.hook.box)}, ${res.hook.start}–${res.hook.until} s (${res.hook.kindWhy || ""}${res.hook.why ? `; ${res.hook.why}` : ""})${res.hook.onFace?.seconds ? `  ✗ on a face for ${res.hook.onFace.seconds} s` : ""}`);
  for (const x of res.conflicts) console.log(`✗ ${x}`);
  for (const n of res.notes) console.log(`note: ${n}`);
  console.log(`Other places it weighed: ${res.candidates.slice(1).map((k) => `${k.font} px with its middle at ${k.middle} % (on faces ${k.seconds} s, ${k.lifted} raised, cost ${k.cost})`).join("; ") || "none"}.`);
  console.log(`${file}: for agentitos' captions ${c ? Object.entries(c.options).map(([k, v]) => `--${k} ${v}`).join(" ") : "(no captions)"}; each shot's lift for the framing. The choice is yours: --caption-y, --font-size and --lift <shot>:<px> fix one, and the rest is placed around it.`);
}

// --measure: what texts the caller placed lie on, nothing placed (lib/placed.mjs measureOver)
function textMeasure(o, folder, shots) {
  for (const k of ["caption-y", "font-size", "raise", "area-top", "area-bottom", "top"]) if (o[k] !== undefined) fail(`--measure stands alone: it measures the boxes given where they stand; --${k} belongs to placing them.`);
  if (o.text.length || o.lift.length || o.set.length) fail(`--measure stands alone: it measures the boxes given where they stand; --${o.text.length ? "text" : o.lift.length ? "lift" : "set"} belongs to placing them.`);
  let boxes;
  try { boxes = JSON.parse(fs.readFileSync(o.measure, "utf8")); } catch (e) { fail(`--measure ${o.measure} cannot be read (${e.message}): it is JSON, [{"name": "captions", "box": [x, y, w, h], "start": seconds, "end": seconds}].`); }
  const goodBox = (b) => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[2] > 0 && b[3] > 0;
  if (!Array.isArray(boxes) || !boxes.length || boxes.some((b) => !b || typeof b.name !== "string" || !goodBox(b.box) || (b.start !== undefined && !Number.isFinite(b.start)) || (b.end !== undefined && !Number.isFinite(b.end))))
    fail(`--measure ${o.measure}: a list of {"name": a word, "box": [x, y, w, h] in px of the frame, "start" and "end" in seconds where only part of the clip}.`);
  const res = { frame: o.frame, boxes: measureOver({ shots, boxes }) };
  const file = path.join(folder, "measure.json");
  try { fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(file, JSON.stringify(res)); } catch (e) { fail(`${file} cannot be written (${e.code || e.message}): name a folder of yours.`); }
  if (o.json) return console.log(JSON.stringify(res, null, 1));
  const parts = (b) => ["nose", "hair", "mouth", "lip", "chin"].filter((k) => b[k]).map((k) => `${({ nose: "the nose or eyes", hair: "the hair or forehead", mouth: "the mouth", lip: "the lower lip", chin: "the chin" })[k]} ${b[k]} s${k === "hair" && b.maybe ? ` (${b.maybe} s of it where the eyes may begin: not known)` : ""}`).join(", ");
  for (const b of res.boxes) console.log(`${b.name} ${boxText(b.box)}${b.start !== undefined || b.end !== undefined ? ` ${b.start ?? 0}–${b.end ?? "end"} s` : ""}: ${b.seconds ? `on a face ${b.seconds} s, ${parts(b)}${b.faces.length > 1 ? `; ${b.faces.map((f) => `${f.who} ${f.seconds} s`).join(", ")}` : ""}` : "on no face"}`);
  console.log(`${file}: per box the seconds on each part, per face, and per moment the faces it lies on with the part (moments); nothing was placed.`);
}

// --text area: large type in one area for the whole clip (lib/area.mjs), with its own list
function textArea(o, folder, shots, needs) {
  if (needs.length > 1) fail(`--text area stands alone: large type takes the area that captions or a hook would take; place those with another run.`);
  if (o["caption-y"] !== undefined || o["font-size"] !== undefined) fail(`--caption-y and --font-size are the captions'; for --text area fix the area's top with --top <px>.`);
  const px = (k) => { if (o[k] === undefined) return undefined; const v = Number(o[k]); if (!(v > 0)) fail(`--${k} is a y in px of the frame, as 1025.`); return v; };
  const lifts = {};
  for (const v of o.lift) {
    const m = String(v).match(/^(\d+):(\d+)$/);
    if (!m || +m[1] < 1 || +m[1] > shots.length) fail(`--lift is <shot>:<px>, the shot counted from 1 (of ${shots.length}) and how far its picture is raised, as 3:120 (3:0 not at all).`);
    lifts[+m[1] - 1] = +m[2];
  }
  if (o.raise !== undefined && !["head", "mouth", "full", "moderate"].includes(o.raise)) fail(`--raise is head (never a head cut by the frame), mouth (the default: past the head's top for a mouth, the eyes no higher than 27 % of the height) or full (as far as the eyes stay below the apps' top bar).`);
  const platforms = platformList(o.platform);
  let res;
  try {
    const Z = askZones(o.frame, platforms);
    const bottom = px("area-bottom");
    if (bottom !== undefined && bottom > Z.safe[1] + Z.safe[3] + 0.5) fail(`--area-bottom ${bottom} is below the safe box's bottom (y ${Z.safe[1] + Z.safe[3]}), where the apps lay their own text: give ${Z.safe[1] + Z.safe[3]} or less.`);
    res = areaOverTime({ zones: Z, shots, area: { top: px("area-top"), bottom }, fixed: { top: px("top"), lifts }, raise: o.raise || "mouth",
      set: Object.fromEntries(o.set.map((x) => { const i = x.indexOf("="); if (i < 1) fail(`--set is key=value, as area.least=0.12.`); return [x.slice(0, i), num(x.slice(i + 1))]; })) });
  } catch (e) { fail(e.message); }
  res.asked = { frame: o.frame, platforms, raise: o.raise || "mouth", ...(o.top !== undefined ? { top: Number(o.top) } : {}), lifts };
  const file = path.join(folder, "text.json");
  try { fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(file, JSON.stringify(res, null, 1)); } catch (e) { fail(`${file} cannot be written (${e.code || e.message}): name a folder of yours.`); }
  if (o.json) return console.log(JSON.stringify(res, null, 1));
  const a = res.area, s1 = (v) => Math.round(v * 10) / 10;
  console.log(`${res.frame} for ${res.platforms.join(", ")}, ${plural(shots.length, "shot")}`);
  console.log(`the type: one area for the clip, ${boxText(a.box)} (${Math.round(a.share * 100)} % of the height${a.lower > 0 ? `, its top ${Math.round(a.lower)} px below the usual ${Math.round(a.usual)}` : ", its usual top"}); on a mouth, nose or eyes ${s1(a.seconds.nose + a.seconds.mouth + a.seconds.lip)} s,${a.seconds.hair ? ` on the hair or forehead ${a.seconds.hair} s,` : ""} on a chin or neck ${a.seconds.chin} s${a.lifted ? `, ${plural(a.lifted, "shot")} raised for it` : ""}`);
  for (const s of res.shots) {
    const on = s.touches.map((t) => `${t.who} ${t.from}–${t.to} s (${[t.nose ? `the nose or eyes ${t.nose} s` : "", t.hair ? `the hair or forehead ${t.hair} s` : "", t.mouth ? `the mouth ${t.mouth} s` : "", t.lip ? `the lower lip ${t.lip} s` : "", t.chin ? `the chin or neck ${t.chin} s` : ""].filter(Boolean).join(", ")})`).join("; ");
    const cut = s.headCut?.byLift ? `; the head cut at the top ${s.headCut.byLift} px more by the raise` : "";
    console.log(`  shot ${s.n ?? s.shot + 1}  ${s.start.toFixed(2)}–${s.end.toFixed(2)} s  ${s.lift ? `raised ${s.lift} px${s.ground ? ` (a band of ${s.ground} px at the bottom)` : ""}${s.fixed ? ", as given" : s.returned ? ", as the other returns of this framing" : ""}` : "as it stands"}${s.eyes != null ? `, ${s.eyesAre ? eyesText(s.eyesAre, s.eyes).replace(" at ", " from ") : `the eyes from ${Math.round(s.eyes * 100)} % of the height`}` : ""}${cut}  ${on ? `${s.fault ? "✗ " : ""}on ${on}` : "on no face"}`);
  }
  for (const x of res.conflicts) console.log(`✗ ${x}`);
  for (const n of res.notes) console.log(`note: ${n}`);
  const raised = (k) => k.lifts.length ? k.lifts.map((x) => `shot ${x.n ?? x.shot + 1} raised ${x.px} px`).join(", ") : "nothing raised";
  console.log(`It took y ${Math.round(res.candidates[0].top)} at a cost of ${res.candidates[0].cost}. Other tops it weighed: ${res.candidates.slice(1).map((k) => `y ${Math.round(k.top)} (the type ${Math.round(k.size * 100)} % of its usual size, ${raised(k)}; on a mouth, nose or eyes ${k.mouth} s, on a chin ${k.chin} s; cost ${k.cost})`).join("; ") || "none"}.`);
  console.log(`${file}: the area's top for the type, each shot's lift for the framing. The choice is yours: --top <px> and --lift <shot>:<px> fix one, --raise how far a picture may go up, and the rest is placed around it.`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "beside") cmdBeside(parseArgs(cmd, rest));
else if (cmd === "grid") cmdGrid(parseArgs(cmd, rest));
else if (cmd === "place") cmdPlace(parseArgs(cmd, rest));
else if (cmd === "page") cmdPage(parseArgs(cmd, rest));
else if (cmd === "captions") cmdCaptions(parseArgs(cmd, rest));
else if (cmd === "text") cmdText(parseArgs(cmd, rest));
else fail(`${self()} grid <video|image> <out.jpg> [--at <s>] | place <folder> --frame 9:16 --source WxH --face x,y,w,h [--text caption] [--text hook] [--platform …] [--json] | page <folder> [--candidate 1,2,3] [--still <video|image>] | captions <folder> [--candidate 1] | beside <folder> --frame 9:16 --source WxH --face x,y,w,h --material-min WxH [--text caption] | text <folder> --frame 9:16 --shots <shots.json> [--text caption] [--text hook] | [--text area]`);
