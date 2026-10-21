#!/usr/bin/env node
// The brand kit the stories take their look from: a folder with a DESIGN.md (colours, fonts,
// logo, the way the brand speaks) and its files. Made for agents: each command prints what it did.
//
//   node tools/brand.mjs draft <page-dir> <brand-dir> [--logo <file>] [--name "…"]
//        a first kit from the look of a page read with page.mjs: its colours, its fonts (Google's
//        or the site's own files), its logo; check it with the person, then change DESIGN.md
//   node tools/brand.mjs check <brand-dir>    what is wrong or missing (✗ stops the frames)
//   node tools/brand.mjs show <brand-dir> [--uploads uploads/brand]
//        the kit in a few lines, the logo copied to the uploads so that it shows in the chat, and a
//        hiccup block with the logo, the colours and the fonts to show the person

import fs from "node:fs";
import path from "node:path";
import { downloadFonts } from "./lib/look.mjs";
import * as design from "./lib/design-md.mjs";
import { contrast } from "./lib/colors.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const opts = {};
const pos = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) opts[rest[i].slice(2)] = rest[++i];
  else pos.push(rest[i]);
}

function fail(message) {
  console.log(message);
  process.exit(1);
}

async function draft(pageDir, dir) {
  const page = JSON.parse(fs.readFileSync(path.join(pageDir, "page.json"), "utf8"));
  const look = page.look;
  fs.mkdirSync(dir, { recursive: true });
  // the logo: the one asked for, else the best candidate the page showed, else its icon
  let logoSrc = opts.logo ? path.resolve(opts.logo) : null;
  if (!logoSrc) {
    const best = look.logos.find((l) => l.file && l.source === "page" && !/\.(ico|img)$/.test(l.file)) || look.logos.find((l) => l.file && !/\.(ico|img)$/.test(l.file));
    if (best) logoSrc = path.join(pageDir, best.file);
  }
  let logo = null;
  if (logoSrc && fs.existsSync(logoSrc)) {
    logo = `logo${path.extname(logoSrc).toLowerCase() || ".png"}`;
    fs.copyFileSync(logoSrc, path.join(dir, logo));
  }
  const fonts = await downloadFonts(look.fontSources || {}, dir);
  const name = opts.name || page.siteName || new URL(page.url).hostname.replace(/^www\./, "");
  const typography = {};
  const uppercase = [];
  const typo = (token, f, fallbackWeight) => {
    if (!f?.family) return;
    typography[token] = { fontFamily: f.family, fontWeight: f.weight || fallbackWeight };
    if (f.lineHeight) typography[token].lineHeight = f.lineHeight;
    if (f.letterSpacing) typography[token].letterSpacing = `${f.letterSpacing}em`;
    if (f.uppercase) uppercase.push(token);
  };
  typo("headline-display", look.fonts.display || look.fonts.heading, 800);
  typo("headline-lg", look.fonts.heading, 700);
  typo("body-md", look.fonts.body, 400);
  typo("label-md", look.fonts.label, 600);
  const tokens = {
    version: "alpha",
    name,
    description: (page.description || "").slice(0, 200) || undefined,
    colors: look.palette,
    typography,
    rounded: { md: "16px", full: "9999px" },
    ...(uppercase.length ? { uppercase } : {}),
    ...(logo ? { logo: { primary: logo } } : {}),
    ...(Object.keys(fonts).length ? { fonts } : {}),
    social: { ...look.social, website: new URL(page.finalUrl || page.url).origin },
  };
  for (const k of Object.keys(tokens)) if (tokens[k] === undefined) delete tokens[k];
  const p = look.palette;
  const prose = {
    Overview: `Drafted from ${page.finalUrl || page.url} on ${new Date().toISOString().slice(0, 10)}: the colours, fonts and logo the site shows. Confirm or correct them with the person.`,
    Colors: [
      `- **Primary (${p.primary}):** the brand's main colour, as the site uses it for its logo, buttons and links.`,
      p.secondary && `- **Secondary (${p.secondary}):** the second colour of the site.`,
      p.tertiary && `- **Tertiary (${p.tertiary}):** a further colour of the site.`,
      `- **Surface (${p.surface}):** the light ground.`,
      `- **On-surface (${p["on-surface"]}):** the text on the light ground.`,
    ].filter(Boolean).join("\n"),
    Typography: Object.entries(typography).map(([k, v]) => `- **${k}:** ${v.fontFamily} ${v.fontWeight}${uppercase.includes(k) ? ", in capitals" : ""}`).join("\n") || "System fonts.",
    Logo: logo ? `\`${logo}\`, as the site shows it in its header.` : "No logo found on the site: ask the person for one.",
    Social: Object.entries(tokens.social).map(([k, v]) => `- ${k}: ${v}`).join("\n"),
  };
  const file = design.write(dir, tokens, prose);
  console.log(`${file}: ${name}, primary ${p.primary}, ${Object.values(typography)[0]?.fontFamily || "system font"}, ${logo ? "logo " + logo : "no logo"}.`);
  report(dir);
}

