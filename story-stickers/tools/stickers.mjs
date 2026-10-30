#!/usr/bin/env node
// Instagram's stickers (link, poll, question, countdown, …) on a video Story made with HyperFrames:
// the video is rendered without them, Storrito lays its own stickers over it and Instagram makes
// them tappable. One file says which stickers go where; this tool measures them with Storrito's own
// components, checks them against Instagram's bar and reply field, shows them over the video's
// frames, mounts them as a preview into a HyperFrames project and writes the layer Storrito gets.
// Made for agents: each command prints what it did and what to do next.
//
//   node tools/stickers.mjs build <stickers.json> [--video <mp4>] [--at 1,4.5,9] [--out <dir>]
//        <dir>/layer.html: the stickers as Storrito places them (publish-video's --stickers);
//        <dir>/placed.json: each sticker's box; uploads/stickers-<name>/<build>/NN.jpg: the stickers
//        over the video's frames (or over a dark ground), small, for the chat
//   node tools/stickers.mjs mount <dir> <project>
//        compositions/story-stickers.html in the HyperFrames project and its host in index.html:
//        the stickers over the film in the Studio preview, from <dir>/layer.html
//   node tools/stickers.mjs unmount <project>
//        takes the host out again: before the delivery render, the video goes out without stickers

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { launch } from "./lib/chrome.mjs";
import { measureScript, layout } from "./lib/zones.mjs";
import { connect, componentsHost } from "./lib/storrito.mjs";

const W = 1080, H = 1920;

// the sticker types, their element and the attributes Storrito reads (its Story Components reference)
const STICKERS = {
  link: { tag: "insta-link", attrs: ["url", "text", "design"] },
  poll: { tag: "insta-poll", attrs: ["question", "options", "color"] },
  question: { tag: "insta-question", attrs: ["question", "color"] },
  quiz: { tag: "insta-quiz", attrs: ["question", "options", "correct-answer"] },
  countdown: { tag: "insta-countdown", attrs: ["title", "end-time", "color"] },
  slider: { tag: "insta-emoji-slider", attrs: ["question", "emoji", "color", "text-color"] },
  mention: { tag: "insta-mention", attrs: ["username", "design"] },
  hashtag: { tag: "insta-hashtag", attrs: ["hashtag", "design"] },
  location: { tag: "insta-location", attrs: ["location", "location-id", "design"] },
};
const TAGS = Object.values(STICKERS).map((s) => s.tag).join(", ");

const [cmd, ...rest] = process.argv.slice(2);
const opts = {};
const pos = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a.startsWith("--")) opts[a.slice(2)] = rest[++i];
  else pos.push(a);
}

