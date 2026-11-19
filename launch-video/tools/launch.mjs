#!/usr/bin/env node
// The mechanics of a launch or promo video made with HyperFrames for social media: where
// HyperFrames' own guides are on this machine, the platforms' zones for the film's frame (from
// agentitos' platform-zones), a check that no text runs under what the apps lay over the video,
// and the media HeyGen would make, through OpenRouter instead: the voice (with every word's time),
// music and pictures. The film itself the agent writes, by the guides. Made for agents: every
// step prints what it did and what to do next.
//
//   node tools/launch.mjs guides                          where HyperFrames' guides are, and its CLI
//   node tools/launch.mjs zones <work> [platform…]        the zones of the film's frame → <work>/zones.json
//        [--frame 9:16 | --size 1080x1920]                (and the platforms and size → <work>/launch.json)
//   node tools/launch.mjs check <work> <composition>      text under the apps' buttons and bars, with
//                                                         when and where (HyperFrames' check, per band),
//                                                         and how far under the voice the music sits
//   node tools/launch.mjs draw <work> <stills-folder>     the zones drawn over every still → <folder>/zones/
//   node tools/launch.mjs fill <work> <stills-folder>       how much of every still the picture fills and where
//                                                         its middle lies (captions left out): empty, sparse, small, high
//   node tools/launch.mjs board <work> <stills-folder> [--out <file>]   the posed stills as one sheet
//                                                         for the chat, in film order, each with its
//                                                         number, name and time from <work>/STORYBOARD.md
//                                                         → uploads/<work's name>-board.jpg
//   node tools/launch.mjs voices [--model <id>]           the speech models, their price and voices
//   node tools/launch.mjs sample <work> --text "…" --voices a,b [--model <id>] [--out <folder>]
//                                                         one line in a few voices, to choose by ear
//   node tools/launch.mjs voice <work> <script.json> <composition>   every line spoken → <composition>/
//                                                         assets/voice/<id>.mp3, its words timed → <work>/voice.json
//   node tools/launch.mjs narration <work> <voice> <words.json> <composition> [--id narration]
//                                                         a voice the person recorded (best-takes' voice.cut.m4a
//                                                         and edit.json) as a line of <work>/voice.json
//        [--gap <s>+<len>,…]                              the voice stopped after the word that ends by <s> for
//                                                         <len> s of footage with its own sound: the pieces to place
//   node tools/launch.mjs words <work> <composition>      the voice's words at their times in the film,
//                                                         as the film's <audio> places the lines → <work>/words.json
//   node tools/launch.mjs captions <work> <composition> --style <a style of captions> [--mark]
//        [--pause <from>-<to>,…] [--follow] [--edge]      the captions (agentitos' captions skill) in
//                                                         <composition>/captions, and the line that mounts them;
//                                                         none in the stretches the picture carries the words
//   node tools/launch.mjs music <work> <composition> --prompt "…" --seconds 30 [--under 17]   music
//                                                         (Lyria 3) → <composition>/assets/music.mp3, faded
//                                                         at its end, and its <audio> with the volume that
//                                                         lays it 17 LU under the voice, both measured
//   node tools/launch.mjs level <work> <composition> [--rise 8] [--pause 1]   the music's volume lane
//                                                         along the placed voice: level while it speaks and
//                                                         through short pauses, up in pauses of 1 s or more
//                                                         and after the last word (no compressor: no pumping),
//                                                         out while footage plays its own sound
//   node tools/launch.mjs image <out.png> --prompt "…" [--ratio 9:16] [--ref <image>…]   a picture
//   node tools/launch.mjs finish <video.mp4>              the rendered video at −14 LUFS, the loudness
//                                                         the platforms play at (in place)
//
// script.json: {"model"?, "voice"?, "instructions"?, "speed"?, "lines": [{"id": "hook", "text": "…",
// "instructions"?}]}. A line already spoken with the same words, model, voice and instructions is
// kept. Options: --model <OpenRouter id> (voice, sample, music, image), --brand brand/DESIGN.md
// and --product "<name>" (captions), --vocals (music: with singing).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { zonesTool, platformList } from "./lib/zones.mjs";
import { post, postAudio, streamAudio } from "./lib/openrouter.mjs";
import { align } from "./lib/align.mjs";
import { transcribeFile, transcribeTool, NEEDS_TRANSCRIBE } from "./lib/transcribe.mjs";
import { loudness, musicVolume, distance, inFilm } from "./lib/level.mjs";

const SKILL = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fail = (msg) => { console.error(msg); process.exit(1); };
const rel = (p) => path.relative(process.cwd(), p) || ".";
const self = () => (rel(process.argv[1]).startsWith("..") ? process.argv[1] : rel(process.argv[1]));
const cmd = (c) => `node ${self()} ${c}`;
const readJson = (f, or) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : or);
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n"); };

const SPEECH_MODEL = "elevenlabs/eleven-v3";
const SPEECH_VOICE = "sarah";
const MUSIC_MODELS = { clip: "google/lyria-3-clip-preview", pro: "google/lyria-3-pro-preview" };
const IMAGE_MODEL = "google/gemini-3.1-flash-image";
// LU the music lies under the voice: what HyperFrames' sound guide's 0.14 means for two equally loud
// files, and the distance the owner chose by ear from samples at 11, 14, 17, 20 and 23 LU
const UNDER = 17;

// options that take no value
const FLAGS = ["mark", "vocals", "json", "follow", "edge"];

function parse(args) {
  const pos = [], opts = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) { pos.push(args[i]); continue; }
    const key = args[i].slice(2);
    const value = FLAGS.includes(key) || args[i + 1] === undefined || args[i + 1].startsWith("--") ? true : args[++i];
    // --ref may come more than once
    opts[key] = key === "ref" ? [...(opts[key] || []), value] : value;
  }
  return [pos, opts];
}

function probe(file) {
  try {
    const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { stdio: ["ignore", "pipe", "pipe"] }).toString());
    return { duration: Number(j.format?.duration) || 0, streams: j.streams || [] };
  } catch { fail(`${rel(file)} is no audio or picture ffprobe can read.`); }
}

const ffmpeg = (args) => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg: ${(r.stderr || "").trim().split("\n").slice(-2).join(" ")}`);
};

// ------------------------------------------------------------------------------- HyperFrames

// the HyperFrames CLI of this machine, as rragent finds it: RRAGENT_HYPERFRAMES, HYPERFRAMES, else
// `hyperframes` on the PATH
function hyperframesCli() {
  for (const p of [process.env.RRAGENT_HYPERFRAMES, process.env.HYPERFRAMES]) if (p && fs.existsSync(p)) return p;
  for (const dir of String(process.env.PATH).split(":")) {
    const f = path.join(dir, "hyperframes");
    if (dir && fs.existsSync(f)) return f;
  }
  return null;
}

// the CLI as a command to type: `hyperframes` when that is it on the PATH, else its path
function cliCommand() {
  const cli = hyperframesCli();
  if (!cli) return "hyperframes";
  const onPath = String(process.env.PATH).split(":").map((d) => d && path.join(d, "hyperframes")).find((f) => f && fs.existsSync(f));
  if (onPath && fs.realpathSync(onPath) === fs.realpathSync(cli)) return "hyperframes";
  return /\.[cm]?js$/.test(cli) ? `node ${cli}` : cli;
}

// the package the CLI runs from, and the guides it carries (dist/skills: hyperframes, hyperframes-cli,
// media-use, the version of this CLI); else the ones `hyperframes init` installs in ~/.agents/skills
function guides() {
  const cli = hyperframesCli();
  let pkg = null, version = null, dir = null;
  if (cli) {
    let p = path.dirname(fs.realpathSync(cli));
    while (p !== path.dirname(p)) {
      const f = path.join(p, "package.json");
      if (fs.existsSync(f) && readJson(f, {}).name === "hyperframes") { pkg = p; version = readJson(f, {}).version; break; }
      p = path.dirname(p);
    }
    if (pkg && fs.existsSync(path.join(pkg, "dist", "skills", "hyperframes", "SKILL.md"))) dir = path.join(pkg, "dist", "skills");
  }
  const home = path.join(os.homedir(), ".agents", "skills");
  if (!dir && fs.existsSync(path.join(home, "hyperframes", "SKILL.md"))) dir = home;
  return { cli, version, dir };
}

function cmdGuides() {
  const g = guides();
  if (!g.cli) console.log("✗ No HyperFrames CLI on this machine (rragent's hyperframes template needs it too): the operator installs it.");
  else console.log(`HyperFrames CLI ${g.version || "(version unknown)"}: ${g.cli}`);
  if (!g.dir) return fail("✗ HyperFrames' guides are not on this machine: neither in its CLI's package nor in ~/.agents/skills (`hyperframes skills update` puts them there).");
  const at = (...p) => path.join(g.dir, ...p);
  console.log(`HyperFrames' guides: ${g.dir}`);
  console.log(`  ${at("hyperframes", "SKILL.md")}   the contract, the work loop, what to read`);
  for (const [f, what] of [
    ["references/types/launch.md", "a launch film: real UI, the product on screen, the end card"],
    ["references/types/vertical.md", "a vertical clip (its zone numbers: take platform-zones' instead)"],
    ["references/story.md", "the one thing, three storylines, the hook, the beats"],
    ["references/spec.md", "SPEC.md: every adjective a number; BANNED by default"],
    ["references/storyboard.md", "every beat posed as a still for the person's go, before animating"],
    ["references/storyboard-format.md", "STORYBOARD.md: the frames, their names and times"],
    ["references/look.md", "the look"], ["references/motion.md", "motion, transitions, the camera"],
    ["references/format.md", "scenes, attributes, media, fonts"], ["references/sound.md", "music, effects, levels"],
    ["references/review.md", "the review and REVIEW.md"],
  ]) if (fs.existsSync(at("hyperframes", f))) console.log(`  ${at("hyperframes", f)}   ${what}`);
  if (fs.existsSync(at("hyperframes-cli", "SKILL.md"))) console.log(`  ${at("hyperframes-cli", "SKILL.md")}   the CLI: capture, lint, check, snapshot, beats`);
  if (fs.existsSync(at("media-use", "SKILL.md"))) console.log(`  ${at("media-use", "SKILL.md")}   media: sound effects and logos (free); voice, music and pictures come from this skill`);
  console.log(`Run the CLI as \`${cliCommand()}\` wherever the guides (and this skill) say \`npx hyperframes\` or \`hyperframes\`: the version that renders.`);
}

// ------------------------------------------------------------------------------- zones

function zonesJson(args) {
  const tool = zonesTool();
  if (!tool) fail("✗ The zones need agentitos' platform-zones skill beside this one (or PLATFORM_ZONES naming its tools/zones.mjs).");
  const r = spawnSync(process.execPath, [tool, "zones", ...args, "--json"], { encoding: "utf8" });
  if (r.status) fail(`✗ ${(r.stderr || r.stdout).trim()}`);
  return JSON.parse(r.stdout);
}

