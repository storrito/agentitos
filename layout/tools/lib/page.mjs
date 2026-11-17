// One candidate as a page that shows one frame, in the form platform-zones' layout check reads:
// the frame as a root with data-composition-id, the still as an <img> at its place (clipped to its
// window, over a blurred darker copy where ground shows), every face marked data-zone="face", the
// text as elements. Without a still the picture is a drawn surface with each face as an oval.
// The words are placeholders of the usual length: two caption lines, a hook of two lines.
//
//   renderPage(candidate, result, { still | stills, page }) → html
//     still: a picture file (stills: one per source); page: where the html will lie, so that the
//     pictures are linked from there

import path from "node:path";
import { r1 } from "./boxes.mjs";

const CAP_LINES = ["eure Instagram-Storys", "für die ganze Woche", "ganz einfach vorplanen", "mit einem Klick"];
const HOOK_LINES = ["Storys für die ganze", "Woche vorplanen"];
export function renderPage(c, res, { still = null, stills = null, page = null } = {}) {
  const [W, H] = res.size, D = res.defaults;
  const font = `"Noto Sans","DejaVu Sans","Liberation Sans",sans-serif`;
  // the sources and their stills (one still: the first source's)
  const sources = res.sources || [{ size: res.source, faces: res.faces }];
  const rel = (f) => (f ? (page ? path.relative(path.dirname(path.resolve(page)), path.resolve(f)) : f).split(path.sep).join("/") : null);
  const srcs = sources.map((q, i) => rel((stills || [still])[i]));
  const [sw, sh] = sources[0].size, src = srcs[0];
  const css = `html,body{margin:0;background:#000}
#frame{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#14181d;font-family:${font};font-weight:800;color:#fff}
#frame img{position:absolute;display:block}
.clip{position:absolute;overflow:hidden}
.ground{position:absolute;left:0;top:0;width:100%;height:100%;background:linear-gradient(160deg,#2b3440,#11161c)}
.ph{position:absolute;background:linear-gradient(180deg,#8fa3b8,#5f7388 55%,#3d4c5c)}
.ph i{position:absolute;border-radius:48%/42%;background:#e2b79a;box-shadow:0 0 0 3px rgba(0,0,0,.25)}
.ph.scr{background:repeating-linear-gradient(180deg,#e9edf1 0 22px,#dfe5ea 22px 24px)}
.ph.scr i{border-radius:6px;background:#fff;box-shadow:0 0 0 4px #2a78d6}
.cam{position:absolute;border-radius:50%;background:radial-gradient(circle at 50% 42%,#e2b79a 0 22%,#5f7388 23%);box-shadow:0 0 0 6px #fff}
[data-zone=face]{position:absolute}
.cap{position:absolute;text-align:center;line-height:${D.caption.line}}
.cap span{background:rgba(0,0,0,.74);padding:.06em .34em;border-radius:14px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.card{position:absolute;background:#fff;color:#14181d;border-radius:28px;display:flex;align-items:center;justify-content:center;text-align:center;line-height:${D.hookCard.line}}
.big{position:absolute;line-height:${D.hookBig.line};white-space:nowrap;text-shadow:0 2px 18px rgba(0,0,0,.55)}`;
  const st = (b) => `left:${r1(b[0])}px;top:${r1(b[1])}px;width:${r1(b[2])}px;height:${r1(b[3])}px`;
  const parts = [];
  // the ground: a blurred, darker copy of the still that covers the frame
  if (c.ground > 0) {
    const k = Math.max(W / sw, H / sh) * 1.17;
    parts.push(src ? `<img src="${src}" style="${st([(W - k * sw) / 2, (H - k * sh) / 2, k * sw, k * sh])};filter:blur(36px) brightness(.5)">` : `<div class="ground"></div>`);
  }
  // each picture: the still at its place, clipped to its window where the window is smaller
  const pictures = c.parts ? c.parts.map((q) => ({ i: q.source - 1, scale: q.scale, pic: [q.left, q.top, q.scale * sources[q.source - 1].size[0], q.scale * sources[q.source - 1].size[1]], win: q.window, clip: true }))
    : [{ i: 0, scale: c.scale, pic: [c.left, c.top, c.scale * sw, c.scale * sh], win: c.window, clip: c.ground > 0 && (Math.abs(c.window[2] - c.scale * sw) > 1 || Math.abs(c.window[3] - c.scale * sh) > 1) }];
  for (const { i, scale, pic, win, clip } of pictures) {
    const ovals = sources[i].faces.map((f) => `<i style="${st([f[0] * scale, f[1] * scale, f[2] * scale, f[3] * scale])}"></i>`).join("");
    const picture = (b) => (srcs[i] ? `<img src="${srcs[i]}" style="${st(b)}">` : `<div class="ph${res.screen ? " scr" : ""}" style="${st(b)}">${ovals}</div>`);
    parts.push(clip ? `<div class="clip" style="${st(win)}">${picture([pic[0] - win[0], pic[1] - win[1], pic[2], pic[3]])}</div>` : picture(pic));
  }
  for (const f of c.faceInFrame) parts.push(`<div data-zone="face"${res.screen ? ` data-label="region"` : ""} style="${st(f)}"></div>`);
  if (c.circle) parts.push(`<div class="cam" data-zone="face" data-label="webcam" style="${st(c.circle.box)}"></div>`);
  for (const t of c.text) {
    const [x, y, w, h] = t.box;
    if (t.style === "cap") {
      const lines = t.lines === 1 ? [CAP_LINES[1]] : Array.from({ length: t.lines }, (_, i) => CAP_LINES[i % CAP_LINES.length]);
      parts.push(`<div class="cap" style="left:${x}px;width:${w}px;bottom:${r1(H - y - h)}px;font-size:${t.font}px;text-align:${t.align};white-space:nowrap">${lines.map((l) => `<span>${l}</span>`).join("<br>")}</div>`);
    } else if (t.style === "card") parts.push(`<div class="card" style="${st(t.box)};font-size:${t.font}px">${HOOK_LINES.join("<br>")}</div>`);
    else parts.push(`<div class="big" style="left:${x}px;top:${y}px;width:${w}px;font-size:${t.font}px;text-align:${t.align}">${HOOK_LINES.join("<br>")}</div>`);
  }
  const meta = { fit: c.fit, scale: c.scale, left: c.left, top: c.top, window: c.window, ...(c.parts ? { parts: c.parts } : {}), faceInFrame: c.faceInFrame, text: c.text.map(({ role, where, box }) => ({ role, where, box })), problems: c.problems };
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div id="frame" data-composition-id="probe" data-width="${W}" data-height="${H}">
${parts.join("\n")}
</div>
<script type="application/json" id="placement">${JSON.stringify(meta).replace(/</g, "\\u003c")}</script>
</body></html>`;
}
