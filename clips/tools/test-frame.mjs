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
import { shotsOf, windowsOf, windowAt, edgesOf, faceAt, stillsOf, render, speakerTimeline, sheet, holdOf, extraStills, EXTRA, answerOf, facesOver, probe } from "./frame.mjs";
import { greyFrames, fillTrack, uncross } from "./lib/track.mjs";

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
// how frames keep their own times in what the tests make: -fps_mode from ffmpeg 5.1 on, -vsync
// before it (ffmpeg 9 takes -vsync no longer, 4.4 not yet -fps_mode), as lib/cuts.mjs asks
const SYNC = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=s=16x16:d=0.1", "-fps_mode", "passthrough", "-f", "null", "-"]).status === 0 ? "-fps_mode" : "-vsync";
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
    // a white box crossing a black 640×360 picture in 4 s, the picture starting 0.04 s after the
    // sound; from the last still on (3.9 s of the clip) the box rests, as the window does: ffmpeg 9
    // keeps the source's last frames, where an older one doubled the first frame and dropped the
    // last, in which a box still moving had run on to the window's edge unseen
    const video = path.join(dir, "box.mp4");
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=black:s=640x360:r=${FPS}:d=4`, "-f", "lavfi", "-i", `color=c=white:s=40x40:r=${FPS}:d=4`, "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
      "-filter_complex", "[0:v][1:v]overlay=x='40+min(t,3.86)*130':y=150,setpts=PTS+0.04/TB,format=yuv420p[v]", "-map", "[v]", "-map", "2:a", "-t", "4.04", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", video], { encoding: "utf8" });
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
    const g = spawnSync("ffmpeg", ["-v", "error", "-i", out, SYNC, "passthrough", "-vf", "format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 });
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
      "-filter_complex", "[0:v]settb=1/30[a];[1:v]settb=1/30[b];[a][b]concat=n=2:v=1,format=yuv420p[v]", "-map", "[v]", SYNC, "vfr", "-c:v", "libx264", "-preset", "ultrafast", video], { encoding: "utf8" });
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
  const A = tracked("A", "A", (t) => ({ x: 200 + 500 * t, y: 400, w: 300, h: 330 }), 0, 3);
  const shots = [{ start: 0, end: 3, kind: "people", people: [A], faces: [{ speaker: "A", ...faceAt(A, 1.5) }] }];
  const timeline = [{ t: 0, speaker: "A" }, { t: 1, speaker: "B" }, { t: 2, speaker: "A" }];
  const windows = windowsOf(shots, timeline, { ...HD, aspect: [9, 16] });
  for (let t = 0; t < 3; t += 1 / FPS) {
    const p = windows.find((w) => w.start <= t && w.end > t), win = windowAt(p, t), f = faceAt(A, t);
    assert.ok(f.x - f.w / 2 >= win.x - 1 && f.x + f.w / 2 <= win.x + win.w + 1, `A out of the window at ${t.toFixed(2)} s: face ${Math.round(f.x - f.w / 2)}–${Math.round(f.x + f.w / 2)}, window ${Math.round(win.x)}–${Math.round(win.x + win.w)}`);
  }
});

test("a close-up that sways is held calmly: no move back within a second", () => {
  // the reviewer's guest: a face 90 % of the window's width, swaying ±45 px at 0.7 Hz with a nod
  // (its middle 80 % fits the window wherever it sways: the window stays)
  const w = (1080 * 9) / 16;
  const P = tracked("guest", "A", (t) => ({ x: 960 + 45 * Math.sin(2 * Math.PI * 0.7 * t), y: 420 + 20 * Math.sin(2 * Math.PI * 1.3 * t), w: 0.9 * w, h: 600 }), 0, 12);
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
  for (const [t, x] of xs) { const f = faceAt(P, t); assert.ok(f.x - 0.4 * f.w >= x - 1 && f.x + 0.4 * f.w <= x + w + 1, `face cut at ${t.toFixed(2)} s`); }
});

// a close-up of a face in a three-quarter view looking left (as seen): its box from the nose's
// tip to the ear behind, the eyes, nose and mouth in its left half
const threeQuarter = (t, x, looks = "left", side = -1) => ({ t, faces: [{ person: 0, box_2d: [100, x, 800, x + 300],
  features_2d: side < 0 ? [300, x, 600, x + 150] : [300, x + 150, 600, x + 300], looks }] });

test("a close-up in a three-quarter view keeps eyes, nose and mouth in, with more room on the side it looks to; the back of the head may go", () => {
  const ans = { version: 3, shots: [shotAnswer(0, 6, "people", [{ who: "guest", speaker: "A" }], [0.1, 3, 5.9].map((t) => threeQuarter(t, 350)))] };
  const shots = shotsOf(ans, [{ start: 0, end: 6 }], META);
  const [w] = windowsOf(shots, [{ t: 0, speaker: "A" }], { ...META, aspect: [9, 16] });
  for (const t of [0.1, 3, 5.9]) {
    const f = faceAt(shots[0].people[0], t), win = windowAt(w, t);
    assert.ok(f.w > 0.9 * w.w, "a close-up as wide as the window");
    const front = f.feat.x0 - win.x, back = win.x + w.w - f.feat.x1;
    assert.ok(front >= 0.2 * f.w && back >= 0.04 * f.w, `room in front ${Math.round(front)}, behind ${Math.round(back)}`);
    assert.ok(front > back, "more room on the side the face looks to");
    assert.ok(f.x + f.w / 2 > win.x + w.w, "the back of the head is cut");
    const head = (Math.min(f.x + f.w / 2, win.x + w.w) - Math.max(f.x - f.w / 2, win.x)) / f.w;
    assert.ok(head >= 0.75 - 1e-3, `only ${Math.round(head * 100)} % of the head in the picture`);
  }
  // the check: no fault, the side of the face listed as such
  const edges = edgesOf([w], shots, META);
  assert.deepEqual(edges.filter((e) => e.part !== "side"), []);
  assert.ok(edges.some((e) => e.part === "side" && e.edge === "right"), JSON.stringify(edges));
  // an answer without the features centres the face's box: the nose close to the edge
  const old = { version: 2, shots: [shotAnswer(0, 6, "people", [{ who: "guest", speaker: "A" }], [0.1, 3, 5.9].map((t) => ({ t, faces: [{ person: 0, box_2d: [100, 350, 800, 650] }] })))] };
  const oshots = shotsOf(old, [{ start: 0, end: 6 }], META);
  const [ow] = windowsOf(oshots, [{ t: 0, speaker: "A" }], { ...META, aspect: [9, 16] });
  const nose = (0.35 * META.width - windowAt(ow, 3).x) / ow.w;
  assert.ok(nose < 0.05, `the box centred leaves ${nose.toFixed(3)} of the window in front of the nose`);
});

test("a head that turns between two stills: its features go from the one side to the other, and the window keeps them in all the way", () => {
  // the head stays where it is; at 0.1 s it looks left, at 3.1 s right
  const ans = { version: 3, shots: [shotAnswer(0, 4, "people", [{ who: "guest", speaker: "A" }], [threeQuarter(0.1, 350, "left", -1), threeQuarter(3.1, 350, "right", 1)])] };
  const shots = shotsOf(ans, [{ start: 0, end: 4 }], META);
  const P = shots[0].people[0];
  const mid = faceAt(P, 1.6);
  near((mid.feat.x0 + mid.feat.x1) / 2, mid.x, 2);
  assert.ok(faceAt(P, 0.5).feat.x0 < faceAt(P, 1.6).feat.x0 && faceAt(P, 1.6).feat.x0 < faceAt(P, 2.7).feat.x0);
  const [w] = windowsOf(shots, [{ t: 0, speaker: "A" }], { ...META, aspect: [9, 16] });
  assert.equal(w.hold, "follows");
  for (let t = 0; t < 4; t += 1 / FPS) {
    const f = faceAt(P, t), win = windowAt(w, t);
    assert.ok(f.feat.x0 >= win.x && f.feat.x1 <= win.x + w.w, `the features out of the window at ${t.toFixed(2)} s`);
  }
  const at0 = windowAt(w, 0.1), at4 = windowAt(w, 3.9), f0 = faceAt(P, 0.1), f4 = faceAt(P, 3.9);
  assert.ok(f0.feat.x0 - at0.x > at0.x + w.w - f0.feat.x1, "looking left: the room on the left");
  assert.ok(at4.x + w.w - f4.feat.x1 > f4.feat.x0 - at4.x, "looking right: the room on the right");
  assert.deepEqual(edgesOf([w], shots, META).filter((e) => e.part === "features"), []);
});

test("a three-quarter close-up that sways does not make the window turn back within a second, and its features stay in", () => {
  // the reviewer's guest in "deaths": a face 90 % of the window's width looking left, swaying
  // ±100 px at 0.6 Hz, its features in the left half of its box
  const w = (1080 * 9) / 16;
  const P = tracked("guest", "A", (t) => ({ x: 960 + 100 * Math.sin(2 * Math.PI * 0.6 * t), y: 420, w: 0.9 * w, h: 600, parts: { l: -0.48, r: 0.05, t: -0.2, b: 0.3, lean: -1 } }), 0, 15);
  const shots = [{ start: 0, end: 15, kind: "people", people: [P], faces: [{ speaker: "A", ...faceAt(P, 7) }] }];
  const [win] = windowsOf(shots, [{ t: 0, speaker: "A" }], { ...HD, aspect: [9, 16] });
  let lastDir = 0, lastTurn = -Infinity, turns = 0;
  for (let t = 1 / FPS; t < 15; t += 1 / FPS) {
    const x = windowAt(win, t).x, v = (x - windowAt(win, t - 1 / FPS).x) * FPS, dir = Math.abs(v) < 2 ? 0 : Math.sign(v);
    const f = faceAt(P, t), [a, b] = holdOf(f, win.w, 0);
    const leaving = a < x + 1 || b > x + win.w - 1;
    if (dir && lastDir && dir !== lastDir) { assert.ok(t - lastTurn >= 1 || leaving, `turned back at ${t.toFixed(2)} s`); lastTurn = t; turns++; }
    if (dir) lastDir = dir;
    assert.ok(f.feat.x0 >= x - 1 && f.feat.x1 <= x + win.w + 1, `the features cut at ${t.toFixed(2)} s`);
  }
  assert.ok(turns / 15 <= 0.5, `${turns} turns in 15 s`);
  assert.ok(win.closeup && win.closeup.features && win.closeup.inside === 1, JSON.stringify(win.closeup));
  near(win.closeup.turns, turns / 15, 0.15);
});

test("the check tells eyes, nose or mouth at the edge (a fault) from only an ear or a cheek there", () => {
  const ans = { version: 3, shots: [shotAnswer(0, 4, "people", [{ who: "guest", speaker: "A" }], [threeQuarter(2, 350)])] };
  const shots = shotsOf(ans, [{ start: 0, end: 4 }], META);
  const f = faceAt(shots[0].people[0], 2);
  const at = (x) => edgesOf([{ start: 0, end: 4, shot: 0, kind: "people", w: 1216, h: 2160, keys: [{ t: 0, x, y: 0 }] }], shots, META).filter((e) => e.t === 2);
  // the window's right edge through the ear: listed as the side only
  assert.deepEqual(at(f.feat.x0 - 300).map((e) => [e.part, e.edge, e.cut]), [["side", "right", true]]);
  // its left edge through the nose: a fault
  assert.deepEqual(at(f.feat.x0 + 40).map((e) => [e.part, e.edge, e.cut]), [["features", "left", true]]);
  // a small face (not a close-up) cut at its side is a fault, features or not
  const small = { version: 3, shots: [shotAnswer(0, 4, "people", [{ who: "guest", speaker: "A" }], [{ t: 2, faces: [{ person: 0, box_2d: [300, 500, 450, 580], features_2d: [340, 500, 420, 540], looks: "left" }] }])] };
  const sshots = shotsOf(small, [{ start: 0, end: 4 }], META);
  const e = edgesOf([{ start: 0, end: 4, shot: 0, kind: "people", w: 1216, h: 2160, keys: [{ t: 0, x: 0.58 * 3840 - 30 - 1216, y: 0 }] }], sshots, META);
  assert.ok(e.some((x) => x.cut && x.edge === "right" && x.part !== "side"), JSON.stringify(e));
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

test("the sheet is there when it says so, also when the framed video ends a few frames before its sound", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    const clip = path.join(dir, "clip.mp4"), framed = path.join(dir, "framed.mp4"), file = path.join(dir, "framed.sheet.jpg");
    let r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc2=s=640x360:r=${FPS}:d=2.2`, "-c:v", "libx264", "-preset", "ultrafast", clip], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    // the reviewer's case: the picture 2.0 s, the sound 2.2 s, so its duration says 2.2
    r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc2=s=360x640:r=${FPS}:d=2.0`, "-f", "lavfi", "-i", "sine=d=2.2", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", framed], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const windows = [{ start: 0, end: 2.2, shot: 0, kind: "people", w: 202, h: 360, keys: [{ t: 0, x: 100, y: 0 }] }];
    const files = sheet(clip, framed, windows, [{ start: 0, end: 2.2 }], [], file, { fps: FPS });
    assert.deepEqual([...files], [file]);
    assert.ok(fs.statSync(file).size > 1000);
    assert.deepEqual(files.missing, []);
    // a framed video with no picture at all: nothing is claimed, and what is missing is named
    const empty = path.join(dir, "empty.mp4");
    r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=d=2.2", "-c:a", "aac", empty], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const none = sheet(clip, empty, windows, [{ start: 0, end: 2.2 }], [], path.join(dir, "none.jpg"), { fps: FPS });
    assert.ok(none.missing.length >= 3, JSON.stringify(none.missing));
    for (const f of none) assert.ok(fs.existsSync(f));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a shot's stills are an odd number: the first, the middle and the last frame among them", () => {
  for (const length of [2, 5, 7.5, 12, 30]) {
    const stills = stillsOf([{ start: 0, end: length }], FPS);
    assert.equal(stills.length % 2, 1, `${length} s: ${stills.length} stills`);
    near(stills[(stills.length - 1) / 2].t, length / 2, 0.01);
  }
});

// a close-up looking at the camera with its eyes, nose and mouth asked for one by one (version 4)
const frontal = (t, { mouth = [640, 440, 700, 560], eyes = [380, 400, 460, 600], nose = [420, 460, 600, 540], x = 0 } = {}) => {
  const mv = (b) => b && [b[0], b[1] + x, b[2], b[3] + x];
  return { t, faces: [{ person: 0, box_2d: mv([200, 330, 900, 670]), eyes_2d: mv(eyes), nose_2d: mv(nose), mouth_2d: mv(mouth), looks: "camera" }] };
};

test("eyes, nose and mouth that do not hold (the mouth left out, above the nose, or one box ending at the nose) are left out and listed; the stills beside them hold", () => {
  const ans = { version: 4, shots: [shotAnswer(0, 9, "people", [{ who: "guest", speaker: "A" }], [
    frontal(0.1), frontal(3, { mouth: null }), frontal(4.5, { mouth: [400, 440, 450, 560] }), frontal(6), frontal(8.9)])] };
  const [s] = shotsOf(ans, [{ start: 0, end: 9 }], META);
  assert.deepEqual(s.doubtful.map((d) => [d.t, /mouth/.test(d.features), !!d.guess]), [[3, true, false], [4.5, true, false]]);
  // between the stills that hold, the mouth's bottom stays where they have it (700 of 1000)
  const f = faceAt(s.people[0], 3);
  near(f.feat.y1, 0.7 * META.height, 2);
  // one box for all three (version 3) that ends at the nose: only 31 % of the head
  const v3 = { version: 3, shots: [shotAnswer(0, 4, "people", [{ who: "guest", speaker: "A" }], [0.1, 2, 3.9].map((t) => ({ t, faces: [{ person: 0, box_2d: [51, 513, 467, 706], features_2d: [202, 510, 329, 649], looks: "left" }] })))] };
  const [g] = shotsOf(v3, [{ start: 0, end: 4 }], META);
  assert.equal(g.doubtful.length, 3);
  assert.ok(g.doubtful.every((d) => d.guess && /mouth left out/.test(d.features)), JSON.stringify(g.doubtful));
  // no still holds: the head's proportions, the mouth line low in the box (never above the real one)
  const h = faceAt(g.people[0], 2), top = h.y - h.h / 2;
  assert.ok((h.feat.y1 - top) / h.h >= 0.85, `the mouth's bottom at ${((h.feat.y1 - top) / h.h).toFixed(2)} of the head`);
});

