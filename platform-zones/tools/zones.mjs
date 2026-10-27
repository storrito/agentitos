#!/usr/bin/env node
// Where the platforms lay their buttons, names and captions over a video, per frame: the box that
// stays clear (for text, faces, the thing being shown), what each app covers, and where it shows
// the video cut to another ratio. For agents, and for other skills that place things in a frame
// (captions, screencast-cut, kinetic-lyrics, story-from-link): they call it and read its JSON.
//
//   node tools/zones.mjs list                          the platforms, their frames and how sure the
//                                                      numbers are; what stands in when none is named
//   node tools/zones.mjs zones [platform…]             the zones on a frame: one platform, several
//                                                      (all clear on each), or none (the frame's
//                                                      usual platforms together)
//   node tools/zones.mjs check <x,y,w,h> [platform…]   what of a box is covered, outside the safe
//                                                      box, or cut away in a feed
//   node tools/zones.mjs draw <image|video> <out.png> [platform…]   a frame with the zones drawn on
//
// The frame: --size 1080x1920, --frame 9:16 (1080 px on the short side) or --of <video|image> (its
// size); without them the first platform named brings its first frame. --at <s>: draw's moment in a video.
// --json: everything as JSON, in px of the frame.

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { PLATFORMS, DEFAULTS, CHECKED } from "./lib/platforms.mjs";
import { zonesFor, check, resolve } from "./lib/zones.mjs";

const fail = (msg) => { console.error(msg); process.exit(1); };
const rel = (p) => path.relative(process.cwd(), p) || ".";
const self = () => (rel(process.argv[1]).startsWith("..") ? process.argv[1] : rel(process.argv[1]));

// options that take no value: a platform or a box after them stays a platform or a box
const FLAGS = ["json"];

function parse(args) {
  const pos = [], opts = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i].slice(2);
    if (args[i].startsWith("--")) opts[key] = FLAGS.includes(key) || args[i + 1]?.startsWith("--") || args[i + 1] === undefined ? true : args[++i];
    else pos.push(args[i]);
  }
  return [pos, opts];
}

function probe(file) {
  if (!fs.existsSync(file)) fail(`There is no ${file}.`);
  let out;
  try { out = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", file], { stdio: ["ignore", "pipe", "pipe"] }).toString()); }
  catch { fail(`${file} is no video or image ffprobe can read.`); }
  const v = out.streams.find((s) => s.codec_type === "video");
  if (!v) fail(`${file} has no picture.`);
  const turned = Math.abs(Number(v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0)) % 180 === 90;
  return turned ? [v.height, v.width] : [v.width, v.height];
}

// the frame's size from the options, else from the first platform named
function sizeOf(opts, ids) {
  for (const id of ids) if (!resolve(id)) fail(`There is no platform "${id}": ${PLATFORMS.map((q) => q.id).join(", ")} (${self()} list).`);
  if (opts.of) return probe(opts.of);
  if (opts.size) {
    const m = String(opts.size).match(/^(\d+)x(\d+)$/);
    if (!m || !+m[1] || !+m[2]) fail(`--size is width x height, as 1080x1920.`);
    return [+m[1], +m[2]];
  }
  let frame = opts.frame;
  if (!frame && ids.length) frame = Object.keys(resolve(ids[0])?.frames || {})[0];
  if (!frame) fail(`Which frame? --size 1080x1920, --frame 9:16 or --of <video>; or name a platform (${self()} list).`);
  const m = String(frame).match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!m || !+m[1] || !+m[2]) fail(`--frame is a ratio, as 9:16.`);
  const r = m[1] / m[2];
  return r < 1 ? [1080, Math.round(1080 / r)] : [Math.round(1080 * r), 1080];
}

const box = (b) => `x ${b[0]}–${b[0] + b[2]}, y ${b[1]}–${b[1] + b[3]} (${b[2]}×${b[3]})`;
const pct = (v) => `${Math.round(v * 100)} %`;
const BASIS = { official: "the platform's own numbers", ads: "the platform's numbers for ads", guides: "third-party guides", estimate: "an estimate from the app's layout" };

function cmdList(opts) {
  if (opts.json) return console.log(JSON.stringify({ checked: CHECKED, platforms: PLATFORMS, defaults: DEFAULTS }, null, 2));
  console.log(`The platforms (numbers compared ${CHECKED}):`);
  for (const p of PLATFORMS) {
    const frames = Object.entries(p.frames).map(([f, e]) => `${f} (${e.basis})`).join(", ");
    console.log(`  ${p.id.padEnd(19)} ${p.name}: ${frames}${p.aliases?.length ? `   also: ${p.aliases.join(", ")}` : ""}`);
  }
  console.log(`\nWhen the person did not say where the video goes, a frame's usual platforms stand in, all together:`);
  for (const [f, ids] of Object.entries(DEFAULTS)) console.log(`  ${f.padEnd(5)} ${ids.join(", ")}`);
  console.log(`  other: the nearest of these within 15 % (3:4 as 4:5, 9:19.5 as 9:16), else the broadcast border with room for a player's controls`);
  console.log(`\nBasis: official = ${BASIS.official}; ads = ${BASIS.ads}, with room for the ad's button; guides = ${BASIS.guides}; estimate = ${BASIS.estimate}.`);
}

