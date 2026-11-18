#!/usr/bin/env node
// The words of a recording (audio or video), each with its time, through OpenRouter: the one
// transcription of agentitos, which the other skills run as a program instead of keeping a copy.
//
//   node tools/transcribe.mjs <audio|video> --out <words.json> [--speakers [gemini]] [--speakers-n N] [--lang de]
//
//   default      ElevenLabs Scribe v2: word for word as spoken, "äh"s and noises included,
//                20 ms timings; words [{ text, start, end, kind: "word" | "filler" | "event" }].
//                Every word's time is checked against the recording's own sound (lib/timing.mjs):
//                the few the recognizer squeezed, stretched or put into silence are moved to
//                where the voice is (by: "sound"), a stretch that stays doubtful is heard again
//                alone (lib/again.mjs, by: "second hearing"); then the edges of all words are set
//                where their sound begins and ends (lib/edges.mjs): Scribe starts a word a little
//                late and ends it a little early.
//                Scribe names the voice of every word within a request. Where that makes the
//                speakers without another request, the words carry speaker "A", "B", … in the
//                order they first speak: a recording of one piece, or one whose pieces name two
//                voices at most and whose sound puts every voice to one of two people, near
//                enough to be that one and far enough from the other (lib/voices.mjs). Else
//                they carry none, and the line says why. The sound is read on other threads
//                while the pieces are with the model
//   --speakers   the speakers are wanted: the same, and where the pieces' voices cannot be told
//                to be the same people the recording is written down once more in long requests
//                (three quarters of an hour each, which keep their voices apart by themselves).
//                Where those fail, for any reason, the speakers are Gemini's, as --speakers gave
//                them before, laid on Scribe's words by their times (speakers.by "gemini" and
//                why); where that fails too, the words come without speakers and the line says why
//   --speakers gemini   Gemini 3.5 Transcribe instead, as --speakers was before: tenths of a
//                second, no kinds, no check against the sound; words [{ text, start, end, speaker }]
//   --speakers-n N   with --speakers: how many voices there are, when the person knows; 1: every
//                word is A, no further request; from three on the long requests at once
//   --lang de    the language spoken (default: the model hears it)
//
// Writes { engine, model, duration, cost, speakers, timing, edges, words } to --out (times in
// seconds of the file; speakers: { by, people, … } when the words carry them, with `unlinked`
// [{ from, to }] where long requests shared no words and the people may be too many; timing: how many
// words the sound confirmed, moved and still contradicts, and how many
// had an edge set by it; edges: "sound" says the words' edges lie on the sound, so that a skill
// taking them corrects nothing a second time) and prints one
// line: what it wrote and what to do next. Progress goes to stderr. An error is one
// sentence on stdout, exit 1.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { scribe, SCRIBE_MODEL, BEFORE } from "./lib/scribe.mjs";
import { gemini, atMost, STT_MODEL } from "./lib/gemini.mjs";
import { framesOf, fingerprints, bySound, byWords, byTime, named } from "./lib/voices.mjs";
import { envelopeOf, threshold, bare, check, repair } from "./lib/timing.mjs";
import { hearAgain } from "./lib/again.mjs";
import { edged } from "./lib/edges.mjs";

const USAGE = "Usage: transcribe.mjs <audio|video> --out <words.json> [--speakers [gemini]] [--speakers-n N] [--lang de]";
// who writes the speakers down, after --speakers; without a name, Scribe
const WAYS = ["scribe", "gemini"];
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
    if (k === "speakers") { opts.speakers = WAYS.includes(args[i + 1]) ? args[++i] : "scribe"; continue; }
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

// The people of what Scribe heard, without another request: Map "<piece>:<voice>" → person, or
// why there is none. One request names its voices by itself; the voices of several pieces are
// told to be the same people by their sound, which holds for two (lib/voices.mjs).
const NONE = "the model named no voices";
const voiced = (parts) => parts.some((p) => p.own.some((w) => w.voice != null));
const first = (e) => String(e?.message ?? e).split("\n")[0].replace(/\.$/, "");
async function peopleOf(parts, frames) {
  const pieces = parts.map((p) => p.own);
  if (!voiced(parts)) return { why: NONE };
  const sound = await frames;
  if (sound.failed) return { why: sound.failed };
  // one request keeps its voices apart by itself: they are its people (lib/voices.mjs)
  const r = bySound(fingerprints(sound, pieces));
  if (r.why || parts.length === 1) return r.why ? r : { person: r.person };
  // across pieces the voices are told to be the same people by taking them to be two at most
  return { person: r.person, linked: "sound", assumed: "two people at most", ...(r.margin == null ? {} : { margin: +r.margin.toFixed(2) }) };
}

