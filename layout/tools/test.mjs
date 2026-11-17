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
import { solve } from "./lib/solve.mjs";
import { askZones, checkPage, chromePath, zonesTool } from "./lib/zones.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), QUICK = args.includes("--quick"), given = args.find((a) => !a.startsWith("--"));
try { zonesTool(); } catch (e) { console.error(e.message); process.exit(1); }
if (!QUICK && !chromePath()) { console.error("The checker needs Chrome: set CHROME=/path/to/chrome, or run the tests that need none with --quick."); process.exit(1); }
const OUT = given || fs.mkdtempSync(path.join(os.tmpdir(), "layout-test-"));
fs.mkdirSync(OUT, { recursive: true });
const HAND = JSON.parse(fs.readFileSync(path.join(HERE, "hand.json"), "utf8"));

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
  const placed = c.faceInFrame.length + (c.circle ? 1 : 0);
  if (faces !== placed || texts !== c.text.length) throw new Error(`${name}: the checker saw ${faces} faces and ${texts} texts, the solver placed ${placed} and ${c.text.length}`);
  return { r, cmp: compare(c, r), file };
}

// =============================================================================================
console.log(`P1: ${HAND.takes.p1.what.split(":")[0].toLowerCase()}, source ${HAND.takes.p1.source.join("×")}, face x 300–900, y 570–1470`);
// =============================================================================================
const SRC1 = HAND.takes.p1.source, FACE1 = HAND.takes.p1.face;
const Z916 = askZones("9:16"), Z169 = askZones("16:9");
const run1 = (zones, text, set) => solve({ zones, source: SRC1, faces: [FACE1], needs: text, set });
const cap = (n) => ({ role: "caption", lines: n }), hook = { role: "hook" };

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

t("the zoom holds one caption line or the hook, not both", () => {
  const z = (text) => run1(Z916, text).candidates.find((q) => q.fit === "zoom");
  const a = z([hook]), b = z([hook, cap(1)]), c2 = z([cap(2)]);
  ok(!a.hard && !a.unmet.length && a.text[0].where === "above-head", "the hook alone does not fit above the head");
  ok(b.unmet.length === 1, `hook and caption both fit in the zoom: ${JSON.stringify(b.text.map((q) => q.role))}`);
  side("P1 zoom 1.07, hook alone", "card 196 px tall at 66 px", `card ${a.text[0].box[3]} px tall at ${a.text[0].font} px`);
  side("P1 zoom 1.07, hook + captions", "not both", `not both (${b.unmet.join(", ")} without a place)`);
  side("P1 zoom 1.07, caption lines above the head", "one (two only at 0.9)", c2.unmet.length ? "one" : `two fit too (y ${Math.round(c2.text[0].box[1])}–${Math.round(c2.text[0].box[1] + c2.text[0].box[3])}, safe box from ${Z916.safe[1]})`);
  return `hook alone at ${a.text[0].font} px; with a caption line: ${b.unmet.join(", ")} without a place`;
});

