// The command `clean` (lib/clean.mjs) with stand-ins for its repair and tone stages (the sound as
// one channel at 48 kHz, no filter), on a voice made up with ffmpeg's lavfi as tools/test.mjs makes
// it. What is tested is the command's own part: the formats by their ending, a video's picture,
// the report, the refusals, --level off and --mono, several audio streams, a signal, the working
// files, names with a dash. No request, no key, no network.
//
//   node --test tools/test-clean.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { clean, lines } from "./lib/clean.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// the machines have the neural denoiser on the PATH; these tests are of ffmpeg's methods, so it is hidden here (test-neural.mjs tests it)
process.env.VOICE_SOUND_DENOISER = "/nonexistent/voice-sound-no-denoiser";
const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const skip = !ffmpeg && "no ffmpeg";
const near = (x, y, by, what = "") => assert.ok(Math.abs(x - y) <= by, `${what} ${x} is not within ${by} of ${y}`);
const run = (args) => { const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); };

const D = 14.4;
const VOICE = `aevalsrc=exprs='st(0,120*t+3.41*(1-cos(4.398*t))+6.92*(1-cos(1.445*t)));st(1,mod(t,3.6));` +
  `0.25*lt(ld(1),2.5)*pow(sin(12.566*ld(1)),2)*(0.6+0.4*sin(5.655*t))*2*(ld(0)-floor(ld(0)+0.5))':s=48000:d=${D},` +
  `equalizer=f=500:t=o:w=1:g=10,equalizer=f=1500:t=o:w=1:g=6,equalizer=f=2700:t=o:w=0.8:g=4,lowpass=f=5000[v];` +
  `anoisesrc=color=white:amplitude=0.03:r=48000:d=${D}:seed=3,highpass=f=4000,highpass=f=4000,volume='lt(mod(t,3.6),2.5)*lt(mod(t,0.75),0.09)':eval=frame[s];` +
  `anoisesrc=color=pink:amplitude=0.0015:r=48000:d=${D}:seed=5[n];[v][s][n]amix=inputs=3:normalize=0`;

// the stand-ins, as a module (the command-line runs load it from a file)
const STAGES = `import { spawnSync } from "node:child_process";
export function repairPlan() { return { steps: [], left: [], method: "stand-in", graph: "" }; }
export async function repair(file, outWav, m, opts = {}) {
  const args = ["-v", "error", "-y", "-i", file, "-map", "0:a:0", "-ac", "1", "-ar", "48000", ...(opts.after ? ["-af", opts.after] : []), "-c:a", "pcm_f32le", outWav];
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return { steps: [{ id: "stand-in", why: "The tests' stand-in for repair: the sound as one channel at 48 kHz." }], left: [{ id: "roomy", why: "The stand-in leaves a room." }], method: "stand-in", graph: "" };
}
export function tonePlan(m, opts = {}) { return { steps: [], left: [{ id: "narrow", why: "The stand-in leaves a band limit." }] }; }
export function toneFilters() { return ""; }
`;

let dir, base, stages, runner, video;
const file = (name) => path.join(dir, name);
const cli = (...args) => spawnSync(process.execPath, [runner, ...args], { encoding: "utf8", cwd: dir });
function probe(f) {
  const r = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", path.resolve(f)], { encoding: "utf8" });
  return JSON.parse(r.stdout);
}
const audioOf = (f) => probe(f).streams.find((s) => s.codec_type === "audio");
function loudness(f) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", path.resolve(f), "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
  const s = r.stderr.slice(r.stderr.lastIndexOf("Summary:"));
  return { lufs: Number(s.match(/I:\s+(-?[\d.]+) LUFS/)[1]), truePeak: Number(s.match(/Peak:\s+(-?[\d.]+) dBFS/)[1]) };
}
// a place in a file's tags (or the coordinates themselves anywhere in what ffprobe says)
const placeIn = (p) => /52\.52|13\.40/.test(JSON.stringify(p)) ||
  [p.format?.tags, ...(p.streams || []).map((s) => s.tags)].some((t) => Object.keys(t || {}).some((k) => /location|gps|iso6709/i.test(k)));
const videoMd5 =(f) => spawnSync("ffmpeg", ["-v", "error", "-i", path.resolve(f), "-map", "0:v", "-c", "copy", "-f", "md5", "-"], { encoding: "utf8" }).stdout.trim();

