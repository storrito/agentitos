// What is wrong with a recording of a voice, in numbers: the analysis under `voice.mjs measure`.
// It never turns a number into a verdict (lib/findings.mjs does, with its named thresholds), so
// the numbers stay the same when the thresholds are tuned.
//
//   facts(file)          ffprobe's facts of the file and its first audio stream; throws a
//                        Refusal (one sentence) for a missing file, one ffprobe cannot read, one
//                        without sound, a missing ffprobe
//   analyse(file, facts) → the measures (see the object `analyse` returns, at its end)
//
// One ffmpeg decodes the first audio stream once, streamed: ebur128 (peak=true) on the way, then
// at most two channels, resampled to 48 kHz (so every file is measured on one grid and a
// narrow-band source shows as an empty top), as 32-bit floats on stdout. One pass over them keeps
// per-frame summaries only, never the samples: a frame is 1024 samples (21.3 ms); its spectrum is
// a Hann window of 2048 samples ending with it, its mean taken out first (so a DC offset never
// shows as rumble). Per frame 31 band levels (Int16, 1/100 dB), the K- and the A-weighted power
// and the channels' powers and product; per 256 samples the K-weighted power (for the room's
// decay). That is about 100 bytes a frame: a three-hour podcast keeps about 50 MB. The hum's
// spectra (2.9 Hz a bin) are summed into 1-dB buckets of their level, and the clicks are found
// on the way, with 16 ms of the signal's second difference kept.
//
// Levels without a unit name are dB of the mean square against full scale (a full-scale sine is
// −3 dB); "LUFS" are BS.1770's K-weighted power, the channels summed, −0.691 dB, as ebur128 has
// it, but over the frames named (the speech, the pauses) instead of ebur128's gates.

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fftOf, split, hann } from "./fft.mjs";

export class Refusal extends Error {}
const refuse = (msg) => { throw new Refusal(msg); };

export const RATE = 48000;
export const HOP = 1024;                 // a frame, 21.3 ms
const WIN = 2048;                        // its spectrum's window: 23.4 Hz a bin
const SUB = 256;                         // the room's grid, 5.3 ms
const CLICK_BLOCK = 64;                  // the clicks' grid, 1.3 ms
const DECIM = 16;                        // the hum's signal at 3 kHz…
const HUM_N = 1024, HUM_HOP = 512;       // …in windows of 341 ms: 2.93 Hz a bin, 50 told from 60
export const FRAME_S = HOP / RATE;

// The bands every frame keeps, in Hz: fine enough at the bottom for rumble and thumps (<100 Hz),
// at the top for where a band-limited source ends (1 kHz steps to 12 kHz), and with the edges of
// the tone bands, the speech band and the sibilance band (5–9 kHz) among them.
export const EDGES = [0, 40, 60, 80, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 3500, 4000,
  5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 14000, 16000, 18000, 20000, 24000];
const NB = EDGES.length - 1;
const bandsIn = (lo, hi) => [...Array(NB).keys()].filter((b) => EDGES[b] >= lo && EDGES[b + 1] <= hi);
const SPEECH_BANDS = bandsIn(300, 3500);  // speech activity is read in 300–3500 Hz
const REF_BANDS = bandsIn(300, 3000);     // the tone's reference band
const THUMP_BANDS = bandsIn(0, 60);
const SIB_BANDS = bandsIn(5000, 9000);
export const TONE = [[0, 100], [100, 250], [250, 500], [500, 1000], [1000, 2000], [2000, 4000], [4000, 8000], [8000, 16000]];

// BS.1770-4's K-weighting at 48 kHz: a high shelf (+4 dB above 2 kHz) and the RLB high-pass
const K1 = { b0: 1.53512485958697, b1: -2.69169618940638, b2: 1.19839281085285, a1: -1.69065929318241, a2: 0.73248077421585 };
const K2 = { b0: 1, b1: -2, b2: 1, a1: -1.99004745483398, a2: 0.99007225036621 };
// the hum's anti-alias filter before keeping every 16th sample: 4th-order Butterworth at 900 Hz
// (a hum harmonic folded over 1500 Hz lands on the same 50 or 60 Hz grid, so it never fakes the other)
function lowpass(f, q) {
  const w = (2 * Math.PI * f) / RATE, alpha = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + alpha;
  return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - alpha) / a0 };
}
const L1 = lowpass(900, 0.5412), L2 = lowpass(900, 1.3066);

// ---------------------------------------------------------------- the file's facts (ffprobe)

export function facts(file) {
  // the path as given from here, or whole when it lies outside the working directory
  const relative = path.relative(process.cwd(), path.resolve(file));
  const name = relative && !relative.startsWith("..") ? relative : path.resolve(file);
  if (!fs.existsSync(file)) refuse(`There is no ${name}.`);
  if (fs.statSync(file).isDirectory()) refuse(`${name} is a folder: give the file of the recording.`);
  const r = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.error?.code === "ENOENT") refuse("ffprobe is missing: this tool needs ffmpeg on the PATH.");
  let j;
  try { j = JSON.parse(r.stdout); } catch { j = null; }
  if (r.status !== 0 || !j?.format) refuse(`${name} is no audio or video file ffmpeg can read.`);
  const streams = j.streams || [];
  const a = streams.find((s) => s.codec_type === "audio");
  if (!a) refuse(`${name} has no sound.`);
  const video = streams.some((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  // only whether a place is named, never where (a phone writes it into its file)
  const tagKeys = [j.format.tags, ...streams.map((s) => s.tags)].flatMap((t) => Object.keys(t || {}));
  const num = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : null);
  return {
    name,
    duration: num(a.duration) ?? num(j.format.duration),
    codec: a.codec_name || null,
    sampleRate: num(a.sample_rate),
    channels: num(a.channels),
    bitRate: num(a.bit_rate) ?? (video ? null : num(j.format.bit_rate)),
    video,
    placeInTags: tagKeys.some((k) => /location|gps|iso6709/i.test(k)),
  };
}

// ---------------------------------------------------------------- the pass over the samples

export async function analyse(file, f) {
  const C = Math.min(2, f.channels || 1);
  const st = state(C, f.duration);
  const args = ["-hide_banner", "-nostats", "-nostdin", "-i", file, "-map", "0:a:0",
    "-af", "ebur128=peak=true:framelog=verbose", "-ac", String(C), "-ar", String(RATE), "-f", "f32le", "pipe:1"];
  const p = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
  let tail = "";
  p.stderr.setEncoding("utf8");
  // only the end of ffmpeg's log is kept (the summary); it is never printed: it names the tags
  p.stderr.on("data", (s) => { tail = (tail + s).slice(-20000); });
  const frameBytes = HOP * C * 4;
  const stage = new Uint8Array(frameBytes);
  const f32 = new Float32Array(stage.buffer), u32 = new Uint32Array(stage.buffer);
  let fill = 0;
  p.stdout.on("data", (chunk) => {
    let off = 0;
    while (off < chunk.length) {
      const n = Math.min(frameBytes - fill, chunk.length - off);
      stage.set(chunk.subarray(off, off + n), fill);
      fill += n; off += n;
      if (fill === frameBytes) { frame(st, f32, u32, HOP); fill = 0; }
    }
  });
  const code = await new Promise((resolve) => {
    p.on("error", (e) => resolve(e.code === "ENOENT" ? "missing" : -1));
    p.on("close", resolve);
  });
  if (code === "missing") refuse("ffmpeg is missing: this tool needs ffmpeg on the PATH.");
  const rest = Math.floor(fill / (4 * C));
  if (rest > 0) { f32.fill(0, rest * C); frame(st, f32, u32, rest); }
  if (code !== 0 && st.samples === 0) refuse(`The sound of ${f.name} could not be decoded: check that it plays (ffprobe ${f.name}).`);
  finishClicks(st);
  return { ...summarise(st), loudness: ebur(tail) };
}

