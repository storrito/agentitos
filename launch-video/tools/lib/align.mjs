// The script's words on the times the voice says them. The speech model reads the script; Scribe
// hears what it said, with times, but spells it its own way ("Storito", "twenty twenty-six" for
// "2026"). So the two word lists are aligned (an edit distance over the words, letters and digits
// only, a near spelling as good as a match), and each word of the script takes the time of the
// word heard in its place. Between two such words, the script's words share the time of what was
// heard there ("2026" the time of "twenty twenty-six"); a heard word with no script word there
// (an "um") widens the word before it.
//
//   align(script, heard) → [{ text, start, end }]   script: a string; heard: [{ text, start, end }]

const norm = (t) => String(t).toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");

function distance(a, b) {
  if (a === b) return 0;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// 0 for the same word, a little for a near spelling, more than a gap's cost for another word
function cost(a, b) {
  if (a === b) return 0;
  if (!a || !b) return 1.2;
  const r = distance(a, b) / Math.max(a.length, b.length);
  return r <= 0.34 ? 0.3 : r <= 0.5 ? 0.9 : 1.6;
}

export function align(script, heard) {
  const words = String(script).split(/\s+/).filter(Boolean);
  const said = heard.filter((w) => norm(w.text));
  const n = words.length, m = said.length;
  const a = words.map(norm), b = said.map((w) => norm(w.text));
  const GAP = 1;
  const D = Array.from({ length: n + 1 }, (_, i) => Float64Array.from({ length: m + 1 }, (_, j) => (i ? (j ? 0 : i * GAP) : j * GAP)));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      D[i][j] = Math.min(D[i - 1][j - 1] + cost(a[i - 1], b[j - 1]), D[i - 1][j] + GAP, D[i][j - 1] + GAP);
  // back from the end: the pairs of the same (or nearly the same) word are the anchors
  const anchor = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const c = cost(a[i - 1], b[j - 1]);
    if (D[i][j] === D[i - 1][j - 1] + c) { if (c < 1) anchor.unshift([i - 1, j - 1]); i--; j--; }
    else if (D[i][j] === D[i - 1][j] + GAP) i--;
    else j--;
  }
  const out = words.map((text) => ({ text, start: null, end: null }));
  for (const [k, h] of anchor) Object.assign(out[k], { start: said[h].start, end: said[h].end });
  // between two anchors: the script words there share the time of the words heard there, by
  // their length; with nothing heard there, the time between the anchors
  const bounds = [[-1, -1], ...anchor, [n, m]];
  for (let q = 0; q + 1 < bounds.length; q++) {
    const [k0, h0] = bounds[q], [k1, h1] = bounds[q + 1];
    const S = k1 - k0 - 1, H = h1 - h0 - 1;
    if (H > 0 && S === 0 && k0 >= 0) out[k0].end = Math.max(out[k0].end, said[h1 - 1].end);
    if (S <= 0) continue;
    const from = H > 0 ? said[h0 + 1].start : k0 >= 0 ? out[k0].end : (said[0]?.start ?? 0);
    const to = H > 0 ? said[h1 - 1].end : k1 < n ? out[k1].start : Math.max(from + 0.3 * S, said.at(-1)?.end ?? 0);
    const lens = words.slice(k0 + 1, k1).map((w) => Math.max(1, norm(w).length));
    const total = lens.reduce((x, y) => x + y, 0);
    let t = from;
    lens.forEach((l, r) => {
      const d = Math.max(0, to - from) * (l / total);
      Object.assign(out[k0 + 1 + r], { start: t, end: t + d });
      t += d;
    });
  }
  return out.map((w) => ({ text: w.text, start: +w.start.toFixed(3), end: +Math.max(w.end, w.start + 0.04).toFixed(3) }));
}
