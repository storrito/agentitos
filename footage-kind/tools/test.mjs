#!/usr/bin/env node
// kind.mjs on recordings made here with ffmpeg, whose kind is known because they were built that
// way: a desktop's screen (a picture that stands, a display's shape), a phone's screen, two
// cameras that carry one sound 1.5 s apart, a video with black bars, sound alone, a screenshot,
// a text. Real recordings behave less cleanly; this only keeps the mechanics from breaking.
//
//   node test.mjs [folder]     (default: a temporary one, removed afterwards)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const tool = path.join(path.dirname(fileURLToPath(import.meta.url)), "kind.mjs");
const dir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "footage-kind-test-"));
const ff = (...args) => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" });
  if (r.error?.code === "ENOENT") { console.error("ffmpeg is missing: install ffmpeg, then run this again."); process.exit(1); }
  if (r.status !== 0) { console.error(`ffmpeg could not make a test file: ${r.stderr.trim().split("\n").pop()}`); process.exit(1); }
};
const at = (...p) => path.join(dir, ...p);
for (const d of ["screencast", "cameras", "phone", "bars", "voice", "stills"]) fs.mkdirSync(at(d), { recursive: true });

// a voice's rhythm: a tone that comes and goes irregularly
const voice = (from = 0) => ["-f", "lavfi", "-i", `aevalsrc=0.4*sin(2*PI*190*(t+${from}))*gt(sin(2*PI*0.37*(t+${from}))+sin(2*PI*0.91*(t+${from}))+sin(2*PI*1.73*(t+${from}))\\,0.3):s=16000:d=30`];
const x264 = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac"];
// a screen: white, with one small box that jumps once a second
const screen = (size, out, sound) => ff("-f", "lavfi", "-i", `color=c=white:s=${size}:r=30:d=12`, "-f", "lavfi", "-i", "color=c=black:s=80x80:r=30:d=12", ...(sound ? voice() : []),
  "-filter_complex", "[0][1]overlay=x='if(lt(mod(t,2),1),200,700)':y=400", ...(sound ? ["-shortest"] : []), ...x264, out);
// a camera: a picture that moves, with a sensor's noise
const camera = (src, out, from) => ff("-f", "lavfi", "-i", `${src}=s=1280x720:r=30:d=${30 - from}`, ...voice(from), "-vf", "noise=alls=24:allf=t", "-shortest", ...x264, out);

screen("2560x1600", at("screencast", "desk.mp4"), true);
camera("testsrc2", at("screencast", "face.mp4"), 0);
camera("testsrc2", at("cameras", "cam-a.mp4"), 0);
camera("testsrc", at("cameras", "cam-b.mp4"), 1.5);
screen("1170x2532", at("phone", "phone.mp4"), false);
fs.mkdirSync(at("wide"), { recursive: true });
screen("2200x1000", at("wide", "wide.mp4"), false);
ff("-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=8", "-vf", "noise=alls=24:allf=t,pad=1280:2276:0:778:black", ...x264, at("bars", "bars.mp4"));
// a phone's own file: upright, a calm wall over a moving lower part, and tags of the phone and of a place
fs.mkdirSync(at("phonecam"), { recursive: true });
ff("-f", "lavfi", "-i", "color=c=0xd8d8d8:s=1080x1920:r=30:d=8", "-f", "lavfi", "-i", "testsrc2=s=1080x1300:r=30:d=8", ...voice(), "-filter_complex", "[1]noise=alls=24:allf=t[m];[0][m]overlay=0:620", "-t", "8", ...x264,
  "-movflags", "use_metadata_tags", "-metadata", "com.android.manufacturer=TestMaker", "-metadata", "com.android.model=TestPhone 1", "-metadata", "location=+12.3456-098.7654/", at("phonecam", "PXL_test.mp4"));
ff(...voice(), "-c:a", "aac", at("voice", "voice.m4a"));
ff("-f", "lavfi", "-i", "color=c=white:s=1179x2556", "-frames:v", "1", at("stills", "shot.png"));
fs.writeFileSync(at("stills", "notes.txt"), "Three things to say about the new feature.\n");

