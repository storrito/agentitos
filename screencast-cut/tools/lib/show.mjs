// Another video over a keep ("show" in cut.json: the finished result, the posted Story, a clip the
// person gives), instead of the recording. Made for bot 1832, whose person wanted the posted Story
// with its music under "and you can also hear the sound playing" where the recording showed the
// phone's way back; its agent built that by hand outside the skill for half an hour.
//
// The shown video plays over the keep's whole length (its words, its pauses, its hold), from
// "from" on at its own speed, while the keep's voice plays as cut; its long pauses are cut
// (cut.mjs: nothing of the recording is seen in them). It is the keep's picture: a "view", a
// "zoom" or a "layout" on the same keep are left out, and the build says so. With "sound" (0–1)
// its sound plays as a track of its own: a quarter of that level under the first words, rising
// over the last RISE seconds of them to the level at the keep's last word, held, out over the
// last FADE seconds. With "sound": {"hold": 0–1} it is silent under the words and comes up over
// FADE seconds after the last word to that level in the keep's "hold" (a clip that speaks: the
// run of 2026-11-19 had to drop "sound", and the hold went silent while the clip's speaker talked).
//
//   showOf(keep)                         → { file, from, sound } (a file's name alone: { file })
//   soundOf(show)                        → { level, hold }: "sound"'s level, and whether only in the hold
//   showProblem(keep, k, info)           → null, or the one sentence that says what to change
//                                          (info: probe() of its file, or { missing } or { error })
//   shownCopy(dir, file)                 → where the shown file's conversion is kept (keyed on its
//                                          size and time)
//   placeShows(cut, pieces, words, infoOf) → { sources, inserts, warnings, notes }: each show
//                                          keep's video as a source of its own (show-<k>), its
//                                          pieces' p.show set; inserts: the keeps whose sound plays
//   soundPoints({ sound, duration, spoken }) → the volume's points of a shown video's sound

import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { prepare, probe } from "./media.mjs";
import { transcribeFile, transcribeTool } from "./transcribe.mjs";

export const RISE = 1.5, FADE = 0.25;

// The shown file goes through the conversion the recordings get at `new` (media.prepare: H.264 at a
// steady frame rate, AAC, no file tags): a phone's clip (HEVC, a varying rate) shows black or
// stutters in Chrome. Kept in source/shown/ between builds, under the file's name, size and time.
export function shownCopy(dir, file, stat) {
  const base = path.basename(file, path.extname(file)).replace(/[^\w.-]+/g, "_").slice(0, 60);
  return path.join(dir, "source", "shown", `${base}-${stat.size}-${Math.round(stat.mtimeMs)}.mp4`);
}

// The shown file converted (once; kept): { info: probe() of the copy with its path } or { why }
export async function shownVideo(dir, file, fps = 30) {
  const copy = shownCopy(dir, file, fs.statSync(file));
  if (!fs.existsSync(copy)) {
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    const part = copy.replace(/\.mp4$/, ".part.mp4");
    try { await prepare(file, part, { fps, tags: false }); fs.renameSync(part, copy); }
    catch (e) {
      fs.rmSync(part, { force: true });
      return { why: `ffmpeg cannot convert ${file} into a video the preview plays (${(e.message.split(": ").slice(1).join(": ") || "it stopped").slice(0, 200)}); give it as MP4 (H.264), the result as it was posted or rendered.` };
    }
  }
  return { info: { ...probe(copy), path: copy } };
}

export const showOf = (keep) => (typeof keep.show === "string" ? { file: keep.show } : keep.show && typeof keep.show === "object" ? keep.show : {});

// Whether a keep draws the webcam's circle: every keep unless it says "circle": false; a keep that
// shows another video only where it says "circle": true (decided 2026-11-19 after the whole run of
// the day: the shown video is the keep's picture, not the speaker, and two faces side by side, the
// circle's silent beside the shown one's, read as a mistake). Without the circle the shown video
// takes the room a whole picture gets: as large as it fits above the caption line, in the middle.
export const circleOn = (keep) => (keep.show !== undefined ? keep.circle === true : keep.circle !== false);