t("hook plus two caption lines: no full or zoom fits; 0.82 is the first inset that holds both at the card's size", () => {
  const res = run1(Z916, [hook, cap(2)]);
  for (const c of res.candidates.filter((q) => q.fit !== "inset")) ok(c.hard || c.unmet.length, `${c.fit} fits hook plus captions`);
  const top = res.candidates[0], fullSize = res.candidates.find((q) => q.fit === "inset" && q.fullSize);
  ok(top.fit === "inset", `the winner is ${top.fit}`);
  ok(fullSize, "no inset holds the card at its size");
  near(fullSize.scale, 0.82, 0.005, "the inset with the card at its size"); near(fullSize.left, 97, 1, "left"); near(fullSize.top, 215, 1, "top");
  ok(fullSize.text.every((q) => q.where === "above-head"), "not all text is above the head");
  // the same, the card not allowed to shrink: 0.82 is then the first of all
  const fixed = run1(Z916, [hook, cap(2)], { "hookCard.minFont": DEFAULTS.hookCard.font }).candidates[0];
  ok(fixed.fit === "inset", `with a fixed card the winner is ${fixed.fit}`); near(fixed.scale, 0.82, 0.005, "with a fixed card");
  // and without the 20 px the hand kept under the chin
  const noPad = run1(Z916, [hook, cap(2)], { "hookCard.minFont": DEFAULTS.hookCard.font, facePad: 0 }).candidates[0];
  side("P1 9:16, hook + 2 caption lines", "inset 0.82 at 97/215, card 240 px (76 px), all above the head", `inset ${fullSize.scale} at ${fullSize.left}/${fullSize.top}, card ${fullSize.text.find((q) => q.role === "hook").box[3]} px (76 px), all above the head`);
  side("  the solver's first", "(the hand shrank the card to 66 px only in the zoom)", `inset ${top.scale} at ${top.left}/${top.top} with the card at ${top.text.find((q) => q.role === "hook").font} px`);
  side("  without the 20 px under the chin", "–", `inset ${noPad.scale}`);
  if (!QUICK) for (const [c, n] of [[top, "p1-hook2-first"], [fullSize, "p1-hook2-fullsize"]]) { const v = verify(c, res, n); ok(v.r.ok, `the checker fails ${n}`); ok(v.cmp.agree, `solver and checker differ on ${n}: ${JSON.stringify(v.cmp)}`); }
  return `first inset ${top.scale} (card ${top.text.find((q) => q.role === "hook").font} px), with the card at 76 px ${fullSize.scale} at ${fullSize.left}/${fullSize.top}`;
});

t("the hand's insets, placed as the hand placed them, pass in the solver's geometry", () => {
  const ctxOf = (text) => { const D = structuredClone(DEFAULTS); return { W: 1080, H: 1920, Z: Z916, D, sw: 1080, sh: 1920, s0: 1, faces: [FACE1], fb: [300, 570, 900, 1470], tall: true, cap: text.find((n) => n.role === "caption") || null, hook: text.find((n) => n.role === "hook") || null }; };
  const a = evaluate(ctxOf([cap(2)]), { fit: "inset", s: 0.9, left: 54, top: 97, win: [54, 97, 972, 1728] });
  ok(!a.hard && !a.unmet.length && a.text[0].where === "above-head", `0.9 with two lines: ${JSON.stringify(a.problems)}`);
  const b = evaluate(ctxOf([hook, cap(2)]), { fit: "inset", s: 0.82, left: 97, top: 215, win: [97, 215, 885.6, 1574.4] });
  ok(!b.hard && !b.unmet.length && b.fullSize, `0.82 with hook and two lines: ${JSON.stringify(b.problems)}`);
  const c = evaluate(ctxOf([hook, cap(2)]), { fit: "inset", s: 0.9, left: 54, top: 97, win: [54, 97, 972, 1728] });
  ok(c.unmet.length || !c.fullSize, "0.9 holds the card at its size and two lines");
  const res2 = run1(Z916, [cap(2)]), first2 = res2.candidates[0];
  // where the solver goes further than the hand (two lines above the head in the zoom), the checker decides
  if (!QUICK && first2.fit === "zoom") { const v = verify(first2, res2, "p1-caption2-zoom"); ok(v.r.ok, `the checker fails two lines above the head in the zoom: ${v.r.hard.map((f) => f.what)}`); ok(v.cmp.agree, `solver and checker differ: ${JSON.stringify(v.cmp)}`); }
  side("P1 9:16, 2 caption lines", "inset 0.9 at 54/97 (zoom: one line only)", `${first2.fit} ${first2.scale} at ${first2.left}/${first2.top}, lines ${first2.text[0].where}; the hand's 0.9 passes too`);
});

