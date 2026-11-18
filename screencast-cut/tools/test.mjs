// What becomes of a pause, on made-up movement of a screen and of the phone's camera, and the
// cut's text as people read it (captions, subtitles), on made-up words. No request, no video.
//
//   node --test tools/test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { plan, capitalised, endsSentence } from "./lib/cut.mjs";
import { pauseMoves, whileSpeaking, MOVING } from "./lib/activity.mjs";
import { HOP } from "./lib/voice.mjs";

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
