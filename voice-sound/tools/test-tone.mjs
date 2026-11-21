// The tone stage (lib/tone.mjs): tonePlan on made-up measure objects (nothing stands out → nothing
// done; each finding alone → its band, in bounds and of the right sign; the three rules against a
// boost; "off"), then through ffmpeg on synthesised sound: the filter string is accepted, each
// band's measured response (white noise through it, against the same noise untouched) is the
// planned one within a dB, and the de-esser lowers loud 7 kHz bursts and leaves a 300 Hz tone
// alone. No request, no key, no network.
//
//   node --test tools/test-tone.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tonePlan, toneFilters, responseDb, bandChangeDb, TOLERANCE_DB, SHARE, MAX_CUT_DB, MAX_BOOST_DB, DEESS_LEVEL_LUFS } from "./lib/tone.mjs";
import { fftOf, split, hann } from "./lib/fft.mjs";

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const skip = !ffmpeg && "no ffmpeg";
const near = (x, y, by, what = "") => assert.ok(Math.abs(x - y) <= by, `${what} ${x} is not within ${by} of ${y}`);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

// a measure object as `measure` returns it, as far as tone reads it: every band at a voice's
// average unless given (diffs by the band's lower edge), findings left to lib/findings.mjs
const TONE = [[0, 100], [100, 250], [250, 500], [500, 1000], [1000, 2000], [2000, 4000], [4000, 8000], [8000, 16000]];
function made({ diffs = {}, sib = -5, snr = 50, top = 20000, bottom = 60, cliff = 40, speech = -20 } = {}) {
  const d = (lo) => diffs[lo] ?? 0;
  return {
    loudness: { integratedLufs: speech, rangeLu: 5, truePeakDb: -6 },
    levels: { speechLufs: speech, snrDb: snr, snrADb: snr },
    bandwidth: { topHz: top, bottomHz: bottom, cliffDb: cliff },
    tone: {
      bands: TONE.map(([lo, hi]) => ({ lo, hi, diff: lo < 100 || hi > 8000 ? null : d(lo) })),
      lowDiff: (d(100) + d(250)) / 2, highDiff: (d(2000) + d(4000)) / 2, presenceDiff: d(2000), sibilanceDb: sib,
    },
  };
}
const eqBands = (plan) => plan.steps.filter((s) => s.id === "eq").flatMap((s) => s.bands);
const boosts = (plan) => eqBands(plan).filter((b) => b.gainDb > 0);
const ONLY = /^(equalizer|lowshelf|highshelf|volume|deesser)=/;

test("nothing stands out, or only within what voices differ by: no step, no filter", () => {
  for (const m of [made(), made({ diffs: { 100: 4, 250: -4, 2000: 4.5, 4000: -4.5 }, sib: -1 }), made({ diffs: { 4000: 9 } })]) {
    const plan = tonePlan(m);
    assert.deepEqual(plan.steps, [], JSON.stringify(plan));
    assert.deepEqual(plan.left, []);
    assert.equal(toneFilters(plan), "");
  }
  assert.equal(toneFilters({ steps: [], left: [] }), "");
});

