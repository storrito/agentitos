// measure on a voice made up with ffmpeg's lavfi (no speech is in the repository): a sawtooth
// whose pitch wanders around 120 Hz, shaped by three formants, switched on and off as syllables
// (4 a second) in phrases of 2.5 s with pauses of 1.1 s, a hiss of "s" now and then, a faint
// pink noise under all of it. Then one fault at a time, and that measure names it and its size
// roughly; the clean voice has no finding. No request, no key, no network.
//
//   node --test tools/test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { measure, lines } from "./voice.mjs";
import { CLIP_SOME_SHARE, CLIP_MIN_RUNS, CLIP_MIN_RUN_SAMPLES } from "./lib/findings.mjs";

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), "voice.mjs");
const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const skip = !ffmpeg && "no ffmpeg";
const near = (x, y, by, what = "") => assert.ok(Math.abs(x - y) <= by, `${what} ${x} is not within ${by} of ${y}`);
const run = (args) => { const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); };
const cli = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8" });
const ids = (m) => m.findings.map((f) => f.id);

const D = 28.8;
const VOICE = `aevalsrc=exprs='st(0,120*t+3.41*(1-cos(4.398*t))+6.92*(1-cos(1.445*t)));st(1,mod(t,3.6));` +
  `0.25*lt(ld(1),2.5)*pow(sin(12.566*ld(1)),2)*(0.6+0.4*sin(5.655*t))*2*(ld(0)-floor(ld(0)+0.5))':s=48000:d=${D},` +
  `equalizer=f=500:t=o:w=1:g=10,equalizer=f=1500:t=o:w=1:g=6,equalizer=f=2700:t=o:w=0.8:g=4,lowpass=f=5000[v];` +
  `anoisesrc=color=white:amplitude=0.03:r=48000:d=${D}:seed=3,highpass=f=4000,highpass=f=4000,volume='lt(mod(t,3.6),2.5)*lt(mod(t,0.75),0.09)':eval=frame[s];` +
  `anoisesrc=color=pink:amplitude=0.0015:r=48000:d=${D}:seed=5[n];[v][s][n]amix=inputs=3:normalize=0`;

let dir, base, clean;
const file = (name) => path.join(dir, name);
// a copy of the voice through ffmpeg's arguments `args` (after the input), as 16-bit WAV
function fault(name, ...args) {
  const out = file(name);
  run(["-i", base, ...args, "-c:a", "pcm_s16le", out]);
  return out;
}
// the samples of a file, as ffmpeg decodes them (mono, 48 kHz)
function samples(f) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", f, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
}
// the integrated loudness of a file by ffmpeg alone
function lufsOf(f) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", f, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
  return Number(r.stderr.slice(r.stderr.lastIndexOf("Summary:")).match(/I:\s+(-?[\d.]+) LUFS/)[1]);
}

before(async () => {
  if (!ffmpeg) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-sound-test-"));
  base = file("voice.wav");
  run(["-filter_complex", VOICE, "-ac", "1", "-c:a", "pcm_s16le", base]);
  clean = await measure(base);
});
after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

test("the clean voice: speech about 70 % of the time, the floor in its pauses, no finding", { skip }, () => {
  const m = clean;
  assert.deepEqual(m.findings, [], JSON.stringify(m.findings));
  near(m.speech.share, 0.75, 0.06, "speech share");
  assert.ok(m.levels.snrDb > 40, `snr ${m.levels.snrDb}`);
  assert.ok(m.speech.longest.length >= 5 && m.speech.longest.every((p) => p.seconds >= 0.5 && !p.silent));
  // a pause starts after the voice: 2.5 s into a phrase of 3.6 s
  for (const p of m.speech.longest) assert.ok(((p.from % 3.6) + 3.6) % 3.6 >= 2.5, `pause at ${p.from}`);
  assert.equal(m.channels, null);
  assert.equal(m.hum.hz, null);
  assert.ok(m.tone.bands.every((b) => b.diff == null || Math.abs(b.diff) < 5), JSON.stringify(m.tone.bands));
  assert.equal(m.bandwidth.topHz, 24000);
  near(m.loudness.integratedLufs, lufsOf(base), 0.05, "ebur128's integrated loudness");
});

