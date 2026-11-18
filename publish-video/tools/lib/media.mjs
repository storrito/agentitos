// What a video file is and how it begins and ends, measured with ffprobe and ffmpeg; a sheet of its
// frames to look at, with what the apps cover drawn in; a video fetched from a link; and the video
// written again in the form Storrito or YouTube takes. Each ffmpeg seeks to the part it needs: none
// decodes the whole picture except `whole` (small, up to 10 minutes) and `prepare`, which writes the
// video once.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const clock = (s) => {
  s = Math.max(0, s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

const ratioOf = (r) => { const [a, b] = String(r || "0/1").split("/").map(Number); return b ? a / b : 0; };

// what the file is: container, size, length, the picture as shown (a phone's rotation applied) and the sound
export function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8" });
  if (r.error) throw new Error("ffprobe is missing: install ffmpeg");
  if (r.status !== 0) throw new Error(`${path.basename(file)} is no video ffprobe can read`);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  if (!v) throw new Error(`${path.basename(file)} has no picture`);
  const a = j.streams.find((s) => s.codec_type === "audio");
  const duration = Number(j.format.duration || v.duration);
  if (!(duration > 0)) throw new Error(`${path.basename(file)} has no length ffprobe can read: write it into an MP4 again (ffmpeg -i <file> -c copy <file>.mp4) and give that`);
  const rot = Math.abs(Number(v.side_data_list?.find((d) => d.rotation != null)?.rotation ?? v.tags?.rotate ?? 0)) % 180;
  const ext = path.extname(file).slice(1).toLowerCase();
  const formats = String(j.format.format_name || "").split(",");
  const container = formats.includes("mp4") || formats.includes("mov") ? (ext === "mov" || ext === "qt" ? "mov" : "mp4") : formats[0];
  // a phone writes the place of the recording into its file; only that it is there is kept, never where
  const located = [j.format.tags, ...j.streams.map((s) => s.tags)].some((tags) => tags && Object.keys(tags).some((k) => /location|gps/i.test(k)));
  return {
    container,
    located,
    bytes: Number(j.format.size) || fs.statSync(file).size,
    duration,
    width: rot === 90 ? v.height : v.width,
    height: rot === 90 ? v.width : v.height,
    codec: v.codec_name,
    pixfmt: v.pix_fmt,
    fps: +(ratioOf(v.avg_frame_rate) || ratioOf(v.r_frame_rate)).toFixed(2),
    bitrate: Number(v.bit_rate) || Number(j.format.bit_rate) || Math.round((fs.statSync(file).size * 8) / duration),
    sound: a ? { codec: a.codec_name, rate: Number(a.sample_rate), channels: a.channels } : null,
  };
}

// the frame's name: the nearest of the usual ratios within 15 %, else the ratio itself
export function frameOf(w, h) {
  const r = w / h;
  const named = [["9:16", 9 / 16], ["4:5", 4 / 5], ["1:1", 1], ["16:9", 16 / 9]];
  const near = named.map(([n, v]) => [n, Math.abs(Math.log(r / v))]).sort((a, b) => a[1] - b[1])[0];
  return near[1] < Math.log(1.15) ? near[0] : `${r.toFixed(2)}:1`;
}

// exactly 9:16 or 16:9, give or take 2 % (a few pixels, cropped away when the video is written again)
export const isRatio = (w, h, target) => Math.abs(Math.log(w / h / target)) < Math.log(1.02);

const ffmpegErr = (args) => spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stderr || "";

