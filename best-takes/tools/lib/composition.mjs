// The cut as a HyperFrames project: every piece a <video> clip on one track, edge to edge, its
// range of the video chosen by data-media-start. Nothing is rendered to preview it; the player
// plays the pieces straight from the videos. The sound stays on the clips, so each piece
// carries its own sound: a gain that brings its take to the common level, and 10 ms fades at
// its ends against clicks at the cuts. All pieces go through one bus, "voice": rumble filtered
// out, a gentle compressor, a true-peak ceiling. A piece that shows a pause has no sound, and
// one that plays faster says so (data-playback-rate). B-roll, when the cut has it, is a
// sub-composition of agentitos' b-roll skill over the pieces; captions, when it has them, one of
// its captions skill on top of that; a hook card (lib/hook.mjs) sits over the start. When the
// b-roll shows beats beside the person, the pieces sit in its wrapper (#broll-person) and its
// script moves them into the person's field on the main timeline.

import fs from "node:fs";
import path from "node:path";

const GSAP = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";
const FADE = 0.01;

const attr = (v) => JSON.stringify(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const n = (x) => +x.toFixed(3);
const n4 = (x) => +x.toFixed(4);

const BUS = {
  version: 1,
  nodes: [
    { type: "highpass", id: "n1", label: "Rumble", params: { frequency: 75, q: 0.707, poles: "2" } },
    { type: "compressor", id: "n2", label: "Even out", params: { threshold: -20, ratio: 2, attack: 10, release: 200, knee: 6, makeup: 2 } },
    { type: "truepeak", id: "n3", label: "Ceiling", params: { ceiling: -2 } },
  ],
};

// a hard link where the file system allows one (no copy of a long video), else a copy
function place(from, to) {
  try {
    if (fs.existsSync(to) && fs.statSync(to).ino === fs.statSync(from).ino) return;
  } catch {}
  fs.rmSync(to, { force: true });
  try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); }
}

// How a piece stands in the frame: covering it, centred (the default), or where a placement put its
// picture (pic: its box in the frame, raised already), and a punch-in grown about the point of the
// frame's middle line at height `origin` (a third from the top when none is given): with a picture
// placed, that point in the picture's own box
export function pieceStyle(p, width, height) {
  const css = [];
  if (p.pic) css.push(`left: ${+p.pic.left.toFixed(1)}px; top: ${+p.pic.top.toFixed(1)}px; width: ${+p.pic.width.toFixed(1)}px; height: ${+p.pic.height.toFixed(1)}px; object-fit: fill`);
  const s = p.scale > 1 ? p.scale : 1, oy = p.origin != null ? p.origin : 0.32 * height;
  if (s > 1) css.push(`transform: scale(${p.scale}); transform-origin: ${p.pic ? `${+(width / 2 - p.pic.left).toFixed(1)}px ${+(oy - p.pic.top).toFixed(1)}px` : p.origin != null ? `50% ${+p.origin.toFixed(1)}px` : "50% 32%"}`);
  // A picture that leaves part of the frame bare (a band over a ground, a crop's window) shows only
  // the part of the frame it fills, and goes closer inside those edges: that part is cut out of it
  // (clip-path is drawn in the element's own box, before its transform)
  const q = p.pic;
  if (q) {
    const w = q.window || [q.left, q.top, q.width, q.height];
    const vis = [Math.max(0, w[0], q.left), Math.max(0, w[1], q.top), Math.min(width, w[0] + w[2], q.left + q.width), Math.min(height, w[1] + w[3], q.top + q.height)];
    const bare = vis[0] > 0.5 || vis[1] > 0.5 || vis[2] < width - 0.5 || vis[3] < height - 0.5;
    const narrower = vis[0] > Math.max(0, q.left) + 0.5 || vis[1] > Math.max(0, q.top) + 0.5 || vis[2] < Math.min(width, q.left + q.width) - 0.5 || vis[3] < Math.min(height, q.top + q.height) - 0.5;
    if ((bare && s > 1) || narrower) {
      const ox = width / 2 - q.left, oyl = oy - q.top, back = (v, o, at) => o + (v - at - o) / s;
      const x0 = back(vis[0], ox, q.left), x1 = back(vis[2], ox, q.left), y0 = back(vis[1], oyl, q.top), y1 = back(vis[3], oyl, q.top);
      const r = (v) => +Math.max(0, v).toFixed(1);
      css.push(`clip-path: inset(${r(y0)}px ${r(q.width - x1)}px ${r(q.height - y1)}px ${r(x0)}px)`);
    }
  }
  return css.join("; ");
}