test("noise at a known distance: the estimate within 3 dB, named noise", { skip }, async () => {
  const noise = file("pink.wav");
  run(["-f", "lavfi", "-i", `anoisesrc=color=pink:amplitude=0.05:r=48000:d=${D}:seed=9`, "-c:a", "pcm_f32le", noise]);
  const gain = clean.levels.speechLufs - 15 - lufsOf(noise);
  const f = file("noisy.wav");
  run(["-i", base, "-i", noise, "-filter_complex", `[1:a]volume=${gain.toFixed(2)}dB[n];[0:a][n]amix=inputs=2:normalize=0`, "-c:a", "pcm_s16le", f]);
  const m = await measure(f);
  near(m.levels.snrDb, 15, 3, "snr");
  assert.equal(m.findings.find((x) => x.id === "noise")?.strength, "strong");
  assert.equal(m.noise.kind, "broadband");
  assert.ok(m.noise.fluctuationDb < 3);
});

// mains hum of ten harmonics (as the lab's corpus builds it, the tenth added), `level` its
// fundamental's amplitude; `when` an expression of t that switches it (1: all through)
const HUM_AMPS = [1, 0.5, 0.6, 0.25, 0.35, 0.15, 0.2, 0.1, 0.12, 0.08];
const humOf = (hz, level = 0.006, when = "1", d = D) =>
  `${HUM_AMPS.map((a, i) => `sine=f=${hz * (i + 1)}:r=48000:d=${d},volume=${(level * a).toPrecision(3)}[h${i}]`).join(";")};` +
  `${HUM_AMPS.map((_, i) => `[h${i}]`).join("")}amix=inputs=${HUM_AMPS.length}:normalize=0,volume='${when}':eval=frame[hum]`;
// a voice without a pause: the sawtooth and formants of VOICE, its pitch `phase` (cycles at t),
// syllables that never fall silent, a faint pink noise under it
const steady = (phase, d = 8) => `aevalsrc=exprs='st(0,${phase});0.25*(0.7+0.3*sin(12.566*t))*2*(ld(0)-floor(ld(0)+0.5))':s=48000:d=${d},` +
  `equalizer=f=500:t=o:w=1:g=10,equalizer=f=1500:t=o:w=1:g=6,equalizer=f=2700:t=o:w=0.8:g=4,lowpass=f=5000[v];` +
  `anoisesrc=color=pink:amplitude=0.0015:r=48000:d=${d}:seed=5[n];[v][n]amix=inputs=2:normalize=0`;

test("hum: 50 Hz told from 60 Hz, ten harmonics each judged in the pauses", { skip }, async () => {
  for (const hz of [50, 60]) {
    const f = file(`hum${hz}.wav`);
    run(["-i", base, "-filter_complex", `${humOf(hz)};[0:a][hum]amix=inputs=2:normalize=0`, "-c:a", "pcm_s16le", f]);
    const m = await measure(f);
    assert.equal(m.hum.judged, true);
    assert.equal(m.hum.hz, hz);
    assert.ok(m.hum.steadyChecked && m.hum.parts >= 2, JSON.stringify(m.hum.parts));
    const counted = (hz === 50 ? m.hum.at50 : m.hum.at60).filter((x) => x.counts);
    assert.ok(counted.length >= 8, `${counted.length} harmonics counted`);
    assert.ok(counted.every((x) => x.hz % hz === 0 && x.hz <= hz * 10 && x.spreadDb <= 6), JSON.stringify(counted));
    // (the other grid: no line of its own counts)
    const other = (hz === 50 ? m.hum.at60 : m.hum.at50).filter((x) => x.counts && x.hz % 300 !== 0);
    assert.deepEqual(other, [], JSON.stringify(other));
    assert.ok(ids(m).includes("hum"), ids(m).join());
    assert.ok(!ids(m).includes("rumble"), "hum is no rumble");
  }
});

test("hum: a voice without a pause is never taken for hum, nor judged for it", { skip }, async () => {
  // its pitch held at 120 Hz, held at 180 Hz, gliding from 80 to 120 Hz through 100 Hz
  for (const [name, phase] of [["at120", "120*t"], ["at180", "180*t"], ["glide", "80*t+2.5*t*t"]]) {
    const f = file(`steady-${name}.wav`);
    run(["-filter_complex", steady(phase), "-ac", "1", "-c:a", "pcm_s16le", f]);
    const m = await measure(f);
    assert.ok(m.speech.share > 0.95, `${name}: speech ${m.speech.share}`);
    assert.equal(m.hum.judged, false, name);
    assert.equal(m.hum.hz, null, name);
    assert.ok(!ids(m).includes("hum"), `${name}: ${ids(m).join()}`);
  }
  // and real hum under it is not named either: without a pause there is nothing to judge it by
  const f = file("steady-hum.wav");
  run(["-filter_complex", `${steady("120*t")}[v];${humOf(50, 0.006, "1", 8)};[v][hum]amix=inputs=2:normalize=0`, "-ac", "1", "-c:a", "pcm_s16le", f]);
  const m = await measure(f);
  assert.equal(m.hum.judged, false);
  assert.match(m.hum.why, /judged from 0\.7 s on/);
  assert.ok(!ids(m).includes("hum"), ids(m).join());
});

