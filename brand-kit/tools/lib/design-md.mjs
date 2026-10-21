// A brand kit is a folder with a DESIGN.md (https://github.com/google-labs-code/design.md): YAML
// front matter with the tokens, then prose sections. On top of the format a kit has the keys
//   logo:      primary: logo.svg, on-dark: logo-white.svg   (files beside DESIGN.md)
//   fonts:     <family>: google | [{file, weight}]          (where each family's files come from)
//   uppercase: [<typography token>, …]                       (the tokens set in capitals)
//   social:    instagram: handle, tiktok: handle, website: url …
// which the format allows (unknown top-level keys) and other tools ignore.

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { contrast, onColor, parse } from "./colors.mjs";

export const FILE = "DESIGN.md";

export function split(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { tokens: {}, body: text };
  return { tokens: YAML.parse(m[1]) || {}, body: m[2] };
}

export function sections(body) {
  const out = {};
  let name = null;
  for (const line of body.split("\n")) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) { name = h[1]; out[name] = []; continue; }
    if (name) out[name].push(line);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join("\n").trim()]));
}

export function read(dir) {
  const file = path.join(dir, FILE);
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  const { tokens, body } = split(text);
  return { file, text, tokens, sections: sections(body) };
}

// {colors.primary} → the value it points at
function resolve(tokens, value, depth = 0) {
  const m = typeof value === "string" && /^\{([^}]+)\}$/.exec(value.trim());
  if (!m || depth > 5) return value;
  const target = m[1].split(".").reduce((o, k) => (o == null ? o : o[k]), tokens);
  return resolve(tokens, target, depth + 1);
}

const pick = (map, names) => {
  for (const n of names) if (map && map[n]) return [n, map[n]];
  return [null, null];
};

const em = (v, size) => {
  if (v == null || v === "") return 0;
  const s = String(v).trim();
  if (s.endsWith("em") && !s.endsWith("rem")) return parseFloat(s);
  if (s.endsWith("px") && size) return parseFloat(s) / size;
  if (s.endsWith("rem")) return parseFloat(s) * 16 / (size || 16);
  return parseFloat(s) || 0;
};

const px = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  if (s.endsWith("rem")) return parseFloat(s) * 16;
  return parseFloat(s);
};

