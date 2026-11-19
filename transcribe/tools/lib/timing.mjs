// Whether the words are where the voice is. A recognizer writes the words well and times most
// of them well, but not all: next to a noise it squeezes a few words into 40 ms, it stretches a
// word over a pause, now and then it puts one into silence; and some recognizers give one time
// per word and no length at all. The recording's own sound settles it: an energy envelope in
// 10 ms frames says where a voice is, every word is checked against it, and only the words it
// contradicts are moved, between their well-timed neighbours.
//
//   envelopeOf(file)            → Float32Array, the loudness of every 10 ms (ffmpeg, streamed)
//   threshold(env)              → the level above which a frame is voice
//   bare(words)                 → { speech, bare }: how many words came without a length
//   islands(env, thr, a, b)     → [{ start, end, weight }]: the voice in [a, b], and how much of it
//   check(words, env, thr)      → { speech, squeezed, stretched, silent, inVoice, off: [i, …] }
//   repair(words, env, thr)     → { moved, guessed: [[i, j], …] }; a moved word gets by: "sound"
//   unwritten(words, env, thr)  → [{ from, to, voiced, after }]: voice between two words that no word
//                                  covers, as loud as speech, for UNWRITTEN seconds at least
//
// Words are { text, start, end, kind } in seconds, in the order they were said.

import { spawn } from "node:child_process";

export const SR = 16000;
export const HOP = 0.01;

