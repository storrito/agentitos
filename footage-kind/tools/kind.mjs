#!/usr/bin/env node
// What the files a person brought are, measured: for every file its facts (ffprobe), how its
// picture behaves (frames that repeat, where it stands and where it moves, cuts, black bars) and
// its sound (whether it pauses like speech), which files are one recording (the same sound, laid
// onto each other) and a contact sheet of every video. From these it suggests a kind for each
// file (a camera, a desktop's screen, a phone's screen, a finished video, sound alone, a still,
// text) and the situations a recording may be (references/situations.md), each with what speaks
// for it and the question only a look at the sheet answers. It never decides: the agent does, on
// the sheets.
//
//   node kind.mjs look <out-folder> <file|folder>…
//
// Needs ffmpeg and ffprobe. No model, no key.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi|mts)$/i, AUDIO = /\.(m4a|mp3|wav|aac|ogg|opus|flac)$/i;
const IMAGE = /\.(jpe?g|png|webp|heic|avif|gif)$/i, TEXT = /\.(txt|md|url|html?|pdf|docx?|csv)$/i;
const W = 320, H = 180, N = W * H; // the grey frames the picture is measured on
const CELL = 20, GX = W / CELL, GY = H / CELL; // and the 16×9 cells its movement is located in
const HOP = 0.02; // seconds per value of a sound's loudness
const fail = (msg) => { console.error(msg); process.exit(1); };
const round = (v, d = 2) => +(+v).toFixed(d);
const pct = (v) => `${Math.round(v * 100)} %`;
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { maxBuffer: 2 ** 30, ...opts });
  if (r.error?.code === "ENOENT") fail(`${cmd} is missing: install ffmpeg (it brings ffprobe), then run this again.`);
  return r;
}

// ---- facts ----

// what the container says: size as shown (a phone's rotation applied), rates, tracks, tags
function probe(file) {
  const r = run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const j = JSON.parse(r.stdout);
  const v = (j.streams || []).find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const sounds = (j.streams || []).filter((s) => s.codec_type === "audio");
  const rate = (s) => { const [a, b] = String(s || "0/1").split("/").map(Number); return b ? a / b : 0; };
  const turn = v ? Math.abs(Number(v.side_data_list?.find((d) => d.rotation != null)?.rotation ?? v.tags?.rotate ?? 0)) % 180 : 0;
  const tags = {};
  for (const src of [j.format?.tags, v?.tags]) for (const [k, x] of Object.entries(src || {})) tags[k.toLowerCase()] ??= String(x);
  const still = !!v && (IMAGE.test(file) || /image2|_pipe/.test(j.format?.format_name || ""));
  const avg = v ? rate(v.avg_frame_rate) : 0, nominal = v ? rate(v.r_frame_rate) : 0;
  return {
    duration: still ? 0 : round(Number(j.format?.duration || v?.duration || sounds[0]?.duration || 0), 2),
    video: !!v && !still, still,
    width: v ? (turn === 90 ? v.height : v.width) : 0,
    height: v ? (turn === 90 ? v.width : v.height) : 0,
    turned: turn === 90,
    fps: round(avg, 2),
    // a recorder that writes a frame only when the picture changed (a phone's screen, a browser)
    variable: !!v && !still && nominal > 0 && Math.abs(avg - nominal) / nominal > 0.03,
    vcodec: v?.codec_name || null,
    hdr: /smpte2084|arib-std-b67/.test(v?.color_transfer || ""),
    sounds: sounds.length,
    channels: sounds[0]?.channels || 0,
    tags,
  };
}

// ---- the picture ----

// `seconds` of consecutive frames from `at`, grey, W×H by nearest neighbour (single source pixels,
// so that a sensor's noise stays in them), only the frames the file holds (none repeated)
function frames(file, at, seconds) {
  const args = (sync) => ["-v", "error", "-ss", String(at), "-t", String(seconds), "-i", file, "-an", ...sync,
    "-frames:v", "200", "-vf", `scale=${W}:${H}:flags=neighbor,format=gray`, "-f", "rawvideo", "-"];
  let r = run("ffmpeg", args(["-fps_mode", "passthrough"]));
  if (r.status !== 0 || !r.stdout.length) r = run("ffmpeg", args(["-vsync", "0"])); // ffmpeg before 5.1
  const out = [];
  for (let o = 0; o + N <= r.stdout.length; o += N) out.push(r.stdout.subarray(o, o + N));
  return out;
}