const box = (b) => `x ${b[0]}–${b[0] + b[2]}, y ${b[1]}–${b[1] + b[3]} (${b[2]}×${b[3]})`;

// the frame outside the safe box and the wide stretch, as few rectangles as there are
function keepOut(z) {
  const [W, H] = z.size;
  const rects = [z.safe, z.wide].filter(Boolean);
  const xs = [...new Set([0, W, ...rects.flatMap((r) => [r[0], r[0] + r[2]])])].sort((a, b) => a - b);
  const ys = [...new Set([0, H, ...rects.flatMap((r) => [r[1], r[1] + r[3]])])].sort((a, b) => a - b);
  const inside = (x, y) => rects.some((r) => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3]);
  const rows = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    let run = null;
    for (let i = 0; i + 1 < xs.length; i++) {
      const out = !inside((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2);
      if (out && run) run[1] = xs[i + 1];
      else if (out) run = [xs[i], xs[i + 1]];
      if ((!out || i + 2 === xs.length) && run) { rows.push([run[0], ys[j], run[1], ys[j + 1]]); run = null; }
    }
  }
  // rows of the same width one on the other become one
  const merged = [];
  for (const r of rows) {
    const m = merged.find((q) => q[0] === r[0] && q[2] === r[2] && q[3] === r[1]);
    if (m) m[3] = r[3]; else merged.push([...r]);
  }
  return merged.map(([x0, y0, x1, y1]) => [x0, y0, x1 - x0, y1 - y0]);
}

function cmdZones(work, ids, opts) {
  if (!work) fail(`Usage: ${cmd("zones <work> [platform…] [--frame 9:16 | --size 1080x1920]")}`);
  const args = [...ids];
  if (opts.size) args.push("--size", String(opts.size));
  else if (opts.frame) args.push("--frame", String(opts.frame));
  else if (!ids.length) args.push("--frame", "9:16");
  const z = zonesJson(args);
  const [W, H] = z.size, [sx, sy, sw, sh] = z.safe;
  writeJson(path.join(work, "zones.json"), z);
  writeJson(path.join(work, "launch.json"), { ...readJson(path.join(work, "launch.json"), {}), platforms: ids, size: z.size });
  const who = z.platforms.map((p) => p.name + (p.standIn ? " (standing in)" : "")).join(", ");
  console.log(`${z.frame}, ${W}×${H}: ${z.fallback ? `no platform named, so the usual ones of this frame together: ${who}` : who}`);
  console.log(`  safe     ${box(z.safe)}: every word, the product, faces and the logo stay inside`);
  console.log(`  centred  ${box(z.centred)}: the safe box even about the frame's middle, for titles, cards and captions centred on the frame`);
  if (z.wide) console.log(`  wide     ${box(z.wide)}: clear across the frame above the buttons on the right, for something wide at the top`);
  console.log(`  captions the lowest line ends at y ${sy + sh} (${H - sy - sh} px above the bottom), centred on the frame, at most ${z.centred[2]} px wide`);
  for (const c of z.covers) console.log(`  covered  ${box(c.box)}  ${c.what} (${c.platform}): only ground, texture, the rest of a picture`);
  for (const c of z.crops) console.log(`  cropped  ${box(c.box)}  ${c.where} shows ${c.ratio}: the hook's words and the face stay inside`);
  for (const n of z.notes) console.log(`  note     ${n}`);
  const wide = z.wide ? `\n    --wide-left: ${z.wide[0]}px; --wide-top: ${z.wide[1]}px; --wide-width: ${z.wide[2]}px; --wide-height: ${z.wide[3]}px;` : "";
  console.log(`\nThe root's size: data-width="${W}" data-height="${H}" (and the viewport, html and body). As custom properties for the root's :root, if you like:
  :root {
    --safe-left: ${sx}px; --safe-top: ${sy}px; --safe-width: ${sw}px; --safe-height: ${sh}px;
    --safe-right: ${W - sx - sw}px; --safe-bottom: ${H - sy - sh}px;
    --centred-left: ${z.centred[0]}px; --centred-width: ${z.centred[2]}px;${wide}
  }
Centre a title, a card or captions on the frame, at most --centred-width wide (left: --centred-left), never in the safe box: in a vertical frame the buttons sit on the right, so the safe box's middle lies left of the frame's and text centred in it looks off. Above the buttons the wide stretch is centred too, and wider.
→ ${rel(path.join(work, "zones.json"))}. After building: ${cmd(`check ${rel(work)} <composition>`)}`);
}

function zonesOf(work) {
  const f = path.join(work, "zones.json");
  if (!fs.existsSync(f)) fail(`✗ No zones yet: ${cmd(`zones ${rel(work)} [platform…]`)} first.`);
  return readJson(f);
}

function rootOf(composition) {
  const f = path.join(composition, "index.html");
  if (!fs.existsSync(f)) fail(`✗ There is no ${rel(f)}.`);
  const html = fs.readFileSync(f, "utf8");
  const root = html.match(/<[^>]*data-composition-id=[^>]*>/)?.[0] || "";
  const attr = (name) => root.match(new RegExp(`${name}="([^"]*)"`))?.[1];
  return { html, file: f, duration: Number(attr("data-duration")) || 0, width: Number(attr("data-width")) || 0, height: Number(attr("data-height")) || 0 };
}

// a script of the CLI's package runs with this Node, whether or not it may be executed
const run = (cli, args) => (/\.[cm]?js$/.test(cli) ? [process.execPath, [cli, ...args]] : [cli, args]);

function hfEnv() {
  return { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", HYPERFRAMES_SKIP_SKILLS: "1", PUPPETEER_SKIP_DOWNLOAD: "1",
    ...(process.env.CHROME ? { HYPERFRAMES_BROWSER_PATH: process.env.CHROME, PRODUCER_HEADLESS_SHELL_PATH: process.env.CHROME } : {}) };
}

function cmdCheck(work, composition) {
  if (!work || !composition) fail(`Usage: ${cmd("check <work> <composition>")}`);
  const z = zonesOf(work);
  const root = rootOf(composition);
  const [W, H] = z.size;
  if (root.width !== W || root.height !== H) fail(`✗ The film is ${root.width}×${root.height}, the zones are for ${W}×${H}: set the root's data-width and data-height, or ${cmd(`zones ${rel(work)} … --size ${root.width}x${root.height}`)}.`);
  if (!root.duration) fail(`✗ The root of ${rel(root.file)} has no data-duration.`);
  const cli = hyperframesCli();
  if (!cli) fail("✗ No HyperFrames CLI on this machine: the operator installs it.");
  // the sound first: it is measured in seconds, the text takes minutes
  const sound = soundLine(composition, work);
  if (sound) console.log(`${sound}\n`);
  // a sample every quarter of a second, as fractions of the film
  const step = Math.max(0.25, root.duration / 400);
  const seek = Array.from({ length: Math.floor(root.duration / step) + 1 }, (_, k) => +Math.min(1, (k * step) / root.duration).toFixed(5)).join(",");
  const bands = keepOut(z);
  const found = new Map();
  for (const b of bands) {
    // rounded inwards: text that ends on the safe box's edge does not reach into the band
    const up = (v) => (Math.ceil(v * 1e5) / 1e5).toFixed(5), down = (v) => (Math.floor(v * 1e5) / 1e5).toFixed(5);
    const zone = `x0=${up(b[0] / W)};y0=${up(b[1] / H)};x1=${down((b[0] + b[2]) / W)};y1=${down((b[1] + b[3]) / H)};severity=error;seek=${seek}`;
    const r = spawnSync(...run(cli, ["check", path.resolve(composition), "--json", "--no-contrast", "--samples", "2", "--no-collapse-static", "--max-issues", "100000", "--caption-zone", zone]), { encoding: "utf8", env: hfEnv(), maxBuffer: 64 << 20, timeout: 900e3 });
    const why = () => (r.error?.code === "ETIMEDOUT" ? "it ran for 15 minutes" : (r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" "));
    let j;
    try { j = JSON.parse(r.stdout); } catch { fail(`✗ HyperFrames' check did not finish: ${why()}`); }
    if (j.browserSkipped) fail(`✗ HyperFrames' check found errors before it could look at the film: run \`${cliCommand()} lint ${rel(composition)}\` and fix them, then check again.`);
    // a check that failed still answers in JSON, without its layout: never a ✓ from it
    if (j.error || !j.layout) fail(`✗ HyperFrames' check failed: ${j.error || why()}. Nothing was checked.`);
    for (const f of j.layout.findings || []) {
      if (f.code !== "caption_zone_collision") continue;
      const key = `${f.selector}|${f.sourceFile}`;
      const e = found.get(key) || { selector: f.selector, file: f.sourceFile, text: f.text, hits: [] };
      e.hits.push({ time: f.time, band: b, rect: f.rect || f.bbox });
      found.set(key, e);
    }
  }
  const who = z.platforms.map((p) => p.name).join(", ");
  if (!found.size) {
    console.log(`✓ No text outside the safe box ${box(z.safe)}${z.wide ? ` and the wide stretch ${box(z.wide)}` : ""} (${who}), sampled every ${step.toFixed(2)} s.`);
    console.log(`What no check reads: words inside pictures and screenshots, a face under the buttons. Look at the stills with the zones drawn: ${cmd(`draw ${rel(work)} <stills-folder>`)}`);
    return;
  }
  const meets = (a, c) => a[0] < c[0] + c[2] && a[0] + a[2] > c[0] && a[1] < c[1] + c[3] && a[1] + a[3] > c[1];
  // under an app's buttons is a ✗; in the safe box's margin beyond them, or only the element's box
  // past it, a ! (the margin is a buffer for other phones, not something an app lays there)
  const lines = [];
  let covered = 0;
  for (const e of found.values()) {
    e.hits.sort((x, y) => x.time - y.time);
    // the spans it is there: a gap of more than two samples starts a new one
    const spans = [];
    for (const h of e.hits) {
      const last = spans.at(-1);
      if (last && h.time - last[1] <= step * 2.5) last[1] = h.time; else spans.push([h.time, h.time]);
    }
    // the letters where they reach into a band; HyperFrames measures the element's box, which
    // can reach into one while its letters stay clear
    const letters = (h) => (h.rect ? [Math.round(h.rect.left ?? h.rect.x), Math.round(h.rect.top ?? h.rect.y), Math.round(h.rect.width), Math.round(h.rect.height)] : null);
    const inBand = e.hits.find((h) => letters(h) && meets(letters(h), h.band));
    // under an app's buttons at any moment, not only where it first reaches into a band
    const coveredHit = e.hits.find((h) => letters(h) && meets(letters(h), h.band) && z.covers.some((c) => meets(letters(h), c.box)));
    const at = letters(coveredHit || inBand || e.hits[0]);
    const under = coveredHit ? z.covers.filter((c) => meets(at, c.box)) : [];
    if (under.length) covered++;
    lines.push(`  ${under.length ? "✗" : "!"} ${spans.map(([a, b]) => (a === b ? `${a.toFixed(2)}` : `${a.toFixed(2)}–${b.toFixed(2)}`)).join(", ")} s  ${e.selector} in ${e.file}: "${e.text}"${at ? ` at ${box(at)}` : ""}`);
    if (!inBand) lines.push(`      its letters are clear, but its box reaches past the safe box: centre the element on the frame at most ${z.centred[2]} px wide (left ${z.centred[0]} px), not across the whole frame`);
    else lines.push(`      ${under.length ? `under ${[...new Set(under.map((c) => `${c.what} (${c.platform})`))].join("; ")}` : "outside the safe box, in the margin the guides keep; no app lays anything there"}`);
  }
  console.log(covered
    ? `✗ ${covered} text${covered > 1 ? "s" : ""} under the apps' buttons and bars (${who})${found.size > covered ? `, ${found.size - covered} more in the safe box's margin` : ""}:`
    : `! ${found.size} text${found.size > 1 ? "s" : ""} past the safe box ${box(z.safe)}, none under the apps' buttons and bars (${who}):`);
  for (const l of lines) console.log(l);
  if (covered) {
    console.log(`\nMove each ✗ out from under the buttons: centred on the frame in ${box(z.centred)}${z.wide ? ` (or the wide stretch ${box(z.wide)})` : ""}. Text that is only texture, meant to run under the buttons, gets data-layout-allow-caption-zone. Then check again.`);
    process.exitCode = 1;
  } else console.log(`\nA ! may stay when the layout needs it (centred, bigger): the margin is a buffer for other phones. Pull it in when it costs nothing.`);
}

