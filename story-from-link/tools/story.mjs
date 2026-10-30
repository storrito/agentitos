#!/usr/bin/env node
// A story of a few frames from <dir>/story.json, in the look of a brand kit, rendered in Chrome
// with Storrito's own sticker components and checked; the frames' pictures uploaded to Storrito,
// so that the agent schedules them from its REPL (code mode:
// storrito/schedule-instagram-story, …). Made for agents: it prints what it found and what to do next.
//
//   node tools/story.mjs build <dir> [--brand brand] [--preview artifacts/story-<name>.html]
//        <dir>/frames/NN.png: each frame's picture without its stickers; uploads/story-<name>/<build>/NN.jpg:
//        the frames as a viewer sees them, small, for the chat; the preview page beside the chat
//        shows them side by side; when Storrito is reachable, the pictures uploaded as temp-blobs
//        and <dir>/frames.edn: each frame's HTML for Storrito, ready for the REPL

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PNG } from "pngjs";
import { launch } from "./lib/chrome.mjs";
import * as design from "./lib/design-md.mjs";
import { contrast, luminance, parse } from "./lib/colors.mjs";
import { KINDS, STICKERS, W, H, framePage, inFrame, scheduleHtml, defaultTheme, resolveImage, fontCss } from "./lib/frames.mjs";
import { measureScript, layout } from "./lib/zones.mjs";
import { connect, call, componentsHost } from "./lib/storrito.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const FLAGS = [];
const opts = {};
const pos = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (!a.startsWith("--")) { pos.push(a); continue; }
  const k = a.slice(2);
  if (FLAGS.includes(k)) opts[k] = true;
  else opts[k] = rest[++i];
}

function fail(message) {
  console.log(message);
  process.exit(1);
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n");
const nn = (i) => String(i + 1).padStart(2, "0");
const nameOf = (dir) => path.basename(path.resolve(dir)).toLowerCase().replace(/[^a-z0-9]+/g, "-");
const words = (s) => String(s || "").replace(/\*/g, "").trim().split(/\s+/).filter(Boolean).length;

// what the agent wrote, checked before anything renders
function validate(story) {
  const errors = [];
  if (!Array.isArray(story.frames) || !story.frames.length) errors.push("story.json has no frames");
  (story.frames || []).forEach((f, i) => {
    const at = `frame ${i + 1}`;
    if (!KINDS.includes(f.kind)) errors.push(`${at}: kind "${f.kind}" is none of ${KINDS.join(", ")}`);
    if (f.theme && !["brand", "light", "dark", "photo"].includes(f.theme)) errors.push(`${at}: theme "${f.theme}" is none of brand, light, dark, photo`);
    if (f.theme === "photo" && !f.image) errors.push(`${at}: theme photo needs an image`);
    if (f.kind === "list" && !(f.items || []).length) errors.push(`${at}: a list needs items`);
    if (f.kind === "stat" && !f.value) errors.push(`${at}: a stat needs a value`);
    if (f.kind === "quote" && !(f.quote || f.title)) errors.push(`${at}: a quote needs its quote`);
    if (!["list", "stat", "quote", "product", "event"].includes(f.kind) && !f.title) errors.push(`${at}: no title`);
    const st = f.stickers || [];
    for (const s of st) if (!STICKERS[s.type]) errors.push(`${at}: sticker "${s.type}" is none of ${Object.keys(STICKERS).join(", ")}`);
    if (st.filter((s) => s.type === "link").length > 1) errors.push(`${at}: one link sticker per frame`);
    const interactive = st.filter((s) => ["poll", "question", "quiz", "countdown", "slider"].includes(s.type));
    if (interactive.length > 1) errors.push(`${at}: one interactive sticker (poll, question, quiz, countdown, slider) per frame`);
    for (const s of st) {
      if (s.type === "link" && !/^https:\/\//.test(s.url || story.link || "")) errors.push(`${at}: the link sticker needs an https link (its url, or the story's link)`);
      if (["poll", "quiz"].includes(s.type) && !(Array.isArray(s.options) && s.options.length >= 2 && s.options.length <= 4)) errors.push(`${at}: a ${s.type} needs 2 to 4 options`);
      if (["poll", "question", "quiz"].includes(s.type) && !s.question) errors.push(`${at}: a ${s.type} needs its question`);
      if (s.type === "countdown" && !s["end-time"]) errors.push(`${at}: a countdown needs its end-time`);
    }
    if (f.image && !resolveImage(f.image, story.__dir)) errors.push(`${at}: image ${f.image} not found`);
  });
  return errors;
}

// the contrast of a text against what lies under it, from the frame's picture without its text
function underText(png, rect) {
  let sum = 0, n = 0, lo = 1, hi = 0;
  const x0 = Math.max(0, Math.floor(rect.x)), y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(png.width, Math.ceil(rect.x + rect.w)), y1 = Math.min(png.height, Math.ceil(rect.y + rect.h));
  const step = Math.max(2, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 4000)));
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
    const i = (png.width * y + x) * 4;
    const l = luminance({ r: png.data[i], g: png.data[i + 1], b: png.data[i + 2] });
    sum += l; n++; lo = Math.min(lo, l); hi = Math.max(hi, l);
  }
  return n ? { mean: sum / n, lo, hi } : null;
}

