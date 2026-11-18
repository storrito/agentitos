// Where the captions go. Without the options for it (--x, --y, --max-width, --align, --font-size,
// --lines) the tool builds what the version before them built, byte for byte; with them the built
// file carries the area, the alignment, the size and the lines asked for, and its groups set in
// those lines at that size. And the styles: each builds in every frame, and what only some of
// them have (a box for every line, key words in another typeface, words that wait and fill, a
// caption whole in the key colour) is in their files alone. No request.
//
//   node --test tools/test.mjs
//
// "The version before" is the commit BEFORE, the last one that changed captions nobody placed
// on purpose, read from this repository's history into a temp folder and run on the same words
// (CAPTIONS_BEFORE names another commit). Without git or without that commit (the skill's
// folder alone, a shallow clone) that test is skipped. Whoever changes the captions nobody
// placed on purpose names the commit that did it here.
//
// The last test lays the built files out in a Chrome (CHROME, one on the PATH, puppeteer's or
// HyperFrames' own) and measures lines, sizes and boxes; it loads the styles' fonts from Google
// and is skipped without a Chrome or without the fonts.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { STYLES } from "./lib/styles.mjs";
import { groups, fold } from "./lib/group.mjs";
import { cues } from "./lib/srt.mjs";
import { measure } from "./lib/widths.mjs";
import { zones, zonesTool } from "./lib/zones.mjs";

// (ce60c3a, the last commit without the options, until 2026-11-18; since then the commit that
// changed hormozi, karaoke and wipe on purpose and keeps a word alone inside the frame)
const BEFORE = process.env.CAPTIONS_BEFORE || "f6c0639a9b279503f8f7575c615024d8eba2e679";
const TOOLS = path.dirname(fileURLToPath(import.meta.url)), REPO = path.dirname(path.dirname(TOOLS));
const TOOL = path.join(TOOLS, "captions.mjs");
const ZONES = zonesTool();
const noZones = !ZONES && "agentitos' platform-zones skill is not beside this one";
const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

// two sentences as a recognizer gives them: a comma, a pause after the first, a key word
const SAID = "Today I show you, how to plan your Instagram-Stories for the whole week. For that I use Storrito, it runs in the browser.";
function wordsOf(text, more = {}) {
  let t = 0.3;
  return text.split(" ").map((w, i) => {
    const start = +t.toFixed(2), end = +(start + 0.08 + w.length * 0.03).toFixed(2);
    t = end + (/[.!?]$/.test(w) ? 0.5 : 0.02);
    return { text: w, start, end, ...(w === "Storrito," ? { highlight: true } : {}), ...more[i] };
  });
}
const WORDS = wordsOf(SAID);
// the same with a card: "the whole week" in a box, an emoji in front
const BOXED = wordsOf(SAID, { 10: { box: 1, icon: "📅" }, 11: { box: 1 }, 12: { box: 1 } });
// the sentences a review of the first version failed on (2026-11-17)
const NARROW = "For that I use Storrito, which runs in the browser and needs no app.";
const ONE_LINE = "Umfragen, Links, Countdowns und Erwähnungen funktionieren wie in der App selbst.";
const BIG_BOX = "That is straightforward, and it works automatically.";

function folder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "captions-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
// runs a captions tool in `dir`, on its words.json; the paths it prints are relative to it
function run(tool, dir, args, words = WORDS) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "words.json"), JSON.stringify({ words }));
  return spawnSync(process.execPath, [tool, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, PLATFORM_ZONES: ZONES } });
}
// what a build wrote: the .cap-group rule as { property: value }, the data of its script, what it printed
function built(t, opts, words = WORDS) {
  const dir = folder(t), r = run(TOOL, dir, ["build", "words.json", "out/captions", ...opts], words);
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, "out", "captions", "index.html"), "utf8");
  const rule = Object.fromEntries(html.match(/#root \.cap-group \{([^}]*)\}/)[1].split(";").map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(":")), d.slice(d.indexOf(":") + 1).trim()]));
  return { html, rule, data: JSON.parse(html.match(/var DATA = (.*);\n/)[1]), said: r.stdout };
}
const texts = (data) => data.groups.map((g) => g.words.map((w) => w.text).join(" "));
// how many lines of `room` (in the type's size) words take in a style's own type, filled as a
// browser fills them; Infinity when a word is wider than a line
function linesOf(text, style, room) {
  const m = measure(STYLES[style].look);
  let lines = 1, used = 0;
  for (const w of text.split(" ").map(m.word)) {
    if (w > room) return Infinity;
    if (used && used + m.space + w > room) { lines++; used = w; } else used += (used ? m.space : 0) + w;
  }
  return lines;
}
const video = (file, size) => assert.equal(spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=gray:s=${size}:r=30:d=9`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", file]).status, 0);

// the tools of the version before the options, in `dir`; null when the history is not there
function versionBefore(dir) {
  const git = (...args) => spawnSync("git", ["-C", REPO, ...args], { maxBuffer: 1 << 26 });
  const list = git("ls-tree", "-r", "--name-only", "--full-tree", BEFORE, "captions/tools");
  if (list.status !== 0) return null;
  for (const file of list.stdout.toString().split("\n").filter(Boolean)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), git("show", `${BEFORE}:${file}`).stdout);
  }
  return path.join(dir, "captions", "tools", "captions.mjs");
}

test("without the options the built files and what the tool says are those of the version before", { skip: noZones }, (t) => {
  const dir = folder(t), old = versionBefore(path.join(dir, "before"));
  if (!old) return t.skip(`no commit ${BEFORE} in a git history here`);
  // `put` lays what the run needs beside its words (a brand kit, a video) into both folders
  const same = (name, args, files, { words, put } = {}) => {
    for (const side of ["a", "b"]) { fs.mkdirSync(path.join(dir, side, name), { recursive: true }); put?.(path.join(dir, side, name)); }
    const a = run(old, path.join(dir, "a", name), args, words), b = run(TOOL, path.join(dir, "b", name), args, words);
    assert.equal(a.status, 0, a.stderr); assert.equal(b.status, 0, b.stderr);
    assert.equal(b.stdout, a.stdout, `${name}: what the tool says`);
    for (const f of files) assert.ok(fs.readFileSync(path.join(dir, "b", name, f)).equals(fs.readFileSync(path.join(dir, "a", name, f))), `${name}: ${f} differs from the version before`);
  };
  // 9:16, 16:9, 1:1, 4:5 and a small 9:16, in every style
  for (const style of Object.keys(STYLES)) for (const size of ["1080x1920", "1920x1080", "1080x1080", "1080x1350", "720x1280"]) {
    same(`${style}-${size}`, ["build", "words.json", "out/captions", "--style", style, "--size", size], ["out/captions/index.html"]);
  }
  same("one-platform", ["build", "words.json", "out/captions", "--style", "karaoke", "--size", "1080x1920", "--platform", "reels", "--duration", "9", "--track", "4"], ["out/captions/index.html"]);
  same("cards", ["build", "words.json", "out/captions", "--style", "wipe", "--size", "1080x1920"], ["out/captions/index.html"], { words: BOXED });
  // a brand kit: its colour and a font Google serves, and one whose font is a file beside it
  const kit = (fonts, files = {}) => (to) => {
    fs.mkdirSync(path.join(to, "brand", "fonts"), { recursive: true });
    fs.writeFileSync(path.join(to, "brand", "DESIGN.md"), `---\nname: Test Brand\ncolors:\n  primary: "#5429CA"\ntypography:\n  headline-display:\n    fontFamily: "Brand Sans"\n    fontWeight: 800\nfonts:\n${fonts}\n---\n# Test Brand\n`);
    for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(to, "brand", name), bytes);
  };
  same("brand-served", ["build", "words.json", "out/captions", "--style", "karaoke", "--size", "1080x1920", "--brand", "brand/DESIGN.md"], ["out/captions/index.html"], { put: kit("  Brand Sans: google") });
  same("brand-file", ["build", "words.json", "out/captions", "--style", "hormozi", "--size", "1080x1350", "--brand", "brand/DESIGN.md"], ["out/captions/index.html", "out/captions/fonts/brand-sans-800.ttf"],
    { put: kit("  Brand Sans:\n    - file: fonts/brand-sans-800.ttf\n      weight: 800", { "fonts/brand-sans-800.ttf": "not a font, only copied" }) });
  same("no-brand", ["build", "words.json", "out/captions", "--style", "clean", "--size", "1080x1920", "--brand", "brand/DESIGN.md"], ["out/captions/index.html"]);
  if (!ffmpeg) return t.diagnostic("no ffmpeg: `project` not compared");
  // a project: the video's own frame, a wide video filling and fitting a vertical frame
  const project = ["comp/index.html", "comp/captions/index.html", "comp/meta.json", "comp/hyperframes.json"];
  same("project", ["project", "video.mp4", "words.json", "comp", "--style", "clean"], project, { put: (to) => video(path.join(to, "video.mp4"), "360x640") });
  same("project-cover", ["project", "video.mp4", "words.json", "comp", "--style", "wipe", "--size", "1080x1920"], project, { put: (to) => video(path.join(to, "video.mp4"), "640x360") });
  same("project-contain", ["project", "video.mp4", "words.json", "comp", "--size", "1080x1920", "--fit", "contain", "--platform", "tiktok"], project, { put: (to) => video(path.join(to, "video.mp4"), "640x360") });
});

