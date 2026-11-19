#!/usr/bin/env node
// The one who speaks, in the picture: footage wider than the short (a podcast's wide shot, 16:9)
// cut to the short's frame, the window on whoever speaks.
//
//   node tools/frame.mjs <video> <transcript.json> --aspect 9:16 --out <framed.mp4>
//        [--whole <s>,…] [--follow <s>,…] [--lift <s>:<px>,…]
//
// --lift raises the picture of the shot at <s> by <px> of the frame (clips.mjs place decides it,
// so that the captions clear a chin): the window moves down in the footage as far as it can, the
// rest over a ground, as under a shot shown whole.
//
// The shots: the footage's own cuts, to the frame (lib/cuts.mjs: every frame at the footage's
// rate, hard cuts and the short wipes and dissolves of a talk show alike), none shorter than six
// frames. A window never reaches over a cut.
//
// Who sits where: the clip goes to Gemini through OpenRouter (small, with its sound, and who
// speaks when after the transcript), with stills of every shot (its first frame, its middle, its
// last, and one every three seconds of a long shot): for each shot its kind and, on every still,
// every face with the voice it speaks with, the box of its eyes, nose and mouth and where it
// looks; and any cut the frames did not show (a possible cut of lib/cuts.mjs near one it names
// counts). Three to seven cents a clip, asked once: the answer is kept
// next to the video (<video>.people.json). Without OpenRouter (OPENROUTER_API_KEY, or the Sprites
// gateway's OpenRouter connection) nothing is cut: the footage stays centred.
//
// The window: in a shot the face of the voice speaking, a third from the top (the type is below);
// a voice that speaks for less than a second and a half (a "ja", a laugh) moves nothing; a shot
// of someone else (a reaction) shows them. The face is known on every still, and between the
// stills followed in the frames (lib/track.mjs, ten a second): the window holds it all through,
// still where it can, wider where that is enough, else following it; of a close-up it holds the
// eyes, nose and mouth with room on the side the face looks to (holdOf), calmly over a sway
// (calm). A face low in a wide shot (an empty wall above it) is brought up by a closer window, as
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
// frame, every face whose eyes, nose or mouth the window cuts at its edge or holds closer to it
// than 1.5 % of the frame's width (an answer without them: the face, 2 %) is named with its time,
// a fault; only an ear, a cheek or hair of a close-up at the edge is named as accepted. Each
// close-up's piece says how calm its window is and how long it holds the features (closeupOf).
// framed.mp4: 1080 wide, at the footage's frame rate and timing, with its sound, a keyframe every
// second (a preview seeks into it); framed.json the shots, the windows and the faces found at an
// edge; framed.sheet.jpg (and -2, -3, … for more than eight shots) per shot a row: the footage at
// its middle with the window drawn in, the frame at the shot's first, middle and last frame, a red
// mark where eyes, nose or mouth are at an edge.

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
// window widths a second, and turns back no sooner than REST seconds after its last turn
const REST = 1, VMAX = 1.2, BIG = 0.5, SLACK = 0.03;
// the room a following window keeps is taken as it is on average over SWAY seconds: a head that
// sways to and fro within them moves nothing, only the features about to leave do
const SWAY = 2;
// of a close-up (a face wider than BIG of the window) the window holds the eyes, nose and mouth
// never closer to its edge than FEAT_PAD of its width (best-takes' punch-in of 12 % takes 5.4 % of
// each side, and the model's box of a three-quarter view ends at the far eye), with room beside
// them: ROOM_BACK of the face's width or that pad and a little, and ROOM_FRONT of the face's width
// more on the side the face looks to; the back of the head, an ear, hair at the side may be cut
// (the channel's editors and OpusClip cut them so). Features at the edge: closer than FEAT_EDGE of
// the window's width. Chosen on the five passages of the three-way test: with 8 % and 22 % of the
// face a swaying close-up left the window too little play (0.65 turns a second), with a pad of
// 3.5 % of the face the far eye and a pair of glasses came to the edge in the rendered clips.
// Most of the head stays in (HEAD_IN of its box's width, a wish taken over a sway like the room):
// the room on the looking side takes what it leaves, at most ROOM_SHARE of the window's play. With
// none, half the frame stood empty before a face at a sway's end; with 80 % (or 65 % that the
// window must keep at once) the window followed the sway again (0.5 to 0.8 turns a second)
const ROOM_BACK = 0.05, ROOM_FRONT = 0.18, FEAT_PAD = 0.06, FEAT_EDGE = 0.015, HEAD_IN = 0.75, ROOM_SHARE = 0.5;
// an answer without the features (one of version 2): the middle CORE of the face's width (FRAME_CORE)
const CORE = Math.min(1, Math.max(0.5, Number(process.env.FRAME_CORE) || 0.8));

// what of a face a window of width ww must hold, [left, right] in the footage's pixels, with room
// m (a share of ww) beside it; m = 0: the least (turning back early so that it does not leave)
export function holdOf(f, ww, m = HOLD) {
  if (f.w <= BIG * ww) return [f.x - f.w / 2 - m * ww, f.x + f.w / 2 + m * ww];
  if (!f.feat) { const e = Math.min(m, SLACK) * ww; return [f.x - (CORE / 2) * f.w - e, f.x + (CORE / 2) * f.w + e]; }
  const { x0, x1, lean } = f.feat;
  // never closer to the edge than FEAT_PAD of the window (best-takes' punch-in takes 5.4 % of each side)
  const pad = FEAT_PAD * ww;
  const hard = [x0 - pad, x1 + pad];
  if (!m) return hard;
  // most of the head in the picture (HEAD_IN of its box's width), as far as the features allow:
  // where both do not fit, as much of the head as fits beside them
  const hl = f.x - f.w / 2, hr = f.x + f.w / 2, keep = Math.min(HEAD_IN * f.w, f.w);
  let must = [Math.min(hard[0], hr - keep), Math.max(hard[1], hl + keep)];
  if (must[1] - must[0] > ww) must = hl + hr < hard[0] + hard[1] ? [Math.min(hard[0], hard[1] - ww), hard[1]] : [hard[0], Math.max(hard[1], hard[0] + ww)];
  // the room beside the features, more on the side the face looks to, the window's middle on that
  // side of theirs: a wish that takes what the head leaves
  const back = Math.max(ROOM_BACK * f.w, pad + Math.min(m, SLACK) * ww), front = back + ROOM_FRONT * Math.abs(lean) * f.w;
  const mid = (x0 + x1) / 2;
  const room = lean <= -0.5 ? [Math.min(x0 - front, mid - ww / 2), x1 + back] : lean >= 0.5 ? [x0 - back, Math.max(x1 + front, mid + ww / 2)]
    : lean < 0 ? [x0 - front, x1 + back] : [x0 - back, x1 + front];
  const all = [Math.min(must[0], room[0]), Math.max(must[1], room[1])];
  if (all[1] - all[0] <= ww) return all;
  // not both: the head and the features, and towards the looking side half of what the window has
  // left (the other half is the window's play, so that it can rest over a sway)
  const left = (ww - (must[1] - must[0])) * ROOM_SHARE;
  if (left <= 0) return must;
  return lean < 0 ? [Math.max(room[0], must[0] - left), must[1]] : lean > 0 ? [must[0], Math.min(room[1], must[1] + left)] : must;
}
// a face followed until here, then on a still without it: gone this long after it was last seen
const ABSENT_GAP = 0.15;
// stills of a shot: its first, middle and last frame, and one at least every STILL_EVERY seconds
const STILL_EVERY = 3, STILLS_MAX = 60;
// a face shown whole in a 9:16 frame is this share of the footage's height times 0.32: under
// SMALL_FACE of the footage's height it is too small to be seen on a phone
const SMALL_FACE = 0.12;
// where a shot shown whole sits in the frame, in thousandths of its height: above the captions,
// below the apps' top bar
export const FIT_TOP = 0.115, FIT_BOTTOM = 0.645;
// two above each other: each panel this share of the height, from the top, a seam between; the
// captions sit on the lower one's chest, below its face
export const PANEL = 0.36, SEAM = 6;
const PANEL_FACE_Y = 0.42, BANTER = 5, BANTER_TURNS = 3;
export const KINDS = ["people", "split", "broll"];

