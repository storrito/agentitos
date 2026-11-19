// The repair stage of `voice.mjs clean`: everything that mends a recording without deciding how
// loud it is. From the raw file to a mended intermediate (48 kHz, one channel, 32-bit float WAV),
// in this order, each step only when `measure` gives a reason for it and with its strength taken
// from the measured numbers:
//
//   channels   two channels to one: the other when one is silent, one when one is the other
//              inverted (a sum would cancel the voice) or the same signal twice or one is 20 dB
//              and more under the other (dead but for noise), else their mean
//   declip     adeclip on the peaks at the measured ceiling
//   highpass   a high-pass at 80 Hz for every recording, steeper when rumble or thumps stand
//              out; a DC offset subtracted before it
//   dehum      a narrow notch on every mains harmonic that was found, as deep as it stands out
//   declick    adeclick, its threshold set over a plosive's release
//   denoise    as much reduction as it takes to bring the noise 45 dB under the speech, never
//              more than the method takes without artefacts, by one of:
//                afftdn-sample   afftdn, its noise's shape sampled from the recording's own
//                                longest pause (laid in front, sampled, cut off again); the
//                                default when a pause of PAUSE_MIN_S exists
//                afftdn-profile  afftdn, its noise's shape (bn) the pauses' spectrum as
//                                `measure` has it; the default without such a pause
//                afftdn-track    the same with afftdn's own tracking (tn=1): kept to compare;
//                                its tracker pulls the floor far under the noise (on hiss it
//                                took 1 dB of 15 asked, 2026-11-19)
//                arnndn          RNNoise, only with a model named in VOICE_SOUND_RNNOISE (the
//                                skill ships none); the default for noise that changes
//              afftdn's floor (nf) is always set from the measured noise: a sampled profile
//              gives afftdn only the noise's shape, never its level (af_afftdn.c, reduce_mean)
//
//   repairPlan(m, opts)                → { steps, left, method, graph, inputs }   nothing run
//   repair(file, outWav, m, opts)      → { steps, left, method, graph }           one ffmpeg
//
// m is what `measure` returned for the file. opts: denoise "auto" | "off" | "gentle" | "strong"
// (default "auto"); method "afftdn-sample" | "afftdn-profile" | "afftdn-track" | "arnndn" | "off"
// (default: chosen; for experiments also VOICE_SOUND_DENOISE); after: a filter string run at the end of the same
// pass (the tone stage's EQ and de-esser), or ""; progress(seconds) is called as ffmpeg goes.
// steps: [{id, why, …the numbers used}]; left: [{id, why}], what no filter here removes, each in
// one sentence an agent can pass on.
//
// One ffmpeg process, streamed: a three-hour recording is never held in memory (the one buffer
// is the pause laid in front, at most PAUSE_MAX_S). The output is exactly as long as the file's
// sound decoded at 48 kHz (as `measure` decodes it) and in step with it to the sample: the
// filters with a delay (afftdn 1200 samples, arnndn 480: the same in ffmpeg 6.1, 8.0 and 9.0,
// measured 2026-11-19) get that much silence after the end and lose it at the start, and the
// output is cut to the length of the input by mixing it with the input at weight 0 (amix,
// shortest). The rest (pan, adeclip, highpass, equalizer, adeclick) delays nothing.
//
// Never anlmdn: in ffmpeg 9.0.2 it ends with a memory error on every input (2026-11-19).

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { Refusal } from "./analyse.mjs";
import {
  findingsOf, CHANNEL_STRONG_DB, INVERTED_SOME_DB, CLIP_STRONG_SHARE, HUM_SOME_DB, RUMBLE_SOME_DB,
} from "./findings.mjs";

const refuse = (msg) => { throw new Refusal(msg); };
export const RATE = 48000;

// ---------------------------------------------------------------- the numbers that set the steps

