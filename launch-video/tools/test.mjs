// The music's volume under the voice, on made-up sounds (tones and noise at different levels). No
// request, no key.
//
//   node --test tools/test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loudness, musicVolume, distance, inFilm, LOWEST, HIGHEST } from "./lib/level.mjs";
import { soundLine, musicElement } from "./launch.mjs";

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const near = (x, y, by) => assert.ok(Math.abs(x - y) <= by, `${x} is not within ${by} of ${y}`);
const run = (args) => { const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); };

// a voice's line: a mono tone at `db`, with silence around it as a speech model leaves it
function line(file, hz, db, seconds = 2) {
  run(["-f", "lavfi", "-i", `sine=frequency=${hz}:sample_rate=44100:duration=${seconds}`, "-af", `volume=${db}dB,adelay=400,apad=pad_dur=0.5`, "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k", file]);
  return file;
}
// a music bed: stereo pink noise at `db`
function bed(file, db, seconds = 6) {
  run(["-f", "lavfi", "-i", `anoisesrc=color=pink:sample_rate=48000:duration=${seconds}:seed=7`, "-af", `volume=${db}dB`, "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k", file]);
  return file;
}
// the integrated loudness of one file by ffmpeg alone, the way to check the helper by
function plain(file) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
  return Number(r.stderr.slice(r.stderr.lastIndexOf("Summary:")).match(/I:\s+(-?[\d.]+) LUFS/)[1]);
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "launch-video-test-"));

test("the computed volume lays the music the asked distance under the voice, measured on the scaled music", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    const lines = [line(path.join(dir, "a.mp3"), 300, -12), line(path.join(dir, "b.mp3"), 500, -18)];
    // the voice as it plays: both lines one after the other, each on both channels at full level
    const voiceFile = path.join(dir, "voice.wav");
    run([...lines.flatMap((f) => ["-i", f]), "-filter_complex", "[0:a]pan=stereo|c0=c0|c1=c0[x];[1:a]pan=stereo|c0=c0|c1=c0[y];[x][y]concat=n=2:v=0:a=1", voiceFile]);
    const voice = loudness(lines);
    near(voice, plain(voiceFile), 0.2);
    for (const [db, under] of [[-6, 17], [-30, 17], [-14, 16], [-20, 10]]) {
      const music = bed(path.join(dir, `m${db}.mp3`), db);
      const m = loudness([music]);
      const fit = musicVolume(voice, m, under);
      assert.equal(fit.bound, null);
      const scaled = path.join(dir, `s${db}.wav`);
      run(["-i", music, "-af", `volume=${fit.volume}`, scaled]);
      near(voice - plain(scaled), under, 0.5);
      near(fit.under, under, 0.5);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a mono line is as loud as it plays, on both channels: 3 LU over the file measured as mono", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    const f = line(path.join(dir, "a.mp3"), 440, -10);
    near(loudness([f]) - plain(f), 3, 0.2);
    // a volume on a line counts
    near(loudness([{ file: f, volume: 0.5 }]), loudness([f]) - 6.02, 0.2);
    assert.equal(loudness([]), null);
    const silent = path.join(dir, "silent.wav");
    run(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "2", silent]);
    assert.equal(loudness([silent]), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the volume stays within its bounds and says which one it hit", () => {
  const low = musicVolume(-30, -5, 17);
  assert.equal(low.volume, LOWEST);
  assert.equal(low.bound, "lowest");
  near(low.under, distance(-30, -5, LOWEST), 1e-9);
  assert.ok(low.under < 17);
  const high = musicVolume(-14, -40, 17);
  assert.equal(high.volume, HIGHEST);
  assert.equal(high.bound, "highest");
  assert.ok(high.under > 17);
  // two equally loud files: today's 0.14 for 17 LU
  near(musicVolume(-20, -20, 17).volume, 0.141, 0.001);
});

