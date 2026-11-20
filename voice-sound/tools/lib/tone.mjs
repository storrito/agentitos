// The tone stage of `voice.mjs clean`: a correction of what stands out in the voice's long-term
// spectrum, never a house sound. A recording whose tone lies within a normal voice's range is
// left exactly as it is: a step is planned only where lib/findings.mjs names a tone finding
// (dull, harsh, boomy, thin, sibilant), and each band takes back only half of its distance beyond
// what voices differ by among themselves.
//
//   tonePlan(m, opts)   m: the object `measure` returns; opts.tone "auto" | "off" (default
//                       "auto"); opts.denoised: true when the repair stage takes noise out;
//                       opts.noiseLeftDb: the signal-to-noise ratio expected after it (or null)
//                       → { steps: [{ id: "eq" | "deess", why, …the numbers used }], left: [{ id, why }] }
//                       an "eq" step: { for: <finding>, bands: [{ type: "bell" | "lowshelf" |
//                       "highshelf", hz, gainDb, q }], measured: [lo, hi], diffDb, changeDb } (the
//                       measure's band, its distance from a voice's average, the change aimed at);
//                       a "deess" step: { intensity, max, frequency, levelDb } (deesser's i, m, f,
//                       and the gain before it, taken back after it)
//   toneFilters(plan)   the plan as one ffmpeg filter string for a mono 48 kHz float stream ("" when
//                       there is nothing to do), a plain chain of filters and options that ffmpeg
//                       4.4, 6.1, 8.0 and 9.0 all have (equalizer, lowshelf, highshelf, volume, deesser)
//   responseDb(bands, hz)  the bands' combined response at hz (dB), as ffmpeg's biquads have it
//   bandChangeDb(bands, lo, hi)  how far the bands move the measure's band lo–hi (its power against
//                       300–3000 Hz, for a voice of the average spectrum), dB
//
// Pure functions, no I/O.

import { findingsOf, NOISE_SOME_DB, NARROW_BOTTOM_HZ, SIBILANT_SOME_DB, SIBILANT_STRONG_DB } from "./findings.mjs";

// Voices differ from the average speech spectrum by up to about ±5 dB a band (Byrne et al. 1994):
// a band is corrected only by what lies beyond that
export const TOLERANCE_DB = 5;
// the part of the distance beyond the tolerance a band takes back. Not all of it: a voice
// corrected all the way sounds like nobody; and the measure itself moves by a few dB between two
// short recordings of one speaker (the lab's clean speech: up to 8 dB at 2–4 kHz between two 7-s
// readings of one man), so half
export const SHARE = 0.5;
// bounds on a filter's own gain: a cut to 6 dB; a boost to 3 dB (the range engineers give for
// presence and air, +1 to 3 dB; a boost lifts whatever noise is there too); under 1 dB a band is
// not worth a filter, so a finding takes at least that
export const MAX_CUT_DB = 6;
export const MAX_BOOST_DB = 3;
export const MIN_GAIN_DB = 1;
// a band-limited source is judged and boosted only where it carries the voice: a band counts when
// it ends this far under the voice's top (a 16 kHz source, top 8 kHz, keeps 2–4 kHz and loses
// 4–8 kHz; a telephone keeps neither) and starts no lower than this far under its bottom
const UNDER_TOP = 1.25;
const OVER_BOTTOM = 0.75;

// The de-esser: ffmpeg's deesser (a port of Airwindows' DeEss) splits off the highs with a
// one-pole low-pass and divides them by a ratio while its detector (second differences of the
// samples) hears an "s"; at its default intensity (i=0) it does nothing. The detector reads the
// samples' absolute level, so the voice is brought to DEESS_LEVEL_LUFS before it and back after
// (−28: the lab's voices peak at −2 dBFS and under there; at −20 half of them went over full
// scale, where the filter's own tracking turns over). Its options were tried on the lab's
// sibilant voices (agentitos-lab voice/try-tone.mjs --grid, 2026-11-19: 24 copies of clean speech
// with +6 and +10 dB at 7 kHz, 12 clean ones): it acts like a threshold, nothing under i=0.4,
// 1.7 / 3.7 dB off the loudest "s" at 0.48, 2.7 / 5 dB at 0.52, steeply more beyond (at −20 LUFS
// i=0.5 took 10–13 dB, far under the speaker's own clean "s": a lisp), and more the more sibilant
// the voice. f=0.7 (the split near 4 kHz) leaves 2–4 kHz within 0.2 dB where 0.5 takes up to
// 1 dB; m hardly matters there. adynamicequalizer lowered the "s" no better, took more of
// 2–4 kHz and of clean voices, and its modes differ between ffmpeg 6.1 (cut, boost, direction)
// and 8.0/9.0 (cutabove, …), so it is not used.
export const DEESS_LEVEL_LUFS = -28;
export const DEESS_FREQUENCY = 0.7;
export const DEESS_MAX = 0.5;
export const DEESS_INTENSITY = [0.46, 0.54]; // for sibilance at the finding's threshold … at its strong one and over

