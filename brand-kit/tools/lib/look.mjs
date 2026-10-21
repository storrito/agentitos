// What a page shows of its brand, read in Chrome: the colours by where they are used, the fonts by
// role, the logo, the social profiles, the button texts. `readLook(page, dir)` writes the logo
// candidates and the brand's font files into `dir` and returns the look as data.

import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { chromatic, contrast, group, hex, hsl, luminance, onColor, parse, distance } from "./colors.mjs";
import { sleep } from "./chrome.mjs";

const ACCEPT = /^(accept( all)?( cookies)?|allow( all)?( cookies)?|agree|i agree|ok|okay|got it|alle akzeptieren|akzeptieren|alle cookies akzeptieren|alle zulassen|zulassen|zustimmen|einverstanden|verstanden|ich stimme zu|accepter|tout accepter|j'accepte|aceptar|aceptar todo|accetta|accetta tutto|accepteren|alles accepteren)$/i;

// cookie banners: the usual consent managers, then any button that says "accept", also inside
// shadow roots; what still covers the page afterwards is hidden
export async function dismissBanners(page) {
  const clicked = await page.evaluate((source) => {
    const accept = new RegExp(source, "i");
    const ids = ["#onetrust-accept-btn-handler", "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll", "#CybotCookiebotDialogBodyButtonAccept",
      "[data-testid=uc-accept-all-button]", ".cmpboxbtnyes", "#didomi-notice-agree-button", ".fc-cta-consent", "[data-cookiefirst-action=accept]"];
    const roots = [document];
    for (const el of document.querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
    for (const root of roots) {
      for (const sel of ids) {
        const el = root.querySelector(sel);
        if (el) { el.click(); return sel; }
      }
    }
    for (const root of roots) {
      for (const el of root.querySelectorAll("button, a, [role=button], input[type=button], input[type=submit]")) {
        const t = (el.innerText || el.value || "").trim().replace(/\s+/g, " ");
        if (t && t.length < 40 && accept.test(t)) { el.click(); return t; }
      }
    }
    return null;
  }, ACCEPT.source);
  if (clicked) await sleep(900);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "sticky") continue;
      const id = `${el.id} ${el.className}`.toLowerCase();
      if (/cookie|consent|gdpr|cmp|privacy|usercentrics|onetrust|didomi|cookiebot/.test(id)) el.style.setProperty("display", "none", "important");
    }
  });
  return clicked;
}

