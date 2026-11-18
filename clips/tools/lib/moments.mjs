// What `episode.mjs moments` does around the model's answer, without a model: the limit a
// passage is held against, what goes when its marked sentences are dropped, and the list as
// moments.json holds it. All of it from the sentences: their words, voices and times.
//
//   arrange(answer, sentences, { limit })   → the moments of moments.json from the model's answer, by `opens`
//   shape(m, first, last, sentences, limit) → one moment of moments.json over first..last
//   questionStart(sentences, first, floor)  → the question just before a moment that its first sentence answers
//   checks(sentences, first, last, limit)   → { question, conjunction, voices, over } (arrange adds `asked`)
//   dropSpans(sentences, first, last, drop) → [[from, to], …] in the episode's seconds
//   keepsWithout(words, said, spans)        → the word ranges of a cut clip that stay
//   numbers("229-234,240") / ranges([…])    → [229, …, 234, 240] and back
//   momentsPrompt(episode, text, count, limit) → what the model is asked
//   listing(moments.json, sentences, pieces) → the list `moments` prints

// an exchange: a quick back-and-forth with a laugh, where the change of voices is the point
export const KINDS = ["claim", "story", "number", "mistake", "how-to", "answer", "exchange"];
// 59 s fits every post type Storrito offers (an Instagram Story takes 60 s)
export const MAX_SECONDS = 59;
// A whole passage may be this much longer than the limit and is still returned, to be shortened
// from the inside: the editors' passages of the first measurement ran to 98 s in the episode for
// shorts of about a minute (clips-eval, 2026-11-17).
export const longest = (limit) => Math.round(limit * 1.7);
// a question of another voice this many seconds before a moment's first sentence belongs to it
export const QUESTION_WITHIN = 15;

// words a sentence continues the one before with ("or then there's …", "und dann …")
const CONJUNCTIONS = new Set(["and", "or", "but", "so", "because", "cuz", "cause", "nor", "plus", "then", "also",
  "und", "oder", "aber", "denn", "weil", "sondern", "doch", "dann", "sowie"]);
