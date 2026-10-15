// Data graphics and hand-drawn notes, detected deterministically from the words.
//
//   viz  – a small chart under the phrase that shows what a number *means*:
//          gauge   "40%", "forty percent", "half of"      → a bar filling to the share
//          compare "doubled", "3x", "three times more"   → before/after bars, the second grows N×
//          clock   "zwei Stunden", "20 minutes"          → a clock whose dial fills for the duration
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

// a duration's unit: "Stunden" → h, "minutes" → min
const durationOf = (key) => /^(hours?|stunden?|std)$/.test(key) ? "h" : /^(minutes?|minuten?|min)$/.test(key) ? "min" : null;

function valueOf(w) {
  if (w.num) return w.num.value;
  return wordNumber(w.key);
}

// "first", "fünfte", "Dritten" → 1 … 12; otherwise null
const EN_ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const DE_ORD = { erst: 1, zweit: 2, dritt: 3, viert: 4, "fünft": 5, sechst: 6, siebt: 7, siebent: 7, acht: 8, neunt: 9, zehnt: 10, elft: 11, "zwölft": 12 };
function ordinalOf(key) {
  if (EN_ORD[key]) return EN_ORD[key];
  const m = key?.match(/^(\p{L}+?)(e|er|en|es|em)$/u);
  return (m && DE_ORD[m[1]]) || null;
}
const NOW = /[.!?,;:]/; // punctuation between two words: they don't belong together
const at = (w, ...keys) => !!w && keys.some((k) => (k instanceof RegExp ? k.test(w.key) : w.key === k));

// a time of day in hours: "17:30", "5pm", "5 p.m.", "17 Uhr (30)", "five o'clock", "at 5 am"
function timeOfDay(words, i) {
  const w = words[i], next = words[i + 1], prev = words[i - 1];
  const pm = (h, ap) => (ap === "p" && h < 12 ? h + 12 : ap === "a" && h === 12 ? 0 : h);
  let m = w.text.match(/^(\d{1,2}):(\d{2})\s*(?:([ap])\.?m\.?)?[.,!?;:]*$/i);
  if (m && +m[1] <= 24 && +m[2] < 60) {
    const ap = m[3]?.toLowerCase() || (!NOW.test(w.punct) && at(next, "am", "pm") ? next.key[0] : null);
    return pm(+m[1], ap) + +m[2] / 60;
  }
  m = w.text.match(/^(\d{1,2})\s*([ap])\.?m\.?[.,!?;:]*$/i);
  if (m && +m[1] >= 1 && +m[1] <= 12) return pm(+m[1], m[2].toLowerCase());
  const v = valueOf(w);
  if (v == null || !Number.isInteger(v) || v < 0 || v > 24 || NOW.test(w.punct) || !next) return null;
  if (next.key === "uhr") {
    if (at(prev, "halb")) return v >= 1 ? v - 0.5 : null; // "halb acht Uhr" is 7:30
    const mm = !NOW.test(next.punct) && words[i + 2] ? valueOf(words[i + 2]) : null;
    return v + (Number.isInteger(mm) && mm > 0 && mm < 60 ? mm / 60 : 0);
  }
  if (v < 1 || v > 12) return null;
  if (at(next, "o'clock", "oclock")) return v;
  if (next.key === "pm" || next.text.toLowerCase().startsWith("p.m")) return pm(v, "p");
  // "am" is also German ("um 5 am Bahnhof"): only after "at 5", "by 6" …
  if ((next.key === "am" || next.text.toLowerCase().startsWith("a.m")) && at(prev, "at", "by", "until", "till", "before", "after", "around", "from")) return pm(v, "a");
  return null;
}

// a year with a word that says so: "in 2008", "seit 2019", "im Jahr 1989" – not "in 2000 Fällen"
const YEAR_CUE = new Set(["in", "im", "seit", "since", "bis", "until", "till", "jahr", "jahre", "year", "anno", "ab", "circa", "ca", "um"]);
const COUNTED = /^(leute|menschen|people|persons?|euro|dollars?|cases|fälle|fällen|mal|times|meter|metres?|meters?|km|kilometern?|miles|meilen|stück|units|users|nutzer\p{L}*|kunden|customers|mitarbeiter\p{L}*|employees)$/u;
function yearOf(words, i) {
  const w = words[i], next = words[i + 1];
  const m = w.text.match(/^(1[89]\d\d|20\d\d)[.,!?;:]*$/);
  if (!m || !at(words[i - 1], ...YEAR_CUE)) return null;
  // "in 2000 Fällen", "in 2008 Apple …": a noun right after it makes it a count, or leaves it unclear
  if (next && !NOW.test(w.punct) && (COUNTED.test(next.key) || /^\p{Lu}/u.test(next.text))) return null;
  return +m[1];
}

