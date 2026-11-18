#!/usr/bin/env node
// For people who change the weights or the defaults: made-up faces swept over a grid, the solver
// run on each, the winning placement and the text's place recorded, the winners checked by
// platform-zones, and a page that shows which fit wins where. It says what the weights do, not
// what looks good: no face in it is a real one.
//
//   node sweep.mjs <folder>                       sweep, check the winners, write <folder>/sweep.json and sweep.html
//   node sweep.mjs <folder> --weights mine.json   with other weights; the page then counts, per case, the
//                                                 winners that differ from those of the skill's weights.json
//   node sweep.mjs <folder> --no-check            without the checker (no Chrome)
//   node sweep.mjs <folder> --jobs 1              the checker one run (one Chrome) at a time
//   node sweep.mjs <folder> --html                only rebuild sweep.html from sweep.json
//   --summary                                     also print the numbers behind the page's thresholds
//
// Grid: face height 15–55 % of the source's height, eye line 25–60 % of it, the face's centre
// −15 to +15 % of the width off the middle. A face is 0.68 as wide as it is tall, its eyes 42 %
// down its box (as in the two takes laid out by hand: 0.67 and 0.71; 0.43 and 0.40).
// Cases: an upright and a wide source into each of 9:16, 16:9, 4:5 and 1:1.
// Text: one caption line, two caption lines, a hook, a hook plus two caption lines.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { DEFAULTS, readWeights } from "./lib/defaults.mjs";
import { compare } from "./lib/judge.mjs";
import { renderPage } from "./lib/page.mjs";
import { solve } from "./lib/solve.mjs";
import { buildHtml } from "./lib/sweep-page.mjs";
import { askZones, zonesTool } from "./lib/zones.mjs";

const fail = (msg) => { console.error(msg); process.exit(1); };
const argv = process.argv.slice(2), flags = new Set(argv.filter((a) => a.startsWith("--")));
const wi = argv.indexOf("--weights"), weightsFile = wi >= 0 ? argv[wi + 1] : null;
// --jobs N: at most N checker runs (and Chrome pages) at once, for a machine that is busy otherwise
const ji = argv.indexOf("--jobs"), jobs = ji >= 0 ? Number(argv[ji + 1]) : null;
if (ji >= 0 && !(Number.isInteger(jobs) && jobs >= 1)) fail("--jobs is a whole number of checker runs at once, 1 or more.");
const [folder] = argv.filter((a, i) => !a.startsWith("--") && (wi < 0 || i !== wi + 1) && (ji < 0 || i !== ji + 1));
for (const f of flags) if (!["--weights", "--no-check", "--html", "--summary", "--jobs"].includes(f)) fail(`sweep has no option ${f}: it takes --weights <file.json>, --no-check, --html, --summary, --jobs <n>.`);
if (!folder || (wi >= 0 && !weightsFile)) fail("node sweep.mjs <folder> [--weights file.json] [--no-check] [--html] [--summary]: the folder is yours, sweep.json and sweep.html go into it.");

const CASES = [
  { id: "a", source: [1080, 1920], frame: "9:16", name: "upright source into 9:16" },
  { id: "b", source: [1920, 1080], frame: "9:16", name: "wide source into 9:16" },
  { id: "c", source: [1080, 1920], frame: "16:9", name: "upright source into 16:9" },
  { id: "d", source: [1920, 1080], frame: "16:9", name: "wide source into 16:9" },
  { id: "e", source: [1080, 1920], frame: "4:5", name: "upright source into 4:5" },
  { id: "f", source: [1920, 1080], frame: "4:5", name: "wide source into 4:5" },
  { id: "g", source: [1080, 1920], frame: "1:1", name: "upright source into 1:1" },
  { id: "h", source: [1920, 1080], frame: "1:1", name: "wide source into 1:1" },
];
const NEEDS = [
  { id: "cap1", needs: [{ role: "caption", lines: 1 }], name: "one caption line" },
  { id: "cap2", needs: [{ role: "caption", lines: 2 }], name: "two caption lines" },
  { id: "hook", needs: [{ role: "hook" }], name: "a hook" },
  { id: "hookcap2", needs: [{ role: "hook" }, { role: "caption", lines: 2 }], name: "a hook plus two caption lines" },
];
const range = (a, b, step) => Array.from({ length: Math.round((b - a) / step) + 1 }, (_, i) => a + i * step);
const GRID = { height: range(15, 55, 5), eyes: range(25, 60, 5), offset: range(-15, 15, 5) };
const FACE = { aspect: 0.68, eyes: 0.42 };