const where = (cx, cy) => [cy < 1 / 3 ? "top" : cy > 2 / 3 ? "bottom" : "", cx < 1 / 3 ? "left" : cx > 2 / 3 ? "right" : ""].filter(Boolean).join(" ") || "centre";

// How the picture behaves, on up to six windows of five seconds spread over the file:
//   frozen   the share of frame pairs that are the same picture (a screen; a camera's never are)
//   alive    the median share of pixels that change from one frame to the next
//   still    the share of the frame's area (16×9 cells) that stands in nine of ten frame pairs
//   regions  the parts that move in three of ten pairs or more: where, how large, how often
//   band     a strip along an edge that stands while most of the rest moves
//   flat     the median share of neighbouring pixels of one value (an interface's areas)
//   cuts     hard cuts a minute (a jump between two calm stretches)
//   bars     black bars at the edges, as shares of the height and the width
//   map      the cells, each the tenths of the pairs it moves in (0–9), row by row
function picture(file, duration) {
  const len = Math.min(5, duration), n = Math.max(1, Math.min(6, Math.floor(duration / len)));
  let pairs = 0, same = 0, cuts = 0, seen = 0;
  const alive = [], flat = [], live = new Float64Array(GX * GY), cell = new Uint16Array(GX * GY);
  const rowMax = new Uint8Array(H), colMax = new Uint8Array(W);
  for (let i = 0; i < n; i++) {
    const fr = frames(file, n === 1 ? 0 : ((duration - len) * i) / (n - 1), len);
    const mean = [];
    for (let f = 0; f + 1 < fr.length; f++) {
      const a = fr[f], b = fr[f + 1];
      let changed = 0, sum = 0;
      cell.fill(0);
      for (let y = 0; y < H; y++) {
        const g = ((y / CELL) | 0) * GX;
        for (let x = 0; x < W; x++) {
          const p = y * W + x, d = a[p] > b[p] ? a[p] - b[p] : b[p] - a[p];
          sum += d;
          if (d >= 3) { changed++; cell[g + ((x / CELL) | 0)]++; }
        }
      }
      for (let k = 0; k < cell.length; k++) if (cell[k] >= 8) live[k]++; // 2 % of a cell
      alive.push(changed / N); mean.push(sum / N); pairs++;
      if (changed / N < 0.002) same++;
    }
    for (let f = 1; f + 1 < mean.length; f++) if (mean[f] > 18 && mean[f] > 4 * Math.max(mean[f - 1], mean[f + 1], 1)) cuts++;
    for (let f = 0; f < fr.length; f += 10) {
      const a = fr[f];
      let eq = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const v = a[y * W + x];
        if (v > rowMax[y]) rowMax[y] = v;
        if (v > colMax[x]) colMax[x] = v;
        if (x + 1 < W && Math.abs(v - a[y * W + x + 1]) <= 1) eq++;
      }
      flat.push(eq / (H * (W - 1)));
    }
    seen += Math.max(0, fr.length - 1);
  }
  if (!pairs) return null;
  for (let k = 0; k < live.length; k++) live[k] /= pairs;

  // the parts that move: cells moving in 30 % of the pairs or more, joined where they touch
  const mark = new Int8Array(GX * GY), regions = [];
  for (let k = 0; k < live.length; k++) {
    if (mark[k] || live[k] < 0.3) continue;
    const stack = [k], cells = [];
    mark[k] = 1;
    while (stack.length) {
      const c = stack.pop(), x = c % GX, y = (c / GX) | 0;
      cells.push(c);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, m = ny * GX + nx;
        if (nx >= 0 && nx < GX && ny >= 0 && ny < GY && !mark[m] && live[m] >= 0.3) { mark[m] = 1; stack.push(m); }
      }
    }
    const peak = Math.max(...cells.map((c) => live[c]));
    if (cells.length < 2 && peak < 0.6) continue; // one cell that flickers
    const xs = cells.map((c) => c % GX), ys = cells.map((c) => (c / GX) | 0);
    regions.push({ where: where((Math.min(...xs) + Math.max(...xs) + 1) / 2 / GX, (Math.min(...ys) + Math.max(...ys) + 1) / 2 / GY),
      area: round(cells.length / live.length), moves: round(cells.reduce((s, c) => s + live[c], 0) / cells.length) });
  }
  regions.sort((a, b) => b.area - a.area);

  // a strip of rows or columns along an edge that stands (85 % of its cells in nine of ten pairs)
  const line = (cellsOf) => { const v = cellsOf.map((c) => live[c]); return v.filter((s) => s <= 0.1).length / v.length >= 0.85 && Math.max(...v) < 0.5; };
  const row = (y) => line(Array.from({ length: GX }, (_, x) => y * GX + x)), col = (x) => line(Array.from({ length: GY }, (_, y) => y * GX + x));
  const strip = (test, count, from, step) => { let k = 0; for (let i = from; k < count && test(i); i += step) k++; return k / count; };
  const strips = { top: strip(row, GY, 0, 1), bottom: strip(row, GY, GY - 1, -1), left: strip(col, GX, 0, 1), right: strip(col, GX, GX - 1, -1) };
  const [edge, share] = Object.entries(strips).sort((a, b) => b[1] - a[1])[0];

  const dark = (max, from, step) => { let k = 0; for (let i = from; k < max.length / 2 && max[i] < 20; i += step) k++; return k / max.length; };
  const bars = { top: dark(rowMax, 0, 1), bottom: dark(rowMax, H - 1, -1), left: dark(colMax, 0, 1), right: dark(colMax, W - 1, -1) };
  for (const k of Object.keys(bars)) bars[k] = bars[k] >= 0.04 ? round(bars[k]) : 0;
  const map = Array.from({ length: GY }, (_, y) => Array.from({ length: GX }, (_, x) => Math.min(9, Math.floor(live[y * GX + x] * 10))).join(""));
  return { frozen: round(same / pairs), alive: round(median(alive), 3), still: round(live.filter((s) => s <= 0.1).length / live.length), regions,
    band: share >= 0.15 && share < 1 ? { edge, share: round(share) } : null, flat: round(median(flat)), cuts: round((cuts / Math.min(duration, n * len)) * 60, 1), bars, map, frames: seen };
}

