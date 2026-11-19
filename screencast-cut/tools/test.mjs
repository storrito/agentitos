// What becomes of a pause, on made-up movement of a screen and of the phone's camera, and the
// cut's text as people read it (captions, subtitles), on made-up words; which option the
// installed ffmpeg takes for a steady frame rate. No request.
//
//   node --test tools/test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { plan, capitalised, endsSentence } from "./lib/cut.mjs";
import { pauseMoves, whileSpeaking, MOVING } from "./lib/activity.mjs";
import { HOP } from "./lib/voice.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ------------------------------------------------------------------------------ the pauses
// One recording of 20 s: words every half second from 1 to 8 s and from 12 to 18 s, a pause of
// 4 s between them (after word 13).
const words = [];
for (const [a, b] of [[1, 8], [12, 18]]) for (let t = a; t < b - 0.01; t += 0.5) words.push({ i: words.length, clip: 1, kind: "word", text: "wort", start: t, end: t + 0.4 });
const PAUSE = [8.4, 12];
const talking = (t) => words.some((w) => t >= w.start && t <= w.end);
const voices = { 1: {
  env: Float32Array.from({ length: 20 / HOP }, (_, f) => (talking(f * HOP) ? 0.1 : 0.001)), thr: 0.01, duration: 20,
  blocks: Array.from({ length: 200 }, (_, k) => ({ t: k / 10, m: talking(k / 10 - 0.2) ? -20 : -80 })),
} };
const settings = { fps: 30, pause: 1, loudness: -14, tail: 0.45, end: 1.5, speed: 1 };
const all = { keep: [{ words: `0-${words.length - 1}` }] };
// made-up movement, four samples a second over the whole recording as activity.json holds it:
// c(t) is the share of changed pixels at t
const series = (c) => Array.from({ length: 80 }, (_, k) => ({ t: (k + 1) / 4, c: c((k + 1) / 4) }));
// a cut with these sources, as build makes it: every source but the webcam can show a pause, the
// phone's camera by its own limit
const cutWith = (activity, cut = all) => {
  const shows = Object.keys(activity).filter((k) => k !== "webcam");
  const { moves, limits } = pauseMoves(activity, shows, { cameras: ["phone", "webcam"], words, maxPause: settings.pause });
  return { ...plan(words, cut, settings, voices, moves), limits };
};
const shownIn = (r) => r.pieces.filter((p) => p.mute && !p.hold && p.in < PAUSE[1] && p.out > PAUSE[0]);
// a phone in the hand: 5–9 % of the picture changes all the time, speaking or not
const hand = (t) => 0.05 + 0.01 * ((t * 4) % 5);
// a screen talked over: a caret, a little typing
const screen = (t) => (talking(t) ? 0.0003 : 0.0001);

test("the phone's camera in the hand: a pause that moves as much as while speaking is cut hard", () => {
  const r = cutWith({ screen: series(screen), phone: series(hand) });
  assert.deepEqual(r.errors, []);
  assert.equal(shownIn(r).length, 0);
  assert.ok(r.limits.phone.base > 0.05 && r.limits.phone.base < 0.1, `the movement while speaking: ${r.limits.phone.base}`);
  assert.equal(r.limits.phone.limit, +(4 * r.limits.phone.base).toFixed(5));
  // what the build did before: the camera over 0.2 %, so the whole pause stayed
  const before = plan(words, all, settings, voices, (_c, from, to) => [{ from, to }]);
  assert.equal(shownIn(before).length, 1);
});

test("the phone's camera: a pause in which something moves well above it stays, muted", () => {
  // something is held into the picture from 9.5 to 11 s
  const r = cutWith({ screen: series(screen), phone: series((t) => (t > 9.5 && t <= 11 ? 0.45 : hand(t))) });
  const shown = shownIn(r);
  assert.equal(shown.length, 1);
  assert.ok(shown[0].in >= 9 && shown[0].out <= 11.5, `shown ${shown[0].in}–${shown[0].out}`);
});

test("the phone's camera on a stand: still while speaking, its limit stays 0.2 %, a movement in a pause stays as before", () => {
  const still = (t) => (talking(t) ? 0.0004 : 0.0002);
  const r = cutWith({ phone: series((t) => (t > 9 && t <= 10 ? 0.005 : still(t))) });
  assert.equal(r.limits.phone.limit, MOVING);
  assert.equal(shownIn(r).length, 1);
});

test("a screen: any movement over 0.2 % in a pause stays, a still one is cut, as it always was", () => {
  // a click and a page that loads, 9 to 10 s
  const click = cutWith({ screen: series((t) => (t > 9 && t <= 10 ? 0.01 : screen(t))) });
  assert.equal(shownIn(click).length, 1);
  assert.deepEqual(click.limits, {}, "a screen gets no limit of its own");
  assert.equal(shownIn(cutWith({ screen: series(screen) })).length, 0);
  assert.equal(shownIn(cutWith({ screen: series((t) => (t > 9 && t <= 10 ? 0.0015 : 0)) })).length, 0);
});

test("a screen that moves while the person speaks (a video playing on it): its pauses are measured as before, not against that", () => {
  const playing = (t) => (talking(t) ? 0.01 : 0.004);
  const r = cutWith({ screen: series(playing), "phone-screen": series(() => 0) });
  assert.equal(shownIn(r).length, 1);
  assert.ok(shownIn(r)[0].in <= PAUSE[0] + 0.3 && shownIn(r)[0].out >= PAUSE[1] - 0.6, "the whole pause shows");
});

test("a pause shows when the screen moves in it, whatever the phone's camera does", () => {
  const r = cutWith({ screen: series((t) => (t > 9 && t <= 10 ? 0.01 : screen(t))), phone: series(hand) });
  const shown = shownIn(r);
  assert.equal(shown.length, 1);
  assert.ok(shown[0].in >= 8.4 && shown[0].out <= 10.5, `shown ${shown[0].in}–${shown[0].out}: the screen's click, not the hand`);
});

test("the webcam never decides a pause", () => {
  const r = cutWith({ screen: series(screen), webcam: series((t) => (t > 9 && t <= 11 ? 0.45 : hand(t))) });
  assert.equal(shownIn(r).length, 0);
});

test("the agent overrules: \"pauses\": \"keep\" plays a pause the tool would cut as it is", () => {
  const r = cutWith({ screen: series(screen), phone: series(hand) }, { keep: [{ words: all.keep[0].words, pauses: "keep" }] });
  assert.equal(r.removed.filter((x) => x.kind === "pause").length, 0);
  assert.ok(r.pieces.some((p) => !p.mute && p.in < PAUSE[0] && p.out > PAUSE[1]), "one piece plays through the pause");
});

