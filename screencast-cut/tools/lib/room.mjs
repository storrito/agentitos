// The recording's own room, for the voice's muted pieces (a keep held past its last word, a pause
// shown muted, a stretch "at" a time). Silence there was a hole: samples at zero where every pause
// of the recording carries the room (the run of 2026-11-19: 0.3 s at −120 dB in the middle of a
// sentence, the ordinary pauses at −44 dB; "clearly audible"). The recording's sound itself cannot
// run on: past 0.12 s after the last word comes the next word, or a cut "uh".
//
//   chooseTone(x, sr, words)          the stretches to take: from the gaps between the words, those
//                                     that serve, the quietest first; or { why } where none does
//   lay(xs, sr)                       the stretches one after the other, each once, crossfaded,
//                                     each at the first one's level
//   roomTone(file, words, out, need)  both, on a voice file: a WAV of its room, `need` seconds or
//                                     as much as the recording has
//
// No stretch is heard twice in one piece: a loop of 0.38 s over a hold of 3 s was heard as a slow
// whoosh (the review of pull request 118: the level dipping 4–5 dB at every seam, 2.6 times a
// second). A piece longer than the room the recording has fades out over FADE_OUT at its end
// (tracks.voiceTrack) and is silent after it.
//
// The stretches are taken from the voice before its pauses are lowered (sources.json "voice", not
// voice.clean.m4a): what the film plays in its short pauses is that level, the room as recorded.

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { samples, SR } from "./media.mjs";

// inside a gap this far from the word before and after it: a word fades out (cutAfter takes up to
// 0.14 s past the voice), a breath comes before the next
const AFTER = 0.15, BEFORE = 0.12;
// a stretch shorter than this is too little room to be worth a seam
const SHORTEST = 0.25;
// quiet enough: its loud moments (90th percentile of 10 ms frames) 22 dB under the loud speech
// (the 95th percentile of the whole voice's frames), as voice.mjs' threshold sets a voice apart
const UNDER = 0.08;
// digital silence: a frame under −100 dBFS, or a run of zero samples longer than 5 ms
const ZERO_RUN = 0.005, SILENT = 1e-5;
// steady: no window of TICK s louder than STEADY (6 dB) over the median of its windows. A tick of
// 4 ms 9.5 dB over the room's peaks got through 10 ms frames and 12 dB (the review); steady room
// noise stays within about 3 dB of its median in such windows
const TICK = 0.0025, STEADY = 2;
// a stretch whose level lies further than this from the quietest one is another room (a fan
// switched on), not used; the others are brought to the quietest's level
const ALIKE = 6;
export const XFADE = 0.03, FADE_OUT = 0.3;

const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
function frames(x, sr, a, b, len = 0.01) {
  const hop = Math.max(1, Math.round(sr * len)), out = [];
  for (let i = Math.max(0, Math.round(a * sr)); i + hop <= Math.min(x.length, Math.round(b * sr)); i += hop) {
    let s = 0;
    for (let j = i; j < i + hop; j++) s += x[j] * x[j];
    out.push(Math.sqrt(s / hop));
  }
  return out;
}
const pct = (v, q) => { const s = [...v].sort((p, r) => p - r); return s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0; };
const rmsOf = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length));
function zeroRun(x, sr, a, b) {
  let run = 0, most = 0;
  for (let i = Math.max(0, Math.round(a * sr)); i < Math.min(x.length, Math.round(b * sr)); i++) {
    run = x[i] === 0 ? run + 1 : 0;
    if (run > most) most = run;
  }
  return most / sr;
}

// x: the voice's samples (mono, sr); words: every word, filler and sound of the recording with
// start and end. The gaps between neighbouring items of one recording (a sound, "[clicks]", is no
// gap), AFTER/BEFORE inside them, SHORTEST long at least; of those neither digitally silent nor as
// loud as speech nor with a tick in it, and within ALIKE dB of the quietest: by their loud moments,
// the quietest first, the earliest of equals.
// → { stretches: [{ from, to, rms (dBFS) }], from, to, rms (the first's) } or { why }: the clause
export function chooseTone(x, sr, words) {
  const items = [...words].filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end)).sort((a, b) => a.start - b.start || a.end - b.end);
  const loud = pct(frames(x, sr, 0, x.length / sr), 0.95);
  const gaps = [];
  let reach = -Infinity, prev = null;
  for (const w of items) {
    if (prev && prev.session === w.session && w.start - reach >= AFTER + BEFORE + SHORTEST) gaps.push([reach + AFTER, w.start - BEFORE]);
    reach = Math.max(reach, w.end);
    prev = w;
  }
  if (!gaps.length) return { why: `the recording has no pause between its words of ${(AFTER + BEFORE + SHORTEST).toFixed(2)} s or more to take its room from` };
  const good = [];
  let silent = 0, busy = 0;
  for (const [a, b] of gaps) {
    const f = frames(x, sr, a, b);
    if (f.length * 0.01 < SHORTEST - 0.011) continue;
    if (pct(f, 0.1) < SILENT || zeroRun(x, sr, a, b) > ZERO_RUN) { silent++; continue; }
    const level = pct(f, 0.9), ticks = frames(x, sr, a, b, TICK);
    if (!(level <= loud * UNDER) || Math.max(...ticks) > STEADY * pct(ticks, 0.5)) { busy++; continue; }
    good.push({ from: +a.toFixed(3), to: +b.toFixed(3), level, rms: +db(rmsOf(f)).toFixed(1) });
  }
  if (!good.length) return { why: silent >= busy ? "the recording is digitally silent between its words, so there is no room to take" : "the recording's pauses carry speech, music or clicks, none quiet and steady enough to serve as its room" };
  good.sort((p, q) => p.level - q.level || p.from - q.from);
  const stretches = good.filter((s) => db(s.level) - db(good[0].level) <= ALIKE).map(({ from, to, rms }) => ({ from, to, rms }));
  return { stretches, ...stretches[0] };
}

