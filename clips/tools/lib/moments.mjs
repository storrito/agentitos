// What `episode.mjs moments` does around the model's answer, without a model: the limit a
// passage is held against, what goes when its marked sentences are dropped, and the list as
// moments.json holds it. All of it from the sentences: their words, voices and times.
//
//   arrange(answer, sentences, { limit })   → the moments of moments.json from the model's answer
//   questionStart(sentences, first, floor)  → the sentence a moment starts at: an answer at its question
//   checks(sentences, first, last, limit)   → { question, conjunction, voices, over }
//   dropSpans(sentences, first, last, drop) → [[from, to], …] in the episode's seconds
//   keepsWithout(words, said, spans)        → the word ranges of a cut clip that stay
//   numbers("229-234,240") / ranges([…])    → [229, …, 234, 240] and back

export const KINDS = ["claim", "story", "number", "mistake", "how-to", "answer"];
// 59 s fits every post type Storrito offers (an Instagram Story takes 60 s)
export const MAX_SECONDS = 59;
// A whole passage may be this much longer than the limit and is still returned, to be shortened
// from the inside: the editors' passages of the first measurement ran to 98 s in the episode for
// shorts of about a minute (clips-eval, 2026-11-17).
export const longest = (limit) => Math.round(limit * 1.7);
// a moment under KEEP of 10 is listed as weak
export const KEEP = 7;

const point = (v) => Math.max(0, Math.min(2, Math.round(Number(v) || 0)));
// 2 from 20 s, 1 from 15 s
const lengthPoint = (s) => (s >= 20 ? 2 : s >= 15 ? 1 : 0);

// a question of another voice this many seconds before a moment's first sentence belongs to it
export const QUESTION_WITHIN = 15;

// words a sentence continues the one before with ("or then there's …", "und dann …")
const CONJUNCTIONS = new Set(["and", "or", "but", "so", "because", "cuz", "cause", "nor", "plus", "then", "also",
  "und", "oder", "aber", "denn", "weil", "sondern", "doch", "dann", "sowie"]);
