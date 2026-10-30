#!/usr/bin/env node
// The words of a recording (audio or video), each with its time, through OpenRouter: the one
// transcription of agentitos, which the other skills run as a program instead of keeping a copy.
//
//   node tools/transcribe.mjs <audio|video> --out <words.json> [--speakers] [--lang de] [--speakers-n N]
//
//   default      ElevenLabs Scribe v2: word for word as spoken, "äh"s and noises included,
//                20 ms timings; words [{ text, start, end, kind: "word" | "filler" | "event" }]
//   --speakers   Gemini 3.5 Transcribe with who speaks (A, B, … by first appearance), tenths of a
//                second, an hour in about a minute; words [{ text, start, end, speaker }]
//   --lang de    the language spoken (default: the model hears it)
//   --speakers-n N   with --speakers: how many voices there are, when the person knows
//
// Writes { engine, model, duration, cost, words } to --out (times in seconds of the file) and
// prints one line: what it wrote and what to do next. Progress goes to stderr. An error is one
// sentence on stdout, exit 1.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { scribe, SCRIBE_MODEL } from "./lib/scribe.mjs";
import { gemini, STT_MODEL } from "./lib/gemini.mjs";

const USAGE = "Usage: transcribe.mjs <audio|video> --out <words.json> [--speakers] [--lang de] [--speakers-n N]";
const FLAGS = ["speakers"];
const VALUED = ["out", "lang", "speakers-n"];

const fail = (msg) => { console.log(msg); process.exit(1); };
const log = (s) => console.error(s);
const rel = (p) => path.relative(process.cwd(), p) || ".";
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function parse(args) {
  const pos = [], opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const k = a.slice(2);
    if (FLAGS.includes(k)) { opts[k] = true; continue; }
    if (!VALUED.includes(k)) fail(`Unknown option ${a}. ${USAGE}`);
    if (i + 1 >= args.length || args[i + 1].startsWith("--")) fail(`${a} needs a value. ${USAGE}`);
    opts[k] = args[++i];
  }
  return [pos, opts];
}

// the length of the file's sound, in seconds; null when it has none
function soundOf(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8" });
  if (r.error?.code === "ENOENT") fail("ffprobe is missing: this tool needs ffmpeg on the PATH.");
  if (r.status !== 0) fail(`${file} is no audio or video file ffmpeg can read.`);
  const j = JSON.parse(r.stdout);
  const a = j.streams.find((s) => s.codec_type === "audio");
  return a ? Number(j.format.duration || a.duration) : null;
}

const [pos, opts] = parse(process.argv.slice(2));
const file = pos[0];
if (!file || typeof opts.out !== "string") fail(USAGE);
if (!fs.existsSync(file)) fail(`There is no ${file}.`);
const voices = opts["speakers-n"] === undefined ? 0 : Number(opts["speakers-n"]);
if (!(Number.isInteger(voices) && voices >= 0)) fail("--speakers-n is a whole number of voices, e.g. --speakers-n 2.");
if (voices && !opts.speakers) fail("--speakers-n goes with --speakers: Scribe does not tell the voices apart.");
const duration = soundOf(file);
if (duration == null) fail(`${file} has no sound to take the words from.`);
if (!(duration > 0)) fail(`${file} has no length ffprobe can read.`);

const engine = opts.speakers ? "gemini" : "scribe";
const model = opts.speakers ? STT_MODEL : SCRIBE_MODEL;
let r;
try {
  r = opts.speakers
    ? await gemini(file, duration, { lang: opts.lang || "auto", speakers: true, voices, log })
    : await scribe(file, duration, { lang: opts.lang, log });
} catch (e) {
  const why = String(e.message).split("\n")[0].replace(/\.$/, "");
  // no OpenRouter: need() says how to get it
  fail(/^The transcription needs/.test(why) ? `${why}.` : `The transcription with ${model} failed (${why}); ${/OpenRouter 40[13]\b/.test(why) ? "check OPENROUTER_API_KEY or the gateway's OpenRouter connection" : "try again in a while"}.`);
}

const out = path.resolve(opts.out);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ engine, model, duration: +duration.toFixed(3), cost: +r.cost.toFixed(4), words: r.words }, null, 1));

const n = (kind) => r.words.filter((w) => w.kind === kind).length;
const said = opts.speakers ? `${r.words.length} words` : `${n("word")} words, ${n("filler")} fillers, ${n("event")} noises`;
const who = [...new Set(r.words.map((w) => w.speaker).filter(Boolean))];
const shape = opts.speakers ? "{text, start, end, speaker}" : "{text, start, end, kind}";
console.log(`${rel(out)}: ${said}${who.length ? `, voices ${who.join(" ")}` : ""} in ${clock(duration)} (${model}, $${r.cost.toFixed(4)}).`
  + (r.words.length ? ` Next: read its words (${shape}, seconds) and fix names the model misheard, keeping their times.` : " No speech heard: is there any in it?"));
