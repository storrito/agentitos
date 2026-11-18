// Words into caption groups, and how long each stays. A group breaks at the end of a sentence, at
// a pause, after a comma once it is half full (a phrase stays together), and before it grows past
// the style's words or characters; it starts when its first word is said and stays a little
// after its last, but never into the next group, and at least the style's minimum time when
// there is room.

const TAIL = 0.35;   // seconds a group stays after its last word
const GAP = 0.02;    // seconds between one group's end and the next one's start (a style's `gap` says otherwise)
const sentenceEnd = (text) => /[.!?…]["»”)]*$/.test(text);
const phraseEnd = (text) => /[,;:–—]["»”)]*$/.test(text);

// words: [{ text, start, end, ... }] in the video's time; returns [{ from, to, start, end }]
// (from–to: indexes of its first and last word, both included). First the phrases (a sentence,
// up to a pause or a comma); a phrase too long for one group is split into groups of about equal
// size ("Let me show | how it works.", not "Let me show how | it works.").
//
// A run of words that carry the same `box` (captions.mjs box) is a group of its own, whole,
// whatever the style's size: what the person chose to stand as a card. The words before and
// after it are grouped as if the run were a pause. Without a `box` on any word nothing changes.
//
// `fit` (captions in an area, lines or a size of the caller's own, render.mjs): { lines, room,
// space, word(text, w) }, how many lines a group may have and how wide a line, a gap between
// words and a word are, all in the type's size (word is given the word itself too: a key word
// may be set in another typeface). A phrase whose groups, cut as above, each set in those lines
// keeps them; any other is split into the fewest groups that do, about equally long. A word
// wider than a line stands alone: the browser sets it smaller. A single short word beside it
// that would be on screen for less than the style's minimum joins it when the area has a
// second line (joinFlash below).
//
// `gap` (a style whose groups are cut in and cut out): 0, so that a group ends in the moment the
// next one starts; with the usual 20 ms a frame of a 30 fps video often shows neither.
//
// `even` (the styles after the first four): a phrase too long for one group is cut by length
// instead of into equal counts of words: the fewest groups that keep to the style's words and
// characters, and of those ways the one whose groups are most alike in length. Equal counts
// take one group more whenever a pair of long words passes the characters, and then leave
// words alone ("Wir | haben | letzte | Woche" where "Wir haben letzte | Woche vierundzwanzig"
// holds): in 190 captions of two or three words about twenty single words that need not be,
// and as many captions on screen for under 0.4 s; by length half and a quarter of that.
export function groups(words, { words: maxWords, chars: maxChars, pause, min, fit, gap = GAP, even }, duration = Infinity) {
  const boxOf = (w) => w.box || null;
  const phrases = [];
  let cur = null;
  words.forEach((w, i) => {
    const prev = words[i - 1];
    const breaks = !cur || boxOf(w) !== boxOf(prev) || (!boxOf(w) && (sentenceEnd(prev.text) || w.start - prev.end >= pause || (phraseEnd(prev.text) && i - cur.from >= maxWords / 2)));
    if (breaks) { cur = { from: i, to: i, box: !!boxOf(w) }; phrases.push(cur); } else cur.to = i;
  });
  const text = (a, b) => words.slice(a, b + 1).map((x) => x.text).join(" ");
  const out = [];
  // a phrase cut by length, the words measured where there is a `fit`
  const cut = (ph) => {
    const ws = words.slice(ph.from, ph.to + 1), ranges = byLength(ws, maxWords, maxChars, fit);
    for (const [a, b] of fit && maxWords > 1 ? joinFlash(ranges, ws, fit, min) : ranges) out.push({ from: ph.from + a, to: ph.from + b });
  };
  for (const ph of phrases) {
    if (ph.box) { out.push({ from: ph.from, to: ph.to, box: true }); continue; }
    const n = ph.to - ph.from + 1;
    if (even) { cut(ph); continue; }
    let k = Math.ceil(n / maxWords);
    const equal = () => Array.from({ length: k }, (_, j) => [ph.from + Math.round((j * n) / k), ph.from + Math.round(((j + 1) * n) / k) - 1]);
    while (k < n && equal().some(([a, b]) => text(a, b).length > maxChars)) k++;
    if (fit && equal().some(([a, b]) => !sets(words.slice(a, b + 1), fit))) { cut(ph); continue; }
    for (let j = 0; j < k; j++) out.push({ from: ph.from + Math.round((j * n) / k), to: ph.from + Math.round(((j + 1) * n) / k) - 1 });
  }
  out.forEach((g, k) => {
    const first = words[g.from], last = words[g.to], next = out[k + 1] ? words[out[k + 1].from].start : duration;
    g.start = first.start;
    const natural = Math.max(last.end + TAIL, first.start + min);
    g.end = Math.max(last.end, Math.min(natural, next - gap, duration));
  });
  return out;
}

// Whether words set in at most fit.lines lines of fit.room, line by line as a browser fills
// them: a word that does not fit the line begins the next. A word alone always does (it shrinks).
function sets(ws, fit) {
  if (ws.length === 1) return true;
  let lines = 1, used = 0;
  for (const x of ws) {
    const w = fit.word(x.text, x);
    if (w > fit.room) return false;
    if (used && used + fit.space + w > fit.room) { lines++; used = w; } else used += (used ? fit.space : 0) + w;
  }
  return lines <= fit.lines;
}

// A phrase's words into the fewest groups of at most maxWords words and maxChars characters that
// each set in their lines (sets above; without a `fit` the words and characters alone count),
// and of those ways the one whose groups are most alike in length (the least sum of their
// squared lengths); returns [[first, last], …] as indexes into the phrase. A word that fits no
// line stands alone.
function byLength(ws, maxWords, maxChars, fit) {
  const texts = ws.map((w) => w.text);
  const length = (a, b) => texts.slice(a, b).join(" ").length;   // of the words a … b - 1
  // best[i]: the words before i as [how many groups, their squared lengths summed, where the last one starts]
  const best = [[0, 0, 0]];
  for (let i = 1; i <= texts.length; i++) {
    for (let j = i - 1; j >= Math.max(0, i - maxWords); j--) {
      const l = length(j, i);
      // (a group that does not set is not helped by a word more in front of it)
      if (j < i - 1 && (l > maxChars || (fit && !sets(ws.slice(j, i), fit)))) break;
      const way = [best[j][0] + 1, best[j][1] + l * l, j];
      if (!best[i] || way[0] < best[i][0] || (way[0] === best[i][0] && way[1] < best[i][1])) best[i] = way;
    }
  }
  const out = [];
  for (let i = texts.length; i > 0; i = best[i][2]) out.unshift([best[i][2], i - 1]);
  return out;
}

// A token without a letter or a digit ("…", "–", "&", a quotation mark the recognizer set apart)
// is no word to show by itself: it joins the word said just before it (a closing mark without a
// space: "well…"), else the word said just after it (an opening mark without a space; a mark
// that stands before its word, such as "§", always), each within NEAR seconds; a mark with no word near it is left out (a "…" for a pause stood in the
// picture for most of a second), as are dots after a word that ends its sentence already. The words come back as they are when there is no such token.
const NEAR = 0.6;
const bare = (text) => !/[\p{L}\p{N}]/u.test(text);
// (marks that can only belong to what follows them: an opening bracket, a low opening quotation
// mark, "§ 202a". "$", "#", "@", "«" stand on either side, "5 $", "Hallo«": they go by what is near)
const before = (text) => /^[(\[{„§¿¡]+$/.test(text);
export function fold(words) {
  if (!words.some((w) => bare(w.text))) return words;
  const out = [];
  let lead = null;   // marks waiting for the word after them
  for (const w of words) {
    const prev = out[out.length - 1];
    if (bare(w.text)) {
      // (dots after a word that ends its sentence add nothing: "das." stays "das.", not "das.…")
      if (!before(w.text) && prev && !lead && w.start - prev.end < NEAR) { if (!(/^[.…]+$/.test(w.text) && /[.!?…]["»”)]*$/.test(prev.text))) out[out.length - 1] = { ...prev, text: prev.text + (/^[.,;:!?…)\]}»“”‘’"']+$/.test(w.text) ? "" : " ") + w.text }; }
      else lead = lead ? { ...lead, text: `${lead.text} ${w.text}`, end: w.end } : w;
      continue;
    }
    out.push(lead && w.start - lead.end < NEAR ? { ...w, text: lead.text + (/^[(\[{«„‹“‘"'¿¡]+$/.test(lead.text) ? "" : " ") + w.text } : w);
    lead = null;
  }
  return out;
}

// A word wider than a line stands alone and is set smaller. A single word before it, or after
// it inside the phrase, that fits a line but would be on screen for less than the style's
// minimum ("Am" for 0.15 s before "Montagmorgen") reads as a flicker: it joins the wide word,
// on a line of its own, where the area has two lines, and is set smaller with it. ranges are
// [first, last] in the phrase's words ws.
function joinFlash(ranges, ws, fit, min) {
  if (fit.lines < 2) return ranges;
  const out = ranges.map((r) => [...r]), wide = (i) => fit.word(ws[i].text, ws[i]) > fit.room;
  const flash = (r, until) => r && r[0] === r[1] && !wide(r[0]) && until - ws[r[0]].start < min;
  for (let k = 0; k < out.length; k++) {
    const [a, b] = out[k];
    if (a !== b || !wide(a)) continue;
    if (flash(out[k - 1], ws[a].start)) { out.splice(k - 1, 2, [out[k - 1][0], b]); k--; }
    else if (out[k + 2] && flash(out[k + 1], ws[out[k + 2][0]].start)) out.splice(k, 2, [a, out[k + 1][1]]);
  }
  return out;
}

// The time each word is the one being said: from its start to the next word's start in the
// group (a short pause between them does not leave the group without an active word), the last
// one to its end.
export function activeSpans(words, g) {
  const spans = [];
  for (let i = g.from; i <= g.to; i++) {
    const w = words[i];
    spans.push({ i, start: w.start, end: i < g.to ? words[i + 1].start : Math.max(w.end, w.start + 0.12) });
  }
  return spans;
}