test("the eyes' own height: the middle of the model's eyes box (with the brows) rides with the face as eye, between the stills too, and the faces alone carry it; one box for all three (version 3) has none", () => {
  const ans = { version: 4, shots: [shotAnswer(0, 4, "people", [{ who: "guest", speaker: "A" }], [frontal(0.1), frontal(3.9, { eyes: [400, 400, 480, 600] })])] };
  const [s] = shotsOf(ans, [{ start: 0, end: 4 }], META);
  // the eyes box 380–460 of 1000 at the first still, 400–480 at the last: its middle at 42 % and 44 % of the height
  near(faceAt(s.people[0], 0.1).feat.eye, 0.42 * META.height, 2);
  near(faceAt(s.people[0], 2).feat.eye, 0.43 * META.height, 3);
  const r = facesOver([s], META);
  near(r.faces.find((f) => Math.abs(f.t - 2) < 1e-6).boxes[0].eye, 0.43 * META.height, 3);
  const v3 = { version: 3, shots: [shotAnswer(0, 4, "people", [{ who: "guest", speaker: "A" }], [0.1, 3.9].map((t) => ({ t, faces: [{ person: 0, box_2d: [200, 330, 900, 670], features_2d: [380, 400, 700, 600], looks: "camera" }] })))] };
  const [g] = shotsOf(v3, [{ start: 0, end: 4 }], META);
  assert.equal(faceAt(g.people[0], 2).feat.eye, undefined);
});