const USAGE = `"show": "uploads/result.mp4", or {"file": "uploads/result.mp4", "from": 2, "sound": 0.8}`;

// "sound" as a number (its level under the words and up to it by the last), or {"hold": level}
// (silent under the words, at its level in the hold after them)
export const soundOf = (show) => (show.sound && typeof show.sound === "object" && !Array.isArray(show.sound)
  ? { level: Number(show.sound.hold) || 0, hold: true } : { level: Number(show.sound) || 0, hold: false });
const level01 = (x) => x >= 0 && x <= 1;
const isForm = (sound) => !!sound && typeof sound === "object" && !Array.isArray(sound);
// The shapes "sound" takes. The plain one is read as main reads it, Number(): every value main
// builds (true as 1, "" and null as 0, [0.8] and "0.8" as 0.8) builds the same, and soundRead says
// how it was read where it is no number. The hold form, which no older cut holds, is checked:
// {"hold": level}, its level a number or a number written as text, nothing else in it.
const soundShape = (sound) => (isForm(sound)
  ? Object.keys(sound).length === 1 && (typeof sound.hold === "number" || (typeof sound.hold === "string" && sound.hold.trim() !== "")) && level01(Number(sound.hold))
  : level01(Number(sound)));
// how a "sound" that is no number was read, and what to write: null for a number or the hold form
export function soundRead(sound, k) {
  if (sound === undefined || typeof sound === "number" || isForm(sound)) return null;
  const level = Number(sound);
  return `! keep ${k + 1}: "sound": ${JSON.stringify(sound)} is read as ${level}${level === 1 ? ", the voice's level" : level === 0 ? ", no sound" : ""}: ${level === 0 ? `leave it out for none, ` : ""}write a number 0–1 ("sound": ${level || 0.8}), or {"hold": 0.8} for its sound only in the "hold" after the last word.`;
}
export const HOLD_HEARD = 1;

// what is wrong with a keep's "show", in one sentence that says what to do; null where it is fine
export function showProblem(keep, k, info) {
  if (keep.show === undefined) return null;
  const show = showOf(keep), name = `✗ keep ${k + 1}: "show"`;
  if (typeof show.file !== "string" || !show.file.trim()) return `${name} names the video to play over the keep's words instead of the recording: ${USAGE}.`;
  if (info?.missing) return `${name}: there is no ${show.file}; give the video's path from the working directory (where the person's upload was saved), as ${USAGE}.`;
  if (info?.error || !info) return `${name}: ${show.file} is no video ffprobe can read (${info?.error || "nothing read"}); give a video file (MP4, MOV, WebM), the result as it was posted or rendered.`;
  if (!info.video) return `${name}: ${show.file} has no picture (a sound or a still); give a video file, the result as it was posted or rendered.`;
  if (show.from !== undefined && !(Number(show.from) >= 0 && Number(show.from) < info.duration)) return `${name} "from" is the second of ${show.file} to start at, 0–${info.duration.toFixed(1)}; set it within that or leave it out (0).`;
  if (show.sound !== undefined && !soundShape(show.sound)) return `${name} "sound" is ${JSON.stringify(show.sound)}, which is no level: write a number 0–1 (0.8 plays it well under the voice's words and full by the last), or {"hold": 0.8} for it only in the "hold" after the last word, silent under the words; leave it out for none.`;
  if (soundOf(show).level > 0 && !info.audio) return `${name} "sound": ${show.file} has no sound; leave "sound" out, or ask the person for the file with the sound (a Story's music is added by Instagram: only the posted Story, downloaded or recorded on the phone, has it).`;
  return null;
}

// what a show keep's other keys no longer do, said once per keep
function leftOut(keep) {
  const keys = [];
  if (keep.view === "face") keys.push(`"view": "face"`);
  else if (keep.view && keep.view !== "screen") keys.push(`"view": "${keep.view}"`);
  if (keep.zoom !== undefined && keep.zoom !== "off") keys.push(`"zoom"`);
  if (keep.layout !== undefined) keys.push(`"layout"`);
  return keys;
}