export function writeComposition(out, { title, lang, width, height, fit, fps, pieces, clips, dir, captions, broll, brollMotion, hook, grounds = [] }) {
  fs.mkdirSync(path.join(out, "assets"), { recursive: true });
  const name = path.basename(out);
  for (const c of new Set(pieces.map((p) => p.clip))) place(path.join(dir, "source", clips[c].file), path.join(out, "assets", path.basename(clips[c].file)));
  for (const g of new Set(grounds.map((x) => x.file))) place(path.join(dir, "source", g), path.join(out, "assets", g));
  // the ground: a blurred still of the video behind a picture that leaves part of the frame bare
  const groundsHtml = grounds.map((g, k) => `      <img id="ground${k + 1}" class="clip ground" src="assets/${g.file}" alt="" data-start="${n4(g.start)}" data-duration="${n4(g.duration)}" data-track-index="3" />`).join("\n");
  fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify({ id: name, name }, null, 2) + "\n");
  fs.writeFileSync(path.join(out, "hyperframes.json"), JSON.stringify({ $schema: "https://hyperframes.heygen.com/schema/hyperframes.json", paths: { assets: "assets" }, media: { autoProxy: true } }, null, 2) + "\n");

  const total = n(pieces.reduce((s, p) => s + p.duration, 0));
  const clipsHtml = pieces.map((p, k) => {
    // the end from the rounded start and end, so that one clip ends exactly where the next starts
    // (to 0.1 ms, a frame's time never falls between two clips; a hair shorter when the sum of
    // the two numbers would reach past the next clip's start)
    const start = n4(p.start), end = n4(p.start + p.duration);
    let d = n4(end - start);
    if (start + d > end) d = n4(d - 0.0001);
    // a gain stage lifts by 12 dB at most: a quiet take gets two
    const lift = Math.abs(p.gain) > 12 ? [Math.sign(p.gain) * 12, +(p.gain - Math.sign(p.gain) * 12).toFixed(1)] : [p.gain];
    const chain = { version: 1, nodes: lift.map((g, k) => ({ type: "gain", id: `g${k + 1}`, label: "Take level", params: { gain: g } })) };
    const fades = { version: 1, lanes: [{ target: "volume", points: [{ t: 0, v: 0 }, { t: FADE, v: 1 }, { t: n(d - FADE), v: 1 }, { t: d, v: 0 }] }] };
    const sound = p.mute
      ? `muted
        data-has-audio="false"`
      : `data-has-audio="true"
        data-audio-group="voice"
        data-fx-chain="${attr(chain)}"
        data-automation="${attr(fades)}"`;
    return `      <video
        id="p${String(k + 1).padStart(3, "0")}"
        class="clip"
        src="assets/${path.basename(clips[p.clip].file)}"
        data-start="${start}"
        data-duration="${d}"
        data-media-start="${n(p.in)}"${p.rate && p.rate !== 1 ? `
        data-playback-rate="${+p.rate.toFixed(4)}"` : ""}
        data-track-index="0"${pieceStyle(p, width, height) ? `
        style="${pieceStyle(p, width, height)}"` : ""}
        playsinline
        ${sound}
      ></video>`;
  }).join("\n");

  const html = `<!doctype html>
<html lang="${esc(lang || "en")}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <title>${esc(title)}</title>
    <script src="${GSAP}"></script>${(hook?.links || []).map((l) => `
    <link rel="stylesheet" href="${l}" />`).join("")}
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: #000; }
      #main { position: relative; width: 100%; height: 100%; overflow: hidden; background: #000; }
      #main video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: ${fit}; }${grounds.length ? `
      #main img.ground { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }` : ""}${brollMotion ? `
      #broll-person { position: absolute; inset: 0; transform-origin: 0 0; }` : ""}${hook ? `
${hook.style}` : ""}
    </style>
  </head>
  <body>
    <!-- generated by best-takes/tools/takes.mjs from cut.json: change cut.json and build again -->
    <div id="main" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${width}" data-height="${height}" data-fps="${fps}">
      <hf-audio-group id="voice" data-label="Voice" data-fx-chain="${attr(BUS)}"></hf-audio-group>
${groundsHtml ? `${groundsHtml}\n` : ""}${brollMotion ? `      <div id="broll-person">\n${clipsHtml}\n      </div>` : clipsHtml}${broll ? `\n      ${broll}` : ""}${captions ? `\n      ${captions}` : ""}${hook ? `\n      ${hook.element}` : ""}
    </div>${hook ? `\n    <script>\n      ${hook.fit}\n    </script>` : ""}
    <script>
      window.__timelines["main"] = gsap.timeline({ paused: true });${hook ? `\n      ${hook.script}` : ""}
    </script>${brollMotion ? `\n    ${brollMotion}` : ""}
  </body>
</html>
`;
  fs.writeFileSync(path.join(out, "index.html"), html);
  return { total };
}