// ---- the sound ----

// the loudness of up to four minutes of sound, one value per HOP
function envelope(file) {
  const r = run("ffmpeg", ["-v", "error", "-t", "240", "-i", file, "-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "-"]);
  const s = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.byteLength / 4));
  const hop = Math.round(8000 * HOP), env = new Float32Array(Math.floor(s.length / hop));
  for (let f = 0; f < env.length; f++) { let e = 0; for (let i = f * hop; i < (f + 1) * hop; i++) e += s[i] * s[i]; env[f] = Math.sqrt(e / hop); }
  return env;
}

// level: the loud parts in dB of full scale; busy: the share of the time with sound; pauses: gaps
// of a third of a second or more a minute. Speech and sung music both pause: this does not tell
// them apart, transcribe does.
function sound(env) {
  if (!env.length) return null;
  const sorted = Float32Array.from(env).sort(), loud = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const level = round(20 * Math.log10(Math.max(loud, 1e-6)), 1);
  if (level < -60) return { level, silent: true };
  const thr = loud * 0.1;
  let busy = 0, gaps = 0, quiet = 0;
  for (const e of env) {
    if (e > thr) { busy++; if (quiet * HOP >= 0.33) gaps++; quiet = 0; } else quiet++;
  }
  return { level, silent: false, busy: round(busy / env.length), pauses: round((gaps / (env.length * HOP)) * 60, 1) };
}
const speaks = (f) => !!f.sound && !f.sound.silent && f.sound.pauses >= 6;

