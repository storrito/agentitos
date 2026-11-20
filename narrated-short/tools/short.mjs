#!/usr/bin/env node
// A narrated short: a voice that tells one story in a few sentences, footage of its subject cut
// under the words, a text hook on the first seconds, a comparison card, captions. The voice,
// the music and the captions come from other skills of agentitos; this tool sets the clock, cuts
// the clips and writes the HyperFrames composition.
//
//   node tools/short.mjs clock <work> [--gap 0.3]
//        <work>/voice.json (launch-video's `voice`: a line a sentence) → the film's clock: where
//        each line plays, every sentence and word with its time; <work>/clock.json
//   node tools/short.mjs faces <work> [--all] [--again]
//        the faces of the beats marked "people": true (every beat with --all): each beat's stretch
//        of its source to agentitos' clips (frame.mjs --faces: a model's stills with the eyes,
//        nose and mouth, a tracker between them), <work>/faces/<id>.json; about 2 cents and half a
//        minute a beat. build reads them; without them build is what it was.
//   node tools/short.mjs build <work> <composition> [--platform tiktok] [--style hormozi] [--no-captions] [--under 17] [--no-faces]
//        <work>/beats.json and the clock → one clip per beat cut into <composition>/assets/clips/
//        and checked (dark, cut short, standing still, a dark first frame, a cut of the source
//        inside), the captions built by agentitos' captions (paused under the comparison card,
//        the key words marked, the beats' "boxes" as cards of their own), the first beat's freeze
//        by agentitos' freeze-cutout when the beat asks for one, and <composition>/index.html:
//        clips, voice, music (measured, 17 LU under the voice), hook text, card, credit, handle.
//        Changed beats: build again; a clip whose beat and source did not change is kept.
//        Where faces of a beat are known: a fill shows their eyes, nose and mouth (moved, or
//        raised over the ground), else a 4:5 or 1:1 crop placed high (agentitos' layout), else the
//        whole picture as a band; where the captions lie on eyes or a nose (or the mouth of a
//        speaker who looks into the camera, large in the picture), or the hook on a face,
//        layout gives one place for the captions (at their size) and the hook's place; each beat
//        says what was done and why, and a doubt never makes a beat worse.
//   node tools/short.mjs sheet <work> <composition>
//        stills of the composition at the moments that matter (the first frame, the hook, the
//        freeze, each beat at its start and middle, every card, the end) on one sheet,
//        <work>/sheet.jpg, to look at
//
// Text sits where platform-zones says the apps cover nothing; this tool keeps no numbers of its
// own. Every step says what it did and what to do next; an error is one sentence, exit 1.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loudness, musicVolume } from "./lib/level.mjs";
import { counted, planWindow, framed, bandOf, onOf, measureFault, measureSaid, inkOf, sane, looking, shownShare, talksIn, WEIGHT, TALK_FACE } from "./lib/faces.mjs";

const USAGE = "Usage: short.mjs clock <work> [--gap 0.3] | faces <work> [--all] [--again] | build <work> <composition> [--platform tiktok] [--style hormozi] [--no-captions] [--under 17] [--no-faces] | sheet <work> <composition>";
const fail = (msg) => { console.log(msg); process.exit(1); };
// how long layout's measure may take, s (it takes a tenth of a second; NARRATED_SHORT_MEASURE_LIMIT for a test)
const MEASURE_LIMIT = Number(process.env.NARRATED_SHORT_MEASURE_LIMIT) || 120;
const log = (s) => console.error(s);
const rel = (p) => path.relative(process.cwd(), p) || ".";
const self = () => (rel(process.argv[1]).startsWith("..") ? process.argv[1] : rel(process.argv[1]));
const r2 = (x) => Math.round(x * 100) / 100;
const down2 = (x) => Math.floor(x * 100 + 1e-6) / 100;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const readJson = (file, what) => {
  if (!fs.existsSync(file)) fail(`There is no ${rel(file)}: ${what}`);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { fail(`${rel(file)} is not JSON: ${e.message}`); }
};

const VERSION = 2;          // of the way a clip is cut: a clip cut by another version is cut anew
const SIZE = [1080, 1920];
const FPS = 30;
const HOOK_SECONDS = 2.5;   // the text hook stands this long from frame 0
const HOOK_ZOOM = 1.6;      // the first beat's band, larger: the subject fills the phone
const END_TAIL = 0.7;       // picture after the last word, so the end is not cut on the word
// The peak of the frames' mean luma under which a clip shows nothing. A band over its darkened
// copy lies lower than a full picture: 12 was measured on such clips (a near-black one 6.5, the
// darkest good night shot 22); a full frame of video black is 16, so it needs a higher line.
const DARK_MAX = { whole: 12, crop: 12, fill: 24, native: 24 };
const SHORT_TOL = 0.15;     // seconds a clip may be shorter than its beat
const FROZEN_PART = 0.5;    // part of a clip that stands still before it is mentioned
const OPEN_PART = 0.5;      // the hook's first frame reaches this part of the clip's median luma
// A beat's faces took 6 to 32 s (2026-11-19, twenty beats of public footage, 18 s on the mean); a
// model that never answers would hold a beat 600 s. A beat may take three times the slowest, the
// whole step twenty beats at the mean: what is left after it is built as without faces.
// (FACES_BEAT_SECONDS and FACES_STEP_SECONDS set others, for a test.)
const BEAT_LIMIT = (Number(process.env.FACES_BEAT_SECONDS) || 90) * 1e3, STEP_LIMIT = (Number(process.env.FACES_STEP_SECONDS) || 360) * 1e3;
const UNDER = 17;           // LU the music lies under the voice: as launch-video's `music` lays it, the distance the owner chose by ear
const lufs = (x) => x.toFixed(1).replace("-", "−");

function parse(args, valued = [], flags = []) {
  const pos = [], opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const k = a.slice(2);
    if (flags.includes(k)) { opts[k] = true; continue; }
    if (!valued.includes(k)) fail(`Unknown option ${a}. ${USAGE}`);
    if (i + 1 >= args.length) fail(`${a} needs a value. ${USAGE}`);
    opts[k] = args[++i];
  }
  return { pos, opts };
}

// another skill's tool, run as a program: the environment's name for it, else beside this skill,
// else in the machine's clone of the skills
function tool(env, skill, file) {
  const here = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  return [process.env[env], path.join(here, skill, "tools", file), `/home/sprite/skills/${skill}/tools/${file}`].find((p) => p && fs.existsSync(p)) || null;
}
const onPath = (name) => String(process.env.PATH || "").split(path.delimiter).map((d) => path.join(d, name)).find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) || null;
// what a program that ended badly said, or why it did not run or was stopped: its own sentence (the
// tools print one), else the error of a crash (never Node's last line, its version), with its cause
const reason = (r) => (r.error ? (r.error.code === "ENOENT" ? "the program is not on this machine" : r.error.code === "ETIMEDOUT" ? `it took longer than ${Math.round((r.limit || 0) / 1000) || "the"} s it may take and was stopped` : r.error.message)
  : r.signal ? `it was stopped (${r.signal})` : String(r.stdout || "").trim().split("\n").pop() || crashed(String(r.stderr || "")) || "it gave no reason");
function crashed(err) {
  const lines = err.split("\n");
  const e = lines.map((l) => l.match(/^(\w*Error)(?: \[\w+\])?: (.+)$/)).filter(Boolean).pop();
  if (!e) return lines.map((l) => l.trim()).filter((l) => l && !/^at |^Node\.js v|^\^+$|^file:\/\/|^[{}]$/.test(l)).pop() || "";
  const code = err.match(/\b(ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_\w+)\b/)?.[1];
  if (e[1] === "SyntaxError") return `the model's answer could not be read (${e[2].slice(0, 120)})`;
  if (/fetch failed/.test(e[2])) return `OpenRouter could not be reached${code ? ` (${code})` : ""}`;
  return e[2].slice(0, 200);
}

const ff = (args, opts = {}) => spawnSync("ffmpeg", ["-nostdin", ...args], { encoding: "utf8", maxBuffer: 256 << 20, ...opts });
function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], { encoding: "utf8" });
  if (r.status !== 0) return null;
  let j;
  try { j = JSON.parse(r.stdout || "{}"); } catch { return null; }
  const s = (j.streams || [])[0];
  return s ? { width: s.width, height: s.height, duration: Number(j.format?.duration) || 0 } : null;
}
const audioSeconds = (file) => {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  return Number(String(r.stdout || "").trim()) || 0;
};

// ---------------------------------------------------------------- clock
function clock(args) {
  const { pos, opts } = parse(args, ["gap"]);
  if (!pos[0]) fail(`Name the work folder: clock short/<name>. ${USAGE}`);
  const work = path.resolve(pos[0]);
  const gap = opts.gap != null ? Number(opts.gap) : 0.3;
  if (!(gap >= 0.1 && gap <= 2)) fail("--gap is the pause between two sentences in seconds, 0.1 to 2.");
  const voice = readJson(path.join(work, "voice.json"), "speak the script first with launch-video's `launch.mjs voice`.");
  if (!Array.isArray(voice.lines) || !voice.lines.length) fail(`${rel(path.join(work, "voice.json"))} holds no lines.`);
  // A line's file starts and ends in silence of a different length each time. So a line is placed
  // by its words: its first word `gap` after the last word of the line before; it plays from just
  // before its first word (`from`, in the file) to a little past its last, and never into the next.
  const lead = Math.min(0.05, gap / 3);
  const lines = [], words = [];
  let lastEnd = null;
  for (const l of voice.lines) {
    if (!Array.isArray(l.words) || !l.words.length || !l.file) fail(`The line ${l.id} has no words with times: speak it again with launch-video's \`launch.mjs voice\`.`);
    const w0 = l.words[0].start, wN = l.words.at(-1).end;
    const first = lastEnd == null ? w0 : lastEnd + gap;             // its first word, on the film's clock
    const from = lastEnd == null ? 0 : Math.max(0, w0 - lead);      // where its file is entered
    const at = r2(first - (w0 - from));                             // where its sound starts in the film
    for (const w of l.words) words.push({ text: w.text, start: r2(at + w.start - from), end: r2(at + w.end - from), line: l.id });
    lastEnd = at + wN - from;
    lines.push({ id: l.id, file: l.file, at, from: Math.round(from * 1000) / 1000, duration: wN - from + Math.min(0.25, Math.max(0, (Number(l.duration) || wN) - wN)),
      start: words.at(-l.words.length).start, end: r2(lastEnd), text: l.text });
  }
  // a line ends a hundredth before the next begins: two sounds never meet on one track
  lines.forEach((l, i) => { l.duration = down2(lines[i + 1] ? Math.min(l.duration, lines[i + 1].at - l.at - 0.01) : l.duration); });
  const end = words.at(-1).end;
  fs.writeFileSync(path.join(work, "clock.json"), JSON.stringify({ gap, end, lines, words }, null, 1));
  console.log(`The voice runs ${end.toFixed(2)} s: ${lines.length} sentences, ${words.length} words, ${gap} s between sentences (${voice.model || "?"}, voice ${voice.voice || "?"}).`);
  for (const l of lines) console.log(`  ${String(l.id).padEnd(6)} ${l.start.toFixed(2).padStart(6)}-${l.end.toFixed(2).padStart(6)}  ${l.text}`);
  console.log(words.map((w) => `${w.text}@${w.start.toFixed(2)}`).join(" "));
  console.log(`→ ${rel(path.join(work, "clock.json"))}. These times are the film's: write ${rel(path.join(work, "beats.json"))} by them (a beat changes between sentences, in the pause), then node ${self()} build ${rel(work)} <composition>.`);
}

