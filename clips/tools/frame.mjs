#!/usr/bin/env node
// The one who speaks, in the picture: footage wider than the short (a podcast's wide shot, 16:9)
// cut to the short's frame, the window on whoever speaks.
//
//   node tools/frame.mjs <video> <transcript.json> --aspect 9:16 --out <framed.mp4>
//
// Who sits where: the clip goes to Gemini through OpenRouter (small, with its sound, and who
// speaks when after the transcript): the camera shots and, in each, every face with the voice it
// speaks with. A cent a clip, asked once: the answer is kept next to the video
// (<video>.people.json). The shots start where the footage really cuts (ffmpeg's scene change
// near the time Gemini named). Without OpenRouter (OPENROUTER_API_KEY, or the Sprites gateway's
// OpenRouter connection) nothing is cut: the footage stays
// centred.
//
// The window: in a shot the face of the voice speaking, a third from the top (the type is below);
// a voice that speaks for less than a second and a half (a "ja", a laugh) moves nothing; a shot
// of someone else (a reaction) shows them. Within a shot the window pans in 0.4 s, at a cut it
// cuts. A wide shot (several people) from footage of 1440 lines and more is cut closer.
// What a window would cut apart is shown whole instead, above the captions over a blurred copy of
// itself: B-roll (a photo, archive footage, a place, a document, a screen) and a picture split
// into feeds side by side. Gemini says which a shot is and what in it must be seen.
// framed.mp4: 1080 wide, at the footage's frame rate, with its sound; framed.json the windows;
// framed.sheet.jpg each shot's middle, the footage beside the frame, to look at.

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const FRAME_MODEL = "google/gemini-3.8-flash";
import { openrouter, GATEWAY_MAX } from "./lib/openrouter.mjs";
const SHORT_TURN = 1.5, PAN = 0.4, FACE_Y = 0.32;
// where a shot shown whole sits in the frame, in thousandths of its height: above the captions,
// below the apps' top bar
const FIT_TOP = 0.115, FIT_BOTTOM = 0.645;
export const KINDS = ["people", "split", "broll"];

const probe = (file) => {
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", file], { encoding: "utf8" }));
  const [a, b] = String(j.streams[0].r_frame_rate || "25/1").split("/").map(Number);
  return { width: j.streams[0].width, height: j.streams[0].height, fps: b ? a / b : 25, duration: Number(j.format.duration) };
};

// who speaks when: the transcript's words in turns of one voice (for the model to read)
export function turnsOf(words) {
  const turns = [];
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
    if (w.speaker == null) continue;
    const t = turns[turns.length - 1];
    if (t && t.speaker === w.speaker && w.start - t.end < 1.0) { t.end = w.end; t.text += " " + w.text; }
    else turns.push({ speaker: String(w.speaker), start: w.start, end: w.end, text: w.text });
  }
  return turns;
}

// the cuts of the footage: where the picture changes at once
export function cutsOf(video) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", video, "-an", "-vf", "scale=320:-2,select=gt(scene\\,0.3),metadata=print", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 64 << 20 });
  return [...String(r.stderr).matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
}

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["shots"],
  properties: {
    shots: { type: "array", items: {
      type: "object", additionalProperties: false, required: ["start", "end", "kind", "subject", "people"],
      properties: {
        start: { type: "number" }, end: { type: "number" },
        kind: { type: "string", enum: KINDS },
        subject: { type: "object", additionalProperties: false, required: ["left", "top", "right", "bottom"],
          properties: { left: { type: "number" }, top: { type: "number" }, right: { type: "number" }, bottom: { type: "number" } } },
        people: { type: "array", items: {
          type: "object", additionalProperties: false, required: ["speaker", "face", "who"],
          properties: {
            speaker: { type: ["string", "null"] },
            who: { type: "string" },
            face: { type: "object", additionalProperties: false, required: ["left", "top", "right", "bottom"],
              properties: { left: { type: "number" }, top: { type: "number" }, right: { type: "number" }, bottom: { type: "number" } } },
          },
        } },
      },
    } },
  },
};