t("16:9: the whole take as a panel on the left passes, text beside it", () => {
  const res = run1(Z169, [hook, cap(2)]), c = res.candidates[0];
  ok(c.fit === "panel" && c.side === "left", `the winner is ${c.fit} ${c.side || ""}`);
  near(c.window[2], 607.5, 0.6, "panel width"); near(c.window[3], 1080, 0.6, "panel height");
  ok(!c.hard && !c.unmet.length && c.text.every((q) => q.where === "beside"), `the panel: ${JSON.stringify(c.problems)}`);
  const hk = c.text.find((q) => q.role === "hook"), cp = c.text.find((q) => q.role === "caption");
  side("P1 16:9, hook + 2 caption lines", "panel 607.5×1080 left; hook 112 px from x 704; captions x 704, bottom 930", `panel ${c.window[2]}×${c.window[3]} ${c.side}; hook ${hk.font} px from x ${hk.box[0]}; captions x ${cp.box[0]}, bottom ${cp.box[1] + cp.box[3]}`);
  if (!QUICK) { const v = verify(c, res, "p1-169-panel"); ok(v.r.ok, "the checker fails the panel"); ok(v.cmp.agree, `solver and checker differ: ${JSON.stringify(v.cmp)}`); }
  const alone = run1(Z169, [cap(1)]).candidates[0];
  ok(alone.fit === "panel" && !alone.hard && !alone.unmet.length, "the panel with one caption line fails");
});

if (!QUICK) t("solver and checker give the same verdict on the eight hand pages, and it is the one the hand wrote down", () => handVerdicts("p1"));

// =============================================================================================
console.log(`\nP2: ${HAND.takes.p2.what.split(":")[0].toLowerCase()}, source ${HAND.takes.p2.source.join("×")}, face x 558–735, y 100–348`);
// =============================================================================================
const SRC2 = HAND.takes.p2.source, FACE2 = HAND.takes.p2.face;
const run2 = (zones, text) => solve({ zones, source: SRC2, faces: [FACE2], needs: text });
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
  for (const [Z, text, tag] of [[Z916, [cap(2)], "916-cap2"], [Z916, [hook, cap(2)], "916-hook-cap2"], [Z169, [hook, cap(1)], "169-hook-cap1"]]) {
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
const nameOf = (c) => `${c.fit}${c.crop ? ` ${c.crop}` : ""}${c.side ? ` ${c.side}` : ""} ${r2(c.enlargement)}×`;
const needsOf = (list) => list.map((x) => (x === "hook" ? hook : cap(Number(x.split(":")[1]))));
const table = [];

t("the judged wide take (1280×720 into 9:16, two caption lines): the 4:5 crop (1.875×, soft) first, the square (1.5×, no problem) second, the whole picture as a strip third, the 2.67× crop fails", () => {
  const res = solve({ zones: Z916, source: SRCW, faces: [FACEW], needs: [cap(2)] });
  const order = res.candidates.map((c) => (c.fit === "crop" ? `crop ${c.crop}` : c.fit));
  ok(order.slice(0, 3).join(", ") === "crop 4:5, crop 1:1, inset", `the order is ${order.join(", ")}`);
  const [c45, c11, strip] = res.candidates, c916 = res.candidates.find((c) => c.crop === "9:16");
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
    const take = HAND.takes[w.take], first = solve({ zones: ZONES[w.frame], source: take.source, faces: [take.face], needs: needsOf(w.text) }).candidates[0];
    const same = nameOf(first) === w.first;
    table.push([w.case, w.first, w.basis, same ? "" : `now ${nameOf(first)}`]);
    if (!same) changed.push(`${w.case}: ${w.first} (${w.basis}) is now ${nameOf(first)}`);
  }
  ok(!changed.length, changed.join("\n"));
  const by = (b) => HAND.winners.filter((w) => w.basis === b).length;
  return `${HAND.winners.length} cases: ${by("hand")} laid out by hand, ${by("judged")} judged by people, ${by("solver")} only the solver's`;
});

t("one term changed changes the order: with enlargement at 5 points at the limit the crisp square leads", () => {
  const res = solve({ zones: Z916, source: SRCW, faces: [FACEW], needs: [cap(2)], set: { "weights.enlarge.costAtForbidden": 5 } });
  ok(res.candidates[0].crop === "1:1" && res.candidates[1].crop === "4:5", `the order is ${res.candidates.map(nameOf).join(", ")}`);
  const far = solve({ zones: Z916, source: SRCW, faces: [FACEW], needs: [cap(2)], set: { "weights.enlarge.forbiddenFrom": 3 } }).candidates.find((c) => c.crop === "9:16");
  ok(!far.hard, "with the limit at 3× the 2.67× crop still fails");
});

