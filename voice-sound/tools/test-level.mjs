// The level stage of `clean` (lib/level.mjs) on a voice made up with ffmpeg's lavfi, as tools/test.mjs
// makes it: a sawtooth whose pitch wanders around 120 Hz, shaped by three formants, switched on and
// off as syllables in phrases of 2.5 s with pauses of 1.1 s, a hiss of "s" now and then, a faint pink
// noise under all of it. No request, no key, no network.
//
//   node --test tools/test-level.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { level, levellerOf, framesOf, loudnessOf, TARGETS } from "./lib/level.mjs";

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const skip = !ffmpeg && "no ffmpeg";
const near = (x, y, by, what = "") => assert.ok(Math.abs(x - y) <= by, `${what} ${x} is not within ${by} of ${y}`);
const run = (args) => { const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); };

const D = 28.8, PERIOD = 3.6, SPOKEN = 2.5;
const VOICE = `aevalsrc=exprs='st(0,120*t+3.41*(1-cos(4.398*t))+6.92*(1-cos(1.445*t)));st(1,mod(t,3.6));` +
  `0.25*lt(ld(1),2.5)*pow(sin(12.566*ld(1)),2)*(0.6+0.4*sin(5.655*t))*2*(ld(0)-floor(ld(0)+0.5))':s=48000:d=${D},` +
  `equalizer=f=500:t=o:w=1:g=10,equalizer=f=1500:t=o:w=1:g=6,equalizer=f=2700:t=o:w=0.8:g=4,lowpass=f=5000[v];` +
  `anoisesrc=color=white:amplitude=0.03:r=48000:d=${D}:seed=3,highpass=f=4000,highpass=f=4000,volume='lt(mod(t,3.6),2.5)*lt(mod(t,0.75),0.09)':eval=frame[s];` +
  `anoisesrc=color=pink:amplitude=0.0015:r=48000:d=${D}:seed=5[n];[v][s][n]amix=inputs=3:normalize=0`;

let dir, base, step;
const file = (name) => path.join(dir, name);
// the intermediate as repair writes it: 48 kHz, one channel, float
const intermediate = (name, af) => { const out = file(name); run(["-i", base, "-af", af, "-c:a", "pcm_f32le", out]); return out; };
function samples(f, channel = null) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", f, ...(channel == null ? ["-ac", "1"] : ["-af", `pan=mono|c0=c${channel}`]), "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
}
function probe(f) {
  const r = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", f], { encoding: "utf8" });
  const j = JSON.parse(r.stdout);
  return { ...j.streams.find((s) => s.codec_type === "audio"), duration: Number(j.format.duration) };
}
// the level (dB of the mean square) of x where `keep(t)` says yes
function levelWhere(x, keep) {
  let s = 0, n = 0;
  for (let i = 0; i < x.length; i++) if (keep(i / 48000)) { s += x[i] * x[i]; n++; }
  return 10 * Math.log10(s / n);
}
const inPause = (t) => { const p = t % PERIOD; return p > SPOKEN + 0.25 && p < PERIOD - 0.15; };
const inSpeech = (t) => { const p = t % PERIOD; return p > 0.1 && p < SPOKEN - 0.1; };

before(() => {
  if (!ffmpeg) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-sound-level-"));
  base = file("voice.wav");
  run(["-filter_complex", VOICE, "-ac", "1", "-c:a", "pcm_f32le", base]);
  // the second half 10 dB under the first (a speaker turned away, two takes)
  step = intermediate("step.wav", "volume='if(gte(t,14.4),0.3162,1)':eval=frame");
});
after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

test("an even voice: no leveller; −14 LUFS within 0.5 LU and the true peak under the ceiling, as WAV and as AAC", { skip }, async () => {
  for (const [ext, encode] of [["wav", ["-c:a", "pcm_s24le"]], ["m4a", ["-c:a", "aac", "-b:a", "192k"]]]) {
    const out = file(`even.${ext}`);
    const r = await level(base, out, { encode });
    assert.ok(!r.steps.some((s) => s.id === "leveller"), r.steps.map((s) => s.id).join());
    assert.match(r.skipped.find((s) => s.id === "leveller").why, /no leveller needed/);
    assert.deepEqual(r.steps.map((s) => s.id), ["compressor", "loudness", "limiter"]);
    for (const s of r.steps) assert.ok(s.why.length > 20, s.id);
    const got = loudnessOf(out);
    near(got.lufs, TARGETS.lufs, 0.5, `${ext} loudness`);
    assert.ok(got.truePeak <= TARGETS.peakAccepted, `${ext} true peak ${got.truePeak}`);
    assert.deepEqual(r.delivered, got);
    const p = probe(out);
    assert.equal(p.channels, 2);
    assert.equal(Number(p.sample_rate), 48000);
    assert.equal(p.codec_name, ext === "wav" ? "pcm_s24le" : "aac");
    near(p.duration, D, ext === "wav" ? 0.002 : 0.03, `${ext} duration`);
    // the same voice in both channels (ffmpeg's AAC codes each with noise of its own: their
    // difference lies about 30 dB under the voice)
    const l = samples(out, 0), rr = samples(out, 1);
    if (ext === "wav") assert.ok(l.every((v, i) => v === rr[i]), "two channels, the same");
    else assert.ok(levelWhere(l.map((v, i) => v - rr[i]), () => true) < levelWhere(l, () => true) - 25, "two channels, the same");
    // the range a phone in a noisy place wants
    assert.ok(got.rangeLu <= TARGETS.rangeLu, `range ${got.rangeLu}`);
  }
});

