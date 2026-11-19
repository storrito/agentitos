// The last stage of `clean`: from the mended intermediate (48 kHz, one channel, float WAV) to the
// finished sound, in three steps, in this order:
//
//   1. the leveller, for a voice whose phrases lie at different levels (a speaker who turns away,
//      two takes): a slow gain that follows the speech from phrase to phrase towards one level,
//      computed here from ebur128's momentary loudness of the intermediate (measured again: the
//      raw file's numbers no longer hold after repair), held through the pauses, bounded, applied
//      by ffmpeg as a gain curve multiplied in. Only as much as needed: an even voice gets none
//   2. a gentle compressor for the syllables, its threshold set from the speech's own level, so
//      that it works the same on a quiet and a loud recording
//   3. gain to the target and a limiter (oversampled), the file encoded as it will be delivered,
//      its loudness and true peak measured on that file and corrected (not loudnorm: its linear
//      mode silently falls back to a dynamic one that pumps on speech)
//
// `level: "plain"` does only the third (for a voice that pumps, breathes or sounds flat after
// `auto`), `"off"` only the limiter (its own loudness kept, for a skill that levels itself).
//
//   level(inWav, out, opts)   writes `out` (the container its ending names, the codec `opts.encode`
//                             gives) → { steps, left, skipped, before, delivered, passes, settings }
//   levellerOf(frames)        the leveller's curve from ebur128's frames (pure: the tests read it)
//   framesOf(file)            ebur128's momentary loudness every 100 ms, and its summary (streamed)
//   loudnessOf(file)          { lufs, rangeLu, truePeak } of a file's first sound, as ffmpeg measures it
//
// Loudness is as played: a file with one channel plays on both speakers and measures 3 LU louder
// there than as one channel. By default the output has two channels with the same voice in both and
// `lufs` is its loudness; `mono: true` writes one channel at `lufs` as ffmpeg measures that channel.

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

export const TARGETS = { lufs: -14, truePeak: -1.5, peakAccepted: -1, rangeLu: 5 };

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
// the compressor: 2.5:1, attack 10 ms, release 80 ms, RMS detection, ffmpeg's soft knee; its
// threshold 4 dB over the speech's loudness: the syllables' 10 ms level reaches 6 to 12 dB over it,
// so the loudest are turned down by about 3 to 5 dB and the body of the voice not at all
export const COMPRESSOR = { ratio: 2.5, attack: 10, release: 80, overDb: 4 };
// the limiter: sample peaks at 4 × 48 kHz (ffmpeg's documentation: oversample around alimiter),
// look-ahead 5 ms, release 60 ms, its delay compensated (latency), its own renormalising off
export const LIMITER = { rate: 192000, attack: 5, release: 60 };
// the loudness within 0.3 LU of the target, corrected up to 3 times; the ceiling lowered at most
// twice when the delivered file's true peak is over what a check accepts
const LUFS_TOLERANCE = 0.3, LOUDNESS_FIXES = 3, PEAK_FIXES = 2;
// a file with one channel plays on both speakers: 10·log10(2) louder
export const TWO_SPEAKERS_LU = 3.01;

const minus = (s) => s.replace(/^-/, "−");
const f1 = (x) => minus((Math.round(x * 10) / 10).toFixed(1));
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
const missing = () => new LevelError("ffmpeg is missing: this tool needs ffmpeg on the PATH.");

function run(args, what) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-v", "error", "-y", ...args], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.error?.code === "ENOENT") throw missing();
  if (r.status !== 0) throw new LevelError(`ffmpeg could not make ${what}: ${(r.stderr || "").trim().split("\n").slice(-2).join(" ")}`);
  return r;
}

// ebur128's summary in a log
function summary(log) {
  const s = log.slice(log.lastIndexOf("Summary:"));
  const n = (re) => { const m = s.match(re); const v = m ? Number(m[1]) : NaN; return Number.isFinite(v) && v > -200 ? v : null; };
  return { lufs: n(/I:\s*(-?[\d.]+|-inf) LUFS/), rangeLu: n(/LRA:\s*(-?[\d.]+) LU/), truePeak: n(/Peak:\s*(-?[\d.]+|-inf) dBFS/) };
}

