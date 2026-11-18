#!/usr/bin/env node
// The one who speaks, in the picture: footage wider than the short (a podcast's wide shot, 16:9)
// cut to the short's frame, the window on whoever speaks.
//
//   node tools/frame.mjs <video> <transcript.json> --aspect 9:16 --out <framed.mp4>
//        [--whole <s>,…] [--follow <s>,…]
//
// The shots: the footage's own cuts, to the frame (lib/cuts.mjs: every frame at the footage's
// rate, hard cuts and the short wipes and dissolves of a talk show alike), none shorter than six
// frames. A window never reaches over a cut.
//
// Who sits where: the clip goes to Gemini through OpenRouter (small, with its sound, and who
// speaks when after the transcript), with stills of every shot (its first frame, its middle, its
// last, and one every three seconds of a long shot): for each shot its kind and, on every still,
// every face with the voice it speaks with; and any cut the frames did not show (a possible cut
// of lib/cuts.mjs near one it names counts). Two cents a clip, asked once: the answer is kept
// next to the video (<video>.people.json). Without OpenRouter (OPENROUTER_API_KEY, or the Sprites
// gateway's OpenRouter connection) nothing is cut: the footage stays centred.
//
// The window: in a shot the face of the voice speaking, a third from the top (the type is below);
// a voice that speaks for less than a second and a half (a "ja", a laugh) moves nothing; a shot
// of someone else (a reaction) shows them. The face is known on every still, and between the
// stills followed in the frames (lib/track.mjs, ten a second): the window holds it all through,
// still where it can, wider where that is enough, else following it. A face low in a wide shot (an empty wall above it) is brought up by a closer window, as
// far as the footage's sharpness allows. Within a shot the window pans in 0.4 s to another
// speaker, at a cut it cuts. A wide shot (several people) from footage of 1440 lines and more is
// cut closer.
// What a window would cut apart is shown whole instead, above the captions over a blurred copy of
// itself: B-roll (a photo, archive footage, a place, a document, a screen) and a picture split
// into feeds side by side. Gemini says which a shot is, whether it shows the people or material
// (slides, a screen, a product), and what in it must be seen. A wide shot of the room in which
// someone of the conversation speaks is cut to them even when Gemini calls it B-roll or split
// (whole, a face there is 2 to 5 % of the short's height, and the channels' editors cut to who
// speaks there), but only when Gemini says it shows the people: material with the speaker small
// beside it stays whole, and so does a shot Gemini says nothing about, with a note in the list.
// Two who speak, too far apart for one window, go one above the other: a split screen of two
// voices always, a shot of both while they talk back and forth (three turns or more of under five
// seconds each); the window then stops swinging from one to the other.
//
// The tool checks its own windows: on every still and at each piece's first, middle and last
// frame, every face that the window cuts at its edge, or holds closer to an edge than 2 % of the
// frame's width, is named with its time.
// framed.mp4: 1080 wide, at the footage's frame rate and timing, with its sound, a keyframe every
// second (a preview seeks into it); framed.json the shots, the windows and the faces found at an
// edge; framed.sheet.jpg (and -2, -3, … for more than eight shots) per shot a row: the footage at
// its middle with the window drawn in, the frame at the shot's first, middle and last frame, a red
// mark where a face is at an edge.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { smallFrames, findCuts, confirmed, shotsBetween } from "./lib/cuts.mjs";
import { greyFrames, fillTrack, uncross } from "./lib/track.mjs";

export const FRAME_MODEL = "google/gemini-3.8-flash";
import { openrouter, GATEWAY_MAX } from "./lib/openrouter.mjs";
const SHORT_TURN = 1.5, PAN = 0.4, FACE_Y = 0.32;
// a face whose middle sits lower than this in its window is brought up by a closer window
const FACE_LOW = 0.4;
// a closer window keeps at least this share of the footage's height, and at least CLOSEST_LINES
// lines (fewer come out soft at 1920)
const CLOSEST = 0.55, CLOSEST_LINES = 960;
// the room a window keeps beside the face it holds (share of its width): to choose it, and to
// warn of a face closer to the edge than EDGE
const HOLD = 0.06, EDGE = 0.02;
// a window that follows a face goes along only when the face pushes at its edge, at most VMAX
// window widths a second, and turns back no sooner than REST seconds after its last turn; of a
// face wider than BIG of the window it holds the middle CORE of the face's width (the editors'
// close-ups cut the ears too)
const REST = 1, VMAX = 1.2, BIG = 0.5, CORE = 0.8, SLACK = 0.03;
// a face followed until here, then on a still without it: gone this long after it was last seen
const ABSENT_GAP = 0.15;
// stills of a shot: its first, middle and last frame, and one at least every STILL_EVERY seconds
const STILL_EVERY = 3, STILLS_MAX = 60;
// a face shown whole in a 9:16 frame is this share of the footage's height times 0.32: under
// SMALL_FACE of the footage's height it is too small to be seen on a phone
const SMALL_FACE = 0.12;
// where a shot shown whole sits in the frame, in thousandths of its height: above the captions,
// below the apps' top bar
const FIT_TOP = 0.115, FIT_BOTTOM = 0.645;
// two above each other: each panel this share of the height, from the top, a seam between; the
// captions sit on the lower one's chest, below its face
const PANEL = 0.36, SEAM = 6, PANEL_FACE_Y = 0.42, BANTER = 5, BANTER_TURNS = 3;
export const KINDS = ["people", "split", "broll"];

