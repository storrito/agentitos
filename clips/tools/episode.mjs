#!/usr/bin/env node
// A long video (a YouTube episode, a talk) as the source of several shorts.
//
//   node tools/episode.mjs fetch <url|file> <dir>
//        the episode's facts, its sound, and every word with its time and who speaks it:
//        <dir>/episode.json, <dir>/words.json, <dir>/sentences.json and <dir>/sentences.txt,
//        one numbered sentence a line, `12 [66:44–66:51] A: …`, to read and pick from
//   node tools/episode.mjs moments <dir> [--count N] [--max-seconds N]
//        the candidates for shorts, picked by Gemini through OpenRouter from sentences.txt (five to
//        nine cents an hour), in the order of the episode, each a whole passage: <dir>/moments.json and a short list
//        to read. --max-seconds is how long a short may be (59: it fits every post type); a passage
//        that is longer is returned whole, with the sentences that can go marked (`drop`)
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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { transcribeFile, transcribeTool, NEEDS_TRANSCRIBE } from "./lib/transcribe.mjs";
import { duration } from "./lib/media.mjs";
import { openrouter, keyRejected, rejectedIn, REJECTED } from "./lib/openrouter.mjs";
import { KINDS, MAX_SECONDS, arrange, momentsPrompt, listing } from "./lib/moments.mjs";

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

// ---------------------------------------------------------------- fetch
// what fetch says when the words are YouTube's captions although OpenRouter is there
const CAPTIONS_INSTEAD = (why) => `These are YouTube's captions, without voices, because ${/^YouTube/.test(why) ? why : `the transcription failed (${String(why).slice(0, 200)})`}: `
  + `run fetch again for the voices (the framing and an exchange between two people need them). `;

// a path that exists, not a link
const isFile = (source) => !/^https?:\/\//i.test(source) && fs.existsSync(source);

function writeEpisode(dir, facts, heard, note = "") {
  // what was said: the transcription writes the noises it hears among the words ("[laughs]", kind: "event")
  const words = heard.filter((w) => w.kind !== "event");
  if (!words.length) fail("No words found: is there speech in it?");
  const sentences = sentencesOf(words);
  const episode = { ...facts, words: words.length, speakers: [...new Set(words.map((w) => w.speaker).filter(Boolean))] };
  fs.writeFileSync(path.join(dir, "episode.json"), JSON.stringify(episode, null, 1));
  fs.writeFileSync(path.join(dir, "words.json"), JSON.stringify(words));
  fs.writeFileSync(path.join(dir, "sentences.json"), JSON.stringify(sentences));
  fs.writeFileSync(path.join(dir, "sentences.txt"), sentences.map((s, k) =>
    `${k} [${mmss(s.start)}–${mmss(s.end)}]${s.speaker ? " " + s.speaker + ":" : ""} ${s.text}`).join("\n") + "\n");
  console.log(`${episode.title} (${mmss(episode.duration || 0)}): ${words.length} words, ${sentences.length} sentences`
    + (episode.speakers.length ? `, voices ${episode.speakers.join(" ")}` : "") + `. ${note}episode.mjs moments ${dir} picks the moments; `
    + `episode.mjs cut ${dir} <first>-<last> <clip.mp4> cuts one.`);
}

// the person's own file: no captions to fall back on, so the words need the key
async function fetchFile(file, dir) {
  if (!transcribeTool()) fail(NEEDS_TRANSCRIBE);
  const or = await openrouter();
  if (!or) fail("No OpenRouter (OPENROUTER_API_KEY, or on a Sprite the gateway's OpenRouter connection): a file has no captions to take the words from.");
  const turnedAway = await keyRejected(or);
  if (turnedAway) fail(REJECTED(turnedAway));
  const title = path.basename(file).replace(/\.[^.]+$/, "");
  const length = duration(file);
  log(`episode: writing down every word of “${title}” (${mmss(length)}) and who speaks it, a few minutes …`);
  let words;
  try { ({ words } = await transcribeFile(file, { speakers: true, log })); } catch (e) { fail(e.message); }
  writeEpisode(dir, { file, url: null, id: null, title, channel: null, duration: length, lang: null, source: "openrouter" }, words);
}

