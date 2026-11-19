// `voice.mjs clean`: a spoken recording made to sound right for social media, in three stages,
// each in a file of its own: repair (lib/repair.mjs: channels, clipping, rumble, hum, clicks,
// noise), tone (lib/tone.mjs: what stands out in its spectrum, sibilance; run at the end of
// repair's ffmpeg pass) and level (lib/level.mjs: the leveller, a gentle compressor, the loudness
// and the peak ceiling on the file as delivered).
//
//   node tools/voice.mjs clean <audio|video> <out> [--for <platform…>] [--loudness <LUFS>] [--peak <dBTP>]
//        [--denoise auto|off|gentle|strong] [--tone auto|off] [--level auto|plain|off] [--mono] [--before <file>] [--json]
//
//   <out>        its ending decides what it is: .m4a (AAC at 192 kbit/s), .wav (24-bit PCM),
//                .flac (24 bits), .mp3 (192 kbit/s); a video's own ending (.mp4, .mov, .webm as
//                the input has it) keeps the picture as it is (copied, not encoded again) with
//                the new sound, as long as it was and in step. Always 48 kHz, never with the
//                source's tags (a phone writes the place into its file); never over the input
//   --for        platform names: their master from lib/targets.mjs (none named: its default, the
//                master for video: −14 LUFS, true peak −1.5 dBTP aimed at, −1 accepted, range 5 LU)
//   --loudness   the target, LUFS as played, over the master's; --peak the true peak aimed at
//                after the encoding (a check then accepts 0.5 dB more)
//   --level      auto: leveller where uneven, compressor, loudness, limiter; plain: only the gain
//                to the loudness and the limiter (for a voice that pumps, breathes or sounds flat
//                after auto); off: repair and tone only, the recording's own dynamics and loudness
//                kept (for a skill that levels itself, as best-takes does take by take), its peaks
//                still safe
//   --mono       one channel at the target as ffmpeg measures it (it plays 3 LU louder on two
//                speakers); by default two channels with the same voice in both
//   --before     also writes the source's sound untouched but for a gain to the output's
//                loudness (a limiter only where that gain would take its peaks over the ceiling),
//                as many channels as the output, sound only: before and after to compare by ear
//
// Writes <out> and beside it <out>.json: the source, what was measured before and after, every
// step with its reason, what was left and why, the targets, the settings. Prints what an agent
// passes on; --json prints the same object as the file. An error is one sentence, exit 1.
//
//   cleanCommand(args, stages)       everything the command does (prints, sets the exit code)
//   clean(file, out, opts, stages)   → the report; throws a Refusal (one sentence)
//
// `stages`: { repair, repairPlan, tonePlan, toneFilters } to run instead of lib/repair.mjs and
// lib/tone.mjs (the tests' stand-ins); without it those files are loaded.
//
// Temporary files in a folder of their own under the system's temp directory, removed at the
// end and on failure. Nothing holds the recording in memory: every stage streams through ffmpeg,
// the intermediate lies on disk.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { measure } from "./measure.mjs";
import { Refusal, facts } from "./analyse.mjs";
import { level, LevelError, TARGETS, LIMITER, loudnessOf } from "./level.mjs";
import { targets as platformTargets } from "./targets.mjs";

export const USAGE = "Usage: voice.mjs clean <audio|video> <out> [--for <platform…>] [--loudness <LUFS>] [--peak <dBTP>] [--denoise auto|off|gentle|strong] [--tone auto|off] [--level auto|plain|off] [--mono] [--before <file>] [--json]";
// a check accepts the true peak this much over the one aimed at (−1.5 aimed at, −1 accepted)
const PEAK_MARGIN_DB = 0.5;

