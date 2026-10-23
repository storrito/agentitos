// What a recording is (ffprobe), its sound as samples (ffmpeg), a copy the browser and the
// renderer play well, and the HyperFrames CLI. After best-takes' media.mjs.

import fs from "node:fs";
import { execFileSync, spawn, spawnSync } from "node:child_process";

export const SR = 16000;

// duration, the size as shown (a phone's rotation applied), frame rate, codecs
export function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`cannot read ${file}: ${(r.stderr || "").trim().split("\n").pop()}`);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const a = j.streams.find((s) => s.codec_type === "audio");
  const rot = v ? Math.abs(Number(v.side_data_list?.find((d) => d.rotation != null)?.rotation ?? v.tags?.rotate ?? 0)) % 180 : 0;
  return {
    duration: Number(j.format.duration || v?.duration || a?.duration),
    width: v ? (rot === 90 ? v.height : v.width) : 0,
    height: v ? (rot === 90 ? v.width : v.height) : 0,
    video: !!v,
    audio: !!a,
    vcodec: v?.codec_name || null,
    acodec: a?.codec_name || null,
  };
}

// The recording as the preview and the renderer play it best: H.264 at a steady 30 frames a
// second (a phone's screen arrives with a varying rate), a keyframe every second so that every
// cut seeks at once, at most 2560 px wide, its sound as AAC; a recording of sound alone: AAC.
// With `frames` (activity.differ of activity.grid) the same decoding also streams the grey frames
// the activity is measured on, so the source is read once; `progress` hears how many seconds of
// it are done. Resolves with what the copy is (probe).
export function prepare(file, out, { fps = 30, frames, progress } = {}) {
  const p = probe(file);
  fs.rmSync(out, { force: true });
  const args = ["-v", "error", "-nostats", "-progress", "pipe:2", "-y", "-i", file];
  if (p.video) {
    args.push("-map", "0:v:0", "-map", "0:a:0?", "-vf", `scale='min(2560,iw)':-2,fps=${fps}`, "-fps_mode", "cfr",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-g", String(fps), "-keyint_min", String(fps));
  } else {
    args.push("-map", "0:a:0", "-vn");
  }
  args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", out);
  if (p.video && frames) args.push("-map", "0:v:0", "-an", "-vf", frames.filter, "-f", "rawvideo", "pipe:1");
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", args, { stdio: ["ignore", p.video && frames ? "pipe" : "ignore", "pipe"] });
    let err = "";
    // the browser's recordings make ffmpeg complain about their sound's first packets: said only
    // when it fails
    let partial = "";
    ff.stderr.on("data", (d) => {
      const lines = (partial + d).split("\n");
      partial = lines.pop();
      for (const line of lines) {
        const m = line.match(/^out_time_us=(\d+)/);
        if (m) progress?.(Number(m[1]) / 1e6);
        else if (!/^[a-z0-9_]+=/.test(line) && line.trim()) err = (err + line + "\n").slice(-2000);
      }
    });
    if (p.video && frames) ff.stdout.on("data", (chunk) => frames.push(chunk));
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg could not prepare ${file}: ${err.trim().split("\n").slice(-3).join(" ")}`));
      resolve(probe(out));
    });
  });
}

// the sound as mono samples at 16 kHz, from `from` seconds on (silence before 0 when `from` < 0)
export function samples(file, from = 0) {
  const pre = from < 0 ? ["-af", `adelay=${Math.round(-from * 1000)}:all=1`] : [];
  const raw = execFileSync("ffmpeg", ["-v", "error", ...(from > 0 ? ["-ss", String(from)] : []), "-i", file, "-vn", "-ac", "1", "-ar", String(SR), ...pre, "-f", "f32le", "-"], { maxBuffer: 2 ** 31, stdio: ["ignore", "pipe", "ignore"] });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

// the HyperFrames CLI: one on the PATH, else the version this skill pins
export function hyperframes() {
  const r = spawnSync("hyperframes", ["--version"], { stdio: "ignore" });
  return r.status === 0 ? ["hyperframes"] : ["npx", "--yes", "hyperframes@0.8.172"];
}

export const clock = (s, tenths = true) => {
  const sign = s < 0 ? "-" : "";
  s = Math.abs(s);
  const m = Math.floor(s / 60), sec = s - m * 60;
  return `${sign}${m}:${(tenths ? sec.toFixed(1) : String(Math.floor(sec))).padStart(tenths ? 4 : 2, "0")}`;
};

// "1:23.4", "83.4", "1:23" → seconds
export function seconds(text) {
  const m = String(text).trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  return m ? Number(m[1] || 0) * 60 + Number(m[2]) : NaN;
}
