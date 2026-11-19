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
//                dpdfnet         a neural denoiser (DPDFNet-2 at 48 kHz, run by sherpa-onnx's
//                                offline denoiser), where the machine has both (neuralDenoiser
//                                below): then the default for every kind of noise. Not a filter
//                                of ffmpeg: the pass becomes two, round the program (see "The
//                                neural denoiser" further down)
//              afftdn's floor (nf) is always set from the measured noise: a sampled profile
//              gives afftdn only the noise's shape, never its level (af_afftdn.c, reduce_mean)
//
//   repairPlan(m, opts)                → { steps, left, method, graph, inputs }   nothing run
//   repair(file, outWav, m, opts)      → { steps, left, method, graph }           one ffmpeg
//                                        (dpdfnet: two, the denoiser between them)
//
// m is what `measure` returned for the file. opts: denoise "auto" | "off" | "gentle" | "strong"
// (default "auto"); method "afftdn-sample" | "afftdn-profile" | "afftdn-track" | "arnndn" |
// "dpdfnet" | "ffmpeg" (ffmpeg's own choice although the denoiser is there) | "off"
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
// shortest). The rest (pan, adeclip, highpass, equalizer, adeclick) delays nothing. With dpdfnet:
// a first pass to a float intermediate on disk, the denoiser on it in pieces of a few minutes
// (its memory under 300 MB however long the file), the pieces in step and cross-faded into a
// second intermediate exactly as long, a second pass with `after`; the same promises.
//
// Never anlmdn: in ffmpeg 9.0.2 it ends with a memory error on every input (2026-11-19).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
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
const METHODS = ["afftdn-sample", "afftdn-profile", "afftdn-track", "arnndn", "dpdfnet", "ffmpeg", "off"];
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
  // ("ffmpeg": ffmpeg's own choice below, as if the neural denoiser were not on the machine)
  const wants = asked === "ffmpeg" ? null : asked;
  // the neural denoiser: asked for, or the default where the machine has it
  const dn = noisy && strength !== "off" && (wants === "dpdfnet" || asked == null) ? neuralDenoiser() : null;
  if (wants === "dpdfnet" && noisy && strength !== "off" && !dn) refuse(`dpdfnet needs sherpa-onnx's offline denoiser and the DPDFNet-2 model (${DPDFNET_MODEL}): name them in VOICE_SOUND_DENOISER and VOICE_SOUND_DPDFNET (the skill ships neither).`);
  let neural = null;
  if (noisy && n?.kind === "changing" && !dn)
    left.push({ id: "noise", why: `The noise changes (traffic, voices, a keyboard: it moves by ${db1(n.fluctuationDb ?? n.spreadDb ?? 0)} dB)${model && (wants ?? "arnndn") === "arnndn" ? ": RNNoise follows some of it, not all" : ": a filter that learns one noise cannot follow it, so some of it stays"}.` });
  if (dn) {
    // its attenuation limit: what the aim needs, never more than --denoise allows (DPDFNET_LIMITS)
    const cap = DPDFNET_LIMITS[strength];
    const needed = DENOISE_AIM_DB - snr;
    const limit = r1(Math.max(0, Math.min(needed, cap)));
    if (limit >= DENOISE_MIN_DB) {
      method = "dpdfnet";
      const t = { ...NEURAL, ...opts.tune };
      const pauses = m.speech?.longest || [];
      const cut = piecesOf(Math.round((m.analysed?.seconds ?? m.duration ?? 0) * RATE), pauses, t);
      neural = { ...dn, limit, tune: t, pauses };
      const tail = needed > cap ? `, the most --denoise ${strength} allows (the aim needed ${dB(needed)})` : "";
      const many = cut.pieces.length > 1 ? `, in ${cut.pieces.length} overlapping pieces of up to ${Math.ceil(Math.max(...cut.pieces.map((p) => p.to - p.from)) / RATE / 60)} minutes` : "";
      steps.push({
        id: "denoise", why: `Noise ${dB(snr)} dB under the speech${n?.kind ? `, ${n.kind}` : ""}: a neural denoiser (DPDFNet-2) asked to take at most ${dB(limit)} dB off${tail}${many}.`,
        method, snrDb: snr, aimDb: DENOISE_AIM_DB, capDb: cap, reduceDb: limit, limitDb: limit, model: path.basename(dn.model),
        pieces: cut.pieces.map((p) => ({ from: r2(p.from / RATE), to: r2(p.to / RATE) })), seams: cut.seams.map((s) => ({ at: r2(s.at / RATE), pause: s.pause })),
      });
      if (n?.kind === "changing")
        left.push({ id: "noise", why: `The noise changes (traffic, voices, a keyboard: it moves by ${db1(n.fluctuationDb ?? n.spreadDb ?? 0)} dB): the neural denoiser took up to ${dB(limit)} dB off it, and what is left of it stays.` });
      if (needed > cap + 3) left.push({ id: "noise", why: `The noise was ${dB(snr)} dB under the speech; ${dB(limit)} dB less is as far as --denoise ${strength} lets the neural denoiser go, so it ends about ${dB(snr + limit)} dB under, short of the ${DENOISE_AIM_DB} dB aimed for.` });
    }
  } else if (noisy && strength !== "off" && wants !== "off") {
    method = wants ?? (n?.kind === "changing" && model ? "arnndn" : pause ? "afftdn-sample" : "afftdn-profile");
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
  if (neural) return { steps, left, method, ...neuralGraphs(head, chain, after), inputs, neural };
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
  let plan = repairPlan(m, opts);
  // the neural denoiser between two passes; where it fails, ffmpeg's method in one, as without it
  if (plan.neural) {
    checkFilters(plan.filters);
    try {
      return await neuralRepair(file, outWav, plan, opts);
    } catch (e) {
      if (!(e instanceof NeuralFailure)) throw e;
      plan = fallbackPlan(m, opts, e);
    }
  }
  // (the filters of opts.after are the tone stage's to check)
  checkFilters(plan.filters);
  fs.mkdirSync(path.dirname(path.resolve(outWav)), { recursive: true });
  const args = ["-hide_banner", "-nostdin", "-v", "error", "-nostats", ...(opts.progress ? ["-progress", "pipe:2"] : []), "-y", "-i", ffPath(file)];
  const pause = plan.inputs.find((i) => i.input === 1);
  if (pause) args.push("-ss", String(pause.from), "-t", String(pause.seconds), "-i", ffPath(file));
  args.push("-filter_complex", plan.graph, "-map", "[out]", "-map_metadata", "-1", "-fflags", "+bitexact",
    "-c:a", "pcm_f32le", "-rf64", "auto", "-f", "wav", ffPath(outWav));
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

// a file's name as ffmpeg's file protocol takes it: one that begins with a dash is no option, one
// with a colon no other protocol
const ffPath = (p) => `file:${path.resolve(p)}`;

// ---------------------------------------------------------------- the neural denoiser
//
// sherpa-onnx's offline denoiser (k2-fsa/sherpa-onnx 2.0.2) with DPDFNet-2 at 48 kHz
// (dpdfnet2_48khz_hr.onnx). ffmpeg's filters learn one steady noise; this follows one that
// changes: on twelve real recordings with a café or a keyboard behind the voice the background's
// score (DNSMOS BAK) went from 2.72 to 3.56 with it in front, 2.74 with afftdn (agentitos-lab,
// 2026-11-19). Run on every recording it harmed clean ones (band-limited, quiet, a channel fault:
// 0.4 to 0.6 PESQ lost), so it runs only where `measure` found noise. The skill ships neither the
// program nor the model; the tool never fetches or installs them. Where they are:
//
//   the program  VOICE_SOUND_DENOISER (a path, or a name on the PATH), else
//                sherpa-onnx-offline-denoiser on the PATH
//   the model    VOICE_SOUND_DPDFNET, else models/dpdfnet2_48khz_hr.onnx beside the folder of
//                the program's real file (a link followed: /opt/sherpa-onnx/bin/… gives
//                /opt/sherpa-onnx/models/…), else /opt/sherpa-onnx/models/dpdfnet2_48khz_hr.onnx
//
// What it does, measured with the real program on this corpus (2026-11-19):
// - it reads 16-bit and float WAV, writes 16-bit, one channel, 48 kHz; its output is as long as
//   its input rounded down to a whole number of 480-sample blocks (336123 samples gave 336000), and
//   an empty input ends it with a segmentation fault: every piece is padded with silence to a
//   whole number of blocks, half a second more, and cut back after it
// - its output is not delayed: the cross-correlation of output and input peaked at lag 0 on 21 of
//   21 real recordings (dns, fleurs, librivox; ±50 ms searched). It is causal: a piece's output
//   is the whole file's to the sample but for the last 50 ms block. The delay is still measured on
//   every run (the first piece's loudest second against ±50 ms) and taken out, so that another
//   build cannot put the voice out of step with the picture
// - a piece starts without the network's history: its output differs from the whole file's by
//   −11 to −24 dB in its first 0.2 s, −30 to −45 dB to about 2.5 s, and from about 3 s on no more
//   than two equally valid runs differ (the same input as 16-bit and as float). So each piece
//   after the first starts warmS (3 s) before the cross-fade and that part is thrown away; the
//   cross-fade (fadeS, 1 s, raised cosine, the two weights summing to one) sits on a pause where
//   `measure` knows one within shiftS of the cut
// - it holds the whole file in memory: about 55 MB and 78 MB a minute; pieces of pieceS
//   (150 s), at most 185 s with the overlaps and a cut moved to a pause, keep it under 300 MB
//   however long the recording; it takes about a seventh to a fifth of the sound's length on one
//   core, one thread (four were 17 % faster for four times the CPU)
// - its 16-bit output would cost a quiet recording its resolution and clip a hot one: its input
//   is brought to a peak of −6 dBFS (float) and that gain taken back after it
//
// Where it fails (a non-zero exit, a signal, no output, another length, silence, numbers that are
// not finite, clipping, an output that does not follow its input, longer than its time), the stage
// runs ffmpeg's method on the whole recording instead and says so in the denoise step.

export const DPDFNET_MODEL = "dpdfnet2_48khz_hr.onnx";
const DENOISER_PROGRAM = "sherpa-onnx-offline-denoiser";
const OPT_MODEL = `/opt/sherpa-onnx/models/${DPDFNET_MODEL}`;
// its attenuation limit (dB) by --denoise: the aim's need, never more than this. In the lab 18 kept
// some of the room and scored nearly as well as no limit; gentle takes off what afftdn's strong
// did, strong 6 dB more than auto (a voice in a café: DNSMOS's background 3.56 at 18)
export const DPDFNET_LIMITS = { gentle: 12, auto: 18, strong: 24 };
// the pieces (seconds) and the level for it (dBFS); the lab's knobs through opts.tune
export const NEURAL = { pieceS: 150, shiftS: 15, warmS: 3, fadeS: 1, tailS: 0.5, peakDb: -6 };
// its delay at 48 kHz in samples (0 measured) and how far either side it is looked for
const DPDFNET_DELAY = 0;
const DELAY_SEARCH = 2400;
const BLOCK = 480;
const CHUNK = 1 << 16;

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const runnable = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return isFile(p); } catch { return false; } };
function onPath(name, PATH = process.env.PATH || "") {
  for (const dir of PATH.split(path.delimiter)) if (dir && runnable(path.join(dir, name))) return path.join(dir, name);
  return null;
}

