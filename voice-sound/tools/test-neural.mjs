// The neural denoiser in repair (lib/repair.mjs): found where the machine has it, chosen only where
// `measure` found noise, its 16-bit step kept from costing a quiet recording its resolution or a
// hot one its peaks, its delay taken out, a long recording in overlapping pieces with no seam, and
// ffmpeg's method in its place wherever it fails. No real denoiser (GitHub's runner has none): a
// stand-in written here, a Node script that takes the same options and copies its input to a
// 16-bit output, with switches (environment variables) that lower it, delay it, fail, write
// nothing, another length, silence, or numbers that are not finite. No request, no key, no network.
//
//   node --test tools/test-neural.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { measure } from "./voice.mjs";
import { repair, repairPlan, neuralDenoiser, piecesOf, DPDFNET_LIMITS, DPDFNET_MODEL, NEURAL } from "./lib/repair.mjs";
import { clean } from "./lib/clean.mjs";
import { Refusal } from "./lib/analyse.mjs";

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const skip = !ffmpeg && "no ffmpeg";
const run = (args) => { const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); };
const ids = (list) => list.map((s) => s.id);
const db = (x) => 10 * Math.log10(x);

// the synthetic voice of test-repair.mjs (phrases of 2.5 s, pauses of 1.1 s), with pink noise
const D = 28.8;
const HALF = 10 ** (-6 / 20);   // the stand-in lowered by 6 dB
const VOICE = `aevalsrc=exprs='st(0,120*t+3.41*(1-cos(4.398*t))+6.92*(1-cos(1.445*t)));st(1,mod(t,3.6));` +
  `0.25*lt(ld(1),2.5)*pow(sin(12.566*ld(1)),2)*(0.6+0.4*sin(5.655*t))*2*(ld(0)-floor(ld(0)+0.5))':s=48000:d=${D},` +
  `equalizer=f=500:t=o:w=1:g=10,equalizer=f=1500:t=o:w=1:g=6,equalizer=f=2700:t=o:w=0.8:g=4,lowpass=f=5000[v];` +
  `anoisesrc=color=pink:amplitude=0.02:r=48000:d=${D}:seed=9[n];[v][n]amix=inputs=2:normalize=0`;

// the stand-in: the real program's options; it reads 16-bit or float WAV, writes 16-bit, one
// channel, 48 kHz, and drops a last block shorter than 480 samples as the real one does
const STANDIN = `#!/usr/bin/env node
const fs = require("fs");
const a = Object.fromEntries(process.argv.slice(2).map((s) => s.replace(/^--/, "").split(/=(.*)/s).slice(0, 2)));
const E = process.env;
if (E.STANDIN_LOG) fs.appendFileSync(E.STANDIN_LOG, JSON.stringify(a) + "\\n");
let count = 1;
if (E.STANDIN_COUNT) { count = (Number(fs.existsSync(E.STANDIN_COUNT) ? fs.readFileSync(E.STANDIN_COUNT, "utf8") : 0) || 0) + 1; fs.writeFileSync(E.STANDIN_COUNT, String(count)); }
if (!fs.existsSync(a["speech-denoiser-dpdfnet-model"] || "")) { console.error("no model"); process.exit(2); }
if (E.STANDIN_FAIL && count > Number(E.STANDIN_FAIL_AFTER || 0)) process.exit(Number(E.STANDIN_FAIL));
if (E.STANDIN_NOTHING) process.exit(0);
const b = fs.readFileSync(a["input-wav"]);
let off = 12, fmt, data;
while (off + 8 <= b.length) {
  const id = b.toString("latin1", off, off + 4), size = b.readUInt32LE(off + 4);
  if (id === "fmt ") fmt = { tag: b.readUInt16LE(off + 8), ch: b.readUInt16LE(off + 10), bits: b.readUInt16LE(off + 22) };
  if (id === "data") { data = b.subarray(off + 8, off + 8 + size); break; }
  off += 8 + size + (size & 1);
}
const bps = fmt.bits / 8, n = Math.floor(data.length / bps / fmt.ch), x = new Float64Array(n);
for (let i = 0; i < n; i++) for (let c = 0; c < fmt.ch; c++) {
  const j = (i * fmt.ch + c) * bps;
  x[i] += (fmt.tag === 3 ? data.readFloatLE(j) : data.readInt16LE(j) / 32768) / fmt.ch;
}
let len = Math.floor(n / 480) * 480 + Number(E.STANDIN_LENGTH || 0);
const g = 10 ** (Number(E.STANDIN_GAIN_DB || 0) / 20), d = Number(E.STANDIN_DELAY || 0);
const y = new Float64Array(len);
for (let i = 0; i < len; i++) y[i] = E.STANDIN_SILENCE ? 0 : (x[i - d] ?? 0) * g;
const nan = !!E.STANDIN_NAN, ob = nan ? 4 : 2;
const h = Buffer.alloc(44);
h.write("RIFF", 0); h.writeUInt32LE(36 + len * ob, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16);
h.writeUInt16LE(nan ? 3 : 1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(48000, 24); h.writeUInt32LE(48000 * ob, 28);
h.writeUInt16LE(ob, 32); h.writeUInt16LE(ob * 8, 34); h.write("data", 36); h.writeUInt32LE(len * ob, 40);
const o = Buffer.alloc(len * ob);
for (let i = 0; i < len; i++) {
  if (nan) o.writeFloatLE(i === len >> 1 ? NaN : y[i], i * 4);
  else o.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(y[i] * 32768))), i * 2);
}
fs.writeFileSync(a["output-wav"], Buffer.concat([h, o]));
`;

