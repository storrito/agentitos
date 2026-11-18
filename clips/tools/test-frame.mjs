// The framing's mechanics on made-up footage (ffmpeg's test pictures, a box that moves) and
// made-up answers of the model: no model, no network.
//
//   node --test tools/test-frame.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { smallFrames, findCuts, confirmed, shotsBetween } from "./lib/cuts.mjs";
import { shotsOf, windowsOf, windowAt, edgesOf, faceAt, stillsOf, render, speakerTimeline } from "./frame.mjs";
import { greyFrames, fillTrack, uncross } from "./lib/track.mjs";

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const FPS = 25;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "clips-frame-test-"));
const near = (x, y, by) => assert.ok(Math.abs(x - y) <= by, `${x} is not within ${by} of ${y}`);

// three different pictures that move, 2 s each, joined by `join` (null: hard cuts, else an
// xfade transition of `length` seconds)
function footage(dir, join = null, length = 0) {
  const file = path.join(dir, `${join || "hard"}.mp4`);
  const src = ["testsrc2", "smptehdbars", "mandelbrot"].map((s) => ["-f", "lavfi", "-t", "2", "-i", `${s}=s=320x180:r=${FPS}`]).flat();
  const graph = join
    ? `[0:v]settb=1/${FPS}[a];[1:v]settb=1/${FPS}[b];[2:v]settb=1/${FPS}[c];[a][b]xfade=transition=${join}:duration=${length}:offset=${2 - length}[ab];[ab][c]xfade=transition=${join}:duration=${length}:offset=${4 - 2 * length},format=yuv420p[v]`
    : `[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]`;
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...src, "-filter_complex", graph, "-map", "[v]", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", file], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return file;
}

test("hard cuts are found to the frame, nothing else", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    const frames = smallFrames(footage(dir));
    assert.equal(frames.length, 150);
    const cuts = findCuts(frames, FPS);
    assert.deepEqual(cuts.map((c) => [c.frame, c.sure]), [[50, true], [100, true]]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a short wipe is one cut, placed where the new picture has the larger part", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    // 0.24 s = 6 frames: the first wipe from frame 44 to 50, the second from 88 to 94
    const frames = smallFrames(footage(dir, "slideleft", 0.24));
    const cuts = findCuts(frames, FPS).filter((c) => c.sure);
    assert.equal(cuts.length, 2, JSON.stringify(cuts));
    near(cuts[0].frame, 47, 2);
    near(cuts[1].frame, 91, 2);
    assert.ok(cuts[0].to - cuts[0].from >= 2, "a wipe takes several frames");
    const shots = shotsBetween(cuts, frames.length, FPS);
    assert.equal(shots.length, 3);
    // the stills of a shot are taken after the wipe that brings it in and before the one that takes it out
    assert.ok(shots[1].settled > shots[1].start && (shots[1].leaving ?? shots[1].end) <= shots[1].end, JSON.stringify(shots[1]));
    const stills = stillsOf(shots, FPS).filter((s) => s.shot === 1);
    assert.ok(stills[0].t >= shots[1].settled && stills.at(-1).t <= (shots[1].leaving ?? shots[1].end), JSON.stringify(stills));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a dissolve of over half a second is one cut", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    // 0.6 s = 15 frames: from frame 35 to 50, and from 70 to 85
    const frames = smallFrames(footage(dir, "fade", 0.6));
    const cuts = findCuts(frames, FPS).filter((c) => c.sure);
    assert.equal(cuts.length, 2, JSON.stringify(cuts));
    near(cuts[0].frame, 42, 4);
    near(cuts[1].frame, 77, 4);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a box moving across the picture, or a camera panning, is no cut", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    const box = path.join(dir, "box.mp4"), pan = path.join(dir, "pan.mp4");
    let r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=black:s=320x180:r=${FPS}:d=4`, "-f", "lavfi", "-i", `color=c=white:s=60x60:r=${FPS}:d=4`,
      "-filter_complex", "[0:v][1:v]overlay=x='20+t*60':y=60,format=yuv420p[v]", "-map", "[v]", "-c:v", "libx264", "-preset", "ultrafast", box], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    // the camera panning over a quarter of the picture in two seconds
    r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc2=s=640x180:r=${FPS}:d=4`, "-vf", "crop=320:180:x='min(80,max(0,(t-1)*40))':y=0,format=yuv420p", "-c:v", "libx264", "-preset", "ultrafast", pan], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(findCuts(smallFrames(box), FPS).filter((c) => c.sure), []);
    assert.deepEqual(findCuts(smallFrames(pan), FPS).filter((c) => c.sure), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a possible cut counts only where the model named one; no shot shorter than six frames", () => {
  const cuts = [{ frame: 3, sure: true }, { frame: 40, sure: false }, { frame: 80, sure: true }, { frame: 84, sure: true }, { frame: 120, sure: false }];
  assert.deepEqual(confirmed(cuts, FPS, [1.7]).map((c) => c.frame), [3, 40, 80, 84]);
  const shots = shotsBetween(confirmed(cuts, FPS, [1.7]), 150, FPS, { start: 0.04 });
  // 3 is too close to the start, 84 to 80
  assert.deepEqual(shots.map((s) => [s.first, s.last]), [[0, 39], [40, 79], [80, 149]]);
  // borders half a frame before a shot's first frame, the footage's own start included
  near(shots[1].start, 0.04 + 39.5 / FPS, 1e-3);
  assert.equal(shots[0].start, 0);
  near(shots[2].end, 0.04 + 150 / FPS, 1e-3);
  // a possible cut confirmed a few frames before a sure one gives way to it
  assert.deepEqual(shotsBetween([{ frame: 40, sure: false }, { frame: 43, sure: true }], 150, FPS).map((s) => s.first), [0, 43]);
});

