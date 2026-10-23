// Where and how much a source's picture changes, four times a second over the whole recording:
// the share of pixels that differ from the frame before by more than a little, and the box
// around them. A cursor, a click, typing, a page that loads count; a camera's noise does not.
// What changes tells which source is worth showing, its box where to zoom in.
//
//   measure(file, offset, size) → [{ t, c, b, g }]   t on the recording's timeline, c the share
//   of changed pixels, b their box in 0–1 of the frame (null when nothing changes), g the changed
//   cells of a grid of 32 columns ([cell, pixels], cell = row * 32 + column) and r its rows

import { execFileSync } from "node:child_process";

export const RATE = 4; // samples a second
const WIDTH = 320;
const STEP = 14; // grey levels a pixel must change by
export const MOVING = 0.002; // the share of changed pixels from which the picture moves
// the share from which something happens on a screen at all: typing changes 0.05–0.2 % of a
// screen's pixels a frame, a screen that stands still (a blinking caret) about 0.01 %
export const ACTIVE = 0.0004;

// cells of the grid that count the changes; a cell that changes in more than NOISY of the frames
// around (WINDOW seconds either side) shows something that always moves (a webcam's preview in
// the corner of the screen, a clock, a spinner): it neither makes the screen busy nor pulls the
// zoom
const COLS = 32, NOISY = 0.6, CELL_MIN = 3, WINDOW = 10;

// The grid a source is measured on: 320 px wide, rows of square cells, and the ffmpeg filter
// that makes its grey frames.
export function grid({ width, height }) {
  const h = Math.max(2, Math.round((WIDTH * height) / width / 2) * 2);
  const cw = WIDTH / COLS, rows = Math.max(1, Math.round(h / cw));
  return { h, size: WIDTH * h, rows, cells: COLS * rows, ch: h / rows, cw, filter: `fps=${RATE},scale=${WIDTH}:${h},format=gray` };
}

// Grey frames as they stream from ffmpeg (push the chunks of its output) to the changed pixels of
// each cell, frame after frame: only the frame before is kept, so a long recording takes no more
// memory than a short one.
export function differ(g) {
  const counts = [];
  let prev = null, cur = Buffer.alloc(g.size), fill = 0;
  const frame = () => {
    if (prev) {
      const n = new Uint16Array(g.cells);
      for (let y = 0; y < g.h; y++) {
        const row = Math.min(g.rows - 1, Math.floor(y / g.ch)) * COLS, o = y * WIDTH;
        for (let x = 0; x < WIDTH; x++) {
          if (Math.abs(prev[o + x] - cur[o + x]) > STEP) n[row + Math.min(COLS - 1, Math.floor(x / g.cw))]++;
        }
      }
      counts.push(n);
    }
    [prev, cur] = [cur, prev || Buffer.alloc(g.size)];
    fill = 0;
  };
  return {
    push(chunk) {
      let at = 0;
      while (at < chunk.length) {
        const take = Math.min(g.size - fill, chunk.length - at);
        chunk.copy(cur, fill, at, at + take);
        fill += take; at += take;
        if (fill === g.size) frame();
      }
    },
    counts,
  };
}

// The samples of a source from its cells' counts, on the recording's timeline (the source
// starting at `offset`): what changed, where, and which cells; a cell that changes in most
// frames around always moves and does not count, nor do the cells in `ignore` (a webcam's
// preview inside the screen, see mirrors).
export function samplesOf(counts, g, offset, ignore = new Set()) {
  const { rows, cells, size } = g;
  // how many of the frames up to each one a cell changed in, to count a window at once
  const sums = [new Uint32Array(cells)];
  for (const n of counts) {
    const next = Uint32Array.from(sums.at(-1));
    for (let c = 0; c < cells; c++) if (n[c] >= CELL_MIN) next[c]++;
    sums.push(next);
  }
  const reach = WINDOW * RATE;
  return counts.map((n, i) => {
    const a = Math.max(0, i - reach), b = Math.min(counts.length, i + reach + 1), span = b - a;
    let changed = 0, c0 = COLS, r0 = rows, c1 = -1, r1 = -1;
    const g = [];
    for (let c = 0; c < cells; c++) {
      if (n[c] < CELL_MIN || ignore.has(c) || sums[b][c] - sums[a][c] > NOISY * span) continue;
      changed += n[c];
      g.push([c, n[c]]);
      const col = c % COLS, row = Math.floor(c / COLS);
      if (col < c0) c0 = col;
      if (col > c1) c1 = col;
      if (row < r0) r0 = row;
      if (row > r1) r1 = row;
    }
    const share = changed / size;
    const on = share >= ACTIVE;
    return { t: +(offset + (i + 1) / RATE).toFixed(2), c: +share.toFixed(5),
      b: on ? [c0 / COLS, r0 / rows, (c1 + 1) / COLS, (r1 + 1) / rows].map((v) => +v.toFixed(3)) : null,
      ...(on ? { g, r: rows } : {}) };
  });
}

// The cells of a screen that show the webcam: a preview of the camera inside the recorded page
// (rragent's recorder shows one) changes when the person moves, so its cells change in step with
// the webcam's own picture. Each cell that changes in at least 5 % of the frames is compared with
// the webcam's change over time (Pearson's r, at the same moment of the recording); r over 0.4 is
// a mirror. Such cells fidget all the time and would pull the zoom to the corner.
export function mirrors(counts, offset, webcam) {
  if (!webcam?.length || !counts.length) return new Set();
  const cam = new Map(webcam.map((s) => [Math.round(s.t * RATE), s.c]));
  const at = counts.map((_, i) => cam.get(Math.round((offset + (i + 1) / RATE) * RATE)));
  const cells = counts[0].length, out = new Set();
  for (let c = 0; c < cells; c++) {
    let k = 0, on = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < counts.length; i++) {
      const y = at[i];
      if (y === undefined) continue;
      const x = counts[i][c];
      if (x >= CELL_MIN) on++;
      k++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    }
    if (k < 20 || on < 0.05 * k) continue;
    const r = (k * sxy - sx * sy) / Math.sqrt((k * sxx - sx * sx) * (k * syy - sy * sy) || 1);
    if (r > 0.4) out.add(c);
  }
  return out;
}

