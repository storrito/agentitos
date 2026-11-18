// One candidate as a page that shows one frame, in the form platform-zones' layout check reads:
// the frame as a root with data-composition-id, the still as an <img> at its place (clipped to its
// window, over a blurred darker copy where ground shows), every face marked data-zone="face", the
// text as elements. Without a still the picture is a drawn surface with each face as an oval.
// Each face's box (a screen's region) is outlined with dashes, so that whoever looks sees whether
// the box was read right; an outline changes nothing of what the checker measures.
// The words are placeholders of the usual length: caption lines of three words, a hook of two lines.
//
//   renderPage(candidate, result, { still | stills, page }) → html
//     still: a picture file (stills: one per source); page: where the html will lie, so that the
//     pictures are linked from there

import path from "node:path";
import { r1 } from "./boxes.mjs";
import { GROUND_ZOOM } from "./evaluate.mjs";

// A caption line of three words, as most are in published Shorts (the median of 188): the type
// is so large that the centred area of the usual vertical platforms holds about sixteen letters.
const CAP_LINES = ["plan your week", "of Stories", "in one sitting", "with one click"];
// a hook of about six words in two lines, as the median hook text of published Shorts has
// (a card and big lines hold about eighteen letters a line, the text in the middle about thirteen:
// its type is larger and it stands between the apps' buttons)
const HOOK_LINES = ["Plan a whole week", "of Stories at once"], HOOK_TEXT = ["Plan a week", "of Stories"];
export function renderPage(c, res, { still = null, stills = null, page = null, at = null } = {}) {
  const [W, H] = res.size, D = res.defaults;
  const font = `"Noto Sans","DejaVu Sans","Liberation Sans",sans-serif`;
  // the sources and their stills (one still: the first source's)
  const sources = res.sources || [{ size: res.source, faces: res.faces }];
  const rel = (f) => (f ? (page ? path.relative(path.dirname(path.resolve(page)), path.resolve(f)) : f).split(path.sep).join("/") : null);
  // a webcam baked into the screen shows the screen's own still
  const srcs = sources.map((q, i) => rel((stills || [still])[i] || (q.baked ? (stills || [still])[0] : null)));
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
[data-zone=face]:not(.cam):not(.hull),.moment{outline:3px dashed rgba(255,255,255,.95);box-shadow:0 0 0 1px rgba(0,0,0,.55)}
.hull{outline:2px dotted rgba(255,255,255,.45)}
.moment{position:absolute}
.cap{position:absolute;text-align:center;line-height:${D.caption.line}}
.cap span{background:rgba(0,0,0,.74);padding:.06em .34em;border-radius:14px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.card{position:absolute;background:#fff;color:#14181d;border-radius:28px;display:flex;align-items:center;justify-content:center;text-align:center;line-height:${D.hookCard.line}}
.hooktext{position:absolute;display:flex;align-items:center;justify-content:center;text-align:center;line-height:${D.hookText.line};white-space:nowrap;-webkit-text-stroke:.06em #14181d;paint-order:stroke fill;text-shadow:0 4px 18px rgba(0,0,0,.6)}
.big{position:absolute;line-height:${D.hookBig.line};white-space:nowrap;text-shadow:0 2px 18px rgba(0,0,0,.55)}`;
  const st = (b) => `left:${r1(b[0])}px;top:${r1(b[1])}px;width:${r1(b[2])}px;height:${r1(b[3])}px`;
  const parts = [];
  // the ground: a blurred, darker copy of the still that covers the frame
  if (c.ground > 0) {
    const k = Math.max(W / sw, H / sh) * GROUND_ZOOM;
    parts.push(src ? `<img src="${src}" style="${st([(W - k * sw) / 2, (H - k * sh) / 2, k * sw, k * sh])};filter:blur(36px) brightness(.5)">` : `<div class="ground"></div>`);
  }
  // each picture: the still at its place, clipped to its window where the window is smaller
  const pictures = c.parts ? c.parts.map((q) => ({ i: q.source - 1, scale: q.scale, pic: [q.left, q.top, q.scale * sources[q.source - 1].size[0], q.scale * sources[q.source - 1].size[1]], win: q.window, clip: true }))
    : [{ i: 0, scale: c.scale, pic: [c.left, c.top, c.scale * sw, c.scale * sh], win: c.window, clip: c.ground > 0 && (Math.abs(c.window[2] - c.scale * sw) > 1 || Math.abs(c.window[3] - c.scale * sh) > 1) }];
  for (const { i, scale, pic, win, clip } of pictures) {
    const ovals = sources[i].faces.map((f) => `<i style="${st([f[0] * scale, f[1] * scale, f[2] * scale, f[3] * scale])}"></i>`).join("");
    const picture = (b) => (srcs[i] ? `<img src="${srcs[i]}" style="${st(b)}">` : `<div class="ph${res.screen && !i ? " scr" : ""}" style="${st(b)}">${ovals}</div>`);
    parts.push(clip ? `<div class="clip" style="${st(win)}">${picture([pic[0] - win[0], pic[1] - win[1], pic[2], pic[3]])}</div>` : picture(pic));
  }
  // A face that moves is held by the hull of its boxes: on the picture of one moment the hull shows
  // thin and dotted, and the face's box at that moment dashed, so that whoever looks sees whether
  // that moment's box sits on the face
  const scales = c.parts ? c.parts.map((q) => q.scale) : [c.scale];
  const momentOf = (f) => {
    if (at == null) return null;
    for (const tr of res.tracks || []) {
      const sx = f[2] / tr.hull[2], sy = f[3] / tr.hull[3];
      if (Math.abs(sx - sy) > 2e-3 * sx || !scales.some((v) => Math.abs(v - sx) < 2e-3 * v)) continue;
      const m = (tr.boxes || []).reduce((a, b) => (Math.abs(b.t - at) < Math.abs(a.t - at) ? b : a), (tr.boxes || [])[0]);
      if (m) return [f[0] + sx * (m.box[0] - tr.hull[0]), f[1] + sy * (m.box[1] - tr.hull[1]), sx * m.box[2], sy * m.box[3]];
    }
    return null;
  };
  c.faceInFrame.forEach((f, k) => {
    const m = momentOf(f);
    parts.push(`<div data-zone="face"${m ? ' class="hull"' : ""}${res.screen ? ` data-label="${k ? "webcam" : "region"}"` : ""} style="${st(f)}"></div>`);
    if (m) parts.push(`<div class="moment" style="${st(m)}"></div>`);
  });
  // the part of another person's face that shows: the checker judges it as any face
  for (const o of c.others || []) parts.push(`<div data-zone="face" data-label="${o.of}" style="${st(o.box)}"></div>`);
  // the webcam's circle: its square of the webcam's picture where there is a still of it (a baked
  // webcam: the screen's own still), else a drawn face
  const camStill = srcs[1], camSize = sources[1]?.size;
  if (c.circle && c.circle.crop && camStill && camSize) {
    const [cx, cy, side] = c.circle.crop, k = c.circle.box[2] / side;
    parts.push(`<div class="cam" data-zone="face" data-label="webcam" style="${st(c.circle.box)};overflow:hidden;background:#000"><img src="${camStill}" style="${st([-cx * k, -cy * k, camSize[0] * k, camSize[1] * k])}"></div>`);
  } else if (c.circle) parts.push(`<div class="cam" data-zone="face" data-label="webcam" style="${st(c.circle.box)}"></div>`);
  for (const t of c.text) {
    const [x, y, w, h] = t.box;
    if (t.style === "cap") {
      const lines = Array.from({ length: t.lines }, (_, i) => CAP_LINES[i % CAP_LINES.length]);
      parts.push(`<div class="cap" style="left:${x}px;width:${w}px;bottom:${r1(H - y - h + D.caption.padEm * t.font / 2)}px;font-size:${t.font}px;text-align:${t.align};white-space:nowrap">${lines.map((l) => `<span>${l}</span>`).join("<br>")}</div>`);
    } else if (t.style === "text") parts.push(`<div class="hooktext" style="${st(t.box)};font-size:${t.font}px">${HOOK_TEXT.join("<br>")}</div>`);
    else if (t.style === "card") parts.push(`<div class="card" style="${st(t.box)};font-size:${t.font}px">${HOOK_LINES.join("<br>")}</div>`);
    else parts.push(`<div class="big" style="left:${x}px;top:${y}px;width:${w}px;font-size:${t.font}px;text-align:${t.align}">${HOOK_LINES.join("<br>")}</div>`);
  }
  const meta = { fit: c.fit, scale: c.scale, left: c.left, top: c.top, window: c.window, ...(c.parts ? { parts: c.parts } : {}), faceInFrame: c.faceInFrame, text: c.text.map(({ role, where, box }) => ({ role, where, box })), problems: c.problems };
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div id="frame" data-composition-id="layout" data-width="${W}" data-height="${H}">
${parts.join("\n")}
</div>
<script type="application/json" id="placement">${JSON.stringify(meta).replace(/</g, "\\u003c")}</script>
</body></html>`;
}