// The stretches xs (arrays of samples) one after the other, each once: the second and later each
// brought to the first one's level and crossfaded into the one before over XFADE (equal power: two
// stretches of room do not correlate). No fade at the ends: the piece gives those.
export function lay(xs, sr) {
  const target = rmsOf(xs[0]);
  const c = Math.round(XFADE * sr);
  // the overlap with the one before: XFADE, or a quarter of the shorter of the two
  const overlap = xs.map((x, k) => (k ? Math.min(c, Math.floor(x.length / 4), Math.floor(xs[k - 1].length / 4)) : 0));
  const y = new Float32Array(xs.reduce((t, x, k) => t + x.length - overlap[k], 0));
  let at = 0;
  xs.forEach((x, k) => {
    const g = k ? target / (rmsOf(x) || target) : 1, o = overlap[k], start = at - o;
    for (let j = 0; j < o; j++) y[start + j] *= Math.cos((Math.PI / 2) * ((j + 0.5) / o));
    for (let j = 0; j < x.length; j++) y[start + j] += (j < o ? Math.sin((Math.PI / 2) * ((j + 0.5) / o)) : 1) * g * x[j];
    at = start + x.length;
  });
  return y;
}

export function wav(file, y, sr) {
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + y.length * 4, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(3, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(sr, 24); head.writeUInt32LE(sr * 4, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(32, 34);
  head.write("data", 36); head.writeUInt32LE(y.length * 4, 40);
  fs.writeFileSync(file, Buffer.concat([head, Buffer.from(y.buffer, y.byteOffset, y.byteLength)]));
}

// The room of the voice file `file` as a WAV at 48 kHz (out): the stretches chosen from the gaps
// between `words`, the quietest first, as many as `need` seconds take (and FADE_OUT beyond, for a
// piece that outlasts them), each once. Never stops a build: whatever goes wrong is a clause.
// → { file, seconds (of room in the file), from, to, rms (the first stretch's, whole band), used
// (stretches), key } or { why }
export function roomTone(file, words, out, need) {
  try {
    const t = chooseTone(samples(file), SR, words);
    if (t.why) return t;
    const sr = 48000, xs = [], used = [];
    let have = 0;
    for (const s of t.stretches) {
      if (have >= need + FADE_OUT) break;
      const raw = execFileSync("ffmpeg", ["-v", "error", "-ss", String(s.from), "-t", String(+(s.to - s.from).toFixed(3)), "-i", file, "-vn", "-ac", "1", "-ar", String(sr), "-f", "f32le", "-"], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
      const x = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength - (raw.byteLength % 4)));
      if (x.length < sr * 0.1 || !(rmsOf(x) > 0)) continue;
      xs.push(x); used.push(s);
      have += x.length / sr - (xs.length > 1 ? XFADE : 0);
    }
    if (!xs.length) return { why: "the room could not be read from the recording" };
    const y = lay(xs, sr);
    const rms = +db(rmsOf(xs[0])).toFixed(1), seconds = +(y.length / sr).toFixed(3);
    if (!Number.isFinite(rms) || !(seconds > 0) || y.some((v) => !Number.isFinite(v))) return { why: "the room taken from the recording made no sense (no level)" };
    wav(out, y, sr);
    return { from: used[0].from, to: used[0].to, rms, seconds, used: used.length, file: out,
      key: [file, fs.statSync(file).mtimeMs, used.map((s) => [s.from, s.to]), seconds] };
  } catch (e) {
    return { why: `the room could not be taken from the recording (${String(e.message || e).split("\n")[0].slice(0, 160)})` };
  }
}
