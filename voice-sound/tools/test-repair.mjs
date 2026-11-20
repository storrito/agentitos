// repair (lib/repair.mjs), the first stage of `clean`: its plan on made-up measures (each finding
// alone gives its step and no other), then on a voice made up with ffmpeg's lavfi (the same
// synthesiser as tools/test.mjs: a sawtooth whose pitch wanders around 120 Hz, three formants,
// syllables in phrases of 2.5 s with pauses of 1.1 s) with one fault at a time: the output is as
// long as the input and in step with it, hum, noise, clipping and a dead or inverted channel are
// mended, a clean voice comes out nearly as it went in. No request, no key, no network.
//
//   node --test tools/test-repair.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { measure } from "./voice.mjs";
import { repair, repairPlan, checkFilters, afftdnLevels, afftdnFloor, invalidSample } from "./lib/repair.mjs";
import { Refusal } from "./lib/analyse.mjs";
import { fftOf } from "./lib/fft.mjs";

// the machines have the neural denoiser on the PATH; these tests are of ffmpeg's methods, so it is hidden here (test-neural.mjs tests it)
process.env.VOICE_SOUND_DENOISER = "/nonexistent/voice-sound-no-denoiser";
const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const skip = !ffmpeg && "no ffmpeg";
const run = (args) => { const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); };
const ids = (list) => list.map((s) => s.id);
const db = (x) => 10 * Math.log10(x);

const D = 28.8;
const VOICE = `aevalsrc=exprs='st(0,120*t+3.41*(1-cos(4.398*t))+6.92*(1-cos(1.445*t)));st(1,mod(t,3.6));` +
  `0.25*lt(ld(1),2.5)*pow(sin(12.566*ld(1)),2)*(0.6+0.4*sin(5.655*t))*2*(ld(0)-floor(ld(0)+0.5))':s=48000:d=${D},` +
  `equalizer=f=500:t=o:w=1:g=10,equalizer=f=1500:t=o:w=1:g=6,equalizer=f=2700:t=o:w=0.8:g=4,lowpass=f=5000[v];` +
  `anoisesrc=color=white:amplitude=0.03:r=48000:d=${D}:seed=3,highpass=f=4000,highpass=f=4000,volume='lt(mod(t,3.6),2.5)*lt(mod(t,0.75),0.09)':eval=frame[s];` +
  `anoisesrc=color=pink:amplitude=0.0015:r=48000:d=${D}:seed=5[n];[v][s][n]amix=inputs=3:normalize=0`;

