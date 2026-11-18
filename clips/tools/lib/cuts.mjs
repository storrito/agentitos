// The cuts of a piece of footage, to the frame: hard cuts, and the wipes and dissolves that
// spread a change of shot over a few frames (a talk show's short push wipes). Read from every
// frame at the footage's own rate, shrunk to a small grey picture; no model.
//
// Over one frame, two, three, … up to a second, the picture before and after is compared: a
// change of shot is a stretch over which the picture changes far more (OVER_MOTION times) than
// over as many frames within the shots on either side, each stretch measured against its own
// neighbourhood, not one threshold for the whole clip. The smallest stretch that holds the change
// is it (one frame for a hard cut). A stretch whose two ends are the same picture moved a little
// is the camera panning. A change that is small (a gesture, a turn of the head changes as many
// frames as fast, but less) is only "possible": a cut only where a model watching the clip names
// one within a second of it. The cut is placed on the first frame of the stretch that looks more
// like the shot after it than like the shot before.

import { spawnSync } from "node:child_process";

export const SMALL_W = 64, SMALL_H = 36;
// the spans (in frames) a change of shot is looked for over: one frame for a hard cut, up to a
// second for a dissolve
const SPANS = [1, 2, 3, 4, 6, 8, 12, 16, 24];
// a hard cut: the frame differs from the one before by at least HARD (mean grey levels of 255);
// over more frames a change is sure from SURE, possible from POSSIBLE; and always OVER_MOTION
// times more than as many frames change within the shots on either side
const HARD = 12, SURE = 35, POSSIBLE = 9, OVER_MOTION = 2.2;