test("an area, an alignment, a size and a line count that are asked for are in the built file", { skip: noZones }, (t) => {
  // a wide frame, the speaker a panel on the left: left-aligned in the free area on the right
  const wide = built(t, ["--style", "hormozi", "--size", "1920x1080", "--x", "704", "--y", "930", "--max-width", "1120", "--align", "left", "--font-size", "80", "--lines", "1"]);
  assert.deepEqual([wide.rule.left, wide.rule.right, wide.rule.bottom, wide.rule.width], ["704px", "96px", "150px", "1120px"]);
  assert.equal(wide.rule["text-align"], "left");
  assert.equal(wide.rule.margin, "0 auto 0 0");             // a box as wide as its text stands at the left too
  assert.equal(wide.rule["transform-origin"], "0% 50%");    // and a group pops in from there
  assert.match(wide.html, /el\.style\.width = Math\.ceil\(to - from\)/);   // a box around two lines ends with its longest line
  assert.deepEqual([wide.data.size, wide.data.lines, wide.data.maxWidth], [80, 1, 1120]);
  assert.match(wide.said, /the lowest line ends at y 930, left-aligned in x 704–1824 \(at most 1120 px wide\), one line of 80 px type\./);
  for (const script of wide.html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);

  // a close selfie: one line on the wall above the head, centred on the frame
  const tall = built(t, ["--style", "clean", "--size", "1080x1920", "--y", "440", "--max-width", "696", "--font-size", "60", "--lines", "1"]);
  assert.deepEqual([tall.rule.left, tall.rule.right, tall.rule.bottom, tall.rule.width], ["192px", "192px", "1480px", "696px"]);
  assert.deepEqual([tall.rule["text-align"], tall.rule.margin, tall.rule["transform-origin"]], ["center", "0 auto", undefined]);
  assert.deepEqual([tall.data.size, tall.data.lines], [60, 1]);
  assert.doesNotMatch(tall.html, /el\.style\.width/);        // centred, a box stays as wide as it was
  for (const script of tall.html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);

  const right = built(t, ["--style", "karaoke", "--size", "1080x1080", "--x", "100", "--max-width", "600", "--align", "right"]);
  assert.deepEqual([right.rule.left, right.rule.right, right.rule.width, right.rule["text-align"], right.rule.margin, right.rule["transform-origin"]], ["100px", "380px", "600px", "right", "0 0 0 auto", "100% 50%"]);

  // `project` takes them as `build` does
  if (!ffmpeg) return t.diagnostic("no ffmpeg: `project` not built");
  const dir = folder(t);
  video(path.join(dir, "video.mp4"), "360x640");
  const r = run(TOOL, dir, ["project", "video.mp4", "words.json", "comp", "--size", "1080x1920", "--y", "440", "--align", "left", "--lines", "1"]);
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, "comp", "captions", "index.html"), "utf8");
  assert.match(html, /#root \.cap-group \{[^}]*bottom: 1480px;[^}]*text-align: left;/);
  assert.match(html, /"lines":1,/);
});

