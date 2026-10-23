// Lengths as each platform counts them, and the hashtags, mentions and links in a text.
//
//   length(text, how)  → the length, `how` one of
//     "chars"      Unicode code points (an emoji of one code point is 1, a family emoji 5+)
//     "utf16"      UTF-16 code units, as JavaScript, Java and most web forms count (an emoji 2+)
//     "graphemes"  what a reader sees as one character (any emoji 1): Bluesky
//     "bytes"      UTF-8 bytes (an umlaut 2, an emoji 4+)
//     "x"          X's weighted count (twitter-text v3, below): Latin 1, CJK and emoji 2, a link 23
//   cut(text, n, how)  → the first n of the text as `how` counts, never inside a character
//   hashtags(text), mentions(text), links(text) → [{ text, index }]
//
// X's count is twitter-text's v3 configuration (github.com/twitter/twitter-text, config/v3.json):
// the text NFC-normalised; every link 23 whatever its length; every emoji, with its skin tone and
// joiners, 2; every other UTF-16 unit 1 inside the ranges below and 2 outside them (CJK, the
// second half of a surrogate pair included). A post may weigh 280 (25,000 with Premium).

const X = {
  scale: 100,
  defaultWeight: 200,
  transformedURLLength: 23,
  ranges: [[0, 4351, 100], [8192, 8205, 100], [8208, 8223, 100], [8242, 8247, 100]],
};

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const graphemes = (text) => [...segmenter.segment(text)].map((s) => s.segment);
const EMOJI = /^(?:\p{RGI_Emoji}|\p{Emoji_Presentation}|\p{Extended_Pictographic}️?)/v;

// a link as the apps find one: with its scheme, or a bare domain with a common ending
const TLD = "com|net|org|io|co|ai|app|dev|de|at|ch|eu|uk|us|fr|es|it|nl|be|dk|se|no|fi|pl|cz|pt|ie|ca|au|nz|in|jp|br|me|tv|ly|gg|so|to|shop|store|blog|info|biz|link|page|site|online|xyz|tech|studio|media|news|social|video";
const LINK = new RegExp(`(?:https?://[^\\s<>"]+|(?<![\\w@.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TLD})(?![\\w-])(?:/[^\\s<>"]*)?)`, "giu");
const TRAIL = /[.,:;!?)\]}'"»“”’]+$/u;

export function links(text) {
  const out = [];
  for (const m of String(text).matchAll(LINK)) {
    const t = m[0].replace(TRAIL, "");
    if (t) out.push({ text: t, index: m.index });
  }
  return out;
}

// #word: letters, marks, digits and underscores after a # that does not follow a letter or digit;
// all digits is no hashtag (#1 stays text)
export function hashtags(text) {
  const out = [];
  for (const m of String(text).matchAll(/(?<![\p{L}\p{N}_&#])[#＃]([\p{L}\p{M}\p{N}_]+)/gu)) {
    if (/^\p{N}+$/u.test(m[1])) continue;
    out.push({ text: m[1], index: m.index });
  }
  return out;
}

// @name: letters, digits, underscores and dots after an @ that does not follow a letter or digit
// (not an e-mail address); a dot at the end belongs to the sentence
export function mentions(text) {
  const out = [];
  for (const m of String(text).matchAll(/(?<![\p{L}\p{N}_.])[@＠]([A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_])?)/gu)) {
    out.push({ text: m[1], index: m.index });
  }
  return out;
}

function xWeight(text) {
  const t = String(text).normalize("NFC");
  const spans = links(t).map((l) => [l.index, l.index + l.text.length]);
  let w = 0;
  let i = 0;
  while (i < t.length) {
    const span = spans.find(([a]) => a === i);
    if (span) { w += X.transformedURLLength * X.scale; i = span[1]; continue; }
    const g = segmenter.segment(t.slice(i, i + 32))[Symbol.iterator]().next().value.segment;
    if (EMOJI.test(g) && !/^[\d#*]$/.test(g)) { w += X.defaultWeight; i += g.length; continue; }
    const c = t.charCodeAt(i);
    const r = X.ranges.find(([a, b]) => c >= a && c <= b);
    w += r ? r[2] : X.defaultWeight;
    i += 1;
  }
  return w / X.scale;
}

export function length(text, how = "chars") {
  const t = String(text ?? "");
  if (how === "utf16") return t.length;
  if (how === "graphemes") return graphemes(t).length;
  if (how === "bytes") return Buffer.byteLength(t, "utf8");
  if (how === "x") return xWeight(t);
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

export const UNITS = { chars: "characters", utf16: "characters (an emoji 2)", graphemes: "characters as seen", bytes: "bytes (an umlaut 2, an emoji 4)", x: "X's weighted characters (a link 23, an emoji or CJK 2)" };
