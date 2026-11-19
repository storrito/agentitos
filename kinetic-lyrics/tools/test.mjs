// Where the type goes over footage with people (short.mjs place), on made-up footage and made-up
// faces: the band's geometry, the footage's push-in drawn through a face, the build with a top for
// the type, and the place step with agentitos' layout as a program and a stand-in for clips (its
// shots and its framing given, not computed). No model, no network.
//
//   node --test tools/test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { topOfShade, usualTop, chipRoom, scaleAt, pushed, liftsFor, placeArgs, layoutTool, PUSH, PUNCH } from "./lib/place.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const near = (x, y, by, what = "") => assert.ok(Math.abs(x - y) <= by, `${what} ${x} is not within ${by} of ${y}`);
const W = 1080, H = 1920;
const planOf = (o = {}) => ({ width: W, height: H, portrait: true, preset: "podcast", duration: 10, phrases: [], turns: [{ t: 0, speaker: "A" }], video: { shade: [0.468, 0.588] }, ...o });

test("the band: the type's top stands 0.55 of the way down its ramp, as engine/type.js sets it; a build placed by the faces keeps the band of the footage alone as the usual top", () => {
  near(topOfShade([0.468, 0.588]), 0.534, 1e-9, "top");
  assert.equal(usualTop(planOf()), Math.round(0.534 * H));
  assert.equal(usualTop(planOf({ video: { shade: [0.55, 0.67], shadeFound: [0.468, 0.588] } })), Math.round(0.534 * H), "shadeFound is the usual");
});

test("the name tag: room above the type only where it shows (named speakers, footage, an upright frame, a dark world)", () => {
  assert.equal(chipRoom(planOf()), Math.ceil(0.006 * H + 1.5 * Math.round(W * 0.034)));
  assert.equal(chipRoom(planOf({ turns: [] })), 0, "no names, no tag");
  assert.equal(chipRoom(planOf({ video: { shade: [0.4, 0.5], frame: [0.07, 0.12, 0.93, 0.48] } })), 0, "a light world's frame");
  assert.equal(chipRoom(planOf({ preset: "social" })), 0, "the social preset has no tag");
});

test("the push-in: a face is drawn as the short shows it, larger and away from the point at 50 % across and 28 % down, by 6 % at the end and 2.5 % more under a hero phrase; each moment says how much the picture has grown there (a lift before the push-in grows with it)", () => {
  const plan = planOf({ phrases: [{ layout: "hero", tIn: 4 }] });
  near(scaleAt(0, plan), 1, 1e-9, "start");
  near(scaleAt(10, plan), 1 + PUSH, 1e-9, "end");
  near(scaleAt(4.5, plan), (1 + PUSH * 0.45) * PUNCH, 1e-9, "under a hero");
  near(scaleAt(6, plan), 1 + PUSH * 0.6, 1e-9, "after the punch");
  const box = [340, 300, 400, 600], feat = [400, 500, 280, 300];
  const out = pushed({ shots: [{ start: 0, end: 10, faces: [{ who: "A", track: [{ t: 0, box, feat, eye: 560 }, { t: 10, box, feat, eye: 560 }] }] }] }, plan).shots[0].faces[0].track;
  assert.deepEqual(out[0].box, box, "unchanged at 0 s");
  const k = 1 + PUSH, oy = 0.28 * H;
  near(out[1].box[1], oy + (box[1] - oy) * k, 0.1, "top");
  near(out[1].box[3], box[3] * k, 0.1, "height");
  near(out[1].feat[1] + out[1].feat[3], oy + (feat[1] + feat[3] - oy) * k, 0.1, "the mouth's bottom moves down");
  near(out[1].eye, oy + (560 - oy) * k, 0.1, "the eyes' own line with it");
  // the framing raises the picture before it grows: layout is told how a lift shows at each moment
  assert.deepEqual([out[0].zoom, out[1].zoom], [1, +k.toFixed(4)], "each moment's zoom");
});

test("what layout is asked: one area for the type and the name tag above it, never higher than the build sets it, layout's least for the type alone; a fixed top is the type's, given as the area's", () => {
  const plan = planOf(), chip = chipRoom(plan);
  const a = placeArgs(plan, { folder: "f", shots: "s.json", raise: "full", top: 1200, lifts: [{ shot: 1, px: 90 }], platforms: ["reels"] });
  const at = (k) => a[a.indexOf(k) + 1];
  assert.equal(at("--text"), "area");
  assert.equal(Number(at("--area-top")), usualTop(plan) - chip);
  assert.equal(at("--set"), `area.least=${+(0.15 + chip / H).toFixed(4)}`);
  assert.equal(Number(at("--top")), 1200 - chip);
  assert.equal(at("--lift"), "2:90");
  assert.equal(at("--raise"), "full");
  assert.equal(at("--platform"), "reels");
  assert.ok(!placeArgs(planOf({ turns: [] }), { folder: "f", shots: "s", raise: "mouth" }).includes("--set"), "no tag: layout's own least");
  const text = { shots: [{ shot: 0, lift: 0 }, { shot: 1, lift: 120 }] };
  assert.deepEqual(liftsFor(text, [{ start: 0, end: 4 }, { start: 4, end: 10 }]), [{ t: 7, px: 120 }], "a lift at the middle of its shot");
});

