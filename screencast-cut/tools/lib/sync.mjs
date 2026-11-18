// The sources of one recording on one clock. rragent's recorder writes when each source started
// (recording.json "started", milliseconds of the laptop's clock): the earliest is 0 of the
// recording's timeline, every other source starts that much later. The browser starts its
// recorders a few hundred milliseconds apart and its numbers are near, not exact; every source
// carries the microphone, so the offsets are made exact by laying each source's sound onto the
// main microphone's (the lag of the best correlation of their loudness envelopes, within ±1.5 s
// of what recording.json says). rragent's recorder stamped a source's start when its recorder
// said it had started, which for a phone's screen is its first picture, seconds or a minute after
// its file began with the others: when the sound does not match near that stamp, it is looked for
// near the main microphone's start too.
//
// A source's time s is the recording's time T = s + offset.

import { HOP } from "./voice.mjs";

const SEARCH = 1.5; // seconds either side of recording.json's offset
const SPAN = 180; // seconds of sound compared

// log loudness, the mean taken out, on the recording's timeline from 0 to SPAN
function curve(env, offset) {
  const n = Math.round(SPAN / HOP), out = new Float32Array(n), shift = Math.round(offset / HOP);
  for (let f = 0; f < n; f++) {
    const g = f - shift;
    out[f] = g >= 0 && g < env.length ? Math.log10(env[g] + 1e-4) : NaN;
  }
  let sum = 0, k = 0;
  for (const x of out) if (!Number.isNaN(x)) { sum += x; k++; }
  const mean = k ? sum / k : 0;
  for (let f = 0; f < n; f++) out[f] = Number.isNaN(out[f]) ? 0 : out[f] - mean;
  return out;
}

function correlation(a, b, lag) {
  let s = 0, aa = 0, bb = 0;
  for (let f = Math.max(0, -lag); f < a.length && f + lag < b.length; f++) {
    const x = a[f], y = b[f + lag];
    if (x === 0 || y === 0) continue;
    s += x * y; aa += x * x; bb += y * y;
  }
  return aa && bb ? s / Math.sqrt(aa * bb) : 0;
}

// The offset of `env` (a source starting at `offset` by recording.json) that lays its sound onto
// `main` (the main microphone's envelope, starting at `mainOffset`): { offset, moved, score }.
// A score under 0.5 is no match (another microphone, no speech): the offset stays.
export function align(main, mainOffset, env, offset) {
  const a = curve(main, mainOffset);
  // the best lag within SEARCH of `at`
  const near = (at) => {
    const b = curve(env, at), range = Math.round(SEARCH / HOP);
    let best = { at, lag: 0, score: correlation(a, b, 0) };
    for (let lag = -range; lag <= range; lag++) {
      const score = correlation(a, b, lag);
      if (score > best.score) best = { at, lag, score };
    }
    return best;
  };
  let best = near(offset);
  if (best.score < 0.5 && Math.abs(offset - mainOffset) > SEARCH) {
    const there = near(mainOffset);
    if (there.score > best.score) best = there;
  }
  if (best.score < 0.5) return { offset, moved: 0, score: +best.score.toFixed(2) };
  // b's sound at f + lag is a's at f: the source starts `lag` frames earlier than assumed
  const to = best.at - best.lag * HOP, moved = to - offset;
  return { offset: +to.toFixed(3), moved: +moved.toFixed(3), score: +best.score.toFixed(2) };
}

// How clearly a source's microphone carries the voice: loud speech over the room's floor, in dB.
export function clarity(env) {
  const sorted = Float32Array.from(env).sort();
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] || 1e-5;
  return +(20 * Math.log10(at(0.95) / Math.max(at(0.2), 1e-5))).toFixed(1);
}