// The moments a screen changes almost whole (another tab, a new page, a dialog that dims the
// page): a share of changed pixels over SCENE, those under a second apart taken as one.
export const SCENE = 0.25;
export function scenes(samples, from, to) {
  const cuts = [];
  for (const s of within(samples, from, to)) {
    if (s.c < SCENE) continue;
    if (cuts.length && s.t - cuts.at(-1) < 1) continue;
    cuts.push(s.t);
  }
  return cuts;
}

// a video file measured on its own (prepare measures while it converts)
export function measure(file, offset, size) {
  const g = grid(size);
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-an", "-vf", g.filter, "-f", "rawvideo", "-"], { maxBuffer: 2 ** 31, stdio: ["ignore", "pipe", "ignore"] });
  const d = differ(g);
  d.push(raw);
  return samplesOf(d.counts, g, offset);
}

const within = (samples, from, to) => samples.filter((s) => s.t > from && s.t <= to + 1e-6);

// how much a source moves in a span: the mean share of changed pixels
export function level(samples, from, to) {
  const s = within(samples, from, to);
  return s.length ? s.reduce((t, x) => t + x.c, 0) / s.length : 0;
}

// the share of a span's samples in which something happens on the source (typing counts)
export function busy(samples, from, to, threshold = ACTIVE) {
  const s = within(samples, from, to);
  return s.length ? s.filter((x) => x.c >= threshold).length / s.length : 0;
}

// The spans in which the picture moves (samples over `threshold`), runs less than two seconds
// apart joined (the steps of one action), a quarter of a second added around each, within
// from–to.
export function moving(samples, from, to, threshold = MOVING) {
  const spans = [];
  for (const s of within(samples, from, to)) {
    if (s.c < threshold) continue;
    const a = s.t - 1 / RATE - 0.25, b = s.t + 0.25, last = spans.at(-1);
    if (last && a - last.to < 2) last.to = b;
    else spans.push({ from: a, to: b });
  }
  return spans.map((s) => ({ from: Math.max(from, s.from), to: Math.min(to, s.to) })).filter((s) => s.to - s.from > 0);
}

// Where a span's changes are: { box, centre, heat }. The heat of a cell of the grid is how much
// it changed in the frames it changed in, on average: what appears at once (an answer, a page
// loading, typed words) changes a cell a lot in a few frames, what fidgets (a webcam's preview
// inside the screen, a ticking timer) a little in many; summed over a cell, the fidgeting won.
// The box holds the hottest cells that make up 80 % of it, the centre is its weighted middle.
// null when nothing changes.
export function focus(samples, from, to) {
  const s = within(samples, from, to).filter((x) => x.g?.length);
  if (!s.length) return null;
  const rows = s[0].r, heat = new Float64Array(COLS * rows), times = new Uint32Array(COLS * rows);
  for (const x of s) for (const [c, n] of x.g) { heat[c] += n; times[c]++; }
  for (let c = 0; c < heat.length; c++) if (times[c]) heat[c] /= times[c];
  const total = heat.reduce((t, v) => t + v, 0);
  if (!total) return null;
  const order = [...heat.keys()].filter((c) => heat[c] > 0).sort((a, b) => heat[b] - heat[a]);
  let acc = 0, c0 = COLS, r0 = rows, c1 = -1, r1 = -1, cx = 0, cy = 0;
  for (const c of order) {
    if (acc >= 0.8 * total) break;
    acc += heat[c];
    const col = c % COLS, row = Math.floor(c / COLS);
    c0 = Math.min(c0, col); c1 = Math.max(c1, col); r0 = Math.min(r0, row); r1 = Math.max(r1, row);
  }
  for (let c = 0; c < heat.length; c++) { cx += ((c % COLS) + 0.5) * heat[c]; cy += (Math.floor(c / COLS) + 0.5) * heat[c]; }
  return { box: [c0 / COLS, r0 / rows, (c1 + 1) / COLS, (r1 + 1) / rows], centre: [cx / total / COLS, cy / total / rows], heat: { cells: heat, cols: COLS, rows } };
}

// Where a crop of w × h (0–1 of the frame) holds the most of the heat: its left and top, on the
// grid's steps, inside the frame; of the places that hold nearly as much (97 %), the one whose
// middle is nearest to `centre`, so that what changed is not at the crop's edge.
export function hottest(heat, w, h, centre) {
  const { cells, cols, rows } = heat;
  const places = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const x = Math.min(c / cols, 1 - w), y = Math.min(r / rows, 1 - h);
      let sum = 0;
      for (let k = 0; k < cells.length; k++) {
        if (!cells[k]) continue;
        const mx = ((k % cols) + 0.5) / cols, my = (Math.floor(k / cols) + 0.5) / rows;
        if (mx >= x && mx <= x + w && my >= y && my <= y + h) sum += cells[k];
      }
      places.push({ x, y, sum });
    }
  }
  const most = Math.max(...places.map((p) => p.sum));
  const near = places.filter((p) => p.sum >= 0.97 * most);
  const off = (p) => (centre ? Math.hypot(p.x + w / 2 - centre[0], p.y + h / 2 - centre[1]) : 0);
  return near.sort((a, b) => off(a) - off(b))[0];
}
