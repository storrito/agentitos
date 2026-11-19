// Where the face is in the webcam's picture, so that the circle and the face view sit on it and
// not on the picture's middle (a person off to one side, a camera set high). Three moments of the
// webcam go to a vision model through OpenRouter; the face box is the middle one of its answers,
// in 0–1 of the picture (the circle's); `at` is every answer at its moment (the face view follows
// them: a head that moves), where each frame has one face, matched by the frame the answer names,
// else by count; otherwise `atWhy` says why there is none. Well under a cent; without OpenRouter,
// null (the middle stays).
//
//   findFace(file, duration) → { face: [x0, y0, x1, y1], at: [{ t, box }] | null, atWhy? } | null
//   readFaces(text, moments) → the same from the model's answer, or null without a face in it

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chat } from "./openrouter.mjs";

export const FACE_MODEL = "google/gemini-3.8-flash";

export async function findFace(file, duration, { log = () => {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "face-"));
  try {
    const moments = [0.2, 0.5, 0.8].map((at) => +(duration * at).toFixed(2));
    const images = moments.map((at, i) => {
      const out = path.join(tmp, `${i}.jpg`);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(at), "-i", file, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", out]);
      return { type: "image_url", image_url: { url: `data:image/jpeg;base64,${fs.readFileSync(out).toString("base64")}` } };
    });
    const { text, cost } = await chat(FACE_MODEL, [{ role: "user", content: [
      { type: "text", text: `Three frames of one webcam recording. For each frame, the face of the person speaking to the camera: the frame's number (1, 2 or 3, in the order given), and the face's left, top, right and bottom edge (forehead to chin) in thousandths of the frame (whole numbers 0 to 1000, from the left and the top edge). Answer with JSON only, one object per frame in which a face is seen, for example {"faces": [{"frame": 1, "left": 410, "top": 220, "right": 580, "bottom": 560}]}.` },
      ...images,
    ] }], { json: true, maxTokens: 1500, log });
    const found = readFaces(text, moments);
    if (!found) return null;
    const { face } = found;
    log(`webcam: the face at [${face.join(", ")}] (${FACE_MODEL}, $${cost.toFixed(4)})`);
    return found;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// The model's answer read: every {"left": …} it holds, also when the JSON around them is not quite
// right. The circle's face is the middle answer by where its centre is across (with two people in
// the frames, the one between). The answers go to their moments by the frame each names; an
// answer without a number by count, only where there is one per frame. Two faces in one frame are
// more than the face view follows: no `at` then, and `atWhy` says so.
export function readFaces(text, moments) {
  const answers = [...String(text).matchAll(/\{[^{}]*"left"[^{}]*\}/g)].map((m) => { try { return JSON.parse(m[0]); } catch { return null; } })
    .filter((f) => f && ["left", "top", "right", "bottom"].every((k) => Number.isFinite(f[k])))
    .map((f) => ({ frame: Number.isInteger(f.frame) && f.frame >= 1 && f.frame <= moments.length ? f.frame : null, box: [f.left, f.top, f.right, f.bottom].map((v) => Math.min(1, Math.max(0, v / 1000))) }))
    .filter(({ box: [l, t, r, b] }) => r - l > 0.02 && b - t > 0.02);
  if (!answers.length) return null;
  const round = (b) => b.map((v) => +v.toFixed(3));
  let at = null, atWhy;
  const numbered = answers.every((a) => a.frame);
  const per = numbered ? moments.map((_, i) => answers.filter((a) => a.frame === i + 1)) : null;
  if (numbered && per.some((l) => l.length > 1)) atWhy = `the model saw ${Math.max(...per.map((l) => l.length))} faces in one of its frames, and the face view follows one`;
  else if (numbered) at = per.flatMap((l, i) => l.map((a) => ({ t: moments[i], box: round(a.box) })));
  else if (answers.length === moments.length) at = answers.map((a, i) => ({ t: moments[i], box: round(a.box) }));
  else atWhy = `the model gave ${answers.length} faces for its ${moments.length} frames without saying which frame each is in (two people, or a frame without a face)`;
  const sorted = answers.map((a) => a.box).sort((a, b) => a[0] + a[2] - b[0] - b[2]);
  const face = round(sorted[Math.floor(sorted.length / 2)]);
  return { face, at, ...(atWhy ? { atWhy } : {}) };
}
