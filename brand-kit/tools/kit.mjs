#!/usr/bin/env node
// A brand kit: a folder with a DESIGN.md (https://github.com/google-labs-code/design.md) and the
// files it names. Made for agents: each command prints what it did and what to do next.
//
//   node tools/kit.mjs draft <site-dir> <brand-dir> [--logo <file>] [--name "…"]
//        the first DESIGN.md from a site read with site.mjs: colours, fonts (Google's or the site's
//        own files), logo, social profiles; the sections that need the person stay marked "To agree"
//   node tools/kit.mjs check <brand-dir>      what is wrong or missing (✗) or worth a look (⚠),
//                                             with the format's own linter
//   node tools/kit.mjs logos <site-dir>       the logo candidates as tiles for the chat
//   node tools/kit.mjs fonts <brand-dir> [--try "Family"]
//        a picture of the kit's fonts for the chat; --try shows a Google font beside them
//   node tools/kit.mjs show <brand-dir>       the kit at a glance as a hiccup block
//   node tools/kit.mjs board <brand-dir> [--lang de] [--out artifacts/brand-board.html]
//        the brand board beside the chat (logo, colours, type, voice, the look of a story) and a
//        picture of it for the chat
//
// Pictures for the chat go to uploads/brand/ (--uploads to change it).

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { downloadFonts, googleFont } from "./lib/look.mjs";
import * as design from "./lib/design-md.mjs";
import { contrast, mix } from "./lib/colors.mjs";
import { launch } from "./lib/chrome.mjs";

const SKILL = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [cmd, ...rest] = process.argv.slice(2);
const opts = {};
const pos = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) opts[rest[i].slice(2)] = rest[++i];
  else pos.push(rest[i]);
}
const UPLOADS = opts.uploads || "uploads/brand";
const TO_AGREE = "To agree with the person";

function fail(message) {
  console.log(message);
  process.exit(1);
}

const stamp = () => Date.now().toString(36);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dataUrl = (file) => {
  const ext = path.extname(file).slice(1).toLowerCase();
  const type = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", ico: "image/x-icon", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" }[ext] || "application/octet-stream";
  return `data:${type};base64,${fs.readFileSync(file).toString("base64")}`;
};

function loadKit(dir) {
  const kit = design.read(dir);
  if (!kit) fail(`${dir} has no ${design.FILE}: make one with node <skill>/tools/kit.mjs draft <site-dir> ${dir}.`);
  return kit;
}