// Whether two sounds are one recording: their log loudness laid onto each other, first coarsely
// (0.1 s, up to a minute either way), then exactly. Returns { score, shift }: a's time is b's time
// plus shift. Mostly under 0.5 for different recordings; the caller sets the bar.
function match(envA, envB) {
  const curve = (env, by) => {
    const out = new Float32Array(Math.floor(env.length / by));
    let sum = 0;
    for (let f = 0; f < out.length; f++) { let e = 0; for (let i = 0; i < by; i++) e += env[f * by + i]; out[f] = Math.log10(e / by + 1e-4); sum += out[f]; }
    const m = out.length ? sum / out.length : 0;
    for (let f = 0; f < out.length; f++) out[f] -= m;
    return out;
  };
  const corr = (a, b, lag, least) => {
    let s = 0, aa = 0, bb = 0, k = 0;
    for (let f = Math.max(0, -lag); f < a.length && f + lag < b.length; f++) { const x = a[f], y = b[f + lag]; s += x * y; aa += x * x; bb += y * y; k++; }
    return k >= least && aa && bb ? s / Math.sqrt(aa * bb) : -1;
  };
  const best = (a, b, from, to, least) => {
    let top = { lag: 0, score: -1 };
    for (let lag = from; lag <= to; lag++) { const score = corr(a, b, lag, least); if (score > top.score) top = { lag, score }; }
    return top;
  };
  const shorter = Math.min(envA.length, envB.length) * HOP;
  const least = Math.min(20, shorter * 0.8); // seconds the two must overlap
  if (shorter < 4) return { score: 0, shift: 0, overlap: least };
  const a5 = curve(envA, 5), b5 = curve(envB, 5);
  const coarse = best(a5, b5, -600, 600, least / (HOP * 5));
  if (coarse.score < 0.3) return { score: round(Math.max(coarse.score, 0)), shift: 0, overlap: least };
  const a1 = curve(envA, 1), b1 = curve(envB, 1);
  const fine = best(a1, b1, coarse.lag * 5 - 8, coarse.lag * 5 + 8, least / HOP);
  return { score: round(Math.max(fine.score, 0)), shift: round(-fine.lag * HOP, 2), overlap: least };
}

// ---- a sheet to look at ----

// twelve frames spread over the video, one ffmpeg each (never the whole file decoded at once)
function sheet(file, f, out) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "footage-kind-"));
  const tall = f.height > f.width, times = [];
  try {
    for (let i = 0; i < 12; i++) {
      const t = round(((i + 0.5) / 12) * f.duration, 2);
      const r = run("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", tall ? "scale=-2:320" : "scale=320:-2", "-q:v", "4",
        path.join(tmp, `${String(times.length).padStart(2, "0")}.jpg`)]);
      if (r.status === 0) times.push(t);
    }
    if (!times.length) return null;
    const r = run("ffmpeg", ["-v", "error", "-y", "-framerate", "1", "-i", path.join(tmp, "%02d.jpg"), "-vf", `tile=${tall ? "6x2" : "4x3"}`, "-frames:v", "1", "-q:v", "4", out]);
    return r.status === 0 ? times : null;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// ---- what it may be ----