// The size as shown: a phone stores an upright picture as a wide one with a rotation of 90 or −90
// (most Android takes, an iPhone's "Most Compatible" ones), and ffmpeg turns its frames upright when
// it reads them (the stills the model sees, the tracker's frames, the render), so every box of the
// footage is in px of the upright picture
export const turned = (stream) => Math.abs(Number(stream?.side_data_list?.find((d) => d.rotation != null)?.rotation ?? stream?.tags?.rotate ?? 0)) % 180 === 90;
export const probe = (file) => {
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,start_time:stream_side_data=rotation:stream_tags=rotate:format=duration,start_time", "-of", "json", file], { encoding: "utf8" }));
  const [a, b] = String(j.streams[0].r_frame_rate || "25/1").split("/").map(Number);
  const v = j.streams[0], t = turned(v);
  return { width: t ? v.height : v.width, height: t ? v.width : v.height, fps: b ? a / b : 25, duration: Number(j.format.duration),
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
// one of the eyes, the nose and the mouth: asked for each on its own, so that a mouth the model
// leaves out cannot pass as part of one box of all three (on a guest with glasses one box of
// eyes, nose and mouth ended at the nose on five of eight close-up stills); null where it is not
// in the picture
const PART = { type: ["array", "null"], items: { type: "number" }, description: "[ymin, xmin, ymax, xmax] in thousandths of the image (0-1000), or null where it is not in the picture" };
// where a face points, as seen in the picture
const LOOKS = ["left", "right", "camera"];
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
              type: "object", additionalProperties: false, required: ["person", "box_2d", "eyes_2d", "nose_2d", "mouth_2d", "looks"],
              properties: { person: { type: "integer" }, box_2d: BOX, eyes_2d: PART, nose_2d: PART, mouth_2d: PART, looks: { type: "string", enum: LOOKS } },
            } },
          },
        } },
      },
    } },
    missed_cuts: { type: "array", items: { type: "number" } },
  },
};

