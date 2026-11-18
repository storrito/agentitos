// Who speaks, across the pieces of a recording. Scribe names the voice of every word, but a voice
// is a number within one request: the "0" of one piece is not the "0" of the next. Two ways to
// make people of the pieces' voices:
//
// By the sound, for the short pieces that are sent side by side. Every voice of every piece gets
// a fingerprint from the sound of its own words: how high it speaks (the median of log2 F0 and its
// spread over the voiced frames) and how it sounds (mean and deviation of MFCC 1–19 over the
// frames with speech), each number brought to mean 0 and deviation 1 over the recording's voices.
// A recording is taken to be of two people at most, which most are: every piece names two
// voices at most (one with under 5 s of speech does not count, its words go to the nearer
// person). The first piece with two voices gives the two people; every other piece is put to
// them, two voices the way round with the smaller distance, one voice the nearer person. Pieces
// of one voice each, without one of two, are one person. A piece that names three voices or
// more says there are more people: no speakers from here, the caller sends long requests.
// Measured 2026-11-18 (PR #64) on the live answers of 32 recordings in five-minute pieces (as
// on a Sprite): 15 of 16 two-voice recordings give speakers, 50 of 50 decisions right, 98.4 %
// of the words with the right speaker (each piece alone 98.4 %); the 16th has a piece where the
// model heard three voices. Of 12 recordings with more voices (4 to 15) none: each has a piece
// that names three or more. Of 4 with one voice 3 are one person, the 4th has a piece where the
// model heard three.
// What this takes on trust: three people of whom no piece ever hears three become two, and two
// who speak one after the other, never in one piece, become one (of 6 two-voice recordings
// spliced so, 5). The sound does not tell: of 73 voices of someone else put to the two people of
// another piece, 11 lie as near as the person themselves would (within APART = 1.1 of them, in
// units of how much voices spread, and MARGIN = 1.15 nearer one way round than the other), and
// bounds like these refused 3 of the 15 recordings above without stopping a wrong one. A caller
// that would rather have no speakers than a doubtful link passes them: bySound(fps, { margin:
// MARGIN, apart: APART }). The people a caller knows to be more go in with --speakers-n.
// The fingerprints are those of the Python the rule was first measured with (torchaudio's MFCC,
// the same pitch): this file gives the same frames and the same margins to 0.0001.
//
// By the words, for long requests (a request keeps its voices apart by itself): a piece after
// the first is heard from five minutes before its start, and a voice of it is the person of the
// piece before that wrote the same words at the same time there.
//
//   listen() → { push(samples), done() }     the sound as it streams, done() → what it keeps
//   framesOf(file)                            → the same of a file (ffmpeg, streamed)
//   fingerprints(sound, pieces)              → [{ piece, voice, words, seconds, f0, mfcc }]
//   bySound(fingerprints)                    → { person, people, margin, decisions } | { why }
//   byWords(parts, overlap)                  → { person: Map "<piece>:<voice>" → number, gaps }
//   byTime(words, theirs)                    → the words with the speakers of another transcription
//   named(pieces, person)                    → { words, people }: speaker "A", "B", … by first word
//
// `pieces` are the words each piece owns, [{ text, start, end, kind, voice }] in seconds of the
// recording; `parts` are { start, words } with everything a piece heard.

import { spawn } from "node:child_process";
import os from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

export const SR = 16000;
const HOP = 160;                 // 10 ms: a frame of the sound
const WIN = 400, MELS = 40;      // timbre: 25 ms, 40 mel bands, the cosine transform's rows 1–19
const COEF = 19;
const PWIN = 640, PFFT = 1024;   // pitch: 40 ms, lags 40–266 (400 to 60 Hz)
const LAG0 = 40, LAG1 = 267;
const BLOCK = 6000;              // frames kept per block (a minute)
const CUT = BLOCK * HOP;         // the samples a block's frames start in
const OVER = PWIN - HOP;         // and the 480 after them its last pitch reads, the next block's first

export const LITTLE = 5;         // seconds of speech under which a voice does not count
export const MARGIN = 1.15;      // for { margin }: the worse way round this many times as far as the better
export const key = (k, voice) => `${k}:${voice}`;

// ---------------------------------------------------------------- the sound

