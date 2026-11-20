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
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { measure } from "./measure.mjs";
import { Refusal, facts } from "./analyse.mjs";
import { level, LevelError, TARGETS, LIMITER, MAX_GAIN_DB, tooQuiet, NO_LOUDNESS_LUFS, TWO_SPEAKERS_LU, loudness, loudnessAt, ffmpegRun, stopChildren } from "./level.mjs";
import { targets as platformTargets } from "./targets.mjs";

export const USAGE = "Usage: voice.mjs clean <audio|video, up to 60 min> <out> [--for <platform…>] [--loudness <LUFS>] [--peak <dBTP>] [--denoise auto|off|gentle|strong] [--tone auto|off] [--level auto|plain|off] [--mono] [--audio <n>] [--before <file>] [--json]";
// a check accepts the true peak this much over the one aimed at (−1.5 aimed at, −1 accepted)
const PEAK_MARGIN_DB = 0.5;
// the least voice clean works on: under half a second, measure's speech is a cough or a click
// and ebur128's gated loudness (400 ms blocks) has one block to rest on. From there it holds:
// cuts of 0.6 and 0.8 s of clean speech and three corpus clips with 0.5 to 0.9 s of voice landed
// within 0.2 LU of the target with their peaks under the ceiling (2026-11-20); a first bound of
// 1 s had refused those clips, a short answer as a person might well bring it
export const MIN_VOICE_S = 0.5;
// the longest source clean takes (measure takes any length): the collection's videos run to a
// quarter of an hour (docs/standards.md), and an hour is four times that with room for a talk to
// cut from; its working files then hold about 1.4 GB (23 MB a minute), and clean takes about
// 5 minutes on a laptop with ffmpeg alone, 8 with the denoiser (ESTIMATE below), longer on a Sprite
export const MAX_SOURCE_S = 3600;
// what dead runs left (a hidden folder or file beside an output, a folder of the older version in
// the system's temp directory) is removed by the next run once it is older than this
const LEFTOVER_MS = 24 * 3600 * 1000;
const WORK_PREFIX = ".voice-sound-clean-";

