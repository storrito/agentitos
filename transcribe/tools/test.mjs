// The check of word times against the sound, on made-up loudness and on a made-up recording.
// No request to OpenRouter: the second hearing gets a recognizer that answers from a list.
//
//   node --test tools/test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { envelopeOf, smooth, threshold, voiced, islands, bare, check, repair, HOP } from "./lib/timing.mjs";
import { stretches, adopt, hearAgain } from "./lib/again.mjs";
import { quietLevels, edged } from "./lib/edges.mjs";

// loudness in 10 ms frames: quiet room noise, voice where `parts` say ([from, to, level])
function sound(seconds, parts) {
  const env = new Float32Array(Math.round(seconds / HOP)).fill(0.001);
  for (const [a, b, level = 0.2] of parts) for (let f = Math.round(a / HOP); f < Math.round(b / HOP); f++) env[f] = level;
  return env;
}
const word = (text, start, end, kind = "word") => ({ text, start, end, kind });
const near = (x, y, by = 0.03) => assert.ok(Math.abs(x - y) <= by, `${x} is not within ${by} of ${y}`);

// "one two three four" with pauses between them
const SAID = [[1.0, 1.4], [2.0, 2.5], [3.2, 3.8], [4.4, 4.9]];
const good = () => [word("one", 1.0, 1.4), word("two", 2.0, 2.5), word("three", 3.2, 3.8), word("four", 4.4, 4.9)];

test("voice is found where it is, small holes closed", () => {
  const env = sound(3, [[0.5, 0.9], [0.95, 1.2], [2.0, 2.02]]);
  const thr = threshold(env);
  assert.deepEqual(voiced(env, thr, 0, 3).map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]), [[0.5, 1.2]]);
  const [i] = islands(env, thr, 0, 3);
  near(i.start, 0.5, 0.011); near(i.end, 1.2, 0.011);
});

test("well-timed words are all in the voice, nothing moves", () => {
  const env = sound(6, SAID), thr = threshold(env), words = good();
  const c = check(words, env, thr);
  assert.equal(c.speech, 4); assert.equal(c.inVoice, 1); assert.deepEqual(c.off, []);
  assert.deepEqual(repair(words, env, thr), { moved: 0, guessed: [] });
  assert.deepEqual(words, good());
});

test("a word squeezed into 40 ms is put onto its voice", () => {
  const env = sound(6, SAID), thr = threshold(env), words = good();
  words[2] = word("three", 2.52, 2.56);
  assert.deepEqual(check(words, env, thr).off, [2]);
  const r = repair(words, env, thr);
  assert.equal(r.moved, 1); assert.deepEqual(r.guessed, []);
  near(words[2].start, 3.2); near(words[2].end, 3.8);
  assert.equal(words[2].by, "sound");
  assert.equal(check(words, env, thr).inVoice, 1);
});

test("a click in the pause does not take the squeezed word", () => {
  const env = sound(6, [...SAID, [2.7, 2.78, 0.05]]), thr = threshold(env), words = good();
  words[2] = word("three", 2.52, 2.56);
  repair(words, env, thr);
  near(words[2].start, 3.2); near(words[2].end, 3.8);
});

test("squeezed words get one stretch of voice each when there are as many", () => {
  const env = sound(6, SAID), thr = threshold(env);
  const words = [word("one", 1.0, 1.4), word("two", 1.42, 1.46), word("three", 1.46, 1.5), word("four", 4.4, 4.9)];
  const r = repair(words, env, thr);
  assert.equal(r.moved, 2); assert.deepEqual(r.guessed, []);
  near(words[1].start, 2.0); near(words[1].end, 2.5);
  near(words[2].start, 3.2); near(words[2].end, 3.8);
});

test("squeezed words sharing one stretch of voice are a guess, in their order", () => {
  const env = sound(4, [[1.0, 1.4], [2.0, 2.9], [3.4, 3.8]]), thr = threshold(env);
  const words = [word("one", 1.0, 1.4), word("two", 1.42, 1.46), word("three", 1.46, 1.5), word("four", 3.4, 3.8)];
  const r = repair(words, env, thr);
  assert.deepEqual(r.guessed, [[1, 2]]);
  near(words[1].start, 2.0); near(words[2].end, 2.9);
  assert.ok(words[1].end <= words[2].start + 0.011, "the words keep their order");
});

test("a start drawn back over a pause is put where the voice sets in", () => {
  const env = sound(6, SAID), thr = threshold(env), words = good();
  words[2].start = 2.52;
  assert.deepEqual(check(words, env, thr).off, [2]);
  repair(words, env, thr);
  near(words[2].start, 3.2); assert.equal(words[2].end, 3.8);
});

test("an end drawn over a pause is put where the voice stops", () => {
  const env = sound(6, SAID), thr = threshold(env), words = good();
  words[1].end = 3.18;
  repair(words, env, thr);
  assert.equal(words[1].start, 2.0); near(words[1].end, 2.53);
});

