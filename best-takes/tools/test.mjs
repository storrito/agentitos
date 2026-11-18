// The cut's voice as one file, on made-up recordings (a tone where someone speaks), what becomes
// of a pause, on made-up movement of a camera and of a screen, and the cut's text as people read
// it, on made-up words; speech not written down in a keep, and a voice recorded alone (its
// breaths of the room's quiet, the joins, build and check without a picture). No request.
//
//   node --test tools/test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { voiceTrack } from "./lib/tracks.mjs";
import { plan, capitalised, endsSentence, roomQuiet, BREATH } from "./lib/cut.mjs";
import { HOP, envelope, loudnessBlocks } from "./lib/voice.mjs";
import { probe, playable, samples, copyName } from "./lib/media.mjs";
import { overTarget, rules, brief } from "./brief.mjs";

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

// ------------------------------------------------------------- speech not written down
// "The app opens faster": the speech model wrote "The" of a first attempt and "app opens
// faster" of the last; the attempt between them has voice and no words (an item of kind
// "unwritten", as takes.mjs new makes of the transcribe skill's "unwritten").
function retried() {
  const items = [["The", 1.0, 1.3], ["…", 1.8, 2.9, "unwritten"], ["app", 3.4, 3.9], ["opens", 4.0, 4.2], ["faster.", 4.3, 4.8], ["Next.", 5.6, 6.0]];
  const words = items.map(([text, start, end, kind = "word"], i) => ({ i, clip: 1, text, kind, start, end }));
  const env = new Float32Array(Math.ceil(7 / HOP));
  for (const w of words) env.fill(1, Math.round(w.start / HOP), Math.round(w.end / HOP));
  return { words, voices: { 1: { env, thr: 0.5, blocks: [], duration: 7 } } };
}

test("a keep that runs across speech not written down is an error that says why and what to do", () => {
  const { words, voices } = retried();
  const r = plan(words, { keep: [{ words: "0-4" }] }, SETTINGS, voices);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /keep 1 \(0-4\) runs across speech not written down \(\[1\] at 1\.8 s, 1\.1 s long\)/);
  assert.match(r.errors[0], /different attempts/);
  assert.match(r.errors[0], /start it after it/);
  // started after it: no error, and the cut before "app" lies after the voice without words
  const after = plan(words, { keep: [{ words: "2-5" }] }, SETTINGS, voices);
  assert.deepEqual(after.errors, []);
  assert.ok(after.pieces[0].in >= 2.9, `the keep starts at ${after.pieces[0].in}, inside the speech not written down`);
});

test("speech not written down inside a keep: \"cut\" cuts it out and says so, \"keep\" plays it as recorded; never as a pause", () => {
  const { words, voices } = retried();
  const cut = plan(words, { keep: [{ words: "0-4", unwritten: "cut" }] }, SETTINGS, voices);
  assert.deepEqual(cut.errors, []);
  assert.deepEqual(cut.removed.filter((x) => x.kind === "unwritten").map((x) => [x.from, x.to]), [[1.8, 2.9]]);
  assert.equal(cut.removed.filter((x) => x.kind === "pause").length, 0);
  assert.ok(!cut.pieces.some((p) => p.in < 2.9 && p.out > 1.8), "nothing of it plays");
  const kept = plan(words, { keep: [{ words: "0-4", unwritten: "keep" }] }, SETTINGS, voices);
  assert.deepEqual(kept.errors, []);
  assert.ok(kept.pieces.some((p) => p.in <= 1.8 && p.out >= 2.9), "it plays");
  assert.equal(text(kept), "The app opens faster.");
});

test("the brief shows speech not written down where it is, never as a pause, and the rules say what it is", () => {
  const { words } = retried();
  const md = brief({ 1: { n: 1, file: "01.mp4", from: "uploads/take.mp4", duration: 7 } }, words, { pause: 1, pauses: "picture", loudness: -14, final: -14 });
  assert.match(md, /\[0\]The \[1\]\(speech not written down, 1\.1 s\) \[2\]app/);
  assert.doesNotMatch(md, /s pause\] \[2\]app/);
  assert.match(md, /a keep never runs across one/);
  assert.match(md, /"unwritten": "cut"/);
});

