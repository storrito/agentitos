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

// the machines have the neural denoiser on the PATH; these tests are of ffmpeg's methods, so it is hidden here (test-neural.mjs tests it)
process.env.VOICE_SOUND_DENOISER = "/nonexistent/voice-sound-no-denoiser";
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
    assert.deepEqual(r.steps.map((s) => s.id), ["loudness", "peaks", "limiter"]);
    for (const s of r.steps) assert.ok(s.why.length > 20, s.id);
    const got = loudnessOf(out);
    near(got.lufs, TARGETS.lufs, 0.5, `${ext} loudness`);
    assert.ok(got.truePeak <= TARGETS.peakAccepted, `${ext} true peak ${got.truePeak}`);
    assert.deepEqual({ lufs: r.delivered.lufs, rangeLu: r.delivered.rangeLu, truePeak: r.delivered.truePeak }, got);
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
  // slow limiter turns the speech's peaks down for both halves alike (and the gain brings all of it
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

test("one channel against two: both at −14 LUFS as played on two speakers, so ffmpeg measures the mono file at −17 and its channel is either channel of the two", { skip }, async () => {
  const quiet = intermediate("quiet.wav", "volume=-18dB");
  const two = file("two.wav"), one = file("one.wav");
  await level(quiet, two, {});
  const r = await level(quiet, one, { mono: true });
  assert.equal(probe(one).channels, 1);
  assert.equal(probe(two).channels, 2);
  near(loudnessOf(one).lufs, -17, 0.4, "mono, as ffmpeg measures it");
  near(loudnessOf(two).lufs, -14, 0.4, "two channels");
  const left = file("left.wav");
  run(["-i", two, "-af", "pan=mono|c0=c0", "-c:a", "pcm_f32le", left]);
  near(loudnessOf(one).lufs - loudnessOf(left).lufs, 0, 0.3, "one channel against one of two");
  const loud = r.steps.find((s) => s.id === "loudness");
  assert.match(loud.why, /−14\.0 LUFS as played on two speakers \(the one channel −17\.0 LUFS as ffmpeg measures it\)/);
  assert.equal(loud.measuredLufs, -17.01);
  near(r.delivered.asPlayedLufs, -14, 0.4, "the JSON's loudness as played");
  assert.ok(loudnessOf(one).truePeak <= -1);
});

