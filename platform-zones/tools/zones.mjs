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
//   node tools/zones.mjs layout <page.html|boxes.json> [platform…]   what is wrong with how a frame
//                                                      is laid out: text under the buttons, text on
//                                                      text or on a face, stickers on each other, …
//
// The frame: --size 1080x1920, --frame 9:16 (1080 px on the short side) or --of <video|image> (its
// size); without them the first platform named brings its first frame. --at <s>: draw's moment in a video.
// --json: everything as JSON, in px of the frame.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { PLATFORMS, DEFAULTS, CHECKED } from "./lib/platforms.mjs";
import { zonesFor, check, resolve } from "./lib/zones.mjs";
import { checkLayout } from "./lib/layout.mjs";

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

// The machine's Chrome: CHROME, else the usual names on the PATH, else one puppeteer downloaded
const CHROMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"];
function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const dir of (process.env.PATH || "").split(path.delimiter)) for (const n of CHROMES) if (fs.existsSync(path.join(dir, n))) return path.join(dir, n);
  for (const kind of ["chrome-headless-shell", "chrome"]) {
    const base = path.join(os.homedir(), ".cache", "puppeteer", kind);
    for (const v of fs.existsSync(base) ? fs.readdirSync(base).sort().reverse() : []) {
      for (const p of [path.join(base, v, "chrome-headless-shell-linux64", "chrome-headless-shell"), path.join(base, v, "chrome-linux64", "chrome")]) if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

// a page measured in headless Chrome by tools/measure.js: a copy of it beside it (so that its
// relative links still work) with the script at its end, the result read from the DOM Chrome dumps
function measurePage(file, opts) {
  if (!fs.existsSync(file)) fail(`There is no ${file}.`);
  const chrome = chromePath();
  if (!chrome) fail("Measuring a page needs Chrome: set CHROME=/path/to/chrome, or measure in your own page with tools/measure.js and pass the boxes.json.");
  const html = fs.readFileSync(file, "utf8");
  // the window: --size, else the root's data-width and data-height (in either order), else 9:16
  const root = html.match(/<[^>]*data-composition-id=[^>]*>/)?.[0] || "";
  const attr = (name) => Number(root.match(new RegExp(`${name}="(\\d+)"`))?.[1]) || 0;
  let size = [attr("data-width"), attr("data-height")];
  if (opts.size) {
    const m = String(opts.size).match(/^(\d+)x(\d+)$/);
    if (!m || !+m[1] || !+m[2]) fail(`--size is width x height, as 1080x1920.`);
    size = [+m[1], +m[2]];
  } else if (!size[0] || !size[1]) size = [1080, 1920];
  const measure = fs.readFileSync(new URL("./measure.js", import.meta.url), "utf8");
  const tail = `<script>${measure}</script><script>platformZonesMeasure().then((r) => { const s = document.createElement("script"); s.type = "application/json"; s.id = "platform-zones-boxes"; s.textContent = JSON.stringify(r).replace(/</g, "\\\\u003c"); document.body.append(s); });</script>`;
  const tmp = path.join(path.dirname(path.resolve(file)), `.platform-zones-${process.pid}.html`);
  try { fs.writeFileSync(tmp, /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${tail}</body>`) : html + tail); }
  catch (e) { fail(`Measuring ${file} needs a copy of it beside it, and its folder cannot be written (${e.code}): copy the page with what it links to into a folder of yours.`); }
  // Chrome puts a socket into TMPDIR, at most 107 bytes long: a deep TMPDIR gets the system's
  const env = (process.env.TMPDIR || "/tmp").length > 60 ? { ...process.env, TMPDIR: "/tmp" } : process.env;
  // the window is larger than the page it shows by Chrome's own bars: measured once, then the
  // window that gives the page the frame's size
  const dump = (w, h) => {
    const r = spawnSync(chrome, ["--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--allow-file-access-from-files", `--window-size=${w},${h}`, "--virtual-time-budget=15000", "--dump-dom", pathToFileURL(tmp).href], { encoding: "utf8", env, timeout: 90e3, maxBuffer: 256 << 20 });
    const m = (r.stdout || "").match(/<script type="application\/json" id="platform-zones-boxes">([\s\S]*?)<\/script>/);
    if (!m) throw new Error(`Chrome could not measure ${file}${r.error?.code === "ETIMEDOUT" ? ": it ran for 90 seconds" : ""}: open it in a browser and look for a script error.`);
    return JSON.parse(m[1]);
  };
  let got;
  try {
    got = dump(size[0], size[1]);
    const [vw, vh] = got.viewport || size;
    if (vw !== size[0] || vh !== size[1]) got = dump(size[0] * 2 - vw, size[1] * 2 - vh);
  } catch (e) { got = e; } finally { fs.rmSync(tmp, { force: true }); }
  if (got instanceof Error) fail(got.message);
  return got;
}

function cmdLayout([input, ...ids], opts) {
  if (!input) fail(`${self()} layout <page.html|boxes.json> [platform…]`);
  const m = /\.json$/i.test(input) ? JSON.parse(fs.readFileSync(input, "utf8")) : measurePage(input, opts);
  if (!m.size || !Array.isArray(m.boxes)) fail(`${input} has no size and boxes: tools/measure.js makes them.`);
  if (!(m.size[0] > 0 && m.size[1] > 0)) fail(`${input}: the frame measured ${m.size.join("×")}: give the page's frame a size (an <insta-story>, an element with data-composition-id, data-width and data-height, or a body as large as the window).`);
  // a page that is a Storrito story is a Story, unless platforms are named
  const story = m.story || /<insta-story[\s>]/.test(/\.html?$/i.test(input) ? fs.readFileSync(input, "utf8") : "");
  for (const id of ids) if (!resolve(id)) fail(`There is no platform "${id}": ${PLATFORMS.map((q) => q.id).join(", ")} (${self()} list).`);
  let z;
  try { z = zonesFor(ids.length ? ids : story ? ["instagram-story"] : [], m.size[0], m.size[1]); } catch (e) { fail(e.message); }
  const onStory = z.platforms.every((p) => /story/.test(p.id));
  const found = checkLayout(z, m.boxes, { story: onStory });
  if (opts.json) return console.log(JSON.stringify({ frame: z.frame, size: z.size, platforms: z.platforms, fallback: z.fallback, findings: found, boxes: m.boxes }, null, 2));
  const count = (k) => m.boxes.filter((b) => b.kind === k).length;
  const who = z.platforms.map((p) => p.name).join(", ");
  console.log(`${input}: ${z.frame} ${z.size.join("×")} for ${who}${z.fallback ? " (no platform named: the usual ones of this frame)" : ""}; ${count("text")} texts, ${count("sticker")} stickers, ${count("face")} faces`);
  if (!found.length) console.log(`  ✓ nothing under the apps' buttons, nothing on top of each other, text centred on the frame`);
  for (const f of found) console.log(`  ${f.level} ${f.kind === "text" ? `"${f.label}"` : f.label} at ${box(f.box)}: ${f.what}`);
  const bad = found.filter((f) => f.level === "✗").length;
  if (bad) { console.log(`\n${bad} ✗ to fix, then check again.${found.length > bad ? " A ! may stay when the layout needs it." : ""}`); process.exitCode = 1; }
  else if (found.length) console.log(`\nNo ✗. A ! may stay when the layout needs it; pull it in when it costs nothing.`);
  if (!count("face")) console.log(`Faces it cannot see: mark them with data-zone="face", or look at the frame with ${self()} draw.`);
}

const [cmd, ...rest] = process.argv.slice(2);
const [pos, opts] = parse(rest);
if (cmd === "list") cmdList(opts);
else if (cmd === "zones") cmdZones(pos, opts);
else if (cmd === "check") cmdCheck(pos, opts);
else if (cmd === "draw") cmdDraw(pos, opts);
else if (cmd === "layout") cmdLayout(pos, opts);
else fail(`${self()} list | zones [platform…] | check <x,y,w,h> [platform…] | draw <image|video> <out.png> [platform…] | layout <page.html|boxes.json> [platform…]   (--size 1080x1920 | --frame 9:16 | --of <file>) [--json]`);
