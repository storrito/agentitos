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
//
// Options, kept in source/settings.json for the next steps:
//   --out <folder>     the composition/ folder of the HyperFrames project the preview shows
//                      (rragent: artifacts/<name>/composition; default <dir>/composition)
//   --title "…"        the preview's title          --lang de    the language of the words
//   --aspect source|9:16|16:9|1:1|4:5    the frame (default: the first video's)
//   --fit cover|contain    a video of another shape fills the frame, or fits into it
//   --target <s>       the longest the cut should be (the brief and the check use it)
//   --pause <s>        pauses longer than this inside a keep are shortened (default 1)
//   --loudness <LUFS>  of the rendered video (default −14, as Instagram, TikTok and YouTube play it)
//   --fps <n>          frames a second of the rendered video (default 30)
//   --order recorded|given    the videos by their recording time (default, when all have one)
//                      or as given
//   --model <id>       the OpenRouter model of propose (default google/gemini-4-argon)

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { probe, playable, samples, hyperframes, clock } from "./lib/media.mjs";
import { scribe, SCRIBE_MODEL } from "./lib/asr.mjs";
import { envelope, threshold, retime, loudnessBlocks, loudness } from "./lib/voice.mjs";
import { plan, range } from "./lib/cut.mjs";
import { activity, moving } from "./lib/motion.mjs";
import { writeComposition } from "./lib/composition.mjs";
import { propose, PROPOSE_MODEL } from "./lib/propose.mjs";
import { brief, shown } from "./brief.mjs";

const VALUED = ["out", "title", "lang", "aspect", "fit", "target", "pause", "loudness", "fps", "order", "model"];
const NUMBERS = ["target", "pause", "loudness", "fps"];
const TAKE_LEVEL = -14; // each take before the bus; finish brings the rendered whole to --loudness

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
    if (!VALUED.includes(k)) fail(`Unknown option ${a}. Options: ${VALUED.map((o) => "--" + o).join(" ")}`);
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
  const merged = { aspect: "source", fit: "cover", pause: 1, loudness: -14, fps: 30, ...kept, ...opts };
  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + "\n");
  return { ...merged, final: merged.loudness, loudness: TAKE_LEVEL };
}

