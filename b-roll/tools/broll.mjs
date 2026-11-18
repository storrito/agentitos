#!/usr/bin/env node
// B-roll for a video in which someone talks: at the words that name something, that thing on the
// screen (their page, a post, a number, their own pictures and footage), as a HyperFrames
// sub-composition mounted under the captions. Made for agents, and for other skills (best-takes,
// clips): each step prints what it did and what to do next. The agent chooses the moments and the
// pictures; the tool places them on the words, frames them for the platforms and checks them.
//
//   node tools/broll.mjs words <video> <dir>          the words said, timed and numbered:
//                                         <dir>/words.json (agentitos' transcribe)
//   node tools/broll.mjs brief <words.json> <dir> [<material> …]   <dir>/brief.md: the rules, the
//                                         material (files or folders), every word numbered
//   node tools/broll.mjs shot <url> <file.png>        a web page as a phone shows it, or a post on
//                                         X as its card (agentitos' page-shot); <file.png>.json
//                                         notes the source
//   node tools/broll.mjs build <broll.json> <words.json> <folder>   the b-roll as a sub-composition,
//                                         <folder>/index.html, and the clip that mounts it
//   node tools/broll.mjs project <video> <broll.json> <words.json> <composition-folder>   a whole
//                                         HyperFrames project: the video, its b-roll (and captions)
//   node tools/broll.mjs sheet <composition-folder>   the preview at every beat (just before, the
//                                         middle, just after) as one picture to look at
//   node tools/broll.mjs face <video> <file.jpg>      a frame of the video with a grid, to read the
//                                         face's box off for "face" in broll.json
//
// Options: --size 1080x1920 (build: else the words' frame)   --platform reels,tiktok (where the
//   video goes: what must be read stays clear of what those apps lay over it; none: the usual
//   platforms of the frame)   --brand brand/DESIGN.md (else the working directory's, when there is
//   one)   --track <n> (build: the mount's track, default 5)   --desktop (shot: as a laptop shows
//   the page)   --from <px> (shot: that far down the page)   --height <px> (shot: how much of it,
//   default 640, a laptop 900)   --captions hormozi|karaoke|wipe|clean
//   (project: captions too, agentitos' captions skill)   --fit cover|contain (project: a video of
//   another shape than --size)   --out <file.jpg> (sheet)   --at <s> (face: that second)
//   --captions-area <captions folder or its area.json> (build: where the host's captions stand;
//   beats beside the person keep a band for them under the material and move them onto it)
//
// broll.json: {"face": [x, y, w, h], "source": [w, h], "beats": [{"at": 12, "until": 18, "show": "uploads/shop.jpg",
//   "fit": "fill", "credit": true, "why": "…"}, {"at": 40, "number": "+300 %", "label": "…"}, …]};
//   at/until are word numbers of words.json; fit beside|fill|whole|read (a number and what shot
//   took: beside the person, else by the shape); face: the person's face in px of the source
//   video, source: that video's [width, height] (else the frame's; project: the video's).
//   words.json: {"width", "height", "duration", "words": [{"i", "text", "start", "end"}, …]}
//   (best-takes' edit.json is one), times in the video the b-roll goes on.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { probe, kindOf, playablePicture, playableVideo, still, hyperframes, clock, IMAGE, VIDEO } from "./lib/media.mjs";
import { pageShotTool, NEEDS_PAGE_SHOT } from "./lib/pageshot.mjs";
import { writeBroll, mount, personMotion, rectOf, ID, PERSON, MOVE } from "./lib/render.mjs";
import { besideLayout, frameFace } from "./lib/beside.mjs";
import { brief } from "./lib/brief.mjs";
import { brandOf } from "./lib/brand.mjs";
import { zones, platformList } from "./lib/zones.mjs";
import { transcribeFile, transcribeTool, NEEDS_TRANSCRIBE } from "./lib/transcribe.mjs";

const VALUED = ["size", "platform", "brand", "track", "from", "height", "captions", "captions-area", "fit", "out", "at"];
const FLAGS = ["desktop"];
const LEAD = 0.05;   // a beat starts this long after its word starts: on the word, never before
const TAIL = 0.2;    // and ends this long after its last word
const JOIN = 1.2;    // two beats closer than this are joined: no flash of the face between them
const SHORTEST = 1.2, READ = 2.5, LONGEST_STILL = 6, HOLD = 5;
const FITS = ["beside", "fill", "whole", "read"];

const fail = (msg) => { console.log(msg); process.exit(1); };
const rel = (p) => path.relative(process.cwd(), p) || ".";
const self = () => (rel(process.argv[1]).startsWith("..") ? process.argv[1] : rel(process.argv[1]));
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function parse(args) {
  const pos = [], opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const k = a.slice(2);
    if (FLAGS.includes(k)) { opts[k] = true; continue; }
    if (!VALUED.includes(k)) fail(`Unknown option ${a}. Options: ${[...VALUED, ...FLAGS].map((o) => "--" + o).join(" ")}`);
    if (i + 1 >= args.length) fail(`${a} needs a value.`);
    opts[k] = args[++i];
  }
  return [pos, opts];
}

