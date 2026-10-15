#!/usr/bin/env node
// Build a HyperFrames kinetic-transcript video from a per-word timing transcript.
//
//   node tools/build.mjs <transcript.json> [--audio voice.wav] [--aspect 16:9|9:16|1:1|4:5|21:9]
//                        [--size 1920x1080] [--title "..."] [--seed 7] [--tail 1.8]
//   node tools/build.mjs --plan plan.json            # rebuild from an edited plan
//   --llm            stage the transcript with Claude (cached next to the transcript as
//                    <name>.staging.json; falls back to the keyword lexicon on failure)
//   --llm-refresh    ignore the cached staging and ask Claude again
//   --preset         lyric (default) | podcast | social – pacing, layouts, HUD, world presence
//   --world          cosmos | aurora | editorial | geometry | bokeh | neon | noir, calm: slate | dusk | canopy | chalk | linen | mist (default: by preset; with --llm Claude picks)
//   --hook "…"       headline (social/podcast); with --llm Claude writes one if omitted
//   --cta "…" --handle @name   end card (social)
//   --subtitle "…"   e.g. episode / guest line (podcast)
//   --speakers A=Anna,B=Ben   names for the transcript's speaker labels (podcast)
//   --colors A=#ff5a36,B=#4fc3f7   their colours (accent words, name chip); default by world
//   --audiogram / --no-audiogram   waveform bars from the audio (default on for podcast)
//   --out <dir>      write a separate HyperFrames project there (one project per video)
//   --diarize [N]    detect who speaks when from --audio (tools/diarize.py, local sherpa-onnx);
//                    N = number of voices, omit to estimate. Overwrites "speaker" labels.
//                    or every word as a big lockup (lyric/social default)
//   --keep-fillers   keep "uh", "um", "äh" and stutters ("is is") – removed by default
//   --no-align       keep the transcript's word timings as they are (by default they are
//                    snapped to voice onsets in --audio, see tools/align.mjs)
//   --video clip.mp4 footage as the background (e.g. the podcast's own camera): the type sits in
//                    a darkened band over it, the world only adds light on top. Without --audio
//                    the voice is taken from the video.
//   --video-shade a:b   the band: transparent at frame height a, dark from b down. Default: found
//                    from the footage (tools/burnin.mjs) – dark just above burned-in captions and
//                    name tags, never above mid-frame (the face) nor below 60 % (room for the type)
//   --video-dim x    darkness of the band, 0..1 (default 1 with burned-in text, else 0.85)
//   --llm-backend    claude-code (default: headless `claude -p` on your Claude subscription)
//                    | api (Anthropic API key / `ant auth login`, billed per token)
//   --staging-brief f   the agent running this build directs instead: write what it needs to read
//                    (vocabulary, rules, numbered words, JSON schema) to f and stop
//   --staging f      build with the staging the agent wrote to f (checked, never falls back)
//
// Writes plan.json (editable), index.html and compositions/{world,lyrics,overlay}.html.

import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { normalizeTranscript, analyze, LIGHT_WORLDS } from "./analyze.mjs";
import { applyVariables, declarationsAttribute } from "./variables.mjs";
import { annotate, validate, brief, readStaging, dropWords } from "./llm-annotate.mjs";
import { alignToAudio } from "./align.mjs";
import { audioBands } from "./audio.mjs";
import { footageLayer } from "./footage.mjs";
import { detectBurnIn } from "./burnin.mjs";
import { CSS as TYPE_CSS } from "../engine/type.js";
import { CSS as OVERLAY_CSS } from "../engine/overlay.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GSAP = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const opt = { seed: 7, title: "" };
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    opt[k] = v;
  } else pos.push(a);
}
if (!pos[0] && !opt.plan) {
  console.error("usage: node tools/build.mjs <transcript.json> [--audio file] [--aspect 16:9|9:16|1:1|4:5] [--size WxH] [--title t]");
  process.exit(1);
}

function frameSize() {
  if (typeof opt.size === "string") {
    const [w, h] = opt.size.split("x").map(Number);
    return { width: w, height: h };
  }
  const aspect = opt.aspect || (opt.preset === "social" ? "9:16" : "16:9");
  const [aw, ah] = String(aspect).split(":").map(Number);
  const short = 1080;
  return aw >= ah ? { width: Math.round((short * aw) / ah / 2) * 2, height: short } : { width: short, height: Math.round((short * ah) / aw / 2) * 2 };
}

