// Automatic quality check of a built video project – finds what a viewer would notice.
//
//   node tools/qa.mjs videos/my-clip [--no-contrast] [--max-shots 20] [--frames 12.5,25,31]
//   (--frames also saves stills at those times to <project>/qa/at-<t>s.png, for a quick look)
//
// Plays the real scene (world + typography + HUD, the same bundles the render uses)
// in headless Chrome, seeks to the moment every lockup is fully drawn and measures:
//   ✗ cut off      a word reaches past the frame edge
//   ✗ overlap      two lockups are on screen at the same time
//   ⚠ read time    a word is complete for less than ~0.3 s before its phrase leaves
//   ⚠ safe area    a word leaves the action-safe box (5 % inset)
//   ⚠ collision    words of one lockup run into each other, or into the HUD (chip, hook, waveform)
//   ⚠ contrast     text vs. the world right behind it (WCAG ratio from two screenshots:
//                  with and without the text layer) is below 3:1 – ✗ below 1.8:1
//   ⚠ transcript   the audio has speech where the transcript has no words (missed passage)
// Writes <project>/qa/report.json and a frame for every finding; exits 1 if there are ✗.

import { voicedGaps } from "./gaps.mjs";
import { footageLayer } from "./footage.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { PNG } from "pngjs";
import { CSS as TYPE_CSS } from "../engine/type.js";
import { CSS as OVERLAY_CSS } from "../engine/overlay.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const dir = argv.find((a) => !a.startsWith("--"));
if (!dir) { console.error("usage: node tools/qa.mjs <project dir> [--no-contrast] [--max-shots N]"); process.exit(1); }
const NO_CONTRAST = argv.includes("--no-contrast");
const MAX_SHOTS = Number(argv[argv.indexOf("--max-shots") + 1]) || 20;

const plan = JSON.parse(fs.readFileSync(path.join(dir, "plan.json"), "utf8"));
const W = plan.width, H = plan.height;
const mmss = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
const findings = [];
const add = (level, t, kind, msg, extra = {}) => findings.push({ level, t: +t.toFixed(2), kind, msg, ...extra });

