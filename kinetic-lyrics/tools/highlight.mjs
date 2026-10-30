// Find the best clip in a long recording and cut it out as a ready-to-build example.
//
//   node tools/highlight.mjs episode.mp3 --out examples/my-clip [--transcript episode.words.json]
//        [--min 40] [--max 75] [--hint "about the Moon"] [--llm-backend claude-code|api]
//        [--lang de]                     the language spoken (default: the model hears it)
//        [--from 1840.2] [--to 1921]   editor override: snap the clip to the sentences around
//                                       these times (seconds in the source) instead of asking Claude
//
// 1. transcript: given, cached next to the audio (<audio>.words.json), or made by agentitos'
//    transcribe skill beside this one (Gemini 3.5 Transcribe through OpenRouter, with who
//    speaks: A, B, …; tools/lib/transcribe.mjs)
// 2. Claude reads the whole transcript as numbered sentences and picks the strongest
//    self-contained moment: a hook at the start, a payoff at the end, understandable
//    without the rest of the episode
// 3. audio + word timings of that span are cut to <out>/audio.wav and <out>/transcript.json
//    (times shifted to the clip, voices named again A, B, … in the order they speak in the
//    clip), plus <out>/highlight.json with title and reasoning
//
// Then: node tools/build.mjs <out>/transcript.json --audio <out>/audio.wav --preset podcast --llm …

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { askClaude } from "./llm-annotate.mjs";
import { transcribeFile } from "./lib/transcribe.mjs";

const argv = process.argv.slice(2);
const opt = { min: 40, max: 75 };
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) {
    const k = argv[i].slice(2);
    opt[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  } else pos.push(argv[i]);
}
const audio = pos[0];
if (!audio || !opt.out) {
  console.error("usage: node tools/highlight.mjs <audio> --out <dir> [--transcript words.json] [--min 40] [--max 75] [--hint …]");
  process.exit(1);
}
const MIN = Number(opt.min), MAX = Number(opt.max);

const wordsOf = (d) => (Array.isArray(d) ? d : d.words);

// ---------------------------------------------------------------- 1. transcript
const cache = opt.transcript || audio.replace(/\.[^.]+$/, "") + ".words.json";
let words;
if (fs.existsSync(cache)) {
  words = wordsOf(JSON.parse(fs.readFileSync(cache, "utf8")));
  console.error(`highlight: transcript ${path.basename(cache)} (${words.length} words)`);
} else {
  console.error("highlight: transcribing with Gemini 3.5 Transcribe (OpenRouter) …");
  let result;
  try {
    result = await transcribeFile(audio, { speakers: true, lang: typeof opt.lang === "string" ? opt.lang : undefined, log: console.error });
  } catch (e) {
    console.error(`highlight: ${e.message}`);
    process.exit(1);
  }
  words = result.words;
  fs.writeFileSync(cache, JSON.stringify(result));
}

