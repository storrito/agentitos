// Transcript -> plan. Pure and deterministic: same transcript + options = same plan.
//
// The plan is the single contract between the build step and both renderers
// (typography + world). Everything "semantic" is decided here so the
// browser only has to draw.

import { CONCEPTS, STOPWORDS, MEANINGFUL_STOP, CLAUSE_OPENERS, keyOf, conceptOf, exitOf, numberOf } from "./lexicon.mjs";
import { detectViz, detectNotes, detectLists, listItems } from "./viz.mjs";
import { TEXT_GRAPHICS } from "../engine/graphics.js";

// Presets tune pacing and presence for the kind of source material.
//   lyric   – songs, poems, spoken word: big gestures, full 3D world
//   podcast – conversation excerpts: caption-forward, calmer world, speakers, audiogram
//   social  – short-form vertical posts: punchy lines, hook headline, keyword markers, CTA
export const PRESETS = {
  lyric: {
    maxWords: [6, 5, 4], maxChars: [36, 28, 22], world: 1, tilt: 1, drift: 1, marker: false, tail: 1.8, audiogram: false,
    budget: { fx: 1.6, note: 4, mark: 0 }, minRead: 0.8,
    enter: ["mask", "mask", "depth", "blur"], exits: ["lift", "zoom", "blur", "lift", "scatter"],
    layouts: { wide: ["block", "cascade", "hero", "split", "block"], tall: ["block", "hero", "cascade", "block"], long: ["block", "inline", "cascade"] },
  },
  podcast: {
    maxWords: [7, 6, 5], maxChars: [42, 32, 26], world: 0.45, tilt: 0.25, drift: 0.4, marker: true, tail: 1.4, audiogram: true,
    budget: { fx: 6, note: 9, mark: 3.2 }, minRead: 1.25,
    enter: ["mask", "blur", "mask"], exits: ["lift", "blur", "lift"],
    layouts: { wide: ["inline", "block", "inline", "hero"], tall: ["block", "inline", "block", "hero"], long: ["inline", "block"] },
  },
  social: {
    maxWords: [5, 4, 3], maxChars: [30, 24, 18], world: 0.7, tilt: 0.45, drift: 0.6, marker: true, tail: 1.6, audiogram: false,
    budget: { fx: 2.4, note: 4.5, mark: 1.6 }, minRead: 0.95,
    enter: ["mask", "mask", "blur"], exits: ["lift", "zoom", "lift"],
    layouts: { wide: ["block", "hero", "inline"], tall: ["block", "hero", "block", "inline"], long: ["block", "inline"] },
  },
};
const SPEAKER_COLORS = ["#7fe3ff", "#ffb36b", "#c9a7ff", "#9dffb0", "#ff8fb1"];
// on light worlds (paper / studio) the speaker colours must carry dark-on-light text
const SPEAKER_COLORS_LIGHT = ["#08609c", "#b0400a", "#5d33c4", "#11703e", "#ad1452"]; // ≥ 4:1 on paper
export const LIGHT_WORLDS = new Set(["editorial", "geometry", "linen", "mist"]);
export const WORLD_NAMES = ["cosmos", "aurora", "editorial", "geometry", "bokeh", "neon", "noir", "slate", "dusk", "canopy", "chalk", "linen", "mist"];
const DEFAULT_WORLD = { lyric: "cosmos", podcast: "editorial", social: "aurora" };

// ---------- input normalisation ----------

// Accepts: [{text,start,end}], {words:[...]}, whisper-style {segments:[{words}]},
// field aliases word/token, ms fields startMs/endMs. Optional per-word overrides:
// fx, concept, emphasis (0..1), hero (bool), break (bool: force phrase break after),
// note ("circle" | "underline" | "strike"), viz ({kind, value, icon} or null to suppress).
// Spoken disfluencies that never belong on screen. Real conversations are full of them.
// Per language: German "um" (around) and "er" (he) are real words, not English hesitations.
const FILLERS_ANY = ["ah", "hm", "hmm", "mhm", "mm"];
const FILLERS = {
  en: new Set([...FILLERS_ANY, "uh", "uhh", "um", "umm", "uhm", "er", "erm", "eh"]),
  de: new Set([...FILLERS_ANY, "äh", "ähm", "öh", "öhm", "ehm", "äm"]),
};

