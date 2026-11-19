// The names in an episode's words, spelled as the video's own page spells them. The speech model
// writes what it hears: "Reed" for Reade, "Werewolf" for the film Werwulf, "Kurosawa" for Curaçao.
// The page (title, description, chapters, tags, channel, its own uploaded captions) nearly always
// holds the right spelling. A model reads the page and the transcript once and lists the names and
// the places it finds misspelled; everything here, without a model, decides what happens to each:
// applied, proposed to the agent, or refused. A correction changes the spelling of words and keeps
// their times; it never rewrites what was said.
//
//   pageOf(info, ownWords)             → the page's facts kept in page.json (yt-dlp's -J answer)
//   pageSources(page)                  → [{ label, text }] in the order they are trusted
//   ownTokens(captionWords, words)     → what the video's own captions write that the transcript never does
//   fold(s) / soundKey(s) / sounds(a, b) → a word folded, its sound, how alike two sound (0–1)
//   onPage(to, sources)                → the label of the first source that writes `to`, or null
//   locate(words, sentence, written)   → [first, last] of the written words in the sentence, or null
//   entriesOf(answer, words, sentences, sources) → the list of names.json
//   applyNames(raw, entries)           → the words with every applied correction, times kept
//   clipFixes(clipWords, entries, from) → { fixes, found, missed }: best-takes' "fixes" for a cut clip
//   namesPrompt(page, sentences, own)  → what the model is asked
//   namesListing(j)                    → the list `names` prints

// how alike two spellings must sound for a correction to be applied by itself (Reed and Reade
// sound 0.75 alike, Werewolf and Werwulf 0.88), and below which one is refused as no sound-alike
// (it would change what was said, not how a name is spelled)
export const APPLY_SOUND = 0.75;
export const REFUSE_SOUND = 0.5;
export const NAMES_MODEL = "google/gemini-3.8-flash";

