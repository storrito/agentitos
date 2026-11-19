// The captions as a HyperFrames sub-composition, captions/index.html, which a host composition
// mounts as a clip (mount()). Everything the runtime needs is inside its <template> (the runtime
// clones only that); the root is styled by #root; the host slot, the root and the timeline share
// the id "captions". The data (groups, words, times) is written into the file, the script builds
// the words, fits each group to the frame once the fonts are there, and registers one paused
// timeline: deterministic, no random, no clock. Every group goes hard at its end.

import fs from "node:fs";
import path from "node:path";
import { groups, activeSpans, fold } from "./group.mjs";
import { measure, PILL } from "./widths.mjs";

export const ID = "captions";
const n = (x) => +x.toFixed(3);
const json = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

// A word as a style in capitals shows it: all capitals but for the letters that must stay small
// (see writeCaptions); null when it has none and the style's own transform will do.
const NUMBER_LETTER = /^([^\p{L}\d]*\d[\d.,:]*)(\p{Ll})[^\p{L}\d]*$/u;
const ENDING = /(?<=\p{L}[:*·]\u00AD?)(?:innen|in|r|e|n)(?!\p{L})|(?<=\p{L}\/\u00AD?)(?:innen|in)(?!\p{L})|(?<=\p{L}_\u00AD?)innen(?!\p{L})/gu;
// A capital I inside a word is a gender mark too ("GeneralistInnen", "LehrerIn"), and the only
// one that capitals swallow whole: there it is the one small letter, "GENERALISTiNNEN". Before
// "nnen" always ("LehrerInnenzimmer" too); before a single "n" at the word's end only after an
// ending a person's noun has ("LehrerIn", "KollegIn", "ÄrztIn", "KandidatIn"), never after any
// other: "LinkedIn", "PlugIn", "LogIn", "StandIn" and "ChatIn" are no such words, and a mark
// missed ("LEHRERIN") costs less than a name spoilt ("LINKEDiN"). A soft hyphen may stand before it.
const INNER_I = /(?<=\p{Ll}­?)I(?=nnen)|(?<=(?:er|or|ent|ant|ist|eur|[dmrkbi]at|är|eg|ert|und|eut|olog|agog|gra(?:f|ph)|ilot|zt|hef|amt|ält)­?)I(?=n(?!\p{L}))/gu;
function capitals(text) {
  // [from, to, what stands there]: what is kept as it is written, and the inner I as a small one
  const keep = [...text.matchAll(ENDING)].map((m) => [m.index, m.index + m[0].length, m[0]]), letter = NUMBER_LETTER.exec(text);
  if (letter) keep.push([letter[1].length, letter[1].length + letter[2].length, letter[2]]);
  for (const m of text.matchAll(INNER_I)) keep.push([m.index, m.index + 1, "i"]);
  if (!keep.length) return null;
  let out = "", at = 0;
  for (const [from, to, small] of keep.sort((a, b) => a[0] - b[0])) { out += text.slice(at, from).toUpperCase() + small; at = to; }
  return out + text.slice(at).toUpperCase();
}

