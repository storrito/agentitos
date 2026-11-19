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
// last FADE seconds.
//
//   showOf(keep)                         → { file, from, sound } (a file's name alone: { file })
//   showProblem(keep, k, info)           → null, or the one sentence that says what to change
//                                          (info: probe() of its file, or { missing } or { error })
//   placeShows(cut, pieces, words, infoOf) → { sources, inserts, warnings, notes }: each show
//                                          keep's video as a source of its own (show-<k>), its
//                                          pieces' p.show set; inserts: the keeps whose sound plays
//   soundPoints({ sound, duration, spoken }) → the volume's points of a shown video's sound

import path from "node:path";

export const RISE = 1.5, FADE = 0.25;

export const showOf = (keep) => (typeof keep.show === "string" ? { file: keep.show } : keep.show && typeof keep.show === "object" ? keep.show : {});

const USAGE = `"show": "uploads/result.mp4", or {"file": "uploads/result.mp4", "from": 2, "sound": 0.8}`;

// what is wrong with a keep's "show", in one sentence that says what to do; null where it is fine
export function showProblem(keep, k, info) {
  if (keep.show === undefined) return null;
  const show = showOf(keep), name = `✗ keep ${k + 1}: "show"`;
  if (typeof show.file !== "string" || !show.file.trim()) return `${name} names the video to play over the keep's words instead of the recording: ${USAGE}.`;
  if (info?.missing) return `${name}: there is no ${show.file}; give the video's path from the working directory (where the person's upload was saved), as ${USAGE}.`;
  if (info?.error || !info) return `${name}: ${show.file} is no video ffprobe can read (${info?.error || "nothing read"}); give a video file (MP4, MOV, WebM), the result as it was posted or rendered.`;
  if (!info.video) return `${name}: ${show.file} has no picture (a sound or a still); give a video file, the result as it was posted or rendered.`;
  if (show.from !== undefined && !(Number(show.from) >= 0 && Number(show.from) < info.duration)) return `${name} "from" is the second of ${show.file} to start at, 0–${info.duration.toFixed(1)}; set it within that or leave it out (0).`;
  if (show.sound !== undefined && !(Number(show.sound) >= 0 && Number(show.sound) <= 1)) return `${name} "sound" is the level of its sound, 0–1 (0.8 plays it well under the voice's words and full by the last); leave it out for none.`;
  if (Number(show.sound) > 0 && !info.audio) return `${name} "sound": ${show.file} has no sound; leave "sound" out, or ask the person for the file with the sound (a Story's music is added by Instagram: only the posted Story, downloaded or recorded on the phone, has it).`;
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
export function placeShows(cut, pieces, words, infoOf) {
  const sources = {}, inserts = [], warnings = [], notes = [];
  for (const [k, keep] of (cut.keep || []).entries()) {
    if (keep.show === undefined) continue;
    const show = showOf(keep), info = infoOf(show.file);
    const ps = pieces.filter((p) => p.keep === k);
    if (!ps.length) continue;
    const start = ps[0].start, end = ps.at(-1).start + ps.at(-1).duration, from = Number(show.from) || 0;
    const duration = Math.min(end - start, info.duration - from);
    if (duration < end - start - 0.05) warnings.push(`keep ${k + 1}: ${show.file} ends ${(end - start - duration).toFixed(1)} s before the keep does (from ${from} s it has ${duration.toFixed(1)} s), so the keep's last ${(end - start - duration).toFixed(1)} s show the frame's ground: an earlier "from", a shorter "hold", or end the keep a word earlier`);
    const key = `show-${k + 1}`;
    sources[key] = { file: `${key}${path.extname(show.file) || ".mp4"}`, path: path.resolve(show.file), width: info.width, height: info.height, offset: 0, video: true, duration: info.duration };
    for (const p of ps) p.show = { source: key, in: from + (p.start - start), until: start + duration };
    const skipped = leftOut(keep);
    if (skipped.length) notes.push(`! keep ${k + 1}: "show" plays ${show.file} over the whole keep, so its ${skipped.join(" and ")} ${skipped.length > 1 ? "are" : "is"} left out (the shown video is the keep's picture); to see ${keep.view === "face" ? "the face" : keep.zoom !== undefined && keep.zoom !== "off" ? "the zoom" : "that picture"} too, give it a keep of its own without "show".`);
    const sound = Number(show.sound) || 0;
    if (sound > 0 && duration > 0.1) {
      const said = words.filter((w) => w.start >= start - 0.01 && w.end <= end + 0.01);
      inserts.push({ k, key, file: show.file, from, start, duration, sound, spoken: said.length ? said.at(-1).end - start : 0 });
    }
  }
  return { sources, inserts, warnings, notes };
}

const n = (x) => +x.toFixed(3);

// The volume of a shown video's sound over its insert (seconds from its start): a quarter of its
// level under the first words, rising over the last RISE s of them to its level at the last word,
// held, out over the last FADE s. A keep without words (by its time) has it up at once; a video
// that ends before the last word has risen by its fade-out.
export function soundPoints({ sound, duration, spoken }) {
  const top = sound, low = top / 4, d = duration, out = Math.max(0, d - FADE), s = Math.min(Math.max(spoken || 0, 0), out);
  return (s > 0.3 ? [{ t: 0, v: low }, { t: n(Math.max(0, s - RISE)), v: low }, { t: n(s), v: top }] : [{ t: 0, v: 0 }, { t: n(Math.min(0.2, out)), v: top }])
    .concat([{ t: n(out), v: top }, { t: n(d), v: 0 }])
    .filter((x, j, all) => j === 0 || x.t > all.slice(0, j).reduce((m, y) => Math.max(m, y.t), -1));
}