// "de" | "en" from the share of very common words – enough to pick fillers, number format, HUD labels
const LANG_HINTS = {
  de: new Set(["der", "die", "das", "und", "ist", "nicht", "wir", "ich", "sie", "ein", "eine", "zu", "mit", "auf", "für", "es", "dass", "auch", "sind", "haben", "wenn", "aber", "von", "den", "dem"]),
  en: new Set(["the", "and", "is", "to", "of", "you", "we", "it", "that", "in", "a", "for", "this", "was", "are", "have", "with", "but", "they", "be", "on", "so", "what", "like"]),
};
export function detectLang(list) {
  const n = { de: 0, en: 0 };
  for (const w of list) {
    const k = keyOf(String(w.text ?? w.word ?? ""));
    if (LANG_HINTS.de.has(k)) n.de++;
    if (LANG_HINTS.en.has(k)) n.en++;
  }
  return n.de > n.en ? "de" : "en";
}

export function normalizeTranscript(raw, { keepFillers = false } = {}) {
  let list = raw;
  if (!Array.isArray(list)) {
    if (Array.isArray(raw.words)) list = raw.words;
    else if (Array.isArray(raw.segments)) list = raw.segments.flatMap((s) => s.words || []);
    else throw new Error("Transcript must be an array of words or have .words / .segments");
  }
  const words = [];
  for (const w of list) {
    const text = String(w.text ?? w.word ?? w.token ?? "").trim();
    if (!text) continue;
    let start = w.start ?? (w.startMs != null ? w.startMs / 1000 : undefined);
    let end = w.end ?? (w.endMs != null ? w.endMs / 1000 : undefined);
    if (typeof start !== "number" || Number.isNaN(start)) continue;
    if (typeof end !== "number" || end < start) end = start + 0.25;
    words.push({ ...w, text, start, end });
  }
  words.sort((a, b) => a.start - b.start);
  const fillers = FILLERS[detectLang(words)];
  if (!keepFillers) {
    for (let i = words.length - 1; i >= 0; i--) {
      const k = keyOf(words[i].text), next = words[i + 1];
      // stutter: "is is", "the the", "long long" – same word straight again, no punctuation between
      const stutter = next && k && k === keyOf(next.text) && !/[.,!?;:…—–-]$/.test(words[i].text) && next.start - words[i].end < 0.4;
      if (fillers.has(k) || stutter) {
        // a filler that ends a clause hands its punctuation to the word before it
        const p = (words[i].text.match(/[.,!?;:…]+$/) || [""])[0];
        if (p && i > 0 && !/[.,!?;:…]$/.test(words[i - 1].text) && fillers.has(k)) words[i - 1] = { ...words[i - 1], text: words[i - 1].text + p };
        if (stutter) next.start = words[i].start; // the repeated word owns the whole span
        words.splice(i, 1);
      }
    }
  }
  // ASR often gives near-zero durations ("heart@18.05-18.09"); stretch toward the next word.
  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1];
    const minEnd = words[i].start + 0.18;
    if (words[i].end < minEnd) words[i].end = next ? Math.min(minEnd, Math.max(words[i].end, next.start)) : minEnd;
  }
  return words;
}

// ---------- deterministic helpers ----------

export function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const pick = (arr, seed) => arr[seed % arr.length];

// ---------- analysis ----------

const MOOD_OF = Object.fromEntries(Object.entries(CONCEPTS).map(([k, c]) => [k, c.mood]));