// ------------------------------------------------------------------------------ the build and place
// A short folder made by hand: a grey upright video of 4 s with a tone (no face for anyone to find,
// no text burned in), its words, and a framing that clips' frame.mjs would have written beside it.
const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const built = fs.existsSync(path.join(HERE, "..", "node_modules", "esbuild"));
const layout = layoutTool();
const skip = !ffmpeg ? "needs ffmpeg" : !built ? "needs npm install in the skill" : !layout ? "needs agentitos' layout beside this skill" : false;

function shortDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinetic-place-"));
  const src = path.join(dir, "source");
  fs.mkdirSync(src, { recursive: true });
  spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=1080x1920:d=4:r=25", "-f", "lavfi", "-i", "sine=frequency=220:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(src, "video.mp4")]);
  spawnSync("ffmpeg", ["-v", "error", "-y", "-i", path.join(src, "video.mp4"), "-vn", "-ac", "1", "-ar", "48000", path.join(src, "audio.wav")]);
  const words = ["kinetic", "type", "keeps", "off", "the", "mouth", "of", "a", "close", "up"].map((text, i) => ({ text, start: 0.2 + i * 0.35, end: 0.5 + i * 0.35, speaker: "A" }));
  fs.writeFileSync(path.join(src, "transcript.json"), JSON.stringify({ edges: "sound", words }));
  fs.writeFileSync(path.join(src, "settings.json"), JSON.stringify({ aspect: "9:16", names: "A=Anna", world: "slate" }));
  return dir;
}

// clips as it stands beside the skill, but its shots given (CLIPS_SHOTS) and its framing a copy
// that writes the lifts asked for into the framing's json
function fakeClips(shots) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinetic-clips-"));
  fs.writeFileSync(path.join(dir, "episode.mjs"), "");
  fs.writeFileSync(path.join(dir, "clips.mjs"), `import fs from "node:fs";
const [cmd, , out] = process.argv.slice(2);
if (cmd !== "shots") process.exit(1);
fs.writeFileSync(out, JSON.stringify(${JSON.stringify({ size: [W, H], shots })}));`);
  fs.writeFileSync(path.join(dir, "frame.mjs"), `import fs from "node:fs";
const a = process.argv.slice(2), out = a[a.indexOf("--out") + 1], lifts = a.includes("--lift") ? a[a.indexOf("--lift") + 1].split(",").map((v) => v.split(":").map(Number)) : [];
fs.copyFileSync(a[0], out);
fs.writeFileSync(out.replace(/\\.mp4$/, ".json"), JSON.stringify({ aspect: [9, 16], size: [1080, 1920], windows: ${JSON.stringify(shots.map((s, k) => ({ shot: k, start: s.start, end: s.end })))}.map((w) => { const l = lifts.find(([t]) => t >= w.start && t < w.end); return l ? { ...w, lift: { px: l[1] } } : w; }) }));`);
  return dir;
}
const run = (env, ...args) => spawnSync(process.execPath, [path.join(HERE, "short.mjs"), ...args], { encoding: "utf8", env: { ...process.env, ...env } });
const still = (box, feat, a, b) => ({ who: "Anna", track: Array.from({ length: Math.round((b - a) * 10) + 1 }, (_, i) => ({ t: +(a + i / 10).toFixed(2), box, feat })) });
const files = (dir) => fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort();
const sameTree = (a, b) => files(a).length === files(b).length && files(a).every((f, i) => f === files(b)[i] && fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))));

