// `voice.mjs clean`: a spoken recording made to sound right for social media, in three stages,
// each in a file of its own: repair (lib/repair.mjs: channels, clipping, rumble, hum, clicks,
// noise), tone (lib/tone.mjs: what stands out in its spectrum, sibilance; run at the end of
// repair's ffmpeg pass) and level (lib/level.mjs: the leveller, the loudness, a slow limiter for the
// loudest peaks and the ceiling on the file as delivered).
//
//   node tools/voice.mjs clean <audio|video> <out> [--for <platform…>] [--loudness <LUFS>] [--peak <dBTP>]
//        [--denoise auto|off|gentle|strong] [--tone auto|off] [--level auto|plain|off] [--mono]
//        [--audio <n>] [--before <file>] [--json]
//
//   <out>        its ending decides what it is: .m4a (AAC at 192 kbit/s), .wav (24-bit PCM),
//                .flac (24 bits), .mp3 (192 kbit/s); a video's own ending (.mp4, .m4v, .mov, .mkv,
//                .webm as the input has it) keeps the picture as it is (copied, not encoded again)
//                with the new sound, as long as it was and in step. Always 48 kHz, never with the
//                source's tags (a phone writes the place into its file); never over the input
//   --for        platform names: their master from lib/targets.mjs (none named: its default, the
//                master for video: −14 LUFS, true peak −1.5 dBTP aimed at, −1 accepted, range 5 LU)
//   --loudness   the target, LUFS as played, over the master's; --peak the true peak aimed at
//                after the encoding (a check then accepts 0.5 dB more)
//   --level      auto: leveller where uneven, loudness, slow limiter, limiter; plain: only the
//                gain to the loudness and the limiter (for a voice that pumps, breathes or sounds
//                flat after auto); off: repair and tone only, the recording's own dynamics and its
//                loudness as it came in kept (for a skill that levels itself, as best-takes does
//                take by take), its peaks still safe
//   --mono       one channel, at the target as played on two speakers (ffmpeg measures the file
//                3 LU under it: −17 for −14); by default two channels with the same voice in both
//   --audio      which audio stream is the voice (1 is the first, the default); the others are
//                not in the output, and the lines say so
//   --before     also writes the source's sound untouched but for a gain to the output's
//                loudness (a limiter only where that gain would take its peaks over the ceiling,
//                and then the line says so), as many channels as the output, sound only: before
//                and after to compare by ear
//
// Refuses, in one sentence: a recording in which measure finds no voice (or says so: m.voice.found
// false) or less than MIN_VOICE_S of it, and one whose voice lies more than level's MAX_GAIN_DB
// under the master's −14 LUFS (the recorder's own floor comes up then more than the voice). A
// voice LOW_GAIN_DB or more under the target is delivered, and what is left says it was recorded very low.
// Where measure could not judge hum, `notJudged` says so; after a notch, the result's measurement
// decides whether `left` names the hum.
//
// Writes <out> and beside it <out>.json: the source, what was measured before and after, every
// step with its reason, what was left and why, the targets, the settings. Prints what an agent
// passes on; --json prints the same object as the file. An error is one sentence, exit 1.
//
//   cleanCommand(args, stages)       everything the command does (prints, sets the exit code)
//   clean(file, out, opts, stages)   → the report; throws a Refusal (one sentence)
//
// `stages`: { repair, repairPlan, tonePlan, toneFilters } to run instead of lib/repair.mjs and
// lib/tone.mjs (the tests' stand-ins), and `measure(file, "before" | "after")` for a made-up
// measurement; without it those files are loaded.
//
// The working files lie in a hidden folder beside the output (`.voice-sound-clean-<pid>-…`), each
// removed as soon as the next stage has read it (two float WAVs of one channel at the most: 23 MB
// a minute of sound). The output, the comparison and the JSON are written beside their places
// under hidden names and moved there together at the very end. SIGINT or SIGTERM ends the running
// ffmpeg at once and leaves nothing new; every run removes what dead runs left that is older than a
// day. Nothing holds the recording in memory: every stage streams through ffmpeg.
//
// Every path given to ffmpeg and ffprobe is absolute: a name that begins with a dash is a file.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { measure } from "./measure.mjs";
import { Refusal, facts } from "./analyse.mjs";
import { level, LevelError, TARGETS, LIMITER, MAX_GAIN_DB, tooQuiet, NO_LOUDNESS_LUFS, TWO_SPEAKERS_LU, loudness, loudnessAt, ffmpegRun, stopChildren } from "./level.mjs";
import { targets as platformTargets } from "./targets.mjs";