let dir, standin, model, noisy;
const file = (name) => path.join(dir, name);
const SWITCHES = ["STANDIN_LOG", "STANDIN_COUNT", "STANDIN_FAIL", "STANDIN_FAIL_AFTER", "STANDIN_NOTHING", "STANDIN_LENGTH", "STANDIN_GAIN_DB", "STANDIN_DELAY", "STANDIN_SILENCE", "STANDIN_NAN"];
const ENV = ["VOICE_SOUND_DENOISER", "VOICE_SOUND_DPDFNET", "VOICE_SOUND_DENOISE", "PATH", ...SWITCHES];
// runs fn with the environment set as given (null: unset), and puts it back after
async function withEnv(vars, fn) {
  const was = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of SWITCHES) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) if (v == null) delete process.env[k]; else process.env[k] = String(v);
  try { return await fn(); } finally {
    for (const k of ENV) if (was[k] == null) delete process.env[k]; else process.env[k] = was[k];
  }
}
// the stand-in named, with a model file; or a name that is not there, so that no denoiser is found
// even on a machine that has the real one
const STANDIN_ENV = () => ({ VOICE_SOUND_DENOISER: standin, VOICE_SOUND_DPDFNET: model, VOICE_SOUND_DENOISE: null });
const NONE_ENV = () => ({ VOICE_SOUND_DENOISER: file("not-there"), VOICE_SOUND_DPDFNET: null, VOICE_SOUND_DENOISE: null });