// the shots and the faces in them, from Gemini; kept in <video>.people.json
export async function locate(video, words, { log = () => {} } = {}) {
  const cache = video.replace(/\.[^.]+$/, "") + ".people.json";
  if (fs.existsSync(cache) && fs.statSync(cache).mtimeMs >= fs.statSync(video).mtimeMs) return JSON.parse(fs.readFileSync(cache, "utf8"));
  const or = await openrouter();
  if (!or) return null;
  const lines = turnsOf(words).map((t) => `[${t.start.toFixed(1)}–${t.end.toFixed(1)} s] ${t.speaker}: ${t.text}`).join("\n");
  const small = video.replace(/\.[^.]+$/, "") + ".small.mp4";
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-vf", "scale=640:-2", "-r", "10", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-c:a", "aac", "-b:a", "48k", "-ac", "1", small]);
  const prompt = `This is a clip from a video podcast. Speech recognition labelled the voices; these are the turns, with their times in the clip:

${lines}

Watch the video and listen. Find out which person in the picture each voice label belongs to (whose lips move, who gestures while that voice speaks).
Then list the camera shots of the clip (a new shot starts at every cut; a clip without cuts is one shot). For each shot:
- its kind: "people" when the camera shows people of the conversation itself (in the room or on a call, one or several in one picture);
  "split" when the picture is divided into separate feeds or pictures side by side (a split-screen call, two photos next to each other);
  "broll" for everything else: a photo, archive or news footage, a place, an object, a document, a screen;
- its subject: the box of what must stay visible for the shot to make sense (the photo with everyone in it, both feeds, the scene;
  for "people" the people), as its left, top, right and bottom edge in thousandths of the frame (0–1000; left and right from the left edge, top and bottom from the top edge);
- every person visible in it, people in photos and footage included: their face as such a box,
  and the voice label that person speaks with (null if they do not speak in the clip).`;
  if (or.gateway && (fs.statSync(small).size * 4) / 3 > GATEWAY_MAX) {
    fs.rmSync(small, { force: true });
    log(`frame: the clip is too large for the Sprites gateway (${GATEWAY_MAX / 1e6} MB a request): the footage stays as it is`);
    return null;
  }
  log(`frame: who sits where (${FRAME_MODEL}) …`);
  let j;
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(`${or.base}/chat/completions`, {
          method: "POST",
          headers: { ...or.headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: FRAME_MODEL,
            messages: [{ role: "user", content: [
              { type: "text", text: prompt },
              { type: "video_url", video_url: { url: `data:video/mp4;base64,${fs.readFileSync(small).toString("base64")}` } },
            ] }],
            response_format: { type: "json_schema", json_schema: { name: "people", strict: true, schema: SCHEMA } },
          }),
          signal: AbortSignal.timeout(300e3),
        });
        j = await res.json();
        if (res.ok && j.choices) break;
        if (attempt >= 3 || !(res.status === 429 || res.status >= 500)) throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
      } catch (e) {
        if (attempt >= 3 || /OpenRouter 4\d\d/.test(e.message)) throw e;
      }
      log(`frame: OpenRouter did not answer, again …`);
      await new Promise((r) => setTimeout(r, attempt * 5000));
    }
  } finally {
    fs.rmSync(small, { force: true });
  }
  const text = j.choices[0].message.content || "";
  let ans = JSON.parse(text.replace(/^```(json)?\s*|\s*```$/g, ""));
  if (Array.isArray(ans)) ans = { shots: ans };
  const people = { model: FRAME_MODEL, cost: j.usage?.cost ?? 0, shots: ans.shots || [] };
  fs.writeFileSync(cache, JSON.stringify(people, null, 1));
  log(`frame: ${people.shots.length} shot(s), $${people.cost.toFixed(4)}`);
  return people;
}