test("a step of 10 dB between the halves: they come out within 2 LU, and the pauses' noise rises no more than the speech", { skip }, async () => {
  const out = file("step.out.wav");
  const r = await level(step, out, {});
  const lev = r.steps.find((s) => s.id === "leveller");
  assert.ok(lev, r.steps.map((s) => s.id).join());
  assert.ok(lev.spreadLu >= 6, `spread ${lev.spreadLu}`);
  assert.ok(lev.maxDb - lev.minDb <= 16 && lev.maxDb <= 8 && lev.minDb >= -8, `${lev.minDb} … ${lev.maxDb}`);
  const halves = [[0, 14.4], [14.4, D]].map(([a, b]) => {
    const h = file(`half-${a}.wav`);
    run(["-i", out, "-ss", String(a), "-t", String(b - a), "-c:a", "pcm_f32le", h]);
    return loudnessOf(h).lufs;
  });
  near(halves[0], halves[1], 2, "the halves");
  const got = loudnessOf(out);
  near(got.lufs, TARGETS.lufs, 0.5, "loudness");
  assert.ok(got.truePeak <= TARGETS.peakAccepted, `true peak ${got.truePeak}`);
  // per half (away from the change in the middle), how much the pauses rose against the speech. The
  // compressor turns the speech's peaks down for both halves alike (and the gain brings all of it
  // up again), so the noise rises more than the speech in both; the leveller's share is the
  // difference between the half it raised and the half it left
  const x = samples(step), y = samples(out);
  const rise = [[1, 12], [17, D - 0.5]].map(([a, b]) => {
    const at = (keep) => (t) => t >= a && t < b && keep(t);
    const speech = levelWhere(y, at(inSpeech)) - levelWhere(x, at(inSpeech));
    const noise = levelWhere(y, at(inPause)) - levelWhere(x, at(inPause));
    return { speech, noise };
  });
  const raised = rise[1].speech - rise[0].speech;
  assert.ok(raised > 6, `the quiet half raised by ${raised.toFixed(1)} dB against the loud one`);
  const more = (rise[1].noise - rise[1].speech) - (rise[0].noise - rise[0].speech);
  assert.ok(more <= 1, `in the raised half the noise rose ${more.toFixed(1)} dB more against the speech than in the other`);
});