const ask = async (or, content, log, schema = SCHEMA, name = "people") => {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${or.base}/chat/completions`, {
        method: "POST",
        headers: { ...or.headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: FRAME_MODEL,
          messages: [{ role: "user", content }],
          response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
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
// { version: 4, model, cost, shots: [{ start, end, kind, subject, people: [{ who, speaker }],
//   stills: [{ t, faces: [{ person, box_2d, eyes_2d, nose_2d, mouth_2d, looks }] }] }], missed: [s] }
//   (version 3: one features_2d for all three; version 2: the faces without features and looks)
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
    // without the file's tags: a phone's video names the place it was recorded at, and ffmpeg
    // would carry that into the copy the model watches
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-map_metadata", "-1", "-vf", "scale=640:-2", "-r", "10", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-c:a", "aac", "-b:a", "48k", "-ac", "1", small]);
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
- its stills (the images below, each labelled with its still and time): for every still of the shot, every face visible in it: the person (its place in the shot's people, from 0); box_2d, the box of the face, forehead to chin, ear to ear, as it is in that still (only its visible part when the face is partly out of the picture); eyes_2d, the smallest box holding both its eyes with their brows (in a three-quarter view the far one too, with its outer corner, however narrow it looks; only in a full profile just the one eye that is seen), also behind glasses; nose_2d, its nose from between the eyes to the tip and the nostrils; mouth_2d, its lips from corner to corner, from the top of the upper lip to the bottom of the lower lip (an open mouth with its lower lip where it is); each only where it is in the picture, else null; looks: where the face points, as seen in the image: "left" or "right" (towards that side of the image: a three-quarter view or a profile), "camera" when it faces the camera or nearly.
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
      version: 4, model: FRAME_MODEL, cost: j.usage?.cost ?? 0,
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
              return { ...f, person: i };
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

// eyes, nose and mouth (the model's features_2d) as shares of the face's box, measured from its
// middle, and where the face points (lean: -1 left, 1 right, 0 the camera): { l, r, t, b, lean },
// or null where the answer has none or one that does not lie in the face. A face the model says
// looks at the camera with its features to one side of its box leans that way, less than halfway
// (holdOf's rule of the window's middle is for a face the model says looks to one side)
// (on twenty stills it called three three-quarter views "camera")
export function partsOf(face, feat, looks) {
  if (!face || !feat) return null;
  const l = (feat.x - feat.w / 2 - face.x) / face.w, r = (feat.x + feat.w / 2 - face.x) / face.w;
  const t = (feat.y - feat.h / 2 - face.y) / face.h, b = (feat.y + feat.h / 2 - face.y) / face.h;
  // a box mostly beside the face, or the whole face or a dot, is not the features
  if (Math.abs((l + r) / 2) > 0.5 || Math.abs((t + b) / 2) > 0.5 || r - l < 0.08 || r - l > 1.1) return null;
  const c = (v) => +Math.min(0.6, Math.max(-0.6, v)).toFixed(3);
  const lean = looks === "left" ? -1 : looks === "right" ? 1 : Math.min(0.45, Math.max(-0.45, l + r));
  return { l: c(l), r: c(r), t: c(t), b: c(b), lean: +lean.toFixed(2) };
}

// Whether the model's eyes, nose and mouth hold, against each other and against the head's box:
// { feat: the box of all three (the footage's pixels) } or { why } where they do not. Every part
// there, the eyes above the nose above the mouth, and from the eyes' top to the mouth's bottom at
// least SPAN_MIN of the head's height: on the stills of three talk-show clips and a podcast whose
// boxes were right it was 0.40 to 0.67 (the head's box from the hair to the chin); on the guest
// with glasses whose box ended at the nose, 0.29 to 0.37. An answer of version 3 (one box of all
// three) is checked by that share alone.
export const SPAN_MIN = 0.38;
export function featuresOf(f, meta) {
  const head = pixels(f.box_2d, meta);
  if (!head) return { why: "no head" };
  const share = (b) => `${Math.round((b.h / head.h) * 100)} % of the head's height`;
  if (!f.eyes_2d && !f.nose_2d && !f.mouth_2d) {
    const one = pixels(f.features_2d, meta);
    if (!one) return {};
    return one.h < SPAN_MIN * head.h ? { why: `eyes, nose and mouth only ${share(one)}: the mouth left out` } : { feat: one };
  }
  const [eyes, nose, mouth] = [f.eyes_2d, f.nose_2d, f.mouth_2d].map((b) => pixels(b, meta));
  const missing = [["the eyes", eyes], ["the nose", nose], ["the mouth", mouth]].filter(([, b]) => !b).map(([n]) => n);
  if (missing.length) return { why: `${missing.join(" and ")} not given` };
  if (!(eyes.y < nose.y && nose.y < mouth.y && mouth.y + mouth.h / 2 > nose.y + nose.h / 2)) return { why: "the mouth not below the nose, or the nose not below the eyes" };
  const x0 = Math.min(eyes.x - eyes.w / 2, nose.x - nose.w / 2, mouth.x - mouth.w / 2), x1 = Math.max(eyes.x + eyes.w / 2, nose.x + nose.w / 2, mouth.x + mouth.w / 2);
  const y0 = eyes.y - eyes.h / 2, y1 = mouth.y + mouth.h / 2;
  const all = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  if (all.h < SPAN_MIN * head.h) return { why: `eyes to mouth only ${share(all)}` };
  if (Math.abs(mouth.y - head.y) > head.h / 2 || Math.abs(mouth.x - head.x) > head.w / 2) return { why: "the mouth outside the head's box" };
  return { feat: all };
}
// where the model's features do not hold on any still of a person: the head's own proportions
// (on the stills whose features were right, the eyes' top at 0.38 to 0.46 of the box's height and
// the mouth's bottom at 0.79 to 0.94, the box from the hair to the chin; the low end of the mouth
// taken, so that a mouth line from them is never above the real one), as shares from the box's middle
export const PROPORTIONS = { l: -0.32, r: 0.32, t: -0.12, b: 0.36 };
// A still whose features jump against the stills beside it, which agree, while the face is said
// to look the same way, is the model's slip (a box on the ear instead of the eyes): left out and
// listed, as the tracker leaves out a head's box. Measured as the features' middle in shares of the
// head's box, which the tracker follows, so a head that moves does not count
export const JUMP = 0.2, AGREE = 0.12;
export function featureJumps(track) {
  const out = [];
  for (let changed = true; changed;) {
    changed = false;
    const a = track.filter((s) => s.parts && !s.absent);
    for (let i = 0; i < a.length && !changed; i++) {
      const m = a[i];
      // the nearest still on each side, or the two nearest on the one side there is
      const side = i === 0 ? [a[1], a[2]] : i === a.length - 1 ? [a[i - 1], a[i - 2]] : [a[i - 1], a[i + 1]];
      if (side.some((x) => !x) || side.some((x) => x.looks !== m.looks)) continue;
      const mid = (p) => [(p.l + p.r) / 2, (p.t + p.b) / 2];
      const [p, q] = side.map((x) => mid(x.parts)), at = mid(m.parts);
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) > AGREE) continue;
      const f = side[1].t === side[0].t ? 0 : (m.t - side[0].t) / (side[1].t - side[0].t);
      const between = i === 0 || i === a.length - 1 ? p : [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
      const off = Math.hypot(at[0] - between[0], at[1] - between[1]);
      if (off > JUMP) { out.push({ t: m.t, why: `jump ${Math.round(off * 100)} % of the face against the stills beside them` }); delete m.parts; changed = true; }
    }
  }
  return out;
}

// the features of a face at t: between two stills that have them on the straight line (still
// while the head does not turn, from the one to the other when it does), the head's own place
// from the track; before the first and after the last as there. `stills`: the two stills it
// comes from (the same one twice before the first and after the last)
const anchors = new WeakMap();
function partsAt(track, t) {
  let a = anchors.get(track);
  if (!a) anchors.set(track, (a = track.filter((s) => s.parts && !s.absent)));
  if (!a.length) return null;
  if (t <= a[0].t) return { ...a[0].parts, stills: [a[0].t, a[0].t] };
  if (t >= a[a.length - 1].t) return { ...a[a.length - 1].parts, stills: [a[a.length - 1].t, a[a.length - 1].t] };
  const k = a.findIndex((s) => s.t >= t), p = a[k - 1].parts, q = a[k].parts, f = (t - a[k - 1].t) / (a[k].t - a[k - 1].t);
  const mix = (key) => p[key] + (q[key] - p[key]) * f;
  return { l: mix("l"), r: mix("r"), t: mix("t"), b: mix("b"), lean: mix("lean"), stills: [a[k - 1].t, a[k].t] };
}
// Features further than this from the nearest still that has them are an estimate: they ride
// with the head's box, and a mouth that opens or a head that tips there is not seen (robe, the
// review of 2026-11-18: the mouth opened wide between the stills at 22.73 and 25.38 s, and the
// captions the list put on the lower lip lay on the open mouth)
export const FEAT_EST = 0.25;
// a face with its features in the footage's pixels: feat { x0, x1, y0, y1, lean, between? }
// (between: the two stills an estimate lies between, where it is one)
const withParts = (person, f) => {
  if (!f) return f;
  const p = partsAt(person.track, f.t);
  if (!p) return f;
  const far = Math.min(Math.abs(f.t - p.stills[0]), Math.abs(f.t - p.stills[1])) > FEAT_EST;
  return { ...f, feat: { x0: f.x + p.l * f.w, x1: f.x + p.r * f.w, y0: f.y + p.t * f.h, y1: f.y + p.b * f.h, lean: p.lean, ...(far ? { between: p.stills.map((x) => +x.toFixed(2)) } : {}) } };
};