// ---------------------------------------------------------------- 2. pick
const sentences = [];
let cur = null;
words.forEach((w, i) => {
  if (!cur) cur = { first: i, start: w.start, text: [] };
  cur.text.push(w.text);
  if (/[.!?…]["”']?$/.test(w.text) || i === words.length - 1) {
    sentences.push({ ...cur, last: i, end: w.end, text: cur.text.join(" ") });
    cur = null;
  }
});
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const numbered = sentences.map((s, k) => `${k} [${mmss(s.start)}, ${(s.end - s.start).toFixed(1)}s] ${s.text}`).join("\n");

const Pick = z.object({
  candidates: z.array(z.object({
    first: z.number().int(),
    last: z.number().int(),
    title: z.string(),
    why: z.string(),
  })),
});

const system = `You are the clip editor of a podcast. From the full transcript below, find the moments that work best as a stand-alone highlight clip (${MIN}–${MAX} seconds) for social media and a kinetic-typography video.

A great highlight:
- is understandable without the rest of the episode: no "as I said", no unexplained "he"/"that thing", no setup that happened minutes earlier
- opens with a hook in its first sentence (a question, a surprising claim, a vivid image) – not with "and", "so", "yeah" or small talk
- builds to a payoff: a punchline, an insight, a striking number, an emotional turn – and ends right after it
- is concrete and visual (images, numbers, contrasts) rather than abstract process talk
- may contain a host question followed by the answer, if the question sets up the payoff
${opt.hint ? `- the editor asked for: ${opt.hint}\n` : ""}
Each sentence line reads: index [start mm:ss, length] text. A clip is the inclusive sentence range first..last; its length is from the start of "first" to the end of "last" and must be ${MIN}–${MAX} s. The transcript is machine-made: ignore filler words and small recognition errors.

Return up to 3 candidates, best first. title: 3–7 words, the clip's headline in the transcript's language (no clickbait). why: one sentence on what makes it work.

Transcript:
${numbered}`;

// first sentence that starts at/after t; last sentence that ends by t (±0.3 s slack)
const startAt = (t) => sentences.findIndex((s) => s.start >= Number(t) - 0.3);
const endAt = (t) => { let k = -1; sentences.forEach((s, i) => { if (s.end <= Number(t) + 0.3) k = i; }); return k; };
let candidates;
if (opt.from || opt.to) {
  const prev = fs.existsSync(path.join(opt.out, "highlight.json")) ? JSON.parse(fs.readFileSync(path.join(opt.out, "highlight.json"), "utf8")) : {};
  const first = startAt(opt.from ?? prev.from ?? 0);
  const last = endAt(opt.to ?? prev.to ?? 1e9);
  candidates = [{ first, last: last < 0 ? sentences.length - 1 : last, title: prev.title || "", why: prev.why || "editor's cut" }];
} else {
  console.error(`highlight: Claude reads ${sentences.length} sentences (${mmss(words[words.length - 1].end)}) …`);
  ({ candidates } = await askClaude(system, "Pick the highlights. Reply with the JSON only.", Pick, opt["llm-backend"] || "claude-code"));
}
const lengthOf = (c) => sentences[c.last].end - sentences[c.first].start;
const valid = candidates.filter((c) => c.first >= 0 && c.last < sentences.length && c.first <= c.last);
valid.forEach((c, k) => console.error(`  ${k + 1}. ${mmss(sentences[c.first].start)} (${lengthOf(c).toFixed(0)} s) ${c.title} – ${c.why}`));
const best = (opt.from || opt.to) ? valid[0] : valid.find((c) => lengthOf(c) >= MIN - 8 && lengthOf(c) <= MAX + 10) || valid[0];
if (!best) throw new Error("Claude returned no usable clip");

// ---------------------------------------------------------------- 3. cut
const a = sentences[best.first], b = sentences[best.last];
const prevEnd = a.first > 0 ? words[a.first - 1].end : 0;
const nextStart = b.last < words.length - 1 ? words[b.last + 1].start : b.end + 1;
const t0 = Math.max(prevEnd + 0.05, a.start - 0.3);
const t1 = Math.min(nextStart - 0.05, b.end + 0.5);
fs.mkdirSync(opt.out, { recursive: true });
execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", t0.toFixed(3), "-t", (t1 - t0).toFixed(3), "-i", audio,
  "-af", `afade=t=in:d=0.06,afade=t=out:st=${(t1 - t0 - 0.3).toFixed(3)}:d=0.3`, "-ar", "44100", "-ac", "2", path.join(opt.out, "audio.wav")]);
// the clip's voices by first appearance in the clip: A is who speaks first in it
const voices = new Map();
for (const w of words.slice(a.first, b.last + 1)) if (w.speaker != null && !voices.has(w.speaker)) voices.set(w.speaker, String.fromCharCode(65 + voices.size));
const clip = words.slice(a.first, b.last + 1).map((w) => ({ ...w, start: +(w.start - t0).toFixed(3), end: +(w.end - t0).toFixed(3),
  ...(w.speaker != null ? { speaker: voices.get(w.speaker) } : {}) }));
fs.writeFileSync(path.join(opt.out, "transcript.json"), JSON.stringify(clip, null, 0));
const gaps = clip.slice(1).filter((w, i) => w.start - clip[i].end > 3).map((w) => +w.start.toFixed(1));
fs.writeFileSync(path.join(opt.out, "highlight.json"), JSON.stringify({
  source: path.basename(audio), from: +t0.toFixed(3), to: +t1.toFixed(3), title: best.title, why: best.why,
  alternatives: valid.filter((c) => c !== best).map((c) => ({ from: +sentences[c.first].start.toFixed(1), seconds: +lengthOf(c).toFixed(1), title: c.title, why: c.why })),
}, null, 1));
console.error(`highlight: ${mmss(t0)}–${mmss(t1)} (${(t1 - t0).toFixed(1)} s, ${clip.length} words) → ${opt.out}  “${best.title}”`);
if (gaps.length) console.error(`  warning: the transcript has silent stretches > 3 s at ${gaps.join(", ")} s – check for missed speech`);
