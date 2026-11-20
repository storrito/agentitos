// The last stage of `clean`: from the mended intermediate (48 kHz, one channel, float WAV) to the
// finished sound, in three steps, in this order:
//
//   1. the leveller, for a voice whose phrases lie at different levels (a speaker who turns away,
//      two takes): a slow gain that follows the speech from phrase to phrase towards one level,
//      computed here from ebur128's momentary loudness of the intermediate (measured again: the
//      raw file's numbers no longer hold after repair), held through the pauses, bounded, applied
//      by ffmpeg as a gain curve multiplied in. Only as much as needed: an even voice gets none
//   2. gain to the target, then a slow limiter 2 dB over the fast one's ceiling (look-ahead 10 ms,
//      release 200 ms), which takes the loudest peaks (plosives, a laugh, a struck consonant) down
//      smoothly before the fast one has to, and leaves the body of the voice, and with it the
//      loudness range, as plain leaves it (PEAKS: what was tried, and how it measured)
//   3. a limiter (oversampled) at the ceiling, the file encoded as it will be delivered,
//      its loudness and true peak measured on that file and both corrected, in rounds, until
//      both hold (ROUNDS below; the best encoding kept; where both cannot be had, `left` says
//      which gave way and by how much). Not loudnorm: its linear mode silently falls back to a
//      dynamic one that pumps on speech
//
// `level: "plain"` does only the third (for a voice that pumps, breathes or sounds flat after
// `auto`); `"off"` the third with the recording's own loudness as its target (opts.keepLufs, as
// played: what came in goes out, whatever repair took off it for headroom, its peaks made safe).
//
//   level(inWav, out, opts)   writes `out` (the container its ending names, the codec `opts.encode`
//                             gives) → { steps, left, skipped, before, delivered, passes, settings }
//   levellerOf(frames)        the leveller's curve from ebur128's frames (pure: the tests read it)
//   framesOf(file)            ebur128's momentary loudness every 100 ms, and its summary (streamed)
//   loudnessOf(file)          { lufs, rangeLu, truePeak } of a file's first sound, as ffmpeg measures
//                             it (synchronous, for tests and scripts); loudness(file) the same, awaited
//   ffmpegRun(args)           ffmpeg (or ffprobe) as a child this module can stop; stopChildren()
//                             ends every ffmpeg the run has going, at once (a signal)
//
// Loudness is as played: a file with one channel plays on both speakers and measures 3 LU louder
// there than as one channel. The output has two channels with the same voice in both and measures
// the target; with `mono: true` it has the one channel at the target as played on two speakers,
// which ffmpeg measures 3 LU under it (−17 for −14).
//
// ebur128 prints −70.0 LUFS where no 400 ms block passes its gate (nothing but silence or a floor,
// or under half a second of sound): that is no measurement, and taken for none here.
//
// Every path given to ffmpeg is made absolute first: a file whose name begins with a dash is
// never read as an option.

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

export const TARGETS = { lufs: -14, truePeak: -1.5, peakAccepted: -1, rangeLu: 5 };

// ebur128's integrated loudness at or under this is its sign that nothing passed the gate
export const NO_LOUDNESS_LUFS = -70;
// How far a quiet voice is raised. The scores hear every recording at one level and cannot see
// gain; what gain does is bring up, with the voice, whatever lies under it: the room, the noise,
// and at the end the recorder's own steps (16 bits: about −98 LUFS). Measured on 12 clean
// readings of the tune split (6 German, 6 English), each brought to −23 LUFS, turned down by 0
// to 70 dB, written at 16 bits by rounding, then through clean with ffmpeg's methods, scored
// against the original (2026-11-20; level/exp1.mjs, the means):
//   gain (dB)         7     47    52    57    63    68    75    82
//   PESQ             4.50  3.15  2.81  2.48  1.95  1.43  1.17  1.04
//   STOI             0.99  0.98  0.97  0.96  0.93  0.89  0.83  0.73
//   DNSMOS overall   3.43  3.32  3.30  3.19  2.98  2.78  2.51  2.02
//   NISQA            4.67  3.75  3.43  2.98  2.20  1.63  1.41  1.14
//   NISQA, the best  5.00  4.92  4.72  4.20  3.48  2.33  1.88  1.34
// MAX_GAIN_DB: at the master's −14 LUFS, the most gain given (the leveller's lift included); a
// voice under −14 − MAX_GAIN_DB LUFS as played is refused whatever the target (the bound is the
// recording's own level: a lower --loudness does not move it), and the gain search never passes
// it. From 75 dB on not one of the twelve scored 2 by NISQA, at 68 the best 2.33 (the turned-down
// recordings themselves, scored as they were, as low: NISQA 1.44 and 1.67; the floor is theirs):
// the voice then stands about 10 dB over 16 bits' floor, and what is raised is that floor as
// much as the voice (where between 68 and 75 the line lies is a judgement). LOW_GAIN_DB: a voice
// that lies this far under the target or more (as played, before the gain) is delivered at the
// target all the same, and `left` says plainly that it was recorded very low and that its noise
// and its room came up with it: at 32 dB NISQA was still 4.59 (4.67 at 7), at 42 dB 4.16, at 47
// dB 3.75 (12 readings at 25 and 35 dB down, level/exp1.mjs). Four real recordings of the corpus
// need 41 to 48 dB (phones held far off; their noise 29 to 38 dB under the speech) and are
// delivered with that line; DNSMOS overall before → after 2.94 → 3.12 / 3.33, 3.15 → 3.23 /
// 3.30, 3.35 → 3.34 / 3.34, 3.03 → 2.65 / 3.17 (ffmpeg's methods / the denoiser)
export const MAX_GAIN_DB = 70;
export const LOW_GAIN_DB = 40;

// a sound under `underLufs` is measured through a gain that brings its true peak to `peakDb`
// (the intermediate is float: nothing clips), its numbers taken back by that gain. ebur128 drops
// every 400 ms block under −70 LUFS, and the leveller reads speech down to 25 dB under the loud
// speech (its gate), which lies 3 to 5 dB over the integrated loudness: from about −48 LUFS on,
// part of a voice would fall under ebur128's gate; under −67 none of it is measured at all
export const MEASURE_GAIN = { underLufs: -45, peakDb: -6 };

