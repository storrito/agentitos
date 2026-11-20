// What each platform does with a video's sound, and the one master that works on all of them, as
// data: the sound's counterpart of platform-zones' table. Other skills ask this (voice.mjs targets)
// instead of keeping loudness numbers of their own; a new platform or a new finding is a change here
// and nowhere else.
//
// Every platform holds two parts, each with how sure it is and where it comes from:
//   playback  what the app does with the sound when it plays: `normalises` "down" (turns louder
//             sound down, never quieter sound up), "up and down", "yes" (it sets the level, how is
//             not published), "unknown"; `lufs` the level it aims at; `modes` its listener's choices
//   upload    what it asks of the file: `codecs`, `sampleRatesHz`, `kbps` ({ mono, stereo }, each
//             [low, high], high null for "or more", low = high for the one value asked),
//             `lufs` ± `toleranceLu`, `truePeakDbtp` (the most)
//   basis     "official" (the platform's own page), "measured" (a named third party's test), "ads"
//             (the platform's numbers for ads), "unknown" (nothing reliable found: the table says so
//             and gives no number of its own)
//   sources   where it comes from; `CHECKED` the day it was last compared
//
// The standards for speech are quieter than what the platforms play: EBU R 128 s2 (2023) gives −20
// to −16 LUFS for streams without loudness metadata, AES TD1008 / AES77 −18 LUFS for speech and −16
// for music (STANDARDS). They are for players that may raise the level; the master for video
// follows the platforms, and says so in its reasons.
//
// Loudness is always as played on two channels: a file with one channel plays on both speakers and
// measures 3 LU louder then than as one channel.
//
//   resolve(name)        → the platform an id or alias names, or null
//   resolveAll(names)    → the platforms, each once; an unknown name throws "There is no platform …"
//   targets(names)       → { checked, kind, fallback, why, master, second, platforms, reasons, standards }
//   list()               → { checked, platforms, defaults, why, basis, standards }
//   format(targets(…)), formatList(list())   the same as text for an agent

export const CHECKED = "2026-11-19";

export const STANDARDS = [
  { name: "EBU R 128 s2 (2023)", says: "−20 to −16 LUFS for streams without loudness metadata", lufs: [-20, -16], source: "https://tech.ebu.ch/docs/r/r128s2.pdf" },
  { name: "AES TD1008 / AES77", says: "−18 LUFS for speech, −16 LUFS for music", lufs: { speech: -18, music: -16 }, source: "https://productionadvice.co.uk/td1008/" },
];

export const BASIS = {
  official: "the platform's own page",
  measured: "a named third party's test",
  ads: "the platform's numbers for ads",
  unknown: "nothing reliable found",
};

// the parts as every entry has them: a field a platform does not give is null
const PLAYBACK = { basis: "unknown", normalises: "unknown", lufs: null, modes: null, what: "", sources: [] };
const UPLOAD = { basis: "unknown", codecs: null, sampleRatesHz: null, kbps: null, lufs: null, toleranceLu: null, truePeakDbtp: null, what: "", sources: [] };
const entry = (e) => ({ note: null, ...e, playback: { ...PLAYBACK, ...e.playback }, upload: { ...UPLOAD, ...e.upload } });

const META_ENGINEERING = "https://engineering.fb.com/2023/04/11/video-engineering/high-quality-audio-xhe-aac-codec-meta/";
const META_PLAYBACK = {
  basis: "official", normalises: "yes",
  what: "Meta's apps deliver xHE-AAC with loudness and dynamic-range data and set level and dynamics at playback; Meta publishes no target and does not say whether quiet sound is raised",
  sources: [META_ENGINEERING],
};
const META_UPLOAD = {
  basis: "unknown",
  what: "Meta publishes no audio spec for organic posts; “stereo AAC at 128 kbit/s or more” is only in third-party copies of its ads guide",
};

const YOUTUBE_UPLOAD = {
  basis: "official", codecs: ["AAC-LC", "Opus"], sampleRatesHz: [48000], kbps: { mono: [128, 128], stereo: [384, 384] },
  what: "AAC-LC or Opus, 48 kHz, stereo at 384 kbit/s, mono at 128 kbit/s; no loudness figure",
  sources: ["https://support.google.com/youtube/answer/1722171"],
};

const SNAPCHAT = {
  playback: { what: "Snapchat publishes nothing about what it does with loudness" },
  upload: {
    basis: "unknown", codecs: ["PCM", "AAC"], sampleRatesHz: [48000], kbps: { stereo: [192, null] }, lufs: -16,
    what: "agencies quote −16 LUFS, two balanced channels, PCM or AAC at 192 kbit/s or more, 48 kHz as Snap's ad spec; Snap's own page could not be read",
    sources: ["https://blog.adnabu.com/snapchat/snapchat-ad-specs/"],
  },
};

