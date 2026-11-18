// The b-roll as a HyperFrames sub-composition, broll/index.html, which a host composition mounts as
// one clip (mount()) under its captions. Every beat is a clip of its own at its time: a picture or
// a muted video, and behind one shown whole or to be read a blurred copy of itself (or the brand's
// colour); a number is a card. Everything the runtime needs is inside the <template>; the host
// slot, the root and the timeline share the id "broll". Pictures that fill the frame or are shown
// whole move in slowly (at most 1.5 % a second, 6 % in all), rendered by the browser's transform,
// sub-pixel: no stutter. The cut in and out is hard.
//
// A beat "beside" the person (lib/beside.mjs) shares the frame: a panel covers all but the
// person's field and holds the material in its own field (a number set to the field's size, a
// picture fitted into it). The host moves the person into their field over 0.5 s by a transform
// on its wrapper #broll-person, and puts its captions (#captions) onto the band under the
// material, unseen at the move's middle (a sub-composition's timeline cannot reach the host's
// elements, so personMotion() gives the host that script). The panel is opaque throughout; its hole travels with the video, from the whole
// frame to the person's rounded card, on the same time and ease (holePolygon: a clip-path driven
// by one tweened variable, --p, seek-safe), so the video is never seen through it. The material
// rises in on the panel. Beats that touch keep the panel, the person and the captions in place.
//
//   writeBroll(out, { beats, width, height, duration, zones, brand })
//   mount({ dir, width, height, duration, track })   → the host's clip
//   personMotion(beats)                              → the host's script that moves the person
//                                                      (and the captions), or null when no beat
//                                                      is beside

import fs from "node:fs";
import path from "node:path";

