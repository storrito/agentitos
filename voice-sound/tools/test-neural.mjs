// The neural denoiser in repair (lib/repair.mjs): found where the machine has it, chosen only where
// `measure` found noise, the probe found it under the voice or the person named a strength, its
// 16-bit step at a level by the voice (a quiet recording keeps its resolution, a hot one or a bump
// its peaks), its delay taken out, a long recording in overlapping pieces cross-faded, what it did
// to the voice itself checked, and ffmpeg's method in its place wherever it fails. No real denoiser
// needed (GitHub's runner has none): a stand-in written here, a Node script that takes the same
// options and copies its input to a 16-bit output, with switches (environment variables) that
// lower it (all of it, each piece by more, or one stretch), add noise, delay it, fail, hang, write
// nothing, another length, silence, junk, or numbers that are not finite. Where VOICE_SOUND_DENOISER
// and VOICE_SOUND_DPDFNET name the real one, one test runs it too. No request, no key, no network.
//
//   node --test tools/test-neural.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { measure } from "./voice.mjs";
import { repair, repairPlan, probeNoise, neuralDenoiser, piecesOf, levelFor, DPDFNET_LIMITS, DPDFNET_MODEL, DENOISE_CAPS, NEURAL, PROBE_FIRES_DB, PROBE_MIN_DB, PROBE_KEPT, VOICE_KEPT, voiceKept, denoiserSlots, SLOTS } from "./lib/repair.mjs";
import { clean } from "./lib/clean.mjs";
import { Refusal } from "./lib/analyse.mjs";

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const skip = !ffmpeg && "no ffmpeg";
// the real denoiser, where the two variables name it on this machine (the lab's: see the skill's README)
const REAL = { VOICE_SOUND_DENOISER: process.env.VOICE_SOUND_DENOISER, VOICE_SOUND_DPDFNET: process.env.VOICE_SOUND_DPDFNET, VOICE_SOUND_DENOISE: null };
const real = ffmpeg && REAL.VOICE_SOUND_DENOISER && REAL.VOICE_SOUND_DPDFNET && fs.existsSync(REAL.VOICE_SOUND_DENOISER) && fs.existsSync(REAL.VOICE_SOUND_DPDFNET);
const skipReal = !real && "no real denoiser named in VOICE_SOUND_DENOISER and VOICE_SOUND_DPDFNET";
const run = (args) => { const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); };
const ids = (list) => list.map((s) => s.id);
const near = (x, y, by, what = "") => assert.ok(Math.abs(x - y) <= by, `${what} ${x} is not within ${by} of ${y}`);
const db = (x) => 10 * Math.log10(x);
const r2 = (x) => Math.round(x * 100) / 100;

// the synthetic voice of test-repair.mjs (phrases of 2.5 s, pauses of 1.1 s), with pink noise
const D = 28.8;
// the stand-in lowered by 1 dB (so that the gain round it is seen to be taken back; more would be
// a denoiser that takes the voice down)
const LOWER_DB = -1, LOWER = 10 ** (LOWER_DB / 20);
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
if (E.STANDIN_PID) fs.appendFileSync(E.STANDIN_PID, process.pid + "\\n");
const t0 = Date.now();
// (the call's number: from STANDIN_COUNT, a file counted up; with STANDIN_BY_PIECE, the piece's
// own number from its file's name, 1 for the first: pieces that start at once count in any order)
let count = 1;
const piece = String(a["input-wav"] || "").match(/piece-(\\d+)\\.wav$/);
if (E.STANDIN_BY_PIECE && piece) count = Number(piece[1]) + 1;
else if (E.STANDIN_COUNT) { count = (Number(fs.existsSync(E.STANDIN_COUNT) ? fs.readFileSync(E.STANDIN_COUNT, "utf8") : 0) || 0) + 1; fs.writeFileSync(E.STANDIN_COUNT, String(count)); }
if (!fs.existsSync(a["speech-denoiser-dpdfnet-model"] || "")) { console.error("no model"); process.exit(2); }
if (E.STANDIN_FAIL && count > Number(E.STANDIN_FAIL_AFTER || 0) && (!E.STANDIN_FAIL_ONLY || count === Number(E.STANDIN_FAIL_ONLY))) process.exit(Number(E.STANDIN_FAIL));
if (E.STANDIN_SLEEP) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(E.STANDIN_SLEEP) * 1000);
// (STANDIN_TIMES: when each call ran, appended at its end)
process.on("exit", () => { if (E.STANDIN_TIMES) fs.appendFileSync(E.STANDIN_TIMES, JSON.stringify({ count, t0, t1: Date.now() }) + "\\n"); });
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
// (STANDIN_STEP_DB: the k-th call lowered by k − 1 times that, so that each piece differs)
const g = 10 ** ((Number(E.STANDIN_GAIN_DB || 0) + (count - 1) * Number(E.STANDIN_STEP_DB || 0)) / 20), d = Number(E.STANDIN_DELAY || 0);
// (STANDIN_LOW_DB: from the STANDIN_LOW_CALL-th call on, the samples from STANDIN_LOW_FROM to
// STANDIN_LOW_TO seconds of its input lowered by that much: a denoiser that takes a voice for noise)
const low = E.STANDIN_LOW_DB && count >= Number(E.STANDIN_LOW_CALL || 1) ? 10 ** (Number(E.STANDIN_LOW_DB) / 20) : 1;
const lowFrom = Number(E.STANDIN_LOW_FROM || 0) * 48000, lowTo = E.STANDIN_LOW_TO ? Number(E.STANDIN_LOW_TO) * 48000 : Infinity;
const y = new Float64Array(len);
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
let ex = 0; for (let i = 0; i < n; i++) ex += x[i] * x[i];
const junk = Math.sqrt((12 * ex) / Math.max(1, n));
for (let i = 0; i < len; i++) {
  // (STANDIN_JUNK: noise as loud as its input, which follows nothing of it)
  if (E.STANDIN_JUNK) { y[i] = rnd() * junk; continue; }
  y[i] = E.STANDIN_SILENCE ? 0 : (x[i - d] ?? 0) * g * (i >= lowFrom && i < lowTo ? low : 1);
  // (STANDIN_ADD_DB: noise that much under its input's level added: what "came out" is that noise)
  if (E.STANDIN_ADD_DB) y[i] += rnd() * junk * 10 ** (Number(E.STANDIN_ADD_DB) / 20);
}
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
const SWITCHES = ["STANDIN_PID", "STANDIN_SLEEP", "STANDIN_LOG","STANDIN_COUNT", "STANDIN_FAIL", "STANDIN_FAIL_AFTER", "STANDIN_NOTHING", "STANDIN_LENGTH", "STANDIN_GAIN_DB", "STANDIN_DELAY", "STANDIN_SILENCE", "STANDIN_NAN",
  "STANDIN_STEP_DB", "STANDIN_LOW_DB", "STANDIN_LOW_CALL", "STANDIN_LOW_FROM", "STANDIN_LOW_TO", "STANDIN_JUNK", "STANDIN_ADD_DB", "STANDIN_BY_PIECE", "STANDIN_FAIL_ONLY", "STANDIN_TIMES"];
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
const step = (st) => (0.5 / 32768) / 10 ** ((st.gainDb + (st.heldDb ?? 0)) / 20) * 1.01 + 1e-7;
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
  run(["-filter_complex", VOICE.replace("amplitude=0.02", "amplitude=0.0003"), "-ac", "1", "-c:a", "pcm_f32le", file("quiet-noise.wav")]);
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
    // (a minute: one piece on one slot, three of 20 s where four can run at once)
    const piecesBy = (slots) => repairPlan(made(), { tune: { slots } }).steps.find((s) => s.id === "denoise").pieces.length;
    assert.equal(piecesBy(1), 1);
    assert.equal(piecesBy(4), 3);
    assert.deepEqual(p.inputs, [{ input: 0, what: "the file" }]);
    assert.equal(p.graphs.length, 2);
    assert.doesNotMatch(p.graphs[0], /afftdn|arnndn/);
    // the limit: what the aim needs, never more than --denoise allows (strong: its cap)
    for (const s of ["gentle", "auto"]) assert.equal(repairPlan(made(), { denoise: s }).steps.at(-1).limitDb, Math.min(20, DPDFNET_LIMITS[s]), s);
    assert.equal(repairPlan(made(), { denoise: "strong" }).steps.at(-1).limitDb, DPDFNET_LIMITS.strong, "strong: its cap");
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
  // without it: ffmpeg's method, the step saying the machine has no denoiser, and changing noise
  // left with what a machine with it would do; no program or model named
  await withEnv(NONE_ENV(), () => {
    const changing = repairPlan(made({ noise: { lufs: -45, kind: "changing", fluctuationDb: 5, bands: NOISE_BANDS } }));
    assert.equal(changing.method, "afftdn-sample");
    const l = changing.left.find((x) => /changes/.test(x.why));
    assert.match(l.why, /a filter that learns one noise cannot follow it, so some of it stays; a machine with the neural denoiser would take more of it\.$/);
    assert.doesNotMatch(JSON.stringify(changing), /dpdfnet|DPDFNet|sherpa/);
    assert.throws(() => repairPlan(made(), { method: "dpdfnet" }), (e) => e instanceof Refusal && /VOICE_SOUND_DENOISER/.test(e.message));
  });
});