before(async () => {
  if (!ffmpeg) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-sound-clean-test-"));
  base = file("voice.wav");
  run(["-filter_complex", VOICE, "-ac", "1", "-c:a", "pcm_s16le", base]);
  fs.writeFileSync(file("stages.mjs"), STAGES);
  runner = file("run.mjs");
  fs.writeFileSync(runner, `import { cleanCommand } from ${JSON.stringify(pathToFileURL(path.join(HERE, "lib", "clean.mjs")).href)};\nimport * as stages from "./stages.mjs";\n// (as voice.mjs passes it: the arguments after the command's name)\nawait cleanCommand(process.argv.slice(3), stages);\n`);
  stages = await import(pathToFileURL(file("stages.mjs")).href);
  // a phone's video: a picture, the voice in AAC, a place in its tags
  video = file("talk.mp4");
  run(["-f", "lavfi", "-i", "testsrc=s=320x240:r=25", "-i", base, "-shortest", "-c:v", "mpeg4", "-c:a", "aac", "-ar", "44100",
    "-metadata", "location=+52.5200+013.4050/", "-metadata", "com.apple.quicktime.location.ISO6709=+52.5200+013.4050/", video]);
});
after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

test("the format by the ending: .m4a, .wav, .flac, .mp3, each at 48 kHz, two channels, −14 LUFS, the true peak under the ceiling", { skip }, async () => {
  const has = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout;
  const want = { m4a: ["aac", null], wav: ["pcm_s24le", null], flac: ["flac", "24"], mp3: ["mp3", null] };
  for (const [ending, [codec, bits]] of Object.entries(want)) {
    if (ending === "mp3" && !/libmp3lame/.test(has)) continue;
    const out = file(`out.${ending}`);
    const r = await clean(base, out, {}, stages);
    const a = audioOf(out);
    assert.equal(a.codec_name, codec, ending);
    assert.equal(Number(a.sample_rate), 48000, ending);
    assert.equal(a.channels, 2, ending);
    if (bits) assert.equal(a.bits_per_raw_sample, bits, ending);
    const l = loudness(out);
    near(l.lufs, -14, 0.5, `${ending} loudness`);
    assert.ok(l.truePeak <= -1, `${ending} true peak ${l.truePeak}`);
    near(Number(probe(out).format.duration), D, 0.06, `${ending} duration`);
    assert.equal(r.format.ending, ending);
    assert.ok(fs.existsSync(`${out}.json`));
  }
});

test("a video keeps its picture stream bit for bit, its length and none of its tags", { skip }, async () => {
  const out = file("talk.clean.mp4");
  const r = await clean(video, out, {}, stages);
  assert.equal(videoMd5(out), videoMd5(video), "the picture's packets");
  const pin = probe(video), pout = probe(out);
  near(Number(pout.format.duration), Number(pin.format.duration), 0.05, "length");
  const v = (p) => p.streams.find((s) => s.codec_type === "video");
  near(Number(v(pout).duration), Number(v(pin).duration), 0.001, "the picture's length");
  const a = audioOf(out);
  assert.equal(a.codec_name, "aac");
  assert.equal(Number(a.sample_rate), 48000);
  near(Number(a.duration), Number(audioOf(video).duration), 0.05, "the sound's length");
  assert.ok(placeIn(pin), "the source names a place");
  assert.ok(!placeIn(pout), JSON.stringify(pout.format.tags));
  assert.equal(r.format.video, true);
  near(loudness(out).lufs, -14, 0.5, "loudness");
  // the sound alone from the video: no tags either
  const m4a = file("talk.m4a");
  await clean(video, m4a, {}, stages);
  assert.ok(!placeIn(probe(m4a)));
  assert.equal(probe(m4a).streams.length, 1);
});