// → { program, model } where both are there, else null
export function neuralDenoiser(env = process.env) {
  const named = env.VOICE_SOUND_DENOISER;
  const program = named ? (named.includes("/") ? (runnable(named) ? path.resolve(named) : null) : onPath(named, env.PATH)) : onPath(DENOISER_PROGRAM, env.PATH);
  if (!program) return null;
  if (env.VOICE_SOUND_DPDFNET) return isFile(env.VOICE_SOUND_DPDFNET) ? { program, model: path.resolve(env.VOICE_SOUND_DPDFNET) } : null;
  let real = program;
  try { real = fs.realpathSync(program); } catch {}
  const beside = path.join(path.dirname(path.dirname(real)), "models", DPDFNET_MODEL);
  const model = isFile(beside) ? beside : isFile(OPT_MODEL) ? OPT_MODEL : null;
  return model ? { program, model } : null;
}

// The pieces of n samples: as many of at most pieceS + shiftS as it takes, equally long, each cut
// moved to the middle of the nearest pause `measure` knows within shiftS. Piece k starts warmS
// before the cross-fade into it and ends tailS after the cross-fade out of it.
// → { pieces: [{ from, to }] (samples), seams: [{ at, pause }] (the fades' middles), fade (samples) }
export function piecesOf(n, pauses = [], t = NEURAL) {
  const L = t.pieceS * RATE, R = t.shiftS * RATE;
  const half = Math.round((t.fadeS * RATE) / 2), warm = Math.round(t.warmS * RATE), tail = Math.round(t.tailS * RATE);
  const count = n <= L + R ? 1 : Math.ceil(n / L);
  const mids = (pauses || []).filter((p) => p && Number.isFinite(p.from) && Number.isFinite(p.to)).map((p) => Math.round(((p.from + p.to) / 2) * RATE));
  const seams = [];
  for (let k = 1; k < count; k++) {
    const aim = Math.round((k * n) / count);
    const near = mids.filter((x) => Math.abs(x - aim) <= R).sort((a, b) => Math.abs(a - aim) - Math.abs(b - aim))[0];
    seams.push(near != null ? { at: near, pause: true } : { at: aim, pause: false });
  }
  const pieces = [];
  for (let k = 0; k < count; k++)
    pieces.push({ from: k ? Math.max(0, seams[k - 1].at - half - warm) : 0, to: k < count - 1 ? Math.min(n, seams[k].at + half + tail) : n });
  return { pieces, seams, fade: 2 * half };
}