// The sound of `file` as its loudness in 10 ms frames. ffmpeg's samples are read as they come:
// an hour of sound is 115 MB of samples and 360,000 frames, and a Sprite has little memory.
export function envelopeOf(file) {
  return new Promise((resolve, reject) => {
    const hop = Math.round(SR * HOP);
    const frames = [];
    let rest = Buffer.alloc(0), sum = 0, n = 0, err = "";
    const p = spawn("ffmpeg", ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(SR), "-f", "s16le", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    p.stderr.on("data", (d) => { err += d; });
    p.stdout.on("data", (chunk) => {
      const buf = rest.length ? Buffer.concat([rest, chunk]) : chunk;
      const whole = buf.length - (buf.length % 2);
      for (let i = 0; i < whole; i += 2) {
        const x = buf.readInt16LE(i) / 32768;
        sum += x * x;
        if (++n === hop) { frames.push(Math.sqrt(sum / hop)); sum = 0; n = 0; }
      }
      rest = buf.subarray(whole);
    });
    p.on("error", (e) => reject(e.code === "ENOENT" ? new Error("ffmpeg is missing: this tool needs ffmpeg on the PATH") : e));
    p.on("close", (code) => {
      if (code) return reject(new Error(`ffmpeg could not read the sound of ${file}: ${err.trim().split("\n").pop() || `exit ${code}`}`));
      resolve(smooth(Float32Array.from(frames)));
    });
  });
}

// 30 ms of smoothing, so that one frame of flicker is no boundary
export function smooth(env) {
  const n = env.length, out = new Float32Array(n);
  for (let f = 0; f < n; f++) out[f] = (env[Math.max(0, f - 1)] + env[f] + env[Math.min(n - 1, f + 1)]) / 3;
  return out;
}

// a voice is above ~8 % of loud speech (the 95th percentile of the envelope)
export function threshold(env) {
  const sorted = Float32Array.from(env).sort();
  return Math.max((sorted[Math.floor(sorted.length * 0.95)] || 1e-4) * 0.08, 0.004);
}

const frame = (env, t) => Math.max(0, Math.min(env.length - 1, Math.round(t / HOP)));

// stretches of voice in [a, b]: above the threshold, holes under 80 ms closed, 60 ms at least
export function voiced(env, thr, a, b) {
  const out = [];
  if (!(b > a) || !env.length) return out;
  let on = -1, hole = 0;
  const end = frame(env, b);
  for (let f = frame(env, a); f <= end; f++) {
    if (env[f] > thr) { if (on < 0) on = f; hole = 0; }
    else if (on >= 0 && ++hole > 8) { out.push([on, f - hole + 1]); on = -1; hole = 0; }
  }
  if (on >= 0) out.push([on, end - hole + 1]);
  return out.filter(([s, e]) => e - s >= 6).map(([s, e]) => [s * HOP, e * HOP]);
}

// how much of [a, b] is voice, 0 to 1
function share(env, thr, a, b) {
  const f0 = frame(env, a), f1 = Math.max(f0, frame(env, b));
  let on = 0;
  for (let f = f0; f <= f1; f++) if (env[f] > thr) on++;
  return on / (f1 - f0 + 1);
}

// Islands of voice in [a, b]: the stretches, those under 150 ms apart joined (the stop inside a
// word, the breath between two words), each with its weight: its loudness summed over its time.
// A click, a key or a breath in a pause is an island too, but a light one.
export function islands(env, thr, a, b) {
  const out = [];
  for (const [s, e] of voiced(env, thr, a, b)) {
    const last = out.at(-1);
    if (last && s - last.end < 0.15) last.end = e; else out.push({ start: s, end: e });
  }
  for (const x of out) x.weight = weightOf(env, x.start, x.end);
  return out;
}

// the islands that can be words: a share of the heaviest one's weight at least (a third between
// words, where clicks and breaths are; inside a word's own time a soft start or a stutter counts)
function heavy(list, share = 0.33) {
  const top = Math.max(...list.map((x) => x.weight));
  return list.filter((x) => x.weight >= top * share);
}

const speech = (w) => w.kind === "word" || w.kind === "filler" || w.kind === undefined;
const letters = (w) => Math.max(1, String(w.text).replace(/[^\p{L}\p{N}]/gu, "").length);
// longer than this no word of so many letters is said
const longest = (w) => Math.max(0.8, 0.12 * letters(w) + 0.35);

// What the checks call wrong.
// squeezed: under 60 ms for two letters or more.
const squeezed = (w) => speech(w) && w.end - w.start < 0.06 && letters(w) >= 2;
// how loud [a, b] is in all
function weightOf(env, a, b) {
  let sum = 0;
  for (let f = frame(env, a); f < frame(env, b); f++) sum += env[f];
  return sum * HOP;
}

// Drawn over a pause: its voice sets in 0.3 s after its start, or ends 0.45 s before its end (a
// word's last sound fades under the threshold, so the end gets more room), or it lasts longer
// than such a word is said. → { time, sure }: the time its voice has; or null.
//   - one end silent: the other end is right, the word is the voice next to it;
//   - voice at both ends of too long a time (a click or a breath in the pause): the louder end
//     wins, a guess (sure: false).
function drawn(w, env, thr) {
  if (!speech(w) || squeezed(w)) return null;
  const all = islands(env, thr, w.start, w.end);
  if (!all.length) return null;
  const real = heavy(all, 0.15), L = longest(w);
  const late = real[0].start - w.start > 0.3, early = w.end - real.at(-1).end > 0.45;
  const long = w.end - w.start > L + 0.2;
  if (!late && !early && !long) return null;
  const fromEnd = () => {
    const near = real.filter((x) => x.end > w.end - L);
    const s = (near[0] || real.at(-1)).start;
    return { time: [Math.max(s, w.end - L), w.end], sure: s >= w.end - L };
  };
  const fromStart = () => {
    const near = real.filter((x) => x.start < w.start + L);
    const e = (near.at(-1) || real[0]).end + 0.03;
    return { time: [w.start, Math.min(e, w.start + L)], sure: e <= w.start + L };
  };
  if (late && !early) return fromEnd();
  if (early && !late) return fromStart();
  if (late && early) return home(all, w);
  const pick = weightOf(env, w.end - L, w.end) > weightOf(env, w.start, w.start + L) ? fromEnd() : fromStart();
  return { time: pick.time, sure: false };
}
// in silence: no voice at all in its time
const silent = (w, env, thr) => speech(w) && !squeezed(w) && share(env, thr, w.start - 0.03, w.end + 0.03) === 0;

// How many words came without a length: a recognizer that gives one time per word (start = end,
// or the 40 ms a caller pads it to) does not say when a word ends, and its one time is not
// always the word's start. Such words cannot be repaired from the sound, only guessed.
export function bare(words) {
  const said = words.filter(speech);
  return { speech: said.length, bare: said.filter((w) => w.end - w.start <= 0.045).length };
}

// Every word against the sound. `inVoice` is the share of the words the sound does not
// contradict; `off` are the indices of the others.
export function check(words, env, thr) {
  const out = { speech: 0, squeezed: 0, stretched: 0, silent: 0, inVoice: 1, off: [] };
  words.forEach((w, i) => {
    if (!speech(w)) return;
    out.speech++;
    const what = squeezed(w) ? "squeezed" : silent(w, env, thr) ? "silent" : drawn(w, env, thr) ? "stretched" : null;
    if (what) { out[what]++; out.off.push(i); }
  });
  out.inVoice = out.speech ? +(1 - out.off.length / out.speech).toFixed(4) : 1;
  return out;
}

const set = (w, start, end) => { w.start = +start.toFixed(2); w.end = +Math.max(end, start + 0.04).toFixed(2); w.by = "sound"; };

// The time of one word among the islands of a window: from the first to the last that can be a
// word. When that is longer than the word can be said, the heaviest alone, and that is a guess
// (sure: false): the voice may be another word the recognizer left out.
function home(list, w) {
  const real = heavy(list);
  if (real.at(-1).end - real[0].start <= longest(w)) return { time: [real[0].start, real.at(-1).end], sure: true };
  const top = real.reduce((m, x) => (x.weight > m.weight ? x : m));
  return { time: [top.start, top.end], sure: false };
}

// the window a word may lie in: from the end of the word before it to the start of the one after
function between(words, i, j, total) {
  let k = i - 1, next = j + 1;
  while (k >= 0 && !speech(words[k])) k--;
  while (next < words.length && !speech(words[next])) next++;
  return [(k >= 0 ? words[k].end : 0) + 0.02, (next < words.length ? words[next].start : total) - 0.02];
}

// The words the sound contradicts, put where the voice is. Returns how many moved, and the
// runs [i, j] whose place is a guess (words that had to share the voice by their letters, a word
// with several stretches of voice to choose from): good enough to caption by, and the first to
// hear again.
//
//   - a squeezed word: onto the voice between the words around it;
//   - a run of squeezed words: one island of voice each when there are as many as words, else
//     they share the islands' time by their letters (a guess);
//   - a word drawn over a pause: onto the time its voice has;
//   - a word in silence: onto the voice between the words around it, when there is some.
//
// A click or a breath in a pause is voice to the threshold: among several islands the heavy
// ones count (loudness times length), the light ones beside them do not.
export function repair(words, env, thr) {
  let moved = 0;
  const guessed = [];
  const total = env.length * HOP;
  for (let i = 0; i < words.length; i++) {
    if (!squeezed(words[i])) continue;
    let j = i;
    while (j + 1 < words.length && (squeezed(words[j + 1]) || !speech(words[j + 1]))) j++;
    while (j > i && !speech(words[j])) j--;
    const run = words.slice(i, j + 1).filter(speech);
    const list = islands(env, thr, ...between(words, i, j, total));
    if (list.length && run.length === 1) {
      const { time, sure } = home(list, run[0]);
      set(run[0], ...time);
      if (!sure) guessed.push([i, j]);
      moved++;
    } else if (list.length) {
      const real = heavy(list);
      if (real.length === run.length) real.forEach((x, n) => set(run[n], x.start, x.end));
      else {
        const time = real.reduce((t, x) => t + x.end - x.start, 0), sum = run.reduce((t, w) => t + letters(w), 0);
        const place = (t) => { for (const x of real) { if (t <= x.end - x.start) return x.start + t; t -= x.end - x.start; } return real.at(-1).end; };
        let at = 0;
        for (const w of run) { const from = place(at); at += (time * letters(w)) / sum; set(w, from, place(at)); }
        guessed.push([i, j]);
      }
      moved += run.length;
    }
    i = j;
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!silent(w, env, thr)) continue;
    const list = islands(env, thr, ...between(words, i, i, total));
    if (!list.length) continue;
    const { time, sure } = home(list, w);
    set(w, ...time);
    if (!sure) guessed.push([i, i]);
    moved++;
  }
  words.forEach((w, i) => {
    const d = drawn(w, env, thr);
    if (!d) return;
    set(w, ...d.time);
    if (!d.sure) guessed.push([i, i]);
    moved++;
  });
  guessed.sort((a, b) => a[0] - b[0]);
  return { moved, guessed };
}