function font(tokens, token, name, uppercase) {
  if (!token) return null;
  const t = Object.fromEntries(Object.entries(token).map(([k, v]) => [k, resolve(tokens, v)]));
  const size = px(t.fontSize);
  return {
    token: name,
    family: String(t.fontFamily || "").replace(/^["']|["']$/g, "") || null,
    weight: Number(t.fontWeight) || 400,
    letterSpacing: em(t.letterSpacing, size),
    lineHeight: t.lineHeight && !String(t.lineHeight).match(/px|rem|em/) ? Number(t.lineHeight) : null,
    uppercase: uppercase.includes(name),
  };
}

// the kit as the story frames need it, every colour and font settled
export function normalize(kit, dir) {
  const t = kit.tokens;
  const colors = Object.fromEntries(Object.entries(t.colors || {}).map(([k, v]) => [k, resolve(t, v)]).filter(([, v]) => parse(String(v))));
  const hexOf = (k) => (colors[k] ? String(colors[k]).toUpperCase() : null);
  const primary = hexOf("primary") || "#111111";
  const surface = hexOf("surface") || hexOf("neutral") || hexOf("background") || "#FFFFFF";
  let ink = hexOf("on-surface") || hexOf("ink") || hexOf("on-background") || hexOf("text");
  if (!ink || contrast(ink, surface) < 4.5) ink = onColor(surface, "#111111", "#FFFFFF");
  const on = (bg, given) => (given && contrast(given, bg) >= 3 ? given.toUpperCase() : onColor(bg, ink, surface));
  const secondary = hexOf("secondary");
  const tertiary = hexOf("tertiary");
  const uppercase = Array.isArray(t.uppercase) ? t.uppercase.map(String) : [];
  const typo = t.typography || {};
  const [dn, dt] = pick(typo, ["headline-display", "display", "display-lg", "headline-lg", "h1", "headline", "title", "heading"]);
  const [bn, bt] = pick(typo, ["body-lg", "body-md", "body", "body-sm", "paragraph", "p"]);
  const [ln, lt] = pick(typo, ["label-md", "label-lg", "label", "label-caps", "label-sm", "button", "caption"]);
  const display = font(t, dt, dn, uppercase) || font(t, bt, bn, uppercase) || { family: null, weight: 800, letterSpacing: -0.01, lineHeight: null, uppercase: false };
  const body = font(t, bt, bn, uppercase) || { ...display, weight: 400, uppercase: false, letterSpacing: 0 };
  const label = font(t, lt, ln, uppercase) || { ...body, weight: 600 };
  const rounded = t.rounded || {};
  const [, r] = pick(rounded, ["lg", "md", "card", "sm", "xl"]);
  const radius = r == null ? 24 : Math.min(px(resolve(t, r)) * 2, 64);
  const files = (f) => (f ? path.resolve(dir, f) : null);
  const logo = t.logo || {};
  const fontSources = {};
  for (const [fam, src] of Object.entries(t.fonts || {})) {
    fontSources[fam] = src === "google" ? "google" : (Array.isArray(src) ? src : [src]).map((s) => (typeof s === "string" ? { file: files(s), weight: 400 } : { file: files(s.file), weight: s.weight || 400 }));
  }
  return {
    dir, name: t.name || "", description: t.description || "",
    colors: {
      primary, secondary, tertiary, surface, ink,
      onPrimary: on(primary, hexOf("on-primary")),
      onSecondary: secondary ? on(secondary, hexOf("on-secondary")) : null,
      onTertiary: tertiary ? on(tertiary, hexOf("on-tertiary")) : null,
    },
    fonts: { display, body, label },
    fontSources,
    radius,
    logo: { primary: files(logo.primary), onDark: files(logo["on-dark"] || logo.onDark) },
    social: t.social || {},
    sections: kit.sections,
  };
}

const ORDER = ["Overview", "Colors", "Typography", "Layout", "Elevation & Depth", "Shapes", "Components", "Logo", "Imagery", "Voice and Tone", "Audience", "Social", "Do's and Don'ts"];

// a DESIGN.md from tokens and prose sections (`{"Overview": "…", …}`), sections in the
// format's order, ours before the Do's and Don'ts
export function write(dir, tokens, prose = {}) {
  const front = YAML.stringify(tokens, { lineWidth: 0, defaultStringType: "PLAIN", defaultKeyType: "PLAIN" })
    .replace(/^(\s*[\w-]+: )(#[0-9A-Fa-f]{3,8})$/gm, '$1"$2"');
  const names = [...ORDER.filter((n) => prose[n]), ...Object.keys(prose).filter((n) => !ORDER.includes(n) && prose[n])];
  const body = names.map((n) => `## ${n}\n\n${String(prose[n]).trim()}\n`).join("\n");
  const text = `---\n${front}---\n\n# ${tokens.name || "Brand"}\n\n${body}`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, FILE), text);
  return path.join(dir, FILE);
}

// what is wrong or missing in a kit: errors (✗) stop the frames, warnings (⚠) are worth a look
export function check(kit, dir) {
  const errors = [], warnings = [];
  const t = kit.tokens;
  if (!t.name) warnings.push("no name");
  if (!t.colors || !t.colors.primary) errors.push("colors.primary is missing");
  for (const [k, v] of Object.entries(t.colors || {})) {
    const value = resolve(t, v);
    if (!parse(String(value))) errors.push(`colors.${k}: ${JSON.stringify(v)} is no colour (use "#RRGGBB")`);
  }
  if (!t.typography || !Object.keys(t.typography).length) warnings.push("no typography: the frames fall back to system fonts");
  const b = normalize(kit, dir);
  for (const [k, f] of Object.entries(b.fonts)) {
    if (!f.family) continue;
    if (!b.fontSources[f.family] && !/^(sans-serif|serif|system-ui|monospace)$/.test(f.family)) warnings.push(`fonts: no source for "${f.family}" (${k}): add "${f.family}: google" or its files, else the frames use a system font`);
    for (const s of Array.isArray(b.fontSources[f.family]) ? b.fontSources[f.family] : []) if (!fs.existsSync(s.file)) errors.push(`fonts: ${path.relative(dir, s.file)} is missing`);
  }
  for (const [k, f] of Object.entries(b.logo)) if (f && !fs.existsSync(f)) errors.push(`logo.${k === "onDark" ? "on-dark" : k}: ${path.relative(dir, f)} is missing`);
  if (!b.logo.primary) warnings.push("no logo");
  const pairs = [["on-primary on primary", b.colors.onPrimary, b.colors.primary], ["on-surface on surface", b.colors.ink, b.colors.surface]];
  for (const [label, fg, bg] of pairs) {
    const c = contrast(fg, bg);
    if (c < 3) errors.push(`${label}: contrast ${c.toFixed(1)}:1, text would not read`);
    else if (c < 4.5) warnings.push(`${label}: contrast ${c.toFixed(1)}:1, fine for big type only`);
  }
  return { errors, warnings, brand: b };
}
