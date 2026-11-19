#!/usr/bin/env node
// The solver against what is known: two takes laid out by hand on stills (hand.json: what the hand
// found, the solver must find, or say why not), and one section for each thing the solver handles:
// the ranking's weights, several faces, a face that moves, a screen region with a webcam's
// circle, the frames 4:5 and 1:1, and the commands. Every test says in words what is expected.
// Where a test has platform-zones' layout check measure a page, the faces are drawn ovals: no
// test needs a recording.
//
//   node test.mjs [folder]            every test; the pages go into the folder (default: a
//                                     temporary one, removed afterwards)
//   node test.mjs [folder] --quick    without the checker, so without Chrome and ffmpeg

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULTS } from "./lib/defaults.mjs";
import { evaluate } from "./lib/evaluate.mjs";
import { judge, compare } from "./lib/judge.mjs";
import { renderPage } from "./lib/page.mjs";
import { alike, solve as solveAny } from "./lib/solve.mjs";
import { textOverTime, MOUTH } from "./lib/placed.mjs";
import { areaOverTime } from "./lib/area.mjs";
import { askZones, checkPage, chromePath, zonesTool } from "./lib/zones.mjs";
import { besideSolve } from "./lib/beside.mjs";
import { renderBeside } from "./lib/beside-page.mjs";
import { inter } from "./lib/boxes.mjs";
import { keepOut } from "./lib/text.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), QUICK = args.includes("--quick"), given = args.find((a) => !a.startsWith("--"));
try { zonesTool(); } catch (e) { console.error(e.message); process.exit(1); }
if (!QUICK && !chromePath()) { console.error("The checker needs Chrome: set CHROME=/path/to/chrome, or run the tests that need none with --quick."); process.exit(1); }
const OUT = given || fs.mkdtempSync(path.join(os.tmpdir(), "layout-test-"));
fs.mkdirSync(OUT, { recursive: true });
const HAND = JSON.parse(fs.readFileSync(path.join(HERE, "hand.json"), "utf8"));
// The upright take's box was read from the top of the head (hand.json, p1.head): every run on it,
// still or moving, keeps the margin above it that the box has as read.
const P1BOX = /\b\d+,\d+,600,900\b/;
const solve = (a) => (P1BOX.test(JSON.stringify(a.faces || a.sources || [])) ? solveAny({ ...a, set: { ...HAND.takes.p1.set, ...a.set } }) : solveAny(a));
const P1SET = Object.entries(HAND.takes.p1.set).flatMap(([k, v]) => ["--set", `${k}=${v}`]);

let failed = 0, passed = 0;
const rows = [];
function t(name, fn) {
  try { const note = fn(); passed++; console.log(`  ✓ ${name}${note ? `: ${note}` : ""}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n      ${String(e.message).split("\n").join("\n      ")}`); }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const near = (a, b, tol, what) => ok(Math.abs(a - b) <= tol, `${what}: ${a}, expected ${b} ± ${tol}`);
const side = (what, hand, solver) => rows.push([what, hand, solver]);
const r2 = (v) => Math.round(v * 100) / 100;

// a hand page's boxes as the solver judges them: the sharp picture and its window, the faces, the
// text blocks (a caption block as high as its lines, big lines as wide as their letters at half
// an em each)
function handBoxes(p) {
  const [W, H] = p.frame, text = [];
  for (const x of p.text) {
    if (x.style === "cap") { const h = x.lines.length * x.font * 1.32; text.push({ kind: "text", label: "caption", box: [x.left, H - x.bottom - h, x.width, h] }); }
    else if (x.style === "card") text.push({ kind: "text", label: "hook", box: x.box });
    else { const longest = Math.max(...x.lines.map((l) => l.replace(/<[^>]+>/g, "").length)); text.push({ kind: "text", label: "big", box: [x.left, x.top, longest * 0.5 * x.font, x.lines.length * 1.08 * x.font + 0.09 * x.font] }); }
  }
  const pic = p.picture;
  return { W, H, picture: pic, win: p.window || (pic[0] >= 0 && pic[1] >= 0 && pic[0] + pic[2] <= W && pic[1] + pic[3] <= H ? pic : null), faces: p.faces, text };
}
// the same page as HTML, in the form the hand made it, the still replaced by a drawn surface
function handPage(p, file) {
  const [W, H] = p.frame, st = (b) => `left:${b[0]}px;top:${b[1]}px;width:${b[2]}px;height:${b[3]}px`;
  const css = `html,body{margin:0;background:#000}
#frame{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#14181d;font-family:"Noto Sans","DejaVu Sans","Liberation Sans",sans-serif;font-weight:800;color:#fff}
.clip{position:absolute;overflow:hidden}
.ph{position:absolute;background:linear-gradient(180deg,#8fa3b8,#5f7388 55%,#3d4c5c)}
[data-zone=face]{position:absolute;border-radius:48%/42%;background:#e2b79a}
.cap{position:absolute;text-align:center;line-height:1.32}
.cap span{background:rgba(0,0,0,.74);padding:.06em .34em;border-radius:14px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.card{position:absolute;background:#fff;color:#14181d;border-radius:28px;display:flex;align-items:center;justify-content:center;text-align:center;line-height:1.14}
.big{position:absolute;line-height:1.08}
.big b{color:#ffd23f}`;
  const parts = [];
  const pic = p.picture, w = p.window;
  parts.push(w ? `<div class="clip" style="${st(w)}"><div class="ph" style="${st([pic[0] - w[0], pic[1] - w[1], pic[2], pic[3]])}"></div></div>` : `<div class="ph" style="${st(pic)}"></div>`);
  for (const f of p.faces) parts.push(`<div data-zone="face" style="${st(f)}"></div>`);
  for (const x of p.text) {
    if (x.style === "cap") parts.push(`<div class="cap" style="left:${x.left}px;width:${x.width}px;bottom:${x.bottom}px;font-size:${x.font}px;text-align:${x.align};white-space:nowrap">${x.lines.map((l) => `<span>${l}</span>`).join("<br>")}</div>`);
    else if (x.style === "card") parts.push(`<div class="card" style="${st(x.box)};font-size:${x.font}px">${x.lines.join("<br>")}</div>`);
    else parts.push(`<div class="big" style="left:${x.left}px;top:${x.top}px;font-size:${x.font}px">${x.lines.join("<br>")}</div>`);
  }
  fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div id="frame" data-composition-id="layout" data-width="${W}" data-height="${H}">
${parts.join("")}
</div></body></html>`);
  return file;
}
const hardCodes = (list) => [...new Set(list.filter((q) => q.level === "hard").map((q) => `${q.kind} ${q.code}`))].sort().join(", ") || "none";
const checkerCodes = (r) => [...new Set(r.hard.map((f) => `${f.kind} ${/^under /.test(f.what) ? "covered" : /^lies on/.test(f.what) ? "text-on-face" : /outside the frame/.test(f.what) ? "off-frame" : /^overlaps/.test(f.what) ? "text-on-text" : "other"}`))].sort().join(", ") || "none";
// the hand pages of one take: the solver's geometry and the checker give the same verdict on each
function handVerdicts(take) {
  const diff = [];
  for (const p of HAND.takes[take].pages) {
    const b = handBoxes(p), Z = b.W > b.H ? Z169 : Z916;
    const mine = hardCodes(judge(Z, [...b.faces.map((f) => ({ kind: "face", label: "face", box: f })), ...b.text]));
    const theirs = checkerCodes(checkPage(handPage(p, path.join(OUT, `hand-${take}-${p.name}.html`))));
    if (mine !== theirs) diff.push(`${p.name}: solver ${mine}; checker ${theirs}`);
    // and it is the verdict the hand wrote down
    if (/^fails/.test(p.checker) !== (theirs !== "none")) diff.push(`${p.name}: the hand wrote "${p.checker}", the checker now says ${theirs}`);
  }
  ok(!diff.length, diff.join("\n"));
  return `${HAND.takes[take].pages.length} pages`;
}
// the solver's candidate as a page, checked
function verify(c, res, name) {
  const file = path.join(OUT, `${name}.html`);
  fs.writeFileSync(file, renderPage(c, res, { page: file }));
  const r = checkPage(file);
  // the page must show the checker what the solver placed
  const faces = r.boxes.filter((b) => b.kind === "face" && b.box[2] > 0 && b.box[3] > 0).length, texts = r.boxes.filter((b) => b.kind === "text").length;
  const placed = c.faceInFrame.length + (c.others || []).length + (c.circle ? 1 : 0);
  if (faces !== placed || texts !== c.text.length) throw new Error(`${name}: the checker saw ${faces} faces and ${texts} texts, the solver placed ${placed} and ${c.text.length}`);
  return { r, cmp: compare(c, r), file };
}

// =============================================================================================
console.log(`P1: ${HAND.takes.p1.what.split(":")[0].toLowerCase()}, source ${HAND.takes.p1.source.join("×")}, face x 300–900, y 570–1470`);
// =============================================================================================
const SRC1 = HAND.takes.p1.source, FACE1 = HAND.takes.p1.face;
const Z916 = askZones("9:16"), Z169 = askZones("16:9");
// The hand set its captions in 56 px type with no box around them. Where the solver is compared
// with the hand's numbers it runs with that type; everywhere else with the skill's own (a line
// as tall as published Shorts set theirs, and room for the padding of a caption style's box).
const HAND_TYPE = { "caption.font.tall": 56, "caption.line": 1.32, "caption.padEm": 0 };
const run1 = (zones, text, set) => solve({ zones, source: SRC1, faces: [FACE1], needs: text, set: { ...HAND_TYPE, ...set } });
const plain1 = (zones, text) => solve({ zones, source: SRC1, faces: [FACE1], needs: text });
// hook: the kind the solver tries first (a short text in the middle, then the card); card: the
// card across the top, which is what the hand laid out
const cap = (n) => ({ role: "caption", lines: n }), hook = { role: "hook" }, card = { role: "hook", kind: "card" };
// Two men at a table in profile, a 4K talk show (the first use on real footage, 2026-11-18): the
// left one bald, his box from where a hairline would be (y 480) to the chin, his skull's top at y 403.
const TABLE = [[555, 480, 185, 230], [3190, 575, 200, 215]], SKULL = 403;

t("one caption line: the zoom wins, ≈ 1.07 at about −76/−134, text above the head", () => {
  const res = run1(Z916, [cap(1)]), c = res.candidates[0];
  side("P1 9:16, 1 caption line: fit", "zoom 1.07 at −75.6/−134.4", `${c.fit} ${c.scale} at ${c.left}/${c.top}`);
  side("  face in the frame", "x 245.4–887.4, y 475.5–1438.5", `x ${c.faceInFrame[0][0]}–${c.faceInFrame[0][0] + c.faceInFrame[0][2]}, y ${c.faceInFrame[0][1]}–${c.faceInFrame[0][1] + c.faceInFrame[0][3]}`);
  side("  caption", "above the head, y 361–440 (60 px)", `${c.text[0].where}, y ${Math.round(c.text[0].box[1])}–${Math.round(c.text[0].box[1] + c.text[0].box[3])} (56 px)`);
  ok(c.fit === "zoom", `the winner is ${c.fit}`);
  near(c.scale, 1.07, 0.005, "scale"); near(c.left, -76, 1.5, "left"); near(c.top, -134, 2, "top");
  ok(c.text.length === 1 && c.text[0].where === "above-head", `the caption is ${c.text[0]?.where}`);
  ok(!c.hard && !c.unmet.length, "the zoom has a problem");
  if (!QUICK) { const v = verify(c, res, "p1-caption1-zoom"); ok(v.r.ok, `the checker fails it: ${v.r.hard.map((f) => f.what)}`); ok(v.cmp.agree, `solver and checker differ: ${JSON.stringify(v.cmp)}`); }
  return `zoom ${c.scale} at ${c.left}/${c.top}`;
});

t("unchanged, the picture fails: chin under TikTok and Facebook Reels, cheek under Shorts", () => {
  const res = run1(Z916, [cap(2)]), c = res.candidates.find((q) => q.fit === "full");
  const cov = c.problems.find((q) => q.code === "covered" && q.kind === "face");
  ok(c.hard && cov, "full has no hard problem");
  for (const who of ["tiktok", "facebook-reels", "youtube-shorts"]) ok(cov.what.includes(`(${who})`), `the face is not under ${who}: ${cov.what}`);
  ok(res.candidates.indexOf(c) === res.candidates.length - 1, "full is not ranked last");
  side("P1 9:16 unchanged", "✗ chin under TikTok, Facebook Reels; cheek under Shorts", `✗ ${[...cov.what.matchAll(/\(([a-z-]+)\)/g)].map((m) => m[1]).join(", ")}`);
  if (!QUICK) { const v = verify(c, res, "p1-full"); ok(!v.r.ok, "the checker passes the unchanged picture"); ok(v.cmp.agree, `solver and checker differ: ${JSON.stringify(v.cmp)}`); }
});

t("unchanged, captions at the safe box's bottom lie on the face (the hand's page 1, judged by the solver's geometry)", () => {
  const p = handBoxes(HAND.takes.p1.pages[0]);
  const found = judge(Z916, [...p.faces.map((b) => ({ kind: "face", label: "face", box: b })), ...p.text]);
  ok(found.some((q) => q.code === "text-on-face"), "the solver sees no text on the face");
  ok(found.some((q) => q.code === "covered" && q.kind === "face"), "the solver sees no covered face");
});

t("the zoom holds one caption line or the card, not both", () => {
  const z = (text) => run1(Z916, text).candidates.find((q) => q.fit === "zoom");
  const a = z([card]), b = z([card, cap(1)]), c2 = z([cap(2)]);
  ok(!a.hard && !a.unmet.length && a.text[0].where === "above-head", "the card alone does not fit above the head");
  ok(b.unmet.length === 1, `card and caption both fit in the zoom: ${JSON.stringify(b.text.map((q) => q.role))}`);
  side("P1 zoom 1.07, card alone", "card 196 px tall at 66 px", `card ${a.text[0].box[3]} px tall at ${a.text[0].font} px`);
  side("P1 zoom 1.07, card + captions", "not both", `not both (${b.unmet.join(", ")} without a place)`);
  side("P1 zoom 1.07, caption lines above the head", "one (two only at 0.9)", c2.unmet.length ? "one" : `two fit too (y ${Math.round(c2.text[0].box[1])}–${Math.round(c2.text[0].box[1] + c2.text[0].box[3])}, safe box from ${Z916.safe[1]})`);
  return `card alone at ${a.text[0].font} px; with a caption line: ${b.unmet.join(", ")} without a place`;
});

t("hook plus two caption lines: no full or zoom fits; 0.82 is the first inset that holds both at the card's size", () => {
  const res = run1(Z916, [card, cap(2)]);
  for (const c of res.candidates.filter((q) => q.fit !== "inset")) ok(c.hard || c.unmet.length, `${c.fit} fits card plus captions`);
  const top = res.candidates[0], fullSize = res.candidates.find((q) => q.fit === "inset" && q.fullSize);
  ok(top.fit === "inset", `the winner is ${top.fit}`);
  ok(fullSize, "no inset holds the card at its size");
  near(fullSize.scale, 0.82, 0.005, "the inset with the card at its size"); near(fullSize.left, 97, 1, "left"); near(fullSize.top, 215, 1, "top");
  ok(fullSize.text.every((q) => q.where === "above-head"), "not all text is above the head");
  // the same, the card not allowed to shrink: 0.82 is then the first of all
  const fixed = run1(Z916, [card, cap(2)], { "hookCard.minFont": DEFAULTS.hookCard.font }).candidates[0];
  ok(fixed.fit === "inset", `with a fixed card the winner is ${fixed.fit}`); near(fixed.scale, 0.82, 0.005, "with a fixed card");
  // and without the 20 px the hand kept under the chin
  const noPad = run1(Z916, [card, cap(2)], { "hookCard.minFont": DEFAULTS.hookCard.font, facePad: 0 }).candidates[0];
  side("P1 9:16, card + 2 caption lines", "inset 0.82 at 97/215, card 240 px (76 px), all above the head", `inset ${fullSize.scale} at ${fullSize.left}/${fullSize.top}, card ${fullSize.text.find((q) => q.role === "hook").box[3]} px (76 px), all above the head`);
  side("  the solver's first", "(the hand shrank the card to 66 px only in the zoom)", `inset ${top.scale} at ${top.left}/${top.top} with the card at ${top.text.find((q) => q.role === "hook").font} px`);
  side("  without the 20 px under the chin", "–", `inset ${noPad.scale}`);
  if (!QUICK) for (const [c, n] of [[top, "p1-hook2-first"], [fullSize, "p1-hook2-fullsize"]]) { const v = verify(c, res, n); ok(v.r.ok, `the checker fails ${n}`); ok(v.cmp.agree, `solver and checker differ on ${n}: ${JSON.stringify(v.cmp)}`); }
  return `first inset ${top.scale} (card ${top.text.find((q) => q.role === "hook").font} px), with the card at 76 px ${fullSize.scale} at ${fullSize.left}/${fullSize.top}`;
});

t("the hand's insets, placed as the hand placed them, pass in the solver's geometry", () => {
  const ctxOf = (text) => { const D = structuredClone(DEFAULTS); D.caption.font.tall = HAND_TYPE["caption.font.tall"]; D.caption.line = HAND_TYPE["caption.line"]; D.caption.padEm = 0; D.free.above = HAND.takes.p1.set["free.above"]; return { W: 1080, H: 1920, Z: Z916, D, sw: 1080, sh: 1920, s0: 1, faces: [FACE1], fb: [300, 570, 900, 1470], tall: true, cap: text.find((n) => n.role === "caption") || null, hook: text.find((n) => n.role === "hook") || null }; };
  const a = evaluate(ctxOf([cap(2)]), { fit: "inset", s: 0.9, left: 54, top: 97, win: [54, 97, 972, 1728] });
  ok(!a.hard && !a.unmet.length && a.text[0].where === "above-head", `0.9 with two lines: ${JSON.stringify(a.problems)}`);
  const b = evaluate(ctxOf([card, cap(2)]), { fit: "inset", s: 0.82, left: 97, top: 215, win: [97, 215, 885.6, 1574.4] });
  ok(!b.hard && !b.unmet.length && b.fullSize, `0.82 with card and two lines: ${JSON.stringify(b.problems)}`);
  const c = evaluate(ctxOf([card, cap(2)]), { fit: "inset", s: 0.9, left: 54, top: 97, win: [54, 97, 972, 1728] });
  ok(c.unmet.length || !c.fullSize, "0.9 holds the card at its size and two lines");
  const res2 = run1(Z916, [cap(2)]), first2 = res2.candidates[0];
  // where the solver goes further than the hand (two lines above the head in the zoom), the checker decides
  if (!QUICK && first2.fit === "zoom") { const v = verify(first2, res2, "p1-caption2-zoom"); ok(v.r.ok, `the checker fails two lines above the head in the zoom: ${v.r.hard.map((f) => f.what)}`); ok(v.cmp.agree, `solver and checker differ: ${JSON.stringify(v.cmp)}`); }
  side("P1 9:16, 2 caption lines", "inset 0.9 at 54/97 (zoom: one line only)", `${first2.fit} ${first2.scale} at ${first2.left}/${first2.top}, lines ${first2.text[0].where}; the hand's 0.9 passes too`);
});

t("16:9: the whole take as a panel on the left passes, text beside it", () => {
  const res = run1(Z169, [card, cap(2)]), c = res.candidates[0];
  ok(c.fit === "panel" && c.side === "left", `the winner is ${c.fit} ${c.side || ""}`);
  near(c.window[2], 607.5, 0.6, "panel width"); near(c.window[3], 1080, 0.6, "panel height");
  ok(!c.hard && !c.unmet.length && c.text.every((q) => q.where === "beside"), `the panel: ${JSON.stringify(c.problems)}`);
  const hk = c.text.find((q) => q.role === "hook"), cp = c.text.find((q) => q.role === "caption");
  side("P1 16:9, hook + 2 caption lines", "panel 607.5×1080 left; hook 112 px from x 704; captions x 704, bottom 930", `panel ${c.window[2]}×${c.window[3]} ${c.side}; hook ${hk.font} px from x ${hk.box[0]}; captions x ${cp.box[0]}, bottom ${cp.box[1] + cp.box[3]}`);
  if (!QUICK) { const v = verify(c, res, "p1-169-panel"); ok(v.r.ok, "the checker fails the panel"); ok(v.cmp.agree, `solver and checker differ: ${JSON.stringify(v.cmp)}`); }
  // (with the hand's small type the take in the middle, a little smaller, may stand before it)
  const alone = run1(Z169, [cap(1)]).candidates.find((q) => q.fit === "panel");
  ok(alone && !alone.hard && !alone.unmet.length, "the panel with one caption line fails");
});

if (!QUICK) t("solver and checker give the same verdict on the eight hand pages, and it is the one the hand wrote down", () => handVerdicts("p1"));

// =============================================================================================
console.log(`\nP2: ${HAND.takes.p2.what.split(":")[0].toLowerCase()}, source ${HAND.takes.p2.source.join("×")}, face x 558–735, y 100–348`);
// =============================================================================================
const SRC2 = HAND.takes.p2.source, FACE2 = HAND.takes.p2.face;
const run2 = (zones, text) => solve({ zones, source: SRC2, faces: [FACE2], needs: text, set: HAND_TYPE, merge: false });
const pages2 = HAND.takes.p2.pages.map((p) => [p.name, handBoxes(p)]);
const handOf = (pred) => pages2.find(([, p]) => p.W < p.H && pred(p));
const scaleOf = (p) => p.picture[2] / SRC2[0];
const fullPage = pages2.find(([, p]) => p.W > p.H && Math.abs(p.picture[2] - p.W) < 1 && Math.abs(p.picture[0]) < 1);

t("9:16: the solver proposes the hand's three crops, at the same place", () => {
  const res = run2(Z916, [cap(2)]);
  const out = [];
  for (const [ratio, s] of [["9:16", 1920 / SRC2[1]], ["4:5", 1350 / SRC2[1]], ["1:1", 1080 / SRC2[1]]]) {
    const c = res.candidates.find((q) => q.fit === "crop" && q.crop === ratio);
    ok(c, `no crop ${ratio}`);
    near(c.scale, s, 0.01, `crop ${ratio} scale`);
    const hand = handOf((p) => Math.abs(scaleOf(p) - s) < 0.02);
    ok(hand, `no hand page shows the crop ${ratio}`);
    near(c.left, hand[1].picture[0], 3, `crop ${ratio} left against ${hand[0]}`);
    near(c.faceInFrame[0][0], hand[1].faces[0][0], 3, `crop ${ratio} face x against ${hand[0]}`);
    side(`P2 9:16 crop ${ratio}`, `${r2(scaleOf(hand[1]))}× at left ${hand[1].picture[0]}, picture y ${(hand[1].win || [0, 0])[1]}–${hand[1].win ? hand[1].win[1] + hand[1].win[3] : hand[1].H}`, `${c.scale}× at left ${c.left}, picture y ${c.window[1]}–${c.window[1] + c.window[3]}; ${c.hard ? "✗" : c.soft ? "!" : "✓"} ${c.problems.filter((q) => q.code === "enlarged").map((q) => q.level).join("") || "not enlarged"}`);
    out.push(`${ratio} ${c.scale}×`);
  }
  const first = res.candidates[0];
  side("P2 9:16, 2 caption lines: the solver's first", "(the hand tried the three crops)", `${first.fit}${first.crop ? ` ${first.crop}` : ""} ${first.scale}× (${first.why[2]}), then ${res.candidates.slice(1).map((q) => `${q.fit}${q.crop ? ` ${q.crop}` : ""}`).join(", ")}`);
  ok(res.candidates.find((q) => q.crop === "9:16").hard, "the 2.67× crop is not a hard problem");
  return out.join(", ");
});

t("16:9: the source fills the frame and one caption line stands at the bottom", () => {
  const res = run2(Z169, [cap(1)]), c = res.candidates[0];
  ok(c.fit === "full" && !c.hard && !c.unmet.length, `the winner is ${c.fit}: ${JSON.stringify(c.problems)}`);
  ok(c.text[0].where === "below-chin" && Math.abs(c.text[0].box[1] + c.text[0].box[3] - (Z169.safe[1] + Z169.safe[3])) < 1, "the caption is not at the safe box's bottom");
  side("P2 16:9, 1 caption line", `full ${r2(scaleOf(fullPage[1]))}×, caption at the bottom`, `${c.fit} ${c.scale}×, caption ${c.text[0].where} at the bottom (${c.soft ? "! enlarged" : "✓"})`);
  if (!QUICK) { const v = verify(c, res, "p2-169-full"); ok(v.r.ok, "the checker fails it"); ok(v.cmp.agree, `solver and checker differ: ${JSON.stringify(v.cmp)}`); }
});

if (!QUICK) t("solver and checker give the same verdict on the six hand pages, and it is the one the hand wrote down", () => handVerdicts("p2"));

if (!QUICK) t("the solver's candidates for the wide take pass the checker where the solver passes them", () => {
  const diff = [];
  let n = 0;
  for (const [Z, text, tag] of [[Z916, [cap(2)], "916-cap2"], [Z916, [card, cap(2)], "916-card-cap2"], [Z169, [card, cap(1)], "169-card-cap1"]]) {
    const res = run2(Z, text);
    res.candidates.forEach((c, i) => {
      const v = verify(c, res, `p2-${tag}-${i + 1}-${c.fit}`);
      n++;
      if (!v.cmp.agree) diff.push(`${tag} ${i + 1} ${c.fit}: ${JSON.stringify(v.cmp)}`);
    });
  }
  ok(!diff.length, diff.join("\n"));
  return `${n} pages`;
});

// =============================================================================================
console.log("\nWeights: the ranking's terms from weights.json");
// =============================================================================================
// the wide take people judged from stills: 1280×720, the face as in the second hand take
const SRCW = SRC2, FACEW = FACE2;
const Z45 = askZones("4:5"), Z11 = askZones("1:1");
const ZONES = { "9:16": Z916, "16:9": Z169, "4:5": Z45, "1:1": Z11 };
const nameOf = (c) => `${c.fit}${c.crop ? ` ${c.crop}` : ""}${c.closer ? " closer" : ""}${c.onGround ? " text on the ground" : ""}${c.side ? ` ${c.side}` : ""} ${r2(c.enlargement)}×`;
const needsOf = (list) => list.map((x) => (x === "hook" ? hook : x === "hook:card" ? card : cap(Number(x.split(":")[1]))));
const table = [];

t("the judged wide take (1280×720 into 9:16, two caption lines): the 4:5 crop (1.875×, soft) first, the square (1.5×, no problem) second, the whole picture as a strip third, the 2.67× crop fails", () => {
  const res = solve({ zones: Z916, source: SRCW, faces: [FACEW], needs: [cap(2)], merge: false });
  // (each band also with its text on the ground: listed behind it, left out here)
  const order = res.candidates.filter((c) => !c.onGround).map((c) => (c.fit === "crop" ? `crop ${c.crop}` : c.fit));
  ok(order.slice(0, 3).join(", ") === "crop 4:5, crop 1:1, inset", `the order is ${order.join(", ")}`);
  const [c45, c11, strip] = res.candidates.filter((c) => !c.onGround), c916 = res.candidates.find((c) => c.crop === "9:16");
  ok(!c45.hard && c45.problems.some((q) => q.code === "enlarged" && q.level === "soft"), "1.875× is not a soft problem");
  ok(!c11.problems.some((q) => q.code === "enlarged"), "1.5× (judged crisp) carries a problem");
  ok(c916.hard && c916.problems.some((q) => q.code === "enlarged" && q.level === "hard"), "2.67× is not a hard problem");
  ok(res.candidates.indexOf(c916) > 2, "the 2.67× crop is not behind the three that pass");
  ok(strip.terms.subject > c11.terms.subject && strip.terms.ground > c11.terms.ground, "the strip is not behind for its small person and its ground");
  return `cost ${c45.cost}, ${c11.cost}, ${strip.cost}: ${c45.why.at(-1)}`;
});