test("the report: the file beside the output, the same object with --json, the lines an agent passes on", { skip }, () => {
  const out = file("report.m4a");
  const r = cli("clean", "voice.wav", "report.m4a", "--for", "tiktok", "youtube", "--json");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j, JSON.parse(fs.readFileSync(`${out}.json`, "utf8")));
  for (const k of ["source", "output", "format", "level", "measured", "steps", "left", "skipped", "targets", "delivered", "before", "settings"]) assert.ok(k in j, k);
  assert.equal(j.source, "voice.wav");
  assert.equal(j.output, "report.m4a");
  assert.equal(j.level, "auto");
  assert.equal(j.before, null);
  for (const k of ["lufs", "rangeLu", "truePeak", "speechLufs", "noiseLufs", "snrDb", "findings"]) { assert.ok(k in j.measured.before, k); assert.ok(k in j.measured.after, k); }
  near(j.measured.after.lufs, -14, 0.5, "after");
  assert.deepEqual(j.steps.map((s) => `${s.stage}:${s.id}`), ["repair:stand-in", "level:loudness", "level:peaks", "level:limiter"]);
  for (const s of [...j.steps, ...j.left]) assert.ok(s.why && s.stage, JSON.stringify(s));
  assert.deepEqual(j.left.map((s) => s.id), ["roomy", "narrow"]);
  assert.deepEqual(j.targets, { lufs: -14, asPlayed: "on two speakers", measuredLufs: -14, kept: false, truePeak: -1.5, peakAccepted: -1, peakAfterEncoding: true, rangeLu: 5,
    from: "the master for tiktok, youtube (video)", overridden: [] });
  assert.deepEqual(j.audio, { streams: 1, used: 1, dropped: 0 });
  assert.deepEqual(j.settings.for, ["tiktok", "youtube"]);
  assert.equal(j.settings.denoise, "auto");
  const text = cli("clean", "voice.wav", "report.m4a", "--loudness", "-16", "--peak", "-2");
  assert.equal(text.status, 0, text.stdout);
  const ls = text.stdout.trim().split("\n");
  assert.match(ls[0], /^report\.m4a: 0:14 of the voice, AAC at 192 kbit\/s, 48 kHz, two channels with the same voice in both; from voice\.wav, level auto \(.*\)\.$/);
  assert.match(text.stdout, /\n {2}stand-in \(repair\): /);
  assert.match(text.stdout, /\n {2}limiter \(level\): /);
  assert.match(text.stdout, /Before → after: loudness −\d+\.\d \(one channel; −\d+\.\d as played\) → −1[56]\.\d LUFS, range .* LU, true peak .* dBTP, noise .* dB under the speech/);
  assert.match(text.stdout, /Not mended: roomy: .* narrow: /);
  assert.match(text.stdout, /Targets: −16\.0 LUFS as played on two speakers, true peak −2\.0 dBTP after the encoding \(a check accepts −1\.5\), range 5 LU or under; the master for video, no platform named, loudness and peak as asked\./);
  assert.equal(ls.at(-1), "Beside it: report.m4a.json (what was measured, done and left). Measured, not heard: say so.");
  near(loudness(out).lufs, -16, 0.5, "--loudness −16");
  assert.ok(loudness(out).truePeak <= -1.5, "--peak −2");
  assert.deepEqual(lines(JSON.parse(fs.readFileSync(`${out}.json`, "utf8"))), ls);
});