// ---------------------------------------------------------------- faces
// The picture's size as it is shown: a phone stores an upright take as a wide one turned a quarter
function shownSize(file, size) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream_side_data=rotation:stream_tags=rotate", "-of", "json", file], { encoding: "utf8" });
  let turn = 0;
  try { const st = JSON.parse(r.stdout || "{}").streams?.[0]; turn = Number(st?.side_data_list?.find((d) => d.rotation != null)?.rotation ?? st?.tags?.rotate ?? 0); } catch { /* as stored */ }
  return Math.abs(turn) % 180 === 90 ? [size.height, size.width] : [size.width, size.height];
}
// what a beat's faces were found for: the stretch of the source its clip takes
const facesKey = (src, b, taken) => JSON.stringify({ file: src.file, stamp: src.stamp, at: b.at, taken });
const takenOf = (b) => Math.round(r2(b.to - b.from) * (b.speed ?? 1) * 1000) / 1000;
// the beats' times as build takes them: each starts where the one before ends, the last runs to the film's end
function timed(beats, ck) {
  const out = beats.map((b) => ({ ...b }));
  out.forEach((b, i) => { if (i) b.from = out[i - 1].to; });
  if (out.length && isNum(ck?.end)) out.at(-1).to = totalOf(out, ck);
  return out;
}

// Each beat's stretch of its source (as its clip takes it, at most 1080 lines, without sound and the
// file's tags) to agentitos' clips: frame.mjs --faces finds every face over time, the model's stills
// with the eyes, nose and mouth, a tracker between them. Kept per beat while its stretch is the same.
function faces(args) {
  const { pos, opts } = parse(args, [], ["all", "again"]);
  if (!pos[0]) fail(`Name the work folder: faces short/<name>. ${USAGE}`);
  const work = path.resolve(pos[0]);
  const beatsFile = path.join(work, "beats.json");
  const cfg = readJson(beatsFile, "write the beats first (SKILL.md, \"The beats\").");
  if (!cfg || !Array.isArray(cfg.beats) || !cfg.beats.length) fail(`${rel(beatsFile)} needs "beats": a list of them.`);
  for (const t of ["ffmpeg", "ffprobe"]) if (!onPath(t)) fail(`This needs ${t} on the machine; it is not there.`);
  const ck = readJson(path.join(work, "clock.json"), `run node ${self()} clock ${rel(work)} first.`);
  cfg.beats.forEach((b, i) => {
    if (!b || typeof b !== "object" || typeof b.id !== "string" || typeof b.source !== "string" || !isNum(b.from) || !isNum(b.to) || !isNum(b.at) || !(b.to > b.from)) fail(`Beat ${i + 1} is not a beat build can read: {"id", "from", "to", "source", "at"}; build first.`);
  });
  const beats = timed(cfg.beats, ck);
  const asked = beats.filter((b) => opts.all || b.people === true);
  const dir = path.join(work, "faces");
  fs.mkdirSync(dir, { recursive: true });
  // a beat no longer asked for: its faces go, so that build places it as before
  for (const f of fs.readdirSync(dir)) {
    const id = f.replace(/(\.people|\.tmp)?\.(mp4|json)$/, "");
    if (f !== "none.json" && !asked.some((b) => b.id === id)) fs.rmSync(path.join(dir, f), { force: true });
  }
  if (!asked.length) { console.log(`No beat is marked "people": true in ${rel(beatsFile)}: nothing sent, build places every beat as before. --all sends every beat.`); return; }
  const frameTool = tool("FRAME_TOOL", "clips", "frame.mjs");
  if (!frameTool) fail("Finding the faces needs agentitos' clips skill beside this one (or FRAME_TOOL naming its tools/frame.mjs); without them build places every beat as before.");
  const sources = sourcesOf(cfg, asked, beatsFile);
  const none = path.join(dir, "none.json");
  fs.writeFileSync(none, "[]\n");   // nobody speaks in a narrated short's footage
  let cost = 0, sent = 0, late = [];
  const started = Date.now();
  asked.forEach((b, k) => {
    const src = sources[k], taken = takenOf(b), key = facesKey(src, b, taken);
    const out = path.join(dir, `${b.id}.json`), stretch = path.join(dir, `${b.id}.mp4`);
    let kept = null;
    try { kept = JSON.parse(fs.readFileSync(out, "utf8")); } catch { /* not found yet */ }
    if (kept && kept.key === key && !opts.again) { console.log(`  ${b.id}: ${saidOf(kept)} (kept from before, nothing spent)`); return; }
    // a model that never answers costs a beat BEAT_LIMIT at most, and the step STEP_LIMIT in all
    const left = STEP_LIMIT - (Date.now() - started);
    if (left < 10e3) { late.push(b.id); return; }
    for (const f of [out, stretch, path.join(dir, `${b.id}.people.json`)]) fs.rmSync(f, { force: true });
    const t0 = Date.now();
    const shown = shownSize(src.file, src.size);
    const c = ff(["-v", "error", "-y", "-ss", String(b.at), "-t", String(taken), "-i", src.file, "-map_metadata", "-1", "-an", "-vf", shown[1] > 1080 ? "scale=-2:1080" : "null",
      "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", stretch]);
    if (c.status !== 0 || !fs.existsSync(stretch)) { fs.rmSync(stretch, { force: true }); console.log(`  ! ${b.id}: its stretch could not be cut (${reason({ ...c, stdout: "" })}); built as without faces`); return; }
    const tmp = path.join(dir, `${b.id}.tmp.json`);
    const limit = Math.min(BEAT_LIMIT, left);
    const r = spawnSync(process.execPath, [frameTool, stretch, none, "--aspect", "9:16", "--faces", tmp, "--every-shot"], { encoding: "utf8", maxBuffer: 64 << 20, timeout: limit, killSignal: "SIGKILL" });
    sent++;
    if (r.status !== 0 || !fs.existsSync(tmp)) { fs.rmSync(tmp, { force: true }); console.log(`  ! ${b.id}: no faces (${reason({ ...r, limit })}); built as without faces`); return; }
    const got = JSON.parse(fs.readFileSync(tmp, "utf8"));
    fs.rmSync(tmp, { force: true });
    // the stretch's px back to the source's, as shown
    const kx = shown[0] / got.size[0], ky = shown[1] / got.size[1];
    const back = (x) => [Math.round(x[0] * kx), Math.round(x[1] * ky), Math.round(x[2] * kx), Math.round(x[3] * ky)];
    const list = { key, source: shown, step: got.step, by: got.by, model: got.model || null, cost: got.cost || 0, seconds: Math.round((Date.now() - t0) / 100) / 10, taken,
      shots: got.shots, faces: got.faces.map((f) => ({ t: f.t, boxes: f.boxes.map((x) => ({ who: x.who, box: back(x.box), ...(x.feat ? { feat: back(x.feat) } : {}), ...(x.looks ? { looks: x.looks } : {}) })) })) };
    fs.writeFileSync(out, JSON.stringify(list) + "\n");
    cost += list.cost;
    console.log(`  ${b.id}: ${saidOf(list)}; $${list.cost.toFixed(3)}, ${list.seconds.toFixed(0)} s`);
  });
  if (late.length) console.log(`  ! ${late.join(", ")}: not sent, the step has had its ${Math.round(STEP_LIMIT / 1e3)} s; built as without faces (node ${self()} faces ${rel(work)} again sends them, the others are kept)`);
  console.log(`${sent ? `${sent} beat(s) sent, $${cost.toFixed(3)} in all, ${((Date.now() - started) / 1000).toFixed(0)} s` : "Nothing sent"}; the faces in ${rel(dir)}. Next: node ${self()} build ${rel(work)} <composition>: it moves a crop that would cut a face and keeps the captions and the hook off them, and says per beat what it did.`);
}
// a beat's faces in a line: who, how large, how often
function saidOf(list) {
  const { held, small } = counted(list, list.source, list.taken || 1);
  const all = [...held, ...small];
  if (!all.length) return "no face found: the beat stays as it is";
  const tallest = Math.max(...all.map((p) => p.h));
  return `${all.length} ${all.length > 1 ? "people" : "person"} (${all.map((p) => p.who).join(", ")}), the largest face ${Math.round((tallest / list.source[1]) * 100)} % of the picture's height${small.length ? `; ${small.length} too small or too briefly seen to move the picture for` : ""}`;
}

// ---------------------------------------------------------------- the clips
// a part of the source (box.src) in a part of the frame (box.at) over the same blurred, darkened copy:
// a crop placed high, or a fill raised over the ground. A raised fill (box.fade) ends in no hard
// line above the ground: its last box.fade rows go over into it, from the whole picture to none
// (an eased ramp, so that neither end shows); only those rows are made transparent, the rest is laid as it is.
function cropped({ src: [sx, sy, sw, sh], at: [ax, ay, aw, ah], fade = 0 }) {
  const ground = `split[a][b];[a]scale=${SIZE[0]}:${SIZE[1]}:force_original_aspect_ratio=increase,crop=${SIZE[0]}:${SIZE[1]},boxblur=40:3,eq=brightness=-0.18[bg];[b]crop=${sw}:${sh}:${sx}:${sy},scale=${aw}:${ah}:flags=lanczos[fg];`;
  if (!(fade > 0)) return `${ground}[bg][fg]overlay=${ax}:${ay}`;
  const ramp = "(Y+0.5)/H";
  return `${ground}[fg]split[up][low];[up]crop=${aw}:${ah - fade}:0:0[top];[low]crop=${aw}:${fade}:0:${ah - fade},format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*(1-${ramp}*${ramp}*(3-2*${ramp}))'[end];`
    + `[bg][top]overlay=${ax}:${ay}[raised];[raised][end]overlay=${ax}:${ay + ah - fade}:format=yuv420`;
}
// the whole wide frame as a band over a blurred, darkened copy of itself
function whole(zoom, pan) {
  const w = Math.round((SIZE[0] * zoom) / 2) * 2;
  const band = w === SIZE[0] ? `scale=${SIZE[0]}:-2:flags=lanczos`
    : `scale=${w}:-2:flags=lanczos,crop=${SIZE[0]}:ih:${Math.floor((w - SIZE[0]) * pan)}:0`;
  return `split[a][b];[a]scale=${SIZE[0]}:${SIZE[1]}:force_original_aspect_ratio=increase,crop=${SIZE[0]}:${SIZE[1]},boxblur=40:3,eq=brightness=-0.18[bg];[b]${band}[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`;
}
const FRAMES = {
  fill: `scale=-2:${SIZE[1]}:flags=lanczos,crop=${SIZE[0]}:${SIZE[1]}`,
  native: `scale=${SIZE[0]}:${SIZE[1]}:force_original_aspect_ratio=increase,crop=${SIZE[0]}:${SIZE[1]}`,
};