// The transform of n complex numbers, n a product of 4s, 2s and 5s (in that order): the
// transforms of every p-th number, joined p at a time. → { order, join }: the numbers put in
// R, I as `order` says (R[i] = re[order[i]]), join(R, I) makes R, I their transform
function fourier(n, factors) {
  const cos = new Float64Array(n), sin = new Float64Array(n);
  for (let i = 0; i < n; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  const rest = factors.map((_, f) => factors.slice(f + 1).reduce((x, y) => x * y, 1));
  // every p stretches of m numbers into one, each turned by its step (`st` of the n-th of a turn);
  // `tw` holds the turns of a join in the order they are used: for each u, cos and sin of u·st,
  // 2u·st, … (p - 1)u·st
  function two(R, I, tw, m) {
    for (let o = 0; o < n; o += 2 * m) for (let u = 0; u < m; u++) {
      const a = o + u, b = a + m, c = tw[2 * u], s = tw[2 * u + 1];
      const tr = R[b] * c - I[b] * s, ti = R[b] * s + I[b] * c;
      R[b] = R[a] - tr; I[b] = I[a] - ti; R[a] += tr; I[a] += ti;
    }
  }
  function four(R, I, tw, m) {
    for (let o = 0; o < n; o += 4 * m) for (let u = 0; u < m; u++) {
      const a = o + u, b = a + m, c = b + m, d = c + m, t = 6 * u;
      const c1 = tw[t], s1 = tw[t + 1], c2 = tw[t + 2], s2 = tw[t + 3], c3 = tw[t + 4], s3 = tw[t + 5];
      const r0 = R[b] * c1 - I[b] * s1, i0 = R[b] * s1 + I[b] * c1;
      const r1 = R[c] * c2 - I[c] * s2, i1 = R[c] * s2 + I[c] * c2;
      const r2 = R[d] * c3 - I[d] * s3, i2 = R[d] * s3 + I[d] * c3;
      const r5 = R[a] - r1, i5 = I[a] - i1;
      R[a] += r1; I[a] += i1;
      const r3 = r0 + r2, i3 = i0 + i2, r4 = r0 - r2, i4 = i0 - i2;
      R[c] = R[a] - r3; I[c] = I[a] - i3; R[a] += r3; I[a] += i3;
      R[b] = r5 + i4; I[b] = i5 - r4; R[d] = r5 - i4; I[d] = i5 + r4;
    }
  }
  function five(R, I, tw, m) {
    const st = n / (5 * m), yar = cos[st * m], yai = sin[st * m], ybr = cos[2 * st * m], ybi = sin[2 * st * m];
    for (let o = 0; o < n; o += 5 * m) for (let u = 0; u < m; u++) {
      const a = o + u, b = a + m, c = b + m, d = c + m, e = d + m, t = 8 * u;
      const c1 = tw[t], s1 = tw[t + 1], c2 = tw[t + 2], s2 = tw[t + 3];
      const c3 = tw[t + 4], s3 = tw[t + 5], c4 = tw[t + 6], s4 = tw[t + 7];
      const r0 = R[a], i0 = I[a];
      const r1 = R[b] * c1 - I[b] * s1, i1 = R[b] * s1 + I[b] * c1;
      const r2 = R[c] * c2 - I[c] * s2, i2 = R[c] * s2 + I[c] * c2;
      const r3 = R[d] * c3 - I[d] * s3, i3 = R[d] * s3 + I[d] * c3;
      const r4 = R[e] * c4 - I[e] * s4, i4 = R[e] * s4 + I[e] * c4;
      const r7 = r1 + r4, i7 = i1 + i4, r10 = r1 - r4, i10 = i1 - i4;
      const r8 = r2 + r3, i8 = i2 + i3, r9 = r2 - r3, i9 = i2 - i3;
      R[a] = r0 + r7 + r8; I[a] = i0 + i7 + i8;
      const r5 = r0 + r7 * yar + r8 * ybr, i5 = i0 + i7 * yar + i8 * ybr;
      const r6 = i10 * yai + i9 * ybi, i6 = -r10 * yai - r9 * ybi;
      R[b] = r5 - r6; I[b] = i5 - i6; R[e] = r5 + r6; I[e] = i5 + i6;
      const r11 = r0 + r7 * ybr + r8 * yar, i11 = i0 + i7 * ybr + i8 * yar;
      const r12 = i9 * yai - i10 * ybi, i12 = r10 * ybi - r9 * yai;
      R[c] = r11 + r12; I[c] = i11 + i12; R[d] = r11 - r12; I[d] = i11 - i12;
    }
  }
  // where each number goes before the joining, and the joins from the smallest up
  const order = new Int32Array(n), joins = [];
  (function place(at, o, st, f) {
    const p = factors[f], m = rest[f];
    for (let q = 0; q < p; q++) { if (m === 1) order[o + q] = at + q * st; else place(at + q * st, o + q * m, st * p, f + 1); }
  })(0, 0, 1, 0);
  factors.forEach((p, f) => {
    const m = rest[f], st = n / (p * m), tw = new Float64Array(2 * (p - 1) * m);
    for (let u = 0; u < m; u++) for (let q = 1; q < p; q++) { tw[2 * ((p - 1) * u + q - 1)] = cos[q * u * st]; tw[2 * ((p - 1) * u + q - 1) + 1] = sin[q * u * st]; }
    joins.unshift([p === 4 ? four : p === 5 ? five : two, tw, m]);
  });
  return { order, join: (R, I) => { for (const [join, tw, m] of joins) join(R, I, tw, m); } };
}

// The transform of n real numbers (n even) from one of n/2 complex ones: the even numbers as
// the real parts, the odd ones as the imaginary. → (x, re, im): the bins 0 … `bins` - 1 of x;
// `real`: re only (im is left as it is)
function spectrum(n, factors, bins = n / 2 + 1, real = false) {
  const m = n / 2, { order, join } = fourier(m, factors);
  const cos = Float64Array.from({ length: m + 1 }, (_, k) => Math.cos((2 * Math.PI * k) / n));
  const sin = Float64Array.from({ length: m + 1 }, (_, k) => Math.sin((2 * Math.PI * k) / n));
  // where in x each number is read, in the transform's order; the two bins each bin is made of
  const from = Int32Array.from(order, (o) => 2 * o);
  const lo = Int32Array.from({ length: bins }, (_, k) => k % m), hi = Int32Array.from({ length: bins }, (_, k) => (m - k) % m);
  const zr = new Float64Array(m), zi = new Float64Array(m);
  return (x, re, im) => {
    for (let i = 0; i < m; i++) { const j = from[i]; zr[i] = x[j]; zi[i] = x[j + 1]; }
    join(zr, zi);
    for (let k = 0; k < bins; k++) {
      const a = lo[k], b = hi[k];
      // the even numbers' transform and the odd numbers', turned by the half step between them
      const evr = (zr[a] + zr[b]) / 2, odr = (zi[a] + zi[b]) / 2, odi = (zr[b] - zr[a]) / 2;
      re[k] = evr + cos[k] * odr + sin[k] * odi;
      if (!real) im[k] = (zi[a] - zi[b]) / 2 + cos[k] * odi - sin[k] * odr;
    }
  };
}

// the mel bands as torchaudio lays them (HTK scale, triangles over the bins of 40 Hz)
function melBands() {
  const mel = (f) => 2595 * Math.log10(1 + f / 700), hz = (m) => 700 * (10 ** (m / 2595) - 1);
  const top = mel(SR / 2), pts = Array.from({ length: MELS + 2 }, (_, i) => hz((top * i) / (MELS + 1)));
  const bins = WIN / 2 + 1, bands = [];
  for (let j = 0; j < MELS; j++) {
    const w = [];
    let first = -1;
    for (let i = 0; i < bins; i++) {
      const f = (i * (SR / 2)) / (bins - 1);
      const v = Math.max(0, Math.min((f - pts[j]) / (pts[j + 1] - pts[j]), (pts[j + 2] - f) / (pts[j + 2] - pts[j + 1])));
      if (v > 0) { if (first < 0) first = i; w.push(v); } else if (first >= 0) break;
    }
    bands.push({ first: Math.max(first, 0), w: Float64Array.from(w) });
  }
  return bands;
}

const hann = (n) => Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));

