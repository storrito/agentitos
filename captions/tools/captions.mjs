#!/usr/bin/env node
// Word-timed captions for videos, as a HyperFrames sub-composition in one of several styles, and as
// an .srt. Made for agents, and for other skills that need captions (best-takes, …): each step
// prints what to do next.
//
//   node tools/captions.mjs styles                        the styles, with what each looks like
//   node tools/captions.mjs transcribe <video> <words.json>   the words said, timed (ElevenLabs
//                                         Scribe through OpenRouter, by agentitos' transcribe skill);
//                                         fillers and doubled words out
//   node tools/captions.mjs mark <words.json>             a model picks the words that stand out
//                                         ("highlight": true on them)
//   node tools/captions.mjs box <words.json> "<phrase>" …   spoken phrases that stand as a card of
//                                         their own: a box, an emoji in front when the phrase
//                                         starts with one ("📏 one foot wide"), its numbers in
//                                         colour. Only what is boxed here gets a box; --drop
//                                         "<phrase>" takes one away, --clear all. Without
//                                         phrases: the boxes there are.
//   node tools/captions.mjs build <words.json> <folder>   the captions as a sub-composition,
//                                         <folder>/index.html, and the clip that mounts it
//   node tools/captions.mjs project <video> <words.json> <composition-folder>   a whole HyperFrames
//                                         project: the video with its captions mounted
//   node tools/captions.mjs srt <words.json> <file.srt>   the captions as a subtitle file
//
// Options: --style hormozi|karaoke|wipe|clean (default hormozi)   --size 1080x1920 (else the video's)
//   --duration <s> (else the last word's end + 1 s)   --brand brand/DESIGN.md (its colour and font)
//   --product "Storrito" (mark: the name to stand out)   --model <OpenRouter id> (mark)
//   --track <n> (build: the mount's track, default 9)
//   --platform reels,tiktok (where the video goes: the captions keep clear of what those apps lay
//   over it, from agentitos' platform-zones skill; none: the usual platforms of the frame)
//   --fit cover|contain (project: a video of another shape than --size fills the frame, cut at its
//   edges, or fits into it with bars; default cover)
//
// words.json: {"words": [{"text": "Hello", "start": 0.12, "end": 0.48, "highlight": true}, …]} or the
// array alone, times in seconds in the video the captions go on. A run of words with the same
// "box" is a card of its own, "icon" on its first word the emoji in front.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { STYLES, style } from "./lib/styles.mjs";
import { writeCaptions, mount, brandOf, ID } from "./lib/render.mjs";
import { srt } from "./lib/srt.mjs";
import { mark, MARK_MODEL } from "./lib/mark.mjs";
import { transcribeFile, transcribeTool, NEEDS_TRANSCRIBE } from "./lib/transcribe.mjs";
import { zones, platformList } from "./lib/zones.mjs";

const fail = (msg) => { console.error(msg); process.exit(1); };
const rel = (p) => path.relative(process.cwd(), p) || ".";
const self = () => (rel(process.argv[1]).startsWith("..") ? process.argv[1] : rel(process.argv[1]));

function parse(args) {
  const pos = [], opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) opts[args[i].slice(2)] = args[i + 1]?.startsWith("--") || args[i + 1] === undefined ? true : args[++i];
    else pos.push(args[i]);
  }
  return [pos, opts];
}

function probe(file) {
  const out = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]).toString());
  const v = out.streams.find((s) => s.codec_type === "video");
  const turned = Math.abs(Number(v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v?.tags?.rotate ?? 0)) % 180 === 90;
  return { duration: Number(out.format.duration), width: turned ? v.height : v.width, height: turned ? v.width : v.height, audio: out.streams.some((s) => s.codec_type === "audio") };
}

const readWords = (file) => {
  if (!fs.existsSync(file)) fail(`There is no ${file}.`);
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  const words = (Array.isArray(j) ? j : j.words || []).filter((w) => w && String(w.text ?? "").trim() && w.end >= w.start);
  if (!words.length) fail(`${file} holds no timed words: {"words": [{"text", "start", "end"}, …]}.`);
  return { doc: Array.isArray(j) ? { words: j } : j, words };
};

const sizeOf = (opts, fallback) => {
  if (!opts.size) return fallback;
  const m = String(opts.size).match(/^(\d+)x(\d+)$/);
  if (!m) fail("--size is width x height, e.g. 1080x1920");
  return [Number(m[1]), Number(m[2])];
};

