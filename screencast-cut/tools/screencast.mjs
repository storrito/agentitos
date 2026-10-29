#!/usr/bin/env node
// A screencast of several sources recorded at the same time (rragent's recorder: the screen, the
// webcam, the phone's camera or screen, the microphone) cut into one video: the sources on one
// clock, the voice cleaned, each keep shown and zoomed as the agent decides from its words and its
// frames (sheets), the waits
// as timelapses, the results held long enough to see them. Step by step, in one folder; made for
// agents: each step prints what to do next.
//
//   node tools/screencast.mjs new <dir> <recording-folder>   the sources into <dir>/source/: on
//                                     one clock, the voice cleaned, where each picture moves
//   node tools/screencast.mjs words <dir> <words.json>      the words of source/voice.m4a, as
//                                     rragent's transcribe tool wrote them (`words: true`)
//   node tools/screencast.mjs transcribe <dir>              or the words by ElevenLabs Scribe
//   node tools/screencast.mjs propose <dir>   every sentence a keep: proposal.json (no view, no
//                                     zoom: those the agent decides)
//   node tools/screencast.mjs sheets <dir> [--proposal] [--keeps 3,5]   one image per keep: every
//                                     source at its first, middle and last moment, to decide its
//                                     view and zoom by
//   node tools/screencast.mjs build <dir>     cut.json → the HyperFrames project (a preview) and
//                                     <dir>/edit.json
//   node tools/screencast.mjs check <dir>     the cut as it plays, and what to fix
//   node tools/screencast.mjs at <dir> <m:ss> what plays at that moment of the cut, and its keep
//   node tools/screencast.mjs frame <dir> <m:ss>   its source's picture there, whole, with a grid
//                                     and the shot's crop: to choose a "zoom" box by
//   node tools/screencast.mjs captions <dir> --style hormozi   captions in the picture (agentitos'
//                                     captions skill); --off takes them out
//   node tools/screencast.mjs finish <dir> <video.mp4>   the rendered video at the platforms'
//                                     loudness, subtitles beside it
//
// Options, kept in source/settings.json for the next steps:
//   --out <folder>    the composition/ folder of the HyperFrames project (rragent:
//                     artifacts/<name>/composition; default <dir>/composition)
//   --title "…"   --lang de   --frame 9:16|16:9|1:1|4:5 (default 9:16)   --fps 30
//   --platform reels,tiktok   where the video goes: the layout and the captions keep clear of what
//                     those apps lay over it (agentitos' platform-zones); none: the usual
//                     platforms of the frame
//   --speed <x>       the whole cut this much faster, the voice at its own pitch (default 1;
//                     1.1–1.2 fits more into a short and still sounds natural)
//   --pause <s>       pauses inside a keep longer than this are cut or shown (default 1)
//   --tail <s>        how long a keep holds after its last word (default 0.45)
//   --end <s>         how long the last keep holds (default 1.5)
//   --loudness <LUFS> of the finished video (default −14)
//   --mic <source>    the microphone the voice comes from (default: the clearest)
//   --duck <dB>       the voice's sound between the words lowered by this much (keyboard,
//                     room; default 10, 0 for none)
//   --brand <DESIGN.md>   the brand kit's colours and font (default brand/DESIGN.md when there)

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { probe, prepare, samples, hyperframes, clock, seconds } from "./lib/media.mjs";
import { envelope, threshold, retime, ghosts, loudnessBlocks, loudness } from "./lib/voice.mjs";
import { align, clarity } from "./lib/sync.mjs";
import { grid, differ, samplesOf, mirrors, scenes, level, busy, moving, focus, MOVING, ACTIVE } from "./lib/activity.mjs";
import { plan, range } from "./lib/cut.mjs";
import { FRAMES, areas, crop as cropFor, place } from "./lib/layout.mjs";
import { writeComposition, brandOf } from "./lib/composition.mjs";
import { voiceTrack, cameraTrack, backdropTrack } from "./lib/tracks.mjs";
import { findFace } from "./lib/face.mjs";
import { transcribe as scribe, kindOf, SCRIBE_MODEL, route } from "./lib/openrouter.mjs";
import { zones, platformList } from "./lib/zones.mjs";

const VALUED = ["out", "title", "lang", "frame", "platform", "fps", "speed", "pause", "tail", "end", "loudness", "mic", "duck", "brand", "style", "product", "source", "keeps"];
const FLAGS = ["off", "proposal"];
const NUMBERS = ["fps", "speed", "pause", "tail", "end", "loudness", "duck"];
const TAKE_LEVEL = -14; // each take before the bus; finish brings the rendered whole to --loudness
const VIDEO = ["screen", "phone-screen", "phone", "webcam"];
const VIEWS = ["screen", "phone-screen", "phone", "face"];
// what says that something is there now: a result that needs its proof on screen
const CLAIM = /\b(posted|published|live|there it is|here it is|arrived|it's there|online|gepostet|veröffentlicht|da ist (es|er|sie)|angekommen)\b/i;

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
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 1) + "\n");
const rel = (p) => path.relative(process.cwd(), p) || ".";
const self = () => (rel(process.argv[1]).startsWith("..") ? process.argv[1] : rel(process.argv[1]));
const cmd = (rest) => `node ${self()} ${rest}`;

function settings(dir, opts) {
  const file = source(dir, "settings.json");
  const kept = fs.existsSync(file) ? read(file) : {};
  const merged = { frame: "9:16", fps: 30, speed: 1, pause: 1, tail: 0.45, end: 1.5, loudness: -14, duck: 10, ...kept, ...opts };
  if (!FRAMES[merged.frame]) fail(`--frame is one of ${Object.keys(FRAMES).join(", ")}`);
  if (!(merged.speed >= 0.5 && merged.speed <= 2)) fail("--speed is between 0.5 and 2 (1.15: 15 % faster).");
  // a platform platform-zones does not know is not kept: every later step would fail on it
  if (opts.platform) try { zones(...FRAMES[merged.frame], platformList(merged.platform)); } catch (e) { fail(`✗ --platform: ${e.message}`); }
  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + "\n");
  return { ...merged, final: merged.loudness, loudness: TAKE_LEVEL };
}

// The captions of a cut: clean subtitles unless cut.json says otherwise ("captions": false: none,
// or the style the captions command wrote); none by default when the captions skill is missing
function captionsOf(cut = {}) {
  if (cut.captions === false) return null;
  if (cut.captions) return cut.captions;
  return captionsTool() ? { style: "clean", highlight: [] } : null;
}

// The frame's areas (layout.areas): from what the platforms the video goes to lay over it
// (agentitos' platform-zones), with room for captions and labels only when the cut has them.
function layoutOf(s, cut = {}) {
  const [width, height] = FRAMES[s.frame];
  let z;
  try { z = zones(width, height, platformList(s.platform)); } catch (e) { fail(`✗ ${e.message}`); }
  return { width, height, zones: z, areas: areas(width, height, z, { captions: !!captionsOf(cut), labels: (cut.keep || []).some((k) => k.label) }) };
}

// Where the face is in the webcam's picture (face.mjs), once, kept in sources.json; null when
// it was not found (the circle shows the picture's middle)
async function faceOfWebcam(dir, meta) {
  const cam = meta.sources.webcam;
  if (!cam?.video || cam.face !== undefined) return;
  try { cam.face = await findFace(source(dir, cam.file), cam.duration, { log: console.log }); } catch (e) {
    console.log(`webcam: the face was not found (${e.message.split("\n")[0]}): the circle shows the picture's middle`);
    cam.face = null;
  }
  write(source(dir, "sources.json"), meta);
}

const loadEnv = (file) => {
  const raw = fs.readFileSync(file);
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
};

