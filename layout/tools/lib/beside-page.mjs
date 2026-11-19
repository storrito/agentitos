// A candidate of `beside` as a page of one frame, in the form platform-zones' layout check reads
// (as lib/page.mjs makes them for place's candidates): the material in its field, marked
// data-zone="face" so that the checker holds it clear of what the apps cover and of the captions;
// the speaker's still cut to its field (a circle for pip); the speaker's face marked and outlined
// with dashes; the captions as placeholder words of the usual length.
//
//   renderBeside(candidate, result, { stills, page, at }) → html
//     stills: [the speaker's picture, the material as a picture] (either may be missing: the
//     speaker is then drawn as an oval, the material as a plain card); page: where the html will
//     lie, so that the pictures are linked from there; at: the moment of a face that moves

import path from "node:path";
import { r1 } from "./boxes.mjs";

const CAP_LINES = ["plan your week", "of Stories", "in one sitting", "with one click"];

export function renderBeside(c, res, { stills = null, page = null, at = null } = {}) {
  const [W, H] = res.size, D = res.defaults, [sw, sh] = res.speaker.source;
  const rel = (f) => (f ? (page ? path.relative(path.dirname(path.resolve(page)), path.resolve(f)) : f).split(path.sep).join("/") : null);
  const [who, what] = [rel(stills?.[0]), rel(stills?.[1])];
  const font = `"Noto Sans","DejaVu Sans","Liberation Sans",sans-serif`;
  const st = (b) => `left:${r1(b[0])}px;top:${r1(b[1])}px;width:${r1(b[2])}px;height:${r1(b[3])}px`;
  const css = `html,body{margin:0;background:#000}
#frame{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#14181d;font-family:${font};font-weight:800;color:#fff}
#frame img{position:absolute;display:block}
.clip{position:absolute;overflow:hidden}
.area{position:absolute;overflow:hidden;background:#232a33}
.card{position:absolute;background:linear-gradient(160deg,#fbfaf7,#ece6da);border-radius:18px}
.card i{position:absolute;left:10%;right:10%;border-radius:12px;background:#23324a}
.ph{position:absolute;background:linear-gradient(180deg,#8fa3b8,#5f7388 55%,#3d4c5c)}
.ph i{position:absolute;border-radius:48%/42%;background:#e2b79a;box-shadow:0 0 0 3px rgba(0,0,0,.25)}
[data-zone=face]{position:absolute}
.face,.moment{outline:3px dashed rgba(255,255,255,.95);box-shadow:0 0 0 1px rgba(0,0,0,.55)}
.hull{outline:2px dotted rgba(255,255,255,.45)}
.moment{position:absolute}
.field{outline:2px dashed rgba(42,120,214,.8)}
.round{border-radius:50%;box-shadow:0 0 0 6px #fff}
.cap{position:absolute;text-align:center;line-height:${D.caption.line}}
.cap span{background:rgba(0,0,0,.74);padding:.06em .34em;border-radius:14px;-webkit-box-decoration-break:clone;box-decoration-break:clone}`;
  const parts = [];
  // the material: a plain ground over its area (where the material's own ground may run: a card
  // that fills its area with its colour is the builder's), the picture itself in its field, whole
  const m = c.material, A = m.area, F = m.field;
  parts.push(`<div class="area" style="${st(A)}"></div>`);
  parts.push(`<div data-zone="face" data-label="material" class="field" style="${st(F)}">${what
    ? `<img src="${what}" style="left:0;top:0;width:100%;height:100%;object-fit:contain">`
    : `<div class="card" style="left:0;top:0;width:100%;height:100%"><i style="top:22%;height:34%"></i><i style="top:66%;height:10%;right:30%"></i></div>`}</div>`);
  // the speaker: the still at its scale and place, cut to its card (the window, or the part of it
  // under captions on the seam: what a caller shows), in its field; ground (a blurred copy) where
  // the picture does not cover the field
  const q = c.speaker, Fs = q.field, round = q.shape === "circle", K = q.card || q.window || Fs;
  const cut = K.some((v, k) => Math.abs(v - (q.window || Fs)[k]) > 0.05);
  const pic = [q.left - K[0], q.top - K[1], q.scale * sw, q.scale * sh];
  const ovals = res.speaker && !who ? `<i style="${st([res.speaker.face[0] * q.scale, res.speaker.face[1] * q.scale, res.speaker.face[2] * q.scale, res.speaker.face[3] * q.scale])}"></i>` : "";
  const ground = (q.ground > 0 || cut) && who ? (() => { const k = Math.max(Fs[2] / sw, Fs[3] / sh) * 1.17; return `<img src="${who}" style="${st([(Fs[2] - k * sw) / 2, (Fs[3] - k * sh) / 2, k * sw, k * sh])};filter:blur(36px) brightness(.5)">`; })() : "";
  const picture = who ? `<img src="${who}" style="${st(pic)}">` : `<div class="ph" style="${st(pic)}">${ovals}</div>`;
  parts.push(`<div class="clip${round ? " round" : ""}"${round ? ` data-zone="face" data-label="speaker's circle"` : ""} style="${st(Fs)}">${ground}<div class="clip" style="${st([K[0] - Fs[0], K[1] - Fs[1], K[2], K[3]])}">${picture}</div></div>`);
  // the speaker's face as placed (a face that moves: its hull dotted, its box at this moment dashed)
  const f = c.faceInFrame[1];
  const tr = at != null ? (res.tracks || [])[0] : null;
  if (tr) {
    const b = tr.boxes.reduce((a, x) => (Math.abs(x.t - at) < Math.abs(a.t - at) ? x : a), tr.boxes[0]).box;
    parts.push(`<div data-zone="face" data-label="speaker" class="hull" style="${st(f)}"></div>`);
    parts.push(`<div class="moment" style="${st([q.left + q.scale * b[0], q.top + q.scale * b[1], q.scale * b[2], q.scale * b[3]])}"></div>`);
  } else parts.push(`<div data-zone="face" data-label="speaker" class="face" style="${st(f)}"></div>`);
  // The captions: placeholder lines that fit the area's width at its type (about 0.62 em a
  // letter); a band from captions (its area.json, or a style measured by its build) is its lines'
  // boxes, so its lines are drawn exactly that tall, one line box each; the layout skill's own
  // band holds a style's box around lines 1.3 em apart.
  for (const t of c.text) {
    const [x, y, w, h] = t.box, fits = (l) => l.length * 0.62 * t.font <= w;
    const lines = Array.from({ length: t.lines }, (_, i) => [CAP_LINES[i % CAP_LINES.length], "of Stories", "Stories", "go"].find(fits) || "go");
    if (t.lineBox) parts.push(`<div class="cap" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;font-size:${t.font}px;line-height:${r1(h / t.lines)}px;text-align:${t.align};white-space:nowrap">${lines.map((l) => `<span style="padding-top:0;padding-bottom:0">${l}</span>`).join("<br>")}</div>`);
    else parts.push(`<div class="cap" style="left:${x}px;width:${w}px;bottom:${r1(H - y - h + D.caption.padEm * t.font / 2)}px;font-size:${t.font}px;text-align:${t.align};white-space:nowrap">${lines.map((l) => `<span>${l}</span>`).join("<br>")}</div>`);
  }
  const meta = { fit: c.fit, material: c.material, speaker: c.speaker, captions: c.captions, change: c.change, problems: c.problems };
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div id="frame" data-composition-id="layout" data-width="${W}" data-height="${H}">
${parts.join("\n")}
</div>
<script type="application/json" id="placement">${JSON.stringify(meta).replace(/</g, "\\u003c")}</script>
</body></html>`;
}
