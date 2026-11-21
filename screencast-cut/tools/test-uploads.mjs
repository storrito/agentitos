// new from uploaded files named by their roles (--screen <file> --webcam <file>), as against the
// recorder's folder with its recording.json: the same files give the same sources, the person's
// files stay where and as they are, files without roles and a missing file stop with one sentence
// that says what to do, and --offset sets a start. Synthetic media (ffmpeg's lavfi sources), no
// model, no key, no network: the model's route points at a closed port on this machine.
//
//   node --test tools/test-uploads.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, "screencast.mjs");
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const ENV = { ...process.env, OPENROUTER_API_KEY: "", SPRITE_GATEWAY_URL: "http://127.0.0.1:9" };

const run = (cwd, ...args) => spawnSync(process.execPath, [TOOL, "new", ...args], { cwd, encoding: "utf8", env: ENV, timeout: 120000 });
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const ffmpeg = (...args) => assert.equal(spawnSync("ffmpeg", ["-v", "error", "-y", ...args]).status, 0, `ffmpeg ${args.join(" ")}`);

// speech-like sound: noise in bursts of uneven length, so that its envelope has one best lag
const VOICE = "anoisesrc=d=6:c=pink:a=0.3,volume='if(between(t,0.4,1.1)+between(t,1.6,1.9)+between(t,2.5,3.6)+between(t,4.2,4.5)+between(t,5,5.7),1,0.02)':eval=frame";
function media(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const screen = path.join(dir, "a.mp4"), webcam = path.join(dir, "b.mp4"), mute = path.join(dir, "c.mp4");
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=6", "-f", "lavfi", "-i", VOICE, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", screen);
  ffmpeg("-f", "lavfi", "-i", "mandelbrot=s=160x120:r=30", "-f", "lavfi", "-i", VOICE, "-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", webcam);
  ffmpeg("-f", "lavfi", "-i", "mandelbrot=s=160x120:r=30", "-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p", mute);
  return { screen, webcam, mute };
}

