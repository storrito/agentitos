// The edges of the words where the sound has them. Scribe times a word a little inside its sound:
// it begins a word 60 ms late in the middle and ends one in eight more than 100 ms early. Against
// the alignment of an earnings call (2,164 words, 2026-11-16) 14.6 % of the starts were more than
// 100 ms late and 13.2 % of the ends more than 100 ms early as it gave them, 4.8 % and 4.7 % with
// this; a forced-alignment model of its own (MMS_FA) came to 8.6 % and 18 %. A cut or a caption
// placed by such times comes after the word has begun and goes before it is over.
//
//   quietLevels(env)     → Float32Array: for every second, the level a frame is quiet under
//   edged(words, env)    → how many words moved; the words are changed in place
//
// In the stretch the recognizer left between two words (and before the first, after the last):
// where it holds a quiet moment, the word before ends where its sound stops and the word after
// begins where its sound sets in, each moved REACH at most; where the sound runs through it for
// JOIN at most, the two meet where it is weakest. No edge moves inward: an ending too soft to
// measure is not cut off. lib/timing.mjs repairs the few words that are grossly wrong first; this
// is for all the others.
//
// Words are { text, start, end, kind } in seconds, in the order they were said; `env` is the
// envelope of lib/timing.mjs (10 ms frames, smoothed).

import { HOP } from "./timing.mjs";

// how far an edge is moved to where its sound begins or ends: past that the sound is something
// else, a breath, a laugh, another voice
export const REACH = 0.4;
// how long the stretch between two words may be for them to meet in it when the sound runs through
export const JOIN = 0.5;
// a frame is quiet under this share of loud speech (the 95th percentile of the envelope) …
const SHARE = 0.08;
// … or under this many times the ground the sound never goes below (its 10th percentile) in the
// AROUND seconds to either side: with noise, voices or music under the speech nothing is ever
// under 8 % of loud speech. On the call with pink noise 15 dB under the speech the edges of 19 %
// of the words were more than 100 ms off, 32 % as the model gave them, 30 % with the share alone,
// which moved edges into the noise.
const GROUND = 2, AROUND = 3;

export function quietLevels(env) {
  const n = env.length, per = Math.round(1 / HOP);
  const sorted = Float32Array.from(env).sort();
  const loud = n ? sorted[Math.floor(0.95 * (n - 1))] : 0;
  const out = new Float32Array(Math.ceil(n / per));
  for (let s = 0; s < out.length; s++) {
    const around = Float32Array.from(env.subarray(Math.max(0, (s - AROUND) * per), Math.min(n, (s + AROUND + 1) * per))).sort();
    out[s] = Math.max(SHARE * loud, GROUND * around[Math.floor(0.1 * (around.length - 1))]);
  }
  return out;
}

export function edged(words, env) {
  if (!words.length || !env || !env.length) return 0;
  if (!words.every((w) => Number.isFinite(w.start) && Number.isFinite(w.end))) return 0;
  const n = env.length, per = Math.round(1 / HOP);
  const quiet = quietLevels(env);
  const isQuiet = (f) => env[f] <= quiet[Math.min(quiet.length - 1, Math.floor(f / per))];
  const frame = (t) => Math.max(0, Math.min(n, Math.round(t / HOP)));
  const seconds = (f) => +(f * HOP).toFixed(2);
  const reach = Math.round(REACH / HOP), join = Math.round(JOIN / HOP);
  const was = words.map((w) => [w.start, w.end]);
  for (let i = 0; i <= words.length; i++) {
    const before = words[i - 1], after = words[i];
    const from = before ? frame(before.end) : Math.max(0, frame(after.start) - reach);
    const to = after ? frame(after.start) : Math.min(n, frame(before.end) + reach);
    if (to - from < 2) continue;
    let first = -1, last = -1;
    for (let f = from; f < to; f++) if (isQuiet(f)) { if (first < 0) first = f; last = f; }
    if (first < 0) {
      // sound all the way: the two meet where it is weakest
      if (!before || !after || to - from > join) continue;
      let weakest = from;
      for (let f = from; f <= Math.min(n - 1, to); f++) if (env[f] < env[weakest]) weakest = f;
      const at = Math.min(after.end, Math.max(before.start, seconds(weakest)));
      before.end = at; after.start = at;
      continue;
    }
    if (before && from < first && first - from <= reach) before.end = seconds(first);
    if (after && last < to - 1 && to - 1 - last <= reach) after.start = seconds(last + 1);
  }
  return words.filter((w, i) => Math.abs(w.start - was[i][0]) > 0.004 || Math.abs(w.end - was[i][1]) > 0.004).length;
}