// ebur128's summary: integrated loudness, loudness range, true peak (the other skills' numbers)
function ebur(log) {
  const s = log.slice(log.lastIndexOf("Summary:"));
  const n = (re) => { const m = s.match(re); return m ? Number(m[1]) : null; };
  const fin = (x) => (Number.isFinite(x) && x > -200 ? x : null);
  return { integratedLufs: fin(n(/I:\s*(-?[\d.]+|-inf) LUFS/)), rangeLu: fin(n(/LRA:\s*(-?[\d.]+) LU/)), truePeakDb: fin(n(/Peak:\s*(-?[\d.]+|-inf) dBFS/)) };
}

function state(C, duration) {
  const frames = Math.ceil(((duration || 60) * RATE) / HOP) + 64;
  const fft = fftOf(WIN), humFft = fftOf(HUM_N);
  const w = hann(WIN), hw = hann(HUM_N);
  const sumW2 = w.reduce((s, x) => s + x * x, 0), humW2 = hw.reduce((s, x) => s + x * x, 0);
  const bandOf = new Uint8Array(WIN / 2).fill(255);
  for (let k = 1; k < WIN / 2; k++) {
    const hz = (k * RATE) / WIN;
    for (let b = 0; b < NB; b++) if (hz >= EDGES[b] && hz < EDGES[b + 1]) bandOf[k] = b;
  }
  // IEC 61672's A-weighting as a power weight per bin (0 dB at 1 kHz): how loud a faint noise is
  const aOf = Float64Array.from({ length: WIN / 2 }, (_, k) => {
    const f2 = ((k * RATE) / WIN) ** 2;
    const ra = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
    return (ra * 10 ** (2 / 20)) ** 2;
  });
  const humHz = RATE / DECIM / HUM_N;
  return {
    C, cap: frames, n: 0, samples: 0,
    bands: new Int16Array(frames * NB), kw: new Float32Array(frames), aw: new Float32Array(frames), sub: new Float32Array(frames * 4),
    // (the channels' powers and product only for two)
    e0: new Float32Array(C === 2 ? frames : 0), e1: new Float32Array(C === 2 ? frames : 0), c01: new Float32Array(C === 2 ? frames : 0),
    // per channel: K-weighting (4), the hum's low-pass (4), the clicks' last two samples (2)
    filt: [...Array(C)].map(() => new Float64Array(10)),
    dc: new Float64Array(C), prevBits: new Uint32Array(C), run: new Float64Array(C), prevBin: new Int32Array(C),
    hist: new Float64Array(32768), up: new Float64Array(32769), runHist: new Float64Array(32768), runSamples: new Float64Array(32768),
    win: [...Array(C)].map(() => new Float64Array(WIN)), re: new Float64Array(WIN), im: new Float64Array(WIN), w, sumW2, bandOf, aOf, fft,
    dec: [...Array(C)].map(() => new Float64Array(HUM_N)), decFill: 0, hw, humW2, humFft, hre: new Float64Array(HUM_N), him: new Float64Array(HUM_N),
    humLo: Math.ceil(300 / humHz), humHi: Math.floor(800 / humHz), humHz,
    // per half of the file (the first, the second), so that a hum is told to be steady
    humBuckets: [0, 1].map(() => new Float64Array(150 * (HUM_N / 2 + 1))), humCount: [0, 1].map(() => new Float64Array(150)), humFrames: 0,
    halfway: duration ? duration / 2 : Infinity,
    // the clicks: per 1.3 ms the largest |second difference| of any channel, kept for ±16 ms
    ring: new Float64Array(256), blocks: 0, checked: 0, clicks: [], clickCount: 0, bmax: new Float64Array(16),
  };
}

function grow(st) {
  const cap = st.cap * 2;
  const g = (a, k) => { const b = new a.constructor(cap * k); b.set(a); return b; };
  const two = st.C === 2 ? 1 : 0;
  Object.assign(st, { cap, bands: g(st.bands, NB), kw: g(st.kw, 1), aw: g(st.aw, 1), sub: g(st.sub, 4), e0: g(st.e0, two), e1: g(st.e1, two), c01: g(st.c01, two) });
}

const RUN_MIN_BIN = new Uint32Array(new Float32Array([0.01]).buffer)[0] >>> 16;   // runs count from −40 dBFS up

// One frame of `count` samples (interleaved, C channels): every per-sample measure in one loop
// per channel, then the frame's spectrum, then the hum's and the clicks' slower grids.
function frame(st, x, bits, count) {
  if (st.n >= st.cap) grow(st);
  const C = st.C, fi = st.n;
  let kwFrame = 0;
  const subAcc = [0, 0, 0, 0];
  st.bmax.fill(0);
  for (let c = 0; c < C; c++) {
    const s = st.filt[c];
    let k1a = s[0], k1b = s[1], k2a = s[2], k2b = s[3], l1a = s[4], l1b = s[5], l2a = s[6], l2b = s[7], xm1 = s[8], xm2 = s[9];
    let dc = 0, acc = 0, prevBits = st.prevBits[c], run = st.run[c], pb = st.prevBin[c];
    const hist = st.hist, up = st.up, runHist = st.runHist, runSamples = st.runSamples, win = st.win[c], dec = st.dec[c], bmax = st.bmax;
    win.copyWithin(0, HOP);
    const di = st.decFill;
    for (let i = 0; i < count; i++) {
      const v = x[i * C + c];
      win[HOP + i] = v;
      dc += v;
      // K-weighting (two biquads, transposed direct form II)
      const y1 = K1.b0 * v + k1a; k1a = K1.b1 * v - K1.a1 * y1 + k1b; k1b = K1.b2 * v - K1.a2 * y1;
      const y2 = y1 + k2a; k2a = -2 * y1 - K2.a1 * y2 + k2b; k2b = y1 - K2.a2 * y2;
      acc += y2 * y2;
      if ((i & 255) === 255) { subAcc[i >> 8] += acc; kwFrame += acc; acc = 0; }
      // the hum's signal: low-passed, every 16th sample
      const z1 = L1.b0 * v + l1a; l1a = L1.b1 * v - L1.a1 * z1 + l1b; l1b = L1.b2 * v - L1.a2 * z1;
      const z2 = L2.b0 * z1 + l2a; l2a = L2.b1 * z1 - L2.a1 * z2 + l2b; l2b = L2.b2 * z1 - L2.a2 * z2;
      if ((i & 15) === 15) dec[di + (i >> 4)] = z2;
      // the peaks' histogram: the float's top 16 bits (exponent and 7 bits of mantissa) are its
      // level in steps of 1/128 octave of amplitude (0.02–0.05 dB); `up` counts, for every level,
      // how often the signal rose to it from below (a difference array: O(1) a sample)
      const raw = bits[i * C + c], b = (raw & 0x7fffffff) >>> 16;
      hist[b]++;
      if (b > pb) { up[pb + 1]++; up[b + 1]--; }
      pb = b;
      // runs of the very same value (a ceiling the samples were stuck at), from 3 samples on
      if (raw === prevBits) run++;
      else {
        if (run >= 3) { const rb = (prevBits & 0x7fffffff) >>> 16; if (rb >= RUN_MIN_BIN) { runHist[rb]++; runSamples[rb] += run; } }
        run = 1; prevBits = raw;
      }
      // the clicks: |x[n−1] − (x[n−2] + x[n]) / 2|, the largest per 1.3 ms
      const d = Math.abs(xm1 - 0.5 * (xm2 + v));
      xm2 = xm1; xm1 = v;
      const blk = i >> 6;
      if (d > bmax[blk]) bmax[blk] = d;
    }
    if (count & 255) { subAcc[count >> 8] += acc; kwFrame += acc; }
    s[0] = k1a; s[1] = k1b; s[2] = k2a; s[3] = k2b; s[4] = l1a; s[5] = l1b; s[6] = l2a; s[7] = l2b; s[8] = xm1; s[9] = xm2;
    st.dc[c] += dc; st.prevBits[c] = prevBits; st.run[c] = run; st.prevBin[c] = pb;
    if (count < HOP) win.fill(0, HOP + count);
  }
  st.kw[fi] = kwFrame / count;
  for (let s = 0; s < 4; s++) { const n = Math.min(SUB, Math.max(0, count - s * SUB)); st.sub[fi * 4 + s] = n ? subAcc[s] / n : 0; }
  // the channels' powers and product (two channels)
  if (C === 2) {
    let a = 0, b = 0, ab = 0;
    for (let i = 0; i < count; i++) { const l = x[2 * i], r = x[2 * i + 1]; a += l * l; b += r * r; ab += l * r; }
    st.e0[fi] = a / count; st.e1[fi] = b / count; st.c01[fi] = ab / count;
  }
  spectrum(st, fi);
  st.decFill += count >> 4;
  if (st.decFill >= HUM_N) humFrame(st);
  // the clicks' blocks of this frame
  const nb = Math.ceil(count / CLICK_BLOCK);
  for (let k = 0; k < nb; k++) st.ring[(st.blocks + k) & 255] = st.bmax[k];
  st.blocks += nb;
  checkClicks(st, st.blocks - 13);
  st.samples += count;
  st.n++;
}

