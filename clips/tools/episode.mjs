#!/usr/bin/env node
// A long video (a YouTube episode, a talk) as the source of several shorts.
//
//   node tools/episode.mjs fetch <url|file> <dir> [--no-names]
//        the episode's facts, its sound, and every word with its time and who speaks it:
//        <dir>/episode.json, <dir>/words.json, <dir>/sentences.json and <dir>/sentences.txt,
//        one numbered sentence a line, `12 [66:44–66:51] A: …`, to read and pick from; then the
//        names (below), unless --no-names: the words keep the speech model's spellings then
//   node tools/episode.mjs moments <dir> [--count N] [--max-seconds N]
//        the candidates for shorts, picked by Gemini through OpenRouter from sentences.txt (five to
//        nine cents an hour), in the order of the episode, each a whole passage: <dir>/moments.json and a short list
//        to read. --max-seconds is how long a short may be (59: it fits every post type; higher is a trade:
//        long passages whole more often, short ones with more around them); a passage
//        that is longer is returned whole, with the sentences that can go marked (`drop`)
//   node tools/episode.mjs names <dir> [--take N,…] [--leave N,…] [--also "Name, Name"]
//        the names in the words spelled as the video's page spells them (page.json: title,
//        description, chapters, tags, channel, its own uploaded captions): one model call over the
//        page and the sentences (a cent or two an hour), a correction applied where the page
//        writes the name and only the spelling differs, proposed where it is less sure, refused
//        where it would change what was said; <dir>/names.json lists each with its places, the
//        words as written stay in <dir>/words.raw.json. --take / --leave apply or take back
//        corrections by number without a model; --also adds names the person gave. fetch runs it
//   node tools/episode.mjs cut <dir> <first>-<last> <clip.mp4>
//   node tools/episode.mjs cut <dir> <from> <to> <clip.mp4>
//        the stretch as a video file, up to 4K: the sentences first..last (a little air around them),
//        or from/to in seconds (or m:ss, h:mm:ss); then the skill that edits it takes the clip
//        (clips.mjs prepare does this cut itself; kinetic-lyrics: short.mjs new <short> <clip.mp4>)
//
// A file instead of a link (an upload, a recording of the person's own) goes the same way: its
// sound is written down as it is, its stretches are cut from it with ffmpeg.
//
// The words come from ElevenLabs Scribe through OpenRouter, run by agentitos' transcribe skill
// beside this one (OPENROUTER_API_KEY or the Sprites gateway's OpenRouter connection, with
// speakers, about 22 cents an hour, twice that when the voices need its long requests, a few
// minutes; the noises it marks among the words are left out), else from the video's captions on
// YouTube (no speakers): without OpenRouter, or when the transcription fails, and then fetch says
// so in its last line. A key that OpenRouter turns away ends fetch at once: nothing after it would
// work. yt-dlp: the one on the PATH, else a copy downloaded once into ~/.cache/agentitos/.
//
// A YouTube link on a machine of storrito.ai's goes through storrito.ai's downloads instead of
// this machine's yt-dlp (lib/youtube.mjs): YouTube turns a Sprite's own address away much of the
// time. The facts, the sound, the captions and every cut are then a download each, billed to the
// organisation's balance by its bytes; a refusal (the balance is used up, the video is private)
// ends the tool with its sentence. A cut comes with at most 1440 lines unless --height, or
// CLIPS_HEIGHT in the environment, says 720, 1080 or 2160. Where the downloads are off, and for a
// link that is not YouTube's, yt-dlp runs here as before.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { transcribeFile, transcribeTool, NEEDS_TRANSCRIBE } from "./lib/transcribe.mjs";
import { duration } from "./lib/media.mjs";
import { videoId, downloads, fetched, save, giveUp } from "./lib/youtube.mjs";
import { openrouter, keyRejected, rejectedIn, REJECTED } from "./lib/openrouter.mjs";
import { KINDS, MAX_SECONDS, arrange, momentsPrompt, listing } from "./lib/moments.mjs";
import { NAMES_MODEL, NAMES_SCHEMA, LOOK_SCHEMA, pageOf, pageSources, ownTokens, entriesOf, applyNames, namesPrompt, namesListing, lookItems, lookPrompt, applyLook } from "./lib/names.mjs";