// Each show keep's video, timed over the keep's pieces. infoOf(file) is probe()'s answer (the
// build has checked it with showProblem). Returns the sources to add (show-<k>: the file by its
// absolute path, linked into assets/ as show-<k>.<ext>), the inserts with sound ({ k, key, file,
// from, start, duration, sound, spoken: the keep's last word's end from its start }), warnings
// (the video ends before the keep) and notes (what the keep's view, zoom or layout no longer do).
// room: how many seconds of the recording's room a muted piece of the voice carries (room.mjs,
// 0 where it has none), for what the line about a silent hold says is there
export function placeShows(cut, pieces, words, infoOf, { room = 0 } = {}) {
  const sources = {}, inserts = [], warnings = [], notes = [];
  for (const [k, keep] of (cut.keep || []).entries()) {
    if (keep.show === undefined) continue;
    const show = showOf(keep), info = infoOf(show.file);
    const ps = pieces.filter((p) => p.keep === k);
    if (!ps.length) continue;
    const start = ps[0].start, end = ps.at(-1).start + ps.at(-1).duration, from = Number(show.from) || 0;
    const duration = Math.min(end - start, info.duration - from);
    const said = words.filter((w) => w.start >= start - 0.01 && w.end <= end + 0.01);
    const spoken = said.length ? said.at(-1).end - start : 0;
    const { level: sound, hold: holdOnly } = soundOf(show);
    const read = soundRead(show.sound, k);
    if (read) notes.push(read);
    if (duration < end - start - 0.05) warnings.push(`keep ${k + 1}: ${show.file} ends ${(end - start - duration).toFixed(1)} s before the keep does (from ${from} s it has ${duration.toFixed(1)} s), so the keep's last ${(end - start - duration).toFixed(1)} s show the frame's ground${sound > 0 && spoken > duration - FADE ? `, and its sound ${holdOnly ? "is never heard, the video ending before the last word" : "stays low under the words and fades out where it ends, before the last word"}` : ""}: an earlier "from", a shorter "hold", or end the keep a word earlier`);
    // the keep's hold whose voice is muted (the recording's sound there is the next words, or a cut
    // filler): with no sound of the shown video in it, digital silence while the video plays on
    // Only for a "hold" the keep sets (the default tail's muted part is the same short silence as at
    // every keep's end) and from HOLD_HEARD s on; the hold form named only where it can be heard
    const muted = ps.filter((p) => p.mute && p.hold && p.start < start + duration - 0.05).reduce((t, p) => t + Math.min(p.duration, start + duration - p.start), 0);
    // (a hold the keep asks is cut short by 0.3 s or more only where the recording ends: cut.mjs
    // drops a muted hold under 0.3 s, never more)
    const keepHold = end - start - spoken, clipHold = duration - spoken, asked = keep.hold !== undefined ? Number(keep.hold) || 0 : null;
    const holdHeard = holdOnly && spoken > 0.3 ? clipHold >= HOLD_HEARD - 1e-6 : clipHold > FADE + 0.1;
    if (asked !== null && muted >= HOLD_HEARD - 0.05 && !(sound > 0 && info.audio && holdHeard) && !(holdOnly && sound > 0)) {
      // (muted counts only while the shown video plays, so its 1 s and more is room for the hold form)
      const way = !info.audio ? `, which has no sound: end the keep at its last word, "hold": 0`
        : `: let its sound play there, "sound": {"hold": 0.8} (silent under the words), or end the keep at its last word, "hold": 0`;
      // what is there: the recording's room as long as it lasts (each muted piece from its start),
      // then silence
      const heard = Math.min(muted, room);
      const there = heard <= 0.05 ? `${muted.toFixed(1)} s of silence` : heard >= muted - 0.05 ? `${muted.toFixed(1)} s of the room alone` : `${muted.toFixed(1)} s of the room alone for ${heard.toFixed(1)} s, then silence`;
      warnings.push(`keep ${k + 1}: its "hold" after the last word is ${there} (the recording's sound stops with the words there) while ${show.file} plays on${way}`);
    }
    const key = `show-${k + 1}`;
    sources[key] = { file: `${key}${path.extname(info.path || show.file) || ".mp4"}`, path: info.path || path.resolve(show.file), width: info.width, height: info.height, offset: 0, video: true, duration: info.duration };
    for (const p of ps) p.show = { source: key, in: from + (p.start - start), until: start + duration };
    const skipped = leftOut(keep);
    if (skipped.length) notes.push(`! keep ${k + 1}: "show" plays ${show.file} over the whole keep, so its ${skipped.join(" and ")} ${skipped.length > 1 ? "are" : "is"} left out (the shown video is the keep's picture); to see ${keep.view === "face" ? "the face" : keep.zoom !== undefined && keep.zoom !== "off" ? "the zoom" : "that picture"} too, give it a keep of its own without "show".`);
    if (sound > 0 && duration > 0.1 && !(holdOnly && spoken > 0.3 && !holdHeard)) {
      inserts.push({ k, key, file: show.file, src: info.path || show.file, from, start, duration, sound, spoken, ...(holdOnly ? { hold: true } : {}),
        // what a hold form would have here: room for it, or what holds it short (the keep's own
        // "hold", the shown video's or the recording's end), for the listening line
        room: clipHold >= HOLD_HEARD - 1e-6 ? "ok" : clipHold < keepHold - 0.05 ? "clip" : asked !== null && asked > keepHold + 0.3 ? "end" : "keep" });
    } else if (sound > 0 && holdOnly && spoken > 0.3) {
      // what holds the hold short: the shown video's end, the recording's end (the cut's last keep),
      // or the keep's own "hold"; the form needs HOLD_HEARD s
      const why = clipHold < keepHold - 0.05 ? `${show.file} ends ${clipHold > 0.05 ? `${clipHold.toFixed(1)} s after the last word` : "before the last word"}: an earlier "from" so that it plays ${HOLD_HEARD} s on after it, or drop "sound"`
        : asked !== null && asked > keepHold + 0.3 ? `the recording ends ${keepHold > 0.05 ? `${keepHold.toFixed(1)} s after the last word, so the keep holds that` : "at the last word, so the keep cannot hold"}, not the ${asked} s asked: end the cut on an earlier sentence with a pause after it, or drop "sound"`
        : `the keep holds ${Math.max(0, keepHold).toFixed(1)} s after the last word: give it "hold": 1.5`;
      notes.push(`! keep ${k + 1}: "sound": {"hold": ${sound}} plays only after the last word and needs ${HOLD_HEARD} s there to be heard, so it stays silent; ${why}.`);
    }
  }
  return { sources, inserts, warnings, notes };
}

