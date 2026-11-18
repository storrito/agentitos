// The cut's voice as one file, on made-up recordings (a tone where someone speaks), what becomes
// of a pause, on made-up movement of a camera and of a screen, and the cut's text as people read
// it, on made-up words. No request.
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

// ------------------------------------------------------------------------------ the pauses
// One video of 20 s: words every half second from 1 to 8 s and from 12 to 18 s, a pause of
// 4 s between them (after word 13).
const words = [];
for (const [a, b] of [[1, 8], [12, 18]]) for (let t = a; t < b - 0.01; t += 0.5) words.push({ i: words.length, clip: 1, kind: "word", text: "wort", start: t, end: t + 0.4 });
const PAUSE = [8.4, 12];
const talking = (t) => words.some((w) => t >= w.start && t <= w.end);
const voices = { 1: {
  env: Float32Array.from({ length: 20 / HOP }, (_, f) => (talking(f * HOP) ? 0.1 : 0.001)), thr: 0.01, duration: 20,
  blocks: Array.from({ length: 200 }, (_, k) => ({ t: k / 10, m: talking(k / 10 - 0.2) ? -20 : -80 })),
} };
const settings = { fps: 30, pause: 1, pauses: "picture", loudness: -16 };
const all = { keep: [{ words: `0-${words.length - 1}` }] };
// made-up movement, four samples a second as motion.mjs' activity gives them: change(t) is the
// share of changed pixels at t
const series = (change) => (clip, from, to) => {
  const out = [];
  for (let k = 1; from + k / 4 <= to + 1e-9; k++) out.push({ t: from + k / 4, change: change(from + k / 4) });
  return out;
};
const shownIn = (r) => r.pieces.filter((p) => p.mute && p.in < PAUSE[1] && p.out > PAUSE[0]);
const pauseOf = (r) => r.removed.find((x) => x.kind === "pause");
// a phone in the hand: 5–9 % of the picture changes all the time, speaking or not
const hand = (t) => 0.05 + 0.01 * ((t * 4) % 5);

test("a camera: a pause that moves as much as while speaking is cut hard", () => {
  const r = plan(words, all, settings, voices, series(hand));
  assert.deepEqual(r.errors, []);
  assert.equal(shownIn(r).length, 0);
  assert.match(pauseOf(r).why, /^cut: the picture moves no more than while speaking/);
  assert.ok(r.motion[1].base > 0.05 && r.motion[1].base < 0.1, `the movement while speaking: ${r.motion[1].base}`);
});

test("a camera: a pause in which something moves well above it stays, muted", () => {
  // something is held into the picture from 9.5 to 11 s
  const r = plan(words, all, settings, voices, series((t) => (t > 9.5 && t <= 11 ? 0.45 : hand(t))));
  const shown = shownIn(r);
  assert.equal(shown.length, 1);
  assert.ok(shown[0].in >= 9 && shown[0].out <= 11.5, `shown ${shown[0].in}–${shown[0].out}`);
  assert.match(pauseOf(r).why, /something moves in it/);
});

test("a screen: still while speaking, a pause in which something moves stays, a still one is cut", () => {
  const screen = (t) => (talking(t) ? 0.0003 : 0.0001);
  // a click and a page that loads, 9 to 10 s
  const click = plan(words, all, settings, voices, series((t) => (t > 9 && t <= 10 ? 0.01 : screen(t))));
  assert.equal(shownIn(click).length, 1);
  assert.match(pauseOf(click).why, /something moves in it/);
  const still = plan(words, all, settings, voices, series(screen));
  assert.equal(shownIn(still).length, 0);
  assert.match(pauseOf(still).why, /^cut: the picture stands still/);
});

test("a screen: a change under 0.2 % is no movement, as it always was", () => {
  const r = plan(words, all, settings, voices, series((t) => (t > 9 && t <= 10 ? 0.0015 : 0)));
  assert.equal(shownIn(r).length, 0);
  assert.equal(r.motion[1].limit, 0.002);
});

test("the agent overrules: \"pauses\": \"keep\" plays a pause the tool would cut as it is", () => {
  const r = plan(words, { keep: [{ words: all.keep[0].words, pauses: "keep" }] }, settings, voices, series(hand));
  assert.equal(r.removed.filter((x) => x.kind === "pause").length, 0);
  assert.ok(r.pieces.some((p) => !p.mute && p.in < PAUSE[0] && p.out > PAUSE[1]), "one piece plays through the pause");
});

test("an announced wait stays a wait on a camera, whatever it moves while speaking", () => {
  const r = plan(words, { ...all, waits: [13] }, settings, voices, series(hand));
  assert.equal(pauseOf(r).wait, true);
  const shown = shownIn(r);
  assert.equal(shown.length, 1);
  assert.ok(shown[0].rate > 1, "a timelapse");
});