const lufs = (x) => x.toFixed(1).replace("-", "−");
const lu = (x) => (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1));

// how far under the voice the music sits, as the root places both (each <audio> at its
// data-volume): measured, so a music bed laid before the voice, or a voice or music changed since,
// shows here. Nothing when the film has no music.
export function soundLine(composition, work) {
  try { return soundOf(composition, work); } catch (e) { return `! Sound: not measured (${e.message}).`; }
}

function soundOf(composition, work) {
  const { music, voice } = inFilm(composition);
  if (!music) return null;
  if (!fs.existsSync(music.file)) return `✗ Sound: the music's file ${music.src} is not there.`;
  const m = loudness([music.file]);
  if (m == null) return `! Sound: the music ${music.src} is silent.`;
  const placed = voice.filter((v) => fs.existsSync(v.file));
  const spoken = work ? (readJson(path.join(work, "voice.json"), {}).lines || []).length : 0;
  if (!voice.length && spoken) return `! Sound: ${rel(path.join(work, "voice.json"))} has ${spoken} line${spoken > 1 ? "s" : ""} of a voice, but the root places none (<audio id="vo-<id>" src="assets/voice/<id>.mp3">): nothing to measure the music against.`;
  if (!placed.length) return `Sound: the music plays without a voice${voice.length ? ` (the voice's files are not there: ${voice.map((v) => v.src).join(", ")})` : ""}, at data-volume ${music.volume}: ${lufs(m + 20 * Math.log10(music.volume || 1e-9))} LUFS in the film (${lufs(m)} as made).`;
  const v = loudness(placed);
  if (v == null) return `! Sound: the voice (${placed.length} line${placed.length > 1 ? "s" : ""}) is silent.`;
  if (!(music.volume > 0)) return `! Sound: the music is placed at data-volume ${music.volume}: it is not heard.`;
  // with a volume lane (`level`), the music plays under the voice at data-volume × the lane's low point
  const lane = musicTag(fs.readFileSync(path.join(composition, "index.html"), "utf8"))?.lane;
  const share = speaking(lane), under = music.volume * share;
  const d = distance(v, m, under), want = music.under || UNDER, fit = musicVolume(v, m, want);
  const numbers = `the voice at ${lufs(v)} LUFS as placed (${placed.length} line${placed.length > 1 ? "s" : ""}), the music at ${lufs(m)} as made, at data-volume ${music.volume}${lane ? ` × ${share} while the voice speaks (its volume lane)` : ""}`;
  if (Math.abs(d - want) <= 1) return `Sound: the music sits ${lu(d)} LU under the voice (${numbers}). Measured, not heard: say so.`;
  if (!lane && fit.bound && Math.abs(music.volume - fit.volume) < 0.0005) return `! Sound: the music sits ${lu(d)} LU under the voice, not ${want} (${numbers}): ${fit.volume} is the ${fit.bound} volume here; for ${want} LU, music ${fit.bound === "highest" ? "louder" : "quieter"} of its own (\`music\` again).`;
  if (lane) return `! Sound: the music sits ${lu(d)} LU under the voice while it speaks, not ${want} (${numbers}): the voice or the music changed since its lane was laid. Run \`level\` again, then check again.`;
  return `! Sound: the music sits ${lu(d)} LU under the voice, not ${want} (${numbers}): its volume was set before the voice, or the voice or the music changed since. Set data-volume="${fit.volume}" on <audio id="music">${fit.bound ? ` (the ${fit.bound} volume here: it then sits ${lu(fit.under)} LU under)` : ""} and run check again. Another distance on purpose: data-under-voice="<LU>" on it.`;
}

function cmdDraw(work, folder) {
  if (!work || !folder) fail(`Usage: ${cmd("draw <work> <stills-folder>")}`);
  const z = zonesOf(work);
  const ids = readJson(path.join(work, "launch.json"), {}).platforms || [];
  const tool = zonesTool();
  if (!tool) fail("✗ The zones need agentitos' platform-zones skill beside this one.");
  const stills = fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => /\.(png|jpe?g)$/i.test(f) && !/^contact-sheet/.test(f)).sort() : [];
  if (!stills.length) fail(`✗ No stills in ${rel(folder)}: snapshot the film first (\`hyperframes snapshot --at …\`).`);
  for (const s of stills) {
    const v = probe(path.join(folder, s)).streams.find((x) => x.codec_type === "video");
    if (v && (v.width !== z.size[0] || v.height !== z.size[1])) fail(`✗ ${s} is ${v.width}×${v.height}, the zones are for ${z.size.join("×")}: snapshot the film these zones are for, or ${cmd(`zones ${rel(work)} … --size ${v.width}x${v.height}`)}.`);
  }
  const out = path.join(folder, "zones");
  fs.mkdirSync(out, { recursive: true });
  for (const s of stills) {
    const r = spawnSync(process.execPath, [tool, "draw", path.join(folder, s), path.join(out, s.replace(/\.\w+$/, ".png")), ...ids], { encoding: "utf8" });
    if (r.status) fail(`✗ ${(r.stderr || r.stdout).trim()}`);
  }
  console.log(`${rel(out)}/: ${stills.length} still${stills.length > 1 ? "s" : ""} with the zones of ${z.platforms.map((p) => p.name).join(", ")} drawn (red: covered, green: safe, yellow: where a feed crops). Look at each: a word in a picture, a face, the product's button under red is to move.`);
}

// ------------------------------------------------------------------------------- how a still is filled

