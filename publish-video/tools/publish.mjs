#!/usr/bin/env node
// A finished video, checked whether it is ready to publish, and published through Storrito: as a
// short-form video (9:16) on the accounts the person picks (Instagram Reels, TikTok, YouTube Shorts,
// Facebook, LinkedIn, Pinterest, Snapchat, Threads, X), or as a long-form video on YouTube; with
// the texts video-descriptions wrote for each platform. Made for agents: each command prints what
// it found and what to do next.
//
//   node tools/publish.mjs check <video|link> <dir> [--mode short|long] [--platforms reels,tiktok,…]
//   node tools/publish.mjs check <dir> [--mode short|long] [--platforms …]
//        measures the video (frame, size, codec, length, sound level, black and silence at its
//        ends), suggests short or long, says what keeps it from being published, and makes a sheet
//        of its frames with what the apps cover drawn in: <dir>/job.json, uploads/publish-<name>/frames.jpg
//   node tools/publish.mjs prepare <dir> [--pad | --crop] [--loudness] [--start <s>] [--end <s>]
//        writes the video again in the form Storrito or YouTube takes (<dir>/video.mp4), and checks it
//   node tools/publish.mjs accounts [<dir>] [--json]
//        the accounts connected to Storrito and what each takes; with <dir>, whether this video fits
//   node tools/publish.mjs publish <dir> --to <target>[,<target>…] (--at <ISO time> | --now)
//        [--texts descriptions/<name>] [--tiktok-privacy public|friends|followers|private]
//        [--privacy public|unlisted|private] [--thumbnail <image>] [--made-for-kids] [--ai-generated]
//        [--paid] [--own-brand] [--no-feed] [--option [<target>:]key=value]…
//        uploads the video once and schedules it on each target with its texts; safe to run again,
//        nothing is posted twice
//   node tools/publish.mjs status <dir> [--wait <s>]   each post's status and its link once it is out
//   node tools/publish.mjs cancel <dir> [--to <target>,…]   takes scheduled posts back

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { probe, frameOf, isRatio, loudness, edges, sheet, download, prepare, clock } from "./lib/media.mjs";
import { connect, call } from "./lib/storrito.mjs";
import { PROCEDURES, targetsOf, unfit, paramsOf } from "./lib/targets.mjs";
import { zones, checkTexts, missing, tool } from "./lib/skills.mjs";

const fail = (msg) => { console.error(msg); process.exit(1); };
const rel = (p) => path.relative(process.cwd(), p) || ".";
const self = () => (rel(process.argv[1]).startsWith("..") ? process.argv[1] : rel(process.argv[1]));
const cmd = (rest) => `node ${self()} ${rest}`;

const FLAGS = ["json", "now", "pad", "crop", "loudness", "made-for-kids", "ai-generated", "paid", "own-brand", "no-feed"];
const VALUED = ["mode", "platforms", "start", "end", "to", "at", "texts", "tiktok-privacy", "privacy", "thumbnail", "wait"];
const REPEATED = ["option"];

