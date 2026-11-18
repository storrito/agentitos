// A frame's boxes judged against the zones, by the rules of platform-zones' layout check, on the
// solver's own boxes: the search judges thousands of placements, too many to open a page for each.
// The checker itself has the last word on a candidate's page (place.mjs page).
//
//   judge(zones, items)       → [{ level, code, kind, of, what }]
//       items: [{ kind: "face" | "text", label, box, ink? }]   (ink: where the letters are, estimated)
//       hard: under what an app covers, outside the frame, text on a face, text on text
//       soft: in the safe box's margin, cut by a feed's crop
//   compare(candidate, checked) → { agree, verdictAgrees, onlySolver, onlyChecker }: the solver's
//       problems beside the checker's findings (checked: what checkPage gives), by kind

import { EPS, X1, Y1, area, inter, contains, pct } from "./boxes.mjs";

// A box this close to an edge of a zone counts as on it: platform-zones' checker takes 2 px off
// every side before it judges (the rounding of fonts and transforms), and so does this, so that
// the two never differ about a box a pixel past a line.
const SLACK = 2;
const within = (b) => { const x = Math.max(0, Math.min(SLACK, (b[2] - 1) / 2)), y = Math.max(0, Math.min(SLACK, (b[3] - 1) / 2)); return [b[0] + x, b[1] + y, b[2] - 2 * x, b[3] - 2 * y]; };

export function judge(Z, items) {
  const [W, H] = Z.size, frame = [0, 0, W, H];
  const out = [];
  for (const it of items) {
    if (area(it.box) <= 0) continue;
    const b = within(it.box), a = area(b);
    const inFrame = inter(b, frame);
    const off = 1 - inFrame / a;
    if (off > 0.001) out.push({ level: "hard", code: "off-frame", kind: it.kind, of: it.label, what: `${pct(off)} outside the frame` });
    const under = Z.covers.filter((c) => inter(b, c.box) > 0);
    if (under.length) out.push({ level: "hard", code: "covered", kind: it.kind, of: it.label, what: `under ${[...new Set(under.map((c) => `${c.what} (${c.platform})`))].join("; ")}` });
    else if (!(contains(Z.safe, b) || (Z.wide && contains(Z.wide, b))) && off <= 0.001) {
      const s = Z.safe;
      const past = { left: s[0] - b[0], top: s[1] - b[1], right: X1(b) - X1(s), bottom: Y1(b) - Y1(s) };
      out.push({ level: "soft", code: "margin", kind: it.kind, of: it.label, what: `in the safe box's margin (${Object.entries(past).filter(([, v]) => v > EPS).map(([k, v]) => `${Math.round(v)} px past the ${k}`).join(", ")})` });
    }
    const ink = it.ink ? within(it.ink) : b, inkIn = inter(ink, frame);
    if (inkIn) for (const c of Z.crops) {
      const share = 1 - inter(ink, c.box) / inkIn;
      if (share > 0.001) out.push({ level: "soft", code: "crop", kind: it.kind, of: it.label, what: `${pct(share)} cut where ${c.where} shows ${c.ratio}` });
    }
  }
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    const kinds = [a.kind, b.kind].sort().join("+");
    if (kinds === "face+face") continue;
    const o = inter(a.box, b.box), small = Math.min(area(a.box), area(b.box));
    if (!o || o < 0.02 * small) continue;
    if (kinds === "text+text") out.push({ level: "hard", code: "text-on-text", kind: "text", of: a.label, what: `overlaps ${b.label}` });
    else out.push({ level: "hard", code: "text-on-face", kind: "text", of: a.kind === "text" ? a.label : b.label, what: `lies on ${a.kind === "face" ? a.label : b.label}` });
  }
  return out;
}

// The checker's findings come as sentences: each is brought back to the code the solver gives the
// same thing, so that the two verdicts can be compared.
const CHECKER_CODE = (what) => (/^under /.test(what) ? "covered" : /outside the frame/.test(what) ? "off-frame" : /^lies on/.test(what) ? "text-on-face" : /^overlaps/.test(what) ? "text-on-text" : /cut off by its box/.test(what) ? "clipped" : /safe box's margin/.test(what) ? "margin" : /cut where/.test(what) ? "crop" : /centred in the safe box/.test(what) ? "off-centre" : "other");
// what only the solver can know (the source's sharpness, the crop inside the frame, the text asked for)
const SOLVER_ONLY = new Set(["enlarged", "cut", "no-room", "other-cut", "other-shows", "small", "circle-on-region", "twice"]);
export function compare(c, checked) {
  const mine = c.problems.filter((q) => !SOLVER_ONLY.has(q.code)).map((q) => `${q.level === "hard" ? "✗" : "!"} ${q.kind} ${q.code}`);
  const theirs = checked.findings.map((f) => `${f.level} ${f.kind} ${CHECKER_CODE(f.what)}`);
  const onlySolver = mine.filter((k) => !theirs.includes(k)), onlyChecker = theirs.filter((k) => !mine.includes(k));
  const hardSame = mine.some((k) => k[0] === "✗") === theirs.some((k) => k[0] === "✗");
  return { agree: !onlySolver.length && !onlyChecker.length, verdictAgrees: hardSame, onlySolver, onlyChecker };
}