test("a features box that jumps against its neighbours (the ear taken for the eyes) is left out and listed, and the window does not swing for it", () => {
  const stills = [0.1, 3, 6, 9, 11.9].map((t) => frontal(t));
  const ok = { version: 4, shots: [shotAnswer(0, 12, "people", [{ who: "guest", speaker: "A" }], stills)] };
  const bad = JSON.parse(JSON.stringify(ok));
  // the still at 6 s: the eyes, nose and mouth moved to the face's right edge
  for (const k of ["eyes_2d", "nose_2d", "mouth_2d"]) { const b = bad.shots[0].stills[2].faces[0][k]; const w = b[3] - b[1]; b[3] = 670; b[1] = 670 - w; }
  const run = (a) => { const shots = shotsOf(a, [{ start: 0, end: 12 }], META); return { shots, w: windowsOf(shots, [{ t: 0, speaker: "A" }], { ...META, aspect: [9, 16] })[0] }; };
  const A = run(ok), B = run(bad);
  assert.equal(A.shots[0].doubtful, undefined);
  assert.deepEqual(B.shots[0].doubtful.map((d) => [d.t, /jump/.test(d.features)]), [[6, true]]);
  for (let t = 0; t < 12; t += 0.5) near(windowAt(B.w, t).x, windowAt(A.w, t).x, 2);
  // a head that turns (the model says it looks elsewhere) is no jump
  const turn = JSON.parse(JSON.stringify(bad));
  turn.shots[0].stills[2].faces[0].looks = "right";
  assert.equal(run(turn).shots[0].doubtful, undefined);
});

