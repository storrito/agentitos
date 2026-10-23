// What must not be readable in a screencast that goes public, found by a model that looks at the
// frames: a login link with a token (an rragent page's address is
// https://<agent>.sprites.app/bot/1?token=…), API keys and passwords, e-mail addresses and phone
// numbers, private chats and their names, a phone's notifications. Frames of the shots the cut
// shows go to the model in batches; it answers with boxes (0–1000 of the frame, as Gemini draws
// them), which the build covers with a blur for the whole shot.
//
//   scan(shots, opts) → [{ source, from, to, what, box: [x0, y0, x1, y1] in 0–1 }]
//   shots: [{ source, file, offset, from, to, width, height }]   from–to on the recording's timeline

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chat } from "./openrouter.mjs";

export const PRIVACY_MODEL = "google/gemini-3.6-flash";
const EVERY = 3; // a frame every this many seconds of a shot, at least one
const BATCH = 6;

const ASK = `These are frames of a screen recording that will be published as a video. Find everything in them that must not be readable in public:
- a URL or address bar that carries a token, key, session or signature (?token=…, &key=…, a long random string)
- API keys, passwords, secrets, access tokens, one-time codes
- e-mail addresses and phone numbers
- the names and messages of private chats and DMs, and notifications on a phone
Not: public account handles (@name), product names, the app's own interface, prices, ordinary text.
Answer with JSON only: {"frames": [{"frame": <number>, "found": [{"what": "<short description>", "box": [ymin, xmin, ymax, xmax]}]}]}, the box in 0–1000 of the frame, generous enough to cover the whole text. A frame with nothing to hide gets "found": [].`;

function frame(file, at, dir, k) {
  const out = path.join(dir, `f${k}.jpg`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(Math.max(0, at)), "-i", file, "-frames:v", "1", "-vf", "scale='min(1600,iw)':-2", "-q:v", "4", out]);
  return out;
}

export async function scan(shots, { model = PRIVACY_MODEL, log = () => {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "screencast-privacy-"));
  const samples = [];
  for (const s of shots) {
    const n = Math.max(1, Math.ceil((s.to - s.from) / EVERY));
    for (let k = 0; k < n; k++) samples.push({ shot: s, t: s.from + ((k + 0.5) * (s.to - s.from)) / n });
  }
  const found = [];
  let cost = 0;
  try {
    for (let b = 0; b < samples.length; b += BATCH) {
      const batch = samples.slice(b, b + BATCH);
      const content = [{ type: "text", text: ASK }];
      batch.forEach((x, k) => {
        const file = frame(x.shot.file, x.t - x.shot.offset, tmp, b + k);
        content.push({ type: "text", text: `Frame ${k + 1}:` }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${fs.readFileSync(file).toString("base64")}` } });
      });
      const r = await chat(model, [{ role: "user", content }], { json: true, log });
      cost += r.cost;
      let j;
      try { j = JSON.parse(r.text.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { throw new Error(`the model's answer was no JSON: ${r.text.slice(0, 200)}`); }
      for (const f of j.frames || []) {
        const x = batch[Number(f.frame) - 1];
        if (!x) continue;
        for (const hit of f.found || []) {
          const [y0, x0, y1, x1] = (hit.box || []).map(Number);
          if (![y0, x0, y1, x1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) continue;
          // a little room around the text, which a model draws tight
          const pad = (v, d) => Math.min(1, Math.max(0, v / 1000 + d));
          found.push({ source: x.shot.source, from: x.shot.from, to: x.shot.to, at: +x.t.toFixed(2), what: String(hit.what || "private"),
            box: [pad(x0, -0.01), pad(y0, -0.012), pad(x1, 0.01), pad(y1, 0.012)].map((v) => +v.toFixed(4)) });
        }
      }
      log(`  ${Math.min(b + BATCH, samples.length)}/${samples.length} frames looked at`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { found, frames: samples.length, cost };
}