// A kind for one file, with what speaks for it and what only a look settles. The bars it sets,
// measured on agentitos-lab's corpus (2026-11-16): a desktop's recording repeats 90 % of its
// frames; slides with the speaker's picture in a corner repeat none, but 89 % of their area
// stands; footage and a wide shot of a speaker stand on under 30 %; a webcam before a blurred
// background (77 %) and a studio interview (43 %) lie between and are left open.
// A kind is called sure only when the file itself says it (text, a still, sound alone, a render's
// or a camera's tag) or two measurements agree (a display's shape and frames that repeat; a
// phone screen's upright shape and a picture that stands). On three files kept apart from those
// the bars were set on, the kind from the picture alone was right for one.
function suggest(name, f, pic, snd) {
  const ev = [], open = [];
  const size = `${f.width}×${f.height}`;
  if (f.text) return { kind: "text", sure: true, evidence: ["a text file"], open: [] };
  if (f.still) {
    const ratio = f.width / f.height;
    if (ratio > 0.42 && ratio < 0.53) ev.push(`${size} is a phone screen's shape: likely a screenshot`);
    else if (ratio >= 1.5 && ratio <= 1.62) ev.push(`${size} is a display's shape (16:10 or 3:2): likely a screenshot`);
    else ev.push(`a still, ${size}`);
    return { kind: "still", sure: true, evidence: ev, open: ["A photo, a screenshot or a graphic?"] };
  }
  if (!f.video) {
    ev.push("sound alone, no picture");
    if (snd?.silent) ev.push("the sound is silent");
    else if (snd) ev.push(`${snd.pauses} pauses a minute, sound ${pct(snd.busy)} of the time`);
    return { kind: "audio", sure: true, evidence: ev, open: ["Speech or music? How many voices? (transcribe says)"] };
  }
  const ratio = f.width / f.height, t = f.tags;
  const maker = t["com.apple.quicktime.make"] || t.make, model = t["com.apple.quicktime.model"] || t.model;
  const made = t.hyperframes_renderer ? "HyperFrames" : /lavf/i.test(t.encoder || "") ? "ffmpeg" : (t["com.apple.quicktime.software"] || t.encoder || "");
  // upright only: a picture of 2:1 and wider is as often an ultrawide display, a cinema format or
  // a call's recording as a phone held sideways (a call with a shared screen was taken for one)
  const phone = ratio > 0.42 && ratio < 0.53, wide = ratio > 1.9 && ratio < 2.4;
  const display = ratio >= 1.5 && ratio <= 1.62;
  const bars = pic && (pic.bars.top || pic.bars.bottom || pic.bars.left || pic.bars.right);
  const named = /screen ?recording|bildschirmaufnahme|screencast|^screen\b/i.test(name);
  const moving = pic ? pic.regions.reduce((s, r) => s + r.area, 0) : 0;
  // something that always moves at the edge of a picture that stands: a webcam or a speaker's picture recorded into a screen
  const inset = pic && pic.still >= 0.8 && pic.regions.length > 0 && moving <= 0.15 && pic.regions.every((r) => r.where !== "centre") ? pic.regions[0] : null;

  if (pic) {
    ev.push(`${pct(pic.frozen)} of its frames repeat the one before; ${pct(pic.still)} of the picture's area stands`);
    if (pic.regions.length) ev.push(`${pic.regions.length === 1 ? "one part moves" : `${pic.regions.length} separate parts move`}: ${pic.regions.slice(0, 4).map((r) => `${r.where} (${pct(r.area)} of the frame, ${pct(r.moves)} of the time)`).join(", ")}`);
    if (pic.band && pic.still < 0.5) ev.push(`a strip along the ${pic.band.edge} (${pct(pic.band.share)} of the frame) stands while the rest moves`);
    if (pic.cuts >= 2) ev.push(`${pic.cuts} cuts a minute${pic.cuts >= 6 ? ": cut together from several shots" : ""}`);
  }
  if (wide) ev.push(`${size} is wider than 2:1: an ultrawide display, a cinema format, a call's recording or a phone held sideways`);
  if (f.variable) ev.push("its frame rate varies: a recorder that writes a frame only when the picture changes (a phone's screen, a browser)");
  if (maker || model) ev.push(`the file names its camera: ${[maker, model].filter(Boolean).join(" ")}`);
  if (f.turned) ev.push("stored turned: filmed with a phone held upright");
  if (f.hdr) ev.push("HDR, as a phone's camera films");
  if (made) ev.push(`written by ${made}${t.hyperframes_renderer ? ": a video one of our skills rendered" : /ffmpeg/.test(made) ? ": exported or converted, not straight from a device" : ""}`);
  if (named) ev.push("its name says screen recording");
  if (bars) ev.push(`black bars (top ${pct(pic.bars.top)}, bottom ${pct(pic.bars.bottom)}, left ${pct(pic.bars.left)}, right ${pct(pic.bars.right)} of the frame): a picture of another shape inside`);
  if (!f.sounds) ev.push("no sound track");
  else if (snd?.silent) ev.push("its sound track is silent");
  else if (snd) ev.push(`its sound pauses ${snd.pauses} times a minute${snd.pauses >= 6 ? ", as speech does" : ": continuous, like music or a noisy place"}`);
  if (f.sounds > 1) ev.push(`${f.sounds} sound tracks (a recorder that keeps microphone and system sound apart)`);

  let kind, sure = false;
  const who = "Who or what is in the picture: one person speaking to the camera, two or more, hands and a thing, a place without anyone speaking?";
  if (t.hyperframes_renderer) { kind = "finished"; sure = true; }
  else if (maker || model) { kind = "camera"; sure = !(pic?.frozen >= 0.5); open.push(who); if (!sure) open.push("The file names a camera but its picture stands like a screen: a filmed screen, or a tripod shot of something that does not move?"); }
  else if (phone && !bars) {
    kind = "phone-screen"; sure = !pic || pic.still > 0.3;
    ev.unshift(`${size} is a phone screen's shape, narrower than 9:16`);
    if (!sure) open.push("Shaped like a phone's screen but moving like a camera's picture: a game, a video played on the phone, or a crop?");
  } else if (bars) { kind = "finished"; open.push("What is inside the bars: a video made for another format? Burned-in captions, a logo?"); }
  else if (pic?.frozen >= 0.5) {
    kind = "desktop-screen"; sure = display || named;
    if (display) ev.unshift(`${size} is a display's shape (16:10 or 3:2), not a camera's`);
    if (pic.frozen >= 0.9 && pic.cuts > 0) open.push("Whole pictures that stand and then change at once: slides?");
    open.push("Is a small face fixed in a corner (a webcam recorded into the screen)?");
    if (ratio < 1) open.push("A screen that stands upright: a phone's screen cropped to 9:16, or a finished vertical video of text?");
  } else if (pic && pic.still < 0.5 && pic.band) {
    kind = "finished";
    open.push(`The strip along the ${pic.band.edge} that never moves: a caption band, a card, a background? Then it is a laid-out video; if it is only a calm part of one shot (a table, a wall), it is a camera's picture.`);
  } else if (inset) {
    kind = "desktop-screen";
    open.push(`The part that always moves (${inset.where}): a webcam or a speaker's picture recorded into a screen or into slides?`);
  } else if (pic && pic.still <= 0.3) { kind = "camera"; open.push(who); open.push("Or no camera at all: a game, an animation, a video played on a screen?"); } // one measurement: never sure
  else {
    // between the two: the shape and the flat areas only tip it
    kind = display || pic?.flat >= 0.85 ? "desktop-screen" : "camera";
    open.push("A camera's picture that hardly moves (a webcam before a calm or blurred background, a tripod, a studio) or a screen? The numbers do not tell: the sheet does.");
    if (pic?.regions.length >= 2) open.push("Several separate parts move and the rest stands: the tiles of a video call, or people before a calm background?");
    if (kind === "camera") open.push("If a camera: one person speaking to it, two or more, hands and a thing?");
  }
  return { kind, sure, evidence: ev, open, inset: kind === "desktop-screen" && inset ? inset.where : null };
}