function faceOf([sw, sh], h, e, o) {
  const fh = (h / 100) * sh, fw = FACE.aspect * fh;
  return [sw / 2 + (o / 100) * sw - fw / 2, (e / 100) * sh - FACE.eyes * fh, fw, fh].map((v) => Math.round(v * 10) / 10);
}

function sweep(weights) {
  const t0 = Date.now(), cells = [];
  for (const c of CASES) {
    const zones = askZones(c.frame);
    for (const n of NEEDS) for (const h of GRID.height) for (const e of GRID.eyes) for (const o of GRID.offset) {
      const face = faceOf(c.source, h, e, o);
      const res = solve({ zones, source: c.source, faces: [face], needs: n.needs, weights });
      const w = res.candidates[0];
      cells.push({
        case: c.id, need: n.id, h, e, o, face,
        fit: w.fit, crop: w.crop || null, side: w.side || null, scale: w.scale, zoom: w.zoom, enlargement: w.enlargement,
        ground: w.ground, faceHeight: w.faceHeight, faceInFrame: w.faceInFrame[0], window: w.window, left: w.left, top: w.top,
        status: w.hard ? "hard" : w.unmet.length ? "unmet" : w.soft ? "soft" : "ok",
        unmet: w.unmet, fullSize: w.fullSize,
        text: w.text.map((t) => ({ role: t.role, where: t.where, on: t.on, box: t.box, ink: t.ink, font: t.font, lines: t.lines, style: t.style, align: t.align, ...(t.shrunk ? { shrunk: true } : {}) })),
        problems: w.problems.map((q) => ({ level: q.level, code: q.code, kind: q.kind, of: q.of, what: q.what })),
        full: (() => { const f = res.candidates.find((q) => q.fit === "full"); return f ? (f.hard ? "hard" : f.unmet.length ? "unmet" : f.soft ? "soft" : "ok") : null; })(),
        candidates: res.candidates.length,
      });
    }
  }
  return { cells, ms: Date.now() - t0 };
}

// ---- the checker on the winners ----

const run = (args) => new Promise((resolve) => execFile(process.execPath, args, { encoding: "utf8", maxBuffer: 64 << 20 }, (err, stdout, stderr) => resolve({ stdout, stderr })));
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
const sizeOf = (c) => askZones(CASES.find((q) => q.id === c.case).frame).size;
const layout = async (file) => {
  const r = await run([zonesTool(), "layout", file, "--json"]);
  try { return JSON.parse(r.stdout); } catch { return { error: (r.stderr || r.stdout || "").trim().slice(0, 300), findings: [] }; }
};

// every winner's boxes through `zones.mjs layout boxes.json`: the zones' logic, without Chrome.
// The text boxes are the solver's estimate of where the letters are.
async function checkBoxes(cells) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "layout-sweep-"));
  const t0 = Date.now();
  const res = await pool(cells, jobs || Math.max(2, os.cpus().length - 2), async (c, k) => {
    const boxes = [{ kind: "face", label: "face", box: c.faceInFrame }, ...c.text.map((t) => ({ kind: "text", label: t.role, box: t.ink, ...(t.align === "center" ? { centred: true } : {}) }))];
    const file = path.join(dir, `${k}.json`);
    fs.writeFileSync(file, JSON.stringify({ size: sizeOf(c), boxes }));
    const j = await layout(file);
    fs.rmSync(file, { force: true });
    return { ...compare(c, j), error: j.error, hard: j.findings.filter((f) => f.level === "✗").length };
  });
  fs.rmSync(dir, { recursive: true, force: true });
  cells.forEach((c, k) => { c.boxCheck = { ok: !res[k].hard && !res[k].error, agree: res[k].agree, ...(res[k].agree ? {} : { onlySolver: res[k].onlySolver, onlyChecker: res[k].onlyChecker }), ...(res[k].error ? { error: res[k].error } : {}) }; });
  return Date.now() - t0;
}

