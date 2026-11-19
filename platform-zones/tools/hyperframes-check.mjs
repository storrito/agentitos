#!/usr/bin/env node
// HyperFrames' own check of a project, without HyperFrames' own safe zones: from 0.9.44 on its
// `check` warns (`outside_safe_zone`) about every text outside three boxes that are the platforms'
// AD templates (TikTok's In-Feed template, Meta's Reels ads 14/35/6 %, Google's vertical video ads
// 288/672/48/192 px), on every 9:16 project. This skill holds the collection's zones, for organic
// posts; its `layout` and launch-video's `check` test text against them. So this tool asks the
// CLI to leave its zones out where it knows how (`--safe-zone off`, read from `check --help`: an
// older CLI such as 0.8.221 refuses a flag it does not know), and drops such findings from the JSON
// whatever the version. Everything else the CLI says stays as it is.
//
//   node tools/hyperframes-check.mjs <project> [check's flags…]
//
// The CLI: HYPERFRAMES or RRAGENT_HYPERFRAMES (a path), else `hyperframes` on the PATH, else
// `npx --yes hyperframes@<TESTED>`. Always with --json. A `--safe-zone` you pass goes through as
// you gave it, and its findings stay. The exit code is the CLI's.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// the version this tool was tried with, when no CLI is installed (0.8.221 and 0.9.70 on 2026-11-19)
export const TESTED = "0.9.70";
export const CODE = "outside_safe_zone";
export const NOTE = "HyperFrames' own safe zones are left out: they are the platforms' ad templates. The zones for organic posts are platform-zones' (its `layout`, launch-video's `check`).";

function cli() {
  for (const p of [process.env.HYPERFRAMES, process.env.RRAGENT_HYPERFRAMES]) if (p && fs.existsSync(p)) return /\.[cm]?js$/.test(p) ? [process.execPath, p] : [p];
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) if (dir && fs.existsSync(path.join(dir, "hyperframes"))) return ["hyperframes"];
  return ["npx", "--yes", `hyperframes@${TESTED}`];
}

const env = () => ({ ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", HYPERFRAMES_SKIP_SKILLS: "1" });

// whether this CLI's check knows --safe-zone (and so its `off`)
export function knowsSafeZone(cmd) {
  const r = spawnSync(cmd[0], [...cmd.slice(1), "check", "--help"], { encoding: "utf8", env: env(), timeout: 120e3 });
  return /--safe-zone\b/.test(`${r.stdout || ""}${r.stderr || ""}`);
}

// the report without HyperFrames' zone findings, its counts made to match
export function withoutZones(report) {
  let dropped = 0;
  for (const section of Object.values(report)) {
    if (!section || typeof section !== "object" || !Array.isArray(section.findings)) continue;
    const kept = section.findings.filter((f) => f?.code !== CODE);
    const gone = section.findings.length - kept.length;
    if (!gone) continue;
    const warnings = section.findings.filter((f) => f?.code === CODE && f.severity === "warning").length;
    section.findings = kept;
    if (typeof section.warningCount === "number") section.warningCount = Math.max(0, section.warningCount - warnings);
    if (typeof section.totalIssueCount === "number") section.totalIssueCount = Math.max(0, section.totalIssueCount - gone);
    dropped += gone;
  }
  return { report, dropped };
}

function main(args) {
  if (!args.length || args[0].startsWith("-")) {
    console.error("Usage: node tools/hyperframes-check.mjs <project> [check's flags…]");
    process.exit(2);
  }
  const cmd = cli();
  const own = args.some((a) => a === "--safe-zone" || a.startsWith("--safe-zone="));
  const extra = [...(args.includes("--json") ? [] : ["--json"]), ...(!own && knowsSafeZone(cmd) ? ["--safe-zone", "off"] : [])];
  const r = spawnSync(cmd[0], [...cmd.slice(1), "check", ...args, ...extra], { encoding: "utf8", env: env(), maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "inherit"] });
  if (r.error) { console.error(`HyperFrames' check did not run: ${r.error.message}`); process.exit(1); }
  let report;
  try { report = JSON.parse(r.stdout); } catch { process.stdout.write(r.stdout || ""); process.exit(r.status ?? 1); }
  if (!own && report && typeof report === "object") {
    withoutZones(report);
    report.safeZones = NOTE;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(r.status ?? 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