test("each finding alone: its band, a gain of the right sign within the bounds", () => {
  const cases = [
    ["dull", { diffs: { 2000: -10, 4000: -10 } }, "highshelf", +1, [2500, 5000]],
    ["harsh", { diffs: { 2000: 10 } }, "bell", -1, [2000, 4000]],
    ["boomy", { diffs: { 100: 10 } }, "bell", -1, [100, 250]],
    ["thin", { diffs: { 100: -12, 250: -12 } }, "bell", +1, [100, 500]],
  ];
  for (const [id, spec, type, sign, [lo, hi]] of cases) {
    const plan = tonePlan(made(spec));
    assert.equal(plan.steps.length, 1, `${id}: ${JSON.stringify(plan)}`);
    const [s] = plan.steps;
    assert.equal(s.id, "eq"); assert.equal(s.for, id);
    assert.equal(s.bands.length, 1);
    const [b] = s.bands;
    assert.equal(b.type, type, id);
    assert.equal(Math.sign(b.gainDb), sign, `${id} gain ${b.gainDb}`);
    assert.ok(sign > 0 ? b.gainDb <= MAX_BOOST_DB : -b.gainDb <= MAX_CUT_DB, `${id} gain ${b.gainDb}`);
    assert.ok(Math.abs(b.gainDb) >= 1, `${id} gain ${b.gainDb}`);
    assert.ok(b.hz >= lo && b.hz <= hi, `${id} at ${b.hz} Hz`);
    assert.ok(b.q > 0.3 && b.q <= 1.5, `${id}: wide, q ${b.q}`);
    assert.match(s.why, new RegExp(`^${id}: .+ dB .+\\.$`));
    assert.ok(!/NaN|undefined/.test(s.why), s.why);
    assert.deepEqual(plan.left, []);
    assert.ok(toneFilters(plan).split(",").every((f) => ONLY.test(f)), toneFilters(plan));
  }
  // the share: the whole distance beyond the tolerance, measured as the measure would see it
  assert.equal(SHARE, 1);
  const harsh = tonePlan(made({ diffs: { 2000: 10 } })).steps[0];
  near(harsh.changeDb, -(10 - TOLERANCE_DB), 0.15, "harsh: change aimed at");
  // bounded: far beyond the tolerance at the bounds and no further
  const far = tonePlan(made({ diffs: { 100: 40, 2000: 40 } }));
  assert.ok(eqBands(far).every((b) => b.gainDb >= -MAX_CUT_DB), JSON.stringify(eqBands(far)));
  assert.ok(eqBands(far).some((b) => b.gainDb === -MAX_CUT_DB), JSON.stringify(eqBands(far)));
  const dark = tonePlan(made({ diffs: { 2000: -30, 4000: -30 } }));
  assert.deepEqual(boosts(dark).map((b) => b.gainDb), [MAX_BOOST_DB], JSON.stringify(eqBands(dark)));
  // boom with mud: both bands cut where the measure finds them
  const muddy = tonePlan(made({ diffs: { 100: 12, 250: 9 } })).steps[0];
  assert.deepEqual(muddy.bands.map((b) => b.hz), [160, 350]);
  assert.ok(muddy.bands.every((b) => b.gainDb < 0));
  // only the air dull: a shelf from 5 kHz, not 3
  const air = tonePlan(made({ diffs: { 2000: -3, 4000: -14 } })).steps[0];
  assert.equal(air.bands[0].hz, 5000);
  // sibilant: a de-esser, stronger for stronger sibilance, the voice brought to its level and back
  const some = tonePlan(made({ sib: 2, speech: DEESS_LEVEL_LUFS - 10 })), strong = tonePlan(made({ sib: 9, speech: DEESS_LEVEL_LUFS - 10 }));
  for (const p of [some, strong]) {
    assert.equal(p.steps.length, 1); assert.equal(p.steps[0].id, "deess");
    assert.match(p.steps[0].why, /^sibilant: /);
  }
  assert.ok(strong.steps[0].intensity > some.steps[0].intensity);
  assert.equal(some.steps[0].levelDb, 10);
  assert.match(toneFilters(some), /^volume=10dB,deesser=i=[\d.]+:m=[\d.]+:f=[\d.]+:s=o,volume=-10dB$/);
});

test("no boost of the highs when the noise is close under the speech, unless its removal leaves it far", () => {
  const dull = { diffs: { 2000: -12, 4000: -12 } };
  const noisy = tonePlan(made({ ...dull, snr: 22 }));
  assert.deepEqual(boosts(noisy), []);
  assert.match(noisy.left.find((l) => l.id === "dull")?.why ?? "", /noise lies 22 dB under the speech.*hiss/);
  // removed down to 45 dB under: the shelf comes back; removed to an unknown distance: still none
  assert.equal(boosts(tonePlan(made({ ...dull, snr: 22 }), { denoised: true, noiseLeftDb: 45 })).length, 1);
  const unknown = tonePlan(made({ ...dull, snr: 22 }), { denoised: true, noiseLeftDb: null });
  assert.deepEqual(boosts(unknown), []);
  assert.match(unknown.left.find((l) => l.id === "dull").why, /not known/);
  assert.deepEqual(boosts(tonePlan(made({ ...dull, snr: 22 }), { denoised: true, noiseLeftDb: 25 })), []);
});