t("the hand cases keep the winners written down for them (hand.json: what the hand laid out, what people judged, and what only the solver says so far); a change of the weights that moves one shows here", () => {
  const changed = [];
  for (const w of HAND.winners) {
    const take = HAND.takes[w.take], first = solveAny({ zones: ZONES[w.frame], source: take.source, faces: [take.face], needs: needsOf(w.text), set: take.set || {} }).candidates[0];
    const same = nameOf(first) === w.first;
    table.push([w.case, w.first, w.basis, same ? "" : `now ${nameOf(first)}`]);
    if (!same) changed.push(`${w.case}: ${w.first} (${w.basis}) is now ${nameOf(first)}`);
  }
  ok(!changed.length, changed.join("\n"));
  const by = (b) => HAND.winners.filter((w) => w.basis === b).length;
  return `${HAND.winners.length} cases: ${by("hand")} laid out by hand, ${by("judged")} judged by people, ${by("solver")} only the solver's`;
});

t("the size of a face is a target, not a reward: as tall as published talking heads keep theirs (23–34 % of the frame's height, the middle half of 109 measured Shorts) it costs nothing, smaller 0.3 points a per cent, larger 0.05; so the wide take in 4:5 no longer fills the frame at 1.875× for the larger face, the crisp square band leads", () => {
  const W8 = DEFAULTS.weights.subject;
  ok(W8.from === 23 && W8.to === 34 && W8.smaller === 0.3 && W8.larger === 0.05, `the band: ${JSON.stringify(W8)}`);
  const sub = (h) => { const fh = h / 100 * 1920, fw = 0.7 * fh; return solve({ zones: Z916, source: SRC1, faces: [[540 - fw / 2, 700 - 0.42 * fh, fw, fh]], needs: [cap(1)] }).candidates.find((c) => c.fit === "full"); };
  const [small, usual, close] = [18, 28, 44].map(sub);
  near(small.terms.subject, 0.3 * 5, 0.01, "a face 18 % tall"); near(usual.terms.subject, 0, 0.001, "a face 28 % tall"); near(close.terms.subject, 0.05 * 10, 0.01, "a face 44 % tall");
  ok(!usual.hard && !usual.unmet.length && usual.text[0].where === "below-chin", "the usual face does not pass unchanged with its caption below the chin");
  const res = solve({ zones: Z45, source: SRCW, faces: [FACEW], needs: [cap(2)] }), [first, second] = res.candidates;
  ok(first.fit === "crop" && first.crop === "1:1" && !first.soft && second.fit === "full" && second.enlargement === 1.88, `4:5: ${res.candidates.slice(0, 2).map(nameOf).join(", ")}`);
  ok(!first.terms.subject && second.terms.subject < 0.05, `the faces' sizes cost ${first.terms.subject} and ${second.terms.subject}: neither is far from the band`);
  return `18 %: +${small.terms.subject}, 28 %: ${usual.terms.subject}, 44 %: +${close.terms.subject}; the wide take in 4:5: ${nameOf(first)} (cost ${first.cost}) before ${nameOf(second)} (${second.cost})`;
});

t("one term changed changes the order: with enlargement at 5 points at the limit the crisp square leads", () => {
  const res = solve({ zones: Z916, source: SRCW, faces: [FACEW], needs: [cap(2)], set: { "weights.enlarge.costAtForbidden": 5 } });
  const own = res.candidates.filter((c) => !c.onGround);
  ok(own[0].crop === "1:1" && own[1].crop === "4:5", `the order is ${res.candidates.map(nameOf).join(", ")}`);
  const far = solve({ zones: Z916, source: SRCW, faces: [FACEW], needs: [cap(2)], set: { "weights.enlarge.forbiddenFrom": 3 }, merge: false }).candidates.find((c) => c.crop === "9:16");
  ok(!far.hard, "with the limit at 3× the 2.67× crop still fails");
});

const X1 = (b) => b[0] + b[2], Y1 = (b) => b[1] + b[3];
const inside = (o, i) => i[0] >= o[0] - 0.1 && i[1] >= o[1] - 0.1 && X1(i) <= X1(o) + 0.1 && Y1(i) <= Y1(o) + 0.1;
const overlap = (a, b) => Math.min(X1(a), X1(b)) - Math.max(a[0], b[0]) > 0.1 && Math.min(Y1(a), Y1(b)) - Math.max(a[1], b[1]) > 0.1;
const agree = (c, res, name) => { if (QUICK) return; const v = verify(c, res, name); ok(v.r.ok === !c.hard, `${name}: the checker ${v.r.ok ? "passes" : "fails"} it, the solver ${c.hard ? "fails" : "passes"} it`); ok(v.cmp.agree, `${name}: solver and checker differ: ${JSON.stringify(v.cmp)}`); };

// =============================================================================================
console.log("\nA hook: a short text in the middle, or a card across the top");
// =============================================================================================
t("a hook in an upright frame is tried first as published Shorts set it: a short text below the chin, its block 12.4 % of the frame's height tall, at most as wide as the centred box, its middle near 53 % of the height; with captions it stands above them. A face so close that nothing is free below the chin takes the text above the head, smaller; hook:card asks for the card across the top (which the hand laid out), hook:text never falls back to it; a screen and two stacked people keep the card, and 16:9 its big lines", () => {
  // a face as most published talking heads frame it: 28 % of the height, the chin at half height
  const usual = [340, 420, 400, 540], text = { role: "hook", kind: "text" };
  const one = solve({ zones: Z916, source: SRC1, faces: [usual], needs: [hook] }).candidates[0], h = one.text[0];
  ok(one.fit === "full" && !one.hard && !one.unmet.length && !one.soft, `the usual face with a hook: ${nameOf(one)} ${JSON.stringify(one.problems)}`);
  ok(h.style === "text" && h.where === "below-chin" && h.font === DEFAULTS.hookText.font && !h.shrunk, `the hook: ${h.style} ${h.where} at ${h.font} px`);
  near(h.box[3] / 1920, 0.124, 0.001, "the block's height in the frame's"); near(h.box[0] + h.box[2] / 2, 540, 0.1, "the block's middle across");
  ok(h.box[2] <= Z916.centred[2] + 0.1 && h.box[2] <= 0.72 * 1080 + 0.1, `the block is ${h.box[2]} px wide`);
  const mid = (h.box[1] + h.box[3] / 2) / 1920;
  ok(mid >= 0.53 - 0.001 && mid <= 0.65 && h.box[1] >= Y1(one.faceInFrame[0]), `the block's middle is at ${Math.round(100 * mid)} % of the height`);
  const both = solve({ zones: Z916, source: SRC1, faces: [usual], needs: [hook, cap(1)] }), b = both.candidates[0], bh = b.text.find((x) => x.role === "hook"), bc = b.text.find((x) => x.role === "caption");
  ok(b.fit === "full" && !b.unmet.length && bh.style === "text" && bh.where === "below-chin" && bc.where === "below-chin" && Y1(bh.box) <= bc.box[1] - both.defaults.gap + 0.1 && Math.abs(Y1(bc.box) - Y1(Z916.safe)) < 0.6, `hook and caption: hook y ${bh.box[1]}–${Y1(bh.box)}, caption y ${bc.box[1]}–${Y1(bc.box)}`);
  agree(one, solve({ zones: Z916, source: SRC1, faces: [usual], needs: [hook] }), "hook-text"); agree(b, both, "hook-text-caption");
  // the close take of the hand cases: the chin at 77 % of the height
  const close = (need) => solve({ zones: Z916, source: SRC1, faces: [FACE1], needs: [need] }).candidates.find((c) => c.fit === "zoom");
  const ct = close(hook).text[0], cc = close(card).text[0], only = close(text).text[0];
  ok(ct.style === "text" && ct.where === "above-head" && ct.shrunk && ct.font >= DEFAULTS.hookText.minFont, `the close take's hook: ${ct.style} ${ct.where} at ${ct.font} px`);
  ok(cc.style === "card" && cc.where === "above-head" && cc.font === 66 && only.style === "text", `asked for: ${cc.style} at ${cc.font} px, ${only.style}`);
  const none = solve({ zones: Z916, source: SRC1, faces: [FACE1], needs: [text, cap(2)] }).candidates.find((c) => c.fit === "zoom");
  ok(none.unmet.length && none.text.every((x) => x.style !== "card"), "hook:text fell back to a card");
  // a screen, two people stacked, a wide frame
  const scr = solve({ zones: Z916, sources: [{ size: [1920, 1080], region: [700, 300, 480, 300], minTextHeight: 14 }], needs: [hook, cap(1)] }).candidates[0];
  const two = solve({ zones: Z916, source: [3840, 2160], faces: TABLE, needs: [hook, cap(1)] }).candidates.find((c) => c.fit === "stacked");
  const wide = solve({ zones: Z169, source: SRC1, faces: [FACE1], needs: [hook] }).candidates[0];
  ok(scr.text.find((x) => x.role === "hook").style === "card" && two.text.find((x) => x.role === "hook")?.style === "card" && wide.text[0].style === "big", `a screen: ${scr.text.map((x) => x.style)}, stacked: ${two.text.map((x) => x.style)}, 16:9: ${wide.text[0].style}`);
  return `the usual face: text at ${h.font} px, y ${Math.round(h.box[1])}–${Math.round(Y1(h.box))} (its middle at ${Math.round(100 * mid)} %); with a caption line y ${Math.round(bh.box[1])}–${Math.round(Y1(bh.box))} above y ${Math.round(bc.box[1])}–${Math.round(Y1(bc.box))}; the close take: text above the head at ${ct.font} px, the card at ${cc.font} px`;
});

// =============================================================================================
console.log("\nSeveral faces: one box each");
// =============================================================================================
// two people in one wide picture: 1920×1080, the left one's face x 420–640, the right one's x 1280–1500
const SRC2P = [1920, 1080], TWO = [[420, 300, 220, 300], [1280, 320, 220, 300]];

t("two people in one wide picture into 9:16, two caption lines: a crop on each, both stacked and the whole picture are candidates; stacked leads: each face in its half and in the safe box, the caption on the seam, neither person in the other's half", () => {
  const res = solve({ zones: Z916, source: SRC2P, faces: TWO, needs: [cap(2)] });
  const st = res.candidates.find((c) => c.fit === "stacked"), on = [1, 2].map((k) => res.candidates.find((c) => c.fit === "crop" && c.crop === "9:16" && c.speaker === k));
  const whole = res.candidates.find((c) => c.fit === "inset");
  ok(st && on[0] && on[1] && whole, `candidates: ${res.candidates.map((c) => `${nameOf(c)}${c.speaker ? ` on ${c.speaker}` : ""}`).join(", ")}`);
  ok(res.candidates[0] === st, `the first is ${nameOf(res.candidates[0])}`);
  ok(!st.hard && !st.unmet.length, `stacked: ${JSON.stringify(st.problems)}`);
  const [H1, H2] = [[0, 0, 1080, 960], [0, 960, 1080, 960]];
  ok(inside(H1, st.faceInFrame[0]) && inside(H2, st.faceInFrame[1]), "a face is not in its half");
  ok(st.faceInFrame.every((f) => inside(Z916.safe, f)), "a face is not in the safe box");
  const cp = st.text[0];
  ok(cp.where === "seam" && Math.abs(cp.box[1] + cp.box[3] / 2 - 960) < 0.6, `the caption is ${cp.where} at y ${cp.box[1]}`);
  ok(Y1(st.faceInFrame[0]) < cp.box[1] && st.faceInFrame[1][1] > Y1(cp.box), "the caption touches a face");
  ok(!st.others, "the other person shows in a half");
  ok(st.parts[0].scale === st.parts[1].scale, "the two halves of one picture have two scales");
  ok(whole.faceInFrame.length === 2 && !whole.hard, "the whole picture does not hold both");
  ok(on[0].faceInFrame.length === 1 && on[0].leftOut === 1 && on.every((q) => res.candidates.indexOf(q) > res.candidates.indexOf(whole)), "a crop on one does not stand behind the candidates that show both");
  agree(st, res, "two-916-stacked"); agree(on[0], res, "two-916-crop-on-1"); agree(whole, res, "two-916-whole");
  return `stacked at ${st.parts[0].scale}×, faces ${st.faceHeight} px, caption y ${Math.round(cp.box[1])}–${Math.round(Y1(cp.box))}; then ${res.candidates.slice(1, 4).map((c) => `${nameOf(c)}${c.speaker ? ` on face ${c.speaker}` : ""}`).join(", ")}`;
});

t("--speaker 2: only the crops on the second person are listed, leaving the first out costs nothing, and the crop that fills the frame (1.78×, soft) leads before stacked", () => {
  const res = solve({ zones: Z916, source: SRC2P, faces: TWO, needs: [cap(2)], speaker: 2 });
  const crops = res.candidates.filter((c) => c.speaker && !c.onGround);
  ok(crops.length === 3 && crops.every((c) => c.speaker === 2), `crops on: ${crops.map((c) => c.speaker)}`);
  const first = res.candidates[0];
  ok(first.fit === "crop" && first.crop === "9:16" && first.speaker === 2 && first.leftOut === 1, `the first is ${nameOf(first)}`);
  ok(Math.abs(first.faceInFrame[0][0] + first.faceInFrame[0][2] / 2 - 540) < 1, "the speaker is not on the frame's middle");
  ok(res.candidates[1].fit === "stacked", `the second is ${nameOf(res.candidates[1])}`);
  let thrown = false; try { solve({ zones: Z916, source: SRC2P, faces: TWO, needs: [], speaker: 3 }); } catch { thrown = true; }
  ok(thrown, "a speaker that is not there is accepted");
  agree(first, res, "two-916-speaker-2");
  return `${nameOf(first)} on face 2, cost ${first.cost}; stacked ${res.candidates[1].cost}`;
});

t("two people far apart, one larger (1920×1080 into 9:16, one caption line), no speaker named: a candidate that shows both leads, though the crop on the larger face (1.78×, soft, the other person left out) costs less; whom to leave out is the caller's to say, and with --speaker 2 that crop leads. (Stacked led until a third of a face's height above it was kept clear: the larger face, 384 px of 1080, with that margin and the caption on the seam, is taller than the lower half's safe part)", () => {
  const faces = [[230, 536, 248, 303], [1353, 195, 297, 384]];
  const res = solve({ zones: Z916, source: SRC2P, faces, needs: [cap(1)] }), first = res.candidates[0];
  const crop = res.candidates.find((c) => c.fit === "crop" && c.crop === "9:16" && c.speaker === 2);
  ok(!first.leftOut && !first.speaker && !first.hard && !first.unmet.length && first.faceInFrame.length === 2, `the first is ${nameOf(first)}${first.speaker ? ` on face ${first.speaker}` : ""}`);
  ok(crop && crop.leftOut === 1 && !crop.hard && crop.cost < first.cost, `the crop on face 2: ${crop ? `cost ${crop.cost} against ${first.cost}` : "not listed"}`);
  const all = res.candidates.filter((c) => !c.hard && !c.unmet.length), shown = all.filter((c) => !c.leftOut), out = all.filter((c) => c.leftOut);
  ok(shown.length && out.length && Math.max(...shown.map((c) => res.candidates.indexOf(c))) < Math.min(...out.map((c) => res.candidates.indexOf(c))), "a candidate that leaves a person out stands before one that shows both");
  ok(/leaves a person out/.test(crop.behind) && res.notes.some((n) => /--speaker/.test(n)), `the crop says: ${crop.behind}`);
  const named = solve({ zones: Z916, source: SRC2P, faces, needs: [cap(1)], speaker: 2 }).candidates[0];
  ok(named.fit === "crop" && named.crop === "9:16" && named.speaker === 2, `with --speaker 2 the first is ${nameOf(named)}`);
  return `${nameOf(first)} (cost ${first.cost}) before the crop on face 2 (cost ${crop.cost}); with --speaker 2: ${nameOf(named)}`;
});

// The first use on real footage (2026-11-18, layout-proben/skill-real): two women walking shoulder
// to shoulder towards a camera that follows them, a 4K b-roll, boxes read at 2.5, 4.5 and 6.5 s.
const WALK = [[{ t: 2.5, box: [1990, 640, 125, 200] }, { t: 4.5, box: [2000, 655, 190, 190] }, { t: 6.5, box: [2055, 645, 150, 200] }],
  [{ t: 2.5, box: [2430, 670, 145, 185] }, { t: 4.5, box: [2485, 645, 155, 200] }, { t: 6.5, box: [2450, 665, 140, 190] }]];

t("two people who walk shoulder to shoulder (their faces' boxes 1.05 face widths apart; close is up to 2) are shown in one picture: stacked, which split them into two halves of the same shot and came first, now stands behind every candidate that shows both in one picture and says why; two people 2.9 widths apart are still stacked first", () => {
  const res = solve({ zones: Z916, source: [3840, 2160], faces: WALK, needs: [cap(1)] }), first = res.candidates[0];
  const st = res.candidates.find((c) => c.fit === "stacked");
  ok(first.fit === "crop" && !first.hard && !first.unmet.length && first.faceInFrame.length + (first.others || []).filter((o) => o.shows >= 0.999).length === 2, `the first is ${nameOf(first)}`);
  ok(st && st.splitsClose && /splits two people who stand close together/.test(st.behind), `stacked: ${st && st.behind}`);
  ok(res.candidates.filter((c) => !c.hard && !c.unmet.length && !c.leftOut && c.fit !== "stacked").every((c) => res.candidates.indexOf(c) < res.candidates.indexOf(st)), "a candidate that shows both in one picture stands behind stacked");
  ok(res.notes.some((n) => /stand close together: about the same size .*1\.06 of their mean width/.test(n)), `the notes: ${res.notes.join(" | ")}`);
  const apart = solve({ zones: Z916, source: SRC2P, faces: TWO, needs: [cap(1)] });
  ok(apart.candidates[0].fit === "stacked" && !apart.notes.some((n) => /close together/.test(n)), `two people 2.9 widths apart: ${nameOf(apart.candidates[0])}`);
  return `${nameOf(first)} first, stacked ${res.candidates.indexOf(st) + 1}.`;
});

t("every face that shows is judged, whoever the crop is made for: four people walking in a row (4K) into 9:16; the square crop on face 3 shows face 1 at x 45, past the safe box's left edge, and says so, as the same square 218 px higher already did for its own faces (it passed before: a face 'not held' was not looked at); its page shows the checker every face, and the two agree", () => {
  const faces = [[1536, 740, 135, 200], [1968, 805, 105, 175], [2448, 710, 155, 145], [3178, 720, 145, 145]];
  const res = solve({ zones: Z916, source: [3840, 2160], faces, needs: [cap(1)] });
  // the square on face 3 lies 18 px from the square that holds all four: listed once, as that one
  const on3 = res.candidates.find((c) => c.crop === "1:1" && (c.speaker === 3 || (c.alike || []).some((a) => a.crop === "1:1" && a.speaker === 3)));
  ok(on3 && (on3.others || []).length + on3.faceInFrame.length === 4, `the square on face 3: ${on3 && JSON.stringify(on3.others)}`);
  const f1 = on3.speaker ? on3.others.find((o) => o.of === "face 1") : { box: on3.faceInFrame[0] };
  ok(f1.box[0] < Z916.safe[0] && on3.problems.some((q) => q.of === "face 1" && q.code === "margin" && q.level === "soft"), `face 1 at x ${f1.box[0]}: ${JSON.stringify(on3.problems)}`);
  ok(on3.soft && !on3.hard, `the square on face 3: ${JSON.stringify(on3.problems)}`);
  // every candidate: no face that shows lies under what an app covers without a hard problem
  for (const c of res.candidates) for (const o of c.others || []) ok(!Z916.covers.some((z) => overlap(o.box, z.box)) || c.hard, `${nameOf(c)}: ${o.of} lies under an app's button and passes`);
  agree(on3, res, "group-square-on-3");
  return `the square on face 3${on3.speaker ? "" : ", listed once with the square that holds all four (18 px apart),"}: ${on3.problems.map((q) => `${q.of} ${q.code}`).join(", ")}`;
});

t("a third of a face's height above its box is kept clear of text, for the skull or the hair above the hairline: the two men at a table, stacked with a hook card at the top, the card ended on the bald man's skull (it passed); now it ends above the skull's top, and no text of any candidate comes within a third of a face's height above a face", () => {
  ok(DEFAULTS.free.above === 0.35, `free.above is ${DEFAULTS.free.above}`);
  const res = solve({ zones: Z916, source: [3840, 2160], faces: TABLE, needs: [cap(1), hook] }), st = res.candidates.find((c) => c.fit === "stacked");
  ok(st && !st.hard && !st.unmet.length, `stacked: ${st && JSON.stringify(st.problems)}`);
  const top = st.parts.find((q) => q.window[1] === 0), skull = top.top + top.scale * SKULL, card = st.text.find((x) => x.role === "hook");
  ok(card && Y1(card.box) <= skull + 0.5, `the hook ends at y ${card && Y1(card.box)}, the skull's top is at y ${r2(skull)}`);
  for (const c of res.candidates) for (const f of c.faceInFrame) for (const x of c.text) ok(!overlap(x.box, [f[0], f[1] - 0.35 * f[3], f[2], 0.35 * f[3]]), `${nameOf(c)}: the ${x.role} lies in the third above a face`);
  return `the card ends at y ${Math.round(Y1(card.box))}, the skull's top at y ${Math.round(skull)}`;
});

t("one picture, one size of stacked: the two men at a table came out stacked at 1.05× with a hook and at 0.52× without one (faces 12 and 6 % of the frame's height), as the search for a scale stopped at the smallest that holds both; now it goes on up to where the smaller face is as tall as published faces are, without enlarging past the soft limit, and the ranking chooses. Without the hook the picture is never smaller than with it, with --speaker the same as without", () => {
  const st = (needs, speaker = null) => solve({ zones: Z916, source: [3840, 2160], faces: TABLE, needs, speaker }).candidates.find((c) => c.fit === "stacked");
  const withHook = st([cap(1), hook]), without = st([cap(1)]), named = st([cap(1)], 2);
  ok(!without.hard && !without.unmet.length && without.parts[0].scale >= withHook.parts[0].scale && without.parts[0].scale <= DEFAULTS.weights.enlarge.softFrom + 1e-9, `with the hook ${withHook.parts[0].scale}×, without ${without.parts[0].scale}×`);
  ok(named.parts[0].scale === without.parts[0].scale, `with --speaker 2 ${named.parts[0].scale}×, without ${without.parts[0].scale}×`);
  ok(100 * without.faceHeight / 1920 >= 14, `the faces are ${without.faceHeight} px tall`);
  return `with the hook ${withHook.parts[0].scale}× (faces ${withHook.faceHeight} px), without ${without.parts[0].scale}× (${without.faceHeight} px)`;
});

t("candidates a viewer cannot tell apart are one: the wide interview into 4:5 gave the frame filled at 1.875× and the 4:5 crop 9 px from it as the first two; now the crop is named in the first's `alike`, and the square comes second. Pictures 2 % of the frame apart are one, 3 % two", () => {
  const res = solve({ zones: Z45, source: [1280, 720], faces: [[555, 150, 180, 195]], needs: [cap(1)] }), [a, b] = res.candidates;
  ok(a.alike && a.alike.some((x) => x.fit === "crop" && x.crop === "4:5" && x.apart <= 21.6), `the first: ${nameOf(a)}, alike ${JSON.stringify(a.alike)}`);
  ok(Math.abs(b.scale / a.scale - 1) > 0.02 || Math.abs(b.left - a.left) > 21.6 || Math.abs(b.top - a.top) > 21.6, `the second is the first again: ${nameOf(b)} at ${b.left}/${b.top}`);
  const all = solve({ zones: Z45, source: [1280, 720], faces: [[555, 150, 180, 195]], needs: [cap(1)], merge: false });
  ok(all.candidates.length === res.candidates.length + a.alike.length, "merge: false does not list every candidate");
  // moved by 2 % of the frame's width the same, by 3 % another
  const base = all.candidates[0], moved = (dx) => ({ ...base, left: base.left + dx, window: base.window.map((v, i) => (i === 0 ? v + dx : v)), text: base.text.map((t) => ({ ...t, box: t.box.map((v, i) => (i === 0 ? v + dx : v)) })) });
  const px = DEFAULTS.same.px * 1080;
  ok(px === 21.6 && alike(base, moved(21), px, DEFAULTS.same.scale) && !alike(base, moved(32), px, DEFAULTS.same.scale), `moved 21 px: ${alike(base, moved(21), px, 0.02)}, 32 px: ${alike(base, moved(32), px, 0.02)}`);
  return `${nameOf(a)} (as well ${a.alike.map((x) => `${x.fit} ${x.crop || ""} ${x.apart} px away`).join(", ")}), then ${nameOf(b)}`;
});

t("a crop closer in from a source with pixels to spare: the guest of the 4K table with --speaker 2 was cropped at 0.89× (covering the frame, his face 10 % of its height) and nothing closer was offered; now a crop at the soft limit (1.5×, 17 %) comes first, the covering crop after it. From 1280×720, where covering already takes 2.67×, there is none", () => {
  const res = solve({ zones: Z916, source: [3840, 2160], faces: TABLE, needs: [cap(1)], speaker: 2 }), first = res.candidates[0];
  ok(first.fit === "crop" && first.crop === "9:16" && first.closer && first.speaker === 2 && !first.hard && !first.unmet.length && !first.soft, `the first is ${nameOf(first)} ${JSON.stringify(first.problems)}`);
  near(first.scale, DEFAULTS.weights.enlarge.softFrom, 0.001, "its scale");
  ok(100 * first.faceHeight / 1920 >= 16 && inside(Z916.safe, first.faceInFrame[0]), `its face: ${first.faceInFrame[0]}`);
  ok(res.candidates.some((c) => c.crop === "9:16" && !c.closer && Math.abs(c.scale - 0.8889) < 0.001), "the covering crop is gone");
  const small = solve({ zones: Z916, source: SRCW, faces: [FACEW], needs: [cap(2)] });
  ok(!small.candidates.some((c) => c.closer), "a crop closer in from 1280×720");
  agree(first, res, "closer-on-2");
  return `${nameOf(first)} at ${first.scale}×, the face ${first.faceHeight} px (${Math.round(100 * first.faceHeight / 1920)} %)`;
});

t("text in the ground band: the wide interview into 9:16 with a caption line and a hook left the bands above and below the square empty, a huge blurred face in the one above, while the hook squeezed onto the chest; now the square is also offered with its text on the ground (the hook in the band above), and every candidate says what lies behind a text on the ground: here the blur of the face, under the inset's caption the picture's rest", () => {
  const res = solve({ zones: Z916, source: [1280, 720], faces: [[555, 150, 180, 195]], needs: [cap(1), hook] });
  const band = res.candidates.find((c) => c.onGround && c.crop === "1:1");
  ok(band && !band.hard && !band.unmet.length, `the square with its text on the ground: ${band ? JSON.stringify(band.problems) : "not listed"}`);
  const hk = band.text.find((x) => x.role === "hook");
  ok(hk.on === "ground" && hk.where === "band-above" && Y1(hk.box) <= band.window[1], `the hook stands ${hk.on} ${hk.where}`);
  ok(/blurred, darker copy/.test(band.groundShows.kind) && band.groundShows.behind.some((b) => b.role === "hook" && /blur of the face/.test(b.shows)), `the ground: ${JSON.stringify(band.groundShows)}`);
  const inset = res.candidates.find((c) => c.fit === "inset" && !c.onGround), under = inset.groundShows.behind.find((b) => b.role === "caption");
  ok(under && /no face/.test(under.shows), `behind the inset's caption: ${JSON.stringify(inset.groundShows)}`);
  agree(band, res, "ground-band-square");
  return `${nameOf(band)}: the hook y ${Math.round(hk.box[1])}–${Math.round(Y1(hk.box))} above the picture from y ${band.window[1]}; behind it ${band.groundShows.behind.find((b) => b.role === "hook").shows}`;
});

