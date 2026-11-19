#!/usr/bin/env node
// A kinetic short from a clip of people talking, step by step, in one project folder:
// every spoken word big on screen over the clip's own footage, with a world of light,
// word effects and the speakers' names. Made for agents: each step prints what to do next.
//
//   node tools/short.mjs new <dir> <clip>     <dir>/source/: the clip's sound (audio.wav), its
//                                             footage (video.*) and its words (transcript.json)
//   node tools/short.mjs brief <dir>          who speaks when; writes source/brief.md, the
//                                             direction to read before writing source/staging.json
//   node tools/short.mjs build <dir>          the HyperFrames project in <dir>/composition/; footage
//                                             wider than the frame follows who speaks (tools/frame.mjs)
//   node tools/short.mjs place <dir> [--raise head|mouth|full] [--type-top <px>] [--lift <s>:<px>]
//                                             footage with people: where the type goes, from every
//                                             face of every shot over time (agentitos' clips and
//                                             layout); a list per shot and source/place.sheet.jpg,
//                                             then the framing and the build again. Footage shown
//                                             as it is (no framing) needs its faces first:
//                                             --faces model (Gemini, a few cents) or --faces grid
//                                             and --eye <s>:x,y,w,h … (the agent's eyes, no model)
//   node tools/short.mjs check <dir> [t,…]    plays it and lists what a viewer would notice;
//                                             pictures at the seconds named go to <dir>/stills/<t>.png
//   node tools/short.mjs render <dir> <file.mp4>   the video, with HyperFrames
//
// <dir> may already exist (e.g. made by the harness the agent runs in); `new` only needs
// <dir>/source/ to be free. Options are kept in source/settings.json for the next steps:
//   --names "A=Anna,B=Ben"  --title "…"  --subtitle "…"  --hook "…"
//   --world cosmos|aurora|bokeh|neon|noir|editorial|geometry|slate|dusk|canopy|chalk|linen|mist  --aspect 9:16|1:1|4:5|16:9
//   --colors "A=#ff5a36,B=#4fc3f7" (each speaker's colour; "" = the world's)  --cta "…"  --handle @name
//   --platform reels,tiktok  where the short goes: the type and the hook keep clear of what those
//                   apps lay over it (agentitos' platform-zones); none: the usual ones of the frame
//   --out <folder>  where the HyperFrames project goes instead of <dir>/composition/, e.g. a
//                   folder of a series that shows several shorts side by side

import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readVariables } from "./variables.mjs";
import { zones, platformList } from "./lib/zones.mjs";
import { clipsTools } from "./lib/clips.mjs";
import { layoutTool, pushed, liftsFor, placeArgs, chipRoom, usualTop, sheet, shotsOfFaces } from "./lib/place.mjs";

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const VALUED = ["names", "colors", "title", "subtitle", "hook", "world", "aspect", "cta", "handle", "platform", "out", "raise", "type-top", "lift", "faces", "eye"];
// the options of place, kept in source/place.json rather than with the settings of every step
const PLACE = ["raise", "type-top", "lift", "faces", "eye"];
// options given more than once (each a box of a face)
const REPEATED = ["eye"];

function fail(message) {
  console.log(message);
  process.exit(1);
}

function parse(args) {
  const pos = [], opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const k = a.slice(2);
    if (VALUED.includes(k)) { if (i + 1 >= args.length) fail(`${a} needs a value.`); if (REPEATED.includes(k)) (opts[k] ||= []).push(String(args[++i])); else opts[k] = String(args[++i]); }
    else fail(`Unknown option ${a}. Options: ${VALUED.map((o) => "--" + o).join(" ")}`);
  }
  return [pos, opts];
}

const source = (dir, file = "") => path.join(dir, "source", file);

function settings(dir, opts) {
  for (const k of PLACE) if (k in opts) fail(`--${k} belongs to short.mjs place.`);
  const file = source(dir, "settings.json");
  const kept = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  // shorts from before: the text mode is gone, every word is big
  delete kept.keywords; delete kept["full-text"];
  const merged = { aspect: "9:16", ...kept, ...opts };
  // a platform platform-zones does not know is not kept: every later build would fail on it
  if (opts.platform) try { zones(1080, 1920, platformList(merged.platform)); } catch (e) { fail(`--platform: ${e.message}`); }
  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + "\n");
  return merged;
}

function node(tool, ...args) {
  return spawnSync(process.execPath, [path.join(TOOLS, tool), ...args.map(String)], { stdio: "inherit" }).status;
}

