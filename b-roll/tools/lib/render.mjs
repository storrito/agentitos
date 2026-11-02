// The b-roll as a HyperFrames sub-composition, broll/index.html, which a host composition mounts as
// one clip (mount()) under its captions. Every beat is a clip of its own at its time: a picture or
// a muted video, and behind one shown whole or to be read a blurred copy of itself (or the brand's
// colour); a number is a card. Everything the runtime needs is inside the <template>; the host
// slot, the root and the timeline share the id "broll". Pictures that fill the frame or are shown
// whole move in slowly (at most 1.5 % a second, 6 % in all), rendered by the browser's transform,
// sub-pixel: no stutter. The cut in and out is hard.
//
//   writeBroll(out, { beats, width, height, duration, zones, brand })
//   mount({ dir, width, height, duration, track })   → the host's clip

import fs from "node:fs";
import path from "node:path";

export const ID = "broll";
const n = (x) => +x.toFixed(3);
const px = (x) => Math.round(x);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const googleFont = (family, weight) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}${weight ? `:wght@${weight}` : ""}&display=swap`;
const luma = (hex) => { const v = parseInt(String(hex).slice(1), 16); return 0.2126 * (v >> 16) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255); };

export const ZOOM = { rate: 0.015, most: 0.06 };

// The box for what must be read: the box the apps leave free (platform-zones' centred box), less
// the band at its bottom where the captions sit (captions skill: the lowest line at that box's
// bottom, two lines at most), so that neither covers the other.
export function readBox({ width, height, zones }) {
  const [x, y, w, h] = zones.centred;
  const band = Math.round(320 * Math.min(width, height) / 1080);
  return [x, y, w, Math.max(h * 0.5, h - band)];
}

// where a beat's picture goes, in px of the frame: fill covers the frame, whole fits into it,
// read fits into the read box
export function rectOf(beat, { width, height, zones }) {
  if (beat.fit === "fill") return { x: 0, y: 0, w: width, h: height, scale: Math.max(width / beat.w, height / beat.h) };
  const [bx, by, bw, bh] = beat.fit === "read" ? readBox({ width, height, zones }) : [0, 0, width, height];
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
  const timing = (b) => `data-start="${n(b.start)}" data-duration="${n(b.duration)}" data-track-index="${b.track}"`;
  const [rx, ry, rw, rh] = readBox({ width, height, zones });
  for (const b of beats) {
    const id = `broll-${String(b.n).padStart(2, "0")}`;
    if (b.kind === "number") {
      els.push(`<div id="${id}" class="clip broll-card" ${timing(b)}><div id="${id}-figure" class="broll-figure">${esc(b.number)}</div>${b.label ? `<div class="broll-label">${esc(b.label)}</div>` : ""}</div>`);
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
      const r = b.fit === "read" ? rectOf(b, { width, height, zones }) : { x: rx, y: ry, w: rw, h: rh };
      els.push(`<div id="${id}-credit" class="clip broll-credit" ${timing(b)}>${esc(b.credit)}</div>`);
      css.push(`#${id}-credit { right: ${px(width - r.x - r.w)}px; top: ${px(r.y + r.h + 12 * short)}px; }`);
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
        .broll-credit { position: absolute; color: rgba(255,255,255,0.85);
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
          // a number as big as fits in one line, once the font is there
          function fit() {
            Array.prototype.forEach.call(document.querySelectorAll(".broll-figure"), function (el) {
              var room = el.parentNode.clientWidth - parseFloat(getComputedStyle(el.parentNode).paddingLeft) - parseFloat(getComputedStyle(el.parentNode).paddingRight);
              var s = ${px(300 * short)};
              el.style.fontSize = s + "px";
              while (s > ${px(60 * short)} && el.scrollWidth > room) { s -= 4; el.style.fontSize = s + "px"; }
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

// The clip that mounts the b-roll in a host composition: the whole length, under the captions
// (put it before them: the later element is painted on top).
export function mount({ dir = ID, width, height, duration, track = 5 }) {
  return `<div id="${ID}" data-composition-id="${ID}" data-composition-src="${dir}/index.html" data-start="0" data-duration="${n(duration)}" data-track-index="${track}" data-width="${width}" data-height="${height}"></div>`;
}