test("level plain: the step of 10 dB stays, the loudness lands on the target, only gain and limiter", { skip }, async () => {
  const out = file("step.plain.wav");
  // (at −18 LUFS: the made-up voice's peaks lie 20 dB over its loudness, and at −14 the limiter
  // takes 5 dB off the loud half and so part of the step: the case of the "peaks" sentence below)
  const r = await level(step, out, { level: "plain", targets: { lufs: -18 } });
  assert.equal(r.mode, "plain");
  assert.deepEqual(r.steps.map((s) => s.id), ["loudness", "limiter"]);
  assert.match(r.skipped.find((s) => s.id === "leveller").why, /plain/);
  const got = loudnessOf(out);
  near(got.lufs, -18, 0.5, "loudness");
  assert.ok(got.truePeak <= TARGETS.peakAccepted, `true peak ${got.truePeak}`);
  const halves = [[0, 14.4], [14.4, D]].map(([a, b]) => {
    const h = file(`plain-${a}.wav`);
    run(["-i", out, "-ss", String(a), "-t", String(b - a), "-c:a", "pcm_f32le", h]);
    return loudnessOf(h).lufs;
  });
  near(halves[0] - halves[1], 10, 1.5, "the step kept");
  // a target far too loud for its dynamics: the limiter takes much off the peaks, and says so
  const loud = await level(step, file("step.plain-loud.wav"), { level: "plain", targets: { lufs: -6 } });
  assert.ok(loud.steps.at(-1).peaksTakenDb > 6, `${loud.steps.at(-1).peaksTakenDb}`);
  assert.match(loud.left.find((s) => s.id === "peaks").why, /too loud for this recording's own dynamics/);
});

test("the leveller's curve never rises in a pause over the speech on either side, and moves no faster than 3 dB a second", { skip }, async () => {
  const fr = await framesOf(step);
  const L = levellerOf(fr.momentary, { lu: fr.rangeLu, aimLu: 5 });
  assert.ok(L.needed);
  const g = L.gains, sp = L.speech;
  for (let i = 1; i < g.length; i++) assert.ok(Math.abs(g[i] - g[i - 1]) <= 0.3 + 1e-6, `frame ${i}: ${g[i - 1]} → ${g[i]}`);
  for (let i = 0; i < g.length;) {
    if (sp[i]) { i++; continue; }
    let e = i; while (e < g.length && !sp[e]) e++;
    const sides = [i > 0 ? g[i - 1] : -Infinity, e < g.length ? g[e] : -Infinity];
    const most = Math.max(...sides.filter(Number.isFinite));
    if (Number.isFinite(most)) for (let k = i; k < e; k++) assert.ok(g[k] <= most + 0.05, `pause ${i}–${e}: ${g[k]} over ${most}`);
    i = e;
  }
  // an even voice: a flat curve
  const even = levellerOf((await framesOf(base)).momentary, { lu: 2, aimLu: 5 });
  assert.equal(even.needed, false);
  assert.ok(even.gains.every((v) => v === 0));
});

test("one channel against two: each at −14 LUFS as ffmpeg measures it, so the mono channel is 3 LU louder", { skip }, async () => {
  const quiet = intermediate("quiet.wav", "volume=-18dB");
  const two = file("two.wav"), one = file("one.wav");
  await level(quiet, two, {});
  const r = await level(quiet, one, { mono: true });
  assert.equal(probe(one).channels, 1);
  assert.equal(probe(two).channels, 2);
  near(loudnessOf(one).lufs, -14, 0.5, "mono");
  near(loudnessOf(two).lufs, -14, 0.5, "two channels");
  const left = file("left.wav");
  run(["-i", two, "-af", "pan=mono|c0=c0", "-c:a", "pcm_f32le", left]);
  near(loudnessOf(one).lufs - loudnessOf(left).lufs, 3, 0.5, "one channel against one of two");
  assert.match(r.steps.find((s) => s.id === "loudness").why, /plays 3 LU louder on two speakers/);
  assert.ok(loudnessOf(one).truePeak <= -1);
});

test("in step and as long: the limiter's look-ahead is taken back; --level off keeps the loudness and only makes the peaks safe", { skip }, async () => {
  // too loud: peaks over full scale
  const hot = intermediate("hot.wav", "volume=4dB");
  const out = file("hot.out.wav");
  const r = await level(hot, out, { level: "off" });
  assert.deepEqual(r.steps.map((s) => s.id), ["limiter"]);
  assert.match(r.skipped.find((s) => s.id === "level").why, /own dynamics and loudness are kept/);
  const was = loudnessOf(hot), got = loudnessOf(out);
  assert.ok(was.truePeak > 0, `${was.truePeak}`);
  assert.ok(got.truePeak <= TARGETS.peakAccepted, `true peak ${got.truePeak}`);
  // as played on two channels it is the one channel's loudness + 3 LU, less what the limiter took
  assert.ok(got.lufs <= was.lufs + 3.01 + 0.1 && got.lufs >= was.lufs + 3.01 - 2, `${was.lufs} → ${got.lufs}`);
  assert.ok(r.steps[0].loudnessTakenLu > 0, "the limiter says what it took");
  // a quiet one is left as it is (no gain), its peaks untouched
  const soft = intermediate("soft.wav", "volume=-20dB");
  const out2 = file("soft.out.wav");
  await level(soft, out2, { level: "off", mono: true });
  near(loudnessOf(out2).lufs, loudnessOf(soft).lufs, 0.05, "kept");
  // in step: the output lags the input by no more than a sample (cross-correlation over 2 s)
  for (const f of [out2, file("even.wav")]) {
    if (!fs.existsSync(f)) continue;
    const x = samples(f === out2 ? soft : base), y = samples(f);
    near(y.length, x.length, 1, "samples");
    let best = 0, lag = 0;
    const a = 48000 * 4, n = 48000 * 2;
    for (let d = -480; d <= 480; d++) {
      let s = 0;
      for (let i = a; i < a + n; i++) s += x[i] * y[i + d];
      if (s > best) { best = s; lag = d; }
    }
    assert.ok(Math.abs(lag) <= 1, `${path.basename(f)} lags by ${lag} samples`);
  }
});

test("a quiet recording (−40 LUFS) comes to the target as well, the leveller none", { skip }, async () => {
  const q = intermediate("q40.wav", "volume=-17.7dB");
  near(loudnessOf(q).lufs, -40, 0.6, "made quiet");
  const out = file("q40.m4a");
  const r = await level(q, out, { encode: ["-c:a", "aac", "-b:a", "192k"] });
  near(loudnessOf(out).lufs, -14, 0.5, "loudness");
  assert.ok(loudnessOf(out).truePeak <= -1);
  assert.ok(!r.steps.some((s) => s.id === "leveller"));
  assert.ok(r.steps.find((s) => s.id === "loudness").gainDb > 20);
});