test("a close-up whose head moves or tips between two stills gets a still more there, at the moment furthest off the line (three a shot at most); a calm one gets none", () => {
  // a close-up 700 px wide of 3840×2160 (the 9:16 window is 1215 px wide), stills every 3 s
  const track = (dip) => Array.from({ length: 121 }, (_, i) => {
    const t = i / 10, seen = Math.abs(t % 3) < 1e-6;
    return { t, x: 1900, y: 1000 + dip(t), w: 700, h: 1100, ...(seen ? { seen: true } : {}) };
  });
  const shot = (dip) => [{ kind: "people", people: [{ who: "guest", speaker: "A", track: track(dip) }] }];
  // the head goes down 200 px in the middle of 3–6 s and comes back
  const tips = extraStills(shot((t) => (t > 3 && t < 6 ? 200 * Math.sin(((t - 3) / 3) * Math.PI) : 0)), META);
  assert.deepEqual(tips.map((x) => [x.t, x.shot]), [[4.5, 0]]);
  assert.ok(tips[0].off > 0.15, JSON.stringify(tips));
  // a calm head: none
  assert.deepEqual(extraStills(shot((t) => 10 * Math.sin(t)), META), []);
  // a head that sways all the time: at most EXTRA
  assert.equal(extraStills(shot((t) => 250 * Math.sin((t % 3) / 3 * Math.PI)), META).length, EXTRA);
  // a small face (not a close-up) moving the same way: none
  const small = shot((t) => (t > 3 && t < 6 ? 200 : 0)); small[0].people[0].track.forEach((x) => { x.w = 300; });
  assert.deepEqual(extraStills(small, META), []);
});

