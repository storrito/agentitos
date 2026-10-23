// A set of descriptions checked against the platforms' rules: every field's length as the
// platform counts it, what shows before "more", the hashtags, the mentions, the links, the
// chapters, and whether the video itself fits the platform.
//
//   checkAll(doc, { video, handles }) → [{ platform, name, fields: [{ key, label, value, length,
//                                        max, unit, visible, rest }], hashtags, mentions, links,
//                                        errors: [], warnings: [], notes: [] }]

import { length, cut, hashtags, mentions, links, UNITS } from "./count.mjs";
import { platformById } from "./platforms.mjs";
import { clock } from "./media.mjs";

// tags that say nothing about a video, and the follow/like-for-like kind the apps treat as spam
const EMPTY = new Set(["fyp", "foryou", "foryoupage", "fy", "fypage", "viral", "viralvideo", "trending", "explore", "explorepage", "reels", "reel", "reelsinstagram", "instagood", "video", "videos", "shorts", "youtube", "tiktok", "instagram", "follow", "like", "likes", "photooftheday", "picoftheday", "instadaily"]);
const SPAM = new Set(["follow4follow", "followforfollow", "f4f", "like4like", "likeforlike", "l4l", "followback", "followme", "likeforlikes", "tagsforlikes", "comment4comment", "c4c", "followtrain", "gainpost", "sub4sub", "subforsub"]);