function fail(message) {
  console.log(message);
  process.exit(1);
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n");
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const nn = (i) => String(i + 1).padStart(2, "0");
const rel = (f) => path.relative(process.cwd(), path.resolve(f)) || ".";
const nameOf = (dir) => path.basename(path.resolve(dir)).toLowerCase().replace(/[^a-z0-9]+/g, "-") || "stickers";

// what the agent wrote, checked before anything renders
function validate(spec) {
  const errors = [];
  const list = spec.stickers;
  if (!Array.isArray(list) || !list.length) return ["stickers.json has no stickers"];
  list.forEach((s, i) => {
    const at = `sticker ${i + 1}`;
    if (!STICKERS[s.type]) errors.push(`${at}: type "${s.type}" is none of ${Object.keys(STICKERS).join(", ")}`);
    for (const k of ["x", "y"]) if (typeof s[k] !== "number" || s[k] < 0 || s[k] > (k === "x" ? W : H)) errors.push(`${at}: "${k}" is the sticker's centre in px of the 1080×1920 frame (0–${k === "x" ? W : H})`);
    if (s.rotate != null && typeof s.rotate !== "number") errors.push(`${at}: "rotate" is in degrees, a number`);
    if (s.scale != null && !(typeof s.scale === "number" && s.scale >= 0.3 && s.scale <= 2)) errors.push(`${at}: "scale" is a number from 0.3 to 2`);
    if (s.type === "link" && !/^https?:\/\//.test(s.url || "")) errors.push(`${at}: a link sticker needs "url" starting with https://`);
    if (["poll", "quiz"].includes(s.type) && !(Array.isArray(s.options) && s.options.length >= 2 && s.options.length <= 4)) errors.push(`${at}: a ${s.type} needs 2 to 4 "options"`);
  });
  return errors;
}

// one sticker as Storrito's element; its place and turn are set once it is measured
function stickerTag(s) {
  const def = STICKERS[s.type];
  const attrs = { ...s };
  if (Array.isArray(attrs.options)) attrs.options = JSON.stringify(attrs.options);
  const list = def.attrs.filter((a) => attrs[a] != null && attrs[a] !== "").map((a) => {
    const v = String(attrs[a]);
    return v.includes('"') ? ` ${a}='${v.replace(/'/g, "&#39;")}'` : ` ${a}="${esc(v)}"`;
  }).join("");
  return `<${def.tag}${list} style="position:absolute;left:0;top:0;visibility:hidden"></${def.tag}>`;
}

function page(spec, host) {
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${host}/">
<script src="/js/insta-components.js"></script>
<style>html,body{margin:0;background:#000}insta-story{display:block;width:${W}px;height:${H}px;overflow:hidden}
#frame{position:absolute;top:0;left:0;width:${W}px;height:${H}px;object-fit:cover}
#ground{position:absolute;inset:0;background:linear-gradient(160deg,#3a3f4b,#16181d)}</style></head>
<body><insta-story><div id="ground"></div><img id="frame" alt="">
${spec.stickers.map(stickerTag).join("\n")}
</insta-story></body></html>`;
}

// runs in the page: every sticker centred on its x/y, turned and scaled; its box as Storrito sees it
function place(list) {
  const els = [...document.querySelectorAll("insta-story > insta-link, insta-story > insta-poll, insta-story > insta-question, insta-story > insta-quiz, insta-story > insta-countdown, insta-story > insta-emoji-slider, insta-story > insta-mention, insta-story > insta-hashtag, insta-story > insta-location")];
  const story = document.querySelector("insta-story").getBoundingClientRect();
  return els.map((el, i) => {
    const s = list[i];
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.round(s.x - w / 2), top = Math.round(s.y - h / 2);
    const transform = [s.rotate ? `rotate(${s.rotate}deg)` : "", s.scale && s.scale !== 1 ? `scale(${s.scale})` : ""].filter(Boolean).join(" ");
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    if (transform) el.style.transform = transform;
    el.style.visibility = "";
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      attrs: Object.fromEntries([...el.attributes].filter((a) => a.name !== "style").map((a) => [a.name, a.value])),
      left, top, width: w, height: h, transform,
      rect: { x: Math.round(r.x - story.x), y: Math.round(r.y - story.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  });
}

// the layer Storrito gets inside <insta-story src="…">, and the preview scene shows over the film
function layerHtml(placed) {
  return placed.map((s) => {
    const attrs = Object.entries(s.attrs).map(([k, v]) => (String(v).includes('"') ? ` ${k}='${String(v).replace(/'/g, "&#39;")}'` : ` ${k}="${esc(v)}"`)).join("");
    return `<${s.tag}${attrs} style="position:absolute;left:${s.left}px;top:${s.top}px${s.transform ? `;transform:${s.transform}` : ""}"></${s.tag}>`;
  }).join("\n") + "\n";
}

function probe(video) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name:format=duration", "-of", "json", video], { encoding: "utf8" });
  if (r.error) fail("ffprobe is missing: the frames of the video need ffmpeg on the machine.");
  if (r.status) fail(`${rel(video)} is no video ffprobe can read.`);
  const j = JSON.parse(r.stdout);
  const s = j.streams?.[0] || {};
  return { width: s.width, height: s.height, codec: s.codec_name, duration: Number(j.format?.duration) || 0 };
}

function frameAt(video, t, file) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", video, "-frames:v", "1", "-q:v", "3", file], { encoding: "utf8" });
  if (r.status || !fs.existsSync(file)) fail(`ffmpeg could not take the frame at ${t} s from ${rel(video)}: ${(r.stderr || "").trim().split("\n").pop()}`);
}

