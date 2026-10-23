// OpenRouter, wherever this machine reaches it: with OPENROUTER_API_KEY, else through the
// Sprites gateway's openrouter connection (an rragent agent on a Sprite has no key of its own:
// the gateway at http://sprite.internal adds it), else not at all.
//
//   route()                     → { base, headers, via } or null
//   chat(model, messages, opts) → { text, cost }       (chat completions)
//   transcribe(file, opts)      → { words, cost }      (ElevenLabs Scribe v2, word timings)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const GATEWAY = process.env.SPRITE_GATEWAY_URL || "http://sprite.internal";
let found;

export async function route() {
  if (found !== undefined) return found;
  if (process.env.OPENROUTER_API_KEY) {
    found = { base: (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, ""),
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }, via: "OPENROUTER_API_KEY" };
    return found;
  }
  try {
    const res = await fetch(`${GATEWAY}/v1/gateway/list`, { signal: AbortSignal.timeout(5000) });
    const list = await res.json();
    const c = (list.connections || []).find((x) => x.provider === "openrouter");
    if (c) {
      const base = (c.gateway_base_url || `${GATEWAY}/v1/gateway/openrouter/${c.id}`).replace(/\/$/, "");
      found = { base: base.endsWith("/v1") ? base : `${base}/v1`, headers: {}, via: "the Sprites gateway" };
      return found;
    }
  } catch {}
  found = null;
  return found;
}

export async function need(what) {
  const r = await route();
  if (!r) throw new Error(`${what} needs OpenRouter: set OPENROUTER_API_KEY, or connect OpenRouter in the Sprites gateway`);
  return r;
}

// Asked again after 5, 10 and 20 s on a network error, a rate limit or a server's error: the
// Sprites gateway now and then drops out for some 20 s (seen 2026-10-23: 502s and refused
// connections), and three tries in a row would all fall into it.
async function post(what, endpoint, body, { timeout = 300e3, log = () => {} } = {}) {
  const r = await need(what);
  const tries = 4;
  for (let attempt = 1; ; attempt++) {
    let res, text, why;
    try {
      res = await fetch(`${r.base}${endpoint}`, {
        method: "POST",
        headers: { ...r.headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
      text = await res.text();
      if (res.ok) return JSON.parse(text);
      if (!(res.status === 429 || res.status >= 500)) throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
      why = `OpenRouter ${res.status}`;
    } catch (e) {
      if (res && !(res.status === 429 || res.status >= 500)) throw e;
      why = e.message;
    }
    if (attempt >= tries) throw new Error(`${what}: ${why} (asked ${tries} times)`);
    const wait = 5 * 2 ** (attempt - 1);
    log(`  ${what}: ${why}, again in ${wait} s …`);
    await new Promise((ok) => setTimeout(ok, wait * 1000));
  }
}

// messages as OpenRouter takes them; `json` asks for a JSON object back
export async function chat(model, messages, { json = false, maxTokens = 4000, log } = {}) {
  const j = await post(model, "/chat/completions", {
    model, messages, max_tokens: maxTokens, temperature: 0,
    ...(json ? { response_format: { type: "json_object" } } : {}),
  }, { log });
  return { text: j.choices?.[0]?.message?.content ?? "", cost: j.usage?.cost ?? 0 };
}

export const SCRIBE_MODEL = "elevenlabs/scribe-v2";
const CH = 600, OV = 10; // 10-minute pieces, 10 s overlap so that no word is cut in half

// hesitation sounds in the languages people record in most
const FILLER = /^(ä+h+m*|ö+h*m+|e+h+m*|a+h+m+|u+h+m*|u+m+|e+r+m+|h+m+|m+h*m+|mhm)$/i;
export const kindOf = (text) => (FILLER.test(String(text).replace(/[^\p{L}]/gu, "")) ? "filler" : "word");

// The words of an audio file with their times: Scribe, word for word as spoken, "äh" included,
// noises as events. [{ text, start, end, kind: "word" | "filler" | "event" }]
export async function transcribe(file, duration, { log = () => {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "screencast-stt-"));
  const starts = Array.from({ length: Math.ceil(duration / CH) }, (_, k) => k * CH);
  let cost = 0;
  try {
    const pieces = await Promise.all(starts.map(async (at, k) => {
      // MP3 at 48 kbit/s, as rragent sends it: a gateway refuses a request of several megabytes
      const chunk = path.join(tmp, `c${k}.mp3`);
      await promisify(execFile)("ffmpeg", ["-v", "error", "-y", "-ss", String(at), "-t", String(CH + OV), "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-codec:a", "libmp3lame", "-b:a", "48k", chunk]);
      const j = await post("transcription", "/audio/transcriptions", {
        model: SCRIBE_MODEL, input_audio: { data: fs.readFileSync(chunk).toString("base64"), format: "mp3" },
        response_format: "verbose_json", timestamp_granularities: ["word"],
      }, { log });
      cost += j.usage?.cost ?? 0;
      const lo = k ? OV / 2 : -1, hi = CH + OV / 2;
      return (j.words || []).flatMap((w) => {
        const t = String(w.word ?? "").trim();
        if (!t || !(w.start >= lo && w.start < hi)) return [];
        const kind = w.type === "audio_event" || /^\[.*\]$/.test(t) ? "event" : kindOf(t);
        return [{ text: t, start: +(w.start + at).toFixed(3), end: +(Math.max(w.end, w.start + 0.04) + at).toFixed(3), kind }];
      });
    }));
    return { words: pieces.flat(), cost };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
