// The music's volume under the voice, on made-up sounds (tones and noise at different levels), and
// the board on made-up stills (flat colours named as `hyperframes snapshot` names its stills). No
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
import { soundLine, musicElement, boardLayout, storyboardFrames } from "./launch.mjs";

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

// ------------------------------------------------------------------------------- the board

const TOOL = path.join(path.dirname(new URL(import.meta.url).pathname), "launch.mjs");
const drawtext = ffmpeg && /\sdrawtext\s/.test(spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" }).stdout || "");
const launch = (cwd, ...args) => spawnSync(process.execPath, [TOOL, ...args], { cwd, encoding: "utf8" });
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
    assert.match(r.stdout, /→ −14 LUFS/);
    assert.deepEqual(tagsOf(video).filter((k) => /location|gps/i.test(k)), []);
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
