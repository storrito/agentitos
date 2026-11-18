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
  if (r.status !== 0) throw new Error(`ffmpeg could not read the frames of ${video}: check that the file plays (ffprobe ${video}), else cut it again.`);
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
    // a face whose middle has left the picture is gone
    const cx = cur.l + cur.w / 2, cy = cur.t + cur.h / 2;
    if (cx < 0 || cx >= w || cy < 0 || cy >= h) ok = false;
    out.push({ k: k + step, x: (cur.l + cur.w / 2) / scale, y: (cur.t + cur.h / 2) / scale, ok });
  }
  return out;
}

// a person's track ([{ t, x, y, w, h }] at the stills, { t, absent } where a still does not show
// them) filled in at every frame of the small copy between `start` and `end` (seconds): forward
// from each still, back from the next, blended by how close each is; sizes on the straight line.
// Next to a still without the face it is followed only as far as the frames show it (it leaves
// the picture: absent, not cut). A still whose face is far from where the frames lead from both
// stills beside it, which agree, is the model's slip: left out and listed in `track.doubtful`
// ([{ t, off }], off in pixels). The stills stay as they are, marked `seen`
export function fillTrack(grey, track, start, end) {
  const result = (list, doubtful = []) => Object.assign(list, { doubtful });
  if (!track.some((s) => !s.absent)) return result(track.slice());
  const frameOf = (t) => Math.max(0, Math.min(grey.frames.length - 1, Math.round((t - grey.start) * grey.fps)));
  const timeOf = (k) => grey.start + k / grey.fps;
  const first = frameOf(start), last = frameOf(end);
  const lerp = (a, b, f) => a + (b - a) * f;
  const end1 = (path) => path[path.length - 1];
  // the model's slips: a still the frames from both neighbours (agreeing) do not lead to
  const doubtful = [];
  let entries = track.slice();
  for (let changed = true; changed;) {
    changed = false;
    const seen = entries.filter((s) => !s.absent);
    for (let i = 1; i + 1 < seen.length; i++) {
      const a = seen[i - 1], m = seen[i], b = seen[i + 1];
      const pf = end1(followBox(grey, a, frameOf(a.t), frameOf(m.t))), pb = end1(followBox(grey, b, frameOf(b.t), frameOf(m.t)));
      if (!pf?.ok || !pb?.ok) continue;
      const agree = Math.hypot(pf.x - pb.x, pf.y - pb.y) < 0.3 * m.w;
      const off = Math.hypot((pf.x + pb.x) / 2 - m.x, (pf.y + pb.y) / 2 - m.y);
      if (agree && off > 0.6 * m.w) { doubtful.push({ t: m.t, off: Math.round(off) }); entries = entries.filter((s) => s !== m); changed = true; break; }
    }
  }
  const out = entries.map((s) => ({ ...s, seen: true }));
  const followed = (s, from, to) => {
    for (const p of followBox(grey, s, from, to)) { if (!p.ok) break; out.push({ t: +timeOf(p.k).toFixed(3), x: p.x, y: p.y, w: s.w, h: s.h }); }
  };
  // before the first still and after the last: followed from it alone
  if (!entries[0].absent) followed(entries[0], frameOf(entries[0].t), first);
  if (!entries[entries.length - 1].absent) followed(entries[entries.length - 1], frameOf(entries[entries.length - 1].t), last);
  for (let i = 0; i + 1 < entries.length; i++) {
    const a = entries[i], b = entries[i + 1], ka = frameOf(a.t), kb = frameOf(b.t);
    if (kb - ka < 2 || (a.absent && b.absent)) continue;
    // next to a still without the face: as far as the frames show it
    if (b.absent) { followed(a, ka, kb); continue; }
    if (a.absent) { followed(b, kb, ka); continue; }
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
  const once = new Set();
  return result(out.filter((s) => (s.t >= start && s.t <= end) || s.seen).sort((p, q) => p.t - q.t || (q.seen ? 1 : 0) - (p.seen ? 1 : 0))
    .filter((s) => { const key = s.t.toFixed(2); if (once.has(key)) return false; once.add(key); return true; }), doubtful);
}

// two faces whose followed paths run into each other (one passes in front of the other): there
// the frames cannot tell them apart, and each path goes straight from the still before to the
// still after. `people`: the persons of one shot, their tracks filled in
export function uncross(people) {
  const box = (s) => [s.x - s.w / 2, s.y - s.h / 2, s.x + s.w / 2, s.y + s.h / 2];
  const iou = (a, b) => {
    const [a0, a1, a2, a3] = box(a), [b0, b1, b2, b3] = box(b);
    const ix = Math.max(0, Math.min(a2, b2) - Math.max(a0, b0)), iy = Math.max(0, Math.min(a3, b3) - Math.max(a1, b1));
    const i = ix * iy;
    return i / (a.w * a.h + b.w * b.h - i);
  };
  const crossing = new Map(people.map((p) => [p, new Set()]));
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
    const byT = new Map(people[j].track.filter((s) => !s.absent).map((s) => [s.t.toFixed(2), s]));
    for (const s of people[i].track) {
      const o = !s.absent && byT.get(s.t.toFixed(2));
      if (o && iou(s, o) > 0.2) { crossing.get(people[i]).add(s.t.toFixed(2)); crossing.get(people[j]).add(s.t.toFixed(2)); }
    }
  }
  for (const p of people) {
    const bad = crossing.get(p);
    if (!bad.size) continue;
    const seen = p.track.filter((s) => s.seen && !s.absent);
    p.track = p.track.map((s) => {
      if (s.seen || s.absent || !bad.has(s.t.toFixed(2))) return s;
      const a = [...seen].reverse().find((x) => x.t < s.t), b = seen.find((x) => x.t > s.t);
      if (!a || !b) return s;
      const f = (s.t - a.t) / (b.t - a.t);
      return { ...s, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, crossed: true };
    });
  }
  return people;
}