// ebur128's frames: one every 100 ms, the momentary loudness over the 400 ms before it
const FRAME_S = 0.1;
// the leveller. A phrase's level: the speech frames within 3 s around it (EBU's short-term
// window), at least 0.8 s of speech in it. Corrected: what lies more than 1.5 LU off the middle of
// the phrases (read speech spreads by 4 to 6 LU from phrase to phrase on its own), fully from
// 4 LU off; at most ±8 dB, no faster than 3 dB a second, through a mean over 1 s first. Used only
// on an uneven voice: its phrases (10th to 90th percentile) spread by 6 LU or more (where measure
// calls a step), or its loudness range is 2 LU over the aim (where a check warns), and then only
// where the curve moves by 1 dB somewhere
export const LEVELLER = { phraseS: 3, minSpeechS: 0.8, deadLu: 1.5, fullLu: 4, maxDb: 8, rateDbPerS: 3, smoothS: 1, neededDb: 1, unevenLu: 6, rangeOverLu: 2 };
// the curve as ffmpeg reads it: raw floats at 100 a second, resampled to the sound's rate
const CURVE_RATE = 100;
// what tames the peaks before the limiter: a slow limiter (alimiter, its look-ahead and attack
// 10 ms, release 200 ms) 2 dB over the fast one's ceiling, after the gain to the target, so that the
// fast one has at most about 2 dB left to take. Chosen on the lab's speech (voice-v1 tune, 2026-11-19,
// through the whole command, the clean readings their own reference; try-level.mjs --compare):
//                          limiter dB, mean/max   range before→after   PESQ   DNSMOS SIG
//   clean (20)  plain            5.8/10.0               3.2→2.7          4.43    3.68
//               rms (before)     2.2/4.4                3.2→2.0          4.25    3.71
//               this             1.9/2.1                3.2→2.6          4.42    3.68
//   real (10)   plain            4.0/7.2                4.3→4.2           –      3.32
//               this             1.9/2.2                4.3→4.0           –      3.31
//   uneven (6)  plain            8.2/12.5               8.1→6.5           –      3.65
//               this             1.9/2.0                8.1→4.7           –      3.64
// Peak compressors without look-ahead (acompressor, detection=peak, 0.1 to 2 ms) cost PESQ 0.1 to
// 0.4; with 1 to 5 ms of look-ahead (sidechaincompress) they cost nothing measurable but left the
// limiter up to 3.2 to 4.7 dB; the RMS compressor before pressed the range and cost 0.18 PESQ
export const PEAKS = { kind: "prelimit", overCeilingDb: 2, attack: 10, release: 200 };
// (kept for the lab, which tries the old one against the new: kind "rms", threshold over the loudness)
export const RMS_COMPRESSOR = { kind: "rms", overDb: 4, ratio: 2.5, attack: 10, release: 80, knee: 2.83 };
// the limiter: sample peaks at 4 × 48 kHz (ffmpeg's documentation: oversample around alimiter),
// look-ahead 5 ms, release 60 ms, its delay compensated (latency), its own renormalising off
export const LIMITER = { rate: 192000, attack: 5, release: 60 };
// The search for the gain and the ceiling. What it promises: the delivered file, encoded as
// delivered, within LUFS_TOLERANCE of the target and its true peak at or under the ceiling aimed
// at. Each round finds the gain on the chain's sound measured on the way (no file: cheap), aiming
// TRY_TOLERANCE close to the target less what the encoding moved the loudness by in the round
// before, at most TRIES tries; then encodes the file and measures it. A true peak over the aim
// lowers the ceiling by its excess and a little more (PEAK_MARGIN_DB) and starts a round again,
// as does a loudness off the target; ROUNDS at most. A gain that moves the loudness by less than
// SATURATED_LU_PER_DB is the limiters holding it down: more gain is not tried. Before
// 2026-11-20 the ceiling was lowered after the loudness was settled and nothing settled it again,
// which left an .m4a 0.5 to 0.6 LU under the target
const LUFS_TOLERANCE = 0.3, TRY_TOLERANCE = 0.1, TRIES = 6, ROUNDS = 6, PEAK_MARGIN_DB = 0.1, SATURATED_LU_PER_DB = 0.05;
// a file with one channel plays on both speakers: 10·log10(2) louder
export const TWO_SPEAKERS_LU = 3.01;

// whether one key comes before another, item by item
const ahead = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
const times = (n) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
const nth = (n) => ["first", "second", "third", "fourth", "fifth", "sixth"][n - 1] ?? `${n}th`;
const encodings = (n) => (n === 1 ? "one encoding" : `${n} encodings`);
const minus = (s) => s.replace(/^-/, "−");
const f1 = (x) => minus((Math.round(x * 10) / 10 || 0).toFixed(1));
const signed = (x) => (Math.round(x * 10) / 10 > 0 ? "+" : "") + f1(x);
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const pow = (db) => 10 ** (db / 10);
const dbOf = (p) => 10 * Math.log10(p);
const quantile = (sorted, q) => {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

export class LevelError extends Error {}

// the refusal of a voice under the far bound, in one sentence (clean says it before repair, the
// level stage after it): `asPlayed` its loudness, `aim` the target, `gain` what it would take
export const tooQuiet = (asPlayed, aim, gain, maxGain) => `The voice lies at ${f1(asPlayed)} LUFS as played: bringing it to ${f1(aim)} would take ${Math.round(gain)} dB of gain, more than the ${f1(maxGain).replace(/\.0$/, "")} dB this tool gives, and so little of it stands over the floor of its recording that the gain would raise mostly that floor; record it again closer to the microphone or with the recorder's input turned up.`;
const missing = (bin = "ffmpeg") => new LevelError(`${bin} is missing: this tool needs ffmpeg on the PATH.`);
const lastLine = (s, n = 1) => (s || "").trim().split("\n").slice(-n).join(" ");

// ---------------------------------------------------------------- ffmpeg as a child that can be stopped

const live = new Set();

// → { status, signal, stderr (its last 64 kB) }; never throws on ffmpeg's own failure
export function ffmpegRun(args, { bin = "ffmpeg", onLine = null } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    live.add(p);
    let err = "", buf = "", done = false;
    p.stderr.setEncoding("utf8");
    p.stderr.on("data", (s) => {
      if (onLine) {
        buf += s;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!onLine(line)) err = (err + line + "\n").slice(-65536); }
      } else err = (err + s).slice(-65536);
    });
    p.on("error", (e) => { if (done) return; done = true; live.delete(p); reject(e.code === "ENOENT" ? missing(bin) : e); });
    p.on("close", (code, signal) => { if (done) return; done = true; live.delete(p); resolve({ status: code, signal, stderr: (err + buf).slice(-65536) }); });
  });
}

// every process whose parent is this one (the other stages' ffmpeg too), from /proc; elsewhere ps
function childPids() {
  try {
    return fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d)).filter((d) => {
      try { const s = fs.readFileSync(`/proc/${d}/stat`, "utf8"); return Number(s.slice(s.lastIndexOf(")") + 2).split(" ")[1]) === process.pid; } catch { return false; }
    }).map(Number);
  } catch {
    const r = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
    return (r.stdout || "").split("\n").map((l) => l.trim().split(/\s+/).map(Number)).filter(([, pp]) => pp === process.pid).map(([p]) => p);
  }
}

export function stopChildren() {
  for (const p of live) { try { p.kill("SIGKILL"); } catch { /* gone */ } }
  for (const pid of childPids()) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
}

async function run(args, what) {
  const r = await ffmpegRun(["-hide_banner", "-nostdin", "-v", "error", "-y", ...args]);
  if (r.status !== 0) throw new LevelError(`ffmpeg could not make ${what}: ${lastLine(r.stderr, 2)}`);
  return r;
}

// ---------------------------------------------------------------- measuring

// ebur128's summary in a log; −70 LUFS and under is no measurement (nothing passed the gate)
function summary(log) {
  const s = log.slice(log.lastIndexOf("Summary:"));
  const n = (re, floor = -200) => { const m = s.match(re); const v = m ? Number(m[1]) : NaN; return Number.isFinite(v) && v > floor ? v : null; };
  const lufs = n(/I:\s*(-?[\d.]+|-inf) LUFS/, NO_LOUDNESS_LUFS);
  return { lufs, rangeLu: lufs == null ? null : n(/LRA:\s*(-?[\d.]+) LU/), truePeak: n(/Peak:\s*(-?[\d.]+|-inf) dBFS/) };
}
// all of a log's summaries, in the order of the filters in the graph: by the number ffmpeg gives
// each filter (`[Parsed_ebur128_4 @ 0x…] Summary:`), since it prints them in an order of its own
// (the last filter's first, with a filter_complex)
function summaries(log) {
  const at = [...log.matchAll(/\[Parsed_ebur128_(\d+) @ [^\]]*\]\s*Summary:/g)];
  if (!at.length) return log.split("Summary:").slice(1).map((s) => summary(`Summary:${s}`));
  return at.map((m, i) => ({ n: Number(m[1]), s: summary(log.slice(m.index, at[i + 1]?.index ?? log.length)) })).sort((a, b) => a.n - b.n).map((x) => x.s);
}