test("what is not asked for stays where platform-zones puts it, in the style's size, lines and groups", { skip: noZones }, (t) => {
  const [cx, cy, cw, ch] = zones(1080, 1920).centred;
  const plain = built(t, ["--style", "wipe", "--size", "1080x1920"]);
  assert.deepEqual([plain.rule.left, plain.rule.right, plain.rule.bottom, plain.rule.width], [`${cx}px`, `${1080 - cx - cw}px`, `${1920 - cy - ch}px`, `${cw}px`]);
  const only = (...opts) => built(t, ["--style", "wipe", "--size", "1080x1920", ...opts]);
  const but = (b, changed) => { for (const k of Object.keys(plain.rule)) if (!changed.includes(k)) assert.equal(b.rule[k], plain.rule[k], k); };

  const up = only("--y", "500");
  assert.equal(up.rule.bottom, "1420px"); but(up, ["bottom"]);
  assert.deepEqual([up.data.size, up.data.lines], [plain.data.size, plain.data.lines]);
  assert.deepEqual(up.data.groups, plain.data.groups);       // moved, not grouped anew

  const narrow = only("--max-width", "500");                 // a width alone: centred on the frame
  assert.deepEqual([narrow.rule.left, narrow.rule.right, narrow.rule.width], ["290px", "290px", "500px"]); but(narrow, ["left", "right", "width"]);

  const from = only("--x", "300");                           // a left edge alone: up to the centred box's right edge
  assert.deepEqual([from.rule.left, from.rule.right, from.rule.width], ["300px", `${1080 - cx - cw}px`, `${cx + cw - 300}px`]); but(from, ["left", "right", "width"]);

  const big = only("--font-size", "120");
  assert.equal(big.data.size, 120); assert.equal(big.data.lines, plain.data.lines); but(big, []);
  const one = only("--lines", "1");
  assert.equal(one.data.lines, 1); assert.equal(one.data.size, plain.data.size); but(one, []);
  const left = only("--align", "left");
  but(left, ["margin", "text-align", "transform-origin"]); assert.deepEqual(left.data.groups, plain.data.groups);
  // the width and the lines the styles are made for, said aloud, change no group either
  assert.deepEqual(only("--max-width", String(cw), "--lines", "2", "--y", "500", "--align", "right").data.groups, plain.data.groups);
});

test("in a width, in lines or at a size of the caller's own the groups set in their lines at the type's size, every word once and in order", { skip: noZones }, (t) => {
  for (const style of Object.keys(STYLES)) {
    const one = built(t, ["--style", style, "--size", "1080x1920", "--y", "440", "--max-width", "696", "--font-size", "60", "--lines", "1"]);
    assert.equal(texts(one.data).join(" "), SAID, style);
    // (the padding of a style's box is no room for a word)
    const room = (696 - (STYLES[style].look.box ? 60 : 0)) / 60;
    for (const text of texts(one.data)) assert.ok(!text.includes(" ") || linesOf(text, style, room) === 1, `${style}: "${text}" does not set in one line of 60 px type`);
    one.data.groups.forEach((g, i) => { if (i) assert.ok(g.start >= one.data.groups[i - 1].end, `${style}: one group at a time`); });
  }
  // type that is larger than the style's takes its stroke along
  const big = built(t, ["--style", "hormozi", "--size", "1080x1920", "--font-size", "192"]);
  assert.match(big.html, /-webkit-text-stroke: 18px/);
});

test("a phrase whose groups do not set in their lines is cut by length: the fewest groups that do, about equally long, a wide word alone", () => {
  const phrase = (text) => text.split(" ").map((w, i) => ({ text: w, start: i * 0.3, end: i * 0.3 + 0.25 }));
  // a line of `room` characters, a space one wide
  const cut = (text, words, chars, lines, room) => { const ws = phrase(text); return groups(ws, { words, chars, pause: 0.45, min: 1, ...(room ? { fit: { lines, room, space: 1, word: (t) => t.length } } : {}) }, 60).map((g) => ws.slice(g.from, g.to + 1).map((w) => w.text).join(" ")); };
  const said = "wie ihr eure Instagram-Storys für die ganze Woche vorplant.";
  assert.deepEqual(cut(said, 9, 64, 1, 19), ["wie ihr eure", "Instagram-Storys", "für die ganze", "Woche vorplant."]);
  assert.deepEqual(cut(said, 9, 64), [said]);                                    // the style alone: one group
  assert.deepEqual(cut(said, 9, 64, 2, 30), [said]);                             // two lines of 30 hold it: the style's group stays
  assert.deepEqual(cut(said, 9, 64, 2, 19), ["wie ihr eure Instagram-Storys", "für die ganze Woche vorplant."]);
  // two lines are two lines, not one of twice the length: "the browser and" is 15 characters, but no two lines of 9
  assert.deepEqual(cut("the browser and needs no app.", 3, 22, 2, 9), ["the browser", "and needs", "no app."]);
  assert.deepEqual(cut("a Donaudampfschifffahrtsgesellschaft b", 9, 64, 1, 12), ["a", "Donaudampfschifffahrtsgesellschaft", "b"]);
  assert.deepEqual(cut("one two three four five six", 2, 64, 1, 10), ["one two", "three four", "five six"]);
});

test("review 1: a narrow area holds every group in two lines, line by line, and a named size holds", { skip: noZones }, (t) => {
  const narrow = built(t, ["--style", "hormozi", "--size", "1080x1920", "--max-width", "420"], wordsOf(NARROW));
  assert.deepEqual(texts(narrow.data), ["For that", "I use", "Storrito,", "which runs", "in the", "browser", "and needs", "no app."]);
  for (const text of texts(narrow.data)) assert.ok(!text.includes(" ") || linesOf(text, "hormozi", 420 / 96) <= 2, `"${text}" takes more than two lines of 420 px at 96 px`);
  assert.match(narrow.said, /\n {2}Wider than a line of this area at 96 px, so each stands alone, set smaller \(or broken at its hyphen\): "Storrito,", "browser"\.\n/);
  const named = built(t, ["--style", "hormozi", "--size", "1080x1920", "--max-width", "420", "--font-size", "110"], wordsOf(NARROW));
  assert.deepEqual(texts(named.data), ["For that", "I use", "Storrito,", "which", "runs", "in the", "browser", "and needs", "no app."]);
  for (const text of texts(named.data)) assert.ok(!text.includes(" ") || linesOf(text, "hormozi", 420 / 110) <= 2, `"${text}" takes more than two lines of 420 px at 110 px`);
  assert.match(named.said, /at 110 px, so each stands alone, set smaller \(or broken at its hyphen\): "Storrito,", "which", "browser"\./);
});