// --------------------------------------------------------------------------- sound alone
// Words of 0.4 s with 0.1 s between them, in stretches; a pause of 2 s or more between stretches.
const STRETCHES = [[1.0, ["Das", "ist", "gut."]], [4.4, ["und", "weiter"]], [6.8, ["so", "geht's."]], [10.0, ["Neuer", "Teil."]]];
function spoken() {
  const words = [];
  for (const [at, texts] of STRETCHES) texts.forEach((text, k) => words.push({ i: words.length, clip: 1, text, kind: "word", start: +(at + k * 0.5).toFixed(2), end: +(at + k * 0.5 + 0.4).toFixed(2) }));
  return words;
}

test("sound alone: a pause goes, the room's quiet lies between the stretches, 0.42 s after a sentence, 0.2 s inside one, a keep's breath before it", () => {
  const words = spoken(), duration = 15;
  // the voice where the words are, a room a little louder from 7 s on, quietest at the end
  const env = Float32Array.from({ length: duration / HOP }, (_, f) => (words.some((w) => f * HOP >= w.start && f * HOP < w.end) ? 0.2 : f * HOP > 12 ? 0.001 : 0.003));
  const voices = { 1: { env, thr: 0.02, blocks: Array.from({ length: 150 }, (_, k) => ({ t: k / 10, m: words.some((w) => k / 10 - 0.2 >= w.start && k / 10 - 0.2 < w.end) ? -20 : -60 })), duration } };
  const near0 = (x, y) => assert.ok(Math.abs(x - y) <= 0.035, `${x} is not ${y}`);
  assert.deepEqual(roomQuiet(env, 0.02), { from: 12, to: 15 });
  // never voice: with no three quiet seconds the longest quiet there is, with none at all nothing
  const busy = Float32Array.from({ length: 2000 }, (_, f) => (f % 130 < 50 ? 0.2 : 0.002));
  const q = roomQuiet(busy, 0.02);
  assert.ok(q && q.to - q.from <= 0.75 && q.to - q.from >= 0.5, JSON.stringify(q));
  for (let f = Math.round(q.from / HOP); f < Math.round(q.to / HOP); f++) assert.ok(busy[f] < 0.02, `voice at ${f * HOP} s`);
  assert.equal(roomQuiet(new Float32Array(2000).fill(0.2), 0.02), null);
  // a gate's digital silence between words is no room: speech there is not taken either
  const gated = Float32Array.from({ length: 1000 }, (_, f) => (f >= 100 && f < 500 ? 0.2 : 0));
  const g = roomQuiet(gated, 0.02);
  assert.ok(g.to <= 1 || g.from >= 5, JSON.stringify(g));
  const r = plan(words, { keep: [{ words: "0-6" }, { words: "7-8", breath: 1 }] }, { ...SETTINGS, audio: true }, voices, null);
  assert.deepEqual(r.errors, []);
  const quiet = r.pieces.filter((p) => p.quiet);
  // after "gut." a sentence ends, after "weiter" none does, then the new part
  assert.equal(quiet.length, 3);
  near0(quiet[0].duration, BREATH.sentence); near0(quiet[1].duration, BREATH.inside); near0(quiet[2].duration, 1);
  for (const q of quiet) assert.ok(q.in >= 12 && q.out <= 15 + 1e-9, `the quiet is the room's quietest: ${q.in}–${q.out}`);
  // each at the level of the take before it, the pauses cut and said so
  for (const q of quiet) assert.equal(q.gain, r.pieces[r.pieces.indexOf(q) - 1].gain);
  assert.ok(r.removed.filter((x) => x.kind === "pause").every((x) => /sound alone, a breath/.test(x.why)));
  // the words timed in the cut: after the first breath, "und" begins about 0.42 s + the room the cut points leave after "gut."
  const gut = r.words.find((w) => w.text === "gut."), und = r.words.find((w) => w.text === "und");
  assert.ok(und.start - gut.end > 0.55 && und.start - gut.end < 0.8, `${und.start - gut.end} s between "gut." and "und"`);
  // a keep that asks for a breath gets it even where it follows on in the recording; without, it plays on
  const on = (cut) => plan(words, cut, { ...SETTINGS, audio: true }, voices, null).pieces.filter((p) => p.quiet).map((p) => +p.duration.toFixed(2));
  assert.deepEqual(on({ keep: [{ words: "0-1" }, { words: "2", breath: 1 }] }), [1]);
  assert.deepEqual(on({ keep: [{ words: "0-1" }, { words: "2" }] }), []);
  // an announced wait is the pause: no breath beside it, whatever the keep's gain; one the next keep asks for stays
  const waits = (gain, breath) => plan(words, { keep: [{ words: "0-2", ...(gain ? { gain } : {}) }, { words: "3-4", ...(breath ? { breath } : {}) }], waits: [2] }, { ...SETTINGS, audio: true }, voices, null).pieces;
  for (const gain of [0, -3]) {
    const p = waits(gain);
    assert.equal(p.filter((x) => !x.words.length && !x.quiet && !x.mute).length, 1, "the wait is a piece of its own");
    assert.equal(p.filter((x) => x.quiet).length, 0);
  }
  assert.deepEqual(waits(0, 1).filter((x) => x.quiet).map((x) => +x.duration.toFixed(2)), [1]);
  assert.match(plan(words, { keep: [{ words: "0-2", breath: "long" }] }, { ...SETTINGS, audio: true }, voices, null).errors[0], /"breath" is the seconds/);
  // a video's cut has no breaths
  assert.equal(plan(words, { keep: [{ words: "0-6" }] }, SETTINGS, voices, null).pieces.filter((p) => p.quiet).length, 0);
});