// =============================================================================================
console.log("\nSeveral faces: one box each");
// =============================================================================================
// two people in one wide picture: 1920×1080, the left one's face x 420–640, the right one's x 1280–1500
const SRC2P = [1920, 1080], TWO = [[420, 300, 220, 300], [1280, 320, 220, 300]];
const X1 = (b) => b[0] + b[2], Y1 = (b) => b[1] + b[3];
const inside = (o, i) => i[0] >= o[0] - 0.1 && i[1] >= o[1] - 0.1 && X1(i) <= X1(o) + 0.1 && Y1(i) <= Y1(o) + 0.1;
const overlap = (a, b) => Math.min(X1(a), X1(b)) - Math.max(a[0], b[0]) > 0.1 && Math.min(Y1(a), Y1(b)) - Math.max(a[1], b[1]) > 0.1;
const agree = (c, res, name) => { if (QUICK) return; const v = verify(c, res, name); ok(v.r.ok === !c.hard, `${name}: the checker ${v.r.ok ? "passes" : "fails"} it, the solver ${c.hard ? "fails" : "passes"} it`); ok(v.cmp.agree, `${name}: solver and checker differ: ${JSON.stringify(v.cmp)}`); };

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
  ok(on[0].faceInFrame.length === 1 && on[0].leftOut === 1 && on[0].terms.people === DEFAULTS.weights.people.leftOut, "a crop on one does not count the other as left out");
  agree(st, res, "two-916-stacked"); agree(on[0], res, "two-916-crop-on-1"); agree(whole, res, "two-916-whole");
  return `stacked at ${st.parts[0].scale}×, faces ${st.faceHeight} px, caption y ${Math.round(cp.box[1])}–${Math.round(Y1(cp.box))}; then ${res.candidates.slice(1, 4).map((c) => `${nameOf(c)}${c.speaker ? ` on face ${c.speaker}` : ""}`).join(", ")}`;
});

t("--speaker 2: only the crops on the second person are listed, leaving the first out costs nothing, and the crop that fills the frame (1.78×, soft) leads before stacked", () => {
  const res = solve({ zones: Z916, source: SRC2P, faces: TWO, needs: [cap(2)], speaker: 2 });
  const crops = res.candidates.filter((c) => c.speaker);
  ok(crops.length === 3 && crops.every((c) => c.speaker === 2), `crops on: ${crops.map((c) => c.speaker)}`);
  const first = res.candidates[0];
  ok(first.fit === "crop" && first.crop === "9:16" && first.speaker === 2 && !first.terms.people, `the first is ${nameOf(first)}`);
  ok(Math.abs(first.faceInFrame[0][0] + first.faceInFrame[0][2] / 2 - 540) < 1, "the speaker is not on the frame's middle");
  ok(res.candidates[1].fit === "stacked", `the second is ${nameOf(res.candidates[1])}`);
  let thrown = false; try { solve({ zones: Z916, source: SRC2P, faces: TWO, needs: [], speaker: 3 }); } catch { thrown = true; }
  ok(thrown, "a speaker that is not there is accepted");
  agree(first, res, "two-916-speaker-2");
  return `${nameOf(first)} on face 2, cost ${first.cost}; stacked ${res.candidates[1].cost}`;
});