// denoise. The aim: the noise in the pauses 45 dB under the speech. ACX (Audible) asks for speech
// at −18 to −23 dBFS RMS over a floor under −60 dBFS: about 40 dB, and a voice levelled to
// −14 LUFS for the platforms brings its floor up with it, so a little more.
export const DENOISE_AIM_DB = 45;
// The caps, dB of broadband reduction a method takes before its artefacts (watery, chirping
// "musical noise", a dulled voice) cost more than the noise it removes. Engineers name about 6 to
// 12 dB as safe for spectral subtraction; the lab's corpus (voice-v1, tune split, 2026-11-19:
// see agentitos-lab/voice/try-repair.mjs) set the numbers within that.
export const DENOISE_CAPS = {
  "afftdn-sample": { gentle: 6, auto: 12, strong: 18 },
  "afftdn-profile": { gentle: 6, auto: 12, strong: 18 },
  "afftdn-track": { gentle: 6, auto: 10, strong: 15 },
  arnndn: { gentle: 6, auto: 15, strong: 25 },
};
// under this much reduction a denoiser is not worth its artefacts
const DENOISE_MIN_DB = 3;
// a pause to take the profile from: at least this long, and at most this much of it is used
export const PAUSE_MIN_S = 0.4;
export const PAUSE_MAX_S = 8;
// afftdn's own knobs: gs smooths the gains between neighbouring bins (against musical noise),
// ad how fast the gains follow (0.5 is ffmpeg's default)
export const AFFTDN_GS = 8;
// how far over the noise's measured level afftdn's floor is set (see afftdnFloor)
export const NF_OFFSET_DB = 6;

// the filters' delays at 48 kHz, in samples (the same in 6.1, 8.0 and 9.0, 2026-11-19)
const DELAY = { afftdn: 1200, arnndn: 480 };

// highpass: speech has little under 80 Hz (Byrne et al. 1994: the 63 and 80 Hz bands 20 dB and
// more under 500 Hz, about 28 dB under 300–3000 Hz). A low male voice's fundamental lies at 85 to
// 100 Hz: never higher than 90 Hz. Butterworth sections (their Q) for 12, 24 and 36 dB an octave.
export const HIGHPASS_HZ = 80;
const HIGHPASS_MAX_HZ = 90;
const SPEECH_BELOW_80_DB = -28;
const BUTTERWORTH = { 2: [0.7071], 4: [0.5412, 1.3066], 6: [0.5176, 0.7071, 1.9319] };

// dehum: a notch per harmonic as deep as it stands over its surroundings and 6 dB more (so that
// the line ends under the noise beside it, not level with it), at most 40 dB. ffmpeg's equalizer
// takes its width between the half-depth points (the core); a cut of g dB takes 3 dB off over
// the core divided by 10^(g/40) (a 30 dB cut with a core of 2.5 Hz: 14 Hz). The core cannot be
// narrower: a notch rings for about 1/(π·core) seconds, and with a core of 0.6 Hz a voice's
// fundamental passing through 100 Hz left a 100 Hz tone 28 dB over the noise in every pause
// after it (the synthetic voice, 2026-11-19); from 2.5 Hz none. It widens with the harmonic,
// since the mains frequency wanders (49.9–50.1 Hz is ±0.45 Hz at the 9th).
export const HUM_EXTRA_DB = 6;
const HUM_MAX_DB = 40;
const humCore = (n) => r2(2.5 + 0.2 * n);
const width3dB = (core, depth) => r1(core / 10 ** (-depth / 40));
const HUM_COUNTS_DB = 6;    // a harmonic `measure` counts

// declick: adeclick's threshold (the AR model's residual against its spread). ffmpeg's default 2
// takes plosive releases and the onsets of "t" and "k" for clicks; the lab's clean speech is left
// alone from about 8 on (try-repair.mjs)
export const DECLICK_T = 8;

// declip: adeclip marks a window's samples clipped when its histogram's top bin holds `t` times
// the bin under it. The gain before it lifts the measured ceiling to full scale, so that every
// sample at the ceiling lands in the top bin (adeclip counts everything over 1.0 there); the
// samples within CLIP_BELOW_DB under it count with them (a codec or a resampler smears the
// ceiling by tenths of a dB).
const CLIP_BELOW_DB = { exact: 0.1, smeared: 0.5 };
export const DECLIP_T = 3;
// after it the old ceiling sits at most at −6 dBFS: the rebuilt peaks rise over it by a few dB.
// (The whole graph is 32-bit float and nothing in it clips; the headroom is for whoever reads the
// intermediate with integer samples.)
const DECLIP_HEADROOM_DB = -6;

// ---------------------------------------------------------------- ffmpeg

let known = null;
function filtersOf() {
  if (known) return known;
  const r = spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.error?.code === "ENOENT") refuse("ffmpeg is missing: this tool needs ffmpeg on the PATH.");
  known = new Set();
  for (const line of (r.stdout || "").split("\n")) {
    const m = line.match(/^\s*[.A-Z|]{2,4}\s+(\w+)\s+\S+->\S+/);
    if (m) known.add(m[1]);
  }
  return known;
}
export function checkFilters(names) {
  const have = filtersOf();
  const missing = names.find((n) => !have.has(n));
  if (missing) refuse(`The ffmpeg on the PATH has no ${missing} filter, which repairing a voice needs: use a full build of ffmpeg 6.1 or newer.`);
}