// a sample of the winners as pages, measured in Chrome by their letters
async function checkPages(cells, perGroup, defaults) {
  const dir = path.join(folder, "pages");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const sample = [];
  for (const c of CASES) for (const n of NEEDS) {
    const part = cells.filter((q) => q.case === c.id && q.need === n.id), step = part.length / perGroup;
    for (let i = 0; i < perGroup; i++) sample.push(part[Math.floor(i * step + step / 2)]);
  }
  const t0 = Date.now();
  await pool(sample, jobs || 6, async (c) => {
    const cs = CASES.find((q) => q.id === c.case);
    const file = path.join(dir, `${c.case}-${c.need}-h${c.h}-e${c.e}-o${c.o}.html`);
    fs.writeFileSync(file, renderPage({ ...c, faceInFrame: [c.faceInFrame] }, { size: sizeOf(c), source: cs.source, faces: [c.face], defaults }, { page: file }));
    const j = await layout(file);
    // the page must show the checker what the solver placed: one face with a size, every text block
    const seen = (j.boxes || []).filter((b) => (b.kind === "face" && b.box[2] > 0 && b.box[3] > 0) || b.kind === "text").length;
    if (!j.error && seen !== 1 + c.text.length) j.error = `the checker saw ${seen} boxes, the solver placed ${1 + c.text.length}`;
    const cmp = compare(c, j);
    c.pageCheck = { ok: !j.error && !j.findings.some((f) => f.level === "✗"), agree: cmp.agree, file: path.relative(folder, file), ...(cmp.agree ? {} : { onlySolver: cmp.onlySolver, onlyChecker: cmp.onlyChecker }), ...(j.error ? { error: j.error } : {}), findings: j.findings.map((f) => `${f.level} ${f.kind}: ${f.what}`) };
  });
  return { ms: Date.now() - t0, n: sample.length };
}

// ---- what the sweep shows, in numbers ----

const fitName = (q) => (q.fit === "crop" ? `crop ${q.crop}` : q.fit);
const tally = (list, key) => { const t = {}; for (const q of list) { const k = key(q); if (k !== null && k !== undefined) t[k] = (t[k] || 0) + 1; } return t; };
function summarise(cells) {
  const out = {};
  for (const c of CASES) {
    const [sw, sh] = c.source, Z = askZones(c.frame), [W, H] = Z.size, same = Math.abs((sw / sh) / (W / H) - 1) < 0.02;
    out[c.id] = { frame: c.frame, size: Z.size, safe: Z.safe, wide: Z.wide, centred: Z.centred, platforms: Z.platforms.map((p) => p.name), needs: {} };
    for (const n of NEEDS) {
      const part = cells.filter((q) => q.case === c.id && q.need === n.id);
      const s = { cells: part.length, fits: tally(part, fitName), status: tally(part, (q) => q.status) };
      for (const role of ["caption", "hook"]) if (n.needs.some((x) => x.role === role)) s[role] = tally(part, (q) => { const t = q.text.find((x) => x.role === role); return t ? `${t.where}${t.on === "ground" && t.where === "beside" ? " (ground)" : ""}` : "none"; });
      s.byHeight = GRID.height.map((h) => ({ h, fits: tally(part.filter((q) => q.h === h), fitName) }));
      // up to which face height every cell passes unchanged; from which on none passes unchanged; from which on only a smaller picture passes
      const only = (h, names) => Object.keys(s.byHeight.find((r) => r.h === h).fits).every((k) => names.includes(k));
      const none = (h, names) => Object.keys(s.byHeight.find((r) => r.h === h).fits).every((k) => !names.includes(k));
      s.allFullUpTo = GRID.height.filter((h) => GRID.height.filter((x) => x <= h).every((x) => only(x, ["full"]))).at(-1) ?? null;
      s.noFullFrom = GRID.height.find((h) => GRID.height.filter((x) => x >= h).every((x) => none(x, ["full"]))) ?? null;
      s.onlySmallerFrom = GRID.height.find((h) => GRID.height.filter((x) => x >= h).every((x) => none(x, ["full", "zoom"]))) ?? null;
      const scales = (name) => { const v = part.filter((q) => fitName(q) === name).map((q) => q.zoom); return v.length ? [Math.min(...v), Math.max(...v)] : null; };
      s.zoomRange = scales("zoom"); s.insetRange = scales("inset");
      s.offsetMatters = GRID.height.flatMap((h) => GRID.eyes.map((e) => new Set(part.filter((q) => q.h === h && q.e === e).map(fitName)).size > 1 ? 1 : 0)).reduce((a, b) => a + b, 0);
      if (same) {
        // the unchanged picture: where the chin and the hairline are when the text changes its place
        const full = part.filter((q) => q.fit === "full"), chin = (q) => 100 * (q.face[1] + q.face[3]) / sh, top = (q) => 100 * q.face[1] / sh;
        const capOf = (q) => q.text.find((x) => x.role === "caption"), hookOf = (q) => q.text.find((x) => x.role === "hook");
        const r1 = (v) => Math.round(v * 10) / 10, mm = (v) => (v.length ? [r1(Math.min(...v)), r1(Math.max(...v))] : null);
        if (n.needs.some((x) => x.role === "caption")) s.chin = { below: mm(full.filter((q) => capOf(q)?.where === "below-chin").map(chin)), above: mm(full.filter((q) => capOf(q)?.where === "above-head").map(chin)), beside: mm(full.filter((q) => capOf(q)?.where === "beside").map(chin)) };
        if (n.needs.some((x) => x.role === "hook")) s.hairline = { above: mm(full.filter((q) => hookOf(q)?.where === "above-head").map(top)), beside: mm(full.filter((q) => hookOf(q)?.where === "beside").map(top)) };
        s.fullFace = { top: mm(full.map(top)), chin: mm(full.map(chin)) };
        const notFull = part.filter((q) => q.fit !== "full");
        s.notFullFace = { top: mm(notFull.map(top)), chin: mm(notFull.map(chin)) };
      }
      out[c.id].needs[n.id] = s;
    }
  }
  return out;
}