const fail = (message) => { console.log(message); process.exit(1); };
const log = (...a) => console.error(...a);
const mmss = (t) => {
  const s = Math.max(0, Math.floor(t)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
};
const seconds = (v) => {
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
  const parts = String(v).split(":").map(Number);
  if (parts.some(Number.isNaN)) fail(`Not a time: ${v}`);
  return parts.reduce((a, b) => a * 60 + b, 0);
};

// ---------------------------------------------------------------- yt-dlp
function ytdlp() {
  const which = (() => { try { return execFileSync("which", ["yt-dlp"], { encoding: "utf8" }).trim(); } catch { return ""; } })();
  if (which) return which;
  const dir = path.join(os.homedir(), ".cache", "agentitos");
  const bin = path.join(dir, "yt-dlp");
  if (!fs.existsSync(bin)) {
    const asset = process.platform === "darwin" ? "yt-dlp_macos" : process.arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
    log("episode: getting yt-dlp once …");
    fs.mkdirSync(dir, { recursive: true });
    execFileSync("curl", ["-fsSL", "-o", bin, `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`]);
    fs.chmodSync(bin, 0o755);
  }
  return bin;
}
const run = (args, opts = {}) => execFileSync(ytdlp(), args, { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"], ...opts });

// YouTube turns a server away now and then (403, 429, "reload the page") and lets it in a
// little later: such a refusal is tried twice more, after a pause
const refused = (e) => /HTTP Error 40[34]|HTTP Error 429|Forbidden|needs to be reloaded|Sign in to confirm/i.test(String(e.stderr || e.message));
function download(args) {
  for (let attempt = 1; ; attempt++) {
    try {
      return run(args);
    } catch (e) {
      if (attempt >= 3 || !refused(e)) throw e;
      log(`episode: YouTube refused (${String(e.stderr || "").trim().split("\n").pop()}), again in ${attempt * 20} s …`);
      execFileSync("sleep", [String(attempt * 20)]);
    }
  }
}

// ---------------------------------------------------------------- sentences
// sentences end at . ! ? … and where the speaker changes
function sentencesOf(words) {
  const out = [];
  let cur = null;
  words.forEach((w, i) => {
    if (cur && w.speaker != null && w.speaker !== words[i - 1].speaker) { out.push(cur); cur = null; }
    if (!cur) cur = { first: i, last: i, start: w.start, end: w.end, speaker: w.speaker ?? null, text: [] };
    cur.text.push(w.text); cur.last = i; cur.end = w.end;
    if (/[.!?…]["”']?$/.test(w.text)) { out.push(cur); cur = null; }
  });
  if (cur) out.push(cur);
  return out.map((s) => ({ ...s, text: s.text.join(" ") }));
}

// YouTube's json3 captions: events with segments, a time each. Automatic captions time every
// word; a segment of several words (captions typed by hand) shares its time among them.
function captionWords(file) {
  const events = JSON.parse(fs.readFileSync(file, "utf8")).events || [];
  const segs = [];
  for (const e of events) for (const s of e.segs || []) {
    const text = (s.utf8 || "").replace(/\s+/g, " ").trim();
    if (text) segs.push({ text, start: ((e.tStartMs || 0) + (s.tOffsetMs || 0)) / 1000, eventEnd: ((e.tStartMs || 0) + (e.dDurationMs || 0)) / 1000 });
  }
  const words = [];
  segs.forEach((seg, i) => {
    const end = Math.max(seg.start + 0.1, Math.min(seg.eventEnd, segs[i + 1] ? segs[i + 1].start : seg.eventEnd));
    const parts = seg.text.split(" "), chars = parts.reduce((a, p) => a + p.length, 0) || 1;
    let t = seg.start;
    for (const part of parts) {
      const d = ((end - seg.start) * part.length) / chars;
      words.push({ text: part, start: +t.toFixed(3), end: +(t + Math.max(d, 0.05)).toFixed(3) });
      t += d;
    }
  });
  return words;
}

// The captions to take: YouTube's automatic ones in the language spoken (the key ending in
// -orig, timed word by word), else the video's own, never a translation
function captionTrack(info) {
  const lang = (info.language || "").split("-")[0];
  const auto = Object.keys(info.automatic_captions || {});
  const own = Object.keys(info.subtitles || {}).filter((k) => k !== "live_chat");
  return auto.find((k) => k.endsWith("-orig"))
    || own.find((k) => lang && k.startsWith(lang)) || own[0]
    || auto.find((k) => lang && k === lang) || auto.find((k) => k === "en") || null;
}

// The video's own uploaded captions in the language spoken (typed or checked by the channel, never
// YouTube's automatic ones): their names are spelled as the channel spells them
function ownTrack(info, lang) {
  const own = Object.keys(info.subtitles || {}).filter((k) => k !== "live_chat");
  return own.find((k) => lang && k.split("-")[0] === lang) || null;
}
async function ownCaptions(info, url, lang, video = null) {
  const track = ownTrack(info, lang);
  if (!track) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "episode-own-"));
  try {
    if (video) {
      const got = await fetched({ video, kind: "captions", track }, log);
      if (!got) throw new Error("storrito.ai's downloads are off");
      await save(got, 0, path.join(tmp, "own.json3"));
      await giveUp(got.id);
    } else {
      download(["--skip-download", "--write-subs", "--sub-langs", track, "--sub-format", "json3", "--no-playlist", "-o", path.join(tmp, "own"), url]);
    }
    const file = fs.readdirSync(tmp).find((f) => f.endsWith(".json3"));
    return file ? captionWords(path.join(tmp, file)) : null;
  } catch (e) {
    log(`episode: the video's own captions did not come (${String(e.stderr || e.message).trim().split("\n").pop()}); the names go by the page without them …`);
    return null;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- fetch
// what fetch says when the words are YouTube's captions although OpenRouter is there
const CAPTIONS_INSTEAD = (why) => `These are YouTube's captions, without voices, because ${/^YouTube/.test(why) ? why : `the transcription failed (${String(why).slice(0, 200)})`}: `
  + `run fetch again for the voices (the framing and an exchange between two people need them). `;

// a path that exists, not a link
const isFile = (source) => !/^https?:\/\//i.test(source) && fs.existsSync(source);

// the words, their sentences and the numbered list moments reads
function writeWords(dir, words) {
  const sentences = sentencesOf(words);
  fs.writeFileSync(path.join(dir, "words.json"), JSON.stringify(words));
  fs.writeFileSync(path.join(dir, "sentences.json"), JSON.stringify(sentences));
  fs.writeFileSync(path.join(dir, "sentences.txt"), sentences.map((s, k) =>
    `${k} [${mmss(s.start)}–${mmss(s.end)}]${s.speaker ? " " + s.speaker + ":" : ""} ${s.text}`).join("\n") + "\n");
  return sentences;
}

function writeEpisode(dir, facts, heard, note = "", cost = null) {
  // what was said: the transcription writes the noises it hears among the words ("[laughs]", kind: "event")
  const words = heard.filter((w) => w.kind !== "event");
  if (!words.length) fail("No words found: is there speech in it?");
  const episode = { ...facts, words: words.length, speakers: [...new Set(words.map((w) => w.speaker).filter(Boolean))] };
  fs.writeFileSync(path.join(dir, "episode.json"), JSON.stringify(episode, null, 1));
  // words written anew: the names corrected in the old ones are not this transcription's
  for (const f of ["words.raw.json", "names.json"]) fs.rmSync(path.join(dir, f), { force: true });
  const sentences = writeWords(dir, words);
  console.log(`${episode.title} (${mmss(episode.duration || 0)}): ${words.length} words, ${sentences.length} sentences${cost != null ? ` ($${cost.toFixed(4)} for the words)` : ""}`
    + (episode.speakers.length ? `, voices ${episode.speakers.join(" ")}` : "") + `. ${note}episode.mjs moments ${dir} picks the moments; `
    + `episode.mjs cut ${dir} <first>-<last> <clip.mp4> cuts one.`);
}

// the person's own file: no captions to fall back on, so the words need the key
async function fetchFile(file, dir, names = true) {
  if (!transcribeTool()) fail(NEEDS_TRANSCRIBE);
  const or = await openrouter();
  if (!or) fail("No OpenRouter (OPENROUTER_API_KEY, or on a Sprite the gateway's OpenRouter connection): a file has no captions to take the words from.");
  const turnedAway = await keyRejected(or);
  if (turnedAway) fail(REJECTED(turnedAway));
  const title = path.basename(file).replace(/\.[^.]+$/, "");
  const length = duration(file);
  log(`episode: writing down every word of “${title}” (${mmss(length)}) and who speaks it, a few minutes …`);
  let words, cost;
  try { ({ words, cost } = await transcribeFile(file, { speakers: true, log })); } catch (e) { fail(e.message); }
  writeEpisode(dir, { file, url: null, id: null, title, channel: null, duration: length, lang: null, source: "openrouter" }, words, "", cost);
  // no page: the names come from the model's knowledge and what the person gives (names --also)
  fs.writeFileSync(path.join(dir, "page.json"), JSON.stringify(pageOf({ title }), null, 1));
  if (names) await namesAfterFetch(dir);
}

// ---------------------------------------------------------------- storrito.ai's downloads
// A download of storrito.ai's once it is done; null when the downloads are off on the site. A
// refusal ends the tool with its sentence, which the agent passes on.
async function asked(job) {
  try { return await fetched(job, log); } catch (e) { return fail(e.message); }
}

// The facts of a download as yt-dlp's -J names them, which the rest of fetch reads.
function factsOf(video, got) {
  const keyed = (keys) => Object.fromEntries((keys || []).map((k) => [k, []]));
  return {
    id: video, webpage_url: got.webpage_url || `https://www.youtube.com/watch?v=${video}`, title: got.title, channel: got.channel, uploader: got.uploader,
    duration: got.seconds, language: got.language, description: got.description, chapters: got.chapters, tags: got.tags, creators: got.creators,
    automatic_captions: keyed(got.captions?.automatic), subtitles: keyed(got.captions?.own),
  };
}

// The stretch through storrito.ai's downloads: fetched with two seconds of air on both sides,
// since a download begins where the video has a keyframe, then cut anew to the word on this
// machine, as a file's stretch is (held against the cut of this machine's own yt-dlp on
// 2026-11-25: the same frames). 1440 lines unless --height says otherwise: a third of that wide
// shot is 810 pixels wide, and 4K costs two and a half times the bytes (30 s took 39 MB at 1440
// lines, 95 MB at 2160, 24 MB at 1080). A way out through a modem gives 1080 lines at most; the
// cut is what came. False when the downloads are off.
const AIR = 2;
async function cutThroughDownloads(video, from, to, base, height) {
  const first = Math.max(0, Math.floor(from) - AIR), last = Math.ceil(to) + AIR;
  const got = await asked({ video, kind: "sections", sections: [[first, last]], height });
  if (!got) return false;
  const raw = `${base}.raw.mp4`;
  try { await save(got, 0, raw); } catch (e) { fail(e.message); }
  await giveUp(got.id);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", (from - first).toFixed(2), "-i", raw, "-t", (to - from).toFixed(2),
    "-map", "0:v:0", "-map", "0:a:0?", "-vf", "scale=-2:'min(2160,ih)'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", `${base}.mp4`], { stdio: ["ignore", "inherit", "inherit"] });
  fs.rmSync(raw, { force: true });
  return true;
}

async function fetchEpisode(url, dir, ...rest) {
  if (!url || !dir || rest.some((r) => r !== "--no-names")) fail("episode.mjs fetch <url|file> <dir> [--no-names]");
  const names = !rest.includes("--no-names");
  fs.mkdirSync(dir, { recursive: true });
  if (isFile(url)) return fetchFile(path.resolve(url), dir, names);
  // a YouTube link on a machine with storrito.ai's downloads goes through them; `video` turns
  // null when they are off on the site, and this machine's yt-dlp does it as before
  let video = (await downloads()) ? videoId(url) : null;
  let info;
  if (video) {
    log("episode: reading the video's facts through storrito.ai's downloads …");
    const got = await asked({ video, kind: "info" });
    if (got) { await giveUp(got.id); info = factsOf(video, got); } else video = null;
  }
  if (!video) log("episode: reading the video's facts …");
  // the page's facts: without them (YouTube refused them three times) the sound may still come;
  // then there is no title, no description and no page for the names
  if (!info) try { info = JSON.parse(download(["-J", "--skip-download", "--no-playlist", url])); } catch (e) {
    log(`episode: YouTube gave no facts of the video (${String(e.stderr || e.message).trim().split("\n").pop()}); the sound without them …`);
    const id = (String(url).match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/) || [])[1] || null;
    info = { webpage_url: url, id, title: id ? `YouTube ${id}` : url, unread: true };
  }
  const track = captionTrack(info);
  const lang = (info.language || track || "").split("-")[0] || null;
  let words, source, cost = null, note = info.unread ? "YouTube gave no facts of the video (title, description, chapters): the names had no page to go by. " : "";
  // the sound and words of an episode fetched into this folder before are not this one's
  for (const f of fs.readdirSync(dir)) if (/^audio\./.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  const or = await openrouter();
  if (or) {
    if (!transcribeTool()) fail(NEEDS_TRANSCRIBE);
    // a key OpenRouter turns away: the captions would come out as if all were well, and
    // moments, the framing and the edit would fail one after the other
    const turnedAway = await keyRejected(or);
    if (turnedAway) fail(REJECTED(turnedAway));
    log(`episode: the sound of “${info.title}” (${mmss(info.duration || 0)}) …`);
    let audio = null;
    try {
      // the full-rate m4a (about 130 kbit/s): at about 50 kbit/s the download is a few seconds
      // shorter, but Gemini's speakers fell apart there, nine to thirteen voices where the full
      // rate heard four (measured 2026-10-19, when Gemini wrote the episode down; Scribe's at the
      // lower rate are not measured)
      if (video) {
        // the downloads give the full rate too, also through a modem (measured 2026-11-25)
        const got = await fetched({ video, kind: "audio" }, log);
        if (!got) throw new Error("storrito.ai's downloads are off");
        await save(got, 0, path.join(dir, "audio.m4a"));
        await giveUp(got.id);
      } else {
        download(["-f", "bestaudio[ext=m4a]/bestaudio", "--no-playlist", "-o", path.join(dir, "audio.%(ext)s"), url]);
      }
      audio = fs.readdirSync(dir).find((f) => /^audio\./.test(f) && !f.endsWith(".part"));
    } catch (e) {
      // the captions still give every word and its time; the speakers come with each cut clip
      log(`episode: YouTube gave no sound (${String(e.stderr || e.message).trim().split("\n").pop()}), the captions instead …`);
    }
    if (audio) {
      log("episode: writing down every word and who speaks it, a few minutes …");
      try {
        ({ words, cost } = await transcribeFile(path.join(dir, audio), { lang: lang || "auto", speakers: true, log }));
        source = "openrouter";
      } catch (e) {
        if (rejectedIn(e.message)) fail(REJECTED(rejectedIn(e.message)));
        log(`episode: the transcription failed (${e.message}), the captions instead …`);
        note = CAPTIONS_INSTEAD(e.message);
      }
    } else {
      note = CAPTIONS_INSTEAD("YouTube gave no sound");
    }
  } else {
    log("episode: no OpenRouter, the captions on YouTube (no speakers) …");
    note = "These are YouTube's captions, without voices: there is no OpenRouter (OPENROUTER_API_KEY, or on a Sprite the gateway's connection), and without it moments cannot pick. ";
  }
  if (!words) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "episode-"));
    if (!track) fail("No sound from YouTube and no captions: nothing to write the words down from. Try again in a while.");
    // one track only: YouTube answers a second one with 429 now and then
    if (video) {
      const got = await asked({ video, kind: "captions", track });
      if (got) {
        try { await save(got, 0, path.join(tmp, "subs.json3")); } catch (e) { fail(e.message); }
        await giveUp(got.id);
      }
    } else {
      download(["--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", track, "--sub-format", "json3", "--no-playlist", "-o", path.join(tmp, "subs"), url]);
    }
    const file = fs.readdirSync(tmp).find((f) => f.endsWith(".json3"));
    if (!file) fail("No sound from YouTube and no captions: nothing to write the words down from. Try again in a while.");
    words = captionWords(path.join(tmp, file));
    source = "captions";
  }
  // the description as the channel's audience sees it: moments counts the names in it as introduced
  const sound = fs.readdirSync(dir).find((f) => /^audio\./.test(f) && !f.endsWith(".part"));
  writeEpisode(dir, {
    url: info.webpage_url || url, id: info.id, title: info.title, channel: info.channel || info.uploader,
    duration: info.duration ?? (sound ? duration(path.join(dir, sound)) : null), lang, source, description: String(info.description || "").slice(0, 1500),
  }, words, note, cost);
  // the page as a whole, for the names: the description in full, the chapters, the tags, and what
  // the video's own captions write that the transcription does not
  const own = info.unread ? null : await ownCaptions(info, url, lang, video);
  const kept = JSON.parse(fs.readFileSync(path.join(dir, "words.json"), "utf8"));
  fs.writeFileSync(path.join(dir, "page.json"), JSON.stringify(pageOf(info.unread ? {} : info, own ? ownTokens(own, kept) : null), null, 1));
  if (!or) return;
  if (names) await namesAfterFetch(dir);
  else console.log(`The names were not checked (--no-names): the words keep the speech model's spellings; episode.mjs names ${dir} checks them later (a cent or two).`);
}