// every frame of the video as a small grey picture, in the order shown, none doubled or left out;
// `frames.times` holds each frame's own time (seconds from the file's start, as ffmpeg's filters
// count): footage of a variable frame rate has no fixed step between them
export function smallFrames(video) {
  // -fps_mode from ffmpeg 5.1, -vsync before it
  const read = (mode) => spawnSync("ffmpeg", ["-v", "info", "-nostats", "-i", video, "-an", "-sn", ...mode,
    "-vf", `showinfo,scale=${SMALL_W}:${SMALL_H}:flags=area,format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 30, encoding: "buffer" });
  let r = read(["-fps_mode", "passthrough"]);
  if (r.status !== 0) r = read(["-vsync", "passthrough"]);
  if (r.status !== 0) throw new Error(`ffmpeg could not read the frames of ${video}: check that the file plays (ffprobe ${video}), else cut it again.`);
  const size = SMALL_W * SMALL_H, n = Math.floor(r.stdout.length / size);
  const frames = Array.from({ length: n }, (_, i) => r.stdout.subarray(i * size, (i + 1) * size));
  const times = [...String(r.stderr).matchAll(/Parsed_showinfo.*?pts_time:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  frames.times = times.length === n ? times : null;
  return frames;
}

export function diff(a, b) {
  let d = 0;
  for (let k = 0; k < a.length; k++) d += Math.abs(a[k] - b[k]);
  return d / a.length;
}

// the changes of shot: [{ frame, from, to, change, sure }], `frame` the first frame of the new
// shot, from..to the frames the change took (one for a hard cut), `sure` false for a change that
// may as well be a gesture or the camera moving
export function findCuts(frames, fps) {
  const n = frames.length;
  if (n < 3) return [];
  const found = [];
  for (const k of SPANS) {
    if (k >= n) break;
    // how much the picture changes over k frames, ending at each frame
    const D = new Float64Array(n);
    for (let i = k; i < n; i++) D[i] = diff(frames[i - k], frames[i]);
    const passing = [];
    for (let i = k; i < n; i++) {
      if (D[i] < (k === 1 ? HARD : POSSIBLE)) continue;
      // as many frames within the shots on either side change far less
      if (D[i] < OVER_MOTION * Math.max(i - k >= k ? D[i - k] : 0, i + k < n ? D[i + k] : 0) + 1) continue;
      passing.push(i);
    }
    for (const i of passing) {
      // the most change of those near it
      if (passing.some((j) => j !== i && Math.abs(j - i) < k + 1 && (D[j] > D[i] || (D[j] === D[i] && j < i)))) continue;
      const s = i - k + 1;
      // already found over fewer frames
      if (found.some((c) => c.from <= i && c.to >= s)) continue;
      const before = frames[s - 1], after = frames[i];
      let at = s;
      while (at < i && diff(frames[at], after) >= diff(frames[at], before)) at++;
      const moved = k > 1 && shifted(before, after) < 0.5 * D[i];
      found.push({ frame: at, from: s, to: i, change: +D[i].toFixed(1), sure: !moved && D[i] >= (k === 1 ? HARD : SURE) });
    }
  }
  return found.sort((a, b) => a.frame - b.frame);
}

// the least difference between two small frames when one is moved by up to SHIFT pixels: small
// when the picture only moved (a pan), large when it is another picture
const SHIFT = 6;
export function shifted(a, b) {
  let best = Infinity;
  for (let dy = -SHIFT; dy <= SHIFT; dy += 2) for (let dx = -SHIFT; dx <= SHIFT; dx++) {
    let sum = 0, count = 0;
    for (let y = Math.max(0, -dy); y < Math.min(SMALL_H, SMALL_H - dy); y++) {
      for (let x = Math.max(0, -dx); x < Math.min(SMALL_W, SMALL_W - dx); x++) {
        sum += Math.abs(a[y * SMALL_W + x] - b[(y + dy) * SMALL_W + x + dx]);
        count++;
      }
    }
    if (count && sum / count < best) best = sum / count;
  }
  return best;
}

// the cuts kept: the sure ones, and a possible one where a model named a cut within a second
// (`times`: the frames' own times, else frame / fps)
export function confirmed(cuts, fps, named = [], times = null) {
  const at = (f) => (times ? times[f] : f / fps);
  return cuts.filter((c) => c.sure || named.some((t) => Math.abs(t - at(c.frame)) <= 1));
}

// the shots between the cuts, none shorter than `shortest` frames (a cut that close to another
// or to an end of the clip goes: its frames join the shot before). Times are the borders between
// frames: a shot from its first frame's time minus half a frame (0 for the first) to the next
// shot's start. `start` is the time of the video's first frame; `times`, each frame's own time,
// puts the borders between frames where they are (a variable frame rate)
export function shotsBetween(cuts, frameCount, fps, { start = 0, shortest = 6, times = null } = {}) {
  const at = [...new Set(cuts.map((c) => c.frame ?? c))].filter((f) => f > 0 && f < frameCount).sort((a, b) => a - b);
  // the last frame of the change that brings each shot in (a wipe's)
  const done = Object.fromEntries(cuts.filter((c) => c.to != null).map((c) => [c.frame, c.to]));
  // and the first frame of the change that takes it out
  const begins = Object.fromEntries(cuts.filter((c) => c.from != null).map((c) => [c.frame, c.from]));
  // of two cuts too close together the sure one stays (else the first)
  const sure = new Set(cuts.filter((c) => c.sure !== false).map((c) => c.frame ?? c));
  const kept = [0];
  for (const f of at) {
    if (frameCount - f < shortest) continue;
    const prev = kept[kept.length - 1];
    if (f - prev >= shortest) kept.push(f);
    else if (prev > 0 && sure.has(f) && !sure.has(prev)) kept[kept.length - 1] = f;
  }
  // a frame's time, and the border halfway between a frame and the one before it
  const ok = times && times.length === frameCount;
  const time = (f) => (ok ? times[Math.min(f, frameCount - 1)] + (f >= frameCount ? 1 / fps : 0) : start + f / fps);
  const border = (f) => +(f === 0 ? 0 : ok ? (times[f - 1] + times[f]) / 2 : start + (f - 0.5) / fps).toFixed(4);
  const after = (f) => +(ok ? (times[f] + (times[f + 1] ?? times[f] + 1 / fps)) / 2 : start + (f + 0.5) / fps).toFixed(4);
  return kept.map((f, k) => {
    const next = kept[k + 1] ?? frameCount;
    return { first: f, last: next - 1, start: border(f), end: next === frameCount ? +time(frameCount).toFixed(4) : border(next),
      ...(done[f] > f ? { settled: after(done[f]) } : {}),
      ...(begins[next] < next ? { leaving: border(begins[next]) } : {}) };
  });
}
