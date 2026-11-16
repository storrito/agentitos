#!/usr/bin/env node
// The words of a recording (audio or video), each with its time, through OpenRouter: the one
// transcription of agentitos, which the other skills run as a program instead of keeping a copy.
//
//   node tools/transcribe.mjs <audio|video> --out <words.json> [--speakers] [--lang de] [--speakers-n N]
//
//   default      ElevenLabs Scribe v2: word for word as spoken, "äh"s and noises included,
//                20 ms timings; words [{ text, start, end, kind: "word" | "filler" | "event" }].
//                Every word's time is checked against the recording's own sound (lib/timing.mjs):
//                the few the recognizer squeezed, stretched or put into silence are moved to
//                where the voice is (by: "sound"), a stretch that stays doubtful is heard again
//                alone (lib/again.mjs, by: "second hearing")
//   --speakers   Gemini 3.5 Transcribe with who speaks (A, B, … by first appearance), tenths of a
//                second, an hour in about a minute; words [{ text, start, end, speaker }]
//   --lang de    the language spoken (default: the model hears it)
//   --speakers-n N   with --speakers: how many voices there are, when the person knows
//
// Writes { engine, model, duration, cost, timing, words } to --out (times in seconds of the
// file; timing: how many words the sound confirmed, moved and still contradicts) and prints one
// line: what it wrote and what to do next. Progress goes to stderr. An error is one
// sentence on stdout, exit 1.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { scribe, SCRIBE_MODEL } from "./lib/scribe.mjs";
import { gemini, STT_MODEL } from "./lib/gemini.mjs";
import { envelopeOf, threshold, bare, check, repair } from "./lib/timing.mjs";
import { hearAgain } from "./lib/again.mjs";

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

// Scribe's words against the sound. Gemini's tenths of a second are for finding moments, not
// for cutting between words: they stay as they came.
let timing = null;
if (!opts.speakers && r.words.length) {
  const b = bare(r.words);
  if (b.speech >= 20 && b.bare / b.speech > 0.3) fail(`${model} gave ${b.bare} of its ${b.speech} words no length (start = end): nothing can be cut or captioned by such times; try again in a while.`);
  let env;
  try { env = await envelopeOf(file); } catch (e) { fail(`${String(e.message).split("\n")[0].replace(/\.$/, "")}.`); }
  const thr = threshold(env);
  const { moved, guessed } = repair(r.words, env, thr);
  // what the sound could only guess or still contradicts: heard again, alone
  const doubtful = [...guessed, ...check(r.words, env, thr).off.map((i) => [i, i])];
  const again = await hearAgain(file, r.words, doubtful, async (piece, seconds) => {
    const x = await scribe(piece, seconds, { lang: opts.lang });
    r.cost += x.cost;
    return x.words;
  }, log);
  const after = check(r.words, env, thr);
  timing = { checked: after.speech, inVoice: after.inVoice, moved, heardAgain: again.heard, doubtful: after.off };
}

const out = path.resolve(opts.out);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ engine, model, duration: +duration.toFixed(3), cost: +r.cost.toFixed(4), ...(timing ? { timing } : {}), words: r.words }, null, 1));

const n = (kind) => r.words.filter((w) => w.kind === kind).length;
const said = opts.speakers ? `${r.words.length} words` : `${n("word")} words, ${n("filler")} fillers, ${n("event")} noises`;
const who = [...new Set(r.words.map((w) => w.speaker).filter(Boolean))];
const shape = opts.speakers ? "{text, start, end, speaker}" : "{text, start, end, kind}";
// what the check against the sound found, in a sentence
const at = (i) => `"${r.words[i].text}" at ${clock(r.words[i].start)}`;
const timed = !timing ? "" : ` Timings checked against the sound: ${(timing.inVoice * 100).toFixed(1)} % of the words lie where the voice is`
  + (timing.moved ? `, ${timing.moved} moved there` : "")
  + (timing.heardAgain ? `, ${timing.heardAgain} taken from a second hearing` : "")
  + (timing.doubtful.length ? `; still doubtful: ${timing.doubtful.slice(0, 5).map(at).join(", ")}${timing.doubtful.length > 5 ? ` and ${timing.doubtful.length - 5} more` : ""} (timing.mjs sheet shows a spot)` : "") + ".";
console.log(`${rel(out)}: ${said}${who.length ? `, voices ${who.join(" ")}` : ""} in ${clock(duration)} (${model}, $${r.cost.toFixed(4)}).${timed}`
  + (r.words.length ? ` Next: read its words (${shape}, seconds) and fix names the model misheard, keeping their times.` : " No speech heard: is there any in it?"));
