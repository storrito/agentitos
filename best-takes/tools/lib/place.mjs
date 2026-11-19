// Where the picture and the text go when this skill works on its own: the faces of each video
// over time (agentitos' clips frames them: its frame.mjs --faces, the model's stills with the
// eyes, nose and mouth and its tracker between them; or the agent's own boxes off a grid picture,
// followed by the same tracker), each video placed in the frame by agentitos' layout (`place`:
// covering the frame where the video has the frame's shape, else layout's first candidate that
// passes, or the one the agent names), and the captions and the hook over the whole cut by
// layout's `text`, as clips' place does it for a framed clip: one place for the captions, how far
// each video's picture is raised so that its chins clear them (over a ground), the hook. What it
// writes is what clips hands over (place.json, source/faces.json), so that the build, the punch-ins
// and the check read one thing whoever wrote it; place.json's `picture` is this skill's own key.
//
//   pieceSpan(edit | { cut, words }) → [{ clip, in, out, start, duration, rate }]: what the cut plays
//   clockOf(clips, pieces) → { off, at }: every video a section of one clock, its kept stretches end to end
//   covering([sw, sh], [W, H]) → { scale, left, top }: the picture covering the frame, centred
//   inFrame(box, pic) → the box in px of the frame, the picture drawn at pic (scale, left, top − lift)
//   faceTrack(list, pieces, n, every) → [{ t, box }]: the face over the seconds the cut keeps of video n, inside its picture
//   facesFault(list, [w, h]) → a sentence where a video's faces cannot be of its picture, else null
//   takeKind(list, pieces, n) → { kept, shots, cuts, people, material }: what a video is over the seconds the cut keeps
//   shotChange(list, before, after) → "same" | "other" | "unknown": a cut the detector found, by the faces around it
//   pictureRule(kind, faced) → { use: whole | none | fallback | place, other, same, unsure, material }
//   shotsInput(…) → { shots, hook }: layout text's shots.json, one shot per video the cut shows
//   hookSpan(pieces, until, clock) → { start, end, spans? } on the one clock
//   calmBehind(shots, hook, H) → whether the picture behind the hook is a close-up
//   inkOf(look) → what of the captions' ink lies outside their line (as clips' place takes it)

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const skill = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
// agentitos' clips (its framing's faces), layout: an environment variable naming the tool, else
// beside this skill (a checkout of the collection), else in the machine's clone of the skills
export const framingTool = () => [process.env.FRAME_TOOL, path.join(skill, "..", "clips", "tools", "frame.mjs"), "/home/sprite/skills/clips/tools/frame.mjs"].find((p) => p && fs.existsSync(p)) || null;
export const layoutTool = () => [process.env.LAYOUT_TOOL, path.join(skill, "..", "layout", "tools", "place.mjs"), "/home/sprite/skills/layout/tools/place.mjs"].find((p) => p && fs.existsSync(p)) || null;

// what the cut plays: edit.json's pieces once built, else the keeps of cut.json by their words
export function pieceSpan(edit, { cut, words } = {}) {
  if (edit?.pieces?.length) return edit.pieces.map((p) => ({ clip: p.clip, in: p.in, out: p.out, start: p.start, duration: p.duration, rate: p.rate || 1 }));
  const out = [];
  let at = 0;
  for (const k of cut?.keep || []) {
    const [a, b] = String(k.words).split("-").map(Number);
    const ws = words.filter((w) => w.i >= a && w.i <= (b ?? a));
    if (!ws.length) continue;
    const p = { clip: ws[0].clip, in: ws[0].start, out: ws.at(-1).end, start: at, rate: 1 };
    p.duration = p.out - p.in;
    at += p.duration;
    out.push(p);
  }
  return out;
}

// One clock for layout: each video a section of its own, a second after the one before, and in it
// the stretches the cut keeps of it laid end to end (in the cut's order): a moment of layout's text
// stands for the time to its neighbour, so a stretch the cut leaves out must not lie between two.
// { off: { n: seconds }, at: [clock start of each piece] }, and toClock(clip, t) for a second of a video
export function clockOf(clips, pieces) {
  const off = {}, at = new Array(pieces.length);
  let cursor = 0;
  for (const c of Object.values(clips).sort((a, b) => a.n - b.n)) {
    const mine = pieces.map((p, k) => [p, k]).filter(([p]) => p.clip === c.n);
    if (!mine.length) continue;
    off[c.n] = cursor;
    for (const [p, k] of mine) { at[k] = cursor; cursor += p.out - p.in; }
    cursor += 1;
  }
  return { off, at };
}