// What a still shows apart from its ground, measured on a small grey copy (`cols` × `rows` cells,
// each 0-255): the ground is the commonest level of the frame's border, a cell is picture where it
// differs from the ground by more than `by`; the band where captions stand (`skip`: [top, bottom]
// as shares of the height) is left out, so that captions do not count as picture. Returns the
// picture's box as shares of the frame (null when there is none) and the share of cells it covers.
export function filled(cells, cols, rows, { skip = null, by = 24 } = {}) {
  const at = (x, y) => cells[y * cols + x];
  const border = [];
  for (let x = 0; x < cols; x++) border.push(at(x, 0), at(x, rows - 1));
  for (let y = 0; y < rows; y++) border.push(at(0, y), at(cols - 1, y));
  const counts = new Map();
  for (const v of border) { const k = Math.round(v / 8); counts.set(k, (counts.get(k) || 0) + 1); }
  const ground = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] * 8;
  let x0 = cols, y0 = rows, x1 = -1, y1 = -1, n = 0, all = 0;
  for (let y = 0; y < rows; y++) {
    if (skip && y / rows >= skip[0] && (y + 1) / rows <= skip[1]) continue;
    for (let x = 0; x < cols; x++) {
      all++;
      if (Math.abs(at(x, y) - ground) <= by) continue;
      n++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return { box: null, share: 0 };
  return { box: [x0 / cols, y0 / rows, (x1 + 1 - x0) / cols, (y1 + 1 - y0) / rows], share: n / all };
}

// a verdict on one still: empty (nothing but ground and captions), sparse (picture on less than
// `cover` of the frame's cells), small (the picture spans less than `least` of the safe box's height
// and of its width), high (its middle in the top third of the safe box), as shares of the frame.
// `cover`: the stills of the hand-built 16:9 explainer and of the film built from this skill after
// this check had picture on a median 25 % of their cells, the one before it (small type, figures
// high in an empty frame) on 8 % (2026-11-19)
export function fillVerdict(f, safe, { least = 0.4, cover = 0.06 } = {}) {
  if (!f.box || f.share < 0.004) return { mark: "✗", why: "empty: nothing but the ground (and captions)" };
  const [x, y, w, h] = f.box, [sx, sy, sw, sh] = safe;
  const why = [];
  if (f.share < cover) why.push(`sparse: picture on ${Math.round(f.share * 100)} % of the frame`);
  if (h < least * sh && w < least * sw) why.push(`small: ${Math.round((h / sh) * 100)} % of the safe box's height, ${Math.round((w / sw) * 100)} % of its width`);
  const mid = y + h / 2;
  if (mid < sy + sh / 3) why.push(`high: its middle at ${Math.round(mid * 100)} % of the frame's height, in the safe box's top third`);
  return why.length ? { mark: "!", why: why.join("; ") } : { mark: "✓", why: `${Math.round((w / sw) * 100)} % × ${Math.round((h / sh) * 100)} % of the safe box, its middle at ${Math.round(mid * 100)} % of the height` };
}

function cmdFill(work, folder) {
  if (!work || !folder) fail(`Usage: ${cmd("fill <work> <stills-folder>")}`);
  const z = zonesOf(work);
  const [W, H] = z.size;
  const stills = fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => /\.(png|jpe?g)$/i.test(f) && !/^contact-sheet/.test(f)).sort() : [];
  if (!stills.length) fail(`✗ No stills in ${rel(folder)}: snapshot every beat and every scene's first frame (\`${cliCommand()} snapshot <composition> --at … --no-end -o ${rel(folder)}\`).`);
  const cols = 96, rows = Math.round((96 * H) / W);
  const safe = [z.safe[0] / W, z.safe[1] / H, z.safe[2] / W, z.safe[3] / H];
  // the captions' band: two lines of the styles' type (about a twentieth of the short side, 1.4 high) above the safe box's bottom
  const band = (2 * 0.054 * 1.45 * Math.min(W, H) + 24) / H, bottom = (z.safe[1] + z.safe[3]) / H;
  const skip = [bottom - band, bottom + 0.001];
  let flagged = 0;
  for (const s of stills) {
    const r = spawnSync("ffmpeg", ["-v", "error", "-i", path.join(folder, s), "-vf", `scale=${cols}:${rows}:flags=area,format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 24 });
    if (r.status !== 0 || r.stdout.length < cols * rows) fail(`✗ ${s} is no picture ffmpeg can read.`);
    const v = fillVerdict(filled(r.stdout, cols, rows, { skip }), safe);
    if (v.mark !== "✓") flagged++;
    console.log(`  ${v.mark} ${s}: ${v.why}`);
  }
  console.log(`${stills.length} still${stills.length > 1 ? "s" : ""}, ${flagged} flagged. Measured without the captions' band, against the safe box of ${z.platforms.map((p) => p.name).join(", ")}. ✗ empty: a scene that opens on its ground until its first word (carry the last picture over, or bring the scene's figure in from its first frame). ! sparse, small or high: the beat's main thing belongs in the middle of the frame and large (read on a phone at arm's length); a label stays above it. It judges size and place only: look at the stills.`);
}

// ------------------------------------------------------------------------------- the board

// the frames of a STORYBOARD.md (HyperFrames' format): `## Frame 1: The hook (0-3s)` or
// `## Frame 1 — The hook` with `- duration: 3s` (Beat and Scene too, at H2 or H3), in its order,
// each with its name and its range in seconds when the file gives one
export function storyboardFrames(text) {
  const frames = [];
  for (const line of String(text).split("\n")) {
    const h = line.match(/^#{2,3}\s+(?:Frame|Beat|Scene)\s+(\d+)\b\s*[:—–-]?\s*(.*)$/i);
    if (h) {
      let name = h[2].trim(), range = null;
      const r = name.match(/\(\s*(\d+(?:\.\d+)?)\s*s?\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)\s*s?\s*\)\s*$/i);
      if (r) { range = [Number(r[1]), Number(r[2])]; name = name.slice(0, r.index).trim(); }
      frames.push({ number: Number(h[1]), name, range, duration: null });
      continue;
    }
    const d = frames.length && line.match(/^\s*[-*]\s*duration\s*:\s*(\d+(?:\.\d+)?)\s*s?\s*$/i);
    if (d) frames.at(-1).duration = Number(d[1]);
  }
  // a range from the durations where a heading gives none, as long as every frame before has one
  let t = 0;
  for (const f of frames) {
    if (!f.range && f.duration != null && Number.isFinite(t)) f.range = [t, +(t + f.duration).toFixed(3)];
    t = f.range ? f.range[1] : NaN;
  }
  return frames.map(({ duration, ...f }) => f);
}

// the stills `hyperframes snapshot --at … --no-end` writes (frame-NN-at-<seconds>s.png), in film
// order by their number, with their moment
export function boardStills(folder) {
  if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return [];
  return fs.readdirSync(folder)
    .map((file) => ({ file, m: file.match(/^frame-(\d+)-at-(\d+(?:\.\d+)?)s\.(png|jpe?g)$/i) }))
    .filter((s) => s.m)
    .map(({ file, m }) => ({ file, index: Number(m[1]), at: Number(m[2]) }))
    .sort((a, b) => a.index - b.index || a.at - b.at);
}

// the sheet: about a phone picture wide (1080 px), three tiles a row for a vertical film, two for
// any other; each tile its still with a label band under it. Every box in the picture's pixels.
export function boardLayout(n, still, { width = 1080, labels = true } = {}) {
  const tall = still[1] > still[0];
  const cols = Math.max(1, Math.min(n, tall ? 3 : 2)), rows = Math.ceil(n / cols);
  const margin = 12, gap = 12;
  const even = (x) => 2 * Math.floor(x / 2);
  const tw = even((width - 2 * margin - cols * 2 * gap) / cols);
  const th = even((tw * still[1]) / still[0]);
  const name = Math.max(18, Math.min(40, Math.round(tw * 0.085))), time = Math.round(name * 0.8);
  const band = labels ? even(name + time + 30) : 0;
  const cell = [tw + 2 * gap, th + band + 2 * gap];
  const tiles = Array.from({ length: n }, (_, i) => {
    const x = margin + (i % cols) * cell[0] + gap, y = margin + Math.floor(i / cols) * cell[1] + gap;
    return { still: [x, y, tw, th], label: [x, y + th, tw, band] };
  });
  return { cols, rows, tile: [tw, th], band, font: { name, time }, cell, size: [2 * margin + cols * cell[0], 2 * margin + rows * cell[1]], tiles };
}

// a sans-serif bold for the labels, when this ffmpeg can draw text at all (as publish-video's sheet)
function labelFont() {
  const filters = spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" }).stdout || "";
  if (!/\sdrawtext\s/.test(filters)) return null;
  const fc = spawnSync("fc-match", ["-f", "%{file}", "sans:bold"], { encoding: "utf8" });
  const found = fc.status === 0 && fc.stdout.trim();
  return [found, "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"].find((f) => f && fs.existsSync(f)) || null;
}

const secs = (x) => String(+Number(x).toFixed(2));
const frameTime = (f, s) => (f?.range ? `${secs(f.range[0])}–${secs(f.range[1])} s` : `at ${secs(s.at)} s`);

function cmdBoard(work, folder, opts) {
  if (!work || !folder) fail(`Usage: ${cmd("board <work> <stills-folder> [--out uploads/<name>-board.jpg]")}`);
  if (!fs.existsSync(folder)) fail(`✗ There is no ${rel(folder)}: pose every beat, then snapshot them in one run (\`${cliCommand()} snapshot <composition> --at <every beat's moment> --no-end -o ${rel(folder)}\`).`);
  const stills = boardStills(folder);
  if (!stills.length) fail(`✗ No stills (frame-NN-at-<seconds>s.png) in ${rel(folder)}: snapshot every beat in one run (\`${cliCommand()} snapshot <composition> --at <every beat's moment> --no-end -o ${rel(folder)}\`).`);
  const sbFile = path.join(work, "STORYBOARD.md");
  const frames = fs.existsSync(sbFile) ? storyboardFrames(fs.readFileSync(sbFile, "utf8")) : null;
  if (frames && frames.length && frames.length !== stills.length) fail(`✗ ${rel(sbFile)} has ${frames.length} frames, ${rel(folder)} ${stills.length} still${stills.length > 1 ? "s" : ""}: snapshot every frame's moment in one run, in film order, or make the frames of STORYBOARD.md the ones you posed.`);
  const named = frames && frames.length ? frames : null;
  const out = opts.out ? String(opts.out) : path.join("uploads", `${path.basename(path.resolve(work))}-board.jpg`);
  const v = probe(path.join(folder, stills[0].file)).streams.find((x) => x.codec_type === "video");
  if (!v?.width || !v?.height) fail(`✗ ${stills[0].file} is no picture ffmpeg can read.`);
  const font = labelFont();
  const L = boardLayout(stills.length, [v.width, v.height], { labels: !!font });
  const [tw, th] = L.tile;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "launch-board-"));
  // the light page of HyperFrames' board: dark words on a pale ground
  const page = "0xF4F4F5", ink = "0x18181B", grey = "0x52525B";
  const esc = (p) => p.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/,/g, "\\,");
  // a name longer than its tile: cut, with an ellipsis (the letters about 0.6 of the size wide)
  const fit = (s, size) => { const max = Math.floor(tw / (size * 0.6)); return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s; };
  try {
    const inputs = [], parts = [];
    stills.forEach((s, i) => {
      inputs.push("-i", path.join(folder, s.file));
      let label = "";
      if (font) {
        const f = named?.[i];
        const title = path.join(tmp, `${i}-name.txt`), time = path.join(tmp, `${i}-time.txt`);
        fs.writeFileSync(title, fit(`${String(i + 1).padStart(2, "0")}${f?.name ? `  ${f.name}` : ""}`, L.font.name));
        fs.writeFileSync(time, frameTime(f, s));
        const text = (file, size, color, y) => `,drawtext=fontfile='${esc(font)}':textfile='${esc(file)}':expansion=none:fontsize=${size}:fontcolor=${color}:x=0:y=${y}`;
        label = `,pad=${tw}:${th + L.band}:0:0:color=${page}${text(title, L.font.name, ink, th + 10)}${text(time, L.font.time, grey, th + 16 + L.font.name)}`;
      }
      parts.push(`[${i}:v]scale=${tw}:${th}:force_original_aspect_ratio=decrease,pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:color=${page},setsar=1,format=rgb24,drawbox=x=0:y=0:w=iw:h=ih:color=0xD4D4D8:t=2${label},pad=${L.cell[0]}:${L.cell[1]}:${(L.cell[0] - tw) / 2}:${(L.cell[1] - th - L.band) / 2}:color=${page}[c${i}]`);
    });
    // empty cells fill the last row
    for (let i = stills.length; i < L.rows * L.cols; i++) {
      inputs.push("-f", "lavfi", "-i", `color=c=${page}:s=${L.cell[0]}x${L.cell[1]}:d=0.1`);
      parts.push(`[${i}:v]trim=end_frame=1,format=rgb24[c${i}]`);
    }
    for (let r = 0; r < L.rows; r++) parts.push(L.cols > 1 ? `${Array.from({ length: L.cols }, (_, c) => `[c${r * L.cols + c}]`).join("")}hstack=inputs=${L.cols}[r${r}]` : `[c${r}]null[r${r}]`);
    parts.push(`${L.rows > 1 ? `${Array.from({ length: L.rows }, (_, r) => `[r${r}]`).join("")}vstack=inputs=${L.rows}` : "[r0]null"},pad=${L.size[0]}:${L.size[1]}:12:12:color=${page},format=yuvj420p[out]`);
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.rmSync(out, { force: true });
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", parts.join(";"), "-map", "[out]", "-frames:v", "1", "-q:v", "3", out], { encoding: "utf8" });
    if (r.status || !fs.existsSync(out)) fail(`✗ ffmpeg made no board: ${(r.stderr || "").trim().split("\n").pop()}`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(`${rel(out)}: ${stills.length} still${stills.length > 1 ? "s" : ""} of ${v.width}×${v.height} in film order, ${L.cols} a row (${L.size.join("×")}):`);
  stills.forEach((s, i) => {
    const f = named?.[i];
    const off = f?.range && (s.at < f.range[0] || s.at > f.range[1]) ? `   ! its moment ${secs(s.at)} s lies outside the frame's ${frameTime(f, s)}` : "";
    console.log(`  ${String(i + 1).padStart(2, "0")}  ${(f?.name || "").padEnd(28)} ${frameTime(f, s).padEnd(12)} ${s.file}${off}`);
  });
  if (!named) console.log(`! ${frames ? `${rel(sbFile)} has no "## Frame N: <name> (<from>-<to>s)" headings` : `No ${rel(sbFile)}`}: the tiles carry their number and moment, no name. Write the frames there and run board again.`);
  if (!font) console.log(`! This ffmpeg cannot draw text (no drawtext): the tiles carry no labels. Name them in your message, row by row, as listed above.`);
  console.log(`Look at it yourself first. Then show it in the chat (an <img> of ${out.split(path.sep).join("/")}) and stop until they say go. A note on a frame changes only that frame: re-pose it, snapshot its moment alone into ${rel(path.join(folder, "redo"))}/, move that still over the frame's old one (the new time in its name if it moved), and run board again.`);
}

// ------------------------------------------------------------------------------- the voice

let catalog;
async function speechModels() {
  if (catalog) return catalog;
  // the public list: no key needed
  const res = await fetch("https://openrouter.ai/api/v1/models?output_modalities=speech", { signal: AbortSignal.timeout(15e3) });
  if (!res.ok) throw new Error(`OpenRouter's list of models: HTTP ${res.status}`);
  catalog = (await res.json()).data || [];
  return catalog;
}

const perThousand = (m) => (Number(m?.pricing?.prompt) || 0) * 1000;

async function cmdVoices(opts) {
  let models;
  try { models = await speechModels(); } catch (e) { fail(`✗ ${e.message}`); }
  if (opts.model) {
    const m = models.find((x) => x.id === opts.model);
    if (!m) fail(`✗ There is no speech model ${opts.model}: ${cmd("voices")} lists them.`);
    console.log(`${m.id}: $${perThousand(m).toFixed(3)} per 1000 characters${(m.supported_parameters || []).length ? `, takes ${m.supported_parameters.join(", ")}` : ""}`);
    console.log(m.supported_voices?.length ? `Voices: ${m.supported_voices.join(", ")}` : "No list of voices: it takes the provider's default, or one its provider documents.");
    console.log(`\nHear a few before choosing: ${cmd(`sample <work> --model ${m.id} --voices <a,b,c> --text "<the hook>"`)}`);
    return;
  }
  console.log(`The speech models on OpenRouter, the price per 1000 characters (a 30 s script is about 450):`);
  for (const m of models) console.log(`  ${m.id.padEnd(40)} $${perThousand(m).toFixed(3).padStart(6)}  ${m.supported_voices?.length ? `${m.supported_voices.length} voices: ${m.supported_voices.slice(0, 6).join(", ")}${m.supported_voices.length > 6 ? ", …" : ""}` : "(voices: the provider's)"}`);
  console.log(`\nDefault: ${SPEECH_MODEL}, voice ${SPEECH_VOICE} (expressive, many languages). Every voice of one: ${cmd("voices --model <id>")}`);
}

async function speak({ model, voice, text, instructions, speed }) {
  const body = { model, input: text, ...(voice ? { voice } : {}), response_format: "mp3", ...(instructions ? { instructions } : {}), ...(speed && Number(speed) !== 1 ? { speed: Number(speed) } : {}) };
  const { bytes } = await postAudio(`The voice (${model})`, "/audio/speech", body, { log: console.log });
  if (bytes.length < 1000) throw new Error(`${model} answered with ${bytes.length} bytes, no speech`);
  return bytes;
}

async function cmdSample(work, opts) {
  const voices = platformList(opts.voices);
  if (!work || !opts.text || !voices.length) fail(`Usage: ${cmd('sample <work> --text "<a line>" --voices a,b,c [--model <id>] [--out <folder>]')}`);
  const model = opts.model || SPEECH_MODEL;
  const out = opts.out || path.join(work, "samples");
  fs.mkdirSync(out, { recursive: true });
  const files = await Promise.all(voices.map(async (v) => {
    const f = path.join(out, `${model.split("/").pop()}-${v}.mp3`.replace(/[^\w.-]+/g, "-"));
    try { fs.writeFileSync(f, await speak({ model, voice: v, text: opts.text, instructions: opts.instructions })); return [v, f]; }
    catch (e) { return [v, null, e.message]; }
  }));
  for (const [v, f, why] of files) console.log(f ? `  ${v}: ${rel(f)} (${probe(f).duration.toFixed(1)} s)` : `  ${v}: ✗ ${why}`);
  console.log(`Play them to the person (an <audio> each) and let them choose; then set "voice" (and "model") in the script.`);
}

// the words of one spoken line, timed: ElevenLabs Scribe, run by agentitos' transcribe skill
async function hear(file) {
  const r = await transcribeFile(file);
  return { heard: r.words.filter((w) => w.kind !== "event").map(({ text, start, end }) => ({ text, start, end })), cost: r.cost };
}

async function cmdVoice(work, scriptFile, composition, opts) {
  if (!work || !scriptFile || !composition) fail(`Usage: ${cmd("voice <work> <script.json> <composition>")}`);
  if (!transcribeTool()) fail(`✗ ${NEEDS_TRANSCRIBE}`);
  const script = readJson(scriptFile, null) || fail(`✗ There is no ${scriptFile}.`);
  const lines = script.lines || fail(`✗ ${scriptFile} has no "lines": [{"id": "hook", "text": "…"}, …].`);
  const ids = new Set();
  for (const l of lines) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(l.id || "")) fail(`✗ Every line needs an "id" of lowercase letters, digits and dashes ("hook", "proof-1"); "${l.id}" is not one.`);
    if (ids.has(l.id)) fail(`✗ Two lines are "${l.id}".`);
    if (!String(l.text || "").trim()) fail(`✗ The line "${l.id}" has no "text".`);
    ids.add(l.id);
  }
  const model = opts.model || script.model || SPEECH_MODEL;
  const voice = opts.voice || script.voice || (model === SPEECH_MODEL ? SPEECH_VOICE : null);
  const speed = opts.speed || script.speed;
  const dir = path.join(composition, "assets", "voice");
  fs.mkdirSync(dir, { recursive: true });
  const metaFile = path.join(work, "voice.json");
  const before = Object.fromEntries((readJson(metaFile, {}).lines || []).map((l) => [l.id, l]));
  let chars = 0, scribeCost = 0;
  // a line's new sound replaces its old one only once it is heard: a failed line keeps its old
  // sound and words, so voice.json always tells what the files say
  const settled = await Promise.allSettled(lines.map(async (l) => {
    const instructions = l.instructions || script.instructions;
    const key = crypto.createHash("sha1").update(JSON.stringify([model, voice, l.text, instructions, speed])).digest("hex").slice(0, 12);
    const file = path.join(dir, `${l.id}.mp3`), fresh = path.join(dir, `.${l.id}.new.mp3`);
    if (before[l.id]?.key === key && fs.existsSync(file)) return { ...before[l.id], kept: true };
    chars += l.text.length;
    try {
      fs.writeFileSync(fresh, await speak({ model, voice, text: l.text, instructions, speed }));
      const { heard, cost } = await hear(fresh);
      scribeCost += cost;
      const line = { id: l.id, text: l.text, key, file: `assets/voice/${l.id}.mp3`, duration: +probe(fresh).duration.toFixed(3), words: align(l.text, heard), heard: heard.map((w) => w.text).join(" ") };
      fs.renameSync(fresh, file);
      return line;
    } finally {
      fs.rmSync(fresh, { force: true });
    }
  }));
  const failed = settled.map((r, k) => (r.status === "rejected" ? `${lines[k].id}: ${r.reason?.message || r.reason}` : null)).filter(Boolean);
  const done = settled.map((r, k) => (r.status === "fulfilled" ? r.value : before[lines[k].id] && { ...before[lines[k].id], kept: true, failed: true })).filter(Boolean);
  // a recorded voice (`narration`) is no line of the script: it stays
  const recorded = Object.values(before).filter((l) => l.recorded && !ids.has(l.id));
  // a line taken out of the script: its file goes too
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".mp3") && !ids.has(f.slice(0, -4)) && !recorded.some((l) => l.file === `assets/voice/${f}`)) fs.rmSync(path.join(dir, f));
  writeJson(metaFile, { model, voice, ...(speed ? { speed } : {}), lines: [...recorded, ...done.map(({ kept, failed, ...l }) => l)] });
  let price = 0;
  try { price = perThousand((await speechModels()).find((m) => m.id === model)) * chars / 1000; } catch {}
  console.log(`${model}, voice ${voice || "(the provider's)"}:`);
  let total = 0;
  for (const l of done) {
    total += l.duration;
    const differs = l.heard && l.words.length !== l.heard.split(/\s+/).length ? `   heard: "${l.heard}"` : "";
    console.log(`  ${l.id.padEnd(12)} ${l.duration.toFixed(2).padStart(6)} s  ${l.failed ? "(the old one) " : l.kept ? "(kept) " : ""}"${l.text}"${differs}`);
  }
  for (const f of failed) console.log(`  ✗ ${f}`);
  if (failed.length) process.exitCode = 1;
  console.log(`  ${"".padEnd(12)} ${total.toFixed(2).padStart(6)} s spoken in all${chars ? `; ${chars} characters, about $${(price + scribeCost).toFixed(3)}` : ""}`);
  console.log(`→ ${rel(dir)}/<id>.mp3, the words with their times in ${rel(metaFile)}.
Listen for a word said wrong (a name, a number): write it in "text" as it is said ("Storrito" → "Store-ritto" only if it keeps going wrong) and run voice again; only that line is spoken again.
Place each line in the root as <audio id="vo-<id>" src="assets/voice/<id>.mp3" data-start="<s>" data-duration="<its seconds>" data-track-index="<n>">, the beat that shows it starting on the word that says it (voice.json has every word's time in its line). Then ${cmd(`captions ${rel(work)} ${rel(composition)} --style <style>`)} when the film has captions.`);
}

