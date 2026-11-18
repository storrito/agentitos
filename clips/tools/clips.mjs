#!/usr/bin/env node
// A moment of a long video as a finished short in the video's own look: cut from the episode,
// framed 9:16 on whoever speaks, its pauses and "äh"s cut, at one level, with captions and a
// hook card. Made for agents: each step prints what to do next.
//
//   node tools/clips.mjs prepare <episode> <clip> <first>-<last> [--out <composition>] [--platform reels,tiktok]
//        [--hook "…"] [--title "…"] [--brand brand/DESIGN.md] [--target <s>]
//        <episode> is the folder of episode.mjs fetch; the sentences first..last are cut from it
//        (<clip>/clip.mp4), framed on whoever speaks (<clip>/framed.mp4, tools/frame.mjs), and
//        handed to agentitos' best-takes (<clip>/takes/): every word written down again, closer,
//        tight pauses, one keep of the whole moment in <clip>/takes/cut.json. A moment longer than
//        --target (59 s) is said, and best-takes' check names it until the cut fits
//   node tools/clips.mjs reframe <clip> [--whole <s>,…] [--follow <s>,…]
//        the framing again (no new cost: who sits where is kept), the shot at each <s> (seconds of
//        <clip>/clip.mp4, as framed.sheet.jpg lists them) shown whole or following who speaks; the
//        edit in takes/ stays, its next build takes the new picture
//   node tools/clips.mjs place <clip> [--raise moderate|full] [--caption-y <px>] [--font-size <px>] [--lift <s>:<px>,…] [--hook text|card]
//        where the text goes over the framed clip: one place for the captions of the whole clip,
//        each shot raised where its chin would reach into them (the framing again, no cost), the
//        hook's place over its first seconds, all by agentitos' layout from every face over time;
//        a list per shot (where the text is, which face it lies on, how long), <clip>/placed.sheet.jpg
//        (the text's boxes over each shot's first, middle and last frame), takes/place.json for
//        best-takes (the captions' options, the hook's box) and takes/source/faces.json (the faces
//        it keeps its punch-ins and its check by). prepare runs it once; run it again after the
//        cut's start moved or to change what it chose, it builds again when the edit is built
//   node tools/clips.mjs render <clip> <video.mp4>
//        the built preview rendered with HyperFrames, brought to −14 LUFS, subtitles beside it
//   node tools/clips.mjs prepare-all <episode> <clips.json> [--platform …] [--brand …] [--jobs N]
//        prepare for every clip of clips.json side by side ([{"clip": "work/01", "range": "478-484",
//        "out": "artifacts/clips/composition/01-…", "title": "…", "hook": "…"}, …]); each one's
//        output as it finishes; as many at a time as the memory holds (about 1.5 GB each: 2 on a
//        Sprite), at most 4
//   node tools/clips.mjs render-all <clips.json> <folder> [--jobs N]
//        render for every clip, <folder>/<clip's folder name>.mp4, one after the other: a
//        HyperFrames render already keeps every core busy, two at once only on 16 GB and more
//        (two on a 4 GB Sprite filled its memory and took longer than one by one)
//
// The edit itself is best-takes' (build, check, captions; its README): this tool only sets it up
// and prints the command lines with its path. best-takes is found at BEST_TAKES_TOOL, beside this
// skill, or in the machine's clone of the skills.

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { framedShots } from "./lib/faces.mjs";
import { spanOf, hookSpan, shotsInput, facesFile, placeSheet, toOutput } from "./lib/place.mjs";
import { lengthNote } from "./lib/length.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VALUED = ["out", "platform", "hook", "title", "brand", "whole", "follow", "jobs", "target", "caption-y", "font-size", "lift", "raise"];
// the longest a short may be (every post type Storrito offers takes it), unless --target says more
const LONGEST = 59;

const fail = (message) => { console.log(message); process.exit(1); };
const rel = (p) => path.relative(process.cwd(), p) || ".";
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function parse(args) {
  const pos = [], opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const k = a.slice(2);
    if (!VALUED.includes(k)) fail(`Unknown option ${a}. Options: ${VALUED.map((o) => "--" + o).join(" ")}`);
    if (i + 1 >= args.length) fail(`${a} needs a value.`);
    opts[k] = String(args[++i]);
  }
  return [pos, opts];
}