function samples(f) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", f, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
}
// the input through the plan's filters without the noise step: what a stand-in that copies must
// give back
function reference(name, m, out = `${name}.ref.wav`) {
  run(["-i", file(name), "-filter_complex", repairPlan(m, { denoise: "off" }).graph, "-map", "[out]", "-c:a", "pcm_f32le", file(out)]);
  return samples(file(out));
}
const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
// how far y lies from k·x, in dB under x (over [a, b))
function errorDb(x, y, k = 1, a = 0, b = x.length) {
  let e = 0, s = 0;
  for (let i = a; i < b; i++) { e += (y[i] - k * x[i]) ** 2; s += (k * x[i]) ** 2; }
  return db(e / s + 1e-30);
}
// the largest |y − k·x| over [a, b); half a 16-bit step at the gain the step used, taken back
function maxDiff(x, y, k = 1, a = 0, b = x.length) {
  let d = 0;
  for (let i = a; i < b; i++) d = Math.max(d, Math.abs(y[i] - k * x[i]));
  return d;
}
const step = (st) => (0.5 / 32768) / 10 ** (st.gainDb / 20) * 1.01 + 1e-7;
// the lag (samples) at which y matches x best around `at`
function lagOf(x, y, at, lag = 600) {
  let best = -Infinity, bl = null;
  for (let l = -lag; l <= lag; l++) {
    let s = 0;
    for (let i = at; i < at + 12000; i++) s += x[i] * (y[i + l] ?? 0);
    if (s > best) { best = s; bl = l; }
  }
  return bl;
}
// a sine at f in x[a, a+n): its amplitude and phase (a least-squares fit)
function sineAt(x, f, a, n) {
  let c = 0, s = 0;
  for (let i = a; i < a + n; i++) { const w = (2 * Math.PI * f * i) / 48000; c += x[i] * Math.cos(w); s += x[i] * Math.sin(w); }
  return { amp: (2 * Math.hypot(c, s)) / n, phase: Math.atan2(-s, c) };
}

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-sound-neural-test-"));
  standin = file("standin.js");
  fs.writeFileSync(standin, STANDIN, { mode: 0o755 });
  model = file(DPDFNET_MODEL);
  fs.writeFileSync(model, "a stand-in model");
  if (!ffmpeg) return;
  noisy = file("noisy.wav");
  run(["-filter_complex", VOICE, "-ac", "1", "-c:a", "pcm_f32le", noisy]);
});
after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

// ---------------------------------------------------------------- where it is