const firstWord = (text) => (String(text).toLowerCase().match(/[\p{L}]+/u) || [""])[0];
const mmss = (t) => {
  const s = Math.max(0, Math.floor(t)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
};
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

// The question a moment's first sentence answers. Looking back from the first sentence over what
// its own voice said before it (the answer so far) and at most two "mhm"s of another voice: when
// the next thing another voice said is a question that ends within 15 s before the first
// sentence, the sentence where that question begins, with what its asker says in those 15 s to
// set it up ("So in Gonzo Girl you play …" before "What kind of value …?"); else `first`. It is
// a note for the agent, not a move: starting there took the editors' start away in every case
// it touched in the second measurement (they began at the answer), and a wider rule (any
// question within 15 s, a step back from every conjunction) did worse still in the first.
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

// How well a moment's first sentence works on someone who has seen nothing of the episode, as the
// model rates it, 1 to 10. It is the one judgement of the old score that ordered anything: main's
// score was in effect 8 plus "cold" (clips-eval, 2026-11-17).
const opensOf = (m) => Math.max(1, Math.min(10, Math.round(Number(m.opens) || 1)));

// The moments of moments.json from the model's answer, ordered by `opens` (higher first; on the
// same rating, as the model listed them), `rank` 1, 2, … with no two the same: whole sentences
// that exist, at most longest(limit) seconds (the end trimmed sentence by sentence, as rarely as
// the model returns more), overlapping no moment ranked before it. `drop` stays only inside a
// moment that is over the limit and never holds its payoff; `kept` is its length without those
// sentences; `checks` what the tool counts about it (see checks above). The tool moves no start:
// a question just before the first sentence that it answers is only noted (`checks.asked`): a
// rule that moved the start there took covered starts away from the editors' (clips-eval).
export function arrange(answer, sentences, { limit = MAX_SECONDS } = {}) {
  const taken = new Set();
  const listed = (Array.isArray(answer.moments) ? answer.moments : []).map((m, k) => ({ m, k }))
    .sort((a, b) => opensOf(b.m) - opensOf(a.m) || a.k - b.k).map(({ m }) => m);
  return listed.flatMap((m) => {
    const first = Math.max(0, Math.round(Number(m.first)));
    let last = Math.min(sentences.length - 1, Math.round(Number(m.last)));
    if (!(first <= last)) return [];
    for (let k = first; k <= last; k++) if (taken.has(k)) return [];
    let floor = first;
    while (floor > 0 && !taken.has(floor - 1)) floor--;
    const q = questionStart(sentences, first, floor);
    while (last > first && sentences[last].end - sentences[first].start > longest(limit)) last--;
    if (sentences[last].end - sentences[first].start > longest(limit)) return [];
    for (let k = first; k <= last; k++) taken.add(k);
    return [shape(m, first, last, sentences, limit, { asked: q !== first ? q : null, opens: opensOf(m) })];
  }).map((m, k) => ({ rank: k + 1, ...m }));
}

// One moment of moments.json over the sentences first..last, from what the model said about it
// (`m`): its drop and payoff kept where they still fit, its length, its checks
export function shape(m, first, last, sentences, limit, more = {}) {
  const s0 = sentences[first], s1 = sentences[last], seconds = Math.round(s1.end - s0.start);
  const payoff = Number.isInteger(m.payoff) && m.payoff >= first && m.payoff <= last ? m.payoff : null;
  const drop = seconds > limit
    ? [...new Set((Array.isArray(m.drop) ? m.drop : []).filter((k) => Number.isInteger(k) && k > first && k < last && k !== payoff))].sort((a, b) => a - b)
    : [];
  const gone = dropSpans(sentences, first, last, drop).reduce((a, [from, to]) => a + to - from, 0);
  const { asked = m.checks?.asked ?? null, opens = m.opens, ...rest } = more;
  return {
    first, last, kind: KINDS.includes(m.kind) ? m.kind : "claim", title: m.title || "", why: m.why || "",
    opens, payoff, hook: m.hook || "", crosstalk: !!m.crosstalk, drop,
    start: +s0.start.toFixed(1), end: +s1.end.toFixed(1), seconds, kept: Math.round(s1.end - s0.start - gone),
    checks: { ...checks(sentences, first, last, limit), asked: asked != null && asked < first ? asked : null },
    ...rest,
  };
}

// The transcript comes first and the task after it: a second run on the same episode (another
// --max-seconds, another --count) then reads the transcript from the provider's cache.
export function momentsPrompt(episode, text, count, limit) {
  const cap = longest(limit);
  const description = String(episode.description || "").trim();
  return `${text}
That was the transcript of "${episode.title}" (${episode.channel || "a podcast"}), one numbered sentence a line:
\`<number> [<from>–<to>] <voice>: <words>\`.${description ? `
The video's description, as the channel's followers see it:
"""
${description}
"""` : ""}
Pick the ${count} best moments for vertical shorts of this channel (Reels, TikTok, YouTube Shorts) and ${Math.ceil(count / 2)} more as fillers.

First count what the episode holds, every usable piece once: claims (a clear position, best against the usual advice), stories (a moment with a turn: a problem, a decision, what happened), numbers (a result, a before and after, a price, a time), mistakes (what went wrong and what was learned), how-tos (steps or one move the viewer can apply), answers (a question the audience asks, answered; also one its followers are curious about, how someone lives or works or what a thing is, without a punchline), exchanges (a quick back-and-forth with a laugh: teasing, a joke two people build, a reaction to what is in front of them).

A moment is one whole passage of the episode, a range of whole sentences, first..last, cut straight from it: the whole arc, not its core. It is one of the pieces above (its kind).
- Where it starts: at the sentence that opens the passage. An answer begins at its question, with the sentence or two its asker needs to set the question up; never at the answer alone, and never at the punchline without what leads up to it. A story or a claim nobody asked for begins at its own first sentence; an exchange at the line that sets it off. A first sentence that only goes on from the one before ("or then there's …", "and that is why …") is no start: go back to where that thought begins.
- One topic: a follow-up question on the same subject belongs to the passage; a question that opens another subject ends it before that question.
- Where it ends: after its last conclusion, when the talk turns to something else: after the lesson that follows the story, the second beat that tops the punchline, the last point of the answer, the laugh that closes the exchange. Not after the first finished thought and not after the first laugh, when the speaker goes on to say what it means or adds the line that lands.
- payoff: the number of the one sentence in it that carries its strongest line (the punchline, the number, the confession, the sentence one would quote); an editor may open the short with it.

A short may be up to ${limit} seconds here. A whole passage takes what it takes, from 15 seconds up; most take 30 to ${limit}. Never cut a passage down to make it fit: when the whole arc is longer than ${limit} seconds (up to ${cap}), return it whole and list in drop the numbers of the sentences inside it that an editor would cut out to bring it to ${limit} seconds or under: an aside, a repetition, a second example, a detour, people talking at once; never its first or last sentence, the question, a step the story needs or the payoff. For an arc of ${limit} seconds or less, drop is empty. A passage that needs more than ${cap} seconds is no moment: it belongs to the ideas below.

A moment stands alone for this channel's own followers: they know the host, the show and its format, and everyone the title or the description names, so such a name needs no introduction. It must lean on nothing else said in the episode: no "as I said earlier", "that story", "in this episode", no "he", "it" or "this" from before the moment. A host's question followed by the answer is fine.
An exchange changes voices every few seconds: that is what it is, not a fault. Set crosstalk true only where people talk over each other so that words are lost.
When the first sentence of a moment does not hook on its own in its first three seconds (it opens on small talk, "so", "yeah", or a set-up that only pays off later), keep it and write a hook for the screen: 6 words or fewer, in the episode's language, that says what the viewer gets ("Daily posting nearly killed my channel"), never a label like "NEW" or "TIP"; else hook is "".

opens: how well the moment's first sentence works on someone who has seen nothing of the episode, 1 to 10, judged on that alone: 10 makes anyone scrolling past stop and makes sense by itself (a question, a surprising claim, a vivid image, a number, a line that gets a laugh); 5 is fine but plain; 1 needs what came before or opens on small talk. Use the whole scale; two moments rarely open equally well.

List the moments best first; they do not overlap. For each: first and last sentence number, its kind, a title of 3–7 words in the episode's language, why it works in one sentence in the episode's language, opens, payoff, drop, the hook, crosstalk.

Last, the ideas too spread out to clip (a point made in three places, a story told slowly, with the parts far apart): up to five, each with a title in the episode's language, the numbers of the sentences that carry it, and why it would be worth recording anew as a short of its own, in one sentence.`;
}

// What the checks say about a moment, for the list: only what needs a look
export function checkNotes(m, limit) {
  const c = m.checks || {};
  return [
    c.question ? "opens with a question" : null,
    c.asked != null ? `answers the question at sentence ${c.asked} just before it: start there when the question belongs to it` : null,
    c.conjunction ? "opens on a conjunction in the middle of a turn: read the sentence before it" : null,
    c.voices > 1 ? `${c.voices} voices` : null,
    c.over ? `${c.over} s over the ${limit}: ` + (m.drop.length ? `${m.kept} s without the sentences ${ranges(m.drop)}` : "no sentence marked to drop") : null,
  ].filter(Boolean).join("; ");
}

// The list moments prints: what is inside, the moments best first (the first `count` the picks,
// the rest fillers), the ideas to record anew
export function listing({ limit, count, inventory, moments: picked, ideas }, sentences, pieces) {
  const lines = [`Inside: ${KINDS.map((k) => `${inventory[k] || 0} ${k === "how-to" ? "how-tos" : k === "story" ? "stories" : k + "s"}`).join(", ")}`
    + (pieces < 4 ? ` — too thin for many clips: say so, and offer the one or two it gives.` : "")];
  picked.forEach((m, k) => {
    if (k === count && picked.length > count) lines.push(`Fillers, weaker than the ${count} above:`);
    const notes = checkNotes(m, limit);
    lines.push(`${m.rank}. ${m.first}-${m.last} [${mmss(m.start)}, ${m.seconds} s] opens ${m.opens}/10 · ${m.kind}${m.crosstalk ? ", crosstalk" : ""} · ${m.title}`
      + (notes ? `\n   ${notes}` : "")
      + `\n   „${sentences[m.first].text}“\n   ${m.why}`
      + (m.payoff != null ? `\n   strongest line (${m.payoff}): „${sentences[m.payoff].text}“` : "") + (m.hook ? `\n   hook on screen: „${m.hook}“` : ""));
  });
  if (ideas.length) lines.push(`Too spread out to clip, worth recording anew:\n${ideas.map((d) => `- ${d.title} (${d.at.slice(0, 4).join(", ")}${d.at.length > 4 ? " …" : ""}): ${d.why}`).join("\n")}`);
  return lines.join("\n");
}