export function loudnessOf(file) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-nostdin", "-i", file, "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.error?.code === "ENOENT") throw missing();
  if (r.status !== 0) throw new LevelError(`ffmpeg could not measure ${path.basename(file)}: ${(r.stderr || "").trim().split("\n").slice(-1)[0]}`);
  return summary(r.stderr || "");
}

const FRAME_RE = /t:\s*([\d.]+)\s+TARGET:\S+ LUFS\s+M:\s*(-?[\d.]+|-?inf|nan)/;
export function framesOf(file) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-nostats", "-nostdin", "-i", file, "-map", "0:a:0", "-af", "ebur128=peak=true:framelog=info", "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
    let M = new Float32Array(1 << 12), n = 0, buf = "", tail = "";
    p.stderr.setEncoding("utf8");
    p.stderr.on("data", (s) => {
      buf += s;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        const m = FRAME_RE.exec(line);
        if (!m) { tail = (tail + line + "\n").slice(-4000); continue; }
        if (n === M.length) { const g = new Float32Array(M.length * 2); g.set(M); M = g; }
        const v = Number(m[2]);
        M[n++] = Number.isFinite(v) ? v : -120;
      }
    });
    p.on("error", (e) => reject(e.code === "ENOENT" ? missing() : e));
    p.on("close", (code) => {
      tail += buf;
      if (code !== 0) return reject(new LevelError(`ffmpeg could not measure ${path.basename(file)} again: ${tail.trim().split("\n").slice(-1)[0]}`));
      resolve({ momentary: M.slice(0, n), ...summary(tail) });
    });
  });
}

