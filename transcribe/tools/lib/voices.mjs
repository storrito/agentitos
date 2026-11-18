// Who speaks, across the pieces of a recording. Scribe names the voice of every word, but a voice
// is a number within one request: the "0" of one piece is not the "0" of the next. Two ways to
// make people of the pieces' voices:
//
// By the sound, for the short pieces that are sent side by side. Every voice of every piece gets
// a fingerprint from the sound of its own words: how high it speaks (the median of log2 F0 and its
// spread over the voiced frames) and how it sounds (mean and deviation of MFCC 1–19 over the
// frames with speech), each number brought to mean 0 and deviation 1 over the recording's voices.
// The pieces in order: two people known and two voices in the piece, the one of the two ways
// round with the smaller distance; one voice, the nearer person. This holds only for two people:
// a recording qualifies when every piece names two voices at most (one with under 5 s of speech
// does not count, its words go to the nearer person), and a decision is trusted when the worse
// way is 1.15 times as far as the better. Else there are no speakers from here: the caller sends
// long requests instead.
// Measured 2026-11-17 on 16 two-voice recordings (12 to 27 minutes, ten-minute pieces): 13
// qualify, 21 of 21 decisions right, 99.0 % of the words with the right speaker, which is what
// each piece alone gives; the margin sends 2 of the 13 to the long requests (their decisions were
// right). Of 12 recordings with more voices 11 are refused by the two voices a piece; the twelfth,
// a meeting of four, by the margin. One voice: 8 pieces, 68 minutes, never split. The numbers
// are those of the Python the rule was measured with (torchaudio's MFCC, the same pitch): this
// file gives the same frames and, on those recordings, the same margins to 0.0001.
//
// By the words, for long requests (a request keeps its voices apart by itself): a piece after
// the first is heard from five minutes before its start, and a voice of it is the person of the
// piece before that wrote the same words at the same time there.
//
//   listen() → { push(samples), done() }     the sound as it streams, done() → what it keeps
//   framesOf(file)                            → the same of a file (ffmpeg, streamed)
//   fingerprints(sound, pieces)              → [{ piece, voice, words, seconds, f0, mfcc }]
//   bySound(fingerprints)                    → { person, people, margin, decisions } | { why }
//   byWords(parts, overlap)                  → person: Map "<piece>:<voice>" → number
//   named(pieces, person)                    → { words, people }: speaker "A", "B", … by first word
//
// `pieces` are the words each piece owns, [{ text, start, end, kind, voice }] in seconds of the
// recording; `parts` are { start, words } with everything a piece heard.

import { spawn } from "node:child_process";

export const SR = 16000;
const HOP = 160;                 // 10 ms: a frame of the sound
const WIN = 400, MELS = 40;      // timbre: 25 ms, 40 mel bands, the cosine transform's rows 1–19
const COEF = 19;
const PWIN = 640, PFFT = 1024;   // pitch: 40 ms, lags 40–266 (400 to 60 Hz)
const LAG0 = 40, LAG1 = 267;
const BLOCK = 6000;              // frames kept per block (a minute)

export const LITTLE = 5;         // seconds of speech under which a voice does not count
export const MARGIN = 1.15;      // the worse way round is this many times as far as the better
export const key = (k, voice) => `${k}:${voice}`;

// ---------------------------------------------------------------- the sound

