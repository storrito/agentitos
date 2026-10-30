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
//                                                         when and where (HyperFrames' check, per band)
//   node tools/launch.mjs draw <work> <stills-folder>     the zones drawn over every still → <folder>/zones/
//   node tools/launch.mjs voices [--model <id>]           the speech models, their price and voices
//   node tools/launch.mjs sample <work> --text "…" --voices a,b [--model <id>] [--out <folder>]
//                                                         one line in a few voices, to choose by ear
//   node tools/launch.mjs voice <work> <script.json> <composition>   every line spoken → <composition>/
//                                                         assets/voice/<id>.mp3, its words timed → <work>/voice.json
//   node tools/launch.mjs words <work> <composition>      the voice's words at their times in the film,
//                                                         as the film's <audio> places the lines → <work>/words.json
//   node tools/launch.mjs captions <work> <composition> --style hormozi|karaoke|wipe|clean [--mark]
//                                                         the captions (agentitos' captions skill) in
//                                                         <composition>/captions, and the line that mounts them
//   node tools/launch.mjs music <work> <composition> --prompt "…" --seconds 30   music (Lyria 3)
//                                                         → <composition>/assets/music.mp3, faded at its end
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

// options that take no value
const FLAGS = ["mark", "vocals", "json"];

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
  // a line taken out of the script: its file goes too
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".mp3") && !ids.has(f.slice(0, -4))) fs.rmSync(path.join(dir, f));
  writeJson(metaFile, { model, voice, ...(speed ? { speed } : {}), lines: done.map(({ kept, failed, ...l }) => l) });
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
  const cli = hyperframesCli();
  if (!cli) fail("✗ No HyperFrames CLI on this machine: the operator installs it.");
  const r = spawnSync(...run(cli, ["timeline", path.resolve(composition), "--json"]), { encoding: "utf8", env: hfEnv(), maxBuffer: 64 << 20, timeout: 300e3 });
  let j;
  try { j = JSON.parse(r.stdout); } catch { fail(`✗ HyperFrames' timeline did not answer: ${(r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" ")}`); }
  const clips = [];
  const walk = (x) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== "object") return;
    if (x.kind === "audio" && x.src && Number.isFinite(x.absStart)) clips.push(x);
    Object.values(x).forEach(walk);
  };
  walk(j.timeline);
  return clips;
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

function cmdCaptions(work, composition, opts) {
  if (!work || !composition) fail(`Usage: ${cmd("captions <work> <composition> --style hormozi|karaoke|wipe|clean [--mark] [--product <name>] [--brand brand/DESIGN.md]")}`);
  const tool = captionsTool();
  if (!tool) fail("✗ The captions need agentitos' captions skill beside this one (or CAPTIONS_TOOL naming its tools/captions.mjs).");
  const file = cmdWords(work, composition);
  const run = (args) => {
    const r = spawnSync(process.execPath, [tool, ...args], { encoding: "utf8" });
    process.stdout.write(r.stdout.replace(/^Next: .*\n?/gm, ""));
    if (r.status) fail(`✗ ${(r.stderr || "").trim()}`);
  };
  if (opts.mark) run(["mark", file, ...(opts.product ? ["--product", String(opts.product)] : [])]);
  const ids = readJson(path.join(work, "launch.json"), {}).platforms || [];
  const brand = opts.brand || (fs.existsSync("brand/DESIGN.md") ? "brand/DESIGN.md" : null);
  run(["build", file, path.join(composition, "captions"), "--style", String(opts.style || "hormozi"), ...(ids.length ? ["--platform", ids.join(",")] : []), ...(brand ? ["--brand", brand] : [])]);
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

async function cmdMusic(work, composition, opts) {
  const seconds = Number(opts.seconds);
  if (!work || !composition || !opts.prompt || !(seconds > 0)) fail(`Usage: ${cmd('music <work> <composition> --prompt "<the feel, the tempo, the instruments>" --seconds <the film\'s length>')}`);
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
The whole take is ${rel(raw)}. In the root: <audio id="music" src="assets/music.mp3" data-start="0" data-duration="${len.toFixed(2)}" data-volume="0.14" data-track-index="<n>"> (0.14 under a voice, as HyperFrames' sound guide says; about 0.6 without one). Once it is there, its beats: \`${cliCommand()} beats ${rel(composition)}\`; land the payoff and the mark on strong ones.`);
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
    ffmpeg(["-i", video, "-map", "0", "-c:v", "copy", "-af",
      `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`,
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", tmp]);
    fs.renameSync(tmp, video);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  console.log(`${rel(video)}: ${Number(m.input_i).toFixed(1)} → −14 LUFS, peaks under −1 dBTP. Measured, not heard: say so.`);
}

// ------------------------------------------------------------------------------- main

const [command, ...rest] = process.argv.slice(2);
const [pos, opts] = parse(rest);
try {
  if (command === "guides") cmdGuides();
  else if (command === "zones") cmdZones(pos[0], pos.slice(1), opts);
  else if (command === "check") cmdCheck(pos[0], pos[1]);
  else if (command === "draw") cmdDraw(pos[0], pos[1]);
  else if (command === "voices") await cmdVoices(opts);
  else if (command === "sample") await cmdSample(pos[0], opts);
  else if (command === "voice") await cmdVoice(pos[0], pos[1], pos[2], opts);
  else if (command === "words") cmdWords(pos[0], pos[1]);
  else if (command === "captions") cmdCaptions(pos[0], pos[1], opts);
  else if (command === "music") await cmdMusic(pos[0], pos[1], opts);
  else if (command === "image") await cmdImage(pos[0], opts);
  else if (command === "finish") cmdFinish(pos[0]);
  else fail(`${cmd("guides | zones <work> [platform…] | check <work> <composition> | draw <work> <stills> | voices | sample <work> | voice <work> <script.json> <composition> | words <work> <composition> | captions <work> <composition> | music <work> <composition> | image <out.png> | finish <video.mp4>")}   (options: the head of ${self()})`);
} catch (e) {
  fail(`✗ ${e.message}`);
}
