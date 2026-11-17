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
// space, word(text) }, how many lines a group may have and how wide a line, a gap between words
// and a word are, all in the type's size. A phrase whose groups, cut as above, each set in
// those lines keeps them; any other is split into the fewest groups that do, about equally
// long. A word wider than a line stands alone: the browser sets it smaller.
//
// `gap` (a style whose groups are cut in and cut out): 0, so that a group ends in the moment the
// next one starts; with the usual 20 ms a frame of a 30 fps video often shows neither.
export function groups(words, { words: maxWords, chars: maxChars, pause, min, fit, gap = GAP }, duration = Infinity) {
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
  for (const ph of phrases) {
    if (ph.box) { out.push({ from: ph.from, to: ph.to, box: true }); continue; }
    const n = ph.to - ph.from + 1;
    let k = Math.ceil(n / maxWords);
    while (k < n && Array.from({ length: k }, (_, j) => text(ph.from + Math.round((j * n) / k), ph.from + Math.round(((j + 1) * n) / k) - 1)).some((t) => t.length > maxChars)) k++;
    if (fit && Array.from({ length: k }, (_, j) => text(ph.from + Math.round((j * n) / k), ph.from + Math.round(((j + 1) * n) / k) - 1)).some((t) => !sets(t.split(" "), fit))) {
      for (const [a, b] of byLength(words.slice(ph.from, ph.to + 1).map((w) => w.text), maxWords, maxChars, fit)) out.push({ from: ph.from + a, to: ph.from + b });
      continue;
    }
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
function sets(texts, fit) {
  if (texts.length === 1) return true;
  let lines = 1, used = 0;
  for (const t of texts) {
    const w = fit.word(t);
    if (w > fit.room) return false;
    if (used && used + fit.space + w > fit.room) { lines++; used = w; } else used += (used ? fit.space : 0) + w;
  }
  return lines <= fit.lines;
}

// A phrase's words into the fewest groups of at most maxWords words and maxChars characters that
// each set in their lines (sets above), and of those ways the one whose groups are most alike in
// length (the least sum of their squared lengths); returns [[first, last], …] as indexes into
// the phrase. A word that fits no line stands alone.
function byLength(texts, maxWords, maxChars, fit) {
  const length = (a, b) => texts.slice(a, b).join(" ").length;   // of the words a … b - 1
  // best[i]: the words before i as [how many groups, their squared lengths summed, where the last one starts]
  const best = [[0, 0, 0]];
  for (let i = 1; i <= texts.length; i++) {
    for (let j = i - 1; j >= Math.max(0, i - maxWords); j--) {
      const l = length(j, i);
      // (a group that does not set is not helped by a word more in front of it)
      if (j < i - 1 && (l > maxChars || !sets(texts.slice(j, i), fit))) break;
      const way = [best[j][0] + 1, best[j][1] + l * l, j];
      if (!best[i] || way[0] < best[i][0] || (way[0] === best[i][0] && way[1] < best[i][1])) best[i] = way;
    }
  }
  const out = [];
  for (let i = texts.length; i > 0; i = best[i][2]) out.unshift([best[i][2], i - 1]);
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
