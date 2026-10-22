// What the sound itself says: where a voice is (an energy envelope in 10 ms frames), where a
// word really is when the recognizer timed it wrongly, where to cut between two words, and how
// loud a stretch is (EBU R128, from ffmpeg's ebur128 filter).

import { spawnSync } from "node:child_process";
import { SR } from "./media.mjs";

export const HOP = 0.01;

export function envelope(x) {
  const hop = Math.round(SR * HOP), n = Math.floor(x.length / hop);
  const env = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) s += x[i] * x[i];
    env[f] = Math.sqrt(s / hop);
  }
  // 30 ms of smoothing, so that one frame of flicker is no boundary
  const sm = new Float32Array(n);
  for (let f = 0; f < n; f++) sm[f] = (env[Math.max(0, f - 1)] + env[f] + env[Math.min(n - 1, f + 1)]) / 3;
  return sm;
}

// a voice is above ~8 % of loud speech (the 95th percentile of the envelope)
export function threshold(env) {
  const sorted = Float32Array.from(env).sort();
  return Math.max((sorted[Math.floor(sorted.length * 0.95)] || 1e-4) * 0.08, 0.004);
}

const frame = (env, t) => Math.max(0, Math.min(env.length - 1, Math.round(t / HOP)));

// stretches of voice in [a, b]: above the threshold, holes under 80 ms closed, 60 ms at least
function voiced(env, thr, a, b) {
  const out = [];
  let on = -1, hole = 0;
  const end = frame(env, b);
  for (let f = frame(env, a); f <= end; f++) {
    if (env[f] > thr) { if (on < 0) on = f; hole = 0; }
    else if (on >= 0 && ++hole > 8) { out.push([on, f - hole + 1]); on = -1; hole = 0; }
  }
  if (on >= 0) out.push([on, end - hole + 1]);
  return out.filter(([s, e]) => e - s >= 6).map(([s, e]) => [s * HOP, e * HOP]);
}

// A recognizer sometimes times words wrongly next to a noise: a few words squeezed into 40 ms
// right before the next one although they were said a second earlier, or one word stretched
// over a pause. Such words are put where the voice is: a run of squeezed words on the last
// stretches of voice before the next well-timed word (one each, or shared by their letters),
// a stretched word from where its voice sets in. Returns how many words moved.
export function retime(words, env, thr) {
  const speech = (w) => w.kind === "word" || w.kind === "filler";
  const letters = (w) => Math.max(1, w.text.replace(/[^\p{L}\p{N}]/gu, "").length);
  const squeezed = (w) => speech(w) && w.end - w.start < 0.06 && letters(w) >= 2;
  let moved = 0;
  for (let i = 0; i < words.length; i++) {
    if (!squeezed(words[i])) continue;
    let j = i;
    while (j + 1 < words.length && (squeezed(words[j + 1]) || !speech(words[j + 1]))) j++;
    const run = words.slice(i, j + 1).filter(speech);
    let k = i - 1;
    while (k >= 0 && !speech(words[k])) k--;
    const a = k >= 0 ? words[k].end : 0, b = j + 1 < words.length ? words[j + 1].start : env.length * HOP;
    const spans = voiced(env, thr, a + 0.02, b - 0.02);
    if (spans.length >= run.length) {
      spans.slice(-run.length).forEach(([s, e], n) => { run[n].start = +s.toFixed(2); run[n].end = +e.toFixed(2); });
      moved += run.length;
    } else if (spans.length) {
      // fewer stretches than words: the words share the voiced time by their letters
      const total = spans.reduce((t, [s, e]) => t + e - s, 0), sum = run.reduce((t, w) => t + letters(w), 0);
      let at = 0;
      const place = (x) => { for (const [s, e] of spans) { if (x <= e - s) return s + x; x -= e - s; } return spans.at(-1)[1]; };
      for (const w of run) { w.start = +place(at).toFixed(2); at += (total * letters(w)) / sum; w.end = +place(at).toFixed(2); }
      moved += run.length;
    }
    i = j;
  }
  for (const w of words) {
    if (!speech(w) || w.end - w.start <= Math.max(0.8, 0.12 * letters(w) + 0.35)) continue;
    const spans = voiced(env, thr, w.start, w.end);
    const last = spans.at(-1);
    if (last && last[0] > w.start + 0.2) { w.start = +last[0].toFixed(2); moved++; }
  }
  return moved;
}

// The cut before a word that starts at `start`, the last sound before it ending at `lo`. With a
// pause between them: just before the voice sets in (onset found in the envelope, not the
// recognizer's guess), but never more than half the pause back. Without one: the quietest
// moment around the word's start.
export function cutBefore(env, thr, start, lo) {
  const gap = start - lo;
  if (gap < 0.2) return quietest(env, Math.max(lo - 0.03, start - 0.12), start + 0.03);
  let f = frame(env, start);
  const stop = frame(env, Math.max(lo + gap / 2, start - 0.25));
  while (f > stop && env[f - 1] > thr) f--;
  return Math.max(lo + gap / 2, f * HOP - 0.1);
}

// The cut after a word that ends at `end`, the next sound starting at `hi`: mirror of cutBefore,
// with a little more room, since words fade out (a voiced end, a breath of an "s").
export function cutAfter(env, thr, end, hi) {
  const gap = hi - end;
  if (gap < 0.2) return quietest(env, end - 0.03, Math.min(hi + 0.03, end + 0.12));
  let f = frame(env, end);
  const stop = frame(env, Math.min(hi - gap / 2, end + 0.3));
  while (f < stop && env[f + 1] > thr) f++;
  return Math.min(hi - gap / 2, f * HOP + 0.14);
}

function quietest(env, a, b) {
  let best = frame(env, a);
  for (let f = best; f <= frame(env, b); f++) if (env[f] < env[best]) best = f;
  return best * HOP;
}

// momentary loudness (400 ms blocks every 100 ms) of a file: [{ t: block end, m: LUFS }]
export function loudnessBlocks(file) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "ebur128=framelog=info", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
  const out = [];
  for (const m of r.stderr.matchAll(/t:\s*([\d.]+)\s+TARGET:\S+ LUFS\s+M:\s*(-?[\d.]+)/g)) out.push({ t: +(+m[1]).toFixed(2), m: +m[2] });
  return out;
}

// integrated loudness of the stretches [[a, b], …] of one file, gated as EBU R128 does
// (blocks under −70 LUFS out, then those 10 LU under the mean): what a listener hears as its level
export function loudness(blocks, spans) {
  const inside = blocks.filter((k) => spans.some(([a, b]) => k.t - 0.4 >= a - 0.05 && k.t <= b + 0.05) && k.m > -70);
  const mean = (ks) => 10 * Math.log10(ks.reduce((s, k) => s + 10 ** (k.m / 10), 0) / ks.length);
  if (!inside.length) return null;
  const abs = mean(inside), gated = inside.filter((k) => k.m > abs - 10);
  return +mean(gated.length ? gated : inside).toFixed(1);
}
