// Fill passages the ASR skipped: every voiced gap in the transcript is cut out
// (with a little context), transcribed again with Whisper and spliced back in.
//
//   node tools/repair.mjs <audio> <transcript.json> [--out fixed.json] [--lang auto|de|en]
//        [--model ~/.cache/whisper.cpp/ggml-large-v3-turbo-q5_0.bin] [--min-gap 1.5] [--crosscheck]
//
// --crosscheck also runs Whisper over the whole file; where the two recognisers disagree on a few
// words, Claude judges in context which reading is right (meant for clips, not full episodes).
//
// Parakeet is the better recogniser overall but now and then drops a whole clause;
// Whisper (whisper.cpp, multilingual) only runs on those few seconds, so it stays fast.
// Repaired words carry "repaired": true. Without --out the transcript is updated in place.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { voicedGaps } from "./gaps.mjs";
import { askClaude } from "./llm-annotate.mjs";

const CACHE = path.join(os.homedir(), ".cache", "whisper.cpp");
const MODELS = ["ggml-large-v3-turbo-q5_0.bin", "ggml-large-v3-turbo.bin", "ggml-medium.bin", "ggml-small.bin"];

export function findModel(given) {
  if (given) return given;
  const m = MODELS.map((f) => path.join(CACHE, f)).find((f) => fs.existsSync(f));
  if (!m) throw new Error(`repair: no whisper.cpp model in ${CACHE} – see README (Repairing gaps and mishearings)`);
  return m;
}

// whisper.cpp on one wav → [{text, start, end}] (one entry per word)
function whisperWords(wav, model, lang) {
  const base = wav.replace(/\.wav$/, "");
  execFileSync("whisper-cli", ["-m", model, "-f", wav, "-l", lang, "-ml", "1", "-sow", "-oj", "-of", base, "-np"], { stdio: ["ignore", "ignore", "ignore"] });
  const segs = JSON.parse(fs.readFileSync(base + ".json", "utf8")).transcription || [];
  return segs
    .map((s) => ({ text: s.text.trim(), start: s.offsets.from / 1000, end: s.offsets.to / 1000 }))
    .filter((w) => w.text && !/^\[.*\]$|^\(.*\)$/.test(w.text)); // [Musik], (lacht)
}

const keyOf = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