// ffmpeg's aac with its fast coder: its default (twoloop) codes the two equal channels apart at
// some spots and lifts the true peak there, by 0.9 to 4.4 dB over the limiter's ceiling on the
// review's café recording (−0.6, −1.0, +1.3 dBTP under ceilings of −1.5, −2.5, −3.1 dB, not
// following them), where the fast coder stayed 0.0 to 0.1 dB over (−1.5, −2.4, −3.0); against the
// same sound unencoded it also scored higher (PESQ 4.62 and 4.61 against 4.61 and 4.44, SI-SDR 43
// and 48 against 37 and 35 dB, the café recording and a clean reading, level/aac-quality.sh,
// 2026-11-20). The same encoder, one option
const AAC = ["-c:a", "aac", "-b:a", "192k", "-aac_coder", "fast"];
// the repair stage's forecast of the noise left ("it ends about N dB under") is said as the
// delivered file measures it where the two differ by more than this (a judgement: measure's own
// noise numbers move by a dB or two between a recording and its encoded copy)
const NOISE_SAID_DB = 3;
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
const list = (xs, word = "or") => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${word} ${xs.at(-1)}`);
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
  return { repair: r.repair, repairPlan: r.repairPlan, tonePlan: t.tonePlan, toneFilters: t.toneFilters, denoiserThere: () => !!r.neuralDenoiser?.() };
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
// `peaksHeldDb` say so, and the line. Measured as the output was levelled: where the level stage
// turned knocks down, with their stretches (`cut`) left out of the loudness on both sides, since
// the comparison keeps them as they came. The file is measured after it is written, the gain
// corrected until within 0.3 LU and the limiter's ceiling lowered until its true peak after the
// encoding is under what a check accepts, both in each write, six writes at most; the nearest
// kept, and the line says its own numbers.
// → { gainDb, limited, peaksHeldDb, lufs, truePeak, matched: "whole" | "voice", aimLufs, ceilingDb, writes }
const COMPARISON_WRITES = 6;
async function comparison(src, dest, { lufs, channels, srcChannels, codec, T, cut = null, tmp }) {
  const bestFile = path.join(tmp, `before-best${path.extname(dest)}`);
  const chan = channels === 1 ? (srcChannels === 1 ? "anull" : "aformat=channel_layouts=mono")
    : srcChannels === 1 ? "pan=stereo|c0=c0|c1=c0" : srcChannels === 2 ? "anull" : "aformat=channel_layouts=stereo";
  // (float first: a filter fed 16 bits may work in 16 bits and round a quiet voice again)
  const base = `aformat=sample_fmts=fltp,${chan},aresample=48000`;
  const was = await loudnessAt(src, cut ? `${base},${cut}` : base), wasPeak = cut ? (await loudnessAt(src, base)).truePeak : was.truePeak;
  if (was.lufs == null || lufs == null) throw new LevelError("could not measure the source's loudness for --before.");
  let gain = lufs - was.lufs, limited = wasPeak != null && wasPeak + gain > T.peakAccepted, ceiling = T.truePeak, best = null, writes = 0;
  for (;;) {
    const af = [base, `volume=${gain.toFixed(2)}dB`];
    if (limited) af.push(`aresample=${LIMITER.rate}`, `alimiter=limit=${(10 ** (Math.max(-24, ceiling) / 20)).toFixed(6)}:attack=${LIMITER.attack}:release=${LIMITER.release}:level=disabled:latency=1`, "aresample=48000");
    const w = await ffmpegRun(["-hide_banner", "-nostdin", "-v", "error", "-y", "-i", src, "-map", "0:a:0", "-vn", "-af", af.join(","), "-map_metadata", "-1", "-map_chapters", "-1", "-ar", "48000", ...codec, dest]);
    if (w.status !== 0) throw new LevelError(`ffmpeg could not write the sound before: ${lastLine(w.stderr)}`);
    writes++;
    const whole = await loudness(dest), got = cut ? { ...(await loudness(dest, cut)), truePeak: whole.truePeak } : whole;
    const off = got.lufs == null ? 0 : got.lufs - lufs, over = got.truePeak == null ? 0 : got.truePeak - T.peakAccepted;
    // (the nearest: never over what a check accepts, then the loudness)
    const key = [over > 0 ? 1 : 0, Math.abs(off)];
    const now = { key, got, gain, limited, ceiling, write: writes };
    if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && key[1] < best.key[1])) { best = now; fs.copyFileSync(dest, bestFile); }
    if ((Math.abs(off) <= 0.3 && over <= 0) || writes === COMPARISON_WRITES) break;
    // both corrections in the same write: the ceiling for the peak, the gain for the loudness
    if (over > 0) { if (!limited) limited = true; else ceiling -= got.truePeak - T.truePeak + 0.1; }
    if (Math.abs(off) > 0.3) gain -= off;
  }
  if (best.write !== writes) fs.copyFileSync(bestFile, dest);
  fs.rmSync(bestFile, { force: true });
  const g = best.got;
  const held = best.limited && wasPeak != null && g.truePeak != null ? Math.max(0, wasPeak + best.gain - g.truePeak) : null;
  return { gainDb: +best.gain.toFixed(2), limited: best.limited, peaksHeldDb: held == null ? null : +held.toFixed(1), lufs: g.lufs, truePeak: g.truePeak,
    matched: cut ? "voice" : "whole", aimLufs: lufs, ceilingDb: best.limited ? +best.ceiling.toFixed(2) : null, writes };
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

// ---------------------------------------------------------------- going on where it stopped
//
// RESUME. A bot's shell ends a command after a few minutes (rragent: 180 s, 2026-11-02, by a
// signal); a person waits. So each stage keeps what it made in the working folder beside the
// output, and the same command on the same source called again goes on from there. The folder is
// named by a key of the command (the source's path, size and time, the output, every option, the
// denoiser named): a changed option or source has another folder and starts afresh, and the
// old one goes as any dead run's once it is a day old. state.json says which stages are done, with
// what they made (the measurement, the repair's and the tone's steps, the level stage's report,
// the result's measurement, the comparison's numbers) and the files they left (voice.mka,
// mended.wav, the level stage's sound, the video, the comparison), each moved into place only
// once it was whole. A stage that was running when the run was ended starts again; an attempt's
// own files lie in a-<pid>/, so that an ffmpeg a SIGKILL left running writes only into its own.
// A second run on the same work while the first runs (its lock's process alive) works in a folder
// of its own, which it does not keep. Every signal (SIGTERM, SIGINT, SIGHUP) ends every child at
// once and keeps what was finished; a refusal, an error and a finished run leave nothing.
const STATE_VERSION = 1;
const STAGE_SAYS = { voice: "the voice's stream", measure: "the measurement", repair: "the repair", level: "the level stage", mux: "the picture's new sound", after: "the result's measurement", before: "the comparison" };
const STAGE_ORDER = ["voice", "measure", "repair", "level", "mux", "after", "before"];

const alive = (pid) => {
  if (!pid || pid === process.pid) return pid === process.pid;
  try { process.kill(pid, 0); } catch { return false; }
  try { return !/^\d+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, "utf8")); } catch { return true; }
};

// → { work, state, from: [stages taken up], resumable }
function workFor(outAbs, fileAbs, o, beforeAbs, stages) {
  const s = fs.statSync(fileAbs);
  const key = JSON.stringify({ v: STATE_VERSION, source: fileAbs, size: s.size, mtimeMs: Math.round(s.mtimeMs), out: outAbs, before: beforeAbs,
    for: o.for, loudness: o.loudness ?? null, peak: o.peak ?? null, denoise: o.denoise, tone: o.tone, level: o.level, mono: o.mono, audio: o.audio, peaks: o.peaks ?? null,
    denoiser: [process.env.VOICE_SOUND_DENOISER ?? null, process.env.VOICE_SOUND_DPDFNET ?? null, process.env.VOICE_SOUND_DENOISE ?? null], stages: stages ? "given" : "lib" });
  const hash = createHash("sha1").update(key).digest("hex").slice(0, 12);
  let work = path.join(path.dirname(outAbs), `${WORK_PREFIX}${hash}`);
  fs.mkdirSync(work, { recursive: true });
  // the lock: this run's; another run's that is alive sends this one to a folder of its own
  const lock = path.join(work, "lock");
  let held = null;
  try { held = Number(fs.readFileSync(lock, "utf8")); } catch { /* none */ }
  if (held && alive(held)) {
    work = fs.mkdtempSync(path.join(path.dirname(outAbs), `${WORK_PREFIX}${hash}-${process.pid}-`));
    return { work, state: { key, done: {}, seconds: {} }, from: [], resumable: false };
  }
  fs.writeFileSync(lock, String(process.pid));
  // what dead attempts left in it
  for (const n of fs.readdirSync(work)) { const p = /^a-(\d+)$/.exec(n); if (p && !alive(Number(p[1]))) fs.rmSync(path.join(work, n), { recursive: true, force: true }); }
  let state = null;
  try { state = JSON.parse(fs.readFileSync(path.join(work, "state.json"), "utf8")); } catch { /* none, or broken */ }
  if (!state || state.key !== key) state = { key, done: {}, seconds: {} };
  // a stage counts as done only where what it made is still there for the stages after it
  const has = (n) => fs.existsSync(path.join(work, n));
  const ending = path.extname(outAbs).slice(1).toLowerCase(), fmt = FORMATS[ending];
  const sound = fmt.kind === "video" ? `sound.${fmt.audio}` : `out.${ending}`;
  const D = state.done, undo = (from) => { for (const n of STAGE_ORDER.slice(STAGE_ORDER.indexOf(from))) if (n !== "before") delete D[n]; };
  if (D.voice !== undefined && !has("voice.mka") && (D.repair === undefined || (beforeAbs && D.before === undefined))) delete D.voice;
  if (D.repair !== undefined && D.level === undefined && !has("mended.wav")) undo("repair");
  if (D.level !== undefined && !(fmt.kind === "video" && D.mux !== undefined) && !has(sound)) undo("level");
  if (D.mux !== undefined && !has(`out.${ending}`)) undo("mux");
  if (D.before !== undefined && !has(`before${path.extname(beforeAbs || "").toLowerCase()}`)) delete D.before;
  return { work, state, from: STAGE_ORDER.filter((n) => D[n] !== undefined), resumable: true };
}

// a file into its place: a rename, or a copy where the place lies on another file system
function move(from, to) {
  try { fs.renameSync(from, to); } catch (e) {
    if (e.code !== "EXDEV") throw e;
    fs.copyFileSync(from, `${to}.voice-sound-part`); fs.renameSync(`${to}.voice-sound-part`, to); fs.rmSync(from, { force: true });
  }
}

// ---------------------------------------------------------------- how long it takes
//
// ESTIMATE. Printed once the measurement is done, from the length, the repair's plan, the
// machine and the output's kind; each stage's line says its part. What it rests on (2026-11-20,
// ffmpeg 8.1.3, a noisy recording to .m4a: dns cafeteria looped, level/calib.mjs):
// - a bot's Sprite (8 cores, 0.9 GB free, the coordinator's runs): clean in all 2.2 / 8.7 / 36 /
//   104 s for 15 s / 60 s / 5 min / 15 min with ffmpeg alone, 5.8 / 17 / 74 / 216 s with the
//   denoiser, still with aac's twoloop coder (two encodings on the longer ones). The denoiser's
//   part (112 s more for 15 minutes) ran there in 2 pieces at once (its slots: half of 0.9 GB over
//   194 MB a piece)
// - this laptop (20 cores, shared with other work), each stage, after .m4a took aac's fast coder
//   (one encoding where twoloop needed two, level/calib-fast.txt): measure 0.3 / 0.7 / 2.1 to 2.7 /
//   6.1 s for 15 s / 60 s / 5 / 15 min; repair with ffmpeg alone 0.2 / 0.4 / 1.9 / 4.3; the level
//   stage to .m4a 0.8 to 1.3 / 3.2 to 3.9 / 10.5 to 14.6 / 29 to 39, to .wav 0.025 a second (a
//   reading, level/time-level.mjs); the result's measurement 0.3 / 0.8 / 2.4 to 2.7 / 7.4; the
//   repair stage with the denoiser 5.2 / 11 / 24 / 57 s, with up to 19 pieces at once
// So: each part's c0 + perS × seconds, a little over the laptop's; the denoiser's part model
// start-up and perS × seconds over the square root of the pieces it runs at once (2 → 15 at once
// took 112 → 48 s on 15 minutes: not in proportion), its perS a fifth over what meets the laptop's,
// so that the Sprite's 2 at once stay under it; the parts that are ffmpeg's and
// measure's own scaled by how much slower this run's measurement went than the laptop's (from
// 60 s on; up to twice), so that a busy or a slower machine is read off the run itself. Never
// scaled down: a measurement a third quicker than the laptop's came with the other stages only a
// little quicker, and an estimate scaled by it came out short (0.82 of the run, calib-fast2).
// The denoiser's start-up varies most: 15 s of sound took 3.9 and 6.6 s in all on two runs, so
// under a minute the estimate can be some seconds long.
// Clipping adds the repair stage's own prediction of adeclip's time (its step's `predicted`: CPU
// seconds, spread 3.5 times over its pieces as repair.mjs's DECLIP_TIME says). The probe for noise
// under the voice (the denoiser there, no noise named) is about 40 s of sound through it. The
// comparison is about one more level stage. Checked against runs of 15 s to 15 min with and
// without the denoiser: README, "How long it takes".
export const ESTIMATE = {
  measure: { c0: 0.2, perS: 0.007 },
  repair: { c0: 0.2, perS: 0.007 },
  denoiser: { c0: 2, perS: 0.25 }, probeS: 40,
  level: { aac: { c0: 1, perS: 0.05 }, pcm: { c0: 0.3, perS: 0.035 } },
  after: { c0: 0.3, perS: 0.009 }, mux: { c0: 0.3, perS: 0.002 },
  speed: { fromS: 60, min: 1, max: 2 },
  declipSpread: 3.5,
};
// the measurement of a long source says it is at it from this length on (seconds)
const LONG_S = 300;
const MEASURE_S_PER_S = ESTIMATE.measure.perS;

// → { total, parts: { repair, level, mux, after, before }, says, speed }
// plan: the repair stage's (its steps, method, neural.tune.slots); measureS: how long this run's
// measurement took (null: no scaling); probe: the denoiser is there for a probe
export function estimate({ seconds, plan, probe, ending, video, before, measureS = null, done = {} }, E = ESTIMATE) {
  const lin = (c) => c.c0 + c.perS * seconds;
  const speed = measureS != null && seconds >= E.speed.fromS ? Math.min(E.speed.max, Math.max(E.speed.min, measureS / lin(E.measure))) : 1;
  const steps = plan?.steps || [];
  const dn = steps.find((s) => s.id === "denoise" && s.method === "dpdfnet");
  const neural = !!dn || plan?.method === "dpdfnet";
  const atOnce = Math.max(1, Math.min(plan?.neural?.tune?.slots ?? 1, dn?.pieces?.length ?? 1));
  const clip = steps.find((s) => s.id === "declip")?.predicted;
  const declipS = clip ? (clip.pieces > 1 ? (clip.cpuS * E.declipSpread) / clip.pieces : clip.cpuS) : 0;
  const pcm = ["wav", "flac"].includes(ending) && !video;
  const levelS = lin(pcm ? E.level.pcm : E.level.aac) * speed;
  const parts = {
    repair: lin(E.repair) * speed + (neural ? E.denoiser.c0 + (E.denoiser.perS * seconds) / Math.sqrt(atOnce) : probe ? E.denoiser.c0 + E.denoiser.perS * Math.min(seconds, E.probeS) : 0) + declipS,
    level: levelS,
    ...(video && { mux: lin(E.mux) * speed }),
    after: lin(E.after) * speed,
    ...(before && { before: levelS }),
  };
  for (const n of Object.keys(parts)) if (done[n] !== undefined) delete parts[n]; else parts[n] = +parts[n].toFixed(1);
  const total = +Object.values(parts).reduce((a, b) => a + b, 0).toFixed(1);
  const says = [parts.repair != null && `repair ${neural ? "with the neural denoiser " : ""}${duration(parts.repair)}${declipS ? `, ${duration(declipS)} of it redrawing clipped peaks` : ""}`,
    parts.level != null && `level ${duration(parts.level)}`, parts.before != null && `the comparison ${duration(parts.before)}`].filter(Boolean).join(", ");
  return { total, parts, says, speed: +speed.toFixed(2) };
}
// a time as a person reads it: "40 s", "3 min", "1 h 5 min"
export const duration = (s) => (s < 90 ? `${Math.max(1, Math.round(s))} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);

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
  if ((f.duration ?? 0) > MAX_SOURCE_S + 1)
    refuse(`${f.name} is ${clock(f.duration)} long, over the ${MAX_SOURCE_S / 60} minutes clean takes: cut it into parts of up to ${MAX_SOURCE_S / 60} minutes (at pauses) and clean each, or clean only the part that is used.`);
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
  // the working folder beside the output, named by the run (the same command on the same source
  // finds it again and goes on where it stopped: RESUME above); its scratch for this attempt
  const job = workFor(outAbs, fileAbs, o, beforeAbs, stages);
  const { work, state } = job;
  const scratch = path.join(work, `a-${process.pid}`);
  fs.mkdirSync(scratch, { recursive: true });
  const saveState = () => { fs.writeFileSync(path.join(work, "state.tmp"), JSON.stringify(state)); fs.renameSync(path.join(work, "state.tmp"), path.join(work, "state.json")); };
  // what is delivered lies in the working folder until the very end
  const done = (name) => path.join(work, name);
  let outPart = done(`out.${ending}`);
  const jsonPart = done("report.json"), beforePart = beforeAbs && done(`before${path.extname(beforeAbs).toLowerCase()}`);
  // (a finished run, a refusal or an error leaves nothing; a signal keeps what was finished)
  let keep = false;
  const gone = () => {
    fs.rmSync(scratch, { recursive: true, force: true });
    if (keep) { fs.rmSync(path.join(work, "lock"), { force: true }); return; }
    fs.rmSync(work, { recursive: true, force: true });
  };
  const onSignal = (sig) => { stopChildren(); keep = job.resumable; gone(); process.exit(sig === "SIGINT" ? 130 : sig === "SIGHUP" ? 129 : 143); };
  for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, onSignal);
  const t0 = Date.now();
  // the stages' lines: as each begins, with its estimate, and ends, with the time it took
  const say = typeof opts.progress === "function" ? opts.progress : () => {};
  let est = null;
  // (`quiet`: no lines, for the measurement, whose refusals must stay the one line printed)
  const stageRun = async (name, what, fn, quiet = false) => {
    if (state.done[name] !== undefined) return state.done[name];
    const t = Date.now(), e = est?.parts?.[name];
    if (!quiet) say(`${what} begins${e ? ` (about ${duration(e)})` : ""}.`);
    const v = await fn();
    state.done[name] = v ?? null;
    state.seconds[name] = +((Date.now() - t) / 1000).toFixed(1);
    if (job.resumable) saveState();
    if (!quiet) say(`${what} done in ${duration(state.seconds[name])}.`);
    return v;
  };
  try {
    if (job.from.length) say(`Going on from the run before, which was ended: ${list(job.from.map((n) => STAGE_SAYS[n]), "and")} ${job.from.length === 1 ? "was" : "were"} finished and ${job.from.length === 1 ? "is" : "are"} taken up.`);
    // 0. the voice's stream on its own when it is not the first (measure and repair read the first)
    let src = fileAbs;
    if (o.audio > 1) {
      src = done("voice.mka");
      await stageRun("voice", `Taking out the ${nth(o.audio)} audio stream`, async () => {
        const part = path.join(scratch, "voice.mka");
        let r = await ffmpegRun(["-hide_banner", "-nostdin", "-v", "error", "-y", "-i", fileAbs, "-map", `0:a:${o.audio - 1}`, "-c", "copy", "-map_metadata", "-1", part]);
        if (r.status !== 0) r = await ffmpegRun(["-hide_banner", "-nostdin", "-v", "error", "-y", "-i", fileAbs, "-map", `0:a:${o.audio - 1}`, "-c:a", "flac", "-map_metadata", "-1", part]);
        if (r.status !== 0) throw new LevelError(`ffmpeg could not take the ${nth(o.audio)} audio stream out of ${f.name}: ${lastLine(r.stderr)}`);
        fs.renameSync(part, src);
        return true;
      });
    }
    const named = (e) => { if (e instanceof Refusal && src !== fileAbs) e.message = e.message.split(rel(src)).join(`${f.name}'s ${nth(o.audio)} audio stream`); return e; };
    // 1. what is wrong with it, and whether there is a voice to work on (a long one says it is at it)
    let m;
    if (state.done.measure === undefined && (f.duration ?? 0) > LONG_S) say(`Measuring ${clock(f.duration)} of sound (about ${duration(MEASURE_S_PER_S * f.duration + 1)}).`);
    try { m = await stageRun("measure", "Measuring", () => measureOf(src, "before"), true); } catch (e) { throw named(e); }
    const voiceS = m.speech?.seconds ?? 0;
    const what = src === fileAbs ? f.name : `${f.name}'s ${nth(o.audio)} audio stream`;
    // (a file with more audio streams: the voice may be in another, and the sentence says how to take it)
    const others = nAudio > 1 ? [...Array(nAudio).keys()].map((i) => i + 1).filter((i) => i !== o.audio) : [];
    const noVoice = (why) => refuse(`measure finds no voice in ${what} (${why}): ${others.length
      ? `${f.name} has ${nAudio} audio streams, and the voice may be in another: --audio ${others[0]} takes the ${nth(others[0])}${others.length > 1 ? ` (the others: ${others.join(", ")})` : ""}.`
      : "there is nothing to mend or bring to a loudness, and raising it would only raise its noise."}`);
    if (m.voice?.found === false) noVoice(String(m.voice.why || "nothing in it is speech").replace(/\.$/, ""));
    if (!voiceS) noVoice("its level never rises far enough over its floor");
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
    // the estimate, from the length and the plan (ESTIMATE above), once the work is known
    est = estimate({ seconds: m.analysed?.seconds ?? f.duration ?? 0, plan: rp, probe: !!st.denoiserThere?.() && o.denoise !== "off", ending, video: fmt.kind === "video", before: o.before != null, measureS: job.from.includes("measure") ? null : state.seconds.measure, done: state.done });
    say(`${state.seconds.measure != null && !job.from.includes("measure") ? `Measured ${clock(m.analysed?.seconds ?? 0)} of sound in ${duration(state.seconds.measure)}. ` : ""}About ${duration(est.total)} more${est.says ? ` (${est.says})` : ""}.`);
    // 3. repair (with the tone's filters) to the intermediate, its working files in this attempt's scratch
    const mended = done("mended.wav");
    const rep = await stageRun("repair", "Repair", async () => {
      const part = path.join(scratch, "mended.wav");
      const rr = await st.repair(src, part, m, { denoise: o.denoise, after, retone, tmp: scratch });
      fs.renameSync(part, mended);
      return { rr, tp };
    });
    const rr = rep.rr;
    tp = rep.tp;
    // 4. level, encoded as delivered. Where the recording had short loud sounds, the mended sound is
    // measured again first: repair may have taken them out (the high-pass a thump, the offset's
    // removal its step), and the level stage turns down only what is still there
    const soundName = fmt.kind === "video" ? `sound.${fmt.audio}` : `out.${ending}`;
    const lv = await stageRun("level", "Level", async () => {
      let burstsNow = null;
      if (o.level !== "off" && m.speech?.bursts?.count > 0) burstsNow = (await measureOf(mended, "mended")).speech?.bursts ?? null;
      const part = path.join(scratch, soundName);
      const r = await level(mended, part, { targets: T, mono: o.mono, level: o.level, encode: fmt.codec, tmp: scratch, keepLufs: srcAsPlayed, peaks: o.peaks,
        ...(burstsNow && { bursts: burstsNow, burstsBefore: m.speech.bursts }) });
      fs.renameSync(part, done(soundName));
      return r;
    });
    // (the intermediate is not needed once the level stage is through)
    fs.rmSync(mended, { force: true });
    if (src !== fileAbs && o.before == null) fs.rmSync(src, { force: true });
    const sound = done(soundName);
    // 5. a video: the picture copied with the new sound, in step (the voice's stream started where it started)
    if (fmt.kind === "video") {
      const final = outPart;
      await stageRun("mux", "Putting the sound to the picture", async () => {
        outPart = path.join(scratch, `out.${ending}`);
        const offset = Math.max(0, chosen.start - streams.start);
        const r = await ffmpegRun(["-hide_banner", "-nostdin", "-v", "error", "-y", "-i", fileAbs, "-itsoffset", offset.toFixed(6), "-i", sound,
          "-map", "0:V", "-map", "1:a:0", "-c", "copy", "-map_metadata", "-1", "-map_chapters", "-1",
          ...(fmt.faststart ? ["-movflags", "+faststart"] : []), ...(fmt.muxer ? ["-f", fmt.muxer] : []), outPart]);
        if (r.status !== 0) throw new LevelError(`ffmpeg could not put the new sound to the picture: ${lastLine(r.stderr)}`);
        fs.renameSync(outPart, final);
        return true;
      });
      outPart = final;
      fs.rmSync(sound, { force: true });
    }
    // 6. measured again, as delivered
    const m2 = await stageRun("after", "Measuring the result", () => measureOf(outPart, "after"));
    // 7. the untouched sound beside it, as loud as the output, to compare by ear
    let before = null;
    if (o.before != null) {
      before = await stageRun("before", "The comparison", async () => {
        // (where knocks were turned down in the output and stay as they came in the comparison, both
        // are matched on the voice: the knocks' stretches left out of the loudness)
        const kn = lv.steps.find((s) => s.id === "bursts" && s.at?.length && s.voiceLufs != null);
        const cut = kn ? `aselect='not(${kn.at.map((x) => `between(t,${x.from.toFixed(3)},${x.to.toFixed(3)})`).join("+")})',asetpts=N/SR/TB` : null;
        const part = path.join(scratch, path.basename(beforePart));
        const b = await comparison(src, part, { lufs: kn ? kn.voiceLufs : lv.delivered.lufs, channels: o.mono ? 1 : 2, srcChannels: chosen.channels ?? f.channels, codec: bfmt.codec, T, cut, tmp: scratch });
        fs.renameSync(part, beforePart);
        return b;
      });
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
    // the noise: what repair forecast ("it ends about N dB under") is said as the delivered file
    // measures it, where the two lie more than NOISE_SAID_DB apart
    const noiseAfter = numbers(m2).snrDb;
    for (const x of left) {
      const fc = x.id === "noise" && /ends about (\d+) dB under/.exec(x.why);
      if (!fc || noiseAfter == null || Math.abs(Number(fc[1]) - noiseAfter) <= NOISE_SAID_DB) continue;
      x.why = x.why.replace(/so it ends about \d+ dB under/, `so it would end about ${fc[1]} dB under; the delivered file measures it ${i0(noiseAfter)} dB under the speech`);
      x.measuredDb = noiseAfter;
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
      // (each stage's time; a run that went on from an ended one: what it took up)
      stages: { seconds: state.seconds, ...(job.from.length && { takenUp: job.from }), estimate: est && { total: est.total, parts: est.parts } },
    };
    fs.writeFileSync(jsonPart, JSON.stringify(report, null, 1) + "\n");
    // 8. delivered together: the sound, the comparison, the report (no signal comes between these)
    move(outPart, outAbs);
    if (beforePart) move(beforePart, beforeAbs);
    move(jsonPart, `${outAbs}.json`);
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
    (b.snrDb != null && a.snrDb != null ? `, noise ${i0(b.snrDb)} → ${i0(a.snrDb)} dB under the speech (A-weighted)`
      : b.snrDb != null ? `, noise ${i0(b.snrDb)} dB under the speech (A-weighted), in the result not measurable (no pause left to measure it in)`
      : a.snrDb != null ? `, noise not measurable before (no pause), ${i0(a.snrDb)} dB under the speech after (A-weighted)` : "") + ".");
  if (r.left.length) out.push(`Not mended: ${r.left.map((x) => `${x.id}: ${x.why}`).join(" ")}`);
  for (const x of r.notJudged || []) out.push(`Not judged: ${x.id}: ${x.why}`);
  out.push(`Targets: ${f1(T.lufs)} LUFS as played on two speakers${mono ? ` (the one channel ${f1(T.measuredLufs)} LUFS as ffmpeg measures it)` : ""}, true peak ${f1(T.truePeak)} dBTP after the encoding (a check accepts ${f1(T.peakAccepted)}), range ${T.rangeLu} LU or under; ${T.from}${T.overridden?.length ? `, ${T.overridden.join(" and ")} as asked` : ""}.`);
  if (r.before) {
    const g = r.before.gainDb, B = r.before;
    // (every number here is the written file's, measured after it was written)
    const voice = B.matched === "voice", off = B.lufs != null && B.aimLufs != null ? B.lufs - B.aimLufs : 0, near = Math.abs(off) <= 0.3;
    out.push(`To compare by ear: ${B.file}, the recording as it was but for ${g >= 0 ? "+" : ""}${f1(g)} dB, ` +
      (near ? `as loud as the output${voice ? "'s voice" : ""} (${f1(B.lufs)} LUFS${voice ? ", the knocks' stretches left out of both, since it keeps them as they came" : ""})`
        : `${f1(Math.abs(off))} LU ${off < 0 ? "under" : "over"} the output${voice ? "'s voice" : ""} (${f1(B.lufs)} against ${f1(B.aimLufs)} LUFS${voice ? ", the knocks' stretches left out" : ""})`) +
      (B.limited ? `. Its peaks were held by a limiter to be that loud (${B.peaksHeldDb != null ? `${f1(B.peaksHeldDb)} dB off the loudest, ` : ""}its true peak ${f1(B.truePeak)} dBTP), so it is not quite untouched` : `; its true peak ${f1(B.truePeak)} dBTP`) +
      (near ? ": both play equally loud, so neither wins by being louder." : ": it could not be made as loud with its peaks under the ceiling, so the louder one may win by that."));
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
    // (the estimate and each stage's lines: on stdout, or with --json on stderr, so that stdout
    // stays the one JSON object)
    const progress = (line) => { if (json) process.stderr.write(`${line}\n`); else console.log(line); };
    const r = await clean(p.file, p.out, { ...p.opts, progress }, stages);
    console.log(json ? JSON.stringify(r, null, 1) : lines(r).join("\n"));
    return r;
  } catch (e) {
    if (e instanceof Refusal || e instanceof LevelError) return say(e.message);
    return say(`clean failed: ${String(e?.message || e).split("\n")[0]}`);
  }
}
