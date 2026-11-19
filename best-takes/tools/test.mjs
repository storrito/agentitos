// The cut's voice as one file, on made-up recordings (a tone where someone speaks), what becomes
// of a pause, on made-up movement of a camera and of a screen, and the cut's text as people read
// it, on made-up words. No request.
//
//   node --test tools/test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { voiceTrack } from "./lib/tracks.mjs";
import { plan, capitalised, endsSentence } from "./lib/cut.mjs";
import { HOP } from "./lib/voice.mjs";
import { overTarget, rules } from "./brief.mjs";

// ------------------------------------------------------------------------------ the pauses
// One video of 20 s: words every half second from 1 to 8 s and from 12 to 18 s, a pause of
// 4 s between them (after word 13).
const words = [];
for (const [a, b] of [[1, 8], [12, 18]]) for (let t = a; t < b - 0.01; t += 0.5) words.push({ i: words.length, clip: 1, kind: "word", text: "wort", start: t, end: t + 0.4 });
const PAUSE = [8.4, 12];
const talking = (t) => words.some((w) => t >= w.start && t <= w.end);
const voices = { 1: {
  env: Float32Array.from({ length: 20 / HOP }, (_, f) => (talking(f * HOP) ? 0.1 : 0.001)), thr: 0.01, duration: 20,
  blocks: Array.from({ length: 200 }, (_, k) => ({ t: k / 10, m: talking(k / 10 - 0.2) ? -20 : -80 })),
} };
const settings = { fps: 30, pause: 1, pauses: "picture", loudness: -16 };
const all = { keep: [{ words: `0-${words.length - 1}` }] };
// made-up movement, four samples a second as motion.mjs' activity gives them: change(t) is the
// share of changed pixels at t
const series = (change) => (clip, from, to) => {
  const out = [];
  for (let k = 1; from + k / 4 <= to + 1e-9; k++) out.push({ t: from + k / 4, change: change(from + k / 4) });
  return out;
};
const shownIn = (r) => r.pieces.filter((p) => p.mute && p.in < PAUSE[1] && p.out > PAUSE[0]);
const pauseOf = (r) => r.removed.find((x) => x.kind === "pause");
// a phone in the hand: 5–9 % of the picture changes all the time, speaking or not
const hand = (t) => 0.05 + 0.01 * ((t * 4) % 5);

test("a camera: a pause that moves as much as while speaking is cut hard", () => {
  const r = plan(words, all, settings, voices, series(hand));
  assert.deepEqual(r.errors, []);
  assert.equal(shownIn(r).length, 0);
  assert.match(pauseOf(r).why, /^cut: the picture moves no more than while speaking/);
  assert.ok(r.motion[1].base > 0.05 && r.motion[1].base < 0.1, `the movement while speaking: ${r.motion[1].base}`);
});

test("a camera: a pause in which something moves well above it stays, muted", () => {
  // something is held into the picture from 9.5 to 11 s
  const r = plan(words, all, settings, voices, series((t) => (t > 9.5 && t <= 11 ? 0.45 : hand(t))));
  const shown = shownIn(r);
  assert.equal(shown.length, 1);
  assert.ok(shown[0].in >= 9 && shown[0].out <= 11.5, `shown ${shown[0].in}–${shown[0].out}`);
  assert.match(pauseOf(r).why, /something moves in it/);
});

test("a screen: still while speaking, a pause in which something moves stays, a still one is cut", () => {
  const screen = (t) => (talking(t) ? 0.0003 : 0.0001);
  // a click and a page that loads, 9 to 10 s
  const click = plan(words, all, settings, voices, series((t) => (t > 9 && t <= 10 ? 0.01 : screen(t))));
  assert.equal(shownIn(click).length, 1);
  assert.match(pauseOf(click).why, /something moves in it/);
  const still = plan(words, all, settings, voices, series(screen));
  assert.equal(shownIn(still).length, 0);
  assert.match(pauseOf(still).why, /^cut: the picture stands still/);
});

test("a screen: a change under 0.2 % is no movement, as it always was", () => {
  const r = plan(words, all, settings, voices, series((t) => (t > 9 && t <= 10 ? 0.0015 : 0)));
  assert.equal(shownIn(r).length, 0);
  assert.equal(r.motion[1].limit, 0.002);
});

test("the agent overrules: \"pauses\": \"keep\" plays a pause the tool would cut as it is", () => {
  const r = plan(words, { keep: [{ words: all.keep[0].words, pauses: "keep" }] }, settings, voices, series(hand));
  assert.equal(r.removed.filter((x) => x.kind === "pause").length, 0);
  assert.ok(r.pieces.some((p) => !p.mute && p.in < PAUSE[0] && p.out > PAUSE[1]), "one piece plays through the pause");
});

test("an announced wait stays a wait on a camera, whatever it moves while speaking", () => {
  const r = plan(words, { ...all, waits: [13] }, settings, voices, series(hand));
  assert.equal(pauseOf(r).wait, true);
  const shown = shownIn(r);
  assert.equal(shown.length, 1);
  assert.ok(shown[0].rate > 1, "a timelapse");
});

test("tight: every pause goes, whatever the picture shows", () => {
  const r = plan(words, all, { ...settings, pauses: "tight" }, voices, null);
  assert.equal(shownIn(r).length, 0);
  assert.equal(pauseOf(r).why, "cut (tight)");
});