test("a word in silence goes onto the voice between its neighbours", () => {
  const env = sound(6, SAID), thr = threshold(env), words = good();
  words[2] = word("three", 2.7, 3.0);
  assert.equal(check(words, env, thr).silent, 1);
  repair(words, env, thr);
  near(words[2].start, 3.2); near(words[2].end, 3.8);
});

test("noises and words already right are left alone", () => {
  const env = sound(6, SAID), thr = threshold(env);
  const words = [...good().slice(0, 2), word("[laughs]", 2.6, 2.61, "event"), ...good().slice(2)];
  assert.equal(check(words, env, thr).speech, 4);
  repair(words, env, thr);
  assert.deepEqual(words[2], word("[laughs]", 2.6, 2.61, "event"));
});

test("words without a length are counted", () => {
  const words = [word("a", 1, 1), word("b", 2, 2.04), word("c", 3, 3.3), word("[x]", 4, 4, "event")];
  assert.deepEqual(bare(words), { speech: 3, bare: 2 });
});

// the edges of the words: loudness as lib/timing.mjs gives it (smoothed), from stretches [seconds, level]
function stretch(...parts) {
  const frames = [];
  for (const [seconds, level] of parts) for (let f = 0; f < Math.round(seconds / HOP); f++) frames.push(level);
  return smooth(Float32Array.from(frames));
}
const times = (words) => words.map((w) => [w.start, w.end]);
// a tone, 0.3 s of quiet, a tone
const PAUSE = () => stretch([1, 0.3], [0.3, 0.001], [1, 0.3]);

test("a word ends where its sound stops and begins where its sound sets in", () => {
  // (a frame in, for the smoothing)
  const words = [word("early", 0.2, 0.9), word("late", 1.45, 2.0)];
  assert.equal(edged(words, PAUSE()), 2);
  assert.deepEqual(times(words), [[0.2, 1.01], [1.29, 2.0]]);
  assert.equal(words[0].kind, "word"); assert.equal(words[0].text, "early");
});

test("with noise under the speech, quiet is what is near the ground of the sound", () => {
  const noisy = stretch([1, 0.3], [0.3, 0.05], [1, 0.3], [0.3, 0.05]);
  assert.deepEqual([...quietLevels(noisy)].map((x) => +x.toFixed(3)), [0.1, 0.1, 0.1]);
  assert.deepEqual([...quietLevels(PAUSE())].map((x) => +x.toFixed(3)), [0.024, 0.024, 0.024]);
  const words = [word("early", 0.2, 0.9), word("late", 1.45, 2.3)];
  edged(words, noisy);
  assert.deepEqual(times(words), [[0.2, 1.01], [1.29, 2.31]]);
});

test("sound that goes on for more than 0.4 s is not the word's", () => {
  const words = [word("a", 0.1, 0.3), word("b", 1.9, 2.2)];
  assert.equal(edged(words, PAUSE()), 0);
  assert.deepEqual(times(words), [[0.1, 0.3], [1.9, 2.2]]);
});

test("two words with sound all the way between them meet where it is weakest", () => {
  const words = [word("early", 0.2, 0.9), word("next", 1.1, 1.8)];
  edged(words, stretch([1, 0.3], [0.03, 0.15], [1, 0.3], [0.5, 0.001]));
  assert.deepEqual(times(words), [[0.2, 1.01], [1.01, 2.04]]);
  // in sound that never pauses nothing tells a word from the ground, and nothing moves
  const still = [word("early", 0.2, 0.9), word("next", 1.1, 1.8)];
  assert.equal(edged(still, stretch([1, 0.3], [0.03, 0.15], [1, 0.3])), 0);
  assert.deepEqual(times(still), [[0.2, 0.9], [1.1, 1.8]]);
});

test("no edge moves inward: a word that ends in the quiet, or begins in it, stays", () => {
  const words = [word("soft", 0.2, 1.2), word("onset", 1.25, 2.0)];
  assert.equal(edged(words, PAUSE()), 0);
  assert.deepEqual(times(words), [[0.2, 1.2], [1.25, 2.0]]);
});

test("without the sound, or with a word without a time, the words stay as they came", () => {
  const words = [word("early", 0.2, 0.9), word("late", 1.45, 2.0)];
  assert.equal(edged(words, null), 0);
  assert.equal(edged(words, new Float32Array(0)), 0);
  const bareWord = [word("early", 0.2, 0.9), { text: "bare", kind: "word" }];
  assert.equal(edged(bareWord, PAUSE()), 0);
  assert.deepEqual(bareWord[0], word("early", 0.2, 0.9));
  assert.equal(edged([], PAUSE()), 0);
  assert.deepEqual(times(words), [[0.2, 0.9], [1.45, 2.0]]);
});