export function takesTool() {
  const skill = path.dirname(HERE);
  const candidates = [process.env.BEST_TAKES_TOOL, path.join(skill, "..", "best-takes", "tools", "takes.mjs"), "/home/sprite/skills/best-takes/tools/takes.mjs"];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

// a tool of this skill or best-takes, its output shown, but not its "Next:" (this tool says what
// comes next); a failure ends here with its message, or returns false when it may fail
function run(tool, args, { mayFail = false } = {}) {
  const r = spawnSync(process.execPath, [tool, ...args], { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", maxBuffer: 64 << 20 });
  const said = (r.stdout || "").split("\n").map((l) => (r.status !== 0 ? l : l.replace(/\s*Next:.*$/, ""))).filter((l) => l.trim()).join("\n");
  if (said) console.log(said);
  if (r.status !== 0 && !mayFail) process.exit(r.status || 1);
  return r.status === 0;
}

// platform-zones knows the platform names: a wrong one fails here, before anything is paid for
function checkPlatforms(list) {
  const skill = path.dirname(HERE);
  const tool = [process.env.PLATFORM_ZONES, path.join(skill, "..", "platform-zones", "tools", "zones.mjs"), "/home/sprite/skills/platform-zones/tools/zones.mjs"].find((p) => p && fs.existsSync(p));
  if (!tool) fail("This needs agentitos' platform-zones skill beside this one (or PLATFORM_ZONES naming its tools/zones.mjs).");
  const r = spawnSync(process.execPath, [tool, "zones", ...list.split(",").map((p) => p.trim()).filter(Boolean), "--size", "1080x1920", "--json"], { encoding: "utf8" });
  if (r.status) fail(`✗ --platform: ${(r.stderr || r.stdout).trim()}`);
}

// the pieces of the framing that show a picture whole (B-roll, two above each other): best-takes
// does not go closer there (its --punch), it would cut into them
function writeStill(dir) {
  const framed = path.join(dir, "framed.json"), td = path.join(dir, "takes", "source");
  if (!fs.existsSync(td)) return;
  const windows = fs.existsSync(framed) ? read(framed).windows || [] : [];
  const whole = windows.filter((w) => w.kind && w.kind !== "people").map((w) => [w.start, w.end]);
  fs.writeFileSync(path.join(td, "still.json"), JSON.stringify({ "01.mp4": whole }) + "\n");
}

const probe = (file) => {
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], { encoding: "utf8" }));
  return { width: j.streams[0].width, height: j.streams[0].height, duration: Number(j.format.duration) };
};