// ---------------------------------------------------------------- names
// The names model thinks little before it answers: on both test episodes (2026-11-19) it found as
// many names or more that way, for a quarter of the cost (1.4 and 1.9 cents instead of 6.7 and 6.6)
const NAMES_REASONING = { effort: "low" };
const NAMES_USAGE = 'episode.mjs names <dir> [--take N,…] [--leave N,…] [--also "Name, Name"]';
const isNames = (j) => (j && typeof j === "object" && Array.isArray(j.names) && Array.isArray(j.fixes) ? j : null);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function namesOptions(rest) {
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const k = { "--take": "take", "--leave": "leave", "--also": "also" }[rest[i]];
    if (!k) fail(`Unknown option ${rest[i]}: ${NAMES_USAGE}`);
    if (i + 1 >= rest.length) fail(`${rest[i]} needs a value: ${NAMES_USAGE}`);
    opts[k] = rest[++i];
  }
  for (const k of ["take", "leave"]) if (opts[k] != null) {
    const list = String(opts[k]).split(",").map((v) => Number(v.trim()));
    if (list.some((n) => !Number.isInteger(n) || n < 1)) fail(`--${k} takes the numbers of the list, as --${k} 3,5.`);
    opts[k] = list;
  }
  return opts;
}

// The names corrected in the episode's words; → the list (names.json), or a throw that says why
async function correctNames(dir, opts = {}) {
  const wordsFile = path.join(dir, "words.json"), rawFile = path.join(dir, "words.raw.json"), listFile = path.join(dir, "names.json"), pageFile = path.join(dir, "page.json");
  if (!fs.existsSync(wordsFile)) throw new Error(`There are no words in ${dir}: episode.mjs fetch <url|file> ${dir} first.`);
  const raw = readJson(fs.existsSync(rawFile) ? rawFile : wordsFile);
  const sentences = sentencesOf(raw);
  const episode = fs.existsSync(path.join(dir, "episode.json")) ? readJson(path.join(dir, "episode.json")) : {};
  // an episode fetched before the page was kept: what episode.json holds of it
  const page = fs.existsSync(pageFile) ? readJson(pageFile) : pageOf({ title: episode.title, channel: episode.channel, description: episode.description });
  if (opts.also) {
    page.also = [...new Set([...(page.also || []), ...String(opts.also).split(",").map((t) => t.trim()).filter(Boolean)])];
    fs.writeFileSync(pageFile, JSON.stringify(page, null, 1));
  }
  const before = fs.existsSync(listFile) ? readJson(listFile) : null;
  // --take and --leave mean the numbers of the list on disk, the one the agent read; with --also
  // they are decided there first and carried into the new list
  const both = (opts.take || []).filter((n) => (opts.leave || []).includes(n));
  if (both.length) throw new Error(`Correction ${both.join(", ")} is in both --take and --leave: name each in one of them.`);
  if ((opts.take || opts.leave) && !before) throw new Error(`There is no list of names in ${dir} to take from: episode.mjs names ${dir} first.`);
  for (const [list, status, taken] of [[opts.take, "applied", "taken"], [opts.leave, "proposed", "left out"]]) for (const n of list || []) {
    const e = before.entries.find((x) => x.n === n);
    if (!e) throw new Error(`There is no correction ${n} in the list (1–${before.entries.length}).`);
    if (e.status === "refused") throw new Error(`Correction ${n} is refused (${e.refused}): it is never applied; a name the tool cannot reach is fixed in the clip's cut.json "fixes".`);
    Object.assign(e, { status, taken });
  }
  let j, lost = [];
  if ((opts.take || opts.leave) && !opts.also) {
    j = before;
  } else {
    const or = await openrouter();
    if (!or) throw new Error("No OpenRouter (OPENROUTER_API_KEY, or on a Sprite the gateway's OpenRouter connection): the names are read by a model; the words stay as the transcription wrote them.");
    log(`episode: the names in the words, against the video's page (${NAMES_MODEL}) …`);
    const { answer, cost, usage } = await ask(or, namesPrompt(page, sentences), "names", NAMES_SCHEMA, { model: NAMES_MODEL, isAnswer: isNames, what: "list of names", reasoning: NAMES_REASONING });
    const sources = pageSources(page);
    const entries = entriesOf(answer, raw, sentences, sources, { lang: episode.lang });
    // the second look: is the one spoken of at each place the page's? Only a clear yes stays applied
    const items = lookItems(entries, raw, sentences);
    let looked = 0;
    if (items.length) {
      log(`episode: a second look at the ${items.length} place${items.length === 1 ? "" : "s"} to apply …`);
      let seen = null;
      try { const r = await ask(or, lookPrompt(page, items), "look", LOOK_SCHEMA, { model: NAMES_MODEL, isAnswer: (x) => (x && Array.isArray(x.places) ? x : null), what: "look at the places", reasoning: NAMES_REASONING }); seen = r.answer; looked = r.cost; } catch (e) {
        log(`episode: the second look failed (${e.message}); its places stay proposals …`);
      }
      applyLook(entries, seen);
    }
    // what the agent decided on the list before stays decided where the same correction of the
    // same place comes again; a decision the new list has no place for is said
    const same = (x, e) => x.from === e.from && x.to === e.to && x.places?.[0]?.first === e.places?.[0]?.first;
    for (const x of before?.entries?.filter((x) => x.taken) || []) {
      const e = entries.find((y) => same(x, y));
      if (e && e.status !== "refused") Object.assign(e, { status: x.status, taken: x.taken });
      else lost.push(x);
    }
    // the model's own answer stays beside the list: what it found, before the rules decided
    j = { model: NAMES_MODEL, cost: +(cost + looked).toFixed(4), usage, names: answer.names, entries, found: answer.fixes };
  }
  if (!fs.existsSync(rawFile)) fs.writeFileSync(rawFile, JSON.stringify(raw));
  writeWords(dir, applyNames(raw, j.entries));
  fs.writeFileSync(listFile, JSON.stringify(j, null, 1));
  return { j, raw, lost, moments: fs.existsSync(path.join(dir, "moments.json")), changed: Boolean(opts.take || opts.leave || before) };
}