// Speech the recognizer wrote no words for. Read aloud with retries ("the new app, the new app
// opens, the new, the new app opens faster"), Scribe now and then
// writes only some of the attempts, and the time of the others lies between its words as if it
// were a pause: 18, 27 and 132 of the 641 words of a six-minute narration in three of seven
// transcriptions (2026-11-18). Between two words (and before the first, after the last; a noise
// covers its own time), the voice there: frames above the threshold and twice the ground of the sound (its 10th
// percentile, for noise under the speech), stretches under 150 ms apart joined, each as loud as
// speech (LEVEL times the median word's level: a breath or a click is not). Where it lasts
// UNWRITTEN seconds at least, the stretch is speech not written down. On that narration the
// stretches with missing words held 0.33 to 7 s of such voice, those of the complete
// transcriptions 0.10 s at most.
// → [{ from, to, voiced, after }]: its first and last voice, how many seconds of voice, and the
// index of the word before it (−1 before the first)
export const UNWRITTEN = 0.25;
const LEVEL = 0.3;
export function unwritten(words, env, thr) {
  const out = [];
  if (!env.length || !words.length) return out;
  const sorted = Float32Array.from(env).sort();
  const on = Math.max(thr, 2 * sorted[Math.floor(0.1 * (sorted.length - 1))]);
  const mean = (a, b) => {
    const f0 = frame(env, a), f1 = Math.max(f0 + 1, frame(env, b));
    let s = 0;
    for (let f = f0; f < f1; f++) s += env[f];
    return s / (f1 - f0);
  };
  const levels = words.filter((w) => w.kind === "word" || w.kind === undefined).map((w) => mean(w.start, w.end)).sort((a, b) => a - b);
  if (!levels.length) return out;
  const loud = LEVEL * levels[Math.floor(levels.length / 2)];
  const total = env.length * HOP;
  // what lies between `a` and `b`, after the word `after`
  const look = (a, b, after) => {
    if (b - a < UNWRITTEN + 0.06) return;
    const isl = [];
    for (const [s, e] of voiced(env, on, a + 0.03, b - 0.03)) {
      const last = isl.at(-1);
      if (last && s - last[1] < 0.15) last[1] = e; else isl.push([s, e]);
    }
    const heard = isl.filter(([s, e]) => mean(s, e) >= loud);
    const time = heard.reduce((t, [s, e]) => t + e - s, 0);
    if (time >= UNWRITTEN) out.push({ from: +heard[0][0].toFixed(2), to: +heard.at(-1)[1].toFixed(2), voiced: +time.toFixed(2), after });
  };
  let end = 0;
  words.forEach((w, i) => {
    look(end, w.start, i - 1);
    end = Math.max(end, w.end);
  });
  look(end, total, words.length - 1);
  return out;
}