test("a line played twice: a keep with \"again\" opens with words a later keep plays where they were said; without it, one sentence", () => {
  const tight = { ...settings, pauses: "tight" };
  const twice = plan(words, { keep: [{ words: "17-19", again: true }, { words: "0-25" }] }, tight, voices, null);
  assert.deepEqual(twice.errors, []);
  assert.deepEqual(twice.pieces[0].words, [17, 18, 19]);
  assert.equal(twice.pieces[0].start, 0);
  // the words of the line twice in the text, first at the top, then where they were said
  const at = twice.words.filter((w) => w.i === 18).map((w) => w.start);
  assert.equal(at.length, 2);
  assert.ok(at[0] < 1.5 && at[1] > at[0] + 5, `${at}`);
  // nothing counted as left out
  assert.ok(!twice.removed.some((x) => x.kind === "dropped"));
  const once = plan(words, { keep: [{ words: "17-19" }, { words: "0-25" }] }, tight, voices, null);
  assert.match(once.errors.join("\n"), /word 17 .* is in keep 1 already .*"again": true/);
  // a line in an "again" keep that no other keep plays is still played, not "left out"
  const alone = plan(words, { keep: [{ words: "17-19", again: true }, { words: "0-10" }] }, tight, voices, null);
  assert.ok(!alone.removed.some((x) => x.kind === "dropped" && x.words[0] <= 19 && x.words[1] >= 17));
});

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const near = (x, y, by) => assert.ok(Math.abs(x - y) <= by, `${x} is not within ${by} of ${y}`);

