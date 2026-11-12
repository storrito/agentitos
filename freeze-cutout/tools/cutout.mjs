#!/usr/bin/env node
// A clip that freezes for a moment while its subject pops out of the picture: the background
// turns black and white, the subject keeps its colour, grows a little and gets a sticker outline,
// then the clip runs on. For the first seconds of a short: the eye knows at once what it is about.
//
//   node tools/cutout.mjs <clip.mp4> <out.mp4> --at <seconds> [--subject "the robot"]
//                         [--style strong|soft] [--region x,y,w,h | band] [--work <folder>]
//
//   --at       the moment the picture freezes: the subject big, sharp and whole in it
//   --subject  what to cut out, in a few words (default: the main subject)
//   --style    strong: 0.7 s, up to 1.2 times its size, a thick outline (default);
//              soft: 0.45 s, 1.12 times, a thinner one
//   --region   the part of the frame the subject is looked for in: x,y,w,h, or `band` for the
//              sharp band of a clip that lies over a blurred copy of itself (found by its two
//              hard edges; the tool says where it found it). Default: the whole frame.
//   --work     where the mask and the picture to check are kept (default: beside <out.mp4>)
//
// The clip keeps its length and its frame rate: the freeze takes the pop's time out of its end.
// It comes out without sound: it is made for footage that lies under a voice.
// The mask comes from an image model through OpenRouter (the subject kept, everything else
// painted green; 7 to 14 cents a picture), is kept per picture in <work>/cutout-<key>.png and
// reused. Writes <out.mp4> and <work>/cutout-check.jpg, the frozen frame at the pop's largest:
// look at it. An error is one sentence, exit 1, and no <out.mp4>.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { need, GATEWAY_MAX } from "./lib/openrouter.mjs";

const USAGE = 'Usage: cutout.mjs <clip.mp4> <out.mp4> --at <seconds> [--subject "the robot"] [--style strong|soft] [--region x,y,w,h | band] [--work <folder>]';
const MODEL = process.env.CUTOUT_MODEL || "google/gemini-3.1-flash-image";
// seconds frozen while it pops, the largest size, the outline's width in px of a frame whose short side is 1080
const STYLES = { strong: [0.7, 1.2, 16], soft: [0.45, 1.12, 11] };
const FADE_IN = 0.08;       // the effect comes in over this
const BLEND = 0.25;         // and goes out over this, while the picture already moves again
const OUTLINE = [255, 59, 48];
const BG_DIM = 0.75;        // the black-and-white background, darkened to this
const SATURATION = 1.45;    // the subject's colours, stronger
const ASK_SIDE = 1536;      // the model sees the picture at most this large; the mask is scaled back
const MAX_PIXELS = 2560 * 1440;   // frames above this need more memory than a small machine has

const fail = (msg) => { console.log(msg); process.exit(1); };
const log = (s) => console.error(s);
const rel = (p) => path.relative(process.cwd(), p) || ".";

function parse(args) {
  const pos = [], opts = {}, valued = ["at", "subject", "style", "region", "work"];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") { console.log(USAGE); process.exit(0); }
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const k = a.slice(2);
    if (!valued.includes(k)) fail(`Unknown option ${a}. ${USAGE}`);
    if (i + 1 >= args.length) fail(`${a} needs a value. ${USAGE}`);
    opts[k] = args[++i];
  }
  return { pos, opts };
}

const onPath = (name) => String(process.env.PATH || "").split(path.delimiter).some((d) => { try { fs.accessSync(path.join(d, name), fs.constants.X_OK); return true; } catch { return false; } });
const ff = (args, opts = {}) => spawnSync("ffmpeg", ["-nostdin", "-v", "error", ...args], { maxBuffer: 1 << 30, ...opts });
const errOf = (r) => (r.error ? r.error.message : String(r.stderr || "").trim().split("\n").pop() || "ffmpeg failed");