async function build(dir) {
  const storyFile = path.join(dir, "story.json");
  if (!fs.existsSync(storyFile)) fail(`${storyFile} is missing: write the story first (see SKILL.md, "The story").`);
  const story = readJson(storyFile);
  story.__dir = dir;
  const errors = validate(story);
  if (errors.length) fail(errors.map((e) => `✗ ${e}`).join("\n"));
  const brandDir = opts.brand || "brand";
  const kit = design.read(brandDir);
  if (!kit) fail(`No brand kit in ${brandDir}/: make one with agentitos' brand-kit: node <brand-kit>/tools/kit.mjs draft <page-dir> ${brandDir}.`);
  const checked = design.check(kit, brandDir);
  if (checked.errors.length) fail(checked.errors.map((e) => `✗ brand: ${e}`).join("\n"));
  const brand = checked.brand;
  const name = nameOf(dir);
  const framesDir = path.join(dir, "frames");
  // the chat's pictures get a folder per build: an earlier message keeps showing the frames it showed
  const thumbs = path.join(opts.uploads || path.join("uploads", `story-${name}`), Date.now().toString(36));
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  fs.mkdirSync(thumbs, { recursive: true });
  const api = await connect();
  const host = await componentsHost(api);
  const fonts = await fontCss(brand);
  const n = story.frames.length;
  const out = [];
  let measure;
  try { measure = measureScript(); } catch (e) { fail(`✗ ${e.message}`); }
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    for (let i = 0; i < n; i++) {
      const frame = story.frames[i];
      const theme = defaultTheme(frame, i, n);
      const image = resolveImage(frame.image, dir);
      const html = framePage({ brand, frame, index: i, count: n, theme, image, link: story.link, lang: story.lang, fonts, host });
      const htmlFile = path.resolve(framesDir, `${nn(i)}.html`);
      fs.writeFileSync(htmlFile, html);
      await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
      await page.goto(`file://${htmlFile}`, { waitUntil: "load", timeout: 60000 });
      await page.evaluate(async () => {
        const wait = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
        if (window.__instaRender) await wait(window.__instaRender.waitForComponents(), 15000);
        await wait(document.fonts.ready, 15000);
        await wait(Promise.all([...document.images].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })))), 15000);
      });
      if (!(await page.evaluate(() => !!window.__instaRender))) fail(`✗ Storrito's sticker components did not load from ${host}/js/insta-components.js: is the machine online?`);
      const report = await page.evaluate(inFrame);
      // measured before the stickers and the text are hidden for the pictures below
      await page.addScriptTag({ content: measure });
      const laidOut = layout(await page.evaluate(() => platformZonesMeasure()), ["instagram-story"]);
      await page.evaluate(() => document.fonts.ready);
      // what a viewer sees, small, for the chat and the preview
      await page.setViewport({ width: W, height: H, deviceScaleFactor: 0.5 });
      const thumb = path.join(thumbs, `${nn(i)}.jpg`);
      await page.screenshot({ path: thumb, type: "jpeg", quality: 82 });
      await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
      // the picture Storrito gets: everything but the stickers, which Instagram draws itself
      await page.evaluate(() => document.querySelectorAll("insta-story insta-link, insta-story insta-poll, insta-story insta-question, insta-story insta-quiz, insta-story insta-countdown, insta-story insta-emoji-slider, insta-story insta-mention, insta-story insta-hashtag, insta-story insta-location").forEach((e) => (e.style.visibility = "hidden")));
      const bg = path.join(framesDir, `${nn(i)}.png`);
      await page.screenshot({ path: bg, type: "png" });
      // the ground under the text, for the contrast of text over a picture
      let ground = null;
      if (image) {
        await page.evaluate(() => document.querySelectorAll(".title, .body, .t, .kicker, .value, .price, .who, .date, .source, .logo, .arrow").forEach((e) => (e.style.visibility = "hidden")));
        // puppeteer answers a Uint8Array, pngjs reads a Buffer
        ground = PNG.sync.read(Buffer.from(await page.screenshot({ type: "png" })));
      }
      const notes = [];
      if (report.overflow > 0) notes.push(["✗", `${report.overflow}px of text do not fit: shorten the text${frame.image && frame.kind !== "cover" ? " or leave out the picture" : ""}`]);
      for (const f of report.fits) if (f.size <= f.min && report.overflow > 0) notes.push(["⚠", `${f.cls.split(" ")[0]} is at its smallest size (${f.size}px)`]);
      const wc = report.texts.reduce((s, t) => s + t.words, 0);
      if (wc > 40) notes.push(["⚠", `${wc} words: too many to read in the 5 seconds a story frame shows; keep to about 25`]);
      else if (wc > 28) notes.push(["⚠", `${wc} words: a lot for 5 seconds`]);
      const hook = frame.kind === "cover" ? String(frame.title || "").replace(/\*/g, "") : "";
      if (hook.length > 50) notes.push(["⚠", `the cover's title has ${hook.length} characters: a hook reads best under 40`]);
      for (const t of report.texts) {
        if (!ground || t.ownGround) continue;
        const g = underText(ground, t);
        if (!g) continue;
        const fg = parse(t.color);
        const worst = Math.min(contrast(fg, { r: 255 * g.hi ** (1 / 2.2), g: 255 * g.hi ** (1 / 2.2), b: 255 * g.hi ** (1 / 2.2) }), contrast(fg, { r: 255 * g.mean ** (1 / 2.2), g: 255 * g.mean ** (1 / 2.2), b: 255 * g.mean ** (1 / 2.2) }));
        if (worst < 3) notes.push(["⚠", `${t.cls.split(" ")[0]} over the picture: contrast ${worst.toFixed(1)}:1 where it is brightest; try theme "brand"/"light", another picture, or "focus"`]);
      }
      for (const im of report.images) {
        const [nw, nh] = im.natural;
        if (!nw) notes.push(["✗", `the picture did not load`]);
        else if (im.scale > 1.7) notes.push(["⚠", `the picture (${nw}×${nh}) is enlarged ${im.scale}×: it will look blurry; take a bigger one, or show it in a card (a cover or image frame with theme "light" or "brand")`]);
      }
      // the layout by platform-zones: text and stickers under Instagram's bar or reply field, on each
      // other, cut off; stickers too close (✗ stays ✗, its ! is a ⚠)
      for (const f of laidOut) {
        notes.push([f.level === "✗" ? "✗" : "⚠", `${f.kind === "text" ? `"${f.label}"` : `the ${f.label} sticker`} ${f.what}${f.kind === "sticker" && f.level === "✗" ? ": shorten the text above it" : ""}`]);
      }
      if (report.logo && report.logo.treatment === "could not be loaded") notes.push(["⚠", "the logo could not be loaded"]);
      out.push({
        n: i + 1, kind: frame.kind, theme, file: path.relative(dir, bg), thumb, bytes: fs.statSync(bg).size,
        aiGenerated: !!frame.aiImage, html: scheduleHtml(report.stickers), stickers: report.stickers.map(({ tag, attrs, left, top, width, height }) => ({ tag, attrs, left, top, width, height })),
        words: wc, logo: report.logo?.treatment, notes: notes.map(([level, text]) => `${level} ${text}`),
      });
    }
  } finally {
    await browser.close();
  }
  const hasLink = out.some((f) => f.stickers.some((s) => s.tag === "insta-link"));
  const storyNotes = [];
  if (!hasLink) storyNotes.push("⚠ no link sticker: the story links nowhere; the last frame usually carries it");
  if (n > 7) storyNotes.push(`⚠ ${n} frames: most viewers leave before the end of a story longer than 7`);
  const built = { name, link: story.link || null, built: new Date().toISOString(), brand: path.resolve(brandDir), host, frames: out, notes: storyNotes };
  const uploaded = await uploadFrames(api, dir, built);
  writeJson(path.join(dir, "frames.json"), built);
  const preview = opts.preview || path.join("artifacts", `story-${name}.html`);
  writePreview(preview, story, out);

  let bad = 0;
  for (const f of out) {
    const errs = f.notes.filter((x) => x.startsWith("✗")).length;
    bad += errs;
    console.log(`${nn(f.n - 1)} ${f.kind} (${f.theme}) ${f.words} words${f.stickers.length ? ", " + f.stickers.map((s) => s.tag.replace("insta-", "")).join(", ") : ""}${f.logo ? `, logo ${f.logo}` : ""} → ${f.thumb}`);
    for (const note of f.notes) console.log(`   ${note}`);
  }
  for (const note of storyNotes) console.log(note);
  console.log(`\nPreview beside the chat: ${preview}`);
  if (bad) { console.log(`\nFix the ✗ in story.json and build again.`); return; }
  console.log(`\nShow the frames in the chat (${thumbs}/NN.jpg).`);
  if (uploaded) console.log(`The pictures are uploaded; each frame's HTML for Storrito is in ${path.join(dir, "frames.edn")}: in the REPL (def frames <its content>), then schedule them as SKILL.md's steps 5 and 6 say.`);
  else console.log(`Storrito could not be reached from this tool: upload ${path.join(dir, "frames")}/NN.png yourself (create-temp-blob-upload-url, curl -T) and put each url into its frame's html in frames.json (for {{BACKGROUND}}).`);
}

