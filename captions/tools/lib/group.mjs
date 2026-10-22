// Words into caption groups, and how long each stays. A group breaks at the end of a sentence, at
// a pause, after a comma once it is half full (a phrase stays together), and before it grows past
// the style's words or characters; it starts when its first word is said and stays a little
// after its last, but never into the next group, and at least the style's minimum time when
// there is room.

const TAIL = 0.35;   // seconds a group stays after its last word
const GAP = 0.02;    // seconds between one group's end and the next one's start
const sentenceEnd = (text) => /[.!?…]["»”)]*$/.test(text);
const phraseEnd = (text) => /[,;:–—]["»”)]*$/.test(text);

// words: [{ text, start, end, ... }] in the video's time; returns [{ from, to, start, end }]
// (from–to: indexes of its first and last word, both included). First the phrases (a sentence,
// up to a pause or a comma); a phrase too long for one group is split into groups of about equal
// size ("Let me show | how it works.", not "Let me show how | it works.").
export function groups(words, { words: maxWords, chars: maxChars, pause, min }, duration = Infinity) {
  const phrases = [];
  let cur = null;
  words.forEach((w, i) => {
    const prev = words[i - 1];
    const breaks = !cur || sentenceEnd(prev.text) || w.start - prev.end >= pause || (phraseEnd(prev.text) && i - cur.from >= maxWords / 2);
    if (breaks) { cur = { from: i, to: i }; phrases.push(cur); } else cur.to = i;
  });
  const text = (a, b) => words.slice(a, b + 1).map((x) => x.text).join(" ");
  const out = [];
  for (const ph of phrases) {
    const n = ph.to - ph.from + 1;
    let k = Math.ceil(n / maxWords);
    while (k < n && Array.from({ length: k }, (_, j) => text(ph.from + Math.round((j * n) / k), ph.from + Math.round(((j + 1) * n) / k) - 1)).some((t) => t.length > maxChars)) k++;
    for (let j = 0; j < k; j++) out.push({ from: ph.from + Math.round((j * n) / k), to: ph.from + Math.round(((j + 1) * n) / k) - 1 });
  }
  out.forEach((g, k) => {
    const first = words[g.from], last = words[g.to], next = out[k + 1] ? words[out[k + 1].from].start : duration;
    g.start = first.start;
    const natural = Math.max(last.end + TAIL, first.start + min);
    g.end = Math.max(last.end, Math.min(natural, next - GAP, duration));
  });
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
