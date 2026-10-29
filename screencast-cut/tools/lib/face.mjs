// Where the face is in the webcam's picture, so that the circle and the face view sit on it and
// not on the picture's middle (a person off to one side, a camera set high). Three moments of the
// webcam go to a vision model through OpenRouter; the face box is the middle one of its answers,
// in 0–1 of the picture. Well under a cent; without OpenRouter, null (the middle stays).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chat } from "./openrouter.mjs";

export const FACE_MODEL = "google/gemini-3.8-flash";

export async function findFace(file, duration, { log = () => {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "face-"));
  try {
    const images = [0.2, 0.5, 0.8].map((at, i) => {
      const out = path.join(tmp, `${i}.jpg`);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(+(duration * at).toFixed(2)), "-i", file, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", out]);
      return { type: "image_url", image_url: { url: `data:image/jpeg;base64,${fs.readFileSync(out).toString("base64")}` } };
    });
    const { text, cost } = await chat(FACE_MODEL, [{ role: "user", content: [
      { type: "text", text: `Three frames of one webcam recording. For each frame, the face of the person speaking to the camera: its left, top, right and bottom edge (forehead to chin) in thousandths of the frame (whole numbers 0 to 1000, from the left and the top edge). Answer with JSON only, one object per frame in which a face is seen, for example {"faces": [{"left": 410, "top": 220, "right": 580, "bottom": 560}]}.` },
      ...images,
    ] }], { json: true, maxTokens: 1500, log });
    // every {"left": …} the answer holds, also when the JSON around them is not quite right
    const faces = [...text.matchAll(/\{[^{}]*"left"[^{}]*\}/g)].map((m) => { try { return JSON.parse(m[0]); } catch { return null; } })
      .filter((f) => f && ["left", "top", "right", "bottom"].every((k) => Number.isFinite(f[k])))
      .map((f) => [f.left, f.top, f.right, f.bottom].map((v) => Math.min(1, Math.max(0, v / 1000))))
      .filter(([l, t, r, b]) => r - l > 0.02 && b - t > 0.02);
    if (!faces.length) return null;
    // the middle answer by where the face's centre is across
    faces.sort((a, b) => a[0] + a[2] - b[0] - b[2]);
    const face = faces[Math.floor(faces.length / 2)].map((v) => +v.toFixed(3));
    log(`webcam: the face at [${face.join(", ")}] (${FACE_MODEL}, $${cost.toFixed(4)})`);
    return face;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