// the two passes round it: [0:a] the file to the denoiser's input; [0:a] its output to the end
function neuralGraphs(head, chain, after) {
  const one = graphOf(head, chain, null, "");
  const two = `[0:a]${[after, `aformat=sample_fmts=flt:sample_rates=${RATE}:channel_layouts=mono`].filter(Boolean).join(",")}[out]`;
  return { graph: one.graph, graphs: [one.graph, two], filters: [...new Set([...one.filters, "aformat"])] };
}

class NeuralFailure extends Error {}

// ffmpeg's method for the whole recording, the denoise step saying why
function fallbackPlan(m, opts, e) {
  const plan = repairPlan(m, { ...opts, method: "ffmpeg" });
  const said = `the neural denoiser failed (${e.message}), so ffmpeg's ${plan.method} did this for the whole recording`;
  const st = plan.steps.find((s) => s.id === "denoise");
  if (st) Object.assign(st, { why: `${st.why.replace(/\.$/, "")}; ${said}.`, fallback: { from: "dpdfnet", reason: e.message } });
  else plan.steps.push({ id: "denoise", why: `The ${said.replace(/, so .*/, "")}, and ffmpeg's method has nothing to take off here.`, method: "off", fallback: { from: "dpdfnet", reason: e.message } });
  return plan;
}

