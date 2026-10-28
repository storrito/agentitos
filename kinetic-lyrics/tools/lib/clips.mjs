// A tool of agentitos' clips skill, which finds the moments of a long video, cuts them and frames
// them on whoever speaks: CLIPS_TOOLS (its tools/ folder), else beside this skill, else in the
// machine's clone of the skills. This skill runs them as programs, never imports them.
//
//   runClips("episode.mjs", args)  → its exit code; its output goes through

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function clipsTools() {
  const skill = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const candidates = [process.env.CLIPS_TOOLS, path.join(skill, "..", "clips", "tools"), "/home/sprite/skills/clips/tools"];
  return candidates.find((p) => p && fs.existsSync(path.join(p, "episode.mjs"))) || null;
}

export function runClips(tool, args) {
  const dir = clipsTools();
  if (!dir) {
    console.log("This needs agentitos' clips skill beside this one (or CLIPS_TOOLS naming its tools/ folder).");
    return 1;
  }
  return spawnSync(process.execPath, [path.join(dir, tool), ...args], { stdio: "inherit" }).status ?? 1;
}
