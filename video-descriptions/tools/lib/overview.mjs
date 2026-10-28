// The overview page: every platform's texts as they will be posted and what shows before "more",
// for the person to check what the agent wrote, and nothing else: the check's verdicts, the
// formats and the counts are the agent's (a count only shows when a field is near its limit).
// One self-contained file, light and dark, read only.

import { styleById } from "./styles.mjs";
import { platformById } from "./platforms.mjs";
import { links, hashtags, mentions } from "./count.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// links, hashtags and mentions marked, as the check finds them: a "#" or "@" inside a link stays
// part of the link
function mark(text) {
  const s = String(text ?? "");
  const spans = [
    ...links(s).map((l) => ({ at: l.index, len: l.text.length, cls: "link" })),
    ...hashtags(s).map((h) => ({ at: h.index, len: h.text.length + 1, cls: "tag" })),
    ...mentions(s).map((m) => ({ at: m.index, len: m.text.length + 1, cls: "at" })),
  ].sort((a, b) => a.at - b.at);
  let out = "", i = 0;
  for (const x of spans) {
    if (x.at < i) continue;
    out += esc(s.slice(i, x.at)) + `<span class="${x.cls}">${esc(s.slice(x.at, x.at + x.len))}</span>`;
    i = x.at + x.len;
  }
  return out + esc(s.slice(i));
}

const T = {
  en: { style: "Style", more: "more", own: true, visible: "shown before", texts: "post texts" },
  de: { style: "Stil", more: "mehr", visible: "sichtbar vor", texts: "Posttexte", labels: { Caption: "Caption", Description: "Beschreibung", Title: "Titel", Tags: "Tags", Text: "Text", Post: "Post", Link: "Link", "Alt text": "Alt-Text", "Video alt text": "Alt-Text des Videos", "Hashtag sticker": "Hashtag-Sticker", "Link sticker": "Link-Sticker", "Link sticker text": "Text des Link-Stickers", "Mention stickers": "Erwähnungs-Sticker" } },
};

function field(f, t) {
  // the count only where it matters to the reader: a field within a tenth of its limit
  const near = f.max && f.length >= 0.9 * f.max;
  const meter = near ? `<span class="count">${f.length.toLocaleString("en")}<span class="of"> / ${f.max.toLocaleString("en")}</span></span>` : "";
  let body;
  if (f.kind === "list") body = `<div class="chips">${f.value.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div>`;
  else if (f.kind === "url") body = `<div class="text url">${esc(f.value)}</div>`;
  else if (f.visible != null && f.rest) {
    // the app's own word in English ("See more", "...more"); in German the apps say "mehr"
    const says = t.own ? f.foldSays || t.more : t.more;
    body = `<div class="text"><span class="shown">${mark(f.visible)}</span><span class="fold" title="${esc(t.visible)} “${esc(says)}”">${esc(/^[.…]/.test(says) ? says : `… ${says}`)}</span><span class="rest">${mark(f.rest)}</span></div>`;
  }
  else body = `<div class="text">${mark(f.value)}</div>`;
  return `<div class="field">
  <div class="fhead"><span class="flabel">${esc(t.labels?.[f.label] || f.label)}</span>${meter}</div>
  ${body}
</div>`;
}

function card(r, t) {
  const p = platformById(r.platform);
  return `<article class="post" id="${esc(r.platform)}" style="--app:${p?.color || "var(--accent)"}">
  <header class="phead">
    <span class="badge" aria-hidden="true">${esc(p?.mark || "•")}</span>
    <h2>${esc(r.name || r.platform)}</h2>
  </header>
  ${r.fields.map((f) => field(f, t)).join("")}
</article>`;
}

export function overview(doc, results, { video, title } = {}) {
  const lang = /^de/i.test(doc.lang || "") ? "de" : "en";
  const t = T[lang];
  const st = styleById(doc.style);
  const styleName = st ? (lang === "de" ? st.nameDe : st.name) : doc.style || "–";
  const name = title || (video ? video.name.replace(/\.[^.]+$/, "") : "Descriptions");
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(name)} ${t.texts}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* a proof sheet: one card per app, the text as it will read, its limit as a meter */
:root {
  --bg: #f5f6f9; --surface: #ffffff; --fg: #15171e; --muted: #626879; --line: #dfe2ea;
  --accent: #3048e8; --ok: #17804f; --warn: #a3660b; --bad: #c0362c; --fade: #9aa0b0;
  --display: "Schibsted Grotesk", "Helvetica Neue", Arial, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #101217; --surface: #181b22; --fg: #e7e9f0; --muted: #9aa1b2; --line: #2a2f3a;
  --accent: #8b9cff; --ok: #4cc38a; --warn: #e2a33b; --bad: #ff7b6e; --fade: #6b7182; color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #101217; --surface: #181b22; --fg: #e7e9f0; --muted: #9aa1b2; --line: #2a2f3a;
  --accent: #8b9cff; --ok: #4cc38a; --warn: #e2a33b; --bad: #ff7b6e; --fade: #6b7182; color-scheme: dark }
* { box-sizing: border-box }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 var(--display);
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 28px 48px }
main { max-width: 1600px; margin: 0 auto; display: grid; gap: 24px }
.top { display: grid; gap: 10px }
.top h1 { margin: 0; font-size: clamp(24px, 4vw, 34px); font-weight: 800; letter-spacing: -0.02em; text-wrap: balance }
.styleline { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: baseline; max-width: 80ch }
.stylechip { font-weight: 700; color: var(--accent); border: 1.5px solid var(--accent); border-radius: 999px; padding: 2px 12px; font-size: 14px }
.grid { columns: 340px; column-gap: 16px }
.post { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 14px; display: grid; gap: 12px; min-width: 0; break-inside: avoid; margin-bottom: 16px }
.phead { display: flex; align-items: center; gap: 10px }
.phead h2 { margin: 0; font-size: 16px; font-weight: 700; line-height: 1.2; min-width: 0 }
.badge { width: 32px; height: 32px; border-radius: 9px; background: var(--app); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 14px; flex: none }
.field { display: grid; gap: 6px; min-width: 0 }
.fhead { display: flex; align-items: center; gap: 8px; font-size: 12px }
.flabel { text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; color: var(--muted); margin-right: auto }
.count { font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: 12px }
.of { color: var(--muted); font-weight: 400 }
.text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14.5px; line-height: 1.55; border-left: 2px solid var(--line); padding-left: 10px }
.text.url { font-family: var(--mono); font-size: 13px; color: var(--accent) }
.fold { display: inline-block; margin: 0 2px; font-size: 12px; font-weight: 700; color: var(--accent); white-space: nowrap }
.fold::before { content: "▸ " }
.rest { color: var(--fade) }
.rest .tag, .rest .at, .rest .link { color: inherit; text-decoration: underline dotted }
.tag, .at { color: var(--accent); font-weight: 500 }
.link { color: var(--accent); text-decoration: underline }
.chips { display: flex; flex-wrap: wrap; gap: 6px }
.chip { font-size: 12.5px; border: 1px solid var(--line); border-radius: 6px; padding: 1px 7px }
.muted { color: var(--muted) }
</style></head>
<body><main>
<section class="top">
  <h1>${esc(name)}</h1>
  <div class="styleline"><span class="stylechip">${esc(t.style)}: ${esc(styleName)}</span></div>
</section>
<section class="grid">
${results.map((r) => card(r, t)).join("\n")}
</section>
</main>
</body></html>
`;
}