const AAC = ["-c:a", "aac", "-b:a", "192k"];
export const FORMATS = {
  m4a: { kind: "audio", codec: AAC, says: "AAC at 192 kbit/s", name: "aac" },
  wav: { kind: "audio", codec: ["-c:a", "pcm_s24le"], says: "24-bit PCM", name: "pcm_s24le" },
  flac: { kind: "audio", codec: ["-c:a", "flac", "-sample_fmt", "s32"], says: "FLAC at 24 bits", name: "flac" },
  mp3: { kind: "audio", codec: ["-c:a", "libmp3lame", "-b:a", "192k"], says: "MP3 at 192 kbit/s", name: "mp3", encoder: "libmp3lame" },
  mp4: { kind: "video", codec: AAC, says: "AAC at 192 kbit/s", name: "aac", audio: "m4a" },
  mov: { kind: "video", codec: AAC, says: "AAC at 192 kbit/s", name: "aac", audio: "m4a" },
  webm: { kind: "video", codec: ["-c:a", "libopus", "-b:a", "192k"], says: "Opus at 192 kbit/s", name: "opus", audio: "webm", encoder: "libopus" },
};
const AUDIO_ENDINGS = Object.keys(FORMATS).filter((k) => FORMATS[k].kind === "audio").map((k) => `.${k}`);