export const probe = (file) => {
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,start_time:format=duration,start_time", "-of", "json", file], { encoding: "utf8" }));
  const [a, b] = String(j.streams[0].r_frame_rate || "25/1").split("/").map(Number);
  return { width: j.streams[0].width, height: j.streams[0].height, fps: b ? a / b : 25, duration: Number(j.format.duration),
    // the picture's start after the file's own (ffmpeg's filters count from the file's start)
    start: Math.max(0, (Number(j.streams[0].start_time) || 0) - (Number(j.format.start_time) || 0)) };
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

// the cuts of the footage, to the frame, its frame count and each frame's time: { cuts, frames, times }
export function cutsOf(video, meta = probe(video)) {
  const frames = smallFrames(video);
  return { cuts: findCuts(frames, meta.fps), frames: frames.length, times: frames.times };
}

// the shots of the footage from its cuts (the possible ones where the model named a cut)
export function shotList({ cuts, frames, times }, meta, named = []) {
  return shotsBetween(confirmed(cuts, meta.fps, named, times), frames, meta.fps, { start: meta.start, times });
}

// the moments a model is shown of each shot: its first frame (past a wipe), its middle, its last,
// and one every STILL_EVERY seconds between; at most STILLS_MAX in all
export function stillsOf(shots, fps) {
  const out = [];
  const every = Math.max(STILL_EVERY, shots.reduce((t, s) => t + s.end - s.start, 0) / Math.max(1, STILLS_MAX - 2 * shots.length));
  shots.forEach((s, k) => {
    // past the wipe that brings the shot in
    const a = Math.max(s.start + 1.5 / fps, s.settled ?? 0), b = Math.min(s.end - 1.5 / fps, (s.leaving ?? Infinity) - 0.5 / fps);
    // an odd number, so that one still is the shot's middle
    let n = b - a < 0.5 ? 1 : Math.max(3, Math.ceil((b - a) / every) + 1);
    if (n % 2 === 0) n++;
    const ts = n === 1 ? [(s.start + s.end) / 2] : Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
    ts.forEach((t, i) => out.push({ shot: k, id: `${k + 1}.${i + 1}`, t: +t.toFixed(3) }));
  });
  return out;
}

const BOX = { type: "array", items: { type: "number" }, description: "[ymin, xmin, ymax, xmax] in thousandths of the image (0-1000)" };
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["shots", "missed_cuts"],
  properties: {
    shots: { type: "array", items: {
      type: "object", additionalProperties: false, required: ["shot", "kind", "material", "subject", "people", "stills"],
      properties: {
        shot: { type: "integer" },
        kind: { type: "string", enum: KINDS },
        material: { type: "boolean" },
        subject: BOX,
        people: { type: "array", items: {
          type: "object", additionalProperties: false, required: ["who", "speaker"],
          properties: { who: { type: "string" }, speaker: { type: ["string", "null"] } },
        } },
        stills: { type: "array", items: {
          type: "object", additionalProperties: false, required: ["still", "faces"],
          properties: {
            still: { type: "string" },
            faces: { type: "array", items: {
              type: "object", additionalProperties: false, required: ["person", "box_2d"],
              properties: { person: { type: "integer" }, box_2d: BOX },
            } },
          },
        } },
      },
    } },
    missed_cuts: { type: "array", items: { type: "number" } },
  },
};

const ask = async (or, content, log) => {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${or.base}/chat/completions`, {
        method: "POST",
        headers: { ...or.headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: FRAME_MODEL,
          messages: [{ role: "user", content }],
          response_format: { type: "json_schema", json_schema: { name: "people", strict: true, schema: SCHEMA } },
        }),
        signal: AbortSignal.timeout(300e3),
      });
      const j = await res.json();
      if (res.ok && j.choices) return j;
      if (attempt >= 3 || !(res.status === 429 || res.status >= 500)) throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
    } catch (e) {
      if (attempt >= 3 || /OpenRouter 4\d\d/.test(e.message)) throw e;
    }
    log(`frame: OpenRouter did not answer, again …`);
    await new Promise((r) => setTimeout(r, attempt * 5000));
  }
};

// the shots and the faces in them, from Gemini; kept in <video>.people.json:
// { version: 2, model, cost, shots: [{ start, end, kind, subject, people: [{ who, speaker }],
//   stills: [{ t, faces: [{ person, box_2d }] }] }], missed: [s] }
export async function locate(video, words, shots, meta, { log = () => {} } = {}) {
  const cache = video.replace(/\.[^.]+$/, "") + ".people.json";
  if (fs.existsSync(cache) && fs.statSync(cache).mtimeMs >= fs.statSync(video).mtimeMs) return JSON.parse(fs.readFileSync(cache, "utf8"));
  const or = await openrouter();
  if (!or) return null;
  const lines = turnsOf(words).map((t) => `[${t.start.toFixed(1)}–${t.end.toFixed(1)} s] ${t.speaker}: ${t.text}`).join("\n");
  const stills = stillsOf(shots, meta.fps);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frame-"));
  try {
    const small = path.join(tmp, "small.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-vf", "scale=640:-2", "-r", "10", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-c:a", "aac", "-b:a", "48k", "-ac", "1", small]);
    const images = stills.map((s, i) => {
      const f = path.join(tmp, `${i}.jpg`);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", s.t.toFixed(3), "-i", video, "-frames:v", "1", "-vf", "scale=768:-2", "-q:v", "5", f]);
      return fs.readFileSync(f).toString("base64");
    });
    const size = ((fs.statSync(small).size + images.reduce((n, b) => n + (b.length * 3) / 4, 0)) * 4) / 3;
    if (or.gateway && size > GATEWAY_MAX) {
      log(`frame: the clip is too large for the Sprites gateway (${GATEWAY_MAX / 1e6} MB a request): the footage stays as it is`);
      return null;
    }
    const list = shots.map((s, k) => `${k + 1}. ${s.start.toFixed(2)}–${s.end.toFixed(2)} s (stills ${stills.filter((x) => x.shot === k).map((x) => `${x.id} at ${x.t.toFixed(2)} s`).join(", ")})`).join("\n");
    const prompt = `This is a clip from a video podcast or talk. Speech recognition labelled the voices; these are the turns, with their times in the clip:

${lines}

The clip's camera shots, found from its frames:

${list}

Watch the video and listen. Find out which person in the picture each voice label belongs to (whose lips move, who gestures while that voice speaks).
Then, for each shot above, in this order (its number in "shot"):
- its kind: "people" when the camera shows people of the conversation itself (in the room or on a call, one or several in one picture, a wide shot of the room too);
  "split" when the picture is divided into separate feeds or pictures side by side (a split-screen call, two photos next to each other);
  "broll" for everything else: a photo, archive or news footage, a film clip, a place, an object, a document, a screen;
- material: true when the picture is mainly something shown or talked about (slides, a screen, a document, a product, a photo, footage), with any person of the conversation small beside or inside it (a speaker inset beside slides); false when it is mainly the people;
- its subject: the box of what must stay visible for the shot to make sense (the photo with everyone in it, both feeds, the scene; for "people" the people);
- its people: everyone visible in it, people in photos and footage included: who they are (a name or a short description, the same words for the same person in every shot) and the voice label they speak with (null if they do not speak in the clip);
- its stills (the images below, each labelled with its still and time): for every still of the shot, every face visible in it: the person (its place in the shot's people, from 0) and the box of the face, forehead to chin, ear to ear, as it is in that still (only its visible part when the face is partly out of the picture).
Boxes are [ymin, xmin, ymax, xmax] in thousandths of the picture (0–1000, from its top and its left edge).
missed_cuts: the time in seconds of every cut you see in the video that does not lie between two of the listed shots; none: an empty list.`;
    const content = [{ type: "text", text: prompt }, { type: "video_url", video_url: { url: `data:video/mp4;base64,${fs.readFileSync(small).toString("base64")}` } }];
    stills.forEach((s, i) => {
      content.push({ type: "text", text: `still ${s.id} (shot ${s.shot + 1}, ${s.t.toFixed(2)} s):` });
      // "low": a fourth of the tokens, the same boxes within a hundredth (measured on two stills)
      content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${images[i]}`, detail: "low" } });
    });
    log(`frame: who sits where, ${shots.length} shot(s), ${stills.length} stills (${FRAME_MODEL}) …`);
    const j = await ask(or, content, log);
    const text = j.choices[0].message.content || "";
    const ans = JSON.parse(text.replace(/^```(json)?\s*|\s*```$/g, ""));
    const byId = Object.fromEntries(stills.map((s) => [s.id, s]));
    const people = {
      version: 2, model: FRAME_MODEL, cost: j.usage?.cost ?? 0,
      shots: shots.map((s, k) => {
        // the shot's own entry: the one holding most of its stills (a model may count shots from 0)
        const own = (a) => (a.stills || []).filter((y) => byId[y.still]?.shot === k).length;
        const a = [...(ans.shots || [])].sort((p, q) => own(q) - own(p))[0];
        const entry = a && own(a) ? a : (ans.shots || []).find((x) => x.shot === k + 1) || {};
        const people = [...(entry.people || [])];
        // a still answered under another entry: its faces by who they are, added to this shot's people
        const faces = (x) => {
          for (const e of ans.shots || []) {
            const st = (e.stills || []).find((y) => y.still === x.id);
            if (!st) continue;
            if (e === entry) return st.faces || [];
            return (st.faces || []).map((f) => {
              const p = (e.people || [])[f.person];
              if (!p) return null;
              let i = people.findIndex((q) => (p.speaker != null ? q.speaker === p.speaker : q.who === p.who));
              if (i < 0) i = people.push(p) - 1;
              return { person: i, box_2d: f.box_2d };
            }).filter(Boolean);
          }
          return [];
        };
        return { start: s.start, end: s.end, kind: entry.kind, material: entry.material, subject: entry.subject, people,
          stills: stills.filter((x) => x.shot === k).map((x) => ({ t: x.t, faces: faces(x) })) };
      }),
      missed: (ans.missed_cuts || []).filter(Number.isFinite),
    };
    fs.writeFileSync(cache, JSON.stringify(people, null, 1));
    log(`frame: ${people.shots.length} shot(s)${people.missed.length ? `, cuts named that the frames did not show at ${people.missed.map((t) => t.toFixed(1)).join(", ")} s` : ""}, $${people.cost.toFixed(4)}`);
    return people;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// a box of thousandths in pixels: { x, y, w, h } (x, y its middle), or null