// ------------------------------------------------------------------------------------- new
async function cmdNew(dir, files, opts) {
  if (!dir || !files.length) fail("Usage: takes.mjs new <dir> <video> [<video> …]");
  if (fs.existsSync(source(dir, "words.json"))) fail(`${rel(source(dir))} is in use already. To start over: rm -r ${rel(source(dir))}`);
  for (const f of files) if (!fs.existsSync(f)) fail(`There is no ${f}.`);
  if (!process.env.OPENROUTER_API_KEY) fail("This tool needs OPENROUTER_API_KEY: the words come from ElevenLabs Scribe, the proposal from Gemini, both through OpenRouter.");
  fs.mkdirSync(source(dir), { recursive: true });

  let list = files.map((f) => ({ from: f, ...probe(f) }));
  const byTime = list.every((c) => c.created) && opts.order !== "given";
  if (byTime) list = [...list].sort((a, b) => Date.parse(a.created) - Date.parse(b.created));
  if (list.length > 1) console.log(`${list.length} videos, ${byTime ? "in the order they were recorded" : "in the order given"}: ${list.map((c) => c.from).join(", ")}`);

  const clips = {}, words = [];
  for (const [k, c] of list.entries()) {
    const n = k + 1, name = `${String(n).padStart(2, "0")}.mp4`, file = source(dir, name);
    const how = playable(c.from, file);
    const p = probe(file);
    console.log(`video ${n}: ${c.from} (${clock(p.duration, false)}, ${p.width}×${p.height}${how.startsWith("transcoded") ? `, ${how} to H.264` : ""}) – listening …`);
    const env = envelope(samples(file));
    fs.writeFileSync(source(dir, `${String(n).padStart(2, "0")}.env`), Buffer.from(env.buffer));
    const said = await scribe(file, p.duration, { log: console.log });
    const moved = retime(said, env, threshold(env));
    if (moved) console.log(`  ${moved} word timings set by the sound (the recognizer had them squeezed or stretched)`);
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

  fs.writeFileSync(source(dir, "words.json"), JSON.stringify({ asr: SCRIBE_MODEL, clips, words }, null, 1));
  const s = settings(dir, opts);
  fs.writeFileSync(source(dir, "brief.md"), brief(clips, words, s));
  const levels = Object.values(clips).map((c) => c.lufs).filter((l) => l != null);
  if (levels.length > 1) console.log(`The videos' levels: ${levels.join(", ")} LUFS (${(Math.max(...levels) - Math.min(...levels)).toFixed(1)} dB apart); the build evens them out.`);
  console.log(`\nNext: node ${self()} propose ${rel(dir)}, then read ${rel(source(dir, "brief.md"))} (all of it), write ${rel(path.join(dir, "cut.json"))}, then: node ${self()} build ${rel(dir)}`);
}

// --------------------------------------------------------------------------------- propose
async function cmdPropose(dir, opts) {
  if (!fs.existsSync(source(dir, "words.json"))) fail(`Run first: takes.mjs new ${rel(dir)} <video>`);
  if (!process.env.OPENROUTER_API_KEY) fail("propose needs OPENROUTER_API_KEY.");
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

function cmdBuild(dir, opts) {
  if (!fs.existsSync(source(dir, "words.json"))) fail(`Run first: takes.mjs new ${rel(dir)} <video>`);
  const cutFile = path.join(dir, "cut.json");
  if (!fs.existsSync(cutFile)) fail(`Write ${rel(cutFile)} first, as ${rel(source(dir, "brief.md"))} says.`);
  let cut;
  try { cut = read(cutFile); } catch (e) { fail(`✗ ${rel(cutFile)} is no valid JSON: ${e.message}`); }
  const s = settings(dir, opts);
  const { clips, words } = read(source(dir, "words.json"));
  // where the picture moves in a pause, measured in the video itself
  const moves = (clip, from, to) => moving(activity(source(dir, clips[clip].file), from, to, clips[clip]), from, to);
  const r = plan(words, cut, s, voicesOf(dir, clips), moves);
  if (r.errors.length) fail(r.errors.map((e) => `✗ ${e}`).join("\n") + `\nFix ${rel(cutFile)} and build again.`);
  if (!r.pieces.length) fail("✗ Nothing to play: the keeps hold no words.");

  const out = path.resolve(s.out || path.join(dir, "composition"));
  const [width, height] = size(s, clips[r.pieces[0].clip]);
  const title = s.title || cut.title || path.basename(path.resolve(dir));
  writeComposition(out, { title, lang: s.lang, width, height, fit: s.fit, fps: s.fps, pieces: r.pieces, clips, dir });
  fs.writeFileSync(path.join(dir, "edit.json"), JSON.stringify({
    out: rel(out), width, height, fps: s.fps, duration: r.duration,
    recorded: Object.values(clips).reduce((t, c) => t + c.duration, 0),
    pieces: r.pieces.map((p) => ({ clip: p.clip, in: +p.in.toFixed(3), out: +p.out.toFixed(3), start: +p.start.toFixed(3), duration: +p.duration.toFixed(3), lufs: p.lufs, gain: p.gain,
      ...(p.words.length ? { words: [p.words[0], p.words.at(-1)] } : { shows: true, rate: +p.rate.toFixed(2), ...(p.wait ? { wait: true } : {}) }), keep: p.keep })),
    removed: r.removed, warnings: r.warnings, words: r.words,
  }, null, 1));
  const gains = r.pieces.filter((p) => !p.mute).map((p) => p.gain);
  console.log(`${rel(out)}: ${width}×${height}, ${clock(r.duration)} from ${clock(Object.values(clips).reduce((t, c) => t + c.duration, 0))} recorded, ${r.pieces.length} pieces, levels evened out by ${Math.min(...gains) >= 0 ? "+" : ""}${Math.min(...gains)} … ${Math.max(...gains) >= 0 ? "+" : ""}${Math.max(...gains)} dB → index.html`);
  console.log(`Next: node ${self()} check ${rel(dir)}`);
}

// ----------------------------------------------------------------------------------- check
function cmdCheck(dir) {
  const file = path.join(dir, "edit.json");
  if (!fs.existsSync(file)) fail(`Build first: takes.mjs build ${rel(dir)}`);
  const e = read(file);
  const { clips, words } = read(source(dir, "words.json"));
  const s = settings(dir, {});
  const cut = read(path.join(dir, "cut.json"));
  const text = (a, b) => words.slice(a, b + 1).filter((w) => w.kind === "word").map((w) => cut.fixes?.[w.i] ?? w.text).filter(Boolean).join(" ");
  const several = Object.keys(clips).length > 1;
  const where = (c, t) => `${several ? `video ${c} ` : ""}${clock(t)}`;
  const errors = [], warnings = [...e.warnings];

  console.log(`${clock(e.recorded)} recorded → ${clock(e.duration)} cut (−${Math.round(e.recorded - e.duration)} s), ${e.pieces.length} pieces\n`);
  console.log("As it plays:");
  e.pieces.forEach((p, k) => {
    if (p.shows) {
      const what = p.wait ? (p.rate > 1 ? "the wait, as a timelapse" : "the wait, held before the cut") : "the picture moves";
      console.log(`${String(k + 1).padStart(3)} ${clock(p.start).padStart(6)}  (no words: ${what}, ${(p.out - p.in).toFixed(1)} s ${p.rate > 1 ? `×${p.rate} in ${p.duration.toFixed(1)} s` : "as it is"}, muted)   (${where(p.clip, p.in)})`);
      return;
    }
    console.log(`${String(k + 1).padStart(3)} ${clock(p.start).padStart(6)}  [${p.words[0]}–${p.words[1]}] ${text(p.words[0], p.words[1])}   (${where(p.clip, p.in)}, ${p.gain >= 0 ? "+" : ""}${p.gain} dB)`);
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
  if (pauses.length) {
    const shownOf = (r) => (r.moving || []).reduce((t, m) => t + m.to - m.from, 0);
    const still = pauses.reduce((t, r) => t + r.to - r.from - shownOf(r), 0);
    const fast = pauses.flatMap((r) => r.moving || []).filter((m) => m.rate > 1);
    console.log(`    ${pauses.length} pauses over ${s.pause} s: ${still.toFixed(1)} s where the picture stands still cut out` +
      (fast.length ? `, ${fast.length} stretch${fast.length > 1 ? "es" : ""} where it moves played faster (${fast.map((m) => `${(m.to - m.from).toFixed(1)} s ×${m.rate}`).join(", ")})` : ""));
  }

  const levels = [...new Set(e.pieces.map((p) => p.lufs).filter((l) => l != null))];
  if (levels.length) {
    const lo = Math.min(...levels), hi = Math.max(...levels);
    console.log(`\nLevel: the takes are at ${lo === hi ? `${lo}` : `${lo} … ${hi}`} LUFS (${(hi - lo).toFixed(1)} dB apart), all brought to ${TAKE_LEVEL} LUFS; finish brings the rendered video to ${s.final} LUFS.`);
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
    cue.text = cue.text ? `${cue.text} ${w.text}` : w.text;
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
else fail("Usage: takes.mjs new <dir> <video> [<video> …] | propose <dir> | build <dir> | check <dir> | finish <dir> <video.mp4>   (options: see the head of this file)");