test("the refusals: one sentence each, exit 1, {error} with --json", { skip }, () => {
  const mute = file("mute.mp4");
  run(["-f", "lavfi", "-i", "color=c=gray:s=320x240:r=25:d=2", "-c:v", "mpeg4", mute]);
  fs.copyFileSync(base, file("same.wav"));
  fs.linkSync(file("same.wav"), file("hard.wav"));
  // a video in a kind of file clean cannot write the new sound into; one with two audio streams
  run(["-f", "lavfi", "-i", "testsrc=s=160x120:r=25:d=3", "-i", base, "-shortest", "-c:v", "mpeg4", "-c:a", "pcm_s16le", file("talk.avi")]);
  run(["-f", "lavfi", "-i", "testsrc=s=160x120:r=25:d=3", "-i", base, "-i", base, "-map", "0", "-map", "1", "-map", "2", "-shortest", "-c:v", "mpeg4", "-c:a", "aac", file("two-tracks.mp4")]);
  // no voice: a short cough of sound, a room without anyone speaking, a voice so far away that it
  // would take more gain than clean gives
  run(["-i", base, "-ss", "0.5", "-t", "0.3", file("short.wav")]);
  run(["-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.03:r=48000:d=20:seed=7,lowpass=f=6000", "-c:a", "pcm_s16le", file("room.wav")]);
  run(["-i", base, "-af", "volume=-42dB", "-c:a", "pcm_f32le", file("far.wav")]);
  const cases = [
    [["gone.wav", "x.m4a"], /^There is no gone\.wav\.$/],
    [["mute.mp4", "x.m4a"], /^mute\.mp4 has no sound\.$/],
    [["voice.wav", "voice.wav"], /^voice\.wav is the recording itself: clean never writes over its input; name another file\.$/],
    [["voice.wav", "./voice.wav"], /is the recording itself/],
    [["same.wav", "hard.wav"], /is the recording itself/],
    [["voice.wav", "x.m4a", "--loud", "-14"], /^Unknown option --loud\. Usage: /],
    [["voice.wav", "x.ogg"], /^clean writes \.m4a, \.wav, \.flac or \.mp3, or a video in its own ending \(\.mp4, \.m4v, \.mov, \.mkv, \.webm\): x\.ogg ends in \.ogg\.$/],
    [["voice.wav", "x"], /x ends in nothing\.$/],
    [["voice.wav", "x.mp4"], /^voice\.wav has no picture: write its sound as /],
    [["talk.mp4", "x.mov"], /^A video keeps its picture only in its own kind of file: name the output \.mp4/],
    [["voice.wav", "x.mkv"], /^voice\.wav has no picture: write its sound as /],
    [["talk.avi", "x.avi"], /^clean cannot put new sound to the picture of a \.avi file \(it does so for \.mp4, \.m4v, \.mov, \.mkv, \.webm\): write its sound alone as \.m4a \(clean talk\.avi talk\.m4a\) and lay it under the picture where it is edited\.$/],
    [["talk.avi", "x.mp4"], /^clean cannot put new sound to the picture of a \.avi file \(it does so for \.mp4, \.m4v, \.mov, \.mkv, \.webm\): write its sound alone as \.m4a \(clean talk\.avi talk\.m4a\)/],
    [["two-tracks.mp4", "x.mp4", "--audio", "3"], /^two-tracks\.mp4 has 2 audio streams: --audio takes 1 to 2, not 3\.$/],
    [["voice.wav", "x.m4a", "--audio", "0"], /^--audio needs the number of the audio stream that is the voice, 1 for the first, not 0\.$/],
    [["short.wav", "x.m4a"], /^measure finds (no voice|only 0\.\d s of voice) in short\.wav/],
    [["room.wav", "x.m4a"], /^measure finds no voice in room\.wav \(its level never rises far enough over its floor\): there is nothing to mend or bring to a loudness, and raising it would only raise its noise\.$/],
    [["far.wav", "x.m4a"], /^The voice lies at −6\d\.\d LUFS as played: bringing it to −14\.0 would take 4\d dB of gain, more than the 40 dB this tool gives, and would raise its noise and its room as much; record it closer to the microphone, or aim lower with --loudness\.$/],
    [["voice.wav"], /^Name the recording and the file to write/],
    [["voice.wav", "x.m4a", "--denoise", "max"], /^--denoise is auto, off, gentle or strong, not max\.$/],
    [["voice.wav", "x.m4a", "--loudness", "loud"], /^--loudness needs a number/],
    [["voice.wav", "x.m4a", "--level", "loud"], /^--level is auto, plain or off, not loud\.$/],
    [["voice.wav", "x.m4a", "--before", "voice.wav"], /^--before names the recording itself/],
    [["voice.wav", "x.m4a", "--before", "x.m4a"], /^--before names the output/],
    [["voice.wav", "x.m4a", "--before", "b.ogg"], /^--before writes \.m4a, \.wav, \.flac or \.mp3: b\.ogg ends in \.ogg\.$/],
    [["voice.wav", "x.m4a", "--for", "myspace"], /^There is no platform "myspace"/],
  ];
  for (const [args, re] of cases) {
    const r = cli("clean", ...args);
    assert.equal(r.status, 1, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
    assert.equal(r.stderr, "", r.stderr);
    assert.match(r.stdout.trim(), re, args.join(" "));
    assert.equal(r.stdout.trim().split("\n").length, 1, args.join(" "));
    const j = JSON.parse(cli("clean", ...args, "--json").stdout);
    assert.ok(j.error, args.join(" "));
  }
  assert.ok(!fs.existsSync(file("x.m4a")));
  assert.equal(fs.readFileSync(file("same.wav")).length, fs.readFileSync(base).length);
  // nothing left behind: no working folder beside the outputs, none in the temp directory
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.startsWith(".voice-sound-clean-")), []);
  assert.deepEqual(fs.readdirSync(os.tmpdir()).filter((n) => /^voice-sound-clean-[A-Za-z0-9]{6}$/.test(n)).filter((n) => {
    try { return Date.now() - fs.statSync(path.join(os.tmpdir(), n)).mtimeMs < 60000; } catch { return false; }
  }), []);
});

test("through voice.mjs itself, with the real stages: clean ends (the command's file and this one do not wait on each other), makes the folders of what it writes, and lands on the loudness", { skip }, () => {
  // (every other run here goes through cleanCommand with stand-ins; this one is the command as an agent runs it)
  const r = spawnSync(process.execPath, [path.join(HERE, "voice.mjs"), "clean", "voice.wav", "made/here/x.m4a", "--before", "made/there/before.m4a"], { encoding: "utf8", cwd: dir, timeout: 120000 });
  assert.equal(r.signal, null, "the command did not end in two minutes");
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.equal(r.stderr, "", r.stderr);
  assert.match(r.stdout, /Measured, not heard: say so\./);
  for (const f of ["made/here/x.m4a", "made/here/x.m4a.json", "made/there/before.m4a"]) assert.ok(fs.existsSync(file(f)), `${f} is not there`);
  near(loudness(file("made/here/x.m4a")).lufs, -14, 0.5, "the loudness");
  near(loudness(file("made/there/before.m4a")).lufs, loudness(file("made/here/x.m4a")).lufs, 0.6, "before against after");
  const j = JSON.parse(fs.readFileSync(file("made/here/x.m4a.json"), "utf8"));
  assert.ok(j.steps.length > 0 && j.steps.every((s) => s.id && s.why), "every step has its reason");
});

