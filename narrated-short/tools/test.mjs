// The music's volume under the voice, on made-up sounds (tones and noise at different levels) and a
// made-up short built without captions. No request, no key; build needs platform-zones beside.
//
//   node --test tools/test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loudness, musicVolume, distance, LOWEST, HIGHEST } from "./lib/level.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const zones = fs.existsSync(path.join(here, "..", "..", "platform-zones", "tools", "zones.mjs")) || process.env.PLATFORM_ZONES;
const near = (x, y, by) => assert.ok(Math.abs(x - y) <= by, `${x} is not within ${by} of ${y}`);
const run = (args) => { const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "narrated-short-test-"));

// a voice's line: a mono tone at `db`, with silence around it as a speech model leaves it
function line(file, hz, db, seconds = 2) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  run(["-f", "lavfi", "-i", `sine=frequency=${hz}:sample_rate=44100:duration=${seconds}`, "-af", `volume=${db}dB,adelay=300,apad=pad_dur=0.4`, "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k", file]);
  return file;
}
// a music bed: stereo pink noise at `db`
function bed(file, db, seconds = 8) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  run(["-f", "lavfi", "-i", `anoisesrc=color=pink:sample_rate=48000:duration=${seconds}:seed=3`, "-af", `volume=${db}dB`, "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k", file]);
  return file;
}
function plain(file) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
  return Number(r.stderr.slice(r.stderr.lastIndexOf("Summary:")).match(/I:\s+(-?[\d.]+) LUFS/)[1]);
}

test("the computed volume lays the music the asked distance under the voice, measured on the scaled music", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    const lines = [line(path.join(dir, "a.mp3"), 250, -10), line(path.join(dir, "b.mp3"), 600, -20)];
    const voiceFile = path.join(dir, "voice.wav");
    run([...lines.flatMap((f) => ["-i", f]), "-filter_complex", "[0:a]pan=stereo|c0=c0|c1=c0[x];[1:a]pan=stereo|c0=c0|c1=c0[y];[x][y]concat=n=2:v=0:a=1", voiceFile]);
    const voice = loudness(lines);
    near(voice, plain(voiceFile), 0.2);
    for (const [db, under] of [[-4, 17], [-28, 17], [-12, 20]]) {
      const music = bed(path.join(dir, `m${db}.mp3`), db);
      const fit = musicVolume(voice, loudness([music]), under);
      assert.equal(fit.bound, null);
      const scaled = path.join(dir, `s${db}.wav`);
      run(["-i", music, "-af", `volume=${fit.volume}`, scaled]);
      near(voice - plain(scaled), under, 0.5);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the volume stays within its bounds and says which one it hit", () => {
  const low = musicVolume(-30, -4, 17);
  assert.deepEqual([low.volume, low.bound], [LOWEST, "lowest"]);
  near(low.under, distance(-30, -4, LOWEST), 1e-9);
  const high = musicVolume(-14, -40, 17);
  assert.deepEqual([high.volume, high.bound], [HIGHEST, "highest"]);
  // two equally loud files: 0.14 for 17 LU, as launch-video's `music`
  near(musicVolume(-20, -20, 17).volume, 0.141, 0.001);
  assert.equal(loudness([]), null);
});

// a short of two lines (two tones) over a test picture, its clock set, ready to build
function short(dir) {
  const work = path.join(dir, "work"), comp = path.join(dir, "composition");
  fs.mkdirSync(work, { recursive: true });
  const ws = (from, n) => Array.from({ length: n }, (_, k) => ({ text: `w${k}`, start: +(from + k * 0.4).toFixed(2), end: +(from + k * 0.4 + 0.35).toFixed(2) }));
  line(path.join(comp, "assets", "voice", "s1.mp3"), 300, -2);
  line(path.join(comp, "assets", "voice", "s2.mp3"), 450, -6);
  fs.writeFileSync(path.join(work, "voice.json"), JSON.stringify({ model: "test", voice: "tone", lines: [
    { id: "s1", text: "one", file: "assets/voice/s1.mp3", duration: 2.7, words: ws(0.3, 5) },
    { id: "s2", text: "two", file: "assets/voice/s2.mp3", duration: 2.7, words: ws(0.3, 5) },
  ] }));
  const src = path.join(dir, "source.mp4");
  run(["-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=8", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", src]);
  const node = (args) => spawnSync(process.execPath, [path.join(here, "short.mjs"), ...args], { encoding: "utf8", cwd: dir });
  const ck = node(["clock", work]);
  assert.equal(ck.status, 0, ck.stdout + ck.stderr);
  const end = JSON.parse(fs.readFileSync(path.join(work, "clock.json"), "utf8")).end;
  fs.writeFileSync(path.join(work, "beats.json"), JSON.stringify({ credit: "Test footage", handle: "@test", hook: { text: "TWO TONES", key: "TONES" },
    beats: [{ id: "a", from: 0, to: 2.5, source: src, at: 0.5 }, { id: "b", from: 2.5, to: +(end + 0.7).toFixed(2), source: src, at: 3 }] }));
  return { work, comp, build: (...more) => node(["build", work, comp, "--no-captions", "--platform", "tiktok", ...more]) };
}
const musicTag = (comp) => fs.readFileSync(path.join(comp, "index.html"), "utf8").match(/<audio id="music"[^>]*>/)?.[0];

test("build: the music's volume and its lane lay it 17 LU under the voice, --under another distance, the summary says it", { skip: (!ffmpeg && "no ffmpeg") || (!zones && "no platform-zones beside") }, () => {
  const dir = tmp();
  try {
    const { comp, build } = short(dir);
    // no music yet
    let r = build();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /no music yet/);
    assert.equal(musicTag(comp), undefined);
    // music louder than the voice
    const music = bed(path.join(comp, "assets", "music.mp3"), -2);
    const voice = loudness([path.join(comp, "assets", "voice", "s1.mp3"), path.join(comp, "assets", "voice", "s2.mp3")]);
    for (const under of [17, 22]) {
      r = build(...(under === 17 ? [] : ["--under", String(under)]));
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const tag = musicTag(comp);
      const volume = Number(tag.match(/data-volume="([\d.]+)"/)[1]);
      assert.match(tag, new RegExp(`data-under-voice="${under}"`));
      // the lane holds the same volume until the last word
      const lane = JSON.parse(tag.match(/data-automation="([^"]*)"/)[1].replace(/&quot;/g, '"')).lanes[0].points;
      assert.deepEqual([lane[0].v, lane[1].v, lane[2].v], [volume, volume, 0]);
      const scaled = path.join(dir, "scaled.wav");
      run(["-i", music, "-af", `volume=${volume}`, scaled]);
      near(voice - plain(scaled), under, 0.5);
      assert.match(r.stdout, new RegExp(`music ${under}\\.\\d LU under the voice \\(at ${volume}; the voice at −[\\d.]+ LUFS, the music at −[\\d.]+\\)`));
    }
    // music so quiet that even the highest volume leaves it further under: said, and held there
    bed(music, -40);
    r = build();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(musicTag(comp), /data-volume="0.6"/);
    assert.match(r.stdout, /! the music would need [\d.]+ to lie 17 LU under the voice; at 0.6, the highest volume here, it lies [\d.]+ LU under it/);
    r = build("--under", "40");
    assert.equal(r.status, 1);
    assert.match(r.stdout, /--under is how many LU/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