let failed = 0;
const check = (what, ok, got) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : `: got ${JSON.stringify(got)}`}`); if (!ok) failed++; };
const look = (name) => {
  const r = spawnSync("node", [tool, "look", at("out", name), at(name)], { encoding: "utf8" });
  if (r.status !== 0) { console.error(`kind.mjs failed on ${name}: ${r.stderr}`); process.exit(1); }
  return JSON.parse(fs.readFileSync(at("out", name, "footage.json"), "utf8"));
};
const kind = (r, name) => r.files.find((f) => f.name === name)?.kind;
const named = (r) => [...r.recordings.flatMap((x) => x.situations), ...r.whole].map((s) => s.id);

let r = look("screencast");
check("a picture that stands in a display's shape is a desktop's screen", kind(r, "desk.mp4") === "desktop-screen" && r.files.find((f) => f.name === "desk.mp4").sure, r.files.find((f) => f.name === "desk.mp4"));
check("a noisy, moving picture is a camera's", kind(r, "face.mp4") === "camera", kind(r, "face.mp4"));
check("screen and camera with one sound are one recording, named B2", r.recordings.length === 1 && named(r).includes("B2"), [r.recordings.length, named(r)]);
check("the screen's sheet was written", fs.existsSync(at("out", "screencast", r.files[0].sheet || "none")), r.files[0].sheet);

r = look("cameras");
const b = r.files.find((f) => f.name === "cam-b.mp4");
check("two cameras with one sound are one recording, named G2", r.recordings.length === 1 && named(r).includes("G2"), [r.recordings.length, named(r)]);
check("the second camera starts 1.5 s after the first", Math.abs((b.starts ?? -9) - 1.5) <= 0.06, b.starts);

r = look("phone");
check("a picture narrower than 9:16 that stands is a phone's screen, named B4", kind(r, "phone.mp4") === "phone-screen" && named(r).includes("B4"), [kind(r, "phone.mp4"), named(r)]);

r = look("wide");
check("a picture wider than 2:1 that stands is never called a phone's screen, and never sure", kind(r, "wide.mp4") !== "phone-screen" && !r.files[0].sure, [kind(r, "wide.mp4"), r.files[0].sure]);

r = look("phonecam");
const cam = r.files[0], written = fs.readFileSync(at("out", "phonecam", "footage.json"), "utf8");
check("a file that names its phone is a camera, sure, named P1, whatever its picture measures", cam.kind === "camera" && cam.sure && named(r).includes("P1"), [cam.kind, cam.sure, named(r), cam.picture?.band]);
check("the place a phone wrote into its file is nowhere in footage.json, only that there is one", cam.facts.located === true && !/12\.3456|098\.7654/.test(written) && !("tags" in cam.facts), [cam.facts.located, /12\.3456/.test(written)]);

r = look("bars");
check("black bars above and below make a finished video, named F2", kind(r, "bars.mp4") === "finished" && named(r).includes("F2"), [kind(r, "bars.mp4"), r.files[0].picture?.bars]);

r = look("voice");
check("sound alone is audio, named O1", kind(r, "voice.m4a") === "audio" && named(r).includes("O1"), [kind(r, "voice.m4a"), named(r)]);
check("its rhythm counts as pauses", r.files[0].sound.pauses >= 6, r.files[0].sound);

r = look("stills");
check("a picture and a text are a still and text, together O3", kind(r, "shot.png") === "still" && kind(r, "notes.txt") === "text" && named(r).includes("O3"), [kind(r, "shot.png"), kind(r, "notes.txt"), named(r)]);
check("a still in a phone screen's shape is called a likely screenshot", /screenshot/.test(r.files.find((f) => f.name === "shot.png").evidence.join(" ")), r.files.find((f) => f.name === "shot.png").evidence);

if (!process.argv[2]) fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