// ---------------------------------------------------------------- speakers
// Labels every word with a voice (A, B, …) via the local Python tool; cached next to the
// transcript, keyed by the transcript + audio + requested voice count.
function diarize(raw, audio, n) {
  // a transcript that already says who speaks (OpenRouter, tools/stt.mjs) needs nothing local
  const list = Array.isArray(raw) ? raw : raw.words ?? [];
  if (list.length && list.every((w) => w.speaker != null)) {
    console.error("diarize: the transcript has its speakers");
    return raw;
  }
  if (typeof audio !== "string") throw new Error("--diarize needs --audio");
  const py = path.join(ROOT, ".venv", "bin", "python");
  if (!fs.existsSync(py)) throw new Error("--diarize: Python env missing – see README (Real podcasts: speakers and fillers)");
  const speakers = n === true ? 0 : Number(n) || 0;
  const cache = pos[0].replace(/\.json$/, "") + `.speakers${speakers ? "-" + speakers : ""}.json`;
  const fresh = fs.existsSync(cache) && [pos[0], audio].every((f) => fs.statSync(f).mtimeMs < fs.statSync(cache).mtimeMs);
  if (!fresh) {
    const tmp = path.join(os.tmpdir(), `kinetic-words-${process.pid}.json`);
    fs.writeFileSync(tmp, JSON.stringify(raw));
    const r = spawnSync(py, [path.join(ROOT, "tools", "diarize.py"), audio, tmp, "--speakers", String(speakers), "--out", cache], { stdio: ["ignore", "inherit", "inherit"] });
    fs.rmSync(tmp, { force: true });
    if (r.status !== 0) throw new Error("diarize failed");
  } else console.error(`diarize: cached ${path.basename(cache)}`);
  return JSON.parse(fs.readFileSync(cache, "utf8"));
}

// ---------------------------------------------------------------- footage
// probe the background video; its sound becomes the voice track when there is no --audio
function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`--video: cannot read ${file}`);
  const j = JSON.parse(r.stdout);
  return { width: j.streams[0].width, height: j.streams[0].height, duration: Number(j.format.duration) };
}
const VIDEO = typeof opt.video === "string" ? path.resolve(opt.video) : null;
if (VIDEO && typeof opt.audio !== "string") {
  const wav = VIDEO.replace(/\.[^.]+$/, "") + ".voice.wav";
  if (!fs.existsSync(wav) || fs.statSync(wav).mtimeMs < fs.statSync(VIDEO).mtimeMs) {
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", VIDEO, "-vn", "-ac", "1", "-ar", "48000", wav], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("--video: audio extraction failed");
  }
  opt.audio = wav;
}