async function draft(siteDir, dir) {
  const site = JSON.parse(fs.readFileSync(path.join(siteDir, "site.json"), "utf8"));
  const look = site.look;
  fs.mkdirSync(dir, { recursive: true });
  let logoSrc = opts.logo ? path.resolve(opts.logo) : null;
  if (!logoSrc) {
    const best = look.logos.find((l) => l.file && l.source === "page" && !/\.(ico|img)$/.test(l.file)) || look.logos.find((l) => l.file && !/\.(ico|img)$/.test(l.file));
    if (best) logoSrc = path.join(siteDir, best.file);
  }
  let logo = null;
  if (logoSrc && fs.existsSync(logoSrc)) {
    logo = `logo${path.extname(logoSrc).toLowerCase() || ".png"}`;
    fs.copyFileSync(logoSrc, path.join(dir, logo));
  }
  const fonts = await downloadFonts(look.fontSources || {}, dir);
  const typography = {};
  const uppercase = [];
  const system = [];
  const typo = (token, f, weight) => {
    if (!f?.family) return;
    typography[token] = { fontFamily: f.family, fontWeight: f.weight || weight };
    if (f.lineHeight) typography[token].lineHeight = f.lineHeight;
    if (f.letterSpacing) typography[token].letterSpacing = `${f.letterSpacing}em`;
    if (f.uppercase) uppercase.push(token);
    if (f.system) system.push(token);
  };
  typo("headline-display", look.fonts.display || look.fonts.heading, 800);
  typo("headline-lg", look.fonts.heading, 700);
  typo("body-md", look.fonts.body, 400);
  typo("label-md", look.fonts.label, 600);
  const name = opts.name || site.name;
  const tokens = {
    version: "alpha",
    name,
    ...(site.description ? { description: site.description.slice(0, 200) } : {}),
    colors: look.palette,
    typography,
    rounded: { md: "16px", full: "9999px" },
    ...(uppercase.length ? { uppercase } : {}),
    ...(logo ? { logo: { primary: logo } } : {}),
    ...(Object.keys(fonts).length ? { fonts } : {}),
    social: { ...look.social, website: new URL(site.finalUrl || site.url).origin },
  };
  const p = look.palette;
  const prose = {
    Overview: `${name}${site.description ? `: ${site.description}` : ""}\n\n${TO_AGREE}: the brand's character in three words, what it stands for, how it should feel.`,
    Colors: [
      `- **Primary (${p.primary}):** the brand colour, as the site uses it for its logo, buttons and links.`,
      p.secondary && `- **Secondary (${p.secondary}):** the second colour of the site.`,
      p.tertiary && `- **Tertiary (${p.tertiary}):** a further colour of the site.`,
      `- **Surface (${p.surface}):** the light ground.`,
      `- **On-surface (${p["on-surface"]}):** the text on the light ground.`,
      `- **On-primary (${p["on-primary"]}):** the text on the brand colour.`,
    ].filter(Boolean).join("\n"),
    Typography: Object.entries(typography).map(([k, v]) => `- **${k}:** ${v.fontFamily} ${v.fontWeight}${uppercase.includes(k) ? ", in capitals" : ""}${system.includes(k) ? ", for the system font the site uses" : ""}`).join("\n") || "System fonts.",
    Shapes: "Rounded corners of 16 px on cards and pictures; pills for labels.",
    Logo: logo ? `\`${logo}\`, as the site shows it in its header.` : `${TO_AGREE}: no logo found on the site.`,
    Imagery: `${TO_AGREE}: what the brand's pictures show and how (people, products, places; light, colourful, calm …).`,
    "Voice and Tone": `${TO_AGREE}: how the brand speaks (three adjectives; du or Sie, you; emoji or not; short or long sentences), with a "We say / We never say" table.`,
    Audience: `${TO_AGREE}: who the brand talks to and what they care about.`,
    Social: [...Object.entries(tokens.social).map(([k, v]) => `- ${k}: ${v}`), look.ctas.length ? `\nButtons on the site: ${look.ctas.slice(0, 8).map((c) => `"${c}"`).join(", ")}.` : null].filter(Boolean).join("\n"),
    "Do's and Don'ts": [
      `- Do set text on the brand colour in ${p["on-primary"]} (contrast ${contrast(p["on-primary"], p.primary).toFixed(1)}:1).`,
      `- Do keep the logo as it is: no stretching, no new colours.`,
      `${TO_AGREE}: what the brand never does.`,
    ].join("\n"),
  };
  const file = design.write(dir, tokens, prose);
  console.log(`${file}: ${name}, primary ${p.primary}, ${Object.values(typography)[0]?.fontFamily || "system font"}, ${logo ? "logo " + logo : "no logo"}.`);
  check(dir);
  console.log(`\nNext: agree on the logo, the colours, the fonts and the voice with the person, one by one, and write their answers into ${file}.`);
}