// the shots in order, back to back over the clip, each starting at the real cut nearest to the
// time Gemini named (within a second), faces in pixels
export function shotsOf(people, cuts, { width, height, duration }) {
  const shots = (people?.shots || []).filter((s) => Number.isFinite(s.start)).sort((a, b) => a.start - b.start);
  if (!shots.length) return [{ start: 0, end: duration, faces: [] }];
  const free = [...cuts];
  return shots.map((s, k) => {
    let start = k ? s.start : 0;
    if (k) {
      const near = free.reduce((best, c) => (Math.abs(c - s.start) < Math.abs(best - s.start) ? c : best), Infinity);
      if (Math.abs(near - s.start) <= 1) { start = near; free.splice(free.indexOf(near), 1); }
    }
    const faces = (s.people || []).filter((p) => p.face && ["left", "top", "right", "bottom"].every((e) => Number.isFinite(p.face[e])))
      .map((p) => {
        const c = (v) => Math.min(1000, Math.max(0, v)) / 1000;
        const [l, r] = [c(p.face.left), c(p.face.right)].sort((a, b) => a - b), [t, b] = [c(p.face.top), c(p.face.bottom)].sort((a, b) => a - b);
        return { speaker: p.speaker == null ? null : String(p.speaker), x: ((l + r) / 2) * width, y: ((t + b) / 2) * height, w: (r - l) * width, h: (b - t) * height };
      });
    // older answers name no kind: a shot without a face is B-roll
    const kind = KINDS.includes(s.kind) ? s.kind : faces.length ? "people" : "broll";
    const box = s.subject && ["left", "top", "right", "bottom"].every((e) => Number.isFinite(s.subject[e])) ? s.subject : null;
    const subject = box && (() => {
      const c = (v) => Math.min(1000, Math.max(0, v)) / 1000;
      const [l, r] = [c(box.left), c(box.right)].sort((a, b) => a - b), [t, b] = [c(box.top), c(box.bottom)].sort((a, b) => a - b);
      return r - l > 0.05 && b - t > 0.05 ? { x: l * width, y: t * height, w: (r - l) * width, h: (b - t) * height } : null;
    })();
    return { start, faces, kind, subject };
  }).map((s, k, all) => ({ ...s, end: all[k + 1] ? all[k + 1].start : duration }))
    .filter((s) => s.end - s.start > 0.05);
}

// who is shown from when: at every moment the voice heard most within 1.2 s around it, a lead
// held for less than 1.5 s (a "ja", an echo while the other goes on) changes nothing
export function speakerTimeline(words) {
  const ws = words.filter((w) => w.speaker != null);
  if (!ws.length) return [];
  const end = Math.max(...ws.map((w) => w.end)), step = 0.25, half = 1.2;
  const runs = [];
  for (let t = 0; t <= end; t += step) {
    const score = {};
    for (const w of ws) {
      const o = Math.min(w.end, t + half) - Math.max(w.start, t - half);
      if (o > 0) score[w.speaker] = (score[w.speaker] || 0) + o;
    }
    const lead = Object.entries(score).sort((a, b) => b[1] - a[1])[0]?.[0] ?? runs[runs.length - 1]?.speaker;
    if (lead == null) continue;
    if (runs.length && runs[runs.length - 1].speaker === String(lead)) runs[runs.length - 1].end = t + step;
    else runs.push({ speaker: String(lead), t, end: t + step });
  }
  // short leads go to the voice before them, until none is left
  for (let k = 1; k < runs.length;) {
    if (runs[k].end - runs[k].t < SHORT_TURN && k < runs.length - 1) { runs[k - 1].end = runs[k].end; runs.splice(k, 1); }
    else if (runs[k].speaker === runs[k - 1].speaker) { runs[k - 1].end = runs[k].end; runs.splice(k, 1); }
    else k++;
  }
  if (runs.length > 1 && runs[runs.length - 1].end - runs[runs.length - 1].t < SHORT_TURN) runs.pop();
  return runs.map((r, k) => ({ t: k ? r.t : 0, speaker: r.speaker }));
}

// the part of a shot shown whole: its subject with a little air, or all of it; the whole width
// when the subject fills most of it
function fitOf(s, { width, height }) {
  const b = s.kind === "split" || !s.subject ? { x: 0, y: 0, w: width, h: height } : s.subject;
  const ax = b.w * 0.04, ay = b.h * 0.04;
  let x = Math.max(0, b.x - ax), y = Math.max(0, b.y - ay);
  let w = Math.min(width - x, b.w + 2 * ax), h = Math.min(height - y, b.h + 2 * ay);
  if (w > width * 0.8) { x = 0; w = width; }
  if (h > height * 0.8) { y = 0; h = height; }
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  return { x: Math.round(x), y: Math.round(y), w: even(w), h: even(h) };
}