const mmss = (t) => {
  const s = Math.max(0, Math.floor(t)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
};

// ---------------------------------------------------------------- the page
const URL = /https?:\/\/\S+|www\.\S+/g;
export function pageOf(info, ownWords = null) {
  return {
    title: info.title || "", channel: info.channel || info.uploader || "",
    description: String(info.description || "").replace(URL, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
    chapters: (info.chapters || []).map((c) => c.title).filter(Boolean),
    tags: info.tags || [], creators: info.creators || [],
    own: ownWords,
  };
}

export function pageSources(page) {
  if (!page) return [];
  return [
    ["the title", page.title], ["the channel", page.channel], ["the description", page.description],
    ["the chapters", (page.chapters || []).join("\n")], ["the tags", (page.tags || []).join("\n")],
    ["the creators", (page.creators || []).join("\n")], ["its own captions", (page.own || []).join(" ")],
    ["the names you gave", (page.also || []).join("\n")],
  ].filter(([, text]) => String(text || "").trim()).map(([label, text]) => ({ label, text: String(text) }));
}

// a word without the punctuation around it: lead, core, trail ("“Reed,”" → “ Reed ,”)
export function parts(text) {
  const m = String(text).match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
  return m ? { lead: m[1], core: m[2], trail: m[3] } : { lead: "", core: String(text), trail: "" };
}
const core = (w) => parts(w.text ?? w).core;
const capital = (t) => /\p{Lu}/u.test(t) || /\p{N}/u.test(t);
const ends = (t) => /[.!?…]["”'’)\]»]*$/u.test(String(t));

// What the video's own captions write that the transcript never writes: capitalised words inside a
// sentence (a name there is spelled as the channel spells it), each once, at most `cap`
export function ownTokens(captionWords, words, cap = 300) {
  const heard = new Set(words.map((w) => core(w)));
  const out = new Set();
  captionWords.forEach((w, i) => {
    const c = core(w);
    if (!c || !capital(c) || c.length < 2 || heard.has(c)) return;
    if (i > 0 && ends(captionWords[i - 1].text ?? captionWords[i - 1])) return;
    out.add(c);
  });
  return [...out].slice(0, cap);
}

// ---------------------------------------------------------------- sound
// lower case, without accents (ç → c, ü → u, ß → ss), letters and digits only
export function fold(s) {
  return String(s).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/ß/g, "ss").replace(/æ/g, "ae").replace(/ø/g, "o").replace(/[^a-z0-9]/g, "");
}

// How a spelling sounds, roughly, in the languages people record in most: consonants that are
// spelled two ways made one (ph f, th t, ck k, c k or s, z s, w v f), voiced and voiceless
// together (b p, d t, g k), every run of vowels one vowel, no h, no doubles. Reed and Reade, Vitmann
// and Wittmann, Klugspiel and Glücksspiel come out the same or nearly; mother and Miller do too,
// which is why sound alone never makes an ordinary word a name (entriesOf).
export function soundKey(s) {
  // ç is an s (Curaçao), which folding would make a c
  let t = fold(String(s).replace(/ç/gi, "s"));
  t = t.replace(/sch/g, "s").replace(/sh/g, "s").replace(/ch/g, "k").replace(/ph/g, "f").replace(/th/g, "t")
    .replace(/ck/g, "k").replace(/qu/g, "kv").replace(/x/g, "ks").replace(/tz/g, "s")
    .replace(/c(?=[eiy])/g, "s").replace(/c/g, "k")
    .replace(/([aeiouy])w/g, "$1").replace(/w/g, "f").replace(/v/g, "f").replace(/b/g, "p").replace(/d/g, "t")
    .replace(/g/g, "k").replace(/z/g, "s").replace(/h/g, "")
    .replace(/[aeiouy]+/g, "a").replace(/(.)\1+/g, "$1");
  return t;
}

function lev(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const was = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = was;
    }
  }
  return d[b.length];
}
// how alike two spellings sound, 1 the same; words are joined (J Lo and JLaw)
export function sounds(a, b) {
  const x = soundKey(a), y = soundKey(b);
  if (!x && !y) return 1;
  return +(1 - lev(x, y) / Math.max(x.length, y.length)).toFixed(3);
}

