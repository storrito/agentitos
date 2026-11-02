// A web page or a post as a picture, from agentitos' page-shot skill, which keeps the one page
// capture: PAGE_SHOT, else beside this skill, else in the machine's clone of the skills. This
// skill keeps no capture of its own.
//
//   pageShotTool()   → its tools/shot.mjs, or null
//   NEEDS_PAGE_SHOT  → the sentence for when it is missing

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const NEEDS_PAGE_SHOT = "Pictures of pages and posts need agentitos' page-shot skill beside this one (or PAGE_SHOT naming its tools/shot.mjs).";

export function pageShotTool() {
  const skill = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const candidates = [process.env.PAGE_SHOT, path.join(skill, "..", "page-shot", "tools", "shot.mjs"), "/home/sprite/skills/page-shot/tools/shot.mjs"];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}
