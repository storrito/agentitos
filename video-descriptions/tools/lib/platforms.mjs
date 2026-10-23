// What each platform takes as the text of a video, as data: its fields with their limits and how
// it counts them, what shows before "more", the hashtags, the mentions, the links, the video it
// takes, and the rules a copywriter must know. A new platform or a changed limit is a change here
// and nowhere else; `CHECKED` the day the sources were last compared.
//
// A platform:
//   fields    { key: { label, kind: "text" | "list" | "url", max, count, fold, foldSays, best,
//               required, carries, forbid } }; `max` may be { free, premium } (X); `count` how the
//               platform counts (count.mjs); `fold` what shows before "more" ({ chars, lines });
//               `carries`: the hashtags, mentions and links of the post are read from this field
//   hashtags  { max, over: "error" | "warn", overSays, best: [from, to], maxLength, says }
//   mentions  { max, pattern, rule, notes }
//   links     "clickable" | "dead" (shown as text) | "costly" (clickable, reach suffers) | "field"
//   video     { max (s, or { free, premium }), min, frames, framesHard, reach, over, maxSays }
//   bait      true where the platform shows engagement bait to fewer people
//   rules     what else the texts must obey, in a line each
//   basis     how sure the numbers are; sources: where they come from
//
// Only the limits are hard: what shows before "more", the best number of hashtags and how long a
// title reads well come from guides and change with every app update. Where official sources
// disagree, the stricter number is here and the other in `rules`.

export const CHECKED = "2026-10-23";

const IG_NAME = { pattern: /^(?!.*\.\.)(?!\.)[A-Za-z0-9._]{1,30}(?<!\.)$/, rule: "1–30 letters, digits, . and _; no dot at the start or end, no two in a row" };