async function cmdBuild([specFile]) {
  if (!specFile || !fs.existsSync(specFile)) fail("Usage: stickers.mjs build <stickers.json> [--video <mp4>] [--at 1,4.5] [--out <dir>]");
  const spec = readJson(specFile);
  const errors = validate(spec);
  if (errors.length) fail(errors.map((e) => `✗ ${e}`).join("\n"));
  const out = opts.out || path.dirname(specFile);
  fs.mkdirSync(out, { recursive: true });
  const name = nameOf(out === "." ? process.cwd() : out);

  let times = [], video = null, info = null;
  if (opts.video) {
    video = opts.video;
    if (!fs.existsSync(video)) fail(`${video} does not exist.`);
    info = probe(video);
    if (info.width !== W || info.height !== H) fail(`✗ ${rel(video)} is ${info.width}×${info.height}: Storrito takes a Story video of exactly 1080×1920. Render the film at 1080×1920.`);
    times = opts.at ? String(opts.at).split(",").map(Number).filter((t) => t >= 0 && t < info.duration)
      : [0.1, 0.35, 0.65, 0.95].map((f) => +(f * info.duration).toFixed(2));
    if (!times.length) fail(`✗ --at names no time inside the video (0–${info.duration.toFixed(1)} s).`);
  }

  const api = await connect();
  const host = await componentsHost(api);
  let measure;
  try { measure = measureScript(); } catch (e) { fail(`✗ ${e.message}`); }
  const htmlFile = path.resolve(out, "preview.html");
  fs.writeFileSync(htmlFile, page(spec, host));
  // the chat's pictures get a folder per build: an earlier message keeps showing what it showed
  const thumbs = path.join(opts.uploads || path.join("uploads", `stickers-${name}`), Date.now().toString(36));
  fs.mkdirSync(thumbs, { recursive: true });

  const browser = await launch();
  let placed, findings;
  const pictures = [];
  try {
    const p = await browser.newPage();
    await p.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await p.goto(pathToFileURL(htmlFile).href, { waitUntil: "load", timeout: 60000 });
    await p.evaluate(async () => {
      const wait = (pr, ms) => Promise.race([pr, new Promise((r) => setTimeout(r, ms))]);
      if (window.__instaRender) await wait(window.__instaRender.waitForComponents(), 15000);
      await wait(document.fonts.ready, 15000);
    });
    if (!(await p.evaluate(() => !!window.__instaRender))) fail(`✗ Storrito's sticker components did not load from ${host}/js/insta-components.js: is the machine online?`);
    placed = await p.evaluate(place, spec.stickers);
    if (placed.some((s) => !s.width || !s.height)) fail(`✗ ${placed.filter((s) => !s.width || !s.height).map((s) => s.tag).join(", ")} rendered without a size: check its attributes against Storrito's Story Components reference.`);
    await p.addScriptTag({ content: measure });
    findings = layout(await p.evaluate(() => platformZonesMeasure()), ["instagram-story"]);
    await p.setViewport({ width: W, height: H, deviceScaleFactor: 0.5 });
    const shots = video ? times : [null];
    for (let i = 0; i < shots.length; i++) {
      if (video) {
        const still = path.resolve(out, `frame-${nn(i)}.jpg`);
        frameAt(video, shots[i], still);
        await p.evaluate(async (src) => {
          const img = document.getElementById("frame");
          await new Promise((r) => { img.onload = img.onerror = r; img.src = src; });
        }, pathToFileURL(still).href);
      }
      const file = path.join(thumbs, `${nn(i)}.jpg`);
      await p.screenshot({ path: file, type: "jpeg", quality: 82 });
      pictures.push({ file, at: shots[i] });
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(out, "layer.html"), layerHtml(placed));
  writeJson(path.join(out, "placed.json"), { host, stickers: placed });
  for (const s of placed) console.log(`${s.tag} ${s.width}×${s.height} at left ${s.left}, top ${s.top}${s.transform ? `, ${s.transform}` : ""}`);
  const tapped = spec.stickers.filter((s) => ["poll", "question", "quiz", "slider", "countdown"].includes(s.type)).length;
  if (tapped > 1) findings.push({ level: "!", kind: "story", what: `has ${tapped} stickers that ask for a tap (poll, question, quiz, slider, countdown): one per story gets the most answers` });
  const notes = findings.map((f) => `${f.level === "✗" ? "✗" : "⚠"} ${f.kind === "text" ? `"${f.label}"` : f.kind === "story" ? "the story" : `the ${f.label} sticker`} ${f.what}`);
  console.log(notes.length ? `\n${notes.join("\n")}` : "\nNo sticker under Instagram's bar or reply field, none on another.");
  console.log(`\nPictures for the chat:\n${pictures.map((x) => `  ${x.file}${x.at != null ? `  (${x.at} s)` : ""}`).join("\n")}`);
  console.log(`\nWrote ${rel(path.join(out, "layer.html"))}.`);
  if (notes.some((n) => n.startsWith("✗"))) console.log(`Next: move the sticker (x, y in ${rel(specFile)}) and build again.`);
  else console.log(`Next: look at the pictures: no sticker may cover the film's own text or a face. Then ${video ? "" : `node <skill>/tools/stickers.mjs mount ${rel(out)} <project> for the Studio preview, or `}hand ${rel(path.join(out, "layer.html"))} to publish-video with --stickers.`);
}

// the HyperFrames project's root: its size and length, from index.html
function rootOf(project) {
  const index = path.join(project, "index.html");
  if (!fs.existsSync(index)) fail(`${project} has no index.html: give the HyperFrames project's folder.`);
  const html = fs.readFileSync(index, "utf8");
  const tags = [...html.matchAll(/<[a-z][^>]*\bdata-composition-id="([^"]+)"[^>]*>/gi)];
  const root = tags.find((m) => !/data-composition-src=/.test(m[0]));
  if (!root) fail(`${rel(index)} has no root element with data-composition-id.`);
  const attr = (k) => (new RegExp(`\\b${k}="([^"]*)"`).exec(root[0]) || [])[1];
  return { index, html, tag: root[0], at: root.index + root[0].length, width: Number(attr("data-width")), height: Number(attr("data-height")), duration: Number(attr("data-duration")) };
}

const MOUNT = /\n?[ \t]*<!-- story-stickers: [^\n]*-->\n[ \t]*<div id="story-stickers"[^>]*><\/div>/;

function cmdMount([dir, project]) {
  if (!dir || !project) fail("Usage: stickers.mjs mount <dir with layer.html> <project>");
  const layerFile = path.join(dir, "layer.html");
  if (!fs.existsSync(layerFile)) fail(`${rel(layerFile)} does not exist: run build first.`);
  const { host } = readJson(path.join(dir, "placed.json"));
  const root = rootOf(project);
  if (root.width !== W || root.height !== H) fail(`✗ The film is ${root.width}×${root.height}: a Story video for Storrito is 1080×1920. Set the root's data-width="1080" data-height="1920".`);
  if (!(root.duration > 0)) fail(`✗ The root of ${rel(root.index)} has no data-duration.`);
  const scene = `<template>
  <style>
    #story-stickers { position: absolute; inset: 0; pointer-events: none; }
  </style>
  <div id="story-stickers" data-composition-id="story-stickers" data-width="${W}" data-height="${H}" data-layout-allow-overlap>
${fs.readFileSync(layerFile, "utf8").trim().split("\n").map((l) => `    ${l}`).join("\n")}
  </div>
  <script>
    (function () {
      // Preview only: Storrito's own sticker components from ${host}. The delivery render goes
      // without this scene (stickers.mjs unmount); Storrito lays the stickers over the video.
      if (!window.customElements.get("insta-story") && !document.querySelector("script[data-story-stickers]")) {
        var s = document.createElement("script");
        s.src = "${host}/js/insta-components.js";
        s.setAttribute("data-story-stickers", "");
        document.head.appendChild(s);
      }
      window.__timelines["story-stickers"] = gsap.timeline({ paused: true });
    })();
  </script>
</template>
`;
  fs.mkdirSync(path.join(project, "compositions"), { recursive: true });
  fs.writeFileSync(path.join(project, "compositions", "story-stickers.html"), scene);
  const hostTag = `\n      <!-- story-stickers: preview of Storrito's stickers; out before the delivery render (stickers.mjs unmount) -->\n      <div id="story-stickers" data-composition-id="story-stickers" data-composition-src="compositions/story-stickers.html" data-start="0" data-duration="${root.duration}" data-track-index="99" data-track-kind="graphics" data-width="${W}" data-height="${H}" style="z-index:1000"></div>`;
  const html = MOUNT.test(root.html) ? root.html.replace(MOUNT, hostTag) : root.html.slice(0, root.at) + hostTag + root.html.slice(root.at);
  fs.writeFileSync(root.index, html);
  console.log(`Mounted the stickers of ${rel(layerFile)} over the film (compositions/story-stickers.html, its host in ${rel(root.index)}, ${root.duration} s).`);
  console.log(`Next: the Studio preview shows them as Instagram will. Before the delivery render: node <skill>/tools/stickers.mjs unmount ${rel(project)}.`);
}

function cmdUnmount([project]) {
  if (!project) fail("Usage: stickers.mjs unmount <project>");
  const root = rootOf(project);
  if (!MOUNT.test(root.html)) { console.log(`No stickers mounted in ${rel(root.index)}: the film renders without them.`); return; }
  fs.writeFileSync(root.index, root.html.replace(MOUNT, ""));
  console.log(`Took the stickers' preview out of ${rel(root.index)}: the delivery render goes without them.`);
  console.log(`Next: render the film, then check it with node <skill>/tools/stickers.mjs build <stickers.json> --video <mp4>.`);
}

const COMMANDS = { build: cmdBuild, mount: cmdMount, unmount: cmdUnmount };
if (!COMMANDS[cmd]) fail("Usage: stickers.mjs build <stickers.json> [--video <mp4>] [--at 1,4.5] [--out <dir>] | mount <dir> <project> | unmount <project>");
try {
  await COMMANDS[cmd](pos);
} catch (e) {
  fail(`✗ ${e.message}`);
}