// the transforms, windows and scratch rows of one thread, made at its first block
let kit = null;
function tools() {
  return (kit ??= {
    spec: spectrum(WIN, [4, 2, 5, 5]), bands: melBands(),
    wide: spectrum(PFFT, [4, 4, 4, 4, 2]), lags: spectrum(PFFT, [4, 4, 4, 4, 2], LAG1, true),
    w400: hann(WIN), w640: hann(PWIN),
    x: new Float64Array(WIN), xr: new Float64Array(WIN / 2 + 1), xi: new Float64Array(WIN / 2 + 1), power: new Float64Array(WIN / 2 + 1),
    px: new Float64Array(PFFT), pr: new Float64Array(PFFT / 2 + 1), pi: new Float64Array(PFFT / 2 + 1),
  });
}

// The frames of one block of the sound: `s` holds the samples from its first frame on, the
// block's CUT and the OVER after them where there are (fewer at the end of the sound). A frame
// has a loudness and mel bands when its 25 ms are in `s`, a pitch when its 40 ms are: the last
// frames of the sound have the one and not the other. Depends on `s` alone, so the blocks can be
// worked in any order and on any thread. → { rms, mel, f0, sure, timbre, pitched, loudest }
function blockOf(s) {
  const { spec, bands, wide, lags, w400, w640, x, xr, xi, power, px, pr, pi } = tools();
  const rms = new Float32Array(BLOCK), mel = new Int16Array(BLOCK * MELS), f0 = new Float32Array(BLOCK), sure = new Uint8Array(BLOCK);
  let timbre = 0, pitched = 0, loudest = -Infinity;
  for (let at = 0; timbre < BLOCK && at + WIN <= s.length; at += HOP, timbre++) {
    // loudness and mel bands of the 25 ms from sample `at`
    let sq = 0;
    for (let i = 0; i < WIN; i++) { const v = s[at + i]; sq += v * v; x[i] = v * w400[i]; }
    spec(x, xr, xi);
    rms[timbre] = Math.sqrt(sq / WIN);
    // the power of a bin once, for the two bands it is in
    for (let b = 0; b <= WIN / 2; b++) power[b] = xr[b] * xr[b] + xi[b] * xi[b];
    const o = timbre * MELS;
    for (let j = 0; j < MELS; j++) {
      const { first, w } = bands[j];
      let e = 0;
      for (let i = 0; i < w.length; i++) e += w[i] * power[first + i];
      const db = 10 * Math.log10(Math.max(e, 1e-10));
      if (db > loudest) loudest = db;
      mel[o + j] = Math.round(db * 100);
    }
    if (at + PWIN > s.length) continue;
    // F0 of the 40 ms from sample `at`: the strongest lag of its autocorrelation
    let mean = 0;
    for (let i = 0; i < PWIN; i++) mean += s[at + i];
    mean /= PWIN;
    for (let i = 0; i < PWIN; i++) px[i] = (s[at + i] - mean) * w640[i];
    px.fill(0, PWIN);
    wide(px, pr, pi);
    // the transform of the spectrum's power (the same at k and PFFT - k) is the
    // autocorrelation, times PFFT
    for (let k = 0; k <= PFFT / 2; k++) { const e = pr[k] * pr[k] + pi[k] * pi[k]; px[k] = e; if (k) px[PFFT - k] = e; }
    lags(px, pr, pi);
    const all = Math.max(pr[0] / PFFT, 1e-9);
    let best = LAG0;
    for (let lag = LAG0 + 1; lag < LAG1; lag++) if (pr[lag] > pr[best]) best = lag;
    f0[pitched] = SR / best;
    sure[pitched++] = pr[best] / PFFT / all > 0.5 ? 1 : 0;
  }
  return { rms, mel, f0, sure, timbre, pitched, loudest };
}