// the window over the footage, piece by piece: [{ start, end, kind, w, h, keys: [{ t, x, y }] }],
// w×h in the frame's shape, x/y its top left corner in the footage's pixels; a shot shown whole
// has `fit`, the part of the footage it shows. `kinds` overrides a shot's kind: [{ t, kind }]
export function windowsOf(shots, timeline, { width, height, aspect, kinds = [] }) {
  const [aw, ah] = aspect;
  return shots.map((s0) => {
    const forced = kinds.find((o) => o.t >= s0.start && o.t < s0.end);
    const s = forced ? { ...s0, kind: forced.kind } : s0;
    if (s.kind !== "people") return { start: s.start, end: s.end, kind: s.kind, fit: fitOf(s, { width, height }) };
    // a wide shot (several people, their faces small) from footage sharp enough is cut closer
    const biggest = Math.max(0, ...s.faces.map((f) => f.h));
    const zoom = height >= 1400 && s.faces.length >= 2 && biggest < height * 0.22 ? 0.72 : 1;
    let h = height * zoom, w = (h * aw) / ah;
    if (w > width) { w = width; h = (w * ah) / aw; }
    const place = (f) => ({
      x: Math.min(width - w, Math.max(0, f ? f.x - w / 2 : (width - w) / 2)),
      y: Math.min(height - h, Math.max(0, f ? f.y - h * FACE_Y : (height - h) * 0.3)),
    });
    const faceOf = (speaker) => s.faces.find((f) => f.speaker === speaker)
      // nobody of that voice in the picture: the one it shows (the biggest face)
      || [...s.faces].sort((a, b) => b.h * b.w - a.h * a.w)[0];
    // who speaks as the shot starts, and every change within it (none just before a cut)
    const before = timeline.filter((e) => e.t <= s.start).pop();
    const changes = [{ t: s.start, speaker: before?.speaker ?? timeline[0]?.speaker }, ...timeline.filter((e) => e.t > s.start && e.t < s.end - 1.2)];
    const keys = [];
    for (const c of changes) {
      const p = place(faceOf(c.speaker));
      const last = keys[keys.length - 1];
      if (last && Math.abs(last.x - p.x) < w * 0.08 && Math.abs(last.y - p.y) < h * 0.08) continue;
      keys.push({ t: c.t, ...p });
    }
    return { start: s.start, end: s.end, kind: s.kind, w: Math.round(w / 2) * 2, h: Math.round(h / 2) * 2, keys };
  });
}

// ffmpeg's expression for a coordinate: held at each key, a smooth pan of PAN s into the next
function moving(keys, axis) {
  const v = (k) => keys[k][axis].toFixed(1);
  let out = v(0);
  for (let k = 1; k < keys.length; k++) {
    const t0 = keys[k].t.toFixed(3), p = `clip((t-${t0})/${PAN},0,1)`;
    out = `if(lt(t,${t0}),${out},${v(k - 1)}+(${v(k)}-${v(k - 1)})*${p}*${p}*(3-2*${p}))`;
  }
  return out;
}

// the framed footage: each shot cut by its window, scaled to outW×outH, back to back, with the
// sound; a shot shown whole sits between FIT_TOP and FIT_BOTTOM over a blurred, darker copy
export function render(video, windows, out, { outW, outH, fps }) {
  const parts = windows.map((s, k) => {
    const trim = `[0:v]trim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},setpts=PTS-STARTPTS`;
    if (s.fit) {
      const top = Math.round(outH * FIT_TOP), room = Math.round(outH * (FIT_BOTTOM - FIT_TOP));
      const scale = Math.min(outW / s.fit.w, room / s.fit.h);
      const fw = Math.round((s.fit.w * scale) / 2) * 2, fh = Math.round((s.fit.h * scale) / 2) * 2;
      const fx = Math.round((outW - fw) / 2), fy = top + Math.round((room - fh) / 2);
      return `${trim},split=2[b${k}][f${k}];`
        + `[b${k}]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},gblur=sigma=35,eq=brightness=-0.12[bb${k}];`
        + `[f${k}]crop=w=${s.fit.w}:h=${s.fit.h}:x=${s.fit.x}:y=${s.fit.y},scale=${fw}:${fh}:flags=lanczos[ff${k}];`
        + `[bb${k}][ff${k}]overlay=${fx}:${fy},setsar=1[v${k}]`;
    }
    const x = moving(s.keys, "x"), y = moving(s.keys, "y");
    return `${trim},crop=w=${s.w}:h=${s.h}:x='${x}':y='${y}',scale=${outW}:${outH}:flags=lanczos,setsar=1[v${k}]`;
  });
  const graph = parts.join(";") + ";" + windows.map((_, k) => `[v${k}]`).join("") + `concat=n=${windows.length}:v=1:a=0,fps=${fps.toFixed(3)}[v]`;
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-filter_complex", graph, "-map", "[v]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", out], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("frame: ffmpeg could not cut the footage");
}