// a video with a tone of `hz` all through, mono or stereo
function recording(dir, name, hz, channels) {
  const file = path.join(dir, name);
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=320x180:r=30:d=4", "-f", "lavfi", "-i", `sine=frequency=${hz}:sample_rate=44100:duration=4`,
    "-ac", String(channels), "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", file], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return file;
}
const seconds = (file) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout);
// the mean level of a stretch, dB
function level(file, from, length) {
  const r = spawnSync("ffmpeg", ["-v", "info", "-ss", String(from), "-t", String(length), "-i", file, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  return Number(/mean_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr)?.[1].replace("-inf", "-200"));
}

test("the cut's voice: every piece its length, silence where a piece only shows something, each take at its gain", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "best-takes-test-"));
  try {
    const files = { 1: recording(dir, "01.mp4", 220, 1), 2: recording(dir, "02.mp4", 440, 2) };
    const pieces = [
      { clip: 1, in: 0.5, duration: 1.2, gain: 0 },
      { clip: 1, in: 1.7, duration: 0.5, gain: 0, mute: true, rate: 2 },
      { clip: 2, in: 1.0, duration: 0.8, gain: -12 },
    ];
    const out = path.join(dir, "voice.cut.m4a");
    assert.equal(voiceTrack((p) => files[p.clip], pieces, out), out);
    // as long as the cut (an AAC frame is 21 ms)
    near(seconds(out), 2.5, 0.05);
    const first = level(out, 0.2, 0.8), quiet = level(out, 1.3, 0.3), second = level(out, 1.9, 0.5);
    assert.ok(quiet < -70, `the piece that only shows something is silent (${quiet} dB)`);
    near(first - second, 12, 1.5);
    // made again only when the cut changed
    const made = fs.statSync(out).mtimeMs;
    voiceTrack((p) => files[p.clip], pieces, out);
    assert.equal(fs.statSync(out).mtimeMs, made);
    voiceTrack((p) => files[p.clip], [pieces[0]], out);
    near(seconds(out), 1.2, 0.05);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// the names of a file's tags, its own and its streams'
function tagsOf(file) {
  const j = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8" }).stdout);
  return [j.format.tags, ...j.streams.map((s) => s.tags)].flatMap((t) => Object.keys(t || {}));
}

test("finish: the levelled video names no place, even made from a file that names one", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "best-takes-test-"));
  try {
    // a made-up place, written the way a phone writes one, into a video quieter than -14 LUFS
    const video = path.join(dir, "out.mp4");
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", recording(dir, "plain.mp4", 440, 1), "-c", "copy",
      "-metadata", "location=+12.3456-012.3456/", "-metadata", "location-eng=+12.3456-012.3456/", video], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(tagsOf(video).some((k) => /location/i.test(k)), "the made-up video should name a place");
    const takes = path.join(dir, "takes");
    fs.mkdirSync(path.join(takes, "source"), { recursive: true });
    fs.writeFileSync(path.join(takes, "edit.json"), JSON.stringify({ duration: seconds(video), words: [{ text: "Hallo.", start: 1, end: 1.5 }] }));
    const done = spawnSync(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), "takes.mjs"), "finish", takes, video], { encoding: "utf8" });
    assert.equal(done.status, 0, done.stdout + done.stderr);
    assert.match(done.stdout, /-14 LUFS \(was /);
    assert.deepEqual(tagsOf(video).filter((k) => /location|gps/i.test(k)), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a video that is not there is said in one sentence", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "best-takes-test-"));
  try {
    assert.throws(() => voiceTrack(() => path.join(dir, "none.mp4"), [{ clip: 1, in: 0, duration: 1, gain: 0 }], path.join(dir, "voice.cut.m4a")));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Made-up words of one video, 0.4 s each with 0.1 s between; the voice on wherever a word is.
function said(texts) {
  const words = texts.map(([text, kind = "word"], i) => ({ i, clip: 1, text, kind, start: 0.5 + i * 0.5, end: 0.9 + i * 0.5 }));
  const duration = words.at(-1).end + 1, env = new Float32Array(Math.ceil(duration / HOP));
  for (const w of words) env.fill(1, Math.round(w.start / HOP), Math.round(w.end / HOP));
  return { words, voices: { 1: { env, thr: 0.5, blocks: [], duration } } };
}
const SETTINGS = { fps: 30, pause: 1, loudness: -14, lang: "de" };
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
});

test("the text of the cut: a word cut out before it counts as a filler does, a spelling the agent fixed stays, a digit or a symbol is left alone", () => {
  const { words, voices } = said([["Gut."], ["also"], ["und"], ["weiter."], ["äh", "filler"], ["1080"], ["Pixel."], ["äh", "filler"], ["@storrito"], ["sagt"], ["hallo."]]);
  // words 1 (dropped between two keeps) and the fillers: "und" begins the second keep after "Gut."
  const r = plan(words, { keep: [{ words: "0-0" }, { words: "2-10" }] }, SETTINGS, voices);
  assert.equal(text(r), "Gut. Und weiter. 1080 Pixel. @storrito sagt hallo.");
  // the cut's first word, after words cut out
  const first = plan(words, { keep: [{ words: "2-3" }] }, SETTINGS, voices);
  assert.equal(text(first), "Und weiter.");
  // the first word of a video, nothing cut before it: as the model wrote it
  const own = said([["und"], ["los."]]);
  assert.equal(text(plan(own.words, { keep: [{ words: "0-1" }] }, SETTINGS, own.voices)), "und los.");
  // "fixes" is the agent's spelling
  const fixed = plan(words, { keep: [{ words: "0-0" }, { words: "2-3" }], fixes: { 2: "und" } }, SETTINGS, voices);
  assert.equal(text(fixed), "Gut. und weiter.");
});

test("the text of the cut: a sentence end the speech model put on the filler goes onto the word before, a filler's comma goes with it", () => {
  const { words, voices } = said([["Fertig,"], ["äh.", "filler"], ["Und"], ["dann"], ["äh,", "filler"], ["weiter"], ["hier."]]);
  const r = plan(words, { keep: [{ words: "0-6" }] }, SETTINGS, voices);
  assert.equal(text(r), "Fertig. Und dann weiter hier.");
  assert.equal(r.words[0].text, "Fertig.");
  // the words in the source stay as they were
  assert.equal(words[0].text, "Fertig,");
});

test("a target far under the clean cut is no cut: check names the script's words instead", () => {
  const far = overTarget(120, 30);
  assert.match(far, /no longer a matter of cutting/);
  assert.match(far, /script of 30 s spoken, about 72 words/);
  assert.doesNotMatch(far, /over the 30 s/);
});

test("a target a little under the clean cut is a trim: the ordinary warning", () => {
  const near = overTarget(40, 30);
  assert.match(near, /10\.0 s over the 30 s it should be at most: drop what repeats first, then the weakest parts/);
  assert.doesNotMatch(near, /matter of cutting|script/);
  // the line between the two: exactly half left out is still a trim
  assert.doesNotMatch(overTarget(60, 30), /matter of cutting/);
  assert.match(overTarget(61, 30), /matter of cutting/);
});

test("without a target, or within it, check says nothing of the length", () => {
  assert.equal(overTarget(120, undefined), null);
  assert.equal(overTarget(120, 0), null);
  assert.equal(overTarget(30.4, 30), null);
  // the brief has no rule 8 without a target, and names the line with one
  assert.doesNotMatch(rules(false, {}), /The length/);
  assert.match(rules(false, { target: 30 }), /Longer than 60 s, 30 s would leave out more than half/);
});

test("capitalised: Unicode's first letter, by the language; names and digits as they are", () => {
  assert.equal(capitalised("über"), "Über");
  assert.equal(capitalised("istanbul", "tr"), "İstanbul");
  assert.equal(capitalised("élan"), "Élan");
  assert.equal(capitalised("iPhone"), "iPhone");
  assert.equal(capitalised("3d"), "3d");
  assert.equal(capitalised("¿qué"), "¿qué");
  assert.equal(capitalised("東京"), "東京");
  assert.ok(endsSentence("Pixel.") && endsSentence("so?“") && endsSentence("»Ende.«") && !endsSentence("3.") && !endsSentence("z.B.") && !endsSentence("und,"));
});

// ------------------------------------------------------------------- text and faces (faces.json)
// (the tests of the lines below pass fills: Infinity: their faces are tall to make the lines plain, and a face that fills the frame gets no punch-in at all)
import { punchOrigin, punchPlan, textOnFaces, toFrame, noseOf, lipOf, mouthOf, OPEN } from "./lib/faces.mjs";
import { hookCard } from "./lib/hook.mjs";

const FRAME = [1080, 1920], CAP = [192, 1306, 696, 134];
test("a punch-in grows from a third from the top while every chin clears the captions with room to spare", () => {
  assert.equal(punchOrigin({ faces: [[355, 300, 370, 500]], scale: 1.12, frame: FRAME, fills: Infinity, cap: CAP }), 0.32 * 1920);
});
test("a punch-in on a face whose chin stands just above the captions grows from lower down, so that the chin and the margin below it stay above them", () => {
  const face = [300, 600, 480, 640], chin = 600 + 640 + 0.08 * 640;
  const y = punchOrigin({ faces: [face], scale: 1.12, frame: FRAME, fills: Infinity, cap: CAP });
  assert.ok(y > 0.32 * 1920, `origin ${y}`);
  // the chin after the punch-in, grown from y
  assert.ok(y + (chin - y) * 1.12 <= CAP[1] + 1e-6, `chin after ${y + (chin - y) * 1.12}`);
});
test("a punch-in on a face that lies on the captions already grows from the frame's bottom at most: the chin goes up, not down; but never so far that the eyes go under the apps' top bar", () => {
  const y = punchOrigin({ faces: [[100, 0, 880, 1700]], scale: 1.12, frame: FRAME, fills: Infinity, cap: CAP });
  assert.equal(y, 1920);
  const f = [100, -414, 880, 1700], eyes = -414 + 0.42 * 1700;
  const kept = punchOrigin({ faces: [f], scale: 1.12, frame: FRAME, fills: Infinity, cap: CAP, safeTop: 250 });
  assert.ok(kept < 1920 && Math.abs(kept + (eyes - kept) * 1.12 - 250) < 0.01, `origin ${kept}`);
});
test("without captions, or on a face below them (captions above a head), the punch-in grows from a third from the top", () => {
  assert.equal(punchOrigin({ faces: [[300, 600, 480, 640]], scale: 1.12, frame: FRAME, fills: Infinity, cap: null }), 0.32 * 1920);
  assert.equal(punchOrigin({ faces: [[355, 1000, 370, 400]], scale: 1.12, frame: FRAME, fills: Infinity, cap: [192, 700, 696, 134] }), 0.32 * 1920);
});
test("the check finds the seconds a text lies on a face, through the piece's punch-in, and how deep into the face from its chin", () => {
  const clips = { 1: { file: "01.mp4" } };
  const faces = { "01.mp4": { size: [1080, 1920], faces: Array.from({ length: 101 }, (_, i) => ({ t: i / 10, boxes: [{ who: "A", box: i < 50 ? [355, 300, 370, 500] : [300, 900, 480, 640] }] })) } };
  const pieces = [{ clip: 1, in: 0, out: 10, start: 0, duration: 10 }];
  const on = textOnFaces({ pieces, clips, faces, texts: [{ role: "captions", box: CAP, from: 0, to: 10 }], frame: FRAME });
  assert.equal(on.length, 1);
  assert.ok(Math.abs(on[0].seconds - 5) < 0.21 && on[0].from >= 4.9, JSON.stringify(on));
  assert.ok(Math.abs(on[0].share - (1540 - 1306) / 640) < 0.01, JSON.stringify(on));
  // the same face punched in from a third from the top lies deeper on them; grown from below its chin, less
  const punched = textOnFaces({ pieces: [{ ...pieces[0], scale: 1.12, origin: 614.4 }], clips, faces, texts: [{ role: "captions", box: CAP, from: 0, to: 10 }], frame: FRAME });
  assert.ok(punched[0].share > on[0].share, JSON.stringify(punched));
  assert.deepEqual(toFrame([0, 0, 540, 960], [540, 960], FRAME), [0, 0, 1080, 1920]);
});
test("the hook stands where it is placed: a text without a card in the middle of its box, or a card at its top; without a place, the card at the top of the centred box as before", () => {
  const zones = { centred: [192, 250, 696, 1190] };
  const text = hookCard({ text: "He wears the *robe*", until: 3, zones, out: os.tmpdir(), place: { kind: "text", box: [192, 900, 696, 238], font: 96 } });
  assert.match(text.style, /top: 915\.3px/);
  assert.doesNotMatch(text.style, /background: #FFFFFF/);
  assert.match(text.style, /font-size: 96px/);
  const card = hookCard({ text: "He wears the *robe*", until: 3, zones, out: os.tmpdir(), place: { kind: "card", box: [60, 250, 960, 236], font: 76 } });
  assert.match(card.style, /left: 540px; top: 250px/);
  assert.match(card.style, /background: #FFFFFF/);
  const old = hookCard({ text: "He wears the *robe*", until: 3, zones, out: os.tmpdir() });
  assert.match(old.style, /left: 540px; top: 258px/);
  assert.match(old.style, /font-size: 72px/);
});

test("raise moderate: a punch-in keeps a whole head inside the frame and the mouth line above the captions", () => {
  // a face whose chin is near the captions, its head's top 0.35 of it above its box, inside the frame
  const face = [300, 450, 480, 900];
  const full = punchOrigin({ faces: [face], scale: 1.12, frame: FRAME, fills: Infinity, cap: CAP, safeTop: 250 });
  const mod = punchOrigin({ faces: [face], scale: 1.12, frame: FRAME, fills: Infinity, cap: CAP, safeTop: 250, raise: "moderate" });
  const head = 450 - 0.35 * 900;
  assert.ok(mod <= full, `${mod} ${full}`);
  assert.ok(mod + (head - mod) * 1.12 >= -1e-6, `the head's top after: ${mod + (head - mod) * 1.12}`);
  // a mouth line just above the captions stays above them grown closer, whatever the head
  const tight = [100, 160, 880, 1700], line = 160 + 0.65 * 1700;
  const y = punchOrigin({ faces: [tight], scale: 1.12, frame: FRAME, fills: Infinity, cap: [192, 1306, 696, 134].map((v, i) => (i === 1 ? line + 10 : v)), safeTop: 250, raise: "moderate" });
  assert.ok(y + (line - y) * 1.12 <= line + 10 + 1e-6, `mouth line after ${y + (line - y) * 1.12}`);
});

test("raise moderate: a head the frame cuts already is not pushed further up to free a chin; only its lines keep it from sinking into the captions", () => {
  // no features: the head's proportions put its nose line at 1134, its lip line at 1264, its mouth line below the captions' top (1306)
  const face = [100, 60, 880, 1500];
  const cap = [192, 1306, 696, 134];
  const y = punchOrigin({ faces: [face], scale: 1.12, frame: FRAME, fills: Infinity, cap, safeTop: 250, raise: "moderate" });
  near(y, 60 + (0.38 + (1 + OPEN) * 0.48) * 1500, 0.5);
  // full: as far as the eyes allow, for the chin
  assert.equal(punchOrigin({ faces: [face], scale: 1.12, frame: FRAME, fills: Infinity, cap: CAP, safeTop: 250 }), Math.min(1920, (1.12 * (60 + 0.42 * 1500) - 250) / 0.12));
});

const at = (o, s, y) => o + (y - o) * s;
test("the review's zoom-ins: a close-up whose head the frame cuts keeps its mouth line, its lip line and its nose line where the placement put them (above the captions, or no lower than they stood)", () => {
  const cap = [192, 1375, 696, 65];
  // robe at 20.9 s: the features' bottom at 1276, the mouth line (with room for an open mouth) at 1372, just above the captions
  const robe = { box: [190, -60, 700, 1560], feat: [300, 640, 480, 636] };
  const p = punchPlan({ faces: [robe], scale: 1.12, frame: FRAME, fills: Infinity, cap, safeTop: 250, raise: "moderate" });
  assert.equal(p.scale, 1.12);
  for (const line of [noseOf(robe.box, robe.feat), lipOf(robe.box, robe.feat), mouthOf(robe.box, robe.feat)]) assert.ok(at(p.origin, p.scale, line) <= cap[1] + 1e-6, `a line from ${line} to ${at(p.origin, p.scale, line)}`);
  // the lower lip just inside the area, the nose line at 1190: the nose line went to 1424 before
  const lip = { box: [240, -60, 600, 1560], feat: [330, 700, 420, 700] };
  const q = punchPlan({ faces: [lip], scale: 1.12, frame: FRAME, fills: Infinity, cap, safeTop: 250, raise: "moderate" });
  assert.ok(at(q.origin, q.scale, noseOf(lip.box, lip.feat)) <= cap[1] && at(q.origin, q.scale, lipOf(lip.box, lip.feat)) <= cap[1], JSON.stringify(q));
  assert.ok(at(q.origin, q.scale, mouthOf(lip.box, lip.feat)) <= mouthOf(lip.box, lip.feat) + 1e-6, "the mouth line goes no lower than it stood");
});
test("a zoom-in that would push a mouth into the captions or the eyes under the apps' top bar is made smaller, else left out, and says why", () => {
  const cap = [192, 1375, 696, 65];
  // the eyes 5 px below the top bar, the mouth line below the captions' top: growing from below the mouth lifts the eyes under the bar
  const tight = { box: [190, -200, 700, 1700], feat: [300, 255, 480, 1150] };
  const p = punchPlan({ faces: [tight], scale: 1.12, frame: FRAME, fills: Infinity, cap, safeTop: 250, raise: "moderate" });
  assert.equal(p.scale, 1);
  assert.match(p.why, /^none: the mouth or the nose would go into the captions, or the eyes under/);
  // a face clear of the captions keeps its punch-in as asked
  assert.equal(punchPlan({ faces: [[355, 300, 370, 500]], scale: 1.12, frame: FRAME, fills: Infinity, cap }).scale, 1.12);
});

test("the check names the part a text lies on: the nose or the eyes, the mouth (both lips), the lower lip, the chin, or above a head on the hair", () => {
  const clips = { 1: { file: "01.mp4" } };
  const piece = { clip: 1, in: 0, out: 3, start: 0, duration: 3 };
  const run = (face, box) => textOnFaces({ pieces: [piece], clips, faces: { "01.mp4": { size: [1080, 1920], faces: Array.from({ length: 31 }, (_, i) => ({ t: i / 10, boxes: [face] })) } }, texts: [{ role: "captions", box, from: 0, to: 3 }], frame: FRAME })[0];
  // the features from 700 to 1280: the nose line at 1106, the lip line at 1210, the mouth line at 1367
  const face = { who: "A", box: [140, 300, 800, 1300], feat: [340, 700, 400, 580] };
  assert.ok(run(face, [192, 1380, 696, 100]).chin >= 2.9);
  assert.ok(run(face, [192, 1306, 696, 134]).lip >= 2.9);
  // the review's tight close-up: the whole area between the nose line and the lower lip is on the mouth, never "the lower lip"
  const m = run(face, [192, 1150, 696, 134]);
  assert.ok(m.mouth >= 2.9 && m.lip === 0 && m.nose === 0, JSON.stringify(m));
  assert.ok(run(face, [192, 1000, 696, 134]).nose >= 2.9);
  // captions above a low head, on its hair
  const low = { who: "A", box: [340, 1000, 400, 500], feat: [420, 1200, 240, 240] };
  const h = run(low, [192, 940, 696, 100]);
  assert.ok(h.hair >= 2.9 && h.nose === 0, JSON.stringify(h));
});

test("raise head: a punch-in never cuts a head further, it goes less close or not at all", () => {
  const cap = [192, 1375, 696, 65];
  // the mouth line below the captions' top: the lines want the origin below it, which lifts the head the frame cuts already
  const face = { box: [190, -60, 700, 1560], feat: [300, 640, 480, 700] };
  const mouth = punchPlan({ faces: [face], scale: 1.12, frame: FRAME, fills: Infinity, cap, safeTop: 250, raise: "mouth" });
  const head = punchPlan({ faces: [face], scale: 1.12, frame: FRAME, fills: Infinity, cap, safeTop: 250, raise: "head" });
  assert.equal(mouth.scale, 1.12);
  assert.equal(head.scale, 1);
  assert.match(head.why, /the head over the frame's top/);
});

test("a face that fills the frame already (its box half the frame's height or more) gets no punch-in, and build says why", () => {
  const tight = { box: [190, 300, 700, 1000], feat: [300, 700, 480, 450] };
  const p = punchPlan({ faces: [tight], scale: 1.12, frame: FRAME, cap: [192, 1375, 696, 65] });
  assert.equal(p.scale, 1);
  assert.match(p.why, /^none: the face fills 52 % of the frame's height already/);
  assert.equal(punchPlan({ faces: [{ box: [300, 300, 480, 800] }], scale: 1.12, frame: FRAME, cap: [192, 1375, 696, 65] }).scale, 1.12);
});

// ------------------------------------------------------------------- on its own: faces, picture, text
import { covering, whole, takeKind, inFrame, faceTrack, facesFault, rankPictures, knownSeconds, shotsInput, hookSpan, toCut, clockOf, pieceSpan, roomBelow } from "./lib/place.mjs";
import { pieceStyle } from "./lib/composition.mjs";

test("on its own: a video of the frame's shape covers it as it is; a wide one is drawn where its placement puts it, a face's box with it, raised by its lift", () => {
  assert.deepEqual(covering([1080, 1920], [1080, 1920]), { scale: 1, left: 0, top: 0 });
  assert.deepEqual(covering([720, 1280], [1080, 1920]), { scale: 1.5, left: 0, top: 0 });
  const wide = covering([1280, 720], [1080, 1920]);
  assert.ok(Math.abs(wide.scale - 1920 / 720) < 1e-4 && Math.abs(wide.left - (1080 - 1280 * wide.scale) / 2) < 0.1 && wide.top === 0, JSON.stringify(wide));
  // layout's 1:1 crop of a 720p interview at 1.5×, raised 100 px
  const pic = { scale: 1.5, left: -439.5, top: 420, lift: 100 };
  assert.deepEqual(inFrame([555, 150, 185, 185], pic), [393, 545, 277.5, 277.5]);
  // what lies below the frame's bottom: room to raise it without a ground
  assert.equal(roomBelow({ scale: 1.5, left: -439.5, top: 420 }, [1280, 720], 1920), 0);
  assert.equal(roomBelow({ scale: 1.2, left: 0, top: -50 }, [1080, 1920], 1920), 334);
});

test("on its own: the face layout places a video by is the face over the seconds the cut keeps of it, one moment every half second", () => {
  const list = { faces: Array.from({ length: 101 }, (_, i) => ({ t: i / 10, boxes: [{ who: "A", box: [300, i < 50 ? 500 : 900, 480, 640] }, { who: "B", box: [10, 10, 20, 20] }] })) };
  const track = faceTrack(list, [{ clip: 1, in: 1, out: 3 }, { clip: 2, in: 6, out: 8 }], 1);
  assert.deepEqual(track.map((m) => m.t), [1, 1.5, 2, 2.5, 3]);
  // the largest face: a take is one person
  assert.ok(track.every((m) => m.box[2] === 480 && m.box[1] === 500));
});

test("on its own: layout's text gets one shot per video on one clock, the stretches the cut keeps end to end with the faces as placed; the hook's seconds on that clock, and back in the cut's", () => {
  const clips = { 1: { n: 1, file: "01.mp4", duration: 20, width: 1080, height: 1920 }, 2: { n: 2, file: "02.mp4", duration: 30, width: 1280, height: 720 } };
  const at = (t, box) => ({ t, boxes: [{ who: "A", box, feat: [box[0] + 50, box[1] + 100, box[2] - 100, box[3] / 2] }] });
  const faces = { "01.mp4": { faces: Array.from({ length: 200 }, (_, i) => at(i / 10, [300, 570, 600, 900])) }, "02.mp4": { faces: Array.from({ length: 300 }, (_, i) => at(i / 10, [555, 150, 185, 185])) } };
  const pictures = { "01.mp4": { scale: 1, left: 0, top: 0 }, "02.mp4": { scale: 1.5, left: -439.5, top: 420 } };
  // the cut: 2–6 s of the first video, then 10–12 s of the second, then 8–9 s of the first
  const pieces = [{ clip: 1, in: 2, out: 6, start: 0, duration: 4 }, { clip: 2, in: 10, out: 12, start: 4, duration: 2 }, { clip: 1, in: 8, out: 9, start: 6, duration: 1 }];
  const clock = clockOf(clips, pieces);
  // the first video's two stretches end to end (0–4, 4–5), the second's a second after (6–8)
  assert.deepEqual(clock, { off: { 1: 0, 2: 6 }, at: [0, 6, 4] });
  const hook = hookSpan(pieces, 5, clock);
  assert.deepEqual(hook, { start: 0, end: 7, spans: [[0, 4], [6, 7]] });
  const { input, files } = shotsInput({ clips, pieces, faces, pictures, frame: [1080, 1920], clock, hook });
  assert.deepEqual(files, ["01.mp4", "02.mp4"]);
  assert.deepEqual(input.shots.map((s) => [s.start, s.end, s.weight]), [[0, 5, 5], [6, 8, 2]]);
  // no gap between the first video's stretches: 2 s left out lie between none of its moments
  const ts = input.shots[0].faces[0].track.map((m) => m.t);
  assert.ok(ts.every((t, i) => !i || t - ts[i - 1] <= 0.11 + 1e-9), JSON.stringify(ts.filter((t, i) => i && t - ts[i - 1] > 0.11)));
  // placed: the second video's face at 1.5× in its band
  assert.deepEqual(input.shots[1].faces[0].track[0].box, [393, 645, 277.5, 277.5]);
  assert.ok(input.shots[1].faces[0].track[0].feat, "the eyes, nose and mouth go along");
  // the close-up under the hook is calm, the wide one is not
  assert.equal(input.hook.calm, false);
  // back in the cut's time: 6.5 on the clock is 0.5 s into the second piece; 4.5 into the third
  assert.equal(toCut(6.5, pieces, clock), 4.5);
  assert.equal(toCut(4.5, pieces, clock), 6.5);
  // between the two sections: where the stretch before ends in the cut
  assert.equal(toCut(5.5, pieces, clock), 7);
});

test("on its own: before the cut is built, what it plays comes from cut.json's keeps", () => {
  const words = [0, 1, 2, 3, 4, 5].map((i) => ({ i, clip: 1, kind: "word", start: i, end: i + 0.5 }));
  assert.deepEqual(pieceSpan(null, { cut: { keep: [{ words: "1-2" }, { words: "4" }] }, words }).map((p) => [p.in, p.out, p.start]), [[1, 2.5, 0], [4, 4.5, 1.5]]);
});

test("on its own: a piece is drawn where its picture stands, and a punch-in grows about the same point of the frame as without one", () => {
  // covering, as before
  assert.equal(pieceStyle({ scale: 1 }, 1080, 1920), "");
  assert.equal(pieceStyle({ scale: 1.12, origin: 700 }, 1080, 1920), "transform: scale(1.12); transform-origin: 50% 700px");
  // placed and raised: its box, and the frame's point (540, 700) in its own box
  const pic = { left: -439.5, top: 320, width: 1920, height: 1080 };
  assert.equal(pieceStyle({ scale: 1, pic }, 1080, 1920), "left: -439.5px; top: 320px; width: 1920px; height: 1080px; object-fit: fill");
  assert.match(pieceStyle({ scale: 1.12, origin: 700, pic }, 1080, 1920), /transform-origin: 979\.5px 380px; clip-path: inset\(/);
  // a band over a ground goes closer inside its own edges: the part of the frame it filled (y 320–1400), cut out before it grows
  const clip = pieceStyle({ scale: 1.12, origin: 700, pic }, 1080, 1920).match(/inset\(([\d.]+)px ([\d.]+)px ([\d.]+)px ([\d.]+)px\)/).slice(1).map(Number);
  const grown = (v, o) => o + (v - o) * 1.12;
  assert.ok(Math.abs(grown(320 + clip[0], 700) - 320) < 0.2 && Math.abs(grown(320 + 1080 - clip[2], 700) - 1400) < 0.2, JSON.stringify(clip));
  assert.ok(Math.abs(grown(-439.5 + clip[3], 540) - 0) < 0.2 && Math.abs(grown(-439.5 + 1920 - clip[1], 540) - 1080) < 0.2, JSON.stringify(clip));
  // a crop's window narrower than the picture (layout's crop 4:5 of a wide take): only the window shows, also without a punch-in
  const crop = { left: -684.4, top: 285, width: 2400, height: 1350, window: [0, 285, 1080, 1350] };
  assert.equal(pieceStyle({ scale: 1, pic: crop }, 1080, 1920), "left: -684.4px; top: 285px; width: 2400px; height: 1350px; object-fit: fill");
  const wide = { left: -684.4, top: 285, width: 2400, height: 1350, window: [100, 285, 880, 1350] };
  assert.match(pieceStyle({ scale: 1, pic: wide }, 1080, 1920), /clip-path: inset\(0px 735\.6px 0px 784\.4px\)$/);
  // covering the frame: nothing to cut out
  assert.doesNotMatch(pieceStyle({ scale: 1.12, origin: 700, pic: { left: 0, top: -100, width: 1080, height: 2100 } }, 1080, 1920), /clip-path/);
});

test("on its own: faces of a phone's take stored on its side, found before the framing knew the rotation, are refused with whose they are; a box the tracker carried past the edge is taken to it", () => {
  // the review's take: an upright 1080×1920 picture stored as 1920×1080 with a rotation of −90
  const model = { by: "model", size: [1920, 1080], faces: [{ t: 1, boxes: [{ who: "A", box: [473, 82, 1048, 459] }] }] };
  assert.match(facesFault(model, [1080, 1920]), /^the faces the tool found \(not boxes of yours\) are of a picture of 1920×1080, the video shows 1080×1920/);
  const eye = { by: "eye", size: [1080, 1920], faces: Array.from({ length: 10 }, (_, i) => ({ t: i, boxes: [{ who: "A", box: [900, 1700, 600, 900] }] })) };
  assert.match(facesFault(eye, [1080, 1920]), /^your boxes \(--eye\) lie mostly outside the 1080×1920 picture at 10 of 10 moments/);
  const fine = { by: "model", size: [1080, 1920], faces: [{ t: 0, boxes: [{ who: "A", box: [300, 570, 600, 900] }] }] };
  assert.equal(facesFault(fine, [1080, 1920]), null);
  // a box a little past the bottom edge: taken to the edge for layout, which refuses faces not there
  const list = { size: [1080, 1920], faces: [{ t: 0, boxes: [{ who: "A", box: [300, 1200, 600, 800] }] }] };
  assert.deepEqual(faceTrack(list, [{ clip: 1, in: 0, out: 1 }], 1)[0].box, [300, 1200, 600, 720]);
});

test("on its own: a wide 720p take is placed so that its face comes nearest the usual size under the hard limit of enlargement, not smallest for sharpness (the review: the square band at 1.5×, the face 14 %, before the 4:5 crop at 1.875×)", () => {
  // layout's candidates for the Epps interview, in layout's order, the model's face 309 px tall
  const c = (fit, crop, scale, extra = {}) => ({ fit, crop, scale, left: 0, top: 0, hard: 0, unmet: [], soft: 0, problems: [], text: [], ...extra });
  const list = [c("crop", "1:1", 1.5), c("crop", "1:1", 1.5, { onGround: true }), c("crop", "4:5", 1.875, { soft: 1 }), c("inset", null, 0.8438), c("full", null, 2.6667, { hard: 1 })];
  const r = rankPictures(list, 309, 1920);
  assert.deepEqual(r.map((x) => x.n), [3, 1, 2, 4, 5]);
  assert.ok(Math.abs(r[0].face - 0.302) < 0.001);
  // a face that would come out larger than the usual band is not pushed past it
  assert.equal(rankPictures([c("crop", "4:5", 1.875), c("crop", "1:1", 1.5)], 400, 1920)[0].crop, "1:1");
});

test("on its own: faces that miss most of the cut are counted, so that place and check say so", () => {
  const clips = { 1: { file: "01.mp4" } };
  const pieces = [{ clip: 1, in: 0, out: 10, start: 0, duration: 10 }];
  const half = { "01.mp4": { faces: Array.from({ length: 30 }, (_, i) => ({ t: i / 10, boxes: [{ box: [0, 0, 10, 10] }] })) } };
  assert.ok(Math.abs(knownSeconds(pieces, clips, half) - 3) < 0.25);
  assert.equal(knownSeconds(pieces, clips, { "01.mp4": { faces: [] } }), 0);
});

test("on its own: footage with cuts in it, two people, or slides is told apart from one person's take over the seconds the cut keeps (the review: talk-show cuts became a strip at a third of its size, a talk's slides were cropped from the middle)", () => {
  const pieces = [{ clip: 1, in: 0, out: 10 }];
  const one = { shots: [{ start: 0, end: 20, kind: "people" }], faces: Array.from({ length: 100 }, (_, i) => ({ t: i / 10, boxes: [{ box: [0, 0, 10, 10] }] })) };
  assert.deepEqual(takeKind(one, pieces, 1), { shots: 1, people: 1, material: 0 });
  const cuts = { ...one, shots: [{ start: 0, end: 4, kind: "people" }, { start: 4, end: 8, kind: "people" }, { start: 8, end: 20, kind: "people" }] };
  assert.equal(takeKind(cuts, pieces, 1).shots, 3);
  // a flash of 0.7 s of the shot before at the take's start (the review's conference take) is no cut in it
  assert.equal(takeKind({ ...one, shots: [{ start: 0, end: 0.76, kind: "people" }, { start: 0.76, end: 20, kind: "people" }] }, pieces, 1).shots, 1);
  // a cut in a stretch the cut leaves out does not count
  assert.equal(takeKind(cuts, [{ clip: 1, in: 9, out: 12 }], 1).shots, 1);
  const two = { ...one, faces: one.faces.map((f, i) => (i % 3 ? f : { ...f, boxes: [...f.boxes, { box: [50, 0, 10, 10] }] })) };
  assert.equal(takeKind(two, pieces, 1).people, 2);
  const slides = { ...one, shots: [{ start: 0, end: 6, kind: "broll" }, { start: 6, end: 20, kind: "people" }] };
  assert.equal(takeKind(slides, pieces, 1).material, 6);
  // the whole picture, centred
  assert.deepEqual(whole([1920, 1080], [1080, 1920]), { scale: 0.5625, left: 0, top: 656.3 });
});
