// A face between the stills the model saw: followed frame by frame in a small grey copy of the
// footage (ten frames a second), forward from each still and back from the next, the two blended
// so that the path meets both stills. No model: the face's look on a still is matched in the
// frames around it, a little further each frame. Where the match is poor (the face turned away,
// a hand in front of it) the path between the two stills stays a straight line.

import { spawnSync } from "node:child_process";

export const TRACK_FPS = 10, TRACK_W = 256;
// the furthest a face moves from one tenth of a second to the next, in pixels of the small copy
const REACH_X = 12, REACH_Y = 8;
// a match worse than this (mean grey levels of 255) is no match
const POOR = 28;

// the footage at TRACK_FPS, TRACK_W wide, grey: { frames, w, h, fps, start }
export function greyFrames(video, { start = 0 } = {}) {
  const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", video], { encoding: "utf8" });
  const [W, H] = probe.stdout.trim().split(",").map(Number);
  const w = TRACK_W, h = Math.round((TRACK_W * H) / W / 2) * 2;
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", video, "-an", "-sn", "-vf", `fps=${TRACK_FPS},scale=${w}:${h}:flags=area,format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg could not read the frames of ${video}`);
  const n = Math.floor(r.stdout.length / (w * h));
  return { frames: Array.from({ length: n }, (_, i) => r.stdout.subarray(i * w * h, (i + 1) * w * h)), w, h, fps: TRACK_FPS, start, scale: w / W };
}

// how well the box (in the small copy's pixels: left, top, width, height) of frame a matches the
// same box moved by dx, dy in frame b: mean grey difference, every second pixel
function mismatch(a, b, w, h, box, dx, dy) {
  let sum = 0, n = 0;
  for (let y = box.t; y < box.t + box.h; y += 2) {
    const yb = y + dy;
    if (y < 0 || y >= h || yb < 0 || yb >= h) continue;
    for (let x = box.l; x < box.l + box.w; x += 2) {
      const xb = x + dx;
      if (x < 0 || x >= w || xb < 0 || xb >= w) continue;
      sum += Math.abs(a[y * w + x] - b[yb * w + xb]);
      n++;
    }
  }
  return n > 8 ? sum / n : Infinity;
}

// the face's middle frame by frame from frame `from` towards frame `to` (either way), starting
// at `box` ({ x, y, w, h } in the footage's pixels, x and y its middle): [{ k, x, y, ok }]
export function followBox(grey, box, from, to) {
  const { frames, w, h, scale } = grey;
  const step = to >= from ? 1 : -1;
  let cur = { l: Math.round((box.x - box.w / 2) * scale), t: Math.round((box.y - box.h / 2) * scale), w: Math.max(4, Math.round(box.w * scale)), h: Math.max(4, Math.round(box.h * scale)) };
  const out = [];
  let ok = true;
  for (let k = from; k !== to; k += step) {
    const a = frames[k], b = frames[k + step];
    if (!a || !b) break;
    let best = Infinity, bx = 0, by = 0;
    for (let dy = -REACH_Y; dy <= REACH_Y; dy++) for (let dx = -REACH_X; dx <= REACH_X; dx++) {
      const m = mismatch(a, b, w, h, cur, dx, dy);
      if (m < best || (m === best && Math.abs(dx) + Math.abs(dy) < Math.abs(bx) + Math.abs(by))) { best = m; bx = dx; by = dy; }
    }
    if (!(best < POOR)) ok = false;
    if (ok) cur = { ...cur, l: cur.l + bx, t: cur.t + by };
    out.push({ k: k + step, x: (cur.l + cur.w / 2) / scale, y: (cur.t + cur.h / 2) / scale, ok });
  }
  return out;
}

// a person's track ([{ t, x, y, w, h }] at the stills) filled in at every frame of the small copy
// between `start` and `end` (seconds): forward from each still, back from the next, blended by
// how close each is; sizes on the straight line. The stills stay as they are, marked `seen`
export function fillTrack(grey, track, start, end) {
  if (!track.length) return track;
  const frameOf = (t) => Math.round((t - grey.start) * grey.fps);
  const timeOf = (k) => grey.start + k / grey.fps;
  const first = Math.max(0, frameOf(start)), last = Math.min(grey.frames.length - 1, frameOf(end));
  const out = track.map((s) => ({ ...s, seen: true }));
  const lerp = (a, b, f) => a + (b - a) * f;
  // before the first still and after the last: followed from it alone
  const ends = [[track[0], first], [track[track.length - 1], last]];
  for (const [s, to] of ends) {
    const k = frameOf(s.t);
    for (const p of followBox(grey, s, k, to)) if (p.ok) out.push({ t: +timeOf(p.k).toFixed(3), x: p.x, y: p.y, w: s.w, h: s.h });
  }
  for (let i = 0; i + 1 < track.length; i++) {
    const a = track[i], b = track[i + 1], ka = frameOf(a.t), kb = frameOf(b.t);
    if (kb - ka < 2) continue;
    const fwd = followBox(grey, a, ka, kb), back = followBox(grey, b, kb, ka);
    const byK = Object.fromEntries(back.map((p) => [p.k, p]));
    for (const p of fwd) {
      if (p.k <= ka || p.k >= kb) continue;
      const q = byK[p.k], f = (p.k - ka) / (kb - ka);
      const line = { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) };
      const fx = p.ok ? p.x : line.x, fy = p.ok ? p.y : line.y, bx = q?.ok ? q.x : line.x, by = q?.ok ? q.y : line.y;
      out.push({ t: +timeOf(p.k).toFixed(3), x: lerp(fx, bx, f), y: lerp(fy, by, f), w: lerp(a.w, b.w, f), h: lerp(a.h, b.h, f) });
    }
  }
  const seen = new Set();
  return out.filter((s) => s.t >= start && s.t <= end || s.seen).sort((p, q) => p.t - q.t || (q.seen ? 1 : 0) - (p.seen ? 1 : 0))
    .filter((s) => { const key = s.t.toFixed(2); if (seen.has(key)) return false; seen.add(key); return true; });
}