const RATE = 48000;
const r1 = (x) => Math.round(x * 10) / 10;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const i0 = (x) => (x < 0 ? "−" : "") + Math.abs(Math.round(x));
const g1 = (x) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(r1(x));
const kHz = (hz) => (hz >= 1000 ? `${+(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`);
const range = (lo, hi) => (hi > 1000 ? `${lo / 1000}–${hi / 1000} kHz` : `${lo}–${hi} Hz`);

// RBJ's biquads as ffmpeg's equalizer, lowshelf and highshelf make them (t=q: alpha = sin w0 / 2Q)
function coefs({ type, hz, gainDb, q }) {
  const A = 10 ** (gainDb / 40), w = (2 * Math.PI * hz) / RATE, c = Math.cos(w), al = Math.sin(w) / (2 * q), sa = 2 * Math.sqrt(A) * al;
  if (type === "bell") return [1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A];
  if (type === "lowshelf") return [A * (A + 1 - (A - 1) * c + sa), 2 * A * (A - 1 - (A + 1) * c), A * (A + 1 - (A - 1) * c - sa),
    A + 1 + (A - 1) * c + sa, -2 * (A - 1 + (A + 1) * c), A + 1 + (A - 1) * c - sa];
  if (type === "highshelf") return [A * (A + 1 + (A - 1) * c + sa), -2 * A * (A - 1 + (A + 1) * c), A * (A + 1 + (A - 1) * c - sa),
    A + 1 - (A - 1) * c + sa, 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - sa];
  throw new Error(`no band type ${type}`);
}
function power(bands, hz) {
  const w = (2 * Math.PI * hz) / RATE, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  let p = 1;
  for (const b of bands) {
    const [b0, b1, b2, a0, a1, a2] = coefs(b);
    p *= ((b0 + b1 * c1 + b2 * c2) ** 2 + (b1 * s1 + b2 * s2) ** 2) / ((a0 + a1 * c1 + a2 * c2) ** 2 + (a1 * s1 + a2 * s2) ** 2);
  }
  return p;
}
export const responseDb = (bands, hz) => 10 * Math.log10(power(bands, hz));

// the average voice (ANSI S3.5-1997 table 3, normal effort: dB a Hz in third-octave bands, as
// lib/analyse.mjs weighs its reference), to weigh a band's frequencies by what speech has there
const ANSI_HZ = [160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000];
const ANSI_DB = [32.41, 34.48, 34.75, 33.98, 34.59, 34.27, 32.06, 28.3, 25.01, 23.0, 20.15, 17.32, 13.18, 11.55, 9.33, 5.31, 2.59, 1.13];
const density = (hz) => { let i = ANSI_HZ.findIndex((fc) => hz < fc * 2 ** (1 / 6)); if (i < 0) i = ANSI_HZ.length - 1; return 10 ** (ANSI_DB[i] / 10); };
const STEP = 10;
function bandPower(bands, lo, hi) {
  let p = 0, q = 0;
  for (let f = lo + STEP / 2; f < hi; f += STEP) { const d = density(f); p += d * power(bands, f); q += d; }
  return p / q;
}
export const bandChangeDb = (bands, lo, hi) => 10 * Math.log10(bandPower(bands, lo, hi) / bandPower(bands, 300, 3000));

// the filter gain that moves the measure's band(s) by `target` dB with the other `fixed` bands in
// place, bounded (a few rounds of a secant: the change is nearly proportional to the gain)
function solve(band, target, measured, fixed = []) {
  const change = (g) => measured.reduce((a, [lo, hi]) => a + bandChangeDb([...fixed, { ...band, gainDb: g }], lo, hi), 0) / measured.length
    - measured.reduce((a, [lo, hi]) => a + bandChangeDb(fixed, lo, hi), 0) / measured.length;
  let g = target;
  for (let k = 0; k < 4; k++) { const c = change(g); if (Math.abs(c) < 1e-6) break; g = g * (target / c); }
  g = target < 0 ? -clamp(-g, MIN_GAIN_DB, MAX_CUT_DB) : clamp(g, MIN_GAIN_DB, MAX_BOOST_DB);
  return { ...band, gainDb: r1(g), changeDb: r1(change(r1(g))) };
}
// the change aimed at: half of the distance beyond the tolerance, against its sign (0 within it)
const aim = (diff) => (Math.abs(diff) > TOLERANCE_DB ? -Math.sign(diff) * SHARE * (Math.abs(diff) - TOLERANCE_DB) : 0);