// every <audio> of the film with its start on the film's clock, as HyperFrames itself resolves it
// (a start relative to another clip, "intro + 0.5", a clip inside a scene)
function audioClips(composition) {
  return mediaClips(composition).filter((c) => c.kind === "audio");
}

// every <audio> and <video> of the film, the same way
function mediaClips(composition) {
  const cli = hyperframesCli();
  if (!cli) fail("✗ No HyperFrames CLI on this machine: the operator installs it.");
  const r = spawnSync(...run(cli, ["timeline", path.resolve(composition), "--json"]), { encoding: "utf8", env: hfEnv(), maxBuffer: 64 << 20, timeout: 300e3 });
  let j;
  try { j = JSON.parse(r.stdout); } catch { fail(`✗ HyperFrames' timeline did not answer: ${(r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" ")}`); }
  const clips = [];
  const walk = (x) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== "object") return;
    if ((x.kind === "audio" || x.kind === "video") && x.src && Number.isFinite(x.absStart)) clips.push(x);
    Object.values(x).forEach(walk);
  };
  walk(j.timeline);
  // a clip the timeline lists in its track's rows and again on its own is one clip
  const seen = new Set();
  return clips.filter((c) => { const k = `${c.kind}|${c.elementId || c.id}|${c.src}|${c.absStart}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ------------------------------------------------------------------------------- a recorded voice

// the words of a recorded voice with their times: best-takes' edit.json, transcribe's words.json or
// any {"words": [{text, start, end}]}; noises and fillers are no words of the line
export function recordedWords(j) {
  const list = Array.isArray(j?.words) ? j.words : null;
  if (!list) return null;
  return list
    .filter((w) => w && (w.kind == null || w.kind === "word") && String(w.text || "").trim() && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end)))
    .map((w) => ({ text: String(w.text).trim(), start: +Number(w.start).toFixed(3), end: +Number(w.end).toFixed(3) }));
}

// a voice the person recorded (cut by best-takes, or any file with its words timed) as a line of the
// film's voice, so that words, captions, music and check take it as they take a spoken line
function cmdNarration(work, file, wordsFile, composition, opts) {
  if (!work || !file || !wordsFile || !composition) fail(`Usage: ${cmd("narration <work> <voice file> <its words.json> <composition> [--id narration]")}`);
  if (!fs.existsSync(file)) fail(`✗ There is no ${rel(file)}.`);
  const words = recordedWords(readJson(wordsFile, null));
  if (!words) fail(`✗ ${rel(wordsFile)} has no "words": [{text, start, end}] (best-takes' edit.json, transcribe's words.json).`);
  if (!words.length) fail(`✗ ${rel(wordsFile)} has no words with their times.`);
  const id = String(opts.id || "narration");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail(`✗ --id is lowercase letters, digits and dashes ("narration"); "${id}" is not one.`);
  const p = probe(file);
  if (!p.streams.some((s) => s.codec_type === "audio")) fail(`✗ ${rel(file)} has no sound.`);
  const duration = +p.duration.toFixed(3);
  if (words.at(-1).end > duration + 0.25) fail(`✗ The words of ${rel(wordsFile)} run to ${words.at(-1).end.toFixed(2)} s, the voice is ${duration.toFixed(2)} s long: they are not this voice's (the words of the cut, timed in the cut).`);
  const ext = (path.extname(file).slice(1) || "m4a").toLowerCase();
  const dir = path.join(composition, "assets", "voice");
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${id}.${ext}`);
  // without the file's tags: what is published names no place
  ffmpeg(["-i", file, "-map", "0:a", "-map_metadata", "-1", "-c", "copy", dest]);
  const metaFile = path.join(work, "voice.json");
  const before = readJson(metaFile, {});
  const line = { id, recorded: true, text: words.map((w) => w.text).join(" "), file: `assets/voice/${id}.${ext}`, duration, words };
  const lines = [...(before.lines || []).filter((l) => l.id !== id), line];
  writeJson(metaFile, { ...before, lines });
  const v = loudness([dest]);
  console.log(`${rel(dest)}: the recorded voice, ${duration.toFixed(2)} s, ${words.length} words with their times${v == null ? "" : `, ${lufs(v)} LUFS`} → ${rel(metaFile)} (line "${id}").`);
  let gaps;
  try { gaps = gapSpecs(opts.gap); } catch (e) { fail(`✗ ${e.message}.`); }
  if (!gaps.length) {
    console.log(`Place it in the root as <audio id="vo-${id}" src="${line.file}" data-start="0" data-duration="${duration}" data-track-index="<n>">: the voice is the film's clock, each beat starts on the word that says it (voice.json has every word's time in the voice; ${cmd(`words ${rel(work)} ${rel(composition)}`)} puts them on the film's clock once it is placed). Then music, ${cmd(`level ${rel(work)} ${rel(composition)}`)} and captions as for a spoken voice.`);
    return;
  }
  const { pieces, footage } = splitVoice(words, duration, gaps);
  console.log(`The voice stops for ${footage.length} piece${footage.length > 1 ? "s" : ""} of footage with its own sound: place it in the root as ${pieces.length} <audio> of the same file, one after the other, each footage in the gap it leaves:`);
  pieces.forEach((p, k) => {
    console.log(`  <audio id="vo-${id}-${k + 1}" src="${line.file}" data-start="${p.start}" data-media-start="${p.mediaStart}" data-duration="${p.duration}" data-track-index="<n>">   "${p.first} … ${p.last}"`);
    const f = footage[k];
    if (f) console.log(`    footage ${k + 1}: data-start="${f.start}" data-duration="${f.duration}" (after "${f.after}", ${f.lead} s after the voice stops, the voice again ${f.lead} s after it ends): a <video> with data-has-audio="true", or an <audio> beside a muted <video>`);
  });
  console.log(`The film is then ${pieces.at(-1).start + pieces.at(-1).duration} s of voice and footage. ${cmd(`words ${rel(work)} ${rel(composition)}`)} puts every word on the film's clock as the root places the pieces; the captions show nothing while the footage plays (the voice says nothing there), and ${cmd(`level ${rel(work)} ${rel(composition)}`)} takes the music out under footage that plays its own sound. Then music, level and captions as for a spoken voice.`);
}