function namesReport(dir, { j, raw, lost = [], moments: picked, changed }) {
  console.log(namesListing(j, raw));
  if (lost.length) console.log(`Not in the new list, so not carried over: ${lost.map((x) => `"${x.from}" → "${x.to}" (${x.taken})`).join(", ")}; take it again from the list above if it is there under another number.`);
  const proposed = j.entries.filter((e) => e.status === "proposed").length;
  console.log(`${path.join(dir, "names.json")} lists them with every place ($${(j.cost || 0).toFixed(4)}); the words as written are in ${path.join(dir, "words.raw.json")}. `
    + (proposed ? `Each entry is one place. The proposed ones are not applied and never will be by themselves: take one only where its sentence shows that name was said there (episode.mjs names ${dir} --take <n>,…), leave the rest; ` : "")
    + `--leave <n> takes an applied one back; --also "Name, …" adds names the person gives (asks the model again). `
    + (picked ? `moments.json was picked from the words before: run moments again so that its titles, hooks and reasons carry the names. ` : `Next: episode.mjs moments ${dir}. `)
    + (changed ? `A clip prepared before keeps the old spelling until clips.mjs names <clip> puts the list on its words again (then build it again).` : ""));
}

async function names(dir, ...rest) {
  if (!dir) fail(NAMES_USAGE);
  const opts = namesOptions(rest);
  try { namesReport(dir, await correctNames(dir, opts)); } catch (e) { fail(e.message); }
}