// the situations (references/situations.md) one recording may be, from its files' kinds
function situations(files) {
  const of = (k) => files.filter((f) => f.kind === k);
  const cams = of("camera"), desk = of("desktop-screen"), phone = of("phone-screen"), fin = of("finished"), aud = of("audio");
  const out = [], add = (id, why) => { if (!out.some((s) => s.id === id)) out.push({ id, why }); };
  const speech = files.some(speaks);
  if (desk.length && cams.length) add("B2", "a desktop's screen and a camera of one recording");
  if (phone.length && (cams.length || aud.length)) add("B5", "a phone's screen and a face or a voice of one recording");
  if (!desk.length && !phone.length && cams.length >= 2) add("G2", "several cameras of one recording: one a person, or angles of one scene");
  if (desk.length && !cams.length) {
    if (desk.some((f) => f.inset)) { add("B3", "a screen with a part that always moves at its edge: a webcam recorded into it"); add("B6", "or slides with the speaker's picture in a corner"); }
    add("B1", "a desktop's screen alone");
    add("B3", "if a webcam is recorded into a corner of it");
    add("B6", "if it is slides");
  }
  if (phone.length && !cams.length && !aud.length) add("B4", "a phone's screen alone");
  if (cams.length === 1 && !desk.length && !phone.length) {
    const c = cams[0], tall = c.facts.height > c.facts.width, cut = c.picture?.cuts >= 6;
    if (!speech) add("D3", `a camera without speech: footage of a thing or a place${cut ? ", several shots in one file" : ""}`);
    add(tall ? "P1" : "P2", `one camera, ${tall ? "upright" : "wide"}: if one person speaks to it`);
    if (!tall) add("G1", "if two people sit in it");
    if (!tall && c.picture?.regions.length >= 2 && c.picture.still >= 0.5) add("G3", "if the separate parts that move are a video call's tiles");
    add("D1", "if it shows hands and a thing");
    if (cut) add("F2", "cut together from several shots: an edited video, if it also carries text or music");
  }
  if (fin.length) add("F2", "a finished video: one of our renders, bars, or a strip that never moves");
  if (aud.length && files.length === aud.length) { add("O1", "sound without a picture: if it is a voice"); add("O5", "if it is music"); }
  return out;
}