// How far two colours are apart in lightness (WCAG's contrast ratio, 1 to 21); null when one is
// neither a hex colour (#rgb, #rrggbb, #rrggbbaa) nor rgb() / rgba().
function contrast(a, b) {
  const light = (c) => {
    const text = String(c).trim(), hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text), rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[,/][^)]*)?\)$/i.exec(text);
    if (!hex && !rgb) return null;
    const digits = hex && (hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join("") : hex[1]);
    const [r, g, bl] = (hex ? [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) : rgb.slice(1, 4).map(Number)).map((v) => Math.min(255, v) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const la = light(a), lb = light(b);
  return la == null || lb == null ? null : (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// The <link> of a font Google serves, for the preview (the renderer embeds its own fonts).
const googleFont = (family, weight, italic) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:${italic ? "ital,wght@1," : "wght@"}${weight}&display=swap`;

// The brand's colours and display font from its DESIGN.md (brand-kit): the primary colour becomes
// the accent, a font served by Google or shipped as files becomes the captions' font.
export function brandOf(file) {
  if (!file || !fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  const front = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const block = (name) => front.match(new RegExp(`^${name}:\\n((?:[ \\t]+.*\\n?)+)`, "m"))?.[1] ?? "";
  const value = (lines, key) => lines.match(new RegExp(`^[ \\t]+${key}:\\s*["']?([^"'\\n]+)["']?`, "m"))?.[1]?.trim();
  const colors = block("colors");
  const display = front.match(/headline-display:\n((?:[ \t]{4,}.*\n?)+)/)?.[1] ?? "";
  const family = value(display, "fontFamily");
  const fonts = block("fonts");
  const served = family && new RegExp(`^[ \\t]+["']?${family}["']?:\\s*google`, "m").test(fonts);
  const files = family ? [...fonts.matchAll(/file:\s*["']?([^"'\n]+)["']?(?:[\s\S]*?weight:\s*(\d+))?/g)].map((m) => ({ file: path.resolve(path.dirname(file), m[1].trim()), weight: Number(m[2]) || 400 })) : [];
  return { primary: value(colors, "primary"), family, served, files: served ? [] : files.filter((f) => fs.existsSync(f.file)) };
}

// The captions' area and type. Without `place`: platform-zones' centred box (the safe box even
// about the frame's middle), the lowest line at its bottom, centred on the frame and never wider,
// in the style's size and lines. `place` is what the caller asked for instead, each key only when
// it was asked for: { bottom (the y at which the lowest line ends), left, width, align ("left",
// "center", "right"), size (the type's, px of the frame), lines }. What it leaves out stays as
// above: a width alone is centred on the frame, a left edge alone reaches to the centred box's
// right edge. `grow` is the type against the style's: its stroke and a card's border grow with it.
// `own`: the width, the lines or the size are the caller's, not those the styles are made for.
function areaOf(place, style, width, height, [sx, sy, sw, sh]) {
  // the styles' sizes are for a frame whose short side is 1080 px: 1080×1920, 1920×1080, 1080×1080 alike
  const scale = Math.min(width, height) / 1080;
  if (!place) return { left: sx, right: width - (sx + sw), bottom: height - (sy + sh), maxWidth: sw, type: style.look.size * scale, grow: scale, lines: style.group.lines, align: "center" };
  const maxWidth = place.width ?? (place.left != null ? sx + sw - place.left : sw);
  if (!(maxWidth > 0)) throw new Error(`--x ${place.left} leaves no room up to x ${sx + sw}, where the platforms' centred box ends: give --max-width as well.`);
  const left = place.left ?? (place.width != null ? n((width - maxWidth) / 2) : sx);
  const lines = place.lines ?? style.group.lines;
  return { left, right: n(width - (left + maxWidth)), bottom: height - (place.bottom ?? sy + sh), maxWidth, type: place.size ?? style.look.size * scale,
    grow: place.size != null ? place.size / style.look.size : scale, lines, align: place.align ?? "center", own: maxWidth !== sw || lines !== style.group.lines || place.size != null };
}

// A colour at half its strength, for the words that wait to be said; null for one not to weigh
function dimmed(c) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c).trim());
  if (!hex) return null;
  const d = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join("") : hex[1];
  return `rgba(${[0, 2, 4].map((i) => parseInt(d.slice(i, i + 2), 16)).join(",")},0.5)`;
}

// --follow: the word being said lights up in a style whose words stay as they are (clean, bold,
// subtitle, editorial, outline, impact) or only turn the text's colour (label): the words wait at
// half their colour (label: its grey), the one being said takes the light colour, said words stand
// in the text's colour. The light colour is the brand's primary where the style gives it the word
// being said or the key words and it reads there, else the style's key colour. Styles that light
// the word already (hormozi, karaoke, wipe, fill) and one word at a time (single) stay as they are.
export function follows(style, look, brandPrimary) {
  const m = style.motion.active;
  if (style.group.words === 1 || ["color-scale", "pill", "dim-after"].includes(m) || (m === "fill" && look.accent !== look.color)) return null;
  const takes = look.brand || "accent";
  const light = takes === "accent" && brandPrimary ? brandPrimary : look.highlight;
  const wait = look.wait || dimmed(look.color);
  if (!wait) return null;
  return { active: "fill", accent: light, wait };
}

