#!/usr/bin/env node
// Every skill's tests, found by their names: each file <skill>/tools/test*.mjs runs from its
// skill's folder, with Node's test runner where it imports node:test, else as a script whose exit
// code says whether it passed (layout's). At the end one line per file (passed, failed, skipped,
// seconds) and the lines of every test that failed. On GitHub the same goes into the run's
// summary, and each failing line is an error on its file.
//
//   node .github/run-tests.mjs                  every skill's tests
//   node .github/run-tests.mjs layout captions  only these skills'
//   node .github/run-tests.mjs --except layout  every skill's but these
//   node .github/run-tests.mjs --jobs 4         four files at once (default: one at a time)
//   node .github/run-tests.mjs --install        first `npm ci` in every skill with tests and a
//                                               package-lock.json (what GitHub runs); without it
//                                               such a skill's tests skip or fail on what is missing
//
// No test may need a model, a key or the network (the repo's rule). On GitHub the layout skill's
// tests find Chrome through CHROME (lib/zones.mjs), the others need ffmpeg on the PATH.

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const except = [];
for (let v; (v = flag("--except")) !== null;) except.push(...v.split(","));
const jobs = Number(flag("--jobs") || 1);
const minutes = Number(flag("--minutes") || 15);
const install = args.includes("--install");
if (install) args.splice(args.indexOf("--install"), 1);
if (!(jobs >= 1) || !(minutes > 0)) { console.error("--jobs takes a whole number of at least 1 and --minutes a number above 0."); process.exit(2); }
const only = args.filter((a) => !a.startsWith("--"));
const unknown = args.find((a) => a.startsWith("--"));
if (unknown) { console.error(`${unknown} is no option here: name skills, or --except <skill>, --jobs <n>, --minutes <n>, --install.`); process.exit(2); }

