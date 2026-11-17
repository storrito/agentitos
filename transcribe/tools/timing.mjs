#!/usr/bin/env node
// Word times against the sound they were taken from: a number for the whole recording and a
// picture of one spot. transcribe.mjs does the check by itself for the words it writes; this is
// for looking at a spot it calls doubtful, and for words that came from somewhere else.
//
//   node tools/timing.mjs check <audio|video> <words.json> [--fix]
//       how many of the words lie where a voice is, and which do not (squeezed into a few
//       milliseconds, drawn over a pause, put into silence). --fix moves those to where the
//       voice is and writes the file again; a moved word gets by: "sound".
//   node tools/timing.mjs sheet <audio|video> <words.json> --at <m:ss> [--span 6] [--out <png>]
//       the sound around a moment as a picture: the waveform, under it in green where the tool
//       hears a voice, every word as a box over its time with its text; the same words printed.
//
// <words.json> is what transcribe.mjs wrote, or any { words: [...] } or [...] of
// { text | word, start, end } in seconds. An error is one sentence on stdout, exit 1.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { envelopeOf, threshold, voiced, bare, check, repair, HOP } from "./lib/timing.mjs";

const USAGE = "Usage: timing.mjs check <audio|video> <words.json> [--fix] | timing.mjs sheet <audio|video> <words.json> --at <m:ss> [--span 6] [--out <png>]";
const FLAGS = ["fix"];
const VALUED = ["at", "span", "out"];

const fail = (msg) => { console.log(msg); process.exit(1); };
const rel = (p) => path.relative(process.cwd(), p) || ".";
const clock = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

function parse(args) {
  const pos = [], opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const k = a.slice(2);
    if (FLAGS.includes(k)) { opts[k] = true; continue; }
    if (!VALUED.includes(k)) fail(`Unknown option ${a}. ${USAGE}`);
    if (i + 1 >= args.length || args[i + 1].startsWith("--")) fail(`${a} needs a value. ${USAGE}`);
    opts[k] = args[++i];
  }
  return [pos, opts];
}

// "1:23.5" or "83.5" → seconds
function seconds(s) {
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(String(s).trim());
  return m ? Number(m[1] || 0) * 60 + Number(m[2]) : NaN;
}

// the file's words as this tool works on them, each with the entry it came from
function wordsOf(file) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, "utf8")); } catch { fail(`${file} is no JSON file of words.`); }
  const list = Array.isArray(j) ? j : j?.words;
  if (!Array.isArray(list) || !list.length) fail(`${file} holds no words.`);
  const view = list.map((w) => ({ text: String(w.text ?? w.word ?? "").trim(), start: Number(w.start), end: Number(w.end), kind: w.kind, from: w }));
  if (view.some((w) => !w.text || !Number.isFinite(w.start) || !Number.isFinite(w.end))) fail(`${file} has words without text, start or end: each is { text, start, end } in seconds.`);
  return { json: j, view };
}

async function soundOf(file) {
  try {
    const env = await envelopeOf(file);
    if (!env.length) fail(`${file} has no sound to check the words against.`);
    return { env, thr: threshold(env) };
  } catch (e) { fail(`${String(e.message).split("\n")[0].replace(/\.$/, "")}.`); }
}

const [pos, opts] = parse(process.argv.slice(2));
const [command, file, wordsFile] = pos;
if (!["check", "sheet"].includes(command) || !file || !wordsFile) fail(USAGE);
for (const f of [file, wordsFile]) if (!fs.existsSync(f)) fail(`There is no ${f}.`);
const { json, view } = wordsOf(wordsFile);
const { env, thr } = await soundOf(file);