function print(z) {
  const [w, h] = z.size;
  const who = z.platforms.map((p) => p.name + (p.standIn ? " (standing in)" : "")).join(", ");
  console.log(`${z.frame}, ${w}×${h}: ${z.fallback ? `no platform named, so the usual ones for this frame together: ${who}` : who}`);
  console.log(`  safe     ${box(z.safe)}: text, faces and what is shown stay inside`);
  console.log(`           margins top ${z.margins.top}, bottom ${z.margins.bottom}, left ${z.margins.left}, right ${z.margins.right}`);
  console.log(`  centred  ${box(z.centred)}: the safe box even about the frame's middle, for text centred on the frame`);
  if (z.wide) console.log(`  wide     ${box(z.wide)}: clear across the frame above the buttons on the right`);
  const [cx, cy, cw, ch] = z.centred;
  console.log(`  captions the lowest line ends at y ${cy + ch}, centred on x ${Math.round(cx + cw / 2)}, at most ${cw} wide`);
  for (const c of z.covers) console.log(`  covered  ${box(c.box)}  ${c.what} (${c.platform})`);
  for (const c of z.crops) console.log(`  cropped  ${box(c.box)}  ${c.where} shows ${c.ratio} (${c.platform}): what must be seen there stays inside`);
  const bases = [...new Set(z.platforms.map((p) => BASIS[p.basis]))];
  console.log(`  basis    ${bases.join("; ")}`);
  for (const n of z.notes) console.log(`  note     ${n}`);
  console.log(`  sources  ${z.sources.length} (--json lists them)`);
}

function zonesOf(ids, opts) {
  const [w, h] = sizeOf(opts, ids);
  try { return zonesFor(ids, w, h); } catch (e) { fail(e.message); }
}

function cmdZones(ids, opts) {
  const z = zonesOf(ids, opts);
  if (opts.json) return console.log(JSON.stringify(z, null, 2));
  print(z);
}

function cmdCheck([spec, ...ids], opts) {
  const b = String(spec || "").split(",").map(Number);
  if (b.length !== 4 || b.some((v) => !Number.isFinite(v)) || b[2] <= 0 || b[3] <= 0) fail(`The box is x,y,w,h in px of the frame, as 60,300,960,540.`);
  const z = zonesOf(ids, opts);
  const r = check(z, b);
  if (opts.json) return console.log(JSON.stringify({ ...r, safe: z.safe, centred: z.centred, wide: z.wide, frame: z.frame, size: z.size, fallback: z.fallback, platforms: z.platforms, notes: z.notes }, null, 2));
  console.log(`${box(b)} on ${z.frame} ${z.size.join("×")} (${z.platforms.map((p) => p.name).join(", ")}):`);
  if (r.inside && !r.covered.length && !r.cut.length && !r.offFrame) return console.log(`  ✓ clear: inside ${r.inWide ? `the wide stretch ${box(z.wide)}` : `the safe box ${box(z.safe)}`}`);
  if (r.offFrame > 0.001) console.log(`  ✗ ${pct(r.offFrame)} outside the frame`);
  const out = Object.entries(r.outside).map(([k, v]) => `${v} px past the ${k}`).join(", ");
  if (r.inWide) console.log(`  ✓ inside the wide stretch ${box(z.wide)}, above the buttons on the right`);
  else if (out) console.log(`  ! leaves the safe box ${box(z.safe)}: ${out}${r.covered.length ? "" : ", into the margin the guides keep; no app lays anything there"}`);
  for (const c of r.covered) console.log(`  ✗ ${pct(c.share)} under ${c.what} (${c.platform})`);
  for (const c of r.cut) console.log(`  ! ${pct(c.share)} cut away where ${c.where} shows ${c.ratio} (${c.platform})`);
}

function cmdDraw([input, out, ...ids], opts) {
  if (!input || !out) fail(`${self()} draw <image|video> <out.png> [platform…]`);
  const [w, h] = probe(input);
  const z = zonesOf(ids, { ...opts, size: `${w}x${h}`, of: undefined });
  const t = Math.max(2, Math.round(Math.min(w, h) / 270));
  const boxes = [
    ...z.covers.map((c) => `drawbox=x=${c.box[0]}:y=${c.box[1]}:w=${c.box[2]}:h=${c.box[3]}:color=red@0.3:t=fill`),
    ...z.crops.map((c) => `drawbox=x=${c.box[0]}:y=${c.box[1]}:w=${c.box[2]}:h=${c.box[3]}:color=yellow@0.9:t=${t}`),
    `drawbox=x=${z.safe[0]}:y=${z.safe[1]}:w=${z.safe[2]}:h=${z.safe[3]}:color=lime@0.95:t=${t}`,
  ];
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  // no picture of an earlier run passes for this one's
  fs.rmSync(out, { force: true });
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...(opts.at ? ["-ss", String(opts.at)] : []), "-i", input, "-frames:v", "1", "-vf", boxes.join(","), "-update", "1", out], { encoding: "utf8" });
  if (r.status !== 0 || !fs.existsSync(out)) fail(`ffmpeg could not draw the zones: ${(r.stderr || "").trim().split("\n").slice(-2).join(" ") || (opts.at ? `there is no picture at ${opts.at} s` : "it wrote no picture")}`);
  console.log(`${out}: red what the apps cover, green the safe box${z.crops.length ? ", yellow where a feed or grid cuts the video" : ""}. Look at it.`);
  print(z);
}

const [cmd, ...rest] = process.argv.slice(2);
const [pos, opts] = parse(rest);
if (cmd === "list") cmdList(opts);
else if (cmd === "zones") cmdZones(pos, opts);
else if (cmd === "check") cmdCheck(pos, opts);
else if (cmd === "draw") cmdDraw(pos, opts);
else fail(`${self()} list | zones [platform…] | check <x,y,w,h> [platform…] | draw <image|video> <out.png> [platform…]   (--size 1080x1920 | --frame 9:16 | --of <file>) [--json]`);