test("the features between two stills are an estimate: faceAt names the two stills where t is further than FEAT_EST from both, none at a still or near one", () => {
  const parts = { l: -0.3, r: 0.3, t: -0.1, b: 0.35, lean: 0 };
  const track = [0, 0.5, 1, 1.5, 2, 2.5, 3].map((t) => ({ t, x: 500, y: 400, w: 300, h: 400, ...(t === 0 || t === 2.5 ? { parts } : {}) }));
  const p = { who: "A", speaker: "A", track };
  assert.equal(faceAt(p, 0.1).feat.between, undefined);
  assert.deepEqual(faceAt(p, 1.2).feat.between, [0, 2.5]);
  assert.equal(faceAt(p, 2.4).feat.between, undefined);
  // after the last still, as there: an estimate from it alone once it is far
  assert.deepEqual(faceAt(p, 3).feat.between, [2.5, 2.5]);
});

test("the faces alone, from the agent's own boxes: each box a still of its shot, no request, the face between two of them on the line, none in a shot without a box", () => {
  const meta = { width: 1080, height: 1920 };
  const shots = [{ start: 0, end: 10 }, { start: 10, end: 14 }];
  const answer = answerOf([[{ t: 1, box: [300, 570, 600, 900] }, { t: 9, box: [340, 610, 600, 900] }]], shots, meta);
  assert.equal(answer.by, "eye");
  assert.equal(answer.cost, 0);
  assert.deepEqual(answer.shots[0].stills.map((s) => s.t), [1, 9]);
  assert.deepEqual(answer.shots[1].stills, []);
  // thousandths, [ymin, xmin, ymax, xmax], as the model answers
  assert.deepEqual(answer.shots[0].stills[0].faces[0].box_2d, [296.9, 277.8, 765.6, 833.3]);
  const seen = shotsOf(answer, shots, meta);
  const r = facesOver(seen, meta);
  assert.deepEqual(r.size, [1080, 1920]);
  const at = (t) => r.faces.find((f) => Math.abs(f.t - t) < 1e-6)?.boxes[0];
  near(at(1).box[0], 300, 1); near(at(1).box[1], 570, 1); near(at(1).box[3], 900, 1);
  // halfway between the two boxes
  near(at(5).box[0], 320, 1); near(at(5).box[1], 590, 1);
  // no eyes, nose and mouth from the agent: the head's proportions stand in where a box is used
  assert.equal(at(5).feat, undefined);
  // the second shot has no box of the agent: no face there
  assert.equal(r.faces.some((f) => f.t >= 10), false);
});