// ---------------------------------------------------------------------------------- prepare
function prepare(episode, dir, range, opts) {
  if (!episode || !dir || !/^\d+-\d+$/.test(range || "")) fail("clips.mjs prepare <episode> <clip> <first>-<last> [--out …] [--platform …] [--hook \"…\"] [--title \"…\"] [--brand …]");
  if (!fs.existsSync(path.join(episode, "words.json"))) fail(`No ${rel(path.join(episode, "words.json"))}: first node ${rel(path.join(HERE, "episode.mjs"))} fetch <url|file> ${rel(episode)}.`);
  const takes = takesTool();
  if (!takes) fail("This needs agentitos' best-takes skill beside this one (or BEST_TAKES_TOOL naming its tools/takes.mjs).");
  const td = path.join(dir, "takes");
  if (fs.existsSync(path.join(td, "source", "words.json"))) fail(`${rel(dir)} is prepared already. To start the edit over: rm -r ${rel(td)} (cut.json's changes go with it); to frame it anew, also rm ${rel(path.join(dir, "framed.mp4"))} ${rel(path.join(dir, "clip.people.json"))}; then prepare again.`);
  if (opts.platform) checkPlatforms(opts.platform);
  fs.mkdirSync(dir, { recursive: true });

  // the moment, cut from the episode with a breath of air around it (once: a prepare that
  // failed later on starts from here)
  const clip = path.join(dir, "clip.mp4");
  if (!(fs.existsSync(clip) && fs.existsSync(path.join(dir, "clip.json")) && read(path.join(dir, "clip.json")).range === range)) {
    fs.rmSync(path.join(dir, "framed.mp4"), { force: true });
    run(path.join(HERE, "episode.mjs"), ["cut", episode, range, clip]);
    fs.writeFileSync(path.join(dir, "clip.json"), JSON.stringify({ ...read(path.join(dir, "clip.json")), range }));
  }
  const { from, to } = read(path.join(dir, "clip.json"));
  const [a, b] = range.split("-").map(Number);
  const sentences = read(path.join(episode, "sentences.json"));
  // where the moment's first and last sentence are in the clip
  const said = [sentences[a].start - from, sentences[b].end - from];
  const longest = Number(opts.target) || LONGEST;

  // its words with their speakers, timed in the clip, for the framing
  const words = read(path.join(episode, "words.json"))
    .filter((w) => w.end > from && w.start < to)
    .map((w) => ({ ...w, start: +Math.max(0, w.start - from).toFixed(3), end: +Math.min(to - from, w.end - from).toFixed(3) }));
  const wordsFile = path.join(dir, "clip.words.json");
  fs.writeFileSync(wordsFile, JSON.stringify(words));

  // 9:16 on whoever speaks, when the footage is wider; else, or when the framing fails,
  // best-takes fills the frame from the middle
  const { width, height } = probe(clip);
  let video = clip;
  const framed = path.join(dir, "framed.mp4");
  if (fs.existsSync(framed)) video = framed;
  else if (width / height > 9 / 16 + 0.01) {
    const ok = run(path.join(HERE, "frame.mjs"), [clip, wordsFile, "--aspect", "9:16", "--out", framed], { mayFail: true });
    if (ok && fs.existsSync(framed)) video = framed;
    else console.log(`The footage stays centred${ok ? "" : " (the framing failed, see above)"}: best-takes crops it from the middle. Say so when the speaker is not in the middle.`);
  }

  // best-takes: every word again (äh included, closer than the episode's), the level, tight pauses
  // --target: best-takes' check names a cut longer than the short may be
  const settings = ["--aspect", "9:16", "--pauses", "tight", "--punch", "on", ...(opts.target ? [] : ["--target", String(longest)]), ...Object.entries(opts).filter(([k]) => !["whole", "follow", "caption-y", "font-size", "lift", "raise"].includes(k)).flatMap(([k, v]) => [`--${k}`, v])];
  run(takes, ["new", td, video, ...settings]);
  writeStill(dir);

  // the whole moment as one keep: the words heard within its first and last sentence (the cut's
  // air may hold the tail of the sentence before or the start of the one after; the episode's
  // times are a tenth of a second off at most)
  const { words: heard } = read(path.join(td, "source", "words.json"));
  const spoken = heard.filter((w) => w.kind === "word" || w.kind === "filler");
  const inside = spoken.filter((w) => (w.start + w.end) / 2 >= said[0] - 0.25 && (w.start + w.end) / 2 <= said[1] + 0.25);
  if (!inside.length) fail(`✗ No word heard in the moment's sentences in ${rel(video)}: look at ${rel(path.join(td, "source", "brief.md"))} and write ${rel(path.join(td, "cut.json"))} yourself.`);
  const first = inside[0].i, last = inside.at(-1).i;
  const outside = spoken.filter((w) => w.i < first || w.i > last).map((w) => `${w.i} "${w.text}"`);
  const edge = (ws) => ws.map((w) => `${w.i} "${w.text}"`).join(" ");
  fs.writeFileSync(path.join(td, "cut.json"), JSON.stringify({ keep: [{ words: `${first}-${last}`, why: "the moment" }] }, null, 1) + "\n");

  // where the text goes: one place for the captions, the shots raised that need it, the hook
  if (video === framed) { console.log(""); place(dir, {}, { build: false }); }

  const t = rel(takes), d = rel(td);
  console.log(`\n${rel(path.join(td, "cut.json"))}: the moment, words ${first}–${last}: it starts ${edge(inside.slice(0, 3))} …, ends … ${edge(inside.slice(-3))}${outside.length ? `; left out at the edges: ${outside.join(", ")}` : ""}.`);
  const long = lengthNote(said[1] - said[0], longest);
  if (long) console.log(long);
  if (video === framed) console.log(`Look at ${rel(path.join(dir, "framed.sheet.jpg"))} (one row per shot: the footage with the window in yellow, the frame at the shot's first, middle and last frame; red where eyes, nose or mouth are at an edge, as framing listed with ⚠; an ear or a cheek at the edge of a close-up is listed with · and is fine). Someone or something that matters cut off: node ${rel(path.join(HERE, "clips.mjs"))} reframe ${rel(dir)} --whole <second>; a speaker shown whole who should be followed: --follow <second>.`);
  console.log(`Next: read ${rel(path.join(td, "source", "brief.md"))}; fix misheard names in cut.json "fixes", move the start or the end when a word at the edge belongs to the moment or is a stray "und"; then
  node ${t} build ${d}${opts.out ? "" : " --out <composition>"}
  node ${t} captions ${d} --style <style>${opts.platform ? "" : " --platform <platforms>"}${opts.brand ? ` --brand ${opts.brand}` : ""}
  node ${t} check ${d}
  node ${rel(path.join(HERE, "clips.mjs"))} place ${rel(dir)}   (again once the cut is built: the hook's time is the cut's; it builds again)`);
}