function parse(args) {
  const pos = [], opts = { option: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const k = a.slice(2);
    if (FLAGS.includes(k)) { opts[k] = true; continue; }
    if (!VALUED.includes(k) && !REPEATED.includes(k)) fail(`Unknown option ${a}. Options: ${[...VALUED, ...REPEATED, ...FLAGS].map((o) => "--" + o).join(" ")}`);
    if (i + 1 >= args.length) fail(`${a} needs a value.`);
    if (REPEATED.includes(k)) opts[k].push(args[++i]);
    else opts[k] = args[++i];
  }
  return [pos, opts];
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, v) => fs.writeFileSync(file, JSON.stringify(v, null, 2) + "\n");
const nameOf = (dir) => path.basename(path.resolve(dir)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "video";
const stamp = (file) => { const s = fs.statSync(file); return { bytes: s.size, mtimeMs: Math.round(s.mtimeMs) }; };
const sameStamp = (a, b) => a && b && a.bytes === b.bytes && a.mtimeMs === b.mtimeMs;
const mb = (n) => `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;
const list = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);

function loadJob(dir) {
  const file = path.join(dir, "job.json");
  if (!fs.existsSync(file)) fail(`There is no ${rel(file)}: run ${cmd(`check <video> ${rel(dir)}`)} first.`);
  return readJson(file);
}

// ------------------------------------------------------------------------------- check

// the apps a short-form video goes to when the person has not named them yet (Stories are not posted here)
const SHORTS = ["instagram-reels", "tiktok", "youtube-shorts", "facebook-reels"];

// short or long: from the frame and the length; `ask` when the video leaves it open
function suggest(info) {
  const frame = frameOf(info.width, info.height), d = info.duration;
  if (frame === "9:16" && d <= 180) return { mode: "short", why: `9:16 and ${clock(d)}: a short-form video` };
  if (frame === "9:16" && d <= 600) return { mode: "short", ask: true, why: `9:16 but ${clock(d)}: as a short only TikTok takes it (up to 10 min); Reels and Shorts take up to 3 min` };
  if (frame === "9:16") return { mode: "long", ask: true, why: `9:16 and ${clock(d)}: too long for every short-form platform; only YouTube takes it` };
  if (frame === "16:9" && d > 180) return { mode: "long", why: `16:9 and ${clock(d)}: a long-form YouTube video` };
  if (frame === "16:9") return { mode: "long", ask: true, why: `16:9 and only ${clock(d)}: a YouTube video, or reframed to 9:16 for Reels, TikTok and Shorts` };
  return { mode: null, ask: true, why: `${frame}: short-form needs 9:16 (reframed, or with bars), YouTube shows it with bars` };
}

// what keeps the video from being published in this mode: ✗ must be fixed, ⚠ should be looked at;
// `fix` names the option of prepare that fixes it
function assess(info, mode, sound, ends) {
  const out = [];
  const add = (level, text, fix) => out.push({ level, text, ...(fix ? { fix } : {}) });
  const frame = frameOf(info.width, info.height);
  if (mode === "short") {
    if (!isRatio(info.width, info.height, 9 / 16)) {
      if (frame === "9:16") add("✗", `${info.width}×${info.height} is a little taller or wider than 9:16: crop it to 1080×1920 (cuts the edges; look at the sheet first), or add thin black bars`, "--crop or --pad");
      else add("✗", `${frame}: Storrito takes 9:16 only. Reframe it to follow the subject (auto-reframe), write it with black bars, or publish it as a long-form YouTube video (--mode long)`, "--pad");
    } else if (info.width !== 1080 || info.height !== 1920) add("✗", `${info.width}×${info.height}: Storrito takes exactly 1080×1920`, "prepare");
    if (info.codec !== "h264") add("✗", `the picture is ${info.codec}: Storrito takes H.264`, "prepare");
    if (info.bitrate > 30e6) add("✗", `${(info.bitrate / 1e6).toFixed(0)} Mbit/s: Storrito takes up to 30`, "prepare");
    if (info.container !== "mp4") add("✗", `a ${info.container} file: Storrito takes MP4`, "prepare");
    if (info.fps > 60) add("✗", `${info.fps} fps: the apps play up to 60`, "prepare");
    if (info.sound && info.sound.codec !== "aac") add("⚠", `the sound is ${info.sound.codec}: the apps expect AAC`, "prepare");
    if (info.duration > 600) add("✗", `${clock(info.duration)}: too long for every short-form platform (TikTok up to 10 min); cut it, or publish it as a long-form YouTube video (--mode long)`);
    else if (info.duration > 180) add("⚠", `${clock(info.duration)}: only TikTok takes it; Reels and Shorts take up to 3:00`);
    if (!info.sound) add("⚠", "no sound: a silent Reel or TikTok reaches fewer people; fine for a deliberate silent loop");
  } else {
    if (!["mp4", "mov"].includes(info.container)) add("✗", `a ${info.container} file: YouTube through Storrito takes MP4 or MOV`, "prepare");
    if (info.bytes > 5e9) add("✗", `${mb(info.bytes)}: YouTube through Storrito takes up to 5 GB; export it again smaller`);
    if (info.duration > 4 * 3600) add("✗", `${clock(info.duration)}: YouTube through Storrito takes up to 4 hours`);
    else if (info.duration > 15 * 60) add("⚠", `${clock(info.duration)}: over 15 min needs a verified YouTube account`);
    if (!["h264", "hevc", "vp9", "av1"].includes(info.codec) || info.pixfmt !== "yuv420p") add("⚠", `the picture is ${info.codec} (${info.pixfmt}): YouTube may process it slowly or refuse it`, "prepare");
    if (Math.min(info.width, info.height) < 720) add("⚠", `${info.width}×${info.height}: below 720p looks blurry on YouTube`);
    if (frame === "9:16" && info.duration <= 180) add("⚠", "a 9:16 video up to 3 min becomes a Short on YouTube, not a long-form video");
    else if (frame !== "16:9") add("⚠", `${frame}: YouTube shows it with bars at the sides`);
  }
  if (sound?.lufs != null) {
    if (sound.lufs < -20) add("⚠", `quiet: ${sound.lufs.toFixed(1)} LUFS; the apps play about -14, so it sounds weaker than the videos around it`, "--loudness");
    else if (sound.lufs > -9) add("⚠", `loud: ${sound.lufs.toFixed(1)} LUFS; the apps turn it down to about -14`, "--loudness");
    if (sound.peak != null && sound.peak > -1) add("⚠", `peaks at ${sound.peak.toFixed(1)} dBTP: may crackle after the apps encode it`, "--loudness");
  }
  if (ends.blackStart >= 0.4) add("⚠", `begins with ${ends.blackStart.toFixed(1)} s of black: the first second decides whether people stay`, "--start");
  if (ends.silentStart != null && ends.silentStart >= 1) add("⚠", `the first ${ends.silentStart.toFixed(1)} s are silent`, "--start");
  if (ends.blackEnd >= 1) add("⚠", `ends with ${ends.blackEnd.toFixed(1)} s of black`, "--end");
  return out;
}

async function cmdCheck(pos, opts) {
  let [input, dir] = pos;
  if (input && !dir && fs.existsSync(path.join(input, "job.json"))) { dir = input; input = null; }
  if (!dir) fail(`${self()} check <video|link> <dir> [--mode short|long] [--platforms …]   (or check <dir> to check the job's video again)`);
  if (opts.mode && !["short", "long"].includes(opts.mode)) fail("--mode is short (9:16 for Storrito's platforms) or long (a YouTube video).");
  fs.mkdirSync(dir, { recursive: true });
  const jobFile = path.join(dir, "job.json");
  const job = fs.existsSync(jobFile) ? readJson(jobFile) : {};
  job.name ||= nameOf(dir);
  if (input) {
    if (/^https?:\/\//i.test(input)) {
      console.log("Downloading the video …");
      try { job.input = rel(await download(input, dir)); } catch (e) { fail(`${e.message[0].toUpperCase()}${e.message.slice(1)}.`); }
      job.source = input;
    } else {
      if (!fs.existsSync(input)) fail(`There is no ${input}.`);
      job.input = rel(input).startsWith("..") ? path.resolve(input) : rel(input);
      job.source = job.input;
    }
    if (job.video !== job.input) delete job.prepared;
    job.video = job.input;
  }
  if (!job.video || !fs.existsSync(job.video)) fail(`The job's video ${job.video || ""} is gone: ${cmd(`check <video> ${rel(dir)}`)}.`);
  let info;
  try { info = probe(job.video); } catch (e) { fail(`${e.message}.`); }
  const frame = frameOf(info.width, info.height);
  console.log(`${path.basename(job.video)}: ${info.width}×${info.height} (${frame}), ${clock(info.duration)}, ${info.codec} ${info.fps} fps, ${(info.bitrate / 1e6).toFixed(1)} Mbit/s, ${info.container}, ${mb(info.bytes)}${info.sound ? `, sound ${info.sound.codec}` : ", no sound"}`);

  const s = suggest(info);
  if (opts.mode) job.mode = opts.mode;
  else if (!job.mode && !s.ask) job.mode = s.mode;
  if (opts.platforms) job.platforms = list(opts.platforms);
  const mode = job.mode || s.mode || "short";

  const sound = info.sound ? loudness(job.video) : null;
  const ends = edges(job.video, info);
  const findings = assess(info, mode, sound, ends);
  if (sound?.lufs != null) console.log(`sound: ${sound.lufs.toFixed(1)} LUFS${sound.peak != null ? `, peaks ${sound.peak.toFixed(1)} dBTP` : ""}`);

  // the sheet: on a short video with what the apps cover, for the person and the agent to look at
  const sheetFile = path.join("uploads", `publish-${job.name}`, "frames.jpg");
  let z = null;
  if (mode === "short" && frame === "9:16") {
    try { z = zones(info.width, info.height, job.platforms?.length ? job.platforms : SHORTS); } catch (e) { console.log(`(${e.message} The sheet shows no zones.)`); }
  }
  let moments = [];
  try { moments = sheet(job.video, info, sheetFile, { zones: z }); } catch (e) { fail(`${e.message}.`); }

  Object.assign(job, { measured: { ...info, frame, loudness: sound, ends }, suggested: s, findings, sheet: sheetFile, stamp: stamp(job.video), checked: new Date().toISOString() });
  writeJson(jobFile, job);

  console.log(`\n${sheetFile}: ${moments.length} frames at ${moments.map(clock).join(", ")}${z ? `; outlined in red what ${z.platforms.map((p) => p.name).join(", ")} cover, in green the safe box` : ""}.`);
  console.log(`Look at it: does the first frame hook, does the end close, is every text readable${z ? ", inside the green box" : ""} and spelled right, is there another app's watermark or a black bar?`);
  if (!job.mode) console.log(`\nShort or long? ${s.why}. Ask the person, then ${cmd(`check ${rel(dir)} --mode short|long`)}.`);
  else console.log(`\nMode: ${job.mode}${opts.mode ? "" : ` (${s.why})`}${s.ask && !opts.mode ? `. Not certain: ${s.why}; confirm with the person, ${cmd(`check ${rel(dir)} --mode short|long`)} changes it` : ""}.`);
  const errors = findings.filter((f) => f.level === "✗"), warnings = findings.filter((f) => f.level === "⚠");
  for (const f of findings) console.log(`  ${f.level} ${f.text}${f.fix ? `   [prepare ${f.fix === "prepare" ? "" : f.fix}]`.replace(" ]", "]") : ""}`);
  if (!job.mode) return;
  const fixable = findings.filter((f) => f.fix);
  if (errors.length) {
    const opt = [...new Set(errors.map((f) => f.fix).filter((f) => f && f !== "prepare"))];
    console.log(`\nNot ready: ${errors.length} ✗.${fixable.length ? ` What prepare can fix: ${cmd(`prepare ${rel(dir)}${opt.length ? ` [${opt.join(" | ")}]` : ""}`)} (each option only when it is the person's or your considered choice).` : ""}${errors.some((f) => !f.fix) ? " The rest needs another edit of the video, or the other mode." : ""}`);
    process.exitCode = 1;
  } else {
    console.log(`\nReady to publish${warnings.length ? `, with ${warnings.length} ⚠ to weigh (fix with prepare, or keep for a reason)` : ""}. Next: ${cmd(`accounts ${rel(dir)}`)}`);
  }
}

// ------------------------------------------------------------------------------- prepare

function cmdPrepare([dir], opts) {
  if (!dir) fail(`${self()} prepare <dir> [--pad | --crop] [--loudness] [--start <s>] [--end <s>]`);
  const job = loadJob(dir);
  if (!job.mode) fail(`Short or long first: ${cmd(`check ${rel(dir)} --mode short|long`)}.`);
  if (opts.pad && opts.crop) fail("--pad or --crop, not both.");
  const input = job.input || job.video;
  let info;
  try { info = probe(input); } catch (e) { fail(`${e.message}.`); }
  const start = opts.start != null ? Number(opts.start) : 0;
  const end = opts.end != null ? Number(opts.end) : null;
  if (!(start >= 0) || (end != null && !(end > start && end <= info.duration + 0.01))) fail(`--start and --end are seconds within the video's ${info.duration.toFixed(1)} s, the start before the end.`);
  const out = path.join(dir, "video.mp4");
  console.log(`Writing ${rel(out)} (${job.mode}) …`);
  let steps;
  try {
    steps = prepare(input, out, info, { mode: job.mode, pad: !!opts.pad, crop: !!opts.crop, loud: !!opts.loudness, start, end });
  } catch (e) { fail(`${e.message[0].toUpperCase()}${e.message.slice(1)}.`); }
  job.video = rel(out);
  job.prepared = { from: input, steps, ...(opts.pad ? { pad: true } : {}), ...(opts.crop ? { crop: true } : {}), ...(start ? { start } : {}), ...(end != null ? { end } : {}), ...(opts.loudness ? { loudness: -14 } : {}) };
  writeJson(path.join(dir, "job.json"), job);
  console.log(`${rel(out)}: ${steps.join(", ")}. Checking it again:\n`);
  return cmdCheck([dir], { platforms: null });
}

// ------------------------------------------------------------------------------- Storrito

async function needApi() {
  const api = await connect();
  if (api) return api;
  fail(`Storrito cannot be reached from this tool (no gateway connection to Storrito, no STORRITO_API_URL and STORRITO_CREDENTIAL).
Do it with Storrito's procedures yourself (in rragent the REPL's storrito/<procedure> functions; elsewhere its MCP server or API, reference: https://storrito.com/documentation/api/v1/index.md):
  list-social-accounts {} names each account's postTypes and their procedure;
  create-temp-blob-upload-url {tempBlobUuid, contentType "video/mp4", contentLengthBytes}, then curl -sS -T <video> -H 'Content-Type: video/mp4' '<uploadUrl>';
  per account the postType's procedure with html '<insta-story src="<temp-blob url>"></insta-story>' (schedule-instagram-reel, schedule-tiktok-post, schedule-social-post), or videoUrl (upload-youtube-video), a new UUID kept for retries, the texts of descriptions.json and the date.`);
}

async function listTargets(api) {
  const { socialAccounts } = await call(api, "list-social-accounts", {});
  return targetsOf(socialAccounts);
}

async function cmdAccounts([dir], opts) {
  const job = dir ? loadJob(dir) : null;
  const api = await needApi();
  const targets = await listTargets(api);
  const rows = targets.map((t) => ({ ...t, unfit: job ? unfit(t, job) : t.disconnected ? "the account must be connected again in Storrito" : null }));
  if (opts.json) return console.log(JSON.stringify(rows, null, 2));
  if (!rows.length) return console.log("No account connected to Storrito takes a video yet: connect one in the Storrito app (Social Accounts).");
  const fits = rows.filter((r) => !r.unfit);
  console.log(job ? `Where this video (${job.mode}, ${job.measured.frame}, ${clock(job.measured.duration)}) can go:` : "The accounts connected to Storrito and what each takes:");
  for (const r of fits) console.log(`  ${r.id.padEnd(36)} ${r.label} · ${r.account}${r.texts ? `   texts: ${r.texts}` : ""}`);
  const rest = rows.filter((r) => r.unfit);
  if (rest.length) {
    console.log(job ? "Not for this video:" : "Not now:");
    for (const r of rest) console.log(`  ${r.id.padEnd(36)} ${r.label} · ${r.account}: ${r.unfit}`);
  }
  if (job && fits.length) {
    console.log(`\nAsk the person which of these to post to (checkboxes). Then write the texts with video-descriptions for their platforms (texts: …), and ${cmd(`publish ${rel(dir)} --to <target>,… --at <time>|--now`)}.`);
    if (fits.some((r) => r.procedure === "schedule-tiktok-post")) console.log("TikTok: ask who may see it (--tiktok-privacy public|friends|followers|private); TikTok wants the person to choose it.");
    if (fits.some((r) => r.mode === "long")) console.log("YouTube: ask for the privacy (--privacy public|unlisted|private) and whether it is made for kids (--made-for-kids); a thumbnail with --thumbnail.");
    const required = fits.flatMap((r) => r.options.filter((o) => o.required).map((o) => `${r.id}:${o.key} (${o.label}: ${(o.choices || []).map((c) => c.value).join(", ")})`));
    if (required.length) console.log(`To choose with the person: ${required.join("; ")}: --option <target>:<key>=<value>.`);
  }
}

// ------------------------------------------------------------------------------- publish

const ALIASES = { "instagram-reels": ["reels", "instagram", "ig", "ig-reels"], "youtube-shorts": ["shorts", "yt-shorts"], youtube: ["yt", "youtube-video"], x: ["twitter"], "snapchat-spotlight": ["snapchat", "spotlight"], facebook: ["fb", "facebook-reels"], tiktok: ["tt"], linkedin: ["li"], pinterest: ["pin"] };
const postOf = (posts, id) => posts[id] || (ALIASES[id] || []).map((a) => posts[a]).find(Boolean) || null;
const TIKTOK = { public: "PUBLIC_TO_EVERYONE", friends: "MUTUAL_FOLLOW_FRIENDS", followers: "FOLLOWER_OF_CREATOR", private: "SELF_ONLY" };
const live = (p) => p.done && !["canceled", "failed"].includes(p.status);
const hash = (v) => crypto.createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 12);

async function upload(api, file, contentType, held) {
  const st = stamp(file);
  // a temp-blob lives about a day: one younger than 20 hours of the same file is used again
  if (held?.url && sameStamp(held.stamp, st) && Date.now() - Date.parse(held.at) < 20 * 3600e3) return held;
  const uuid = crypto.randomUUID();
  const res = await call(api, "create-temp-blob-upload-url", { tempBlobUuid: uuid, contentType, contentLengthBytes: st.bytes });
  if (res.uploadUrl) {
    const put = await fetch(res.uploadUrl, { method: "PUT", headers: { "content-type": contentType, "content-length": String(st.bytes) }, body: fs.createReadStream(file), duplex: "half", signal: AbortSignal.timeout(60 * 60000) });
    if (!put.ok) throw new Error(`the upload of ${path.basename(file)} answered HTTP ${put.status}; run publish again to retry`);
  }
  return { uuid, url: res.url, at: new Date().toISOString(), stamp: st };
}

async function cmdPublish([dir], opts) {
  if (!dir) fail(`${self()} publish <dir> --to <target>,… (--at <ISO time> | --now) [--texts descriptions/<name>] …`);
  const job = loadJob(dir);
  if (!job.mode) fail(`Short or long first: ${cmd(`check ${rel(dir)} --mode short|long`)}.`);
  if (!fs.existsSync(job.video) || !sameStamp(job.stamp, stamp(job.video))) fail(`The video changed since it was checked: ${cmd(`check ${rel(dir)}`)} first.`);
  const errors = (job.findings || []).filter((f) => f.level === "✗");
  if (errors.length) fail(`The video is not ready (${errors.map((f) => f.text).join("; ")}): ${cmd(`check ${rel(dir)}`)} says what to do.`);
  const wanted = list(opts.to);
  if (!wanted.length) fail(`Which accounts? --to <target>,… as ${cmd(`accounts ${rel(dir)}`)} lists them.`);
  if (!opts.now && !opts.at) fail("When? --at 2026-10-29T18:00:00+01:00 (with the offset of the person's time zone) or --now");
  let date = null;
  if (opts.at) {
    const d = new Date(opts.at);
    if (isNaN(d)) fail(`--at ${opts.at} is no time: write it as 2026-10-29T18:00:00+01:00.`);
    if (d.getTime() < Date.now() - 60000) fail(`--at ${opts.at} is in the past.`);
    date = d.toISOString();
  }
  if (opts["tiktok-privacy"] && !TIKTOK[opts["tiktok-privacy"]]) fail(`--tiktok-privacy is one of ${Object.keys(TIKTOK).join(", ")}.`);
  if (opts.privacy && !["public", "unlisted", "private"].includes(opts.privacy)) fail("--privacy is public, unlisted or private.");
  if (opts.thumbnail && !fs.existsSync(opts.thumbnail)) fail(`There is no ${opts.thumbnail}.`);

  // the texts: video-descriptions' descriptions.json, checked by video-descriptions itself
  const textsDir = opts.texts || path.join("descriptions", job.name);
  const textsFile = path.join(textsDir, "descriptions.json");
  if (!fs.existsSync(textsFile)) fail(`There is no ${rel(textsFile)}: write the texts with video-descriptions first (or name their folder with --texts).`);
  if (!tool("video-descriptions")) fail(missing("video-descriptions"));
  const checked = checkTexts(textsDir);
  if (!checked.ok) fail(`video-descriptions' check finds ✗ in ${rel(textsFile)}:\n${checked.output.split("\n").filter((l) => /✗/.test(l)).join("\n")}\nFix them, check again, show the person the overview, then publish.`);
  const doc = readJson(textsFile);

  const api = await needApi();
  const all = await listTargets(api);
  const targets = [];
  for (const id of wanted) {
    const t = all.find((x) => x.id === id);
    if (!t) fail(`There is no target ${id}. ${cmd(`accounts ${rel(dir)}`)} lists them: ${all.map((x) => x.id).join(", ")}.`);
    const why = unfit(t, job);
    if (why) fail(`${id}: ${why}.`);
    targets.push(t);
  }

  // every target's parameters before anything is uploaded: a missing text or choice stops all
  const choices = {
    privacy: opts.privacy, tiktok: TIKTOK[opts["tiktok-privacy"]], options: opts.option,
    flags: { madeForKids: !!opts["made-for-kids"], aiGenerated: !!opts["ai-generated"], paid: !!opts.paid, ownBrand: !!opts["own-brand"], noFeed: !!opts["no-feed"] },
  };
  const planned = [];
  const problems = [];
  for (const t of targets) {
    const post = postOf(doc.posts || {}, t.texts);
    if (!post) { problems.push(`${t.id}: descriptions.json has no posts.${t.texts}`); continue; }
    const { params, errors: errs, notes } = paramsOf(t, post, { html: "{{HTML}}", videoUrl: "{{VIDEO}}", thumbnailUrl: opts.thumbnail ? "{{THUMBNAIL}}" : null, date, lang: doc.lang, choices });
    for (const e of errs) problems.push(`${t.id}: ${e}`);
    planned.push({ t, params, notes });
  }
  if (problems.length) fail(`${problems.join("\n")}\nNothing was published.`);

  const planFile = path.join(dir, "plan.json");
  const plan = fs.existsSync(planFile) ? readJson(planFile) : { posts: [] };
  const save = () => writeJson(planFile, plan);
  const version = (params) => hash({ video: job.stamp, params });
  // a target already scheduled with another video or other texts: taken back first, never twice
  const stale = planned.filter(({ t, params }) => plan.posts.some((p) => p.target === t.id && live(p) && p.version !== version(params)));
  if (stale.length) fail(`${stale.map(({ t }) => t.id).join(", ")} already ${stale.length > 1 ? "have" : "has"} this video scheduled with other texts or settings. Take ${stale.length > 1 ? "them" : "it"} back with ${cmd(`cancel ${rel(dir)} --to ${stale.map(({ t }) => t.id).join(",")}`)}, then publish again.`);

  const before = plan.video?.uuid;
  try {
    plan.video = await upload(api, job.video, "video/mp4", plan.video);
    save();
    if (opts.thumbnail) {
      const type = /\.png$/i.test(opts.thumbnail) ? "image/png" : "image/jpeg";
      plan.thumbnail = await upload(api, opts.thumbnail, type, plan.thumbnail);
      save();
    }
  } catch (e) { fail(`✗ ${e.message}`); }
  console.log(`${path.basename(job.video)} ${plan.video.uuid === before ? "was uploaded before" : `uploaded (${mb(plan.video.stamp.bytes)})`}.`);
  const html = `<insta-story src="${plan.video.url}"></insta-story>`;

  let failed = 0;
  for (const { t, params, notes } of planned) {
    const v = version(params);
    let post = plan.posts.find((p) => p.target === t.id && p.version === v && !["canceled", "failed"].includes(p.status));
    if (post?.done) { console.log(`${t.id}: already ${post.status}${post.date && post.date !== "now" ? ` for ${post.date}` : ""}`); continue; }
    if (!post) { post = { target: t.id, label: `${t.label} · ${t.account}`, procedure: t.procedure, uuid: crypto.randomUUID(), version: v }; plan.posts.push(post); save(); }
    const proc = PROCEDURES[t.procedure];
    const body = JSON.parse(JSON.stringify(params).replace('"{{HTML}}"', JSON.stringify(html)).replace('"{{VIDEO}}"', JSON.stringify(plan.video.url)).replace('"{{THUMBNAIL}}"', JSON.stringify(plan.thumbnail?.url || "")));
    body[proc.uuid] = post.uuid;
    try {
      const res = await call(api, t.procedure, body, { timeout: proc.long ? 12 * 60000 : 5 * 60000 });
      Object.assign(post, { done: true, status: res.status, date: date || "now", permalink: res.permalink, warnings: res.warnings || [] });
      delete post.error;
    } catch (e) {
      post.error = e.message;
      failed++;
      console.log(`✗ ${t.id}: ${e.message}`);
      save();
      continue;
    }
    save();
    console.log(`${t.id}: ${post.status}${date ? ` for ${date}` : ""}${post.warnings.length ? ` — ${post.warnings.join(" | ")}` : ""}`);
    for (const n of notes) console.log(`  · ${n}`);
  }
  if (failed) fail(`\n${failed} not published. Run publish again with the same options: what is done stays done.`);
  console.log(`\nNext: ${cmd(`status ${rel(dir)}${date ? "" : " --wait 300"}`)} ${date ? "shows each post's status" : "waits until the posts are out and gives their links"}.`);
}

// ------------------------------------------------------------------------------- status, cancel

function loadPlan(dir) {
  const file = path.join(dir, "plan.json");
  if (!fs.existsSync(file)) fail("Nothing published yet.");
  return [file, readJson(file)];
}

async function cmdStatus([dir], opts) {
  if (!dir) fail(`${self()} status <dir> [--wait <s>]`);
  const [file, plan] = loadPlan(dir);
  const api = await needApi();
  const until = Date.now() + Number(opts.wait || 0) * 1000;
  const shown = plan.posts.filter((p) => p.done && p.status !== "canceled");
  for (;;) {
    let pending = 0;
    for (const p of shown) {
      const proc = PROCEDURES[p.procedure];
      try {
        const res = await call(api, proc.status, { [proc.uuid]: p.uuid });
        Object.assign(p, { status: res.status, errorMessage: res.errorMessage, permalink: res.permalink || p.permalink });
        if (res.status === "in-progress" || (res.status === "scheduled" && p.date === "now")) pending++;
      } catch (e) { p.statusError = e.message; }
    }
    writeJson(file, plan);
    if (!pending || Date.now() > until) break;
    await new Promise((r) => setTimeout(r, 10000));
  }
  const says = { scheduled: "scheduled", "in-progress": "being published", executed: "published", failed: "failed", canceled: "taken back" };
  for (const p of shown) console.log(`${p.target}: ${says[p.status] || p.status}${p.status === "scheduled" && p.date !== "now" ? ` for ${p.date}` : ""}${p.permalink ? ` · ${p.permalink}` : ""}${p.errorMessage ? ` (${p.errorMessage})` : ""}`);
  if (shown.some((p) => p.status === "failed")) console.log(`\nA failed post: tell the person why in a sentence; once the cause is fixed, ${cmd(`publish ${rel(dir)} --to <that target> …`)} schedules it anew.`);
}

async function cmdCancel([dir], opts) {
  if (!dir) fail(`${self()} cancel <dir> [--to <target>,…]`);
  const [file, plan] = loadPlan(dir);
  const only = list(opts.to);
  const api = await needApi();
  let n = 0;
  for (const p of plan.posts.filter((x) => live(x) && (!only.length || only.includes(x.target)))) {
    const proc = PROCEDURES[p.procedure];
    try {
      const res = await call(api, proc.cancel, { [proc.uuid]: p.uuid });
      p.status = res.status || "canceled";
      n++;
      console.log(`${p.target}: taken back`);
    } catch (e) { console.log(`✗ ${p.target}: ${e.message}`); }
    writeJson(file, plan);
  }
  if (!n) console.log("Nothing to take back.");
}

const [command, ...rest] = process.argv.slice(2);
const [pos, opts] = parse(rest);
if (command === "check") await cmdCheck(pos, opts);
else if (command === "prepare") await cmdPrepare(pos, opts);
else if (command === "accounts") await cmdAccounts(pos, opts);
else if (command === "publish") await cmdPublish(pos, opts);
else if (command === "status") await cmdStatus(pos, opts);
else if (command === "cancel") await cmdCancel(pos, opts);
else fail(`${self()} check <video|link> <dir> | prepare <dir> | accounts [<dir>] | publish <dir> --to … | status <dir> | cancel <dir>`);