test("review 2: without a named size the groups set at the style's size, not at the least it shrinks to; a card stays whole and the tool says so", { skip: noZones }, (t) => {
  const cw = zones(1080, 1920).centred[2];
  const one = built(t, ["--style", "clean", "--size", "1080x1920", "--lines", "1"], wordsOf(ONE_LINE));
  assert.deepEqual(texts(one.data), ["Umfragen, Links,", "Countdowns und", "Erwähnungen", "funktionieren wie", "in der App selbst."]);
  assert.equal(one.data.size, 52);
  for (const text of texts(one.data)) assert.equal(linesOf(text, "clean", (cw - 52) / 52), 1, `"${text}" at 52 px`);
  assert.doesNotMatch(one.said, /card|Wider than/);
  const card = built(t, ["--style", "hormozi", "--size", "1080x1920", "--lines", "1"], BOXED);
  assert.deepEqual(card.data.groups.filter((g) => g.box).map((g) => g.words.map((w) => w.text).join(" ")), ["the whole week."]);
  assert.match(card.said, /\n {2}A card keeps its words together whatever the area \(1 here\): it shrinks to the lines asked for and takes another line where it cannot\.\n/);
  assert.doesNotMatch(built(t, ["--style", "hormozi", "--size", "1080x1920", "--y", "500"], BOXED).said, /A card/);   // only moved: cards as ever
});