// an answer of the first kind (one face per person and shot, the shots' times the model's own)
// in the form of the second: each face a still at the middle of its shot
function current(people) {
  if (people?.version >= 2) return people;
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
        const checked = featuresOf(f, meta);
        const parts = checked.feat ? partsOf(box, checked.feat, f.looks) : null;
        const why = checked.why || (checked.feat && !parts ? "a box that does not lie in the face" : null);
        samples.push([person, { t: st.t, ...box, ...(parts ? { parts } : {}), ...(f.looks ? { looks: f.looks } : {}), ...(why ? { doubt: why } : {}) }]);
      }
    }
    for (const [person, sample] of samples) if (!person.track.some((x) => Math.abs(x.t - sample.t) < 1e-3)) person.track.push(sample);
    // a still on which a person is not: they are out of the picture then
    for (const p of persons) for (const t of seenAt) if (!p.track.some((x) => Math.abs(x.t - t) < 1e-3)) p.track.push({ t, absent: true });
    for (const p of persons) p.track.sort((a, b) => a.t - b.t);
    // eyes, nose and mouth that do not hold (featuresOf) or jump (featureJumps): left out, the
    // stills beside them hold; where no still of a person holds, the head's proportions; listed
    const doubtful = [];
    for (const p of persons) {
      const name = p.who || p.speaker;
      for (const x of p.track) if (x.doubt) doubtful.push({ who: name, t: x.t, features: x.doubt });
      for (const d of featureJumps(p.track)) doubtful.push({ who: name, t: d.t, features: d.why });
      const seen = p.track.filter((x) => !x.absent);
      if (seen.some((x) => x.doubt) && !seen.some((x) => x.parts)) {
        for (const x of seen) {
          const lean = x.looks === "left" ? -1 : x.looks === "right" ? 1 : 0;
          x.parts = { ...PROPORTIONS, lean, guess: true };
        }
        for (const d of doubtful) if (d.who === name) d.guess = true;
      }
      for (const x of p.track) { delete x.doubt; delete x.looks; }
    }
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
    return { start: s.start, end: s.end, first: s.first, last: s.last, kind, subject, people, faces, ...(note ? { note } : {}), ...(doubtful.length ? { doubtful } : {}) };
  });
}

// where a person's face is at t: between two stills on the straight line, before the first and
// after the last as there
// export: a person out of the picture (on a still without them, and no longer followed in the
// frames) has no face: null. With `feat` where the answer has the features (withParts)
export function faceAt(person, t) {
  return withParts(person, headAt(person, t));
}
function headAt(person, t) {
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
  return seen ? withParts(person, { ...seen }) : null;
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
// how far the picture of a piece that follows a face may be raised in the frame without a ground:
// its window moved down in the footage as far as the footage goes, in px of the frame
export function roomBelow(w, height, outW = 1080) {
  if (w.fit || w.stack || !w.keys?.length) return 0;
  const lowest = Math.max(...w.keys.map((k) => k.y));
  return Math.max(0, ((height - (lowest + w.h)) * outW) / w.w);
}

// a shot's picture raised by px in the frame (clips' place: the captions clear its chin): its
// window first moved down in the footage as far as that goes, the rest over a ground (a blurred,
// darker copy, as under a shot shown whole), which the frame's bottom shows
export function raise(w, px, { height, outW = 1080 }) {
  if (!(px > 0) || w.fit || w.stack) return w;
  const free = Math.min(px, Math.floor(roomBelow(w, height, outW))), dy = (free * w.w) / outW;
  return { ...w, keys: w.keys.map((k) => ({ ...k, y: +(k.y + dy).toFixed(1) })), lift: { px, free, ground: px - free } };
}

export function windowsOf(shots, timeline, { width, height, aspect, kinds = [], lifts = [], outW = 1080, fps = 25 }) {
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
      // wider where the face moves more than a still window holds (of a close-up its eyes, nose
      // and mouth with room beside them: holdOf)
      const core = holdOf;
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
      const piece = { start: a, end: b, shot, kind: "people", hold, w: Math.round(w / 2) * 2, h: Math.round(h / 2) * 2, keys: keys.map((k) => ({ ...k, x: +k.x.toFixed(1), y: +k.y.toFixed(1) })) };
      const cu = closeupOf(piece, segs, fps);
      return cu ? { ...piece, closeup: cu } : piece;
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
    // a lift asked for this shot (clips' place, or --lift)
    const lift = lifts.filter((o) => o.t >= s0.start && o.t < s0.end).pop();
    return lift ? out.map((w) => raise(w, lift.px, { height, outW })) : out;
  });
}

// how calm a close-up's window is and how well it holds the face, frame by frame: { turns (a
// second), held (share of the close-up's time the features are in with their room), inside (with
// at least FEAT_PAD: not at the edge), seconds, features (whether the answer had them) }, or null
// when the piece has no close-up. `segs`: [{ t0, t1, person }], whom the window holds when
export function closeupOf(piece, segs, fps = 25) {
  const dt = 1 / fps;
  let n = 0, held = 0, inside = 0, turns = 0, dir = 0, prev = null, feat = false;
  for (let t = piece.start + dt / 2; t < piece.end; t += dt) {
    const x = windowAt(piece, t).x;
    const g = segs.find((s) => t >= s.t0 && t < s.t1), f = g?.person && faceAt(g.person, t);
    // the turns while it is a close-up (a pan to another speaker is none)
    if (!f || f.w <= BIG * piece.w) { prev = null; dir = 0; continue; }
    if (prev != null) {
      const v = (x - prev) / dt, d = Math.abs(v) < 2 ? 0 : Math.sign(v);
      if (d && dir && d !== dir) turns++;
      if (d) dir = d;
    }
    prev = x;
    n++;
    feat ||= !!f.feat;
    const [a, b] = holdOf(f, piece.w), [c, d] = holdOf(f, piece.w, 0);
    if (a >= x - 0.5 && b <= x + piece.w + 0.5) held++;
    if (c >= x - 0.5 && d <= x + piece.w + 0.5) inside++;
  }
  if (!n) return null;
  return { turns: +(turns / (n * dt)).toFixed(2), held: +(held / n).toFixed(3), inside: +(inside / n).toFixed(3), seconds: +(n * dt).toFixed(2), features: feat };
}