// a temperature: "40 Grad", "minus 5 degrees Celsius", "-3°C", "100 Fahrenheit"
const WEATHER = /^(hot|hotter|heat|cold|colder|warm|warmer|warming|freezing|frost|temperature\p{L}*|weather|outside|summer|winter|fever|sauna|celsius|fahrenheit|heiß\p{L}*|hitze|kalt|kälter|kälte|warm\p{L}*|temperatur\p{L}*|wetter|draußen|sommer|fieber)$/u;
function temperatureOf(words, i) {
  const w = words[i], next = words[i + 1], prev = words[i - 1];
  let v, k = i + 1, unit;
  const m = w.text.match(/^([-−–]?\d+(?:[.,]\d+)?)\s*°\s*([CF])?[.,!?;:]*$/i);
  if (m) { v = Number(m[1].replace(/[−–]/, "-").replace(",", ".")); unit = m[2]?.toUpperCase() || "deg"; }
  else {
    v = valueOf(w);
    if (v == null || NOW.test(w.punct) || !next) return null;
    // "°C" / "°F" as a word of its own; a bare "C" is a letter
    if (/^°\s*[CF]\b/i.test(next.text)) unit = next.key.toUpperCase();
    else if (next.key === "grad") unit = "grad";
    else if (at(next, "degrees", "degree")) unit = "deg";
    else return null;
    k = i + 2;
  }
  if (at(prev, "minus") && v > 0) v = -v;
  const scale = words[k] && !NOW.test(words[k - 1].punct) ? words[k].key : "";
  if (unit === "C" || scale === "celsius") unit = "C";
  else if (unit === "F" || scale === "fahrenheit") unit = "F";
  // "a 180 degree turn", "90 Grad nach links": angles, unless a scale is said
  else if ([45, 90, 180, 270, 360].includes(Math.abs(v))) return null;
  // "two degrees" can be a diploma: in English a word about weather must be near
  else if (unit === "deg" && !words.slice(Math.max(0, i - 6), i + 7).some((x) => WEATHER.test(x.key))) return null;
  else unit = unit === "deg" && v > 50 ? "F" : "C";
  if (unit === "C" ? v < -60 || v > 120 : v < -40 || v > 140) return null;
  return { kind: "temperature", value: v, unit };
}

// a speed: "200 km/h", "200 Stundenkilometer", "70 mph", "100 Kilometer pro Stunde", "60 miles an hour"
function speedOf(words, i) {
  const w = words[i], next = words[i + 1];
  const m = w.text.match(/^(\d+(?:[.,]\d+)?)\s*(km\/h|kmh|mph)[.,!?;:]*$/i);
  if (m) return { kind: "speed", value: Number(m[1].replace(",", ".")), unit: /mph/i.test(m[2]) ? "mph" : "km/h", base: null };
  const v = valueOf(w);
  if (v == null || !(v > 0) || NOW.test(w.punct) || !next) return null;
  if (at(next, "kmh", /^stundenkilometer/)) return { kind: "speed", value: v, unit: "km/h", base: null };
  if (at(next, "mph")) return { kind: "speed", value: v, unit: "mph", base: null };
  const per = words[i + 2], hour = words[i + 3];
  if (at(next, /^(kilometer|kilometers|kilometres|km|miles|meilen)$/) && !NOW.test(next.punct) && at(per, "pro", "per", "an", "the") && at(hour, "stunde", "hour", "h")) {
    return { kind: "speed", value: v, unit: /^(miles|meilen)$/.test(next.key) ? "mph" : "km/h", base: null };
  }
  return null;
}

