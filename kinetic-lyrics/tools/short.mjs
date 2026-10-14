#!/usr/bin/env node
// A kinetic short from a clip of people talking, step by step, in one project folder:
// every spoken word big on screen over the clip's own footage, with a world of light,
// word effects and the speakers' names. Made for agents: each step prints what to do next.
//
//   node tools/short.mjs new <dir> <clip>     <dir>/source/: the clip's sound (audio.wav), its
//                                             footage (video.*) and its words (transcript.json)
//   node tools/short.mjs brief <dir>          who speaks when; writes source/brief.md, the
//                                             direction to read before writing source/staging.json
//   node tools/short.mjs build <dir>          the HyperFrames project in <dir>/composition/
//   node tools/short.mjs check <dir> [t,…]    plays it and lists what a viewer would notice;
//                                             pictures at the seconds named go to <dir>/stills/<t>.png
//
// <dir> may already exist (e.g. made by the harness the agent runs in); `new` only needs
// <dir>/source/ to be free. Options are kept in source/settings.json for the next steps:
//   --speakers N  --names "A=Anna,B=Ben"  --title "…"  --subtitle "…"  --hook "…"
//   --world cosmos|aurora|bokeh|neon|noir|editorial|geometry  --aspect 9:16|1:1|4:5|16:9
//   --colors "A=#ff5a36,B=#4fc3f7" (each speaker's colour; "" = the world's)  --cta "…"  --handle @name

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const VALUED = ["speakers", "names", "colors", "title", "subtitle", "hook", "world", "aspect", "cta", "handle"];

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
    if (VALUED.includes(k)) { if (i + 1 >= args.length) fail(`${a} needs a value.`); opts[k] = String(args[++i]); }
    else fail(`Unknown option ${a}. Options: ${VALUED.map((o) => "--" + o).join(" ")}`);
  }
  return [pos, opts];
}

const source = (dir, file = "") => path.join(dir, "source", file);

function settings(dir, opts) {
  const file = source(dir, "settings.json");
  const kept = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  // shorts from before: the text mode is gone, every word is big
  delete kept.keywords; delete kept["full-text"];
  const merged = { aspect: "9:16", ...kept, ...opts };
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
  const f = fs.readdirSync(source(dir)).find((f) => /^video\./.test(f));
  return f ? source(dir, f) : null;
}

function buildArgs(dir, s) {
  const args = [source(dir, "transcript.json"), "--preset", "podcast", "--aspect", s.aspect,
    "--audio", source(dir, "audio.wav"), "--diarize", s.speakers || "0"];
  const video = footage(dir);
  if (video) args.push("--video", video);
  for (const [k, flag] of [["names", "--speakers"], ["colors", "--colors"], ["title", "--title"], ["subtitle", "--subtitle"], ["hook", "--hook"],
    ["world", "--world"], ["cta", "--cta"], ["handle", "--handle"]]) if (s[k]) args.push(flag, s[k]);
  // no title: none on screen (build.mjs takes a bare --title as none, else the file's name)
  if (!s.title) args.push("--title");
  return args;
}

const README = `# source/

What \`tools/short.mjs\` of kinetic-lyrics keeps for this short:

- \`video.*\`, \`audio.wav\`: the clip; \`transcript.json\`: its words with their timings and,
  transcribed through OpenRouter, who speaks them
- \`transcript.speakers*.json\`: who speaks when, found on this machine when the transcript has no speakers
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
  // who speaks: the transcript itself (OpenRouter) or the newest local diarization
  const latest = fs.readdirSync(source(dir)).filter((f) => /^transcript(\.speakers.*)?\.json$/.test(f))
    .map((f) => source(dir, f)).sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs).pop();
  if (latest) {
    const raw = JSON.parse(fs.readFileSync(latest, "utf8"));
    const voices = {};
    for (const w of Array.isArray(raw) ? raw : raw.words || []) if (w.speaker) voices[w.speaker] = (voices[w.speaker] || 0) + 1;
    const list = Object.keys(voices).sort().map((k) => `${k} ${voices[k]} words`);
    if (list.length) console.log(`Voices: ${list.join(", ")}. Name them with --names "A=…,B=…" (who speaks first is A).`);
  }
  console.log(`Read ${source(dir, "brief.md")} and write the staging into ${source(dir, "staging.json")}, then short.mjs build ${dir}.`);
}

function build(dir, opts) {
  project(dir);
  const s = settings(dir, opts);
  const staging = source(dir, "staging.json");
  const has = fs.existsSync(staging);
  if (!has) console.log("No staging yet: the words are set by the keyword lexicon. Better: short.mjs brief first.");
  const exit = node("build.mjs", ...buildArgs(dir, s), ...(has ? ["--staging", staging] : []), "--out", path.join(dir, "composition"));
  if (exit === 2) fail("Fix the staging as the message above says, then build again.");
  if (exit !== 0) fail("The build failed, see above.");
  // what the built short has, for a page beside it (the interview page reads it from the
  // project, which serves composition/): the settings and the voices
  const plan = JSON.parse(fs.readFileSync(path.join(dir, "composition", "plan.json"), "utf8"));
  fs.writeFileSync(path.join(dir, "composition", "settings.json"), JSON.stringify({
    settings: s, world: plan.world, speakers: (plan.speakers || []).map((sp) => sp.id),
  }, null, 2) + "\n");
  console.log(`${dir}/composition is built. short.mjs check ${dir} finds what a viewer would notice.`);
}

function check(dir, times) {
  project(dir);
  const comp = path.join(dir, "composition");
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

const [step, ...rest] = process.argv.slice(2);
const [[dir, arg], opts] = parse(rest);
switch (step) {
  case "new": create(dir, arg, opts); break;
  case "brief": brief(dir, opts); break;
  case "build": build(dir, opts); break;
  case "check": check(dir, arg); break;
  default: fail("short.mjs new <dir> <clip> | brief <dir> | build <dir> | check <dir> [seconds,…]");
}