// Returns { words, filled: [{a, b, text}] }
export function repairTranscript(audio, words, { lang = "auto", model, minGap = 1.5, log = () => {} } = {}) {
  const gaps = voicedGaps(audio, words, { minGap });
  if (!gaps.length) return { words, filled: [] };
  model = findModel(model);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kinetic-repair-"));
  const out = [...words];
  const filled = [];
  for (const { a, b } of gaps) {
    const PAD = 0.6; // context so Whisper hears whole words at the edges
    const t0 = Math.max(0, a - PAD), t1 = b + PAD;
    const wav = path.join(tmp, `g${Math.round(a * 1000)}.wav`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", t0.toFixed(3), "-t", (t1 - t0).toFixed(3), "-i", audio, "-ac", "1", "-ar", "16000", wav]);
    const prev = words.filter((w) => w.end <= a + 0.01).at(-1), next = words.find((w) => w.start >= b - 0.01);
    const got = whisperWords(wav, model, lang)
      .map((w) => ({ ...w, start: +(w.start + t0).toFixed(3), end: +(w.end + t0).toFixed(3) }))
      // only what lies inside the gap; the padding re-hears the neighbours
      .filter((w) => (w.start + w.end) / 2 > a + 0.05 && (w.start + w.end) / 2 < b - 0.05)
      .filter((w, k, arr) => !(k === 0 && prev && keyOf(w.text) === keyOf(prev.text)) && !(k === arr.length - 1 && next && keyOf(w.text) === keyOf(next.text)));
    if (!got.length) continue;
    // clamp into the gap so the order stays strict
    for (const w of got) {
      w.start = Math.max(w.start, a); w.end = Math.min(Math.max(w.end, w.start + 0.05), b);
      w.repaired = true;
    }
    // speaker labels follow the neighbours
    if (prev?.speaker != null) for (const w of got) w.speaker = prev.speaker;
    const at = out.indexOf(next ?? null);
    out.splice(at < 0 ? out.length : at, 0, ...got);
    const text = got.map((w) => w.text).join(" ");
    filled.push({ a, b, text });
    log(`  ${a.toFixed(1)}–${b.toFixed(1)} s: "${text}"`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  return { words: out, filled };
}

// Levenshtein distance, for "is this the same word misheard?"
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// Cross-check a short clip against a full Whisper pass. Both recognisers mishear now and
// then – Parakeet merges words ("verdeutliben" for "verdeutlicht eben"), Whisper mangles
// compounds ("Netzeingelte" for "Netzentgelte") – so neither simply wins: every short
// disagreement goes to Claude, who reads the sentence and picks the reading that makes sense
// (or a minimal spelling fix of one of them). Parakeet's timing is kept either way.
// Without Claude, Parakeet's words stay. Returns { words, fixed: [{from, to}] }
const Verdicts = z.object({
  verdicts: z.array(z.object({ k: z.number().int(), pick: z.enum(["A", "B", "fix"]), text: z.string() })),
});

export async function crossCheck(audio, words, { lang = "auto", model, log = () => {}, backend = "claude-code" } = {}) {
  model = findModel(model);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kinetic-xcheck-"));
  const wav = path.join(tmp, "clip.wav");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", audio, "-ac", "1", "-ar", "16000", wav]);
  const ref = whisperWords(wav, model, lang);
  fs.rmSync(tmp, { recursive: true, force: true });
  const A = words.map((w) => keyOf(w.text)), B = ref.map((w) => keyOf(w.text));
  // LCS table, then walk it into equal runs and differing hunks
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const hunks = [];
  let i = 0, j = 0, hi = 0, hj = 0;
  const flush = () => { if (i > hi || j > hj) hunks.push([hi, i, hj, j]); };
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { flush(); i++; j++; hi = i; hj = j; }
    else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) j++;
    else i++;
  }
  flush();
  // only short substitutions: an insert/delete or a long run is more likely a hallucination
  const cands = hunks.filter(([a0, a1, b0, b1]) => a1 > a0 && b1 > b0 && a1 - a0 <= 4 && b1 - b0 <= 4);
  if (!cands.length) return { words, fixed: [] };
  const textA = (h) => words.slice(h[0], h[1]).map((w) => w.text).join(" ");
  const textB = (h) => ref.slice(h[2], h[3]).map((w) => w.text).join(" ");
  // the transcript with every disagreement marked, so Claude judges each in its sentence
  let marked = "", at = 0;
  cands.forEach((h, k) => {
    marked += words.slice(at, h[0]).map((w) => w.text).join(" ") + ` [#${k}: A „${textA(h)}“ | B „${textB(h)}“] `;
    at = h[1];
  });
  marked += words.slice(at).map((w) => w.text).join(" ");
  const system = `Two speech recognisers transcribed the same podcast clip. Where they disagree, the passage is marked [#k: A „…“ | B „…“] (A = recogniser 1, whose text is shown around the marks; B = recogniser 2).
For every mark decide what was most likely said, judging by grammar, meaning and the topic:
- pick "A" or "B" when one of them is right (text: "")
- pick "fix" only when both are slightly off and an obvious correction of one of them is clearly meant – a misspelled word, a split or merged compound, a wrong ending ("Netz eingelte" → "Netzentgelte"); text = the corrected words, as few changes as possible. Never rephrase, never add content.
Keep the speaker's own wording, including colloquial grammar. Answer for every mark k.

${marked}`;
  let verdicts;
  try {
    ({ verdicts } = await askClaude(system, "Judge every mark. Reply with the JSON only.", Verdicts, backend));
  } catch (e) {
    log(`  cross-check: Claude unavailable (${e.message.slice(0, 80)}) – keeping recogniser 1`);
    return { words, fixed: [] };
  }
  const out = [...words], fixed = [];
  const byK = new Map(verdicts.map((v) => [v.k, v]));
  for (let k = cands.length - 1; k >= 0; k--) {
    const v = byK.get(k), h = cands[k];
    if (!v || v.pick === "A") continue;
    let repl = v.pick === "B" ? ref.slice(h[2], h[3]).map((w) => w.text) : v.text.trim().split(/\s+/).filter(Boolean);
    if (v.pick === "fix") {
      // a fix must stay close to what was heard
      const fx = keyOf(repl.join("")), dA = editDistance(fx, keyOf(textA(h))), dB = editDistance(fx, keyOf(textB(h)));
      if (!fx || repl.length > 5 || Math.min(dA, dB) / fx.length > 0.35) continue;
    }
    // only real words (a stray "-?" is not one), and no more words than the span can hold
    repl = repl.filter((t) => /[\p{L}\p{N}]/u.test(t));
    if (!repl.length) continue;
    const span = words.slice(h[0], h[1]), t0 = span[0].start, t1 = span[span.length - 1].end;
    if (repl.length > span.length && (t1 - t0) / repl.length < 0.14) continue;
    const total = repl.reduce((a, t) => a + t.length, 0);
    let t = t0;
    const next = repl.map((text) => {
      const d = ((t1 - t0) * text.length) / total;
      const nw = { ...span[0], text, start: +t.toFixed(3), end: +(t + d).toFixed(3), repaired: true };
      t += d;
      return nw;
    });
    // keep the original's trailing punctuation if the replacement has none
    const p = (span[span.length - 1].text.match(/[.,!?;:…]+$/) || [""])[0];
    if (p && !/[.,!?;:…]$/.test(next[next.length - 1].text)) next[next.length - 1].text += p;
    out.splice(h[0], h[1] - h[0], ...next);
    fixed.unshift({ from: textA(h), to: next.map((w) => w.text).join(" ") });
  }
  log(`  cross-check: ${cands.length} disagreement(s), ${fixed.length} corrected`);
  for (const f of fixed) log(`  "${f.from}" → "${f.to}"`);
  return { words: out, fixed };
}

// ---------------------------------------------------------------- CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2), opt = {}, pos = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) opt[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    else pos.push(argv[i]);
  }
  const [audio, file] = pos;
  if (!audio || !file) { console.error("usage: node tools/repair.mjs <audio> <transcript.json> [--out f] [--lang auto] [--model m]"); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const list = Array.isArray(data) ? data : data.words;
  console.error(`repair: ${path.basename(file)} (${list.length} words)`);
  let { words, filled } = repairTranscript(audio, list, { lang: opt.lang || "auto", model: opt.model, minGap: Number(opt["min-gap"] || 1.5), log: console.error });
  console.error(`repair: ${filled.length} gap(s) filled, ${words.length - list.length} words added`);
  if (opt.crosscheck) {
    let fixed;
    ({ words, fixed } = await crossCheck(audio, words, { lang: opt.lang || "auto", model: opt.model, log: console.error }));
    console.error(`repair: ${fixed.length} misheard word(s) corrected`);
  }
  const res = Array.isArray(data) ? words : { ...data, words };
  fs.writeFileSync(opt.out || file, JSON.stringify(res, null, 0));
  console.error(`→ ${opt.out || file}`);
}