// The leveller's curve, one gain (dB) a frame of 100 ms, from the momentary loudness `momentary`
// (dB, a frame's 400 ms ending at it). Speech frames: over a gate between the pauses' floor (5th
// percentile) and the loud speech (95th): 35 % of the way up, at least 4 dB over the floor, at most
// 25 dB under the loud speech. `range`: { lu: the sound's loudness range, aimLu }, or null.
// → { needed, uneven: why it is uneven (or null), gains, speech, refLufs, speechLufs (levelled),
// spreadLu, spreadAfterLu, maxDb, minDb }
export function levellerOf(momentary, range = null, o = LEVELLER) {
  const F = momentary.length;
  const valid = [];
  for (let i = 0; i < F; i++) if (momentary[i] > -70 && i >= 3) valid.push(momentary[i]);
  valid.sort((a, b) => a - b);
  const none = { needed: false, uneven: null, gains: new Float32Array(F), speech: new Uint8Array(F), refLufs: null, speechLufs: null, spreadLu: null, spreadAfterLu: null, maxDb: 0, minDb: 0 };
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
  // the speech's loudness once levelled, and the phrases' spread then
  let ps = 0, pn = 0;
  const after = [];
  for (let i = 0; i < F; i++) if (speech[i]) { ps += pow(momentary[i] + gains[i]); pn++; if (Number.isFinite(P[i])) after.push(P[i] + gains[i]); }
  after.sort((a, b) => a - b);
  return {
    needed, uneven, gains, speech, refLufs: r1(ref), speechLufs: r2(dbOf(ps / pn)),
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

function durationOf(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  if (r.error?.code === "ENOENT") throw new LevelError("ffprobe is missing: this tool needs ffmpeg on the PATH.");
  return Number(r.stdout.trim()) || 0;
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

// opts: { targets, mono, level: "auto" | "plain" | "off", encode: [ffmpeg's codec arguments], tmp: a folder }
//   auto   leveller (where uneven), compressor, gain to the target, limiter
//   plain  gain to the target and the limiter only: the recording's own dynamics kept
//   off    the limiter only: its own dynamics and loudness kept, its peaks made safe
export async function level(inWav, out, opts = {}) {
  const T = { ...TARGETS, ...(opts.targets || {}) };
  const mode = opts.level ?? "auto";
  if (!MODES.includes(mode)) throw new LevelError(`--level is auto, plain or off, not ${mode}.`);
  const mono = !!opts.mono, auto = mode === "auto", loud = mode !== "off";
  const encode = opts.encode || ["-c:a", "pcm_s24le"];
  const tmp = opts.tmp || fs.mkdtempSync(path.join(path.dirname(path.resolve(out)), ".level-"));
  const ownTmp = !opts.tmp;
  // the target for the one channel ffmpeg works on
  const oneChannel = T.lufs - (mono ? 0 : TWO_SPEAKERS_LU);
  const steps = [], left = [], skipped = [];
  try {
    const fr = await framesOf(inWav);
    const before = { lufs: fr.lufs, rangeLu: fr.rangeLu, truePeak: fr.truePeak };
    const seconds = durationOf(inWav);
    let dyn = inWav, gain = 0, preDb = 0, dynLufs = fr.lufs, dynPeak = fr.truePeak, leveller = null;
    if (loud && fr.lufs == null) throw new LevelError("There is no voice to bring to a loudness: the mended sound is silent.");
    if (mode === "plain") {
      gain = oneChannel - fr.lufs;
      skipped.push({ id: "leveller", why: "Level plain: no leveller and no compressor, the recording's own dynamics kept; only the gain to the target and the limiter." });
    }
    if (auto) {
      if (fr.lufs == null) throw new LevelError("There is no voice to level: the mended sound is silent.");
      leveller = levellerOf(fr.momentary, { lu: fr.rangeLu, aimLu: T.rangeLu });
      const graph = [];
      const ins = ["-i", inWav];
      const signed = (x) => (x > 0 ? "+" : "") + f1(x);
      if (leveller.needed) {
        const curve = path.join(tmp, "leveller.f32");
        writeCurve(curve, leveller.gains, seconds);
        ins.push("-f", "f32le", "-ar", String(CURVE_RATE), "-ac", "1", "-i", curve);
        graph.push("[1:a]aresample=48000[g]", "[0:a][g]amultiply[l]");
        const because = leveller.uneven === "phrases" ? `Its phrases spread over ${f1(leveller.spreadLu)} LU` : `Its loudness range is ${f1(fr.rangeLu)} LU`;
        steps.push({
          id: "leveller", stage: "level",
          why: `${because}: each phrase brought towards the level most of them have where it lies more than ${LEVELLER.deadLu} LU off it, by ${signed(leveller.minDb)} to ${signed(leveller.maxDb)} dB, no faster than ${LEVELLER.rateDbPerS} dB a second and held through the pauses, so that their noise is never raised on its own.`,
          spreadLu: leveller.spreadLu, spreadAfterLu: leveller.spreadAfterLu, minDb: leveller.minDb, maxDb: leveller.maxDb,
          maxRateDbPerS: LEVELLER.rateDbPerS,
        });
      } else {
        graph.push("[0:a]anull[l]");
        skipped.push({ id: "leveller", why: leveller.spreadLu == null ? "Too little speech to tell phrases apart: no leveller."
          : leveller.uneven ? `No phrase lies far enough off the level most of them have for a leveller to move it by ${LEVELLER.neededDb} dB: none.` : `Its phrases lie within ${f1(leveller.spreadLu)} LU of each other${fr.rangeLu != null ? ` and its range is ${f1(fr.rangeLu)} LU` : ""}: no leveller needed.` });
      }
      // the speech brought near the target first, so that the compressor's threshold sits at the
      // same place over the speech on a quiet and on a loud recording
      const pre = oneChannel - (leveller.speechLufs ?? fr.lufs);
      const thresholdDb = oneChannel + COMPRESSOR.overDb;
      const C = COMPRESSOR;
      // (measured before the compressor and after it: what it took off the loudness and the peaks)
      graph.push(`[l]volume=${pre.toFixed(2)}dB,ebur128=peak=true,acompressor=threshold=${ampOf(thresholdDb)}:ratio=${C.ratio}:attack=${C.attack}:release=${C.release}:detection=rms:makeup=1,ebur128=peak=true[o]`);
      dyn = path.join(tmp, "levelled.wav");
      const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-nostdin", "-y", ...ins, "-filter_complex", graph.join(";"), "-map", "[o]", "-map_metadata", "-1", "-c:a", "pcm_f32le", dyn], { encoding: "utf8", maxBuffer: 1 << 24 });
      if (r.error?.code === "ENOENT") throw missing();
      if (r.status !== 0) throw new LevelError(`ffmpeg could not level the voice: ${(r.stderr || "").trim().split("\n").slice(-1)[0]}`);
      const parts = (r.stderr || "").split("Summary:").slice(1).map((s) => summary(`Summary:${s}`));
      const into = parts.at(-2) ?? {}, got = parts.at(-1) ?? {};
      const crest = (x) => (x?.truePeak != null && x?.lufs != null ? x.truePeak - x.lufs : null);
      const takenLu = r1(into.lufs != null && got.lufs != null ? into.lufs - got.lufs : null);
      const peaksDb = r1(crest(into) != null && crest(got) != null ? crest(into) - crest(got) : null);
      steps.push({
        id: "compressor", stage: "level",
        why: `The syllables' peaks turned down gently (${C.ratio}:1 from ${C.overDb} dB over the speech's loudness, attack ${C.attack} ms, release ${C.release} ms${peaksDb != null ? `; the peaks came ${f1(peaksDb)} dB nearer the loudness` : ""}): the voice stays even from word to word on a phone in a noisy place, without the breathing of a voice compressed hard.`,
        ratio: C.ratio, thresholdOverSpeechDb: C.overDb, attackMs: C.attack, releaseMs: C.release, loudnessTakenLu: takenLu, peaksNearerDb: peaksDb,
      });
      preDb = pre;
      dynLufs = got.lufs;
      dynPeak = got.truePeak;
      gain = oneChannel - (got.lufs ?? oneChannel);
    }
    // gain and the limiter. The gain is found on the chain's sound measured on the way (no file:
    // cheap), the secant through the last two tries, since the limiter takes part of every dB;
    // then the file is encoded as delivered and measured, the ceiling lowered when its true peak
    // is over what a check accepts (and the gain found again), the gain corrected once more when
    // the encoding moved the loudness
    let limit = T.truePeak, peakFixes = 0, retried = false, got;
    const passes = [];
    const chain = () => {
      const af = [`volume=${gain.toFixed(2)}dB`, `aresample=${LIMITER.rate}`,
        `alimiter=limit=${ampOf(Math.max(-24, limit))}:attack=${LIMITER.attack}:release=${LIMITER.release}:level=disabled:latency=1`, "aresample=48000"];
      if (!mono) af.push("pan=stereo|c0=c0|c1=c0");
      return af.join(",");
    };
    const tryGain = () => {
      const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-nostdin", "-i", dyn, "-map", "0:a:0", "-af", `${chain()},ebur128=peak=true`, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 24 });
      if (r.status !== 0) throw new LevelError(`ffmpeg could not try the gain: ${(r.stderr || "").trim().split("\n").slice(-1)[0]}`);
      const g = summary(r.stderr || "");
      passes.push({ kind: "tried", gainDb: r2(gain), limitDb: r2(limit), lufs: g.lufs, truePeak: g.truePeak });
      return g;
    };
    const settle = () => {
      if (!loud) return;
      let prev = null;
      for (let i = 0; ; i++) {
        const g = tryGain();
        if (g.lufs == null || Math.abs(g.lufs - T.lufs) <= LUFS_TOLERANCE || i === LOUDNESS_FIXES) return;
        const slope = prev && Math.abs(gain - prev.gain) > 0.05 ? Math.min(1, Math.max(0.3, (g.lufs - prev.lufs) / (gain - prev.gain))) : 1;
        prev = { gain, lufs: g.lufs };
        gain += (T.lufs - g.lufs) / slope;
      }
    };
    settle();
    for (;;) {
      run(["-i", dyn, "-map", "0:a:0", "-af", chain(), "-map_metadata", "-1", "-ar", "48000", ...encode, out], "the finished sound");
      got = loudnessOf(out);
      passes.push({ kind: "delivered", gainDb: r2(gain), limitDb: r2(limit), lufs: got.lufs, truePeak: got.truePeak });
      const loudOk = !loud || got.lufs == null || Math.abs(got.lufs - T.lufs) <= LUFS_TOLERANCE;
      const peakOk = got.truePeak == null || got.truePeak <= T.peakAccepted;
      if (loudOk && peakOk) break;
      if (!peakOk && peakFixes < PEAK_FIXES) { limit -= got.truePeak - T.truePeak; peakFixes++; settle(); continue; }
      if (!loudOk && !retried) { gain += T.lufs - got.lufs; retried = true; continue; }
      break;
    }
    const delivered = got;
    if (loud) {
      steps.push({
        id: "loudness", stage: "level",
        why: `Brought to ${f1(T.lufs)} LUFS ${mono ? "as one channel (it plays 3 LU louder on two speakers)" : "as played on two speakers"}, measured on the delivered file and corrected until within ${LUFS_TOLERANCE} LU: where the platforms play speech.`,
        gainDb: r2(preDb + gain), targetLufs: T.lufs,
      });
    }
    // what the limiter took off the loudness (the gain it was given against what came out) and
    // off the loudest peak (where it would have been against where it is)
    const limTaken = r1(dynLufs != null && delivered.lufs != null ? dynLufs + gain + (mono ? 0 : TWO_SPEAKERS_LU) - delivered.lufs : null);
    const peaksTaken = r1(dynPeak != null && delivered.truePeak != null ? Math.max(0, dynPeak + gain - delivered.truePeak) : null);
    steps.push({
      id: "limiter", stage: "level",
      why: `Its peaks held under ${f1(limit)} dB (at four times the sample rate, so that the peaks between the samples count) and the true peak measured after the encoding, which raises it${peakFixes ? `: lowered ${peakFixes === 1 ? "once" : "twice"} because the encoded file came over ${f1(T.peakAccepted)} dBTP` : ""}${peaksTaken != null && peaksTaken >= 0.5 ? `; it took ${f1(peaksTaken)} dB off the loudest peak${limTaken != null && limTaken >= 0.1 ? ` and ${f1(limTaken)} LU off the loudness` : ""}` : ""}.`,
      limitDb: r2(limit), loweredTimes: peakFixes, peaksTakenDb: peaksTaken, loudnessTakenLu: limTaken,
    });
    if (mode === "plain" && peaksTaken != null && peaksTaken > PLAIN_PEAKS_DB && (limTaken ?? 0) >= PLAIN_LOUDNESS_LU)
      left.push({ id: "peaks", stage: "level", why: `To reach ${f1(T.lufs)} LUFS the limiter took ${f1(peaksTaken)} dB off the loudest peaks and ${f1(limTaken)} LU off the loudness: the target is too loud for this recording's own dynamics, and the limiter may be heard on its loudest words; --level auto evens them first, a lower --loudness spares them.` });
    if (loud && delivered.lufs != null && Math.abs(delivered.lufs - T.lufs) > LUFS_TOLERANCE)
      left.push({ id: "loudness", stage: "level", why: `The loudness came to ${f1(delivered.lufs)} LUFS, not ${f1(T.lufs)}: ${delivered.truePeak != null && delivered.truePeak > T.truePeak - 0.5 ? "the limiter holds it down." : "the corrections did not converge."}` });
    if (delivered.truePeak != null && delivered.truePeak > T.peakAccepted)
      left.push({ id: "peak", stage: "level", why: `The true peak after the encoding is ${f1(delivered.truePeak)} dBTP, over the ${f1(T.peakAccepted)} dBTP a check accepts${peakFixes ? `, after the limiter was lowered ${peakFixes === 1 ? "once" : "twice"}` : ""}.` });
    if (auto && delivered.rangeLu != null && delivered.rangeLu > T.rangeLu)
      left.push({ id: "range", stage: "level", why: `The loudness range is ${f1(delivered.rangeLu)} LU, over the ${T.rangeLu} LU aimed at for a phone in a noisy place: the leveller corrects only phrases far off the middle, so that it is never heard pulling the voice around.` });
    if (mode === "off") skipped.push({ id: "level", why: "Level off: the recording's own dynamics and loudness are kept, only its peaks made safe." });
    return {
      mode, steps, left, skipped, before, delivered, passes,
      leveller: leveller && { needed: leveller.needed, spreadLu: leveller.spreadLu, spreadAfterLu: leveller.spreadAfterLu, minDb: leveller.minDb, maxDb: leveller.maxDb },
      settings: { targets: T, mono, level: mode, leveller: LEVELLER, compressor: COMPRESSOR, limiter: { ...LIMITER, limitDb: r2(limit), plainPeaksDb: PLAIN_PEAKS_DB, plainLoudnessLu: PLAIN_LOUDNESS_LU } },
    };
  } finally {
    if (ownTmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}