// fetch ends with the names; when they fail, the words stay as written and fetch says so
async function namesAfterFetch(dir) {
  try { namesReport(dir, await correctNames(dir)); } catch (e) {
    console.log(`The names were not checked (${e.message.replace(/\.$/, "")}): the words stay as the transcription wrote them; episode.mjs names ${dir} tries again.`);
  }
}

// ---------------------------------------------------------------- cut
async function cut(dir, ...rest) {
  // --height N, else CLIPS_HEIGHT (clips.mjs prepare runs this tool without flags), else 1440:
  // the most lines of a cut that comes through storrito.ai's downloads
  const flag = rest.indexOf("--height");
  const height = flag === -1 ? Number(process.env.CLIPS_HEIGHT || 1440) : Number(rest.splice(flag, 2)[1]);
  if (![720, 1080, 1440, 2160].includes(height)) fail("The height of a cut (--height, or CLIPS_HEIGHT) is 720, 1080, 1440 or 2160.");
  const [a, b, c] = rest;
  if (!dir || !a || !b) fail("episode.mjs cut <dir> <first>-<last> <clip.mp4> [--height N]  or  cut <dir> <from> <to> <clip.mp4> [--height N]");
  const episode = JSON.parse(fs.readFileSync(path.join(dir, "episode.json"), "utf8"));
  let from, to, out;
  const range = /^(\d+)-(\d+)$/.exec(a);
  if (range && c === undefined) {
    const sentences = JSON.parse(fs.readFileSync(path.join(dir, "sentences.json"), "utf8"));
    const s0 = sentences[Number(range[1])], s1 = sentences[Number(range[2])];
    if (!s0 || !s1 || Number(range[1]) > Number(range[2])) fail(`No sentences ${a} (there are 0–${sentences.length - 1}).`);
    // a breath before the first word, the end of the last word heard out
    from = Math.max(0, s0.start - 0.35); to = s1.end + 0.6; out = b;
  } else {
    from = seconds(a); to = seconds(b); out = c;
  }
  if (!out) fail("Name the video file to write: …/clip.mp4");
  if (to - from > 180) fail(`That is ${Math.round(to - from)} s; a short takes at most a minute or so.`);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const base = out.replace(/\.mp4$/, "");
  // yt-dlp leaves a file that exists alone: a cut onto a name used before is cut again
  for (const f of fs.readdirSync(path.dirname(path.resolve(out)))) {
    if (f.startsWith(path.basename(base) + ".")) fs.rmSync(path.join(path.dirname(path.resolve(out)), f), { force: true });
  }
  log(`episode: cutting ${mmss(from)}–${mmss(to)} (${(to - from).toFixed(1)} s) …`);
  if (episode.file) {
    // from the person's file, up to 4K like a download; cut anew, not copied, so it starts on the
    // word; without the file's tags (a phone's video names the place it was recorded at)
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", from.toFixed(2), "-i", episode.file, "-t", (to - from).toFixed(2),
      "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1", "-vf", "scale=-2:'min(2160,ih)'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16",
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", `${base}.mp4`], { stdio: ["ignore", "inherit", "inherit"] });
    fs.writeFileSync(`${base}.json`, JSON.stringify({ file: episode.file, from: +from.toFixed(2), to: +to.toFixed(2) }));
    console.log(`${base}.mp4: ${(to - from).toFixed(1)} s from ${mmss(from)}. Next: the skill that edits it (kinetic-lyrics: short.mjs new <short> ${base}.mp4).`);
    return;
  }
  const video = (await downloads()) ? videoId(episode.url) : null;
  if (video && (await cutThroughDownloads(video, from, to, base, height))) {
    fs.writeFileSync(`${base}.json`, JSON.stringify({ url: episode.url, from: +from.toFixed(2), to: +to.toFixed(2) }));
    console.log(`${base}.mp4: ${(to - from).toFixed(1)} s from ${mmss(from)}. Next: the skill that edits it (kinetic-lyrics: short.mjs new <short> ${base}.mp4).`);
    return;
  }
  // up to 4K: the short shows a third of the wide shot's width, cut closer still in a wide shot
  // (tools/frame.mjs); from 1080p that third is 608 pixels wide and comes out soft
  download(["-f", "bv*[height<=2160]+ba[ext=m4a]/bv*[height<=2160]+ba/b[height<=2160]/b",
    "--download-sections", `*${from.toFixed(2)}-${to.toFixed(2)}`, "--force-keyframes-at-cuts",
    "--merge-output-format", "mp4", "--no-playlist", "-o", `${base}.%(ext)s`, episode.url]);
  if (!fs.existsSync(`${base}.mp4`)) fail("The cut did not come out, see above.");
  fs.writeFileSync(`${base}.json`, JSON.stringify({ url: episode.url, from: +from.toFixed(2), to: +to.toFixed(2) }));
  console.log(`${base}.mp4: ${(to - from).toFixed(1)} s from ${mmss(from)}. Next: the skill that edits it (kinetic-lyrics: short.mjs new <short> ${base}.mp4).`);
}