// zones: platform-zones' answer for the frame (tools/lib/zones.mjs); place: where the caller wants
// the captions instead of where it says (areaOf above). Without place the file is what it was
// before there was one; without follow, as before there was that.
export function writeCaptions(out, { words: said, style, width, height, duration, brand, zones, place, follow = false }) {
  const words = fold(said);   // a mark alone ("…") is no caption: group.mjs
  const look = { ...style.look }, area = areaOf(place, style, width, height, zones.centred);
  fs.mkdirSync(out, { recursive: true });
  const links = [];
  let faces = "";
  // A brand's primary colour goes where the style says (look.brand): to the accent (the word
  // being said; the default, as the styles before had it), to the key words (a style in which
  // no word lights up), or to both (a style whose key words keep the colour of the word being
  // said). Key words stay on the picture, or on the box of their line, so they must be read
  // there: a primary too close to what is behind them (under 4.5 : 1 against the dark edge and
  // shadow, under 3 : 1 against a line's box), or one that cannot be weighed (no hex, no
  // rgb()), is left out, the style keeps its own colours, and the caller is told (`kept`).
  const takes = look.brand || "accent";
  let kept = null;
  if (brand?.primary && takes === "accent") look.accent = brand.primary;
  else if (brand?.primary) {
    const ratio = contrast(brand.primary, look.lineBox || "#000000");
    if (ratio != null && ratio >= (look.lineBox ? 3 : 4.5)) { look.highlight = brand.primary; if (takes === "both") look.accent = brand.primary; }
    else kept = { primary: brand.primary, why: ratio == null ? "is no hex or rgb() colour to weigh" : `would not be read on ${look.lineBox ? "the box of its line" : "a picture"}`,
      what: takes === "both" ? "the word being said and the key words" : "the key words", highlight: look.highlight };
  }
  // the word being said lit where the caller asks for it (after the brand: its primary may be the light)
  let followed = null;
  if (follow) {
    const f = follows(style, look, brand?.primary && !kept ? brand.primary : null);
    if (f) { style = { ...style, motion: { ...style.motion, active: f.active } }; look.accent = f.accent; look.wait = f.wait; followed = { accent: f.accent }; }
    else followed = { already: true };
  }
  if (brand?.family && !look.ownFont && (brand.served || brand.files.length)) {
    look.font = brand.family;
    if (brand.served) links.push(googleFont(brand.family, look.weight));
    fs.mkdirSync(path.join(out, "fonts"), { recursive: true });
    for (const f of brand.files) {
      const name = path.basename(f.file);
      fs.copyFileSync(f.file, path.join(out, "fonts", name));
      faces += `@font-face { font-family: "${brand.family}"; font-weight: ${f.weight}; src: url("${path.basename(out)}/fonts/${name}"); }\n`;
    }
  } else links.push(googleFont(look.font, look.weight));
  if (look.keyFont) links.push(googleFont(look.keyFont, look.keyWeight || look.weight, look.keyItalic));

  // In a width, in lines or at a size of the caller's own, a group must set in its lines at the
  // type's size (the one named, else the style's), line by line: the styles' groups are made for
  // two lines of the centred box and lean on fit() below, which shrinks them. The words are
  // measured in the style's own font (widths.mjs); the padding of a style's box (1 em), or of the
  // box each line has (linePad), is no room for them. A phrase whose groups set keeps them, any
  // other is cut anew (group.mjs). Captions
  // that are only moved or aligned keep the style's groups.
  // A word that grows while it is said (hormozi) would pass the area by half its growth at each
  // end of a full line (22 px in a 696 px line): the group keeps that much room at both sides.
  const inset = style.motion.active === "color-scale" && look.grow > 1 ? Math.ceil(((look.grow - 1) / 2) * area.maxWidth) : 0;
  // (what a group keeps at its sides is no room for a word: a box's padding, a pill's overhang, the room to grow)
  const type = area.own ? measure(style.look) : null, room = (area.maxWidth - (look.box ? area.type : look.lineBox ? 2 * look.linePad[1] * area.type : look.pill ? 2 * PILL.pull * area.type : 2 * inset)) / area.type;
  // (a style of one word at a time, `brief`, is measured wherever it stands: words that share a
  // caption must set in its one line at nearly the style's size, or fit() would shrink them to 60 %)
  const fitted = type || (style.group.brief ? measure(style.look) : null);
  const group = fitted ? { ...style.group, fit: { lines: area.lines, room, space: fitted.space, word: (text, w) => fitted.word(text, !!w?.highlight) } } : style.group;

  // a box (a run of words with `box`): a card of its own, an emoji in front when its first word
  // carries `icon`, its numbers in the key colour
  const gs = groups(words, group, duration).filter((g) => !duration || g.start < duration).map((g) => ({
    start: n(g.start), end: n(g.end), ...(g.box ? { box: true, icon: words[g.from].icon || null } : {}),
    words: activeSpans(words, g).map((s) => ({ text: words[s.i].text, start: n(s.start), end: n(s.end), said: n(words[s.i].end),
      key: !!words[s.i].highlight || (!!g.box && /\d/.test(words[s.i].text)) })),
  }));
  // What the caller is told of the words (below): those wider than a line of the area, which
  // are set smaller, and the short words that joined one and are set smaller with it (group.mjs
  // joinFlash).
  const tooWide = (w) => type.word(w.text, w.key) > room;
  const wide = type ? gs.flatMap((g) => (g.box ? [] : g.words.filter(tooWide).map((w) => w.text))) : [];
  // the size such a group comes out at: as large as its widest word fits a line (fit() below
  // shrinks it so); a word with a soft hyphen breaks there where the area has two lines, its wider
  // part then decides (with the hyphen drawn). `size` in the group, `smaller` for the caller
  // (its parts go onto the lines in order, so with more parts than lines some share one: the
  // widest line of the best such split decides)
  const across = (w) => {
    if (!(area.lines > 1 && w.text.includes("\u00AD"))) return type.word(w.text, w.key);
    const parts = w.text.split("\u00AD");
    const width = (a, b) => type.word(parts.slice(a, b).join("") + (b < parts.length ? "-" : ""), w.key);
    const best = (a, lines) => (lines === 1 || a === parts.length - 1 ? width(a, parts.length) : Math.min(...parts.slice(a + 1).map((_, k) => Math.max(width(a, a + k + 1), best(a + k + 1, lines - 1)))));
    return best(0, area.lines);
  };
  const smaller = [];
  if (type) for (const g of gs) if (!g.box) {
    const widest = Math.max(...g.words.map(across));
    if (widest > room) { g.size = Math.max(14, Math.floor(((room / widest) * area.type) / 2) * 2); smaller.push({ text: g.words.map((w) => w.text.replace(/\u00AD/g, "")).join(" "), start: g.start, size: g.size }); }
  }
  const joined = type ? gs.flatMap((g) => (!g.box && g.words.length > 1 && g.words.some(tooWide) ? g.words.filter((w) => !tooWide(w)).map((w) => w.text) : [])) : [];
  // In capitals a few letters stay small, or they say something else: the letter of a paragraph
  // or a house number, when the word is a number with one small letter at its end ("§ 202a",
  // "12b,", "5m": not "b2b", "5m/s" or "3d-druck"), and a gender ending after its mark
  // ("Generalist:innen", "Lehrer*in", "jede:r", "Lehrer·innen"; after a slash or an underscore
  // only the unmistakable ones, "Mitarbeiter/innen", not "und/oder" or a handle "@name_in"; an
  // inner capital I as a small one, "GENERALISTiNNEN").
  // Such a word is written into the file in its capitals and is not transformed again (`own`);
  // the caller is told which (`small`).
  const small = [];
  if (look.case === "upper") for (const g of gs) for (const w of g.words) {
    const text = capitals(w.text);
    if (text == null) continue;
    w.text = text;
    w.own = true;
    small.push(text);
  }
  // groupKey: a caption that holds a key word stands whole in the key colour
  if (look.groupKey) for (const g of gs) if (!g.box && g.words.some((w) => w.key)) for (const w of g.words) w.key = true;
  const data = { groups: gs, look, motion: style.motion, lines: area.lines,
    size: Math.round(area.type), bottom: area.bottom, left: area.left, right: area.right, maxWidth: area.maxWidth };
  // left or right in the area: the text, a box that is only as wide as its text, and the point a group pops in from
  const margin = { left: "0 auto 0 0", center: "0 auto", right: "0 0 0 auto" }[area.align];
  const origin = area.align === "center" ? "" : ` transform-origin: ${area.align === "left" ? "0%" : "100%"} 50%;`;
  // Where the caller placed them, the area holds a style's box whole, its padding too, whatever
  // box-sizing the host sets: the box counts with its padding, and the padding is no room for a
  // word (both go into the rule and into fit() of the script below). A group with room kept at
  // its sides (a box for every line, a pill's overhang, a word that grows) is `padded` likewise.
  const whole = place ? " box-sizing: border-box;" : "", padded = place ? ' || el.classList.contains("boxed")' : "";
  // (a box around two lines is as wide as the area: centred that is even, at one side it would
  // stand out past its text; this goes into fit() too)
  const hug = area.align === "center" ? "" : `
            // left or right in its area, a box ends where its longest line ends
            if (el.classList.contains("boxed") || el.classList.contains("cap-card")) {
              var from = Infinity, to = -Infinity, box = getComputedStyle(el);
              Array.prototype.forEach.call(el.children, function (c) { from = Math.min(from, c.offsetLeft); to = Math.max(to, c.offsetLeft + c.offsetWidth); });
              el.style.width = Math.ceil(to - from) + 1 + parseFloat(box.paddingLeft) + parseFloat(box.paddingRight) + 2 * parseFloat(box.borderLeftWidth) + "px";
            }`;

  // The rules only some looks have:
  //   pill      the word being said on a pill: every word has the pill's padding, drawn back by
  //             a margin so that the pill reaches into the gaps instead of widening them (the
  //             gaps were twice a word space); the group keeps the pill's overhang at a line's
  //             ends inside its area
  //   lineBox   each line on a box of its own that hugs its text: once a group is fitted, a box
  //             is laid behind every line of text (a word that breaks inside itself has two),
  //             as high as the line and as wide as its text, with linePad around it. The boxes
  //             are sized by the line, not by the font's own ascent and descent, so a brand's
  //             font sits in them as the style's does. The padding left and right is no room
  //             for a word, and the lowest box ends where the lowest line would (the group
  //             stands higher by the padding). A card keeps its own box, in the lines' colour
  //             (its words are the style's, dark on light).
  //   keyFont   key words in another typeface, larger (keyScale). Their lines keep the pitch of
  //             the others (a key word that breaks inside itself has two lines too); a taller
  //             typeface would push its line down, so its top counts a fifth of its size less.
  const rules = (look.pill ? `
        #root .cap-group.padded { box-sizing: border-box; padding: 0 ${PILL.pull}em; }` : "") + (inset ? `
        #root .cap-group.padded { box-sizing: border-box; padding: 0 ${inset}px; }` : "") + (look.lineBox ? `
        #root .cap-group.lined { box-sizing: border-box; padding: 0 ${look.linePad[1]}em; margin-bottom: ${look.linePad[0]}em; }
        #root .cap-group.lined .cap-word { position: relative; }
        #root .cap-box { position: absolute; background: ${look.lineBox}; border-radius: ${look.lineRadius || "0.2em"}; }
        #root .cap-group.cap-card { background: ${look.lineBox}; }` : "") + (look.keyFont ? `
        #root .cap-word.key { font-family: "${look.keyFont}", serif; font-weight: ${look.keyWeight || look.weight}; font-style: ${look.keyItalic ? "italic" : "normal"};
          font-size: ${look.keyScale || 1}em; line-height: ${n(look.lineHeight / (look.keyScale || 1))}; margin-top: -0.2em; letter-spacing: 0; }` : "");
  // which groups keep room at their sides that is no room for a word (a card has its own padding)
  const sides = look.lineBox ? "lined padded" : look.pill || inset ? "padded" : "";

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
${links.map((l) => `    <link rel="stylesheet" href="${l}" />`).join("\n")}
  </head>
  <body>
    <!-- generated by agentitos/captions (style ${style.label}): change the words or the style and build again -->
    <template>
      <style>
        ${faces}#root { position: absolute; inset: 0; pointer-events: none; }
        #root .cap-group { position: absolute; left: ${data.left}px; right: ${data.right}px; bottom: ${data.bottom}px; margin: ${margin}; width: ${data.maxWidth}px;
          display: block; text-wrap: balance; word-spacing: ${look.gap || "0.08em"}; visibility: hidden;
          font-family: "${look.font}", sans-serif; font-weight: ${look.weight}; line-height: ${look.lineHeight}; letter-spacing: ${look.spacing};
          text-transform: ${look.case === "upper" ? "uppercase" : "none"}; text-align: ${area.align};${origin} }
        #root .cap-group.boxed {${whole} width: fit-content; max-width: ${data.maxWidth}px;
          background: ${look.box || "transparent"}; padding: 0.22em 0.5em; border-radius: 0.3em; }
        #root .cap-group.cap-card { box-sizing: border-box; width: fit-content; max-width: ${data.maxWidth}px; padding: 0.2em 0.5em 0.24em; border-radius: 0.32em;
          background: rgba(10,14,20,0.86); border: ${Math.max(3, Math.round(area.type * 0.045))}px solid ${look.highlight}; box-shadow: 0 10px 30px rgba(0,0,0,0.45); }
        #root .cap-icon { display: inline-block; margin-right: 0.3em; text-transform: none; font-weight: 400; }
        #root .cap-word { display: inline-block; color: ${look.color}; text-shadow: ${look.shadow};
          ${look.stroke ? `-webkit-text-stroke: ${Math.round(look.stroke * area.grow)}px ${look.strokeColor}; paint-order: stroke fill;` : ""}
          ${look.pill ? `padding: 0.04em ${PILL.pad}em; margin: 0 -${PILL.pull}em; border-radius: 0.28em;` : ""} transform-origin: 50% 60%; }
        #root .cap-word.own { text-transform: none; }${rules}
      </style>
      <div id="root" data-composition-id="${ID}" data-width="${width}" data-height="${height}"${duration ? ` data-duration="${n(duration)}"` : ""}></div>
      <script>
        (function () {
          var DATA = ${json(data)};
          var L = DATA.look, M = DATA.motion, root = document.getElementById("root");
          // SIDES: the classes of a group that keeps room at its sides; PULL: how much of a word's box a margin draws back (a pill's padding), in the type's size
          var SIDES = ${JSON.stringify(sides)}, PULL = ${look.pill ? 2 * PILL.pull : 0};
          var els = DATA.groups.map(function (g, gi) {
            var el = document.createElement("div");
            el.className = "cap-group" + (L.box ? " boxed" : "") + (g.box ? " cap-card" : "");
            el.id = "cap-g" + gi;
            if (g.icon) {
              var ico = document.createElement("span");
              ico.className = "cap-icon";
              ico.textContent = g.icon;
              el.appendChild(ico);
              el.appendChild(document.createTextNode(" "));
            }
            g.words.forEach(function (w, wi) {
              if (wi) el.appendChild(document.createTextNode(" "));
              var s = document.createElement("span");
              s.className = "cap-word";
              s.id = "cap-g" + gi + "-w" + wi;
              s.textContent = w.text;
              if (w.key) s.style.color = L.highlight;
              if (w.own) s.className += " own";
              if (w.key && L.keyFont) s.className += " key";
              if (M.active === "fill") s.style.color = L.wait;
              el.appendChild(s);
            });
            if (!g.box && SIDES) el.className += " " + SIDES;
            root.appendChild(el);
            return el;
          });
          // the biggest size at which the group fits in its lines and no word is wider than the frame's room
          function fit(el) {
            var size = DATA.size, least = Math.round(DATA.size * 0.55);
            el.style.visibility = "hidden";
            for (; size > least; size -= 2) {
              el.style.fontSize = size + "px";
              var high = el.offsetHeight, room = DATA.maxWidth;
              if (el.classList.contains("cap-card") || el.classList.contains("padded")${padded}) {   // a card's own padding and border are no lines of text, and no room for a word
                var cs = getComputedStyle(el);
                high = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
                room = DATA.maxWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2 * parseFloat(cs.borderLeftWidth);
              }
              var lines = high / (size * L.lineHeight);
              var widest = Math.max.apply(null, Array.prototype.map.call(el.children, function (c) { return c.offsetWidth; })) - PULL * size;
              // (the words are inline blocks between spaces: the lines balance, no word is left alone)
              if (lines <= DATA.lines + 0.35 && widest <= room) break;
            }
            el.style.fontSize = size + "px";
            // a word that is wider than its room even at the least size is set as small as it takes, alone or with the words of its group: it is never cut off at the frame's edge
            var all = el.querySelectorAll(".cap-word"), widestWord = function () { return Math.max.apply(null, Array.prototype.map.call(all, function (c) { return c.offsetWidth; })) - PULL * size; };
            while (size > 14 && widestWord() > room) { size -= 2; el.style.fontSize = size + "px"; }${hug}
          }
          // a box behind every line of text of a fitted group. The lines are read from the text itself (a word that breaks at a hyphen has two); a line's middle is the middle of its letters whatever the font, its height the type's line
          function boxes(el) {
            var size = parseFloat(el.style.fontSize), high = size * L.lineHeight, padY = L.linePad[0] * size, padX = L.linePad[1] * size;
            var at = el.getBoundingClientRect(), range = document.createRange(), lines = [];
            Array.prototype.forEach.call(el.querySelectorAll(".cap-word"), function (w) {
              range.selectNodeContents(w);
              Array.prototype.forEach.call(range.getClientRects(), function (r) {
                if (!r.width) return;
                var mid = (r.top + r.bottom) / 2 - at.top, line = lines.filter(function (l) { return Math.abs(l.mid - mid) < size * 0.5; })[0];
                if (line) { line.left = Math.min(line.left, r.left - at.left); line.right = Math.max(line.right, r.right - at.left); }
                else lines.push({ mid: mid, left: r.left - at.left, right: r.right - at.left });
              });
            });
            lines.forEach(function (line) {
              var box = document.createElement("div");
              box.className = "cap-box";
              box.style.left = line.left - padX + "px";
              box.style.top = line.mid - high / 2 - padY + "px";
              box.style.width = line.right - line.left + 2 * padX + "px";
              box.style.height = high + 2 * padY + "px";
              el.insertBefore(box, el.firstChild);
            });
          }
          function reveal(w) {
            var spoken = Math.max(0.03, w.said - w.start);
            return Math.min(0.3, Math.max(0.045, spoken * 0.55), Math.max(0.025, spoken * 0.85));
          }
          function build() {
            var tl = gsap.timeline({ paused: true });
            DATA.groups.forEach(function (g, gi) {
              var el = els[gi], words = el.querySelectorAll(".cap-word");
              fit(el);
              if (el.classList.contains("lined")) boxes(el);
              tl.set(el, { visibility: "visible", opacity: 1 }, g.start);
              // punch: there at once, a little smaller, snapping to its size (it never starts transparent: a frame of the video would show no caption)
              if (M.in === "punch") tl.fromTo(el, { scale: 0.84 }, { scale: 1, duration: 0.1, ease: "power3.out" }, g.start);
              if (M.in === "rise") tl.fromTo(el, { y: 26, opacity: 0 }, { y: 0, opacity: 1, duration: 0.18, ease: "power2.out" }, g.start);
              if (M.in === "fade") tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "power1.out" }, g.start);
              g.words.forEach(function (w, wi) {
                var s = words[wi], base = w.key ? L.highlight : L.color;
                if (M.in === "wipe") tl.fromTo(s, { clipPath: "inset(-20% 100% -20% 0%)" }, { clipPath: "inset(-20% -10% -20% -10%)", duration: reveal(w), ease: "power2.out" }, w.start);
                if (M.active === "color-scale") {
                  tl.to(s, { color: w.key ? L.highlight : L.accent, scale: L.grow || 1.08, duration: 0.06, ease: "power2.out" }, w.start);
                  tl.to(s, { color: base, scale: 1, duration: 0.08, ease: "power2.in" }, w.end);
                }
                if (M.active === "pill") {
                  tl.to(s, { backgroundColor: L.accent, color: "#FFFFFF", duration: 0.06 }, w.start);
                  tl.to(s, { backgroundColor: "rgba(0,0,0,0)", color: base, duration: 0.08 }, w.end);
                }
                if (M.active === "dim-after" && !w.key) tl.to(s, { color: L.dim, duration: 0.2 }, w.said);
                // fill: the words wait in L.wait; the one being said takes the accent (a key word its key colour) and stays in L.color once said. A word shorter than the light-up is lit by its end, so two tweens never hold its colour at once
                if (M.active === "fill") {
                  tl.to(s, { color: w.key ? L.highlight : L.accent, duration: Math.max(0.01, Math.min(0.08, w.end - w.start)), ease: "power1.out" }, w.start);
                  if (!w.key && L.accent !== L.color) tl.to(s, { color: L.color, duration: 0.05, ease: "power1.out" }, w.end);
                }
              });
              var last = g.words[g.words.length - 1];
              var safe = Math.max(last.said, last.start + reveal(last) + 0.07);
              if (M.out === "fade" && g.end - 0.15 >= safe) tl.to(el, { opacity: 0, duration: 0.15, ease: "power1.in" }, g.end - 0.15);
              if (M.out === "wipe" && g.end - 0.2 >= safe) tl.to(words, { clipPath: "inset(-20% -10% -20% 110%)", duration: 0.2, stagger: 0.03, ease: "power2.in" }, g.end - 0.2);
              if (M.out === "wipe" && g.box && g.end - 0.2 >= safe) tl.to(el, { opacity: 0, duration: 0.2, ease: "power1.in" }, g.end - 0.2);   // a card goes whole
              tl.set(el, { visibility: "hidden", opacity: 0 }, g.end);
            });
            window.__timelines["${ID}"] = tl;
          }
          (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(build);
        })();
      </script>
    </template>
  </body>