const n = (x) => +x.toFixed(3);

// The volume of a shown video's sound over its insert (seconds from its start): a quarter of its
// level under the first words, rising over the last RISE s of them to its level at the last word,
// held, out over the last FADE s. A keep without words (by its time) has it up at once. The rise
// belongs to the last word: a video that ends before that word keeps its sound low under the words
// and fades out at its own end (it never comes up while the speaker is still talking). In the hold
// alone (hold: true): nothing under the words, up over FADE s from the last word's end.
export function soundPoints({ sound, duration, spoken, hold = false }) {
  const top = sound, low = top / 4, d = duration, out = Math.max(0, d - FADE), s = Math.max(spoken || 0, 0);
  if (hold && s > 0.3) return [{ t: 0, v: 0 }, { t: n(s), v: 0 }, { t: n(Math.min(s + FADE, out)), v: top }, { t: n(out), v: top }, { t: n(d), v: 0 }]
    .filter((x, j, all) => j === 0 || x.t > all.slice(0, j).reduce((m, y) => Math.max(m, y.t), -1));
  if (s > 0.3 && s > out) return [{ t: 0, v: low }, { t: n(out), v: low }, { t: n(d), v: 0 }].filter((x, j, all) => j === 0 || x.t > all[j - 1].t);
  return (s > 0.3 ? [{ t: 0, v: low }, { t: n(Math.max(0, s - RISE)), v: low }, { t: n(s), v: top }] : [{ t: 0, v: 0 }, { t: n(Math.min(0.2, out)), v: top }])
    .concat([{ t: n(out), v: top }, { t: n(d), v: 0 }])
    .filter((x, j, all) => j === 0 || x.t > all.slice(0, j).reduce((m, y) => Math.max(m, y.t), -1));
}

