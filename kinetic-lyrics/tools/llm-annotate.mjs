// Semantic annotation of a transcript with Claude.
//
// Replaces the keyword lexicon with a reading of the whole text: phrasing, which
// words carry the image, metaphors, negation, idioms, mood shifts — in any
// language. The model only *chooses* from the renderer's fixed vocabulary
// (concepts, word effects, moods, layouts), so the output stays renderable and
// the render itself stays deterministic (annotations are cached to a file).

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { CONCEPTS } from "./lexicon.mjs";
import { PALETTES } from "../engine/signals.js";

export const MODEL = "claude-opus-5-5";

const CONCEPT_KEYS = Object.keys(CONCEPTS);
const FX = ["rise", "drop", "flicker", "glow", "sparkle", "fog", "whisper", "slam", "glitch", "wave", "spin", "pulse", "shatter", "flash", "streak", "count", "blink", "redact", "bounce", "window", "depth", "blur"];
const MOODS = Object.keys(PALETTES);
const LAYOUTS = ["hero", "block", "cascade", "inline", "split", "list"];
const NOTES = ["circle", "underline", "strike"];
const EXITS = ["lift", "zoom", "blur", "scatter", "mow"];
const CHARTS = ["growth", "split", "compare", "gauge"];

const WORLDS = ["cosmos", "aurora", "editorial", "geometry", "bokeh", "neon", "noir"];
const Annotation = z.object({
  hook: z.string(),
  world: z.enum(WORLDS),
  phrases: z.array(z.object({
    first: z.number().int(),
    last: z.number().int(),
    hero: z.number().int().nullable(),
    minor: z.array(z.number().int()),
    mood: z.enum(MOODS),
    layout: z.enum(LAYOUTS),
    exit: z.enum(EXITS),
  })),
  words: z.array(z.object({
    i: z.number().int(),
    concept: z.enum(CONCEPT_KEYS),
    fx: z.enum(FX),
    emphasis: z.number(),
    mark: z.boolean(),
  })),
  notes: z.array(z.object({
    i: z.number().int(),
    kind: z.enum(NOTES),
  })),
  quotes: z.array(z.object({
    first: z.number().int(),
    last: z.number().int(),
  })),
  charts: z.array(z.object({
    i: z.number().int(),
    kind: z.enum(CHARTS),
    value: z.number(),
    base: z.number().nullable(),
    parts: z.array(z.object({ label: z.string(), value: z.number() })),
    focus: z.number().int().nullable(),
    label: z.string(),
    unit: z.string(),
  })),
});