const WAV_OUT = ["-map_metadata", "-1", "-fflags", "+bitexact", "-c:a", "pcm_f32le", "-rf64", "auto", "-f", "wav"];

// one ffmpeg; → 0, "missing", or its last line of error
function ffmpegPass(args, progress) {
  return new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-nostdin", "-v", "error", "-nostats", ...(progress ? ["-progress", "pipe:2"] : []), "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "", partial = "";
    p.stderr.setEncoding("utf8");
    p.stderr.on("data", (d) => {
      const lines = (partial + d).split("\n");
      partial = lines.pop();
      for (const line of lines) {
        const t = line.match(/^out_time_us=(\d+)/);
        if (t) progress?.(Number(t[1]) / 1e6);
        else if (!/^[a-z0-9_]+=/.test(line) && line.trim()) err = (err + line + "\n").slice(-2000);
      }
    });
    p.on("error", (e) => resolve(e.code === "ENOENT" ? "missing" : String(e.message)));
    p.on("close", (c) => resolve(c === 0 ? 0 : err.trim().split("\n").pop() || `exit ${c}`));
  });
}

// the program on one piece; → null, or what went wrong in a few words
function runDenoiser(nr, inWav, outWav, seconds) {
  const args = [`--speech-denoiser-dpdfnet-model=${nr.model}`, "--num-threads=1", "--print-args=false",
    `--speech-denoiser-dpdfnet-attenuation-limit-db=${nr.limit}`, `--input-wav=${inWav}`, `--output-wav=${outWav}`];
  const limit = Math.round(120 + 4 * seconds);
  return new Promise((resolve) => {
    let p;
    try { p = spawn(nr.program, args, { stdio: ["ignore", "ignore", "ignore"] }); } catch (e) { resolve(`it could not be started (${e.code || e.message})`); return; }
    let late = false;
    const timer = setTimeout(() => { late = true; p.kill("SIGKILL"); }, limit * 1000);
    p.on("error", (e) => { clearTimeout(timer); resolve(`it could not be started (${e.code || e.message})`); });
    p.on("close", (code, sig) => {
      clearTimeout(timer);
      resolve(late ? `it took longer than ${limit} s` : sig ? `it ended on ${sig}` : code ? `it exited with ${code}` : null);
    });
  });
}

