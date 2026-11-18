// The cuts of a piece of footage, to the frame: hard cuts, and the wipes and dissolves that
// spread a change of shot over a few frames (a talk show's short push wipes). Read from every
// frame at the footage's own rate, shrunk to a small grey picture; no model.
//
// Over one frame, two, three, … up to 2.2 seconds, the picture before and after is compared: a
// change of shot is a stretch over which the picture changes far more (OVER_MOTION times) than
// over as many frames within the shots on either side, each stretch measured against its own
// neighbourhood, not one threshold for the whole clip. The smallest stretch that holds the change
// is it (one frame for a hard cut). A stretch whose two ends are the same picture moved a little
// is the camera panning; one that changes only part of the picture (someone standing up), or
// whose picture comes back within a second (a hand waved in front of the lens), is a movement.
// Those, and a change that is small, are only "possible": a cut only where a model watching the
// clip names one within a second of it. A flash inside one shot (white or black for a few
// frames, then the same picture) is no cut at all. Over a second and more only a dissolve counts
// (every frame between a blend of its two ends), and a fade through black is one cut in the
// black; a long dissolve is one cut where the new picture outweighs the old. A hard cut in dark
// footage counts from a smaller change, when nothing else moves. The cut is placed on the first frame of the stretch that looks more
// like the shot after it than like the shot before.

import { spawnSync } from "node:child_process";

export const SMALL_W = 64, SMALL_H = 36;
// the spans (in frames) a change of shot is looked for over: one frame for a hard cut, up to
// LONGEST seconds for a dissolve or a fade
const SPANS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 36, 48, 64], LONGEST = 2.2;
// a hard cut: the frame differs from the one before by at least HARD (mean grey levels of 255);
// over more frames a change is sure from SURE, possible from POSSIBLE; and always OVER_MOTION
// times more than as many frames change within the shots on either side
const HARD = 12, SURE = 35, POSSIBLE = 9, OVER_MOTION = 2.2;
// a hard cut in dark footage: at least DARK, and DARK_OVER times more than the frames beside it
// (the reviewer's dark cut: 7.4 against 0.1)
const DARK = 4, DARK_OVER = 15, DIM = 40;
// a frame inside a long dissolve differs from a blend of its two ends by at most this share of the change
const BLEND = 0.15;
// a change over several frames is sure only when its least changed third changed at least this
// share of the whole change (true wipes and dissolves: 0.5 and more; a person standing up: 0.05)
const SPREAD = 0.3;
// a picture is the same again when it differs by less than this share of the change
const BACK = 0.35;
// a picture after a flash is the one before when the two correlate this much (one shot: 0.70;
// a hard cut between two shots of the same person: 0.62)
const SAME_LOOK = 0.66;

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

const mean = (f) => f.reduce((n, v) => n + v, 0) / f.length;

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
    if (k >= n || k > LONGEST * fps) break;
    // how much the picture changes over k frames, ending at each frame
    const D = new Float64Array(n);
    for (let i = k; i < n; i++) D[i] = diff(frames[i - k], frames[i]);
    const passing = [];
    const dark = new Set();
    for (let i = k; i < n; i++) {
      const beside = Math.max(i - k >= k ? D[i - k] : 0, i + k < n ? D[i + k] : 0);
      if (k === 1 && D[i] < HARD && D[i] >= DARK && D[i] >= DARK_OVER * beside + 1 && mean(frames[i - 1]) < DIM && mean(frames[i]) < DIM && spread(frames[i - 1], frames[i]) >= SPREAD * D[i]) { passing.push(i); dark.add(i); continue; }
      if (D[i] < (k === 1 ? HARD : POSSIBLE)) continue;
      // as many frames within the shots on either side change far less
      if (D[i] < OVER_MOTION * beside + 1) continue;
      passing.push(i);
    }
    for (const i of passing) {
      // the most change of those near it
      if (passing.some((j) => j !== i && Math.abs(j - i) < k + 1 && (D[j] > D[i] || (D[j] === D[i] && j < i)))) continue;
      const s = i - k + 1;
      // already found over fewer frames (a longer stretch that is sure takes the place of a
      // shorter one that is only possible: a long dissolve)
      const over = found.filter((c) => c.from <= i && c.to >= s);
      if (over.some((c) => c.sure)) continue;
      const before = frames[s - 1], after = frames[i];
      // over a second and more only a dissolve or a fade counts: every frame between a blend of
      // the two ends (a moving picture changes as much over that long)
      if (k >= 24 && !blends(frames, s, i, D[i])) continue;
      let at = s;
      while (at < i && diff(frames[at], after) >= diff(frames[at], before)) at++;
      const moved = k > 1 && shifted(before, after) < 0.5 * D[i];
      // over several frames a cut changes the whole picture: a hand, a person standing up changes
      // a part of it (the least changed third of the picture's cells barely changes)
      const part = k > 1 && spread(before, after) < SPREAD * D[i];
      // and keeps it changed: a hand waved in front of the lens is gone again within a second
      const back = k > 1 && returns(frames, s - 1, i, fps, D[i]);
      const sure = !moved && !part && !back && (D[i] >= (k === 1 ? HARD : SURE) || dark.has(i));
      // only a dissolve over a second takes the place of what was found over fewer frames
      if (over.length && (!sure || k < 24)) continue;
      for (const c of over) found.splice(found.indexOf(c), 1);
      found.push({ frame: at, from: s, to: i, change: +D[i].toFixed(1), sure });
    }
  }
  return flashesOut(found.sort((a, b) => a.frame - b.frame), frames, fps);
}