// ---------------------------------------------------------------- the page writes it
const tokens = (text) => String(text).split(/\s+/).map((t) => parts(t).core).filter(Boolean);
// The first source that writes `to` as a run of its words (a hyphenated word also as its pieces:
// "Softswiss-Gründer" writes Softswiss), compared without regard to case, with the accents
export function onPage(to, sources) {
  const want = tokens(to).map((t) => t.toLowerCase());
  if (!want.length) return null;
  const label = writes(want, sources);
  if (label) return label;
  // a name with an ending the page does not write it with ("Werwulf's", "Wittmanns"): its stem
  const stem = want.at(-1).replace(/(['’]s|['’]|s)$/, "");
  return stem !== want.at(-1) && stem.length >= 3 ? writes([...want.slice(0, -1), stem], sources) : null;
}
function writes(want, sources) {
  for (const s of sources) {
    const have = tokens(s.text).flatMap((t) => [t, ...(t.includes("-") ? t.split("-") : [])]).map((t) => t.toLowerCase());
    const joined = ` ${have.join(" ")} `;
    if (joined.includes(` ${want.join(" ")} `)) return s.label;
    // "JLaw" written "J Law", "Da'Bomb" as "Da Bomb": the page's words joined
    const flat = want.join("").replace(/['’-]/g, "");
    for (let i = 0; i < have.length; i++) {
      let run = "";
      for (let k = i; k < Math.min(have.length, i + 3); k++) { run += have[k].replace(/['’-]/g, ""); if (run === flat) return s.label; }
    }
  }
  return null;
}

// ---------------------------------------------------------------- where in the words
// the written words in sentence k: [first, last] word numbers, compared without case or punctuation
export function locate(words, sentence, written) {
  const want = tokens(written).map(fold).filter(Boolean);
  if (!want.length || !sentence) return null;
  for (let i = sentence.first; i + want.length - 1 <= sentence.last; i++) {
    if (want.every((t, k) => fold(core(words[i + k])) === t)) return [i, i + want.length - 1];
  }
  return null;
}

// every run of the same words, spelled the same, elsewhere in the words
function repeats(words, first, last) {
  const want = words.slice(first, last + 1).map(core);
  const out = [];
  for (let i = 0; i + want.length <= words.length; i++) {
    if (i === first) continue;
    if (want.every((t, k) => core(words[i + k]) === t)) out.push([i, i + want.length - 1]);
  }
  return out;
}

// Whether the page writes `to` with the same two words before it or after it as the words at
// first..last have in the transcript (words of a letter or two do not count)
function samePhrase(words, first, last, to, sources) {
  const near = (from, step) => {
    const out = [];
    for (let i = from; out.length < 2 && i >= 0 && i < words.length; i += step) out.push(core(words[i]).toLowerCase());
    return out.length === 2 && out.every((t) => t.length >= 3) ? (step < 0 ? out.reverse() : out) : null;
  };
  const want = to.map((t) => t.toLowerCase()), before = near(first - 1, -1), after = near(last + 1, 1);
  return !!((before && writes([...before, ...want], sources)) || (after && writes([...want, ...after], sources)));
}

// The capitalised words right beside first..last that would make it part of a longer name: the same
// voice, nothing between (no comma, no full stop), not "I", and not the first word of a sentence
// unless `opening` (a sentence's first word has its capital anyway: counted only where a place is
// held against another, never to let one be applied). → { prev, next } (their cores, or null)
function beside(words, first, last, firsts, opening = false) {
  const cap = (i) => i >= 0 && i < words.length && words[i].speaker === words[first].speaker && /^\p{Lu}/u.test(core(words[i])) && !/^I(['’]|$)/.test(core(words[i]));
  const prev = first > 0 && !firsts.has(first) && !parts(words[first - 1].text).trail && cap(first - 1) && (opening || !firsts.has(first - 1)) ? core(words[first - 1]) : null;
  const next = !parts(words[last].text).trail && cap(last + 1) ? core(words[last + 1]) : null;
  return { prev, next };
}

// how often the words write these tokens in a row, spelled so
function written(words, want) {
  let n = 0;
  for (let i = 0; i + want.length <= words.length; i++) if (want.every((t, k) => core(words[i + k]) === t)) n++;
  return n;
}

const sentenceAt = (sentences, i) => {
  let lo = 0, hi = sentences.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (sentences[mid].first <= i) lo = mid; else hi = mid - 1; }
  return lo;
};

// A word is ordinary, not a name, when the transcript writes it in lower case here or anywhere
// else ("werewolf", "mother"): such a word is never made a name by itself
function ordinary(words, first, last, lower) {
  for (let i = first; i <= last; i++) {
    const c = core(words[i]);
    if (/^\p{Ll}/u.test(c)) return true;
  }
  return first === last && lower.has(core(words[first]).toLowerCase());
}

// ---------------------------------------------------------------- the list
// endings a correction may not take off or put on: that changes the word, not the name's spelling
const ENDING = /^('s|’s|'|s|n|en|e|es|er|ern)$/;

// The model's correction narrowed to what it changes: words at either end that stay the same are
// no part of it ("First We Feast I'm" → "First We Feast" is a word left out, not a spelling), nor
// are words whose case alone changes there ("HOT ONES HOT SAUCE" from a description in capitals),
// unless the case is all that changes. Word for word, each word is a correction of its own
// ("Andoran Tubik oder Kanaki": three names, "oder" stays). → [{ at: [first, last], to }]
function trim(words, a, b, to, same) {
  let i = a, j = b;
  while (i <= j && to.length && same(core(words[i]), to[0])) { i++; to = to.slice(1); }
  while (j >= i && to.length && same(core(words[j]), to.at(-1))) { j--; to = to.slice(0, -1); }
  return { i, j, to };
}
function narrowed(words, [a, b], right) {
  const exact = trim(words, a, b, tokens(right), (x, y) => x === y);
  const loose = trim(words, exact.i, exact.j, exact.to, (x, y) => x.toLowerCase() === y.toLowerCase());
  const { i, j, to } = loose.to.length || loose.j >= loose.i ? loose : exact;
  // fewer or more words, or the case alone: one correction
  if (to.length !== j - i + 1 || fold(words.slice(i, j + 1).map(core).join("")) === fold(to.join(""))) return [{ at: [i, j], to }];
  const out = [];
  for (let k = 0; k < to.length; k++) if (core(words[i + k]) !== to[k]) out.push({ at: [i + k, i + k], to: [to[k]] });
  // a piece that is no name ("aus'm Alter" → "aus Malta": the m went to Malta) keeps them together
  return out.every((p) => capital(p.to[0])) ? out : [{ at: [i, j], to }];
}

// Why a correction would change what was said, or null: these are refused
function rewrites(from, to) {
  if (!to.length) return "it leaves out words that were said";
  if (!from.length) return "it adds words that were not said";
  if (!from.some(capital) && !to.some(capital)) return "no name on either side: one ordinary word for another";
  if (to.length > from.length + 1 || to.length < from.length - 1) return "more or fewer words than were said";
  const f = fold(from.join("")), t = fold(to.join(""));
  if (f !== t && (f.startsWith(t) || t.startsWith(f)) && ENDING.test(f.startsWith(t) ? from.join("").slice(to.join("").length) : to.join("").slice(from.join("").length))) return "it changes an ending, not the name's spelling";
  const like = sounds(from.join(" "), to.join(" "));
  if (like < REFUSE_SOUND) return `it does not sound like what is written (${like})`;
  // word for word, each must sound like the word it replaces
  if (from.length === to.length) for (let k = 0; k < from.length; k++) {
    const w = sounds(from[k], to[k]);
    if (w < REFUSE_SOUND) return `"${to[k]}" does not sound like "${from[k]}" (${w})`;
  }
  // as many sounds as were said, near enough: a name, not a longer or shorter phrase
  const x = soundKey(from.join("")).length, y = soundKey(to.join("")).length;
  if (Math.abs(x - y) > Math.max(1, Math.round(Math.max(x, y) / 4))) return "it has more or fewer sounds than were said";
  return null;
}

// languages that write every noun with a capital: there a capital letter does not tell a name
export const NOUNS_CAPITALISED = /^(de|lb|gsw)$/;

// What happens to each place the model pointed to, one entry a place:
//   refused   the words are not in the sentence as written, the correction would change what was
//             said (rewrites), a speaker changes inside the words, or they are a name the page
//             writes so already
//   applied   the right spelling is on the page, it sounds like what is written (APPLY_SOUND), the
//             written words are no ordinary word, the right one is a name, more than case or
//             spacing changes, and the model is sure of it
//   proposed  everything else: the agent reads the sentence and takes it or not
// The same spelling elsewhere, where the model did not point, is never applied: it may be another
// person or an ordinary word ("Lou Reed" beside "Walker Reed", the noun "Flair" beside the rapper
// Fler). Each such place is proposed on its own. In a language that capitalises its nouns, a place
// the model pointed to is only proposed while the same spelling stands elsewhere unpointed.
export function entriesOf(answer, words, sentences, sources, { lang = null } = {}) {
  const lower = new Set(words.map(core).filter((c) => /^\p{Ll}/u.test(c)).map((c) => c.toLowerCase()));
  const byKey = new Map(), entries = [], pointed = new Set();
  const refuse = (f, why) => entries.push({ from: f.written, to: f.right, kind: f.kind || "name", why: f.why || "", status: "refused", sure: "refused", refused: why, places: [] });
  for (const f of answer.fixes || []) {
    const s = sentences[f.sentence];
    const found = s ? locate(words, s, f.written) : null;
    if (!found) { refuse(f, `not in sentence ${f.sentence} as written`); continue; }
    for (const { at, to } of narrowed(words, found, f.right)) {
      const from = words.slice(at[0], at[1] + 1).map(core);
      const why = rewrites(from, to);
      if (why) { refuse(f, why); continue; }
      pointed.add(at[0]);
      const key = `${at[0]}:${to.join(" ")}`;
      const e = byKey.get(key);
      if (e) { if (f.sure === "high") e.sure = "high"; continue; }
      byKey.set(key, { ...f, from, to, at: [at] });
    }
  }
  // the same spelling where the model did not point: proposed, a place each
  const nouns = NOUNS_CAPITALISED.test(String(lang || "").split("-")[0]);
  for (const e of [...byKey.values()]) {
    const [a, b] = e.at[0];
    for (const r of repeats(words, a, b)) {
      if (pointed.has(r[0]) || byKey.has(`${r[0]}:${e.to.join(" ")}`)) continue;
      byKey.set(`${r[0]}:${e.to.join(" ")}`, { ...e, at: [r], unpointed: true, origin: e.at[0], sentence: sentenceAt(sentences, r[0]) });
      if (nouns) e.shared = sentenceAt(sentences, r[0]);
    }
  }
  // A word that is part of a longer name is not that name by itself: a place beside another
  // capitalised word than where the model pointed ("Lou Reed" against "Walker Reed", "Tana Mongeau"
  // against "what is Tana doing"), or beside the word the model wrote together with it elsewhere
  const firsts = new Set(sentences.map((x) => x.first));
  const wrote = (answer.fixes || []).map((f) => tokens(f.written).map(fold).join(" "));
  const longer = (e) => {
    const [a, b] = e.at[0], from = e.from.map(fold).join(" ");
    if (e.unpointed) {
      // a sentence's capitalised first word counts as a first name only where the pointed place has one
      const there = beside(words, e.origin[0], e.origin[1], firsts, true), here = beside(words, a, b, firsts, !!there.prev);
      for (const k of ["prev", "next"]) if (here[k] && here[k] !== there[k]) return k === "prev" ? `${here.prev} ${e.from.join(" ")}` : `${e.from.join(" ")} ${here.next}`;
      return null;
    }
    const here = beside(words, a, b, firsts);
    if (here.next && wrote.some((w) => ` ${w} `.includes(` ${from} ${fold(here.next)} `)) && !e.written.includes(here.next)) return `${e.from.join(" ")} ${here.next}`;
    if (here.prev && wrote.some((w) => ` ${w} `.includes(` ${fold(here.prev)} ${from} `)) && !e.written.includes(here.prev)) return `${here.prev} ${e.from.join(" ")}`;
    return null;
  };
  for (const e of byKey.values()) {
    const [a, b] = e.at[0];
    const run = longer(e);
    if (run) { refuse({ ...e, written: e.from.join(" "), right: e.to.join(" ") }, `part of the longer name "${run}": another name, not this one misspelt`); continue; }
    const out = { from: e.from.join(" "), to: e.to.join(" "), kind: e.kind || "name", why: e.why || "", sound: sounds(e.from.join(" "), e.to.join(" ")) };
    if (words.slice(a, b + 1).some((w) => w.speaker !== words[a].speaker)) { refuse(e, "two voices say these words"); continue; }
    if (capital(out.from) && onPage(out.from, sources) && !onPage(out.to, sources)) { refuse(e, "the page writes it so already"); continue; }
    let places = [...e.at];
    const source = onPage(out.to, sources);
    // the transcript itself writes the right spelling elsewhere: said, not proof
    const elsewhere = written(words, e.to);
    let plain = ordinary(words, a, b, lower);
    // an ordinary word where the page writes the name with the same words around it ("Robert
    // Eggers' werewolf" against the description's "Robert Eggers' Werwulf"): the name, at the
    // places with those words only
    if (plain && source && capital(out.to)) {
      const said = places.filter(([x, y]) => samePhrase(words, x, y, e.to, sources));
      if (said.some(([x]) => e.at.some(([y]) => y === x))) { plain = false; places = said; }
    }
    const why = [];
    if (!source) why.push(`the page does not write it (${e.where === "knowledge" ? "the model's knowledge" : "the model's reading"}${elsewhere ? `; the transcript writes "${out.to}" ${elsewhere === 1 ? "once" : `${elsewhere} times`} elsewhere` : ""})`);
    if (out.sound < APPLY_SOUND) why.push(`sounds less alike (${out.sound})`);
    if (fold(out.from) === fold(out.to)) why.push("only the case, the accents or the spacing differ");
    if (plain) why.push(`"${out.from}" is an ordinary word in this transcript`);
    if (!capital(out.to)) why.push(`"${out.to}" is an ordinary word, not a name`);
    if (e.sure !== "high") why.push(`the model is ${e.sure === "low" ? "unsure" : "not quite sure"}`);
    if (e.unpointed) why.push("the same spelling as a place the model pointed to, but not pointed to here: maybe another name or an ordinary word");
    if (e.shared != null && !e.unpointed) why.push(`a capitalised word in this language may be a noun, and the same spelling stands unpointed in sentence ${e.shared}`);
    const applied = !why.length || (why.length === 1 && fold(out.from) === fold(out.to) && /[^\x00-\x7f]/.test(out.to) && source);
    entries.push({ ...out, where: source || (e.where === "knowledge" ? "the model's knowledge" : "nowhere on the page"),
      status: applied ? "applied" : "proposed", sure: applied ? "sure" : e.sure === "low" || plain || !capital(out.to) ? "doubtful" : "likely",
      ...(applied ? {} : { because: why.join(", ") }),
      places: places.map(([x, y]) => ({ first: x, last: y, start: words[x].start, end: words[y].end, sentence: sentenceAt(sentences, x) })) });
  }
  // two corrections of the same words: the applied one, else the first, keeps them
  const owner = new Map();
  for (const e of [...entries].sort((x, y) => (x.status === "applied" ? 0 : 1) - (y.status === "applied" ? 0 : 1))) {
    e.places = e.places.filter((p) => { for (let i = p.first; i <= p.last; i++) if (owner.has(i)) return false; for (let i = p.first; i <= p.last; i++) owner.set(i, e); return true; });
    if (!e.places.length && e.status !== "refused") Object.assign(e, { status: "refused", sure: "refused", refused: "another correction holds these words" });
  }
  const rank = { applied: 0, proposed: 1, refused: 2 };
  entries.sort((x, y) => rank[x.status] - rank[y.status] || (x.places[0]?.first ?? 1e9) - (y.places[0]?.first ?? 1e9));
  entries.forEach((e, k) => { e.n = k + 1; });
  return entries;
}

// ---------------------------------------------------------------- applying
// The words with every applied correction: the written words' times stay, the punctuation around
// them stays; fewer words than written (J Lo → JLaw) take the times of all they replace; one word
// more than written shares the last word's time. A changed word keeps what was written (`was`)
// and the number of its correction (`name`).
export function applyNames(raw, entries) {
  const at = new Map();
  for (const e of entries) if (e.status === "applied") for (const p of e.places) at.set(p.first, { e, p });
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const hit = at.get(i);
    if (!hit) { out.push(raw[i]); continue; }
    const { e, p } = hit;
    const ws = raw.slice(p.first, p.last + 1), to = tokens(e.to);
    const lead = parts(ws[0].text).lead, trail = parts(ws.at(-1).text).trail;
    const was = ws.map((w) => w.text).join(" ");
    const made = [];
    if (to.length <= ws.length) {
      to.forEach((t, k) => made.push({ ...ws[k], ...(k === to.length - 1 ? { end: ws.at(-1).end } : {}), text: t }));
    } else {
      ws.slice(0, -1).forEach((w, k) => made.push({ ...w, text: to[k] }));
      const last = ws.at(-1), rest = to.slice(ws.length - 1), d = (last.end - last.start) / rest.length;
      rest.forEach((t, k) => made.push({ ...last, start: +(last.start + k * d).toFixed(3), end: +(last.start + (k + 1) * d).toFixed(3), text: t }));
    }
    made[0].text = lead + made[0].text;
    made[made.length - 1].text += trail;
    made.forEach((w) => out.push({ ...w, was, name: e.n }));
    i = p.last;
  }
  return out;
}

// ---------------------------------------------------------------- a cut clip
// The applied corrections as best-takes' "fixes" for a clip cut from the episode at `from`
// seconds: the clip's own words (best-takes writes them anew) where a correction's place lies, its
// first word spelled right, the others of the run left out of the text (""). Where the clip's words
// there are spelled right already nothing is fixed; where they do not sound like the name (the
// clip heard something else) the place is `missed`, for the agent to read in the brief.
export function clipFixes(clipWords, entries, from, length = Infinity) {
  const fixes = {}, found = [], missed = [];
  const spoken = clipWords.filter((w) => w.kind === "word" || w.kind == null);
  for (const e of entries) {
    if (e.status !== "applied") continue;
    for (const p of e.places) {
      const t0 = p.start - from, t1 = p.end - from;
      if (t1 <= 0 || t0 >= length) continue;
      const run = spoken.filter((w) => w.end > t0 + 0.02 && w.start < t1 - 0.02);
      if (!run.length) { missed.push({ n: e.n, to: e.to, at: +t0.toFixed(2), heard: "" }); continue; }
      const heard = run.map(core).join(" ");
      if (fold(heard) === fold(e.to) && heard.replace(/\s/g, "") === e.to.replace(/\s/g, "")) continue;
      if (sounds(heard, e.to) < REFUSE_SOUND) { missed.push({ n: e.n, to: e.to, at: +t0.toFixed(2), heard }); continue; }
      const { lead } = parts(run[0].text), { trail } = parts(run.at(-1).text);
      fixes[run[0].i] = lead + e.to + trail;
      for (const w of run.slice(1)) fixes[w.i] = "";
      found.push({ n: e.n, words: run.map((w) => w.i), heard, to: e.to });
    }
  }
  return { fixes, found, missed };
}

// ---------------------------------------------------------------- the model
export const NAMES_SCHEMA = {
  type: "object", additionalProperties: false, required: ["names", "fixes"],
  properties: {
    names: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "kind", "where"],
      properties: { name: { type: "string" }, kind: { type: "string", enum: ["person", "place", "company", "product", "work", "other"] }, where: { type: "string" } } } },
    fixes: { type: "array", items: { type: "object", additionalProperties: false, required: ["sentence", "written", "right", "kind", "where", "sure", "why"],
      properties: { sentence: { type: "integer" }, written: { type: "string" }, right: { type: "string" },
        kind: { type: "string", enum: ["person", "place", "company", "product", "work", "other", "word"] }, where: { type: "string" },
        sure: { type: "string", enum: ["high", "medium", "low"] }, why: { type: "string" } } } },
  },
};

export function namesPrompt(page, sentences) {
  const p = page || {};
  const block = (label, text) => (String(text || "").trim() ? `${label}:\n"""\n${String(text).trim().slice(0, 8000)}\n"""\n` : "");
  return `A speech-to-text model wrote down a video. It writes what it hears, so it misspells names ("Reed" for Reade, "Kurosawa" for Curaçao, "J Lo" for JLaw) and sometimes writes a name where an ordinary word was said ("Miller" for "mother"). The video's own page usually spells its names right.

The video's page:
${block("Title", p.title)}${block("Channel", p.channel)}${block("Description", p.description)}${block("Chapters", (p.chapters || []).join("\n"))}${block("Tags", (p.tags || []).join(", "))}${block("Creators", (p.creators || []).join(", "))}${block("Words the video's own uploaded captions write that the transcript never writes (names spelled as the channel spells them)", (p.own || []).join(", "))}${block("Names the person gave", (p.also || []).join("\n"))}
The transcript, one numbered sentence a line:
${sentences.map((s, k) => `${k}: ${s.text}`).join("\n")}

1. names: every name the page writes of a person, place, company, brand, product or work (a film, show, book, song, sauce), spelled as the page spells it; where: "title", "channel", "description", "chapters", "tags", "creators", "captions" or "given".
2. fixes: every place where the transcript writes a name wrong. Also a name the page does not write when you know its spelling for sure (a country, a city, a well-known company or person) and the sentence leaves no doubt which one is meant; where: "knowledge". One fix per sentence it occurs in.
- written: the misspelled words copied exactly from that sentence, one to four words in a row, nothing around them.
- right: the same words as they should be written: only the name's spelling changes, its endings stay ("Wittmanns", "Eggers'"); never more than one word more than written.
- Only the spelling of names. Never grammar, word order, fillers, punctuation, or one ordinary word for another. Never a name that is written right already.
- An ordinary word that sounds like a name: only where the sentence makes no sense with that word and does with the name; sure "low".
- A name written where the sentence needs an ordinary word: right is that word, kind "word", sure "low".
- sure: "high" when the page writes the name and the transcript's words are clearly that name misspelled; "medium" when it is a name you know and the sentence leaves no doubt; "low" when it could also be what was said.
- why: a few words.`;
}

// ---------------------------------------------------------------- what the tool prints
function contextOf(words, p, to, span = 7) {
  const a = Math.max(0, p.first - span), b = Math.min(words.length - 1, p.last + span);
  const before = words.slice(a, p.first).map((w) => w.text).join(" "), after = words.slice(p.last + 1, b + 1).map((w) => w.text).join(" ");
  const was = words.slice(p.first, p.last + 1).map((w) => w.text).join(" ");
  return `${a > 0 ? "… " : ""}${before} [${was} → ${to}] ${after}${b < words.length - 1 ? " …" : ""}`.replace(/\s+/g, " ").trim();
}

export function namesListing(j, raw) {
  const { entries } = j;
  const applied = entries.filter((e) => e.status === "applied"), proposed = entries.filter((e) => e.status === "proposed"), refused = entries.filter((e) => e.status === "refused");
  // every place an entry changes, each with its sentence (an entry is one place: --take applies
  // exactly what is shown)
  const line = (e) => {
    const where = e.status === "refused" ? `refused: ${e.refused}` : `${e.where}; ${e.sure}${e.because ? `: ${e.because}` : ""}${e.taken ? `; ${e.taken}` : ""}`;
    const at = e.places.map((p) => `${mmss(p.start)}, sentence ${p.sentence}: “${contextOf(raw, p, e.to)}”`);
    return `  ${String(e.n).padStart(2)}. "${e.from}" → "${e.to}" (${where})${at.length === 1 ? `, at ${at[0]}` : at.length ? `, at ${at.length} places:${at.map((a) => `\n        ${a}`).join("")}` : ""}`;
  };
  const out = [`Names: ${j.names.length} on the video's page${j.names.length ? ` (${j.names.slice(0, 12).map((n) => n.name).join(", ")}${j.names.length > 12 ? ", …" : ""})` : ""}; ${applied.length} correction${applied.length === 1 ? "" : "s"} applied, ${proposed.length} proposed, ${refused.length} refused.`];
  if (applied.length) out.push("Applied (the page writes the name, only the spelling differs):", ...applied.map(line));
  if (proposed.length) out.push("Proposed, not applied (read the sentence: take only a name that was said):", ...proposed.map(line));
  if (refused.length) out.push("Refused (never applied: they would change what was said):", ...refused.map(line));
  return out.join("\n");
}
