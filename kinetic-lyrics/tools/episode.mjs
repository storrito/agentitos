#!/usr/bin/env node
// A long video (a YouTube episode, a talk) as the source of several shorts.
//
//   node tools/episode.mjs fetch <url> <dir>
//        the episode's facts, its sound, and every word with its time and who speaks it:
//        <dir>/episode.json, <dir>/words.json, <dir>/sentences.json and <dir>/sentences.txt,
//        one numbered sentence a line, `12 [66:44–66:51] A: …`, to read and pick from
//   node tools/episode.mjs cut <dir> <first>-<last> <clip.mp4>
//   node tools/episode.mjs cut <dir> <from> <to> <clip.mp4>
//        the stretch as a video file, up to 4K: the sentences first..last (a little air around them),
//        or from/to in seconds (or m:ss, h:mm:ss); then `short.mjs new <short> <clip.mp4>`
//
// The words come from Gemini 3.5 Transcribe through OpenRouter (OPENROUTER_API_KEY, with
// speakers, a few cents an hour, a few minutes), else from the video's captions on YouTube
// (no speakers). yt-dlp: the one on the PATH, else a copy downloaded once into
// ~/.cache/kinetic-lyrics/.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { transcribeRemote } from "./stt.mjs";

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
  const dir = path.join(os.homedir(), ".cache", "kinetic-lyrics");
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

// ---------------------------------------------------------------- fetch
async function fetchEpisode(url, dir) {
  if (!url || !dir) fail("episode.mjs fetch <url> <dir>");
  fs.mkdirSync(dir, { recursive: true });
  log("episode: reading the video's facts …");
  const info = JSON.parse(download(["-J", "--skip-download", "--no-playlist", url]));
  const track = captionTrack(info);
  const lang = (info.language || track || "").split("-")[0] || null;
  let words, source;
  if (process.env.OPENROUTER_API_KEY) {
    log(`episode: the sound of “${info.title}” (${mmss(info.duration || 0)}) …`);
    try {
      download(["-f", "bestaudio[ext=m4a]/bestaudio", "--no-playlist", "-o", path.join(dir, "audio.%(ext)s"), url]);
    } catch (e) {
      // the captions still give every word and its time; the speakers come with each cut clip
      log(`episode: YouTube gave no sound (${String(e.stderr || e.message).trim().split("\n").pop()}), the captions instead …`);
    }
    const audio = fs.readdirSync(dir).find((f) => /^audio\./.test(f) && !f.endsWith(".part"));
    if (audio) {
      log("episode: writing down every word and who speaks it, a few minutes …");
      words = await transcribeRemote(path.join(dir, audio), { lang: lang || "auto", speakers: true, log });
      source = "openrouter";
    }
  } else {
    log("episode: no OPENROUTER_API_KEY, the captions on YouTube (no speakers) …");
  }
  if (!words) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "episode-"));
    if (!track) fail("No sound from YouTube and no captions: nothing to write the words down from. Try again in a while.");
    // one track only: YouTube answers a second one with 429 now and then
    download(["--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", track, "--sub-format", "json3", "--no-playlist", "-o", path.join(tmp, "subs"), url]);
    const file = fs.readdirSync(tmp).find((f) => f.endsWith(".json3"));
    if (!file) fail("No sound from YouTube and no captions: nothing to write the words down from. Try again in a while.");
    words = captionWords(path.join(tmp, file));
    source = "captions";
  }
  if (!words.length) fail("No words found: is there speech in it?");
  const sentences = sentencesOf(words);
  const episode = {
    url: info.webpage_url || url, id: info.id, title: info.title, channel: info.channel || info.uploader,
    duration: info.duration, lang, words: words.length, speakers: [...new Set(words.map((w) => w.speaker).filter(Boolean))], source,
  };
  fs.writeFileSync(path.join(dir, "episode.json"), JSON.stringify(episode, null, 1));
  fs.writeFileSync(path.join(dir, "words.json"), JSON.stringify(words));
  fs.writeFileSync(path.join(dir, "sentences.json"), JSON.stringify(sentences));
  fs.writeFileSync(path.join(dir, "sentences.txt"), sentences.map((s, k) =>
    `${k} [${mmss(s.start)}–${mmss(s.end)}]${s.speaker ? " " + s.speaker + ":" : ""} ${s.text}`).join("\n") + "\n");
  console.log(`${episode.title} (${mmss(episode.duration || 0)}): ${words.length} words, ${sentences.length} sentences`
    + (episode.speakers.length ? `, voices ${episode.speakers.join(" ")}` : "") + `. Read ${path.join(dir, "sentences.txt")} and pick the moments; `
    + `episode.mjs cut ${dir} <first>-<last> <clip.mp4> cuts one.`);
}

// ---------------------------------------------------------------- cut
function cut(dir, a, b, c) {
  if (!dir || !a || !b) fail("episode.mjs cut <dir> <first>-<last> <clip.mp4>  or  cut <dir> <from> <to> <clip.mp4>");
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
  log(`episode: cutting ${mmss(from)}–${mmss(to)} (${(to - from).toFixed(1)} s) …`);
  // up to 4K: the short shows a third of the wide shot's width, cut closer still in a wide shot
  // (tools/frame.mjs); from 1080p that third is 608 pixels wide and comes out soft
  download(["-f", "bv*[height<=2160]+ba[ext=m4a]/bv*[height<=2160]+ba/b[height<=2160]/b",
    "--download-sections", `*${from.toFixed(2)}-${to.toFixed(2)}`, "--force-keyframes-at-cuts",
    "--merge-output-format", "mp4", "--no-playlist", "-o", `${base}.%(ext)s`, episode.url]);
  if (!fs.existsSync(`${base}.mp4`)) fail("The cut did not come out, see above.");
  fs.writeFileSync(`${base}.json`, JSON.stringify({ url: episode.url, from: +from.toFixed(2), to: +to.toFixed(2) }));
  console.log(`${base}.mp4: ${(to - from).toFixed(1)} s from ${mmss(from)}. Next: short.mjs new <short> ${base}.mp4`);
}

const [command, ...args] = process.argv.slice(2);
if (command === "fetch") await fetchEpisode(...args);
else if (command === "cut") cut(...args);
else fail("episode.mjs fetch <url> <dir> | cut <dir> <first>-<last> <clip.mp4>");