export const PLATFORMS = [
  entry({
    id: "instagram-reels", name: "Instagram Reels", aliases: ["reels", "ig-reels", "instagram"], kind: "video",
    playback: META_PLAYBACK, upload: META_UPLOAD,
  }),
  entry({
    id: "instagram-story", name: "Instagram Story", aliases: ["story", "ig-story", "stories"], kind: "video",
    playback: META_PLAYBACK, upload: META_UPLOAD,
  }),
  entry({
    id: "instagram-feed", name: "Instagram feed post", aliases: ["ig-feed", "instagram-post"], kind: "video",
    playback: {
      basis: "unknown",
      what: "nothing found for feed posts; they play in the same apps as Reels and Stories, which set level and dynamics at playback",
      sources: [META_ENGINEERING],
    },
    upload: META_UPLOAD,
  }),
  entry({
    id: "tiktok", name: "TikTok", aliases: ["tik-tok"], kind: "video",
    playback: { what: "TikTok publishes nothing about what it does with loudness; the often repeated “−14 LUFS” has no source" },
    upload: {
      basis: "unknown",
      what: "its Content Posting API guide names no audio spec",
      sources: ["https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide"],
    },
  }),
  entry({
    id: "youtube-shorts", name: "YouTube Shorts", aliases: ["shorts", "yt-shorts"], kind: "video",
    playback: { what: "whether the Shorts feed normalises as YouTube's player does is not confirmed" },
    upload: YOUTUBE_UPLOAD,
  }),
  entry({
    id: "youtube", name: "YouTube video", aliases: ["yt", "youtube-video"], kind: "video",
    playback: {
      basis: "measured", normalises: "down", lufs: -14,
      what: "turns louder sound down to about −14 LUFS at playback, never quieter sound up; YouTube publishes no number, Ian Shepherd measured it",
      sources: ["https://productionadvice.co.uk/youtube-loudness/", "https://productionadvice.co.uk/stats-for-nerds/"],
    },
    upload: YOUTUBE_UPLOAD,
    note: "The mobile app's Stable Volume, on by default, evens loudness further (press reports, 2023/2024).",
  }),
  entry({
    id: "facebook-reels", name: "Facebook Reels", aliases: ["fb-reels"], kind: "video",
    playback: META_PLAYBACK, upload: META_UPLOAD,
  }),
  entry({
    id: "facebook-story", name: "Facebook Story", aliases: ["fb-story"], kind: "video",
    playback: META_PLAYBACK, upload: META_UPLOAD,
  }),
  entry({
    id: "facebook-feed", name: "Facebook feed post", aliases: ["fb-feed", "facebook"], kind: "video",
    playback: META_PLAYBACK, upload: META_UPLOAD,
  }),
  entry({ id: "snapchat-story", name: "Snapchat Story", aliases: ["snapchat", "snap"], kind: "video", ...SNAPCHAT }),
  entry({ id: "snapchat-spotlight", name: "Snapchat Spotlight", aliases: ["spotlight"], kind: "video", ...SNAPCHAT }),
  entry({
    id: "pinterest", name: "Pinterest video Pin", aliases: ["pin", "pinterest-video"], kind: "video",
    playback: { what: "Pinterest publishes nothing about what it does with loudness" },
    upload: {
      basis: "official", codecs: ["AAC", "PCM"],
      what: "accepts AAC, PCM and others; no bitrate or loudness given",
      sources: ["https://help.pinterest.com/en/business/article/pinterest-product-specs"],
    },
  }),
  entry({
    id: "linkedin", name: "LinkedIn video", aliases: ["linkedin-video"], kind: "video",
    playback: { what: "LinkedIn publishes nothing about what it does with loudness" },
    upload: {
      basis: "ads", codecs: ["AAC", "MPEG-4"],
      what: "its page for ads accepts AAC or MPEG-4 audio at a sample rate below 64 kHz",
      sources: ["https://www.linkedin.com/help/lms/answer/a424737"],
    },
  }),
  entry({
    id: "x", name: "X (Twitter)", aliases: ["twitter"], kind: "video",
    playback: { what: "X publishes nothing about what it does with loudness" },
    upload: {
      basis: "official", codecs: ["AAC-LC"], kbps: { mono: [128, null], stereo: [128, null] },
      what: "AAC-LC at 128 kbit/s or more, mono or stereo; HE-AAC is not supported",
      sources: ["https://docs.x.com/x-api/media/quickstart/best-practices"],
    },
  }),
  entry({
    id: "apple-podcasts", name: "Apple Podcasts", aliases: ["podcast", "podcasts"], kind: "sound",
    playback: { what: "Apple's page says what an episode must be, not what the app does with its level" },
    upload: {
      basis: "official", codecs: ["AAC"], sampleRatesHz: [44100, 48000], kbps: { mono: [64, 128], stereo: [128, 256] },
      lufs: -16, toleranceLu: 1, truePeakDbtp: -1,
      what: "−16 LKFS ±1 dB, true peak at −1 dBFS or lower, AAC preferred; mono at 64–128 kbit/s, stereo at 128–256 kbit/s, 44.1 or 48 kHz; WAV and FLAC files with one channel are rejected",
      sources: ["https://podcasters.apple.com/support/893-audio-requirements"],
    },
  }),
  entry({
    id: "spotify", name: "Spotify", aliases: [], kind: "sound",
    playback: {
      basis: "official", normalises: "up and down", lufs: -14, modes: { loud: -11, normal: -14, quiet: -19 },
      what: "normalises up and down to −14 LUFS by default (Loud −11, Quiet −19); the web player and third-party devices do not normalise",
      sources: ["https://support.spotify.com/us/artists/article/loudness-normalization/"],
    },
    upload: {
      basis: "official", lufs: -14, truePeakDbtp: -1,
      what: "masters at −14 LUFS with true peaks at −1 dBTP or lower, −2 dBTP when louder than −14 LUFS; no figure for podcast episodes",
      sources: ["https://support.spotify.com/us/artists/article/loudness-normalization/", "https://ads.spotify.com/en-US/guide-to-creating-audio-ads/podcast-ads-minimum-requirements/"],
    },
    note: "Spotify's figures are for music; its podcast ads ask −16 LUFS ±1.5 LU and −2 dBTP.",
  }),
];

