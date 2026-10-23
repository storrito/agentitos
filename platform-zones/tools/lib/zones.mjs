// The zones of one or several platforms on a frame of a given size, in px of that frame.
//
//   zonesFor(ids, width, height)  → { frame, size, platforms, fallback, safe, covers, crops, notes, bases, sources }
//   check(zones, box)             → what of the box a platform covers, leaves the safe box, or a crop cuts
//   resolve(name)                 → the platform an id or alias names
//
// A frame takes the numbers of the nearest frame a platform has measured (9:16, 4:5, 1:1, 16:9);
// one taller than 9:16 (a phone's 9:19.5) counts as 9:16. The apps size their buttons by the
// phone's width and pin them to the edges, so on a frame of another ratio than the measured one
// the zones keep their size and stick to their edge instead of stretching.

import { PLATFORMS, DEFAULTS, GENERIC } from "./platforms.mjs";

const ratio = (r) => { const [a, b] = r.split(":").map(Number); return a / b; };
const FRAMES = Object.keys(DEFAULTS);
// within 15 % of a measured ratio: 3:4 takes 4:5's numbers, 2:3 and 21:9 none
const NEAR = Math.log(1.15);

export function frameOf(width, height) {
  const r = width / height;
  if (r <= ratio("9:16") && r > 0.4) return "9:16";
  let best = null, d = Infinity;
  for (const f of FRAMES) {
    const e = Math.abs(Math.log(r / ratio(f)));
    if (e < d) [best, d] = [f, e];
  }
  return d <= NEAR ? best : null;
}

export function resolve(name) {
  const k = String(name).toLowerCase();
  return PLATFORMS.find((p) => p.id === k || p.aliases?.includes(k)) || null;
}

// a coordinate of the canvas onto the frame: kept at its distance from the nearer edge
const along = (v, from, to, s) => (v <= from / 2 ? v * s : to - (from - v) * s);

function place(entry, width, height) {
  const [cw, ch] = entry.canvas;
  const s = Math.min(width / cw, height / ch);
  const m = entry.margins;
  // an entry of margins alone: the bottom is the app's (controls, caption), the top only when it
  // is more than a border, the right when it is wider than the left (the buttons' column)
  const covers = entry.covers || [
    ...(m.top > 0.06 * ch ? [{ what: "the app's top bar", box: [0, 0, cw, m.top] }] : []),
    { what: "the app's controls and caption", box: [0, ch - m.bottom, cw, m.bottom] },
    ...(m.right > m.left + 40 ? [{ what: "the app's buttons on the right", box: [cw - m.right, m.top, m.right, ch - m.top - m.bottom] }] : []),
  ];
  return {
    margins: { top: m.top * s, bottom: m.bottom * s, left: m.left * s, right: m.right * s },
    covers: covers.map((c) => {
      const [x, y, w, h] = c.box;
      const x0 = along(x, cw, width, s), x1 = along(x + w, cw, width, s);
      const y0 = along(y, ch, height, s), y1 = along(y + h, ch, height, s);
      return { what: c.what, box: [x0, y0, x1 - x0, y1 - y0] };
    }),
  };
}

