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
    // a screen keep's "layout" is the screen's (screenview.mjs): not warned here; on a keep that is neither, it is
    const tall = faceView(dir, cut, pieces, sources, { width: 1080, height: 1920, screens: new Set([3]) }).join("\n");
    assert.doesNotMatch(tall, /keep 4: "layout" holds only/);
    const phone = faceView(dir, cut, pieces, sources, { width: 1080, height: 1920 }).join("\n");
    assert.match(phone, /! keep 4: "layout" holds only for a face keep \("view": "face" with a webcam\) or a screen keep; this keep shows screen, so "crop 1:1" is left out\./);
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

test("without a HyperFrames CLI on the PATH, the version this skill was last tried with is fetched", async () => {
  const { hyperframes, HYPERFRAMES_TESTED } = await import("./lib/media.mjs");
  const before = process.env.PATH, none = fs.mkdtempSync(path.join(os.tmpdir(), "no-hyperframes-"));
  process.env.PATH = none;
  try {
    assert.deepEqual(hyperframes(), ["npx", "--yes", `hyperframes@${HYPERFRAMES_TESTED}`]);
    assert.match(HYPERFRAMES_TESTED, /^\d+\.\d+\.\d+$/);
  } finally {
    process.env.PATH = before;
    fs.rmSync(none, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------- another video over a keep
// "show" (lib/show.mjs): another video plays instead of the recording over a keep's words, pauses
// and hold; its long pauses cut; with "sound" its sound rises to its level by the last word. On
// the made-up words above (a pause of 3.6 s after word 13) and a made-up video's ffprobe answer.
import { showOf, showProblem, placeShows, soundPoints, RISE, FADE } from "./lib/show.mjs";
import { writeComposition } from "./lib/composition.mjs";
import { areas, fit } from "./lib/layout.mjs";

const VIDEO_INFO = (duration, audio = true) => ({ duration, width: 1080, height: 1920, video: true, audio });
// the screen moves all through the pause, so that without "show" it stays as a muted piece
const movingPause = (_c, from, to) => (to > PAUSE[0] && from < PAUSE[1] ? [{ from: Math.max(from, PAUSE[0]), to: Math.min(to, PAUSE[1]) }] : []);
const twoKeeps = (first = {}) => ({ keep: [{ words: "0-20", ...first }, { words: "21-25" }] });
const keepEnd = (r, k) => { const ps = r.pieces.filter((p) => p.keep === k); return ps.at(-1).start + ps.at(-1).duration; };

test("show: a keep's long pause is cut where the recording would have kept it moving; what follows starts where the keep ends", () => {
  const without = plan(words, twoKeeps(), settings, voices, movingPause);
  const withShow = plan(words, twoKeeps({ show: "result.mp4" }), settings, voices, movingPause);
  assert.deepEqual(withShow.errors, []);
  // without "show" the moving pause plays, muted; with it there is nothing of the recording to see
  const muted = (r) => r.pieces.filter((p) => p.keep === 0 && p.mute && !p.hold && p.in < PAUSE[1] && p.out > PAUSE[0]);
  assert.equal(muted(without).length, 1);
  assert.equal(muted(withShow).length, 0);
  assert.ok(withShow.removed.some((x) => x.kind === "pause" && x.from === words[13].end && x.to === words[14].start && x.moving.length === 0));
  // the next keep starts where the show keep ends, earlier by exactly the pause it no longer plays
  const shift = keepEnd(without, 0) - keepEnd(withShow, 0);
  const next = (r) => r.pieces.filter((p) => p.keep === 1);
  assert.ok(shift > 1, `the pause cut: ${shift}`);
  next(withShow).forEach((p, i) => assert.ok(Math.abs(p.start + shift - next(without)[i].start) < 1e-9));
  // where nothing moves in the pause, "show" changes no time at all: the same pieces, the same times
  const still = plan(words, twoKeeps(), settings, voices), shown = plan(words, twoKeeps({ show: "result.mp4" }), settings, voices);
  assert.deepEqual(shown.pieces.map((p) => [p.keep, +p.start.toFixed(6), +p.duration.toFixed(6), p.in, p.out]), still.pieces.map((p) => [p.keep, +p.start.toFixed(6), +p.duration.toFixed(6), p.in, p.out]));
});

test("show: the video plays over the keep's words, pauses and hold, from \"from\" on; a video shorter than the keep ends early and says what to do; a longer one is cut at the keep's end", () => {
  const r = plan(words, twoKeeps({ show: { file: "result.mp4", from: 2 }, hold: 2 }), settings, voices, movingPause);
  const ps = r.pieces.filter((p) => p.keep === 0), start = ps[0].start, end = keepEnd(r, 0);
  assert.ok(ps.some((p) => p.hold), "the hold is a piece of the keep");
  const long = placeShows(twoKeeps({ show: { file: "result.mp4", from: 2 }, hold: 2 }), r.pieces, r.words, () => VIDEO_INFO(60));
  assert.deepEqual(long.warnings, []);
  assert.deepEqual(long.inserts, [], "no \"sound\": no track of its sound");
  assert.equal(long.sources["show-1"].path, path.resolve("result.mp4"));
  assert.equal(long.sources["show-1"].file, "show-1.mp4");
  for (const p of ps) {
    assert.equal(p.show.source, "show-1");
    assert.ok(Math.abs(p.show.in - (2 + p.start - start)) < 1e-9, "its own time: from + the time into the keep");
    assert.ok(Math.abs(p.show.until - end) < 1e-9, "up to the keep's end, its hold included");
  }
  assert.equal(r.pieces.filter((p) => p.keep === 1 && p.show).length, 0, "the next keep shows the recording");
  // a video of 5 s from 2 s on has 3 s: it ends before the keep does, said with what to change
  const ps2 = plan(words, twoKeeps({ show: { file: "result.mp4", from: 2 } }), settings, voices).pieces;
  const short = placeShows(twoKeeps({ show: { file: "result.mp4", from: 2 } }), ps2, r.words, () => VIDEO_INFO(5));
  assert.equal(short.warnings.length, 1);
  assert.match(short.warnings[0], /^keep 1: result\.mp4 ends [\d.]+ s before the keep does \(from 2 s it has 3\.0 s\), .*: an earlier "from", a shorter "hold", or end the keep a word earlier$/);
  assert.ok(ps2.filter((p) => p.keep === 0).every((p) => Math.abs(p.show.until - (ps2[0].start + 3)) < 1e-9));
});

test("show with sound: a track of its own whose level is a quarter under the first words, rises over the last 1.5 s of them to its level at the last word, holds, and goes out at its end (the composition's numbers)", () => {
  const cut = twoKeeps({ show: { file: "result.mp4", sound: 0.8 }, hold: 2 });
  const r = plan(words, cut, settings, voices, movingPause);
  const shown = placeShows(cut, r.pieces, r.words, () => VIDEO_INFO(60));
  assert.equal(shown.inserts.length, 1);
  const i = shown.inserts[0], ps = r.pieces.filter((p) => p.keep === 0);
  const last = r.words.filter((w) => w.start >= i.start - 0.01 && w.end <= i.start + i.duration + 0.01).at(-1);
  assert.ok(Math.abs(i.spoken - (last.end - i.start)) < 1e-9, "the last word's end from the insert's start");
  assert.ok(Math.abs(i.duration - (keepEnd(r, 0) - ps[0].start)) < 1e-9);
  const n3 = (x) => +x.toFixed(3);
  assert.deepEqual(soundPoints(i), [{ t: 0, v: 0.2 }, { t: n3(i.spoken - RISE), v: 0.2 }, { t: n3(i.spoken), v: 0.8 }, { t: n3(i.duration - FADE), v: 0.8 }, { t: n3(i.duration), v: 0 }]);
  // in the composition: the sound's element over the keep, its volume's lane as above; the shown
  // video plays at its own speed (no playback rate, no timelapse badge) while the recording runs faster
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "show-")), out = path.join(dir, "comp");
  try {
    fs.writeFileSync(path.join(dir, "result.mp4"), "made-up");
    const sources = { screen: { file: "screen.mp4", width: 1920, height: 1080, offset: 0 }, webcam: { file: "webcam.mp4", width: 1280, height: 720, offset: 0 },
      "show-1": { ...shown.sources["show-1"], path: path.join(dir, "result.mp4") } };
    fs.mkdirSync(path.join(dir, "source"));
    fs.writeFileSync(path.join(dir, "source", "screen.mp4"), "made-up");
    const pieces = r.pieces.map((p) => ({ ...p, view: "screen", source: "screen", crop: [0, 0, 1, 1], rate: 1.16, lapse: 3 }));
    const zone = { safe: [50, 200, 880, 1300], margins: { top: 200, bottom: 420, left: 50, right: 150 }, wide: [50, 200, 980, 700] };
    writeComposition(out, { title: "t", width: 1080, height: 1920, fps: 30, pieces, sources, dir, voice: "voice.cut.m4a", camera: "camera.mp4", inserts: [{ ...i, audio: "show-1.m4a" }], areas: areas(1080, 1920, zone) });
    const html = fs.readFileSync(path.join(out, "index.html"), "utf8");
    const el = html.match(/<audio id="show-sound-1"[^>]*data-start="([\d.]+)" data-duration="([\d.]+)"[^>]*data-automation="([^"]+)"/);
    assert.ok(el, "the sound's element");
    assert.equal(+el[1], +i.start.toFixed(4));
    assert.ok(Math.abs(+el[2] - i.duration) < 0.0002);
    assert.deepEqual(JSON.parse(el[3].replace(/&quot;/g, '"').replace(/&amp;/g, "&")).lanes[0].points, soundPoints(i));
    const videos = [...html.matchAll(/<video id="v\d+" class="clip" src="assets\/show-1\.mp4"[^>]*>/g)].map((m) => m[0]);
    assert.equal(videos.length, ps.length);
    assert.ok(videos.every((v) => !/data-playback-rate/.test(v)), "at its own speed");
    assert.match(videos[0], /data-media-start="0"/);
    assert.equal([...html.matchAll(/class="clip badge"/g)].length, pieces.filter((p) => p.keep !== 0).length, "a timelapse's badge, never over another video");
    assert.ok(fs.existsSync(path.join(out, "assets", "show-1.mp4")), "the video linked into assets");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("show's sound: a keep without words has it up at once; a video that ends before the keep's last word keeps its sound low under the words and fades out at its own end, never up mid-sentence (the review's 4.1 s video in a 15.3 s keep, its 12 s video in a 15.2 s one), and the build says so", () => {
  assert.deepEqual(soundPoints({ sound: 0.6, duration: 4, spoken: 0 }), [{ t: 0, v: 0 }, { t: 0.2, v: 0.6 }, { t: 3.75, v: 0.6 }, { t: 4, v: 0 }]);
  // before: full at 3.85 s and at 11.75 s while the words ran on to about 15 s
  assert.deepEqual(soundPoints({ sound: 0.8, duration: 4.1, spoken: 15 }), [{ t: 0, v: 0.2 }, { t: 3.85, v: 0.2 }, { t: 4.1, v: 0 }]);
  assert.deepEqual(soundPoints({ sound: 0.8, duration: 12, spoken: 14.8 }), [{ t: 0, v: 0.2 }, { t: 11.75, v: 0.2 }, { t: 12, v: 0 }]);
  assert.ok(soundPoints({ sound: 0.8, duration: 12, spoken: 14.8 }).every((p) => p.v <= 0.2));
  // a video that outlasts the last word rises to it as before
  assert.deepEqual(soundPoints({ sound: 0.8, duration: 16, spoken: 14.8 }).map((p) => p.v), [0.2, 0.2, 0.8, 0.8, 0]);
  const cut = twoKeeps({ show: { file: "result.mp4", sound: 0.8 } });
  const r = plan(words, cut, settings, voices);
  const shown = placeShows(cut, r.pieces, r.words, () => VIDEO_INFO(3));
  assert.match(shown.warnings[0], /^keep 1: result\.mp4 ends [\d.]+ s before the keep does .*, and its sound stays low under the words and fades out where it ends, before the last word: an earlier "from"/);
  assert.ok(soundPoints(shown.inserts[0]).every((p) => p.v <= 0.2));
  // every point after the one before it, so the lane never runs back
  for (const x of [{ sound: 1, duration: 0.4, spoken: 0.35 }, { sound: 1, duration: 1, spoken: 0.9 }, { sound: 0.5, duration: 10, spoken: 1 }]) {
    const pts = soundPoints(x);
    assert.ok(pts.every((q, j) => j === 0 || q.t > pts[j - 1].t), JSON.stringify(pts));
    assert.equal(pts.at(-1).v, 0);
  }
});

test("show: a missing file, a file that is no video, a sound asked of a video without one, and a \"from\" or \"sound\" out of range each stop the build with one sentence that says what to do", () => {
  const keep = (show) => ({ words: "0-5", show });
  const say = (show, info) => showProblem(keep(show), 2, info);
  assert.equal(say(undefined), null);
  assert.equal(showProblem({ words: "0-5" }, 0, null), null, "a keep without show");
  assert.equal(say({ file: "a.mp4", from: 1, sound: 0.8 }, VIDEO_INFO(10)), null);
  const cases = [
    [say({ from: 2 }), /names the video to play over the keep's words instead of the recording: "show": "uploads\/result\.mp4"/],
    [say("uploads/gone.mp4", { missing: true }), /there is no uploads\/gone\.mp4; give the video's path from the working directory/],
    [say("notes.txt", { error: "Invalid data found when processing input" }), /notes\.txt is no video ffprobe can read \(Invalid data found when processing input\); give a video file/],
    [say("song.mp3", { duration: 30, video: false, audio: true }), /song\.mp3 has no picture \(a sound or a still\); give a video file/],
    [say({ file: "a.mp4", from: 12 }, VIDEO_INFO(10)), /"from" is the second of a\.mp4 to start at, 0–10\.0; set it within that or leave it out/],
    [say({ file: "a.mp4", sound: 2 }, VIDEO_INFO(10)), /"sound" is the level of its sound, 0–1 .*; leave it out for none/],
    [say({ file: "story.mp4", sound: 0.8 }, VIDEO_INFO(10, false)), /story\.mp4 has no sound; leave "sound" out, or ask the person for the file with the sound/],
  ];
  for (const [said, re] of cases) {
    assert.match(said, /^✗ keep 3: "show"/);
    assert.match(said, re);
    assert.equal(said.split(/[.;:]\s+(?=[A-Z])/).length, 1, `one sentence: ${said}`);
  }
  assert.deepEqual(showOf({ show: "x.mp4" }), { file: "x.mp4" });
});

test("show on a keep that names a face view, a zoom or a layout: the shown video wins, those are left out, said in a sentence; the circle stays unless \"circle\": false", () => {
  const cut = { keep: [{ words: "0-20", view: "face", layout: "crop 4:5", show: "result.mp4" }, { words: "21-25", zoom: [0.1, 0.1, 0.5, 0.5], show: "clip.mp4" }] };
  const r = plan(words, cut, settings, voices);
  const shown = placeShows(cut, r.pieces, r.words, () => VIDEO_INFO(60));
  assert.deepEqual(shown.notes, [
    `! keep 1: "show" plays result.mp4 over the whole keep, so its "view": "face" and "layout" are left out (the shown video is the keep's picture); to see the face too, give it a keep of its own without "show".`,
    `! keep 2: "show" plays clip.mp4 over the whole keep, so its "zoom" is left out (the shown video is the keep's picture); to see the zoom too, give it a keep of its own without "show".`,
  ]);
  // drawn: the shown video whole, never the webcam's face picture or the zoom's crop; the circle beside it
  const sources = { webcam: { width: 1280, height: 720, offset: 0, face: [0.388, 0.202, 0.614, 0.685] }, screen: { width: 1920, height: 1080, offset: 0 }, ...shown.sources };
  const zone = { safe: [50, 200, 880, 1300], margins: { top: 200, bottom: 420, left: 50, right: 150 }, wide: [50, 200, 980, 700] };
  const a = areas(1080, 1920, zone);
  const face = { ...r.pieces[0], view: "face", source: "webcam", picture: { fit: "crop 4:5", scale: 1.875, left: -669.4, top: 270, window: [0, 285, 1080, 1350] } };
  const zoomed = { ...r.pieces.find((p) => p.keep === 1), view: "screen", source: "screen", crop: [0.1, 0.1, 0.5, 0.5] };
  for (const p of [face, zoomed]) {
    const [s] = shots([p], sources, 1080, 1920, a);
    assert.equal(s.layers[0].source, p.keep === 0 ? "show-1" : "show-2");
    assert.deepEqual(s.layers[0].crop, [0, 0, 1, 1]);
    assert.deepEqual(s.layers[0].box, fit(a.tall, 1080 / 1920), "a tall video beside the circle, as a phone's screen");
    assert.ok(s.layers.some((l) => l.pip), "the circle");
    const [solo] = shots([{ ...p, pip: false }], sources, 1080, 1920, a);
    assert.ok(!solo.layers.some((l) => l.pip));
    assert.deepEqual(solo.layers[0].box, fit(a.whole, 1080 / 1920), "without the circle: the frame's height above the captions");
  }
});

// --------------------------------------------------------------------- the whole phone, the label
// A phone's screen shown whole without the circle takes the frame's height above the captions,
// under the apps' bar and buttons too. Made-up zones per frame (the skill takes the real ones from
// platform-zones); main's areas for them, pinned, so that every other shot keeps its numbers.
const ZONES = {
  "9:16": [1080, 1920, { safe: [50, 200, 880, 1300], margins: { top: 200, bottom: 420, left: 50, right: 150 }, wide: [50, 200, 980, 700] }],
  "4:5": [1080, 1350, { safe: [50, 50, 980, 1200], margins: { top: 50, bottom: 100, left: 50, right: 50 } }],
  "1:1": [1080, 1080, { safe: [50, 50, 980, 930], margins: { top: 50, bottom: 100, left: 50, right: 50 } }],
  "16:9": [1920, 1080, { safe: [100, 100, 1720, 830], margins: { top: 100, bottom: 150, left: 100, right: 100 } }],
};
const MAIN_AREAS = {"9:16":{"content":[[50,200,880,798],[0,200,1080,700]],"beside":[[312,200,618,1060]],"solo":[[50,200,880,1060],[0,200,1080,700]],"bleed":[0,0,1080,1260],"tall":[312,200,618,1060],"pip":[50,1022,238],"label":[50,200]},"9:16 labels":{"content":[[50,294,880,704],[0,294,1080,606]],"beside":[[312,294,618,966]],"solo":[[50,294,880,966],[0,294,1080,606]],"bleed":[0,0,1080,1260],"tall":[312,294,618,966],"pip":[50,1022,238],"label":[50,200]},"4:5":{"content":[[0,247,1080,763]],"solo":[[0,50,1080,960]],"bleed":[0,0,1080,1010],"tall":[50,247,980,763],"pip":[857,50,173],"label":[50,50]},"4:5 labels":{"content":[[0,247,1080,763]],"solo":[[0,144,1080,866]],"bleed":[0,0,1080,1010],"tall":[50,247,980,763],"pip":[857,50,173],"label":[50,50]},"1:1":{"content":[[0,247,1080,493]],"solo":[[0,50,1080,690]],"bleed":[0,0,1080,740],"tall":[50,247,980,493],"pip":[857,50,173],"label":[50,50]},"1:1 labels":{"content":[[0,247,1080,493]],"solo":[[0,144,1080,596]],"bleed":[0,0,1080,740],"tall":[50,247,980,493],"pip":[857,50,173],"label":[50,50]},"16:9":{"content":[[0,100,1920,676]],"solo":[[0,100,1920,676]],"bleed":[0,0,1920,776],"tall":[100,100,1480,676],"pip":[1604,100,216],"label":[100,100]},"16:9 labels":{"content":[[0,100,1920,676]],"solo":[[0,100,1920,676]],"bleed":[0,0,1920,776],"tall":[100,194,1480,582],"pip":[1604,100,216],"label":[100,100]}};
const PHONE = { width: 1170, height: 2532, offset: 0 };
const phonePiece = (extra = {}) => ({ view: "phone-screen", source: "phone-screen", start: 0, duration: 3, in: 0, out: 3, crop: [0, 0, 1, 1], pip: false, ...extra });
const round1 = (b) => b.map((v) => Math.round(v));

test("the whole phone without the circle takes the frame's height above the captions in 9:16, 4:5, 1:1 and 16:9 (gap to gap), centred, larger than in the safe box; every other area is main's", () => {
  // main's in the safe box's areas: 9:16 490 × 1060, 4:5 444 × 960, 1:1 319 × 690, 16:9 312 × 676
  const want = { "9:16": [254, 24, 571, 1236], "4:5": [312, 24, 456, 986], "1:1": [375, 24, 331, 716], "16:9": [786, 24, 347, 752] };
  for (const [f, [w, h, z]] of Object.entries(ZONES)) {
    const short = Math.min(w, h), gap = Math.round(short * 0.022);
    for (const labels of [false, true]) {
      const a = areas(w, h, z, { captions: true, labels });
      const { whole, wholeLabelled, ...rest } = a;
      assert.deepEqual(rest, MAIN_AREAS[`${f}${labels ? " labels" : ""}`], `${f}${labels ? " with labels" : ""}: main's areas`);
      assert.deepEqual(whole, [0, gap, w, a.bleed[3] - gap], `${f}: from a gap below the frame's top to a gap above the captions' band`);
      const top = z.safe[1] + Math.round(short * 0.065) + gap;
      assert.deepEqual(wholeLabelled, labels ? [0, top, w, a.bleed[3] - top] : whole, `${f}: below the label`);
    }
    const a = areas(w, h, z, { captions: true });
    const [s] = shots([phonePiece()], { "phone-screen": PHONE }, w, h, a);
    const box = round1(s.layers[0].box);
    assert.deepEqual(box, want[f], `${f}: the whole phone`);
    assert.ok(Math.abs(box[0] + box[2] / 2 - w / 2) <= 1, "centred across");
    const mainBox = fit([a.tall, ...a.solo], PHONE.width / PHONE.height);
    assert.ok(box[3] > mainBox[3], `${f}: ${box[3]} > ${mainBox[3]}`);
  }
});

test("every other shot keeps main's numbers: a screen with and without the circle, the whole screen, a phone with the circle, a zoomed phone, the face, in each frame with and without labels", () => {
  const MAIN = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "test-shots.main.json"), "utf8"));
  const sources = { "phone-screen": PHONE, webcam: { width: 1280, height: 720, offset: 0, face: [0.388, 0.202, 0.614, 0.685] }, screen: { width: 1920, height: 1080, offset: 0 } };
  const base = { start: 0, duration: 3, in: 0, out: 3 };
  const pieces = [
    { ...base, view: "screen", source: "screen", crop: [0.2, 0.2, 0.6, 0.5] },
    { ...base, view: "screen", source: "screen", crop: [0.2, 0.2, 0.6, 0.5], pip: false },
    { ...base, view: "screen", source: "screen", crop: [0, 0, 1, 1] },
    { ...base, view: "phone-screen", source: "phone-screen", crop: [0, 0, 1, 1] },
    { ...base, view: "phone-screen", source: "phone-screen", crop: [0, 0.1, 1, 0.9], pip: false },
    { ...base, view: "face", source: "webcam" },
  ];
  for (const [f, [w, h, z]] of Object.entries(ZONES)) for (const labels of [false, true]) {
    const key = `${f}${labels ? " labels" : ""}`;
    const got = shots(pieces, sources, w, h, areas(w, h, z, { captions: true, labels }), labels ? [{ text: "01 · A long step title", start: 0, duration: 3 }] : []).map((s) => s.layers);
    assert.deepEqual(JSON.parse(JSON.stringify(got)), MAIN[key], key);
  }
});

test("a label over the whole phone: where it would lie on the phone's screen the phone starts below it, as large as in the safe box (never smaller than main's); where it does not meet the phone (16:9), or no label is on, the phone keeps the frame's height", () => {
  for (const [f, [w, h, z]] of Object.entries(ZONES)) {
    const a = areas(w, h, z, { captions: true, labels: true });
    const label = { text: "01 · Upload", start: 0, duration: 3 };
    const [s] = shots([phonePiece()], { "phone-screen": PHONE }, w, h, a, [label]);
    const box = s.layers[0].box, size = Math.round(Math.min(w, h) * 0.036);
    const [lx, ly] = a.label, lw = label.text.length * size * 0.75 + 44, lh = size * 1.25 + 24;
    const meets = (b) => lx < b[0] + b[2] && b[0] < lx + lw && ly < b[1] + b[3] && b[1] < ly + lh;
    assert.ok(!meets(box), `${f}: the label clear of the phone (${round1(box)})`);
    // main's phone in a cut with labels: the safe box's areas, below the label
    const mainBox = fit([a.tall, ...a.solo], PHONE.width / PHONE.height);
    assert.ok(box[3] >= mainBox[3] - 0.01, `${f}: ${box[3]} ≥ main's ${mainBox[3]}`);
    const [free] = shots([phonePiece()], { "phone-screen": PHONE }, w, h, a, [{ ...label, start: 3, duration: 2 }]);
    assert.deepEqual(free.layers[0].box, fit(a.whole, PHONE.width / PHONE.height), `${f}: no label on: the frame's height`);
    if (f === "16:9") assert.deepEqual(box, free.layers[0].box, "16:9: the label in the corner does not meet the phone in the middle");
    else assert.ok(box[1] >= ly + lh, `${f}: below the label`);
  }
  // the same for another video shown whole without the circle ("show"), a tall one
  const [w, h, z] = ZONES["9:16"], a = areas(w, h, z, { captions: true, labels: true });
  const [s] = shots([{ ...phonePiece({ view: "screen", source: "screen" }), show: { source: "show-1", in: 0, until: 3 } }], { "show-1": PHONE, screen: { width: 1920, height: 1080, offset: 0 } }, w, h, a, [{ text: "01 · Upload", start: 0, duration: 3 }]);
  assert.deepEqual(s.layers[0].box, fit([a.tall, ...a.solo, a.wholeLabelled], PHONE.width / PHONE.height));
});

test("a whole phone under the apps' headers: the build's sentence names the px per app from the zones and what to do; none for a phone that gave way to a label or keeps the circle, none where the zones lay no header over the top", async () => {
  const { underHeaders, headerSentence } = await import("./lib/layout.mjs");
  // made-up zones as platform-zones answers them: two apps with headers of 180 and 140 px, one cover at the side
  const z = { ...ZONES["9:16"][2], platforms: [{ id: "app-a", name: "App A" }, { id: "app-b", name: "App B" }],
    covers: [{ platform: "app-a", box: [0, 0, 1080, 180] }, { platform: "app-b", box: [0, 0, 1080, 140] }, { platform: "app-b", box: [900, 800, 180, 1100] }] };
  const a = areas(1080, 1920, z, { captions: true, labels: true });
  const [whole] = shots([phonePiece()], { "phone-screen": PHONE }, 1080, 1920, a);
  const box = whole.layers[0].box;
  assert.equal(box[1], 24);
  const list = underHeaders(box, z);
  assert.deepEqual(list, [{ name: "App A", px: 156 }, { name: "App B", px: 116 }]);
  assert.equal(headerSentence(0, list, box[3]), `! keep 1: the top of the phone (1236 px high) lies under the apps' header: 156 px under the header of App A, 116 px under the header of App B (its status bar and the screen's top below it); where that top matters for these words, give the keep a "zoom" on the top of the screen, or leave out "circle": false so it stays in the safe box beside the circle.`);
  // a phone that gave way to a label starts below the label, under no header
  const [labelled] = shots([phonePiece()], { "phone-screen": PHONE }, 1080, 1920, a, [{ text: "01 · Upload", start: 0, duration: 3 }]);
  assert.deepEqual(underHeaders(labelled.layers[0].box, z), []);
  // with the circle, in the safe box: none
  const [circled] = shots([phonePiece({ pip: undefined })], { "phone-screen": PHONE, webcam: { width: 1280, height: 720, offset: 0 } }, 1080, 1920, a);
  assert.deepEqual(underHeaders(circled.layers[0].box, z), []);
  // a frame whose zones lay nothing over its top (made up here; YouTube's 16:9 zones do lay a bar there, and it is said)
  const [w, h, z16] = ZONES["16:9"], a16 = areas(w, h, { ...z16, covers: [{ platform: "app-a", box: [0, 900, 1920, 180] }] });
  const [wide] = shots([phonePiece()], { "phone-screen": PHONE }, w, h, a16);
  assert.deepEqual(underHeaders(wide.layers[0].box, { ...z16, covers: [{ platform: "app-a", box: [0, 900, 1920, 180] }] }), []);
});

test("show's sound is levelled when it is cut: a loud and a quiet clip both come to the voice's −14 LUFS before the curve, under 0 dBFS, and play through the voice's bus and its ceiling", { skip: !hasFfmpeg && "no ffmpeg on this machine" }, async () => {
  const { cutShownSound, levelGain } = await import("./lib/show.mjs");
  assert.equal(levelGain(-8, -14), -6);
  assert.equal(levelGain(-30, -14), 16);
  assert.equal(levelGain(-70, -14), 0, "silence is left as it is");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "show-sound-"));
  const measure = (file) => {
    const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
    const sum = r.stderr.slice(r.stderr.lastIndexOf("Summary:"));
    return { lufs: Number(sum.match(/I:\s*(-?[\d.]+) LUFS/)[1]), peak: Number(sum.match(/Peak:\s*(-?[\d.]+) dBFS/)[1]) };
  };
  try {
    for (const [name, amp] of [["loud", 0.9], ["quiet", 0.03]]) {
      const src = path.join(dir, `${name}.mp4`), out = path.join(dir, `${name}.m4a`);
      assert.equal(spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=64x64:d=6:r=30", "-f", "lavfi", "-i", `anoisesrc=d=6:c=pink:a=${amp}`, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", src]).status, 0);
      const before = measure(src);
      const r = cutShownSound(src, 1, 4, out, -14);
      assert.ok(r.ok, r.why);
      assert.ok(Math.abs(r.lufs - before.lufs) < 1.5, `${name}: measured ${r.lufs}, the file ${before.lufs}`);
      const after = measure(out);
      assert.ok(Math.abs(after.lufs + 14) < 1, `${name}: ${before.lufs} → ${after.lufs} LUFS`);
      assert.ok(after.peak < 0, `${name}: peak ${after.peak} dBFS`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  // the composition plays it through the voice's bus (high-pass, compressor, the −2 dB true-peak ceiling)
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "show-bus-"));
  try {
    const [w, h, z] = ZONES["9:16"];
    writeComposition(path.join(d2, "c"), { title: "t", width: w, height: h, fps: 30, pieces: [{ view: "screen", source: "screen", start: 0, duration: 4, in: 0, out: 4, crop: [0, 0, 1, 1], rate: 1 }], sources: { screen: { file: "s.mp4", width: 1920, height: 1080, offset: 0, path: fileURLToPath(import.meta.url) } }, dir: d2, voice: "voice.cut.m4a", inserts: [{ start: 0, duration: 4, sound: 0.8, spoken: 3, audio: "show-1.m4a" }], areas: areas(w, h, z) });
    const html = fs.readFileSync(path.join(d2, "c", "index.html"), "utf8");
    assert.match(html, /<audio id="show-sound-1"[^>]*data-audio-group="voice"/);
  } finally { fs.rmSync(d2, { recursive: true, force: true }); }
});