test("tight: every pause goes, whatever the picture shows", () => {
  const r = plan(words, all, { ...settings, pauses: "tight" }, voices, null);
  assert.equal(shownIn(r).length, 0);
  assert.equal(pauseOf(r).why, "cut (tight)");
});

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

// ------------------------------------------------------------------- text and faces (faces.json)
import { punchOrigin, textOnFaces, toFrame } from "./lib/faces.mjs";
import { hookCard } from "./lib/hook.mjs";

const FRAME = [1080, 1920], CAP = [192, 1306, 696, 134];
test("a punch-in grows from a third from the top while every chin clears the captions with room to spare", () => {
  assert.equal(punchOrigin({ faces: [[355, 300, 370, 500]], scale: 1.12, frame: FRAME, cap: CAP }), 0.32 * 1920);
});
test("a punch-in on a face whose chin stands just above the captions grows from lower down, so that the chin and the margin below it stay above them", () => {
  const face = [300, 600, 480, 640], chin = 600 + 640 + 0.08 * 640;
  const y = punchOrigin({ faces: [face], scale: 1.12, frame: FRAME, cap: CAP });
  assert.ok(y > 0.32 * 1920, `origin ${y}`);
  // the chin after the punch-in, grown from y
  assert.ok(y + (chin - y) * 1.12 <= CAP[1] + 1e-6, `chin after ${y + (chin - y) * 1.12}`);
});
test("a punch-in on a face that lies on the captions already grows from the frame's bottom at most: the chin goes up, not down", () => {
  const y = punchOrigin({ faces: [[100, 0, 880, 1700]], scale: 1.12, frame: FRAME, cap: CAP });
  assert.equal(y, 1920);
});
test("without captions, or on a face below them (captions above a head), the punch-in grows from a third from the top", () => {
  assert.equal(punchOrigin({ faces: [[300, 600, 480, 640]], scale: 1.12, frame: FRAME, cap: null }), 0.32 * 1920);
  assert.equal(punchOrigin({ faces: [[355, 1000, 370, 400]], scale: 1.12, frame: FRAME, cap: [192, 700, 696, 134] }), 0.32 * 1920);
});
test("the check finds the seconds a text lies on a face, through the piece's punch-in, and how deep into the face from its chin", () => {
  const clips = { 1: { file: "01.mp4" } };
  const faces = { "01.mp4": { size: [1080, 1920], faces: Array.from({ length: 101 }, (_, i) => ({ t: i / 10, boxes: [{ who: "A", box: i < 50 ? [355, 300, 370, 500] : [300, 900, 480, 640] }] })) } };
  const pieces = [{ clip: 1, in: 0, out: 10, start: 0, duration: 10 }];
  const on = textOnFaces({ pieces, clips, faces, texts: [{ role: "captions", box: CAP, from: 0, to: 10 }], frame: FRAME });
  assert.equal(on.length, 1);
  assert.ok(Math.abs(on[0].seconds - 5) < 0.21 && on[0].from >= 4.9, JSON.stringify(on));
  assert.ok(Math.abs(on[0].share - (1540 - 1306) / 640) < 0.01, JSON.stringify(on));
  // the same face punched in from a third from the top lies deeper on them; grown from below its chin, less
  const punched = textOnFaces({ pieces: [{ ...pieces[0], scale: 1.12, origin: 614.4 }], clips, faces, texts: [{ role: "captions", box: CAP, from: 0, to: 10 }], frame: FRAME });
  assert.ok(punched[0].share > on[0].share, JSON.stringify(punched));
  assert.deepEqual(toFrame([0, 0, 540, 960], [540, 960], FRAME), [0, 0, 1080, 1920]);
});
test("the hook stands where it is placed: a text without a card in the middle of its box, or a card at its top; without a place, the card at the top of the centred box as before", () => {
  const zones = { centred: [192, 250, 696, 1190] };
  const text = hookCard({ text: "He wears the *robe*", until: 3, zones, out: os.tmpdir(), place: { kind: "text", box: [192, 900, 696, 238], font: 96 } });
  assert.match(text.style, /top: 915\.3px/);
  assert.doesNotMatch(text.style, /background: #FFFFFF/);
  assert.match(text.style, /font-size: 96px/);
  const card = hookCard({ text: "He wears the *robe*", until: 3, zones, out: os.tmpdir(), place: { kind: "card", box: [60, 250, 960, 236], font: 76 } });
  assert.match(card.style, /left: 540px; top: 250px/);
  assert.match(card.style, /background: #FFFFFF/);
  const old = hookCard({ text: "He wears the *robe*", until: 3, zones, out: os.tmpdir() });
  assert.match(old.style, /left: 540px; top: 258px/);
  assert.match(old.style, /font-size: 72px/);
});