// Each frame's picture as a temp-blob of the organization, and its HTML for Storrito with the
// picture's URL: frames.edn, for the agent's REPL. A picture that did not change since the last
// build keeps its upload (temp-blobs live about a day). Without Storrito: false, the html keeps
// {{BACKGROUND}}.
async function uploadFrames(api, dir, built) {
  if (!api) return false;
  const file = path.join(dir, "uploads.json");
  const before = fs.existsSync(file) ? readJson(file) : {};
  const now = {};
  for (const f of built.frames) {
    const png = fs.readFileSync(path.join(dir, f.file));
    const sha = crypto.createHash("sha256").update(png).digest("hex");
    const kept = before[sha];
    if (kept && Date.now() - Date.parse(kept.at) < 20 * 3600e3) { now[sha] = kept; }
    else {
      const tempBlobUuid = crypto.randomUUID();
      const res = await call(api, "create-temp-blob-upload-url", { tempBlobUuid, contentType: "image/png", contentLengthBytes: png.length });
      if (res.uploadUrl) {
        const put = await fetch(res.uploadUrl, { method: "PUT", headers: { "content-type": "image/png", "content-length": String(png.length) }, body: png, signal: AbortSignal.timeout(180000) });
        if (!put.ok) fail(`✗ frame ${f.n}: the upload answered HTTP ${put.status}; build again to retry.`);
      }
      now[sha] = { url: res.url, at: new Date().toISOString() };
    }
    f.url = now[sha].url;
    f.html = f.html.replace("{{BACKGROUND}}", f.url);
  }
  writeJson(file, now);
  const edn = (s) => JSON.stringify(s);
  fs.writeFileSync(path.join(dir, "frames.edn"), "[" + built.frames.map((f) => `{:n ${f.n} :kind ${edn(f.kind)} :ai-generated ${!!f.aiGenerated} :html ${edn(f.html)}}`).join("\n ") + "]\n");
  return true;
}