export function covering([sw, sh], [W, H]) {
  const scale = Math.max(W / sw, H / sh);
  return { scale: +scale.toFixed(5), left: +((W - sw * scale) / 2).toFixed(1), top: +((H - sh * scale) / 2).toFixed(1) };
}

// the whole picture inside the frame, centred (slides, a screen: nothing of it cut)
export function whole([sw, sh], [W, H]) {
  const scale = Math.min(W / sw, H / sh);
  return { scale: +scale.toFixed(5), left: +((W - sw * scale) / 2).toFixed(1), top: +((H - sh * scale) / 2).toFixed(1) };
}

// What a video is, over the seconds the cut keeps of it, as its faces file knows: how many shots
// the cut keeps 1.5 s of at least (as the cut detector found them), what each cut between them is
// by the faces (shotChange), how many people at once (two or more in a fifth of its moments), and
// how many seconds of material (slides, a screen, a photo: a shot the framing called other than people)
// of the seconds it keeps of the video (kept)
export function takeKind(list, pieces, n) {
  const kept = pieces.filter((p) => p.clip === n);
  const over = (s) => kept.reduce((t, p) => t + Math.max(0, Math.min(p.out, s.end) - Math.max(p.in, s.start)), 0);
  // (a shot counts where the cut keeps 1.5 s of it: a flash of the shot before at a take's start is no cut in it)
  const shots = (list?.shots || []).filter((s) => over(s) >= 1.5);
  const cuts = shots.slice(1).map((s, i) => ({ t: s.start, is: shotChange(list, shots[i].end, s.start) }));
  const moments = (list?.faces || []).filter((f) => kept.some((p) => f.t >= p.in && f.t <= p.out));
  const two = moments.filter((f) => f.boxes.length > 1).length;
  return { kept: +kept.reduce((t, p) => t + Math.max(0, p.out - p.in), 0).toFixed(3), shots: shots.length, cuts, people: moments.length && two >= 0.2 * moments.length ? Math.max(...moments.map((f) => f.boxes.length)) : 1, material: shots.filter((s) => s.kind && s.kind !== "people").reduce((t, s) => t + over(s), 0) };
}

// How place chooses a video's picture from takeKind and whether a face is known in what the cut
// keeps. Material is checked first: where it is a quarter or more of what the cut keeps of the
// video (MATERIAL_SHARE; the review's slides take is all material, dafoe's interview with film
// clips 31 %), the picture stays whole with a face or without ("whole"). A shorter stretch (2.4 s
// of an empty stage the model called b-roll in a 22 s cut, a product held to the lens for 3 s) is
// only said, and the other checks run as for any take: no face, the picture covers the frame from
// the middle ("none"); the faces disagree (another framing or person across a cut, or two people
// at once), it covers the frame from the middle and says so ("fallback"); else one person's take,
// placed by layout ("place"). A doubt (a cut no face tells, a few seconds called material) never
// makes the picture worse: it is said and the take placed all the same.
// → { use, other: [cut], same: [cut], unsure: [cut], material: seconds said beside the picture (0: none) }
export const MATERIAL_SHARE = 0.25;
export function pictureRule(kind, faced) {
  const of = (is) => (kind.cuts || []).filter((x) => x.is === is);
  const out = { other: of("other"), same: of("same"), unsure: of("unknown"), material: 0 };
  if (kind.material && kind.material >= MATERIAL_SHARE * (kind.kept || 0)) return { use: "whole", ...out };
  out.material = kind.material || 0;
  if (!faced) return { use: "none", ...out };
  if (out.other.length || kind.people > 1) return { use: "fallback", ...out };
  return { use: "place", ...out };
}