// Streamed samples cut into the blocks blockOf takes: each block its CUT samples and the OVER
// after them, which are the next block's first too. → { push(samples), end() }; each block goes
// to block(s, k) as it is full, the rest at end(): the last block, and after it one more when
// the samples past its CUT still hold a frame's 25 ms (a frame without a pitch). fresh() gives
// the row for the next block (one given back may be used again: every sample of it is written).
function cutter(block, fresh = () => new Float32Array(CUT + OVER)) {
  let s = fresh(), have = 0, k = 0;
  return {
    push(samples) {
      for (let i = 0; i < samples.length;) {
        const n = Math.min(samples.length - i, s.length - have);
        s.set(samples.subarray(i, i + n), have);
        have += n; i += n;
        if (have === s.length) { const next = fresh(); next.set(s.subarray(CUT)); block(s, k++); s = next; have = OVER; }
      }
    },
    end() {
      if (have >= WIN) block(s.slice(0, have), k++);
      if (have - CUT >= WIN) block(s.slice(CUT, have), k++);
    },
  };
}

// What is kept of the sound, from its blocks in order: the counts, the gate of speech and the
// floor under the loudest band are the whole recording's.
function kept(blocks) {
  let frames = 0, pitched = 0, loudest = -Infinity;
  for (const b of blocks) { frames += b.timbre; pitched += b.pitched; if (b.loudest > loudest) loudest = b.loudest; }
  const loud = new Float32Array(frames);
  blocks.forEach((b, k) => loud.set(b.rms.subarray(0, b.timbre), k * BLOCK));
  // speech is above 8 % of loud speech (the 95th percentile of the loudness)
  const step = Math.max(1, Math.floor(frames / 200000));
  const some = Float32Array.from({ length: Math.ceil(frames / step) }, (_, i) => loud[i * step]).sort();
  const gate = 0.08 * quantile(some, 0.95);
  const of = (t) => blocks[Math.floor(t / BLOCK)];
  return {
    frames: pitched, floor: Math.round((loudest - 80) * 100),
    speech: (t) => loud[t] > gate,
    pitch: (t) => (of(t).sure[t % BLOCK] && loud[t] > gate ? of(t).f0[t % BLOCK] : 0),
    bands: (t) => of(t).mel.subarray((t % BLOCK) * MELS, (t % BLOCK) * MELS + MELS),
  };
}

// The sound as it streams: push() takes samples (−1 … 1, kept as 32-bit floats) in any
// portions, done() gives what is kept of it, per 10 ms frame: the loudness, the 40 mel bands in
// hundredths of a dB (80 bytes a frame, 29 MB an hour: the cosine transform is taken when a
// voice's frames are read, for the floor under the loudest band is known only at the end), F0
// and whether it has a pitch. On this thread; framesOf works the same blocks on others.
export function listen() {
  const blocks = [], cut = cutter((s) => blocks.push(blockOf(s)));
  return {
    push(samples) { cut.push(samples); },
    done() { cut.end(); return kept(blocks); },
  };
}

// of sorted numbers, between two of them as numpy does
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const at = q * (sorted.length - 1), lo = Math.floor(at), hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (at - lo) * (sorted[hi] - sorted[lo]);
}

// threads that work the blocks of a file: one core is left to the rest of the tool and ffmpeg
const WORKERS = Math.max(1, Math.min(4, os.availableParallelism() - 1));

// The sound of a file, read as ffmpeg decodes it (never the whole recording in memory), on a
// thread of its own (this file is what it runs): whatever this thread is busy with does not keep
// the sound waiting. Its blocks are joined as listen() joins them.
export function framesOf(file) {
  return new Promise((resolve, reject) => {
    const reader = new Worker(new URL(import.meta.url), { workerData: { voices: "reader", file } });
    let settled = false;
    reader.on("message", (m) => {
      settled = true;
      reader.terminate();
      if (m.error) reject(new Error(m.error)); else resolve(kept(m.blocks));
    });
    reader.on("error", (e) => { if (!settled) { settled = true; reject(e); } });
    reader.on("exit", (code) => { if (!settled) { settled = true; reject(new Error(`the sound of ${file} could not be read: its thread stopped (exit ${code})`)); } });
  });
}

