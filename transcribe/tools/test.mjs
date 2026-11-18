// The check of word times against the sound, on made-up loudness and on a made-up recording; and
// who speaks, on made-up voices. No request to OpenRouter: the second hearing gets a recognizer
// that answers from a list, the tool itself a stand-in for the gateway on this machine.
//
//   node --test tools/test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { envelopeOf, smooth, threshold, voiced, islands, bare, check, repair, HOP } from "./lib/timing.mjs";
import { stretches, adopt, hearAgain } from "./lib/again.mjs";
import { quietLevels, edged } from "./lib/edges.mjs";
import { cut, scribe, LONG, BEFORE } from "./lib/scribe.mjs";
import { listen, framesOf, fingerprints, bySound, shared, byWords, byTime, named, key, SR, APART } from "./lib/voices.mjs";

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

// ---------------------------------------------------------------- who speaks

// made-up voices: a pitch (Hz), and where the overtones are strongest (Hz)
const VOICES = { ann: [118, 700], ben: [205, 2200], cyd: [160, 1300], dan: [125, 900] };
// the same numbers at every run
function dice(seed) {
  let a = seed;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// 0.3 s of a voice, a little different each time
function sounding(name, rand) {
  const [f0, peak] = VOICES[name], n = Math.round(0.3 * SR), out = new Float32Array(n), hz = f0 * (1 + 0.04 * (rand() - 0.5));
  for (let h = 1; h * hz < 3800; h++) {
    const a = 1 / (1 + ((h * hz - peak) / 350) ** 2) + 0.03, phase = rand() * 2 * Math.PI;
    for (let i = 0; i < n; i++) out[i] += a * Math.sin((2 * Math.PI * h * hz * i) / SR + phase);
  }
  const top = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0), fade = 0.01 * SR;
  return out.map((v, i) => v * (0.3 / top) * Math.min(1, i / fade, (n - 1 - i) / fade));
}
const TEXTS = ["we", "ship", "it", "today", "and", "then", "again", "next", "week"];
// A conversation of `seconds`: `turns` as [name, from, to], a word of 0.3 s every 0.4 s of a turn.
// → { samples, said: [{ text, start, end, who }] }
function talk(seconds, turns, seed = 1) {
  const rand = dice(seed), samples = new Float32Array(Math.round(seconds * SR)), said = [];
  const stock = Object.fromEntries(Object.keys(VOICES).map((name) => [name, Array.from({ length: 6 }, () => sounding(name, rand))]));
  for (const [name, from, to] of turns) {
    for (let t = from; t + 0.3 <= to + 1e-9; t = +(t + 0.4).toFixed(3)) {
      samples.set(stock[name][said.length % 6], Math.round(t * SR));
      said.push({ text: TEXTS[said.length % TEXTS.length], start: t, end: +(t + 0.3).toFixed(3), who: name });
    }
  }
  return { samples, said };
}
// the names in a row, `seconds` each, from `from` to `to`
const inTurns = (names, from, to, seconds = 5) => Array.from({ length: Math.round((to - from) / seconds) }, (_, i) => [names[i % names.length], from + i * seconds, from + (i + 1) * seconds]);
// what is said in [from, to) as a request writes it down: the voices numbered as `numbers` ({ name: voice })
const heardAs = (said, from, to, numbers) => said.filter((w) => w.start >= from && w.start < to).map(({ who, ...w }) => ({ ...w, kind: "word", voice: numbers[who] }));
const framesFrom = (samples) => { const ear = listen(); for (let i = 0; i < samples.length; i += 50000) ear.push(samples.subarray(i, i + 50000)); return ear.done(); };

test("a recording is cut into pieces that each own a stretch; a short last piece goes with the one before", () => {
  assert.deepEqual(cut(1500, 600), { CH: 600, starts: [0, 600, 1200], owns: [[-1, 605], [605, 1205], [1205, Infinity]] });
  assert.deepEqual(cut(100, 600), { CH: 600, starts: [0], owns: [[-1, Infinity]] });
  // a minute left over: two pieces of 10:30 instead of a third of one minute
  assert.deepEqual(cut(1260, 600), { CH: 630, starts: [0, 630], owns: [[-1, 635], [635, Infinity]] });
  assert.deepEqual(cut(641, 600).starts, [0]);
  assert.equal(cut(1320, 600).starts.length, 3);
  // the long pieces: 45 minutes each, one after the first heard from 5 minutes before what it owns
  assert.deepEqual(cut(6000, LONG, BEFORE), { CH: 2700, starts: [0, 2400, 4800], owns: [[-1, 2705], [2705, 5105], [5105, Infinity]] });
  assert.deepEqual(cut(2800, LONG, BEFORE), { CH: 2800, starts: [0], owns: [[-1, Infinity]] });
  const c = cut(5200, LONG, BEFORE);
  assert.deepEqual([c.CH, c.starts], [2750, [0, 2450]]);
  assert.equal(c.starts[1] + c.CH, 5200);
});