const measureArgs = (file, af = "") => ["-hide_banner", "-nostats", "-nostdin", "-i", path.resolve(file), "-map", "0:a:0", "-af", `${af ? `${af},` : ""}ebur128=peak=true`, "-f", "null", "-"];

export function loudnessOf(file) {
  const r = spawnSync("ffmpeg", measureArgs(file), { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.error?.code === "ENOENT") throw missing();
  if (r.status !== 0) throw new LevelError(`ffmpeg could not measure ${path.basename(file)}: ${lastLine(r.stderr)}`);
  return summary(r.stderr || "");
}

// the same, awaited (a signal can stop it); `af` a chain measured on the way
export async function loudness(file, af = "") {
  const r = await ffmpegRun(measureArgs(file, af));
  if (r.status !== 0) throw new LevelError(`ffmpeg could not measure ${path.basename(file)}: ${lastLine(r.stderr)}`);
  return summary(r.stderr);
}

// the same at any level: a sound under MEASURE_GAIN.underLufs measured again through a gain and
// its numbers taken back by it → { lufs, rangeLu, truePeak, gainDb (the gain measured through) }
export async function loudnessAt(file, af = "") {
  const a = await loudness(file, af);
  if (!((a.lufs == null || a.lufs < MEASURE_GAIN.underLufs) && a.truePeak != null && a.truePeak < MEASURE_GAIN.peakDb)) return { ...a, gainDb: 0 };
  const pre = MEASURE_GAIN.peakDb - a.truePeak;
  const g = await loudness(file, `${af ? `${af},` : ""}volume=${pre.toFixed(2)}dB`);
  return { lufs: g.lufs == null ? null : g.lufs - pre, rangeLu: g.rangeLu, truePeak: g.truePeak == null ? null : g.truePeak - pre, gainDb: r2(pre) };
}

const FRAME_RE = /t:\s*([\d.]+)\s+TARGET:\S+ LUFS\s+M:\s*(-?[\d.]+|-?inf|nan)/;
// `af` a chain measured on the way (a gain for a very quiet sound: see level())
export async function framesOf(file, af = "") {
  let M = new Float32Array(1 << 12), n = 0;
  const r = await ffmpegRun(["-hide_banner", "-nostats", "-nostdin", "-i", path.resolve(file), "-map", "0:a:0", "-af", `${af ? `${af},` : ""}ebur128=peak=true:framelog=info`, "-f", "null", "-"], {
    onLine: (line) => {
      const m = FRAME_RE.exec(line);
      if (!m) return false;
      if (n === M.length) { const g = new Float32Array(M.length * 2); g.set(M); M = g; }
      const v = Number(m[2]);
      M[n++] = Number.isFinite(v) && v > NO_LOUDNESS_LUFS ? v : -120;
      return true;
    },
  });
  if (r.status !== 0) throw new LevelError(`ffmpeg could not measure ${path.basename(file)} again: ${lastLine(r.stderr)}`);
  return { momentary: M.slice(0, n), ...summary(r.stderr) };
}

// The leveller's curve, one gain (dB) a frame of 100 ms, from the momentary loudness `momentary`
// (dB, a frame's 400 ms ending at it). Speech frames: over a gate between the pauses' floor (5th
// percentile) and the loud speech (95th): 35 % of the way up, at least 4 dB over the floor, at most
// 25 dB under the loud speech. `range`: { lu: the sound's loudness range, aimLu }, or null.
// → { needed, uneven: why it is uneven (or null), gains, speech, refLufs, speechLufs (levelled),
// speechLufsBefore, spreadLu, spreadAfterLu, maxDb, minDb }
export function levellerOf(momentary, range = null, o = LEVELLER) {
  const F = momentary.length;
  const valid = [];
  for (let i = 0; i < F; i++) if (momentary[i] > NO_LOUDNESS_LUFS && i >= 3) valid.push(momentary[i]);
  valid.sort((a, b) => a - b);
  const none = { needed: false, uneven: null, gains: new Float32Array(F), speech: new Uint8Array(F), refLufs: null, speechLufs: null, speechLufsBefore: null, spreadLu: null, spreadAfterLu: null, maxDb: 0, minDb: 0 };
  if (valid.length < 10) return none;
  const floor = quantile(valid, 0.05), top = quantile(valid, 0.95);
  const gate = Math.max(floor + Math.max(4, 0.35 * (top - floor)), top - 25);
  const speech = new Uint8Array(F);
  // (the first 3 frames hold less than the 400 ms window)
  for (let i = 3; i < F; i++) speech[i] = momentary[i] > gate ? 1 : 0;
  // a phrase's level: the power mean of the speech frames within ±1.5 s
  const half = Math.round(o.phraseS / 2 / FRAME_S), minN = Math.round(o.minSpeechS / FRAME_S);
  const P = new Float64Array(F).fill(NaN);
  let s = 0, k = 0;
  const add = (j, sign) => { if (j >= 0 && j < F && speech[j]) { s += sign * pow(momentary[j]); k += sign; } };
  for (let j = 0; j <= half; j++) add(j, 1);
  for (let i = 0; i < F; i++) {
    if (i > 0) { add(i + half, 1); add(i - half - 1, -1); }
    if (k >= minN && s > 0) P[i] = dbOf(s / k);
  }
  const at = [];
  for (let i = 0; i < F; i++) if (speech[i] && Number.isFinite(P[i])) at.push(P[i]);
  if (at.length < minN) return { ...none, speech };
  const sorted = [...at].sort((a, b) => a - b);
  const ref = quantile(sorted, 0.5);
  const spread = quantile(sorted, 0.9) - quantile(sorted, 0.1);
  // the correction a speech frame asks for: nothing within deadLu of the middle, all of it from fullLu
  const want = new Float64Array(F).fill(NaN);
  for (let i = 0; i < F; i++) {
    if (!speech[i] || !Number.isFinite(P[i])) continue;
    const d = ref - P[i], a = Math.abs(d);
    const w = a <= o.deadLu ? 0 : a >= o.fullLu ? 1 : (a - o.deadLu) / (o.fullLu - o.deadLu);
    want[i] = Math.max(-o.maxDb, Math.min(o.maxDb, d * w));
  }
  // held through the pauses: a frame without speech keeps the last speech's gain (the first
  // speech's before it), so that the noise between sentences is never raised on its own
  const held = new Float64Array(F);
  let last = want.find(Number.isFinite) ?? 0;
  for (let i = 0; i < F; i++) { if (Number.isFinite(want[i])) last = want[i]; held[i] = last; }
  // a mean over smoothS, then no faster than rateDbPerS: the forward- and the backward-limited
  // curves averaged, so a change is centred where the level changes
  const h = Math.max(0, Math.round(o.smoothS / FRAME_S / 2)), sum = new Float64Array(F + 1), mean = new Float64Array(F);
  for (let i = 0; i < F; i++) sum[i + 1] = sum[i] + held[i];
  for (let i = 0; i < F; i++) { const a = Math.max(0, i - h), b = Math.min(F, i + h + 1); mean[i] = (sum[b] - sum[a]) / (b - a); }
  const step = o.rateDbPerS * FRAME_S, fwd = new Float64Array(F), bwd = new Float64Array(F);
  for (let i = 0; i < F; i++) fwd[i] = i ? Math.max(fwd[i - 1] - step, Math.min(fwd[i - 1] + step, mean[i])) : mean[0];
  for (let i = F - 1; i >= 0; i--) bwd[i] = i < F - 1 ? Math.max(bwd[i + 1] - step, Math.min(bwd[i + 1] + step, mean[i])) : mean[F - 1];
  const gains = new Float32Array(F);
  let maxDb = -Infinity, minDb = Infinity;
  for (let i = 0; i < F; i++) { gains[i] = (fwd[i] + bwd[i]) / 2; maxDb = Math.max(maxDb, gains[i]); minDb = Math.min(minDb, gains[i]); }
  const uneven = spread >= o.unevenLu ? "phrases" : range?.lu != null && range.lu > range.aimLu + o.rangeOverLu ? "range" : null;
  const needed = !!uneven && Math.max(maxDb, -minDb) >= o.neededDb;
  if (!needed) gains.fill(0);
  // the speech's loudness before and once levelled, and the phrases' spread then
  let ps = 0, p0 = 0, pn = 0;
  const after = [];
  for (let i = 0; i < F; i++) if (speech[i]) { ps += pow(momentary[i] + gains[i]); p0 += pow(momentary[i]); pn++; if (Number.isFinite(P[i])) after.push(P[i] + gains[i]); }
  after.sort((a, b) => a - b);
  return {
    needed, uneven, gains, speech, refLufs: r1(ref), speechLufs: r2(dbOf(ps / pn)), speechLufsBefore: r2(dbOf(p0 / pn)),
    spreadLu: r1(spread), spreadAfterLu: r1(quantile(after, 0.9) - quantile(after, 0.1)),
    maxDb: needed ? r1(maxDb) : 0, minDb: needed ? r1(minDb) : 0,
  };
}

// the curve as raw floats (linear gain) at CURVE_RATE, a second longer than the sound
function writeCurve(file, gains, seconds) {
  const n = Math.ceil((seconds + 1) * CURVE_RATE), out = new Float32Array(n);
  // a frame's gain sits at the middle of its 400 ms window: 0.2 s before its time
  const at = (i) => (i + 1) * FRAME_S - 0.2;
  for (let j = 0, i = 0; j < n; j++) {
    const t = j / CURVE_RATE;
    while (i < gains.length - 1 && at(i + 1) <= t) i++;
    const t0 = at(i), t1 = at(Math.min(gains.length - 1, i + 1));
    const g = t <= t0 || t1 <= t0 ? gains[i] : gains[i] + (gains[Math.min(gains.length - 1, i + 1)] - gains[i]) * Math.min(1, (t - t0) / (t1 - t0));
    out[j] = 10 ** (g / 20);
  }
  fs.writeFileSync(file, Buffer.from(out.buffer));
}

// The short loud sounds measure set aside (m.speech.bursts.at: t, seconds, overDb over the voice's
// loud frames, its 90th percentile), each turned down by its overDb and `underDb` more over its
// stretch, widened by one of measure's frames (21.3 ms: its spectrum's window reaches a frame on)
// on either side, with ramps of `rampMs` (no click at the edges), as a gain curve at `rate` a
// second multiplied in. A knock left to the limiters instead: 30 to 50 dB over the voice, it
// decides the loudness of the whole file (a voice at −55 LUFS with one 30 ms burst at 0.9 reads
// −13.7 whole), and the limiters' release ducks the voice after it: on 6 clean readings at −25 to
// −65 LUFS with a burst, a clap, a thump or five bursts (level/eval-bump.mjs, 2026-11-20) the
// voice came out up to 41 LU under the target and the 300 ms after a knock up to 46 dB under the
// same voice without it. `underDb` (a judgement): turned down to the voice's loud frames alone,
// five knocks in a 5.5 s reading still lifted the whole 0.5 to 0.8 LU over the voice in it
export const BURSTS = { padS: 1024 / 48000, rampMs: 5, rate: 1000, underDb: 6 };
async function tameBursts(inWav, out, at, seconds, tmp) {
  const n = Math.ceil((seconds + 1) * BURSTS.rate), g = new Float32Array(n).fill(0);
  const ramp = (BURSTS.rampMs / 1000) * BURSTS.rate;
  for (const b of at) {
    const a = (b.t - BURSTS.padS) * BURSTS.rate, e = (b.t + b.seconds + BURSTS.padS) * BURSTS.rate;
    for (let j = Math.max(0, Math.floor(a - ramp)); j < Math.min(n, Math.ceil(e + ramp)); j++) {
      const w = j < a ? (j - (a - ramp)) / ramp : j > e ? ((e + ramp) - j) / ramp : 1;
      g[j] = Math.min(g[j], -(b.overDb + BURSTS.underDb) * Math.max(0, Math.min(1, w)));
    }
  }
  const curve = path.join(tmp, "bursts.f32");
  fs.writeFileSync(curve, Buffer.from(Float32Array.from(g, (d) => 10 ** (d / 20)).buffer));
  const r = await ffmpegRun(["-hide_banner", "-nostats", "-nostdin", "-v", "error", "-y", "-i", inWav, "-f", "f32le", "-ar", String(BURSTS.rate), "-ac", "1", "-i", curve,
    "-filter_complex", "[1:a]aresample=48000[g];[0:a]aformat=sample_fmts=flt:channel_layouts=mono[v];[v][g]amultiply[o]", "-map", "[o]", "-map_metadata", "-1", "-c:a", "pcm_f32le", out]);
  fs.rmSync(curve, { force: true });
  return r;
}

function durationOf(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.resolve(file)], { encoding: "utf8" });
  if (r.error?.code === "ENOENT") throw missing("ffprobe");
  return Number((r.stdout || "").trim()) || 0;
}

