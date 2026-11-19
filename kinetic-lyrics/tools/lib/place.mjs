// Where the type of a short over footage goes, given every face of each shot over time: the
// framing's faces (agentitos' clips, `clips.mjs shots`) as this skill shows them, handed to
// agentitos' layout (`place.mjs text --text area`), which knows what of a face text may lie on.
// This file holds what only this skill knows: how its footage moves (a slow push-in, a small punch
// on each hero phrase), where its type and its name tag stand, and how a top for the type becomes
// the darkened band of the build (tools/build.mjs --type-top).
//
//   topOfShade([a, b]) → the type's top (a share of the height) in the band [a, b]
//   usualTop(plan) → the type's top in px as the build sets it from the footage alone
//   chipRoom(plan) → px of the speaker's name tag above the type (0 where it shows none)
//   pushed(input, plan) → the shots with every face as the push-in and the punches show it, each
//       moment's zoom with it (the framing raises the picture before it grows: a lift of L px
//       shows as L × zoom, and layout reckons with it)
//   liftsFor(text, shots) → [{ t, px }] for the framing (frame.mjs --lift), one per raised shot
//   placeArgs(plan, opts) → the arguments of layout's text for this short
//   sheet(framed, plan, text, shots, file) → a picture: per shot its first, middle and last frame
//       as the short shows it, the type's area and the faces drawn in

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// layout's place.mjs: LAYOUT_TOOL, else beside this skill, else in the machine's clone
export function layoutTool() {
  const skill = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  return [process.env.LAYOUT_TOOL, path.join(skill, "..", "layout", "tools", "place.mjs"), "/home/sprite/skills/layout/tools/place.mjs"].find((p) => p && fs.existsSync(p)) || null;
}

// The band's geometry (tools/build.mjs): transparent at a, dark from b, the type's top at a + 0.55 of
// the way (engine/type.js).
const TYPE_IN = 0.55;
export const topOfShade = ([a, b]) => a + (b - a) * TYPE_IN;
// the band as the footage alone set it (a build with --type-top keeps it in shadeFound)
export const usualTop = (plan) => Math.round(topOfShade(plan.video.shadeFound || plan.video.shade) * plan.height);

// The speaker's name tag (engine/overlay.js): over footage in an upright frame it stands right above
// the type, 0.6 % of the height above its top, 1.5 em of 3.4 % of the shorter side tall; shown
// where the speakers have names (plan.turns)
export function chipRoom(plan) {
  if (plan.preset !== "podcast" || !plan.turns?.length || !plan.video || plan.video.frame || !plan.portrait) return 0;
  return Math.ceil(0.006 * plan.height + 1.5 * Math.round(Math.min(plan.width, plan.height) * 0.034));
}

// The footage's motion (tools/footage.mjs): it grows from 1 to 1.06 over the short about the point
// at 50 % across and 28 % down, and by 2.5 % more for 1.3 s at each hero phrase. A face drawn
// through it: larger, and away from that point.
export const PUSH = 0.06, ORIGIN = [0.5, 0.28], PUNCH = 1.025, PUNCH_FOR = 1.32;
export function scaleAt(t, plan) {
  const heroes = (plan.phrases || []).filter((p) => p.layout === "hero").map((p) => p.tIn);
  const punch = heroes.some((h) => t >= h - 0.05 && t <= h + PUNCH_FOR) ? PUNCH : 1;
  return (1 + PUSH * Math.min(1, Math.max(0, t / plan.duration))) * punch;
}
const through = (b, s, ox, oy) => [ox + (b[0] - ox) * s, oy + (b[1] - oy) * s, b[2] * s, b[3] * s].map((v) => +v.toFixed(1));
export function pushed(input, plan) {
  const ox = ORIGIN[0] * plan.width, oy = ORIGIN[1] * plan.height;
  return {
    ...input,
    shots: input.shots.map((s) => ({
      ...s,
      faces: s.faces.map((f) => ({ ...f, track: f.track.map((m) => { const k = scaleAt(m.t, plan); return { ...m, box: through(m.box, k, ox, oy), ...(m.feat ? { feat: through(m.feat, k, ox, oy) } : {}), ...(m.eye != null ? { eye: +(oy + (m.eye - oy) * k).toFixed(1) } : {}), zoom: +k.toFixed(4) }; }) })),
    })),
  };
}

// the lifts layout chose, at the middle of each raised shot (frame.mjs --lift takes a second)
export const liftsFor = (text, shots) => text.shots.filter((s) => s.lift > 0).map((s) => ({ t: +((shots[s.shot].start + shots[s.shot].end) / 2).toFixed(3), px: s.lift }));

// what layout's text is asked: one area for the type and the name tag above it, never higher than
// the build sets it from the footage, never smaller than layout's least for the type alone
export function placeArgs(plan, { folder, shots, raise, top, lifts = [], platforms = [] }) {
  const chip = chipRoom(plan), H = plan.height;
  const args = ["text", folder, "--frame", `${plan.width}x${H}`, "--shots", shots, "--text", "area", "--area-top", String(usualTop(plan) - chip), "--raise", raise];
  // the area holds the name tag: the type alone keeps layout's least (0.15 of the height)
  if (chip) args.push("--set", `area.least=${+(0.15 + chip / H).toFixed(4)}`);
  if (top != null) args.push("--top", String(Math.round(top - chip)));
  for (const l of lifts) args.push("--lift", `${l.shot + 1}:${l.px}`);
  if (platforms.length) args.push("--platform", platforms.join(","));
  return args;
}

