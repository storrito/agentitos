// A story frame as a page of its own, 1080×1920: the brand's colours and fonts, a layout of the
// frame's kind, its text fitted to the room, Storrito's sticker components where the stickers go.
// `framePage()` writes the HTML; `inFrame` runs in Chrome and fits, measures and checks it.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { contrast, mix } from "./colors.mjs";
import { zones } from "./zones.mjs";

export const W = 1080, H = 1920;
// What Instagram lays over a story (its bar at the top, the reply field at the bottom), from
// agentitos' platform-zones skill: the frame's column keeps inside its safe box; the build checks
// the laid-out frame with platform-zones' layout check.
// Asked when a frame is laid out or checked, so that publishing and the status work without it.
let safe = null;
export function safeZone() {
  if (!safe) {
    let z;
    try { z = zones(W, H, ["instagram-story"]); } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
    const [x, y, w, h] = z.safe;
    safe = { top: y, bottom: y + h, left: x, right: x + w };
  }
  return safe;
}

export const KINDS = ["cover", "text", "list", "quote", "stat", "image", "product", "event", "cta"];
export const STICKERS = {
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

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// *a few words* stand out in the accent colour; a line break stays one
const rich = (s) => esc(s).replace(/\*([^*]+)\*/g, "<mark>$1</mark>").replace(/\n/g, "<br>");

const fileUrl = (f) => (/^(https?:|data:|file:)/.test(f) ? f : pathToFileURL(f).href);

// a picture of the frame: a path relative to the story's folder, the working directory, or a URL
export function resolveImage(src, storyDir) {
  if (!src) return null;
  if (/^(https?:|data:)/.test(src)) return src;
  for (const p of [path.resolve(storyDir, src), path.resolve(src)]) if (fs.existsSync(p)) return p;
  return null;
}

// the brand's fonts as @font-face rules: Google's CSS fetched once, the kit's own files as files
export async function fontCss(brand) {
  const used = {};
  for (const f of Object.values(brand.fonts)) if (f?.family) (used[f.family] ||= new Set()).add(f.weight || 400);
  const parts = [];
  for (const [family, weights] of Object.entries(used)) {
    const src = brand.fontSources[family];
    if (src === "google") {
      const fam = encodeURIComponent(family).replace(/%20/g, "+");
      const ws = [...new Set([...weights, 400, 700])].sort((a, b) => a - b).join(";");
      for (const q of [`family=${fam}:wght@${ws}`, `family=${fam}:wght@100..900`, `family=${fam}`]) {
        try {
          const res = await fetch(`https://fonts.googleapis.com/css2?${q}&display=block`, { headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36" }, signal: AbortSignal.timeout(10000) });
          if (res.ok) { parts.push(await res.text()); break; }
        } catch {}
      }
    } else if (Array.isArray(src)) {
      for (const s of src) if (s.file && fs.existsSync(s.file)) parts.push(`@font-face{font-family:"${family}";src:url("${fileUrl(s.file)}");font-weight:${parseInt(s.weight, 10) || 400};font-style:normal;font-display:block}`);
    }
  }
  return parts.join("\n");
}

const stack = (f, fallback) => (f?.family ? `"${f.family}", ${fallback}` : fallback);

function themeVars(brand, theme) {
  const c = brand.colors;
  const accent = c.secondary || c.tertiary || c.primary;
  const onAccent = c.secondary ? c.onSecondary : c.tertiary ? c.onTertiary : c.onPrimary;
  // the highlight must stand out from the ground: on the brand colour the second colour, else the brand colour
  const pickHl = (bg, options) => options.find(([hl]) => hl && contrast(hl, bg) >= 1.6) || options[options.length - 1];
  if (theme === "brand") {
    const [hl, onHl] = pickHl(c.primary, [[accent, onAccent], [c.surface, c.ink], [c.ink, c.surface]]);
    return { bg: c.primary, fg: c.onPrimary, hl, onHl, soft: mix(c.primary, c.onPrimary, 0.08) };
  }
  if (theme === "dark") {
    const [hl, onHl] = pickHl(c.ink, [[c.primary, c.onPrimary], [accent, onAccent], [c.surface, c.ink]]);
    return { bg: c.ink, fg: c.surface, hl, onHl, soft: mix(c.ink, c.surface, 0.07) };
  }
  if (theme === "photo") {
    const [hl, onHl] = pickHl("#000000", [[c.primary, c.onPrimary], [accent, onAccent], [c.surface, c.ink]]);
    return { bg: "#000000", fg: "#FFFFFF", hl, onHl, soft: "rgba(255,255,255,.1)" };
  }
  const [hl, onHl] = pickHl(c.surface, [[c.primary, c.onPrimary], [accent, onAccent], [c.ink, c.surface]]);
  return { bg: c.surface, fg: c.ink, hl, onHl, soft: mix(c.surface, c.primary, 0.1) };
}

// what a frame without a theme gets: a photo on the cover when there is one, the brand colour to
// open and close, light and brand by turns in between
export function defaultTheme(frame, i, n) {
  if (frame.theme) return frame.theme;
  if (frame.kind === "cover") return frame.image ? "photo" : "brand";
  if (frame.kind === "cta") return "brand";
  if (frame.kind === "image" && frame.image) return "photo";
  return i % 2 === 1 ? "light" : "brand";
}

function stickerHtml(s, storyLink) {
  const def = STICKERS[s.type];
  if (!def) return "";
  const attrs = { ...s };
  if (s.type === "link") attrs.url = s.url || storyLink;
  if (Array.isArray(attrs.options)) attrs.options = JSON.stringify(attrs.options);
  const list = def.attrs.filter((a) => attrs[a] != null && attrs[a] !== "").map((a) => {
    const v = String(attrs[a]);
    return v.includes('"') ? ` ${a}='${v.replace(/'/g, "&#39;")}'` : ` ${a}="${esc(v)}"`;
  }).join("");
  const rot = s.rotate ? ` style="transform:rotate(${Number(s.rotate)}deg)"` : "";
  return `<${def.tag}${list}${rot}></${def.tag}>`;
}

// the frame's stickers in one group; a link sticker gets an arrow pointing at it
function stickersBlock(frame, storyLink) {
  const list = frame.stickers || [];
  if (!list.length) return "";
  return `<div class="stickers">${list.map((s) => `<div class="sticker">${stickerHtml(s, storyLink)}${s.type === "link" && frame.arrow !== false ? ARROW : ""}</div>`).join("")}</div>`;
}

const ARROW = `<svg class="arrow" viewBox="0 0 160 120" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20 C 40 96, 92 100, 138 66"/><path d="M104 54 L 140 64 L 122 98"/></svg>`;

const img = (src) => (src ? fileUrl(src) : null);

function layout(frame, ctx) {
  const k = frame.kicker ? `<div class="kicker">${rich(frame.kicker)}</div>` : "";
  const title = (cls, size) => (frame.title ? `<h1 class="title ${cls || ""}" data-fit="${size}">${rich(frame.title)}</h1>` : "");
  const body = frame.body ? `<p class="body" data-fit="34,54">${rich(frame.body)}</p>` : "";
  const st = stickersBlock(frame, ctx.link);
  const image = img(ctx.image);
  const pos = frame.focus ? `background-position:${esc(frame.focus)};` : "";
  const media = (cls = "") => (image ? `<div class="media ${cls}" style="background-image:url('${image}');${pos}"></div>` : "");
  const photo = image ? `<div class="photo" style="background-image:url('${image}');${pos}"></div><div class="scrim"></div>` : "";
  const theme = ctx.theme;
  switch (frame.kind) {
    case "cover":
      if (image && theme === "photo") return `${photo}<div class="col bottom">${k}${title("cover", "72,138")}${body}${st}</div>`;
      if (image) return `<div class="col">${media("grow")}${k}${title("cover", "64,120")}${body}${st}</div>`;
      return `<div class="deco"></div><div class="col center">${k}${title("cover huge", "80,210")}${body}${st}</div>`;
    case "text":
      return `<div class="deco"></div><div class="col ${frame.align || "center"}">${frame.number ? `<div class="number">${esc(frame.number)}</div>` : ""}${k}${title("", frame.body ? "64,112" : "72,140")}${body}${st}</div>`;
    case "list": {
      const items = (frame.items || []).map((it, i) => `<li><span class="n">${frame.marks === "check" ? "✓" : i + 1}</span><span class="t" data-fit="38,76">${rich(it)}</span></li>`).join("");
      return `<div class="col ${frame.align || "center"}">${k}${title("", "60,120")}<ol class="items">${items}</ol>${st}</div>`;
    }
    case "quote": {
      const who = frame.author ? `<div class="who">${image ? `<span class="avatar" style="background-image:url('${image}')"></span>` : ""}<span><strong>${esc(frame.author)}</strong>${frame.role ? `<br>${esc(frame.role)}` : ""}</span></div>` : "";
      return `<div class="deco"></div><div class="col center"><div class="qmark">“</div><blockquote class="title quote" data-fit="56,124">${rich(frame.quote || frame.title)}</blockquote>${who}${st}</div>`;
    }
    case "stat":
      return `<div class="deco"></div><div class="col center">${k}<div class="value" data-fit="120,340" data-lines="1">${esc(frame.value)}</div>${title("label", "48,84")}${frame.source ? `<p class="source">${esc(frame.source)}</p>` : ""}${st}</div>`;
    case "image":
      if (image && theme === "photo") return `${photo}<div class="col bottom">${k}${title("", "60,110")}${body}${st}</div>`;
      return `<div class="col">${media("grow")}${k}${title("", "56,104")}${body}${st}</div>`;
    case "product": {
      const badge = frame.badge ? `<div class="badge">${esc(frame.badge)}</div>` : "";
      const pic = image ? `<div class="product grow"><div class="halo"></div><img src="${image}">${badge}</div>` : badge;
      return `<div class="col">${k}${pic}${title("", "56,104")}${frame.price ? `<div class="price" data-fit="64,120" data-lines="1">${esc(frame.price)}</div>` : ""}${body}${st}</div>`;
    }
    case "event": {
      const d = frame.date ? new Date(frame.date) : null;
      const valid = d && !isNaN(d);
      const lang = ctx.lang || "en";
      const day = valid ? d.toLocaleDateString(lang, { day: "numeric", timeZone: frame.timeZone || "UTC" }) : "";
      const month = valid ? d.toLocaleDateString(lang, { month: "short", timeZone: frame.timeZone || "UTC" }).replace(".", "") : "";
      const weekday = valid ? d.toLocaleDateString(lang, { weekday: "long", timeZone: frame.timeZone || "UTC" }) : "";
      const when = valid ? `<div class="date"><span class="wd">${esc(weekday)}</span><span class="day">${esc(day)}</span><span class="mo">${esc(month)}</span></div>` : "";
      return `${image ? `<div class="photo dim" style="background-image:url('${image}');${pos}"></div><div class="scrim full"></div>` : `<div class="deco"></div>`}<div class="col center">${k}${when}${title("", "60,112")}${body}${st}</div>`;
    }
    case "cta":
      return `<div class="deco"></div><div class="col center">${image ? media("teaser") : ""}${k}${title("", frame.body ? "60,104" : "64,120")}${body}${st}</div>`;
    default:
      return `<div class="col center">${title("", "64,120")}${body}${st}</div>`;
  }
}

function css(brand, v, fonts) {
  const SAFE = safeZone();
  const d = brand.fonts.display, b = brand.fonts.body, l = brand.fonts.label;
  const radius = brand.radius;
  return `${fonts}
html,body{margin:0;padding:0;width:${W}px;height:${H}px;overflow:hidden;background:${v.bg}}
*{box-sizing:border-box}
insta-story{display:block;width:${W}px;height:${H}px;overflow:hidden;color:${v.fg};font-family:${stack(b, "sans-serif")};-webkit-font-smoothing:antialiased}
.ground{position:absolute;inset:0;background:${v.bg}}
.col{position:absolute;inset:0;padding:${SAFE.top}px 84px ${H - SAFE.bottom}px;display:flex;flex-direction:column;gap:44px}
.col.center{justify-content:center}.col.bottom{justify-content:flex-end}.col.top{justify-content:flex-start}
.has-logo .col{padding-top:${SAFE.top + 130}px}
.grow{flex:1 1 0;min-height:360px}
.kicker{align-self:flex-start;max-width:100%;font-family:${stack(l, stack(b, "sans-serif"))};font-weight:${Math.max(600, l.weight || 600)};font-size:34px;line-height:1.15;letter-spacing:.07em;text-transform:uppercase;padding:16px 26px 15px;border-radius:${Math.min(radius, 40)}px;background:${v.hl};color:${v.onHl}}
.title{margin:0;font-family:${stack(d, "sans-serif")};font-weight:${d.weight || 800};line-height:${d.lineHeight ? Math.min(Math.max(d.lineHeight, 0.95), 1.15) : 1.04};letter-spacing:${(d.letterSpacing || -0.01).toFixed(3)}em;text-transform:${d.uppercase ? "uppercase" : "none"};text-wrap:balance;overflow-wrap:break-word;hyphens:auto}
.title mark,.body mark,.t mark{background:${v.hl};color:${v.onHl};padding:0 .14em;border-radius:.12em;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.body{margin:0;font-size:44px;line-height:1.38;font-weight:${b.weight || 400};text-wrap:pretty;opacity:.94}
.media{border-radius:${radius}px;background:${v.soft} center/cover no-repeat}
.media.teaser{height:560px;flex:none;width:76%;align-self:center;transform:rotate(-2deg);box-shadow:0 30px 60px rgba(0,0,0,.25)}
.photo{position:absolute;inset:0;background:#000 center/cover no-repeat}
.photo.dim{filter:saturate(.9)}
.scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 30%,rgba(0,0,0,.45) 58%,rgba(0,0,0,.82) 100%)}
.scrim.full{background:rgba(0,0,0,.58)}
.deco{position:absolute;width:1300px;height:1300px;right:-620px;top:-520px;border-radius:50%;background:${v.soft}}
.deco::after{content:"";position:absolute;width:700px;height:700px;left:-120px;top:1500px;border-radius:50%;background:${v.soft}}
.number{font-family:${stack(d, "sans-serif")};font-weight:${d.weight || 800};font-size:150px;line-height:1;color:${v.hl}}
ol.items{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:30px}
ol.items li{display:flex;gap:30px;align-items:flex-start}
ol.items .n{flex:none;width:82px;height:82px;border-radius:${radius >= 40 ? "50%" : Math.min(radius, 24) + "px"};background:${v.hl};color:${v.onHl};display:flex;align-items:center;justify-content:center;font-family:${stack(d, "sans-serif")};font-weight:${d.weight || 800};font-size:44px}
ol.items .t{font-size:52px;line-height:1.22;padding-top:6px;font-weight:${Math.max(500, b.weight || 400)}}
.qmark{font-family:Georgia,"Times New Roman",serif;font-size:300px;line-height:.6;height:150px;color:${v.hl}}
.quote{font-style:normal}
.who{display:flex;gap:28px;align-items:center;font-size:38px;line-height:1.3}
.avatar{width:120px;height:120px;border-radius:50%;background:center/cover;flex:none}
.value{font-family:${stack(d, "sans-serif")};font-weight:${d.weight || 800};line-height:.95;color:${v.hl};letter-spacing:-.02em;white-space:nowrap}
.title.label{font-weight:${Math.min(700, d.weight || 700)}}
.source{margin:0;font-size:30px;opacity:.7}
.product{position:relative;display:flex;align-items:center;justify-content:center}
.product .halo{position:absolute;width:880px;height:880px;max-height:100%;aspect-ratio:1;border-radius:50%;background:${v.soft}}
.product img{position:relative;max-width:88%;max-height:100%;object-fit:contain;filter:drop-shadow(0 30px 40px rgba(0,0,0,.18))}
.badge{position:absolute;right:0;top:20px;transform:rotate(8deg);background:${v.hl};color:${v.onHl};font-family:${stack(d, "sans-serif")};font-weight:${d.weight || 800};font-size:56px;padding:22px 34px;border-radius:${Math.min(radius, 40)}px}
.col > .badge{position:static;align-self:flex-start;transform:rotate(-3deg)}
.price{font-family:${stack(d, "sans-serif")};font-weight:${d.weight || 800};line-height:1;color:${v.hl}}
.date{display:flex;flex-direction:column;align-items:flex-start;gap:6px;line-height:1}
.date .wd{font-size:44px;font-weight:600;text-transform:capitalize;opacity:.9}
.date .day{font-family:${stack(d, "sans-serif")};font-weight:${d.weight || 800};font-size:260px;line-height:.9;color:${v.hl}}
.date .mo{font-family:${stack(d, "sans-serif")};font-weight:${d.weight || 800};font-size:90px;text-transform:uppercase;letter-spacing:.04em}
.stickers{display:flex;flex-direction:column;align-items:center;gap:44px}
.sticker{position:relative}
.arrow{position:absolute;width:140px;height:105px;left:-150px;top:calc(50% - 92px);color:${v.hl}}
.logo{position:absolute;top:${SAFE.top - 8}px;left:50%;transform:translateX(-50%);height:96px;max-width:420px;object-fit:contain}
.logo.chip{background:#fff;padding:18px 30px;border-radius:${Math.min(radius, 40)}px;height:120px}
.logo.boxed{border-radius:${Math.min(radius, 18)}px}
`;
}

// the whole page of a frame: the components and their pictures come from the organization's
// Storrito host (`base`), so stickers look as they will on Instagram
export function framePage({ brand, frame, index, count, theme, image, link, lang, fonts, host }) {
  const v = themeVars(brand, theme);
  const ctx = { theme, image, link, lang };
  const logo = (frame.logo ?? ["cover", "cta"].includes(frame.kind)) && brand.logo.primary && fs.existsSync(brand.logo.primary);
  const logoTag = logo ? `<img class="logo" id="logo" data-src="${fileUrl(brand.logo.primary)}"${brand.logo.onDark ? ` data-on-dark="${fileUrl(brand.logo.onDark)}"` : ""} alt="">` : "";
  const emoji = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=block">';
  return `<!doctype html><html lang="${esc(lang || "en")}"><head><meta charset="utf-8"><base href="${host}/">
<script src="/js/insta-components.js"></script>${emoji}
<style>${css(brand, v, fonts)}</style></head>
<body><insta-story class="kind-${esc(frame.kind)} theme-${theme}${logo ? " has-logo" : ""}" data-index="${index}" data-count="${count}" data-bg="${v.bg}" data-fg="${v.fg}">
<div class="ground"></div>${layout(frame, ctx)}${logoTag}
</insta-story></body></html>`;
}

// runs in the frame's page: shows the logo so that it reads on the ground, fits every text into its
// room, then measures what a viewer would notice and where each sticker sits
export async function inFrame() {
  const story = document.querySelector("insta-story");
  const col = story.querySelector(".col");
  const report = { overflow: 0, fits: [], stickers: [], texts: [], images: [], logo: null };
  const lum = (r, g, b) => {
    const c = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
  };
  const rgb = (s) => (/rgba?\(([^)]+)\)/.exec(s) || [, "0,0,0"])[1].split(/[\s,/]+/).map(Number);

  const logo = document.getElementById("logo");
  if (logo) {
    const load = (src) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = src; });
    const pic = await load(logo.dataset.src);
    if (pic) {
      const cv = document.createElement("canvas");
      const w = (cv.width = 200), h = (cv.height = Math.max(1, Math.round((200 * pic.naturalHeight) / Math.max(1, pic.naturalWidth))));
      const g = cv.getContext("2d");
      g.drawImage(pic, 0, 0, w, h);
      let seen = 0, opaque = 0, sum = 0, sat = 0;
      try {
        const d = g.getImageData(0, 0, w, h).data;
        for (let i = 0; i < d.length; i += 4) {
          seen++;
          if (d[i + 3] < 128) continue;
          opaque++;
          sum += lum(d[i], d[i + 1], d[i + 2]);
          sat += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
        }
      } catch {}
      const cover = opaque / Math.max(1, seen), L = opaque ? sum / opaque : 0.5, S = opaque ? sat / opaque / 255 : 0;
      const [r, gg, b] = rgb(getComputedStyle(story.querySelector(".ground")).backgroundColor);
      const bgL = story.classList.contains("theme-photo") ? 0.05 : lum(r, gg, b);
      const ratio = (Math.max(L, bgL) + 0.05) / (Math.min(L, bgL) + 0.05);
      let treatment = "as is";
      if (cover > 0.92) { logo.classList.add("boxed"); treatment = "boxed"; }
      else if (ratio < 2.2) {
        if (logo.dataset.onDark && bgL < 0.4) { logo.dataset.src = logo.dataset.onDark; treatment = "on-dark version"; }
        else if (S < 0.25) { logo.style.filter = bgL < 0.4 ? "brightness(0) invert(1)" : "brightness(0)"; treatment = bgL < 0.4 ? "white" : "black"; }
        else { logo.classList.add("chip"); treatment = "on a white chip"; }
      }
      logo.src = logo.dataset.src;
      await new Promise((resolve) => (logo.complete ? resolve() : (logo.onload = logo.onerror = resolve)));
      report.logo = { treatment, contrast: +ratio.toFixed(2) };
    } else {
      logo.remove();
      report.logo = { treatment: "could not be loaded" };
    }
  }

  // every text that fits itself: [min, max] in px; shrunk step by step, the biggest first, until
  // the column holds everything and no word is cut
  const fits = [...story.querySelectorAll("[data-fit]")].map((el) => {
    const [min, max] = el.dataset.fit.split(",").map(Number);
    el.style.fontSize = max + "px";
    return { el, min, max, size: max, lines: el.dataset.lines ? +el.dataset.lines : null };
  });
  // how far the column's content reaches beyond its room (the safe zone); a centred column
  // overflows into its padding, which the browser does not count as overflow
  const spill = () => {
    const box = col.getBoundingClientRect(), cs = getComputedStyle(col);
    const top = box.top + parseFloat(cs.paddingTop), bottom = box.bottom - parseFloat(cs.paddingBottom);
    const kids = [...col.children].map((k) => k.getBoundingClientRect()).filter((r) => r.height > 0);
    if (!kids.length) return 0;
    return Math.round(Math.max(0, top - Math.min(...kids.map((r) => r.top))) + Math.max(0, Math.max(...kids.map((r) => r.bottom)) - bottom));
  };
  const over = () => {
    if (spill() > 1) return true;
    for (const f of fits) {
      if (f.el.scrollWidth > f.el.clientWidth + 1) return true;
      if (f.lines) {
        const lh = parseFloat(getComputedStyle(f.el).lineHeight) || f.size * 1.1;
        if (f.el.getBoundingClientRect().height > lh * f.lines + 2) return true;
      }
    }
    return [...story.querySelectorAll(".grow")].some((g) => g.getBoundingClientRect().height < 359);
  };
  for (let guard = 0; guard < 400 && over(); guard++) {
    const f = fits.filter((x) => x.size > x.min).sort((a, b) => b.size / b.min - a.size / a.min)[0];
    if (!f) break;
    f.size = Math.max(f.min, Math.floor(f.size * 0.96));
    f.el.style.fontSize = f.size + "px";
  }
  report.overflow = spill();
  for (const f of fits) {
    const lh = parseFloat(getComputedStyle(f.el).lineHeight) || f.size * 1.1;
    report.fits.push({ cls: f.el.className, size: f.size, min: f.min, max: f.max, lines: Math.round(f.el.getBoundingClientRect().height / lh) });
  }
  for (const el of story.querySelectorAll(".title, .body, .t, .kicker, .value, .price, .who, .date, .source")) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const own = rgb(cs.backgroundColor);
    const ownGround = /rgba?/.test(cs.backgroundColor) && (own.length < 4 || own[3] > 0.5) && !/rgba\(0, 0, 0, 0\)/.test(cs.backgroundColor);
    report.texts.push({ cls: el.className, x: r.x, y: r.y, w: r.width, h: r.height, color: cs.color, size: parseFloat(cs.fontSize), ownGround, words: (el.innerText || "").trim().split(/\s+/).filter(Boolean).length });
  }
  for (const el of story.querySelectorAll(".media, .photo, .product img, .avatar")) {
    const r = el.getBoundingClientRect();
    const src = el.tagName === "IMG" ? el.currentSrc : (/url\(["']?([^"')]+)/.exec(getComputedStyle(el).backgroundImage) || [])[1];
    if (!src) continue;
    const size = await new Promise((resolve) => { const i = new Image(); i.onload = () => resolve([i.naturalWidth, i.naturalHeight]); i.onerror = () => resolve([0, 0]); i.src = src; });
    // a picture that covers its box is enlarged by the larger of the two ratios
    const contain = el.tagName === "IMG";
    const scale = size[0] && size[1] ? (contain ? Math.min(r.width / size[0], r.height / size[1]) : Math.max(r.width / size[0], r.height / size[1])) : 0;
    report.images.push({ cls: el.className, w: r.width, h: r.height, natural: size, scale: +scale.toFixed(2), src: src.slice(0, 200) });
  }
  // stickers: the box Instagram gets, where it sits on the frame without its rotation
  for (const el of story.querySelectorAll("insta-link, insta-poll, insta-question, insta-quiz, insta-countdown, insta-emoji-slider, insta-mention, insta-hashtag, insta-location")) {
    const r = el.getBoundingClientRect();
    const s = story.getBoundingClientRect();
    let x = 0, y = 0, n = el;
    while (n && n !== story) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    report.stickers.push({
      tag: el.tagName.toLowerCase(), attrs: Object.fromEntries([...el.attributes].filter((a) => a.name !== "style").map((a) => [a.name, a.value])),
      transform: el.style.transform || "", left: Math.round(x), top: Math.round(y), width: Math.round(el.offsetWidth), height: Math.round(el.offsetHeight),
      rect: { x: Math.round(r.x - s.x), y: Math.round(r.y - s.y), w: Math.round(r.width), h: Math.round(r.height) },
    });
  }
  return report;
}

// the HTML Storrito gets for a frame: the rendered picture as the ground, the stickers exactly
// where they sat in the preview; `{{BACKGROUND}}` becomes the picture's URL once it is uploaded
export function scheduleHtml(stickers) {
  const st = stickers.map((s) => {
    const attrs = Object.entries(s.attrs).map(([k, v]) => (String(v).includes('"') ? ` ${k}='${String(v).replace(/'/g, "&#39;")}'` : ` ${k}="${esc(v)}"`)).join("");
    return `<${s.tag}${attrs} style="position:absolute;left:${s.left}px;top:${s.top}px${s.transform ? `;transform:${s.transform}` : ""}"></${s.tag}>`;
  }).join("");
  return `<insta-story><img src="{{BACKGROUND}}" style="position:absolute;top:0;left:0;width:${W}px;height:${H}px">${st}</insta-story>`;
}