// Whether a cut the detector found in a person's take is a change of shot. It is one where what
// the camera shows changes: another framing, another person, another place. The detector also
// cuts where the light drops or comes back, or the person leaves for a moment, so the faces
// decide: the last face known before the cut and the first after it (the largest of each moment)
// are the same shot when they are the same person (the framing names a person with the same words
// in every shot) with its middle less than half a face's width from where it was and its height
// within 1.3× of it, whatever the light did; a face missing on one side for a moment (up to SAME_GAP
// seconds between the two) is the same shot when the same face comes back so. Another place
// behind the same face at the same place and size is not told apart, and need not be: one window
// serves both. → "same", "other" (the faces disagree), or "unknown" (no face on one side, or the
// same face only after a longer gap: a cut away and back, perhaps)
export const SAME_GAP = 8;
export function shotChange(list, before, after) {
  const faces = (list?.faces || []).filter((f) => f.boxes?.length);
  const largest = (f) => [...f.boxes].sort((x, y) => y.box[2] * y.box[3] - x.box[2] * x.box[3])[0];
  const a = faces.filter((f) => f.t < before - 1e-3).at(-1), b = faces.find((f) => f.t >= after - 1e-3);
  if (!a || !b) return "unknown";
  const p = largest(a), q = largest(b);
  const named = typeof p.who === "string" && typeof q.who === "string" && p.who && q.who;
  if (named && p.who.toLowerCase() !== q.who.toLowerCase()) return "other";
  const [x0, y0, w0, h0] = p.box, [x1, y1, w1, h1] = q.box;
  const moved = Math.hypot(x0 + w0 / 2 - (x1 + w1 / 2), y0 + h0 / 2 - (y1 + h1 / 2));
  if (moved > 0.5 * Math.max(w0, w1) || Math.max(h0, h1) > 1.3 * Math.min(h0, h1)) return "other";
  return b.t - a.t <= SAME_GAP ? "same" : "unknown";
}

// a box of the video [x, y, w, h] in px of the frame, the picture drawn at its scale, its corner
// at left, top, raised by lift
export function inFrame(b, pic) {
  const k = pic.scale;
  return [pic.left + b[0] * k, pic.top - (pic.lift || 0) + b[1] * k, b[2] * k, b[3] * k].map((v) => +v.toFixed(1));
}

// how far a picture may be raised without a ground: what of it lies below the frame's bottom
export const roomBelow = (pic, [sw, sh], H) => Math.max(0, Math.floor(pic.top + sh * pic.scale - H));

// the face of video n over the seconds the cut keeps of it, one moment every `every` seconds:
// layout place's --face-track (its hull decides the placement)
// (a box the tracker carried a little past the picture's edge is taken to that edge: layout refuses
// a face that is not there)
export function faceTrack(list, pieces, n, every = 0.5, size = list?.size) {
  const kept = pieces.filter((p) => p.clip === n);
  const out = [];
  let last = -Infinity;
  for (const f of list?.faces || []) {
    if (!kept.some((p) => f.t >= p.in - 0.05 && f.t <= p.out + 0.05)) continue;
    if (f.t - last < every - 1e-6) continue;
    // the largest face: a take is one person
    const b = [...f.boxes].sort((x, y) => y.box[2] * y.box[3] - x.box[2] * x.box[3])[0];
    if (!b) continue;
    let box = b.box;
    if (size) {
      const x0 = Math.max(0, box[0]), y0 = Math.max(0, box[1]), x1 = Math.min(size[0], box[0] + box[2]), y1 = Math.min(size[1], box[1] + box[3]);
      if (x1 - x0 < 1 || y1 - y0 < 1) continue;
      box = [x0, y0, x1 - x0, y1 - y0];
    }
    out.push({ t: f.t, box }); last = f.t;
  }
  return out;
}

// The shots of layout's text: one per video the cut shows, its faces in the frame as the video is
// placed (before any raise), only at the seconds the cut keeps of it, on the one clock; room: how
// far its picture may be raised without a ground. weight: the seconds of the cut it plays.
export function shotsInput({ clips, pieces, faces, pictures, frame: [W, H], clock, hook = null }) {
  const shots = [], files = [];
  for (const c of Object.values(clips).sort((a, b) => a.n - b.n)) {
    const kept = pieces.map((p, k) => [p, k]).filter(([p]) => p.clip === c.n);
    if (!kept.length) continue;
    const pic = pictures[c.file], list = faces[c.file];
    const weight = kept.reduce((t, [p]) => t + p.duration, 0);
    const tracks = new Map();
    for (const [p, k] of kept) {
      const on = (x) => clock.at[k] + Math.min(p.out - p.in, Math.max(0, x - p.in));
      for (const f of list?.faces || []) {
        if (f.t < p.in - 0.05 || f.t > p.out + 0.05) continue;
        for (const b of f.boxes) {
          const key = b.who ?? "a face";
          if (!tracks.has(key)) tracks.set(key, { who: key, track: [] });
          tracks.get(key).track.push({ t: +on(f.t).toFixed(3), box: inFrame(b.box, { ...pic, lift: 0 }), ...(b.feat ? { feat: inFrame(b.feat, { ...pic, lift: 0 }) } : {}), ...(b.between ? { between: b.between.map((x) => +on(x).toFixed(2)) } : {}) });
        }
      }
    }
    for (const tr of tracks.values()) tr.track.sort((a, b) => a.t - b.t);
    const start = clock.off[c.n], end = start + kept.reduce((t, [p]) => t + p.out - p.in, 0);
    shots.push({ n: shots.length + 1, start: +start.toFixed(3), end: +end.toFixed(3), weight: +weight.toFixed(3), faces: [...tracks.values()], room: { free: roomBelow(pic, [c.width, c.height], H) } });
    files.push(c.file);
  }
  return { input: { shots, ...(hook ? { hook: { start: hook.start, end: hook.end, ...(hook.spans ? { spans: hook.spans } : {}), calm: calmBehind(shots, hook, H) } } : {}) }, files };
}