if (command === "check") {
  const b = bare(view);
  if (b.speech >= 20 && b.bare / b.speech > 0.3) {
    fail(`${b.bare} of the ${b.speech} words in ${rel(wordsFile)} have no length (start = end): their recognizer gave one time per word, and the sound cannot say which word a stretch of voice belongs to. Take the words again with their ends: node ${rel(path.join(path.dirname(process.argv[1]), "transcribe.mjs"))} ${rel(file)} --out <words.json>`);
  }
  const before = check(view, env, thr);
  const list = (off) => off.slice(0, 8).map((i) => `"${view[i].text}" at ${clock(view[i].start)}`).join(", ") + (off.length > 8 ? ` and ${off.length - 8} more` : "");
  const found = `${before.speech} words against the sound of ${rel(file)}: ${(before.inVoice * 100).toFixed(1)} % lie where the voice is`
    + (before.off.length ? `; ${before.squeezed} squeezed, ${before.stretched} drawn over a pause, ${before.silent} in silence` : "");
  if (!opts.fix) {
    console.log(`${found}${before.off.length ? `: ${list(before.off)}. Next: --fix moves them to where the voice is; sheet --at <m:ss> shows a spot.` : ". Nothing to fix."}`);
  } else {
    const was = view.map((w) => [w.start, w.end]);
    const { guessed } = repair(view, env, thr);
    let moved = 0;
    view.forEach((w, i) => {
      if (w.start === was[i][0] && w.end === was[i][1]) return;
      w.from.start = w.start; w.from.end = w.end; w.from.by = "sound";
      moved++;
    });
    const after = check(view, env, thr);
    if (!Array.isArray(json)) json.timing = { ...(json.timing || {}), checked: after.speech, inVoice: after.inVoice, moved: (json.timing?.moved || 0) + moved, doubtful: after.off };
    if (moved) fs.writeFileSync(wordsFile, JSON.stringify(json, null, 1));
    console.log(`${found}. ${moved ? `${moved} moved to where the voice is, ${rel(wordsFile)} written again` : "Nothing moved"}: ${(after.inVoice * 100).toFixed(1)} % now`
      + (guessed.length ? `; ${guessed.length} run${guessed.length > 1 ? "s" : ""} of words had to share one stretch of voice by their letters (a guess: ${guessed.map(([i]) => clock(view[i].start)).join(", ")})` : "")
      + (after.off.length ? `; still doubtful: ${list(after.off)}. Next: sheet --at <m:ss> shows a spot; a cut next to it wants an ear.` : "."));
  }
} else {
  const at = seconds(opts.at);
  if (!Number.isFinite(at)) fail(`sheet needs the moment to show: --at 1:23 (or seconds). ${USAGE}`);
  const span = opts.span === undefined ? 6 : Number(opts.span);
  if (!(span >= 1 && span <= 30)) fail("--span is the seconds the picture shows, 1 to 30.");
  const total = env.length * HOP;
  if (at > total) fail(`${rel(file)} is ${clock(total)} long: --at ${opts.at} lies after its end.`);
  const from = Math.max(0, Math.min(at - span / 2, total - span)), to = Math.min(total, from + span);
  const out = path.resolve(opts.out || `${wordsFile.replace(/\.json$/i, "")}.at-${clock(at).replace(":", "-")}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const W = 1600, WAVE = 260, H = 400;
  const x = (t) => Math.round(((t - from) / (to - from)) * W);
  const font = labelFont();
  const esc = (s) => String(s).replace(/\\/g, "").replace(/'/g, "’").replace(/[%:]/g, "\\$&");
  const text = (s, px, py, size, color) => (font ? `drawtext=fontfile=${font}:text='${esc(s)}':x=${px}:y=${py}:fontsize=${size}:fontcolor=${color}` : null);
  const filters = [];
  // a line every half second, the time under every whole one
  for (let t = Math.ceil(from * 2) / 2; t < to; t += 0.5) {
    const whole = Math.abs(t - Math.round(t)) < 1e-6;
    filters.push(`drawbox=x=${x(t)}:y=0:w=1:h=${whole ? H - 24 : WAVE}:color=0x3a4450:t=fill`);
    if (whole) filters.push(text(clock(t), x(t) + 4, H - 20, 14, "0x8a96a3"));
  }
  // where a voice is, as the tool hears it
  for (const [s, e] of voiced(env, thr, from, to)) filters.push(`drawbox=x=${x(s)}:y=${WAVE + 4}:w=${Math.max(2, x(e) - x(s))}:h=8:color=0x35c26b:t=fill`);
  // every word over its time: a band on the waveform, its text under it on three rows
  const shown = view.map((w, i) => ({ ...w, i })).filter((w) => w.end > from && w.start < to);
  const off = new Set(check(view, env, thr).off);
  shown.forEach((w, n) => {
    const color = off.has(w.i) ? "0xff5a4f" : n % 2 ? "0x4f9dff" : "0xffc24f";
    const x0 = Math.max(0, x(w.start)), x1 = Math.min(W, Math.max(x0 + 2, x(w.end)));
    filters.push(`drawbox=x=${x0}:y=0:w=${x1 - x0}:h=${WAVE}:color=${color}@0.28:t=fill`);
    filters.push(`drawbox=x=${x0}:y=${WAVE + 18}:w=${x1 - x0}:h=4:color=${color}:t=fill`);
    filters.push(text(w.text, x0, WAVE + 28 + (n % 3) * 24, 18, color));
  });
  const graph = `color=c=0x101418:s=${W}x${H}[bg];[0:a]aformat=channel_layouts=mono,showwavespic=s=${W}x${WAVE}:colors=0xd7dde4[w];[bg][w]overlay=0:0`
    + filters.filter(Boolean).map((f) => `,${f}`).join("") + "[v]";
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", from.toFixed(3), "-t", (to - from).toFixed(3), "-i", file, "-filter_complex", graph, "-map", "[v]", "-frames:v", "1", out], { encoding: "utf8" });
  if (r.status || !fs.existsSync(out)) fail(`ffmpeg made no picture of ${rel(file)}: ${(r.stderr || "").trim().split("\n").pop() || "no reason given"}.`);

  console.log(`${rel(out)}: ${clock(from)} to ${clock(to)} of ${rel(file)}, a line every half second; green under the waveform is where a voice is, a box is a word's time${font ? "" : " (this machine has no font for ffmpeg: the words are only in the lines below)"}, red is a word the sound contradicts.`);
  for (const w of shown) console.log(`  ${clock(w.start)}–${clock(w.end)}  ${w.text}${off.has(w.i) ? "   ← doubtful" : ""}${w.from.by ? `   (by ${w.from.by})` : ""}`);
  console.log(`Read the picture. A word that sits wrong: set its start and end in ${rel(wordsFile)} to where its voice is.`);
}

// a font for the words in the picture, when this ffmpeg can write text and the machine has one
function labelFont() {
  const has = spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" }).stdout || "";
  if (!/\sdrawtext\s/.test(has)) return null;
  const fc = spawnSync("fc-match", ["-f", "%{file}", "sans:bold"], { encoding: "utf8" });
  const found = fc.status === 0 && fc.stdout.trim();
  return [found, "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"].find((f) => f && fs.existsSync(f)) || null;
}