// Where the person did not say where it goes: the vertical apps a short most likely goes to, as
// platform-zones takes them for 9:16, and YouTube, whose player the master's −14 LUFS rests on.
export const DEFAULTS = ["instagram-reels", "instagram-story", "tiktok", "youtube-shorts", "facebook-reels", "youtube"];
export const DEFAULTS_WHY = "the vertical apps a short most likely goes to (platform-zones' usual ones for 9:16) and YouTube, whose player the −14 LUFS rests on";

// The master. Loudness in LUFS as played on two channels, with what a check accepts around it; true
// peak in dBTP measured after the lossy encoding, what a tool aims at and the most a check accepts;
// loudness range in LU, what a tool aims at for speech heard on a phone and where a check warns;
// short-term loudness at most so many LU over the target.
const COMMON = {
  rangeLu: { aim: 5, warn: 7 }, shortTermOverLu: 5, sampleRateHz: 48000, channels: 2,
  voice: "the same in both channels", codec: "AAC-LC", minKbps: 192, peaksAfterEncoding: true,
};
export const MASTERS = {
  video: { kind: "video", lufs: -14, toleranceLu: 1, truePeakDbtp: { aim: -1.5, max: -1 }, ...COMMON },
  sound: { kind: "sound", lufs: -16, toleranceLu: 1, truePeakDbtp: { aim: -1, max: -1 }, ...COMMON },
};

const ONE_CHANNEL = "A file with one channel plays on both speakers and then measures 3 LU louder than as one channel, so loudness is always given as played on two channels.";
const PEAKS = "Peaks are measured after the lossy encoding, since encoding raises them.";
export const REASONS = {
  video: [
    "−14 LUFS: YouTube turns louder sound down to about −14 LUFS and never raises quieter sound, so a master at −14 is left alone there, and a quieter one sounds weaker beside the videos around it.",
    "Where a platform's playback is unknown or not published (TikTok, Meta's apps, Snapchat, Pinterest, LinkedIn, X), a quiet master may not be raised at all.",
    `True peak −1.5 dBTP aimed at, −1 dBTP at most: ${PEAKS.charAt(0).toLowerCase()}${PEAKS.slice(1)}`,
    "The standards for speech are quieter, −16 to −20 LUFS (EBU R 128 s2 for streams without metadata, AES TD1008 −18 for speech): −14 follows the platforms, not them.",
  ],
  sound: [
    "−16 LUFS ±1 LU and −1 dBTP are Apple Podcasts' requirement; Spotify publishes no figure for podcast episodes and asks −16 LUFS of podcast ads.",
    PEAKS,
    ONE_CHANNEL,
    "−16 LUFS is the loud end of EBU R 128 s2's −20 to −16 for streams without metadata; AES TD1008 gives −18 for speech.",
  ],
  mixed: "The podcast file is a second master: −16 LUFS ±1 LU, true peak −1 dBTP, the rest as for the video.",
};