function project(dir) {
  if (!dir || !fs.existsSync(source(dir, "transcript.json"))) fail(`${dir || "<dir>"} is not a kinetic short yet: start one with short.mjs new <dir> <clip>.`);
  return dir;
}

function footage(dir) {
  const f = fs.readdirSync(source(dir)).find((f) => /^video\.(?!.*\.(json|wav)$)/.test(f) && !/\.(people|small)\./.test(f));
  return f ? source(dir, f) : null;
}

// the footage cut to the short's frame, following who speaks (tools/frame.mjs): made when the
// clip is wider than the frame, again when the clip or its words changed, or when place raised
// other shots than the framing has raised (source/place.json's lifts)
const framedOf = (dir, s) => source(dir, `framed-${s.aspect.replace(":", "x")}.mp4`);
const placed = (dir) => { try { return JSON.parse(fs.readFileSync(source(dir, "place.json"), "utf8")); } catch { return null; } };
// What a placement is made for: the frame, the names (the name tag above the type), the platforms
// (the safe box), the world (a light world frames the footage), the staging (the phrases and the
// punches of the hero phrases), the words and the clip (its size and its first and last 64 KB). A
// placement made for another (also one written before place said what it was for) is not applied.
const digest = (file, part = false) => {
  try {
    const h = crypto.createHash("sha1");
    if (!part) h.update(fs.readFileSync(file));
    else {
      const fd = fs.openSync(file, "r"), size = fs.fstatSync(fd).size, n = Math.min(65536, size), b = Buffer.alloc(n);
      fs.readSync(fd, b, 0, n, 0); h.update(b); fs.readSync(fd, b, 0, n, Math.max(0, size - n)); h.update(b); h.update(String(size));
      fs.closeSync(fd);
    }
    return h.digest("hex").slice(0, 12);
  } catch { return null; }
};
const placeFor = (dir, s) => JSON.stringify([s.aspect, s.names || null, s.platform || null, s.world || null, digest(source(dir, "staging.json")), digest(source(dir, "transcript.json")), footage(dir) ? digest(footage(dir), true) : null]);
// the placement for this cut, or null (stale: one sentence says to place again, once a build)
function placedNow(dir, s, { say = false } = {}) {
  const p = placed(dir);
  if (!p) return null;
  if (p.for === placeFor(dir, s)) return p;
  if (say) console.log(`⚠ source/place.json was made for another cut (the frame, the names, the platforms, the world, the staging or the clip changed since), so the type stands where the footage alone sets it: short.mjs place ${dir} places it by the faces again.`);
  return null;
}
// the lifts a framing has, as [{ shot, px }]
const framedLifts = (json) => { try { const f = JSON.parse(fs.readFileSync(json, "utf8")); const seen = new Map(); for (const w of f.windows || []) if (w.lift?.px) seen.set(w.shot, w.lift.px); return [...seen].map(([shot, px]) => ({ shot, px })); } catch { return []; } };
const sameLifts = (a, b) => a.length === b.length && a.every((x) => b.some((y) => y.shot === x.shot && y.px === x.px));
function frameFootage(dir, s) {
  const video = footage(dir), out = framedOf(dir, s), words = source(dir, "transcript.json");
  if (!video) return;
  const newer = (a, b) => fs.existsSync(a) && fs.statSync(a).mtimeMs >= fs.statSync(b).mtimeMs;
  // (a placement of footage shown as it is raises it in the build, not in a framing)
  const p = placedNow(dir, s), lifts = p?.framed === false ? [] : p?.lifts || [];
  if (newer(out, video) && newer(out, words) && sameLifts(lifts, framedLifts(out.replace(/\.mp4$/, ".json")))) return;
  node("frame.mjs", video, words, "--aspect", s.aspect, "--out", out, ...(lifts.length ? ["--lift", lifts.map((l) => `${l.t}:${l.px}`).join(",")] : []));
}

function buildArgs(dir, s) {
  const args = [source(dir, "transcript.json"), "--preset", "podcast", "--aspect", s.aspect,
    "--audio", source(dir, "audio.wav")];
  const framed = framedOf(dir, s), video = fs.existsSync(framed) ? framed : footage(dir);
  if (video) args.push("--video", video);
  for (const [k, flag] of [["names", "--speakers"], ["colors", "--colors"], ["title", "--title"], ["subtitle", "--subtitle"], ["hook", "--hook"],
    ["world", "--world"], ["cta", "--cta"], ["handle", "--handle"], ["platform", "--platform"]]) if (s[k]) args.push(flag, s[k]);
  // the type's top from the faces (short.mjs place); without it the band the footage gives
  const p = placedNow(dir, s);
  if (p?.top != null && video) args.push("--type-top", String(p.top));
  // footage shown as it is: the build raises a shot's picture itself
  if (p?.framed === false && p.lifts?.length && video) args.push("--video-lift", p.lifts.map((l) => `${l.start}-${l.end}:${l.px}`).join(","));
  // no title: none on screen (build.mjs takes a bare --title as none, else the file's name)
  if (!s.title) args.push("--title");
  return args;
}

