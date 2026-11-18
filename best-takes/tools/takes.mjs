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
import { readFaces, facesAt, toFrame, punchOrigin, textOnFaces } from "./lib/faces.mjs";
import { brief, shown } from "./brief.mjs";

const VALUED = ["out", "title", "lang", "aspect", "fit", "target", "pause", "pauses", "punch", "hook", "loudness", "fps", "order", "model", "style", "product", "brand", "platform"];
const FLAGS = ["off"];
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
    const bottom = height - d.bottom, h = d.lines * d.size * lh + pad;
    return { area: [d.left, +(bottom - h).toFixed(1), d.maxWidth, +h.toFixed(1)], groups: d.groups.map((g) => [g.start, g.end]) };
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
  const pieces = r.pieces.map((p, k) => {
    if (!(scales[k] > 1)) return { ...p, scale: scales[k] };
    const list = faces?.[clips[p.clip].file], seen = [];
    if (list) for (let t = p.in; t <= p.out; t += 0.1) for (const f of facesAt(list, t)) seen.push(toFrame(f.box, list.size, [width, height]));
    return { ...p, scale: scales[k], origin: +punchOrigin({ faces: seen, scale: scales[k], frame: [width, height], cap: capArea, safeTop }).toFixed(1) };
  });
  writeComposition(out, { title, lang: s.lang, width, height, fit: s.fit, fps: s.fps, pieces, clips, dir, captions, hook });
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
  if (hook) console.log(`Hook: „${s.hook}“ until ${hookEnds} s, ${placed?.hook ? `${placed.hook.kind === "text" ? "a text" : "a card"} where ${rel(placeFile)} puts it` : "a card at the top"}`);
  if (placed?.caption && cut.captions) console.log(`Captions placed as ${rel(placeFile)} says: ${Object.entries(placed.caption).map(([k, v]) => `--${k} ${v}`).join(" ")}`);
  const moved = pieces.filter((p) => p.origin != null && p.origin > 0.32 * height + 0.5).length;
  if (moved) console.log(`Punch: ${moved} piece(s) grow from lower down, so that no chin is pushed into the captions`);
  if (tight) console.log(`Pauses: tight, every pause over ${s.pause} s cut`);
  if (s.punch === "on") console.log(`Punch: ${scales.filter((v) => v > 1).length} of ${scales.length} pieces closer, at the jump cuts`);
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
  // text on a face, where the faces are known (source/faces.json, from the skill that framed the videos)
  const faces = readFaces(dir);
  if (faces && e.text) {
    const texts = [...(e.text.caption ? e.text.caption.groups.map(([a, b]) => ({ role: "captions", box: e.text.caption.box, from: a, to: b })) : []),
      ...(e.text.hook ? [{ role: "hook", box: e.text.hook.box, from: 0, to: e.text.hook.until }] : [])];
    const on = textOnFaces({ pieces: e.pieces, clips, faces, texts, frame: [e.width, e.height] });
    for (const x of on.filter((q) => q.seconds >= 0.3)) {
      const deep = x.share >= 0.2 ? `${Math.round(x.share * 100)} % of its height up from the chin (the mouth and more)` : `the chin, ${Math.round(x.share * 100)} % of its height`;
      warnings.push(`the ${x.role === "hook" ? "hook" : "captions' area"} lies on ${x.who ?? "a face"} for ${x.seconds} s between ${clock(x.from)} and ${clock(x.to)}, up to ${deep}: ${x.role === "hook" ? "a shorter hook, another kind (a card at the top, a text in the middle), or none" : "a place clear of it from the skill that laid the frame out (clips: place, which raises that shot or sets the captions elsewhere), or a cut to another shot there"}`);
    }
    if (!on.some((q) => q.seconds >= 0.3)) console.log(`\nText and faces: the captions${e.text.hook ? " and the hook" : ""} lie on no face (the faces as source/faces.json has them).`);
  }
  if (s.target && e.duration > s.target + 0.5) warnings.push(`the cut is ${e.duration.toFixed(1)} s long, ${(e.duration - s.target).toFixed(1)} s over the ${s.target} s it should be at most`);

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
    const level = (gain, out) => execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy",
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
else fail("Usage: takes.mjs new <dir> <video> [<video> …] | propose <dir> | build <dir> | check <dir> | finish <dir> <video.mp4>   (options: see the head of this file)");
