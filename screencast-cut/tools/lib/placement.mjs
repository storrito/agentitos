// The face view placed by where the face is, through agentitos' layout skill (its place.mjs, run
// as a program: LAYOUT_TOOL naming it, else beside this skill, else in the machine's clone). The
// webcam's face (face.mjs: the model's boxes on three frames, kept in sources.json) and the
// captions' band as captions built it (area.json: they stay at the safe box's bottom) go in; the
// candidates come back, each a way to lay the webcam's picture into the frame (covering it, a crop
// of another shape over a ground, the whole picture smaller) with its enlargement and where the
// face lands. Which one a keep shows: the one the agent names in cut.json ("layout"), else the
// rule best-takes uses for a person's take (rankPictures).
//
//   layoutTool()                         → the path of layout's place.mjs, or null
//   faceMoments(cam)                     → [{ t, box: [x, y, w, h] }] in px of the webcam's picture
//   placeFace({ tool, folder, cam, width, height, area, platforms }) → layout's placement.json
//   rankPictures(candidates, usual, H)   → the candidates that pass, the face nearest the usual size first
//   nameOf(candidate)                    → "crop 4:5", "inset", "crop 1:1, text on the ground", …
//   coverOf(cam, width, height)          → the old full-frame crop (layout.cover), as a candidate named "cover"
//   geometry(pic, cam)                   → the webcam element's left, top, width, height and inset

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cover } from "./layout.mjs";

export function layoutTool() {
  const skill = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  return [process.env.LAYOUT_TOOL, path.join(skill, "..", "layout", "tools", "place.mjs"), "/home/sprite/skills/layout/tools/place.mjs"].find((p) => p && fs.existsSync(p)) || null;
}

// The face in px of the webcam's picture: its box at each of the frames face.mjs showed the model
// (faceAt), else the one box kept for the circle. layout holds the hull of the moments for the
// whole keep, and takes the face's usual (median) box for its size.
export function faceMoments(cam) {
  const px = ([x0, y0, x1, y1]) => [x0 * cam.width, y0 * cam.height, (x1 - x0) * cam.width, (y1 - y0) * cam.height].map((v) => +v.toFixed(1));
  if (Array.isArray(cam.faceAt) && cam.faceAt.length) return cam.faceAt.map((m) => ({ t: m.t, box: px(m.box) }));
  return cam.face ? [{ t: 0, box: px(cam.face) }] : [];
}

export function placeFace({ tool, folder, cam, width, height, area, platforms = [] }) {
  fs.mkdirSync(folder, { recursive: true });
  const track = path.join(folder, "face.json");
  fs.writeFileSync(track, JSON.stringify(faceMoments(cam)));
  const r = spawnSync(process.execPath, [tool, "place", folder, "--frame", `${width}x${height}`, "--source", `${cam.width}x${cam.height}`, "--face-track", track,
    ...(area ? ["--caption-area", area] : []), ...(platforms.length ? ["--platform", platforms.join(",")] : []), "--json"], { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status) throw new Error(`layout place: ${(r.stderr || r.stdout).trim().split("\n")[0]}`);
  return JSON.parse(r.stdout);
}

// best-takes' rule for a person's take (best-takes/tools/lib/place.mjs, rankPictures and FACE_UP;
// copied, as a folder never imports another's code: change both or neither). Of layout's
// candidates of one picture, those that pass (no hard problem, so never enlarged past layout's 2×;
// every text placed: here the captions in their band, clear of the face) by the face nearest the
// usual size of a person's own take, as large as it comes up to FACE_UP of the frame's height (the
// upper end of the middle half of faces in published Shorts, layout-data: 23–34 %), layout's order
// among equals; then the rest in layout's order. → [{ …candidate, n, face }]
export const FACE_UP = 0.34;
export function rankPictures(candidates, usual, H) {
  const list = candidates.map((x, i) => ({ ...x, n: i + 1, face: (usual * x.scale) / H })).filter((x) => !x.parts && Number.isFinite(x.scale));
  const passes = (x) => !x.hard && !x.unmet.length;
  const off = (x) => (x.face <= FACE_UP ? FACE_UP - x.face : 10 * (x.face - FACE_UP));
  return [...list.filter(passes).sort((a, b) => off(a) - off(b) || a.n - b.n), ...list.filter((x) => !passes(x))];
}

export const nameOf = (c) => `${c.fit}${c.crop ? ` ${c.crop}` : ""}${c.closer ? " closer" : ""}${c.onGround ? ", text on the ground" : ""}`;
export const markOf = (c) => (c.hard ? "✗" : c.unmet.length ? "–" : c.soft ? "!" : "✓");

// the frame covered as before this skill asked layout (layout.cover: the webcam's crop of the
// frame's shape around the face, up to 1.25× closer where the face sits low), as a candidate
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