// The frame's power in each band: one complex FFT carries both channels (left real, right
// imaginary), each window's mean taken out; the power of bin k as its share of the mean square
// (Parseval, the Hann window's energy divided out), the channels averaged.
function spectrum(st, fi) {
  const { C, re, im, w, win, fft, bandOf, aOf } = st;
  const m0 = win[0].reduce((s, v) => s + v, 0) / WIN, m1 = C === 2 ? win[1].reduce((s, v) => s + v, 0) / WIN : 0;
  for (let i = 0; i < WIN; i++) { re[i] = (win[0][i] - m0) * w[i]; im[i] = C === 2 ? (win[1][i] - m1) * w[i] : 0; }
  fft(re, im);
  const norm = 2 / (WIN * st.sumW2) / C, band = new Float64Array(NB), two = [0, 0];
  let aw = 0;
  for (let k = 1; k < WIN / 2; k++) {
    const b = bandOf[k];
    if (b === 255) continue;
    let p;
    if (C === 2) { split(re, im, WIN, k, two); p = two[0] + two[1]; } else p = re[k] * re[k] + im[k] * im[k];
    band[b] += p * norm; aw += p * norm * aOf[k];
  }
  for (let b = 0; b < NB; b++) st.bands[fi * NB + b] = Math.max(-30000, Math.round(1000 * Math.log10(band[b] || 1e-300)));
  st.aw[fi] = aw;
}

// A window of the hum's 3 kHz signal: its power spectrum, added to the bucket of its level in
// 300–800 Hz (1 dB a bucket). The quietest buckets are the pauses; no frame needs keeping.
function humFrame(st) {
  const { C, dec, hre, him, hw, humFft } = st;
  const m0 = dec[0].reduce((s, v) => s + v, 0) / HUM_N, m1 = C === 2 ? dec[1].reduce((s, v) => s + v, 0) / HUM_N : 0;
  for (let i = 0; i < HUM_N; i++) { hre[i] = (dec[0][i] - m0) * hw[i]; him[i] = C === 2 ? (dec[1][i] - m1) * hw[i] : 0; }
  humFft(hre, him);
  const half = HUM_N / 2, p = new Float64Array(half + 1), norm = 2 / (HUM_N * st.humW2) / C, two = [0, 0];
  for (let k = 1; k <= half; k++) {
    if (C === 2) { split(hre, him, HUM_N, k, two); p[k] = (two[0] + two[1]) * norm; } else p[k] = (hre[k] * hre[k] + him[k] * him[k]) * norm;
  }
  let band = 0;
  for (let k = st.humLo; k <= st.humHi; k++) band += p[k];
  const q = Math.max(0, Math.min(149, Math.round(10 * Math.log10(band || 1e-300)) + 150));
  const at = q * (half + 1);
  const h = (st.humFrames * HUM_HOP * DECIM) / RATE < st.halfway ? 0 : 1;
  for (let k = 0; k <= half; k++) st.humBuckets[h][at + k] += p[k];
  st.humCount[h][q]++;
  st.humFrames++;
  for (let c = 0; c < C; c++) dec[c].copyWithin(0, HUM_HOP);
  st.decFill = HUM_N - HUM_HOP;
}

// A click: a block whose peak stands CLICK_OVER times over every block 2.7–16 ms before it and
// after it, and over −60 dBFS. Neighbours alike (a voice's glottal pulses, a fricative) are no
// click; a block next to it may share the click (a burst of up to 2.7 ms).
const CLICK_OVER = 6, CLICK_MIN = 1e-3, CLICK_SIDE = 12, CLICK_KEEP = 20000;
function checkClicks(st, upto) {
  const r = st.ring;
  for (; st.checked < upto; st.checked++) {
    const j = st.checked;
    if (j < CLICK_SIDE) continue;
    const v = r[j & 255];
    if (v < CLICK_MIN || v < r[(j - 1) & 255] || v <= r[(j + 1) & 255]) continue;
    let side = 0;
    for (let k = 2; k <= CLICK_SIDE; k++) side = Math.max(side, r[(j - k) & 255], j + k < st.blocks ? r[(j + k) & 255] : 0);
    if (v > CLICK_OVER * side) {
      st.clickCount++;
      if (st.clicks.length < CLICK_KEEP) st.clicks.push([j, 20 * Math.log10(v / Math.max(side, 1e-9))]);
    }
  }
}
function finishClicks(st) { checkClicks(st, st.blocks - 1); }

// ---------------------------------------------------------------- the measures, from the frames

const db = (p) => (p > 0 ? 10 * Math.log10(p) : -Infinity);
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const lufs = (p) => (p > 0 ? -0.691 + 10 * Math.log10(p) : -Infinity);
function quantile(values, q) {
  const a = Float64Array.from(values).sort();
  if (!a.length) return NaN;
  const i = (a.length - 1) * q, lo = Math.floor(i);
  return a[lo] + (a[Math.min(a.length - 1, lo + 1)] - a[lo]) * (i - lo);
}
const SILENT = 1e-15;                    // a frame under −150 dB in 300–3500 Hz is digital silence
// the values of a typed array at the frames `keep` says yes to, as a typed array
function where(a, keep) {
  let n = 0;
  for (let f = 0; f < a.length; f++) if (keep(f)) n++;
  const out = new Float64Array(n);
  for (let f = 0, i = 0; f < a.length; f++) if (keep(f)) out[i++] = a[f];
  return out;
}