// black bars burnt into a source over this stretch, as a crop filter ("" without): only a
// stable, even crop counts, so a dark night shot is left alone
function bars(src, at, seconds, size) {
  const r = ff(["-v", "info", "-ss", String(at), "-t", String(seconds), "-i", src, "-an", "-vf", "fps=4,cropdetect=24:2:0", "-f", "null", "-"]);
  const seen = [...String(r.stderr || "").matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].map((m) => m.slice(1).join(":"));
  if (seen.length < 4) return "";
  const count = {};
  for (const s of seen) count[s] = (count[s] || 0) + 1;
  const [most, n] = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  if (n < 0.8 * seen.length) return "";
  const [cw, ch, x, y] = most.split(":").map(Number), { width: W, height: H } = size;
  const cutH = H - ch > 0.06 * H && Math.abs(y - (H - ch - y)) <= 0.02 * H;
  const cutW = W - cw > 0.06 * W && Math.abs(x - (W - cw - x)) <= 0.02 * W;
  if (!cutH && !cutW) return "";
  return `crop=${cutW ? cw : W}:${cutH ? ch : H}:${cutW ? x : 0}:${cutH ? y : 0},`;
}

// what a cut clip measures, once: its length, the frames' mean luma, how long it stands still
function measure(file) {
  const dur = probe(file)?.duration || 0;
  const l = ff(["-v", "info", "-i", file, "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-"]);
  const ys = [...String(l.stderr || "").matchAll(/YAVG=([0-9.]+)/g)].map((m) => Number(m[1]));
  const sorted = [...ys].sort((a, b) => a - b);
  const f = ff(["-v", "info", "-i", file, "-vf", "freezedetect=n=-60dB:d=0.5", "-f", "null", "-"]);
  const starts = [...String(f.stderr || "").matchAll(/freeze_start:\s*([0-9.]+)/g)].map((m) => Number(m[1]));
  const lengths = [...String(f.stderr || "").matchAll(/freeze_duration:\s*([0-9.]+)/g)].map((m) => Number(m[1]));
  // a clip that stands still to its end names the start of that only
  const frozen = lengths.reduce((a, b) => a + b, 0) + (starts.length > lengths.length ? Math.max(0, dur - starts.at(-1)) : 0);
  return { dur: r2(dur), peak: ys.length ? r2(Math.max(...ys)) : 0, first: ys.length ? r2(ys[0]) : 0, median: sorted.length ? r2(sorted[Math.floor(sorted.length / 2)]) : 0, frozen: r2(frozen) };
}

// ---------------------------------------------------------------- the words for the captions
const bare = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const isEmoji = (t) => /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3)/u.test(t) && !/\p{L}/u.test(t) && !/^[#*0-9]+$/.test(t);
// every place a phrase is said among the words that count (a word of punctuation alone does not): [first, last]
function places(words, want) {
  const said = words.map((w, i) => (bare(w.text) ? i : -1)).filter((i) => i >= 0), out = [];
  for (let s = 0; want.length && s + want.length <= said.length; s++) {
    if (want.every((t, k) => bare(words[said[s + k]].text) === t)) out.push([said[s], said[s + want.length - 1]]);
  }
  return out;
}
// a phrase as the words to look for, and the emoji in front of it when it has one
function phraseOf(phrase) {
  const tokens = String(phrase).trim().split(/\s+/).filter(Boolean);
  const icon = tokens.length > 1 && isEmoji(tokens[0]) ? tokens.shift() : null;
  return { icon, want: tokens.map(bare).filter(Boolean) };
}
// the key words in colour: every place a key is said
function markKeys(words, keys) {
  const missed = [];
  for (const key of keys) {
    const found = places(words, phraseOf(key).want);
    for (const [a, z] of found) for (let i = a; i <= z; i++) if (bare(words[i].text)) words[i].highlight = true;
    if (!found.length) missed.push(key);
  }
  return missed;
}
// Spoken phrases as cards of their own in the captions: the marks agentitos' captions reads
// ("box" on the phrase's words, "icon" on its first), set as its `box` command sets them. The
// first place a phrase is said and is free is taken.
function markBoxes(words, phrases) {
  const missed = [];
  let n = 0;
  for (const phrase of phrases) {
    const { icon, want } = phraseOf(phrase);
    const place = places(words, want).find(([a, z]) => !words.slice(a, z + 1).some((w) => w.box));
    if (!place) { missed.push(phrase); continue; }
    n++;
    for (let i = place[0]; i <= place[1]; i++) { words[i].box = n; delete words[i].highlight; }
    if (icon) words[place[0]].icon = icon;
  }
  return { n, missed };
}

// ---------------------------------------------------------------- the text hook
// the largest size at which the hook fits two lines (three under 80 px) in `room` px; capitals of
// a heavy grotesque are about 0.64 em wide. The browser balances the lines.
function hookSize(text, room) {
  const words = text.split(/\s+/);
  const width = (s, px) => s.length * 0.64 * px * 1.03;
  for (const [px, lines] of [[104, 2], [96, 2], [88, 2], [80, 2], [76, 3], [68, 3], [60, 3]]) {
    let n = 1, cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && width(next, px) > room) { n++; cur = w; } else cur = next;
    }
    if (n <= lines && words.every((w) => width(w, px) <= room)) return px;
  }
  return 56;
}

// the lines the hook takes at px in room px, as hookSize wraps it
function hookLines(text, px, room) {
  const width = (s) => s.length * 0.64 * px * 1.03;
  let n = 1, cur = "";
  for (const w of text.split(/\s+/)) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && width(next) > room) { n++; cur = w; } else cur = next;
  }
  return n;
}