async function fetchEpisode(url, dir) {
  if (!url || !dir) fail("episode.mjs fetch <url|file> <dir>");
  fs.mkdirSync(dir, { recursive: true });
  if (isFile(url)) return fetchFile(path.resolve(url), dir);
  log("episode: reading the video's facts …");
  const info = JSON.parse(download(["-J", "--skip-download", "--no-playlist", url]));
  const track = captionTrack(info);
  const lang = (info.language || track || "").split("-")[0] || null;
  let words, source, note = "";
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
      download(["-f", "bestaudio[ext=m4a]/bestaudio", "--no-playlist", "-o", path.join(dir, "audio.%(ext)s"), url]);
      audio = fs.readdirSync(dir).find((f) => /^audio\./.test(f) && !f.endsWith(".part"));
    } catch (e) {
      // the captions still give every word and its time; the speakers come with each cut clip
      log(`episode: YouTube gave no sound (${String(e.stderr || e.message).trim().split("\n").pop()}), the captions instead …`);
    }
    if (audio) {
      log("episode: writing down every word and who speaks it, a few minutes …");
      try {
        ({ words } = await transcribeFile(path.join(dir, audio), { lang: lang || "auto", speakers: true, log }));
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
    download(["--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", track, "--sub-format", "json3", "--no-playlist", "-o", path.join(tmp, "subs"), url]);
    const file = fs.readdirSync(tmp).find((f) => f.endsWith(".json3"));
    if (!file) fail("No sound from YouTube and no captions: nothing to write the words down from. Try again in a while.");
    words = captionWords(path.join(tmp, file));
    source = "captions";
  }
  // the description as the channel's audience sees it: moments counts the names in it as introduced
  writeEpisode(dir, {
    url: info.webpage_url || url, id: info.id, title: info.title, channel: info.channel || info.uploader,
    duration: info.duration, lang, source, description: String(info.description || "").slice(0, 1500),
  }, words, note);
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
  // yt-dlp leaves a file that exists alone: a cut onto a name used before is cut again
  for (const f of fs.readdirSync(path.dirname(path.resolve(out)))) {
    if (f.startsWith(path.basename(base) + ".")) fs.rmSync(path.join(path.dirname(path.resolve(out)), f), { force: true });
  }
  log(`episode: cutting ${mmss(from)}–${mmss(to)} (${(to - from).toFixed(1)} s) …`);
  if (episode.file) {
    // from the person's file, up to 4K like a download; cut anew, not copied, so it starts on the word
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", from.toFixed(2), "-i", episode.file, "-t", (to - from).toFixed(2),
      "-map", "0:v:0", "-map", "0:a:0?", "-vf", "scale=-2:'min(2160,ih)'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16",
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", `${base}.mp4`], { stdio: ["ignore", "inherit", "inherit"] });
    fs.writeFileSync(`${base}.json`, JSON.stringify({ file: episode.file, from: +from.toFixed(2), to: +to.toFixed(2) }));
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

// one call to the model with a JSON schema, tried three times; → { answer, cost } or a throw
async function ask(or, prompt, name, schema, timeout = 300e3) {
  let j;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${or.base}/chat/completions`, {
        method: "POST",
        headers: { ...or.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MOMENTS_MODEL, messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_schema", json_schema: { name, strict: true, schema } } }),
        signal: AbortSignal.timeout(timeout),
      });
      j = await res.json();
      if (res.ok && j.choices) return { answer: JSON.parse(String(j.choices[0].message.content).replace(/^```(json)?\s*|\s*```$/g, "")), cost: j.usage?.cost ?? 0 };
      throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
    } catch (e) {
      if (rejectedIn(e.message)) fail(REJECTED(`${rejectedIn(e.message)}${j?.error?.message ? " " + j.error.message : ""}`));
      if (attempt >= 3) throw e;
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
  const over = j.moments.filter((m) => m.checks.over).length;
  console.log(`${j.moments.length} moments in ${path.join(dir, "moments.json")}${episode.id ? " (with their YouTube links)" : ""}, $${cost.toFixed(4)}. `
    + (over ? `${over} are whole passages longer than ${j.limit} s: where the platforms allow it, run moments again with a higher --max-seconds; else leave their marked sentences out (clips.mjs prepare … --drop <sentences>). ` : "")
    + `A moment's words: sed -n '<first+1>,<last+1>p' ${path.join(dir, "sentences.txt")}. Cut one: episode.mjs cut ${dir} <first>-<last> <clip.mp4>.`);
}

async function moments(dir, ...rest) {
  if (!dir) fail(USAGE);
  const given = momentsOptions(rest);
  const or = await openrouter();
  if (!or) fail("No OpenRouter (OPENROUTER_API_KEY, or on a Sprite the gateway's OpenRouter connection): read sentences.txt yourself and pick the moments.");
  const episode = JSON.parse(fs.readFileSync(path.join(dir, "episode.json"), "utf8"));
  const sentences = JSON.parse(fs.readFileSync(path.join(dir, "sentences.json"), "utf8"));
  const text = fs.readFileSync(path.join(dir, "sentences.txt"), "utf8");
  const count = given.count ?? Math.max(3, Math.min(10, Math.round((episode.duration || 600) / 540)));
  const limit = given.limit ?? MAX_SECONDS;
  log(`episode: picking moments (${MOMENTS_MODEL}) …`);
  let r;
  try { r = await ask(or, momentsPrompt(episode, text, count, limit), "moments", MOMENTS_SCHEMA); } catch (e) { fail(`Picking the moments failed (${e.message}): read sentences.txt yourself.`); }
  const { answer } = r;
  const picked = withLinks(arrange(answer, sentences, { limit }), sentences, episode);
  const ideas = (answer.ideas || []).map((d) => ({ ...d, sentences: (d.sentences || []).filter((k) => sentences[k]),
    at: (d.sentences || []).filter((k) => sentences[k]).map((k) => mmss(sentences[k].start)) }));
  const j = { limit, count, inventory: answer.inventory || {}, moments: picked, ideas };
  fs.writeFileSync(path.join(dir, "moments.json"), JSON.stringify(j, null, 1));
  report(dir, episode, sentences, j, r.cost);
}

const [command, ...args] = process.argv.slice(2);
if (command === "fetch") await fetchEpisode(...args);
else if (command === "cut") cut(...args);
else if (command === "moments") await moments(...args);
else fail("episode.mjs fetch <url|file> <dir> | moments <dir> [--count N] [--max-seconds N] | cut <dir> <first>-<last> <clip.mp4>");