export const USAGE = "Usage: voice.mjs clean <audio|video> <out> [--for <platform…>] [--loudness <LUFS>] [--peak <dBTP>] [--denoise auto|off|gentle|strong] [--tone auto|off] [--level auto|plain|off] [--mono] [--audio <n>] [--before <file>] [--json]";
// a check accepts the true peak this much over the one aimed at (−1.5 aimed at, −1 accepted)
const PEAK_MARGIN_DB = 0.5;
// the least voice clean works on: under half a second, measure's speech is a cough or a click
// and ebur128's gated loudness (400 ms blocks) has one block to rest on. From there it holds:
// cuts of 0.6 and 0.8 s of clean speech and three corpus clips with 0.5 to 0.9 s of voice landed
// within 0.2 LU of the target with their peaks under the ceiling (2026-11-20); a first bound of
// 1 s had refused those clips, a short answer as a person might well bring it
export const MIN_VOICE_S = 0.5;
// what dead runs left (a hidden folder or file beside an output, a folder of the older version in
// the system's temp directory) is removed by the next run once it is older than this
const LEFTOVER_MS = 24 * 3600 * 1000;
const WORK_PREFIX = ".voice-sound-clean-";

const AAC = ["-c:a", "aac", "-b:a", "192k"];
export const FORMATS = {
  m4a: { kind: "audio", codec: AAC, says: "AAC at 192 kbit/s", name: "aac" },
  wav: { kind: "audio", codec: ["-c:a", "pcm_s24le"], says: "24-bit PCM", name: "pcm_s24le" },
  flac: { kind: "audio", codec: ["-c:a", "flac", "-sample_fmt", "s32"], says: "FLAC at 24 bits", name: "flac" },
  mp3: { kind: "audio", codec: ["-c:a", "libmp3lame", "-b:a", "192k"], says: "MP3 at 192 kbit/s", name: "mp3", encoder: "libmp3lame" },
  mp4: { kind: "video", codec: AAC, says: "AAC at 192 kbit/s", name: "aac", audio: "m4a", faststart: true },
  m4v: { kind: "video", codec: AAC, says: "AAC at 192 kbit/s", name: "aac", audio: "m4a", faststart: true, muxer: "mp4" },
  mov: { kind: "video", codec: AAC, says: "AAC at 192 kbit/s", name: "aac", audio: "m4a", faststart: true },
  mkv: { kind: "video", codec: AAC, says: "AAC at 192 kbit/s", name: "aac", audio: "m4a" },
  webm: { kind: "video", codec: ["-c:a", "libopus", "-b:a", "192k"], says: "Opus at 192 kbit/s", name: "opus", audio: "webm", encoder: "libopus" },
};
const AUDIO_ENDINGS = Object.keys(FORMATS).filter((k) => FORMATS[k].kind === "audio").map((k) => `.${k}`);
const VIDEO_ENDINGS = Object.keys(FORMATS).filter((k) => FORMATS[k].kind === "video").map((k) => `.${k}`);

