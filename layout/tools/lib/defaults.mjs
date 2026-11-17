// What the solver assumes where nobody says otherwise, and the ranking's weights.
//
//   DEFAULTS              sizes of text, margins around a face, search steps: in px of the frame
//                         or as a share of the face. `--set caption.font.tall=60` changes one for
//                         one run. None of them is a zone: those come from platform-zones.
//   readWeights(file)     the ranking's terms from a weights file (tools/weights.json: every term
//                         { value, says }), as their values; DEFAULTS.weights holds the skill's own
//   merged(base, over)    base with { "dotted.key": value } laid over it

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULTS = {
  // captions: N lines, set as the captions skill sets them (line height 1.32, a dark plate per line),
  // centred on the frame and as wide as `centred` (at most maxEm), or in a column beside a face
  // (at least minEm wide: 12 em holds about 21 letters)
  caption: { font: { tall: 56, wide: 50 }, line: 1.32, minEm: 12, maxEm: 24 },
  // hook in an upright frame: a card of two lines across `wide`, 3.1 em tall; it may shrink to
  // minFont where the room above the head is short (the hand probe went from 76 to 66 px)
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
const TERMS = ["enlarge.softFrom", "enlarge.forbiddenFrom", "enlarge.costAtForbidden", "subject.worth", "subject.enough", "ground.cost", "people.leftOut", "soft.cost", "text.away", "text.hookSmaller"];
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
  return w;
}
DEFAULTS.weights = readWeights();

export function merged(base, over) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over || {})) {
    const keys = k.split(".");
    let o = out;
    for (const key of keys.slice(0, -1)) o = o[key] ??= {};
    o[keys.at(-1)] = v;
  }
  return out;
}