test("where a face looks: the faces alone carry the model's looks, between two stills that disagree as at the nearer one; none for the agent's own boxes; the framing's shots and windows as without it", () => {
  const turn = (t, looks) => ({ ...frontal(t), faces: [{ ...frontal(t).faces[0], looks }] });
  const ans = { version: 4, shots: [shotAnswer(0, 4, "people", [{ who: "guest", speaker: "A" }], [turn(0.1, "camera"), turn(2, "camera"), turn(3.9, "left")])] };
  const [s] = shotsOf(ans, [{ start: 0, end: 4 }], META);
  const r = facesOver([s], META);
  const at = (t) => r.faces.find((f) => Math.abs(f.t - t) < 1e-6).boxes[0].looks;
  assert.deepEqual([0, 1, 2, 2.9, 3, 3.5, 3.9].map(at), ["camera", "camera", "camera", "camera", "left", "left", "left"]);
  // the track and what the framing writes of it know nothing of it
  assert.ok(s.people[0].track.every((x) => x.looks === undefined));
  assert.equal(JSON.stringify(shotsOf(ans, [{ start: 0, end: 4 }], META)).includes("looks"), false);
  // an answer without looks (version 2): none
  const old = { version: 2, shots: [shotAnswer(0, 4, "people", [{ who: "guest", speaker: "A" }], [0.1, 3.9].map((t) => ({ t, faces: [{ person: 0, box_2d: [200, 330, 900, 670] }] })))] };
  assert.ok(facesOver(shotsOf(old, [{ start: 0, end: 4 }], META), META).faces.every((f) => f.boxes.every((b) => b.looks === undefined)));
  // the agent's boxes (their stand-in answer says "camera" for each): none
  const meta = { width: 1080, height: 1920 }, shots = [{ start: 0, end: 4 }];
  const eye = facesOver(shotsOf(answerOf([[{ t: 1, box: [300, 570, 600, 900] }, { t: 3, box: [320, 570, 600, 900] }]], shots, meta), shots, meta), meta);
  assert.ok(eye.faces.length && eye.faces.every((f) => f.boxes.every((b) => b.looks === undefined)));
});