// ---------------------------------------------------------------- moments
// The candidates for shorts, picked by a model that reads the whole episode once (Gemini through
// OpenRouter, five to nine cents and a minute or two for an hour), so that the agent does not:
// what it reads stays in every later step of its chat and makes each of them slower and dearer.
//
// A moment is a whole passage, from the sentence that opens it to its last conclusion, as the
// channels' own editors cut them (clips-eval, 2026-11-17: their passages have a median of 60 s
// in the episode, and they cut a median of 10 s of words out of the inside). The length a short
// may have comes with --max-seconds; a passage up to 1.7 times that long is returned whole, with
// the sentences that can go marked (`drop`). The moments come in the order of the episode and
// nothing ranks them: the old score (8 to 10 points for all 77 moments of the first measurement),
// the model's own ranking and its rating of the first line (`opens`, which only settles which of
// two overlapping moments stays) put the editors' picks no further ahead than chance. What can be
// counted (a question at the start, the question just before it that it answers, a conjunction in
// the middle of a turn, the voices, the length against the limit) the tool counts itself (`checks`). The model also counts what the episode holds
// (claims, stories, numbers, mistakes, how-tos, answers, exchanges: under four in all it is too
// thin for clips), writes an on-screen hook for a moment whose first line does not hook, names
// the sentence with the strongest line (`payoff`), and the ideas spread too far over the episode
// to cut, to be recorded anew. "Stands alone" is judged for the channel's own followers: the
// names in the video's title and description count as introduced.
export const MOMENTS_MODEL = "google/gemini-3.8-flash";
const MOMENTS_SCHEMA = {
  type: "object", additionalProperties: false, required: ["inventory", "moments", "ideas"],
  properties: {
    inventory: { type: "object", additionalProperties: false, required: KINDS, properties: Object.fromEntries(KINDS.map((k) => [k, { type: "integer" }])) },
    moments: { type: "array", items: {
      type: "object", additionalProperties: false,
      required: ["first", "last", "kind", "title", "why", "opens", "payoff", "drop", "hook", "crosstalk"],
      properties: {
        first: { type: "integer" }, last: { type: "integer" }, kind: { type: "string", enum: KINDS },
        title: { type: "string" }, why: { type: "string" }, opens: { type: "integer" },
        payoff: { type: "integer" }, drop: { type: "array", items: { type: "integer" } },
        hook: { type: "string" }, crosstalk: { type: "boolean" },
      },
    } },
    ideas: { type: "array", items: {
      type: "object", additionalProperties: false, required: ["title", "sentences", "why"],
      properties: { title: { type: "string" }, sentences: { type: "array", items: { type: "integer" } }, why: { type: "string" } },
    } },
  },
};

