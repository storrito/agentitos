// hyperframes-check.mjs with stand-in CLIs (no HyperFrames, no Chrome): one that knows
// --safe-zone as 0.9.70 does, one that refuses it as 0.8.221 does.  node --test tools/test-hyperframes-check.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { withoutZones, CODE } from "./hyperframes-check.mjs";

const tool = path.join(path.dirname(fileURLToPath(import.meta.url)), "hyperframes-check.mjs");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hf-check-"));

// a CLI that writes its arguments to <name>.args and answers as the real one does (the findings'
// shape as 0.9.70 gave them on a 9:16 project, 2026-11-19)
function standIn(name, knows) {
  const f = path.join(dir, `${name}.mjs`);
  fs.writeFileSync(f, `
import fs from "node:fs";
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(path.join(dir, `${name}.args`))}, JSON.stringify(args) + "\\n");
if (args.includes("--help")) { console.log("--caption-zone=<caption_zone>  Caption band" + (${knows} ? "\\n--safe-zone=<safe_zone>  Warn when text leaves a safe area" : "")); process.exit(0); }
const i = args.indexOf("--safe-zone");
if (i >= 0 && !${knows}) { console.error("Unknown flag: --safe-zone"); process.exit(1); }
if (args.includes("--plain")) { console.log("not json"); process.exit(3); }
const off = i >= 0 && args[i + 1] === "off";
const zone = { code: "${CODE}", severity: "warning", selector: "#caption", text: "Caption at 1300", message: "outside the safe area: YouTube Shorts (bottom edge)" };
const other = { code: "caption_zone_collision", severity: "error", selector: "#title", text: "Title" };
const findings = [other, ...(${knows} && !off ? [zone, { ...zone, selector: "#title" }] : [])];
const errors = 1, warnings = findings.length - 1;
console.log(JSON.stringify({ ok: true, layout: { ok: false, errorCount: errors, warningCount: warnings, infoCount: 0, findings, totalIssueCount: findings.length }, contrast: { findings: [] }, _meta: { version: "${knows ? "0.9.70" : "0.8.221"}" } }));
process.exit(${knows} ? 0 : 0);
`);
  return f;
}

function run(cli, ...args) {
  const r = spawnSync(process.execPath, [tool, "proj", ...args], { encoding: "utf8", env: { ...process.env, HYPERFRAMES: cli, RRAGENT_HYPERFRAMES: "" } });
  const calls = fs.readFileSync(cli.replace(/\.mjs$/, ".args"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  fs.rmSync(cli.replace(/\.mjs$/, ".args"));
  return { ...r, calls, check: calls.find((c) => c[0] === "check" && !c.includes("--help")) };
}

test("a CLI that knows --safe-zone (0.9.44 on) is asked to leave its zones out, and the JSON says why", () => {
  const r = run(standIn("new", true), "--caption-zone", "x0=0;y0=.8;x1=1;y1=1");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.check, ["check", "proj", "--caption-zone", "x0=0;y0=.8;x1=1;y1=1", "--json", "--safe-zone", "off"]);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.layout.findings.map((f) => f.code), ["caption_zone_collision"]);
  assert.match(j.safeZones, /platform-zones/);
});

test("a CLI that does not know it (0.8.221) gets no unknown flag, and its findings stay", () => {
  const r = run(standIn("old", false), "--json");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.check, ["check", "proj", "--json"]);
  assert.equal(JSON.parse(r.stdout).layout.findings.length, 1);
});

test("a --safe-zone the caller passes goes through as given, with its findings", () => {
  const r = run(standIn("own", true), "--safe-zone", "shorts");
  assert.deepEqual(r.check, ["check", "proj", "--safe-zone", "shorts", "--json"]);
  assert.equal(r.calls.filter((c) => c.includes("--help")).length, 0);
  const j = JSON.parse(r.stdout);
  assert.equal(j.layout.findings.filter((f) => f.code === CODE).length, 2);
  assert.equal(j.safeZones, undefined);
});

test("an answer that is no JSON passes through with the CLI's exit code", () => {
  const r = run(standIn("plain", true), "--plain");
  assert.equal(r.status, 3);
  assert.equal(r.stdout.trim(), "not json");
});

test("the zone findings leave every section, and the counts follow", () => {
  const z = (s) => ({ code: CODE, severity: s });
  const { report, dropped } = withoutZones({
    ok: true,
    layout: { warningCount: 3, errorCount: 1, totalIssueCount: 4, findings: [z("warning"), z("warning"), { code: "clipped_text", severity: "warning" }, { code: "canvas_overflow", severity: "error" }] },
    contrast: { findings: [{ code: "low_contrast", severity: "warning" }] },
    _meta: { version: "0.9.70" },
  });
  assert.equal(dropped, 2);
  assert.equal(report.layout.warningCount, 1);
  assert.equal(report.layout.errorCount, 1);
  assert.equal(report.layout.totalIssueCount, 2);
  assert.deepEqual(report.layout.findings.map((f) => f.code), ["clipped_text", "canvas_overflow"]);
  assert.equal(report.contrast.findings.length, 1);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