// Whether a shown video speaks while its sound plays: agentitos' transcribe skill hears its stretch
// once (the cut-out sound, `audio`), kept in source/shown/ under the clip's content (sha256 of the
// converted copy), "from" and the stretch's length, so a second build does not ask again and a
// changed clip or stretch is heard anew. Only the build's line uses it, never the composition.
// Returns { words: [{ start, end }] in seconds of the stretch, cost (dollars), seconds, kept } or
// { why } (no tool, no key or route, a failure, nonsense, over LISTEN s): the line then says what it
// says without it.
export const LISTEN = 20;
export async function listenShown({ dir, src, from, duration, audio, timeout = LISTEN, tool = transcribeTool() }) {
  let key;
  try { key = crypto.createHash("sha256").update(fs.readFileSync(src)).digest("hex").slice(0, 16); } catch (e) { return { why: `the clip could not be read (${e.message.split("\n")[0]})` }; }
  const kept = path.join(dir, "source", "shown", `heard-${key}-${(+from).toFixed(3)}-${(+duration).toFixed(3)}.json`);
  try {
    const k = JSON.parse(fs.readFileSync(kept, "utf8"));
    if (k.key === key && k.from === +from && k.duration === +duration && Array.isArray(k.words)) return { words: k.words, cost: k.cost, seconds: k.seconds, kept: true };
  } catch {}
  if (!tool) return { why: "agentitos' transcribe skill is not beside this one" };
  const t0 = Date.now();
  let r;
  try { r = await transcribeFile(audio, { timeout }); } catch (e) { return { why: String(e?.message || e).split("\n")[0].slice(0, 160) }; }
  const seconds = +((Date.now() - t0) / 1000).toFixed(1);
  if (!r || !Array.isArray(r.words)) return { why: "transcribe answered no words list" };
  const words = r.words.filter((w) => w && (w.kind === undefined || w.kind === "word") && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start && w.start >= -0.5 && w.end <= duration + 1)
    .map((w) => ({ start: +w.start.toFixed(2), end: +w.end.toFixed(2) }));
  if (words.length !== r.words.filter((w) => w?.kind === undefined || w?.kind === "word").length) return { why: "transcribe answered words outside the clip's stretch" };
  const cost = Number.isFinite(r.cost) ? r.cost : null;
  try { fs.mkdirSync(path.dirname(kept), { recursive: true }); fs.writeFileSync(kept, JSON.stringify({ key, from: +from, duration: +duration, words, cost, seconds }) + "\n"); } catch {}
  return { words, cost, seconds, kept: false };
}

// stretches of speech from words (gaps under GAP s joined)
const GAP = 0.6;
function spans(words) {
  const out = [];
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && w.start - last[1] < GAP) last[1] = Math.max(last[1], w.end); else out.push([w.start, w.end]);
  }
  return out;
}

// What was heard, for the build's line (i: the insert; heard: listenShown's answer; said: the
// speaker's words in the cut's seconds). null where nothing was heard: the general sentence then.
export function heardSaid(i, heard, said, clock) {
  if (!heard || heard.why) return null;
  const cost = `${heard.kept ? "heard before, kept" : `heard in ${heard.seconds} s`}${heard.cost != null && !heard.kept ? `, ${+(heard.cost * 100).toFixed(2)} cents` : ""}`;
  if (!heard.words.length) return `it has no words (${cost})`;
  const clip = spans(heard.words.map((w) => ({ start: i.start + w.start, end: i.start + w.end })));
  const mine = spans(said.filter((w) => w.end > i.start && w.start < i.start + i.duration));
  const both = [];
  for (const [a, b] of clip) for (const [c, d] of mine) { const x = Math.max(a, c), y = Math.min(b, d); if (y - x > 0.05) both.push([x, y]); }
  const at = (l) => `${clock(l[0][0])} to ${clock(l.at(-1)[1])}`;
  if (both.length) {
    const sum = both.reduce((t, [a, b]) => t + b - a, 0);
    const hold = i.duration - i.spoken;
    // the hold form named only where the keep's hold can hold it (HOLD_HEARD s), or can be made to
    const form = i.room === "clip" || i.room === "end" ? "" : `let it speak only in the "hold" after your last word, "sound": {"hold": ${i.sound}} (silent under your words${i.room === "keep" ? `, with "hold": 1.5 on the keep: its hold is ${hold.toFixed(1)} s now` : ""}), or `;
    return `two voices at once from ${at(both)} (${sum.toFixed(1)} s: the clip speaks ${at(clip)}, the speaker ${at(mine)}): ${form}drop "sound", or show it where you do not speak (${cost})`;
  }
  return `it speaks ${at(clip)}, where the speaker does not: no two voices at once (${cost})`;
}

