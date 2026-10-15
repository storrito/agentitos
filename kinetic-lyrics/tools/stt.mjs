// Speech to word timings and speakers through OpenRouter (Gemini 3.5 Transcribe): nothing to
// install but ffmpeg, OPENROUTER_API_KEY in the environment. In 20-minute chunks (with
// speakers, the model takes at most 30 minutes at a time).
//
//   transcribeRemote(file, { lang, speakers }) → [{ text, start, end, speaker }]
//
// The model gives times in tenths of a second; build.mjs snaps every word onset to the voice
// in the audio (tools/align.mjs), as it does for Parakeet. Speakers are A, B, … in the order
// they first speak. Over more than one chunk they are labelled per chunk: the same voice may
// get another letter after 20 minutes.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { duration } from "./asr.mjs";

export const STT_MODEL = "google/gemini-3.5-transcribe";
const URL = "https://openrouter.ai/api/v1/audio/transcriptions";
const CH = 1200, OV = 10;

async function request(body, log) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (res.ok) return JSON.parse(text);
    if (attempt < 3 && (res.status === 429 || res.status >= 500)) {
      log(`  transcribe: OpenRouter ${res.status}, again in ${attempt * 5} s …`);
      await new Promise((r) => setTimeout(r, attempt * 5000));
      continue;
    }
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
  }
}

export async function transcribeRemote(file, { lang = "auto", speakers = true, log = () => {} } = {}) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");
  const total = duration(file);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kinetic-stt-"));
  const all = [];
  let cost = 0;
  try {
    for (let k = 0; k * CH < total; k++) {
      // FLAC, unless the piece would not fit OpenRouter's 50 MB request (as base64): 20 minutes
      // of FLAC are some 56 MB, then MP3 at 48 kbit/s (7 MB), which it transcribes as well
      let format = "flac", chunk = path.join(tmp, `c${k}.flac`);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(k * CH), "-t", String(CH + OV), "-i", file, "-vn", "-ac", "1", "-ar", "16000", chunk]);
      if ((fs.statSync(chunk).size * 4) / 3 > 40e6) {
        format = "mp3"; chunk = path.join(tmp, `c${k}.mp3`);
        execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(k * CH), "-t", String(CH + OV), "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", chunk]);
      }
      if (total > CH) log(`  transcribe: ${Math.round((k * CH) / 60)}–${Math.round(Math.min(total, (k + 1) * CH) / 60)} min …`);
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
      // speakers by first appearance in the chunk: A, B, …
      const letters = new Map();
      const letter = (s) => {
        if (s == null) return undefined;
        if (!letters.has(s)) letters.set(s, String.fromCharCode(65 + letters.size));
        return letters.get(s);
      };
      // keep each word once: a chunk owns [k*CH + OV/2, (k+1)*CH + OV/2)
      const lo = k ? OV / 2 : -1, hi = CH + OV / 2;
      for (const w of j.words || []) {
        const text = String(w.word ?? "").trim();
        if (!text || !(w.start >= lo && w.start < hi)) continue;
        const sp = letter(w.speaker);
        all.push({ text, start: +(w.start + k * CH).toFixed(3), end: +(Math.max(w.end, w.start + 0.05) + k * CH).toFixed(3), ...(sp ? { speaker: sp } : {}) });
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  log(`  transcribe: ${all.length} words, $${cost.toFixed(4)}`);
  return all;
}
