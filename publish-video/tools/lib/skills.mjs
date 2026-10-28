// The other agentitos skills this one runs as programs: platform-zones (what the apps cover of a
// vertical video) and video-descriptions (the texts and their check). Each is found through its
// environment variable, else beside this skill, else in the machine's clone of the skills.
//
//   tool("platform-zones")             → the path of its tool, or null
//   zones(width, height, platforms)    → platform-zones' answer for that frame: { safe, covers, … }
//   checkTexts(dir)                    → { ok, output } of video-descriptions' check of <dir>

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOLS = {
  "platform-zones": { env: "PLATFORM_ZONES", file: "tools/zones.mjs" },
  "video-descriptions": { env: "VIDEO_DESCRIPTIONS", file: "tools/descriptions.mjs" },
};

export function tool(skill) {
  const t = TOOLS[skill];
  const here = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const candidates = [process.env[t.env], path.join(here, "..", skill, t.file), `/home/sprite/skills/${skill}/${t.file}`];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

export const missing = (skill) => `This needs agentitos' ${skill} skill beside this one (or ${TOOLS[skill].env} naming its ${TOOLS[skill].file}).`;

export function zones(width, height, platforms = []) {
  const t = tool("platform-zones");
  if (!t) throw new Error(missing("platform-zones"));
  const r = spawnSync(process.execPath, [t, "zones", ...platforms, "--size", `${width}x${height}`, "--json"], { encoding: "utf8" });
  if (r.status) throw new Error(`platform-zones: ${(r.stderr || r.stdout).trim()}`);
  return JSON.parse(r.stdout);
}

export function checkTexts(dir) {
  const t = tool("video-descriptions");
  if (!t) throw new Error(missing("video-descriptions"));
  const r = spawnSync(process.execPath, [t, "check", dir], { encoding: "utf8" });
  return { ok: r.status === 0, output: `${r.stdout || ""}${r.stderr || ""}`.trim(), tool: t };
}