const sizeOf = (opts, fallback) => {
  if (!opts.size) return fallback;
  const m = String(opts.size).match(/^(\d+)x(\d+)$/);
  if (!m) fail("--size is width x height, e.g. 1080x1920");
  return [Number(m[1]), Number(m[2])];
};

// --brand, else brand/DESIGN.md of the working directory when there is one
function brandFile(opts) {
  if (opts.brand) { if (!fs.existsSync(opts.brand)) fail(`There is no ${opts.brand}.`); return opts.brand; }
  return fs.existsSync("brand/DESIGN.md") ? "brand/DESIGN.md" : null;
}

// the words, numbered: {width, height, duration, words: [{i, text, start, end}]}; fillers and
// noises are no words
function readWords(file) {
  if (!file || !fs.existsSync(file)) fail(`There is no ${file}.`);
  let j;
  try { j = read(file); } catch (e) { fail(`✗ ${file} is no valid JSON: ${e.message}`); }
  const all = Array.isArray(j) ? j : j.words || [];
  const words = all.map((w, k) => ({ ...w, i: w.i ?? k })).filter((w) => w && String(w.text ?? "").trim() && w.end >= w.start && (!w.kind || w.kind === "word"));
  if (!words.length) fail(`${file} holds no timed words: {"words": [{"text", "start", "end"}, …]}.`);
  return { width: j.width, height: j.height, duration: j.duration || Math.ceil(words.at(-1).end + 1), words };
}

// ----------------------------------------------------------------------------------- words
async function cmdWords(video, dir) {
  if (!video || !dir) fail("Usage: broll.mjs words <video> <dir>");
  if (!fs.existsSync(video)) fail(`There is no ${video}.`);
  if (!transcribeTool()) fail(NEEDS_TRANSCRIBE);
  const p = probe(video);
  if (!p.acodec) fail(`${video} has no sound: b-roll goes on what is said.`);
  let r;
  try { r = await transcribeFile(video, { log: console.log }); } catch (e) { fail(e.message); }
  const words = r.words.filter((w) => !w.kind || w.kind === "word").map(({ text, start, end }, i) => ({ i, text, start, end }));
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, "words.json");
  fs.writeFileSync(out, JSON.stringify({ asr: r.model, width: p.width, height: p.height, duration: p.duration, words }, null, 1));
  console.log(`${rel(out)}: ${words.length} words, ${clock(p.duration)}, ${p.width}×${p.height}. Fix a misheard name in it yourself, keeping the times.`);
  console.log(`Next: node ${self()} brief ${rel(out)} ${rel(dir)} [the person's pictures and videos …]`);
}

// ----------------------------------------------------------------------------------- brief
function describe(file) {
  const kind = kindOf(file);
  const p = probe(file);
  const note = fs.existsSync(`${file}.json`) ? read(`${file}.json`) : null;
  const shape = p.width / p.height > 1.15 ? "wide" : p.width / p.height < 0.87 ? "tall" : "square";
  if (note) return `${note.kind} ${note.url}, ${p.width}×${p.height}${note.credit ? `, source "${note.credit}"` : ""}`;
  return kind === "video" ? `video, ${p.width}×${p.height} (${shape}), ${clock(p.duration)}` : `picture, ${p.width}×${p.height} (${shape})`;
}

function cmdBrief(file, dir, material, opts) {
  if (!file || !dir) fail("Usage: broll.mjs brief <words.json> <dir> [<picture or video or folder> …]");
  const w = readWords(file);
  const size = sizeOf(opts, w.width && w.height ? [w.width, w.height] : null) || fail("Give --size (width x height): the words carry no frame size.");
  const files = material.flatMap((m) => {
    if (!fs.existsSync(m)) fail(`There is no ${m}.`);
    return fs.statSync(m).isDirectory() ? fs.readdirSync(m).sort().map((f) => path.join(m, f)).filter((f) => IMAGE.test(f) || VIDEO.test(f)) : [m];
  });
  const list = [];
  for (const f of files) {
    if (!kindOf(f)) { console.log(`  ${f}: neither a picture nor a video, left out`); continue; }
    try { list.push({ file: f, what: describe(f) }); } catch (e) { console.log(`  ${e.message} Left out.`); }
  }
  const brand = brandFile(opts);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, "brief.md");
  fs.writeFileSync(out, brief({ words: w.words, width: size[0], height: size[1], duration: w.duration, material: list, brand }));
  console.log(`${rel(out)}: ${w.words.length} words, ${list.length} pictures and videos to choose from${brand ? `, brand kit ${brand}` : ""}.`);
  console.log(`Next: read ${rel(out)} (all of it), take what is missing with \`node ${self()} shot <url> ${rel(dir)}/<name>.png\`, write ${rel(path.join(dir, "broll.json"))}, then build.`);
}