// The transform of n complex numbers, n a product of 4s, 2s and 5s (in that order): the
// transforms of every p-th number, joined p at a time. → (re, im, outRe, outIm)
function fourier(n, factors) {
  const cos = new Float64Array(n), sin = new Float64Array(n);
  for (let i = 0; i < n; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  const rest = factors.map((_, f) => factors.slice(f + 1).reduce((x, y) => x * y, 1));
  // every p stretches of m numbers into one, each turned by its step (`st` of the n-th of a turn)
  function two(R, I, st, m) {
    for (let o = 0; o < n; o += 2 * m) for (let u = 0; u < m; u++) {
      const a = o + u, b = a + m, c = cos[u * st], s = sin[u * st];
      const tr = R[b] * c - I[b] * s, ti = R[b] * s + I[b] * c;
      R[b] = R[a] - tr; I[b] = I[a] - ti; R[a] += tr; I[a] += ti;
    }
  }
  function four(R, I, st, m) {
    for (let o = 0; o < n; o += 4 * m) for (let u = 0; u < m; u++) {
      const a = o + u, b = a + m, c = b + m, d = c + m;
      const c1 = cos[u * st], s1 = sin[u * st], c2 = cos[2 * u * st], s2 = sin[2 * u * st], c3 = cos[3 * u * st], s3 = sin[3 * u * st];
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
  function five(R, I, st, m) {
    const yar = cos[st * m], yai = sin[st * m], ybr = cos[2 * st * m], ybi = sin[2 * st * m];
    for (let o = 0; o < n; o += 5 * m) for (let u = 0; u < m; u++) {
      const a = o + u, b = a + m, c = b + m, d = c + m, e = d + m;
      const c1 = cos[u * st], s1 = sin[u * st], c2 = cos[2 * u * st], s2 = sin[2 * u * st];
      const c3 = cos[3 * u * st], s3 = sin[3 * u * st], c4 = cos[4 * u * st], s4 = sin[4 * u * st];
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
  factors.forEach((p, f) => joins.unshift([p === 4 ? four : p === 5 ? five : two, n / (p * rest[f]), rest[f]]));
  return (xr, xi, R, I) => {
    for (let i = 0; i < n; i++) { R[i] = xr[order[i]]; I[i] = xi[order[i]]; }
    for (const [join, st, m] of joins) join(R, I, st, m);
  };
}

// The transform of n real numbers (n even) from one of n/2 complex ones: the even numbers as
// the real parts, the odd ones as the imaginary. → (x, re, im): the bins 0 … `bins` - 1 of x
function spectrum(n, factors, bins = n / 2 + 1) {
  const m = n / 2, half = fourier(m, factors);
  const cos = Float64Array.from({ length: m + 1 }, (_, k) => Math.cos((2 * Math.PI * k) / n));
  const sin = Float64Array.from({ length: m + 1 }, (_, k) => Math.sin((2 * Math.PI * k) / n));
  const er = new Float64Array(m), ei = new Float64Array(m), zr = new Float64Array(m), zi = new Float64Array(m);
  return (x, re, im) => {
    for (let i = 0; i < m; i++) { er[i] = x[2 * i]; ei[i] = x[2 * i + 1]; }
    half(er, ei, zr, zi);
    for (let k = 0; k < bins; k++) {
      const a = k % m, b = (m - k) % m;
      // the even numbers' transform and the odd numbers', turned by the half step between them
      const evr = (zr[a] + zr[b]) / 2, evi = (zi[a] - zi[b]) / 2, odr = (zi[a] + zi[b]) / 2, odi = (zr[b] - zr[a]) / 2;
      re[k] = evr + cos[k] * odr + sin[k] * odi;
      im[k] = evi + cos[k] * odi - sin[k] * odr;
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

// The sound as it streams: push() takes samples (−1 … 1) in any portions, done() gives what is
// kept of it, per 10 ms frame: the loudness, the 40 mel bands in hundredths of a dB (80 bytes a
// frame, 29 MB an hour: the cosine transform is taken when a voice's frames are read, for the
// floor under the loudest band is known only at the end), F0 and whether it has a pitch.
export function listen() {
  const spec = spectrum(WIN, [4, 2, 5, 5]), bands = melBands();
  const wide = spectrum(PFFT, [4, 4, 4, 4, 2]), lags = spectrum(PFFT, [4, 4, 4, 4, 2], LAG1);
  const w400 = hann(WIN), w640 = hann(PWIN);
  const x = new Float64Array(WIN), xr = new Float64Array(WIN / 2 + 1), xi = new Float64Array(WIN / 2 + 1);
  const px = new Float64Array(PFFT), pr = new Float64Array(PFFT / 2 + 1), pi = new Float64Array(PFFT / 2 + 1);
  const mel = [], rms = [], f0 = [], sure = [];
  let rest = new Float32Array(0), frames = 0, pitched = 0, loudest = -Infinity;
  const block = (list, make, t) => (list[Math.floor(t / BLOCK)] ??= make());

  // loudness and mel bands of the 25 ms from sample `at` of `s`
  function timbre(s, at) {
    let sq = 0;
    for (let i = 0; i < WIN; i++) { const v = s[at + i]; sq += v * v; x[i] = v * w400[i]; }
    spec(x, xr, xi);
    const t = frames++, row = block(mel, () => new Int16Array(BLOCK * MELS), t), o = (t % BLOCK) * MELS;
    block(rms, () => new Float32Array(BLOCK), t)[t % BLOCK] = Math.sqrt(sq / WIN);
    for (let j = 0; j < MELS; j++) {
      const { first, w } = bands[j];
      let e = 0;
      for (let i = 0; i < w.length; i++) { const b = first + i; e += w[i] * (xr[b] * xr[b] + xi[b] * xi[b]); }
      const db = 10 * Math.log10(Math.max(e, 1e-10));
      if (db > loudest) loudest = db;
      row[o + j] = Math.round(db * 100);
    }
  }
  // F0 of the 40 ms from sample `at`: the strongest lag of its autocorrelation
  function pitch(s, at) {
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
    const t = pitched++;
    block(f0, () => new Float32Array(BLOCK), t)[t % BLOCK] = SR / best;
    block(sure, () => new Uint8Array(BLOCK), t)[t % BLOCK] = pr[best] / PFFT / all > 0.5 ? 1 : 0;
  }

  return {
    push(samples) {
      let s = samples;
      if (rest.length) { s = new Float32Array(rest.length + samples.length); s.set(rest); s.set(samples, rest.length); }
      let at = 0;
      for (; at + PWIN <= s.length; at += HOP) { timbre(s, at); pitch(s, at); }
      rest = s.slice(at);
    },
    done() {
      // the last frames are too short for a pitch; their loudness still counts
      for (let at = 0; at + WIN <= rest.length; at += HOP) timbre(rest, at);
      rest = new Float32Array(0);
      const flat = (list, n) => { const out = new Float32Array(n); for (let t = 0; t < n; t++) out[t] = list[Math.floor(t / BLOCK)][t % BLOCK]; return out; };
      const loud = flat(rms, frames);
      // speech is above 8 % of loud speech (the 95th percentile of the loudness)
      const step = Math.max(1, Math.floor(frames / 200000));
      const some = Float32Array.from({ length: Math.ceil(frames / step) }, (_, i) => loud[i * step]).sort();
      const n = pitched, gate = 0.08 * quantile(some, 0.95);
      return {
        frames: n, floor: Math.round((loudest - 80) * 100),
        speech: (t) => loud[t] > gate,
        pitch: (t) => (sure[Math.floor(t / BLOCK)][t % BLOCK] && loud[t] > gate ? f0[Math.floor(t / BLOCK)][t % BLOCK] : 0),
        bands: (t) => mel[Math.floor(t / BLOCK)].subarray((t % BLOCK) * MELS, (t % BLOCK) * MELS + MELS),
      };
    },
  };
}

// of sorted numbers, between two of them as numpy does
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const at = q * (sorted.length - 1), lo = Math.floor(at), hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (at - lo) * (sorted[hi] - sorted[lo]);
}

// The sound of a file, read as ffmpeg decodes it (never the whole recording in memory).
export function framesOf(file) {
  return new Promise((resolve, reject) => {
    const ear = listen();
    let odd = null, err = "";
    const p = spawn("ffmpeg", ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(SR), "-f", "s16le", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    p.stderr.on("data", (d) => { err += d; });
    p.stdout.on("data", (chunk) => {
      const buf = odd ? Buffer.concat([odd, chunk]) : chunk, n = buf.length >> 1;
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(2 * i) / 32768;
      odd = buf.length & 1 ? buf.subarray(buf.length - 1) : null;
      ear.push(samples);
    });
    p.on("error", (e) => reject(e.code === "ENOENT" ? new Error("ffmpeg is missing: this tool needs ffmpeg on the PATH") : e));
    p.on("close", (code) => {
      if (code) return reject(new Error(`ffmpeg could not read the sound of ${file}: ${err.trim().split("\n").pop() || `exit ${code}`}`));
      resolve(ear.done());
    });
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
    x: Float64Array.from({ length: dims }, (_, d) => (rows[i] ? (rows[i][d] - mu[d]) / (Math.sqrt(sd[d]) + 1e-9) : 0)) }));
}

const dist = (a, b) => { let s = 0; for (let d = 0; d < a.length; d++) s += (a[d] - b[d]) ** 2; return Math.sqrt(s / a.length); };

// One piece's voices (one or two) against the people known (one or two): [person of each voice
// (the number after the known ones: someone new), the worse distance, the better one]
function decide(known, xs) {
  if (known.length === 2 && xs.length === 2) {
    const straight = dist(xs[0], known[0]) + dist(xs[1], known[1]), cross = dist(xs[0], known[1]) + dist(xs[1], known[0]);
    return straight <= cross ? [[0, 1], cross, straight] : [[1, 0], straight, cross];
  }
  if (known.length === 2) {
    const d = [dist(xs[0], known[0]), dist(xs[0], known[1])];
    return [[d[1] < d[0] ? 1 : 0], Math.max(...d), Math.min(...d)];
  }
  if (xs.length === 2) {
    // one person known, two voices: the nearer voice is that person, the other someone new
    const d = [dist(xs[0], known[0]), dist(xs[1], known[0])];
    return [d[1] < d[0] ? [1, 0] : [0, 1], Math.max(...d), Math.min(...d)];
  }
  return [[0], null, null];   // one known, one voice: nothing to choose between
}

// The people of a recording's voices from their fingerprints, or why there are none from here.
//   → { person: Map "<piece>:<voice>" → 0 | 1, people, margin (the smallest, null without a
//       decision), decisions: [{ piece, voices, margin }] }   or   { why }
export function bySound(fps, { little = LITTLE, margin = MARGIN } = {}) {
  const vec = vectors(fps);
  const pieces = [...new Set(vec.map((v) => v.piece))].sort((a, b) => a - b);
  const strong = (k) => vec.filter((v) => v.piece === k && v.ok && v.seconds >= little);
  for (const k of pieces) {
    const n = strong(k).length;
    if (n > 2) return { why: `piece ${k + 1} names ${n} voices, and the voices of short pieces are told to be the same people only for two` };
  }
  const known = [], weight = [], person = new Map(), decisions = [];
  for (const k of pieces) {
    const vs = strong(k);
    if (!vs.length) continue;
    let to;
    if (!known.length) to = vs.map((_, i) => i);
    else {
      const [mapping, worse, better] = decide(known, vs.map((v) => v.x));
      to = mapping;
      decisions.push({ piece: k, voices: vs.length, margin: worse == null ? null : worse / Math.max(better, 1e-9) });
    }
    vs.forEach((v, i) => {
      const p = to[i];
      if (p === known.length) { known.push(Float64Array.from(v.x)); weight.push(v.seconds); }
      else { known[p] = known[p].map((c, d) => (c * weight[p] + v.x[d] * v.seconds) / (weight[p] + v.seconds)); weight[p] += v.seconds; }
      person.set(v.id, p);
    });
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
    if (v.ok && known.length) { person.set(v.id, known.length === 2 && dist(v.x, known[1]) < dist(v.x, known[0]) ? 1 : 0); continue; }
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
// other is someone new.
export function byWords(parts, overlap) {
  const person = new Map();
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
    }
    for (const v of voices) person.set(key(k, v), found.has(v) ? found.get(v) : n++);
  });
  return person;
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
