// The cut's voice as one file. The preview and the render play every piece from its video, so
// the cut's sound exists only inside the project; a skill that sets other pictures to the same
// voice (a narrated film, kinetic type) needs it as a file, beside edit.json's words, which are
// timed in the cut. Adapted from screencast-cut's tracks.mjs, whose voice is one recording:
// here every piece comes from its own video.
//
//   voiceTrack(fileOf, pieces, out)   the sound of every spoken piece at its take's level with
//                                     10 ms fades, silence for the pieces that only show
//                                     something (muted); fileOf(piece) is the piece's video.
//                                     The room's quiet of a cut of sound alone is a piece too
//   levelled(file, target)            the voice of sound alone at its final loudness, in place
//   loudnessOf(file)                  { lufs, peak }: integrated loudness, true peak
//
// It runs on the cut's frames: each piece takes exactly its duration, so the file is as long as
// the cut and a word's time in edit.json is its time in the file. The levels are the takes'
// gains alone: the bus of the composition (rumble, compressor, ceiling) and `finish` come after.

import fs from "node:fs";
import { spawnSync } from "node:child_process";

const n = (x) => +x.toFixed(4);
// as the composition fades its pieces (lib/composition.mjs)
const FADE = 0.01;

function run(args, what) {
  const r = spawnSync("ffmpeg", args, { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.error?.code === "ENOENT") throw new Error("ffmpeg is missing: this tool needs ffmpeg on the PATH");
  if (r.status !== 0) throw new Error(`ffmpeg could not make ${what}: ${(r.stderr || "").trim().split("\n").slice(-3).join(" ")}`);
}

// the track is made again only when what it is made of changed
function fresh(out, key) {
  try {
    return fs.existsSync(out) && fs.readFileSync(`${out}.json`, "utf8") === key;
  } catch {
    return false;
  }
}

export function voiceTrack(fileOf, pieces, out) {
  const key = JSON.stringify({ pieces: pieces.map((p) => (p.mute ? [n(p.duration)] : [fileOf(p), fs.statSync(fileOf(p)).mtimeMs, n(p.in), n(p.duration), p.gain || 0])) });
  if (fresh(out, key)) return out;
  const spoken = pieces.filter((p) => !p.mute);
  let k = 0;
  // one sample rate and one channel for every part, whatever the videos have
  const same = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono";
  const parts = pieces.map((p, i) => {
    const d = n(p.duration);
    if (p.mute) return `aevalsrc=0:s=48000:c=mono:d=${d},${same}[a${i}]`;
    return `[${k++}:a]atrim=duration=${d},asetpts=PTS-STARTPTS,${same},volume=${p.gain || 0}dB,`
      + `afade=t=in:d=${FADE},afade=t=out:st=${n(Math.max(0, d - FADE))}:d=${FADE},apad=whole_dur=${d},atrim=duration=${d}[a${i}]`;
  });
  const graph = `${parts.join(";")};${pieces.map((_, i) => `[a${i}]`).join("")}concat=n=${pieces.length}:v=0:a=1[out]`;
  // every spoken piece an input of its own, opened at its moment: ffmpeg decodes only that stretch
  const ins = spoken.flatMap((p) => ["-ss", String(n(Math.max(0, p.in))), "-t", String(n(p.duration + 0.5)), "-i", fileOf(p)]);
  // without the recordings' tags: a phone writes the place into its file, and the voice may be published
  run(["-v", "error", "-y", ...ins, "-filter_complex", graph, "-map", "[out]", "-map_metadata", "-1", "-ac", "1", "-c:a", "aac", "-b:a", "192k", out], "the cut's voice");
  fs.writeFileSync(`${out}.json`, key);
  return out;
}

// integrated loudness and true peak of a file's sound (ffmpeg's ebur128)
export function loudnessOf(file) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
  const summary = (r.stderr || "").slice((r.stderr || "").lastIndexOf("Summary:"));
  return { lufs: Number(summary.match(/I:\s*(-?[\d.]+) LUFS/)?.[1]), peak: Number(summary.match(/Peak:\s*(-?[\d.]+) dBFS/)?.[1]) };
}

// The cut's voice of sound alone brought to `target` LUFS in place: rumble filtered out at 75 Hz
// (as the composition's bus does for a video), a compressor (3:1 from −20 dBFS) and a limiter
// 3 dB under full scale, the gain measured and corrected up to three times. Speech raised by
// 15 dB has peaks far over full scale: with finish's gain and limiter alone a six-minute
// narration (its takes raised 13 to 16 dB) came to −14.8 LUFS and −0.8 dBTP (AAC overshoots a
// hard limit), with this to −14.5 and −1.4 (2026-11-18). A file at the level already stays as it is, so that building twice
// changes nothing. → { lufs, peak, was }
const CHAIN = "highpass=f=75,acompressor=threshold=0.1:ratio=3:attack=5:release=100:knee=4";
// (`${file}.level.json` says which pieces were levelled to which target: a voice levelled
// already is never run through the chain a second time; levelledTo(file) reads it)
export const levelledTo = (file) => { try { return JSON.parse(fs.readFileSync(`${file}.level.json`, "utf8")); } catch { return null; } };
export function levelled(file, target) {
  const key = fs.existsSync(`${file}.json`) ? fs.readFileSync(`${file}.json`, "utf8") : null;
  const done = levelledTo(file);
  if (done && done.target === target && done.key === key) return done.result;
  const mark = (result) => { fs.writeFileSync(`${file}.level.json`, JSON.stringify({ target, key, result })); return result; };
  const before = loudnessOf(file);
  if (Math.abs(before.lufs - target) <= 0.5 && before.peak <= -1) return mark({ ...before, was: before.lufs });
  const tmp = `${file}.part.m4a`;
  const level = (gain) => {
    run(["-v", "error", "-y", "-i", file, "-map_metadata", "-1", "-af", `${CHAIN},volume=${gain.toFixed(2)}dB,alimiter=limit=0.7:attack=5:release=60:level=disabled`,
      "-ac", "1", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", tmp], "the voice at its loudness");
    return loudnessOf(tmp).lufs;
  };
  try {
    let gain = target - before.lufs;
    for (let pass = 0, got = level(gain); pass < 3 && Math.abs(got - target) > 0.3; pass++) { gain += target - got; got = level(gain); }
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return mark({ ...loudnessOf(file), was: before.lufs });
}
