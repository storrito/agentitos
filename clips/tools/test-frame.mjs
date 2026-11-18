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
  const ans = { version: 2, shots: [shotAnswer(0, 5, "split", [{ who: "host", speaker: "C" }, { who: "guest", speaker: null }],
    [{ t: 2.5, faces: [{ person: 0, box_2d: [360, 140, 440, 185] }, { person: 1, box_2d: [360, 830, 430, 866] }] }])] };
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