// the hook's seconds on the one clock: from the cut's start until `until`, the stretches the cut
// plays in that time (a cut that opens with a line heard twice plays two apart)
export function hookSpan(pieces, until, clock) {
  const spans = [];
  pieces.forEach((p, k) => {
    if (p.start >= until - 1e-3) return;
    const a = clock.at[k], b = clock.at[k] + Math.min(p.duration, until - p.start) * (p.rate || 1);
    const prev = spans.at(-1);
    if (prev && Math.abs(prev[1] - a) < 0.05) prev[1] = +b.toFixed(3); else spans.push([+a.toFixed(3), +b.toFixed(3)]);
  });
  const start = Math.min(...spans.map((s) => s[0])), end = Math.max(...spans.map((s) => s[1]));
  return { start, end, ...(spans.length > 1 ? { spans } : {}) };
}

// a moment of the one clock in the cut's time (the hook's end, where layout ends it early)
export function toCut(t, pieces, clock) {
  const k = pieces.findIndex((q, i) => t >= clock.at[i] - 1e-6 && t <= clock.at[i] + q.out - q.in + 1e-6);
  if (k >= 0) return pieces[k].start + (t - clock.at[k]) / (pieces[k].rate || 1);
  // between two videos' sections: where the stretch before it ends in the cut
  let best = -1;
  pieces.forEach((q, i) => { const e = clock.at[i] + q.out - q.in; if (e <= t + 1e-3 && (best < 0 || e > clock.at[best] + pieces[best].out - pieces[best].in)) best = i; });
  return best >= 0 ? pieces[best].start + pieces[best].duration : pieces[0].start;
}

// the seconds of the cut in which a face is known (faces: { file: { faces: [{ t }] } }, a moment within
// 0.15 s), counted every tenth of a second
export function knownSeconds(pieces, clips, faces) {
  let n = 0;
  for (const p of pieces) {
    const list = faces[clips[p.clip]?.file]?.faces || [];
    for (let t = 0; t < p.duration; t += 0.1) {
      const at = p.in + t * (p.rate || 1);
      let lo = 0, hi = list.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].t < at) lo = m + 1; else hi = m; }
      if (list.length && [list[lo], list[lo - 1]].some((f) => f && Math.abs(f.t - at) <= 0.15 && f.boxes.length)) n += 0.1;
    }
  }
  return n;
}

// layout place's candidates of one picture, best-takes' order: those that pass (no hard problem: the
// enlargement under layout's hard limit; every text placed) by the face nearest the usual size of a
// person's own take, as large as it comes up to FACE_UP of the frame's height (the box as given; the
// upper end of the middle half of faces in published Shorts, layout-data: 23–34 %), layout's order
// among equals; then the rest in layout's order. Sharpness alone never makes the face smaller (the
// review: a 720p interview came out as a square band at 1.5×, the face 14 % of the height, where
// the 4:5 crop at 1.875× fills the frame plainly better). → [{ …candidate, n, face }]
export const FACE_UP = 0.34;
export function rankPictures(candidates, usual, H) {
  const list = candidates.map((x, i) => ({ ...x, n: i + 1, face: (usual * x.scale) / H })).filter((x) => !x.parts && Number.isFinite(x.scale));
  const passes = (x) => !x.hard && !x.unmet.length;
  const off = (x) => (x.face <= FACE_UP ? FACE_UP - x.face : 10 * (x.face - FACE_UP));
  return [...list.filter(passes).sort((a, b) => off(a) - off(b) || a.n - b.n), ...list.filter((x) => !passes(x))];
}