// The sheet: per shot a row of its first, middle and last frame of the framed footage as the short
// shows it (grown by the push-in at that moment), the type's area in yellow (its name tag's part
// dashed off by a thinner line), the faces in red, the mouth line in orange where the framing has
// the eyes, nose and mouth; eight shots a sheet.
export function sheet(framed, plan, text, shots, file, { chip = 0 } = {}) {
  const W = plan.width, H = plan.height, h = 420, w = Math.round((h * W) / H / 2) * 2, k = w / W, PER = 8, files = [];
  // the last frame the picture has (its stream can end before the sound): a seek past it gives no frame, and the sheet none
  const pr = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration:format=duration", "-of", "json", framed], { encoding: "utf8" });
  let last = Infinity;
  try { const j = JSON.parse(pr.stdout); last = Number(j.streams?.[0]?.duration || j.format?.duration) - 0.15; } catch {}
  const draw = (b, colour, t) => `drawbox=x=${Math.round(b[0] * k)}:y=${Math.round(b[1] * k)}:w=${Math.max(2, Math.round(b[2] * k))}:h=${Math.max(2, Math.round(b[3] * k))}:color=${colour}:t=${t}`;
  const a = text.area.box;
  for (let page = 0; page * PER < text.shots.length; page++) {
    const part = text.shots.slice(page * PER, page * PER + PER);
    const args = ["-v", "error", "-y"], chains = [];
    let n = 0;
    part.forEach((r, i) => {
      const s = shots[r.shot];
      [s.start + 0.06, (s.start + s.end) / 2, s.end - 0.06].map((t) => Math.max(0, Math.min(t, last))).forEach((t, j) => {
        args.push("-ss", t.toFixed(3), "-i", framed);
        const sc = scaleAt(t, plan), ox = ORIGIN[0] * W, oy = ORIGIN[1] * H;
        // the frame grown about the origin, as the short shows it
        const grow = `scale=${Math.round(W * sc / 2) * 2}:${Math.round(H * sc / 2) * 2},crop=${W}:${H}:${Math.round(ox * (sc - 1))}:${Math.round(oy * (sc - 1))}`;
        const boxes = [draw(a, "yellow", 4)];
        if (chip) boxes.push(draw([a[0], a[1] + chip, a[2], 2], "yellow", 1));
        for (const f of s.faces) {
          const m = f.track.reduce((x, q) => (Math.abs(q.t - t) < Math.abs(x.t - t) ? q : x), f.track[0]);
          if (!m || Math.abs(m.t - t) > 0.3) continue;
          // raised before the push-in: the lift grows with the picture
          const by = r.lift * (m.zoom || 1);
          boxes.push(draw([m.box[0], m.box[1] - by, m.box[2], m.box[3]], "red@0.9", 2));
          if (m.feat) boxes.push(draw([m.box[0], m.feat[1] + 1.15 * m.feat[3] - by, m.box[2], 2], "orange", 2));
        }
        const label = j === 1 ? `${r.shot + 1}  ${s.start.toFixed(1)}-${s.end.toFixed(1)} s${r.lift ? `  raised ${r.lift} px` : ""}${r.fault ? "  ON THE MOUTH" : ""}` : ["first", "", "last"][j];
        chains.push(`[${n}:v]${grow},scale=${w}:${h},setsar=1,${boxes.join(",")},drawtext=text='${label.replace(/[\\':,%;\[\]]/g, " ")} ${t.toFixed(2)}':x=6:y=h-24:fontsize=14:fontcolor=white:box=1:boxcolor=${r.fault ? "red" : "black"}@0.8:boxborderw=3[c${i}_${j}]`);
        n++;
      });
      chains.push(`[c${i}_0][c${i}_1][c${i}_2]hstack=inputs=3,pad=iw:ih+6:0:0:white[r${i}]`);
    });
    const out = page ? file.replace(/\.jpg$/, `-${page + 1}.jpg`) : file;
    const graph = chains.join(";") + ";" + part.map((_, i) => `[r${i}]`).join("") + (part.length > 1 ? `vstack=inputs=${part.length}[s]` : "copy[s]");
    let r = spawnSync("ffmpeg", [...args, "-filter_complex", graph, "-map", "[s]", "-frames:v", "1", "-q:v", "4", out], { encoding: "utf8" });
    // an ffmpeg without text (no freetype) still draws the boxes
    if (r.status !== 0) r = spawnSync("ffmpeg", [...args, "-filter_complex", graph.replace(/,drawtext=[^\[;]*/g, ""), "-map", "[s]", "-frames:v", "1", "-q:v", "4", out], { encoding: "utf8" });
    if (r.status === 0 && fs.existsSync(out)) files.push(out);
  }
  return files;
}