// ---------------------------------------------------------------------------------- reframe
// What was asked of the framing (--whole, --follow, and the lifts place decided), kept beside it
// in <clip>/reframe.json so that the next framing keeps it: { kinds: [{ t, kind }], lifts: [{ t, px }] }
function asked(dir) {
  const f = path.join(dir, "reframe.json");
  return fs.existsSync(f) ? { kinds: [], lifts: [], ...read(f) } : { kinds: [], lifts: [] };
}
function frameAgain(dir, kept) {
  const clip = path.join(dir, "clip.mp4"), words = path.join(dir, "clip.words.json"), framed = path.join(dir, "framed.mp4");
  fs.writeFileSync(path.join(dir, "reframe.json"), JSON.stringify(kept, null, 1) + "\n");
  // the newest of two asks for one shot counts: frame.mjs takes the first that falls into a shot
  const kinds = [...kept.kinds].reverse();
  const flags = [
    ...(kinds.some((k) => k.kind === "whole") ? ["--whole", kinds.filter((k) => k.kind === "whole").map((k) => k.t).join(",")] : []),
    ...(kinds.some((k) => k.kind === "follow") ? ["--follow", kinds.filter((k) => k.kind === "follow").map((k) => k.t).join(",")] : []),
    ...(kept.lifts.length ? ["--lift", kept.lifts.map((l) => `${l.t}:${l.px}`).join(",")] : []),
  ];
  run(path.join(HERE, "frame.mjs"), [clip, words, "--aspect", "9:16", "--out", framed, ...flags]);
  if (!fs.existsSync(framed)) fail("The framing gave no video, see above.");
  // the edit's source is the framed clip: the new one in its place (same length, same sound)
  const src = path.join(dir, "takes", "source", "01.mp4");
  if (fs.existsSync(src)) {
    fs.rmSync(src);
    try { fs.linkSync(framed, src); } catch { fs.copyFileSync(framed, src); }
  }
  writeStill(dir);
}

function reframe(dir, opts) {
  if (!dir || !(opts.whole || opts.follow)) fail("clips.mjs reframe <clip> [--whole <s>,…] [--follow <s>,…]");
  const clip = path.join(dir, "clip.mp4"), words = path.join(dir, "clip.words.json");
  if (!fs.existsSync(clip) || !fs.existsSync(words)) fail(`${rel(dir)} is not prepared: clips.mjs prepare first.`);
  const kept = asked(dir);
  for (const kind of ["whole", "follow"]) for (const v of String(opts[kind] || "").split(",").filter(Boolean)) {
    const t = Number(v);
    if (!Number.isFinite(t)) fail(`--${kind} takes seconds of the clip, as 12.5.`);
    kept.kinds = kept.kinds.filter((k) => k.t !== t).concat({ t, kind });
  }
  frameAgain(dir, kept);
  const takes = takesTool();
  console.log(`Next: node ${rel(path.join(HERE, "clips.mjs"))} place ${rel(dir)} (the shots may now stand otherwise under the captions), then node ${takes ? rel(takes) : "<best-takes>/tools/takes.mjs"} build ${rel(path.join(dir, "takes"))} (the cut, the captions and the hook stay), then check.`);
}

// ------------------------------------------------------------------------------------ place
// agentitos' layout: LAYOUT_TOOL, else beside this skill, else in the machine's clone
function layoutTool() {
  const skill = path.dirname(HERE);
  return [process.env.LAYOUT_TOOL, path.join(skill, "..", "layout", "tools", "place.mjs"), "/home/sprite/skills/layout/tools/place.mjs"].find((p) => p && fs.existsSync(p)) || null;
}