function check(dir) {
  const kit = loadKit(dir);
  const { errors, warnings, brand } = design.check(kit, dir);
  for (const [name, text] of Object.entries(kit.sections)) if (text.includes(TO_AGREE)) warnings.push(`section "${name}" is still to agree with the person`);
  // the format's own linter: broken references, contrast of the components, structure
  const bin = path.join(SKILL, "node_modules", ".bin", "design.md");
  if (fs.existsSync(bin)) {
    const r = spawnSync(bin, ["lint", kit.file], { encoding: "utf8" });
    try {
      const out = JSON.parse(r.stdout);
      for (const f of out.findings || []) {
        if (f.severity === "error") errors.push(`design.md lint: ${f.path ? f.path + ": " : ""}${f.message}`);
        else if (f.severity === "warning") warnings.push(`design.md lint: ${f.path ? f.path + ": " : ""}${f.message}`);
      }
    } catch {}
  }
  for (const e of errors) console.log(`✗ ${e}`);
  for (const w of warnings) console.log(`⚠ ${w}`);
  if (!errors.length && !warnings.length) console.log("✓ The kit is complete.");
  return { kit, brand, errors };
}

function logos(siteDir) {
  const site = JSON.parse(fs.readFileSync(path.join(siteDir, "site.json"), "utf8"));
  const out = path.join(UPLOADS, `logos-${stamp()}`);
  fs.mkdirSync(out, { recursive: true });
  const tiles = [];
  site.look.logos.forEach((l, i) => {
    const pic = l.shot && fs.existsSync(path.join(siteDir, l.shot)) ? l.shot : l.file;
    if (!pic || !fs.existsSync(path.join(siteDir, pic)) || /\.(ico|img)$/.test(pic)) return;
    const to = path.join(out, `${i + 1}${path.extname(pic)}`);
    fs.copyFileSync(path.join(siteDir, pic), to);
    tiles.push(`  [:div {:style {:display "flex" :flex-direction "column" :gap "6px" :border "1px solid rgba(127,127,127,.35)" :border-radius "10px" :padding "8px" :align-items "center"}}
   [:div {:style {:height "70px" :display "flex" :align-items "center"}} [:img {:src "${to}" :style {:max-height "64px" :max-width "100%"}}]]
   [:small "${esc(l.source === "page" ? "from the page" : l.source)}"]
   [:button {:send "Take logo ${i + 1} (${l.file})"} "Take this one"]]`);
  });
  if (!tiles.length) return console.log("No logo candidates: ask the person to attach their logo (best a PNG with a transparent ground, or an SVG).");
  console.log(`Logo candidates for the chat (the file each stands for is in ${siteDir}/logos/):\n\`\`\`hiccup
[:div
 [:p "Which one is your logo?"]
 [:div {:style {:display "grid" :grid-template-columns "repeat(auto-fill, minmax(150px, 1fr))" :gap "8px"}}
${tiles.join("\n")}]
 [:p [:small "Or attach another one: best a PNG with a transparent ground, or an SVG."]]]
\`\`\``);
}

async function fontFaces(brand) {
  const css = [];
  for (const [family, src] of Object.entries(brand.fontSources)) {
    if (src === "google") continue;
    for (const s of src) if (s.file && fs.existsSync(s.file)) css.push(`@font-face{font-family:"${family}";src:url("${dataUrl(s.file)}");font-weight:${parseInt(s.weight, 10) || 400}}`);
  }
  const google = [...new Set(Object.values(brand.fonts).map((f) => f.family).filter((f) => f && brand.fontSources[f] === "google"))];
  const links = google.map((f) => `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;700&display=block">`);
  // a font without a weight 700 still loads: the ask without weights
  links.push(...google.map((f) => `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, "+")}&display=block">`));
  return { css: css.join("\n"), links: links.join("\n") };
}

async function shoot(html, file, width, fullPage = true) {
  const tmp = path.resolve(path.dirname(file), `.${path.basename(file)}.html`);
  fs.writeFileSync(tmp, html);
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 100, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle0", timeout: 60000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: file, type: "jpeg", quality: 86, fullPage });
  } finally {
    await browser.close();
    fs.rmSync(tmp, { force: true });
  }
}