// ---- look ----

function list(sources, skip) {
  const out = [];
  const walk = (p) => {
    if (path.resolve(p) === skip) return;
    const st = fs.statSync(p, { throwIfNoEntry: false });
    if (!st) fail(`${p} does not exist: pass the files or folders the person brought.`);
    if (st.isDirectory()) { for (const e of fs.readdirSync(p).sort()) if (!e.startsWith(".")) walk(path.join(p, e)); }
    else if (VIDEO.test(p) || AUDIO.test(p) || IMAGE.test(p) || TEXT.test(p)) out.push(p);
  };
  sources.forEach(walk);
  return out;
}

function look(outDir, sources) {
  if (!outDir || !sources.length) fail("usage: node kind.mjs look <out-folder> <file|folder>…");
  fs.mkdirSync(outDir, { recursive: true });
  const paths = list(sources, path.resolve(outDir));
  if (!paths.length) fail("No video, sound, picture or text file there: pass the files or folders the person brought.");
  const files = [], envs = new Map();
  paths.forEach((file, i) => {
    const name = path.basename(file);
    process.stderr.write(`looking at ${name} …\n`);
    if (TEXT.test(file)) return files.push({ file, name, ...suggest(name, { text: true }), facts: { bytes: fs.statSync(file).size } });
    const f = probe(file);
    if (!f) return files.push({ file, name, kind: "unreadable", sure: true, evidence: ["ffprobe cannot read it"], open: [] });
    let pic = null, snd = null, sheetFile = null, sheetTimes = null;
    if (f.video && f.duration > 0) {
      pic = picture(file, f.duration);
      sheetFile = `sheet-${String(i + 1).padStart(2, "0")}-${name.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_").slice(0, 40)}.jpg`;
      sheetTimes = sheet(file, f, path.join(outDir, sheetFile));
      if (!sheetTimes) sheetFile = null;
    }
    if (f.sounds) { const env = envelope(file); snd = sound(env); if (snd && !snd.silent) envs.set(i, env); }
    files.push({ file, name, ...suggest(name, f, pic, snd), facts: { ...f, bytes: fs.statSync(file).size }, picture: pic, sound: snd, sheet: sheetFile, sheetTimes });
  });

  // a file without sound cannot be laid onto another: the same length is all that hints at one recording
  files.forEach((f, i) => {
    if (!f.facts?.duration || envs.has(i)) return;
    const twins = files.filter((g, j) => j !== i && g.facts?.duration && Math.abs(g.facts.duration - f.facts.duration) <= Math.max(0.2, f.facts.duration * 0.002)).map((g) => g.name);
    if (twins.length) { f.sameLength = twins; f.evidence.push(`as long as ${twins.join(", ")}: possibly one recording (no sound to prove it)`); }
  });

  // which files are one recording: the same sound
  const parent = files.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const links = [], idx = [...envs.keys()];
  if (idx.length <= 24) for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) {
    const m = match(envs.get(idx[a]), envs.get(idx[b]));
    if (m.score >= (m.overlap < 20 ? 0.65 : 0.5)) { links.push({ a: idx[a], b: idx[b], ...m }); parent[find(idx[a])] = find(idx[b]); }
  }
  const groups = new Map();
  files.forEach((f, i) => { if (f.kind === "text" || f.kind === "still" || f.kind === "unreadable") return; const g = find(i); groups.set(g, [...(groups.get(g) || []), i]); });
  const recordings = [...groups.values()].map((members, n) => {
    // each file's start on the recording's clock: a's time = b's time + shift, so b starts `shift` after a
    const start = new Map([[members[0], 0]]);
    for (let pass = 0; pass < members.length; pass++) for (const l of links) {
      if (start.has(l.a) && !start.has(l.b)) start.set(l.b, start.get(l.a) + l.shift);
      else if (start.has(l.b) && !start.has(l.a)) start.set(l.a, start.get(l.b) - l.shift);
    }
    const first = Math.min(...members.map((i) => start.get(i) ?? 0));
    members.forEach((i) => { files[i].recording = n + 1; if (members.length > 1) files[i].starts = round((start.get(i) ?? 0) - first, 2); });
    const mine = members.map((i) => files[i]);
    return { n: n + 1, files: mine.map((f) => f.name), open: mine.filter((f) => !f.sure).map((f) => f.name), together: members.length > 1 ? "the same sound" : null,
      score: members.length > 1 ? Math.min(...links.filter((l) => members.includes(l.a) && members.includes(l.b)).map((l) => l.score)) : null, situations: situations(mine) };
  });

  // the whole delivery: recordings that may belong together without a shared sound, a speaker with
  // material beside it, nothing but pictures or text
  const whole = [], by = (name) => files.find((x) => x.name === name), has = (r, kind) => r.files.some((nm) => by(nm).kind === kind);
  const media = files.filter((f) => f.recording), extras = files.filter((f) => f.kind === "still" || (f.recording && f.kind !== "audio" && !speaks(f)));
  const talk = recordings.filter((r) => r.files.some((nm) => speaks(by(nm))));
  for (const [screen, id] of [["desktop-screen", "B2"], ["phone-screen", "B5"]]) {
    if (recordings.some((r) => has(r, screen) && !has(r, "camera")) && recordings.some((r) => has(r, "camera") && !has(r, screen)))
      whole.push({ id, why: `a ${screen === "desktop-screen" ? "desktop's" : "phone's"} screen and a camera in separate files that share no sound: one recording, if they were made together` });
  }
  if (talk.length === 1 && extras.some((f) => !talk[0].files.includes(f.name))) whole.push({ id: "P4", why: "one recording carries the speech, the other files are silent clips or stills: material to show under it" });
  if (!media.length && files.some((f) => f.kind === "still")) whole.push({ id: "O3", why: "nothing but stills" });
  if (!media.length && files.every((f) => f.kind === "text")) whole.push({ id: "O2", why: "nothing but text" });
  if (recordings.some((r) => has(r, "finished")) && talk.some((r) => !has(r, "finished") && has(r, "camera"))) whole.push({ id: "F1", why: "a finished video and a separate recording of someone speaking: a reaction, if the speaker talks about that video" });

  fs.writeFileSync(path.join(outDir, "footage.json"), JSON.stringify({ made: new Date().toISOString(), files, recordings, whole }, null, 2));

  const lines = [];
  for (const f of files) {
    const x = f.facts || {};
    const what = f.kind === "text" || f.kind === "unreadable" ? "" : x.video || x.still ? `${x.width}×${x.height}${x.video ? `, ${x.duration} s, ${x.fps} fps` : ""}` : `${x.duration} s of sound`;
    lines.push(`${f.name}: ${f.sure ? "" : "probably "}${f.kind}${what ? ` (${what})` : ""}${f.recording ? `, recording ${f.recording}${f.starts != null ? `, starts at ${f.starts} s` : ""}` : ""}`);
    for (const e of f.evidence) lines.push(`    ${e}`);
    for (const q of f.open) lines.push(`    ? ${q}`);
    if (f.sheet) lines.push(`    look at ${path.join(outDir, f.sheet)}`);
  }
  for (const r of recordings) lines.push(`recording ${r.n} (${r.files.join(", ")}${r.together ? `: ${r.together}, score ${r.score}` : ""}) may be: ${r.situations.map((s) => `${s.id} (${s.why})`).join("; ") || "nothing this tool can name"}${r.open.length ? ` — the kind of ${r.open.join(", ")} is open: settle it on the sheet first, the situation follows from the kinds` : ""}`);
  for (const w of whole) lines.push(`all together may be: ${w.id} (${w.why})`);
  console.log(lines.join("\n"));
  console.log(`\nWritten: ${path.join(outDir, "footage.json")} and ${files.filter((f) => f.sheet).length} sheet(s).`);
  console.log("Next: open every sheet, answer the ? lines from what you see, and name each recording's situation with references/situations.md. These are suggestions from measurements: the sheets decide.");
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "look") look(rest[0], rest.slice(1));
else fail("usage: node kind.mjs look <out-folder> <file|folder>…");