export function resolve(name) {
  const k = String(name).toLowerCase();
  return PLATFORMS.find((p) => p.id === k || p.aliases.includes(k)) || null;
}

export function resolveAll(names = []) {
  const out = [];
  for (const n of names) {
    const p = resolve(n);
    if (!p) throw new Error(`There is no platform "${n}": ${PLATFORMS.map((q) => q.id).join(", ")}.`);
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

export function targets(names = []) {
  const named = resolveAll(names);
  const fallback = named.length === 0;
  const platforms = fallback ? DEFAULTS.map(resolve) : named;
  const video = platforms.some((p) => p.kind === "video"), sound = platforms.some((p) => p.kind === "sound");
  const kind = video && sound ? "mixed" : video ? "video" : "sound";
  return structuredClone({
    checked: CHECKED,
    kind,
    fallback,
    why: fallback ? DEFAULTS_WHY : null,
    master: kind === "sound" ? MASTERS.sound : MASTERS.video,
    second: kind === "mixed" ? MASTERS.sound : null,
    platforms,
    reasons: kind === "sound" ? REASONS.sound : kind === "mixed" ? [...REASONS.video, REASONS.mixed] : REASONS.video,
    standards: STANDARDS,
  });
}

export function list() {
  return structuredClone({ checked: CHECKED, platforms: PLATFORMS, defaults: DEFAULTS, why: DEFAULTS_WHY, basis: BASIS, standards: STANDARDS });
}

// numbers as the collection writes them: −14 LUFS, −1.5 dBTP, 48 kHz
const num = (v) => (v < 0 ? `−${-v}` : `${v}`);
const khz = (hz) => `${hz / 1000} kHz`;

function masterLines(m, label) {
  const peak = m.truePeakDbtp.aim === m.truePeakDbtp.max
    ? `true peak at most ${num(m.truePeakDbtp.max)} dBTP after encoding`
    : `true peak ${num(m.truePeakDbtp.aim)} dBTP, at most ${num(m.truePeakDbtp.max)} dBTP after encoding`;
  return [
    `${label}: ${num(m.lufs)} LUFS ±${m.toleranceLu} LU, ${peak}`,
    `  loudness range at most ${m.rangeLu.aim} LU (a check warns above ${m.rangeLu.warn} LU), short-term at most ${m.shortTermOverLu} LU over ${num(m.lufs)} LUFS; ${khz(m.sampleRateHz)}, two channels with the voice the same in both, ${m.codec} at ${m.minKbps} kbit/s or more`,
  ];
}

export function format(t) {
  const who = t.platforms.map((p) => p.name).join(", ");
  const kind = t.kind === "sound" ? "sound alone" : t.kind === "mixed" ? "video (and a podcast)" : "video";
  const lines = masterLines(t.master, `Master for ${kind}`);
  if (t.second) lines.push(...masterLines(t.second, "  Second master, the podcast file").map((l, i) => (i ? `  ${l}` : l)));
  lines.push(`Platforms (checked ${t.checked})${t.fallback ? `, none named, so ${t.why}` : ""}: ${who}`);
  for (const p of t.platforms) {
    lines.push(`  ${p.id.padEnd(19)} plays (${p.playback.basis}): ${p.playback.what}; upload (${p.upload.basis}): ${p.upload.what}`);
    if (p.note) lines.push(`  ${"".padEnd(19)} ${p.note}`);
  }
  lines.push("Why:");
  for (const r of t.reasons) lines.push(`  ${r}`);
  return lines.join("\n");
}

export function formatList(l) {
  const lines = [`The platforms (checked ${l.checked}):`];
  for (const p of l.platforms) {
    lines.push(`  ${p.id.padEnd(19)} ${p.name} (${p.kind}): playback ${p.playback.basis}, upload ${p.upload.basis}${p.aliases.length ? `   also: ${p.aliases.join(", ")}` : ""}`);
  }
  lines.push("", `When none is named: ${l.defaults.join(", ")}: ${l.why}.`);
  lines.push(`Only apple-podcasts or spotify named: the master for sound alone (${num(MASTERS.sound.lufs)} LUFS); a video platform and a podcast one: the video's master and a second one for the podcast file.`);
  lines.push("", `Basis: ${Object.entries(l.basis).map(([k, v]) => `${k} = ${v}`).join("; ")}.`);
  lines.push(`Standards: ${l.standards.map((s) => `${s.name}: ${s.says}`).join("; ")}.`);
  return lines.join("\n");
}