test("the faces of a shot the model calls b-roll: left out, unless every shot is asked for (narrated-short's footage of a crew at work)", () => {
  const meta = { width: 1080, height: 1920 };
  const shots = [{ start: 0, end: 4 }];
  const seen = shotsOf(answerOf([[{ t: 1, box: [300, 570, 600, 900] }, { t: 3, box: [320, 570, 600, 900] }]], shots, meta), shots, meta).map((s) => ({ ...s, kind: "broll" }));
  assert.equal(facesOver(seen, meta).faces.length, 0);
  const all = facesOver(seen, meta, { every: true });
  assert.ok(all.faces.length >= 30);
  assert.equal(all.shots[0].kind, "broll");
});

test("a phone's upright take stored on its side (rotation 90, −90) or upside down (180): the size as shown everywhere a frame is read and a box is scaled: the probe, the tracker's frames, the faces written", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  const up = path.join(dir, "up.mp4"), side = path.join(dir, "side.mp4");
  let r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=180x320:r=10,format=yuv420p", "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", up], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  // stored as 320×180, the picture turned a quarter, as a phone writes it
  r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", up, "-vf", "transpose=2", "-c:v", "libx264", "-preset", "ultrafast", side], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const words = path.join(dir, "words.json");
  fs.writeFileSync(words, JSON.stringify([{ text: "hallo", start: 0.2, end: 0.6, speaker: "A" }]));
  for (const [deg, shown] of [[90, [180, 320]], [270, [180, 320]], [180, [320, 180]]]) {
    const v = path.join(dir, `rot${deg}.mp4`);
    // ffmpeg 6 and later write a rotation only as the input's display matrix (counter-clockwise),
    // and ignore the rotate tag that ffmpeg 4 and 5 turn into one (clockwise)
    r = spawnSync("ffmpeg", ["-v", "error", "-y", "-display_rotation:v:0", String(-deg), "-i", side, "-c", "copy", v], { encoding: "utf8" });
    if (r.status !== 0) r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", side, "-c", "copy", "-metadata:s:v:0", `rotate=${deg}`, v], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const p = probe(v);
    assert.deepEqual([p.width, p.height], shown, `rotation ${deg}: the probe`);
    const g = greyFrames(v);
    assert.ok(Math.abs(g.h / g.w - shown[1] / shown[0]) < 0.02, `rotation ${deg}: the tracker's frames ${g.w}×${g.h}`);
    // the faces alone from the agent's boxes: in px of the picture as shown, a box inside it accepted
    const out = path.join(dir, `rot${deg}.faces.json`);
    r = spawnSync(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), "frame.mjs"), v, words, "--faces", out, "--face-at", `0.5:${Math.round(shown[0] * 0.3)},${Math.round(shown[1] * 0.2)},${Math.round(shown[0] * 0.4)},${Math.round(shown[1] * 0.25)}`], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(out, "utf8")).size, shown, `rotation ${deg}: faces.json's size`);
  }
});

