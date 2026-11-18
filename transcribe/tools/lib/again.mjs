// A doubtful stretch heard again, alone. Where the sound could only guess (a run of words that
// had to share the voiced time by their letters) or still contradicts a word, the stretch with a
// few words around it is cut out and transcribed once more: a recognizer that lost its place in
// ten minutes of sound usually finds it in ten seconds. Its times are taken only when it wrote
// the same words and agrees with the well-timed words around them; else the guess stays.
//
//   stretches(words, spots)                    → [{ i, j, from, to }] : the spots [i, j] with their surroundings, merged
//   adopt(words, stretch, heard)               → how many words of the stretch took the second hearing's times
//   hearAgain(file, words, spots, hear, log)   → { heard, stretches }; `hear(file, seconds)` → words of a short file
//   fillIn(file, words, gaps, hear, log)       → { added, stretches, left }: speech no word covers (timing.mjs'
//                                                unwritten) heard again, its words put in
//   written(words, gap, heard)                 → the words of a second hearing that belong into the gap
//
// Speech not written down (lib/timing.mjs' unwritten) is heard again the same way: the stretch
// with two words on either side, alone. What the second hearing writes inside it goes into the
// words, `"by": "second hearing", "added": true`, when its clock agrees with ours: a word of
// the context it also wrote lies within AGREE of where it is (at least one on each side that has
// words). A recognizer that skipped two attempts of a sentence in five minutes writes them in
// five seconds: on a narration read with retries (2026-11-18) 137 of the 177 words three
// transcriptions had left out came back, for $0.014 (see the README).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const AROUND = 3;      // words of context on either side
const PAD = 0.35;      // seconds of sound before the first and after the last of them
const MOST = 8;        // stretches heard again per recording
const AGREE = 0.25;    // how far a well-timed word of the context may lie from its second hearing

const speech = (w) => w.kind === "word" || w.kind === "filler" || w.kind === undefined;
const norm = (w) => String(w.text).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

// The spots with their surroundings, in the order of the recording, those that touch merged.
export function stretches(words, spots) {
  const out = [];
  for (const [i, j] of [...spots].sort((a, b) => a[0] - b[0])) {
    const a = Math.max(0, i - AROUND), b = Math.min(words.length - 1, j + AROUND);
    const last = out.at(-1);
    if (last && a <= last.b + 1) { last.j = Math.max(last.j, j); last.b = Math.max(last.b, b); }
    else out.push({ i, j, a, b });
  }
  return out.map((s) => ({ i: s.i, j: s.j, a: s.a, b: s.b, from: Math.max(0, words[s.a].start - PAD), to: words[s.b].end + PAD }));
}