const META = { width: 3840, height: 2160, fps: FPS };
// a shot's answer of the second kind: per still the faces as [ymin, xmin, ymax, xmax]
const shotAnswer = (start, end, kind, people, stills) => ({ start, end, kind, subject: [0, 0, 1000, 1000], people, stills });

test("a face that moves across the shot is held at every still, by a window that follows it", () => {
  // a speaker walking from the left third to the right third in 6 s
  const ans = { version: 2, shots: [shotAnswer(0, 6, "people", [{ who: "host", speaker: "A" }],
    [0.1, 3, 5.9].map((t, i) => ({ t, faces: [{ person: 0, box_2d: [200, 150 + i * 300, 400, 250 + i * 300] }] })))] };
  const shots = shotsOf(ans, [{ start: 0, end: 6 }], META);
  assert.equal(shots[0].people[0].track.length, 3);
  const windows = windowsOf(shots, [{ t: 0, speaker: "A" }], { ...META, aspect: [9, 16] });
  assert.equal(windows.length, 1);
  assert.equal(windows[0].hold, "follows");
  assert.deepEqual(edgesOf(windows, shots, META), []);
  // the window of the first kind (one place for the shot) loses the face
  const still = { ...windows[0], keys: [windows[0].keys[0]] }, at = windowAt(still, 3), f = faceAt(shots[0].people[0], 3);
  assert.ok(f.x - f.w / 2 > at.x + at.w || f.x + f.w / 2 > at.x + at.w, "a still window loses the face");
});

test("a face that moves a little gets a wider still window, not a following one", () => {
  const ans = { version: 2, shots: [shotAnswer(0, 6, "people", [{ who: "guest", speaker: "B" }],
    [0.1, 3, 5.9].map((t, i) => ({ t, faces: [{ person: 0, box_2d: [250, 420 + i * 40, 420, 500 + i * 40] }] })))] };
  const shots = shotsOf(ans, [{ start: 0, end: 6 }], META);
  const [w] = windowsOf(shots, [{ t: 0, speaker: "B" }], { ...META, aspect: [9, 16] });
  assert.ok(["still", "wider"].includes(w.hold), w.hold);
  assert.equal(w.keys.length, 1);
  assert.deepEqual(edgesOf([w], shots, META), []);
});

test("a person low in a wide shot is brought up: eyes in the upper part, not an empty wall above", () => {
  // one face whose middle is at 42 % of the height, a tenth of the height tall
  const ans = { version: 2, shots: [shotAnswer(0, 4, "people", [{ who: "guest", speaker: "A" }],
    [{ t: 2, faces: [{ person: 0, box_2d: [370, 700, 470, 760] }] }])] };
  const shots = shotsOf(ans, [{ start: 0, end: 4 }], META);
  const [w] = windowsOf(shots, [{ t: 0, speaker: "A" }], { ...META, aspect: [9, 16] });
  assert.ok(w.h < META.height, "closer than the whole height");
  assert.ok(w.h >= META.height * 0.55, "not closer than the footage allows");
  const at = windowAt(w, 2), f = faceAt(shots[0].people[0], 2);
  near((f.y - at.y) / w.h, 0.32, 0.03);
});