// a plan without the denoiser, what it says of the machine taken out: what ffmpeg's method gives
const unsaid = (p) => JSON.parse(JSON.stringify(p, (k, v) => k === "denoiser" && v === "absent" ? undefined
  : typeof v === "string" ? v.replace("; no neural denoiser on this machine: ffmpeg's method.", ".").replace("; a machine with the neural denoiser would take more of it.", ".") : v));

test("plan: without the denoiser exactly what ffmpeg's method gives with it, but for saying so", async () => {
  const cases = [made(), made({ speech: { longest: [] } }), made({ noise: { lufs: -45, kind: "changing", fluctuationDb: 5, bands: NOISE_BANDS } })];
  for (const m of cases) {
    const without = await withEnv(NONE_ENV(), () => repairPlan(m));
    const asked = await withEnv(STANDIN_ENV(), () => repairPlan(m, { method: "ffmpeg" }));
    const st = without.steps.find((s) => s.id === "denoise");
    assert.equal(st.denoiser, "absent");
    assert.deepEqual(Object.keys(st).slice(0, 4), ["id", "why", "method", "denoiser"]);
    assert.match(st.why, /; no neural denoiser on this machine: ffmpeg's method\.$/);
    assert.equal(st.why.split(/\. /).length, 1, st.why);
    assert.doesNotMatch(JSON.stringify(asked), /absent|no neural denoiser|would take more/);
    assert.equal(without.graph, asked.graph);
    assert.deepEqual(unsaid(without), asked);
    assert.equal(without.graphs, undefined);
  }
});

test("plan: the machine's missing denoiser is said only where it decided the method", async () => {
  const changing = made({ noise: { lufs: -45, kind: "changing", fluctuationDb: 5, bands: NOISE_BANDS } });
  // ffmpeg's method chosen, by option or by the environment; the noise step off; no noise at all;
  // a strength named where no pause lets ffmpeg's methods learn a noise (no step runs)
  const plans = [
    await withEnv(NONE_ENV(), () => repairPlan(changing, { method: "ffmpeg" })),
    await withEnv(NONE_ENV(), () => repairPlan(changing, { method: "afftdn-profile" })),
    await withEnv({ ...NONE_ENV(), VOICE_SOUND_DENOISE: "ffmpeg" }, () => repairPlan(changing)),
    await withEnv(NONE_ENV(), () => repairPlan(changing, { denoise: "off" })),
    await withEnv(NONE_ENV(), () => repairPlan(made({ findings: [] }))),
    await withEnv(NONE_ENV(), () => repairPlan(made({ findings: [], speech: { share: 0.9, longest: [] } }), { denoise: "strong" })),
  ];
  for (const p of plans) assert.doesNotMatch(JSON.stringify(p), /absent|no neural denoiser|would take more/);
  assert.ok(plans[0].left.some((x) => /cannot follow it, so some of it stays\.$/.test(x.why)));
  assert.equal(plans[3].steps.find((s) => s.id === "denoise"), undefined);
  // a strength the person named where measure found none: the method still the machine's lack
  const named = await withEnv(NONE_ENV(), () => repairPlan(made({ findings: [] }), { denoise: "strong" }));
  const st = named.steps.find((s) => s.id === "denoise");
  assert.equal(st.method, "afftdn-sample");
  assert.equal(st.denoiser, "absent");
  assert.match(st.why, /^Asked for with --denoise strong.*; no neural denoiser on this machine: ffmpeg's method\.$/);
});

test("pieces: bounded whatever the length, overlapping, cut at a pause near the cut", () => {
  const R = 48000;
  // how many: none longer than pieceS, as many as the slots while each is minPieceS, whole rounds
  const count = (s, slots) => piecesOf(s * R, [], { ...NEURAL, slots }).pieces.length;
  assert.deepEqual(piecesOf(15 * R, [], { ...NEURAL, slots: 7 }).pieces, [{ from: 0, to: 15 * R }]);
  assert.deepEqual([count(15, 7), count(60, 7), count(60, 2), count(100, 1), count(300, 7), count(900, 7), count(900, 1)], [1, 3, 2, 2, 7, 21, 15]);
  const n = 3 * 3600 * R;
  const pauses = [{ from: 299.5, to: 301.5 }, { from: 1000, to: 1001 }];
  const { pieces, seams, fade } = piecesOf(n, pauses, { ...NEURAL, slots: 7 });
  const longest = Math.max(...pieces.map((p) => p.to - p.from)) / R;
  assert.ok(longest <= NEURAL.pieceS + 2 * NEURAL.shiftS + NEURAL.warmS + NEURAL.fadeS + NEURAL.tailS, `${longest} s`);
  assert.equal(pieces[0].from, 0);
  assert.equal(pieces.at(-1).to, n);
  for (let k = 1; k < pieces.length; k++) {
    const s = seams[k - 1].at;
    // the next piece starts warmS before the fade, the one before ends after it
    assert.equal(pieces[k].from, s - fade / 2 - NEURAL.warmS * R);
    // (on the program's grid of 480 samples, as one run over the whole file is)
    assert.equal(pieces[k].from % 480, 0, `piece ${k}`);
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
  const r = await withEnv({ ...STANDIN_ENV(), STANDIN_DELAY: 300, STANDIN_GAIN_DB: LOWER_DB }, () => repair(noisy, file("delayed.out.wav"), m));
  const st = r.steps.find((s) => s.id === "denoise");
  assert.equal(r.method, "dpdfnet");
  assert.equal(st.delaySamples, 300);
  assert.match(st.why, /came 300 samples late, taken out/);
  const x = reference("noisy.wav", m), y = samples(file("delayed.out.wav"));
  assert.equal(y.length, x.length);
  for (const at of [48000, 600000, 1300000]) assert.equal(lagOf(x, y, at), 0, `at ${at}`);
  // sample for sample the reference lowered, within half a step of its 16 bits (the gain taken back)
  assert.ok(maxDiff(x, y, LOWER) <= step(st), `${maxDiff(x, y, LOWER)} over ${step(st)}`);
  // no delay: none taken out, nothing said
  const r0 = await withEnv(STANDIN_ENV(), () => repair(noisy, file("plain.out.wav"), m));
  assert.equal(r0.steps.find((s) => s.id === "denoise").delaySamples, 0);
  assert.doesNotMatch(r0.steps.find((s) => s.id === "denoise").why, /late/);
});

test("longer than a piece: as long, in step, each seam a cross-fade (a stand-in that differs from piece to piece)", { skip }, async () => {
  // a 1 kHz tone under the voice
  run(["-i", noisy, "-filter_complex", `sine=f=1000:r=48000:d=${D},volume=0.05[t];[0:a][t]amix=inputs=2:normalize=0[o]`, "-map", "[o]", "-c:a", "pcm_f32le", file("tone.wav")]);
  const m = await measure(file("tone.wav"));
  const tune = { pieceS: 6, shiftS: 1, warmS: 0.5, fadeS: 0.4, tailS: 0.2 };
  const log = file("calls.log"), count = file("count-seams");
  fs.rmSync(count, { force: true });
  // (piece k lowered by k × 0.25 dB: a hard cut between two pieces would step by 0.25 dB)
  const STEP = -0.25;
  const r = await withEnv({ ...STANDIN_ENV(), STANDIN_LOG: log, STANDIN_STEP_DB: STEP, STANDIN_BY_PIECE: 1 }, () => repair(file("tone.wav"), file("tone.out.wav"), m, { tune }));
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
  // what must come out, sample for sample: piece k at its own gain, and over each seam's fade the
  // raised cosine from the one before into it, the two weights summing to one
  const cut = piecesOf(x.length, m.speech.longest, { ...NEURAL, ...tune }), half = cut.fade / 2;
  assert.deepEqual(cut.seams.map((s) => r2(s.at / 48000)), st.seams.map((s) => s.at));
  const gk = (k) => 10 ** ((k * STEP) / 20), want = new Float64Array(x.length);
  for (let k = 0; k < cut.pieces.length; k++) {
    const a = k ? cut.seams[k - 1].at - half : 0, b = k < cut.seams.length ? cut.seams[k].at - half : x.length;
    for (let i = a; i < b; i++) want[i] = gk(k) * x[i];
    if (k) for (let j = 0; j < cut.fade; j++) { const w = Math.sin((Math.PI / 2) * ((j + 0.5) / cut.fade)) ** 2; want[a + j] = (w * gk(k) + (1 - w) * gk(k - 1)) * x[a + j]; }
  }
  const off = maxDiff(want, y);
  assert.ok(off <= step(st), `${off} over ${step(st)}`);
  for (const [j, s] of cut.seams.entries()) {
    assert.equal(lagOf(x, y, s.at - 6000), 0, `in step at ${s.at / 48000} s`);
    // (a hard cut there would be this far off: the stand-in's pieces differ enough for it to show)
    let cutOff = 0;
    for (let i = s.at - half; i < s.at + half; i++) cutOff = Math.max(cutOff, Math.abs((i < s.at ? gk(j) : gk(j + 1)) * x[i] - want[i]));
    assert.ok(cutOff > 5 * step(st), `a hard cut would be ${cutOff} off`);
    // the tone in the 50 ms before the fade and after it: its phase running on
    const w = cut.fade, n = 2400, a = sineAt(y, 1000, s.at - w / 2 - n, n), b = sineAt(y, 1000, s.at + w / 2, n);
    const ra = sineAt(x, 1000, s.at - w / 2 - n, n), rb = sineAt(x, 1000, s.at + w / 2, n);
    const dphi = (u, v) => Math.atan2(Math.sin(u - v), Math.cos(u - v));
    assert.ok(Math.abs(dphi(a.phase, ra.phase)) < 0.01 && Math.abs(dphi(b.phase, rb.phase)) < 0.01, `phase at ${s.at / 48000} s`);
  }
});

test("the pieces run at once, as many as the slots; one that fails ends the others", { skip }, async () => {
  const m = await measure(noisy);
  const tune = { pieceS: 6, minPieceS: 5, shiftS: 1, warmS: 0.5, fadeS: 0.4, tailS: 0.2 };
  const spans = (times) => fs.readFileSync(times, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  // five slots: the five pieces' runs all overlap (each sleeps 1.5 s), one slot: none does
  for (const slots of [5, 1]) {
    const times = file(`times-${slots}`);
    fs.rmSync(times, { force: true });
    const r = await withEnv({ ...STANDIN_ENV(), STANDIN_SLEEP: 1.5, STANDIN_TIMES: times }, () => repair(noisy, file(`at-once-${slots}.out.wav`), m, { tune: { ...tune, slots } }));
    assert.equal(r.method, "dpdfnet");
    const s = spans(times).sort((a, b) => a.t0 - b.t0);
    assert.equal(s.length, 5);
    if (slots === 5) assert.ok(Math.max(...s.map((x) => x.t0)) < Math.min(...s.map((x) => x.t1)), JSON.stringify(s));
    else for (let k = 1; k < 5; k++) assert.ok(s[k].t0 >= s[k - 1].t1 - 50, JSON.stringify(s));
    // and the result is the same as one after another gives
    if (slots === 1) assert.ok(fs.readFileSync(file("at-once-5.out.wav")).equals(fs.readFileSync(file("at-once-1.out.wav"))));
  }
  // the second piece fails at once while the others would run 20 s: they are ended, ffmpeg's
  // method stands in, well before them
  const pids = file("fail.pids");
  fs.rmSync(pids, { force: true });
  const t0 = Date.now();
  const f = await withEnv({ ...STANDIN_ENV(), STANDIN_SLEEP: 20, STANDIN_FAIL: 3, STANDIN_FAIL_ONLY: 2, STANDIN_BY_PIECE: 1, STANDIN_PID: pids }, () => repair(noisy, file("fail-once.out.wav"), m, { tune: { ...tune, slots: 5 } }));
  assert.ok(Date.now() - t0 < 15000, `${Date.now() - t0} ms`);
  assert.equal(f.method, "afftdn-sample");
  assert.match(f.steps.find((s) => s.id === "denoise").fallback.reason, /^it exited with 3, on piece 2 of 5$/);
  for (const q of fs.readFileSync(pids, "utf8").trim().split("\n").map(Number)) assert.ok(gone(q), `piece ${q} is gone`);
});

test("the probe's windows run at once too", { skip }, async () => {
  // (57.6 s without noise in the pauses: six windows of 5 s)
  run(["-i", file("quiet-noise.wav"), "-i", file("quiet-noise.wav"), "-filter_complex", "concat=n=2:v=0:a=1", "-c:a", "pcm_f32le", file("quiet2.wav")]);
  const m = await measure(file("quiet2.wav"));
  const times = file("probe-times");
  fs.rmSync(times, { force: true });
  const r = await withEnv({ ...STANDIN_ENV(), STANDIN_SLEEP: 1.5, STANDIN_TIMES: times }, () => repair(file("quiet2.wav"), file("quiet2.out.wav"), m, { tune: { slots: 6 } }));
  assert.equal(r.probe.windows, 6);
  const s = fs.readFileSync(times, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(s.length, 6);
  assert.ok(Math.max(...s.map((x) => x.t0)) < Math.min(...s.map((x) => x.t1)), JSON.stringify(s));
  assert.equal(r.probe.fires, false);
});

test("denoiserSlots: the cores less one, no more than half the memory available holds, at least one", () => {
  const per = SLOTS.baseMb + SLOTS.mbPerS * (NEURAL.pieceS + NEURAL.warmS + NEURAL.fadeS + NEURAL.tailS + 2 * NEURAL.shiftS);
  assert.equal(denoiserSlots(NEURAL, { cores: 8, availMb: 2900 }), Math.min(7, Math.floor(1450 / per)));
  assert.equal(denoiserSlots(NEURAL, { cores: 8, availMb: 64000 }), 7);
  assert.equal(denoiserSlots(NEURAL, { cores: 8, availMb: per * 2 * 3 + 1 }), 3);
  assert.equal(denoiserSlots(NEURAL, { cores: 8, availMb: 100 }), 1);
  assert.equal(denoiserSlots(NEURAL, { cores: 1, availMb: 64000 }), 1);
  assert.equal(denoiserSlots({ ...NEURAL, slots: 4 }, { cores: 1, availMb: 100 }), 4);
  // on this machine: within its cores
  assert.ok(denoiserSlots() >= 1 && denoiserSlots() <= Math.max(1, os.cpus().length - 1));
});

test("each failure falls back to ffmpeg's method for the whole recording and says so", { skip }, async () => {
  const m = await measure(noisy);
  const tune = { pieceS: 6, shiftS: 1, warmS: 0.5, fadeS: 0.4, tailS: 0.2 };
  const cases = [
    [{ STANDIN_FAIL: 3 }, /it exited with 3/],
    [{ STANDIN_FAIL: 3, STANDIN_FAIL_AFTER: 1, STANDIN_BY_PIECE: 1 }, /it exited with 3, on piece 2 of 5/],
    [{ STANDIN_NOTHING: 1 }, /it wrote nothing/],
    [{ STANDIN_LENGTH: -480 }, /samples long for/],
    [{ STANDIN_SILENCE: 1 }, /silent/],
    [{ STANDIN_NAN: 1 }, /not finite/],
    [{ STANDIN_GAIN_DB: 12 }, /clipped/],
    [{ STANDIN_JUNK: 1 }, /its output does not follow its input \(correlation −?-?0\.\d\d\)/],
    // (its time: a second here, where the program sleeps for three)
    [{ STANDIN_SLEEP: 3 }, /it took longer than 1 s/, { timeoutS: 1, timeoutPerS: 0 }],
  ];
  const x = reference("noisy.wav", m);
  for (const [sw, why, more] of cases) {
    fs.rmSync(file("count"), { force: true });
    const r = await withEnv({ ...STANDIN_ENV(), ...sw }, () => repair(noisy, file("failed.out.wav"), m, { tune: { ...tune, ...more } }));
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

test("clipped and noisy: the peaks are redrawn once, whatever reads the sound after (the probe, the denoiser, ffmpeg's method after it failed)", { skip }, async () => {
  // the noisy voice and a quiet-noised one (the probe's case), 9 dB up and clipped where 3 % lie over
  const clipOf = (src, name) => {
    run(["-i", src, "-af", "volume=9dB", "-c:a", "pcm_f32le", file(`${name}.loud.wav`)]);
    const loud = samples(file(`${name}.loud.wav`));
    const c = Float64Array.from(loud, Math.abs).sort()[Math.floor(loud.length * 0.97)];
    run(["-i", src, "-af", `volume=9dB,aeval='max(-${c},min(${c},val(0)))'`, "-c:a", "pcm_s16le", file(name)]);
    return file(name);
  };
  // every ffmpeg the stage starts, written down by a stand-in in front of the real one
  const real = spawnSync("sh", ["-c", "command -v ffmpeg"], { encoding: "utf8" }).stdout.trim();
  const bin = file("ff-bin"), fflog = file("ff.log");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "ffmpeg"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${fflog}'\nexec '${real}' "$@"\n`, { mode: 0o755 });
  const cases = [[noisy, "noisy-clipped.wav", {}, "dpdfnet"], [file("quiet-noise.wav"), "quiet-clipped.wav", {}, null], [noisy, "noisy-clipped.wav", { STANDIN_FAIL: 3 }, "afftdn-sample"]];
  for (const [src, name, sw, method] of cases) {
    const f = fs.existsSync(file(name)) ? file(name) : clipOf(src, name), m = await measure(f);
    assert.ok(m.findings.some((x) => x.id === "clipped"), name);
    fs.rmSync(fflog, { force: true });
    const r = await withEnv({ ...STANDIN_ENV(), ...sw, PATH: `${bin}${path.delimiter}${process.env.PATH}` }, () => repair(f, file(`${name}.out.wav`), m, { cores: 3 }));
    if (method) assert.equal(r.method, method, name);
    else assert.ok(r.probe, `${name}: the probe ran`);
    const st = r.steps.find((s) => s.id === "declip");
    assert.equal(st.windowMs, 55);
    // adeclip in three pieces and nowhere else; the pieces cover the sound once, with a window
    // more on either side
    const lines = fs.readFileSync(fflog, "utf8").trim().split("\n").filter((l) => l.includes("adeclip"));
    assert.equal(lines.length, 3, `${name}: ${lines.length} runs of adeclip`);
    const N = samples(f).length;
    let covered = 0;
    for (const l of lines) { const [, a, b] = l.match(/atrim=start_sample=(\d+):end_sample=(\d+)/); covered += b - a; }
    assert.ok(covered >= N && covered <= N + 4 * 2640, `${name}: ${covered} samples redrawn for ${N}`);
    assert.equal(samples(file(`${name}.out.wav`)).length, N, name);
  }
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
  assert.equal(a.steps.find((s) => s.id === "denoise").denoiser, "absent");
  assert.deepEqual(unsaid(a), b);
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

// ---------------------------------------------------------------- the probe

test("no noise in the pauses: the probe, unlimited, on the mended sound; quiet where nothing was taken out", { skip }, async () => {
  const m = await measure(file("quiet-noise.wav"));
  assert.ok(!m.findings.some((f) => f.id === "noise"), "measure names no noise");
  const log = file("probe.log"), work = file("work-a");
  fs.mkdirSync(work, { recursive: true });
  const r = await withEnv({ ...STANDIN_ENV(), STANDIN_LOG: log }, () => repair(file("quiet-noise.wav"), path.join(work, "out.wav"), m, { tmp: work }));
  assert.equal(r.method, "off");
  assert.deepEqual(ids(r.steps), ["highpass"]);
  assert.equal(r.probe.fires, false);
  // (the stand-in took nothing out but its 16-bit rounding)
  assert.ok(r.probe.underDb > 60, `${r.probe.underDb}`);
  assert.equal(r.probe.threshold, PROBE_FIRES_DB);
  const calls = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]["speech-denoiser-dpdfnet-attenuation-limit-db"], "0", "the probe runs without a limit");
  // nothing of it left in the working folder, nothing in the system's temp directory
  assert.deepEqual(fs.readdirSync(work), ["out.wav"]);
  // the output is what the plan without a probe gives, to the sample
  const plain = await withEnv(NONE_ENV(), () => repair(file("quiet-noise.wav"), file("plain-q.out.wav"), m));
  assert.ok(fs.readFileSync(path.join(work, "out.wav")).equals(fs.readFileSync(file("plain-q.out.wav"))));
  assert.equal(plain.probe, undefined);
  // asked for ffmpeg's method, or --denoise off: no probe
  for (const o of [{ method: "ffmpeg" }, { denoise: "off" }]) {
    fs.rmSync(log, { force: true });
    const x = await withEnv({ ...STANDIN_ENV(), STANDIN_LOG: log }, () => repair(file("quiet-noise.wav"), file("np.out.wav"), m, o));
    assert.equal(x.probe, undefined, JSON.stringify(o));
    assert.ok(!fs.existsSync(log), JSON.stringify(o));
  }
});

test("the probe leaves a knock measure set aside out of its estimate, as the check does: a clean clip with one knock does not fire", { skip }, async () => {
  // a knock (30 ms of noise at 0.9) at 5 s of a quietly noised voice; a stand-in that takes most of
  // it off (10 dB from 4.98 to 5.05 s; what stays is still loud) and leaves the rest
  run(["-i", file("quiet-noise.wav"), "-filter_complex", "anoisesrc=color=white:amplitude=0.9:r=48000:d=28.8:seed=11,volume='between(t,5,5.03)':eval=frame[k];[0:a][k]amix=inputs=2:normalize=0[o]", "-map", "[o]", "-c:a", "pcm_f32le", file("knock.wav")]);
  const m = await measure(file("knock.wav"));
  const low = { STANDIN_LOW_DB: -10, STANDIN_LOW_FROM: 4.98, STANDIN_LOW_TO: 5.05 };
  // (the knock as measure sets it aside: made up here, so that the test is of the probe alone)
  const withKnock = { ...m, speech: { ...m.speech, bursts: { count: 1, at: [{ t: 5, seconds: 0.03 }] } } };
  const without = { ...m, speech: { ...m.speech, bursts: { count: 0, at: [] } } };
  const set = await withEnv({ ...STANDIN_ENV(), ...low }, () => probeNoise(file("knock.wav"), withKnock, {}, file("probe-work")));
  // (the rule for few events off here, so that the burst alone is tested)
  const kept = await withEnv({ ...STANDIN_ENV(), ...low }, () => probeNoise(file("knock.wav"), without, { probeEvents: { max: 0 } }, file("probe-work")));
  // counted, the knock taken off reads as noise under the voice; left out, the clip reads clean
  assert.ok(kept.underDb < PROBE_FIRES_DB, `with the knock counted: ${kept.underDb} dB`);
  assert.ok(set.underDb > 40 && !set.fires, `with the knock left out: ${set.underDb} dB, fires ${set.fires}`);
  // a knock measure did not set aside: one event in 28 s, few, left out as well
  const own = await withEnv({ ...STANDIN_ENV(), ...low }, () => probeNoise(file("knock.wav"), without, {}, file("probe-work")));
  assert.deepEqual(own.events, { count: 1, leftOut: true });
  assert.ok(own.underDb > 40 && !own.fires, `the knock as one event: ${own.underDb} dB`);
  // many events (the stand-in takes 10 dB off everything from 2 to 20 s: every syllable there): a
  // noise of many events, nothing left out, the estimate as without the rule
  const wide = { STANDIN_LOW_DB: -10, STANDIN_LOW_FROM: 2, STANDIN_LOW_TO: 20 };
  const many = await withEnv({ ...STANDIN_ENV(), ...wide }, () => probeNoise(file("knock.wav"), without, {}, file("probe-work")));
  const off = await withEnv({ ...STANDIN_ENV(), ...wide }, () => probeNoise(file("knock.wav"), without, { probeEvents: { max: 0 } }, file("probe-work")));
  assert.ok(many.events.count > 10 && !many.events.leftOut, JSON.stringify(many.events));
  assert.equal(many.underDb, off.underDb);
});

test("the probe's estimate is the same however many slots the machine has: its windows cut the same, only run at once or not", { skip }, async () => {
  // (pieces of at least 10 s here, so that 28.8 s is cut in two)
  const m = await measure(file("quiet-noise.wav"));
  const est = async (slots) => (await withEnv({ ...STANDIN_ENV(), STANDIN_STEP_DB: -0.5 }, () => probeNoise(file("quiet-noise.wav"), m, { tune: { minPieceS: 10, slots } }, file("probe-work")))).underDb;
  const one = await est(1), two = await est(2), four = await est(4);
  assert.equal(one, two);
  assert.equal(one, four);
});

test("the probe fires where the denoiser took much out: the whole recording denoised, the step says it was found under the voice", { skip }, async () => {
  const m = await measure(file("quiet-noise.wav"));
  const tones = [];
  // (a stand-in that lowers everything by 1 dB took out 0.109 of the amplitude and kept 0.891:
  // 18.3 dB under the voice, and the voice 1 dB down)
  const r = await withEnv({ ...STANDIN_ENV(), STANDIN_GAIN_DB: LOWER_DB }, () =>
    repair(file("quiet-noise.wav"), file("fired.out.wav"), m, { after: "", retone: (d) => { tones.push(d); return d ? "volume=0dB" : ""; } }));
  assert.equal(r.method, "dpdfnet");
  assert.equal(r.probe.fires, true);
  near(r.probe.underDb, 18.3, 0.2, "the estimate");
  const st = r.steps.find((s) => s.id === "denoise");
  assert.equal(st.underVoiceDb, r.probe.underDb);
  assert.equal(st.limitDb, DPDFNET_LIMITS.auto);
  assert.match(st.why, /^Noise under the voice, which the pauses do not show, found by what the neural denoiser took out of \d+ s of it: about 18 dB under the speech; DPDFNet-2 asked to take at most 18 dB off/);
  assert.equal(st.why.split(/\. /).length, 1);
  // the tone stage was asked again, with the step that ran
  assert.equal(tones.at(-1)?.method, "dpdfnet");
  assert.equal(samples(file("fired.out.wav")).length, samples(file("quiet-noise.wav")).length);
  // the denoiser failing after the probe fired: nothing ffmpeg can do, said so, the tone told
  tones.length = 0;
  const f = await withEnv({ ...STANDIN_ENV(), STANDIN_GAIN_DB: LOWER_DB, STANDIN_FAIL: 4, STANDIN_FAIL_AFTER: 1, STANDIN_COUNT: file("count-p") }, () =>
    repair(file("quiet-noise.wav"), file("fired-failed.out.wav"), m, { after: "", retone: (d) => { tones.push(d); return ""; } }));
  fs.rmSync(file("count-p"), { force: true });
  const fs1 = f.steps.find((s) => s.id === "denoise");
  assert.equal(f.method, "off");
  assert.match(fs1.why, /^Noise lies under the voice, about 18 dB under the speech as the neural denoiser's probe found it, but the denoiser then failed \(it exited with 4\)/);
  assert.equal(tones.at(-1), null, "the tone stage told that no noise was taken out");
});

test("after a fallback the tone stage hears what ffmpeg's method did, not what the denoiser would have", { skip }, async () => {
  const m = await measure(noisy);
  const tones = [];
  const r = await withEnv({ ...STANDIN_ENV(), STANDIN_FAIL: 1 }, () => repair(noisy, file("ft.out.wav"), m, { after: "", retone: (d) => { tones.push(d); return ""; } }));
  assert.equal(r.method, "afftdn-sample");
  assert.equal(tones[0].method, "dpdfnet");
  assert.equal(tones.at(-1).method, "afftdn-sample");
  assert.equal(tones.at(-1).reduceDb, 12);
});

// ---------------------------------------------------------------- what it did to the voice

// the longest run of exact zeros in x from a on
function zeroRun(x, a = 0) { let run = 0, best = 0; for (let i = a; i < x.length; i++) { if (x[i] === 0) { run++; if (run > best) best = run; } else run = 0; } return best; }
const callsOf = (log) => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").length : 0);

test("voiceKept: the share of speech frames down, and their level, each a bound of its own", () => {
  // 20 frames of voice (10 at a level, 10 of them 10 dB under it) and 10 of pause 40 dB under
  // that, so that the pauses set the floor and the voice is all speech frames
  const F = 4800, E = (db) => F * 10 ** (db / 10);
  const inE = Float64Array.from([...Array(10).fill(E(-20)), ...Array(10).fill(E(-30)), ...Array(10).fill(E(-70))]);
  const out = (f) => Float64Array.from(inE, (e, i) => e * 10 ** (f(i) / 10));
  const t = { ...VOICE_KEPT, minFrames: 5 };
  // nothing down: kept
  assert.equal(voiceKept(inE, out(() => -0.5), t).down, false);
  // 12 of the 20 a little more than 6 dB down: the share alone is over its bound, the level not
  const a = voiceKept(inE, out((i) => (i >= 4 && i < 16 ? -6.5 : 0)), t);
  assert.ok(a.numbers.downShare > t.shareMax && a.numbers.levelDb >= -t.levelMaxDb, JSON.stringify(a.numbers));
  assert.equal(a.down, true);
  // 8 of the 10 loud ones 30 dB down: the level alone is over its bound, the share not
  const b = voiceKept(inE, out((i) => (i < 8 ? -30 : 0)), t);
  assert.ok(b.numbers.downShare <= t.shareMax && b.numbers.levelDb < -t.levelMaxDb, JSON.stringify(b.numbers));
  assert.equal(b.down, true);
  assert.match(b.said, /^40 % of its speech frames more than 6 dB down, their level −\d\.\d dB$/);
});

test("the probe declines where the denoiser takes the voice itself for noise: nothing denoised, its result says why", { skip }, async () => {
  const m = await measure(file("quiet-noise.wav"));
  const log = file("decline.log");
  fs.rmSync(log, { force: true });
  // (10 dB off everything: an estimate of −6.7 dB, which the threshold alone took for noise)
  const r = await withEnv({ ...STANDIN_ENV(), STANDIN_GAIN_DB: -10, STANDIN_LOG: log }, () => repair(file("quiet-noise.wav"), file("declined.out.wav"), m));
  assert.equal(r.method, "off");
  assert.deepEqual(ids(r.steps), ["highpass"]);
  assert.equal(r.probe.fires, false);
  assert.equal(r.probe.declined, "voice");
  near(r.probe.underDb, -6.7, 0.2, "the estimate");
  assert.ok(r.probe.underDb <= PROBE_FIRES_DB);
  assert.equal(r.probe.voice.downShare, 1);
  near(r.probe.voice.levelDb, -10, 0.1, "the speech frames' level");
  assert.match(r.probe.why, /^The neural denoiser took the voice itself down in its sample \(100 % of its speech frames more than 6 dB down, their level −10\.0 dB\), so what it took out is no noise under the voice: nothing denoised\.$/);
  // the denoiser ran once, on the sample, never on the whole recording
  assert.equal(callsOf(log), 1);
  const plain = await withEnv(NONE_ENV(), () => repair(file("quiet-noise.wav"), file("declined-plain.out.wav"), m));
  assert.ok(fs.readFileSync(file("declined.out.wav")).equals(fs.readFileSync(file("declined-plain.out.wav"))));
  assert.equal(plain.method, "off");
  // what came out nearly as loud as what was kept, the speech frames' level kept: declined too
  const a = await withEnv({ ...STANDIN_ENV(), STANDIN_ADD_DB: -3 }, () => repair(file("quiet-noise.wav"), file("declined2.out.wav"), m));
  assert.equal(a.method, "off");
  assert.equal(a.probe.declined, "voice");
  assert.ok(a.probe.underDb < PROBE_MIN_DB && a.probe.underDb > 0, JSON.stringify(a.probe));
  assert.ok(a.probe.voice.downShare <= PROBE_KEPT.shareMax && a.probe.voice.levelDb >= -PROBE_KEPT.levelMaxDb, JSON.stringify(a.probe.voice));
  assert.match(a.probe.why, /^What the neural denoiser took out of its sample is nearly as loud as what it kept \(about \d dB under it\): that is the voice taken for noise, not noise under it, so nothing is denoised\.$/);
});

test("after the run: a voice taken down is thrown away as any failure is; ffmpeg's method where measure named noise, said in the step and in left", { skip }, async () => {
  const m = await measure(noisy);
  const r = await withEnv({ ...STANDIN_ENV(), STANDIN_GAIN_DB: -20 }, () => repair(noisy, file("down.out.wav"), m));
  const st = r.steps.find((s) => s.id === "denoise");
  assert.equal(r.method, "afftdn-sample");
  assert.match(st.why, /; the neural denoiser took the voice itself down \(100 % of its speech frames more than 6 dB down, their level −20\.0 dB\) and its result was thrown away, so ffmpeg's afftdn-sample did this for the whole recording\.$/);
  assert.equal(st.why.split(/\. /).length, 1, st.why);
  assert.equal(st.fallback.voice.downShare, 1);
  const l = r.left.filter((x) => /took this voice for noise/.test(x.why));
  assert.equal(l.length, 1);
  assert.match(l[0].why, /^The neural denoiser took this voice for noise \(100 % of its speech frames more than 6 dB down, their level −20\.0 dB\), so its result was thrown away; ffmpeg's afftdn-sample took off what it could\.$/);
  // what ffmpeg's method gives without the denoiser, to the sample
  await withEnv(NONE_ENV(), () => repair(noisy, file("down-plain.out.wav"), m));
  assert.ok(fs.readFileSync(file("down.out.wav")).equals(fs.readFileSync(file("down-plain.out.wav"))));
  // a voice the denoiser leaves (1 dB off everything): used, its numbers in the step
  const ok = await withEnv({ ...STANDIN_ENV(), STANDIN_GAIN_DB: LOWER_DB }, () => repair(noisy, file("kept.out.wav"), m));
  const sk = ok.steps.find((s) => s.id === "denoise");
  assert.equal(ok.method, "dpdfnet");
  assert.equal(sk.voice.downShare, 0);
  near(sk.voice.levelDb, LOWER_DB, 0.1, "the speech frames' level");
});

test("after the run: one stretch of the voice taken down is caught where the whole is not", { skip }, async () => {
  const m = await measure(noisy);
  const tune = { pieceS: 6, shiftS: 1, warmS: 0.5, fadeS: 0.4, tailS: 0.2 };
  const count = file("count-low");
  fs.rmSync(count, { force: true });
  // the third of five pieces: 3 s of its own sound 20 dB down (a tenth of the recording), the
  // stretches 3 s long (as 30 s are to a long recording)
  const sw = { STANDIN_LOW_DB: -20, STANDIN_LOW_CALL: 3, STANDIN_LOW_FROM: 1, STANDIN_LOW_TO: 4, STANDIN_BY_PIECE: 1 };
  const voiceKept = { windowS: 3, hopS: 0.5, minFrames: 8 };
  const r = await withEnv({ ...STANDIN_ENV(), ...sw }, () => repair(noisy, file("stretch.out.wav"), m, { tune, voiceKept }));
  const st = r.steps.find((s) => s.id === "denoise");
  assert.equal(r.method, "afftdn-sample");
  assert.match(st.fallback.reason, /^it took the voice itself down \(\d+ % of its speech frames more than 6 dB down, their level −?\d+\.\d dB from 0:\d\d to 0:\d\d\)$/, JSON.stringify(st.fallback.voice));
  // the whole alone was within the bounds
  const v = st.fallback.voice;
  assert.ok(v.downShare <= VOICE_KEPT.shareMax && v.levelDb >= -VOICE_KEPT.levelMaxDb, JSON.stringify(v));
  assert.ok(v.worst.downShare > VOICE_KEPT.shareMax || v.worst.levelDb < -VOICE_KEPT.levelMaxDb, JSON.stringify(v));
  assert.ok(v.worst.from >= 6 && v.worst.to <= 24, JSON.stringify(v.worst));
});

test("a clap measure set aside is no speech frame: the denoiser that takes it down is kept", { skip }, async () => {
  // a quiet voice (its noise named) and 30 ms of white noise at 0.9 in a pause at 13.5 s; the
  // stand-in takes the clap 30 dB down and leaves the rest
  run(["-i", noisy, "-filter_complex", `[0:a]volume=-20dB[v];anoisesrc=color=white:amplitude=0.9:r=48000:d=0.03:seed=3,adelay=13500,apad[b];[v][b]amix=inputs=2:normalize=0:duration=first`, "-c:a", "pcm_f32le", file("clap.wav")]);
  const m0 = await measure(file("clap.wav"));
  assert.ok(m0.findings.some((f) => f.id === "noise"), "noise named");
  // (measure's bursts, as it lists them: made up here, so that the test does not hang on its rule)
  const clap = { ...m0, speech: { ...m0.speech, bursts: { count: 1, seconds: 0.03, overDb: 40, at: [{ t: 13.5, seconds: 0.03, overDb: 40 }] } } };
  const none = { ...m0, speech: { ...m0.speech, bursts: { count: 0, seconds: 0, overDb: null, at: [] } } };
  const sw = { STANDIN_LOW_DB: -30, STANDIN_LOW_FROM: 13.45, STANDIN_LOW_TO: 13.65 };
  const r = await withEnv({ ...STANDIN_ENV(), ...sw }, () => repair(file("clap.wav"), file("clap.out.wav"), clap));
  assert.equal(r.method, "dpdfnet", JSON.stringify(r.steps.find((s) => s.id === "denoise")));
  assert.doesNotMatch(r.left.map((l) => l.why).join(" "), /took this voice for noise/);
  // without the burst in the measurement the clap is a speech frame, and sets their level
  const t = await withEnv({ ...STANDIN_ENV(), ...sw }, () => repair(file("clap.wav"), file("clap2.out.wav"), none));
  assert.equal(t.method, "afftdn-sample");
  assert.match(t.steps.find((s) => s.id === "denoise").fallback.reason, /took the voice itself down/);
});

test("the probe fired, the run then took the voice down: no noise step, said in the step and in left", { skip }, async () => {
  const m = await measure(file("quiet-noise.wav"));
  const count = file("count-pd");
  fs.rmSync(count, { force: true });
  // (the probe's call lowers everything by 1 dB; the real run's, the second, by 20)
  const r = await withEnv({ ...STANDIN_ENV(), STANDIN_GAIN_DB: LOWER_DB, STANDIN_LOW_DB: -19, STANDIN_LOW_CALL: 2, STANDIN_COUNT: count }, () => repair(file("quiet-noise.wav"), file("pd.out.wav"), m));
  const st = r.steps.find((s) => s.id === "denoise");
  assert.equal(r.probe.fires, true);
  assert.equal(r.method, "off");
  assert.match(st.why, /^Noise lies under the voice, about 18 dB under the speech as the neural denoiser's probe found it, but on the whole recording the denoiser took the voice itself down \(100 % of its speech frames more than 6 dB down, their level −20\.0 dB\) and its result was thrown away, and ffmpeg's methods learn a noise from the pauses, where there is too little of it: it stays\.$/);
  assert.ok(r.left.some((l) => /^The neural denoiser took this voice for noise \(.*\), so its result was thrown away and any noise under the voice stays\.$/.test(l.why)), JSON.stringify(r.left));
  const plain = await withEnv(NONE_ENV(), () => repair(file("quiet-noise.wav"), file("pd-plain.out.wav"), m));
  assert.ok(fs.readFileSync(file("pd.out.wav")).equals(fs.readFileSync(file("pd-plain.out.wav"))));
  assert.equal(plain.method, "off");
});

// ---------------------------------------------------------------- a strength named

test("--denoise gentle or strong where nothing found noise: the noise step runs at that strength, and says it was asked for", { skip }, async () => {
  const m = await measure(file("quiet-noise.wav"));
  assert.ok(!m.findings.some((f) => f.id === "noise"), "measure names no noise");
  for (const strength of ["gentle", "strong"]) {
    const log = file(`asked-${strength}.log`);
    fs.rmSync(log, { force: true });
    const r = await withEnv({ ...STANDIN_ENV(), STANDIN_LOG: log }, () => repair(file("quiet-noise.wav"), file(`asked-${strength}.out.wav`), m, { denoise: strength }));
    const st = r.steps.find((s) => s.id === "denoise");
    assert.equal(r.method, "dpdfnet", strength);
    assert.equal(st.asked, true);
    assert.equal(st.limitDb, DPDFNET_LIMITS[strength]);
    assert.match(st.why, new RegExp(`^Asked for with --denoise ${strength}, although measure found no noise in the pauses \\(they lie \\d+ dB under the speech\\): a neural denoiser \\(DPDFNet-2\\) asked to take at most ${DPDFNET_LIMITS[strength]} dB off\\.$`));
    // no probe: one call, the run itself, at that limit
    assert.equal(r.probe, undefined);
    const calls = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]["speech-denoiser-dpdfnet-attenuation-limit-db"], String(DPDFNET_LIMITS[strength]));
    // without the denoiser: ffmpeg's method from the pause, at that strength's cap
    const f = await withEnv(NONE_ENV(), () => repair(file("quiet-noise.wav"), file(`asked-${strength}-ff.out.wav`), m, { denoise: strength }));
    const sf = f.steps.find((s) => s.id === "denoise");
    assert.equal(f.method, "afftdn-sample", strength);
    assert.equal(sf.asked, true);
    assert.equal(sf.reduceDb, DENOISE_CAPS["afftdn-sample"][strength]);
    assert.match(sf.why, new RegExp(`^Asked for with --denoise ${strength}, although measure found no noise in the pauses \\(they lie \\d+ dB under the speech\\): ${DENOISE_CAPS["afftdn-sample"][strength]} dB less, its profile from the pause at 0:\\d\\d \\(\\d\\.\\d s\\); no neural denoiser on this machine: ffmpeg's method\\.$`));
    assert.equal(sf.denoiser, "absent");
    assert.equal(samples(file(`asked-${strength}-ff.out.wav`)).length, samples(file("quiet-noise.wav")).length);
  }
  // auto and off as they were: nothing where nothing was found
  for (const strength of ["auto", "off"]) {
    const r = await withEnv(NONE_ENV(), () => repair(file("quiet-noise.wav"), file("asked-auto.out.wav"), m, { denoise: strength }));
    assert.equal(r.method, "off", strength);
    assert.deepEqual(ids(r.steps), ["highpass"], strength);
  }
  // the voice taken down: ffmpeg's method in its place, still asked for
  const d = await withEnv({ ...STANDIN_ENV(), STANDIN_GAIN_DB: -20 }, () => repair(file("quiet-noise.wav"), file("asked-down.out.wav"), m, { denoise: "strong" }));
  const sd = d.steps.find((s) => s.id === "denoise");
  assert.equal(d.method, "afftdn-sample");
  assert.equal(sd.asked, true);
  assert.equal(sd.fallback.voice.downShare, 1);
  assert.ok(d.left.some((l) => /took this voice for noise/.test(l.why)));
});

test("--denoise strong where measure named noise: its cap whatever the aim needs, so never auto's file; gentle never more than auto", async () => {
  // noise 33 dB under the speech: the 45 dB aim needs 12
  const m = made({ levels: { speechLufs: -20, noiseLufs: -53, snrDb: 33, snrADb: 33 } });
  for (const [env, auto, gentle, strong] of [[STANDIN_ENV(), 12, 12, DPDFNET_LIMITS.strong], [NONE_ENV(), 12, 6, DENOISE_CAPS["afftdn-sample"].strong]]) {
    await withEnv(env, () => {
      const st = (s) => repairPlan(m, { denoise: s }).steps.find((x) => x.id === "denoise");
      assert.equal(st("auto").reduceDb, auto);
      assert.equal(st("auto").pastAim, undefined);
      assert.equal(st("gentle").reduceDb, gentle);
      assert.equal(st("gentle").pastAim, undefined);
      const s = st("strong");
      assert.equal(s.reduceDb, strong);
      assert.equal(s.pastAim, true);
      assert.match(s.why, new RegExp(`${strong} dB.*, more than the 12 dB the 45 dB aim needs, as --denoise strong asks`));
      assert.equal(s.why.split(/\. /).length, 1, s.why);
      // where the aim needs more than strong's cap: the cap, said as before
      const far = repairPlan(made({ levels: { speechLufs: -20, snrDb: 10, snrADb: 10 } }), { denoise: "strong" }).steps.find((x) => x.id === "denoise");
      assert.equal(far.pastAim, undefined);
      assert.match(far.why, /the most --denoise strong allows|as much as afftdn-sample takes without artefacts/);
    });
  }
});

test("--denoise strong with nothing to work from: left says why", async () => {
  // no noise named, no pause, no denoiser
  const plan = await withEnv(NONE_ENV(), () => repairPlan(made({ findings: [], speech: { share: 0.9, longest: [] } }), { denoise: "strong" }));
  assert.equal(plan.method, "off");
  assert.deepEqual(ids(plan.steps), ["highpass"]);
  assert.deepEqual(plan.left, [{ id: "noise", why: "--denoise strong was asked for, but measure found no noise in the pauses and no pause of 0.4 s to learn one from, and ffmpeg's methods need one: nothing denoised." }]);
  // with the denoiser it needs none
  const p = await withEnv(STANDIN_ENV(), () => repairPlan(made({ findings: [], speech: { share: 0.9, longest: [] } }), { denoise: "strong" }));
  assert.equal(p.method, "dpdfnet");
  assert.equal(p.steps.find((s) => s.id === "denoise").asked, true);
});

// ---------------------------------------------------------------- the level for its 16 bits

test("a very quiet voice with one loud bump: the level follows the voice, the bump is held, no run of zeros", { skip }, async () => {
  // the voice 60 dB down (its noise near −94 dBFS), and 30 ms of a burst at 0.9 at 0.3 s
  run(["-i", noisy, "-filter_complex", `[0:a]volume=-60dB[v];aevalsrc=exprs='0.9*exp(-t/0.008)*sin(2*PI*300*t)':s=48000:d=0.03,adelay=300,apad[b];[v][b]amix=inputs=2:normalize=0:duration=first`, "-c:a", "pcm_f32le", file("bump.wav")]);
  // (measure, its speech level taken from the bump, names no noise here: the plan is told it lies
  // under the voice, as the probe would)
  const m = await measure(file("bump.wav"));
  const r = await withEnv(STANDIN_ENV(), () => repair(file("bump.wav"), file("bump.out.wav"), m, { underVoice: { fires: true, underDb: 22, sampleS: 10 } }));
  const st = r.steps.find((s) => s.id === "denoise");
  assert.equal(r.method, "dpdfnet");
  // the voice brought to about −26 dBFS (60 dB more than the peak would have allowed), the gain
  // held round the bump only
  assert.ok(st.gainDb > 45, JSON.stringify(st));
  assert.ok(st.heldDb < -20, JSON.stringify(st));
  const x = reference("bump.wav", m), y = samples(file("bump.out.wav"));
  assert.equal(y.length, x.length);
  const a = 48000;
  const e = errorDb(x, y, 1, a);
  assert.ok(e < -60, `error ${e.toFixed(1)} dB`);
  assert.ok(zeroRun(y, a) <= Math.max(5, zeroRun(x, a)), `${zeroRun(y, a)} zeros in a row`);
  // the bump itself comes back as it went in, within half a step at the held gain
  assert.ok(maxDiff(x, y, 1, 14000, 16000) <= step(st), `${maxDiff(x, y, 1, 14000, 16000)}`);
});

test("levelFor: never more gain than a block's peak allows, the steady gain elsewhere", () => {
  // (frames of voice at −50.5 dBFS and pauses 40 dB under it, one block's peak at 0.9)
  const n = 400, peaks = new Float64Array(n).fill(0.01), energy = Float64Array.from({ length: Math.ceil((n * 480) / 4800) }, (_, i) => 4800 * (i % 2 ? 0.00003 : 0.003) ** 2);
  peaks[200] = 0.9;
  const L = levelFor(energy, peaks, { ...NEURAL, voiceDb: -26, peakDb: -6, holdS: 0.1 });
  near(L.gainDb, -26 - 20 * Math.log10(0.003), 0.01, "the steady gain");
  const G = 10 ** (L.gainDb / 20), ceil = 10 ** (-6 / 20);
  for (let i = 0; i < n * 480; i++) assert.ok(L.at(i) * peaks[Math.floor(i / 480)] <= ceil * (1 + 1e-9), `sample ${i}`);
  for (const i of [0, 60000, n * 480 - 1]) near(20 * Math.log10(L.at(i)), L.gainDb, 0.01, `the gain at ${i}`);
  near(L.heldDb, 20 * Math.log10(ceil / 0.9 / G), 0.1, "held");
});

// ---------------------------------------------------------------- the real one

test("the real denoiser, where the machine has it: it takes this made-up voice for noise, and both checks see it", { skip: skipReal }, async () => {
  // (DPDFNet-2 takes the synthetic voice down to its limit, 18 dB, on every frame: the run's check
  // throws that away for ffmpeg's method, and the probe declines where measure named no noise)
  const m = await measure(noisy);
  const r = await withEnv(REAL, () => repair(noisy, file("real.out.wav"), m));
  const st = r.steps.find((s) => s.id === "denoise");
  assert.equal(r.method, "afftdn-sample");
  assert.match(st.fallback.reason, /^it took the voice itself down \(100 % of its speech frames more than 6 dB down, their level −1\d\.\d dB\)$/);
  assert.ok(st.fallback.voice.levelDb <= -15, JSON.stringify(st.fallback.voice));
  await withEnv(NONE_ENV(), () => repair(noisy, file("real-plain.out.wav"), m));
  assert.ok(fs.readFileSync(file("real.out.wav")).equals(fs.readFileSync(file("real-plain.out.wav"))));
  const q = await measure(file("quiet-noise.wav"));
  const p = await withEnv(REAL, () => repair(file("quiet-noise.wav"), file("real-q.out.wav"), q));
  assert.equal(p.method, "off");
  assert.equal(p.probe.declined, "voice", JSON.stringify(p.probe));
  assert.equal(samples(file("real-q.out.wav")).length, samples(file("quiet-noise.wav")).length);
});

test("a signal to clean ends every running piece of the denoiser and leaves none of its files", { skip }, async () => {
  const out = file("sig/out.m4a"), pids = file("sig.pids");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // (86 s, three slots: three pieces at once)
  run(["-i", noisy, "-i", noisy, "-i", noisy, "-filter_complex", "concat=n=3:v=0:a=1", "-c:a", "pcm_f32le", file("long3.wav")]);
  const tool = path.join(path.dirname(fileURLToPath(import.meta.url)), "voice.mjs");
  const env = { ...process.env, VOICE_SOUND_DENOISER: standin, VOICE_SOUND_DPDFNET: model, VOICE_SOUND_SLOTS: 3, STANDIN_SLEEP: 60, STANDIN_PID: pids };
  delete env.VOICE_SOUND_DENOISE;
  const p = spawn(process.execPath, [tool, "clean", file("long3.wav"), out], { env, stdio: "ignore" });
  const t0 = Date.now();
  const started = () => (fs.existsSync(pids) ? fs.readFileSync(pids, "utf8").trim().split("\n").length : 0);
  while (started() < 3 && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 100));
  assert.equal(started(), 3, "three pieces run at once");
  await new Promise((r) => setTimeout(r, 300));
  const all = fs.readFileSync(pids, "utf8").trim().split("\n").map(Number), pid = all[0];
  // (its files lie in clean's working folder beside the output, in this attempt's own a-<pid>/)
  const work = fs.readdirSync(path.dirname(out)).filter((n) => n.startsWith(".voice-sound-clean-"));
  assert.equal(work.length, 1);
  const inWork = () => { const d = path.join(path.dirname(out), work[0]); return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() && /^a-\d+$/.test(e.name) ? [e.name, ...fs.readdirSync(path.join(d, e.name))] : [e.name])); };
  assert.ok(inWork().some((n) => n.startsWith(".voice-sound-neural-")), JSON.stringify(inWork()));
  const ended = new Promise((r) => p.on("exit", (code, sig) => r({ code, sig })));
  p.kill("SIGTERM");
  const e = await ended;
  assert.equal(e.code, 143);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(gone(pid), "the denoiser is gone");
  for (const q of all) assert.ok(gone(q), `piece ${q} is gone`);
  // (what was finished is kept for the same command to go on from, in the working folder alone;
  // none of the denoiser's files, nor the ended attempt's folder)
  assert.deepEqual(fs.readdirSync(path.dirname(out)).filter((n) => n !== work[0]), []);
  if (fs.existsSync(path.join(path.dirname(out), work[0])))
    assert.ok(!inWork().some((n) => n.startsWith(".voice-sound-neural-") || /^a-\d+$/.test(n)), JSON.stringify(inWork()));
});

// a process is gone where no signal reaches it, or (Linux) where it has ended and only waits to
// be reaped: a zombie, as an ended child stays in a container without an init process
function gone(pid) {
  try { process.kill(pid, 0); } catch { return true; }
  try { return /^\d+ \(.*\) [ZX]/s.test(fs.readFileSync(`/proc/${pid}/stat`, "utf8")); } catch { return false; }
}

test("gone: a zombie counts as gone, a running process does not", { skip: process.platform !== "linux" && "Linux only" }, async () => {
  // (sh starts a child that ends at once and becomes sleep, which never reaps it)
  const p = spawn("sh", ["-c", "sleep 0 & echo $!; exec sleep 3"], { stdio: ["ignore", "pipe", "ignore"] });
  const zpid = Number(await new Promise((r) => p.stdout.once("data", (d) => r(String(d).trim()))));
  await new Promise((r) => setTimeout(r, 500));
  assert.doesNotThrow(() => process.kill(zpid, 0), "a zombie still takes a signal");
  assert.equal(gone(zpid), true);
  assert.equal(gone(p.pid), false);
  p.kill("SIGKILL");
});