// the longest common run of tokens of x and y as pairs [index in x, index in y]
function common(x, y) {
  const n = x.length, m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const pairs = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (x[i] === y[j]) { pairs.push([i, j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  return pairs;
}

// The second hearing's times for the doubtful words [i, j] of a stretch, when it can be
// trusted: it wrote every one of them, with a length, between the words before and after them,
// and the well-timed words of the context it also wrote lie where they were. `heard` has its
// times on the recording's clock.
export function adopt(words, stretch, heard) {
  const mine = [];
  for (let k = stretch.a; k <= stretch.b; k++) if (speech(words[k])) mine.push(k);
  const theirs = heard.filter(speech);
  const pairs = common(mine.map((k) => norm(words[k])), theirs.map(norm)).map(([x, y]) => [mine[x], theirs[y]]);
  const doubtful = (k) => k >= stretch.i && k <= stretch.j;
  const wanted = mine.filter(doubtful);
  const got = pairs.filter(([k]) => doubtful(k));
  if (!wanted.length || got.length !== wanted.length) return 0;
  if (got.some(([, h]) => h.end - h.start <= 0.045)) return 0;
  const context = pairs.filter(([k]) => !doubtful(k) && !words[k].by);
  if (!context.length || context.some(([k, h]) => Math.abs(words[k].start - h.start) > AGREE)) return 0;
  const before = mine.filter((k) => k < stretch.i).at(-1), after = mine.find((k) => k > stretch.j);
  const lo = before === undefined ? -Infinity : words[before].end - AGREE, hi = after === undefined ? Infinity : words[after].start + AGREE;
  if (got.some(([, h]) => h.start < lo || h.end > hi)) return 0;
  for (const [k, h] of got) { words[k].start = +h.start.toFixed(2); words[k].end = +h.end.toFixed(2); words[k].by = "second hearing"; }
  return got.length;
}

// words of context on either side of a stretch not written down: two, and where that hearing
// writes nothing there, once more with six (a recognizer that skipped retries in five minutes
// may skip them in ten seconds too, and not in twenty)
const SIDES = [2, 6];
export const MOST_GAPS = 60;   // such stretches heard again per recording, four at a time

// The words of a second hearing (on the recording's clock) that belong into `gap` (after the
// word `gap.after`, timing.mjs' unwritten): those that lie between the words around it and are
// none of them; [] when the context does not agree. Each is clipped to its room, has a length,
// and carries the kind the recognizer gave it. The room is where the words around it ended and
// began before their edges were set (`was`: word → [start, end]): an edge drawn outward over the
// first or last sound of a skipped attempt does not take it.
export function written(words, gap, heard, side = SIDES[0], was = new Map()) {
  const prev = words[gap.after], next = words[gap.after + 1];
  const lo = prev ? Math.min(prev.end, was.get(prev)?.[1] ?? Infinity) : 0, hi = next ? Math.max(next.start, was.get(next)?.[0] ?? -Infinity) : Infinity;
  const context = (way) => (way < 0 ? words.slice(Math.max(0, gap.after - side + 1), gap.after + 1) : words.slice(gap.after + 1, gap.after + 1 + side)).filter(speech);
  const agrees = (list) => !list.length || list.some((w) => heard.some((h) => norm(h) === norm(w) && Math.abs(h.start - w.start) <= AGREE));
  if (!agrees(context(-1)) || !agrees(context(1))) return [];
  const ours = [...context(-1), ...context(1)];
  return heard
    .filter((h) => h.start >= lo - 0.05 && h.end <= hi + 0.05 && h.end - h.start > 0.045 && norm(h))
    .filter((h) => !ours.some((w) => norm(w) === norm(h) && Math.abs(w.start - h.start) <= AGREE))
    .map((h) => ({ text: h.text, start: +Math.max(lo, h.start).toFixed(2), end: +Math.min(hi, h.end).toFixed(2), kind: h.kind ?? "word" }))
    .filter((h) => h.end - h.start > 0.045);
}

// The stretches not written down heard again, the words they get put in among the others (in
// place, by time; a word around it whose edge was drawn over one gives that room back). `gaps`
// as timing.mjs' unwritten gives them for these words; `was` the words' times before the edges.
export async function fillIn(file, words, gaps, hear, log = () => {}, was = new Map()) {
  const list = gaps.slice(0, MOST_GAPS);
  if (!list.length) return { added: 0, stretches: 0, left: gaps.length };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-fill-"));
  const found = [];
  try {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, list.length) }, async () => {
      while (next < list.length) {
        const k = next++, g = list[k];
        try {
          for (const side of SIDES) {
            const first = words[Math.max(0, g.after - side + 1)], last = words[Math.min(words.length - 1, g.after + side)];
            const from = Math.max(0, Math.min(g.from, first ? first.start : g.from) - PAD);
            const to = Math.max(g.to, last && g.after + 1 < words.length ? last.end : g.to) + PAD;
            const piece = path.join(tmp, `g${k}-${side}.flac`);
            await promisify(execFile)("ffmpeg", ["-v", "error", "-y", "-ss", from.toFixed(3), "-t", (to - from).toFixed(3), "-i", file, "-vn", "-map_metadata", "-1", "-ac", "1", "-ar", "16000", piece]);
            const again = await hear(piece, to - from);
            const got = written(words, g, again.map((w) => ({ ...w, start: w.start + from, end: w.end + from })), side, was);
            found.push(...got.map((w) => ({ ...w, after: g.after })));
            if (got.length) break;
          }
        } catch (e) { log(`  transcribe: speech at ${g.from.toFixed(1)} s was not heard again (${String(e.message).split("\n")[0]})`); }
      }
    }));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  // in by time, each after the word its gap follows; the speaker of the words around it when they
  // agree (of the one there is, at the recording's start or end)
  found.sort((a, b) => b.after - a.after || b.start - a.start);
  for (const { after, ...w } of found) {
    const prev = words[after], next = words[after + 1];
    let at = after + 1;
    while (at < words.length && words[at].added && words[at].start < w.start) at++;
    const who = prev && next ? (prev.speaker === next.speaker ? prev.speaker : null) : (prev ?? next)?.speaker;
    words.splice(at, 0, { ...w, ...(who ? { speaker: who } : {}), by: "second hearing", added: true });
    const before = words[at - 1], beyond = words[at + 1];
    if (before && !before.added && before.end > w.start) before.end = Math.max(before.start + 0.04, w.start);
    if (beyond && !beyond.added && beyond.start < w.end) beyond.start = Math.min(beyond.end - 0.04, w.end);
  }
  return { added: found.length, stretches: list.length, left: gaps.length - list.length };
}

export async function hearAgain(file, words, spots, hear, log = () => {}) {
  const list = stretches(words, spots).slice(0, MOST);
  if (!list.length) return { heard: 0, stretches: 0 };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-again-"));
  let heard = 0;
  try {
    for (const [n, s] of list.entries()) {
      const piece = path.join(tmp, `s${n}.flac`), seconds = s.to - s.from;
      await promisify(execFile)("ffmpeg", ["-v", "error", "-y", "-ss", s.from.toFixed(3), "-t", seconds.toFixed(3), "-i", file, "-vn", "-map_metadata", "-1", "-ac", "1", "-ar", "16000", piece]);
      let again;
      try { again = await hear(piece, seconds); } catch (e) { log(`  transcribe: a stretch at ${s.from.toFixed(1)} s was not heard again (${String(e.message).split("\n")[0]})`); continue; }
      heard += adopt(words, s, again.map((w) => ({ ...w, start: w.start + s.from, end: w.end + s.from })));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { heard, stretches: list.length };
}