test("a wide shot called split or B-roll, in which someone of the talk speaks with a small face, is cut to who speaks", () => {
  const ans = { version: 2, shots: [{ ...shotAnswer(0, 5, "split", [{ who: "host", speaker: "C" }, { who: "guest", speaker: null }],
    [{ t: 2.5, faces: [{ person: 0, box_2d: [360, 140, 440, 185] }, { person: 1, box_2d: [360, 830, 430, 866] }] }]), material: false }] };
  const shots = shotsOf(ans, [{ start: 0, end: 5 }], META);
  assert.equal(shots[0].kind, "people");
  assert.match(shots[0].note, /cut to who speaks/);
  const [w] = windowsOf(shots, [{ t: 0, speaker: "C" }], { ...META, aspect: [9, 16] });
  assert.equal(w.kind, "people");
  const at = windowAt(w, 2.5), f = faceAt(shots[0].people[0], 2.5);
  assert.ok(f.x - f.w / 2 > at.x && f.x + f.w / 2 < at.x + w.w, "the speaker is in the window");
  // the agent's --whole still shows it whole
  const [whole] = windowsOf(shots, [{ t: 0, speaker: "C" }], { ...META, aspect: [9, 16], kinds: [{ t: 1, kind: "broll" }] });
  assert.ok(whole.fit);
  // a real split screen with big faces stays as it was
  const call = { version: 2, shots: [shotAnswer(0, 5, "split", [{ who: "a", speaker: "A" }],
    [{ t: 2.5, faces: [{ person: 0, box_2d: [200, 150, 600, 350] }] }])] };
  assert.equal(shotsOf(call, [{ start: 0, end: 5 }], META)[0].kind, "split");
});

test("the check names a face cut by the window's edge, with its time", () => {
  const ans = { version: 2, shots: [shotAnswer(0, 4, "people", [{ who: "host", speaker: "A" }, { who: "guest", speaker: "B" }],
    [{ t: 2, faces: [{ person: 0, box_2d: [300, 380, 450, 440] }, { person: 1, box_2d: [300, 520, 450, 580] }] }])] };
  const shots = shotsOf(ans, [{ start: 0, end: 4 }], META);
  // a window on A whose right edge runs through B's face
  const w = { start: 0, end: 4, shot: 0, kind: "people", w: 1216, h: 2160, keys: [{ t: 0, x: 3840 * 0.55 - 1216, y: 0 }] };
  const edges = edgesOf([w], shots, META);
  assert.ok(edges.some((e) => e.who === "guest" && e.cut && e.edge === "right" && e.t === 2), JSON.stringify(edges));
});

test("an answer of the first kind (one face per shot, the model's own times) still frames", () => {
  const old = { model: "x", cost: 0, shots: [
    { start: 0, end: 2.6, kind: "people", subject: { left: 0, top: 0, right: 1000, bottom: 1000 }, people: [{ speaker: "A", who: "host", face: { left: 100, top: 300, right: 200, bottom: 450 } }] },
    { start: 2.6, end: 6, kind: "broll", subject: { left: 100, top: 100, right: 900, bottom: 900 }, people: [] },
  ] };
  // the real cut is at 3.0 s, not where the model put it
  const shots = shotsOf(old, [{ start: 0, end: 3.02 }, { start: 3.02, end: 6 }], META);
  assert.deepEqual(shots.map((s) => s.kind), ["people", "broll"]);
  const windows = windowsOf(shots, speakerTimeline([{ start: 0, end: 5, speaker: "A", text: "x" }]), { ...META, aspect: [9, 16] });
  assert.equal(windows[0].end, 3.02);
  assert.equal(windows[1].start, 3.02);
});