test("doubtful spots get their surroundings, touching ones merged", () => {
  const words = Array.from({ length: 30 }, (_, k) => word(`w${k}`, k, k + 0.5));
  const s = stretches(words, [[20, 20], [5, 6], [8, 8]]);
  assert.equal(s.length, 2);
  assert.deepEqual([s[0].a, s[0].i, s[0].j, s[0].b], [2, 5, 8, 11]);
  assert.deepEqual([s[1].a, s[1].b], [17, 23]);
  near(s[0].from, 1.65, 0.001); near(s[0].to, 11.85, 0.001);
});

test("a second hearing is taken when it heard the same words and agrees around them", () => {
  const words = [word("we", 1, 1.2), word("ship", 1.3, 1.6), word("it", 1.62, 1.66), word("today", 1.66, 1.7), word("again", 3, 3.4)];
  const s = { i: 2, j: 3, a: 0, b: 4 };
  const heard = [word("We", 1.02, 1.2), word("ship", 1.3, 1.6), word("it", 1.7, 1.85), word("today,", 1.9, 2.4), word("again.", 3.0, 3.4)];
  assert.equal(adopt(words, s, heard), 2);
  assert.deepEqual([words[2].start, words[2].end, words[3].start, words[3].end], [1.7, 1.85, 1.9, 2.4]);
  assert.equal(words[3].by, "second hearing");
});

test("a second hearing that disagrees around the spot, misses a word or has no lengths is not taken", () => {
  const make = () => [word("we", 1, 1.2), word("ship", 1.3, 1.6), word("it", 1.62, 1.66), word("today", 1.66, 1.7), word("again", 3, 3.4)];
  const s = { i: 2, j: 3, a: 0, b: 4 };
  const moved = [word("we", 1.6, 1.8), word("ship", 1.9, 2.2), word("it", 2.3, 2.4), word("today", 2.5, 2.8), word("again", 3.6, 3.9)];
  const missing = [word("we", 1, 1.2), word("ship", 1.3, 1.6), word("today", 1.9, 2.4), word("again", 3, 3.4)];
  const bareAgain = [word("we", 1, 1.2), word("ship", 1.3, 1.6), word("it", 1.7, 1.7), word("today", 1.9, 1.9), word("again", 3, 3.4)];
  const outside = [word("we", 1, 1.2), word("ship", 1.3, 1.6), word("it", 1.7, 1.85), word("today", 1.9, 3.9), word("again", 3, 3.4)];
  for (const heard of [moved, missing, bareAgain, outside]) {
    const words = make();
    assert.equal(adopt(words, s, heard), 0);
    assert.deepEqual(words, make());
  }
});

// a made-up recording: a tone where the words are, silence between
const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
function recording(dir) {
  const file = path.join(dir, "voice.wav");
  // commas inside a filter's expression are escaped
  const on = SAID.map(([a, b]) => `between(t\\,${a}\\,${b})`).join("+");
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `aevalsrc=0.4*sin(2*PI*220*t)*(${on}):s=16000:d=6`, file], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return file;
}

test("the loudness of a real file, read through ffmpeg", { skip: !ffmpeg && "no ffmpeg" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-test-"));
  try {
    const env = await envelopeOf(recording(dir));
    near(env.length * HOP, 6, 0.02);
    const spans = voiced(env, threshold(env), 0, 6);
    assert.equal(spans.length, 4);
    spans.forEach(([a, b], k) => { near(a, SAID[k][0], 0.03); near(b, SAID[k][1], 0.03); });
    await assert.rejects(envelopeOf(path.join(dir, "none.wav")), /could not read the sound/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a doubtful stretch is cut out, heard again and its times put on the recording's clock", { skip: !ffmpeg && "no ffmpeg" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-test-"));
  try {
    const file = recording(dir);
    const words = [...good().slice(0, 2), word("three", 2.6, 2.62), word("four", 2.62, 2.64), word("five", 5.5, 5.9)];
    const calls = [];
    // the recognizer of the snippet: the true times, on the snippet's clock
    const hear = async (piece, seconds) => {
      calls.push(seconds);
      assert.ok(fs.statSync(piece).size > 1000, "the snippet holds sound");
      const from = Math.max(0, 1.0 - 0.35);
      return [word("one", 1.0 - from, 1.4 - from), word("two", 2.0 - from, 2.5 - from), word("three", 3.2 - from, 3.8 - from), word("four", 4.4 - from, 4.9 - from), word("five", 5.5 - from, 5.9 - from)];
    };
    const r = await hearAgain(file, words, [[2, 3]], hear);
    assert.deepEqual(r, { heard: 2, stretches: 1 });
    assert.equal(calls.length, 1);
    near(words[2].start, 3.2, 0.011); near(words[3].end, 4.9, 0.011);
    // a recognizer that fails leaves the words as they were
    const before = JSON.stringify(words);
    const r2 = await hearAgain(file, words, [[2, 3]], async () => { throw new Error("OpenRouter 503"); });
    assert.deepEqual(r2, { heard: 0, stretches: 1 });
    assert.equal(JSON.stringify(words), before);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