function place(dir, opts, { build = true } = {}) {
  if (!dir) fail("clips.mjs place <clip> [--raise moderate|full] [--caption-y <px>] [--font-size <px>] [--lift <s>:<px>,…] [--hook text|card]");
  const framedJson = path.join(dir, "framed.json"), td = path.join(dir, "takes");
  if (!fs.existsSync(path.join(td, "cut.json"))) fail(`${rel(dir)} is not prepared: clips.mjs prepare first.`);
  if (!fs.existsSync(framedJson)) {
    console.log("No framing, so no faces are known (the footage has the frame's shape, or was not framed): the captions stay on the safe box's bottom and the hook card at the top. Look at the preview whether they lie on a face.");
    return null;
  }
  const tool = layoutTool();
  if (!tool) fail("Placing the text needs agentitos' layout skill beside this one (or LAYOUT_TOOL naming its tools/place.mjs).");
  const settingsFile = path.join(td, "source", "settings.json");
  const s = fs.existsSync(settingsFile) ? read(settingsFile) : {};
  const prev = fs.existsSync(path.join(td, "place.json")) ? read(path.join(td, "place.json")) : {};
  // what the agent fixed, kept for the next run: given now, or given before
  const fixed = { ...(prev.fixed || {}) };
  if (opts["caption-y"] !== undefined) fixed.y = opts["caption-y"] === "" ? undefined : Number(opts["caption-y"]);
  if (opts["font-size"] !== undefined) fixed.font = opts["font-size"] === "" ? undefined : Number(opts["font-size"]);
  if (opts.raise !== undefined) { if (!["moderate", "full", ""].includes(opts.raise)) fail("--raise is moderate (a shot raised only while the whole head stays in the picture; the default) or full (until the eyes reach the apps' top bar, the head cut by the frame's top); \"\" gives back the default."); fixed.raise = opts.raise || undefined; }
  if (opts.hook !== undefined) { if (!["text", "card", ""].includes(opts.hook)) fail("--hook is text (a short text below the chin or above the head) or card (a card at the top); \"\" lets layout choose."); fixed.hook = opts.hook || undefined; }
  if (opts.lift !== undefined) for (const v of String(opts.lift).split(",").filter(Boolean)) {
    const m = v.match(/^(\d+(?:\.\d+)?):(\d+)$/);
    if (!m) fail("--lift is <second>:<px>, the second of the clip as the sheet lists the shot, and how far its picture is raised (0: not at all), as 21.5:180.");
    fixed.lifts = { ...(fixed.lifts || {}), [m[1]]: Number(m[2]) };
  }
  for (const k of Object.keys(fixed)) if (fixed[k] === undefined) delete fixed[k];

  const framed = read(framedJson);
  if (!framed.size) framed.size = [probe(path.join(dir, "clip.mp4")).width, probe(path.join(dir, "clip.mp4")).height];
  const shots = framedShots(framed, { unlifted: true });
  let span;
  try { span = spanOf(dir); } catch (e) { fail(e.message); }
  const hook = s.hook ? hookSpan(span) : null;
  const { input, index } = shotsInput(shots, span, hook);
  const folder = path.join(dir, "placement");
  fs.mkdirSync(folder, { recursive: true });
  const shotsFile = path.join(folder, "shots.json");
  fs.writeFileSync(shotsFile, JSON.stringify(input));
  // a lift fixed at a second: the shot of the cut at that second
  const lifts = Object.entries(fixed.lifts || {}).map(([t, px]) => {
    const k = input.shots.findIndex((x) => Number(t) >= x.start && Number(t) < x.end);
    if (k < 0) fail(`No shot of the cut at ${t} s: --lift takes a second of the clip as placed.sheet.jpg lists the shots.`);
    return `${k + 1}:${px}`;
  });
  const args = ["text", folder, "--frame", "1080x1920", "--shots", shotsFile, "--text", "caption", ...(hook ? ["--text", fixed.hook ? `hook:${fixed.hook}` : "hook"] : []),
    ...(s.platform ? ["--platform", s.platform] : []), "--raise", fixed.raise || "moderate", ...(fixed.y ? ["--caption-y", String(fixed.y)] : []), ...(fixed.font ? ["--font-size", String(fixed.font)] : []), ...lifts.flatMap((l) => ["--lift", l])];
  const r = spawnSync(process.execPath, [tool, ...args], { encoding: "utf8" });
  if (r.status !== 0) fail(`✗ layout: ${(r.stderr || r.stdout).trim()}`);
  const text = read(path.join(folder, "text.json"));

  // the lifts into the framing: a framing again where they changed
  const kept = asked(dir);
  const want = text.shots.map((x, i) => ({ t: +((x.start + x.end) / 2).toFixed(3), px: x.lift, shot: index[i] })).filter((l) => l.px > 0);
  const now = (framed.windows || []).filter((w) => w.lift).map((w) => ({ shot: w.shot, px: w.lift.px }));
  const same = want.length === new Set(now.map((w) => w.shot)).size && want.every((l) => now.some((w) => w.shot === l.shot && w.px === l.px));
  if (!same) {
    console.log(`Framing again with ${want.length ? want.map((l) => `shot ${l.shot + 1} raised ${l.px} px`).join(", ") : "no shot raised"} …`);
    frameAgain(dir, { ...kept, lifts: want.map(({ t, px }) => ({ t, px })) });
  }
  const after = read(framedJson);
  after.size = after.size || framed.size;
  const lifted = framedShots(after);

  // for best-takes: the captions' options, the hook's place, the faces
  const hookOut = text.hook ? { kind: text.hook.kind, box: text.hook.box, font: text.hook.font, lines: text.hook.lines,
    // ended early at a cut: until then, on the cut's clock
    ...(text.hook.why && span.built ? { until: +toOutput(text.hook.until, span.pieces).toFixed(3) } : {}) } : null;
  fs.writeFileSync(path.join(td, "place.json"), JSON.stringify({ by: "clips place", raise: fixed.raise || "moderate", caption: text.caption?.options, ...(hookOut ? { hook: hookOut } : {}), fixed }, null, 1) + "\n");
  fs.writeFileSync(path.join(td, "source", "faces.json"), JSON.stringify({ "01.mp4": facesFile(lifted) }) + "\n");

  // the list
  const sec = (x) => `${x.toFixed(1)}`;
  console.log(`\nThe captions: one place for the clip, one line of ${text.caption.font} px, the lowest line at y ${text.caption.options.y} (their middle at ${text.caption.middle} % of the height, ${text.caption.where === "above-head" ? "above the heads" : "below the chins"}).`);
  if (text.hook) console.log(`The hook: ${text.hook.kind === "card" ? "a card" : "a short text"} ${text.hook.where === "below-chin" ? "below the chin" : text.hook.where === "above-head" ? "above the head" : text.hook.where === "top" ? "at the top" : `(${text.hook.where})`}, y ${Math.round(text.hook.box[1])}–${Math.round(text.hook.box[1] + text.hook.box[3])}, ${text.hook.font} px (${text.hook.kindWhy}${text.hook.kind === "card" && input.hook?.calm === false ? ": the shot under it is not a close-up, so hands or things may lie behind it" : ""})${text.hook.why ? `; ${text.hook.why}` : ""}${text.hook.onFace?.seconds ? `; ✗ on a face for ${text.hook.onFace.seconds} s` : ""}.`);
  console.log(`Raised ${fixed.raise === "full" ? "fully: a shot goes up until the eyes reach the apps' top bar, the head may be cut by the frame's top (--raise full)" : "moderately: a shot goes up only while the whole head stays in the picture (--raise full raises further and cuts the head)"}.`);
  console.log(`Per shot of the cut (seconds of the clip, as the sheets list them):`);
  const rows = text.shots.map((x, i) => {
    // (the framing again found its shots anew: the one at this shot's middle)
    const k = index[i], mid = (x.start + x.end) / 2, sh = lifted.find((q) => mid >= q.start && mid < q.end) || lifted[k] || { faces: [] };
    const touch = x.touches.map((t) => `${t.who} ${sec(t.seconds)} s`).join(", ");
    const mouth = x.touches.some((t) => t.mouth > 0.05);
    console.log(`  ${String(k + 1).padStart(2)}. ${sec(x.start)}–${sec(x.end)} s  ${x.lift ? `raised ${x.lift} px${x.ground ? `, a blurred band of ${x.ground} px at the bottom (under the apps' text from y ${text.safe[1] + text.safe[3]})` : ""}${x.fixed ? " as you fixed it" : ""}` : "as framed"}; captions ${!touch ? "on no face" : x.lip ? `on the chin of ${touch}, the lower lip ${sec(x.lip)} s: not avoidable at a readable size` : mouth ? `✗ on the nose or eyes of ${touch}` : x.chin ? `on the chin or neck of ${touch}, not avoidable without cutting the head or a smaller picture` : `✗ on ${touch}`}`);
    const facesAt = (t) => { const out = []; for (const f of sh.faces) { let best = null; for (const m of f.track) if (!best || Math.abs(m.t - t) < Math.abs(best.t - t)) best = m; if (best && Math.abs(best.t - t) < 0.3) out.push(best.box); } return out; };
    return { n: k + 1, start: x.start, end: x.end, lift: x.lift, touch: !touch ? "" : x.lip ? `on chin and lip ${touch}` : mouth ? `ON THE NOSE ${touch}` : x.chin ? `on the chin ${touch}` : `ON A FACE ${touch}`, facesAt };
  });
  for (const c of text.conflicts) console.log(`✗ ${c}`);
  for (const n of text.notes.filter((n) => !/chin or neck/.test(n))) console.log(`note: ${n}`);
  const lips = text.shots.filter((x) => x.lip);
  if (lips.length) console.log(`On the lower lip, not avoidable at a readable size (${text.caption.font} px; the low end of published captions is ${text.caption.least} px): ${lips.map((x) => `${sec(x.start)}–${sec(x.end)} s ${sec(x.lip)} s`).join(", ")}. Nothing to fix; --raise full, a cut to another shot, or --font-size by hand would avoid it.`);
  for (const f of fs.readdirSync(dir)) if (/^placed\.sheet(-\d+)?\.jpg$/.test(f)) fs.rmSync(path.join(dir, f));
  const sheets = placeSheet(path.join(dir, "framed.mp4"), rows, { caption: text.caption, hook: text.hook ? { ...text.hook, end: text.hook.until } : null }, path.join(dir, "placed.sheet.jpg"), { fps: 25 });
  if (sheets.failed) console.log(`(ffmpeg drew no sheet: ${sheets.failed})`);
  if (sheets.length) console.log(`Look at ${sheets.map(rel).join(", ")}: per shot its first, middle and last frame, the captions' box yellow, the hook's cyan, the faces red (as the framing found them; best-takes' punch-ins keep the captions' line where it is).`);
  console.log(`To change it: --raise full (close-ups raised until the eyes reach the apps' top bar, the head cut, the chin clear) or moderate, --caption-y <px> (where the lowest line ends) and --font-size <px> for the captions, --lift <second>:<px> for a shot (0: as framed), --hook text|card; each is kept for the next run, "" gives it back to layout.`);
  if (build && span.built) {
    const takes = takesTool();
    if (takes) run(takes, ["build", td]);
  }
  return text;
}