// are the frames from..to-1 blends of the frame before `from` and frame `to`, within BLEND of the
// change? (a few of them checked)
function blends(frames, from, to, change) {
  const A = frames[from - 1], B = frames[to];
  for (let m = from; m < to; m += Math.max(1, Math.floor((to - from) / 6))) {
    const M = frames[m];
    let best = Infinity;
    for (let w = 0; w <= 1.0001; w += 0.1) {
      let d = 0;
      for (let p = 0; p < M.length; p++) d += Math.abs(M[p] - (w * A[p] + (1 - w) * B[p]));
      best = Math.min(best, d / M.length);
    }
    if (best > BLEND * change) return false;
  }
  return true;
}

// does the picture before frame `from` come back within a second after frame `to`?
function returns(frames, from, to, fps, change) {
  for (let k = to + 1; k < Math.min(frames.length, to + 1 + fps); k++) if (diff(frames[from], frames[k]) < BACK * change) return true;
  return false;
}

// two changes within a second, after which the picture is the one before the first: a frame
// or two of something else inside one shot, or a flash (white or black between, the picture
// after the same as before but for its brightness). Neither is a cut; a flash between two
// different pictures is one cut, at its peak
export function likeness(a, b) {
  const ma = mean(a), mb = mean(b);
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; ab += x * y; aa += x * x; bb += y * y; }
  return ab / Math.sqrt(aa * bb + 1e-9);
}
function flashesOut(cuts, frames, fps) {
  const out = [];
  for (let k = 0; k < cuts.length; k++) {
    const a = cuts[k], b = cuts[k + 1];
    // a fade through black takes up to twice the longest dissolve, a flash a second
    const throughBlack = b && Math.min(...frames.slice(a.from, b.to).map(mean)) < 16;
    if (b && b.frame - a.frame <= (throughBlack ? 2 * LONGEST : 1) * fps) {
      const before = frames[a.from - 1], after = frames[b.to];
      const same = diff(before, after) < BACK * Math.min(a.change, b.change);
      const between = frames.slice(a.from, b.from + 1).map(mean), lit = Math.max(...between), dark = Math.min(...between);
      const flash = (lit > 200 && mean(before) < 180 && mean(after) < 180) || (dark < 16 && mean(before) > 30 && mean(after) > 30);
      if ((same && b.frame - a.frame <= fps) || (flash && likeness(before, after) >= SAME_LOOK)) { k++; continue; }
      // a flash between two pictures: one cut, at its brightest (or darkest) frame
      if (flash) {
        // the middle of its brightest (or darkest) stretch
        const top = lit > 200 ? lit : dark, near = between.map((v, j) => (Math.abs(v - top) <= 2 ? j : -1)).filter((j) => j >= 0);
        const peak = a.from + near[Math.floor(near.length / 2)];
        out.push({ frame: peak, from: a.from, to: b.to, change: Math.max(a.change, b.change), sure: a.sure || b.sure });
        k++;
        continue;
      }
    }
    out.push(a);
  }
  return out;
}

// how much the least changed third of the picture changed: the 30th percentile of the mean
// difference of 8×6 cells
export function spread(a, b) {
  const cw = SMALL_W / 8, ch = SMALL_H / 6, cells = [];
  for (let cy = 0; cy < 6; cy++) for (let cx = 0; cx < 8; cx++) {
    let sum = 0, n = 0;
    for (let y = cy * ch; y < (cy + 1) * ch; y++) for (let x = cx * cw; x < (cx + 1) * cw; x++) { sum += Math.abs(a[y * SMALL_W + x] - b[y * SMALL_W + x]); n++; }
    cells.push(sum / n);
  }
  cells.sort((p, q) => p - q);
  return cells[Math.floor(0.3 * (cells.length - 1))];
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