// integrated loudness (LUFS) and true peak (dBTP) of the first sound track: only the sound is decoded
export function loudness(file) {
  const err = ffmpegErr(["-i", file, "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const summary = err.slice(err.lastIndexOf("Summary:"));
  const lufs = Number(summary.match(/I:\s+(-?[\d.]+|-inf) LUFS/)?.[1]);
  const peak = Number(summary.match(/True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/)?.[1]);
  return { lufs: Number.isFinite(lufs) ? lufs : null, peak: Number.isFinite(peak) ? peak : null };
}

// black picture and silence in the first and the last three seconds
export function edges(file, info) {
  const span = Math.min(3, info.duration / 2);
  const black = (seek) => {
    const err = ffmpegErr([...seek, "-i", file, "-map", "0:v:0", "-vf", "blackdetect=d=0.2:pix_th=0.10", "-an", "-f", "null", "-"]);
    return [...err.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [+m[1], +m[2]]);
  };
  const silent = (seek) => {
    const err = ffmpegErr([...seek, "-i", file, "-map", "0:a:0", "-af", "silencedetect=n=-45dB:d=0.5", "-vn", "-f", "null", "-"]);
    const starts = [...err.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => +m[1]);
    const ends = [...err.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1]);
    return starts.map((s, i) => [Math.max(0, s), ends[i] ?? span]);
  };
  const atStart = (spans) => spans.find(([s]) => s < 0.05)?.[1] || 0;
  const atEnd = (spans) => { const last = spans.find(([, e]) => e > span - 0.1); return last ? span - last[0] : 0; };
  const head = ["-t", String(span)];
  const tail = ["-sseof", String(-span)];
  return {
    blackStart: +atStart(black(head)).toFixed(2),
    blackEnd: +atEnd(black(tail)).toFixed(2),
    silentStart: info.sound ? +atStart(silent(head)).toFixed(2) : null,
    silentEnd: info.sound ? +atEnd(silent(tail)).toFixed(2) : null,
  };
}

// black stretches and flash frames anywhere in the picture: one ffmpeg over the whole video, picture
// only and decoded small. Black: 0.3 s or more (`blackdetect`), leaving out what touches the very
// start or end (`edges` reports that). A flash: a picture that stands for one or two frames between
// two cuts (a white frame, a stray frame of another clip). scdet's `mafd` is each frame's mean
// difference to the one before, in % of the full range; a cut is a frame whose mafd is at least
// 12 and at least 4 times the median of the frames around it (±15, the frame's own ±2 left out),
// so that fast motion, which changes every frame a lot, has no cuts; two cuts one or two frames
// apart, with no cut right before or after them, are a flash; one cut alone is a hard cut.
// Tried on made-up 8 s videos (a white frame and two white frames over testsrc2: mafd 42.6 against
// a median of 0.5; two stray frames of smptehdbars between testsrc2 and mandelbrot: 25.8; a hard
// cut between two still and between two moving pictures: one cut each, 21–26; a fast pan and
// `life`, medians near 6: no cut) and on the lab's corpus (talks, Zoom calls, phone takes, NASA
// b-roll, finished Stories with motion graphics; 20 videos): its hard cuts are 17–60, Zoom's
// short speaker transitions up to 9 for three or more frames in a row, which made false flashes
// at a threshold of 6 or less; at 12 no flash. Videos over 10 minutes are not measured (null): a
// long YouTube video would be decoded whole.
export function whole(file, info) {
  if (info.duration > 600) return null;
  const err = ffmpegErr(["-i", file, "-map", "0:v:0", "-an", "-vf", "scale=320:-2,format=yuv420p,blackdetect=d=0.3:pix_th=0.10,scdet=t=100,metadata=print:key=lavfi.scd.mafd", "-f", "null", "-"]);
  const t = [], m = [];
  for (const x of err.matchAll(/pts_time:(-?[\d.]+)\s*\n[^\n]*lavfi\.scd\.mafd=([\d.]+)/g)) { t.push(+x[1]); m.push(+x[2]); }
  if (!m.length) return null;
  const first = t[0], last = t[t.length - 1];
  const black = [...err.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((x) => [+x[1], +x[2]])
    .filter(([s, e]) => s > first + 0.05 && e < last - 0.05).map(([s, e]) => [+s.toFixed(2), +e.toFixed(2)]);
  const around = (i) => {
    const w = [];
    for (let j = i - 15; j <= i + 15; j++) if (j >= 0 && j < m.length && Math.abs(j - i) > 2) w.push(m[j]);
    w.sort((a, b) => a - b);
    return w[w.length >> 1] ?? 0;
  };
  const cut = m.map((v, i) => v >= 12 && v >= 4 * Math.max(around(i), 0.5));
  const c = (k) => !!cut[k];
  const flashes = [];
  for (let i = 0; i < m.length; i++) {
    // two cuts one or two frames apart, alone: three or more in a row are a transition, not a flash
    if (!c(i) || c(i - 1)) continue;
    const j = c(i + 1) ? i + 1 : c(i + 2) ? i + 2 : 0;
    if (j && !c(j + 1)) { flashes.push(+t[i].toFixed(2)); i = j; }
  }
  return { black, flashes };
}

function labelFont() {
  const filters = spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" }).stdout || "";
  if (!/\sdrawtext\s/.test(filters)) return null;
  const fc = spawnSync("fc-match", ["-f", "%{file}", "sans:bold"], { encoding: "utf8" });
  const found = fc.status === 0 && fc.stdout.trim();
  return [found, "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"].find((f) => f && fs.existsSync(f)) || null;
}

// `n` frames in rows of four, each with its time: the very first (the hook), the very last (the
// end) and the rest spread between; one ffmpeg that seeks to each moment and decodes one frame
// there. `zones` (platform-zones' answer for the video's size) outlines what the apps cover in
// red and the safe box in green on every frame, so the picture itself stays visible.
export function sheet(file, info, out, { n = 12, zones = null } = {}) {
  const tall = info.height > info.width;
  const cw = tall ? 270 : 400;
  const ch = 2 * Math.round((cw * info.height) / info.width / 2);
  const k = cw / info.width;
  const cols = 4, rows = Math.ceil(n / cols);
  const font = labelFont();
  // the last frame a seek still finds: two frames before the end
  const end = Math.max(0, info.duration - Math.max(0.15, 2 / (info.fps || 25)));
  const moments = Array.from({ length: n }, (_, i) => (i === 0 ? Math.min(0.1, end) : i === n - 1 ? end : (i / (n - 1)) * info.duration));
  const box = ([x, y, w, h], how) => `drawbox=x=${Math.round(x * k)}:y=${Math.round(y * k)}:w=${Math.round(w * k)}:h=${Math.round(h * k)}:${how}`;
  const overlay = zones ? [...zones.covers.map((c) => box(c.box, "color=red@0.8:t=1")), box(zones.safe, "color=lime@0.9:t=2")].map((f) => `,${f}`).join("") : "";
  const inputs = [], parts = [];
  moments.forEach((t, i) => {
    inputs.push("-ss", t.toFixed(2), "-i", file);
    const label = font ? `,drawtext=fontfile=${font}:text='${clock(t).replace(/:/g, "\\:")}':x=6:y=6:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4` : "";
    parts.push(`[${i}:v]trim=end_frame=1,scale=${cw}:${ch},setsar=1,format=yuv420p${overlay}${label},pad=iw+6:ih+6:3:3:color=0x202020[c${i}]`);
  });
  for (let i = n; i < rows * cols; i++) {
    inputs.push("-f", "lavfi", "-i", `color=c=0x202020:s=${cw + 6}x${ch + 6}:d=0.1`);
    parts.push(`[${i}:v]trim=end_frame=1,format=yuv420p[c${i}]`);
  }
  for (let r = 0; r < rows; r++) parts.push(`${Array.from({ length: cols }, (_, c) => `[c${r * cols + c}]`).join("")}hstack=inputs=${cols}[r${r}]`);
  parts.push(rows > 1 ? `${Array.from({ length: rows }, (_, r) => `[r${r}]`).join("")}vstack=inputs=${rows}[out]` : "[r0]null[out]");
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.rmSync(out, { force: true });
  const res = spawnSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", parts.join(";"), "-map", "[out]", "-frames:v", "1", "-q:v", "4", out], { encoding: "utf8" });
  if (res.status || !fs.existsSync(out)) throw new Error(`ffmpeg made no sheet of the frames: ${(res.stderr || "").trim().split("\n").pop()}`);
  return moments;
}

// ------------------------------------------------------------------------------- from a link

const PAGES = /(^|\.)(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|facebook\.com|fb\.watch|vimeo\.com|x\.com|twitter\.com|linkedin\.com)$/i;

// a shared link as the address of the file itself: Google Drive and Dropbox say so with a parameter
function direct(url) {
  const u = new URL(url);
  const drive = u.hostname.endsWith("drive.google.com") && (u.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || u.searchParams.get("id"));
  if (drive) return `https://drive.usercontent.google.com/download?id=${drive}&export=download&confirm=t`;
  if (/(^|\.)dropbox\.com$/.test(u.hostname)) { u.searchParams.set("dl", "1"); return u.toString(); }
  return url;
}

const EXT = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-matroska": "mkv", "video/x-msvideo": "avi" };

// the video behind a link, written to <dir>/source.<ext> without holding it in memory
export async function download(url, dir) {
  let host;
  try { host = new URL(url).hostname; } catch { throw new Error(`${url} is no link`); }
  if (PAGES.test(host)) throw new Error(`a video on ${host} cannot be downloaded from here: ask for the file itself (an upload, or a Google Drive, Dropbox or direct link)`);
  const res = await fetch(direct(url), { redirect: "follow", signal: AbortSignal.timeout(30 * 60000) });
  if (!res.ok) throw new Error(`the link answered HTTP ${res.status}: ask for a link anyone can open, or the file itself`);
  const type = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (type.startsWith("text/html")) throw new Error("the link leads to a page, not to the video file: ask for the file itself, or a link that downloads it (Google Drive and Dropbox shared to anyone with the link work)");
  const ext = EXT[type] || path.extname(new URL(res.url).pathname).slice(1).toLowerCase() || "mp4";
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `source.${ext}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
  return file;
}

// ------------------------------------------------------------------------------- written again

// short: H.264 1080×1920 in an MP4, at most 20 Mbit/s and 60 fps, AAC sound, the moov atom in
// front, the way Storrito takes it. A video that is not 9:16 is padded with black bars only when
// `pad` says so (the person chose bars over a crop that follows the subject).
// long: into an MP4 with H.264 and AAC when YouTube might not take the file as it is; the picture
// is only encoded again when its codec needs it.
// A nearly 9:16 video (a phone's 9:19.5) is cropped to fill only with `crop`.
// `loud` brings the sound to -14 LUFS (one pass of loudnorm), as the apps play it; `start` and
// `end` (seconds) cut black or silence off its ends, which encodes the picture again.
// The file's tags are left out either way (a phone's video names the place it was recorded at);
// how the picture is turned stays, it is not a tag.
export function prepare(input, out, info, { mode, pad = false, crop = false, loud = false, start = 0, end = null }) {
  const vf = [], said = [];
  let video = ["-c:v", "copy"];
  const encode = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-maxrate", "20M", "-bufsize", "40M", "-pix_fmt", "yuv420p"];
  const cut = start > 0 || end != null;
  if (mode === "short") {
    const nearly = frameOf(info.width, info.height) === "9:16";
    if (isRatio(info.width, info.height, 9 / 16) || (crop && nearly)) {
      vf.push("scale=1080:1920:force_original_aspect_ratio=increase", "crop=1080:1920");
      said.push(isRatio(info.width, info.height, 9 / 16) ? "1080×1920" : "1080×1920, its edges cropped");
    } else if (pad) {
      vf.push("scale=1080:1920:force_original_aspect_ratio=decrease", "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black");
      said.push("1080×1920 with black bars");
    }
    else if (crop) throw new Error(`the video is ${frameOf(info.width, info.height)}: a crop to 9:16 would cut too much; reframe it to follow the subject (auto-reframe), or write it with black bars (--pad)`);
    else throw new Error(`the video is ${info.width}×${info.height}, not 9:16: ${nearly ? "crop its edges (--crop) or add thin black bars (--pad)" : "reframe it (auto-reframe), or write it with black bars (--pad) when the person wants them"}`);
    vf.push("setsar=1");
    if (info.fps > 60) { vf.push("fps=30"); said.push("30 fps"); }
    video = encode;
  } else if (cut || !["h264", "hevc"].includes(info.codec) || info.pixfmt !== "yuv420p") {
    vf.push("scale=trunc(iw/2)*2:trunc(ih/2)*2", "setsar=1");
    if (info.fps > 60) { vf.push("fps=60"); said.push("60 fps"); }
    video = encode;
  }
  if (cut) said.push(`from ${start} s${end != null ? ` to ${end} s` : ""}`);
  const span = [...(start > 0 ? ["-ss", String(start)] : []), ...(end != null ? ["-to", String(end)] : [])];
  const audio = !info.sound ? ["-an"]
    : loud || cut || info.sound.codec !== "aac" || mode === "short" ?["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", ...(loud ? ["-af", "loudnorm=I=-14:TP=-1.5:LRA=11"] : [])]
    : ["-c:a", "copy"];
  const tmp = `${out}.part.mp4`;
  fs.rmSync(tmp, { force: true });
  const args = ["-v", "error", "-y", "-i", input, ...span, "-map", "0:v:0", ...(info.sound ? ["-map", "0:a:0"] : []), "-map_metadata", "-1", ...(vf.length ? ["-vf", vf.join(",")] : []), ...video, ...audio, "-movflags", "+faststart", tmp];
  if (info.located) said.push("the place it was recorded at taken out");
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (r.status || !fs.existsSync(tmp)) { fs.rmSync(tmp, { force: true }); throw new Error(`ffmpeg could not write the video: ${(r.stderr || "").trim().split("\n").pop()}`); }
  fs.renameSync(tmp, out);
  return [...said, video[1] === "copy" ? "the picture copied" : "H.264", !info.sound ? "no sound" : loud ? "the sound at -14 LUFS" : audio[1] === "copy" ? "the sound copied" : "AAC"];
}
