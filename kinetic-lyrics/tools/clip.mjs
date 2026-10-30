#!/usr/bin/env node
// A clip someone brings (video or audio) → a folder ready for build.mjs.
//
//   node tools/clip.mjs <clip> --out <dir> [--lang auto|de|en]
//
// <dir>/audio.wav     the voice, mono 48 kHz
// <dir>/video.<ext>   the footage as it came (build.mjs transcodes what the renderer can't play)
// <dir>/transcript.json   word timings and who speaks (A, B, …), from Gemini 3.5 Transcribe
//                     through OpenRouter (OPENROUTER_API_KEY, or a Sprite gateway), run by
//                     agentitos' transcribe skill beside this one (tools/lib/transcribe.mjs)
// Prints one JSON line: { duration, video, width, height, words, speakers, text }.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { transcribeFile, transcribeTool, NEEDS_TRANSCRIBE } from "./lib/transcribe.mjs";
import { openrouter } from "./openrouter.mjs";

const argv = process.argv.slice(2);
const opt = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) {
    const k = argv[i].slice(2);
    opt[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  } else pos.push(argv[i]);
}
const clip = pos[0];
if (!clip || typeof opt.out !== "string") {
  console.error("usage: node tools/clip.mjs <clip> --out <dir> [--lang auto|de|en]");
  process.exit(1);
}
const fail = (msg) => { console.error(`clip: ${msg}`); process.exit(1); };
if (!fs.existsSync(clip)) fail(`${clip} not found`);
// the words come from agentitos' transcribe skill through OpenRouter: without either, nothing to do
if (!transcribeTool()) fail(NEEDS_TRANSCRIBE);
if (!(await openrouter())) fail("The words need OpenRouter: OPENROUTER_API_KEY, or on a Sprite the gateway's OpenRouter connection.");

const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", clip], { encoding: "utf8" });
if (probe.status !== 0) fail(`cannot read ${clip}: not a video or audio file`);
const streams = JSON.parse(probe.stdout).streams || [];
// a cover image in an mp3 is a "video" stream too: real footage has a frame size and is not an attached picture
const v = streams.find((s) => s.codec_type === "video" && s.width && !/\.(mp3|m4a|aac|ogg|flac|wav)$/i.test(clip));
if (!streams.some((s) => s.codec_type === "audio")) fail(`${clip} has no sound`);

const out = path.resolve(opt.out);
fs.mkdirSync(out, { recursive: true });
const wav = path.join(out, "audio.wav");
const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", clip, "-vn", "-ac", "1", "-ar", "48000", wav], { stdio: "inherit" });
if (r.status !== 0) fail("could not extract the sound");
if (v) {
  const dst = path.join(out, "video" + (path.extname(clip).toLowerCase() || ".mp4"));
  if (path.resolve(clip) !== dst) fs.copyFileSync(clip, dst);
}

const lang = typeof opt.lang === "string" ? opt.lang : "auto";
console.error("clip: transcribing with Gemini 3.5 Transcribe (OpenRouter) …");
let words, seconds;
try { ({ words, duration: seconds } = await transcribeFile(wav, { speakers: true, lang, log: console.error })); } catch (e) { fail(`transcription failed: ${e.message}`); }
if (!words.length) fail("no speech found");
fs.writeFileSync(path.join(out, "transcript.json"), JSON.stringify(words, null, 1));
const text = words.map((w) => w.text).join(" ");
console.log(JSON.stringify({
  duration: +Number(seconds).toFixed(2), video: !!v, width: v?.width ?? null, height: v?.height ?? null,
  words: words.length, speakers: new Set(words.map((w) => w.speaker).filter(Boolean)).size, text: text.length > 400 ? text.slice(0, 400) + " …" : text,
}));
