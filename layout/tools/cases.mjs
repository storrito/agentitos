#!/usr/bin/env node
// The stored cases (layout/cases/, lib/cases.mjs): hard inputs as the callers hand them to
// place.mjs, each with what the commands wrote and printed for them.
//
//   node tools/cases.mjs list                     the cases, each with what it guards
//   node tools/cases.mjs check [case…]            the outputs now against the stored ones (what
//                                                 tools/test-cases.mjs does, as a list)
//   node tools/cases.mjs write [case…]            run the cases and store what they give now: for
//                                                 a change that is meant, and for a new case
//   node tools/cases.mjs against <commit> [case…] run the cases with this checkout's code and with
//                                                 another commit's (origin/main, a branch, a hash)
//                                                 and print what differs between the two
//   … --cases <folder>                            the cases of another folder in the same form (a
//                                                 rig's own, kept out of the repository)
//
// A new case: a folder in layout/cases with case.json ({ "guards", "from", "run" }) and its input
// files, then `write <name>`. Only numbers and times in it: no names, titles, words, paths.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CASES, TOOL, listCases, readCase, runCase, storedOf, writeStored, differences } from "./lib/cases.mjs";

const fail = (msg) => { console.error(msg); process.exit(1); };
const argv = process.argv.slice(2), at = argv.indexOf("--cases");
if (at >= 0 && !argv[at + 1]) fail("--cases takes a folder of cases, as ../rig/cases-layout.");
const ROOT = at >= 0 ? path.resolve(argv.splice(at, 2)[1]) : CASES;
if (!fs.existsSync(ROOT)) fail(`There is no folder ${ROOT}: --cases names a folder of case folders.`);
const [cmd, ...rest] = argv;
const pick = (names) => { try { return listCases(names, ROOT).map((n) => readCase(n, ROOT)); } catch (e) { fail(e.message); } };
const inParallel = async (items, fn, n = Math.max(1, Math.min(8, os.availableParallelism?.() || 4))) => {
  const out = new Array(items.length), queue = items.map((x, i) => [x, i]);
  await Promise.all(Array.from({ length: n }, async () => { for (let q; (q = queue.shift());) out[q[1]] = await fn(q[0]); }));
  return out;
};

if (cmd === "list") {
  for (const c of pick(rest)) console.log(`${c.name}  ${c.guards}`);
} else if (cmd === "check" || cmd === "write") {
  const cases = pick(rest);
  const runs = await inParallel(cases, (c) => runCase(c));
  let changed = 0;
  cases.forEach((c, i) => {
    const d = differences(storedOf(c), runs[i]);
    if (!d.length) return;
    changed++;
    if (cmd === "write") { writeStored(c, runs[i]); console.log(`${c.name}: stored anew`); }
    else console.log(`✗ ${c.name}\n${d.map((l) => "  " + l).join("\n")}`);
  });
  if (cmd === "write") console.log(`${cases.length} cases run, ${changed} stored anew; git diff ${path.relative(process.cwd(), ROOT) || "."} shows what changed.`);
  else { console.log(changed ? `${changed} of ${cases.length} cases changed: if that is meant, node tools/cases.mjs write, and the difference goes into the pull request.` : `All ${cases.length} cases give what is stored.`); process.exit(changed ? 1 : 0); }
} else if (cmd === "against") {
  const [ref, ...names] = rest;
  if (!ref) fail("against takes a commit: node tools/cases.mjs against origin/main [case…]");
  const top = spawnSync("git", ["-C", path.dirname(TOOL), "rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim();
  if (!top) fail(`${path.dirname(TOOL)} is not in a git checkout, so there is no other commit to run.`);
  const sha = spawnSync("git", ["-C", top, "rev-parse", "--verify", `${ref}^{commit}`], { encoding: "utf8" }).stdout.trim();
  if (!sha) fail(`git knows no commit ${ref} here: fetch it first (git fetch origin), or name another.`);
  const cases = pick(names);
  // the other commit's layout and platform-zones (place.mjs asks the zones beside it), unpacked
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "layout-against-"));
  try {
    const tar = spawnSync("git", ["-C", top, "archive", sha, "layout", "platform-zones"], { maxBuffer: 1 << 28 });
    if (tar.status) fail(`git archive ${ref} failed: ${String(tar.stderr).trim()}`);
    const x = spawnSync("tar", ["-x", "-C", tmp], { input: tar.stdout });
    if (x.status) fail(`The other commit's files could not be unpacked: ${String(x.stderr).trim()}`);
    const other = path.join(tmp, "layout", "tools", "place.mjs");
    if (!fs.existsSync(other)) fail(`${ref} has no layout/tools/place.mjs.`);
    const [mine, theirs] = await Promise.all([inParallel(cases, (c) => runCase(c)), inParallel(cases, (c) => runCase(c, other))]);
    let changed = 0;
    cases.forEach((c, i) => {
      const d = differences(theirs[i], mine[i]);
      if (!d.length) return;
      changed++;
      console.log(`${c.name} (${c.guards})\n${d.map((l) => "  " + l).join("\n")}`);
    });
    console.log(`${changed} of ${cases.length} cases differ between ${ref} (${sha.slice(0, 7)}, -) and this checkout (+).`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
} else {
  fail("cases.mjs takes list, check [case…], write [case…] or against <commit> [case…].");
}
