// How loud a voice and a music bed are as the film plays them, and the music's volume that lays it
// a given distance under the voice. A copy of launch-video's tools/lib/level.mjs (a helper two
// skills need is copied, not shared).
//
//   loudness([file | {file, volume}, …])  → the integrated loudness (LUFS, EBU R128 by ffmpeg's
//                                           ebur128) of the sounds played one after the other,
//                                           each at its volume; null when nothing is heard
//   musicVolume(voice, music, under)       → { volume, need, bound, under }: the volume that lays
//                                           the music `under` LU under the voice, within LOWEST
//                                           and HIGHEST (`bound` says which was hit, `under` where
//                                           it then sits)
//   distance(voice, music, volume)         → how many LU the music at this volume sits under the voice
//
// A mono file is measured on both channels at full level: HyperFrames' render (and the browser)
// play it so, 3 LU louder than the same file measured as mono.

import { spawnSync } from "node:child_process";

export const LOWEST = 0.03, HIGHEST = 0.6;

const channels = (file) => {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "csv=p=0", file], { encoding: "utf8" });
  return Number(String(r.stdout || "").trim()) || 0;
};

export function loudness(sounds) {
  const list = sounds.map((s) => (typeof s === "string" ? { file: s, volume: 1 } : { volume: 1, ...s })).filter((s) => s.volume > 0);
  if (!list.length) return null;
  const parts = list.map((s, i) => {
    const n = channels(s.file);
    if (!n) throw new Error(`${s.file} has no sound ffprobe can read`);
    return `[${i}:a:0]${n === 1 ? "pan=stereo|c0=c0|c1=c0" : "aformat=channel_layouts=stereo"},aresample=48000,volume=${s.volume}[a${i}]`;
  });
  const graph = `${parts.join(";")};${list.map((_, i) => `[a${i}]`).join("")}concat=n=${list.length}:v=0:a=1,ebur128[out]`;
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-nostdin", ...list.flatMap((s) => ["-i", s.file]), "-filter_complex", graph, "-map", "[out]", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 256 << 20 });
  if (r.error) throw new Error(r.error.code === "ENOENT" ? "ffmpeg is not on this machine" : r.error.message);
  if (r.status !== 0) throw new Error(`ffmpeg could not measure the loudness: ${String(r.stderr).trim().split("\n").pop()}`);
  const summary = r.stderr.slice(r.stderr.lastIndexOf("Summary:"));
  const lufs = Number(summary.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]);
  // −70 is ebur128's floor: silence
  return Number.isFinite(lufs) && lufs > -69.5 ? lufs : null;
}

export const distance = (voice, music, volume) => voice - (music + 20 * Math.log10(volume));

export function musicVolume(voice, music, under) {
  const need = 10 ** ((voice - under - music) / 20);
  const volume = Math.round(Math.min(HIGHEST, Math.max(LOWEST, need)) * 1000) / 1000;
  const bound = need < LOWEST ? "lowest" : need > HIGHEST ? "highest" : null;
  return { volume, need, bound, under: distance(voice, music, volume) };
}