t("an upright take into 16:9 also as the whole picture in the middle, the sides filled with ground and the caption over its bottom, beside the panel at the left (which looked weak as a video): the stand-in upright take of the first use on real footage, one caption line; with a hook only the panel holds it beside the picture", () => {
  const face = [80, 250, 445, 580];
  const res = solve({ zones: Z169, source: [1080, 1920], faces: [face], needs: [cap(1)] });
  const mid = res.candidates.find((c) => c.fit === "inset"), panel = res.candidates.find((c) => c.fit === "panel");
  ok(mid && !mid.hard && !mid.unmet.length && Math.abs(mid.window[0] + mid.window[2] / 2 - 960) < 1 && mid.window[3] >= 1080 - 0.1, `the picture in the middle: ${mid && `${mid.window} ${JSON.stringify(mid.problems)}`}`);
  const cp = mid.text[0];
  ok(cp.on === "picture" && cp.box[0] >= mid.window[0] && X1(cp.box) <= X1(mid.window) && Math.abs(Y1(cp.box) - Y1(Z169.safe)) < 1, `its caption: ${cp.on} ${cp.box}`);
  ok(panel && !panel.hard && panel.text[0].where === "beside", `the panel: ${panel && panel.text[0].where}`);
  const withHook = solve({ zones: Z169, source: [1080, 1920], faces: [face], needs: [cap(1), hook] }).candidates[0];
  ok(withHook.fit === "panel" && !withHook.unmet.length, `with a hook: ${nameOf(withHook)}`);
  agree(mid, res, "upright-169-middle");
  return `${res.candidates.slice(0, 2).map((c) => `${nameOf(c)} (cost ${c.cost})`).join(" before ")}; with a hook ${nameOf(withHook)}`;
});