// ------------------------------------------------------------------------------------- new
async function cmdNew(dir, folder, opts) {
  if (!dir || !folder) fail("Usage: screencast.mjs new <dir> <recording-folder>");
  const facts = path.join(folder, "recording.json");
  if (!fs.existsSync(facts)) fail(`${folder} has no recording.json: give the folder rragent's recorder wrote (artifacts/recordings/<time>).`);
  if (fs.existsSync(source(dir, "sources.json"))) fail(`${rel(source(dir))} is in use already. To start over: rm -r ${rel(source(dir))}`);
  fs.mkdirSync(source(dir), { recursive: true });
  const rec = read(facts);
  const names = (rec.files || fs.readdirSync(folder)).map((f) => path.basename(f).replace(/\.[^.]+$/, ""))
    .filter((k) => [...VIDEO, "audio"].includes(k) && fs.readdirSync(folder).some((f) => f.startsWith(`${k}.`)));
  if (!names.length) fail(`${folder} holds none of screen, webcam, phone, phone-screen, audio.`);
  const started = rec.started || {};
  const t0 = Math.min(...names.map((k) => started[k]).filter(Number.isFinite));
  const s = settings(dir, opts);

  // every source converted at once, its activity measured from the same decoding
  console.log(`${names.length} sources, preparing them all at once …`);
  const sources = {}, grids = {}, counted = {}, done = {}, lengths = {};
  // how far each source is, every ten seconds, for the person watching the chat
  const ticker = setInterval(() => {
    console.log(`  preparing: ${names.map((k) => `${k} ${Math.min(99, Math.round((100 * (done[k] || 0)) / (lengths[k] || 1)))} %`).join(", ")}`);
  }, 10000);
  await Promise.all(names.map(async (k) => {
    const from = path.join(folder, fs.readdirSync(folder).find((f) => f.startsWith(`${k}.`)));
    const p0 = probe(from);
    lengths[k] = p0.duration;
    const file = p0.video ? `${k}.mp4` : `${k}.m4a`;
    if (p0.video) grids[k] = grid(p0);
    const frames = p0.video ? differ(grids[k]) : null;
    if (frames) frames.filter = grids[k].filter;
    const p = await prepare(from, source(dir, file), { fps: s.fps, frames, progress: (t) => { done[k] = t; } });
    if (frames) counted[k] = frames.counts;
    const offset = Number.isFinite(started[k]) && Number.isFinite(t0) ? (started[k] - t0) / 1000 : 0;
    sources[k] = { file, from: rel(from), offset: +offset.toFixed(3), duration: p.duration, width: p.width, height: p.height, video: p.video, audio: p.audio };
  })).finally(() => clearInterval(ticker));
  for (const k of names) {
    const p = sources[k];
    if (p.audio) {
      const env = envelope(samples(source(dir, p.file)));
      fs.writeFileSync(source(dir, `${k}.env`), Buffer.from(env.buffer));
      p.clarity = clarity(env);
    }
    console.log(`${k}: ${clock(p.duration, false)}${p.video ? `, ${p.width}×${p.height}` : ", sound"}, starts at ${p.offset.toFixed(2)} s${p.audio ? `, its microphone ${p.clarity} dB over the room` : ""}`);
  }

  // the main microphone: the one asked for, a recording of sound alone, else the clearest
  const heard = names.filter((k) => sources[k].audio);
  if (!heard.length) fail("No source carries sound: the cut follows what is said.");
  // (the same microphone in every source, as rragent's recorder does it: the webcam's file first)
  const prefer = ["audio", "webcam", "screen", "phone", "phone-screen"];
  const mic = opts.mic || [...heard].sort((a, b) => (a === "audio" ? -1 : b === "audio" ? 1 : 0)
    || sources[b].clarity - sources[a].clarity || prefer.indexOf(a) - prefer.indexOf(b))[0];
  if (!sources[mic]?.audio) fail(`--mic ${mic}: no such source with sound (${heard.join(", ")})`);
  const mainEnv = loadEnv(source(dir, `${mic}.env`));
  for (const k of heard) {
    if (k === mic) continue;
    const a = align(mainEnv, sources[mic].offset, loadEnv(source(dir, `${k}.env`)), sources[k].offset);
    sources[k].sync = a.score;
    if (a.moved) console.log(`${k}: laid onto the voice, ${a.moved > 0 ? "+" : ""}${a.moved} s (match ${a.score})`);
    else if (a.score < 0.5) console.log(`${k}: its sound does not match the voice (${a.score}): its start stays as recorded`);
    sources[k].offset = a.offset;
  }

  // the voice on the recording's timeline: the main microphone from 0, cleaned (rumble and hiss out)
  const voice = "voice.m4a";
  const delay = Math.round(sources[mic].offset * 1000);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", source(dir, sources[mic].file), "-vn",
    "-af", `${delay > 0 ? `adelay=${delay}:all=1,` : ""}highpass=f=80,afftdn=nf=-30:tn=1,lowpass=f=15000`,
    "-ac", "1", "-ar", "48000", "-c:a", "aac", "-b:a", "160k", source(dir, voice)], { stdio: ["ignore", "ignore", "inherit"] });
  const vp = probe(source(dir, voice));
  const venv = envelope(samples(source(dir, voice)));
  fs.writeFileSync(source(dir, "voice.env"), Buffer.from(venv.buffer));
  write(source(dir, "voice.loudness.json"), loudnessBlocks(source(dir, voice)));
  console.log(`voice: ${mic}'s microphone, cleaned → ${rel(source(dir, voice))}`);

  // where each picture moves, from the counts the conversion streamed, on the aligned clock; on a
  // screen, not where it shows the webcam's own picture (a preview of the camera in the page)
  const activity = {};
  if (counted.webcam) activity.webcam = samplesOf(counted.webcam, grids.webcam, sources.webcam.offset);
  for (const k of names.filter((x) => sources[x].video)) {
    const mirrored = k === "webcam" ? new Set() : mirrors(counted[k], sources[k].offset, activity.webcam);
    if (mirrored.size) console.log(`${k}: ${mirrored.size} cells show the webcam's picture (a preview in the page), left out of what moves`);
    activity[k] = samplesOf(counted[k], grids[k], sources[k].offset, mirrored);
    const moved = activity[k].filter((x) => x.b).length / Math.max(1, activity[k].length);
    console.log(`${k}: moves in ${Math.round(moved * 100)} % of the time`);
  }
  write(source(dir, "activity.json"), activity);


  const meta = { folder: rel(folder), t0, mic, voice, duration: vp.duration, sources };
  write(source(dir, "sources.json"), meta);
  await faceOfWebcam(dir, meta);
  const r = await route();
  console.log(`\nNext, the words of ${rel(source(dir, voice))}: with rragent's transcribe tool (file ${rel(source(dir, voice))}, words: true, names: the accounts, products and people that may be said), then ${cmd(`words ${rel(dir)} <its .words.json>`)}` +
    (r ? `; or ${cmd(`transcribe ${rel(dir)}`)} (ElevenLabs Scribe through ${r.via}, no name correction)` : ""));
}

// ----------------------------------------------------------------------------------- words
function voiceOf(dir) {
  const env = loadEnv(source(dir, "voice.env"));
  return { env, thr: threshold(env), blocks: read(source(dir, "voice.loudness.json")) };
}

function keepWords(dir, list, asr) {
  const meta = read(source(dir, "sources.json"));
  const { env, thr, blocks } = voiceOf(dir);
  const items = list.map((w) => ({ text: String(w.text ?? w.word ?? "").trim(), start: +w.start, end: +Math.max(w.end, w.start + 0.04),
    kind: w.kind || kindOf(w.text ?? w.word), ...(w.confidence != null ? { confidence: w.confidence } : {}), ...(w.heard ? { heard: w.heard } : {}) }))
    .filter((w) => w.text && Number.isFinite(w.start)).sort((a, b) => a.start - b.start);
  const moved = retime(items, env, thr);
  if (moved) console.log(`${moved} word timings set by the sound (the recognizer had them squeezed or stretched)`);
  const { kept, runs } = ghosts(items);
  for (const r of runs) console.log(`left out, the voice has no time for them (written twice): ${r}`);
  const speech = kept.filter((w) => w.kind === "word");
  if (!speech.length) fail("No speech in the voice: this tool cuts by what is said.");
  // the level of the speech over runs of words (a single word is often shorter than the 400 ms
  // a loudness block needs)
  const said = [];
  for (const w of speech) {
    const last = said.at(-1);
    if (last && w.start - last[1] < 0.3) last[1] = w.end; else said.push([w.start, w.end]);
  }
  const lufs = loudness(blocks, said);
  const words = kept.map((w, i) => ({ i, clip: 1, ...w }));
  write(source(dir, "words.json"), { asr, clips: { 1: { n: 1, file: meta.voice, duration: meta.duration, lufs } }, words });
  duck(dir, words);
  fs.writeFileSync(source(dir, "brief.md"), brief(dir));
  console.log(`${speech.length} words, ${kept.filter((w) => w.kind === "filler").length} "äh"s and the like, speech at ${lufs} LUFS → ${rel(source(dir, "brief.md"))}`);
  console.log(`\nNext: ${cmd(`propose ${rel(dir)}`)}, then read the brief (all of it) and write ${rel(path.join(dir, "cut.json"))}.`);
}

