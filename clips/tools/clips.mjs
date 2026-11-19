#!/usr/bin/env node
// A moment of a long video as a finished short in the video's own look: cut from the episode,
// framed 9:16 on whoever speaks, its pauses and "äh"s cut, at one level, with captions and a
// hook card. Made for agents: each step prints what to do next.
//
//   node tools/clips.mjs prepare <episode> <clip> <first>-<last> [--out <composition>] [--platform reels,tiktok]
//        [--hook "…"] [--title "…"] [--brand brand/DESIGN.md] [--drop <sentences>] [--payoff <sentence>]
//        <episode> is the folder of episode.mjs fetch; the sentences first..last are cut from it
//        (<clip>/clip.mp4), framed on whoever speaks (<clip>/framed.mp4, tools/frame.mjs), and
//        handed to agentitos' best-takes (<clip>/takes/): every word written down again, closer,
//        tight pauses, one keep of the whole moment in <clip>/takes/cut.json. --drop 229-234,240
//        (sentence numbers inside the moment, as moments.json marks them for a passage that is
//        over the limit) leaves those sentences out: the clip still holds the whole stretch, the
//        keeps in cut.json go around them. --payoff 262 (the moment's `payoff` in moments.json)
//        prints that sentence's words in the clip, to open the short with it spoken; cut.json
//        stays the moment in its order
//   node tools/clips.mjs reframe <clip> [--whole <s>,…] [--follow <s>,…]
//        the framing again (no new cost: who sits where is kept), the shot at each <s> (seconds of
//        <clip>/clip.mp4, as framed.sheet.jpg lists them) shown whole or following who speaks; the
//        edit in takes/ stays, its next build takes the new picture
//   node tools/clips.mjs place <clip> [--raise head|mouth|full] [--caption-y <px>] [--font-size <px>] [--lines 1|2] [--lift <s>:<px>,…] [--hook text|card]
//        where the text goes over the framed clip: one place for the captions of the whole clip,
//        each shot raised where its chin would reach into them (the framing again, no cost), the
//        hook's place over its first seconds, all by agentitos' layout from every face over time;
//        a list per shot (where the text is, which face it lies on, how long), <clip>/placed.sheet.jpg
//        (the text's boxes over each shot's first, middle and last frame), takes/place.json for
//        best-takes (the captions' options, the hook's box) and takes/source/faces.json (the faces
//        it keeps its punch-ins and its check by). prepare runs it once; run it again after the
//        cut's start moved or to change what it chose, it builds again when the edit is built
//   node tools/clips.mjs shots <framed.json> <shots.json>
//        every shot of a framing (frame.mjs's json beside its video) with every face in the frame over
//        time, ten times a second, as the framing draws it unraised: the shots.json agentitos' layout
//        (place.mjs text) takes, for a skill that frames footage with frame.mjs and lays out its own
//        text (kinetic-lyrics). No cost
//   node tools/clips.mjs names <clip> [--episode <dir>]
//        the episode's names list on the clip's words again (cut.json "fixes"), after
//        episode.mjs names --take or --leave changed it; prepare does it once. No cost
//   node tools/clips.mjs render <clip> <video.mp4>
//        the built preview rendered with HyperFrames, brought to −14 LUFS, subtitles beside it
//   node tools/clips.mjs prepare-all <episode> <clips.json> [--platform …] [--brand …] [--jobs N]
//        prepare for every clip of clips.json side by side ([{"clip": "work/01", "range": "478-484",
//        "out": "artifacts/clips/composition/01-…", "title": "…", "hook": "…", "drop": "480-481", "payoff": 482}, …]); each one's
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
import { clipFixes } from "./lib/names.mjs";
import { numbers, ranges, cutKeeps, dropNote, sentenceWords, openingNote, lengthNote, playedSeconds, MAX_SECONDS } from "./lib/moments.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VALUED = ["episode", "out", "platform", "hook", "title", "brand", "whole", "follow", "jobs", "drop", "payoff", "max-seconds", "caption-y", "font-size", "lift", "raise", "lines"];

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

