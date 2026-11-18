// Where a clip's text goes, as clips' place step computes it: the framed clip's shots with their
// faces over time (lib/faces.mjs) handed to agentitos' layout (`place.mjs text`), which knows the
// rules (the margins around a face, the zones, the usual figures) and gives back one place for
// the captions, each shot's lift and the hook's place; what comes back goes to the framing (the
// lifts), to best-takes (takes/place.json: the captions' options and the hook's box, and
// takes/source/faces.json: the faces it keeps its punch-ins and its check by), and onto a sheet.
//
//   spanOf(clipDir) → { pieces: [{ in, out, start }], start, end, built }: what of the framed clip
//       the cut shows (edit.json when built, else the keeps of cut.json)
//   shotsInput(shots, span, hook) → { input: { shots, hook }, index: [shot number in the framing] }
//   hookSpan(span, edit, until) → { start, end } on the framed clip's clock
//   toOutput(t, pieces) / toFramed(t, pieces): one clock to the other
//   facesFile(shots, step) → { size, step, faces: [{ t, boxes: [{ who, box }] }] }
//   placeSheet(framed, shots, text, file, …) → the sheet's files

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

// what of the framed clip the cut shows, on its clock (best-takes' pieces: in and out in the
// source, start in the cut)
export function spanOf(dir) {
  const td = path.join(dir, "takes");
  const edit = path.join(td, "edit.json");
  if (fs.existsSync(edit)) {
    const e = read(edit);
    const pieces = e.pieces.map((p) => ({ in: p.in, out: p.out, start: p.start, rate: p.rate || 1, duration: p.duration }));
    return { pieces, start: pieces[0].in, end: pieces.at(-1).out, built: true, edit: e };
  }
  // not built yet: the keeps of cut.json, by their words' times
  const cut = read(path.join(td, "cut.json")), { words } = read(path.join(td, "source", "words.json"));
  const pieces = [];
  let at = 0;
  for (const k of cut.keep || []) {
    const [a, b] = String(k.words).split("-").map(Number);
    const ws = words.filter((w) => w.i >= a && w.i <= (b ?? a));
    if (!ws.length) continue;
    const p = { in: ws[0].start, out: ws.at(-1).end, start: at, rate: 1 };
    p.duration = p.out - p.in;
    at += p.duration;
    pieces.push(p);
  }
  if (!pieces.length) throw new Error(`${path.join(td, "cut.json")} keeps no words: write its keeps first.`);
  return { pieces, start: pieces[0].in, end: pieces.at(-1).out, built: false };
}

export function toFramed(t, pieces) {
  const p = pieces.find((q) => t >= q.start && t < q.start + q.duration) || (t < pieces[0].start ? pieces[0] : pieces.at(-1));
  return p.in + Math.min(p.duration, Math.max(0, t - p.start)) * (p.rate || 1);
}
export function toOutput(t, pieces) {
  const p = pieces.find((q) => t >= q.in && t <= q.out);
  if (p) return p.start + (t - p.in) / (p.rate || 1);
  // between two pieces (a pause cut): where the next one starts
  const next = pieces.find((q) => q.in > t);
  return next ? next.start : pieces.at(-1).start + pieces.at(-1).duration;
}

