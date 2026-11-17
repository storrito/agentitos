// What the solver assumes where nobody says otherwise, and the ranking's weights.
//
//   DEFAULTS              sizes of text, margins around a face, search steps: in px of the frame
//                         or as a share of the face. `--set caption.font.tall=60` changes one for
//                         one run. None of them is a zone: those come from platform-zones.
//   readWeights(file)     the ranking's terms from a weights file (tools/weights.json: every term
//                         { value, says }), as their values; DEFAULTS.weights holds the skill's own
//   merged(base, over)    base with { "dotted.key": value } laid over it
//   scaled(D, size)       the defaults for a frame of that size: what is in px grows and shrinks
//                         with the frame

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Every size in px here is for a frame 1080 px on its shorter side (1080×1920, 1080×1350,
// 1080×1080, 1920×1080): `scaled` brings it to the frame asked for.
export const DEFAULTS = {
  // Captions: N lines, centred on the frame and as wide as `centred` (at most maxEm), or in a
  // column beside a face. Their area holds what agentitos' captions builds into it: lines 1.32 em
  // apart (its widest style sets them 1.3 apart) and, around them, the padding of a style's box:
  // padEm is the 0.22 em above and below of its style `clean`, the largest of its styles. Without
  // it the built box left the area at the top by a fifth of a line. A caller whose style pads
  // more says so: --set caption.padEm=0.6.
  //   font.tall  type in upright frames: a line 4.0 % of a 9:16 frame's height, the median of
  //              the captions burned into 188 published Shorts (middle half 3.2–4.9 %; layout
  //              study of 240 Shorts, 2026-11-17). It says what is usual, not what works.
  //   font.wide  type in 16:9: a guess, no published video was measured in that frame
  //   minWidth   a caption area is never narrower: in upright frames half the frame, the
  //              Shorts' median block; in 16:9 a column that holds about 21 letters
  caption: { font: { tall: 77, wide: 50 }, line: 1.32, padEm: 0.44, minWidth: { tall: 540, wide: 600 }, maxEm: 24 },
  // hook in an upright frame: a card of two lines across `wide`, 3.1 em tall; it may shrink to
  // minFont where the room above the head is short (laid out by hand on a still, it went from 76 to 66 px)
  hookCard: { font: 76, minFont: 64, heightEm: 3.1, line: 1.14 },
  // hook in a wide frame: two big lines beside the face or the panel, 10 em wide (about 20
  // letters), 2.25 em tall (two lines of 1.08 and the descenders)
  hookBig: { font: 112, minFont: 72, widthEm: 10, heightEm: 2.25, line: 1.08 },
  // between two text blocks, and between text on the ground and the picture's edge
  gap: 24,
  // text set inside the picture keeps this far from the picture's own edge
  edgePad: 16,
  // What "free" means. A face's box runs hairline to chin, cheek to cheek. Text keeps out of it and
  // out of a margin around it: above the hairline (hair), below the chin (jaw, neck), beside the
  // cheeks (ears, hair, headphones). Each margin is a share of the face's height or width, never
  // less than its Min. Outside that keep-out the picture counts as free: the solver sees no pixels.
  free: { above: 0.02, aboveMin: 16, below: 0.08, belowMin: 24, beside: 0.25, besideMin: 24 },
  // a face is kept this far inside the safe box wherever the fit leaves the choice (an inset's
  // place, the hold of a zoom); where every px costs zoom it may touch the box's edge
  facePad: 20,
  // where the eyes sit in a face's box (from its top), for fits that choose the height freely
  eyes: 0.42,
  // (from where enlarging the source's pixels is soft and from where forbidden: weights.json)
  // zoom and inset are searched on a grid of 1 % of the covering scale
  zoomStep: 0.01, zoomMax: 1.6, insetStep: 0.01, insetMin: 0.5, panelMin: 0.6,
  // crops shown as a band across an upright frame (besides the crop that fills it)
  bands: ["4:5", "1:1"],
  // a face that moves: when the hull of its boxes has over `far` times its usual box's area, the
  // result says that one placement for the whole clip holds the face small
  track: { far: 2 },
  // a screen recording: its smallest text that must be read is at least `height` px tall (its
  // letters: a capital's height) in a frame `per` px wide, in proportion in a wider or narrower
  // frame. 24 px in 1080: 2.2 % of the frame's width, about a 33 px font, 12 pt on a phone that
  // shows the frame as wide as its screen. A guess from type sizes, not from a measurement.
  readable: { height: 24, per: 1080 },
  // a webcam's circle beside a screen: its diameter as a share of the frame's width (upright
  // frames) or of its shorter side (4:5, 1:1, wide), as screencast-cut sizes it; down to `min` of
  // the shorter side where no corner is free at that size
  circle: { tall: 0.22, square: 0.16, wide: 0.2, min: 0.12 },
};

// The ranking's weights and limits: tools/weights.json, read once at start. Every term there is
// { value, says }: here only the values, checked, so that a file with a term missing or misspelt
// fails here and not as a NaN in a candidate's cost.
export const WEIGHTS_FILE = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "weights.json");
const TERMS = ["enlarge.softFrom", "enlarge.forbiddenFrom", "enlarge.costAtForbidden", "subject.from", "subject.to", "subject.smaller", "subject.larger", "subject.regionEnough", "ground.cost", "soft.cost", "text.away", "text.hookSmaller"];
export function readWeights(file = WEIGHTS_FILE) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { throw new Error(`The weights file ${file} cannot be read (${e.message}): it is JSON like tools/weights.json, every term { "value": … }.`); }
  const values = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v && typeof v === "object").map(([k, v]) => [k, "value" in v ? v.value : values(v)]));
  const w = values(raw);
  for (const k of TERMS) {
    const v = k.split(".").reduce((o, key) => o?.[key], w);
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${file}: ${k} needs a number as its value, as in tools/weights.json.`);
  }
  if (!(w.enlarge.forbiddenFrom > w.enlarge.softFrom)) throw new Error(`${file}: enlarge.forbiddenFrom must be over enlarge.softFrom.`);
  if (!(w.subject.to >= w.subject.from)) throw new Error(`${file}: subject.to must not be under subject.from.`);
  return w;
}
DEFAULTS.weights = readWeights();

// The sizes in px for a frame of another size than 1080 on its shorter side: a video of 720×1280
// is shown as large as one of 1080×1920, so its type and margins are two thirds as many px.
// Without this, text set for 1080 ran out of a smaller frame. Type is whole px.
const PX = ["caption.font.tall", "caption.font.wide", "caption.minWidth.tall", "caption.minWidth.wide", "hookCard.font", "hookCard.minFont", "hookBig.font", "hookBig.minFont", "gap", "edgePad", "free.aboveMin", "free.belowMin", "free.besideMin", "facePad"];
export function scaled(D, [W, H]) {
  const k = Math.min(W, H) / 1080;
  if (Math.abs(k - 1) < 1e-9) return D;
  const out = structuredClone(D);
  for (const key of PX) {
    const keys = key.split("."), o = keys.slice(0, -1).reduce((x, q) => x[q], out), v = o[keys.at(-1)] * k;
    o[keys.at(-1)] = /font/i.test(key) ? Math.max(1, Math.round(v)) : v;
  }
  return out;
}

// base with { "dotted.key": value } laid over it. A key must name a default that is there and
// keep its kind: a misspelt key would change nothing without a word, and a step of 0 or a text
// where a number belongs would have the searches run without end.
const POSITIVE = ["zoomStep", "insetStep", "insetMin", "panelMin", "zoomMax", "caption.line", "readable.height", "readable.per", "weights.enlarge.softFrom"];
export function merged(base, over) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over || {})) {
    const keys = k.split(".");
    let o = out;
    for (const key of keys.slice(0, -1)) o = o && typeof o === "object" ? o[key] : undefined;
    const old = o && typeof o === "object" ? o[keys.at(-1)] : undefined;
    if (old === undefined) throw new Error(`There is no default "${k}" to set: the defaults are in tools/lib/defaults.mjs, the ranking's terms (weights.…) in tools/weights.json.`);
    if (old && typeof old === "object") throw new Error(`"${k}" is a group of defaults, set one of its values: ${Array.isArray(old) ? "a list cannot be set from here" : Object.keys(old).map((x) => `${k}.${x}`).join(", ")}.`);
    if (typeof old === "number" && !(typeof v === "number" && Number.isFinite(v) && v >= 0)) throw new Error(`"${k}" is a number, not under 0: ${JSON.stringify(v)} is none.`);
    o[keys.at(-1)] = v;
  }
  const at = (k) => k.split(".").reduce((o, key) => o?.[key], out);
  for (const k of POSITIVE) if (!(at(k) > 0)) throw new Error(`"${k}" must be over 0: with ${at(k)} the search would not end.`);
  if (!(out.zoomStep < 1 && out.insetStep < 1 && out.insetMin <= 1 && out.panelMin <= 1)) throw new Error(`zoomStep, insetStep, insetMin and panelMin are shares of a scale: under 1 (0.01 is a step of one per cent).`);
  if (!(out.weights.enlarge.forbiddenFrom > out.weights.enlarge.softFrom)) throw new Error(`weights.enlarge.forbiddenFrom must be over weights.enlarge.softFrom.`);
  if (!(out.weights.subject.to >= out.weights.subject.from)) throw new Error(`weights.subject.to must not be under weights.subject.from.`);
  return out;
}