const refuse = (msg) => { throw new Refusal(msg); };
const minus = (s) => s.replace(/^-/, "−");
const f1 = (x) => (x == null ? "?" : minus((Math.round(x * 10) / 10 || 0).toFixed(1)));
const i0 = (x) => (x == null ? "?" : minus(String(Math.round(x))));
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const rel = (p) => { const r = path.relative(process.cwd(), path.resolve(p)); return r && !r.startsWith("..") ? r : path.resolve(p); };
const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`);
const nth = (n) => ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"][n - 1] ?? `${n}th`;
const lufsOrNull = (x) => (x != null && Number.isFinite(x) && x > NO_LOUDNESS_LUFS ? x : null);
const lastLine = (s) => (s || "").trim().split("\n").slice(-1)[0];

// ---------------------------------------------------------------- the arguments

const ENUMS = { denoise: ["auto", "off", "gentle", "strong"], tone: ["auto", "off"], level: ["auto", "plain", "off"] };
const NUMBERS = { loudness: [-40, -5, "LUFS, as −14"], peak: [-12, 0, "dBTP, as −1.5"] };

// → { file, out, opts, json }; throws a Refusal
export function parse(args) {
  const pos = [], opts = { for: [], denoise: "auto", tone: "auto", level: "auto", mono: false };
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const k = a.slice(2);
    if (k === "json") { json = true; continue; }
    if (k === "mono") { opts.mono = true; continue; }
    if (k === "before") {
      const v = args[++i];
      if (v == null || v.startsWith("--")) refuse("--before needs the file to write the untouched sound to, as --before before.m4a.");
      opts.before = v;
      continue;
    }
    if (k === "audio") {
      const v = args[++i];
      if (!/^[1-9]\d*$/.test(v ?? "")) refuse(`--audio needs the number of the audio stream that is the voice, 1 for the first${v == null ? "" : `, not ${v}`}.`);
      opts.audio = Number(v);
      continue;
    }
    if (k === "for") {
      // platform names follow, one or more, or one with commas: never a file (they have no dot)
      while (i + 1 < args.length && /^[a-z][a-z0-9-]*(,[a-z][a-z0-9-]*)*$/i.test(args[i + 1])) opts.for.push(...args[++i].toLowerCase().split(","));
      if (!opts.for.length) refuse("--for needs a platform's name, as --for tiktok or --for reels,youtube.");
      continue;
    }
    if (ENUMS[k]) {
      const v = args[++i];
      if (!ENUMS[k].includes(v)) refuse(`--${k} is ${list(ENUMS[k])}${v == null ? "" : `, not ${v}`}.`);
      opts[k] = v;
      continue;
    }
    if (NUMBERS[k]) {
      const v = Number(String(args[++i] ?? "").replace("−", "-"));
      const [lo, hi, unit] = NUMBERS[k];
      if (args[i] == null || !Number.isFinite(v)) refuse(`--${k} needs a number (${unit}).`);
      if (v < lo || v > hi) refuse(`--${k} ${minus(String(v))} is out of reach: ${minus(String(lo))} to ${minus(String(hi))}.`);
      opts[k] = v;
      continue;
    }
    refuse(`Unknown option ${a}. ${USAGE}`);
  }
  if (pos.length !== 2) refuse(`Name the recording and the file to write: clean <audio|video> <out>.${pos.length > 2 ? ` (${pos.length} names given.)` : ""}`);
  return { file: pos[0], out: pos[1], opts, json };
}

// ---------------------------------------------------------------- the stages

async function realStages() {
  const load = async (name, what) => {
    const f = path.join(path.dirname(fileURLToPath(import.meta.url)), name);
    if (!fs.existsSync(f)) refuse(`The ${what} stage (lib/${name}) is not there yet: clean cannot run without it.`);
    return import(f);
  };
  const r = await load("repair.mjs", "repair"), t = await load("tone.mjs", "tone");
  return { repair: r.repair, repairPlan: r.repairPlan, tonePlan: t.tonePlan, toneFilters: t.toneFilters };
}

function encoders() {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8", maxBuffer: 1 << 22 });
  if (r.error?.code === "ENOENT") refuse("ffmpeg is missing: this tool needs ffmpeg on the PATH.");
  return r.stdout || "";
}

// the file's start and its audio streams, in order: { start, audio: [{ start, channels, codec }] }
function streamsOf(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_entries", "format=start_time:stream=index,codec_type,codec_name,channels,start_time", file], { encoding: "utf8", maxBuffer: 1 << 24 });
  let j = {};
  try { j = JSON.parse(r.stdout || "{}"); } catch { /* facts() said it is readable */ }
  return {
    start: Number(j.format?.start_time) || 0,
    audio: (j.streams || []).filter((s) => s.codec_type === "audio").map((s) => ({ start: Number(s.start_time) || 0, channels: Number(s.channels) || null, codec: s.codec_name || null })),
  };
}

// the numbers of measure that matter here
function numbers(m) {
  const L = m.levels || {}, lo = m.loudness || {};
  return {
    seconds: m.analysed?.seconds ?? null, channels: m.sound?.channels ?? null, sampleRate: m.sound?.sampleRate ?? null, codec: m.sound?.codec ?? null,
    lufs: lufsOrNull(lo.integratedLufs), rangeLu: lufsOrNull(lo.integratedLufs) == null ? null : lo.rangeLu, truePeak: lo.truePeakDb,
    speechLufs: lufsOrNull(L.speechLufs ?? null), noiseLufs: L.noiseLufs ?? null, snrDb: L.snrADb ?? L.snrDb ?? null, phraseSpreadLu: L.phrases?.spreadLu ?? null,
    voiceSeconds: m.speech?.seconds ?? null,
    findings: (m.findings || []).map((f) => ({ id: f.id, strength: f.strength })),
  };
}

// The source's voice untouched but for a plain gain to `lufs` (the output's loudness as
// measured), so that before and after play equally loud (the louder one always sounds better):
// 48 kHz, as many channels as the output (one channel on both sides, or a mix of more), without
// tags, sound only. A limiter (as level's: oversampled, look-ahead taken back) only when the gain
// would push its peaks over what a check accepts; then it is not quite untouched: `limited` and
// `peaksHeldDb` say so, and the line. The gain corrected until within 0.3 LU (three times at most).
// → { gainDb, limited, peaksHeldDb, lufs, truePeak }
async function comparison(src, dest, { lufs, channels, srcChannels, codec, T }) {
  const chan = channels === 1 ? (srcChannels === 1 ? "anull" : "aformat=channel_layouts=mono")
    : srcChannels === 1 ? "pan=stereo|c0=c0|c1=c0" : srcChannels === 2 ? "anull" : "aformat=channel_layouts=stereo";
  // (float first: a filter fed 16 bits may work in 16 bits and round a quiet voice again)
  const base = `aformat=sample_fmts=fltp,${chan},aresample=48000`;
  const was = await loudnessAt(src, base);
  if (was.lufs == null || lufs == null) throw new LevelError("could not measure the source's loudness for --before.");
  let gain = lufs - was.lufs, limited = was.truePeak != null && was.truePeak + gain > T.peakAccepted, got;
  for (let pass = 0; pass < 4; pass++) {
    const af = [base, `volume=${gain.toFixed(2)}dB`];
    if (limited) af.push(`aresample=${LIMITER.rate}`, `alimiter=limit=${(10 ** (T.truePeak / 20)).toFixed(6)}:attack=${LIMITER.attack}:release=${LIMITER.release}:level=disabled:latency=1`, "aresample=48000");
    const w = await ffmpegRun(["-hide_banner", "-nostdin", "-v", "error", "-y", "-i", src, "-map", "0:a:0", "-vn", "-af", af.join(","), "-map_metadata", "-1", "-map_chapters", "-1", "-ar", "48000", ...codec, dest]);
    if (w.status !== 0) throw new LevelError(`ffmpeg could not write the sound before: ${lastLine(w.stderr)}`);
    got = await loudness(dest);
    if (!limited && got.truePeak != null && got.truePeak > T.peakAccepted) { limited = true; continue; }
    if (got.lufs == null || Math.abs(got.lufs - lufs) <= 0.3) break;
    gain += lufs - got.lufs;
  }
  const held = limited && was.truePeak != null && got.truePeak != null ? Math.max(0, was.truePeak + gain - got.truePeak) : null;
  return { gainDb: +gain.toFixed(2), limited, peaksHeldDb: held == null ? null : +held.toFixed(1), lufs: got.lufs, truePeak: got.truePeak };
}

// what dead runs left: older than a day, beside an output or in the system's temp directory
function sweep(dirs) {
  const now = Date.now();
  for (const [dir, re] of dirs) {
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!re.test(n)) continue;
      const p = path.join(dir, n);
      try { if (now - fs.lstatSync(p).mtimeMs > LEFTOVER_MS) fs.rmSync(p, { recursive: true, force: true }); } catch { /* another run's, or gone */ }
    }
  }
}

// measure's hum where it was not judged: one sentence with measure's reason
export const humNotJudged = (h) => `Whether it has hum could not be judged${h?.why ? ` (${h.why.replace(/\.$/, "")})` : ""}: none is known to be there, and none is known to be gone.`;

// the hum the result's measurement still names (after a notch) → { why, hz, harmonics, overDb, lines } or null
export function humStill(m2) {
  const h = m2?.hum;
  if (!(m2?.findings || []).some((x) => x.id === "hum") || !h?.hz) return null;
  const lines = ((h.hz === 50 ? h.at50 : h.at60) || []).filter((x) => x.counts).map((x) => x.hz);
  return {
    why: `Hum at ${h.hz} Hz is still measured in the result: ${h.harmonics} line${h.harmonics === 1 ? "" : "s"}${lines.length ? ` (${lines.join(", ")} Hz)` : ""}, up to ${f1(h.overDb)} dB over the noise beside ${h.harmonics === 1 ? "it" : "them"}${h.underSpeechDb != null ? `, ${i0(h.underSpeechDb)} dB under the speech` : ""}; the notches did not take ${h.harmonics === 1 ? "it" : "them"} out.`,
    hz: h.hz, harmonics: h.harmonics, overDb: h.overDb, lines,
  };
}

const sameFile = (a, b) => path.resolve(a) === path.resolve(b) ||
  (fs.existsSync(a) && fs.existsSync(b) && (() => { const x = fs.statSync(a), y = fs.statSync(b); return x.dev === y.dev && x.ino === y.ino; })());

// ---------------------------------------------------------------- the run

// opts: { for: [names], loudness, peak, denoise, tone, level, mono, audio, before, peaks (the lab's) }
export async function clean(file, out, opts = {}, stages = null) {
  const o = { for: [], denoise: "auto", tone: "auto", level: "auto", mono: false, audio: 1, ...opts };
  const fileAbs = path.resolve(file), outAbs = path.resolve(out);
  const ending = path.extname(out).slice(1).toLowerCase();
  const fmt = FORMATS[ending];
  const srcEnding = path.extname(file).slice(1).toLowerCase();
  const alone = `write its sound alone as .m4a (clean ${path.basename(file)} ${path.basename(file, path.extname(file))}.m4a) and lay it under the picture where it is edited`;
  const cannot = `clean cannot put new sound to the picture of a .${srcEnding || "?"} file (it does so for ${VIDEO_ENDINGS.join(", ")}): ${alone}.`;
  if (!fmt) {
    // (a video named in its own kind of file, which clean cannot write: the way out)
    let v = null;
    if (ending && ending === srcEnding) try { v = facts(fileAbs).video; } catch { /* said below */ }
    refuse(v ? cannot : `clean writes ${list(AUDIO_ENDINGS)}, or a video in its own ending (${VIDEO_ENDINGS.join(", ")}): ${path.basename(out)} ends in ${ending ? `.${ending}` : "nothing"}.`);
  }
  if (sameFile(out, file)) refuse(`${rel(out)} is the recording itself: clean never writes over its input; name another file.`);
  const f = facts(fileAbs);
  if (fmt.kind === "video") {
    if (!f.video) refuse(`${f.name} has no picture: write its sound as ${list(AUDIO_ENDINGS)}.`);
    if (srcEnding !== ending) refuse(FORMATS[srcEnding]?.kind === "video"
      ? `A video keeps its picture only in its own kind of file: name the output .${srcEnding} like ${f.name}, or write its sound alone as ${list(AUDIO_ENDINGS)}.`
      : cannot);
  }
  if (fmt.encoder && !new RegExp(`\\b${fmt.encoder}\\b`).test(encoders()))
    refuse(`This ffmpeg cannot write .${ending} (it has no ${fmt.encoder}): write ${list(AUDIO_ENDINGS.filter((e) => e !== `.${ending}`))}.`);
  const streams = streamsOf(fileAbs);
  const nAudio = Math.max(1, streams.audio.length);
  if (o.audio > nAudio) refuse(`${f.name} has ${nAudio === 1 ? "one audio stream" : `${nAudio} audio streams`}: --audio takes ${nAudio === 1 ? "only 1" : `1 to ${nAudio}`}, not ${o.audio}.`);
  const chosen = streams.audio[o.audio - 1] ?? { start: 0, channels: f.channels };

  let bfmt = null, beforeAbs = null;
  if (o.before != null) {
    beforeAbs = path.resolve(o.before);
    const be = path.extname(o.before).slice(1).toLowerCase();
    bfmt = FORMATS[be];
    if (!bfmt || bfmt.kind !== "audio") refuse(`--before writes ${list(AUDIO_ENDINGS)}: ${path.basename(o.before)} ends in ${be ? `.${be}` : "nothing"}.`);
    if (sameFile(o.before, file)) refuse(`--before names the recording itself: clean never writes over its input; name another file.`);
    if (sameFile(o.before, out) || beforeAbs === `${outAbs}.json`) refuse(`--before names the output: the sound before and after need two files.`);
    if (bfmt.encoder && !new RegExp(`\\b${bfmt.encoder}\\b`).test(encoders()))
      refuse(`This ffmpeg cannot write .${be} (it has no ${bfmt.encoder}): name --before ${list(AUDIO_ENDINGS.filter((e) => e !== `.${be}`))}.`);
  }

  // the targets: the master of the platforms named (lib/targets.mjs; none named, its defaults),
  // --loudness and --peak over it
  let plat;
  try { plat = platformTargets(o.for); } catch (e) { refuse(e.message); }
  const M = plat.master;
  const T = { ...TARGETS, lufs: M.lufs, truePeak: M.truePeakDbtp.aim, peakAccepted: M.truePeakDbtp.max, rangeLu: M.rangeLu.aim };
  if (o.loudness != null) T.lufs = o.loudness;
  if (o.peak != null) { T.truePeak = o.peak; T.peakAccepted = o.peak + PEAK_MARGIN_DB; }
  const st = stages ?? await realStages();
  // (a test's made-up measurement where it gives one: measure(file, "before" | "after"))
  const measureOf = st.measure ?? measure;

  // the folders of what is written are made, as the collection's other tools make theirs
  // (`artifacts/<name>.m4a`, `voice/<name>/…` of a first run); what dead runs left there goes
  const places = [outAbs, beforeAbs].filter(Boolean);
  for (const p of places) fs.mkdirSync(path.dirname(p), { recursive: true });
  sweep([...new Set(places.map((p) => path.dirname(p)))].map((d) => [d, /^\.voice-sound-clean-/]).concat([[os.tmpdir(), /^voice-sound-clean-[A-Za-z0-9]{6}$/]]));
  // the working folder beside the output; what is delivered, under hidden names beside its place
  const work = fs.mkdtempSync(path.join(path.dirname(outAbs), `${WORK_PREFIX}${process.pid}-`));
  const tag = path.basename(work);
  const partial = (p) => path.join(path.dirname(p), `${tag}-${path.basename(p)}`);
  const outPart = partial(outAbs), jsonPart = partial(`${outAbs}.json`), beforePart = beforeAbs && partial(beforeAbs);
  const gone = () => {
    fs.rmSync(work, { recursive: true, force: true });
    for (const p of [outPart, jsonPart, beforePart]) if (p) fs.rmSync(p, { force: true });
  };
  const onSignal = (sig) => { stopChildren(); gone(); process.exit(sig === "SIGINT" ? 130 : sig === "SIGHUP" ? 129 : 143); };
  for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, onSignal);
  const t0 = Date.now();
  try {
    // 0. the voice's stream on its own when it is not the first (measure and repair read the first)
    let src = fileAbs;
    if (o.audio > 1) {
      src = path.join(work, "voice.mka");
      let r = await ffmpegRun(["-hide_banner", "-nostdin", "-v", "error", "-y", "-i", fileAbs, "-map", `0:a:${o.audio - 1}`, "-c", "copy", "-map_metadata", "-1", src]);
      if (r.status !== 0) r = await ffmpegRun(["-hide_banner", "-nostdin", "-v", "error", "-y", "-i", fileAbs, "-map", `0:a:${o.audio - 1}`, "-c:a", "flac", "-map_metadata", "-1", src]);
      if (r.status !== 0) throw new LevelError(`ffmpeg could not take the ${nth(o.audio)} audio stream out of ${f.name}: ${lastLine(r.stderr)}`);
    }
    const named = (e) => { if (e instanceof Refusal && src !== fileAbs) e.message = e.message.split(rel(src)).join(`${f.name}'s ${nth(o.audio)} audio stream`); return e; };
    // 1. what is wrong with it, and whether there is a voice to work on
    let m;
    try { m = await measureOf(src, "before"); } catch (e) { throw named(e); }
    const voiceS = m.speech?.seconds ?? 0;
    const what = src === fileAbs ? f.name : `${f.name}'s ${nth(o.audio)} audio stream`;
    if (m.voice?.found === false) refuse(`measure finds no voice in ${what} (${String(m.voice.why || "nothing in it is speech").replace(/\.$/, "")}): there is nothing to mend or bring to a loudness, and raising it would only raise its noise.`);
    if (!voiceS) refuse(`measure finds no voice in ${what} (its level never rises far enough over its floor): there is nothing to mend or bring to a loudness, and raising it would only raise its noise.`);
    if (voiceS < MIN_VOICE_S) refuse(`measure finds only ${voiceS.toFixed(1)} s of voice in ${what}, under the ${MIN_VOICE_S} s clean needs to measure a voice's loudness: give it a longer recording.`);
    // the loudness it came in at, as played (a file with one channel plays on both speakers)
    const srcLufs = lufsOrNull(m.loudness?.integratedLufs);
    const srcAsPlayed = srcLufs == null ? null : srcLufs + ((m.analysed?.channels ?? 1) === 1 ? TWO_SPEAKERS_LU : 0);
    // (the far bound is the recording's own level, whatever the target: under it, refused before
    // repair runs; where ebur128's gate hides the voice, measure's level of its speech frames)
    const srcLevel = srcAsPlayed ?? (m.levels?.speechLufs != null ? m.levels.speechLufs + ((m.analysed?.channels ?? 1) === 1 ? TWO_SPEAKERS_LU : 0) : null);
    const maxGain = MAX_GAIN_DB + T.lufs - TARGETS.lufs;
    if (o.level !== "off" && srcLevel != null && T.lufs - srcLevel > maxGain) refuse(tooQuiet(srcLevel, T.lufs, T.lufs - srcLevel, maxGain));
    // 2. the tone's plan (it needs to know whether repair takes noise out), run at the end of repair's pass
    const rp = st.repairPlan ? st.repairPlan(m, { denoise: o.denoise }) : { steps: [] };
    const den = (rp.steps || []).find((s) => s.id === "denoise");
    const toneFor = (d) => st.tonePlan(m, { tone: o.tone, denoised: !!d && d.method !== "off", noiseLeftDb: d && d.method !== "off" && d.snrDb != null && d.reduceDb != null ? d.snrDb + d.reduceDb : null });
    let tp = toneFor(den);
    const after = st.toneFilters(tp) || "";
    // (asked again by repair where its noise step turned out otherwise: the denoiser's probe found
    // noise under the voice, or the denoiser failed and ffmpeg's method took its place)
    const retone = (d) => { tp = toneFor(d); return st.toneFilters(tp) || ""; };
    // 3. repair (with the tone's filters) to the intermediate, its working files in ours
    const mended = path.join(work, "mended.wav");
    const rr = await st.repair(src, mended, m, { denoise: o.denoise, after, retone, tmp: work });
    // (the voice's stream on its own stays for the comparison, compressed as it came)
    if (src !== fileAbs && o.before == null) fs.rmSync(src, { force: true });
    // 4. level, encoded as delivered (the intermediate removed once read); with level off, the
    // loudness it came in at kept
    const sound = fmt.kind === "video" ? path.join(work, `sound.${fmt.audio}`) : outPart;
    const lv = await level(mended, sound, { targets: T, mono: o.mono, level: o.level, encode: fmt.codec, tmp: work, removeInput: true, keepLufs: srcAsPlayed, peaks: o.peaks });
    // 5. a video: the picture copied with the new sound, in step (the voice's stream started where it started)
    if (fmt.kind === "video") {
      const offset = Math.max(0, chosen.start - streams.start);
      const r = await ffmpegRun(["-hide_banner", "-nostdin", "-v", "error", "-y", "-i", fileAbs, "-itsoffset", offset.toFixed(6), "-i", sound,
        "-map", "0:V", "-map", "1:a:0", "-c", "copy", "-map_metadata", "-1", "-map_chapters", "-1",
        ...(fmt.faststart ? ["-movflags", "+faststart"] : []), ...(fmt.muxer ? ["-f", fmt.muxer] : []), outPart]);
      if (r.status !== 0) throw new LevelError(`ffmpeg could not put the new sound to the picture: ${lastLine(r.stderr)}`);
      fs.rmSync(sound, { force: true });
    }
    // 6. measured again, as delivered
    const m2 = await measureOf(outPart, "after");
    // 7. the untouched sound beside it, as loud as the output, to compare by ear
    let before = null;
    if (o.before != null) {
      before = await comparison(src, beforePart, { lufs: lv.delivered.lufs, channels: o.mono ? 1 : 2, srcChannels: chosen.channels ?? f.channels, codec: bfmt.codec, T });
      before.file = rel(beforeAbs);
    }
    const stage = (name, xs) => (xs || []).map((s) => ({ stage: name, ...s }));
    const steps = [...stage("repair", rr.steps), ...stage("tone", tp.steps), ...lv.steps];
    const left = [...stage("repair", rr.left), ...stage("tone", tp.left), ...lv.left];
    // hum: where it could not be judged, said (nothing is known to be left); after a notch, the
    // result's own measurement decides what is said of it
    const notJudged = m.hum?.judged === false ? [{ id: "hum", stage: "measure", why: humNotJudged(m.hum) }] : [];
    const dehum = steps.find((s) => s.id === "dehum"), still = humStill(m2);
    if (dehum && still) {
      dehum.why = `${dehum.why} Measured again on the result, the hum is still there (see what is left).`;
      dehum.stillThere = true;
      left.push({ id: "hum", stage: "repair", ...still });
    }
    const measuredLufs = o.mono ? T.lufs - TWO_SPEAKERS_LU : T.lufs;
    const report = {
      source: f.name,
      output: rel(outAbs),
      format: { ending, codec: fmt.name, says: fmt.says, sampleRate: 48000, channels: o.mono ? 1 : 2, video: fmt.kind === "video", pictureCopied: fmt.kind === "video" },
      audio: { streams: nAudio, used: o.audio, dropped: nAudio - 1 },
      level: o.level,
      measured: { before: numbers(m), after: numbers(m2) },
      steps, left, notJudged,
      skipped: lv.skipped,
      targets: { lufs: o.level === "off" ? lv.settings.aimLufs : T.lufs, asPlayed: "on two speakers", measuredLufs: o.level === "off" ? lv.settings.measuredLufs : +measuredLufs.toFixed(2),
        kept: o.level === "off", truePeak: T.truePeak, peakAccepted: T.peakAccepted, peakAfterEncoding: true, rangeLu: T.rangeLu,
        from: o.level === "off" ? "the recording's own loudness, level off" : o.for.length ? `the master for ${plat.platforms.map((p) => p.id).join(", ")} (${plat.kind})` : "the master for video, no platform named",
        overridden: [o.loudness != null && "loudness", o.peak != null && "peak"].filter(Boolean) },
      delivered: lv.delivered,
      before,
      // (the run's choices, then each stage's own numbers)
      settings: { for: o.for, loudness: o.loudness ?? null, peak: o.peak ?? null, denoise: o.denoise, tone: o.tone, level: o.level, mono: o.mono, audio: o.audio, before: o.before ?? null,
        repairStage: { method: rr.method ?? null, ...(rr.probe && { probe: rr.probe }) }, levelStage: lv.settings, passes: lv.passes },
      seconds: +((Date.now() - t0) / 1000).toFixed(1),
    };
    fs.writeFileSync(jsonPart, JSON.stringify(report, null, 1) + "\n");
    // 8. delivered together: the sound, the comparison, the report (no signal comes between these)
    fs.renameSync(outPart, outAbs);
    if (beforePart) fs.renameSync(beforePart, beforeAbs);
    fs.renameSync(jsonPart, `${outAbs}.json`);
    return report;
  } finally {
    for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.removeListener(s, onSignal);
    gone();
  }
}