test("hum: a voice with pauses and its pitch held at 120 Hz is no hum; a hum in the first half only is named intermittent, not hum", { skip }, async () => {
  const held = file("held120.wav");
  run(["-filter_complex", VOICE.replace("st(0,120*t+3.41*(1-cos(4.398*t))+6.92*(1-cos(1.445*t)))", "st(0,120*t)"), "-ac", "1", "-c:a", "pcm_s16le", held]);
  const h = await measure(held);
  assert.equal(h.hum.judged, true);
  assert.equal(h.hum.hz, null, JSON.stringify(h.hum.at60.slice(0, 3)));
  // (a hum that stops: a notch would run where there is none, and a line that is not there in
  // every part of the pauses is no steady hum)
  const half = file("hum-half.wav");
  run(["-i", base, "-filter_complex", `${humOf(50, 0.006, `lt(t,${D / 2})`)};[0:a][hum]amix=inputs=2:normalize=0`, "-c:a", "pcm_s16le", half]);
  const m = await measure(half);
  assert.equal(m.hum.judged, true);
  assert.ok(m.hum.parts >= 2);
  assert.equal(m.hum.hz, null, JSON.stringify(m.hum.at50.slice(0, 3)));
  assert.equal(m.hum.intermittent, true);
  assert.ok(m.hum.at50.slice(0, 3).every((x) => x.inParts > 0 && x.inParts < m.hum.parts), JSON.stringify(m.hum.at50.slice(0, 3)));
  assert.ok(!ids(m).includes("hum"), ids(m).join());
});

test("clipping at a known share, also turned down afterwards and through AAC", { skip }, async () => {
  const loud = fault("loud.wav", "-af", "volume=6dB");
  const x = samples(loud), abs = Float64Array.from(x, Math.abs).sort();
  const ceiling = abs[Math.floor(abs.length * 0.99)];               // 1 % of the samples over it
  const clip = `aeval='max(-${ceiling},min(${ceiling},val(0)))'`;
  const clipped = fault("clipped.wav", "-af", `volume=6dB,${clip}`);
  const m = await measure(clipped);
  near(m.clipping.share, 0.01, 0.004, "share");
  near(m.clipping.ceilingDb, 20 * Math.log10(ceiling), 0.3, "ceiling");
  assert.equal(m.findings.find((f) => f.id === "clipped")?.strength, "strong");
  const down = await measure(fault("clipped-down.wav", "-af", `volume=6dB,${clip},volume=-9dB`));
  near(down.clipping.ceilingDb, 20 * Math.log10(ceiling) - 9, 0.3, "ceiling turned down");
  near(down.clipping.share, 0.01, 0.004, "share turned down");
  const aac = file("clipped.m4a");
  run(["-i", clipped, "-c:a", "aac", "-b:a", "128k", aac]);
  assert.ok(ids(await measure(aac)).includes("clipped"), "clipped through AAC");
});

