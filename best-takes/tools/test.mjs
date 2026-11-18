// The cut's voice as one file, on made-up recordings (a tone where someone speaks), and the cut's
// text as people read it, on made-up words. No request.
//
//   node --test tools/test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { voiceTrack } from "./lib/tracks.mjs";
import { plan, capitalised, endsSentence } from "./lib/cut.mjs";
import { HOP } from "./lib/voice.mjs";

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const near = (x, y, by) => assert.ok(Math.abs(x - y) <= by, `${x} is not within ${by} of ${y}`);

// a video with a tone of `hz` all through, mono or stereo
function recording(dir, name, hz, channels) {
  const file = path.join(dir, name);
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=320x180:r=30:d=4", "-f", "lavfi", "-i", `sine=frequency=${hz}:sample_rate=44100:duration=4`,
    "-ac", String(channels), "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", file], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return file;
}
const seconds = (file) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout);
// the mean level of a stretch, dB
function level(file, from, length) {
  const r = spawnSync("ffmpeg", ["-v", "info", "-ss", String(from), "-t", String(length), "-i", file, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  return Number(/mean_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr)?.[1].replace("-inf", "-200"));
}

test("the cut's voice: every piece its length, silence where a piece only shows something, each take at its gain", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "best-takes-test-"));
  try {
    const files = { 1: recording(dir, "01.mp4", 220, 1), 2: recording(dir, "02.mp4", 440, 2) };
    const pieces = [
      { clip: 1, in: 0.5, duration: 1.2, gain: 0 },
      { clip: 1, in: 1.7, duration: 0.5, gain: 0, mute: true, rate: 2 },
      { clip: 2, in: 1.0, duration: 0.8, gain: -12 },
    ];
    const out = path.join(dir, "voice.cut.m4a");
    assert.equal(voiceTrack((p) => files[p.clip], pieces, out), out);
    // as long as the cut (an AAC frame is 21 ms)
    near(seconds(out), 2.5, 0.05);
    const first = level(out, 0.2, 0.8), quiet = level(out, 1.3, 0.3), second = level(out, 1.9, 0.5);
    assert.ok(quiet < -70, `the piece that only shows something is silent (${quiet} dB)`);
    near(first - second, 12, 1.5);
    // made again only when the cut changed
    const made = fs.statSync(out).mtimeMs;
    voiceTrack((p) => files[p.clip], pieces, out);
    assert.equal(fs.statSync(out).mtimeMs, made);
    voiceTrack((p) => files[p.clip], [pieces[0]], out);
    near(seconds(out), 1.2, 0.05);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a video that is not there is said in one sentence", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "best-takes-test-"));
  try {
    assert.throws(() => voiceTrack(() => path.join(dir, "none.mp4"), [{ clip: 1, in: 0, duration: 1, gain: 0 }], path.join(dir, "voice.cut.m4a")));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Made-up words of one video, 0.4 s each with 0.1 s between; the voice on wherever a word is.
function said(texts) {
  const words = texts.map(([text, kind = "word"], i) => ({ i, clip: 1, text, kind, start: 0.5 + i * 0.5, end: 0.9 + i * 0.5 }));
  const duration = words.at(-1).end + 1, env = new Float32Array(Math.ceil(duration / HOP));
  for (const w of words) env.fill(1, Math.round(w.start / HOP), Math.round(w.end / HOP));
  return { words, voices: { 1: { env, thr: 0.5, blocks: [], duration } } };
}
const SETTINGS = { fps: 30, pause: 1, loudness: -14, lang: "de" };
const text = (r) => r.words.map((w) => w.text).join(" ");

test("the text of the cut: a word that begins a sentence once a filler before it is cut out gets its capital, the times stay", () => {
  const { words, voices } = said([["Das"], ["ist"], ["fertig."], ["Äh,", "filler"], ["und"], ["der"], ["äh", "filler"], ["Sticker"], ["kommt"], ["am"], ["3."], ["äh", "filler"], ["juni."]]);
  const r = plan(words, { keep: [{ words: "0-12" }] }, SETTINGS, voices);
  assert.deepEqual(r.errors, []);
  // after the sentence's end: capitalised; inside a sentence and after "3." (an ordinal): as it was
  assert.equal(text(r), "Das ist fertig. Und der Sticker kommt am 3. juni.");
  assert.deepEqual(r.words.map((w) => w.i), [0, 1, 2, 4, 5, 7, 8, 9, 10, 12]);
  // the same words, timed as before: only the text changed
  const plain = plan(words.map((w) => (w.i === 4 ? { ...w, text: "Und" } : w)), { keep: [{ words: "0-12" }] }, SETTINGS, voices);
  assert.deepEqual(r.words.map(({ start, end }) => [start, end]), plain.words.map(({ start, end }) => [start, end]));
  // a filler that stays in the sound is never in the text either
  const kept = plan(words, { keep: [{ words: "0-12", sounds: "keep" }] }, SETTINGS, voices);
  assert.equal(text(kept), "Das ist fertig. Und der Sticker kommt am 3. juni.");
});

test("the text of the cut: a word cut out before it counts as a filler does, a spelling the agent fixed stays, a digit or a symbol is left alone", () => {
  const { words, voices } = said([["Gut."], ["also"], ["und"], ["weiter."], ["äh", "filler"], ["1080"], ["Pixel."], ["äh", "filler"], ["@storrito"], ["sagt"], ["hallo."]]);
  // words 1 (dropped between two keeps) and the fillers: "und" begins the second keep after "Gut."
  const r = plan(words, { keep: [{ words: "0-0" }, { words: "2-10" }] }, SETTINGS, voices);
  assert.equal(text(r), "Gut. Und weiter. 1080 Pixel. @storrito sagt hallo.");
  // the cut's first word, after words cut out
  const first = plan(words, { keep: [{ words: "2-3" }] }, SETTINGS, voices);
  assert.equal(text(first), "Und weiter.");
  // the first word of a video, nothing cut before it: as the model wrote it
  const own = said([["und"], ["los."]]);
  assert.equal(text(plan(own.words, { keep: [{ words: "0-1" }] }, SETTINGS, own.voices)), "und los.");
  // "fixes" is the agent's spelling
  const fixed = plan(words, { keep: [{ words: "0-0" }, { words: "2-3" }], fixes: { 2: "und" } }, SETTINGS, voices);
  assert.equal(text(fixed), "Gut. und weiter.");
});

test("the text of the cut: a sentence end the speech model put on the filler goes onto the word before, a filler's comma goes with it", () => {
  const { words, voices } = said([["Fertig,"], ["äh.", "filler"], ["Und"], ["dann"], ["äh,", "filler"], ["weiter"], ["hier."]]);
  const r = plan(words, { keep: [{ words: "0-6" }] }, SETTINGS, voices);
  assert.equal(text(r), "Fertig. Und dann weiter hier.");
  assert.equal(r.words[0].text, "Fertig.");
  // the words in the source stay as they were
  assert.equal(words[0].text, "Fertig,");
});

test("capitalised: Unicode's first letter, by the language; names and digits as they are", () => {
  assert.equal(capitalised("über"), "Über");
  assert.equal(capitalised("istanbul", "tr"), "İstanbul");
  assert.equal(capitalised("élan"), "Élan");
  assert.equal(capitalised("iPhone"), "iPhone");
  assert.equal(capitalised("3d"), "3d");
  assert.equal(capitalised("¿qué"), "¿qué");
  assert.equal(capitalised("東京"), "東京");
  assert.ok(endsSentence("Pixel.") && endsSentence("so?“") && endsSentence("»Ende.«") && !endsSentence("3.") && !endsSentence("z.B.") && !endsSentence("und,"));
});
