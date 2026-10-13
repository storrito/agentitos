// Audio features for the audiogram: per-frame energy in log-spaced frequency bands,
// computed once at build time so the render stays a pure function of time.

import { execFileSync } from "node:child_process";

export const SR = 16000;

export function decodeMono(audioPath, sr = SR) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", audioPath, "-ac", "1", "-ar", String(sr), "-f", "f32le", "-"], {
    maxBuffer: 1 << 30,
  });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

// in-place radix-2 FFT
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
      }
    }
  }
}

// Returns { fps, n, data } where data is a string of base-36 digits (0..35), n per frame.
export function audioBands(audioPath, { fps = 30, bands = 24, fMin = 90, fMax = 5000 } = {}) {
  const x = decodeMono(audioPath);
  const N = 1024, frames = Math.ceil((x.length / SR) * fps);
  const edges = Array.from({ length: bands + 1 }, (_, b) => fMin * Math.pow(fMax / fMin, b / bands));
  const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const vals = new Float32Array(frames * bands);
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let f = 0; f < frames; f++) {
    const c = Math.round((f / fps) * SR) - N / 2;
    for (let i = 0; i < N; i++) { const s = x[c + i]; re[i] = (s === undefined ? 0 : s) * win[i]; im[i] = 0; }
    fft(re, im);
    for (let b = 0; b < bands; b++) {
      const k0 = Math.max(1, Math.floor((edges[b] / SR) * N)), k1 = Math.max(k0 + 1, Math.ceil((edges[b + 1] / SR) * N));
      let e = 0;
      for (let k = k0; k < k1; k++) e += re[k] * re[k] + im[k] * im[k];
      vals[f * bands + b] = Math.log10(1 + e / (k1 - k0));
    }
  }
  // per-band normalisation against the band's own loud level, so every bar moves
  let out = "";
  const norm = new Float32Array(bands);
  for (let b = 0; b < bands; b++) {
    const col = [];
    for (let f = 0; f < frames; f++) col.push(vals[f * bands + b]);
    col.sort((a, c) => a - c);
    norm[b] = col[Math.floor(col.length * 0.97)] || 1;
  }
  for (let f = 0; f < frames; f++) {
    for (let b = 0; b < bands; b++) {
      const v = Math.max(0, Math.min(1, vals[f * bands + b] / norm[b]));
      out += Math.round(Math.pow(v, 1.6) * 35).toString(36);
    }
  }
  return { fps, n: bands, data: out };
}