// the size as shown (a phone's upright picture stored on its side with a rotation of ±90)
const probe = (file) => {
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:stream_side_data=rotation:stream_tags=rotate:format=duration", "-of", "json", file], { encoding: "utf8" }));
  const v = j.streams[0], side = Math.abs(Number(v.side_data_list?.find((d) => d.rotation != null)?.rotation ?? v.tags?.rotate ?? 0)) % 180 === 90;
  return { width: side ? v.height : v.width, height: side ? v.width : v.height, duration: Number(j.format.duration) };
};

// ---------------------------------------------------------------------------------- prepare
function prepare(episode, dir, range, opts) {
  if (!episode || !dir || !/^\d+-\d+$/.test(range || "")) fail("clips.mjs prepare <episode> <clip> <first>-<last> [--out …] [--platform …] [--hook \"…\"] [--title \"…\"] [--brand …] [--drop <sentences>] [--payoff <sentence>] [--max-seconds <s>]");
  if (!fs.existsSync(path.join(episode, "words.json"))) fail(`No ${rel(path.join(episode, "words.json"))}: first node ${rel(path.join(HERE, "episode.mjs"))} fetch <url|file> ${rel(episode)}.`);
  const [a, b] = range.split("-").map(Number);
  const sentences = read(path.join(episode, "sentences.json"));
  // the sentences to leave out, checked before anything is cut or paid for
  const drop = opts.drop ? numbers(opts.drop) : [];
  if (!drop || drop.some((k) => k <= a || k >= b)) fail(`--drop ${opts.drop}: sentence numbers inside ${range}, never its first or last sentence, as in --drop ${a + 1}${b - a > 2 ? `-${a + 2}` : ""}.`);
  const payoff = opts.payoff == null ? null : Number(opts.payoff);
  if (payoff != null && (!Number.isInteger(payoff) || payoff < a || payoff > b || drop.includes(payoff))) fail(`--payoff ${opts.payoff}: one sentence number of ${range} that is not dropped, as moments.json gives it (its "payoff").`);
  // the limit the moments were found for travels with them: moments.json's, or --max-seconds
  const found = path.join(episode, "moments.json");
  const limit = opts["max-seconds"] != null ? Number(opts["max-seconds"]) : fs.existsSync(found) ? Number(read(found).limit) || MAX_SECONDS : MAX_SECONDS;
  if (!(limit >= 15 && limit <= 600)) fail(`--max-seconds ${opts["max-seconds"]}: how long the short may be, 15 to 600 seconds, as moments was run with.`);
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
    fs.writeFileSync(path.join(dir, "clip.json"), JSON.stringify({ ...read(path.join(dir, "clip.json")), range, episode: path.resolve(episode) }));
  }
  const { from, to } = read(path.join(dir, "clip.json"));
  // the episode it was cut from, for clips.mjs names later
  fs.writeFileSync(path.join(dir, "clip.json"), JSON.stringify({ ...read(path.join(dir, "clip.json")), episode: path.resolve(episode) }));
  // where the moment's first and last sentence are in the clip
  const said = [sentences[a].start - from, sentences[b].end - from];

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
  // the limit as best-takes' target: its check says when the cut, opening and all, is longer
  const settings = ["--aspect", "9:16", "--pauses", "tight", "--punch", "on", "--target", String(limit), ...Object.entries(opts).filter(([k]) => !["episode", "whole", "follow", "drop", "payoff", "max-seconds", "caption-y", "font-size", "lift", "raise", "lines"].includes(k)).flatMap(([k, v]) => [`--${k}`, v])];
  run(takes, ["new", td, video, ...settings]);
  writeStill(dir);

  // the whole moment as one keep: the words heard within its first and last sentence (the cut's
  // air may hold the tail of the sentence before or the start of the one after; the episode's
  // times are a tenth of a second off at most). With --drop, a keep on each side of the
  // sentences left out: best-takes plays the keeps in their order, with a jump cut between them.
  const { words: heard } = read(path.join(td, "source", "words.json"));
  const spoken = heard.filter((w) => w.kind === "word" || w.kind === "filler");
  const { keeps, inside, plan, gone, folded } = cutKeeps(spoken, sentences, a, b, drop, from, said);
  if (!inside.length) fail(`✗ No word heard in the moment's sentences in ${rel(video)}: look at ${rel(path.join(td, "source", "brief.md"))} and write ${rel(path.join(td, "cut.json"))} yourself.`);
  if (!keeps.length) fail(`✗ --drop ${opts.drop} leaves no word of the moment: drop fewer sentences (rm -r ${rel(td)}, then prepare again).`);
  const first = inside[0].i, last = inside.at(-1).i;
  const outside = spoken.filter((w) => w.i < first || w.i > last).map((w) => `${w.i} "${w.text}"`);
  const edge = (ws) => ws.map((w) => `${w.i} "${w.text}"`).join(" ");
  fs.writeFileSync(path.join(td, "cut.json"), JSON.stringify({ keep: keeps.map(([x, y], k) => ({ words: x === y ? `${x}` : `${x}-${y}`,
    why: keeps.length === 1 ? "the moment" : `the moment, part ${k + 1} of ${keeps.length} (sentences ${ranges([...plan.cut, ...plan.asides].sort((x, y) => x - y))} left out)` })) }, null, 1) + "\n");
  // the names episode.mjs names corrected in the episode, on the clip's own words
  const named = nameFixes(dir, episode);

  // where the text goes: one place for the captions, the shots raised that need it, the hook
  if (video === framed) { console.log(""); place(dir, {}, { build: false }); }

  const t = rel(takes), d = rel(td);
  console.log(`\n${rel(path.join(td, "cut.json"))}: the moment, words ${first}–${last}: it starts ${edge(inside.slice(0, 3))} …, ends … ${edge(inside.slice(-3))}${outside.length ? `; left out at the edges: ${outside.join(", ")}` : ""}.`);
  if (drop.length) console.log(dropNote(plan, gone, folded, keeps, sentences));
  if (named) console.log(namesNote(named));
  // how long the moment plays as cut, against the limit it was found for
  const estimate = playedSeconds(spoken, keeps);
  const note = lengthNote(estimate, limit);
  if (note) console.log(note);
  if (payoff != null) console.log(openingNote(sentenceWords(spoken, sentences[payoff], from), payoff, { first: a, estimate, limit }));
  if (video === framed) console.log(`Look at ${rel(path.join(dir, "framed.sheet.jpg"))} (one row per shot: the footage with the window in yellow, the frame at the shot's first, middle and last frame; red where eyes, nose or mouth are at an edge, as framing listed with ⚠; an ear or a cheek at the edge of a close-up is listed with · and is fine). Someone or something that matters cut off: node ${rel(path.join(HERE, "clips.mjs"))} reframe ${rel(dir)} --whole <second>; a speaker shown whole who should be followed: --follow <second>.`);
  console.log(`Next: read ${rel(path.join(td, "source", "brief.md"))}; fix misheard names the list did not hold in cut.json "fixes", move the start or the end when a word at the edge belongs to the moment or is a stray "und"; then
  node ${t} build ${d}${opts.out ? "" : " --out <composition>"}
  node ${t} captions ${d} --style <style>${opts.platform ? "" : " --platform <platforms>"}${opts.brand ? ` --brand ${opts.brand}` : ""}
  node ${rel(path.join(HERE, "clips.mjs"))} place ${rel(dir)}   (again once the cut and its captions are built: the hook's time is the cut's, the area the style's; it builds again)
  node ${t} check ${d}`);
}

