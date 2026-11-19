// Where the text goes over the framed clip (clips' place): a shot raised for the captions, the
// faces in the frame through windows, lifts and shots shown whole, the clocks of the cut and of the
// framed clip, and the place step on a made-up clip, with agentitos' layout as a program. No model.
//
//   node --test tools/test-place.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { shotsOf, windowsOf, raise, roomBelow, render } from "./frame.mjs";
import { framedShots, inFrame, unlift, fitRect } from "./lib/faces.mjs";
import { spanOf, toFramed, toOutput, hookSpan, shotsInput, facesFile, calmBehind } from "./lib/place.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const near = (x, y, by, what = "") => assert.ok(Math.abs(x - y) <= by, `${what} ${x} is not within ${by} of ${y}`);
const META = { width: 3840, height: 2160, fps: 25 };
const answer = (start, end, kind, box) => ({ start, end, kind, subject: [0, 0, 1000, 1000], people: [{ who: "guest", speaker: "A" }],
  stills: [start + 0.1, (start + end) / 2, end - 0.1].map((t) => ({ t, faces: [{ person: 0, box_2d: box }] })) });
// a close-up: the face from 5 % to 72 % of the footage's height; a wide one higher up
const CLOSE = [50, 380, 720, 620], HIGH = [150, 450, 350, 550];

function framing(shots, lifts = []) {
  const ans = { version: 2, shots };
  const seen = shotsOf(ans, shots.map((s) => ({ start: s.start, end: s.end })), META);
  const windows = windowsOf(seen, [{ t: 0, speaker: "A" }], { ...META, aspect: [9, 16], lifts });
  return { size: [META.width, META.height], shots: seen.map((s) => ({ start: s.start, end: s.end, kind: s.kind, people: s.people })), windows };
}

test("a shot raised for the captions: its window moves down in the footage as far as it goes, the rest over a ground; the faces in the frame move up by the lift", () => {
  const before = framing([answer(0, 4, "people", CLOSE)]);
  const after = framing([answer(0, 4, "people", CLOSE)], [{ t: 1, px: 200 }]);
  const w = after.windows[0];
  assert.deepEqual(w.lift, { px: 200, free: 0, ground: 200 }, "a close-up's window is the footage's full height: all over a ground");
  const [a] = inFrame(before.windows[0], before.shots[0], 2, { outW: 1080, outH: 1920 }), [b] = inFrame(w, after.shots[0], 2, { outW: 1080, outH: 1920 });
  near(b.box[1], a.box[1] - 200, 0.5, "face top");
  // undone, the pictures stand as before
  assert.deepEqual(unlift(w).keys, before.windows[0].keys);
  // a window with room below it in the footage moves there first
  const fake = { start: 0, end: 4, shot: 0, kind: "people", w: 900, h: 1600, keys: [{ t: 0, x: 100, y: 100 }] };
  near(roomBelow(fake, 2160), (2160 - 1700) * 1080 / 900, 0.01, "room below");
  const r = raise(fake, 300, { height: 2160 });
  assert.equal(r.lift.free + r.lift.ground, 300);
  near(r.keys[0].y, 100 + (r.lift.free * 900) / 1080, 0.1, "window moved down");
  assert.equal(raise({ ...fake, fit: { x: 0, y: 0, w: 3840, h: 2160 } }, 300, { height: 2160 }).lift, undefined, "a shot shown whole is never raised");
});

test("the faces of the framed clip in the frame: a close-up low, a shot shown whole inside its picture, every tenth of a second", () => {
  const fr = framing([answer(0, 3, "people", CLOSE), answer(3, 6, "broll", HIGH)]);
  const shots = framedShots(fr);
  assert.equal(shots.length, 2);
  const chin = Math.max(...shots[0].faces[0].track.map((m) => m.box[1] + m.box[3]));
  near(chin / 1920, 0.72, 0.01, "close-up chin");
  assert.ok(shots[0].faces[0].track.length >= 30, `${shots[0].faces[0].track.length} moments`);
  assert.equal(shots[1].kind, "whole");
  assert.equal(shots[1].room.none, true);
  const pic = fitRect(fr.windows[1].fit, { outW: 1080, outH: 1920 });
  for (const m of shots[1].faces[0].track) assert.ok(m.box[1] >= pic[1] && m.box[1] + m.box[3] <= pic[1] + pic[3]);
  const file = facesFile(shots);
  assert.ok(file.faces.length >= 55 && file.faces.every((x) => x.boxes.length === 1), `${file.faces.length} moments`);
});

