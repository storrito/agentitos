// The zones of one or several platforms on a frame of a given size, in px of that frame.
//
//   zonesFor(ids, width, height)  → { frame, size, fallback, platforms, safe, wide, margins, covers, crops, notes, sources }
//   check(zones, box)             → what of the box leaves the safe box or the frame, an app covers, a crop cuts
//   resolve(name)                 → the platform an id or alias names
//
// A frame takes the numbers of the nearest frame a platform has measured (9:16, 4:5, 1:1, 16:9);
// one taller than 9:16 (a phone's 9:19.5) counts as 9:16. The apps size their buttons by the
// phone's width and pin them to the edges, so on a frame of another ratio than the measured one
// the zones keep their size and stick to their edge instead of stretching. A platform named for a
// frame it has no numbers for is replaced by the same app's view of that frame (Instagram's feed
// for Reels at 4:5), else by the frame's usual platforms.

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

// A box of the canvas onto the frame, along one axis: one that spans the canvas spans the frame;
// one at an edge stays at that edge; one in between stays at its distance from the edge its
// middle is nearer to. Its size is kept (times s) in every case.
function along(v, len, from, to, s) {
  if (v <= 0 && v + len >= from) return [0, to];
  const near = v <= 0 || (v + len < from && v + len / 2 <= from / 2);
  const a = near ? v * s : to - (from - v) * s;
  return [a, a + len * s];
}

function place(entry, width, height) {
  const [cw, ch] = entry.canvas;
  // the apps size their buttons by the phone's width (by the player's height in a wide frame)
  const s = cw < ch ? width / cw : height / ch;
  const m = entry.margins;
  // an entry of margins alone: the bottom is the app's (controls, caption), the top only when it
  // is more than a border, the right, when it is wider than the left, a column of buttons in the
  // lower half (where the apps that have one put it)
  const covers = entry.covers || [
    ...(m.top > 0.06 * ch ? [{ what: "the app's top bar", box: [0, 0, cw, m.top] }] : []),
    { what: "the app's controls and caption", box: [0, ch - m.bottom, cw, m.bottom] },
    ...(m.right > m.left + 40 ? [{ what: "the app's buttons on the right", box: [cw - m.right, ch / 2, m.right, ch / 2 - m.bottom] }] : []),
  ];
  const clip = ([x, y, w, h]) => {
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    return [x0, y0, Math.min(width, x + w) - x0, Math.min(height, y + h) - y0];
  };
  return {
    margins: { top: m.top * s, bottom: m.bottom * s, left: m.left * s, right: m.right * s },
    covers: covers.map((c) => {
      const [x, y, w, h] = c.box;
      const [x0, x1] = along(x, w, cw, width, s), [y0, y1] = along(y, h, ch, height, s);
      return { what: c.what, box: clip([x0, y0, x1 - x0, y1 - y0]) };
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
const family = (p) => p.id.split("-")[0];
const round = (b) => b.map((v) => Math.round(v));

export function zonesFor(ids, width, height) {
  const frame = frameOf(width, height);
  const notes = [];
  let fallback = false;
  let platforms = [...new Set(ids.map((id) => {
    const p = resolve(id);
    if (!p) throw new Error(`There is no platform "${id}": ${PLATFORMS.map((q) => q.id).join(", ")}.`);
    return p;
  }))];
  if (!platforms.length) {
    fallback = true;
    platforms = (DEFAULTS[frame] || []).map(resolve);
  }
  const parts = [];
  for (const p of platforms) {
    const entry = frame && p.frames[frame];
    if (entry) { parts.push({ p, entry }); continue; }
    const has = Object.keys(p.frames).join(", ");
    // the same app's view of this frame (Instagram's feed for a reel at 4:5, Shorts for YouTube at
    // 9:16), else the frame's usual platforms
    const sibling = frame && PLATFORMS.find((q) => q !== p && q.frames[frame] && family(q) === family(p));
    const stand = sibling ? [sibling] : frame ? DEFAULTS[frame].map(resolve) : [];
    notes.push(`${p.name} has numbers for ${has} only, not for this frame${frame ? ` (${frame})` : ""}: ${sibling ? `${sibling.name} stands in for it` : frame ? "the frame's usual platforms stand in for it" : "the broadcast border stands in for it"}.`);
    for (const q of stand) if (!parts.some((x) => x.p === q) && !platforms.includes(q)) parts.push({ p: q, entry: q.frames[frame], standIn: true });
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
    const same = crops.find((x) => x.ratio === c.ratio && x.where === c.where);
    if (same) same.platform += `, ${p.id}`;
    else crops.push({ platform: p.id, where: c.where, ratio: c.ratio, box: round(crop(c.ratio, width, height)) });
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

// What of a box (x, y, w, h in px) is clear: inside the safe box, or inside the wide stretch
// above the buttons' column; what leaves the frame, what an app covers, what a crop cuts away.
export function check(z, box) {
  const [W, H] = z.size;
  const area = box[2] * box[3];
  const inFrame = overlap(box, [0, 0, W, H]);
  const past = (b) => ({
    left: Math.max(0, b[0] - box[0]), top: Math.max(0, b[1] - box[1]),
    right: Math.max(0, box[0] + box[2] - (b[0] + b[2])), bottom: Math.max(0, box[1] + box[3] - (b[1] + b[3])),
  });
  const out = past(z.safe);
  const clear = (o) => Object.values(o).every((v) => v === 0);
  const inWide = !!z.wide && clear(past(z.wide));
  return {
    box,
    inside: clear(out) || inWide,
    inWide,
    outside: Object.fromEntries(Object.entries(out).filter(([, v]) => v > 0)),
    offFrame: 1 - inFrame / area,
    covered: z.covers.map((c) => ({ ...c, share: overlap(box, c.box) / area })).filter((c) => c.share > 0),
    // the share of the box, inside the frame, that the crop does not show
    cut: inFrame ? z.crops.map((c) => ({ ...c, share: 1 - overlap(box, c.box) / inFrame })).filter((c) => c.share > 0.001) : [],
  };
}