// the biggest box of the ratio in the middle of the frame
function crop(r, width, height) {
  const want = ratio(r);
  if (width / height > want) { const w = height * want; return [(width - w) / 2, 0, w, height]; }
  const h = width / want;
  return [0, (height - h) / 2, width, h];
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const reduced = (w, h) => `${w / gcd(w, h)}:${h / gcd(w, h)}`;
const round = (b) => b.map((v) => Math.round(v));

export function zonesFor(ids, width, height) {
  const frame = frameOf(width, height);
  const notes = [];
  let fallback = false;
  let platforms = ids.map((id) => {
    const p = resolve(id);
    if (!p) throw new Error(`There is no platform "${id}": ${PLATFORMS.map((q) => q.id).join(", ")}.`);
    return p;
  });
  if (!platforms.length) {
    fallback = true;
    platforms = (DEFAULTS[frame] || []).map(resolve);
  }
  const parts = [];
  for (const p of platforms) {
    const entry = frame && p.frames[frame];
    if (entry) { parts.push({ p, entry }); continue; }
    const has = Object.keys(p.frames).join(", ");
    notes.push(`${p.name} has numbers for ${has} only, not for this frame${frame ? ` (${frame})` : ""}: ${frame ? "the frame's usual platforms stand in for it" : "the broadcast border stands in for it"}.`);
    if (frame) for (const q of DEFAULTS[frame].map(resolve)) if (!parts.some((x) => x.p === q) && !platforms.includes(q)) parts.push({ p: q, entry: q.frames[frame], standIn: true });
  }
  const placed = parts.map(({ p, entry, standIn }) => ({ p, entry, standIn, ...place(entry, width, height) }));
  if (!placed.length) {
    const g = GENERIC.margins;
    placed.push({
      p: { id: "generic", name: "any player" }, entry: GENERIC,
      margins: { top: g.top * height, bottom: g.bottom * height, left: g.left * width, right: g.right * width },
      covers: [{ what: "a player's controls", box: [0, height * (1 - g.bottom), width, height * g.bottom] }],
    });
  }
  const m = { top: 0, bottom: 0, left: 0, right: 0 };
  for (const z of placed) for (const k in m) m[k] = Math.max(m[k], z.margins[k]);
  const crops = [];
  for (const { p, entry } of placed) for (const c of entry.crops || []) {
    if (!crops.some((x) => x.ratio === c.ratio && x.where === c.where)) crops.push({ platform: p.id, where: c.where, ratio: c.ratio, box: round(crop(c.ratio, width, height)) });
  }
  for (const { p, entry } of placed) if (entry.note) notes.push(p.id === "generic" ? entry.note : `${p.name}: ${entry.note}`);
  // above the buttons' column on the right the frame is clear from the left margin to the right
  // one's mirror: room for something wide at the top of a vertical video
  const column = placed.flatMap((z) => z.covers).filter((c) => c.box[0] > width / 2 && c.box[0] + c.box[2] >= width - 1 && c.box[2] < width / 2);
  const under = column.length ? Math.min(...column.map((c) => c.box[1])) : null;
  const wide = under !== null && under - m.top > 0.1 * height && m.right > m.left + 40
    ? round([m.left, m.top, width - 2 * m.left, under - m.top]) : null;
  return {
    frame: frame || reduced(width, height), size: [width, height], fallback,
    platforms: placed.map(({ p, entry, standIn }) => ({ id: p.id, name: p.name, basis: entry.basis, ...(standIn ? { standIn: true } : {}) })),
    safe: round([m.left, m.top, width - m.left - m.right, height - m.top - m.bottom]),
    wide,
    margins: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v)])),
    covers: placed.flatMap(({ p, covers }) => covers.map((c) => ({ platform: p.id, what: c.what, box: round(c.box) }))),
    crops,
    notes,
    sources: [...new Set(placed.flatMap(({ entry }) => entry.sources || []))],
  };
}

const overlap = (a, b) => {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
};

export function check(z, box) {
  const area = box[2] * box[3];
  const [sx, sy, sw, sh] = z.safe;
  const out = {
    left: Math.max(0, sx - box[0]), top: Math.max(0, sy - box[1]),
    right: Math.max(0, box[0] + box[2] - (sx + sw)), bottom: Math.max(0, box[1] + box[3] - (sy + sh)),
  };
  return {
    box,
    inside: Object.values(out).every((v) => v === 0),
    outside: Object.fromEntries(Object.entries(out).filter(([, v]) => v > 0)),
    covered: z.covers.map((c) => ({ ...c, share: overlap(box, c.box) / area })).filter((c) => c.share > 0),
    cut: z.crops.map((c) => ({ ...c, share: 1 - overlap(box, c.box) / area })).filter((c) => c.share > 0.001),
  };
}