function summarise(st) {
  const F = st.n, C = st.C, seconds = st.samples / RATE;
  const pw = (f, b) => 10 ** (st.bands[f * NB + b] / 1000);
  const sumBands = (f, list) => { let s = 0; for (const b of list) s += pw(f, b); return s; };
  // (typed arrays all through, never spread: a three-hour file has half a million frames)
  const Sp = new Float32Array(F), Tp = new Float32Array(F);
  for (let f = 0; f < F; f++) { Sp[f] = sumBands(f, SPEECH_BANDS); let t = 0; for (let b = 0; b < NB; b++) t += pw(f, b); Tp[f] = t; }
  const silent = Uint8Array.from(Sp, (p) => (p < SILENT ? 1 : 0));
  const silentFrames = silent.reduce((s, v) => s + v, 0);

  // 1. speech activity. The level in 300–3500 Hz, smoothed over 3 frames (64 ms). The floor:
  // the quietest moment of every 2 s (digital silence left out), the 10th percentile of those
  // over the file; near each moment, the median of the 2-s minima two windows either side, never
  // under the file's floor and at most 12 dB over it (a noise that changes, a level step). Speech:
  // the smoothed level over the floor there by a margin (9 dB, or half the distance from the
  // floor to the loud speech, the 95th percentile, when that is under 18 dB; at least 3 dB), in
  // runs of at least 3 frames (64 ms; a click is no syllable), held 2 frames before and 10 after
  // (213 ms). Where digital silence makes up 3 % or more, the pauses are that silence: speech is
  // then whatever lies within 40 dB of the loud speech.
  const S = new Float32Array(F);
  for (let f = 0; f < F; f++) S[f] = db((Sp[Math.max(0, f - 1)] + Sp[f] + Sp[Math.min(F - 1, f + 1)]) / 3);
  const W = Math.round(2 / FRAME_S), minima = [];
  for (let w = 0; w * W < F; w++) {
    let m = Infinity, n = 0;
    for (let f = w * W; f < Math.min(F, (w + 1) * W); f++) if (!silent[f]) { n++; m = Math.min(m, S[f]); }
    minima.push(n >= W / 4 ? m : NaN);
  }
  const valid = minima.filter(Number.isFinite);
  const loud = quantile(where(S, (f) => !silent[f]), 0.95);
  const digital = silentFrames / Math.max(1, F) >= 0.03;
  let floor = valid.length >= 5 ? quantile(valid, 0.1) : valid.length ? Math.min(...valid) : NaN;
  if (digital) floor = Math.min(Number.isFinite(floor) ? floor : Infinity, loud - 40 - 9);
  const margin = Number.isFinite(floor) ? Math.max(3, Math.min(9, (loud - floor) / 2)) : 0;
  const localOf = minima.map((_, w) => {
    const near = minima.slice(Math.max(0, w - 2), w + 3).filter(Number.isFinite);
    const m = near.length ? quantile(near, 0.5) : NaN;
    return digital || !Number.isFinite(m) ? floor : Math.min(floor + 12, Math.max(floor, m));
  });
  const floorAt = (f) => {
    const x = f / W - 0.5, w0 = Math.max(0, Math.floor(x)), w1 = Math.min(localOf.length - 1, w0 + 1), t = Math.min(1, Math.max(0, x - w0));
    return localOf[w0] * (1 - t) + localOf[w1] * t;
  };
  const active = new Uint8Array(F);
  if (Number.isFinite(floor)) for (let f = 0; f < F; f++) active[f] = !silent[f] && S[f] > floorAt(f) + margin ? 1 : 0;
  for (let f = 0; f < F;) {
    if (!active[f]) { f++; continue; }
    let e = f; while (e < F && active[e]) e++;
    if (e - f < 3) active.fill(0, f, e);
    f = e;
  }
  const speech = new Uint8Array(F);
  for (let f = 0; f < F; f++) if (active[f]) for (let k = Math.max(0, f - 2); k <= Math.min(F - 1, f + 10); k++) speech[k] = 1;
  for (let f = 0; f < F; f++) if (silent[f]) speech[f] = 0;
  // quiet frames: not speech, not digital silence, at most 6 dB over the floor there
  const quiet = new Uint8Array(F);
  for (let f = 0; f < F; f++) quiet[f] = !speech[f] && !silent[f] && S[f] <= floorAt(f) + 6 ? 1 : 0;
  const count = (a) => a.reduce((s, v) => s + v, 0);
  const speechFrames = count(speech), quietFrames = count(quiet);

  // the stretches without speech, longest first (where to take a noise profile from)
  const stretches = [];
  for (let f = 0; f < F;) {
    if (speech[f]) { f++; continue; }
    let e = f; while (e < F && !speech[e]) e++;
    let p = 0, k = 0, sil = 0;
    for (let g = f; g < e; g++) { p += Tp[g]; k += st.kw[g]; sil += silent[g]; }
    stretches.push({ from: f, to: e, p: p / (e - f), k: k / (e - f), silent: sil === e - f });
    f = e;
  }
  const long = stretches.filter((s) => (s.to - s.from) * FRAME_S >= 0.3);
  const confidence = digital ? (quietFrames * FRAME_S >= 2 ? "medium" : "silent pauses")
    : quietFrames * FRAME_S < 2 || quietFrames / Math.max(1, F) < 0.03 ? "low" : quietFrames * FRAME_S < 10 || long.length < 5 ? "medium" : "high";
  const t = (f) => r2(f * FRAME_S);

  // 2. levels. Speech: the LUFS of the speech frames; noise: of the quiet frames; their
  // distance is the signal-to-noise ratio, the noise's power taken out of the speech frames'
  // first. The same A-weighted (snrADb: how audible a faint noise is; K-weighting lets rumble
  // under 40 Hz through), in 300–3500 Hz alone (snrBandDb) and unweighted over the whole band
  // (snrFlatDb, 12 Hz – 24 kHz, comparable with an SNR of raw power: real noise often has half its
  // power under 40 Hz, which is hardly heard).
  const meanOver = (arr, mask) => { let s = 0, n = 0; for (let f = 0; f < F; f++) if (mask[f]) { s += arr[f]; n++; } return n ? s / n : NaN; };
  const speechKw = meanOver(st.kw, speech), noiseKw = meanOver(st.kw, quiet);
  const speechSp = meanOver(Sp, speech), noiseSp = meanOver(Sp, quiet);
  const speechA = meanOver(st.aw, speech), noiseA = meanOver(st.aw, quiet);
  const flat = Tp;
  const speechFlat = meanOver(flat, speech), noiseFlat = meanOver(flat, quiet);
  const snr = (s, n) => (n > 0 && s > n ? db((s - n) / n) : n > 0 ? -Infinity : null);
  // the phrases: windows of 3 s with at least 1 s of speech, each the LUFS of its speech frames;
  // the spread is the 90th minus the 10th percentile; drift: a straight line through them (LU a
  // minute); step: the one split (at least 3 windows a side) that parts them most, its size, and
  // how far each model leaves the windows on average (residualLu, RMS)
  const PW = Math.round(3 / FRAME_S), phrases = [];
  for (let w = 0; w * PW < F; w++) {
    let s = 0, n = 0;
    for (let f = w * PW; f < Math.min(F, (w + 1) * PW); f++) if (speech[f]) { s += st.kw[f]; n++; }
    if (n * FRAME_S >= 1 && s > 0) phrases.push({ t: (w + 0.5) * PW * FRAME_S, lu: lufs(s / n), from: w * PW * FRAME_S });
  }
  const lv = phrases.map((p) => p.lu);
  let drift = null, step = null;
  if (phrases.length >= 6) {
    const n = phrases.length, mt = phrases.reduce((s, p) => s + p.t, 0) / n, ml = lv.reduce((s, v) => s + v, 0) / n;
    let sxy = 0, sxx = 0;
    for (const p of phrases) { sxy += (p.t - mt) * (p.lu - ml); sxx += (p.t - mt) ** 2; }
    const slope = sxx ? sxy / sxx : 0;
    const resD = Math.sqrt(phrases.reduce((s, p) => s + (p.lu - (ml + slope * (p.t - mt))) ** 2, 0) / n);
    drift = { luPerMinute: r2(slope * 60), totalLu: r1(slope * (phrases[n - 1].t - phrases[0].t)), residualLu: r2(resD) };
    let best = null;
    for (let k = 3; k <= n - 3; k++) {
      const a = lv.slice(0, k), b = lv.slice(k);
      const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
      const score = Math.abs(mb - ma) * Math.sqrt((a.length * b.length) / n);
      if (!best || score > best.score) {
        const res = Math.sqrt((a.reduce((s, v) => s + (v - ma) ** 2, 0) + b.reduce((s, v) => s + (v - mb) ** 2, 0)) / n);
        best = { score, at: phrases[k].from, lu: mb - ma, before: ma, after: mb, res };
      }
    }
    step = { at: r2(best.at), lu: r1(best.lu), beforeLufs: r1(best.before), afterLufs: r1(best.after), residualLu: r2(best.res) };
  }
  const levels = {
    speechLufs: r1(lufs(speechKw)), noiseLufs: r1(lufs(noiseKw)),
    snrDb: r1(snr(speechKw, noiseKw)), snrADb: r1(snr(speechA, noiseA)), snrBandDb: r1(snr(speechSp, noiseSp)), snrFlatDb: r1(snr(speechFlat, noiseFlat)),
    phrases: { windows: phrases.length, spreadLu: phrases.length >= 3 ? r1(quantile(lv, 0.9) - quantile(lv, 0.1)) : null, quietLufs: r1(quantile(lv, 0.1)), loudLufs: r1(quantile(lv, 0.9)) },
    drift, step,
  };

  // per-band mean power over a mask of frames
  const bandMean = (mask) => {
    const out = new Float64Array(NB); let n = 0;
    for (let f = 0; f < F; f++) if (mask[f]) { n++; for (let b = 0; b < NB; b++) out[b] += pw(f, b); }
    if (n) for (let b = 0; b < NB; b++) out[b] /= n;
    return n ? out : null;
  };
  const speechBands = bandMean(speech), quietBands = bandMean(quiet);

  // 3. the noise in the pauses: its level per band (quiet frames, dB); how it moves: within the
  // stretches without speech of at least 0.3 s, the spread of the frames' levels around their
  // stretch's mean (fluctuationDb, pooled standard deviation: keyboard, voices, traffic) and of
  // the stretches' means (spreadDb, 90th − 10th percentile: a noise that comes and goes); its
  // shape: per octave 125 Hz – 16 kHz (up to where the speech ends), the slope of the level
  // (tiltDbPerOctave: white noise +3, pink 0), the share of its power below 125 Hz (lowDb) and
  // above 4 kHz (highDb), in dB of the whole
  let noise = null;
  if (quietBands) {
    let within = 0, wn = 0;
    const means = [];
    for (const s of long) {
      if (s.silent) continue;
      const v = [];
      for (let f = s.from; f < s.to; f++) if (!silent[f]) v.push(db(Tp[f]));
      if (v.length < 5) continue;
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      within += v.reduce((a, b) => a + (b - m) ** 2, 0); wn += v.length - 1;
      means.push(db(s.p));
    }
    const total = quietBands.reduce((a, b) => a + b, 0);
    const part = (lo, hi) => bandsIn(lo, hi).reduce((a, b) => a + quietBands[b], 0);
    noise = {
      lufs: levels.noiseLufs, seconds: r1(quietFrames * FRAME_S),
      bands: [...Array(NB).keys()].map((b) => ({ lo: EDGES[b], hi: EDGES[b + 1], db: r1(db(quietBands[b])) })),
      fluctuationDb: wn ? r2(Math.sqrt(within / wn)) : null,
      spreadDb: means.length >= 3 ? r1(quantile(means, 0.9) - quantile(means, 0.1)) : null,
      tiltDbPerOctave: null, lowDb: r1(db(part(0, 125) / total)), highDb: r1(db(part(4000, 24000) / total)),
    };
    noise.octaves = [[125, 250], [250, 500], [500, 1000], [1000, 2000], [2000, 4000], [4000, 8000], [8000, 16000]];
  }

  const fine = fineOf(st);
  // 4. hum: the fine spectrum of the pauses (fineOf). Per harmonic n of 50 and of 60 Hz (n·f up
  // to 720 Hz): the power of the three bins around the largest within ±1 bin of n·f, against
  // three times the median bin 3–8 bins (9–23 Hz) either side (overDb): mains hum is a line, a
  // voice's harmonics averaged over many windows are broad; where both halves of the file have
  // pauses, the half where it stands out less (steadyChecked). A harmonic counts at 6 dB over;
  // the mains frequency is the one with more over its surroundings in the harmonics the two do
  // not share (300 Hz and its multiples). levelDb: the power of the counted harmonics over their
  // surroundings; underSpeechDb: under the speech frames' whole power.
  const hum = humOf(fine, speechBands ? speechBands.reduce((a, b) => a + b, 0) : NaN);

  // 7. bandwidth: a band carries the voice when the speech has at least twice the pauses' power
  // in it (3 dB) and its power density (a Hz) minus the pauses' lies within 50 dB of the densest
  // band in 200–4000 Hz; the top is the upper edge of the last band, going up from 1 kHz, that
  // still carries it. The bottom, the same going down from 300 Hz in the fine spectra (bands of
  // 20–40, 40–60, 60–80, 80–100, 100–125, 125–150, 150–200, 200–250, 250–300 Hz), within 30 dB
  // of their densest band in 200–750 Hz: its lower edge.
  let bandwidth = { topHz: null, bottomHz: null, cliffDb: null };
  if (speechBands) {
    const own = (b) => Math.max(0, speechBands[b] - (quietBands ? quietBands[b] : 0));
    const dens = (b) => own(b) / (EDGES[b + 1] - EDGES[b]);
    const ref = Math.max(...bandsIn(200, 4000).map(dens));
    const carries = (b, drop) => ref > 0 && dens(b) >= ref * 10 ** (-drop / 10) && (!quietBands || speechBands[b] >= 2 * quietBands[b]);
    let top = EDGES.indexOf(1000); while (top + 1 < NB && carries(top + 1, 50)) top++;
    bandwidth.topHz = carries(EDGES.indexOf(1000), 50) ? EDGES[top + 1] : null;
    // how steeply it ends: the density of the last band that carries the voice over the band
    // two above it (a resampled source falls by 40 dB and more there, a low-pass filter or a
    // dull microphone by 10 to 20)
    const above = Math.min(NB - 1, top + 2);
    bandwidth.cliffDb = bandwidth.topHz && above > top ? r1(Math.min(99, db(dens(top) / Math.max(dens(above), ref * 1e-12)))) : null;
  }
  if (fine) {
    const LOWS = [20, 40, 60, 80, 100, 125, 150, 200, 250, 300, 400, 500, 750];
    const sp = (i) => fine.band(fine.speech, LOWS[i], LOWS[i + 1]), pa = (i) => fine.band(fine.pause, LOWS[i], LOWS[i + 1]);
    const dens = (i) => Math.max(0, sp(i) - pa(i)) / (LOWS[i + 1] - LOWS[i]);
    const ref = Math.max(...[7, 8, 9, 10, 11].map(dens));
    const carries = (i) => ref > 0 && dens(i) >= ref * 1e-3 && sp(i) >= 2 * pa(i);
    let bot = 9; while (bot - 1 >= 0 && carries(bot - 1)) bot--;
    bandwidth.bottomHz = carries(9) ? LOWS[bot] : null;
  }
  if (noise) {
    const oct = noise.octaves.filter(([, hi]) => !bandwidth.topHz || hi <= Math.max(bandwidth.topHz, 4000));
    const lv2 = oct.map(([lo, hi]) => db(bandsIn(lo, hi).reduce((a, b) => a + quietBands[b], 0)));
    if (oct.length >= 3 && lv2.every(Number.isFinite)) {
      const n = lv2.length, mx = (n - 1) / 2, my = lv2.reduce((a, b) => a + b, 0) / n;
      noise.tiltDbPerOctave = r1(lv2.reduce((s, y, i) => s + (i - mx) * (y - my), 0) / lv2.reduce((s, _, i) => s + (i - mx) ** 2, 0));
    }
    delete noise.octaves;
  }

  // 8. tone: the speech frames' long-term spectrum (the pauses' power taken out) in the tone
  // bands, each in dB against its 300–3000 Hz band, beside the same for the reference (ANSI)
  let tone = null;
  if (speechBands) {
    const own = (b) => Math.max(speechBands[b] - (quietBands ? quietBands[b] : 0), speechBands[b] * 0.01);
    const refP = REF_BANDS.reduce((a, b) => a + own(b), 0);
    const bands = TONE.map(([lo, hi], i) => {
      const p = bandsIn(lo, hi).reduce((a, b) => a + own(b), 0), d = db(p / refP), ref = REFERENCE[i];
      return { lo, hi, db: r1(d), reference: ref == null ? null : r1(ref), diff: ref == null || !Number.isFinite(d) ? null : r1(d - ref) };
    });
    const diffOf = (lo) => bands.find((b) => b.lo === lo).diff;
    // sibilance: the 5–9 kHz power of the loudest 2 % of the speech frames there, against the
    // whole power of the voiced frames (speech frames whose 300–3000 Hz power is over their
    // 5–9 kHz power)
    const sib = new Float64Array(speechFrames);
    let ns = 0, vSum = 0, nv = 0;
    for (let f = 0; f < F; f++) {
      if (!speech[f]) continue;
      const s = sumBands(f, SIB_BANDS);
      sib[ns++] = s;
      if (sumBands(f, REF_BANDS) > s) { vSum += Tp[f]; nv++; }
    }
    sib.sort().reverse();
    const top = sib.subarray(0, Math.max(1, Math.round(ns * 0.02)));
    const vMean = vSum / Math.max(1, nv), voiced = { length: nv };
    tone = {
      reference: "ANSI S3.5-1997 table 3, normal vocal effort (male and female talkers together)",
      bands,
      lowDiff: r1(mean([diffOf(100), diffOf(250)])), highDiff: r1(mean([diffOf(2000), diffOf(4000)])), presenceDiff: diffOf(2000),
      sibilanceDb: voiced.length && top.length ? r1(db(top.reduce((a, b) => a + b, 0) / top.length / vMean)) : null,
    };
  }

  // 9. low frequencies: the power below 80 Hz against 300–3000 Hz, in the speech frames and in
  // the pauses (against the speech's 300–3000 Hz); thumps: frames whose power below 60 Hz (a
  // voice's fundamental under 100 Hz leaks into 60–100 Hz of a frame's 23 Hz bins) is 15 dB over
  // its median in the speech frames, more than half the frame's power and within 20 dB of the
  // speech frames' mean power (heard beside the voice), in runs up to 320 ms (longer runs are
  // bursts: wind, a rumble that comes and goes)
  let low = null;
  if (speechBands) {
    const sum = (bands, list) => list.reduce((a, b) => a + bands[b], 0);
    const ref = sum(speechBands, REF_BANDS);
    const lf = new Float32Array(F);
    for (let f = 0; f < F; f++) lf[f] = sumBands(f, THUMP_BANDS);
    const med = quantile(where(lf, (f) => speech[f]), 0.5), loudness = meanOver(Tp, speech);
    const hit = new Uint8Array(F);
    for (let f = 0; f < F; f++) hit[f] = !silent[f] && lf[f] > med * 10 ** 1.5 && lf[f] > 0.5 * Tp[f] && lf[f] >= loudness * 0.01 ? 1 : 0;
    const thumps = [];
    let bursts = 0;
    for (let f = 0; f < F;) {
      if (!hit[f]) { f++; continue; }
      let e = f; while (e < F && hit[e]) e++;
      if (e - f <= 15) thumps.push(t(f)); else bursts++;
      f = e;
    }
    // (below 80 Hz from the fine spectra, against their 300–750 Hz, carried over to 300–3000 Hz
    // by the speech frames' own ratio of the two)
    const carry = db(sum(speechBands, bandsIn(300, 750)) / ref), mid = fine ? fine.band(fine.speech, 300, 750) : 0;
    low = {
      below80Db: mid > 0 ? r1(db(fine.band(fine.speech, 20, 80, hum?.hz) / mid) + carry) : null,
      pauses80Db: mid > 0 && fine.from === "pauses" ? r1(db(fine.band(fine.pause, 20, 80, hum?.hz) / mid) + carry) : null,
      thumps: { count: thumps.length, perMinute: r2(thumps.length / Math.max(seconds / 60, 1 / 60)), at: thumps.slice(0, 10) }, bursts,
    };
  }

  // 5. clipping: from the histogram of the samples' levels. The ceiling: the level within 6 dB
  // under the peak (resampling a file clipped hard at 44.1 kHz overshoots its ceiling by 3 dB)
  // where the samples pile up most against a stretch under it (pileUp: samples a
  // dB within ±0.1 dB of it over samples a dB 1–3 dB under it, or within ±0.5 dB over 1.5–4 dB
  // under, whichever is more); without a pile-up (pileUp ≤ 1) it is the peak. share: the samples
  // from twice that half width under the ceiling up (0.2 dB without a pile-up); runs: how often
  // the signal rose to there. exactShare and exactRuns: runs of 3 or more samples of the very
  // same value within 0.1 dB of the peak (PCM clipped, decoded unchanged).
  const clipping = clippingOf(st);

  // 6. DC: each channel's mean sample
  const dcs = [...st.dc].map((s) => s / Math.max(1, st.samples));
  const dcMax = Math.max(...dcs.map(Math.abs));

  // 10. clicks (found in the pass): how many, a minute, how many in the pauses, the strongest
  const clickFrames = st.clicks.map(([j, d]) => ({ t: (j * CLICK_BLOCK) / RATE, overDb: d }));
  const inPauses = clickFrames.filter((c) => !speech[Math.min(F - 1, Math.floor(c.t / FRAME_S))]).length;
  // (over: how many stand at least 20, 30, 40 dB over their neighbourhood; a plosive's release
  // in a quiet room stands 15 to 25 dB over it)
  const over = Object.fromEntries([20, 30, 40].map((d) => [d, clickFrames.filter((c) => c.overDb >= d).length]));
  const clicks = {
    count: st.clickCount, perMinute: r2(st.clickCount / Math.max(seconds / 60, 1 / 60)), inPauses, over,
    at: [...clickFrames].sort((a, b) => b.overDb - a.overDb).slice(0, 10).map((c) => ({ t: r3(c.t), overDb: r1(c.overDb) })),
  };

  // 11. two channels, over the speech frames (all frames when there is none), the mean taken
  // out: correlation; level difference (left minus right); monoLossDb, the power of the mono mix
  // (L+R)/2 against the channels' mean power (0 the same signal, −3 unrelated, very low: one is
  // the other inverted, a mono mix cancels); identical: correlation ≥ 0.9999 and levels within
  // 0.01 dB; silentChannel: one under −140 dB
  let channels = null;
  if (C === 2) {
    const mask = speechFrames ? speech : Uint8Array.from({ length: F }, () => 1);
    const e0 = meanOver(st.e0, mask) - dcs[0] ** 2, e1 = meanOver(st.e1, mask) - dcs[1] ** 2, c01 = meanOver(st.c01, mask) - dcs[0] * dcs[1];
    const corr = e0 > 0 && e1 > 0 ? c01 / Math.sqrt(e0 * e1) : null;
    const mono = (e0 + e1 + 2 * c01) / (2 * (e0 + e1));
    channels = {
      correlation: r3(corr), levelDifferenceDb: e0 > 0 && e1 > 0 ? r1(db(e0 / e1)) : null,
      monoLossDb: e0 + e1 > 0 ? r1(Math.max(-99, db(Math.max(mono, 1e-10)))) : null,
      identical: corr != null && corr >= 0.9999 && Math.abs(db(e0 / e1)) < 0.01,
      silentChannel: e0 < 1e-14 && e1 >= 1e-14 ? "left" : e1 < 1e-14 && e0 >= 1e-14 ? "right" : null,
    };
  }

  // 12. the room: free decays of the K-weighted level on the 5.3 ms grid (three blocks together):
  // from every peak 20 dB or more over the floor, as long as the level keeps falling (a rise of
  // 1.5 dB ends it: the voice again), down to 5 dB over the floor, at most 1.5 s. From 5 dB under
  // the peak on, a straight line (at least 4 points over 10 dB, r² ≥ 0.8); its slope as a decay
  // of 60 dB (rt60). The estimate is the 25th percentile of those: a voice that fades decays
  // slower than the room, never faster. rangeDb: the median dB a decay was fitted over.
  const room = roomOf(st, F, lufs(noiseKw) + 0.691, speechKw);

  return {
    seconds: r2(seconds), channelsAnalysed: C,
    speech: {
      share: r3(speechFrames / Math.max(1, F)), seconds: r1(speechFrames * FRAME_S), silentShare: r3(silentFrames / Math.max(1, F)),
      floorDb: r1(floor), marginDb: r1(margin), loudDb: r1(loud), confidence,
      pauses: { count: long.length, seconds: r1(long.reduce((a, s) => a + (s.to - s.from), 0) * FRAME_S) },
      longest: [...long].sort((a, b) => b.to - b.from - (a.to - a.from)).slice(0, 5)
        .map((s) => ({ from: t(s.from), to: t(s.to), seconds: r2((s.to - s.from) * FRAME_S), db: r1(db(s.p)), lufs: r1(lufs(s.k)), silent: s.silent })),
    },
    levels, noise, hum, clipping,
    dc: { values: dcs.map((v) => r3(v) === 0 ? Number(v.toExponential(2)) : r3(v)), db: r1(20 * Math.log10(dcMax || 1e-12)) },
    bandwidth, tone, low, clicks, channels, room,
  };
}
const mean = (a) => { const v = a.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };

