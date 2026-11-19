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
//   followFace({ tool, file, cam, out }) → { moments: [{ t, box }] } every tenth of a second, followed
//                                          from the model's boxes, or { why } where it was not
//   keepMoments(followed, from, to, fallback) → the moments of one keep (webcam seconds), else fallback
//   insidePicture(moments, cam)          → { moments, clamped, outside }: each box taken to its part
//                                          inside the picture, a box wholly outside left out
//   placeFace({ tool, folder, moments, cam, width, height, area, platforms }) → { res: layout's
//                                          placement.json } or { why } (it never throws)
//   nameOf(candidate), markOf(candidate) → "crop 4:5", "cover", …; ✓ ! – ✗ in the order for a speaker
//   coverOf(cam, width, height)          → the old full-frame crop (layout.cover) as scale, left, top
//   geometry(pic, cam)                   → the webcam element's left, top, width, height and inset

import fs from "node:fs";
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

// The face between the model's frames, followed in the webcam's picture by clips' tracker (a
// small grey copy, ten frames a second; no model): where the head leans in or moves between two
// of the frames, its place over the keep's time. The box's size between two frames is on a
// straight line (the tracker follows where the face is, not how large it grows). The small copy
// is held in memory whole, so a webcam over FOLLOW_MAX seconds is not followed. Kept in `out`
// with the boxes it started from, so that it is done once.
export const FOLLOW_MAX = 600;
export function followFace({ tool, file, cam, out }) {
  if (!Array.isArray(cam.faceAt) || !cam.faceAt.length) return { why: "the model gave no box for each of its frames" };
  if (!tool) return { why: "agentitos' clips skill is not beside this one (or FRAME_TOOL naming its tools/frame.mjs)" };
  if (cam.duration > FOLLOW_MAX) return { why: `the webcam runs ${Math.round(cam.duration / 60)} minutes, over the ${FOLLOW_MAX / 60} the tracker holds in memory` };
  const from = faceMoments(cam);
  try { const kept = JSON.parse(fs.readFileSync(out, "utf8")); if (JSON.stringify(kept.from) === JSON.stringify(from)) return kept; } catch {}
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
    const kept = { from, moments };
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