// The blocks of a file: the reading thread cuts ffmpeg's samples into blocks, up to WORKERS
// threads work them (this file again), each the next block that waits. ffmpeg waits while more
// than two blocks a thread are not yet worked (4 MB each); a block's samples come back with its
// frames and hold the next block's (a thread that hardly allocates would keep them a long time).
// → the blocks in order
function blocksOf(file) {
  return new Promise((resolve, reject) => {
    const blocks = [], waiting = [], idle = [], crew = [], spare = [];
    let odd = null, err = "", sent = 0, back = 0, ended = false, settled = false, p = null, samples = new Float32Array(0);
    const settle = (e, sound) => {
      if (settled) return;
      settled = true;
      for (const w of crew) w.terminate();
      if (e) { p?.kill(); reject(e); } else resolve(sound);
    };
    const finished = () => { if (ended && back === sent) settle(null, blocks); };
    // a thread takes the next block that waits, or waits itself
    const next = (w) => {
      const job = waiting.shift();
      if (job) w.postMessage(job, [job.s.buffer]); else idle.push(w);
    };
    const hire = () => {
      const w = new Worker(new URL(import.meta.url), { workerData: { voices: "blocks" } });
      w.on("message", ({ s, ...b }) => {
        if (settled) return;
        if (s.length === CUT + OVER) spare.push(s);
        blocks[b.k] = b; back++;
        if (sent - back <= 2 * WORKERS) p.stdout.resume();
        next(w);
        finished();
      });
      w.on("error", (e) => settle(e));
      w.on("exit", (code) => { if (!settled) settle(new Error(`the sound of ${file} could not be worked: a thread stopped (exit ${code})`)); });
      crew.push(w);
      return w;
    };
    const cut = cutter((s, k) => {
      waiting.push({ k, s }); sent++;
      if (idle.length) next(idle.pop());
      else if (crew.length < WORKERS) next(hire());
      if (sent - back > 2 * WORKERS) p.stdout.pause();
    }, () => spare.pop() ?? new Float32Array(CUT + OVER));
    p = spawn("ffmpeg", ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(SR), "-f", "s16le", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    p.stderr.on("data", (d) => { err += d; });
    p.stdout.on("data", (chunk) => {
      if (settled) return;
      const buf = odd ? Buffer.concat([odd, chunk]) : chunk, n = buf.length >> 1;
      // one row for the samples of every chunk: the cutter copies them at once
      if (samples.length < n) samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(2 * i) / 32768;
      odd = buf.length & 1 ? buf.subarray(buf.length - 1) : null;
      try { cut.push(samples.subarray(0, n)); } catch (e) { settle(e); }
    });
    p.on("error", (e) => settle(e.code === "ENOENT" ? new Error("ffmpeg is missing: this tool needs ffmpeg on the PATH") : e));
    p.on("close", (code, signal) => {
      // ended by a signal (code null) is not the whole sound either
      if (code !== 0) return settle(new Error(`ffmpeg could not read the sound of ${file}: ${err.trim().split("\n").pop() || (code == null ? `ended by ${signal}` : `exit ${code}`)}`));
      if (settled) return;
      try { cut.end(); } catch (e) { return settle(e); }
      ended = true;
      finished();
    });
  });
}

// As one of framesOf's threads: the one that reads a file, all its blocks out when they are
// worked (or what went wrong); one that works blocks, a block in and its frames out. The rows
// are handed over, not copied.
const rows = (b) => [b.rms.buffer, b.mel.buffer, b.f0.buffer, b.sure.buffer];
if (!isMainThread && workerData?.voices === "reader") {
  blocksOf(workerData.file).then((blocks) => parentPort.postMessage({ blocks }, blocks.flatMap(rows)), (e) => parentPort.postMessage({ error: e.message }));
}
if (!isMainThread && workerData?.voices === "blocks") {
  parentPort.on("message", ({ k, s }) => {
    const b = blockOf(s);
    parentPort.postMessage({ k, ...b, s }, [...rows(b), s.buffer]);
  });
}

// ---------------------------------------------------------------- fingerprints

// rows 1–19 of the cosine transform over the 40 bands (orthonormal)
const DCT = Array.from({ length: COEF }, (_, c) => Float64Array.from({ length: MELS }, (_, j) => Math.sqrt(2 / MELS) * Math.cos((Math.PI / MELS) * (j + 0.5) * (c + 1))));

const letters = (text) => String(text).toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
// a word that tells whose voice a voice is: said, with a time and a voice; no noise
const said = (w) => w.voice != null && w.kind !== "event" && Number.isFinite(w.start) && !/^[[(].*[\])]$/.test(String(w.text).trim()) && letters(w.text) !== "";

// Per voice of every piece: how many words, seconds of speech in them, [median log2 F0, its
// spread] and MFCC 1–19 as 19 means and 19 deviations; f0 or mfcc null when the voice is too
// short for one (under 0.1 s with a pitch, under 0.2 s of speech).
export function fingerprints(sound, pieces) {
  const out = [];
  pieces.forEach((words, k) => {
    const by = new Map();
    for (const w of words) if (said(w)) (by.get(String(w.voice)) || by.set(String(w.voice), []).get(String(w.voice))).push(w);
    for (const [voice, ws] of [...by].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const span = (w) => { const a = Math.round(w.start * 100); return [a, Math.max(a + 1, Math.round(w.end * 100))]; };
      const from = Math.max(0, Math.min(...ws.map((w) => span(w)[0]))), to = Math.min(sound.frames, Math.max(...ws.map((w) => span(w)[1])));
      const mask = new Uint8Array(Math.max(0, to - from));
      for (const w of ws) { const [a, b] = span(w); for (let t = Math.max(a, from); t < Math.min(b, to); t++) mask[t - from] = 1; }
      const sum = new Float64Array(COEF), sq = new Float64Array(COEF), lf = [];
      let speech = 0;
      for (let t = from; t < to; t++) {
        if (!mask[t - from] || !sound.speech(t)) continue;
        speech++;
        const b = sound.bands(t);
        for (let c = 0; c < COEF; c++) {
          const d = DCT[c];
          let v = 0;
          for (let j = 0; j < MELS; j++) v += d[j] * Math.max(b[j], sound.floor);
          v /= 100; sum[c] += v; sq[c] += v * v;
        }
        const hz = sound.pitch(t);
        if (hz) lf.push(Math.log2(hz));
      }
      lf.sort((a, b) => a - b);
      out.push({
        piece: k, voice, words: ws.length, seconds: speech / 100,
        f0: lf.length >= 10 ? [quantile(lf, 0.5), quantile(lf, 0.75) - quantile(lf, 0.25)] : null,
        mfcc: speech >= 20 ? [...Array.from(sum, (s) => s / speech), ...Array.from(sum, (s, c) => Math.sqrt(Math.max(0, sq[c] / speech - (s / speech) ** 2)))] : null,
      });
    }
  });
  return out;
}

// every number of the fingerprints to mean 0 and deviation 1 over the recording's voices,
// weighted by their seconds; a voice without pitch or timbre is not `ok` and all zeros
function vectors(fps) {
  const rows = fps.map((f) => (f.f0 && f.mfcc ? [...f.f0, ...f.mfcc] : null));
  const dims = 2 + 2 * COEF, total = Math.max(fps.reduce((a, f, i) => a + (rows[i] ? f.seconds : 0), 0), 1e-9);
  const mu = new Float64Array(dims), sd = new Float64Array(dims);
  rows.forEach((r, i) => { if (r) for (let d = 0; d < dims; d++) mu[d] += (r[d] * fps[i].seconds) / total; });
  rows.forEach((r, i) => { if (r) for (let d = 0; d < dims; d++) sd[d] += ((r[d] - mu[d]) ** 2 * fps[i].seconds) / total; });
  return fps.map((f, i) => ({ piece: f.piece, voice: f.voice, id: key(f.piece, f.voice), seconds: f.seconds, ok: !!rows[i],
    x: Float64Array.from({ length: dims }, (_, d) => (rows[i] ? (rows[i][d] - mu[d]) / (Math.sqrt(sd[d]) + 1e-9) : 0)),
    raw: rows[i] ? Float64Array.from(rows[i]) : null }));
}

const dist = (a, b) => { let s = 0; for (let d = 0; d < a.length; d++) s += (a[d] - b[d]) ** 2; return Math.sqrt(s / a.length); };

// How far apart two voices are by the numbers themselves, not by the recording's own spread
// (which makes any two voices look apart when there are only two): each number in units of how
// much the voices of a recording spread around its mean, pooled over 316 voices of 32
// recordings (two voices, more, one; 2026-11-18). On those, a voice of one of the two people of a
// two-voice piece lies at a median 0.58 from that person's voice in another piece (95 % under
// 1.12), a voice of someone else at least 0.89 from the nearer of the two (median 1.41).
const SPREAD = [0.2531, 0.1533, 6.57, 7.731, 4.384, 4.743, 3.772, 3.484, 2.332, 2.547, 2.61, 2.042, 2.141, 1.912, 1.65, 1.676, 1.348, 1.287, 1.235, 1.34,
  1.14, 3.679, 2.242, 1.327, 1.336, 1.108, 0.7611, 0.7231, 0.6409, 0.6752, 0.5791, 0.5817, 0.5523, 0.5324, 0.5516, 0.677, 0.6387, 0.6597, 0.6988, 0.6753];
const far = (a, b) => { let s = 0; for (let d = 0; d < a.length; d++) s += ((a[d] - b[d]) / SPREAD[d]) ** 2; return Math.sqrt(s / a.length); };
// for { apart }: a voice farther than this from the person it would be is someone else
export const APART = 1.1;

// A person as the voices given to them so far: their mean, weighted by seconds, in both scales
const person0 = (v) => ({ x: Float64Array.from(v.x), raw: Float64Array.from(v.raw), weight: v.seconds });
function join(p, v) {
  const w = p.weight + v.seconds;
  p.x = p.x.map((c, d) => (c * p.weight + v.x[d] * v.seconds) / w);
  p.raw = p.raw.map((c, d) => (c * p.weight + v.raw[d] * v.seconds) / w);
  p.weight = w;
}

// One piece's voices (one or two) against the two people known: [person of each voice, the worse
// distance, the better one]
function decide(known, xs) {
  if (xs.length === 2) {
    const straight = dist(xs[0], known[0].x) + dist(xs[1], known[1].x), cross = dist(xs[0], known[1].x) + dist(xs[1], known[0].x);
    return straight <= cross ? [[0, 1], cross, straight] : [[1, 0], straight, cross];
  }
  const d = [dist(xs[0], known[0].x), dist(xs[0], known[1].x)];
  return [[d[1] < d[0] ? 1 : 0], Math.max(...d), Math.min(...d)];
}

// The people of a recording's voices from their fingerprints, or why there are none from here.
//   → { person: Map "<piece>:<voice>" → 0 | 1 | …, people, margin (the smallest, null without a
//       decision), decisions: [{ piece, voices, margin, apart }] }   or   { why, decisions }
// One piece (one request, which keeps its voices apart by itself): its voices are its people,
// however little they say (two who say four seconds each in a clip are two). Several pieces,
// taken to be of two people at most: the first piece that names two voices gives the two
// people, and every other piece (in order, those before it too) is put to them: two voices the
// one way round that is nearer, one voice the nearer person. A person is the mean of the voices
// put to them so far. With no piece of two voices every voice is the one person. Only a piece
// that names three voices says otherwise: no speakers from here. With { apart } a voice farther
// than that from the person it would be is someone new, a third, and with { margin } a decision
// whose worse way round is not that many times as far as the better is none: no speakers.
export function bySound(fps, { little = LITTLE, margin = 0, apart = Infinity } = {}) {
  const vec = vectors(fps);
  const pieces = [...new Set(vec.map((v) => v.piece))].sort((a, b) => a - b);
  const strong = (k) => vec.filter((v) => v.piece === k && v.ok && v.seconds >= little);
  const nearest = (v, known) => known.reduce((b, p, i) => (dist(v.x, p.x) < dist(v.x, known[b].x) ? i : b), 0);
  const person = new Map(), decisions = [];
  if (pieces.length === 1) {
    vec.forEach((v, i) => person.set(v.id, i));
    return { person, people: Math.max(1, vec.length), margin: null, decisions };
  }
  for (const k of pieces) {
    const n = strong(k).length;
    if (n > 2) return { why: `piece ${k + 1} names ${n} voices, and the voices of short pieces are told to be the same people only for two` };
  }
  // a piece that speaks (30 words or more) and none of whose voices has a fingerprint: the
  // sound was not there to tell them by
  const mute = pieces.find((k) => !vec.some((v) => v.piece === k && v.ok) && fps.reduce((a, f) => a + (f.piece === k ? f.words : 0), 0) >= 30);
  if (mute !== undefined) return { why: `the voices of piece ${mute + 1} have no sound to tell them by`, decisions };
  const anchor = pieces.find((k) => strong(k).length === 2);
  // one voice a piece (or none that says enough): taken to be one person
  if (anchor === undefined) {
    vec.forEach((v) => person.set(v.id, 0));
    return { person, people: 1, margin: null, decisions };
  }
  const known = strong(anchor).map((v, i) => { person.set(v.id, i); return person0(v); });
  for (const k of pieces) {
    const vs = strong(k);
    if (!vs.length || k === anchor) continue;
    const [to, worse, better] = decide(known, vs.map((v) => v.x));
    // someone new: a voice that sounds unlike the person it would be
    const d = Math.max(...vs.map((v, i) => far(v.raw, known[to[i]].raw)));
    decisions.push({ piece: k, voices: vs.length, margin: worse / Math.max(better, 1e-9), apart: d });
    if (d > apart) return { why: `a voice of piece ${k + 1} sounds unlike both people of the pieces before (${d.toFixed(2)} apart, over ${apart}): someone else, and the voices of short pieces are told to be the same people only for two`, decisions };
    vs.forEach((v, i) => { join(known[to[i]], v); person.set(v.id, to[i]); });
  }
  const margins = decisions.map((d) => d.margin).filter((m) => m != null);
  const least = margins.length ? Math.min(...margins) : null;
  if (least != null && least < margin) {
    const d = decisions.find((x) => x.margin === least);
    return { why: `the voices of piece ${d.piece + 1} are too close to tell whose is whose (the worse way round ${least.toFixed(2)} times as far as the better, under ${margin})`, decisions };
  }
  // voices with little speech: the nearer of the people known at the end; without a
  // fingerprint, the person of their piece's voice with the most speech
  for (const v of vec) {
    if (person.has(v.id)) continue;
    if (v.ok && known.length) { person.set(v.id, nearest(v, known)); continue; }
    const same = strong(v.piece).sort((a, b) => b.seconds - a.seconds)[0];
    person.set(v.id, same ? person.get(same.id) : 0);
  }
  return { person, people: Math.max(1, known.length), margin: least, decisions };
}

// ---------------------------------------------------------------- long pieces, by their words

const middle = (w) => (w.start + (Number.isFinite(w.end) ? w.end : w.start)) / 2;

// How many words a voice of `after` shares with a person of `before`, [{ voice, person, n }],
// the most first: the same word begun within half a second in both, each word once, the
// nearest first. `person` is the person of a word of `before`.
export function shared(before, after, person) {
  const places = new Map();
  before.forEach((w, i) => { const t = letters(w.text); if (!places.has(t)) places.set(t, []); places.get(t).push(i); });
  const pairs = [];
  after.forEach((w, j) => {
    for (const i of places.get(letters(w.text)) || []) {
      const apart = Math.abs(before[i].start - w.start);
      if (apart < 0.5) pairs.push([apart, i, j]);
    }
  });
  pairs.sort((a, b) => a[0] - b[0]);
  const usedBefore = new Set(), usedAfter = new Set(), out = [];
  for (const [, i, j] of pairs) {
    if (usedBefore.has(i) || usedAfter.has(j)) continue;
    usedBefore.add(i); usedAfter.add(j);
    const voice = String(after[j].voice), p = person(before[i]);
    const row = out.find((r) => r.voice === voice && r.person === p);
    if (row) row.n++; else out.push({ voice, person: p, n: 1 });
  }
  return out.sort((a, b) => b.n - a.n);
}

// The people of the voices of long pieces, `parts` as [{ start, words }] in order, every part's
// words being all it heard (from `overlap` seconds before its start, where it is not the first).
// A voice of a later part is the person it shares the most words with in the stretch both
// heard (two at least, a person one voice at most). One voice left without a person, when one
// person is left without a voice, is that person: someone who said nothing in the overlap. Any
// other is someone new. Where no voice of a part is linked at all (the stretch both heard holds
// music, an ad, nobody), every voice after it is someone new, and the people may be too many:
// `gaps` names those stretches, [from, to) in seconds.   → { person, gaps }
export function byWords(parts, overlap) {
  const person = new Map(), gaps = [];
  let n = 0;
  parts.forEach((part, k) => {
    const mine = part.words.filter(said);
    const voices = [...new Set(mine.map((w) => String(w.voice)))];
    const found = new Map();
    if (k) {
      const counts = shared(parts[k - 1].words.filter((w) => said(w) && middle(w) >= part.start - overlap),
        mine.filter((w) => middle(w) < part.start), (w) => person.get(key(k - 1, w.voice)));
      for (const { voice, person: p, n: times } of counts) {
        if (times < 2 || p === undefined || found.has(voice) || [...found.values()].includes(p)) continue;
        found.set(voice, p);
      }
      const free = voices.filter((v) => !found.has(v)), unheard = [...new Set(person.values())].filter((p) => ![...found.values()].includes(p));
      if (free.length === 1 && unheard.length === 1) found.set(free[0], unheard[0]);
      if (!found.size && voices.length) gaps.push([part.start - overlap, part.start]);
    }
    for (const v of voices) person.set(key(k, v), found.has(v) ? found.get(v) : n++);
  });
  return { person, gaps };
}

// The speakers another transcription gave its own words (Gemini's, to a tenth of a second) laid on
// these words by their times: a word takes the speaker of the one of `theirs` it overlaps most,
// else of the nearest within a second, else none; A, B, … again by first word.  → the words
export function byTime(words, theirs) {
  const ts = theirs.filter((t) => t.speaker && Number.isFinite(t.start)).sort((a, b) => a.start - b.start);
  const names = new Map();
  let from = 0;
  return words.map(({ voice, speaker, ...w }) => {
    while (from < ts.length && ts[from].start < w.start - 30) from++;
    let best = null, most = 0, near = 1;
    for (let j = from; j < ts.length && ts[j].start <= w.end + 1; j++) {
      const t = ts[j], over = Math.min(w.end, t.end) - Math.max(w.start, t.start);
      if (over > most) { most = over; best = t.speaker; }
      else if (most <= 0) { const gap = Math.max(t.start - w.end, w.start - t.end, 0); if (gap < near) { near = gap; best = t.speaker; } }
    }
    if (!best) return w;
    if (!names.has(best) && w.kind !== "event") names.set(best, letter(names.size));
    return { ...w, speaker: best };
  }).map((w) => {
    if (w.speaker && !names.has(w.speaker)) names.set(w.speaker, letter(names.size));
    return w.speaker ? { ...w, speaker: names.get(w.speaker) } : w;
  });
}

// ---------------------------------------------------------------- the words with their speakers

// A, B, … Z, then S27, S28, …
const letter = (n) => (n < 26 ? String.fromCharCode(65 + n) : `S${n + 1}`);

// The words of the pieces in order, each with the `speaker` of its voice's person, named in the
// order they first speak; a word whose voice has no person (a noise in a voice that said
// nothing) has none. → { words, people }
export function named(pieces, person) {
  const names = new Map();
  const words = pieces.flatMap((ws, k) => ws.map(({ voice, ...w }) => {
    const p = voice == null ? undefined : person.get(key(k, voice));
    if (p === undefined) return w;
    if (!names.has(p) && w.kind !== "event") names.set(p, letter(names.size));
    return { ...w, person: p };
  }));
  for (const w of words) {
    if (w.person === undefined) continue;
    if (!names.has(w.person)) names.set(w.person, letter(names.size));   // someone only heard as a noise
    w.speaker = names.get(w.person); delete w.person;
  }
  return { words, people: names.size };
}
