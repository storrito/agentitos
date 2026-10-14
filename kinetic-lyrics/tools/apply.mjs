#!/usr/bin/env node
// The "apply" action (actions.json): a page beside the short, the interview page, applies
// settings without the agent. pchat runs it in the workspace with the request on stdin,
//
//   {"artifact": "short-1", "input": {"settings": {"world": "noir", "aspect": "9:16",
//     "title": "…", "subtitle": "…", "names": "A=Anna,B=Ben", "colors": "A=#ff5a36",
//     "cta": "…", "handle": "@name"}}}
//
// builds artifacts/<artifact> with them (short.mjs build, which keeps them in
// source/settings.json) and checks it (short.mjs check). A video rendered before no longer
// matches and goes. "progress …" lines on stdout are the progress, the last line the result:
//   {"ok": true, "note": "Built, 0 errors, 12 warnings", "errors": 0, "warnings": 12}
//   {"ok": false, "error": "…"}
// Every field is checked here: the input comes from a page, not from the operator.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const WORLDS = ["cosmos", "aurora", "bokeh", "neon", "noir", "editorial", "geometry"];
const ASPECTS = ["9:16", "4:5", "1:1", "16:9"];

const done = (result) => { console.log(JSON.stringify(result)); process.exit(result.ok ? 0 : 1); };
const refuse = (error) => done({ ok: false, error });

const text = (v, max) => typeof v === "string" && v.length <= max && !/[\n\r\0]/.test(v);
// "A=Anna,B=Ben": a capital letter per voice, a name without "=" or ","
const names = (v) => v === "" || (text(v, 400) && v.split(",").every((kv) => /^[A-Z]=[^=,]{1,40}$/.test(kv.trim())));
const colors = (v) => v === "" || (text(v, 400) && v.split(",").every((kv) => /^[A-Z]=#[0-9a-fA-F]{3,8}$/.test(kv.trim())));
const CHECKS = {
  world: (v) => v === "auto" || WORLDS.includes(v),
  aspect: (v) => ASPECTS.includes(v),
  title: (v) => text(v, 120), subtitle: (v) => text(v, 120),
  names, colors,
  cta: (v) => text(v, 120), handle: (v) => v === "" || (text(v, 60) && /^@[\w.]+$/.test(v)),
};

let request;
try { request = JSON.parse(fs.readFileSync(0, "utf8")); } catch { refuse("The request is not JSON."); }
const artifact = request?.artifact;
if (typeof artifact !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(artifact)) refuse("No such short.");
const dir = path.join("artifacts", artifact);
if (!fs.existsSync(path.join(dir, "source", "transcript.json"))) refuse(`${artifact} is no kinetic short yet.`);

const settings = request?.input?.settings;
if (!settings || typeof settings !== "object") refuse("No settings to apply.");
const args = [];
for (const [k, v] of Object.entries(settings)) {
  if (!CHECKS[k]) refuse(`Unknown setting: ${k}.`);
  if (!CHECKS[k](v)) refuse(`Not a valid ${k}: ${JSON.stringify(v)}.`);
  // "auto": the world the short has stays (the agent chose it)
  if (k === "world" && v === "auto") continue;
  args.push(`--${k}`, v);
}

const short = (...a) => spawnSync(process.execPath, [path.join(TOOLS, "short.mjs"), ...a], { encoding: "utf8", maxBuffer: 16 << 20 });

console.log("progress building");
const built = short("build", dir, ...args);
process.stderr.write(built.stdout + built.stderr);
if (built.status !== 0) refuse((built.stdout + built.stderr).trim().split("\n").filter(Boolean).pop() || "The build failed.");

// the video rendered before shows the old settings
fs.rmSync(path.join("artifacts", `${artifact}.mp4`), { force: true });

console.log("progress checking");
const checked = short("check", dir);
process.stderr.write(checked.stdout + checked.stderr);
const m = /→ (\d+) errors?, (\d+) warnings?/.exec(checked.stdout + checked.stderr);
const errors = m ? Number(m[1]) : null, warnings = m ? Number(m[2]) : null;
// the check failing is no failure of the apply: the short is built, the agent can look
const why = (checked.stdout + checked.stderr).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("at ")).pop();
done({
  ok: true, errors, warnings,
  note: m ? `Built, ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`
    : `Built; the check did not run${why ? ": " + why.slice(0, 160) : ""}`,
});