test("found: named by the two variables, or on the PATH with the model beside its real folder", async () => {
  await withEnv(STANDIN_ENV(), () => assert.deepEqual(neuralDenoiser(), { program: standin, model }));
  // as on a machine: /opt/sherpa-onnx/bin/<program>, models/ beside bin/, a link on the PATH
  const opt = file("opt"), bin = file("usr-bin");
  fs.mkdirSync(path.join(opt, "bin"), { recursive: true });
  fs.mkdirSync(path.join(opt, "models"), { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  fs.copyFileSync(standin, path.join(opt, "bin", "sherpa-onnx-offline-denoiser"));
  fs.chmodSync(path.join(opt, "bin", "sherpa-onnx-offline-denoiser"), 0o755);
  fs.symlinkSync(path.join(opt, "bin", "sherpa-onnx-offline-denoiser"), path.join(bin, "sherpa-onnx-offline-denoiser"));
  fs.writeFileSync(path.join(opt, "models", DPDFNET_MODEL), "x");
  await withEnv({ VOICE_SOUND_DENOISER: null, VOICE_SOUND_DPDFNET: null, PATH: `${bin}${path.delimiter}${process.env.PATH}` }, () => {
    assert.deepEqual(neuralDenoiser(), { program: path.join(bin, "sherpa-onnx-offline-denoiser"), model: path.join(opt, "models", DPDFNET_MODEL) });
  });
  // a program without its model, a model without its program: no denoiser
  await withEnv({ VOICE_SOUND_DENOISER: standin, VOICE_SOUND_DPDFNET: file("no-model.onnx") }, () => assert.equal(neuralDenoiser(), null));
  await withEnv(NONE_ENV(), () => assert.equal(neuralDenoiser(), null));
});

// ---------------------------------------------------------------- the plan

const EDGES = [0, 40, 60, 80, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 3500, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 14000, 16000, 18000, 20000, 24000];
const NOISE_BANDS = EDGES.slice(0, -1).map((lo, i) => ({ lo, hi: EDGES[i + 1], db: -45 - 3 * Math.log2(Math.max(1, lo / 500)) }));
function made(over = {}) {
  return {
    file: "made.wav", duration: 60, sound: { channels: 1, sampleRate: 48000 }, analysed: { sampleRate: 48000, channels: 1, seconds: 60 },
    loudness: { integratedLufs: -20, truePeakDb: -3 },
    speech: { share: 0.7, longest: [{ from: 12.3, to: 13.5, seconds: 1.2, db: -70, lufs: -72, silent: false }], confidence: "high" },
    levels: { speechLufs: -20, noiseLufs: -45, snrDb: 25, snrADb: 25 },
    noise: { lufs: -45, kind: "broadband", fluctuationDb: 0.5, spreadDb: 1, bands: NOISE_BANDS },
    hum: { hz: null, harmonics: 0, overDb: 2, at50: [], at60: [] },
    clipping: { peakDb: -3, ceilingDb: -3, pileUp: 0.2, share: 0, exactShare: 0 },
    dc: { values: [0], db: -120 }, low: { below80Db: -30, pauses80Db: -35, thumps: { count: 0, perMinute: 0, at: [] } },
    clicks: { count: 0, over: { 20: 0, 30: 0, 40: 0 }, at: [] }, channels: null, room: { rt60: 0.3, confidence: "medium" },
    findings: [{ id: "noise", strength: "some", text: "noise" }],
    ...over,
  };
}

test("plan: dpdfnet where both files are there and noise was measured, never without noise", async () => {
  await withEnv(STANDIN_ENV(), () => {
    const p = repairPlan(made());
    assert.equal(p.method, "dpdfnet");
    const st = p.steps.find((s) => s.id === "denoise");
    // 20 dB to the aim, auto allows 18
    assert.equal(st.limitDb, 18);
    assert.equal(st.reduceDb, 18);
    assert.match(st.why, /neural denoiser \(DPDFNet-2\) asked to take at most 18 dB off, the most --denoise auto allows/);
    assert.equal(st.pieces.length, 1);
    assert.deepEqual(p.inputs, [{ input: 0, what: "the file" }]);
    assert.equal(p.graphs.length, 2);
    assert.doesNotMatch(p.graphs[0], /afftdn|arnndn/);
    // the limit: what the aim needs, never more than --denoise allows
    for (const s of ["gentle", "auto", "strong"]) assert.equal(repairPlan(made(), { denoise: s }).steps.at(-1).limitDb, Math.min(20, DPDFNET_LIMITS[s]), s);
    assert.ok(DPDFNET_LIMITS.gentle < DPDFNET_LIMITS.auto && DPDFNET_LIMITS.auto < DPDFNET_LIMITS.strong);
    assert.equal(repairPlan(made({ levels: { speechLufs: -20, snrDb: 33, snrADb: 33 } })).steps.at(-1).limitDb, 12, "not more than needed");
    // no noise measured, --denoise off: no denoiser
    const clean = repairPlan(made({ findings: [] }));
    assert.equal(clean.method, "off");
    assert.deepEqual(ids(clean.steps), ["highpass"]);
    assert.equal(clean.neural, undefined);
    assert.equal(repairPlan(made(), { denoise: "off" }).method, "off");
    // ffmpeg's method although the denoiser is there, by option or variable
    assert.equal(repairPlan(made(), { method: "ffmpeg" }).method, "afftdn-sample");
    process.env.VOICE_SOUND_DENOISE = "ffmpeg";
    assert.equal(repairPlan(made()).method, "afftdn-sample");
    delete process.env.VOICE_SOUND_DENOISE;
    // what is left: the changing noise was worked on, what remains stays
    const changing = repairPlan(made({ noise: { lufs: -45, kind: "changing", fluctuationDb: 5, bands: NOISE_BANDS } }));
    const l = changing.left.find((x) => /changes/.test(x.why));
    assert.match(l.why, /the neural denoiser took up to 18 dB off it, and what is left of it stays/);
    assert.doesNotMatch(changing.left.map((x) => x.why).join(" "), /cannot follow/);
    for (const x of changing.left) assert.equal(x.why.split(/\. /).length, 1, x.why);
  });
  // without it: ffmpeg's method, and changing noise is left as today, nothing said of software
  await withEnv(NONE_ENV(), () => {
    const changing = repairPlan(made({ noise: { lufs: -45, kind: "changing", fluctuationDb: 5, bands: NOISE_BANDS } }));
    assert.equal(changing.method, "afftdn-sample");
    assert.ok(changing.left.some((x) => /a filter that learns one noise cannot follow it, so some of it stays/.test(x.why)));
    assert.doesNotMatch(JSON.stringify(changing), /neural|dpdfnet|DPDFNet|sherpa/);
    assert.throws(() => repairPlan(made(), { method: "dpdfnet" }), (e) => e instanceof Refusal && /VOICE_SOUND_DENOISER/.test(e.message));
  });
});

test("plan: without the denoiser exactly what ffmpeg's method gives with it", async () => {
  const cases = [made(), made({ speech: { longest: [] } }), made({ noise: { lufs: -45, kind: "changing", fluctuationDb: 5, bands: NOISE_BANDS } })];
  for (const m of cases) {
    const without = await withEnv(NONE_ENV(), () => repairPlan(m));
    const asked = await withEnv(STANDIN_ENV(), () => repairPlan(m, { method: "ffmpeg" }));
    assert.deepEqual(without, asked);
    assert.equal(without.graphs, undefined);
  }
});

test("pieces: bounded whatever the length, overlapping, cut at a pause near the cut", () => {
  const R = 48000;
  assert.deepEqual(piecesOf(100 * R).pieces, [{ from: 0, to: 100 * R }]);
  const n = 3 * 3600 * R;
  const pauses = [{ from: 299.5, to: 301.5 }, { from: 1000, to: 1001 }];
  const { pieces, seams, fade } = piecesOf(n, pauses);
  const longest = Math.max(...pieces.map((p) => p.to - p.from)) / R;
  assert.ok(longest <= NEURAL.pieceS + 2 * NEURAL.shiftS + NEURAL.warmS + NEURAL.fadeS + NEURAL.tailS, `${longest} s`);
  assert.equal(pieces[0].from, 0);
  assert.equal(pieces.at(-1).to, n);
  for (let k = 1; k < pieces.length; k++) {
    const s = seams[k - 1].at;
    // the next piece starts warmS before the fade, the one before ends after it
    assert.equal(pieces[k].from, s - fade / 2 - NEURAL.warmS * R);
    assert.ok(pieces[k - 1].to >= s + fade / 2);
    assert.ok(seams[k - 1].at > (k > 1 ? seams[k - 2].at : 0));
  }
  // a pause within shiftS of a cut takes it (its middle); none near: the cut stays
  assert.ok(seams.some((s) => s.pause && s.at === 300.5 * R), JSON.stringify(seams.slice(0, 3)));
  assert.ok(seams.some((s) => !s.pause));
});

// ---------------------------------------------------------------- on sound

test("the gain round its 16-bit step: a quiet and a hot recording come back as they were", { skip }, async () => {
  for (const [name, gain] of [["quiet.wav", -40], ["hot.wav", 12]]) {
    run(["-i", noisy, "-af", `volume=${gain}dB`, "-c:a", "pcm_f32le", file(name)]);
    const m = await measure(file(name));
    assert.ok(m.findings.some((f) => f.id === "noise"), name);
    const r = await withEnv(STANDIN_ENV(), () => repair(file(name), file(`${name}.out.wav`), m));
    assert.equal(r.method, "dpdfnet", name);
    const x = reference(name, m), y = samples(file(`${name}.out.wav`));
    assert.equal(y.length, x.length, name);
    // 16 bits at the recording's own level would leave the quiet one 40 dB of resolution less
    // (about −47 dB of error) and clip the hot one; at −6 dBFS the error is under −70 dB
    const e = errorDb(x, y);
    assert.ok(e < -70, `${name}: error ${e.toFixed(1)} dB`);
    assert.ok(Math.abs(20 * Math.log10(rms(y) / rms(x))) < 0.01, `${name}: level`);
    const st = r.steps.find((s) => s.id === "denoise");
    assert.ok(name === "quiet.wav" ? st.gainDb > 30 : st.gainDb < 0, JSON.stringify(st));
  }
});

test("its delay is measured and taken out: in step and as long", { skip }, async () => {
  const m = await measure(noisy);
  const r = await withEnv({ ...STANDIN_ENV(), STANDIN_DELAY: 300, STANDIN_GAIN_DB: -6 }, () => repair(noisy, file("delayed.out.wav"), m));
  const st = r.steps.find((s) => s.id === "denoise");
  assert.equal(r.method, "dpdfnet");
  assert.equal(st.delaySamples, 300);
  assert.match(st.why, /came 300 samples late, taken out/);
  const x = reference("noisy.wav", m), y = samples(file("delayed.out.wav"));
  assert.equal(y.length, x.length);
  for (const at of [48000, 600000, 1300000]) assert.equal(lagOf(x, y, at), 0, `at ${at}`);
  // sample for sample the reference lowered, within half a step of its 16 bits (the gain taken back)
  assert.ok(maxDiff(x, y, HALF) <= step(st), `${maxDiff(x, y, HALF)} over ${step(st)}`);
  // no delay: none taken out, nothing said
  const r0 = await withEnv(STANDIN_ENV(), () => repair(noisy, file("plain.out.wav"), m));
  assert.equal(r0.steps.find((s) => s.id === "denoise").delaySamples, 0);
  assert.doesNotMatch(r0.steps.find((s) => s.id === "denoise").why, /late/);
});

test("longer than a piece: as long, in step, no jump at the seams (a tone through them keeps its phase and level)", { skip }, async () => {
  // a 1 kHz tone under the voice
  run(["-i", noisy, "-filter_complex", `sine=f=1000:r=48000:d=${D},volume=0.05[t];[0:a][t]amix=inputs=2:normalize=0[o]`, "-map", "[o]", "-c:a", "pcm_f32le", file("tone.wav")]);
  const m = await measure(file("tone.wav"));
  const tune = { pieceS: 6, shiftS: 1, warmS: 0.5, fadeS: 0.4, tailS: 0.2 };
  const log = file("calls.log");
  const r = await withEnv({ ...STANDIN_ENV(), STANDIN_LOG: log, STANDIN_GAIN_DB: -6 }, () => repair(file("tone.wav"), file("tone.out.wav"), m, { tune }));
  const st = r.steps.find((s) => s.id === "denoise");
  assert.equal(r.method, "dpdfnet");
  assert.equal(st.pieces.length, 5);
  assert.equal(st.seams.length, 4);
  assert.match(st.why, /in 5 overlapping pieces/);
  const calls = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(calls.length, 5);
  for (const c of calls) {
    assert.equal(c["speech-denoiser-dpdfnet-attenuation-limit-db"], String(st.limitDb));
    assert.equal(c["num-threads"], "1");
  }
  const x = reference("tone.wav", m), y = samples(file("tone.out.wav"));
  assert.equal(y.length, x.length);
  assert.ok(maxDiff(x, y, HALF) <= step(st), `${maxDiff(x, y, HALF)} over ${step(st)}`);
  for (const s of st.seams) {
    const at = Math.round(s.at * 48000), w = Math.round(tune.fadeS * 48000);
    assert.equal(lagOf(x, y, at - 6000), 0, `in step at ${s.at} s`);
    // over the fade and on both sides of it, sample for sample the reference lowered
    assert.ok(maxDiff(x, y, HALF, at - w, at + w) <= step(st), `the seam at ${s.at} s`);
    // the tone in the 50 ms before the fade and after it: the same level, its phase running on
    const n = 2400, a = sineAt(y, 1000, at - w / 2 - n, n), b = sineAt(y, 1000, at + w / 2, n);
    const ra = sineAt(x, 1000, at - w / 2 - n, n), rb = sineAt(x, 1000, at + w / 2, n);
    assert.ok(Math.abs(20 * Math.log10(a.amp / b.amp) - 20 * Math.log10(ra.amp / rb.amp)) < 0.05, `level at ${s.at} s`);
    const dphi = (u, v) => Math.atan2(Math.sin(u - v), Math.cos(u - v));
    assert.ok(Math.abs(dphi(a.phase, ra.phase)) < 0.01 && Math.abs(dphi(b.phase, rb.phase)) < 0.01, `phase at ${s.at} s`);
  }
});

test("each failure falls back to ffmpeg's method for the whole recording and says so", { skip }, async () => {
  const m = await measure(noisy);
  const tune = { pieceS: 6, shiftS: 1, warmS: 0.5, fadeS: 0.4, tailS: 0.2 };
  const cases = [
    [{ STANDIN_FAIL: 3 }, /it exited with 3/],
    [{ STANDIN_FAIL: 3, STANDIN_FAIL_AFTER: 1, STANDIN_COUNT: file("count") }, /it exited with 3, on piece 2 of 5/],
    [{ STANDIN_NOTHING: 1 }, /it wrote nothing/],
    [{ STANDIN_LENGTH: -480 }, /samples long for/],
    [{ STANDIN_SILENCE: 1 }, /silent/],
    [{ STANDIN_NAN: 1 }, /not finite/],
    [{ STANDIN_GAIN_DB: 12 }, /clipped/],
  ];
  const x = reference("noisy.wav", m);
  for (const [sw, why] of cases) {
    fs.rmSync(file("count"), { force: true });
    const r = await withEnv({ ...STANDIN_ENV(), ...sw }, () => repair(noisy, file("failed.out.wav"), m, { tune }));
    const st = r.steps.find((s) => s.id === "denoise");
    assert.equal(r.method, "afftdn-sample", JSON.stringify(sw));
    assert.match(st.why, /the neural denoiser failed \(.*\), so ffmpeg's afftdn-sample did this for the whole recording\.$/);
    assert.match(st.fallback.reason, why);
    assert.equal(st.why.split(/\. /).length, 1, st.why);
    assert.equal(samples(file("failed.out.wav")).length, x.length);
    // and what is left is what ffmpeg's method leaves
    assert.doesNotMatch(r.left.map((l) => l.why).join(" "), /neural/);
  }
  // the program missing or not runnable once found: the same
  const gone = file("gone.js");
  fs.writeFileSync(gone, "#!/nonexistent/interpreter\n", { mode: 0o755 });
  const r = await withEnv({ ...STANDIN_ENV(), VOICE_SOUND_DENOISER: gone }, () => repair(noisy, file("failed.out.wav"), m));
  assert.equal(r.method, "afftdn-sample");
  assert.match(r.steps.find((s) => s.id === "denoise").fallback.reason, /could not be started|exited with/);
});

test("clean never fails because of it: the report says what stood in", { skip }, async () => {
  const r = await withEnv({ ...STANDIN_ENV(), STANDIN_FAIL: 1 }, () => clean(noisy, file("cleaned.m4a"), { level: "off" }));
  const st = r.steps.find((s) => s.id === "denoise");
  assert.ok(st.fallback && /neural denoiser failed/.test(st.why), JSON.stringify(st));
  assert.equal(r.settings.repairStage.method, "afftdn-sample");
  const ok = await withEnv(STANDIN_ENV(), () => clean(noisy, file("cleaned2.m4a"), { level: "off" }));
  assert.equal(ok.settings.repairStage.method, "dpdfnet");
});

test("without it: repair is today's, to the sample", { skip }, async () => {
  const m = await measure(noisy);
  const a = await withEnv(NONE_ENV(), () => repair(noisy, file("none.out.wav"), m));
  const b = await withEnv(STANDIN_ENV(), () => repair(noisy, file("ffmpeg.out.wav"), m, { method: "ffmpeg" }));
  assert.equal(a.method, "afftdn-sample");
  assert.deepEqual(a, b);
  assert.ok(fs.readFileSync(file("none.out.wav")).equals(fs.readFileSync(file("ffmpeg.out.wav"))));
});

test("a file whose name begins with a dash, in and out, with and without the denoiser", { skip }, async () => {
  fs.copyFileSync(noisy, file("-dash.wav"));
  const m = await measure(file("-dash.wav"));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    for (const [env, method] of [[NONE_ENV(), "afftdn-sample"], [STANDIN_ENV(), "dpdfnet"]]) {
      fs.rmSync(file("-out.wav"), { force: true });
      const r = await withEnv(env, () => repair("-dash.wav", "-out.wav", m));
      assert.equal(r.method, method);
      assert.equal(samples(file("-out.wav")).length, samples(file("-dash.wav")).length);
    }
  } finally { process.chdir(cwd); }
});