test("two voices are the same two people in every piece, however a piece numbers them", () => {
  const { samples, said } = talk(120, inTurns(["ann", "ben"], 0, 120));
  const pieces = [heardAs(said, 0, 40, { ann: "0", ben: "1" }), heardAs(said, 40, 80, { ann: "1", ben: "0" }), heardAs(said, 80, 120, { ann: "1", ben: "0" })];
  const fps = fingerprints(framesFrom(samples), pieces);
  // four turns of twelve words each, 0.3 s a word
  assert.deepEqual(fps.map((f) => [f.piece, f.voice, f.words]), [[0, "0", 48], [0, "1", 48], [1, "0", 48], [1, "1", 48], [2, "0", 48], [2, "1", 48]]);
  near(fps[0].seconds, 14.4, 0.6);
  // how high they speak, and 19 means and 19 deviations of how they sound
  near(2 ** fps[0].f0[0], 118, 5); near(2 ** fps[1].f0[0], 205, 8);
  assert.equal(fps[0].mfcc.length, 38);
  const r = bySound(fps);
  assert.equal(r.why, undefined);
  assert.equal(r.people, 2);
  assert.deepEqual(r.decisions.map((d) => [d.piece, d.voices]), [[1, 2], [2, 2]]);
  assert.ok(r.margin > 2, `margin ${r.margin}`);
  assert.deepEqual(["0:0", "1:1", "2:1"].map((id) => r.person.get(id)), [0, 0, 0]);
  assert.deepEqual(["0:1", "1:0", "2:0"].map((id) => r.person.get(id)), [1, 1, 1]);
  const { words, people } = named(pieces, r.person);
  assert.equal(people, 2);
  assert.equal(words.length, said.length);
  words.forEach((w, i) => assert.equal(w.speaker, said[i].who === "ann" ? "A" : "B"));
  assert.deepEqual(words[0], { text: "we", start: 0, end: 0.3, kind: "word", speaker: "A" });
});

test("a piece that names three voices leaves the speakers to the long requests", () => {
  const { samples, said } = talk(80, [...inTurns(["ann", "ben"], 0, 40), ...inTurns(["ann", "ben", "cyd"], 40, 80, 4)]);
  const pieces = [heardAs(said, 0, 40, { ann: "0", ben: "1" }), heardAs(said, 40, 80, { ann: "0", ben: "1", cyd: "2" })];
  const r = bySound(fingerprints(framesFrom(samples), pieces));
  assert.match(r.why, /^piece 2 names 3 voices/);
  assert.equal(r.person, undefined);
});

test("a voice with under 5 s of speech does not count: its words go to the nearer person", () => {
  const { samples, said } = talk(82, [...inTurns(["ann", "ben"], 0, 60), ["cyd", 60, 62], ...inTurns(["ann", "ben"], 62, 82)]);
  const pieces = [heardAs(said, 0, 40, { ann: "0", ben: "1" }), heardAs(said, 40, 82, { ann: "0", ben: "1", cyd: "2" })];
  const fps = fingerprints(framesFrom(samples), pieces);
  near(fps.find((f) => f.piece === 1 && f.voice === "2").seconds, 1.5, 0.2);
  const r = bySound(fps);
  assert.equal(r.why, undefined);
  assert.equal(r.people, 2);
  assert.ok([0, 1].includes(r.person.get("1:2")));
  assert.deepEqual([...new Set(named(pieces, r.person).words.map((w) => w.speaker))].sort(), ["A", "B"]);
});

test("one voice a piece is one person or two who take turns: no speakers from the pieces", () => {
  // what the second review found: two people who sound alike (ann and dan lie within APART),
  // one in each piece, came out as one person
  const { samples, said } = talk(180, [["ann", 0, 90], ["dan", 90, 180]]);
  const frames = framesFrom(samples);
  const one = [heardAs(said, 0, 30, { ann: "0" }), heardAs(said, 30, 60, { ann: "3" }), heardAs(said, 60, 90, { ann: "0" })];
  const turns = [heardAs(said, 0, 90, { ann: "0" }), heardAs(said, 90, 180, { dan: "0" })];
  for (const pieces of [one, turns]) {
    const r = bySound(fingerprints(frames, pieces));
    assert.match(r.why, /^no piece names two voices: one voice a piece is one person or two who take turns/);
    assert.equal(r.person, undefined);
  }
  // one piece alone (one request) is its one voice
  const alone = bySound(fingerprints(frames, [one[0]]));
  assert.equal(alone.why, undefined);
  assert.equal(alone.people, 1);
  assert.ok(named([one[0]], alone.person).words.every((w) => w.speaker === "A"));
});

// what the reviewer found: a voice that is someone else was put to the nearer person unchecked
test("someone else is not taken for one of two people: no speakers from the pieces then", () => {
  const { samples, said } = talk(160, [["ann", 0, 40], ["ben", 40, 80], ...inTurns(["ann", "ben"], 80, 120), ...inTurns(["ann", "cyd"], 120, 160)]);
  const frames = framesFrom(samples), at = (from, to, numbers) => heardAs(said, from, to, numbers);
  const why = (pieces) => bySound(fingerprints(frames, pieces)).why;
  // one voice a piece, two people who take turns: not one person, and not told
  assert.match(why([at(0, 40, { ann: "0" }), at(40, 80, { ben: "0" })]), /^no piece names two voices/);
  // the same once a piece names both: the pieces before it are put to them
  const both = bySound(fingerprints(frames, [at(0, 40, { ann: "0" }), at(40, 80, { ben: "0" }), at(80, 120, { ann: "1", ben: "0" })]));
  assert.equal(both.why, undefined);
  assert.deepEqual(["0:0", "1:0", "2:1", "2:0"].map((id) => both.person.get(id)), [1, 0, 1, 0]);
  // a third person beside one of the two, or alone: someone else
  assert.match(why([at(80, 120, { ann: "0", ben: "1" }), at(120, 160, { ann: "0", cyd: "1" })]), /^a voice of piece 2 sounds unlike both people/);
  assert.match(why([at(80, 120, { ann: "0", ben: "1" }), at(120, 160, { cyd: "0" })]), /^a voice of piece 2 sounds unlike both people/);
  // four people, two a piece
  const { samples: s4, said: w4 } = talk(80, [...inTurns(["ann", "ben"], 0, 40), ...inTurns(["cyd", "dan"], 40, 80)]);
  const four = fingerprints(framesFrom(s4), [heardAs(w4, 0, 40, { ann: "0", ben: "1" }), heardAs(w4, 40, 80, { cyd: "0", dan: "1" })]);
  assert.match(bySound(four).why, /^a voice of piece 2 sounds unlike both people/);
  // what the sound cannot see (README, "How far a voice is"): someone else who sounds like one
  // of the two and never speaks beside both. dan lies within APART of ann and is taken for her.
  const { samples: s3, said: w3 } = talk(80, [...inTurns(["ann", "ben"], 0, 40), ["dan", 40, 80]]);
  const blind = bySound(fingerprints(framesFrom(s3), [heardAs(w3, 0, 40, { ann: "0", ben: "1" }), heardAs(w3, 40, 80, { dan: "0" })]));
  assert.equal(blind.why, undefined);
  assert.equal(blind.person.get("1:0"), blind.person.get("0:0"));
  assert.ok(blind.decisions[0].apart < APART, JSON.stringify(blind.decisions));
});