test("clipping in a short cut: one loud crest is not clipped, a cut held at a ceiling is", { skip }, async () => {
  // 0.8 s of the voice, 6 dB down, and one loud cycle at 100 Hz (a plosive) peaking at −1 dBFS:
  // its two crests hold dozens of samples within 0.2 dB of the peak, a share and a pile-up as
  // clipping has them, in two runs
  const crest = file("crest.wav");
  run(["-i", base, "-filter_complex", "[0:a]atrim=start=0.6:duration=0.8,asetpts=PTS-STARTPTS,volume=-6dB[v];" +
    "aevalsrc=exprs='0.89*sin(2*PI*100*t)*between(t,0.4,0.41)':s=48000:d=0.8[b];[v][b]amix=inputs=2:normalize=0", "-c:a", "pcm_s16le", crest]);
  const m = await measure(crest);
  assert.ok(m.clipping.share >= CLIP_SOME_SHARE && m.clipping.pileUp >= 3, JSON.stringify(m.clipping));
  assert.ok(m.clipping.runs < CLIP_MIN_RUNS, JSON.stringify(m.clipping));
  assert.ok(!ids(m).includes("clipped"), ids(m).join());
  // the same 0.8 s turned up and cut off at a ceiling 6 dB under its peak
  const held = file("held.wav");
  run(["-i", base, "-af", "atrim=start=0.6:duration=0.8,asetpts=PTS-STARTPTS,volume=3dB,aeval='max(-0.5,min(0.5,val(0)))'", "-c:a", "pcm_s16le", held]);
  const c = await measure(held);
  assert.ok(c.clipping.exactRuns >= CLIP_MIN_RUNS && c.clipping.exactRunSamples >= CLIP_MIN_RUN_SAMPLES, JSON.stringify(c.clipping));
  near(c.clipping.ceilingDb, 20 * Math.log10(0.5), 0.3, "ceiling");
  assert.ok(ids(c).includes("clipped"), ids(c).join());
});

test("a DC offset of 0.05", { skip }, async () => {
  const m = await measure(fault("dc.wav", "-af", "aeval=val(0)+0.05"));
  near(m.dc.values[0], 0.05, 0.002, "dc");
  assert.equal(m.findings.find((f) => f.id === "dc")?.strength, "strong");
  assert.ok(!ids(m).includes("rumble") && !ids(m).includes("thumps"), ids(m).join());
});

test("band limits: a 16 kHz source ends at 8 kHz, a telephone's at 3.5 to 4 kHz and over 200 Hz", { skip }, async () => {
  const m16 = await measure(fault("16k.wav", "-af", "aresample=16000,aresample=48000"));
  assert.equal(m16.bandwidth.topHz, 8000);
  assert.equal(m16.findings.find((f) => f.id === "narrow")?.strength, "strong");
  const tel = await measure(fault("phone.wav", "-af", "aresample=8000,highpass=f=300,highpass=f=300,highpass=f=300,lowpass=f=3400,lowpass=f=3400,aresample=48000"));
  assert.ok(tel.bandwidth.topHz >= 3500 && tel.bandwidth.topHz <= 4000, `top ${tel.bandwidth.topHz}`);
  assert.ok(tel.bandwidth.bottomHz >= 200, `bottom ${tel.bandwidth.bottomHz}`);
  assert.ok(ids(tel).includes("narrow"));
});

test("tone: a low-pass is dull (not band-limited), a lift at 160 Hz boomy", { skip }, async () => {
  const dull = await measure(fault("dull.wav", "-af", "lowpass=f=1500,lowpass=f=1500"));
  assert.ok(ids(dull).includes("dull") && !ids(dull).includes("narrow"), ids(dull).join());
  assert.ok(dull.tone.highDiff < -12, `high ${dull.tone.highDiff}`);
  const boomy = await measure(fault("boomy.wav", "-af", "equalizer=f=160:t=o:w=1:g=12"));
  assert.ok(ids(boomy).includes("boomy"), ids(boomy).join());
  near(boomy.tone.bands.find((b) => b.lo === 100).diff - clean.tone.bands.find((b) => b.lo === 100).diff, 9, 3, "boost");
});

test("two channels: one dead, one inverted, the same twice", { skip }, async () => {
  const dead = await measure(fault("dead.wav", "-af", "pan=stereo|c0=c0|c1=0*c0"));
  assert.equal(dead.channels.silentChannel, "right");
  assert.equal(dead.findings.find((f) => f.id === "one-channel")?.strength, "strong");
  const inv = await measure(fault("inverted.wav", "-af", "pan=stereo|c0=c0|c1=-1*c0"));
  near(inv.channels.correlation, -1, 0.01, "correlation");
  assert.ok(inv.channels.monoLossDb < -30);
  assert.equal(inv.findings.find((f) => f.id === "inverted")?.strength, "strong");
  const twice = await measure(fault("dual.wav", "-af", "pan=stereo|c0=c0|c1=c0"));
  assert.equal(twice.channels.identical, true);
  assert.deepEqual(twice.findings, []);
});

