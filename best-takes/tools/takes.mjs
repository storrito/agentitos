#!/usr/bin/env node
// The best takes of one or more videos, without slips, at one level: step by step, in one folder.
// Made for agents: each step prints what to do next.
//
//   node tools/takes.mjs new <dir> <video> [<video> …]   the videos into <dir>/source/, in the order
//                                         they were recorded: their words ("äh" included), their
//                                         level; writes source/brief.md
//   node tools/takes.mjs propose <dir>    a model watches the videos and proposes the keeps:
//                                         <dir>/proposal.json, in the format of cut.json
//   node tools/takes.mjs build <dir>      cut.json → the cut as a HyperFrames project (a preview,
//                                         nothing rendered yet) and <dir>/edit.json
//   node tools/takes.mjs check <dir>      the cut as text, what it leaves out, the levels, problems
//   node tools/takes.mjs finish <dir> <video.mp4>  the rendered video (rragent's render tool) brought
//                                         to the final loudness; subtitles beside it (<video>.srt)
//   node tools/takes.mjs captions <dir> --style hormozi   captions in the picture (agentitos'
//                                         captions skill): a model marks the key words, cut.json
//                                         keeps the style and the marks, every build mounts them;
//                                         --off takes them out again
//   node tools/takes.mjs broll <dir> <broll.json>   b-roll over the cut (agentitos' b-roll skill):
//                                         cut.json keeps the file, every build mounts it under the
//                                         captions; --off takes it out again
//
// Options, kept in source/settings.json for the next steps:
//   --out <folder>     the composition/ folder of the HyperFrames project the preview shows
//                      (rragent: artifacts/<name>/composition; default <dir>/composition)
//   --title "…"        the preview's title          --lang de    the language of the words
//   --aspect source|9:16|16:9|1:1|4:5    the frame (default: the first video's)
//   --platform reels,tiktok    where the video goes: its captions keep clear of what those apps lay
//                              over it (agentitos' platform-zones); none: the usual ones of the frame
//   --fit cover|contain    a video of another shape fills the frame, or fits into it
//   --target <s>       the longest the cut should be (the brief and the check use it)
//   --pause <s>        pauses longer than this inside a keep are shortened (default 1, tight 0.4)
//   --pauses picture|tight    a pause follows its picture (default: where it moves clearly more
//                      than while speaking it stays, muted, or plays faster; else it goes), or
//                      every pause over --pause goes, whatever the picture shows (tight: a clip
//                      for a reel)
//   --punch on|off     a jump cut inside a take goes in closer, or back out (default off): the
//                      cut looks meant, and a key word of the captions lands closer; never where
//                      source/still.json names the picture as one to leave whole
//                      ({"01.mp4": [[from, to], …]}, seconds of that video)
//   --hook "…"         a card over the start that says what the viewer gets (6 words or fewer,
//                      one *word* in the brand's colour), until the first sentence ends;
//                      --hook "" takes it out
//   --brand <DESIGN.md>    the brand's colour and font for the hook (the captions take theirs
//                      with the captions command)
//   --loudness <LUFS>  of the rendered video (default −14, as Instagram, TikTok and YouTube play it)
//   --fps <n>          frames a second of the rendered video (default 30)
//   --order recorded|given    the videos by their recording time (default, when all have one)
//                      or as given
//   --model <id>       the OpenRouter model of propose (default google/gemini-4-argon)

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { probe, playable, samples, hyperframes, clock } from "./lib/media.mjs";
import { transcribeFile, transcribeTool, NEEDS_TRANSCRIBE } from "./lib/transcribe.mjs";
import { voiceTrack } from "./lib/tracks.mjs";
import { envelope, threshold, retime, ghosts, loudnessBlocks, loudness, HOP } from "./lib/voice.mjs";
import { plan, range } from "./lib/cut.mjs";
import { activity } from "./lib/motion.mjs";
import { writeComposition } from "./lib/composition.mjs";
import { propose, PROPOSE_MODEL } from "./lib/propose.mjs";
import { openrouter } from "./lib/openrouter.mjs";
import { zones, platformList } from "./lib/zones.mjs";
import { hookCard, hookUntil, brandOf } from "./lib/hook.mjs";
import { readFaces, facesAt, toFrame, punchPlan, textOnFaces } from "./lib/faces.mjs";
import { pieceSpan, clockOf, covering, whole, takeKind, pictureRule, inFrame, faceTrack, facesFault, rankPictures, knownSeconds, shotsInput, hookSpan, toCut, inkOf, groundStill, placedSheet, framingTool, layoutTool } from "./lib/place.mjs";
import { brief, shown, overTarget } from "./brief.mjs";

const VALUED = ["out", "title", "lang", "aspect", "fit", "target", "pause", "pauses", "punch", "hook", "loudness", "fps", "order", "model", "style", "product", "brand", "platform",
  // faces and place (kept in place.json, not in the settings)
  "eye", "grid-at", "picture", "raise", "caption-y", "font-size", "lines", "lift", "hook-kind"];
const FLAGS = ["off", "grid", "again"];
// given more than once: each value kept
const MANY = ["eye", "grid-at", "picture", "lift"];
const NUMBERS = ["target", "pause", "loudness", "fps"];
const TAKE_LEVEL = -14; // each take before the bus; finish brings the rendered whole to --loudness
const TIGHT = 0.4; // --pauses tight: every pause over this goes

function fail(message) {
  console.log(message);
  process.exit(1);
}

function parse(args) {
  const pos = [], opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const k = a.slice(2);
    if (FLAGS.includes(k)) { opts[k] = true; continue; }
    if (!VALUED.includes(k)) fail(`Unknown option ${a}. Options: ${[...VALUED, ...FLAGS].map((o) => "--" + o).join(" ")}`);
    if (i + 1 >= args.length) fail(`${a} needs a value.`);
    if (MANY.includes(k)) { const v = String(args[++i]); (opts[k] ||= []).push(...(v === "" ? [""] : v.split(/\s+/).filter(Boolean))); continue; }
    opts[k] = NUMBERS.includes(k) ? Number(args[++i]) : String(args[++i]);
    if (NUMBERS.includes(k) && !Number.isFinite(opts[k])) fail(`${a} needs a number.`);
  }
  return [pos, opts];
}

const source = (dir, file = "") => path.join(dir, "source", file);
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const rel = (p) => path.relative(process.cwd(), p) || ".";
// this tool as the next command line should name it
const self = () => (rel(process.argv[1]).startsWith("..") ? process.argv[1] : rel(process.argv[1]));

function settings(dir, opts) {
  const file = source(dir, "settings.json");
  const kept = fs.existsSync(file) ? read(file) : {};
  const merged = { aspect: "source", fit: "cover", pauses: "picture", loudness: -14, fps: 30, ...kept, ...opts };
  if (!["picture", "tight"].includes(merged.pauses)) fail("--pauses is picture or tight.");
  if (merged.punch !== undefined && !["on", "off"].includes(merged.punch)) fail("--punch is on or off.");
  // where the video goes, for its captions: a platform platform-zones does not know is not kept,
  // every later build would fail on it
  if (opts.platform) try { zones(1080, 1920, platformList(merged.platform)); } catch (e) { fail(`✗ --platform: ${e.message}`); }
  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + "\n");
  // the pause from which a pause is cut: as given, else 1 s (picture) or TIGHT
  return { ...merged, pause: merged.pause ?? (merged.pauses === "tight" ? TIGHT : 1), final: merged.loudness, loudness: TAKE_LEVEL };
}

// how close each piece is: at a jump cut inside a take (the same video, a stretch left out) the
// picture goes in by PUNCH or back out, in when the piece holds a key word of the captions; a
// piece that follows on without a cut keeps the one before; a picture to leave whole stays out
const PUNCH = 1.12;
function punches(pieces, { highlight = [], still = {}, clips }) {
  const keys = new Set(highlight);
  let prev = null, scale = 1;
  return pieces.map((p) => {
    const whole = (still[clips[p.clip].file] || []).some(([a, b]) => p.in < b && p.out > a);
    if (whole || p.mute || !p.words.length) { prev = p; scale = 1; return 1; }
    const jump = prev && prev.clip === p.clip && !prev.mute && p.in - prev.out > 0.01;
    if (jump) scale = p.words.some((i) => keys.has(i)) ? PUNCH : scale === 1 ? PUNCH : 1;
    else if (!prev || prev.clip !== p.clip) scale = 1;
    prev = p;
    return scale;
  });
}