function pixels(b, { width, height }, { order = "yx" } = {}) {
  let l, t, r, bo;
  if (Array.isArray(b)) {
    if (b.length !== 4 || !b.every(Number.isFinite)) return null;
    [t, l, bo, r] = order === "yx" ? b : [b[1], b[0], b[3], b[2]];
  } else if (b && ["left", "top", "right", "bottom"].every((e) => Number.isFinite(b[e]))) ({ left: l, top: t, right: r, bottom: bo } = b);
  else return null;
  const c = (v) => Math.min(1000, Math.max(0, v)) / 1000;
  [l, r] = [c(l), c(r)].sort((p, q) => p - q);
  [t, bo] = [c(t), c(bo)].sort((p, q) => p - q);
  if (r - l <= 0 || bo - t <= 0) return null;
  return { x: ((l + r) / 2) * width, y: ((t + bo) / 2) * height, w: (r - l) * width, h: (bo - t) * height };
}

// an answer of the first kind (one face per person and shot, the shots' times the model's own)
// in the form of the second: each face a still at the middle of its shot
function current(people) {
  if (people?.version === 2) return people;
  return {
    version: 1, model: people?.model, cost: people?.cost ?? 0, missed: [],
    shots: (people?.shots || []).filter((s) => Number.isFinite(s.start)).map((s) => ({
      start: s.start, end: s.end, kind: s.kind,
      subject: s.subject && ["left", "top", "right", "bottom"].every((e) => Number.isFinite(s.subject[e])) ? [s.subject.top, s.subject.left, s.subject.bottom, s.subject.right] : null,
      people: (s.people || []).map((p) => ({ who: p.who, speaker: p.speaker })),
      stills: [{ t: (s.start + s.end) / 2, faces: (s.people || []).map((p, i) => (p.face ? { person: i, box_2d: [p.face.top, p.face.left, p.face.bottom, p.face.right] } : null)).filter(Boolean) }],
    })),
  };
}

// the shots of the footage with what the model saw in them: [{ start, end, kind, subject,
// people: [{ who, speaker, track: [{ t, x, y, w, h }] }], faces }] (faces: each person at the
// shot's middle, for the window's size). A shot takes its kind from the answer's shot it overlaps
// most, its faces from every still within it (from the nearest stills when none is)
export function shotsOf(answer, shots, meta) {
  const ans = current(answer);
  if (!ans.shots.length) return shots.map((s) => ({ ...s, kind: "people", subject: null, people: [], faces: [] }));
  return shots.map((s) => {
    const overlap = (a) => Math.min(a.end, s.end) - Math.max(a.start, s.start);
    const best = [...ans.shots].sort((a, b) => overlap(b) - overlap(a))[0];
    const from = ans.shots.filter((a) => overlap(a) > 0);
    // every person once, by voice, else by who they are
    const persons = [];
    const keyOf = (p) => (p.speaker != null ? `v:${p.speaker}` : `w:${String(p.who || "").toLowerCase()}`);
    const samples = [], seenAt = [];
    for (const a of from.length ? from : [best]) {
      let stills = a.stills.filter((x) => x.t >= s.start && x.t <= s.end);
      // only the shot's own stills say who is out of the picture
      for (const st of stills) seenAt.push(st.t);
      if (!stills.length) {
        const mid = (s.start + s.end) / 2;
        stills = [...a.stills].sort((p, q) => Math.abs(p.t - mid) - Math.abs(q.t - mid)).slice(0, 1).map((x) => ({ ...x, t: Math.min(s.end, Math.max(s.start, x.t)) }));
      }
      for (const st of stills) for (const f of st.faces) {
        const p = a.people[f.person];
        const box = pixels(f.box_2d, meta);
        if (!p || !box) continue;
        const key = keyOf(p);
        let person = persons.find((q) => q.key === key);
        if (!person) persons.push((person = { key, who: p.who, speaker: p.speaker == null ? null : String(p.speaker), track: [] }));
        samples.push([person, { t: st.t, ...box }]);
      }
    }
    for (const [person, sample] of samples) if (!person.track.some((x) => Math.abs(x.t - sample.t) < 1e-3)) person.track.push(sample);
    // a still on which a person is not: they are out of the picture then
    for (const p of persons) for (const t of seenAt) if (!p.track.some((x) => Math.abs(x.t - t) < 1e-3)) p.track.push({ t, absent: true });
    for (const p of persons) p.track.sort((a, b) => a.t - b.t);
    const people = persons.filter((p) => p.track.some((x) => !x.absent)).map(({ key, ...p }) => p);
    let kind = KINDS.includes(best.kind) ? best.kind : people.length ? "people" : "broll";
    const subject = (() => {
      const b = pixels(best.subject, meta);
      return b && b.w > meta.width * 0.05 && b.h > meta.height * 0.05 ? { x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h } : null;
    })();
    const mid = (s.start + s.end) / 2;
    const faces = people.map((p) => ({ speaker: p.speaker, who: p.who, ...seenFace(p, mid) }));
    // a wide shot of the room called B-roll or split: someone of the conversation speaks in it,
    // and shown whole their face would be too small to see. Only when the model says the picture
    // is the people, not material (slides, a screen, a product) with a speaker small beside it;
    // when it does not say, it stays whole and the list says how to cut it to the speaker
    let note;
    const small = kind !== "people" && people.some((p) => p.speaker != null) && faces.length && Math.max(...faces.map((f) => f.h)) < meta.height * SMALL_FACE;
    const pct = small && Math.round((Math.max(...faces.map((f) => f.h)) / meta.height) * 32);
    if (small && best.material === false) {
      note = `called ${kind}, but it shows the people and shown whole their faces would be ${pct} % of the frame's height: cut to who speaks (--whole shows it whole)`;
      kind = "people";
    } else if (small && best.material === true) note = `material with the speaker small in it (${pct} % of the frame's height): shown whole (--follow cuts to the speaker)`;
    else if (small) note = `shown whole, the speaker ${pct} % of the frame's height: a wide shot of the room is better cut to them (--follow), slides or a screen stay whole`;
    return { start: s.start, end: s.end, first: s.first, last: s.last, kind, subject, people, faces, ...(note ? { note } : {}) };
  });
}

