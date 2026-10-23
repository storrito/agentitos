#!/usr/bin/env node
// A story of a few frames from <dir>/story.json, in the look of a brand kit, rendered in Chrome
// with Storrito's own sticker components, checked, and scheduled on Instagram through Storrito.
// Made for agents: each command prints what it found and what to do next.
//
//   node tools/story.mjs build <dir> [--brand brand] [--preview artifacts/story-<name>.html]
//        [--platform instagram-story,tiktok,…]   where the story goes (else story.json's
//        "platforms", else Instagram Story): text and stickers keep clear of what each of those
//        apps lays over it (agentitos' platform-zones); for one outside Instagram also
//        <dir>/frames/NN.full.png, the frame with its stickers in the picture
//        <dir>/frames/NN.png: each frame's picture without its stickers (what is uploaded), the
//        stickers' places in <dir>/frames.json; uploads/story-<name>/<build>/NN.jpg: the frames as a
//        viewer sees them, small, for the chat; the preview page beside the chat shows them side by side
//   node tools/story.mjs accounts                    the Instagram accounts a story can go to
//   node tools/story.mjs publish <dir> --account <name>[,<name>…] (--at <ISO time> | --now)
//        [--facebook] [--draft [--folder "…"]]
//        uploads the frames and schedules them in their order on each account, or puts them into
//        Storrito's gallery as drafts; safe to run again, nothing is posted twice
//   node tools/story.mjs status <dir> [--wait 120]   each frame's status and the picture Storrito
//                                                    rendered of it
//   node tools/story.mjs cancel <dir>                takes every scheduled frame back

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PNG } from "pngjs";
import { launch, sleep } from "./lib/chrome.mjs";
import * as design from "./lib/design-md.mjs";
import { contrast, luminance, parse } from "./lib/colors.mjs";
import { KINDS, STICKERS, safeZone, HOME, W, H, framePage, inFrame, scheduleHtml, defaultTheme, resolveImage, fontCss } from "./lib/frames.mjs";
import { connect, call, componentsHost } from "./lib/storrito.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const FLAGS = ["now", "facebook", "draft"];
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
  if (story.platforms !== undefined && (!Array.isArray(story.platforms) || !story.platforms.every((x) => typeof x === "string"))) errors.push(`story.json's "platforms" is a list of platform-zones' names, as ["instagram-story", "tiktok"]`);
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
  if (!kit) fail(`No brand kit in ${brandDir}/: make one with node <skill>/tools/brand.mjs draft <page-dir> ${brandDir}.`);
  const checked = design.check(kit, brandDir);
  if (checked.errors.length) fail(checked.errors.map((e) => `✗ brand: ${e}`).join("\n"));
  const brand = checked.brand;
  const name = nameOf(dir);
  // where the story goes: Instagram draws the stickers itself; elsewhere they are part of the picture
  const platforms = opts.platform ? String(opts.platform).split(",").map((x) => x.trim()).filter(Boolean) : story.platforms || HOME;
  const SAFE = safeZone(platforms);
  const elsewhere = SAFE.names.filter((x) => !x.startsWith("Instagram"));
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
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    for (let i = 0; i < n; i++) {
      const frame = story.frames[i];
      const theme = defaultTheme(frame, i, n);
      const image = resolveImage(frame.image, dir);
      const html = framePage({ brand, frame, index: i, count: n, theme, image, link: story.link, lang: story.lang, fonts, host, platforms });
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
      await page.evaluate(() => document.fonts.ready);
      // what a viewer sees, small, for the chat and the preview
      await page.setViewport({ width: W, height: H, deviceScaleFactor: 0.5 });
      const thumb = path.join(thumbs, `${nn(i)}.jpg`);
      await page.screenshot({ path: thumb, type: "jpeg", quality: 82 });
      await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
      // for the platforms outside Instagram: the frame whole, its stickers in the picture
      const full = elsewhere.length ? path.join(framesDir, `${nn(i)}.full.png`) : null;
      if (full) await page.screenshot({ path: full, type: "png" });
      // the picture Storrito gets: everything but the stickers, which Instagram draws itself
      await page.evaluate(() => document.querySelectorAll("insta-story insta-link, insta-story insta-poll, insta-story insta-question, insta-story insta-quiz, insta-story insta-countdown, insta-story insta-emoji-slider, insta-story insta-mention, insta-story insta-hashtag, insta-story insta-location").forEach((e) => (e.style.visibility = "hidden")));
      const bg = path.join(framesDir, `${nn(i)}.png`);
      await page.screenshot({ path: bg, type: "png" });
      // the ground under the text, for the contrast of text over a picture
      let ground = null;
      if (image) {
        await page.evaluate(() => document.querySelectorAll(".title, .body, .t, .kicker, .value, .price, .who, .date, .source, .logo, .arrow").forEach((e) => (e.style.visibility = "hidden")));
        ground = PNG.sync.read(await page.screenshot({ type: "png" }));
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
      for (const s of report.stickers) {
        const r = s.rect;
        if (r.y < SAFE.top || r.y + r.h > SAFE.bottom || r.x < SAFE.left || r.x + r.w > SAFE.right) notes.push(["✗", `the ${s.tag.replace("insta-", "")} sticker leaves the safe zone of ${SAFE.names.join(", ")} (x ${r.x}–${r.x + r.w}, y ${r.y}–${r.y + r.h}): shorten the text above it`]);
        if (!s.width || !s.height) notes.push(["✗", `the ${s.tag.replace("insta-", "")} sticker has no size: it would not be tappable`]);
      }
      for (let a = 0; a < report.stickers.length; a++) for (let b = a + 1; b < report.stickers.length; b++) {
        const p = report.stickers[a].rect, q = report.stickers[b].rect;
        if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h) notes.push(["✗", "two stickers overlap"]);
      }
      if (report.logo && report.logo.treatment === "could not be loaded") notes.push(["⚠", "the logo could not be loaded"]);
      out.push({
        n: i + 1, kind: frame.kind, theme, file: path.relative(dir, bg), ...(full ? { full: path.relative(dir, full) } : {}), thumb, bytes: fs.statSync(bg).size,
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
  if (elsewhere.length && out.some((f) => f.stickers.length)) storyNotes.push(`⚠ on ${elsewhere.join(", ")} the stickers are only pictures: nobody can tap them there; put the link into the post's text`);
  for (const x of SAFE.notes.filter((x) => x.includes("stand"))) storyNotes.push(`  ${x}`);
  writeJson(path.join(dir, "frames.json"), { name, link: story.link || null, built: new Date().toISOString(), brand: path.resolve(brandDir), host, platforms, frames: out, notes: storyNotes });
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
  console.log(`\nLaid out clear of ${SAFE.names.join(", ")}.${elsewhere.length ? ` For ${elsewhere.join(", ")}: ${dir}/frames/NN.full.png, each frame with its stickers in the picture; publish puts the story on Instagram only.` : ""}`);
  console.log(`\nPreview beside the chat: ${preview}`);
  console.log(bad ? `\nFix the ✗ in story.json and build again.` : `\nShow the frames in the chat (${thumbs}/NN.jpg); once the person agrees: node <skill>/tools/story.mjs publish ${dir} --account <instagram> --at <time>`);
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

async function needApi() {
  const api = await connect();
  if (api) return api;
  fail(`Storrito cannot be reached from this tool (no gateway connection to Storrito, no STORRITO_API_URL and STORRITO_CREDENTIAL).
Do it with Storrito's procedures yourself, frame by frame in their order (frames.json has each frame's file and html):
  create-temp-blob-upload-url {tempBlobUuid, contentType "image/png", size}, then curl -sS -T <file> -H 'Content-Type: image/png' '<uploadUrl>';
  schedule-instagram-story {html (its {{BACKGROUND}} replaced by the temp-blob's url), instagramUsername, storyPostUuid (a new UUID, kept for retries), date}.`);
}

async function accounts() {
  const api = await needApi();
  const { socialAccounts } = await call(api, "list-social-accounts", {});
  const ig = socialAccounts.filter((a) => a.instagramUsername && a.postTypes.some((p) => p.procedure === "schedule-instagram-story"));
  if (!ig.length) console.log("No Instagram account takes stories yet: connect one in Storrito (create-connect-link makes a link).");
  for (const a of ig) {
    const fb = (a.facebookDestinations || []).map((d) => `${d.facebookDestinationName} (${d.facebookDestinationId})`).join(", ");
    console.log(`@${a.instagramUsername}${a.disconnected ? " — disconnected: reconnect it in Storrito" : ""}${fb ? ` · Facebook: ${fb}` : ""}`);
  }
}

async function publish(dir) {
  const framesFile = path.join(dir, "frames.json");
  if (!fs.existsSync(framesFile)) fail(`Build the story first: node <skill>/tools/story.mjs build ${dir}`);
  const built = readJson(framesFile);
  const errs = built.frames.flatMap((f) => f.notes.filter((x) => x.startsWith("✗")).map((x) => `frame ${f.n}: ${x}`));
  if (errs.length) fail(`${errs.join("\n")}\nFix these and build again before publishing.`);
  const draft = !!opts.draft;
  const accountsWanted = String(opts.account || "").split(",").map((s) => s.trim().replace(/^@/, "")).filter(Boolean);
  if (!draft && !accountsWanted.length) fail("Which account? --account <instagram username>[,<another>]");
  if (!draft && !opts.now && !opts.at) fail("When? --at 2026-10-22T18:00:00+02:00 (with the offset of the person's time zone) or --now");
  let date = null;
  if (!draft && opts.at) {
    const d = new Date(opts.at);
    if (isNaN(d)) fail(`--at ${opts.at} is no time: write it as 2026-10-22T18:00:00+02:00`);
    if (d.getTime() < Date.now() - 60000) fail(`--at ${opts.at} is in the past.`);
    date = d.toISOString();
  }
  const api = await needApi();
  const planFile = path.join(dir, "plan.json");
  const plan = fs.existsSync(planFile) ? readJson(planFile) : {};
  // the same frames keep their uploads; a new build gets new ones
  if (plan.built !== built.built) { plan.built = built.built; plan.uploads = {}; }
  plan.uploads ||= {};
  plan.posts ||= [];
  const save = () => writeJson(planFile, plan);
  // frames of an earlier build that are still scheduled: taken back first, so that nothing goes twice
  const live = (p) => p.done && !["canceled", "deleted", "failed"].includes(p.status);
  const stale = plan.posts.filter((p) => live(p) && p.built !== built.built);
  if (stale.length) fail(`${stale.length} frames of an earlier build of this story are still ${stale[0].draft ? "drafts" : "scheduled"}. Take them back with node <skill>/tools/story.mjs cancel ${dir}, then publish again.`);
  let facebook = null;
  if (opts.facebook && !draft) {
    const { socialAccounts } = await call(api, "list-social-accounts", {});
    facebook = Object.fromEntries(socialAccounts.filter((a) => a.instagramUsername).map((a) => [a.instagramUsername, a.facebookDestinations || []]));
  }
  for (const f of built.frames) {
    const key = String(f.n);
    if (plan.uploads[key]?.url) continue;
    const file = path.join(dir, f.file);
    const size = fs.statSync(file).size;
    const tempBlobUuid = plan.uploads[key]?.uuid || crypto.randomUUID();
    plan.uploads[key] = { uuid: tempBlobUuid };
    save();
    const res = await call(api, "create-temp-blob-upload-url", { tempBlobUuid, contentType: "image/png", size });
    if (res.uploadUrl) {
      const put = await fetch(res.uploadUrl, { method: "PUT", headers: { "content-type": "image/png", "content-length": String(size) }, body: fs.readFileSync(file), signal: AbortSignal.timeout(180000) });
      if (!put.ok) fail(`✗ frame ${f.n}: the upload answered HTTP ${put.status}; run publish again to retry.`);
    }
    plan.uploads[key] = { uuid: tempBlobUuid, url: res.url };
    save();
    console.log(`frame ${f.n} uploaded`);
  }
  const targets = draft ? [null] : accountsWanted;
  for (const account of targets) {
    for (const f of built.frames) {
      const key = draft ? `draft:${f.n}` : `${account}:${f.n}`;
      let post = plan.posts.find((p) => p.key === key && p.built === built.built && !["canceled", "deleted"].includes(p.status));
      if (post?.done) continue;
      if (!post) { post = { key, account, frame: f.n, uuid: crypto.randomUUID(), built: built.built }; plan.posts.push(post); save(); }
      const html = f.html.replace("{{BACKGROUND}}", plan.uploads[String(f.n)].url);
      try {
        if (draft) {
          const res = await call(api, "create-draft", { html, draftUuid: post.uuid, name: `${built.name} ${f.n}/${built.frames.length}`.slice(0, 200), folderName: opts.folder || "Stories from links" });
          Object.assign(post, { done: true, draft: true, editorUrl: res.editorUrl, warnings: res.warnings || [] });
        } else {
          const params = { html, instagramUsername: account, storyPostUuid: post.uuid, ...(date ? { date } : {}), ...(f.aiGenerated ? { aiGenerated: true } : {}) };
          if (facebook) {
            const dests = facebook[account] || [];
            if (dests.length) Object.assign(params, { shareToFacebook: true, facebookDestinationId: dests[0].facebookDestinationId });
          }
          const res = await call(api, "schedule-instagram-story", params);
          Object.assign(post, { done: true, status: res.status, date: date || "now", warnings: res.warnings || [] });
        }
      } catch (e) {
        post.error = e.message;
        save();
        fail(`✗ ${draft ? "draft" : "@" + account} frame ${f.n}: ${e.message}\nRun publish again with the same options: what is done stays done.`);
      }
      delete post.error;
      save();
      console.log(`${draft ? "draft" : "@" + account} frame ${f.n}: ${draft ? "in the gallery" : post.status}${post.warnings.length ? " — " + post.warnings.join(" | ") : ""}`);
    }
  }
  console.log(`\nNext: node <skill>/tools/story.mjs status ${dir} --wait 120 shows what Storrito rendered.`);
}

async function status(dir) {
  const planFile = path.join(dir, "plan.json");
  if (!fs.existsSync(planFile)) fail("Nothing published yet.");
  const plan = readJson(planFile);
  const api = await needApi();
  const until = Date.now() + Number(opts.wait || 0) * 1000;
  for (;;) {
    let pending = 0;
    for (const p of plan.posts.filter((x) => x.done && x.built === plan.built)) {
      try {
        const res = p.draft ? await call(api, "status-draft", { draftUuid: p.uuid }) : await call(api, "status-instagram-story", { storyPostUuid: p.uuid });
        Object.assign(p, { status: res.status, previewUrl: res.previewUrl || p.previewUrl, errorMessage: res.errorMessage, editorUrl: res.editorUrl || p.editorUrl });
        if (!res.previewUrl && !["failed", "canceled", "deleted"].includes(res.status)) pending++;
      } catch (e) { p.statusError = e.message; }
    }
    writeJson(planFile, plan);
    if (!pending || Date.now() > until) break;
    await sleep(10000);
  }
  for (const p of plan.posts.filter((x) => x.done && x.built === plan.built)) {
    console.log(`${p.draft ? "draft" : "@" + p.account} frame ${p.frame}: ${p.status}${p.errorMessage ? ` (${p.errorMessage})` : ""}${p.previewUrl ? ` · rendered ${p.previewUrl}` : " · not rendered yet"}${p.editorUrl ? ` · editor ${p.editorUrl}` : ""}`);
  }
}

async function cancel(dir) {
  const planFile = path.join(dir, "plan.json");
  if (!fs.existsSync(planFile)) fail("Nothing published yet.");
  const plan = readJson(planFile);
  const api = await needApi();
  for (const p of plan.posts.filter((x) => x.done && !["canceled", "deleted"].includes(x.status))) {
    const res = p.draft ? await call(api, "delete-draft", { draftUuid: p.uuid }) : await call(api, "cancel-instagram-story", { storyPostUuid: p.uuid });
    p.status = res.status || "deleted";
    writeJson(planFile, plan);
    console.log(`${p.draft ? "draft" : "@" + p.account} frame ${p.frame}: ${p.status}`);
  }
}

const commands = { build, publish, status, cancel };
if (cmd === "accounts") await accounts();
else if (commands[cmd] && pos[0]) await commands[cmd](pos[0]);
else fail("Commands: build <dir>, accounts, publish <dir> --account … --at …|--now [--facebook] [--draft], status <dir>, cancel <dir>");