export const ID = "broll";
const n = (x) => +x.toFixed(3);
const px = (x) => Math.round(x);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const googleFont = (family, weight) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}${weight ? `:wght@${weight}` : ""}&display=swap`;
const luma = (hex) => { const v = parseInt(String(hex).slice(1), 16); return 0.2126 * (v >> 16) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255); };

export const ZOOM = { rate: 0.015, most: 0.06 };
export const PERSON = "broll-person";   // the host's wrapper around the person's video
export const MOVE = 0.5;                // the person moves into their field and back in this long
const RISE = 0.3, SINK = 0.25;          // the material rises in and sinks out on the panel

// The box for what must be read: the box the apps leave free (platform-zones' centred box), less
// the band at its bottom where the captions sit (captions skill: the lowest line at that box's
// bottom, two lines at most), so that neither covers the other.
export function readBox({ width, height, zones }) {
  const [x, y, w, h] = zones.centred;
  const band = Math.round(320 * Math.min(width, height) / 1080);
  return [x, y, w, Math.max(h * 0.5, h - band)];
}

// where a beat's picture goes, in px of the frame: fill covers the frame, whole fits into it,
// read fits into the read box, beside into the material's field
export function rectOf(beat, { width, height, zones }) {
  if (beat.fit === "fill") return { x: 0, y: 0, w: width, h: height, scale: Math.max(width / beat.w, height / beat.h) };
  const [bx, by, bw, bh] = beat.fit === "read" ? readBox({ width, height, zones }) : beat.fit === "beside" ? beat.layout.material.field : [0, 0, width, height];
  const scale = Math.min(bw / beat.w, bh / beat.h);
  const w = beat.w * scale, h = beat.h * scale;
  // a picture shown whole that is low enough sits above the captions' band, not behind it
  const [, ry, , rh] = readBox({ width, height, zones });
  const room = beat.fit === "whole" && h <= ry + rh ? ry + rh : bh;
  return { x: bx + (bw - w) / 2, y: by + (room - h) / 2, w, h, scale };
}

export function writeBroll(out, { beats, width, height, duration, zones, brand, dir = path.basename(out) }) {
  const short = Math.min(width, height) / 1080;
  const accent = brand?.primary || "#FF4D2E";
  const back = brand?.dark && luma(brand.dark) < 70 ? brand.dark : "#111114";
  const figure = luma(accent) - luma(back) > 90 ? accent : "#FFFFFF";
  const links = [googleFont("Inter", 800)];
  let font = "Inter", faces = "";
  if (beats.some((b) => b.kind === "number") && brand?.family) {
    if (brand.served) { font = brand.family; links.push(googleFont(font)); }
    else if (brand.files.length) {
      font = brand.family;
      fs.mkdirSync(path.join(out, "fonts"), { recursive: true });
      for (const f of brand.files) {
        fs.copyFileSync(f.file, path.join(out, "fonts", path.basename(f.file)));
        faces += `        @font-face { font-family: "${font}"; font-weight: ${f.weight}; src: url("${dir}/fonts/${path.basename(f.file)}"); }\n`;
      }
    }
  }

  const els = [], css = [], tweens = [];
  const beside = beats.some((b) => b.fit === "beside");
  const timing = (b) => `data-start="${n(b.start)}" data-duration="${n(b.duration)}" data-track-index="${b.track}"`;
  const [rx, ry, rw, rh] = readBox({ width, height, zones });
  for (const b of beats) {
    const id = `broll-${String(b.n).padStart(2, "0")}`;
    // beside the person the material rises in once the hole has left its field (60 % into the
    // move) and is gone before the hole grows back over it
    const at = { in: b.start + (b.fit === "beside" && b.enter === "move" ? 0.6 * b.moveIn : b.enter === "move" ? 0.1 : 0) };
    if (b.fit === "beside") {
      // the panel around the person's field, the material in its own field, the source under it
      const L = b.layout;
      const [mx, my, mw, mh] = L.material.field;
      els.push(`<div id="${id}-panel" class="clip broll-panel" ${timing(b)}>${b.bg ? `<img class="broll-panel-blur" src="${dir}/assets/${b.bg}" alt="" />` : ""}</div>`);
      css.push(`#${id}-panel { --p: 1; clip-path: ${holePolygon(width, height, L, px(28 * short))}; }`);
      if (b.kind === "number") {
        els.push(`<div id="${id}" class="clip broll-field" ${timing(b)}><div id="${id}-figure" class="broll-figure" data-size="${px(Math.min(300 * short, 0.42 * mh))}">${esc(b.number)}</div>${b.label ? `<div class="broll-label">${esc(b.label)}</div>` : ""}</div>`);
        css.push(`#${id} { left: ${px(mx)}px; top: ${px(my)}px; width: ${px(mw)}px; height: ${px(mh)}px; }`);
        tweens.push(`tl.fromTo("#${id}-figure", { scale: 0.9 }, { scale: 1, duration: 0.3, ease: "back.out(2)" }, ${n(at.in)});`);
      } else {
        const r = rectOf(b, { width, height, zones });
        css.push(`#${id} { left: ${px(r.x)}px; top: ${px(r.y)}px; width: ${px(r.w)}px; height: ${px(r.h)}px; border-radius: ${px(18 * short)}px; box-shadow: 0 ${px(18 * short)}px ${px(60 * short)}px rgba(0,0,0,0.45); }`);
        if (b.kind === "video") els.push(`<video id="${id}" class="clip broll-pic" src="${dir}/assets/${b.file}" ${timing(b)} data-media-start="${n(b.from || 0)}" muted playsinline data-has-audio="false"></video>`);
        else els.push(`<img id="${id}" class="clip broll-pic" src="${dir}/assets/${b.file}" alt="" ${timing(b)} />`);
      }
      // the hole opens from the whole frame as the person moves in, and back, on their time and ease
      if (b.enter === "move") {
        tweens.push(`tl.fromTo("#${id}-panel", { "--p": 0 }, { "--p": 1, duration: ${n(b.moveIn)}, ease: "power2.inOut" }, ${n(b.start)});`);
        tweens.push(`tl.fromTo("#${id}", { opacity: 0, y: ${px(30 * short)} }, { opacity: 1, y: 0, duration: ${RISE}, ease: "power2.out" }, ${n(at.in)});`);
      }
      if (b.leave === "move") {
        tweens.push(`tl.fromTo("#${id}-panel", { "--p": 1 }, { "--p": 0, duration: ${n(b.moveOut)}, ease: "power2.inOut", immediateRender: false }, ${n(b.end - b.moveOut)});`);
        tweens.push(`tl.fromTo(${JSON.stringify([`#${id}`, ...(b.credit ? [`#${id}-credit`] : [])].join(", "))}, { opacity: 1 }, { opacity: 0, duration: ${SINK}, ease: "power2.in", immediateRender: false }, ${n(b.end - b.moveOut - 0.6 * SINK)});`);
      }
    } else if (b.kind === "number") {
      els.push(`<div id="${id}" class="clip broll-card" ${timing(b)}><div id="${id}-figure" class="broll-figure" data-size="${px(300 * short)}">${esc(b.number)}</div>${b.label ? `<div class="broll-label">${esc(b.label)}</div>` : ""}</div>`);
      css.push(`#${id} { padding: ${px(ry)}px ${px(width - rx - rw)}px ${px(height - ry - rh)}px ${px(rx)}px; }`);
      tweens.push(`tl.fromTo("#${id}-figure", { scale: 0.9 }, { scale: 1, duration: 0.3, ease: "back.out(2)" }, ${n(b.start)});`);
    } else {
      const r = rectOf(b, { width, height, zones });
      const src = `${dir}/assets/${b.file}`;
      if (b.fit !== "fill") {
        if (b.bg) els.push(`<img id="${id}-bg" class="clip broll-blur" src="${dir}/assets/${b.bg}" alt="" ${timing(b)} />`);
        else els.push(`<div id="${id}-bg" class="clip broll-plain" ${timing(b)}></div>`);
      }
      const box = `left: ${px(r.x)}px; top: ${px(r.y)}px; width: ${px(r.w)}px; height: ${px(r.h)}px;`;
      css.push(`#${id} { ${box}${b.fit === "fill" ? " object-fit: cover;" : ""}${b.fit === "read" ? ` border-radius: ${px(18 * short)}px; box-shadow: 0 ${px(18 * short)}px ${px(60 * short)}px rgba(0,0,0,0.45);` : ""} }`);
      if (b.kind === "video") els.push(`<video id="${id}" class="clip broll-pic" src="${src}" ${timing(b)} data-media-start="${n(b.from || 0)}" muted playsinline data-has-audio="false"></video>`);
      else els.push(`<img id="${id}" class="clip broll-pic" src="${src}" alt="" ${timing(b)} />`);
      if (b.zoom) tweens.push(`tl.fromTo("#${id}", { scale: 1 }, { scale: ${n(1 + Math.min(ZOOM.most, ZOOM.rate * b.duration))}, duration: ${n(b.duration)}, ease: "none" }, ${n(b.start)});`);
    }
    if (b.credit) {
      // under a picture to be read, at its right edge; else at the top of the captions' band
      const r = b.fit === "read" || b.fit === "beside" ? rectOf(b, { width, height, zones }) : { x: rx, y: ry, w: rw, h: rh };
      els.push(`<div id="${id}-credit" class="clip broll-credit" ${timing(b)}>${esc(b.credit)}</div>`);
      css.push(`#${id}-credit { right: ${px(width - r.x - r.w)}px; top: ${px(r.y + r.h + 12 * short)}px; }`);
      if (b.fit === "beside" && b.enter === "move") tweens.push(`tl.fromTo("#${id}-credit", { opacity: 0 }, { opacity: 1, duration: ${RISE}, ease: "power2.out" }, ${n(at.in)});`);
    }
  }

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
  </head>
  <body>
    <!-- generated by agentitos/b-roll from broll.json: change broll.json and build again -->
    <template>