test("the shown file is converted as the recordings are at new: an HEVC clip with a varying frame rate and a place in its tags becomes H.264 at a steady rate without tags, kept between builds by its size and time; a file ffmpeg cannot convert gives one sentence", { skip: !hasFfmpeg && "no ffmpeg on this machine" }, async () => {
  const { shownVideo } = await import("./lib/show.mjs");
  // the option's name as the installed ffmpeg takes it (ffmpeg 9 takes -vsync no longer)
  const { steadyRate } = await import("./lib/media.mjs");
  const hevc = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout.includes("libx265");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "show-convert-"));
  try {
    const src = path.join(dir, "phone clip.mov");
    // frames 0.03 s apart, then 0.1 s apart: a varying rate, as a phone writes it
    assert.equal(spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x568:d=3:r=30", "-f", "lavfi", "-i", "sine=d=3",
      "-vf", "setpts='if(lt(N,30),N*0.03,0.9+(N-30)*0.1)/TB'", steadyRate()[0], "vfr", "-metadata", "location=+52.5200+013.4050/",
      "-c:v", hevc ? "libx265" : "libx264", ...(hevc ? ["-x265-params", "log-level=error", "-tag:v", "hvc1"] : []), "-pix_fmt", "yuv420p", "-c:a", "aac", src]).status, 0);
    const streams = (f) => JSON.parse(spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", f], { encoding: "utf8" }).stdout);
    const before = streams(src);
    if (hevc) assert.equal(before.streams[0].codec_name, "hevc");
    assert.ok(before.format.tags?.location, "the place is in the source's tags");
    assert.notEqual(before.streams.find((x) => x.codec_type === "video").avg_frame_rate, "30/1", "the source's rate varies");
    const v = await shownVideo(dir, src, 30);
    assert.ok(v.info, v.why);
    const after = streams(v.info.path), video = after.streams.find((x) => x.codec_type === "video");
    assert.equal(video.codec_name, "h264");
    assert.equal(video.r_frame_rate, "30/1");
    assert.equal(video.avg_frame_rate, "30/1", "a steady rate");
    assert.ok(!after.format.tags?.location && !JSON.stringify(after).includes("52.5200"), "no place in the copy");
    assert.ok(v.info.path.startsWith(path.join(dir, "source", "shown")));
    // kept: the second build takes the copy as it is; a changed file (another size or time) is converted anew
    const mtime = fs.statSync(v.info.path).mtimeMs;
    const again = await shownVideo(dir, src, 30);
    assert.equal(again.info.path, v.info.path);
    assert.equal(fs.statSync(again.info.path).mtimeMs, mtime);
    fs.utimesSync(src, new Date(), new Date(Date.now() + 5000));
    assert.notEqual((await shownVideo(dir, src, 30)).info.path, v.info.path);
    // a file ffmpeg cannot read as a video
    const bad = path.join(dir, "broken.mp4");
    fs.writeFileSync(bad, Buffer.alloc(4096, 7));
    const said = await shownVideo(dir, bad, 30).catch((e) => ({ why: `threw: ${e.message}` }));
    assert.match(said.why, /^ffmpeg cannot convert .*broken\.mp4 into a video the preview plays \(.+\); give it as MP4 \(H\.264\), the result as it was posted or rendered\.$/);
    if (!hevc) console.log("# this machine's ffmpeg has no HEVC encoder: tried with an H.264 clip of a varying rate");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------------- the screen's picture
// A screen keep (whole, or a "zoom" box) asks the layout skill (lib/screenview.mjs): the picture as
// before stays where it passes (its region inside the safe box across, the circle and the label off
// it, its text read where "text" says how tall), else layout's first; the build never stops for it.
import { beforePicture, judge, choose, textSentence, placeScreen, screenView, regionPx, freeCorner, shiftedInside, BEFORE } from "./lib/screenview.mjs";

const SZ = { safe: [60, 250, 828, 1190], wide: [60, 250, 960, 590], margins: { top: 250, bottom: 480, left: 60, right: 192 },
  covers: [{ platform: "tiktok", box: [0, 0, 1080, 150] }, { platform: "tiktok", box: [900, 840, 180, 1080] }], platforms: [{ id: "tiktok", name: "TikTok" }] };
const DESK = { width: 2560, height: 1440, offset: 0, video: true };
const judged = (pic, o = {}) => Object.assign(pic, { j: judge(pic, { zones: SZ, width: 1080, height: 1920, ...o }) });

test("a screen's picture as before is judged: its region past the safe box's margins across, the circle or a label on it, under an app's bar, its text under the height that reads", () => {
  const a = areas(1080, 1920, SZ, { captions: true });
  // a wide zoom box fills the frame's width as before (x 0–1080): past the margins
  const flat = beforePicture([0.05, 0.04, 0.95, 0.08], DESK, a, true);
  assert.deepEqual(flat.region.map(Math.round).filter((_, i) => i % 2 === 0), [0, 1080]);
  assert.deepEqual(judge(flat, { zones: SZ, width: 1080, height: 1920 }).faults.map((f) => f.code), ["across"]);
  // the card (474 × 254 of 2560 × 1440) inside the safe box at 2×: nothing at fault but a text of 10 px (20 px here, under 24)
  const card = beforePicture([0.536, 0.398, 0.722, 0.575], DESK, a, true);
  assert.equal(card.scale, 2);
  const j = judge(card, { zones: SZ, width: 1080, height: 1920, text: 10, readable: 24 });
  assert.deepEqual(j.faults.map((f) => f.code), ["text"]);
  assert.equal(j.textHeight, 20);
  assert.ok(j.ground > 0 && j.ground < 1);
  // the circle and a label on the region, the region under a bar
  const pic = { scale: 1, window: [0, 0, 1080, 900], region: [100, 100, 780, 800], circle: [80, 700, 238] };
  assert.deepEqual(judge(pic, { zones: SZ, labels: [[60, 250, 300, 70]], width: 1080, height: 1920 }).faults.map((f) => f.code), ["circle", "label", "bars"]);
  assert.deepEqual(judge(pic, { zones: SZ, width: 1080, height: 1920 }).under, ["TikTok"]);
  // inside the wide stretch above the buttons (x 60–1020) passes across
  assert.deepEqual(judge({ scale: 1, window: [0, 0, 1080, 900], region: [60, 300, 960, 400] }, { zones: SZ, width: 1080, height: 1920 }).faults, []);
  assert.deepEqual(regionPx([0.3, 0.1, 0.9, 0.6], { width: 1920, height: 1080 }), [576, 108, 1152, 540]);
});

test("which picture: as before where it passes; else layout's first it draws, off the label; as before where only its text is too small and layout's is no larger, or where layout's all have the label on them; a name the keep gives", () => {
  const before = judged({ fit: BEFORE, scale: 0.8, window: [0, 300, 1080, 600], region: [0, 300, 1080, 120] });
  const fit = judged({ fit: "screen-fit", scale: 0.71, window: [0, 300, 1080, 600], region: [60, 300, 960, 110], mark: "!", hard: 0 });
  const whole = judged({ fit: "screen-whole", scale: 0.4, window: [0, 400, 1080, 600], region: [100, 400, 500, 60], mark: "✓", hard: 0 });
  const bad = judged({ fit: "screen-zoom", scale: 2, window: [0, 0, 1080, 900], region: [100, 100, 800, 800], mark: "✗", hard: 1 });
  // as before at fault (across): the first that is not ✗; the whole screen never answers a zoom box
  assert.equal(choose(before, [bad, fit, whole], { zoomed: true }).pic, fit);
  assert.equal(choose(before, [whole], { zoomed: true }).pic, before);
  assert.equal(choose(before, [whole], { zoomed: false }).pic, whole);
  // as before passes: it stays
  const good = judged({ fit: BEFORE, scale: 1.2, window: [0, 300, 1080, 600], region: [100, 300, 800, 300] });
  assert.equal(choose(good, [fit, whole]).pic, good);
  // only its text too small, layout's no larger: it stays, said why
  const small = judged({ fit: BEFORE, scale: 1.2, window: [0, 300, 1080, 600], region: [100, 300, 800, 300] }, { text: 12, readable: 24 });
  const got = choose(small, [judged({ ...fit, scale: 1.1 }, { text: 12, readable: 24 })], { text: 12, zoomed: true });
  assert.equal(got.pic, small); assert.match(got.why, /no other picture removes a fault without adding one \(screen-fit at 1\.1×: text 13\.2 px\)/);
  // layout's picture with the label on its region: as before stays when only its margins are at fault
  const onLabel = judged({ ...fit }, { labels: [[60, 300, 300, 70]] });
  assert.match(choose(before, [onLabel], { zoomed: true }).why, /label on the region/);
  // a picture that removes one fault but adds another is not taken either (it was, until the
  // first review: the circle off the region bought with the label on it)
  const circled = judged({ ...before, circle: [100, 300, 238] });
  assert.equal(choose(circled, [onLabel], { zoomed: true }).pic, circled);
  // a name: layout's candidate, "as before", or one this frame lacks (the rule's, said)
  assert.equal(choose(before, [fit, whole], { asked: "screen-whole", zoomed: true }).pic, whole);
  assert.equal(choose(before, [fit], { asked: BEFORE }).pic, before);
  const missing = choose(before, [fit], { asked: "screen-stacked", zoomed: true });
  assert.equal(missing.pic, fit); assert.equal(missing.missing, "screen-stacked");
});

test("the sentence about the screen's text: without \"text\" the plain fact and what to do, claiming nothing; with it the height here and whether it reads", () => {
  assert.equal(textSentence({ scale: 0.375 }, { readable: 24 }), `the screen at 0.38×: a line 18 px tall on the screen is 6.8 px here, and a capital reads here from 64 px tall on the screen; where its text is smaller, zoom on what is talked about, and say how tall its smallest text is with "text" (px of a capital, off the sheet's grid) to have it checked`);
  assert.doesNotMatch(textSentence({ scale: 2 }, { readable: 24 }), /reads \(|under the/);
  assert.equal(textSentence({ scale: 1.5 }, { text: 12, readable: 24, narrower: "at most 414×300 px of the screen" }), `the screen at 1.5×: its text (12 px on the screen, "text") is 18 px tall here, under the 24 px from which text begins to read: for it to read surely, give a narrower "zoom" on what is talked about (at most 414×300 px of the screen reads), or split the keep where the words move on`);
  assert.equal(textSentence({ scale: 2 }, { text: 12, readable: 24 }), `the screen at 2×: its text (12 px on the screen, "text") is 24 px tall here, it reads (from 24 px)`);
});

// a project for screenView: the 2560 desktop's keeps, the webcam's circle
const screenProject = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "screen-view-"));
  const sources = { screen: { ...DESK, file: "screen.mp4" }, webcam: { width: 1280, height: 720, offset: 0, video: true, face: [0.388, 0.202, 0.614, 0.685] }, "phone-screen": { ...PHONE, video: true } };
  const piece = (keep, view, crop, extra = {}) => ({ keep, view, source: view === "face" ? "webcam" : view, start: keep * 3, duration: 3, in: keep * 3, out: keep * 3 + 3, crop, ...extra });
  return { dir, sources, piece };
};

