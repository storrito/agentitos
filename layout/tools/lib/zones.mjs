// What the platforms lay over a video, and the check of a laid-out frame: both from agentitos'
// platform-zones skill, run as a program: PLATFORM_ZONES, else beside this skill, else in the
// machine's clone of the skills. This skill keeps no zone of its own.
//
//   askZones(frame, platforms)   → { size, safe, centred, wide, covers, crops, platforms, … } in
//                                  px of the frame; frame is "9:16" or "1080x1920"; no platforms:
//                                  the usual ones of the frame together
//   checkPage(page, platforms)   → { ok, hard, soft, findings, boxes, size, platforms }: platform-
//                                  zones' `layout` on a page, which measures every text by its
//                                  letters in headless Chrome (found as platform-zones finds it);
//                                  the tool writes a copy beside the page, so its folder must be
//                                  the caller's
//   platformList(value)          → "reels,tiktok" (an option, also given several times) as a list
//   chromePath()                 → the Chrome platform-zones would take, for a picture of a page

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const NEEDS_ZONES = "The platforms' zones need agentitos' platform-zones skill beside this one (or PLATFORM_ZONES naming its tools/zones.mjs).";

export function zonesTool() {
  const skill = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const candidates = [process.env.PLATFORM_ZONES, path.join(skill, "..", "platform-zones", "tools", "zones.mjs"), "/home/sprite/skills/platform-zones/tools/zones.mjs"];
  const tool = candidates.find((p) => p && fs.existsSync(p));
  if (!tool) throw new Error(NEEDS_ZONES);
  return tool;
}

export const platformList = (v) => [v].flat().flatMap((s) => String(s ?? "").split(",")).map((s) => s.trim()).filter(Boolean);

const cache = new Map();
export function askZones(frame, platforms = []) {
  const key = `${frame}|${platforms.join(",")}`;
  if (cache.has(key)) return cache.get(key);
  const size = /^\d+x\d+$/.test(String(frame));
  const r = spawnSync(process.execPath, [zonesTool(), "zones", ...platforms, size ? "--size" : "--frame", String(frame), "--json"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`platform-zones gave no zones for ${frame}: ${(r.stderr || r.stdout || "").trim()}`);
  const z = JSON.parse(r.stdout);
  cache.set(key, z);
  return z;
}

export function checkPage(page, platforms = []) {
  if (!fs.existsSync(page)) throw new Error(`There is no ${page}.`);
  const r = spawnSync(process.execPath, [zonesTool(), "layout", page, ...platforms, "--json"], { encoding: "utf8", maxBuffer: 64 << 20 });
  let j;
  // without Chrome, or with a page it cannot open, platform-zones says what to do in one sentence
  try { j = JSON.parse(r.stdout); } catch { throw new Error((r.stderr || r.stdout || "").trim().split("\n").pop() || `platform-zones gave no result for ${page}.`); }
  const hard = j.findings.filter((f) => f.level === "✗"), soft = j.findings.filter((f) => f.level === "!");
  return { ok: !hard.length, hard, soft, findings: j.findings, boxes: j.boxes, size: j.size, platforms: j.platforms.map((p) => p.name) };
}

// The machine's Chrome, searched as platform-zones' zones.mjs does (a copy of its search, so that
// the picture of a page comes from the browser that measured it): CHROME, else the usual names on
// the PATH, else one puppeteer downloaded.
const CHROMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"];
export function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const dir of (process.env.PATH || "").split(path.delimiter)) for (const n of CHROMES) if (fs.existsSync(path.join(dir, n))) return path.join(dir, n);
  for (const kind of ["chrome-headless-shell", "chrome"]) {
    const base = path.join(os.homedir(), ".cache", "puppeteer", kind);
    for (const v of fs.existsSync(base) ? fs.readdirSync(base).sort().reverse() : []) {
      for (const p of [path.join(base, v, "chrome-headless-shell-linux64", "chrome-headless-shell"), path.join(base, v, "chrome-linux64", "chrome")]) if (fs.existsSync(p)) return p;
    }
  }
  return null;
}