// a WAV file's format and where its samples lie (RIFF or RF64, PCM, float or extensible); null
// for anything else
function wavInfo(file) {
  let fd;
  try { fd = fs.openSync(file, "r"); } catch { return null; }
  try {
    const head = Buffer.alloc(65536), got = fs.readSync(fd, head, 0, head.length, 0), size = fs.fstatSync(fd).size;
    const riff = head.toString("latin1", 0, 4);
    if (got < 12 || (riff !== "RIFF" && riff !== "RF64") || head.toString("latin1", 8, 12) !== "WAVE") return null;
    let ds64 = null, fmt = null;
    for (let off = 12; off + 8 <= got;) {
      const id = head.toString("latin1", off, off + 4), sz = head.readUInt32LE(off + 4);
      if (id === "ds64" && off + 24 <= got) ds64 = Number(head.readBigUInt64LE(off + 16));
      else if (id === "fmt " && off + 24 <= got) {
        const tag = head.readUInt16LE(off + 8);
        fmt = { tag: tag === 0xfffe && sz >= 26 && off + 34 <= got ? head.readUInt16LE(off + 32) : tag, channels: head.readUInt16LE(off + 10), rate: head.readUInt32LE(off + 12), bits: head.readUInt16LE(off + 22) };
      } else if (id === "data") {
        if (!fmt || !fmt.bits || !fmt.channels) return null;
        const start = off + 8, bytes = Math.min(sz === 0xffffffff && ds64 != null ? ds64 : sz, size - start);
        return { ...fmt, start, samples: Math.floor(bytes / (fmt.bits / 8) / fmt.channels) };
      }
      off += 8 + sz + (sz & 1);
    }
    return null;
  } finally { fs.closeSync(fd); }
}