function report(dir) {
  const kit = design.read(dir);
  if (!kit) fail(`${dir} has no ${design.FILE}: make one with brand.mjs draft, or with the brand-kit skill.`);
  const { errors, warnings, brand } = design.check(kit, dir);
  for (const e of errors) console.log(`✗ ${e}`);
  for (const w of warnings) console.log(`⚠ ${w}`);
  if (!errors.length && !warnings.length) console.log("✓ The kit is complete.");
  return { kit, brand, errors };
}

function show(dir) {
  const { brand } = report(dir);
  const up = opts.uploads || "uploads/brand";
  fs.mkdirSync(up, { recursive: true });
  let logo = null;
  if (brand.logo.primary && fs.existsSync(brand.logo.primary)) {
    logo = path.join(up, `logo-${Date.now().toString(36)}${path.extname(brand.logo.primary)}`);
    fs.copyFileSync(brand.logo.primary, logo);
  }
  const c = brand.colors;
  const colors = [["Primary", c.primary], ["Secondary", c.secondary], ["Tertiary", c.tertiary], ["Surface", c.surface], ["Text", c.ink]].filter(([, v]) => v);
  console.log(`\n${brand.name}: ${colors.map(([k, v]) => `${k.toLowerCase()} ${v}`).join(" · ")}`);
  console.log(`Fonts: ${Object.entries(brand.fonts).map(([k, f]) => `${k} ${f.family || "system"} ${f.weight}${f.uppercase ? " caps" : ""}`).join(" · ")}`);
  console.log(`Contrast: text on primary ${contrast(c.onPrimary, c.primary).toFixed(1)}:1, text on surface ${contrast(c.ink, c.surface).toFixed(1)}:1`);
  const sw = colors.map(([k, v]) => `[:div {:style {:display "flex" :flex-direction "column" :align-items "center" :gap "4px"}} [:button {:send "Change the ${k.toLowerCase()} colour (${v})" :style {:background "${v}" :width "44px" :height "44px" :border-radius "50%" :border "1px solid rgba(127,127,127,.4)"}}] [:small "${k}"] [:small "${v}"]]`).join(" ");
  const fam = brand.fonts.display.family || "System font";
  console.log(`\nA block for the chat (the brand at a glance; change the texts to the person's language):\n\`\`\`hiccup
[:div
 ${logo ? `[:img {:src "${logo}" :style {:max-height "64px" :max-width "240px"}}]` : `[:p [:em "No logo yet: attach yours."]]`}
 [:div {:style {:display "flex" :gap "10px" :margin "10px 0"}} ${sw}]
 [:p "Font: " [:strong "${fam}"]${brand.fonts.body.family && brand.fonts.body.family !== fam ? ` " · " [:strong "${brand.fonts.body.family}"]` : ""}]
 [:button {:class "primary" :send "The brand is right"} "Looks right"] " "
 [:button {:send "Change the brand"} "Change something"]]
\`\`\``);
}

if (cmd === "draft") {
  if (pos.length < 2) fail("Usage: node tools/brand.mjs draft <page-dir> <brand-dir> [--logo <file>] [--name \"…\"]");
  await draft(pos[0], pos[1]);
} else if (cmd === "check") {
  if (!pos[0]) fail("Usage: node tools/brand.mjs check <brand-dir>");
  const { errors } = report(pos[0]);
  process.exit(errors.length ? 1 : 0);
} else if (cmd === "show") {
  if (!pos[0]) fail("Usage: node tools/brand.mjs show <brand-dir> [--uploads uploads/brand]");
  show(pos[0]);
} else {
  fail("Commands: draft <page-dir> <brand-dir>, check <brand-dir>, show <brand-dir>");
}