const skills = fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name).sort();
for (const s of [...only, ...except]) if (!skills.includes(s)) { console.error(`There is no skill ${s} in ${ROOT}.`); process.exit(2); }
const files = [];
for (const skill of skills) {
  if (only.length && !only.includes(skill)) continue;
  if (except.includes(skill)) continue;
  const dir = path.join(ROOT, skill, "tools");
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((f) => /^test.*\.mjs$/.test(f)).sort()) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    files.push({ skill, file: `tools/${f}`, nodeTest: /from\s+["']node:test["']/.test(src) });
  }
}
if (!files.length) { console.error("No test files found (<skill>/tools/test*.mjs)."); process.exit(2); }

const GH = !!process.env.GITHUB_ACTIONS;
if (install) for (const skill of [...new Set(files.map((f) => f.skill))].filter((s) => fs.existsSync(path.join(ROOT, s, "package-lock.json")))) {
  const t0 = Date.now();
  const r = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel", "error"], { cwd: path.join(ROOT, skill), encoding: "utf8" });
  if (r.status !== 0) { console.error(`npm ci in ${skill} failed:\n${(r.stdout || "") + (r.stderr || "") || r.error?.message}`); process.exit(1); }
  console.log(`npm ci in ${skill}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
function run(f) {
  return new Promise((done) => {
    const argv = f.nodeTest ? ["--test", "--test-reporter=spec", f.file] : [f.file];
    const t0 = Date.now(), out = [];
    const child = spawn(process.execPath, argv, { cwd: path.join(ROOT, f.skill), env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
    const timer = setTimeout(() => { out.push(Buffer.from(`\n(the file ran longer than ${minutes} minutes and was stopped)\n`)); child.kill("SIGKILL"); }, minutes * 60e3);
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => out.push(d));
    child.on("close", (code) => { clearTimeout(timer); done({ ...f, code, seconds: (Date.now() - t0) / 1000, text: Buffer.concat(out).toString("utf8") }); });
  });
}

// the counts and the failing lines, from Node's spec reporter or from layout's own lines
function read(r) {
  const lines = r.text.split("\n");
  const n = (re) => { const m = r.text.match(re); return m ? Number(m[1]) : null; };
  let pass = n(/^ℹ pass (\d+)/m), fail = n(/^ℹ fail (\d+)/m), skip = n(/^ℹ skipped (\d+)/m);
  const own = r.text.match(/^(\d+) passed, (\d+) failed/m);
  if (own) { pass = Number(own[1]); fail = Number(own[2]); }
  let failing = [];
  const tail = lines.findIndex((l) => /^✖ failing tests:/.test(l));
  if (tail >= 0) failing = lines.slice(tail + 1).filter((l) => l.trim() && !/^\s+at /.test(l) && !/^\s*(\{|\}|code:|actual:|expected:|operator:|generatedMessage:)/.test(l));
  else for (let i = 0; i < lines.length; i++) {
    if (!/^\s*✗ /.test(lines[i])) continue;
    failing.push(lines[i]);
    for (let j = i + 1; j < lines.length && /^ {6}/.test(lines[j]); j++) failing.push(lines[j]);
  }
  if (r.code !== 0 && !failing.length) failing = lines.filter((l) => l.trim()).slice(-15);
  // a file that fails before its tests run (a missing package, a syntax error): its error's line
  const crash = lines.find((l) => /^(\w*Error\b|Error \[)/.test(l));
  if (r.code !== 0 && crash && !failing.includes(crash)) failing.unshift(crash);
  // a file that runs no test at all passes nothing: a test renamed away, a filter that matches
  // none (tests that are skipped on purpose, where a package is missing, still count)
  // (Node's runner counts a file without a test as one test, named after the file itself)
  const esc = r.file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tests = r.nodeTest ? (n(/^ℹ tests (\d+)/m) === 1 && new RegExp(`^✔ ${esc} \\(`, "m").test(r.text) ? 0 : n(/^ℹ tests (\d+)/m)) : own ? pass + fail : null;
  if (r.code === 0 && tests === 0) return { ...r, pass, fail, skip, failing: ["The file reports no test at all (0 tests found): a file named test*.mjs must run at least one."], ok: false };
  return { ...r, pass, fail, skip, failing: failing.slice(0, 40), ok: r.code === 0 };
}

const results = [];
const queue = [...files];
console.log(`${files.length} test files of ${new Set(files.map((f) => f.skill)).size} skills, ${jobs} at a time.`);
await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, async () => {
  for (let f; (f = queue.shift());) {
    const r = read(await run(f));
    results.push(r);
    const name = `${r.skill}/${r.file}`;
    if (GH) console.log(`::group::${r.ok ? "✓" : "✗"} ${name} (${r.seconds.toFixed(1)} s)`);
    else console.log(`\n── ${name} ${"─".repeat(Math.max(0, 60 - name.length))}`);
    process.stdout.write(r.text.endsWith("\n") ? r.text : r.text + "\n");
    if (GH) console.log("::endgroup::");
  }
}));

results.sort((a, b) => files.indexOf(files.find((f) => f.skill === a.skill && f.file === a.file)) - files.indexOf(files.find((f) => f.skill === b.skill && f.file === b.file)));
const count = (v) => (v === null ? "" : String(v));
const rows = results.map((r) => [r.ok ? "✓" : "✗", `${r.skill}/${r.file}`, count(r.pass), count(r.fail), count(r.skip), r.seconds.toFixed(1)]);
const head = ["", "file", "passed", "failed", "skipped", "s"];
const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
console.log("\n" + [head, ...rows].map((r) => r.map((c, i) => (i > 1 ? c.padStart(width[i]) : c.padEnd(width[i]))).join("  ")).join("\n"));
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log(`\n✗ ${r.skill}/${r.file} failed (exit ${r.code}):\n${r.failing.map((l) => "  " + l).join("\n")}`);
console.log(bad.length ? `\n${bad.length} of ${results.length} test files failed: ${bad.map((r) => `${r.skill}/${r.file}`).join(", ")}.` : `\nAll ${results.length} test files passed.`);

if (GH) {
  const esc = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  for (const r of bad) console.log(`::error file=${r.skill}/${r.file},title=${r.skill} tests failed::${esc(r.failing.join("\n"))}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [`| | file | passed | failed | skipped | s |`, `|---|---|--:|--:|--:|--:|`, ...rows.map((r) => `| ${r.join(" | ")} |`)];
    for (const r of bad) md.push("", `### ✗ ${r.skill}/${r.file}`, "", "```", ...r.failing, "```");
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join("\n") + "\n");
  }
}
process.exit(bad.length ? 1 : 0);
