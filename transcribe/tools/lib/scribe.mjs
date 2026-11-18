// Speech to word timings with ElevenLabs Scribe v2 through OpenRouter (OPENROUTER_API_KEY, or the
// Sprites gateway's OpenRouter connection, see openrouter.mjs): word for word as spoken, "äh" and
// "ähm" included, noises as events ("[Kamera klackert]"), names spelled right; 20 ms timings with
// the real pauses between words. $0.0367 per ten minutes, 22 cents an hour (OpenRouter's `cost`
// on 2026-11-18, the same with the voices). Every request asks for the voices
// too (`diarize`, the same price): a word then carries the voice it was heard in, a number that
// holds within that one request; lib/voices.mjs makes the speakers of them.
//
//   scribe(file, duration, { lang, log, long }) → { words: [{ text, start, end, kind: "word" | "filler" | "event" }], cost, parts }   (seconds)
//       parts: per piece { start, own, words }: the second its own words begin at, the words it
//       owns and all it heard, each with its `voice` when the model named one
//   cut(duration, len, before)   → { CH, starts, owns }: how a recording is cut into pieces
//   plan(duration, long)         → the same for this machine's way to OpenRouter, with `fmt` and `before`

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { need } from "./openrouter.mjs";

export const SCRIBE_MODEL = "elevenlabs/scribe-v2";
// 10-minute pieces as FLAC, 10 s overlap so that no word is cut in half; through the gateway
// 5-minute pieces as MP3 at 48 kbit/s, as rragent sends them: the gateway refuses a request of
// several megabytes
const OV = 10;
// The long way, for the voices: a request keeps its voices apart by itself, so pieces of three
// quarters of an hour, MP3 at 48 kbit/s (16 MB, 22 MB as base64: more than the 7 MB
// openrouter.mjs measured for the gateway on 2026-10-23; on 2026-11-18 the Sprites gateway
// answered bodies of 12 to 21.7 MB in 25 to 64 s, and on 2026-11-16 it ended a request of 127
// minutes after about 130 s). A piece
// after the first begins five minutes before what it owns: by the words both pieces wrote there
// their voices are told to be the same people.
export const LONG = 2700, BEFORE = 300;
// a last piece that would own less than this is none: the others are that much longer. A short
// piece often holds one voice only, and with one voice the fingerprints decide least surely
export const TAIL = 120;
// the last piece is cut this much longer than the file's header says it lasts (ffmpeg stops where
// the sound does): a header can state less than there is, and main heard up to a piece past it
export const PAST = 300;

// hesitation sounds in the languages people record in most
const FILLER = /^(ä+h+m*|ö+h*m+|e+h+m*|a+h+m+|u+h+m*|u+m+|e+r+m+|h+m+|m+h*m+|mhm)$/i;
const kindOf = (text) => (FILLER.test(text.replace(/[^\p{L}]/gu, "")) ? "filler" : "word");

// How a recording of `duration` seconds is cut: pieces of `len` seconds, each heard OV seconds
// longer, one after the first from `before` seconds earlier than what it owns. Every word once:
// piece k owns from the middle of the OV it shares with the piece before to the middle of the
// one it shares with the next. → { CH: the pieces' length, starts: where each is heard from,
// owns: [[from, to), …] in seconds of the recording }
export function cut(duration, len, before = 0) {
  let n = Math.max(1, Math.ceil((duration - before) / (len - before))), CH = len;
  if (n > 1 && duration - ((n - 1) * (len - before) + before) < TAIL) { n--; CH = Math.ceil((duration + (n - 1) * before) / n); }
  const starts = Array.from({ length: n }, (_, k) => k * (CH - before));
  return { CH, starts, owns: starts.map((at, k) => [k ? at + before + OV / 2 : -1, k + 1 < n ? at + CH + OV / 2 : Infinity]) };
}

// The pieces for this machine: ten minutes as FLAC, five as MP3 through the gateway; `long`,
// three quarters of an hour as MP3 either way (as FLAC one would not fit OpenRouter's request).
export async function plan(duration, long = false) {
  const or = await need("The transcription");
  const before = long ? BEFORE : 0;
  return { ...cut(duration, long ? LONG : or.gateway ? 300 : 600, before), before, fmt: long || or.gateway ? "mp3" : "flac" };
}

