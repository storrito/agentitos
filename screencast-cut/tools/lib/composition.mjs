// The cut as a HyperFrames project. Every piece is a shot: its source's <video> placed so that
// the shot's crop fills its box (left, top, width, height) and clipped to the box (clip-path),
// played from the source's own time (data-media-start: the recording's time less the source's
// offset), muted; in the screen and phone views the webcam beside it in a circle, the same
// moment. The sound is the main microphone's, cleaned, on a track of its own: an <audio> clip
// per spoken piece with the gain that brings its take to the common level and 10 ms fades,
// all through one bus (rumble out, a gentle compressor, a true-peak ceiling) as in best-takes.
// On top: a label per keep that has one, a badge on a timelapse, a blur over what must not be
// readable, the captions of agentitos' captions skill, and music under the voice when asked,
// lower while someone speaks. Nothing is rendered to preview it.

import fs from "node:fs";
import path from "node:path";
import { areas, fit, place, cover, circle } from "./layout.mjs";

const GSAP = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";
const FADE = 0.01;

const attr = (v) => JSON.stringify(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const n = (x) => +x.toFixed(3);
const n4 = (x) => +x.toFixed(4);
const px = (v) => `${+v.toFixed(1)}px`;

const BUS = {
  version: 1,
  nodes: [
    { type: "highpass", id: "n1", label: "Rumble", params: { frequency: 75, q: 0.707, poles: "2" } },
    { type: "compressor", id: "n2", label: "Even out", params: { threshold: -20, ratio: 2, attack: 10, release: 200, knee: 6, makeup: 2 } },
    { type: "truepeak", id: "n3", label: "Ceiling", params: { ceiling: -2 } },
  ],
};

// a hard link where the file system allows one (no copy of a long video), else a copy
function link(from, to) {
  try {
    if (fs.existsSync(to) && fs.statSync(to).ino === fs.statSync(from).ino) return;
  } catch {}
  fs.rmSync(to, { force: true });
  try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); }
}

// start and duration of a timed element on whole ten-thousandths, so that one clip ends exactly
// where the next starts
function timing(start, duration) {
  const a = n4(start), b = n4(start + duration);
  let d = n4(b - a);
  if (a + d > b) d = n4(d - 0.0001);
  return `data-start="${a}" data-duration="${d}"`;
}

// The shots of the cut: per piece its view's main video (and the webcam's circle), where it sits.
// pieces: plan()'s, each with { view, crop } set; sources: { name: { offset, width, height } }
export function shots(pieces, sources, width, height) {
  const a = areas(width, height);
  return pieces.map((p) => {
    const out = [];
    const src = sources[p.source];
    if (p.view === "face" || !src) {
      const cam = sources.webcam || src;
      if (cam) out.push({ source: cam === src ? p.source : "webcam", box: [0, 0, width, height], crop: cover(cam, width, height), main: true });
    } else {
      const c = p.crop || [0, 0, 1, 1];
      const aspect = ((c[2] - c[0]) * src.width) / ((c[3] - c[1]) * src.height);
      // a tall picture (a phone's screen) gets the tall area
      out.push({ source: p.source, box: fit(aspect < 0.8 ? a.tall : a.content, aspect), crop: c, main: true, round: Math.round(Math.min(width, height) * 0.02) });
      if (sources.webcam && p.pip !== false) {
        const [x, y, d] = a.pip;
        out.push({ source: "webcam", box: [x, y, d, d], crop: circle(sources.webcam), pip: true });
      }
    }
    return { piece: p, layers: out };
  });
}