// the voice between the words lowered (keyboard, mouse, the room): a gain curve of 1 ms steps
// with 60 ms ramps, multiplied onto the cleaned voice
function duck(dir, words) {
  const s = settings(dir, {});
  const meta = read(source(dir, "sources.json"));
  const file = source(dir, meta.voice), clean = source(dir, "voice.clean.m4a");
  if (!s.duck) { fs.copyFileSync(file, clean); return; }
  const rate = 1000, n = Math.ceil(meta.duration * rate) + 1, low = 10 ** (-s.duck / 20);
  const gain = new Float32Array(n).fill(low);
  for (const w of words) {
    if (w.kind === "event") continue;
    const a = Math.max(0, Math.round((w.start - 0.12) * rate)), b = Math.min(n, Math.round((w.end + 0.2) * rate));
    for (let i = a; i < b; i++) gain[i] = 1;
  }
  // a pause under 0.4 s is no pause
  for (let i = 0, run = -1; i < n; i++) {
    if (gain[i] < 1 && run < 0) run = i;
    if (gain[i] === 1 && run >= 0) { if (i - run < 0.4 * rate && run > 0) gain.fill(1, run, i); run = -1; }
  }
  // ramps of 60 ms
  const ramp = 60, out = Float32Array.from(gain);
  for (let i = 0; i < n; i++) {
    let sum = 0, k = 0;
    for (let j = Math.max(0, i - ramp / 2); j < Math.min(n, i + ramp / 2); j++) { sum += gain[j]; k++; }
    out[i] = sum / k;
  }
  const curve = source(dir, "voice.gain.f32");
  fs.writeFileSync(curve, Buffer.from(out.buffer));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-f", "f32le", "-ar", String(rate), "-ac", "1", "-i", curve,
    "-filter_complex", "[1]aresample=48000[g];[0][g]amultiply[a]", "-map", "[a]", "-c:a", "aac", "-b:a", "160k", clean], { stdio: ["ignore", "ignore", "inherit"] });
  fs.rmSync(curve, { force: true });
}

function cmdWords(dir, file) {
  if (!fs.existsSync(source(dir, "sources.json"))) fail(`Run first: screencast.mjs new ${rel(dir)} <recording-folder>`);
  if (!file || !fs.existsSync(file)) fail(`Usage: screencast.mjs words ${rel(dir)} <words.json> (rragent's transcribe tool writes it beside the transcript with words: true)`);
  const j = read(file);
  const list = Array.isArray(j) ? j : j.words || [];
  if (!list.length) fail(`${file} holds no words.`);
  keepWords(dir, list, j.model || "rragent transcribe");
}

async function cmdTranscribe(dir) {
  if (!fs.existsSync(source(dir, "sources.json"))) fail(`Run first: screencast.mjs new ${rel(dir)} <recording-folder>`);
  const meta = read(source(dir, "sources.json"));
  console.log(`Listening to ${clock(meta.duration)} of voice with ${SCRIBE_MODEL} …`);
  let r;
  try { r = await scribe(source(dir, meta.voice), meta.duration, { log: console.log }); } catch (e) { fail(`✗ ${e.message}`); }
  console.log(`$${r.cost.toFixed(4)}`);
  keepWords(dir, r.words, SCRIBE_MODEL);
}

// ----------------------------------------------------------------------------------- brief
function sentences(words) {
  const out = [];
  let cur = null;
  for (const w of words) {
    if (w.kind === "event") continue;
    const prev = cur?.words.at(-1);
    if (!cur || (prev && (w.start - prev.end > 1.2 || /[.!?]$/.test(prev.text)))) { cur = { words: [] }; out.push(cur); }
    cur.words.push(w);
  }
  return out.map((c) => ({ from: c.words[0].i, to: c.words.at(-1).i, start: c.words[0].start, end: c.words.at(-1).end, text: c.words.map((w) => w.text).join(" ") }));
}

// the view that shows what happens in a span: the source that moves most, else the face
function viewOf(activity, sources, from, to) {
  const scores = Object.keys(activity).filter((k) => k !== "webcam").map((k) => ({ k, b: busy(activity[k], from, to), l: level(activity[k], from, to) }));
  scores.sort((a, b) => b.b * Math.sqrt(b.l) - a.b * Math.sqrt(a.l));
  const best = scores[0];
  if (best && best.b >= 0.25) return best.k;
  return sources.webcam ? "face" : best?.k || "screen";
}

const bars = (x) => "▁▂▃▄▅▆▇█"[Math.min(7, Math.floor(x * 8))];

function brief(dir) {
  const meta = read(source(dir, "sources.json"));
  const { words } = read(source(dir, "words.json"));
  const activity = read(source(dir, "activity.json"));
  const list = sentences(words);
  const lines = [];
  lines.push(`# The screencast of ${meta.folder}

${clock(meta.duration)} on one clock. The sources: ${Object.entries(meta.sources).map(([k, s]) => `**${k}** (${s.video ? `${s.width}×${s.height}` : "sound"}, from ${s.offset.toFixed(2)} s${s.sync != null ? `, laid onto the voice: match ${s.sync}` : ""})`).join(", ")}. The voice is ${meta.mic}'s microphone, cleaned.

## A good screencast cut

- **The result first** as a short hook (\`"hook": true\`, kept in its place later too), then the steps, then the proof; slips, repeats and talk about the recording out; as short as the story allows.
- **\`zoom\`: what must be readable** while the words are about it, \`[x0, y0, x1, y1]\` in 0–1 off the sheet's grid (the field typed in, the answer, the list picked from). The build makes it as large as the safe area allows and shows the screen around it; when what matters moves, split the keep at that word.
- **\`view\`** only where it is not the screen: \`phone-screen\` when the words are about the phone, \`face\` for an opening line or the last words.
- **Waits** (an agent working, an upload): the last word before them in \`waits\`, played fast. **Results** ("posted", "there it is") get \`"hold": 2.5\` and show the proof. Every keep holds ${read(source(dir, "settings.json")).tail ?? 0.45} s after its last word, the last one ${read(source(dir, "settings.json")).end ?? 1.5} s.

## What is said, sentence by sentence

Word numbers in brackets; "moves": how much each source changes during the sentence (▁ still … █ much).

| words | time | ${Object.keys(activity).join(" | ")} | said |
| --- | --- | ${Object.keys(activity).map(() => "---").join(" | ")} | --- |`);
  for (const s of list) {
    const lv = Object.keys(activity).map((k) => bars(busy(activity[k], s.start, s.end)));
    lines.push(`| ${s.from}–${s.to} | ${clock(s.start)}–${clock(s.end)} | ${lv.join(" | ")} | ${s.text.replace(/\|/g, "/")} |`);
  }
  lines.push(`\n## Every word\n\n${words.map((w) => `${w.i} ${w.kind === "filler" ? `(${w.text})` : w.kind === "event" ? w.text : w.text}${w.confidence != null && w.confidence < 0.6 ? "?" : ""}`).join(" · ")}\n
## cut.json

\`\`\`json
{
  "keep": [
    {"words": "212-230", "view": "phone-screen", "hold": 2.5, "label": "The result", "hook": true, "why": "the hook: the reel on the phone, again in its place later"},
    {"words": "12-40", "zoom": [0.15, 0.82, 0.5, 0.98], "label": "01 · Ask", "why": "the question typed into the chat"},
    {"words": "41-58", "zoom": [0.1, 0.15, 0.55, 0.5], "why": "the answer"}
  ],
  "waits": [40],
  "fixes": {"57": "storrito_com"}
}
\`\`\`
`);
  return lines.join("\n");
}

// --------------------------------------------------------------------------------- propose
function cmdPropose(dir) {
  if (!fs.existsSync(source(dir, "words.json"))) fail(`The words first: ${cmd(`words ${rel(dir)} <words.json>`)} or ${cmd(`transcribe ${rel(dir)}`)}`);
  const meta = read(source(dir, "sources.json"));
  const { words } = read(source(dir, "words.json"));
  const activity = read(source(dir, "activity.json"));
  // every sentence a keep, with a hold after a result; what each shows is the agent's to decide
  // (sheets), not a guess of this tool
  const keep = [], waits = [];
  for (const s of sentences(words)) {
    keep.push({ words: `${s.from}-${s.to}`, ...(CLAIM.test(s.text) ? { hold: 2.5 } : {}), start: s.start, end: s.end, text: s.text });
  }
  // a gap between two keeps in which a picture moves is a wait
  for (let k = 0; k + 1 < keep.length; k++) {
    const a = keep[k].end, b = keep[k + 1].start;
    if (b - a < 3) continue;
    const moves = Object.keys(activity).some((x) => x !== "webcam" && busy(activity[x], a, b, MOVING) > 0.15);
    // the last word said, not an "äh" after it: plan() looks for a wait after a word
    const [first, last] = range(keep[k].words);
    const said = words.slice(first, last + 1).filter((w) => w.kind === "word").at(-1);
    if (moves && said) waits.push(said.i);
  }
  const proposal = { keep: keep.map(({ start, end, text, ...k }) => ({ ...k, why: text.length > 90 ? `${text.slice(0, 60)} … ${text.slice(-25)}` : text })), waits };
  write(path.join(dir, "proposal.json"), proposal);
  console.log(`${keep.length} keeps, every sentence; ${waits.length} waits where a screen moves between two:\n`);
  for (const k of keep) console.log(`  [${k.words}]${k.hold ? ` hold ${k.hold} s` : ""}  ${clock(k.start)}  ${k.text.length > 100 ? `${k.text.slice(0, 70)} … ${k.text.slice(-25)}` : k.text}`);
  console.log(`\n→ ${rel(path.join(dir, "proposal.json"))}: every sentence, no story, no view, no zoom. Read ${rel(source(dir, "brief.md"))}; then ${cmd(`sheets ${rel(dir)} --proposal`)} shows what each sentence's moment looks like on every source. Write ${rel(path.join(dir, "cut.json"))}: the story (the result first as a hook), and for every keep the "zoom" on what must be readable (and a "view" where it is not the screen), from its words and its sheet. Then ${cmd(`build ${rel(dir)}`)}`);
}