// Faces that cannot be of this video's picture: found on a picture of another size (a phone's take
// stored on its side, read before the framing knew the rotation), or boxes mostly outside it. The
// faces are the tool's own (the model's, followed) or the agent's (--eye): the sentence says whose.
export function facesFault(list, [w, h]) {
  if (!list?.faces?.length) return null;
  const whose = list.by === "eye" ? "your boxes (--eye)" : "the faces the tool found (not boxes of yours)";
  if (list.size && (Math.abs(list.size[0] - w) > 1 || Math.abs(list.size[1] - h) > 1)) return `${whose} are of a picture of ${list.size[0]}×${list.size[1]}, the video shows ${w}×${h} (a phone's take stored on its side)`;
  let out = 0, all = 0;
  for (const f of list.faces) for (const b of f.boxes) {
    all++;
    const inside = Math.max(0, Math.min(w, b.box[0] + b.box[2]) - Math.max(0, b.box[0])) * Math.max(0, Math.min(h, b.box[1] + b.box[3]) - Math.max(0, b.box[1]));
    if (!(b.box[2] > 0 && b.box[3] > 0) || inside < 0.5 * b.box[2] * b.box[3]) out++;
  }
  return out > 0.05 * all ? `${whose} lie mostly outside the ${w}×${h} picture at ${out} of ${all} moments` : null;
}

// Whether the picture behind a hook text is calm (copied from clips' place: a skill never imports
// another's code): only a close-up counts, every shot under the hook a face at least CALM of the
// frame's height tall; a wider picture (hands, a table) gets a card in the text's place.
export const CALM = 0.28;
export function calmBehind(shots, hook, H = 1920) {
  const spans = hook.spans || [[hook.start, hook.end]];
  const under = shots.filter((s) => spans.some(([a, b]) => s.end > a + 1e-3 && s.start < b - 1e-3));
  return under.length > 0 && under.every((s) => Math.max(0, ...s.faces.flatMap((f) => f.track.filter((m) => spans.some(([a, b]) => m.t >= a - 0.05 && m.t <= b + 0.05)).map((m) => m.box[3]))) >= CALM * H);
}

// What of a style's ink lies outside its line (em of the type), as clips' place takes it: below the
// lowest line half the outline and the shadow's drop, at each side half the outline
export function inkOf(look) {
  if (!look) return null;
  const k = 1 / (look.size || 96), drop = Math.max(0, ...[...String(look.shadow || "").matchAll(/(?:^|,)\s*-?[\d.]+(?:px)?\s+(-?[\d.]+)px/g)].map((m) => Number(m[1])));
  return { line: look.lineHeight || 1.2, box: !!look.box, below: look.box ? 0 : +(((look.stroke || 0) / 2 + drop) * k + 0.05).toFixed(3), side: +(((look.stroke || 0) / 2) * k).toFixed(3) };
}

// The ground where the picture does not cover the frame (placed smaller, or raised): one still of
// the video, enlarged to cover the frame, blurred and darker; a still, not the video, so that a
// cut of many pieces plays no second video for each (a page plays only about 75)
export function groundStill(video, t, file, [W, H]) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", Math.max(0, t).toFixed(3), "-i", video, "-map_metadata", "-1", "-frames:v", "1",
    "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=40:2,eq=brightness=-0.12:saturation=0.8`, "-q:v", "4", file], { encoding: "utf8" });
  return r.status === 0 && fs.existsSync(file);
}