const VOCAB = `
CONCEPTS (each drives a word effect + a 3D motif behind the text):
${Object.entries(CONCEPTS).map(([k, c]) => `- ${k}: default word fx "${c.fx}", world motif "${c.motif}", mood "${c.mood}"`).join("\n")}

WORD EFFECTS (fx):
rise = letters float up like balloons let go, each at its own pace, swaying (rising, floating, lightness, hope) · drop = heavy letters fall from above and land with a thud (falling, weight, landing) · flicker = letters catch fire from below and keep licking like flames (fire, heat, passion, burning) ·
glow = bright burst that settles · sparkle = letters pop with little stars · fog = big letters loom one by one out of a drifting mist (darkness, night, loneliness, being lost, nothing) ·
whisper = small hushed serif, breathed in letter by letter (whispering, quiet, gentle, small, slow) · slam = huge impact + shake · glitch = digital jitter, RGB split ·
wave = a wave keeps rolling through the letters (sea, water, waves, music, swaying) · spin = 3D flip · pulse = heartbeat · shatter = letters explode apart ·
flash = neon tubes stutter on letter by letter and one buzzes later (neon, light switched on, city at night, signs) · streak = shoots in with motion blur · count = a number counts up (use for numeric words) ·
blink = opens like an eye and blinks once (seeing, watching, noticing) · redact = appears under a censor bar that pulls
away (secrets, lies, the hidden, the classified) · bounce = letters jump up from the line, land squashed and keep hopping now and then (animals, play, joy, comedy) ·
window = the word splits down the middle as the next word is spoken and both halves swing open like casements, light pouring through (windows, doors, opening up, a reveal: "ein Fenster auf", "opened the door") ·
depth = lying flat far away, the word rises out of the depth and stands up as it arrives (depth, distance, from afar, the abyss, the past) ·
blur = comes into focus out of a heavy blur (focus, clarity, realising, waking up, seeing clearly)

MOODS (palette families): ${MOODS.join(", ")}
  night=deep blue neutral, dark=desaturated grey, dawn=peach/violet hope, electric=cyan/magenta energy,
  cool=icy blue sadness, ocean=teal calm, violet=dreamy/time, rose=love/tenderness, ember=fire/anger/passion, gold=light/triumph

WORLDS (the stage the whole video plays on – pick the one that fits the subject and tone):
  cosmos = night sky, nebula, stars – dreams, longing, night, space, big emotions, lyrics
  aurora = flowing vivid colour fields, soft light – lifestyle, motivation, wellbeing, upbeat social posts
  editorial = paper and ink, light background, dark type – business, education, interviews, analysis, serious podcasts
  geometry = bright studio with matte 3D shapes and soft shadows – tech, product, design, explainers, how-tos
  bokeh = warm out-of-focus lights drifting in the dark, cinematic – people, relationships, lifestyle, health, animals, film, comedy
  neon = a glowing perspective grid with light streaks – tech, gaming, sport, racing, speed, machines, the future
  noir = a dark room cut by slanted light through blinds, dust in the beams – crime, spies, secrets, mystery, history, politics, psychology

LAYOUTS: hero (one giant word, the rest small around it) · block (justified stacked lines) ·
  cascade (stair-stepped lines) · inline (one or two lines, for longer phrases) · split (two halves at opposite corners) ·
  list (a checklist: only for an enumeration of 3–6 short comma-separated items like "reports, tickets, first drafts" –
  the phrase must contain exactly the whole enumeration; each item gets its own line and a box that ticks as it is spoken)

NOTES (hand-drawn marks drawn onto a single word, like a pen on a printout):
  circle = circled – the key term, a surprising word, the one word the argument turns on
  underline = underlined – a claim or consequence that should stick
  strike = crossed out – only for something the speaker explicitly rejects or replaces ("not X but Y" → strike X,
           circle Y; "instead of X"; an old belief the speaker overturns). A crossed-out word must read as
           "this is wrong / gone". Never strike inside a question, never a fear, doubt or possibility that is only
           raised ("didn't quality drop?", "what if it fails"), and never just because a negation word is nearby.
  Use them sparingly: roughly one per two or three sentences, never two in one phrase, and not on a number.

DATA GRAPHICS – a small chart under a phrase that shows what a number *means*. Simple ones are added
automatically: percentages get a filling bar, multipliers ("doubled", "3x") before/after bars, small counts of
things ("team of six", "thirty days") pictograms. Keep a number together with its unit or noun in one phrase
("40% of our week", "100 Euro monatlich"), and give such phrases a calm layout (hero, inline or block).
charts: add a chart yourself where the speaker *relates* numbers to each other, so the viewer sees the comparison
(on the number word it belongs to; at most one per phrase and roughly one per 8 seconds; [] if nothing fits):
  growth  = a curve that bends upward over time – compound interest, exponential growth. value = the end amount,
            base = the straight-line comparison (e.g. the total paid in) or null, label = the time span as spoken
            ("50 Jahre", "30 years"), unit = "€" / "$" / "%" / ""
  split   = one bar divided into the parts of a whole (paid in vs. return, costs vs. profit, share of a total).
            parts = 2–3 {label, value}: short labels (1–2 words, the transcript's language), values in the same unit;
            focus = index of the part this phrase talks about (or null). A walk-through may repeat the same split
            on consecutive numbers with a different focus.
  compare = before/after bars, value = the factor (e.g. 3.3 when a return of 200.000 exceeds 60.000 "many times")
  gauge   = a share filling a bar, value = 0–100
  Use only figures stated in the transcript or exactly derived from them (a sum, a share, a factor) – never invent
  or round them into something the speaker did not say. Unused fields: base null, parts [], focus null, label "", unit "".

EXITS: lift (letters rise out) · zoom (flies through the camera) · blur (dissolves) · scatter (words drift apart) · mow (a cute lawn mower drives through and cuts the letters down to stubble – a gag: only for a phrase that says mowing, a lawn or cutting grass, at most once per video; the mower follows the letters in, so the phrase is cut while it is spoken)
`;