async function fonts(dir) {
  const { brand } = check(dir);
  let tryFamily = opts.try || null;
  if (tryFamily && !(await googleFont(tryFamily))) fail(`"${tryFamily}" is not a Google font: check the name on fonts.google.com.`);
  const { css, links } = await fontFaces(brand);
  const tryLink = tryFamily ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(tryFamily).replace(/%20/g, "+")}:wght@400;700;800&display=block">` : "";
  const d = brand.fonts.display, b = brand.fonts.body;
  const block = (family, weight, label, upper) => `<section><small>${esc(label)}</small><h1 style="font-family:'${esc(family)}',sans-serif;font-weight:${weight};text-transform:${upper ? "uppercase" : "none"}">${esc(brand.name || "Your brand")}</h1><h2 style="font-family:'${esc(family)}',sans-serif;font-weight:${weight}">Aa Bb Cc 0123 ?!&amp;</h2><p style="font-family:'${esc(b.family || family)}',sans-serif">${esc(brand.description || "This is how the text of your stories reads: short, clear and in your voice.")}</p></section>`;
  const html = `<!doctype html><html><head><meta charset="utf-8">${links}${tryLink}<style>${css}
body{margin:0;background:#fff;color:#111;font:16px system-ui,sans-serif}main{display:flex;gap:0}section{flex:1;padding:36px 40px;border-right:1px solid #eee}
small{color:#888;font-size:15px}h1{font-size:64px;line-height:1.05;margin:10px 0 6px}h2{font-size:34px;margin:0 0 16px;font-weight:400;color:#444}p{font-size:22px;line-height:1.45;margin:0;color:#333}
</style></head><body><main>${block(d.family || "sans-serif", d.weight || 700, `${d.family || "System font"} ${d.weight || ""} · now`, d.uppercase)}${tryFamily ? block(tryFamily, Math.min(d.weight || 700, 800), `${tryFamily} · to try`, d.uppercase) : ""}</main></body></html>`;
  fs.mkdirSync(UPLOADS, { recursive: true });
  const file = path.join(UPLOADS, `fonts-${stamp()}.jpg`);
  await shoot(html, file, tryFamily ? 1400 : 760);
  console.log(`${file}: ${d.family || "system font"}${tryFamily ? ` beside ${tryFamily}` : ""}. Show it in the chat: [:img {:src "${file}" :style {:max-width "100%" :border-radius "8px"}}]`);
}

function show(dir) {
  const { brand } = check(dir);
  fs.mkdirSync(UPLOADS, { recursive: true });
  let logo = null;
  if (brand.logo.primary && fs.existsSync(brand.logo.primary)) {
    logo = path.join(UPLOADS, `logo-${stamp()}${path.extname(brand.logo.primary)}`);
    fs.copyFileSync(brand.logo.primary, logo);
  }
  const c = brand.colors;
  const colors = [["Primary", c.primary], ["Secondary", c.secondary], ["Tertiary", c.tertiary], ["Surface", c.surface], ["Text", c.ink]].filter(([, v]) => v);
  console.log(`\n${brand.name}: ${colors.map(([k, v]) => `${k.toLowerCase()} ${v}`).join(" · ")}`);
  console.log(`Fonts: ${Object.entries(brand.fonts).map(([k, f]) => `${k} ${f.family || "system"} ${f.weight}${f.uppercase ? " caps" : ""}`).join(" · ")}`);
  const sw = colors.map(([k, v]) => `[:div {:style {:display "flex" :flex-direction "column" :align-items "center" :gap "4px"}} [:button {:send "Change the ${k.toLowerCase()} colour (${v})" :style {:background "${v}" :width "44px" :height "44px" :border-radius "50%" :border "1px solid rgba(127,127,127,.4)"}}] [:small "${k}"] [:small "${v}"]]`).join(" ");
  console.log(`\nA block for the chat (change the texts to the person's language):\n\`\`\`hiccup
[:div
 ${logo ? `[:img {:src "${logo}" :style {:max-height "64px" :max-width "240px"}}]` : `[:p [:em "No logo yet: attach yours."]]`}
 [:div {:style {:display "flex" :gap "10px" :margin "10px 0" :flex-wrap "wrap"}} ${sw}]
 [:p "Font: " [:strong "${esc(brand.fonts.display.family || "System font")}"]${brand.fonts.body.family && brand.fonts.body.family !== brand.fonts.display.family ? ` " · " [:strong "${esc(brand.fonts.body.family)}"]` : ""}]]
\`\`\``);
}