// "45.7+9.4, 101+9.4": where the voice stops (seconds of the voice: after the last word that ends
// by then) and how long the footage plays in the gap
export function gapSpecs(text) {
  if (text == null || text === true || /^\s*$/.test(String(text))) return [];
  return String(text).split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)$/);
    if (!m || !(Number(m[2]) > 0)) throw new Error(`--gap takes "<seconds of the voice>+<seconds of footage>" separated by commas ("45.7+9.4,101+15"); "${s}" is not one`);
    return { at: Number(m[1]), length: Number(m[2]) };
  }).sort((a, b) => a.at - b.at);
}

// the voice cut into pieces around the gaps, each cut in the pause after the last word that ends
// by the gap's time (a quarter second after that word, or half the pause when it is shorter), the
// footage `lead` s after the voice stops and the voice again `lead` s after the footage ends
export function splitVoice(words, duration, gaps, { lead = 0.25 } = {}) {
  const r = (x) => +x.toFixed(3);
  const pieces = [], footage = [];
  let from = 0, start = 0;
  for (const g of gaps) {
    const k = words.findLastIndex((w) => w.end <= g.at + 0.05);
    if (k < 0) throw new Error(`no word ends by ${g.at} s of the voice: a gap goes after a word`);
    const next = words[k + 1];
    if (!next) throw new Error(`the gap at ${g.at} s comes after the last word: end the film with the footage instead`);
    const cut = r(words[k].end + Math.min(0.25, (next.start - words[k].end) / 2));
    if (cut <= from) throw new Error(`two gaps after the same word ("${words[k].text}", ${words[k].end} s)`);
    const piece = words.filter((w) => w.start >= from && w.end <= cut);
    pieces.push({ start: r(start), mediaStart: r(from), duration: r(cut - from), first: piece[0]?.text, last: piece.at(-1)?.text });
    start = r(start + (cut - from));
    footage.push({ start: r(start + lead), duration: g.length, after: words[k].text, lead });
    start = r(start + lead + g.length + lead);
    from = cut;
  }
  const rest = words.filter((w) => w.start >= from);
  pieces.push({ start, mediaStart: from, duration: r(duration - from), first: rest[0]?.text, last: rest.at(-1)?.text });
  return { pieces, footage };
}

// ------------------------------------------------------------------------------- the music's level

const dbToGain = (db) => 10 ** (db / 20);
const RISE = 8, LONG_PAUSE = 1;

// the music's volume lane along the voice: `low` (a share of the track's volume) while the voice
// speaks and through pauses shorter than `pause`; 1 in a pause of `pause` s or more, before the first
// word when it comes that late, and after the last word. Times on the music clip's clock.
export function musicLane(words, { start = 0, duration, low, pause = LONG_PAUSE }) {
  const pts = [];
  const add = (t, v) => {
    const x = +Math.max(0, Math.min(duration, t - start)).toFixed(3);
    if (pts.length && x < pts.at(-1).t) return;
    if (pts.length && x === pts.at(-1).t) pts.at(-1).v = v; else pts.push({ t: x, v });
  };
  const sorted = [...words].sort((a, b) => a.start - b.start);
  if (!sorted.length) return [{ t: 0, v: 1 }];
  // up after a word has died away, down before the next one begins
  const up = (from, to) => { const room = to - from; return [Math.min(0.5, room * 0.4), Math.min(0.4, room * 0.4)]; };
  const first = sorted[0].start;
  if (first - start >= pause) {
    add(start, 1);
    add(first - 0.5, 1);
    add(first - 0.15, low);
  } else add(start, low);
  // a pause next to footage (`footage: true`, where `level` takes the music out) never brings it up:
  // it would swell for a moment between the voice and the footage's own sound
  let end = sorted[0].end, beside = !!sorted[0].footage;
  for (const w of sorted.slice(1)) {
    if (w.start - end >= pause && !beside && !w.footage) {
      const a = end + 0.15, b = w.start - 0.2, [r, f] = up(a, b);
      add(a, low); add(a + r, 1); add(b - f, 1); add(b, low);
    }
    if (w.end >= end) beside = !!w.footage;
    end = Math.max(end, w.end);
  }
  add(end + 0.15, low);
  add(end + 1, 1);
  return pts;
}

// the lane's value at a time on its clock (straight between its points)
const laneAt = (pts, t) => {
  if (t <= pts[0].t) return pts[0].v;
  for (let k = 1; k < pts.length; k++) if (t <= pts[k].t) {
    const a = pts[k - 1], b = pts[k];
    return b.t === a.t ? b.v : +(a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t)).toFixed(4);
  }
  return pts.at(-1).v;
};

// the music out while footage plays its own sound: down to 0 over `ramp` s before each stretch
// (on the music's clock), 0 through it, back over `ramp` s after it to where the lane would be
export function duckLane(pts, spans, { ramp = 0.3 } = {}) {
  let out = pts.map((p) => ({ ...p }));
  for (const [s, e] of [...spans].sort((a, b) => a[0] - b[0])) {
    const a = Math.max(0, s - ramp), b = e + ramp;
    const before = laneAt(out, a), after = laneAt(out, b);
    out = [...out.filter((p) => p.t < a), { t: +a.toFixed(3), v: before }, { t: +s.toFixed(3), v: 0 }, { t: +e.toFixed(3), v: 0 }, { t: +b.toFixed(3), v: after }, ...out.filter((p) => p.t > b)];
  }
  // a point at the same time as the one before: the later wins
  return out.filter((p, k) => k + 1 === out.length || out[k + 1].t !== p.t);
}