test("one request: its voices are its people, however little they say", () => {
  const { samples, said } = talk(64, [...inTurns(["ann", "ben"], 0, 40), ["ann", 40, 42], ["cyd", 42, 44], ...inTurns(["ann", "ben"], 44, 64)]);
  // the request heard ann's two seconds as a voice of its own, and cyd's
  const words = said.map(({ who, ...w }, i) => ({ ...w, kind: "word", voice: who === "ben" ? "1" : who === "cyd" ? "3" : w.start >= 40 && w.start < 42 ? "2" : "0" }));
  const r = bySound(fingerprints(framesFrom(samples), [words]));
  assert.equal(r.why, undefined);
  assert.equal(r.people, 4);
  assert.deepEqual(["0:0", "0:1", "0:2", "0:3"].map((id) => r.person.get(id)), [0, 1, 2, 3]);
  // a clip of two who say four seconds each: two people, not one
  const clip = talk(8, [["ann", 0, 4], ["dan", 4, 8]]);
  const short = bySound(fingerprints(framesFrom(clip.samples), [heardAs(clip.said, 0, 8, { ann: "0", dan: "1" })]));
  assert.equal(short.people, 2);
  assert.notEqual(short.person.get("0:0"), short.person.get("0:1"));
});

test("voices too close to tell whose is whose leave the speakers to the long requests", () => {
  // fingerprints that differ in how high the voices speak only: the distances are that difference
  const fp = (piece, voice, pitch) => ({ piece, voice, words: 200, seconds: 60, f0: [pitch, 0.3], mfcc: Array(38).fill(1) });
  const two = [fp(0, "0", 7.0), fp(0, "1", 8.0)];
  // 0.47 + 0.47 one way round, 0.53 + 0.53 the other: 1.13 times as far
  const close = bySound([...two, fp(1, "0", 7.47), fp(1, "1", 7.53)]);
  assert.match(close.why, /^the voices of piece 2 are too close/);
  near(close.decisions[0].margin, 1.06 / 0.94, 0.001);
  assert.equal(bySound([...two, fp(1, "0", 7.47), fp(1, "1", 7.53)], { margin: 1.1 }).why, undefined);
  // one voice between two people
  assert.match(bySound([...two, fp(1, "0", 7.48)]).why, /too close/);
  const clear = bySound([...two, fp(1, "0", 7.9), fp(1, "1", 7.1), fp(2, "5", 7.05)]);
  assert.equal(clear.why, undefined);
  assert.deepEqual(["1:0", "1:1", "2:5"].map((id) => clear.person.get(id)), [1, 0, 0]);
  near(clear.margin, 1.8 / 0.2, 0.001);
  // a voice without a fingerprint goes with its piece's voice that says most
  const none = (piece, voice, words) => ({ piece, voice, words, seconds: 0, f0: null, mfcc: null });
  const bare = bySound([...two, fp(1, "0", 7.9), fp(1, "1", 7.1), none(1, "2", 1)]);
  assert.equal(bare.why, undefined);
  assert.equal(bare.person.get("1:2"), bare.person.get("1:0"));
  // a piece that speaks and has no fingerprint at all (the sound ended before it): not person A
  assert.match(bySound([...two, none(1, "0", 200), none(1, "1", 150)]).why, /^the voices of piece 2 have no sound to tell them by/);
});