test("uploaded files named by their roles give what the same files in a recorder's folder give; the person's files are not moved or changed", { skip: !hasFfmpeg && "no ffmpeg on this machine" }, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-"));
  try {
    const m = media(path.join(cwd, "uploads"));
    const rec = path.join(cwd, "rec");
    fs.mkdirSync(rec);
    fs.copyFileSync(m.screen, path.join(rec, "screen.mp4"));
    fs.copyFileSync(m.webcam, path.join(rec, "webcam.mp4"));
    fs.writeFileSync(path.join(rec, "recording.json"), JSON.stringify({ started: { screen: 1700000000000, webcam: 1700000000000 }, files: ["screen.mp4", "webcam.mp4"] }));
    const before = [hash(m.screen), hash(m.webcam)];

    const folder = run(cwd, "out/folder", "rec");
    assert.equal(folder.status, 0, folder.stdout + folder.stderr);
    assert.doesNotMatch(folder.stdout, /recording\.json/, "the folder form says nothing of uploads");
    const loose = run(cwd, "out/loose", "--screen", "uploads/a.mp4", "--webcam", "uploads/b.mp4");
    assert.equal(loose.status, 0, loose.stdout + loose.stderr);
    assert.match(loose.stdout, /^Uploaded files have no recording\.json, so no start times and no pauses: they start together, and each one with sound is lined up with the voice by its sound only within 1\.5 s of that; files that started further apart need --offset <role>=<seconds> \(that one began so many seconds after the others\), else their match by sound can be false, and one without sound stays where it starts\.$/m);
    assert.match(loose.stdout, /^The uploaded files: 2 sources/m);
    assert.match(loose.stdout, /Next, the words of/);

    // the same files, byte for byte, but sources.json's names of where they came from and the clock's zero
    const a = path.join(cwd, "out/folder/source"), b = path.join(cwd, "out/loose/source");
    assert.deepEqual(fs.readdirSync(b).sort(), fs.readdirSync(a).sort());
    for (const f of fs.readdirSync(a).filter((f) => f !== "sources.json" && !f.endsWith(".prepared.json"))) assert.equal(hash(path.join(b, f)), hash(path.join(a, f)), f);
    // an upload's conversion is kept with the file it came from
    for (const k of ["screen", "webcam"]) {
      const pa = JSON.parse(fs.readFileSync(path.join(a, `${k}.prepared.json`), "utf8")), pb = JSON.parse(fs.readFileSync(path.join(b, `${k}.prepared.json`), "utf8"));
      assert.equal(pa.upload, undefined);
      assert.equal(pb.upload.file, fs.realpathSync(k === "screen" ? m.screen : m.webcam));
      const { upload, ...rest } = pb;
      assert.deepEqual(rest, pa);
    }
    const strip = (meta) => ({ ...meta, folder: undefined, t0: undefined, uploaded: undefined, sources: Object.fromEntries(Object.entries(meta.sources).map(([k, s]) => [k, { ...s, from: undefined }])) });
    const ma = JSON.parse(fs.readFileSync(path.join(a, "sources.json"), "utf8")), mb = JSON.parse(fs.readFileSync(path.join(b, "sources.json"), "utf8"));
    assert.deepEqual(strip(mb), strip(ma));
    assert.equal(mb.folder, "uploads/a.mp4 (screen), uploads/b.mp4 (webcam)");
    assert.equal(mb.uploaded, true);
    assert.equal(ma.uploaded, undefined);
    assert.equal(mb.sources.screen.from, "uploads/a.mp4");
    assert.equal(mb.sources.webcam.sync, ma.sources.webcam.sync);
    assert.ok(mb.sources.webcam.sync >= 0.5 || mb.sources.screen.sync >= 0.5, `the two laid onto each other by their sound: ${JSON.stringify(mb.sources)}`);
    // the role options are not kept as settings of the later steps
    assert.doesNotMatch(fs.readFileSync(path.join(b, "settings.json"), "utf8"), /screen|webcam|offset/);

    assert.deepEqual([hash(m.screen), hash(m.webcam)], before);
    assert.deepEqual(fs.readdirSync(path.join(cwd, "uploads")).sort(), ["a.mp4", "b.mp4", "c.mp4"]);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test("files without roles, a role's file that is not there, a bad --offset: one sentence that says what to do, nothing written", { skip: !hasFfmpeg && "no ffmpeg on this machine" }, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-"));
  try {
    media(path.join(cwd, "uploads"));
    const bare = run(cwd, "out/x", "uploads/a.mp4", "uploads/b.mp4");
    assert.equal(bare.status, 1);
    assert.match(bare.stdout, /^uploads\/a\.mp4 is a file, not a recorder's folder: look at a frame of each uploaded file to see which is the screen and which the webcam, then name them: node \S+ new out\/x --screen <file> --webcam <file>\n$/);

    const gone = run(cwd, "out/x", "--screen", "uploads/a.mp4", "--webcam", "uploads/nothere.mp4");
    assert.equal(gone.status, 1);
    assert.equal(gone.stdout, "--webcam uploads/nothere.mp4: no such file; give the path of the uploaded file as it is from here (uploads/…).\n");

    const both = run(cwd, "out/x", "rec", "--screen", "uploads/a.mp4");
    assert.equal(both.status, 1);
    assert.match(both.stdout, /^Give either the recorder's folder or the uploaded files with their roles, not both/);

    const other = run(cwd, "out/x", "--screen", "uploads/a.mp4", "--offset", "phone=1");
    assert.equal(other.status, 1);
    assert.match(other.stdout, /^--offset is <role>=<seconds> for a file given here \(screen\), as --offset screen=1\.5/);

    assert.ok(!fs.existsSync(path.join(cwd, "out")), "nothing written");
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test("--offset sets where a file starts on the clock; a file without sound stays there, said with the option to give", { skip: !hasFfmpeg && "no ffmpeg on this machine" }, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-"));
  try {
    media(path.join(cwd, "uploads"));
    const r = run(cwd, "out/x", "--screen", "uploads/a.mp4", "--webcam", "uploads/c.mp4", "--offset", "webcam=2");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /they start together but for --offset/);
    assert.match(r.stdout, /^webcam: no sound to lay it by, so it starts at 2\.00 s; if it began earlier or later than the others, start over with --offset webcam=<seconds> \(later: positive\)\.$/m);
    const meta = JSON.parse(fs.readFileSync(path.join(cwd, "out/x/source/sources.json"), "utf8"));
    assert.equal(meta.sources.webcam.offset, 2);
    assert.equal(meta.sources.screen.offset, 0);
    assert.equal(meta.mic, "screen");
    // its movement is on the recording's clock: the first sample after its start
    const activity = JSON.parse(fs.readFileSync(path.join(cwd, "out/x/source/activity.json"), "utf8"));
    assert.ok(activity.webcam[0].t >= 2, `the webcam's first sample at ${activity.webcam[0].t} s`);
    // the duration: the webcam runs to 8 s on the clock
    assert.ok(Math.abs(meta.duration - 8) < 0.1, `duration ${meta.duration}`);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test("a conversion is used again only for the file it came from: other files, or the roles swapped after a run was cut off, are converted again, said", { skip: !hasFfmpeg && "no ffmpeg on this machine" }, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-"));
  try {
    const m = media(path.join(cwd, "uploads"));
    fs.copyFileSync(m.mute, path.join(cwd, "uploads/d.mp4"));
    const silent = run(cwd, "out/x", "--screen", "uploads/c.mp4", "--webcam", "uploads/d.mp4");
    assert.equal(silent.status, 1);
    assert.match(silent.stdout, /No source carries sound/);
    const again = run(cwd, "out/x", "--screen", "uploads/a.mp4", "--webcam", "uploads/b.mp4");
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.match(again.stdout, /^screen: converted again: the conversion in out\/x\/source was made from another file, or from uploads\/a\.mp4 before it changed$/m);
    assert.match(again.stdout, /^webcam: converted again/m);
    assert.match(again.stdout, /^The uploaded files: 2 sources, preparing screen, webcam …$/m);
    const screen = fs.readFileSync(path.join(cwd, "out/x/source/screen.mp4"));

    // cut off before its end (no sources.json), then run with the roles swapped
    fs.rmSync(path.join(cwd, "out/x/source/sources.json"));
    const swapped = run(cwd, "out/x", "--screen", "uploads/b.mp4", "--webcam", "uploads/a.mp4");
    assert.equal(swapped.status, 0, swapped.stdout + swapped.stderr);
    assert.match(swapped.stdout, /^screen: converted again/m);
    assert.match(swapped.stdout, /^webcam: converted again/m);
    assert.ok(fs.readFileSync(path.join(cwd, "out/x/source/webcam.mp4")).equals(screen), "the webcam is now what the screen was");

    // the same files again: used as they are
    fs.rmSync(path.join(cwd, "out/x/source/sources.json"));
    const same = run(cwd, "out/x", "--screen", "uploads/b.mp4", "--webcam", "uploads/a.mp4");
    assert.equal(same.status, 0, same.stdout + same.stderr);
    assert.doesNotMatch(same.stdout, /converted again/);
    assert.match(same.stdout, /2 sources, 2 converted before, preparing nothing/);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test("one file for two roles, a role given twice, a role's seconds given twice, a mistyped role: each refused with one sentence; the option list names the roles and --offset", { skip: !hasFfmpeg && "no ffmpeg on this machine" }, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-"));
  try {
    media(path.join(cwd, "uploads"));
    const one = run(cwd, "out/x", "--screen", "uploads/a.mp4", "--webcam", "uploads/a.mp4");
    assert.equal(one.status, 1);
    assert.equal(one.stdout, "--screen and --webcam name the same file uploads/a.mp4: each role is a file of its own; look at a frame of each upload and give each role its file.\n");
    const twice = run(cwd, "out/x", "--screen", "uploads/a.mp4", "--screen", "uploads/b.mp4");
    assert.equal(twice.status, 1);
    assert.equal(twice.stdout, "--screen is given twice: give each role one file.\n");
    const seconds = run(cwd, "out/x", "--screen", "uploads/a.mp4", "--webcam", "uploads/b.mp4", "--offset", "webcam=1,webcam=3");
    assert.equal(seconds.status, 1);
    assert.equal(seconds.stdout, "--offset names webcam twice: give each role's seconds once.\n");
    const offsets = run(cwd, "out/x", "--screen", "uploads/a.mp4", "--offset", "screen=1", "--offset", "screen=3");
    assert.equal(offsets.status, 1);
    assert.match(offsets.stdout, /^--offset is given twice: give every role's seconds in one/);
    const typo = run(cwd, "out/x", "--phonescreen", "uploads/a.mp4");
    assert.equal(typo.status, 1);
    assert.match(typo.stdout, /^Unknown option --phonescreen\. Options: .*--screen --phone-screen --phone --webcam --audio --offset/);
    assert.ok(!fs.existsSync(path.join(cwd, "out")), "nothing written");
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test("a file whose name begins with a dash is read as a file", { skip: !hasFfmpeg && "no ffmpeg on this machine" }, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-"));
  try {
    const m = media(path.join(cwd, "uploads"));
    fs.copyFileSync(m.screen, path.join(cwd, "-screen.mp4"));
    const r = run(cwd, "out/x", "--screen", "-screen.mp4", "--webcam", "uploads/b.mp4");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const meta = JSON.parse(fs.readFileSync(path.join(cwd, "out/x/source/sources.json"), "utf8"));
    assert.equal(meta.sources.screen.from, "-screen.mp4");
    assert.equal(meta.sources.screen.width, 320);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test("--offset: plain decimal seconds only; one that puts a file where no other runs is refused with the numbers; a short source with sound well inside a long screen is taken where it is given", { skip: !hasFfmpeg && "no ffmpeg on this machine" }, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-"));
  try {
    media(path.join(cwd, "uploads"));
    const hex = run(cwd, "out/x", "--screen", "uploads/a.mp4", "--webcam", "uploads/b.mp4", "--offset", "webcam=0x10");
    assert.equal(hex.status, 1);
    assert.match(hex.stdout, /^--offset is <role>=<seconds> for a file given here \(screen, webcam\)/);
    const far = run(cwd, "out/x", "--screen", "uploads/a.mp4", "--webcam", "uploads/b.mp4", "--offset", "webcam=100");
    assert.equal(far.status, 1);
    assert.equal(far.stdout, "--offset webcam=100 puts the webcam's 6.0 s at 100.0–106.0 s, where none of the others runs (they run 0.0–6.0 s): give how many seconds after the others it began, within that.\n");
    assert.ok(!fs.existsSync(path.join(cwd, "out")), "nothing written");
    // a 10 s webcam with sound that began 20 s into a 60 s screen recording without sound
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=320x180:r=10:d=60", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(cwd, "uploads/long.mp4"));
    ffmpeg("-f", "lavfi", "-i", "mandelbrot=s=160x120:r=30", "-f", "lavfi", "-i", VOICE.replace("d=6", "d=10"), "-t", "10", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(cwd, "uploads/cam10.mp4"));
    const inside = run(cwd, "out/x", "--screen", "uploads/long.mp4", "--webcam", "uploads/cam10.mp4", "--offset", "webcam=20");
    assert.equal(inside.status, 0, inside.stdout + inside.stderr);
    const meta = JSON.parse(fs.readFileSync(path.join(cwd, "out/x/source/sources.json"), "utf8"));
    assert.equal(meta.mic, "webcam");
    assert.equal(meta.sources.webcam.offset, 20);
    assert.equal(meta.sources.screen.offset, 0);
    assert.ok(Math.abs(meta.duration - 60) < 0.2, `duration ${meta.duration}`);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test("two uploads that began 5 s apart: the match fails and the output names --offset; with --offset the sound lines them up; the brief says which source was not lined up", { skip: !hasFfmpeg && "no ffmpeg on this machine" }, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-"));
  try {
    fs.mkdirSync(path.join(cwd, "uploads"));
    const bursts = [[0.4, 1.1], [1.6, 1.9], [2.5, 3.6], [4.2, 4.5], [5, 5.7], [6.3, 6.5], [7.1, 8.4], [9, 9.3], [9.9, 10.2], [10.8, 11.7]];
    const voice = path.join(cwd, "voice.wav");
    ffmpeg("-f", "lavfi", "-i", `anoisesrc=d=12:c=pink:a=0.3,volume='if(${bursts.map(([a, b]) => `between(t,${a},${b})`).join("+")},1,0.02)':eval=frame`, voice);
    // the screen from 0 s, the webcam from 5 s of the same sound
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=12", "-i", voice, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(cwd, "uploads/a.mp4"));
    ffmpeg("-f", "lavfi", "-i", "mandelbrot=s=160x120:r=30", "-ss", "5", "-i", voice, "-t", "7", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(cwd, "uploads/b.mp4"));
    const apart = run(cwd, "out/x", "--screen", "uploads/a.mp4", "--webcam", "uploads/b.mp4");
    assert.equal(apart.status, 0, apart.stdout + apart.stderr);
    const meta = JSON.parse(fs.readFileSync(path.join(cwd, "out/x/source/sources.json"), "utf8"));
    const other = meta.mic === "webcam" ? "screen" : "webcam";
    assert.ok(meta.sources[other].sync < 0.5, `no match: ${JSON.stringify(meta.sources[other])}`);
    assert.match(apart.stdout, new RegExp(`^${other}: its sound does not match the voice \\(\\S+\\): its start stays as given$`, "m"));
    assert.match(apart.stdout, new RegExp(`^${other}: its sound does not match the voice, so it starts at 0\\.00 s; if it began earlier or later than the others, start over with --offset ${other}=<seconds> \\(later: positive\\)\\.$`, "m"));
    // the brief, from words with their edges, says it too
    fs.writeFileSync(path.join(cwd, "words.json"), JSON.stringify({ edges: "sound", words: bursts.map(([a, b], i) => ({ text: i % 3 === 2 ? "word." : "word", start: a, end: b })) }));
    const w = spawnSync(process.execPath, [TOOL, "words", "out/x", "words.json"], { cwd, encoding: "utf8", env: ENV });
    assert.equal(w.status, 0, w.stdout + w.stderr);
    assert.match(fs.readFileSync(path.join(cwd, "out/x/source/brief.md"), "utf8"), new RegExp(`\\*\\*${other}\\*\\* \\([^)]*, from 0\\.00 s, not lined up by sound \\(match \\S+\\): it starts where its file starts, as given\\)`));

    const given = run(cwd, "out/y", "--screen", "uploads/a.mp4", "--webcam", "uploads/b.mp4", "--offset", "webcam=5");
    assert.equal(given.status, 0, given.stdout + given.stderr);
    const lined = JSON.parse(fs.readFileSync(path.join(cwd, "out/y/source/sources.json"), "utf8"));
    const o = lined.mic === "webcam" ? "screen" : "webcam";
    assert.ok(lined.sources[o].sync >= 0.5, `matched: ${JSON.stringify(lined.sources[o])}`);
    assert.ok(Math.abs(lined.sources.webcam.offset - lined.sources.screen.offset - 5) < 0.05, `5 s apart: ${lined.sources.screen.offset}, ${lined.sources.webcam.offset}`);
    assert.doesNotMatch(given.stdout, /start over with --offset/);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});