async function main() {
  fs.mkdirSync(folder, { recursive: true });
  const jsonFile = path.join(folder, "sweep.json"), htmlFile = path.join(folder, "sweep.html");
  let data;
  if (flags.has("--html")) {
    if (!fs.existsSync(jsonFile)) fail(`There is no ${jsonFile}: run the sweep once without --html.`);
    data = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
  } else {
    const weights = weightsFile ? readWeights(weightsFile) : null;
    const { cells, ms } = sweep(weights);
    console.log(`${cells.length} cells solved in ${(ms / 1000).toFixed(1)} s${weightsFile ? ` with the weights of ${weightsFile}` : ""}`);
    data = { made: new Date().toISOString().slice(0, 10), grid: GRID, face: FACE, cases: CASES, needs: NEEDS, defaults: weights ? { ...DEFAULTS, weights } : DEFAULTS, cells };
    // other weights than the skill's: how many winners they change, and from what to what
    if (weights) {
      data.against = { weights: path.basename(weightsFile), cases: {} };
      for (const c of CASES) {
        const zones = askZones(c.frame), moves = {};
        let n = 0, changed = 0;
        for (const q of cells.filter((x) => x.case === c.id)) {
          const w = solve({ zones, source: c.source, faces: [q.face], needs: NEEDS.find((x) => x.id === q.need).needs }).candidates[0];
          n++;
          if (w.fit !== q.fit || w.scale !== q.scale || w.left !== q.left || w.top !== q.top) { changed++; const k = `${fitName(w)} → ${fitName(q)}`; moves[k] = (moves[k] || 0) + 1; }
        }
        data.against.cases[c.id] = { cells: n, changed, moves };
      }
      console.log(`against the skill's own weights: ${CASES.map((c) => `${c.id} ${data.against.cases[c.id].changed}`).join(", ")} winners change`);
    }
    if (!flags.has("--no-check")) {
      const ms1 = await checkBoxes(cells);
      const bad = cells.filter((c) => !c.boxCheck.agree);
      console.log(`checker on every winner's boxes: ${cells.length - bad.length} of ${cells.length} agree (${(ms1 / 1000).toFixed(0)} s)`);
      const p = await checkPages(cells, 12, data.defaults);
      const pages = cells.filter((c) => c.pageCheck), bad2 = pages.filter((c) => !c.pageCheck.agree);
      console.log(`checker on ${p.n} winners as pages in Chrome: ${pages.length - bad2.length} agree, ${pages.filter((c) => !c.pageCheck.ok).length} fail (${(p.ms / 1000).toFixed(0)} s)`);
      const differences = (list, key) => tally(list, (c) => [...(c[key].onlySolver || []).map((k) => `solver only: ${k}`), ...(c[key].onlyChecker || []).map((k) => `checker only: ${k}`)].join(" + ") || c[key].error);
      data.checked = {
        boxes: { n: cells.length, agree: cells.length - bad.length, fails: cells.filter((c) => !c.boxCheck.ok).length, differences: differences(bad, "boxCheck") },
        pages: { n: pages.length, agree: pages.length - bad2.length, fails: pages.filter((c) => !c.pageCheck.ok).length, differences: differences(bad2, "pageCheck") },
      };
      console.log(JSON.stringify(data.checked, null, 1));
    }
    data.summary = summarise(cells);
    fs.writeFileSync(jsonFile, JSON.stringify(data));
  }
  if (flags.has("--summary")) console.log(JSON.stringify(data.summary, null, 1));
  fs.writeFileSync(htmlFile, buildHtml(data));
  console.log(`${jsonFile} and ${htmlFile} written: open the page; every map says which placement wins for a face of that size and place.`);
}
main().catch((e) => fail(e.message));