// The reference: ANSI S3.5-1997 (R2017), table 3, "normal" vocal effort: the standard speech
// spectrum level (dB a Hz) in one-third-octave bands 160 Hz – 8 kHz, of male and female talkers
// together. Each tone band's power is its density times the overlap of each third-octave band;
// 100–141 Hz takes the 160 Hz band's density; under 100 Hz and over 8 kHz the table says nothing.
const ANSI_HZ = [160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000];
const ANSI_DB = [32.41, 34.48, 34.75, 33.98, 34.59, 34.27, 32.06, 28.30, 25.01, 23.00, 20.15, 17.32, 13.18, 11.55, 9.33, 5.31, 2.59, 1.13];
function ansiPower(lo, hi) {
  let p = 0;
  ANSI_HZ.forEach((fc, i) => {
    const a = i === 0 ? 100 : fc * 2 ** (-1 / 6), b = fc * 2 ** (1 / 6);
    p += 10 ** (ANSI_DB[i] / 10) * Math.max(0, Math.min(b, hi) - Math.max(a, lo));
  });
  return p;
}
const REFERENCE = TONE.map(([lo, hi]) => (lo < 100 || hi > 8000 ? null : 10 * Math.log10(ansiPower(lo, hi) / ansiPower(300, 3000))));

// The fine spectra (2.9 Hz a bin, up to 900 Hz) of the hum's windows: the pauses' (the buckets up
// to 3 dB over the 5th percentile of their level in 300–800 Hz; when they are fewer than 4
// windows, up to 2 dB over the 20th; else all), the same for each half of the file, and the
// speech's (the buckets from the median up). The low end is read here: the frames' 23 Hz bins
// leak a low voice's fundamental under 80 Hz. band(P, lo, hi, hum): the power in lo–hi, without
// the bins within 2 of the multiples of `hum` Hz (their share filled in from the other bins).
function fineOf(st) {
  const half = HUM_N / 2, [c0, c1] = st.humCount;
  if (!st.humFrames) return null;
  const counts = c0.map((n, q) => n + c1[q]);
  const levels = [];
  counts.forEach((n, q) => { for (let i = 0; i < n; i++) levels.push(q); });
  const p5 = quantile(levels, 0.05), p20 = quantile(levels, 0.2), p50 = quantile(levels, 0.5);
  const sum = (use, halves = [0, 1]) => {
    const P = new Float64Array(half + 1);
    let n = 0;
    for (const h of halves) for (const q of use) {
      n += st.humCount[h][q];
      for (let k = 0; k <= half; k++) P[k] += st.humBuckets[h][q * (half + 1) + k];
    }
    if (n) for (let k = 0; k <= half; k++) P[k] /= n;
    return { P, n };
  };
  const all = [...counts.keys()].filter((q) => counts[q]);
  let use = all.filter((q) => q <= p5 + 3), from = "pauses";
  if (sum(use).n < 4) use = all.filter((q) => q <= p20 + 2);
  if (sum(use).n < 4) { use = all; from = "all"; }
  const pause = sum(use), a = sum(use, [0]), b = sum(use, [1]);
  const speech = sum(all.filter((q) => q >= p50));
  const df = st.humHz;
  const band = (P, lo, hi, hum) => {
    let s = 0, n = 0, used = 0;
    for (let k = Math.max(1, Math.ceil(lo / df)); k * df < hi && k <= half; k++) {
      n++;
      if (hum && Math.abs(k * df - Math.round((k * df) / hum) * hum) <= 2 * df) continue;
      s += P[k]; used++;
    }
    return used ? (s * n) / used : 0;
  };
  return { pause: pause.P, halves: from === "pauses" && a.n >= 4 && b.n >= 4 ? [a.P, b.P] : null, speech: speech.P, from, df, band };
}