// ---------------------------------------------------------------------------------- sheets
// What each keep shows, to decide by: one image per keep with the frames of every source (rows:
// the screen, the phone's screen or camera, the webcam) at its first, middle and last moment and
// where a screen changes almost whole within it (columns), each with its time; the screens with
// a blue line every tenth, to name a zoom box by. Beside it, printed: the keep's words and times.
// The agent reads both and decides the keep's view and zoom; the tool decides nothing.
// the times in the frames when this ffmpeg can write text and the machine has a font; else only
// in the printed lines
function labelFont() {
  const filters = spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" }).stdout || "";
  if (!/\sdrawtext\s/.test(filters)) return null;
  const fc = spawnSync("fc-match", ["-f", "%{file}", "sans:bold"], { encoding: "utf8" });
  const found = fc.status === 0 && fc.stdout.trim();
  return [found, "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"].find((f) => f && fs.existsSync(f)) || null;
}

function cmdSheets(dir, opts) {
  const cutFile = fs.existsSync(path.join(dir, "cut.json")) && !opts.proposal ? path.join(dir, "cut.json") : path.join(dir, "proposal.json");
  if (!fs.existsSync(cutFile)) fail(`Draft the cut first: ${cmd(`propose ${rel(dir)}`)}`);
  const { keep = [] } = read(cutFile);
  const meta = read(source(dir, "sources.json"));
  const { words } = read(source(dir, "words.json"));
  const activity = read(source(dir, "activity.json"));
  const order = ["screen", "phone-screen", "phone", "webcam"].filter((k) => meta.sources[k]?.video);
  if (!order.length) fail("✗ The recording has no picture to make sheets of: decide by the words alone.");
  // --keeps 3,5 or 3-5,8
  let only = null;
  if (opts.keeps) {
    only = new Set();
    for (const part of String(opts.keeps).split(",")) {
      const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
      if (!m) fail(`--keeps is a list of keep numbers and ranges, like 3,5 or 3-5,8 (not "${part}")`);
      for (let k = Number(m[1]); k <= Number(m[2] ?? m[1]); k++) only.add(k - 1);
    }
  }
  const out = path.join(dir, "sheets");
  fs.mkdirSync(out, { recursive: true });
  const FONT = labelFont();
  console.log(`From ${rel(cutFile)}: ${keep.length} keeps. Read each sheet with its words, then set the keep's "zoom" (and "view" where it is not the screen) in cut.json.\n`);
  for (const [k, kp] of keep.entries()) {
    if (only && !only.has(k)) continue;
    const r = range(kp.words);
    if (!r) continue;
    const said = words.slice(r[0], r[1] + 1).filter((w) => w.kind === "word");
    if (!said.length) continue;
    const from = said[0].start, to = said.at(-1).end;
    // the moments: the first and the last always, then where a screen changes almost whole and the
    // middle, each at least 0.8 s from those taken, five at most
    const changes = order.filter((x) => x !== "webcam").flatMap((x) => scenes(activity[x] || [], from, to)).map((t) => t + 0.3);
    const clampT = (t) => +Math.min(Math.max(t, from), to).toFixed(2);
    const first = clampT(from + 0.2), last = clampT(to - 0.2);
    const moments = [first];
    if (last - first > 0.8) moments.push(last);
    for (const t of [...changes, (from + to) / 2].map(clampT)) {
      if (moments.length >= 5) break;
      if (moments.every((m) => Math.abs(m - t) > 0.8)) moments.push(t);
    }
    moments.sort((a, b) => a - b);
    const inputs = [], rows = [];
    let input = 0;
    // a cell's size per source: every cell of a row alike, even sides
    const even = (v) => Math.max(2, Math.round(v / 2) * 2);
    const sizeOf = (x) => {
      const src = meta.sources[x], tall = src.height > src.width * 1.25;
      if (x === "webcam") return [320, even((320 * src.height) / src.width)];
      return tall ? [even((420 * src.width) / src.height), 420] : [640, even((640 * src.height) / src.width)];
    };
    for (const x of order) {
      const src = meta.sources[x], [cw, ch] = sizeOf(x);
      const grid = x === "webcam" ? "" : ",drawgrid=w=iw/10:h=ih/10:t=1:color=0x00a0ff@0.55";
      const cells = moments.map((t) => {
        const at = t - src.offset;
        // a moment the source does not cover (it started later, or ended): an empty cell, said so
        const covered = at >= 0 && at < src.duration - 0.05;
        if (covered) inputs.push("-ss", at.toFixed(2), "-i", source(dir, src.file));
        else inputs.push("-f", "lavfi", "-i", `color=c=0x303030:s=${cw}x${ch}:d=0.1`);
        const text = `${x} ${clock(t).replace(":", "\\:")}${covered ? "" : " (not recorded then)"}`;
        const label = FONT ? `,drawtext=fontfile=${FONT}:text='${text}':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4` : "";
        return `[${input++}:v]trim=end_frame=1,scale=${cw}:${ch}${covered ? grid : ""}${label},setsar=1,format=yuv420p,pad=iw+6:ih+6:3:3:color=0x202020`;
      });
      rows.push(cells);
    }
    // each row its cells side by side, the rows one under the other, the narrower ones padded
    const parts = [];
    rows.forEach((cells, ri) => {
      cells.forEach((c, ci) => parts.push(`${c}[c${ri}_${ci}]`));
      parts.push(cells.length > 1 ? `${cells.map((_, ci) => `[c${ri}_${ci}]`).join("")}hstack=inputs=${cells.length}[r${ri}]` : `[c${ri}_0]null[r${ri}]`);
    });
    const widths = order.map((x) => (sizeOf(x)[0] + 6) * moments.length);
    const W = Math.max(...widths);
    rows.forEach((_, ri) => parts.push(`[r${ri}]pad=${W}:ih:0:0:color=0x202020[p${ri}]`));
    parts.push(rows.length > 1 ? `${rows.map((_, ri) => `[p${ri}]`).join("")}vstack=inputs=${rows.length}[out]` : "[p0]null[out]");
    const file = path.join(out, `keep-${String(k + 1).padStart(2, "0")}.jpg`);
    fs.rmSync(file, { force: true });
    const res = spawnSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", parts.join(";"), "-map", "[out]", "-frames:v", "1", "-q:v", "4", file], { encoding: "utf8" });
    if (res.status || !fs.existsSync(file)) fail(`✗ the sheet of keep ${k + 1}: ${(res.stderr || "").trim().split("\n").pop() || "ffmpeg made no image"}`);
    const text = said.map((w) => w.text).join(" ");
    console.log(`keep ${k + 1} [${kp.words}] ${clock(from)}–${clock(to)}${kp.view ? ` (now: view ${kp.view}${kp.zoom ? `, zoom ${JSON.stringify(kp.zoom)}` : ""})` : ""} → ${rel(file)}`);
    console.log(`  rows ${order.join(", ")}; columns at ${moments.map((t) => clock(t)).join(", ")} of the recording`);
    console.log(`  "${text.length > 220 ? `${text.slice(0, 160)} … ${text.slice(-50)}` : text}"`);
    if (changes.length) console.log(`  the screen changes almost whole at ${changes.map((t) => clock(t)).join(", ")}: a part before and after may need its own view or zoom (split the keep at the word)`);
  }
}

