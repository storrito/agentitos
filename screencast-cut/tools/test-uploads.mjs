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
    assert.match(loose.stdout, /Uploaded files have no recording\.json, so no start times and no pauses: they start together and each one with sound is laid onto the voice by its sound within 1\.5 s/);
    assert.match(loose.stdout, /^The uploaded files: 2 sources/m);
    assert.match(loose.stdout, /Next, the words of/);

    // the same files, byte for byte, but sources.json's names of where they came from and the clock's zero
    const a = path.join(cwd, "out/folder/source"), b = path.join(cwd, "out/loose/source");
    assert.deepEqual(fs.readdirSync(b).sort(), fs.readdirSync(a).sort());
    for (const f of fs.readdirSync(a).filter((f) => f !== "sources.json")) assert.equal(hash(path.join(b, f)), hash(path.join(a, f)), f);
    const strip = (meta) => ({ ...meta, folder: undefined, t0: undefined, sources: Object.fromEntries(Object.entries(meta.sources).map(([k, s]) => [k, { ...s, from: undefined }])) });
    const ma = JSON.parse(fs.readFileSync(path.join(a, "sources.json"), "utf8")), mb = JSON.parse(fs.readFileSync(path.join(b, "sources.json"), "utf8"));
    assert.deepEqual(strip(mb), strip(ma));
    assert.equal(mb.folder, "uploads/a.mp4 (screen), uploads/b.mp4 (webcam)");
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