test("shots: a framing's shots with their faces in the frame, unraised, as layout's text takes them (for a skill that lays out its own text); a framing raised gives the same faces, a shot shown whole has no room", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clips-shots-"));
  const fr = framing([answer(0, 3, "people", CLOSE), answer(3, 6, "broll", HIGH)], [{ t: 1, px: 150 }]);
  fs.writeFileSync(path.join(dir, "framed.json"), JSON.stringify({ ...fr, aspect: [9, 16] }));
  const r = spawnSync(process.execPath, [path.join(HERE, "clips.mjs"), "shots", path.join(dir, "framed.json"), path.join(dir, "shots.json")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /2 shot\(s\) of 1080×1920, 2 with a face; for layout: place\.mjs text/);
  const out = JSON.parse(fs.readFileSync(path.join(dir, "shots.json"), "utf8"));
  assert.deepEqual(out.size, [1080, 1920]);
  const plain = framedShots(framing([answer(0, 3, "people", CLOSE), answer(3, 6, "broll", HIGH)]));
  assert.deepEqual(out.shots[0].faces[0].track.map((m) => m.box), plain[0].faces[0].track.map((m) => m.box), "the faces as unraised");
  assert.deepEqual(out.shots.map((s) => [s.n, s.kind, s.room]), [[1, "people", { free: 0 }], [2, "whole", null]]);
  const bad = spawnSync(process.execPath, [path.join(HERE, "clips.mjs"), "shots", path.join(dir, "shots.json"), path.join(dir, "x.json")], { encoding: "utf8" });
  assert.ok(bad.status !== 0 && /is not a framing of frame\.mjs/.test(bad.stdout), bad.stdout);
});

test("a hook text needs a calm picture behind it: only close-ups under all of its time are calm, a wide shot or a picture shown whole is not", () => {
  const close = { start: 0, end: 3, kind: "people", faces: [{ track: [{ t: 1, box: [200, 300, 600, 700] }] }] };
  const wide = { start: 3, end: 6, kind: "people", faces: [{ track: [{ t: 4, box: [450, 400, 180, 300] }] }] };
  const whole = { start: 0, end: 3, kind: "whole", faces: [] };
  assert.equal(calmBehind([close, wide], { start: 0, end: 2.5 }), true);
  assert.equal(calmBehind([close, wide], { start: 0, end: 4.5 }), false);
  assert.equal(calmBehind([whole, close], { start: 0, end: 2 }), false);
});

test("the clocks: a time of the cut on the framed clip and back, across a pause cut out; the hook's time on the framed clip", () => {
  const pieces = [{ in: 1, out: 3, start: 0, duration: 2, rate: 1 }, { in: 4, out: 8, start: 2, duration: 4, rate: 1 }];
  assert.equal(toFramed(2.5, pieces), 4.5);
  assert.equal(toOutput(4.5, pieces), 2.5);
  assert.equal(toOutput(3.5, pieces), 2, "in a pause cut out: where the next piece starts");
  const span = { pieces, start: 1, end: 8, built: true, edit: { duration: 6, words: [{ text: "One", end: 0.5 }, { text: "two.", end: 2.6 }] } };
  const h = hookSpan(span);
  assert.equal(h.until, 2.6);
  near(h.end, 4.6, 0.01, "hook's end on the framed clip");
  // a cut that opens with a line heard twice (best-takes' "again" keep, from 20 s of the framed clip), then the moment from 5 s: the hook over both stretches
  const twice = { pieces: [{ in: 20, out: 23, start: 0, duration: 3, rate: 1 }, { in: 5, out: 30, start: 3, duration: 25, rate: 1 }], start: 20, end: 30, built: true, edit: { duration: 28, words: [{ text: "Opening", end: 1 }, { text: "then.", end: 4.5 }] } };
  const hs = hookSpan(twice);
  assert.deepEqual(hs.spans, [[20, 23], [5, 6.5]]);
  const shots2 = [{ start: 0, end: 10, kind: "people", faces: [{ track: [{ t: 6, box: [200, 300, 600, 700] }] }] }, { start: 18, end: 25, kind: "people", faces: [{ track: [{ t: 21, box: [200, 300, 600, 700] }] }] }];
  assert.deepEqual(shotsInput(shots2, twice, hs).input.hook.spans, [[20, 23], [5, 6.5]]);
  const { input, index } = shotsInput([{ start: 0, end: 2, faces: [], room: { free: 0 } }, { start: 3, end: 3.9, faces: [], room: { free: 0 } }, { start: 5, end: 9, faces: [], room: { none: true } }], span);
  assert.deepEqual(index, [0, 2], "a shot the cut does not show is left out");
  assert.equal(input.shots[0].weight, 1);
  assert.equal(input.shots[1].room, null);
});