// Words the voice has no time for: three or more in a row squeezed into under 60 ms each. Scribe
// now and then writes a sentence twice and the copy lands in such a run.
function withoutGhosts(words) {
  const squeezed = (w) => w.end - w.start < 0.06 && w.text.replace(/[^\p{L}\p{N}]/gu, "").length >= 2;
  const drop = new Set();
  for (let i = 0; i < words.length; i++) {
    let j = i;
    while (j < words.length && squeezed(words[j])) j++;
    if (j - i >= 3) for (let k = i; k < j; k++) drop.add(k);
    i = Math.max(i, j);
  }
  return words.filter((_, k) => !drop.has(k));
}

function cmdStyles() {
  for (const [name, s] of Object.entries(STYLES)) console.log(`${name.padEnd(8)} ${s.label}: ${s.about}\n         ${s.look.font} ${s.look.weight}, up to ${s.group.words} words at once`);
  console.log(`\nNext: node ${self()} build <words.json> <folder> --style <name>`);
}

async function cmdTranscribe(video, out) {
  if (!video || !out) fail("Usage: captions.mjs transcribe <video> <words.json>");
  if (!fs.existsSync(video)) fail(`There is no ${video}.`);
  const p = probe(video);
  if (!p.audio) fail(`${video} has no sound to take the words from.`);
  if (!transcribeTool()) fail(NEEDS_TRANSCRIBE);
  let r;
  try { r = await transcribeFile(video, { log: console.log }); } catch (e) { fail(e.message); }
  const heard = r.words;
  const said = heard.filter((w) => w.kind === "word");
  const words = withoutGhosts(said).map(({ text, start, end }) => ({ text, start, end }));
  if (said.length > words.length) console.log(`  ${said.length - words.length} words left out: the voice has no time for them (the recognizer wrote them twice)`);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ asr: r.model, duration: p.duration, width: p.width, height: p.height, words }, null, 1));
  console.log(`${rel(path.resolve(out))}: ${words.length} words, ${heard.length - said.length} fillers and noises left out`);
  console.log(`Next: node ${self()} mark ${rel(path.resolve(out))}`);
}

async function cmdMark(file, opts) {
  if (!file) fail("Usage: captions.mjs mark <words.json>");
  const { doc, words } = readWords(file);
  const r = await mark(words, { model: opts.model || MARK_MODEL, product: opts.product });
  const keys = new Set(r.highlight);
  words.forEach((w, i) => { if (keys.has(i)) w.highlight = true; else delete w.highlight; });
  fs.writeFileSync(file, JSON.stringify({ ...doc, words }, null, 1));
  console.log(`${r.highlight.length} of ${words.length} words stand out (${r.model}, $${r.cost.toFixed(4)}): ${r.highlight.map((i) => words[i].text).join(", ")}`);
  console.log(`Next: node ${self()} build ${rel(path.resolve(file))} <folder> --style <name>`);
}

