// Finds burned-in captions in footage: text that is bright (or saturated yellow), sharp-edged,
// centred, and changes every second or so while staying in one horizontal band. A static logo
// or lower-third does not change, a face or shirt is not sharp-edged text.
//
//   detectBurnIn(video) → { band: [top, bottom] | null, rows: Float32Array }   (frame fractions)
//   node tools/burnin.mjs video.mp4   (prints the band)

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SW = 180, SH = 320; // analysis size (portrait); landscape footage is squeezed, fine for rows

function frames(video, fps) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", video, "-vf", `fps=${fps},scale=${SW}:${SH}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 30 });
  const n = Math.floor(raw.length / (SW * SH * 3));
  return Array.from({ length: n }, (_, k) => raw.subarray(k * SW * SH * 3, (k + 1) * SW * SH * 3));
}

// per frame: mask of "caption ink" pixels – bright/yellow next to a dark outline or shadow
function inkMask(f) {
  const L = new Float32Array(SW * SH), ink = new Uint8Array(SW * SH);
  for (let i = 0; i < SW * SH; i++) L[i] = 0.299 * f[i * 3] + 0.587 * f[i * 3 + 1] + 0.114 * f[i * 3 + 2];
  for (let y = 1; y < SH - 1; y++) {
    for (let x = 2; x < SW - 2; x++) {
      const i = y * SW + x, r = f[i * 3], g = f[i * 3 + 1], b = f[i * 3 + 2];
      const bright = L[i] > 200 || (r > 190 && g > 170 && b < 110); // white or caption yellow
      if (!bright) continue;
      // a sharp drop to dark within two pixels, horizontally or vertically
      const lo = Math.min(L[i - 2], L[i + 2], L[i - SW], L[i + SW]);
      if (L[i] - lo > 110) ink[i] = 1;
    }
  }
  return ink;
}

export function detectBurnIn(video, { fps = 3 } = {}) {
  const fs_ = frames(video, fps);
  const masks = fs_.map(inkMask);
  const rows = new Float32Array(SH);
  // a row scores when it holds centred ink that differs from the previous frame's (changing text)
  for (let k = 1; k < masks.length; k++) {
    const m = masks[k], p = masks[k - 1];
    for (let y = 0; y < SH; y++) {
      let changed = 0, inkN = 0;
      for (let x = Math.floor(SW * 0.1); x < Math.ceil(SW * 0.9); x++) {
        const i = y * SW + x;
        if (m[i]) { inkN++; if (!p[i]) changed++; }
      }
      if (inkN >= 3 && changed / inkN > 0.4) rows[y] += 1;
    }
  }
  for (let y = 0; y < SH; y++) rows[y] /= Math.max(1, masks.length - 1);
  // smooth a little, then the band: contiguous rows above a share of the peak, lower 40 % of the frame first
  const sm = rows.map((_, y) => (rows[Math.max(0, y - 1)] + rows[y] + rows[Math.min(SH - 1, y + 1)]) / 3);
  let peak = 0, py = -1;
  for (let y = Math.floor(SH * 0.35); y < Math.floor(SH * 0.95); y++) if (sm[y] > peak) { peak = sm[y]; py = y; }
  // temporary graphics (name tag, title card, hook box): sharp text that is on screen only for a
  // while; anything below mid-frame and above the captions must disappear under the shade too
  const present = new Float32Array(SH);
  for (const m of masks) for (let y = 0; y < SH; y++) {
    let n = 0;
    for (let x = Math.floor(SW * 0.1); x < Math.ceil(SW * 0.9); x++) n += m[y * SW + x];
    if (n >= 6) present[y] += 1 / masks.length;
  }
  const overlayTop = (limit) => {
    for (let y = Math.floor(SH * 0.5); y < limit - 3; y++) {
      if ([0, 1, 2, 3].every((d) => present[y + d] >= 0.05 && present[y + d] < 0.85)) return +(y / SH).toFixed(3);
    }
    return null;
  };
  if (peak < 0.12) return { band: null, overlay: overlayTop(Math.floor(SH * 0.92)), rows: sm, peak };
  const thr = peak * 0.25;
  let top = py, bot = py;
  // captions run one to three lines: allow small gaps between lines
  const gapOk = (y, dir) => { for (let d = 1; d <= 6; d++) { const yy = y + dir * d; if (yy < 0 || yy >= SH) return false; if (sm[yy] > thr) return true; } return false; };
  while (top > 0 && (sm[top - 1] > thr || gapOk(top, -1))) top--;
  while (bot < SH - 1 && (sm[bot + 1] > thr || gapOk(bot, 1))) bot++;
  return { band: [+(top / SH).toFixed(3), +((bot + 1) / SH).toFixed(3)], overlay: overlayTop(top), rows: sm, peak: +peak.toFixed(3) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const v of process.argv.slice(2)) {
    const r = detectBurnIn(v);
    console.log(`${v}: ${r.band ? `captions ${Math.round(r.band[0] * 100)}–${Math.round(r.band[1] * 100)} %` : "no burned-in captions"}${r.overlay ? `, graphics from ${Math.round(r.overlay * 100)} %` : ""} (peak ${r.peak})`);
  }
}
