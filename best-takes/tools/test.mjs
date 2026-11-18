// The cut's voice as one file, on made-up recordings (a tone where someone speaks), and what
// becomes of a pause, on made-up movement of a camera and of a screen. No request.
//
//   node --test tools/test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { voiceTrack } from "./lib/tracks.mjs";
import { plan } from "./lib/cut.mjs";
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
