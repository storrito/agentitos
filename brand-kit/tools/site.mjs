#!/usr/bin/env node
// Reads a brand's website for its brand kit: the look (logo candidates, colours by where they are
// used, fonts by role and where their files come from), the way it speaks (headlines, button
// texts, the description, its about page), its social profiles, and how it looks on a desktop
// and on a phone. Made for agents: it prints what it found and what to do next.
//
//   node tools/site.mjs <url> <dir>
//
// <dir>/site.json            everything found, the look as page.json of story-from-link has it
// <dir>/logos/               the logo candidates: the file as the site has it, a picture of how it shows
// <dir>/home.png, mobile.png the start page on a desktop and on a phone
// <dir>/words.txt            the site's own words: headlines, button texts, the about page

import fs from "node:fs";
import path from "node:path";
import { launch, USER_AGENT, sleep } from "./lib/chrome.mjs";
import { readLook, dismissBanners } from "./lib/look.mjs";

const [url, dir] = process.argv.slice(2);
if (!url || !dir || !/^https?:\/\//.test(url)) {
  console.log("Usage: node tools/site.mjs <https://…> <dir>");
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });

async function open(page, target) {
  try {
    await page.goto(target, { waitUntil: "networkidle2", timeout: 40000 });
  } catch {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(2500);
  }
  await dismissBanners(page);
}

// the words a visitor reads first: big type, the lead paragraphs, the buttons, the menu
function words() {
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();
  const big = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!shown(el)) continue;
    const t = own(el);
    if (t.length < 4) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size >= 26) big.push(t);
  }
  const leads = [...document.querySelectorAll("main p, section p, header p, p")].filter(shown).map((p) => p.innerText.replace(/\s+/g, " ").trim()).filter((t) => t.length > 40).slice(0, 8);
  const nav = [...document.querySelectorAll("nav a, header a")].filter(shown).map((a) => a.innerText.replace(/\s+/g, " ").trim()).filter((t) => t && t.length < 30);
  const about = [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.href, text: (a.innerText || "").trim() }))
    .find((a) => /^(about|about us|über uns|ueber uns|wir|unsere geschichte|our story|story|mission|team|unternehmen|company|à propos|qui sommes-nous|sobre nosotros|chi siamo)$/i.test(a.text) && a.href.startsWith(location.origin));
  return { big: [...new Set(big)].slice(0, 20), leads, nav: [...new Set(nav)].slice(0, 16), about: about?.href || null };
}

const browser = await launch();
try {
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setViewport({ width: 1280, height: 900 });
  await open(page, url);
  await page.screenshot({ path: path.join(dir, "home.png") });
  const look = await readLook(page, dir);
  const home = await page.evaluate(words);
  let about = null;
  if (home.about) {
    try {
      await open(page, home.about);
      about = { url: home.about, ...(await page.evaluate(words)) };
      about.text = await page.evaluate(() => {
        const main = document.querySelector("main, article, [role=main]") || document.body;
        return main.innerText.replace(/\n{3,}/g, "\n\n").trim().slice(0, 3000);
      });
    } catch {}
  }
  // the phone's view: a story is seen on one
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await open(page, url);
  await page.screenshot({ path: path.join(dir, "mobile.png") });

  const lines = [
    `# ${look.title || url}`, look.description ? `Description: ${look.description}` : null,
    "", "## Big type", ...home.big.map((t) => `- ${t}`),
    "", "## Lead paragraphs", ...home.leads.map((t) => `- ${t}`),
    "", "## Buttons", ...look.ctas.map((t) => `- ${t}`),
    "", "## Menu", home.nav.join(" · "),
    ...(about ? ["", `## About page (${about.url})`, about.text] : []),
  ].filter((l) => l !== null);
  fs.writeFileSync(path.join(dir, "words.txt"), lines.join("\n") + "\n");

  const site = {
    url, finalUrl: look.url, name: look.siteName || new URL(look.url || url).hostname.replace(/^www\./, ""), lang: look.lang,
    description: look.description, title: look.title, about: about?.url || null,
    look: { palette: look.palette, ranked: look.ranked, fonts: look.fonts, fontSources: look.fontSources, logos: look.logos, social: look.social, ctas: look.ctas, themeColor: look.themeColor },
  };
  fs.writeFileSync(path.join(dir, "site.json"), JSON.stringify(site, null, 2) + "\n");

  const p = look.palette;
  const fam = (x) => (x ? `"${x.family}" ${x.weight}${x.uppercase ? " caps" : ""}${look.fontSources[x.family] === "google" ? " (Google)" : look.fontSources[x.family] ? " (site files)" : " (no files found)"}` : "?");
  console.log([
    `${site.name} — ${look.title || ""} (${look.lang || "language unknown"})`,
    `Colours: primary ${p.primary}${p.secondary ? ` · secondary ${p.secondary}` : ""}${p.tertiary ? ` · tertiary ${p.tertiary}` : ""} · surface ${p.surface} · on-surface ${p["on-surface"]}`,
    `  ranked: ${look.ranked.map((c) => `${c.hex} (${c.roles.join(",")})`).join(" · ") || "no colour of its own: a black and white brand"}`,
    `Fonts: display ${fam(look.fonts.display)} · body ${fam(look.fonts.body)} · label ${fam(look.fonts.label)}`,
    `Logos: ${look.logos.map((l) => `${l.file || "?"} (${l.source}${l.colors?.length ? " " + l.colors.slice(0, 3).join(" ") : ""})`).join(", ") || "none found: ask for one"}`,
    `Social: ${Object.entries(look.social).map(([k, v]) => `${k} ${v}`).join(" · ") || "none linked"}`,
    `Words: ${path.join(dir, "words.txt")}${about ? ` (with the about page)` : ""} · Pictures: ${path.join(dir, "home.png")}, ${path.join(dir, "mobile.png")}`,
    "", `Next: node <skill>/tools/kit.mjs draft ${dir} brand`,
  ].join("\n"));
} finally {
  await browser.close();
}