// a float WAV's header for n samples, one channel at 48 kHz (RF64 past 4 GB)
function floatHeader(n) {
  const bytes = n * 4, big = bytes + 36 > 0xffffffff;
  const h = Buffer.alloc(big ? 80 : 44);
  let o = 0;
  const id = (s) => { h.write(s, o, "latin1"); o += 4; }, u32 = (v) => { h.writeUInt32LE(v, o); o += 4; };
  id(big ? "RF64" : "RIFF"); u32(big ? 0xffffffff : 36 + bytes); id("WAVE");
  if (big) { id("ds64"); u32(28); h.writeBigUInt64LE(BigInt(72 + bytes), o); h.writeBigUInt64LE(BigInt(bytes), o + 8); h.writeBigUInt64LE(BigInt(n), o + 16); o += 28; }
  id("fmt "); u32(16); h.writeUInt16LE(3, o); h.writeUInt16LE(1, o + 2); h.writeUInt32LE(RATE, o + 4); h.writeUInt32LE(RATE * 4, o + 8); h.writeUInt16LE(4, o + 12); h.writeUInt16LE(32, o + 14); o += 16;
  id("data"); u32(big ? 0xffffffff : bytes);
  return h;
}

// count samples of a WAV from `from` as floats (16-bit as ±1), zeros outside it
function readRange(fd, info, from, count) {
  const out = new Float32Array(count), bps = info.bits / 8;
  const a = Math.max(0, from), b = Math.min(info.samples, from + count);
  if (b <= a) return out;
  const buf = Buffer.alloc((b - a) * bps);
  const got = fs.readSync(fd, buf, 0, buf.length, info.start + a * bps);
  const k = Math.floor(got / bps), o = a - from;
  if (info.tag === 3) for (let i = 0; i < k; i++) out[o + i] = buf.readFloatLE(i * 4);
  else for (let i = 0; i < k; i++) out[o + i] = buf.readInt16LE(i * 2) / 32768;
  return out;
}

// the largest absolute sample of a float WAV, streamed
function peakOf(fd, info) {
  let peak = 0;
  for (let p = 0; p < info.samples; p += CHUNK) {
    const x = readRange(fd, info, p, Math.min(CHUNK, info.samples - p));
    for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > peak) peak = v; }
  }
  return peak;
}

// The lag (0…DELAY_SEARCH samples) at which the output y follows the input x best, x a window of
// the input and y the output from the same start, DELAY_SEARCH longer. → { lag, c, c0 }: the
// normalised correlation there and at lag 0
function lagOf(x, y) {
  const n = x.length;
  let ex = 0;
  for (let i = 0; i < n; i++) ex += x[i] * x[i];
  const cum = new Float64Array(y.length + 1);
  for (let i = 0; i < y.length; i++) cum[i + 1] = cum[i] + y[i] * y[i];
  let best = { lag: 0, c: -Infinity }, c0 = 0;
  for (let l = 0; l + n <= y.length && l <= DELAY_SEARCH; l++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += x[i] * y[i + l];
    const c = s / Math.sqrt(ex * (cum[l + n] - cum[l]) + 1e-30);
    if (l === 0) c0 = c;
    if (c > best.c) best = { lag: l, c };
  }
  return { ...best, c0 };
}