// fn over the items, at most n at once, the results in the items' order. When one fails, the
// others are called off (`stop`, an AbortSignal that fn hands to what it waits for), none is
// begun after it, and the first failure is thrown once all have ended
async function pool(items, n, fn) {
  const out = new Array(items.length), stop = new AbortController();
  let next = 0, failed = null;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length && !failed) {
      const k = next++;
      try { out[k] = await fn(items[k], k, stop.signal); } catch (e) { if (!failed) { failed = e; stop.abort(e); } }
    }
  }));
  if (failed) throw failed;
  return out;
}

export async function scribe(file, duration, { lang, log = () => {}, long = false } = {}) {
  const or = await need("The transcription");
  const { CH: len, starts, owns, before, fmt } = await plan(duration, long);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-scribe-"));
  let cost = 0;
  try {
    // three pieces at a time: each is an ffmpeg and a request body of megabytes, and a Sprite
    // has little memory
    const pieces = await pool(starts, 3, async (at, k, stop) => {
      // the last piece is heard to the real end of the file: a header may state less than there is
      const CH = k + 1 < starts.length ? len : len + PAST;
      const chunk = path.join(tmp, `c${k}.${fmt}`);
      await promisify(execFile)("ffmpeg", ["-v", "error", "-y", "-ss", String(at), "-t", String(CH + OV), "-i", file, "-vn", "-ac", "1", "-ar", "16000",
        ...(fmt === "mp3" ? ["-codec:a", "libmp3lame", "-b:a", "48k"] : []), chunk]);
      const body = JSON.stringify({
        model: SCRIBE_MODEL, input_audio: { data: fs.readFileSync(chunk).toString("base64"), format: fmt },
        ...(lang && lang !== "auto" ? { language: lang } : {}),
        response_format: "verbose_json", timestamp_granularities: ["word"],
        // the voice of every word: `speaker`, 0, 1, … within this request
        diarize: true,
      });
      for (let attempt = 1; ; attempt++) {
        let res, text;
        try {
          res = await fetch(`${or.base}/audio/transcriptions`, {
            method: "POST",
            headers: { ...or.headers, "Content-Type": "application/json" },
            body,
            signal: AbortSignal.any([stop, AbortSignal.timeout(300e3)]),
          });
          text = await res.text();
        } catch (e) {
          if (stop.aborted) throw stop.reason;
          if (attempt >= 3) throw e;
          log(`  transcribe: ${e.message}, again …`);
          continue;
        }
        if (res.ok) {
          const j = JSON.parse(text);
          cost += j.usage?.cost ?? 0;
          return (j.words || []).flatMap((w) => {
            const t = String(w.word ?? "").trim();
            if (!t || !(w.start >= 0)) return [];
            const kind = w.type === "audio_event" || /^\[.*\]$/.test(t) ? "event" : kindOf(t);
            const voice = w.speaker ?? w.speaker_label;
            return [{ text: t, start: +(w.start + at).toFixed(3), end: +(Math.max(w.end, w.start + 0.04) + at).toFixed(3), kind, ...(voice == null ? {} : { voice: String(voice) }) }];
          });
        }
        if (attempt >= 3 || !(res.status === 429 || res.status >= 500)) throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
        log(`  transcribe: OpenRouter ${res.status}, again in ${attempt * 5} s …`);
        await sleep(attempt * 5000, undefined, { signal: stop }).catch(() => { throw stop.reason; });
      }
    }).catch((e) => {
      // what the pieces answered before is paid, and the caller counts it (a piece called off
      // may be paid too, which no answer tells)
      throw Object.assign(e instanceof Error ? e : new Error(String(e)), { cost });
    });
    log(`  transcribed with ${SCRIBE_MODEL}, $${cost.toFixed(4)}`);
    // each word once, by the piece that owns its start
    const parts = pieces.map((words, k) => ({ start: k ? starts[k] + before : 0, own: words.filter((w) => w.start >= owns[k][0] && w.start < owns[k][1]), words }));
    return { words: parts.flatMap((p) => p.own.map(({ voice, ...w }) => w)), cost, parts };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
