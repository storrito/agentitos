// Data graphics and hand-drawn notes, detected deterministically from the words.
//
//   viz  – a small chart under the phrase that shows what a number *means*:
//          gauge   "40%", "forty percent", "half of"      → a bar filling to the share
//          compare "doubled", "3x", "three times more"   → before/after bars, the second grows N×
//          units   "team of six", "thirty days"          → N pictograms (people, days, ticks)
//   note – a hand-drawn mark on a word: circle | underline | strike.
//          Claude picks notes when staging; without it, "not X but Y" strikes X and circles Y.
//   list – an enumeration ("reports, tickets, first drafts") becomes a checklist.

const EN = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const EN_TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const DE = {
  zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12,
  dreizehn: 13, vierzehn: 14, fünfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19,
};
const DE_TENS = { zwanzig: 20, dreißig: 30, vierzig: 40, fünfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90 };
const DE_UNIT = { ein: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9 };

// "six", "forty", "twenty-five", "fünfundzwanzig", "hundred" → number; otherwise null
export function wordNumber(key) {
  if (!key) return null;
  if (EN[key] || DE[key]) return EN[key] || DE[key];
  if (EN_TENS[key] || DE_TENS[key]) return EN_TENS[key] || DE_TENS[key];
  if (key === "hundred" || key === "hundert") return 100;
  for (const [t, v] of Object.entries(EN_TENS)) {
    if (key.startsWith(t)) { const u = EN[key.slice(t.length)]; if (u && u < 10) return v + u; }
  }
  const m = key.match(/^(\p{L}+)und(\p{L}+)$/u);
  if (m && DE_UNIT[m[1]] && DE_TENS[m[2]]) return DE_TENS[m[2]] + DE_UNIT[m[1]];
  return null;
}

const MULT = {
  double: 2, doubled: 2, doubles: 2, doubling: 2, twice: 2, triple: 3, tripled: 3, triples: 3, quadrupled: 4,
  halved: 0.5, halves: 0.5,
  verdoppelt: 2, verdoppeln: 2, verdoppelte: 2, doppelt: 2, verdreifacht: 3, verdreifachen: 3, halbiert: 0.5, halbieren: 0.5,
};
const PERCENT = new Set(["percent", "per", "prozent"]);
const TIMES = new Set(["times", "mal", "fach", "x"]);
const HALF = new Set(["half", "hälfte"]);

// pictogram per counted noun (stem match)
const ICONS = [
  ["person", ["people", "person", "team", "member", "user", "customer", "client", "employee", "kid", "child", "friend",
    "colleague", "folk", "guy", "engineer", "developer", "student", "mensch", "leute", "mitarbeit", "kund", "kind",
    "freund", "kolleg", "nutzer", "schüler", "entwickler"]],
  ["day", ["day", "night", "week", "month", "year", "tag", "nacht", "woche", "monat", "jahr"]],
  ["tick", ["second", "minute", "hour", "sekunde", "minute", "stunde"]],
];
const iconOf = (key) => ICONS.find(([, stems]) => stems.some((s) => key.startsWith(s)))?.[0] ?? null;

function valueOf(w) {
  if (w.num) return w.num.value;
  return wordNumber(w.key);
}

