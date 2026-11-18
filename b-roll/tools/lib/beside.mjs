// A beat shown "beside" the person: the frame is shared. One geometry per video and frame (with or
// without captions), whatever the material, so that beats in a row need no rule of their own.
//
// The geometry is not b-roll's: agentitos' layout skill keeps the one rule for material beside a
// speaker (its `beside` command), and this asks it once per build, as a program: LAYOUT naming its
// tools/place.mjs, else beside this skill, else in the machine's clone of the skills. Without it a
// beat beside the person cannot be built, and the build says so; there is no second rule here.
// b-roll tells the command what only b-roll knows: the frame, the apps, the person's video and
// face, the captions' area, what its material needs, the person filling the frame before, and the
// owner's settings below. It takes the first candidate the person stands in as a rectangle (b-roll
// draws no circle) and gives it on in the names render.mjs and the hosts read.
//
//   besideLayout({ width, height, face, source, captions, platforms }) →
//     { side,                                         true: the person is a column at one side
//       material: { field },                          the material's field
//       speaker:  { field, card, scale, left, top,    the person's field, what of it the video
//                   face, facePct, assumed },          fills, the transform of the host's video
//                                                      (scale, then a shift, origin top left), the
//                                                      face in the frame then
//       captions: { where, box, font, shift } | null, "seam" (moved onto box by shift) or "stay"
//       warnings, notes,                              what the command says of the candidate
//       placement, candidate, call }                  its placement.json, which one, the call
//   frameFace(face, source, width, height)           → the face in px of the frame (cover fit)
//   layoutTool()                                     → layout's tools/place.mjs, or null
//   NEEDS_LAYOUT                                     → the sentence for when it is missing
//
// Boxes are [x, y, w, h] in px of the frame. `face` is the face (forehead to chin, cheek to cheek)
// in px of the SOURCE video, `source` its size [w, h] (none: the frame's); the host fills the frame
// with it (object-fit: cover). `captions` is where the captions stand without b-roll,
// { left, width, top, bottom, size, lines } (agentitos' captions' area.json). `platforms` is the
// list b-roll was given (none: the frame's usual apps).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The owner's choice for the person's face: 22 % of the frame's height while the video stays
// sharp. Published Shorts show 18 % (the command's own default below the material); the owner
// looked at built videos and wanted the person a little larger. Sharp means the video's own pixels
// enlarged under 1.25×; where the wish needs more, the face gets 18 %, enlarging the video up to
// twice its pixels (reported as soft past 1.25×), and beyond that it stays smaller, with a warning.
// The 18 % is named too: the command's 16:9 column aims at 23 % by itself, which enlarges a medium
// shot past 1.25× in place of keeping it sharp at the 18 % that b-roll's rule falls back to.
export const FACE_WISH = 0.22;
export const FACE_SHARP = 0.18;
export const ENLARGE_MOST = 2;
export const SOFT_FROM = 1.25;
// What the material needs: a field at least 18 % of the frame's height (a number with a two-line
// label under it), and wide enough for a number of six characters ("+300 %", "90 Sek.") at the
// size such a field gives it (render.mjs sets the figure to 0.42 of the field's height; six
// characters of Inter 800 are about 3.6 of its em wide, 1.5 times the field's height), with room
// to spare for the label: 1.7 times the height.
export const MATERIAL_LEAST = 0.18;
export const MATERIAL_SHAPE = 1.7;

export const NEEDS_LAYOUT = "A beat beside the person needs agentitos' layout skill beside this one (or LAYOUT naming its tools/place.mjs).";

export function layoutTool() {
  const skill = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const candidates = [process.env.LAYOUT, path.join(skill, "..", "layout", "tools", "place.mjs"), "/home/sprite/skills/layout/tools/place.mjs"];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v) => String(+(+v).toFixed(4));
const round = (b) => b.map(Math.round);

// a face box in px of the source, kept inside it; null when it is no box
export function faceBox(face, sw, sh) {
  if (!Array.isArray(face) || face.length !== 4 || !face.every(Number.isFinite)) return null;
  let [x, y, w, h] = face;
  if (w <= 0 || h <= 0) return null;
  x = clamp(x, 0, sw - 1); y = clamp(y, 0, sh - 1);
  return [x, y, Math.min(w, sw - x), Math.min(h, sh - y)];
}

const sourceOf = (source, width, height) => (Array.isArray(source) && source.length === 2 && source.every((v) => v > 0) ? source : [width, height]);

