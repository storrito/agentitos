// A doubtful stretch heard again, alone. Where the sound could only guess (a run of words that
// had to share the voiced time by their letters) or still contradicts a word, the stretch with a
// few words around it is cut out and transcribed once more: a recognizer that lost its place in
// ten minutes of sound usually finds it in ten seconds. Its times are taken only when it wrote
// the same words and agrees with the well-timed words around them; else the guess stays.
//
//   stretches(words, spots)                    → [{ i, j, from, to }] : the spots [i, j] with their surroundings, merged
//   adopt(words, stretch, heard)               → how many words of the stretch took the second hearing's times
//   hearAgain(file, words, spots, hear, log)   → { heard, stretches }; `hear(file, seconds)` → words of a short file

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

export async function hearAgain(file, words, spots, hear, log = () => {}) {
  const list = stretches(words, spots).slice(0, MOST);
  if (!list.length) return { heard: 0, stretches: 0 };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-again-"));
  let heard = 0;
  try {
    for (const [n, s] of list.entries()) {
      const piece = path.join(tmp, `s${n}.flac`), seconds = s.to - s.from;
      await promisify(execFile)("ffmpeg", ["-v", "error", "-y", "-ss", s.from.toFixed(3), "-t", seconds.toFixed(3), "-i", file, "-vn", "-ac", "1", "-ar", "16000", piece]);
      let again;
      try { again = await hear(piece, seconds); } catch (e) { log(`  transcribe: a stretch at ${s.from.toFixed(1)} s was not heard again (${String(e.message).split("\n")[0]})`); continue; }
      heard += adopt(words, s, again.map((w) => ({ ...w, start: w.start + s.from, end: w.end + s.from })));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { heard, stretches: list.length };
}
