// The overview page: every platform's texts as they will be posted, what shows before "more",
// each field's length against its limit, the hashtags and mentions: for the person to check what
// the agent wrote. One self-contained file, light and dark, read only.

import { styleById } from "./styles.mjs";
import { platformById } from "./platforms.mjs";
import { clock } from "./media.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// hashtags, mentions and links marked in a text that is already escaped
const mark = (s) => esc(s)
  .replace(/(^|[^\p{L}\p{N}_&#])([#＃][\p{L}\p{M}\p{N}_]+)/gu, '$1<span class="tag">$2</span>')
  .replace(/(^|[^\p{L}\p{N}_.])(@[A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_])?)/gu, '$1<span class="at">$2</span>')
  .replace(/(https?:\/\/[^\s<]+)/g, '<span class="link">$1</span>');

const T = {
  en: { style: "Style", why: "Why", video: "Video", platforms: "platforms", more: "more", hashtags: "hashtags", hashtag: "hashtag", mentions: "mentions", none: "none", ok: "Ready", warn: "Check", bad: "Fix", visible: "shown before", lang: "Language", premium: "X Premium: long posts", free: "X without Premium" },
  de: { style: "Stil", why: "Warum", video: "Video", platforms: "Plattformen", more: "mehr", hashtags: "Hashtags", hashtag: "Hashtag", mentions: "Erwähnungen", none: "keine", ok: "Fertig", warn: "Prüfen", bad: "Korrigieren", visible: "sichtbar vor", lang: "Sprache", premium: "X Premium: lange Posts", free: "X ohne Premium" },
};

function field(f, t) {
  const over = f.max && f.length > f.max;
  const share = f.max ? Math.min(1, f.length / f.max) : 0;
  const meter = f.max ? `<span class="count${over ? " over" : ""}">${f.length.toLocaleString("en")}<span class="of"> / ${f.max.toLocaleString("en")}</span></span><span class="meter" aria-hidden="true"><i style="width:${(share * 100).toFixed(1)}%"></i></span>` : "";
  let body;
  if (f.kind === "list") body = `<div class="chips">${f.value.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div>`;
  else if (f.kind === "url") body = `<div class="text url">${esc(f.value)}</div>`;
  else if (f.visible != null && f.rest) body = `<div class="text"><span class="shown">${mark(f.visible)}</span><span class="fold" title="${esc(t.visible)} “${esc(f.foldSays || t.more)}”">${esc(/^[.…]/.test(f.foldSays || "") ? f.foldSays : `… ${f.foldSays || t.more}`)}</span><span class="rest">${mark(f.rest)}</span></div>`;
  else body = `<div class="text">${mark(f.value)}</div>`;
  return `<div class="field">
  <div class="fhead"><span class="flabel">${esc(f.label)}</span>${meter}</div>
  ${body}
</div>`;
}

function card(r, t, k) {
  const p = platformById(r.platform);
  const state = r.errors.length ? "bad" : r.warnings.length ? "warn" : "ok";
  // the counts in the subtitle: the tags and names themselves are marked in the text
  const hmax = p?.hashtags?.max;
  const count = [
    `${r.hashtags.length}${hmax ? `/${hmax}` : ""} ${r.hashtags.length === 1 && !hmax ? t.hashtag : t.hashtags}`,
    r.mentions.length ? `${t.mentions}: ${r.mentions.map((m) => `<span class="at">@${esc(m.text)}</span>`).join(" ")}` : null,
  ].filter(Boolean).join(" · ");
  const issues = [
    ...r.errors.map((e) => `<li class="bad">${esc(e)}</li>`),
    ...r.warnings.map((e) => `<li class="warn">${esc(e)}</li>`),
    ...r.notes.map((e) => `<li class="note">${esc(e)}</li>`),
  ].join("");
  return `<article class="post" id="${esc(r.platform)}" style="--app:${p?.color || "var(--accent)"}">
  <header class="phead">
    <span class="badge" aria-hidden="true">${esc(p?.mark || "•")}</span>
    <div class="pname"><h2>${esc(r.name || r.platform)}</h2><span class="pformat">${esc(p?.format || "")} · ${count}</span></div>
    <span class="state ${state}">${esc(t[state])}</span>
  </header>
  ${r.fields.map((f) => field(f, t)).join("")}
  ${issues ? `<ul class="issues">${issues}</ul>` : ""}
</article>`;
}

export function overview(doc, results, { video, title } = {}) {
  const lang = /^de/i.test(doc.lang || "") ? "de" : "en";
  const t = T[lang];
  const st = styleById(doc.style);
  const styleName = st ? (lang === "de" ? st.nameDe : st.name) : doc.style || "–";
  const counts = { ok: 0, warn: 0, bad: 0 };
  for (const r of results) counts[r.errors.length ? "bad" : r.warnings.length ? "warn" : "ok"]++;
  const facts = [
    video ? `${esc(video.name)} · ${esc(video.frame)} · ${clock(video.duration)}` : null,
    `${results.length} ${t.platforms}`,
    doc.lang ? `${t.lang}: ${esc(doc.lang)}` : null,
    results.some((r) => r.platform === "x") ? (doc.x?.premium ? t.premium : t.free) : null,
  ].filter(Boolean).join(" · ");
  const name = title || (video ? video.name.replace(/\.[^.]+$/, "") : "Descriptions");
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(name)} ${lang === "de" ? "Posttexte" : "post texts"}</title>
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
.sub { color: var(--muted); font-size: 14px }
.styleline { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: baseline; max-width: 80ch }
.stylechip { font-weight: 700; color: var(--accent); border: 1.5px solid var(--accent); border-radius: 999px; padding: 2px 12px; font-size: 14px }
.why { color: var(--fg); font-size: 14px; min-width: 0 }
.tally { display: flex; gap: 14px; font-size: 13px; color: var(--muted) }
.tally b { font-variant-numeric: tabular-nums }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: 1px }
.grid { columns: 340px; column-gap: 16px }
.post { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 14px; display: grid; gap: 12px; min-width: 0; break-inside: avoid; margin-bottom: 16px }
.phead { display: flex; align-items: center; gap: 10px }
.badge { width: 32px; height: 32px; border-radius: 9px; background: var(--app); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 14px; flex: none }
.pname { min-width: 0; flex: 1 }
.pname h2 { margin: 0; font-size: 16px; font-weight: 700; line-height: 1.2 }
.pformat { color: var(--muted); font-size: 12.5px }
.state { font-size: 12px; font-weight: 700; padding: 2px 9px; border-radius: 999px; border: 1px solid currentColor }
.state.ok { color: var(--ok) } .state.warn { color: var(--warn) } .state.bad { color: var(--bad) }
.field { display: grid; gap: 6px; min-width: 0 }
.fhead { display: flex; align-items: center; gap: 8px; font-size: 12px }
.flabel { text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; color: var(--muted); margin-right: auto }
.count { font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: 12px }
.count.over { color: var(--bad); font-weight: 500 }
.of { color: var(--muted); font-weight: 400 }
.meter { width: 54px; height: 4px; border-radius: 2px; background: var(--line); overflow: hidden }
.meter i { display: block; height: 100%; background: var(--accent) }
.count.over + .meter i { background: var(--bad) }
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
.issues { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; font-size: 13px }
.issues li { padding-left: 16px; position: relative }
.issues li::before { content: ""; position: absolute; left: 2px; top: 0.55em; width: 7px; height: 7px; border-radius: 50% }
.issues .bad { color: var(--bad) } .issues .bad::before { background: var(--bad) }
.issues .warn::before { background: var(--warn) }
.issues .note { color: var(--muted) } .issues .note::before { background: var(--line) }
</style></head>
<body><main>
<section class="top">
  <h1>${esc(name)}</h1>
  <div class="sub">${facts}</div>
  <div class="styleline"><span class="stylechip">${esc(t.style)}: ${esc(styleName)}</span>${doc.why ? `<span class="why">${esc(doc.why)}</span>` : ""}</div>
  <div class="tally"><span><i class="dot" style="background:var(--ok)"></i>${t.ok} <b>${counts.ok}</b></span><span><i class="dot" style="background:var(--warn)"></i>${t.warn} <b>${counts.warn}</b></span><span><i class="dot" style="background:var(--bad)"></i>${t.bad} <b>${counts.bad}</b></span></div>
</section>
<section class="grid">
${results.map((r, k) => card(r, t, k)).join("\n")}
</section>
</main>
</body></html>
`;
}