test("place on a made-up clip: the close-up is raised over a ground, the captions and the hook go into place.json, the faces into faces.json, and the sheet is drawn", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clips-place-test-"));
  if (process.env.KEEP) console.error("KEEP", dir);
  try {
    // a framed clip of two shots: a close-up (0–3 s), a wider shot (3–6 s), drawn as two colours
    const META2 = { width: 640, height: 360, fps: 25 };
    const ans = { version: 2, shots: [answer(0, 3, "people", CLOSE), answer(3, 6, "people", HIGH)] };
    const seen = shotsOf(ans, [{ start: 0, end: 3 }, { start: 3, end: 6 }], META2);
    const windows = windowsOf(seen, [{ t: 0, speaker: "A" }], { ...META2, aspect: [9, 16] });
    const clip = path.join(dir, "clip.mp4");
    assert.equal(spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=25:d=3", "-f", "lavfi", "-i", "smptehdbars=s=640x360:r=25:d=3", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p[v]", "-map", "[v]", "-map", "2:a", "-t", "6", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", clip]).status, 0);
    render(clip, windows, path.join(dir, "framed.mp4"), { outW: 1080, outH: 1920, fps: 25 });
    fs.writeFileSync(path.join(dir, "framed.json"), JSON.stringify({ footage: "clip.mp4", aspect: [9, 16], size: [640, 360], shots: seen.map((s) => ({ start: s.start, end: s.end, kind: s.kind, people: s.people })), windows, edges: [] }));
    fs.writeFileSync(path.join(dir, "clip.words.json"), "[]");
    const td = path.join(dir, "takes", "source");
    fs.mkdirSync(td, { recursive: true });
    fs.writeFileSync(path.join(td, "settings.json"), JSON.stringify({ hook: "A *hook* here", platform: "reels,tiktok,shorts" }));
    fs.writeFileSync(path.join(td, "words.json"), JSON.stringify({ clips: { 1: { file: "01.mp4" } }, words: [{ i: 0, kind: "word", text: "Hello", start: 0.2, end: 0.6 }, { i: 1, kind: "word", text: "there.", start: 5.0, end: 5.8 }] }));
    fs.writeFileSync(path.join(dir, "takes", "cut.json"), JSON.stringify({ keep: [{ words: "0-1" }] }));
    // the framing again would need the model's answer next to the clip: given here
    fs.writeFileSync(path.join(dir, "clip.people.json"), JSON.stringify(ans));
    const place = (...a) => spawnSync(process.execPath, [path.join(HERE, "clips.mjs"), "place", dir, ...a], { encoding: "utf8", env: { ...process.env, OPENROUTER_API_KEY: "" } });
    // moderate, the default: the close-up's head is at the frame's top already, so it is not raised, and its chin carries the captions
    const r0 = place();
    assert.equal(r0.status, 0, r0.stdout + r0.stderr);
    assert.match(r0.stdout, / 1\. 0\.0–3\.0 s {2}as framed(; the head cut at the top \d+ px for [\d.]+ s)?; captions on the chin or neck of guest [\d.]+ s, below the mouth\n/);
    assert.match(r0.stdout, /Raised \(--raise mouth\)/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "takes", "place.json"), "utf8")).raise, "mouth");
    // the close-up's head over the frame's top already: said per shot, with what the raise adds
    assert.match(r0.stdout, / 1\. 0\.0–3\.0 s {2}as framed; the head cut at the top \d+ px for [\d.]+ s; captions/);
    // captions asked higher, over the close-up's mouth: at the default level it goes up past its head's top where the eyes allow, else the lower lip is said, never the mouth
    const rm = place("--caption-y", "1260");
    assert.equal(rm.status, 0, rm.stdout + rm.stderr);
    // (past the head's top only while the eyes stay below 27 % of the height: here they would go above it, so the close-up stays and the lower lip is said)
    assert.match(rm.stdout, / 1\. 0\.0–3\.0 s {2}(raised \d+ px, a blurred band of \d+ px at the bottom .*, past the head's top so that the captions keep off the mouth|as framed; the head cut at the top \d+ px for [\d.]+ s); captions (on the chin or neck of guest|on guest: the lower lip [\d.]+ s.*not on the mouth)/);
    assert.doesNotMatch(rm.stdout, /captions ✗|✗ Shot/);
    // head: never a head cut further, the mouth's price said instead
    const rh = place("--raise", "head");
    assert.equal(rh.status, 0, rh.stdout + rh.stderr);
    assert.match(rh.stdout, /Raised \(--raise head\)/);
    assert.match(rh.stdout, / 1\. 0\.0–3\.0 s {2}as framed; the head cut at the top \d+ px for [\d.]+ s; captions/);
    assert.doesNotMatch(rh.stdout, /so that the captions keep off the mouth/);
    assert.equal(place("--raise", "").status, 0);
    // two lines asked for (a style of phrases, or a long word broken at its soft hyphen): layout gives them room, captions gets them
    const r2l = place("--caption-y", "", "--lines", "2");
    assert.equal(r2l.status, 0, r2l.stdout + r2l.stderr);
    assert.match(r2l.stdout, /up to two lines of \d+ px/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "takes", "place.json"), "utf8")).caption.lines, 2);
    assert.equal(place("--lines", "").status, 0);
    // below the safe box, where the apps lay their own text: refused in one sentence
    const low = place("--caption-y", "1750");
    assert.equal(low.status, 1);
    assert.match(low.stdout + low.stderr, /--caption-y 1750 is below the safe box's bottom/);
    assert.equal(place("--caption-y", "").status, 0);
    // full: raised over a ground, the band said
    const r = place("--raise", "full");
    const said = r.stdout + r.stderr;
    assert.equal(r.status, 0, said);
    assert.match(said, /The captions: one place for the clip, one line of \d+ px, the lowest line at y 1440/);
    assert.match(said, / 1\. 0\.0–3\.0 s {2}raised \d+ px, a blurred band of \d+ px at the bottom \(under the apps' text from y 1440\)/);
    const placed = JSON.parse(fs.readFileSync(path.join(dir, "takes", "place.json"), "utf8"));
    assert.equal(placed.caption.y, 1440);
    assert.equal(placed.raise, "full");
    assert.ok(placed.hook && ["text", "card"].includes(placed.hook.kind), JSON.stringify(placed.hook));
    const framedNow = JSON.parse(fs.readFileSync(path.join(dir, "framed.json"), "utf8"));
    assert.ok(framedNow.windows[0].lift?.ground > 0, "the close-up raised in framed.json");
    const kept = JSON.parse(fs.readFileSync(path.join(dir, "reframe.json"), "utf8"));
    assert.ok(kept.lifts.length >= 1, JSON.stringify(kept));
    const faces = JSON.parse(fs.readFileSync(path.join(td, "faces.json"), "utf8"))["01.mp4"];
    assert.ok(faces.faces.length > 50);
    assert.ok(fs.existsSync(path.join(dir, "placed.sheet.jpg")), said);
    // fixed by the agent: the close-up not raised; kept for the next run (as is --raise full)
    const r2 = place("--lift", "1.5:0");
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.match(r2.stdout, / 1\. 0\.0–3\.0 s {2}as framed(; the head cut at the top \d+ px for [\d.]+ s)?; captions (on the chin or neck of guest|✗ on the mouth of guest: the mouth [\d.]+ s[\s\S]*✗ Shot 1 .*a larger lift than the one fixed)/);
    // held where it is with the captions over the mouth: a fault, named, with what would avoid it
    const rx = place("--caption-y", "1260");
    assert.match(rx.stdout, /captions ✗ on the (mouth|nose or eyes) of guest: the (mouth|nose or eyes) [\d.]+ s/);
    assert.match(rx.stdout, /✗ Shot 1 \(0–3 s\): the captions (cover guest.s mouth|lie on guest.s nose or eyes) for [\d.]+ s .*What would avoid it: a larger lift than the one fixed/);
    assert.equal(place("--caption-y", "").status, 0);
    const p2 = JSON.parse(fs.readFileSync(path.join(dir, "takes", "place.json"), "utf8"));
    assert.equal(p2.fixed.lifts["1.5"], 0);
    assert.equal(p2.raise, "full");
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "framed.json"), "utf8")).windows[0].lift, undefined);
  } finally { if (!process.env.KEEP) fs.rmSync(dir, { recursive: true, force: true }); }
});
