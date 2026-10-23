// What the platforms lay over a video (their buttons, names and captions), from agentitos'
// platform-zones skill, which keeps the one table of it: PLATFORM_ZONES, else beside this skill,
// else in the machine's clone of the skills. This skill keeps no numbers of its own.
//
//   zones(width, height, platforms)  → { safe: [x, y, w, h], wide, covers, crops, platforms,
//                                        fallback, … } in px of the frame; no platforms: the usual
//                                        ones of the frame together
//   platformList(value)              → "reels,tiktok" (an option) as ["reels", "tiktok"]

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function zonesTool() {
  const skill = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const candidates = [process.env.PLATFORM_ZONES, path.join(skill, "..", "platform-zones", "tools", "zones.mjs"), "/home/sprite/skills/platform-zones/tools/zones.mjs"];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

export const platformList = (v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : Array.isArray(v) ? v : []);

const cache = new Map();
export function zones(width, height, platforms = []) {
  const key = `${width}x${height}:${platforms.join(",")}`;
  if (cache.has(key)) return cache.get(key);
  const tool = zonesTool();
  if (!tool) throw new Error("The platforms' zones need agentitos' platform-zones skill beside this one (or PLATFORM_ZONES naming its tools/zones.mjs).");
  const r = spawnSync(process.execPath, [tool, "zones", ...platforms, "--size", `${width}x${height}`, "--json"], { encoding: "utf8" });
  if (r.status) throw new Error(`platform-zones: ${(r.stderr || r.stdout).trim()}`);
  const z = JSON.parse(r.stdout);
  cache.set(key, z);
  return z;
}
