// The stored cases (layout/cases/<name>/): hard inputs as the callers hand them over, each with
// what place.mjs wrote and printed for them. A case folder holds case.json, its input files and
// out/ with the stored outputs:
//
//   case.json  { "guards": "one line: what the case keeps from changing unseen",
//                "from": "where the input came from, in words",
//                "run": [["text", "--frame", "1080x1920", "--shots", "shots.json", "--text", "caption"], …] }
//
// Every step of "run" is place.mjs's command and its arguments without the folder: the folder is
// put in after the command, the same one for all steps (so captions reads the placement that
// place wrote before it). Input files are named as they lie beside case.json. A run happens in a
// temporary folder with copies of the inputs, the outputs go into its out/; out/ of the case
// holds every JSON file written there and stdout.txt, the printed lines of every step, each
// after a line "$ place.mjs <command> …". Nothing in a case may name a person, a title, a word
// of a transcript, a file of this machine or a video: only numbers and times.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CASES = path.resolve(HERE, "..", "..", "cases");
export const TOOL = path.resolve(HERE, "..", "place.mjs");

// (root: another folder of cases in the same form, as a rig's own that may not be published)
export function listCases(only = [], root = CASES) {
  const all = fs.existsSync(root) ? fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, "case.json"))).sort() : [];
  for (const n of only) if (!all.includes(n)) throw new Error(`There is no case ${n} in ${root}.`);
  return only.length ? all.filter((n) => only.includes(n)) : all;
}

export function readCase(name, root = CASES) {
  const dir = path.join(root, name);
  const c = JSON.parse(fs.readFileSync(path.join(dir, "case.json"), "utf8"));
  if (typeof c.guards !== "string" || !Array.isArray(c.run) || !c.run.length || !c.run.every((s) => Array.isArray(s) && s.length && s.every((a) => typeof a === "string")))
    throw new Error(`${name}/case.json needs "guards" (a sentence) and "run" (a list of steps, each a list of strings beginning with the command).`);
  const inputs = fs.readdirSync(dir).filter((f) => f !== "case.json" && f !== "out" && f !== "README.md" && fs.statSync(path.join(dir, f)).isFile());
  return { name, dir, ...c, inputs };
}

const spawnP = (argv, cwd) => new Promise((done) => {
  const child = spawn(process.execPath, argv, { cwd, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
  const out = [], err = [];
  child.stdout.on("data", (d) => out.push(d));
  child.stderr.on("data", (d) => err.push(d));
  child.on("close", (code) => done({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }));
});

// one case through a place.mjs (this one, or another commit's): { files: { name: text }, }
// where the texts are as they would be stored, the temporary folder and the tool's path written
// as words so that a run anywhere gives the same text
export async function runCase(c, tool = TOOL) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "layout-case-"));
  try {
    for (const f of c.inputs) fs.copyFileSync(path.join(c.dir, f), path.join(tmp, f));
    const printed = [];
    for (const [cmd, ...rest] of c.run) {
      const r = await spawnP([tool, cmd, "out", ...rest], tmp);
      printed.push(`$ place.mjs ${[cmd, "out", ...rest].join(" ")}`, ...(r.stdout + r.stderr).replace(/\n$/, "").split("\n"));
      if (r.code) printed.push(`(exit ${r.code})`);
    }
    const clean = (s) => s.split(fs.realpathSync(tmp)).join("<tmp>").split(tmp).join("<tmp>").split(tool).join("place.mjs").split(path.dirname(tool)).join("<layout>/tools");
    const files = { "stdout.txt": clean(printed.join("\n")) + "\n" };
    const outDir = path.join(tmp, "out");
    if (fs.existsSync(outDir)) for (const f of fs.readdirSync(outDir).filter((f) => f.endsWith(".json")).sort()) files[f] = clean(fs.readFileSync(path.join(outDir, f), "utf8")).replace(/\n?$/, "\n");
    return files;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

export function storedOf(c) {
  const out = path.join(c.dir, "out"), files = {};
  if (fs.existsSync(out)) for (const f of fs.readdirSync(out).sort()) files[f] = fs.readFileSync(path.join(out, f), "utf8");
  return files;
}

export function writeStored(c, files) {
  const out = path.join(c.dir, "out");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(out, f), text);
}

// what differs between two sets of outputs, as lines a person reads: each file that is new, gone
// or changed, and of a changed one the lines around each change (- before, + after)
export function differences(before, after, { context = 2, most = 40 } = {}) {
  const lines = [];
  for (const f of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (!(f in after)) { lines.push(`${f}: no longer written`); continue; }
    if (!(f in before)) { lines.push(`${f}: written now, not before`); continue; }
    if (before[f] === after[f]) continue;
    lines.push(`${f}:`);
    const a = before[f].split("\n"), b = after[f].split("\n");
    // a plain line diff (longest common subsequence); the files are small
    const n = a.length, m = b.length, L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const ops = [];
    for (let i = 0, j = 0; i < n || j < m;) {
      if (i < n && j < m && a[i] === b[j]) { ops.push([" ", a[i], i]); i++; j++; }
      else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) { ops.push(["-", a[i], i]); i++; }
      else { ops.push(["+", b[j], i]); j++; }
    }
    const show = new Set();
    ops.forEach((o, k) => { if (o[0] !== " ") for (let d = -context; d <= context; d++) show.add(k + d); });
    let last = -2, shown = 0;
    for (let k = 0; k < ops.length; k++) {
      if (!show.has(k)) continue;
      if (k !== last + 1) lines.push(`  @ line ${ops[k][2] + 1}`);
      if (shown++ >= most) { lines.push("  … (more)"); break; }
      lines.push(`  ${ops[k][0]} ${ops[k][1]}`);
      last = k;
    }
  }
  return lines;
}
