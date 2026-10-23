// What a video is (ffprobe), its words as timed lines, and a sheet of its frames to look at.

import fs from "node:fs";
import { spawnSync } from "node:child_process";

// duration, the size as shown (a phone's rotation applied), whether it has sound
export function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8" });
  if (r.error) throw new Error("ffprobe is missing: install ffmpeg");
  if (r.status !== 0) throw new Error(`${file} is no video ffprobe can read`);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  if (!v) throw new Error(`${file} has no picture`);
  const rot = Math.abs(Number(v.side_data_list?.find((d) => d.rotation != null)?.rotation ?? v.tags?.rotate ?? 0)) % 180;
  return {
    duration: Number(j.format.duration || v.duration),
    width: rot === 90 ? v.height : v.width,
    height: rot === 90 ? v.width : v.height,
    sound: j.streams.some((s) => s.codec_type === "audio"),
  };
}

// the frame's name: the nearest of the usual ratios within 15 %, else the ratio itself
export function frameOf(w, h) {
  const r = w / h;
  const named = [["9:16", 9 / 16], ["4:5", 4 / 5], ["1:1", 1], ["16:9", 16 / 9]];
  const near = named.map(([n, v]) => [n, Math.abs(Math.log(r / v))]).sort((a, b) => a[1] - b[1])[0];
  return near[1] < Math.log(1.15) ? near[0] : `${(r).toFixed(2)}:1`;
}

// words from rragent's transcribe tool, the captions skill or best-takes: a list, or { words }
export function readWords(file) {
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  const list = Array.isArray(j) ? j : j.words || [];
  return list.filter((w) => w && w.text != null && Number.isFinite(+w.start))
    .map((w) => ({ text: String(w.text).trim(), start: +w.start, end: +(w.end ?? w.start), kind: w.kind || (w.type === "audio_event" ? "event" : "word") }))
    .filter((w) => w.text);
}

export const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// the words as lines: a new line after a sentence's end or a pause of 0.7 s, at most ~20 words
export function lines(words) {
  const out = [];
  let cur = null;
  for (const w of words) {
    if (w.kind === "filler") continue;
    if (cur && (w.start - cur.end > 0.7 || /[.!?…]$/.test(cur.text) || cur.n >= 20)) { out.push(cur); cur = null; }
    if (!cur) cur = { start: w.start, end: w.end, text: w.text, n: 1 };
    else { cur.text += ` ${w.text}`; cur.end = w.end; cur.n++; }
  }
  if (cur) out.push(cur);
  return out.map(({ start, end, text }) => ({ start, end, text }));
}

function labelFont() {
  const filters = spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" }).stdout || "";
  if (!/\sdrawtext\s/.test(filters)) return null;
  const fc = spawnSync("fc-match", ["-f", "%{file}", "sans:bold"], { encoding: "utf8" });
  const found = fc.status === 0 && fc.stdout.trim();
  return [found, "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"].find((f) => f && fs.existsSync(f)) || null;
}

// `n` frames spread over the video, each with its time, in rows of four: one ffmpeg that seeks to
// each moment and decodes one frame there, never the whole video
export function sheet(file, info, out, n = 12) {
  const tall = info.height > info.width;
  const [cw, ch] = tall ? [270, 2 * Math.round((270 * info.height) / info.width / 2)] : [400, 2 * Math.round((400 * info.height) / info.width / 2)];
  const cols = 4, rows = Math.ceil(n / cols);
  const font = labelFont();
  const inputs = [], parts = [];
  const moments = Array.from({ length: n }, (_, k) => Math.min(info.duration - 0.1, ((k + 0.5) / n) * info.duration));
  moments.forEach((t, k) => {
    inputs.push("-ss", Math.max(0, t).toFixed(2), "-i", file);
    const label = font ? `,drawtext=fontfile=${font}:text='${clock(t).replace(":", "\\:")}':x=6:y=6:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4` : "";
    parts.push(`[${k}:v]trim=end_frame=1,scale=${cw}:${ch},setsar=1,format=yuv420p${label},pad=iw+6:ih+6:3:3:color=0x202020[c${k}]`);
  });
  for (let k = n; k < rows * cols; k++) {
    inputs.push("-f", "lavfi", "-i", `color=c=0x202020:s=${cw + 6}x${ch + 6}:d=0.1`);
    parts.push(`[${k}:v]trim=end_frame=1,format=yuv420p[c${k}]`);
  }
  for (let r = 0; r < rows; r++) parts.push(`${Array.from({ length: cols }, (_, c) => `[c${r * cols + c}]`).join("")}hstack=inputs=${cols}[r${r}]`);
  parts.push(rows > 1 ? `${Array.from({ length: rows }, (_, r) => `[r${r}]`).join("")}vstack=inputs=${rows}[out]` : "[r0]null[out]");
  fs.rmSync(out, { force: true });
  const res = spawnSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", parts.join(";"), "-map", "[out]", "-frames:v", "1", "-q:v", "4", out], { encoding: "utf8" });
  if (res.status || !fs.existsSync(out)) throw new Error(`ffmpeg made no sheet of the frames: ${(res.stderr || "").trim().split("\n").pop()}`);
  return moments;
}