async function neuralRepair(file, outWav, plan, opts) {
  const nr = plan.neural, t = nr.tune;
  fs.mkdirSync(path.dirname(path.resolve(outWav)), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "voice-sound-neural-"));
  const fds = [];
  const open = (f, flags) => { const fd = fs.openSync(f, flags); fds.push(fd); return fd; };
  const close = (fd) => { const i = fds.indexOf(fd); if (i >= 0) fds.splice(i, 1); fs.closeSync(fd); };
  try {
    // 1. everything before the noise, as one pass would do it
    const pre = path.join(tmp, "pre.wav");
    const c1 = await ffmpegPass(["-i", ffPath(file), "-filter_complex", plan.graphs[0], "-map", "[out]", ...WAV_OUT, ffPath(pre)]);
    if (c1 === "missing") refuse("ffmpeg is missing: this tool needs ffmpeg on the PATH.");
    if (c1 !== 0) refuse(`ffmpeg could not repair ${path.basename(file)} (${c1}): check that it plays (ffprobe ${path.basename(file)}).`);
    const info = wavInfo(pre);
    if (!info) refuse(`ffmpeg wrote no sound for ${path.basename(file)}: check that it plays (ffprobe ${path.basename(file)}).`);
    const bad = await invalidSample(pre);
    if (bad) refuse(`ffmpeg's filters wrote ${bad.value} at ${clockOf(bad.at)} of the repaired sound (the repair before the denoiser): run it again with --denoise off, and tell the skill's authors.`);
    const N = info.samples;
    const den = path.join(tmp, "denoised.wav");
    const st = { ...plan.steps.find((s) => s.id === "denoise") };
    let delay = DPDFNET_DELAY, gainDb = 0;
    const cut = piecesOf(N, nr.pauses, t);
    try {
      // 2. the level for its 16-bit output
      const fdPre = open(pre, "r");
      const peak = peakOf(fdPre, info);
      gainDb = r2(peak > 0 ? Math.max(-40, Math.min(60, t.peakDb - 20 * Math.log10(peak))) : 0);
      const g = 10 ** (gainDb / 20);
      // 3. piece by piece, each output in step and cross-faded into the one before
      const fdDen = open(den, "w");
      fs.writeSync(fdDen, floatHeader(N));
      const write = (x) => fs.writeSync(fdDen, Buffer.from(x.buffer, x.byteOffset, x.length * 4));
      const { pieces, seams, fade } = cut, half = fade / 2, K = pieces.length;
      let pending = null;
      for (let k = 0; k < K; k++) {
        const { from, to } = pieces[k], len = to - from;
        const padded = Math.ceil(len / BLOCK) * BLOCK + Math.ceil((t.tailS * RATE) / BLOCK) * BLOCK + BLOCK;
        const inW = path.join(tmp, `piece-${k}.wav`), outW = path.join(tmp, `piece-${k}.out.wav`);
        const say = (what) => new NeuralFailure(K > 1 ? `${what}, on piece ${k + 1} of ${K}` : what);
        // the piece at the level for it, its blocks' energy (where the delay is looked for)
        const fdIn = open(inW, "w");
        fs.writeSync(fdIn, floatHeader(padded));
        let sumIn = 0;
        const blocks = new Float64Array(Math.ceil(len / 4800));
        for (let p = from; p < to; p += CHUNK) {
          const x = readRange(fdPre, info, p, Math.min(CHUNK, to - p));
          for (let i = 0; i < x.length; i++) { x[i] *= g; const e = x[i] * x[i]; sumIn += e; blocks[Math.floor((p - from + i) / 4800)] += e; }
          fs.writeSync(fdIn, Buffer.from(x.buffer, 0, x.length * 4));
        }
        fs.writeSync(fdIn, Buffer.alloc((padded - len) * 4));
        close(fdIn);
        const failed = await runDenoiser(nr, inW, outW, len / RATE);
        fs.rmSync(inW, { force: true });
        if (failed) throw say(failed);
        const oi = wavInfo(outW);
        if (!oi) throw say(isFile(outW) ? "its output is no WAV" : "it wrote nothing");
        if (oi.rate !== RATE || oi.channels !== 1 || !((oi.tag === 1 && oi.bits === 16) || (oi.tag === 3 && oi.bits === 32))) throw say(`its output is ${oi.bits}-bit ${oi.rate} Hz with ${oi.channels} channels, not 16-bit 48 kHz mono`);
        if (oi.samples !== padded) throw say(`its output is ${oi.samples} samples long for ${padded}`);
        const fdOut = open(outW, "r");
        // its output whole: finite, not silent, not clipped
        let sumOut = 0, clipped = 0;
        for (let p = 0; p < padded; p += CHUNK) {
          const y = readRange(fdOut, oi, p, Math.min(CHUNK, padded - p));
          for (let i = 0; i < y.length; i++) {
            const v = y[i];
            if (!Number.isFinite(v)) throw say("its output holds numbers that are not finite");
            sumOut += v * v;
            if (v >= 32767 / 32768 || v <= -1) clipped++;
          }
        }
        if (sumOut === 0 || sumOut < sumIn * 10 ** (-(nr.limit + 20) / 10)) throw say("its output is silent");
        if (clipped > 10) throw say(`its output clipped (${clipped} samples)`);
        // its delay, on the first piece's loudest second (half a second in at least)
        if (k === 0) {
          const per = Math.min(10, Math.floor((len - DELAY_SEARCH) / 4800)), W = per * 4800;
          if (per >= 3) {
            let at = 0, top = -1;
            for (let b = Math.min(5, Math.max(0, blocks.length - 1)); (b + per) * 4800 + DELAY_SEARCH <= len; b++) {
              let s = 0; for (let j = b; j < b + per && j < blocks.length; j++) s += blocks[j];
              if (s > top) { top = s; at = b * 4800; }
            }
            const x = readRange(fdPre, info, from + at, W).map((v) => v * g);
            const y = readRange(fdOut, oi, at, W + DELAY_SEARCH);
            const lag = lagOf(x, y);
            if (lag.c < 0.2) throw say(`its output does not follow its input (correlation ${lag.c.toFixed(2)})`);
            if (lag.lag !== DPDFNET_DELAY && lag.c >= 0.5 && lag.c >= lag.c0 + 0.05) delay = lag.lag;
          }
        }
        // its part of the output: the fade into it, then it alone up to the next fade
        const take = (a, b) => { const y = readRange(fdOut, oi, a - from + delay, b - a); for (let i = 0; i < y.length; i++) y[i] /= g; return y; };
        if (k > 0) {
          const a = seams[k - 1].at - half, y = take(a, a + fade);
          for (let j = 0; j < fade; j++) { const w = Math.sin((Math.PI / 2) * ((j + 0.5) / fade)) ** 2; y[j] = w * y[j] + (1 - w) * pending[j]; }
          write(y);
        }
        const a = k > 0 ? seams[k - 1].at + half : 0, b = k < K - 1 ? seams[k].at - half : N;
        for (let p = a; p < b; p += CHUNK) write(take(p, Math.min(b, p + CHUNK)));
        pending = k < K - 1 ? take(b, b + fade) : null;
        close(fdOut);
        fs.rmSync(outW, { force: true });
      }
      close(fdDen);
      close(fdPre);
    } catch (e) {
      if (e instanceof NeuralFailure || e instanceof Refusal) throw e;
      throw new NeuralFailure(`the step round it broke: ${String(e?.message || e).split("\n")[0]}`);
    }
    fs.rmSync(pre, { force: true });
    // 4. what comes after the noise (the tone stage's filters), to the intermediate
    const c2 = await ffmpegPass(["-i", ffPath(den), "-filter_complex", plan.graphs[1], "-map", "[out]", ...WAV_OUT, ffPath(outWav)], opts.progress);
    if (c2 === "missing") refuse("ffmpeg is missing: this tool needs ffmpeg on the PATH.");
    if (c2 !== 0) refuse(`ffmpeg could not repair ${path.basename(file)} after the denoiser (${c2}): run it again with --denoise off, and tell the skill's authors.`);
    const bad2 = await invalidSample(outWav);
    if (bad2) {
      fs.rmSync(outWav, { force: true });
      refuse(`ffmpeg's filters wrote ${bad2.value} at ${clockOf(bad2.at)} of the repaired sound (after dpdfnet): run it again with --denoise off or another method, and tell the skill's authors.`);
    }
    Object.assign(st, {
      gainDb, delaySamples: delay,
      pieces: cut.pieces.map((p) => ({ from: r2(p.from / RATE), to: r2(p.to / RATE) })),
      seams: cut.seams.map((s) => ({ at: r2(s.at / RATE), pause: s.pause })),
      ...(delay !== DPDFNET_DELAY && { why: `${st.why.replace(/\.$/, "")}; its output came ${delay} samples late, taken out.` }),
    });
    const steps = plan.steps.map((s) => (s.id === "denoise" ? st : s));
    return { steps, left: plan.left, method: plan.method, graph: plan.graph };
  } finally {
    for (const fd of fds) try { fs.closeSync(fd); } catch {}
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