// Scribe's words, with who speaks them where that can be told (`sure`: at the price of a second
// transcription). → { words, cost, speakers: { by, people, … } | null, why }
async function heard(sure) {
  let cost = 0, short = null;
  // the sound's fingerprints are taken while the pieces are with the model (lib/voices.mjs, off
  // the main thread), once, whichever way the speakers come
  let frames = null;
  const sound = () => (frames ??= framesOf(file).catch((e) => ({ failed: first(e) })));
  const shortPieces = async (listen = true) => {
    if (!short) { if (listen) sound(); short = await scribe(file, duration, { lang: opts.lang, log }); cost += short.cost; }
    return short;
  };
  const done = (x, found) => {
    let { words, people } = named(x.parts.map((p) => p.own), found.person);
    // more voices than the person said there are: their words to the nearest of those that say most
    if (voices && people > voices) { words = atMost(words, voices); people = voices; }
    const { person, ...how } = found;
    return { words, cost, speakers: people ? { by: "scribe", people, pieces: x.parts.length, ...how } : null, why: people ? "" : NONE };
  };
  // one voice, as the person said: every word is that one's, nothing to link
  if (sure && voices === 1) {
    const x = await shortPieces(false);
    return { words: x.words.map((w) => ({ ...w, speaker: "A" })), cost, speakers: { by: "speakers-n", people: 1 }, why: "" };
  }
  // the short pieces first, unless three people or more are known to speak: of those they
  // could not say who is who
  let why = "";
  if (!(sure && voices >= 3)) {
    const x = await shortPieces();
    const found = await peopleOf(x.parts, sound());
    if (found.person) return done(x, found);
    if (!sure) return { words: x.words, cost, speakers: null, why: found.why };
    why = found.why;
  }
  // the long requests, which keep their voices apart by themselves; they would name no voices
  // where the short ones named none
  if (why !== NONE) {
    if (why) log(`  transcribe: ${why}; once more in long requests, which keep their voices apart …`);
    try {
      sound();
      const x = await scribe(file, duration, { lang: opts.lang, log, long: true });
      cost += x.cost;
      if (voiced(x.parts)) {
        if (x.parts.length > 1) {
          const { person, gaps } = byWords(x.parts, BEFORE);
          return done(x, { person, linked: "overlap", ...(gaps.length ? { unlinked: gaps.map(([from, to]) => ({ from: +from.toFixed(1), to: +to.toFixed(1) })) } : {}) });
        }
        const found = await peopleOf(x.parts, sound());
        if (found.person) return done(x, found);
        why = found.why;
      } else why = NONE;
    } catch (e) {
      // a long request is a body of 22 MB, which a gateway may refuse (413), or it may fail
      // otherwise: what the others answered is paid, and the words come from the short pieces
      cost += e.cost ?? 0;
      why = `the long requests failed (${first(e).slice(0, 120)})`;
    }
  }
  // the last way: Gemini's speakers, as --speakers was before, laid on Scribe's words by their times
  const x = await shortPieces(false);
  log(`  transcribe: ${why}; the speakers from ${STT_MODEL} instead …`);
  try {
    const g = await gemini(file, duration, { lang: opts.lang || "auto", speakers: true, voices, log });
    cost += g.cost;
    const words = byTime(x.words, g.words), people = new Set(words.map((w) => w.speaker).filter(Boolean)).size;
    if (people) return { words, cost, speakers: { by: "gemini", people, because: why }, why: "" };
    return { words: x.words, cost, speakers: null, why: `${why}, and ${STT_MODEL} named no voices either` };
  } catch (e) {
    cost += e.cost ?? 0;
    return { words: x.words, cost, speakers: null, why: `${why}, and ${STT_MODEL} failed too (${first(e).slice(0, 120)})` };
  }
}

const [pos, opts] = parse(process.argv.slice(2));
const file = pos[0];
if (!file || typeof opts.out !== "string") fail(USAGE);
if (pos.length > 1) fail(`One recording at a time, and --speakers takes ${WAYS.join(" or ")}: what is ${pos[1]}? ${USAGE}`);
if (!fs.existsSync(file)) fail(`There is no ${file}.`);
const voices = opts["speakers-n"] === undefined ? 0 : Number(opts["speakers-n"]);
if (!(Number.isInteger(voices) && voices >= 0)) fail("--speakers-n is a whole number of voices, e.g. --speakers-n 2.");
if (voices && !opts.speakers) fail("--speakers-n goes with --speakers: it says how many voices to tell apart.");
const duration = soundOf(file);
if (duration == null) fail(`${file} has no sound to take the words from.`);
if (!(duration > 0)) fail(`${file} has no length ffprobe can read.`);

