// The recording's own room, for the voice's muted pieces (a keep held past its last word, a pause
// shown muted, a stretch "at" a time). Silence there was a hole: samples at zero where every pause
// of the recording carries the room (the run of 2026-11-19: 0.3 s at −120 dB in the middle of a
// sentence, the ordinary pauses at −44 dB; "clearly audible"). The recording's sound itself cannot
// run on: past 0.12 s after the last word comes the next word, or a cut "uh".
//
//   chooseTone(x, sr, words)          the stretch to take: from the gaps between the words, the
//                                     quietest long enough; or { why } where none will do
//   loop(x, n, sr)                    a stretch brought to n samples: looped with short
//                                     crossfades where it is shorter
//   roomTone(file, words, out, need)  both, on a voice file: a WAV of `need` seconds of its room
//
// The stretch is taken from the voice before its pauses are lowered (sources.json "voice", not
// voice.clean.m4a): what the film plays in its short pauses is that level, the room as recorded.

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { samples, SR } from "./media.mjs";

// inside a gap this far from the word before and after it: a word fades out (cutAfter takes up to
// 0.14 s past the voice), a breath comes before the next
const AFTER = 0.15, BEFORE = 0.12;
// a stretch shorter than this is no room: a loop of it would be heard as a flutter
const SHORTEST = 0.25;
// quiet enough: its loud moments (90th percentile of 10 ms frames) 22 dB under the loud speech
// (the 95th percentile of the whole voice's frames), as voice.mjs' threshold sets a voice apart
const UNDER = 0.08;
// digital silence: a frame under −100 dBFS, or a run of zero samples longer than 5 ms
const ZERO_RUN = 0.005, SILENT = 1e-5;
const XFADE = 0.03;
const STEADY = 4;

const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
function frames(x, sr, a, b) {
  const hop = Math.round(sr * 0.01), out = [];
  for (let i = Math.max(0, Math.round(a * sr)); i + hop <= Math.min(x.length, Math.round(b * sr)); i += hop) {
    let s = 0;
    for (let j = i; j < i + hop; j++) s += x[j] * x[j];
    out.push(Math.sqrt(s / hop));
  }
  return out;
}
const pct = (v, q) => { const s = [...v].sort((p, r) => p - r); return s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0; };
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
// loud as speech nor with a click in it, the quietest by its loud moments, the earliest of equals.
// → { from, to, rms (dBFS) } or { why }: the clause for the build
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
  let best = null, silent = 0, busy = 0;
  for (const [a, b] of gaps) {
    const f = frames(x, sr, a, b);
    if (f.length * 0.01 < SHORTEST - 0.011) continue;
    if (pct(f, 0.1) < SILENT || zeroRun(x, sr, a, b) > ZERO_RUN) { silent++; continue; }
    // steady: no 10 ms frame 12 dB over the stretch's middle (a click, a key, a breath's start),
    // which a loop would repeat
    const level = pct(f, 0.9);
    if (!(level <= loud * UNDER) || Math.max(...f) > STEADY * pct(f, 0.5)) { busy++; continue; }
    if (!best || level < best.level) best = { from: a, to: b, level, rms: Math.sqrt(f.reduce((s, v) => s + v * v, 0) / f.length) };
  }
  if (!best) return { why: silent >= busy ? "the recording is digitally silent between its words, so there is no room to take" : "the recording's pauses carry speech, music or clicks, none quiet and steady enough to serve as its room" };
  return { from: +best.from.toFixed(3), to: +best.to.toFixed(3), rms: +db(best.rms).toFixed(1) };
}

// x brought to n samples: as it is where it is long enough, else copies of it one after the other,
// each crossfaded into the next over XFADE (equal power: two stretches of room do not correlate)
export function loop(x, n, sr) {
  const y = new Float32Array(n);
  if (x.length >= n) { y.set(x.subarray(0, n)); return y; }
  const c = Math.max(1, Math.min(Math.round(XFADE * sr), Math.floor(x.length / 4))), step = x.length - c;
  for (let at = 0; at < n; at += step) {
    for (let j = 0; j < x.length && at + j < n; j++) {
      const into = at > 0 && j < c, out = at + step < n && j >= step;
      const g = into ? Math.sin((Math.PI / 2) * ((j + 0.5) / c)) : out ? Math.cos((Math.PI / 2) * ((j - step + 0.5) / c)) : 1;
      y[at + j] += g * x[j];
    }
  }
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

// The room of the voice file `file` as a WAV of `need` seconds at 48 kHz (out), chosen from the
// gaps between `words`. → { file, from, to, rms, key } or { why }
export function roomTone(file, words, out, need) {
  const t = chooseTone(samples(file), SR, words);
  if (t.why) return t;
  const sr = 48000;
  const raw = execFileSync("ffmpeg", ["-v", "error", "-ss", String(t.from), "-t", String(+(t.to - t.from).toFixed(3)), "-i", file, "-vn", "-ac", "1", "-ar", String(sr), "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  const x = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength - (raw.byteLength % 4)));
  wav(out, loop(x, Math.ceil(need * sr) + sr / 10, sr), sr);
  // its level over the whole band (the choice heard it at 16 kHz, a room's hiss above 8 kHz aside)
  const rms = +db(Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length))).toFixed(1);
  return { ...t, rms, file: out, key: [file, fs.statSync(file).mtimeMs, t.from, t.to, +need.toFixed(3)] };
}
