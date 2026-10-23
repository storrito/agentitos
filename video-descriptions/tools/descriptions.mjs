#!/usr/bin/env node
// The texts that go with a video on every platform it is posted to: captions, titles,
// descriptions, tags, hashtags and mentions, each within the platform's rules, in one style the
// agent picks for the video; and an overview page of all of them with copy buttons.
//
//   node tools/descriptions.mjs platforms [platform…] [--json]   the rules: fields, limits, how each
//                                                                 counts, what shows before "more",
//                                                                 hashtags, mentions, links, video
//   node tools/descriptions.mjs styles [--json]                   the styles and which videos they fit
//   node tools/descriptions.mjs read <video> <dir> [--words <words.json>] [--no-words]
//                                                                 what the video says and shows:
//                                                                 <dir>/video.json, words.txt, frames.jpg
//   node tools/descriptions.mjs check <dir> [--json]              <dir>/descriptions.json against the
//                                                                 rules, the video and the brand's handles
//   node tools/descriptions.mjs overview <dir> [--out artifacts/descriptions-<name>.html]
//                                                                 the overview page of all texts
//
// --brand <dir>: the brand kit (default brand/ of the working directory), for its social handles.
// The texts are the agent's: it writes <dir>/descriptions.json, the tool counts and checks.

import fs from "node:fs";
import path from "node:path";
import { PLATFORMS, CHECKED, platformById, fitting } from "./lib/platforms.mjs";
import { STYLES } from "./lib/styles.mjs";
import { probe, frameOf, readWords, lines, sheet, clock } from "./lib/media.mjs";
import { checkAll } from "./lib/check.mjs";
import { overview } from "./lib/overview.mjs";
import { UNITS } from "./lib/count.mjs";

const fail = (msg) => { console.error(msg); process.exit(1); };
const rel = (p) => path.relative(process.cwd(), p) || ".";
const self = () => (rel(process.argv[1]).startsWith("..") ? process.argv[1] : rel(process.argv[1]));
const cmd = (rest) => `node ${self()} ${rest}`;

const FLAGS = ["json", "no-words"];
const VALUED = ["words", "out", "brand"];

function parse(args) {
  const pos = [], opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const k = a.slice(2);
    if (FLAGS.includes(k)) { opts[k] = true; continue; }
    if (!VALUED.includes(k)) fail(`Unknown option ${a}. Options: ${[...VALUED, ...FLAGS].map((o) => "--" + o).join(" ")}`);
    if (i + 1 >= args.length) fail(`${a} needs a value.`);
    opts[k] = args[++i];
  }
  return [pos, opts];
}

const readJson = (file, what) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { fail(e.code === "ENOENT" ? `There is no ${rel(file)}${what ? `: ${what}` : "."}` : `${rel(file)} is no valid JSON: ${e.message}`); }
};

// ------------------------------------------------------------------------------- the brand kit

// the social profiles of brand/DESIGN.md's front matter (`social: {instagram: handle, …}` or a
// block of `key: value` lines), as { app: [handle] }
const APPS = { instagram: "instagram", ig: "instagram", tiktok: "tiktok", youtube: "youtube", x: "x", twitter: "x", linkedin: "linkedin", facebook: "facebook", pinterest: "pinterest", threads: "threads", bluesky: "bluesky", snapchat: "snapchat" };