export function analyze(rawWords, opts = {}) {
  const { width = 1920, height = 1080, seed = 7, title = "", annotations = null, preset: presetName = "lyric" } = opts;
  const P = PRESETS[presetName] || PRESETS.lyric;
  const tail = opts.tail ?? P.tail;
  // Claude's staging (tools/llm-annotate.mjs) replaces lexicon + heuristics when present
  const ann = annotations;
  const annWord = new Map((ann?.words || []).map((a) => [a.i, a]));
  const annMinor = new Set((ann?.phrases || []).flatMap((p) => p.minor));
  const portrait = height > width * 1.1;
  const square = !portrait && width < height * 1.25;
  const fmt = portrait ? 2 : square ? 1 : 0;
  const maxWords = P.maxWords[fmt];
  const maxChars = P.maxChars[fmt];

  const durations = rawWords.map((w) => w.end - w.start).sort((a, b) => a - b);
  const medianDur = durations[Math.floor(durations.length / 2)] || 0.3;

  // 1. enrich words
  const words = rawWords.map((w, i) => {
    const key = keyOf(w.text);
    const prevKey = i > 0 ? keyOf(rawWords[i - 1].text) : "";
    const punct = (w.text.match(/[.,!?;:…—–-]+$/) || [""])[0];
    const aw = annWord.get(i);
    const isStop = ann ? annMinor.has(i) : STOPWORDS.has(key) && !MEANINGFUL_STOP.has(key);
    const num = numberOf(w.text);
    let concept = w.concept !== undefined ? w.concept : ann ? aw?.concept ?? null : isStop ? null : conceptOf(key);
    if (num && w.concept === undefined && (!ann || !aw || aw.concept === "number")) concept = "number";
    const display = w.text.replace(/^[„“"'(«]+|[.,!?;:…"”'»)]+$/g, "");
    const dur = w.end - w.start;
    let emphasis = 0;
    if (!isStop) emphasis += 0.25;
    emphasis += Math.min(0.35, Math.max(0, (dur / medianDur - 1) * 0.18));
    if (concept) emphasis += 0.3;
    // "up", "auf", "nie" …: carry an image, but a content word beside them says more ("das Fenster auf")
    if (concept && MEANINGFUL_STOP.has(key)) emphasis -= 0.1;
    if (/[!]/.test(punct)) emphasis += 0.25;
    if (/[.?]/.test(punct)) emphasis += 0.1;
    if (key === prevKey && key) emphasis += 0.2; // repetition ("higher, higher")
    if (display.length > 1 && display === display.toUpperCase() && /\p{L}/u.test(display)) emphasis += 0.2;
    if (num) emphasis += 0.3;
    if (aw) emphasis = aw.emphasis;
    if (typeof w.emphasis === "number") emphasis = w.emphasis;
    emphasis = Math.min(1, emphasis);
    // marker highlight (podcast/social caption look): the words that carry the claim
    const mark = P.marker && !isStop && (aw ? !!aw.mark : emphasis >= 0.62);
    return {
      i, text: w.text, display, key, start: +w.start.toFixed(3), end: +w.end.toFixed(3),
      punct, role: isStop ? "fn" : "content", concept,
      fx: w.fx || (num ? "count" : null) || aw?.fx || (concept ? CONCEPTS[concept].fx : null),
      num, mark, speaker: w.speaker ?? null,
      emphasis: +Math.min(1, emphasis).toFixed(3),
      repeat: key === prevKey && !!key,
      forceBreak: !!w.break,
      forceHero: !!w.hero,
    };
  });

  // 1b. data graphics + hand-drawn notes (Claude's notes replace the "not X but Y" rule)
  // a viz set in the transcript wins, then Claude's charts, then what the words say on their own
  const annChart = new Map((ann?.charts || []).map(({ i, ...c }) => [i, {
    kind: c.kind, value: c.value, ...(c.base != null && { base: c.base }), ...(c.parts?.length && { parts: c.parts }),
    ...(c.focus != null && { focus: c.focus }), ...(c.label && { label: c.label }), ...(c.unit && { unit: c.unit }),
  }]));
  const vizAt = detectViz(words.map((w, i) => ({ ...w, viz: rawWords[i].viz !== undefined ? rawWords[i].viz : annChart.get(i) })));
  const annNotes = ann?.notes ? new Map(ann.notes.map((n) => [n.i, n.kind])) : null;
  const noteAt = annNotes || detectNotes(words);
  // a question rejects nothing ("didn't quality drop?" is a worry, not a correction):
  // automatic strikes never land inside one
  const inQuestion = (i) => {
    for (let k = i; k < words.length; k++) if (/[.!?…]/.test(words[k].punct)) return words[k].punct.includes("?");
    return false;
  };
  for (const w of words) {
    w.viz = vizAt.get(w.i) || null;
    const forced = rawWords[w.i].note !== undefined;
    let note = forced ? rawWords[w.i].note : noteAt.get(w.i);
    if (note === "strike" && !forced && inQuestion(w.i)) note = null;
    w.note = ["circle", "underline", "strike"].includes(note) && !w.viz ? note : null;
  }
  const listRun = detectLists(words);

  // 1c. effect budget. Every visual accent loses force when the next one is right behind it,
  // and long conversations would otherwise light up every other second. Per preset, accents
  // keep a minimum distance; the strongest words win, the rest are set plainly.
  // Hand-set overrides in the transcript are never removed.
  const B = P.budget;
  const priority = (w) => w.emphasis + (w.forceHero ? 1 : 0) + (w.mark ? 0.15 : 0) + (w.num ? 0.3 : 0) + (w.viz ? 0.3 : 0);
  const thin = (pick, gap, drop) => {
    const kept = [];
    for (const w of words.filter(pick).sort((a, b) => priority(b) - priority(a) || a.start - b.start)) {
      if (kept.every((k) => Math.abs(k.start - w.start) >= gap)) kept.push(w);
      else drop(w);
    }
  };
  for (const w of words) w.tone = w.concept; // the mood still follows every image, only the effect is thinned
  thin((w) => w.concept && rawWords[w.i].concept === undefined && rawWords[w.i].fx === undefined, B.fx,
    (w) => { w.concept = null; w.fx = w.num ? "count" : null; });
  thin((w) => w.note && rawWords[w.i].note === undefined, B.note, (w) => { w.note = null; });
  if (B.mark) thin((w) => w.mark, B.mark, (w) => { w.mark = false; });

  // 2. phrase segmentation (heuristic, unless Claude staged the phrases)
  const phrases = [];
  if (ann) for (const p of ann.phrases) phrases.push(words.slice(p.first, p.last + 1));
  let cur = [];
  const flush = () => { if (cur.length) phrases.push(cur); cur = []; };
  for (let i = 0; i < (ann ? 0 : words.length); i++) {
    const w = words[i];
    const prev = cur[cur.length - 1];
    if (prev) {
      const gap = w.start - prev.end;
      const chars = cur.reduce((n, x) => n + x.display.length + 1, 0) + w.display.length;
      const sentenceEnd = /[.!?;:…]/.test(prev.punct);
      const comma = /[,—–-]/.test(prev.punct);
      const inList = listRun.has(prev.i) && listRun.has(w.i);
      let brk = prev.forceBreak || sentenceEnd || gap > 0.55 || (comma && cur.length >= 2 && !inList) || (gap > 0.32 && cur.length >= 2 && !inList);
      if (!brk && !inList && (cur.length >= maxWords || chars > maxChars)) {
        brk = true;
        // never leave a dangling function word at the end of a phrase
        if (prev.role === "fn" && cur.length > 1) { cur.pop(); flush(); cur.push(prev); cur.push(w); continue; }
      }
      // a repeated word ("higher, higher") gets its own beat; clause openers start a new one
      if (w.repeat) brk = true;
      if (CLAUSE_OPENERS.has(w.key) && cur.length >= 2 && !inList) brk = true;
      if (listRun.has(w.i) && !listRun.has(prev.i) && cur.length) brk = true; // a list starts its own lockup
      if (listRun.has(prev.i) && !listRun.has(w.i)) brk = true;
      if (w.speaker !== prev.speaker) brk = true; // never mix two voices in one lockup
      if (brk) flush();
    }
    cur.push(w);
  }
  flush();

  // 3a. trailing function words ("into the", "falling like") belong to the next phrase
  for (let p = 0; p < (ann ? 0 : phrases.length - 1); p++) {
    const ph = phrases[p];
    while (ph.length > 1 && ph[ph.length - 1].role === "fn" && !/[.!?;:,…]/.test(ph[ph.length - 1].punct)
      && phrases[p + 1].length < maxWords + 1 && ph[ph.length - 1].speaker === phrases[p + 1][0].speaker) {
      phrases[p + 1].unshift(ph.pop());
    }
  }

  // 3b. merge orphans: a single function word phrase joins its neighbour
  for (let p = 0; p < (ann ? 0 : phrases.length); p++) {
    const ph = phrases[p];
    if (ph.length === 1 && ph[0].role === "fn" && phrases[p + 1] && phrases[p + 1][0].speaker === ph[0].speaker) {
      phrases[p + 1].unshift(...ph);
      phrases.splice(p, 1);
      p--;
    }
  }

  // 3c. quote moments: the payoff sentence Claude picked stays together as one lockup,
  // however the phrasing around it was cut
  const aps = ann ? ann.phrases.map((p) => ({ ...p })) : phrases.map(() => null);
  for (const q of ann?.quotes || []) {
    const qa = q.first, qb = q.last;
    if (qb < qa || qb - qa > 15 || words[qb].end - words[qa].start > 7) continue;
    if (words.slice(qa, qb + 1).some((w) => w.speaker !== words[qa].speaker)) continue;
    const at = phrases.findIndex((pw) => pw[pw.length - 1].i >= qa);
    const bt = phrases.findIndex((pw) => pw[pw.length - 1].i >= qb);
    if (at < 0 || bt < 0) continue;
    const before = phrases[at].filter((w) => w.i < qa), after = phrases[bt].filter((w) => w.i > qb);
    const src = aps.slice(at, bt + 1).filter(Boolean);
    const qw = words.slice(qa, qb + 1);
    const heroW = [...qw].filter((w) => w.role === "content").sort((x, y) => y.emphasis - x.emphasis)[0];
    const qap = ann ? { ...(src[0] || {}), hero: heroW ? heroW.i : null, layout: "quote", exit: "blur",
      minor: src.flatMap((a) => a.minor || []).filter((i) => i >= qa && i <= qb) } : null;
    const keep = (pw, ap) => (pw.length ? [[pw, ap && { ...ap, hero: pw.some((w) => w.i === ap.hero) ? ap.hero : null }]] : []);
    const repl = [...keep(before, aps[at]), [qw, qap], ...keep(after, aps[bt])];
    phrases.splice(at, bt - at + 1, ...repl.map((r) => r[0]));
    aps.splice(at, bt - at + 1, ...repl.map((r) => r[1]));
    for (const w of qw) w.quote = true;
  }

  // 3d. read time: a lockup that would flash by (fast talkers: "okay and", "how to rank")
  // joins the neighbour of the same voice it is closest to, so every lockup can be read
  const MIN_READ = P.minRead;
  const span = (pw) => pw[pw.length - 1].end - pw[0].start;
  const special = (pw) => pw[0].quote || pw.every((w) => listRun.has(w.i));
  const mergeAp = (a, b, wa, wb) => {
    if (!a && !b) return null;
    const pa = a || b, pb = b || a;
    const hs = [pa.hero, pb.hero].filter((h) => h != null).sort((x, y) => words[y].emphasis - words[x].emphasis);
    const big = wa.length >= wb.length ? pa : pb;
    return { ...big, hero: hs[0] ?? null, minor: [...(pa.minor || []), ...(pb.minor || [])],
      layout: big.layout === "list" || big.layout === "quote" ? "block" : big.layout, exit: pb.exit };
  };
  // a neighbour can take the short one if the result stays a readable size; when no neighbour
  // fits that way, a slightly longer lockup beats one that flashes by
  const canTake = (o, pw, k, q, extra) => {
    if (!o || special(o) || o[0].speaker !== pw[0].speaker || o.length + pw.length > maxWords + extra) return false;
    // a mower phrase stays as staged: its mowers are planned for exactly its words
    if ((aps[k]?.exit === "mow") !== (aps[q]?.exit === "mow")) return false;
    return (q < k ? pw[0].start - o[o.length - 1].end : o[0].start - pw[pw.length - 1].end) < 0.8;
  };
  const takers = (k) => {
    const pw = phrases[k], qs = [k - 1, k + 1];
    const near = qs.filter((q) => canTake(phrases[q], pw, k, q, 3));
    return near.length ? near : qs.filter((q) => canTake(phrases[q], pw, k, q, 5));
  };
  for (let guard = 0; guard < 500; guard++) {
    const p = phrases.findIndex((pw, k) => span(pw) + 0.35 < MIN_READ && !special(pw) && takers(k).length);
    if (p < 0) break;
    const pw = phrases[p];
    const opts2 = takers(p);
    // closest neighbour; on a tie the shorter one, so lockups stay balanced
    const gapTo = (q) => (q < p ? pw[0].start - phrases[q][phrases[q].length - 1].end : phrases[q][0].start - pw[pw.length - 1].end);
    const q = opts2.sort((x, y) => gapTo(x) - gapTo(y) || phrases[x].length - phrases[y].length)[0];
    const [a, b] = q < p ? [q, p] : [p, q];
    aps.splice(a, 2, mergeAp(aps[a], aps[b], phrases[a], phrases[b]));
    phrases.splice(a, 2, phrases[a].concat(phrases[b]));
  }

  const lastEnd = words.length ? words[words.length - 1].end : 3;
  // a call-to-action card needs its own moment after the last word
  const cta = opts.cta || opts.handle ? { text: opts.cta || "", handle: opts.handle || "", start: +(lastEnd + 0.45).toFixed(2) } : null;
  const duration = +(lastEnd + Math.max(tail, cta ? 2.8 : 0)).toFixed(2);

  // 4. phrase descriptors
  let lastLayout = "";
  // without a staging, a phrase whose words say burning, collapsing or mowing exits that way,
  // each of these at most once per video
  const usedExit = new Set();
  const exitFor = (pw) => {
    const e = pw.map((w) => exitOf(w.key)).find(Boolean);
    if (!e || usedExit.has(e)) return null;
    usedExit.add(e);
    return e;
  };
  const out = phrases.map((pw, pi) => {
    const next = phrases[pi + 1];
    const start = pw[0].start;
    const end = pw[pw.length - 1].end;
    const tIn = Math.max(0, start - 0.14);
    const tOut = next ? Math.max(end + 0.05, Math.min(next[0].start - 0.12, end + 1.6)) : cta ? cta.start - 0.05 : duration - 0.5;
    const content = pw.filter((w) => w.role === "content");
    // hero = the strongest content word if it stands out enough
    const ap = aps[pi];
    let hero = pw.find((w) => w.forceHero) || (ap && ap.hero != null ? words[ap.hero] : null);
    if (!hero && !ap && content.length) {
      const sorted = [...content].sort((a, b) => b.emphasis - a.emphasis || b.end - b.start - (a.end - a.start));
      if (sorted[0].emphasis >= 0.5 || content.length === 1) hero = sorted[0];
    }
    if (hero) hero.hero = true;
    const concepts = [...new Set(pw.map((w) => w.concept).filter(Boolean))];
    const tones = [...new Set(pw.map((w) => w.tone).filter(Boolean))];
    const h = hash(pw.map((w) => w.key).join(" ") + seed);
    let layout;
    if (pw.length === 1 || content.length === 1 && pw.length <= 3) layout = "hero";
    else if (pw.length >= 5 && !portrait) layout = pick(P.layouts.long, h);
    else layout = pick(portrait ? P.layouts.tall : P.layouts.wide, h);
    if (layout === lastLayout && layout !== "hero") layout = layout === "block" ? "cascade" : "block";
    if (ap) layout = hero || ap.layout !== "hero" ? ap.layout : "block";
    if (layout === "split" && content.length < 2) layout = "block";
    // enumerations become a checklist: when the staging asks for it, or, without a staging, when
    // one is detected (a staging that chose another layout knows better: "sag ich, okay, stopp")
    const items = listItems(pw);
    if (items && (ap ? ap.layout === "list" : pw.every((w) => listRun.has(w.i)))) layout = "list";
    else if (layout === "list") layout = "block";
    // tall frames: a sentence-long phrase in one or two lines ends up small – stacked, it fills the frame
    if (portrait && layout === "inline" && pw.length >= 5) layout = "block";
    if (pw[0].quote) layout = "quote";
    else if (layout === "quote") layout = "block";
    lastLayout = layout;
    // one data graphic per phrase: the first number that has one
    const VIZ_RANK = { growth: 0, split: 0, gauge: 0, compare: 0, clock: 1, units: 1 };
    const vizWord = pw.filter((w) => w.viz).sort((a, b) => (VIZ_RANK[a.viz.kind] ?? 0) - (VIZ_RANK[b.viz.kind] ?? 0))[0];
    // a graphic that shows words of its own (versus, cause, steps …) is the accent of its phrase:
    // the line above it is set calm – no hero, no word effect, no note, no marker, no concept –
    // or the same word would stand out twice
    const calm = !!vizWord && TEXT_GRAPHICS.has(vizWord.viz.kind);
    if (calm) {
      for (const w of pw) Object.assign(w, { hero: false, fx: null, note: null, mark: false, concept: null });
      hero = null;
      concepts.length = 0;
      if (layout === "hero") layout = pw.length <= 4 ? "inline" : "block";
    }
    const mood = ap ? ap.mood : tones.length ? MOOD_OF[tones[0]] : null;
    return {
      id: `p${pi}`, index: pi, start: +start.toFixed(3), end: +end.toFixed(3),
      tIn: +tIn.toFixed(3), tOut: +tOut.toFixed(3),
      layout, align: pick(["center", "left", "center", "right"], h >> 3),
      tilt: +((((h >> 7) % 9) - 4) * 0.6 * P.tilt).toFixed(2),
      enter: pick(P.enter, h >> 11),
      exit: ap ? ap.exit : exitFor(pw) ?? pick(P.exits, h >>> 13),
      speaker: pw[0].speaker,
      hero: hero ? hero.i : null, mood, concepts,
      viz: vizWord ? vizWord.i : null, items: layout === "list" ? items : null, ...(calm && { calm: true }),
      words: pw.map((w) => w.i),
    };
  });

  // 5. mood track: carry the last mood forward, start neutral
  const moodTrack = [];
  let curMood = "night";
  for (const p of out) {
    if (p.mood && p.mood !== curMood) curMood = p.mood;
    if (!moodTrack.length || moodTrack[moodTrack.length - 1].mood !== curMood) moodTrack.push({ t: p.tIn, mood: curMood });
    p.mood = curMood;
  }
  if (!moodTrack.length) moodTrack.push({ t: 0, mood: curMood });

  const lockups = out;

  // 6. motif events (for the 3D world): one per concept word, sustained to phrase end
  const events = [];
  for (const p of lockups) {
    for (const wi of p.words) {
      const w = words[wi];
      if (!w.concept) continue;
      const motif = CONCEPTS[w.concept].motif;
      events.push({
        motif, concept: w.concept, word: wi,
        t0: +w.start.toFixed(3), t1: +Math.max(w.end + 0.6, p.tOut).toFixed(3),
        strength: +((0.55 + w.emphasis * 0.45) * P.world).toFixed(3),
      });
    }
  }

  // 7. onsets (rhythm): every word start with weight, used for pulses / camera kicks
  const onsets = words.map((w) => ({ t: w.start, w: +(0.25 + w.emphasis * 0.75).toFixed(3) }));

  // 8. speakers (podcast): stable order of first appearance, names from --speakers
  const speakers = [];
  // world: explicit > Claude's choice > preset default
  let world = WORLD_NAMES.includes(opts.world) ? opts.world : WORLD_NAMES.includes(ann?.world) ? ann.world : DEFAULT_WORLD[presetName] || "cosmos";
  // over footage a dark world adds its light to the picture; a light one puts the picture
  // into a frame on its ground (build.mjs, plan.video.frame)
  const spkColors = LIGHT_WORLDS.has(world) ? SPEAKER_COLORS_LIGHT : SPEAKER_COLORS;
  for (const w of words) {
    if (w.speaker == null || speakers.some((s) => s.id === w.speaker)) continue;
    const k = speakers.length;
    const own = opts.speakerColors?.[w.speaker];
    speakers.push({ id: w.speaker, name: opts.speakerNames?.[w.speaker] ?? String(w.speaker), color: /^#[0-9a-f]{3,8}$/i.test(own || "") ? own : spkColors[k % spkColors.length] });
  }
  const turns = [];
  for (const p of out) if (p.speaker != null && (!turns.length || turns[turns.length - 1].speaker !== p.speaker)) turns.push({ t: p.tIn, speaker: p.speaker });
  // voices without names: an "A" / "B" chip tells the viewer nothing – the colours alone carry the turns
  if (!speakers.some((s) => opts.speakerNames?.[s.id] != null)) turns.length = 0;

  return {
    version: 2, title, subtitle: opts.subtitle || "", width, height, duration, seed, portrait, square,
    lang: opts.lang || detectLang(rawWords),
    preset: PRESETS[presetName] ? presetName : "lyric", world,
    style: { world: P.world, drift: P.drift, marker: P.marker, audiogram: opts.audiogram ?? P.audiogram },
    hook: opts.hook || ann?.hook || "",
    cta, speakers, turns,
    staging: ann ? `claude (${ann.model})` : "lexicon",
    words, phrases: lockups, moodTrack, events, onsets,
  };
}