const firstWord = (text) => (String(text).toLowerCase().match(/[\p{L}]+/u) || [""])[0];
export const isQuestion = (s) => /\?["”“'’)\]]*\s*$/.test(s.text);
const sameVoice = (a, b) => (a.speaker ?? null) === (b.speaker ?? null);
// a "mhm", a "yeah", a laugh: under 1.5 s it takes no turn (the framing moves on none either)
const brief = (s) => s.end - s.start < 1.5;

// A first sentence that opens with a conjunction and goes on in its voice's turn (the sentence
// before it is the same voice's, less than 3 s earlier) starts in the middle of a thought. At
// the start of a turn the same words open it: the editors' own shorts begin "So in Gonzo Girl
// you play …", "Aber es gibt ja auch Vorwürfe …" (7 of 27 in the first measurement).
export function continues(sentences, k) {
  if (k < 1 || !CONJUNCTIONS.has(firstWord(sentences[k].text))) return false;
  let p = k - 1;
  while (p > 0 && !sameVoice(sentences[p], sentences[k]) && brief(sentences[p])) p--;
  return sameVoice(sentences[p], sentences[k]) && sentences[k].start - sentences[p].end <= 3;
}

// An answer begins at its question. Looking back from the first sentence over what its own
// voice said before it (the answer so far) and at most two "mhm"s of another voice: when the
// next thing another voice said is a question that ends within 15 s before the first sentence,
// the moment starts at that question, with what its asker says in those 15 s to set it up ("So
// in Gonzo Girl you play …" before "What kind of value …?"). A question further back, or one
// with a remark after it, is the model's to find: a wider rule (any question within 15 s, and a
// step back from every conjunction) moved a third of the starts of the first measurement's
// answers, more of them away from the editors' starts than towards them.
// Without voices (YouTube's captions) nobody is known to ask: the start stays. Never below
// `floor` (a sentence another moment holds).
export function questionStart(sentences, first, floor = 0) {
  const s0 = sentences[first];
  if (s0.speaker == null || isQuestion(s0)) return first;
  const near = (s) => s0.start - s.end <= QUESTION_WITHIN;
  let q = first - 1;
  for (let asides = 0; q >= floor && near(sentences[q]); q--) {
    if (sentences[q].speaker === s0.speaker) continue;
    if (!brief(sentences[q]) || ++asides > 2) break;
  }
  if (q < floor || !near(sentences[q])) return first;
  const asked = sentences[q];
  if (asked.speaker == null || asked.speaker === s0.speaker || brief(asked) || !isQuestion(asked)) return first;
  const question = q;
  while (q - 1 >= floor && sentences[q - 1].speaker === asked.speaker && near(sentences[q - 1])
    && sentences[q].start - sentences[q - 1].end <= 2) q--;
  while (q < question && brief(sentences[q])) q++;
  return q;
}

// What the tool can count about a moment: whether it opens with a question (in the first
// voice's first 15 s, before another voice takes a turn), whether it opens on a conjunction in
// the middle of a voice's turn, how many voices take a turn in it (1.5 s or more in all), and
// by how many seconds it is over the limit (0: it fits).
export function checks(sentences, first, last, limit = MAX_SECONDS) {
  const s0 = sentences[first];
  let question = false;
  for (let k = first; k <= last && sentences[k].start - s0.start <= 15; k++) {
    const s = sentences[k];
    if (!sameVoice(s, s0)) { if (brief(s)) continue; break; }
    if (isQuestion(s)) { question = true; break; }
  }
  const spoken = new Map();
  for (let k = first; k <= last; k++) {
    const s = sentences[k];
    if (s.speaker != null) spoken.set(s.speaker, (spoken.get(s.speaker) || 0) + (s.end - s.start));
  }
  const voices = [...spoken.values()].filter((t) => t >= 1.5).length;
  const seconds = Math.round(sentences[last].end - s0.start);
  return { question, conjunction: continues(sentences, first), voices, over: Math.max(0, seconds - limit) };
}

// "229-234,240" → [229, 230, …, 234, 240]; null when it is not sentence numbers
export function numbers(text) {
  const out = new Set();
  for (const part of String(text).split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m || Number(m[2] ?? m[1]) < Number(m[1])) return null;
    for (let k = Number(m[1]); k <= Number(m[2] ?? m[1]); k++) out.add(k);
  }
  return [...out].sort((a, b) => a - b);
}
// [229, 230, 231, 240] → "229-231,240"
export function ranges(list) {
  const out = [];
  for (const k of list) {
    const run = out.at(-1);
    if (run && run[1] === k - 1) run[1] = k; else out.push([k, k]);
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(",");
}

// The stretches of the episode that go when the sentences `drop` are cut out of first..last:
// each run of dropped sentences from where the last kept sentence before it ends (two voices
// overlap now and then) to where the next kept sentence starts. The first and the last sentence
// of a moment are never dropped: that would be another moment.
export function dropSpans(sentences, first, last, drop) {
  const gone = new Set(drop.filter((k) => k > first && k < last));
  const spans = [];
  let keptEnd = sentences[first].end;
  for (let k = first + 1; k <= last; k++) {
    if (!gone.has(k)) { keptEnd = Math.max(keptEnd, sentences[k].end); continue; }
    let b = k;
    while (gone.has(b + 1)) b++;
    const from = Math.max(sentences[k].start, keptEnd), to = sentences[b + 1].start;
    if (to - from > 0.05) spans.push([+from.toFixed(3), +to.toFixed(3)]);
    k = b;
  }
  return spans;
}

// The word ranges of a cut clip that stay when `spans` (seconds of the clip) are left out of
// the moment `said` ([from, to] in the clip): a word belongs where its middle lies. `words` are
// the spoken words of the clip as best-takes numbers them ({ i, start, end }).
// → { keeps: [[firstWord, lastWord], …], inside: the moment's words, left: how many words went }
export function keepsWithout(words, said, spans = []) {
  const mid = (w) => (w.start + w.end) / 2;
  const inside = words.filter((w) => mid(w) >= said[0] - 0.25 && mid(w) <= said[1] + 0.25);
  const keeps = [];
  let run = null, left = 0;
  for (const w of inside) {
    if (spans.some(([a, b]) => mid(w) >= a && mid(w) < b)) { left++; run = null; continue; }
    if (run) run[1] = w.i; else keeps.push((run = [w.i, w.i]));
  }
  return { keeps, inside, left };
}

// The moments of moments.json from the model's answer, best first: whole sentences that exist,
// an answer started at its question (`moved` says from where), at most longest(limit) seconds
// (the end trimmed sentence by sentence, as rarely as the model returns more), overlapping no
// moment before it in the model's list. `drop` stays only inside a moment that is over the
// limit and never holds its payoff; `kept` is its length without those sentences.
export function arrange(answer, sentences, { limit = MAX_SECONDS } = {}) {
  const taken = new Set();
  return (Array.isArray(answer.moments) ? answer.moments : []).flatMap((m) => {
    let first = Math.max(0, Math.round(Number(m.first))), last = Math.min(sentences.length - 1, Math.round(Number(m.last)));
    if (!(first <= last)) return [];
    for (let k = first; k <= last; k++) if (taken.has(k)) return [];
    const asked = first;
    let floor = first;
    while (floor > 0 && !taken.has(floor - 1)) floor--;
    first = questionStart(sentences, first, floor);
    while (last > first && sentences[last].end - sentences[first].start > longest(limit)) last--;
    if (sentences[last].end - sentences[first].start > longest(limit)) return [];
    for (let k = first; k <= last; k++) taken.add(k);
    const s0 = sentences[first], s1 = sentences[last], seconds = Math.round(s1.end - s0.start);
    const payoff = Number.isInteger(m.payoff) && m.payoff >= first && m.payoff <= last ? m.payoff : null;
    const drop = seconds > limit
      ? [...new Set((Array.isArray(m.drop) ? m.drop : []).filter((k) => Number.isInteger(k) && k > first && k < last && k !== payoff))].sort((a, b) => a - b)
      : [];
    const gone = dropSpans(sentences, first, last, drop).reduce((a, [from, to]) => a + to - from, 0);
    const points = { cold: point(m.cold), one: point(m.one), ends: point(m.ends), alone: point(m.alone), length: lengthPoint(seconds) };
    const score = Object.values(points).reduce((a, b) => a + b, 0);
    return [{
      first, last, kind: KINDS.includes(m.kind) ? m.kind : "claim", title: m.title || "", why: m.why || "",
      score, points, weak: score < KEEP, payoff, hook: m.hook || "", crosstalk: !!m.crosstalk, drop,
      start: +s0.start.toFixed(1), end: +s1.end.toFixed(1), seconds, kept: Math.round(s1.end - s0.start - gone),
      over: Math.max(0, seconds - limit),
      ...(first !== asked ? { moved: { from: asked, why: "question" } } : {}),
    }];
  }).sort((a, b) => b.score - a.score);
}