// ------------------------------------------------------------------------------------ shot
// a page or a post as a picture: agentitos' page-shot takes it, with a note of its source beside it
function cmdShot(url, file, opts) {
  if (!url || !file) fail("Usage: broll.mjs shot <https://…> <file.png> [--desktop] [--from <px>] [--height <px>]");
  const tool = pageShotTool();
  if (!tool) fail(NEEDS_PAGE_SHOT);
  const args = [tool, url, file, ...(opts.desktop ? ["--desktop"] : []), ...(opts.from ? ["--from", opts.from] : []), ...(opts.height ? ["--height", opts.height] : [])];
  const r = spawnSync(process.execPath, args, { encoding: "utf8" });
  const said = (r.stdout || r.stderr || "").trim();
  if (r.status) fail(said || "✗ page-shot stopped.");
  console.log(said);
  const note = fs.existsSync(`${file}.json`) ? read(`${file}.json`) : {};
  console.log(`Then name it in broll.json as "show"; it is shown to be read beside the person ("fit": "beside", in a field about as wide as high: take only the part that matters, --height 400; "read" over the whole frame)${note.kind === "post" ? ', with "credit": true for its author' : ""}.`);
}

// ----------------------------------------------------------------------------------- build
// the beats of broll.json on the words' clock: where each starts and ends, what it shows, how
function placeBeats(spec, w, size, base) {
  const errors = [], warnings = [], notes = [];
  const byI = new Map(w.words.map((x, k) => [x.i, k]));
  const sentenceEnd = (k) => {
    for (let j = k; j < w.words.length; j++) if (/[.!?…]["”']?$/.test(w.words[j].text) || (w.words[j + 1] && w.words[j + 1].start - w.words[j].end > 0.8)) return w.words[j].end;
    return w.words.at(-1).end;
  };
  const resolve = (p) => (fs.existsSync(p) ? p : fs.existsSync(path.join(base, p)) ? path.join(base, p) : null);
  const beats = [];
  (spec.beats || []).forEach((s, k) => {
    const n = k + 1, label = `beat ${n}`;
    if (s.at == null) { errors.push(`${label} has no "at" (the number of the word it starts on)`); return; }
    if (!s.show === !s.number) { errors.push(`${label} needs either "show" (a picture or video) or "number"`); return; }
    const a = byI.get(Number(s.at));
    if (a == null) { warnings.push(`${label} left out: word ${s.at} is not in the video (cut out?)`); return; }
    const start = w.words[a].start + LEAD;
    let end;
    if (s.until != null) {
      const u = byI.get(Number(s.until));
      if (u == null || u < a) warnings.push(`${label}: word ${s.until} ("until") is not in the video after word ${s.at}; it runs to the end of the sentence`);
      else end = w.words[u].end + TAIL;
    }
    if (end == null && s.seconds) end = start + Number(s.seconds);
    if (end == null) end = Math.min(start + 4, Math.max(start + 2, sentenceEnd(a) + TAIL));
    const b = { n, at: Number(s.at), why: s.why || "", start, end: Math.min(end, w.duration), words: a };
    if (s.fit != null && !FITS.includes(s.fit)) { errors.push(`${label}: "fit" is beside, fill, whole or read`); return; }
    if (s.face != null) warnings.push(`${label}: one face per video: "face" belongs at the top of broll.json, not in a beat; this one is not used`);
    if (s.number) {
      // a number goes beside the person; any other fit is today's card over the whole frame
      Object.assign(b, { kind: "number", number: String(s.number), label: s.label ? String(s.label) : "", fit: s.fit === undefined || s.fit === "beside" ? "beside" : "fill" });
    } else {
      const file = resolve(s.show);
      if (!file) { errors.push(`${label}: there is no ${s.show}`); return; }
      const kind = kindOf(file);
      if (!kind) { errors.push(`${label}: ${s.show} is neither a picture nor a video`); return; }
      let p;
      try { p = probe(file); } catch (e) { errors.push(`${label}: ${e.message}`); return; }
      const note = fs.existsSync(`${file}.json`) ? read(`${file}.json`) : null;
      const near = Math.abs(p.width / p.height - size[0] / size[1]) / (size[0] / size[1]) < 0.25;
      // what shot took is to be read: beside the person; any other picture by its shape
      const fit = s.fit || (note ? "beside" : near ? "fill" : "whole");
      const credit = s.credit === true ? note?.credit || null : s.credit || null;
      if (s.credit === true && !credit) warnings.push(`${label}: "credit": true, but ${s.show} names no source; write the source as text`);
      Object.assign(b, { kind, source: file, show: s.show, w: p.width, h: p.height, fit, credit, from: kind === "video" ? Number(s.from) || 0 : 0, length: p.duration });
      if (kind === "video" && b.from >= p.duration) { errors.push(`${label}: ${s.show} is ${p.duration.toFixed(1)} s long, "from" ${b.from} is past its end`); return; }
    }
    beats.push(b);
  });

  beats.sort((x, y) => x.start - y.start);
  for (let k = 1; k < beats.length; k++) {
    const prev = beats[k - 1], cur = beats[k];
    if (cur.start < prev.end) { prev.end = cur.start; notes.push(`beat ${prev.n} ends where beat ${cur.n} starts`); }
    else if (cur.start - prev.end < JOIN) { notes.push(`beat ${prev.n} runs on to beat ${cur.n} (${(cur.start - prev.end).toFixed(1)} s of face between them would flash)`); prev.end = cur.start; }
  }
  const last = beats.at(-1);
  if (last && w.duration - last.end < 0.8 && w.duration > last.end) { notes.push(`beat ${last.n} runs on to the end`); last.end = w.duration; }

  // beside the person: one layout for the whole video (the face from broll.json, else assumed;
  // the captions' band when the host has captions, --captions-area); the person moves in at the
  // start of a stretch of beats that touch and out at its end, or is set in place next to a beat
  // over the whole frame
  const touches = (x, y) => x && y && Math.abs(x.end - y.start) < 0.01;
  const source = Array.isArray(spec.source) ? spec.source : size.source;
  if (spec.face != null && !frameFace(spec.face, source, size[0], size[1])) errors.push(`"face" is [x, y, width, height] of the face in px of the source video, "source" its [width, height] (\`node ${self()} face <video> <file.jpg>\` shows them)`);
  let layout = null;
  const runs = [];
  beats.forEach((b, k) => {
    if (b.fit !== "beside") return;
    const prev = beats[k - 1], next = beats[k + 1];
    b.enter = touches(prev, b) ? "cut" : "move";
    b.leave = touches(b, next) ? "cut" : "move";
    // (agentitos' layout gives it, asked once; without that skill the build stops here)
    layout ||= besideLayout({ width: size[0], height: size[1], face: spec.face, source, captions: size.captions, platforms: size.platforms });
    b.layout = layout;
    if (touches(prev, b) && prev.fit === "beside") runs.at(-1).push(b); else runs.push([b]);
  });
  for (const run of runs) {
    const first = run[0], last = run.at(-1);
    for (const b of run) { b.moveIn = Math.min(MOVE, (first.end - first.start) / 3); b.moveOut = Math.min(MOVE, (last.end - last.start) / 3); }
  }
  if (layout) {
    for (const x of layout.warnings) warnings.push(`beside the person: ${x}`);
    for (const x of layout.notes) notes.push(`beside the person: ${x}`);
  }
  if (layout?.speaker.assumed) notes.push(`no "face" in broll.json: the face is assumed in the upper third, in the middle; when the sheet shows it wrong, give "face": [x, y, w, h] and "source": [w, h] of the video (\`node ${self()} face <video> <file.jpg>\` shows a frame of it with a grid)`);

  for (const b of beats) {
    b.duration = b.end - b.start;
    const label = `beat ${b.n}`;
    if (b.kind === "video" && b.from + b.duration > b.length + 0.05) {
      warnings.push(`${label}: ${b.show} has ${(b.length - b.from).toFixed(1)} s from second ${b.from}, the beat wants ${b.duration.toFixed(1)} s: it ends early; start it earlier in the video ("from") or shorten the beat`);
      b.duration = Math.max(0.1, b.length - b.from); b.end = b.start + b.duration;
    }
    if (b.duration < SHORTEST) warnings.push(`${label} is on screen ${b.duration.toFixed(1)} s: too short to take in; let it run longer ("until") or leave it out`);
    else if ((b.fit === "read" || (b.fit === "beside" && b.kind !== "number")) && b.duration < READ) warnings.push(`${label} is to be read and on screen ${b.duration.toFixed(1)} s: give it at least ${READ} s ("until" a later word), about a second for four of its words`);
    if (b.kind === "image" && b.duration > LONGEST_STILL) warnings.push(`${label}: a still held ${b.duration.toFixed(1)} s is dead air; end it sooner or split it`);
    if (b.kind === "image" || b.kind === "video") {
      const r = rectOf(b, { width: size[0], height: size[1], zones: size.zones });
      if (b.fit === "fill" && r.scale > 1.6) warnings.push(`${label}: ${b.show} (${b.w}×${b.h}) is enlarged ×${r.scale.toFixed(1)} to fill the frame and looks soft; "fit": "whole", or a bigger one`);
      if (b.fit === "whole" && r.scale > 2.5) warnings.push(`${label}: ${b.show} (${b.w}×${b.h}) is small for the frame (×${r.scale.toFixed(1)}); a bigger one`);
      const reading = b.fit === "read" || b.fit === "beside";
      if (reading && r.scale < 0.45) warnings.push(`${label}: ${b.show} shrinks to ${Math.round(r.scale * 100)} % to fit: its text is likely too small to read on a phone; take only the part that matters (shot --height, --from)${size[0] > size[1] && b.h > b.w ? ", or the page as a laptop shows it (shot --desktop), which suits a wide frame" : ""}`);
      if (reading && r.scale > 2.2) warnings.push(`${label}: ${b.show} (${b.w}×${b.h}) is enlarged ×${r.scale.toFixed(1)}: its text will look soft; a sharper one`);
    }
  }
  const holds = beats.filter((b) => b.duration > HOLD);
  if (holds.length > 1) warnings.push(`${holds.length} beats are held over ${HOLD} s (${holds.map((b) => b.n).join(", ")}): one at most, the rest shorter`);
  const covered = beats.reduce((t, b) => t + b.duration, 0) / w.duration;
  const hidden = beats.filter((b) => b.fit !== "beside").reduce((t, b) => t + b.duration, 0) / w.duration;
  if (hidden > 0.5) warnings.push(`b-roll over the whole frame covers ${Math.round(hidden * 100)} % of the video: the speaker hardly shows; keep the strongest beats, or show them beside the person ("fit": "beside")`);
  return { beats, errors, warnings, notes, covered };
}

function buildBroll(brollFile, wordsFile, folder, opts) {
  if (!brollFile || !wordsFile || !folder) fail("Usage: broll.mjs build <broll.json> <words.json> <folder> [--size 1080x1920] [--platform …] [--brand …]");
  if (!fs.existsSync(brollFile)) fail(`There is no ${brollFile}: write it as brief.md says.`);
  let spec;
  try { spec = read(brollFile); } catch (e) { fail(`✗ ${brollFile} is no valid JSON: ${e.message}`); }
  const w = readWords(wordsFile);
  const size = sizeOf(opts, w.width && w.height ? [w.width, w.height] : null) || fail("Give --size (width x height): the words carry no frame size.");
  size.platforms = platformList(opts.platform);
  try { size.zones = zones(size[0], size[1], size.platforms); } catch (e) { fail(`✗ ${e.message}`); }
  size.source = opts.source;   // project: the person's video's size, for "face" without "source"
  // where the captions stand (agentitos' captions writes area.json beside its index.html): beats
  // beside the person keep a band for them under the material and move them onto it
  if (opts["captions-area"]) {
    const f = fs.existsSync(opts["captions-area"]) && fs.statSync(opts["captions-area"]).isDirectory() ? path.join(opts["captions-area"], "area.json") : opts["captions-area"];
    if (!fs.existsSync(f)) fail(`There is no ${f}: build the captions first (agentitos' captions writes area.json beside its index.html).`);
    try { size.captions = read(f); } catch (e) { fail(`✗ ${f} is no valid JSON: ${e.message}`); }
  }
  const r = placeBeats(spec, w, size, path.dirname(path.resolve(brollFile)));
  if (r.errors.length) fail(r.errors.map((e) => `✗ ${e}`).join("\n") + `\nFix ${rel(path.resolve(brollFile))} and build again.`);

  const out = path.resolve(folder);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "assets"), { recursive: true });
  const bf = brandFile(opts);
  const brand = brandOf(bf);
  // one asset per source picture; a video once per beat (its own start), with a still behind it
  const assets = new Map();
  for (const b of r.beats) {
    if (b.kind === "number") continue;
    const base = String(b.n).padStart(2, "0");
    if (b.kind === "image") {
      const key = path.resolve(b.source);
      if (!assets.has(key)) assets.set(key, playablePicture(b.source, path.join(out, "assets"), base));
      b.file = assets.get(key);
      b.bg = b.fit === "whole" || ((b.fit === "read" || b.fit === "beside") && !brand?.primary) ? b.file : null;
      b.zoom = b.fit === "fill" || b.fit === "whole";
    } else {
      const key = `${path.resolve(b.source)}#video`;
      if (!assets.has(key)) assets.set(key, playableVideo(b.source, path.join(out, "assets"), base));
      b.file = assets.get(key);
      if (b.fit === "whole" || ((b.fit === "read" || b.fit === "beside") && !brand?.primary)) { b.bg = `${base}.bg.jpg`; still(b.source, b.from + 0.1, path.join(out, "assets", b.bg)); }
    }
    b.track = 1;
  }
  for (const b of r.beats) if (b.kind === "number") b.track = 1;
  writeBroll(out, { beats: r.beats, width: size[0], height: size[1], duration: w.duration, zones: size.zones, brand });
  // the layout skill's answer beside the build, to look at: every candidate with its reasons
  const placed = r.beats.find((b) => b.layout)?.layout;
  if (placed) {
    fs.writeFileSync(path.join(out, "placement.json"), JSON.stringify(placed.placement, null, 1) + "\n");
    r.notes.push(`beside the person: laid out by agentitos' layout, its candidate ${placed.candidate} (${placed.placement.candidates[placed.candidate - 1].fit}); all of them, with their reasons, in ${rel(path.join(out, "placement.json"))}`);
  }
  const text = (b) => {
    const until = w.words.findIndex((x) => x.end > b.end - TAIL + 0.01);
    return w.words.slice(b.words, Math.max(b.words + 1, until === -1 ? w.words.length : until)).map((x) => x.text).join(" ");
  };
  fs.writeFileSync(path.join(out, "beats.json"), JSON.stringify({ width: size[0], height: size[1], duration: w.duration,
    beats: r.beats.map((b) => ({ n: b.n, at: b.at, start: +b.start.toFixed(3), end: +b.end.toFixed(3), said: text(b), ...(b.number ? { number: b.number, label: b.label } : { show: b.show, asset: `assets/${b.file}` }), fit: b.fit,
      ...(b.layout ? { beside: { material: b.layout.material.field, person: b.layout.speaker.card, face: b.layout.speaker.face, ...(b.layout.speaker.assumed ? { assumed: true } : {}) } } : {}), ...(b.credit ? { credit: b.credit } : {}), why: b.why })) }, null, 1) + "\n");

  console.log(`${rel(out)}/index.html: ${r.beats.length} beats over ${Math.round(r.covered * 100)} % of ${clock(w.duration)}, ${size[0]}×${size[1]}${brand ? `, brand ${bf}` : ""}`);
  for (const b of r.beats) {
    const what = b.number ? `number "${b.number}"${b.label ? ` · ${b.label}` : ""}${b.fit === "beside" ? ", beside" : ", whole frame"}` : `${b.show}${b.kind === "video" ? ` from ${b.from} s` : ""}, ${b.fit}${b.credit ? `, credit "${b.credit}"` : ""}`;
    const said = text(b);
    console.log(`  ${String(b.n).padStart(2)}  ${clock(b.start)}–${clock(b.end)}  ${b.duration.toFixed(1)} s  [${b.at}] „${said.length > 60 ? said.slice(0, 57) + "…" : said}“  → ${what}`);
  }
  // each layout beside the person once (beats that touch share one)
  const L = r.beats.find((b) => b.layout)?.layout;
  if (L) {
    const P = L.speaker, C = L.captions;
    console.log(`  Beside the person: the material in ${L.material.field.join(", ")}${C ? `, the captions ${C.where === "seam" ? `on the seam in ${C.box.join(", ")} (moved ${C.shift.y} px)` : `where they are (${C.box.join(", ")})`}` : ""}, the person in ${P.card.join(", ")} (×${P.scale}), the face at ${P.face.join(", ")} (${P.facePct} % of the frame's height${P.assumed ? ", assumed" : ""}).`);
  }
  for (const x of r.notes) console.log(`  · ${x}`);
  const z = size.zones;
  console.log(`What must be read sits clear of ${z.platforms.map((p) => p.name).join(", ")}${z.fallback ? " (no --platform: the usual ones of this frame)" : ""}.`);
  for (const x of r.warnings) console.log(`⚠ ${x}`);
  return { out, size, duration: w.duration, beats: r.beats, track: Number(opts.track) || 5, motion: personMotion(r.beats) };
}