t("the same picture in 16:9 stays whole: the caption stands under both chins and the hook above both heads, on neither face; faces far apart take the hook between them", () => {
  const res = solve({ zones: Z169, source: SRC2P, faces: TWO, needs: [hook, cap(2)] }), c = res.candidates[0];
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
  // the smaller face is brought towards the larger one's size
  const hs = sb.faceInFrame.map((f) => f[3]);
  ok(Math.max(...hs) / Math.min(...hs) < 1.1, `16:9: the faces are ${hs.map(Math.round).join(" and ")} px tall`);
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
  const still = run1(Z916, [cap(1)]).candidates[0];
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
  const res = solve({ zones: Z916, source: SRC1, faces: [sway], needs: [cap(1)] }), c = res.candidates[0], still = run1(Z916, [cap(1)]).candidates[0];
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
  const res = screenOf(Z916, REGION, [cap(2)], { cam: "file" }), c = res.candidates[0], k = c.circle, r = c.faceInFrame[0];
  ok(c.fit === "screen-zoom" && !c.hard && !c.unmet.length, `the first is ${nameOf(c)}: ${JSON.stringify(c.problems)}`);
  ok(k.corner === "bottom-left" && k.d === 238 && k.box[0] === Z916.safe[0] && Math.abs(Y1(k.box) - (c.text[0].box[1] - DEFAULTS.gap)) < 0.6, `the circle: ${JSON.stringify(k)}`);
  ok(Y1(r) <= k.box[1] - DEFAULTS.gap + 0.1 && inside(Z916.safe, r) && inside(Z916.safe, k.box), "the region does not keep the gap above the circle");
  ok(k.crop && k.crop[2] === 720 && k.enlargement < 1, `the circle's crop of the webcam: ${k.crop}`);
  const low = screenOf(Z916, [60, 700, 480, 300], [cap(2)], { cam: "same" }), c2 = low.candidates[0], k2 = c2.circle, r2b = c2.faceInFrame[0];
  ok(c2.fit === "screen-zoom" && !c2.hard && k2.corner === "top-left" && k2.d === 238, `region at the bottom left: ${nameOf(c2)}, circle ${JSON.stringify(k2)}`);
  ok(!overlap(k2.box, r2b) && c2.window[2] === 1080 && Y1(c2.window) >= c2.text[0].box[1] - DEFAULTS.gap - 0.1, "the screen does not fill the frame down to the captions");
  for (const q of [c, c2]) ok(q.text.every((x) => !overlap(x.box, q.circle.box) && !overlap(x.box, q.faceInFrame[0])), "text touches the circle or the region");
  agree(c, res, "screen-916-cam"); agree(c2, low, "screen-916-cam-low");
  return `circle ${k.d} px ${k.corner} at y ${Math.round(k.box[1])}–${Math.round(Y1(k.box))}, region y ${Math.round(r[1])}–${Math.round(Y1(r))}; region at the bottom left: circle ${k2.corner}`;
});