test("--level off: the recording's loudness kept as it came in (as played on two speakers), also where repair turned it down for headroom; no leveller, no slow limiter, its peaks safe", { skip }, async () => {
  const hot = file("hot.wav");
  run(["-i", base, "-af", "volume=4dB", "-c:a", "pcm_f32le", hot]);
  const out = file("hot.m4a");
  const r = await clean(hot, out, { level: "off" }, stages);
  assert.deepEqual(r.steps.map((s) => s.id), ["stand-in", "loudness", "limiter"]);
  assert.ok(r.skipped.some((s) => s.id === "level"));
  const was = loudness(hot), got = loudness(out);
  assert.ok(was.truePeak > 0);
  assert.ok(got.truePeak <= -1, `true peak ${got.truePeak}`);
  near(got.lufs, was.lufs + 3.01, 0.5, "the loudness as it came in, as played");
  assert.match(lines(r).join("\n"), /limiter \(level\): .*at its own loudness its peaks could not be made safe without limiting them\./);
  assert.equal(r.settings.level, "off");
  assert.equal(r.targets.kept, true);
  // a repair that turns the sound down by 6 dB (as declip does before it redraws clipped peaks):
  // the loudness still the input's
  const lowering = { ...stages, async repair(f, o, m, opts) { const x = await stages.repair(f, o + ".x.wav", m, opts); run(["-i", o + ".x.wav", "-af", "volume=-6dB", "-c:a", "pcm_f32le", o]); fs.rmSync(o + ".x.wav"); return x; } };
  const r2 = await clean(base, file("lowered.m4a"), { level: "off" }, lowering);
  near(loudness(file("lowered.m4a")).lufs, loudness(base).lufs + 3.01, 0.5, "6 dB of headroom given back");
  assert.match(r2.steps.find((s) => s.id === "loudness").why, /\(\+6\.\d dB on the mended sound: what repair took off it for headroom given back\)/);
  // --mono: one channel, at the loudness as played
  const one = file("hot.mono.wav");
  const r1 = await clean(hot, one, { level: "off", mono: true }, stages);
  assert.equal(audioOf(one).channels, 1);
  near(loudness(one).lufs, was.lufs, 0.5, "the one channel as it was");
  assert.match(lines(r1)[0], /one channel \(−\d+\.\d LUFS as played on two speakers, −\d+\.\d as ffmpeg measures the file\)/);
  assert.match(lines(r1)[0], /level off \(/);
});

test("--mono: one channel at the target as played on two speakers, which ffmpeg measures 3 LU under it; the line and the JSON say both", { skip }, async () => {
  const out = file("mono.m4a");
  const r = await clean(base, out, { mono: true }, stages);
  assert.equal(audioOf(out).channels, 1);
  near(loudness(out).lufs, -17, 0.4, "as ffmpeg measures the mono file");
  assert.equal(r.targets.lufs, -14);
  assert.equal(r.targets.measuredLufs, -17.01);
  near(r.delivered.asPlayedLufs, -14, 0.4, "delivered, as played");
  const ls = lines(r);
  assert.match(ls[0], /one channel \(−14\.0 LUFS as played on two speakers, −17\.0 as ffmpeg measures the file\)/);
  assert.ok(ls.some((l) => /^Targets: −14\.0 LUFS as played on two speakers \(the one channel −17\.0 LUFS as ffmpeg measures it\)/.test(l)), ls.join("\n"));
  assert.ok(ls.some((l) => /^Before → after: loudness −\d+\.\d \(one channel; −\d+\.\d as played\) → −1[67]\.\d \(one channel; −1[34]\.\d as played\) LUFS/.test(l)), ls.join("\n"));
});

test("--level plain: only the loudness and the limiter, the recording's step kept, the line says so", { skip }, async () => {
  const stepped = file("stepped.wav");
  run(["-i", base, "-af", "volume='if(gte(t,7.2),0.3162,1)':eval=frame", "-c:a", "pcm_f32le", stepped]);
  const out = file("stepped.plain.wav");
  // (at −18 LUFS: the made-up voice's peaks lie 20 dB over its loudness, and at −14 the limiter
  // would take 5 dB off the loud half and so part of the step: the case the "peaks" sentence is for)
  const r = await clean(stepped, out, { level: "plain", loudness: -18 }, stages);
  assert.deepEqual(r.steps.map((s) => s.id), ["stand-in", "loudness", "limiter"]);
  assert.equal(r.level, "plain");
  assert.match(lines(r)[0], /level plain \(only the gain to the loudness and the limiter/);
  near(loudness(out).lufs, -18, 0.5, "loudness");
  const half = (a) => { const h = file(`sp-${a}.wav`); run(["-i", out, "-ss", String(a), "-t", "7.2", "-c:a", "pcm_f32le", h]); return loudness(h).lufs; };
  near(half(0) - half(7.2), 10, 1.5, "the step kept");
});

test("--before: the source untouched but for a gain, as loud as the output, its channels, no tags, sound only", { skip }, async () => {
  const out = file("cmp.m4a"), bef = file("cmp.before.m4a");
  // (at −20 LUFS: the made-up voice's peaks lie 20 dB over its loudness, so at −14 its untouched
  // copy could not be as loud without a limiter: the case further down)
  const r = await clean(video, out, { before: bef, loudness: -20 }, stages);
  assert.equal(path.basename(r.before.file), "cmp.before.m4a");
  assert.equal(r.before.limited, false);
  near(loudness(bef).lufs, loudness(out).lufs, 0.3, "as loud as the output");
  const p = probe(bef);
  assert.equal(p.streams.length, 1);
  assert.equal(p.streams[0].channels, 2);
  assert.equal(Number(p.streams[0].sample_rate), 48000);
  assert.ok(!placeIn(p));
  // the gain is the difference of the loudness as played (the source has one channel)
  near(r.before.gainDb, loudness(out).lufs - (loudness(base).lufs + 3.01), 0.6, "gain");
  assert.ok(lines(r).some((l) => /^To compare by ear: \S*cmp\.before\.m4a, the recording as it was but for [+−]\d+\.\d dB, as loud as the output \(−\d+\.\d LUFS\): both play equally loud/.test(l)));
  assert.deepEqual(JSON.parse(fs.readFileSync(`${out}.json`, "utf8")).before, r.before);
  // a loud source whose gain would take its peaks over the ceiling: limited, and said so
  const hot = file("hot2.wav");
  run(["-i", base, "-af", "volume=6dB", "-c:a", "pcm_f32le", hot]);
  const r2 = await clean(hot, file("hot2.wav.m4a"), { before: file("hot2.before.wav"), level: "plain", loudness: -10 }, stages);
  assert.equal(r2.before.limited, true);
  assert.ok(loudness(file("hot2.before.wav")).truePeak <= -1);
  assert.ok(r2.before.peaksHeldDb > 0, JSON.stringify(r2.before));
  assert.ok(lines(r2).some((l) => /^To compare by ear: .*\. Its peaks were held by a limiter to be that loud \(\d+\.\d dB off the loudest, under −1\.5 dBTP\), so it is not quite untouched: both play equally loud/.test(l)), lines(r2).join("\n"));
  // (not limited: the line says nothing of it)
  assert.ok(!lines(r).some((l) => /held by a limiter/.test(l)));
  // with --level off: matched to the output as measured
  const r3 = await clean(base, file("off.m4a"), { before: file("off.before.flac"), level: "off" }, stages);
  near(loudness(file("off.before.flac")).lufs, loudness(file("off.m4a")).lufs, 0.3, "level off");
  near(r3.before.gainDb, 0, 0.5, "nothing to match but the same voice");
});

test("a video whose sound starts 0.68 s after its picture keeps it there: the new voice in step to a millisecond by what is heard, in .mp4, .m4v, .mov and .mkv", { skip }, async () => {
  // (the command reads its audio stream's start against the file's start; with that offset taken
  // for 0 the new voice would start with the picture, 0.66 s early, and this fails). Each file's
  // sound decoded on the file's own clock (the time before its first sample laid as silence), at
  // 4 kHz, and the lag between the two found by cross-correlation over the first 4 s
  const heard = (f) => {
    const r = spawnSync("ffmpeg", ["-v", "error", "-i", path.resolve(f), "-map", "0:a:0", "-af", "aresample=async=1:first_pts=0,aresample=4000", "-ac", "1", "-t", "5", "-f", "f32le", "-"], { maxBuffer: 1 << 24 });
    return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
  };
  const lagMs = (x, y) => {
    let best = -Infinity, lag = 0;
    for (let d = -4000; d <= 4000; d++) {
      let s = 0;
      for (let i = 4000; i < 16000; i++) s += x[i] * (y[i + d] ?? 0);
      if (s > best) { best = s; lag = d; }
    }
    return lag / 4;
  };
  for (const ending of ["mp4", "m4v", "mov", "mkv"]) {
    const late = file(`late.${ending}`);
    run(["-f", "lavfi", "-i", "testsrc=s=160x120:r=25:d=15", "-itsoffset", "0.68", "-i", base, "-map", "0:v", "-map", "1:a", "-c:v", "mpeg4", "-c:a", "aac", "-ar", "44100", ...(ending === "m4v" ? ["-f", "mp4"] : []), late]);
    const out = file(`late.clean.${ending}`);
    const r = await clean(late, out, {}, stages);
    assert.equal(r.format.ending, ending);
    const x = heard(late);
    // (the test's own video: the voice 0.68 s in)
    assert.ok(x.slice(0, 2600).every((v) => Math.abs(v) < 1e-3) && x.slice(2720, 4000).some((v) => Math.abs(v) > 1e-3), `${ending}: the test's video`);
    near(lagMs(x, heard(out)), 0, 1, `${ending}: ms the new voice lags the old`);
    assert.equal(videoMd5(out), videoMd5(late), `${ending}: the picture's packets`);
    near(loudness(out).lufs, -14, 0.5, `${ending}: loudness`);
  }
});

test("a video with two audio streams: the line says which was taken and that the other is gone; --audio 2 takes the second, the only sound of the output", { skip }, async () => {
  // the first stream a quiet tone, the second the voice
  const two = file("tracks.mp4");
  run(["-f", "lavfi", "-i", "testsrc=s=160x120:r=25:d=14", "-f", "lavfi", "-i", "sine=f=220:d=14,volume=-30dB", "-i", base,
    "-map", "0:v", "-map", "1:a", "-map", "2:a", "-shortest", "-c:v", "mpeg4", "-c:a", "aac", two]);
  const r2 = await clean(two, file("tracks.2.mp4"), { audio: 2 }, stages);
  assert.deepEqual(r2.audio, { streams: 2, used: 2, dropped: 1 });
  const p = probe(file("tracks.2.mp4"));
  assert.equal(p.streams.filter((s) => s.codec_type === "audio").length, 1);
  near(loudness(file("tracks.2.mp4")).lufs, -14, 0.5, "the voice at the target");
  near(r2.measured.before.lufs, loudness(base).lufs, 1, "measured on the second stream");
  assert.ok(lines(r2).some((l) => /^\S*tracks\.mp4 has 2 audio streams: the second was taken for the voice and is the video's only sound now, the other is not in the output\.$/.test(l)), lines(r2).join("\n"));
  assert.equal(JSON.parse(fs.readFileSync(file("tracks.2.mp4.json"), "utf8")).settings.audio, 2);
  const c = cli("clean", "tracks.mp4", "tracks.2.m4a", "--audio", "2", "--json");
  assert.equal(c.status, 0, c.stdout);
  assert.deepEqual(JSON.parse(c.stdout).audio, { streams: 2, used: 2, dropped: 1 });
  // the voice first: taken without --audio, and the line names --audio
  const first = file("tracks-first.mp4");
  run(["-f", "lavfi", "-i", "testsrc=s=160x120:r=25:d=14", "-i", base, "-f", "lavfi", "-i", "sine=f=220:d=14,volume=-30dB",
    "-map", "0:v", "-map", "1:a", "-map", "2:a", "-shortest", "-c:v", "mpeg4", "-c:a", "aac", first]);
  const r3 = await clean(first, file("tracks-first.clean.mp4"), {}, stages);
  assert.ok(lines(r3).some((l) => /^\S*tracks-first\.mp4 has 2 audio streams: the first was taken for the voice and is the video's only sound now, the other is not in the output; --audio <n> names another as the voice\.$/.test(l)), lines(r3).join("\n"));
  // a refusal about the second stream names it, never the working copy
  const t = cli("clean", "tracks-first.mp4", "x.m4a", "--audio", "2");
  assert.equal(t.status, 1, t.stdout);
  assert.match(t.stdout.trim(), /tracks-first\.mp4's second audio stream/);
  assert.ok(!/voice-sound-clean|voice\.mka/.test(t.stdout), t.stdout);
});

test("a signal ends the running ffmpeg at once and leaves nothing: no output, no JSON, no comparison, no working folder", { skip }, async () => {
  // four minutes of voice, so that the run is still in its level stage when the signal comes
  const long = file("long.wav");
  run(["-stream_loop", "16", "-i", base, "-c:a", "pcm_s16le", long]);
  const childrenOf = (pid) => fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d)).filter((d) => {
    try { const s = fs.readFileSync(`/proc/${d}/stat`, "utf8"); return Number(s.slice(s.lastIndexOf(")") + 2).split(" ")[1]) === pid; } catch { return false; }
  });
  const alive = (k) => { try { return !/State:\s*Z/.test(fs.readFileSync(`/proc/${k}/status`, "utf8")); } catch { return false; } };
  for (const sig of ["SIGTERM", "SIGINT"]) {
    const p = spawn(process.execPath, [runner, "clean", "long.wav", "sig.m4a", "--before", "sig.before.m4a"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let said = "";
    p.stdout.on("data", (d) => { said += d; });
    const closed = new Promise((resolve) => p.on("close", (code, signal) => resolve({ code, signal })));
    // (the level stage's ffmpeg: a child of the run with a limiter in its chain)
    const t0 = Date.now();
    let kids = [];
    while (Date.now() - t0 < 60000 && !kids.length) {
      kids = childrenOf(p.pid).filter((k) => { try { return /alimiter/.test(fs.readFileSync(`/proc/${k}/cmdline`, "utf8")); } catch { return false; } });
      if (!kids.length) await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(kids.length, `${sig}: the level stage never began`);
    const sent = Date.now();
    p.kill(sig);
    const end = await closed;
    assert.ok(Date.now() - sent < 1500, `${sig}: ended ${Date.now() - sent} ms after the signal`);
    assert.equal(end.code, sig === "SIGINT" ? 130 : 143, `${sig}: ${JSON.stringify(end)} ${said}`);
    assert.equal(said, "", `${sig}: printed ${said}`);
    await new Promise((r) => setTimeout(r, 200));
    for (const k of kids) assert.ok(!alive(k), `${sig}: its ffmpeg ${k} still runs`);
    for (const f of ["sig.m4a", "sig.m4a.json", "sig.before.m4a"]) assert.ok(!fs.existsSync(file(f)), `${sig}: ${f} is there`);
    assert.deepEqual(fs.readdirSync(dir).filter((n) => n.startsWith(".voice-sound-clean-")), [], sig);
  }
});

test("what dead runs left is removed by the next run once it is older than a day, and only that", { skip }, async () => {
  const old = path.join(dir, ".voice-sound-clean-1-dead"), fresh = path.join(dir, ".voice-sound-clean-2-alive"), oldFile = path.join(dir, ".voice-sound-clean-1-dead-x.m4a");
  fs.mkdirSync(path.join(old, "inner"), { recursive: true });
  fs.writeFileSync(path.join(old, "mended.wav"), "x");
  fs.mkdirSync(fresh);
  fs.writeFileSync(oldFile, "x");
  const twoDays = (Date.now() - 2 * 24 * 3600 * 1000) / 1000;
  for (const p of [old, oldFile]) fs.utimesSync(p, twoDays, twoDays);
  // the older version's folder in the system's temp directory
  const tmpOld = fs.mkdtempSync(path.join(os.tmpdir(), "voice-sound-clean-"));
  fs.utimesSync(tmpOld, twoDays, twoDays);
  await clean(base, file("sweep.m4a"), {}, stages);
  assert.ok(!fs.existsSync(old) && !fs.existsSync(oldFile), "the dead run's folder and file");
  assert.ok(!fs.existsSync(tmpOld), "the older version's folder");
  assert.ok(fs.existsSync(fresh), "a folder younger than a day stays");
  fs.rmSync(fresh, { recursive: true });
});

test("the working files lie in a hidden folder beside the output, never in the system's temp directory, and are gone at the end", { skip }, async () => {
  const seen = [];
  const watching = { ...stages, async repair(f, o, m, opts) { seen.push(o); return stages.repair(f, o, m, opts); } };
  fs.mkdirSync(file("deep/er"), { recursive: true });
  await clean(base, file("deep/er/w.m4a"), {}, watching);
  assert.equal(path.dirname(path.dirname(seen[0])), file("deep/er"));
  assert.match(path.basename(path.dirname(seen[0])), /^\.voice-sound-clean-\d+-/);
  assert.deepEqual(fs.readdirSync(file("deep/er")).sort(), ["w.m4a", "w.m4a.json"]);
});

test("names that begin with a dash: read and written as files, the JSON beside", { skip }, () => {
  fs.copyFileSync(base, file("-dash.wav"));
  const r = cli("clean", "-dash.wav", "-out.m4a", "--before", "-before.m4a", "--json");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.source, "-dash.wav");
  assert.equal(j.output, "-out.m4a");
  for (const f of ["-out.m4a", "-out.m4a.json", "-before.m4a"]) assert.ok(fs.existsSync(file(f)), f);
  near(loudness(file("-out.m4a")).lufs, -14, 0.5, "loudness");
  // a video too
  fs.copyFileSync(video, file("-talk.mp4"));
  const v = cli("clean", "-talk.mp4", "-talk.clean.mp4", "--json");
  assert.equal(v.status, 0, v.stdout + v.stderr);
  assert.equal(videoMd5(file("-talk.clean.mp4")), videoMd5(video));
});