// how long best-takes keeps a hook: until the cut's first sentence ends, 2–5 s (its hook.mjs)
export function hookUntil(words, duration) {
  const end = words.find((w) => /[.!?…]["”']?$/.test(w.text))?.end ?? 3;
  return +Math.min(duration, Math.max(2, Math.min(5, end))).toFixed(3);
}

// the hook's time on the framed clip's clock: from the cut's first frame until its first sentence
// ends (before the edit is built: three seconds)
// A cut that opens with a line heard twice (best-takes' "again" keep) plays that line's stretch of
// the framed clip first and the moment from its start after it: the hook then lies over two
// stretches, each placed as any other (spans, in the cut's order)
export function hookSpan(span) {
  const until = span.built ? hookUntil(span.edit.words, span.edit.duration) : 3;
  const spans = [];
  for (const p of span.pieces) {
    if (p.start >= until - 1e-3) break;
    const a = p.in, b = p.in + Math.min(p.duration, until - p.start) * (p.rate || 1);
    const prev = spans.at(-1);
    if (prev && Math.abs(prev[1] - a) < 0.5) prev[1] = +b.toFixed(3); else spans.push([+a.toFixed(3), +b.toFixed(3)]);
  }
  if (!spans.length) spans.push([span.start, +(span.start + until).toFixed(3)]);
  const start = Math.min(...spans.map((s) => s[0])), end = Math.max(...spans.map((s) => s[1]));
  return { start, end, until, ...(spans.length > 1 ? { spans } : {}) };
}

// the shots the cut shows, each with the seconds of it the cut keeps, for layout's text
export function shotsInput(shots, span, hook = null) {
  const index = [], list = [];
  shots.forEach((s, k) => {
    const weight = span.pieces.reduce((n, p) => n + Math.max(0, Math.min(p.out, s.end) - Math.max(p.in, s.start)) / (p.rate || 1), 0);
    if (weight < 0.05) return;
    index.push(k);
    list.push({ n: k + 1, start: s.start, end: s.end, weight: +weight.toFixed(3), picture: s.picture, faces: s.faces, room: s.room?.none ? null : { free: s.room?.free || 0 } });
  });
  return { input: { shots: list, ...(hook ? { hook: { start: hook.start, end: hook.end, ...(hook.spans ? { spans: hook.spans } : {}), calm: calmBehind(shots, hook) } } : {}) }, index };
}

// Whether the picture behind a hook text is calm: the framing knows faces, not hands or things,
// so only a close-up counts as calm (every shot under the hook follows a face at least CALM of
// the frame's height tall: below its chin lies a shirt); a wider shot (hands, a table, bottles),
// a shot shown whole (a photo, footage) or two panels is not, and gets a card in the text's place.
export const CALM = 0.28;
export function calmBehind(shots, hook, H = 1920) {
  const spans = hook.spans || [[hook.start, hook.end]];
  const under = shots.filter((s) => spans.some(([a, b]) => s.end > a + 1e-3 && s.start < b - 1e-3));
  return under.length > 0 && under.every((s) => s.kind === "people" && Math.max(0, ...s.faces.flatMap((f) => f.track.filter((m) => spans.some(([a, b]) => m.t >= a - 0.05 && m.t <= b + 0.05)).map((m) => m.box[3]))) >= CALM * H);
}

// every face of the framed clip in px of the frame, every `step` seconds: for best-takes, which
// keeps its punch-ins from pushing a chin into the captions and names text on a face in its check
export function facesFile(shots, { size = [1080, 1920], step = 0.1 } = {}) {
  const at = new Map();
  for (const s of shots) for (const f of s.faces) for (const m of f.track) {
    const t = +m.t.toFixed(3);
    if (!at.has(t)) at.set(t, []);
    at.get(t).push({ who: f.who, box: m.box.map((v) => Math.round(v)), ...(m.feat ? { feat: m.feat.map((v) => Math.round(v)) } : {}) });
  }
  return { size, step, faces: [...at.entries()].sort((a, b) => a[0] - b[0]).map(([t, boxes]) => ({ t, boxes })) };
}

// The sheet: per shot of the cut a row, the framed clip at its first, middle and last frame with
// the captions' box (yellow), the hook's (cyan, where it shows) and the faces (red, thin); eight
// shots a sheet. Times are the framed clip's (the edit plays them in this order).
export function placeSheet(framed, rows, text, file, { size = [1080, 1920], fps = 25 } = {}) {
  const [W, H] = size, h = 420, w = Math.round((h * W) / H / 2) * 2, PER = 8, files = [];
  const k = w / W;
  // the last frame the picture has (its stream can end a little before the sound): a seek past it gives no frame, and the sheet none
  const pr = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration:format=duration", "-of", "json", framed], { encoding: "utf8" });
  let last = Infinity;
  try { const j = JSON.parse(pr.stdout); last = Number(j.streams?.[0]?.duration || j.format?.duration) - 2 / fps; } catch {}
  const label = (s) => String(s).replace(/[\\':,%;\[\]]/g, " ");
  const draw = (b, colour, t) => `drawbox=x=${Math.round(b[0] * k)}:y=${Math.round(b[1] * k)}:w=${Math.max(2, Math.round(b[2] * k))}:h=${Math.max(2, Math.round(b[3] * k))}:color=${colour}:t=${t}`;
  for (let page = 0; page * PER < rows.length; page++) {
    const part = rows.slice(page * PER, page * PER + PER);
    const args = ["-v", "error", "-y"], chains = [];
    let n = 0;
    part.forEach((r, i) => {
      const ts = [r.start + 1.5 / fps, (r.start + r.end) / 2, r.end - 1.5 / fps].map((t) => Math.max(0, Math.min(t, last)));
      ts.forEach((t, j) => {
        args.push("-ss", t.toFixed(3), "-i", framed);
        const boxes = [];
        for (const f of r.facesAt(t)) boxes.push(draw(f, "red@0.9", 2));
        if (text.caption) boxes.push(draw(text.caption.box, "yellow", 4));
        if (text.hook && t >= text.hook.start && t <= text.hook.end) boxes.push(draw(text.hook.box, "cyan", 4));
        const on = j === 1 ? `${r.n}  ${r.start.toFixed(1)}-${r.end.toFixed(1)} s${r.lift ? `  raised ${r.lift} px` : ""}${r.touch ? `  ${r.touch}` : ""}` : ["first", "", "last"][j];
        chains.push(`[${n}:v]scale=${w}:${h},setsar=1,${boxes.join(",")}${boxes.length ? "," : ""}drawtext=text='${label(on)} ${t.toFixed(2)}':x=6:y=h-24:fontsize=14:fontcolor=white:box=1:boxcolor=${/^ON /.test(r.touch) ? "red" : "black"}@0.8:boxborderw=3[c${i}_${j}]`);
        n++;
      });
      chains.push(`[c${i}_0][c${i}_1][c${i}_2]hstack=inputs=3,pad=iw:ih+6:0:0:white[r${i}]`);
    });
    const out = page ? file.replace(/\.jpg$/, `-${page + 1}.jpg`) : file;
    const graph = chains.join(";") + ";" + part.map((_, i) => `[r${i}]`).join("") + (part.length > 1 ? `vstack=inputs=${part.length}[s]` : "copy[s]");
    let r = spawnSync("ffmpeg", [...args, "-filter_complex", graph, "-map", "[s]", "-frames:v", "1", "-q:v", "4", out], { encoding: "utf8" });
    if (r.status !== 0) r = spawnSync("ffmpeg", [...args, "-filter_complex", graph.replace(/,drawtext=[^\[;]*/g, ""), "-map", "[s]", "-frames:v", "1", "-q:v", "4", out], { encoding: "utf8" });
    if (r.status === 0 && fs.existsSync(out)) files.push(out);
    else files.failed = (r.stderr || "").trim().split("\n").slice(-2).join(" ");
  }
  return files;
}