// The brand's look from its DESIGN.md (brand-kit): primary colour, background, text colour and
// display font, all optional.
export function brandOf(file) {
  if (!file || !fs.existsSync(file)) return {};
  const front = fs.readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const color = (key) => front.match(new RegExp(`^[ \\t]+${key}:\\s*["']?(#[0-9a-fA-F]{3,8})`, "m"))?.[1];
  const display = front.match(/headline-display:\n((?:[ \t]{4,}.*\n?)+)/)?.[1] ?? "";
  return { accent: color("primary"), background: color("background") || color("surface"), text: color("on-background") || color("on-surface"),
    font: display.match(/fontFamily:\s*["']?([^"'\n]+)/)?.[1]?.trim() };
}

export function writeComposition(out, o) {
  const { title, lang, width, height, fps, pieces, sources, dir, voice, labels = [], blurs = [], captions, music, brand = {} } = o;
  fs.mkdirSync(path.join(out, "assets"), { recursive: true });
  const name = path.basename(out);
  const used = new Set();
  const placed = shots(pieces, sources, width, height);
  for (const s of placed) for (const l of s.layers) used.add(l.source);
  for (const k of used) link(path.join(dir, "source", sources[k].file), path.join(out, "assets", sources[k].file));
  link(path.join(dir, "source", voice), path.join(out, "assets", voice));
  if (music) link(path.resolve(music.file), path.join(out, "assets", `music${path.extname(music.file)}`));
  fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify({ id: name, name }, null, 2) + "\n");
  fs.writeFileSync(path.join(out, "hyperframes.json"), JSON.stringify({ $schema: "https://hyperframes.heygen.com/schema/hyperframes.json", paths: { assets: "assets" }, media: { autoProxy: true } }, null, 2) + "\n");

  const accent = brand.accent || "#ff5a6e", bg = brand.background || "#0e1116", ink = brand.text || "#ffffff";
  const font = brand.font || "Inter";
  const total = n(pieces.reduce((s, p) => s + p.duration, 0));
  const html = [];
  const anim = [];
  let id = 0;
  const next = (p) => `${p}${String(++id).padStart(3, "0")}`;

  // the shots
  for (const { piece: p, layers } of placed) {
    for (const l of layers) {
      const src = sources[l.source];
      const at = place(l.box, l.crop, src);
      // a radius in pixels: a percentage would be of the whole element, not of the visible box
      const radius = l.pip ? l.box[2] / 2 : l.round;
      const clipPath = `inset(${at.inset.map(px).join(" ")}${radius ? ` round ${px(radius)}` : ""})`;
      html.push(`      <video id="${next("v")}" class="clip${l.pip ? " pip" : ""}" src="assets/${src.file}" ${timing(p.start, p.duration)}
        data-media-start="${n(Math.max(0, p.in - src.offset))}"${p.rate && p.rate !== 1 ? ` data-playback-rate="${+p.rate.toFixed(4)}"` : ""}
        data-track-index="${l.pip ? 2 : 0}" muted data-has-audio="false" playsinline
        style="left:${px(at.left)};top:${px(at.top)};width:${px(at.width)};height:${px(at.height)};clip-path:${clipPath}"></video>`);
      if (l.pip) {
        const [x, y, d] = l.box;
        html.push(`      <div id="${next("r")}" class="clip ring" ${timing(p.start, p.duration)} data-track-index="3"
        style="left:${px(x - 4)};top:${px(y - 4)};width:${px(d + 8)};height:${px(d + 8)}"></div>`);
      }
    }
    // a timelapse says so
    if (p.rate > 1.05) {
      const box = layers.find((l) => l.main)?.box || [0, 0, width, height];
      html.push(`      <div id="${next("b")}" class="clip badge" ${timing(p.start, p.duration)} data-track-index="4"
        style="left:${px(box[0] + box[2] - 20)};top:${px(box[1] + 20)}">⏩ ${Math.round(p.rate)}×</div>`);
    }
  }

  // what must not be readable: a blur over its box, for every shot that shows it
  for (const b of blurs) {
    html.push(`      <div id="${next("x")}" class="clip blur" ${timing(b.start, b.duration)} data-track-index="5"
        style="left:${px(b.left)};top:${px(b.top)};width:${px(b.width)};height:${px(b.height)}"></div>`);
  }

  // the labels
  for (const l of labels) {
    const elId = next("l");
    const [x, y] = areas(width, height).label;
    html.push(`      <div id="${elId}" class="clip label" ${timing(l.start, l.duration)} data-track-index="6"
        style="left:${px(x)};top:${px(y)}">${esc(l.text)}</div>`);
    anim.push(`tl.from("#${elId}", { opacity: 0, y: -12, duration: 0.3, ease: "power2.out" }, ${n(l.start)});`);
  }

  // the voice: the main microphone's, one clip per spoken piece
  const voiceClips = [];
  for (const p of pieces) {
    if (p.mute) continue;
    const lift = Math.abs(p.gain) > 12 ? [Math.sign(p.gain) * 12, +(p.gain - Math.sign(p.gain) * 12).toFixed(1)] : [p.gain];
    const chain = { version: 1, nodes: lift.map((g, k) => ({ type: "gain", id: `g${k + 1}`, label: "Take level", params: { gain: g } })) };
    const d = n4(p.duration);
    const fades = { version: 1, lanes: [{ target: "volume", points: [{ t: 0, v: 0 }, { t: FADE, v: 1 }, { t: n(d - FADE), v: 1 }, { t: d, v: 0 }] }] };
    voiceClips.push(`      <audio id="${next("a")}" class="clip" src="assets/${voice}" ${timing(p.start, p.duration)} data-media-start="${n(p.in)}"
        data-track-index="7" data-has-audio="true" data-audio-group="voice" data-fx-chain="${attr(chain)}" data-automation="${attr(fades)}"></audio>`);
  }

  // music under it all, lower while someone speaks
  let musicHtml = "";
  if (music) {
    const base = music.volume ?? 0.35, under = base * 0.35;
    // up where nobody speaks for more than 1.2 s, down again 0.3 s before the next words
    const lane = [];
    let at = 0;
    for (const s of music.speech || []) {
      if (s.from - at > 1.2) lane.push({ t: n(at + 0.3), v: base }, { t: n(s.from - 0.3), v: base }, { t: n(s.from), v: under });
      else lane.push({ t: n(s.from), v: under });
      at = s.to;
    }
    if (total - at > 1.2) lane.push({ t: n(at + 0.3), v: base });
    const auto = { version: 1, lanes: [{ target: "volume", points: [{ t: 0, v: under }, ...lane.filter((x) => x.t > 0 && x.t < total), { t: n(Math.max(0, total - 1.5)), v: base }, { t: n(total), v: 0 }] }] };
    musicHtml = `      <audio id="music" class="clip" src="assets/music${path.extname(music.file)}" ${timing(0, total)} data-media-start="${n(music.from || 0)}"
        data-track-index="8" data-has-audio="true" data-automation="${attr(auto)}"></audio>`;
  }

  const doc = `<!doctype html>
<html lang="${esc(lang || "en")}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <title>${esc(title)}</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(font).replace(/%20/g, "+")}:wght@700;800&display=swap" />
    <script src="${GSAP}"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: ${bg}; }
      #main { position: relative; width: 100%; height: 100%; overflow: hidden;
        background: radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, ${accent} 16%, ${bg}) 0%, ${bg} 62%); }
      #main video { position: absolute; object-fit: fill; }
      #main .ring { position: absolute; border-radius: 50%; border: 6px solid ${accent}; }
      #main .badge { position: absolute; transform: translateX(-100%); padding: 10px 18px; border-radius: 999px;
        background: rgba(0, 0, 0, 0.72); color: #fff; font: 800 ${Math.round(Math.min(width, height) * 0.032)}px "${font}", sans-serif; }
      #main .blur { position: absolute; border-radius: 10px; backdrop-filter: blur(22px) saturate(0.6); -webkit-backdrop-filter: blur(22px) saturate(0.6);
        background: rgba(110, 110, 110, 0.55); }
      #main .label { position: absolute; padding: 12px 22px; border-radius: 999px; background: ${accent}; color: ${ink};
        font: 800 ${Math.round(Math.min(width, height) * 0.036)}px "${font}", sans-serif; letter-spacing: 0.02em; }
    </style>
  </head>
  <body>
    <!-- generated by screencast-cut/tools/screencast.mjs from cut.json: change cut.json and build again -->
    <div id="main" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${width}" data-height="${height}" data-fps="${fps}">
      <hf-audio-group id="voice" data-label="Voice" data-fx-chain="${attr(BUS)}"></hf-audio-group>
${html.join("\n")}
${voiceClips.join("\n")}${musicHtml ? `\n${musicHtml}` : ""}${captions ? `\n      ${captions}` : ""}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      ${anim.join("\n      ")}
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
  fs.writeFileSync(path.join(out, "index.html"), doc);
  return { total, placed };
}