// where a person's face is at t: between two stills on the straight line, before the first and
// after the last as there
// export: a person out of the picture (on a still without them, and no longer followed in the
// frames) has no face: null
export function faceAt(person, t) {
  const tr = person.track;
  if (!tr?.length) return null;
  const at = (s) => (s.absent ? null : { ...s, t });
  if (t <= tr[0].t) return at(tr[0]);
  if (t >= tr[tr.length - 1].t) return at(tr[tr.length - 1]);
  const k = tr.findIndex((s) => s.t >= t);
  const a = tr[k - 1], b = tr[k], f = (t - a.t) / (b.t - a.t);
  if (a.absent || b.absent) {
    // between the face seen and a still without it: there while the frames still show it
    if (a.absent && b.absent) return null;
    if (b.absent) return t - a.t <= ABSENT_GAP ? at(a) : null;
    return b.t - t <= ABSENT_GAP ? at(b) : null;
  }
  const mix = (p, q) => p + (q - p) * f;
  return { t, x: mix(a.x, b.x), y: mix(a.y, b.y), w: mix(a.w, b.w), h: mix(a.h, b.h) };
}

// the face at t, else where it was seen nearest to t
export function seenFace(person, t) {
  const f = faceAt(person, t);
  if (f) return f;
  const seen = person.track.filter((x) => !x.absent).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
  return seen ? { ...seen } : null;
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

// the window's corner at t, as the ffmpeg expression of render() computes it: held at each key,
// from a key's time a move to it over its `pan` seconds (PAN when none), eased or straight
const ease = (p, linear) => (linear ? p : p * p * (3 - 2 * p));
export function windowAt(piece, t) {
  const keys = piece.keys;
  const at = (axis) => {
    let v = keys[0][axis];
    for (let k = 1; k < keys.length; k++) {
      if (t < keys[k].t) continue;
      const p = Math.min(1, Math.max(0, (t - keys[k].t) / (keys[k].pan ?? PAN)));
      v = keys[k - 1][axis] + (keys[k][axis] - keys[k - 1][axis]) * ease(p, keys[k].linear);
    }
    return v;
  };
  return { x: at("x"), y: at("y"), w: piece.w, h: piece.h };
}

// the window over the footage, piece by piece: [{ start, end, kind, w, h, keys: [{ t, x, y,
// pan?, linear? }] }], w×h in the frame's shape, x/y its top left corner in the footage's pixels;
// a shot shown whole has `fit`, the part of the footage it shows; two above each other `stack`.
// `kinds` overrides a shot's kind: [{ t, kind }]. Each piece says how it holds its face (`hold`:
// still, wider, follows)
export function windowsOf(shots, timeline, { width, height, aspect, kinds = [], outW = 1080, fps = 25 }) {
  const [aw, ah] = aspect;
  const outH = Math.round((outW * ah) / aw / 2) * 2;
  const panelH = Math.round((outH * PANEL) / 2) * 2;
  const shortest = 6 / fps;
  const hMax = Math.min(height, (width * ah) / aw);
  const hMin = Math.min(hMax, Math.max(height * CLOSEST, Math.min(height, CLOSEST_LINES)));
  return shots.flatMap((s0, shot) => {
    const forced = kinds.find((o) => o.t >= s0.start && o.t < s0.end);
    let s = forced ? { ...s0, kind: forced.kind === "follow" ? "people" : forced.kind, single: forced.kind === "follow" } : s0;
    if (!s.people) s = { ...s, people: (s.faces || []).map((f) => ({ speaker: f.speaker, who: f.who, track: [{ t: (s.start + s.end) / 2, x: f.x, y: f.y, w: f.w, h: f.h }] })) };
    const faces = s.faces || s.people.map((p) => ({ speaker: p.speaker, ...seenFace(p, (s.start + s.end) / 2) }));
    // a wide shot (several people, their faces small) from footage sharp enough is cut closer
    const biggest = Math.max(0, ...faces.map((f) => f.h));
    const zoom = height >= 1400 && faces.length >= 2 && biggest < height * 0.22 ? 0.72 : 1;
    let h0 = Math.min(hMax, height * zoom);

    // the two who speak in it, left one first, when one window cannot hold both
    const voices = [];
    for (const f of [...faces].filter((f) => f.speaker != null).sort((a, b) => b.w * b.h - a.w * a.h)) if (!voices.some((v) => v.speaker === f.speaker)) voices.push(f);
    const pair = voices.length >= 2 ? voices.slice(0, 2).sort((a, b) => a.x - b.x) : null;
    const apart = pair && pair[1].x + pair[1].w / 2 - (pair[0].x - pair[0].w / 2) > ((h0 * aw) / ah) * 0.9;
    const panel = (f) => {
      let ph = Math.min(height, Math.max(height * 0.35, f.h / 0.38)), pw = (ph * outW) / panelH;
      if (pw > width) { pw = width; ph = (pw * panelH) / outW; }
      const even = (v) => Math.round(v / 2) * 2;
      return { x: even(Math.min(width - pw, Math.max(0, f.x - pw / 2))), y: even(Math.min(height - ph, Math.max(0, f.y - ph * PANEL_FACE_Y))), w: even(pw), h: even(ph) };
    };
    const stacked = (a, b) => ({ start: a, end: b, shot, kind: "stack", stack: [panel(pair[0]), panel(pair[1])], speakers: [pair[0].speaker, pair[1].speaker] });

    if (s.kind === "split" && pair && apart && !s.single) return [stacked(s.start, s.end)];
    if (s.kind !== "people") return [{ start: s.start, end: s.end, shot, kind: s.kind, fit: fitOf(s, { width, height }) }];

    const personOf = (speaker) => s.people.find((p) => p.speaker === speaker)
      // nobody of that voice in the picture: the one it shows (the biggest face)
      || [...s.people].sort((a, b) => (faceAt(b, s.start)?.h || 0) - (faceAt(a, s.start)?.h || 0))[0];
    // who speaks as the shot starts, and every change within it (none just before a cut)
    const before = timeline.filter((e) => e.t <= s.start).pop();
    const changes = [{ t: s.start, speaker: before?.speaker ?? timeline[0]?.speaker }, ...timeline.filter((e) => e.t > s.start && e.t < s.end - 1.2)];

    // back and forth: runs of short turns of the two, one above the other
    const runs = [];
    if (pair && apart && !s.single) {
      const turns = changes.map((c, k) => ({ ...c, end: changes[k + 1]?.t ?? s.end }));
      let run = [];
      const close = () => { if (run.length >= BANTER_TURNS) runs.push([run[0].t, run[run.length - 1].end]); run = []; };
      for (const t of turns) {
        if (t.end - t.t < BANTER && pair.some((f) => f.speaker === t.speaker)) run.push(t);
        else close();
      }
      close();
    }

    const single = (a, b) => {
      const at = changes.filter((c) => c.t <= a).pop() || changes[0];
      const list = [{ t: a, speaker: at.speaker }, ...changes.filter((c) => c.t > a && c.t < b)];
      // the stretches of one face: from a change to the next, the face at every still within
      const segs = list.map((c, k) => {
        const t1 = list[k + 1]?.t ?? b, person = personOf(c.speaker);
        const ts = [c.t, ...(person?.track || []).map((x) => x.t).filter((t) => t > c.t && t < t1), t1];
        return { t0: c.t, t1, person, at: person ? ts.map((t) => faceAt(person, t)).filter(Boolean) : [] };
      });
      // the window's height: closer where a face sits low (eyes high in the frame, not an empty
      // wall above them), never closer than the footage allows or than the face fits in
      let h = h0;
      for (const g of segs) {
        if (!g.at.length) continue;
        const fy = g.at.reduce((n, f) => n + f.y, 0) / g.at.length, fh = Math.max(...g.at.map((f) => f.h));
        const low = (fy - Math.min(height - h, Math.max(0, fy - h * FACE_Y))) / h;
        if (low > FACE_LOW) h = Math.min(h, Math.max(hMin, fh / 0.4, (height - fy) / (1 - FACE_Y)));
      }
      // wider where the face moves more than a still window holds (of a face as wide as the
      // window, its middle: CORE of its width)
      const core = (f, ww, m = HOLD) => (f.w > BIG * ww ? [f.x - (CORE / 2) * f.w - Math.min(m, SLACK) * ww, f.x + (CORE / 2) * f.w + Math.min(m, SLACK) * ww] : [f.x - f.w / 2 - m * ww, f.x + f.w / 2 + m * ww]);
      let hold = "still";
      for (const g of segs) {
        const fs = g.at.filter(Boolean);
        if (!fs.length) continue;
        const spanOf = (ww) => Math.max(...fs.map((f) => core(f, ww)[1])) - Math.min(...fs.map((f) => core(f, ww)[0]));
        if (spanOf((h * aw) / ah) <= (h * aw) / ah) continue;
        // the smallest height whose width holds every core, if the footage has it
        let need = h;
        while (need < hMax && spanOf((need * aw) / ah) > (need * aw) / ah) need = Math.min(hMax, need * 1.03);
        if (spanOf((need * aw) / ah) <= (need * aw) / ah) { h = need; if (hold === "still") hold = "wider"; }
        else hold = "follows";
      }
      const w = (h * aw) / ah;
      const clampX = (x) => Math.min(width - w, Math.max(0, x)), clampY = (y) => Math.min(height - h, Math.max(0, y));
      const keys = [];
      const push = (key) => {
        const last = keys[keys.length - 1];
        if (last && Math.abs(last.x - key.x) < w * 0.08 && Math.abs(last.y - key.y) < h * 0.08) return false;
        keys.push(key);
        return true;
      };
      let moves = 0;
      for (const g of segs) {
        const fs = g.at.filter(Boolean);
        if (!fs.length) { push({ t: g.t0, x: clampX((width - w) / 2), y: clampY((height - h) * 0.3) }); continue; }
        const y = clampY(fs.reduce((n, f) => n + f.y, 0) / fs.length - h * FACE_Y);
        const prev = keys[keys.length - 1];
        // the first place: a cut at the shot's start, a pan of PAN to a new speaker; from there
        // the window follows lazily (calm)
        const path = calm(g.person, g.t0, g.t1, { w, width, core, near: prev?.x });
        const added = push({ t: g.t0, x: +path[0].x.toFixed(1), y });
        let from = keys[keys.length - 1].t + (added && keys.length > 1 ? PAN : 0), fromX = keys[keys.length - 1].x;
        // the path as straight moves: a key where its direction or speed changes
        const pts = path.filter((p) => p.t >= from - 1e-6);
        for (let k = 1; k < pts.length; k++) {
          const a = pts[k - 1], b = pts[k], c = pts[k + 1];
          const slope = (b.x - fromX) / Math.max(1e-6, b.t - from);
          const straight = c && Math.abs(fromX + slope * (c.t - from) - c.x) < 2;
          if (straight) continue;
          if (Math.abs(b.x - fromX) >= 1) { keys.push({ t: +from.toFixed(3), x: +b.x.toFixed(1), y, pan: +(b.t - from).toFixed(3), linear: true }); moves++; }
          from = b.t; fromX = b.x;
        }
      }
      if (moves && hold !== "follows") hold = "follows";
      if (!keys.length) keys.push({ t: a, x: clampX((width - w) / 2), y: clampY((height - h) * 0.3) });
      return { start: a, end: b, shot, kind: "people", hold, w: Math.round(w / 2) * 2, h: Math.round(h / 2) * 2, keys: keys.map((k) => ({ ...k, x: +k.x.toFixed(1), y: +k.y.toFixed(1) })) };
    };
    const out = [];
    let t = s.start;
    for (const [a, b] of runs) {
      if (a - t >= shortest) out.push(single(t, a));
      else if (out.length) out[out.length - 1].end = a;
      out.push(stacked(out.length || a - t >= shortest ? a : t, b));
      t = b;
    }
    if (s.end - t >= shortest || !out.length) out.push(single(t, s.end));
    else out[out.length - 1].end = s.end;
    return out;
  });
}

// the window's place on one face from t0 to t1, every tenth of a second: [{ t, x }]. It rests
// while the face (its core) stays inside, and when the face pushes at an edge it goes along, at
// most VMAX window widths a second, only as far as needed; it does not turn back within REST
// seconds of its last turn unless the face itself (its core) would leave the window (a swaying
// head is let into the room beside it rather than chased), so a still face gets a still window,
// a walking one a gliding window. `near`: the place before
export function calm(person, t0, t1, { w, width, core, near = null }) {
  const room = (t) => {
    const f = faceAt(person, t);
    if (!f) return null;
    // a following window lets a face come closer to its edge than a still one is chosen with
    const [a, b] = core(f, w, SLACK);
    let lo = Math.max(0, b - w), hi = Math.min(width - w, a);
    if (lo > hi) lo = hi = Math.min(width - w, Math.max(0, f.x - w / 2));
    return [lo, hi];
  };
  const dt = 0.1, vmax = VMAX * w;
  const first = room(t0) || [0, width - w];
  let x = near == null ? (first[0] + first[1]) / 2 : Math.min(first[1], Math.max(first[0], near));
  let dir = 0, turned = -Infinity;
  const path = [{ t: t0, x }];
  for (let t = t0 + dt; t < t1 + dt - 1e-6; t += dt) {
    const at = Math.min(t, t1), r = room(at);
    if (r) {
      const want = Math.min(r[1], Math.max(r[0], x)) - x;
      const d = Math.sign(Math.round(want));
      // the face itself (not only the room beside it) about to leave: turn back all the same
      const f = faceAt(person, at), [a, b] = f ? core(f, w, 0) : [x, x + w];
      const leaving = a < x || b > x + w;
      if (d && (d === dir || at - turned >= REST || !dir || leaving)) {
        x += Math.max(-vmax * dt, Math.min(vmax * dt, want));
        if (d !== dir) { if (dir) turned = at; dir = d; }
      }
    }
    path.push({ t: at, x });
  }
  return path;
}

// the faces a window cuts at its edge or holds too close to it: [{ piece, shot, t, who, edge,
// gap, cut }] (gap: the room between face and edge, a share of the window's width; cut: part of
// the face is outside). Looked at on every still, and at each piece's first, middle and last frame
export function edgesOf(windows, shots, { fps = 25, width, height, at = [] } = {}) {
  const found = [];
  windows.forEach((p, k) => {
    const s = shots[p.shot];
    if (!s || p.fit || !s.people?.length) return;
    const times = new Set([p.start + 0.5 / fps, (p.start + p.end) / 2, p.end - 0.5 / fps, ...at.filter((t) => t > p.start && t < p.end)]);
    for (const person of s.people) for (const x of person.track) if (x.t > p.start && x.t < p.end) times.add(x.t);
    const biggest = Math.max(...s.people.map((q) => Math.max(...q.track.filter((x) => !x.absent).map((x) => x.h))));
    const rects = p.stack ? p.stack.map((r, i) => ({ r, only: p.speakers[i] })) : [{ r: null }];
    for (const t of [...times].sort((a, b) => a - b)) {
      for (const { r, only } of rects) {
        const win = r || windowAt(p, t);
        for (const person of s.people) {
          if (only != null && person.speaker !== only) continue;
          const f = faceAt(person, t);
          if (!f || f.h < 0.4 * biggest) continue;
          // the part of the face the footage has (a face half out of the picture is no window's fault)
          const l = Math.max(0, f.x - f.w / 2), rr = Math.min(width ?? Infinity, f.x + f.w / 2), top = f.y - f.h / 2, bot = f.y + f.h / 2;
          if (rr - l < 0.5 * f.w) continue;
          // a face wholly outside is not in the picture
          if (rr <= win.x || l >= win.x + win.w || bot <= win.y || top >= win.y + win.h) continue;
          const gaps = { left: (l - win.x) / win.w, right: (win.x + win.w - rr) / win.w, bottom: (win.y + win.h - bot) / win.h,
            // a forehead cut in a close-up is the editors' way: only half a face is a fault
            top: (top + f.h / 2 - win.y) / win.h };
          const [edge, gap] = Object.entries(gaps).sort((a, b) => a[1] - b[1])[0];
          // a close-up's face is as wide as the frame (the editors' too): only a cut into it counts,
          // and only beyond the model's own blur of a box (a tenth of the face)
          const big = f.w > BIG * win.w;
          const cut = gap < (big ? -((1 - CORE) / 2) * (edge === "left" || edge === "right" ? f.w / win.w : f.h / win.h) : -0.02);
          if (cut || (!big && edge !== "top" && edge !== "bottom" && gap < EDGE)) found.push({ piece: k, shot: p.shot, t: +t.toFixed(3), who: person.who || person.speaker, speaker: person.speaker, edge, gap: +gap.toFixed(3), cut });
        }
      }
    }
  });
  return found;
}

// ffmpeg's expression for a coordinate, as windowAt computes it
function moving(keys, axis) {
  const v = (k) => keys[k][axis].toFixed(1);
  let out = v(0);
  for (let k = 1; k < keys.length; k++) {
    const t0 = keys[k].t.toFixed(3), p = `clip((t-${t0})/${(keys[k].pan ?? PAN).toFixed(3)},0,1)`;
    const e = keys[k].linear ? p : `${p}*${p}*(3-2*${p})`;
    out = `if(lt(t,${t0}),${out},${v(k - 1)}+(${v(k)}-${v(k - 1)})*${e})`;
  }
  return out;
}

// the framed footage: each piece cut by its window, scaled to outW×outH, back to back, with the
// sound, at the footage's own timing; a shot shown whole sits between FIT_TOP and FIT_BOTTOM over a
// blurred, darker copy; a keyframe every second
export function render(video, windows, out, { outW, outH, fps, start = 0 }) {
  const parts = windows.map((s, k) => {
    // the pans' keys are times in the clip: the time starts anew only after the window
    const trim = `[0:v]trim=start=${s.start.toFixed(4)}:end=${s.end.toFixed(4)}`;
    if (s.stack) {
      const [a, b] = s.stack, panelH = Math.round((outH * PANEL) / 2) * 2;
      return `${trim},split=3[sa${k}][sb${k}][sg${k}];`
        + `[sg${k}]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},gblur=sigma=35,eq=brightness=-0.12[bg${k}];`
        + `[sa${k}]crop=w=${a.w}:h=${a.h}:x=${a.x}:y=${a.y},scale=${outW}:${panelH}:flags=lanczos[pa${k}];`
        + `[sb${k}]crop=w=${b.w}:h=${b.h}:x=${b.x}:y=${b.y},scale=${outW}:${panelH}:flags=lanczos[pb${k}];`
        + `[bg${k}][pa${k}]overlay=0:0[o${k}];[o${k}][pb${k}]overlay=0:${panelH + SEAM},setsar=1,setpts=PTS-STARTPTS[v${k}]`;
    }
    if (s.fit) {
      const top = Math.round(outH * FIT_TOP), room = Math.round(outH * (FIT_BOTTOM - FIT_TOP));
      const scale = Math.min(outW / s.fit.w, room / s.fit.h);
      const fw = Math.round((s.fit.w * scale) / 2) * 2, fh = Math.round((s.fit.h * scale) / 2) * 2;
      const fx = Math.round((outW - fw) / 2), fy = top + Math.round((room - fh) / 2);
      return `${trim},split=2[b${k}][f${k}];`
        + `[b${k}]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},gblur=sigma=35,eq=brightness=-0.12[bb${k}];`
        + `[f${k}]crop=w=${s.fit.w}:h=${s.fit.h}:x=${s.fit.x}:y=${s.fit.y},scale=${fw}:${fh}:flags=lanczos[ff${k}];`
        + `[bb${k}][ff${k}]overlay=${fx}:${fy},setsar=1,setpts=PTS-STARTPTS[v${k}]`;
    }
    const x = moving(s.keys, "x"), y = moving(s.keys, "y");
    return `${trim},crop=w=${s.w}:h=${s.h}:x='${x}':y='${y}',scale=${outW}:${outH}:flags=lanczos,setsar=1,setpts=PTS-STARTPTS[v${k}]`;
  });
  // footage whose picture starts a little after its sound (a frame, as cut from YouTube): the
  // first frame held that long, so that every frame plays at the time it had and the sound fits
  const lead = Math.round(start * fps);
  const graph = parts.join(";") + ";" + windows.map((_, k) => `[v${k}]`).join("") + `concat=n=${windows.length}:v=1:a=0,fps=${fps.toFixed(3)}${lead > 0 ? `,tpad=start=${lead}:start_mode=clone` : ""}[v]`;
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-filter_complex", graph, "-map", "[v]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-g", String(Math.max(1, Math.round(fps))), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", out], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("frame: ffmpeg could not cut the footage");
}