// ---------------------------------------------------------------- plan
let plan;
if (opt.plan) {
  plan = JSON.parse(fs.readFileSync(opt.plan, "utf8"));
} else {
  let raw = JSON.parse(fs.readFileSync(pos[0], "utf8"));
  if (opt.diarize) raw = diarize(raw, opt.audio, opt.diarize);
  const { width, height } = frameSize();
  const title = opt.title === true ? "" : opt.title || (raw.title ?? path.basename(pos[0], ".json"));
  let words = normalizeTranscript(raw, { keepFillers: !!opt["keep-fillers"] });
  if (typeof opt.audio === "string" && !opt["no-align"]) {
    const al = alignToAudio(words, opt.audio);
    words = al.words;
    console.error(`align: snapped ${al.moved} of ${words.length} word onsets to the audio`);
  }
  const portrait = height > width * 1.1;
  let annotations = null;
  const preset0 = typeof opt.preset === "string" ? opt.preset : "lyric";
  if (typeof opt["staging-brief"] === "string") {
    fs.writeFileSync(opt["staging-brief"], brief(words, { width, height, portrait, preset: preset0, video: !!VIDEO }, typeof opt.staging === "string" ? opt.staging : "staging.json"));
    console.log(`${opt["staging-brief"]}: brief for ${words.length} words written`);
    process.exit(0);
  }
  if (typeof opt.staging === "string") {
    try {
      annotations = readStaging(JSON.parse(fs.readFileSync(opt.staging, "utf8")), words.length);
    } catch (err) {
      console.error(`staging: ${opt.staging} is not usable – ${err.message}`);
      process.exit(2);
    }
    annotations.preset = preset0;
    for (const f of annotations.fixes) {
      words[f.i] = { ...words[f.i], ...(f.text != null ? { text: f.text.trim(), fixed: true } : {}), ...(f.speaker != null ? { speaker: f.speaker } : {}) };
    }
    const dropped = annotations.drop.length;
    ({ words, annotations } = dropWords(words, annotations));
    console.error(`staging: ${path.basename(opt.staging)} (${annotations.phrases.length} phrases, ${annotations.fixes.length} fixes${dropped ? `, ${dropped} words dropped` : ""})`);
  } else if (opt.llm || opt["llm-refresh"]) {
    // staging depends on the frame orientation (phrase length), so cache per orientation
    const preset = typeof opt.preset === "string" ? opt.preset : "lyric";
    const cache = pos[0].replace(/\.json$/, "") + `.staging-${preset === "lyric" ? "" : preset + "-"}${portrait ? "portrait" : "landscape"}${VIDEO ? "-video" : ""}.json`;
    if (fs.existsSync(cache) && !opt["llm-refresh"]) {
      annotations = validate(JSON.parse(fs.readFileSync(cache, "utf8")), words.length);
      console.error(`staging: cached ${path.basename(cache)}`);
    } else {
      try {
        const backend = typeof opt["llm-backend"] === "string" ? opt["llm-backend"] : "claude-code";
        console.error(`staging: asking Claude via ${backend} …`);
        annotations = await annotate(words, { width, height, portrait, backend, preset, video: !!VIDEO });
        fs.writeFileSync(cache, JSON.stringify(annotations, null, 1));
        console.error(`staging: saved ${path.basename(cache)}`);
      } catch (err) {
        console.error(`staging: Claude unavailable (${err.message}) – falling back to the keyword lexicon`);
      }
    }
  }
  const str = (k) => (typeof opt[k] === "string" ? opt[k] : undefined);
  const pairs = (k) => str(k) ? Object.fromEntries(str(k).split(",").map((kv) => kv.split("=").map((x) => x.trim()))) : undefined;
  const speakerNames = pairs("speakers");
  // a colour per speaker, "A=#ff5a36,B=#4fc3f7": their accent words and name chip
  const speakerColors = pairs("colors");
  plan = analyze(words, {
    width, height, seed: Number(opt.seed), tail: opt.tail != null ? Number(opt.tail) : undefined, title, annotations,
    preset: str("preset") || "lyric", world: str("world"), hook: str("hook"), cta: str("cta"), handle: str("handle"), subtitle: str("subtitle"), speakerNames, speakerColors,
    audiogram: opt["no-audiogram"] ? false : opt.audiogram ? true : undefined,
    video: !!VIDEO,
  });
  if (plan.style.audiogram && typeof opt.audio === "string") plan.bands = audioBands(opt.audio);
  else plan.style.audiogram = false;
}