// raw pictures in and out of ffmpeg: rgb24 or gray, no packages
function encode(raw, w, h, fmt, filter, codec) {
  const r = ff(["-f", "rawvideo", "-pix_fmt", fmt, "-s", `${w}x${h}`, "-i", "pipe:0", ...(filter ? ["-vf", filter] : []), "-frames:v", "1", "-f", "image2pipe", ...codec, "pipe:1"], { input: raw });
  if (r.status !== 0 || !r.stdout?.length) fail(`A picture could not be written: ${errOf(r)}`);
  return r.stdout;
}
function fromImage(bytes, w, h, fmt) {
  const r = ff(["-i", "pipe:0", "-vf", `scale=${w}:${h}:flags=lanczos`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", fmt, "pipe:1"], { input: bytes });
  if (r.status !== 0 || r.stdout?.length !== w * h * (fmt === "gray" ? 1 : 3)) return null;
  return r.stdout;
}

// ---------------------------------------------------------------- the region
// the sharp band of a clip laid over a blurred copy of itself: its two hard horizontal edges, one
// in each half, well apart; null when the picture has none
function bandRows(rgb, W, H) {
  const jump = new Float64Array(H - 1);
  let prev = null;
  for (let y = 0; y < H; y++) {
    const cur = new Float64Array(W);
    for (let x = 0, i = y * W * 3; x < W; x++, i += 3) cur[x] = 0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2];
    if (prev) { let s = 0; for (let x = 0; x < W; x++) s += Math.abs(cur[x] - prev[x]); jump[y - 1] = s / W; }
    prev = cur;
  }
  const half = Math.floor(H / 2);
  let top = 0, bot = half;
  for (let y = 0; y < half; y++) if (jump[y] > jump[top]) top = y;
  for (let y = half; y < H - 1; y++) if (jump[y] > jump[bot]) bot = y;
  if (jump[top] < 8 || jump[bot] < 8 || bot - top < H * 0.15) return null;
  return [top + 1, bot + 1];
}

// ---------------------------------------------------------------- the mask
// what came back: the subject as it was, everything else green. How much greener than red and
// blue a pixel is says whether it is background (so a subject that is itself bright green is lost).
function greenKey(rgb, n) {
  const m = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 3) {
    const green = rgb[i + 1] - Math.max(rgb[i], rgb[i + 2]);
    m[p] = Math.min(255, Math.max(0, 255 - (green - 60) * 4)) > 128 ? 1 : 0;
  }
  return m;
}
function erode(m, w, h) {
  const o = new Uint8Array(m.length);
  for (let y = 1; y < h - 1; y++) for (let x = 1, p = y * w + 1; x < w - 1; x++, p++) o[p] = m[p] & m[p - 1] & m[p + 1] & m[p - w] & m[p + w];
  return o;
}
function dilate(m, w, h) {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0, p = y * w; x < w; x++, p++) {
    o[p] = m[p] | (x > 0 ? m[p - 1] : 0) | (x < w - 1 ? m[p + 1] : 0) | (y > 0 ? m[p - w] : 0) | (y < h - 1 ? m[p + w] : 0);
  }
  return o;
}
// the pixels reached from `start` through pixels equal to `value`, marked `label` in `lab`
function flood(m, lab, w, start, value, label, stack) {
  let n = 0, top = 0;
  stack[top++] = start; lab[start] = label;
  while (top) {
    const p = stack[--top], x = p % w;
    n++;
    if (x > 0 && !lab[p - 1] && m[p - 1] === value) { lab[p - 1] = label; stack[top++] = p - 1; }
    if (x < w - 1 && !lab[p + 1] && m[p + 1] === value) { lab[p + 1] = label; stack[top++] = p + 1; }
    if (p >= w && !lab[p - w] && m[p - w] === value) { lab[p - w] = label; stack[top++] = p - w; }
    if (p < m.length - w && !lab[p + w] && m[p + w] === value) { lab[p + w] = label; stack[top++] = p + w; }
  }
  return n;
}
// One clean shape: small specks gone, the largest blob (and blobs a fifth of it or more), its
// holes filled. No mask, with the reason, when it cannot be a subject.
function clean(m0, w, h) {
  const m = dilate(dilate(erode(erode(m0, w, h), w, h), w, h), w, h);
  const lab = new Int32Array(m.length), stack = new Int32Array(m.length), sizes = [0];
  let largest = 0;
  for (let p = 0; p < m.length; p++) if (m[p] && !lab[p]) { const n = flood(m, lab, w, p, 1, sizes.length, stack); sizes.push(n); if (n > largest) largest = n; }
  if (!largest) return { why: "the model marked nothing" };
  const keep = new Uint8Array(m.length);
  for (let p = 0; p < m.length; p++) if (lab[p] && sizes[lab[p]] >= largest * 0.2) keep[p] = 1;
  // holes: background that no path leads out of
  const out = new Int32Array(m.length);
  const edge = (p) => { if (!keep[p] && !out[p]) flood(keep, out, w, p, 0, 1, stack); };
  for (let x = 0; x < w; x++) { edge(x); edge((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { edge(y * w); edge(y * w + w - 1); }
  let on = 0;
  for (let p = 0; p < m.length; p++) { if (!keep[p] && !out[p]) keep[p] = 1; on += keep[p]; }
  const part = on / m.length;
  if (part < 0.02 || part > 0.8) return { why: `the mask covers ${Math.round(part * 100)} % of the picture: that is no subject` };
  return { mask: keep, part };
}

// The model's answer to the picture, or a throw. `e.final` says that asking again changes
// nothing: no OpenRouter, a request it refuses.
async function askModel(jpeg, subject) {
  let api;
  try { api = await need("The cutout"); } catch (e) { e.final = true; throw e; }
  const url64 = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  if (api.gateway && url64.length > GATEWAY_MAX * 0.9) { const e = new Error("the picture is too large for the gateway"); e.final = true; throw e; }
  const prompt = `Cut out ${subject} in this photo. Output the SAME image with ${subject} unchanged, pixel for pixel, at exactly the same position, size and framing, and replace EVERYTHING else (sky, ground, walls, people, other objects, water, spray, smoke) with pure solid green #00FF00. Do not redraw, move or restyle ${subject}.`;
  const res = await fetch(`${api.base}/chat/completions`, {
    method: "POST", headers: { ...api.headers, "Content-Type": "application/json" }, signal: AbortSignal.timeout(300e3),
    body: JSON.stringify({ model: MODEL, modalities: ["image", "text"], messages: [{ role: "user", content: [
      { type: "text", text: prompt }, { type: "image_url", image_url: { url: url64 } }] }] }),
  });
  const text = await res.text();
  if (!res.ok) { const e = new Error(`the image model answered ${res.status}: ${text.slice(0, 160).replace(/\s+/g, " ")}`); e.final = res.status >= 400 && res.status < 500 && res.status !== 429; throw e; }
  let j;
  try { j = JSON.parse(text); } catch { throw new Error("the image model's answer could not be read"); }
  const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("the image model sent no picture");
  const m = url.match(/^data:image\/[\w.+-]+;base64,(.*)$/s);
  if (m) return { bytes: Buffer.from(m[1], "base64"), cost: j.usage?.cost || 0 };
  const pic = await fetch(url, { signal: AbortSignal.timeout(120e3) });
  if (!pic.ok) throw new Error(`the model's picture could not be fetched (${pic.status})`);
  return { bytes: Buffer.from(await pic.arrayBuffer()), cost: j.usage?.cost || 0 };
}

// ---------------------------------------------------------------- main
async function main() {
  const { pos, opts } = parse(process.argv.slice(2));
  const [clipArg, outArg] = pos;
  if (!clipArg || !outArg || opts.at == null) fail(USAGE);
  const clip = path.resolve(clipArg), out = path.resolve(outArg);
  if (!fs.existsSync(clip) || !fs.statSync(clip).isFile()) fail(`There is no ${rel(clip)}.`);
  const same = (a, b) => { try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return a === b; } };
  if (same(clip, out)) fail("The clip with the freeze needs a name of its own; the clip itself stays as it is.");
  const style = opts.style || "strong";
  if (!STYLES[style]) fail("--style is strong or soft.");
  const at = Number(opts.at);
  if (!(at >= 0)) fail("--at is the moment of the freeze in seconds of the clip.");
  const subject = (opts.subject || "the main subject").trim();
  const work = path.resolve(opts.work || path.dirname(out));
  for (const t of ["ffmpeg", "ffprobe"]) if (!onPath(t)) fail(`This needs ${t} on the machine; it is not there.`);

  // the clip as it is shown: a phone's clip is stored lying and turned by a note in the file
  const pr = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate,color_space,color_range,color_primaries,color_transfer:stream_side_data=rotation:stream_tags=rotate:format=duration", "-of", "json", clip], { encoding: "utf8" });
  let info = null;
  try { info = pr.status === 0 ? JSON.parse(pr.stdout || "{}") : null; } catch { /* no facts */ }
  const vs = info?.streams?.find((s) => s.codec_type === "video");
  if (!vs) fail(`${rel(clip)} is no video.`);
  const turned = Math.abs(Number(vs.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? vs.tags?.rotate ?? 0)) % 180 === 90;
  const W = turned ? vs.height : vs.width, H = turned ? vs.width : vs.height;
  if (W * H > MAX_PIXELS) fail(`${rel(clip)} is ${W}×${H}: larger than this tool takes on a small machine. Scale it to 1080 px on its short side first.`);
  const duration = Number(info.format?.duration);
  if (!(duration > 0)) fail(`${rel(clip)} does not say how long it is (a recording written as a stream): write it anew with ffmpeg first (ffmpeg -i <clip> -c copy <new.mp4>).`);
  // one constant frame rate for everything: the clip's own, as a fraction (30000/1001 stays what it is)
  const RATE = /^\d+\/\d+$/.test(vs.r_frame_rate || "") && !/\/0$|^0\//.test(vs.r_frame_rate) ? vs.r_frame_rate : "30/1";
  const [fa, fb] = RATE.split("/").map(Number), fps = fa / fb;
  if (!(fps >= 10 && fps <= 120)) fail(`${rel(clip)} names a frame rate of ${fps.toFixed(2)}: write it anew at 30 frames a second first.`);
  const [POP, SCALE, stroke1080] = STYLES[style], STROKE = Math.max(2, Math.round((stroke1080 * Math.min(W, H)) / 1080));
  const nTotal = Math.floor(duration * fps + 0.5), nPop = Math.round(POP * fps), nBlend = Math.round(BLEND * fps), k = Math.round(at * fps);
  const lead = Math.ceil(0.2 * fps), tail = nPop + nBlend + lead;
  if (k < lead || k + tail > nTotal) {
    fail(`A freeze at ${at} s does not fit a clip of ${duration.toFixed(2)} s: it needs ${(lead / fps).toFixed(1)} s before it and ${(tail / fps + 0.05).toFixed(1)} s after it.`);
  }
  // The way back from rgb must undo the way there, or the frames of the effect differ in colour
  // from the frames around them. Which pair of conversions does that depends on the clip's marks
  // and on the ffmpeg at hand: one of 2021 comes back right only when both ways are told bt601,
  // one of 2025 when it reads by the clip's own mark and is told that mark for the way back
  // (measured on a clip marked bt709: 25 to 35 dB with the wrong pair, 45 with the right one).
  // So each pair is tried on the frame that freezes, and the one that brings it back closest is taken.
  const full = vs.color_range === "pc", range = full ? "pc" : "tv";
  const FRAME = W * H * 3;
  const WAYS = [
    { there: `scale=in_color_matrix=bt601:in_range=${range},format=rgb24`, back: `scale=out_color_matrix=bt601:out_range=${range},format=yuv420p` },
    { there: "format=rgb24", back: `scale=out_color_matrix=bt709:out_range=${range},format=yuv420p` },
    { there: "format=rgb24", back: `scale=out_color_matrix=bt601:out_range=${range},format=yuv420p` },
  ];
  const read = (there, n) => ff(["-i", clip, "-vf", `fps=${RATE},select='between(n,${k},${k + n - 1})',setpts=N/(${RATE})/TB,${there}`, "-frames:v", String(n), "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
  let way = WAYS[0], closest = -1;
  for (const w of WAYS) {
    const one = read(w.there, 1);
    if (one.status !== 0 || one.stdout?.length !== FRAME) continue;
    const t = ff(["-v", "info", "-i", clip, "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-i", "pipe:0", "-lavfi",
      `[0:v]fps=${RATE},select='eq(n,${k})',format=yuv420p[o];[1:v]${w.back}[y];[o][y]psnr`, "-frames:v", "1", "-f", "null", "-"], { input: one.stdout });
    const found = /average:(inf|[0-9.]+)/.exec(String(t.stderr || ""));
    const db = found ? (found[1] === "inf" ? 999 : Number(found[1])) : -1;
    if (db > closest) { closest = db; way = w; }
  }
  const toYuv = way.back;

  // the frame that freezes and the ones the effect goes out over
  const rf = read(way.there, nBlend);
  if (rf.status !== 0 || (rf.stdout?.length || 0) < FRAME * nBlend) fail(`The frames around ${at} s could not be read: ${errOf(rf)}`);
  const frames = Array.from({ length: nBlend }, (_, i) => rf.stdout.subarray(i * FRAME, (i + 1) * FRAME));
  const F = frames[0];

  // where the subject is looked for
  let rx = 0, ry = 0, rw = W, rh = H, where = "the whole frame";
  if (opts.region === "band") {
    const band = bandRows(F, W, H);
    if (band) { ry = band[0]; rh = band[1] - band[0]; where = `the band from y ${ry} to ${ry + rh}`; }
    else where = "the whole frame (it has no band over a blurred copy)";
  } else if (opts.region) {
    const v = String(opts.region).split(",").map((x) => Math.round(Number(x)));
    [rx, ry, rw, rh] = v;
    if (v.length !== 4 || !v.every(Number.isFinite) || rw < 16 || rh < 16 || rx < 0 || ry < 0 || rx + rw > W || ry + rh > H) fail(`--region is x,y,w,h inside the frame of ${W}×${H}, or band.`);
    where = `x ${rx}-${rx + rw}, y ${ry}-${ry + rh}`;
  }
  const region = Buffer.alloc(rw * rh * 3);
  for (let y = 0; y < rh; y++) F.copy(region, y * rw * 3, ((ry + y) * W + rx) * 3, ((ry + y) * W + rx + rw) * 3);

  // the mask: kept per picture, subject and model
  fs.mkdirSync(work, { recursive: true });
  const key = crypto.createHash("sha1").update(region).update(`2|${MODEL}|${subject}|${rw}x${rh}`).digest("hex").slice(0, 12);
  const cache = path.join(work, `cutout-${key}.png`);
  let mask = null, how = "", cost = 0;
  if (fs.existsSync(cache)) {
    const g = fromImage(fs.readFileSync(cache), rw, rh, "gray");
    if (g) { mask = Uint8Array.from(g, (v) => (v > 128 ? 1 : 0)); how = "the mask kept from before"; }
  }
  if (!mask) {
    // the model sees the picture no larger than it needs: the mask only says where the subject is
    const side = Math.max(rw, rh), shrink = side > ASK_SIDE ? `scale=${Math.round((rw * ASK_SIDE) / side / 2) * 2}:-2:flags=lanczos` : null;
    const jpeg = encode(region, rw, rh, "rgb24", shrink, ["-vcodec", "mjpeg", "-q:v", "3"]);
    for (let attempt = 1; !mask; attempt++) {
      let why, shape = false, final = false;
      try {
        log(`cutout: asking ${MODEL} for ${subject} …`);
        const answer = await askModel(jpeg, subject);
        cost += answer.cost;
        const rgb = fromImage(answer.bytes, rw, rh, "rgb24");
        if (!rgb) why = "the model's picture could not be read";
        else {
          const c = clean(greenKey(rgb, rw * rh), rw, rh);
          if (c.mask) { mask = c.mask; how = `the mask covers ${Math.round(c.part * 100)} % of the picture`; } else { why = c.why; shape = true; }
        }
      } catch (e) { why = e.message; final = !!e.final; }
      if (mask) break;
      log(`cutout: try ${attempt}: ${why}`);
      if (attempt < 2 && !final) continue;
      // what to do depends on what went wrong: the picture, or the way to the model
      fail(shape
        ? `No cutout: ${why}. Another moment (--at) where the subject is big, sharp and whole, or name it more exactly (--subject); else leave the clip as it is.`
        : `No cutout: ${why}. That is not the picture's fault: leave the clip as it is, or try again later.`);
    }
    fs.writeFileSync(cache, encode(Buffer.from(mask.map((v) => v * 255)), rw, rh, "gray", null, ["-vcodec", "png"]));
  }

  // the mask on the whole frame, its middle, and the outline around it
  const A = new Uint8Array(W * H);
  let sx = 0, sy = 0, n = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    if (!mask[y * rw + x]) continue;
    const X = rx + x, Y = ry + y;
    A[Y * W + X] = 255; sx += X; sy += Y; n++;
    if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
  }
  const cx = sx / n, cy = sy / n;
  // a square of 2·STROKE+1 around every pixel of the mask, rows then columns
  const S = new Uint8Array(W * H), tmp = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let run = 0;
    for (let x = 0; x < Math.min(W, STROKE); x++) run += A[y * W + x] ? 1 : 0;
    for (let x = 0; x < W; x++) {
      if (x + STROKE < W && A[y * W + x + STROKE]) run++;
      if (run) tmp[y * W + x] = 255;
      if (x - STROKE >= 0 && A[y * W + x - STROKE]) run--;
    }
  }
  for (let x = 0; x < W; x++) {
    let run = 0;
    for (let y = 0; y < Math.min(H, STROKE); y++) run += tmp[y * W + x] ? 1 : 0;
    for (let y = 0; y < H; y++) {
      if (y + STROKE < H && tmp[(y + STROKE) * W + x]) run++;
      if (run) S[y * W + x] = 255;
      if (y - STROKE >= 0 && tmp[(y - STROKE) * W + x]) run--;
    }
  }

  // the subject's own pixels, a little stronger in colour and sharper
  const cr = ff(["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-i", "pipe:0", "-vf", `eq=saturation=${SATURATION},unsharp=5:5:1.1`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { input: F });
  const car = cr.status !== 0 || cr.stdout?.length !== FRAME ? F : cr.stdout;

  // a layer's value where the picture, grown by `s` about the subject's middle, shows (x, y)
  const sample = (layer, fx, fy) => {
    if (fx < 0 || fy < 0 || fx > W - 1 || fy > H - 1) return 0;
    const xa = Math.floor(fx), ya = Math.floor(fy), xb = Math.min(W - 1, xa + 1), yb = Math.min(H - 1, ya + 1), u = fx - xa, v = fy - ya;
    return (layer[ya * W + xa] * (1 - u) + layer[ya * W + xb] * u) * (1 - v) + (layer[yb * W + xa] * (1 - u) + layer[yb * W + xb] * u) * v;
  };
  // the effect over `base` (the frozen or the running frame) with the subject at size s, at strength f
  function effect(base, s, f) {
    const o = Buffer.alloc(FRAME);
    for (let i = 0; i < FRAME; i += 3) {
      const g = ((base[i] + base[i + 1] + base[i + 2]) / 3) * BG_DIM;
      o[i] = base[i] * (1 - f) + g * f; o[i + 1] = base[i + 1] * (1 - f) + g * f; o[i + 2] = base[i + 2] * (1 - f) + g * f;
    }
    // only where the grown outline can reach
    const grow = (v, c) => c + (v - c) * s, m = Math.ceil(STROKE * s) + 2;
    const ax = Math.max(0, Math.floor(grow(x0, cx)) - m), bx = Math.min(W - 1, Math.ceil(grow(x1, cx)) + m);
    const ay = Math.max(0, Math.floor(grow(y0, cy)) - m), by = Math.min(H - 1, Math.ceil(grow(y1, cy)) + m);
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
      const fx = cx + (x - cx) / s, fy = cy + (y - cy) / s;
      const st = sample(S, fx, fy) / 255;
      if (st <= 0) continue;
      const a = sample(A, fx, fy) / 255, i = (y * W + x) * 3;
      const q = (Math.min(H - 1, Math.max(0, Math.round(fy))) * W + Math.min(W - 1, Math.max(0, Math.round(fx)))) * 3;
      const g = ((base[i] + base[i + 1] + base[i + 2]) / 3) * BG_DIM;
      for (let c = 0; c < 3; c++) {
        const v = (g * (1 - st) + OUTLINE[c] * st) * (1 - a) + car[q + c] * a;
        o[i + c] = Math.max(0, Math.min(255, base[i + c] * (1 - f) + v * f));
      }
    }
    return o;
  }

  // the frames of the effect, one after the other into a file of this run's own: the pop on the
  // frozen frame, then the effect going out over the frames that already move
  const fxFile = path.join(work, `cutout-${key}-${process.pid}.rgb`), part = `${out}.part-${process.pid}.mp4`;
  let peak = null;
  try {
    const fd = fs.openSync(fxFile, "w");
    try {
      for (let i = 0; i < nPop; i++) {
        const t = i / fps, frame = effect(F, 1 + (SCALE - 1) * Math.sin((Math.PI * t) / POP), Math.min(1, t / FADE_IN));
        if (i === Math.floor(nPop / 2)) peak = frame;
        fs.writeSync(fd, frame);
      }
      for (let j = 0; j < nBlend; j++) {
        const u = (j + 1) / (nBlend + 1);
        fs.writeSync(fd, effect(frames[j], 1, 1 - u * u * (3 - 2 * u)));
      }
    } finally { fs.closeSync(fd); }

    // the clip up to the freeze, the effect, the clip on from where the effect ends; one encode,
    // everything on the same constant frame rate, the same number of frames as the clip has on it
    const rest = nTotal - k - nPop - nBlend;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const enc = ff(["-y", "-i", clip, "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-framerate", RATE, "-i", fxFile, "-filter_complex",
      `[0:v]fps=${RATE},split[a][b];[a]trim=end_frame=${k},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[h];`
      + `[1:v]${toYuv},setsar=1[e];`
      + `[b]trim=start_frame=${k + nBlend}:end_frame=${k + nBlend + rest},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[t];[h][e][t]concat=n=3:v=1:a=0[v]`,
      "-map", "[v]", "-an", "-r", RATE, "-c:v", "libx264", "-crf", "17", "-preset", "medium", "-g", String(Math.round(fps)), "-keyint_min", String(Math.round(fps)), "-pix_fmt", "yuv420p",
      ...(vs.color_space && vs.color_space !== "unknown" ? ["-colorspace", vs.color_space] : []), ...(vs.color_primaries && vs.color_primaries !== "unknown" ? ["-color_primaries", vs.color_primaries] : []),
      ...(vs.color_transfer && vs.color_transfer !== "unknown" ? ["-color_trc", vs.color_transfer] : []), ...(full ? ["-color_range", "pc"] : []), part], { encoding: "utf8" });
    if (enc.status !== 0 || !fs.existsSync(part)) fail(`The clip with the freeze could not be written: ${errOf(enc)}`);
    fs.renameSync(part, out);
  } finally {
    fs.rmSync(fxFile, { force: true });
    fs.rmSync(part, { force: true });
  }
  const check = path.join(work, "cutout-check.jpg");
  const cj = ff(["-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-i", "pipe:0", "-vf", "scale=540:-2", "-frames:v", "1", "-q:v", "4", check], { input: peak });
  const sound = info.streams.some((s) => s.codec_type === "audio");

  console.log(`${rel(out)}: it freezes at ${at} s, ${subject} pops for ${POP} s (${style}), then the clip runs on; ${(nTotal / fps).toFixed(2)} s at ${RATE.replace(/\/1$/, "")} frames a second, as the clip. Looked for in ${where}; ${how}${cost ? `, $${cost.toFixed(3)}` : ""}.${sound ? " The clip's sound is not in it." : ""}`);
  console.log(`${cj.status !== 0 ? "The picture to check could not be written: look at the clip itself" : `Look at ${rel(check)}`}: the outline goes around ${subject} only, nothing of it is cut off, nothing else is inside. Not so: another moment (--at), or the clip without the freeze.`);
}

main().catch((e) => fail(`It did not work: ${String(e?.message || e).split("\n")[0]}`));