const README = `# source/

What \`tools/short.mjs\` of kinetic-lyrics keeps for this short:

- \`video.*\`, \`audio.wav\`: the clip; \`transcript.json\`: its words with their timings and
  who speaks them
- \`video.people.json\`: who sits where in the footage (Gemini, asked once), and
  \`framed-9x16.mp4\`: the footage cut to the short's frame, following who speaks
- \`settings.json\`: the options of the builds
- \`brief.md\`: the direction to read; \`staging.json\`: the staging written from it

\`../composition/\` is the HyperFrames project every build replaces: change the staging or the
settings, never those files. \`../stills/\` holds the pictures \`check\` took.
`;

function create(dir, clip, opts) {
  if (!dir) fail("short.mjs new <dir> <clip>: the folder of the short.");
  if (!clip || !fs.existsSync(clip)) fail(`No clip at ${clip}: the path of the video or audio file.`);
  if (fs.existsSync(source(dir))) fail(`${dir}/source exists already: this folder holds a short.`);
  fs.mkdirSync(source(dir), { recursive: true });
  fs.rmSync(path.join(dir, "composition"), { recursive: true, force: true });
  fs.writeFileSync(source(dir, "README.md"), README);
  settings(dir, opts);
  if (node("clip.mjs", clip, "--out", source(dir)) !== 0) {
    fs.rmSync(source(dir), { recursive: true, force: true });
    fail("The clip could not be read or transcribed, see above.");
  }
  console.log(`${dir} is ready: the words are in source/transcript.json. Next: short.mjs brief ${dir}.`);
}

function brief(dir, opts) {
  project(dir);
  const s = settings(dir, opts);
  if (node("build.mjs", ...buildArgs(dir, s), "--staging-brief", source(dir, "brief.md"), "--staging", source(dir, "staging.json")) !== 0)
    fail("The brief failed, see above.");
  // who speaks: the transcript itself
  const raw = JSON.parse(fs.readFileSync(source(dir, "transcript.json"), "utf8"));
  const voices = {};
  for (const w of Array.isArray(raw) ? raw : raw.words || []) if (w.speaker) voices[w.speaker] = (voices[w.speaker] || 0) + 1;
  const list = Object.keys(voices).sort().map((k) => `${k} ${voices[k]} words`);
  if (list.length) console.log(`Voices: ${list.join(", ")}. Name them with --names "A=…,B=…" (who speaks first is A).`);
  console.log(`Read ${source(dir, "brief.md")} and write the staging into ${source(dir, "staging.json")}, then short.mjs build ${dir}.`);
}

// where the HyperFrames project of the short is: --out (kept, as an absolute path), else
// <dir>/composition
const compositionOf = (dir, s) => (s.out ? s.out : path.join(dir, "composition"));

function build(dir, opts) {
  project(dir);
  if (typeof opts.out === "string" && opts.out) opts.out = path.resolve(opts.out);
  const s = settings(dir, opts);
  const staging = source(dir, "staging.json");
  const has = fs.existsSync(staging);
  if (!has) console.log("No staging yet: the words are set by the keyword lexicon. Better: short.mjs brief first.");
  const out = compositionOf(dir, s);
  placedNow(dir, s, { say: true });
  frameFootage(dir, s);
  const exit = node("build.mjs", ...buildArgs(dir, s), ...(has ? ["--staging", staging] : []), "--out", out);
  if (exit === 2) fail("Fix the staging as the message above says, then build again.");
  if (exit !== 0) fail("The build failed, see above.");
  console.log(`${path.relative(process.cwd(), out) || out} is built. short.mjs check ${dir} finds what a viewer would notice.`);
}

// what layout's eyes figure is (text.json's eyesAre), in words
const eyesSaid = (x) => x.eyesAre === "eyes" ? `the eyes at ${Math.round(x.eyes * 100)} % of the height`
  : x.eyesAre === "brows" ? `the brows' top at ${Math.round(x.eyes * 100)} % of the height, the eyes a little lower`
  : `the eyes at about ${Math.round(x.eyes * 100)} % of the height`;