test("in step and as long: the two limiters' look-ahead is taken back; --level off keeps the loudness and only makes the peaks safe", { skip }, async () => {
  // too loud: peaks over full scale
  const hot = intermediate("hot.wav", "volume=4dB");
  const out = file("hot.out.wav");
  const r = await level(hot, out, { level: "off" });
  assert.deepEqual(r.steps.map((s) => s.id), ["loudness", "limiter"]);
  assert.match(r.skipped.find((s) => s.id === "level").why, /own dynamics and loudness are kept/);
  const was = loudnessOf(hot), got = loudnessOf(out);
  assert.ok(was.truePeak > 0, `${was.truePeak}`);
  assert.ok(got.truePeak <= TARGETS.peakAccepted, `true peak ${got.truePeak}`);
  // as played on two channels it is the one channel's loudness + 3 LU: kept, though the limiter had to act
  near(got.lufs, was.lufs + 3.01, 0.5, "the loudness kept");
  assert.ok(r.steps[1].peaksTakenDb >= 0.5, "the limiter says what it took");
  assert.match(r.steps[1].why, /at its own loudness its peaks could not be made safe without limiting them/);
  // a quiet one is left as it is (no gain), its peaks untouched
  const soft = intermediate("soft.wav", "volume=-20dB");
  const out2 = file("soft.out.wav");
  await level(soft, out2, { level: "off", mono: true });
  near(loudnessOf(out2).lufs, loudnessOf(soft).lufs, 0.05, "kept");
  // what repair took for headroom (6 dB, as before it redraws clipped peaks) is given back: the
  // loudness the recording came in at (keepLufs, as played) is the delivered file's
  const lowered = intermediate("lowered.wav", "volume=-6dB");
  const came = loudnessOf(base).lufs + 3.01;
  const r3 = await level(lowered, file("lowered.out.m4a"), { level: "off", keepLufs: came, encode: ["-c:a", "aac", "-b:a", "192k"] });
  near(loudnessOf(file("lowered.out.m4a")).lufs, came, 0.5, "the loudness it came in at");
  assert.match(r3.steps[0].why, /^Its own loudness kept: −\d+\.\d LUFS as played on two speakers, as it came in \(\+6\.\d dB on the mended sound: what repair took off it for headroom given back\)/);
  // in step: the output lags the input by no more than a sample (cross-correlation over 2 s); the
  // even voice went through both limiters' look-ahead
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

test("the peaks are tamed before the limiter: with auto it takes less off the loudest peak than with plain, and at most 3 dB; the step says which way the peaks went", { skip }, async () => {
  // the made-up voice: its peaks lie about 20 dB over its loudness, 4.5 dB more than −14 LUFS
  // under a ceiling of −1.5 dBTP leaves them
  const auto = await level(base, file("aim-auto.wav"), {});
  const plain = await level(base, file("aim-plain.wav"), { level: "plain" });
  const lim = (r) => r.steps.find((s) => s.id === "limiter").peaksTakenDb;
  assert.ok(lim(plain) >= 3, `plain's limiter took ${lim(plain)} dB: the voice should need more than 3`);
  assert.ok(lim(auto) < lim(plain) - 1, `the limiter took ${lim(auto)} dB with auto, ${lim(plain)} with plain`);
  assert.ok(lim(auto) <= 3, `the limiter took ${lim(auto)} dB with auto`);
  const c = auto.steps.find((s) => s.id === "peaks");
  assert.ok(c.peaksNearerDb > 0, `the peaks came ${c.peaksNearerDb} dB nearer`);
  assert.match(c.why, /the loudest peak came \d+\.\d dB nearer the loudness \(\d+\.\d → \d+\.\d dB over it\)/);
  // (its numbers are the sound's: the crest before it less the crest after it)
  near(c.peaksNearerDb, c.crestBeforeDb - c.crestAfterDb, 0.11, "nearer");
  assert.match(auto.steps.find((s) => s.id === "limiter").why, /\(about \d+\.\d dB without the slow limiter before it\)/);
  // an even voice is not compressed for its range: the range as plain leaves it, within 0.3 LU
  near(loudnessOf(file("aim-auto.wav")).rangeLu, loudnessOf(file("aim-plain.wav")).rangeLu, 0.3, "the range, auto against plain");
  near(c.rangeAfterLu, c.rangeBeforeLu, 0.5, "the range through the slow limiter");
});

test("the leveller's ramp lies where the level steps: centred within 0.3 s of 14.4 s, as wide as 3 dB a second makes it", { skip }, async () => {
  // (no slow limiter and a target the limiter leaves alone: the gain the output has over the
  // input is the leveller's curve and the gain to the target)
  const out = file("ramp.wav");
  await level(step, out, { targets: { lufs: -20 }, peaks: { kind: "none" } });
  const x = samples(step), y = samples(out);
  const W = 4800, pts = [];
  for (let i = 0; i + W <= x.length; i += W) {
    const t = (i + W / 2) / 48000;
    if (!inSpeech(t)) continue;
    let a = 0, b = 0;
    for (let j = i; j < i + W; j++) { a += x[j] * x[j]; b += y[j] * y[j]; }
    pts.push([t, 10 * Math.log10(b / a)]);
  }
  const med = (v) => [...v].sort((p, q) => p - q)[Math.floor(v.length / 2)];
  const lo = med(pts.filter(([t]) => t < 9.4).map((p) => p[1])), hi = med(pts.filter(([t]) => t > 19.4).map((p) => p[1]));
  near(hi - lo, 7.5, 1.5, "the quiet half raised against the loud one");
  // a ramp at 3 dB a second from one plateau to the other, its centre fitted to the speech's gain
  const w = (hi - lo) / 3;
  let best = null;
  for (let c = 9.4; c <= 19.4; c += 0.02) {
    let e = 0;
    for (const [t, g] of pts) if (t > 9.4 && t < 19.4) e += (g - (lo + (hi - lo) * Math.min(1, Math.max(0, (t - c) / w + 0.5)))) ** 2;
    if (!best || e < best.e) best = { c, e };
  }
  near(best.c, 14.4, 0.3, "the ramp's centre");
});

test("no measurement, no voice, too quiet: −70 LUFS is none; a silent or 0.3 s sound is refused; 47 and 61 dB of gain are given and said to be very low, more than 70 is refused whatever the target, 36 is given and said nothing of", { skip }, async () => {
  // ebur128 prints −70.0 for a sound in which no 400 ms block passes its gate
  const short = intermediate("short.wav", "atrim=start=0.5:duration=0.3");
  const silent = file("silent.wav");
  run(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "3", "-c:a", "pcm_f32le", silent]);
  for (const f of [short, silent]) {
    assert.equal(loudnessOf(f).lufs, null, path.basename(f));
    assert.equal(loudnessOf(f).rangeLu, null, path.basename(f));
    await assert.rejects(level(f, file("none.wav"), {}), /no voice to bring to a loudness/);
    await assert.rejects(level(f, file("none.wav"), { level: "plain" }), /no voice to bring to a loudness/);
  }
  assert.ok(!fs.existsSync(file("none.wav")));
  // a voice at −61 LUFS as played needs 47 dB: delivered at the target, and said to be very low
  const low = intermediate("low.wav", "volume=-41dB");
  for (const mode of ["auto", "plain"]) {
    const r = await level(low, file(`low.${mode}.wav`), { level: mode });
    near(loudnessOf(file(`low.${mode}.wav`)).lufs, -14, 0.5, `${mode}: −61 brought to −14`);
    const q = r.left.find((x) => x.id === "quiet");
    assert.ok(q, `${mode}: ${JSON.stringify(r.left)}`);
    assert.match(q.why, /^It was recorded very low, −6\d\.\d LUFS as played, 4\d dB under the −14\.0 it was brought to all the same: its noise and its room came up with the voice by as much; next time closer to the microphone, or with the recorder's input turned up\.$/);
    near(q.underDb, 46.3, 1, "how far under the target it lay");
    assert.ok(q.gainDb >= q.underDb - 0.5, JSON.stringify(q));
  }
  // −75 as played (61 dB): under ebur128's gate of −70 LUFS, measured through a gain, delivered
  const lower = intermediate("lower.wav", "volume=-56dB");
  assert.equal(loudnessOf(lower).lufs, null, "ebur128 sees no loudness in it");
  const rl = await level(lower, file("lower.out.wav"), {});
  near(loudnessOf(file("lower.out.wav")).lufs, -14, 0.5, "−75 brought to −14");
  assert.ok(rl.settings.measuredThroughDb > 20, JSON.stringify(rl.settings.measuredThroughDb));
  assert.ok(rl.left.some((x) => x.id === "quiet"));
  // −86 as played needs 72 dB: refused, nothing written; at −23 LUFS it would need 63, still
  // refused (the bound is the recording's level: 70 dB under −14, 61 under −23)
  const far = intermediate("far.wav", "volume=-67dB");
  await assert.rejects(level(far, file("far.out.wav"), {}), /^Error: The voice lies at −8\d\.\d LUFS as played: bringing it to −14\.0 would take 7\d dB of gain, more than the 70 dB this tool gives, and so little of it stands over the floor of its recording that the gain would raise mostly that floor; record it again closer to the microphone or with the recorder's input turned up\.$/);
  await assert.rejects(level(far, file("far.out.wav"), { level: "plain" }), /more than the 70 dB this tool gives/);
  await assert.rejects(level(far, file("far.out.wav"), { targets: { lufs: -23 } }), /bringing it to −23\.0 would take 6\d dB of gain, more than the 61 dB this tool gives/);
  assert.ok(!fs.existsSync(file("far.out.wav")));
  // one at −50 as played needs 36 dB (and some 4 more for what the limiters take): given, nothing
  // said of it, and no pass ever more than the bound
  const quiet = intermediate("q50.wav", "volume=-30dB");
  const r = await level(quiet, file("q50.out.wav"), {});
  near(loudnessOf(file("q50.out.wav")).lufs, -14, 0.3, "−50 brought to −14");
  assert.ok(!r.left.some((x) => x.id === "quiet"), JSON.stringify(r.left));
  assert.ok(r.passes.every((p) => p.gainDb <= 70), JSON.stringify(r.passes));
  // nothing left beside the outputs
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.startsWith(".")), []);
});

test("encoded as delivered (.m4a, .mp3): within 0.3 LU of the target and the true peak at the aim, whatever order the two corrections need; what is claimed is what the file has; the rounds bounded and said", { skip }, async () => {
  // (the made-up voice's peaks lie 20 dB over its loudness: the encoders raise its true peak by
  // 0.5 to 1 dB, the ceiling is lowered, and each lowering takes loudness the gain must win back)
  const has = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout;
  const kinds = [["m4a", ["-c:a", "aac", "-b:a", "192k"]], ...(/libmp3lame/.test(has) ? [["mp3", ["-c:a", "libmp3lame", "-b:a", "192k"]]] : [])];
  for (const [ext, encode] of kinds) for (const lufs of [-14, -16]) {
    const out = file(`encoded${lufs}.${ext}`);
    const r = await level(base, out, { encode, targets: { lufs } });
    const got = loudnessOf(out), what = `${ext} at ${lufs}`;
    assert.deepEqual([r.delivered.lufs, r.delivered.truePeak], [got.lufs, got.truePeak], `${what}: the report's numbers are the file's`);
    assert.ok(got.truePeak <= TARGETS.peakAccepted, `${what}: true peak ${got.truePeak}`);
    if (got.truePeak > TARGETS.truePeak + 0.05) assert.ok(r.left.some((x) => x.id === "peak"), `${what}: true peak ${got.truePeak} and nothing left says so`);
    // the loudness step says "within 0.3 LU" only where the file is
    const loud = r.steps.find((s) => s.id === "loudness");
    assert.equal(/corrected until within 0\.3 LU/.test(loud.why), Math.abs(got.lufs - lufs) <= 0.3, `${what}: ${loud.why}`);
    const lim = r.steps.find((s) => s.id === "limiter");
    assert.ok(lim.encodings >= 1 && lim.encodings <= 6, JSON.stringify(lim));
    assert.equal(r.passes.filter((p) => p.kind === "delivered").length, lim.encodings);
    if (lim.loweredTimes) assert.match(lim.why, /lowered (once|twice|\d times) because the encoded file came over the −1\.5 dBTP aimed at/);
    // (this voice can have both)
    near(got.lufs, lufs, 0.3, `${what}: loudness`);
  }
});

test("where the loudness cannot be had under the ceiling, `left` says that it gave way and by how much", { skip }, async () => {
  // (−6 LUFS plain under a ceiling of −6 dBTP: the made-up voice's peaks would need far more
  // limiting than that; the limiter holds it down)
  const r = await level(base, file("gave-way.m4a"), { level: "plain", encode: ["-c:a", "aac", "-b:a", "192k"], targets: { lufs: -6, truePeak: -6, peakAccepted: -5.5 } });
  const got = loudnessOf(file("gave-way.m4a"));
  assert.ok(got.lufs < -6.3, `${got.lufs}`);
  const q = r.left.find((x) => x.id === "loudness");
  assert.ok(q, JSON.stringify(r.left));
  assert.match(q.why, /^The loudness came to −\d+\.\d LUFS as played, \d+\.\d LU under the −6\.0 aimed at: the loudness gave way to the true peak: to hold it under −\d+\.\d dB the two limiters take \d+\.\d LU off the loudness/);
  near(q.offLu, got.lufs + 6, 0.06, "by how much");
  assert.ok(got.truePeak <= -5.5, `true peak ${got.truePeak}`);
  assert.match(r.steps.find((s) => s.id === "loudness").why, /^Brought towards −6\.0 LUFS .*: it came to −\d+\.\d, see what is left\.$/);
});

test("the gain search never passes the bound: where the limiter takes loudness and the search asks for more, it stops at the bound and says so", { skip }, async () => {
  // (plain at −8 LUFS: the made-up voice's peaks lie 20 dB over its loudness, so the limiter takes
  // several LU and every correction asks for more gain than the first guess; the bound 1 dB over it)
  const first = -8 - 3.01 - loudnessOf(base).lufs;
  const bound = Math.round((first + 1) * 10) / 10;
  const r = await level(base, file("capped.wav"), { level: "plain", targets: { lufs: -8 }, maxGainDb: bound });
  assert.ok(r.passes.length >= 2, JSON.stringify(r.passes));
  for (const p of r.passes) assert.ok(p.gainDb <= bound + 0.005, `a pass at ${p.gainDb} dB over the bound of ${bound}: ${JSON.stringify(r.passes)}`);
  assert.ok(r.passes.some((p) => Math.abs(p.gainDb - bound) < 0.01), `the search reached the bound: ${JSON.stringify(r.passes)}`);
  assert.match(r.left.find((x) => x.id === "loudness")?.why ?? "", new RegExp(`the gain stops at ${bound} dB\\.$`));
});

test("a file whose name begins with a dash is a file to ffmpeg, in and out", { skip }, async () => {
  const dash = file("-voice.wav");
  fs.copyFileSync(base, dash);
  const out = file("-out.m4a");
  // (relative names as an agent passes them, from the folder they lie in)
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    assert.ok(loudnessOf("-voice.wav").lufs < -10);
    const r = await level("-voice.wav", "-out.m4a", { encode: ["-c:a", "aac", "-b:a", "192k"] });
    assert.equal(r.delivered.lufs, loudnessOf("-out.m4a").lufs);
  } finally { process.chdir(cwd); }
  near(loudnessOf(out).lufs, -14, 0.5, "loudness");
});