// each shot's middle as a row, the footage beside the frame, to see what the window left out
export function sheet(video, framed, windows, file) {
  const rows = windows.slice(0, 16), H = 320;
  const args = ["-v", "error", "-y"];
  for (const s of rows) {
    const t = ((s.start + s.end) / 2).toFixed(3);
    args.push("-ss", t, "-i", video, "-ss", t, "-i", framed);
  }
  const chains = rows.map((_, k) => `[${2 * k}:v]scale=-2:${H},setsar=1[o${k}];[${2 * k + 1}:v]scale=-2:${H},setsar=1,pad=iw+12:ih:12:0:white[r${k}];[o${k}][r${k}]hstack[row${k}]`);
  const graph = chains.join(";") + ";" + rows.map((_, k) => `[row${k}]`).join("") + (rows.length > 1 ? `vstack=inputs=${rows.length}[s]` : "copy[s]");
  const r = spawnSync("ffmpeg", [...args, "-filter_complex", graph, "-map", "[s]", "-frames:v", "1", "-q:v", "4", file], { encoding: "utf8" });
  return r.status === 0;
}

// does footage of this shape need cutting for the frame? (wider by more than 15 %)
export function needsFrame({ width, height }, [aw, ah]) {
  return width / height > (aw / ah) * 1.15;
}

export async function frame(video, words, { aspect = [9, 16], out, kinds = [], log = () => {} }) {
  const meta = probe(video);
  if (!needsFrame(meta, aspect)) return null;
  const people = await locate(video, words, { log });
  if (!people) return null;
  const shots = shotsOf(people, cutsOf(video), meta);
  const windows = windowsOf(shots, speakerTimeline(words), { ...meta, aspect, kinds });
  const outW = 1080, outH = Math.round((outW * aspect[1]) / aspect[0] / 2) * 2;
  const whole = windows.filter((s) => s.fit).length;
  log(`frame: ${windows.length} shot(s), ${whole ? `${whole} shown whole, ` : ""}${windows.reduce((n, s) => n + (s.keys?.length || 0), 0)} position(s), ${meta.width}×${meta.height} → ${outW}×${outH} …`);
  // written beside and moved over: a framed.mp4 linked into a preview is replaced, never overwritten
  const tmp = out.replace(/\.mp4$/, ".new.mp4");
  render(video, windows, tmp, { outW, outH, fps: meta.fps });
  fs.rmSync(out, { force: true });
  fs.renameSync(tmp, out);
  fs.writeFileSync(out.replace(/\.mp4$/, ".json"), JSON.stringify({ footage: path.basename(video), aspect, windows }, null, 1));
  const sheetFile = out.replace(/\.mp4$/, ".sheet.jpg");
  const sheetOk = sheet(video, out, windows, sheetFile);
  return { out, windows, sheet: sheetOk ? sheetFile : null };
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  const [video, transcript] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
  if (!video || !transcript || !opt("out")) { console.log("frame.mjs <video> <transcript.json> --aspect 9:16 --out <framed.mp4> [--whole <s>,…] [--follow <s>,…]"); process.exit(1); }
  const at = (k, kind) => String(opt(k) || "").split(",").filter(Boolean).map((v) => ({ t: Number(v), kind })).filter((o) => Number.isFinite(o.t));
  const raw = JSON.parse(fs.readFileSync(transcript, "utf8"));
  const r = await frame(video, Array.isArray(raw) ? raw : raw.words, {
    aspect: (opt("aspect") || "9:16").split(":").map(Number), out: opt("out"), log: console.error,
    kinds: [...at("whole", "broll"), ...at("follow", "people")],
  });
  if (!r) console.log("Nothing to cut: the footage has the frame's shape, there is no OpenRouter (OPENROUTER_API_KEY, or a Sprite gateway), or the clip is too large for the gateway (said above).");
  else {
    const say = { people: "follows who speaks", split: "split picture, shown whole", broll: "B-roll, shown whole" };
    console.log(`${opt("out")}: the footage follows who speaks; what a window would cut apart is shown whole.`);
    r.windows.forEach((s, k) => console.log(`  ${k + 1}. ${s.start.toFixed(1)}–${s.end.toFixed(1)} s  ${say[s.kind] || s.kind}`));
    if (r.sheet) console.log(`Look at ${r.sheet}: one row per shot as listed, the footage left, the frame right.`);
  }
}
