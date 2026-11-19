// Finding Chrome without one: the HyperFrames CLI it falls back to, and what it says when it gives
// none. A stand-in for the CLI, no Chrome, no network.
//
//   node --test tools/test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hyperframes, HYPERFRAMES_TESTED } from "./lib/chrome.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
// HyperFrames 0.9.70's words when the cache folder is group-writable (measured 2026-11-19)
const REFUSAL = "/home/x/.cache can be changed by another user account, so HyperFrames will not install or run code from it. If you own this directory, remove its group/other write permissions (chmod go-w). Otherwise set HYPERFRAMES_CACHE_DIR to a private directory whose parents are also private. An existing group-writable ~/.cache is refused; its permissions are never changed automatically.";

// a folder that holds only a stand-in `hyperframes`: it knows its version and refuses `browser path`
function standIn(say) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "page-shot-test-"));
  fs.writeFileSync(path.join(dir, "hyperframes"), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 0.9.70; exit 0; fi\necho '${say}' >&2\nexit 1\n`, { mode: 0o755 });
  return dir;
}

test("without a CLI on the PATH, the version this skill was tried with is fetched", () => {
  const before = process.env.PATH;
  process.env.PATH = fs.mkdtempSync(path.join(os.tmpdir(), "page-shot-test-"));
  try {
    assert.deepEqual(hyperframes(), ["npx", "--yes", `hyperframes@${HYPERFRAMES_TESTED}`]);
    assert.match(HYPERFRAMES_TESTED, /^\d+\.\d+\.\d+$/);
  } finally { process.env.PATH = before; }
});

test("when HyperFrames gives no Chrome, the error says what it said", { skip: process.platform === "win32" && "a shell script stands in for the CLI" }, () => {
  const dir = standIn(REFUSAL);
  try {
    const env = { ...process.env, PATH: dir };
    delete env.CHROME;
    const r = spawnSync(process.execPath, [path.join(here, "shot.mjs"), "https://example.com", path.join(dir, "out.png")], { encoding: "utf8", env });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^✗ No Chrome found, and HyperFrames gave none: .*set HYPERFRAMES_CACHE_DIR to a private directory.*\. Or set CHROME=\/path\/to\/chrome\.\n$/);
    assert.ok(!fs.existsSync(path.join(dir, "out.png")));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