function cmdBuild(brollFile, wordsFile, folder, opts) {
  const b = buildBroll(brollFile, wordsFile, folder, opts);
  console.log(`Mount it in the host composition, inside its root, before the captions (what comes later is painted on top):\n  ${mount({ dir: path.basename(b.out), width: b.size[0], height: b.size[1], duration: b.duration, track: b.track })}`);
  if (b.motion) console.log(`Beats beside the person move the person's video: put all its clips into one <div id="${PERSON}"> (position: absolute; inset: 0; no data-start) and this after the script that makes the host's timeline:\n  ${b.motion}`);
}

// --------------------------------------------------------------------------------- project
function captionsTool() {
  const skill = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const candidates = [process.env.CAPTIONS_TOOL, path.join(skill, "..", "captions", "tools", "captions.mjs"), "/home/sprite/skills/captions/tools/captions.mjs"];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function runCaptions(args) {
  const tool = captionsTool();
  if (!tool) fail("✗ Captions need agentitos' captions skill beside this one (or CAPTIONS_TOOL naming its tools/captions.mjs).");
  const r = spawnSync(process.execPath, [tool, ...args], { encoding: "utf8" });
  if (r.status) fail(`✗ captions: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

function cmdProject(video, brollFile, wordsFile, folder, opts) {
  if (!video || !brollFile || !wordsFile || !folder) fail("Usage: broll.mjs project <video> <broll.json> <words.json> <composition-folder> [--captions <style>] [--platform …]");
  if (!fs.existsSync(video)) fail(`There is no ${video}.`);
  const p = probe(video);
  const size = sizeOf(opts, [p.width, p.height]);
  const out = path.resolve(folder);
  fs.mkdirSync(path.join(out, "assets"), { recursive: true });
  // the captions first: the beats beside the person lay themselves out around them
  let captions = "";
  fs.rmSync(path.join(out, "captions"), { recursive: true, force: true });
  if (opts.captions) {
    const words = readWords(wordsFile);
    if (!words.words.some((x) => x.highlight)) runCaptions(["mark", wordsFile]);
    const said = runCaptions(["build", wordsFile, path.join(out, "captions"), "--style", opts.captions, "--size", `${size[0]}x${size[1]}`, "--duration", String(p.duration),
      ...(brandFile(opts) ? ["--brand", brandFile(opts)] : []), ...(opts.platform ? ["--platform", opts.platform] : [])]);
    captions = said.match(/<div id="captions"[^\n]*<\/div>/)?.[0] ?? "";
  }
  const b = buildBroll(brollFile, wordsFile, path.join(out, ID), { ...opts, size: `${size[0]}x${size[1]}`, source: [p.width, p.height], ...(captions ? { "captions-area": path.join(out, "captions", "area.json") } : {}) });
  if (opts.captions) console.log(`Captions: ${opts.captions}`);
  const asset = playableVideoWithSound(video, path.join(out, "assets"));
  const fit = opts.fit === "contain" ? "contain" : "cover";
  fs.writeFileSync(path.join(out, "index.html"), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${size[0]}, height=${size[1]}" />
    <title>${path.basename(video, path.extname(video)).replace(/</g, "&lt;")}</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${size[0]}px; height: ${size[1]}px; overflow: hidden; background: #000; }
      #main { position: relative; width: 100%; height: 100%; overflow: hidden; background: #000; }
      #${PERSON} { position: absolute; inset: 0; transform-origin: 0 0; }
      #${PERSON} > video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: ${fit}; }
    </style>
  </head>
  <body>
    <!-- generated by agentitos/b-roll: the video with its b-roll${captions ? " and captions" : ""}; change broll.json and build again -->
    <div id="main" data-composition-id="main" data-start="0" data-duration="${p.duration.toFixed(3)}" data-width="${size[0]}" data-height="${size[1]}" data-fps="30">
      <div id="${PERSON}">
        <video id="video" class="clip" src="assets/${asset}" data-start="0" data-duration="${p.duration.toFixed(3)}" data-track-index="0" playsinline data-has-audio="${!!p.acodec}"></video>
      </div>
      ${mount({ width: size[0], height: size[1], duration: p.duration, track: b.track })}${captions ? `\n      ${captions}` : ""}
    </div>
    <script>
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>${b.motion ? `\n    ${b.motion}` : ""}
  </body>
</html>
`);
  fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify({ id: path.basename(out), name: path.basename(out) }, null, 2) + "\n");
  fs.writeFileSync(path.join(out, "hyperframes.json"), JSON.stringify({ $schema: "https://hyperframes.heygen.com/schema/hyperframes.json", paths: { assets: "assets" }, media: { autoProxy: true } }, null, 2) + "\n");
  console.log(`${rel(out)}: the video with its b-roll${captions ? " and captions" : ""} → index.html`);
  console.log(`Next: node ${self()} sheet ${rel(out)}, and look at it.`);
}

