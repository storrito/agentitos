// The hook: a few words over the start of the cut that say what the viewer gets, for a video
// whose first line does not (a moment cut from a long talk), one *word* in the brand's colour, on
// the first frame already (no entrance); it stays while the first sentence is said (2–5 s) and
// fades out. Where it goes is the caller's (place: a skill that laid the frame out against the
// faces, as clips' place does with agentitos' layout): a short text of two lines in big white
// type, or a white card with dark type, in the box given. Without a place it is a card centred on
// the frame at the top of platform-zones' centred box, as before.
//
//   hookCard({ text, until, zones, brand, out, place }) → { element, style, links, fit, script, box }
//   place: { kind: "text" | "card", box: [x, y, w, h], font }   (px of the frame)

import fs from "node:fs";
import path from "node:path";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const googleFont = (family, weight) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${weight}&display=swap`;
const ACCENT = "#FF4D2E";
const WEIGHT = 800;
const PAD = 22;
const SIZE = 72; // px at most, two lines: the card ends above the eyes of a face framed a third from the top

// The brand's primary colour and display font from its DESIGN.md (brand-kit), as the captions
// skill reads them: a font Google serves, or one shipped as files beside the DESIGN.md.
export function brandOf(file) {
  if (!file || !fs.existsSync(file)) return null;
  const front = fs.readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const block = (name) => front.match(new RegExp(`^${name}:\\n((?:[ \\t]+.*\\n?)+)`, "m"))?.[1] ?? "";
  const value = (lines, key) => lines.match(new RegExp(`^[ \\t]+${key}:\\s*["']?([^"'\\n]+)["']?`, "m"))?.[1]?.trim();
  const display = front.match(/headline-display:\n((?:[ \t]{4,}.*\n?)+)/)?.[1] ?? "";
  const family = value(display, "fontFamily");
  const fonts = block("fonts");
  const served = !!family && new RegExp(`^[ \\t]+["']?${family}["']?:\\s*google`, "m").test(fonts);
  const files = family && !served ? [...fonts.matchAll(/file:\s*["']?([^"'\n]+)["']?(?:[\s\S]*?weight:\s*(\d+))?/g)]
    .map((m) => ({ file: path.resolve(path.dirname(file), m[1].trim()), weight: Number(m[2]) || 400 })).filter((f) => fs.existsSync(f.file)) : [];
  return { primary: value(block("colors"), "primary"), family, served, files };
}

// How long the card stays: until the cut's first sentence ends, at least 2 s, at most 5 s
export function hookUntil(words, duration) {
  const end = words.find((w) => /[.!?…]["”']?$/.test(w.text))?.end ?? 3;
  return +Math.min(duration, Math.max(2, Math.min(5, end))).toFixed(3);
}

export function hookCard({ text, until, zones, brand, out, place = null }) {
  const [x, y, w] = place?.box || [zones.centred[0], zones.centred[1] + 8, zones.centred[2]];
  const kind = place?.kind === "text" ? "text" : "card";
  // the box's height: the type fits in two lines of it, the card's padding inside it
  const height = place?.box?.[3];
  const size = place?.font ? Math.min(place.font, kind === "card" && height ? Math.floor((height - 2 * PAD - 6) / (2 * 1.08)) : place.font) : SIZE;
  const accent = brand?.primary || ACCENT;
  let font = "Inter", faces = "";
  const links = [];
  // Inter always, as the fallback; a brand's font without a weight (Google answers a weight a
  // font does not have with an error)
  links.push(googleFont("Inter", WEIGHT));
  if (brand?.family && brand.served) { font = brand.family; links.push(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(font).replace(/%20/g, "+")}&display=swap`); }
  else if (brand?.family && brand.files.length) {
    font = brand.family;
    fs.mkdirSync(path.join(out, "fonts"), { recursive: true });
    for (const f of brand.files) {
      fs.copyFileSync(f.file, path.join(out, "fonts", path.basename(f.file)));
      faces += `@font-face { font-family: "${font}"; font-weight: ${f.weight}; src: url("fonts/${path.basename(f.file)}"); }\n`;
    }
  }
  // *word* stands out
  const words = esc(text.trim()).replace(/\*([^*]+)\*/g, `<span class="hook-accent">$1</span>`);
  // one element, no nesting (HyperFrames shows every top-level element as a row of its timeline)
  // a text: white type with a dark edge and shadow, as the captions are set, no card; its two lines
  // stand in the middle of the box given
  const look = kind === "text"
    ? `color: #FFFFFF; -webkit-text-stroke: ${Math.max(4, Math.round(size / 14))}px #000000; paint-order: stroke fill; text-shadow: 0 6px 0 rgba(0,0,0,0.8);`
    : `padding: ${PAD}px 34px ${PAD + 4}px; border-radius: 26px; background: #FFFFFF; color: #111111; box-shadow: 0 10px 40px rgba(0,0,0,0.35);`;
  const top = kind === "text" && height ? y + Math.max(0, (height - 2 * size * 1.08) / 2) : y;
  const style = `${faces}      #hook { position: absolute; left: ${x + w / 2}px; top: ${+top.toFixed(1)}px; transform: translateX(-50%); width: max-content; max-width: ${w}px; z-index: 5;
        ${look}
        font-family: "${font}", "Inter", sans-serif; font-weight: ${WEIGHT}; font-size: ${size}px; line-height: 1.08; letter-spacing: -0.02em; text-align: center; }
      #hook .hook-accent { color: ${accent}; }`;
  const element = `<div id="hook" class="clip" data-start="0" data-duration="${until}" data-track-index="2">${words}</div>`;
  // the type as big as fits in two lines, once the font is there: a script of its own, apart
  // from the timeline's, which HyperFrames wants registered at once
  const fit = `(function () {
        var el = document.getElementById("hook");
        function fit() {
          var s = ${size};
          el.style.fontSize = s + "px";
          while (s > 40 && (el.scrollWidth > el.clientWidth + 1 || el.offsetHeight > s * 1.08 * 2 + ${kind === "card" ? 2 * PAD + 6 : 6})) { s -= 2; el.style.fontSize = s + "px"; }
        }
        fit();
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
      })();`;
  // out over the last 0.2 s
  const script = `window.__timelines["main"].to("#hook", { opacity: 0, duration: 0.2, ease: "power1.in" }, ${Math.max(0, until - 0.2).toFixed(3)});`;
  // the box the hook stays inside, for a check against the faces: as wide as allowed, two lines tall
  const box = [x, top, w, kind === "card" ? 2 * size * 1.08 + 2 * PAD + 4 : 2 * size * 1.08];
  return { element, style, links, fit, script, box };
}