test("the model's nonsense is no face: a box whose end comes before its start (the review's [950, 980, 20, 10], taken as the whole picture before) is left out; an answer read again from its file costs nothing now and says so", { skip: !ffmpeg && "no ffmpeg" }, async () => {
  const meta = { width: 1280, height: 720 };
  const shots = [{ start: 0, end: 2 }];
  const answer = { version: 4, shots: [{ start: 0, end: 2, kind: "people", people: [{ who: "A", speaker: "A" }], stills: [{ t: 1, faces: [{ person: 0, box_2d: [950, 980, 20, 10], eyes_2d: [0, 0, 1000, 1000], nose_2d: null, mouth_2d: null, looks: "camera" }] }] }], missed: [] };
  assert.equal(shotsOf(answer, shots, meta)[0].people.length, 0);
  // the answer of before, beside the video: read again, nothing spent
  const dir = tmp(), v = path.join(dir, "take.mp4");
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=10,format=yuv420p", "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", v], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const good = { ...answer, cost: 0.0432, extra: { stills: 0, cost: 0 }, shots: [{ ...answer.shots[0], stills: [{ t: 1, faces: [{ person: 0, box_2d: [200, 400, 700, 600], eyes_2d: null, nose_2d: null, mouth_2d: null, looks: "camera" }] }] }] };
  fs.writeFileSync(path.join(dir, "take.people.json"), JSON.stringify(good));
  const { faces } = await import("./frame.mjs");
  const out = await faces(v, [{ text: "a", start: 0.1, end: 0.4, speaker: "A" }]);
  assert.equal(out.cost, 0);
  assert.equal(out.cached, true);
  assert.ok(out.faces.length > 0);
});