// the person's video with its sound, as the browser plays it (linked when it is H.264 + AAC in MP4)
function playableVideoWithSound(file, dir) {
  const p = probe(file);
  const name = `video.mp4`, out = path.join(dir, name);
  fs.rmSync(out, { force: true });
  if (p.vcodec === "h264" && (!p.acodec || p.acodec === "aac") && /\.mp4$/i.test(file) && p.format.includes("mp4")) {
    try { fs.linkSync(path.resolve(file), out); } catch { fs.copyFileSync(file, out); }
    return name;
  }
  const args = ["-v", "error", "-y", "-i", file, "-map", "0:v:0", "-map", "0:a:0?"];
  args.push(...(p.vcodec === "h264" ? ["-c:v", "copy"] : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p"]));
  args.push(...(p.acodec === "aac" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k"]), "-movflags", "+faststart", out);
  execFileSync("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"] });
  return name;
}

// ------------------------------------------------------------------------------------ face
// a frame of the person's video in its own pixels, with a grid, to read the face's box off for
// "face" in broll.json ("source" is the video's size)
function cmdFace(video, file, opts) {
  if (!video || !file) fail("Usage: broll.mjs face <video> <file.jpg> [--at <s>]");
  if (!fs.existsSync(video)) fail(`There is no ${video}.`);
  const p = probe(video);
  const [W, H] = [p.width, p.height];
  const at = opts.at != null ? Number(opts.at) : p.duration / 3;
  if (!Number.isFinite(at) || at < 0 || at > p.duration) fail(`--at is a second of the video, 0 to ${p.duration.toFixed(1)}.`);
  const step = 100 * Math.max(1, Math.round(Math.min(W, H) / 1080));
  const size = Math.round(26 * Math.min(W, H) / 1080);
  const frame = `scale=${W}:${H},drawgrid=w=${step}:h=${step}:t=2:c=white@0.55`;
  const label = (text, x, y) => `drawtext=text='${text}':x=${x}:y=${y}:fontsize=${size}:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4`;
  const labels = [];
  for (let x = step; x < W; x += step) labels.push(label(x, x + 6, 6));
  for (let y = step; y < H; y += step) labels.push(label(y, 6, y + 6));
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const run = (vf) => spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(at), "-i", video, "-frames:v", "1", "-vf", vf, "-q:v", "3", file], { encoding: "utf8" });
  // without a font for the labels: the grid alone
  let r = run([frame, ...labels].join(","));
  if (r.status) r = run(frame);
  if (r.status) fail(`✗ ffmpeg: ${(r.stderr || "").trim().split("\n").pop()}`);
  console.log(`${rel(file)}: the video at ${clock(at)}, ${W}×${H}, a line every ${step} px.`);
  console.log(`Read the face off it (hairline to chin, cheek to cheek: the face, not the head) and write it at the top of broll.json: "face": [x, y, width, height], "source": [${W}, ${H}].`);
}

