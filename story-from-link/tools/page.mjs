#!/usr/bin/env node
// Reads a link for a story: what the page says (its main text, the facts of a product, an event or
// an article), its pictures, and its look (colours, fonts, logo). Made for agents: it prints what
// it found and what to do next.
//
//   node tools/page.mjs <url> <dir>
//
// <dir>/page.json   title, kind (article, product, event, page), language, facts, pictures, look
// <dir>/text.txt    the page's main text, as a reader would see it
// <dir>/images/     the page's pictures, the biggest first (01.jpg …)
// <dir>/logos/      the logo candidates: the file as the site has it and a picture of how it shows
// <dir>/page.png    the top of the page as a visitor sees it

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { launch, USER_AGENT, sleep } from "./lib/chrome.mjs";
import { readLook, dismissBanners } from "./lib/look.mjs";

const require = createRequire(import.meta.url);
const [url, dir] = process.argv.slice(2);
if (!url || !dir || !/^https?:\/\//.test(url)) {
  console.log("Usage: node tools/page.mjs <https://…> <dir>");
  process.exit(1);
}
fs.mkdirSync(path.join(dir, "images"), { recursive: true });

const browser = await launch();
try {
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setViewport({ width: 1280, height: 900 });
  let status = null;
  try {
    const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 40000 });
    status = res?.status() ?? null;
  } catch {
    try { status = (await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }))?.status() ?? null; await sleep(2500); } catch (e) {
      console.log(`✗ The page did not load: ${e.message}`);
      process.exit(1);
    }
  }
  if (status && status >= 400) console.log(`⚠ The page answered HTTP ${status}: what follows may be an error page.`);
  await dismissBanners(page);
  await page.screenshot({ path: path.join(dir, "page.png") });
  const look = await readLook(page, dir);

  // the main text, as Firefox's reader view finds it
  await page.addScriptTag({ path: require.resolve("@mozilla/readability/Readability.js") });
  const article = await page.evaluate(() => {
    try {
      // eslint-disable-next-line no-undef
      const a = new Readability(document.cloneNode(true), { charThreshold: 300 }).parse();
      if (!a) return null;
      const div = document.createElement("div");
      div.innerHTML = a.content || "";
      const images = [...div.querySelectorAll("img")].map((i) => i.getAttribute("src") || i.getAttribute("data-src")).filter(Boolean).map((s) => new URL(s, location.href).href);
      return { title: a.title, byline: a.byline, excerpt: a.excerpt, text: a.textContent, siteName: a.siteName, published: a.publishedTime, lang: a.lang, images };
    } catch { return null; }
  });
  // the pictures a story could show: big enough, in the order a visitor meets them
  const pictures = await page.evaluate(() => {
    const out = [];
    for (const i of document.querySelectorAll("img")) {
      const src = i.currentSrc || i.src;
      if (!src || src.startsWith("data:")) continue;
      const r = i.getBoundingClientRect();
      if (i.naturalWidth < 400 || i.naturalHeight < 300) continue;
      out.push({ src, w: i.naturalWidth, h: i.naturalHeight, alt: i.alt || "", shown: Math.round(r.width * r.height), top: Math.round(r.top + scrollY) });
    }
    return out;
  });

  // structured facts: a product's price, an event's date and place, an article's date
  const things = look.ld.flatMap((x) => (Array.isArray(x) ? x : x["@graph"] || [x])).filter(Boolean);
  const type = (t) => things.find((x) => [].concat(x["@type"] || []).some((y) => String(y).toLowerCase() === t));
  const facts = {};
  const product = type("product");
  if (product) {
    const offer = [].concat(product.offers || [])[0] || {};
    const offers = offer["@type"] === "AggregateOffer" ? offer : offer;
    facts.product = {
      name: product.name, description: product.description?.slice(0, 400), brand: product.brand?.name || product.brand,
      price: offers.price ?? offers.lowPrice, currency: offers.priceCurrency, availability: String(offers.availability || "").replace(/^https?:\/\/schema\.org\//, ""),
      rating: product.aggregateRating ? `${product.aggregateRating.ratingValue} (${product.aggregateRating.reviewCount || product.aggregateRating.ratingCount || "?"})` : undefined,
    };
  }
  const event = things.find((x) => [].concat(x["@type"] || []).some((y) => /event$/i.test(String(y))));
  if (event) {
    const loc = [].concat(event.location || [])[0] || {};
    facts.event = {
      name: event.name, start: event.startDate, end: event.endDate, place: loc.name, address: typeof loc.address === "string" ? loc.address : [loc.address?.streetAddress, loc.address?.postalCode, loc.address?.addressLocality].filter(Boolean).join(", ") || undefined,
      online: /online/i.test(String(event.eventAttendanceMode || "")) || undefined, status: String(event.eventStatus || "").replace(/^https?:\/\/schema\.org\//, "") || undefined,
    };
  }
  const art = things.find((x) => [].concat(x["@type"] || []).some((y) => /(article|posting|newsarticle|report)$/i.test(String(y))));
  if (art) facts.article = { headline: art.headline, published: art.datePublished, author: [].concat(art.author || []).map((a) => a?.name || a).filter(Boolean).join(", ") || undefined };
  const recipe = type("recipe");
  if (recipe) facts.recipe = { name: recipe.name, time: recipe.totalTime, yield: recipe.recipeYield };

  const text = (article?.text || "").replace(/\n\s*\n\s*\n+/g, "\n\n").replace(/[ \t]+/g, " ").trim();
  const words = text ? text.split(/\s+/).length : 0;
  const kind = facts.product ? "product" : facts.event ? "event" : facts.recipe ? "recipe" : facts.article || words > 350 ? "article" : "page";
  fs.writeFileSync(path.join(dir, "text.txt"), text + "\n");

  // download the pictures: the page's own (og:image) first, then the article's, then the biggest shown
  const order = [];
  const seen = new Set();
  const addPic = (src, extra = {}) => {
    if (!src) return;
    const key = src.replace(/[?#].*$/, "").replace(/-\d+x\d+(?=\.\w+$)/, "");
    if (seen.has(key)) return;
    seen.add(key);
    order.push({ src, ...extra });
  };
  addPic(look.ogImage, { from: "og:image" });
  for (const s of [].concat(product?.image || []).map((i) => i?.url || i)) addPic(s, { from: "product" });
  for (const s of article?.images || []) addPic(s, { from: "article" });
  for (const p of pictures.sort((a, b) => b.shown - a.shown)) addPic(p.src, { from: "page", alt: p.alt });
  const images = [];
  for (const p of order) {
    if (images.length >= 10) break;
    try {
      const res = await fetch(p.src, { headers: { "user-agent": USER_AGENT, referer: url }, signal: AbortSignal.timeout(20000) });
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !/^image\/(jpeg|png|webp|avif|gif)/.test(type)) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 15000) continue;
      const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("avif") ? "avif" : type.includes("gif") ? "gif" : "jpg";
      const file = `images/${String(images.length + 1).padStart(2, "0")}.${ext}`;
      fs.writeFileSync(path.join(dir, file), buf);
      const known = pictures.find((x) => x.src === p.src);
      images.push({ file, from: p.from, alt: p.alt || known?.alt || "", width: known?.w ?? null, height: known?.h ?? null, bytes: buf.length });
    } catch {}
  }
  // the size of each picture as Chrome decodes it
  for (const im of images.filter((i) => !i.width)) {
    try {
      const size = await page.evaluate(async (data) => {
        const i = new Image();
        i.src = data;
        await i.decode();
        return [i.naturalWidth, i.naturalHeight];
      }, `data:image/${path.extname(im.file).slice(1).replace("jpg", "jpeg")};base64,${fs.readFileSync(path.join(dir, im.file)).toString("base64")}`);
      [im.width, im.height] = size;
    } catch {}
  }

  const result = {
    url, finalUrl: look.url, kind, title: article?.title || look.title, siteName: article?.siteName || look.siteName || new URL(url).hostname.replace(/^www\./, ""),
    lang: article?.lang?.slice(0, 2) || look.lang, description: look.description, byline: article?.byline || undefined, published: article?.published || facts.article?.published || undefined,
    words, facts, images, headings: look.headings,
    look: { palette: look.palette, ranked: look.ranked, fonts: look.fonts, fontSources: look.fontSources, logos: look.logos, social: look.social, ctas: look.ctas, themeColor: look.themeColor },
  };
  fs.writeFileSync(path.join(dir, "page.json"), JSON.stringify(result, null, 2) + "\n");

  const lines = [];
  lines.push(`${result.title} — ${result.siteName} (${kind}, ${result.lang || "language unknown"}, ${words} words)`);
  if (result.description) lines.push(`  ${result.description.slice(0, 200)}`);
  if (facts.product) lines.push(`Product: ${[facts.product.name, facts.product.price != null ? `${facts.product.price} ${facts.product.currency || ""}`.trim() : null, facts.product.availability, facts.product.rating && `★ ${facts.product.rating}`].filter(Boolean).join(" · ")}`);
  if (facts.event) lines.push(`Event: ${[facts.event.name, facts.event.start, facts.event.place, facts.event.address, facts.event.online && "online"].filter(Boolean).join(" · ")}`);
  if (facts.article) lines.push(`Article: ${[facts.article.author, facts.article.published].filter(Boolean).join(" · ")}`);
  lines.push(`Text: ${path.join(dir, "text.txt")}${words > 2500 ? " (long: read what you need)" : ""}`);
  lines.push(`Pictures (${images.length}): ${images.map((i) => `${i.file} ${i.width || "?"}×${i.height || "?"}${i.alt ? ` "${i.alt.slice(0, 40)}"` : ""}`).join(", ") || "none"}`);
  const p = look.palette;
  lines.push(`Look: primary ${p.primary}${p.secondary ? ` · secondary ${p.secondary}` : ""}${p.tertiary ? ` · tertiary ${p.tertiary}` : ""} · surface ${p.surface} · on-surface ${p["on-surface"]}`);
  const f = look.fonts;
  const fam = (x) => (x ? `"${x.family}" ${x.weight}${x.uppercase ? " caps" : ""}${look.fontSources[x.family] === "google" ? " (Google)" : look.fontSources[x.family] ? " (site files)" : ""}` : "?");
  lines.push(`Fonts: display ${fam(f.display)} · body ${fam(f.body)}`);
  lines.push(`Logos: ${look.logos.map((l) => `${l.file || "?"} (${l.source}${l.colors?.length ? " " + l.colors.slice(0, 3).join(" ") : ""})`).join(", ") || "none found"}`);
  if (Object.keys(look.social).length) lines.push(`Social: ${Object.entries(look.social).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  console.log(lines.join("\n"));
  console.log(`\nNext: without a brand kit, node <skill>/tools/brand.mjs draft ${dir} brand; then write ${path.join(dir, "story.json")} and node <skill>/tools/story.mjs build ${dir}.`);
} finally {
  await browser.close();
}