// Spoken phrases as cards of their own. A phrase is words as they are said; an emoji in front
// of it is its icon. A phrase is one card: the first place it is said that is free; said again,
// the card it has stays (its emoji can change). Words that are only punctuation ("&", "–") do
// not count, in the phrase or in the words.
const bare = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const isEmoji = (t) => /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]️?⃣)/u.test(t) && !/\p{L}/u.test(t) && !/^[#*0-9]+$/.test(t);
function cmdBox(file, phrases, opts) {
  // an option in front of a value swallows it: `--clear <file>` and `--clear "<phrase>"` both mean a plain --clear
  if (typeof opts.clear === "string") {
    if (!file || (fs.existsSync(opts.clear) && !fs.existsSync(file))) { phrases = file ? [file, ...phrases] : phrases; file = opts.clear; } else phrases = [opts.clear, ...phrases];
    opts.clear = true;
  }
  if (!file) fail('Usage: captions.mjs box <words.json> "<phrase>" ["<phrase>" …] [--drop "<phrase>"] [--clear]');
  const { doc, words } = readWords(file);
  const clock = (t) => { const tenths = Math.round(t * 10); return `${Math.floor(tenths / 600)}:${String(Math.floor((tenths % 600) / 10)).padStart(2, "0")}.${tenths % 10}`; };
  const runs = () => {
    const out = [];
    words.forEach((w, i) => { if (w.box && w.box === words[i - 1]?.box) out.at(-1).to = i; else if (w.box) out.push({ from: i, to: i }); });
    return out;
  };
  const listed = () => runs().map((r) => `  ${clock(words[r.from].start)}  ${words[r.from].icon ? `${words[r.from].icon} ` : ""}${words.slice(r.from, r.to + 1).map((w) => w.text).join(" ")}`);
  const say = (none) => { const l = listed(); console.log(l.length ? `${l.length} box(es) in ${rel(path.resolve(file))}:\n${l.join("\n")}` : none); };
  if (!phrases.length && !opts.clear && opts.drop == null) return say(`No boxes in ${rel(path.resolve(file))}: the captions are the style's alone.`);
  if (opts.clear) words.forEach((w) => { delete w.box; delete w.icon; });
  // the words that count, and every place a phrase is said among them: [first word, last word]
  const said = words.map((w, i) => (bare(w.text) ? i : -1)).filter((i) => i >= 0);
  const places = (want) => {
    const out = [];
    for (let s0 = 0; want.length && s0 + want.length <= said.length; s0++) {
      if (want.every((t, k) => bare(words[said[s0 + k]].text) === t)) out.push([said[s0], said[s0 + want.length - 1]]);
    }
    return out;
  };
  const split = (phrase) => {
    const tokens = String(phrase).trim().split(/\s+/).filter(Boolean);
    const icon = tokens.length > 1 && isEmoji(tokens[0]) ? tokens.shift() : null;
    return { icon, want: tokens.map(bare).filter(Boolean), text: tokens.join(" ") };
  };
  const isCard = ([a, z]) => runs().some((r) => r.from === a && r.to === z);
  const missed = [], long = [];
  if (opts.drop != null && opts.drop !== true) {
    const place = places(split(opts.drop).want).find(isCard);
    if (place) for (let i = place[0]; i <= place[1]; i++) { delete words[i].box; delete words[i].icon; }
    else missed.push(`${opts.drop} (no card of these words to take away)`);
  } else if (opts.drop === true) fail('--drop needs the card\'s words: --drop "<phrase>"');
  let next = Math.max(0, ...words.map((w) => Number(w.box) || 0)) + 1;
  for (const phrase of phrases) {
    const { icon, want, text } = split(phrase);
    const all = places(want);
    let place = all.find(isCard);                       // the card it has already
    if (!place) {
      place = all.find(([a, z]) => !words.slice(a, z + 1).some((w) => w.box));
      if (!place) { missed.push(all.length ? `${phrase} (its words are in another card)` : `${phrase} (not said like that; give the words as they are spoken)`); continue; }
      for (let i = place[0]; i <= place[1]; i++) { words[i].box = next; delete words[i].icon; }
      next++;
    }
    if (icon) words[place[0]].icon = icon; else delete words[place[0]].icon;
    if (want.length > 4 || text.length > 26) long.push(phrase);
  }
  fs.writeFileSync(file, JSON.stringify({ ...doc, words }, null, 1));
  say(`No boxes in ${rel(path.resolve(file))} now: the captions are the style's alone.`);
  for (const m of long) console.log(`  long for a card: "${m}"; two to four words read at a glance`);
  for (const m of missed) console.log(`  not done: ${m}`);
  if (missed.length) process.exit(1);
  console.log(`Next: node ${self()} build ${rel(path.resolve(file))} <folder> --style <name> (or project), and look at each box in the preview.`);
}

// for whom the captions are placed, in a sentence
const placedFor = (z) => `Placed clear of ${z.platforms.map((p) => p.name).join(", ")}${z.fallback ? " (no --platform: the usual ones of this frame)" : ""}: the lowest line ends at y ${z.centred[1] + z.centred[3]}, centred on the frame, at most ${z.centred[2]} px wide.`;

function captionsFor(words, folder, opts, size, duration) {
  const s = style(opts.style || "hormozi");
  const brand = opts.brand ? brandOf(opts.brand) : null;
  if (opts.brand && !brand) console.log(`  (no ${opts.brand}: the style's own colours and font)`);
  let z;
  try { z = zones(size[0], size[1], platformList(opts.platform)); } catch (e) { fail(e.message); }
  const r = writeCaptions(folder, { words, style: s, width: size[0], height: size[1], duration, brand, zones: z });
  return { ...r, style: s, brand, zones: z };
}

function cmdBuild(file, folder, opts) {
  if (!file || !folder) fail("Usage: captions.mjs build <words.json> <folder> [--style …] [--size 1080x1920] [--duration s]");
  const { doc, words } = readWords(file);
  const size = sizeOf(opts, doc.width && doc.height ? [doc.width, doc.height] : null) || fail("Give --size (width x height): the words carry no frame size.");
  const duration = Number(opts.duration) || doc.duration || Math.ceil(words.at(-1).end + 1);
  const r = captionsFor(words, path.resolve(folder), opts, size, duration);
  console.log(`${rel(path.resolve(folder))}/index.html: ${r.style.label}, ${words.length} words in ${r.groups} groups, ${size.join("×")}, ${duration.toFixed(1)} s${r.brand?.primary ? `, accent ${r.brand.primary}` : ""}${r.brand?.family ? `, font ${r.brand.family}` : ""}`);
  console.log(placedFor(r.zones));
  console.log(`Mount it in the host composition, inside its root:\n  ${mount({ dir: path.basename(folder), width: size[0], height: size[1], duration, track: Number(opts.track) || 9 })}`);
}

function cmdProject(video, file, folder, opts) {
  if (!video || !file || !folder) fail("Usage: captions.mjs project <video> <words.json> <composition-folder> [--style …]");
  if (!fs.existsSync(video)) fail(`There is no ${video}.`);
  const p = probe(video);
  const { words } = readWords(file);
  const size = sizeOf(opts, [p.width, p.height]);
  const out = path.resolve(folder);
  fs.mkdirSync(path.join(out, "assets"), { recursive: true });
  const asset = path.join(out, "assets", `video${path.extname(video) || ".mp4"}`);
  fs.rmSync(asset, { force: true });
  try { fs.linkSync(path.resolve(video), asset); } catch { fs.copyFileSync(path.resolve(video), asset); }
  const r = captionsFor(words, path.join(out, ID), opts, size, p.duration);
  const title = opts.title || path.basename(video, path.extname(video));
  const fit = opts.fit === "contain" ? "contain" : "cover";
  fs.writeFileSync(path.join(out, "index.html"), `<!doctype html>
<html lang="${opts.lang || "en"}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${size[0]}, height=${size[1]}" />
    <title>${title.replace(/</g, "&lt;")}</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${size[0]}px; height: ${size[1]}px; overflow: hidden; background: #000; }
      #main { position: relative; width: 100%; height: 100%; overflow: hidden; background: #000; }
      #main video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: ${fit}; }
    </style>
  </head>
  <body>
    <!-- generated by agentitos/captions: the video with its captions (${r.style.label}) -->
    <div id="main" data-composition-id="main" data-start="0" data-duration="${p.duration.toFixed(3)}" data-width="${size[0]}" data-height="${size[1]}" data-fps="30">
      <video id="video" class="clip" src="assets/${path.basename(asset)}" data-start="0" data-duration="${p.duration.toFixed(3)}" data-track-index="0" playsinline data-has-audio="${p.audio}"></video>
      ${mount({ width: size[0], height: size[1], duration: p.duration })}
    </div>
    <script>
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`);
  fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify({ id: path.basename(out), name: path.basename(out) }, null, 2) + "\n");
  fs.writeFileSync(path.join(out, "hyperframes.json"), JSON.stringify({ $schema: "https://hyperframes.heygen.com/schema/hyperframes.json", paths: { assets: "assets" }, media: { autoProxy: true } }, null, 2) + "\n");
  const shape = Math.abs(p.width / p.height - size[0] / size[1]) > 0.01 ? `, the ${p.width}×${p.height} video ${fit === "cover" ? "cut to fill it" : "fitted in with bars"}` : "";
  console.log(`${rel(out)}: ${size.join("×")}${shape}, ${p.duration.toFixed(1)} s, captions ${r.style.label} in ${r.groups} groups → index.html (the video) and ${ID}/index.html (the captions)`);
  console.log(placedFor(r.zones));
}

function cmdSrt(file, out) {
  if (!file || !out) fail("Usage: captions.mjs srt <words.json> <file.srt>");
  const { words } = readWords(file);
  fs.writeFileSync(out, srt(words));
  console.log(`${rel(path.resolve(out))}: ${srt(words).split("\n\n").length} cues`);
}

const [command, ...rest] = process.argv.slice(2);
const [pos, opts] = parse(rest);
try {
  if (command === "styles") cmdStyles();
  else if (command === "transcribe") await cmdTranscribe(pos[0], pos[1]);
  else if (command === "mark") await cmdMark(pos[0], opts);
  else if (command === "box") cmdBox(pos[0], pos.slice(1), opts);
  else if (command === "build") cmdBuild(pos[0], pos[1], opts);
  else if (command === "project") cmdProject(pos[0], pos[1], pos[2], opts);
  else if (command === "srt") cmdSrt(pos[0], pos[1]);
  else fail("Usage: captions.mjs styles | transcribe <video> <words.json> | mark <words.json> | box <words.json> \"<phrase>\" … | build <words.json> <folder> | project <video> <words.json> <composition-folder> | srt <words.json> <file.srt>   (options: see the head of this file)");
} catch (e) {
  fail(`✗ ${e.message}`);
}