test("an announced wait stays a timelapse when the phone's camera moves, whatever it moves while speaking", () => {
  const r = cutWith({ screen: series(screen), phone: series(hand) }, { ...all, waits: [13] });
  assert.equal(r.removed.find((x) => x.kind === "pause").wait, true);
  const shown = shownIn(r);
  assert.equal(shown.length, 1);
  assert.ok(shown[0].rate > 1, "a timelapse");
});

test("the movement while speaking: the samples inside the speech, or all of them when there is too little", () => {
  const m = whileSpeaking(series(hand), words, 1);
  assert.ok(m.enough && m.seconds >= 10, `${m.seconds} s`);
  const few = whileSpeaking(series((t) => (t < 2 ? 0.5 : 0.001)), words.slice(0, 2), 1);
  assert.equal(few.enough, false);
  assert.equal(few.seconds, 20);
  assert.equal(few.base, 0.001);
});

// ------------------------------------------------------------------------------- the text
// Made-up words of one recording, 0.4 s each with 0.1 s between; the voice on wherever a word is.
function said(texts) {
  const words = texts.map(([text, kind = "word"], i) => ({ i, clip: 1, text, kind, start: 0.5 + i * 0.5, end: 0.9 + i * 0.5 }));
  const duration = words.at(-1).end + 1, env = new Float32Array(Math.ceil(duration / HOP));
  for (const w of words) env.fill(1, Math.round(w.start / HOP), Math.round(w.end / HOP));
  return { words, voices: { 1: { env, thr: 0.5, blocks: [], duration } } };
}
const SETTINGS = { ...settings, lang: "de" };
const text = (r) => r.words.map((w) => w.text).join(" ");

test("the text of the cut: a word that begins a sentence once a filler before it is cut out gets its capital, the times stay", () => {
  const { words, voices } = said([["Das"], ["ist"], ["fertig."], ["Äh,", "filler"], ["und"], ["der"], ["äh", "filler"], ["Sticker"], ["kommt"], ["am"], ["3."], ["äh", "filler"], ["juni."]]);
  const r = plan(words, { keep: [{ words: "0-12" }] }, SETTINGS, voices);
  assert.deepEqual(r.errors, []);
  // after the sentence's end: capitalised; inside a sentence and after "3." (an ordinal): as it was
  assert.equal(text(r), "Das ist fertig. Und der Sticker kommt am 3. juni.");
  assert.deepEqual(r.words.map((w) => w.i), [0, 1, 2, 4, 5, 7, 8, 9, 10, 12]);
  // the same words, timed as before: only the text changed
  const plain = plan(words.map((w) => (w.i === 4 ? { ...w, text: "Und" } : w)), { keep: [{ words: "0-12" }] }, SETTINGS, voices);
  assert.deepEqual(r.words.map(({ start, end }) => [start, end]), plain.words.map(({ start, end }) => [start, end]));
  // a filler that stays in the sound is never in the text either
  const kept = plan(words, { keep: [{ words: "0-12", sounds: "keep" }] }, SETTINGS, voices);
  assert.equal(text(kept), "Das ist fertig. Und der Sticker kommt am 3. juni.");
  // the whole cut a little faster: the same text
  assert.equal(text(plan(words, { keep: [{ words: "0-12" }] }, { ...SETTINGS, speed: 1.15 }, voices)), "Das ist fertig. Und der Sticker kommt am 3. juni.");
});

test("the text of the cut: a word cut out before it counts as a filler does, a spelling the agent fixed stays, a digit or a symbol is left alone", () => {
  const { words, voices } = said([["Gut."], ["also"], ["und"], ["weiter."], ["äh", "filler"], ["1080"], ["Pixel."], ["äh", "filler"], ["@storrito"], ["sagt"], ["hallo."]]);
  // word 1 dropped between two keeps, and the fillers: "und" begins the second keep after "Gut."
  const r = plan(words, { keep: [{ words: "0-0" }, { words: "2-10" }] }, SETTINGS, voices);
  assert.equal(text(r), "Gut. Und weiter. 1080 Pixel. @storrito sagt hallo.");
  // the cut's first word, after words cut out
  assert.equal(text(plan(words, { keep: [{ words: "2-3" }] }, SETTINGS, voices)), "Und weiter.");
  // the first word of the recording, nothing cut before it: as the model wrote it
  const own = said([["und"], ["los."]]);
  assert.equal(text(plan(own.words, { keep: [{ words: "0-1" }] }, SETTINGS, own.voices)), "und los.");
  // "fixes" is the agent's spelling
  assert.equal(text(plan(words, { keep: [{ words: "0-0" }, { words: "2-3" }], fixes: { 2: "und" } }, SETTINGS, voices)), "Gut. und weiter.");
});

test("the text of the cut: a hook ahead and its place later both read as sentences", () => {
  const { words, voices } = said([["Hier"], ["ist"], ["es."], ["äh", "filler"], ["so"], ["geht"], ["das."]]);
  const r = plan(words, { keep: [{ words: "4-6", hook: true }, { words: "0-6" }] }, SETTINGS, voices);
  assert.equal(text(r), "So geht das. Hier ist es. So geht das.");
  assert.deepEqual(r.words.map((w) => w.i), [4, 5, 6, 0, 1, 2, 4, 5, 6]);
});

test("the text of the cut: a sentence end the speech model put on the filler goes onto the word before, a filler's comma goes with it", () => {
  const { words, voices } = said([["Fertig,"], ["äh.", "filler"], ["Und"], ["dann"], ["äh,", "filler"], ["weiter"], ["hier."]]);
  const r = plan(words, { keep: [{ words: "0-6" }] }, SETTINGS, voices);
  assert.equal(text(r), "Fertig. Und dann weiter hier.");
  // the words in the source stay as they were
  assert.equal(words[0].text, "Fertig,");
});

test("capitalised: Unicode's first letter, by the language; names and digits as they are", () => {
  assert.equal(capitalised("über"), "Über");
  assert.equal(capitalised("istanbul", "tr"), "İstanbul");
  assert.equal(capitalised("iPhone"), "iPhone");
  assert.equal(capitalised("3d"), "3d");
  assert.equal(capitalised("¿qué"), "¿qué");
  assert.ok(endsSentence("Pixel.") && endsSentence("so?“") && endsSentence("»Ende.«") && !endsSentence("3.") && !endsSentence("z.B.") && !endsSentence("und,"));
});

