// Speech to word timings and speakers through OpenRouter (Gemini 3.5 Transcribe): nothing to
// install but ffmpeg, and OpenRouter (OPENROUTER_API_KEY, or the Sprites gateway's OpenRouter
// connection, see openrouter.mjs). A long recording goes in 5-minute
// pieces, all at once: an hour or two take about as long as the slowest piece, under a minute.
//
//   transcribeRemote(file, { lang, speakers }) → [{ text, start, end, speaker }]
//
// The model gives times in tenths of a second; build.mjs snaps every word onset to the voice
// in the audio (tools/align.mjs), as it does for Parakeet. Speakers are A, B, … in the order
// they first speak. The model names them per piece; the pieces overlap by 20 seconds, and a
// voice heard in the overlap keeps its letter in the next piece, as does a single one left
// over when a single known voice is missing. A voice that is new to the recording, or one of
// several silent in the overlap, may get a letter of its own.

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { duration } from "./asr.mjs";
import { need } from "./openrouter.mjs";

export const STT_MODEL = "google/gemini-3.5-transcribe";
// every piece of a recording up to five hours at once: the slowest piece is the wait
const CH = 300, OV = 20, AT_ONCE = 64;
// a piece answers in well under a minute; one that has not after five is asked again (and may
// be paid twice, a cent or two)
const WAIT = 5 * 60e3;
// ffmpeg in the background, so that the pieces are cut side by side, not one after the other
const ffmpeg = (args) => promisify(execFile)("ffmpeg", args);