// ----------------------------------------------------------------------------------- sheet
function cmdSheet(folder, opts) {
  if (!folder) fail("Usage: broll.mjs sheet <composition-folder> [--out sheet.jpg]");
  const comp = path.resolve(folder);
  const beatsFile = path.join(comp, ID, "beats.json");
  if (!fs.existsSync(beatsFile)) fail(`There is no b-roll in ${rel(comp)}: build it first.`);
  const { beats, duration, width, height } = read(beatsFile);
  if (!beats.length) fail("The b-roll has no beats: nothing to look at.");
  // per beat: 0.3 s before it (the face, or the beat before), its middle, 0.3 s after it
  const rows = beats.map((b) => [b.start - 0.3, (b.start + b.end) / 2, b.end + 0.3].map((t) => (t < 0 || t > duration - 0.05 ? null : +t.toFixed(3))));
  const times = [...new Set(rows.flat().filter((t) => t != null))].sort((a, b) => a - b);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "broll-sheet-"));
  try {
    const [cmd, ...pre] = hyperframes();
    const r = spawnSync(cmd, [...pre, "snapshot", comp, "--at", times.join(","), "--no-end", "--describe", "false", "-o", tmp], { encoding: "utf8", timeout: 600000 });
    const shots = fs.readdirSync(tmp).filter((f) => /\.png$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    // (fail exits at once: the frames' folder goes first)
    if (shots.length < times.length) { fs.rmSync(tmp, { recursive: true, force: true }); fail(`✗ HyperFrames took ${shots.length} of ${times.length} frames: ${(r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" ")}; the machine may be busy: try again`); }
    const at = new Map(times.map((t, k) => [t, path.join(tmp, shots[k])]));
    // tiles of 360 px on the long side, a black one where there is no frame (before the start, after the end)
    const tw = Math.round(width >= height ? 360 : (360 * width) / height / 2) * 2, th = Math.round(width >= height ? (360 * height) / width / 2 : 180) * 2;
    const inputs = [], filters = [];
    let k = 0;
    rows.forEach((row, ri) => {
      const cells = row.map((t) => {
        if (t == null) { filters.push(`color=c=black:s=${tw}x${th}:d=1[c${k}]`); return `[c${k++}]`; }
        inputs.push("-i", at.get(t));
        filters.push(`[${inputs.length / 2 - 1}:v]scale=${tw}:${th},setsar=1[c${k}]`);
        return `[c${k++}]`;
      });
      filters.push(`${cells.join("")}hstack=inputs=3,pad=iw:ih+8:0:0:white[r${ri}]`);
    });
    filters.push(rows.length > 1 ? `${rows.map((_, ri) => `[r${ri}]`).join("")}vstack=inputs=${rows.length}[out]` : `[r0]null[out]`);
    const out = path.resolve(opts.out || path.join(comp, "..", "broll-sheet.jpg"));
    execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", filters.join(";"), "-map", "[out]", "-frames:v", "1", "-q:v", "3", out], { stdio: ["ignore", "ignore", "inherit"] });
    console.log(`${rel(out)}: one row per beat, left 0.3 s before it, the middle, right 0.3 s after it (black: before the start or after the end):`);
    beats.forEach((b, ri) => console.log(`  row ${ri + 1}: beat ${b.n}, ${clock(b.start)}–${clock(b.end)}, ${b.number ? `number "${b.number}"` : `${b.show}, ${b.fit}`}`));
    console.log(`Look at every row: the middle shows the thing the words name, whole where it must be, nothing of it under the captions or the apps' buttons; no watermark, no burned-in subtitles, no stranger's name; left and right the face (or the next beat), never a sliver of it.`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// -------------------------------------------------------------------------------------- main
const [command, ...rest] = process.argv.slice(2);
const [pos, opts] = parse(rest);
try {
  if (command === "words") await cmdWords(pos[0], pos[1]);
  else if (command === "brief") cmdBrief(pos[0], pos[1], pos.slice(2), opts);
  else if (command === "shot") cmdShot(pos[0], pos[1], opts);
  else if (command === "build") cmdBuild(pos[0], pos[1], pos[2], opts);
  else if (command === "project") cmdProject(pos[0], pos[1], pos[2], pos[3], opts);
  else if (command === "sheet") cmdSheet(pos[0], opts);
  else if (command === "face") cmdFace(pos[0], pos[1], opts);
  else fail("Usage: broll.mjs words <video> <dir> | brief <words.json> <dir> [<material> …] | shot <url> <file.png> | build <broll.json> <words.json> <folder> | project <video> <broll.json> <words.json> <composition> | sheet <composition> | face <video> <file.jpg>   (options: see the head of this file)");
} catch (e) {
  fail(`✗ ${e.message}`);
}