t("with a speaker named, the speaker's face sets the size, not a bystander's: a near speaker (500 px of 2160) and a small face behind him (110 px), --speaker 1. The closer crop that enlarged the picture for the bystander and pinned the speaker to the safe box's edge came first, and the crop on the speaker said its face was 136 px; now the crop on the speaker comes first, centred, his face 444 px (23 %), and every candidate counts his face", () => {
  const res = solve({ zones: Z916, source: [3840, 2160], faces: [[1500, 600, 400, 500], [2000, 900, 90, 110]], needs: [cap(1)], speaker: 1 }), first = res.candidates[0];
  ok(first.fit === "crop" && first.speaker === 1 && !first.closer && !first.hard && !first.unmet.length, `the first is ${nameOf(first)}${first.speaker ? ` on ${first.speaker}` : ""}`);
  near(first.faceInFrame[0][0] + first.faceInFrame[0][2] / 2, 540, 1, "the speaker's face across");
  for (const c of res.candidates.filter((q) => !q.hard)) ok(Math.abs(c.faceHeight - c.scale * 500) < 1, `${nameOf(c)}: its size is ${c.faceHeight} px, the speaker's face ${Math.round(c.scale * 500)}`);
  ok(/the speaker's face \(face 1\) is 444 px/.test(first.why.join("; ")), first.why.join("; "));
  agree(first, res, "speaker-not-bystander");
  return `${nameOf(first)} on face 1, then ${res.candidates.slice(1, 3).map(nameOf).join(", ")}`;
});

t("an inset goes below half the take's size while the face stays as tall as published faces are (19 % of the frame's height at the least): an upright take with a face half its height, a hook and two caption lines gave only – and ✗ (the floor was half the size), and SKILL.md then had the agent ask for less text; now an inset at 0.46× passes, the face 23 %, no text within the margins around it", () => {
  const face = [168, 576, 744, 960], res = solve({ zones: Z916, source: [1080, 1920], faces: [face], needs: [hook, cap(2)] }), first = res.candidates[0];
  ok(first.fit === "inset" && !first.hard && !first.unmet.length && first.scale < DEFAULTS.insetMin, `the first is ${nameOf(first)}: ${JSON.stringify(first.problems)}`);
  ok(100 * first.faceHeight / 1920 >= DEFAULTS.insetFace, `the face is ${first.faceHeight} px`);
  const f = first.faceInFrame[0], kept = [f[0] - 0.25 * f[2], f[1] - 0.35 * f[3], 1.5 * f[2], 1.43 * f[3]];
  ok(first.text.every((x) => !overlap(x.box, kept)), "text within the margins around the face");
  agree(first, res, "inset-below-half");
  return `${nameOf(first)}, the face ${Math.round(100 * first.faceHeight / 1920)} %, ${Math.round(100 * first.ground)} % ground`;
});

t("close together means about the same size and near both ways (an independent review's inputs): a near person and a far one 1,100 px apart counted as close and stacked fell to the fifth place behind a square with the near face past the safe box; now they are not close and stacked leads. Two faces 950 px apart up and down are not close either", () => {
  const far = solve({ zones: Z916, source: [3840, 2160], faces: [[1000, 500, 600, 750], [2700, 900, 120, 150]], needs: [cap(1)] });
  ok(!far.notes.some((n) => /close together/.test(n)) && far.candidates[0].fit === "stacked", `a near and a far person: ${nameOf(far.candidates[0])}; ${far.notes.join(" | ")}`);
  const updown = solve({ zones: Z916, source: [3840, 2160], faces: [[1500, 100, 200, 250], [1800, 1300, 200, 250]], needs: [cap(1)] });
  ok(!updown.notes.some((n) => /close together/.test(n)), updown.notes.join(" | "));
  return `${nameOf(far.candidates[0])} first for the near and the far person`;
});

t("on the picture of one moment a face that moves shows its box at that moment, dashed, and the hull it is placed by thin behind it: the review saw the hull drawn at 4.5 s, 1.5× wider than the face, and SKILL.md had the agent read such a box again, without end", () => {
  const res = solve({ zones: Z916, source: [3840, 2160], faces: WALK, needs: [cap(1)] }), c = res.candidates[0];
  const html = renderPage(c, res, { at: 4.5 }), boxes = [...html.matchAll(/class="moment" style="left:([-\d.]+)px;top:([-\d.]+)px;width:([\d.]+)px;height:([\d.]+)px/g)].map((m) => m.slice(1).map(Number));
  ok(boxes.length === 2 && (html.match(/class="hull"/g) || []).length === 2, `${boxes.length} moments, ${(html.match(/class="hull"/g) || []).length} hulls`);
  const want = WALK.map((tr) => tr.find((m) => m.t === 4.5).box).map((b) => [c.left + c.scale * b[0], c.top + c.scale * b[1], c.scale * b[2], c.scale * b[3]]);
  for (const w of want) ok(boxes.some((b) => b.every((v, i) => Math.abs(v - w[i]) < 0.6)), `no box at ${w.map(Math.round)}: ${JSON.stringify(boxes)}`);
  ok(!/class="moment"/.test(renderPage(c, res, {})), "a page of no moment draws a moment's box");
  ok(/its box at that picture's moment/.test(fs.readFileSync(path.join(HERE, "..", "SKILL.md"), "utf8")), "SKILL.md does not say which box is drawn");
  return `face 1 at 4.5 s: ${boxes[0].map(Math.round).join(",")}`;
});

t("closer in also from a source of the frame's shape with pixels to spare (4K into a 16:9 frame of 1920, upright 4K into 9:16): a zoom closer brings the face to the usual size; a crop closer on two people leaves the margins beside their heads inside the safe box (the walking pair's faces stood on both of its edges, hair at the frame's edge)", () => {
  const wide = solve({ zones: Z169, source: [3840, 2160], faces: [[1800, 700, 220, 300]], needs: [cap(1)] }).candidates[0];
  const up = solve({ zones: Z916, source: [2160, 3840], faces: [[900, 1500, 330, 460]], needs: [cap(1)] }).candidates[0];
  for (const [what, c, H] of [["16:9", wide, 1080], ["9:16", up, 1920]]) ok(c.fit === "zoom" && c.closer && !c.hard && !c.unmet.length && 100 * c.faceHeight / H >= DEFAULTS.weights.subject.from - 0.5, `${what}: ${nameOf(c)}, face ${c.faceHeight} px`);
  const walk = solve({ zones: Z916, source: [3840, 2160], faces: WALK, needs: [cap(1)] }).candidates.find((c) => c.closer);
  const S = Z916.safe, side = (f) => DEFAULTS.free.beside * f[2];
  ok(walk && walk.faceInFrame.every((f) => f[0] - side(f) >= S[0] - 0.5 && X1(f) + side(f) <= X1(S) + 0.5), `the walking pair: ${walk && walk.faceInFrame.map((f) => f.map(Math.round)).join(" | ")}`);
  return `16:9 ${wide.scale}×, 9:16 ${up.scale}×; the pair ${walk.scale}×`;
});

t("the upright take in the middle of 16:9 is also tried smaller, as the panel is: with the face low in the take (an independent review's input) the one scale tried left it under YouTube's controls; a smaller one passes", () => {
  const res = solve({ zones: Z169, source: [1080, 1920], faces: [[380, 1300, 320, 400]], needs: [cap(1)] });
  const mid = res.candidates.filter((c) => c.fit === "inset" && Math.abs(c.window[0] + c.window[2] / 2 - 960) < 1);
  ok(mid.some((c) => !c.hard && !c.unmet.length), `the picture in the middle: ${mid.map((c) => `${c.scale} ${JSON.stringify(c.problems)}`).join(" | ")}`);
  return mid.map((c) => `${nameOf(c)} ${c.hard ? "✗" : "passes"}`).join(", ");
});

t("a sliver of another person at a crop's edge is one finding: it was both 'in the safe box's margin' and 'cut by the picture's edge'; now the margin's finding says that it is cut, and the checker still agrees", () => {
  const res = solve({ zones: Z916, source: [3840, 2160], faces: [[1536, 740, 135, 200], [1968, 805, 105, 175], [2448, 710, 155, 145], [3178, 720, 145, 145]], needs: [cap(1)] });
  let n = 0;
  for (const c of res.candidates) for (const o of (c.others || []).filter((x) => x.shows < 0.999)) {
    const mine = c.problems.filter((q) => q.of === o.of && q.level === "soft");
    ok(mine.length === 1, `${nameOf(c)}: ${o.of} has ${mine.length} findings: ${mine.map((q) => q.what).join(" | ")}`);
    ok(/cut by the picture's edge/.test(mine[0].what), mine[0].what);
    n++;
  }
  const c = res.candidates.find((q) => (q.others || []).some((o) => o.shows < 0.999));
  agree(c, res, "sliver-one-finding");
  return `${n} slivers`;
});

t("the same picture in 16:9 stays whole: the caption stands under both chins and the hook above both heads, on neither face; faces far apart take the hook between them", () => {
  // the two of TWO 120 px lower: above their heads a third of a face's height is kept clear for the skull, and the hook needs room over that
  const low = TWO.map(([x, y, w, h]) => [x, y + 120, w, h]);
  const res = solve({ zones: Z169, source: SRC2P, faces: low, needs: [hook, cap(2)] }), c = res.candidates[0];
  ok(c.fit === "full" && !c.hard && !c.unmet.length && c.faceInFrame.length === 2, `the first is ${nameOf(c)}: ${JSON.stringify(c.problems)}`);
  ok(!res.candidates.some((q) => q.fit === "stacked" || q.fit === "side-by-side" || q.speaker), "a wide frame got a crop on one or parts");
  const hk = c.text.find((q) => q.role === "hook"), cp = c.text.find((q) => q.role === "caption");
  ok(c.text.every((q) => c.faceInFrame.every((f) => !overlap(q.box, f))), "text lies on a face");
  ok(cp.where === "below-chin" && hk.where === "above-head", `caption ${cp.where}, hook ${hk.where}`);
  agree(c, res, "two-169-full");
  const far = solve({ zones: Z169, source: SRC2P, faces: [[150, 300, 250, 340], [1520, 300, 250, 340]], needs: [hook] }), f = far.candidates[0], h2 = f.text[0];
  ok(f.fit === "full" && h2.where === "between" && h2.box[0] > X1(f.faceInFrame[0]) && X1(h2.box) < f.faceInFrame[1][0], `faces far apart: hook ${h2.where} at x ${h2.box[0]}–${X1(h2.box)}`);
  agree(f, far, "two-169-between");
  return `hook ${hk.font} px above both heads; faces far apart: hook ${h2.font} px between them`;
});

t("two people as two files (1280×720 and 1920×1080): stacked in 9:16 with the caption on the seam, side by side in 16:9, both tried in 1:1; every face in its part and in the safe box", () => {
  const sources = [{ size: [1280, 720], faces: [FACEW] }, { size: [1920, 1080], faces: [[800, 300, 330, 450]] }];
  const a = solve({ zones: Z916, sources, needs: [cap(2)] }), st = a.candidates[0];
  ok(a.candidates.length === 1 && st.fit === "stacked" && !st.hard && !st.unmet.length, `9:16: ${a.candidates.map(nameOf)}: ${JSON.stringify(st.problems)}`);
  ok(st.text[0].where === "seam" && st.faceInFrame.every((f) => inside(Z916.safe, f)) && Y1(st.faceInFrame[0]) <= 960 && st.faceInFrame[1][1] >= 960, "9:16: a face is out of its half or the safe box");
  ok(st.parts[0].source === 1 && st.parts[1].source === 2, "the first file is not on top");
  const b = solve({ zones: Z169, sources, needs: [hook, cap(1)] }), sb = b.candidates[0];
  ok(b.candidates.length === 1 && sb.fit === "side-by-side" && !sb.hard && !sb.unmet.length, `16:9: ${b.candidates.map(nameOf)}: ${JSON.stringify(sb.problems)}`);
  ok(X1(sb.faceInFrame[0]) <= 960 && sb.faceInFrame[1][0] >= 960 && sb.faceInFrame.every((f) => inside(Z169.safe, f)), "16:9: a face is out of its half or the safe box");
  ok(sb.text.every((q) => sb.faceInFrame.every((f) => !overlap(q.box, f))), "16:9: text lies on a face");
  // neither file is enlarged into what is soft only to make the faces alike: the smaller face is
  // already as tall as published talking heads keep theirs, and a larger one earns nothing
  const hs = sb.faceInFrame.map((f) => f[3]);
  ok(sb.parts.every((q) => q.scale <= DEFAULTS.weights.enlarge.softFrom + 1e-6) && 100 * Math.min(...hs) / 1080 >= DEFAULTS.weights.subject.from, `16:9: scales ${sb.parts.map((q) => q.scale).join(" and ")}, the faces ${hs.map(Math.round).join(" and ")} px tall`);
  const c = solve({ zones: Z11, sources, needs: [cap(1)] });
  ok(c.candidates.map((q) => q.fit).sort().join() === "side-by-side,stacked" && c.candidates.every((q) => !q.hard && !q.unmet.length), `1:1: ${c.candidates.map(nameOf)}`);
  agree(st, a, "files-916-stacked"); agree(sb, b, "files-169-side"); c.candidates.forEach((q) => agree(q, c, `files-11-${q.fit}`));
  return `9:16 stacked ${st.parts.map((q) => `${q.scale}×`).join(" and ")}, faces ${st.faceInFrame.map((f) => Math.round(f[3])).join(" and ")} px; 16:9 side by side ${sb.parts.map((q) => `${q.scale}×`).join(" and ")}, faces ${hs.map(Math.round).join(" and ")} px; 1:1 first ${c.candidates[0].fit}`;
});

// =============================================================================================
console.log("\nA face that moves: its box at several moments");
// =============================================================================================
t("the upright take's face dips at 2.5 s (70 px lower, the chin at 1540 of 1920): the hull holds for the whole clip, it is 1.08× as tall as the usual box, the zoom no longer fits and a smaller picture leads; the moment at 2.5 s decides, and no text touches the face at any moment", () => {
  const at = [[0, FACE1], [1.2, [305, 572, 600, 900]], [2.5, [300, 640, 600, 900]], [3.8, [298, 568, 600, 900]], [5, FACE1]].map(([tt, box]) => ({ t: tt, box }));
  const res = solve({ zones: Z916, source: SRC1, faces: [at], needs: [cap(1)] }), c = res.candidates[0], tr = res.tracks[0];
  const still = plain1(Z916, [cap(1)]).candidates[0];
  ok(still.fit === "zoom", "the still face no longer takes the zoom");
  ok(tr.moments === 5 && tr.usual.join() === "300,570,600,900" && tr.hull.join() === "298,568,607,972", `usual ${tr.usual}, hull ${tr.hull}`);
  near(tr.growth.height, 1.08, 0.005, "the hull's height over the usual box's"); near(tr.growth.width, 1.01, 0.005, "the hull's width over the usual box's");
  ok(tr.edges.bottom === 2.5, `the hull's bottom comes from ${tr.edges.bottom} s`);
  ok(c.fit === "inset" && !c.hard && !c.unmet.length, `the first is ${nameOf(c)}: ${JSON.stringify(c.problems)}`);
  ok(tr.decides.length && tr.decides[0].t === 2.5 && tr.decides[0].edges.includes("bottom"), `decides: ${JSON.stringify(tr.decides)}`);
  // without the dip the other four moments (the face 5 px further right at 1.2 s) take a zoom again, a little over the still face's 1.07
  ok(/^zoom 1\.(0[7-9]|1[0-2]?)× /.test(tr.decides[0].without), `without 2.5 s: ${tr.decides[0].without}`);
  // every moment's box, placed as the candidate places the picture, lies in the hull's box in the frame, in the safe box, and under no text
  for (const m of at) {
    const b = [c.left + c.scale * m.box[0], c.top + c.scale * m.box[1], c.scale * m.box[2], c.scale * m.box[3]];
    ok(inside(c.faceInFrame[0], b) && inside(Z916.safe, b), `the face at ${m.t} s leaves the hull or the safe box`);
    ok(c.text.every((q) => !overlap(q.box, b)), `text touches the face at ${m.t} s`);
  }
  // the face's size counts as its usual size, not the hull's
  near(c.faceHeight, 900 * c.scale, 1, "the face's height in the ranking");
  agree(c, res, "moving-916");
  return `${nameOf(c)} at ${c.left}/${c.top} instead of ${nameOf(still)}; decides: ${tr.decides[0].t} s (${tr.decides[0].edges.join(", ")}); without it ${tr.decides[0].without}`;
});

t("a face that only sways (12 px across, 10 px down) keeps the still face's fit, the zoom a little larger (every px the cheek moves towards the buttons costs 0.6 % of zoom); a face that crosses the picture is reported as moving far", () => {
  const sway = [0, 1, 2, 3].map((i) => ({ t: i, box: [300 + (i % 2 ? 6 : -6), 570 + (i > 1 ? 5 : -5), 600, 900] }));
  const res = solve({ zones: Z916, source: SRC1, faces: [sway], needs: [cap(1)] }), c = res.candidates[0], still = plain1(Z916, [cap(1)]).candidates[0];
  ok(c.fit === still.fit && c.scale >= still.scale && c.scale - still.scale <= 0.05 && !c.hard && !c.unmet.length, `swaying: ${nameOf(c)} against ${nameOf(still)}`);
  const far = solve({ zones: Z169, source: SRC2P, faces: [[{ t: 0, box: [300, 300, 220, 300] }, { t: 4, box: [1300, 320, 220, 300] }]], needs: [cap(1)] });
  ok(far.tracks[0].growth.area > 2 && far.notes.some((n) => /moves far/.test(n)), `growth ${JSON.stringify(far.tracks[0].growth)}`);
  ok(!far.candidates[0].hard && far.candidates[0].text.every((q) => !overlap(q.box, far.candidates[0].faceInFrame[0])), "the text touches the far-moving face's hull");
  return `swaying: ${nameOf(c)} (hull ${res.tracks[0].growth.area}× the area); crossing: hull ${far.tracks[0].growth.area}× the area, noted`;
});

// =============================================================================================
console.log("\nA screen region instead of a face");
// =============================================================================================
// a 1920×1080 screen recording; the part that matters is 480×300 px, its smallest text 14 px tall
const SCREEN = [1920, 1080], REGION = [700, 300, 480, 300];
const screenOf = (zones, region, text, extra = {}) => solve({ zones, sources: [{ size: SCREEN, region, minTextHeight: 14, ...(extra.cam === "same" ? { faces: [FACEW] } : {}) }, ...(extra.cam === "file" ? [{ size: SRCW, faces: [FACEW] }] : [])], needs: text, set: extra.set });

t("into 9:16 with two caption lines: text reads from 24 px (the stated default: letters 24 px tall in a frame 1080 px wide), so the smallest zoom is 24/14 = 1.714×; the region (823×514) lies in the safe box, the screen runs to the frame's left, right and top edge and ends above the captions; the whole screen (text 7.9 px) is listed behind it as not readable", () => {
  const res = screenOf(Z916, REGION, [cap(2)]), c = res.candidates[0], whole = res.candidates.find((q) => q.fit === "screen-whole");
  ok(res.screen.readable === 24 && DEFAULTS.readable.height === 24 && DEFAULTS.readable.per === 1080, `readable: ${res.screen.readable}`);
  ok(c.fit === "screen-zoom" && !c.hard && !c.unmet.length, `the first is ${nameOf(c)}: ${JSON.stringify(c.problems)}`);
  near(c.scale, 24 / 14, 0.0002, "scale"); ok(c.textHeight >= 24 && c.textHeight < 24.1, `text ${c.textHeight} px`);
  const r = c.faceInFrame[0], cp = c.text[0];
  near(r[2], 823, 1, "the region's width"); near(r[3], 514, 1, "the region's height");
  ok(inside(Z916.safe, r), "the region is not in the safe box");
  ok(c.window[0] === 0 && c.window[2] === 1080 && c.window[1] === 0, `the screen does not run to the edges: ${c.window}`);
  ok(cp.where === "band-below" && Math.abs(Y1(cp.box) - Y1(Z916.safe)) < 0.6 && Y1(c.window) <= cp.box[1] - DEFAULTS.gap + 0.1, `the captions: ${cp.where}, y ${cp.box[1]}; the screen ends at ${Y1(c.window)}`);
  ok(c.problems.some((q) => q.code === "enlarged" && q.level === "soft"), "1.71× is not soft");
  ok(whole && whole.unmet.includes("readable") && whole.textHeight < 8 && res.candidates.indexOf(whole) > 0, "the whole screen is not listed as unreadable");
  // a larger default for what reads asks for a larger zoom
  const big = screenOf(Z916, REGION, [cap(2)], { set: { "readable.height": 20 } }).candidates[0];
  near(big.scale, 20 / 14, 0.0002, "scale with 20 px");
  agree(c, res, "screen-916-zoom"); agree(whole, res, "screen-916-whole");
  return `${c.scale}×, region x ${Math.round(r[0])}–${Math.round(X1(r))}, y ${Math.round(r[1])}–${Math.round(Y1(r))}, screen y ${c.window[1]}–${Y1(c.window)}, captions y ${Math.round(cp.box[1])}–${Math.round(Y1(cp.box))}`;
});

t("a region too large to read: 640×420 px with 16 px text would be 960×630 at the 1.5× that reads, more than the frame leaves it; the solver says so and lists the region as large as its room holds it (1.40×, text 22.5 px) as not readable", () => {
  const res = solve({ zones: Z916, sources: [{ size: SCREEN, region: [560, 300, 640, 420], minTextHeight: 16 }], needs: [cap(2)] }), c = res.candidates[0];
  ok(c.fit === "screen-fit" && c.unmet.includes("readable") && !c.hard, `the first is ${nameOf(c)}`);
  near(c.textHeight, 22.5, 0.1, "text height"); ok(res.notes.some((n) => /larger than the room/.test(n)), "no note says why");
  ok(!res.candidates.some((q) => !q.unmet.length), "a candidate claims to be readable");
  ok(inside(Z916.wide, c.faceInFrame[0]), "the region is not in the wide stretch above the buttons");
  agree(c, res, "screen-916-fit");
  return res.notes[0];
});

t("with a webcam: the circle (238 px, 22 % of the width) stands bottom left above the captions, where screencast-cut puts it, and the region moves up to keep 24 px from it; a region at the screen's bottom left takes the circle to the top left, so that the screen still fills the frame; the circle never touches the region or text", () => {
  // (the first with a circle: screen-stacked, the screen above the webcam's panel, may stand before it)
  const res = screenOf(Z916, REGION, [cap(2)], { cam: "file" }), c = res.candidates.find((q) => q.circle), k = c.circle, r = c.faceInFrame[0];
  ok(c.fit === "screen-zoom" && !c.hard && !c.unmet.length, `the first with a circle is ${nameOf(c)}: ${JSON.stringify(c.problems)}`);
  ok(k.corner === "bottom-left" && k.d === 238 && k.box[0] === Z916.safe[0] && Math.abs(Y1(k.box) - (c.text[0].box[1] - DEFAULTS.gap)) < 0.6, `the circle: ${JSON.stringify(k)}`);
  ok(Y1(r) <= k.box[1] - DEFAULTS.gap + 0.1 && inside(Z916.safe, r) && inside(Z916.safe, k.box), "the region does not keep the gap above the circle");
  ok(k.crop && k.crop[2] === 720 && k.enlargement < 1, `the circle's crop of the webcam: ${k.crop}`);
  const low = screenOf(Z916, [60, 700, 480, 300], [cap(2)], { cam: "same" }), c2 = low.candidates.find((q) => q.circle), k2 = c2.circle, r2b = c2.faceInFrame[0];
  ok(c2.fit === "screen-zoom" && !c2.hard && k2.corner === "top-left" && k2.d === 238, `region at the bottom left: ${nameOf(c2)}, circle ${JSON.stringify(k2)}`);
  ok(!overlap(k2.box, r2b) && c2.window[2] === 1080 && Y1(c2.window) >= c2.text[0].box[1] - DEFAULTS.gap - 0.1, "the screen does not fill the frame down to the captions");
  for (const q of [c, c2]) ok(q.text.every((x) => !overlap(x.box, q.circle.box) && !overlap(x.box, q.faceInFrame[0])), "text touches the circle or the region");
  agree(c, res, "screen-916-cam"); agree(c2, low, "screen-916-cam-low");
  return `circle ${k.d} px ${k.corner} at y ${Math.round(k.box[1])}–${Math.round(Y1(k.box))}, region y ${Math.round(r[1])}–${Math.round(Y1(r))}; region at the bottom left: circle ${k2.corner}`;
});

t("with a hook and a caption line the 480×400 region at 1.71× leaves the circle no corner: that candidate fails, and the largest scale with the circle (1.53×, text 21 px) is listed as not readable; in 16:9 and 4:5 the circle stands top right or, where the region is, top left", () => {
  const res = screenOf(Z916, [60, 620, 480, 400], [hook, cap(1)], { cam: "same" });
  const zoom = res.candidates.find((q) => q.fit === "screen-zoom"), fit = res.candidates.find((q) => q.fit === "screen-fit");
  ok(zoom.hard && zoom.problems.some((q) => q.code === "circle-on-region"), "the 1.71× candidate does not fail on the circle");
  ok(fit && !fit.hard && fit.unmet.join() === "readable" && fit.circle.covers === 0 && !overlap(fit.circle.box, fit.faceInFrame[0]), `the fallback: ${JSON.stringify(fit?.problems)}`);
  ok(res.candidates.indexOf(fit) < res.candidates.indexOf(zoom), "the failing candidate is not behind");
  const wide = solve({ zones: Z169, sources: [{ size: SCREEN, region: [1100, 80, 700, 420], minTextHeight: 26 }, { size: SRCW, faces: [FACEW] }], needs: [cap(1)] }), cw = wide.candidates[0];
  near(wide.screen.readable, 24 * 1920 / 1080, 0.05, "what reads in a 1920-wide frame");
  ok(cw.fit === "screen-zoom" && !cw.hard && !cw.unmet.length && cw.circle.d === 216 && cw.circle.corner === "top-left", `16:9: ${nameOf(cw)}, circle ${JSON.stringify(cw.circle)}, ${JSON.stringify(cw.problems)}`);
  const feed = solve({ zones: Z45, sources: [{ size: [2880, 1800], region: [900, 500, 1000, 640], minTextHeight: 26, faces: [FACEW] }], needs: [cap(1)] }), cf = feed.candidates[0];
  ok(cf.fit === "screen-zoom" && !cf.hard && !cf.unmet.length && cf.scale < 1 && cf.circle.d === 173 && cf.circle.corner === "top-right", `4:5: ${nameOf(cf)}, circle ${JSON.stringify(cf.circle)}`);
  agree(fit, res, "screen-916-hook-fit"); agree(cw, wide, "screen-169-cam"); agree(cf, feed, "screen-45-cam");
  return `9:16: ${res.notes[0]}; 16:9: ${cw.scale}×, circle ${cw.circle.d} px ${cw.circle.corner}; 4:5 from a 2880×1800 screen: ${cf.scale}×, circle ${cf.circle.d} px ${cf.circle.corner}`;
});

// A talk recorded as slides with the speaker's stage camera baked in at the left (1920×1080, the
// first use on real footage, 2026-11-18): the region is the slide's title and bullets, the face
// the speaker's in the baked picture.
const TALK = { size: [1920, 1080], region: [500, 40, 1340, 310], minTextHeight: 20, faces: [[130, 555, 70, 85]] };

t("a webcam baked into the screen recording (its face given with the screen's own source): the circle shows that part of the screen's picture, and where the screen's picture shows the baked speaker as well, the speaker shows twice: a soft finding (the whole slide passed it without a word); the baked face is judged and kept clear of text like any face that shows", () => {
  const res = solve({ zones: Z916, sources: [TALK], needs: [cap(1)] });
  const whole = res.candidates.find((c) => c.fit === "screen-whole"), fit = res.candidates.find((c) => c.fit === "screen-fit");
  ok(whole.circle.crop && whole.circle.crop[0] <= 130 && whole.circle.crop[0] + whole.circle.crop[2] >= 200, `the circle shows ${JSON.stringify(whole.circle.crop)} of the screen's picture`);
  ok(whole.problems.some((q) => q.code === "twice" && q.level === "soft") && whole.others.some((o) => /speaker/.test(o.of)), `the whole slide: ${JSON.stringify(whole.problems)}`);
  ok(!fit.problems.some((q) => q.code === "twice"), `the region alone shows the speaker twice: ${JSON.stringify(fit.problems)}`);
  for (const c of res.candidates) for (const o of c.others || []) ok(c.text.every((x) => !overlap(x.box, o.box)), `${nameOf(c)}: text on the baked speaker`);
  agree(whole, res, "screen-baked-whole");
  return `the whole slide: ${whole.problems.filter((q) => q.code === "twice").map((q) => q.what.split(":")[0]).join("")}; the circle crops ${whole.circle.crop.map(Math.round).join(",")} of the screen`;
});

t("a screen above, the webcam as a panel below it (screen-stacked), the common layout of a screen with a face in published Shorts: the desktop recording and the webcam of the first use on real footage (2560×1600 and 1280×720, a message as the region, its text 15 px; a caption line and a hook) gave the screen with a small circle over an empty third; now the screen stands at the size that reads in the upper half, the face below it 13 % of the frame tall at the soft limit, the caption on the seam, the hook as a card above, and it leads. A speaker baked into a talk's slides, 85 px tall, gets no panel, and the note says why", () => {
  const res = solve({ zones: Z916, sources: [{ size: [2560, 1600], region: [384, 614, 486, 160], minTextHeight: 15 }, { size: [1280, 720], faces: [[635, 415, 180, 175]] }], needs: [cap(1), hook] });
  const st = res.candidates[0];
  ok(st.fit === "screen-stacked" && !st.hard && !st.unmet.length, `the first is ${nameOf(st)}: ${JSON.stringify(st.problems)}`);
  const [region, face] = st.faceInFrame, seam = st.seam;
  ok(Y1(region) <= seam && face[1] >= seam && st.textHeight >= 24 - 0.05, `the region ends at y ${Y1(region)}, the face starts at ${face[1]}, the seam at ${seam}; text ${st.textHeight} px`);
  ok(face[3] / 1920 >= 0.13 && inside(Z916.safe, face) && inside(Z916.safe, region), `the face ${face}, the region ${region}`);
  const cp = st.text.find((x) => x.role === "caption"), hk = st.text.find((x) => x.role === "hook");
  ok(cp.where === "seam" && hk.style === "card" && Y1(hk.box) <= region[1], `caption ${cp.where}, hook ${hk.style} ending at ${Y1(hk.box)}`);
  ok(res.sources && res.sources.length === 2 && st.parts[1].source === 2, "the webcam is not the second source");
  agree(st, res, "screen-stacked");
  const talk = solve({ zones: Z916, sources: [TALK], needs: [cap(1)] });
  ok(!talk.candidates.some((c) => c.fit === "screen-stacked") && talk.notes.some((n) => /no panel under the screen/.test(n)), `the talk: ${talk.notes.join(" | ")}`);
  return `the screen at ${st.parts[0].scale}× (text ${st.textHeight} px) above y ${seam}, the face ${Math.round(face[3])} px at ${st.parts[1].scale}×; cost ${st.cost} against the circle's ${res.candidates.find((c) => c.circle)?.cost}`;
});

t("screen-stacked where its first try failed (an independent review's inputs): a tall region left the webcam at 1.5× with its face under every app's bottom bar, now the webcam goes smaller, its picture narrower than the frame where need be, and passes; a phone's screen was pinned to the frame's left edge with its region under the buttons, now its region stands in the safe box; a region too tall for a panel says so in plain numbers (it said '-598 px'); in 4:5 a note says the layout is for upright frames; a baked speaker is not reported as 'the other person'", () => {
  const cam = { size: [1280, 720], faces: [[635, 415, 180, 175]] };
  const one = (screen, z = Z916) => solve({ zones: z, sources: [screen, cam], needs: [cap(1)] });
  const tall = one({ size: [2560, 1600], region: [1000, 300, 400, 700], minTextHeight: 20 }).candidates.find((c) => c.fit === "screen-stacked");
  ok(tall && !tall.hard && !tall.unmet.length && inside(Z916.safe, tall.faceInFrame[1]), `the tall region: ${tall && JSON.stringify(tall.problems)}`);
  const phone = one({ size: [1170, 2532], region: [100, 600, 970, 800], minTextHeight: 30 }).candidates.find((c) => c.fit === "screen-stacked");
  ok(phone && !phone.hard && inside(Z916.safe, phone.faceInFrame[0]), `the phone: ${phone && `${phone.faceInFrame[0]} ${JSON.stringify(phone.problems)}`}`);
  const none = one({ size: [2560, 1600], region: [1000, 100, 400, 1400], minTextHeight: 20 });
  ok(!none.candidates.some((c) => c.fit === "screen-stacked") && none.notes.some((n) => /need \d+ px of the frame's height above the seam/.test(n)) && !none.notes.some((n) => /-\d+ px/.test(n)), none.notes.join(" | "));
  const feed = one({ size: [2560, 1600], region: [384, 614, 486, 160], minTextHeight: 15 }, Z45);
  ok(feed.notes.some((n) => /built for upright frames/.test(n)), feed.notes.join(" | "));
  const baked = solve({ zones: Z916, sources: [{ size: [2560, 1600], region: [900, 300, 500, 300], minTextHeight: 15, faces: [[100, 1100, 200, 250]] }], needs: [cap(1)] }).candidates.find((c) => c.fit === "screen-stacked");
  ok(baked && !baked.problems.some((q) => /other/.test(q.code)), `the baked speaker's panel: ${baked && JSON.stringify(baked.problems)}`);
  agree(tall, one({ size: [2560, 1600], region: [1000, 300, 400, 700], minTextHeight: 20 }), "screen-stacked-tall"); agree(phone, one({ size: [1170, 2532], region: [100, 600, 970, 800], minTextHeight: 30 }), "screen-stacked-phone");
  return `the tall region: webcam ${tall.parts[1].scale}×; the phone: region x ${Math.round(phone.faceInFrame[0][0])}–${Math.round(X1(phone.faceInFrame[0]))}`;
});

// =============================================================================================
console.log("\nFrames 4:5 (1080×1350) and 1:1 (1080×1080)");
// =============================================================================================

t("4:5 and 1:1, both takes, with two caption lines and with a hook as well: the first candidate that passes holds every face in the safe box and sets no text on a face, and centred text stays inside what the profile grid's 3:4 crop shows (in the square at most 810 px wide); where none passes (the upright take's face is 900 px tall: a hook and two lines find no room beside it in a square) the first says which need is unmet. Which fit leads in each case is written down in hand.json", () => {
  const out = [];
  for (const [Z, fr] of [[Z45, "4:5"], [Z11, "1:1"]]) for (const [tag, source, face] of [["upright", SRC1, FACE1], ["wide", SRCW, FACEW]]) for (const needs of [[cap(2)], [hook, cap(2)]]) {
    const res = solve({ zones: Z, source, faces: [face], needs }), c = res.candidates[0], what = `${fr}, the ${tag} take, ${needs.length > 1 ? "hook and " : ""}two lines`;
    if (c.hard || c.unmet.length) {
      ok(!res.candidates.some((q) => !q.hard && !q.unmet.length), `${what}: a candidate that passes stands behind one that does not`);
      ok(!c.hard && c.unmet.length, `${what}: the first is ${nameOf(c)} with ${JSON.stringify(c.problems)}`);
      out.push(`${fr} ${tag}${needs.length > 1 ? " + hook" : ""}: none passes (${c.unmet.join(", ")} unmet)`);
      continue;
    }
    const [fx, fy, fw, fh] = c.faceInFrame[0];
    ok(inside(Z.safe, [fx + 2, fy + 2, fw - 4, fh - 4]), `${what}: the face leaves the safe box`);
    ok(c.text.length === needs.length && c.text.every((x) => !overlap(x.box, c.faceInFrame[0])), `${what}: text lies on the face`);
    const grid = Z.crops.find((q) => q.ratio === "3:4");
    if (grid) ok(c.text.every((x) => x.align !== "center" || (x.box[0] >= grid.box[0] - 0.1 && X1(x.box) <= X1(grid.box) + 0.1)), `${what}: centred text is wider than the grid's crop`);
    out.push(`${fr} ${tag}${needs.length > 1 ? " + hook" : ""}: ${nameOf(c)}`);
  }
  ok(Z11.crops.some((q) => q.ratio === "3:4") && Z11.wide === null && Z45.wide === null, "the feed frames have a wide stretch now, or the square no grid crop: read platform-zones' layouts.md again");
  return out.join("; ");
});

if (!QUICK) t("4:5 and 1:1: every candidate of both takes with captions, a hook, and both, as a page: the checker passes what the solver passes, with the same findings", () => {
  const diff = [];
  let n = 0;
  for (const [fr, zones] of [["45", Z45], ["11", Z11]]) for (const [tag, source, face] of [["p1", SRC1, FACE1], ["p2", SRCW, FACEW]]) for (const [nt, needs] of [["cap1", [cap(1)]], ["hook", [hook]], ["hook-cap2", [hook, cap(2)]]]) {
    const res = solve({ zones, source, faces: [face], needs });
    res.candidates.forEach((c, i) => {
      const v = verify(c, res, `f${fr}-${tag}-${nt}-${i + 1}-${c.fit}`);
      n++;
      if (!v.cmp.agree || v.r.ok === !!c.hard) diff.push(`${fr} ${tag} ${nt} ${i + 1} ${nameOf(c)}: checker ${v.r.ok ? "passes" : "fails"}, ${JSON.stringify(v.cmp)}`);
    });
  }
  ok(!diff.length, diff.join("\n"));
  return `${n} pages`;
});

// =============================================================================================
console.log("\nA source of a shape between the frames'");
// =============================================================================================
t("a 3:4 take (1080×1440) into 9:16 with two caption lines, the face low and to the right: at the frame's width the whole take leaves the face under the apps' buttons, and no crop holds it; the take a little smaller passes, and is listed. Over a grid of faces (3:4 into 9:16, 5:4 into 1:1; a hook and two lines): wherever a smaller whole take holds the face and the text, the solver lists a candidate that passes", () => {
  const res = solve({ zones: Z916, source: [1080, 1440], faces: [[389, 634, 518, 720]], needs: [cap(2)] }), first = res.candidates[0];
  ok(first.fit === "inset" && !first.hard && !first.unmet.length && first.scale < 1, `the first is ${nameOf(first)}: ${JSON.stringify(first.problems)}`);
  // in the safe box as the checker counts it: up to 2 px past an edge is on it
  const [fx, fy, fw, fh] = first.faceInFrame[0];
  ok(inside(Z916.safe, [fx + 2, fy + 2, fw - 4, fh - 4]), `the face is not in the safe box: ${first.faceInFrame[0]}`);
  agree(first, res, "between-inset");
  // the search an independent review ran: every scale down to half, every place down the frame
  let faces = 0, none = 0, missed = [];
  for (const [Z, [sw, sh]] of [[Z916, [1080, 1440]], [Z11, [1200, 1080]]]) {
    const [W, H] = Z.size, needs = [hook, cap(2)], sc = Math.min(W / sw, H / sh);
    for (let hp = 20; hp <= 60; hp += 10) for (let ey = 25; ey <= 65; ey += 10) for (const ox of [-0.1, 0, 0.1]) {
      const fh = hp / 100 * sh, fw = 0.72 * fh, face = [sw / 2 + ox * sw - fw / 2, ey / 100 * sh - 0.42 * fh, fw, fh].map(Math.round);
      if (fw > sw * 0.95 || face[0] < 0 || face[1] < 0 || X1(face) > sw || Y1(face) > sh) continue;
      faces++;
      const r = solve({ zones: Z, source: [sw, sh], faces: [face], needs });
      if (r.candidates.some((c) => !c.hard && !c.unmet.length)) continue;
      none++;
      const ctx = { W, H, Z, D: r.defaults, sw, sh, s0: Math.max(W / sw, H / sh), faces: [face], fb: [face[0], face[1], X1(face), Y1(face)], tall: W <= H, speakerNamed: false, cap: cap(2), hook, readable: 24 };
      search: for (let k = 1; k <= 50; k++) {
        const sx = sc * (1 - k * 0.01);
        for (let top = 0; top <= H - sx * sh; top += 8) for (const left of [(W - sx * sw) / 2, Z.safe[0], X1(Z.safe) - sx * sw]) {
          if (left < 0 || left + sx * sw > W) continue;
          const c = evaluate(ctx, { fit: "inset", s: sx, left, top, win: [left, top, sx * sw, sx * sh] });
          if (!c.hard && !c.unmet.length) { missed.push(`${Z.frame} ← ${sw}×${sh}, face ${face}: an inset ${r2(sx)}× at ${Math.round(left)}/${top} passes`); break search; }
        }
      }
    }
  }
  ok(!missed.length, `${missed.length} faces have no passing candidate though a smaller whole take passes:\n${missed.slice(0, 5).join("\n")}`);
  return `${nameOf(first)} at ${first.left}/${first.top}; ${faces} faces on the grid, ${none} without any candidate that passes, none of them rescued by a smaller take`;
});

// =============================================================================================
console.log("\nA frame of another size, and boxes a pixel past a line");
// =============================================================================================
t("a frame of 720×1280 is laid out as one of 1080×1920, two thirds the size: the same fits, the picture and the text at two thirds of their px, the type two thirds as large (text set for 1080 once ran out of the smaller frame)", () => {
  // (the card: the hook as text sits on a threshold in this take, where a rounded px of type swaps two places)
  const needs = [card, cap(2)], small = solve({ zones: askZones("720x1280"), source: SRC1, faces: [FACE1], needs }), large = plain1(Z916, needs);
  ok(small.size.join("×") === "720×1280" && small.candidates.length === large.candidates.length, `${small.candidates.length} candidates in ${small.size.join("×")}, ${large.candidates.length} in 1080×1920`);
  small.candidates.forEach((c, i) => {
    const big = large.candidates[i];
    ok(c.fit === big.fit && c.unmet.join() === big.unmet.join() && !!c.hard === !!big.hard && c.text.length === big.text.length, `candidate ${i + 1}: ${nameOf(c)} against ${nameOf(big)}`);
    near(c.zoom, big.zoom, 0.011, `candidate ${i + 1}: the picture's size against covering`);
    c.text.forEach((x, k) => {
      const y = big.text[k];
      near(x.font, y.font * 2 / 3, 1, `candidate ${i + 1}: the ${x.role}'s type`);
      x.box.forEach((v, q) => near(v, y.box[q] * 2 / 3, 8, `candidate ${i + 1}: the ${x.role}'s box`));
    });
    agree(c, small, `small-frame-${i + 1}-${c.fit}`);
  });
  const c = small.candidates[0];
  return `first ${nameOf(c)}, captions at ${c.text.find((x) => x.role === "caption").font} px, hook at ${c.text.find((x) => x.role === "hook").font} px`;
});

if (!QUICK) t("a box up to 2 px past an edge of a zone counts as on it, for the solver as for the checker: three cases in which the solver alone reported a face 2 px in the safe box's margin, or a feed cutting under a tenth of a per cent of it, now get the same findings from both, candidate by candidate", () => {
  const moving = (list) => list.map(([tt, box]) => ({ t: tt, box }));
  const cases = [
    ["margin", askZones("4:5"), [640, 360], [moving([[0, [434, 72, 110, 168]], [1.5, [399, 68, 110, 168]], [3, [408, 53, 110, 168]], [4.5, [409, 67, 110, 168]], [6, [410, 64, 110, 168]]]), [258, 14, 32, 38]], [cap(1)]],
    ["grid-cut", askZones("4:5"), [720, 1280], [moving([[0, [81, 472, 374, 444]], [1.5, [21, 575, 374, 444]], [3, [70, 537, 374, 444]]])], [hook, cap(2)]],
    ["feed-cut", Z916, [3840, 2160], [[2716, 1010, 768, 1034]], [hook]],
  ];
  const diff = [];
  let n = 0;
  for (const [name, zones, source, faces, needs] of cases) {
    const res = solve({ zones, source, faces, needs });
    res.candidates.forEach((c, i) => { const v = verify(c, res, `slack-${name}-${i + 1}-${c.fit}`); n++; if (!v.cmp.agree) diff.push(`${name} ${i + 1} ${nameOf(c)}: ${JSON.stringify(v.cmp)}`); });
  }
  ok(!diff.length, diff.join("\n"));
  return `${n} pages`;
});

// =============================================================================================
console.log("\nThe commands of place.mjs");
// =============================================================================================
const TOOL = path.join(HERE, "place.mjs");
const cli = (...a) => spawnSync(process.execPath, [TOOL, ...a], { encoding: "utf8", timeout: 120e3 });
const cliWith = (env, ...a) => spawnSync(process.execPath, [TOOL, ...a], { encoding: "utf8", timeout: 120e3, env: { ...process.env, ...env } });
// one sentence for the caller: exit code 1, something said, no stack trace
const sentence = (e, what) => ok(e.status === 1 && e.stderr.trim() && !/\n\s+at /.test(e.stderr) && e.stderr.trim().split("\n").length <= 6, `${what}: exit ${e.status}${e.error ? ` (${e.error.code})` : ""}, ${e.stderr}`);
const boxArg = (b) => b.join(",");

t("place writes the candidates into the caller's folder, and captions turns a candidate's caption area into the captions skill's options: one line above the head of the upright take (--y, --max-width, --font-size, --lines), a left-aligned column beside the panel in 16:9 (--x, --align left as well)", () => {
  const a = path.join(OUT, "cli-916"), b = path.join(OUT, "cli-169");
  let r = cli("place", a, "--frame", "9:16", "--source", SRC1.join("x"), "--face", boxArg(FACE1), ...P1SET, "--text", "caption:1");
  ok(r.status === 0 && /1\. ✓ zoom/.test(r.stdout), `place: ${r.stderr || r.stdout}`);
  const res = JSON.parse(fs.readFileSync(path.join(a, "placement.json"), "utf8"));
  ok(res.candidates[0].fit === "zoom" && res.asked.frame === "9:16", "placement.json does not hold the candidates");
  r = cli("captions", a, "--json");
  const up = JSON.parse(r.stdout);
  ok(up.args.join(" ") === "--y 456 --max-width 696 --font-size 77 --lines 1", `9:16: ${up.args.join(" ")}`);
  r = cli("place", b, "--frame", "16:9", "--source", SRC1.join("x"), "--face", boxArg(FACE1), ...P1SET, "--text", "hook", "--text", "caption:2", "--json");
  ok(r.status === 0 && JSON.parse(r.stdout).candidates[0].fit === "panel", `place --json: ${r.stderr}`);
  r = cli("captions", b, "--candidate", "1");
  ok(/--x 704 --y 930 --max-width 1120 --align left --font-size 50 --lines 2/.test(r.stdout), `16:9: ${r.stdout}`);
  // what cannot be answered is said in one sentence, with exit code 1
  for (const bad of [["captions", path.join(OUT, "nothing")], ["captions", a, "--candidate", "9"], ["place", a, "--frame", "9:16"], ["place", a, "--frame", "9:16", "--source", "1080x1920", "--face", "1,2,3"]]) {
    const e = cli(...bad);
    ok(e.status === 1 && e.stderr.trim() && !/\n\s+at /.test(e.stderr), `${bad.join(" ")}: exit ${e.status}, ${e.stderr}`);
  }
  return `9:16: ${up.args.join(" ")}`;
});

if (!QUICK) t("grid draws its lines over a frame of a video at the source's size, and page writes a candidate as a page and a picture on that frame, checked by platform-zones: on a video drawn here with ffmpeg", () => {
  const dir = path.join(OUT, "cli-page"), video = path.join(OUT, "drawn.mp4"), grid = path.join(OUT, "grid.jpg");
  const ff = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=10:d=2", "-pix_fmt", "yuv420p", video], { encoding: "utf8" });
  ok(ff.status === 0, ff.error?.code === "ENOENT" ? "ffmpeg is missing: install ffmpeg, then run this again" : `ffmpeg could not draw the test video: ${ff.stderr}`);
  const size = (f) => spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", f], { encoding: "utf8" }).stdout.trim();
  let r = cli("grid", video, grid, "--at", "1");
  ok(r.status === 0 && size(grid) === "1080,1920" && /every 108 px across and every 192 px down/.test(r.stdout) && /--source 1080x1920/.test(r.stdout), `grid: ${r.stderr || r.stdout}`);
  r = cli("place", dir, "--frame", "9:16", "--source", "1080x1920", "--face", boxArg(FACE1), ...P1SET, "--text", "caption:1");
  r = cli("page", dir, "--candidate", "1,3", "--still", video, "--at", "1");
  ok(r.status === 0, `page: ${r.stderr || r.stdout}`);
  for (const f of ["candidate-1.html", "candidate-1.png", "candidate-3.html", "candidate-3.png", "still.jpg"]) ok(fs.existsSync(path.join(dir, f)), `page wrote no ${f}`);
  ok(!fs.existsSync(path.join(dir, "candidate-2.html")), "page wrote a candidate nobody asked for");
  ok(size(path.join(dir, "candidate-1.png")) === "1080,1920", `the picture is ${size(path.join(dir, "candidate-1.png"))}`);
  ok(/src="still\.jpg"/.test(fs.readFileSync(path.join(dir, "candidate-1.html"), "utf8")), "the page does not show the still");
  // the zoom passes with both, the unchanged picture fails with both
  const blocks = r.stdout.split(/\n(?=\d+\. )/).slice(1);
  ok(/^1\. ✓ zoom/.test(blocks[0]) && /checker: ✓/.test(blocks[0]) && /^3\. ✗ full/.test(blocks[1]) && /checker: ✗ face under/.test(blocks[1]), `page: ${r.stdout}`);
  // a still of another shape than the source is refused
  const wide = path.join(OUT, "wide.jpg");
  spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=1280x720", "-frames:v", "1", wide]);
  const e = cli("page", dir, "--still", wide);
  ok(e.status === 1 && /another shape/.test(e.stderr), `a wide still for an upright source: ${e.stderr || e.stdout}`);
  return "grid.jpg, candidate-1 and candidate-3 as pages and pictures";
});

t("the caption area holds the block captions builds into it. With the options the tool prints, the block of each of captions' twelve styles (its lines a style's line height apart, and what a style's box adds above and below: figures copied from its styles) ends inside the area, in the three places an independent review measured the style clean 20–24 px out at the top: above the head, below the chin, beside the panel. The area is exactly as tall as the tallest of them; a caller whose style pads more says so with caption.padEm; and an area narrower than a long word needs at its type says so in the candidate's notes", () => {
  // [line height, what the style's box adds above and below its lines, in em]
  const STYLES = { hormozi: [1.05, 0], karaoke: [1.15, 0], wipe: [1.08, 0], clean: [1.3, 0.44], bold: [1.15, 0], outline: [1.16, 0], impact: [1.02, 0], single: [1.05, 0], fill: [1.18, 0], label: [1.42, 0.2], editorial: [1.3, 0], subtitle: [1.25, 0] };
  const cases = [
    ["above the head", ["--frame", "9:16", "--source", "1080x1920", "--face", "300,570,600,900", ...P1SET, "--text", "caption:1"], "above-head"],
    ["below the chin", ["--frame", "9:16", "--source", "1080x1920", "--face", "340,400,400,560", "--text", "caption:2"], "below-chin"],
    ["beside the panel", ["--frame", "16:9", "--source", "1080x1920", "--face", "300,570,600,900", ...P1SET, "--text", "caption:2", "--text", "hook"], "beside"],
  ];
  const out = [];
  for (const [name, args, where] of cases) {
    const dir = path.join(OUT, `cli-box-${where}`);
    let r = cli("place", dir, ...args);
    ok(r.status === 0, `${name}: ${r.stderr}`);
    const j = JSON.parse(cli("captions", dir, "--json").stdout), o = j.options;
    ok(j.where === where, `${name}: the captions stand ${j.where}`);
    // what captions sets from these options: its block ends at --y and is this tall
    const tall = Object.entries(STYLES).map(([style, [line, around]]) => [style, (o.lines * line + around) * o["font-size"]]).sort((a, b) => b[1] - a[1]);
    for (const [style, built] of tall) ok(o.y - built >= j.box[1] - 0.5 && o.y <= j.box[1] + j.box[3] + 0.5, `${name}: the block of ${style} spans y ${r2(o.y - built)}–${o.y}, the area y ${j.box[1]}–${r2(j.box[1] + j.box[3])}`);
    near(j.box[3], tall[0][1], 0.2, `${name}: the area's height against the tallest block (${tall[0][0]})`);
    ok(o["max-width"] <= j.box[2] + 0.5 && (o.x === undefined || o.x >= j.box[0] - 0.5), `${name}: the block is wider than the area`);
    ok(!j.notes, `${name}: a note though the area holds a long word: ${j.notes}`);
    // a style with more padding: the area grows by it
    r = cli("place", dir, ...args, "--set", "caption.padEm=0.8", "--json");
    const more = JSON.parse(r.stdout).candidates.find((c) => c.text.some((x) => x.role === "caption")).text.find((x) => x.role === "caption");
    near(more.box[3], (more.lines * DEFAULTS.caption.line + 0.8) * more.font, 0.2, `${name}: the area's height with caption.padEm=0.8`);
    out.push(`${name}: the tallest block (${tall[0][0]}) y ${Math.round(o.y - tall[0][1])}–${o.y} in the area y ${Math.round(j.box[1])}–${Math.round(j.box[1] + j.box[3])}`);
  }
  // Pinterest's buttons leave the centred box 690 px: at 77 px type under the 9 em a long word needs
  const dir = path.join(OUT, "cli-box-narrow");
  const r = cli("place", dir, "--frame", "9:16", "--source", "1080x1920", "--face", "340,400,400,560", "--text", "caption", "--platform", "pinterest");
  const j = JSON.parse(cli("captions", dir, "--json").stdout);
  ok(r.status === 0 && j.options["max-width"] < 9 * 77 && j.notes?.length === 1 && /a word of over \d+ letters is wider than a line/.test(j.notes[0]) && /note: the captions' area/.test(r.stdout), `the narrow area: ${j.options["max-width"]} px wide, notes ${JSON.stringify(j.notes)}`);
  out.push(`for Pinterest an area of ${j.options["max-width"]} px, with a note`);
  return out.join("; ");
});

t("what the tool cannot do with its input it says in one sentence: a file where the folder goes, a face track that holds no boxes, a step of 0 (which once ran without end) or of a millionth (which ran for minutes), a default that is not there, a face past the source's edge, a CHROME that names no file", () => {
  const dir = path.join(OUT, "cli-bad"), file = path.join(OUT, "a-file.txt"), track = path.join(OUT, "track.json");
  fs.writeFileSync(file, "not a folder\n");
  const face = ["--frame", "9:16", "--source", "1080x1920", "--face", boxArg(FACE1), ...P1SET];
  let e = cli("place", file, ...face);
  sentence(e, "place <a file>"); ok(/is a file/.test(e.stderr) && fs.readFileSync(file, "utf8") === "not a folder\n", `place <a file>: ${e.stderr}`);
  for (const bad of ["null", "[null]", "{\"faces\": [[{\"t\": 0, \"box\": [1, 2, 3]}]]}", "[{\"t\": \"soon\", \"box\": [1, 2, 3, 4]}]"]) {
    fs.writeFileSync(track, bad);
    e = cli("place", dir, "--frame", "9:16", "--source", "1080x1920", "--face-track", track);
    sentence(e, `--face-track holding ${bad}`); ok(/--face-track/.test(e.stderr), `--face-track holding ${bad}: ${e.stderr}`);
  }
  for (const [set, says] of [["insetStep=0", /must be over 0/], ["zoomStep=0", /must be over 0/], ["insetStep=0.0000001", /at least 0\.001/], ["insetStpe=0.02", /no default "insetStpe"/], ["caption.font.tall=large", /is a number/], ["caption=3", /group of defaults/]]) {
    e = cli("place", dir, ...face, "--set", set);
    sentence(e, `--set ${set}`); ok(says.test(e.stderr), `--set ${set}: ${e.stderr}`);
  }
  // a face past the source's edge (once placed as if it were there)
  e = cli("place", dir, "--frame", "9:16", "--source", "1080x1920", "--face", "2000,3000,10,10");
  sentence(e, "a face outside the source"); ok(/reaches past the source of 1080×1920/.test(e.stderr), `a face outside the source: ${e.stderr}`);
  e = cli("place", dir, "--frame", "9:16", "--source", "1080x1920", "--face-at", "0:300,570,600,900", "--face-at", "2:600,570,600,900");
  sentence(e, "a moment of a moving face past the source's edge"); ok(/reaches past/.test(e.stderr), `a moving face past the edge: ${e.stderr}`);
  e = cli("place", dir, ...face, "--text", "hook:banner");
  sentence(e, "--text hook:banner"); ok(/hook:text or hook:card/.test(e.stderr), `--text hook:banner: ${e.stderr}`);
  ok(!fs.existsSync(path.join(dir, "placement.json")), "a placement was written for input that was refused");
  ok(cli("place", dir, ...face, "--set", "insetStep=0.02").status === 0, "a step of 2 % is refused");
  e = cliWith({ CHROME: path.join(OUT, "no-chrome-here") }, "page", dir);
  sentence(e, "page with a CHROME that is not there"); ok(/CHROME names/.test(e.stderr), `CHROME=/nowhere: ${e.stderr}`);
});

if (!QUICK) t("a file the caller passes in is never removed or written over: grid onto its own input is refused, a still that already lies in the placement's folder is used as it is, a file of the caller's under the frame's name is refused, not written over; and a second place clears the pages and pictures of the placement before, and nothing else in the folder", () => {
  const dir = path.join(OUT, "cli-files"), photo = path.join(OUT, "photo.jpg"), note = path.join(dir, "notes.txt"), own = path.join(dir, "grid.jpg");
  spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1080x1920", "-frames:v", "1", photo]);
  const bytes = (f) => fs.readFileSync(f).toString("base64");
  const before = bytes(photo);
  let e = cli("grid", photo, photo);
  sentence(e, "grid photo.jpg photo.jpg"); ok(fs.existsSync(photo) && bytes(photo) === before, "grid onto its input removed or changed the input");
  const face = ["--frame", "9:16", "--source", "1080x1920", "--face", boxArg(FACE1), ...P1SET];
  cli("place", dir, ...face, "--text", "caption:1");
  fs.writeFileSync(note, "mine\n");
  ok(cli("grid", photo, own).status === 0, "grid into the placement's folder failed");
  let r = cli("page", dir, "--still", photo);
  const pages = ["candidate-1.html", "candidate-1.png", "candidate-2.html", "candidate-2.png", "candidate-3.html", "candidate-3.png"];
  ok(r.status === 0 && [...pages, "still.jpg"].every((f) => fs.existsSync(path.join(dir, f))), `page: ${r.stderr || r.stdout}`);
  // the frame page put there, passed in again
  const still = path.join(dir, "still.jpg"), frame = bytes(still);
  r = cli("page", dir, "--still", still, "--candidate", "2");
  ok(r.status === 0 && fs.existsSync(still) && bytes(still) === frame, `page --still <folder>/still.jpg: exit ${r.status}, ${r.stderr}; the still is ${fs.existsSync(still) ? "there" : "gone"}`);
  ok(fs.existsSync(path.join(dir, "candidate-2.png")) && !fs.existsSync(path.join(dir, "candidate-1.html")) && !fs.existsSync(path.join(dir, "candidate-3.png")), "page left pages of its earlier call beside the one asked for");
  // a file of the caller's that bears the frame's name, not passed in: refused, not written over
  const mine = path.join(dir, "still.jpg");
  cli("place", dir, ...face, "--text", "caption:1");
  fs.copyFileSync(photo, mine);
  const other = path.join(OUT, "other.jpg");
  spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=1080x1920", "-frames:v", "1", other]);
  e = cli("page", dir, "--still", other);
  sentence(e, "page --still <another file> beside a still.jpg of the caller's"); ok(/is a file of yours/.test(e.stderr) && bytes(mine) === before, `a still.jpg of the caller's: ${e.stderr}; it is ${bytes(mine) === before ? "kept" : "changed"}`);
  fs.rmSync(mine);
  // a new placement: the old one's pages and frame go, what the caller put there stays
  cli("page", dir, "--still", photo);
  r = cli("place", dir, ...face, "--text", "hook");
  ok(r.status === 0, `the second place: ${r.stderr}`);
  const left = fs.readdirSync(dir).sort().join(", ");
  ok(left === "grid.jpg, notes.txt, placement.json", `after the second place the folder holds ${left}`);
  ok(fs.readFileSync(note, "utf8") === "mine\n", "the caller's file was changed");
  return "the input kept, the old pages cleared, the caller's files left";
});

if (!QUICK) t("a screen and its webcam as two files: page takes a still of each (it answered that a placement of a screen has one source) and shows the webcam's own picture in the circle and in the panel, cut as the candidate says; a webcam baked into the screen shows from the screen's still, and a second still is refused in one sentence", () => {
  const dir = path.join(OUT, "cli-webcam"), screen = path.join(OUT, "screen.jpg"), cam = path.join(OUT, "cam.jpg");
  spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=2560x1600", "-frames:v", "1", screen]);
  spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "smptebars=s=1280x720", "-frames:v", "1", cam]);
  let r = cli("place", dir, "--frame", "9:16", "--source", "2560x1600", "--region", "384,614,486,160", "--min-text-height", "15", "--source", "1280x720", "--face", "635,415,180,175", "--text", "caption", "--text", "hook");
  ok(r.status === 0, `place: ${r.stderr}`);
  r = cli("page", dir, "--still", screen, "--still", cam, "--candidate", "all");
  ok(r.status === 0, `page with two stills: ${r.stderr || r.stdout}`);
  const pages = fs.readdirSync(dir).filter((f) => /^candidate-\d+\.html$/.test(f)).map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
  ok(pages.some((h) => /class="cam"[^>]*><img src="still-2\.jpg"/.test(h)), "no circle shows the webcam's still");
  ok(pages.some((h) => /screen-stacked/.test(h) && /<img src="still-2\.jpg"/.test(h)), "the panel does not show the webcam's still");
  const baked = path.join(OUT, "cli-baked");
  cli("place", baked, "--frame", "9:16", "--source", "2560x1600", "--region", "900,200,1000,500", "--min-text-height", "15", "--face", "100,1200,150,180", "--text", "caption");
  r = cli("page", baked, "--still", screen, "--candidate", "all");
  ok(r.status === 0 && fs.readdirSync(baked).filter((f) => /\.html$/.test(f)).some((f) => /class="cam"[^>]*><img src="still\.jpg"/.test(fs.readFileSync(path.join(baked, f), "utf8"))), `the baked webcam: ${r.stderr}`);
  const e = cli("page", baked, "--still", screen, "--still", cam);
  sentence(e, "a second still for a baked webcam"); ok(/baked into the screen.*give one --still: the screen's/.test(e.stderr), e.stderr);
  // too many stills say which to give
  const e3 = cli("page", dir, "--still", screen, "--still", cam, "--still", cam);
  sentence(e3, "three stills for a screen and its webcam"); ok(/give one --still per source, in their order: the screen's, then the webcam's/.test(e3.stderr), e3.stderr);
  return `${pages.length} pages; the baked webcam from the screen's still`;
});

t("a webcam baked into the screen recording has one way, the one SKILL.md's table gives: its face after the screen's own --source. That command runs as written, the placement marks the webcam as baked, and the circle is cut from the screen's picture", () => {
  const row = fs.readFileSync(path.join(HERE, "..", "SKILL.md"), "utf8").split("\n").find((l) => /^\| a screen with the webcam baked in \|/.test(l));
  ok(row, "SKILL.md has no row for a webcam baked into the screen");
  const args = row.match(/`([^`]+)`/)[1].split(/\s+/), dir = path.join(OUT, "cli-baked-skill");
  const r = cli("place", dir, "--frame", "9:16", ...args, "--text", "caption", "--json");
  ok(r.status === 0, `the row's options: ${r.stderr}`);
  const j = JSON.parse(r.stdout), c = j.candidates.find((q) => q.circle);
  ok(j.sources && j.sources[1].baked && c && c.circle.crop && c.circle.of === "screen", `sources ${JSON.stringify(j.sources)}, circle ${c && JSON.stringify(c.circle)}`);
  ok(/in px of the picture `of` names: `webcam` \(the webcam's file\) or `screen`/.test(fs.readFileSync(path.join(HERE, "..", "SKILL.md"), "utf8")), "SKILL.md does not say whose px a circle's crop is in");
  return `${args.join(" ")}: the circle shows ${c.circle.crop.map(Math.round).join(",")} of the screen`;
});

t("a screen whose text reads at no size the frame leaves it: the desktop of the first use on real footage (2560×1600, a region of 900×900 with 15 px text, one caption line) passed nothing, and the advice was to ask for less text; now the note and place's last lines say that a narrower region reads, at most 517 px of the source wide (the agent had worked that out by hand), and the region it names does read", () => {
  const dir = path.join(OUT, "cli-narrow"), r = cli("place", dir, "--frame", "9:16", "--source", "2560x1600", "--region", "380,160,900,900", "--min-text-height", "15", "--text", "caption");
  ok(r.status === 0 && /None passes because the screen's text does not read .*take a narrower region \(at most 517×645 px of the source\), not less text/.test(r.stdout), r.stdout.split("\n").slice(-4).join(" | "));
  const narrow = solve({ zones: Z916, sources: [{ size: [2560, 1600], region: [380, 160, 517, 645], minTextHeight: 15 }], needs: [cap(1)] }).candidates[0];
  ok(!narrow.hard && !narrow.unmet.length, `the region of 517×645: ${nameOf(narrow)} ${JSON.stringify(narrow.problems)}`);
  return `then ${nameOf(narrow)}, text ${narrow.textHeight} px`;
});

if (!QUICK) t("a face that moves is looked at at every moment: page with a video takes every moment the boxes were read at (or the --at given), with pictures one --at each; every moment's files carry it in their names, and a second call no longer leaves only the last moment (it removed the pictures before)", () => {
  const dir = path.join(OUT, "cli-moments"), video = path.join(OUT, "take.mp4");
  spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1080x1920:d=3:r=10", "-pix_fmt", "yuv420p", video]);
  let r = cli("place", dir, "--frame", "9:16", "--source", "1080x1920", "--face-at", "0.5:340,420,400,540", "--face-at", "2:360,470,400,540", "--text", "caption");
  ok(r.status === 0, `place: ${r.stderr}`);
  r = cli("page", dir, "--still", video, "--candidate", "1");
  const files = () => fs.readdirSync(dir).sort();
  ok(r.status === 0 && ["candidate-1-at-0.5.png", "candidate-1-at-2.png", "still-at-0.5.jpg", "still-at-2.jpg"].every((f) => files().includes(f)), `page with the video: ${r.stderr || files().join(", ")}`);
  const a = path.join(OUT, "moment-a.jpg"), b = path.join(OUT, "moment-b.jpg");
  for (const [f, t] of [[a, "0.5"], [b, "2"]]) spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", t, "-i", video, "-frames:v", "1", f]);
  r = cli("page", dir, "--still", a, "--at", "0.5", "--still", b, "--at", "2", "--candidate", "1");
  ok(r.status === 0 && ["candidate-1-at-0.5.png", "candidate-1-at-2.png"].every((f) => files().includes(f)) && !files().includes("candidate-1.png"), `page with two pictures: ${r.stderr || files().join(", ")}`);
  const e = cli("page", dir, "--still", a, "--still", b);
  sentence(e, "two pictures of one source without --at"); ok(/an --at for each/.test(e.stderr), e.stderr);
  return files().filter((f) => /png$/.test(f)).join(", ");
});

t("three messages an agent misread now say what they mean: a moment that decides names what changes without it, also where the first candidate keeps its fit (it named the same fit as if it were another); the note on a crop that cannot hold an upright take's face in 16:9 gives the scales and sizes it compares; captions says that --y is the bottom of the area", () => {
  const dir = path.join(OUT, "cli-words"), track = path.join(OUT, "walk.json");
  fs.writeFileSync(track, JSON.stringify(WALK));
  let r = cli("place", dir, "--frame", "9:16", "--source", "3840x2160", "--face-track", track, "--text", "caption");
  const line = r.stdout.split("\n").find((l) => /decides:/.test(l)) || "";
  ok(/the box at [\d.]+ s, which gives the hull its .* edge\. Placed without it, (the first candidate stays crop 9:16 closer but the picture at [\d.]+× instead of [\d.]+×|another candidate would come first: )/.test(line), line);
  r = cli("captions", dir, "--candidate", "1");
  ok(/--y is the area's bottom, where the lowest line ends \(the area runs from y \d+ to \d+\)/.test(r.stdout), r.stdout.split("\n")[0]);
  const note = solve({ zones: Z169, source: [1080, 1920], faces: [[80, 250, 445, 580]], needs: [cap(1)] }).notes.find((n) => /fills the frame/.test(n)) || "";
  ok(/takes the source at 1\.78× or more \(1× of what covers the frame\), and there the face is 791×1031 px, more than the safe box's \d+×\d+; it fits the box only up to 1\.42×/.test(note), note);
  return line.trim();
});

if (!QUICK) t("the picture of a candidate is the frame down to its last row with every Chrome of this machine: one whose window is taller than its page left the lowest 87 px black", () => {
  const dir = path.join(OUT, "cli-chromes");
  cli("place", dir, "--frame", "9:16", "--source", "1080x1920", "--face", boxArg(FACE1), ...P1SET, "--text", "caption:1");
  // the Chrome platform-zones finds, and a full Chromium where playwright put one (its window counts its bars)
  const pw = path.join(os.homedir(), ".cache", "ms-playwright");
  const others = (fs.existsSync(pw) ? fs.readdirSync(pw) : []).filter((n) => /^chromium-\d+$/.test(n)).map((n) => path.join(pw, n, "chrome-linux64", "chrome")).filter((f) => fs.existsSync(f)).slice(-1);
  const pixel = (f, x, y) => spawnSync("ffmpeg", ["-v", "error", "-i", f, "-vf", `crop=1:1:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]).stdout.toString("hex");
  const seen = [];
  for (const chrome of [null, ...others]) {
    const r = chrome ? cliWith({ CHROME: chrome }, "page", dir, "--candidate", "1") : cli("page", dir, "--candidate", "1");
    const png = path.join(dir, "candidate-1.png");
    ok(r.status === 0 && fs.existsSync(png), `page with ${chrome || "the Chrome found"}: ${r.stderr || r.stdout}`);
    const size = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", png], { encoding: "utf8" }).stdout.trim();
    ok(size === "1080,1920", `the picture with ${chrome || "the Chrome found"} is ${size}`);
    // the drawn surface runs to the frame's bottom: its lowest rows are its colour, not black
    for (const [x, y] of [[540, 1915], [10, 1850], [1070, 1900]]) ok(parseInt(pixel(png, x, y), 16) > 0x202020, `with ${chrome || "the Chrome found"} the picture is black at ${x},${y} (${pixel(png, x, y)})`);
    seen.push(chrome ? path.basename(path.dirname(path.dirname(chrome))) : "the Chrome found");
  }
  return seen.join(", ");
});

console.log("\nText over a placed picture, for a whole clip (text): faces over time");
{
  const Z9 = askZones("9:16");
  const still = (box, a, b) => ({ who: "A", track: Array.from({ length: Math.round((b - a) * 10) + 1 }, (_, i) => ({ t: +(a + i / 10).toFixed(2), box })) });
  const shot = (a, b, faces, room = { free: 0 }) => ({ start: a, end: b, faces, room });
  const cap = [{ role: "caption", lines: 1 }];
  const safeBottom = Z9.safe[1] + Z9.safe[3];
  t("a face that sits high: the captions stand on the safe box's bottom, below the chin, and nothing is raised", () => {
    const r = textOverTime({ zones: Z9, shots: [shot(0, 5, [still([355, 300, 370, 500], 0, 5)])], needs: cap });
    ok(r.caption.options.y === safeBottom, `captions end at ${r.caption.options.y}, not on the safe box's bottom ${safeBottom}`);
    ok(r.caption.font === DEFAULTS.caption.font.tall && r.caption.lines === 1, `type ${r.caption.font}, ${r.caption.lines} lines`);
    ok(r.shots[0].lift === 0 && !r.conflicts.length, JSON.stringify(r.shots[0]));
    return `middle at ${r.caption.middle} %`;
  });
  t("a face that sits low: its shot is raised just enough that the captions clear the chin and the margin below it, over a ground that stays under the apps' bottom", () => {
    const r = textOverTime({ zones: Z9, shots: [shot(0, 5, [still([355, 850, 370, 500], 0, 5)])], needs: cap });
    const keepBottom = 850 + 500 + Math.max(DEFAULTS.free.belowMin, DEFAULTS.free.below * 500);
    near(r.shots[0].lift, keepBottom - r.caption.box[1], 1, "lift");
    ok(r.shots[0].ground === r.shots[0].lift && r.shots[0].lift <= 1920 - safeBottom, JSON.stringify(r.shots[0]));
    ok(r.caption.seconds === 0 && !r.conflicts.length, r.conflicts.join(" "));
    return `raised ${r.shots[0].lift} px`;
  });
  t("a tight close-up whose chin no lift can clear (the eyes would go under the apps' top): raised as far as allowed, the seconds and the share on the face named, and one sentence that says what would avoid it", () => {
    const f = [100, 0, 880, 1700];
    const r = textOverTime({ zones: Z9, shots: [shot(0, 4, [still(f, 0, 4)])], needs: cap, raise: "full" });
    near(r.shots[0].lift, Math.floor(f[1] + DEFAULTS.eyes * f[3] - Z9.safe[1]), 1, "lift: as far as the eyes allow");
    ok(r.caption.seconds >= 3.9 && r.shots[0].touches.length === 1, JSON.stringify(r.shots[0]));
    ok(!r.conflicts.length && r.notes.some((n) => /Shot 1 .*lie on A's chin or neck for 4 s, below the mouth: not avoidable without the eyes going under/.test(n)), JSON.stringify([r.conflicts, r.notes]));
    return r.notes[0].slice(0, 90) + " …";
  });
  t("moderate, the default: a close-up is raised only while the whole head stays in the picture (its box and the margin above it for the hair under the frame's top); a smaller type comes first, never below the low end of published captions (caption.font.least); where even that would cover the mouth or the lower lip, the shot goes up past the head's top (as far as the eyes allow, where that costs less than it saves) until the captions clear the mouth, said, never a fault", () => {
    // the face from y 330, 1500 px tall: the head's top 0.35 of it above the frame's top; its lips (the head's proportions: the lip line at 80 % of the box) at 1533–1573, below the safe box: no type clears them unraised
    const f = [140, 330, 800, 1500], moving = { who: "A", track: Array.from({ length: 41 }, (_, i) => ({ t: i / 10, box: [f[0], f[1] + (i % 10 < 5 ? 0 : 40), f[2], f[3]] })) };
    const r = textOverTime({ zones: Z9, shots: [shot(0, 4, [moving])], needs: cap });
    ok(r.shots[0].lift > 0 && r.shots[0].limit === "mouth" && r.shots[0].past && r.shots[0].on.mouth === 0 && r.shots[0].on.nose === 0, JSON.stringify(r.shots[0]));
    ok(r.caption.font >= DEFAULTS.caption.font.least, `type ${r.caption.font} under the floor ${DEFAULTS.caption.font.least}`);
    ok(!r.conflicts.length && r.notes.some((n) => /(lower lip for [\d.]+ s and on the chin for [\d.]+ s, not on the mouth; raised \d+ px past the head's top .*Nothing to fix|chin or neck for [\d.]+ s, below the mouth; raised \d+ px past the head's top so that they keep off the mouth)/.test(n)), JSON.stringify([r.conflicts, r.notes]));
    // a size given by hand goes below the floor
    const hand = textOverTime({ zones: Z9, shots: [shot(0, 4, [moving])], needs: cap, fixed: { font: 50 } });
    ok(hand.caption.font === 50, `--font-size 50 gave ${hand.caption.font}`);
    const full = textOverTime({ zones: Z9, shots: [shot(0, 4, [moving])], needs: cap, raise: "full" });
    ok(full.shots[0].lift > 0 && full.caption.font === DEFAULTS.caption.font.tall, JSON.stringify(full.shots[0]));
    // a face whose mouth reaches the safe box's bottom whatever the type: a conflict that says what would avoid it
    const low = textOverTime({ zones: Z9, shots: [shot(0, 4, [still([140, 500, 800, 1500], 0, 4)])], needs: cap });
    // (or above it, on the hair, where the face leaves room there)
    ok(low.notes.some((n) => /lower lip .* not avoidable at a readable size/.test(n)) || low.caption.box[1] + low.caption.box[3] <= 500, JSON.stringify([low.caption, low.notes]));
    ok(!low.conflicts.some((c) => /below the mouth/.test(c)), JSON.stringify(low.conflicts));
    // the eyes and the nose: a hard limit at every size, said as a conflict
    const nose = textOverTime({ zones: Z9, shots: [shot(0, 4, [still([140, 650, 800, 1300], 0, 4)])], needs: cap });
    ok(nose.conflicts.some((c) => /nose or eyes/.test(c)) || nose.caption.box[1] + nose.caption.box[3] <= 650, JSON.stringify([nose.caption, nose.conflicts]));
  });
  t("where the caller knows the eyes, nose and mouth (feat), the mouth line is their bottom, not a share of the box: a mouth low in its box keeps the captions lower or smaller, one high in it lets them stand on the chin", () => {
    const box = [140, 330, 800, 1500], track = (feat) => ({ who: "A", track: Array.from({ length: 41 }, (_, i) => ({ t: i / 10, box, feat })) });
    // the features ending at 1250 (the mouth high in its box, 61 %): the usual type clears it
    const high = textOverTime({ zones: Z9, shots: [shot(0, 4, [track([300, 700, 480, 550])])], needs: cap });
    ok(high.caption.font === DEFAULTS.caption.font.tall && !high.conflicts.length, JSON.stringify([high.caption, high.conflicts]));
    // the features ending at 1400 (the mouth low, 71 %): no readable type clears it on the safe box's bottom: the lower lip, said
    const low = textOverTime({ zones: Z9, shots: [shot(0, 4, [track([300, 760, 480, 640])])], needs: cap });
    ok(low.notes.some((n) => /lower lip .* not avoidable at a readable size|past the head's top so that they keep off the mouth/.test(n)) || low.caption.box[1] + low.caption.box[3] <= 330, JSON.stringify([low.caption, low.notes, low.conflicts]));
    ok(!low.conflicts.length && low.shots[0].on.mouth === 0 && low.shots[0].on.nose === 0, JSON.stringify(low.shots[0]));
  });
  t("a tight close-up whose eyes stand at the apps' top bar already: no raise can free its mouth, and captions over the whole mouth are a fault (✗) with what would avoid it, never 'the lower lip, nothing to fix' (the review's case: the whole caption area between the nose line and the lower lip)", () => {
    // the features from 260 to 1500: the nose line at 1128, the lip line at 1351, the eyes at 260, 10 px below the safe box's top; the smallest readable area reaches from 1334
    const box = [140, 100, 800, 1500], feat = [300, 260, 480, 1240];
    const r = textOverTime({ zones: Z9, shots: [shot(0, 4, [{ who: "A", track: Array.from({ length: 41 }, (_, i) => ({ t: i / 10, box, feat })) }])], needs: cap });
    ok(r.shots[0].on.mouth > 3.9 && r.shots[0].fault === "mouth", JSON.stringify(r.shots[0]));
    ok(r.conflicts.some((c) => /cover A's mouth for 4 s .* What would avoid it: a cut to another shot here, or a smaller type by hand/.test(c)), JSON.stringify(r.conflicts));
    ok(!r.notes.some((n) => /Nothing to fix/.test(n)), JSON.stringify(r.notes));
  });
  t("a smaller type comes before a raise past the head's top: where the floor's type keeps off the mouth, the head stays whole", () => {
    // the lip line at 1320: the usual type's area (from 1306) would cover the mouth, 69 px (from 1320) does not
    const box = [140, 100, 800, 1500], feat = [300, 400, 480, 1045];
    const r = textOverTime({ zones: Z9, shots: [shot(0, 4, [{ who: "A", track: Array.from({ length: 41 }, (_, i) => ({ t: i / 10, box, feat })) }])], needs: cap });
    ok(r.caption.font < DEFAULTS.caption.font.tall && !r.shots[0].past && r.shots[0].lift === 0 && r.shots[0].on.mouth === 0, JSON.stringify([r.caption.font, r.shots[0]]));
  });
  t("the three levels on one tight close-up: head keeps the whole head (type to its floor, the lower lip said), mouth goes past the head's top until the mouth is clear (the default), full until the chin is clear; each shot says how far the frame cuts the head", () => {
    // the lip line at 1328, the mouth line at 1490, the eyes at 800; the head's top over the frame's top already
    const box = [140, 300, 800, 1500], feat = [300, 800, 480, 600];
    const run = (raise) => textOverTime({ zones: Z9, shots: [shot(0, 4, [{ who: "A", track: Array.from({ length: 41 }, (_, i) => ({ t: i / 10, box, feat })) }])], needs: cap, ...(raise ? { raise } : {}) });
    const head = run("head"), mouth = run(), full = run("full");
    ok(head.shots[0].lift === 0 && head.caption.font < DEFAULTS.caption.font.tall && head.shots[0].on.mouth === 0 && head.shots[0].headCut.byLift === 0 && !head.conflicts.length, JSON.stringify([head.caption.font, head.shots[0]]));
    ok(head.notes.some((n) => /lower lip .*with the whole head kept\. Nothing to fix; --raise mouth/.test(n)), JSON.stringify(head.notes));
    ok(mouth.raise === "mouth" && mouth.shots[0].past && mouth.shots[0].on.mouth === 0 && mouth.shots[0].on.lip === 0 && mouth.shots[0].headCut.byLift === mouth.shots[0].lift, JSON.stringify(mouth.shots[0]));
    ok(full.shots[0].lift >= mouth.shots[0].lift && full.shots[0].headCut.px >= mouth.shots[0].headCut.px, JSON.stringify([full.shots[0], mouth.shots[0].lift]));
    ok(run("moderate").raise === "mouth", "moderate is mouth");
    // a mouth the floor's type still covers: under head a fault that names --raise mouth
    const low = textOverTime({ zones: Z9, raise: "head", shots: [shot(0, 4, [{ who: "A", track: Array.from({ length: 41 }, (_, i) => ({ t: i / 10, box, feat: [300, 800, 480, 650] })) }])], needs: cap });
    ok(low.shots[0].lift === 0 && low.conflicts.some((c) => /cover A's mouth .*--raise mouth/.test(c)), JSON.stringify([low.shots[0], low.conflicts]));
    return `head ${head.caption.font} px unraised, mouth ${mouth.caption.font} px raised ${mouth.shots[0].lift} px, full raised ${full.shots[0].lift} px`;
  });
  t("mouth, the default, raises a close-up no further than the eyes at 27 % of the height (the upper end of where published Shorts have them): where the mouth clears only above that line, the shot stays below it, a smaller type where that helps, and the captions lie on the lower lip, said; full goes on to the apps' top bar", () => {
    // the eyes at 600: 82 px above them to the line at 518; the mouth line at 1520 would need some 200
    const box = [140, 200, 800, 1500], feat = [300, 600, 480, 800];
    const run = (raise) => textOverTime({ zones: Z9, shots: [shot(0, 4, [{ who: "A", track: Array.from({ length: 41 }, (_, i) => ({ t: i / 10, box, feat })) }])], needs: cap, ...(raise ? { raise } : {}) });
    const m = run(), f = run("full");
    ok(m.shots[0].eyes >= DEFAULTS.eyeLine - 1e-3 && m.shots[0].on.mouth === 0 && m.shots[0].on.lip > 0 && m.caption.font >= DEFAULTS.caption.font.least && !m.conflicts.length, JSON.stringify([m.caption.font, m.shots[0], m.conflicts]));
    ok(m.notes.some((n) => /lower lip for [\d.]+ s .*not avoidable at a readable size/.test(n)), JSON.stringify(m.notes));
    ok(f.shots[0].eyes < DEFAULTS.eyeLine && f.shots[0].lift > m.shots[0].lift, JSON.stringify(f.shots[0]));
    return `mouth: eyes at ${Math.round(m.shots[0].eyes * 100)} %, ${m.caption.font} px, the lower lip ${m.shots[0].on.lip} s; full: eyes at ${Math.round(f.shots[0].eyes * 100)} %`;
  });
  t("the note for captions on the lower lip says a smaller type would clear it only where one does, at the size computed for that shot: a close-up whose lip reaches below the captions' bottom gets no such promise (the review's case: 62 px still touched the lip)", () => {
    const one = (box, feat, raise) => textOverTime({ zones: Z9, ...(raise ? { raise } : {}), shots: [shot(0, 4, [{ who: "A", track: Array.from({ length: 41 }, (_, i) => ({ t: i / 10, box, feat })) }])], needs: cap });
    const lipNote = (r) => r.notes.find((n) => /lower lip for/.test(n)) || "";
    // the eyes at 600, the mouth line at 1520 (as the test before): the lower lip down to 1520, past
    // the captions' bottom at 1440, and the shot cannot go higher: no type clears it
    const none = one([140, 200, 800, 1500], [300, 600, 480, 800]);
    ok(none.shots[0].on.lip > 0 && none.shots[0].clearsAt === 0, JSON.stringify(none.shots[0]));
    ok(/no smaller type would: the lower lip reaches down to y \d+ and the captions end at y \d+/.test(lipNote(none)) && !/--font-size/.test(lipNote(none)), lipNote(none));
    // the whole head kept, the mouth line at 1475 (35 px below the captions' bottom): none either,
    // and --raise mouth (which clears it, past the head's top) is named
    const head = one([140, 300, 800, 1500], [300, 800, 480, 587], "head");
    ok(head.shots[0].on.lip > 0 && head.shots[0].clearsAt === 0 && /--raise mouth/.test(lipNote(head)) && /no smaller type would/.test(lipNote(head)), JSON.stringify([head.shots[0], lipNote(head)]));
    // where a size is named, it is true: that size at the same place and lift clears the lip, one px more does not
    const some = textOverTime({ zones: Z9, raise: "head", shots: [shot(0, 4, [{ who: "A", track: Array.from({ length: 41 }, (_, i) => ({ t: i / 10, box: [140, 300, 800, 1500], feat: [300, 800, 480, 520] })) }])], needs: cap });
    const s = some.shots[0], n = s.clearsAt;
    ok(s.on.lip > 0 && n > 0 && n < some.caption.font && new RegExp(`${n} px or less \\(--font-size ${n}\\)`).test(lipNote(some)), JSON.stringify([s, lipNote(some)]));
    const at = (font) => textOverTime({ zones: Z9, raise: "head", fixed: { y: some.caption.options.y, font, lifts: { 0: s.lift } }, shots: [shot(0, 4, [{ who: "A", track: Array.from({ length: 41 }, (_, i) => ({ t: i / 10, box: [140, 300, 800, 1500], feat: [300, 800, 480, 520] })) }])], needs: cap }).shots[0];
    ok(at(n).on.lip === 0 && at(n + 1).on.lip > 0, JSON.stringify([n, at(n).on, at(n + 1).on]));
    return `none: lip ${none.shots[0].on.lip} s; head: lip ${head.shots[0].on.lip} s; a lip that clears at ${n} px (of ${some.caption.font})`;
  });
  t("a clip without a face (a screen shown whole, b-roll): the captions stand on the safe box's bottom at the usual type and say why (no-face), the hook in the middle, a card where the picture is not calm", () => {
    const r = textOverTime({ zones: Z9, shots: [{ start: 0, end: 30, picture: [0, 392, 1080, 676], faces: [], room: null }], needs: [...cap, { role: "hook", start: 0.4, end: 3.4, calm: false }] });
    ok(r.caption.where === "no-face" && r.caption.options.y === safeBottom && r.caption.font === DEFAULTS.caption.font.tall && !r.conflicts.length && !r.notes.length, JSON.stringify([r.caption, r.notes, r.conflicts]));
    ok(r.hook && r.hook.kind === "card" && r.hook.box[1] + r.hook.box[3] <= r.caption.box[1] && /not calm/.test(r.hook.kindWhy), JSON.stringify(r.hook));
    const face = textOverTime({ zones: Z9, shots: [shot(0, 5, [still([355, 300, 370, 500], 0, 5)])], needs: cap });
    ok(face.caption.where === "below-chin", face.caption.where);
    return `captions y ${r.caption.box[1]}–${r.caption.options.y}, hook ${r.hook.kind} y ${r.hook.box[1]}–${r.hook.box[1] + r.hook.box[3]}`;
  });
  t("a lower lip from features that are an estimate between two stills (the caller's between) is said as one, with the stills: a mouth that opens there is not seen", () => {
    const run = (between) => textOverTime({ zones: Z9, raise: "head", shots: [shot(0, 4, [{ who: "A", track: Array.from({ length: 41 }, (_, i) => ({ t: i / 10, box: [140, 300, 800, 1500], feat: [300, 800, 480, 520], ...(between && i > 5 && i < 35 ? { between: [0.5, 3.5] } : {}) })) }])], needs: cap });
    const est = run(true), plain = run(false), note = (r) => r.notes.find((x) => /lower lip for/.test(x)) || "";
    ok(est.shots[0].on.lipEst > 0 && est.shots[0].on.lipEst < est.shots[0].on.lip && JSON.stringify(est.shots[0].touches[0].stills) === "[[0.5,3.5]]", JSON.stringify(est.shots[0]));
    ok(/s of it between the stills at 0\.5 and 3\.5 s, where the mouth's place is an estimate/.test(note(est)) && !/between the stills/.test(note(plain)) && plain.shots[0].on.lipEst === undefined, `${note(est)} | ${note(plain)}`);
    // the place is the same: the estimate is said, not weighed
    ok(est.caption.options.y === plain.caption.options.y && est.caption.font === plain.caption.font, JSON.stringify([est.caption, plain.caption]));
    return `${est.shots[0].on.lipEst} s of ${est.shots[0].on.lip} s on the lower lip from an estimate`;
  });
  t("the returns of one framing (the camera cuts back to the same close-up) stand at one height: the one that needs most sets it for all", () => {
    const close = (a, b, y) => shot(a, b, [still([355, y, 370, 500], a, b)]);
    const r = textOverTime({ zones: Z9, shots: [close(0, 3, 840), close(3, 6, 300), close(6, 9, 870), close(9, 12, 300), close(12, 15, 850)], needs: cap });
    const lifts = r.shots.map((s) => s.lift);
    ok(lifts[0] > 0 && lifts[0] === lifts[2] && lifts[2] === lifts[4] && lifts[1] === 0, lifts.join(", "));
    ok(r.caption.seconds === 0, `${r.caption.seconds} s on a face`);
  });
  t("a hook that finds no place clear of the faces keeps the calm rule (a card over a picture that is not calm) and says why", () => {
    const big = [still([60, 250, 960, 1250], 0, 4)];
    const r = textOverTime({ zones: Z9, shots: [shot(0, 4, big, null)], needs: [...cap, { role: "hook", start: 0, end: 3, calm: false }] });
    ok(r.hook && (r.hook.kind === "card" || r.hook.where !== "middle") && r.hook.kindWhy && r.hook.kindWhy.length > 10, JSON.stringify(r.hook));
  });
  t("a hook over a picture that is not calm (the caller says hook.calm false: a wide shot with hands, a photo) is a card in the text's place, and says why", () => {
    const r = textOverTime({ zones: Z9, shots: [shot(0, 5, [still([355, 300, 370, 500], 0, 5)])], needs: [...cap, { role: "hook", start: 0, end: 3, calm: false }] });
    ok(r.hook.kind === "card" && r.hook.where === "below-chin" && /not calm/.test(r.hook.kindWhy), JSON.stringify(r.hook));
    ok(2 * DEFAULTS.hookCard.line * r.hook.font <= r.hook.box[3], `card type ${r.hook.font} in ${r.hook.box[3]} px`);
  });
  t("two shots that disagree (a face high, a face low): one place for the clip, each shot raised for itself, no change of place proposed", () => {
    const r = textOverTime({ zones: Z9, shots: [shot(0, 4, [still([355, 300, 370, 500], 0, 4)]), shot(4, 9, [still([355, 850, 370, 500], 4, 9)])], needs: cap });
    ok(r.shots[0].lift === 0 && r.shots[1].lift > 0, r.shots.map((s) => s.lift).join(", "));
    ok(r.caption.seconds === 0 && !r.changes.length, JSON.stringify(r.changes));
  });
  t("a shot that cannot be raised (shown whole) with a low face, beside one that can: the place stays one, and the shot shown whole keeps its seconds on the face; with a long one, a place of its own is proposed, not taken", () => {
    const r = textOverTime({ zones: Z9, shots: [shot(0, 10, [still([300, 300, 480, 900], 0, 10)]), shot(10, 20, [still([355, 950, 370, 400], 10, 20)], { none: true })], needs: cap });
    ok(r.shots[1].lift === 0 && r.shots[1].touches.length, JSON.stringify(r.shots[1]));
    ok(r.changes.length === 1 && r.changes[0].shot === 1 && r.notes.some((n) => /proposed, not taken/.test(n)), JSON.stringify(r.changes));
  });
  t("a face that moves under the captions inside a shot: the shot is raised for its lowest moment, once for the whole shot", () => {
    const track = Array.from({ length: 41 }, (_, i) => ({ t: i / 10, box: [355, 300 + (i / 40) * 550, 370, 500] }));
    // (head: a raise that keeps the whole head; mouth would also hold the eyes below 27 % of the height, which this face, high at first, reaches)
    const r = textOverTime({ zones: Z9, shots: [shot(0, 4, [{ who: "A", track }])], needs: cap, raise: "head" });
    const keepBottom = 850 + 500 + Math.max(DEFAULTS.free.belowMin, DEFAULTS.free.below * 500);
    near(r.shots[0].lift, keepBottom - r.caption.box[1], 1, "lift for the lowest moment");
    ok(r.caption.seconds === 0, `${r.caption.seconds} s on the face`);
    const fixed = textOverTime({ zones: Z9, shots: [shot(0, 4, [{ who: "A", track }])], needs: cap, fixed: { lifts: { 0: 0 } } });
    ok(fixed.shots[0].lift === 0 && fixed.caption.seconds >= 0.2 && fixed.caption.seconds < 3, `a lift fixed at 0: ${fixed.caption.seconds} s on the face, only where it is low`);
  });
  t("faces low in every shot and nothing that can be raised: the captions go above the heads", () => {
    const r = textOverTime({ zones: Z9, shots: [shot(0, 6, [still([355, 1000, 370, 400], 0, 6)], null)], needs: cap });
    ok(r.caption.box[1] + r.caption.box[3] <= 1000 - DEFAULTS.free.above * 400 + 1 && r.caption.seconds === 0, JSON.stringify(r.caption));
    ok(r.caption.where === "above-head", r.caption.where);
  });
  t("the hook on the first shot: a short text below the chin, above the captions, while the face is high", () => {
    const r = textOverTime({ zones: Z9, shots: [shot(0, 5, [still([355, 300, 370, 500], 0, 5)])], needs: [...cap, { role: "hook", start: 0, end: 3 }] });
    ok(r.hook && r.hook.kind === "text" && r.hook.where === "below-chin" && r.hook.until === 3, JSON.stringify(r.hook));
    ok(r.hook.box[1] >= 300 + 500 && r.hook.box[1] + r.hook.box[3] <= r.caption.box[1], `hook ${r.hook.box} between chin 800 and captions ${r.caption.box[1]}`);
  });
  t("a hook over two stretches of the shots' clock (a line heard twice opens the short): placed against the faces of both, not of what lies between", () => {
    // 0–4 s and 10–14 s: a face high (room below its chin); 4–10 s: a face that fills the middle, shown between the two stretches only
    const shots = [shot(0, 4, [still([355, 300, 370, 500], 0, 4)]), shot(4, 10, [still([60, 700, 960, 900], 4, 10)], null), shot(10, 14, [still([355, 300, 370, 500], 10, 14)])];
    const r = textOverTime({ zones: Z9, shots, needs: [...cap, { role: "hook", start: 1, end: 12, spans: [[10, 12], [1, 2.5]] }] });
    ok(r.hook && r.hook.kind === "text" && r.hook.where === "below-chin" && !r.hook.onFace, JSON.stringify(r.hook));
  });
  t("the first shot changes within the hook's time to one that leaves it no place: the hook ends at the cut", () => {
    const r = textOverTime({ zones: Z9, shots: [shot(0, 2, [still([355, 300, 370, 500], 0, 2)]), shot(2, 6, [still([60, 250, 960, 1000], 2, 6)], null)], needs: [{ role: "hook", start: 0, end: 3.5 }] });
    ok(r.hook && r.hook.until === 2 && /ends at the cut/.test(r.hook.why), JSON.stringify(r.hook));
  });
  t("a take filmed too close leaves the hook no place: it goes where it lies on no eyes, nose or mouth (a card on the forehead before a text on the mouth, though that covers less of the face), said; hook:text is a wish: it does not put the text on the mouth while the card clears it, and says it took the card (the review: hook:text and hook:card put hooks on eyes, nose or mouth for 3.1 s where main had none)", () => {
    // best-takes' tight stand-in, raised: the head from y 200, 1100 px tall, the eyes, nose and mouth 620–1150
    const f = { who: "A", track: Array.from({ length: 51 }, (_, i) => ({ t: i / 10, box: [130, 200, 820, 1100], feat: [270, 620, 540, 530] })) };
    const r = textOverTime({ zones: Z9, shots: [shot(0, 5, [f])], needs: [...cap, { role: "hook", start: 0, end: 3 }] });
    ok(r.hook && r.hook.kind === "card" && r.hook.where === "top" && r.hook.onFace.features === 0 && r.hook.onFace.seconds > 0, JSON.stringify(r.hook));
    ok(r.conflicts.some((c) => /on the forehead or the hair, never on the eyes, nose or mouth/.test(c)), r.conflicts.join(" "));
    const t2 = textOverTime({ zones: Z9, shots: [shot(0, 5, [f])], needs: [...cap, { role: "hook", kind: "text", start: 0, end: 3 }] });
    ok(t2.hook.kind === "card" && t2.hook.onFace.features === 0 && t2.hook.asked === "text" && t2.notes.some((n) => /The hook is a card, not the text asked for/.test(n)), JSON.stringify([t2.hook, t2.notes]));
    // the review's synthetic s4 with hook:card (a face high, room below the chin): the text there clears the face, the card does not
    const high = { who: "A", track: Array.from({ length: 41 }, (_, i) => ({ t: i / 10, box: [390 + (i % 7) * 3, 300 + (i % 5) * 4, 300, 400] })) };
    const c4 = textOverTime({ zones: Z9, shots: [shot(0, 4, [high])], needs: [...cap, { role: "hook", kind: "card", start: 0, end: 3 }] });
    ok(!(c4.hook.onFace?.seconds > 0), JSON.stringify(c4.hook));
  });
  t("captions above a head that fills the frame leave the hook only their own place: they give way to the next place that leaves it better off and lies on the faces no longer (best-takes' own phone take: the captions above the head, the hook's card over them), said; a --caption-y the caller fixed stays", () => {
    // the phone take as read off its grid: the face from y 690 to the chin at 1470, the head's top at 570
    const f = { who: "A", track: Array.from({ length: 51 }, (_, i) => ({ t: i / 10, box: [330, 690, 540, 780] })) };
    const alone = textOverTime({ zones: Z9, shots: [shot(0, 5, [f])], needs: cap });
    const r = textOverTime({ zones: Z9, shots: [shot(0, 5, [f])], needs: [...cap, { role: "hook", start: 0, end: 3 }] });
    ok(alone.caption.where === "above-head", `without a hook the captions stand ${alone.caption.where}`);
    ok(r.caption.where === "below-chin" && r.shots[0].lift > 0 && r.caption.seconds === 0, JSON.stringify(r.caption));
    ok(r.hook && !(inter(r.hook.box, r.caption.box) > 0) && !(r.hook.onFace?.seconds > 0), JSON.stringify(r.hook));
    ok(r.notes.some((n) => /The captions stand with their middle at [\d.]+ % of the height, not at [\d.]+ %/.test(n)), r.notes.join(" "));
    const kept = textOverTime({ zones: Z9, shots: [shot(0, 5, [f])], needs: [...cap, { role: "hook", start: 0, end: 3 }], fixed: { y: alone.caption.options.y } });
    ok(kept.caption.options.y === alone.caption.options.y, JSON.stringify(kept.caption.options));
  });
  t("the captions never pay for the hook: a hook already on no face is not given its margin by a smaller type for the whole video (the review's s5: 77 px became 69 px for it), and they give way only to a place that keeps their type", () => {
    const f = { who: "A", track: Array.from({ length: 41 }, (_, j) => ({ t: +(j / 10).toFixed(2), box: [200 + (j % 7) * 3, 900 + (j % 5) * 4, 680, 900], feat: [200 + 0.18 * 680, 900 + 0.38 * 900, 0.64 * 680, 0.48 * 900] })) };
    const alone = textOverTime({ zones: Z9, shots: [shot(0, 4, [f])], needs: cap });
    const r = textOverTime({ zones: Z9, shots: [shot(0, 4, [f])], needs: [...cap, { role: "hook", start: 0, end: 3 }] });
    ok(r.caption.font === alone.caption.font && r.caption.font === DEFAULTS.caption.font.tall, `type ${r.caption.font} with the hook, ${alone.caption.font} without`);
    ok(!(r.hook.onFace?.seconds > 0), JSON.stringify(r.hook));
  });
  t("the command: text writes text.json and lists every shot; a --lift fixes one shot; a wrong --lift and a shots file without tracks are refused in one sentence", () => {
    const dir = fs.mkdtempSync(path.join(OUT, "text-")), file = path.join(dir, "shots.json");
    fs.writeFileSync(file, JSON.stringify({ shots: [shot(0, 4, [still([355, 300, 370, 500], 0, 4)]), shot(4, 8, [still([355, 850, 370, 500], 4, 8)])], hook: { start: 0, end: 2.5 } }));
    let r = cli("text", dir, "--frame", "9:16", "--shots", file, "--text", "caption", "--text", "hook");
    ok(r.status === 0 && /shot 2 .*raised \d+ px/.test(r.stdout) && /hook: a text/.test(r.stdout), r.stdout + r.stderr);
    const j = JSON.parse(fs.readFileSync(path.join(dir, "text.json"), "utf8"));
    ok(j.caption.options.y === safeBottom && j.shots.length === 2, JSON.stringify(j.caption));
    r = cli("text", dir, "--frame", "9:16", "--shots", file, "--lift", "2:0");
    ok(r.status === 0 && /shot 2 .*as it stands {2}on the chin/.test(r.stdout) && /not avoidable without a larger lift than the one fixed/.test(r.stdout), r.stdout);
    r = cli("text", dir, "--frame", "9:16", "--shots", file, "--lift", "5:10");
    ok(r.status === 1 && r.stderr.trim().split("\n").length === 1 && /--lift is <shot>:<px>/.test(r.stderr), r.stderr);
    // captions below the safe box, where the apps lay their own text: refused in one sentence
    r = cli("text", dir, "--frame", "9:16", "--shots", file, "--caption-y", "1750");
    ok(r.status === 1 && r.stderr.trim().split("\n").length === 1 && /below the safe box's bottom \(y \d+ .*give \d+ or less/.test(r.stderr), r.stderr);
    fs.writeFileSync(file, JSON.stringify({ shots: [{ start: 0, end: 2, faces: [{ who: "A" }] }] }));
    r = cli("text", dir, "--frame", "9:16", "--shots", file);
    ok(r.status === 1 && /"track"/.test(r.stderr), r.stderr);
  });
}

console.log("\nLarge type in one area over a placed picture (text --text area): faces over time");
{
  const Z9 = askZones("9:16"), C = Z9.centred, bottom = C[1] + C[3], H = 1920, least = bottom - DEFAULTS.area.least * H;
  // a face held still for a shot: its box and its eyes, nose and mouth (feat)
  const still = (box, feat, a, b, who = "A") => ({ who, track: Array.from({ length: Math.round((b - a) * 10) + 1 }, (_, i) => ({ t: +(a + i / 10).toFixed(2), box, feat })) });
  const shot = (a, b, faces, room = { free: 0 }) => ({ start: a, end: b, faces, room });
  const mouthLine = (feat) => feat[1] + feat[3] * 1.15;
  const usual = 1025;
  t("a face high above it: the area stands at the caller's usual top, nothing raised, on no face", () => {
    const r = areaOverTime({ zones: Z9, shots: [shot(0, 5, [still([390, 250, 300, 380], [450, 390, 180, 180], 0, 5)])], area: { top: usual } });
    ok(r.area.top === usual && r.area.lower === 0 && r.area.bottom === bottom, JSON.stringify(r.area));
    ok(r.shots[0].lift === 0 && !r.shots[0].touches.length && !r.conflicts.length, JSON.stringify(r.shots[0]));
    return `y ${r.area.top}–${r.area.bottom}`;
  });
  t("a close-up whose mouth reaches into the usual area: the area goes lower, just below the mouth line (an open mouth's room included), before any shot is raised; the chin under it is said, not a fault", () => {
    const feat = [380, 560, 320, 420];
    const r = areaOverTime({ zones: Z9, shots: [shot(0, 5, [still([250, 250, 580, 900], feat, 0, 5)])], area: { top: usual } });
    ok(r.area.top >= mouthLine(feat) && r.area.top < mouthLine(feat) + 0.006 * H, `top ${r.area.top}, the mouth line ${mouthLine(feat)}`);
    ok(r.shots[0].lift === 0 && !r.conflicts.length && r.shots[0].on.chin > 4.9, JSON.stringify(r.shots[0]));
    ok(r.notes.some((n) => /chin or neck for 5 s, below the mouth/.test(n)) && r.notes.some((n) => /px below its usual top/.test(n)), r.notes.join(" | "));
    return `lowered ${r.area.lower} px`;
  });
  t("a mouth below the smallest area's top: the area at its least (area.least of the height), the shot raised once by its lowest moment as far as the mouth needs (raise full); with raise mouth the eyes stop it at the eye line and what is left is a ✗ that names --raise full", () => {
    // the eyes at 29 % of the height, the mouth line (an open mouth's room in it) at 65 % and 68 %
    const feat = (dy) => [380, 560 + dy, 320, 600], box = (dy) => [250, 300 + dy, 580, 1000];
    const moving = { who: "A", track: Array.from({ length: 41 }, (_, i) => { const dy = i % 10 < 5 ? 0 : 60; return { t: i / 10, box: box(dy), feat: feat(dy) }; }) };
    const full = areaOverTime({ zones: Z9, shots: [shot(0, 4, [moving])], area: { top: usual }, raise: "full" });
    near(full.area.top, least, 0.5, "the area's top");
    near(full.shots[0].lift, Math.ceil(mouthLine(feat(60)) - full.area.top), 1, "lift by the lowest moment");
    ok(!full.conflicts.length && full.shots[0].on.mouth === 0 && full.shots[0].on.lip === 0, JSON.stringify(full));
    const mouth = areaOverTime({ zones: Z9, shots: [shot(0, 4, [moving])], area: { top: usual } });
    near(mouth.shots[0].lift, Math.floor(560 - DEFAULTS.eyeLine * H), 1, "lift as far as the eye line");
    ok(mouth.shots[0].fault && mouth.conflicts.some((c) => /Shot 1 .*lies on A's (mouth|lower lip).* --raise full/.test(c)), mouth.conflicts.join(" | "));
    return `raised ${full.shots[0].lift} px (full), ${mouth.shots[0].lift} px (mouth)`;
  });
  t("two shots that disagree: one area for both, only the close-up raised; a wide shot shown whole is never raised and its face under the area is a ✗", () => {
    const close = still([250, 380, 580, 960], [380, 700, 320, 420], 4, 9, "B");
    const r = areaOverTime({ zones: Z9, shots: [shot(0, 4, [still([390, 250, 300, 380], [450, 390, 180, 180], 0, 4)]), shot(4, 9, [close])], area: { top: usual }, raise: "full" });
    ok(r.shots[0].lift === 0 && r.shots[1].lift > 0 && !r.conflicts.length, JSON.stringify(r.shots.map((s) => [s.lift, s.on])));
    const whole = areaOverTime({ zones: Z9, shots: [shot(0, 4, [close], null)], area: { top: usual }, raise: "full" });
    ok(whole.shots[0].lift === 0 && whole.conflicts.length === 1 && !/--raise/.test(whole.conflicts[0]), whole.conflicts.join(" | "));
    return `top ${r.area.top}, raised ${r.shots[1].lift} px`;
  });
  t("returns of one close-up stand at one height, that of the one that needs most", () => {
    const a = still([250, 380, 580, 960], [380, 700, 320, 420], 0, 3), b = still([250, 400, 580, 960], [380, 720, 320, 420], 6, 9);
    const r = areaOverTime({ zones: Z9, shots: [shot(0, 3, [a]), shot(3, 6, [still([390, 250, 300, 380], [450, 390, 180, 180], 3, 6, "B")]), shot(6, 9, [b])], area: { top: usual }, raise: "full" });
    ok(r.shots[0].lift === r.shots[2].lift && r.shots[0].lift > 0, JSON.stringify(r.shots.map((s) => s.lift)));
  });
  t("a clip without a face: the usual top, said as no-face", () => {
    const r = areaOverTime({ zones: Z9, shots: [shot(0, 5, [])], area: { top: usual } });
    ok(r.area.top === usual && r.area.where === "no-face" && !r.notes.length, JSON.stringify(r.area));
  });
  t("the command: --text area writes text.json and a list; it stands alone, its top inside what the area may be, its bottom above the apps' text", () => {
    const dir = path.join(OUT, "area"), shots = path.join(OUT, "area-shots.json");
    fs.writeFileSync(shots, JSON.stringify({ shots: [shot(0, 4, [still([250, 380, 580, 960], [380, 700, 320, 420], 0, 4)])] }));
    const r = cli("text", dir, "--frame", "9:16", "--shots", shots, "--text", "area", "--area-top", "1025", "--raise", "full");
    ok(r.status === 0 && /the type: one area for the clip, x \d+–\d+, y \d+–1440/.test(r.stdout) && /shot 1 .*raised \d+ px/.test(r.stdout) && fs.existsSync(path.join(dir, "text.json")), r.stdout + r.stderr);
    const both = cli("text", dir, "--frame", "9:16", "--shots", shots, "--text", "area", "--text", "caption");
    ok(both.status !== 0 && /--text area stands alone/.test(both.stdout + both.stderr), both.stdout + both.stderr);
    const top = cli("text", dir, "--frame", "9:16", "--shots", shots, "--text", "area", "--top", "1300");
    ok(top.status !== 0 && /a top of 1300 is outside what the area may be/.test(top.stdout + top.stderr), top.stdout + top.stderr);
    const low = cli("text", dir, "--frame", "9:16", "--shots", shots, "--text", "area", "--area-bottom", "1600");
    ok(low.status !== 0 && /--area-bottom 1600 is below the safe box's bottom/.test(low.stdout + low.stderr), low.stdout + low.stderr);
    const capt = cli("text", dir, "--frame", "9:16", "--shots", shots, "--text", "caption", "--top", "1100");
    ok(capt.status !== 0 && /--top belongs to --text area/.test(capt.stdout + capt.stderr), capt.stdout + capt.stderr);
  });
}

console.log("\nMaterial beside the speaker (beside): a field for a card, the speaker in a field of its own");
// =============================================================================================
// The wide interview of the first use on real footage (1280×720, the face 555,150,180,195) and a
// card that needs at least 600×340 px, one caption line.
const WIDE = { source: [1280, 720], face: [555, 150, 180, 195] }, CARD = { min: [600, 340] };
const beside = (Z, o = {}) => besideSolve({ zones: Z, source: o.source || WIDE.source, face: o.face || WIDE.face, material: o.material || CARD, needs: o.needs || [cap(1)], before: o.before || null, set: o.set || {} });
const inBox = (o, i, slack = 2.5) => i[0] >= o[0] - slack && i[1] >= o[1] - slack && i[0] + i[2] <= o[0] + o[2] + slack && i[1] + i[3] <= o[1] + o[3] + slack;
const inSafe = (Z, b) => inBox(Z.safe, b) || (Z.wide && inBox(Z.wide, b));
const meetsMin = (c, min) => c.material.field[2] >= min[0] - 0.5 && c.material.field[3] >= min[1] - 0.5;
// what holds for every candidate that passes: the material's field has its size and lies in the
// safe box, the face lies in the safe box and in the speaker's field, the captions touch neither
function sane(Z, c, min = CARD.min) {
  const [W, H] = Z.size, out = [];
  if (!meetsMin(c, min)) out.push(`the field ${c.material.field} is under ${min}`);
  if (!inSafe(Z, c.material.field)) out.push(`the field ${c.material.field} leaves the safe box`);
  if (!inSafe(Z, c.speaker.face)) out.push(`the face ${c.speaker.face} leaves the safe box`);
  if (!inBox(c.speaker.field, c.faceInFrame[1], 0.5)) out.push(`the face ${c.faceInFrame[1]} leaves its field ${c.speaker.field}`);
  for (const t of c.text) for (const b of c.faceInFrame) if (inter(t.box, b) > 0) out.push(`the caption ${t.box} lies on ${b}`);
  if (inter(c.material.field, c.speaker.field) > 0 && c.arrangement !== "pip") out.push("the material's field lies on the speaker's");
  if (c.speaker.scale > 1.5 + 1e-9) out.push(`the speaker enlarged ${c.speaker.scale}×`);
  if (!(c.material.field[0] >= 0 && c.material.field[1] >= 0 && c.material.field[0] + c.material.field[2] <= W && c.material.field[1] + c.material.field[3] <= H)) out.push("the field leaves the frame");
  return out;
}
const fitsOf = (r) => r.candidates.map((c) => `${c.fit}${c.side ? ` ${c.side}` : ""} ${c.hard ? "✗" : c.unmet.length ? "–" : "✓"}`).join(", ");

t("each frame gives the arrangement it should first, and every candidate passes with the card's field at its size: 9:16, 4:5 and 1:1 the material above and the speaker as a panel below, the captions on the seam, the circle second; 16:9 the speaker as a column at one side first, the panel below only where the field keeps its size, the circle last. In 9:16 the face is held at 15 % by the 720p source's soft limit (18 % is the usual below a screen), in 4:5 and 1:1 it reaches 18 %", () => {
  const out = [];
  for (const [Z, first, n] of [[Z916, "beside-above", 2], [Z45, "beside-above", 2], [Z11, "beside-above", 2], [Z169, "beside-column", 3]]) {
    const r = beside(Z), c = r.candidates[0];
    ok(c.fit === first && r.candidates.length === n, `${Z.frame}: ${fitsOf(r)}`);
    ok(r.candidates.at(-1).fit === "beside-pip", `${Z.frame}: the circle is not last: ${fitsOf(r)}`);
    for (const k of r.candidates) { ok(!k.hard && !k.unmet.length, `${Z.frame} ${k.fit}: ${JSON.stringify(k.problems)}`); const bad = sane(Z, k); ok(!bad.length, `${Z.frame} ${k.fit}: ${bad.join("; ")}`); }
    if (c.arrangement === "above") ok(c.captions.where === "seam" && Math.abs(c.captions.box[1] + c.captions.box[3] / 2 - c.seam) < 0.6, `${Z.frame}: the caption is not on the seam: ${JSON.stringify(c.captions)} seam ${c.seam}`);
    out.push(`${Z.frame} field ${Math.round(c.material.field[2])}×${Math.round(c.material.field[3])}, face ${c.speaker.facePct} %`);
  }
  near(beside(Z916).candidates[0].speaker.facePct, 15.3, 0.2, "9:16's face");
  for (const Z of [Z45, Z11]) near(beside(Z).candidates[0].speaker.facePct, 18, 0.2, `${Z.frame}'s face`);
  return out.join("; ");
});

t("a face high in the source (its hairline at 10 px) and one low (its chin at 695 of 720): in every frame the panel or column holds it whole in its field and in the safe box, the captions stay out of the margin above the head, and the arrangement does not change", () => {
  for (const face of [[555, 10, 180, 195], [555, 500, 180, 195]]) for (const Z of [Z916, Z45, Z11, Z169]) {
    const r = beside(Z, { face }), c = r.candidates[0];
    ok(!c.hard && !c.unmet.length, `${Z.frame} face ${face}: ${fitsOf(r)} ${JSON.stringify(c.problems)}`);
    const bad = sane(Z, c); ok(!bad.length, `${Z.frame} face ${face}: ${bad.join("; ")}`);
    for (const tx of c.text) ok(!(inter(tx.box, keepOut(c.faceInFrame[1], DEFAULTS)) > 0), `${Z.frame} face ${face}: the caption lies in the head's margin`);
    ok(c.fit === beside(Z).candidates[0].fit, `${Z.frame} face ${face}: ${c.fit}`);
  }
});

t("a face at the source's edge (the upright take's, x 80 of 1080, and a wide take's at x 5): the picture cannot cover its field with the face in the safe box, so it stands smaller or moved with ground beside it, says so, and passes; the face is never cut", () => {
  const out = [];
  for (const [source, face] of [[[1080, 1920], [80, 250, 445, 580]], [[1280, 720], [5, 150, 180, 195]]]) for (const Z of [Z916, Z169]) {
    const r = beside(Z, { source, face }), c = r.candidates[0];
    ok(!c.hard && !c.unmet.length, `${Z.frame} ${source}: ${JSON.stringify(c.problems)}`);
    const bad = sane(Z, c); ok(!bad.length, `${Z.frame} ${source}: ${bad.join("; ")}`);
    ok(!c.problems.some((q) => q.code === "cut"), `${Z.frame} ${source}: the face is cut`);
    out.push(`${Z.frame} ${source.join("×")}: ${c.fit}, ground ${c.speaker.ground}`);
    if (c.speaker.ground) ok(c.why.some((w) => /ground beside the speaker/.test(w)), `${Z.frame}: the ground is not said`);
  }
  return out.join("; ");
});

t("a material field that cannot be given is said in one sentence with what can be, and the best candidates come back with their problems (an independent review: a calling skill needs an answer every time; it exited before): 1000×900 in 9:16, 800×700 in 1:1, a panel (shape rect) among them; a card too tall for the panel but not for the circle (600 px of height in 1:1, where the panel keeps the face at 12 % up to 549) gets the circle first, and the note says up to which height the panel keeps the face at 12 %", () => {
  for (const [frame, min] of [["9:16", "1000x900"], ["1:1", "800x700"]]) {
    const e = cli("beside", path.join(OUT, "beside-none"), "--frame", frame, "--source", "1280x720", "--face", "555,150,180,195", "--material-min", min, "--text", "caption");
    const line = e.stdout.split("\n").find((l) => /^note: No arrangement/.test(l)) || "";
    ok(e.status === 0 && /^note: No arrangement gives the material a field of \d+×\d+ px in .*: the most is \d+×\d+ px .*; ask for a smaller field, or show the material alone for its seconds\.$/.test(line), e.stdout + e.stderr);
    const res = JSON.parse(fs.readFileSync(path.join(OUT, "beside-none", "placement.json"), "utf8"));
    ok(res.noField && res.candidates.length && res.candidates.every((c) => c.unmet.includes("material")) && res.candidates.some((c) => c.speaker.shape === "rect"), fitsOf(res));
  }
  const r = beside(Z11, { material: { min: [600, 600] } });
  ok(r.candidates[0].fit === "beside-pip", fitsOf(r));
  ok(r.notes.some((n) => /holds the face at 12 % .* at most \d+×\d+ px/.test(n)), r.notes.join(" | "));
  return `1:1, 600×500: ${fitsOf(r)}; ${r.limits.above?.says || "no panel"}`;
});

t("a picture of fixed size (a 1920×1080 screenshot) gets the largest box of its shape: in 9:16 960×540 above the panel (screen-stacked gave it 828 wide), its scale given; a small one stays at 1.5× of its pixels", () => {
  const c = beside(Z916, { material: { fixed: [1920, 1080], min: [828, 466] } }).candidates[0];
  near(c.material.field[2], 960, 0.5, "the width"); near(c.material.field[3], 540, 0.5, "the height"); near(c.material.scale, 0.5, 0.001, "the scale");
  const small = beside(Z916, { material: { fixed: [320, 180] } }).candidates[0];
  ok(!small.hard && small.material.scale === 1.5, JSON.stringify(small.material));
});

t("the change from full-frame: in 16:9 the column keeps the scale the speaker had full-frame (1.5×: the picture is only cut to the column and moved, the face moves across, not up or down); in 9:16 the panel keeps the face where it was across (no sideways jump) and gives the numbers to animate (before and after: scale, left, top, window, face)", () => {
  const col = beside(Z169, { before: { scale: 1.5, left: 0, top: 0 } }).candidates[0];
  ok(col.change.face.zoom === 1 && Math.abs(col.change.face.dy) < 1 && /same scale/.test(col.change.says), JSON.stringify(col.change));
  const up = beside(Z916, { before: { scale: 1.875, left: -650, top: 0, window: [0, 285, 1080, 1350] } }).candidates[0];
  ok(Math.abs(up.change.face.dx) < 1, JSON.stringify(up.change));
  for (const k of ["scale", "left", "top", "window", "face"]) ok(up.change.before[k] !== undefined && up.change.after[k] !== undefined, `the change lacks ${k}`);
  ok(JSON.stringify(up.change.before.window) === "[0,285,1080,1350]" && JSON.stringify(up.change.after.window) === JSON.stringify(up.speaker.field), JSON.stringify(up.change));
  return `16:9: ${col.change.says}; 9:16: ${up.change.says}`;
});

t("the column never enlarges the footage past the soft limit to cover itself (an independent review: 1280×570, the face at its top, gave the column at 1.89× first): at 1.5× it stands with ground beside it, and no candidate goes past 1.5×", () => {
  const r = beside(Z169, { source: [1280, 570], face: [555, 0, 180, 195] });
  for (const c of r.candidates) ok(c.speaker.scale <= 1.5 + 1e-9, `${c.fit} at ${c.speaker.scale}×`);
  const col = r.candidates.find((c) => c.arrangement === "column");
  ok(col.speaker.ground > 0 && !col.hard, JSON.stringify(col.speaker));
  return fitsOf(r);
});

t("the circle is judged as a disc, with the margin above a head (an independent review: 724×720 with the face at the footage's left edge had 26 % of the face's box outside the disc and passed; 40 random circles had the head's top outside): its crop stays on the face, ground where the footage ends, and over faces at every edge no circle that passes leaves a face corner or the head's top outside its disc", () => {
  const inDisc = (c) => { const f = c.faceInFrame[1], b = c.speaker.field, r = b[2] / 2, cx = b[0] + r, cy = b[1] + r, top = f[1] - Math.max(DEFAULTS.free.aboveMin, DEFAULTS.free.above * f[3]); return [[f[0], f[1]], [f[0] + f[2], f[1]], [f[0], f[1] + f[3]], [f[0] + f[2], f[1] + f[3]], [f[0] + f[2] / 2, top]].every(([x, y]) => Math.hypot(x - cx, y - cy) <= r + 1); };
  const pip = beside(Z916, { source: [724, 720], face: [0, 150, 180, 195] }).candidates.find((c) => c.arrangement === "pip");
  ok(inDisc(pip) && !pip.hard && pip.speaker.ground > 0, JSON.stringify(pip.speaker));
  let n = 0;
  for (const Z of [Z916, Z45, Z169]) for (const face of [[0, 0, 180, 195], [1100, 0, 180, 195], [0, 525, 180, 195], [1100, 525, 180, 195], [555, 0, 180, 195], [400, 300, 300, 420]]) {
    const c = beside(Z, { face }).candidates.find((k) => k.arrangement === "pip");
    if (!c.hard) { ok(inDisc(c), `${Z.frame} ${face}: the face leaves the disc: ${JSON.stringify(c.faceInFrame[1])} in ${c.speaker.field}`); n++; }
    else ok(c.problems.some((q) => q.code === "cut" && /circle/.test(q.what)), `${Z.frame} ${face}: ${JSON.stringify(c.problems)}`);
  }
  return `${n} circles pass, all inside their disc`;
});

t("a panel's picture that cannot cover its field fills it from the middle, not from where the face was full-frame (an independent review: the upright take's picture stood at x 122–765 in the 9:16 panel, 315 px of ground on the right): in 9:16, 4:5 and 1:1 the ground beside it is the same on both sides", () => {
  const out = [];
  for (const Z of [Z916, Z45, Z11]) {
    const c = beside(Z, { source: [1080, 1920], face: [80, 250, 445, 580] }).candidates.find((k) => k.arrangement === "above"), w = c.speaker.window, f = c.speaker.field;
    const left = w[0] - f[0], right = f[0] + f[2] - (w[0] + w[2]);
    ok(!c.hard && Math.abs(left - right) <= 1, `${Z.frame}: ground ${Math.round(left)} px left, ${Math.round(right)} px right`);
    out.push(`${Z.frame} ${Math.round(left)}|${Math.round(right)}`);
  }
  return out.join(", ");
});

t("a picture of fixed size is shown at most at the soft limit of its pixels, and the arrangement that shows it largest comes first (an independent review: --material 400x225 in 9:16 was blown up 2.3–2.4×, every candidate ✗, no word what to do; 1080x1920 put the panel first with a 295×525 field where the circle gives 561×997)", () => {
  const small = beside(Z916, { material: { fixed: [400, 225] } });
  for (const c of small.candidates) { ok(!c.hard && c.material.scale <= 1.5 + 1e-9, `${c.fit}: ${c.material.scale}× ${JSON.stringify(c.problems)}`); }
  const need = beside(Z916, { material: { fixed: [400, 225], min: [800, 400] } });
  ok(need.notes.some((n) => /^the picture of 400×225 stays sharp up to 600×337 px .*give a larger picture of it, or a smaller --material-min$/.test(n)), need.notes.join(" | "));
  const tall = beside(Z916, { material: { fixed: [1080, 1920] } }), [a, b] = tall.candidates;
  ok(a.arrangement === "pip" && a.material.field[2] * a.material.field[3] > 1.5 * b.material.field[2] * b.material.field[3] && /under two thirds as large/.test(b.behind), `${fitsOf(tall)}: ${b.behind}`);
  return `1080×1920: ${Math.round(a.material.field[2])}×${Math.round(a.material.field[3])} with the circle first`;
});

t("sharpness in two steps, as b-roll's owner settled it on built videos (beside.faceUpTo=2, beside.wish=0.22, weights.enlarge.softFrom=1.25): the wish holds where the footage stays under 1.25× (4K: 22 %), gives way to as much as stays under it (1080p: 19 % at 1.25×), and the base 18 % holds up to 2×, reported as soft (720p: 18 % at 1.77×, soft); nothing past 2× (a face 60 px tall in 720p: under the base, said). A caller that passes nothing gets what it got before (720p: 15 % at 1.5×)", () => {
  const BR = { "beside.faceUpTo": 2, "beside.wish": 0.22, "weights.enlarge.softFrom": 1.25 };
  const at = (source, face) => beside(Z916, { source, face, set: BR }).candidates.find((c) => c.arrangement === "above");
  const k4 = at([3840, 2160], [1660, 440, 360, 390]), hd = at([1920, 1080], [830, 220, 270, 295]), sd = at([1280, 720], [555, 150, 180, 195]), tiny = at([1280, 720], [600, 150, 55, 60]);
  near(k4.speaker.facePct, 22, 0.2, "4K"); ok(k4.speaker.scale <= 1.25, `4K at ${k4.speaker.scale}`);
  near(hd.speaker.scale, 1.25, 0.001, "1080p's scale"); ok(hd.speaker.facePct > 18 && hd.speaker.facePct < 22 && /the wish of 22 % needs the footage at 1\.43×/.test(hd.notes.join(" ")), JSON.stringify(hd.speaker.target));
  near(sd.speaker.facePct, 18, 0.2, "720p"); ok(sd.problems.some((q) => q.code === "enlarged" && q.level === "soft") && !sd.hard, JSON.stringify(sd.problems));
  ok(tiny.speaker.scale <= 2 + 1e-9 && tiny.speaker.facePct < 18 && /past 2×/.test(tiny.notes.join(" ")), JSON.stringify([tiny.speaker.scale, tiny.notes]));
  ok(sd.speaker.target.asked.wish === 22 && sd.speaker.target.given === sd.speaker.facePct && sd.speaker.target.enlargement === 1.77, JSON.stringify(sd.speaker.target));
  const plain = beside(Z916).candidates[0];
  near(plain.speaker.facePct, 15.3, 0.2, "nothing passed"); near(plain.speaker.scale, 1.5, 1e-4, "nothing passed, the scale");
  return `4K ${k4.speaker.facePct} %, 1080p ${hd.speaker.facePct} %, 720p ${sd.speaker.facePct} % at ${sd.speaker.scale}×`;
});

t("the captions' band comes from captions itself: its area.json (or the six values), or a style it measures by its build; the candidate says which (b-roll's two lines of hormozi are 202 px, the layout skill's own band 234 px)", () => {
  const dir = path.join(OUT, "beside-band"), area = path.join(OUT, "area.json");
  fs.writeFileSync(area, JSON.stringify({ left: 192, width: 696, top: 1238, bottom: 1440, size: 96, lines: 2 }));
  const base = ["--frame", "9:16", "--source", "1080x1920", "--face", "300,500,480,655", "--material-min", "700x330"];
  const read = () => JSON.parse(fs.readFileSync(path.join(dir, "placement.json"), "utf8")).candidates;
  let r = cli("beside", dir, ...base, "--caption-area", area);
  ok(r.status === 0, r.stderr); let c = read();
  ok(c[0].captions.box[3] === 202 && c[0].captions.font === 96 && /area\.json/.test(c[0].captions.band) && c.find((k) => k.arrangement === "pip").captions.box[1] === 1238, JSON.stringify(c[0].captions));
  r = cli("beside", dir, ...base, "--caption-area", "192,696,1238,1440,96,2");
  ok(r.status === 0 && read()[0].captions.box[3] === 202 && /six values/.test(read()[0].captions.band), r.stderr);
  r = cli("beside", dir, ...base, "--text", "caption:2", "--caption-style", "hormozi");
  ok(r.status === 0 && read()[0].captions.box[3] === 202 && /style hormozi, 2 lines/.test(read()[0].captions.band), r.stderr || JSON.stringify(read()[0].captions));
  r = cli("beside", dir, ...base, "--text", "caption:2");
  ok(r.status === 0 && Math.round(read()[0].captions.box[3]) === 234 && /layout skill's own/.test(read()[0].captions.band), JSON.stringify(read()[0].captions));
  for (const [opt, v, says] of [["--caption-area", "1,2,3", /no caption area|cannot be read/], ["--caption-style", "nosuch", /could not measure the style "nosuch"/]]) { const e = cli("beside", dir, ...base, opt, v); sentence(e, `${opt} ${v}`); ok(says.test(e.stderr), e.stderr); }
});

t("in 16:9 the column goes to the side from which the speaker looks at the material: a face left of the source's middle looks right, the column stands left; one right of it stands right; one in the middle left, and the reason says it could not tell", () => {
  const l = beside(Z169, { face: [200, 150, 180, 195] }).candidates[0], r = beside(Z169, { face: [900, 150, 180, 195] }).candidates[0], m = beside(Z169).candidates[0];
  ok(l.side === "left" && l.looks === "right" && r.side === "right" && r.looks === "left" && m.side === "left" && m.looks === null, `${l.side}/${l.looks} ${r.side}/${r.looks} ${m.side}/${m.looks}`);
  ok(r.material.field[0] + r.material.field[2] <= r.speaker.field[0] && m.why.some((w) => /tells no look/.test(w)), JSON.stringify([r.material.field, r.speaker.field]));
});

t("in 16:9 the column's side can be fixed (beside.side) and the captions left where they stand (beside.captions=stay: across the frame's foot, over the column too), as b-roll does it; the material then ends above them; a wrong value is one sentence", () => {
  const c = beside(Z169, { set: { "beside.side": "right", "beside.captions": "stay" } }).candidates[0];
  ok(c.fit === "beside-column" && c.side === "right" && c.captions.where === "stay" && Math.abs(c.captions.box[0] + c.captions.box[2] / 2 - 960) < 1 && c.material.field[1] + c.material.field[3] <= c.captions.box[1] - 23 && !c.hard, JSON.stringify([c.side, c.captions, c.material.field, c.problems]));
  ok(c.why.some((w) => /as asked \(beside\.side\)/.test(w)), c.why.join(" | "));
  const e = cli("beside", path.join(OUT, "beside-side"), "--frame", "16:9", "--source", "1280x720", "--face", "555,150,180,195", "--material-min", "600x340", "--set", "beside.side=up");
  sentence(e, "beside.side=up"); ok(/look, left or right/.test(e.stderr), e.stderr);
});

t("speaker.scale, left and top place the footage itself (frame px per footage px, its top left corner in frame px); speaker.host gives the same placement as a transform of the footage filling the frame (as b-roll moves its host): both put the face on the same px", () => {
  for (const [Z, source, face] of [[Z916, [1280, 720], [555, 150, 180, 195]], [Z169, [1080, 1920], [80, 250, 445, 580]], [Z45, [1920, 1080], [830, 220, 270, 295]]]) for (const c of beside(Z, { source, face }).candidates) {
    const [W, H] = Z.size, k = Math.max(W / source[0], H / source[1]), ox = (W - k * source[0]) / 2, oy = (H - k * source[1]) / 2, h = c.speaker.host;
    const viaHost = [h.left + h.scale * (ox + k * face[0]), h.top + h.scale * (oy + k * face[1])], own = [c.speaker.left + c.speaker.scale * face[0], c.speaker.top + c.speaker.scale * face[1]];
    ok(Math.abs(viaHost[0] - own[0]) < 1 && Math.abs(viaHost[1] - own[1]) < 1 && Math.abs(own[0] - c.speaker.face[0]) < 0.6, `${Z.frame} ${c.fit}: ${viaHost} against ${own}`);
  }
});

t("a caller without a face's box passes --face assumed: the usual framing of a talking head (a fifth of the frame tall, in the middle, a third down, as the footage covers the frame), and every candidate says that the box was assumed", () => {
  const dir = path.join(OUT, "beside-assumed");
  const r = cli("beside", dir, "--frame", "9:16", "--source", "1080x1920", "--face", "assumed", "--material-min", "600x340", "--text", "caption");
  ok(r.status === 0 && /^note: the face's box was assumed/m.test(r.stdout), r.stderr || r.stdout);
  const res = JSON.parse(fs.readFileSync(path.join(dir, "placement.json"), "utf8"));
  ok(JSON.stringify(res.speaker.face) === "[396,448,288,384]" && res.speaker.assumed && res.candidates.every((c) => c.speaker.assumed) && res.candidates[0].why.some((w) => /assumed/.test(w)), JSON.stringify(res.speaker));
});

t("named platforms give beside their own boxes, as they give every other skill (b-roll builds for reels, or reels and tiktok): reels, tiktok, shorts, reels+tiktok in 9:16 and youtube in 16:9, each with the wide interview and b-roll's close-up; every candidate passes and is sane in those zones; with reels alone the face ends lower and the panel's field is wider than with the usual apps; as pages, the checker for those platforms agrees with the solver on every one", () => {
  let n = 0;
  const lower = (Z) => beside(Z, { source: [1080, 1920], face: [300, 500, 480, 655], material: { min: [700, 330] }, needs: [cap(2)] }).candidates[0];
  ok(lower(askZones("9:16", ["reels"])).speaker.face[1] + lower(askZones("9:16", ["reels"])).speaker.face[3] > lower(Z916).speaker.face[1] + lower(Z916).speaker.face[3] + 30, "reels alone does not let the face end lower");
  for (const [frame, platforms] of [["9:16", ["reels"]], ["9:16", ["tiktok"]], ["9:16", ["shorts"]], ["9:16", ["reels", "tiktok"]], ["16:9", ["youtube"]]]) {
    const Z = askZones(frame, platforms);
    for (const take of [{}, { source: [1080, 1920], face: [300, 500, 480, 655], material: { min: [700, 330] }, needs: [cap(2)] }]) {
      const r = beside(Z, take);
      for (const c of r.candidates) {
        ok(!c.hard && !c.unmet.length, `${platforms} ${c.fit}: ${JSON.stringify(c.problems)}`);
        const bad = sane(Z, c, take.material?.min || CARD.min); ok(!bad.length, `${platforms} ${c.fit}: ${bad.join("; ")}`);
        if (!QUICK) {
          const file = path.join(OUT, `beside-${platforms.join("-")}-${n}.html`);
          fs.writeFileSync(file, renderBeside(c, r, { page: file }));
          const cmp = compare(c, checkPage(file, platforms));
          ok(cmp.verdictAgrees && cmp.agree, `${file}: solver only ${cmp.onlySolver}; checker only ${cmp.onlyChecker}`);
        }
        n++;
      }
    }
  }
  return `${n} candidates${QUICK ? "" : ", each checked as a page"}`;
});

if (!QUICK) t("a band from captions is drawn on the page as tall as it is (an independent review: two lines at 96 px were drawn 250 px tall into a 202 px band, ran onto the card, and the checker failed what the solver passed; 78 of 81 disagreements had a caption area): the caller's case and five other caption areas, every candidate's page gets the solver's verdict and findings", () => {
  const BR = { "beside.faceUpTo": 2, "beside.wish": 0.22, "weights.enlarge.softFrom": 1.25 }, Zrt = askZones("9:16", ["reels", "tiktok"]);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const areas = [{ left: 180, width: 720, top: 1238, bottom: 1440, size: 96, lines: 2 }];
  for (let i = 0; i < 5; i++) { const lines = rnd() < 0.5 ? 1 : 2, size = Math.round(60 + 40 * rnd()), bottom = Math.round(1380 + 60 * rnd()), left = Math.round(180 + 40 * rnd()); areas.push({ left, width: 900 - left, top: Math.round(bottom - lines * size * (1.05 + 0.2 * rnd())), bottom, size, lines }); }
  let n = 0;
  for (const [k, a] of areas.entries()) {
    const r = besideSolve({ zones: Zrt, source: [1080, 1920], face: [300, 500, 480, 655], material: { min: [700, 330] }, needs: [cap(2)], set: BR, captionArea: { ...a, from: "test" } });
    for (const [i, c] of r.candidates.entries()) {
      const file = path.join(OUT, `beside-area-${k}-${i + 1}.html`);
      fs.writeFileSync(file, renderBeside(c, r, { page: file }));
      const cmp = compare(c, checkPage(file, ["reels", "tiktok"]));
      ok(cmp.verdictAgrees && cmp.agree, `${JSON.stringify(a)} ${c.fit}: solver only ${cmp.onlySolver}; checker only ${cmp.onlyChecker}`);
      n++;
    }
  }
  return `${n} pages`;
});

t("captions that stay in 16:9 (beside.captions=stay) keep the column's face above them, so that solver and checker agree and the caller who asked for it gets a column that passes (an independent review: 720×1280, the face 48,312,636,719, column right: the solver failed text on the face, the checker passed)", () => {
  let n = 0;
  for (const [source, face] of [[[720, 1280], [48, 312, 636, 719]], [[1080, 1920], [80, 250, 445, 580]], [[1280, 720], [555, 330, 180, 195]]]) for (const side of ["left", "right"]) {
    const r = beside(Z169, { source, face, set: { "beside.side": side, "beside.captions": "stay" } }), c = r.candidates.find((k) => k.arrangement === "column");
    ok(!c.hard && !c.unmet.length && c.faceInFrame[1][1] + c.faceInFrame[1][3] <= c.captions.box[1] - 23, `${source} ${side}: ${JSON.stringify([c.faceInFrame[1], c.captions.box, c.problems])}`);
    if (!QUICK) { const file = path.join(OUT, `beside-stay-${n}.html`); fs.writeFileSync(file, renderBeside(c, r, { page: file })); const cmp = compare(c, checkPage(file)); ok(cmp.verdictAgrees && cmp.agree, `${source} ${side}: solver only ${cmp.onlySolver}; checker only ${cmp.onlyChecker}`); }
    n++;
  }
  return `${n} columns`;
});

t("filling the column counts as the face's base size does: with b-roll's settings (faceUpTo 2, the soft limit 1.25×) a 720p speaker fills the 16:9 column at 1.5×, reported as soft, where it stood at 1.25× with 90 px of ground above and below (an independent review); without them it fills it at 1.5× as before", () => {
  const BR = { "beside.faceUpTo": 2, "beside.wish": 0.22, "weights.enlarge.softFrom": 1.25 };
  const c = beside(Z169, { set: BR }).candidates.find((k) => k.arrangement === "column"), d = beside(Z169).candidates.find((k) => k.arrangement === "column");
  ok(c.speaker.scale === 1.5 && c.speaker.ground === 0 && c.problems.some((q) => q.code === "enlarged" && q.level === "soft") && !c.hard, JSON.stringify([c.speaker.scale, c.speaker.window, c.problems]));
  ok(d.speaker.scale === 1.5 && d.speaker.ground === 0, JSON.stringify(d.speaker.window));
});

t("a picture of fixed size keeps its own shape in every field, and no field is a sliver: an independent review's input (16:9 for YouTube, 1080×1080, a face 41 % asked for, a 1920×1080 picture, a two-line caption area across the frame's foot) gave the panel's material a field of 1.8×1 px, of shape 1.800", () => {
  const r = besideSolve({ zones: askZones("16:9", ["youtube"]), source: [1080, 1080], face: [401, 179, 503, 584], material: { fixed: [1920, 1080] }, needs: [cap(2)], set: { "beside.face": 0.41 }, captionArea: { left: 96, width: 1728, bottom: 930, top: 728, size: 96, lines: 2, from: "test" } });
  for (const c of r.candidates) { const [, , w, h] = c.material.field; ok(Math.abs(w / h / (16 / 9) - 1) < 0.002 && h >= 108 - 0.5, `${c.fit}: ${c.material.field}`); }
  return r.candidates.map((c) => `${c.fit} ${Math.round(c.material.field[2])}×${Math.round(c.material.field[3])}`).join(", ");
});

t("a face that moves is held by its hull: the panel holds every moment's box, its size is the usual box's", () => {
  const moving = [{ t: 0, box: [555, 150, 180, 195] }, { t: 2, box: [610, 190, 180, 195] }, { t: 4, box: [520, 140, 180, 195] }];
  for (const Z of [Z916, Z169]) {
    const r = beside(Z, { face: moving }), c = r.candidates[0];
    ok(!c.hard && !c.unmet.length && r.tracks?.length === 1, `${Z.frame}: ${JSON.stringify(c.problems)}`);
    for (const m of moving) { const b = [c.left + c.scale * m.box[0], c.top + c.scale * m.box[1], c.scale * m.box[2], c.scale * m.box[3]]; ok(inBox(c.speaker.field, b, 0.5) && inSafe(Z, b), `${Z.frame} at ${m.t} s: ${b}`); }
  }
});

t("the face's target is one number (--set beside.face): the b-roll session's upright close-up with a card of 700×330 has its face at 18 % in the panel; at 0.22 it is 22 % and the reason names the target asked for; in 16:9 the column takes it too, and says where the footage gives no more without enlarging past 1.5×; under the 12 % floor it says so in one sentence; over what the panel holds (0.45 in 9:16) or what stays sharp (an independent review: 0.22 from 720p with two caption lines was refused as at most 21 %, 0.21 then gave 15 %) the face gets the most it can and a note says what was asked and what was given", () => {
  const close = { source: [1080, 1920], face: [80, 250, 445, 580], material: { min: [700, 330] } };
  near(beside(Z916, close).candidates[0].speaker.facePct, 18, 0.2, "the usual target");
  const big = beside(Z916, { ...close, set: { "beside.face": 0.22 } }).candidates[0];
  ok(big.fit === "beside-above" && !big.hard && !big.unmet.length, JSON.stringify(big.problems)); near(big.speaker.facePct, 22, 0.2, "the target asked for");
  ok(big.why.some((w) => /22 % is the target asked for \(beside\.face; the usual is 18 % below a screen\)/.test(w)), big.why.join(" | "));
  const col = beside(Z169, { set: { "beside.face": 0.3 } }).candidates[0];
  ok(col.fit === "beside-column" && col.why.some((w) => /30 % is the target asked for .*no more without enlarging past 1\.5×/.test(w)), col.why.join(" | "));
  const base = ["--frame", "9:16", "--source", "1080x1920", "--face", "80,250,445,580", "--material-min", "700x330", "--text", "caption", "--set"];
  const e = cli("beside", path.join(OUT, "beside-face"), ...base, "beside.face=0.1");
  sentence(e, "beside.face=0.1"); ok(/from 0\.12 .* to 0\.5; 0\.1 is outside that\./.test(e.stderr.trim()) && e.stderr.trim().split("\n").length === 1, e.stderr);
  const most = beside(Z916, { ...close, set: { "beside.face": 0.45 } }).candidates.find((c) => c.arrangement === "above");
  ok(most && !most.hard && !most.unmet.length && /a face of 45 % .* was asked for; it is \d+ %: the panel holds no more beside the material's field/.test((most.notes || []).join(" ")) && most.speaker.target.asked.face === 45, JSON.stringify(most?.speaker.target));
  const sharp = beside(Z916, { needs: [cap(2)], set: { "beside.face": 0.22 } }).candidates[0];
  ok(sharp.fit === "beside-above" && /it is 15 %: the footage gives no more without enlarging past 1\.5×/.test((sharp.notes || []).join(" ")), JSON.stringify(sharp.notes));
  return `22 %: face ${big.speaker.faceHeight} px, field ${Math.round(big.material.field[2])}×${Math.round(big.material.field[3])}`;
});

t("beside's input it cannot use it says in one sentence: no material need, a hook, two faces, a bad --before, an unknown beside.* key (it pointed to defaults.mjs, where beside's own are not)", () => {
  const dir = path.join(OUT, "beside-bad"), base = ["--frame", "9:16", "--source", "1280x720", "--face", "555,150,180,195"];
  for (const [extra, says] of [[[], /needs what the material needs/], [["--material-min", "600x340", "--text", "hook"], /captions only/], [["--material-min", "600x340", "--face", "100,100,50,50"], /one speaker/], [["--material-min", "600x340", "--before", "1,2"], /--before is scale,left,top/], [["--material-min", "600x340", "--material-ratio", "wide"], /--material-ratio is/], [["--material-min", "600x340", "--set", "beside.facemin=0.1"], /beside's own are beside\.faceMin, .*\(tools\/lib\/beside\.mjs/]]) {
    const e = cli("beside", dir, ...base, ...extra);
    sentence(e, extra.join(" ")); ok(says.test(e.stderr), e.stderr);
  }
});

t("place.mjs beside writes placement.json, and captions reads it: on the seam centred (9:16), under the material in the column (16:9: --x and --align)", () => {
  const a = path.join(OUT, "beside-916"), b = path.join(OUT, "beside-169");
  let r = cli("beside", a, "--frame", "9:16", "--source", "1280x720", "--face", "555,150,180,195", "--material-min", "600x340", "--text", "caption");
  ok(r.status === 0 && /1\. ✓ beside-above/.test(r.stdout) && fs.existsSync(path.join(a, "placement.json")), r.stderr || r.stdout);
  r = cli("captions", a, "--candidate", "1");
  ok(r.status === 0 && /seam/.test(r.stdout) && !/--x/.test(r.stdout), r.stderr || r.stdout);
  cli("beside", b, "--frame", "16:9", "--source", "1280x720", "--face", "555,150,180,195", "--material-min", "600x340", "--text", "caption");
  r = cli("captions", b, "--candidate", "1");
  ok(r.status === 0 && /--x 664 /.test(r.stdout) && /--align centre/.test(r.stdout), r.stderr || r.stdout);
});

t("what page and captions print of a beside candidate names it, never \"[object Object]\" (an independent review: nameOf read the speaker object as a face's number)", () => {
  const dir = path.join(OUT, "beside-names");
  cli("beside", dir, "--frame", "9:16", "--source", "1280x720", "--face", "555,150,180,195", "--material-min", "600x340", "--text", "caption");
  const r = cli("captions", dir, "--candidate", "2");
  ok(r.status === 0 && /Candidate 2 \(beside-pip/.test(r.stdout) && !/object Object/.test(r.stdout), r.stdout.split("\n")[0]);
});

// b-roll's settings, as its first builds with beside passed them (branch b-roll-uses-layout)
const BROLL = ["--set", "beside.wish=0.22", "--set", "beside.faceUpTo=2", "--set", "weights.enlarge.softFrom=1.25"];
const besideRun = (dir, ...a) => { const r = cli("beside", path.join(OUT, dir), ...a); ok(r.status === 0, r.stderr || r.stdout); return { out: r.stdout, res: JSON.parse(fs.readFileSync(path.join(OUT, dir, "placement.json"), "utf8")) }; };

t("the 16:9 column follows the panel's three figures (b-roll's first builds: a medium shot with beside.wish and beside.faceUpTo but no beside.face gave the column at 1.53×, soft, as the column aimed at 23 % by itself; with beside.face=0.18 1.25× and 18.8 %): without beside.face it is now 1.25× and 18.8 % too, nothing soft, the wish said as given way; with nothing set the column's reason names 18 %, the panel's target", () => {
  const base = ["--frame", "1280x720", "--platform", "youtube", "--source", "1280x720", "--face", "582.8,216,86.4,108", "--material-min", "221x130", "--before", "1,0,0", ...BROLL, "--set", "beside.side=left", "--set", "beside.captions=stay"];
  const a = besideRun("beside-col-wish", ...base).res.candidates[0], b = besideRun("beside-col-face", ...base, "--set", "beside.face=0.18").res.candidates[0];
  for (const [what, c] of [["without beside.face", a], ["with beside.face=0.18", b]]) {
    ok(c.fit === "beside-column" && c.speaker.scale === 1.25 && Math.abs(c.speaker.facePct - 18.8) < 0.1 && !c.soft && !c.hard, `${what}: ${c.fit} ${c.speaker.scale}× ${c.speaker.facePct} % ${JSON.stringify(c.problems)}`);
    ok(/the wish of 22 % needs the footage at 1\.47×/.test((c.notes || []).join(" ")), `${what}: ${JSON.stringify(c.notes)}`);
  }
  const plain = beside(Z169, { source: [1080, 1920], face: [80, 250, 445, 580] }).candidates.find((c) => c.arrangement === "column");
  ok(plain.why.some((w) => /18 % is the usual below a screen, the panel's target, taken by the column too/.test(w)), plain.why.join(" | "));
  return `${a.speaker.scale}× ${a.speaker.facePct} %`;
});

t("captions on the seam stand on the panel's ground: speaker.card is speaker.window cut at the top to the captions' bottom, the face and the margin above the head below it (b-roll's first builds: the window began at the seam, y 795, and the lower caption line lay over the video down to y 896, so b-roll cut its card there itself); speaker.window keeps its meaning; card equals window for the circle, without captions and where they stay; the page shows the picture in the card and the checker agrees", () => {
  const { res, out } = besideRun("beside-card", "--frame", "1080x1920", "--platform", "reels", "--source", "1080x1920", "--face", "280,700,560,760", "--material-min", "588x346", "--caption-area", "120,840,1298,1500,96,2", "--text", "caption:2", "--before", "1,0,0", ...BROLL, "--set", "beside.face=0.18");
  const c = res.candidates[0], q = c.speaker, capBottom = c.captions.box[1] + c.captions.box[3];
  ok(c.captions.where === "seam" && q.window[1] === 795 && capBottom === 896, `window ${q.window}, captions ${c.captions.box}`);
  ok([q.window[0], 896, q.window[2], q.window[1] + q.window[3] - 896].every((v, k) => Math.abs(v - q.card[k]) < 0.11), `card ${q.card} against window ${q.window}`);
  ok(q.card[1] <= c.faceInFrame[1][1] - Math.max(DEFAULTS.free.aboveMin, DEFAULTS.free.above * c.faceInFrame[1][3]) + 0.5, `the card ${q.card} begins below the head's margin of ${c.faceInFrame[1]}`);
  ok(/card {6}x 240–840, y 896–1722/.test(out), out);
  const pip = res.candidates.find((k) => k.arrangement === "pip");
  ok(JSON.stringify(pip.speaker.card) === JSON.stringify(pip.speaker.window), `the circle's card ${pip.speaker.card}`);
  for (const [Z, o] of [[Z916, { needs: [] }], [Z169, { set: { "beside.captions": "stay" } }]]) for (const k of beside(Z, o).candidates.filter((x) => x.captions?.where !== "seam")) ok(JSON.stringify(k.speaker.card) === JSON.stringify(k.speaker.window), `${Z.frame} ${k.fit}: card ${k.speaker.card}, window ${k.speaker.window}`);
  const file = path.join(OUT, "beside-card", "card.html");
  fs.writeFileSync(file, renderBeside(c, res, { page: file }));
  ok(fs.readFileSync(file, "utf8").includes(`<div class="clip" style="left:${q.card[0]}px;top:${Math.round((q.card[1] - q.field[1]) * 10) / 10}px;width:${q.card[2]}px;height:${q.card[3]}px">`), "the page does not cut the picture to the card");
  if (!QUICK) { const cmp = compare(c, checkPage(file, ["reels"])); ok(cmp.verdictAgrees && cmp.agree, `solver only ${cmp.onlySolver}; checker only ${cmp.onlyChecker}`); }
  return `card ${q.card.join(",")}, window ${q.window.join(",")}`;
});

t("covering the panel's width holds a face up to 34 % of the frame's height (beside.coverUpTo: the third quartile of published talking heads), over its aim or not; a larger one comes to its aim (b-roll's first builds: 4:5 and 1:1, a close-up without captions, kept the face at 40 % at 1×, twice the 22 % asked for): the picture stands narrower with ground beside it, and the reason says why; with nothing set 18 %. The review of the first fix: ordinary takes keep the full-width panel as on main (9:16 a face at 19.8 %, 16:9 a 1080p wide shot at 20.4 %, both at 1×); a face of 33.5 % covers, one of 35 % comes down", () => {
  const out = [];
  for (const [frame, face, min] of [["1080x1350", "337.5,486,405,540", "413x243"], ["1080x1080", "378,388.8,324,432", "330x194"]]) {
    const c = besideRun("beside-close", "--frame", frame, "--source", frame, "--face", face, "--material-min", min, "--before", "1,0,0", ...BROLL, "--set", "beside.face=0.18").res.candidates[0];
    ok(c.fit === "beside-above" && Math.abs(c.speaker.facePct - 22) < 0.2 && c.speaker.ground > 0 && !c.hard && !c.soft, `${frame}: ${c.speaker.facePct} % ${JSON.stringify(c.problems)}`);
    ok(c.why.some((w) => /narrower than the panel: covering its width would make the face 40 %/.test(w)), c.why.join(" | "));
    const w = c.speaker.window, f = c.speaker.field;
    ok(Math.abs(w[0] - f[0] - (f[0] + f[2] - w[0] - w[2])) <= 1, `${frame}: the picture off the middle: ${w}`);
    const plain = besideRun("beside-close", "--frame", frame, "--source", frame, "--face", face, "--material-min", min).res.candidates[0];
    ok(Math.abs(plain.speaker.facePct - 18) < 0.2, `${frame} with nothing set: ${plain.speaker.facePct} %`);
    out.push(`${frame} ${c.speaker.facePct} %`);
  }
  const just = beside(Z45, { source: [1080, 1350], face: [415, 500, 250, 250], needs: [] }).candidates[0];
  ok(just.speaker.scale === 1 && just.speaker.ground === 0, `a face 1 % over its aim: ${just.speaker.scale}× ground ${just.speaker.ground}`);
  const r1 = besideRun("beside-ordinary", "--frame", "9:16", "--source", "1080x1920", "--face", "390,500,300,380", "--material-min", "700x330", "--text", "caption:2", "--caption-area", "180,720,1238,1440,96,2").res.candidates.find((k) => k.arrangement === "above");
  ok(r1.speaker.scale === 1 && r1.speaker.window[2] === 1080 && r1.speaker.facePct === 19.8 && !r1.speaker.ground, `9:16 at 19.8 %: ${r1.speaker.scale}× ${r1.speaker.window} ${r1.speaker.facePct} %`);
  const r2 = besideRun("beside-ordinary", "--frame", "16:9", "--source", "1920x1080", "--face", "830,220,170,220", "--material-min", "600x340").res.candidates.find((k) => k.arrangement === "above");
  ok(r2.speaker.scale === 1 && r2.speaker.window[2] === 1920 && r2.speaker.facePct === 20.4, `16:9 above at 20.4 %: ${r2.speaker.scale}× ${r2.speaker.window} ${r2.speaker.facePct} %`);
  for (const [h, pctAt, covers] of [[452, 33.5, true], [473, 35, false]]) {
    const c = besideRun("beside-edge34", "--frame", "1080x1350", "--source", "1080x1350", "--face", `400,450,300,${h}`, "--material-min", "413x243").res.candidates[0];
    ok(covers ? c.speaker.scale === 1 && c.speaker.facePct === pctAt && !c.speaker.ground : Math.abs(c.speaker.facePct - 18) < 0.2 && c.speaker.ground > 0 && c.why.some((w) => /over the 34 % up to which a panel covers the width \(beside\.coverUpTo\)/.test(w)), `a face of ${pctAt} % at cover: ${c.speaker.scale}× ${c.speaker.facePct} % ground ${c.speaker.ground}`);
  }
  return out.join(", ");
});

t("a feed's or grid's crop is a note, not a problem (b-roll's first builds showed them as ⚠ a caller cannot act on: the Instagram feed's 4:5 at the material in 9:16, the profile grid's 3:4 at the captions in 1:1, no platform named): in `crops` and the candidate's notes, the mark ✓; and a --face past the source's edge is taken to the edge with a note (it ended the command), one wholly outside is an error", () => {
  const feed = besideRun("beside-crops", "--frame", "1080x1920", "--source", "1080x1920", "--face", "252,691.2,576,768", "--material-min", "588x346", "--caption-area", "192,696,1238,1440,96,2", "--text", "caption:2", "--before", "1,0,0", ...BROLL, "--set", "beside.face=0.18");
  const c = feed.res.candidates[0];
  ok(!c.problems.some((q) => q.code === "crop") && c.crops.some((q) => q.of === "material" && /Instagram feed shows 4:5/.test(q.what)) && !c.soft, JSON.stringify([c.problems, c.crops]));
  ok(/1\. ✓ beside-above/.test(feed.out) && /note: not a problem, a note: the material is 9 % cut where the Instagram feed shows 4:5/.test(feed.out), feed.out);
  const grid = besideRun("beside-crops", "--frame", "1080x1080", "--source", "1080x1080", "--face", "475.2,324,129.6,162", "--material-min", "330x194", "--caption-area", "54,972,758,960,96,2", "--text", "caption:2", "--before", "1,0,0", ...BROLL, "--set", "beside.face=0.18").res;
  for (const k of grid.candidates) ok(k.crops.some((q) => q.of === "caption" && /profile grid shows 3:4/.test(q.what)) && !k.problems.some((q) => q.code === "crop") && (k.notes || []).some((n) => /captions are 16 % cut/.test(n)), `${k.fit}: ${JSON.stringify(k.crops)}`);
  const edge = besideRun("beside-edge", "--frame", "9:16", "--source", "1280x720", "--face", "1200,150,180,195", "--material-min", "600x340", "--text", "caption");
  ok(/^note: the face's box 1200,150,180,195 reaches past the source of 1280×720: taken as 1200,150,80,195/m.test(edge.out) && JSON.stringify(edge.res.speaker.face) === "[1200,150,80,195]", edge.out.split("\n").slice(0, 4).join(" | "));
  // (a box cut at a corner keeps the face's size as given: the circle shows two given faces, not two of the cut part)
  const corner = besideRun("beside-corner", "--frame", "9:16", "--source", "1920x1080", "--face", "1830,1000,180,220", "--material-min", "600x340", "--text", "caption").res;
  const pip = corner.candidates.find((k) => k.arrangement === "pip"), panel = corner.candidates.find((k) => k.arrangement === "above");
  ok(JSON.stringify(corner.speaker.face) === "[1830,1000,90,80]" && pip.speaker.scale < 0.6 && Math.abs(pip.speaker.crop[2] - 440) < 1 && panel.speaker.faceHeight === Math.round(220 * panel.speaker.scale), `corner: face ${corner.speaker.face}, circle ${pip.speaker.scale}× crop ${pip.speaker.crop}, panel face ${panel.speaker.faceHeight} at ${panel.speaker.scale}×`);
  const e = cli("beside", path.join(OUT, "beside-edge"), "--frame", "9:16", "--source", "1280x720", "--face", "1300,150,180,195", "--material-min", "600x340");
  sentence(e, "a face wholly outside"); ok(/lies outside the source of 1280×720/.test(e.stderr), e.stderr);
  ok(cli("place", path.join(OUT, "place-edge"), "--frame", "9:16", "--source", "1280x720", "--face", "1200,150,180,195").status === 1, "place takes a box past the edge");
});

if (!QUICK) t("every candidate of beside in every frame, as a page, gets the same verdict and findings from the checker as from the solver (the material's field is marked as something to be seen, the face, the circle and the caption measured by their letters); page takes the speaker's still and the material's picture", () => {
  let n = 0;
  for (const Z of [Z916, Z45, Z11, Z169]) for (const face of [WIDE.face, [555, 500, 180, 195]]) {
    const r = beside(Z, { face });
    r.candidates.forEach((c, i) => {
      const file = path.join(OUT, `beside-${Z.frame.replace(":", "-")}-${face[1]}-${i + 1}.html`);
      fs.writeFileSync(file, renderBeside(c, r, { page: file }));
      const ch = checkPage(file), faces = ch.boxes.filter((x) => x.kind === "face").length, texts = ch.boxes.filter((x) => x.kind === "text").length;
      ok(faces === c.faceInFrame.length + (c.circle ? 1 : 0) && texts === c.text.length, `${file}: the checker saw ${faces} faces, ${texts} texts`);
      const cmp = compare(c, ch);
      ok(cmp.verdictAgrees && cmp.agree, `${file}: solver only ${cmp.onlySolver}; checker only ${cmp.onlyChecker}`);
      n++;
    });
  }
  const dir = path.join(OUT, "beside-page"), still = path.join(OUT, "beside-speaker.jpg"), card = path.join(OUT, "beside-card.png");
  spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1280x720", "-frames:v", "1", still]);
  spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=navy:s=800x450", "-frames:v", "1", card]);
  cli("beside", dir, "--frame", "9:16", "--source", "1280x720", "--face", "555,150,180,195", "--material-min", "600x340", "--text", "caption");
  const p = cli("page", dir, "--still", still, "--still", card, "--candidate", "1,2");
  ok(p.status === 0 && ["candidate-1.png", "candidate-2.png", "still.jpg", "still-2.jpg"].every((f) => fs.existsSync(path.join(dir, f))) && !/They differ/.test(p.stdout), p.stderr || p.stdout);
  return `${n} pages`;
});

if (table.length) {
  console.log("\nWinners of the hand cases with the weights of weights.json");
  const a0 = Math.max(...table.map((r) => r[0].length)), a1 = Math.max(...table.map((r) => r[1].length)), a2 = Math.max(...table.map((r) => r[2].length));
  for (const r of table) console.log(`  ${r[0].padEnd(a0)}  ${r[1].padEnd(a1)}  ${r[2].padEnd(a2)}  ${r[3]}`);
}
console.log("\nHand and solver side by side");
const w0 = Math.max(...rows.map((r) => r[0].length)), w1 = Math.max(...rows.map((r) => r[1].length));
console.log(`  ${"".padEnd(w0)}  ${"hand".padEnd(w1)}  solver`);
for (const r of rows) console.log(`  ${r[0].padEnd(w0)}  ${r[1].padEnd(w1)}  ${r[2]}`);
console.log(`\n${passed} passed, ${failed} failed${QUICK ? " (without the checker)" : ""}`);
if (given) console.log(`The pages are in ${given}.`); else fs.rmSync(OUT, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