// ----------------------------------------------------------------------------------- build
// The captions skill of agentitos: CAPTIONS_TOOL, else beside this skill, else in the machine's
// clone of the skills.
function captionsTool() {
  const skill = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const candidates = [process.env.CAPTIONS_TOOL, path.join(skill, "..", "captions", "tools", "captions.mjs"), "/home/sprite/skills/captions/tools/captions.mjs"];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function captionWords(dir, words, captions, { width, height, duration }) {
  const keys = new Set(captions.highlight || []);
  const file = path.join(dir, "captions.json");
  write(file, { width, height, duration, words: words.map((w) => ({ i: w.i, text: w.text, start: w.start, end: w.end, ...(keys.has(w.i) ? { highlight: true } : {}) })) });
  return file;
}

function runCaptions(args) {
  const tool = captionsTool();
  if (!tool) fail("✗ The captions need agentitos' captions skill beside this one (or CAPTIONS_TOOL naming its tools/captions.mjs).");
  const r = spawnSync(process.execPath, [tool, ...args], { encoding: "utf8" });
  if (r.status) fail(`✗ captions: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

// what to do to find a zoom box for keep k
function screencastFrameHint(dir, k) {
  return `look at a moment of keep ${k + 1} with: ${cmd(`frame ${rel(dir)} <m:ss>`)}`;
}

// the source a view shows; the phone's screen stands in for "phone" and the other way round
function sourceOf(view, sources) {
  if (view === "face") return sources.webcam ? "webcam" : Object.keys(sources).find((k) => sources[k].video);
  if (sources[view]?.video) return view;
  const alt = { phone: "phone-screen", "phone-screen": "phone" }[view];
  if (alt && sources[alt]?.video) return alt;
  return Object.keys(sources).find((k) => k !== "webcam" && sources[k].video) || "webcam";
}

async function cmdBuild(dir, opts) {
  if (!fs.existsSync(source(dir, "words.json"))) fail(`The words first: ${cmd(`words ${rel(dir)} <words.json>`)}`);
  const cutFile = path.join(dir, "cut.json");
  if (!fs.existsSync(cutFile)) fail(`Write ${rel(cutFile)} first (${cmd(`propose ${rel(dir)}`)} drafts one), as ${rel(source(dir, "brief.md"))} says.`);
  let cut;
  try { cut = read(cutFile); } catch (e) { fail(`✗ ${rel(cutFile)} is no valid JSON: ${e.message}`); }
  const s = settings(dir, opts);
  const meta = read(source(dir, "sources.json"));
  await faceOfWebcam(dir, meta);
  const { clips, words } = read(source(dir, "words.json"));
  const activity = read(source(dir, "activity.json"));
  const sources = meta.sources;
  for (const [k, keep] of (cut.keep || []).entries()) {
    if (keep.view && ![...VIEWS, "auto"].includes(keep.view)) fail(`✗ keep ${k + 1}: "view" is one of ${[...VIEWS, "auto"].join(", ")}`);
    if (keep.circle !== undefined && typeof keep.circle !== "boolean") fail(`✗ keep ${k + 1}: "circle" is false (no webcam circle while it plays) or true`);
  }

  // the pictures that move in a pause: any of the screens; in a wait someone named, anything
  // that changes on them (an agent's chat, a progress bar change a few pixels, but they are
  // the action)
  const shows = Object.keys(activity).filter((k) => k !== "webcam");
  const moves = (_clip, from, to, wait = false) => {
    const spans = shows.flatMap((k) => moving(activity[k], from, to, wait ? ACTIVE : MOVING)).sort((a, b) => a.from - b.from);
    return spans.reduce((out, x) => {
      const last = out.at(-1);
      if (last && x.from <= last.to) last.to = Math.max(last.to, x.to); else out.push({ ...x });
      return out;
    }, []);
  };
  const { env, thr, blocks } = voiceOf(dir);
  const r = plan(words, cut, s, { 1: { env, thr, blocks, duration: meta.duration } }, moves);
  if (r.errors.length) fail(r.errors.map((e) => `✗ ${e}`).join("\n") + `\nFix ${rel(cutFile)} and build again.`);
  if (!r.pieces.length) fail("✗ Nothing to play: the keeps hold no words.");

  // the view and the zoom of every piece: a keep's view and crop over the keep's whole span, so
  // that its shot does not jump; a piece that shows a pause by what moves in it
  const layout = layoutOf(s, cut);
  const { width, height } = layout;
  const content = layout.areas.content;
  const tall = (src) => sources[src].height > sources[src].width * 1.25;
  // a screen in a narrower frame is zoomed in at least to half its width: whole, it is too
  // small to read; a phone's screen is shown whole unless a keep says where to zoom
  const maxWidth = height >= width * 1.5 ? 0.5 : 1;
  const zoomOf = (src, from, to) => {
    if (tall(src)) return [0, 0, 1, 1];
    const f = focus(activity[src] || [], from, to) || focus(activity[src] || [], from - 5, to + 5)
      || (maxWidth < 1 ? { box: [0.25, 0.1, 0.75, 0.6], centre: [0.5, 0.35] } : null);
    return cropFor(f, sources[src], content, { maxWidth });
  };
  const span = (k) => {
    const ps = r.pieces.filter((p) => p.keep === k && !p.mute);
    return ps.length ? [Math.min(...ps.map((p) => p.in)), Math.max(...ps.map((p) => p.out))] : null;
  };
  // the view and the zoom are the agent's decision per keep (sheets): without a view a keep shows
  // the screen (a screencast is about it), without a zoom the whole source; "auto" asks this tool
  // for its guess by what moved
  const fallbackView = sources.screen?.video ? "screen" : Object.keys(sources).find((k) => k !== "webcam" && sources[k].video) || "face";
  const keepView = (cut.keep || []).map((keep, k) => {
    const sp = span(k);
    const view = keep.view === "auto" ? (sp ? viewOf(activity, sources, sp[0], sp[1]) : "face") : keep.view || fallbackView;
    const src = sourceOf(view, sources);
    const zoom = keep.zoom ?? "off";
    if (!Array.isArray(zoom) && zoom !== "off" && zoom !== "auto") fail(`✗ keep ${k + 1}: "zoom" is a box [x0, y0, x1, y1], "off" or "auto", not ${JSON.stringify(zoom)}`);
    if (Array.isArray(zoom)) {
      const [x0, y0, x1, y1] = zoom.map(Number);
      if (zoom.length !== 4 || ![x0, y0, x1, y1].every((v) => v >= 0 && v <= 1) || x1 - x0 < 0.02 || y1 - y0 < 0.02) {
        fail(`✗ keep ${k + 1}: "zoom" is [x0, y0, x1, y1], each 0–1, left top right bottom, x1 > x0 and y1 > y0 (${screencastFrameHint(dir, k)})`);
      }
    }
    const c = view === "face" ? null
      : Array.isArray(zoom) ? zoom.map(Number)
      : zoom === "off" || !sp || !activity[src] ? [0, 0, 1, 1]
      : zoomOf(src, sp[0] - 0.5, sp[1] + 0.5);
    return { view, source: src, crop: c };
  });
  // a wait shows where something happens: the screen that changes most in it, the laptop's when
  // nothing does; never the face or an idle phone. Every other piece, a pause inside a keep too,
  // keeps its keep's view, so that the shot does not jump for a moment.
  const screens = Object.keys(activity).filter((k) => k !== "webcam");
  const waitSource = (from, to) => {
    const ranked = screens.map((k) => ({ k, b: busy(activity[k], from, to) })).sort((a, b) => b.b - a.b);
    if (ranked[0] && ranked[0].b > 0.02) return ranked[0].k;
    return sources.screen?.video ? "screen" : ranked[0]?.k || null;
  };
  for (const p of r.pieces) {
    const kv = keepView[p.keep], keep = cut.keep[p.keep], zoom = keep.zoom;
    if (p.wait) {
      // the keep's "waitView" when it names one, else where something happens; a recording
      // without any screen waits on the face
      const chosen = keep.waitView && keep.waitView !== "auto" ? sourceOf(keep.waitView, sources) : waitSource(p.in, p.out);
      p.source = chosen || "webcam";
      p.view = !chosen || keep.waitView === "face" ? "face" : p.source;
      if (p.view === "face") { p.crop = null; continue; }
      p.crop = zoom === "auto" ? zoomOf(p.source, p.in, p.out) : Array.isArray(zoom) && p.source === kv.source ? kv.crop : [0, 0, 1, 1];
    } else {
      Object.assign(p, kv);
    }
    if (keep.circle === false) p.pip = false;
  }

  // the zoom per scene: where a screen changes almost whole within a keep (another tab, a page, a
  // dialog), each part gets its own crop, and a piece across such a change is shown in parts (its
  // sound runs on). A zoom set by hand stays as it is (check says when it spans a change).
  const sceneCuts = (k, src) => {
    const sp = span(k);
    return sp && activity[src] ? scenes(activity[src], sp[0], sp[1]) : [];
  };
  for (const p of r.pieces) {
    const zoom = cut.keep[p.keep].zoom;
    if (p.view === "face" || !p.source || tall(p.source) || zoom !== "auto") continue;
    const sp = span(p.keep) || [p.in, p.out];
    const cuts = p.wait ? scenes(activity[p.source] || [], p.in, p.out) : sceneCuts(p.keep, p.source);
    if (!cuts.length) continue;
    const bounds = [Math.min(sp[0], p.in), ...cuts, Math.max(sp[1], p.out)];
    // the scene a moment is in, and its crop over the scene's part of the keep
    const sceneOf = (t) => { let i = 0; while (i + 1 < bounds.length - 1 && t >= bounds[i + 1]) i++; return i; };
    // a scene's crop from its own changes: from its cut on, up to a sample before the next cut
    const cropOf = (i) => {
      const from = p.wait ? Math.max(p.in, bounds[i]) : bounds[i], to = p.wait ? Math.min(p.out, bounds[i + 1]) : bounds[i + 1];
      return zoomOf(p.source, from, i + 2 < bounds.length ? to - 0.3 : to);
    };
    const inside = cuts.filter((t) => t > p.in + 0.5 && t < p.out - 0.5);
    if (!inside.length) { p.crop = cropOf(sceneOf((p.in + p.out) / 2)); continue; }
    const edges = [p.in, ...inside, p.out];
    p.segments = edges.slice(0, -1).map((from, i) => ({ in: from, out: edges[i + 1], crop: cropOf(sceneOf((from + edges[i + 1]) / 2)) }));
    p.crop = p.segments[0].crop;
  }

  // the brand, the labels, the captions, the music
  const brandFile = s.brand || (fs.existsSync("brand/DESIGN.md") ? "brand/DESIGN.md" : null);
  const brand = brandOf(brandFile);
  const labels = [];
  for (const [k, keep] of (cut.keep || []).entries()) {
    if (!keep.label) continue;
    const ps = r.pieces.filter((p) => p.keep === k);
    if (ps.length) labels.push({ text: keep.label, start: ps[0].start, duration: ps.at(-1).start + ps.at(-1).duration - ps[0].start });
  }
  const out = path.resolve(s.out || path.join(dir, "composition"));
  const title = s.title || cut.title || path.basename(path.resolve(dir));
  let captions = null;
  const caps = captionsOf(cut);
  fs.rmSync(path.join(out, "captions"), { recursive: true, force: true });
  if (caps) {
    const file = captionWords(dir, r.words, caps, { width, height, duration: r.duration });
    const said = runCaptions(["build", file, path.join(out, "captions"), "--style", caps.style || "hormozi",
      ...(s.platform ? ["--platform", platformList(s.platform).join(",")] : []),
      ...(caps.brand || brandFile ? ["--brand", caps.brand || brandFile] : [])]);
    captions = said.match(/<div id="captions"[^\n]*<\/div>/)?.[0] ?? null;
  }
  let music = null;
  if (cut.music?.file) {
    if (!fs.existsSync(cut.music.file)) fail(`✗ cut.json "music": there is no ${cut.music.file}`);
    const speech = [];
    for (const w of r.words) {
      const last = speech.at(-1);
      if (last && w.start - last.to < 0.8) last.to = w.end; else speech.push({ from: w.start, to: w.end });
    }
    music = { file: cut.music.file, volume: cut.music.volume, from: cut.music.from, speech };
  }

  const voiceFile = fs.existsSync(source(dir, "voice.clean.m4a")) ? "voice.clean.m4a" : meta.voice;
  // the voice and the webcam as one track each for the whole cut (a browser plays about 75 media
  // elements on a page, a clip per piece ran out of them)
  fs.mkdirSync(path.join(out, "assets"), { recursive: true });
  voiceTrack(source(dir, voiceFile), r.pieces, path.join(out, "assets", "voice.cut.m4a"));
  let camera = null;
  if (sources.webcam?.video) {
    cameraTrack(source(dir, sources.webcam.file), sources.webcam.offset, r.pieces, path.join(out, "assets", "camera.mp4"), { fps: s.fps, parts: source(dir, "camera.parts") });
    camera = "camera.mp4";
  }
  // behind the shots, each piece's screen blurred ("background": "plain" for the brand's colours);
  // the face's pieces show the screen too, hidden under the face
  let backdrop = null;
  const screenOf = (p) => (p.view !== "face" && sources[p.source]?.video && p.source !== "webcam" ? p.source : fallbackView !== "face" ? sourceOf(fallbackView, sources) : null);
  if (cut.background !== "plain" && r.pieces.some(screenOf)) {
    const any = r.pieces.map(screenOf).find(Boolean);
    backdropTrack((p) => { const k = screenOf(p) || any; return { file: source(dir, sources[k].file), offset: sources[k].offset }; },
      r.pieces, path.join(out, "assets", "backdrop.mp4"), { fps: s.fps, parts: source(dir, "backdrop.parts") });
    backdrop = "backdrop.mp4";
  }
  writeComposition(out, { title, lang: s.lang, width, height, fps: s.fps, pieces: r.pieces, sources, dir, voice: "voice.cut.m4a", camera, backdrop, labels, captions, music, brand, areas: layout.areas });

  write(path.join(dir, "edit.json"), {
    out: rel(out), width, height, fps: s.fps, duration: r.duration, recorded: meta.duration,
    pieces: r.pieces.map((p) => ({ in: +p.in.toFixed(3), out: +p.out.toFixed(3), start: +p.start.toFixed(3), duration: +p.duration.toFixed(3), keep: p.keep,
      view: p.view, source: p.source, ...(p.crop && p.crop.join() !== "0,0,1,1" ? { crop: p.crop } : {}), ...(p.pip === false ? { circle: false } : {}),
      ...(p.segments ? { segments: p.segments.map((g) => ({ in: +g.in.toFixed(3), out: +g.out.toFixed(3), crop: g.crop })) } : {}), lufs: p.lufs, gain: p.gain,
      rate: +p.rate.toFixed(3), lapse: +p.lapse.toFixed(2),
      ...(p.words.length ? { words: [p.words[0], p.words.at(-1)] } : { shows: true, ...(p.wait ? { wait: true } : {}), ...(p.hold ? { hold: true } : {}) }) })),
    removed: r.removed, warnings: r.warnings, words: r.words,
  });
  const views = {};
  for (const p of r.pieces) views[p.view] = (views[p.view] || 0) + p.duration;
  console.log(`${rel(out)}: ${width}×${height}, ${clock(r.duration)} from ${clock(meta.duration)} recorded, ${r.pieces.length} pieces; on screen: ${Object.entries(views).sort((a, b) => b[1] - a[1]).map(([v, t]) => `${v} ${Math.round(t)} s`).join(", ")}` +
    `${r.pieces.some((p) => p.crop && p.crop.join() !== "0,0,1,1") ? `, ${r.pieces.filter((p) => p.crop && p.crop.join() !== "0,0,1,1").length} zoomed in` : ""}${labels.length ? `, ${labels.length} labels` : ""} → index.html`);
  if (caps) console.log(`Captions: ${caps.style || "hormozi"}${caps.highlight?.length ? `, ${caps.highlight.length} key words` : ""}${cut.captions ? "" : " (the default; \"captions\": false in cut.json for none)"}`);
  else if (cut.captions !== false) console.log("No captions: agentitos' captions skill is not beside this one.");
  if (s.speed !== 1) console.log(`Played at ${s.speed}× (--speed).`);
  console.log(`Laid out clear of ${layout.zones.platforms.map((p) => p.name).join(", ")}${layout.zones.fallback ? " (no --platform: the usual ones of this frame; name where it goes with --platform)" : ""}.`);
  // a platform named that has no numbers for this frame: who stands in for it
  for (const n of layout.zones.notes.filter((n) => n.includes("stand in") || n.includes("stands in"))) console.log(`  ${n}`);
  console.log(`Next: ${cmd(`check ${rel(dir)}`)}`);
}

// --------------------------------------------------------------------------------- captions
async function cmdCaptions(dir, opts) {
  const cutFile = path.join(dir, "cut.json"), editFile = path.join(dir, "edit.json");
  if (!fs.existsSync(editFile)) fail(`Build first: ${cmd(`build ${rel(dir)}`)}`);
  // the platform first: a wrong one fails before the key words are marked (and paid for)
  if (opts.platform !== undefined) settings(dir, { platform: opts.platform });
  const cut = read(cutFile);
  if (opts.off) {
    cut.captions = false;
  } else {
    const e = read(editFile);
    const file = captionWords(dir, e.words, {}, e);
    // the key words by the captions skill's model; without it (it needs OPENROUTER_API_KEY) the
    // captions come without them
    const tool = captionsTool();
    if (!tool) fail("✗ The captions need agentitos' captions skill beside this one (or CAPTIONS_TOOL naming its tools/captions.mjs).");
    const marked = spawnSync(process.execPath, [tool, "mark", file, ...(opts.product ? ["--product", opts.product] : [])], { encoding: "utf8" });
    if (marked.status) console.log(`No key words marked (${(marked.stderr || marked.stdout).trim().split("\n").pop()}): the captions come without; mark them by hand with "highlight" (word numbers) in cut.json's "captions".`);
    const highlight = read(file).words.filter((w) => w.highlight).map((w) => w.i);
    cut.captions = { style: opts.style || cut.captions?.style || "hormozi", highlight, ...(opts.brand || cut.captions?.brand ? { brand: opts.brand || cut.captions.brand } : {}) };
    console.log(`Captions ${cut.captions.style}: ${highlight.length} key words (${highlight.map((i) => e.words.find((w) => w.i === i)?.text).join(", ")})`);
  }
  fs.writeFileSync(cutFile, JSON.stringify(cut, null, 2) + "\n");
  await cmdBuild(dir, {});
}

// ----------------------------------------------------------------------------------- check
function cmdCheck(dir) {
  const file = path.join(dir, "edit.json");
  if (!fs.existsSync(file)) fail(`Build first: ${cmd(`build ${rel(dir)}`)}`);
  const e = read(file);
  const meta = read(source(dir, "sources.json"));
  const { words } = read(source(dir, "words.json"));
  const cut = read(path.join(dir, "cut.json"));
  const text = (a, b) => words.slice(a, b + 1).filter((w) => w.kind === "word").map((w) => cut.fixes?.[w.i] ?? w.text).filter(Boolean).join(" ");
  const errors = [], warnings = [...e.warnings];
  const z = (p) => (p.crop ? " zoomed" : "");

  console.log(`${clock(e.recorded)} recorded → ${clock(e.duration)} cut, ${e.pieces.length} pieces\n\nAs it plays:`);
  e.pieces.forEach((p, k) => {
    const where = `${p.view}${z(p)}, recorded at ${clock(p.in)}`;
    if (p.shows) {
      console.log(`${String(k + 1).padStart(3)} ${clock(p.start).padStart(6)}  (no words: ${p.hold ? "held after the words, the voice faded" : p.wait ? "a wait" : "the picture moves"}, ${(p.out - p.in).toFixed(1)} s${p.rate > 1 ? ` ×${p.rate} in ${p.duration.toFixed(1)} s` : ""})   (${where})`);
      return;
    }
    console.log(`${String(k + 1).padStart(3)} ${clock(p.start).padStart(6)}  [${p.words[0]}–${p.words[1]}] ${text(p.words[0], p.words[1])}   (${where}, ${p.gain >= 0 ? "+" : ""}${p.gain} dB)`);
    const first = words[p.words[0]], last = words[p.words[1]];
    // no cut inside a word: a piece starts before its first word and ends after its last
    if (p.in > first.start + 0.02) errors.push(`piece ${k + 1} starts ${(p.in - first.start).toFixed(2)} s into "${first.text}": start the keep at the word before`);
    const next = e.pieces[k + 1];
    const goesOn = next && next.keep === p.keep && (!next.shows || next.hold);
    if (!goesOn && p.out < last.end + 0.12) warnings.push(`piece ${k + 1} ends ${(p.out - last.end).toFixed(2)} s after "${last.text}" (the next words follow right after it in the recording): it may sound cut off; end the keep a word later, or where the speaker pauses`);
    if (p.duration < 0.6 && p.words[1] - p.words[0] < 2) warnings.push(`piece ${k + 1} ("${text(p.words[0], p.words[1])}") is ${p.duration.toFixed(2)} s long: that sounds chopped; keep the whole phrase`);
  });

  // the end holds
  const lastWord = e.words.at(-1);
  if (lastWord && e.duration - lastWord.end < 1) warnings.push(`the cut ends ${(e.duration - lastWord.end).toFixed(1)} s after its last word: give the end a moment ("hold": 1.5 on the last keep)`);

  // the sources are on one clock
  for (const [k, s] of Object.entries(meta.sources)) {
    if (s.sync != null && s.sync < 0.5 && e.pieces.some((p) => p.source === k)) warnings.push(`${k} could not be laid onto the voice by its sound (match ${s.sync}): it follows recording.json's start, which can be some 100 ms off; watch the lips and the clicks`);
  }

  // every claim gets its proof: the shot after the words that say it is there shows a screen,
  // for 2 s at least
  const phrase = (i) => e.words.slice(Math.max(0, i - 2), i + 1).map((x) => x.text).join(" ");
  for (const [i, w] of e.words.entries()) {
    if (!CLAIM.test(phrase(i)) || (i > 0 && CLAIM.test(phrase(i - 1)))) continue;
    const after = e.pieces.filter((p) => p.start + p.duration > w.end && p.start < w.end + 2);
    const covered = after.reduce((t, p) => t + Math.min(p.start + p.duration, w.end + 2) - Math.max(p.start, w.end), 0);
    if (covered < 1.9) warnings.push(`"${w.text}" at ${clock(w.end)} of the cut: the video ends ${covered.toFixed(1)} s later; hold that keep 2.5 s ("hold": 2.5) so the proof can be seen`);
    else if (after.every((p) => p.view === "face")) warnings.push(`"${w.text}" at ${clock(w.end)} of the cut: the shot after it is the face; show the proof (the phone's screen, the page): "view" on that keep`);
  }

  // a zoom set by hand is for one scene: when the screen changes almost whole within its keep (a
  // tab, a page, a dialog), the box shows the wrong part before or after
  const activity = read(source(dir, "activity.json"));
  for (const [k, keep] of (cut.keep || []).entries()) {
    if (!Array.isArray(keep.zoom)) continue;
    const ps = e.pieces.filter((p) => p.keep === k && !p.wait && p.source && p.source !== "webcam");
    if (!ps.length || !activity[ps[0].source]) continue;
    const cuts = scenes(activity[ps[0].source], Math.min(...ps.map((p) => p.in)) + 0.5, Math.max(...ps.map((p) => p.out)) - 0.5);
    for (const t of cuts) {
      const near = words.filter((w) => w.kind === "word").reduce((best, w) => (Math.abs(w.start - t) < Math.abs(best.start - t) ? w : best));
      warnings.push(`keep ${k + 1}'s "zoom" is one box, but its screen changes almost whole at ${clock(t)} of the recording (near word ${near.i} "${near.text}"): the box fits only one part; split the keep there and give each part its own "zoom" (frame shows both)`);
    }
  }

  // a screen shown whole in a narrow frame, without a decision about it: hard to read
  const settingsNow = settings(dir, {});
  const [fw, fh] = FRAMES[settingsNow.frame];
  for (const [k, keep] of (cut.keep || []).entries()) {
    if (keep.zoom !== undefined || !e.pieces.some((p) => p.keep === k && p.source === "screen" && !p.wait)) continue;
    const src = meta.sources.screen;
    if (src && fh > fw && src.width > src.height) warnings.push(`keep ${k + 1} shows the whole screen in a ${settingsNow.frame} frame, where its text is small: decide from its sheet whether to zoom ("zoom": [x0, y0, x1, y1]) or keep it whole on purpose ("zoom": "off")`);
  }

  // a long stretch without words at its own speed is a wait to speed up
  for (const [k, p] of e.pieces.entries()) {
    if (p.shows && !p.hold && (p.lapse ?? p.rate) <= 1.05 && p.duration > 6) warnings.push(`piece ${k + 1} shows ${p.duration.toFixed(1)} s without words at their own speed: a wait? list the last word before it in "waits"`);
  }

  // a browser plays about 75 media elements on a page; past that the preview goes silent or black
  const page = fs.readFileSync(path.join(path.resolve(e.out), "index.html"), "utf8");
  const media = (page.match(/<(video|audio)\b/g) || []).length;
  if (media > 70) warnings.push(`the preview has ${media} media elements, near the ${75} a browser plays on a page: past them it goes silent or black; fewer keeps, or keeps that join`);

  // HyperFrames' own check of the project
  const [hf, ...pre] = hyperframes();
  const lint = spawnSync(hf, [...pre, "lint"], { cwd: path.resolve(e.out), encoding: "utf8" });
  for (const m of (lint.stdout + lint.stderr).matchAll(/✗\s+(.+)/g)) errors.push(`HyperFrames: ${m[1]}`);
  // its advice to split a long file into sub-compositions does not fit a generated one
  for (const m of (lint.stdout + lint.stderr).matchAll(/⚠\s+(.+)/g)) if (!/timeline_track_too_dense|composition_file_too_large/i.test(m[1])) warnings.push(`HyperFrames: ${m[1]}`);

  if (errors.length || warnings.length) console.log("");
  for (const x of errors) console.log(`✗ ${x}`);
  for (const x of warnings) console.log(`⚠ ${x}`);
  console.log(errors.length ? "\nFix the errors (✗) and build again." : `\n${warnings.length ? "No errors." : "No problems."} The preview: ${e.out}/index.html`);
  if (errors.length) process.exit(1);
}

// -------------------------------------------------------------------------------------- at
function cmdAt(dir, when) {
  const file = path.join(dir, "edit.json");
  if (!fs.existsSync(file)) fail(`Build first: ${cmd(`build ${rel(dir)}`)}`);
  const t = seconds(when);
  if (!Number.isFinite(t)) fail("Usage: screencast.mjs at <dir> <m:ss>, a moment of the cut as the preview shows it (1:23 or 83.5)");
  const e = read(file);
  const { words } = read(source(dir, "words.json"));
  const cut = read(path.join(dir, "cut.json"));
  const k = e.pieces.findIndex((p) => t >= p.start && t < p.start + p.duration);
  if (k < 0) fail(`The cut is ${clock(e.duration)} long.`);
  const p = e.pieces[k], keep = cut.keep[p.keep] || { words: "?", why: "cut.json changed since the last build: build again" };
  const said = e.words.filter((w) => Math.abs((w.start + w.end) / 2 - t) < 2.5).map((w) => w.text).join(" ");
  console.log(`${clock(t)} of the cut: piece ${k + 1} of keep ${p.keep + 1} ([${keep.words}]${keep.why ? `, ${keep.why}` : ""})`);
  console.log(`  plays ${clock(p.in)}–${clock(p.out)} of the recording${p.rate > 1 ? ` at ×${p.rate}` : ""}, from ${clock(p.start)} to ${clock(p.start + p.duration)} of the cut`);
  const rec = p.in + (t - p.start) * (p.rate || 1);
  const crop = p.segments?.find((g) => rec >= g.in && rec < g.out)?.crop || p.crop;
  console.log(`  view ${p.view}${crop ? `, zoomed to [${crop.join(", ")}]` : ""}${p.segments ? ` (the screen changes within it: ${p.segments.length} parts, each zoomed for itself)` : ""}`);
  if (p.words) console.log(`  words ${p.words[0]}–${p.words[1]}: ${words.slice(p.words[0], p.words[1] + 1).filter((w) => w.kind === "word").map((w) => w.text).join(" ")}`);
  else console.log(`  no words: ${p.hold ? "held after the keep's words, the voice faded" : p.wait ? "a wait" : "the picture moving in a pause"}`);
  if (said) console.log(`  heard around it: …${said}…`);
  const prev = e.pieces[k - 1], next = e.pieces[k + 1];
  console.log(`  before: ${prev ? `keep ${prev.keep + 1}, ${prev.view}` : "the start"} · after: ${next ? `keep ${next.keep + 1}, ${next.view}` : "the end"}`);
  console.log(`\nTo change it, edit keep ${p.keep + 1} in cut.json: "words" (start or end a word earlier or later), "hold" (seconds after its last word), "view", "zoom", "label"; then build.`);
}

// ----------------------------------------------------------------------------------- frame
// The picture of a source at a moment of the cut, whole, with a grid every tenth (for a zoom box
// in 0–1) and the shot's crop in red: to look at before setting "zoom" on a keep.
function cmdFrame(dir, when, opts) {
  const file = path.join(dir, "edit.json");
  if (!fs.existsSync(file)) fail(`Build first: ${cmd(`build ${rel(dir)}`)}`);
  const t = seconds(when);
  const e = read(file);
  const meta = read(source(dir, "sources.json"));
  const p = e.pieces.find((x) => t >= x.start && t < x.start + x.duration);
  if (!p) fail(`Usage: screencast.mjs frame <dir> <m:ss> [--source screen]: a moment of the cut, which is ${clock(e.duration)} long`);
  const name = opts.source || (p.source === "webcam" ? Object.keys(meta.sources).find((k) => k !== "webcam" && meta.sources[k].video) : p.source);
  const src = meta.sources[name];
  if (!src?.video) fail(`No source ${name}.`);
  const at = p.in + (t - p.start) * (p.rate || 1) - src.offset;
  const out = path.join(dir, "frames", `${String(t.toFixed(1)).replace(".", "_")}-${name}.jpg`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const rec = at + src.offset;
  const c = p.source === name ? (p.segments?.find((g) => rec >= g.in && rec < g.out)?.crop || p.crop) : null;
  // what the automatic zoom picks for this keep's stretch of the screen, to compare with
  const activity = read(source(dir, "activity.json"));
  const layout = layoutOf(settings(dir, {}), fs.existsSync(path.join(dir, "cut.json")) ? read(path.join(dir, "cut.json")) : {});
  const ps = e.pieces.filter((x) => x.keep === p.keep && x.source === name);
  const auto = activity[name] && !(src.height > src.width * 1.25)
    ? cropFor(focus(activity[name], Math.min(...ps.map((x) => x.in)), Math.max(...ps.map((x) => x.out))), src, layout.areas.content, { maxWidth: layout.height >= layout.width * 1.5 ? 0.5 : 1 })
    : null;
  const rect = (b, color) => `,drawbox=x=iw*${b[0]}:y=ih*${b[1]}:w=iw*${(b[2] - b[0]).toFixed(4)}:h=ih*${(b[3] - b[1]).toFixed(4)}:color=${color}:t=6`;
  const box = (c ? rect(c, "red@0.9") : "") + (auto && auto.join() !== "0,0,1,1" ? rect(auto, "0x22cc55@0.9") : "");
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(Math.max(0, at)), "-i", source(dir, src.file), "-frames:v", "1",
    "-vf", `scale='min(1600,iw)':-2,drawgrid=w=iw/10:h=ih/10:t=1:color=0x00a0ff@0.6${box}`, "-q:v", "3", out], { encoding: "utf8" });
  if (r.status) fail(`✗ ${r.stderr.trim()}`);
  console.log(`${rel(out)}: ${name} at ${clock(rec)} of the recording, a blue line every tenth${c ? `, the shot's crop [${c.join(", ")}] in red` : ""}${auto && auto.join() !== "0,0,1,1" ? `, where the screen changed most during keep ${p.keep + 1} [${auto.join(", ")}] in green (context, not a choice: what the words are about decides)` : ""}. A box holds for the whole keep: its sheet shows the first and last moment too. Set "zoom": [x0, y0, x1, y1] (0–1, left top right bottom) on keep ${p.keep + 1}, or "off" for the whole screen.`);
}

// ---------------------------------------------------------------------------------- finish
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
  return cues.map((c, k) => `${k + 1}\n${ts(c.words[0].start)} --> ${ts(Math.min(c.words.at(-1).end + 0.3, cues[k + 1]?.words[0].start ?? Infinity))}\n${c.text}\n`).join("\n");
}

