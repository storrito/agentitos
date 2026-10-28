// Where a video can go: every post type of every account connected to Storrito that publishes a
// video (`list-social-accounts`), as a target with a short id the agent passes back
// (instagram/storrito_com/reel), whether the video fits it, which texts of video-descriptions'
// descriptions.json it takes, and the parameters of the Storrito procedure that posts it.

// what each procedure is called with, and how its status is asked and a post taken back
export const PROCEDURES = {
  "schedule-instagram-reel": { uuid: "reelPostUuid", status: "status-instagram-reel", cancel: "cancel-instagram-reel", account: "instagramUsername", min: 0.5, max: 180 },
  "schedule-tiktok-post": { uuid: "tiktokPostUuid", status: "status-tiktok-post", cancel: "cancel-tiktok-post", account: "tiktokAccountId", max: 600 },
  "schedule-social-post": { uuid: "socialPostUuid", status: "status-social-post", cancel: "cancel-social-post", account: "socialAccountId" },
  "upload-youtube-video": { uuid: "youtubeVideoUuid", status: "status-youtube-video", cancel: "cancel-youtube-video", account: "socialAccountId", max: 4 * 3600, long: true },
};

// the platform id of video-descriptions whose texts a target takes
const TEXTS = { INSTAGRAM: "instagram-reels", TIKTOK: "tiktok", YOUTUBE: "youtube-shorts", FACEBOOK: "facebook", LINKEDIN: "linkedin", PINTEREST: "pinterest", SNAPCHAT: "snapchat-spotlight", THREADS: "threads", TWITTER: "x", X: "x", BLUESKY: "bluesky" };
const BY_PROCEDURE = { "schedule-instagram-reel": "instagram-reels", "schedule-tiktok-post": "tiktok", "upload-youtube-video": "youtube" };

const slug = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9_.]+/g, "-").replace(/^-+|-+$/g, "") || "account";