// ----------------------------------------------------------------------------------- render
function render(dir, file) {
  if (!dir || !file) fail("clips.mjs render <clip> <video.mp4>");
  const takes = takesTool();
  if (!takes) fail("This needs agentitos' best-takes skill beside this one (or BEST_TAKES_TOOL naming its tools/takes.mjs).");
  const td = path.join(dir, "takes");
  if (!fs.existsSync(path.join(td, "edit.json"))) fail(`Nothing built yet: node ${rel(takes)} build ${rel(td)}`);
  const comp = path.resolve(read(path.join(td, "edit.json")).out);
  if (!fs.existsSync(path.join(comp, "index.html"))) fail(`No ${rel(path.join(comp, "index.html"))}: build again.`);
  const hf = (() => { try { return execFileSync("which", ["hyperframes"], { encoding: "utf8" }).trim(); } catch { return ""; } })();
  if (!hf) fail("hyperframes is not installed on this machine, so no video: the operator installs it (npm install -g hyperframes).");
  const out = path.resolve(file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const chrome = process.env.CHROME || process.env.HYPERFRAMES_BROWSER_PATH;
  const r = spawnSync(hf, ["render", ".", "--output", out, "--quiet", "--video-bitrate", "6M"], {
    cwd: comp, stdio: "inherit",
    env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", HYPERFRAMES_SKIP_SKILLS: "1", PUPPETEER_SKIP_DOWNLOAD: "1",
      ...(chrome ? { HYPERFRAMES_BROWSER_PATH: chrome, PRODUCER_HEADLESS_SHELL_PATH: chrome } : {}) },
  });
  if (r.status !== 0 || !fs.existsSync(out)) fail("The render failed, see above.");
  run(takes, ["finish", td, out]);
}

