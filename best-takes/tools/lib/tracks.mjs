// The cut's voice as one file: the track the composition mounts (its videos play muted), the
// voice of a cut of sound alone, and for a skill that sets other pictures to the same voice (a
// narrated film, kinetic type) the file beside edit.json's words, which are timed in the cut.
// Adapted from screencast-cut's tracks.mjs, whose voice is one recording: here every piece comes
// from its own video.
//
//   voiceTrack(fileOf, pieces, out)   the sound of every spoken piece at its take's level with
//                                     10 ms fades, silence for the pieces that only show
//                                     something (muted); fileOf(piece) is the piece's video.
//                                     The room's quiet of a cut of sound alone is a piece too.
//                                     AAC in .m4a, 32-bit float in .wav (a take raised past full
//                                     scale stays whole)
//   levelledVoice(wav, out, target)   that voice at its final loudness, by voice-sound
//   loudnessOf(file)                  { lufs, peak }: integrated loudness, true peak
//
// It runs on the cut's frames: each piece takes exactly its duration, so the file is as long as
// the cut and a word's time in edit.json is its time in the file. voiceTrack's levels are the
// takes' gains alone, which bring them to one another; levelledVoice brings the whole to the
// loudness and holds its peaks; the composition's ceiling is a guard after it, and `finish`
// brings the whole film to its level.

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { cleanVoiceSync, voiceSaid, NEEDS_VOICE_SOUND } from "./voicesound.mjs";

const n = (x) => +x.toFixed(4);
// each spoken piece's fades at its ends, against clicks at the cuts
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
  const codec = /\.wav$/i.test(out) ? ["-c:a", "pcm_f32le"] : ["-c:a", "aac", "-b:a", "192k"];
  run(["-v", "error", "-y", ...ins, "-filter_complex", graph, "-map", "[out]", "-map_metadata", "-1", "-ac", "1", ...codec, out], "the cut's voice");
  fs.writeFileSync(`${out}.json`, key);
  return out;
}

// integrated loudness and true peak of a file's sound (ffmpeg's ebur128)
export function loudnessOf(file) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
  const summary = (r.stderr || "").slice((r.stderr || "").lastIndexOf("Summary:"));
  return { lufs: Number(summary.match(/I:\s*(-?[\d.]+) LUFS/)?.[1]), peak: Number(summary.match(/Peak:\s*(-?[\d.]+) dBFS/)?.[1]) };
}

// The cut's voice (`wav`, voiceTrack's, its takes evened) at `target` LUFS, as `out`: voice-sound's
// level stage, `clean <wav> <out> --denoise off --tone off --mono --loudness <target> --json`. Its
// recordings were mended whole before they were cut (takes.mjs new); here only a leveller where
// the phrases are uneven, the loudness as played on two speakers (one channel, which the
// composition plays whole on both: the file measures 3 LU lower), the peaks held by a slow
// limiter and the true peak at voice-sound's aim after the encoding. Made
// again only when the cut or the target changed (`<out>.level.json`), so that building twice
// changes nothing. Without voice-sound, or where it refuses or fails, the cut's voice as it is,
// not levelled, and `said` says why. → { lufs, measured, peak, said, levelled }
export function levelledVoice(wav, out, target) {
  const key = JSON.stringify({ cut: fs.readFileSync(`${wav}.json`, "utf8"), target });
  const mark = `${out}.level.json`;
  try {
    const done = JSON.parse(fs.readFileSync(mark, "utf8"));
    if (done.key === key && fs.existsSync(out)) return done.result;
  } catch {}
  fs.rmSync(mark, { force: true });
  const r = target == null ? { error: NEEDS_VOICE_SOUND } : cleanVoiceSync(wav, out, ["--denoise", "off", "--tone", "off", "--mono", "--loudness", String(target)]);
  let result;
  if (r.report) {
    const d = r.report.delivered || {};
    result = { lufs: d.asPlayedLufs ?? d.lufs, measured: d.lufs, peak: d.truePeak, said: voiceSaid(r.report, "brought to the loudness, its peaks held"), levelled: true,
      steps: (r.report.steps || []).map((s) => s.id).filter(Boolean) };
  } else {
    run(["-v", "error", "-y", "-i", wav, "-map_metadata", "-1", "-c:a", "aac", "-b:a", "192k", out], "the cut's voice");
    const l = loudnessOf(out);
    result = { lufs: l.lufs, measured: l.lufs, peak: l.peak, said: `not levelled (${r.error.replace(/\.$/, "")}): the takes are even, the whole as they came`, levelled: false };
  }
  fs.writeFileSync(mark, JSON.stringify({ key, result }));
  return result;
}
