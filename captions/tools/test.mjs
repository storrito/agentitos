// Where the captions go. Without the options for it (--x, --y, --max-width, --align, --font-size,
// --lines) the tool builds what the version before them built, byte for byte; with them the built
// file carries the area, the alignment, the size and the lines asked for. No request, no browser.
//
//   node --test tools/test.mjs
//
// "The version before" is the commit BEFORE, the last one without the options, read from this
// repository's history into a temp folder and run on the same words (CAPTIONS_BEFORE names
// another commit). Without git or without that commit (the skill's folder alone, a shallow
// clone) that test is skipped. Whoever changes the captions nobody placed on purpose names the
// commit that did it here.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { STYLES } from "./lib/styles.mjs";
import { groups } from "./lib/group.mjs";
import { zones, zonesTool } from "./lib/zones.mjs";

const BEFORE = process.env.CAPTIONS_BEFORE || "ce60c3a5dc639e9231a78762282d28c24fd67cd6";
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
  const same = (name, args, files, words) => {
    const a = run(old, path.join(dir, "a", name), args, words), b = run(TOOL, path.join(dir, "b", name), args, words);
    assert.equal(a.status, 0, a.stderr); assert.equal(b.status, 0, b.stderr);
    assert.equal(b.stdout, a.stdout, `${name}: what the tool says`);
    for (const f of files) assert.ok(fs.readFileSync(path.join(dir, "b", name, f)).equals(fs.readFileSync(path.join(dir, "a", name, f))), `${name}: ${f} differs from the version before`);
  };
  for (const style of Object.keys(STYLES)) for (const size of ["1080x1920", "1920x1080", "1080x1080", "720x1280"]) {
    same(`${style}-${size}`, ["build", "words.json", "out/captions", "--style", style, "--size", size], ["out/captions/index.html"]);
  }
  same("one-platform", ["build", "words.json", "out/captions", "--style", "karaoke", "--size", "1080x1920", "--platform", "reels", "--duration", "9", "--track", "4"], ["out/captions/index.html"]);
  same("cards", ["build", "words.json", "out/captions", "--style", "wipe", "--size", "1080x1920"], ["out/captions/index.html"], BOXED);
  if (!ffmpeg) return t.diagnostic("no ffmpeg: `project` not compared");
  for (const side of ["a", "b"]) {
    fs.mkdirSync(path.join(dir, side, "project"), { recursive: true });
    const made = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=360x640:r=30:d=9", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path.join(dir, side, "project", "video.mp4")], { encoding: "utf8" });
    assert.equal(made.status, 0, made.stderr);
  }
  same("project", ["project", "video.mp4", "words.json", "comp", "--style", "clean"], ["comp/index.html", "comp/captions/index.html", "comp/meta.json", "comp/hyperframes.json"]);
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
  assert.doesNotMatch(tall.html, /el\.style\.width/);        // centred, a box stays as it was

  const right = built(t, ["--style", "karaoke", "--size", "1080x1080", "--x", "100", "--max-width", "600", "--align", "right"]);
  assert.deepEqual([right.rule.left, right.rule.right, right.rule.width, right.rule["text-align"], right.rule.margin, right.rule["transform-origin"]], ["100px", "380px", "600px", "right", "0 0 0 auto", "100% 50%"]);

  // `project` takes them as `build` does
  if (!ffmpeg) return t.diagnostic("no ffmpeg: `project` not built");
  const dir = folder(t);
  spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=360x640:r=30:d=9", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path.join(dir, "video.mp4")]);
  const r = run(TOOL, dir, ["project", "video.mp4", "words.json", "comp", "--size", "1080x1920", "--y", "440", "--align", "left", "--lines", "1"]);
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, "comp", "captions", "index.html"), "utf8");
  assert.match(html, /#root \.cap-group \{[^}]*bottom: 1480px;[^}]*text-align: left;/);
  assert.match(html, /"lines":1,/);
});

test("what is not asked for stays where platform-zones puts it, in the style's size and lines", { skip: noZones }, (t) => {
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
});

test("a size that is named is held: the groups are cut to what fits their line, every word once and in order", { skip: noZones }, (t) => {
  for (const style of Object.keys(STYLES)) {
    const one = built(t, ["--style", style, "--size", "1080x1920", "--y", "440", "--max-width", "696", "--font-size", "60", "--lines", "1"]);
    assert.equal(texts(one.data).join(" "), SAID, style);
    // about `advance` em a character, a box's padding off the room
    const fits = Math.floor((696 - (STYLES[style].look.box ? 60 : 0)) / (60 * STYLES[style].advance));
    for (const text of texts(one.data)) assert.ok(text.length <= fits || !text.includes(" "), `${style}: "${text}" is longer than the ${fits} characters of a line`);
    one.data.groups.forEach((g, i) => { if (i) assert.ok(g.start >= one.data.groups[i - 1].end, `${style}: one group at a time`); });
  }
  // type that is larger than the style's takes its stroke along
  const big = built(t, ["--style", "hormozi", "--size", "1080x1920", "--font-size", "192"]);
  assert.match(big.html, /-webkit-text-stroke: 18px/);
});

test("a phrase cut by length: the fewest groups that fit, about equally long, a long word alone", () => {
  const phrase = (text) => text.split(" ").map((w, i) => ({ text: w, start: i * 0.3, end: i * 0.3 + 0.25 }));
  const cut = (text, words, chars, even) => { const ws = phrase(text); return groups(ws, { words, chars, pause: 0.45, min: 1, even }, 60).map((g) => ws.slice(g.from, g.to + 1).map((w) => w.text).join(" ")); };
  const said = "wie ihr eure Instagram-Storys für die ganze Woche vorplant.";
  assert.deepEqual(cut(said, 9, 19, "length"), ["wie ihr eure", "Instagram-Storys", "für die ganze", "Woche vorplant."]);
  // by words, as the styles cut, the same phrase falls into single words
  assert.equal(cut(said, 9, 19).length, 7);
  assert.deepEqual(cut("a Donaudampfschifffahrtsgesellschaft b", 9, 12, "length"), ["a", "Donaudampfschifffahrtsgesellschaft", "b"]);
  assert.deepEqual(cut("one two three four five six", 2, 64, "length"), ["one two", "three four", "five six"]);
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
  assert.equal(fs.existsSync(path.join(dir, "out")), false);
});