// the prose of a section as HTML: paragraphs, lists, tables, bold and code
function prose(md) {
  const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const out = [];
  const lines = String(md || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      i--;
      const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
      const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      out.push(`<table>${body.map((r, j) => `<tr>${cells(r).map((x) => (j === 0 ? `<th>${inline(x)}</th>` : `<td>${inline(x)}</td>`)).join("")}</tr>`).join("")}</table>`);
    } else if (/^\s*[-*] /.test(l)) {
      const items = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*] /, ""));
      i--;
      out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`);
    } else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  return out.join("");
}

const WORDS = {
  en: { logo: "Logo", colors: "Colours", type: "Typography", voice: "Voice and tone", audience: "Audience", imagery: "Imagery", dos: "Do's and don'ts", stories: "In a story", social: "Social", onLight: "on light", onBrand: "on the brand colour", onDark: "on dark", text: "Text", sample: "This is how the text of your stories reads.", cta: "Read more", tip: "Tip", toAgree: "still to agree" },
  de: { logo: "Logo", colors: "Farben", type: "Schrift", voice: "Stimme und Ton", audience: "Zielgruppe", imagery: "Bildsprache", dos: "Do's und Don'ts", stories: "In einer Story", social: "Social", onLight: "auf hell", onBrand: "auf der Markenfarbe", onDark: "auf dunkel", text: "Text", sample: "So liest sich der Text deiner Stories.", cta: "Mehr lesen", tip: "Tipp", toAgree: "noch abzustimmen" },
};

async function board(dir) {
  const { brand, kit } = check(dir);
  const w = WORDS[opts.lang] || WORDS.en;
  const c = brand.colors;
  const { css, links } = await fontFaces(brand);
  const d = brand.fonts.display, b = brand.fonts.body, l = brand.fonts.label;
  const df = `'${esc(d.family || "sans-serif")}',sans-serif`, bf = `'${esc(b.family || d.family || "sans-serif")}',sans-serif`, lf = `'${esc(l.family || b.family || "sans-serif")}',sans-serif`;
  const logo = brand.logo.primary && fs.existsSync(brand.logo.primary) ? dataUrl(brand.logo.primary) : null;
  const logoDark = brand.logo.onDark && fs.existsSync(brand.logo.onDark) ? dataUrl(brand.logo.onDark) : null;
  const sw = [["primary", c.primary, c.onPrimary], ["secondary", c.secondary, c.onSecondary], ["tertiary", c.tertiary, c.onTertiary], ["surface", c.surface, c.ink], ["on-surface", c.ink, c.surface]]
    .filter(([, v]) => v).map(([k, v, on]) => `<div class="sw" style="background:${v};color:${on}"><span class="aa" style="font-family:${df}">Aa</span><b>${k}</b><span>${v}</span><span>${contrast(on, v).toFixed(1)}:1</span></div>`).join("");
  const sec = (title, md) => (md ? `<section><h3>${esc(title)}</h3>${md.includes("To agree with the person") ? `<p class="todo">${esc(w.toAgree)}</p>` : prose(md)}</section>` : "");
  const S = kit.sections;
  const headline = String(brand.description || brand.name || "").split(/[.!?:–-]/)[0].slice(0, 46) || brand.name;
  const r = Math.min(brand.radius, 40);
  // tall ascenders (Futura, Jost) collide below 1.06
  const lh = Math.min(Math.max(d.lineHeight || 1.08, 1.06), 1.2);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(brand.name)} · Brand kit</title>${links}<style>${css}
:root{color-scheme:light}
body{margin:0;background:#f4f3f0;color:#1c1c1e;font:15px/1.5 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:28px 20px 60px;display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
section{background:#fff;border-radius:16px;padding:20px 22px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
section.wide{grid-column:1/-1}
@media (min-width:1000px){section.two{grid-column:span 2}}
h1{font-family:${df};font-weight:${d.weight};text-transform:${d.uppercase ? "uppercase" : "none"};font-size:40px;line-height:${lh};margin:6px 0}
h3{margin:0 0 12px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#8a8a8e}
header{grid-column:1/-1;display:flex;align-items:center;gap:22px;padding:6px 4px 10px}
header img{max-height:64px;max-width:260px}
.desc{color:#55555a;margin:0}
.logos{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.logos div{height:110px;border-radius:12px;display:flex;align-items:center;justify-content:center;padding:14px}
.logos img{max-width:100%;max-height:70px}.logos small{display:block;color:#8a8a8e;text-align:center;margin-top:4px}
.sws{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.sw{border-radius:12px;padding:12px;min-height:120px;display:flex;flex-direction:column;justify-content:flex-end;gap:1px;font-size:13px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08)}
.sw .aa{font-size:34px;line-height:1;margin-bottom:auto}
.spec .big{font-family:${df};font-weight:${d.weight};text-transform:${d.uppercase ? "uppercase" : "none"};letter-spacing:${(d.letterSpacing || 0).toFixed(3)}em;font-size:52px;line-height:${lh};margin:0 0 6px}
.spec .body{font-family:${bf};font-size:18px;margin:0 0 10px}
.spec .label{font-family:${lf};font-weight:${Math.max(600, l.weight || 600)};text-transform:uppercase;letter-spacing:.08em;font-size:13px}
.spec small{color:#8a8a8e;display:block;margin-top:8px}
.stories{display:flex;gap:12px;overflow-x:auto;padding-bottom:4px}
.st{flex:none;width:198px;height:352px;border-radius:18px;position:relative;overflow:hidden;padding:64px 18px 54px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;gap:12px}
.st .k{align-self:flex-start;font-family:${lf};font-weight:700;font-size:10px;letter-spacing:.08em;text-transform:uppercase;padding:6px 10px;border-radius:${r}px}
.st .t{font-family:${df};font-weight:${d.weight};text-transform:${d.uppercase ? "uppercase" : "none"};letter-spacing:${(d.letterSpacing || 0).toFixed(3)}em;font-size:30px;line-height:${lh};margin:0}
.st .b{font-family:${bf};font-size:13px;line-height:1.4;margin:0}
.st .n{font-family:${df};font-weight:${d.weight};font-size:46px;line-height:1}
.st .lg{position:absolute;top:22px;left:50%;transform:translateX(-50%);max-height:26px;max-width:110px}
.st .chip{background:#fff;padding:5px 9px;border-radius:${r}px;max-height:34px}
.st .sticker{align-self:center;background:#fff;color:#0095f6;font:600 15px system-ui;padding:9px 14px;border-radius:9px;letter-spacing:.02em;text-transform:uppercase}
.st .deco{position:absolute;width:300px;height:300px;border-radius:50%;right:-150px;top:-120px}
table{border-collapse:collapse;width:100%;margin:6px 0}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top}th{font-size:13px;color:#55555a}
ul{margin:4px 0;padding-left:20px}p{margin:6px 0}.todo{color:#b7791f;font-style:italic}
code{background:#f1f1f1;padding:1px 5px;border-radius:5px}
</style></head><body><main>
<header>${logo ? `<img src="${logo}" alt="">` : ""}<div><h1>${esc(brand.name)}</h1>${brand.description ? `<p class="desc">${esc(brand.description)}</p>` : ""}</div></header>
<section class="wide"><h3>${esc(w.logo)}</h3><div class="logos">
<div style="background:${c.surface}">${logo ? `<img src="${logo}">` : ""}</div>
<div style="background:${c.primary}">${logo ? `<img src="${logo}">` : ""}</div>
<div style="background:${c.ink}">${logoDark ? `<img src="${logoDark}">` : logo ? `<img src="${logo}">` : ""}</div>
</div><div class="logos"><small>${esc(w.onLight)}</small><small>${esc(w.onBrand)}</small><small>${esc(w.onDark)}</small></div></section>
<section class="wide"><h3>${esc(w.colors)}</h3><div class="sws">${sw}</div></section>
<section class="spec"><h3>${esc(w.type)}</h3><p class="big">${esc(headline)}</p><p class="body">${esc(w.sample)}</p><span class="label">${esc(w.cta)}</span><small>${esc(d.family || "system")} ${d.weight} · ${esc(b.family || "system")} ${b.weight}</small></section>
<section class="two"><h3>${esc(w.stories)}</h3><div class="stories">
<div class="st" style="background:${c.primary};color:${c.onPrimary}"><div class="deco" style="background:${mix(c.primary, c.onPrimary, 0.1)}"></div>${logo ? `<img class="lg chip" src="${logo}">` : ""}<span class="k" style="background:${c.secondary || c.surface};color:${c.secondary ? c.onSecondary : c.ink}">${esc(brand.name)}</span><p class="t">${esc(headline)}</p></div>
<div class="st" style="background:${c.surface};color:${c.ink}"><div class="deco" style="background:${mix(c.surface, c.primary, 0.1)}"></div><span class="n" style="color:${c.primary}">01</span><p class="t" style="font-size:24px">${esc(w.tip)}</p><p class="b">${esc(w.sample)}</p></div>
<div class="st" style="background:${c.ink};color:${c.surface}"><div class="deco" style="background:${mix(c.ink, c.surface, 0.08)}"></div><p class="t" style="font-size:26px">${esc(w.cta)}</p><span class="sticker">🔗 ${esc(w.cta)}</span></div>
</div></section>
${sec(w.voice, S["Voice and Tone"])}${sec(w.audience, S.Audience)}${sec(w.imagery, S.Imagery)}${sec(w.dos, S["Do's and Don'ts"])}${sec(w.social, S.Social)}
</main></body></html>`;
  const out = opts.out || path.join("artifacts", "brand-board.html");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  fs.mkdirSync(UPLOADS, { recursive: true });
  const pic = path.join(UPLOADS, `board-${stamp()}.jpg`);
  await shoot(html, pic, 1100);
  console.log(`Board beside the chat: ${out}\nA picture of it for the chat: ${pic}`);
}