const ampOf = (db) => +(10 ** (db / 20)).toFixed(6);

// the limiter of a plain run is said to take too much when it takes more than 6 dB off the loudest
// peak and, with it, 1 LU or more off the loudness (so it acts on many words, not on one plosive):
// the target is then too loud for the recording's own dynamics. On the lab's speech at −14 LUFS
// (voice-v1 tune, 20 items, 2026-11-19) plain took 1 to 6 dB off the loudest peak and 0 to 0.9 LU
// off clean read speech; over both marks: typing (12.7 dB, 3.3 LU), an own take (8.5, 1.1), one
// studio reading (6.1, 1.5)
export const PLAIN_PEAKS_DB = 6;
export const PLAIN_LOUDNESS_LU = 1;
export const MODES = ["auto", "plain", "off"];

// the peak compressor as a piece of an -af chain, after the gain (the voice's one channel at
// `oneChannel` LUFS), under a ceiling of `limit` dBFS; its kinds (the lab tries them all):
//   lookahead  sidechaincompress listening to peaks, its threshold `underCeilingDb` under the ceiling,
//              the sound delayed by `lookahead` ms against what it listens to (and the delay taken
//              back to the sample): the gain is already down when a peak comes, so the attack can be
//              slow and smooth instead of fast and rough
//   peak       acompressor listening to peaks (no look-ahead), its threshold as lookahead's
//   prelimit   alimiter, `overCeilingDb` over the ceiling (shifted under full scale and back)
//   rms        the compressor before 2026-11-19, its threshold `overDb` over the loudness
// → { thresholdDb, chain, says, settings }
function compressorChain(P, oneChannel, limit) {
  if (P.kind === "prelimit") {
    const thresholdDb = limit + P.overCeilingDb, shift = 12;
    return { thresholdDb, settings: { kind: P.kind, overCeilingDb: P.overCeilingDb, attackMs: P.attack, releaseMs: P.release },
      says: `A slow limiter before the fast one, ${f1(P.overCeilingDb)} dB over its ceiling (look-ahead and attack ${P.attack} ms, release ${P.release} ms)`,
      chain: `alimiter=level_in=${ampOf(-shift)}:limit=${ampOf(Math.min(0, thresholdDb - shift))}:level_out=${ampOf(shift)}:attack=${P.attack}:release=${P.release}:level=disabled:latency=1` };
  }
  const thresholdDb = P.kind === "rms" ? oneChannel + P.overDb : limit - P.underCeilingDb;
  const opts = `threshold=${ampOf(Math.min(0, thresholdDb))}:ratio=${P.ratio}:attack=${P.attack}:release=${P.release}:knee=${P.knee}:detection=${P.kind === "rms" ? "rms" : "peak"}:makeup=1`;
  const settings = { kind: P.kind, ratio: P.ratio, attackMs: P.attack, releaseMs: P.release, ...(P.kind === "rms" ? { overLoudnessDb: P.overDb } : { underCeilingDb: P.underCeilingDb }), ...(P.kind === "lookahead" ? { lookaheadMs: P.lookahead } : {}) };
  if (P.kind === "rms") return { thresholdDb, settings, chain: `acompressor=${opts}`, says: `The syllables turned down (${P.ratio}:1 from ${P.overDb} dB over the speech's loudness, RMS, attack ${P.attack} ms, release ${P.release} ms)` };
  const says = `A compressor that listens to peaks, before the limiter: ${P.ratio}:1 from ${f1(P.underCeilingDb)} dB under its ceiling, attack ${P.attack} ms${P.kind === "lookahead" ? ` with as much look-ahead` : ""}, release ${P.release} ms`;
  if (P.kind !== "lookahead") return { thresholdDb, settings, says, chain: `acompressor=${opts}` };
  const n = Math.round(P.lookahead * 48);
  return { thresholdDb, settings, says, chain: `asplit[cm][cs];[cm]adelay=delays=${n}S:all=1[cd];[cs]apad=pad_len=${n}[cp];[cd][cp]sidechaincompress=${opts},atrim=start_sample=${n},asetpts=PTS-STARTPTS` };
}