const USAGE = "episode.mjs moments <dir> [--count N] [--max-seconds N]";
function momentsOptions(rest) {
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const k = { "--count": "count", "--max-seconds": "limit" }[rest[i]];
    const v = Number(rest[i + 1]);
    if (!k) fail(`Unknown option ${rest[i]}: ${USAGE}`);
    if (!Number.isInteger(v) || v < 1) fail(`${rest[i]} takes a whole number: ${USAGE}`);
    opts[k] = v; i++;
  }
  if (opts.limit != null && (opts.limit < 15 || opts.limit > 600)) fail(`--max-seconds ${opts.limit}: a short is 15 to 600 seconds long (59 fits every post type; Reels, TikTok and Shorts take more).`);
  return opts;
}

// what to do when the model cannot pick: the moments need it (SKILL.md: never read sentences.txt
// yourself), so try again later and tell the person when it still fails
const AGAIN = "run moments again in a few minutes; when it fails again, tell the person the moments cannot be picked right now";

// a model's JSON answer, without a fence around it; null when it is none
const parsed = (content) => { try { return JSON.parse(String(content ?? "").replace(/^```(json)?\s*|\s*```$/g, "")); } catch { return null; } };

// The model's answer when it is one: an object with a list of moments; else null
export function answerOf(content) {
  const j = parsed(content);
  return j && typeof j === "object" && !Array.isArray(j) && Array.isArray(j.moments) ? j : null;
}