function humOf(fine, speechPower) {
  if (!fine) return null;
  const half = HUM_N / 2, df = fine.df, from = fine.from;
  // over its surroundings in the whole file's pauses, and where both halves have pauses, in the
  // half where it stands out less: mains hum is steady, a voice's held pitch in a reverberant
  // pause is not
  const harmonics = (base) => {
    const all = lines(fine.pause, base);
    if (!fine.halves) return all;
    const [a, b] = fine.halves.map((P) => lines(P, base));
    return all.map((x, i) => ({ ...x, overDb: r1(Math.min(a[i].overDb, b[i].overDb)) }));
  };
  const lines = (P, base) => {
    const out = [];
    for (let h = 1; h * base <= 720; h++) {
      const kc = Math.round((h * base) / df);
      let km = kc;
      for (let k = kc - 1; k <= kc + 1; k++) if (P[k] > P[km]) km = k;
      const peak = P[km - 1] + P[km] + P[km + 1];
      const side = [];
      for (let d = 3; d <= 8; d++) { if (km - d > 0) side.push(P[km - d]); if (km + d <= half) side.push(P[km + d]); }
      const around = 3 * quantile(side, 0.5);
      out.push({ n: h, hz: h * base, overDb: r1(db(peak / around)), excess: Math.max(0, peak - around), shared: (h * base) % 300 === 0 });
    }
    return out;
  };
  const at50 = harmonics(50), at60 = harmonics(60);
  const score = (hs) => hs.filter((x) => !x.shared).reduce((a, x) => a + Math.max(0, x.overDb - 3), 0);
  const counted = (hs) => hs.filter((x) => x.overDb >= 6);
  const pick = score(at50) >= score(at60) ? [50, at50] : [60, at60];
  const hs = pick[1], c = counted(hs);
  const unshared = c.filter((x) => !x.shared);
  const excess = c.reduce((a, x) => a + x.excess, 0);
  const strip = (list) => list.map(({ n, hz, overDb }) => ({ n, hz, overDb }));
  return {
    hz: unshared.length ? pick[0] : null, harmonics: unshared.length ? c.length : 0, overDb: r1(Math.max(...hs.map((x) => x.overDb))),
    levelDb: excess > 0 ? r1(db(excess)) : null, underSpeechDb: excess > 0 && speechPower > 0 ? r1(db(speechPower / excess)) : null,
    from, steadyChecked: !!fine.halves, at50: strip(at50), at60: strip(at60),
  };
}

