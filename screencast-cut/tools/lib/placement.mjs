// The face view placed by where the face is, through agentitos' layout skill (its place.mjs, run
// as a program: LAYOUT_TOOL naming it, else beside this skill, else in the machine's clone). The
// webcam's face (face.mjs: the model's boxes on three frames, kept in sources.json), followed
// between those frames by agentitos' clips (its frame.mjs --faces with the boxes given: the
// tracker, no model), and the captions' band as captions built it (area.json: they stay at the
// safe box's bottom) go in; the candidates come back in layout's order for a picture of a speaker
// (--pick speaker), the picture this skill drew before it asked layout (cover) among them, judged:
// first where it passes, then the pictures across the frame's width, then narrower ones. Which one
// a keep shows: the one the agent names in cut.json ("layout"), else the first.
//
//   layoutTool(), framingTool()          → the path of layout's place.mjs / clips' frame.mjs, or null
//   faceMoments(cam)                     → [{ t, box: [x, y, w, h] }] in px of the webcam's picture
//   speakerMoments(cam)                  → { moments } of the circle's face at the model's frames, or
//                                          { why } where they are not of one person
//   followFace({ tool, file, cam, out }) → { moments: [{ t, box }] } every tenth of a second, followed
//                                          from the model's boxes, or { why } where it was not
//   keepMoments(followed, from, to, fallback) → the moments of one keep (webcam seconds), else fallback
//   insidePicture(moments, cam)          → { moments, clamped, outside }: each box taken to its part
//                                          inside the picture, a box wholly outside left out
//   placeFace({ tool, folder, moments, cam, width, height, area, platforms }) → { res: layout's
//                                          placement.json } or { why } (it never throws)
//   mouthSplit(mouth, pieces, words, offset, { smaller | wide, chosen }) → { said, facts }: the
//                                          seconds the captions lie on the mouth, where to split
//   nameOf(candidate), markOf(candidate) → "crop 4:5", "cover", …; ✓ ! – ✗ in the order for a speaker
//   coverOf(cam, width, height)          → the old full-frame crop (layout.cover) as scale, left, top
//   geometry(pic, cam)                   → the webcam element's left, top, width, height and inset

import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cover } from "./layout.mjs";

const skill = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
export const layoutTool = () => [process.env.LAYOUT_TOOL, path.join(skill, "..", "layout", "tools", "place.mjs"), "/home/sprite/skills/layout/tools/place.mjs"].find((p) => p && fs.existsSync(p)) || null;
export const framingTool = () => [process.env.FRAME_TOOL, path.join(skill, "..", "clips", "tools", "frame.mjs"), "/home/sprite/skills/clips/tools/frame.mjs"].find((p) => p && fs.existsSync(p)) || null;

// The face in px of the webcam's picture: its box at each of the frames face.mjs showed the model
// (faceAt), else the one box kept for the circle. layout holds the hull of the moments for the
// whole keep, and takes the face's usual (median) box for its size.
export function faceMoments(cam) {
  const px = ([x0, y0, x1, y1]) => [x0 * cam.width, y0 * cam.height, (x1 - x0) * cam.width, (y1 - y0) * cam.height].map((v) => +v.toFixed(1));
  if (Array.isArray(cam.faceAt) && cam.faceAt.length) return cam.faceAt.map((m) => ({ t: m.t, box: px(m.box) }));
  return cam.face ? [{ t: 0, box: px(cam.face) }] : [];
}