// Returns Map(wordIndex → viz). One graphic per phrase is enforced by the caller.
export function detectViz(words) {
  const out = new Map();
  for (let i = 0; i < words.length; i++) {
    const w = words[i], next = words[i + 1], prev = words[i - 1], prev2 = words[i - 2];
    if (w.viz === null) continue; // explicitly disabled in the transcript
    if (w.viz) { out.set(i, w.viz); continue; }
    // multipliers spelled as a verb/adverb
    if (MULT[w.key]) { out.set(i, { kind: "compare", value: MULT[w.key] }); continue; }
    if (HALF.has(w.key) && next && /^(of|der|des|von|aller)$/.test(next.key)) { out.set(i, { kind: "gauge", value: 50 }); continue; }
    const v = valueOf(w);
    if (v == null || !(v > 0)) continue;
    if (w.num?.suffix === "%" || (next && PERCENT.has(next.key))) {
      if (v <= 100) out.set(i, { kind: "gauge", value: v });
      continue;
    }
    if (/^x$/i.test(w.num?.suffix || "") || (next && TIMES.has(next.key))) {
      if (v >= 1.5 && v <= 12) out.set(i, { kind: "compare", value: v });
      continue;
    }
    if (w.num && (w.num.prefix || w.num.suffix || w.num.decimals)) continue; // money, 3.5 … stay a count
    if (!Number.isInteger(v) || v < 2 || v > 40) continue;
    // counted things: "six people", "thirty days", "team of six"
    const after = next && !/[.!?,;:]/.test(w.punct) ? iconOf(next.key) : null;
    const before = prev2 && prev?.key === "of" || prev2 && prev?.key === "aus" ? iconOf(prev2.key) : null;
    const icon = after || before;
    if (icon) out.set(i, { kind: "units", value: v, icon });
  }
  return out;
}

// "not X but Y" / "nicht X sondern Y" / "instead of X": strike X, circle Y
const NEG = /^(not|never|no|nicht|kein\p{L}*|nie)$|n't$/u;
const BUT = new Set(["but", "sondern", "instead", "rather", "stattdessen"]);
export function detectNotes(words) {
  const out = new Map();
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.key === "instead" && words[i + 1]?.key === "of") {
      const x = words.slice(i + 2, i + 5).find((v) => v.role === "content" && v.key.length > 3);
      if (x) out.set(x.i, "strike");
      continue;
    }
    if (!NEG.test(w.key)) continue;
    // look for the turn within the same sentence
    let b = -1;
    for (let k = i + 1; k < Math.min(words.length, i + 9); k++) {
      if (BUT.has(words[k].key)) { b = k; break; }
      if (/[.!?]/.test(words[k].punct)) break;
    }
    if (b < 0) continue;
    // the noun/verb that carries the contrast, not a stray preposition ("um", "zu")
    const carries = (v) => v.role === "content" && v.key.length > 3;
    const x = words.slice(i + 1, b).find(carries);
    const y = words.slice(b + 1, b + 5).find(carries);
    if (x && y) { out.set(x.i, "strike"); out.set(y.i, "circle"); }
  }
  return out;
}

// Enumeration runs: ≥3 consecutive short items, each ending in a comma except the last.
// Returns Set of word indices that belong to a run (so segmentation keeps them together).
export function detectLists(words) {
  const inRun = new Set();
  let i = 0;
  while (i < words.length) {
    const items = [];
    let k = i;
    for (;;) {
      let e = k;
      while (e < words.length && e - k < 3 && !/[,.!?;:]/.test(words[e].punct)) e++;
      if (e >= words.length || e - k >= 3) break;
      items.push([k, e]);
      k = e + 1;
      if (!/,/.test(words[e].punct)) break; // the last item ends the run
    }
    const sameVoice = items.length && words.slice(i, k).every((w) => w.speaker === words[i].speaker);
    // "so, honestly, yes," is not a list: every item must name something
    const named = items.every(([a, e]) => words.slice(a, e + 1).some((w) => w.role === "content"));
    if (items.length >= 3 && items.length <= 6 && sameVoice && named) {
      for (let j = i; j < k; j++) inRun.add(j);
      i = k;
    } else i++;
  }
  return inRun;
}

// Split a phrase into checklist items at commas; null if it is not a list.
export function listItems(pw) {
  const items = [];
  let cur = [];
  for (const w of pw) {
    cur.push(w);
    if (/[,;]/.test(w.punct)) { items.push(cur); cur = []; }
  }
  if (cur.length) items.push(cur);
  // a lead-in ("we automated reports, tickets, drafts") stays in the first item
  if (items.length < 3 || items.length > 6 || items.some((it) => it.length > 4)) return null;
  return items.map((it) => it.map((w) => w.i));
}