const engine = opts.speakers === "gemini" ? "gemini" : "scribe";
const model = engine === "gemini" ? STT_MODEL : SCRIBE_MODEL;
let r;
try {
  if (engine === "gemini") {
    r = await gemini(file, duration, { lang: opts.lang || "auto", speakers: true, voices, log });
    const people = new Set(r.words.map((w) => w.speaker).filter(Boolean)).size;
    r.speakers = people ? { by: "gemini", people } : null;
  } else r = await heard(Boolean(opts.speakers));
} catch (e) {
  const why = String(e.message).split("\n")[0].replace(/\.$/, "");
  // what the pieces that answered cost is paid all the same
  const spent = e.cost > 0 ? ` $${e.cost.toFixed(4)} was spent on the pieces that answered.` : "";
  // no OpenRouter: need() says how to get it
  fail(/^The transcription needs/.test(why) ? `${why}.` : `The transcription with ${model} failed (${why}); ${/OpenRouter 40[13]\b/.test(why) ? "check OPENROUTER_API_KEY or the gateway's OpenRouter connection" : "try again in a while"}.${spent}`);
}

// Scribe's words against the sound (their speakers stay with them). Gemini's tenths of a second
// are for finding moments, not for cutting between words: they stay as they came.
let timing = null;
if (engine === "scribe" && r.words.length) {
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
  // the gross errors are out: now every word's edges, outward to where its sound begins and ends
  const edges = edged(r.words, env);
  const after = check(r.words, env, thr);
  timing = { checked: after.speech, inVoice: after.inVoice, moved, heardAgain: again.heard, edged: edges, doubtful: after.off };
}

const out = path.resolve(opts.out);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ engine, model, duration: +duration.toFixed(3), cost: +r.cost.toFixed(4), ...(r.speakers ? { speakers: r.speakers } : {}), ...(timing ? { timing, edges: "sound" } : {}), words: r.words }, null, 1));

const n = (kind) => r.words.filter((w) => w.kind === kind).length;
const said = engine === "gemini" ? `${r.words.length} words` : `${n("word")} words, ${n("filler")} fillers, ${n("event")} noises`;
const who = [...new Set(r.words.map((w) => w.speaker).filter(Boolean))].sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
const shape = engine === "gemini" ? "{text, start, end, speaker}" : who.length ? "{text, start, end, kind, speaker}" : "{text, start, end, kind}";
// why Scribe's words carry no speakers, and what gets them; where the speakers came from
// another way than the default's, or may be too many
const sp = r.speakers || {};
const unnamed = engine === "gemini" || !r.words.length ? ""
  : sp.by === "gemini" ? ` Who speaks is ${STT_MODEL}'s, laid on these words by their times: ${sp.because}.`
  : sp.unlinked ? ` Who speaks may be fewer people than ${sp.people}: the long requests share no words between ${sp.unlinked.map((u) => `${clock(u.from)} and ${clock(u.to)}`).join(", ")}, so the voices before and after are not linked there.`
  : sp.assumed ? ` Who speaks is told across the ${sp.pieces} pieces by the sound, taking the recording to be of ${sp.assumed}: where more speak, --speakers --speakers-n N (3 or more) asks long requests instead.`
  : r.speakers ? ""
  : ` Who speaks is not in it: ${r.why}` + (opts.speakers ? "." : r.why === NONE ? `; --speakers gets it from ${STT_MODEL}, a second transcription.` : "; --speakers gets it, with a second transcription in long requests.");
// what the check against the sound found, in a sentence
const at = (i) => `"${r.words[i].text}" at ${clock(r.words[i].start)}`;
const timed = !timing ? "" : ` Timings checked against the sound: ${(timing.inVoice * 100).toFixed(1)} % of the words lie where the voice is`
  + (timing.moved ? `, ${timing.moved} moved there` : "")
  + (timing.heardAgain ? `, ${timing.heardAgain} taken from a second hearing` : "")
  + (timing.edged ? `, the edges of ${timing.edged} set where their sound begins and ends` : "")
  + (timing.doubtful.length ? `; still doubtful: ${timing.doubtful.slice(0, 5).map(at).join(", ")}${timing.doubtful.length > 5 ? ` and ${timing.doubtful.length - 5} more` : ""} (timing.mjs sheet shows a spot)` : "") + ".";
console.log(`${rel(out)}: ${said}${who.length ? `, voices ${who.join(" ")}` : ""} in ${clock(duration)} (${model}, $${r.cost.toFixed(4)}).${unnamed}${timed}`
  + (r.words.length ? ` Next: read its words (${shape}, seconds) and fix names the model misheard, keeping their times.` : " No speech heard: is there any in it?"));