// The face the tracker follows is one person's: the circle's (face.mjs, the middle of the model's
// answers by where they lie across). Each of the model's boxes must lie within a face's width and
// height of it (centre to centre); one further off is another person, or a head that moved further
// than the face view follows, and then the keeps are covered as before. So are answers that gave
// no box per frame (two people in a frame, a frame without a face, or a project from before
// face.mjs kept them).
export function speakerMoments(cam) {
  if (!cam.face) return { why: "the webcam's face is not known" };
  if (!Array.isArray(cam.faceAt) || !cam.faceAt.length) return { why: cam.faceAtWhy || "the model gave no face for each of the frames it saw (two people, a frame without a face, or a webcam found before the face view followed one)" };
  const [x0, y0, x1, y1] = cam.face, w = x1 - x0, h = y1 - y0;
  const off = cam.faceAt.filter(({ box: b }) => Math.abs((b[0] + b[2]) / 2 - (x0 + x1) / 2) > w || Math.abs((b[1] + b[3]) / 2 - (y0 + y1) / 2) > h);
  if (off.length) return { why: `the model's ${off.length === 1 ? "face" : "faces"} at ${off.map((m) => `${m.t} s`).join(" and ")} ${off.length === 1 ? "lies" : "lie"} further than a face's width or height from the one the circle shows (another person, or a head that moved far), and the face view follows one person` };
  return { moments: faceMoments(cam) };
}

// The face between the model's frames, followed in the webcam's picture by clips' tracker (a
// small grey copy, ten frames a second; no model): where the head leans in or moves between two
// of the frames, its place over the keep's time. The box's size between two frames is on a
// straight line (the tracker follows where the face is, not how large it grows). The small copy
// is held in memory whole, so a webcam over FOLLOW_MAX seconds is not followed. Kept in `out`
// with what it was made from (followKey: the boxes, the webcam's file by its size and time, the
// tracker's code), so that it is done once for that webcam and tracker.
export const FOLLOW_MAX = 600;

// What a kept track was made from: the model's boxes, the webcam's file (its size and modification
// time, as tracks.mjs keys its sound), and the tracker's version: a hash of clips' frame.mjs and of
// the files of its lib/ it imports (the tracker is lib/track.mjs, the cuts lib/cuts.mjs).
export function followKey({ tool, file, from }) {
  const st = fs.statSync(file);
  const h = crypto.createHash("sha1");
  const code = fs.readFileSync(tool, "utf8");
  h.update(code);
  for (const m of code.matchAll(/^import [^;]*? from "(\.\/lib\/[^"]+)";/gm)) {
    const f = path.join(path.dirname(tool), m[1]);
    if (fs.existsSync(f)) h.update(fs.readFileSync(f));
  }
  return { from, webcam: { size: st.size, mtime: st.mtimeMs }, tracker: h.digest("hex").slice(0, 16) };
}
export function followFace({ tool, file, cam, out }) {
  if (!Array.isArray(cam.faceAt) || !cam.faceAt.length) return { why: "the model gave no box for each of its frames" };
  if (!tool) return { why: "agentitos' clips skill is not beside this one (or FRAME_TOOL naming its tools/frame.mjs)" };
  if (cam.duration > FOLLOW_MAX) return { why: `the webcam runs ${Math.round(cam.duration / 60)} minutes, over the ${FOLLOW_MAX / 60} the tracker holds in memory` };
  const from = faceMoments(cam);
  const key = followKey({ tool, file, from });
  try { const kept = JSON.parse(fs.readFileSync(out, "utf8")); if (JSON.stringify(kept.key) === JSON.stringify(key)) return kept; } catch {}
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "follow-"));
  try {
    const words = path.join(tmp, "words.json"), faces = path.join(tmp, "faces.json");
    fs.writeFileSync(words, "[]");
    const r = spawnSync(process.execPath, [tool, file, words, "--faces", faces, ...from.flatMap((m) => ["--face-at", `${m.t}:${m.box.join(",")}`])], { encoding: "utf8", maxBuffer: 64 << 20 });
    if (r.status || !fs.existsSync(faces)) return { why: `clips' tracker stopped: ${(r.stdout || r.stderr || "").trim().split("\n").pop()}` };
    // the largest face of each moment (one person speaks to the webcam)
    const moments = JSON.parse(fs.readFileSync(faces, "utf8")).faces.filter((f) => f.boxes?.length)
      .map((f) => ({ t: f.t, box: [...f.boxes].sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3])[0].box.map((v) => +v.toFixed(1)) }));
    if (!moments.length) return { why: "clips' tracker found the face at no moment" };
    const kept = { key, from, moments };
    fs.writeFileSync(out, JSON.stringify(kept));
    return kept;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// the followed moments inside one keep (webcam seconds from, to), every fifth of a second; none
