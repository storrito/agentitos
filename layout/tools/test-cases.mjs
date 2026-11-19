// The stored cases (layout/cases/): every case is run through place.mjs again, and what it writes
// and prints must be what is stored in its out/. A difference fails its test with the lines that
// changed. A change that is meant: `node tools/cases.mjs write` stores the new outputs, and the
// difference is in the pull request for everyone to see. No Chrome, no ffmpeg, no request.
//
//   node --test tools/test-cases.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { CASES, HERE, listCases, readCase, runCase, storedOf, differences } from "./lib/cases.mjs";

// every case is run first, several at once (each is a few node processes), then judged one by one
const cases = listCases().map((n) => readCase(n)), runs = new Array(cases.length), queue = cases.map((c, i) => [c, i]);
await Promise.all(Array.from({ length: Math.max(2, Math.min(8, os.availableParallelism?.() || 4)) }, async () => { for (let q; (q = queue.shift());) runs[q[1]] = await runCase(q[0]); }));
test("there are stored cases", () => { if (!cases.length) throw new Error("layout/cases holds no case."); });
for (const [i, c] of cases.entries()) {
  test(`${c.name}: ${c.guards}`, () => {
    const d = differences(storedOf(c), runs[i]);
    if (d.length) throw new Error(`the outputs of case ${c.name} changed (- stored, + now); if that is meant, run node tools/cases.mjs write ${c.name}\n${d.join("\n")}`);
  });
}

test("cases.mjs --cases checks a folder of cases of one's own: a stored output as it is passes, a changed one fails with its lines", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "layout-own-cases-"));
  try {
    const name = cases[0].name, tool = path.join(HERE, "..", "cases.mjs");
    fs.cpSync(path.join(CASES, name), path.join(dir, name), { recursive: true });
    let r = spawnSync(process.execPath, [tool, "check", "--cases", dir], { encoding: "utf8" });
    if (r.status !== 0 || !/All 1 cases give what is stored/.test(r.stdout)) throw new Error(`check --cases: ${r.stdout}${r.stderr}`);
    fs.appendFileSync(path.join(dir, name, "out", "stdout.txt"), "a line that is not printed\n");
    r = spawnSync(process.execPath, [tool, "check", "--cases", dir], { encoding: "utf8" });
    if (r.status !== 1 || !/- a line that is not printed/.test(r.stdout)) throw new Error(`a changed output: ${r.stdout}${r.stderr}`);
    r = spawnSync(process.execPath, [tool, "list", "--cases", path.join(dir, "none")], { encoding: "utf8" });
    if (r.status !== 1 || !/There is no folder/.test(r.stderr)) throw new Error(`a folder that is not there: ${r.stderr}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
