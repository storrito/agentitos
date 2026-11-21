// The music's volume under the voice, on made-up sounds (tones and noise at different levels), and
// the board on made-up stills (flat colours named as `hyperframes snapshot` names its stills); a
// recorded voice taken in, the music's volume lane along the voice and the captions' pauses. No
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
import { soundLine, skippedLine, meterOf, finishLine, musicElement, boardLayout, storyboardFrames, recordedWords, musicLane, musicTag, endWarning, pauseSpans, captionWords, gapSpecs, splitVoice, duckLane, filled, fillVerdict } from "./launch.mjs";

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
    // --plain, for another skill's tool: the numbers, no element and no "In the root"
    const plain = musicElement(work, comp, path.join(comp, "assets", "music.mp3"), 6, 17, true);
    assert.match(plain, /^The voice is at −[\d.]+ LUFS, the music at −[\d.]+: at volume [\d.]+ it sits 17 LU under it\.$/);
    assert.equal(Number(plain.match(/at volume ([\d.]+)/)[1]), volume);
    assert.doesNotMatch(plain, /In the root|<audio/);
    // a voice that is not there yet
    fs.rmSync(path.join(work, "voice.json"));
    const alone = musicElement(work, comp, path.join(comp, "assets", "music.mp3"), 6, 17);
    assert.match(alone, /data-volume="0.6"/);
    assert.match(alone, /without a voice/);
    assert.doesNotMatch(alone, /data-under-voice/);
    assert.equal(musicElement(work, comp, path.join(comp, "assets", "music.mp3"), 6, 17, true), "No voice to measure its volume by: about 0.6 without one.");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("check: a browser phase that never ran is a lint error only when lint found one", () => {
  const lint = skippedLine({ browserSkipped: true, lint: { errorCount: 2 } }, "hyperframes lint film", "hyperframes doctor");
  assert.match(lint, /found 2 errors in the composition .* run `hyperframes lint film` and fix them/);
  const none = skippedLine({ browserSkipped: true, lint: { errorCount: 0 } }, "hyperframes lint film", "hyperframes doctor");
  assert.match(none, /did not open the film in its browser, though its lint finds no error/);
  assert.match(none, /run check again; if it stays, `hyperframes doctor`/);
  assert.doesNotMatch(none, /hyperframes lint film/);
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

// ------------------------------------------------------------------------------- the board

const TOOL = path.join(path.dirname(new URL(import.meta.url).pathname), "launch.mjs");
const drawtext = ffmpeg && /\sdrawtext\s/.test(spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" }).stdout || "");
const launch = (cwd, ...args) => spawnSync(process.execPath, [TOOL, ...args], { cwd, encoding: "utf8" });
// voice-sound beside this skill, as the tool finds it
const VOICE_SOUND = path.join(path.dirname(TOOL), "..", "..", "voice-sound", "tools", "voice.mjs");
const SPRITE_VOICE_SOUND = fs.existsSync("/home/sprite/skills/voice-sound/tools/voice.mjs");
// this skill copied alone into <dir>/alone: no voice-sound beside it
function loneSkill(dir) {
  const to = path.join(dir, "alone", "launch-video");
  fs.cpSync(path.dirname(path.dirname(TOOL)), to, { recursive: true, filter: (f) => !f.includes("node_modules") });
  return to;
}
const COLOURS = { red: [255, 0, 0], lime: [0, 255, 0], blue: [0, 0, 255], yellow: [255, 255, 0], magenta: [255, 0, 255], cyan: [0, 255, 255], black: [0, 0, 0] };

// stills as `hyperframes snapshot --at … --no-end` names them, one flat colour each, written last first
function stills(folder, colours, size, step = 2.5) {
  fs.mkdirSync(folder, { recursive: true });
  [...colours.entries()].reverse().forEach(([i, c]) =>
    run(["-f", "lavfi", "-i", `color=c=${c}:s=${size}`, "-frames:v", "1", path.join(folder, `frame-${String(i).padStart(2, "0")}-at-${+(i * step + 1).toFixed(2)}s.png`)]));
}
function size(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8" });
  return r.stdout.trim().split(",").map(Number);
}
// the colour nearest to the picture's pixel at x, y
function colourAt(file, [W], x, y) {
  const raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 64 << 20 }).stdout;
  const k = (Math.round(y) * W + Math.round(x)) * 3, px = [raw[k], raw[k + 1], raw[k + 2]];
  return Object.entries(COLOURS).sort(([, a], [, b]) => a.reduce((s, v, j) => s + (v - px[j]) ** 2, 0) - b.reduce((s, v, j) => s + (v - px[j]) ** 2, 0))[0][0];
}

test("board: the stills of a vertical film as one picture, three a row, in film order, named from STORYBOARD.md", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    const work = path.join(dir, "launch", "demo"), board = path.join(work, "board");
    const colours = ["red", "lime", "blue", "yellow", "magenta", "cyan", "black"];
    stills(board, colours, "1080x1920");
    fs.writeFileSync(path.join(work, "STORYBOARD.md"), `---\nformat: 1080x1920\n---\n\n${colours.map((c, i) => `## Frame ${i + 1}: Beat ${c} (${i * 2.5}-${i * 2.5 + 2.5}s)\n\n- status: built\n`).join("\n")}`);
    const r = launch(dir, "board", "launch/demo", "launch/demo/board");
    assert.equal(r.status, 0, r.stderr);
    const out = path.join(dir, "uploads", "demo-board.jpg");
    assert.ok(fs.existsSync(out));
    const [W, H] = size(out);
    assert.equal(W, 1080);
    // the tiles counted by the picture's size: seven stills are three rows, three stills one
    stills(path.join(dir, "three"), colours.slice(0, 3), "1080x1920");
    assert.equal(launch(dir, "board", "launch/demo", "three", "--out", "three.jpg").status, 1, "three stills against seven frames");
    fs.rmSync(path.join(work, "STORYBOARD.md"));
    const r3 = launch(dir, "board", "launch/demo", "three", "--out", "three.jpg");
    assert.equal(r3.status, 0, r3.stderr);
    const [W3, H3] = size(path.join(dir, "three.jpg"));
    assert.equal(W3, 1080);
    assert.equal(H - 24, 3 * (H3 - 24));
    // film order: the colour in the middle of each tile is its still's
    const L = boardLayout(colours.length, [1080, 1920], { labels: drawtext });
    assert.deepEqual(L.size, [W, H]);
    assert.equal(L.cols, 3);
    L.tiles.forEach((t, i) => assert.equal(colourAt(out, [W, H], t.still[0] + t.still[2] / 2, t.still[1] + t.still[3] / 2), colours[i], `tile ${i + 1}`));
    // its lines: every frame with its number, name and time, in order, and what to do next
    const lines = r.stdout.split("\n").filter((l) => /^\s+\d\d\s/.test(l));
    assert.deepEqual(lines.map((l) => l.trim().slice(0, 2)), ["01", "02", "03", "04", "05", "06", "07"]);
    assert.match(lines[2], /03\s+Beat blue\s+5–7.5 s\s+frame-02-at-6s\.png/);
    assert.match(r.stdout, /show it in the chat \(an <img> of uploads\/demo-board\.jpg\) and stop until they say go/);
    // without STORYBOARD.md: numbers and moments, and the sentence that names are missing
    assert.match(r3.stdout, /01\s+at 1 s/);
    assert.match(r3.stdout, /No launch\/demo\/STORYBOARD\.md: the tiles carry their number and moment, no name/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("board: a wide film two a row; a redo folder and the contact sheet are not frames", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    const colours = ["red", "lime", "blue"];
    stills(path.join(dir, "board"), colours, "1920x1080");
    // what snapshot leaves beside the stills
    stills(path.join(dir, "board", "redo"), ["yellow"], "1920x1080");
    run(["-f", "lavfi", "-i", "color=c=black:s=640x360", "-frames:v", "1", path.join(dir, "board", "contact-sheet.jpg")]);
    const r = launch(dir, "board", "work", "board", "--out", "out/board.jpg");
    assert.equal(r.status, 0, r.stderr);
    const out = path.join(dir, "out", "board.jpg");
    const [W, H] = size(out);
    const L = boardLayout(3, [1920, 1080], { labels: drawtext });
    assert.equal(L.cols, 2);
    assert.equal(L.rows, 2);
    assert.deepEqual([W, H], L.size);
    L.tiles.forEach((t, i) => assert.equal(colourAt(out, [W, H], t.still[0] + t.still[2] / 2, t.still[1] + t.still[3] / 2), colours[i], `tile ${i + 1}`));
    assert.match(r.stdout, /3 stills of 1920×1080 in film order, 2 a row/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("board: a missing folder or one without stills is one sentence", () => {
  const dir = tmp();
  try {
    const one = (r) => { assert.equal(r.status, 1); assert.equal(r.stderr.trim().split("\n").length, 1); return r.stderr; };
    assert.match(one(launch(dir, "board", "work", "nowhere")), /^✗ There is no nowhere: pose every beat, then snapshot them in one run/);
    fs.mkdirSync(path.join(dir, "empty"));
    fs.writeFileSync(path.join(dir, "empty", "notes.txt"), "");
    assert.match(one(launch(dir, "board", "work", "empty")), /^✗ No stills \(frame-NN-at-<seconds>s\.png\) in empty: snapshot every beat in one run/);
    assert.match(one(launch(dir, "board")), /^Usage: .*board <work> <stills-folder>/);
    assert.equal(fs.existsSync(path.join(dir, "uploads")), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------------------- finish

// the names of a file's tags, its own and its streams'
function tagsOf(file) {
  const j = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8" }).stdout);
  return [j.format.tags, ...j.streams.map((s) => s.tags)].flatMap((t) => Object.keys(t || {}));
}

test("finish: the levelled video names no place, even made from a file that names one", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    // a made-up place, written the way a phone writes one, into a video quieter than -14 LUFS
    const video = path.join(dir, "film.mp4");
    run(["-f", "lavfi", "-i", "color=c=gray:s=320x180:r=30:d=3", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3", "-af", "volume=-12dB",
      "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", "-metadata", "location=+12.3456-012.3456/", "-metadata", "location-eng=+12.3456-012.3456/", video]);
    assert.ok(tagsOf(video).some((k) => /location/i.test(k)), "the made-up video should name a place");
    const r = launch(dir, "finish", "film.mp4");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /→ −1[34]\.\d LUFS, true peak −\d+\.\d dBTP, measured on the finished file\. Not heard/);
    near(meterOf(video).lufs, -14, 0.5);
    assert.deepEqual(tagsOf(video).filter((k) => /location|gps/i.test(k)), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("finish: sharp peaks: the numbers are those of the finished file, its true peak under −1 dBTP", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    // bursts of noise half a second apart: peaks far over the loudness, which −14 LUFS cannot be reached with
    const video = path.join(dir, "film.mp4");
    run(["-f", "lavfi", "-i", "color=c=gray:s=320x180:r=30:d=6", "-f", "lavfi", "-i", "anoisesrc=color=white:sample_rate=48000:duration=6:seed=3,volume='if(lt(mod(t,0.5),0.03),1,0.02)':eval=frame",
      "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-b:a", "192k", "-shortest", video]);
    const r = launch(dir, "finish", "film.mp4");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const got = meterOf(video), said = r.stdout.match(/→ (−[\d.]+) LUFS, true peak (−[\d.]+) dBTP/);
    assert.ok(said, r.stdout);
    near(Number(said[1].replace("−", "-")), got.lufs, 0.05);
    near(Number(said[2].replace("−", "-")), got.peak, 0.05);
    assert.ok(got.peak <= -1, `true peak ${got.peak}`);
    assert.doesNotMatch(r.stdout, /still over/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("finishLine: what was lowered and why the target was not reached are said, a peak left over its ceiling is a warning", () => {
  // the numbers as voice-sound's targets give them (a made-up master, to show they are not written in)
  const t = { lufs: -14, truePeakDbtp: { aim: -1.5, max: -1 } };
  assert.equal(finishLine("film.mp4", -20.3, { lufs: -14.1, peak: -1.2 }, 0, t), "film.mp4: −20.3 → −14.1 LUFS, true peak −1.2 dBTP, measured on the finished file. Not heard: say so.");
  const lowered = finishLine("film.mp4", -13.4, { lufs: -18.4, peak: -1.2 }, 1, t);
  assert.match(lowered, /over −1\.0 dBTP, so the whole sound is 1\.0 dB lower\. Not −14\.0: its peaks stand far over its loudness/);
  assert.doesNotMatch(finishLine("film.mp4", -20, { lufs: -14.6, peak: -1.1 }, 0.6, t), /Not −14/);
  assert.match(finishLine("film.mp4", -20, { lufs: -14, peak: -0.4 }, 0.8, t), /\n  ! Its true peak is still over −1\.0 dBTP/);
  const other = { lufs: -16, truePeakDbtp: { aim: -2, max: -1.5 } };
  assert.match(finishLine("film.mp4", -20, { lufs: -17, peak: -1.2 }, 0, other), /Not −16\.0: .*\n  ! Its true peak is still over −1\.5 dBTP/);
});

test("finish takes the loudness and the true peak from voice-sound's targets", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    const t = JSON.parse(spawnSync(process.execPath, [VOICE_SOUND, "targets", "--json"], { encoding: "utf8" }).stdout).master;
    const video = path.join(dir, "film.mp4");
    run(["-f", "lavfi", "-i", "color=c=gray:s=320x180:r=30:d=3", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3", "-af", "volume=-20dB",
      "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", video]);
    const r = launch(dir, "finish", "film.mp4");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const got = meterOf(video);
    near(got.lufs, t.lufs, 0.5);
    assert.ok(got.peak <= t.truePeakDbtp.max, `true peak ${got.peak}`);
    // without voice-sound: one sentence, the video as rendered (a machine's clone of the skills has it)
    if (SPRITE_VOICE_SOUND) return;
    const alone = loneSkill(dir);
    const before = fs.readFileSync(video);
    const missing = spawnSync(process.execPath, [path.join(alone, "tools", "launch.mjs"), "finish", "film.mp4"], { cwd: dir, encoding: "utf8", env: { ...process.env, VOICE_SOUND: "" } });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /^✗ The video was not levelled: The voice's sound needs agentitos' voice-sound skill beside this one/);
    assert.ok(fs.readFileSync(video).equals(before));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("storyboardFrames: both of HyperFrames' headings, times from a range or the durations", () => {
  const frames = storyboardFrames(`---\nformat: 1080x1920\nduration: 12s\n---\n\n## Frame 1: The hook (0-3s)\n- act: 1\n\n## Frame 2 — The problem\n- duration: 4s\n- scene: a timer spins\n\n### Beat 3: The fix (7–9.5 s)\n\n## Frame 4 — The end card\n\nfree text\n## Notes\n`);
  assert.deepEqual(frames, [
    { number: 1, name: "The hook", range: [0, 3] },
    { number: 2, name: "The problem", range: [3, 7] },
    { number: 3, name: "The fix", range: [7, 9.5] },
    { number: 4, name: "The end card", range: null },
  ]);
  assert.deepEqual(storyboardFrames("# A title\nno frames here"), []);
});

// ------------------------------------------------------------------------------- a recorded voice

test("recordedWords: best-takes' edit.json and transcribe's words.json, without noises and fillers", () => {
  assert.deepEqual(recordedWords({ words: [{ i: 0, text: "Last", start: 0.1, end: 0.42 }, { i: 1, text: "time", start: 0.46, end: 0.84 }] }),
    [{ text: "Last", start: 0.1, end: 0.42 }, { text: "time", start: 0.46, end: 0.84 }]);
  assert.deepEqual(recordedWords({ words: [{ text: "So", start: 1, end: 1.2, kind: "word" }, { text: "äh", start: 1.3, end: 1.5, kind: "filler" }, { text: "[laughs]", start: 2, end: 2.5, kind: "event" }, { text: " ", start: 3, end: 3.1 }] }),
    [{ text: "So", start: 1, end: 1.2 }]);
  assert.equal(recordedWords({ lines: [] }), null);
});

test("narration: best-takes' cut becomes a line of voice.json, its file copied without tags, not cleaned again", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    const voice = path.join(dir, "voice.cut.m4a");
    run(["-f", "lavfi", "-i", "sine=frequency=300:sample_rate=48000:duration=3", "-af", "volume=-14dB", "-c:a", "aac", "-metadata", "location=+12.3456-012.3456/", voice]);
    fs.writeFileSync(path.join(dir, "edit.json"), JSON.stringify({ audio: true, voice: "voice.cut.m4a", words: [{ i: 0, text: "One", start: 0.2, end: 0.6 }, { i: 1, text: "line.", start: 0.7, end: 1.4 }] }));
    fs.mkdirSync(path.join(dir, "work"));
    fs.writeFileSync(path.join(dir, "work", "voice.json"), JSON.stringify({ model: "x", lines: [{ id: "hook", file: "assets/voice/hook.mp3", words: [] }] }));
    // a voice-sound that is never to be called for a cut
    const never = path.join(dir, "never.mjs");
    fs.writeFileSync(never, `process.stdout.write(JSON.stringify({ error: "called" })); process.exit(1);\n`);
    const r = spawnSync(process.execPath, [TOOL, "narration", "work", "voice.cut.m4a", "edit.json", "comp"], { cwd: dir, encoding: "utf8", env: { ...process.env, VOICE_SOUND: never } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Its sound is best-takes', made from the whole recording: not cleaned again\./);
    assert.match(r.stdout, /<audio id="vo-narration" src="assets\/voice\/narration.m4a" data-start="0"/);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "work", "voice.json"), "utf8"));
    assert.deepEqual(meta.lines.map((l) => l.id), ["hook", "narration"]);
    const line = meta.lines[1];
    assert.equal(line.recorded, true);
    assert.equal(line.text, "One line.");
    assert.deepEqual(line.words, [{ text: "One", start: 0.2, end: 0.6 }, { text: "line.", start: 0.7, end: 1.4 }]);
    near(line.duration, 3, 0.1);
    assert.deepEqual(tagsOf(path.join(dir, "comp", "assets", "voice", "narration.m4a")).filter((k) => /location/i.test(k)), []);
    // the words of another, longer cut: refused in one sentence
    fs.writeFileSync(path.join(dir, "long.json"), JSON.stringify({ words: [{ text: "Late.", start: 9, end: 9.5 }] }));
    const bad = launch(dir, "narration", "work", "voice.cut.m4a", "long.json", "comp");
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /run to 9.50 s, the voice is 3.0\d s long/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// a voice made up with ffmpeg's lavfi, as voice-sound's own tests make it: a pitch that moves,
// syllables, pauses, a little noise
const SPEECH_S = 14.4;
const SPEECH = `aevalsrc=exprs='st(0,120*t+3.41*(1-cos(4.398*t))+6.92*(1-cos(1.445*t)));st(1,mod(t,3.6));` +
  `0.25*lt(ld(1),2.5)*pow(sin(12.566*ld(1)),2)*(0.6+0.4*sin(5.655*t))*2*(ld(0)-floor(ld(0)+0.5))':s=48000:d=${SPEECH_S},` +
  `equalizer=f=500:t=o:w=1:g=10,equalizer=f=1500:t=o:w=1:g=6,equalizer=f=2700:t=o:w=0.8:g=4,lowpass=f=5000[v];` +
  `anoisesrc=color=pink:amplitude=0.0015:r=48000:d=${SPEECH_S}:seed=5[n];[v][n]amix=inputs=2:normalize=0,volume=-12dB`;
const TALK_WORDS = { words: [{ text: "One", start: 0.2, end: 0.6, kind: "word" }, { text: "line.", start: 0.7, end: 1.4, kind: "word" }, { text: "End.", start: 13.0, end: 13.5, kind: "word" }] };

test("narration: a recording that is no best-takes cut gets its sound from voice-sound, one channel at the target as the film plays it, as long as it came, without tags", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    const t = JSON.parse(spawnSync(process.execPath, [VOICE_SOUND, "targets", "--json"], { encoding: "utf8" }).stdout).master;
    // stereo, as a phone records it, with a place in its tags
    run(["-filter_complex", SPEECH, "-ac", "2", "-c:a", "aac", "-metadata", "location=+12.3456-012.3456/", path.join(dir, "talk.m4a")]);
    fs.writeFileSync(path.join(dir, "words.json"), JSON.stringify(TALK_WORDS));
    // ffmpeg's methods only: the same on every machine
    const env = { ...process.env, VOICE_SOUND_DENOISER: "/nonexistent/no-denoiser" };
    const r = spawnSync(process.execPath, [TOOL, "narration", "work", "talk.m4a", "words.json", "comp"], { cwd: dir, encoding: "utf8", env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Its sound by voice-sound \(work\/sound\/narration\.m4a\.json\): [a-z, -]*loudness[a-z, -]*, at −1\d\.\d LUFS as the film plays it\./);
    const dest = path.join(dir, "comp", "assets", "voice", "narration.m4a");
    const a = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", dest], { encoding: "utf8" }).stdout);
    assert.equal(a.streams[0].channels, 1);
    near(Number(a.format.duration), SPEECH_S, 0.06);
    // as the film plays it: the one channel on both speakers
    near(loudness([dest]), t.lufs, 0.5);
    assert.deepEqual(tagsOf(dest).filter((k) => /location|gps/i.test(k)), []);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "work", "voice.json"), "utf8"));
    assert.equal(meta.lines[0].file, "assets/voice/narration.m4a");
    assert.equal(meta.lines[0].sound.by, "voice-sound");
    assert.deepEqual(meta.lines[0].words.map((w) => w.text), ["One", "line.", "End."]);
    // the report stays in the work folder, the cleaned file only in the composition
    assert.ok(fs.existsSync(path.join(dir, "work", "sound", "narration.m4a.json")));
    assert.ok(!fs.existsSync(path.join(dir, "work", "sound", "narration.m4a")));
    assert.deepEqual(fs.readdirSync(path.join(dir, "comp", "assets", "voice")), ["narration.m4a"]);
    // the same recording again: what voice-sound made is kept, not made again
    const made = fs.statSync(dest).mtimeMs;
    const again = spawnSync(process.execPath, [TOOL, "narration", "work", "talk.m4a", "words.json", "comp"], { cwd: dir, encoding: "utf8", env });
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.equal(fs.statSync(dest).mtimeMs, made);
    assert.match(again.stdout, /Its sound by voice-sound/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// a stand-in for voice-sound's tool: it writes down how it was called and answers as `mode` says
const STAND_IN = `import fs from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
fs.appendFileSync(process.env.STAND_IN_CALLS, JSON.stringify(args) + "\\n");
const mode = process.env.STAND_IN_MODE;
if (mode === "refuse") { process.stdout.write(JSON.stringify({ error: "No voice was found in talk.m4a: bring a recording in which someone speaks." }) + "\\n"); process.exit(1); }
if (mode === "crash") { process.stderr.write("something broke\\n"); process.exit(3); }
const [, input, out] = args;
const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", input, "-ac", "1", "-c:a", "aac", "-map_metadata", "-1", out]);
if (r.status) process.exit(4);
const report = { steps: [{ id: "highpass", why: "80 Hz." }, { id: "denoise", why: "ffmpeg's method.", fallback: { from: "dpdfnet", reason: "it broke" } }, { id: "loudness", why: "−14." }],
  left: [{ id: "roomy", why: "The room stays: next time closer to the microphone." }], delivered: { asPlayedLufs: -14.02 } };
fs.writeFileSync(out + ".json", JSON.stringify(report));
process.stdout.write(JSON.stringify(report) + "\\n");
`;

test("narration calls voice-sound as a program (clean <recording> <out> --mono --json) and passes on its report, its refusal and its failure in a sentence", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    run(["-f", "lavfi", "-i", "sine=frequency=300:sample_rate=48000:duration=15", "-ac", "2", "-c:a", "aac", path.join(dir, "talk.m4a")]);
    fs.writeFileSync(path.join(dir, "words.json"), JSON.stringify(TALK_WORDS));
    const standIn = path.join(dir, "stand-in.mjs"), calls = path.join(dir, "calls.jsonl");
    fs.writeFileSync(standIn, STAND_IN);
    const narration = (mode) => spawnSync(process.execPath, [TOOL, "narration", "work", "talk.m4a", "words.json", "comp"], { cwd: dir, encoding: "utf8", env: { ...process.env, VOICE_SOUND: standIn, STAND_IN_CALLS: calls, STAND_IN_MODE: mode } });
    const called = () => (fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
    const dest = path.join(dir, "comp", "assets", "voice", "narration.m4a");
    // a refusal: its sentence, nothing placed, voice.json untouched
    const refused = narration("refuse");
    assert.equal(refused.status, 1);
    assert.equal(refused.stderr.trim(), "✗ The recorded voice was not taken: No voice was found in talk.m4a: bring a recording in which someone speaks.");
    assert.ok(!fs.existsSync(dest));
    assert.ok(!fs.existsSync(path.join(dir, "work", "voice.json")));
    // a failure without an answer: said, never swallowed
    const crashed = narration("crash");
    assert.equal(crashed.status, 1);
    assert.match(crashed.stderr, /something broke\n✗ The recorded voice was not taken: voice-sound stopped \(exit 3\)\.?\n?$/);
    assert.ok(!fs.existsSync(dest));
    // its report: what it did, the denoiser's failure and what it left, in the line
    const ok = narration("ok");
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.deepEqual(called().at(-1), ["clean", "talk.m4a", path.join("work", "sound", "narration.m4a"), "--mono", "--json"]);
    assert.match(ok.stdout, /Its sound by voice-sound \(work\/sound\/narration\.m4a\.json\): highpass, denoise, loudness, at −14\.0 LUFS as the film plays it\. Its neural denoiser failed on this machine.* Not mended, tell them in a sentence: The room stays: next time closer to the microphone\./);
    assert.ok(fs.existsSync(dest));
    assert.equal(called().length, 3);
    // without voice-sound: one sentence (a machine's clone of the skills has it)
    if (SPRITE_VOICE_SOUND) return;
    const alone = loneSkill(dir);
    fs.rmSync(path.join(dir, "work"), { recursive: true, force: true });
    const missing = spawnSync(process.execPath, [path.join(alone, "tools", "launch.mjs"), "narration", "work", "talk.m4a", "words.json", "comp"], { cwd: dir, encoding: "utf8", env: { ...process.env, VOICE_SOUND: "" } });
    assert.equal(missing.status, 1);
    assert.equal(missing.stderr.trim(), "✗ The recorded voice was not taken: The voice's sound needs agentitos' voice-sound skill beside this one (or VOICE_SOUND naming its tools/voice.mjs).");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------------------- the music's level

test("musicLane: level under the voice and through short pauses, up only in pauses of a second or more and after the last word", () => {
  const w = (start, end) => ({ text: "w", start, end });
  // a breath of 0.4 s, a pause of 1.5 s, a pause of 0.9 s, the end at 6 s of 9
  const words = [w(0.2, 1), w(1.4, 2), w(3.5, 4.2), w(5.1, 6)];
  const pts = musicLane(words, { duration: 9, low: 0.4 });
  // the lane's value at t, straight between its points as HyperFrames plays it
  const at = (t) => {
    if (t <= pts[0].t) return pts[0].v;
    for (let k = 1; k < pts.length; k++) if (t <= pts[k].t) { const a = pts[k - 1], b = pts[k]; return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t || 1); }
    return pts.at(-1).v;
  };
  // level wherever the voice speaks, in the breath and in the pause of 0.9 s
  for (const t of [0.2, 0.6, 1.2, 1.9, 3.5, 4.0, 4.6, 5.1, 5.9]) assert.equal(at(t), 0.4, `at ${t}`);
  // up in the pause of 1.5 s, on its way down before the next word
  assert.equal(at(2.8), 1);
  assert.ok(at(3.1) > 0.4 && at(3.1) < 1);
  assert.equal(at(3.32), 0.4);
  // up after the last word, to the end
  assert.equal(at(7.2), 1);
  assert.equal(at(9), 1);
  assert.equal(pts.filter((p, k) => p.v === 1 && (k === 0 || pts[k - 1].v !== 1)).length, 2);
  // a voice that begins late: up before it; the times on the music clip's clock
  const late = musicLane([w(12, 13)], { start: 10, duration: 5, low: 0.5 });
  assert.deepEqual(late.slice(0, 3), [{ t: 0, v: 1 }, { t: 1.5, v: 1 }, { t: 1.85, v: 0.5 }]);
  assert.ok(late.every((p, k) => k === 0 || p.t >= late[k - 1].t));
});

// ------------------------------------------------------------------------------- footage with its own sound

test("narration --gap: the voice cut in the pause after a word, the footage in the gap, the voice again after it", () => {
  assert.deepEqual(gapSpecs("101+15, 45.7+9.4"), [{ at: 45.7, length: 9.4 }, { at: 101, length: 15 }]);
  assert.deepEqual(gapSpecs(undefined), []);
  assert.throws(() => gapSpecs("45.7"), /--gap takes "<seconds of the voice>\+<seconds of footage>"/);
  const w = (text, start, end) => ({ text, start, end });
  // "line." ends at 4.2, the next word at 5.2; "again." ends at 8, the next at 8.3
  const words = [w("The", 3, 3.4), w("line.", 3.5, 4.2), w("Here", 5.2, 5.6), w("again.", 7.6, 8), w("With", 8.3, 8.6)];
  const { pieces, footage } = splitVoice(words, 10, [{ at: 5, length: 9.4 }, { at: 8.1, length: 15 }]);
  // cut a quarter second after "line.", and half of the short pause after "again."
  assert.deepEqual(pieces.map((p) => [p.start, p.mediaStart, p.duration, p.first, p.last]), [[0, 0, 4.45, "The", "line."], [14.35, 4.45, 3.7, "Here", "again."], [33.55, 8.15, 1.85, "With", "With"]]);
  assert.deepEqual(footage.map((f) => [f.start, f.duration, f.after]), [[4.7, 9.4, "line."], [18.3, 15, "again."]]);
  // every word on the film's clock lies in a piece, never in a gap
  for (const x of words) {
    const p = pieces.find((q) => x.start >= q.mediaStart && x.end <= q.mediaStart + q.duration);
    assert.ok(p, x.text);
    const t = p.start + x.start - p.mediaStart;
    assert.ok(!footage.some((f) => t < f.start + f.duration && t + (x.end - x.start) > f.start), `${x.text} at ${t}`);
  }
  assert.throws(() => splitVoice(words, 10, [{ at: 9.5, length: 3 }]), /after the last word/);
  assert.throws(() => splitVoice(words, 10, [{ at: 1, length: 3 }]), /no word ends by 1 s/);
});

test("level with footage: the music out while the footage plays, no swell beside it, level and up elsewhere as before", () => {
  const w = (start, end) => ({ text: "w", start, end });
  // the voice, footage 5-10 s (1.2 s after the last word before it, 1.3 s before the next), the voice again
  const words = [w(0.2, 1), w(1.4, 3.8), w(11.3, 12), w(13.5, 14)];
  const pts = duckLane(musicLane([...words, { start: 5, end: 10, footage: true }], { duration: 18, low: 0.4 }), [[5, 10]]);
  const at = (t) => {
    if (t <= pts[0].t) return pts[0].v;
    for (let k = 1; k < pts.length; k++) if (t <= pts[k].t) { const a = pts[k - 1], b = pts[k]; return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t || 1); }
    return pts.at(-1).v;
  };
  // out under the footage, reached when it starts and held to its end
  for (const t of [5, 6, 9.9, 10]) assert.equal(at(t), 0, `at ${t}`);
  // level (never up) in the pauses beside it, though they are over a second
  for (const t of [4.2, 4.6, 10.4, 11]) assert.ok(at(t) <= 0.4 + 1e-9, `at ${t}: ${at(t)}`);
  assert.ok(at(4.85) < 0.4 && at(4.85) > 0);
  // a pause of 1.5 s away from the footage still brings it up, and the end too
  assert.equal(at(12.8), 1);
  assert.equal(at(16), 1);
  assert.ok(pts.every((p, k) => k === 0 || p.t > pts[k - 1].t));
});

// ------------------------------------------------------------------------------- how a still is filled

test("fill: an empty frame, a sparse one high in the frame, and a full one in the middle, the captions' band left out", () => {
  const cols = 96, rows = 54;
  const frame = (paint) => { const c = new Uint8Array(cols * rows).fill(248); paint((x0, y0, x1, y1, v = 30) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) c[y * cols + x] = v; }); return c; };
  const safe = [96 / 1920, 108 / 1080, 1728 / 1920, 822 / 1080], skip = [0.7, 0.87];
  // captions alone: empty
  const caps = frame((r) => r(30, 40, 66, 45));
  assert.equal(fillVerdict(filled(caps, cols, rows, { skip }), safe).mark, "✗");
  // a thin line of small type near the top: sparse and high
  const high = fillVerdict(filled(frame((r) => r(30, 8, 66, 10)), cols, rows, { skip }), safe);
  assert.equal(high.mark, "!");
  assert.match(high.why, /sparse: picture on \d+ % .*high: its middle at 1\d % of the frame's height/);
  // a figure across the middle band
  const full = fillVerdict(filled(frame((r) => { r(8, 16, 88, 34); r(20, 6, 76, 10); }), cols, rows, { skip }), safe);
  assert.equal(full.mark, "✓", full.why);
  // the ground is the border's commonest level, a dark ground as well as a light one
  const dark = new Uint8Array(cols * rows).fill(20);
  for (let y = 20; y < 30; y++) for (let x = 10; x < 80; x++) dark[y * cols + x] = 220;
  assert.deepEqual(filled(dark, cols, rows).box.map((v) => +v.toFixed(3)), [+(10 / 96).toFixed(3), +(20 / 54).toFixed(3), +(70 / 96).toFixed(3), +(10 / 54).toFixed(3)]);
});

test("level: a music that fades out right after the last word is said, with the film's end to move", () => {
  assert.equal(endWarning(167.9, 172, 172), null);
  assert.match(endWarning(58.9, 60, 59.9), /^! The music is cut off by the film's end 1.0 s after the last word/);
  assert.match(endWarning(167.9, 167.5, 170), /^! The music ends -0.4 s after the last word: .*End the film about 3 s after the last word/);
});

test("check: with a volume lane the music's distance is measured where the voice speaks, and the lane read back", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    const { comp } = composition(dir, { volume: 0.14 });
    const html = fs.readFileSync(path.join(comp, "index.html"), "utf8");
    const fit = Number(soundLine(comp).match(/data-volume="([\d.]+)"/)[1]);
    // the track 8 dB over the volume under the voice, and the lane that takes it down while the voice speaks
    const high = +(fit * 10 ** (8 / 20)).toFixed(3), low = +(fit / high).toFixed(4);
    const lane = JSON.stringify({ version: 1, lanes: [{ target: "volume", points: [{ t: 0, v: low }, { t: 5, v: low }, { t: 5.8, v: 1 }] }] }).replace(/"/g, "&quot;");
    fs.writeFileSync(path.join(comp, "index.html"), html.replace('data-volume="0.14"', `data-volume="${high}" data-under-voice="17" data-automation="${lane}"`));
    assert.deepEqual(musicTag(fs.readFileSync(path.join(comp, "index.html"), "utf8")).lane.map((p) => p.v), [low, low, 1]);
    const right = soundLine(comp);
    assert.match(right, /^Sound: the music sits [\d.]+ LU under the voice .*× [\d.]+ while the voice speaks \(its volume lane\)/);
    near(Number(right.match(/sits ([\d.]+) LU/)[1]), 17, 0.6);
    // the same lane on a track three times as loud: said, with the step that lays it again
    fs.writeFileSync(path.join(comp, "index.html"), html.replace('data-volume="0.14"', `data-volume="${(high * 3).toFixed(3)}" data-under-voice="17" data-automation="${lane}"`));
    assert.match(soundLine(comp), /^! Sound: .*while it speaks, not 17.*Lay it again \(launch-video's `level`, or the build of the skill that wrote this film\)/);
    assert.equal(musicTag('<audio id="vo-x" src="a.mp3">'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------------------- the captions' pauses

test("captions: the stretches the picture carries are read, and the words said in them left out", () => {
  assert.deepEqual(pauseSpans("160-168, 0-10.2"), [[0, 10.2], [160, 168]]);
  assert.deepEqual(pauseSpans("none"), []);
  assert.equal(pauseSpans(undefined), null);
  assert.throws(() => pauseSpans("10"), /--pause takes stretches/);
  assert.throws(() => pauseSpans("12-11"), /"12-11" is not one/);
  const w = (text, start, end) => ({ text, start, end });
  const words = [w("Last", 0.1, 0.4), w("time", 0.46, 0.8), w("Scribe", 11.82, 12.1), w("is", 12.2, 12.3), w("best", 20, 20.4)];
  assert.deepEqual(captionWords(words, [[0, 10.2], [11.8, 12.15]]).map((x) => x.text), ["is", "best"]);
  assert.equal(captionWords(words, []).length, 5);
});