// a recording of sound alone: a tone where each word is, over a faint noise, 3 s of quiet at the end
function soundAlone(dir, name, words, seconds) {
  const file = path.join(dir, name);
  const on = words.map((w) => `between(t\\,${w.start}\\,${w.end})`).join("+");
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `aevalsrc=0.3*sin(2*PI*220*t)*(${on})+0.002*sin(2*PI*1500*t)*(1-0.5*gt(t\\,${seconds - 3})):s=16000:d=${seconds}`, file], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return file;
}

test("sound alone: an MP3, an M4A or a video file without a picture is a recording; a video is not", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "best-takes-test-"));
  try {
    const wav = soundAlone(dir, "a.wav", spoken(), 6);
    for (const [name, codec] of [["a.mp3", "libmp3lame"], ["a.m4a", "aac"], ["noPicture.mp4", "aac"]]) {
      const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", wav, "-c:a", codec, path.join(dir, name)], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      const p = probe(path.join(dir, name));
      assert.equal(p.audio, true, name);
      near(p.duration, 6, 0.1);
    }
    assert.equal(probe(wav).audio, true);
    assert.equal(probe(recording(dir, "v.mp4", 220, 1)).audio, undefined);
    assert.deepEqual([copyName(1, "x/a.MP3", true), copyName(2, "noPicture.mp4", true), copyName(3, "v.mov", false)], ["01.mp3", "02.m4a", "03.mp4"]);
    // the copy is the file itself
    assert.equal(playable(path.join(dir, "a.mp3"), path.join(dir, "01.mp3")), "linked");
    assert.equal(fs.statSync(path.join(dir, "01.mp3")).size, fs.statSync(path.join(dir, "a.mp3")).size);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("sound alone: build writes the cut's voice at −14 LUFS with its words timed in it, the room's quiet at the joins and no click, no project; check reads it", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "best-takes-test-"));
  try {
    const words = spoken(), seconds = 15, takes = path.join(dir, "takes"), src = path.join(takes, "source");
    fs.mkdirSync(src, { recursive: true });
    const file = soundAlone(src, "01.wav", words, seconds);
    fs.writeFileSync(path.join(src, "01.env"), Buffer.from(envelope(samples(file)).buffer));
    fs.writeFileSync(path.join(src, "01.loudness.json"), JSON.stringify(loudnessBlocks(file)));
    fs.writeFileSync(path.join(src, "words.json"), JSON.stringify({ asr: "test", clips: { 1: { n: 1, file: "01.wav", from: "uploads/voice.wav", duration: seconds, audio: true, lufs: -16 } }, words }));
    fs.writeFileSync(path.join(src, "brief.md"), brief({ 1: { n: 1, file: "01.wav", from: "uploads/voice.wav", duration: seconds, audio: true } }, words, { pause: 1, pauses: "picture", loudness: -14, final: -14 }));
    fs.writeFileSync(path.join(takes, "cut.json"), JSON.stringify({ keep: [{ words: "0-6" }, { words: "7-8", breath: 1 }] }));
    const tool = path.join(path.dirname(new URL(import.meta.url).pathname), "takes.mjs");
    const built = spawnSync(process.execPath, [tool, "build", takes, "--out", path.join(dir, "artifacts", "voice.m4a")], { encoding: "utf8" });
    assert.equal(built.status, 0, built.stdout + built.stderr);
    assert.match(built.stdout, /3 breaths of the room's quiet/);
    assert.match(built.stdout, /No HyperFrames project/);
    assert.ok(!fs.existsSync(path.join(takes, "composition")), "no project");
    const e = JSON.parse(fs.readFileSync(path.join(takes, "edit.json"), "utf8"));
    assert.equal(e.audio, true);
    near(e.loudness.lufs, -14, 1);
    assert.ok(e.loudness.peak <= -1, `true peak ${e.loudness.peak}`);
    assert.deepEqual(e.words.map((w) => w.text), words.map((w) => w.text));
    const voice = path.join(takes, "voice.cut.m4a");
    assert.ok(fs.existsSync(path.join(dir, "artifacts", "voice.m4a")) && fs.existsSync(path.join(dir, "artifacts", "voice.srt")));
    near(Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", voice], { encoding: "utf8" }).stdout), e.duration, 0.06);
    // every word where its tone is in the voice, the quiet between them the room's, never silence
    const x = samples(voice), at = (t, d = 0.05) => { let s = 0, n = 0; for (let i = Math.round(t * 16000); i < Math.round((t + d) * 16000); i++) { s += x[i] * x[i]; n++; } return Math.sqrt(s / n); };
    for (const w of e.words) assert.ok(at((w.start + w.end) / 2 - 0.025) > 0.05, `"${w.text}" sounds at ${w.start}`);
    const loud = at((e.words[0].start + e.words[0].end) / 2 - 0.025);
    for (const p of e.pieces.filter((q) => q.quiet)) {
      const room = at(p.start + p.duration / 2 - 0.05, 0.1);
      assert.ok(room > 1e-4 && room < loud / 20, `the breath at ${p.start} s: ${room}`);
      // no click where the stretches meet the quiet: nothing in the 20 ms around a join louder than the quiet's own peaks
      for (const t of [p.start, p.start + p.duration]) {
        let peak = 0;
        for (let i = Math.round((t - 0.01) * 16000); i < Math.round((t + 0.01) * 16000); i++) peak = Math.max(peak, Math.abs(x[i]));
        assert.ok(peak < 0.02, `a click at ${t} s: ${peak}`);
      }
    }
    // check: no HyperFrames, the breaths and the loudness said
    const checked = spawnSync(process.execPath, [tool, "check", takes], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    assert.match(checked.stdout, /the room's quiet, 0\.43 s/);
    assert.match(checked.stdout, /the voice as a whole is at -1[345](\.\d)? LUFS/);
    assert.match(checked.stdout, /The voice: /);
    // finish and captions say why not, in one sentence
    for (const args of [["finish", takes, voice], ["captions", takes, "--style", "bold"]]) {
      const no = spawnSync(process.execPath, [tool, ...args], { encoding: "utf8" });
      assert.equal(no.status, 1);
      assert.match(no.stdout, /sound alone/);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