test("a close-up whose mouth lies where the build sets the type: place lowers the type and raises the shot, says what is left, and the build's band follows; place again keeps the framing", { skip }, () => {
  const dir = shortDir();
  // the face from 14 % to 75 % of the height, its mouth (with an open mouth's room) down to 62 %: below the smallest area's top
  const clips = fakeClips([{ n: 1, start: 0, end: 4, weight: 4, kind: "people", picture: [0, 0, W, H], faces: [still([200, 260, 680, 1190], [330, 700, 420, 420], 0, 4)], room: { free: 0 } }]);
  fs.copyFileSync(path.join(dir, "source", "video.mp4"), path.join(dir, "source", "framed-9x16.mp4"));
  fs.writeFileSync(path.join(dir, "source", "framed-9x16.json"), JSON.stringify({ aspect: [9, 16], size: [W, H], windows: [{ shot: 0, start: 0, end: 4 }] }));
  const env = { CLIPS_TOOLS: clips };
  let r = run(env, "build", dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const before = JSON.parse(fs.readFileSync(path.join(dir, "composition", "plan.json"), "utf8"));
  assert.ok(!before.video.shadeFound && !before.video.typeTop, "a build without place has the band of the footage alone");
  r = run(env, "place", dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const p = JSON.parse(fs.readFileSync(path.join(dir, "source", "place.json"), "utf8"));
  const plan = JSON.parse(fs.readFileSync(path.join(dir, "composition", "plan.json"), "utf8"));
  assert.ok(p.top > topOfShade(before.video.shade), `the type lower than the build set it: ${p.top}`);
  near(topOfShade(plan.video.shade), p.top, 1e-3, "the build's band: the type's top");
  assert.deepEqual(plan.video.shadeFound, before.video.shade, "the footage's own band kept");
  assert.equal(p.raise, "full");
  assert.ok(p.lifts.length === 1 && p.lifts[0].px > 0, JSON.stringify(p.lifts));
  const framed = JSON.parse(fs.readFileSync(path.join(dir, "source", "framed-9x16.json"), "utf8"));
  assert.equal(framed.windows[0].lift?.px, p.lifts[0].px, "the framing was asked for the lift");
  assert.match(r.stdout, /The type: one place for the short, from y \d+ to 1440/);
  assert.match(r.stdout, /shot 1 .* raised \d+ px/);
  assert.match(r.stdout, /Other tops it weighed \(cost [\d.]+ for the one taken\): y \d+, the type \d+ % of its usual size, (shot 1 raised \d+ px|nothing raised)/);
  const mtime = fs.statSync(path.join(dir, "source", "framed-9x16.json")).mtimeMs;
  r = run(env, "place", dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.statSync(path.join(dir, "source", "framed-9x16.json")).mtimeMs, mtime, "the same lift: no framing again");
  // the agent's own choice, kept, and given back with ""
  assert.match(run(env, "place", dir, "--type-top", "1300").stdout, /--type-top 1300 leaves the type no room: give a y from \d+ to 1152/);
  r = run(env, "place", dir, "--type-top", "1140", "--raise", "head");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const q = JSON.parse(fs.readFileSync(path.join(dir, "source", "place.json"), "utf8"));
  near(q.top * H, 1140, 1, "the type from the top given");
  assert.deepEqual([q.fixed.top, q.raise], [1140, "head"]);
  r = run(env, "place", dir, "--type-top", "", "--raise", "");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "source", "place.json"), "utf8")).fixed, {});
  assert.equal(run(env, "build", dir, "--raise", "full").status, 1, "--raise belongs to place");
});

test("footage without a face, and a face far above the type: place changes nothing, the build is the one without place, byte for byte", { skip }, () => {
  for (const faces of [[], [still([390, 250, 300, 380], [450, 390, 180, 180], 0, 4)]]) {
    const dir = shortDir();
    const clips = fakeClips([{ n: 1, start: 0, end: 4, weight: 4, kind: "people", picture: [0, 0, W, H], faces, room: { free: 0 } }]);
    fs.copyFileSync(path.join(dir, "source", "video.mp4"), path.join(dir, "source", "framed-9x16.mp4"));
    fs.writeFileSync(path.join(dir, "source", "framed-9x16.json"), JSON.stringify({ aspect: [9, 16], size: [W, H], windows: [{ shot: 0, start: 0, end: 4 }] }));
    const env = { CLIPS_TOOLS: clips };
    assert.equal(run(env, "build", dir).status, 0);
    const copy = path.join(dir, "before");
    fs.cpSync(path.join(dir, "composition"), copy, { recursive: true });
    const r = run(env, "place", dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "source", "place.json"), "utf8")).top, null);
    assert.match(r.stdout, /where the footage alone sets it/);
    assert.equal(run(env, "build", dir).status, 0);
    assert.ok(sameTree(copy, path.join(dir, "composition")), `${faces.length ? "a face above the type" : "no face"}: the build differs from the one without place`);
  }
});

test("footage of the frame's shape (no framing) and a short without footage: place says why it has nothing to place", { skip }, () => {
  const dir = shortDir();
  const env = { CLIPS_TOOLS: fakeClips([]) };
  // the framing is what frame.mjs leaves for footage of the frame's shape: none
  fs.copyFileSync(path.join(dir, "source", "video.mp4"), path.join(dir, "source", "framed-9x16.mp4"));
  assert.equal(run(env, "build", dir).status, 0);
  const r = run(env, "place", dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /No framing, so no faces are known/);
  assert.ok(!fs.existsSync(path.join(dir, "source", "place.json")));
});