export const PLATFORMS = [
  {
    id: "instagram-reels", name: "Instagram Reels", app: "Instagram", format: "Reel (every video post is a Reel)", aliases: ["reels", "instagram", "ig", "instagram-feed", "ig-reels"],
    color: "#d62976", mark: "IG",
    fields: {
      caption: { label: "Caption", kind: "text", max: 2200, count: "utf16", fold: { chars: 125, lines: 2 }, foldSays: "more", carries: true, required: true },
    },
    hashtags: { max: 5, overSays: "Instagram takes at most 5 per post since December 2025, caption and comments together", best: [3, 5], says: "targeted tags of the topic, not #reels or #explore; the words of the caption find viewers in search and on Google" },
    mentions: { max: 20, ...IG_NAME },
    links: "dead",
    video: { max: 900, frames: ["9:16", "4:5", "1:1", "16:9"], reach: 180, maxSays: "up to 20 min in the app for some accounts" },
    bait: true,
    rules: [
      "The hook in the first ~125 characters (two lines in the feed; over a Reel only ~55 show).",
      "Keywords in plain words: Instagram's search and Google read the caption (public professional accounts are indexed since July 2025).",
      "At most 5 hashtags, specific to the topic; more and the post does not go out.",
      "A link is plain text here: say \"link in bio\" or name the website without https://.",
      "Up to 20 @mentions, each notified; collaborators (up to 5 in the app, 3 through the API) are set in the app, not in the text.",
      "Reels over 3 minutes are not recommended to people who do not follow the account.",
      "No long caption unrelated to the video, no engagement bait: Instagram does not recommend either.",
      "A paid partnership gets the app's \"Paid partnership\" label, realistic AI video the AI label: both are switches, not text.",
    ],
    basis: "official limits (Graph API, Help Center); what shows before \"more\" from guides",
    sources: [
      "https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media",
      "https://help.instagram.com/351460621611097",
      "https://www.socialmediatoday.com/news/instagram-implements-new-limits-on-hashtag-use/808309/",
      "https://help.instagram.com/313829416281232",
      "https://about.instagram.com/features/reels",
      "https://developers.buffer.com/guides/character-limits.md",
      "https://www.sendible.com/insights/instagram-character-limit",
      "https://ppc.land/instagram-content-becomes-searchable-on-google-starting-july-10/",
    ],
  },
  {
    id: "instagram-story", name: "Instagram Story", app: "Instagram", format: "Story (no caption: stickers)", aliases: ["story", "stories", "ig-story"], onlyNamed: true,
    color: "#d62976", mark: "IG",
    fields: {
      hashtag: { label: "Hashtag sticker", kind: "text", max: 100, count: "utf16", carries: true, singleLine: true },
      mentions: { label: "Mention stickers", kind: "mentions", maxItems: 20 },
      link: { label: "Link sticker", kind: "url", max: 2048 },
      linkText: { label: "Link sticker text", kind: "text", max: 30, count: "graphemes", singleLine: true },
    },
    hashtags: { max: 1, overSays: "one hashtag sticker shows one tag", best: [0, 1] },
    mentions: { max: 20, ...IG_NAME },
    links: "field",
    video: { max: 60, over: "warn", maxSays: "a longer video is split into stories of 60 s", frames: ["9:16"] },
    rules: [
      "A story has no caption: the text is in the video or in stickers, one link sticker per story.",
      "Up to 20 people mentioned per story, each gets a notification and a message.",
      "Stickers stay inside the story's safe zone (agentitos' platform-zones).",
    ],
    basis: "official (Help Center, Graph API); the link sticker's text length is an estimate",
    sources: ["https://help.instagram.com/218520165235356", "https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media", "https://buffer.com/resources/how-to-add-link-to-instagram-story/"],
  },
  {
    id: "tiktok", name: "TikTok", app: "TikTok", format: "Video post", aliases: ["tt"],
    color: "#111111", mark: "TT",
    fields: {
      caption: { label: "Caption", kind: "text", max: 2200, count: "utf16", fold: { chars: 80, lines: 2 }, foldSays: "more", carries: true, required: true },
    },
    hashtags: { max: 5, overSays: "the app takes at most 5 since mid-2025", best: [3, 5], says: "the topic's search words; #fyp and #viral do nothing" },
    mentions: { pattern: /^[A-Za-z0-9_.]{2,24}$/, rule: "2–24 letters, digits, _ and ." },
    links: "dead",
    video: { max: 600, frames: ["9:16", "1:1", "16:9"], maxSays: "the account's own limit may be lower (3 or 5 min)" },
    bait: true,
    rules: [
      "The hook in the first ~80 characters; the caption, the sound and the hashtags all tell TikTok's search what the video is.",
      "Say the topic in plain search words (\"Instagram Story planen\"), then 3–5 hashtags.",
      "2,200 characters through the API (an emoji counts 2); the app itself takes up to 4,000.",
      "No link in the caption (it is plain text): the website is in the profile.",
      "Hashtags and mentions are separated by spaces or line breaks, or they are not recognised.",
      "Asking for likes, follows or gifts makes the video ineligible for the For You feed.",
      "Brand content: the \"Content disclosure\" switch, not only #ad; realistic AI content gets the AI label.",
    ],
    basis: "official (Content Posting API); the 5-hashtag cap and what shows before \"more\" from guides",
    sources: [
      "https://developers.tiktok.com/doc/content-posting-api-reference-direct-post",
      "https://developers.tiktok.com/doc/content-sharing-guidelines",
      "https://www.socialmediatoday.com/news/tiktok-implements-five-hashtag-limit-per-post/757857/",
      "https://newsroom.tiktok.com/en-us/how-tiktok-recommends-videos-for-you",
      "https://www.tiktok.com/community-guidelines/en/integrity-authenticity",
      "https://www.tiktok.com/legal/page/global/bc-policy/en",
      "https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide",
    ],
  },
  {
    id: "youtube-shorts", name: "YouTube Shorts", app: "YouTube", format: "Short (vertical or square, up to 3 min)", aliases: ["shorts", "yt-shorts"],
    color: "#e62117", mark: "YT",
    fields: {
      title: { label: "Title", kind: "text", max: 100, count: "chars", best: 60, bestSays: "the Shorts feed shows about 40–60", forbid: ["<", ">"], carries: true, required: true, singleLine: true },
      description: { label: "Description", kind: "text", max: 5000, count: "bytes", fold: { chars: 100, lines: 2 }, foldSays: "...more", forbid: ["<", ">"], carries: true },
      tags: { label: "Tags", kind: "list", max: 500, count: "youtube-tags", forbid: ["<", ">"] },
    },
    hashtags: { max: 60, overSays: "with more than 60 YouTube ignores all of them", best: [1, 3], says: "YouTube shows up to 3 it picks beside the title; #Shorts is not needed" },
    mentions: { pattern: /^[A-Za-z0-9](?:[A-Za-z0-9_.\-·]{1,28})[A-Za-z0-9]$/, rule: "3–30 letters, digits, _ - . ·, not at the start or end" },
    links: "dead",
    video: { max: 180, frames: ["9:16", "1:1"], framesHard: true, maxSays: "a longer or wide video is a regular YouTube video" },
    rules: [
      "The title is what people read over the Short: the hook and the topic's keyword in the first ~40 characters.",
      "The description counts bytes: an umlaut 2, an emoji 4; no < or >.",
      "Links in a Short's description are not clickable (since August 2023).",
      "Hashtags must be about the video; misleading titles, tags or hashtags break YouTube's spam policy.",
      "Over 1 minute, a claimed song blocks the Short.",
      "AI that looks real and paid promotion are disclosed with Studio's switches.",
    ],
    basis: "official limits (Data API, Help Center); what shows of title and description from guides",
    sources: [
      "https://developers.google.com/youtube/v3/docs/videos",
      "https://support.google.com/youtube/answer/57404",
      "https://support.google.com/youtube/answer/6390658",
      "https://support.google.com/youtube/answer/15424877",
      "https://support.google.com/youtube/answer/9637404",
      "https://support.google.com/youtube/answer/11585688",
      "https://tubefilter.com/2023/08/10/youtube-shorts-comments-spam/",
    ],
  },
  {
    id: "youtube", name: "YouTube", app: "YouTube", format: "Video", aliases: ["yt", "youtube-video"],
    color: "#e62117", mark: "YT",
    fields: {
      title: { label: "Title", kind: "text", max: 100, count: "chars", best: 70, bestSays: "search and the home feed show about 60–70", forbid: ["<", ">"], carries: true, required: true, singleLine: true },
      description: { label: "Description", kind: "text", max: 5000, count: "bytes", fold: { chars: 150, lines: 3 }, foldSays: "...more", forbid: ["<", ">"], carries: true, required: true },
      tags: { label: "Tags", kind: "list", max: 500, count: "youtube-tags", forbid: ["<", ">"] },
    },
    hashtags: { max: 60, overSays: "with more than 60 YouTube ignores all of them", best: [1, 3], says: "YouTube shows up to 3 it picks beside the title" },
    mentions: { pattern: /^[A-Za-z0-9](?:[A-Za-z0-9_.\-·]{1,28})[A-Za-z0-9]$/, rule: "3–30 letters, digits, _ - . ·, not at the start or end" },
    links: "clickable",
    chapters: "description",
    video: { max: 43200, maxSays: "over 15 min needs a verified account", becomes: "youtube-shorts" },
    rules: [
      "Title: the keyword and the promise in the first ~60 characters; it must deliver what it promises.",
      "Description: the first ~150 characters show before \"...more\": what the video gives, with the keyword; then the details, chapters, links.",
      "Chapters: lines \"0:00 Title\", the first at 0:00, at least three, each at least 10 s long.",
      "The description counts bytes: an umlaut 2, an emoji 4; no < or >.",
      "Tags: 500 characters with the commas, a tag with a space counts 2 more; they matter little, the title and description more.",
      "No list of tags pasted into the description, no misleading or unrelated hashtags (spam policy).",
      "A link sending viewers off YouTube is fine in the description, but the video must stand on its own.",
    ],
    basis: "official limits (Data API, Help Center); what shows of title and description from guides",
    sources: [
      "https://developers.google.com/youtube/v3/docs/videos",
      "https://support.google.com/youtube/answer/57404",
      "https://support.google.com/youtube/answer/146402",
      "https://support.google.com/youtube/answer/6390658",
      "https://support.google.com/youtube/answer/9884579",
      "https://support.google.com/youtube/answer/2801973",
      "https://support.google.com/youtube/answer/71673",
      "https://vidiq.com/blog/post/youtube-video-descriptions/",
    ],
  },
  {
    id: "facebook", name: "Facebook", app: "Facebook", format: "Reel (every video is a Reel since 2025)", aliases: ["facebook-reels", "facebook-feed", "fb"],
    color: "#1877f2", mark: "f",
    fields: {
      caption: { label: "Text", kind: "text", max: 63206, count: "utf16", fold: { chars: 125, lines: 3 }, foldSays: "See more", best: 1000, bestSays: "only ~125 show; past ~1,000 hardly anyone reads on", carries: true, required: true },
    },
    hashtags: { best: [1, 3], says: "one word each, clickable; few and specific" },
    mentions: { pattern: /^[A-Za-z0-9.]{5,50}$/, rule: "5–50 letters, digits and dots", notes: "On Facebook a mention is picked in the app (type @ and choose): a pasted @name may stay plain text." },
    links: "costly",
    video: { frames: ["9:16", "4:5", "1:1", "16:9"] },
    bait: true,
    rules: [
      "The hook in the first ~125 characters (mobile shows two or three lines).",
      "No engagement bait: \"comment YES\", \"tag a friend\", \"share if …\" are demoted (Meta's distribution guidelines).",
      "Pages without Meta's subscription may post only a few links a month (a test since December 2025): a link in the first comment instead.",
      "1–3 hashtags of one word each; $, % and punctuation end a tag.",
      "No length limit is published (guides name 63,206); every video is shown as a Reel.",
    ],
    basis: "guides for the length and what shows before \"See more\"; Meta's own pages for hashtags, usernames and engagement bait",
    sources: [
      "https://about.fb.com/news/2025/06/making-it-easier-create-videos-facebook/",
      "https://www.facebook.com/help/587836257914341",
      "https://www.facebook.com/help/105399436216001",
      "https://transparency.meta.com/features/approach-to-ranking/content-distribution-guidelines/engagement-bait",
      "https://www.socialmediatoday.com/news/facebook-pages-get-charged-for-link-posts/",
      "https://typecount.com/blog/facebook-post-character-limit-2026",
    ],
  },
  {
    id: "linkedin", name: "LinkedIn", app: "LinkedIn", format: "Post with video (profile or page)", aliases: ["li"],
    color: "#0a66c2", mark: "in",
    fields: {
      text: { label: "Text", kind: "text", max: 3000, count: "chars", fold: { chars: 140, lines: 3 }, foldSays: "…more", carries: true, required: true },
    },
    hashtags: { best: [0, 3], says: "a few at the end, or none: LinkedIn no longer leans on them" },
    mentions: { notes: "On LinkedIn a mention is a person's or a company's name picked in the app (type @ and choose); only people and companies really involved." },
    links: "costly",
    video: { max: 900, min: 3, maxSays: "a company page takes up to 10 min", frames: ["9:16", "4:5", "1:1", "16:9"] },
    bait: true,
    rules: [
      "The first ~140 characters show on a phone before \"…more\": a hook that stands on its own, then a blank line.",
      "Short paragraphs, a concrete insight, the professional end of the chosen style; the text must match the video (posts that do not are shown less, since March 2026).",
      "No asking for likes, comments or \"Agree?\" (LinkedIn does not promote such posts).",
      "Links are clickable; that they cost reach is observed, not stated by LinkedIn.",
      "3,000 characters for profile and page posts.",
    ],
    basis: "official limit (Help Center) and policies; what shows before \"…more\" and the hashtag count from guides",
    sources: [
      "https://www.linkedin.com/help/linkedin/answer/a528176",
      "https://www.linkedin.com/help/linkedin/answer/a525082",
      "https://www.linkedin.com/help/linkedin/answer/a548372",
      "https://www.linkedin.com/help/linkedin/answer/a1311816",
      "https://news.linkedin.com/2026/ImprovingTheFeed",
      "https://www.linkedin.com/legal/professional-community-policies",
      "https://linkedinpreview.com/blog/linkedin-see-more-cutoff-2026",
    ],
  },
  {
    id: "x", name: "X", app: "X", format: "Post with video", aliases: ["twitter"],
    color: "#000000", mark: "X",
    fields: {
      text: { label: "Post", kind: "text", max: { free: 280, premium: 25000 }, count: "x", fold: { chars: 280 }, foldSays: "Show more", carries: true, required: true },
    },
    hashtags: { best: [0, 2], says: "X advises no more than 2; none is fine" },
    mentions: { pattern: /^[A-Za-z0-9_]{1,15}$/, rule: "1–15 letters, digits and _" },
    links: "costly",
    video: { max: { free: 140, premium: 14400 }, maxSays: "Premium: up to 4 h", frames: ["9:16", "1:1", "16:9", "4:5"] },
    rules: [
      "280 weighted characters without Premium (Basic, Premium and Premium+ take 25,000): a link counts 23 whatever its length, an emoji 2, CJK 2, and \"…\" and \"→\" 2; the video itself counts nothing.",
      "A bare domain is a link and counts 23 (storrito.com, even README.md).",
      "With Premium, the first ~280 characters show before \"Show more\": the hook there.",
      "0–2 hashtags; unrelated or trending tags to draw traffic count as spam.",
      "A link out is shown to fewer people (said by X's owner, not a rule): the link in the first reply.",
      "Usernames have up to 15 letters, digits and _.",
    ],
    basis: "official (docs.x.com, twitter-text v3, help.x.com); what shows of a long post from guides",
    sources: [
      "https://docs.x.com/fundamentals/counting-characters",
      "https://github.com/twitter/twitter-text/blob/master/config/v3.json",
      "https://help.x.com/en/using-x/x-premium",
      "https://help.x.com/en/using-x/x-videos",
      "https://help.x.com/en/using-x/how-to-use-hashtags",
      "https://help.x.com/en/managing-your-account/x-username-rules",
      "https://help.x.com/en/rules-and-policies/authenticity",
    ],
  },
  {
    id: "threads", name: "Threads", app: "Threads", format: "Post with video", aliases: [],
    color: "#101010", mark: "@",
    fields: {
      text: { label: "Post", kind: "text", max: 500, count: "threads", carries: true, required: true },
    },
    hashtags: { max: 1, overSays: "Threads takes one topic tag per post", best: [0, 1], maxLength: 50, says: "one topic tag, the topic's community" },
    mentions: { ...IG_NAME, notes: "Threads names are the Instagram names." },
    links: "clickable",
    video: { max: 300, frames: ["9:16", "4:5", "1:1", "16:9"] },
    bait: true,
    rules: [
      "500 characters; Meta counts an emoji as its UTF-8 bytes (often 4): few emoji.",
      "One topic tag per post, up to 50 characters, no . or &.",
      "Conversational: an opinion or a question people want to answer; at most 5 links.",
    ],
    basis: "official (Threads API)",
    sources: ["https://developers.facebook.com/docs/threads/posts", "https://developers.facebook.com/docs/threads/create-posts/text-attachments", "https://about.fb.com/news/2025/09/attach-text-threads-posts-share-longer-perspectives/"],
  },
  {
    id: "bluesky", name: "Bluesky", app: "Bluesky", format: "Post with video", aliases: ["bsky"],
    color: "#1185fe", mark: "bs",
    fields: {
      text: { label: "Post", kind: "text", max: 300, count: "bluesky", maxBytes: 3000, carries: true, required: true },
      alt: { label: "Video alt text", kind: "text", max: 2000, count: "graphemes" },
    },
    hashtags: { best: [0, 2], maxLength: 64, says: "a few, written out in the text" },
    mentions: { pattern: /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i, rule: "a full handle, name.bsky.social or a domain" },
    links: "clickable",
    video: { max: 600, frames: ["9:16", "4:5", "1:1", "16:9"] },
    rules: [
      "300 characters as seen; a link written with https:// is shortened by the app (host and 13 characters), a bare domain counts in full.",
      "A mention is the full handle (name.bsky.social).",
      "Alt text for the video: what is seen and said, for people who cannot see it.",
    ],
    basis: "official (AT Protocol lexicon, the Bluesky app's code)",
    sources: ["https://github.com/bluesky-social/bsky/blob/main/lexicons/app/bsky/feed/post.json", "https://github.com/bluesky-social/bsky/blob/main/lexicons/app/bsky/richtext/facet.json", "https://github.com/bluesky-social/social-app/blob/main/src/lib/strings/url-helpers.ts", "https://github.com/bluesky-social/social-app/blob/main/src/lib/constants.ts"],
  },
  {
    id: "pinterest", name: "Pinterest", app: "Pinterest", format: "Video Pin", aliases: ["pin"],
    color: "#e60023", mark: "P",
    fields: {
      title: { label: "Title", kind: "text", max: 100, count: "utf16", fold: { chars: 40 }, foldSays: "cut in the feed", required: true, singleLine: true, carries: true },
      description: { label: "Description", kind: "text", max: 800, count: "utf16", carries: true },
      alt: { label: "Alt text", kind: "text", max: 500, count: "utf16" },
      link: { label: "Link", kind: "url", max: 2048 },
    },
    hashtags: { max: 0, says: "not clickable and not searched since about 2020-2022: keywords in the title and the description instead" },
    mentions: { notes: "Pinterest descriptions do not link @names." },
    links: "field",
    video: { max: 300, min: 4, frames: ["9:16", "4:5", "1:1"], maxSays: "ads up to 15 min" },
    rules: [
      "Pinterest is a search engine: the keyword in the first 40 characters of the title (the feed shows no more).",
      "The description (up to 800) is not shown in the feed but decides who finds the Pin: natural sentences with the words people search for, no stuffing.",
      "The link goes in its own field; alt text describes what is seen.",
    ],
    basis: "official (API v5, Help Center)",
    sources: ["https://github.com/pinterest/api-description/blob/main/v5/openapi.yaml", "https://help.pinterest.com/en/article/review-pin-specs", "https://help.pinterest.com/en/business/article/pinterest-product-specs", "https://policy.pinterest.com/en/community-guidelines"],
  },
  {
    id: "snapchat-spotlight", name: "Snapchat Spotlight", app: "Snapchat", format: "Spotlight (vertical)", aliases: ["snapchat", "spotlight"],
    color: "#e0c400", mark: "S",
    fields: {
      description: { label: "Description", kind: "text", max: 160, count: "chars", carries: true, required: true },
      link: { label: "Link", kind: "url", max: 2048 },
    },
    hashtags: { best: [1, 3], says: "#topics, picked from the suggestions when typing #" },
    mentions: { max: 0, notes: "Mentions go into the Snap itself (the mention sticker), not into the description." },
    links: "field",
    video: { max: 300, min: 5, frames: ["9:16"], framesHard: true, maxSays: "60 s through the API" },
    rules: [
      "160 characters with the #topics.",
      "No link to other social apps or messengers, no promoting accounts elsewhere: such Snaps are not recommended.",
      "Paid content needs the paid-partnership tool.",
    ],
    basis: "official (Public Profile API, Snap's recommendation guidelines)",
    sources: ["https://developers.snap.com/marketing-api/Public-Profile-API/ProfileAssetManagement", "https://values.snap.com/policy/content-guidelines-recommendation-eligibility/recommendation-eligibility/commercial-content", "https://creators.snapchat.com/learn-shine-in-the-spotlight-how-to-submit-to-spotlight"],
  },
];

