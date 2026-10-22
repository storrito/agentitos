// Subtitles as a file (.srt) for the platforms' own captions, to the usual rules of readable
// subtitles: at most two lines of 42 characters, at least 0.8 s and at most 6 s on screen, a cue
// breaks at the end of a sentence and at a pause of 0.6 s; it stays long enough to be read at 17
// characters a second where the next cue leaves room.

const LINE = 42, LINES = 2, CPS = 17, MIN = 0.8, MAX = 6, PAUSE = 0.6, GAP = 0.08;
const sentenceEnd = (text) => /[.!?…]["»”)]*$/.test(text);

// the text in at most two lines of at most 42 characters, broken at the space nearest the middle
function lines(text) {
  if (text.length <= LINE) return text;
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

export function cues(words) {
  const out = [];
  let cur = null;
  for (const [i, w] of words.entries()) {
    const prev = words[i - 1];
    const text = cur ? `${cur.text} ${w.text}` : w.text;
    if (!cur || sentenceEnd(prev.text) || w.start - prev.end >= PAUSE || text.length > LINE * LINES || w.end - cur.start > MAX) {
      cur = { start: w.start, end: w.end, text: w.text };
      out.push(cur);
    } else {
      cur.text = text;
      cur.end = w.end;
    }
  }
  // long enough to read, never into the next cue
  out.forEach((c, k) => {
    const next = out[k + 1]?.start ?? Infinity;
    c.end = Math.min(Math.max(c.end + 0.3, c.start + MIN, c.start + c.text.length / CPS), next - GAP);
  });
  return out;
}

const stamp = (t) => {
  const ms = Math.max(0, Math.round(t * 1000)), h = Math.floor(ms / 3600e3), m = Math.floor(ms / 60e3) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

export function srt(words) {
  return cues(words).map((c, k) => `${k + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${lines(c.text)}\n`).join("\n");
}