function clippingOf(st) {
  const H = st.hist;
  let M = 0;
  for (let b = 0; b < 32768; b++) if (H[b] && b < 0x7f80) M = b;     // the top (no inf, no NaN)
  const total = st.samples * st.C;
  if (!M) return { peakDb: null, ceilingDb: null, pileUp: null, share: 0, runs: 0, exactShare: 0, exactRuns: 0 };
  const value = (b) => new Float32Array(new Uint32Array([b << 16]).buffer)[0];
  const binOf = (dbfs) => new Uint32Array(new Float32Array([10 ** (dbfs / 20)]).buffer)[0] >>> 16;
  const peak = 20 * Math.log10(value(M + 1));
  const cnt = (lo, hi) => { let s = 0; for (let b = binOf(lo); b < Math.min(32768, binOf(hi)); b++) s += H[b]; return s; };
  // narrow: ±0.1 dB against 1–3 dB under (PCM, a ceiling exact to the sample); wide: ±0.5 dB
  // against 1.5–4 dB under (a lossy codec or a resampler rings around the ceiling)
  let best = { c: peak, ratio: 0, half: 0.1 };
  for (const [half, a, b] of [[0.1, 1, 3], [0.5, 1.5, 4]]) {
    for (let c = peak - 6; c <= peak + 1e-9; c += 0.05) {
      const below = cnt(c - b, c - a) / (b - a);
      const ratio = below > 0 ? (cnt(c - half, c + half) / (2 * half)) / below : 0;
      if (ratio > best.ratio) best = { c, ratio, half };
    }
  }
  const ceiling = best.ratio > 1 ? best.c : peak;
  const from = binOf(ceiling - (best.ratio > 1 ? 2 * best.half : 0.2));
  let share = 0, ups = 0;
  for (let b = from; b <= M; b++) share += H[b];
  for (let b = 0; b <= from; b++) ups += st.up[b];
  let ex = 0, exRuns = 0;
  for (let b = binOf(peak - 0.1); b <= M; b++) { ex += st.runSamples[b]; exRuns += st.runHist[b]; }
  return {
    peakDb: r2(peak), ceilingDb: r2(ceiling), pileUp: r2(best.ratio),
    share: Number((share / total).toPrecision(3)), runs: ups,
    exactShare: Number((ex / total).toPrecision(3)), exactRuns: exRuns,
  };
}