test("the rendered window keeps a moving box inside the frame, at the footage's own timing", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    // a white box crossing a black 640×360 picture in 4 s, the picture starting 0.04 s after the sound
    const video = path.join(dir, "box.mp4");
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=black:s=640x360:r=${FPS}:d=4`, "-f", "lavfi", "-i", `color=c=white:s=40x40:r=${FPS}:d=4`, "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
      "-filter_complex", "[0:v][1:v]overlay=x='40+t*130':y=150,setpts=PTS+0.04/TB,format=yuv420p[v]", "-map", "[v]", "-map", "2:a", "-t", "4.04", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", video], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const meta = { width: 640, height: 360, fps: FPS };
    const box = (t) => [150 / 3.6, ((40 + t * 130) / 640) * 1000, 190 / 3.6, ((80 + t * 130) / 640) * 1000];
    const ans = { version: 2, shots: [shotAnswer(0, 4.04, "people", [{ who: "box", speaker: "A" }], [0.1, 1.3, 2.6, 3.9].map((t) => ({ t, faces: [{ person: 0, box_2d: box(t) }] })))] };
    const shots = shotsOf(ans, [{ start: 0, end: 4.04 }], meta);
    const windows = windowsOf(shots, [{ t: 0, speaker: "A" }], { ...meta, aspect: [9, 16], outW: 180 });
    assert.equal(windows[0].hold, "follows");
    const out = path.join(dir, "framed.mp4");
    render(video, windows, out, { outW: 180, outH: 320, fps: FPS, start: 0.04 });
    const frames = Number(spawnSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", out], { encoding: "utf8" }).stdout);
    near(frames, 101, 1);
    // every frame: the box is in the picture, and not at its left or right edge
    const g = spawnSync("ffmpeg", ["-v", "error", "-i", out, "-vsync", "passthrough", "-vf", "format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 });
    const W = 180, H = 320, n = g.stdout.length / (W * H);
    let seen = 0;
    for (let i = 2; i < n; i++) {
      const f = g.stdout.subarray(i * W * H, (i + 1) * W * H);
      let white = 0, edge = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (f[y * W + x] > 128) { white++; if (x < 4 || x >= W - 4) edge++; }
      if (white) seen++;
      assert.equal(edge, 0, `frame ${i}: the box touches the edge`);
    }
    assert.ok(seen >= n - 3, `the box is in ${seen} of ${n} frames`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("between two stills the face is followed in the frames, where a straight line would lose it", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    // a grey square on a dark picture goes right and comes back in 4 s: at both ends it is at the left
    const video = path.join(dir, "swing.mp4");
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=0x101010:s=1280x720:r=${FPS}:d=4`, "-f", "lavfi", "-i", `testsrc2=s=120x140:r=${FPS}:d=4`,
      "-filter_complex", "[0:v][1:v]overlay=x='100+500*sin(PI*t/4)':y=200,format=yuv420p[v]", "-map", "[v]", "-c:v", "libx264", "-preset", "ultrafast", video], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const at = (t) => ({ t, x: 160 + 500 * Math.sin((Math.PI * t) / 4), y: 270, w: 120, h: 140 });
    const grey = greyFrames(video);
    const track = fillTrack(grey, [at(0.2), at(3.8)], 0, 4);
    assert.ok(track.length > 30, `${track.length} points`);
    for (const t of [1, 2, 3]) near(faceAt({ track }, t).x, at(t).x, 40);
    // the window built on it keeps the square inside at every point
    const shots = [{ start: 0, end: 4, kind: "people", people: [{ who: "square", speaker: "A", track }], faces: [{ speaker: "A", who: "square", ...at(2) }] }];
    const windows = windowsOf(shots, [{ t: 0, speaker: "A" }], { width: 1280, height: 720, fps: FPS, aspect: [9, 16] });
    assert.equal(windows[0].hold, "follows");
    const truth = [{ who: "square", speaker: "A", track: Array.from({ length: 37 }, (_, i) => at(0.2 + i * 0.1)) }];
    assert.deepEqual(edgesOf(windows, [{ ...shots[0], people: truth }], { fps: FPS }).filter((e) => e.cut), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("footage of a variable frame rate: the cut sits at the frames' own time, not at frame number over rate", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    // 4 s at 15 frames a second, then 3 s at 30 (the file says 30): the cut is at 4.0 s, frame 60
    const video = path.join(dir, "vfr.mp4");
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=15:d=4", "-f", "lavfi", "-i", "smptehdbars=s=320x180:r=30:d=3",
      "-filter_complex", "[0:v]settb=1/30[a];[1:v]settb=1/30[b];[a][b]concat=n=2:v=1,format=yuv420p[v]", "-map", "[v]", "-vsync", "vfr", "-c:v", "libx264", "-preset", "ultrafast", video], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const frames = smallFrames(video);
    assert.equal(frames.times.length, frames.length);
    const cuts = findCuts(frames, 30);
    assert.deepEqual(cuts.map((c) => c.frame), [60]);
    const shots = shotsBetween(cuts, frames.length, 30, { times: frames.times });
    near(shots[1].start, 3.967, 0.02);
    near(shots[1].end, 7.0, 0.05);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("someone standing up, or a hand waved in front of the lens, is no sure cut: a cut changes the whole picture and keeps it changed", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    // a white body rising into a third of the picture over half a second (the reviewer's cook standing up, change 36)
    const stand = path.join(dir, "stand.mp4");
    let r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc2=s=320x180:r=${FPS}:d=4`, "-f", "lavfi", "-i", `color=c=white:s=150x160:r=${FPS}:d=4`,
      "-filter_complex", "[0:v][1:v]overlay=x=150:y='if(lt(t,2),180,if(lt(t,2.48),180-(t-2)/0.48*170,10))',format=yuv420p[v]", "-map", "[v]", "-c:v", "libx264", "-preset", "ultrafast", stand], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(findCuts(smallFrames(stand), FPS).filter((c) => c.sure), []);
    // a hand that covers most of the picture over a few frames and is gone half a second later
    const hand = path.join(dir, "hand.mp4");
    r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc2=s=320x180:r=${FPS}:d=4`, "-f", "lavfi", "-i", `color=c=0xd0a080:s=300x170:r=${FPS}:d=4`,
      "-filter_complex", "[0:v][1:v]overlay=x='if(lt(t,1.5),330,if(lt(t,1.7),330-(t-1.5)/0.2*320,if(lt(t,2.1),10,if(lt(t,2.3),10+(t-2.1)/0.2*320,330))))':y=5,format=yuv420p[v]",
      "-map", "[v]", "-c:v", "libx264", "-preset", "ultrafast", hand], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(findCuts(smallFrames(hand), FPS).filter((c) => c.sure), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a white flash inside one shot is no cut; a flash between two different pictures is one", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    // the reviewer's 49g frames 1984/1991: the picture flashes white and fades back, a little brighter
    const flash = (file, second) => spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc2=s=320x180:r=${FPS}:d=4`, "-f", "lavfi", "-i", `${second}=s=320x180:r=${FPS}:d=4`,
      "-filter_complex", `[0:v]trim=0:2,setpts=PTS-STARTPTS[a];[1:v]trim=2:4,setpts=PTS-STARTPTS,eq=brightness=0.06[b];[a][b]concat=n=2:v=1[ab];`
        + `[ab]geq=lum='if(between(T,1.96,2.24),255-(abs(T-2.04)*900),lum(X,Y))':cb='cb(X,Y)':cr='cr(X,Y)',format=yuv420p[v]`,
      "-map", "[v]", "-c:v", "libx264", "-preset", "ultrafast", file], { encoding: "utf8" });
    const same = path.join(dir, "same.mp4"), other = path.join(dir, "other.mp4");
    let r = flash(same, "testsrc2");
    assert.equal(r.status, 0, r.stderr);
    r = flash(other, "smptehdbars");
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(findCuts(smallFrames(same), FPS).filter((c) => c.sure), []);
    assert.equal(findCuts(smallFrames(other), FPS).filter((c) => c.sure).length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a very dark hard cut, a two-second dissolve and a fade through black are each one sure cut, in the middle of a long one", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    const make = (name, graph, inputs) => {
      const file = path.join(dir, name);
      const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...inputs.flatMap((i) => ["-f", "lavfi", "-t", "6", "-i", i]), "-filter_complex", graph, "-map", "[v]",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "10", file], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      return smallFrames(file);
    };
    const bars = `smptehdbars=s=320x180:r=${FPS}`, rgb = `rgbtestsrc=s=320x180:r=${FPS}`;
    // the reviewer's dark cut: a picture of mean 4 turns into another, a change of 4.6 against 0 beside it
    const dark = make("dark.mp4", "[0:v]trim=0:3,eq=contrast=0.1:brightness=-0.42[a];[1:v]trim=0:3,vflip,eq=contrast=0.1:brightness=-0.42[b];[a][b]concat=n=2:v=1,format=yuv420p[v]", [bars, bars]);
    assert.deepEqual(findCuts(dark, FPS).map((c) => [c.frame, c.sure]), [[75, true]]);
    // a dissolve of two seconds (frames 25 to 75)
    const diss = make("diss.mp4", `[0:v]settb=1/${FPS}[a];[1:v]settb=1/${FPS}[b];[a][b]xfade=transition=fade:duration=2:offset=1,format=yuv420p[v]`, [bars, rgb]);
    const d = findCuts(diss, FPS);
    assert.equal(d.length, 1);
    assert.ok(d[0].sure && d[0].frame > 35 && d[0].frame < 65, JSON.stringify(d));
    // two seconds to black, two from it (black around frames 44 to 64): one cut in the black
    const fade = make("fade.mp4", `[0:v]settb=1/${FPS}[a];[1:v]settb=1/${FPS}[b];[a][b]xfade=transition=fadeblack:duration=4:offset=1,format=yuv420p[v]`, [bars, rgb]);
    const f = findCuts(fade, FPS);
    assert.equal(f.length, 1, JSON.stringify(f));
    assert.ok(f[0].sure && f[0].frame >= 44 && f[0].frame <= 64, JSON.stringify(f));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// a person whose face is at every tenth of a second where `at(t)` says, for windowsOf
const tracked = (who, speaker, at, t0, t1) => ({ who, speaker, track: Array.from({ length: Math.round((t1 - t0) * 10) + 1 }, (_, i) => ({ t: +(t0 + i / 10).toFixed(2), ...at(t0 + i / 10) })) });
const HD = { width: 1920, height: 1080, fps: FPS };

test("a window that follows a face does not stop at a change of speaker", () => {
  // A walks across the picture; a second voice off the picture speaks in between (the window
  // stays on A, the face it shows), then A again: two changes of speaker inside one shot
  const A = tracked("A", "A", (t) => ({ x: 280 + 200 * t, y: 400, w: 480, h: 520 }), 0, 7);
  const shots = [{ start: 0, end: 7, kind: "people", people: [A], faces: [{ speaker: "A", ...faceAt(A, 3.5) }] }];
  const timeline = [{ t: 0, speaker: "A" }, { t: 2.5, speaker: "B" }, { t: 4.5, speaker: "A" }];
  const windows = windowsOf(shots, timeline, { ...HD, aspect: [9, 16] });
  for (let t = 0; t < 7; t += 1 / FPS) {
    const p = windows.find((w) => w.start <= t && w.end > t), win = windowAt(p, t), f = faceAt(A, t);
    assert.ok(f.x - f.w / 2 >= win.x - 1 && f.x + f.w / 2 <= win.x + win.w + 1, `A out of the window at ${t.toFixed(2)} s: face ${Math.round(f.x - f.w / 2)}–${Math.round(f.x + f.w / 2)}, window ${Math.round(win.x)}–${Math.round(win.x + win.w)}`);
  }
});

test("a close-up that sways is held calmly: no move back within a second", () => {
  // the reviewer's guest: a face 90 % of the window's width, swaying ±60 px at 0.7 Hz with a nod
  const w = (1080 * 9) / 16;
  const P = tracked("guest", "A", (t) => ({ x: 960 + 60 * Math.sin(2 * Math.PI * 0.7 * t), y: 420 + 20 * Math.sin(2 * Math.PI * 1.3 * t), w: 0.9 * w, h: 600 }), 0, 12);
  const shots = [{ start: 0, end: 12, kind: "people", people: [P], faces: [{ speaker: "A", ...faceAt(P, 6) }] }];
  const [win] = windowsOf(shots, [{ t: 0, speaker: "A" }], { ...HD, aspect: [9, 16] });
  const xs = [];
  for (let t = 0; t < 12; t += 1 / FPS) xs.push([t, windowAt(win, t).x]);
  let lastDir = 0, lastTurn = -Infinity, turns = 0, fastest = 0;
  for (let k = 1; k < xs.length; k++) {
    const v = (xs[k][1] - xs[k - 1][1]) * FPS;
    fastest = Math.max(fastest, Math.abs(v));
    const dir = Math.abs(v) < 1 ? 0 : Math.sign(v);
    if (dir && lastDir && dir !== lastDir) { assert.ok(xs[k][0] - lastTurn >= 1, `turned back at ${xs[k][0].toFixed(2)} s`); lastTurn = xs[k][0]; turns++; }
    if (dir) lastDir = dir;
  }
  assert.ok(turns <= 6, `${turns} turns in 12 s`);
  assert.ok(fastest < 0.8 * w, `${Math.round(fastest)} px/s`);
  // the face's middle (its eyes, nose and mouth) never leaves the window
  for (const [t, x] of xs) { const f = faceAt(P, t); assert.ok(f.x - 0.35 * f.w >= x - 1 && f.x + 0.35 * f.w <= x + w + 1, `face cut at ${t.toFixed(2)} s`); }
});

test("the tracker does not trust a still that is far off its neighbours, keeps two crossing faces apart, and a face that leaves is absent, not cut", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    const clip = (name, graph) => {
      const file = path.join(dir, name);
      const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=0x202020:s=1280x720:r=${FPS}:d=8`, "-f", "lavfi", "-i", `testsrc2=s=120x140:r=${FPS}:d=8`,
        "-f", "lavfi", "-i", `mandelbrot=s=120x140:r=${FPS}`, "-filter_complex", graph, "-map", "[v]", "-t", "8", "-c:v", "libx264", "-preset", "ultrafast", file], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      return greyFrames(file);
    };
    const box = (x) => ({ x: x + 60, y: 270, w: 120, h: 140 });
    // a slip: the middle still put 500 px off
    const walk = clip("walk.mp4", "[0:v][1:v]overlay=x='100+100*t':y=200,format=yuv420p[v]");
    const slip = fillTrack(walk, [{ t: 0.5, ...box(150) }, { t: 4, ...box(500 + 500) }, { t: 7.5, ...box(850) }], 0, 8);
    assert.deepEqual(slip.doubtful.map((d) => d.t), [4]);
    near(faceAt({ track: slip }, 4).x, 560, 30);
    // two faces crossing, the second in front: the one behind keeps its straight path
    const cross = clip("cross.mp4", "[0:v][1:v]overlay=x='1000-120*t':y=200[a];[a][2:v]overlay=x='100+120*t':y=200,format=yuv420p[v]");
    const back = { who: "back", speaker: "A", track: fillTrack(cross, [{ t: 0.5, ...box(940) }, { t: 7.5, ...box(100) }], 0, 8) };
    const front = { who: "front", speaker: "B", track: fillTrack(cross, [{ t: 0.5, ...box(160) }, { t: 7.5, ...box(1000) }], 0, 8) };
    uncross([back, front]);
    for (let t = 3; t <= 5; t += 0.1) near(faceAt(back, t).x, 1060 - 120 * t, 40);
    // leaving: out to the right after 3 s, back from 6 s; the still at 4.5 s has no face
    const leave = clip("leave.mp4", "[0:v][1:v]overlay=x='if(lt(t,3),800+150*t,if(lt(t,6),1400,1400-150*(t-6)))':y=200,format=yuv420p[v]");
    const away = { who: "A", speaker: "A", track: fillTrack(leave, [{ t: 1, ...box(950) }, { t: 4.5, absent: true }, { t: 7.5, ...box(1175) }], 0, 8) };
    assert.equal(faceAt(away, 4.5), null);
    assert.equal(faceAt(away, 3.8), null);
    assert.ok(faceAt(away, 2));
    const shots = [{ start: 0, end: 8, kind: "people", people: [away], faces: [{ speaker: "A", who: "A", ...box(950) }] }];
    const windows = windowsOf(shots, [{ t: 0, speaker: "A" }], { width: 1280, height: 720, fps: FPS, aspect: [9, 16] });
    assert.deepEqual(edgesOf(windows, shots, { fps: FPS }).filter((e) => e.t > 3.2 && e.t < 5.8), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a slide talk (the speaker a small inset beside the slides) stays whole; unsure, it stays whole and the list says how to cut it", () => {
  // the reviewer's b6: one voice, its face 5 % of the height at the left, the slides filling the frame
  const slide = (material) => ({ version: 2, shots: [{ ...shotAnswer(0, 40, "split", [{ who: "speaker", speaker: "A" }],
    [5, 20, 35].map((t) => ({ t, faces: [{ person: 0, box_2d: [544, 93, 597, 126] }] }))), material }] });
  for (const material of [true, undefined]) {
    const [shot] = shotsOf(slide(material), [{ start: 0, end: 40 }], META);
    assert.equal(shot.kind, "split");
    assert.match(shot.note, material ? /material .* shown whole/ : /shown whole.*--follow/);
    const [w] = windowsOf([shot], [{ t: 0, speaker: "A" }], { ...META, aspect: [9, 16] });
    assert.ok(w.fit, "shown whole");
  }
});