async function request(body, log) {
  const or = await need("The transcription");
  for (let attempt = 1; ; attempt++) {
    let res, text;
    try {
      res = await fetch(`${or.base}/audio/transcriptions`, {
        method: "POST",
        headers: { ...or.headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(WAIT),
      });
      text = await res.text();
    } catch (e) {
      if (attempt >= 3) throw e;
      log(`  transcribe: ${e.name === "TimeoutError" ? `no answer in ${WAIT / 60e3} min` : e.message}, again …`);
      continue;
    }
    if (res.ok) return JSON.parse(text);
    if (attempt < 3 && (res.status === 429 || res.status >= 500)) {
      log(`  transcribe: OpenRouter ${res.status}, again in ${attempt * 5} s …`);
      await new Promise((r) => setTimeout(r, attempt * 5000));
      continue;
    }
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
  }
}

// fn over the items, n at a time, the results in order
async function inTurns(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const k = next++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

const plain = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

// the model's speakers of every piece as voices across the recording: a speaker of piece k is
// the voice of piece k-1 that says the same words at the same time in their overlap
function voicesOf(pieces) {
  const voice = new Map();
  let voices = 0;
  pieces.forEach((words, k) => {
    const at = k * CH, prev = k ? pieces[k - 1] : [];
    const pairs = new Map();
    for (const w of words) {
      if (w.speaker == null || w.start >= at + OV) continue;
      const p = prev.find((q) => q.speaker != null && Math.abs(q.start - w.start) < 0.6 && plain(q.text) === plain(w.text));
      if (p) { const key = `${p.speaker}\n${w.speaker}`; pairs.set(key, (pairs.get(key) || 0) + 1); }
    }
    const linked = new Map(), taken = new Set();
    for (const [key] of [...pairs].sort((a, b) => b[1] - a[1])) {
      const [a, b] = key.split("\n"), v = voice.get(`${k - 1}:${a}`);
      if (linked.has(b) || taken.has(v)) continue;
      linked.set(b, v); taken.add(v);
    }
    // one speaker left over and one voice of the recording not heard in this piece's overlap:
    // the same (a host who was silent there, more likely than a new voice)
    const left = [...new Set(words.map((w) => w.speaker).filter((s) => s != null && !linked.has(s)))];
    const free = [...new Set(voice.values())].filter((v) => !taken.has(v));
    if (left.length === 1 && free.length === 1) linked.set(left[0], free[0]);
    for (const w of words) {
      const key = `${k}:${w.speaker}`;
      if (w.speaker != null && !voice.has(key)) voice.set(key, linked.has(w.speaker) ? linked.get(w.speaker) : voices++);
    }
  });
  return (k, speaker) => voice.get(`${k}:${speaker}`);
}

export async function transcribeRemote(file, { lang = "auto", speakers = true, log = () => {} } = {}) {
  const or = await need("The transcription");
  const total = duration(file);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kinetic-stt-"));
  let cost = 0, done = 0;
  const starts = Array.from({ length: Math.ceil(total / CH) }, (_, k) => k * CH);
  if (starts.length > 1) log(`  transcribe: ${starts.length} pieces of ${CH / 60} min, ${Math.min(AT_ONCE, starts.length)} at a time …`);
  let pieces;
  try {
    pieces = await inTurns(starts, AT_ONCE, async (at, k) => {
      // FLAC, unless the piece would not fit OpenRouter's 50 MB request (as base64), then MP3 at
      // 48 kbit/s, which it transcribes as well; MP3 always through the Sprites gateway, which
      // refuses a request of several megabytes
      let format = "flac", chunk = path.join(tmp, `c${k}.flac`);
      if (!or.gateway) await ffmpeg(["-v", "error", "-y", "-ss", String(at), "-t", String(CH + OV), "-i", file, "-vn", "-ac", "1", "-ar", "16000", chunk]);
      if (or.gateway || (fs.statSync(chunk).size * 4) / 3 > 40e6) {
        format = "mp3"; chunk = path.join(tmp, `c${k}.mp3`);
        await ffmpeg(["-v", "error", "-y", "-ss", String(at), "-t", String(CH + OV), "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", chunk]);
      }
      const j = await request({
        model: STT_MODEL,
        input_audio: { data: fs.readFileSync(chunk).toString("base64"), format },
        ...(lang && lang !== "auto" ? { language: lang } : {}),
        response_format: "verbose_json",
        timestamp_granularities: ["word"],
        // the provider's own switch: OpenRouter passes it through to Google
        ...(speakers ? { provider: { options: { "google-ai-studio": { diarization_mode: "speaker" } } } } : {}),
      }, log);
      cost += j.usage?.cost ?? 0;
      if (starts.length > 1) log(`  transcribe: ${++done}/${starts.length}`);
      return (j.words || []).flatMap((w) => {
        const text = String(w.word ?? "").trim();
        return text ? [{ text, start: w.start + at, end: Math.max(w.end, w.start + 0.05) + at, speaker: w.speaker == null ? null : String(w.speaker) }] : [];
      });
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const voiceOf = voicesOf(pieces);
  // speakers by first appearance: A, B, …
  const letters = new Map();
  const letter = (v) => {
    if (v == null) return undefined;
    if (!letters.has(v)) letters.set(v, String.fromCharCode(65 + letters.size));
    return letters.get(v);
  };
  // where one piece hands over to the next: the longest pause in their overlap, as the earlier
  // piece heard it. Both pieces time a word on their own, a tenth of a second apart; cut at a
  // fixed second, a word near it would be kept twice or by neither.
  const cuts = pieces.map((_, k) => {
    if (!k) return -1;
    const at = k * CH, heard = pieces[k - 1].filter((w) => w.start >= at && w.start < at + OV).sort((a, b) => a.start - b.start);
    let cut = at + OV / 2, gap = 0;
    for (let i = 1; i < heard.length; i++) {
      const g = heard[i].start - heard[i - 1].end;
      if (g > gap) { gap = g; cut = (heard[i - 1].end + heard[i].start) / 2; }
    }
    return cut;
  });
  const all = [];
  pieces.forEach((words, k) => {
    // keep each word once: a piece owns the time from its cut to the next one's
    const lo = cuts[k], hi = k + 1 < pieces.length ? cuts[k + 1] : Infinity;
    for (const w of words) {
      if (!(w.start >= lo && w.start < hi)) continue;
      const sp = letter(voiceOf(k, w.speaker));
      all.push({ text: w.text, start: +w.start.toFixed(3), end: +w.end.toFixed(3), ...(sp ? { speaker: sp } : {}) });
    }
  });
  log(`  transcribe: ${all.length} words, $${cost.toFixed(4)}`);
  return all;
}