// a value inside a filter's option (level 1) inside the filtergraph (level 2), as ffmpeg's
// "Notes on filtergraph escaping" have it
const escOpt = (s) => s.replace(/[\\':]/g, (c) => `\\${c}`);
const escGraph = (s) => s.replace(/[\\'[\],;]/g, (c) => `\\${c}`);
const esc = (s) => escGraph(escOpt(s));

// ---------------------------------------------------------------- the plan

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const minus = (s) => String(s).replace(/^-/, "−");
const dB = (x) => minus(Math.round(x));
const db1 = (x) => minus(r1(x).toFixed(1));
const pct = (x) => (x >= 0.01 ? `${+(x * 100).toFixed(1)} %` : `${+(x * 100).toPrecision(2)} %`);
const METHODS = ["afftdn-sample", "afftdn-profile", "afftdn-track", "arnndn", "off"];
const STRENGTHS = ["auto", "off", "gentle", "strong"];

export function repairPlan(m, opts = {}) {
  const strength = opts.denoise ?? "auto";
  if (!STRENGTHS.includes(strength)) refuse(`--denoise takes ${STRENGTHS.join(", ")}, not ${strength}.`);
  const asked = opts.method || process.env.VOICE_SOUND_DENOISE || null;
  if (asked && !METHODS.includes(asked)) refuse(`The denoise method is one of ${METHODS.join(", ")}, not ${asked}.`);
  // (opts.tune: the lab's knobs, for try-repair.mjs only)
  const tune = { nfOffsetDb: NF_OFFSET_DB, gs: AFFTDN_GS, ...opts.tune };
  const findings = m.findings ?? findingsOf(m);
  const has = (id) => findings.find((f) => f.id === id);
  const steps = [], left = [], chain = [];
  const inChannels = m.sound?.channels ?? m.analysed?.channels ?? 1;
  let gain = 1;              // the linear gain so far (declip's), for the DC offset and the floor

  // 1. the channels. (More than two are first mixed to two by ffmpeg, as `measure` reads them.)
  const head = [`aresample=${RATE}`];
  let pick = null;           // the pan coefficients of the analysed left and right
  if (inChannels >= 2) {
    const c = m.channels || {};
    const louder = (c.levelDifferenceDb ?? 0) >= 0 ? "left" : "right";
    const one = (side) => (side === "left" ? [1, 0] : [0, 1]);
    const apart = Math.abs(c.levelDifferenceDb ?? 0);
    let why;
    if (c.silentChannel) {
      const other = c.silentChannel === "left" ? "right" : "left";
      pick = one(other); why = `The ${c.silentChannel} channel is silent: the ${other} one alone.`;
    } else if (has("inverted") || ((c.monoLossDb ?? 0) <= INVERTED_SOME_DB && (c.correlation ?? 0) < 0)) {
      pick = one(louder); why = `One channel is the other inverted (a mono mix loses ${dB(-(c.monoLossDb ?? 0))} dB): the ${louder} one alone, never their sum.`;
    } else if (c.identical) {
      pick = [1, 0]; why = "The two channels are the same signal: one of them.";
    } else if (apart >= CHANNEL_STRONG_DB) {
      pick = one(louder); why = `The ${louder} channel is ${dB(apart)} dB louder, the other all but dead: the ${louder} one alone.`;
    } else {
      pick = [0.5, 0.5]; why = `Two channels${c.correlation != null ? ` (correlation ${c.correlation})` : ""}: their mean, one centred voice.`;
    }
    if (inChannels > 2) head.push("aformat=channel_layouts=stereo");
    const [a, b] = pick;
    head.push(`pan=mono|c0=${a === 1 ? "c0" : b === 1 ? "c1" : `${a}*c0+${b}*c1`}`);
    steps.push({ id: "channels", why, channels: inChannels, take: a === 1 ? "left" : b === 1 ? "right" : "mean", ...(c.correlation != null && { correlation: c.correlation }), ...(c.levelDifferenceDb != null && { levelDifferenceDb: c.levelDifferenceDb }) });
  } else head.push("aformat=channel_layouts=mono");

  // 2. clipping. adeclip models the signal around each clipped run as autoregressive and draws
  // the run in from both sides: short runs of a few to some tens of samples (a peak flattened by
  // a few dB) come back close to the original's shape and rise over the old ceiling; long flat
  // runs (clipped by 12 dB and more, 1 % of the samples and more) come back smoother but not
  // as they were: the harshness drops, the distortion's damage to the vowels' spectrum stays.
  // Clipping a codec has since smoothed (the flat runs gone) is out of its reach.
  const clip = has("clipped");
  if (clip && m.clipping?.ceilingDb != null) {
    const c = m.clipping;
    const exact = (c.exactShare ?? 0) >= 1e-4;
    const level = c.ceilingDb - (exact ? CLIP_BELOW_DB.exact : CLIP_BELOW_DB.smeared);
    const share = Math.max(c.pileUp >= 3 ? c.share : 0, c.exactShare ?? 0);
    // the AR model's order: the longer the runs, the more of the signal around them it needs
    const order = share >= 0.01 ? 16 : share >= CLIP_STRONG_SHARE ? 12 : 8;
    const up = -level, back = Math.min(0, DECLIP_HEADROOM_DB - c.ceilingDb);
    chain.push(`volume=${r2(up)}dB`, `adeclip=w=55:o=75:a=${order}:t=${DECLIP_T}:n=1000`, `volume=${r2(back - up)}dB`);
    gain *= 10 ** (back / 20);
    steps.push({
      id: "declip", why: `Clipped on ${pct(share)} of the samples at ${db1(c.ceilingDb)} dBFS: adeclip redraws the peaks from ${db1(level)} dBFS up (order ${order}), the old ceiling then at ${db1(c.ceilingDb + back)} dBFS.`,
      share, ceilingDb: c.ceilingDb, fromDb: r2(level), arOrder: order, threshold: DECLIP_T, gainDb: r2(back),
    });
    if (share >= CLIP_STRONG_SHARE) left.push({ id: "clipped", why: `Clipped hard (${pct(share)} of the samples): the peaks are redrawn, but the distortion of long flat runs is not undone; some roughness stays.` });
  }

  // 3. DC and the low end
  const dcMono = pick ? pick[0] * (m.dc?.values?.[0] ?? 0) + pick[1] * (m.dc?.values?.[1] ?? 0) : (m.dc?.values?.[0] ?? 0);
  const dc = has("dc") && Math.abs(dcMono) > 0 ? dcMono * gain : 0;
  if (dc) chain.push(`dcshift=shift=${(-dc).toPrecision(4)}`);
  const lo = m.low || {};
  const hummed = m.hum?.hz && m.hum.overDb >= HUM_SOME_DB;
  const rumbly = Math.max(lo.below80Db ?? -99, hummed ? -99 : lo.pauses80Db ?? -99);
  const thumps = has("thumps");
  let poles = 2, hz = HIGHPASS_HZ;
  const need = has("rumble") ? rumbly - SPEECH_BELOW_80_DB : 0;
  // what 2, 4 and 6 poles at 80 Hz take off at 50 Hz: about 9, 16 and 25 dB
  if (need > 9 || thumps) poles = 4;
  if (need > 16) poles = 6;
  if (need > 25) hz = HIGHPASS_MAX_HZ;
  for (const q of BUTTERWORTH[poles]) chain.push(`highpass=f=${hz}:t=q:w=${q}`);
  const reasons = [];
  if (has("rumble")) reasons.push(`rumble ${dB(-rumbly)} dB under the voice's middle`);
  if (thumps) reasons.push(`${lo.thumps?.count ?? "some"} thumps`);
  if (dc) reasons.push(`a DC offset of ${(+dcMono.toPrecision(2))} subtracted first`);
  steps.push({
    id: "highpass", why: `${hz} Hz, ${poles * 6} dB an octave${reasons.length ? `: ${reasons.join(", ")}` : ": speech has little under 80 Hz, a recording's rumble much"}.`,
    hz, poles, ...(has("rumble") && { rumbleDb: rumbly }), ...(thumps && { thumps: lo.thumps?.count }), ...(dc && { dc: +dcMono.toPrecision(3) }),
  });

  // 4. hum
  const h = m.hum;
  if (has("hum") && h?.hz) {
    const list = (h.hz === 50 ? h.at50 : h.at60) || [];
    let lines = list.filter((x) => x.overDb >= HUM_COUNTS_DB);
    if (!lines.length) lines = [{ n: 1, hz: h.hz, overDb: h.overDb }];
    const notches = lines.map((x) => {
      const depthDb = r1(Math.min(HUM_MAX_DB, x.overDb + HUM_EXTRA_DB)), coreHz = humCore(x.n);
      return { hz: x.hz, depthDb, coreHz, widthHz: width3dB(coreHz, depthDb) };
    });
    for (const x of notches) chain.push(`equalizer=f=${x.hz}:t=h:w=${x.coreHz}:g=${-x.depthDb}`);
    const harm = notches.length - 1;
    steps.push({
      id: "dehum", why: `Hum at ${h.hz} Hz${harm ? ` with ${harm} harmonic${harm === 1 ? "" : "s"}` : ""}, up to ${dB(h.overDb)} dB over its surroundings: ${notches.length} narrow notch${notches.length === 1 ? "" : "es"}, ${dB(Math.min(...notches.map((x) => x.depthDb)))} to ${dB(Math.max(...notches.map((x) => x.depthDb)))} dB deep.`,
      hz: h.hz, overDb: h.overDb, notches,
    });
  }

  // 5. clicks
  if (has("clicks")) {
    const k = m.clicks || {};
    chain.push(`adeclick=w=55:o=75:a=2:t=${DECLICK_T}:b=1`);
    steps.push({
      id: "declick", why: `${k.over?.[30] ?? k.count ?? "Some"} clicks standing 30 dB and more over their neighbourhood: adeclick, its threshold over a plosive's release.`,
      clicks: k.over?.[30] ?? k.count ?? null, threshold: DECLICK_T,
    });
  }

  // 6. noise
  const n = m.noise, L = m.levels || {};
  const snr = L.snrADb ?? L.snrDb;
  const pause = (m.speech?.longest || []).find((p) => !p.silent && p.seconds >= PAUSE_MIN_S) || null;
  const model = process.env.VOICE_SOUND_RNNOISE || null;
  let method = "off", den = null, inputs = [{ input: 0, what: "the file" }];
  const noisy = has("noise") && snr != null;
  if (noisy && n?.kind === "changing")
    left.push({ id: "noise", why: `The noise changes (traffic, voices, a keyboard: it moves by ${db1(n.fluctuationDb ?? n.spreadDb ?? 0)} dB)${model && (asked ?? "arnndn") === "arnndn" ? ": RNNoise follows some of it, not all" : ": a filter that learns one noise cannot follow it, so some of it stays"}.` });
  if (noisy && strength !== "off" && asked !== "off") {
    method = asked ?? (n?.kind === "changing" && model ? "arnndn" : pause ? "afftdn-sample" : "afftdn-profile");
    if (method === "afftdn-sample" && !pause) refuse(`afftdn-sample needs a pause of at least ${PAUSE_MIN_S} s without speech to take the noise from, and this recording has none: use afftdn-profile.`);
    if (method === "arnndn" && !model) refuse("arnndn needs an RNNoise model: name its file in VOICE_SOUND_RNNOISE (the skill ships none).");
    if (method === "arnndn" && !fs.existsSync(model)) refuse(`VOICE_SOUND_RNNOISE names ${model}, which is not there.`);
    const level = strength === "auto" ? "auto" : strength;
    const cap = DENOISE_CAPS[method][level];
    const needed = DENOISE_AIM_DB - snr;
    const reduce = r1(Math.max(0, Math.min(needed, cap)));
    if (reduce >= DENOISE_MIN_DB) {
      const ends = r1(snr + reduce);
      den = { method, reduce };
      const tail = needed > cap ? `, as much as ${method} takes without artefacts` : "";
      if (method.startsWith("afftdn")) {
        // afftdn's noise is its floor (nf) plus a shape around it: a sampled profile, or `bn`,
        // gives only the shape (its mean taken out), never the level. The floor is the mean of
        // the pauses' level in afftdn's 15 bands, in its own units, after the steps before it
        const sampled = method === "afftdn-sample";
        const lv = afftdnLevels(n, (f) => highpassDb(f, hz, poles) + 20 * Math.log10(gain));
        const fl = afftdnFloor(lv, sampled, tune.nfOffsetDb);
        Object.assign(den, fl, { gs: tune.gs, tn: method === "afftdn-track" ? 1 : 0 });
        const numbers = { method, snrDb: snr, aimDb: DENOISE_AIM_DB, capDb: cap, reduceDb: reduce, floorDb: fl.nf, ...(fl.lift && { liftDb: fl.lift }) };
        if (sampled) {
          const from = r2(pause.from), seconds = r2(Math.min(PAUSE_MAX_S, pause.seconds - 0.03));
          den.pause = { from, seconds };
          steps.push({ id: "denoise", why: `Noise ${dB(snr)} dB under the speech${n?.kind ? `, ${n.kind}` : ""}: ${dB(reduce)} dB less${tail}, its profile from the pause at ${clockOf(from)} (${seconds.toFixed(1)} s).`, ...numbers, pause: den.pause });
          inputs.push({ input: 1, what: "the pause", from, seconds });
        } else {
          steps.push({ id: "denoise", why: `Noise ${dB(snr)} dB under the speech${n?.kind ? `, ${n.kind}` : ""}: ${dB(reduce)} dB less${tail}, afftdn with the pauses' spectrum as its noise${method === "afftdn-track" ? ", tracking it" : ""}${pause ? "" : " (no pause long enough to sample)"}.`, ...numbers, bands: fl.bn });
        }
      } else {
        den.mix = r2(1 - 10 ** (-reduce / 20));
        den.model = model;
        steps.push({ id: "denoise", why: `Noise ${dB(snr)} dB under the speech${n?.kind ? `, ${n.kind}` : ""}: RNNoise (${path.basename(model)}), mixed so that ${dB(reduce)} dB of it goes${tail}.`, method, snrDb: snr, aimDb: DENOISE_AIM_DB, capDb: cap, reduceDb: reduce, mix: den.mix, model: path.basename(model) });
      }
      if (needed > cap + 3) left.push({ id: "noise", why: `The noise was ${dB(snr)} dB under the speech; ${dB(reduce)} dB less is what ${method} takes without watery artefacts, so it ends about ${dB(ends)} dB under, short of the ${DENOISE_AIM_DB} dB aimed for.` });
    } else method = "off";
  } else if (noisy) left.push({ id: "noise", why: `The noise stays ${dB(snr)} dB under the speech: denoising is off.` });

  // what no filter here takes away
  if (has("roomy")) left.push({ id: "roomy", why: `The room's reverberation (about ${m.room?.rt60?.toFixed(1) ?? "half a"} s) stays: none of ffmpeg's filters removes it; a closer microphone or a softer room next time.` });

  const after = (opts.after || "").trim();
  return { steps, left, method, ...graphOf(head, chain, den, after), inputs };
}

const clockOf = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

// the gain of an n-pole Butterworth high-pass at f, dB
const highpassDb = (f, fc, poles) => { const x = (f / fc) ** (2 * poles); return 10 * Math.log10(x / (1 + x)); };

// afftdn's 15 profile bands at 48 kHz (af_afftdn.c, config_input: 80 Hz, then ×1.5 + 5 rounded
// down to 10, 50, 100, 1000 Hz), each from centre / 1.2247 to centre × 1.2247
export const AFFTDN_BANDS = [80, 120, 180, 270, 410, 620, 930, 1400, 2100, 3150, 4750, 7100, 10700, 16000, 24000];
const VOICE_BANDS = [1, 11];             // 120 Hz – 7.1 kHz: where the floor must be right

// The pauses' noise in afftdn's units: per band, the mean power of an FFT bin of a 2048-point
// window, in dB, as finish_sample_noise() has it. For white noise of variance σ² that is
// 10·log10(σ²) − 3 dB in every band; so a band's level is the noise's density there (power a Hz)
// times 24 kHz, in dB, less 3. `measure` gives the pauses' power in its 31 bands; respDb(f) is
// what the steps before afftdn do to it (the high-pass, declip's gain). afftdn floors a bin at
// −82 dB (its sample_floor), which is where the bands of a band-limited source end up.
export function afftdnLevels(noise, respDb = () => 0) {
  const bands = (noise?.bands || []).filter((b) => Number.isFinite(b.db));
  return AFFTDN_BANDS.map((c) => {
    const lo = c / 1.224745, hi = Math.min(RATE / 2, c * 1.224745);
    let p = 0;
    for (const b of bands) {
      const o = Math.max(0, Math.min(hi, b.hi) - Math.max(lo, b.lo));
      if (o > 0) p += (10 ** (b.db / 10) * o) / (b.hi - b.lo);
    }
    return p > 0 ? 10 * Math.log10((p / (hi - lo)) * (RATE / 2)) - 3.01 + respDb(c) : -200;
  });
}

// a least-squares polynomial of degree 4 through the 15 bands, as afftdn smooths a sampled profile
function polyfit(y) {
  const n = y.length, K = 5;
  const A = [...Array(K)].map((_, j) => [...Array(K)].map((_, k) => y.reduce((s, _, i) => s + i ** (j + k), 0)));
  const b = [...Array(K)].map((_, j) => y.reduce((s, v, i) => s + v * i ** j, 0));
  for (let i = 0; i < K; i++) {                       // Gauss–Jordan, with partial pivoting
    let p = i; for (let r = i + 1; r < K; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let r = 0; r < K; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let k = i; k < K; k++) A[r][k] -= f * A[i][k]; b[r] -= f * b[i]; }
  }
  const c = b.map((v, i) => v / A[i][i]);
  return [...Array(n).keys()].map((i) => c.reduce((s, v, k) => s + v * i ** k, 0));
}

// afftdn's floor (nf) for these levels: the level its shape (sampled and smoothed, or `bn`, each
// with its mean taken out and clipped to ±24 dB) needs added to land on them in the voice's
// bands, plus `offset` (afftdn takes off its full `nr` only from about 8 dB over the noise's
// real level; at the level itself, half of it). nf must lie in −80…−20: a quieter or louder
// noise is lifted (`lift`, dB, a gain before afftdn taken back after it).
export function afftdnFloor(levels, sampled, offset = NF_OFFSET_DB) {
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const [a, b] = VOICE_BANDS;
  const floorOf = (lv) => {
    const clipped = lv.map((v) => Math.max(v, -82));   // afftdn's own floor, after any lift
    let shape;
    if (sampled) { const fit = polyfit(clipped), m = mean(fit); shape = fit.map((v) => Math.max(-24, Math.min(24, v - m))); }
    else { const m = mean(clipped), s = clipped.map((v) => Math.max(-24, Math.min(24, v - m))), m2 = mean(s); shape = s.map((v) => v - m2); }
    return { nf: mean(clipped.slice(a, b + 1).map((v, i) => v - shape[a + i])) + offset, shape };
  };
  // the lift from the voice's bands as they are, then the floor of the lifted noise
  const own = mean(levels.slice(a, b + 1)) + offset;
  const lift = own < -78 ? -78 - own : own > -22 ? -22 - own : 0;
  const { nf, shape } = floorOf(levels.map((v) => v + lift));
  return { nf: r1(Math.max(-80, Math.min(-20, nf))), lift: r1(lift), bn: shape.map((v) => r1(v)).join("|") };
}

// the filtergraph: [0:a] the file, [1:a] the pause (afftdn-sample only)
function graphOf(head, chain, den, after) {
  const tail = [after, `aformat=sample_fmts=flt:sample_rates=${RATE}:channel_layouts=mono`].filter(Boolean).join(",");
  const pre = head.join(",");
  const body = chain.join(",");
  const filters = new Set(["aresample", "aformat", ...[...head, ...chain].map((f) => f.split("=")[0])]);
  if (!den) return { graph: `[0:a]${[pre, body, tail].filter(Boolean).join(",")}[out]`, filters: [...filters] };
  filters.add("asplit").add("apad").add("atrim").add("asetpts").add("amix");
  const len = `[den][len]amix=inputs=2:duration=shortest:normalize=0:weights=1 0,${tail}[out]`;
  const main = (d) => `[0:a]${pre},asplit=2[m0][len];[m0]${[body, `apad=pad_len=${d}`].filter(Boolean).join(",")}`;
  // (a lift brings the noise into afftdn's range of floors, and is taken back after it)
  const lifted = (f) => (den.lift ? [`volume=${den.lift}dB`, f, `volume=${-den.lift}dB`] : [f]).join(",");
  if (den.method === "afftdn-sample") {
    filters.add("concat").add("asendcmd").add("afftdn").add("volume");
    const P = Math.round(den.pause.seconds * RATE), D = DELAY.afftdn;
    const stop = Math.max(0.05, (P - 2048) / RATE).toFixed(3);
    const g = [
      `${main(D)}[m]`,
      `[1:a]${[pre, body, `apad=whole_len=${P}`, `atrim=end_sample=${P}`].filter(Boolean).join(",")}[p]`,
      `[p][m]concat=n=2:v=0:a=1,asendcmd=c='0.0 afftdn@dn sn start;${stop} afftdn@dn sn stop',` +
        `${lifted(`afftdn@dn=nr=${den.reduce}:nf=${den.nf}:gs=${den.gs}`)},atrim=start_sample=${P + D},asetpts=PTS-STARTPTS[den]`,
      len,
    ];
    return { graph: g.join(";"), filters: [...filters] };
  }
  if (den.method !== "arnndn") {
    filters.add("afftdn").add("volume");
    const D = DELAY.afftdn;
    return { graph: [`${main(D)},${lifted(`afftdn=nr=${den.reduce}:nf=${den.nf}:nt=c:bn=${den.bn}:tn=${den.tn}:gs=${den.gs}`)},atrim=start_sample=${D},asetpts=PTS-STARTPTS[den]`, len].join(";"), filters: [...filters] };
  }
  // (arnndn works in blocks of 480 samples, and ffmpeg 9.0.2's writes NaN or values about 1e11
  // into the last one when the input ends inside it: 9 of 12 short corpus files, every model;
  // 4.4, 8.0 and 8.1 do not. asetnsamples with p=1 fills that block up with zeros, and amix
  // cuts the output back to the input's length.)
  filters.add("arnndn").add("asetnsamples");
  const D = DELAY.arnndn;
  return { graph: [`${main(D)},asetnsamples=n=480:p=1,arnndn=m=${esc(den.model)}:mix=${den.mix},atrim=start_sample=${D},asetpts=PTS-STARTPTS[den]`, len].join(";"), filters: [...filters] };
}

// ---------------------------------------------------------------- the run

export async function repair(file, outWav, m, opts = {}) {
  if (!fs.existsSync(file)) refuse(`There is no ${file}.`);
  const plan = repairPlan(m, opts);
  // (the filters of opts.after are the tone stage's to check)
  checkFilters(plan.filters);
  fs.mkdirSync(path.dirname(path.resolve(outWav)), { recursive: true });
  const args = ["-hide_banner", "-nostdin", "-v", "error", "-nostats", ...(opts.progress ? ["-progress", "pipe:2"] : []), "-y", "-i", file];
  const pause = plan.inputs.find((i) => i.input === 1);
  if (pause) args.push("-ss", String(pause.from), "-t", String(pause.seconds), "-i", file);
  args.push("-filter_complex", plan.graph, "-map", "[out]", "-map_metadata", "-1", "-fflags", "+bitexact",
    "-c:a", "pcm_f32le", "-rf64", "auto", "-f", "wav", outWav);
  const code = await new Promise((resolve) => {
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "", partial = "";
    p.stderr.setEncoding("utf8");
    p.stderr.on("data", (d) => {
      const lines = (partial + d).split("\n");
      partial = lines.pop();
      for (const line of lines) {
        const t = line.match(/^out_time_us=(\d+)/);
        if (t) opts.progress?.(Number(t[1]) / 1e6);
        else if (!/^[a-z0-9_]+=/.test(line) && line.trim()) err = (err + line + "\n").slice(-2000);
      }
    });
    p.on("error", (e) => resolve(e.code === "ENOENT" ? "missing" : String(e.message)));
    p.on("close", (c) => resolve(c === 0 ? 0 : err.trim().split("\n").pop() || `exit ${c}`));
  });
  if (code === "missing") refuse("ffmpeg is missing: this tool needs ffmpeg on the PATH.");
  if (code !== 0) refuse(`ffmpeg could not repair ${path.basename(file)} (${code}): check that it plays (ffprobe ${path.basename(file)}).`);
  // a filter that writes garbage (arnndn's last block in 9.0.2) must not reach a person's file
  const bad = await invalidSample(outWav);
  if (bad) {
    fs.rmSync(outWav, { force: true });
    refuse(`ffmpeg's filters wrote ${bad.value} at ${clockOf(bad.at)} of the repaired sound (${plan.method === "off" ? "the repair" : plan.method}): run it again with --denoise off or another method, and tell the skill's authors.`);
  }
  const { steps, left, method, graph } = plan;
  return { steps, left, method, graph };
}

// the first sample of a 32-bit float WAV that is no number or lies beyond ±16 (+24 dBFS: rebuilt
// peaks rise over full scale by a few dB, never by that), streamed; null when there is none
export async function invalidSample(wav, bound = 16) {
  const fd = fs.openSync(wav, "r");
  const head = Buffer.alloc(4096);
  const got = fs.readSync(fd, head, 0, 4096, 0);
  fs.closeSync(fd);
  let start = -1;
  for (let off = 12; off + 8 <= got;) {
    const id = head.toString("latin1", off, off + 4), size = head.readUInt32LE(off + 4);
    if (id === "data") { start = off + 8; break; }
    off += 8 + size + (size & 1);
  }
  if (start < 0) return { at: 0, value: "no data chunk" };
  let index = 0, carry = Buffer.alloc(0), found = null;
  for await (const chunk of fs.createReadStream(wav, { start, highWaterMark: 1 << 20 })) {
    const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const n = buf.length >> 2;
    const f = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + n * 4));
    for (let i = 0; i < n; i++) {
      const v = f[i];
      if (!(Math.abs(v) <= bound)) { found = { at: (index + i) / RATE, value: Number.isNaN(v) ? "NaN" : `a sample of ${v.toExponential(1)}` }; break; }
    }
    if (found) break;
    index += n;
    carry = buf.subarray(n * 4);
  }
  return found;
}