// a composition with music and, when asked, two voice lines in its root
function composition(dir, { voice = true, volume, under } = {}) {
  const comp = path.join(dir, "composition");
  fs.mkdirSync(path.join(comp, "assets", "voice"), { recursive: true });
  bed(path.join(comp, "assets", "music.mp3"), -8);
  const vo = [];
  if (voice) {
    line(path.join(comp, "assets", "voice", "hook.mp3"), 300, -14);
    line(path.join(comp, "assets", "voice", "proof.mp3"), 500, -16);
    vo.push(`<audio id="vo-hook" src="assets/voice/hook.mp3" data-start="0" data-duration="2.9" data-track-index="2"></audio>`,
      `<audio id="vo-proof" src="assets/voice/proof.mp3" data-start="3" data-duration="2.9" data-volume="1" data-track-index="2"></audio>`);
  }
  const music = volume == null ? "" : `<audio id="music" src="assets/music.mp3" data-start="0" data-duration="6" data-volume="${volume}"${under ? ` data-under-voice="${under}"` : ""} data-track-index="1"></audio>`;
  fs.writeFileSync(path.join(comp, "index.html"), `<!doctype html><html><body><div id="root" data-composition-id="main" data-start="0" data-duration="6" data-width="1080" data-height="1920">\n${vo.join("\n")}\n${music}\n</div></body></html>\n`);
  const work = path.join(dir, "work");
  fs.mkdirSync(work, { recursive: true });
  if (voice) fs.writeFileSync(path.join(work, "voice.json"), JSON.stringify({ lines: [{ id: "hook", file: "assets/voice/hook.mp3" }, { id: "proof", file: "assets/voice/proof.mp3" }] }));
  return { comp, work };
}

test("music: with a voice, the element carries the measured volume and the sentence the numbers; without one, the guidance", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    const { comp, work } = composition(dir);
    const said = musicElement(work, comp, path.join(comp, "assets", "music.mp3"), 6, 17);
    const volume = Number(said.match(/data-volume="([\d.]+)"/)[1]);
    assert.match(said, /data-under-voice="17"/);
    assert.match(said, /The voice is at −[\d.]+ LUFS, the music at −[\d.]+: at [\d.]+ it sits 17 LU under it/);
    const voice = loudness([path.join(comp, "assets", "voice", "hook.mp3"), path.join(comp, "assets", "voice", "proof.mp3")]);
    near(distance(voice, loudness([path.join(comp, "assets", "music.mp3")]), volume), 17, 0.5);
    // a voice that is not there yet
    fs.rmSync(path.join(work, "voice.json"));
    const alone = musicElement(work, comp, path.join(comp, "assets", "music.mp3"), 6, 17);
    assert.match(alone, /data-volume="0.6"/);
    assert.match(alone, /without a voice/);
    assert.doesNotMatch(alone, /data-under-voice/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("check: how far under the voice the music sits, from the composition's own elements", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    // the old fixed 0.14 on music far louder than the voice: a wrong distance, and the volume to set
    let { comp, work } = composition(dir, { volume: 0.14 });
    const placed = inFilm(comp);
    assert.equal(placed.voice.length, 2);
    assert.equal(placed.music.volume, 0.14);
    const wrong = soundLine(comp);
    assert.match(wrong, /^! Sound: the music sits [\d.]+ LU under the voice, not 17/);
    const fix = Number(wrong.match(/data-volume="([\d.]+)"/)[1]);
    // set as it says, it sits 17 LU under
    fs.writeFileSync(path.join(comp, "index.html"), fs.readFileSync(path.join(comp, "index.html"), "utf8").replace('data-volume="0.14"', `data-volume="${fix}" data-under-voice="17"`));
    const right = soundLine(comp);
    assert.match(right, /^Sound: the music sits [\d.]+ LU under the voice/);
    near(Number(right.match(/sits ([\d.]+) LU/)[1]), 17, 0.5);
    // another distance on purpose, held to by data-under-voice
    fs.rmSync(dir, { recursive: true, force: true });
    ({ comp, work } = composition(dir, { volume: fix, under: 12 }));
    assert.match(soundLine(comp), /not 12/);
    // no voice: the music alone, at its level in the film
    fs.rmSync(dir, { recursive: true, force: true });
    ({ comp } = composition(dir, { voice: false, volume: 0.6 }));
    assert.match(soundLine(comp), /^Sound: the music plays without a voice, at data-volume 0.6/);
    // a voice spoken but not placed: said, not taken for a film without a voice
    fs.writeFileSync(path.join(work, "voice.json"), JSON.stringify({ lines: [{ id: "hook", file: "assets/voice/hook.mp3" }] }));
    assert.match(soundLine(comp, work), /^! Sound: .*voice\.json has 1 line of a voice, but the root places none/);
    // no music: nothing to say
    fs.rmSync(dir, { recursive: true, force: true });
    ({ comp } = composition(dir));
    assert.equal(soundLine(comp), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
