// Lengths as each platform counts them, and the hashtags, mentions and links in a text.
//
//   length(text, how)  → the length, `how` one of
//     "chars"      Unicode code points (an emoji of one code point 1, a family emoji 5+)
//     "utf16"      UTF-16 code units, as JavaScript, Java and Meta's and TikTok's APIs count (an emoji 2+)
//     "graphemes"  what a reader sees as one character (any emoji 1)
//     "bytes"      UTF-8 bytes (an umlaut 2, an emoji 4+): YouTube's description
//     "x"          X's weighted count (twitter-text v3, below): Latin 1; CJK, "…", "→" and emoji 2; a link 23
//     "bluesky"    graphemes after the app shortens each https:// link to its host and 13 characters
//     "threads"    graphemes, an emoji as many as its UTF-8 bytes (Meta's Threads docs)
//   cut(text, n, how)  → the first n of the text as `how` counts, never inside a character
//   hashtags(text), mentions(text), links(text) → [{ text, index }]
//
// X's count is twitter-text's v3 configuration (github.com/twitter/twitter-text, config/v3.json,
// parseTweet.js): the text NFC-normalised; every link 23 whatever its length, bare domains with a
// real ending included ("storrito.com", "README.md"); every emoji, with its skin tone and joiners,
// 2 (docs.x.com); every other code point 1 inside the ranges below and 2 outside them. Matched with
// the npm package twitter-text 3.1.0 on 121 strings (2026-10-23); x-tlds.json is its list of
// domain endings (conformance/tld_lib.yml, Apache-2.0). The package itself counts emoji newer than
// its parser (2019) by their code points (🫶🏼 4): X's apps follow the docs, but keep a few in hand.

import fs from "node:fs";

const X = { scale: 100, defaultWeight: 200, transformedURLLength: 23, ranges: [[0, 4351, 100], [8192, 8205, 100], [8208, 8223, 100], [8242, 8247, 100]] };

const TLDS = JSON.parse(fs.readFileSync(new URL("./x-tlds.json", import.meta.url), "utf8"))
  .sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const L = "a-z0-9\\u00c0-\\u024f\\u0400-\\u04ff";
const PATH = `(?:/(?:[${L}!*';:=+,.$/%#\\[\\]\\-\\u2013_~@|&]|\\([^\\s()]*\\))*(?:[+\\-${L}=_#/]|\\([^\\s()]*\\)))?/?`;
const QUERY = `(?:\\?[a-z0-9!?*'@();:&=+$/%#\\[\\]\\-_.,~|]*[a-z0-9\\-_&=#/])?`;
const DOMAIN = `(?:[^\\s!-,./:-@\\[-\`{-~\\u00a0-\\u00bf\\u2000-\\u206f\\u3000\\ufeff]+(?:[-_][^\\s!-,./:-@\\[-\`{-~\\u2000-\\u206f]+)*\\.)+(?:${TLDS})(?![0-9a-z@+-])`;
const URL_RE = new RegExp(`(^|[^a-z0-9@\\uff20$#\\uff03])((https?://)?(${DOMAIN})(?::\\d+)?(${PATH})(${QUERY}))`, "giu");
const RGI = /^\p{RGI_Emoji}$/v;
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const graphemes = (text) => [...segmenter.segment(text)].map((s) => s.segment);
const isEmoji = (g) => RGI.test(g) || g.includes("⃣");

function validHost(host) {
  let ascii;
  try { ascii = new URL(`http://${host.replace(/_/g, "x")}`).hostname; } catch { return false; }
  const labels = host.split(".");
  if (ascii.split(".").some((l) => l.length > 63) || labels.some((l) => /^[-_]|[-_]$/.test(l))) return false;
  return !labels.at(-2).includes("_");
}

// links as X finds them: with http(s)://, or a bare ASCII domain with a real ending
export function links(text) {
  const out = [];
  for (const m of String(text).matchAll(URL_RE)) {
    const [, before, url, proto] = m;
    if (!proto && /[-_./]$/.test(before)) continue;
    if (!proto && !/^[\x00-\x7f]+$/.test(m[4])) continue;
    if (!validHost(m[4])) continue;
    out.push({ text: url, index: m.index + before.length, scheme: !!proto });
  }
  return out;
}