// runs in the page
function inPage() {
  const vw = innerWidth, vh = innerHeight;
  const rgba = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s || "");
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  };
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const colors = {};
  const add = (c, w, role) => {
    if (!c || c.a < 0.5 || !(w > 0)) return;
    const h = hex(c);
    const e = (colors[h] ||= { hex: h, weight: 0, roles: {} });
    e.weight += w;
    e.roles[role] = (e.roles[role] || 0) + w;
  };
  const shown = (cs) => cs.display !== "none" && cs.visibility !== "hidden" && +cs.opacity > 0.1;
  const limit = vh * 3;
  let largest = null;
  const display = {};
  for (const el of document.querySelectorAll("body, body *")) {
    const tag = el.tagName.toLowerCase();
    if (el.closest("svg") && tag !== "svg") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.top > limit || r.bottom < 0 || r.right < 0 || r.left > vw) continue;
    const cs = getComputedStyle(el);
    if (!shown(cs)) continue;
    const area = Math.max(0, Math.min(r.bottom, limit) - Math.max(r.top, 0)) * Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) / (vw * vh);
    const bg = rgba(cs.backgroundColor);
    const buttonish = tag === "button" || el.getAttribute("role") === "button" || (tag === "a" && parseFloat(cs.paddingLeft) >= 8 && bg && bg.a > 0.5);
    add(bg, buttonish ? Math.max(area, 0.01) : area, buttonish ? "button" : "background");
    for (const m of (cs.backgroundImage || "").matchAll(/rgba?\([^)]+\)/g)) add(rgba(m[0]), area / 2, "gradient");
    if (parseFloat(cs.borderTopWidth) >= 2) add(rgba(cs.borderTopColor), 0.002, "border");
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").trim();
    if (own) {
      const size = parseFloat(cs.fontSize);
      const w = Math.min(own.length, 200) * size * size / 1e5;
      const role = /^h[1-3]$/.test(tag) || size >= 28 ? "heading" : tag === "a" ? "link" : buttonish ? "button-text" : "text";
      add(rgba(cs.color), w, role);
      if (r.top < vh * 1.2 && size >= 24 && own.length > 3 && (!largest || size > largest.size)) largest = { el, size };
      // the display font: the one most big text is set in, not the single biggest line
      if (size >= 26 && own.length > 2) {
        const key = `${cs.fontFamily}|${cs.fontWeight}`;
        const e = (display[key] ||= { el, weight: 0 });
        e.weight += size * Math.min(own.length, 60);
      }
    }
    if (tag === "svg") add(rgba(cs.fill), area / 4, "graphic");
  }

  const generic = /^(serif|sans-serif|monospace|system-ui|-apple-system|blinkmacsystemfont|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|cursive|fantasy|emoji|math|fangsong|segoe ui|helvetica neue|helvetica|arial|roboto|apple color emoji|segoe ui emoji|segoe ui symbol|noto color emoji)$/i;
  const family = (stack) => {
    const names = stack.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    const own = names.filter((n) => !generic.test(n));
    const loaded = own.find((n) => { try { return document.fonts.check(`16px "${n}"`); } catch { return false; } });
    return loaded || own[0] || null;
  };
  // a stack of the system's fonts only (system-ui, Helvetica, Arial …): its kind
  const kind = (stack) => (/monospace/i.test(stack) ? "monospace" : /(^|,)\s*["']?(ui-)?serif\b/i.test(stack) && !/sans-serif/i.test(stack) ? "serif" : "sans-serif");
  const fontOf = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const own = family(cs.fontFamily);
    return {
      family: own, system: own ? null : kind(cs.fontFamily), stack: cs.fontFamily, weight: +cs.fontWeight || 400, size,
      uppercase: cs.textTransform === "uppercase", letterSpacing: cs.letterSpacing === "normal" ? 0 : +(parseFloat(cs.letterSpacing) / size).toFixed(3),
      lineHeight: cs.lineHeight === "normal" ? null : +(parseFloat(cs.lineHeight) / size).toFixed(2), sample: (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80),
    };
  };
  const visibleText = (sel) => [...document.querySelectorAll(sel)].find((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && (e.innerText || "").trim().length > 2 && shown(getComputedStyle(e));
  });
  // the body font: the one most running text is set in, small print left out
  const bodyFonts = {};
  for (const p of document.querySelectorAll("p, li, article div, main div")) {
    const t = [...p.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").trim();
    if (t.length < 40 || !p.getBoundingClientRect().height) continue;
    const cs = getComputedStyle(p);
    if (parseFloat(cs.fontSize) < 14 || p.closest("footer, [class*=cookie i], [class*=consent i], [class*=newsletter i], [class*=legal i]")) continue;
    const e = (bodyFonts[`${cs.fontFamily}|${cs.fontWeight}`] ||= { el: p, weight: 0 });
    e.weight += t.length;
  }
  const bodyEl = Object.values(bodyFonts).sort((a, b) => b.weight - a.weight)[0]?.el || visibleText("p, li");
  const fonts = {
    display: fontOf(Object.values(display).sort((a, b) => b.weight - a.weight)[0]?.el || largest?.el || visibleText("h1") || visibleText("h2")),
    heading: fontOf(visibleText("h2") || visibleText("h1")),
    body: fontOf(bodyEl),
    label: fontOf(visibleText("button, a[class*=btn], a[class*=button], [role=button]") || visibleText("nav a, header a")),
  };

  // logo candidates: images and SVGs at the top, linked home, named logo; partner rows left out
  const home = new URL("/", location.href).href;
  const homeLink = (a) => a && (a.href === home || a.href === location.origin || a.getAttribute("href") === "/" || a.href === home + "#" || /^\/?(index\.html?)?$/.test(a.getAttribute("href") || "x"));
  const logos = [];
  for (const el of document.querySelectorAll("img, svg, picture, [class*=logo i], [id*=logo i]")) {
    const tag = el.tagName.toLowerCase();
    const cs = getComputedStyle(el);
    const isBox = tag !== "img" && tag !== "svg" && tag !== "picture";
    if (isBox && !/url\(/.test(cs.backgroundImage)) continue;
    if (el.closest("picture") && tag === "img" && logos.some((l) => l.el === el.closest("picture"))) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 16 || r.height < 10 || r.top > 420 || r.top < -5 || r.left < -5 || r.right > vw + 5 || r.width > 640 || r.height > 260) continue;
    if (!shown(cs)) continue;
    const a = el.closest("a");
    const attrs = [el.getAttribute("class"), el.id, el.getAttribute("alt"), el.getAttribute("src"), el.getAttribute("aria-label"), el.getAttribute("title"),
      a?.getAttribute("class"), a?.getAttribute("aria-label"), a?.getAttribute("title"), el.parentElement?.getAttribute("class")].join(" ");
    const siblings = el.parentElement ? el.parentElement.querySelectorAll("img, svg").length : 0;
    let score = 0;
    if (/logo|brand|wordmark|signet/i.test(attrs)) score += 3;
    if (homeLink(a)) score += 3;
    if (el.closest("header, nav, [class*=header i], [class*=nav i], [id*=header i]")) score += 2;
    if (r.top < 160) score += 1;
    const ratio = r.width / r.height;
    if (ratio >= 1 && ratio <= 8) score += 1;
    if (siblings > 4) score -= 3; // a row of partner or payment logos
    if (/partner|payment|award|press|trust|badge|flag|icon|avatar|cart|search|menu/i.test(attrs)) score -= 2;
    if (score < 4) continue;
    let svg = null;
    if (tag === "svg") {
      const clone = el.cloneNode(true);
      const paint = (src, dst) => {
        const s = getComputedStyle(src);
        if (s.fill && s.fill !== "none") dst.setAttribute("fill", s.fill);
        if (s.stroke && s.stroke !== "none") dst.setAttribute("stroke", s.stroke);
        [...src.children].forEach((c, i) => dst.children[i] && paint(c, dst.children[i]));
      };
      paint(el, clone);
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
      clone.setAttribute("width", String(Math.round(r.width)));
      clone.setAttribute("height", String(Math.round(r.height)));
      // <use> pointing into a sprite elsewhere on the page: the symbols go along
      for (const use of clone.querySelectorAll("use")) {
        const ref = (use.getAttribute("href") || use.getAttribute("xlink:href") || "").replace(/^#/, "");
        const target = ref && document.getElementById(ref);
        if (target) {
          const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
          g.innerHTML = target.innerHTML;
          use.replaceWith(g);
        }
      }
      svg = clone.outerHTML;
    }
    const src = tag === "img" ? el.currentSrc || el.src : tag === "picture" ? el.querySelector("img")?.currentSrc : isBox ? (/url\(["']?([^"')]+)/.exec(cs.backgroundImage) || [])[1] : null;
    logos.push({ el, score, tag, src: src || null, svg, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, alt: el.getAttribute("alt") || a?.getAttribute("aria-label") || null });
  }
  logos.sort((a, b) => b.score - a.score || a.rect.y - b.rect.y);
  const meta = (n) => document.querySelector(`meta[property="${n}"], meta[name="${n}"]`)?.content || null;
  const icons = [...document.querySelectorAll("link[rel~=icon], link[rel=apple-touch-icon], link[rel=apple-touch-icon-precomposed], link[rel=mask-icon]")]
    .map((l) => ({ rel: l.getAttribute("rel"), href: l.href, sizes: l.getAttribute("sizes") }));
  const manifest = document.querySelector("link[rel=manifest]")?.href || null;
  const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { return JSON.parse(s.textContent); } catch { return null; } }).filter(Boolean);
  const links = [...new Set([...document.querySelectorAll("a[href]")].map((a) => a.href))];
  const ctas = [...new Set([...document.querySelectorAll("a, button")].filter((e) => {
    const c = rgba(getComputedStyle(e).backgroundColor);
    const r = e.getBoundingClientRect();
    return c && c.a > 0.5 && r.width > 40 && r.height > 20 && (e.innerText || "").trim();
  }).map((e) => e.innerText.trim().replace(/\s+/g, " ")).filter((t) => t.length > 1 && t.length < 40))].slice(0, 16);
  const fontFaces = [];
  for (const sheet of document.styleSheets) {
    let rules = null;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules || []) {
      if (rule.type === CSSRule.FONT_FACE_RULE) fontFaces.push({ css: rule.cssText, base: sheet.href || location.href });
    }
  }
  return {
    url: location.href, title: document.title, lang: (document.documentElement.lang || "").slice(0, 2) || null,
    description: meta("description") || meta("og:description"), siteName: meta("og:site_name"), ogImage: meta("og:image"),
    themeColor: meta("theme-color"), colors: Object.values(colors), fonts,
    logos: logos.slice(0, 5).map(({ el, ...l }) => l), icons, manifest, ld, links, ctas,
    headings: [...document.querySelectorAll("h1, h2")].map((h) => h.innerText.trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, 12),
    googleFonts: [...document.querySelectorAll('link[href*="fonts.googleapis.com"], link[href*="fonts.bunny.net"]')].map((l) => l.href),
    sheets: [...document.styleSheets].map((s) => s.href).filter(Boolean),
    fontFaces,
  };
}

const SOCIAL = [
  ["instagram", /instagram\.com\/(?!p\/|reel\/|explore\/|accounts\/|about\/|legal\/)([A-Za-z0-9_.]{2,30})/i],
  ["tiktok", /tiktok\.com\/@([A-Za-z0-9_.]{2,30})/i],
  ["youtube", /youtube\.com\/(@[A-Za-z0-9_.-]{2,40}|channel\/[A-Za-z0-9_-]{10,}|c\/[A-Za-z0-9_.-]+|user\/[A-Za-z0-9_.-]+)/i],
  ["facebook", /facebook\.com\/(?!sharer|share|dialog|privacy|policy|help|legal|tr\b|plugins)([A-Za-z0-9_.-]{2,60})/i],
  ["linkedin", /linkedin\.com\/(company\/[A-Za-z0-9_.-]+|in\/[A-Za-z0-9_.-]+)/i],
  ["pinterest", /pinterest\.[a-z.]+\/(?!pin\/)([A-Za-z0-9_.-]{2,40})/i],
  ["threads", /threads\.(?:net|com)\/@([A-Za-z0-9_.]{2,30})/i],
  ["x", /(?:twitter|x)\.com\/(?!intent|share|home|i\/)([A-Za-z0-9_]{2,15})/i],
];

export function socialProfiles(links) {
  const out = {};
  for (const href of links) {
    for (const [name, re] of SOCIAL) {
      const m = re.exec(href);
      if (m && !out[name]) out[name] = m[1].replace(/\/$/, "");
    }
  }
  return out;
}

// the colours of a picture's opaque pixels, grouped
export function pictureColors(file) {
  let png;
  try { png = PNG.sync.read(fs.readFileSync(file)); } catch { return []; }
  const counts = {};
  const step = Math.max(1, Math.floor(Math.sqrt((png.width * png.height) / 6000)));
  for (let y = 0; y < png.height; y += step) {
    for (let x = 0; x < png.width; x += step) {
      const i = (png.width * y + x) * 4;
      if (png.data[i + 3] < 200) continue;
      const q = (v) => Math.round(v / 8) * 8;
      const h = hex({ r: q(png.data[i]), g: q(png.data[i + 1]), b: q(png.data[i + 2]) });
      counts[h] = (counts[h] || 0) + 1;
    }
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return group(Object.entries(counts).map(([h, n]) => ({ hex: h, weight: n / total, roles: {} })), 14).slice(0, 5);
}

// the palette's roles: the brand's colours first (the logo's, the buttons', the links'), then the
// light ground and the dark ink the page sets its text in
export function proposePalette(colors, logoColors = [], themeColor = null) {
  const pool = group(colors.map((c) => ({ ...c, hex: c.hex.toUpperCase() })));
  for (const lc of logoColors) {
    const same = pool.find((p) => distance(p.hex, lc.hex) < 14);
    if (same) same.roles.logo = (same.roles.logo || 0) + lc.weight;
    else pool.push({ hex: lc.hex, weight: lc.weight * 0.2, roles: { logo: lc.weight } });
  }
  if (themeColor && parse(themeColor)) {
    const tc = hex(parse(themeColor));
    const same = pool.find((p) => distance(p.hex, tc) < 14);
    if (same) same.roles.theme = 1;
    else pool.push({ hex: tc, weight: 0.05, roles: { theme: 1 } });
  }
  const R = (c, k) => c.roles[k] || 0;
  const brandScore = (c) => 8 * R(c, "logo") + 30 * R(c, "button") + 4 * R(c, "link") + 3 * R(c, "heading") + 1.5 * R(c, "gradient") + 2 * R(c, "background") + 0.3 * R(c, "text") + 2 * R(c, "theme") + 3 * R(c, "border");
  const brand = pool.filter((c) => chromatic(c.hex)).map((c) => ({ ...c, score: brandScore(c) })).sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of brand) {
    if (picked.every((p) => distance(p.hex, c.hex) > 22)) picked.push(c);
    if (picked.length === 3) break;
  }
  const lights = pool.filter((c) => luminance(c.hex) > 0.82).sort((a, b) => R(b, "background") - R(a, "background"));
  const surface = lights[0]?.hex || "#FFFFFF";
  const darks = pool.filter((c) => contrast(c.hex, surface) >= 7 && hsl(c.hex).s < 0.5)
    .sort((a, b) => (R(b, "text") + R(b, "heading")) - (R(a, "text") + R(a, "heading")));
  const ink = darks[0]?.hex || "#111111";
  // a brand without a colour of its own (black on white, black on cream): its ink is the brand
  const primary = picked[0]?.hex || ink;
  const palette = { primary };
  if (picked[1]) palette.secondary = picked[1].hex;
  if (picked[2]) palette.tertiary = picked[2].hex;
  palette.surface = surface;
  palette["on-surface"] = ink;
  // big type on the brand colour: light when it reads (3:1 is enough for type this size), else the ink
  palette["on-primary"] = contrast(surface, primary) >= 3 ? surface : onColor(primary, ink, surface);
  return { palette, ranked: brand.slice(0, 8).map(({ hex, score, roles }) => ({ hex, score: +score.toFixed(3), roles: Object.keys(roles) })) };
}

async function download(url, file) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  return { type: res.headers.get("content-type") || "", size: buf.length };
}

const extOf = (url, type) => {
  if (/svg/.test(type) || /\.svg(\?|$)/i.test(url)) return ".svg";
  if (/png/.test(type) || /\.png(\?|$)/i.test(url)) return ".png";
  if (/webp/.test(type) || /\.webp(\?|$)/i.test(url)) return ".webp";
  if (/jpe?g/.test(type) || /\.jpe?g(\?|$)/i.test(url)) return ".jpg";
  if (/icon|ico/.test(type) || /\.ico(\?|$)/i.test(url)) return ".ico";
  return ".img";
};

// Google Fonts knows the family: css2 answers 200
export async function googleFont(family) {
  if (!family) return false;
  try {
    const res = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}`, { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch { return false; }
}

// the @font-face files of a family, the regular and the bold weight, woff2 first
function fontFiles(fontFaces, family) {
  const out = [];
  for (const { css, base } of fontFaces) {
    const fam = /font-family:\s*["']?([^;"']+)["']?/i.exec(css)?.[1]?.trim();
    if (!fam || fam.toLowerCase() !== family.toLowerCase()) continue;
    const weight = /font-weight:\s*([^;]+)/i.exec(css)?.[1]?.trim() || "400";
    const style = /font-style:\s*([^;]+)/i.exec(css)?.[1]?.trim() || "normal";
    const srcs = [...css.matchAll(/url\(["']?([^"')]+)["']?\)\s*(?:format\(["']?([^"')]+)["']?\))?/g)].map((m) => ({ url: new URL(m[1], base).href, format: m[2] || "" }));
    const best = srcs.find((s) => /woff2/.test(s.format) || /\.woff2(\?|$)/.test(s.url)) || srcs.find((s) => /woff/.test(s.format) || /\.woff(\?|$)/.test(s.url)) || srcs[0];
    if (best && !best.url.startsWith("data:")) out.push({ url: best.url, weight, style });
  }
  return out.filter((f) => f.style === "normal").slice(0, 4);
}

export async function readLook(page, dir) {
  fs.mkdirSync(path.join(dir, "logos"), { recursive: true });
  const raw = await page.evaluate(inPage);
  // the logo candidates as files: the original (svg, png …) and a picture of how the page shows it
  const logos = [];
  let n = 0;
  for (const l of raw.logos) {
    n++;
    const entry = { score: l.score, source: "page", alt: l.alt, width: Math.round(l.rect.w), height: Math.round(l.rect.h) };
    try {
      if (l.svg) {
        entry.file = `logos/logo-${n}.svg`;
        fs.writeFileSync(path.join(dir, entry.file), l.svg);
      } else if (l.src && !l.src.startsWith("data:")) {
        const tmp = path.join(dir, `logos/logo-${n}.tmp`);
        const { type } = await download(l.src, tmp);
        entry.file = `logos/logo-${n}${extOf(l.src, type)}`;
        fs.renameSync(tmp, path.join(dir, entry.file));
        entry.url = l.src;
      } else if (l.src) {
        const m = /^data:image\/([a-z+]+);base64,(.*)$/.exec(l.src);
        if (m) {
          entry.file = `logos/logo-${n}.${m[1] === "svg+xml" ? "svg" : m[1]}`;
          fs.writeFileSync(path.join(dir, entry.file), Buffer.from(m[2], "base64"));
        }
      }
    } catch (e) { entry.error = e.message; }
    const { x, y, w, h } = l.rect;
    try {
      entry.shot = `logos/logo-${n}.shot.png`;
      await page.screenshot({ path: path.join(dir, entry.shot), clip: { x: Math.max(0, x), y: Math.max(0, y), width: Math.max(1, w), height: Math.max(1, h) }, omitBackground: true });
      entry.colors = pictureColors(path.join(dir, entry.shot)).map((c) => c.hex);
    } catch { delete entry.shot; }
    logos.push(entry);
  }
  // icons: the largest apple-touch icon, the manifest's, then the favicon
  const icons = [...raw.icons];
  if (raw.manifest) {
    try {
      const m = await (await fetch(raw.manifest, { signal: AbortSignal.timeout(8000) })).json();
      for (const i of m.icons || []) icons.push({ rel: "manifest", href: new URL(i.src, raw.manifest).href, sizes: i.sizes || null });
    } catch {}
  }
  const size = (i) => Math.max(0, ...String(i.sizes || "").split(/\s+/).map((s) => parseInt(s, 10) || 0)) || (/apple/.test(i.rel) ? 180 : /mask/.test(i.rel) ? 300 : 32);
  const bestIcon = icons.filter((i) => i.href && !i.href.startsWith("data:")).sort((a, b) => size(b) - size(a))[0];
  if (bestIcon) {
    try {
      const tmp = path.join(dir, "logos/icon.tmp");
      const { type } = await download(bestIcon.href, tmp);
      const file = `logos/icon${extOf(bestIcon.href, type)}`;
      fs.renameSync(tmp, path.join(dir, file));
      logos.push({ score: 1, source: "icon", file, width: size(bestIcon), height: size(bestIcon), url: bestIcon.href });
    } catch {}
  }
  for (const item of raw.ld.flatMap((x) => (Array.isArray(x) ? x : x["@graph"] || [x]))) {
    const logo = item && (item.logo?.url || item.logo || item.publisher?.logo?.url || item.publisher?.logo);
    if (typeof logo === "string" && /^https?:/.test(logo) && !logos.some((l) => l.url === logo)) {
      try {
        const tmp = path.join(dir, "logos/ld.tmp");
        const { type } = await download(logo, tmp);
        const file = `logos/ld-logo${extOf(logo, type)}`;
        fs.renameSync(tmp, path.join(dir, file));
        logos.push({ score: 2, source: "structured data", file, url: logo });
      } catch {}
      break;
    }
  }
  const logoColors = (logos[0]?.colors || []).map((h) => ({ hex: h, weight: 1 / (logos[0].colors.length || 1) }));
  const { palette, ranked } = proposePalette(raw.colors, logoColors, raw.themeColor);
  // a site set in the system's fonts gets the Google font closest to them, so that a picture shows
  // the same on every machine
  const SYSTEM = { "sans-serif": "Inter", serif: "Source Serif 4", monospace: "JetBrains Mono" };
  const fonts = {};
  for (const [role, f] of Object.entries(raw.fonts)) {
    if (!f || (!f.family && !f.system)) continue;
    fonts[role] = { family: f.family || SYSTEM[f.system], weight: f.weight, uppercase: f.uppercase, letterSpacing: f.letterSpacing, lineHeight: f.lineHeight, size: f.size, sample: f.sample, ...(f.family ? {} : { system: f.stack }) };
  }
  // where each family comes from: Google Fonts, or the site's own files
  const families = [...new Set(Object.values(fonts).map((f) => f.family))];
  const sources = {};
  for (const fam of families) {
    if (await googleFont(fam)) { sources[fam] = "google"; continue; }
    const files = fontFiles(raw.fontFaces, fam);
    if (files.length) sources[fam] = files;
  }
  return {
    url: raw.url, siteName: raw.siteName, title: raw.title, lang: raw.lang, description: raw.description, ogImage: raw.ogImage,
    themeColor: raw.themeColor, palette, ranked, fonts, fontSources: sources, logos,
    social: socialProfiles(raw.links), ctas: raw.ctas, headings: raw.headings, ld: raw.ld,
  };
}

// downloads the site's own font files of the families in `sources` into `dir`/fonts
export async function downloadFonts(sources, dir) {
  const out = {};
  for (const [fam, src] of Object.entries(sources)) {
    if (src === "google") { out[fam] = "google"; continue; }
    const files = [];
    for (const f of src) {
      const name = `${fam.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${String(f.weight).replace(/\s+/g, "-")}${path.extname(new URL(f.url).pathname) || ".woff2"}`;
      try {
        fs.mkdirSync(path.join(dir, "fonts"), { recursive: true });
        await download(f.url, path.join(dir, "fonts", name));
        files.push({ file: `fonts/${name}`, weight: f.weight });
      } catch {}
    }
    if (files.length) out[fam] = files;
  }
  return out;
}