// One frame of the video as placed: the ground, the picture at its scale and place, raised; then the
// boxes (captions yellow, hook cyan, faces red). Px of the frame; the picture is `small` px tall.
function cell(video, t, pic, ground, [W, H], boxes, label, out, small) {
  const k = small / H;
  const sw = Math.round(pic.w * pic.scale / 2) * 2, sh = Math.round(pic.h * pic.scale / 2) * 2;
  const draw = boxes.map(([b, colour, th]) => `drawbox=x=${Math.round(b[0] * k)}:y=${Math.round(b[1] * k)}:w=${Math.max(2, Math.round(b[2] * k))}:h=${Math.max(2, Math.round(b[3] * k))}:color=${colour}:t=${th}`);
  const text = String(label).replace(/[\\':,%;\[\]]/g, " ");
  // a crop's window: only that part of the picture shows
  const win = pic.window || [pic.left, pic.top, sw, sh];
  const x0 = Math.max(win[0], pic.left), y0 = Math.max(win[1], pic.top), x1 = Math.min(win[0] + win[2], pic.left + sw), y1 = Math.min(win[1] + win[3], pic.top + sh);
  const crop = `crop=${Math.max(2, Math.round(x1 - x0))}:${Math.max(2, Math.round(y1 - y0))}:${Math.round(x0 - pic.left)}:${Math.round(y0 - pic.top)}`;
  const graph = `[1:v]setpts=PTS-STARTPTS,scale=${W}:${H}[g];[0:v]setpts=PTS-STARTPTS,scale=${sw}:${sh},setsar=1,${crop}[p];[g][p]overlay=x=${Math.round(x0)}:y=${Math.round(y0 - (pic.lift || 0))},scale=${Math.round((W * k) / 2) * 2}:${small},setsar=1${draw.length ? "," + draw.join(",") : ""},drawtext=text='${text}':x=6:y=h-24:fontsize=14:fontcolor=white:box=1:boxcolor=black@0.8:boxborderw=3[c]`;
  const inputs = ["-ss", Math.max(0, t).toFixed(3), "-i", video, ...(ground ? ["-i", ground] : ["-f", "lavfi", "-i", `color=c=black:s=${W}x${H}`])];
  let r = spawnSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", graph, "-map", "[c]", "-frames:v", "1", "-q:v", "4", out], { encoding: "utf8" });
  // (an ffmpeg without drawtext: the cell without its label)
  if (r.status !== 0) r = spawnSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", graph.replace(/,drawtext=[^\[;]*/, ""), "-map", "[c]", "-frames:v", "1", "-q:v", "4", out], { encoding: "utf8" });
  return r.status === 0 && fs.existsSync(out);
}

// The sheet: a row per video the cut shows, the frame as placed at the first and the last second
// the cut keeps of it and at the moments its face is lowest and highest (the lowest decides how
// far it is raised), the captions' box yellow, the hook's cyan where it shows, the faces red.
// rows: [{ video, label, pic, ground, moments: [{ t, what, faces: [box], hook: bool }] }]
export function placedSheet(rows, text, file, [W, H], { small = 420 } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "takes-sheet-"));
  try {
    const lines = [];
    rows.forEach((r, i) => {
      const cells = r.moments.map((m, j) => {
        // (a moment may show another picture of the video with its own text: a candidate)
        const tx = m.text || text, pic = m.pic || r.pic, ground = m.pic ? m.ground : r.ground;
        const boxes = [...m.faces.map((b) => [b, "red@0.9", 2]), ...(tx.caption ? [[tx.caption, "yellow", 4]] : []), ...(tx.hook && m.hook ? [[tx.hook, "cyan", 4]] : [])];
        const out = path.join(tmp, `${i}-${j}.jpg`);
        return cell(r.video, m.t, pic, ground, [W, H], boxes, m.label || `${r.label} ${m.what} ${m.t.toFixed(1)} s`, out, small) ? out : null;
      }).filter(Boolean);
      if (!cells.length) return;
      const line = path.join(tmp, `row-${i}.jpg`);
      const g = cells.length > 1 ? `${cells.map((_, k) => `[${k}:v]`).join("")}hstack=inputs=${cells.length},pad=iw:ih+6:0:0:white[r]` : "[0:v]pad=iw:ih+6:0:0:white[r]";
      const s = spawnSync("ffmpeg", ["-v", "error", "-y", ...cells.flatMap((c) => ["-i", c]), "-filter_complex", g, "-map", "[r]", "-frames:v", "1", "-q:v", "4", line], { encoding: "utf8" });
      if (s.status === 0) lines.push(line);
    });
    if (!lines.length) return null;
    // rows of unlike lengths: each padded to the widest
    const g = lines.length > 1 ? `${lines.map((_, k) => `[${k}:v]pad=${Math.round(4 * (W * small) / H + 8)}:ih:0:0:white[l${k}]`).join(";")};${lines.map((_, k) => `[l${k}]`).join("")}vstack=inputs=${lines.length}[s]` : "[0:v]copy[s]";
    const s = spawnSync("ffmpeg", ["-v", "error", "-y", ...lines.flatMap((c) => ["-i", c]), "-filter_complex", g, "-map", "[s]", "-frames:v", "1", "-q:v", "4", file], { encoding: "utf8" });
    return s.status === 0 ? file : null;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