test("review 3: the area holds a style's box whole, and the warning judges the box", { skip: noZones }, (t) => {
  const opts = ["--style", "clean", "--size", "1920x1080", "--x", "1000", "--max-width", "824", "--font-size", "110"];
  const left = built(t, [...opts, "--align", "left"], wordsOf(BIG_BOX));
  // the box counts with its padding, whatever the host sets, and the padding is no room for a word
  assert.match(left.html, /#root \.cap-group\.boxed \{ box-sizing: border-box; width: fit-content; max-width: 824px;/);
  assert.match(left.html, /if \(el\.classList\.contains\("cap-card"\) \|\| el\.classList\.contains\("boxed"\)\) \{/);
  assert.deepEqual(texts(left.data), ["That is", "straightforward,", "and it works", "automatically."]);
  assert.match(left.said, /\nThat is inside the safe box of /);
  assert.match(left.said, /hyphen\): "straightforward,", "automatically\."\./);
  // captions nobody placed keep the box they had
  assert.match(built(t, ["--style", "clean", "--size", "1920x1080"], wordsOf(BIG_BOX)).html, /#root \.cap-group\.boxed \{ width: fit-content;[^}]*\}\n[\s\S]*if \(el\.classList\.contains\("cap-card"\)\) \{/);
  // the letters of one line end inside the safe box, the box around them does not
  const safeTop = zones(1920, 1080).safe[1], y = safeTop + Math.round(110 * 1.3) + 10, top = Math.round(y - 110 * 1.3 - 0.44 * 110);
  const high = built(t, [...opts, "--lines", "1", "--y", String(y)], wordsOf(BIG_BOX));
  assert.match(high.said, new RegExp(`\\n! That leaves the safe box of .*: ${safeTop - top} px past the top, `));
});

test("review 4: an area that passes the frame is said in the same sentence", { skip: noZones }, (t) => {
  const off = built(t, ["--style", "hormozi", "--size", "1080x1920", "--x", "900", "--max-width", "400", "--align", "right"], wordsOf(NARROW));
  const warned = off.said.split("\n").filter((l) => l.startsWith("! "));
  assert.equal(warned.length, 1);
  assert.match(warned[0], /^! That leaves the frame \(220 px past its right edge: not in the video\) and the safe box of .*: \d+ px past the right, where the apps lay .* over the captions\.$/);
});

test("an area that leaves the platforms' safe box is said in one sentence, and built all the same", { skip: noZones }, (t) => {
  const z = zones(1080, 1920), under = z.safe[1] + z.safe[3] + 100;
  const low = built(t, ["--size", "1080x1920", "--y", String(under)]);
  const warned = low.said.split("\n").filter((l) => l.startsWith("! "));
  assert.equal(warned.length, 1);
  assert.match(warned[0], /^! That leaves the safe box of .*: 100 px past the bottom, where the apps lay .* over the captions\.$/);
  assert.equal(low.rule.bottom, `${1920 - under}px`);
  const clear = built(t, ["--size", "1080x1920", "--y", "440", "--lines", "1"]);
  assert.match(clear.said, /\nThat is inside the safe box of /);
  assert.doesNotMatch(clear.said, /^! /m);
  // nothing placed: nothing new is said
  assert.doesNotMatch(built(t, ["--size", "1080x1920"]).said, /Placed where asked|safe box of/);
});

test("an option that cannot be meant is one sentence that says what it takes", { skip: noZones }, (t) => {
  const dir = folder(t);
  const refused = (opts, sentence) => {
    const r = run(TOOL, dir, ["build", "words.json", "out/captions", "--size", "1080x1920", ...opts]);
    assert.equal(r.status, 1, opts.join(" "));
    assert.match(r.stderr.trim(), sentence);
    assert.equal(r.stderr.trim().split("\n").length, 1);
  };
  refused(["--lines", "3"], /^--lines is 1 or 2\.$/);
  refused(["--align", "middle"], /^--align is left, centre or right\.$/);
  refused(["--font-size", "big"], /^--font-size is a number of px from 1 to 1920/);
  refused(["--y", "2000"], /^--y is a number of px from 1 to 1920/);
  refused(["--x"], /^--x is a number of px from 0 to 1079/);
  refused(["--x", "1000"], /--x 1000 leaves no room .* give --max-width as well\.$/);
  // review 5: an empty value (a shell variable that is not set) is no 0, nor is 0x10 sixteen
  refused(["--x", ""], /^--x is a number of px from 0 to 1079/);
  refused(["--y", ""], /^--y is a number of px from 1 to 1920/);
  refused(["--max-width", "", "--x", "100"], /^--max-width is a number of px from 1 to 1080/);
  refused(["--font-size", "0x10"], /^--font-size is a number of px/);
  refused(["--lines", ""], /^--lines is 1 or 2\.$/);
  assert.equal(fs.existsSync(path.join(dir, "out")), false);
});

// ---- words that are no words, and words longer than a line ---------------------------------------

test("a mark alone is no caption: it joins the word said beside it, or is left out; the subtitle file has the same words", () => {
  const w = (text, start, end) => ({ text, start, end }), texts = (ws) => fold(ws).map((x) => x.text);
  assert.deepEqual(texts([w("Well", 0, 0.3), w("…", 0.35, 0.4), w("so", 0.9, 1.1)]), ["Well…", "so"]);
  assert.deepEqual(texts([w("Hello.", 0, 0.3), w("…", 2, 2.8), w("So", 4, 4.2)]), ["Hello.", "So"]);               // a pause's "…": no word near it
  assert.deepEqual(texts([w("das.", 0, 0.3), w("…", 0.8, 0.9), w("Und", 1.4, 1.6)]), ["das.", "Und"]);               // nor after a sentence's end
  assert.deepEqual(texts([w("Tom", 0, 0.3), w("&", 0.32, 0.4), w("Jerry", 0.42, 0.8)]), ["Tom &", "Jerry"]);
  assert.deepEqual(texts([w("„", 0, 0.02), w("Hallo", 0.03, 0.3), w("“", 0.31, 0.33), w("sagt", 0.4, 0.6), w("er", 0.61, 0.7), w("–", 0.72, 0.75), w("leise.", 0.8, 1.1)]), ["„Hallo“", "sagt", "er –", "leise."]);
  // the times are the words': a joined mark moves none
  assert.deepEqual(fold([w("Well", 0, 0.3), w("…", 0.35, 0.4)]).map((x) => [x.start, x.end]), [[0, 0.3]]);
  const plain = [w("a", 0, 1), w("b", 1, 2)];
  assert.equal(fold(plain), plain);   // nothing to join: the very words
  // in the pictures no group is a mark, in the subtitle file no cue; a soft hyphen is for the picture alone
  const said = [w("Hello.", 0, 0.3), w("…", 2, 2.8), w("Verwaltungs\u00ADwissenschaft", 4, 5), w("zählt.", 5.05, 5.4)];
  for (const s of Object.values(STYLES)) for (const g of groups(fold(said), s.group, 60)) assert.match(fold(said).slice(g.from, g.to + 1).map((x) => x.text).join(" "), /\p{L}/u);
  assert.deepEqual(cues(said).map((c) => c.text), ["Hello.", "Verwaltungswissenschaft zählt."]);
});

// ---- the styles ---------------------------------------------------------------------------------

test("every style builds in every frame, every word once and in order; what only some styles have is only in their files", { skip: noZones }, (t) => {
  const has = { lineBox: /#root \.cap-box \{/, keyFont: /#root \.cap-word\.key \{/, fill: /M\.active === "fill"/ };
  for (const [name, s] of Object.entries(STYLES)) for (const size of ["1080x1920", "1920x1080", "1080x1080"]) {
    const b = built(t, ["--style", name, "--size", size]), at = `${name} ${size}`;
    assert.equal(texts(b.data).join(" "), SAID, at);
    b.data.groups.forEach((g, i) => { if (i) assert.ok(g.start >= b.data.groups[i - 1].end, `${at}: one group at a time`); });
    for (const g of b.data.groups) assert.ok(g.words.length <= s.group.words, `${at}: "${g.words.map((w) => w.text).join(" ")}" has more words than the style's ${s.group.words}`);
    assert.equal(has.lineBox.test(b.html), !!s.look.lineBox, `${at}: a box for every line`);
    assert.equal(has.keyFont.test(b.html), !!s.look.keyFont, `${at}: key words in another typeface`);
    assert.equal(has.fill.test(b.html), s.motion.active === "fill", `${at}: words that wait and fill`);
    // a style whose words wait says in which colour, one whose lines have a box how far it reaches
    if (s.motion.active === "fill") assert.ok(s.look.wait, `${name}: no look.wait`);
    if (s.look.lineBox) assert.ok(Array.isArray(s.look.linePad) && s.look.linePad.length === 2, `${name}: no look.linePad [above and below, left and right]`);
  }
});

test("the styles of up to five words cut a phrase by length: no word alone where a pair holds; the two that set whole phrases keep equal counts", () => {
  const ws = wordsOf("Wir haben letzte Woche vierundzwanzig Stories gepostet und damit dreitausendzweihundert Menschen erreicht.");
  const cut = (style) => groups(ws, STYLES[style].group, 60).map((g) => ws.slice(g.from, g.to + 1).map((w) => w.text).join(" "));
  assert.deepEqual(cut("bold"), ["Wir haben letzte", "Woche vierundzwanzig", "Stories gepostet", "und damit", "dreitausendzweihundert", "Menschen erreicht."]);
  assert.deepEqual(cut("label"), ["Wir haben letzte Woche", "vierundzwanzig Stories", "gepostet und damit", "dreitausendzweihundert", "Menschen erreicht."]);
  // (by equal counts hormozi had "Wir haben | letzte | Woche vierundzwanzig")
  assert.deepEqual(cut("hormozi"), ["Wir haben letzte", "Woche vierundzwanzig", "Stories gepostet", "und damit", "dreitausendzweihundert", "Menschen erreicht."]);
  assert.deepEqual(cut("clean"), ["Wir haben letzte Woche vierundzwanzig Stories", "gepostet und damit dreitausendzweihundert Menschen erreicht."]);
  // every style of two to five words says so, and never passes its words or characters for it
  for (const [name, s] of Object.entries(STYLES)) {
    assert.equal(!!s.group.even, s.group.words > 1 && s.group.words <= 5, name);
    if (!s.group.even) continue;
    for (const text of cut(name)) assert.ok(text.split(" ").length <= s.group.words && (text.length <= s.group.chars || !text.includes(" ")), `${name}: "${text}"`);
    assert.equal(cut(name).join(" "), ws.map((w) => w.text).join(" "), name);
  }
});

test("impact: a caption that holds a key word stands whole in the key colour, with a brand kit in the brand's", { skip: noZones }, (t) => {
  const b = built(t, ["--style", "impact", "--size", "1080x1920"]);
  const whole = b.data.groups.filter((g) => g.words.every((w) => w.key)).map((g) => g.words.map((w) => w.text).join(" "));
  assert.equal(whole.length, 1);
  assert.match(whole[0], /Storrito,/);
  for (const g of b.data.groups) assert.ok(g.words.every((w) => w.key) || !g.words.some((w) => w.key), `"${g.words.map((w) => w.text).join(" ")}" is half in colour`);
  // the other styles colour the key word alone
  assert.deepEqual(built(t, ["--style", "bold", "--size", "1080x1920"]).data.groups.flatMap((g) => g.words.filter((w) => w.key).map((w) => w.text)), ["Storrito,"]);
  const look = branded(t, "impact", "#FF5A1F").look;
  assert.equal(look.highlight, "#FF5A1F");
  assert.equal(look.font, "League Gothic");   // the style is its typeface: the brand's font stays out
});

// a build with a brand kit of one colour and a font Google serves: the look in the built file, what the tool said
function branded(t, style, primary, family = "Brand Sans", words = WORDS) {
  const dir = folder(t);
  fs.mkdirSync(path.join(dir, "brand"), { recursive: true });
  fs.writeFileSync(path.join(dir, "brand", "DESIGN.md"), `---\nname: Test Brand\ncolors:\n  primary: "${primary}"\ntypography:\n  headline-display:\n    fontFamily: "${family}"\n    fontWeight: 800\nfonts:\n  ${family}: google\n---\n# Test Brand\n`);
  const r = run(TOOL, dir, ["build", "words.json", "out/captions", "--style", style, "--size", "1080x1920", "--brand", "brand/DESIGN.md"], words);
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, "out", "captions", "index.html"), "utf8"), data = JSON.parse(html.match(/var DATA = (.*);\n/)[1]);
  return { look: data.look, said: r.stdout, html, data };
}

test("a brand's colour goes where the style shows one: the word being said, the key words, or both; key words that would not be read keep the style's", { skip: noZones }, (t) => {
  for (const [name, s] of Object.entries(STYLES)) {
    const takes = s.look.brand || "accent", b = branded(t, name, "#FF5A1F");
    assert.equal(b.look.accent, takes === "key" ? s.look.accent : "#FF5A1F", `${name}: the accent`);
    assert.equal(b.look.highlight, takes === "accent" ? s.look.highlight : "#FF5A1F", `${name}: the key words`);
    assert.equal(b.look.font, s.look.ownFont ? s.look.font : "Brand Sans", `${name}: the font`);
    assert.match(b.said, new RegExp(`, ${{ key: "key words", both: "accent and key words" }[takes] || "accent"} #FF5A1F`), name);
  }
  // a dark blue is not read on a picture: the key words stay the style's, and the tool says so in a line
  const dark = branded(t, "bold", "#1E3A8A");
  assert.equal(dark.look.highlight, STYLES.bold.look.highlight);
  assert.match(dark.said, /\n {2}\(the brand's #1E3A8A would not be read on a picture: the key words keep the style's #FFE500\)\n/);
  assert.doesNotMatch(dark.said, /key words #1E3A8A/);
  // on the white box of a line it is, and a yellow is not
  assert.equal(branded(t, "label", "#1E3A8A").look.highlight, "#1E3A8A");
  const yellow = branded(t, "label", "#FFE500");
  assert.equal(yellow.look.highlight, STYLES.label.look.highlight);
  assert.match(yellow.said, /would not be read on the box of its line/);
  // fill's key words keep the colour on the picture: weighed too, and then the word being said keeps the style's as well
  const filled = branded(t, "fill", "#1E3A8A");
  assert.deepEqual([filled.look.accent, filled.look.highlight], [STYLES.fill.look.accent, STYLES.fill.look.highlight]);
  assert.match(filled.said, /\n {2}\(the brand's #1E3A8A would not be read on a picture: the word being said and the key words keep the style's #FFE500\)\n/);
  // a colour as rgb() is weighed like a hex one, one that is neither is left out
  assert.equal(branded(t, "bold", "rgb(255, 90, 31)").look.highlight, "rgb(255, 90, 31)");
  assert.equal(branded(t, "bold", "rgb(30, 58, 138)").look.highlight, STYLES.bold.look.highlight);
  assert.match(branded(t, "bold", "1E3A8A").said, /\(the brand's 1E3A8A is no hex or rgb\(\) colour to weigh: the key words keep the style's #FFE500\)/);
  // where only the word being said takes it, nothing is weighed: as in the styles before
  assert.equal(branded(t, "hormozi", "#1E3A8A").look.accent, "#1E3A8A");
});

test("single: one word a caption, each on screen until the next is said", { skip: noZones }, (t) => {
  const b = built(t, ["--style", "single", "--size", "1080x1920"]);
  assert.equal(b.data.groups.length, WORDS.length);
  b.data.groups.forEach((g, i) => {
    assert.equal(g.words.length, 1);
    const next = b.data.groups[i + 1];
    // inside a sentence a word ends in the moment the next one starts: no frame without a word between them
    if (next && next.start - g.words[0].said < 0.3) assert.equal(g.end, next.start, `"${g.words[0].text}" ends ${(next.start - g.end).toFixed(3)} s before "${next.words[0].text}" starts`);
  });
});

test("label: a line's box is no room for a word, and the area asked for holds the boxes", { skip: noZones }, (t) => {
  const look = STYLES.label.look, b = built(t, ["--style", "label", "--size", "1080x1920", "--x", "80", "--y", "1500", "--max-width", "620", "--align", "left"]);
  assert.equal(texts(b.data).join(" "), SAID);
  const room = (620 - 2 * look.linePad[1] * look.size) / look.size;
  for (const text of texts(b.data)) assert.ok(!text.includes(" ") || linesOf(text, "label", room) <= 2, `"${text}" takes more than two lines of ${room.toFixed(2)} em`);
  assert.match(b.said, /Placed where asked: the lowest line ends at y 1500, left-aligned in x 80–700 \(at most 620 px wide\)/);
  assert.match(b.html, new RegExp(`#root \\.cap-group\\.lined \\{ box-sizing: border-box; padding: 0 ${look.linePad[1]}em; margin-bottom: ${look.linePad[0]}em; \\}`));
});

// ---- in a browser -------------------------------------------------------------------------------

// The machine's Chrome: CHROME, else the usual names on the PATH, else one puppeteer or
// HyperFrames downloaded (as platform-zones finds its own).
function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const dir of (process.env.PATH || "").split(path.delimiter)) for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]) if (fs.existsSync(path.join(dir, name))) return path.join(dir, name);
  for (const base of [path.join(os.homedir(), ".cache", "puppeteer", "chrome-headless-shell"), path.join(os.homedir(), ".cache", "hyperframes", "chrome", "chrome-headless-shell"), path.join(os.homedir(), ".cache", "puppeteer", "chrome")]) {
    for (const v of fs.existsSync(base) ? fs.readdirSync(base).sort().reverse() : []) {
      for (const p of [path.join(base, v, "chrome-headless-shell-linux64", "chrome-headless-shell"), path.join(base, v, "chrome-linux64", "chrome")]) if (fs.existsSync(p)) return p;
    }
  }
  return null;
}
const CHROME = chromePath();

// A built captions file laid out in Chrome: its template in a frame, gsap as a stub, in a host
// that sets `box-sizing: border-box` on everything (as `project` writes one) or sets nothing.
// The style's font is loaded before the captions' own script fits the groups (else they would be
// fitted in a stand-in font). Per group: { text, size, lines, box: [left, top, right, bottom] in
// px of the frame, words: [left, right] of its words, lineBoxes: the box of each line as `box`
// when the style has them }; null when Chrome gave nothing, "no font" when the font did not come.
function laidOut(t, html, borderBox) {
  const template = html.match(/<template>([\s\S]*)<\/template>/)[1], [, w, h] = template.match(/data-width="(\d+)" data-height="(\d+)"/);
  const [, family, weight] = template.match(/font-family: "([^"]+)", sans-serif; font-weight: (\d+);/);
  const page = `<!doctype html><html><head><meta charset="utf-8">${[...html.matchAll(/<link [^>]*>/g)].map((m) => m[0]).join("")}
<style>${borderBox ? "* { margin: 0; padding: 0; box-sizing: border-box; }" : "html, body { margin: 0; }"} #frame { position: relative; width: ${w}px; height: ${h}px; overflow: hidden; }</style>
<script>window.__timelines = {}; var tl = { set: function () { return tl; }, to: function () { return tl; }, fromTo: function () { return tl; } }; window.gsap = { timeline: function () { return tl; } };</script>
</head><body><div id="frame"></div><pre id="out"></pre>
<script>
var font = '${weight} 100px "${family}"', out = document.getElementById("out"), frame = document.getElementById("frame");
function measured(n) {
  if (!window.__timelines.captions && n < 400) return setTimeout(function () { measured(n + 1); }, 25);
  var at = frame.getBoundingClientRect();
  out.textContent = encodeURIComponent(JSON.stringify(Array.prototype.map.call(document.querySelectorAll(".cap-group"), function (el) {
    var r = el.getBoundingClientRect(), size = parseFloat(getComputedStyle(el).fontSize);
    // the lines: words whose tops lie more than half the type's size apart (a key word in another typeface sits a little off its neighbours)
    var tops = Array.prototype.map.call(el.querySelectorAll(".cap-word"), function (c) { return c.getBoundingClientRect().top; }).sort(function (a, b) { return a - b; });
    var lines = tops.filter(function (y, i) { return !i || y - tops[i - 1] > size * 0.5; }).length;
    var laid = el.querySelectorAll(".cap-box"), reach = [Infinity, -Infinity];
    Array.prototype.forEach.call(el.querySelectorAll(".cap-word"), function (c) { var b = c.getBoundingClientRect(); reach = [Math.min(reach[0], Math.round(b.left - at.left)), Math.max(reach[1], Math.round(b.right - at.left))]; });
    return { text: el.textContent, size: size, lines: lines, words: reach, box: [r.left - at.left, r.top - at.top, r.right - at.left, r.bottom - at.top].map(Math.round),
      lineBoxes: laid.length ? Array.prototype.map.call(laid, function (c) { var b = c.getBoundingClientRect(); return [b.left - at.left, b.top - at.top, b.right - at.left, b.bottom - at.top].map(Math.round); }) : null };
  })));
}
function laid() {
  if (!document.fonts.check(font)) { out.textContent = encodeURIComponent(JSON.stringify("no font")); return; }
  frame.appendChild(document.createRange().createContextualFragment(${JSON.stringify(template).replace(/<\//g, "<\\/")}));
  measured(0);
}
document.fonts.load(font).then(laid, laid);
</script></body></html>`;
  const file = path.join(folder(t), "page.html");
  fs.writeFileSync(file, page);
  const r = spawnSync(CHROME, ["--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", `--window-size=${w},${h}`, "--virtual-time-budget=15000", "--dump-dom", pathToFileURL(file).href], { encoding: "utf8", timeout: 90e3, maxBuffer: 1 << 28 });
  const out = r.stdout?.match(/<pre id="out">([^<]+)<\/pre>/)?.[1];
  return out ? JSON.parse(decodeURIComponent(out)) : null;
}

test("in Chrome: the review's sentences stand in the lines and at the size asked for, every box inside its area", { skip: noZones || (!CHROME && "no Chrome on this machine (CHROME names one)") }, (t) => {
  const cases = [
    { words: NARROW, opts: ["--style", "hormozi", "--size", "1080x1920", "--max-width", "420"] },
    { words: NARROW, opts: ["--style", "hormozi", "--size", "1080x1920", "--max-width", "420", "--font-size", "110"] },
    { words: ONE_LINE, opts: ["--style", "clean", "--size", "1080x1920", "--lines", "1"] },
    { words: BIG_BOX, opts: ["--style", "clean", "--size", "1920x1080", "--x", "1000", "--max-width", "824", "--align", "left", "--font-size", "110"] },
    { words: BIG_BOX, opts: ["--style", "clean", "--size", "1920x1080", "--x", "1000", "--max-width", "824", "--align", "right", "--font-size", "110"] },
    { words: SAID, opts: ["--style", "karaoke", "--size", "1080x1350", "--max-width", "540", "--align", "left", "--font-size", "84"] },
    { words: SAID, opts: ["--style", "wipe", "--size", "1920x1080", "--x", "704", "--max-width", "1120", "--align", "left", "--font-size", "138"] },
  ];
  for (const c of cases) for (const borderBox of [false, true]) {
    const b = built(t, c.opts, wordsOf(c.words)), seen = laidOut(t, b.html, borderBox), name = `${c.opts.join(" ")}${borderBox ? ", a border-box host" : ""}`;
    if (!seen) return t.skip(`Chrome did not lay the page out (${name})`);
    if (seen === "no font") return t.skip(`the style's font did not load, no network? (${name})`);
    assert.equal(seen.length, b.data.groups.length, name);
    const left = b.data.left, right = b.data.left + b.data.maxWidth, height = Number(c.opts[c.opts.indexOf("--size") + 1].split("x")[1]);
    seen.forEach((g, i) => {
      const alone = b.data.groups[i].words.length === 1;
      assert.ok(g.lines <= b.data.lines || alone, `${name}: "${g.text}" stands in ${g.lines} lines`);
      if (!alone) assert.equal(g.size, b.data.size, `${name}: "${g.text}" is set at ${g.size} px`);
      assert.ok(g.box[0] >= Math.floor(left) - 1 && g.box[2] <= Math.ceil(right) + 1, `${name}: the box of "${g.text}" (x ${g.box[0]}–${g.box[2]}) leaves the area x ${left}–${right}`);
      assert.equal(g.box[3], height - b.data.bottom, `${name}: "${g.text}" ends at y ${g.box[3]}`);
    });
  }
});

test("in Chrome: the styles with a box for every line, key words in another typeface or one word at a time stand in their lines and inside their area", { skip: noZones || (!CHROME && "no Chrome on this machine (CHROME names one)") }, (t) => {
  const cases = [
    { words: SAID, opts: ["--style", "label", "--size", "1080x1920"] },
    { words: SAID, opts: ["--style", "label", "--size", "1080x1920", "--x", "80", "--y", "1500", "--max-width", "620", "--align", "left"] },
    { words: NARROW, opts: ["--style", "label", "--size", "1080x1920", "--max-width", "420"] },
    { words: SAID, opts: ["--style", "editorial", "--size", "1080x1920"] },
    { words: SAID, opts: ["--style", "impact", "--size", "1920x1080"] },
    { words: ONE_LINE, opts: ["--style", "single", "--size", "1080x1920"] },
    // a brand's font, of another height and width than the style's own: the boxes are the line's, not the font's
    { words: SAID, opts: ["--style", "label", "--size", "1080x1920"], brand: "Outfit" },
    { words: SAID, opts: ["--style", "label", "--size", "1080x1920"], brand: "Playfair Display" },
  ];
  for (const c of cases) {
    const b = c.brand ? branded(t, "label", "#1E3A8A", c.brand, wordsOf(c.words)) : built(t, c.opts, wordsOf(c.words)), seen = laidOut(t, b.html, true), name = `${c.opts.join(" ")}${c.brand ? `, the brand's ${c.brand}` : ""}`;
    if (!seen) return t.skip(`Chrome did not lay the page out (${name})`);
    if (seen === "no font") return t.skip(`the style's font did not load, no network? (${name})`);
    assert.equal(seen.length, b.data.groups.length, name);
    const left = b.data.left, right = b.data.left + b.data.maxWidth, height = Number(c.opts[c.opts.indexOf("--size") + 1].split("x")[1]), ends = height - b.data.bottom;
    seen.forEach((g, i) => {
      const alone = b.data.groups[i].words.length === 1;
      assert.ok(g.lines <= b.data.lines || alone, `${name}: "${g.text}" stands in ${g.lines} lines`);
      assert.ok(g.box[0] >= Math.floor(left) - 1 && g.box[2] <= Math.ceil(right) + 1, `${name}: "${g.text}" (x ${g.box[0]}–${g.box[2]}) leaves the area x ${left}–${right}`);
      if (!g.lineBoxes) return assert.equal(g.box[3], ends, `${name}: "${g.text}" ends at y ${g.box[3]}`);
      // a box for every line: as many as lines, each inside the area, the lowest ending where the lowest line is asked to
      assert.equal(g.lineBoxes.length, g.lines, `${name}: "${g.text}" has ${g.lineBoxes.length} boxes for ${g.lines} lines`);
      for (const [x0, , x1] of g.lineBoxes) assert.ok(x0 >= Math.floor(left) - 1 && x1 <= Math.ceil(right) + 1, `${name}: a line's box of "${g.text}" (x ${x0}–${x1}) leaves the area x ${left}–${right}`);
      const lowest = Math.max(...g.lineBoxes.map((r) => r[3]));
      assert.ok(Math.abs(lowest - ends) <= 1, `${name}: the lowest box of "${g.text}" ends at y ${lowest}, asked for ${ends}`);
      // every box as high as a line with its padding, whatever the font; two lines' boxes meet
      const look = STYLES.label.look, high = Math.round(g.size * (look.lineHeight + 2 * look.linePad[0])), tops = g.lineBoxes.map((r) => r[1]).sort((a, z) => a - z);
      for (const [, top, , bottom] of g.lineBoxes) assert.ok(Math.abs(bottom - top - high) <= 1, `${name}: a box of "${g.text}" is ${bottom - top} px high, a line with its padding ${high}`);
      tops.forEach((top, k) => { if (k) assert.ok(top <= tops[k - 1] + high, `${name}: the boxes of "${g.text}" leave a gap between two lines`); });
    });
  }
});

test("in Chrome: a word alone that is wider than its line is set as small as it takes and never passes its area; with a soft hyphen it breaks there and stays larger", { skip: noZones || (!CHROME && "no Chrome on this machine (CHROME names one)") }, (t) => {
  const long = "Verwaltungswissenschaftler*innen", soft = "Verwaltungs\u00ADwissenschaftler*innen";
  for (const style of ["hormozi", "wipe", "bold", "impact", "label"]) {
    const sizes = {};
    for (const [name, word] of [["whole", long], ["soft", soft]]) {
      const b = built(t, ["--style", style, "--size", "1080x1920"], wordsOf(`Viele ${word} sagen das.`)), seen = laidOut(t, b.html, true), at = `${style}, ${name}`;
      if (!seen) return t.skip(`Chrome did not lay the page out (${at})`);
      if (seen === "no font") return t.skip(`the style's font did not load, no network? (${at})`);
      const i = b.data.groups.findIndex((g) => g.words.some((w) => w.text === word)), g = seen[i];
      assert.equal(b.data.groups[i].words.length, 1, `${at}: the long word stands alone`);
      assert.ok(g.words[0] >= b.data.left - 1 && g.words[1] <= b.data.left + b.data.maxWidth + 1, `${at}: the word reaches x ${g.words[0]}–${g.words[1]}, its area x ${b.data.left}–${b.data.left + b.data.maxWidth}`);
      assert.equal(g.lines, 1, at);   // (a word is one box, whatever lines it has inside)
      sizes[name] = g.size;
      // the other captions are not touched by it
      seen.forEach((o, k) => { if (k !== i && b.data.groups[k].words.length > 1) assert.equal(o.size, b.data.size, `${at}: "${o.text}"`); });
    }
    assert.ok(sizes.whole < STYLES[style].look.size, `${style}: the whole word is set at ${sizes.whole} px, the style's size`);
    assert.ok(sizes.soft > sizes.whole, `${style}: broken at its soft hyphen the word is ${sizes.soft} px, whole ${sizes.whole}`);
    // the big styles' type would pass the area even at the least size the others shrink to: there the word goes under it
    if (["hormozi", "wipe"].includes(style)) assert.ok(sizes.whole < STYLES[style].look.size * 0.55, `${style}: ${sizes.whole} px`);
  }
});