test("a screen keep whose layout skill is missing, fails, runs over its time or answers nonsense is drawn as before, with one sentence; the build goes on", () => {
  const { dir, sources, piece } = screenProject();
  try {
    const a = areas(1080, 1920, SZ, { captions: true });
    const cut = { keep: [{ zoom: [0.05, 0.04, 0.95, 0.08] }] };
    const fails = path.join(dir, "fails.mjs"), hangs = path.join(dir, "hangs.mjs"), junk = path.join(dir, "junk.mjs"), empty = path.join(dir, "empty.mjs");
    fs.writeFileSync(fails, "console.error('The box reaches past the source.'); process.exit(1);");
    fs.writeFileSync(hangs, "setTimeout(() => {}, 60000);");
    fs.writeFileSync(junk, "console.log('not json');");
    fs.writeFileSync(empty, "console.log(JSON.stringify({ candidates: [{ fit: 'screen-stacked', parts: [] }] }));");
    for (const [tool, want] of [[null, /as before, because the layout skill is missing/], [fails, /as before, because layout's place gave no candidates for it \(its words in .*place\.log\)/],
      [hangs, /as before, because layout's place ran over 1 s for it and was stopped/], [junk, /as before, because the placement stopped/], [empty, /as before, because layout's place gave no picture to draw for it/]]) {
      const ps = [piece(0, "screen", [0.05, 0.04, 0.95, 0.08])];
      const said = screenView(dir, cut, ps, sources, { width: 1080, height: 1920, zones: SZ, areas: a, tool, timeout: 1 }).join("\n");
      assert.match(said, want, String(tool));
      assert.equal(ps[0].screenPic, undefined, "drawn as before");
      assert.equal(ps[0].screen.fit, BEFORE);
      assert.match(said, /a line 18 px tall on the screen is \d/);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("with the layout skill: a zoom box that fills the width as before is drawn as layout places it (inside the margins, the circle off it); a card that passes stays as before; \"text\" asks layout and is said; face, phone and \"show\" pieces are left alone", { skip: !LAYOUT && "no layout skill beside this one" }, () => {
  const { dir, sources, piece } = screenProject();
  try {
    const z = SZ, a = areas(1080, 1920, z, { captions: true });
    fs.writeFileSync(path.join(dir, "area.json"), JSON.stringify(BANDS["1080x1920"]));
    const cut = { keep: [{ zoom: [0.05, 0.04, 0.95, 0.08] }, { zoom: [0.536, 0.398, 0.722, 0.575] }, { zoom: [0.536, 0.398, 0.722, 0.575], text: 12 }, { view: "face" }, { view: "phone-screen" }, { show: {} }, { zoom: [0.05, 0.04, 0.95, 0.08], layout: "as before" }] };
    const ps = [piece(0, "screen", cut.keep[0].zoom), piece(1, "screen", cut.keep[1].zoom), piece(2, "screen", cut.keep[2].zoom), piece(3, "face", null), piece(4, "phone-screen", [0, 0, 1, 1]), piece(5, "screen", [0, 0, 1, 1], { show: { source: "x" } }), piece(6, "screen", cut.keep[6].zoom)];
    const said = screenView(dir, cut, ps, sources, { width: 1080, height: 1920, zones: z, areas: a, area: path.join(dir, "area.json") }).join("\n");
    // keep 1: layout's, its region inside x 60–1020, the circle off it; the line says what was wrong as before
    const p0 = ps[0].screenPic;
    assert.ok(p0 && /^screen-(fit|zoom)$/.test(p0.fit), said);
    assert.ok(p0.region[0] >= 59.5 && p0.region[0] + p0.region[2] <= 1020.5, JSON.stringify(p0.region));
    assert.match(said, /keep 1 \([^)]*\): [✓!] screen-(fit|zoom) at [\d.]+× \(the layout skill's\).*; as before \([\d.]+×\) its region runs x 0–1080, past the safe box's margins/);
    // keep 2 passes as before; keep 3 says its text's height and asks layout with --min-text-height
    assert.equal(ps[1].screenPic, undefined); assert.equal(ps[1].screen.fit, BEFORE);
    assert.match(said, /keep 3 [^\n]*\n[^\n]*\n?.*its text \(12 px on the screen, "text"\) is [\d.]+ px tall here/);
    assert.equal(ps[2].screen.text, 12); assert.equal(ps[2].screen.readable, 24);
    const asked = JSON.parse(fs.readFileSync(path.join(dir, "placement", "screen-3", "placement.json"), "utf8"));
    assert.equal(asked.screen.minTextHeight, 12);
    // the keep that names "as before" keeps it, at fault and said
    assert.equal(ps[6].screenPic, undefined); assert.match(said, /keep 7 \([^)]*\): as before, as the keep names it/);
    // face, phone and shown pieces: nothing set
    for (const p of ps.slice(3, 6)) assert.ok(p.screen === undefined && p.screenPic === undefined, JSON.stringify(p));
    // drawn: the screen at layout's scale, clipped to its window; the circle at layout's place
    const [s0] = shots([ps[0]], sources, 1080, 1920, a);
    assert.deepEqual(s0.layers[0].at, { ...geometry(p0, sources.screen), box: p0.window });
    assert.deepEqual(s0.layers[1].box, [p0.circle[0], p0.circle[1], p0.circle[2], p0.circle[2]]);
    // as before: exactly main's layers
    const [s1] = shots([ps[1]], sources, 1080, 1920, a), [m1] = shots([{ ...ps[1], screen: undefined }], sources, 1080, 1920, a);
    assert.deepEqual(s1.layers, m1.layers);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the circle moves before the picture does (pair screen-circle-169): the picture as before, moved across by as little as brings its region inside the margins, the circle in the first free corner; none free (or a label there): not moved", () => {
  // the public test's slide in 16:9 (keep 4 of pub-lean-169): the right column at 1.21×, the circle top right on its links
  const z = { safe: [96, 108, 1728, 822], wide: null, margins: { left: 96, right: 96 }, covers: [], platforms: [] };
  const a = areas(1920, 1080, z, { captions: true, labels: true }), src = { width: 1920, height: 1080 };
  const b = beforePicture([0.6, 0.15, 0.97, 0.66], src, a, true), opts = { zones: z, width: 1920, height: 1080 };
  assert.deepEqual(judge(b, opts).faults.map((f) => f.code), ["across", "circle"]);
  const i = shiftedInside(b, src, z, a, 1920);
  assert.equal(i.scale, b.scale);
  assert.ok(i.region[0] + i.region[2] <= 1824.5 && Math.abs(i.left - b.left) < 30, JSON.stringify(i));
  assert.deepEqual(judge(i, opts).faults.map((f) => f.code), ["circle"]);
  assert.deepEqual(freeCorner(i, { zones: z, areas: a, width: 1920, height: 1080 }), { circle: [96, 108, 216], corner: "top left" });
  // a label in the top left corner and the region over the bottom ones: no corner is free
  const wide = { ...i, region: [96, 300, 1728, 600] };
  assert.equal(freeCorner(wide, { zones: z, areas: a, labels: [[96, 108, 300, 70]], width: 1920, height: 1080 }), null);
  // choose takes the moved picture before layout's
  const moved = Object.assign({ ...i, fit: "as before, inside the margins, the circle top left", circle: [96, 108, 216] }, {}); moved.j = judge(moved, opts);
  const before = Object.assign(b, { j: judge(b, opts) }), fit = { fit: "screen-fit", scale: 1.16, window: [0, 0, 1319, 748], region: [427, 108, 826, 640], circle: [1608, 108, 216], mark: "✓", hard: 0 };
  fit.j = judge(fit, opts);
  assert.equal(choose(before, [fit], { zoomed: true, own: [moved] }).pic, moved);
  assert.equal(choose(before, [fit], { zoomed: true }).pic, fit);
  assert.equal(choose(before, [fit], { zoomed: true, own: [moved], asked: "screen-fit" }).pic, fit);
});

test("a moved circle alone keeps the screen exactly as before; only the circle's place changes", () => {
  const z = { safe: [96, 108, 1728, 822], wide: null, margins: { left: 96, right: 96 }, covers: [], platforms: [] };
  const a = areas(1920, 1080, z, { captions: true }), sources = { screen: { width: 1920, height: 1080, offset: 0 }, webcam: { width: 1280, height: 720, offset: 0, face: [0.388, 0.202, 0.614, 0.685] } };
  const p = { view: "screen", source: "screen", start: 0, duration: 2, in: 0, out: 2, crop: [0.3, 0.2, 0.7, 0.6] };
  const b = beforePicture(p.crop, sources.screen, a, true);
  const [main] = shots([p], sources, 1920, 1080, a), [moved] = shots([{ ...p, screenPic: { ...b, fit: "as before, the circle top left", circle: [96, 108, 216], circleOnly: true } }], sources, 1920, 1080, a);
  assert.deepEqual(moved.layers[0], main.layers[0]);
  assert.deepEqual(moved.layers[1].box, [96, 108, 216, 216]);
});

test("a zoom box under the circle with no free corner and every candidate of layout failing stays as before, and the list says so with what to do", () => {
  const { dir, sources, piece } = screenProject();
  try {
    const z = { safe: [96, 108, 1728, 822], wide: null, margins: { left: 96, right: 96 }, covers: [], platforms: [] };
    const a = areas(1920, 1080, z, { captions: true });
    const tool = path.join(dir, "fails-all.mjs");
    fs.writeFileSync(tool, `console.log(JSON.stringify({ screen: { readable: 42.7 }, notes: [], candidates: [{ fit: "screen-fit", scale: 2.96, left: 0, top: 0, window: [0, 0, 1920, 776], faceInFrame: [[100, 100, 800, 600]], hard: 1, unmet: [], soft: 0 }] }));`);
    const cut = { keep: [{ zoom: [0.05, 0.1, 0.95, 0.9] }] };
    const ps = [piece(0, "screen", cut.keep[0].zoom)];
    const said = screenView(dir, cut, ps, sources, { width: 1920, height: 1080, zones: z, areas: a, tool }).join("\n");
    assert.equal(ps[0].screenPic, undefined, said);
    assert.match(said, /the webcam's circle lies on its region/);
    assert.match(said, /! the circle lies on the region for these words: name a wider "zoom", or leave the circle out for them \("circle": false\)/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------- the first review of the screen's picture
// Its inputs, as numbers (/tmp/screen-review of 2026-11-19): what the build does with each.
import { zones as realZones } from "./lib/zones.mjs";
const frameOf = (width, height, { labels = false } = {}) => {
  const z = realZones(width, height, []), [sx, sy, sw, sh] = z.safe;
  return { z, a: areas(width, height, z, { captions: true, labels }), band: { left: sx, width: sw, top: sy + sh - 158, bottom: sy + sh, size: 52, lines: 2 } };
};
const CAM16 = { width: 1280, height: 720, offset: 0, video: true, face: [0.388, 0.202, 0.614, 0.685] };
// one screen keep through screenView with the layout skill beside: its piece, what it said, its circle as drawn
function oneKeep({ width, height, screen, crop, text = 0, label = null, segments = null, pip = true, tool, line = null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "screen-review-"));
  try {
    const f = frameOf(width, height, { labels: !!label }), z = f.z;
    // line: one caption line as captions built it (area.json), else the band for two lines as on main
    const band = line || f.band, a = line ? areas(width, height, z, { captions: true, labels: !!label, line }) : f.a;
    const area = path.join(dir, "area.json");
    fs.writeFileSync(area, JSON.stringify(band));
    const sources = { screen: { width: screen[0], height: screen[1], offset: 0, video: true }, ...(pip ? { webcam: CAM16 } : {}) };
    const p = { keep: 0, view: "screen", source: "screen", start: 0, duration: 4, in: 0, out: 4, crop, ...(segments ? { segments } : {}) };
    const labels = label ? [{ text: label, start: 0, duration: 4 }] : [];
    const said = screenView(dir, { keep: [{ zoom: crop, ...(text ? { text } : {}) }] }, [p], sources, { width, height, zones: z, areas: a, labels, area, ...(tool !== undefined ? { tool } : {}) }).join("\n");
    const [shot] = shots([p], sources, width, height, a, labels);
    return { p, said, a, shot, circles: shot.layers.filter((l) => l.pip), main: shot.layers.filter((l) => l.main) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("review 1: a keep split at a scene change draws each part's circle where its list says, over its part's time (16:9, 1920×1080, the parts [0.75,0.05,0.98,0.3] and [0.02,0.05,0.25,0.3], either order); one circle where the parts agree", () => {
  const z = { safe: [96, 108, 1728, 822], wide: null, margins: { left: 96, right: 96 }, covers: [], platforms: [] };
  const a = areas(1920, 1080, z, { captions: true }), sources = { screen: { width: 1920, height: 1080, offset: 0 }, webcam: CAM16 };
  const A = [0.75, 0.05, 0.98, 0.3], B = [0.02, 0.05, 0.25, 0.3];
  // what screenView sets on the parts: the first part's circle moved to the top left, the second as before
  const moved = { ...beforePicture(A, sources.screen, a, true), fit: "as before, the circle top left", circle: [96, 108, 216], circleOnly: true };
  for (const [one, two] of [[A, B], [B, A]]) {
    const segments = [{ in: 0, out: 2, crop: one, ...(one === A ? { screenPic: moved } : {}) }, { in: 2, out: 4, crop: two, ...(two === A ? { screenPic: moved } : {}) }];
    const p = { keep: 0, view: "screen", source: "screen", start: 0, duration: 4, in: 0, out: 4, rate: 1, crop: one, segments };
    const [s] = shots([p], sources, 1920, 1080, a);
    const circles = s.layers.filter((l) => l.pip).map((l) => [l.box[0], l.start, l.duration, l.in]);
    assert.deepEqual(circles, one === A ? [[96, 0, 2, 0], [1608, 2, 2, 2]] : [[1608, 0, 2, 0], [96, 2, 2, 2]]);
  }
  // parts whose circles agree: one circle for the piece, untimed, as on main
  const p = { keep: 0, view: "screen", source: "screen", start: 0, duration: 4, in: 0, out: 4, crop: B, segments: [{ in: 0, out: 2, crop: B }, { in: 2, out: 4, crop: [0.02, 0.4, 0.25, 0.65] }] };
  const [s] = shots([p], sources, 1920, 1080, a);
  assert.deepEqual(s.layers.filter((l) => l.pip).map((l) => [l.box, l.start]), [[[1608, 108, 216, 216], undefined]]);
});

test("review 1, with the layout skill: the split keep's list and its drawing agree on each part's circle", { skip: !LAYOUT && "no layout skill beside this one" }, () => {
  const A = [0.75, 0.05, 0.98, 0.3], B = [0.02, 0.05, 0.25, 0.3];
  for (const [one, two] of [[A, B], [B, A]]) {
    const r = oneKeep({ width: 1920, height: 1080, screen: [1920, 1080], crop: one, segments: [{ in: 0, out: 2, crop: one }, { in: 2, out: 4, crop: two }] });
    const want = r.p.segments.map((g) => (g.screenPic?.circle || r.a.pip)[0]);
    assert.deepEqual(r.circles.map((l) => l.box[0]), want, r.said);
    assert.deepEqual(want, one === A ? [96, 1608] : [1608, 96]);
    // no circle lies on its part's region
    r.p.segments.forEach((g, i) => { const reg = (g.screenPic || beforePicture(g.crop, { width: 1920, height: 1080 }, r.a, true)).region, c = r.circles[i].box;
      assert.ok(!(c[0] < reg[0] + reg[2] && reg[0] < c[0] + c[2] && c[1] < reg[1] + reg[3] && reg[1] < c[1] + c[3]), `part ${i + 1}: ${JSON.stringify([c, reg])}`); });
  }
});

test("review 2: a picture of the layout skill's that removes no fault, or adds one, is not taken: 16:9, zoom [0.3,0.3,0.7,0.7] with a label, the screen 1920×1080 (1.55× against 1.48×) and 3440×1440 (1.16× against 1.11×) stay as before, said", { skip: !LAYOUT && "no layout skill beside this one" }, () => {
  for (const [screen, scale] of [[[1920, 1080], 1.55], [[3440, 1440], 1.16]]) {
    const r = oneKeep({ width: 1920, height: 1080, screen, crop: [0.3, 0.3, 0.7, 0.7], label: "Settings page" });
    assert.equal(r.p.screenPic, undefined, r.said);
    assert.equal(r.p.screen.fit, BEFORE); assert.equal(r.p.screen.scale, scale);
    assert.match(r.said, /the label lies on its region \(it stays: no other picture removes a fault without adding one \(screen-fit at [\d.]+×: [^)]*the label on the region\)\)/);
  }
  // and in numbers: before has the label on its region; layout's has it too and is smaller
  const before = judged({ fit: BEFORE, scale: 1.55, window: [0, 0, 1080, 900], region: [100, 300, 800, 300] }, { labels: [[60, 250, 400, 80]] });
  const fit = judged({ fit: "screen-fit", scale: 1.48, window: [0, 0, 1080, 900], region: [100, 300, 760, 290], mark: "✓", hard: 0 }, { labels: [[60, 250, 400, 80]] });
  assert.equal(choose(before, [fit], { zoomed: true }).pic, before);
});

test("review 3: nonsense from the layout skill (null, a candidate with circle {}, a negative scale, a window of strings) draws the keep as before with one sentence, never stops the build", () => {
  const { dir, sources, piece } = screenProject();
  try {
    const a = areas(1080, 1920, SZ, { captions: true });
    const tools = { null: "console.log('null');", array: "console.log('[1,2]');",
      circle: "console.log(JSON.stringify({ candidates: [{ fit: 'screen-fit', scale: 1, left: 0, top: 0, window: [0, 0, 1080, 900], faceInFrame: [[100, 100, 500, 300]], circle: {} }] }));",
      negative: "console.log(JSON.stringify({ candidates: [{ fit: 'screen-fit', scale: -3, left: 0, top: 0, window: [0, 0, 1080, 900], faceInFrame: [[100, 100, 500, 300]] }] }));",
      strings: "console.log(JSON.stringify({ screen: { readable: 'x' }, notes: 'x', candidates: [{ fit: 'screen-fit', scale: 1, left: 0, top: 0, window: ['a', 0, 1080, 900], faceInFrame: [[100, 100, 500, 300]] }] }));" };
    for (const [name, code] of Object.entries(tools)) {
      const tool = path.join(dir, `${name}.mjs`);
      fs.writeFileSync(tool, code);
      const ps = [piece(0, "screen", [0.02, 0.45, 0.98, 0.5])];
      const said = screenView(dir, { keep: [{ zoom: ps[0].crop }] }, ps, sources, { width: 1080, height: 1920, zones: SZ, areas: a, tool });
      const line = said[1];
      assert.match(line, name === "circle" ? /^  keep 1 \([^)]*\): as before( at 0\.44×|, because layout's place gave no picture to draw for it)/ : /^  keep 1 \([^)]*\): as before, because layout's place (answered no placement|gave no picture to draw) for it/, `${name}: ${line}`);
      assert.equal(ps[0].screenPic, undefined, name);
      shots(ps, sources, 1080, 1920, a);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

import { seat } from "./lib/screenview.mjs";
test("review 4 (circle-still): the circle keeps main's place and size in every keep where that place is off the region; layout's picture is drawn with it there (9:16: y 962, not layout's 1020); it moves only off the region, at main's size, and the list names only a move", () => {
  const z = SZ, a = areas(1080, 1920, z, { captions: true });
  const env = { zones: z, areas: a, width: 1080, height: 1920 };
  // layout's screen-fit for the wide strip, its own circle 58 px lower: drawn with main's circle
  const fit = { fit: "screen-fit", scale: 0.55, left: -6, top: 334, window: [0, 334, 1080, 600], region: [60, 363, 960, 35], circle: [60, 1020, 238] };
  assert.deepEqual(seat(fit, a.pip, env).circle, [60, 962, 238]);
  assert.equal(seat(fit, a.pip, env).corner, undefined);
  // 16:9: layout's smaller circle (172 px) is not taken; where main's lies on the region it moves at 216 px
  const z16 = { safe: [96, 108, 1728, 822], wide: null, margins: { left: 96, right: 96 }, covers: [], platforms: [] }, a16 = areas(1920, 1080, z16, { captions: true });
  const on = seat({ region: [1100, 150, 700, 400], circle: [1652, 108, 172] }, a16.pip, { ...env, zones: z16, areas: a16, width: 1920, height: 1080 });
  assert.deepEqual([on.circle, on.corner], [[96, 108, 216], "top left"]);
  // the circle on a label moves too; without the circle there is none
  const lab = seat({ region: [100, 500, 600, 200] }, a16.pip, { ...env, zones: z16, areas: a16, width: 1920, height: 1080, labels: [[96, 108, 1600, 70]] });
  assert.equal(lab.corner, "bottom right");
  assert.equal(seat(fit, null, env).circle, null);
});

test("review 4, with the layout skill: 9:16, 16:9, 4:5 and 1:1 keeps drawn with layout's picture keep main's circle (place where it is off the region, size always), the list names the circle only where it moved", { skip: !LAYOUT && "no layout skill beside this one" }, () => {
  for (const [width, height, screen, crop] of [[1080, 1920, [1920, 1080], [0.046, 0.052, 0.954, 0.111]], [1080, 1920, [3440, 1440], [0.395, 0.395, 0.541, 0.579]], [1920, 1080, [2560, 1440], [0.046, 0.038, 0.954, 0.085]], [1080, 1350, [2560, 1440], [0, 0, 1, 1]], [1080, 1080, [2560, 1440], [0.046, 0.038, 0.954, 0.085]]]) {
    const r = oneKeep({ width, height, screen, crop, text: crop[0] === 0.395 ? 12 : 0 });
    const c = r.circles[0].box, pic = r.p.screenPic;
    assert.ok(pic && /^screen-/.test(pic.fit), `${width}×${height} ${crop}: ${r.said}`);
    assert.equal(c[2], r.a.pip[2], "main's size");
    if (pic.corner) assert.match(r.said, new RegExp(`the circle moved to the ${pic.corner} \\(x ${Math.round(c[0])}, y ${Math.round(c[1])}\\)`));
    else { assert.deepEqual(c.slice(0, 2), r.a.pip.slice(0, 2), "main's place"); assert.doesNotMatch(r.said.split("\n")[1], /circle/); }
  }
});

test("review 5: a shift before a shrink: 1280×720 corner zooms in 16:9, past the margins at 2×, are drawn as before at 2× moved inside them (the circle off the region); a region wider than the safe box is not shifted", { skip: !LAYOUT && "no layout skill beside this one" }, () => {
  for (const [zn, crop, dx] of [["tl", [0, 0, 0.3, 0.3], 96], ["tr", [0.7, 0, 1, 0.3], -96], ["bl", [0, 0.7, 0.3, 1], 96], ["br", [0.7, 0.7, 1, 1], -96]]) {
    const r = oneKeep({ width: 1920, height: 1080, screen: [1280, 720], crop });
    const pic = r.p.screenPic;
    assert.ok(pic && pic.fit.startsWith("as before, inside the margins"), `${zn}: ${r.said}`);
    assert.equal(pic.scale, 2); assert.equal(pic.shift, dx);
    assert.ok(pic.region[0] >= 95.5 && pic.region[0] + pic.region[2] <= 1824.5, JSON.stringify(pic.region));
    assert.match(r.said, new RegExp(`as before, moved 96 px ${dx < 0 ? "left" : "right"} to hold the region inside the safe box's margins, at 2×`));
    assert.deepEqual(r.main[0].at, { ...geometry(pic, { width: 1280, height: 720 }), box: pic.window });
  }
  const z = { safe: [96, 108, 1728, 822], wide: null, margins: { left: 96, right: 96 }, covers: [], platforms: [] }, a = areas(1920, 1080, z, { captions: true });
  assert.equal(shiftedInside({ region: [0, 100, 1800, 100], left: 0, top: 0, scale: 1, window: [0, 0, 1920, 776] }, { width: 1920, height: 1080 }, z, a, 1920), null);
  assert.equal(shiftedInside({ region: [200, 100, 800, 100], left: 0, top: 0, scale: 1, window: [0, 0, 1920, 776] }, { width: 1920, height: 1080 }, z, a, 1920), null);
});

test("review 6: a \"text\" fault does not keep the circle on the region (16:9, zoom [0.75,0.05,0.98,0.3], text 12: the circle top left, as without text); without the layout skill the text's height is given, not null; the placement's folder is named by the keep", { skip: !LAYOUT && "no layout skill beside this one" }, () => {
  for (const text of [0, 12]) {
    const r = oneKeep({ width: 1920, height: 1080, screen: [1920, 1080], crop: [0.75, 0.05, 0.98, 0.3], text });
    assert.deepEqual(r.circles[0].box, [96, 108, 216, 216], `text ${text}: ${r.said}`);
    assert.ok(!r.p.screen.faults.includes("circle"));
  }
  const none = oneKeep({ width: 1920, height: 1080, screen: [1920, 1080], crop: [0.75, 0.05, 0.98, 0.3], text: 12, tool: null });
  assert.equal(none.p.screen.textHeight, 24); assert.equal(none.p.screen.readable, undefined);
  // keep 2 (the only screen keep) asks layout in placement/screen-2, its second picture in screen-2-2
  const { dir, sources, piece } = screenProject();
  try {
    const a = areas(1080, 1920, SZ, { captions: true });
    const ps = [{ ...piece(1, "screen", [0.05, 0.04, 0.95, 0.08]), segments: [{ in: 3, out: 4, crop: [0.05, 0.04, 0.95, 0.08] }, { in: 4, out: 6, crop: [0.536, 0.398, 0.722, 0.575] }] }];
    const said = screenView(dir, { keep: [{ view: "face" }, {}] }, ps, sources, { width: 1080, height: 1920, zones: SZ, areas: a }).join("\n");
    assert.ok(fs.existsSync(path.join(dir, "placement", "screen-2", "placement.json")) && fs.existsSync(path.join(dir, "placement", "screen-2-2", "placement.json")), said);
    assert.match(said, /screen-<keep>\/placement\.json/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------ the second review of the screen's picture
test("second review 1: the smallest shift that puts the region where it passes: 9:16, a 1280×720 screen's top and bottom right corners at 2× move 60 px into the wide stretch above the buttons, not 192 px into the safe box; a region that reaches down to the buttons still moves 192 px", () => {
  const { z, a } = frameOf(1080, 1920), src = { width: 1280, height: 720 };
  for (const crop of [[0.7, 0, 1, 0.3], [0.7, 0.7, 1, 1]]) {
    const b = beforePicture(crop, src, a, true);
    const s = shiftedInside(b, src, z, a, 1080);
    assert.equal(s.shift, -60, JSON.stringify(crop));
    assert.deepEqual(s.region, [252, 329, 768, 432]);
    assert.deepEqual(judge(s, { zones: z, width: 1080, height: 1920 }).faults, []);
  }
  // reaching below the wide stretch (to y 1000): only the safe box holds it, 192 px
  const low = { fit: BEFORE, scale: 2, left: -1408, top: 0, window: [0, 0, 1080, 1200], region: [312, 600, 768, 400] };
  assert.equal(shiftedInside(low, src, z, a, 1080).shift, -192);
});

test("second review 2: a circle moved to a bottom corner ends the skill's gap above the captions' band as built (16:9: band at y 772, the circle's bottom at 748, not 776) and keeps that gap from a label; without room at the bottom the top corners are tried as before", () => {
  const { z, a } = frameOf(1920, 1080);
  const gap = Math.round(1080 * 0.022);
  const pic = { circle: a.pip, region: [96, 108, 1300, 300] };
  const free = freeCorner(pic, { zones: z, areas: a, width: 1920, height: 1080, band: 772 });
  assert.deepEqual(free, { circle: [1608, 772 - gap - 216, 216], corner: "bottom right" });
  assert.equal(freeCorner(pic, { zones: z, areas: a, width: 1920, height: 1080 }).circle[1] + 216, a.bleed[3], "without the band: the areas' bottom, as before");
  // a label 10 px beside the top left corner's circle: nearer than the gap, so that corner is not taken
  const right = { circle: [1608, 108, 216], region: [400, 108, 1424, 300] }, o = { zones: z, areas: a, width: 1920, height: 1080, band: 772 };
  assert.equal(freeCorner(right, o).corner, "top left");
  assert.equal(freeCorner(right, { ...o, labels: [[96 + 216 + 10, 108, 200, 70]] }).corner, "bottom right");
  // the band so high that no bottom corner has room: a top corner
  const t = freeCorner({ circle: [1608, 600, 216], region: [400, 500, 1000, 300] }, { zones: z, areas: a, width: 1920, height: 1080, band: 300 });
  assert.match(t.corner, /^top/);
  // seat passes the band on (top left has the label, bottom right meets the region: bottom left)
  assert.deepEqual(seat({ region: [1100, 150, 700, 400] }, a.pip, { zones: z, areas: a, width: 1920, height: 1080, band: 772, labels: [[96, 108, 300, 70]] }).circle, [96, 772 - gap - 216, 216]);
});

// ------------------------------------------------- one caption line (decided 2026-11-19, captions-clear)
// What must be read ends a gap above the captions' one line as captions built it (area.json); the
// rest of a screen runs on under them to the frame's edges; the circle stands as on main;
// "captions": { "lines": 2 } builds as before.
import { linesOf, captionLine, spread } from "./lib/layout.mjs";
const LINE = { "1080x1920": { left: 192, width: 696, top: 1350, bottom: 1440, size: 52, lines: 1 }, "1080x1350": { left: 54, width: 972, top: 1140, bottom: 1230, size: 52, lines: 1 },
  "1080x1080": { left: 54, width: 972, top: 870, bottom: 960, size: 52, lines: 1 }, "1920x1080": { left: 96, width: 1728, top: 840, bottom: 930, size: 52, lines: 1 } };
const oneLine = (w, h, opts = {}) => {
  const z = realZones(w, h, []), L = LINE[`${w}x${h}`];
  return { z, L, two: areas(w, h, z, { captions: true, ...opts }), one: areas(w, h, z, { captions: true, line: L, ...opts }) };
};
const bottomOf = (b) => b[1] + b[3];

test("one caption line: the room comes from what captions built (area.json); two lines, or a line that cannot be read, keep main's band", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caption-line-"));
  try {
    const f = path.join(dir, "area.json");
    fs.writeFileSync(f, JSON.stringify(LINE["1080x1920"]));
    assert.deepEqual(captionLine(f), { top: 1350, bottom: 1440 });
    fs.writeFileSync(f, "{");
    assert.equal(captionLine(f), null);
    assert.equal(captionLine(path.join(dir, "none.json")), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.equal(linesOf({ style: "clean" }), 1);
  assert.equal(linesOf({ style: "clean", lines: 2 }), 2);
  for (const [w, h] of [[1080, 1920], [1080, 1350], [1080, 1080], [1920, 1080]]) {
    const z = realZones(w, h, []);
    // without a line (two lines, or none read): main's numbers exactly
    assert.deepEqual(areas(w, h, z, { captions: true, line: null }), areas(w, h, z, { captions: true }), `${w}x${h}`);
    // a line outside the safe box is not taken
    assert.deepEqual(areas(w, h, z, { captions: true, line: { top: -5, bottom: 10 } }), areas(w, h, z, { captions: true }), `${w}x${h}`);
    // no captions: the line changes nothing
    assert.deepEqual(areas(w, h, z, { captions: false, line: LINE[`${w}x${h}`] }), areas(w, h, z, { captions: false }), `${w}x${h}`);
  }
});

test("one caption line: every room for what must be read ends a gap above it, the screen's bleed is the whole frame, the circle stands at main's place and size", () => {
  for (const [w, h] of [[1080, 1920], [1080, 1350], [1080, 1080], [1920, 1080]]) {
    const { one, two, L } = oneLine(w, h), gap = Math.round(Math.min(w, h) * 0.022), key = `${w}x${h}`;
    assert.deepEqual(one.pip, two.pip, `${key}: the circle as on main`);
    assert.deepEqual(one.bleed, [0, 0, w, h], key);
    assert.equal(one.floor, bottomOf(two.bleed), `${key}: a moved circle's bottom corners as on main`);
    assert.deepEqual(one.line, { top: L.top, bottom: L.bottom, above: L.top - gap }, key);
    // (9:16's solo room above the buttons' column ends where the column begins, as on main)
    for (const room of [one.tall, one.whole, one.solo.reduce((a, b) => (bottomOf(b) > bottomOf(a) ? b : a)), ...(h >= w * 1.5 ? [] : one.content)]) assert.equal(bottomOf(room), L.top - gap, `${key}: ${room}`);
    // each room at least as large as main's
    for (const k of ["tall", "whole"]) assert.ok(one[k][3] > two[k][3], `${key} ${k}`);
    for (const [i, room] of one.content.entries()) assert.ok(room[3] >= two.content[i][3], `${key} content`);
  }
});

test("one caption line: a zoom's region ends above the line while the screen runs on under it; a phone whole and a video shown end above it with the ground below", () => {
  // 16:9, a zoom limited by the height (as the slide of the public test): larger than main, its region above the line, the screen to the frame's bottom
  const { one, two, L } = oneLine(1920, 1080), src = { width: 1920, height: 1080 }, c = [0.35, 0.15, 0.6, 0.58];
  const a1 = spread(one.content, one.bleed, c, src, { maxScale: 2 }), a2 = spread(two.content, two.bleed, c, src, { maxScale: 2 });
  assert.ok(a1.width > a2.width, `${a1.width / 1920}× against main's ${a2.width / 1920}×`);
  const regionBottom = a1.top + c[3] * a1.height;
  assert.ok(regionBottom <= L.top - 24 + 0.5, `the region ends at ${regionBottom}`);
  assert.equal(bottomOf(a1.box), 1080, "the rest of the screen under the captions down to the frame's edge");
  assert.equal(bottomOf(a2.box), bottomOf(two.bleed), "main: above the band");
  // 9:16, the phone whole (no circle) and a tall video shown: above the line, larger than main's, ground below
  const n = oneLine(1080, 1920), phone = { width: 1080, height: 2340 };
  const sources = { screen: { width: 1920, height: 1080, offset: 0 }, phone: { ...phone, offset: 0 }, "show-1": { width: 1080, height: 1920, offset: 0 } };
  const piece = { view: "phone-screen", source: "phone", start: 0, duration: 3, in: 0, out: 3, crop: [0, 0, 1, 1], rate: 1, pip: false };
  const [p1] = shots([piece], sources, 1080, 1920, n.one), [p2] = shots([piece], sources, 1080, 1920, n.two);
  assert.ok(bottomOf(p1.layers[0].box) <= n.L.top - 24 + 0.5 && p1.layers[0].box[3] > p2.layers[0].box[3], JSON.stringify([p1.layers[0].box, p2.layers[0].box]));
  const show = { view: "screen", source: "screen", start: 0, duration: 3, in: 0, out: 3, rate: 1, pip: false, show: { source: "show-1", in: 0, until: 3 } };
  const [s1] = shots([show], sources, 1080, 1920, n.one), [s2] = shots([show], sources, 1080, 1920, n.two);
  assert.ok(bottomOf(s1.layers[0].box) <= n.L.top - 24 + 0.5 && s1.layers[0].box[3] > s2.layers[0].box[3], JSON.stringify([s1.layers[0].box, s2.layers[0].box]));
  // with the circle: the phone beside it, above the line; the circle where main has it
  const [c1] = shots([{ ...piece, pip: true }], { ...sources, webcam: { width: 1280, height: 720, offset: 0, face: [0.388, 0.202, 0.614, 0.685] } }, 1080, 1920, n.one);
  assert.ok(bottomOf(c1.layers[0].box) <= n.L.top - 24 + 0.5);
  assert.deepEqual(c1.layers.find((l) => l.pip).box.slice(0, 3), n.two.pip);
});

test("one caption line: the face view is placed by the layout skill around the one line as captions built it", { skip: !LAYOUT && "no layout skill beside this one" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "face-line-"));
  try {
    for (const size of ["1080x1920", "1080x1350", "1920x1080"]) {
      const [width, height] = size.split("x").map(Number), area = path.join(dir, `line-${size}.json`);
      fs.writeFileSync(area, JSON.stringify(LINE[size]));
      const r = placeFace({ tool: LAYOUT, folder: path.join(dir, size), moments: faceMoments(CAM), cam: CAM, width, height, area });
      assert.ok(r.res, r.why);
      const first = r.res.candidates[0];
      assert.ok(first.pick.passes, `${size}: ${first.pick.why}`);
      assert.ok(first.faceInFrame[0][1] + first.faceInFrame[0][3] < LINE[size].top, `${size}: the chin at ${first.faceInFrame[0][1] + first.faceInFrame[0][3]}`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("review of screencast-clear, 1: a zoom at the screen's bottom edge stands on the bottom of its room, just above the caption line, never over more ground than main (16:9, zoom [0.3,0.85,0.7,1]: main y 452–776, 28 % ground; was y 300–624, 42 %)", () => {
  const { one, two } = oneLine(1920, 1080), c = [0.3, 0.85, 0.7, 1];
  for (const src of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    const at = (a) => { const s = spread(a.content, a.bleed, c, src, { maxScale: 2, near: !!a.line }); return { s, top: s.top + c[1] * s.height, bottom: s.top + c[3] * s.height, ground: 1 - (s.box[2] * s.box[3]) / (1920 * 1080) }; };
    const m = at(two), n = at(one);
    assert.deepEqual([Math.round(m.top), Math.round(m.bottom), Math.round(m.ground * 1000)], src.width === 1920 ? [452, 776, 281] : [560, 776, 281], "main as it was");
    assert.equal(Math.round(n.bottom), 816, `${src.width}: the region on the room's bottom, 24 px above the line at 840`);
    assert.ok(n.ground <= m.ground + 1e-9, `${src.width}: ground ${n.ground} against main's ${m.ground}`);
    assert.ok(n.s.width >= m.s.width - 1e-9);
  }
  // 4:5 and 1:1, a zoom in the screen's bottom right corner: no more ground than main
  for (const [w, h] of [[1080, 1350], [1080, 1080]]) {
    const { one: o, two: t } = oneLine(w, h), cc = [0.6, 0.7, 1, 1], src = { width: 1920, height: 1080 };
    const g = (a) => { const s = spread(a.content, a.bleed, cc, src, { maxScale: 2, near: !!a.line }); return 1 - (s.box[2] * s.box[3]) / (w * h); };
    assert.ok(g(o) <= g(t) + 1e-9, `${w}x${h}: ${g(o)} against main's ${g(t)}`);
  }
});

test("review of screencast-clear, 2: the room of one line never puts the circle on a region where main's picture had it off; with no corner free the keep keeps main's picture (16:9, a 3440×1440 screen, the four corner zooms: 1.55× with the circle off, not 1.64× shifted under the circle at x 1608)", { skip: !LAYOUT && "no layout skill beside this one" }, () => {
  const meets = (a, b) => Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]) > 0.5 && Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]) > 0.5;
  for (const crop of [[0, 0, 0.3, 0.3], [0.7, 0, 1, 0.3], [0, 0.7, 0.3, 1], [0.7, 0.7, 1, 1]]) {
    const two = oneKeep({ width: 1920, height: 1080, screen: [3440, 1440], crop });
    const one = oneKeep({ width: 1920, height: 1080, screen: [3440, 1440], crop, line: LINE["1920x1080"] });
    const [c2] = two.circles, [c1] = one.circles, r1 = one.p.screen.region;
    assert.ok(!meets([c2.box[0], c2.box[1], c2.box[2], c2.box[3]], two.p.screen.region), `${crop}: main has the circle off`);
    assert.ok(!meets([c1.box[0], c1.box[1], c1.box[2], c1.box[3]], r1), `${crop}: the circle ${c1.box} on the region ${r1}`);
    assert.ok(!one.p.screen.faults.includes("circle"), one.said);
    assert.equal(one.p.screen.scale, two.p.screen.scale, `${crop}: main's scale (1.55×), ${one.said}`);
    assert.deepEqual(c1.box, c2.box, `${crop}: the circle where main has it`);
    assert.match(one.said, /as with two caption lines at 1\.55×[^:]*: in the room of one line the circle would lie on the region and no corner is free of it/);
  }
});

import { captionsFor, captionArea } from "./lib/layout.mjs";
test("review of screencast-clear, 3: \"captions\": { \"lines\": 2 } alone keeps main's clean subtitles (not hormozi) and main's numbers; a style the cut names stays; a broken area.json is not handed on", () => {
  assert.deepEqual(captionsFor({}), { style: "clean", highlight: [] });
  assert.deepEqual(captionsFor({ captions: { lines: 2 } }), { style: "clean", highlight: [], lines: 2 });
  // every form as on main but { "lines": n } alone (second review): the style the build takes, the lines
  const look = (captions) => { const c = captionsFor(captions === undefined ? {} : { captions }); return [c.style || "hormozi", linesOf(c)]; };
  assert.deepEqual(look(undefined), ["clean", 1]);
  assert.deepEqual(look("outline"), ["hormozi", 1], "a string, as on main");
  assert.deepEqual(look({ lines: 2 }), ["clean", 2]);
  assert.deepEqual(look({ lines: 1 }), ["clean", 1]);
  assert.deepEqual(look({ highlight: [4, 9] }), ["hormozi", 1]);
  assert.deepEqual(look({ highlight: [4, 9], lines: 2 }), ["hormozi", 2]);
  assert.deepEqual(look({ style: "hormozi", lines: 2 }), ["hormozi", 2]);
  assert.deepEqual(captionsFor({ captions: { highlight: [4, 9] } }), { highlight: [4, 9] }, "the object as main reads it");
  assert.deepEqual(captionsFor({ captions: { style: "hormozi", highlight: [3] } }), { style: "hormozi", highlight: [3] });
  assert.deepEqual(captionsFor({ captions: { style: "clean", highlight: [], lines: 2 } }), { style: "clean", highlight: [], lines: 2 });
  assert.equal(captionsFor({ captions: false }), null);
  assert.equal(captionsFor({}, false), null);
  // with { lines: 2 } the areas are main's, in every frame
  for (const [w, h] of [[1080, 1920], [1080, 1350], [1080, 1080], [1920, 1080]]) {
    const z = realZones(w, h, []), caps = captionsFor({ captions: { lines: 2 } });
    assert.equal(linesOf(caps), 2);
    assert.deepEqual(areas(w, h, z, { captions: !!caps, line: linesOf(caps) === 1 ? LINE[`${w}x${h}`] : null }), areas(w, h, z, { captions: true }), `${w}x${h}`);
  }
  const one = captionsFor({}), two = captionsFor({ captions: { lines: 2 } });
  assert.equal(captionArea(one, { top: 1350, bottom: 1440 }, "a.json"), "a.json");
  assert.equal(captionArea(one, null, "a.json"), null, "one line whose file could not be read: none");
  assert.equal(captionArea(two, null, "a.json"), "a.json", "two lines: as main");
  assert.equal(captionArea(null, null, "a.json"), null);
});

// ------------------------------------------------- the whole run of 2026-11-19 (e2e-2026-11-19)
// A keep with "show" showed the speaker's circle beside the shown video, the video in the slot a
// phone gets beside it (9:16: about 55 % of the width, right of the middle; 16:9: 350×610 left of
// the middle); its sound ran under the words; check and build said things that could not be done.
import { circleOn, soundSaid } from "./lib/show.mjs";
import { pieceEndSaid, endSaid } from "./lib/cut.mjs";
import { beyondZoom } from "./lib/screenview.mjs";
import { softOf } from "./lib/placement.mjs";

test("show draws no circle unless the keep says \"circle\": true; every other keep keeps its circle unless \"circle\": false", () => {
  assert.equal(circleOn({ show: "a.mp4" }), false);
  assert.equal(circleOn({ show: { file: "a.mp4", sound: 0.8 }, circle: false }), false);
  assert.equal(circleOn({ show: "a.mp4", circle: true }), true);
  assert.equal(circleOn({}), true);
  assert.equal(circleOn({ zoom: [0, 0, 1, 1] }), true);
  assert.equal(circleOn({ view: "phone-screen", circle: false }), false);
});

test("a shown video without the circle takes the room a whole picture gets: as large as it fits above the caption line, centred across, in 9:16, 4:5, 1:1 and 16:9, upright (720×1280, the run's) and wide (1280×720); with \"circle\": true beside the circle as before", () => {
  const UP = { width: 720, height: 1280, offset: 0 }, WIDE = { width: 1280, height: 720, offset: 0 };
  const cam = { width: 1280, height: 720, offset: 0, face: [0.388, 0.202, 0.614, 0.685] };
  const got = {};
  for (const [w, h] of [[1080, 1920], [1080, 1350], [1080, 1080], [1920, 1080]]) {
    const a = areas(w, h, realZones(w, h, []), { captions: true, line: LINE[`${w}x${h}`] });
    for (const [name, shown] of [["upright", UP], ["wide", WIDE]]) {
      const keep = { words: "0-5", show: "x.mp4" };
      const p = { view: "screen", source: "screen", start: 0, duration: 3, in: 0, out: 3, rate: 1, show: { source: "show-1", in: 0, until: 3 }, ...(circleOn(keep) ? {} : { pip: false }) };
      const sources = { "show-1": shown, screen: { width: 1920, height: 1080, offset: 0 }, webcam: cam };
      const [s] = shots([p], sources, w, h, a);
      assert.ok(!s.layers.some((l) => l.pip), `${w}x${h} ${name}: no circle`);
      const box = s.layers[0].box, whole = fit(a.whole, shown.width / shown.height);
      assert.ok(Math.abs(box[2] - whole[2]) < 0.5 && Math.abs(box[3] - whole[3]) < 0.5, `${w}x${h} ${name}: as large as the whole room (${round1(box)} against ${round1(whole)})`);
      assert.ok(Math.abs(box[0] + box[2] / 2 - w / 2) <= 1, `${w}x${h} ${name}: centred across`);
      assert.ok(box[1] + box[3] <= a.line.above + 0.5, `${w}x${h} ${name}: above the caption line`);
      // with the circle, as before: beside it, smaller
      const [c] = shots([{ ...p, pip: undefined }], sources, w, h, a);
      assert.ok(c.layers.some((l) => l.pip), "the circle when the keep asks for it");
      assert.ok(c.layers[0].box[2] * c.layers[0].box[3] <= box[2] * box[3] + 0.5, `${w}x${h} ${name}: never larger beside the circle`);
      got[`${w}x${h} ${name}`] = [round1(box), round1(c.layers[0].box)];
    }
  }
  // the numbers (real zones of the frame's usual platforms, the captions' one line as built):
  // without the circle, and as before beside it
  assert.deepEqual(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v[0]])), {
    "1080x1920 upright": [174, 24, 732, 1302], "1080x1920 wide": [0, 371, 1080, 608], "1080x1350 upright": [233, 24, 614, 1092], "1080x1350 wide": [0, 281, 1080, 608],
    "1080x1080 upright": [309, 24, 462, 822], "1080x1080 wide": [0, 146, 1080, 608], "1920x1080 upright": [737, 24, 446, 792], "1920x1080 wide": [256, 24, 1408, 792] });
  assert.deepEqual(got["1080x1920 upright"][1], [322, 285, 566, 1006], "9:16 beside the circle, as the run had it (off the middle)");
});

test("the build's line for a shown video with sound says it runs under the words and when \"sound\" is right (the run's keep 6)", () => {
  const clock = (s) => `0:${s.toFixed(1).padStart(4, "0")}`;
  const i = { k: 5, file: "uploads/result.mp4", sound: 0.8, start: 25.8, duration: 8.4, spoken: 6.9, lufs: -13.7, gain: -0.3 };
  assert.equal(soundSaid(i, -14, clock), `keep 6: the sound of uploads/result.mp4 runs under the keep's words (at a quarter of its level under the first, up to 0.8 by the last at 0:32.7), so speech in it is heard under the speaker's, two voices at once: "sound" is for music, ambience or a result whose sound is the point, not for a clip that speaks; measured -13.7 LUFS, brought -0.3 dB to the voice's -14 LUFS ("sound": 1 is the voice's level), through the voice's bus.`);
  assert.match(soundSaid({ ...i, duration: 4.1 }, -14, clock), /at a quarter of its level, the video ending before the last word/);
  assert.equal(soundSaid({ ...i, spoken: 0 }, -14, clock), `keep 6: the sound of uploads/result.mp4 measured -13.7 LUFS, brought -0.3 dB to the voice's -14 LUFS ("sound": 1 is the voice's level), through the voice's bus.`, "a keep without words: as before");
});

// the run's last words (words.json, 117–132) and its 45.0 s recording
const RUN_WORDS = [[117,"in",39.29,39.37],[118,"a",39.37,39.43],[119,"high-threat",39.43,40.31],[120,"environment",40.31,40.92],[121,"as",41.01,41.2],[122,"a",41.2,41.32],[123,"group,",41.34,41.56],[124,"as",41.67,41.83],[125,"a",41.84,41.94],[126,"team,",42,42.38],[127,"to",42.82,42.96],[128,"explore",42.96,43.44],[129,"the",43.44,43.54],[130,"Moon",43.54,44.01],[131,"and",44.49,44.88],[132,"to",44.88,44.99]];
const runWords = () => { const w = []; for (const [i, text, start, end] of RUN_WORDS) w[i] = { i, kind: "word", text, start, end }; return w; };

test("check on the recording's last word: no \"end a word later\" where there is none; it names the last place to stop (the run's keep 103–132)", () => {
  const words = runWords();
  assert.equal(pieceEndSaid({ k: 9, out: 44.94, first: 117, last: 132, words, recorded: 45 }),
    `piece 10 ends -0.05 s after "to", where the recording ends: there is no word later, and it may sound cut off; end the keep at word 130 ("Moon"), where the speaker pauses 0.5 s, or leave it`);
  // a piece inside the recording: as before
  assert.equal(pieceEndSaid({ k: 2, out: 42.4, first: 117, last: 126, words, recorded: 45 }),
    `piece 3 ends 0.02 s after "team," (the next words follow right after it in the recording): it may sound cut off; end the keep a word later, or where the speaker pauses`);
});

test("check's end: no \"hold\": 1.5 asked of a keep whose hold the recording's end cuts (the run's cut: 1.0 s after \"Moon\", the recording over)", () => {
  assert.equal(endSaid({ gap: 0.99, lastOut: 45, recorded: 45 }), `the cut ends 1.0 s after its last word, where the recording ends: a "hold" cannot play past it; for a moment after the last word, end the cut on an earlier sentence that has a pause after it, or leave it`);
  assert.equal(endSaid({ gap: 0.6, lastOut: 30.2, recorded: 45 }), `the cut ends 0.6 s after its last word: give the end a moment ("hold": 1.5 on the last keep)`);
  assert.equal(endSaid({ gap: 1.5, lastOut: 45, recorded: 45 }), null);
  // the cut that ended on the recording's last word ("to", 103–132): its piece ends 0.06 s before the recording
  assert.match(endSaid({ gap: 0, lastOut: 44.94, recorded: 45 }), /^the cut ends 0\.0 s after its last word, where the recording ends/);
});

test("small text that no zoom makes read (the run's keep 3 in 16:9: 12 px, read from 42.7 px): the sentence says 2× is the most, what it gives and what can be done, never a narrower zoom", () => {
  const said = beyondZoom({ text: 12, readable: 42.7, width: 1920 });
  assert.equal(said, `a zoom enlarges at most 2×, where this text (12 px on the screen) is 24 px, under the 42.7 px from which text begins to read in this frame: it cannot be shown larger here, and a narrower "zoom" does not help. Accept it (the words say what it shows), or show it in a frame where it reads: in one 1080 px wide (9:16, 4:5, 1:1) a capital reads from 24 px, which this text reaches at 2× (a zoom box small enough to be shown at 2× there)`);
  const line = textSentence({ scale: 1.93 }, { text: 12, readable: 42.7, narrower: "at most 461×199 px of the screen", size: { width: 1920, height: 1080 }, width: 1920 });
  assert.doesNotMatch(line, /narrower "zoom" on/);
  assert.match(line, /^the screen \(1920×1080\) at 1\.93×: its text \(12 px on the screen, "text"\) is 23\.2 px tall here; a zoom enlarges at most 2×/);
  // where a zoom can make it read (9:16: from 24 px; 16:9 with 24 px text): the narrower zoom, as before
  assert.equal(beyondZoom({ text: 12, readable: 24, width: 1080 }), null);
  assert.equal(beyondZoom({ text: 24, readable: 42.7, width: 1920 }), null);
  assert.match(textSentence({ scale: 1.78 }, { text: 12, readable: 24, narrower: "at most 480×395 px of the screen", width: 1080 }), /give a narrower "zoom" on what is talked about \(at most 480×395 px of the screen reads\)/);
  // text too small for 2× in any frame: accept it, no other frame offered
  assert.doesNotMatch(beyondZoom({ text: 8, readable: 42.7, width: 1920 }), /1080 px wide/);
});

test("the face view's ! says why: layout's soft problem in a few words (the run's crop 4:5 at 1.875×)", () => {
  const c = { fit: "crop", crop: "4:5", scale: 1.875, soft: 1, hard: 0, problems: [{ level: "soft", code: "enlarged", kind: "picture", of: "picture", what: "the source's pixels are enlarged 1.88× (over 1.5×: soft)" }], pick: { passes: true } };
  assert.equal(markOf(c), "!");
  assert.equal(softOf(c), "enlarged 1.88×: soft");
  assert.equal(softOf({ ...c, problems: [{ level: "soft", code: "other", what: "the face near the edge" }, { level: "hard", code: "x", what: "no" }] }), "the face near the edge");
  assert.equal(softOf({ ...c, problems: [] }), "");
});

test("frame before the first build: a moment of the recording, the screen with its grid; after a build the cut's, --recording the recording's", { skip: !hasFfmpeg && "no ffmpeg on this machine" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-frame-"));
  try {
    fs.mkdirSync(path.join(dir, "source"));
    const made = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=10:duration=3", "-pix_fmt", "yuv420p", path.join(dir, "source", "screen.mp4")]);
    assert.equal(made.status, 0);
    fs.writeFileSync(path.join(dir, "source", "sources.json"), JSON.stringify({ duration: 3, sources: { screen: { file: "screen.mp4", video: true, width: 320, height: 180, offset: 0 } } }));
    const r = spawnSync(process.execPath, [path.join(HERE, "screencast.mjs"), "frame", dir, "1.5"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /screen at 0:01\.5 of the recording, a blue line every tenth/);
    assert.ok(fs.existsSync(path.join(dir, "frames", "rec-1_5-screen.jpg")));
    const late = spawnSync(process.execPath, [path.join(HERE, "screencast.mjs"), "frame", dir, "9"], { encoding: "utf8" });
    assert.notEqual(late.status, 0);
    assert.match(late.stdout + late.stderr, /a moment of the recording, which is 0:03\.0 long/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
