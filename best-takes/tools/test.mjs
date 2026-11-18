// The cut's voice as one file, on made-up recordings (a tone where someone speaks). No request.
//
//   node --test tools/test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { voiceTrack } from "./lib/tracks.mjs";

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