export const platformById = (id) => {
  const k = String(id || "").toLowerCase();
  return PLATFORMS.find((p) => p.id === k || p.aliases?.includes(k));
};

// the platforms a video fits by its length and frame (stories only when named), and why the
// others do not; X counts without Premium
export function fitting(v) {
  const fits = [], unfit = [];
  const clock = (s) => (s >= 3600 ? `${s / 3600} h` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
  for (const p of PLATFORMS) {
    if (p.onlyNamed) continue;
    const pv = p.video || {};
    const max = typeof pv.max === "object" ? pv.max.free : pv.max;
    if (max && v.duration > max + 0.5 && pv.over !== "warn") unfit.push({ id: p.id, why: `${clock(v.duration)} is over its ${clock(max)}${typeof pv.max === "object" ? ` without Premium (with: ${clock(pv.max.premium)})` : ""}` });
    else if (pv.min && v.duration < pv.min) unfit.push({ id: p.id, why: `it needs at least ${pv.min} s` });
    else if (pv.framesHard && !pv.frames.includes(v.frame)) unfit.push({ id: p.id, why: `it takes ${pv.frames.join(" or ")}, not ${v.frame}` });
    else fits.push(p);
  }
  // a vertical or square video up to 3 min uploaded to YouTube is a Short
  for (const p of [...fits]) {
    if (p.video?.becomes && fits.some((q) => q.id === p.video.becomes)) {
      fits.splice(fits.indexOf(p), 1);
      unfit.push({ id: p.id, why: `YouTube makes a ${v.frame} video up to 3 min a Short (${p.video.becomes})` });
    }
  }
  fits.unfit = unfit;
  return fits;
}