// ------------------------------------------------------------------------------ side by side
// this tool's commands for many clips, `jobs` at a time; each one's output in one piece as it ends
async function many(list, jobs, argsOf) {
  const results = [];
  let next = 0;
  const one = (item) => new Promise((done) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...argsOf(item)], { stdio: ["ignore", "pipe", "pipe"] });
    let said = "";
    child.stdout.on("data", (d) => (said += d));
    child.stderr.on("data", (d) => (said += d));
    child.on("close", (code) => {
      console.log(`\n── ${item.clip} ${code ? "✗" : "✓"}\n${said.trim()}`);
      done({ clip: item.clip, ok: !code });
    });
  });
  await Promise.all(Array.from({ length: Math.min(jobs, list.length) }, async () => {
    while (next < list.length) results.push(await one(list[next++]));
  }));
  return results;
}

function readPlan(file) {
  if (!file || !fs.existsSync(file)) fail(`There is no ${file || "clips.json"}: [{"clip": "work/01", "range": "478-484", "out": "…", "title": "…", "hook": "…"}, …]`);
  const list = read(file);
  if (!Array.isArray(list) || !list.length || list.some((c) => !c.clip)) fail(`${file}: a list of clips, each with its "clip" folder.`);
  return list;
}

async function prepareAll(episode, file, opts) {
  const list = readPlan(file);
  for (const c of list) if (!/^\d+-\d+$/.test(c.range || "")) fail(`${c.clip}: "range" is <first>-<last>.`);
  if (opts.platform) checkPlatforms(opts.platform);
  const shared = ["platform", "brand"].flatMap((k) => (opts[k] ? [`--${k}`, opts[k]] : []));
  const jobs = Number(opts.jobs || Math.max(1, Math.min(4, Math.floor(os.totalmem() / 1.5e9))));
  console.log(`Preparing ${list.length} clips, ${Math.min(jobs, list.length)} at a time …`);
  const r = await many(list, jobs, (c) => ["prepare", episode, c.clip, c.range, ...shared,
    ...["out", "title", "hook"].flatMap((k) => (c[k] ? [`--${k}`, c[k]] : []))]);
  const bad = r.filter((x) => !x.ok);
  console.log(`\n${r.length - bad.length} of ${r.length} prepared${bad.length ? `; ✗ ${bad.map((x) => x.clip).join(", ")}: see above, then prepare those one by one` : ""}. Next, for each: read its brief, then build, captions and check as each one says.`);
  if (bad.length) process.exit(1);
}