// there (the tracker lost the face, or did not run): the model's boxes stand as they are
export function keepMoments(followed, from, to, fallback) {
  const inside = (followed?.moments || []).filter((m) => m.t >= from - 1e-3 && m.t <= to + 1e-3);
  const every = inside.filter((m, i) => i === 0 || i === inside.length - 1 || Math.round(m.t * 10) % 2 === 0);
  return every.length ? { moments: every, followed: true } : { moments: fallback, followed: false };
}

// A box from the tracker can reach past the picture: a head at the top edge (the tracker moves its
// box with the head, and part of it lies above the frame) or at a side. layout's place refuses any
// box past the source's edge, so each is taken to its part inside the picture, as layout's beside
// takes a face's box; a box wholly outside the picture (less than a pixel of it inside) is left out.
export function insidePicture(moments, cam) {
  let clamped = 0, outside = 0;
  const out = [];
  for (const m of moments) {
    const [x, y, w, h] = m.box;
    const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(cam.width, x + w), y1 = Math.min(cam.height, y + h);
    if (x1 - x0 < 1 || y1 - y0 < 1) { outside++; continue; }
    if (x0 !== x || y0 !== y || x1 !== x + w || y1 !== y + h) clamped++;
    out.push({ t: m.t, box: [x0, y0, x1 - x0, y1 - y0].map((v) => +v.toFixed(1)) });
  }
  return { moments: out, clamped, outside };
}

// layout's candidates for one keep's moments, or the reason there are none: whatever place says
// when it stops is kept in the folder's place.log, not passed on (its words are for a caller who
// read the boxes off a grid, which the agent here never did).
export function placeFace({ tool, folder, moments, cam, width, height, area, platforms = [] }) {
  try {
    fs.mkdirSync(folder, { recursive: true });
    const inside = insidePicture(moments, cam);
    if (!inside.moments.length) return { why: "the face's boxes lie outside the webcam's picture" };
    const track = path.join(folder, "face.json");
    fs.writeFileSync(track, JSON.stringify(inside.moments));
    const c = coverOf(cam, width, height);
    const r = spawnSync(process.execPath, [tool, "place", folder, "--frame", `${width}x${height}`, "--source", `${cam.width}x${cam.height}`, "--face-track", track,
      ...(area ? ["--caption-area", area] : []), ...(platforms.length ? ["--platform", platforms.join(",")] : []),
      "--pick", "speaker", "--cover", `${c.scale},${c.left},${c.top}`, "--json"], { encoding: "utf8", maxBuffer: 64 << 20 });
    if (r.status !== 0 || r.error) {
      fs.writeFileSync(path.join(folder, "place.log"), `${r.error ? `${r.error.message}\n` : ""}${r.stdout || ""}${r.stderr || ""}`);
      return { why: `layout's place gave no candidates for this keep's face (its words in ${path.join(folder, "place.log")})` };
    }
    return { res: JSON.parse(r.stdout), clamped: inside.clamped, outside: inside.outside };
  } catch (e) {
    return { why: `the placement stopped (${e.message.split("\n")[0]})` };
  }
}

export const nameOf = (c) => `${c.fit}${c.crop ? ` ${c.crop}` : ""}${c.closer ? " closer" : ""}${c.onGround ? ", text on the ground" : ""}`;
// in the order for a speaker: captions on the chin pass (layout's own mark would be –)
export const markOf = (c) => (c.pick ? (c.pick.passes ? (c.soft ? "!" : "✓") : c.hard ? "✗" : "–") : c.hard ? "✗" : c.unmet.length ? "–" : c.soft ? "!" : "✓");

