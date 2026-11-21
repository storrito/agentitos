// The voice and the webcam as one track each for the whole cut, cut by ffmpeg at build time. A
// browser plays only about 75 media elements on a page (Chrome: "too many WebMediaPlayers"); a
// clip per piece for the voice and another for the webcam's circle made a cut of 35 pieces 94
// elements, and from the 76th on the preview was silent. One track each takes two.
//
//   voiceTrack(file, pieces, out, { tone })       the voice of every spoken piece at its take's
//                                                 level and speed with 20 ms fades; the muted
//                                                 pieces the recording's room (room.mjs) at the
//                                                 level of the words before them, as long as it
//                                                 lasts, else silence; a float WAV for .wav
//   levelledVoice(wav, out, { target, ceiling }, level)   that voice at its loudness, its peaks
//                                                 held, by voice-sound's level stage: the file
//                                                 the composition mounts
//   cameraTrack(file, offset, pieces, out, opts)  the webcam at every piece's moment and speed
//   backdropTrack(pick, pieces, out, opts)        each piece's screen, small and blurred: the
//                                                 background behind the shots
//
// Both run on the cut's frames: each piece takes exactly its whole frames, so the tracks do not
// drift against the cut. The camera's track is encoded again only when its pieces changed.

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { FADE_OUT } from "./room.mjs";

const n = (x) => +x.toFixed(4);
// every spoken piece fades in and out this long (seconds): a cut in the quiet does not click, the
// words' first and last sounds stay (browser-use's video-use fades 30 ms)
const FADE = 0.02;

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

// a muted piece's room fades in and out this long: nothing clicks where it meets the words
const ROOM_FADE = 0.005;

// the gain of a muted piece's room: the spoken piece's before it (the take it holds), else the next
// one's: the room as loud as in the pauses around it
function roomGains(pieces) {
  return pieces.map((p, i) => {
    if (!p.mute) return null;
    const near = pieces.slice(0, i).reverse().find((q) => !q.mute) ?? pieces.slice(i + 1).find((q) => !q.mute);
    return near ? near.gain || 0 : 0;
  });
}

// tone: roomTone()'s answer (its file and how many seconds of room it holds, or why there is
// none); without one the muted pieces are silence, as before
export function voiceTrack(file, pieces, out, { tone } = {}) {
  const room = tone?.file && tone.seconds > 0 && pieces.some((p) => p.mute) ? tone : null;
  const gains = room ? roomGains(pieces) : null;
  const key = JSON.stringify({ file, mtime: fs.statSync(file).mtimeMs, pieces: pieces.map((p) => [n(p.in), n(p.duration), p.mute ? 0 : p.gain, p.rate || 1]),
    ...(room ? { room: [...room.key, gains] } : {}) });
  if (fresh(out, key)) return out;
  const spoken = pieces.filter((p) => !p.mute);
  // the room is the input after the spoken pieces', split once for every muted piece
  const muted = pieces.filter((p) => p.mute).length;
  let k = 0, r = 0;
  const parts = pieces.map((p, i) => {
    const d = n(p.duration);
    if (p.mute && room) {
      // longer than the room the recording has: it fades out over FADE_OUT where the room ends, and
      // is silent after it (a stretch heard twice in one piece is a whoosh)
      const end = Math.min(d, room.seconds), fade = d > room.seconds ? n(Math.min(FADE_OUT, end / 2)) : ROOM_FADE;
      return `[room${r++}]atrim=duration=${n(end)},asetpts=PTS-STARTPTS,volume=${gains[i]}dB,`
        + `afade=t=in:d=${ROOM_FADE},afade=t=out:st=${n(Math.max(0, end - fade))}:d=${fade},apad=whole_dur=${d},atrim=duration=${d}[a${i}]`;
    }
    if (p.mute) return `aevalsrc=0:s=48000:c=mono:d=${d}[a${i}]`;
    // a cut played faster (--speed): its voice too, at its own pitch
    const rate = p.rate || 1;
    return `[${k++}:a]atrim=duration=${n(d * rate)},asetpts=PTS-STARTPTS,aresample=48000,${Math.abs(rate - 1) > 0.001 ? `atempo=${n(rate)},` : ""}volume=${p.gain || 0}dB,`
      + `afade=t=in:d=${FADE},afade=t=out:st=${n(Math.max(0, d - FADE))}:d=${FADE},apad=whole_dur=${d},atrim=duration=${d}[a${i}]`;
  });
  const split = room ? `[${spoken.length}:a]aresample=48000,asplit=${muted}${Array.from({ length: muted }, (_, j) => `[room${j}]`).join("")};` : "";
  const graph = `${split}${parts.join(";")};${pieces.map((_, i) => `[a${i}]`).join("")}concat=n=${pieces.length}:v=0:a=1[out]`;
  // a cut of silence alone still needs an input for ffmpeg: the file, unused
  const ins = spoken.length ? inputs(file, spoken, (p) => [p.in, p.duration * (p.rate || 1)]) : room ? [] : ["-i", file];
  if (room) ins.push("-i", room.file);
  // 32-bit float in .wav: a take raised past full scale stays whole for the level stage after it
  const codec = /\.wav$/i.test(out) ? ["-c:a", "pcm_f32le"] : ["-c:a", "aac", "-b:a", "192k"];
  run(["-v", "error", "-y", ...ins, "-filter_complex", graph, "-map", "[out]", "-ac", "1", ...codec, out], "the voice's track");
  fs.writeFileSync(`${out}.json`, key);
  return out;
}

// The cut's voice (`wav`, voiceTrack's, its takes evened, the room in its muted pieces) at its
// loudness as `out`, by voice-sound's level stage (voicesound.levelVoice): `--loudness <target>`
// as played on two speakers (one channel, which the composition plays whole on both: the file
// measures 3 LU lower), `--peak <ceiling>` the bus's ceiling, measured on `out` as encoded; a
// leveller only where the phrases are uneven, held through the pauses, a slow limiter for the
// loudest peaks. Made again only when the cut or the numbers changed (`<out>.level.json`).
// level: the levelVoice of voicesound.mjs. Where voice-sound refuses or fails, the cut's voice as
// it is, said: the bus's ceiling and finish then do the rest.
// → { lufs (as played), measured (the file's), peak, steps, levelled, said }
export function levelledVoice(wav, out, { target, ceiling }, level) {
  const key = JSON.stringify({ cut: fs.readFileSync(`${wav}.json`, "utf8"), target, ceiling });
  const mark = `${out}.level.json`;
  try {
    const done = JSON.parse(fs.readFileSync(mark, "utf8"));
    if (done.key === key && fs.existsSync(out)) return done.result;
  } catch {}
  fs.rmSync(mark, { force: true });
  const r = level(wav, out, ["--loudness", String(target), "--peak", String(ceiling)]);
  let result;
  if (r.report) {
    const d = r.report.delivered || {};
    result = { lufs: d.asPlayedLufs ?? d.lufs, measured: d.lufs, peak: d.truePeak, steps: (r.report.steps || []).map((s) => s.id).filter(Boolean),
      left: (r.report.left || []).map((x) => x.why).filter(Boolean), levelled: true };
  } else {
    run(["-v", "error", "-y", "-i", wav, "-map_metadata", "-1", "-c:a", "aac", "-b:a", "192k", out], "the voice's track");
    result = { levelled: false, why: r.error };
  }
  fs.writeFileSync(mark, JSON.stringify({ key, result }));
  return result;
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
