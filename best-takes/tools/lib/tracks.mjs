// The cut's voice as one file. The preview and the render play every piece from its video, so
// the cut's sound exists only inside the project; a skill that sets other pictures to the same
// voice (a narrated film, kinetic type) needs it as a file, beside edit.json's words, which are
// timed in the cut. Adapted from screencast-cut's tracks.mjs, whose voice is one recording:
// here every piece comes from its own video.
//
//   voiceTrack(fileOf, pieces, out)   the sound of every spoken piece at its take's level with
//                                     10 ms fades, silence for the pieces that only show
//                                     something; fileOf(piece) is the piece's video
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
  run(["-v", "error", "-y", ...ins, "-filter_complex", graph, "-map", "[out]", "-ac", "1", "-c:a", "aac", "-b:a", "192k", out], "the cut's voice");
  fs.writeFileSync(`${out}.json`, key);
  return out;
}
