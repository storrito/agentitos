// The captions' band as agentitos' captions skill builds it, so that this skill need not know the
// measures of its styles, which live there and change there.
//
//   areaFile(file | "left,width,top,bottom,size,lines") → the band, from the area.json that
//       captions' `build` writes beside its captions: { left, width, top, bottom, size, lines } in
//       px of the frame, as tall as the style's lines can become (its line boxes; a shadow or an
//       outline below them reaches a few px further)
//   areaOfStyle(style, lines, [W, H], platforms) → the same, measured by running captions' `build`
//       on three placeholder words into a temporary folder (captions: CAPTIONS naming its
//       tools/captions.mjs, else beside this skill, else in the machine's clone)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const KEYS = ["left", "width", "top", "bottom", "size", "lines"];

function checked(a, what) {
  if (!a || KEYS.some((k) => typeof a[k] !== "number" || !Number.isFinite(a[k])) || !(a.bottom > a.top) || !(a.width > 0) || !(a.size > 0) || ![1, 2, 3].includes(a.lines)) throw new Error(`${what} is no caption area: it holds ${KEYS.join(", ")} in px of the frame (captions' area.json), as {"left":192,"width":696,"top":1238,"bottom":1440,"size":96,"lines":2}.`);
  return Object.fromEntries(KEYS.map((k) => [k, a[k]]));
}

export function areaFile(v) {
  if (/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){5}$/.test(String(v))) {
    const n = String(v).split(",").map(Number);
    return { ...checked(Object.fromEntries(KEYS.map((k, i) => [k, n[i]])), `--caption-area ${v}`), from: "the six values given" };
  }
  let j;
  try { j = JSON.parse(fs.readFileSync(v, "utf8")); } catch (e) { throw new Error(`--caption-area ${v} cannot be read (${e.code || e.message}): give the area.json captions' build wrote, or its six values as left,width,top,bottom,size,lines.`); }
  return { ...checked(j, `--caption-area ${v}`), from: `${path.basename(v)} (captions' area.json)` };
}

export function captionsTool() {
  const skill = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  return [process.env.CAPTIONS, path.join(skill, "..", "captions", "tools", "captions.mjs"), "/home/sprite/skills/captions/tools/captions.mjs"].find((p) => p && fs.existsSync(p)) || null;
}

export function areaOfStyle(style, lines, [W, H], platforms = []) {
  const tool = captionsTool();
  if (!tool) throw new Error("--caption-style needs agentitos' captions skill beside this one (or CAPTIONS naming its tools/captions.mjs); without it give --caption-area with the area.json of built captions.");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "layout-caption-area-"));
  try {
    const words = path.join(dir, "words.json");
    fs.writeFileSync(words, JSON.stringify({ words: [{ text: "plan", start: 0, end: 0.4 }, { text: "your", start: 0.4, end: 0.7 }, { text: "week", start: 0.7, end: 1.1 }] }));
    const r = spawnSync(process.execPath, [tool, "build", words, path.join(dir, "out"), "--style", style, "--size", `${W}x${H}`, "--duration", "2", ...(lines ? ["--lines", String(lines)] : []), ...(platforms.length ? ["--platform", platforms.join(",")] : [])], { encoding: "utf8", timeout: 60e3 });
    const file = path.join(dir, "out", "area.json");
    if (r.status !== 0 || !fs.existsSync(file)) throw new Error(`captions could not measure the style "${style}": ${(r.stderr || r.stdout || "").trim().split("\n").pop()} (its styles: node ${tool} styles).`);
    return { ...checked(JSON.parse(fs.readFileSync(file, "utf8")), `captions' area for ${style}`), from: `captions' style ${style}, ${lines || "its"} line${lines === 1 ? "" : "s"} (measured by its build)` };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