// whether position i is inside one of the text's links (a "#pricing" or "@channel" in a link is
// part of the link)
const inLink = (spans, i) => spans.some((l) => i >= l.index && i < l.index + l.text.length);

// #word: letters, marks, digits and underscores after a # that does not follow a letter or digit;
// all digits is no hashtag (#1 stays text)
export function hashtags(text) {
  const out = [];
  const spans = links(text);
  for (const m of String(text).matchAll(/(?<![\p{L}\p{N}_&#])[#＃]([\p{L}\p{M}\p{N}_]+)/gu)) {
    if (/^\p{N}+$/u.test(m[1]) || inLink(spans, m.index)) continue;
    out.push({ text: m[1], index: m.index });
  }
  return out;
}

// @name: letters, digits, underscores, dots and dashes after an @ that does not follow a letter or
// digit (no e-mail address); a dot at the end belongs to the sentence
export function mentions(text) {
  const out = [];
  const spans = links(text);
  for (const m of String(text).matchAll(/(?<![\p{L}\p{N}_.])[@＠]([A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_])?)/gu)) {
    if (!inLink(spans, m.index)) out.push({ text: m[1], index: m.index });
  }
  return out;
}

function xWeight(raw) {
  const text = raw.normalize("NFC");
  const urls = links(text);
  let w = 0, skip = 0;
  for (const { segment, index } of segmenter.segment(text)) {
    if (index < skip) continue;
    const url = urls.find((u) => u.index === index);
    if (url) { w += X.transformedURLLength * X.scale; skip = index + url.text.length; continue; }
    if (isEmoji(segment)) { w += X.defaultWeight; continue; }
    for (const ch of segment) {
      const cp = ch.codePointAt(0);
      w += (X.ranges.find(([a, b]) => cp >= a && cp <= b) ?? [0, 0, X.defaultWeight])[2];
    }
  }
  return w / X.scale;
}

// Bluesky's app stores a typed https:// link as host + path, the path cut to 13 characters and
// "..." when longer than 15 (social-app, toShortUrl); a bare domain stays as typed
export function blueskyText(text) {
  return String(text).replace(/(^|\s|\()(https?:\/\/[^\s]+?)([.,;:!?)]?)(?=\s|$)/gi, (all, pre, url, end) => {
    try {
      const u = new URL(url);
      const p = (u.pathname === "/" ? "" : u.pathname) + u.search + u.hash;
      return pre + (p.length > 15 ? `${u.host}${p.slice(0, 13)}...` : u.host + p) + end;
    } catch { return all; }
  });
}

export function length(text, how = "chars") {
  const t = String(text ?? "");
  if (how === "utf16") return t.length;
  if (how === "graphemes") return graphemes(t).length;
  if (how === "bytes") return Buffer.byteLength(t, "utf8");
  if (how === "x") return xWeight(t);
  if (how === "bluesky") return graphemes(blueskyText(t)).length;
  if (how === "threads") return graphemes(t).reduce((n, g) => n + (isEmoji(g) ? Buffer.byteLength(g, "utf8") : 1), 0);
  return [...t].length;
}

// the first n of the text as `how` counts it, whole characters only
export function cut(text, n, how = "chars") {
  const t = String(text ?? "");
  if (length(t, how) <= n) return t;
  let out = "";
  for (const g of graphemes(t)) {
    if (length(out + g, how) > n) break;
    out += g;
  }
  return out;
}

export const UNITS = {
  chars: "characters",
  utf16: "characters (an emoji 2)",
  graphemes: "characters as seen",
  bytes: "bytes (an umlaut 2, an emoji 4)",
  x: "weighted characters (a link 23, an emoji, CJK, … or → 2)",
  bluesky: "characters as seen, links shortened",
  threads: "characters (an emoji as its bytes, 4+)",
};