// opts: { targets, mono, level: "auto" | "plain" | "off", encode: [ffmpeg's codec arguments], tmp: a folder,
//         keepLufs: with level off, the loudness to keep (as played; by default the intermediate's),
//         maxGainDb, lowGainDb (MAX_GAIN_DB and LOW_GAIN_DB moved with the target),
//         removeInput: remove inWav as soon as it is read for the last time,
//         peaks: another peak compressor (the lab's tries), or { kind: "none" } }
//   auto   leveller (where uneven), gain to the target, the slow limiter, the limiter
//   plain  gain to the target and the limiter only: the recording's own dynamics kept
//   off    gain to its own loudness and the limiter: its own dynamics and loudness kept, its peaks made safe
export async function level(inWav, out, opts = {}) {
  const T = { ...TARGETS, ...(opts.targets || {}) };
  const mode = opts.level ?? "auto";
  if (!MODES.includes(mode)) throw new LevelError(`--level is auto, plain or off, not ${mode}.`);
  const mono = !!opts.mono, auto = mode === "auto";
  const P = { ...PEAKS, ...(opts.peaks || {}) };
  // (both bounds are the recording's own level: at another target they move with it)
  const maxGain = opts.maxGainDb ?? r2(MAX_GAIN_DB + T.lufs - TARGETS.lufs);
  const lowGain = opts.lowGainDb ?? r2(LOW_GAIN_DB + T.lufs - TARGETS.lufs);
  inWav = path.resolve(inWav);
  out = path.resolve(out);
  const encode = opts.encode || ["-c:a", "pcm_s24le"];
  const tmp = opts.tmp ? path.resolve(opts.tmp) : fs.mkdtempSync(path.join(path.dirname(out), ".voice-sound-level-"));
  const ownTmp = !opts.tmp;
  const steps = [], left = [], skipped = [];
  let tamedIn = false;
  const dropIn = () => { if (opts.removeInput || tamedIn) fs.rmSync(inWav, { force: true }); };
  try {
    // 0. the short loud sounds measure set aside (a knock, a clap, a bump), turned down to about
    // the voice's own loud frames before anything is measured (auto and plain; with level off the
    // recording's dynamics are its own)
    const B = opts.bursts;
    if (mode !== "off" && B?.count > 0 && (B.at || []).length === B.count) {
      const tamed = path.join(tmp, "bursts-down.wav");
      const len = durationOf(inWav);
      const r = await tameBursts(inWav, tamed, B.at, len, tmp);
      if (r.status !== 0) throw new LevelError(`ffmpeg could not turn the short loud sounds down: ${lastLine(r.stderr)}`);
      if (opts.removeInput) fs.rmSync(inWav, { force: true });
      inWav = tamed; tamedIn = true;
      const n = B.count, list = B.at.map((b) => `${b.t.toFixed(2)} s`).join(", ");
      steps.push({
        id: "bursts", stage: "level", count: n, at: B.at.map((b) => ({ t: b.t, seconds: b.seconds, downDb: r1(b.overDb + BURSTS.underDb) })), rampMs: BURSTS.rampMs,
        why: `${n === 1 ? "A short loud sound" : `${n} short loud sounds`} (a knock, a clap, a bump: no voice's) at ${list}, up to ${f1(B.overDb)} dB over the voice's loud frames: each turned down to ${BURSTS.underDb} dB under them over its ${n === 1 ? "stretch" : "stretches"}, with ramps of ${BURSTS.rampMs} ms, before the gain is found, so that ${n === 1 ? "it neither decides" : "they neither decide"} the loudness nor ${n === 1 ? "leaves" : "leave"} the limiters to hold ${n === 1 ? "it" : "them"} down and duck the voice after.`,
      });
      left.push({ id: "bursts", stage: "level", count: n,
        why: `${n === 1 ? "A knock (or a clap, a bump) is" : `${n} knocks (or claps, bumps) are`} in the recording at ${list} and ${n === 1 ? "stays" : "stay"}, a little under the voice's loud frames: cut ${n === 1 ? "it" : "them"} out where the recording is edited if ${n === 1 ? "it is" : "they are"} not wanted.` });
    }
    // (a sound so quiet that ebur128's gate would hide part of its voice is measured through a
    // gain, `pre`, and its numbers taken back by it; the leveller reads the frames as measured,
    // since it works on their differences)
    let fr = await framesOf(inWav), pre = 0;
    if ((fr.lufs == null || fr.lufs < MEASURE_GAIN.underLufs) && fr.truePeak != null && fr.truePeak < MEASURE_GAIN.peakDb) {
      pre = MEASURE_GAIN.peakDb - fr.truePeak;
      const g = await framesOf(inWav, `volume=${pre.toFixed(2)}dB`);
      fr = { ...g, lufs: g.lufs == null ? null : g.lufs - pre, truePeak: g.truePeak == null ? null : g.truePeak - pre };
    }
    const before = { lufs: fr.lufs, rangeLu: fr.rangeLu, truePeak: fr.truePeak };
    const seconds = durationOf(inWav);
    if (mode !== "off" && fr.lufs == null)
      throw new LevelError("There is no voice to bring to a loudness: ebur128 finds no 400 ms of the mended sound over its gate (silence, a floor, or too short).");
    // the loudness aimed at, as played on two speakers: the target, or with level off the
    // recording's own as it came in (none when nothing in it can be measured: then no gain)
    const aim = mode === "off" ? (opts.keepLufs ?? (fr.lufs != null ? fr.lufs + TWO_SPEAKERS_LU : null)) : T.lufs;
    // the one channel ffmpeg works on (two speakers play it twice: 3 LU under the aim), and what
    // the delivered file measures (two channels: the aim; one channel: the one channel's)
    const oneChannel = aim == null ? null : aim - TWO_SPEAKERS_LU;
    const measuredAim = aim == null ? null : mono ? oneChannel : aim;
    const tooMuch = (g) => new LevelError(tooQuiet(fr.lufs + TWO_SPEAKERS_LU, aim, g, maxGain));

    let dyn = inWav, gain = 0, dynLufs = fr.lufs, dynPeak = fr.truePeak, dynRange = fr.rangeLu, leveller = null, lift = 0;
    const tamer = auto && P.kind !== "none";
    if (mode === "plain") skipped.push({ id: "leveller", why: "Level plain: no leveller and no slow limiter before the limiter, the recording's own dynamics kept; only the gain to the target and the limiter." });
    if (auto) {
      leveller = levellerOf(fr.momentary, { lu: fr.rangeLu, aimLu: T.rangeLu });
      // (the leveller's lift and the gain to the target together never beyond the bound)
      const levelledBy = leveller.needed && leveller.speechLufs != null ? leveller.speechLufs - leveller.speechLufsBefore : 0;
      const need = oneChannel - (fr.lufs + levelledBy);
      if (need > maxGain) throw tooMuch(need);
      if (leveller.needed && need + leveller.maxDb > maxGain) {
        for (let i = 0; i < leveller.gains.length; i++) leveller.gains[i] = Math.min(leveller.gains[i], maxGain - need);
        leveller.maxDb = r1(maxGain - need);
      }
      if (leveller.needed) {
        lift = Math.max(0, leveller.maxDb);
        const curve = path.join(tmp, "leveller.f32");
        writeCurve(curve, leveller.gains, seconds);
        dyn = path.join(tmp, "levelled.wav");
        const r = await ffmpegRun(["-hide_banner", "-nostats", "-nostdin", "-y", "-i", inWav, "-f", "f32le", "-ar", String(CURVE_RATE), "-ac", "1", "-i", curve,
          "-filter_complex", "[1:a]aresample=48000[g];[0:a][g]amultiply,ebur128=peak=true[o]", "-map", "[o]", "-map_metadata", "-1", "-c:a", "pcm_f32le", dyn]);
        if (r.status !== 0) throw new LevelError(`ffmpeg could not level the voice: ${lastLine(r.stderr)}`);
        dropIn();
        fs.rmSync(curve, { force: true });
        ({ lufs: dynLufs, truePeak: dynPeak, rangeLu: dynRange } = summary(r.stderr));
        if (pre) ({ lufs: dynLufs, truePeak: dynPeak, rangeLu: dynRange } = await loudnessAt(dyn));
        const because = leveller.uneven === "phrases" ? `Its phrases spread over ${f1(leveller.spreadLu)} LU` : `Its loudness range is ${f1(fr.rangeLu)} LU`;
        steps.push({
          id: "leveller", stage: "level",
          why: `${because}: each phrase brought towards the level most of them have where it lies more than ${LEVELLER.deadLu} LU off it, by ${signed(leveller.minDb)} to ${signed(leveller.maxDb)} dB, no faster than ${LEVELLER.rateDbPerS} dB a second and held through the pauses, so that their noise is never raised on its own.`,
          spreadLu: leveller.spreadLu, spreadAfterLu: leveller.spreadAfterLu, minDb: leveller.minDb, maxDb: leveller.maxDb,
          maxRateDbPerS: LEVELLER.rateDbPerS,
        });
      } else {
        skipped.push({ id: "leveller", why: leveller.spreadLu == null ? "Too little speech to tell phrases apart: no leveller."
          : leveller.uneven ? `No phrase lies far enough off the level most of them have for a leveller to move it by ${LEVELLER.neededDb} dB: none.` : `Its phrases lie within ${f1(leveller.spreadLu)} LU of each other${fr.rangeLu != null ? ` and its range is ${f1(fr.rangeLu)} LU` : ""}: no leveller needed.` });
      }
    }
    if (dynLufs != null && oneChannel != null) gain = oneChannel - dynLufs;
    if (gain + lift > maxGain + 0.05) throw tooMuch(gain + lift);
    // gain, the peak compressor (auto), the limiter, in rounds (ROUNDS above). The gain on the
    // way by the secant through the last two tries, since the compressor and the limiter take part
    // of every dB; the gain never beyond the bound. The compressor sits after the gain, so that its
    // threshold lies the same few dB under the limiter's ceiling on every recording.
    let limit = T.truePeak, peakFixes = 0, capped = false, saturated = false, got, C = null, lastTry = null, offset = 0, rounds = 0, raised = 0;
    const passes = [];
    const cap = () => { if (gain + lift > maxGain) { gain = maxGain - lift; capped = true; } };
    const chain = (meter = false) => {
      const af = [`volume=${gain.toFixed(2)}dB`];
      if (tamer) { C = compressorChain(P, oneChannel, limit); af.push(C.chain); }
      if (meter) af.push("ebur128=peak=true");
      af.push(`aresample=${LIMITER.rate}`, `alimiter=limit=${ampOf(Math.max(-24, limit))}:attack=${LIMITER.attack}:release=${LIMITER.release}:level=disabled:latency=1`, "aresample=48000");
      if (!mono) af.push("pan=stereo|c0=c0|c1=c0");
      return af.join(",");
    };
    const tryGain = async () => {
      const g = await loudness(dyn, chain());
      passes.push({ kind: "tried", gainDb: r2(gain), limitDb: r2(limit), lufs: g.lufs, truePeak: g.truePeak });
      lastTry = { gain, limit, lufs: g.lufs };
      return g;
    };
    // the gain for `want` (the loudness on the way that the delivered file should come to)
    const settle = async (want) => {
      saturated = false;
      if (want == null) return;
      let prev = null;
      for (let i = 0; ; i++) {
        const g = await tryGain();
        if (g.lufs == null || Math.abs(g.lufs - want) <= TRY_TOLERANCE || i === TRIES - 1 || capped) return;
        const moved = prev && Math.abs(gain - prev.gain) > 0.05 ? (g.lufs - prev.lufs) / (gain - prev.gain) : 1;
        if (g.lufs < want && moved < SATURATED_LU_PER_DB) { saturated = true; return; }
        prev = { gain, lufs: g.lufs };
        gain += Math.max(-12, Math.min(12, (want - g.lufs) / Math.min(1, Math.max(SATURATED_LU_PER_DB, moved))));
        cap();
      }
    };
    // (the delivered pass measures the sound between the compressor and the limiter on the way)
    let meter = {}, loudOk = true, peakOk = true, best = null;
    const bestFile = path.join(tmp, `best${path.extname(out)}`);
    for (;;) {
      rounds++;
      await settle(measuredAim == null ? null : measuredAim - offset);
      const r = await ffmpegRun(["-hide_banner", "-nostats", "-nostdin", "-y", "-i", dyn, "-map", "0:a:0", "-af", chain(true), "-map_metadata", "-1", "-ar", "48000", ...encode, out]);
      if (r.status !== 0) throw new LevelError(`ffmpeg could not make the finished sound: ${lastLine(r.stderr, 2)}`);
      meter = summary(r.stderr);
      got = await loudness(out);
      passes.push({ kind: "delivered", gainDb: r2(gain), limitDb: r2(limit), lufs: got.lufs, truePeak: got.truePeak });
      // what the encoding moved the loudness by, against the try at these settings
      if (lastTry && lastTry.gain === gain && lastTry.limit === limit && lastTry.lufs != null && got.lufs != null) offset = got.lufs - lastTry.lufs;
      loudOk = measuredAim == null || got.lufs == null || Math.abs(got.lufs - measuredAim) <= LUFS_TOLERANCE;
      peakOk = got.truePeak == null || got.truePeak <= T.truePeak + 0.05;
      // the best encoding so far is kept: the true peak never over what a check accepts, then the
      // loudness within its tolerance, then the true peak at the aim, then the nearest
      const key = [got.truePeak != null && got.truePeak > T.peakAccepted ? 1 : 0, loudOk ? 0 : 1, peakOk ? 0 : 1,
        measuredAim == null || got.lufs == null ? 0 : Math.abs(got.lufs - measuredAim), Math.max(0, (got.truePeak ?? -99) - T.truePeak)];
      if (!best || ahead(key, best.key)) { fs.copyFileSync(out, bestFile); best = { key, got, meter, gain, limit, loudOk, peakOk, saturated, capped, round: rounds }; }
      if ((loudOk && peakOk) || rounds === ROUNDS) break;
      if (!peakOk) { if (limit <= -24) break; limit = Math.max(-24, limit - (got.truePeak - T.truePeak) - PEAK_MARGIN_DB); peakFixes++; continue; }
      // (too quiet with room under the aim, after a lowering went too far: the ceiling raised again)
      if (got.lufs < measuredAim && limit < T.truePeak && got.truePeak < T.truePeak - 3 * PEAK_MARGIN_DB) {
        limit = Math.min(T.truePeak, limit + (T.truePeak - got.truePeak) - PEAK_MARGIN_DB); raised++; continue;
      }
      // (the loudness off: another round with the encoding's offset, unless more gain cannot help)
      if ((capped || saturated) && got.lufs < measuredAim) break;
    }
    // (a later round that came out worse: the best one delivered)
    if (best.round !== rounds) {
      fs.copyFileSync(bestFile, out);
      ({ got, meter, gain, limit, loudOk, peakOk, saturated, capped } = best);
    }
    fs.rmSync(bestFile, { force: true });
    if (dyn === inWav) dropIn(); else fs.rmSync(dyn, { force: true });
    const delivered = { ...got, asPlayedLufs: got.lufs == null ? null : r2(got.lufs + (mono ? TWO_SPEAKERS_LU : 0)) };
    const asWhat = mono ? `as played on two speakers (the one channel ${f1(measuredAim ?? 0)} LUFS as ffmpeg measures it)` : "as played on two speakers";
    // the sound before the compressor (the gain only: its numbers moved by the gain) and after it
    // (measured on the way): what the compressor did to the peaks, the loudness and the range
    const into = { lufs: dynLufs != null ? dynLufs + gain : null, truePeak: dynPeak != null ? dynPeak + gain : null, rangeLu: dynRange };
    const crest = (x) => (x?.truePeak != null && x?.lufs != null ? x.truePeak - x.lufs : null);
    const peaks = tamer ? {
      crestBeforeDb: r1(crest(into)), crestAfterDb: r1(crest(meter)), takenLu: r1(into.lufs != null && meter.lufs != null ? into.lufs - meter.lufs : null),
      peakTakenDb: r1(into.truePeak != null && meter.truePeak != null ? Math.max(0, into.truePeak - meter.truePeak) : null),
      thresholdDb: r2(C.thresholdDb), rangeBeforeLu: r1(into.rangeLu), rangeAfterLu: r1(meter.rangeLu),
    } : null;
    if (peaks) peaks.nearerDb = r1(peaks.crestBeforeDb != null && peaks.crestAfterDb != null ? peaks.crestBeforeDb - peaks.crestAfterDb : null);
    if (mode !== "off") {
      steps.push({
        id: "loudness", stage: "level",
        why: loudOk
          ? `Brought to ${f1(T.lufs)} LUFS ${asWhat}, measured on the delivered file as it is encoded and corrected until within ${LUFS_TOLERANCE} LU (${encodings(rounds)}): where the platforms play speech.`
          : `Brought towards ${f1(T.lufs)} LUFS ${asWhat}, measured on the delivered file as it is encoded (${encodings(rounds)}): it came to ${f1(delivered.asPlayedLufs ?? 0)}, see what is left.`,
        gainDb: r2(gain), targetLufs: T.lufs, measuredLufs: r2(measuredAim), deliveredLufs: delivered.lufs, rounds,
      });
    } else if (aim != null) {
      steps.push({
        id: "loudness", stage: "level",
        why: `Its own loudness kept: ${f1(aim)} LUFS ${asWhat}, as it came in${Math.abs(gain) >= 0.5 ? ` (${signed(gain)} dB on the mended sound${gain > 0 ? ": what repair took off it for headroom given back" : ""})` : ""}, measured on the delivered file.`,
        gainDb: r2(gain), keptLufs: r2(aim), measuredLufs: r2(measuredAim),
      });
    }
    // what the limiter took off the loudness (the gain it was given against what came out) and
    // off the loudest peak (where it would have been against where it is)
    if (peaks) {
      const n = peaks.nearerDb;
      const did = n == null ? "" : Math.abs(n) < 0.1 ? "no peak reached it, the peaks stayed where they were"
        : n > 0 ? `the loudest peak came ${f1(n)} dB nearer the loudness (${f1(peaks.crestBeforeDb)} → ${f1(peaks.crestAfterDb)} dB over it)`
        : `the loudest peak went ${f1(-n)} dB farther from the loudness (${f1(peaks.crestBeforeDb)} → ${f1(peaks.crestAfterDb)} dB over it)`;
      const range = peaks.rangeBeforeLu != null && peaks.rangeAfterLu != null ? `, the loudness range ${f1(peaks.rangeBeforeLu)} → ${f1(peaks.rangeAfterLu)} LU` : "";
      steps.push({
        id: "peaks", stage: "level",
        why: `${C.says}: ${did}${peaks.takenLu != null && Math.abs(peaks.takenLu) >= 0.1 ? `, ${f1(peaks.takenLu)} LU off the loudness` : ""}${range}.`,
        ...C.settings, thresholdDb: peaks.thresholdDb, crestBeforeDb: peaks.crestBeforeDb, crestAfterDb: peaks.crestAfterDb, peaksNearerDb: peaks.nearerDb,
        peakTakenDb: peaks.peakTakenDb, loudnessTakenLu: peaks.takenLu, rangeBeforeLu: peaks.rangeBeforeLu, rangeAfterLu: peaks.rangeAfterLu,
      });
    }
    // (its input measured on the way, against the delivered file)
    const limTaken = r1(meter.lufs != null && delivered.lufs != null ? meter.lufs + (mono ? 0 : TWO_SPEAKERS_LU) - delivered.lufs : null);
    const peaksTaken = r1(meter.truePeak != null && delivered.truePeak != null ? Math.max(0, meter.truePeak - delivered.truePeak) : null);
    // without the peak compressor: its input, less the gain its own loss of loudness asked for
    const withoutDb = peaks && into.truePeak != null && delivered.truePeak != null ? r1(Math.max(0, into.truePeak - (peaks.takenLu ?? 0) - delivered.truePeak)) : null;
    const tookPeaks = peaksTaken != null && peaksTaken >= 0.5;
    steps.push({
      id: "limiter", stage: "level",
      why: `Its peaks held under ${f1(limit)} dB (at four times the sample rate, so that the peaks between the samples count) and the true peak measured after the encoding, which raises it${peakFixes ? `: lowered ${times(peakFixes)} because the encoded file came over the ${f1(T.truePeak)} dBTP aimed at${raised ? ` and raised ${times(raised)} where it came out far under it and too quiet` : ""}, the gain found again each time, in ${encodings(rounds)}${best.round !== rounds ? ` (the ${nth(best.round)} delivered, the nearest)` : ""}` : ""}` +
        (tookPeaks ? `; it took ${f1(peaksTaken)} dB off the loudest peak${limTaken != null && limTaken >= 0.1 ? ` and ${f1(limTaken)} LU off the loudness` : ""}` : "; it took nothing worth naming off the peaks") +
        (withoutDb != null ? ` (about ${f1(withoutDb)} dB without the slow limiter before it)` : "") +
        (mode === "off" && tookPeaks ? ": at its own loudness its peaks could not be made safe without limiting them" : "") + ".",
      limitDb: r2(limit), loweredTimes: peakFixes, raisedTimes: raised, encodings: rounds, deliveredRound: best.round, peaksTakenDb: peaksTaken, loudnessTakenLu: limTaken, ...(withoutDb != null ? { withoutCompressorDb: withoutDb } : {}),
    });
    if (mode === "plain" && peaksTaken != null && peaksTaken > PLAIN_PEAKS_DB && (limTaken ?? 0) >= PLAIN_LOUDNESS_LU)
      left.push({ id: "peaks", stage: "level", why: `To reach ${f1(T.lufs)} LUFS the limiter took ${f1(peaksTaken)} dB off the loudest peaks and ${f1(limTaken)} LU off the loudness: the target is too loud for this recording's own dynamics, and the limiter may be heard on its loudest words; --level auto tames its peaks first, a lower --loudness spares them.` });
    if (measuredAim != null && delivered.lufs != null && Math.abs(delivered.lufs - measuredAim) > LUFS_TOLERANCE) {
      const off = delivered.lufs - measuredAim;
      const why = capped && off < 0 ? `the gain stops at ${maxGain} dB.`
        : saturated && off < 0 ? `the loudness gave way to the true peak: to hold it under ${f1(limit)} dB the two limiters take ${f1(Math.max(0, (dynLufs ?? 0) + gain + (mono ? 0 : TWO_SPEAKERS_LU) - delivered.lufs))} LU off the loudness, and more gain moves it by less than ${SATURATED_LU_PER_DB} LU a dB: its peaks would need more limiting than the slow and the fast limiter give; a lower --loudness spares them.`
        : `the corrections did not reach it in ${encodings(rounds)}.`;
      left.push({ id: "loudness", stage: "level", offLu: r2(off), why: `The loudness came to ${f1(delivered.asPlayedLufs)} LUFS as played, ${f1(Math.abs(off))} LU ${off < 0 ? "under" : "over"} the ${f1(aim)} aimed at: ${why}` });
    }
    // (how far under the target it lay, not the gain given: the gain also makes up for what the
    // limiters take, more with plain than with auto)
    const underDb = mode !== "off" && fr.lufs != null ? aim - (fr.lufs + TWO_SPEAKERS_LU) : null;
    if (underDb != null && underDb >= lowGain)
      left.push({ id: "quiet", stage: "level", underDb: r2(underDb), gainDb: r2(gain + lift), lowGainDb: lowGain,
        why: `It was recorded very low, ${f1(fr.lufs + TWO_SPEAKERS_LU)} LUFS as played, ${Math.round(underDb)} dB under the ${f1(T.lufs)} it was brought to all the same: its noise and its room came up with the voice by as much; next time closer to the microphone, or with the recorder's input turned up.` });
    if (delivered.truePeak != null && delivered.truePeak > T.peakAccepted)
      left.push({ id: "peak", stage: "level", why: `The true peak after the encoding is ${f1(delivered.truePeak)} dBTP, over the ${f1(T.peakAccepted)} dBTP a check accepts${peakFixes ? `, after the limiter was lowered ${times(peakFixes)}` : ""} in ${encodings(rounds)}: the peak gave way.`, overDb: r2(delivered.truePeak - T.peakAccepted) });
    else if (delivered.truePeak != null && delivered.truePeak > T.truePeak + 0.05)
      left.push({ id: "peak", stage: "level", why: `The true peak after the encoding is ${f1(delivered.truePeak)} dBTP, ${f1(delivered.truePeak - T.truePeak)} dB over the ${f1(T.truePeak)} aimed at and under the ${f1(T.peakAccepted)} a check accepts: the peak gave way, since in ${encodings(rounds)} a lower ceiling took the loudness off the target.`, overDb: r2(delivered.truePeak - T.truePeak) });
    if (auto && delivered.rangeLu != null && delivered.rangeLu > T.rangeLu)
      left.push({ id: "range", stage: "level", why: `The loudness range is ${f1(delivered.rangeLu)} LU, over the ${T.rangeLu} LU aimed at for a phone in a noisy place: the leveller corrects only phrases far off the middle, so that it is never heard pulling the voice around.` });
    if (mode === "off") skipped.push({ id: "level", why: "Level off: the recording's own dynamics and loudness are kept, only its peaks made safe." });
    return {
      mode, steps, left, skipped, before, delivered, passes,
      leveller: leveller && { needed: leveller.needed, spreadLu: leveller.spreadLu, spreadAfterLu: leveller.spreadAfterLu, minDb: leveller.minDb, maxDb: leveller.maxDb },
      settings: { targets: T, mono, level: mode, aimLufs: r2(aim), measuredLufs: r2(measuredAim), maxGainDb: maxGain, lowGainDb: lowGain, measuredThroughDb: r2(pre), leveller: LEVELLER, peaks: auto ? P : null,
        limiter: { ...LIMITER, limitDb: r2(limit), plainPeaksDb: PLAIN_PEAKS_DB, plainLoudnessLu: PLAIN_LOUDNESS_LU } },
    };
  } finally {
    if (ownTmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}
