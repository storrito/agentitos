// What a video or a recording of sound alone is (ffprobe), its sound as samples (ffmpeg), and the
// HyperFrames CLI.

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

export const SR = 16000;

// duration, the size as shown (a phone's rotation applied), frame rate, codecs, recording time;
// `audio: true` (no size, no frame rate) for sound alone: an MP3, M4A or WAV, or a video file
// without a picture stream (a cover picture is none)
export function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`cannot read ${file}: ${(r.stderr || "").trim().split("\n").pop()}`);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const a = j.streams.find((s) => s.codec_type === "audio");
  if (!v && !a) throw new Error(`${file} has neither picture nor sound`);
  const created = j.format.tags?.creation_time || v?.tags?.creation_time || null;
  const when = created && !created.startsWith("1970") ? created : null;
  if (!v) return { duration: Number(j.format.duration || a.duration), audio: true, width: null, height: null, fps: null, vcodec: null, acodec: a.codec_name, format: j.format.format_name, created: when };
  const rot = Math.abs(Number(v.side_data_list?.find((d) => d.rotation != null)?.rotation ?? v.tags?.rotate ?? 0)) % 180;
  const [n, d] = String(v.avg_frame_rate || v.r_frame_rate || "30/1").split("/").map(Number);
  return {
    duration: Number(j.format.duration || v.duration),
    width: rot === 90 ? v.height : v.width,
    height: rot === 90 ? v.width : v.height,
    fps: d ? n / d : 30,
    vcodec: v.codec_name,
    acodec: a?.codec_name || null,
    format: j.format.format_name,
    created: when,
  };
}

// The name of a recording's copy beside the brief: NN.mp4 for a video, NN.<its own extension> for
// sound alone (a video file without a picture becomes .m4a).
export function copyName(n, file, audio) {
  const k = String(n).padStart(2, "0");
  if (!audio) return `${k}.mp4`;
  const ext = (path.extname(file).slice(1) || "m4a").toLowerCase();
  return `${k}.${["mp4", "mov", "m4v", "3gp"].includes(ext) ? "m4a" : ext}`;
}

// a copy the browser plays and the renderer decodes: H.264 + AAC in MP4. Linked when it is one
// already, remuxed when only the container differs, else transcoded (HEVC from an iPhone, AV1, …)
export function playable(file, out) {
  const p = probe(file);
  // sound alone: the file as it is, for ffmpeg to cut from
  if (p.audio) {
    fs.rmSync(out, { force: true });
    try { fs.linkSync(path.resolve(file), out); } catch { fs.copyFileSync(file, out); }
    return "linked";
  }
  const h264 = p.vcodec === "h264", aac = !p.acodec || p.acodec === "aac";
  fs.rmSync(out, { force: true });
  if (h264 && aac && /\.mp4$/i.test(file) && p.format.includes("mp4")) {
    try { fs.linkSync(path.resolve(file), out); } catch { fs.copyFileSync(file, out); }
    return "linked";
  }
  const args = ["-v", "error", "-y", "-i", file, "-map", "0:v:0", "-map", "0:a:0?"];
  if (h264) args.push("-c:v", "copy");
  else args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p");
  args.push(...(aac ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k"]), "-movflags", "+faststart", out);
  execFileSync("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"] });
  return h264 ? "remuxed" : `transcoded from ${p.vcodec}`;
}

// the sound as mono samples at 16 kHz
export function samples(file) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 2 ** 31 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

// the HyperFrames CLI: one on the PATH, else the version this skill pins
export function hyperframes() {
  const r = spawnSync("hyperframes", ["--version"], { stdio: "ignore" });
  return r.status === 0 ? ["hyperframes"] : ["npx", "--yes", "hyperframes@0.8.221"];
}

export const clock = (s, tenths = true) => {
  // rounded first, so that 59.96 s is 1:00.0, not 0:60.0
  s = tenths ? Math.round(s * 10) / 10 : Math.floor(s);
  const m = Math.floor(s / 60), sec = s - m * 60;
  return `${m}:${(tenths ? sec.toFixed(1) : String(Math.floor(sec))).padStart(tenths ? 4 : 2, "0")}`;
};