// Where the type goes over footage with people: the faces of every shot over time, as the short's
// push-in and punches show them, handed to agentitos' layout (place.mjs text --text area): one top
// for the type of the whole short, each shot's lift; the framing (or the footage layer) and the
// build again with them, a list per shot and a sheet. The faces: the framing's (clips.mjs shots),
// or, for footage the short shows as it is (an upright phone take into 9:16), the footage's own
// (source/faces.json, by clips' frame.mjs --faces: --faces model asks Gemini, --eye gives the
// agent's own boxes read off --faces grid pictures).
function place(dir, opts) {
  project(dir);
  const s = settings(dir, {});
  const comp = compositionOf(dir, s), planFile = path.join(comp, "plan.json");
  if (!fs.existsSync(planFile)) fail(`Nothing built yet: short.mjs build ${dir} first (place needs its framing and its phrases).`);
  const file = source(dir, "place.json"), prev = placed(dir) || {};
  const framedJson = framedOf(dir, s).replace(/\.mp4$/, ".json");
  let plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
  // what the agent fixed, given now or kept from before ("" gives one back): read whatever the footage
  const fixed = { ...(prev.fixed || {}) };
  if (opts.raise !== undefined) { if (!["head", "mouth", "full", ""].includes(opts.raise)) fail("--raise is full (the default here: a shot goes up as far as the eyes stay below the apps' top bar), mouth (the eyes no higher than 27 % of the height) or head (never a head cut by the frame); \"\" gives back the default."); fixed.raise = opts.raise || undefined; }
  if (opts["type-top"] !== undefined) { const v = Number(opts["type-top"]); if (opts["type-top"] !== "" && !(/^\d+(\.\d+)?$/.test(opts["type-top"]) && v > 0)) fail(`--type-top is the y in px of the frame where the type starts, a number as 1150, not "${opts["type-top"]}"; "" lets place choose.`); fixed.top = opts["type-top"] === "" ? undefined : v; }
  if (opts.lift !== undefined) for (const v of String(opts.lift).split(",").filter(Boolean)) {
    const m = v.match(/^(\d+(?:\.\d+)?):(\d+)$/);
    if (!m) fail(`--lift is <second>:<px>, a second of the short in the shot and how far its picture goes up (0: not at all), as 6.5:180, not "${v}".`);
    fixed.lifts = { ...(fixed.lifts || {}), [m[1]]: Number(m[2]) };
  }
  if (opts.faces !== undefined && !["model", "grid"].includes(opts.faces)) fail(`--faces is model (Gemini finds the faces in the footage, one request of a few cents) or grid (pictures to read the faces' boxes off, for --eye; no model), not "${opts.faces}".`);
  for (const k of Object.keys(fixed)) if (fixed[k] === undefined) delete fixed[k];
  const given = ["raise", "type-top", "lift", "faces", "eye"].filter((k) => opts[k] !== undefined).map((k) => `--${k}`);
  if (!plan.video || plan.video.frame) {
    if (given.length) fail(`${given.join(", ")} ${given.length > 1 ? "have" : "has"} nothing to move here: ${!plan.video ? "this short has no footage, the type has the frame to itself" : "in a light world the footage stands in a frame above the type"}.`);
    fs.rmSync(file, { force: true });
    // a place of before no longer holds: built again without it
    if (prev.top != null) build(dir, {});
    console.log(!plan.video ? "This short has no footage: the type has the frame to itself, nothing to place."
      : "In a light world the footage stands in a frame above the type: no face reaches it, nothing to place.");
    return;
  }
  // the type keeps 15 % of the height above the safe box's bottom at least (layout's area.least)
  const bottom = Math.round((plan.zones?.centred?.[3] ?? 1) * plan.height), lowest = Math.floor(bottom - 0.15 * plan.height);
  if (fixed.top != null && (fixed.top > lowest || fixed.top < chipRoom(plan) + (plan.zones?.centred?.[1] ?? 0) * plan.height)) fail(`--type-top ${fixed.top} leaves the type no room: give a y from ${Math.ceil(chipRoom(plan) + (plan.zones?.centred?.[1] ?? 0) * plan.height)} to ${lowest} (the type keeps 15 % of the height above the apps' bottom at y ${bottom}).`);
  const clips = clipsTools(), layout = layoutTool();
  if (!clips) fail("Placing the type needs agentitos' clips skill beside this one (or CLIPS_TOOLS naming its tools/ folder).");
  if (!layout) fail("Placing the type needs agentitos' layout skill beside this one (or LAYOUT_TOOL naming its tools/place.mjs).");
  const folder = source(dir, "place");
  fs.mkdirSync(folder, { recursive: true });
  const raw = path.join(folder, "framed-shots.json"), shotsFile = path.join(folder, "shots.json");
  const framed = fs.existsSync(framedJson);
  let cost = null;
  if (framed) {
    if (opts.faces !== undefined || opts.eye !== undefined) fail(`--faces and --eye are for footage shown as it is: this short's footage is framed (${path.basename(framedJson)}), and its faces come from the framing.`);
    const r0 = spawnSync(process.execPath, [path.join(clips, "clips.mjs"), "shots", framedJson, raw], { encoding: "utf8" });
    if (r0.status !== 0 || !fs.existsSync(raw)) fail(`✗ clips: ${(r0.stdout || r0.stderr).trim()}`);
  } else {
    // footage the short shows as it is: its own faces, found once and kept in source/faces.json
    const video = footage(dir), facesFile = source(dir, "faces.json");
    if (opts.faces === "grid") return gridPictures(dir, video, layout);
    if (opts.faces === "model" || opts.eye !== undefined) cost = findFaces(dir, s, video, facesFile, clips, opts.eye);
    if (!fs.existsSync(facesFile)) {
      const how = `short.mjs place ${dir} --faces model has Gemini find them (one request, a few cents, said when done), or where no model may see the footage --faces grid writes pictures to read the faces' boxes off and --eye <second>:x,y,w,h gives them (no model)`;
      if (fixed.top == null) {
        // (a --raise or --lift given now is kept for when the faces are known)
        const kept = ["raise", "lift"].filter((k) => opts[k] !== undefined);
        if (kept.length) fs.writeFileSync(file, JSON.stringify({ by: "short.mjs place", top: null, raise: fixed.raise || "full", lifts: [], framed: false, faces: null, fixed, for: placeFor(dir, s) }, null, 1) + "\n");
        console.log(`No framing: the short shows the footage as it is, and its faces are not known yet, so the type stays where the build set it${kept.length ? ` (${kept.map((k) => `--${k}`).join(" and ")} kept for when they are)` : ""}. To find them: ${how}; --type-top <px> places the type by hand.`);
        return;
      }
      // the agent's own top, with no face to weigh it against
      const top = +(fixed.top / plan.height).toFixed(4);
      fs.writeFileSync(file, JSON.stringify({ by: "short.mjs place", top, raise: fixed.raise || "full", lifts: [], framed: false, faces: null, fixed, for: placeFor(dir, s) }, null, 1) + "\n");
      console.log(`Placing: the type from y ${fixed.top}, as given; building again …`);
      build(dir, {});
      console.log(`\nThe type: from y ${fixed.top}, as --type-top gave it. No faces are known, so what it lies on is not checked: ${how}.`);
      return;
    }
    fs.writeFileSync(raw, JSON.stringify(shotsOfFaces(JSON.parse(fs.readFileSync(facesFile, "utf8")), plan)));
  }
  const input = pushed(JSON.parse(fs.readFileSync(raw, "utf8")), plan);
  fs.writeFileSync(shotsFile, JSON.stringify(input));
  const shots = input.shots;
  const lifts = Object.entries(fixed.lifts || {}).map(([t, px]) => {
    const k = shots.findIndex((x) => Number(t) >= x.start && Number(t) < x.end);
    if (k < 0) fail(`No shot at ${t} s: --lift takes a second of the short as source/place.sheet.jpg lists the shots.`);
    // as far as the picture allows: its room in the footage and a ground under the apps' bottom
    // (layout's own limit for a raise); a shot shown whole or as two panels not at all
    const room = shots[k].room, most = room ? Math.max(0, room.free || 0) + Math.max(0, Math.round((1 - (plan.zones?.safe?.[3] ?? 1)) * plan.height)) : 0;
    if (px > most) fail(`--lift ${t}:${px} raises shot ${k + 1} further than its picture allows: give 0 to ${most} px${most ? "" : " (it is shown whole and is not raised)"}.`);
    return { shot: k, px };
  });
  const raise = fixed.raise || "full";
  const args = placeArgs(plan, { folder, shots: shotsFile, raise, top: fixed.top, lifts, platforms: plan.zones?.platforms || [] });
  const r = spawnSync(process.execPath, [layout, ...args], { encoding: "utf8" });
  if (r.status !== 0) fail(`✗ layout: ${(r.stdout || r.stderr).trim()}`);
  const text = JSON.parse(fs.readFileSync(path.join(folder, "text.json"), "utf8"));
  const chip = chipRoom(plan), H = plan.height;
  const want = liftsFor(text, shots).map((l, i) => { const k = text.shots.filter((x) => x.lift > 0)[i].shot; return { ...l, shot: k, start: shots[k].start, end: shots[k].end }; });
  // where the faces leave the type where the footage alone sets it (no face, or none near it),
  // nothing changes: the build stays the one without place, byte for byte
  const top = text.area.lower > 0 || want.length || fixed.top != null ? +((text.area.top + chip) / H).toFixed(4) : null;
  fs.writeFileSync(file, JSON.stringify({ by: "short.mjs place", top, area: text.area, raise, lifts: want, framed, ...(framed ? {} : { faces: "source/faces.json" }), fixed, for: placeFor(dir, s) }, null, 1) + "\n");
  // the framing (where a lift changed) and the build again
  if (top != null || prev.top != null) {
    console.log(`Placing: the type from y ${Math.round((top ?? text.area.top / H + chip / H) * H)}${want.length ? `, ${want.map((l) => `shot ${l.shot + 1} raised ${l.px} px`).join(", ")}` : ""}; ${framed ? "framing and building" : "building"} again …`);
    build(dir, {});
  }
  plan = JSON.parse(fs.readFileSync(planFile, "utf8"));

  // the list
  const sec = (x) => Math.round(x * 10) / 10;
  const a = text.area, usual = usualTop(plan);
  const at = Math.round(a.top + chip);
  console.log(`\nThe type: one place for the short, from y ${at} to ${Math.round(a.bottom)} (${Math.round(((a.bottom - at) / H) * 100)} % of the height${chip ? `, the name tag in the ${chip} px above it` : ""})${a.lower > 0 ? `, ${Math.round(a.lower)} px lower than the footage alone sets it (y ${usual}): the type is up to ${Math.round((a.lower / (a.bottom - usual + chip)) * 100)} % smaller, so that it keeps off the mouths` : ", where the footage alone sets it"}.`);
  for (const x of text.shots) {
    const on = x.touches.map((t) => `${t.who}: ${[t.nose ? `the nose or eyes ${t.nose} s` : "", t.mouth ? `the mouth ${t.mouth} s` : "", t.lip ? `the lower lip ${t.lip} s` : "", t.chin ? `the chin or neck ${t.chin} s` : ""].filter(Boolean).join(", ")} (${t.from}–${t.to} s)`).join("; ");
    console.log(`  ${x.fault ? "✗" : "·"} shot ${x.shot + 1}  ${x.start.toFixed(1)}–${x.end.toFixed(1)} s  ${x.lift ? `raised ${x.lift} px${x.eyes != null ? ` (${eyesSaid(x)} at their highest)` : ""}` : framed ? "as framed" : "as it is"}: the type on ${on || "no face"}`);
  }
  // what is left on a mouth, nose or eyes, and what would avoid it; the notes of layout but its own
  // sentence on the area (said above)
  const floor = text.area.top >= text.area.least - 3;
  for (const x of text.shots.filter((q) => q.fault)) {
    const parts = [x.on.nose ? `nose or eyes for ${x.on.nose} s` : "", x.on.mouth ? `mouth for ${x.on.mouth} s` : "", x.on.lip ? `lower lip for ${x.on.lip} s` : ""].filter(Boolean).join(", ");
    const who = [...new Set(x.touches.map((t) => t.who))].join(" and ");
    const why = x.limit === "fixed" ? "as far as --lift fixed it" : x.limit === "eyes" ? "as far as the eyes stay below the apps' top bar" : x.limit === "eyeLine" ? "as far as the eyes stay below 27 % of the height (--raise mouth)" : x.limit === "head" ? "as far as the head stays whole (--raise head)" : "as far as the framing and the apps' bottom allow";
    console.log(`✗ Shot ${x.shot + 1} (${x.start.toFixed(1)}–${x.end.toFixed(1)} s): the type lies on ${who}'s ${parts}${x.lift ? `, raised ${x.lift} px ${why}` : ""}${floor ? ", the type at its smallest" : ""}. What would avoid it: ${[raise !== "full" ? "--raise full" : "", fixed.top != null || !floor ? "a lower --type-top (smaller type)" : "", "a stretch of the episode without this shot"].filter(Boolean).join(", ")}.`);
  }
  for (const n of text.notes.filter((n) => !/^The type's area starts/.test(n))) console.log(`note: ${n}`);
  // the other tops layout weighed, with what each costs: the type's size, the raises, the seconds on a mouth
  const sizeOf = (y) => Math.round(((a.bottom - y - chip) / (a.bottom - usual)) * 100);
  const others = (text.candidates || []).filter((k) => Math.abs(k.top - a.top) > 0.5);
  if (others.length) console.log(`Other tops it weighed (cost ${text.candidates[0].cost} for the one taken): ${others.map((k) => `y ${Math.round(k.top + chip)}, the type ${sizeOf(k.top)} % of its usual size, ${(k.lifts || []).length ? k.lifts.map((x) => `shot ${x.shot + 1} raised ${x.px} px`).join(", ") : "nothing raised"}${k.mouth ? `, on a mouth, nose or eyes ${k.mouth} s` : ""}, cost ${k.cost}`).join("; ")}. --type-top <y> takes one of them.`);
  const files = sheet(framed ? framedOf(dir, s) : footage(dir), plan, text, shots, source(dir, "place.sheet.jpg"), { chip, ...(framed ? {} : { cover: true }) });
  if (cost != null) console.log(`The faces: ${cost ? `Gemini, $${cost.toFixed(4)}` : "nothing spent (your boxes, or Gemini's answer of before)"}; kept in source/faces.json for the next place.`);
  console.log(`${files.length ? `Look at ${files.join(", ")}: per shot its first, middle and last frame as the short shows it, the type's area in yellow (the name tag above the thin line), the faces in red, the mouth line in orange. ` : ""}Then short.mjs check ${dir}. To change it: --type-top <px> (where the type starts), --raise mouth|head (less of a head cut), --lift <second>:<px>${framed ? "" : ", --eye <second>:x,y,w,h … (the faces by your eyes, where a box is off)"}; each is kept, "" gives it back.`);
}

// Grid pictures of footage shown as it is, for the agent's own eyes where no model may see it: five
// moments spread over the clip, a line every 10 % labelled in px of the footage (layout's grid)
function gridPictures(dir, video, layout) {
  const plan = JSON.parse(fs.readFileSync(path.join(compositionOf(dir, settings(dir, {})), "plan.json"), "utf8"));
  const d = plan.video.duration, made = [];
  for (const t of [0.05, 0.27, 0.5, 0.73, 0.95].map((x) => x * d)) {
    const out = source(dir, `place/grid-${t.toFixed(1)}.jpg`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const r = spawnSync(process.execPath, [layout, "grid", video, out, "--at", t.toFixed(2)], { encoding: "utf8" });
    if (r.status) fail(`✗ layout grid: ${(r.stderr || r.stdout).trim()}`);
    made.push(`${out} (at ${t.toFixed(1)} s)`);
  }
  console.log(`Grid pictures of the footage, a line every 10 % labelled in px of it (${plan.video.width}×${plan.video.height}):\n  ${made.join("\n  ")}`);
  console.log(`Open each and read the face's box off it (hairline to chin, cheek to cheek, in px of the footage; layout's SKILL.md step 2 says how), then\n  short.mjs place ${dir} --eye <second>:x,y,w,h --eye …   (every picture's box; no model sees the footage)`);
}

// The footage's own faces (clips' frame.mjs --faces) into source/faces.json: Gemini's (one
// request, its cost said), or the agent's own boxes followed between them in the frames (no
// model). Returns what was spent.
function findFaces(dir, s, video, out, clips, eyes) {
  const plan = JSON.parse(fs.readFileSync(path.join(compositionOf(dir, s), "plan.json"), "utf8"));
  const [fw, fh] = [plan.video.width, plan.video.height];
  const boxes = (eyes || []).map((v) => {
    const m = String(v).match(/^(\d+(?:\.\d+)?):(-?[\d.]+),(-?[\d.]+),([\d.]+),([\d.]+)$/);
    if (!m) fail(`--eye is <second>:x,y,w,h, the face's box at that second in px of the footage, read off its grid picture, as 2.5:300,570,600,900, not "${v}".`);
    const [x, y, w, h] = m.slice(2).map(Number);
    const inside = Math.max(0, Math.min(fw, x + w) - Math.max(0, x)) * Math.max(0, Math.min(fh, y + h) - Math.max(0, y));
    if (!(w >= 0.02 * fh && h >= 0.02 * fh) || inside < 0.8 * w * h || h / w < 0.6 || h / w > 3) fail(`--eye ${v}: that is no face's box in the footage (${fw}×${fh}): x,y is its top left corner, then its width and height, from the hairline to the chin and cheek to cheek; read it off the grid picture again.`);
    return `${m[1]}:${x},${y},${w},${h}`;
  });
  if (!boxes.length) console.log("Finding the faces with Gemini (one request, a few cents) …");
  const r = spawnSync(process.execPath, [path.join(clips, "frame.mjs"), video, source(dir, "transcript.json"), "--aspect", s.aspect, "--faces", out, ...boxes.flatMap((b) => ["--face-at", b])], { encoding: "utf8" });
  if (r.status !== 0 || !fs.existsSync(out)) fail(`✗ clips: ${(r.stdout || r.stderr).trim().split("\n").pop()}`);
  console.log(r.stdout.trim().split("\n").pop());
  try { return JSON.parse(fs.readFileSync(out, "utf8")).cost || 0; } catch { return 0; }
}

function check(dir, times) {
  project(dir);
  const comp = compositionOf(dir, settings(dir, {}));
  if (!fs.existsSync(path.join(comp, "index.html"))) fail(`Nothing built yet: short.mjs build ${dir}.`);
  const exit = node("qa.mjs", comp, "--max-shots", 8, ...(times ? ["--frames", times] : []));
  if (times) {
    fs.mkdirSync(path.join(dir, "stills"), { recursive: true });
    for (const t of times.split(",").map((t) => t.trim())) {
      const png = path.join(comp, "qa", `at-${Number(t).toFixed(2)}s.png`);
      if (fs.existsSync(png)) fs.copyFileSync(png, path.join(dir, "stills", `${t}.png`));
    }
    console.log(`Pictures: ${path.join(dir, "stills")}/<t>.png`);
  }
  if (exit === 1) console.log("There are errors (✗): fix them in the staging and build again.");
}

// the video: `hyperframes render` in the project, at a bitrate the platforms take as it is
function render(dir, file) {
  project(dir);
  if (!file) fail("short.mjs render <dir> <file.mp4>: name the video file.");
  const comp = compositionOf(dir, settings(dir, {}));
  if (!fs.existsSync(path.join(comp, "index.html"))) fail(`Nothing built yet: short.mjs build ${dir}.`);
  const hf = (() => { try { return execFileSync("which", ["hyperframes"], { encoding: "utf8" }).trim(); } catch { return ""; } })();
  if (!hf) fail("hyperframes is not installed on this machine, so no video: the operator installs it (npm install -g hyperframes).");
  const out = path.resolve(file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const chrome = process.env.CHROME || process.env.HYPERFRAMES_BROWSER_PATH;
  // the values the person set on the preview (variables.json beside the project) go into the video too
  const values = readVariables(comp), valuesFile = path.join(os.tmpdir(), `short-variables-${process.pid}.json`);
  const withValues = Object.keys(values).length > 0;
  if (withValues) fs.writeFileSync(valuesFile, JSON.stringify(values));
  const r = spawnSync(hf, ["render", ".", "--output", out, "--quiet", "--video-bitrate", "6M", ...(withValues ? ["--variables-file", valuesFile] : [])], {
    cwd: comp, stdio: "inherit",
    env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", HYPERFRAMES_SKIP_SKILLS: "1", PUPPETEER_SKIP_DOWNLOAD: "1",
      ...(chrome ? { HYPERFRAMES_BROWSER_PATH: chrome, PRODUCER_HEADLESS_SHELL_PATH: chrome } : {}) },
  });
  if (withValues) fs.rmSync(valuesFile, { force: true });
  if (r.status !== 0 || !fs.existsSync(out)) fail("The render failed, see above.");
  console.log(`${file}: ${(fs.statSync(out).size / 1e6).toFixed(1)} MB.`);
}

const [step, ...rest] = process.argv.slice(2);
const [[dir, arg], opts] = parse(rest);
switch (step) {
  case "new": create(dir, arg, opts); break;
  case "brief": brief(dir, opts); break;
  case "build": build(dir, opts); break;
  case "place": place(dir, opts); break;
  case "check": check(dir, arg); break;
  case "render": render(dir, arg); break;
  default: fail("short.mjs new <dir> <clip> | brief <dir> | build <dir> | place <dir> [--raise …] [--type-top <px>] [--lift <s>:<px>] [--faces model|grid] [--eye <s>:x,y,w,h …] | check <dir> [seconds,…] | render <dir> <file.mp4>");
}