export function tonePlan(m, opts = {}) {
  const steps = [], left = [];
  if ((opts.tone ?? "auto") === "off") return { steps, left };
  const t = m?.tone;
  if (!t?.bands) return { steps, left: [{ id: "tone", why: "No speech to measure the tone on: the tone is left as it is." }] };
  const found = new Set((m.findings ?? findingsOf(m)).map((f) => f.id));
  const diff = (lo) => t.bands.find((b) => b.lo === lo)?.diff ?? null;
  // a step: its bands, the measure's band(s) it answers (the finding's own first), their distance
  // from a voice's average and the change the bands make there
  const eq = (finding, measured, d, bands, why) => {
    const own = finding === "boomy" ? measured.slice(0, 1) : measured;
    const plain = bands.map(({ changeDb, ...b }) => b);
    steps.push({ id: "eq", for: finding, why, bands: plain, measured: [own[0][0], own.at(-1)[1]], diffDb: r1(d),
      changeDb: r1(own.reduce((a, [lo, hi]) => a + bandChangeDb(plain, lo, hi), 0) / own.length) });
  };

  // what the source carries: a band-limited one is judged and boosted only where the voice is
  const bw = m.bandwidth ?? {};
  const narrow = found.has("narrow");
  const top = narrow && bw.topHz ? bw.topHz : Infinity;
  const bottom = bw.bottomHz ?? 0;
  const underTop = (hi) => hi * UNDER_TOP <= top;
  if (narrow) left.push({ id: "narrow", why: `Band-limited: the voice reaches only ${bottom >= NARROW_BOTTOM_HZ ? `from ${kHz(bottom)} ` : ""}to ${kHz(top)}; nothing is there to boost beyond that, so it stays as wide as it is.` });

  // a boost of the highs lifts the hiss with them when the noise is close under the speech
  const snr = m.levels?.snrADb ?? m.levels?.snrDb ?? null;
  const after = opts.denoised ? opts.noiseLeftDb ?? null : snr;
  const hissy = opts.denoised ? after == null || after < NOISE_SOME_DB : snr != null && snr < NOISE_SOME_DB;
  const hissWhy = after == null ? "how far the noise will lie under the speech after its removal is not known, and a boost of the highs would lift what is left of it"
    : `the noise lies ${i0(after)} dB under the speech${opts.denoised ? " even after its removal" : ""}, and a boost of the highs lifts its hiss`;

  // cuts first: boom and mud where the measure finds them (100–250, 250–500 Hz), harshness at 2–4 kHz
  if (found.has("boomy")) {
    const parts = [[[100, 250], 160, 1], [[250, 500], 350, 1.2]].filter(([[lo]]) => aim(diff(lo) ?? 0) < 0);
    const bands = [];
    for (const [[lo, hi], hz, q] of parts) bands.push(solve({ type: "bell", hz, q }, aim(diff(lo)), [[lo, hi]], bands));
    if (bands.length) eq("boomy", parts.map(([r]) => r), diff(100), bands,
      `boomy: ${parts.map(([[lo, hi]]) => `${range(lo, hi)} lie ${i0(diff(lo))} dB`).join(", ")} over a voice's average, so ${bands.map((b) => `${g1(b.gainDb)} dB at ${kHz(b.hz)}`).join(" and ")}.`);
  }
  const harsh = found.has("harsh") && aim(diff(2000)) < 0;
  if (harsh) {
    const b = solve({ type: "bell", hz: 3000, q: 1 }, aim(diff(2000)), [[2000, 4000]]);
    eq("harsh", [[2000, 4000]], diff(2000), [b], `harsh: 2–4 kHz lie ${i0(diff(2000))} dB over a voice's average, so ${g1(b.gainDb)} dB at 3 kHz.`);
  }

  // boosts: body for a thin voice where the voice has its lows, a shelf for a dull one
  if (found.has("thin")) {
    const lows = [[100, 250], [250, 500]].filter(([lo]) => aim(diff(lo) ?? 0) > 0);
    const carried = lows.filter(([lo]) => lo >= bottom * OVER_BOTTOM);
    if (!carried.length) left.push({ id: "thin", why: lows.length ? `thin, but the voice starts only at ${kHz(bottom)}: there is nothing of it under there to bring up.`
      : "thin, but no band lies beyond what voices differ by: left as it is." });
    else {
      const [lo, hi] = [carried[0][0], carried.at(-1)[1]];
      const d = Math.min(...carried.map(([l]) => diff(l)));
      const b = solve({ type: "bell", hz: Math.round(Math.sqrt(lo * hi) / 10) * 10, q: 0.7 }, aim(d), carried);
      eq("thin", carried, d, [b], `thin: ${range(lo, hi)} lie ${i0(-d)} dB under a voice's average, so ${g1(b.gainDb)} dB at ${kHz(b.hz)}.`);
    }
  }
  if (found.has("dull")) {
    const highs = [[2000, 4000], [4000, 8000]].filter(([lo, hi]) => underTop(hi) && diff(lo) != null);
    const d = highs.length ? highs.reduce((a, [lo]) => a + diff(lo), 0) / highs.length : null;
    const sib = found.has("sibilant");
    if (!highs.length || !(aim(d) > 0)) left.push({ id: "dull", why: narrow ? `dull only above ${kHz(top / UNDER_TOP)}, where the source ends: nothing there to boost.` : "dull, but no band lies beyond what voices differ by: left as it is." });
    else if (harsh || found.has("harsh") || sib) left.push({ id: "dull", why: `dull, but no boost of the highs: the voice is already ${found.has("harsh") ? "harsh" : "sibilant"}, and a presence boost would make it more so.` });
    else if (hissy) left.push({ id: "dull", why: `dull, but no boost of the highs: ${hissWhy}.` });
    else {
      // a shelf from 3 kHz when 2–4 kHz lie under too, else from 5 kHz (the air only); a
      // band-limited source a bell under its top instead, as a shelf would lift above it
      const presence = aim(diff(2000)) > 0 || highs.length === 1;
      const band = top < Infinity ? { type: "bell", hz: 3000, q: 1 } : { type: "highshelf", hz: presence ? 3000 : 5000, q: 0.707 };
      const b = solve(band, aim(d), highs);
      eq("dull", highs, d, [b], `dull: ${highs.map(([lo, hi]) => range(lo, hi)).join(" and ")} lie ${i0(-d)} dB under a voice's average, so ` +
        (b.type === "highshelf" ? `a shelf of ${g1(b.gainDb)} dB from ${kHz(b.hz)}.` : `${g1(b.gainDb)} dB at 3 kHz (nothing above, where the source ends).`));
    }
  }

  // the de-esser, when the loudest "s" stand out
  if (found.has("sibilant") && t.sibilanceDb != null) {
    const over = clamp((t.sibilanceDb - SIBILANT_SOME_DB) / (SIBILANT_STRONG_DB - SIBILANT_SOME_DB), 0, 1);
    const intensity = Math.round((DEESS_INTENSITY[0] + over * (DEESS_INTENSITY[1] - DEESS_INTENSITY[0])) * 100) / 100;
    const speech = m.levels?.speechLufs ?? m.loudness?.integratedLufs ?? DEESS_LEVEL_LUFS;
    const levelDb = r1(clamp(DEESS_LEVEL_LUFS - speech, -30, 40));
    steps.push({ id: "deess", intensity, max: DEESS_MAX, frequency: DEESS_FREQUENCY, levelDb,
      why: `sibilant: its loudest "s" reach ${r1(t.sibilanceDb)} dB against its vowels, so a de-esser on them (intensity ${intensity}).` });
  }
  return { steps, left };
}

const num = (x, d) => String(+x.toFixed(d));
export function toneFilters(plan) {
  const out = [];
  for (const s of plan?.steps ?? []) {
    if (s.id === "eq") {
      for (const b of s.bands) if (b.gainDb) out.push(`${b.type === "bell" ? "equalizer" : b.type}=f=${num(b.hz, 0)}:t=q:w=${num(b.q, 3)}:g=${num(b.gainDb, 1)}`);
    } else if (s.id === "deess") {
      const lv = s.levelDb ?? 0;
      if (lv) out.push(`volume=${num(lv, 1)}dB`);
      out.push(`deesser=i=${num(s.intensity, 2)}:m=${num(s.max, 2)}:f=${num(s.frequency, 2)}:s=o`);
      if (lv) out.push(`volume=${num(-lv, 1)}dB`);
    }
  }
  return out.join(",");
}