let dir, base;
const file = (name) => path.join(dir, name);
// the samples of a file as `measure` decodes it (48 kHz), one channel or `ch` of two
function samples(f, ch = null) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", f, ...(ch == null ? ["-ac", "1"] : ["-af", `pan=mono|c0=c${ch}`]), "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
}
const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
// the lag (samples) at which y matches x best around `at` (0.25 s of x against ±lag of y)
function lagOf(x, y, at, lag = 1500) {
  const n = 12000;
  let best = -Infinity, bl = null;
  for (let l = -lag; l <= lag; l++) {
    let s = 0;
    for (let i = at; i < at + n; i++) s += x[i] * (y[i + l] ?? 0);
    if (s > best) { best = s; bl = l; }
  }
  return bl;
}
// the power of a sine at f in x (a Goertzel over all of it), as dB
function lineDb(x, f) {
  const w = (2 * Math.PI * f) / 48000, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < x.length; i++) { const s = x[i] + c * s1 - s2; s2 = s1; s1 = s; }
  return db((s1 * s1 + s2 * s2 - c * s1 * s2) / (x.length * x.length) + 1e-30);
}
async function mended(name, m, opts) {
  const out = file(`${name}.out.wav`);
  const r = await repair(file(name), out, m, opts);
  return { r, out, x: samples(file(name)), y: samples(out) };
}
// the input through the plan's filters that delay nothing (the plan without denoising): an IIR
// high-pass turns a voice's phase (its lows lead), which no delay can undo, so being in step is
// measured against this
function undelayed(name, m) {
  const out = file(`${name}.ref.wav`);
  run(["-i", file(name), "-filter_complex", repairPlan(m, { denoise: "off" }).graph, "-map", "[out]", "-c:a", "pcm_f32le", out]);
  return samples(out);
}
// the high-pass sections of a graph, to put a reference through the same
const highpasses = (graph) => graph.match(/highpass=[^,;[]+/g).join(",");
// a copy of the voice through `filter` (a filter_complex with [0:a] the voice, ending in [o])
function fault(name, filter, codec = "pcm_f32le") {
  run(["-i", base, "-filter_complex", filter, "-map", "[o]", "-c:a", codec, file(name)]);
  return file(name);
}

before(() => {
  if (!ffmpeg) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-sound-repair-"));
  base = file("voice.wav");
  run(["-filter_complex", VOICE, "-ac", "1", "-c:a", "pcm_f32le", base]);
});
after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

// ---------------------------------------------------------------- the plan on made-up measures

const band = (lo, hi, dbv) => ({ lo, hi, db: dbv });
const EDGES = [0, 40, 60, 80, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 3500, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 14000, 16000, 18000, 20000, 24000];
// pink-ish noise at about −70 dB a band
const NOISE_BANDS = EDGES.slice(0, -1).map((lo, i) => band(lo, EDGES[i + 1], -70 - 3 * Math.log2(Math.max(1, lo / 500))));
function made(over = {}) {
  return {
    file: "made.wav", duration: 60,
    sound: { channels: 1, sampleRate: 48000 },
    analysed: { sampleRate: 48000, channels: 1, seconds: 60 },
    loudness: { integratedLufs: -20, truePeakDb: -3 },
    speech: { share: 0.7, longest: [{ from: 12.3, to: 13.5, seconds: 1.2, db: -70, lufs: -72, silent: false }], confidence: "high" },
    levels: { speechLufs: -20, noiseLufs: -75, snrDb: 55, snrADb: 55 },
    noise: { lufs: -75, kind: "broadband", fluctuationDb: 0.5, spreadDb: 1, bands: NOISE_BANDS },
    hum: { judged: true, hz: null, harmonics: 0, overDb: null, at50: [], at60: [] },
    clipping: { peakDb: -3, ceilingDb: -3, pileUp: 0.2, share: 0, exactShare: 0 },
    dc: { values: [0], db: -120 },
    low: { below80Db: -30, pauses80Db: -35, thumps: { count: 0, perMinute: 0, at: [] } },
    clicks: { count: 0, over: { 20: 0, 30: 0, 40: 0 }, at: [] },
    channels: null, room: { rt60: 0.3, confidence: "medium" },
    findings: [],
    ...over,
  };
}
const finding = (id, strength = "strong") => ({ id, strength, text: id });

test("plan: a clean recording gets the high-pass at 80 Hz and nothing else", () => {
  const p = repairPlan(made());
  assert.deepEqual(ids(p.steps), ["highpass"]);
  assert.equal(p.steps[0].hz, 80);
  assert.equal(p.steps[0].poles, 2);
  assert.deepEqual(p.left, []);
  assert.equal(p.method, "off");
  assert.match(p.graph, /^\[0:a\]aresample=48000,aformat=channel_layouts=mono,highpass=f=80:t=q:w=0\.7071,aformat=sample_fmts=flt/);
});

test("plan: each finding alone gives its step and no other", () => {
  const cases = [
    ["clipped", { clipping: { peakDb: -1, ceilingDb: -1, pileUp: 40, share: 0.004, exactShare: 0.004 } }, "declip"],
    ["hum", { hum: { judged: true, hz: 50, harmonics: 2, overDb: 18, at50: [{ n: 1, hz: 50, overDb: 18, counts: true }, { n: 2, hz: 100, overDb: 12, counts: true }, { n: 3, hz: 150, overDb: 12, counts: false }, { n: 4, hz: 200, overDb: 3, counts: false }], at60: [] } }, "dehum"],
    ["clicks", { clicks: { count: 30, over: { 20: 30, 30: 12, 40: 4 }, at: [] } }, "declick"],
    ["noise", { levels: { speechLufs: -20, noiseLufs: -45, snrDb: 25, snrADb: 25 }, noise: { lufs: -45, kind: "broadband", bands: NOISE_BANDS.map((b) => ({ ...b, db: b.db + 25 })) } }, "denoise"],
  ];
  for (const [id, over, step] of cases) {
    const p = repairPlan(made({ ...over, findings: [finding(id)] }));
    assert.deepEqual(ids(p.steps), step === "highpass" ? ["highpass"] : (step === "declip" ? ["declip", "highpass"] : ["highpass", step]), id);
    if (id !== "hum") continue;
    // each harmonic on its own: the two that count get a notch, 150 Hz (12 dB over, not steady) none
    const st = p.steps.find((s) => s.id === "dehum");
    assert.deepEqual(st.notches.map((x) => x.hz), [50, 100]);
    assert.deepEqual(p.graph.match(/bandreject=[^,;[]+/g), ["bandreject=f=50:t=h:w=2:r=f64", "bandreject=f=100:t=h:w=2:r=f64"]);
    assert.equal(st.widthHz, 2);
    assert.match(st.why, /^Hum at 50 Hz, steady in the pauses \(up to 18 dB over the noise beside it\): notched at 50, 100 Hz, each 2 Hz wide at its −3 dB points\.$/);
  }
  // each notch on its line as measured (lineHz), not on the multiple of the mains: a line at
  // 50.96 Hz loses 3.2 dB to a notch at 50 (fleurs-de-05, 2026-11-20); the step keeps both
  // numbers and says where it notched, never that the line is gone
  const off = { judged: true, hz: 50, fundamentalHz: 50.963, harmonics: 2, overDb: 27, at50: [{ n: 1, hz: 50, lineHz: 50.963, overDb: 27, counts: true }, { n: 2, hz: 100, lineHz: 101.93, overDb: 12, counts: true }, { n: 3, hz: 150, lineHz: 152.9, overDb: 4, counts: false }], at60: [] };
  const po = repairPlan(made({ hum: off, findings: [finding("hum")] }));
  assert.deepEqual(po.graph.match(/bandreject=[^,;[]+/g), ["bandreject=f=50.96:t=h:w=2:r=f64", "bandreject=f=101.93:t=h:w=2:r=f64"]);
  const so = po.steps.find((s) => s.id === "dehum");
  assert.deepEqual(so.notches.map((x) => [x.n, x.hz, x.lineHz, x.notchHz]), [[1, 50, 50.963, 50.96], [2, 100, 101.93, 101.93]]);
  assert.equal(so.fundamentalHz, 50.963);
  assert.match(so.why, /^Hum at 50\.96 Hz \(mains of 50 Hz\), steady in the pauses \(up to 27 dB over the noise beside it\): notched at 50\.96, 101\.93 Hz, each 2 Hz wide at its −3 dB points\.$/);
  assert.doesNotMatch(so.why, /taken out|gone|removed/);
  // a lineHz that is no number: the multiple of the mains
  const odd = repairPlan(made({ hum: { ...off, at50: [{ n: 1, hz: 50, lineHz: null, overDb: 27, counts: true }] }, findings: [finding("hum")] }));
  assert.deepEqual(odd.graph.match(/bandreject=f=[\d.]+/g), ["bandreject=f=50"]);
  // hum that was not judged (too little pause) or counts nowhere: no notch
  for (const hum of [{ judged: false, hz: null, harmonics: 0, overDb: null, at50: [], at60: [] }, { judged: true, hz: 50, harmonics: 0, overDb: 12, at50: [{ n: 1, hz: 50, overDb: 12, counts: false }], at60: [] }])
    assert.deepEqual(ids(repairPlan(made({ hum, findings: [finding("hum")] })).steps), ["highpass"]);
  // the low end and DC change the high-pass, never add a step
  const rumble = repairPlan(made({ low: { below80Db: -10, pauses80Db: -10, thumps: { count: 0, perMinute: 0, at: [] } }, findings: [finding("rumble")] }));
  assert.deepEqual(ids(rumble.steps), ["highpass"]);
  assert.ok(rumble.steps[0].poles >= 4 && rumble.steps[0].hz <= 90, JSON.stringify(rumble.steps[0]));
  const thumps = repairPlan(made({ low: { below80Db: -30, pauses80Db: -35, thumps: { count: 6, perMinute: 6, at: [1, 2] } }, findings: [finding("thumps")] }));
  assert.equal(thumps.steps[0].poles, 4);
  const dc = repairPlan(made({ dc: { values: [0.05], db: -26 }, findings: [finding("dc")] }));
  assert.deepEqual(ids(dc.steps), ["highpass"]);
  assert.match(dc.graph, /dcshift=shift=-0\.05/);
  // a high-pass never over 90 Hz, however strong the rumble: a low voice's fundamental lies at 85–100 Hz
  const worst = repairPlan(made({ low: { below80Db: 5, pauses80Db: 5, thumps: { count: 9, perMinute: 9, at: [] } }, findings: [finding("rumble"), finding("thumps")] }));
  assert.ok(worst.steps[0].hz <= 90);
});

test("plan: two channels become one as measured", () => {
  const two = (channels, f = []) => repairPlan(made({ sound: { channels: 2 }, channels, findings: f }));
  const dead = two({ correlation: null, levelDifferenceDb: null, monoLossDb: -3, identical: false, silentChannel: "right" }, [finding("one-channel")]);
  assert.deepEqual(ids(dead.steps), ["channels", "highpass"]);
  assert.equal(dead.steps[0].take, "left");
  assert.match(dead.graph, /pan=mono\|c0=c0,/);
  const inv = two({ correlation: -1, levelDifferenceDb: -0.5, monoLossDb: -60, identical: false, silentChannel: null }, [finding("inverted")]);
  assert.equal(inv.steps[0].take, "right");
  assert.doesNotMatch(inv.graph, /c0\+|\+.*c1/, "never their sum");
  assert.equal(two({ correlation: 1, levelDifferenceDb: 0, monoLossDb: 0, identical: true, silentChannel: null }).steps[0].take, "left");
  const real = two({ correlation: 0.4, levelDifferenceDb: 2, monoLossDb: -1.6, identical: false, silentChannel: null });
  assert.equal(real.steps[0].take, "mean");
  assert.match(real.graph, /pan=mono\|c0=0\.5\*c0\+0\.5\*c1/);
});

test("plan: the denoise method, its strength, and what is left", () => {
  const noisy = (over = {}) => made({
    levels: { speechLufs: -20, noiseLufs: -45, snrDb: 25, snrADb: 25 },
    noise: { lufs: -45, kind: "broadband", fluctuationDb: 0.5, bands: NOISE_BANDS.map((b) => ({ ...b, db: b.db + 25 })) },
    findings: [finding("noise")], ...over,
  });
  const p = repairPlan(noisy());
  assert.equal(p.method, "afftdn-sample");
  const st = p.steps.find((s) => s.id === "denoise");
  assert.equal(st.reduceDb, 12, "the cap, short of the 20 dB to the aim");
  assert.deepEqual(st.pause, { from: 12.3, seconds: 1.17 });
  assert.equal(p.inputs[1].from, 12.3);
  assert.match(p.graph, /asendcmd=c='0\.0 afftdn@dn sn start;[\d.]+ afftdn@dn sn stop'/);
  assert.ok(p.left.some((l) => l.id === "noise" && /short of the 45 dB/.test(l.why)), JSON.stringify(p.left));
  // gentle and strong move the cap; off leaves the noise, and says so
  assert.ok(repairPlan(noisy(), { denoise: "gentle" }).steps.at(-1).reduceDb < st.reduceDb);
  assert.ok(repairPlan(noisy(), { denoise: "strong" }).steps.at(-1).reduceDb > st.reduceDb);
  const off = repairPlan(noisy(), { denoise: "off" });
  assert.deepEqual(ids(off.steps), ["highpass"]);
  assert.ok(off.left.some((l) => l.id === "noise"));
  // never more than the aim needs
  const mild = repairPlan(noisy({ levels: { speechLufs: -20, snrDb: 38, snrADb: 38 } }));
  assert.equal(mild.steps.at(-1).reduceDb, 7);
  // no pause long enough: afftdn with the pauses' measured spectrum, no second input
  const none = repairPlan(noisy({ speech: { longest: [{ from: 3, to: 3.3, seconds: 0.3, silent: false }, { from: 9, to: 11, seconds: 2, silent: true }] } }));
  assert.equal(none.method, "afftdn-profile");
  assert.equal(none.inputs.length, 1);
  assert.match(none.graph, /afftdn=nr=12:nf=-?[\d.]+:nt=c:bn=[-\d.|]+:tn=0/);
  assert.throws(() => repairPlan(noisy({ speech: { longest: [] } }), { method: "afftdn-sample" }), Refusal);
  // changing noise and a room: left with one sentence each
  const changing = repairPlan(noisy({ noise: { lufs: -45, kind: "changing", fluctuationDb: 5, bands: NOISE_BANDS } }));
  assert.ok(changing.left.some((l) => l.id === "noise" && /changes/.test(l.why)));
  const roomy = repairPlan(made({ room: { rt60: 0.9, confidence: "high" }, findings: [finding("roomy")] }));
  assert.deepEqual(ids(roomy.steps), ["highpass"]);
  assert.ok(roomy.left.some((l) => l.id === "roomy" && /0\.9 s/.test(l.why)));
  for (const l of [...p.left, ...changing.left, ...roomy.left]) assert.equal(l.why.split(/\. /).length, 1, l.why);
  // arnndn only with a model named
  const was = process.env.VOICE_SOUND_RNNOISE;
  delete process.env.VOICE_SOUND_RNNOISE;
  assert.throws(() => repairPlan(noisy(), { method: "arnndn" }), /VOICE_SOUND_RNNOISE/);
  if (was) process.env.VOICE_SOUND_RNNOISE = was;
  assert.throws(() => repairPlan(noisy(), { method: "anlmdn" }), Refusal);
  assert.throws(() => repairPlan(noisy(), { denoise: "max" }), Refusal);
});

test("afftdn's floor: white noise of variance σ² sits at 10·log10(σ²) − 3 in every band", () => {
  // white noise at −40 dB mean square: its 31 bands share it by their width
  const bands = EDGES.slice(0, -1).map((lo, i) => band(lo, EDGES[i + 1], -40 + db((EDGES[i + 1] - lo) / 24000)));
  const lv = afftdnLevels({ bands });
  for (const v of lv) assert.ok(Math.abs(v - -43) < 0.05, `${v}`);
  const f = afftdnFloor(lv, false, 0);
  assert.equal(f.nf, -43);
  assert.equal(f.lift, 0);
  assert.ok(f.bn.split("|").every((v) => Math.abs(Number(v)) < 0.05));
  // a very quiet noise is lifted into afftdn's range and the lift taken back
  const quiet = afftdnFloor(lv.map((v) => v - 50), true, 0);
  assert.equal(quiet.nf, -78);
  assert.equal(quiet.lift, 15);
});

// ---------------------------------------------------------------- on sound

test("a clean voice comes out nearly as it went in, as long and in step", { skip }, async () => {
  const m = await measure(base);
  const { r, out, x, y } = await mended("voice.wav", m);
  assert.deepEqual(ids(r.steps), ["highpass"]);
  assert.equal(y.length, x.length);
  // (the high-pass's phase: the waveform as a whole leads by a sample or two, no more)
  assert.ok(Math.abs(lagOf(x, y, 48000)) <= 3);
  assert.equal(lagOf(undelayed("voice.wav", m), y, 48000), 0);
  near(db(rms(y) / rms(x)) * 2, 0, 0.6, "level");
  const a = await measure(out);
  for (const b of a.tone.bands.filter((b) => b.lo >= 250 && b.diff != null))
    near(b.diff, m.tone.bands.find((c) => c.lo === b.lo).diff, 0.5, `${b.lo} Hz band`);
});

// the power of x in bands lo–hi (one FFT over all of it, zero-padded)
function bandPower(x) {
  let n = 1; while (n < x.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  re.set(x);
  fftOf(n)(re, im);
  const df = 48000 / n;
  return (lo, hi) => { let s = 0; for (let k = Math.ceil(lo / df); k * df < hi; k++) s += re[k] * re[k] + im[k] * im[k]; return s; };
}
// mains hum of ten harmonics, as the lab's corpus builds it (the tenth added)
const HUM_AMPS = [1, 0.5, 0.6, 0.25, 0.35, 0.15, 0.2, 0.1, 0.12, 0.08];
const humTones = (hz, level) => `${HUM_AMPS.map((a, i) => `sine=f=${hz * (i + 1)}:r=48000:d=${D},volume=${(level * a).toPrecision(3)}[h${i}]`).join(";")};` +
  `${HUM_AMPS.map((_, i) => `[h${i}]`).join("")}amix=inputs=${HUM_AMPS.length}:normalize=0`;
// a graph without its notches: the same steps but the dehum
const unnotched = (graph) => graph.replace(/,bandreject=[^,;[]+/g, "");

test("hum of ten harmonics: every harmonic found down by 20 dB and more, the voice in 90–500 Hz by under 1 dB", { skip }, async (t) => {
  // (the voice's pitch here moves over a speaker's range, 65 to 185 Hz, where VOICE's wanders by
  // ±25 Hz: a narrow pitch puts a band's whole power next to one notch, VOICE's 2nd harmonic at
  // 190–202 Hz beside the notch at 200 Hz loses 1.3 dB of the third octave 160–202 Hz)
  const wide = file("voice-wide.wav");
  run(["-filter_complex", VOICE.replace("st(0,120*t+3.41*(1-cos(4.398*t))+6.92*(1-cos(1.445*t)))", "st(0,125*t+34.6*(1-cos(1.3*t))+4.84*(1-cos(3.1*t)))"), "-ac", "1", "-c:a", "pcm_f32le", wide]);
  for (const hz of [50, 60]) {
    const name = `hum${hz}.wav`;
    run(["-i", wide, "-filter_complex", `${humTones(hz, 0.01)}[hum];[0:a][hum]amix=inputs=2:normalize=0[o]`, "-map", "[o]", "-c:a", "pcm_f32le", file(name)]);
    const m = await measure(file(name));
    const { r, out, x, y } = await mended(name, m);
    assert.equal(y.length, x.length);
    const dehum = r.steps.find((s) => s.id === "dehum");
    assert.ok(dehum, ids(r.steps).join());
    assert.equal(dehum.hz, hz);
    assert.ok(dehum.notches.length >= 8 && dehum.notches.every((n) => n.hz % hz === 0 && Math.abs(n.notchHz - n.hz) <= 0.2 && n.widthHz === 2), JSON.stringify(dehum.notches));
    assert.match(dehum.why, new RegExp(`^Hum at ${hz}(\\.\\d+)? Hz.*, steady in the pauses \\(.*\\): notched at [\\d., ]+ Hz, each 2 Hz wide at its −3 dB points\\.$`));
    // the hum alone, through the graph with its notches and without them (after the first
    // second: a notch 2 Hz wide settles in about half of one)
    run(["-filter_complex", `${humTones(hz, 0.01)}[o]`, "-map", "[o]", "-c:a", "pcm_f32le", file("humonly.wav")]);
    const through = (graph, z) => { run(["-i", file("humonly.wav"), "-filter_complex", graph, "-map", "[out]", "-c:a", "pcm_f32le", file(z)]); return samples(file(z)).subarray(48000); };
    const hy = through(r.graph, "humonly.out.wav"), hx = through(unnotched(r.graph), "humonly.ref.wav");
    let least = Infinity, worst = 0;
    for (const n of dehum.notches) {
      const down = lineDb(hx, n.hz) - lineDb(hy, n.hz);
      least = Math.min(least, down);
      assert.ok(down >= 20, `${n.hz} Hz down by ${down.toFixed(1)} dB`);
    }
    // the voice alone through the same two graphs, in third octaves a sixth of an octave apart
    // from 90 to 500 Hz: those across a harmonic and those between them
    const vy = file("voice.notched.wav"), vx = file("voice.unnotched.wav");
    run(["-i", wide, "-filter_complex", r.graph, "-map", "[out]", "-c:a", "pcm_f32le", vy]);
    run(["-i", wide, "-filter_complex", unnotched(r.graph), "-map", "[out]", "-c:a", "pcm_f32le", vx]);
    const py = bandPower(samples(vy)), px = bandPower(samples(vx));
    for (let lo = 90; lo * 2 ** (1 / 3) <= 500; lo *= 2 ** (1 / 6)) {
      const hi = lo * 2 ** (1 / 3), change = 10 * Math.log10(py(lo, hi) / px(lo, hi));
      if (Math.abs(change) > Math.abs(worst)) worst = change;
      assert.ok(Math.abs(change) < 1, `${hz} Hz hum: the voice in ${lo.toFixed(0)}–${hi.toFixed(0)} Hz changed by ${change.toFixed(2)} dB`);
    }
    t.diagnostic(`${hz} Hz: ${dehum.notches.length} harmonics notched, each down by ${least.toFixed(1)} dB or more; the voice's third octaves in 90–500 Hz changed by ${worst.toFixed(2)} dB at most`);
    // and no tone rings on at a notch into the pauses
    const a = await measure(out);
    assert.ok(!a.findings.some((f) => f.id === "hum"), JSON.stringify(a.hum.at50.slice(0, 4)));
  }
});

test("hum off the mains (50.96 Hz): each notch on its measured line takes it down by 20 dB and more", { skip }, async () => {
  // (lineHz is `measure`'s number for each harmonic; made up here as it will give it)
  const f0 = 50.96, N = 9;
  const tones = `${HUM_AMPS.slice(0, N).map((a, i) => `sine=f=${(f0 * (i + 1)).toFixed(3)}:r=48000:d=${D},volume=${(0.01 * a).toPrecision(3)}[h${i}]`).join(";")};` +
    `${HUM_AMPS.slice(0, N).map((_, i) => `[h${i}]`).join("")}amix=inputs=${N}:normalize=0`;
  run(["-i", base, "-filter_complex", `${tones}[hum];[0:a][hum]amix=inputs=2:normalize=0[o]`, "-map", "[o]", "-c:a", "pcm_f32le", file("hum5096.wav")]);
  const m = await measure(file("hum5096.wav"));
  m.hum = { ...m.hum, judged: true, hz: 50, fundamentalHz: f0, harmonics: N, overDb: 25, at50: [...Array(N).keys()].map((i) => ({ n: i + 1, hz: 50 * (i + 1), lineHz: +(f0 * (i + 1)).toFixed(2), overDb: 25, counts: true })), at60: [] };
  if (!m.findings.some((f) => f.id === "hum")) m.findings.push(finding("hum"));
  const { r, x, y } = await mended("hum5096.wav", m);
  assert.equal(y.length, x.length);
  const dehum = r.steps.find((s) => s.id === "dehum");
  assert.deepEqual(dehum.notches.map((q) => q.notchHz), [...Array(N).keys()].map((i) => +(f0 * (i + 1)).toFixed(2)));
  run(["-filter_complex", `${tones}[o]`, "-map", "[o]", "-c:a", "pcm_f32le", file("hum5096only.wav")]);
  const through = (graph, z) => { run(["-i", file("hum5096only.wav"), "-filter_complex", graph, "-map", "[out]", "-c:a", "pcm_f32le", file(z)]); return samples(file(z)).subarray(48000); };
  const hy = through(r.graph, "hum5096.out2.wav"), hx = through(unnotched(r.graph), "hum5096.ref2.wav");
  for (let i = 0; i < N; i++) {
    const f = f0 * (i + 1), down = lineDb(hx, f) - lineDb(hy, f);
    assert.ok(down >= 20, `${f.toFixed(2)} Hz down by ${down.toFixed(1)} dB`);
  }
});

test("the notch, measured through ffmpeg: 2 Hz wide at its −3 dB points on every harmonic, deep at its line", { skip }, async () => {
  const p = repairPlan(made({ hum: { judged: true, hz: 50, harmonics: 2, overDb: 20, at50: [{ n: 1, hz: 50, overDb: 20, counts: true }, { n: 9, hz: 450, overDb: 12, counts: true }], at60: [] }, findings: [finding("hum")] }));
  const notches = p.graph.match(/bandreject=[^,;[]+/g);
  assert.equal(notches.length, 2);
  for (const [f0, notch] of [[50, notches[0]], [450, notches[1]]]) {
    // (lavfi's sine has an amplitude of 1/8: its line is (1/16)² in lineDb's terms; the first
    // second left out, the notch settling)
    const gain = (f) => {
      run(["-f", "lavfi", "-i", `sine=f=${f}:r=48000:d=3`, "-af", `aformat=sample_fmts=flt,${notch}`, "-c:a", "pcm_f32le", file("sine.wav")]);
      return lineDb(samples(file("sine.wav")).subarray(48000), f) - db((0.125 / 2) ** 2);
    };
    for (const d of [-1, 1]) near(gain(f0 + d), -3, 0.2, `${f0} Hz notch at ${d > 0 ? "+" : ""}${d} Hz`);
    // how well a line must be known (HUM_NOTCH_HZ): 0.1 Hz off −20 dB, 0.2 Hz −14, 0.5 Hz −7
    for (const [d, want] of [[0.1, -20], [0.2, -14.1], [0.5, -7]]) near(gain(f0 + d), want, 0.3, `${f0} Hz notch at +${d} Hz`);
    for (const d of [-3, 3]) assert.ok(gain(f0 + d) > -0.7, `${f0 + d} Hz`);
    assert.ok(gain(f0) < -60, `${f0} Hz itself: ${gain(f0).toFixed(1)} dB`);
  }
});

test("steady noise: lower in the pauses, the voice within a dB or two, in step (sample and profile)", { skip }, async () => {
  run(["-i", base, "-filter_complex", `anoisesrc=color=pink:amplitude=0.02:r=48000:d=${D}:seed=9[n];[0:a][n]amix=inputs=2:normalize=0[o]`, "-map", "[o]", "-c:a", "pcm_f32le", file("noisy.wav")]);
  const m = await measure(file("noisy.wav"));
  assert.ok(m.findings.some((f) => f.id === "noise"));
  const ref = undelayed("noisy.wav", m);
  for (const method of ["afftdn-sample", "afftdn-profile"]) {
    const { r, out, x, y } = await mended("noisy.wav", m, { method });
    const st = r.steps.find((s) => s.id === "denoise");
    assert.equal(r.method, method);
    assert.equal(y.length, x.length, method);
    for (const at of [48000, 600000, 1300000]) assert.equal(lagOf(ref, y, at), 0, `${method} at ${at}`);
    const a = await measure(out);
    const down = m.levels.noiseLufs - a.levels.noiseLufs;
    assert.ok(down >= st.reduceDb - 2, `${method}: the noise down by ${down.toFixed(1)} dB of ${st.reduceDb}`);
    near(a.levels.speechLufs, m.levels.speechLufs, 1.5, `${method}: the voice`);
  }
});

// ffmpeg 9.0.2's arnndn writes NaN or values around 1e11 into its last 480 samples when the
// input ends inside a block (2026-11-19); no method may hand on such a sample, whichever filter
// makes it. arnndn runs here when VOICE_SOUND_RNNOISE names a model (the skill ships none).
test("every method: finite samples within ±16 to the last one, on a length that is no multiple of 480", { skip }, async () => {
  run(["-i", base, "-filter_complex", `anoisesrc=color=pink:amplitude=0.02:r=48000:d=${D}:seed=9[n];[0:a][n]amix=inputs=2:normalize=0,atrim=end_sample=${48000 * 7 + 123}[o]`, "-map", "[o]", "-c:a", "pcm_f32le", file("odd.wav")]);
  const m = await measure(file("odd.wav"));
  const methods = ["afftdn-sample", "afftdn-profile", "afftdn-track", ...(process.env.VOICE_SOUND_RNNOISE ? ["arnndn"] : [])];
  for (const method of methods) {
    const { r, x, y } = await mended("odd.wav", m, { method });
    assert.equal(r.method, method);
    assert.equal(y.length, x.length, method);
    const bad = y.findIndex((v) => !Number.isFinite(v) || Math.abs(v) > 16);
    assert.equal(bad, -1, `${method}: sample ${bad} of ${y.length} is ${y[bad]}`);
  }
  // and repair's own check finds such a sample in a WAV, to the sample
  const raw = new Float32Array(48000 * 3).fill(0.1);
  raw[100000] = NaN;
  fs.writeFileSync(file("nan.raw"), Buffer.from(raw.buffer));
  run(["-f", "f32le", "-ar", "48000", "-ac", "1", "-i", file("nan.raw"), "-c:a", "pcm_f32le", file("nan.wav")]);
  const found = await invalidSample(file("nan.wav"));
  assert.equal(found?.value, "NaN");
  near(found.at, 100000 / 48000, 1e-6, "where");
  assert.equal(await invalidSample(file("odd.wav")), null);
});

test("an input at 44.1 kHz with a DC offset: as long as measure decodes it", { skip }, async () => {
  run(["-i", base, "-af", "aresample=44100,aeval=val(0)+0.05", "-c:a", "pcm_s16le", file("dc44.wav")]);
  const m = await measure(file("dc44.wav"));
  const { r, x, y } = await mended("dc44.wav", m);
  assert.ok(r.steps[0].dc, JSON.stringify(r.steps));
  assert.equal(y.length, x.length);
  assert.ok(Math.abs(y.reduce((s, v) => s + v, 0) / y.length) < 1e-3, "no offset left");
  assert.equal(lagOf(undelayed("dc44.wav", m), y, 96000), 0);
});

test("clipped: the peaks are redrawn over the old ceiling", { skip }, async () => {
  const loud = samples(fault("loud.wav", "[0:a]volume=9dB[o]"));
  const abs = Float64Array.from(loud, Math.abs).sort();
  const ceiling = abs[Math.floor(abs.length * 0.995)];
  fault("clipped.wav", `[0:a]volume=9dB,aeval='max(-${ceiling},min(${ceiling},val(0)))'[o]`, "pcm_s16le");
  const m = await measure(file("clipped.wav"));
  const { r, x, y } = await mended("clipped.wav", m);
  const st = r.steps.find((s) => s.id === "declip");
  assert.ok(st, ids(r.steps).join());
  const old = ceiling * 10 ** (st.gainDb / 20);
  let over = 0, peak = 0;
  for (const v of y) { if (Math.abs(v) > old * 1.02) over++; peak = Math.max(peak, Math.abs(v)); }
  assert.ok(over > 1000 && peak > old * 1.2, `${over} samples over the old ceiling, the peak ${(20 * Math.log10(peak / old)).toFixed(1)} dB over it`);
  assert.equal(y.length, x.length);
  // nearer the voice before it clipped than the clipped one is, both through the same high-pass
  const through = (src, name) => { run(["-i", src, "-af", `${highpasses(r.graph)},volume=${st.gainDb}dB`, "-c:a", "pcm_f32le", file(name)]); return samples(file(name)); };
  const truth = through(file("loud.wav"), "loud.hp.wav"), clipped = through(file("clipped.wav"), "clipped.hp.wav");
  const err = (z) => { let s = 0; for (let i = 0; i < z.length; i++) s += (z[i] - truth[i]) ** 2; return s; };
  assert.ok(err(y) < err(clipped) * 0.8, `error ${(10 * Math.log10(err(y) / err(clipped))).toFixed(1)} dB against the clipped one's`);
});

test("two channels: a dead one and an inverted one give a single channel at full level", { skip }, async () => {
  const level = rms(samples(base));
  for (const [name, pan] of [["dead.wav", "c0=c0|c1=0*c0"], ["inverted.wav", "c0=c0|c1=-1*c0"], ["offcentre.wav", "c0=c0|c1=0.5*c0"]]) {
    fault(name, `[0:a]pan=stereo|${pan}[o]`);
    const m = await measure(file(name));
    const { r, out } = await mended(name, m);
    assert.equal(r.steps[0].id, "channels", name);
    const y = samples(out);
    const ch = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=channels,sample_rate,codec_name", "-of", "csv=p=0", out], { encoding: "utf8" }).stdout.trim();
    assert.equal(ch, "pcm_f32le,48000,1");
    const want = name === "offcentre.wav" ? 0.75 : 1;
    near(20 * Math.log10(rms(y) / (level * want)), 0, 0.5, `${name} level`);
  }
});

test("after: the tone stage's filters run at the end of the same pass", { skip }, async () => {
  const m = await measure(base);
  const { r, x, y } = await mended("voice.wav", m, { after: "volume=-6dB" });
  assert.match(r.graph, /volume=-6dB,aformat=sample_fmts=flt/);
  near(20 * Math.log10(rms(y) / rms(x)), -6, 0.3, "level");
});

test("a filter ffmpeg lacks is one sentence naming it", { skip }, () => {
  assert.throws(() => checkFilters(["afftdn", "nosuchfilter"]), (e) => e instanceof Refusal && /no nosuchfilter filter/.test(e.message) && !e.message.includes("\n"));
  checkFilters(["afftdn", "adeclip", "adeclick", "asendcmd", "concat", "amix", "equalizer", "highpass", "dcshift", "pan"]);
});

function near(x, y, by, what = "") { assert.ok(Math.abs(x - y) <= by, `${what} ${x} is not within ${by} of ${y}`); }