// one call to the model with a JSON schema: an error of the request tried three times, an answer
// that is no answer (text, JSON cut off, null, a bare list) once more at once; → { answer, cost }
// or a throw. `cost` counts every attempt.
async function ask(or, prompt, name, schema, { timeout = 300e3, model = MOMENTS_MODEL, isAnswer = answerOf, what = "list of moments", reasoning = null } = {}) {
  let j, cost = 0;
  for (let attempt = 1, empty = 0; ; attempt++) {
    try {
      const res = await fetch(`${or.base}/chat/completions`, {
        method: "POST",
        headers: { ...or.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], ...(reasoning ? { reasoning } : {}),
          response_format: { type: "json_schema", json_schema: { name, strict: true, schema } } }),
        signal: AbortSignal.timeout(timeout),
      });
      j = await res.json();
      if (res.ok && j.choices) {
        cost += j.usage?.cost ?? 0;
        const answer = isAnswer === answerOf ? answerOf(j.choices[0]?.message?.content) : isAnswer(parsed(j.choices[0]?.message?.content));
        if (answer) return { answer, cost, usage: { prompt: j.usage?.prompt_tokens, completion: j.usage?.completion_tokens, reasoning: j.usage?.completion_tokens_details?.reasoning_tokens } };
        const cut = j.choices[0]?.finish_reason === "length";
        if (++empty >= 2) throw Object.assign(new Error(`the model gave no ${what} twice (${cut ? "its answer was cut off" : "an answer that is not one"}, $${cost.toFixed(4)})`), { final: true });
        log(`episode: the model's answer was no ${what}${cut ? " (cut off)" : ""}, once more …`);
        attempt--;
        continue;
      }
      throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
    } catch (e) {
      if (rejectedIn(e.message)) fail(REJECTED(`${rejectedIn(e.message)}${j?.error?.message ? " " + j.error.message : ""}`));
      if (e.final || attempt >= 3) throw e;
      log(`episode: ${e.message}, again …`);
      await new Promise((r) => setTimeout(r, attempt * 5000));
    }
  }
}

const withLinks = (list, sentences, episode) => list.map((m) => ({ ...m, opening: sentences[m.first].text,
  link: episode.id ? `https://youtu.be/${episode.id}?t=${Math.floor(m.start)}` : null }));

function report(dir, episode, sentences, j, cost) {
  const pieces = Object.values(j.inventory || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  console.log(listing(j, sentences, pieces));
  const over = j.moments.filter((m) => m.checks.over).length, still = j.moments.filter((m) => m.checks.still).length;
  console.log(`${j.moments.length} moments in ${path.join(dir, "moments.json")}${episode.id ? " (with their YouTube links)" : ""}, $${cost.toFixed(4)}. `
    + (over ? `${over} ${over === 1 ? "is a whole passage" : "are whole passages"} longer than ${j.limit} s: their marked sentences are left out (clips.mjs prepare … --drop <sentences>). ` : "")
    + (still ? `${still} ${still === 1 ? "is" : "are"} still over ${j.limit} s without ${still === 1 ? "its" : "their"} marked sentences: drop more or offer other moments; --max-seconds 100 only where the person wants such a passage and every platform chosen takes it (short passages then come back with more around them); never one over the limit. ` : "")
    + `A moment's words: sed -n '<first+1>,<last+1>p' ${path.join(dir, "sentences.txt")}. Cut one: episode.mjs cut ${dir} <first>-<last> <clip.mp4>.`);
}

async function moments(dir, ...rest) {
  if (!dir) fail(USAGE);
  const given = momentsOptions(rest);
  const or = await openrouter();
  if (!or) fail("No OpenRouter (OPENROUTER_API_KEY, or on a Sprite the gateway's OpenRouter connection): the moments are picked by a model, so nothing can be cut without it; say so.");
  const episode = JSON.parse(fs.readFileSync(path.join(dir, "episode.json"), "utf8"));
  const sentences = JSON.parse(fs.readFileSync(path.join(dir, "sentences.json"), "utf8"));
  const text = fs.readFileSync(path.join(dir, "sentences.txt"), "utf8");
  const count = given.count ?? Math.max(3, Math.min(10, Math.round((episode.duration || 600) / 540)));
  const limit = given.limit ?? MAX_SECONDS;
  log(`episode: picking moments (${MOMENTS_MODEL}) …`);
  let r;
  try { r = await ask(or, momentsPrompt(episode, text, count, limit), "moments", MOMENTS_SCHEMA); } catch (e) { fail(`Picking the moments failed (${e.message}): ${AGAIN}.`); }
  const { answer } = r;
  const listed = answer.moments.length;
  const pieces = Object.values(answer.inventory || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  // no moments is a thin episode only when the model also found little in it
  if (!listed && pieces >= 4) fail(`The model listed no moments although it counted ${pieces} pieces in the episode ($${r.cost.toFixed(4)}): that is no answer, not a thin episode; ${AGAIN}.`);
  const picked = withLinks(arrange(answer, sentences, { limit }), sentences, episode);
  if (listed && !picked.length) fail(`None of the model's ${listed} moments is a range of this episode's sentences (0–${sentences.length - 1}) ($${r.cost.toFixed(4)}): ${AGAIN}.`);
  if (picked.length < count) log(`episode: the model gave ${picked.length} moments that hold, of the ${count} asked for${listed > picked.length ? ` (${listed - picked.length} overlapped another or named no sentences of the episode)` : ""}.`);
  const ideas = (answer.ideas || []).map((d) => ({ ...d, sentences: (d.sentences || []).filter((k) => sentences[k]),
    at: (d.sentences || []).filter((k) => sentences[k]).map((k) => mmss(sentences[k].start)) }));
  const j = { limit, count, inventory: answer.inventory || {}, moments: picked, ideas };
  fs.writeFileSync(path.join(dir, "moments.json"), JSON.stringify(j, null, 1));
  report(dir, episode, sentences, j, r.cost);
}

const [command, ...args] = process.argv.slice(2);
if (command === "fetch") await fetchEpisode(...args);
else if (command === "cut") await cut(...args);
else if (command === "moments") await moments(...args);
else if (command === "names") await names(...args);
else fail(`episode.mjs fetch <url|file> <dir> [--no-names] | ${NAMES_USAGE.replace("episode.mjs ", "")} | moments <dir> [--count N] [--max-seconds N] | cut <dir> <first>-<last> <clip.mp4> [--height N]`);