function writePreview(file, story, frames) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tiles = frames.map((f) => {
    const data = fs.readFileSync(f.thumb).toString("base64");
    const notes = f.notes.map((x) => `<li class="${x.startsWith("✗") ? "err" : "warn"}">${x.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</li>`).join("");
    return `<figure><div class="n">${f.n}</div><img src="data:image/jpeg;base64,${data}" alt=""><figcaption>${f.kind}${notes ? `<ul>${notes}</ul>` : ""}</figcaption></figure>`;
  }).join("");
  fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Story</title><style>
:root{color-scheme:light dark;--bg:#f3f3f1;--fg:#1d1d1f;--muted:#6b6b70}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--fg:#ececee;--muted:#9a9aa0}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.4 system-ui,sans-serif}
main{display:flex;gap:18px;padding:22px;overflow-x:auto;align-items:flex-start;min-height:100vh;box-sizing:border-box}
figure{margin:0;flex:none;width:min(300px,70vw);position:relative}
img{width:100%;aspect-ratio:9/16;border-radius:14px;display:block;box-shadow:0 8px 28px rgba(0,0,0,.18)}
.n{position:absolute;left:10px;top:10px;background:rgba(0,0,0,.6);color:#fff;border-radius:99px;padding:2px 9px;font-weight:600;font-size:13px}
figcaption{color:var(--muted);margin-top:8px}ul{margin:4px 0 0;padding-left:18px}li.err{color:#d33}li.warn{color:#b8860b}
</style></head><body><main>${tiles}</main></body></html>`);
}

if (cmd === "build" && pos[0]) await build(pos[0]);
else fail("Command: build <dir> [--brand brand] [--preview artifacts/story-<name>.html]. Checking, scheduling, the status and cancelling go through Storrito's procedures in the REPL (SKILL.md, steps 5 to 7).");