test("a band-limited source stays as wide as it is: nothing boosted above where the voice ends", () => {
  // a 16 kHz source (ends at 8 kHz): 4–8 kHz thin at the top is not dullness
  const sr16 = tonePlan(made({ diffs: { 4000: -20 }, top: 8000, cliff: 45 }));
  assert.deepEqual(boosts(sr16), []);
  assert.match(sr16.left.find((l) => l.id === "narrow").why, /8 kHz.*stays as wide as it is/);
  assert.ok(sr16.left.some((l) => l.id === "dull"));
  // …and dull where it does carry the voice (2–4 kHz): a bell under its top, no shelf over it
  const dark16 = tonePlan(made({ diffs: { 2000: -12, 4000: -25 }, top: 8000, cliff: 45 }));
  const [b] = boosts(dark16);
  assert.equal(b?.type, "bell", JSON.stringify(dark16));
  assert.ok(responseDb([b], 8000) < 0.5 * b.gainDb, "little of it reaches the top");
  // a telephone: 300 Hz to 4 kHz, dull and thin by its band alone: neither boosted
  const tel = tonePlan(made({ diffs: { 100: -26, 250: -3, 2000: -2, 4000: -30 }, top: 4000, bottom: 200, cliff: 30 }));
  assert.deepEqual(boosts(tel), [], JSON.stringify(tel));
  assert.match(tel.left.find((l) => l.id === "narrow").why, /from 200 Hz to 4 kHz/);
  assert.ok(tel.left.some((l) => l.id === "thin") && tel.left.some((l) => l.id === "dull"));
});

test("no presence boost on a voice already sibilant or harsh", () => {
  const sib = tonePlan(made({ diffs: { 2000: -12, 4000: -12 }, sib: 4 }));
  assert.deepEqual(boosts(sib), []);
  assert.deepEqual(sib.steps.map((s) => s.id), ["deess"]);
  assert.match(sib.left.find((l) => l.id === "dull").why, /already sibilant/);
  const harsh = tonePlan(made({ diffs: { 2000: 9, 4000: -30 } }));
  assert.deepEqual(boosts(harsh), []);
  assert.deepEqual(harsh.steps.map((s) => s.for), ["harsh"]);
  assert.match(harsh.left.find((l) => l.id === "dull").why, /already harsh/);
});

test("tone off: nothing, whatever stands out", () => {
  const plan = tonePlan(made({ diffs: { 100: 12, 2000: 12 }, sib: 9 }), { tone: "off" });
  assert.deepEqual(plan, { steps: [], left: [] });
  assert.equal(toneFilters(plan), "");
  assert.equal(tonePlan({ findings: [] }).steps.length, 0, "no tone measured");
});

// ---- through ffmpeg ------------------------------------------------------------------------

let dir;
before(() => { if (ffmpeg) dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-sound-tone-")); });
after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

// `graph` (a -filter_complex with the input [a] and the output [b] beside the input untouched),
// decoded as two channels: the untouched one and the one through the filters
function pair(source, filters) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", source, "-filter_complex",
    `[0:a]aformat=sample_fmts=flt:sample_rates=48000:channel_layouts=mono,asplit[a][b];[b]${filters || "anull"}[c];[a][c]amerge=inputs=2`,
    "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  assert.equal(r.status, 0, r.stderr?.toString());
  const x = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
  return x;
}
// the two channels' power spectra, averaged over windows of 8192 samples (5.9 Hz a bin)
const N = 8192;
function spectra(x) {
  const fft = fftOf(N), w = hann(N), re = new Float64Array(N), im = new Float64Array(N), out = [0, 0];
  const p0 = new Float64Array(N / 2), p1 = new Float64Array(N / 2);
  const frames = Math.floor(x.length / 2 / N) * 2 - 1;
  for (let f = 0; f < frames; f++) {
    const at = (f * N) / 2;
    for (let i = 0; i < N; i++) { re[i] = x[2 * (at + i)] * w[i]; im[i] = x[2 * (at + i) + 1] * w[i]; }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) { split(re, im, N, k, out); p0[k] += out[0]; p1[k] += out[1]; }
  }
  return { p0, p1, hz: (k) => (k * 48000) / N };
}
const bandDb = (s, p, lo, hi) => { let a = 0; for (let k = Math.ceil((lo * N) / 48000); k <= Math.floor((hi * N) / 48000); k++) a += s[p][k]; return 10 * Math.log10(a); };
// the measured response around hz (a sixth of an octave either side), against the planned one
// over the same frequencies
function check(bands, filters, hz) {
  const s = spectra(pair("anoisesrc=color=white:amplitude=0.2:r=48000:d=8:seed=7", filters));
  const lo = hz * 2 ** (-1 / 12), hi = hz * 2 ** (1 / 12);
  const got = bandDb(s, "p1", lo, hi) - bandDb(s, "p0", lo, hi);
  const fs_ = []; for (let f = lo; f <= hi; f += 5) fs_.push(10 ** (responseDb(bands, f) / 10));
  return { got, want: 10 * Math.log10(mean(fs_)) };
}