</html>
`;
  fs.writeFileSync(path.join(out, "index.html"), html);
  // What the caller is told: the area in px of the frame (the y its lowest line ends at, how high
  // its lines reach with the padding and border of a style's box or a card around them), the words
  // that are wider than a line of it and so are set smaller, and how many cards there are, which
  // are never cut to an area.
  const ends = height - area.bottom, cards = gs.filter((g) => g.box).length;
  const around = cards ? 0.44 * area.type + 2 * Math.max(3, Math.round(area.type * 0.045)) : look.box ? 0.44 * area.type : look.lineBox ? 2 * look.linePad[0] * area.type : 0;
  return { groups: gs.length, cards, wide, joined, small, smaller, kept, followed, area: { left: area.left, width: area.maxWidth, bottom: ends, top: Math.round(ends - area.lines * area.type * look.lineHeight - around), align: area.align, size: Math.round(area.type), lines: area.lines, own: !!area.own } };
}

// The clip that mounts the captions in a host composition: on top of everything, the whole length.
export function mount({ dir = ID, width, height, duration, track = 9 }) {
  return `<div id="${ID}" data-composition-id="${ID}" data-composition-src="${dir}/index.html" data-start="0" data-duration="${n(duration)}" data-track-index="${track}" data-track-kind="captions" data-width="${width}" data-height="${height}"></div>`;
}