// the source's face in px of the frame, as the host shows the source (filling the frame, cut at its
// edges); also how much the source's own pixels are enlarged
export function frameFace(face, source, width, height) {
  const [sw, sh] = sourceOf(source, width, height);
  const box = faceBox(face, sw, sh);
  if (!box) return null;
  const c = Math.max(width / sw, height / sh), ox = (width - sw * c) / 2, oy = (height - sh * c) / 2;
  return { box: [ox + c * box[0], oy + c * box[1], c * box[2], c * box[3]], cover: c };
}

const captionsGiven = (c) => c && ["left", "width", "top", "bottom", "size", "lines"].every((k) => Number.isFinite(c[k])) && c.bottom > c.top;

export function besideLayout({ width, height, face, source, captions, platforms = [] }) {
  const tool = layoutTool();
  if (!tool) throw new Error(NEEDS_LAYOUT);
  const [sw, sh] = sourceOf(source, width, height);
  const box = faceBox(face, sw, sh);
  if (captions && !captionsGiven(captions)) throw new Error("The captions' area is left, width, top, bottom, size and lines in px of the frame (agentitos' captions writes it as area.json): build the captions again.");
  const cap = captions || null;
  // the person filling the frame before the beat, as the host shows the video (cover, centred)
  const c = Math.max(width / sw, height / sh);
  const least = Math.round(MATERIAL_LEAST * height);
  const args = [
    "--frame", `${width}x${height}`, ...(platforms.length ? ["--platform", platforms.join(",")] : []),
    "--source", `${sw}x${sh}`, "--face", box ? box.map(num).join(",") : "assumed",
    "--material-min", `${Math.round(MATERIAL_SHAPE * least)}x${least}`,
    ...(cap ? ["--caption-area", [cap.left, cap.width, cap.top, cap.bottom, cap.size, cap.lines].map(num).join(","), "--text", `caption:${cap.lines}`] : []),
    "--before", [c, (width - sw * c) / 2, (height - sh * c) / 2].map(num).join(","),
    "--set", `beside.wish=${FACE_WISH}`, "--set", `beside.face=${FACE_SHARP}`, "--set", `beside.faceUpTo=${ENLARGE_MOST}`, "--set", `weights.enlarge.softFrom=${SOFT_FROM}`,
    // a wide frame: the person's column on the left, and the captions where they stand (b-roll
    // moves the captions' block by a transform only: it cannot set them narrower under the
    // material); the command reads these only for its 16:9 column
    ...(width > height ? ["--set", "beside.side=left", "--set", "beside.captions=stay"] : []),
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "broll-beside-"));
  let res;
  try {
    const r = spawnSync(process.execPath, [tool, "beside", dir, ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`layout: ${(r.stderr || r.stdout || "").trim().split("\n").pop() || "its beside command stopped"}`);
    res = JSON.parse(fs.readFileSync(path.join(dir, "placement.json"), "utf8"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const k = res.candidates.findIndex((x) => x.speaker?.shape === "rect");
  if (k < 0) throw new Error("layout's beside command gave no candidate with the person as a rectangle: b-roll draws no circle.");
  const C = res.candidates[k], S = C.speaker;

  // what the command says of this candidate: its problems as warnings, its notes and the frame's
  // as notes (the assumed face b-roll says itself, with how to give one)
  const warnings = C.problems.map((p) => `${p.of}: ${p.what}`);
  const notes = [...(C.notes || []), ...res.notes.filter((n) => !/--face assumed/.test(n))];
  let caps = null;
  if (C.captions && cap) {
    const b = round(C.captions.box);
    // the host's captions move there by a shift of their block: from where they stand to the box
    caps = { where: C.captions.where, box: b, font: C.captions.font ?? cap.size, shift: { x: Math.round(C.captions.box[0] - cap.left), y: Math.round(C.captions.box[1] - cap.top) } };
  }
  // The command's captions straddle the seam: their lower line lies over the top of the person's
  // field. b-roll lets the person's card begin under them, so that they stand on the panel and
  // not on the video; the face and the hair's room are below them in any case.
  let card = round(S.window);
  if (caps?.where === "seam") {
    const under = caps.box[1] + caps.box[3];
    if (under > card[1] && under <= S.face[1]) card = [card[0], under, card[2], card[1] + card[3] - under];
  }
  if (S.ground > 0) notes.push(`the person shows as a card of ${card[2]}×${card[3]} in their field, the face ${S.facePct} % of the frame's height`);
  return {
    side: C.arrangement === "column",
    material: { field: round(C.material.field) },
    speaker: { field: round(S.field), card, scale: +S.host.scale.toFixed(4), left: Math.round(S.host.left), top: Math.round(S.host.top), face: round(S.face), facePct: S.facePct, assumed: !box },
    captions: caps,
    warnings, notes,
    placement: res, candidate: k + 1, call: ["beside", "<folder>", ...args],
  };
}