${links.map((l) => `      <link rel="stylesheet" href="${l}" />`).join("\n")}
      <style>
${faces}        #root { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
        .broll-pic { position: absolute; transform-origin: 50% 50%; }
        .broll-blur { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: blur(${px(40 * short)}px) brightness(0.42) saturate(1.2); transform: scale(1.15); }
        .broll-plain { position: absolute; inset: 0; background: ${brand?.primary ? `linear-gradient(160deg, ${brand.primary}, ${back})` : back}; }
        .broll-card { position: absolute; inset: 0; box-sizing: border-box; background: ${back}; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
          font-family: "${font}", "Inter", sans-serif; }
        .broll-figure { color: ${figure}; font-weight: 800; line-height: 1; letter-spacing: -0.03em; font-size: ${px(300 * short)}px; white-space: nowrap; }
        .broll-label { margin-top: ${px(28 * short)}px; color: #FFFFFF; font-weight: 700; line-height: 1.15; font-size: ${px(64 * short)}px; text-wrap: balance; max-width: 100%; }
${beside ? `        .broll-panel { position: absolute; inset: 0; overflow: hidden; background: ${brand?.primary ? `linear-gradient(160deg, ${brand.primary}, ${back})` : back}; }
        .broll-panel-blur { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: blur(${px(40 * short)}px) brightness(0.42) saturate(1.2); transform: scale(1.15); }
        .broll-field { position: absolute; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; overflow: hidden;
          font-family: "${font}", "Inter", sans-serif; }
        .broll-field .broll-label { font-size: ${px(56 * short)}px; margin-top: ${px(20 * short)}px; }
` : ""}        .broll-credit { position: absolute; color: rgba(255,255,255,0.85);
          font: 600 ${px(26 * short)}px "Inter", sans-serif; text-shadow: 0 1px ${px(6 * short)}px rgba(0,0,0,0.8); white-space: nowrap; }
${css.map((c) => `        ${c}`).join("\n")}
      </style>
      <div id="root" data-composition-id="${ID}" data-width="${width}" data-height="${height}" data-duration="${n(duration)}">
${els.map((e) => `        ${e}`).join("\n")}
      </div>
      <script>
        (function () {
          var tl = gsap.timeline({ paused: true });
          ${tweens.join("\n          ")}
          window.__timelines["${ID}"] = tl;
          // a number as big as fits in one line (and, in a field, with its label in the field's
          // height), once the font is there
          function fit() {
            Array.prototype.forEach.call(document.querySelectorAll(".broll-figure"), function (el) {
              var box = el.parentNode, cs = getComputedStyle(box);
              var room = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
              var field = box.classList.contains("broll-field");
              var s = Number(el.getAttribute("data-size")) || ${px(300 * short)};
              el.style.fontSize = s + "px";
              while (s > ${px(60 * short)} && (el.scrollWidth > room || (field && box.scrollHeight > box.clientHeight))) { s -= 4; el.style.fontSize = s + "px"; }
            });
          }
          fit();
          if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
        })();
      </script>
    </template>
  </body>
</html>
`;
  fs.writeFileSync(path.join(out, "index.html"), html);
}

// The panel's outline as a clip-path: the whole frame less a rounded hole that travels with the
// person's video. At --p 0 the hole is the whole frame (the panel is not seen), at --p 1 it is the
// person's card (a side on the frame's edge reaching past it, so that its corners are not seen).
// In between it is the part of the video that ends in the card, carried by the video's own move
// (scale 1 → S, shift 0 → X, Y on the same ease), with its corners rounding in: always inside the
// video, never the video seen through the panel. Each corner of it is a polynomial in --p.
export function holePolygon(width, height, L, r) {
  const outer = `0px 0px, ${width}px 0px, ${width}px ${height}px, 0px ${height}px, 0px 0px`;
  const { card: [x, y, w, h], scale: S, left: X, top: Y } = L.speaker;
  if (w < 1 || h < 1) return `polygon(${outer})`;
  const k = S - 1;
  const end = [x <= 1 ? -r : x, y <= 1 ? -r : y, x + w >= width - 1 ? width + r : x + w, y + h >= height - 1 ? height + r : y + h];
  // the hole's sides in the video's own px: from the whole frame to the card's part of the video
  const q0 = [0, 0, width, height], q1 = [(end[0] - X) / S, (end[1] - Y) / S, (end[2] - X) / S, (end[3] - Y) / S];
  // a side on the frame at --p: shift·p + (1 + k·p)·(q0 + (q1 − q0)·p) = a + b·p + c·p²
  const side = (i, shift) => { const a = q0[i], d = q1[i] - q0[i]; return [a, shift + d + k * a, k * d]; };
  const sides = { l: side(0, X), t: side(1, Y), r: side(2, X), b: side(3, Y) };
  const f = (v) => +v.toFixed(2);
  const calc = ([a, b, c], extra) => `calc(${f(a)}px + ${f(b + extra)}px * var(--p) + ${f(c)}px * var(--p) * var(--p))`;
  // the corners, each an arc of radius r·p: its centre r·p in from both sides
  const corners = [["l", "t", 1, 1, 180], ["r", "t", -1, 1, 270], ["r", "b", -1, -1, 0], ["l", "b", 1, -1, 90]];
  const STEPS = 6, pts = [];
  for (const [sx, sy, dx, dy, from] of corners) {
    for (let i = 0; i <= STEPS; i++) {
      const a = ((from + (90 * i) / STEPS) * Math.PI) / 180;
      pts.push(`${calc(sides[sx], r * (dx + Math.cos(a)))} ${calc(sides[sy], r * (dy + Math.sin(a)))}`);
    }
  }
  return `polygon(evenodd, ${outer}, ${pts.join(", ")}, ${pts[0]})`;
}

// The host's script that moves the person into their field for the beats beside them and back:
// GSAP on the host's own timeline (found from the wrapper), at the composition's time (the b-roll
// is mounted at 0). Beats that touch are one stretch: the person stays. Next to a beat over the
// whole frame the person is set in place, unseen, instead of moved.
// The captions go to their other place while the person moves (`seconds` from `at` on), or at
// once beside a cut. Their way between the band over the head and their place under the face
// leads across the face, so they do not travel it: they fade out, change place unseen at the
// move's middle and fade in again.
const CAPTIONS_FADE = 0.3;   // of the move, at each of its ends
function captionsTo(place, seconds, at) {
  if (!seconds) return `if (cap) tl.set(cap, ${place}, ${n(at)});`;
  const fade = seconds * CAPTIONS_FADE;
  return `if (cap) { tl.fromTo(cap, { opacity: 1 }, { opacity: 0, duration: ${n(fade)}, ease: "power1.in", immediateRender: false }, ${n(at)}); ` +
    `tl.set(cap, ${place}, ${n(at + seconds / 2)}); ` +
    `tl.fromTo(cap, { opacity: 0 }, { opacity: 1, duration: ${n(fade)}, ease: "power1.out", immediateRender: false }, ${n(at + seconds - fade)}); }`;
}

export function personMotion(beats) {
  const side = beats.filter((b) => b.fit === "beside");
  if (!side.length) return null;
  const runs = [];
  for (const b of side) {
    const last = runs.at(-1);
    if (last && last.at(-1).leave === "cut" && b.enter === "cut" && Math.abs(last.at(-1).end - b.start) < 0.01) last.push(b);
    else runs.push([b]);
  }
  const home = "{ x: 0, y: 0, scale: 1 }";
  const lines = [`tl.set(el, { transformOrigin: "0 0", x: 0, y: 0, scale: 1 }, 0);`, `if (cap) tl.set(cap, { x: 0, y: 0 }, 0);`];
  for (const run of runs) {
    const first = run[0], last = run.at(-1), P = first.layout.speaker, c = first.layout.captions?.shift || { x: 0, y: 0 };
    const there = `{ x: ${P.left}, y: ${P.top}, scale: ${P.scale}`;
    lines.push(first.enter === "move"
      ? `tl.fromTo(el, ${home}, ${there}, duration: ${n(first.moveIn)}, ease: "power2.inOut", immediateRender: false }, ${n(first.start)});`
      : `tl.set(el, ${there} }, ${n(first.start)});`);
    lines.push(last.leave === "move"
      ? `tl.fromTo(el, ${there} }, ${home.replace(/ \}$/, "")}, duration: ${n(last.moveOut)}, ease: "power2.inOut", immediateRender: false }, ${n(last.end - last.moveOut)});`
      : `tl.set(el, ${home}, ${n(last.end)});`);
    if (c.x || c.y) {
      lines.push(captionsTo(`{ x: ${c.x}, y: ${c.y} }`, first.enter === "move" ? first.moveIn : 0, first.start));
      lines.push(captionsTo("{ x: 0, y: 0 }", last.leave === "move" ? last.moveOut : 0, last.leave === "move" ? last.end - last.moveOut : last.end));
    }
  }
  return `<script id="${PERSON}-motion">(function () { var el = document.getElementById("${PERSON}"); var cap = document.getElementById("captions"); var host = el && el.closest("[data-composition-id]"); var tl = host && window.__timelines[host.getAttribute("data-composition-id")]; if (!tl) return; ${lines.join(" ")} })();</script>`;
}

// The clip that mounts the b-roll in a host composition: the whole length, under the captions
// (put it before them: the later element is painted on top).
export function mount({ dir = ID, width, height, duration, track = 5 }) {
  return `<div id="${ID}" data-composition-id="${ID}" data-composition-src="${dir}/index.html" data-start="0" data-duration="${n(duration)}" data-track-index="${track}" data-width="${width}" data-height="${height}"></div>`;
}