// asking for likes, comments, shares or tags in exchange for nothing but reach: Meta, LinkedIn
// and TikTok show such posts to fewer people
const BAIT = [
  /\b(comment|type|drop|reply)\s+["“']?(yes|yes!|\d|[a-z]{1,8})["”']?\s+(below|if|to|for)\b/i,
  /\btag\s+(a|your|3|three|two|2)\s+(friends?|bestie|someone|person)/i,
  /\b(like|share|repost)\s+(this|if)\b.*\b(if|agree|want)\b/i,
  /\b(smash|hit)\s+(that|the)\s+like/i,
  /\bvote\s+with\s+(a\s+)?(like|reaction|emoji)/i,
  /\b(kommentier|schreib)\w*\s+["“„']?(ja|\d|[a-zäöü]{1,8})["”“']?\s+(wenn|unten|in die kommentare|für)/i,
  /\b(markier|tagge?)\w*\s+(eine[nr]?|deine[nr]?|3|drei|zwei)\s+(freund|freundin|person|bestie|menschen)/i,
  /\b(like|teile)\w*\s+(das|diesen beitrag),?\s+wenn\b/i,
];

const CHAPTER = /^\s*\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s+[-–—:]?\s*\S/;
const secs = (t) => t.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);

function tagsLength(list, field) {
  // YouTube counts the tags with the commas between them, a tag with a space in quotes (2 more)
  if (field.count === "youtube-tags") return list.reduce((n, t) => n + length(t, "chars") + (/\s/.test(t) ? 2 : 0), 0) + Math.max(0, list.length - 1);
  return list.reduce((n, t) => n + length(t, field.count || "chars"), 0);
}

export function checkPost(id, post, doc, ctx = {}) {
  const p = platformById(id);
  const r = { platform: id, name: p?.name, app: p?.app, fields: [], hashtags: [], mentions: [], links: [], errors: [], warnings: [], notes: [] };
  if (!p) { r.errors.push(`there is no platform "${id}" (descriptions.mjs platforms)`); return r; }
  if (!post || typeof post !== "object") { r.errors.push(`its post is no object of fields (${Object.keys(p.fields).join(", ")})`); return r; }
  const premium = !!doc.x?.premium;

  for (const key of Object.keys(post)) {
    if (!p.fields[key] && !["style", "note"].includes(key)) r.errors.push(`"${key}" is no field of ${p.name}: ${Object.keys(p.fields).join(", ")}`);
  }

  for (const [key, f] of Object.entries(p.fields)) {
    const value = post[key];
    if (value == null || value === "" || (Array.isArray(value) && !value.length)) {
      if (f.required) r.errors.push(`${f.label} is missing`);
      continue;
    }
    const max = typeof f.max === "object" ? f.max[premium ? "premium" : "free"] : f.max;
    if (f.kind === "mentions") {
      if (!Array.isArray(value)) { r.errors.push(`${f.label} is a list of names, ["name", …]`); continue; }
      const names = value.map((x) => String(x).replace(/^@/, ""));
      r.fields.push({ key, label: f.label, kind: "list", value: names.map((x) => `@${x}`), length: names.length, max: f.maxItems, unit: "names" });
      if (f.maxItems && names.length > f.maxItems) r.errors.push(`${f.label}: ${names.length}, ${p.name} takes ${f.maxItems}`);
      r.mentions.push(...names.map((text) => ({ text, field: key })));
      continue;
    }
    if (f.kind === "list") {
      if (!Array.isArray(value) || value.some((x) => typeof x !== "string")) { r.errors.push(`${f.label} is a list of words in quotes, ["…", "…"]`); continue; }
      const n = tagsLength(value, f);
      r.fields.push({ key, label: f.label, kind: "list", value, length: n, max, unit: f.count === "youtube-tags" ? "characters with commas" : UNITS[f.count || "chars"] });
      if (n > max) r.errors.push(`${f.label}: ${n} of ${max} ${f.count === "youtube-tags" ? "characters (commas and the quotes of tags with spaces count)" : "characters"}: leave out ${n - max}`);
      if (f.each && value.some((t) => length(t) > f.each)) r.errors.push(`${f.label}: a tag over ${f.each} characters`);
      if (f.forbid) for (const ch of f.forbid) if (value.some((t) => t.includes(ch))) r.errors.push(`${f.label}: "${ch}" is not allowed`);
      continue;
    }
    if (typeof value !== "string") { r.errors.push(`${f.label} is a text`); continue; }
    if (f.kind === "url") {
      r.fields.push({ key, label: f.label, kind: "url", value, length: length(value, "chars"), max });
      if (!/^https?:\/\/\S+\.\S+$/.test(value)) r.errors.push(`${f.label} is a full address, https://…`);
      if (max && length(value) > max) r.errors.push(`${f.label}: ${length(value)} of ${max} characters`);
      continue;
    }
    const how = f.count || "chars";
    const n = length(value, how);
    // X's long posts fold; without Premium there are none
    const folds = f.fold && !(typeof f.max === "object" && !premium);
    // what shows is what the eye sees, whatever unit the limit counts in (YouTube's bytes)
    const visible = folds ? fold(value, f.fold, "graphemes") : null;
    r.fields.push({ key, label: f.label, kind: "text", value, length: n, max, unit: UNITS[how], fold: f.fold || null, foldSays: f.foldSays || null, visible, rest: visible == null ? null : value.slice(visible.length) });
    if (max && n > max) r.errors.push(`${f.label}: ${n} of ${max} ${UNITS[how]}: ${n - max} too many`);
    if (f.maxBytes && Buffer.byteLength(value, "utf8") > f.maxBytes) r.errors.push(`${f.label}: ${Buffer.byteLength(value, "utf8")} of ${f.maxBytes} bytes`);
    if (f.min && n < f.min) r.warnings.push(`${f.label}: ${n} ${UNITS[how]}, better at least ${f.min}`);
    if (f.best && n > f.best && !(max && n > max)) r.warnings.push(`${f.label}: ${n} ${UNITS[how]}; ${f.bestSays || `about ${f.best} show in full`}`);
    if (f.forbid) for (const ch of f.forbid) if (value.includes(ch)) r.errors.push(`${f.label}: "${ch}" is not allowed`);
    if (f.singleLine && /\n/.test(value)) r.errors.push(`${f.label} is one line`);
    if (f.carries) {
      r.hashtags.push(...hashtags(value).map((h) => ({ ...h, field: key })));
      r.mentions.push(...mentions(value).map((m) => ({ ...m, field: key })));
      r.links.push(...links(value).map((l) => ({ ...l, field: key })));
    }
    if (visible != null && visible.length < value.length) {
      const seen = visible.replace(/[#@][\p{L}\p{N}_.]+/gu, "").replace(/\s+/g, " ").trim();
      if (seen.length < Math.min(40, visible.length / 3)) r.warnings.push(`${f.label}: before "${f.foldSays || "more"}" there are mostly hashtags or mentions; the hook goes there`);
    }
    if (/#\S*[-'’][\p{L}\p{N}]/u.test(links(value).reduce((t, l) => t.replace(l.text, " "), value))) r.warnings.push(`${f.label}: a hashtag with a dash or an apostrophe ends there (#self-care is #self): write #selfcare or #SelfCare`);
    if (p.bait && BAIT.some((re) => re.test(value))) r.warnings.push(`${f.label}: reads as engagement bait ("comment YES", "tag a friend"), which ${p.app} shows to fewer people: ask a real question instead`);
  }

  // hashtags
  const tags = r.hashtags.map((h) => h.text);
  const h = p.hashtags || {};
  if (h.max === 0 && tags.length) r.warnings.push(`${p.name} has no hashtags that do anything (${h.says || "they are plain text"}): leave them out`);
  else if (h.max != null && tags.length > h.max) (h.over === "warn" ? r.warnings : r.errors).push(`${tags.length} hashtags, ${p.name} takes ${h.max}${h.overSays ? `: ${h.overSays}` : ""}`);
  else if (h.best && tags.length && (tags.length < h.best[0] || tags.length > h.best[1])) r.warnings.push(`${tags.length} hashtag${tags.length === 1 ? "" : "s"}; ${h.best[0]}–${h.best[1]} work best on ${p.name}`);
  else if (h.best && !tags.length && h.best[0] > 0) r.notes.push(`no hashtags; ${h.best[0]}–${h.best[1]} help search on ${p.name}`);
  const seenTags = new Set();
  for (const t of tags) {
    const k = t.toLowerCase();
    if (seenTags.has(k)) r.warnings.push(`#${t} twice`);
    seenTags.add(k);
    if (SPAM.has(k)) r.errors.push(`#${t} is a follow/like-for-like tag the apps treat as spam`);
    else if (EMPTY.has(k)) r.warnings.push(`#${t} says nothing about the video: a tag of its topic finds viewers, this one does not`);
    if (h.maxLength && length(t) > h.maxLength) r.errors.push(`#${t} is longer than ${h.maxLength} characters`);
  }

  // mentions
  const m = p.mentions || {};
  if (m.max === 0 && r.mentions.length) r.warnings.push(`${p.name} links no @names here${m.notes ? `: ${m.notes}` : ""}`);
  else if (m.max != null && r.mentions.length > m.max) r.errors.push(`${r.mentions.length} mentions, ${p.name} takes ${m.max}`);
  for (const x of m.max === 0 ? [] : r.mentions) {
    if (m.pattern && !m.pattern.test(x.text)) r.errors.push(`@${x.text} is no ${p.app} name (${m.rule})`);
    const known = ctx.handles?.[p.app.toLowerCase()] || [];
    const any = ctx.handles?.["*"] || [];
    if (![...known, ...any].some((k) => k.toLowerCase() === x.text.toLowerCase())) r.warnings.push(`@${x.text}: not in the brand kit and not named as known; mention only an account you know is right on ${p.app}`);
  }
  if (m.notes && r.mentions.length && m.max !== 0) r.notes.push(m.notes);

  // links
  if (r.links.length && p.links === "dead") r.warnings.push(`${p.name} does not make a link in the text clickable (${r.links.map((l) => l.text).join(", ")}): name where to find it ("link in bio") instead`);
  if (r.links.length && p.links === "costly") r.notes.push(`${p.app} shows posts with a link out to fewer people (observed, not stated by ${p.app}): a link in the first reply is the usual way round`);

  // chapters in a description
  if (p.chapters) {
    const text = String(post[p.chapters] || "");
    const stamps = text.split("\n").map((l) => l.match(CHAPTER)).filter(Boolean).map((x) => secs(x[1]));
    if (stamps.length) {
      const why = [];
      if (stamps[0] !== 0) why.push("the first starts at 0:00");
      if (stamps.length < 3) why.push("there are at least three");
      if (stamps.some((s, i) => i && s - stamps[i - 1] < 10)) why.push("each is at least 10 s long");
      if (stamps.some((s, i) => i && s <= stamps[i - 1])) why.push("they go up");
      if (ctx.video?.duration && stamps.some((s) => s >= ctx.video.duration)) why.push(`all are inside the video (${clock(ctx.video.duration)})`);
      else if (ctx.video?.duration && ctx.video.duration - stamps.at(-1) < 10) why.push(`the last one too is at least 10 s long (the video ends at ${clock(ctx.video.duration)})`);
      if (why.length) r.warnings.push(`chapters: YouTube shows them only when ${why.join(", ")}`);
      else r.notes.push(`${stamps.length} chapters`);
    }
  }

  // the video itself
  const v = ctx.video;
  if (v && p.video) {
    const max = typeof p.video.max === "object" ? p.video.max[premium ? "premium" : "free"] : p.video.max;
    if (max && v.duration > max + 0.5) (p.video.over === "warn" ? r.warnings : r.errors).push(`the video is ${clock(v.duration)}, ${p.name} takes up to ${clock(max)}${p.video.maxSays ? ` (${p.video.maxSays})` : ""}`);
    else if (p.video.reach && v.duration > p.video.reach) r.warnings.push(`the video is ${clock(v.duration)}: ${p.name} over ${clock(p.video.reach)} is not recommended to people who do not follow the account`);
    if (p.video.min && v.duration < p.video.min) r.errors.push(`the video is ${v.duration.toFixed(1)} s, ${p.name} needs at least ${p.video.min} s`);
    if (p.video.framesHard && v.frame && !p.video.frames.includes(v.frame)) r.errors.push(`${p.name} takes ${p.video.frames.join(" or ")}, not ${v.frame}${p.video.maxSays ? ` (${p.video.maxSays})` : ""}`);
    else if (p.video.frames && v.frame && !p.video.frames.includes(v.frame)) r.warnings.push(`${p.name} shows ${p.video.frames.join(", ")}; a ${v.frame} video gets bars or is cut`);
  }
  for (const n of p.always || []) r.notes.push(n);
  return r;
}

// what shows before "more": `fold` counted as the field counts, cut at a line break if one comes first
export function fold(text, n, how) {
  const f = typeof n === "object" ? n : { chars: n };
  let shown = cut(text, f.chars, how);
  if (f.lines) {
    const parts = shown.split("\n");
    if (parts.length > f.lines) shown = parts.slice(0, f.lines).join("\n");
  }
  return shown.length < text.length ? shown.replace(/\s+$/, "") : shown;
}

export function checkAll(doc, ctx = {}) {
  const posts = doc.posts || {};
  return Object.entries(posts).map(([id, post]) => checkPost(id, post, doc, ctx));
}