// every post type that publishes a video, Stories left out (story-from-link makes those)
export function targetsOf(socialAccounts) {
  const out = [], seen = new Set();
  for (const a of socialAccounts || []) {
    for (const p of a.postTypes || []) {
      const proc = PROCEDURES[p.procedure];
      if (!proc || !(p.media || []).includes("video") || /STORY/i.test(p.postType)) continue;
      const platform = String(a.platform || "").toUpperCase();
      let id = `${platform === "TWITTER" ? "x" : slug(platform)}/${slug(a.instagramUsername || a.name)}/${slug(p.postType)}`;
      for (let n = 2; seen.has(id); n++) id = `${id.replace(/-\d+$/, "")}-${n}`;
      seen.add(id);
      out.push({
        id,
        label: p.label || `${a.platformName || platform} ${p.postType}`,
        account: a.instagramUsername ? `@${a.instagramUsername}` : a.name,
        platform,
        platformName: a.platformName || platform,
        avatarUrl: a.avatarUrl || null,
        postType: p.postType,
        procedure: p.procedure,
        accountField: proc.account,
        accountId: a[proc.account],
        mode: proc.long ? "long" : "short",
        min: p.minDurationSeconds ?? proc.min ?? 0,
        max: p.maxDurationSeconds ?? proc.max ?? null,
        maxCaption: p.maxCaptionLength ?? null,
        captionRequired: !!p.captionRequired,
        captionPublished: p.captionPublished !== false,
        options: p.options || [],
        disconnected: !!a.disconnected,
        texts: BY_PROCEDURE[p.procedure] || TEXTS[platform] || null,
      });
    }
  }
  return out;
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// why the video cannot go to a target, or null
export function unfit(t, job) {
  if (t.disconnected) return "the account must be connected again in Storrito";
  if (job.mode && t.mode !== job.mode) return t.mode === "long" ? "takes long-form YouTube videos; this video goes out as a short one" : "takes 9:16 videos; this one goes to YouTube as a long-form video";
  const d = job.measured?.duration;
  if (d != null && t.max != null && d > t.max + 0.05) return `takes up to ${clock(t.max)}; the video is ${clock(d)}`;
  if (d != null && t.min && d < t.min - 0.05) return `takes ${t.min} s or more; the video is ${d.toFixed(1)} s`;
  if (!t.texts) return `video-descriptions writes no texts for ${t.platform}`;
  return null;
}

const bytes = (s) => Buffer.byteLength(s, "utf8");

// --option values: "key=value" for every target with that option, "<target id>:key=value" for one
function chosen(t, given) {
  const out = {};
  for (const g of given) {
    const m = g.match(/^(?:([^:=]+\/[^:=]+):)?([A-Za-z0-9_]+)=(.*)$/);
    if (m && (!m[1] || m[1] === t.id)) out[m[2]] = m[3];
  }
  return out;
}

// the procedure's parameters for one target, from its post in descriptions.json: { params, errors, notes }
export function paramsOf(t, post, { html, videoUrl, thumbnailUrl, date, lang, choices }) {
  const errors = [], notes = [];
  const text = String(post.caption ?? post.text ?? post.description ?? "");
  const when = date ? { date } : {};
  const flags = choices.flags;
  if (t.procedure === "upload-youtube-video") {
    if (!post.title) errors.push("posts.youtube has no title");
    if (bytes(String(post.description || "")) > 5000) errors.push("the description is longer than 5,000 bytes");
    if (!choices.privacy) errors.push("--privacy public|unlisted|private: ask the person");
    if (!choices.kids) errors.push("--made-for-kids yes|no: YouTube asks it of every video; ask the person");
    if (post.tags?.length) notes.push("the tags are not sent: YouTube's API through Storrito takes none; add them in YouTube Studio");
    return {
      errors, notes,
      params: {
        socialAccountId: t.accountId, videoUrl, title: post.title, description: post.description || "", privacy: choices.privacy,
        madeForKids: choices.kids === "yes", aiGenerated: !!flags.aiGenerated, paidProductPlacement: !!flags.paid,
        ...(thumbnailUrl ? { thumbnailUrl } : {}), ...(lang ? { defaultLanguage: lang, defaultAudioLanguage: lang } : {}), ...when,
      },
    };
  }
  if (t.maxCaption && t.texts !== "x" && text.length > t.maxCaption) errors.push(`the text is ${text.length} characters; Storrito would cut it to ${t.maxCaption}`);
  if (t.captionRequired && !text.trim()) errors.push("the platform needs a text");
  if (text && !t.captionPublished) notes.push("this post type publishes no text");
  if (t.procedure === "schedule-instagram-reel") {
    return { errors, notes, params: { html, instagramUsername: t.accountId, caption: text, shareToFeed: !flags.noFeed, ...(flags.aiGenerated ? { aiGenerated: true } : {}), ...when } };
  }
  if (t.procedure === "schedule-tiktok-post") {
    if (!choices.tiktok) errors.push("--tiktok-privacy public|friends|followers|private: TikTok wants the person to choose it");
    return {
      errors, notes,
      params: {
        html, tiktokAccountId: t.accountId, title: text, privacyLevel: choices.tiktok,
        ...(choices.cover != null ? { videoCoverTimestampMs: Math.round(choices.cover * 1000) } : {}),
        ...(flags.aiGenerated ? { aiGenerated: true } : {}), ...(flags.paid ? { brandedContent: true } : {}), ...(flags.ownBrand ? { brandOrganic: true } : {}), ...when,
      },
    };
  }
  // schedule-social-post: the text, and each option filled from the post or from --option; a
  // YouTube Short asks for its visibility and "made for kids" like every YouTube video
  const youtube = t.platform === "YOUTUBE";
  if (youtube && !choices.privacy) errors.push("--privacy public|unlisted|private: ask the person");
  if (youtube && !choices.kids) errors.push("--made-for-kids yes|no: YouTube asks it of every video, a Short too; ask the person");
  const given = chosen(t, choices.options);
  const options = {};
  for (const o of t.options) {
    const key = o.key;
    let v = given[key];
    if (v == null) {
      if (/^title$/i.test(key) && post.title) v = post.title;
      else if (/^(link|url|destinationLink)$/i.test(key) && post.link) v = post.link;
      else if (/alt/i.test(key) && post.alt) v = post.alt;
      else if (key === "aiGenerated" && flags.aiGenerated) v = true;
      else if (key === "madeForKids" && choices.kids) v = choices.kids === "yes";
      else if (key === "privacy" && youtube && choices.privacy) v = choices.privacy;
      else if (/^(paid|brandedContent|paidPartnership)/i.test(key) && flags.paid) v = true;
    }
    if (v == null) {
      if (o.required) errors.push(`--option ${t.id}:${key}=<${(o.choices || []).map((c) => c.value).join("|") || "value"}> (${o.label}): ask the person`);
      continue;
    }
    if (o.type === "checkbox") v = v === true || v === "true";
    else if (o.type === "number") v = parseInt(v, 10);
    else v = String(v);
    if (o.type === "choice" && !(o.choices || []).some((c) => c.value === v)) { errors.push(`${key} is one of ${(o.choices || []).map((c) => c.value).join(", ")}`); continue; }
    if (o.maxLength && typeof v === "string" && v.length > o.maxLength) { errors.push(`${o.label} is ${v.length} characters, up to ${o.maxLength}`); continue; }
    if (o.type === "url" && !/^https:\/\//.test(v)) { errors.push(`${o.label} must be a link that starts with https://`); continue; }
    options[key] = v;
  }
  for (const key of Object.keys(given)) if (!t.options.some((o) => o.key === key)) errors.push(`${t.id} has no option ${key}: ${t.options.map((o) => o.key).join(", ") || "none"}`);
  return {
    errors, notes,
    params: {
      html, socialAccountId: t.accountId, postType: t.postType, text,
      ...(post.title ? { name: String(post.title).slice(0, 200) } : {}), ...(Object.keys(options).length ? { options } : {}), ...when,
    },
  };
}
