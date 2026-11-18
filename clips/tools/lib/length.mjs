// What prepare can say about a moment's length before the edit: it knows only the span of its
// words in the episode. Cutting the pauses and "äh"s took 6 to 10 % off in our clips (deaths
// 79.3 → 71.0 s), so a span up to a tenth over the limit may fit after the build, one further over
// will not.

export const TIGHTENED = [0.9, 0.94];

// null when the moment will fit, else one sentence for the agent
export function lengthNote(span, longest) {
  const [lo, hi] = TIGHTENED.map((f) => span * f);
  if (span <= longest + 0.5) return null;
  if (lo <= longest) return `The moment's words span ${Math.round(span)} s; with its pauses cut it comes to about ${Math.round(lo)}–${Math.round(hi)} s, close to the ${longest} s a short may be here: build, and best-takes' check says the cut's length; leave sentences out in cut.json if it is over.`;
  return `⚠ The moment's words span ${Math.round(span)} s; with its pauses cut it stays over the ${longest} s a short may be here (about ${Math.round(lo)}–${Math.round(hi)} s): leave sentences out in cut.json before you build; best-takes' check names the length until it fits.`;
}