// ------------------------------------------------------------------------------------- new
async function cmdNew(dir, files, opts) {
  if (!dir || !files.length) fail("Usage: takes.mjs new <dir> <video> [<video> …]");
  if (fs.existsSync(source(dir, "words.json"))) fail(`${rel(source(dir))} is in use already. To start over: rm -r ${rel(source(dir))}`);
  for (const f of files) if (!fs.existsSync(f)) fail(`There is no ${f}.`);
  if (!transcribeTool()) fail(NEEDS_TRANSCRIBE);
  if (!(await openrouter())) fail("This tool needs OpenRouter (the words come from ElevenLabs Scribe, the proposal from Gemini): OPENROUTER_API_KEY in the environment, or on a Sprite the gateway's OpenRouter connection.");
  fs.mkdirSync(source(dir), { recursive: true });
  // the options first: a wrong one fails before anything is paid for
  settings(dir, opts);

  let list = files.map((f) => ({ from: f, ...probe(f) }));
  const byTime = list.every((c) => c.created) && opts.order !== "given";
  if (byTime) list = [...list].sort((a, b) => Date.parse(a.created) - Date.parse(b.created));
  if (list.length > 1) console.log(`${list.length} videos, ${byTime ? "in the order they were recorded" : "in the order given"}: ${list.map((c) => c.from).join(", ")}`);

  const clips = {}, words = [];
  let asr = null;
  for (const [k, c] of list.entries()) {
    const n = k + 1, name = `${String(n).padStart(2, "0")}.mp4`, file = source(dir, name);
    const how = playable(c.from, file);
    const p = probe(file);
    console.log(`video ${n}: ${c.from} (${clock(p.duration, false)}, ${p.width}×${p.height}${how.startsWith("transcoded") ? `, ${how} to H.264` : ""}) – listening …`);
    const env = envelope(samples(file));
    fs.writeFileSync(source(dir, `${String(n).padStart(2, "0")}.env`), Buffer.from(env.buffer));
    let heard, edges;
    try { ({ words: heard, model: asr, edges } = await transcribeFile(file, { log: console.log })); } catch (e) { fail(e.message); }
    // words whose times the transcribe skill has set by the sound (edges: "sound") are not timed a second time
    const moved = edges === "sound" ? 0 : retime(heard, env, threshold(env));
    if (moved) console.log(`  ${moved} word timings set by the sound (the recognizer had them squeezed or stretched)`);
    const { kept: said, runs } = ghosts(heard);
    for (const r of runs) console.log(`  left out, the voice has no time for them (the recognizer wrote them twice): ${r}`);
    const blocks = loudnessBlocks(file);
    fs.writeFileSync(source(dir, `${String(n).padStart(2, "0")}.loudness.json`), JSON.stringify(blocks));
    const speech = said.filter((w) => w.kind === "word");
    const level = loudness(blocks, speech.length ? speech.map((w) => [w.start, w.end]) : [[0, p.duration]]);
    clips[n] = { n, file: name, from: c.from, duration: p.duration, width: p.width, height: p.height, fps: p.fps, created: c.created, lufs: level };
    const items = said.sort((a, b) => a.start - b.start);
    for (const w of items) words.push({ i: words.length, clip: n, ...w });
    const fillers = items.filter((w) => w.kind === "filler").length;
    console.log(`  ${speech.length} words, ${fillers} "äh"s and the like, speech at ${level ?? "?"} LUFS`);
  }
  if (!words.some((w) => w.kind === "word")) fail("No speech found in the videos: this tool cuts by what is said.");

  fs.writeFileSync(source(dir, "words.json"), JSON.stringify({ asr, clips, words }, null, 1));
  const s = settings(dir, opts);
  fs.writeFileSync(source(dir, "brief.md"), brief(clips, words, s));
  const levels = Object.values(clips).map((c) => c.lufs).filter((l) => l != null);
  if (levels.length > 1) console.log(`The videos' levels: ${levels.join(", ")} LUFS (${(Math.max(...levels) - Math.min(...levels)).toFixed(1)} dB apart); the build evens them out.`);
  console.log(`\nNext: node ${self()} propose ${rel(dir)}, then read ${rel(source(dir, "brief.md"))} (all of it), write ${rel(path.join(dir, "cut.json"))}, then: node ${self()} build ${rel(dir)}`);
}

// --------------------------------------------------------------------------------- propose
async function cmdPropose(dir, opts) {
  if (!fs.existsSync(source(dir, "words.json"))) fail(`Run first: takes.mjs new ${rel(dir)} <video>`);
  if (!(await openrouter())) fail("propose needs OpenRouter: OPENROUTER_API_KEY, or on a Sprite the gateway's OpenRouter connection.");
  const s = settings(dir, opts);
  const { clips, words } = read(source(dir, "words.json"));
  let p;
  try { p = await propose(dir, clips, words, s, { model: s.model || PROPOSE_MODEL, log: console.log }); } catch (e) { fail(`✗ ${e.message}`); }
  const file = path.join(dir, "proposal.json");
  fs.writeFileSync(file, JSON.stringify(p, null, 1) + "\n");
  const text = (r) => {
    const [a, b] = range(r) || [];
    return a == null ? r : words.slice(a, b + 1).filter((w) => w.kind === "word").map((w) => w.text).join(" ");
  };
  const short = (t) => (t.length > 110 ? `${t.slice(0, 60)} … ${t.slice(-45)}` : t);
  console.log(`${p.model}, $${p.cost.toFixed(4)}\n\nKeep:`);
  for (const k of p.keep) console.log(`  [${k.words}]${k.pauses ? " (pauses stay)" : ""} ${short(text(k.words))}\n      ${k.why}`);
  if (p.retries.length) console.log("\nRetries left out:");
  for (const r of p.retries) console.log(`  [${r.dropped}] "${short(text(r.dropped))}" → [${r.kept}]: ${r.why}`);
  if (p.visual.length) console.log("\nShown in the picture:");
  for (const v of p.visual) console.log(`  [${v.words}] ${v.what}`);
  console.log(`\nNext: read ${rel(source(dir, "brief.md"))}, hold the proposal against its rules and the words, write ${rel(path.join(dir, "cut.json"))} (take the proposal, or change it), then build.`);
}

// ----------------------------------------------------------------------------------- build
function size(s, clip) {
  const fixed = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080], "4:5": [1080, 1350] };
  if (fixed[s.aspect]) return fixed[s.aspect];
  if (s.aspect !== "source") fail(`--aspect is source, ${Object.keys(fixed).join(", ")}`);
  const scale = Math.min(1, 1920 / Math.max(clip.width, clip.height));
  const even = (x) => Math.max(2, Math.round((x * scale) / 2) * 2);
  return [even(clip.width), even(clip.height)];
}

function voicesOf(dir, clips) {
  const voices = {};
  for (const c of Object.values(clips)) {
    const k = String(c.n).padStart(2, "0");
    const raw = fs.readFileSync(source(dir, `${k}.env`));
    const env = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    voices[c.n] = { env, thr: threshold(env), blocks: read(source(dir, `${k}.loudness.json`)), duration: c.duration };
  }
  return voices;
}

