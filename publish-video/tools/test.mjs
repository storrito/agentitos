// check and prepare on a small made-up video: no model, no account, no Storrito.
//   node --test publish-video/tools/test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const tool = path.join(path.dirname(fileURLToPath(import.meta.url)), "publish.mjs");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-video-test-"));
const run = (cmd, args) => spawnSync(cmd, args, { cwd: dir, encoding: "utf8" });
const publish = (...args) => { const r = run("node", [tool, ...args]); return { status: r.status, said: `${r.stdout}${r.stderr}` }; };
const tags = (file) => {
  const j = JSON.parse(run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]).stdout);
  return [j.format.tags, ...j.streams.map((s) => s.tags)].flatMap((t) => Object.keys(t || {}));
};
// a made-up place, written the way a phone writes one
const PLACE = "+12.3456-012.3456/";

test.before(() => {
  const made = run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-c:a", "aac", "-shortest", "plain.mp4"]);
  assert.equal(made.status, 0, made.stderr);
  const placed = run("ffmpeg", ["-v", "error", "-y", "-i", "plain.mp4", "-c", "copy", "-metadata", `location=${PLACE}`, "-metadata", `location-eng=${PLACE}`, "phone.mp4"]);
  assert.equal(placed.status, 0, placed.stderr);
  assert.ok(tags(path.join(dir, "phone.mp4")).some((k) => /location/i.test(k)), "the made-up video should name a place");
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("a video without a place in its file is not held back for one", () => {
  const { said } = publish("check", "plain.mp4", "publish/plain", "--mode", "short");
  assert.doesNotMatch(said, /recorded at/);
});

test("a video that names the place it was recorded at is not ready, and the place is never printed", () => {
  const { status, said } = publish("check", "phone.mp4", "publish/phone", "--mode", "short");
  assert.match(said, /✗ the file names the place it was recorded at/);
  assert.match(said, /Not ready/);
  assert.equal(status, 1);
  assert.ok(!said.includes("12.3456"), "check printed the place");
  assert.ok(!fs.readFileSync(path.join(dir, "publish/phone/job.json"), "utf8").includes("12.3456"), "job.json holds the place");
});

test("prepare writes the video without the place, and the check after it is content", () => {
  const { said } = publish("prepare", "publish/phone");
  assert.match(said, /the place it was recorded at taken out/);
  assert.doesNotMatch(said.slice(said.indexOf("Checking it again")), /recorded at/);
  assert.deepEqual(tags(path.join(dir, "publish/phone/video.mp4")).filter((k) => /location|gps/i.test(k)), []);
});