test("a level step of −12 dB at 14.4 s", { skip }, async () => {
  const m = await measure(fault("step.wav", "-af", "volume='if(gte(t,14.4),0.25,1)':eval=frame"));
  near(m.levels.step.lu, -12, 2.5, "step");
  near(m.levels.step.at, 14.4, 3, "at");
  assert.ok(m.levels.step.residualLu < m.levels.drift.residualLu);
  assert.equal(m.findings.find((f) => f.id === "uneven")?.strength, "strong");
  // the quieter half's pauses are still pauses
  near(m.speech.share, clean.speech.share, 0.05, "speech share");
});

test("a video with sound is measured; one without, an empty file, silence and no file are one sentence each", { skip }, async () => {
  const video = file("talk.mp4");
  run(["-f", "lavfi", "-i", "color=c=gray:s=320x240:r=25", "-i", base, "-shortest", "-c:v", "mpeg4", "-c:a", "aac", "-metadata", "location=+52.5200+013.4050/", video]);
  const v = cli("measure", video);
  assert.equal(v.status, 0, v.stdout);
  assert.match(v.stdout.split("\n")[0], /talk\.mp4: 0:2[89] of sound in a video, 48 kHz mono, speech \d+ % of the time\.$/);
  assert.match(v.stdout, /Its tags name a place/);
  assert.doesNotMatch(v.stdout, /52\.52|13\.40/);
  const j = JSON.parse(cli("measure", video, "--json").stdout);
  assert.equal(j.sound.video, true);
  assert.equal(j.sound.placeInTags, true);
  assert.doesNotMatch(JSON.stringify(j), /52\.52|13\.40/);
  near(j.levels.speechLufs, clean.levels.speechLufs, 0.5, "speech level in the video");

  const mute = file("mute.mp4");
  run(["-f", "lavfi", "-i", "color=c=gray:s=320x240:r=25:d=2", "-c:v", "mpeg4", mute]);
  const silent = file("silent.wav");
  run(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "3", silent]);
  const text = file("notes.wav");
  fs.writeFileSync(text, "not a recording");
  for (const [f, re] of [[mute, /mute\.mp4 has no sound\.$/], [silent, /silent\.wav is silent all through/], [text, /notes\.wav is no audio or video file ffmpeg can read\.$/],
    [file("gone.wav"), /^There is no .*gone\.wav\.$/]]) {
    const r = cli("measure", f);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout.trim(), re);
    assert.equal(r.stdout.trim().split("\n").length, 1);
    assert.ok(JSON.parse(cli("measure", f, "--json").stdout).error);
  }
});

test("a file whose name begins with a dash or holds a colon is measured, not read as an option or a protocol", { skip }, () => {
  for (const name of ["-take.wav", "take:1.wav", "-i"]) {
    fs.copyFileSync(base, file(name));
    const r = spawnSync(process.execPath, [TOOL, "measure", name, "--json"], { encoding: "utf8", cwd: dir });
    assert.equal(r.status, 0, `${name}: ${r.stdout}`);
    const j = JSON.parse(r.stdout);
    assert.equal(j.file, name);
    near(j.levels.speechLufs, clean.levels.speechLufs, 0.1, name);
  }
});

test("the commands: measure prints its lines; targets answers the master, the list, JSON, and a name it does not have in one sentence", { skip }, () => {
  const out = lines(clean);
  assert.match(out[0], /voice\.wav: 0:28 of sound, 48 kHz mono, speech \d+ % of the time\./);
  assert.match(out.join("\n"), /Nothing stands out\./);
  assert.match(out.at(-1), /^Next: node .*voice\.mjs clean .*voice\.wav <out> brings it to the platforms' loudness; nothing else needs mending/);
  assert.ok(out.join("\n").includes("−"), "minus signs as the collection writes them");
  // (the table itself is test-targets.mjs's; here only that the command reaches it)
  const none = cli("targets");
  assert.equal(none.status, 0, none.stdout);
  assert.match(none.stdout, /^Master for video: −14 LUFS/);
  assert.equal(JSON.parse(cli("targets", "tiktok", "--json").stdout).master.lufs, -14);
  assert.equal(JSON.parse(cli("targets", "podcast", "--json").stdout).master.lufs, -16);
  assert.match(cli("targets", "list").stdout, /^The platforms \(checked \d{4}-\d\d-\d\d\):/);
  const unknown = cli("targets", "myspace");
  assert.equal(unknown.status, 1);
  assert.match(unknown.stdout.trim(), /^There is no platform "myspace": .*\.$/);
  assert.equal(cli("targets", "--loud").status, 1);
  assert.equal(cli("nonsense").status, 1);
});