if (cmd === "draft") {
  if (pos.length < 2) fail("Usage: node tools/kit.mjs draft <site-dir> <brand-dir> [--logo <file>] [--name \"…\"]");
  await draft(pos[0], pos[1]);
} else if (cmd === "check") {
  if (!pos[0]) fail("Usage: node tools/kit.mjs check <brand-dir>");
  process.exit(check(pos[0]).errors.length ? 1 : 0);
} else if (cmd === "logos") {
  if (!pos[0]) fail("Usage: node tools/kit.mjs logos <site-dir>");
  logos(pos[0]);
} else if (cmd === "fonts") {
  if (!pos[0]) fail("Usage: node tools/kit.mjs fonts <brand-dir> [--try \"Family\"]");
  await fonts(pos[0]);
} else if (cmd === "show") {
  if (!pos[0]) fail("Usage: node tools/kit.mjs show <brand-dir>");
  show(pos[0]);
} else if (cmd === "board") {
  if (!pos[0]) fail("Usage: node tools/kit.mjs board <brand-dir> [--lang de] [--out artifacts/brand-board.html]");
  await board(pos[0]);
} else {
  fail("Commands: draft <site-dir> <brand-dir>, check <brand-dir>, logos <site-dir>, fonts <brand-dir>, show <brand-dir>, board <brand-dir>");
}