const PRESET_DIRECTION = {
  lyric: `This is a song, poem or spoken-word piece. Stage it like a premium lyric video: big gestures, images acted out, the 3D world fully alive. hook: "" (no headline). mark: false for all words.`,
  podcast: `This is an excerpt from a podcast conversation. Clarity first: viewers must be able to follow the argument with the sound off. Phrases follow the speaker's sentences; never mix two speakers in one phrase (speaker labels are given per word). Tag far fewer words than in a lyric video – only the claims, numbers, contrasts and concrete images that carry the point, roughly one every 6 seconds of speech (the renderer drops accents that crowd each other, keeping the strongest); prefer inline/block layouts and calm exits (lift, blur). mark: true for the 1–2 words per sentence a viewer should remember (key claim, number, surprising word). hook: a 3–7 word headline that states what this clip is about, in the transcript's language, phrased like a strong podcast-clip title (no clickbait, no quotes, no hashtags).`,
  social: `This is a short-form social video (TikTok / Reels / Shorts, vertical). Punchy and fast: short phrases (2–4 words), hero layouts for the payoff words, high contrast. mark: true for the 1–2 words per sentence that carry the message (numbers, promises, surprises). hook: a 3–7 word headline shown at the top for the whole video – it must make someone stop scrolling while staying true to the content, in the transcript's language (no hashtags, no emoji).`,
};

function systemPrompt(numbered, opts) {
  return `You direct a kinetic-typography video. ${PRESET_DIRECTION[opts.preset || "lyric"]}

Every word appears on screen exactly when it is spoken, over an illustrative 3D world. Your job is to read the transcript as a whole and decide how it is staged, choosing only from the renderer's vocabulary below.

${VOCAB}

${opts.video ? `The type sits over the speakers' own camera footage (it fills the frame; the type is in the darkened lower part). Over footage a world only adds light, so pick one of cosmos, aurora, bokeh, neon or noir – editorial and geometry are not available.

` : ""}The frame is ${opts.width}x${opts.height} (${opts.portrait ? "portrait – keep phrases short, usually 2–4 words, 5 when the clause has no better break" : "landscape – phrases of up to 6 words"}).

How to stage it:
- Split ALL words into consecutive phrases (on-screen lockups). Follow meaning and breath: clause boundaries, punctuation, pauses in the timings. Every word index belongs to exactly one phrase, in order, no gaps. A phrase should stay on screen at least ~0.6 s; very fast speech gets longer phrases.
- hero: the single word that carries the phrase (often the image or the stressed word), or null if nothing stands out.
- minor: indices of grammatical filler in that phrase (articles, pronouns, auxiliaries, conjunctions, prepositions – in whatever language this is). They are set small in italic serif.
- words: tag only words whose meaning a visual can genuinely amplify – images, actions, strong emotions. Typically 15–35% of content words (unless the direction at the top asks for fewer, as for podcasts); abstract talk gets fewer tags, poetic text more. Use context: negation ("not afraid" is not fear), idioms ("break the ice" is not shattering), metaphors (a "storm" of criticism may be electric). Pick the concept whose motif fits best and the fx that best acts the word out (it may differ from the concept's default). emphasis 0..1 = how strongly the word should land.
- mood: the emotional colour of the phrase. Hold a mood across a passage and change it when the text turns; do not flip every phrase.
- layout and exit: vary them so consecutive phrases look different; use hero for short punchy phrases, inline for long ones.
- notes: the few words that deserve a pen mark (see NOTES) – empty if nothing qualifies.
- quotes: the one or two sentences that are the payoff – the line people would quote or put on a thumbnail
  (a punchline, the core insight, a memorable phrasing). Word range first..last, at most 16 words, one speaker.
  It is shown whole as a large quotation, so pick a span that reads as a complete thought. Usually 0–1 per minute;
  empty if nothing stands out.

The transcript (index: word @ start–end seconds):
${numbered}`;
}