const refuse = (msg) => { throw new Refusal(msg); };
const minus = (s) => s.replace(/^-/, "−");
const f1 = (x) => (x == null ? "?" : minus((Math.round(x * 10) / 10).toFixed(1)));
const i0 = (x) => (x == null ? "?" : minus(String(Math.round(x))));
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const rel = (p) => { const r = path.relative(process.cwd(), path.resolve(p)); return r && !r.startsWith("..") ? r : path.resolve(p); };
const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`);

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

function startTimes(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_entries", "format=start_time:stream=index,codec_type,start_time", file], { encoding: "utf8" });
  const j = JSON.parse(r.stdout || "{}");
  const a = (j.streams || []).find((s) => s.codec_type === "audio");
  return { file: Number(j.format?.start_time) || 0, audio: Number(a?.start_time) || 0 };
}

// the numbers of measure that matter here
function numbers(m) {
  const L = m.levels || {}, lo = m.loudness || {};
  return {
    seconds: m.analysed?.seconds ?? null, channels: m.sound?.channels ?? null, sampleRate: m.sound?.sampleRate ?? null, codec: m.sound?.codec ?? null,
    lufs: lo.integratedLufs, rangeLu: lo.rangeLu, truePeak: lo.truePeakDb,
    speechLufs: L.speechLufs ?? null, noiseLufs: L.noiseLufs ?? null, snrDb: L.snrADb ?? L.snrDb ?? null, phraseSpreadLu: L.phrases?.spreadLu ?? null,
    findings: (m.findings || []).map((f) => ({ id: f.id, strength: f.strength })),
  };
}

// The source's first sound untouched but for a plain gain to `lufs` (the output's loudness as
// measured), so that before and after play equally loud (the louder one always sounds better):
// 48 kHz, as many channels as the output (one channel on both sides, or a mix of more), without
// tags, sound only. A limiter (as level's: oversampled, look-ahead taken back) only when the gain
// would push its peaks over what a check accepts; then it is not quite untouched, and `limited`
// says so. The gain corrected until within 0.3 LU (three times at most).
// → { gainDb, limited, lufs, truePeak }
function comparison(src, dest, { lufs, channels, srcChannels, codec, T }) {
  const chan = channels === 1 ? (srcChannels === 1 ? "anull" : "aformat=channel_layouts=mono")
    : srcChannels === 1 ? "pan=stereo|c0=c0|c1=c0" : srcChannels === 2 ? "anull" : "aformat=channel_layouts=stereo";
  const base = `${chan},aresample=48000`;
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-nostdin", "-i", src, "-map", "0:a:0", "-af", `${base},ebur128=peak=true`, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 24 });
  const s = (r.stderr || "").slice((r.stderr || "").lastIndexOf("Summary:"));
  const l0 = Number(s.match(/I:\s*(-?[\d.]+) LUFS/)?.[1]), p0 = Number(s.match(/Peak:\s*(-?[\d.]+) dBFS/)?.[1]);
  if (!Number.isFinite(l0) || lufs == null) throw new LevelError("could not measure the source's loudness for --before.");
  let gain = lufs - l0, limited = Number.isFinite(p0) && p0 + gain > T.peakAccepted, got;
  for (let pass = 0; pass < 4; pass++) {
    const af = [base, `volume=${gain.toFixed(2)}dB`];
    if (limited) af.push(`aresample=${LIMITER.rate}`, `alimiter=limit=${(10 ** (T.truePeak / 20)).toFixed(6)}:attack=${LIMITER.attack}:release=${LIMITER.release}:level=disabled:latency=1`, "aresample=48000");
    const w = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-v", "error", "-y", "-i", src, "-map", "0:a:0", "-vn", "-af", af.join(","), "-map_metadata", "-1", "-map_chapters", "-1", "-ar", "48000", ...codec, dest], { encoding: "utf8" });
    if (w.status !== 0) throw new LevelError(`ffmpeg could not write the sound before: ${(w.stderr || "").trim().split("\n").slice(-1)[0]}`);
    got = loudnessOf(dest);
    if (!limited && got.truePeak != null && got.truePeak > T.peakAccepted) { limited = true; continue; }
    if (got.lufs == null || Math.abs(got.lufs - lufs) <= 0.3) break;
    gain += lufs - got.lufs;
  }
  return { gainDb: +gain.toFixed(2), limited, lufs: got.lufs, truePeak: got.truePeak };
}

// ---------------------------------------------------------------- the run

// opts: { for: [names], loudness, peak, denoise, tone, level, mono }
export async function clean(file, out, opts = {}, stages = null) {
  const o = { for: [], denoise: "auto", tone: "auto", level: "auto", mono: false, ...opts };
  const ending = path.extname(out).slice(1).toLowerCase();
  const fmt = FORMATS[ending];
  if (!fmt) refuse(`clean writes ${list(AUDIO_ENDINGS)}, or a video in its own ending (.mp4, .mov, .webm): ${path.basename(out)} ends in ${ending ? `.${ending}` : "nothing"}.`);
  const same = path.resolve(out) === path.resolve(file) ||
    (fs.existsSync(out) && fs.existsSync(file) && (() => { const a = fs.statSync(out), b = fs.statSync(file); return a.dev === b.dev && a.ino === b.ino; })());
  if (same) refuse(`${rel(out)} is the recording itself: clean never writes over its input; name another file.`);
  const f = facts(file);
  const srcEnding = path.extname(file).slice(1).toLowerCase();
  if (fmt.kind === "video") {
    if (!f.video) refuse(`${f.name} has no picture: write its sound as ${list(AUDIO_ENDINGS)}.`);
    if (srcEnding !== ending) refuse(`A video keeps its picture only in its own kind of file: name the output .${srcEnding || "?"} like ${f.name}, or write its sound alone as ${list(AUDIO_ENDINGS)}.`);
  }
  if (fmt.encoder && !new RegExp(`\\b${fmt.encoder}\\b`).test(encoders()))
    refuse(`This ffmpeg cannot write .${ending} (it has no ${fmt.encoder}): write ${list(AUDIO_ENDINGS.filter((e) => e !== `.${ending}`))}.`);

  let bfmt = null;
  if (o.before != null) {
    const be = path.extname(o.before).slice(1).toLowerCase();
    bfmt = FORMATS[be];
    if (!bfmt) refuse(`--before writes ${list(AUDIO_ENDINGS)}: ${path.basename(o.before)} ends in ${be ? `.${be}` : "nothing"}.`);
    const hits = (x) => path.resolve(o.before) === path.resolve(x) ||
      (fs.existsSync(o.before) && fs.existsSync(x) && (() => { const a = fs.statSync(o.before), b = fs.statSync(x); return a.dev === b.dev && a.ino === b.ino; })());
    if (hits(file)) refuse(`--before names the recording itself: clean never writes over its input; name another file.`);
    if (hits(out) || path.resolve(o.before) === path.resolve(`${out}.json`)) refuse(`--before names the output: the sound before and after need two files.`);
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

  // the folders of what is written are made, as the collection's other tools make theirs
  // (`artifacts/<name>.m4a`, `voice/<name>/…` of a first run)
  for (const written of [out, o.before]) if (written != null) fs.mkdirSync(path.dirname(path.resolve(written)), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "voice-sound-clean-"));
  const gone = () => fs.rmSync(tmp, { recursive: true, force: true });
  const onSignal = (sig) => { gone(); process.exit(sig === "SIGINT" ? 130 : 143); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const t0 = Date.now();
  try {
    // 1. what is wrong with it
    const m = await measure(file);
    // 2. the tone's plan (it needs to know whether repair takes noise out), run at the end of repair's pass
    const rp = st.repairPlan ? st.repairPlan(m, { denoise: o.denoise }) : { steps: [] };
    const den = (rp.steps || []).find((s) => s.id === "denoise");
    const tp = st.tonePlan(m, { tone: o.tone, denoised: !!den, noiseLeftDb: den && den.snrDb != null && den.reduceDb != null ? den.snrDb + den.reduceDb : null });
    const after = st.toneFilters(tp) || "";
    // 3. repair (with the tone's filters) to the intermediate
    const mended = path.join(tmp, "mended.wav");
    const rr = await st.repair(file, mended, m, { denoise: o.denoise, after });
    // 4. level, encoded as delivered
    const sound = path.join(tmp, `sound.${fmt.audio || ending}`);
    const lv = await level(mended, sound, { targets: T, mono: o.mono, level: o.level, encode: fmt.codec, tmp });
    // 5. the output: the sound alone, or the picture copied with it
    if (fmt.kind === "video") {
      const at = startTimes(file);
      const offset = Math.max(0, at.audio - at.file);
      const r = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-v", "error", "-y", "-i", file, "-itsoffset", offset.toFixed(6), "-i", sound,
        "-map", "0:V", "-map", "1:a:0", "-c", "copy", "-map_metadata", "-1", "-map_chapters", "-1",
        ...(ending === "webm" ? [] : ["-movflags", "+faststart"]), path.join(tmp, `out.${ending}`)], { encoding: "utf8" });
      if (r.status !== 0) throw new LevelError(`ffmpeg could not put the new sound to the picture: ${(r.stderr || "").trim().split("\n").slice(-1)[0]}`);
      fs.copyFileSync(path.join(tmp, `out.${ending}`), out);
    } else fs.copyFileSync(sound, out);
    // 6. measured again, as delivered
    const m2 = await measure(out);
    // 7. the untouched sound beside it, as loud as the output, to compare by ear
    let before = null;
    if (o.before != null) {
      const tmpBefore = path.join(tmp, `before.${path.extname(o.before).slice(1).toLowerCase()}`);
      before = comparison(file, tmpBefore, { lufs: lv.delivered.lufs, channels: o.mono ? 1 : 2, srcChannels: f.channels, codec: bfmt.codec, T });
      fs.copyFileSync(tmpBefore, o.before);
      before.file = rel(o.before);
    }
    const stage = (name, xs) => (xs || []).map((s) => ({ stage: name, ...s }));
    const report = {
      source: f.name,
      output: rel(out),
      format: { ending, codec: fmt.name, says: fmt.says, sampleRate: 48000, channels: o.mono ? 1 : 2, video: fmt.kind === "video", pictureCopied: fmt.kind === "video" },
      level: o.level,
      measured: { before: numbers(m), after: numbers(m2) },
      steps: [...stage("repair", rr.steps), ...stage("tone", tp.steps), ...lv.steps],
      left: [...stage("repair", rr.left), ...stage("tone", tp.left), ...lv.left],
      skipped: lv.skipped,
      targets: { lufs: T.lufs, asPlayed: o.mono ? "one channel as ffmpeg measures it (3 LU louder on two speakers)" : "two channels", truePeak: T.truePeak, peakAccepted: T.peakAccepted, peakAfterEncoding: true, rangeLu: T.rangeLu,
        from: o.for.length ? `the master for ${plat.platforms.map((p) => p.id).join(", ")} (${plat.kind})` : "the master for video, no platform named",
        overridden: [o.loudness != null && "loudness", o.peak != null && "peak"].filter(Boolean) },
      delivered: lv.delivered,
      before,
      // (the run's choices, then each stage's own numbers)
      settings: { for: o.for, loudness: o.loudness ?? null, peak: o.peak ?? null, denoise: o.denoise, tone: o.tone, level: o.level, mono: o.mono, before: o.before ?? null,
        repairStage: { method: rr.method ?? null }, levelStage: lv.settings, passes: lv.passes },
      seconds: +((Date.now() - t0) / 1000).toFixed(1),
    };
    fs.writeFileSync(`${out}.json`, JSON.stringify(report, null, 1) + "\n");
    return report;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    gone();
  }
}

// ---------------------------------------------------------------- what an agent reads

const LEVEL_SAYS = {
  auto: "level auto (a leveller where the phrases are uneven, a gentle compressor, the loudness, the limiter)",
  plain: "level plain (only the gain to the loudness and the limiter: its own dynamics kept)",
  off: "level off (its own dynamics and loudness kept, only the peaks made safe)",
};

export function lines(r) {
  const b = r.measured.before, a = r.measured.after, fm = r.format;
  const out = [`${r.output}: ${clock(a.seconds ?? 0)} of the voice, ${fm.says}, 48 kHz, ${fm.channels === 1 ? "one channel (it plays 3 LU louder on two speakers)" : "two channels with the same voice in both"}${fm.video ? ", the picture copied as it was" : ""}; from ${r.source}, ${LEVEL_SAYS[r.level] || `level ${r.level}`}.`];
  if (r.steps.length) {
    out.push("Done:");
    for (const s of r.steps) out.push(`  ${s.id} (${s.stage}): ${s.why}`);
  }
  for (const s of r.skipped || []) out.push(`Not done: ${s.why}`);
  const mono = b.channels === 1 && fm.channels === 2;
  out.push(`Before → after: loudness ${f1(b.lufs)}${mono ? ` (one channel; ${f1(b.lufs + 3.01)} as played)` : ""} → ${f1(a.lufs)} LUFS, range ${f1(b.rangeLu)} → ${f1(a.rangeLu)} LU, true peak ${f1(b.truePeak)} → ${f1(a.truePeak)} dBTP` +
    (b.snrDb != null || a.snrDb != null ? `, noise ${i0(b.snrDb)} → ${i0(a.snrDb)} dB under the speech (A-weighted)` : "") + ".");
  if (r.left.length) out.push(`Not mended: ${r.left.map((x) => `${x.id}: ${x.why}`).join(" ")}`);
  const T = r.targets;
  out.push(`Targets: ${f1(T.lufs)} LUFS ${fm.channels === 1 ? "as one channel" : "as played on two speakers"}, true peak ${f1(T.truePeak)} dBTP after the encoding (a check accepts ${f1(T.peakAccepted)}), range ${T.rangeLu} LU or under; ${T.from}${T.overridden?.length ? `, ${T.overridden.join(" and ")} as asked` : ""}.`);
  if (r.before) {
    const g = r.before.gainDb;
    out.push(`To compare by ear: ${r.before.file}, the recording as it was but for ${g >= 0 ? "+" : ""}${f1(g)} dB, as loud as the output (${f1(r.before.lufs)} LUFS)${r.before.limited ? "; its peaks had to be limited for that, so it is not quite untouched" : ""}: both play equally loud, so neither wins by being louder.`);
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
