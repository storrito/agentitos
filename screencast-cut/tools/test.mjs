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
// The face view placed by the layout skill (lib/placement.mjs): the candidates, the rule that
// chooses among them (best-takes' own), the element's geometry, and the old cover where no face
// is known. The layout skill runs as a program, beside this one.
import { rankPictures, nameOf, faceMoments, placeFace, coverOf, geometry, layoutTool } from "./lib/placement.mjs";
import { shots } from "./lib/composition.mjs";
import { cover, place } from "./lib/layout.mjs";

test("the rule that chooses the face view is best-takes': of what passes, the face nearest the usual size up to 34 % of the height, layout's order among equals (best-takes' own case: the 4:5 crop at 1.875× before the square at 1.5×)", () => {
  const c = (fit, crop, scale, extra = {}) => ({ fit, crop, scale, left: 0, top: 0, hard: 0, unmet: [], soft: 0, problems: [], text: [], ...extra });
  const list = [c("crop", "1:1", 1.5), c("crop", "1:1", 1.5, { onGround: true }), c("crop", "4:5", 1.875, { soft: 1 }), c("inset", null, 0.8438), c("full", null, 2.6667, { hard: 1 })];
  const r = rankPictures(list, 309, 1920);
  assert.deepEqual(r.map((x) => x.n), [3, 1, 2, 4, 5]);
  assert.ok(Math.abs(r[0].face - 0.302) < 0.001);
  assert.equal(rankPictures([c("crop", "4:5", 1.875), c("crop", "1:1", 1.5)], 400, 1920)[0].crop, "1:1");
  // a candidate whose captions found no place (on the face) never comes before one that passes
  assert.equal(rankPictures([c("full", null, 1.2, { unmet: ["caption"] }), c("inset", null, 0.8)], 309, 1920)[0].fit, "inset");
  assert.deepEqual(r.map(nameOf), ["crop 4:5", "crop 1:1", "crop 1:1, text on the ground", "inset", "full"]);
});

test("the webcam's face in px: the three moments the model saw, else the one box of the circle", () => {
  const cam = { width: 1280, height: 720, face: [0.4, 0.2, 0.6, 0.7], faceAt: [{ t: 9, box: [0.4, 0.2, 0.6, 0.7] }, { t: 22.5, box: [0.45, 0.3, 0.65, 0.8] }] };
  assert.deepEqual(faceMoments(cam), [{ t: 9, box: [512, 144, 256, 360] }, { t: 22.5, box: [576, 216, 256, 360] }]);
  assert.deepEqual(faceMoments({ ...cam, faceAt: undefined }), [{ t: 0, box: [512, 144, 256, 360] }]);
  assert.deepEqual(faceMoments({ ...cam, face: null, faceAt: undefined }), []);
});

const LAYOUT = layoutTool();
test("a 720p webcam into 9:16 around clean captions at the safe box's bottom: the frame covered (2.67×, the chin in the captions) fails, the rule takes the 4:5 crop at 1.875× with the chin above the captions", { skip: !LAYOUT && "no layout skill beside this one" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "face-view-"));
  try {
    const cam = { width: 1280, height: 720, face: [0.388, 0.202, 0.614, 0.685] };
    const area = { left: 192, width: 696, top: 1282, bottom: 1440, size: 52, lines: 2 };
    fs.writeFileSync(path.join(dir, "area.json"), JSON.stringify(area));
    const res = placeFace({ tool: LAYOUT, folder: path.join(dir, "p"), cam, width: 1080, height: 1920, area: path.join(dir, "area.json") });
    const usual = 0.483 * 720, ranked = rankPictures(res.candidates, usual, 1920), first = ranked[0];
    assert.equal(nameOf(first), "crop 4:5");
    assert.equal(first.scale, 1.875);
    assert.ok(first.faceInFrame[0][1] + first.faceInFrame[0][3] < area.top, `the chin at ${first.faceInFrame[0][1] + first.faceInFrame[0][3]}`);
    const full = ranked.find((x) => x.fit === "full");
    assert.ok(full.hard && full.unmet.includes("caption"));
    // what the old cover did for this webcam: the same 2.67×, its chin in the captions' band
    const old = coverOf(cam, 1080, 1920);
    assert.ok(old.scale > 2.6 && old.top + 0.685 * 720 * old.scale > area.top);
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
