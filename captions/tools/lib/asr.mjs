// Speech to word timings with ElevenLabs Scribe v2 through OpenRouter (OPENROUTER_API_KEY): word
// for word as spoken, "äh" and "ähm" included, noises as events ("[Kamera klackert]"), names
// spelled right; 20 ms timings with the real pauses between words. About half a cent a minute.
//
//   scribe(file, duration) → [{ text, start, end, kind: "word" | "filler" | "event" }]   (seconds)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const SCRIBE_MODEL = "elevenlabs/scribe-v2";
const CH = 600, OV = 10; // 10-minute pieces, 10 s overlap so that no word is cut in half

// hesitation sounds in the languages people record in most
const FILLER = /^(ä+h+m*|ö+h*m+|e+h+m*|a+h+m+|u+h+m*|u+m+|e+r+m+|h+m+|m+h*m+|mhm)$/i;
const kindOf = (text) => (FILLER.test(text.replace(/[^\p{L}]/gu, "")) ? "filler" : "word");

// the words of piece k, each once: a piece owns [k*CH + OV/2, (k+1)*CH + OV/2)
const own = (k) => [k ? OV / 2 : -1, CH + OV / 2];

export async function scribe(file, duration, { log = () => {} } = {}) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "captions-stt-"));
  const starts = Array.from({ length: Math.ceil(duration / CH) }, (_, k) => k * CH);
  let cost = 0;
  try {
    const pieces = await Promise.all(starts.map(async (at, k) => {
      const chunk = path.join(tmp, `c${k}.flac`);
      await promisify(execFile)("ffmpeg", ["-v", "error", "-y", "-ss", String(at), "-t", String(CH + OV), "-i", file, "-vn", "-ac", "1", "-ar", "16000", chunk]);
      const body = JSON.stringify({ model: SCRIBE_MODEL, input_audio: { data: fs.readFileSync(chunk).toString("base64"), format: "flac" }, response_format: "verbose_json", timestamp_granularities: ["word"] });
      for (let attempt = 1; ; attempt++) {
        let res, text;
        try {
          res = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
            body,
            signal: AbortSignal.timeout(300e3),
          });
          text = await res.text();
        } catch (e) {
          if (attempt >= 3) throw e;
          log(`  transcribe: ${e.message}, again …`);
          continue;
        }
        if (res.ok) {
          const j = JSON.parse(text);
          cost += j.usage?.cost ?? 0;
          const [lo, hi] = own(k);
          return (j.words || []).flatMap((w) => {
            const t = String(w.word ?? "").trim();
            if (!t || !(w.start >= lo && w.start < hi)) return [];
            const kind = w.type === "audio_event" || /^\[.*\]$/.test(t) ? "event" : kindOf(t);
            return [{ text: t, start: +(w.start + at).toFixed(3), end: +(Math.max(w.end, w.start + 0.04) + at).toFixed(3), kind }];
          });
        }
        if (attempt >= 3 || !(res.status === 429 || res.status >= 500)) throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
        log(`  transcribe: OpenRouter ${res.status}, again in ${attempt * 5} s …`);
        await new Promise((r) => setTimeout(r, attempt * 5000));
      }
    }));
    log(`  transcribed with ${SCRIBE_MODEL}, $${cost.toFixed(4)}`);
    return pieces.flat();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