// the window's place on one face from t0 to t1, every tenth of a second: [{ t, x }]. It rests
// while the face with its room (holdOf: of a close-up the eyes, nose and mouth), taken over SWAY
// seconds, stays inside, and when it pushes at an edge it goes along, at most VMAX window widths a
// second, only as far as needed; it does not turn back within REST seconds of its last turn unless
// the features themselves (holdOf's least) would leave the window (a swaying head is let into the
// room beside it rather than chased), so a still face gets a still window, a walking one a
// gliding window. `near`: the place before
export function calm(person, t0, t1, { w, width, core, near = null }) {
  // where the window may be for a face to be held with room m: [lo, hi] of its left edge
  const span = (f, m) => {
    const [a, b] = core(f, w, m);
    let lo = Math.max(0, b - w), hi = Math.min(width - w, a);
    if (lo > hi) lo = hi = Math.min(width - w, Math.max(0, (a + b) / 2 - w / 2));
    return [lo, hi];
  };
  const dt = 0.1, vmax = VMAX * w;
  const closeUp = (t) => { const f = faceAt(person, t); return !!f && f.w > BIG * w; };
  // the room (a following window lets a face come closer to its edge than a still one is chosen
  // with), as it is on average over SWAY seconds around t (less at the ends, always as much before
  // t as after it, so that a face going one way is not led or followed): a head swaying to and fro
  // moves nothing
  const room = (t) => {
    let lo = 0, hi = 0, n = 0;
    // a face smaller than a close-up's (a wide shot, someone walking) as it is at t
    const half = closeUp(t) ? Math.max(0, Math.min(SWAY / 2, t - t0, t1 - t)) : 0;
    for (let u = t - half; u <= t + half + 1e-6; u += dt) {
      const f = faceAt(person, u);
      if (!f) continue;
      const r = span(f, SLACK);
      lo += r[0]; hi += r[1]; n++;
    }
    return n ? [lo / n, hi / n] : null;
  };
  const first = room(t0) || [0, width - w];
  let x = near == null ? (first[0] + first[1]) / 2 : Math.min(first[1], Math.max(first[0], near));
  let dir = 0, turned = -Infinity;
  const path = [{ t: t0, x }];
  for (let t = t0 + dt; t < t1 + dt - 1e-6; t += dt) {
    const at = Math.min(t, t1), r = room(at);
    let want = r ? Math.min(r[1], Math.max(r[0], x)) - x : 0;
    // the face itself (its features, not only the room beside them) about to leave, within the
    // next two tenths: the window goes at least as far as that needs, also straight back
    let hard = null;
    for (const u of closeUp(at) ? [at, at + dt, at + 2 * dt] : [at]) {
      const f = u <= t1 + 1e-6 && faceAt(person, u);
      if (!f) continue;
      const s = span(f, 0);
      hard = !hard ? s : Math.max(hard[0], s[0]) <= Math.min(hard[1], s[1]) ? [Math.max(hard[0], s[0]), Math.min(hard[1], s[1])] : hard;
    }
    const must = hard ? Math.min(hard[1], Math.max(hard[0], x)) - x : 0;
    const leaving = Math.abs(must) >= 0.5;
    if (leaving && (Math.sign(want) !== Math.sign(must) || Math.abs(want) < Math.abs(must))) want = must;
    const d = Math.sign(Math.round(want));
    if (d && (d === dir || at - turned >= REST || !dir || leaving)) {
      x += Math.max(-vmax * dt, Math.min(vmax * dt, want));
      if (d !== dir) { if (dir) turned = at; dir = d; }
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
          const big = f.w > BIG * win.w;
          const entry = { piece: k, shot: p.shot, t: +t.toFixed(3), who: person.who || person.speaker, speaker: person.speaker };
          if (f.feat && big) {
            // eyes, nose or mouth at the edge or over it: a fault; else only the side of the face
            // (an ear, a cheek, hair) cut or close: listed, the editors' way in a close-up
            // the features the footage has (a nose out of the picture itself is no window's fault)
            const e = { ...f.feat, x0: Math.max(0, f.feat.x0), x1: Math.min(width ?? Infinity, f.feat.x1) };
            const fg = { left: (e.x0 - win.x) / win.w, right: (win.x + win.w - e.x1) / win.w, top: (e.y0 - win.y) / win.h, bottom: (win.y + win.h - e.y1) / win.h };
            const [fe, fgap] = Object.entries(fg).sort((a, b) => a[1] - b[1])[0];
            if (fgap < FEAT_EDGE) { found.push({ ...entry, part: "features", edge: fe, gap: +fgap.toFixed(3), cut: fgap < 0 }); continue; }
            const side = gaps.left < gaps.right ? "left" : "right", sgap = Math.min(gaps.left, gaps.right);
            if (sgap < 0) found.push({ ...entry, part: "side", edge: side, gap: +sgap.toFixed(3), cut: sgap < 0 });
            continue;
          }
          // a small face, or a close-up of an answer without the features (its face as wide as the
          // frame, the editors' too): only a cut into it counts, beyond the model's blur of a box
          const cut = gap < (big ? -((1 - CORE) / 2) * (edge === "left" || edge === "right" ? f.w / win.w : f.h / win.h) : -0.02);
          if (cut || (!big && edge !== "top" && edge !== "bottom" && gap < EDGE)) found.push({ ...entry, edge, gap: +gap.toFixed(3), cut });
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
    // raised over a ground: the picture higher by lift.ground, the frame's bottom a blurred, darker copy
    if (s.lift?.ground > 0) {
      return `${trim},split=2[b${k}][f${k}];`
        + `[b${k}]crop=w=${s.w}:h=${s.h}:x='${x}':y='${y}',scale=${outW}:${outH},gblur=sigma=35,eq=brightness=-0.12[bb${k}];`
        + `[f${k}]crop=w=${s.w}:h=${s.h}:x='${x}':y='${y}',scale=${outW}:${outH}:flags=lanczos[ff${k}];`
        + `[bb${k}][ff${k}]overlay=0:${-Math.round(s.lift.ground)},setsar=1,setpts=PTS-STARTPTS[v${k}]`;
    }
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
  const what = e.part === "features" ? `the eyes, nose or mouth of ${e.who ?? "a face"}` : e.part === "side" ? `only the side (an ear, a cheek, hair) of ${e.who ?? "a face"}` : e.who ?? "a face";
  return `${what} ${e.cut ? "cut by" : "close to"} the ${sideOf[e.edge]} edge at ${e.t.toFixed(1)} s`;
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
        // red only for a fault: eyes, nose or mouth at the edge (an ear or a cheek is the editors' way)
        const flagged = edges.filter((e) => e.shot === k && e.part !== "side");
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

// Where a close-up's head moves or tips between two stills (its followed box leaves the straight
// line between them by more than MOVE of its height or width), its eyes, nose and mouth are not
// known in between: the stills place them in the head's box, and a head that tips down carries its
// mouth lower in it (robe, 2026-11-18: 0.4 of the features' height too high 1.3 s after a still).
// A still more there, at the moment furthest off the line, EXTRA at most a shot.
export const MOVE = 0.1, EXTRA = 3;
export function extraStills(seen, { height }, aspect = [9, 16]) {
  const ww = (height * aspect[0]) / aspect[1], out = [];
  seen.forEach((s, k) => {
    if (s.kind !== "people") return;
    const found = [];
    for (const p of s.people) {
      const tr = p.track.filter((x) => !x.absent), stills = tr.filter((x) => x.seen);
      for (let i = 0; i + 1 < stills.length; i++) {
        const a = stills[i], b = stills[i + 1];
        if (a.w <= BIG * ww || b.t - a.t < 1) continue;
        let worst = null;
        for (const x of tr) {
          if (x.t <= a.t + 0.3 || x.t >= b.t - 0.3) continue;
          const f = (x.t - a.t) / (b.t - a.t);
          const off = Math.max(Math.abs(x.y - (a.y + (b.y - a.y) * f)) / a.h, Math.abs(x.x - (a.x + (b.x - a.x) * f)) / a.w, Math.abs(x.h - (a.h + (b.h - a.h) * f)) / a.h);
          if (!worst || off > worst.off) worst = { t: x.t, off, x: x.x, y: x.y };
        }
        if (worst && worst.off > MOVE) found.push({ shot: k, t: +worst.t.toFixed(3), off: +worst.off.toFixed(2), who: p.who, speaker: p.speaker, box: { x: worst.x, y: worst.y } });
      }
    }
    out.push(...found.sort((p, q) => q.off - p.off).slice(0, EXTRA));
  });
  return out;
}
const EXTRA_SCHEMA = {
  type: "object", additionalProperties: false, required: ["stills"],
  properties: { stills: { type: "array", items: {
    type: "object", additionalProperties: false, required: ["still", "box_2d", "eyes_2d", "nose_2d", "mouth_2d", "looks"],
    properties: { still: { type: "string" }, box_2d: BOX, eyes_2d: PART, nose_2d: PART, mouth_2d: PART, looks: { type: "string", enum: LOOKS } },
  } } },
};
// the model's eyes, nose and mouth on the extra stills (images only, one face named in each), added
// to the answer's stills of the shot each falls in and kept in its cache
export async function locateMore(video, people, extra, meta, { log = () => {} } = {}) {
  const or = await openrouter();
  if (!or || !extra.length) return people;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frame-more-"));
  try {
    const content = [{ type: "text", text: `These are frames of a video clip. In each one person is named. For that person's face give box_2d, the box of the face, forehead to chin, ear to ear (only its visible part); eyes_2d, the smallest box holding both its eyes with their brows (in a three-quarter view the far one too; only in a full profile just the one eye that is seen), also behind glasses; nose_2d, its nose from between the eyes to the tip and the nostrils; mouth_2d, its lips from corner to corner, from the top of the upper lip to the bottom of the lower lip (an open mouth with its lower lip where it is); each only where it is in the picture, else null; looks: "left" or "right" (towards that side of the image), "camera" when it faces the camera or nearly. Boxes are [ymin, xmin, ymax, xmax] in thousandths of the picture (0–1000). One entry per frame, its "still" as labelled.` }];
    extra.forEach((x, i) => {
      const f = path.join(tmp, `${i}.jpg`);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", x.t.toFixed(3), "-i", video, "-map_metadata", "-1", "-frames:v", "1", "-vf", "scale=768:-2", "-q:v", "5", f]);
      content.push({ type: "text", text: `still x${i + 1} (${x.t.toFixed(2)} s): ${x.who || "the person"}, the face around x ${Math.round((x.box.x / meta.width) * 1000)}, y ${Math.round((x.box.y / meta.height) * 1000)} (thousandths):` });
      content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${fs.readFileSync(f).toString("base64")}`, detail: "low" } });
    });
    log(`frame: ${extra.length} still(s) more where a close-up's head moves or tips (${FRAME_MODEL}) …`);
    const j = await ask(or, content, log, EXTRA_SCHEMA, "features");
    const ans = JSON.parse((j.choices[0].message.content || "").replace(/^```(json)?\s*|\s*```$/g, ""));
    const out = structuredClone(people);
    let added = 0;
    for (const [i, x] of extra.entries()) {
      // (a model may write the label as "still x1" or "x1")
      const a = (ans.stills || []).find((y) => String(y.still).match(/(\d+)\D*$/)?.[1] === String(i + 1)) || (ans.stills?.length === extra.length ? ans.stills[i] : null);
      const sh = out.shots.find((q) => x.t >= q.start && x.t <= q.end);
      if (!a || !sh) { log(`frame: no answer for the still more at ${x.t.toFixed(2)} s (${JSON.stringify(ans).slice(0, 160)})`); continue; }
      let person = (sh.people || []).findIndex((q) => (x.speaker != null && q.speaker != null ? String(q.speaker) === String(x.speaker) : q.who === x.who));
      if (person < 0 && (sh.people || []).length === 1) person = 0;
      if (person < 0) { log(`frame: ${x.who ?? "the face"} at ${x.t.toFixed(2)} s is not among the shot's people`); continue; }
      sh.stills.push({ t: x.t, extra: true, faces: [{ person, box_2d: a.box_2d, eyes_2d: a.eyes_2d, nose_2d: a.nose_2d, mouth_2d: a.mouth_2d, looks: a.looks }] });
      sh.stills.sort((p, q) => p.t - q.t);
      added++;
    }
    out.extra = { stills: added, cost: j.usage?.cost ?? 0 };
    out.cost = (out.cost || 0) + (j.usage?.cost ?? 0);
    log(`frame: ${added} still(s) added, $${(j.usage?.cost ?? 0).toFixed(4)}`);
    return out;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// The agent's own boxes of a face, read off a grid picture where no model may see the footage, in
// the form of the model's answer: one person, every box a still of the shot it falls in, no eyes,
// nose or mouth (the head's proportions stand in for them wherever a box is used). `tracks`: one
// list of { t, box: [x, y, w, h] } (px of the footage) per person.
export function answerOf(tracks, shots, { width, height }) {
  const k = (v, n) => +Math.min(1000, Math.max(0, (v / n) * 1000)).toFixed(1);
  return {
    version: 4, model: "the agent's eyes", cost: 0, by: "eye", extra: { stills: 0, cost: 0 }, missed: [],
    shots: shots.map((s) => ({
      start: s.start, end: s.end, kind: "people", material: false, subject: null,
      people: tracks.map((_, i) => ({ who: tracks.length > 1 ? `person ${i + 1}` : "the speaker", speaker: null })),
      stills: [...new Set(tracks.flat().filter((m) => m.t >= s.start && m.t <= s.end).map((m) => m.t))].sort((a, b) => a - b).map((t) => ({
        t, faces: tracks.flatMap((tr, i) => tr.filter((m) => m.t === t).map((m) => ({ person: i, box_2d: [k(m.box[1], height), k(m.box[0], width), k(m.box[1] + m.box[3], height), k(m.box[0] + m.box[2], width)], eyes_2d: null, nose_2d: null, mouth_2d: null, looks: "camera" }))),
      })),
    })),
  };
}

// The shots of the footage and every face in them followed between the stills: { meta, shots,
// seen, people } (seen: shotsOf's shots with each person's track filled in by the tracker), or
// null without an answer. `tracks`: the agent's own boxes instead of the model's (answerOf).
async function facesOf(video, words, { aspect = [9, 16], tracks = null, log = () => {} }) {
  const meta = probe(video);
  log("frame: the cuts, frame by frame …");
  const found = cutsOf(video, meta);
  let shots = shotList(found, meta);
  let people = tracks ? answerOf(tracks, shots, meta) : await locate(video, words, shots, meta, { log });
  if (!people) return null;
  // the cuts the model saw and the frames only hinted at
  if (!tracks) shots = shotList(found, meta, people.missed || []);
  // the faces between the stills, followed in the frames
  const grey = greyFrames(video, { start: meta.start });
  const follow = (answer) => {
    const seen = shotsOf(answer, shots, meta);
    for (const s of seen) if (s.kind === "people") {
      for (const p of s.people) {
        p.track = fillTrack(grey, p.track, s.start, s.end);
        for (const d of p.track.doubtful) (s.doubtful ||= []).push({ who: p.who || p.speaker, t: d.t, off: d.off });
      }
      uncross(s.people);
    }
    return seen;
  };
  let seen = follow(people);
  // a still more where a close-up's head moves or tips between two (once: the answer keeps them)
  if (people.version >= 4 && !people.extra) {
    const extra = extraStills(seen, meta, aspect);
    people = extra.length ? await locateMore(video, people, extra, meta, { log }) : { ...people, extra: { stills: 0, cost: 0 } };
    fs.writeFileSync(video.replace(/\.[^.]+$/, "") + ".people.json", JSON.stringify(people, null, 1));
    if (people.extra.stills) seen = follow(people);
  }
  return { meta, shots, seen, people };
}

// Every face of the footage over time, in its own pixels, every `step` seconds: for a skill that
// places the picture itself (best-takes on its own, by agentitos' layout), from footage of any
// shape. { footage, size, step, by, cost, shots: [{ start, end, kind, note?, doubtful? }], faces:
// [{ t, boxes: [{ who, box: [x, y, w, h], feat?: [x, y, w, h], between? }] }] }: box the head's,
// feat the eyes, nose and mouth where the model's hold (between: the two stills they are an
// estimate between), best-takes' source/faces.json for one video.
export function facesOver(seen, meta, { step = 0.1 } = {}) {
  const faces = [];
  for (const s of seen) {
    if (s.kind !== "people") continue;
    for (let t = s.start; t < s.end - 1e-6; t += step) {
      const boxes = [];
      for (const p of s.people) {
        const f = faceAt(p, t);
        if (!f) continue;
        const r = (v) => Math.round(v);
        boxes.push({ who: p.who ?? p.speaker, box: [r(f.x - f.w / 2), r(f.y - f.h / 2), r(f.w), r(f.h)],
          ...(f.feat ? { feat: [r(f.feat.x0), r(f.feat.y0), r(f.feat.x1 - f.feat.x0), r(f.feat.y1 - f.feat.y0)] } : {}), ...(f.feat?.between ? { between: f.feat.between } : {}) });
      }
      if (boxes.length) faces.push({ t: +t.toFixed(3), boxes });
    }
  }
  return {
    size: [meta.width, meta.height], step,
    shots: seen.map((s) => ({ start: +s.start.toFixed(3), end: +s.end.toFixed(3), kind: s.kind, ...(s.note ? { note: s.note } : {}), ...(s.doubtful ? { doubtful: s.doubtful } : {}) })),
    faces,
  };
}

export async function faces(video, words, { aspect = [9, 16], tracks = null, log = () => {} } = {}) {
  const r = await facesOf(video, words, { aspect, tracks, log });
  if (!r) return null;
  return { footage: path.basename(video), by: r.people.by || "model", model: r.people.model, cost: +((r.people.cost || 0)).toFixed(4), ...facesOver(r.seen, r.meta) };
}

export async function frame(video, words, { aspect = [9, 16], out, kinds = [], lifts = [], log = () => {} }) {
  const meta0 = probe(video);
  if (!needsFrame(meta0, aspect)) return null;
  const found = await facesOf(video, words, { aspect, log });
  if (!found) return null;
  const { meta, seen } = found;
  const outW = 1080, outH = Math.round((outW * aspect[1]) / aspect[0] / 2) * 2;
  const windows = windowsOf(seen, speakerTimeline(words), { ...meta, aspect, kinds, lifts, outW });
  const edges = edgesOf(windows, seen, meta);
  const whole = windows.filter((s) => s.fit).length, two = windows.filter((s) => s.stack).length;
  log(`frame: ${seen.length} shot(s), ${windows.length} piece(s), ${whole ? `${whole} shown whole, ` : ""}${two ? `${two} with two above each other, ` : ""}${meta.width}×${meta.height} → ${outW}×${outH} …`);
  // written beside and moved over: a framed.mp4 linked into a preview is replaced, never overwritten
  const tmp = out.replace(/\.mp4$/, ".new.mp4");
  render(video, windows, tmp, { outW, outH, fps: meta.fps, start: meta.start });
  fs.rmSync(out, { force: true });
  fs.renameSync(tmp, out);
  fs.writeFileSync(out.replace(/\.mp4$/, ".json"), JSON.stringify({ footage: path.basename(video), aspect, size: [meta.width, meta.height],
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
  const all = (k) => args.flatMap((a, i) => (a === `--${k}` && args[i + 1] !== undefined ? [args[i + 1]] : []));
  const [video, transcript] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
  const usage = "frame.mjs <video> <transcript.json> --aspect 9:16 --out <framed.mp4> [--whole <s>,…] [--follow <s>,…] [--lift <s>:<px>,…]\n   or: frame.mjs <video> <transcript.json> --faces <faces.json> [--face-at <s>:x,y,w,h …| --face-track <file.json>]";
  if (!video || !transcript || !(opt("out") || opt("faces"))) { console.log(usage); process.exit(1); }
  if (opt("faces")) {
    // the faces alone, in the footage's pixels: the model's, or the agent's own boxes followed by the tracker
    let tracks = null;
    if (all("face-at").length) tracks = [all("face-at").map((v) => {
      const m = String(v).match(/^(\d+(?:\.\d+)?):(-?[\d.]+),(-?[\d.]+),([\d.]+),([\d.]+)$/);
      if (!m) { console.log(`--face-at is <second>:x,y,w,h in px of the footage, as 2.5:300,570,600,900 (read off a grid picture), not "${v}".`); process.exit(1); }
      return { t: Number(m[1]), box: m.slice(2).map(Number) };
    })];
    else if (opt("face-track")) {
      try { const j = JSON.parse(fs.readFileSync(opt("face-track"), "utf8")); tracks = Array.isArray(j[0]) ? j : [j]; } catch (e) { console.log(`--face-track ${opt("face-track")} cannot be read (${e.message}): it is a list of {"t": seconds, "box": [x, y, w, h]}, or one such list per person.`); process.exit(1); }
      if (!tracks.every((tr) => tr.length && tr.every((m) => Number.isFinite(m.t) && Array.isArray(m.box) && m.box.length === 4 && m.box.every(Number.isFinite)))) { console.log(`--face-track ${opt("face-track")}: every moment is {"t": seconds, "box": [x, y, w, h]} in px of the footage.`); process.exit(1); }
    }
    const raw = JSON.parse(fs.readFileSync(transcript, "utf8"));
    const r = await faces(video, Array.isArray(raw) ? raw : raw.words, { aspect: (opt("aspect") || "9:16").split(":").map(Number), tracks, log: console.error });
    if (!r) { console.log("No faces: there is no OpenRouter (OPENROUTER_API_KEY, or a Sprite gateway), or the clip is too large for the gateway (said above). Read the faces off a grid picture yourself and give them with --face-at."); process.exit(1); }
    fs.writeFileSync(opt("faces"), JSON.stringify(r) + "\n");
    const seconds = r.faces.length * r.step;
    console.log(`${opt("faces")}: ${r.shots.length} shot(s), a face at ${r.faces.length} moments (${seconds.toFixed(1)} s), ${r.by === "eye" ? "from your boxes, followed between them in the frames (no model)" : `by ${r.model}, $${r.cost.toFixed(4)}`}${r.faces.some((f) => f.boxes.some((b) => b.feat)) ? ", with the eyes, nose and mouth" : ", the eyes, nose and mouth from the head's proportions"}.`);
    for (const s of r.shots) for (const d of s.doubtful || []) console.log(`  ⚠ ${d.who ?? "a face"} at ${d.t.toFixed(1)} s: ${d.features || `${d.off} px from where the frames before and after lead`}; that still is left out`);
    process.exit(0);
  }
  const at = (k, kind) => String(opt(k) || "").split(",").filter(Boolean).map((v) => ({ t: Number(v), kind })).filter((o) => Number.isFinite(o.t));
  const raw = JSON.parse(fs.readFileSync(transcript, "utf8"));
  const r = await frame(video, Array.isArray(raw) ? raw : raw.words, {
    aspect: (opt("aspect") || "9:16").split(":").map(Number), out: opt("out"), log: console.error,
    kinds: [...at("whole", "broll"), ...at("follow", "follow")],
    lifts: String(opt("lift") || "").split(",").filter(Boolean).map((v) => { const [t, px] = v.split(":").map(Number); return { t, px }; }).filter((o) => Number.isFinite(o.t) && o.px >= 0),
  });
  if (!r) console.log("Nothing to cut: the footage has the frame's shape, there is no OpenRouter (OPENROUTER_API_KEY, or a Sprite gateway), or the clip is too large for the gateway (said above).");
  else {
    console.log(`${opt("out")}: ${r.shots.length} shots, cut where the footage cuts; the window follows who speaks; what a window would cut apart is shown whole.`);
    r.shots.forEach((s, k) => {
      const pieces = r.windows.filter((w) => w.shot === k);
      const how = [...new Set(pieces.map((w) => SAY[w.kind] + (w.hold ? HOLDS[w.hold] : "")))].join(", then ");
      const lifted = pieces.find((w) => w.lift)?.lift;
      console.log(`  ${k + 1}. ${s.start.toFixed(2)}–${s.end.toFixed(2)} s  ${how}${s.note ? ` (${s.note})` : ""}${lifted ? `, raised ${lifted.px} px${lifted.ground ? ` (${lifted.ground} over a ground)` : ""}` : ""}`);
      for (const w of pieces.filter((w) => w.closeup)) console.log(`     close-up ${w.start.toFixed(1)}–${w.end.toFixed(1)} s: the window turns ${w.closeup.turns} times a second; ${w.closeup.features ? "eyes, nose and mouth" : "the middle of the face"} in with their room ${Math.round(w.closeup.held * 100)} % of the time, off the edge ${Math.round(w.closeup.inside * 100)} %`);
      const edges = r.edges.filter((e) => e.shot === k);
      const seen = new Set();
      // a ⚠ where eyes, nose or mouth (or, in an answer without them, the face) are at an edge;
      // only an ear, a cheek or hair at the edge of a close-up is listed without one
      for (const e of [...edges].sort((a, b) => (a.part === "side") - (b.part === "side"))) {
        const key = `${e.who}|${e.edge}|${e.cut}|${e.part}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const all = spans(edges.filter((x) => `${x.who}|${x.edge}|${x.cut}|${x.part}` === key).map((x) => x.t));
        const what = e.part === "features" ? `the eyes, nose or mouth of ${e.who ?? "a face"}` : e.part === "side" ? `only the side of ${e.who ?? "a face"}'s face (an ear, a cheek, hair)` : e.who ?? "a face";
        console.log(`     ${e.part === "side" ? "·" : "⚠"} ${what} ${e.cut ? "cut by" : "close to"} the ${e.edge} edge at ${all.join(", ")} s${e.part === "side" ? " (accepted in a close-up)" : ""}`);
      }
      for (const d of (s.doubtful || []).filter((x) => !x.features)) console.log(`     ⚠ the model put ${d.who ?? "a face"} at ${d.t.toFixed(1)} s ${d.off} px from where the frames before and after lead: that still is left out; look at the row`);
      // eyes, nose and mouth that do not hold: one line per face
      const feats = (s.doubtful || []).filter((x) => x.features);
      for (const who of [...new Set(feats.map((x) => x.who))]) {
        const ds = feats.filter((x) => x.who === who), why = ds.length > 1 ? [...new Set(ds.map((x) => x.features.replace(/ only \d+ % of the head's height/, " too short").replace(/ \d+ % of the face/, "")))].join("; ") : ds[0].features;
        console.log(`     ⚠ the model's eyes, nose and mouth of ${who ?? "a face"} do not hold at ${ds.map((x) => x.t.toFixed(1)).join(", ")} s (${why}): left out, ${ds[0].guess ? "taken from the head's proportions (no still of this face holds: the mouth line lies low in the head's box)" : "the stills beside them hold"}; look at those rows`);
      }
    });
    if (r.sheets.missing?.length) console.log(`The sheet is missing ${r.sheets.missing.join("; ")}: look at framed.mp4 there yourself (ffmpeg -ss <second> -i framed.mp4 -frames:v 1 look.jpg).`);
    if (r.sheets.length) console.log(`Look at ${r.sheets.join(", ")}: one row per shot as listed, the footage with the window in yellow, then the frame at the shot's first, middle and last frame; red where eyes, nose or mouth are at an edge.${r.edges.some((e) => e.part !== "side") ? " A ⚠ above: look at that row. On a face the window already follows, the footage gives no better window: keep it, or move the cut so that stretch is left out. Someone or something that matters left out of a window (a second person, a photo): `reframe --whole <second>` shows the shot whole (smaller; never for a close-up). A shot shown whole whose speaker should fill the frame: `--follow <second>`." : ""}`);
  }
}
