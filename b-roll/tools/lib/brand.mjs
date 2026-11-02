// The brand's colours and display font from its DESIGN.md (brand-kit), as the captions skill reads
// them: the primary colour, the darkest and lightest of its colours, and a font Google serves or
// one shipped as files beside the DESIGN.md.

import fs from "node:fs";
import path from "node:path";

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
  const colors = [...block("colors").matchAll(/^[ \t]+[\w-]+:\s*["']?(#[0-9a-fA-F]{6})\b/gm)].map((m) => m[1]);
  const light = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };
  const sorted = [...colors].sort((a, b) => light(a) - light(b));
  return { primary: value(block("colors"), "primary"), dark: sorted[0], light: sorted.at(-1), family, served, files };
}