test("the voices of long pieces are the people who wrote the same words where both pieces heard", () => {
  // a word every second, ann and ben in turns of 5 s, from 120 s on cyd too
  const who = (t) => (t < 120 ? ["ann", "ben"][Math.floor(t / 5) % 2] : ["ann", "ben", "cyd"][Math.floor(t / 5) % 3]);
  const said = Array.from({ length: 200 }, (_, t) => ({ text: `w${t % 40},`, start: t, end: t + 0.5, who: who(t) }));
  const first = { start: 0, words: heardAs(said, 0, 110, { ann: "0", ben: "1" }) };
  // the second piece owns from 100 s, is heard from 70 s, a tenth of a second off, and numbers the other way round
  const second = { start: 100, words: heardAs(said, 70, 200, { ann: "1", ben: "0", cyd: "2" }).map((w) => ({ ...w, start: w.start + 0.1, end: w.end + 0.1 })) };
  const { person, gaps } = byWords([first, second], 30);
  assert.deepEqual(["0:0", "0:1", "1:1", "1:0", "1:2"].map((id) => person.get(id)), [0, 1, 0, 1, 2]);
  assert.deepEqual(gaps, []);
  // each word once: the first piece's up to 105 s, the second's from there
  const { words, people } = named([first.words.filter((w) => w.start < 105), second.words.filter((w) => w.start >= 105)], person);
  assert.equal(people, 3);
  assert.deepEqual(words.map((w) => w.speaker), said.map((w) => ({ ann: "A", ben: "B", cyd: "C" })[w.who]));
  // someone who said nothing in the stretch both heard: the one voice left is the one person left
  const quiet = { start: 100, words: [...heardAs(said, 70, 100, { ann: "5", ben: "5" }), ...heardAs(said, 100, 120, { ann: "5", ben: "7" })] };
  assert.deepEqual(["1:5", "1:7"].map((id) => byWords([first, quiet], 30).person.get(id)), [0, 1]);
  // two voices left: both someone new
  const crowd = { start: 100, words: [...quiet.words, ...heardAs(said, 120, 130, { ann: "8", ben: "8", cyd: "8" })] };
  assert.deepEqual(["1:5", "1:7", "1:8"].map((id) => byWords([first, crowd], 30).person.get(id)), [0, 2, 3]);
  // nobody speaks where both heard (music, an ad): every voice after it is new, and the stretch is named
  const silent = { start: 100, words: heardAs(said, 100, 200, { ann: "1", ben: "0", cyd: "2" }) };
  const apart = byWords([{ start: 0, words: heardAs(said, 0, 70, { ann: "0", ben: "1" }) }, silent], 30);
  assert.deepEqual(["1:1", "1:0", "1:2"].map((id) => apart.person.get(id)), [2, 3, 4]);
  assert.deepEqual(apart.gaps, [[70, 100]]);
});

test("another transcription's speakers are laid on the words by their times", () => {
  const words = [word("so", 1.0, 1.3), word("yes", 1.32, 1.6), { ...word("[laughs]", 2.0, 2.5, "event") }, word("right", 3.0, 3.4), word("late", 9.0, 9.2)];
  // Gemini's: a tenth of a second off, its own letters, one word it did not hear
  const theirs = [{ text: "so", start: 1.0, end: 1.3, speaker: "B" }, { text: "yes", start: 1.3, end: 1.7, speaker: "A" }, { text: "right", start: 3.1, end: 3.3, speaker: "B" }];
  assert.deepEqual(byTime(words, theirs).map((w) => w.speaker), ["A", "B", "B", "A", undefined]);
  assert.deepEqual(Object.keys(byTime(words, theirs)[0]), ["text", "start", "end", "kind", "speaker"]);
});

test("a word is shared once, with the nearest; a noise takes its voice's speaker and names nobody", () => {
  const before = [{ text: "Yes.", start: 1.0, voice: "0" }, { text: "yes", start: 9.0, voice: "1" }];
  const after = [{ text: "yes", start: 1.3, voice: "b" }, { text: "Yes", start: 1.1, voice: "a" }, { text: "yes", start: 9.6, voice: "a" }];
  assert.deepEqual(shared(before, after, (w) => w.voice), [{ voice: "a", person: "0", n: 1 }]);
  const pieces = [[{ text: "[laughs]", start: 0, end: 1, kind: "event", voice: "1" }, { text: "Hi", start: 1, end: 1.2, kind: "word", voice: "0" },
    { text: "you", start: 2, end: 2.2, kind: "word", voice: "1" }, { text: "[door]", start: 3, end: 4, kind: "event", voice: "9" }, { text: "[music]", start: 5, end: 6, kind: "event" }]];
  const { words, people } = named(pieces, new Map([[key(0, "0"), 0], [key(0, "1"), 1]]));
  assert.equal(people, 2);
  assert.deepEqual(words.map((w) => w.speaker), ["B", "A", "B", undefined, undefined]);
  assert.ok(words.every((w) => !("voice" in w)));
});

// a 16 kHz mono WAV of the samples
function wav(file, samples) {
  const head = Buffer.alloc(44), data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 2 * i);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVEfmt ", 8); head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 2, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write("data", 36); head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([head, data]));
}