const numberWords = (words) =>
  words.map((w, i) => `${i}: ${w.text} @${w.start.toFixed(2)}-${w.end.toFixed(2)}${w.speaker != null ? ` [${w.speaker}]` : ""}`).join("\n");

// Long transcripts are annotated in windows (split at sentence ends); the full
// transcript stays in the cached system prompt so every window has context.
function windows(words, size = 450) {
  const out = [];
  let a = 0;
  while (a < words.length) {
    let b = Math.min(words.length - 1, a + size - 1);
    if (b < words.length - 1) {
      for (let k = b; k > a + size * 0.6; k--) if (/[.!?…]$/.test(words[k].text)) { b = k; break; }
    }
    out.push([a, b]);
    a = b + 1;
  }
  return out;
}

// Backend 1: the Claude API (API key or `ant auth login` profile, billed per token).
async function viaApi(system, userText, client, schema = Annotation) {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: zodOutputFormat(schema) },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userText }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error(`Claude declined (${msg.stop_details?.category ?? "unknown"})`);
  if (msg.stop_reason === "max_tokens") throw new Error("annotation was cut off (max_tokens)");
  return JSON.parse(msg.content.filter((c) => c.type === "text").map((c) => c.text).join(""));
}

// Backend 2: headless Claude Code (`claude -p`), which runs on the logged-in
// Claude subscription. No tools, no session on disk, schema-validated output.
function viaClaudeCode(system, userText, schema = Annotation) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinetic-staging-"));
  const sysFile = path.join(dir, "system.md");
  fs.writeFileSync(sysFile, system);
  const args = [
    "-p", "--output-format", "json", "--model", "opus", "--effort", "medium",
    "--system-prompt-file", sysFile, "--tools", "", "--no-session-persistence",
    "--json-schema", JSON.stringify(jsonSchema(schema)),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      fs.rmSync(dir, { recursive: true, force: true });
      if (code !== 0) return reject(new Error(`claude -p exited ${code}: ${(err || out).slice(0, 300)}`));
      try {
        const res = JSON.parse(out);
        if (res.is_error) return reject(new Error(`claude -p: ${String(res.result).slice(0, 300)}`));
        resolve(res.structured_output ?? JSON.parse(String(res.result).replace(/^```(?:json)?\s*|\s*```$/g, "")));
      } catch (e) { reject(new Error(`could not read claude -p output: ${e.message}`)); }
    });
    child.stdin.end(userText);
  });
}

// claude's schema validator doesn't resolve the draft-2020-12 meta-schema URI zod writes
function jsonSchema(zodSchema) {
  const { $schema, ...schema } = z.toJSONSchema(zodSchema);
  return schema;
}

// One structured request to Claude on either backend; the answer is validated by the zod schema.
export async function askClaude(system, userText, schema, backend = "claude-code") {
  const raw = backend === "api" ? await viaApi(system, userText, new Anthropic(), schema) : await viaClaudeCode(system, userText, schema);
  return schema.parse(raw);
}

const userTurn = (a, b) => `Stage words ${a} to ${b} (inclusive). Phrases must start at ${a} and end at ${b}. Reply with the JSON only.`;

// Backend 3: the agent that runs the build is the director (e.g. a coding or chat agent).
// `brief` is what it reads, `readStaging` checks what it wrote. The file may also carry
// `fixes`: words the speech recogniser misheard, respelled (timings stay).
const Fix = z.object({ i: z.number().int(), text: z.string().min(1) });
const FileStaging = Annotation.extend({ fixes: z.array(Fix).optional() });

export function brief(words, opts, file = "staging.json") {
  return `${systemPrompt(numberWords(words), opts)}

Write your staging of all ${words.length} words (0 to ${words.length - 1}) as one JSON object into ${file}. Fields not
used stay empty: notes [], quotes [], charts [] are fine. Optionally add "fixes": [{"i": 12, "text": "Netzentgelte"}] for
words the speech recogniser clearly misheard (wrong spelling, two words merged) – the spelling changes (keep the punctuation attached to the word), the timing stays.
Only fix what the context makes certain; never rephrase.

The JSON schema:
${JSON.stringify(jsonSchema(FileStaging))}
`;
}