// ------------------------------------------------------------------------------------ names
// The names the episode's list applies (episode.mjs names), on the clip's own words (best-takes
// wrote them anew, otherwise timed and sometimes spelled), as cut.json "fixes": the captions, the
// subtitles and the check spell them so. What the list put there is kept in takes/names.json, so
// that a change of the list (--take, --leave) takes back its old fixes and never one the agent
// wrote. → { found, missed, added, removed } or null when the episode has no list
function nameFixes(dir, episode) {
  const td = path.join(dir, "takes"), listed = path.join(episode, "names.json"), mine = path.join(td, "names.json");
  if (!fs.existsSync(listed)) return null;
  const { from, to } = read(path.join(dir, "clip.json"));
  const { words: heard } = read(path.join(td, "source", "words.json"));
  const r = clipFixes(heard, read(listed).entries || [], from, to - from);
  const cut = read(path.join(td, "cut.json"));
  const fixes = { ...(cut.fixes || {}) }, before = fs.existsSync(mine) ? read(mine).fixes || {} : {};
  const removed = [], added = [];
  for (const [i, t] of Object.entries(before)) if (fixes[i] === t && r.fixes[i] !== t) { delete fixes[i]; removed.push(i); }
  for (const [i, t] of Object.entries(r.fixes)) {
    // a spelling the agent wrote at that word stays theirs
    if (fixes[i] != null && fixes[i] !== t && before[i] !== fixes[i]) continue;
    if (fixes[i] !== t) added.push(i);
    fixes[i] = t;
  }
  if (Object.keys(fixes).length) cut.fixes = fixes; else delete cut.fixes;
  fs.writeFileSync(path.join(td, "cut.json"), JSON.stringify(cut, null, 1) + "\n");
  fs.writeFileSync(mine, JSON.stringify({ fixes: Object.fromEntries(Object.entries(r.fixes).filter(([i]) => fixes[i] === r.fixes[i])) }, null, 1) + "\n");
  return { ...r, added, removed, heard };
}

