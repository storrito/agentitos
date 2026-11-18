#!/usr/bin/env node
// One animated text Story, 1080×1920 and 16.60 s, opening with one of the
// four word intros: written once into a HyperFrames project, then edited by
// hand. Usage: node story.mjs new <config.json> <project>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODES = { "stamp-orbit": 3.2, "stack-fan": 2.5, "slide-lock": 2.3, "echo-collapse": 3.2 };
const KEYS = new Set(["name", "title", "language", "mode", "introDuration", "introCopy", "echoKey", "colors", "headline", "cta", "bodyBeats", "link", "musicFile"]);
const BEATS = [0, 5.2, 9.2, 13.8, 16.6];
const MAX_WORDS = 55;

function fail(message) {
  console.error("story: " + message);
  process.exit(2);
}

function text(value, label, max = 180) {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(`${label} must be a text of at most ${max} characters.`);
  return value.trim();
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const js = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

function validate(c, configFile) {
  const unknown = Object.keys(c).filter((k) => !KEYS.has(k));
  if (unknown.length) fail(`unknown keys in the config: ${unknown.join(", ")}; see ${SKILL}/examples/creative-practice.json.`);
  c.name = text(c.name, "name", 60);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.name)) fail("name must be a lowercase slug like 01-scheduling.");
  c.title = text(c.title, "title", 120);
  c.language = text(c.language ?? "en", "language", 24);
  c.mode ??= "stack-fan";
  if (!(c.mode in MODES)) fail(`mode must be one of ${Object.keys(MODES).join(", ")}.`);
  c.introDuration ??= MODES[c.mode];
  const d = c.introDuration;
  const fits = { "stamp-orbit": d === 3.2, "echo-collapse": d === 3.2, "stack-fan": d >= 2.4 && d <= 2.6, "slide-lock": d === 2.3 || d === 2.4 };
  if (typeof d !== "number" || !fits[c.mode]) fail("introDuration: stamp-orbit and echo-collapse 3.2, stack-fan 2.4 to 2.6, slide-lock 2.3 or 2.4.");
  const cases = text(c.introCopy, "introCopy", 100).split(/\s+/);
  if (cases.length < 2 || cases.length > 8) fail("introCopy must be 2 to 8 words.");
  const caps = cases.map((w) => w.replace(/[^\p{L}\p{N}]/gu, "").toUpperCase());
  if (caps.some((w) => !w)) fail("every word of introCopy needs a letter or a digit.");
  c.introCopy = cases.join(" ");
  if (c.mode === "echo-collapse" && caps.filter((w) => w === c.echoKey).length !== 1) fail("echoKey must be one word of introCopy, uppercase without punctuation, that occurs once.");
  const colors = c.colors ?? {};
  if (["bg", "ink", "accent", "panel"].some((k) => !/^#[0-9a-fA-F]{6}$/.test(colors[k] ?? "")) || Object.keys(colors).length !== 4) fail("colors needs exactly bg, ink, accent and panel as #RRGGBB.");
  c.headline = text(c.headline, "headline", 70);
  c.cta = text(c.cta, "cta", 70);
  if (!Array.isArray(c.bodyBeats) || c.bodyBeats.length !== 4) fail("bodyBeats needs four objects, for 0, 5.2, 9.2 and 13.8 s.");
  c.bodyBeats.forEach((beat, i) => {
    const keys = i === 1 || i === 2 ? ["body", "heading"] : ["body"];
    if (Object.keys(beat ?? {}).sort().join() !== keys.join()) fail(`bodyBeats[${i}] needs exactly ${keys.join(" and ")}; the first headline and the last one (cta) are top-level.`);
    beat.body = text(beat.body, `bodyBeats[${i}].body`, 150);
    if (beat.heading !== undefined) beat.heading = text(beat.heading, `bodyBeats[${i}].heading`, 70);
  });
  const link = (c.link ??= {});
  link.text = text(link.text, "link.text", 60);
  let url;
  try { url = new URL(link.url); } catch { fail("link.url must be an https address."); }
  if (url.protocol !== "https:" || url.username || url.password) fail("link.url must be an https address without credentials.");
  link.design ??= "black";
  let music = null;
  if (c.musicFile !== undefined) {
    music = path.resolve(path.dirname(configFile), text(c.musicFile, "musicFile", 4096));
    if (!fs.existsSync(music) || !/\.(mp3|wav|m4a|aac|ogg)$/i.test(music)) fail("musicFile must be an existing mp3, wav, m4a, aac or ogg, relative to the config.");
  }
  return { cases, caps, music };
}

const CSS = `
*{box-sizing:border-box}html,body{margin:0;width:1080px;height:1920px;overflow:hidden}
body{font-family:Arial,Helvetica,sans-serif}h1,h2,p{margin:0}
@font-face{font-family:Anton;src:url('assets/fonts/Anton-Regular.ttf') format('truetype');font-weight:400;font-style:normal;font-display:block}
main{position:relative;width:1080px;height:1920px;overflow:hidden;background:var(--series-bg);color:var(--series-ink)}
.clip{position:absolute;inset:0;overflow:hidden}
#film-body{position:absolute;inset:0;opacity:0}
.scene{background:var(--series-bg);color:var(--series-ink)}
#s2{background:var(--panel)}#s4{background:var(--series-ink);color:var(--series-bg)}
.headline{position:absolute;left:110px;top:360px;width:860px;font:700 106px/1.02 Arial,Helvetica,sans-serif;letter-spacing:-4px;white-space:pre-line;overflow-wrap:break-word}
.body-copy{position:absolute;left:110px;top:930px;width:830px;padding-left:24px;border-left:5px solid var(--series-accent);font:400 38px/1.35 Arial,Helvetica,sans-serif;white-space:pre-line;overflow-wrap:break-word}
#s1 .body-copy{top:1060px}
.topic-illustration{position:absolute;left:110px;top:690px;width:860px;height:170px;pointer-events:none}
#word-intro{position:absolute;inset:0;z-index:90;pointer-events:none;background:transparent;color:var(--series-ink)}
#word-intro-content,#intro-surface{position:absolute;inset:0}
#intro-surface{z-index:0;background:var(--series-bg)}
#word-ring{position:absolute;left:540px;top:960px;z-index:1;transform-origin:0 0}
#word-ring .intro-word{position:absolute;left:0;top:0;font:31px/1.35 Arial,Helvetica,sans-serif;letter-spacing:-.5px;white-space:nowrap;transform-origin:50% 50%;will-change:transform,font-size;opacity:0}
#word-ring .cap-word{display:block;font-family:Anton,Arial,sans-serif;font-weight:400;line-height:1.35}
#word-ring .cap-letter{display:inline-block;vertical-align:top;line-height:1.35;transform-origin:50% 50%;will-change:transform}
#word-ring .case-word{position:absolute;left:0;top:0;opacity:0;font-family:Arial,Helvetica,sans-serif;font-weight:400;line-height:1.35}
#series-landing{position:absolute;left:110px;width:860px;top:850px;margin:0;font:400 31px/1.35 Arial,Helvetica,sans-serif;letter-spacing:-.5px;opacity:0;will-change:transform}
#series-landing .final-word{display:inline-block}
#story-stickers{position:absolute;inset:0;z-index:1000;pointer-events:none;background:transparent!important}
#word-intro:not([data-intro-style="stamp-orbit"]) .case-word{left:50%;transform:translateX(-50%)}
#word-intro[data-intro-style="stack-fan"] .cap-word{position:relative;z-index:1}
#word-ring .fan-back{position:absolute;left:50%;top:50%;width:600px;height:130px;margin-left:-300px;margin-top:-65px;border:2px solid color-mix(in srgb,var(--series-ink) 65%,transparent);background:var(--series-bg);box-shadow:0 8px 0 color-mix(in srgb,var(--series-bg) 75%,#000);pointer-events:none}
#word-ring .et-ghost{position:absolute;left:0;top:0;white-space:nowrap;line-height:1.35;font-family:Anton,Arial,sans-serif;font-weight:400;letter-spacing:-.5px;transform-origin:50% 50%;color:transparent;-webkit-text-stroke:2.5px var(--series-ink);opacity:0;will-change:transform}
`;

function layer(link) {
  return `<div style="position:absolute;left:60px;right:60px;top:1470px;bottom:300px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px">
<insta-link url="${esc(link.url)}" text="${esc(link.text)}" design="${esc(link.design)}" style="flex:none;transform:scale(0.75)"></insta-link>
</div>
`;
}

function scene(lines) {
  return `<template>
  <div id="native-link-layer" data-composition-id="story-stickers" data-start="0" data-duration="16.60" data-width="1080" data-height="1920" data-layout-allow-overlap style="position:absolute;inset:0;pointer-events:none">
${lines}  </div>
  <script>
    (function(){
      if(!window.customElements.get('insta-story')&&!document.querySelector('script[data-story-stickers]')){
        var s=document.createElement('script');s.src='https://c1.storrito.com/js/insta-components.js';
        s.setAttribute('data-story-stickers','');document.head.appendChild(s);
      }
      window.__timelines=window.__timelines||{};
      window.__timelines['story-stickers']=gsap.timeline({paused:true}).to({},{duration:16.60});
    })();
  </script>
</template>
`;
}

function story(c, cases, caps, musicName) {
  const finals = cases.map((w) => `<span class="final-word">${esc(w)}</span>`).join(" ");
  const back = c.mode === "stack-fan" ? '<span class="fan-back" aria-hidden="true"></span>' : "";
  // The fan's cards cover each other while they spread, on purpose.
  const capAttr = c.mode === "stack-fan" ? " data-layout-allow-occlusion" : "";
  const words = caps.map((cap, i) => `<div class="intro-word">${back}<span class="cap-word"${capAttr}>${esc(cap)}</span><span class="case-word">${esc(cases[i])}</span></div>`).join("");
  const ghosts = c.mode === "echo-collapse"
    ? '<div id="echo-ghosts" aria-hidden="true" data-layout-allow-overlap>' + `<div class="et-ghost" data-layout-ignore>${esc(c.echoKey)}</div>`.repeat(3) + "</div>"
    : "";
  const scenes = c.bodyBeats.map((beat, i) => {
    const heading = i === 0 ? c.headline : i === 3 ? c.cta : beat.heading;
    const tag = i === 0 ? "h1" : "h2";
    return `<section id="s${i + 1}" class="clip scene" data-start="${BEATS[i].toFixed(2)}" data-duration="${(BEATS[i + 1] - BEATS[i]).toFixed(2)}" data-track-index="1">`
      + `<${tag} class="headline">${esc(heading)}</${tag}>` + (i === 0 ? `<p id="series-landing">${finals}</p>` : "")
      + '<div class="topic-illustration" aria-hidden="true"></div>'
      + `<p class="body-copy">${esc(beat.body)}</p></section>`;
  }).join("");
  const audio = musicName ? `<audio id="music" src="assets/${esc(musicName)}" data-start="0" data-duration="16.60" data-volume="0.65" data-fade-out="0.5" data-track-index="3"></audio>` : "";
  const cfg = { name: c.name, copy: c.introCopy, headline: "#s1 .headline", landing: 850, bg: c.colors.bg, ink: c.colors.ink };
  if (c.mode !== "stamp-orbit") Object.assign(cfg, { mode: c.mode, introDuration: c.introDuration }, c.mode === "echo-collapse" ? { echoKey: c.echoKey } : {});
  let rest = `const rest=gsap.timeline({paused:true});
// The intro replaces the first headline's entrance.
rest.from('#s1 .headline',{y:80,opacity:0,duration:.55,ease:'power4.out'},1.85);
rest.from('#s1 .body-copy',{y:24,opacity:0,duration:.5,ease:'power3.out'},1.95);
// The scenes are clips: HyperFrames shows each in its data-start/data-duration.
// rest starts at 1.60 s of the film: film time = rest time + 1.60.
`;
  BEATS.slice(1, -1).forEach((t, k) => {
    const i = k + 2, u = t - 1.6;
    rest += `rest.from('#s${i} .headline',{y:48,opacity:0,duration:.55,ease:'power4.out'},${(u + 0.05).toFixed(2)})
.from('#s${i} .body-copy',{y:24,opacity:0,duration:.5,ease:'power3.out'},${(u + 0.18).toFixed(2)});
`;
  });
  rest += "rest.to({},{duration:.01},14.99);\n";
  return `<!doctype html>
<html lang="${esc(c.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=1080, initial-scale=1">`
    + `<title>${esc(c.title)}</title><link rel="preload" href="assets/fonts/Anton-Regular.ttf" as="font" type="font/ttf" crossorigin="anonymous"><style>${CSS}</style>`
    // the sticker components before the snapshot: the scene loads them only when missing, too late for it every few runs
    + `<script src="https://c1.storrito.com/js/insta-components.js"></script></head><body>
`
    + `<main id="main" data-composition-id="main" data-start="0" data-duration="16.60" data-width="1080" data-height="1920" data-fps="30" `
    + `style="--series-bg:${c.colors.bg};--series-ink:${c.colors.ink};--series-accent:${c.colors.accent};--panel:${c.colors.panel}">`
    + `<div id="film-body">${scenes}</div>${audio}`
    + `<section id="word-intro" class="clip" data-intro-style="${c.mode}" data-start="0" data-duration="${c.introDuration.toFixed(2)}" data-track-index="8" data-track-kind="graphics">`
    + `<div id="word-intro-content" data-layout-allow-overlap><div id="intro-surface" data-layout-allow-occlusion></div><div id="word-ring" data-layout-allow-overlap>${ghosts}${words}</div></div></section>`
    + `<div id="story-stickers" class="clip" data-preview-only data-composition-id="story-stickers" data-composition-src="compositions/story-stickers.html" data-start="0" data-duration="16.60" data-track-index="99" data-track-kind="graphics" data-width="1080" data-height="1920"></div></main>
`
    + `<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script><script src="assets/series-intro.js"></script>
<script>(async function(){
${rest}const introResult=await window.buildSeriesIntro(rest,${js(cfg)});
window.__timelines=window.__timelines||{};window.__timelines.main=introResult.timeline;
})().catch(function(error){window.__introError=String(error);console.error(error);});</script>
</body></html>
`;
}

const [command, configArg, projectArg] = process.argv.slice(2);
if (command !== "new" || !configArg || !projectArg) fail("usage: node story.mjs new <config.json> <project>, e.g. artifacts/<name>; the config as in examples/creative-practice.json.");
const configFile = path.resolve(configArg);
let c;
try { c = JSON.parse(fs.readFileSync(configFile, "utf8")); } catch (e) { fail(`cannot read ${configArg} as JSON: ${e.message}.`); }
const { cases, caps, music } = validate(c, configFile);
// What the four scenes show besides the intro: the headline, the headings, the bodies and the call to action.
const words = [c.headline, c.cta, ...c.bodyBeats.flatMap((b) => [b.heading ?? "", b.body])].join(" ").split(/\s+/).filter(Boolean).length;
const project = path.resolve(projectArg);
if (!fs.existsSync(path.join(project, "composition"))) fail(`${projectArg} has no composition/ folder: create the HyperFrames project first.`);
const dir = path.join(project, "composition", c.name);
if (fs.existsSync(dir)) fail(`composition/${c.name} exists already: edit it, or choose another name.`);

fs.mkdirSync(path.join(dir, "assets/fonts"), { recursive: true });
fs.mkdirSync(path.join(dir, "compositions"));
for (const f of ["Anton-Regular.ttf", "OFL.txt"]) fs.copyFileSync(path.join(SKILL, "assets/fonts", f), path.join(dir, "assets/fonts", f));
fs.copyFileSync(path.join(SKILL, "assets", c.mode === "stamp-orbit" ? "orbit.js" : "variants.js"), path.join(dir, "assets/series-intro.js"));
const musicName = music ? "soundtrack" + path.extname(music).toLowerCase() : null;
if (music) fs.copyFileSync(music, path.join(dir, "assets", musicName));
const lines = layer(c.link);
fs.mkdirSync(path.join("stickers", c.name), { recursive: true });
fs.writeFileSync(path.join("stickers", c.name, "layer.html"), lines);
fs.writeFileSync(path.join(dir, "compositions/story-stickers.html"), scene(lines));
fs.writeFileSync(path.join(dir, "index.html"), story(c, cases, caps, musicName));

console.log(`Wrote composition/${c.name}/ in ${projectArg} (${c.mode}, intro ${c.introDuration.toFixed(2)} s, Story 16.60 s, ${music ? "with the music" : "silent"}, ${words} words in the scenes) and stickers/${c.name}/layer.html.`);
if (words > MAX_WORDS) console.log(`${words} words are more than the ${MAX_WORDS} that 16.60 s holds: propose a cut to the person, never a longer Story or more scenes.`);
if (fs.existsSync(path.join(project, "composition/index.html"))) console.log("Delete composition/index.html, so the preview shows the Stories side by side.");
console.log("Next: each beat's illustration in its .topic-illustration, then the preview.");