// Where a picture across the width has the captions on the mouth for part of a face keep (layout's
// pick.mouth, in the webcam's seconds: a lean): the seconds, the word to split the keep at (the
// last word that starts by the time the captions reach the mouth; where they leave it before the
// keep ends, also the first word after) and the other picture by name. Up to half of the keep the
// picture across the width stays for all of it (`smaller`: the one that passes, offered); over
// half the smaller picture stands (`wide`: the one across the width, `chosen`: the smaller). The
// tool never changes the picture inside a keep: the split and the other picture are the agent's.
export function mouthSplit(m, ps, words, offset, { smaller = null, wide = null, chosen = null } = {}) {
  const kept = [...new Set(ps.flatMap((p) => p.words || []))].sort((a, b) => a - b).map((i) => words[i]).filter(Boolean);
  const from = m.from + offset, to = m.to + offset;
  const at = kept.filter((w) => w.start <= from + 0.05).at(-1), after = kept.find((w) => w.start >= to + 0.05);
  const first = kept[0], last = kept.at(-1);
  const quote = (w) => `word ${w.i} ("${w.text}")`;
  const ranges = [];
  if (first && last) {
    const a = at && at.i > first.i ? at.i : first.i, b = after && after.i <= last.i ? after.i : null;
    if (a > first.i) ranges.push(`${first.i}-${a - 1}`);
    ranges.push(`${a}-${(b ?? last.i + 1) - 1}`);
    if (b != null) ranges.push(`${b}-${last.i}`);
  }
  const splits = [at && first && at.i > first.i ? quote(at) : null, after && last && after.i <= last.i ? quote(after) : null].filter(Boolean);
  const split = splits.length ? `split the keep at ${splits.join(" and at ")} ("words": ${ranges.map((r) => `"${r}"`).join(", ")})` : "split the keep where the lean begins";
  const seconds = `${m.seconds} s of the keep's ${m.of} s (the webcam's ${m.from}–${m.to} s)`;
  const said = wide
    ? `${nameOf(wide)} at ${wide.scale}× across the width has the captions on the mouth for ${seconds}, more than half, so ${nameOf(chosen)} stands for all of it; to keep a picture across the width for the rest, ${split}: the parts without the lean take it by themselves`
    : `the captions lie on the mouth for ${seconds}, at most half, so the picture across the width stays for all of it; to give those seconds another picture, ${split} and name another picture on the part with the lean${smaller ? `, or name "${nameOf(smaller)}" on the keep for all of it (it passes, the face ${Math.round(smaller.pick.face * 100)} % of the height)` : ""}`;
  return { said, facts: { seconds: m.seconds, of: m.of, from: +from.toFixed(2), to: +to.toFixed(2), ...(ranges.length > 1 ? { split: ranges } : {}), ...(smaller ? { smaller: nameOf(smaller) } : {}) } };
}

// the frame covered as before this skill asked layout (layout.cover: the webcam's crop of the
// frame's shape around the face, up to 1.25× closer where the face sits low), as a placement
export function coverOf(cam, width, height) {
  const c = cover(cam, width, height);
  const scale = width / ((c[2] - c[0]) * cam.width);
  return { fit: "cover", scale: +scale.toFixed(4), left: +(-c[0] * cam.width * scale).toFixed(1), top: +(-c[1] * cam.height * scale).toFixed(1), window: [0, 0, width, height] };
}

// The webcam's element for a placement: drawn `scale` times the picture's size with its corner at
// left, top, clipped to its window (the part of the frame the sharp picture fills; the blurred
// screen behind shows around it)
export function geometry(pic, cam) {
  const r = (v) => +v.toFixed(1);
  const w = cam.width * pic.scale, h = cam.height * pic.scale;
  const [x, y, ww, wh] = pic.window;
  return { left: r(pic.left), top: r(pic.top), width: r(w), height: r(h),
    inset: [y - pic.top, pic.left + w - (x + ww), pic.top + h - (y + wh), x - pic.left].map((v) => r(Math.max(0, v))) };
}