// ---------------------------------------------------------------- what an agent reads

const LEVEL_SAYS = {
  auto: "level auto (a leveller where the phrases are uneven, the loudness, the loudest peaks taken down by a slow limiter before the limiter)",
  plain: "level plain (only the gain to the loudness and the limiter: its own dynamics kept)",
  off: "level off (its own dynamics and loudness kept, only the peaks made safe)",
};

export function lines(r) {
  const b = r.measured.before, a = r.measured.after, fm = r.format, T = r.targets;
  const mono = fm.channels === 1;
  const out = [`${r.output}: ${clock(a.seconds ?? 0)} of the voice, ${fm.says}, 48 kHz, ${mono ? `one channel (${f1(T.lufs)} LUFS as played on two speakers, ${f1(T.measuredLufs)} as ffmpeg measures the file)` : "two channels with the same voice in both"}${fm.video ? ", the picture copied as it was" : ""}; from ${r.source}, ${LEVEL_SAYS[r.level] || `level ${r.level}`}.`];
  const A = r.audio;
  if (A && A.streams > 1)
    out.push(`${r.source} has ${A.streams} audio streams: the ${nth(A.used)} was taken for the voice${fm.video ? " and is the video's only sound now" : ""}, the other${A.dropped === 1 ? " is" : "s are"} not in the output${A.used === 1 ? "; --audio <n> names another as the voice" : ""}.`);
  if (r.steps.length) {
    out.push("Done:");
    for (const s of r.steps) out.push(`  ${s.id} (${s.stage}): ${s.why}`);
  }
  for (const s of r.skipped || []) out.push(`Not done: ${s.why}`);
  const played = (x, ch) => (ch === 1 && x.lufs != null ? ` (one channel; ${f1(x.lufs + TWO_SPEAKERS_LU)} as played)` : "");
  out.push(`Before → after: loudness ${f1(b.lufs)}${played(b, b.channels)} → ${f1(a.lufs)}${played(a, fm.channels)} LUFS, range ${f1(b.rangeLu)} → ${f1(a.rangeLu)} LU, true peak ${f1(b.truePeak)} → ${f1(a.truePeak)} dBTP` +
    (b.snrDb != null || a.snrDb != null ? `, noise ${i0(b.snrDb)} → ${i0(a.snrDb)} dB under the speech (A-weighted)` : "") + ".");
  if (r.left.length) out.push(`Not mended: ${r.left.map((x) => `${x.id}: ${x.why}`).join(" ")}`);
  for (const x of r.notJudged || []) out.push(`Not judged: ${x.id}: ${x.why}`);
  out.push(`Targets: ${f1(T.lufs)} LUFS as played on two speakers${mono ? ` (the one channel ${f1(T.measuredLufs)} LUFS as ffmpeg measures it)` : ""}, true peak ${f1(T.truePeak)} dBTP after the encoding (a check accepts ${f1(T.peakAccepted)}), range ${T.rangeLu} LU or under; ${T.from}${T.overridden?.length ? `, ${T.overridden.join(" and ")} as asked` : ""}.`);
  if (r.before) {
    const g = r.before.gainDb, B = r.before;
    out.push(`To compare by ear: ${B.file}, the recording as it was but for ${g >= 0 ? "+" : ""}${f1(g)} dB, as loud as the output (${f1(B.lufs)} LUFS)` +
      (B.limited ? `. Its peaks were held by a limiter to be that loud (${B.peaksHeldDb != null ? `${f1(B.peaksHeldDb)} dB off the loudest, ` : ""}under ${f1(T.truePeak)} dBTP), so it is not quite untouched` : "") +
      ": both play equally loud, so neither wins by being louder.");
  }
  out.push(`Beside it: ${r.output}.json (what was measured, done and left). Measured, not heard: say so.`);
  return out;
}

export async function cleanCommand(args, stages = null) {
  const json = args.includes("--json");
  const say = (msg) => { console.log(json ? JSON.stringify({ error: msg }) : msg); process.exitCode = 1; return null; };
  let p;
  try { p = parse(args); } catch (e) { return say(e.message); }
  try {
    const r = await clean(p.file, p.out, p.opts, stages);
    console.log(json ? JSON.stringify(r, null, 1) : lines(r).join("\n"));
    return r;
  } catch (e) {
    if (e instanceof Refusal || e instanceof LevelError) return say(e.message);
    return say(`clean failed: ${String(e?.message || e).split("\n")[0]}`);
  }
}
