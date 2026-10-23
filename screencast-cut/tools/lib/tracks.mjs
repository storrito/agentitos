// The voice and the webcam as one track each for the whole cut, cut by ffmpeg at build time. A
// browser plays only about 75 media elements on a page (Chrome: "too many WebMediaPlayers"); a
// clip per piece for the voice and another for the webcam's circle made a cut of 35 pieces 94
// elements, and from the 76th on the preview was silent. One track each takes two.
//
//   voiceTrack(file, pieces, out)                 the voice of every spoken piece at its take's
//                                                 level with 10 ms fades, silence for the rest
//   cameraTrack(file, offset, pieces, out, opts)  the webcam at every piece's moment and speed
//
// Both run on the cut's frames: each piece takes exactly its whole frames, so the tracks do not
// drift against the cut. The camera's track is encoded again only when its pieces changed.

import fs from "node:fs";
import { spawnSync } from "node:child_process";

const n = (x) => +x.toFixed(4);

function run(args, what) {
  const r = spawnSync("ffmpeg", args, { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg could not make ${what}: ${(r.stderr || "").trim().split("\n").slice(-3).join(" ")}`);
}

// a track is made again only when what it is made of changed
function fresh(out, key) {
  const file = `${out}.json`;
  try {
    if (fs.existsSync(out) && fs.readFileSync(file, "utf8") === key) return true;
  } catch {}
  return false;
}

export function voiceTrack(file, pieces, out) {
  const key = JSON.stringify({ file, mtime: fs.statSync(file).mtimeMs, pieces: pieces.map((p) => [n(p.in), n(p.duration), p.mute ? 0 : p.gain]) });
  if (fresh(out, key)) return out;
  const parts = pieces.map((p, i) => {
    const d = n(p.duration);
    if (p.mute) return `aevalsrc=0:s=48000:c=mono:d=${d}[a${i}]`;
    return `[0:a]atrim=start=${n(p.in)}:duration=${d},asetpts=PTS-STARTPTS,aresample=48000,volume=${p.gain || 0}dB,`
      + `afade=t=in:d=0.01,afade=t=out:st=${n(Math.max(0, d - 0.01))}:d=0.01,apad=whole_dur=${d}[a${i}]`;
  });
  const graph = `${parts.join(";")};${pieces.map((_, i) => `[a${i}]`).join("")}concat=n=${pieces.length}:v=0:a=1[out]`;
  run(["-v", "error", "-y", "-i", file, "-filter_complex", graph, "-map", "[out]", "-ac", "1", "-c:a", "aac", "-b:a", "192k", out], "the voice's track");
  fs.writeFileSync(`${out}.json`, key);
  return out;
}

export function cameraTrack(file, offset, pieces, out, { fps = 30, width = 1280 } = {}) {
  const key = JSON.stringify({ file, mtime: fs.statSync(file).mtimeMs, offset, fps, width, pieces: pieces.map((p) => [n(p.in), n(p.duration), p.rate || 1]) });
  if (fresh(out, key)) return out;
  const parts = pieces.map((p, i) => {
    const rate = p.rate || 1, frames = Math.max(1, Math.round(p.duration * fps));
    const from = Math.max(0, p.in - offset);
    // the piece's stretch of the webcam at the piece's speed, on exactly its frames: a frame too
    // few is held, one too many dropped
    return `[0:v]trim=start=${n(from)}:duration=${n(p.duration * rate)},setpts=(PTS-STARTPTS)/${n(rate)},fps=${fps},`
      + `scale=${width}:-2,setsar=1,format=yuv420p,tpad=stop_mode=clone:stop=${fps},trim=end_frame=${frames},setpts=PTS-STARTPTS[v${i}]`;
  });
  const graph = `${parts.join(";")};${pieces.map((_, i) => `[v${i}]`).join("")}concat=n=${pieces.length}:v=1:a=0[out]`;
  run(["-v", "error", "-y", "-i", file, "-filter_complex", graph, "-map", "[out]", "-an", "-c:v", "libx264", "-preset", "veryfast",
    "-crf", "22", "-g", String(fps), "-r", String(fps), "-movflags", "+faststart", out], "the webcam's track");
  fs.writeFileSync(`${out}.json`, key);
  return out;
}