test("the filter string is accepted by ffmpeg, and each band responds as planned within a dB", { skip }, () => {
  const plans = {
    dull: made({ diffs: { 2000: -12, 4000: -12 } }), air: made({ diffs: { 4000: -16 } }), harsh: made({ diffs: { 2000: 13 } }),
    boomy: made({ diffs: { 100: 12, 250: 10 } }), thin: made({ diffs: { 100: -14, 250: -14 } }),
    narrow: made({ diffs: { 2000: -12, 4000: -25 }, top: 8000, cliff: 45 }),
  };
  for (const [name, m] of Object.entries(plans)) {
    const plan = tonePlan(m), filters = toneFilters(plan), bands = eqBands(plan);
    assert.ok(filters, `${name}: a filter`);
    for (const b of bands) {
      // at the band's own frequency (a shelf: an octave into it), the planned gain itself where it stands alone
      const hz = b.type === "highshelf" ? b.hz * 2 : b.type === "lowshelf" ? b.hz / 2 : b.hz;
      const { got, want } = check(bands, filters, hz);
      near(got, want, 1, `${name} at ${hz} Hz (${filters})`);
      if (bands.length === 1 && b.type === "bell") near(got, b.gainDb, 1, `${name}: the planned ${b.gainDb} dB`);
      if (b.type === "highshelf") near(check(bands, filters, 12000).got, b.gainDb, 1, `${name}: the shelf's ${b.gainDb} dB well above it`);
    }
    // and what the plan expects the measure to see in its band(s): the mean over the measure's tone bands there
    const s = plan.steps[0], inside = TONE.filter(([lo, hi]) => lo >= s.measured[0] && hi <= s.measured[1]);
    near(s.changeDb, mean(inside.map(([lo, hi]) => bandChangeDb(bands, lo, hi))), 0.1, `${name}: the change`);
  }
  // several findings at once (boom, mud and harshness): each centre as their sum predicts
  const plan = tonePlan(made({ diffs: { 100: 12, 250: 9, 2000: 12 } })), bands = eqBands(plan), filters = toneFilters(plan);
  assert.equal(bands.length, 3);
  for (const b of bands) { const { got, want } = check(bands, filters, b.hz); near(got, want, 1, `together, at ${b.hz} Hz`); }
});

test("the de-esser lowers loud 7 kHz bursts and leaves a 300 Hz tone alone", { skip }, () => {
  // a 300 Hz tone all through, a burst of noise around 7 kHz (80 ms) every half second
  const source = "sine=f=300:r=48000:d=8,volume=0.1[t];" +
    "anoisesrc=color=white:amplitude=0.5:r=48000:d=8:seed=11,bandpass=f=7000:width_type=q:w=2,bandpass=f=7000:width_type=q:w=2," +
    "volume='lt(mod(t,0.5),0.08)':eval=frame[s];[t][s]amix=inputs=2:normalize=0";
  const src = path.join(dir, "ess.wav");
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-filter_complex", source, "-c:a", "pcm_f32le", src], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const e = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", src, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
  const lufs = Number(e.stderr.slice(e.stderr.lastIndexOf("Summary:")).match(/I:\s+(-?[\d.]+) LUFS/)[1]);
  const down = [];
  for (const sib of [2, 8]) {
    const plan = tonePlan(made({ sib, speech: lufs }));
    const filters = toneFilters(plan);
    assert.match(filters, /deesser=i=/);
    const s = spectra(pair(`amovie=${src}`, filters));
    const ess = bandDb(s, "p1", 5000, 9000) - bandDb(s, "p0", 5000, 9000);
    const tone = bandDb(s, "p1", 250, 350) - bandDb(s, "p0", 250, 350);
    assert.ok(ess <= -1, `sibilance ${sib}: the bursts come down by ${ess.toFixed(1)} dB`);
    near(tone, 0, 0.5, `sibilance ${sib}: the tone`);
    down.push(ess);
  }
  assert.ok(down[1] < down[0] - 1, `more for more sibilance: ${down.map((x) => x.toFixed(1)).join(" and ")} dB`);
  // the same bursts 20 dB quieter (the voice brought to one level before the de-esser): the same
  const quiet = path.join(dir, "ess-quiet.wav");
  assert.equal(spawnSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-af", "volume=-20dB", "-c:a", "pcm_f32le", quiet]).status, 0);
  const s = spectra(pair(`amovie=${quiet}`, toneFilters(tonePlan(made({ sib: 8, speech: lufs - 20 })))));
  near(bandDb(s, "p1", 5000, 9000) - bandDb(s, "p0", 5000, 9000), down[1], 0.5, "20 dB quieter");
});