function brandOf(dir) {
  const file = path.join(dir, "DESIGN.md");
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  const front = text.match(/^---\n([\s\S]*?)\n---/)?.[1] || "";
  const social = {};
  const put = (k, v) => {
    const app = APPS[k.trim().toLowerCase()];
    const handle = String(v).trim().replace(/^["']|["']$/g, "").replace(/^https?:\/\/(www\.)?[^/]+\/(@|in\/|company\/|c\/)?/, "").replace(/^@/, "").replace(/\/.*$/, "");
    if (app && handle) (social[app] ||= []).push(handle);
  };
  const inline = front.match(/^social:\s*\{([^}]*)\}/m);
  if (inline) for (const pair of inline[1].split(",")) { const [k, ...v] = pair.split(":"); put(k, v.join(":")); }
  const block = front.match(/^social:\s*\n((?:[ \t]+.*\n?)+)/m);
  if (block) for (const line of block[1].split("\n")) { const m = line.match(/^\s+([\w-]+):\s*(.+)$/); if (m) put(m[1], m[2]); }
  const voice = text.match(/\n## Voice and Tone\n([\s\S]*?)(?=\n## |$)/)?.[1]?.trim() || null;
  return { file, social, voice, name: front.match(/^name:\s*(.+)$/m)?.[1]?.replace(/^["']|["']$/g, "") || null };
}

// the handles a mention may name: the brand kit's, and those descriptions.json lists as known
function handlesOf(doc, brand) {
  const h = { "*": [] };
  for (const [app, list] of Object.entries(brand?.social || {})) (h[app] ||= []).push(...list);
  const known = doc.known || [];
  if (Array.isArray(known)) h["*"].push(...known.map((k) => String(k).replace(/^@/, "")));
  else for (const [app, list] of Object.entries(known)) (h[APPS[app] || app] ||= []).push(...[].concat(list).map((k) => String(k).replace(/^@/, "")));
  return h;
}

// ------------------------------------------------------------------------------- platforms

function cmdPlatforms(ids, opts) {
  const list = ids.length ? ids.map((id) => platformById(id) || fail(`There is no platform "${id}": ${PLATFORMS.map((p) => p.id).join(", ")}.`)) : PLATFORMS;
  if (opts.json) return console.log(JSON.stringify({ checked: CHECKED, platforms: list }, (k, v) => (v instanceof RegExp ? v.source : v), 2));
  console.log(`The platforms' rules for the texts of a video (compared ${CHECKED}; sources: --json or the README):\n`);
  for (const p of list) {
    console.log(`${p.id} · ${p.name} (${p.format})${p.aliases?.length ? `   also: ${p.aliases.join(", ")}` : ""}`);
    for (const [key, f] of Object.entries(p.fields)) {
      const max = typeof f.max === "object" ? `${f.max.free} (${f.max.premium} with Premium)` : f.max;
      const unit = f.kind === "list" ? (f.count === "youtube-tags" ? "characters, commas and the quotes of tags with spaces included" : "characters") : f.kind === "url" ? "characters" : UNITS[f.count || "chars"];
      const foldN = typeof f.fold === "object" ? `${f.fold.chars}${f.fold.lines ? ` or ${f.fold.lines} lines` : ""}` : f.fold;
      console.log(`  ${key.padEnd(12)} ${f.label}${f.required ? " (required)" : ""}: up to ${max} ${unit}${f.fold ? `; ${foldN} show before "${f.foldSays || "more"}"` : ""}${f.best ? `; best up to ${f.best}` : ""}`);
    }
    const h = p.hashtags || {};
    console.log(`  hashtags     ${h.max === 0 ? "none" : `${h.max != null ? `at most ${h.max}` : "no limit"}${h.best ? `, best ${h.best[0]}–${h.best[1]}` : ""}`}${h.says ? `: ${h.says}` : ""}`);
    const m = p.mentions || {};
    console.log(`  mentions     ${m.max != null ? `at most ${m.max}` : "no stated limit"}${m.rule ? `; names: ${m.rule}` : ""}`);
    console.log(`  links        ${{ clickable: "clickable in the text", dead: "not clickable in the text", costly: "clickable, but a link out costs reach (observed)", field: "in their own field" }[p.links] || p.links}`);
    if (p.video) {
      const vmax = typeof p.video.max === "object" ? `${clock(p.video.max.free)} (${clock(p.video.max.premium)} with Premium)` : p.video.max ? clock(p.video.max) : "–";
      console.log(`  video        up to ${vmax}${p.video.min ? `, at least ${p.video.min} s` : ""}${p.video.frames ? `; ${p.video.frames.join(", ")}` : ""}`);
    }
    for (const r of p.rules || []) console.log(`  · ${r}`);
    console.log(`  basis        ${p.basis}\n`);
  }
}

function cmdStyles(opts) {
  if (opts.json) return console.log(JSON.stringify(STYLES, null, 2));
  console.log("The styles. Pick the one that fits the video, the brand's voice and its audience; say why in descriptions.json (\"why\").\n");
  for (const s of STYLES) {
    console.log(`${s.id} · ${s.name} / ${s.nameDe}: ${s.sounds}`);
    console.log(`  does    ${s.does.join("; ")}`);
    console.log(`  fits    ${s.fits.join("; ")}`);
    console.log(`  avoids  ${s.avoids.join("; ")}`);
    console.log(`  e.g.    "${s.hook.en}" / "${s.hook.de}"\n`);
  }
}

// ------------------------------------------------------------------------------- read

async function cmdRead([video, dir], opts) {
  if (!video || !dir) fail(`${self()} read <video> <dir> [--words <words.json>] [--no-words]`);
  if (!fs.existsSync(video)) fail(`There is no ${video}.`);
  let info;
  try { info = probe(video); } catch (e) { fail(`${e.message}.`); }
  fs.mkdirSync(dir, { recursive: true });
  const frame = frameOf(info.width, info.height);
  console.log(`${path.basename(video)}: ${info.width}×${info.height} (${frame}), ${clock(info.duration)}${info.sound ? "" : ", no sound"}`);

  let words = null, source = null;
  if (opts.words) {
    try { words = readWords(opts.words); } catch (e) { fail(`${opts.words} holds no words: ${e.message}`); }
    source = rel(opts.words);
  } else if (!opts["no-words"] && info.sound) {
    const { scribe } = await import("./lib/asr.mjs");
    console.log("Transcribing (ElevenLabs Scribe through OpenRouter) …");
    try { words = await scribe(video, info.duration, { log: (s) => console.log(s) }); }
    catch (e) { fail(`The transcription failed (${e.message.split("\n")[0]}). Give the words with --words <words.json> (rragent's transcribe tool, the captions skill), or --no-words for a video without speech.`); }
    fs.writeFileSync(path.join(dir, "words.json"), JSON.stringify({ words }, null, 1));
    source = "ElevenLabs Scribe";
  }
  const said = words ? lines(words) : [];
  if (words) fs.writeFileSync(path.join(dir, "words.txt"), said.map((l) => `[${clock(l.start)}] ${l.text}`).join("\n") + "\n");

  const sheetFile = path.join(dir, "frames.jpg");
  let moments = [];
  try { moments = sheet(video, info, sheetFile); } catch (e) { fail(`${e.message}.`); }

  const fits = fitting({ ...info, frame });
  const meta = { video: rel(video), name: path.basename(video), width: info.width, height: info.height, frame, duration: +info.duration.toFixed(2), sound: info.sound, words: source, fits: fits.map((f) => f.id), unfit: Object.fromEntries(fits.unfit.map((u) => [u.id, u.why])) };
  fs.writeFileSync(path.join(dir, "video.json"), JSON.stringify(meta, null, 2) + "\n");

  console.log(`\n${rel(sheetFile)}: ${moments.length} frames at ${moments.map(clock).join(", ")}. Look at it: what is shown, who, where, the mood, any text or logo in the picture.`);
  if (words) {
    const n = words.filter((w) => w.kind === "word").length;
    console.log(`${rel(path.join(dir, "words.txt"))}: ${n} words in ${said.length} lines, timed (from ${source}). Read them all; fix a name the speech model misheard before you quote it.`);
    if (said.length) console.log(`  begins: "${said.slice(0, 2).map((l) => l.text).join(" ").slice(0, 160)}"`);
  } else console.log(info.sound ? "No words: the texts come from the pictures alone." : "The video has no sound: the texts come from the pictures alone.");

  console.log(`\nThe platforms this video fits (${frame}, ${clock(info.duration)}): ${fits.map((f) => f.id).join(", ")}`);
  for (const u of fits.unfit) console.log(`  not ${u.id}: ${u.why}`);

  const brand = brandOf(opts.brand || "brand");
  if (brand) {
    const handles = Object.entries(brand.social).map(([app, h]) => `${app} @${h.join(", @")}`).join("; ");
    console.log(`\nThe brand kit ${rel(brand.file)}${brand.name ? ` (${brand.name})` : ""}: ${brand.voice ? "read its Voice and Tone, the style follows it" : "no Voice and Tone written"}${handles ? `; its handles: ${handles}` : "; no social handles"}.`);
  } else console.log(`\nNo brand kit (brand/DESIGN.md): the style comes from the video alone. Mention only handles the person names or the video shows.`);

  console.log(`\nNext: ${cmd("platforms")} (the rules) and ${cmd("styles")}; decide the style, then write ${rel(path.join(dir, "descriptions.json"))} (see SKILL.md) and run ${cmd(`check ${rel(dir)}`)}.`);
}

// ------------------------------------------------------------------------------- check

function load(dir, opts) {
  const doc = readJson(path.join(dir, "descriptions.json"), `write it first (SKILL.md), after ${cmd(`read <video> ${rel(dir)}`)}`);
  if (!doc.posts || typeof doc.posts !== "object" || Array.isArray(doc.posts)) fail(`${rel(path.join(dir, "descriptions.json"))} needs "posts": {"<platform>": {fields…}}, as SKILL.md shows.`);
  const vfile = path.join(dir, "video.json");
  const video = fs.existsSync(vfile) ? readJson(vfile) : null;
  const brand = brandOf(opts.brand || "brand");
  const results = checkAll(doc, { video, handles: handlesOf(doc, brand) });
  if (!STYLES.some((s) => s.id === doc.style)) results.unshift({ platform: "(all)", name: "descriptions.json", fields: [], hashtags: [], mentions: [], links: [], errors: [`"style" is one of ${STYLES.map((s) => s.id).join(", ")}`], warnings: [], notes: [] });
  else if (!doc.why) results.unshift({ platform: "(all)", name: "descriptions.json", fields: [], hashtags: [], mentions: [], links: [], errors: [], warnings: ['"why" is missing: one sentence why this style fits the video, shown to the person'], notes: [] });
  return { doc, video, brand, results };
}

function cmdCheck([dir], opts) {
  if (!dir) fail(`${self()} check <dir> [--json]`);
  const { doc, video, results } = load(dir, opts);
  if (opts.json) return console.log(JSON.stringify(results, null, 2));
  let errors = 0, warnings = 0;
  for (const r of results) {
    errors += r.errors.length; warnings += r.warnings.length;
    const mark = r.errors.length ? "✗" : r.warnings.length ? "⚠" : "✓";
    console.log(`${mark} ${r.platform}${r.name ? ` · ${r.name}` : ""}`);
    for (const f of r.fields) {
      console.log(`    ${f.label}: ${f.length}${f.max ? ` / ${f.max}` : ""}${f.unit && f.kind !== "url" ? ` ${f.unit}` : ""}`);
      if (f.visible != null && f.rest) console.log(`      before "${f.foldSays || "more"}": "${f.visible.replace(/\n/g, "⏎")}"`);
    }
    if (r.hashtags.length) console.log(`    #: ${r.hashtags.map((h) => h.text).join(" ")}`);
    if (r.mentions.length) console.log(`    @: ${r.mentions.map((m) => m.text).join(" ")}`);
    for (const e of r.errors) console.log(`    ✗ ${e}`);
    for (const w of r.warnings) console.log(`    ⚠ ${w}`);
    for (const n of r.notes) console.log(`    · ${n}`);
  }
  const missing = (video?.fits || []).filter((id) => !doc.posts[id]);
  if (missing.length) console.log(`\nThe video fits these too, which have no texts: ${missing.join(", ")}. Leave them out only when the person does not post there.`);
  console.log(errors ? `\n${errors} ✗ to fix in descriptions.json, then check again.` : `\nAll within the rules${warnings ? `; ${warnings} ⚠ to look at (fix it, or keep it for a reason)` : ""}. Next: ${cmd(`overview ${rel(dir)}`)}`);
  if (errors) process.exitCode = 1;
}

// ------------------------------------------------------------------------------- overview

function cmdOverview([dir], opts) {
  if (!dir) fail(`${self()} overview <dir> [--out artifacts/descriptions-<name>.html]`);
  const { doc, video, results } = load(dir, opts);
  const errors = results.reduce((n, r) => n + r.errors.length, 0);
  if (errors) fail(`descriptions.json has ${errors} ✗: ${cmd(`check ${rel(dir)}`)} names them; fix them before the overview.`);
  const name = path.basename(path.resolve(dir));
  const out = opts.out || path.join("artifacts", `descriptions-${name}.html`);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, overview(doc, results.filter((r) => r.platform !== "(all)"), { video, title: doc.title }));
  const warnings = results.reduce((n, r) => n + r.warnings.length, 0);
  console.log(`${out}: the texts of ${results.filter((r) => r.platform !== "(all)").length} platforms, each with its counts, what shows before "more" and copy buttons${warnings ? `; ${warnings} ⚠ marked` : ""}. Show it to the person.`);
}

const [command, ...rest] = process.argv.slice(2);
const [pos, opts] = parse(rest);
if (command === "platforms") cmdPlatforms(pos, opts);
else if (command === "styles") cmdStyles(opts);
else if (command === "read") await cmdRead(pos, opts);
else if (command === "check") cmdCheck(pos, opts);
else if (command === "overview") cmdOverview(pos, opts);
else fail(`${self()} platforms [platform…] | styles | read <video> <dir> | check <dir> | overview <dir>   (--json, --words <words.json>, --no-words, --out <file>, --brand <dir>)`);