// the brand's primary colour from its DESIGN.md (brand-kit), when the working directory has one
function brandAccent() {
  const file = path.resolve("brand", "DESIGN.md");
  if (!fs.existsSync(file)) return null;
  const front = fs.readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const colors = front.match(/^colors:\n((?:[ \t]+.*\n?)+)/m)?.[1] ?? "";
  return colors.match(/^[ \t]+primary:\s*["']?(#[0-9a-fA-F]{3,8})["']?/m)?.[1] || null;
}

// every beat's source: a file, or a stem of the footage folder with the source's own cuts
function sourcesOf(cfg, beats, beatsFile) {
  const text = (v) => typeof v === "string" && v.trim() !== "";
  const footage = text(cfg.footage) ? path.resolve(cfg.footage) : null;
  let known = [];
  if (footage && fs.existsSync(path.join(footage, "sources.json"))) {
    try { known = JSON.parse(fs.readFileSync(path.join(footage, "sources.json"), "utf8")); } catch { /* no facts of the sources */ }
    if (!Array.isArray(known)) known = [];
  }
  return beats.map((b) => {
    const direct = path.resolve(b.source);
    let file = null, cuts;
    if (fs.existsSync(direct) && fs.statSync(direct).isFile()) file = direct;
    else {
      if (!footage) fail(`Beat ${b.id}: "${b.source}" is no file, and ${rel(beatsFile)} names no "footage" folder to find it in.`);
      const stem = String(b.source).replace(/\.mp4$/i, "");
      file = path.join(footage, `${stem}.mp4`);
      if (!fs.existsSync(file)) fail(`Beat ${b.id}: there is no ${rel(file)}.`);
      cuts = known.find((s) => s?.stem === stem)?.cuts;
    }
    const size = probe(file);
    if (!size) fail(`Beat ${b.id}: ${rel(file)} is no video.`);
    const st = fs.statSync(file);
    return { file, cuts: Array.isArray(cuts) ? cuts : null, size, stamp: `${st.size}:${Math.round(st.mtimeMs)}` };
  });
}

// the film's length: a little past the last word, or the last beat's end when that is later
const totalOf = (beats, ck) => r2(Math.max(ck.end + END_TAIL, beats.at(-1).to));

// ---------------------------------------------------------------- build
function build(args) {
  const { pos, opts } = parse(args, ["platform", "style", "under"], ["no-captions", "no-faces"]);
  const [workArg, compArg] = pos;
  if (!workArg || !compArg) fail(`Name the work folder and the composition: build short/<name> artifacts/<name>/composition. ${USAGE}`);
  const musicUnder = opts.under != null ? Number(opts.under) : UNDER;
  if (!(musicUnder >= 3 && musicUnder <= 30)) fail(`--under is how many LU the music lies under the voice, 3 to 30 (${UNDER} by default).`);
  const work = path.resolve(workArg), comp = path.resolve(compArg);
  const beatsFile = path.join(work, "beats.json");
  const cfg = readJson(beatsFile, "write the beats first (SKILL.md, \"The beats\").");
  const ck = readJson(path.join(work, "clock.json"), `run node ${self()} clock ${rel(work)} first.`);
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) fail(`${rel(beatsFile)} is not the beats: {"credit", "handle", "hook", "beats", …}.`);
  if (!Array.isArray(ck.lines) || !Array.isArray(ck.words) || !ck.words.length || !isNum(ck.end)) fail(`${rel(path.join(work, "clock.json"))} is not a clock: run node ${self()} clock ${rel(work)} again.`);
  for (const t of ["ffmpeg", "ffprobe"]) if (!onPath(t)) fail(`This needs ${t} on the machine; it is not there.`);

  // the voice's files lie in the composition, where launch-video's `voice` wrote them
  const missing = ck.lines.filter((l) => !fs.existsSync(path.join(comp, l.file))).map((l) => l.file);
  if (missing.length) fail(`The voice's files are not in ${rel(comp)} (${missing.slice(0, 2).join(", ")}${missing.length > 2 ? ", …" : ""}): launch-video's \`launch.mjs voice\` takes the composition as its third argument.`);

  // ---- what the beats must say
  const text = (v) => typeof v === "string" && v.trim() !== "";
  if (!text(cfg.credit)) fail(`${rel(beatsFile)} needs "credit": the footage's owner, on screen the whole time.`);
  if (!text(cfg.handle)) fail(`${rel(beatsFile)} needs "handle": the account's @name, shown at the end.`);
  const hook = cfg.hook && typeof cfg.hook === "object" ? cfg.hook : {};
  if (!text(hook.text) || !text(hook.key)) fail(`${rel(beatsFile)} needs "hook": {"text": two to five words in capitals, "key": the one word of them in colour}.`);
  for (const k of ["keys", "boxes"]) if (cfg[k] != null && !(Array.isArray(cfg[k]) && cfg[k].every(text))) fail(`"${k}" is a list of phrases as the voice says them: ["one foot", "NASA's"].`);
  const warn = [];
  const hookWords = hook.text.trim().split(/\s+/);
  if (hookWords.length < 2 || hookWords.length > 5) warn.push(`the hook text has ${hookWords.length} words; two to five read in the time it stands`);
  if (!hookWords.some((w) => bare(w) === bare(hook.key))) fail(`The hook's key "${hook.key}" is not a word of its text "${hook.text}".`);
  if (!Array.isArray(cfg.beats) || !cfg.beats.length) fail(`${rel(beatsFile)} needs "beats": a list of them.`);
  const beats = cfg.beats.map((b) => (b && typeof b === "object" ? { ...b } : b));
  const ids = new Set();
  beats.forEach((b, i) => {
    if (!b || typeof b !== "object") fail(`Beat ${i + 1} is no beat: {"id", "from", "to", "source", "at"}.`);
    if (typeof b.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(b.id) || b.id.endsWith("-pop") || ids.has(b.id)) fail(`Beat ${i + 1} needs an "id" of its own: lowercase letters, digits and dashes.`);
    ids.add(b.id);
    for (const k of ["from", "to", "at"]) if (!isNum(b[k]) || b[k] < 0) fail(`Beat ${b.id} needs "${k}" as a number of seconds, 0 or more.`);
    if (!text(b.source)) fail(`Beat ${b.id} needs "source": a source of the footage folder, or a video file.`);
    if (!(b.to > b.from)) fail(`Beat ${b.id} ends before it starts.`);
    if (i === 0 && b.from !== 0) fail("The first beat starts at 0.");
    if (i && Math.abs(b.from - beats[i - 1].to) > 0.011) fail(`Beat ${b.id} starts at ${b.from}, the beat before ends at ${beats[i - 1].to}: beats follow each other without a gap.`);
    if (i) b.from = beats[i - 1].to;   // a hundredth apart would be a frame without a picture
    if (b.frame != null && !["whole", "fill", "native"].includes(b.frame)) fail(`Beat ${b.id}: "frame" is whole (the wide frame as a band over a blurred copy), fill (a 9:16 crop, from the middle unless "pan" or the faces say otherwise) or native (the source is vertical); left out, the largest picture that holds the faces found, else the band.`);
    if (b.speed != null && !(isNum(b.speed) && b.speed >= 0.5 && b.speed <= 1)) fail(`Beat ${b.id}: "speed" slows the source down, a number from 0.5 to 1.`);
    if (b.zoom != null && !(isNum(b.zoom) && b.zoom >= 1 && b.zoom <= 3)) fail(`Beat ${b.id}: "zoom" makes the band larger, a number from 1 to 3.`);
    if (b.pan != null && !(isNum(b.pan) && b.pan >= 0 && b.pan <= 1)) fail(`Beat ${b.id}: "pan" is the part of the width that stays (of a zoomed band or a fill), a number from 0 (the left) to 1 (the right).`);
    if (b.freeze != null && (i !== 0 || !isNum(b.freeze) || b.freeze < 0)) fail(`Beat ${b.id}: "freeze" is the second into the first beat where its picture freezes; only the first beat has one.`);
    if (b.pop != null && !["strong", "soft"].includes(b.pop)) fail(`Beat ${b.id}: "pop" is strong or soft.`);
  });
  const voiceEnd = ck.end, last = beats.at(-1);
  const total = totalOf(beats, ck);
  if (total - last.to > 3) warn.push(`the last beat ends at ${last.to} s, the voice at ${voiceEnd} s: it is stretched by ${(total - last.to).toFixed(1)} s; another beat instead?`);
  if (last.to > voiceEnd + 2) warn.push(`the beats run ${(last.to - voiceEnd).toFixed(1)} s past the last word; the loop wants a short tail`);
  last.to = total;

  const card = cfg.compare || null;
  if (card) {
    if (typeof card !== "object" || !isNum(card.at) || !isNum(card.for) || !(card.for > 0)) fail(`"compare" needs "at" and "for" in seconds, "for" above 0.`);
    if (!Array.isArray(card.rows) || card.rows.length < 2 || card.rows.length > 4 || card.rows.some((r) => !Array.isArray(r) || r.length < 3 || !(Number(r[1]) > 0))) fail(`"compare" needs two rows [label, value above 0, what is shown], the video's subject first.`);
    if (card.at < HOOK_SECONDS || card.at + card.for > total - 0.3) fail(`The comparison card (${card.at} s for ${card.for} s) must lie between ${HOOK_SECONDS} s and ${(total - 0.3).toFixed(2)} s.`);
    if (card.rows.length !== 2) warn.push(`the comparison card has ${card.rows.length} rows; two read at a glance (the subject and one comparison)`);
    if (card.for < 2.5) warn.push(`the comparison card stands ${card.for} s; the sentence under it should run 2.5 s or longer`);
  }
  const endAt = r2(Math.max(voiceEnd - 1.2, last.from, HOOK_SECONDS));
  if (card && card.at + card.for > endAt) warn.push(`the comparison card stands until ${r2(card.at + card.for)} s, the handle comes at ${endAt} s in the same place: end the card earlier`);

  // ---- everything it needs, before a clip is cut
  const zonesTool = tool("PLATFORM_ZONES", "platform-zones", "zones.mjs");
  if (!zonesTool) fail("The platforms' zones need agentitos' platform-zones skill beside this one (or PLATFORM_ZONES naming its tools/zones.mjs).");
  const platforms = String(opts.platform || cfg.platforms || "").split(",").map((s) => s.trim()).filter(Boolean);
  const zr = spawnSync(process.execPath, [zonesTool, "zones", ...platforms, "--size", SIZE.join("x"), "--json"], { encoding: "utf8" });
  let zones = null;
  try { zones = zr.status === 0 ? JSON.parse(zr.stdout) : null; } catch { /* said below */ }
  const top = zones?.wide || zones?.centred;   // the stretch above the buttons, the frame's whole width
  if (!Array.isArray(top)) fail(`platform-zones did not say where text may stand: ${reason(zr)}`);
  const capTool = opts["no-captions"] ? null : tool("CAPTIONS_TOOL", "captions", "captions.mjs");
  if (!opts["no-captions"] && !capTool) fail("The captions need agentitos' captions skill beside this one (or CAPTIONS_TOOL naming its tools/captions.mjs); without captions: --no-captions.");

  const sources = sourcesOf(cfg, beats, beatsFile);
  // the faces `faces` found in a beat's stretch, where they are of the stretch the beat takes now
  const faceLists = beats.map((b, i) => {
    const file = path.join(work, "faces", `${b.id}.json`);
    if (opts["no-faces"] || !fs.existsSync(file)) return null;
    let list = null;
    try { list = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* said below */ }
    if (!list || list.key !== facesKey(sources[i], b, takenOf(b))) { warn.push(`the faces of ${b.id} are of another stretch of its source: node ${self()} faces ${rel(work)} again; built as without them`); return null; }
    // a box that cannot be a face (none, or past the picture, or the whole picture) is left out
    const kept = sane(list, list.source);
    for (const [who, n] of kept.dropped) warn.push(`${b.id}: the face box of "${who}" cannot be a face at ${n} moment(s) (no size, mostly outside the picture, or the whole picture): left out`);
    return kept.list;
  });

  // ---- the captions: agentitos' captions, paused under the card, the key words and the boxes marked
  const words = ck.words.map((w) => ({ text: w.text, start: w.start, end: w.end }));
  const cardEnd = card ? r2(card.at + card.for) : 0;
  const under = (w) => card && w.start >= card.at - 0.05 && w.start < cardEnd - 0.02;   // (the card ends where the next sentence starts)
  const shown = words.filter((w) => !under(w));
  const whyNot = (phrase) => (card && places(words, phraseOf(phrase).want).length ? "it is said under the comparison card, where the captions pause" : "it is not said like that");
  for (const k of markKeys(shown, cfg.keys || [])) warn.push(`the key "${k}" marks nothing: ${whyNot(k)}`);
  const boxes = markBoxes(shown, cfg.boxes || []);
  for (const k of boxes.missed) warn.push(`no card for the box "${k}": ${whyNot(k)}, or its words are in another box`);
  let mount = "";
  const wordsFile = path.join(work, "words.json");
  const brand = fs.existsSync(path.resolve("brand", "DESIGN.md")) ? ["--brand", path.resolve("brand", "DESIGN.md")] : [];
  const capArgs = [capTool, "build", wordsFile, path.join(comp, "captions"), "--style", String(opts.style || cfg.captions || "hormozi"),
    ...(platforms.length ? ["--platform", platforms.join(",")] : []), ...brand, "--duration", String(total)];
  // where the captions stand, as this build sets them (captions' area.json, written by the build
  // below; one of an earlier build is removed first, so that a first build and a rebuild are the same)
  let area = null;
  if (capTool) {
    fs.rmSync(path.join(comp, "captions", "area.json"), { force: true });
    const write = () => fs.writeFileSync(wordsFile, JSON.stringify({ width: SIZE[0], height: SIZE[1], duration: total, words: shown }, null, 1));
    write();
    // an older captions knows no boxes and would show the phrases as plain captions without a word
    if (boxes.n && spawnSync(process.execPath, [capTool, "box", wordsFile], { encoding: "utf8" }).status !== 0) {
      warn.push(`the captions skill here knows no boxes yet: the ${boxes.n} phrase(s) show as plain captions`);
      for (const w of shown) { delete w.box; delete w.icon; }
      boxes.n = 0;
      write();
    }
    const cr = spawnSync(process.execPath, capArgs, { encoding: "utf8" });
    mount = String(cr.stdout || "").split("\n").find((l) => /<div[^>]+data-composition-src=/.test(l))?.trim() || "";
    if (cr.status !== 0 || !mount) fail(`The captions could not be built: ${reason(cr)}`);
    try { area = JSON.parse(fs.readFileSync(path.join(comp, "captions", "area.json"), "utf8")); } catch { /* an older captions: no area to check */ }
  } else fs.rmSync(wordsFile, { force: true });   // no captions: no words of an earlier build for the sheet to go by
  // where the captions stand in the frame: a picture the tool places keeps the eyes and noses above them
  const capArea = area ? [area.left, area.top, area.width, area.bottom - area.top] : null;
  const layoutTool = tool("LAYOUT_TOOL", "layout", "place.mjs");
  // layout's place for a beat's held faces (the source's px): its best 4:5 or 1:1 crop that holds
  // them all, with the captions below it, or null (layout not beside, or no such crop)
  const cropFor = (b, size) => (held) => {
    if (!layoutTool) return null;
    const folder = path.join(work, "placement", b.id);
    fs.mkdirSync(folder, { recursive: true });
    const inside = (x) => { const x0 = Math.max(0, x[0]), y0 = Math.max(0, x[1]); return [x0, y0, Math.min(size[0], x[0] + x[2]) - x0, Math.min(size[1], x[1] + x[3]) - y0].map(Math.round); };
    // (a dozen moments a face: its hull is what the placement holds)
    const tracks = held.map((p) => p.boxes.map((x, j) => ({ t: p.ts[j], box: inside(x) })).filter((m, j, all) => m.box[2] > 0 && m.box[3] > 0 && (j % Math.ceil(all.length / 12) === 0 || j === all.length - 1)));
    const file = path.join(folder, "faces.json");
    fs.writeFileSync(file, JSON.stringify(tracks));
    const r = spawnSync(process.execPath, [layoutTool, "place", folder, "--frame", SIZE.join("x"), "--source", size.join("x"), "--face-track", file,
      ...(area ? ["--text", area.lines > 1 ? "caption:2" : "caption"] : []), ...(platforms.length ? ["--platform", platforms.join(",")] : [])], { encoding: "utf8", maxBuffer: 64 << 20 });
    let got = null;
    try { got = r.status === 0 ? JSON.parse(fs.readFileSync(path.join(folder, "placement.json"), "utf8")) : null; } catch { /* no crop then */ }
    return got?.candidates?.find((c) => c.fit === "crop" && ["4:5", "1:1"].includes(c.crop) && !c.speaker && !c.leftOut && !c.onGround && !c.hard && !(c.unmet || []).length) || null;
  };

  // ---- the clips, one ffmpeg each
  const clipsDir = path.join(comp, "assets", "clips");
  fs.mkdirSync(clipsDir, { recursive: true });
  for (const f of fs.readdirSync(clipsDir)) if (!ids.has(f.replace(/(-pop)?(\.part)?\.(mp4|json)$/, ""))) fs.rmSync(path.join(clipsDir, f), { force: true });   // of beats that are gone
  const report = [];
  let failed = 0, cutAnew = 0;
  const popped = {};   // beat id → the clip with the freeze, when it was made
  let seen = [];       // the faces in the frame, beat by beat, on the film's clock
  let unknown = [];    // the beats whose large main face may look into the camera: faces of before say nothing of it
  const cropOf = (bb) => (bb ? bb.match(/crop=(\d+):(\d+):(\d+):(\d+)/).slice(1).map(Number) : null);
  // a beat that leaves "frame" (and its "zoom" and "pan") out: where its faces are known and its
  // source is wider than the frame, the largest picture that holds them whole (planWindow's silent);
  // before 2026-11-20 it was the band, and still is without layout or where layout's measure fails
  const silentOf = (b) => b.frame == null && b.zoom == null && b.pan == null;
  const wide = (size) => size[0] * SIZE[1] > size[1] * SIZE[0] * 1.01;
  // ---- each beat's picture, before a clip is cut (the captions and the hook are placed on it first)
  const planOf = (b, i, asBefore = false) => {
    const src = sources[i], speed = b.speed ?? 1;
    let frame = b.frame || "whole";
    const seconds = r2(b.to - b.from), taken = Math.round(seconds * speed * 1000) / 1000;
    let zoom = b.zoom ?? (i === 0 && frame === "whole" ? HOOK_ZOOM : 1), pan = b.pan ?? 0.5;
    // Where faces are known: a window that would cut them goes to them (planWindow); the faces in
    // px of the source with the black bars cut away, as the clip's filter sees it
    let bar = null, x = null, box = null, plan = null, inBars = null, size = null, people = null, talk = null, looks = "", silent = false, unknownOf = null, moments = null;
    const list = faceLists[i];
    if (list) {
      bar = bars(src.file, b.at, taken, src.size);
      const c = cropOf(bar) || [list.source[0], list.source[1], 0, 0];
      size = [c[0], c[1]];
      const shift = (v) => [v[0] - c[2], v[1] - c[3], v[2], v[3]];
      inBars = { ...list, faces: list.faces.map((f) => ({ t: f.t, boxes: f.boxes.map((v) => ({ ...v, box: shift(v.box), ...(v.feat ? { feat: shift(v.feat) } : {}) })) })) };
      people = counted(inBars, size, taken);
      silent = !asBefore && !!layoutTool && silentOf(b) && wide(size);
      const planned = (ps) => planWindow({ frame, zoom, pan, zoomSet: b.zoom != null, panSet: b.pan != null, size, people: ps, captions: capArea, crop: cropFor(b, size), silent, at: b.at });
      plan = planned(people);
      // A main face that looks into the camera most of the beat and is large in the picture it
      // gets: its mouth weighs as its eyes, and the picture is placed again with that (looking)
      const look = looking(people, taken, list.step || 0.1);
      const tall = look && Math.round(shownShare({ frame: plan.frame, zoom: plan.zoom, pan: plan.pan, x: plan.x, box: plan.box, size }, people.main) * 100);
      if (look && !look.unknown && tall >= TALK_FACE * 100) {
        talk = look.who;
        plan = planned(talksIn(people));
        looks = `${look.who} looks into the camera (${Math.round(look.share * 100)} % of the beat, the face ${tall} % of the frame's height): the captions and the hook keep off the mouth as off the eyes`;
      } else if (look?.unknown && tall >= TALK_FACE * 100) unknownOf = { id: b.id, who: look.who };
      ({ frame, zoom, pan, x, box } = plan);
    }
    // a fill the agent panned: its pan stands, with faces known or not (a fill without faces and
    // without a pan is cut from the middle, as it always was)
    if (frame === "fill" && x == null && b.pan != null) {
      if (bar == null) bar = bars(src.file, b.at, taken, src.size);
      const c = cropOf(bar) || [src.size.width, src.size.height];
      x = Math.round(pan * (2 * Math.round((c[0] * (SIZE[1] / c[1])) / 2) - SIZE[0]));
      size ||= [c[0], c[1]];
    }
    if (list) {
      const band = frame === "whole" || frame === "crop" ? bandOf({ frame, zoom, box, size }) : null;
      moments = framed({ list: inBars, place: { frame, zoom, pan, x, box, size }, from: b.from, seconds, speed, move: i % 2 ? [1.04, 1] : [1, 1.04], band, talks: talk });
    }
    return { src, speed, seconds, taken, frame, zoom, pan, x, box, bar, plan, list, people, talk, looks, silent, unknownOf, moments };
  };
  let plans = beats.map((b, i) => planOf(b, i));
  const seenOf = () => {
    seen = plans.flatMap((p, i) => (p.list ? [{ i, id: beats[i].id, talk: p.talk, moments: p.moments }] : []));
    unknown = plans.map((p) => p.unknownOf).filter(Boolean);
  };
  seenOf();
  if (!layoutTool) {
    const ids = beats.filter((b, i) => faceLists[i] && silentOf(b) && plans[i].people?.held.length && wide([plans[i].src.size.width, plans[i].src.size.height])).map((b) => b.id);
    if (ids.length) warn.push(`the beat${ids.length > 1 ? "s" : ""} ${ids.join(", ")} without "frame" stay${ids.length > 1 ? "" : "s"} the band, as before: a larger picture of their faces needs agentitos' layout beside this skill to keep the captions off them`);
  }
  let measureBroke = false;

  // ---- the captions and the hook off the faces. The captions move only where they lie on eyes or
  // a nose (nobody shown is heard: a mouth, a mask or a chin may be covered), or on the mouth of one
  // who looks into the camera (a moving mouth under them reads as a mistake): agentitos' layout gives
  // one place for the captions of the whole short, at their size. The hook may lie on hair or a
  // forehead, never on the eyes: smaller first, then layout's place (never stacked on the captions),
  // else it stays and a `!` says so. Each is taken only where it lies on the faces less than the
  // place it had (a doubt never makes it worse).
  const room = top[2], hookPx = hookSize(hook.text.trim(), room);
  let hookAt = null, hookUntil = HOOK_SECONDS;   // the hook's place where it moved, or its size where it got smaller
  const moments = seen.flatMap((s) => s.moments);
  if (moments.length) {
    const capBox = area ? [area.left, area.top, area.width, area.bottom - area.top] : null;
    const hookAs = (px) => [top[0], top[1] + 66, top[2], Math.round(hookLines(hook.text.trim(), px, room) * px * 1.02)];
    const hookBox = hookAs(hookPx);
    // the smaller sizes the hook takes in its place: on two lines (three under 80 px), down to 60
    const sizes = [104, 96, 88, 80, 76, 68, 60].filter((v) => v < hookPx && hookLines(hook.text.trim(), v, room) <= (v >= 80 ? 2 : 3));
    // What a text lies on is agentitos' layout's measure (place.mjs text --measure), every beat one
    // shot with its faces as tracks in px of the frame, never raised; who talks into the camera in
    // a beat (its mouth weighs as the eyes) is this skill's (onOf)
    const folder = path.join(work, "placement"), shotsFile = path.join(folder, "shots.json"), boxesFile = path.join(folder, "measure-boxes.json");
    const talks = Object.fromEntries(seen.filter((s) => s.talk != null).map((s) => [s.i, s.talk]));
    const measured = new Map();
    let measureFailed = null;
    // boxes: [{ name, box, start?, end? }] → true where layout measured them all (measured.get(name))
    const measure = (boxes) => {
      fs.writeFileSync(boxesFile, JSON.stringify(boxes));
      const mr = spawnSync(process.execPath, [layoutTool, "text", folder, "--frame", SIZE.join("x"), "--shots", shotsFile, "--measure", boxesFile], { encoding: "utf8", maxBuffer: 64 << 20, timeout: MEASURE_LIMIT * 1000 });
      let got = null;
      try { got = mr.status === 0 ? JSON.parse(fs.readFileSync(path.join(folder, "measure.json"), "utf8")) : null; } catch { /* said below */ }
      if (!Array.isArray(got?.boxes) || boxes.some((b) => !got.boxes.some((x) => x.name === b.name && Array.isArray(x.moments)))) { measureFailed = measureFault(layoutTool, mr, MEASURE_LIMIT); return false; }
      for (const x of got.boxes) measured.set(x.name, x);
      return true;
    };
    // (the hook is a heavy outlined text, read on a busy picture too: calm, a text before a card)
    const shots = beats.map((b, i) => {
      const tracks = new Map();
      for (const m of seen.find((s) => s.i === i)?.moments || []) for (const f of m.boxes) {
        if (!tracks.has(f.who)) tracks.set(f.who, { who: f.who, track: [] });
        tracks.get(f.who).track.push({ t: m.t, box: f.box, ...(f.feat ? { feat: f.feat } : {}) });
      }
      return { start: b.from, end: b.to, weight: r2(b.to - b.from), faces: [...tracks.values()], room: null };
    });
    let ok = false;
    if (layoutTool) {
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(shotsFile, JSON.stringify({ shots, hook: { start: 0, end: HOOK_SECONDS, calm: true } }));
      ok = measure([...(capBox ? [{ name: "captions", box: capBox }] : []), { name: "hook", box: hookBox, start: 0, end: HOOK_SECONDS },
        ...sizes.map((v) => ({ name: `hook-${v}`, box: hookAs(v), start: 0, end: HOOK_SECONDS }))]);
      measureBroke = !ok;
    }
    // a text's seconds on the faces: of the beats `ids` (seen's i) or of all
    const on = (name, ids = null) => onOf(measured.get(name), { shots: ids, talks });
    let blind = [];   // the beats whose large main face may look into the camera, the captions on its mouth
    if (!layoutTool) warn.push(measureSaid(measureFault(null)));
    else if (!ok) warn.push(measureSaid(measureFailed));
    else {
      const capOn = capBox ? on("captions") : null, hookOn = on("hook");
      // a hook reaches the eyes (or lower) where it lies on the eyes, the nose or the mouth
      const reaches = (o) => o.nose > 0 || o.mouth > 0 || o.talk > 0;
      const parts = (o) => [o.nose ? `the eyes or nose ${o.nose} s${o.unknown ? `, of it ${o.unknown} s on a head known by its box alone, whose eyes are not known and taken to begin 15 % down it` : ""}` : "", o.talk ? `the mouth of one who looks into the camera ${o.talk} s` : "", o.mouth ? `the mouth ${o.mouth} s` : "", o.lip ? `the lower lip ${o.lip} s` : "", o.hair ? `the hair or forehead ${o.hair} s${o.maybe ? ` (${o.maybe} s of it where the eyes may begin: not known)` : ""}` : "", o.chin ? `the chin ${o.chin} s` : ""].filter(Boolean).join(", ");
      const whose = (name, part = "seconds") => seen.filter((s) => on(name, [s.i])[part]).map((s) => s.id).join(", ");
      const meets = (x, z) => Math.min(x[0] + x[2], z[0] + z[2]) > Math.max(x[0], z[0]) && Math.min(x[1] + x[3], z[1] + z[3]) > Math.max(x[1], z[1]);
      // two blocks of text one directly above the other read as one: a hook closer to the captions than its own height (200 px at least)
      const stacked = (h, c) => !!c && Math.min(h[0] + h[2], c[0] + c[2]) > Math.max(h[0], c[0]) && Math.max(c[1] - (h[1] + h[3]), h[1] - (c[1] + c[3])) < Math.max(h[3], 200);
      const mild = [capOn?.seconds && !capOn.hard ? `the captions lie on ${parts(capOn)} in ${whose("captions")}, no eyes or nose: nobody shown speaks, they may` : "",
        hookOn.seconds && !reaches(hookOn) ? `the hook lies on ${parts(hookOn)} in ${whose("hook")}, not the eyes: it may` : ""].filter(Boolean);
      // captions on the mouth of a large face whose faces say nothing of where it looks: said, not taken as fine
      blind = capBox ? unknown.filter((u) => { const o = on("captions", [seen.find((x) => x.id === u.id).i]); return o.mouth || o.lip; }) : [];
      if (!capOn?.hard && !reaches(hookOn)) report.push(`  the captions${capBox ? "" : " (not checked: the captions skill here writes no area.json)"} and the hook lie on no ${mild.length ? "eyes or nose" : "face"}: they stand where they stood${mild.length ? `; ${mild.join("; ")}` : ""}`);
      else {
        for (const m of mild) report.push(`  ${m}`);
        let look = null;
        try { look = JSON.parse(fs.readFileSync(path.join(comp, "captions", "index.html"), "utf8").match(/var DATA = (\{[\s\S]*?\});\n/)[1]).look; } catch { /* the layout's own band */ }
        const ink = inkOf(look);
        const capText = capBox ? ["--text", area.lines > 1 ? "caption:2" : "caption"] : [];
        const askLayout = (args) => {
          const lr = spawnSync(process.execPath, [layoutTool, "text", folder, "--frame", SIZE.join("x"), "--shots", shotsFile, ...args,
            ...(platforms.length ? ["--platform", platforms.join(",")] : []), ...(ink ? ["--set", `caption.line=${ink.line}`, "--set", `caption.padEm=${ink.box ? 0.44 : ink.below}`] : [])], { encoding: "utf8", maxBuffer: 64 << 20 });
          let placed = null;
          try { placed = lr.status === 0 ? JSON.parse(fs.readFileSync(path.join(folder, "text.json"), "utf8")) : null; } catch { /* said by the caller */ }
          return { placed, lr };
        };
        // where the captions stand once they are placed, as layout's --caption-y and --font-size take them
        let capNow = capBox, capFixed = capBox ? ["--caption-y", String(area.bottom), "--font-size", String(area.size)] : [];
        if (capOn?.hard) {
          const said = `the captions lie on a face in ${whose("captions", "hard")} (${parts(capOn)})`;
          // The captions stand in one place for the whole short, at the size captions gave them: one
          // beat never makes them smaller for all the others. Smaller type has a price, as much as the
          // longest beat spent wholly on the eyes or nose and more the smaller it gets, which only
          // faces in several beats can pay; layout is asked at their own size first.
          const longest = Math.max(...beats.map((b) => b.to - b.from));
          const price = (font) => (font < area.size ? WEIGHT.nose * (longest + total * (1 - font / area.size)) : 0);
          const asked = [askLayout([...capText, "--font-size", String(area.size)])];
          if (seen.filter((s) => on("captions", [s.i]).hard).length > 1) asked.push(askLayout(capText));
          // layout's places, measured where they stand (one call for both)
          const places = asked.map(({ placed }, k) => (placed?.caption ? { c: placed.caption, name: `caption-${k}` } : null)).filter(Boolean);
          const gauged = places.length ? measure(places.map((x) => ({ name: x.name, box: x.c.box }))) : false;
          let best = null;
          if (gauged) for (const { c, name } of places) {
            const o = on(name), cost = r2(o.cost + price(c.font));
            if (!best || cost < best.cost) best = { c, on: o, cost };
          }
          if (!best) warn.push(`${said}; agentitos' layout did not ${places.length ? `measure its place for them (${measureFailed.replace("agentitos' layout ", "it ")})` : `place them (${reason(asked[0].lr)})`}: they stand where they stood`);
          else if (best.cost < capOn.cost) {
            const { c, on: o0 } = best, o = { ...c.options };
            if (ink) { o.y = Math.round(o.y - ink.below * o["font-size"]); o["max-width"] = Math.floor(o["max-width"] - 2 * Math.ceil(ink.side * o["font-size"] + 1)); }
            const cr = spawnSync(process.execPath, [...capArgs, ...Object.entries(o).flatMap(([k, v]) => [`--${k}`, String(v)])], { encoding: "utf8" });
            if (cr.status !== 0) fail(`The captions could not be built: ${reason(cr)}`);
            if (!/Placed where asked/.test(cr.stdout || "")) warn.push(`${said}: the captions skill here does not take a place, so they stand on the safe box's bottom`);
            else {
              capNow = c.box;
              capFixed = ["--caption-y", String(c.options.y), "--font-size", String(c.font)];
              report.push(`  the captions: they lay on a face in ${whose("captions", "hard")} (${parts(capOn)}) where they stood; one place for the whole short by agentitos' layout instead: ${c.lines > 1 ? "up to two lines" : "one line"} of ${o["font-size"]} px${c.font < area.size ? ` (${area.size} px before: the faces of several beats pay for smaller type)` : ", their size"}, the lowest line at y ${o.y} (${c.where === "above-head" ? "above the heads" : c.where === "no-face" ? "where no face is" : "below the chins"})${o0.seconds ? `, on a face still: ${parts(o0)}` : ", on no face"}`);
            }
          } else report.push(`  ! ${said}: agentitos' layout found no place at their size that lies on them less; they stand where they stood`);
        }
        // the hook: where it reaches the eyes, or the captions moved to its place
        const clash = capNow && capNow !== capBox && meets(capNow, hookBox);
        if (reaches(hookOn) || clash) {
          const why = reaches(hookOn) ? `it reached ${hookOn.nose || hookOn.mouth ? "the eyes" : "the mouth of one who looks into the camera"} in ${whose("hook", hookOn.nose ? "nose" : hookOn.mouth ? "mouth" : "talk")} (${parts(hookOn)})` : "the captions moved to its place";
          const free = (name, box) => { const o = on(name); return !reaches(o) && !(capNow && (meets(box, capNow) || stacked(box, capNow))) ? o : null; };
          // smaller first, in its place
          const px = sizes.find((v) => free(`hook-${v}`, hookAs(v)));
          if (px) {
            const o = free(`hook-${px}`, hookAs(px));
            hookAt = { box: hookAs(px), font: px, top: true };
            report.push(`  the hook: ${why} at ${hookPx} px; ${px} px instead, at the top${o.seconds ? `, on ${parts(o)}` : ", on no face"}`);
          } else {
            const { placed, lr } = askLayout([...capText, "--text", "hook", ...capFixed]);
            const h = placed?.hook, until = Math.max(1.2, Math.min(HOOK_SECONDS, h?.until ?? HOOK_SECONDS));
            const gauged = h ? measure([{ name: "hook-layout", box: h.box, start: 0, end: until }]) : false, o = gauged ? free("hook-layout", h.box) : null;
            if (h && o) {
              hookAt = { box: h.box.map((v) => Math.round(v)), font: Math.min(h.font, hookPx) };
              hookUntil = r2(until);
              report.push(`  the hook: ${why}, at every size; ${({ "below-chin": "below the chin", "above-head": "above the head", top: "at the top", middle: "in the middle", free: "in the middle" })[h.where] || h.where} instead, ${hookAt.font} px${hookUntil < HOOK_SECONDS ? `, until ${hookUntil} s (the beat after it leaves it no place)` : ""}${o.seconds ? `, on ${parts(o)}` : ", on no face"}`);
            } else report.push(`  ! the hook: ${why}, at every size${h && gauged ? `, and agentitos' layout's place for it ${capNow && (meets(h.box, capNow) || stacked(h.box, capNow)) ? "lies on the captions or directly above them" : "reaches the eyes too"}` : h ? `; agentitos' layout did not measure its place for it (${measureFailed.replace("agentitos' layout ", "it ")})` : `; agentitos' layout did not place it (${reason(lr)})`}: it stands where it stood: a shorter hook, or another first beat`);
          }
        }
      }
    }
    if (blind.length) report.push(`  the captions lie on the mouth of ${blind.map((u) => `${u.who} in ${u.id}`).join(", ")}: whether ${blind.length > 1 ? "they look" : "it looks"} into the camera is not known (faces found before they said so; node ${self()} faces ${rel(work)} --again asks anew, and the mouth of one who does is kept clear like the eyes)`);
  }

  // a beat whose "frame" was left out and whose faces layout's measure could not place: as before
  if (measureBroke && plans.some((p) => p.silent)) {
    const ids = beats.filter((b, i) => plans[i].silent).map((b) => b.id);
    plans = plans.map((p, i) => (p.silent ? planOf(beats[i], i, true) : p));
    warn.push(`the beat${ids.length > 1 ? "s" : ""} ${ids.join(", ")} without "frame" stay${ids.length > 1 ? "" : "s"} the band, as before: a larger picture of their faces needs agentitos' layout's measure, and it failed`);
  }
  const placed = report.splice(0);   // the captions' and the hook's lines, said after the beats'

  // ---- the clips, one ffmpeg each
  beats.forEach((b, i) => {
    const { src, speed, seconds, taken, frame, zoom, pan, x, box, plan, list, people, looks } = plans[i];
    let bar = plans[i].bar;
    const out = path.join(clipsDir, `${b.id}.mp4`), note = path.join(clipsDir, `${b.id}.json`);
    const how = JSON.stringify({ v: VERSION, file: src.file, stamp: src.stamp, at: b.at, taken, seconds, frame, zoom, pan, speed, ...(x != null ? { x } : {}), ...(box ? { box } : {}) });
    let kept = null;
    try { kept = JSON.parse(fs.readFileSync(note, "utf8")); } catch { /* not cut yet */ }
    let m = kept && kept.how === how && kept.measured && fs.existsSync(out) && fs.statSync(out).size ? kept.measured : null;
    if (!m) {
      fs.rmSync(note, { force: true });   // a cut that fails leaves no note of a clip that is not there
      if (bar == null) bar = bars(src.file, b.at, taken, src.size);
      const vf = bar + (frame === "whole" ? whole(zoom, pan) : frame === "crop" ? cropped(box) : frame === "fill" && x != null ? `scale=-2:${SIZE[1]}:flags=lanczos,crop=${SIZE[0]}:${SIZE[1]}:${x}:0` : FRAMES[frame])
        + (speed !== 1 ? `,setpts=PTS/${speed}` : "") + `,fps=${FPS},format=yuv420p`;
      const part = path.join(clipsDir, `${b.id}.part.mp4`);
      // a keyframe a second: HyperFrames seeks cleanly (sparse ones froze frames)
      const r = ff(["-v", "error", "-y", "-ss", String(b.at), "-t", String(taken), "-i", src.file, "-an", "-vf", vf, "-t", String(seconds),
        "-c:v", "libx264", "-crf", "17", "-preset", "medium", "-g", String(FPS), "-keyint_min", String(FPS), part]);
      if (r.status !== 0 || !fs.existsSync(part) || !fs.statSync(part).size) {
        fs.rmSync(part, { force: true });
        fail(`Beat ${b.id}: the clip could not be cut from ${rel(src.file)} at ${b.at} s${b.at >= src.size.duration ? `: the source is ${src.size.duration.toFixed(1)} s long` : ` (${reason({ ...r, stdout: "" })})`}.`);
      }
      fs.renameSync(part, out);
      m = { ...measure(out), bars: bar ? bar.slice(0, -1) : null };
      fs.writeFileSync(note, JSON.stringify({ how, measured: m }));
      cutAnew++;
    }
    if (m.bars) report.push(`  ${b.id}: black bars in the source cut away (${m.bars})`);
    if (i === 0 && frame === "whole" && b.zoom == null && !plan?.changed) report.push(`  ${b.id}: the first beat's band is ${HOOK_ZOOM} times larger, its middle kept ("zoom": 1 shows the whole width, "pan" another part)`);
    const own = plan?.cut.length && (b.pan != null || b.zoom != null);
    if (plan?.said) report.push(`  ${own || plan.flag ? "! " : ""}${b.id}: ${plan.said}${own ? "; leave \"pan\" (and \"zoom\") out and the picture goes to the faces" : ""}${looks ? `; ${looks}` : ""}`);
    else if (list && !people.held.length) report.push(`  ${b.id}: ${people.small.length ? `its faces (${people.small.map((p) => p.who).join(", ")}) are too small or seen too briefly to move the picture for` : "no face found"}: the picture stays as it is`);
    else if (looks) report.push(`  ${b.id}: ${looks}`);
    // a band nobody chose and nothing placed: what it costs, and what to do
    if (!list && silentOf(b) && !opts["no-faces"]) {
      const c = cropOf(m.bars) || [src.size.width, src.size.height], [t, u] = bandOf({ frame: "whole", zoom, size: c });
      const ground = Math.round((1 - (u - t) / SIZE[1]) * 100);
      if (ground > 0) report.push(`  ! ${b.id}: no "frame" and no faces known: the whole picture as a band, ${ground} % of the frame blurred ground; to show its subject larger: ${b.people ? `node ${self()} faces ${rel(work)} (its faces place it)` : `"people": true where it shows a face (faces places it)`}, or "frame": "fill" with a "pan" on the subject (0 the left, 1 the right); "frame": "whole" keeps the band`);
    }
    // the gate: what needs no judgement
    const problems = [];
    if (m.peak < DARK_MAX[frame]) problems.push("DARK: the clip is near black; another stretch");
    else if (i === 0 && m.first < Math.max(DARK_MAX[frame], OPEN_PART * m.median)) problems.push("DARK-OPEN: the hook starts on a dark frame, a fade-in of the source; start it later");
    if (m.dur < seconds - SHORT_TOL) problems.push(`SHORT: ${m.dur.toFixed(2)} s of ${seconds.toFixed(2)} s; the stretch runs past the end of the source`);
    for (const p of problems) report.push(`  ✗ ${b.id}: ${p}`);
    if (problems.length) failed++;
    if (m.dur && m.frozen / m.dur > FROZEN_PART) report.push(`  ! ${b.id}: ${m.frozen.toFixed(1)} s of ${m.dur.toFixed(1)} s stand still; meant?`);
    if (src.cuts) {
      const inside = src.cuts.filter((t) => t > b.at + 0.05 && t < b.at + taken - 0.05);
      if (inside.length) report.push(`  ? ${b.id}: the source has a cut of its own at ${inside.map((t) => Number(t).toFixed(2)).join(", ")} s inside ${b.at}-${r2(b.at + taken)} s: look at the stretch (footage's strip); a real cut: move it or slow it`);
    } else report.push(`  ? ${b.id}: the cuts of its source are not known (footage's look writes them): look at the stretch for a cut inside it`);

    // the first beat's freeze, when it asks for one: agentitos' freeze-cutout, run as a program
    if (i === 0 && b.freeze != null && !problems.length) {
      const cut = tool("FREEZE_CUTOUT", "freeze-cutout", "cutout.mjs");
      const pop = path.join(clipsDir, `${b.id}-pop.mp4`), popNote = path.join(clipsDir, `${b.id}-pop.json`);
      const popHow = JSON.stringify({ how, freeze: b.freeze, subject: cfg.subject || null, pop: b.pop || "strong" });
      if (!cut) report.push(`  ! ${b.id}: the freeze needs agentitos' freeze-cutout skill beside this one (or FREEZE_CUTOUT naming its tools/cutout.mjs); the plain clip is used`);
      else if (fs.existsSync(pop) && fs.statSync(pop).size && fs.existsSync(popNote) && fs.readFileSync(popNote, "utf8") === popHow) popped[b.id] = true;
      else {
        fs.rmSync(pop, { force: true }); fs.rmSync(popNote, { force: true });
        const cr = spawnSync(process.execPath, [cut, out, pop, "--at", String(b.freeze), "--work", path.join(work, "cutout"), ...(frame === "whole" || frame === "crop" ? ["--region", "band"] : []),
          ...(text(cfg.subject) ? ["--subject", cfg.subject.trim()] : []), ...(b.pop ? ["--style", b.pop] : [])], { encoding: "utf8", maxBuffer: 64 << 20, timeout: 900e3 });
        if (cr.status === 0 && fs.existsSync(pop) && fs.statSync(pop).size) { fs.writeFileSync(popNote, popHow); popped[b.id] = true; }
        else { fs.rmSync(pop, { force: true }); report.push(`  ! ${b.id}: no freeze (${reason(cr)}); the plain clip is used`); }
      }
      if (popped[b.id]) report.push(`  ${b.id}: freezes at ${b.freeze} s; look at ${rel(path.join(work, "cutout", "cutout-check.jpg"))}: the outline around the subject only, nothing cut off`);
    }
  });

  report.push(...placed);

  // ---- the composition
  const accent = brandAccent() || "#ffd166";
  let keyDone = false;   // the key once, where it stands first
  const hookHtml = hookWords.map((w) => (!keyDone && bare(w) === bare(hook.key) ? ((keyDone = true), `<span class="em">${esc(w)}</span>`) : esc(w))).join(" ");
  let videos = "", tweens = "";
  beats.forEach((b, i) => {
    const d = r2(b.to - b.from);
    videos += `      <div class="fill" id="z-${b.id}">\n        <video id="v-${b.id}" src="assets/clips/${b.id}${popped[b.id] ? "-pop" : ""}.mp4" class="clip" data-start="${b.from}" data-duration="${d}" data-track-index="2" muted playsinline></video>\n      </div>\n`;
    const [from, to] = i % 2 ? [1.04, 1] : [1, 1.04];   // a slow move in every clip, in and out in turn
    tweens += `      tl.fromTo("#z-${b.id}", { scale: ${from} }, { scale: ${to}, duration: ${d}, ease: "none" }, ${b.from});\n`;
  });
  const hookStyle = hookAt && !hookAt.top ? `font-size: ${hookAt.font}px; left: ${hookAt.box[0]}px; width: ${hookAt.box[2]}px; top: ${hookAt.box[1]}px;` : `font-size: ${hookAt ? hookAt.font : hookPx}px;`;
  let overlays = `      <div id="hook" class="clip layer" data-start="0" data-duration="${hookUntil}" data-track-index="10">\n        <div id="hook-in" class="hook" style="${hookStyle}">${hookHtml}</div>\n      </div>\n`;
  tweens += `      tl.fromTo("#hook-in", { scale: 1.04 }, { scale: 1, duration: 0.5, ease: "power2.out" }, 0);\n      tl.to("#hook-in", { autoAlpha: 0, duration: 0.25 }, ${r2(hookUntil - 0.25)});\n`;
  if (card) {
    const vmax = Math.max(...card.rows.map((r) => Number(r[1])));
    const rows = card.rows.map((r, k) => {
      tweens += `      tl.fromTo("#cmp-r${k}", { autoAlpha: 0, x: -20 }, { autoAlpha: 1, x: 0, duration: 0.3 }, ${r2(card.at + 0.2 + 0.18 * k)});\n`
        + `      tl.fromTo("#cmp-b${k}", { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: "power2.out" }, ${r2(card.at + 0.25 + 0.18 * k)});\n`;
      return `          <div class="cmp-row${k ? "" : " me"}" id="cmp-r${k}"><div class="cmp-label"><span>${esc(r[0])}</span><span>${esc(r[2])}</span></div><div class="cmp-bar" id="cmp-b${k}" style="width: ${Math.max(4, (Number(r[1]) / vmax) * 100).toFixed(1)}%;"></div></div>\n`;
    }).join("");
    overlays += `      <div id="compare" class="clip layer" data-start="${card.at}" data-duration="${card.for}" data-track-index="11">\n        <div id="cmp-in" class="compare">\n          <div class="cmp-title">${esc(text(card.title) ? card.title : "SIZE CHECK")}</div>\n${rows}        </div>\n      </div>\n`;
    tweens += `      tl.fromTo("#cmp-in", { autoAlpha: 0, y: -24 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: "power2.out" }, ${card.at});\n      tl.to("#cmp-in", { autoAlpha: 0, duration: 0.25 }, ${r2(card.at + card.for - 0.25)});\n`;
  }
  overlays += `      <div id="handle" class="clip layer" data-start="${endAt}" data-duration="${r2(total - endAt)}" data-track-index="12"><div id="handle-in" class="pill handle">${esc(cfg.handle.trim())}</div></div>\n`
    + `      <div id="credit" class="clip pill credit" data-start="0" data-duration="${total}" data-track-index="6">${esc(/^\p{Extended_Pictographic}/u.test(cfg.credit.trim()) ? cfg.credit.trim() : `🎬 ${cfg.credit.trim()}`)}</div>\n`;
  tweens += `      tl.fromTo("#handle-in", { autoAlpha: 0, scale: 0.8 }, { autoAlpha: 1, scale: 1, duration: 0.35, ease: "back.out(2.2)" }, ${endAt});\n`;

  // the voice: each line from just before its first word (data-media-start), never into the next
  let audio = "";
  for (const l of ck.lines) {
    audio += `      <audio id="vo-${esc(l.id)}" src="${esc(l.file)}" data-start="${l.at}"${l.from ? ` data-media-start="${l.from}"` : ""} data-duration="${l.duration}" data-track-index="8" data-volume="1"></audio>\n`;
  }
  const music = path.join(comp, "assets", "music.mp3"), hasMusic = fs.existsSync(music);
  let musicSaid = "";
  if (hasMusic) {
    // --under LU under the voice, both measured as the film plays them (the voice's lines at volume 1)
    const v = loudness(ck.lines.map((l) => path.join(comp, l.file))), m = loudness([music]);
    let volume = 0.14;
    if (v == null || m == null) warn.push(`the ${v == null ? "voice" : "music"} is silent: the music is at 0.14, as if both were equally loud`);
    else {
      const fit = musicVolume(v, m, musicUnder);
      volume = fit.volume;
      musicSaid = ` ${fit.under.toFixed(1)} LU under the voice (at ${volume}; the voice at ${lufs(v)} LUFS, the music at ${lufs(m)})`;
      if (fit.bound) warn.push(`the music would need ${fit.need.toFixed(3)} to lie ${musicUnder} LU under the voice; at ${volume}, the ${fit.bound} volume here, it lies ${fit.under.toFixed(1)} LU under it; for ${musicUnder} LU, ${fit.bound === "highest" ? "louder" : "quieter"} music of its own (launch-video's \`music\` again)`);
    }
    // under the voice all the way, down to nothing from the last word to the end. HyperFrames
    // multiplies the track's volume by its lane: the volume carries the level, the lane's values
    // are shares of it (1 while it holds, 0 at the end), never the volume a second time
    const hold = r2(Math.min(voiceEnd + 0.1, total - 0.3));
    const lanes = JSON.stringify({ version: 1, lanes: [{ target: "volume", points: [{ t: 0, v: 1 }, { t: hold, v: 1 }, { t: total, v: 0 }] }] }).replace(/"/g, "&quot;");
    audio += `      <audio id="music" src="assets/music.mp3" data-start="0" data-duration="${Math.min(total, down2(audioSeconds(music) || total))}" data-track-index="7" data-volume="${volume}" data-under-voice="${musicUnder}" data-automation="${lanes}"></audio>\n`;
  }

  const x = top[0], y = top[1], w = top[2];
  const html = `<!doctype html>
<!-- Built by agentitos' narrated-short from ${esc(rel(beatsFile))}: change the beats and build again, never this file. -->
<html lang="${esc(text(cfg.lang) ? cfg.lang.trim() : "en")}">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=${SIZE[0]}, height=${SIZE[1]}">
    <title>${esc(text(cfg.title) ? cfg.title : path.basename(path.dirname(comp)))}</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lato:wght@700;900&display=swap">
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${SIZE[0]}px; height: ${SIZE[1]}px; overflow: hidden; background: #0a0e14; color: #f2f5f9; font-family: "Lato", system-ui, sans-serif; }
      #root { position: relative; width: ${SIZE[0]}px; height: ${SIZE[1]}px; overflow: hidden; }
      .fill, .layer { position: absolute; inset: 0; overflow: hidden; }
      .fill video { width: 100%; height: 100%; object-fit: cover; }
      /* the text of this film stands in the stretch platform-zones leaves free above the apps' buttons */
      .pill { position: absolute; left: 0; right: 0; margin: 0 auto; width: fit-content; max-width: ${w}px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-radius: 999px; }
      .credit { top: ${y}px; font-size: 28px; font-weight: 700; background: rgba(10,14,20,.72); padding: 10px 24px; }
      .handle { top: ${y + 66}px; font-size: 40px; font-weight: 900; letter-spacing: 2px; color: #0a0e14; background: ${accent}; padding: 14px 36px; }
      .hook {
        position: absolute; left: ${x}px; width: ${w}px; top: ${y + 66}px; text-align: center; text-wrap: balance;
        font-weight: 900; line-height: 1.02; color: #fff; transform-origin: 50% 0;
        -webkit-text-stroke: 4px rgba(6,8,12,.92); paint-order: stroke fill; text-shadow: 0 6px 26px rgba(0,0,0,.85);
      }
      .hook .em { color: ${accent}; }
      .compare {
        position: absolute; left: ${x + 30}px; width: ${w - 60}px; top: ${y + 66}px; padding: 22px 38px 30px;
        background: rgba(10,14,20,.9); border: 3px solid ${accent}; border-radius: 28px; box-shadow: 0 18px 50px rgba(0,0,0,.55);
      }
      .cmp-title { font-size: 38px; font-weight: 900; letter-spacing: 6px; color: ${accent}; }
      .cmp-row { margin-top: 18px; }
      .cmp-label { display: flex; justify-content: space-between; gap: 24px; font-size: 44px; font-weight: 900; color: rgba(242,245,249,.92); white-space: nowrap; }
      .cmp-bar { height: 30px; margin-top: 10px; border-radius: 15px; background: rgba(242,245,249,.78); transform-origin: left center; }
      .cmp-row.me .cmp-label { color: ${accent}; }
      .cmp-row.me .cmp-bar { background: ${accent}; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${SIZE[0]}" data-height="${SIZE[1]}">
${videos}${overlays}${mount ? `      ${mount}\n` : ""}${audio}    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
${tweens}      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
  fs.mkdirSync(comp, { recursive: true });
  fs.writeFileSync(path.join(comp, "index.html"), html);

  console.log(`${rel(path.join(comp, "index.html"))}: ${total} s, ${beats.length} beats (${cutAnew} cut anew), the voice in ${ck.lines.length} lines${hasMusic ? `, music${musicSaid}` : ", no music yet (assets/music.mp3)"}${mount ? `, captions (${shown.length} of ${words.length} words${card ? ", paused under the card" : ""}${boxes.n ? `, ${boxes.n} as cards` : ""})` : ", no captions"}; text placed for ${zones.platforms?.map((p) => p.name).join(", ") || "the usual apps"}.`);
  for (const l of report) console.log(l);
  for (const wn of warn) console.log(`  ! ${wn}`);
  if (failed) fail(`${failed} clip(s) cannot go out as they are (✗): change their beats and build again.`);
  console.log(`Next: node ${self()} sheet ${rel(work)} ${rel(comp)} and look at it; the person sees the preview beside the chat.`);
}

// ---------------------------------------------------------------- sheet
// the HyperFrames CLI of this machine, as rragent finds it: RRAGENT_HYPERFRAMES, HYPERFRAMES, else
// `hyperframes` on the PATH; a script among them is run by node
function hyperframes() {
  const found = [process.env.RRAGENT_HYPERFRAMES, process.env.HYPERFRAMES].find((p) => p && fs.existsSync(p)) || onPath("hyperframes");
  if (!found) fail("This needs the HyperFrames CLI (hyperframes) on the machine; it is not there.");
  return /\.(c|m)?js$/.test(found) ? [process.execPath, [found]] : [found, []];
}

function sheet(args) {
  const { pos } = parse(args);
  const [workArg, compArg] = pos;
  if (!workArg || !compArg) fail(`Name the work folder and the composition: sheet short/<name> artifacts/<name>/composition. ${USAGE}`);
  const work = path.resolve(workArg), comp = path.resolve(compArg);
  if (!fs.existsSync(path.join(comp, "index.html"))) fail(`There is no ${rel(path.join(comp, "index.html"))}: build first.`);
  const cfg = readJson(path.join(work, "beats.json"), "write the beats and build first.");
  const ck = readJson(path.join(work, "clock.json"), "set the clock and build first.");
  if (!Array.isArray(cfg.beats) || !cfg.beats.length || !Array.isArray(ck.words) || !isNum(ck.end)) fail("The beats or the clock are not what build read: build again.");
  const total = totalOf(cfg.beats, ck);
  const at = [0, 1.2, r2(HOOK_SECONDS + 0.3)];
  cfg.beats.forEach((b, i) => {
    const to = i === cfg.beats.length - 1 ? total : b.to;
    at.push(r2(b.from + 0.3), r2((b.from + to) / 2));
  });
  if (cfg.compare) at.push(r2(cfg.compare.at + Math.min(1.2, cfg.compare.for / 2)));
  if (cfg.beats[0].freeze != null) at.push(r2(cfg.beats[0].freeze + 0.35));   // the pop at its largest
  // every card of the captions, in the middle of its phrase (build's words.json carries them)
  try {
    const ws = JSON.parse(fs.readFileSync(path.join(work, "words.json"), "utf8")).words || [];
    ws.forEach((w, i) => {
      if (!w.box || w.box === ws[i - 1]?.box) return;
      let j = i;
      while (ws[j + 1]?.box === w.box) j++;
      at.push(r2((w.start + ws[j].end) / 2));
    });
  } catch { /* no captions built: no cards to look at */ }
  at.push(r2(total - 0.2));
  // moments less than a quarter second after the one kept before them show the same picture
  const times = [];
  for (const t of at.filter((v) => v >= 0 && v < total).sort((a, b) => a - b)) if (!times.length || t - times.at(-1) >= 0.25) times.push(t);
  const stills = path.join(work, "stills");
  fs.rmSync(stills, { recursive: true, force: true });
  const [cli, pre] = hyperframes();
  log(`short: ${times.length} stills of the composition …`);
  const r = spawnSync(cli, [...pre, "snapshot", comp, "--at", times.join(","), "--no-end", "-o", stills],
    { encoding: "utf8", maxBuffer: 64 << 20, timeout: 900e3, env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", HYPERFRAMES_SKIP_SKILLS: "1", PUPPETEER_SKIP_DOWNLOAD: "1" } });
  const files = fs.existsSync(stills) ? fs.readdirSync(stills).filter((f) => /\.png$/i.test(f)) : [];
  if (!files.length) fail(`HyperFrames made no stills: ${reason(r)}`);
  // in the order of their time, whatever the CLI names them
  const stamp = (f) => Number((f.match(/([0-9]+(?:\.[0-9]+)?)s?\.png$/i) || [])[1]);
  files.sort((a, b) => (Number.isFinite(stamp(a)) && Number.isFinite(stamp(b)) ? stamp(a) - stamp(b) : a.localeCompare(b, "en", { numeric: true })));
  const list = path.join(stills, "list.txt"), line = (f) => `file '${path.join(stills, f).replace(/'/g, "'\\''")}'\n`;
  // (the last file once more: an older ffmpeg drops the last picture of such a list)
  fs.writeFileSync(list, files.map((f) => `${line(f)}duration 1\n`).join("") + line(files.at(-1)));
  const cols = Math.min(files.length, 8), rows = Math.ceil(files.length / cols), out = path.join(work, "sheet.jpg");
  const t = ff(["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-vf", `fps=1,scale=270:-2,tile=${cols}x${rows}:padding=4:color=0x222222`, "-frames:v", "1", "-q:v", "4", out]);
  if (t.status !== 0 || !fs.existsSync(out)) fail(`The sheet could not be made: ${reason(t)}`);
  console.log(`${rel(out)}: ${files.length} stills, row by row, at ${times.map((v) => String(v)).join(", ")} s.`);
  console.log("Go through it by the quality round (references/quality.md). Clean: say that the preview is ready; the render comes after the person's yes.");
}

// ---------------------------------------------------------------- main
const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "clock") clock(rest);
  else if (command === "faces") faces(rest);
  else if (command === "build") build(rest);
  else if (command === "sheet") sheet(rest);
  else fail(USAGE);
} catch (e) {
  fail(`It did not work: ${String(e?.message || e).split("\n")[0]}`);
}