function roomOf(st, F, floorDb, speechKw) {
  const sub = st.sub, nSub = F * 4;
  // (five blocks together, 27 ms: a voice's pitch periods and a reverberant tail's beating
  // ripple a single block's level)
  const L = (i) => { let s = 0; for (let k = i - 2; k <= i + 2; k++) s += sub[Math.max(0, Math.min(nSub - 1, k))]; return 10 * Math.log10(s / 5 || 1e-30); };
  const floor = Number.isFinite(floorDb) ? floorDb : 10 * Math.log10(speechKw || 1e-30) - 60;
  const rts = [], ranges = [], most = Math.round((1.5 * RATE) / SUB);
  for (let i = 1; i < nSub - 1;) {
    const peak = L(i);
    if (!(peak >= L(i - 1) && peak > L(i + 1) && peak >= floor + 20)) { i++; continue; }
    const xs = [], ys = [];
    let low = peak, j = i + 1;
    for (; j < Math.min(nSub, i + most); j++) {
      const v = L(j);
      if (v > low + 3 || v <= floor + 5) break;
      low = Math.min(low, v);
      if (v <= peak - 5) { xs.push((j * SUB) / RATE); ys.push(v); }
    }
    i = Math.max(i + 1, j);
    if (xs.length < 4 || peak - 5 - low < 10) continue;
    const n = xs.length, mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let k = 0; k < n; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2; syy += (ys[k] - my) ** 2; }
    const slope = sxy / sxx, r2v = syy ? (sxy * sxy) / (sxx * syy) : 0;
    if (slope >= 0 || r2v < 0.8) continue;
    rts.push(-60 / slope); ranges.push(peak - 5 - low);
  }
  if (!rts.length) return { rt60: null, decays: 0, rangeDb: null, confidence: "none" };
  const range = quantile(ranges, 0.5);
  // (confidence: low under 6 decays or a median range under 12 dB, high from 40 decays over 20 dB)
  const confidence = rts.length < 6 || range < 12 ? "low" : rts.length < 40 || range < 20 ? "medium" : "high";
  return { rt60: r2(quantile(rts, 0.25)), decays: rts.length, rangeDb: r1(range), confidence };
}