function lufsOf(file) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
  const summary = r.stderr.slice(r.stderr.lastIndexOf("Summary:"));
  return { lufs: Number(summary.match(/I:\s*(-?[\d.]+) LUFS/)?.[1]), peak: Number(summary.match(/Peak:\s*(-?[\d.]+) dBFS/)?.[1]) };
}

function cmdFinish(dir, file) {
  if (!file) fail("Usage: screencast.mjs finish <dir> <video.mp4>");
  if (!fs.existsSync(file)) fail(`There is no ${file}: render the project first.`);
  const e = read(path.join(dir, "edit.json"));
  const s = settings(dir, {});
  const p = probe(file);
  if (Math.abs(p.duration - e.duration) > 0.5) fail(`✗ ${rel(path.resolve(file))} is ${clock(p.duration)} long, the cut ${clock(e.duration)}: it is from before the last build. Render again.`);
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
if (command === "new") await cmdNew(pos[0], pos[1], opts);
else if (command === "words") cmdWords(pos[0], pos[1]);
else if (command === "transcribe") await cmdTranscribe(pos[0]);
else if (command === "propose") cmdPropose(pos[0]);
else if (command === "build") await cmdBuild(pos[0], opts);
else if (command === "check") cmdCheck(pos[0]);
else if (command === "at") cmdAt(pos[0], pos[1]);
else if (command === "captions") await cmdCaptions(pos[0], opts);
else if (command === "finish") cmdFinish(pos[0], pos[1]);
else if (command === "frame") cmdFrame(pos[0], pos[1], opts);
else if (command === "sheets") cmdSheets(pos[0], opts);
else fail("Usage: screencast.mjs new <dir> <recording-folder> | words <dir> <words.json> | transcribe <dir> | propose <dir> | build <dir> | check <dir> | sheets <dir> | at <dir> <m:ss> | frame <dir> <m:ss> | captions <dir> --style … | finish <dir> <video.mp4>   (options: see the head of this file)");
