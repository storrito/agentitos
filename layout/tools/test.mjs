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
import { askZones, checkPage, chromePath, zonesTool } from "./lib/zones.mjs";

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
  sentence(e, "a second still for a baked webcam"); ok(/baked into the screen/.test(e.stderr), e.stderr);
  return `${pages.length} pages; the baked webcam from the screen's still`;
});

t("a webcam baked into the screen recording has one way, the one SKILL.md's table gives: its face after the screen's own --source. That command runs as written, the placement marks the webcam as baked, and the circle is cut from the screen's picture", () => {
  const row = fs.readFileSync(path.join(HERE, "..", "SKILL.md"), "utf8").split("\n").find((l) => /^\| a screen with the webcam baked in \|/.test(l));
  ok(row, "SKILL.md has no row for a webcam baked into the screen");
  const args = row.match(/`([^`]+)`/)[1].split(/\s+/), dir = path.join(OUT, "cli-baked-skill");
  const r = cli("place", dir, "--frame", "9:16", ...args, "--text", "caption", "--json");
  ok(r.status === 0, `the row's options: ${r.stderr}`);
  const j = JSON.parse(r.stdout), c = j.candidates.find((q) => q.circle);
  ok(j.sources && j.sources[1].baked && c && c.circle.crop, `sources ${JSON.stringify(j.sources)}, circle ${c && JSON.stringify(c.circle)}`);
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