// the film's footage that plays its own sound: every <video> HyperFrames places that is not muted,
// not at volume 0 and whose file has sound, and every <audio> that is neither the music nor a line
// of the voice nor marked data-sfx (a sound effect rides on the music, it does not stop it)
function footageWithSound(composition, html, clips) {
  const tagOf = (id) => (id ? (html.match(new RegExp(`<(?:video|audio)\\b[^>]*\\bid\\s*=\\s*["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`, "i")) || [])[0] || "" : "");
  return clips.filter((c) => {
    if (!Number.isFinite(c.absStart) || !(Number(c.duration) > 0) || !c.src) return false;
    const tag = tagOf(c.elementId || c.id);
    if (/\smuted\b/i.test(tag) || /\sdata-sfx\b/i.test(tag) || Number(c.volume) === 0) return false;
    if (c.kind === "audio" && (c.id === "music" || /(^|\/)music\.\w+$/.test(String(c.src)) || /^(\.\/)?assets\/voice\//.test(String(c.src)) || String(c.id).startsWith("vo-"))) return false;
    const file = path.join(composition, String(c.src).replace(/^\.?\//, ""));
    return fs.existsSync(file) && probe(file).streams.some((s) => s.codec_type === "audio");
  }).map((c) => ({ id: c.elementId || c.id, src: c.src, start: Number(c.absStart), end: Number(c.absStart) + Number(c.duration) }));
}

// the music's end against the voice's last word: a fade-out right after it (the one `music` bakes
// into the file, or the film ending there) leaves the lane no room to come up at the end
export function endWarning(lastWord, musicEnd, filmEnd) {
  const end = Math.min(musicEnd, filmEnd), room = end - lastWord;
  if (room >= 2.5) return null;
  return `! The music ${musicEnd <= filmEnd ? "ends" : "is cut off by the film's end"} ${room.toFixed(1)} s after the last word: its fade swallows the rise there. End the film about 3 s after the last word (the root's data-duration, the music's data-duration and data-fade-out with it; music made with --seconds of that length), then level again.`;
}

// the <audio id="music"> tag of a root, and its volume lane when it has one
export function musicTag(html) {
  const tag = (html.match(/<audio\b[^>]*>/gi) || []).find((t) => /\bid\s*=\s*["']music["']/i.test(t));
  if (!tag) return null;
  const raw = tag.match(/\sdata-automation\s*=\s*(["'])(.*?)\1/is)?.[2];
  let lane = null;
  if (raw) {
    try { lane = JSON.parse(raw.replace(/&quot;/g, '"')).lanes?.find((l) => l.target === "volume")?.points || null; } catch { lane = null; }
  }
  return { tag, lane };
}

// the share of the music's volume while the voice speaks: the lowest point of its lane
// (0 is footage playing its own sound, where the music is out: no level under the voice)
const speaking = (lane) => {
  const v = (lane || []).map((p) => Number(p.v)).filter((x) => x > 0);
  return v.length ? Math.min(...v) : 1;
};

function cmdLevel(work, composition, opts) {
  if (!work || !composition) fail(`Usage: ${cmd("level <work> <composition> [--rise 8] [--pause 1] [--under 17]")}`);
  const rise = opts.rise == null ? RISE : Number(opts.rise), pause = opts.pause == null ? LONG_PAUSE : Number(opts.pause);
  if (!(rise >= 0 && rise <= 20)) fail("✗ --rise is how many dB the music comes up in a long pause, 0 to 20.");
  if (!(pause >= 0.5 && pause <= 10)) fail("✗ --pause is the shortest pause in seconds the music comes up in, 0.5 to 10.");
  const root = rootOf(composition);
  const found = musicTag(root.html);
  if (!found) fail(`✗ ${rel(root.file)} has no <audio id="music">: ${cmd(`music ${rel(work)} ${rel(composition)} --prompt "…" --seconds <s>`)} first, and place it.`);
  const media = mediaClips(composition);
  const clip = media.find((c) => c.kind === "audio" && (c.id === "music" || /(^|\/)music\.\w+$/.test(String(c.src))));
  const { words } = filmWords(work, composition);
  const footage = footageWithSound(composition, root.html, media);
  if (!words.length) fail(`✗ No line of the voice is placed in ${rel(root.file)}: nothing to lay the music under.`);
  const { music, voice } = inFilm(composition);
  const m = loudness([music.file]), v = loudness(voice.filter((x) => fs.existsSync(x.file)));
  if (m == null || v == null) fail(`✗ The ${m == null ? "music" : "voice"} is silent: nothing to level by.`);
  const under = Number(opts.under) || music.under || UNDER;
  const fit = musicVolume(v, m, under);
  // the track's volume is its level in a pause; the lane takes it down while the voice speaks
  const volume = Math.min(3.98, +(fit.volume * dbToGain(rise)).toFixed(3));
  const low = +(fit.volume / volume).toFixed(4);
  const start = Number(clip?.absStart) || 0;
  const duration = Number(clip?.duration) || root.duration;
  // footage with its own sound counts as speech for the pauses (no rise into it or out of it) and
  // takes the music out while it plays
  const spans = footage.map((f) => [f.start, f.end]);
  const points = duckLane(musicLane([...words, ...footage.map((f) => ({ ...f, footage: true }))], { start, duration, low, pause }), spans.map(([a, b]) => [a - start, b - start]));
  if (points.length > 512) fail(`✗ ${points.length} points: more than a lane holds (512). A longer --pause gives fewer.`);
  const lane = JSON.stringify({ version: 1, lanes: [{ target: "volume", points }] }).replace(/"/g, "&quot;");
  let tag = found.tag.replace(/\sdata-automation\s*=\s*(["']).*?\1/is, "").replace(/\sdata-volume\s*=\s*(["']).*?\1/i, "").replace(/\sdata-under-voice\s*=\s*(["']).*?\1/i, "");
  tag = tag.replace(/^<audio\b/i, `<audio data-volume="${volume}" data-under-voice="${under}" data-automation="${lane}"`);
  fs.writeFileSync(root.file, root.html.replace(found.tag, tag));
  if (footage.length) console.log(`The music is out while ${footage.length} piece${footage.length > 1 ? "s" : ""} of footage play${footage.length > 1 ? "" : "s"} ${footage.length > 1 ? "their" : "its"} own sound (${footage.map((f) => `${f.id || f.src} ${f.start.toFixed(2)}–${f.end.toFixed(2)} s`).join(", ")}): down over 0.3 s before, back over 0.3 s after. A <video> or <audio> that should play under the music instead is muted, or a sound effect marked data-sfx.`);
  const rises = points.filter((p, k) => p.v === 1 && (k === 0 || points[k - 1].v !== 1)).length;
  console.log(`<audio id="music"> in ${rel(root.file)}: ${lu(fit.under)} LU under the voice while it speaks and through pauses under ${pause} s (data-volume ${volume} × ${low}), ${rise} dB up in ${rises} stretch${rises === 1 ? "" : "es"} without voice (pauses of ${pause} s or more${points[0].v === 1 ? ", before the first word" : ""}, after the last word): a volume lane of ${points.length} points, not a compressor, so the music never moves while the voice speaks.
Measured, not heard: say so. Run it again after the voice or the music moved; ${cmd(`check ${rel(work)} ${rel(composition)}`)} measures the distance as placed.`);
  const late = endWarning(Math.max(...words.map((w) => w.end)), start + duration, root.duration);
  if (late) console.log(late);
}

// the voice's words at their times in the film: each line where the film's <audio> plays it
function filmWords(work, composition) {
  const meta = readJson(path.join(work, "voice.json"), null) || fail(`✗ No voice yet: ${cmd(`voice ${rel(work)} <script.json> ${rel(composition)}`)} first.`);
  const root = rootOf(composition);
  const clips = audioClips(composition);
  const words = [], missing = [];
  for (const l of meta.lines) {
    const mine = clips.filter((c) => String(c.src || "").replace(/^\.?\//, "") === l.file);
    if (!mine.length) { missing.push(l.id); continue; }
    // every place the line plays (a line may play twice), at its speed
    for (const c of mine) {
      const rate = Number(c.playbackRate) || 1, from = Number(c.mediaStart) || 0;
      const until = Number.isFinite(Number(c.duration)) ? from + Number(c.duration) * rate : Infinity;
      for (const w of l.words) if (w.start >= from && w.start < until)
        words.push({ text: w.text, start: +(c.absStart + (w.start - from) / rate).toFixed(3), end: +(c.absStart + (Math.min(w.end, until) - from) / rate).toFixed(3) });
    }
  }
  words.sort((a, b) => a.start - b.start);
  return { words, missing, root };
}

function cmdWords(work, composition) {
  if (!work || !composition) fail(`Usage: ${cmd("words <work> <composition>")}`);
  const { words, missing, root } = filmWords(work, composition);
  if (missing.length) console.log(`  not in the film (no <audio src="assets/voice/<id>.mp3">): ${missing.join(", ")}`);
  if (!words.length) fail(`✗ No line of the voice is placed in ${rel(root.file)}.`);
  const f = path.join(work, "words.json");
  // the key words marked before stay marked, as long as the words are the same
  const old = readJson(f, {}).words || [];
  if (old.map((w) => w.text).join(" ") === words.map((w) => w.text).join(" ")) old.forEach((w, k) => { if (w.highlight) words[k].highlight = true; });
  writeJson(f, { width: root.width, height: root.height, duration: root.duration, words });
  console.log(`${rel(f)}: ${words.length} words, ${words[0].start.toFixed(2)}–${words.at(-1).end.toFixed(2)} s of the film`);
  return f;
}

function captionsTool() {
  const candidates = [process.env.CAPTIONS_TOOL, path.join(SKILL, "..", "captions", "tools", "captions.mjs"), "/home/sprite/skills/captions/tools/captions.mjs"];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

// "12.4-15.8, 160-168" → [[12.4, 15.8], [160, 168]]: the stretches of the film the captions pause in
export function pauseSpans(text) {
  if (text == null || text === true) return null;
  if (/^\s*none\s*$/i.test(String(text))) return [];
  const spans = String(text).split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
    if (!m || !(Number(m[2]) > Number(m[1]))) throw new Error(`--pause takes stretches of the film in seconds, "<from>-<to>" separated by commas ("12.4-15.8,160-168"), or "none"; "${s}" is not one`);
    return [Number(m[1]), Number(m[2])];
  });
  return spans.sort((a, b) => a[0] - b[0]);
}

// the words the captions show: none said inside a stretch where the picture carries the same words
export function captionWords(words, spans = []) {
  const inside = (w) => spans.some(([a, b]) => w.start >= a - 0.05 && w.start < b);
  return words.filter((w) => !inside(w));
}

function cmdCaptions(work, composition, opts) {
  if (!work || !composition) fail(`Usage: ${cmd("captions <work> <composition> --style <a style of captions: hormozi, bold, karaoke, clean, …> [--mark] [--product <name>] [--brand brand/DESIGN.md] [--pause <from>-<to>,…] [--follow] [--edge]")}`);
  const tool = captionsTool();
  if (!tool) fail("✗ The captions need agentitos' captions skill beside this one (or CAPTIONS_TOOL naming its tools/captions.mjs).");
  let spans;
  try { spans = pauseSpans(opts.pause); } catch (e) { fail(`✗ ${e.message}.`); }
  const file = cmdWords(work, composition);
  const run = (args) => {
    const r = spawnSync(process.execPath, [tool, ...args], { encoding: "utf8" });
    process.stdout.write(r.stdout.replace(/^Next: .*\n?/gm, ""));
    if (r.status) fail(`✗ ${(r.stderr || "").trim()}`);
  };
  if (opts.mark) run(["mark", file, ...(opts.product ? ["--product", String(opts.product)] : [])]);
  const launchFile = path.join(work, "launch.json"), saved = readJson(launchFile, {});
  // the pauses stay for the next build until --pause names others (or "none")
  if (spans) writeJson(launchFile, { ...saved, captionPauses: spans });
  const pauses = spans || saved.captionPauses || [];
  const ids = saved.platforms || [];
  const brand = opts.brand || (fs.existsSync("brand/DESIGN.md") ? "brand/DESIGN.md" : null);
  let shown = file;
  if (pauses.length) {
    const all = readJson(file);
    const kept = captionWords(all.words, pauses);
    shown = path.join(work, "captions.words.json");
    writeJson(shown, { ...all, words: kept });
    console.log(`The captions pause in ${pauses.map(([a, b]) => `${a}–${b} s`).join(", ")}: ${all.words.length - kept.length} word${all.words.length - kept.length === 1 ? "" : "s"} the picture carries are left out (${rel(shown)}).`);
  }
  run(["build", shown, path.join(composition, "captions"), "--style", String(opts.style || "hormozi"), ...(ids.length ? ["--platform", ids.join(",")] : []), ...(brand ? ["--brand", brand] : []), ...(opts.follow ? ["--follow"] : []), ...(opts.edge ? ["--edge"] : [])]);
  console.log(`Mount it once, as the root's last child; build captions again after moving a line of the voice (it reads where the root places them).`);
}

// ------------------------------------------------------------------------------- music

// the kind of a file by its first bytes
function kindOf(bytes) {
  const head = bytes.subarray(0, 12).toString("latin1");
  if (head.startsWith("RIFF")) return "wav";
  if (head.startsWith("fLaC")) return "flac";
  if (head.startsWith("OggS")) return "ogg";
  if (head.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "mp3";
  if (head.slice(4, 8) === "ftyp") return "m4a";
  return null;
}

// the <audio> of the music and a sentence on its volume: measured against the voice's lines when
// the film has a voice (launch-video's `voice` wrote them), else the guide's level without one
export function musicElement(work, composition, out, len, under) {
  const element = (volume, tail = "") => `<audio id="music" src="assets/music.mp3" data-start="0" data-duration="${len.toFixed(2)}" data-volume="${volume}"${tail} data-track-index="<n>">`;
  const without = `In the root: ${element(0.6)} (about 0.6 without a voice; a voice made later: \`check\` says the volume that lays the music ${under} LU under it).`;
  const lines = (readJson(path.join(work, "voice.json"), {}).lines || []).map((l) => path.join(composition, l.file)).filter((f) => fs.existsSync(f));
  if (!lines.length) return without;
  const v = loudness(lines), m = loudness([out]);
  if (v == null || m == null) return `${without}\n  ! The ${v == null ? "voice" : "music"} is silent: nothing to measure the music's volume by.`;
  const fit = musicVolume(v, m, under);
  const bound = fit.bound ? `, the ${fit.bound} volume here, it sits ${lu(fit.under)} LU under it, not ${under} (that would need ${fit.need.toFixed(3)})` : ` it sits ${under} LU under it`;
  return `In the root: ${element(fit.volume, ` data-under-voice="${under}"`)}. The voice is at ${lufs(v)} LUFS, the music at ${lufs(m)}: at ${fit.volume}${bound}. Moved, changed or another volume: \`check\` measures it as the film places it.`;
}

async function cmdMusic(work, composition, opts) {
  const seconds = Number(opts.seconds);
  if (!work || !composition || !opts.prompt || !(seconds > 0)) fail(`Usage: ${cmd('music <work> <composition> --prompt "<the feel, the tempo, the instruments>" --seconds <the film\'s length> [--under 17]')}`);
  const under = opts.under == null ? UNDER : Number(opts.under);
  if (!(under >= 3 && under <= 30)) fail(`✗ --under is how many LU the music lies under the voice, 3 to 30 (${UNDER} by default).`);
  const model = opts.model || (seconds <= 28 ? MUSIC_MODELS.clip : MUSIC_MODELS.pro);
  const prompt = `${opts.prompt}. ${opts.vocals ? "" : "Instrumental, no vocals. "}About ${Math.round(seconds)} seconds long, with a clear ending.`;
  console.log(`Composing with ${model} (a minute or two) …`);
  let r;
  try { r = await streamAudio(`The music (${model})`, { model, modalities: ["text", "audio"], messages: [{ role: "user", content: prompt }] }, { log: console.log, timeout: 600e3, tries: 2 }); }
  catch (e) { fail(`✗ ${e.message}`); }
  const kind = kindOf(r.bytes);
  if (!kind) fail(`✗ ${model} sent ${r.bytes.length} bytes, but no audio${r.text ? `: "${r.text.slice(0, 200)}"` : ""}.`);
  const raw = path.join(work, `music-raw.${kind}`);
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(raw, r.bytes);
  const long = probe(raw).duration;
  const out = path.join(composition, "assets", "music.mp3");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // as long as the film, faded over its last 1.5 s; shorter music stays as it is
  const len = Math.min(long, seconds), fade = Math.min(1.5, len / 4);
  ffmpeg(["-i", raw, "-t", String(len), "-af", `afade=t=out:st=${(len - fade).toFixed(3)}:d=${fade.toFixed(3)}`, "-codec:a", "libmp3lame", "-b:a", "192k", out]);
  console.log(`${rel(out)}: ${len.toFixed(1)} s of ${long.toFixed(1)} s made${r.cost ? `, $${r.cost.toFixed(3)}` : ""}${long < seconds - 0.5 ? ` — shorter than the film by ${(seconds - long).toFixed(1)} s: loop it, end the film with it, or make it again` : ""}${r.text ? `\n  the model: "${r.text.slice(0, 200).replace(/\s+/g, " ")}"` : ""}
The whole take is ${rel(raw)}. ${musicElement(work, composition, out, len, under)} Once it is there, its beats: \`${cliCommand()} beats ${rel(composition)}\`; land the payoff and the mark on strong ones.`);
}

// ------------------------------------------------------------------------------- pictures

async function cmdImage(out, opts) {
  if (!out || !opts.prompt) fail(`Usage: ${cmd('image <out.png> --prompt "…" [--ratio 9:16] [--ref <image>]…')}`);
  const model = opts.model || IMAGE_MODEL;
  const refs = (opts.ref || []).map((f) => {
    if (!fs.existsSync(f)) fail(`✗ There is no ${f}.`);
    const ext = path.extname(f).slice(1).toLowerCase().replace("jpg", "jpeg");
    return { type: "image_url", image_url: { url: `data:image/${ext};base64,${fs.readFileSync(f).toString("base64")}` } };
  });
  const both = /^(google\/gemini|openai\/gpt-5)/.test(model);
  let j;
  try {
    j = await post(`The picture (${model})`, "/chat/completions", {
      model, modalities: both ? ["image", "text"] : ["image"],
      messages: [{ role: "user", content: [{ type: "text", text: opts.prompt }, ...refs] }],
      ...(opts.ratio ? { image_config: { aspect_ratio: String(opts.ratio) } } : {}),
    }, { log: console.log });
  } catch (e) { fail(`✗ ${e.message}`); }
  const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) fail(`✗ ${model} made no picture${j.choices?.[0]?.message?.content ? `: "${String(j.choices[0].message.content).slice(0, 200)}"` : ""}.`);
  const m = url.match(/^data:image\/(\w+);base64,(.*)$/s);
  const bytes = m ? Buffer.from(m[2], "base64") : Buffer.from(await (await fetch(url)).arrayBuffer());
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const tmp = `${out}.download`;
  fs.writeFileSync(tmp, bytes);
  try { ffmpeg(["-i", tmp, "-frames:v", "1", "-update", "1", out]); } finally { fs.rmSync(tmp, { force: true }); }
  const v = probe(out).streams.find((s) => s.codec_type === "video");
  console.log(`${rel(out)}: ${v?.width}×${v?.height}${j.usage?.cost ? `, $${j.usage.cost.toFixed(3)}` : ""}. Look at it before using it: a made picture never stands in for the product's own screens or logo.`);
}

// ------------------------------------------------------------------------------- the video

function cmdFinish(video) {
  if (!video || !fs.existsSync(video)) fail(`Usage: ${cmd("finish <video.mp4>")} (the rendered video)`);
  const p = probe(video);
  if (!p.streams.some((s) => s.codec_type === "audio")) return console.log(`${rel(video)}: no sound, nothing to level.`);
  // measured first, then levelled to it in a second pass: one pass pumps on a short film
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", video, "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"], { encoding: "utf8" });
  const m = JSON.parse(r.stderr.slice(r.stderr.lastIndexOf("{"), r.stderr.lastIndexOf("}") + 1) || "{}");
  if (!m.input_i) fail(`✗ ffmpeg could not measure the loudness of ${rel(video)}.`);
  // a silent track (the render mixes silence when the film has no sound) has nothing to level
  if (!(Number(m.input_i) > -70)) return console.log(`${rel(video)}: its sound is silent, nothing to level.`);
  // hidden beside it, so a half-written file never shows as an artifact
  const tmp = path.join(path.dirname(video), `.${path.basename(video, path.extname(video))}.levelled.mp4`);
  try {
    ffmpeg(["-i", video, "-map", "0", "-map_metadata", "-1", "-c:v", "copy", "-af",
      `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`,
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", tmp]);
    fs.renameSync(tmp, video);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  console.log(`${rel(video)}: ${Number(m.input_i).toFixed(1)} → −14 LUFS, peaks under −1 dBTP. Measured, not heard: say so.`);
}

// ------------------------------------------------------------------------------- main

// run as a program; imported (by tools/test.mjs), it only lends its functions
const [command, ...rest] = process.argv.slice(2);
const [pos, opts] = parse(rest);
const isMain = (() => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) try {
  if (command === "guides") cmdGuides();
  else if (command === "zones") cmdZones(pos[0], pos.slice(1), opts);
  else if (command === "check") cmdCheck(pos[0], pos[1]);
  else if (command === "draw") cmdDraw(pos[0], pos[1]);
  else if (command === "board") cmdBoard(pos[0], pos[1], opts);
  else if (command === "fill") cmdFill(pos[0], pos[1]);
  else if (command === "voices") await cmdVoices(opts);
  else if (command === "sample") await cmdSample(pos[0], opts);
  else if (command === "voice") await cmdVoice(pos[0], pos[1], pos[2], opts);
  else if (command === "narration") cmdNarration(pos[0], pos[1], pos[2], pos[3], opts);
  else if (command === "level") cmdLevel(pos[0], pos[1], opts);
  else if (command === "words") cmdWords(pos[0], pos[1]);
  else if (command === "captions") cmdCaptions(pos[0], pos[1], opts);
  else if (command === "music") await cmdMusic(pos[0], pos[1], opts);
  else if (command === "image") await cmdImage(pos[0], opts);
  else if (command === "finish") cmdFinish(pos[0]);
  else fail(`${cmd("guides | zones <work> [platform…] | check <work> <composition> | draw <work> <stills> | board <work> <stills> | fill <work> <stills> | voices | sample <work> | voice <work> <script.json> <composition> | narration <work> <voice> <words.json> <composition> | words <work> <composition> | captions <work> <composition> | music <work> <composition> | level <work> <composition> | image <out.png> | finish <video.mp4>")}   (options: the head of ${self()})`);
} catch (e) {
  fail(`✗ ${e.message}`);
}
