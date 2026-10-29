#!/usr/bin/env node
// A moment of a long video as a finished short in the video's own look: cut from the episode,
// framed 9:16 on whoever speaks, its pauses and "äh"s cut, at one level, with captions and a
// hook card. Made for agents: each step prints what to do next.
//
//   node tools/clips.mjs prepare <episode> <clip> <first>-<last> [--out <composition>] [--platform reels,tiktok]
//        [--hook "…"] [--title "…"] [--brand brand/DESIGN.md]
//        <episode> is the folder of episode.mjs fetch; the sentences first..last are cut from it
//        (<clip>/clip.mp4), framed on whoever speaks (<clip>/framed.mp4, tools/frame.mjs), and
//        handed to agentitos' best-takes (<clip>/takes/): every word written down again, closer,
//        tight pauses, one keep of the whole moment in <clip>/takes/cut.json
//   node tools/clips.mjs reframe <clip> [--whole <s>,…] [--follow <s>,…]
//        the framing again (no new cost: who sits where is kept), the shot at each <s> (seconds of
//        <clip>/clip.mp4, as framed.sheet.jpg lists them) shown whole or following who speaks; the
//        edit in takes/ stays, its next build takes the new picture
//   node tools/clips.mjs render <clip> <video.mp4>
//        the built preview rendered with HyperFrames, brought to −14 LUFS, subtitles beside it
//
// The edit itself is best-takes' (build, check, captions; its README): this tool only sets it up
// and prints the command lines with its path. best-takes is found at BEST_TAKES_TOOL, beside this
// skill, or in the machine's clone of the skills.

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VALUED = ["out", "platform", "hook", "title", "brand", "whole", "follow"];

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
  const settings = ["--aspect", "9:16", "--pauses", "tight", "--punch", "on", ...Object.entries(opts).filter(([k]) => !["whole", "follow"].includes(k)).flatMap(([k, v]) => [`--${k}`, v])];
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

  const t = rel(takes), d = rel(td);
  console.log(`\n${rel(path.join(td, "cut.json"))}: the moment, words ${first}–${last}: it starts ${edge(inside.slice(0, 3))} …, ends … ${edge(inside.slice(-3))}${outside.length ? `; left out at the edges: ${outside.join(", ")}` : ""}.`);
  if (video === framed) console.log(`Look at ${rel(path.join(dir, "framed.sheet.jpg"))} (each shot: the footage left, the frame right). Someone or something that matters cut off: node ${rel(path.join(HERE, "clips.mjs"))} reframe ${rel(dir)} --whole <second>; a speaker shown whole who should be followed: --follow <second>.`);
  console.log(`Next: read ${rel(path.join(td, "source", "brief.md"))}; fix misheard names in cut.json "fixes", move the start or the end when a word at the edge belongs to the moment or is a stray "und"; then
  node ${t} build ${d}${opts.out ? "" : " --out <composition>"}
  node ${t} captions ${d} --style <style>${opts.platform ? "" : " --platform <platforms>"}${opts.brand ? ` --brand ${opts.brand}` : ""}
  node ${t} check ${d}`);
}

// ---------------------------------------------------------------------------------- reframe
function reframe(dir, opts) {
  if (!dir || !(opts.whole || opts.follow)) fail("clips.mjs reframe <clip> [--whole <s>,…] [--follow <s>,…]");
  const clip = path.join(dir, "clip.mp4"), words = path.join(dir, "clip.words.json"), framed = path.join(dir, "framed.mp4");
  if (!fs.existsSync(clip) || !fs.existsSync(words)) fail(`${rel(dir)} is not prepared: clips.mjs prepare first.`);
  const flags = ["whole", "follow"].flatMap((k) => (opts[k] ? [`--${k}`, opts[k]] : []));
  run(path.join(HERE, "frame.mjs"), [clip, words, "--aspect", "9:16", "--out", framed, ...flags]);
  if (!fs.existsSync(framed)) fail("The framing gave no video, see above.");
  // the edit's source is the framed clip: the new one in its place (same length, same sound)
  const src = path.join(dir, "takes", "source", "01.mp4");
  if (fs.existsSync(src)) {
    fs.rmSync(src);
    try { fs.linkSync(framed, src); } catch { fs.copyFileSync(framed, src); }
  }
  writeStill(dir);
  const takes = takesTool();
  console.log(`Next: node ${takes ? rel(takes) : "<best-takes>/tools/takes.mjs"} build ${rel(path.join(dir, "takes"))} (the cut, the captions and the hook stay), then check.`);
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

const [command, ...rest] = process.argv.slice(2);
const [pos, opts] = parse(rest);
if (command === "prepare") prepare(pos[0], pos[1], pos[2], opts);
else if (command === "reframe") reframe(pos[0], opts);
else if (command === "render") render(pos[0], pos[1]);
else fail("clips.mjs prepare <episode> <clip> <first>-<last> [--out …] [--platform …] [--hook \"…\"] [--title \"…\"] [--brand …] | reframe <clip> [--whole <s>,…] [--follow <s>,…] | render <clip> <video.mp4>");