// ------------------------------------------------------------------------ ffmpeg's options
// A steady frame rate: -fps_mode where ffmpeg knows it (5.1 on), else -vsync (4.4 refuses
// -fps_mode). Each case in a node of its own, with a made-up ffmpeg first on the PATH.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const rateWith = (script) => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "fake-ffmpeg-"));
  try {
    fs.writeFileSync(path.join(bin, "ffmpeg"), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", `import { steadyRate } from ${JSON.stringify(path.join(HERE, "lib", "media.mjs"))}; console.log(steadyRate().join(" "));`], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    return r.stdout.trim();
  } finally { fs.rmSync(bin, { recursive: true, force: true }); }
};

test("a steady frame rate: -fps_mode where ffmpeg takes it, -vsync where it refuses it (ffmpeg 4.4)", () => {
  assert.equal(rateWith(`exit 0`), "-fps_mode cfr");
  assert.equal(rateWith(`for a; do [ "$a" = "-fps_mode" ] && { echo "Unrecognized option 'fps_mode'." >&2; exit 1; }; done; exit 0`), "-vsync cfr");
});

test("the installed ffmpeg converts a recording with the option it was asked about", { skip: !hasFfmpeg && "no ffmpeg on this machine" }, async () => {
  const { prepare } = await import("./lib/media.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prepare-"));
  try {
    const src = path.join(dir, "in.webm");
    assert.equal(spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=s=320x180:r=24:d=1", "-c:v", "libvpx", src]).status, 0);
    const out = await prepare(src, path.join(dir, "out.mp4"), { fps: 30 });
    assert.ok(out.video && Math.abs(out.duration - 1) < 0.1, `converted: ${JSON.stringify(out)}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------------------ the face view
// The face view placed by the layout skill (lib/placement.mjs): its order for a picture of a
// speaker (place --pick speaker, the old cover among the candidates), the face followed between
// the model's three boxes by clips' tracker, the element's geometry, and the old cover where no
// face is known. The layout skill and clips run as programs, beside this one.
import { readFaces } from "./lib/face.mjs";
import { nameOf, markOf, faceMoments, followFace, keepMoments, placeFace, insidePicture, speakerMoments, followKey, mouthSplit, faceView, FACE_MIN, coverOf, geometry, layoutTool, framingTool, FOLLOW_MAX } from "./lib/placement.mjs";
import { shots } from "./lib/composition.mjs";
import { cover, place } from "./lib/layout.mjs";

test("the webcam's face in px: the three moments the model saw, else the one box of the circle", () => {
  const cam = { width: 1280, height: 720, face: [0.4, 0.2, 0.6, 0.7], faceAt: [{ t: 9, box: [0.4, 0.2, 0.6, 0.7] }, { t: 22.5, box: [0.45, 0.3, 0.65, 0.8] }] };
  assert.deepEqual(faceMoments(cam), [{ t: 9, box: [512, 144, 256, 360] }, { t: 22.5, box: [576, 216, 256, 360] }]);
  assert.deepEqual(faceMoments({ ...cam, faceAt: undefined }), [{ t: 0, box: [512, 144, 256, 360] }]);
  assert.deepEqual(faceMoments({ ...cam, face: null, faceAt: undefined }), []);
});

// the public test's webcam (a close 720p picture) and the captions' bands captions built in each frame
const CAM = { width: 1280, height: 720, face: [0.388, 0.202, 0.614, 0.685], faceAt: [{ t: 9, box: [0.388, 0.204, 0.614, 0.692] }, { t: 22.51, box: [0.388, 0.202, 0.614, 0.685] }, { t: 36.01, box: [0.388, 0.204, 0.614, 0.69] }] };
const BANDS = { "1080x1920": { left: 192, width: 696, top: 1282, bottom: 1440, size: 52, lines: 2 }, "1080x1350": { left: 54, width: 972, top: 1072, bottom: 1230, size: 52, lines: 2 }, "1920x1080": { left: 96, width: 1728, top: 772, bottom: 930, size: 52, lines: 2 } };
const LAYOUT = layoutTool(), CLIPS = framingTool();
const placed = (dir, size, moments = faceMoments(CAM)) => {
  const [width, height] = size.split("x").map(Number), area = path.join(dir, `area-${size}.json`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(area, JSON.stringify(BANDS[size]));
  const r = placeFace({ tool: LAYOUT, folder: path.join(dir, size), moments, cam: CAM, width, height, area });
  assert.ok(r.res, r.why);
  return r.res;
};

test("the face view is in the layout skill's order for a speaker: the frame covered as before where it passes at 2× at most (16:9 at 1.5×, 4:5 at 1.875× before the square at 1.5×: the builds as main's), else the picture across the frame's width with the face nearest the usual size (9:16: the 4:5 crop at 1.875×, the chin above the captions), the old 2.67× cover last", { skip: !LAYOUT && "no layout skill beside this one" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "face-view-"));
  try {
    const sq = placed(dir, "1080x1350").candidates;
    assert.ok(sq.findIndex((x) => nameOf(x) === "crop 1:1" && x.scale === 1.5) > 0 && sq.find((x) => nameOf(x) === "crop 1:1").pick.passes);
    for (const size of ["1920x1080", "1080x1350"]) {
      const res = placed(dir, size), first = res.candidates[0], old = coverOf(CAM, ...size.split("x").map(Number));
      assert.equal(nameOf(first), "cover", size);
      assert.deepEqual([first.scale, first.left, first.top], [old.scale, old.left, old.top], size);
      assert.ok(first.pick.passes && markOf(first) !== "–" && markOf(first) !== "✗", `${size}: ${first.pick.why}`);
    }
    const res = placed(dir, "1080x1920"), first = res.candidates[0];
    assert.equal(nameOf(first), "crop 4:5");
    assert.equal(first.scale, 1.875);
    assert.ok(first.faceInFrame[0][1] + first.faceInFrame[0][3] < BANDS["1080x1920"].top, `the chin at ${first.faceInFrame[0][1] + first.faceInFrame[0][3]}`);
    const last = res.candidates.at(-1);
    assert.ok(nameOf(last) === "cover" && last.hard && markOf(last) === "✗" && last.scale > 2.6, JSON.stringify(last.pick));
    // the inset (the whole webcam at 0.84×) stands behind every picture across the width that passes
    const inset = res.candidates.findIndex((x) => x.fit === "inset");
    assert.ok(res.candidates.slice(0, inset).every((x) => x.pick.passes && x.pick.across));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a keep whose speaker leans in: with the face followed over the keep the frame covered in 16:9 puts the captions on the mouth for part of it, under two thirds, and is kept, marked –; the keeps around it keep it, ✓", { skip: !LAYOUT && "no layout skill beside this one" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "face-lean-"));
  try {
    // the public webcam's lean as clips' tracker follows it: the face 95 px lower from 26 to 29 s
    const followed = { moments: Array.from({ length: 101 }, (_, i) => { const t = 20 + i / 10, d = t < 24.5 || t > 30.5 ? 0 : t < 26 ? (t - 24.5) / 1.5 : t > 29 ? (30.5 - t) / 1.5 : 1; return { t: +t.toFixed(1), box: [496.6, +(146 + 95 * d).toFixed(1), 289.3, 348.5] }; }) };
    const lean = keepMoments(followed, 22, 30.7, faceMoments(CAM)), before = keepMoments(followed, 20, 23.5, faceMoments(CAM));
    assert.ok(lean.followed && lean.moments.length > 30 && lean.moments.every((m, i) => i === 0 || m.t > lean.moments[i - 1].t));
    const leaning = placed(dir, "1920x1080", lean.moments), still = placed(path.join(dir, "b"), "1920x1080", before.moments);
    const kept = leaning.candidates[0];
    assert.ok(nameOf(kept) === "cover" && markOf(kept) === "–" && kept.pick.partly && kept.pick.mouth.share <= 2 / 3 && /on the mouth for [\d.]+ s/.test(kept.pick.why), JSON.stringify(kept.pick));
    assert.equal(nameOf(still.candidates[0]), "cover");
    // outside every followed moment the model's three boxes stand
    assert.deepEqual(keepMoments(followed, 40, 44, faceMoments(CAM)), { moments: faceMoments(CAM), followed: false });
    assert.deepEqual(keepMoments(null, 0, 5, faceMoments(CAM)).moments, faceMoments(CAM));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("clips' tracker follows a head that moves between the model's boxes, as a program and without a model, once; where it cannot run the reason is said", { skip: !CLIPS && "no clips skill beside this one" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "face-follow-"));
  try {
    // a made-up webcam: a patterned patch on grey that drops 80 px between 2 and 2.5 s and comes back between 3.5 and 4 s
    const file = path.join(dir, "webcam.mp4");
    const y = "60+80*min(1,max(0,(t-2)*2))-80*min(1,max(0,(t-3.5)*2))";
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=640x360:d=6:r=30", "-f", "lavfi", "-i", "testsrc2=s=120x150:d=6:r=30", "-filter_complex", `[0][1]overlay=x=260:y='${y}'`, "-c:v", "libx264", "-pix_fmt", "yuv420p", file]);
    assert.equal(r.status, 0, r.stderr);
    const cam = { width: 640, height: 360, duration: 6, faceAt: [{ t: 1, box: [260 / 640, 60 / 360, 380 / 640, 210 / 360] }, { t: 5, box: [260 / 640, 60 / 360, 380 / 640, 210 / 360] }] };
    const out = path.join(dir, "webcam.followed.json");
    const f = followFace({ tool: CLIPS, file, cam, out });
    assert.ok(f.moments?.length > 40, JSON.stringify(f).slice(0, 300));
    const at3 = f.moments.find((m) => Math.abs(m.t - 3) < 0.06);
    assert.ok(at3 && Math.abs(at3.box[1] - 140) < 12, `at 3 s the box's top at ${at3?.box[1]} (the patch at 140, the straight line between the boxes at 60)`);
    // kept: a second call reads the file (the tracker is not run again: the file stays as it was)
    const was = fs.statSync(out).mtimeMs;
    assert.deepEqual(followFace({ tool: CLIPS, file, cam, out }), f);
    assert.equal(fs.statSync(out).mtimeMs, was);
    assert.match(followFace({ tool: null, file, cam, out: path.join(dir, "x.json") }).why, /clips skill is not beside this one/);
    assert.match(followFace({ tool: CLIPS, file, cam: { ...cam, faceAt: undefined }, out: path.join(dir, "x.json") }).why, /no box for each of its frames/);
    assert.match(followFace({ tool: CLIPS, file, cam: { ...cam, duration: FOLLOW_MAX + 60 }, out: path.join(dir, "x.json") }).why, /over the 10 the tracker holds in memory/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a face piece is drawn as the layout skill placed it, clipped to its window; without a placement, or with \"cover\", exactly as before", () => {
  const sources = { webcam: { width: 1280, height: 720, offset: 0, face: [0.388, 0.202, 0.614, 0.685] }, screen: { width: 1920, height: 1080, offset: 0 } };
  const piece = { view: "face", source: "webcam", start: 0, duration: 2, in: 0, out: 2 };
  const pic = { fit: "crop 4:5", scale: 1.875, left: -669.4, top: 270, window: [0, 285, 1080, 1350] };
  const [placed] = shots([{ ...piece, picture: pic }], sources, 1080, 1920, {});
  const l = placed.layers[0];
  assert.deepEqual(l.box, [0, 285, 1080, 1350]);
  assert.deepEqual(l.at, { left: -669.4, top: 270, width: 2400, height: 1350, inset: [15, 650.6, 0, 669.4] });
  assert.deepEqual(geometry(pic, sources.webcam), l.at);
  for (const p of [piece, { ...piece, picture: { ...pic, fit: "cover" } }]) {
    const [s] = shots([p], sources, 1080, 1920, {});
    assert.deepEqual(s.layers, [{ source: "webcam", box: [0, 0, 1080, 1920], crop: cover(sources.webcam, 1080, 1920), main: true }]);
    assert.equal(place(s.layers[0].box, s.layers[0].crop, sources.webcam).width, 3413.4);
  }
});

// The review's drifting and nodding webcams (1280×720): clips' tracker follows the head up to the
// picture's top edge, and its box there starts above it (37 and 29 of 751 moments); layout's place
// refuses a box past the source, and every build of the review's cut stopped. The boxes below are
// the tracker's own from those webcams; the side and the outside ones are made from them.
const TOP_EDGE = [{ t: 43.8, box: [725, -5, 298, 345] }, { t: 43.9, box: [735, -5, 298, 345] }, { t: 44, box: [745, -5, 298, 345] }, { t: 44.2, box: [745, 2, 298, 345] }];
const NOD_TOP = [{ t: 56.3, box: [536, -6, 233, 279] }, { t: 56.4, box: [536, -16, 233, 279] }, { t: 56.5, box: [536, -11, 233, 279] }];
const SIDE_CAM = { width: 1280, height: 720 };

test("a box from the tracker that reaches past the webcam's picture is taken to its part inside it, as layout's beside does; one wholly outside is left out", () => {
  const top = insidePicture(TOP_EDGE, SIDE_CAM);
  assert.deepEqual(top.moments.map((m) => m.box), [[725, 0, 298, 340], [735, 0, 298, 340], [745, 0, 298, 340], [745, 2, 298, 345]]);
  assert.deepEqual([top.clamped, top.outside], [3, 0]);
  const side = insidePicture([{ t: 1, box: [-40, 100, 298, 345] }, { t: 2, box: [1100, 100, 298, 345] }], SIDE_CAM);
  assert.deepEqual(side.moments.map((m) => m.box), [[0, 100, 258, 345], [1100, 100, 180, 345]]);
  const out = insidePicture([{ t: 1, box: [1290, 100, 298, 345] }, { t: 2, box: [100, -400, 298, 345] }, { t: 3, box: [500, 100, 298, 345] }], SIDE_CAM);
  assert.deepEqual([out.moments.length, out.clamped, out.outside], [1, 0, 2]);
});

test("the review's head at the top edge and at a side edge is placed by layout (its place no longer refuses the keep), a keep whose boxes all lie outside the picture is not placed and says why", { skip: !LAYOUT && "no layout skill beside this one" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "face-edge-"));
  try {
    const cam = { ...SIDE_CAM, face: [0.241, 0.014, 0.474, 0.495] };
    for (const [name, moments] of [["top", TOP_EDGE], ["nod", NOD_TOP], ["side", [{ t: 1, box: [-40, 100, 298, 345] }, { t: 1.2, box: [1100, 90, 298, 345] }]]]) {
      const r = placeFace({ tool: LAYOUT, folder: path.join(dir, name), moments, cam, width: 1080, height: 1920 });
      assert.ok(r.res && r.res.candidates.length && !r.why, `${name}: ${r.why}`);
      assert.ok(r.clamped > 0, name);
      for (const m of JSON.parse(fs.readFileSync(path.join(dir, name, "face.json"), "utf8"))) assert.ok(m.box[0] >= 0 && m.box[1] >= 0 && m.box[0] + m.box[2] <= 1280 && m.box[1] + m.box[3] <= 720, JSON.stringify(m));
    }
    const none = placeFace({ tool: LAYOUT, folder: path.join(dir, "none"), moments: [{ t: 1, box: [1290, 100, 298, 345] }], cam, width: 1080, height: 1920 });
    assert.match(none.why, /outside the webcam's picture/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("where layout's place stops on a keep, placeFace gives the reason instead of throwing, keeps place's words in place.log and never tells the agent to read a grid it never gave", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "face-fails-"));
  try {
    const tool = path.join(dir, "place.mjs");
    fs.writeFileSync(tool, `console.log("The box 725,-5,298,345 reaches past the source of 1280×720: a face or region the picture's edge cuts ends at that edge, read it again off the grid."); process.exit(1);\n`);
    const r = placeFace({ tool, folder: path.join(dir, "face-2"), moments: TOP_EDGE, cam: SIDE_CAM, width: 1080, height: 1920 });
    assert.ok(!r.res && r.why, JSON.stringify(r));
    assert.doesNotMatch(r.why, /grid/);
    assert.match(r.why, /place\.log/);
    assert.match(fs.readFileSync(path.join(dir, "face-2", "place.log"), "utf8"), /reaches past the source/);
    // a place that answers with something that is not JSON, or a tool that is not there
    fs.writeFileSync(tool, `console.log("not json");\n`);
    assert.match(placeFace({ tool, folder: path.join(dir, "face-3"), moments: TOP_EDGE, cam: SIDE_CAM, width: 1080, height: 1920 }).why, /stopped/);
    assert.ok(placeFace({ tool: path.join(dir, "missing.mjs"), folder: path.join(dir, "face-4"), moments: TOP_EDGE, cam: SIDE_CAM, width: 1080, height: 1920 }).why);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The review's webcam of two people (1280×720, one at the left and one at the right): where the
// model's three answers name the left one twice and the right one once, the tracker blended
// between them (at 30 s its box on the seam, 599,96,147,262). The boxes are the review's, in
// thousandths of the frame as the model answers.
const LEFT = { left: 198, top: 111, right: 334, bottom: 463 }, RIGHT = { left: 625, top: 111, right: 729, bottom: 482 };
const MOMENTS = [15.01, 37.53, 60.05];
const answer = (...faces) => JSON.stringify({ faces });

test("the model's answers are matched to its frames by the frame each names, by count only where each frame has one; two faces in a frame give no moments, and say why", () => {
  const mixed = readFaces(answer(LEFT, RIGHT, LEFT), MOMENTS);
  assert.deepEqual(mixed.face, [0.198, 0.111, 0.334, 0.463], "the circle: the middle answer across, as before");
  assert.equal(mixed.at.length, 3);
  const both = readFaces(answer(...[1, 2, 3].flatMap((frame) => [{ frame, ...LEFT }, { frame, ...RIGHT }])), MOMENTS);
  assert.equal(both.at, null);
  assert.match(both.atWhy, /2 faces in one of its frames/);
  const six = readFaces(answer(LEFT, RIGHT, LEFT, RIGHT, LEFT, RIGHT), MOMENTS);
  assert.equal(six.at, null);
  assert.match(six.atWhy, /6 faces for its 3 frames/);
  // a frame without a face: the two others at their own moments
  const two = readFaces(answer({ frame: 1, ...LEFT }, { frame: 3, ...LEFT }), MOMENTS);
  assert.deepEqual(two.at.map((m) => m.t), [15.01, 60.05]);
  assert.equal(readFaces("no face here", MOMENTS), null);
});

test("the face view follows one person, the circle's: the review's answers that name two people are covered as before with the reason, a head that drifts sideways is followed", () => {
  const cam = (found) => ({ width: 1280, height: 720, face: found.face, ...(found.at ? { faceAt: found.at } : {}), ...(found.atWhy ? { faceAtWhy: found.atWhy } : {}) });
  const mixed = speakerMoments(cam(readFaces(answer(LEFT, RIGHT, LEFT), MOMENTS)));
  assert.ok(!mixed.moments);
  assert.match(mixed.why, /at 37\.53 s lies further than a face's width or height from the one the circle shows/);
  assert.match(speakerMoments(cam(readFaces(answer(LEFT, RIGHT, LEFT, RIGHT, LEFT, RIGHT), MOMENTS))).why, /6 faces for its 3 frames/);
  // a webcam from before face.mjs kept its moments: as before, said
  assert.match(speakerMoments({ width: 1280, height: 720, face: [0.174, 0.126, 0.339, 0.498] }).why, /no face for each of the frames/);
  // the review's drifting head (one person, 0.18 to 0.39 of the width over 45 s): followed
  const side = { width: 1280, height: 720, face: [0.241, 0.014, 0.474, 0.495], faceAt: [{ t: 15.01, box: [0.184, 0.025, 0.412, 0.509] }, { t: 37.53, box: [0.241, 0.014, 0.474, 0.495] }, { t: 60.05, box: [0.391, 0.014, 0.623, 0.489] }] };
  assert.equal(speakerMoments(side).moments.length, 3);
  assert.deepEqual(speakerMoments(CAM).moments, faceMoments(CAM));
});

// The review: a different webcam with the same three boxes got the first webcam's track back in
// 0.0 s, since the kept track was keyed on the boxes alone.
test("a kept track is the one of this webcam and this tracker: another webcam with the same boxes, or a changed tracker, is followed anew", { skip: !CLIPS && "no clips skill beside this one" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "face-key-"));
  try {
    const make = (file, y) => assert.equal(spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=640x360:d=4:r=30", "-f", "lavfi", "-i", "testsrc2=s=120x150:d=4:r=30", "-filter_complex", `[0][1]overlay=x=260:y='${y}'`, "-c:v", "libx264", "-pix_fmt", "yuv420p", file]).status, 0);
    const file = path.join(dir, "webcam.mp4"), out = path.join(dir, "webcam.followed.json");
    const cam = { width: 640, height: 360, duration: 4, faceAt: [{ t: 0.5, box: [260 / 640, 60 / 360, 380 / 640, 210 / 360] }, { t: 3.5, box: [260 / 640, 60 / 360, 380 / 640, 210 / 360] }] };
    make(file, "60");
    const a = followFace({ tool: CLIPS, file, cam, out });
    assert.ok(a.moments?.length && a.key.webcam.size === fs.statSync(file).size && /^[0-9a-f]{16}$/.test(a.key.tracker), JSON.stringify(a.key));
    // the same name, another picture: the patch 80 px lower from 1.5 to 2.5 s
    make(file, "60+80*min(1,max(0,(t-1)*2))-80*min(1,max(0,(t-2.5)*2))");
    const b = followFace({ tool: CLIPS, file, cam, out });
    assert.notDeepEqual(b.key.webcam, a.key.webcam);
    const at = (r) => r.moments.find((m) => Math.abs(m.t - 2) < 0.06).box[1];
    assert.ok(Math.abs(at(a) - 60) < 12 && Math.abs(at(b) - 140) < 12, `at 2 s: ${at(a)} before, ${at(b)} now`);
    // a tracker that changed (a copy of clips' frame.mjs with one more line) is a new version
    const tools = path.join(dir, "clips-tools");
    fs.cpSync(path.dirname(CLIPS), tools, { recursive: true });
    fs.appendFileSync(path.join(tools, "frame.mjs"), "\n// changed\n");
    assert.notEqual(followKey({ tool: path.join(tools, "frame.mjs"), file, from: b.from }).tracker, b.key.tracker);
    fs.appendFileSync(path.join(tools, "lib", "track.mjs"), "\n// changed\n");
    assert.notEqual(followKey({ tool: path.join(tools, "frame.mjs"), file, from: b.from }).tracker, followKey({ tool: CLIPS, file, from: b.from }).tracker);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The review: in 16:9 the keep with the lean became the whole webcam at 1.065× with half the frame
// ground for all of its 8.7 s. The build keeps one picture per keep and says where to split it.
test("a face keep whose picture across the width has the captions on the mouth for part of it names the seconds, the word to split the keep at and the smaller picture by name", () => {
  // words 64–85 every 0.4 s from 21 s of the recording, the webcam 0.5 s behind it
  const words = Array.from({ length: 90 }, (_, i) => ({ i, text: `w${i}`, start: 21 + (i - 64) * 0.4, end: 21.3 + (i - 64) * 0.4 }));
  const ps = [{ keep: 4, words: Array.from({ length: 22 }, (_, k) => 64 + k) }];
  const smaller = { fit: "inset", scale: 1.065, pick: { face: 0.344 } };
  const kept = mouthSplit({ seconds: 2.4, of: 8.8, from: 25.9, to: 28.1 }, ps, words, 0.5, { smaller });
  // the mouth from 26.4 to 28.6 s of the recording: split at word 77, the last to start by then
  // (26.2 s), and at word 84, the first to start after the last moment on the mouth (29 s)
  assert.match(kept.said, /on the mouth for 2\.4 s of the keep's 8\.8 s \(the webcam's 25\.9–28\.1 s\), at most two thirds, so the picture across the width stays/);
  assert.match(kept.said, /split the keep at word 77 \("w77"\) and at word 84 \("w84"\) \("words": "64-76", "77-83", "84-85"\)/);
  assert.match(kept.said, /or name "inset" on the keep for all of it \(it passes, the face 34 % of the height\)/);
  assert.deepEqual(kept.facts, { seconds: 2.4, of: 8.8, from: 26.4, to: 28.6, split: ["64-76", "77-83", "84-85"], smaller: "inset" });
  // over two thirds: the smaller picture stands, and the split for the picture across the width is said
  const over = mouthSplit({ seconds: 5.2, of: 8.8, from: 25, to: 30 }, ps, words, 0.5, { wide: { fit: "cover", scale: 1.5 }, chosen: smaller });
  assert.match(over.said, /^cover at 1\.5× across the width has the captions on the mouth for 5\.2 s .*more than two thirds, so inset stands for all of it; to keep a picture across the width for the rest, split the keep at word 75 \("w75"\) \("words": "64-74", "75-85"\)/);
});

// The pairs the coordinator decided from (2026-11-19, layout-data's rig: lean-169, close-45): the
// public test's close webcam, its lean keep 5 (20.8–29.5 s of the cut, 22.03–30.87 s of the
// webcam at 1.02×, words 64–85) as clips' tracker followed it in the pair's build.
const LEAN5 = [[22.1,496,146,289,348],[22.2,496,146,289,348],[22.4,495,146,289,348],[22.6,495,146,289,348],[22.8,495,146,289,348],[23,496,146,289,348],[23.2,496,146,289,348],[23.4,496,146,289,348],[23.6,496,146,289,348],[23.8,496,146,289,348],[24,496,147,289,348],[24.2,496,152,289,348],[24.4,496,162,289,348],[24.6,496,168,289,348],[24.8,496,178,289,348],[25,501,194,289,348],[25.2,496,209,289,348],[25.4,493,219,289,348],[25.6,493,219,289,348],[25.8,493,229,289,348],[26,488,240,289,348],[26.2,488,240,289,348],[26.4,488,240,289,348],[26.6,488,240,289,348],[26.8,489,241,289,348],[27,489,241,289,349],[27.2,489,241,289,349],[27.4,489,241,289,349],[27.6,489,241,289,349],[27.8,489,242,289,349],[28,489,242,289,349],[28.2,490,242,289,349],[28.4,490,242,289,349],[28.6,490,242,289,349],[28.8,490,243,289,349],[29,490,243,289,349],[29.2,490,233,289,349],[29.4,490,228,289,349],[29.6,491,216,289,349],[29.8,491,206,289,349],[30,491,191,289,349],[30.2,491,181,289,349],[30.4,491,171,289,349],[30.6,491,161,289,349],[30.8,492,152,289,349]].map(([t, ...box]) => ({ t, box }));
const leanProject = (size) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "face-lean-"));
  fs.mkdirSync(path.join(dir, "source"));
  const file = path.join(dir, "source", "webcam.mp4");
  fs.writeFileSync(file, "a stand-in");
  const cam = { ...CAM, file: "webcam.mp4", video: true, offset: 0, duration: 45 };
  const from = faceMoments(cam);
  fs.writeFileSync(path.join(dir, "source", "webcam.followed.json"), JSON.stringify({ key: followKey({ tool: CLIPS, file, from }), from, moments: LEAN5 }));
  const area = path.join(dir, "area.json");
  fs.writeFileSync(area, JSON.stringify(BANDS[size]));
  // words 64–85 over the keep, every 0.4 s of the webcam from 22.1 s
  const words = Array.from({ length: 90 }, (_, i) => ({ i, text: `w${i}`, start: 22.1 + (i - 64) * 0.4, end: 22.4 + (i - 64) * 0.4 }));
  const pieces = () => [{ keep: 0, view: "face", source: "webcam", in: 22.03, out: 30.87, start: 20.8, duration: 8.667, rate: 1.02, words: Array.from({ length: 22 }, (_, k) => 64 + k) }];
  return { dir, area, words, pieces, sources: { webcam: cam, screen: { video: true, width: 1920, height: 1080, offset: 0 } } };
};

test("lean-169: the public test's lean keep in 16:9 keeps the cover, marked –, its note naming the seconds on the mouth, the word to split at and the inset by name; named \"cover\", it prints the cover's notes, not layout's note about the inset", { skip: (!LAYOUT || !CLIPS) && "no layout or clips skill beside this one" }, () => {
  const { dir, area, words, pieces, sources } = leanProject("1920x1080");
  try {
    const ps = pieces();
    const out = faceView(dir, { keep: [{ view: "face" }] }, ps, sources, { width: 1920, height: 1080, words, area }).join("\n");
    const pic = ps[0].picture;
    assert.ok(pic.fit === "cover" && pic.scale === 1.5 && pic.mark === "–" && !pic.named && pic.mouth.seconds === 5.2 && pic.mouth.of === 8.8 && pic.mouth.smaller === "inset", JSON.stringify(pic));
    assert.match(out, /keep 1 \([^)]*\): – cover at 1\.5×, the face 48 % of the height/);
    assert.match(out, /note: the captions lie on the mouth for 5\.2 s of the keep's 8\.8 s \(the webcam's 25–30 s\), at most two thirds, so the picture across the width stays for all of it; to give those seconds another picture, split the keep at word 71 \("w71"\) and at word 84 \("w84"\) \("words": "64-70", "71-83", "84-85"\) and name another picture on the part with the lean, or name "inset" on the keep for all of it \(it passes, the face 34 % of the height\)/);
    assert.doesNotMatch(out, /no picture across the frame's full width passes/);
    // named "cover": the same picture, its own note; layout's note about the first is not printed
    const named = pieces();
    const said = faceView(dir, { keep: [{ view: "face", layout: "cover" }] }, named, sources, { width: 1920, height: 1080, words, area }).join("\n");
    assert.deepEqual({ ...named[0].picture, named: undefined }, { ...pic, named: undefined });
    assert.ok(named[0].picture.named, JSON.stringify(named[0].picture));
    assert.match(said, /– cover at 1\.5×.*\(as the keep names it\)/);
    assert.match(said, /note: the captions lie on the mouth for 5\.2 s .*at most two thirds, and the keep names cover, so it stays for all of it; to give those seconds another picture, split the keep at word 71/);
    assert.doesNotMatch(said, /note: no picture across|the first is the whole picture/);
    // named "inset" (it passes, no seconds on its mouth): no note at all
    const inset = pieces();
    const quiet = faceView(dir, { keep: [{ view: "face", layout: "inset" }] }, inset, sources, { width: 1920, height: 1080, words, area }).join("\n");
    assert.ok(inset[0].picture.fit === "inset" && inset[0].picture.named && !inset[0].picture.mouth, JSON.stringify(inset[0].picture));
    assert.doesNotMatch(quiet, /note:/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("close-45: the public test's close webcam in 4:5 keeps the cover at 1.875× in the lean keep too, as main drew it (the face 48 %), the square second", { skip: (!LAYOUT || !CLIPS) && "no layout or clips skill beside this one" }, () => {
  const { dir, area, words, pieces, sources } = leanProject("1080x1350");
  try {
    const ps = pieces();
    const out = faceView(dir, { keep: [{ view: "face" }] }, ps, sources, { width: 1080, height: 1350, words, area }).join("\n");
    const pic = ps[0].picture, main = coverOf(sources.webcam, 1080, 1350);
    assert.ok(pic.fit === "cover" && pic.scale === main.scale && pic.left === main.left && pic.top === main.top && ["✓", "!"].includes(pic.mark), JSON.stringify([pic, main]));
    assert.match(out, /also: .*[✓!] crop 1:1 at 1\.5× \(the face 39 %, 20 % ground\)/);
    assert.doesNotMatch(out, /note:/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The review's smaller findings, on its own inputs: its drifting webcam (the head at the top edge,
// its tracked boxes kept as the tracker wrote them) with its cut's keeps, in a made-up project
// folder whose webcam file is a stand-in (the kept track matches it, so the tracker is not run).
const project = (moments) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "face-view-"));
  fs.mkdirSync(path.join(dir, "source"));
  const file = path.join(dir, "source", "webcam.mp4");
  fs.writeFileSync(file, "a stand-in");
  const cam = { file: "webcam.mp4", video: true, width: 1280, height: 720, offset: 0, duration: 75, face: [0.241, 0.014, 0.474, 0.495], faceAt: [{ t: 15.01, box: [0.184, 0.025, 0.412, 0.509] }, { t: 37.53, box: [0.241, 0.014, 0.474, 0.495] }, { t: 60.05, box: [0.391, 0.014, 0.623, 0.489] }] };
  if (CLIPS) { const from = faceMoments(cam); fs.writeFileSync(path.join(dir, "source", "webcam.followed.json"), JSON.stringify({ key: followKey({ tool: CLIPS, file, from }), from, moments })); }
  return { dir, sources: { webcam: cam, screen: { video: true, width: 1920, height: 1080, offset: 0 } } };
};
// the tracker's boxes over the review's keep 5 (57.7–62.5 s of the webcam): the head sweeps from
// the right to the left at the top edge
const KEEP5 = [[57.7, 761, 8], [57.8, 756, 8], [58, 746, 8], [58.2, 731, 8], [58.4, 712, 8], [58.6, 692, 8], [58.8, 672, 8], [59, 647, 9], [59.2, 628, 9], [59.4, 598, 9], [59.6, 573, 9], [59.8, 544, 9], [60, 514, 9], [60.2, 484, 9], [60.4, 454, 9], [60.6, 424, 4], [60.8, 394, -6], [61, 364, -11], [61.2, 344, -11], [61.4, 324, -1], [61.6, 309, -1], [61.8, 289, -1], [62, 269, -1], [62.2, 259, -1], [62.4, 249, -1]].map(([t, x, y]) => ({ t, box: [x, y, 297, 342] }));
const piece = (keep, view, a, b) => ({ keep, view, source: view === "face" ? "webcam" : "screen", in: a, out: b, start: a, duration: b - a, words: [] });

test("a \"layout\" on a keep without the face view is said to hold only for a face keep; a name this frame does not have falls back to the first with a ! that lists the names; a named picture that fails says on what, and which pass", { skip: (!LAYOUT || !CLIPS) && "no layout or clips skill beside this one" }, () => {
  const { dir, sources } = project([...TOP_EDGE, ...KEEP5]);
  try {
    // the review's cut-bad: "crop 1:1" on the screen keep 4, and the review's cutA: "crop 1:1" on the face keep 5
    const cut = { keep: [{ view: "face" }, {}, {}, { layout: "crop 1:1" }, { view: "face", layout: "crop 1:1" }] };
    const pieces = [piece(0, "face", 43.8, 44.2), piece(3, "screen", 50, 52), piece(4, "face", 57.69, 62.49)];
    const tall = faceView(dir, cut, pieces, sources, { width: 1080, height: 1920 }).join("\n");
    assert.match(tall, /! keep 4: "layout" holds only for a face keep \("view": "face" with a webcam\); this keep shows screen, so "crop 1:1" is left out\./);
    const named = pieces[2].picture;
    assert.ok(named.named && named.fit === "crop 1:1" && named.mark === "✗", JSON.stringify(named));
    assert.match(tall, /keep 5 \([^)]*\): ✗ crop 1:1 at 1\.5×.*\(as the keep names it\).*: it does not pass \(face 11 % outside the frame; face under .*\); these pass: "crop band", "inset"/);
    assert.doesNotMatch(tall, /nothing passes/);
    // 16:9 has no square crop: the keep takes the first, and says so with the names
    const wide = faceView(dir, cut, pieces, sources, { width: 1920, height: 1080 }).join("\n");
    assert.match(wide, /! keep 5: "layout": "crop 1:1" is not among the face view's pictures in this frame \(1920×1080\), so it takes the first; its names here: "cover"/);
    assert.ok(!pieces[2].picture.named && pieces[2].picture.fit === pieces[0].picture.fit, JSON.stringify(pieces[2].picture));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the tracker and place run under a limit, after which the keeps are covered as before and said", { skip: !LAYOUT && "no layout skill beside this one" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "face-slow-"));
  try {
    const slow = path.join(dir, "slow.mjs"), file = path.join(dir, "webcam.mp4");
    fs.writeFileSync(slow, "setTimeout(() => {}, 60000);\n");
    fs.writeFileSync(file, "a stand-in");
    const cam = { width: 1280, height: 720, duration: 75, face: [0.4, 0.2, 0.6, 0.7], faceAt: [{ t: 9, box: [0.4, 0.2, 0.6, 0.7] }] };
    const f = followFace({ tool: slow, file, cam, out: path.join(dir, "followed.json"), timeout: 1 });
    assert.ok(f.timeout && /clips' tracker ran over 1 s and was stopped/.test(f.why), JSON.stringify(f));
    const p = placeFace({ tool: slow, folder: path.join(dir, "face-1"), moments: TOP_EDGE, cam: SIDE_CAM, width: 1080, height: 1920, timeout: 1 });
    assert.match(p.why, /layout's place ran over 1 s for this keep and was stopped/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a face too small to be the webcam's speaker (the review's slide video: a person on a stage, 8 % of the webcam's height) is not followed; the keeps are covered as before and said", () => {
  const stage = { width: 1280, height: 720, face: [0.095, 0.52, 0.131, 0.596], faceAt: [{ t: 15, box: [0.053, 0.5, 0.091, 0.586] }, { t: 37.5, box: [0.095, 0.52, 0.131, 0.596] }, { t: 60.01, box: [0.112, 0.518, 0.147, 0.59] }] };
  assert.match(speakerMoments(stage).why, /the face the model found is 8 % of the webcam's height, under the 12 % of a speaker at the camera/);
  assert.equal(FACE_MIN, 0.12);
  // the review's loose webcam, the smallest real speaker measured (37 %), is followed
  assert.ok(speakerMoments({ width: 1280, height: 720, face: [0.427, 0.128, 0.587, 0.5], faceAt: [{ t: 15, box: [0.427, 0.128, 0.587, 0.5] }] }).moments);
});