// ---------------------------------------------------------------- page
function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = path.join(os.homedir(), ".cache", "puppeteer", "chrome-headless-shell");
  for (const v of fs.existsSync(base) ? fs.readdirSync(base).sort().reverse() : []) {
    const p = path.join(base, v, "chrome-headless-shell-linux64", "chrome-headless-shell");
    if (fs.existsSync(p)) return p;
  }
  throw new Error("no Chrome found – set CHROME=/path/to/chrome");
}
const b64 = (f) => fs.readFileSync(f).toString("base64");
// footage: the same layer as the render, with stills (8 fps) decoded by ffmpeg instead of a <video>
const FOOT = plan.video ? footageLayer(plan, { media: "img", canvas: "#world" }) : null;
const FPS = 8;
let frameDir = null;
if (FOOT) {
  frameDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinetic-qa-"));
  execFileSync("ffmpeg", ["-v", "error", "-i", path.join(dir, plan.video.src), "-vf", `fps=${FPS}`, "-q:v", "4", path.join(frameDir, "f%05d.jpg")]);
}
const frameCache = new Map();
const frameAt = (t) => {
  if (!frameDir) return null;
  const n = Math.min(fs.readdirSync(frameDir).length, Math.max(1, Math.round(t * FPS) + 1));
  if (!frameCache.has(n)) frameCache.set(n, "data:image/jpeg;base64," + b64(path.join(frameDir, `f${String(n).padStart(5, "0")}.jpg`)));
  return frameCache.get(n);
};
const font = (family, style, file) => `@font-face{font-family:"${family}";font-style:${style};font-weight:400;src:url(data:font/woff2;base64,${b64(file)}) format("woff2");}`;
const fs_ = (p) => path.join(ROOT, "node_modules", "@fontsource", p);
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${font("League Gothic", "normal", fs_("league-gothic/files/league-gothic-latin-400-normal.woff2"))}
${font("JetBrains Mono", "normal", fs_("jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2"))}
${font("Instrument Serif", "italic", path.join(ROOT, "assets/fonts/InstrumentSerif-Italic.woff2"))}
${font("Instrument Serif", "normal", path.join(ROOT, "assets/fonts/InstrumentSerif-Regular.woff2"))}
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#000}
#world{position:absolute;inset:0;width:${W}px;height:${H}px}
#lyrics-root{position:absolute;inset:0;font-family:"League Gothic","Instrument Serif",sans-serif}
#overlay-root{position:absolute;inset:0;pointer-events:none;font-family:"JetBrains Mono","League Gothic",monospace}
${TYPE_CSS}
${OVERLAY_CSS}
${FOOT ? FOOT.css : ""}
</style></head><body>${FOOT ? FOOT.html : ""}
<canvas id="world" width="${W}" height="${H}"></canvas><div id="lyrics-root"></div><div id="overlay-root"></div>
<script>${fs.readFileSync(path.join(ROOT, "node_modules/gsap/dist/gsap.min.js"), "utf8")}</script>
${["world", "type", "overlay"].map((n) => `<script>${fs.readFileSync(path.join(dir, "assets/engine", `${n}.js`), "utf8")}</script>`).join("\n")}
</body></html>`;

// Chrome puts a socket into TMPDIR, and a socket path has at most 107 bytes: a deep TMPDIR (a
// harness's per-chat folder) makes it fail to start, so Chrome gets the system's then
const tmpOk = (process.env.TMPDIR || "/tmp").length <= 60;
const browser = await puppeteer.launch({
  executablePath: chromePath(), headless: "shell",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
  ...(tmpOk ? {} : { env: { ...process.env, TMPDIR: "/tmp" } }),
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(async (plan, footJs) => {
  await Promise.all([document.fonts.load('400 100px "League Gothic"'), document.fonts.load('italic 400 100px "Instrument Serif"'),
    document.fonts.load('400 100px "Instrument Serif"'), document.fonts.load('400 20px "JetBrains Mono"')]);
  const world = KineticWorld.mount(document.getElementById("world"), plan);
  const type = KineticType.build(document.getElementById("lyrics-root"), plan, gsap);
  const overlay = KineticOverlay.build(document.getElementById("overlay-root"), plan, gsap);
  const tl = gsap.timeline({ paused: true });
  if (footJs) new Function("tl", footJs)(tl);
  window.__qa = {
    data: type.qa,
    seek(t) { type.timeline.seek(t, false); overlay.timeline.seek(t, false); overlay.draw?.(t); world.renderAt(t); tl.seek(t, false); },
    async frame(src) { const img = document.getElementById("bg-video"); if (!img || !src || img.src === src) return; img.src = src; await img.decode(); },
  };
}, { ...plan }, FOOT ? FOOT.js : "");
// shows the footage still for t (before a seek + screenshot)
const footageAt = async (t) => { if (FOOT) await page.evaluate((src) => window.__qa.frame(src), frameAt(t)); };
const qa = await page.evaluate(() => window.__qa.data);

// ---------------------------------------------------------------- timing (from the schedule)
const sched = new Map(qa.phrases.map((p) => [p.id, p]));
const wordsByPhrase = new Map();
for (const w of qa.words) (wordsByPhrase.get(w.phrase) || wordsByPhrase.set(w.phrase, []).get(w.phrase)).push(w);
qa.phrases.forEach((p, k) => {
  const next = qa.phrases[k + 1];
  if (next && next.show < p.xs + p.xd * 0.5 - 0.02) add("error", next.show, "overlap", `two phrases at once (${p.id} only leaves at ${mmss(p.xs + p.xd)})`);
  if (p.xs - p.show < 0.6) add("warn", p.show, "read time", `phrase visible for only ${(p.xs - p.show).toFixed(2)} s`);
});
for (const w of qa.words) {
  const word = plan.words[w.i];
  const p = sched.get(w.phrase);
  const readable = p.xs - w.ready;
  if (word.role === "content" && w.fx !== "shatter" && readable < 0.3) add("warn", w.ready, "read time", `"${word.display}" fully readable for only ${Math.max(0, readable).toFixed(2)} s`);
}

// ---------------------------------------------------------------- geometry + contrast (in the scene)
const lum = (r, g, b) => {
  const c = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const shotDir = path.join(dir, "qa");
fs.rmSync(shotDir, { recursive: true, force: true });
fs.mkdirSync(shotDir, { recursive: true });
let shots = 0;
const frameShot = async (t, tag) => {
  if (shots >= MAX_SHOTS) return null;
  const f = path.join(shotDir, `${String(shots++).padStart(2, "0")}-${t.toFixed(2)}s-${tag}.png`);
  await page.screenshot({ path: f });
  return path.relative(dir, f);
};

const ACTION = 0.05;
for (const p of qa.phrases) {
  const ws = wordsByPhrase.get(p.id) || [];
  if (!ws.length) continue;
  const t = Math.min(p.xs - 0.02, Math.max(p.show + 0.1, Math.max(...ws.map((w) => w.ready)) + 0.03));
  await footageAt(t);
  const g = await page.evaluate((t, id) => {
    window.__qa.seek(t);
    const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    const vis = (e) => { const s = getComputedStyle(e); return s.visibility !== "hidden" && +s.opacity > 0.05; };
    const words = [...document.querySelectorAll(`.ky-ph[data-ph="${id}"] .ky-w`)].map((e) => ({
      i: +e.dataset.w, line: [...e.parentElement.parentElement.children].indexOf(e.parentElement), r: R(e.querySelector(".ky-mk") || e),
      op: +getComputedStyle(e).opacity * +getComputedStyle(e.querySelector(".ky-mk") || e).opacity,
    }));
    const others = [...document.querySelectorAll(".ky-ph")].filter((e) => e.dataset.ph !== id && vis(e)).map((e) => e.dataset.ph);
    const hud = [...document.querySelectorAll(".ko-hookcard, .ko-chip, .ko-wave, .ko-tl, .ko-cta")].filter(vis).map((e) => ({ cls: e.className, r: R(e) }));
    return { words, others, hud };
  }, t, p.id);
  const ins = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  let shotNeeded = null;
  if (g.others.length) { add("error", t, "overlap", `${p.id} shares the screen with ${g.others.join(", ")}`); shotNeeded = "overlap"; }
  for (const w of g.words) {
    if (w.op < 0.05) continue;
    const d = plan.words[w.i].display;
    const cut = Math.max(-w.r.x, -w.r.y, w.r.x + w.r.w - W, w.r.y + w.r.h - H);
    if (cut > 2) { add("error", t, "cut off", `"${d}" sticks out of the frame by ${Math.round(cut)} px`); shotNeeded = "cut"; }
    else {
      const out = Math.max(W * ACTION - w.r.x, H * ACTION - w.r.y, w.r.x + w.r.w - W * (1 - ACTION), w.r.y + w.r.h - H * (1 - ACTION));
      if (out > 4) add("warn", t, "safe area", `"${d}" ${Math.round(out)} px outside the action-safe area`);
    }
    for (const h of g.hud) if (ins(w.r, h.r) > 0.12 * w.r.w * w.r.h) { add("warn", t, "collision", `"${d}" covers the HUD (${h.cls.split(" ")[0]})`); shotNeeded ||= "hud"; }
  }
  for (let a = 0; a < g.words.length; a++) for (let b = a + 1; b < g.words.length; b++) {
    const A = g.words[a], B = g.words[b];
    if (A.line === B.line || A.op < 0.05 || B.op < 0.05) continue;
    // word boxes include room for ascenders/descenders (and serif padding): compare the glyph core
    const core = (r) => ({ x: r.x, y: r.y + r.h * 0.18, w: r.w, h: r.h * 0.64 });
    if (ins(core(A.r), core(B.r)) > 0.1 * Math.min(A.r.w * A.r.h, B.r.w * B.r.h) * 0.64) {
      add("warn", t, "collision", `"${plan.words[A.i].display}" and "${plan.words[B.i].display}" overlap`); shotNeeded ||= "collision";
    }
  }

  // contrast: the same frame with and without the text layer; text pixels are where they differ
  if (!NO_CONTRAST) {
    // a struck-through word is faded on purpose
    const live = g.words.filter((w) => w.op > 0.5 && w.r.w > 4 && w.r.h > 4 && plan.words[w.i].note !== "strike");
    if (live.length) {
      const x0 = Math.max(0, Math.floor(Math.min(...live.map((w) => w.r.x)))), y0 = Math.max(0, Math.floor(Math.min(...live.map((w) => w.r.y))));
      const x1 = Math.min(W, Math.ceil(Math.max(...live.map((w) => w.r.x + w.r.w)))), y1 = Math.min(H, Math.ceil(Math.max(...live.map((w) => w.r.y + w.r.h))));
      if (x1 - x0 > 4 && y1 - y0 > 4) {
        const clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
        const withText = PNG.sync.read(await page.screenshot({ clip }));
        await page.evaluate(() => { document.getElementById("lyrics-root").style.visibility = "hidden"; });
        const bare = PNG.sync.read(await page.screenshot({ clip }));
        await page.evaluate(() => { document.getElementById("lyrics-root").style.visibility = ""; });
        for (const w of live) {
          // the text layer also carries a soft halo that lifts the paper behind the words: glyph
          // pixels are the strongly changed ones, and the background is what the viewer sees
          // around them in the final frame (halo included), not the bare world
          const px = [];
          for (let y = Math.max(y0, Math.floor(w.r.y)); y < Math.min(y1, w.r.y + w.r.h); y++) {
            for (let x = Math.max(x0, Math.floor(w.r.x)); x < Math.min(x1, w.r.x + w.r.w); x++) {
              const o = ((y - y0) * clip.width + (x - x0)) * 4;
              const L1 = lum(withText.data[o], withText.data[o + 1], withText.data[o + 2]);
              const L0 = lum(bare.data[o], bare.data[o + 1], bare.data[o + 2]);
              px.push([L1, Math.abs(L1 - L0)]);
            }
          }
          const ds = px.map((p) => p[1]).sort((a, b) => a - b);
          // glyphs can cover only a few percent of the box (thin italic serif): take the top 2 %
          const thr = Math.max(0.08, 0.5 * (ds[Math.floor(ds.length * 0.98)] || 0));
          const fg = px.filter((p) => p[1] >= thr).map((p) => p[0]);
          const bg = px.filter((p) => p[1] < thr).map((p) => p[0]);
          if (fg.length < 30 || bg.length < 30) continue;
          const lf = median(fg), lb = median(bg);
          const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
          const d = plan.words[w.i].display;
          if (ratio < 1.8) { add("error", t, "contrast", `"${d}" barely readable (contrast ${ratio.toFixed(1)}:1)`); shotNeeded ||= "contrast"; }
          else if (ratio < 3) add("warn", t, "contrast", `"${d}" weak contrast (${ratio.toFixed(1)}:1)`);
        }
      }
    }
  }
  if (shotNeeded) { const f = await frameShot(t, shotNeeded); if (f) findings[findings.length - 1].frame = f; }
}

const AT = argv.includes("--frames") ? String(argv[argv.indexOf("--frames") + 1]).split(",").map(Number).filter(Number.isFinite) : [];
for (const t of AT) {
  await footageAt(t);
  await page.evaluate((t) => window.__qa.seek(t), t);
  await page.screenshot({ path: path.join(shotDir, `at-${t.toFixed(2)}s.png`) });
}
await browser.close();
if (frameDir) fs.rmSync(frameDir, { recursive: true, force: true });

// ---------------------------------------------------------------- transcript vs. audio
const audio = plan.audio ? path.join(dir, plan.audio) : null;
if (audio && fs.existsSync(audio)) {
  for (const { a, b } of voicedGaps(audio, plan.words))
    add("warn", a, "transcript", `${(b - a).toFixed(1)} s of speech without words in the transcript (${mmss(a)}–${mmss(b)}) – missing passage? (tools/repair.mjs)`);
}

// ---------------------------------------------------------------- report
findings.sort((a, b) => (a.level === b.level ? a.t - b.t : a.level === "error" ? -1 : 1));
const errors = findings.filter((f) => f.level === "error").length, warns = findings.length - errors;
fs.writeFileSync(path.join(shotDir, "report.json"), JSON.stringify({ project: dir, errors, warnings: warns, findings }, null, 1));
console.log(`QA ${dir}: ${plan.phrases.length} lockups, ${plan.words.length} words, ${mmss(plan.duration)}`);
for (const f of findings) console.log(`  ${f.level === "error" ? "✗" : "⚠"} ${mmss(f.t)}  ${f.kind.padEnd(10)} ${f.msg}${f.frame ? `  [${f.frame}]` : ""}`);
console.log(`→ ${errors} errors, ${warns} warnings (${path.join(dir, "qa", "report.json")})`);
process.exit(errors ? 1 : 0);