function namesNote(named) {
  const word = (i) => named.heard.find((w) => String(w.i) === String(i))?.text ?? i;
  return [
    named.found.length ? `The names: ${named.found.map((f) => `"${f.heard}" → "${f.to}" (word${f.words.length > 1 ? "s" : ""} ${f.words.join(", ")})`).join(", ")} in cut.json "fixes", as the episode's names list has them.` : "",
    named.removed.length ? `Taken back from cut.json "fixes" (the list no longer applies them): ${named.removed.map((i) => `word ${i} "${word(i)}"`).join(", ")}.` : "",
    // a place left as heard: what was heard, why nothing was changed, and that leaving it is right
    // where the clip did not hear the name
    ...named.missed.map((m) => `Left as heard at ${m.at.toFixed(1)} s: ${m.heard ? `the clip heard "${m.heard}"` : "the clip has no word there"} where the episode's list writes "${m.to}", and nothing was changed (${m.why}). Read the brief there: where the clip heard that name otherwise spelt, put "${m.to}" in cut.json "fixes"; where it heard another word${m.heard ? ` ("${m.heard}")` : ""}, leave it: that is what was said in this clip.`),
  ].filter(Boolean).join("\n");
}

// clips.mjs names <clip> [--episode <dir>]: the list again, after episode.mjs names --take/--leave
function names(dir, opts) {
  if (!dir) fail("clips.mjs names <clip> [--episode <dir>]");
  if (!fs.existsSync(path.join(dir, "takes", "cut.json"))) fail(`${rel(dir)} is not prepared: clips.mjs prepare first.`);
  const episode = opts.episode || read(path.join(dir, "clip.json")).episode;
  if (!episode) fail(`${rel(dir)} was prepared before clips kept its episode: clips.mjs names ${rel(dir)} --episode <the episode's folder>.`);
  const named = nameFixes(dir, episode);
  if (!named) fail(`There is no names list in ${rel(episode)}: episode.mjs names ${rel(episode)} first.`);
  const said = namesNote(named);
  const changed = named.added.length || named.removed.length;
  const takes = takesTool();
  console.log(`${said || "No name of the list lies in this clip."}${changed ? `\nNext: node ${takes ? rel(takes) : "<best-takes>/tools/takes.mjs"} build ${rel(path.join(dir, "takes"))} (the captions and the hook keep their place: only the words' text changes), then check.` : said ? "\nNothing changed in cut.json." : ""}`);
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

// ------------------------------------------------------------------------------------ shots
// a framing's shots with their faces in the frame, for layout's text (clips' own place builds the
// same from the cut's span: shotsInput)
function shots(file, out) {
  if (!file || !out) fail("clips.mjs shots <framed.json> <shots.json>: the framing frame.mjs wrote beside its video, and where the shots go.");
  let framed;
  try { framed = read(file); } catch (e) { fail(`${file} cannot be read (${e.code || e.message}): it is the .json frame.mjs writes beside the framed video.`); }
  if (!framed.size || !Array.isArray(framed.windows)) fail(`${file} is not a framing of frame.mjs (no size or windows): frame the footage again with frame.mjs.`);
  const [aw, ah] = framed.aspect || [9, 16], outW = 1080, outH = Math.round((outW * ah) / aw / 2) * 2;
  const list = framedShots(framed, { outW, outH, unlifted: true }).map((s, k) => ({ n: k + 1, start: s.start, end: s.end, weight: +(s.end - s.start).toFixed(3), kind: s.kind, picture: s.picture, faces: s.faces, room: s.room?.none ? null : { free: s.room?.free || 0 } }));
  fs.writeFileSync(out, JSON.stringify({ size: [outW, outH], shots: list }));
  const faces = list.filter((s) => s.faces.length).length;
  console.log(`${rel(out)}: ${list.length} shot(s) of ${outW}×${outH}, ${faces} with a face; for layout: place.mjs text <folder> --frame ${outW}x${outH} --shots ${rel(out)} --text …`);
}

// ------------------------------------------------------------------------------------ place
// agentitos' layout: LAYOUT_TOOL, else beside this skill, else in the machine's clone
function layoutTool() {
  const skill = path.dirname(HERE);
  return [process.env.LAYOUT_TOOL, path.join(skill, "..", "layout", "tools", "place.mjs"), "/home/sprite/skills/layout/tools/place.mjs"].find((p) => p && fs.existsSync(p)) || null;
}

// agentitos' captions: CAPTIONS_TOOL, else beside this skill, else in the machine's clone
function captionsTool() {
  const skill = path.dirname(HERE);
  return [process.env.CAPTIONS_TOOL, path.join(skill, "..", "captions", "tools", "captions.mjs"), "/home/sprite/skills/captions/tools/captions.mjs"].find((p) => p && fs.existsSync(p)) || null;
}
// how many lines a style's groups take: one line of about three words is what published Shorts
// carry (77 % of them), a style of whole phrases (more than four words a group: clean, subtitle,
// fill, label) keeps its two, as captions says (styles --json)
function styleLines(style) {
  const tool = captionsTool();
  if (!tool || !style) return 1;
  const r = spawnSync(process.execPath, [tool, "styles", "--json"], { encoding: "utf8" });
  try { const s = JSON.parse(r.stdout).find((x) => x.name === style); return s && s.words > 4 ? 2 : 1; } catch { return 1; }
}
// The captions as the last build set them (its captions/index.html, DATA): the style's line, its
// box, its outline and shadow, the groups and the size each came out at. null before captions are built.
function builtCaptions(td, s) {
  const file = path.join(path.resolve(s.out || path.join(td, "composition")), "captions", "index.html");
  try { return JSON.parse(fs.readFileSync(file, "utf8").match(/var DATA = (\{[\s\S]*?\});\n/)[1]); } catch { return null; }
}
// What of a style's ink lies outside its line (em of the type): below the lowest line half the
// outline and the shadow's drop (Chrome measured the Hormozi captions' shadow 10–12 px under the
// line's end at 62 px), at each side half the outline. The area the placement reserves holds it:
// the line's end stands that much above the area's bottom, the lines that much narrower.
function inkOf(look) {
  if (!look) return null;
  const k = 1 / (look.size || 96), drop = Math.max(0, ...[...String(look.shadow || "").matchAll(/(?:^|,)\s*-?[\d.]+(?:px)?\s+(-?[\d.]+)px/g)].map((m) => Number(m[1])));
  return { line: look.lineHeight || 1.2, box: !!look.box, below: look.box ? 0 : +(((look.stroke || 0) / 2 + drop) * k + 0.05).toFixed(3), side: +(((look.stroke || 0) / 2) * k).toFixed(3) };
}

function place(dir, opts, { build = true } = {}) {
  if (!dir) fail("clips.mjs place <clip> [--raise head|mouth|full] [--caption-y <px>] [--font-size <px>] [--lines 1|2] [--lift <s>:<px>,…] [--hook text|card]");
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
  if (opts.raise !== undefined) { if (!["head", "mouth", "full", "moderate", ""].includes(opts.raise)) fail("--raise is head (never a head cut by the frame: smaller type first, the captions on the chin or the lower lip), mouth (the default: past the head's top only where the captions would lie on a mouth) or full (until the chin is clear, the head cut by the frame's top); \"\" gives back the default."); fixed.raise = opts.raise === "moderate" ? "mouth" : opts.raise || undefined; }
  if (opts.lines !== undefined) { if (!["1", "2", ""].includes(String(opts.lines))) fail("--lines is 1 (one line of about three words, as most published Shorts) or 2 (two lines: a style of whole phrases, or a long word that breaks at its soft hyphen); \"\" gives it back to the style."); fixed.lines = opts.lines === "" ? undefined : Number(opts.lines); }
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
  // the captions' style as built: its lines, and the ink the area must hold
  const cut = read(path.join(td, "cut.json")), built = builtCaptions(td, s), ink = inkOf(built?.look);
  const lines = fixed.lines || styleLines(cut.captions?.style);
  const look = ink ? ["--set", `caption.line=${ink.line}`, "--set", `caption.padEm=${ink.box ? 0.44 : ink.below}`] : [];
  const args = ["text", folder, "--frame", "1080x1920", "--shots", shotsFile, "--text", lines > 1 ? "caption:2" : "caption", ...(hook ? ["--text", fixed.hook ? `hook:${fixed.hook}` : "hook"] : []), ...look,
    ...(s.platform ? ["--platform", s.platform] : []), "--raise", fixed.raise || "mouth", ...(fixed.y ? ["--caption-y", String(fixed.y)] : []), ...(fixed.font ? ["--font-size", String(fixed.font)] : []), ...lifts.flatMap((l) => ["--lift", l])];
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
  // for agentitos' captions: the lowest line ends above the area's bottom by the ink below it, the
  // lines narrower by the outline at each side, so that the ink stays inside the area
  const capOpts = text.caption ? { ...text.caption.options } : null;
  if (capOpts && ink) {
    capOpts.y = Math.round(capOpts.y - ink.below * capOpts["font-size"]);
    capOpts["max-width"] = Math.floor(capOpts["max-width"] - 2 * Math.ceil(ink.side * capOpts["font-size"] + 1));
  }
  fs.writeFileSync(path.join(td, "place.json"), JSON.stringify({ by: "clips place", raise: fixed.raise || "mouth", caption: capOpts, ...(hookOut ? { hook: hookOut } : {}), fixed }, null, 1) + "\n");
  fs.writeFileSync(path.join(td, "source", "faces.json"), JSON.stringify({ "01.mp4": facesFile(lifted) }) + "\n");

  // the list
  const sec = (x) => `${x.toFixed(1)}`;
  console.log(`\nThe captions: one place for the clip, ${text.caption.lines > 1 ? "up to two lines" : "one line"} of ${text.caption.font} px, the lowest line at y ${capOpts.y} (their middle at ${text.caption.middle} % of the height, ${text.caption.where === "no-face" ? "the clip shows no face, so they stand where published Shorts set theirs, the middle at 60–75 % of the height, as low as the apps leave free" : text.caption.where === "above-head" ? "above the heads" : "below the chins"}); ${ink ? `the area (y ${Math.round(text.caption.box[1])}–${Math.round(text.caption.box[1] + text.caption.box[3])}) is the ${cut.captions?.style || "style"}'s ${ink.box ? "box" : `line of ${ink.line} em and its outline and shadow below it (${Math.round(ink.below * text.caption.font)} px)`}, its lines ${capOpts["max-width"]} px wide at most so that the outline stays inside` : "the area is as tall as the tallest style's (the captions are not built yet: place again after takes captions)"}.`);
  if (text.hook) console.log(`The hook: ${text.hook.kind === "card" ? "a card" : "a short text"} ${text.hook.where === "below-chin" ? "below the chin" : text.hook.where === "above-head" ? "above the head" : text.hook.where === "top" ? "at the top" : text.hook.where === "middle" ? "in the middle" : text.hook.where === "free" ? "in the middle of the frame (no face to keep clear of)" : `(${text.hook.where})`}, y ${Math.round(text.hook.box[1])}–${Math.round(text.hook.box[1] + text.hook.box[3])}, ${text.hook.font} px (${text.hook.kindWhy}${text.hook.kind === "card" && input.hook?.calm === false && !/not calm/.test(text.hook.kindWhy || "") ? ": the shot under it is not a close-up, so hands or things may lie behind it" : ""})${text.hook.why ? `; ${text.hook.why}` : ""}${text.hook.onFace?.seconds ? `; ✗ on a face for ${text.hook.onFace.seconds} s` : ""}.`);
  const level = fixed.raise || "mouth";
  console.log(`Raised (--raise ${level}): ${level === "full" ? "a shot goes up until the chin is clear, as far as the eyes reach the apps' top bar, the head cut by the frame's top" : level === "head" ? "a shot goes up only while the whole head stays in the picture; the type goes to its floor first and what is left lies on the chin or the lower lip" : "a shot goes up while the whole head stays in the picture, and past the head's top only where the captions would otherwise lie on a mouth"} (head, mouth, full).`);
  console.log(`Per shot of the cut (seconds of the clip, as the sheets list them):`);
  // per shot the seconds on each part, the part named; a ✗ only where something can be done
  // (the lower lip from features that are an estimate between two stills: said with the stills, as
  // the mouth may open lower there, onto the captions)
  const stillsOf = (pairs) => { const two = pairs.filter(([a, b]) => a !== b), one = pairs.filter(([a, b]) => a === b); return [two.length ? `between the stills at ${two.map(([a, b]) => `${sec(a)} and ${sec(b)} s`).join(", ")}` : "", one.length ? `from the still at ${one.map(([a]) => `${sec(a)} s`).join(", ")} alone` : ""].filter(Boolean).join(" and "); };
  const estOf = (x) => { const w = x.touches.filter((t) => t.lipEst); return w.length ? ` (${sec(w.reduce((n, t) => n + t.lipEst, 0))} s of it ${stillsOf(w.flatMap((t) => t.stills))}: there the mouth's place is an estimate, look whether it opens onto the captions)` : ""; };
  const partsOf = (on, x) => [on.nose ? `the nose or eyes ${sec(on.nose)} s` : "", on.mouth ? `the mouth ${sec(on.mouth)} s` : "", on.lip ? `the lower lip ${sec(on.lip)} s${x ? estOf(x) : ""}` : "", on.chin ? `the chin ${sec(on.chin)} s` : ""].filter(Boolean).join(", ");
  const rows = text.shots.map((x, i) => {
    // (the framing again found its shots anew: the one at this shot's middle)
    const k = index[i], mid = (x.start + x.end) / 2, sh = lifted.find((q) => mid >= q.start && mid < q.end) || lifted[k] || { faces: [] };
    const who = [...new Set(x.touches.map((t) => t.who))].join(" and ");
    const on = x.on || {};
    const raised = `${x.lift ? `raised ${x.lift} px${x.ground ? `, a blurred band of ${x.ground} px at the bottom (under the apps' text from y ${text.safe[1] + text.safe[3]})` : ""}${x.fixed ? " as you fixed it" : x.past ? ", past the head's top so that the captions keep off the mouth" : x.returned ? ", as the other returns of this close-up" : ""}` : "as framed"}${x.headCut?.seconds ? `; the head cut at the top ${x.headCut.px} px for ${sec(x.headCut.seconds)} s${x.headCut.byLift ? ` (${x.headCut.byLift} px of it by the raise)` : ""}` : ""}`;
    const where = !x.touches.length || !(x.touches.some((t) => t.seconds > 0.05)) ? "on no face"
      : x.fault === "nose" ? `✗ on the nose or eyes of ${who}: ${partsOf(on, x)}`
      : x.fault === "mouth" ? `✗ on the mouth of ${who}: ${partsOf(on, x)}`
      : x.fault ? `✗ on the face of ${who} ${sec(x.touches.reduce((n, t) => n + t.seconds, 0))} s (a picture shown whole: reframe --follow)`
      : x.hair ? `above the head of ${who}, on the hair ${sec(x.touches.reduce((n, t) => n + t.seconds, 0))} s`
      : x.lip ? `on ${who}: ${partsOf(on, x)}, not on the mouth: not avoidable at a readable size`
      : `on the chin or neck of ${who} ${sec(on.chin ?? x.touches.reduce((n, t) => n + t.seconds, 0))} s, below the mouth`;
    console.log(`  ${String(k + 1).padStart(2)}. ${sec(x.start)}–${sec(x.end)} s  ${raised}; captions ${where}`);
    const facesAt = (t) => { const out = []; for (const f of sh.faces) { let best = null; for (const m of f.track) if (!best || Math.abs(m.t - t) < Math.abs(best.t - t)) best = m; if (best && Math.abs(best.t - t) < 0.3) out.push(best.box); } return out; };
    const label = !x.touches.length ? "" : x.fault === "nose" ? `ON THE NOSE ${who}` : x.fault === "mouth" ? `ON THE MOUTH ${who}` : x.fault ? `ON A FACE ${who}` : x.hair ? `on the hair ${who}` : x.lip ? `on lip and chin ${who}` : `on the chin ${who}`;
    return { n: k + 1, start: x.start, end: x.end, lift: x.lift, touch: label, facesAt };
  });
  for (const c of text.conflicts) console.log(`✗ ${c}`);
  for (const n of text.notes.filter((n) => !/chin or neck|on the hair/.test(n))) console.log(`note: ${n}`);
  for (const f of fs.readdirSync(dir)) if (/^placed\.sheet(-\d+)?\.jpg$/.test(f)) fs.rmSync(path.join(dir, f));
  const sheets = placeSheet(path.join(dir, "framed.mp4"), rows, { caption: text.caption, hook: text.hook ? { ...text.hook, end: text.hook.until } : null }, path.join(dir, "placed.sheet.jpg"), { fps: 25 });
  if (sheets.failed) console.log(`(ffmpeg drew no sheet: ${sheets.failed})`);
  if (sheets.length) console.log(`Look at ${sheets.map(rel).join(", ")}: per shot its first, middle and last frame, the captions' box yellow, the hook's cyan, the faces red (as the framing found them; best-takes' punch-ins keep the captions' line where it is).`);
  console.log(`To change it: --raise head|mouth|full (head: never a head cut, the type smaller first; mouth: past the head's top for a mouth, the default; full: the chin clear, the head cut), --caption-y <px> (where the lowest line ends) and --font-size <px> for the captions, --lift <second>:<px> for a shot (0: as framed), --lines 1|2, --hook text|card; each is kept for the next run, "" gives it back to layout.`);
  if (build && span.built) {
    const takes = takesTool();
    if (takes) run(takes, ["build", td]);
    // every group the captions set below the floor (a word wider than the line), by name
    const now = builtCaptions(td, s), least = text.caption.least;
    const low = (now?.groups || []).filter((g) => g.size && least && g.size < least);
    if (low.length) console.log(`✗ Captions below the low end of published ones (${least} px): ${low.map((g) => `"${g.words.map((w) => w.text.replace(/\u00AD/g, "")).join(" ")}" at ${sec(g.start)} s ${g.size} px`).join(", ")}. Put a soft hyphen (\\u00ad) where each long word may break into its text in cut.json "fixes", then place again with --lines 2${lines > 1 ? " (two lines already: a hyphen more, or a shorter word in the fixes)" : ""}.`);
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
  if (!file || !fs.existsSync(file)) fail(`There is no ${file || "clips.json"}: [{"clip": "work/01", "range": "478-484", "out": "…", "title": "…", "hook": "…", "drop": "480-481"}, …]`);
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
    ...["out", "title", "hook", "drop", "payoff", "max-seconds"].flatMap((k) => (c[k] != null && c[k] !== "" ? [`--${k}`, String(c[k])] : []))]);
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
else if (command === "names") names(pos[0], opts);
else if (command === "shots") shots(pos[0], pos[1]);
else if (command === "prepare-all") await prepareAll(pos[0], pos[1], opts);
else if (command === "render-all") await renderAll(pos[0], pos[1], opts);
else fail("clips.mjs prepare <episode> <clip> <first>-<last> [--out …] [--platform …] [--hook \"…\"] [--title \"…\"] [--brand …] [--drop <sentences>] [--payoff <sentence>] | reframe <clip> [--whole <s>,…] [--follow <s>,…] | place <clip> [--raise head|mouth|full] [--caption-y <px>] [--font-size <px>] [--lines 1|2] [--lift <s>:<px>] [--hook text|card] | names <clip> [--episode <dir>] | shots <framed.json> <shots.json> | render <clip> <video.mp4> | prepare-all <episode> <clips.json> | render-all <clips.json> <folder>");