// A staging written by hand or by an agent: schema-checked, then held to the same rules as
// Claude's. Throws with a readable message (field paths) when something is off.
export function readStaging(raw, n) {
  const r = FileStaging.safeParse(raw);
  if (!r.success) throw new Error(r.error.issues.slice(0, 8).map((x) => `${x.path.join(".") || "(root)"}: ${x.message}`).join("; "));
  const fixes = (r.data.fixes || []).filter((f) => f.i >= 0 && f.i < n && !/\s/.test(f.text.trim()));
  return { ...validate({ ...r.data, model: r.data.model ?? "agent", preset: r.data.preset }, n), fixes };
}

export async function annotate(words, opts, log = console.error) {
  const backend = opts.backend || "claude-code";
  const client = backend === "api" ? new Anthropic() : null;
  const system = systemPrompt(numberWords(words), opts);
  const merged = { model: backend === "api" ? MODEL : "opus (claude code)", hook: "", phrases: [], words: [], notes: [], quotes: [], charts: [] };

  for (const [a, b] of windows(words)) {
    log(`  claude [${backend}]: staging words ${a}–${b} …`);
    const raw = backend === "api" ? await viaApi(system, userTurn(a, b), client) : await viaClaudeCode(system, userTurn(a, b));
    const parsed = Annotation.parse(raw);
    merged.phrases.push(...parsed.phrases);
    merged.words.push(...parsed.words);
    merged.notes.push(...parsed.notes);
    merged.quotes.push(...parsed.quotes);
    merged.charts.push(...parsed.charts);
    if (!merged.hook && parsed.hook) merged.hook = parsed.hook.trim();
    if (!merged.world) merged.world = parsed.world;
  }
  merged.preset = opts.preset || "lyric";
  return validate(merged, words.length);
}

// Make sure the phrases tile the transcript exactly; repair small issues,
// reject what can't be trusted (the caller then falls back to the lexicon).
export function validate(ann, n) {
  const phrases = [...ann.phrases].sort((x, y) => x.first - y.first);
  let next = 0;
  for (const p of phrases) {
    if (p.first !== next || p.last < p.first || p.last >= n) throw new Error(`phrases don't tile the transcript at word ${next}`);
    if (p.hero != null && (p.hero < p.first || p.hero > p.last)) p.hero = null;
    p.minor = p.minor.filter((i) => i >= p.first && i <= p.last && i !== p.hero);
    next = p.last + 1;
  }
  if (next !== n) throw new Error(`phrases end at ${next}, transcript has ${n} words`);
  const words = ann.words.filter((w) => w.i >= 0 && w.i < n).map((w) => ({ ...w, emphasis: Math.min(1, Math.max(0, w.emphasis)) }));
  // at most one note per phrase; a note never sits on a function word Claude marked minor
  const minor = new Set(phrases.flatMap((p) => p.minor));
  const seen = new Set();
  const notes = (ann.notes || []).filter((x) => {
    const p = phrases.find((q) => x.i >= q.first && x.i <= q.last);
    if (!p || minor.has(x.i) || seen.has(p)) return false;
    seen.add(p);
    return true;
  });
  const quotes = (ann.quotes || []).filter((q) => q.first >= 0 && q.last < n && q.last >= q.first && q.last - q.first <= 15).slice(0, 4);
  // charts: on a real word, finite numbers, one per phrase
  const chartSeen = new Set();
  const charts = (ann.charts || []).filter((c) => {
    const p = phrases.find((q) => c.i >= q.first && c.i <= q.last);
    if (!p || chartSeen.has(p) || !CHARTS.includes(c.kind) || !Number.isFinite(c.value)) return false;
    if (c.kind === "split" && !(c.parts?.length >= 2 && c.parts.length <= 3 && c.parts.every((x) => x.value > 0))) return false;
    if (c.kind === "growth" && !(c.value > 0)) return false;
    if (c.kind === "gauge" && !(c.value > 0 && c.value <= 100)) return false;
    if (c.kind === "compare" && !(c.value >= 0.2 && c.value <= 20)) return false;
    chartSeen.add(p);
    return true;
  });
  return { ...ann, phrases, words, notes, quotes, charts };
}