// output project: this one, or a separate HyperFrames project per video (--out)
const OUT = typeof opt.out === "string" ? path.resolve(opt.out) : ROOT;
if (OUT !== ROOT) {
  fs.mkdirSync(path.join(OUT, "assets"), { recursive: true });
  const name = path.basename(OUT);
  for (const f of ["hyperframes.json", "package.json"]) if (!fs.existsSync(path.join(OUT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
  if (!fs.existsSync(path.join(OUT, "meta.json"))) fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify({ id: name, name }, null, 2));
}

// footage: copied into assets/ like the audio; the band geometry lives in the plan (editable)
if (VIDEO) {
  const v = probe(VIDEO);
  // the renderer extracts frames with its own decoder: H.264 / HEVC / VP9 work, AV1 (common on
  // YouTube) does not – transcode those once into H.264, keep the rest as they are
  const codec = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", VIDEO], { encoding: "utf8" }).stdout.trim();
  const ok = ["h264", "hevc", "vp9"].includes(codec);
  const dst = path.join(OUT, "assets", "bg" + (ok ? path.extname(VIDEO) : ".mp4"));
  if (ok) fs.copyFileSync(VIDEO, dst);
  else if (!fs.existsSync(dst) || fs.statSync(dst).mtimeMs < fs.statSync(VIDEO).mtimeMs) {
    console.error(`footage: ${codec} → H.264`);
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", VIDEO, "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-pix_fmt", "yuv420p", dst], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("--video: transcoding failed");
  }
  const pair = (k) => (typeof opt[k] === "string" ? opt[k].split(":").map(Number) : null);
  // burned-in captions / graphics decide where the dark band starts
  const burn = pair("video-shade") ? null : detectBurnIn(VIDEO);
  const textTop = Math.min(burn?.band?.[0] ?? 1, burn?.overlay ?? 1);
  const b = Math.min(0.6, Math.max(0.5, Math.min(0.6, textTop) - 0.012));
  const shade = pair("video-shade") || [+(b - 0.12).toFixed(3), +b.toFixed(3)];
  const burned = !!(burn?.band || burn?.overlay);
  if (burn) console.error(`footage: ${burn.band ? `captions at ${Math.round(burn.band[0] * 100)}–${Math.round(burn.band[1] * 100)} %` : "no burned-in captions"}${burn.overlay ? `, graphics from ${Math.round(burn.overlay * 100)} %` : ""} → dark from ${Math.round(shade[1] * 100)} %`);
  plan.video = {
    src: `assets/${path.basename(dst)}`, width: v.width, height: v.height, duration: +v.duration.toFixed(3), shade,
    dim: opt["video-dim"] != null ? Number(opt["video-dim"]) : burned || !burn ? 1 : 0.85,
    burnin: burn ? { captions: burn.band, graphics: burn.overlay ?? null } : undefined,
  };
  // a light world puts the footage into a frame on its ground (tools/footage.mjs)
  if (LIGHT_WORLDS.has(plan.world)) plan.video.frame = frameBox(plan, v);
  else delete plan.video.frame;
  // the speaker is on camera: no audiogram
  plan.style.audiogram = false; delete plan.bands;
}

// The frame of the footage in a light world, [x0, y0, x1, y1] as frame fractions: on top in
// portrait and square (the type below it), on the left in landscape (the type beside it). A
// clip of another shape is cut to fit (cover), never squeezed.
function frameBox(plan, v) {
  const W = plan.width, H = plan.height, va = v.width / v.height;
  if (W > H * 1.2) {
    const w = 0.48, h = Math.min(0.72, (w * W) / va / H);
    return [0.05, +((1 - h) / 2).toFixed(4), 0.05 + w, +((1 + h) / 2).toFixed(4)].map((x) => +x.toFixed(4));
  }
  const w = 0.86, x0 = (1 - w) / 2, y0 = W < H * 0.9 ? 0.12 : 0.15;
  const h = Math.min(W < H * 0.9 ? 0.36 : 0.4, (w * W) / Math.min(va, 16 / 9) / H);
  return [x0, y0, x0 + w, y0 + h].map((x) => +x.toFixed(4));
}

// audio: copy into assets/ so the project is self-contained
let audioRel = plan.audio || null;
if (typeof opt.audio === "string") {
  const src = path.resolve(opt.audio);
  const dst = path.join(OUT, "assets", path.basename(src));
  if (src !== dst) fs.copyFileSync(src, dst);
  audioRel = `assets/${path.basename(src)}`;
  plan.audio = audioRel;
}
fs.writeFileSync(path.join(OUT, "plan.json"), JSON.stringify(plan, null, 1));

// ---------------------------------------------------------------- bundles
async function bundle(entry, globalName) {
  const r = await esbuild.build({
    entryPoints: [path.join(ROOT, "engine", entry)], bundle: true, format: "iife", globalName,
    minify: true, write: false, target: "es2020", legalComments: "none",
  });
  const out = path.join(OUT, "assets/engine", entry);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, r.outputFiles[0].text);
  return `assets/engine/${entry}`;
}
const [worldJs, typeJs, overlayJs] = await Promise.all([
  bundle("world.js", "KineticWorld"), bundle("type.js", "KineticType"), bundle("overlay.js", "KineticOverlay"),
]);

// every font is embedded, so the composition looks the same wherever it plays (the renderer
// resolves known families itself, a plain HTML player does not)
const fontData = (f) => fs.readFileSync(path.join(ROOT, "assets/fonts", f)).toString("base64");
const fontsource = (f) => fs.readFileSync(path.join(ROOT, "node_modules/@fontsource", f)).toString("base64");
const face = (family, weight, file) => `
  @font-face { font-family: "${family}"; font-style: normal; font-weight: ${weight};
    src: url(data:font/woff2;base64,${fontsource(file)}) format("woff2"); }`;
const FONT_FACES = `${face("League Gothic", 400, "league-gothic/files/league-gothic-latin-400-normal.woff2")}${face("JetBrains Mono", 400, "jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2")}${face("JetBrains Mono", 700, "jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2")}
  @font-face { font-family: "Instrument Serif"; font-style: italic; font-weight: 400;
    src: url(data:font/woff2;base64,${fontData("InstrumentSerif-Italic.woff2")}) format("woff2"); }
  @font-face { font-family: "Instrument Serif"; font-style: normal; font-weight: 400;
    src: url(data:font/woff2;base64,${fontData("InstrumentSerif-Regular.woff2")}) format("woff2"); }`;

const { width: W, height: H, duration: D } = plan;
// the audiogram bands are only drawn by the overlay; keep the other layers lean
const planJson = JSON.stringify({ ...plan, bands: undefined });
const overlayPlanJson = JSON.stringify(plan);

// The person's settings: HyperFrames variables (tools/variables.mjs), declared on index.html,
// given to the page as window.__hfVariables by the preview and the render. Every layer
// applies them to the plan when it loads.
const APPLY_JS = `
          ${applyVariables.toString()}`;

function subcomp(id, body) {
  return `<!doctype html>
<html>
  <head><meta charset="UTF-8" /></head>
  <body>
    <template id="${id}-template">
${body}
    </template>
  </body>
</html>
`;
}

// ---------------------------------------------------------------- world (Canvas 2D)
// With footage (plan.video) the world sits on the video (tools/footage.mjs)
const V = plan.video;
const F = V ? footageLayer(plan) : { css: "", html: "", js: "" };
const world = subcomp("world", `
      <style>
        #world-root { position: absolute; inset: 0; background: ${V ? "#000" : "#04050c"}; overflow: hidden; }
        #world-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }${F.css}
      </style>
      <div id="world-root" data-composition-id="world" data-width="${W}" data-height="${H}" data-duration="${D}">${F.html}
        <canvas id="world-canvas" width="${W}" height="${H}"></canvas>
      </div>
      <script src="${GSAP}"></script>
      <script src="${worldJs}"></script>
      <script>
        (function () {
          ${APPLY_JS}
          var plan = applyVariables(${planJson}, window.__hfVariables);
          // Played live in a player (an iframe, and not the renderer's capture), the world is
          // drawn at 40 % of its size: in full it takes some 40 ms a frame on the CPU and the
          // words stutter. The render, top level or captured, keeps every pixel.
          var canvas = document.getElementById("world-canvas");
          if (!window.__HF_RENDER_CAPTURE_MODE && window.top !== window) {
            plan = Object.assign({}, plan, { width: Math.round(plan.width * 0.4), height: Math.round(plan.height * 0.4) });
            canvas.width = plan.width; canvas.height = plan.height;
          }
          var api = KineticWorld.mount(canvas, plan);
          var last = -1;
          function draw(t) { if (t === last) return; last = t; api.renderAt(t); }
          window.addEventListener("hf-seek", function (e) { draw(e.detail.time); });
          // GSAP mirror so preview scrubbing and timeline-driven seeks also land here
          var proxy = { t: 0 };
          var tl = gsap.timeline({ paused: true });
          tl.to(proxy, { t: plan.duration, duration: plan.duration, ease: "none", onUpdate: function () { draw(proxy.t); } }, 0);${F.js}
          draw(window.__hfThreeTime || 0);
          window.__timelines["world"] = tl;
        })();
      </script>`);

// ---------------------------------------------------------------- lyrics (typography)
const lyrics = subcomp("lyrics", `
      <style>
        ${FONT_FACES}
        #lyrics-root { position: absolute; inset: 0; font-family: "League Gothic", "Instrument Serif", sans-serif; }
        .ky-preload-a { font-family: "League Gothic"; } .ky-preload-b { font-family: "Instrument Serif"; font-style: italic; }
        ${TYPE_CSS}
      </style>
      <div id="lyrics-root" data-composition-id="lyrics" data-width="${W}" data-height="${H}" data-duration="${D}">
        <span class="ky-preload-a" style="position:absolute;opacity:0">A</span><span class="ky-preload-b" style="position:absolute;opacity:0">a</span>
      </div>
      <script src="${GSAP}"></script>
      <script src="${typeJs}"></script>
      <script>
        (function () {
          ${APPLY_JS}
          var plan = applyVariables(${planJson}, window.__hfVariables);
          var root = document.getElementById("lyrics-root");
          Promise.all([
            document.fonts.load('400 100px "League Gothic"'),
            document.fonts.load('italic 400 100px "Instrument Serif"'),
          ]).catch(function () {}).then(function () {
            var built = KineticType.build(root, plan, gsap);
            window.__timelines["lyrics"] = built.timeline;
            if (window.__hfForceTimelineRebind) window.__hfForceTimelineRebind();
          });
        })();
      </script>`);

// ---------------------------------------------------------------- overlay (grain + HUD)
const overlay = subcomp("overlay", `
      <style>
        ${FONT_FACES}
        #overlay-root { position: absolute; inset: 0; pointer-events: none; font-family: "JetBrains Mono", "League Gothic", monospace; }
        .ko-preload-a { font-family: "League Gothic"; } .ko-preload-b { font-family: "Instrument Serif"; font-style: italic; }
        ${OVERLAY_CSS}
      </style>
      <div id="overlay-root" data-composition-id="overlay" data-width="${W}" data-height="${H}" data-duration="${D}">
        <span class="ko-preload-a" style="position:absolute;opacity:0">A</span><span class="ko-preload-b" style="position:absolute;opacity:0">a</span>
      </div>
      <script src="${GSAP}"></script>
      <script src="${overlayJs}"></script>
      <script>
        (function () {
          ${APPLY_JS}
          var plan = applyVariables(${overlayPlanJson}, window.__hfVariables);
          var built = null, last = -1, pending = window.__hfThreeTime || 0;
          // canvas parts (audiogram) are drawn from time, like the 3D world
          function draw(t) { pending = t; if (!built || t === last) return; last = t; built.draw(t); }
          window.addEventListener("hf-seek", function (e) { draw(e.detail.time); });
          Promise.all([
            document.fonts.load('400 100px "League Gothic"'),
            document.fonts.load('italic 400 100px "Instrument Serif"'),
            document.fonts.load('700 20px "JetBrains Mono"'),
          ]).catch(function () {}).then(function () {
            built = KineticOverlay.build(document.getElementById("overlay-root"), plan, gsap);
            var proxy = { t: 0 };
            built.timeline.to(proxy, { t: plan.duration, duration: plan.duration, ease: "none", onUpdate: function () { draw(proxy.t); } }, 0);
            draw(pending);
            window.__timelines["overlay"] = built.timeline;
            if (window.__hfForceTimelineRebind) window.__hfForceTimelineRebind();
          });
        })();
      </script>`);

// ---------------------------------------------------------------- index
const host = (id, track, kind) => `      <div
        id="${id}"
        data-composition-id="${id}"
        data-composition-src="compositions/${id}.html"
        data-start="0"
        data-duration="${D}"
        data-track-index="${track}"
        data-track-kind="${kind}"
        data-width="${W}"
        data-height="${H}"
      ></div>`;

const index = `<!doctype html>
<html lang="${plan.lang || "en"}" data-composition-variables='${declarationsAttribute(plan)}'>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <title>${(plan.hook || plan.title || "Kinetic transcript").replace(/</g, "&lt;")}</title>
    <script src="${GSAP}"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #04050c; }
      #main { position: relative; width: 100%; height: 100%; overflow: hidden; background: #04050c; }
      #world, #lyrics, #overlay { position: absolute; inset: 0; }
    </style>
  </head>
  <body>
    <!-- generated by tools/build.mjs from plan.json — edit plan.json and run: node tools/build.mjs --plan plan.json -->
    <div id="main" data-composition-id="main" data-start="0" data-duration="${D}" data-width="${W}" data-height="${H}">
${host("world", 0, "graphics")}
${host("lyrics", 1, "captions")}
${host("overlay", 2, "graphics")}
${audioRel ? `      <audio id="voice" src="${audioRel}" data-start="0" data-duration="${D}" data-track-index="3" data-volume="1"></audio>` : ""}
    </div>
    <script>
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;

fs.mkdirSync(path.join(OUT, "compositions"), { recursive: true });
fs.writeFileSync(path.join(OUT, "compositions/world.html"), world);
fs.writeFileSync(path.join(OUT, "compositions/lyrics.html"), lyrics);
fs.writeFileSync(path.join(OUT, "compositions/overlay.html"), overlay);
fs.writeFileSync(path.join(OUT, "index.html"), index);
console.log(`${path.relative(process.cwd(), OUT) || "."}: built ${W}x${H}, ${D}s, ${plan.words.length} words, ${plan.phrases.length} phrases, staging: ${plan.staging} → index.html`);