// The build's line for a shown video whose sound plays (i: an insert of placeShows, measured by
// cutShownSound): where it runs under the keep's words, that it does, and so when "sound" is right.
// The tool cannot know whether a clip speaks; the run of 2026-11-19 had a clip's speech under the
// speaker's for 2.7 s, two voices at once.
// heard: heardSaid's sentence where the clip was listened to, else null (the general sentence).
export function soundSaid(i, target, clock, heard = null) {
  const tail = `measured ${i.lufs ?? "too quiet to measure"}${i.lufs != null ? " LUFS" : ""}, brought ${i.gain >= 0 ? "+" : ""}${i.gain} dB to the voice's ${target} LUFS ("sound": 1 is the voice's level), through the voice's bus.`;
  if (i.hold && i.spoken > 0.3) return `keep ${i.k + 1}: the sound of ${i.file} is silent under the keep's words and plays at ${i.sound} in its hold, from ${clock(i.start + i.spoken)} for ${(i.duration - i.spoken).toFixed(1)} s; ${tail}`;
  const level = i.spoken > i.duration - FADE ? "at a quarter of its level, the video ending before the last word" : `at a quarter of its level under the first, up to ${i.sound} by the last at ${clock(i.start + i.spoken)}`;
  const under = heard ? `runs under the keep's words (${level}); ${heard}; `
    : i.spoken > 0.3 ? `runs under the keep's words (${level}), so if it speaks, its speech is heard under the speaker's, two voices at once: "sound" is for music, ambience or a result whose sound is the point; a clip that speaks gets "sound": {"hold": ${i.sound}}, heard only in the "hold" after the last word${i.room === "clip" || i.room === "end" ? ` (here the keep's hold after the last word is ${Math.max(0, i.duration - i.spoken).toFixed(1)} s, under the ${HOLD_HEARD} s it needs)` : i.room === "keep" ? ` (with "hold": 1.5 on the keep)` : ""}; `
    : "";
  return `keep ${i.k + 1}: the sound of ${i.file} ${under}${tail}`;
}

// The gain in dB that brings a shown video's sound (its stretch's integrated loudness, ebur128 as
// finish measures) to the voice's level before the bus (voice-sound's master loudness), so that "sound" means the
// same for a quiet clip and a loud one: 1 is the voice's loudness, 0.8 about 2 dB under it. A
// stretch too quiet to measure (silence) is left as it is.
export function levelGain(lufs, target) {
  return Number.isFinite(lufs) && lufs > -60 ? +(target - lufs).toFixed(2) : 0;
}

// A shown video's stretch of sound (from, duration) cut out to `out` (AAC, 48 kHz, no file tags),
// measured once (ebur128's integrated loudness) and brought to `target` LUFS, a limiter under
// 0 dBFS. Returns { ok, lufs, gain } or { ok: false, why }.
export function cutShownSound(file, from, duration, out, target) {
  const m = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-ss", String(from), "-t", duration.toFixed(3), "-i", file, "-vn", "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
  const measured = Number((m.stderr || "").slice((m.stderr || "").lastIndexOf("Summary:")).match(/I:\s*(-?[\d.]+) LUFS/)?.[1]);
  const lufs = Number.isFinite(measured) && measured > -60 ? measured : null, gain = levelGain(measured, target);
  const a = spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(from), "-t", duration.toFixed(3), "-i", file, "-vn", "-map_metadata", "-1",
    "-af", `volume=${gain}dB,alimiter=limit=0.89:level=false`, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", out], { encoding: "utf8" });
  return a.status === 0 ? { ok: true, lufs, gain } : { ok: false, why: (a.stderr || "").trim().split("\n").pop() };
}
