// The voice and the webcam as one track each for the whole cut, cut by ffmpeg at build time. A
// browser plays only about 75 media elements on a page (Chrome: "too many WebMediaPlayers"); a
// clip per piece for the voice and another for the webcam's circle made a cut of 35 pieces 94
// elements, and from the 76th on the preview was silent. One track each takes two.
//
//   voiceTrack(file, pieces, out)                 the voice of every spoken piece at its take's
//                                                 level and speed with 10 ms fades, silence for
//                                                 the rest
//   cameraTrack(file, offset, pieces, out, opts)  the webcam at every piece's moment and speed
//   backdropTrack(pick, pieces, out, opts)        each piece's screen, small and blurred: the
//                                                 background behind the shots
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

// Every piece is an input of its own, opened at its moment (-ss before -i, accurate since it is
// decoded): ffmpeg decodes only the piece's stretch, and never holds the frames of one piece
// while it waits for another. With one input cut many ways (trim), a hook from the end of a
// four-minute recording made ffmpeg keep every frame before it in memory, gigabytes of raw
// video, and the machine stopped answering (2026-10-23).
function inputs(file, pieces, span) {
  return pieces.flatMap((p) => {
    const [from, length] = span(p);
    return ["-ss", String(n(Math.max(0, from))), "-t", String(n(length + 0.5)), "-i", file];
  });
}

export function voiceTrack(file, pieces, out) {
  const key = JSON.stringify({ file, mtime: fs.statSync(file).mtimeMs, pieces: pieces.map((p) => [n(p.in), n(p.duration), p.mute ? 0 : p.gain, p.rate || 1]) });
  if (fresh(out, key)) return out;
  const spoken = pieces.filter((p) => !p.mute);
  let k = 0;
  const parts = pieces.map((p, i) => {
    const d = n(p.duration);
    if (p.mute) return `aevalsrc=0:s=48000:c=mono:d=${d}[a${i}]`;
    // a cut played faster (--speed): its voice too, at its own pitch
    const rate = p.rate || 1;
    return `[${k++}:a]atrim=duration=${n(d * rate)},asetpts=PTS-STARTPTS,aresample=48000,${Math.abs(rate - 1) > 0.001 ? `atempo=${n(rate)},` : ""}volume=${p.gain || 0}dB,`
      + `afade=t=in:d=0.01,afade=t=out:st=${n(Math.max(0, d - 0.01))}:d=0.01,apad=whole_dur=${d},atrim=duration=${d}[a${i}]`;
  });
  const graph = `${parts.join(";")};${pieces.map((_, i) => `[a${i}]`).join("")}concat=n=${pieces.length}:v=0:a=1[out]`;
  // a cut of silence alone still needs an input for ffmpeg: the file, unused
  const ins = spoken.length ? inputs(file, spoken, (p) => [p.in, p.duration * (p.rate || 1)]) : ["-i", file];
  run(["-v", "error", "-y", ...ins, "-filter_complex", graph, "-map", "[out]", "-ac", "1", "-c:a", "aac", "-b:a", "192k", out], "the voice's track");
  fs.writeFileSync(`${out}.json`, key);
  return out;
}

// The webcam piece by piece: each an ffmpeg of its own that seeks to the piece's moment, decodes
// only it and writes a short segment (kept in `parts`, beside the sources, not in the project,
// under a name of what it is, so a build
// that changed other pieces reuses it), the segments joined without encoding again. One ffmpeg
// with every piece as an input still decoded them all at once: 3.6 GB for 35 pieces of 720p.
export function cameraTrack(file, offset, pieces, out, { fps = 30, width = 1280, parts = `${out}.parts` } = {}) {
  return pieceTrack(() => ({ file, offset }), pieces, out, { fps, parts, filter: `scale=${width}:-2`, key: { width } });
}

// Behind the shots, the screen each piece shows (pick(piece) → { file, offset }), small and
// blurred: where a shot leaves the frame free, its own screen in soft colours instead of a flat
// background. 320 px wide, so that it costs little to make and to play.
export function backdropTrack(pick, pieces, out, { fps = 30, parts = `${out}.parts` } = {}) {
  return pieceTrack(pick, pieces, out, { fps, parts, filter: "scale=320:-2,gblur=sigma=6", key: { backdrop: 2 } });
}

function pieceTrack(pick, pieces, out, { fps, parts, filter, key: extra }) {
  const picked = pieces.map(pick);
  const key = JSON.stringify({ ...extra, files: [...new Set(picked.map((x) => x.file))].map((f) => [f, fs.statSync(f).mtimeMs]), fps,
    pieces: pieces.map((p, i) => [picked[i].file, picked[i].offset, n(p.in), n(p.duration), p.rate || 1]) });
  if (fresh(out, key)) return out;
  const dir = parts;
  fs.mkdirSync(dir, { recursive: true });
  const keep = new Set();
  const list = pieces.map((p, i) => {
    const { file, offset } = picked[i];
    const rate = p.rate || 1, frames = Math.max(1, Math.round(p.duration * fps));
    const from = Math.max(0, p.in - offset);
    const name = `${file.split("/").pop().replace(/\.[^.]+$/, "")}-${n(from)}-${frames}-${n(rate)}.mp4`;
    keep.add(name);
    const part = `${dir}/${name}`;
    if (!fs.existsSync(part)) {
      // the piece's stretch at its speed, on exactly its frames: a frame too few is held, one too
      // many dropped
      run(["-v", "error", "-y", "-ss", String(n(from)), "-t", String(n(p.duration * rate + 0.5)), "-i", file, "-an",
        "-vf", `setpts=(PTS-STARTPTS)/${n(rate)},fps=${fps},${filter},setsar=1,format=yuv420p,tpad=stop_mode=clone:stop=${fps}`,
        "-frames:v", String(frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-g", String(fps), "-r", String(fps),
        "-video_track_timescale", String(fps * 1000), part], "a piece of a track");
    }
    return `file '${name}'`;
  });
  // segments of earlier builds no piece uses any more go
  for (const f of fs.readdirSync(dir)) if (!keep.has(f) && f.endsWith(".mp4")) fs.rmSync(`${dir}/${f}`, { force: true });
  fs.writeFileSync(`${dir}/list.txt`, list.join("\n") + "\n");
  run(["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", `${dir}/list.txt`, "-c", "copy", "-movflags", "+faststart", out], "a track");
  fs.writeFileSync(`${out}.json`, key);
  return out;
}