test("the fingerprints of a file, read through ffmpeg, are those of its samples", { skip: !ffmpeg && "no ffmpeg" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-test-"));
  try {
    const { samples, said } = talk(40, inTurns(["ann", "ben"], 0, 40));
    const pieces = [heardAs(said, 0, 40, { ann: "0", ben: "1" })];
    wav(path.join(dir, "talk.wav"), samples);
    const sound = await framesOf(path.join(dir, "talk.wav"));
    assert.equal(sound.frames, Math.floor((samples.length - 640) / 160) + 1);
    const a = fingerprints(sound, pieces), b = fingerprints(framesFrom(samples), pieces);
    assert.equal(a.length, 2);
    a.forEach((f, i) => { near(f.seconds, b[i].seconds, 0.05); near(f.f0[0], b[i].f0[0], 0.01); f.mfcc.forEach((v, d) => near(v, b[i].mfcc[d], 0.2)); });
    await assert.rejects(framesOf(path.join(dir, "none.wav")), /could not read the sound/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a file of more than a block, worked on other threads, gives exactly the frames listen() gives", { skip: !ffmpeg && "no ffmpeg" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-test-"));
  try {
    // 70 s: a block of a minute and a part of one, the last frame with a timbre and no pitch
    wav(path.join(dir, "talk.wav"), talk(70, inTurns(["ann", "ben"], 0, 70)).samples);
    const sound = await framesOf(path.join(dir, "talk.wav"));
    // the samples as ffmpeg gives them, to listen() in portions of odd sizes
    const data = fs.readFileSync(path.join(dir, "talk.wav")).subarray(44), samples = new Float32Array(data.length >> 1);
    for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(2 * i) / 32768;
    const ear = listen();
    for (let i = 0, n = 777; i < samples.length; i += n, n = n === 777 ? 50001 : 777) ear.push(samples.subarray(i, i + n));
    const heard = ear.done();
    assert.deepEqual([sound.frames, sound.floor], [heard.frames, heard.floor]);
    assert.equal(sound.frames, 6997);
    for (let t = 0; t <= sound.frames; t++) {
      if (sound.speech(t) !== heard.speech(t) || !sound.bands(t).every((v, j) => v === heard.bands(t)[j]) || (t < sound.frames && !Object.is(sound.pitch(t), heard.pitch(t)))) assert.fail(`frame ${t} differs`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- the tool, with a stand-in for the gateway

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), "transcribe.mjs");

// A stand-in for the Sprites gateway on this machine: it lists an OpenRouter connection and
// answers a transcription with what of `said` lies in the piece it was sent, the voices
// numbered as `numbers(from)` says. Which piece it was sent it tells by the piece's length:
// `pieces` are [from, seconds]. A piece longer than `most` seconds it refuses as too large;
// `how.refuse(q)` → [status, text, ms] refuses others, `how.hold(q)` → ms waits before answering.
// → { url, asked: [{ model, from, seconds, diarize }], gone: requests whose sender hung up, close() }
async function gateway(said, pieces, numbers, most = Infinity, how = {}) {
  const asked = [], sockets = new Set();
  let gone = 0;
  const server = http.createServer((req, res) => {
    res.on("close", () => { if (!res.writableFinished) gone++; });
    if (req.method === "GET") return res.end(JSON.stringify({ connections: [{ provider: "openrouter", id: "c1" }] }));
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-test-")), piece = path.join(dir, `piece.${body.input_audio.format}`);
      fs.writeFileSync(piece, Buffer.from(body.input_audio.data, "base64"));
      const probe = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", piece]);
      let length = "";
      probe.stdout.on("data", (d) => { length += d; });
      probe.on("close", () => {
        fs.rmSync(dir, { recursive: true, force: true });
        const seconds = Number(length), [from, whole] = [...pieces].sort((a, b) => Math.abs(a[1] - seconds) - Math.abs(b[1] - seconds))[0];
        const q = { model: body.model, from, seconds: whole, diarize: body.diarize === true };
        asked.push(q);
        // a piece of no known length (a stretch heard again): refused
        if (Math.abs(whole - seconds) > 2) { res.statusCode = 400; return res.end("{}"); }
        if (seconds > most) { res.statusCode = 413; return res.end("request body too large"); }
        const no = how.refuse?.(q);
        if (no) return setTimeout(() => { res.statusCode = no[0]; res.end(no[1]); }, no[2] ?? 0);
        const names = numbers(from);
        const words = said.filter((w) => w.start >= from && w.start < from + seconds)
          .map((w) => ({ word: w.text, start: +(w.start - from).toFixed(3), end: +(w.end - from).toFixed(3), speaker: names[w.who], ...(w.text.startsWith("[") ? { type: "audio_event" } : {}) }));
        setTimeout(() => {
          if (res.destroyed) return;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ usage: { cost: 0.001 }, words }));
        }, how.hold?.(q) ?? 0).unref();
      });
    });
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${server.address().port}`, asked, get gone() { return gone; },
    close: () => new Promise((ok) => { for (const s of sockets) s.destroy(); server.close(ok); }) };
}

// the tool run as a program → { code, line: its last line on stdout, log, json: what it wrote }
async function run(dir, name, args, url) {
  const out = path.join(dir, `${name}.json`), env = { ...process.env, RRAGENT_GATEWAY: url || "http://127.0.0.1:9" };
  for (const k of ["OPENROUTER_API_KEY", "OPENROUTER_BASE_URL", "SPRITE_GATEWAY_URL"]) delete env[k];
  const child = spawn(process.execPath, [TOOL, ...args, "--out", out], { env, stdio: ["ignore", "pipe", "pipe"] });
  let line = "", log = "";
  child.stdout.on("data", (d) => { line += d; });
  child.stderr.on("data", (d) => { log += d; });
  const code = await new Promise((ok) => child.on("close", ok));
  return { code, line: line.trim().split("\n").pop(), log, json: fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : null };
}

// 7:30 through the gateway: two pieces side by side (5:10 and 2:30), one long request, or Gemini's two
const PIECES = [[0, 310], [300, 150], [0, 450], [0, 320]];
const SCRIBE = "elevenlabs/scribe-v2";

test("two voices: the words carry their speakers at once, linked across the pieces by the sound", { skip: !ffmpeg && "no ffmpeg" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-test-"));
  const { samples, said } = talk(450, inTurns(["ann", "ben"], 0, 450));
  said[3].text = "[laughs]";
  // the second piece numbers the voices the other way round
  const numbers = (from) => (from ? { ann: 1, ben: 0 } : { ann: 0, ben: 1 });
  const plain = await gateway(said, PIECES, numbers), wanted = await gateway(said, PIECES, numbers), other = await gateway(said, PIECES, numbers);
  try {
    const file = path.join(dir, "talk.wav");
    wav(file, samples);
    const [a, b, g] = await Promise.all([run(dir, "plain", [file], plain.url), run(dir, "wanted", [file, "--speakers"], wanted.url), run(dir, "gemini", [file, "--speakers", "gemini"], other.url)]);
    for (const [r, gate] of [[a, plain], [b, wanted]]) {
      assert.equal(r.code, 0, r.line);
      // no request beyond the two pieces, each asking for the voices
      assert.deepEqual(gate.asked.map((q) => [q.model, q.from, q.seconds, q.diarize]).sort((x, y) => x[1] - y[1]), [[SCRIBE, 0, 310, true], [SCRIBE, 300, 150, true]]);
      assert.equal(r.json.engine, "scribe");
      assert.equal(r.json.cost, 0.002);
      const { margin, ...speakers } = r.json.speakers;
      assert.deepEqual(speakers, { by: "scribe", people: 2, pieces: 2, linked: "sound" });
      assert.ok(margin > 2, `margin ${margin}`);
      assert.equal(r.json.words.length, said.length);
      r.json.words.forEach((w, i) => assert.equal(w.speaker, said[i].who === "ann" ? "A" : "B", `word ${i}`));
      assert.deepEqual([r.json.words[3].text, r.json.words[3].kind, r.json.words[4].kind], ["[laughs]", "event", "word"]);
      // the check against the sound ran on the same words
      assert.equal(r.json.edges, "sound");
      assert.equal(r.json.timing.checked, said.length - 1);
      assert.match(r.line, /, voices A B in 7:30 .*\{text, start, end, kind, speaker\}/);
      assert.doesNotMatch(r.line, /Who speaks/);
    }
    // Gemini, as --speakers was before: its own pieces, no kinds, no check against the sound
    assert.equal(g.code, 0, g.line);
    assert.deepEqual(other.asked.map((q) => [q.model, q.from, q.seconds]).sort((x, y) => x[1] - y[1]), [["google/gemini-3.5-transcribe", 0, 320], ["google/gemini-3.5-transcribe", 300, 150]]);
    assert.equal(g.json.engine, "gemini");
    assert.deepEqual(g.json.speakers, { by: "gemini", people: 2 });
    assert.deepEqual(Object.keys(g.json.words[0]), ["text", "start", "end", "speaker"]);
    g.json.words.forEach((w, i) => assert.equal(w.speaker, said[i].who === "ann" ? "A" : "B", `word ${i}`));
    assert.equal(g.json.timing, undefined);
  } finally {
    await Promise.all([plain.close(), wanted.close(), other.close()]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("three voices: no speakers and no further request, unless --speakers asks for the long requests", { skip: !ffmpeg && "no ffmpeg" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-test-"));
  const { samples, said } = talk(450, [...inTurns(["ann", "ben"], 0, 300), ...inTurns(["ann", "ben", "cyd"], 300, 450)]);
  const numbers = (from) => (from ? { ann: 2, ben: 0, cyd: 1 } : { ann: 0, ben: 1, cyd: 2 });
  // the last two gateways take no request of more than 400 s of sound
  const gates = await Promise.all([0, 1, 2, 3, 4, 5].map((k) => gateway(said, PIECES, numbers, k < 4 ? Infinity : 400)));
  try {
    const file = path.join(dir, "talk.wav");
    wav(file, samples);
    const [plain, wanted, three, two, small, small3] = await Promise.all([run(dir, "plain", [file], gates[0].url), run(dir, "wanted", [file, "--speakers"], gates[1].url),
      run(dir, "three", [file, "--speakers", "--speakers-n", "3"], gates[2].url), run(dir, "two", [file, "--speakers", "scribe", "--speakers-n", "2"], gates[3].url),
      run(dir, "small", [file, "--speakers"], gates[4].url), run(dir, "small3", [file, "--speakers", "--speakers-n", "3"], gates[5].url)]);
    const lengths = (gate) => gate.asked.map((q) => q.seconds).sort((x, y) => x - y);
    const letters = { ann: "A", ben: "B", cyd: "C" };

    assert.equal(plain.code, 0, plain.line);
    assert.deepEqual(lengths(gates[0]), [150, 310]);
    assert.equal(plain.json.speakers, undefined);
    assert.ok(plain.json.words.every((w) => !("speaker" in w) && !("voice" in w)));
    assert.equal(plain.json.words.length, said.length);
    assert.match(plain.line, /Who speaks is not in it: piece 2 names 3 voices.*; --speakers gets it, with a second transcription in long requests\./);
    assert.match(plain.line, /\{text, start, end, kind\}/);

    // wanted: the two pieces, then the whole recording in one request, which keeps its voices apart
    assert.equal(wanted.code, 0, wanted.line);
    assert.deepEqual(lengths(gates[1]), [150, 310, 450]);
    assert.ok(gates[1].asked.every((q) => q.diarize && q.model === SCRIBE));
    assert.match(wanted.log, /piece 2 names 3 voices.*once more in long requests/);
    assert.deepEqual(wanted.json.speakers, { by: "scribe", people: 3, pieces: 1 });
    assert.equal(wanted.json.cost, 0.003);
    wanted.json.words.forEach((w, i) => assert.equal(w.speaker, letters[said[i].who], `word ${i}`));
    assert.equal(wanted.json.edges, "sound");
    assert.match(wanted.line, /, voices A B C in 7:30 /);

    // three voices known beforehand: the long request at once
    assert.equal(three.code, 0, three.line);
    assert.deepEqual(lengths(gates[2]), [450]);
    assert.deepEqual(three.json.speakers, { by: "scribe", people: 3, pieces: 1 });

    // two said, three heard: the third's words go to the nearest of the two that say most
    assert.equal(two.code, 0, two.line);
    assert.deepEqual(lengths(gates[3]), [150, 310, 450]);
    assert.equal(two.json.speakers.people, 2);
    assert.deepEqual([...new Set(two.json.words.map((w) => w.speaker))].sort(), ["A", "B"]);
    assert.equal(two.json.words.length, said.length);

    // a gateway that refuses the long request: the words of the short pieces, and Gemini's speakers
    // on them, as --speakers gave them before (also with three people known: no exit 1)
    for (const [r, gate] of [[small, gates[4]], [small3, gates[5]]]) {
      assert.equal(r.code, 0, r.line);
      assert.deepEqual(gate.asked.map((q) => [q.model, q.seconds]).sort(), [[SCRIBE, 150], [SCRIBE, 310], [SCRIBE, 450], ["google/gemini-3.5-transcribe", 150], ["google/gemini-3.5-transcribe", 320]].sort());
      assert.deepEqual(r.json.speakers, { by: "gemini", people: 3, because: "the long requests failed (OpenRouter 413: request body too large)" });
      assert.equal(r.json.cost, 0.004);
      assert.equal(r.json.words.length, said.length);
      r.json.words.forEach((w, i) => assert.equal(w.speaker, letters[said[i].who], `word ${i}`));
      assert.match(r.line, /Who speaks is google\/gemini-3.5-transcribe's, laid on these words by their times: the long requests failed \(OpenRouter 413: request body too large\)\./);
      assert.equal(r.json.edges, "sound");
    }
  } finally {
    await Promise.all(gates.map((g) => g.close()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the flags: --speakers-n goes with --speakers, --speakers takes scribe or gemini", { skip: !ffmpeg && "no ffmpeg" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-test-"));
  try {
    const file = recording(dir);
    const alone = await run(dir, "a", [file, "--speakers-n", "2"]);
    assert.deepEqual([alone.code, alone.line], [1, "--speakers-n goes with --speakers: it says how many voices to tell apart."]);
    const what = await run(dir, "b", [file, "--speakers", "whisper"]);
    assert.equal(what.code, 1);
    assert.match(what.line, /^One recording at a time, and --speakers takes scribe or gemini: what is whisper\?/);
    const half = await run(dir, "c", [file, "--speakers", "--speakers-n", "1.5"]);
    assert.deepEqual([half.code, half.line], [1, "--speakers-n is a whole number of voices, e.g. --speakers-n 2."]);
    assert.equal(alone.json ?? what.json ?? half.json, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const GEMINI = "google/gemini-3.5-transcribe";

test("one request: a voice that only makes noise is nobody, its people are those of the pieces' rule", { skip: !ffmpeg && "no ffmpeg" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-test-"));
  const { samples, said } = talk(60, inTurns(["ann", "ben"], 0, 60));
  // music under a word, which the request names as a third voice
  said.splice(6, 0, { text: "[music]", start: 2.31, end: 2.39, who: "band" });
  const gate = await gateway(said, [[0, 60]], () => ({ ann: 0, ben: 1, band: 2 }));
  try {
    const file = path.join(dir, "talk.wav");
    wav(file, samples);
    const r = await run(dir, "one", [file], gate.url);
    assert.equal(r.code, 0, r.line);
    assert.deepEqual(gate.asked.map((q) => q.seconds), [60]);
    assert.deepEqual(r.json.speakers, { by: "scribe", people: 2, pieces: 1 });
    const music = r.json.words.find((w) => w.text === "[music]");
    assert.equal(music.speaker, undefined);
    r.json.words.filter((w) => w !== music).forEach((w, i) => assert.equal(w.speaker, said.filter((s) => s.who !== "band")[i].who === "ann" ? "A" : "B"));
    assert.match(r.line, /, voices A B in 1:00 /);
  } finally {
    await gate.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--speakers-n 1: every word is A, from the short pieces alone", { skip: !ffmpeg && "no ffmpeg" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-test-"));
  const { samples, said } = talk(450, [...inTurns(["ann", "ben"], 0, 300), ...inTurns(["ann", "ben", "cyd"], 300, 450)]);
  const gate = await gateway(said, PIECES, (from) => (from ? { ann: 2, ben: 0, cyd: 1 } : { ann: 0, ben: 1, cyd: 2 }));
  try {
    const file = path.join(dir, "talk.wav");
    wav(file, samples);
    const r = await run(dir, "one", [file, "--speakers", "--speakers-n", "1"], gate.url);
    assert.equal(r.code, 0, r.line);
    assert.deepEqual(gate.asked.map((q) => q.seconds).sort((a, b) => a - b), [150, 310]);
    assert.deepEqual(r.json.speakers, { by: "speakers-n", people: 1 });
    assert.ok(r.json.words.every((w) => w.speaker === "A"));
  } finally {
    await gate.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("long requests that fail for another reason: Gemini's speakers; Gemini failing too: none, and the line says both", { skip: !ffmpeg && "no ffmpeg" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-test-"));
  const { samples, said } = talk(450, [...inTurns(["ann", "ben"], 0, 300), ...inTurns(["ann", "ben", "cyd"], 300, 450)]);
  const numbers = (from) => (from ? { ann: 2, ben: 0, cyd: 1 } : { ann: 0, ben: 1, cyd: 2 });
  const long = (q) => (q.model === SCRIBE && q.seconds === 450 ? [400, "the provider is busy"] : null);
  const gates = await Promise.all([gateway(said, PIECES, numbers, Infinity, { refuse: long }),
    gateway(said, PIECES, numbers, Infinity, { refuse: (q) => long(q) || (q.model === GEMINI ? [400, "no such model"] : null) })]);
  try {
    const file = path.join(dir, "talk.wav");
    wav(file, samples);
    const [three, none] = await Promise.all([run(dir, "three", [file, "--speakers", "--speakers-n", "3"], gates[0].url), run(dir, "none", [file, "--speakers"], gates[1].url)]);
    assert.equal(three.code, 0, three.line);
    assert.deepEqual(three.json.speakers, { by: "gemini", people: 3, because: "the long requests failed (OpenRouter 400: the provider is busy)" });
    assert.equal(none.code, 0, none.line);
    assert.equal(none.json.speakers, undefined);
    assert.ok(none.json.words.every((w) => !("speaker" in w)));
    assert.equal(none.json.words.length, said.length);
    assert.match(none.line, /Who speaks is not in it: the long requests failed \(OpenRouter 400: the provider is busy\), and google\/gemini-3.5-transcribe failed too \(OpenRouter 400: no such model\)\. /);
    assert.match(none.log, /piece 2 names 3 voices.*once more in long requests/);
  } finally {
    await Promise.all(gates.map((g) => g.close()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a piece that fails calls the others off: the tool does not wait for them", { skip: !ffmpeg && "no ffmpeg" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-test-"));
  const { samples, said } = talk(450, inTurns(["ann", "ben"], 0, 450));
  // the second piece is refused at once, the first would answer after a minute
  const gate = await gateway(said, PIECES, () => ({ ann: 0, ben: 1 }), Infinity, { refuse: (q) => (q.seconds === 150 ? [400, "bad piece", 1500] : null), hold: () => 60e3 });
  try {
    const file = path.join(dir, "talk.wav");
    wav(file, samples);
    const t0 = Date.now(), r = await run(dir, "off", [file], gate.url);
    assert.equal(r.code, 1);
    assert.match(r.line, /^The transcription with elevenlabs\/scribe-v2 failed \(OpenRouter 400: bad piece\)/);
    assert.ok(Date.now() - t0 < 20e3, `${Date.now() - t0} ms`);
    assert.equal(gate.gone, 1);
  } finally {
    await gate.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("what the pieces answered before one failed is in the failure's cost", { skip: !ffmpeg && "no ffmpeg" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-test-"));
  // with a key of its own: pieces of ten minutes, here two (12:30)
  const gate = await gateway([], [[0, 610], [600, 150]], () => ({}), Infinity, { refuse: (q) => (q.from ? [400, "bad piece", 1500] : null) });
  const keep = { key: process.env.OPENROUTER_API_KEY, base: process.env.OPENROUTER_BASE_URL };
  try {
    const file = path.join(dir, "quiet.wav");
    wav(file, new Float32Array(750 * SR));
    process.env.OPENROUTER_API_KEY = "test"; process.env.OPENROUTER_BASE_URL = `${gate.url}/api/v1`;
    const e = await scribe(file, 750).then(() => null, (x) => x);
    assert.match(e?.message, /^OpenRouter 400: bad piece/);
    assert.equal(e.cost, 0.001);
  } finally {
    if (keep.key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = keep.key;
    if (keep.base === undefined) delete process.env.OPENROUTER_BASE_URL; else process.env.OPENROUTER_BASE_URL = keep.base;
    await gate.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the last piece is heard to the real end of the file, past what its header says", { skip: !ffmpeg && "no ffmpeg" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-test-"));
  const { samples, said } = talk(517, inTurns(["ann", "ben"], 0, 517));
  try {
    // an MP3 without a length in it whose first frames are of a higher rate: ffprobe reckons 391 s
    // of 520; main heard it to the end in pieces of five minutes, one piece of 391 s would not
    wav(path.join(dir, "talk.wav"), samples);
    const enc = (args) => spawnSync("ffmpeg", ["-v", "error", "-y", ...args, "-ar", "16000", "-ac", "1", "-write_xing", "0", "-id3v2_version", "0"]).status;
    assert.equal(enc(["-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "3", "-b:a", "64k", path.join(dir, "a.mp3")]), 0);
    assert.equal(enc(["-i", path.join(dir, "talk.wav"), "-b:a", "48k", path.join(dir, "b.mp3")]), 0);
    fs.writeFileSync(path.join(dir, "talk.mp3"), Buffer.concat([fs.readFileSync(path.join(dir, "a.mp3")), fs.readFileSync(path.join(dir, "b.mp3"))]));
    const told = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(dir, "talk.mp3")], { encoding: "utf8" }).stdout);
    assert.ok(told < 400, `ffprobe says ${told} s`);
    const late = said.map((w) => ({ ...w, start: w.start + 3, end: w.end + 3 }));
    const gate = await gateway(late, [[0, 520]], () => ({ ann: 0, ben: 1 }));
    try {
      const r = await run(dir, "tail", [path.join(dir, "talk.mp3")], gate.url);
      assert.equal(r.code, 0, r.line);
      assert.deepEqual(gate.asked.map((q) => q.seconds), [520]);
      assert.equal(r.json.words.length, said.length);
      assert.ok(r.json.words.at(-1).start > 500);
    } finally { await gate.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