// a place in a ranking: "Platz zwei", "auf dem dritten Platz", "first place" (not "in the first place")
function rankOf(words, i) {
  const w = words[i], next = words[i + 1], prev = words[i - 1];
  if (at(prev, "platz", "rang") && !NOW.test(prev.punct)) {
    const v = valueOf(w);
    if (Number.isInteger(v) && v >= 1 && v <= 10) return v;
  }
  const o = ordinalOf(w.key);
  if (!o || o > 10 || NOW.test(w.punct) || !at(next, "place", "platz", "rang", "platzierung")) return null;
  if (at(prev, "the") && at(words[i - 2], "in")) return null;
  return o;
}

// "jeder Fünfte", "one in five", "zwei von drei", "4 von 5 Sternen" (stars: a rating)
const ONE = new Set(["one", "eins", "einer", "eine", "ein"]);
const PERIOD = /^(weeks?|days?|years?|months?|hours?|minutes?|wochen|tagen?|jahren?|monaten?|stunden|minuten)$/;
function shareOf(words, i) {
  const w = words[i], next = words[i + 1];
  if (at(w, "jeder", "jede", "jedes", "jeden") && !NOW.test(w.punct) && next && /^\p{Lu}/u.test(next.text)) {
    const n = ordinalOf(next.key);
    if (n >= 2 && n <= 12) return { kind: "ratio", value: 1, base: n };
  }
  const a = ONE.has(w.key) ? 1 : valueOf(w);
  if (!Number.isInteger(a) || a < 1 || NOW.test(w.punct)) return null;
  let k = i + 1;
  if (at(words[k], "out") && at(words[k + 1], "of")) k += 2;
  else if (at(words[k], "in", "von")) k += 1;
  else return null;
  const base = words[k], b = base && valueOf(base);
  if (!Number.isInteger(b) || b <= a || b < 2 || b > 12 || NOW.test(words[k - 1].punct)) return null;
  const after = NOW.test(base.punct) ? null : words[k + 1];
  if (at(after, /^(stars?|sterne|sternen)$/)) return { kind: "rating", value: a, base: b };
  if (at(after, PERIOD)) return null; // "in two weeks"
  return { kind: "ratio", value: a, base: b };
}

// Returns Map(wordIndex → viz). One graphic per phrase is enforced by the caller.
export function detectViz(words) {
  const out = new Map();
  for (let i = 0; i < words.length; i++) {
    const w = words[i], next = words[i + 1];
    if (w.viz === null) continue; // explicitly disabled in the transcript
    if (w.viz) { out.set(i, w.viz); continue; }
    // multipliers spelled as a verb/adverb
    if (MULT[w.key]) { out.set(i, { kind: "compare", value: MULT[w.key] }); continue; }
    if (HALF.has(w.key) && next && /^(of|der|des|von|aller)$/.test(next.key)) { out.set(i, { kind: "gauge", value: 50 }); continue; }
    // what a number says by the words around it: a time, a year, a temperature, a speed, a place, a share
    const hour = timeOfDay(words, i);
    if (hour != null) { out.set(i, { kind: "clock", value: +hour.toFixed(3) }); continue; }
    const year = yearOf(words, i);
    if (year) { out.set(i, { kind: "calendar", value: year }); continue; }
    const seen = temperatureOf(words, i) || speedOf(words, i) || shareOf(words, i);
    if (seen) { out.set(i, seen); continue; }
    const place = rankOf(words, i);
    if (place) { out.set(i, { kind: "rank", value: place }); continue; }
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
    if (!Number.isInteger(v)) continue;
    // a duration: "zwei Stunden", "20 minutes" – the slice of the dial it takes
    const unit = next && !/[.!?,;:]/.test(w.punct) ? durationOf(next.key) : null;
    if ((unit === "h" && v <= 12) || (unit === "min" && v <= 60)) out.set(i, { kind: "clock", value: v, unit });
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
// words said in passing, not things named: an item made of them is no list item
const CALLS = new Set(["okay", "ok", "yes", "yeah", "no", "nope", "well", "right", "sure", "stop", "honestly", "ja", "jo",
  "nein", "nee", "doch", "genau", "stopp", "gut", "klar", "naja", "tja", "ey", "egal", "sag", "sagt", "sage", "says", "say", "said"]);

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
    // "so, honestly, yes," and "sag ich, okay, stopp" are not lists: every item must name something
    const named = items.every(([a, e]) => words.slice(a, e + 1).some((w) => w.role === "content" && !CALLS.has(w.key)));
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