const SAY = { people: "follows who speaks", stack: "the two who speak, one above the other", split: "split picture, shown whole", broll: "B-roll, shown whole" };
const HOLDS = { still: "", wider: " (wider: the face moves)", follows: " (follows the face as it moves)" };
const sideOf = { left: "left", right: "right", top: "top", bottom: "bottom" };
// times as stretches: 9.6–10.4, 17.1
export function spans(times, gap = 0.3) {
  const out = [];
  for (const t of [...new Set(times)].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && t - last[1] <= gap) last[1] = t;
    else out.push([t, t]);
  }
  return out.map(([a, b]) => (b - a < 0.05 ? a.toFixed(1) : `${a.toFixed(1)}–${b.toFixed(1)}`));
}
export function edgeLine(e) {
  return `${e.who ?? "a face"} ${e.cut ? "cut by" : "close to"} the ${sideOf[e.edge]} edge at ${e.t.toFixed(1)} s`;
}

// per shot a row: the footage at its middle with the window drawn in, the frame at the shot's
// first, middle and last frame, labelled; a red frame and "EDGE" on a frame where a face is at
// an edge. Eight shots a sheet: file, file-2.jpg, … Every cell is taken from the video by an
// ffmpeg of its own, small, and the page is put together from the small pictures (one page of
// 4K cells at once took 6.4 GB). Returns the files written; `.missing` lists what could not be
// (a cell without a frame is grey and named there)
export function sheet(video, framed, windows, shots, edges, file, { fps = 25 } = {}) {
  const H = 300, FW = Math.round((H * 9) / 16 / 2) * 2, PER = 8;
  const files = [], missing = [];
  const meta = probe(video);
  const SW = Math.round((H * meta.width) / meta.height / 2) * 2;
  // the last frame both videos have
  const length = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", framed], { encoding: "utf8" }).stdout) || meta.duration;
  const last = Math.min(meta.duration, length) - 1.5 / fps;
  // drawtext takes no quotes, colons, commas or percent signs here
  const text = (s) => String(s).replace(/[\\':,%;\[\]]/g, " ");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheet-"));
  let fonts = true;
  // one cell: a frame of `src` at t (else up to a few frames earlier), scaled, with its marks
  const cell = (src, t, w, filters, out) => {
    for (const back of [0, 1, 2, 4, 8]) {
      const at = Math.max(0, t - back / fps);
      const vf = `scale=${w}:${H},setsar=1${filters.length ? "," + filters.join(",") : ""}`;
      const run = (f) => spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", at.toFixed(3), "-i", src, "-frames:v", "1", "-vf", f, "-q:v", "3", out], { encoding: "utf8" });
      fs.rmSync(out, { force: true });
      // an ffmpeg without fonts: the cells without their labels
      const bare = vf.replace(/,drawtext=.*$/, "");
      let r = run(fonts ? vf : bare);
      if (r.status !== 0 && fonts) { fonts = false; r = run(bare); }
      if (fs.existsSync(out) && fs.statSync(out).size > 0) return true;
    }
    spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=gray:s=${w}x${H}`, "-frames:v", "1", out]);
    return false;
  };
  try {
    for (let page = 0; page * PER < shots.length; page++) {
      const rows = shots.map((s, k) => ({ s, k })).slice(page * PER, page * PER + PER);
      const inputs = [];
      for (const { s, k } of rows) {
        // the shot's very first frame (its time less a hair: -ss gives the first frame from there)
        const ts = [s.start === 0 ? 0 : s.start + 0.5 / fps - 0.002, (s.start + s.end) / 2, Math.min(s.end - 0.5 / fps, last) - 0.002];
        const mid = ts[1];
        const piece = windows.find((w) => w.start <= mid && w.end > mid) || windows.find((w) => w.shot === k);
        const rects = !piece ? [] : piece.fit ? [piece.fit] : piece.stack ? piece.stack : [windowAt(piece, mid)];
        const scale = H / meta.height;
        const boxes = rects.map((r) => `drawbox=x=${Math.round(r.x * scale)}:y=${Math.round(r.y * scale)}:w=${Math.round(r.w * scale)}:h=${Math.round(r.h * scale)}:color=yellow:t=3`);
        const flagged = edges.filter((e) => e.shot === k);
        const label = `${k + 1}  ${s.start.toFixed(2)}-${s.end.toFixed(2)} s  ${piece ? (piece.kind === "people" ? `follows${piece.hold && piece.hold !== "still" ? ` (${piece.hold})` : ""}` : piece.kind) : ""}${flagged.length ? `  EDGE at ${spans(flagged.map((e) => e.t)).slice(0, 4).join(" ").replace(/–/g, " to ")} s` : ""}`;
        const c0 = path.join(tmp, `${k}-0.jpg`);
        if (!cell(video, mid, SW, [...boxes, `drawtext=text='${text(label)}':x=8:y=8:fontsize=17:fontcolor=white:box=1:boxcolor=black@0.75:boxborderw=4`], c0)) missing.push(`shot ${k + 1}: the footage at ${mid.toFixed(2)} s`);
        inputs.push(c0);
        ts.forEach((t, i) => {
          const bad = flagged.some((e) => Math.abs(e.t - t) < 0.6 / fps || (i === 1 && Math.abs(e.t - t) < 1e-3));
          const c = path.join(tmp, `${k}-${i + 1}.jpg`);
          const marks = [...(bad ? ["drawbox=x=0:y=0:w=iw:h=ih:color=red:t=8"] : []), `drawtext=text='${["first", "middle", "last"][i]} ${t.toFixed(2)}${bad ? " EDGE" : ""}':x=6:y=h-26:fontsize=15:fontcolor=white:box=1:boxcolor=${bad ? "red" : "black"}@0.8:boxborderw=3`];
          if (!cell(framed, t, FW, marks, c)) missing.push(`shot ${k + 1}: the frame at ${t.toFixed(2)} s`);
          inputs.push(c);
        });
      }
      const out = page ? file.replace(/\.jpg$/, `-${page + 1}.jpg`) : file;
      const chains = rows.map((_, r) => `[${4 * r}:v][${4 * r + 1}:v][${4 * r + 2}:v][${4 * r + 3}:v]hstack=inputs=4,pad=iw:ih+6:0:0:white[r${r}]`);
      const graph = chains.join(";") + ";" + rows.map((_, r) => `[r${r}]`).join("") + (rows.length > 1 ? `vstack=inputs=${rows.length}[s]` : "copy[s]");
      fs.rmSync(out, { force: true });
      spawnSync("ffmpeg", ["-v", "error", "-y", ...inputs.flatMap((f) => ["-i", f]), "-filter_complex", graph, "-map", "[s]", "-frames:v", "1", "-q:v", "4", out], { encoding: "utf8" });
      if (fs.existsSync(out) && fs.statSync(out).size > 0) files.push(out);
      else missing.push(`${path.basename(out)} (shots ${rows[0].k + 1}–${rows[rows.length - 1].k + 1})`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return Object.assign(files, { missing });
}

// does footage of this shape need cutting for the frame? (wider by more than 15 %)
export function needsFrame({ width, height }, [aw, ah]) {
  return width / height > (aw / ah) * 1.15;
}

export async function frame(video, words, { aspect = [9, 16], out, kinds = [], log = () => {} }) {
  const meta = probe(video);
  if (!needsFrame(meta, aspect)) return null;
  log("frame: the cuts, frame by frame …");
  const found = cutsOf(video, meta);
  let shots = shotList(found, meta);
  const people = await locate(video, words, shots, meta, { log });
  if (!people) return null;
  // the cuts the model saw and the frames only hinted at
  shots = shotList(found, meta, people.missed || []);
  const seen = shotsOf(people, shots, meta);
  // the faces between the stills, followed in the frames
  const grey = greyFrames(video, { start: meta.start });
  for (const s of seen) if (s.kind === "people") {
    for (const p of s.people) {
      p.track = fillTrack(grey, p.track, s.start, s.end);
      for (const d of p.track.doubtful) (s.doubtful ||= []).push({ who: p.who || p.speaker, t: d.t, off: d.off });
    }
    uncross(s.people);
  }
  const outW = 1080, outH = Math.round((outW * aspect[1]) / aspect[0] / 2) * 2;
  const windows = windowsOf(seen, speakerTimeline(words), { ...meta, aspect, kinds, outW });
  const edges = edgesOf(windows, seen, meta);
  const whole = windows.filter((s) => s.fit).length, two = windows.filter((s) => s.stack).length;
  log(`frame: ${seen.length} shot(s), ${windows.length} piece(s), ${whole ? `${whole} shown whole, ` : ""}${two ? `${two} with two above each other, ` : ""}${meta.width}×${meta.height} → ${outW}×${outH} …`);
  // written beside and moved over: a framed.mp4 linked into a preview is replaced, never overwritten
  const tmp = out.replace(/\.mp4$/, ".new.mp4");
  render(video, windows, tmp, { outW, outH, fps: meta.fps, start: meta.start });
  fs.rmSync(out, { force: true });
  fs.renameSync(tmp, out);
  fs.writeFileSync(out.replace(/\.mp4$/, ".json"), JSON.stringify({ footage: path.basename(video), aspect,
    shots: seen.map((s) => ({ start: s.start, end: s.end, kind: s.kind, ...(s.note ? { note: s.note } : {}), ...(s.doubtful ? { doubtful: s.doubtful } : {}), people: s.people })), windows, edges }, null, 1));
  const sheetFile = out.replace(/\.mp4$/, ".sheet.jpg");
  for (const f of fs.readdirSync(path.dirname(out))) if (/^framed\.sheet-\d+\.jpg$/.test(f) && out.endsWith("framed.mp4")) fs.rmSync(path.join(path.dirname(out), f));
  const sheets = sheet(video, out, windows, seen, edges, sheetFile, meta);
  return { out, windows, shots: seen, edges, sheets };
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
    kinds: [...at("whole", "broll"), ...at("follow", "follow")],
  });
  if (!r) console.log("Nothing to cut: the footage has the frame's shape, there is no OpenRouter (OPENROUTER_API_KEY, or a Sprite gateway), or the clip is too large for the gateway (said above).");
  else {
    console.log(`${opt("out")}: ${r.shots.length} shots, cut where the footage cuts; the window follows who speaks; what a window would cut apart is shown whole.`);
    r.shots.forEach((s, k) => {
      const pieces = r.windows.filter((w) => w.shot === k);
      const how = [...new Set(pieces.map((w) => SAY[w.kind] + (w.hold ? HOLDS[w.hold] : "")))].join(", then ");
      console.log(`  ${k + 1}. ${s.start.toFixed(2)}–${s.end.toFixed(2)} s  ${how}${s.note ? ` (${s.note})` : ""}`);
      const edges = r.edges.filter((e) => e.shot === k);
      const seen = new Set();
      for (const e of edges) {
        const key = `${e.who}|${e.edge}|${e.cut}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const all = spans(edges.filter((x) => `${x.who}|${x.edge}|${x.cut}` === key).map((x) => x.t));
        console.log(`     ⚠ ${e.who ?? "a face"} ${e.cut ? "cut by" : "close to"} the ${e.edge} edge at ${all.join(", ")} s`);
      }
      for (const d of s.doubtful || []) console.log(`     ⚠ the model put ${d.who ?? "a face"} at ${d.t.toFixed(1)} s ${d.off} px from where the frames before and after lead: that still is left out; look at the row`);
    });
    if (r.sheets.missing?.length) console.log(`The sheet is missing ${r.sheets.missing.join("; ")}: look at framed.mp4 there yourself (ffmpeg -ss <second> -i framed.mp4 -frames:v 1 look.jpg).`);
    if (r.sheets.length) console.log(`Look at ${r.sheets.join(", ")}: one row per shot as listed, the footage with the window in yellow, then the frame at the shot's first, middle and last frame; red where a face is at an edge.${r.edges.length ? " A ⚠ above: look at that row. On a face the window already follows, the footage gives no better window: keep it, or move the cut so that stretch is left out. Someone or something that matters left out of a window (a second person, a photo): `reframe --whole <second>` shows the shot whole (smaller; never for a close-up). A shot shown whole whose speaker should fill the frame: `--follow <second>`." : ""}`);
  }
}
