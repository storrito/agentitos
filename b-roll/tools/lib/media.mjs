// What a picture or a video is (ffprobe), copies the browser shows and the renderer decodes
// (ffmpeg), a still of a video, and the HyperFrames CLI.

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

export const IMAGE = /\.(png|jpe?g|webp|gif|heic|heif|avif|bmp|tiff?)$/i;
export const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i;

export const kindOf = (file) => (IMAGE.test(file) ? "image" : VIDEO.test(file) ? "video" : null);

// size as shown (a phone's rotation applied), duration of a video, codecs
export function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${file} cannot be read: ${(r.stderr || "").trim().split("\n").pop()}`);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === "video");
  if (!v) throw new Error(`${file} has no picture.`);
  const rot = Math.abs(Number(v.side_data_list?.find((d) => d.rotation != null)?.rotation ?? v.tags?.rotate ?? 0)) % 180;
  return {
    width: rot === 90 ? v.height : v.width,
    height: rot === 90 ? v.width : v.height,
    duration: Number(j.format.duration || v.duration) || 0,
    vcodec: v.codec_name,
    acodec: j.streams.find((s) => s.codec_type === "audio")?.codec_name || null,
    format: j.format.format_name,
  };
}

function place(from, to) {
  fs.rmSync(to, { force: true });
  try { fs.linkSync(path.resolve(from), to); } catch { fs.copyFileSync(from, to); }
}

// a picture the browser shows: PNG, JPEG and WebP as they are (linked), anything else (HEIC from
// an iPhone, TIFF, …) as a JPEG. Returns the file's name in dir.
export function playablePicture(file, dir, base) {
  if (/\.(png|jpe?g|webp)$/i.test(file)) {
    const name = `${base}${path.extname(file).toLowerCase().replace(".jpeg", ".jpg")}`;
    place(file, path.join(dir, name));
    return name;
  }
  const name = `${base}.jpg`;
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-frames:v", "1", "-q:v", "2", path.join(dir, name)], { encoding: "utf8" });
  if (r.status) throw new Error(`${file} cannot be turned into a JPEG (${(r.stderr || "").trim().split("\n").pop()}): ask for it as JPEG or PNG.`);
  return name;
}

// a video the browser plays: H.264 in MP4 linked, else remuxed or transcoded. Its sound is
// dropped: the voice carries the video, the b-roll plays muted.
export function playableVideo(file, dir, base) {
  const p = probe(file);
  const name = `${base}.mp4`, out = path.join(dir, name);
  if (p.vcodec === "h264" && !p.acodec && /\.mp4$/i.test(file) && p.format.includes("mp4")) { place(file, out); return name; }
  const args = ["-v", "error", "-y", "-i", file, "-map", "0:v:0", "-an"];
  if (p.vcodec === "h264") args.push("-c:v", "copy");
  else args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p");
  args.push("-movflags", "+faststart", out);
  execFileSync("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"] });
  return name;
}

// one frame of a video as a JPEG (the blurred background behind a video shown whole)
export function still(file, at, out) {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(Math.max(0, at)), "-i", file, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", out], { stdio: ["ignore", "ignore", "inherit"] });
}

// the HyperFrames CLI: one on the PATH, else the version this skill pins
export function hyperframes() {
  const r = spawnSync("hyperframes", ["--version"], { stdio: "ignore" });
  return r.status === 0 ? ["hyperframes"] : ["npx", "--yes", "hyperframes@0.8.146"];
}

export const clock = (s) => {
  const m = Math.floor(s / 60), sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
};