// The captions skill of agentitos: CAPTIONS_TOOL, else beside this skill (a checkout of the
// collection), else in the machine's clone of the skills.
function captionsTool() {
  const skill = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const candidates = [process.env.CAPTIONS_TOOL, path.join(skill, "..", "captions", "tools", "captions.mjs"), "/home/sprite/skills/captions/tools/captions.mjs"];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

// The b-roll skill of agentitos: BROLL_TOOL, else beside this skill, else in the machine's clone.
function brollTool() {
  const skill = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const candidates = [process.env.BROLL_TOOL, path.join(skill, "..", "b-roll", "tools", "broll.mjs"), "/home/sprite/skills/b-roll/tools/broll.mjs"];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

// The cut's words for the captions skill, timed in the cut, the marked ones standing out.
function captionWords(dir, words, captions, { width, height, duration }) {
  const keys = new Set(captions.highlight || []);
  const file = path.join(dir, "captions.json");
  fs.writeFileSync(file, JSON.stringify({ width, height, duration,
    words: words.map((w) => ({ i: w.i, text: w.text, start: w.start, end: w.end, ...(keys.has(w.i) ? { highlight: true } : {}) })) }, null, 1));
  return file;
}

function runCaptions(args) {
  const tool = captionsTool();
  if (!tool) fail("✗ The captions need agentitos' captions skill beside this one (or CAPTIONS_TOOL naming its tools/captions.mjs).");
  const r = spawnSync(process.execPath, [tool, ...args], { encoding: "utf8" });
  if (r.status) fail(`✗ captions: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

// The captions' area as the built sub-composition sets it (its DATA): the lowest line's end, the
// width, the type and the lines, a style's box around them; and when each group shows
function captionArea(file, height) {
  try {
    const html = fs.readFileSync(file, "utf8");
    const d = JSON.parse(html.match(/var DATA = (\{[\s\S]*?\});\n/)[1]);
    const lh = d.look?.lineHeight || 1.2, pad = d.look?.box ? 0.44 * d.size : 0;
    // the ink below the lowest line: half the outline and the shadow's drop, at the type's size
    const em = d.size / (d.look?.size || d.size), drop = Math.max(0, ...[...String(d.look?.shadow || "").matchAll(/(?:^|,)\s*-?[\d.]+(?:px)?\s+(-?[\d.]+)px/g)].map((m) => Number(m[1])));
    const below = d.look?.box ? 0 : ((d.look?.stroke || 0) / 2 + drop) * em;
    const bottom = height - d.bottom, h = d.lines * d.size * lh + pad;
    return { area: [d.left, +(bottom - h).toFixed(1), d.maxWidth, +(h + below).toFixed(1)], groups: d.groups.map((g) => [g.start, g.end]) };
  } catch { return { area: null, groups: [] }; }
}

function cmdBuild(dir, opts) {
  if (!fs.existsSync(source(dir, "words.json"))) fail(`Run first: takes.mjs new ${rel(dir)} <video>`);
  const cutFile = path.join(dir, "cut.json");
  if (!fs.existsSync(cutFile)) fail(`Write ${rel(cutFile)} first, as ${rel(source(dir, "brief.md"))} says.`);
  let cut;
  try { cut = read(cutFile); } catch (e) { fail(`✗ ${rel(cutFile)} is no valid JSON: ${e.message}`); }
  const s = settings(dir, opts);
  const { clips, words } = read(source(dir, "words.json"));
  // how much the picture moves in a stretch, measured in the video itself; tight: not needed
  const tight = s.pauses === "tight";
  const motion = tight ? null : (clip, from, to) => activity(source(dir, clips[clip].file), from, to, clips[clip]);
  const r = plan(words, cut, s, voicesOf(dir, clips), motion);
  if (r.errors.length) fail(r.errors.map((e) => `✗ ${e}`).join("\n") + `\nFix ${rel(cutFile)} and build again.`);
  if (!r.pieces.length) fail("✗ Nothing to play: the keeps hold no words.");

  const out = path.resolve(s.out || path.join(dir, "composition"));
  const [width, height] = size(s, clips[r.pieces[0].clip]);
  const title = s.title || cut.title || path.basename(path.resolve(dir));
  // where the text goes, when a skill laid the frame out against the faces (clips' place writes
  // place.json: the captions' options for agentitos' captions, the hook's kind and box)
  const placeFile = path.join(dir, "place.json");
  let placed = null;
  if (fs.existsSync(placeFile)) { try { placed = read(placeFile); } catch (e) { fail(`✗ ${rel(placeFile)} is no valid JSON: ${e.message}`); } }
  // the captions (cut.json "captions", see the captions command), on the cut's own words
  let captions = null, capArea = null, capGroups = [];
  fs.rmSync(path.join(out, "captions"), { recursive: true, force: true });
  if (cut.captions) {
    const file = captionWords(dir, r.words, cut.captions, { width, height, duration: r.duration });
    const at = placed?.caption ? Object.entries(placed.caption).filter(([k, v]) => ["x", "y", "max-width", "align", "font-size", "lines"].includes(k) && v != null).flatMap(([k, v]) => [`--${k}`, String(v)]) : [];
    const said = runCaptions(["build", file, path.join(out, "captions"), "--style", cut.captions.style || "hormozi", ...(cut.captions.brand ? ["--brand", cut.captions.brand] : []),
      // a cut.json of before the setting kept the platform with its captions
      ...(s.platform || cut.captions.platform ? ["--platform", platformList(s.platform || cut.captions.platform).join(",")] : []), ...at]);
    captions = said.match(/<div id="captions"[^\n]*<\/div>/)?.[0] ?? null;
    if (at.length && !/Placed where asked/.test(said)) console.log(`  (this captions skill does not know where to place them: they stand on the safe box's bottom, not where ${rel(placeFile)} says)`);
    for (const line of said.split("\n").filter((l) => /^!|Wider than a line|A short word beside/.test(l.trim()))) console.log(`  captions: ${line.trim()}`);
    ({ area: capArea, groups: capGroups } = captionArea(path.join(out, "captions", "index.html"), height));
  }
  let brollSaid = "";
  // the b-roll (cut.json "broll", see the broll command): beats on the cut's word numbers, so a
  // new cut keeps them on their words (a beat whose word went is left out, and said)
  let broll = null, brollMotion = null;
  fs.rmSync(path.join(out, "broll"), { recursive: true, force: true });
  if (cut.broll) {
    const tool = brollTool();
    if (!tool) fail("✗ The b-roll needs agentitos' b-roll skill beside this one (or BROLL_TOOL naming its tools/broll.mjs).");
    const file = path.join(dir, "broll.words.json");
    fs.writeFileSync(file, JSON.stringify({ width, height, duration: r.duration, words: r.words.map((w) => ({ i: w.i, text: w.text, start: w.start, end: w.end })) }, null, 1));
    const brand = s.brand || cut.captions?.brand;
    // with captions, where they stand: beats beside the person move them onto a band of their own
    const area = captions && fs.existsSync(path.join(out, "captions", "area.json")) ? ["--captions-area", path.join(out, "captions", "area.json")] : [];
    const b = spawnSync(process.execPath, [tool, "build", cut.broll, file, path.join(out, "broll"), "--size", `${width}x${height}`,
      ...(brand ? ["--brand", brand] : []), ...(s.platform ? ["--platform", platformList(s.platform).join(",")] : []), ...area], { encoding: "utf8" });
    if (b.status) fail(`${(b.stdout || b.stderr).trim()}`);
    broll = b.stdout.match(/<div id="broll"[^\n]*<\/div>/)?.[0] ?? null;
    // beats beside the person: its script moves the pieces into the person's field
    brollMotion = b.stdout.match(/<script id="broll-person-motion">[^\n]*<\/script>/)?.[0] ?? null;
    brollSaid = b.stdout.split("\n").filter((l) => l.trim() && !/^Mount it|^Beats beside the person move|^\s*<div id="broll"|^\s*<script id="broll-person-motion"/.test(l)).join("\n");
  }
  // the hook: where place.json puts it, else a card at the top of the box the platforms leave free
  let hook = null, hookEnds = null;
  if (s.hook) {
    let z;
    try { z = zones(width, height, platformList(s.platform)); } catch (e) { fail(`✗ The hook: ${e.message}`); }
    const brand = brandOf(s.brand) || brandOf(cut.captions?.brand);
    if (s.brand && !brand) console.log(`  (no ${s.brand}: the hook in its own colour and font)`);
    // until the first sentence ends, or the cut at which place.json says it ends
    hookEnds = placed?.hook?.until ? Math.min(hookUntil(r.words, r.duration), placed.hook.until) : hookUntil(r.words, r.duration);
    hook = hookCard({ text: s.hook, until: hookEnds, zones: z, brand, out, place: placed?.hook || null });
  }
  // closer at the jump cuts (--punch on): grown from where no chin is pushed into the captions
  const still = fs.existsSync(source(dir, "still.json")) ? read(source(dir, "still.json")) : {};
  const scales = s.punch === "on" ? punches(r.pieces, { highlight: cut.captions?.highlight, still, clips }) : r.pieces.map(() => 1);
  const faces = readFaces(dir);
  // the eyes of a face grown closer stay below the apps' top bar
  let safeTop = 0;
  if (faces) { try { safeTop = zones(width, height, platformList(s.platform)).safe[1]; } catch {} }
  // each video's picture where this skill's place laid it out (place.json "picture": its scale and
  // corner in the frame, raised by its lift), else covering the frame, centred
  const pictures = placed?.picture || null;
  const picOf = (p) => {
    const q = pictures?.[clips[p.clip].file];
    if (!q) return null;
    const c = clips[p.clip];
    return { left: q.left, top: q.top - (q.lift || 0), width: c.width * q.scale, height: c.height * q.scale, ...(q.window ? { window: [q.window[0], q.window[1] - (q.lift || 0), q.window[2], q.window[3]] } : {}) };
  };
  if (placed?.by === "takes place" && placed.for !== placedFor(cut, s)) console.log(`  ⚠ The cut, the captions' style, the hook or the frame changed since ${rel(placeFile)} was written: node ${self()} place ${rel(dir)} again, so that the text keeps clear of the faces.`);
  const pieces = r.pieces.map((p, k) => {
    const pic = picOf(p);
    if (!(scales[k] > 1)) return { ...p, scale: scales[k], ...(pic ? { pic } : {}) };
    const list = faces?.[clips[p.clip].file], seen = [];
    if (list) for (let t = p.in; t <= p.out; t += 0.1) for (const f of facesAt(list, t)) seen.push({ box: toFrame(f.box, list.size, [width, height]), ...(f.feat ? { feat: toFrame(f.feat, list.size, [width, height]) } : {}) });
    const plan = punchPlan({ faces: seen, scale: scales[k], frame: [width, height], cap: capArea, safeTop, raise: placed?.raise || "full" });
    return { ...p, scale: plan.scale, ...(pic ? { pic } : {}), ...(plan.scale > 1 ? { origin: +Math.min(height, plan.origin).toFixed(1) } : {}), ...(plan.why ? { held: `${plan.why}` } : {}) };
  });
  // the ground behind a picture that leaves part of the frame bare: its still, while its pieces play
  const grounds = [];
  if (pictures) for (const p of pieces) {
    const g = pictures[clips[p.clip].file]?.ground;
    if (!g || !fs.existsSync(source(dir, g))) continue;
    const last = grounds.at(-1);
    if (last && last.file === g && Math.abs(last.start + last.duration - p.start) < 1e-3) last.duration = p.start + p.duration - last.start;
    else grounds.push({ file: g, start: p.start, duration: p.duration });
  }
  writeComposition(out, { title, lang: s.lang, width, height, fit: s.fit, fps: s.fps, pieces, clips, dir, captions, broll, brollMotion, hook, grounds });
  // the cut's voice as one file, for a skill that sets other pictures to it: edit.json's words
  // are timed in it. The preview does not need it, so a failure is said and the build goes on
  let voice = null;
  try { voice = voiceTrack((p) => source(dir, clips[p.clip].file), r.pieces, path.join(dir, "voice.cut.m4a")); }
  catch (e) { console.log(`  (the cut's voice as one file was not made: ${e.message})`); }
  fs.writeFileSync(path.join(dir, "edit.json"), JSON.stringify({
    out: rel(out), ...(voice ? { voice: rel(voice) } : {}), width, height, fps: s.fps, duration: r.duration,
    recorded: Object.values(clips).reduce((t, c) => t + c.duration, 0),
    pieces: pieces.map((p) => ({ clip: p.clip, in: +p.in.toFixed(3), out: +p.out.toFixed(3), start: +p.start.toFixed(3), duration: +p.duration.toFixed(3), lufs: p.lufs, gain: p.gain,
      ...(p.words.length ? { words: [p.words[0], p.words.at(-1)] } : { shows: true, rate: +p.rate.toFixed(2), ...(p.wait ? { wait: true } : {}) }), keep: p.keep,
      ...(p.scale > 1 ? { scale: p.scale, origin: p.origin ?? +(0.32 * height).toFixed(1) } : {}) })),
    // where the text stands, in px of the frame: the captions' area, each group's time, the hook's box
    text: { ...(capArea ? { caption: { box: capArea, groups: capGroups } } : {}), ...(hook ? { hook: { box: hook.box.map((v) => +v.toFixed(1)), start: 0, until: hookEnds, kind: placed?.hook?.kind || "card" } } : {}) },
    removed: r.removed, motion: r.motion, warnings: r.warnings, words: r.words,
  }, null, 1));
  const gains = r.pieces.filter((p) => !p.mute).map((p) => p.gain);
  console.log(`${rel(out)}: ${width}×${height}, ${clock(r.duration)} from ${clock(Object.values(clips).reduce((t, c) => t + c.duration, 0))} recorded, ${r.pieces.length} pieces, levels evened out by ${Math.min(...gains) >= 0 ? "+" : ""}${Math.min(...gains)} … ${Math.max(...gains) >= 0 ? "+" : ""}${Math.max(...gains)} dB → index.html`);
  if (voice) console.log(`Voice: ${rel(voice)}, the cut's sound as one file (each take at its level); the words in ${rel(path.join(dir, "edit.json"))} are timed in it`);
  if (cut.captions) console.log(`Captions: ${cut.captions.style || "hormozi"}, ${(cut.captions.highlight || []).length} key words`);
  if (brollSaid) console.log(`B-roll: ${brollSaid.replace(/^[^\n]*?: /, "")}`);
  if (hook) console.log(`Hook: „${s.hook}“ until ${hookEnds} s, ${placed?.hook ? `${placed.hook.kind === "text" ? "a text" : "a card"} where ${rel(placeFile)} puts it` : "a card at the top"}`);
  if (placed?.caption && cut.captions) console.log(`Captions placed as ${rel(placeFile)} says: ${Object.entries(placed.caption).map(([k, v]) => `--${k} ${v}`).join(" ")}`);
  const moved = pieces.filter((p) => p.origin != null && p.origin > 0.32 * height + 0.5).length;
  if (moved) console.log(`Punch: ${moved} piece(s) grow from lower down, so that no chin, mouth or nose is pushed into the captions`);
  const held = pieces.filter((p) => p.held);
  if (held.length) console.log(`Punch: ${held.map((p) => `piece ${pieces.indexOf(p) + 1} at ${clock(p.start)} ${p.held.startsWith("none") ? "stays as it is" : "goes less close"} (${p.held.replace(/^none: |^smaller, [^:]*: /, "")})`).join("; ")}`);
  if (tight) console.log(`Pauses: tight, every pause over ${s.pause} s cut`);
  if (s.punch === "on") console.log(`Punch: ${pieces.filter((p) => p.scale > 1).length} of ${scales.length} pieces closer, at the jump cuts`);
  console.log(`Next: node ${self()} check ${rel(dir)}`);
}

// --------------------------------------------------------------------------------- captions
function cmdCaptions(dir, opts) {
  const cutFile = path.join(dir, "cut.json"), editFile = path.join(dir, "edit.json");
  if (!fs.existsSync(editFile)) fail(`Build first: takes.mjs build ${rel(dir)}`);
  // the platform first: a wrong one fails before the key words are marked (and paid for)
  if (opts.platform !== undefined) settings(dir, { platform: opts.platform });
  const cut = read(cutFile);
  if (opts.off) {
    delete cut.captions;
  } else {
    const e = read(editFile);
    const file = captionWords(dir, e.words, {}, e);
    runCaptions(["mark", file, ...(opts.product ? ["--product", opts.product] : [])]);
    const highlight = read(file).words.filter((w) => w.highlight).map((w) => w.i);
    cut.captions = { style: opts.style || cut.captions?.style || "hormozi", highlight, ...(opts.brand || cut.captions?.brand ? { brand: opts.brand || cut.captions.brand } : {}) };
    console.log(`Captions ${cut.captions.style}: ${highlight.length} key words (${highlight.map((i) => e.words.find((w) => w.i === i)?.text).join(", ")})`);
  }
  fs.writeFileSync(cutFile, JSON.stringify(cut, null, 2) + "\n");
  cmdBuild(dir, {});
}

// ------------------------------------------------------------------------------------ broll
function cmdBroll(dir, file, opts) {
  const cutFile = path.join(dir, "cut.json");
  if (!fs.existsSync(path.join(dir, "edit.json"))) fail(`Build first: takes.mjs build ${rel(dir)}`);
  const cut = read(cutFile);
  if (opts.off) delete cut.broll;
  else {
    if (!file) fail("Usage: takes.mjs broll <dir> <broll.json>   (or --off)");
    if (!fs.existsSync(file)) fail(`There is no ${file}: write it as the b-roll brief says.`);
    if (!brollTool()) fail("✗ The b-roll needs agentitos' b-roll skill beside this one (or BROLL_TOOL naming its tools/broll.mjs).");
    cut.broll = rel(path.resolve(file));
  }
  fs.writeFileSync(cutFile, JSON.stringify(cut, null, 2) + "\n");
  cmdBuild(dir, {});
}

// ------------------------------------------------------------------------------------ faces
// Every face of every video over time, in the video's own pixels (source/NN.faces.json), by
// agentitos' clips: its frame.mjs --faces (a model's stills with the eyes, nose and mouth, its
// tracker between them), or, with --eye, the agent's own boxes read off grid pictures (--grid),
// followed by the same tracker, no model. place reads them.
const kOf = (c) => String(c.n).padStart(2, "0");
function eyeBoxes(list, clips) {
  const by = {};
  const names = Object.values(clips).map((c) => c.file);
  for (const v of list || []) {
    const m = String(v).match(/^(?:([\w.-]+\.mp4)@)?(\d+(?:\.\d+)?):(-?[\d.]+,-?[\d.]+,[\d.]+,[\d.]+)$/);
    if (!m) fail(`--eye is [<video>@]<second>:x,y,w,h, the face's box at that second in px of the video, read off its grid picture, as 01.mp4@2.5:300,570,600,900, not "${v}".`);
    const file = m[1] || (names.length === 1 ? names[0] : null);
    if (!file) fail(`--eye ${v}: name the video, as ${names[0]}@${m[2]}:${m[3]} (there are ${names.length}: ${names.join(", ")}).`);
    if (!names.includes(file)) fail(`--eye ${v}: there is no ${file}; the videos are ${names.join(", ")}.`);
    // a face's box: inside the picture, not a speck, about as tall as wide or taller
    const c = Object.values(clips).find((x) => x.file === file), [x, y, w, h] = m[3].split(",").map(Number);
    const inside = Math.max(0, Math.min(c.width, x + w) - Math.max(0, x)) * Math.max(0, Math.min(c.height, y + h) - Math.max(0, y));
    if (!(w >= 0.02 * c.height && h >= 0.02 * c.height) || inside < 0.8 * w * h || h / w < 0.6 || h / w > 3) fail(`--eye ${v}: that is no face's box in ${file} (${c.width}×${c.height}): x,y is its top left corner, then its width and height, from the hairline to the chin and cheek to cheek, read off the grid picture again.`);
    (by[file] ||= []).push(`${m[2]}:${m[3]}`);
  }
  return by;
}

function cmdFaces(dir, opts) {
  if (!fs.existsSync(source(dir, "words.json"))) fail(`Run first: takes.mjs new ${rel(dir)} <video>`);
  const { clips, words } = read(source(dir, "words.json"));
  const list = Object.values(clips).sort((a, b) => a.n - b.n);
  // the grid pictures, for the agent's own eyes: five moments spread over what the cut keeps of
  // each video (over all of it before there is a cut), and the seconds asked for
  if (opts.grid || opts["grid-at"]) {
    const tool = layoutTool();
    if (!tool) fail("The grid pictures need agentitos' layout skill beside this one (or LAYOUT_TOOL naming its tools/place.mjs).");
    const edit = fs.existsSync(path.join(dir, "edit.json")) ? read(path.join(dir, "edit.json")) : null;
    const cut = fs.existsSync(path.join(dir, "cut.json")) ? read(path.join(dir, "cut.json")) : null;
    const pieces = pieceSpan(edit, { cut, words });
    const asked = (opts["grid-at"] || []).flatMap((v) => String(v).split(",")).filter(Boolean).map((v) => {
      const m = v.match(/^(?:([\w.-]+\.mp4)@)?(\d+(?:\.\d+)?)$/);
      if (!m) fail(`--grid-at is [<video>@]<second>, as 01.mp4@12.5, not "${v}".`);
      return { file: m[1] || list[0].file, t: Number(m[2]) };
    });
    const made = [];
    for (const c of list) {
      const kept = pieces.filter((p) => p.clip === c.n), spans = kept.length ? kept.map((p) => [p.in, p.out]) : [[0, c.duration]];
      const total = spans.reduce((t, [a, b]) => t + b - a, 0);
      const at = (x) => { let r = x * total; for (const [a, b] of spans) { if (r <= b - a) return a + r; r -= b - a; } return spans.at(-1)[1]; };
      const ts = [...(opts.grid ? [0.05, 0.27, 0.5, 0.73, 0.95].map(at) : []), ...asked.filter((a) => a.file === c.file).map((a) => a.t)];
      for (const t of ts) {
        const out = source(dir, `${kOf(c)}.grid-${t.toFixed(1)}.jpg`);
        const r = spawnSync(process.execPath, [tool, "grid", source(dir, c.file), out, "--at", t.toFixed(2)], { encoding: "utf8" });
        if (r.status) fail(`✗ layout grid: ${(r.stderr || r.stdout).trim()}`);
        made.push(`${rel(out)} (${c.file} at ${t.toFixed(1)} s)`);
      }
    }
    console.log(`Grid pictures, a line every 10 % labelled in px of the video:\n  ${made.join("\n  ")}`);
    console.log(`Open each, read the face's box off it (hairline to chin, cheek to cheek, in px of the video; layout's SKILL.md step 2 says how), then\n  node ${self()} faces ${rel(dir)} --eye ${list.length > 1 ? `${list[0].file}@` : ""}<second>:x,y,w,h --eye …   (every picture's box; a second where the head is clearly higher or lower: --grid-at <second> first)`);
    return;
  }
  const tool = framingTool();
  if (!tool) fail("Finding the faces needs agentitos' clips skill beside this one (or FRAME_TOOL naming its tools/frame.mjs).");
  const eye = eyeBoxes(opts.eye, clips);
  // the agent's own eyes for one video: no other is sent to the model unasked
  const missing = list.filter((c) => !eye[c.file] && !fs.existsSync(source(dir, `${kOf(c)}.faces.json`)));
  if (opts.eye?.length && missing.length) fail(`--eye names no box of ${missing.map((c) => c.file).join(", ")}: give its boxes too (faces ${rel(dir)} --grid shows them), so that no video goes to the model unasked.`);
  let cost = 0;
  const started = Date.now();
  // a person's take in which a face shows less than half the time: the model missed it, or there is
  // none (said of faces found now as of faces kept from before)
  const fewFaces = (c, got) => {
    const seen = (got.faces || []).filter((f) => f.boxes?.length).length * (got.step || 0.1);
    if (seen >= 0.5 * c.duration) return;
    const material = (got.shots || []).filter((x) => x.kind && x.kind !== "people").reduce((t, x) => t + x.end - x.start, 0);
    console.log(`✗ ${c.file}: a face at ${seen.toFixed(1)} of its ${c.duration.toFixed(1)} s only${material ? ` (it shows a slide, a screen or other material for ${material.toFixed(1)} s: where that is a quarter or more of what the cut keeps, place keeps the picture whole and needs no face)` : ""}. Where a person speaks to the camera in it, the faces were missed: read them yourself (faces ${rel(dir)} --grid, then --eye); place puts the text by the faces it knows, and none where it knows none.`);
  };
  for (const c of list) {
    const out = source(dir, `${kOf(c)}.faces.json`);
    const boxes = eye[c.file];
    if (!boxes && fs.existsSync(out) && !opts.again) { console.log(`${c.file}: faces kept from before (${rel(out)}; --again finds them anew)`); fewFaces(c, read(out)); continue; }
    // --again asks the model afresh: its answer of before, kept beside the video, goes
    if (opts.again && !boxes) fs.rmSync(source(dir, `${kOf(c)}.people.json`), { force: true });
    // the video's words with who speaks, for the model (one voice where the words name none)
    const wf = source(dir, `${kOf(c)}.framing-words.json`);
    fs.writeFileSync(wf, JSON.stringify(words.filter((w) => w.clip === c.n && w.kind === "word").map((w) => ({ text: w.text, start: w.start, end: w.end, speaker: w.speaker ?? "A" }))));
    // (the frame's shape: where a face is a close-up, the model is asked once more where its head tips)
    const [fw, fh] = size(settings(dir, {}), c);
    const r = spawnSync(process.execPath, [tool, source(dir, c.file), wf, "--aspect", `${fw}:${fh}`, "--faces", out, ...(boxes || []).flatMap((b) => ["--face-at", b])], { encoding: "utf8" });
    if (r.status || !fs.existsSync(out)) fail(`✗ ${c.file}: ${(r.stdout || r.stderr).trim().split("\n").pop()}`);
    console.log(`${c.file}: ${r.stdout.trim().split("\n").map((l) => l.replace(/^[^:]*faces\.json: /, "")).join("\n  ")}`);
    const got = read(out);
    cost += got.cost || 0;
    fewFaces(c, got);
  }
  console.log(`${cost ? `$${cost.toFixed(4)} in all, ` : ""}${((Date.now() - started) / 1000).toFixed(0)} s.`);
  console.log(`Next: node ${self()} place ${rel(dir)}   (where the picture and the text go; it builds again)`);
}

// ------------------------------------------------------------------------------------ place
// The cut's frame laid out against the faces, as clips' place lays out a framed clip, by
// agentitos' layout: each video placed (place), the captions and the hook over the whole cut and
// how far each video's picture is raised (text); writes place.json and source/faces.json (the faces
// in the frame as placed), which the build, the punch-ins and the check read, and placed.sheet.jpg.
const pick = (list, clips, what) => {
  const names = Object.values(clips).map((c) => c.file), out = {};
  for (const v of list || []) {
    const m = String(v).match(/^(?:([\w.-]+\.mp4):)?(.*)$/);
    const file = m[1] || (names.length === 1 ? names[0] : null);
    if (!file || !names.includes(file)) fail(`--${what} ${v}: name the video, as ${names[0]}:${m[2] || "…"} (the videos: ${names.join(", ")}).`);
    out[file] = m[2];
  }
  return out;
};
// the cut and what the text's place depends on, to tell a place.json of an older cut
const placedFor = (cut, s) => JSON.stringify([cut.keep, cut.captions?.style || null, s.hook || null, s.aspect, s.platform || null]);

function cmdPlace(dir, opts) {
  if (!fs.existsSync(source(dir, "words.json"))) fail(`Run first: takes.mjs new ${rel(dir)} <video>`);
  const cutFile = path.join(dir, "cut.json");
  if (!fs.existsSync(cutFile)) fail(`Write ${rel(cutFile)} first, as ${rel(source(dir, "brief.md"))} says.`);
  const tool = layoutTool();
  if (!tool) fail("Placing the picture and the text needs agentitos' layout skill beside this one (or LAYOUT_TOOL naming its tools/place.mjs).");
  if (opts.hook !== undefined) fail(`The hook's words go to build (build ${rel(dir)} --hook "…"), then place again; place takes --hook-kind text|card.`);
  const s = settings(dir, {});
  const { clips, words } = read(source(dir, "words.json"));
  const cut = read(cutFile);
  const placeFile = path.join(dir, "place.json");
  const prev = fs.existsSync(placeFile) ? read(placeFile) : {};
  if (prev.by && prev.by !== "takes place") fail(`${rel(placeFile)} is ${prev.by}'s: that skill places this cut's text (clips: clips.mjs place), never this command.`);
  // what the agent fixed, kept for the next run: given now, or given before; "" gives one back
  const fixed = { ...(prev.fixed || {}) };
  const BAD = { raise: "--raise is head (never a head cut by the frame: smaller type first, the captions on the chin or the lower lip), mouth (the default: past the head's top only where the captions would lie on a mouth) or full (until the chin is clear, the head cut by the frame's top); \"\" gives back the default.",
    y: "--caption-y is the y in px at which the captions' lowest line ends, as 1440; \"\" gives it back to layout.", font: "--font-size is the captions' type in px, as 77; \"\" gives it back to layout.",
    lines: "--lines is 1 (one line of about three words, as most published Shorts) or 2 (a style of whole phrases, or a long word that breaks at its soft hyphen); \"\" gives it back to the style.", hook: "--hook-kind is text (a short text below the chin or above the head) or card (a card at the top); \"\" lets layout choose." };
  const one = (k, v, ok) => { if (v === undefined) return; if (v === "") { delete fixed[k]; return; } if (!ok(v)) fail(BAD[k]); fixed[k] = isNaN(Number(v)) ? v : Number(v); };
  one("raise", opts.raise, (v) => ["head", "mouth", "full"].includes(v));
  one("y", opts["caption-y"], (v) => Number(v) > 0);
  one("font", opts["font-size"], (v) => Number(v) > 0);
  one("lines", opts.lines, (v) => ["1", "2"].includes(String(v)));
  one("hook", opts["hook-kind"], (v) => ["text", "card"].includes(v));
  for (const [file, v] of Object.entries(pick(opts.picture, clips, "picture"))) {
    if (v === "") { delete fixed.picture?.[file]; continue; }
    if (!(v === "cover" || /^\d+$/.test(v))) fail(`--picture is [<video>:]<candidate>, a number of the list place printed for that video, or [<video>:]cover (the picture covering the frame, centred); "" gives it back to layout.`);
    fixed.picture = { ...(fixed.picture || {}), [file]: v === "cover" ? "cover" : Number(v) };
  }
  for (const [file, v] of Object.entries(pick(opts.lift, clips, "lift"))) {
    if (v === "") { delete fixed.lifts?.[file]; continue; }
    if (!/^\d+$/.test(v)) fail(`--lift is [<video>:]<px>, how far that video's picture is raised (0: not at all), as 01.mp4:120; "" gives it back to layout.`);
    fixed.lifts = { ...(fixed.lifts || {}), [file]: Number(v) };
  }

  const edit = fs.existsSync(path.join(dir, "edit.json")) ? read(path.join(dir, "edit.json")) : null;
  const built = !!edit && edit.out && fs.existsSync(path.join(path.resolve(edit.out), "index.html"));
  const pieces = pieceSpan(edit, { cut, words });
  if (!pieces.length) fail(`${rel(cutFile)} keeps no words: write its keeps first.`);
  const [W, H] = size(s, clips[pieces[0].clip]);
  const shown = Object.values(clips).filter((c) => pieces.some((p) => p.clip === c.n)).sort((a, b) => a.n - b.n);
  const faces = {};
  for (const c of shown) {
    const f = source(dir, `${kOf(c)}.faces.json`);
    if (!fs.existsSync(f)) continue;
    faces[c.file] = read(f);
    const fault = facesFault(faces[c.file], [c.width, c.height]);
    if (fault) fail(`✗ ${c.file}: ${fault}: find them again, node ${self()} faces ${rel(dir)} --again${faces[c.file].by === "eye" ? ` --eye … (read off its grid pictures: faces ${rel(dir)} --grid)` : ""}.`);
  }
  if (!Object.keys(faces).length) fail(`No faces known yet: node ${self()} faces ${rel(dir)} first (or --grid and --eye, where no model may see the videos).`);
  const folder = path.join(dir, "placement");
  fs.mkdirSync(folder, { recursive: true });
  const lines = fixed.lines || (() => { const t = captionsTool(); if (!t || !cut.captions?.style) return 1; const r = spawnSync(process.execPath, [t, "styles", "--json"], { encoding: "utf8" }); try { const x = JSON.parse(r.stdout).find((y) => y.name === cut.captions.style); return x && x.words > 4 ? 2 : 1; } catch { return 1; } })();
  const needs = ["--text", lines > 1 ? "caption:2" : "caption", ...(s.hook ? ["--text", fixed.hook ? `hook:${fixed.hook}` : "hook"] : [])];
  const platform = s.platform ? ["--platform", platformList(s.platform).join(",")] : [];

  // each video in the frame: covering it where it has the frame's shape (within 15 %, as clips
  // frames only wider footage), else layout's first candidate that passes; the agent's number wins
  const pictures = {}, said = [], choices = {};
  for (const c of shown) {
    const cover = { ...covering([c.width, c.height], [W, H]), fit: "cover" };
    const track = faceTrack(faces[c.file], pieces, c.n);
    const want = fixed.picture?.[c.file];
    const sameShape = Math.abs(c.width / c.height - W / H) / (W / H) <= 0.15;
    // best-takes is for one person's take: footage with cuts in it, two people, or slides and a
    // screen are said, with the skill made for them, instead of placed badly in silence (the review:
    // a talk show's 4K cuts became the whole strip at a third of its size, the faces 3–15 % of the
    // height; a talk's slides were cropped from the middle, the slide and the speaker cut). Material
    // first: a slide stays whole whether a face was found beside it or not.
    const kind = takeKind(faces[c.file], pieces, c.n), rule = pictureRule(kind, track.length > 0);
    if (rule.use === "whole" && want == null) {
      pictures[c.file] = { ...whole([c.width, c.height], [W, H]), fit: "whole" };
      said.push(`${c.file}: ✗ shows a slide, a screen or other material for ${kind.material.toFixed(1)} s of what the cut keeps${track.length ? "" : " (no face found in it)"}: the picture stays whole, smaller, over its blurred copy (a crop would cut the material); clips frames such footage shot by shot (clips' SKILL.md)`);
      continue;
    }
    // a few seconds called material are said, never shrink the whole take
    const brief = rule.material ? [`${c.file}: ⚠ ${rule.material.toFixed(1)} of the ${kind.kept.toFixed(1)} s the cut keeps of it were called a slide, a screen or other material (a thing held to the lens, an empty picture): under a quarter of it, so the picture is not kept whole for them; where that stretch must be seen whole, clips frames such footage shot by shot (clips' SKILL.md)`] : [];
    if (!track.length) { pictures[c.file] = cover; said.push(`${c.file}: no face in what the cut keeps of it: the picture covers the frame, centred`, ...brief); continue; }
    // a cut the detector found counts only where the faces on either side disagree (shotChange);
    // one they cannot tell is said, and the take placed as one shot all the same
    const at = (xs) => xs.map((x) => x.t.toFixed(1)).join(", ").replace(/, ([^,]*)$/, " and $1") + " s";
    if (rule.use === "fallback" && want == null) {
      pictures[c.file] = cover;
      said.push(`${c.file}: ✗ ${rule.other.length ? `has ${rule.other.length + 1} shots, cut in it (another framing or person at ${at(rule.other)})` : ""}${rule.other.length && kind.people > 1 ? " and " : ""}${kind.people > 1 ? `shows ${kind.people} people` : ""}: best-takes places one picture for one person's take, so it covers the frame from the middle as before and the text is placed by the faces; clips frames such footage shot by shot, on whoever speaks (clips' SKILL.md). --picture <number> takes one of layout's candidates all the same`, ...brief);
      continue;
    }
    const doubt = [...brief, ...(rule.same.length ? [`${c.file}: the picture changes at ${at(rule.same)} with the same face at the same place before and after (the light, or the person away for a moment): one shot, placed as one`] : []),
      ...(rule.unsure.length ? [`${c.file}: ⚠ the picture changes at ${at(rule.unsure)} and the faces cannot tell whether it is cut there (none on one side, or the same face back only after a long gap): placed as one person's take all the same; where the sheet shows another shot there, clips frames such footage shot by shot (clips' SKILL.md)`] : [])];
    const pf = path.join(folder, `${kOf(c)}.track.json`);
    fs.writeFileSync(pf, JSON.stringify(track));
    const r = spawnSync(process.execPath, [tool, "place", path.join(folder, kOf(c)), "--frame", `${W}x${H}`, "--source", `${c.width}x${c.height}`, "--face-track", pf, ...needs, ...platform, "--json"], { encoding: "utf8", maxBuffer: 64 << 20 });
    if (r.status) fail(`✗ layout place for ${c.file}: ${(r.stderr || r.stdout).trim()}`);
    const res = JSON.parse(r.stdout);
    // the face's usual height (the median of the track) as each candidate shows it
    const hs = track.map((m) => m.box[3]).sort((a, b) => a - b), usual = hs[hs.length >> 1];
    const ranked = rankPictures(res.candidates, usual, H), list = ranked;
    const passes = (x) => !x.hard && !x.unmet.length;
    const name = (x) => `${x.fit}${x.crop ? ` ${x.crop}` : ""}${x.closer ? " closer" : ""}${x.onGround ? ", text on the ground" : ""}`;
    const asPic = (x) => ({ scale: x.scale, left: x.left, top: x.top, fit: name(x), n: x.n, ...(x.window ? { window: x.window } : {}) });
    let chosen;
    if (want === "cover") chosen = cover;
    else if (Number.isInteger(want)) {
      const x = list.find((y) => y.n === want);
      if (!x) fail(`--picture ${c.file}:${want}: layout gives ${c.file} ${list.length} candidate(s) of one picture (${list.map((y) => y.n).join(", ")}); name one of them, or cover.`);
      chosen = asPic(x);
    } else if (sameShape) chosen = cover;
    else chosen = asPic(ranked[0]);
    pictures[c.file] = chosen;
    const mark = (x) => (x.hard ? "✗" : x.unmet.length ? "–" : x.soft ? "!" : "✓");
    const reason = (x) => [...x.problems.filter((q) => q.level !== "info").map((q) => `${q.of}: ${q.what}`), ...x.unmet.map((u) => `no place for the ${u}`)].join("; ");
    const line = (x) => `${x.n}. ${mark(x)} ${name(x)} at ${x.scale}× (the video's pixels ${x.scale > 1 ? `enlarged ${x.scale}×` : `at ${x.scale}×`}), the face ${Math.round(x.face * 100)} % of the height${reason(x) ? `: ${reason(x)}` : ""}${chosen.n === x.n ? "  ← taken" : ""}`;
    choices[c.file] = { list: ranked, cover: sameShape || want === "cover" ? cover : null, usual, mark, name };
    said.push(`${c.file} (${c.width}×${c.height}): ${chosen.fit === "cover" ? `covering the frame, centred${want === "cover" ? " (as you fixed it)" : sameShape ? " (the frame's shape already)" : ""}, the face ${Math.round(((usual * cover.scale) / H) * 100)} % of the height` : `${chosen.fit} at ${chosen.scale}×${Number.isInteger(want) ? " (as you fixed it)" : ""}`}; layout's candidates, the best for a person's take first:\n    ${ranked.slice(0, 5).map(line).join("\n    ")}`);
    said.push(...doubt);
  }

  // the captions and the hook over the whole cut, each video one shot of layout's text
  const clock = clockOf(clips, pieces);
  const until = s.hook ? (built ? hookUntil(edit.words, edit.duration) : 3) : null;
  const hook = s.hook ? hookSpan(pieces, until, clock) : null;
  const { input, files } = shotsInput({ clips, pieces, faces, pictures, frame: [W, H], clock, hook });
  const shotsFile = path.join(folder, "shots.json");
  fs.writeFileSync(shotsFile, JSON.stringify(input));
  const lifts = Object.entries(fixed.lifts || {}).filter(([f]) => files.includes(f)).flatMap(([f, px]) => ["--lift", `${files.indexOf(f) + 1}:${px}`]);
  // the captions' style as built: its lines, and the ink the area must hold
  const look = (() => { try { return JSON.parse(fs.readFileSync(path.join(path.resolve(edit.out), "captions", "index.html"), "utf8").match(/var DATA = (\{[\s\S]*?\});\n/)[1]).look; } catch { return null; } })();
  const ink = cut.captions ? inkOf(look) : null;
  const r = spawnSync(process.execPath, [tool, "text", folder, "--frame", `${W}x${H}`, "--shots", shotsFile, ...needs, ...platform, "--raise", fixed.raise || "mouth",
    ...(ink ? ["--set", `caption.line=${ink.line}`, "--set", `caption.padEm=${ink.box ? 0.44 : ink.below}`] : []),
    ...(fixed.y ? ["--caption-y", String(fixed.y)] : []), ...(fixed.font ? ["--font-size", String(fixed.font)] : []), ...lifts], { encoding: "utf8" });
  if (r.status) fail(`✗ layout text: ${(r.stderr || r.stdout).trim()}`);
  const text = read(path.join(folder, "text.json"));
  text.shots.forEach((x, i) => { pictures[files[i]].lift = x.lift || 0; });
  // the ground: one still of the video, where the picture leaves part of the frame bare
  for (const c of shown) {
    const pic = pictures[c.file];
    // (the part of the frame the sharp picture fills: a crop's window, else the picture itself)
    const w = pic.window || [pic.left, pic.top, c.width * pic.scale, c.height * pic.scale], y0 = w[1] - (pic.lift || 0);
    const bare = w[0] > 0.5 || y0 > 0.5 || w[0] + w[2] < W - 0.5 || y0 + w[3] < H - 0.5;
    if (!bare) continue;
    const kept = pieces.filter((p) => p.clip === c.n), mid = kept[Math.floor(kept.length / 2)];
    const g = source(dir, `${kOf(c)}.ground.jpg`);
    if (groundStill(source(dir, c.file), (mid.in + mid.out) / 2, g, [W, H])) pic.ground = path.basename(g);
  }

  // for the build, the punch-ins and the check: the captions' options, the hook's place, each
  // video's picture, and the faces in the frame as placed
  const capOpts = text.caption ? { ...text.caption.options } : null;
  if (capOpts && ink) {
    capOpts.y = Math.round(capOpts.y - ink.below * capOpts["font-size"]);
    capOpts["max-width"] = Math.floor(capOpts["max-width"] - 2 * Math.ceil(ink.side * capOpts["font-size"] + 1));
  }
  const hookOut = text.hook ? { kind: text.hook.kind, box: text.hook.box, font: text.hook.font, lines: text.hook.lines, ...(text.hook.why && built ? { until: +toCut(text.hook.until, pieces, clock).toFixed(3) } : {}) } : null;
  const picOut = Object.fromEntries(Object.entries(pictures).map(([f, p]) => [f, { scale: p.scale, left: p.left, top: p.top, lift: p.lift || 0, fit: p.fit, ...(p.n ? { candidate: p.n } : {}), ...(p.window ? { window: p.window } : {}), ...(p.ground ? { ground: p.ground } : {}) }]));
  if (!Object.keys(fixed.picture || {}).length) delete fixed.picture;
  if (!Object.keys(fixed.lifts || {}).length) delete fixed.lifts;
  fs.writeFileSync(placeFile, JSON.stringify({ by: "takes place", raise: fixed.raise || "mouth", ...(capOpts ? { caption: capOpts } : {}), ...(hookOut ? { hook: hookOut } : {}), picture: picOut, fixed, for: placedFor(cut, s) }, null, 1) + "\n");
  const inside = {};
  for (const c of shown) {
    const list = faces[c.file], pic = pictures[c.file];
    if (!list) continue;
    inside[c.file] = { size: [W, H], step: list.step, by: list.by, faces: list.faces.map((f) => ({ t: f.t, boxes: f.boxes.map((b) => ({ who: b.who, box: inFrame(b.box, pic).map(Math.round), ...(b.feat ? { feat: inFrame(b.feat, pic).map(Math.round) } : {}) })) })) };
  }
  fs.writeFileSync(source(dir, "faces.json"), JSON.stringify(inside) + "\n");

  // the list: the picture, the captions, each video raised, what lies on a face
  console.log(`The picture:\n  ${said.join("\n  ")}`);
  // (a video shown whole for its slides or screen needs no faces for its picture: not counted)
  const faced = pieces.filter((p) => pictures[clips[p.clip].file]?.fit !== "whole");
  const cutLength = faced.reduce((t, p) => t + p.duration, 0), known = knownSeconds(faced, clips, inside);
  if (faced.length && known < 0.5 * cutLength) console.log(`✗ A face is known for ${known.toFixed(1)} of the cut's ${cutLength.toFixed(1)} s only. Where a person speaks to the camera, the faces were missed: the text is placed against none there. Read them yourself (faces ${rel(dir)} --grid, then --eye), then place again.`);
  const c = text.caption;
  if (c) console.log(`The captions: one place for the cut, ${c.lines > 1 ? "up to two lines" : "one line"} of ${c.font} px, the lowest line at y ${capOpts.y} (their middle at ${c.middle} % of the height, ${c.where === "no-face" ? "no face in the cut: where published Shorts set them" : c.where === "above-head" ? "above the head" : "below the chin"})${!cut.captions ? "; no captions in the cut yet: placed for the tallest style, place again after the captions command" : ""}.`);
  const parts = (t) => [t.nose ? `the nose or eyes ${t.nose} s` : "", t.hair ? `the hair or forehead ${t.hair} s` : "", t.mouth ? `the mouth ${t.mouth} s` : "", t.lip ? `the lower lip ${t.lip} s` : ""].filter(Boolean).join(", ");
  text.shots.forEach((x, i) => {
    const on = x.touches.filter((t) => t.seconds > 0.05);
    const where = !on.length ? "on no face" : x.fault === "nose" ? `✗ on the nose or eyes: ${on.map(parts).join("; ")}` : x.fault === "mouth" ? `✗ on the mouth: ${on.map(parts).join("; ")}` : x.hair ? (x.on?.hair ? `above the eyes, on the hair or forehead (${on.map(parts).join("; ")})` : "above the head, on the hair") : x.lip ? `on the lower lip and chin (${on.map(parts).join("; ")}), not on the mouth: not avoidable at a readable size` : `on the chin ${on.reduce((n, t) => n + t.seconds, 0).toFixed(1)} s, below the mouth`;
    console.log(`  ${files[i]}: ${x.lift ? `raised ${x.lift} px${x.ground ? `, a blurred band of ${x.ground} px at the bottom` : ""}${x.fixed ? " as you fixed it" : x.past ? ", past the head's top so that the captions keep off the mouth" : ""}` : "not raised"}${x.headCut?.seconds ? `; the head cut at the top ${x.headCut.px} px for ${x.headCut.seconds} s` : ""}; captions ${where}`);
  });
  if (text.hook) console.log(`The hook: ${text.hook.kind === "card" ? "a card" : "a short text"} ${({ "below-chin": "below the chin", "above-head": "above the head", top: "at the top", middle: "in the middle", free: "in the middle of the frame (no face)" })[text.hook.where] || `(${text.hook.where})`}, ${text.hook.font} px${text.hook.why ? `; ${text.hook.why}` : ""}${text.hook.onFace?.seconds ? `; ✗ on a face for ${text.hook.onFace.seconds} s` : ""}.`);
  for (const x of text.conflicts) console.log(`✗ ${x}`);
  for (const n of text.notes.filter((n) => !/chin or neck|on the hair/.test(n))) console.log(`note: ${n}`);

  // the sheet: per video the frame as placed at its first and last kept second and where its face is lowest and highest
  const rows = shown.map((cl) => {
    const kept = pieces.filter((p) => p.clip === cl.n), list = inside[cl.file]?.faces || [];
    const inKept = list.filter((f) => kept.some((p) => f.t >= p.in && f.t <= p.out));
    const bottom = (f) => Math.max(...f.boxes.map((b) => b.box[1] + b.box[3])), topOf = (f) => Math.min(...f.boxes.map((b) => b.box[1]));
    const lowest = inKept.length ? inKept.reduce((a, b) => (bottom(b) > bottom(a) ? b : a)) : null, highest = inKept.length ? inKept.reduce((a, b) => (topOf(b) < topOf(a) ? b : a)) : null;
    const first = kept[0].in + 0.05, last = kept.at(-1).out - 0.05;
    // (a second of the video under the hook: in a piece the hook's time covers)
    const hookAt = (t) => !!hook && pieces.some((p, k) => p.clip === cl.n && t >= p.in && t <= p.out && (hook.spans || [[hook.start, hook.end]]).some(([a, b]) => clock.at[k] + t - p.in >= a && clock.at[k] + t - p.in <= b));
    const near = (t) => list.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a), list[0] || { boxes: [] });
    const moments = [{ t: first, what: "first" }, ...(lowest ? [{ t: lowest.t, what: "lowest face" }] : []), ...(highest ? [{ t: highest.t, what: "highest face" }] : []), { t: last, what: "last" }]
      .map((m) => ({ ...m, faces: (near(m.t)?.boxes || []).map((b) => b.box), hook: hookAt(m.t) }));
    const pic = pictures[cl.file];
    return { video: source(dir, cl.file), label: `${cl.file}${pic.lift ? ` raised ${pic.lift}` : ""}`, pic: { ...pic, w: cl.width, h: cl.height }, ground: pic.ground ? source(dir, pic.ground) : null, moments };
  });
  // and under each video's row the first three of layout's candidates as the list ranks them, at
  // the moment its face is lowest, each with its own text: the agent chooses from one sheet
  const candRows = [];
  for (const cl of shown) {
    const ch = choices[cl.file], row = rows.find((r) => r.video === source(dir, cl.file));
    if (!ch || !row) continue;
    const g = source(dir, `${kOf(cl)}.ground.jpg`);
    const kept = pieces.filter((p) => p.clip === cl.n), mid = kept[Math.floor(kept.length / 2)];
    if (!fs.existsSync(g)) groundStill(source(dir, cl.file), (mid.in + mid.out) / 2, g, [W, H]);
    const m = row.moments.find((x) => x.what === "lowest face") || row.moments[0];
    const near = faces[cl.file].faces.reduce((a, b) => (Math.abs(b.t - m.t) < Math.abs(a.t - m.t) ? b : a));
    const cells = ch.list.slice(0, 3).map((x) => {
      const pic = { scale: x.scale, left: x.left, top: x.top, ...(x.window ? { window: x.window } : {}), w: cl.width, h: cl.height };
      const t = (role) => x.text.find((q) => q.role === role)?.box;
      return { t: m.t, what: "", hook: true, pic, ground: fs.existsSync(g) ? g : null, faces: near.boxes.map((b) => inFrame(b.box, pic)), text: { caption: t("caption"), hook: t("hook") },
        label: `${pictures[cl.file].n === x.n ? "TAKEN " : ""}${x.n} ${ch.mark(x)} ${x.fit}${x.crop ? ` ${x.crop.replace(":", "x")}` : ""} ${x.scale.toFixed(2)}x face ${Math.round(x.face * 100)}` };
    });
    if (cells.length) candRows.push({ ...row, label: `${cl.file} candidates`, moments: cells });
  }
  const sheet = placedSheet([...rows, ...candRows], { caption: c?.box, hook: text.hook?.box }, path.join(dir, "placed.sheet.jpg"), [W, H]);
  if (sheet) console.log(`Look at ${rel(sheet)}: a row per video, the frame as placed at the first and last second the cut keeps of it and where its face is lowest and highest, the captions' box yellow, the hook's cyan, the faces red${candRows.length ? `; under them layout's first three candidates as listed, each with its own text: --picture <number> takes another` : ""}.`);
  console.log(`To change it: --picture [<video>:]<candidate>|cover (another of layout's candidates for that video), --raise head|mouth|full, --caption-y <px> and --font-size <px> for the captions, --lift [<video>:]<px>, --lines 1|2, --hook-kind text|card; each is kept for the next run, "" gives it back to layout.`);
  if (built) cmdBuild(dir, {});
  else console.log(`Next: node ${self()} build ${rel(dir)}, then place again (the hook's seconds are the cut's, the area the captions' style).`);
}

// ----------------------------------------------------------------------------------- check
function cmdCheck(dir) {
  const file = path.join(dir, "edit.json");
  if (!fs.existsSync(file)) fail(`Build first: takes.mjs build ${rel(dir)}`);
  const e = read(file);
  const { clips, words } = read(source(dir, "words.json"));
  const s = settings(dir, {});
  const cut = read(path.join(dir, "cut.json"));
  const voices = voicesOf(dir, clips);
  const text = (a, b) => words.slice(a, b + 1).filter((w) => w.kind === "word").map((w) => cut.fixes?.[w.i] ?? w.text).filter(Boolean).join(" ");
  const several = Object.keys(clips).length > 1;
  const where = (c, t) => `${several ? `video ${c} ` : ""}${clock(t)}`;
  const errors = [], warnings = [...e.warnings];

  console.log(`${clock(e.recorded)} recorded → ${clock(e.duration)} cut (−${Math.round(e.recorded - e.duration)} s), ${e.pieces.length} pieces\n`);
  console.log("As it plays:");
  e.pieces.forEach((p, k) => {
    if (p.shows) {
      const what = p.wait ? (p.rate > 1 ? "the wait, as a timelapse" : "the wait, held before the cut") : "something moves in the pause";
      console.log(`${String(k + 1).padStart(3)} ${clock(p.start).padStart(6)}  (no words: ${what}, ${(p.out - p.in).toFixed(1)} s ${p.rate > 1 ? `×${p.rate} in ${p.duration.toFixed(1)} s` : "as it is"}, muted)   (${where(p.clip, p.in)})`);
      return;
    }
    console.log(`${String(k + 1).padStart(3)} ${clock(p.start).padStart(6)}  [${p.words[0]}–${p.words[1]}] ${text(p.words[0], p.words[1])}   (${where(p.clip, p.in)}, ${p.gain >= 0 ? "+" : ""}${p.gain} dB)`);
    // a piece that starts on its first word without any quiet before it, while the voice is on,
    // starts in the middle of a word or a sentence (a breath before a word is no voice; a cut
    // right after a filler that went is meant: the two touch)
    const v = voices[p.clip], at = (t) => v.env[Math.round(t / HOP)] ?? 0;
    const first = words[p.words[0]], prior = words[p.words[0] - 1];
    const afterFiller = prior && prior.clip === p.clip && prior.kind !== "word" && first.start - prior.end < 0.15;
    if (!afterFiller && p.in >= first.start - 0.03 && [-0.03, -0.02, -0.01, 0].every((d) => at(p.in + d) > v.thr)) {
      warnings.push(`piece ${k + 1} ("${text(p.words[0], p.words[1])}") starts while the voice is on (${where(p.clip, p.in)}): the sentence likely begins earlier; look at the words before ${p.words[0]} in the brief (squeezed or doubled words are the recognizer's) and start the keep where the sentence starts`);
    }
    // a short piece that is a whole keep ("Tschüss.") is meant; one left over by a cut is not
    const whole = (range(cut.keep[p.keep]?.words) || []).join() === p.words.join();
    if (p.duration < 0.6 && p.words[1] - p.words[0] < 2 && !whole) warnings.push(`piece ${k + 1} ("${text(p.words[0], p.words[1])}") is ${p.duration.toFixed(2)} s long: that sounds chopped; keep the whole phrase, or start or end the keep beside it`);
  });

  const dropped = e.removed.filter((r) => r.kind === "dropped" && text(r.words[0], r.words[1]));
  console.log(`\nLeft out:`);
  for (const r of dropped) console.log(`    ${where(r.clip, r.from)}–${clock(r.to)}  [${r.words[0]}–${r.words[1]}] ${text(r.words[0], r.words[1])}`);
  if (!dropped.length) console.log("    no words");
  const snd = e.removed.filter((r) => r.kind === "filler"), pauses = e.removed.filter((r) => r.kind === "pause");
  if (snd.length) console.log(`    ${snd.length} fillers inside the keeps (${[...new Set(snd.map((r) => shown(words[r.words[0]])))].slice(0, 5).join(", ")})`);
  // every pause the tool decided on, what it did and why, so that the agent can overrule it
  if (pauses.length) {
    console.log(`\nPauses (over ${s.pause} s inside a keep, and the waits):`);
    for (const [c, m] of Object.entries(e.motion || {})) {
      console.log(`    ${several ? `video ${c}: ` : ""}while speaking ${(m.base * 100).toFixed(2)} % of the picture changes (${m.seconds.toFixed(0)} s measured${m.enough ? "" : ", too little speech: the keeps' pauses included"}); a pause shows something from ${(m.limit * 100).toFixed(2)} % on`);
    }
    for (const r of pauses) {
      const shownTime = (r.moving || []).reduce((t, m) => t + m.to - m.from, 0);
      console.log(`    ${where(r.clip, r.from)}–${clock(r.to)} (${(r.to - r.from).toFixed(1)} s, after word ${r.words[0]}): ${r.why ?? (shownTime ? "kept: the picture moves" : "cut")}`);
    }
    if (s.pauses !== "tight") console.log(`    (a pause cut that is worth seeing: "pauses": "keep" on its keep; a pause kept that shows nothing: end its keep before it, start the next after it)`);
  }

  const levels = [...new Set(e.pieces.map((p) => p.lufs).filter((l) => l != null))];
  if (levels.length) {
    const lo = Math.min(...levels), hi = Math.max(...levels);
    console.log(`\nLevel: the takes are at ${lo === hi ? `${lo}` : `${lo} … ${hi}`} LUFS (${(hi - lo).toFixed(1)} dB apart), all brought to ${TAKE_LEVEL} LUFS; finish brings the rendered video to ${s.final} LUFS.`);
  }
  // text on a face, where the faces are known (source/faces.json, from the skill that framed the videos, or this skill's place)
  const faces = readFaces(dir);
  const placeNow = fs.existsSync(path.join(dir, "place.json")) ? read(path.join(dir, "place.json")) : null, placedBy = placeNow?.by;
  if (placedBy === "takes place" && placeNow.for !== placedFor(cut, s)) warnings.push(`the cut, the captions' style, the hook or the frame changed since place laid them out: node ${self()} place ${rel(dir)} again, so that the text keeps clear of the faces`);
  if (faces && e.text) {
    const texts = [...(e.text.caption ? e.text.caption.groups.map(([a, b]) => ({ role: "captions", box: e.text.caption.box, from: a, to: b })) : []),
      ...(e.text.hook ? [{ role: "hook", box: e.text.hook.box, from: 0, to: e.text.hook.until }] : [])];
    const on = textOnFaces({ pieces: e.pieces, clips, faces, texts, frame: [e.width, e.height] }), said = [];
    // the seconds on each part, the part named: the nose or the eyes and the mouth (both lips) are
    // a fault to fix (✗); the lower lip, the chin and the hair above a head are what a readable
    // caption over a tight close-up or a low head leaves, said as such
    const parts = (x) => [x.nose ? `the nose or eyes ${x.nose} s` : "", x.mouth ? `the mouth ${x.mouth} s` : "", x.lip ? `the lower lip ${x.lip} s` : "", x.chin ? `the chin ${x.chin} s` : "", x.hair ? `the hair above the head ${x.hair} s` : ""].filter(Boolean).join(", ");
    for (const x of on.filter((q) => q.seconds >= 0.3)) {
      const fault = x.nose >= 0.3 || x.mouth >= 0.3;
      if (x.role !== "hook" && !fault) { said.push(`${x.who ?? "a face"}: ${parts(x)}`); continue; }
      const line = `the ${x.role === "hook" ? "hook" : "captions"} lie${x.role === "hook" ? "s" : ""} on ${x.who ?? "a face"} for ${x.seconds} s between ${clock(x.from)} and ${clock(x.to)} (${parts(x)}): ${x.role === "hook" ? "a shorter hook, another kind (a card at the top, a text in the middle), or none" : (placedBy === "takes place" ? `place them again: ${self()} place ${rel(dir)} --font-size <px> (a smaller type), --raise full, or --caption-y <px>; or cut that stretch otherwise` : "place them again where the skill that laid the frame out can (clips: place: a smaller type by hand, --font-size), or cut to another shot there")}`;
      if (x.role !== "hook") errors.push(line); else warnings.push(line);
    }
    if (said.length) console.log(`\nText and faces: the captions lie on ${said.join("; ")}${on.some((q) => q.role !== "hook" && (q.nose || q.mouth)) ? "" : "; never on the nose, the eyes or the mouth"} (the skill that framed the video says where that is not avoidable at a readable size).`);
    else if (!on.some((q) => q.seconds >= 0.3)) console.log(`\nText and faces: the captions${e.text.hook ? " and the hook" : ""} lie on no face (the faces as source/faces.json has them).`);
    // this skill's own faces that miss most of the cut: what is not known is not counted
    const placed = fs.existsSync(path.join(dir, "place.json")) ? read(path.join(dir, "place.json")) : null;
    if (placed?.by === "takes place") {
      // (a video place showed whole for its slides or screen is not counted)
      const faced = e.pieces.filter((p) => placed.picture?.[clips[p.clip]?.file]?.fit !== "whole"), length = faced.reduce((t, p) => t + p.duration, 0);
      const known = knownSeconds(faced, clips, faces);
      if (faced.length && known < 0.5 * length) errors.push(`a face is known for ${known.toFixed(1)} of the cut's ${length.toFixed(1)} s only: where the person is in the picture, the faces were missed and nothing here is checked against them; read them yourself (faces ${rel(dir)} --grid, then --eye), then place again`);
    }
  }
  const over = overTarget(e.duration, s.target);
  if (over) warnings.push(over);

  // HyperFrames' own check of the project
  const [cmd, ...pre] = hyperframes();
  const lint = spawnSync(cmd, [...pre, "lint"], { cwd: path.resolve(e.out), encoding: "utf8" });
  for (const m of (lint.stdout + lint.stderr).matchAll(/✗\s+(.+)/g)) errors.push(`HyperFrames: ${m[1]}`);
  for (const m of (lint.stdout + lint.stderr).matchAll(/⚠\s+(.+)/g)) warnings.push(`HyperFrames: ${m[1]}`);

  if (errors.length || warnings.length) console.log("");
  for (const x of errors) console.log(`✗ ${x}`);
  for (const x of warnings) console.log(`⚠ ${x}`);
  console.log(errors.length ? "\nFix the errors (✗) and build again." : `\n${warnings.length ? "No errors." : "No problems."} The preview: ${e.out}/index.html`);
  if (errors.length) process.exit(1);
}

// ---------------------------------------------------------------------------------- render
function srt(words) {
  const cues = [];
  let cue = null;
  for (const w of words) {
    const prev = cue?.words.at(-1);
    if (!cue || cue.words.length >= 7 || w.end - cue.words[0].start > 3.5 || w.start - prev.end > 0.6 || /[.!?]$/.test(prev.text) || (cue.text + " " + w.text).length > 64) {
      cue = { words: [], text: "" };
      cues.push(cue);
    }
    cue.words.push(w);
    // (a soft hyphen in a long word is where the captions in the picture may break it: no part of the text)
    const text = w.text.replace(/\u00AD/g, "");
    cue.text = cue.text ? `${cue.text} ${text}` : text;
  }
  const ts = (t) => {
    const ms = Math.round(t * 1000), h = Math.floor(ms / 3600e3), m = Math.floor(ms / 60e3) % 60, sec = Math.floor(ms / 1000) % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  return cues.map((c, k) => {
    const end = Math.min(c.words.at(-1).end + 0.3, cues[k + 1]?.words[0].start ?? Infinity);
    return `${k + 1}\n${ts(c.words[0].start)} --> ${ts(end)}\n${c.text}\n`;
  }).join("\n");
}

function lufsOf(file) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
  const summary = r.stderr.slice(r.stderr.lastIndexOf("Summary:"));
  return { lufs: Number(summary.match(/I:\s*(-?[\d.]+) LUFS/)?.[1]), peak: Number(summary.match(/Peak:\s*(-?[\d.]+) dBFS/)?.[1]) };
}

function cmdFinish(dir, file) {
  if (!file) fail("Usage: takes.mjs finish <dir> <video.mp4>");
  if (!fs.existsSync(file)) fail(`There is no ${file}: render the project first.`);
  const e = read(path.join(dir, "edit.json"));
  const s = settings(dir, {});
  const p = probe(file);
  if (Math.abs(p.duration - e.duration) > 0.5) fail(`✗ ${rel(path.resolve(file))} is ${clock(p.duration)} long, the cut ${clock(e.duration)}: it is from before the last build. Render again.`);

  // the level of the whole: a gain to the target and a limiter 2 dB under full scale, measured
  // and corrected once (the limiter takes a little of the loudness); the picture is copied. A
  // video at the level already stays as it is, so that finishing twice changes nothing.
  const before = lufsOf(file);
  if (!(Math.abs(before.lufs - s.final) <= 0.5 && before.peak <= -1)) {
    const tmp = path.join(path.dirname(path.resolve(file)), `.${path.basename(file)}.part.mp4`);
    const level = (gain, out) => execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-map", "0:v:0", "-map", "0:a:0", "-map_metadata", "-1", "-c:v", "copy",
      "-af", `volume=${gain.toFixed(2)}dB,alimiter=limit=0.79:attack=5:release=60:level=disabled`, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", out], { stdio: ["ignore", "ignore", "inherit"] });
    try {
      let gain = s.final - before.lufs;
      level(gain, tmp);
      const got = lufsOf(tmp).lufs;
      if (Math.abs(got - s.final) > 0.3) { gain += s.final - got; level(gain, tmp); }
      fs.renameSync(tmp, file);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  const after = lufsOf(file);
  const subs = file.replace(/\.[^.]+$/, "") + ".srt";
  fs.writeFileSync(subs, srt(e.words));
  console.log(`${rel(path.resolve(file))}: ${clock(p.duration)}, ${p.width}×${p.height}, ${after.lufs} LUFS (was ${before.lufs}), true peak ${after.peak} dBTP; subtitles: ${rel(path.resolve(subs))}`);
}

// -------------------------------------------------------------------------------------- main
const [command, ...rest] = process.argv.slice(2);
const [pos, opts] = parse(rest);
if (command === "new") await cmdNew(pos[0], pos.slice(1), opts);
else if (command === "propose") await cmdPropose(pos[0], opts);
else if (command === "build") cmdBuild(pos[0], opts);
else if (command === "check") cmdCheck(pos[0]);
else if (command === "finish") cmdFinish(pos[0], pos[1]);
else if (command === "captions") cmdCaptions(pos[0], opts);
else if (command === "broll") cmdBroll(pos[0], pos[1], opts);
else if (command === "faces") cmdFaces(pos[0], opts);
else if (command === "place") cmdPlace(pos[0], opts);
else fail("Usage: takes.mjs new <dir> <video> [<video> …] | propose <dir> | build <dir> | check <dir> | finish <dir> <video.mp4> | captions <dir> --style … | broll <dir> <broll.json> | faces <dir> [--grid | --eye …] | place <dir> [--picture …]   (options: see the head of this file)");