async function renderAll(file, folder, opts) {
  if (!folder) fail("clips.mjs render-all <clips.json> <folder> [--jobs N]");
  const list = readPlan(file);
  const jobs = Number(opts.jobs || Math.max(1, Math.min(2, Math.floor(os.totalmem() / 8e9))));
  console.log(`Rendering ${list.length} clips, ${Math.min(jobs, list.length)} at a time …`);
  const r = await many(list, jobs, (c) => ["render", c.clip, path.join(folder, `${path.basename(c.clip)}.mp4`)]);
  const bad = r.filter((x) => !x.ok);
  console.log(`\n${r.length - bad.length} of ${r.length} rendered into ${rel(folder)}${bad.length ? `; ✗ ${bad.map((x) => x.clip).join(", ")}: see above` : ""}.`);
  if (bad.length) process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
const [pos, opts] = parse(rest);
if (command === "prepare") prepare(pos[0], pos[1], pos[2], opts);
else if (command === "reframe") reframe(pos[0], opts);
else if (command === "render") render(pos[0], pos[1]);
else if (command === "place") place(pos[0], opts);
else if (command === "prepare-all") await prepareAll(pos[0], pos[1], opts);
else if (command === "render-all") await renderAll(pos[0], pos[1], opts);
else fail("clips.mjs prepare <episode> <clip> <first>-<last> [--out …] [--platform …] [--hook \"…\"] [--title \"…\"] [--brand …] | reframe <clip> [--whole <s>,…] [--follow <s>,…] | place <clip> [--raise moderate|full] [--caption-y <px>] [--font-size <px>] [--lift <s>:<px>] [--hook text|card] | render <clip> <video.mp4> | prepare-all <episode> <clips.json> | render-all <clips.json> <folder>");