t("with a hook and two caption lines the 480×400 region at 1.71× leaves the circle no corner: that candidate fails, and the largest scale with the circle (1.51×, text 21 px) is listed as not readable; in 16:9 and 4:5 the circle stands top right or, where the region is, top left", () => {
  const res = screenOf(Z916, [60, 620, 480, 400], [hook, cap(2)], { cam: "same" });
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

// =============================================================================================
console.log("\nFrames 4:5 (1080×1350) and 1:1 (1080×1080)");
// =============================================================================================
const first = (zones, source, face, needs) => { const res = solve({ zones, source, faces: [face], needs }); return [res.candidates[0], res]; };

t("4:5: the upright take passes unchanged with two caption lines above the head; with a hook as well the first is a band 0.85× down the frame (ground at its sides), hook and captions above the head. The wide take fills the frame at 1.875× (soft) before the crisp square band; with a hook a band of 1.48× stands at the bottom and the hook on the ground above it", () => {
  const [a] = first(Z45, SRC1, FACE1, [cap(2)]), [b] = first(Z45, SRC1, FACE1, [hook, cap(2)]), [c, cr] = first(Z45, SRCW, FACEW, [cap(2)]), [d] = first(Z45, SRCW, FACEW, [hook, cap(2)]);
  ok(a.fit === "full" && !a.hard && !a.unmet.length && !a.soft && a.text[0].where === "above-head", `upright, captions: ${nameOf(a)} ${JSON.stringify(a.problems)}`);
  ok(b.fit === "crop" && b.crop === "band" && !b.hard && !b.unmet.length && b.text.every((q) => q.where === "above-head"), `upright, hook + captions: ${nameOf(b)}`);
  near(b.scale, 0.85, 0.011, "the band's scale"); ok(b.window[1] === 0 && b.window[3] === 1350 && b.window[2] < 1080, `the band's window: ${b.window}`);
  ok(c.enlargement === 1.88 && !c.hard && !c.unmet.length && c.ground === 0 && c.text[0].where === "below-chin", `wide, captions: ${nameOf(c)}`);
  const sq = cr.candidates.find((q) => q.crop === "1:1");
  ok(sq && !sq.soft && cr.candidates.indexOf(sq) > 0 && sq.scale === 1.5, "wide: the square band is not second and crisp");
  ok(d.fit === "crop" && d.crop === "band" && !d.hard && !d.unmet.length && d.text.find((q) => q.role === "hook").where === "band-above", `wide, hook + captions: ${nameOf(d)}`);
  ok([a, b, c, d].every((q) => q.faceInFrame.every((f) => inside(Z45.safe, f))), "a face leaves the safe box");
  return `${nameOf(a)}; ${nameOf(b)} (${Math.round(b.ground * 100)} % ground); ${nameOf(c)}; ${nameOf(d)} (${Math.round(d.ground * 100)} % ground)`;
});

t("1:1: the upright take's face (900 px) is taller than the room text leaves: a band 0.8× down the frame holds two caption lines above the head, and only the whole take smaller (0.52×) holds a hook too. The wide take fills the frame at 1.5× with the captions under the chin; with a hook a band of 1.11× stands at the bottom. Centred text is at most 810 px wide: inside what the profile grid's 3:4 crop shows", () => {
  const [a] = first(Z11, SRC1, FACE1, [cap(2)]), [b] = first(Z11, SRC1, FACE1, [hook, cap(2)]), [c] = first(Z11, SRCW, FACEW, [cap(2)]), [d] = first(Z11, SRCW, FACEW, [hook, cap(2)]);
  ok(a.fit === "crop" && a.crop === "band" && !a.hard && !a.unmet.length && a.text[0].where === "above-head", `upright, captions: ${nameOf(a)}`);
  near(a.scale, 0.8, 0.011, "the band's scale");
  ok(b.fit === "inset" && !b.hard && !b.unmet.length && b.scale < 0.5625 && b.scale > 0.5, `upright, hook + captions: ${nameOf(b)}`);
  ok(c.fit === "full" && c.scale === 1.5 && !c.hard && !c.unmet.length && !c.soft, `wide, captions: ${nameOf(c)} ${JSON.stringify(c.problems)}`);
  ok(d.fit === "crop" && d.crop === "band" && !d.hard && !d.unmet.length, `wide, hook + captions: ${nameOf(d)}`);
  const grid = Z11.crops.find((q) => q.ratio === "3:4");
  ok(grid && [a, b, c, d].every((q) => q.text.every((x) => x.box[0] >= grid.box[0] - 0.1 && X1(x.box) <= X1(grid.box) + 0.1)), "centred text is wider than the grid's crop");
  ok(Z11.wide === null && Z45.wide === null, "the feed frames have a wide stretch now: read layouts.md again");
  return `${nameOf(a)} (${Math.round(a.ground * 100)} % ground); ${nameOf(b)}; ${nameOf(c)}; ${nameOf(d)}`;
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
  let r = cli("place", a, "--frame", "9:16", "--source", SRC1.join("x"), "--face", boxArg(FACE1), "--text", "caption:1");
  ok(r.status === 0 && /1\. ✓ zoom/.test(r.stdout), `place: ${r.stderr || r.stdout}`);
  const res = JSON.parse(fs.readFileSync(path.join(a, "placement.json"), "utf8"));
  ok(res.candidates[0].fit === "zoom" && res.asked.frame === "9:16", "placement.json does not hold the candidates");
  r = cli("captions", a, "--json");
  const up = JSON.parse(r.stdout);
  ok(up.args.join(" ") === "--y 456 --max-width 696 --font-size 56 --lines 1", `9:16: ${up.args.join(" ")}`);
  r = cli("place", b, "--frame", "16:9", "--source", SRC1.join("x"), "--face", boxArg(FACE1), "--text", "hook", "--text", "caption:2", "--json");
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
  r = cli("place", dir, "--frame", "9:16", "--source", "1080x1920", "--face", boxArg(FACE1), "--text", "caption:1");
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

t("what the tool cannot do with its input it says in one sentence: a file where the folder goes, a face track that holds no boxes, a step of 0 (which once ran without end), a default that is not there, a CHROME that names no file", () => {
  const dir = path.join(OUT, "cli-bad"), file = path.join(OUT, "a-file.txt"), track = path.join(OUT, "track.json");
  fs.writeFileSync(file, "not a folder\n");
  const face = ["--frame", "9:16", "--source", "1080x1920", "--face", boxArg(FACE1)];
  let e = cli("place", file, ...face);
  sentence(e, "place <a file>"); ok(/is a file/.test(e.stderr) && fs.readFileSync(file, "utf8") === "not a folder\n", `place <a file>: ${e.stderr}`);
  for (const bad of ["null", "[null]", "{\"faces\": [[{\"t\": 0, \"box\": [1, 2, 3]}]]}", "[{\"t\": \"soon\", \"box\": [1, 2, 3, 4]}]"]) {
    fs.writeFileSync(track, bad);
    e = cli("place", dir, "--frame", "9:16", "--source", "1080x1920", "--face-track", track);
    sentence(e, `--face-track holding ${bad}`); ok(/--face-track/.test(e.stderr), `--face-track holding ${bad}: ${e.stderr}`);
  }
  for (const [set, says] of [["insetStep=0", /must be over 0/], ["zoomStep=0", /must be over 0/], ["insetStpe=0.02", /no default "insetStpe"/], ["caption.font.tall=large", /is a number/], ["caption=3", /group of defaults/]]) {
    e = cli("place", dir, ...face, "--set", set);
    sentence(e, `--set ${set}`); ok(says.test(e.stderr), `--set ${set}: ${e.stderr}`);
  }
  ok(!fs.existsSync(path.join(dir, "placement.json")), "a placement was written for input that was refused");
  ok(cli("place", dir, ...face, "--set", "insetStep=0.02").status === 0, "a step of 2 % is refused");
  e = cliWith({ CHROME: path.join(OUT, "no-chrome-here") }, "page", dir);
  sentence(e, "page with a CHROME that is not there"); ok(/CHROME names/.test(e.stderr), `CHROME=/nowhere: ${e.stderr}`);
});

if (!QUICK) t("a file the caller passes in is never removed or written over: grid onto its own input is refused, a still that already lies in the placement's folder is used as it is; and a second place clears the pages and pictures of the placement before, and nothing else in the folder", () => {
  const dir = path.join(OUT, "cli-files"), photo = path.join(OUT, "photo.jpg"), note = path.join(dir, "notes.txt"), own = path.join(dir, "grid.jpg");
  spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1080x1920", "-frames:v", "1", photo]);
  const bytes = (f) => fs.readFileSync(f).toString("base64");
  const before = bytes(photo);
  let e = cli("grid", photo, photo);
  sentence(e, "grid photo.jpg photo.jpg"); ok(fs.existsSync(photo) && bytes(photo) === before, "grid onto its input removed or changed the input");
  const face = ["--frame", "9:16", "--source", "1080x1920", "--face", boxArg(FACE1)];
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
  // a new placement: the old one's pages and frame go, what the caller put there stays
  cli("page", dir, "--still", photo);
  r = cli("place", dir, ...face, "--text", "hook");
  ok(r.status === 0, `the second place: ${r.stderr}`);
  const left = fs.readdirSync(dir).sort().join(", ");
  ok(left === "grid.jpg, notes.txt, placement.json", `after the second place the folder holds ${left}`);
  ok(fs.readFileSync(note, "utf8") === "mine\n", "the caller's file was changed");
  return "the input kept, the old pages cleared, the caller's files left";
});

if (!QUICK) t("the picture of a candidate is the frame down to its last row with every Chrome of this machine: one whose window is taller than its page left the lowest 87 px black", () => {
  const dir = path.join(OUT, "cli-chromes");
  cli("place", dir, "--frame", "9:16", "--source", "1080x1920", "--face", boxArg(FACE1), "--text", "caption:1");
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
