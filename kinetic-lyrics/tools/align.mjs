// Refine ASR word timings against the actual audio.
//
// ASR word timestamps drift by 100–500 ms (Whisper especially), sometimes placing
// a word in the silence after it was spoken. For kinetic type that reads as
// "late". We build an energy envelope, collect boundary candidates (voice onsets
// after silences *and* after short energy dips between syllables), then choose
// all word starts jointly with dynamic programming: each start either snaps to a
// candidate or keeps its ASR time, minimising the total shift, in strict order.
// Keeping a start that sits in silence is expensive, so misplaced words move.
// Word ends that fall into silence are pulled back to where the voice stopped.

import { execFileSync } from "node:child_process";

const SR = 16000;
const HOP = 0.01; // 10 ms frames

function envelope(audioPath) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", audioPath, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], {
    maxBuffer: 1 << 30,
  });
  const x = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const hop = Math.round(SR * HOP);
  const n = Math.floor(x.length / hop);
  const env = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) s += x[i] * x[i];
    env[f] = Math.sqrt(s / hop);
  }
  // light smoothing (30 ms) so single-frame flicker doesn't create boundaries
  const sm = new Float32Array(n);
  for (let f = 0; f < n; f++) sm[f] = (env[Math.max(0, f - 1)] + env[f] + env[Math.min(n - 1, f + 1)]) / 3;
  return sm;
}

function candidates(env, thr) {
  const out = new Set();
  const n = env.length;
  const localMax = (f, r) => { let m = 0; for (let k = Math.max(0, f - r); k <= Math.min(n - 1, f + r); k++) m = Math.max(m, env[k]); return m; };
  for (let f = 3; f < n - 3; f++) {
    // onset after >= 30 ms of silence
    if (env[f] > thr && env[f - 1] <= thr && env[f - 2] <= thr && env[f - 3] <= thr) out.add(f);
    // dip between syllables/words: local minimum well below the surrounding speech
    const isMin = env[f] <= env[f - 1] && env[f] <= env[f + 1] && env[f] < env[f - 2] && env[f] < env[f + 2];
    if (isMin && env[f] < 0.4 * localMax(f, 15) && localMax(f, 15) > thr * 2) {
      let g = f; // boundary = where the energy rises again
      while (g < n - 1 && env[g + 1] <= env[g] * 1.15 && g - f < 8) g++;
      // only a boundary if speech actually resumes right after the dip
      if (env[g] > thr || env[Math.min(n - 1, g + 2)] > thr) out.add(g);
    }
  }
  return [...out].sort((a, b) => a - b).map((f) => f * HOP);
}

export function alignToAudio(words, audioPath) {
  const env = envelope(audioPath);
  const sorted = Float32Array.from(env).sort();
  const peak = sorted[Math.floor(sorted.length * 0.95)] || 1e-4;
  const thr = Math.max(peak * 0.08, 0.004); // voiced if above ~8% of loud speech
  const voiced = (f) => f >= 0 && f < env.length && env[f] > thr;
  const at = (t) => Math.round(t / HOP);
  const voicedFrac = (a, b) => {
    const f0 = at(a), f1 = Math.max(f0 + 1, at(b));
    let v = 0;
    for (let f = f0; f < f1; f++) if (voiced(f)) v++;
    return v / (f1 - f0);
  };
  const cand = candidates(env, thr);

  // options per word: keep the ASR start, or snap to a candidate within 0.6 s
  const N = words.length;
  const opts = words.map((w) => {
    const silent = voicedFrac(w.start, Math.max(w.end, w.start + 0.12)) < 0.3;
    const list = [{ t: w.start, cost: silent ? 0.6 : 0.1 }];
    for (const c of cand) {
      if (c < w.start - 0.6 || c > w.start + 0.6) continue;
      // snapping into silence makes no sense; candidates are onsets, so check just after
      list.push({ t: c, cost: Math.abs(c - w.start) });
    }
    return list;
  });
  const MIN_GAP = 0.07;
  // DP over words; state = chosen option index
  const best = opts.map((o) => o.map(() => Infinity));
  const from = opts.map((o) => o.map(() => -1));
  opts[0].forEach((o, j) => (best[0][j] = o.cost));
  for (let i = 1; i < N; i++) {
    opts[i].forEach((o, j) => {
      opts[i - 1].forEach((p, k) => {
        if (o.t < p.t + MIN_GAP) return;
        const c = best[i - 1][k] + o.cost;
        if (c < best[i][j]) { best[i][j] = c; from[i][j] = k; }
      });
    });
  }
  let j = best[N - 1].indexOf(Math.min(...best[N - 1]));
  const chosen = new Array(N);
  for (let i = N - 1; i >= 0; i--) {
    if (j < 0) { // no feasible chain (shouldn't happen): keep ASR times
      for (let k = 0; k <= i; k++) chosen[k] = words[k].start;
      break;
    }
    chosen[i] = opts[i][j].t;
    j = from[i][j];
  }

  let moved = 0;
  const out = words.map((w, i) => {
    const start = chosen[i];
    if (Math.abs(start - w.start) > 0.02) moved++;
    const nextStart = i + 1 < N ? chosen[i + 1] : Infinity;
    // end: never past the next word, and pulled back out of trailing silence
    let end = Math.min(Math.max(w.end, start + 0.12), nextStart);
    let f = at(end);
    if (!voiced(f)) {
      while (f > at(start) + 5 && !voiced(f)) f--;
      if (voiced(f)) end = Math.min(end, (f + 1) * HOP + 0.04);
    }
    end = Math.min(Math.max(end, start + 0.12), nextStart);
    return { ...w, start: +start.toFixed(3), end: +end.toFixed(3) };
  });
  return { words: out, moved };
}
