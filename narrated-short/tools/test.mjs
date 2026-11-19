// The music's volume under the voice, on made-up sounds (tones and noise at different levels) and a
// made-up short built without captions; the faces: who a window holds, where it goes, the faces in
// the frame and a text on them, and a made-up short built with a faces file as `faces` writes it
// (captions and layout beside). No request, no key; build needs platform-zones beside.
//
//   node --test tools/test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loudness, musicVolume, distance, LOWEST, HIGHEST } from "./lib/level.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const zones = fs.existsSync(path.join(here, "..", "..", "platform-zones", "tools", "zones.mjs")) || process.env.PLATFORM_ZONES;
const near = (x, y, by) => assert.ok(Math.abs(x - y) <= by, `${x} is not within ${by} of ${y}`);
const run = (args) => { const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "narrated-short-test-"));

// a voice's line: a mono tone at `db`, with silence around it as a speech model leaves it
function line(file, hz, db, seconds = 2) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  run(["-f", "lavfi", "-i", `sine=frequency=${hz}:sample_rate=44100:duration=${seconds}`, "-af", `volume=${db}dB,adelay=300,apad=pad_dur=0.4`, "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k", file]);
  return file;
}
// a music bed: stereo pink noise at `db`
function bed(file, db, seconds = 8) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  run(["-f", "lavfi", "-i", `anoisesrc=color=pink:sample_rate=48000:duration=${seconds}:seed=3`, "-af", `volume=${db}dB`, "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k", file]);
  return file;
}
function plain(file) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
  return Number(r.stderr.slice(r.stderr.lastIndexOf("Summary:")).match(/I:\s+(-?[\d.]+) LUFS/)[1]);
}

test("the computed volume lays the music the asked distance under the voice, measured on the scaled music", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    const lines = [line(path.join(dir, "a.mp3"), 250, -10), line(path.join(dir, "b.mp3"), 600, -20)];
    const voiceFile = path.join(dir, "voice.wav");
    run([...lines.flatMap((f) => ["-i", f]), "-filter_complex", "[0:a]pan=stereo|c0=c0|c1=c0[x];[1:a]pan=stereo|c0=c0|c1=c0[y];[x][y]concat=n=2:v=0:a=1", voiceFile]);
    const voice = loudness(lines);
    near(voice, plain(voiceFile), 0.2);
    for (const [db, under] of [[-4, 17], [-28, 17], [-12, 20]]) {
      const music = bed(path.join(dir, `m${db}.mp3`), db);
      const fit = musicVolume(voice, loudness([music]), under);
      assert.equal(fit.bound, null);
      const scaled = path.join(dir, `s${db}.wav`);
      run(["-i", music, "-af", `volume=${fit.volume}`, scaled]);
      near(voice - plain(scaled), under, 0.5);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the volume stays within its bounds and says which one it hit", () => {
  const low = musicVolume(-30, -4, 17);
  assert.deepEqual([low.volume, low.bound], [LOWEST, "lowest"]);
  near(low.under, distance(-30, -4, LOWEST), 1e-9);
  const high = musicVolume(-14, -40, 17);
  assert.deepEqual([high.volume, high.bound], [HIGHEST, "highest"]);
  // two equally loud files: 0.14 for 17 LU, as launch-video's `music`
  near(musicVolume(-20, -20, 17).volume, 0.141, 0.001);
  assert.equal(loudness([]), null);
});

// a short of two lines (two tones) over a test picture, its clock set, ready to build
function short(dir) {
  const work = path.join(dir, "work"), comp = path.join(dir, "composition");
  fs.mkdirSync(work, { recursive: true });
  const ws = (from, n) => Array.from({ length: n }, (_, k) => ({ text: `w${k}`, start: +(from + k * 0.4).toFixed(2), end: +(from + k * 0.4 + 0.35).toFixed(2) }));
  line(path.join(comp, "assets", "voice", "s1.mp3"), 300, -2);
  line(path.join(comp, "assets", "voice", "s2.mp3"), 450, -6);
  fs.writeFileSync(path.join(work, "voice.json"), JSON.stringify({ model: "test", voice: "tone", lines: [
    { id: "s1", text: "one", file: "assets/voice/s1.mp3", duration: 2.7, words: ws(0.3, 5) },
    { id: "s2", text: "two", file: "assets/voice/s2.mp3", duration: 2.7, words: ws(0.3, 5) },
  ] }));
  const src = path.join(dir, "source.mp4");
  run(["-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=8", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", src]);
  const node = (args) => spawnSync(process.execPath, [path.join(here, "short.mjs"), ...args], { encoding: "utf8", cwd: dir });
  const ck = node(["clock", work]);
  assert.equal(ck.status, 0, ck.stdout + ck.stderr);
  const end = JSON.parse(fs.readFileSync(path.join(work, "clock.json"), "utf8")).end;
  fs.writeFileSync(path.join(work, "beats.json"), JSON.stringify({ credit: "Test footage", handle: "@test", hook: { text: "TWO TONES", key: "TONES" },
    beats: [{ id: "a", from: 0, to: 2.5, source: src, at: 0.5 }, { id: "b", from: 2.5, to: +(end + 0.7).toFixed(2), source: src, at: 3 }] }));
  return { work, comp, src, build: (...more) => node(["build", work, comp, "--no-captions", "--platform", "tiktok", ...more]),
    // with agentitos' captions beside, into a composition of its own (the voice's files copied there)
    withCaptions: (into, ...more) => {
      if (into !== comp) fs.cpSync(path.join(comp, "assets", "voice"), path.join(into, "assets", "voice"), { recursive: true });
      return node(["build", work, into, "--platform", "tiktok", ...more]);
    } };
}
// every file of a composition, by its path, for a comparison byte for byte
const filesOf = (dir) => Object.fromEntries(fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort().map((f) => [f, crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex")]));
const captionsHere = fs.existsSync(path.join(here, "..", "..", "captions", "tools", "captions.mjs"));
const musicTag = (comp) => fs.readFileSync(path.join(comp, "index.html"), "utf8").match(/<audio id="music"[^>]*>/)?.[0];

test("build: the music's volume and its lane lay it 17 LU under the voice, --under another distance, the summary says it", { skip: (!ffmpeg && "no ffmpeg") || (!zones && "no platform-zones beside") }, () => {
  const dir = tmp();
  try {
    const { comp, build } = short(dir);
    // no music yet
    let r = build();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /no music yet/);
    assert.equal(musicTag(comp), undefined);
    // music louder than the voice
    const music = bed(path.join(comp, "assets", "music.mp3"), -2);
    const voice = loudness([path.join(comp, "assets", "voice", "s1.mp3"), path.join(comp, "assets", "voice", "s2.mp3")]);
    for (const under of [17, 22]) {
      r = build(...(under === 17 ? [] : ["--under", String(under)]));
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const tag = musicTag(comp);
      const volume = Number(tag.match(/data-volume="([\d.]+)"/)[1]);
      assert.match(tag, new RegExp(`data-under-voice="${under}"`));
      // the lane holds the same volume until the last word
      const lane = JSON.parse(tag.match(/data-automation="([^"]*)"/)[1].replace(/&quot;/g, '"')).lanes[0].points;
      assert.deepEqual([lane[0].v, lane[1].v, lane[2].v], [volume, volume, 0]);
      const scaled = path.join(dir, "scaled.wav");
      run(["-i", music, "-af", `volume=${volume}`, scaled]);
      near(voice - plain(scaled), under, 0.5);
      assert.match(r.stdout, new RegExp(`music ${under}\\.\\d LU under the voice \\(at ${volume}; the voice at −[\\d.]+ LUFS, the music at −[\\d.]+\\)`));
    }
    // music so quiet that even the highest volume leaves it further under: said, and held there
    bed(music, -40);
    r = build();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(musicTag(comp), /data-volume="0.6"/);
    assert.match(r.stdout, /! the music would need [\d.]+ to lie 17 LU under the voice; at 0.6, the highest volume here, it lies [\d.]+ LU under it/);
    r = build("--under", "40");
    assert.equal(r.status, 1);
    assert.match(r.stdout, /--under is how many LU/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- faces
import { counted, planWindow, chinZoom, framed, textOn, partsOn, shown, bandOf } from "./lib/faces.mjs";
// a person over a beat: one box at every tenth of a second
const person = (who, box, n = 30) => Array.from({ length: n }, (_, k) => ({ t: +(k * 0.1).toFixed(1), box }));
const listOf = (...people) => {
  const by = new Map();
  for (const [who, moments] of people) for (const m of moments) { if (!by.has(m.t)) by.set(m.t, []); by.get(m.t).push({ who, box: m.box }); }
  return { step: 0.1, faces: [...by.entries()].sort((a, b) => a[0] - b[0]).map(([t, boxes]) => ({ t, boxes })) };
};

test("faces: who the window holds: not a face seen in under a quarter of the beat, not one under half the largest or a speck", () => {
  const l = listOf(["A", person("A", [2400, 400, 600, 800])], ["B", person("B", [600, 500, 260, 340])], ["C", person("C", [100, 400, 600, 800], 6)], ["D", person("D", [3000, 1500, 60, 80])]);
  const { held, small } = counted(l, [3840, 2160], 3);
  assert.deepEqual(held.map((p) => p.who), ["A"]);
  assert.deepEqual(small.map((p) => p.who).sort(), ["B", "C", "D"]);
});

test("faces: a fill from the middle that cuts a face off the middle moves to it; one that holds it stays; the agent's pan stands and is said", () => {
  const size = [3840, 2160];
  const a = counted(listOf(["A", person("A", [2700, 400, 500, 650])]), size, 3).held;
  const p = planWindow({ frame: "fill", size, held: a });
  assert.equal(p.changed, true);
  assert.match(p.said, /the crop moved to the faces \(A\)/);
  const win = shown({ frame: "fill", x: p.x, size });
  assert.ok(win[0] <= 2700 - 60 && win[1] >= 3200 + 60, `the window ${win} holds the face`);
  // in the middle: nothing changes
  const mid = planWindow({ frame: "fill", size, held: counted(listOf(["A", person("A", [1700, 400, 440, 600])]), size, 3).held });
  assert.equal(mid.changed, false);
  assert.match(mid.said, /in the picture as it is/);
  // the agent's pan: kept, and said that it cuts
  const own = planWindow({ frame: "fill", pan: 0, panSet: true, size, held: a });
  assert.equal(own.changed, false);
  assert.deepEqual(own.cut, ["A"]);
});

const cw = (held) => Math.floor((3840 / (Math.max(...held.flatMap((p) => p.boxes.map((b) => b[0] + 1.12 * b[2]))) - Math.min(...held.flatMap((p) => p.boxes.map((b) => b[0] - 0.12 * b[2]))))) * 100) / 100;
test("faces: two people wider apart than a fill's window: the whole picture as a band, as large as holds both; never larger than keeps their chins above the captions", () => {
  const size = [3840, 2160];
  const two = counted(listOf(["A", person("A", [500, 600, 500, 650])], ["B", person("B", [2600, 600, 500, 650])]), size, 3).held;
  const p = planWindow({ frame: "fill", size, held: two });
  assert.equal(p.frame, "whole");
  assert.ok(p.zoom > 1 && p.zoom < 1.8, `zoom ${p.zoom}`);
  const win = shown({ frame: "whole", zoom: p.zoom, pan: p.pan, size });
  assert.ok(win[0] <= 440 && win[1] >= 3160, `the band's window ${win} holds both`);
  // a close face, its chin low: the band stays whole-width, the chin above y 1238
  const close = counted(listOf(["M", person("M", [800, 300, 1400, 1450])]), size, 3).held;
  const c = planWindow({ frame: "fill", size, held: close, chinsAbove: 1238 });
  assert.equal(c.frame, "whole");
  assert.ok(c.zoom < cw(close), `zoom ${c.zoom}: smaller than the width alone allows`);
  // its chin and a twelfth of the face below it, in the band at that zoom, above the captions' top
  near(960 + (1750 - 1080) * (1080 * c.zoom / 3840) + 0.08 * 1450 * (1080 * c.zoom / 3840), 1238 - 24, 4);
  assert.equal(chinZoom(close, size, null), Infinity);
});

test("faces: the first beat's own 1.6x band moves to a face at its side, and becomes smaller where the face needs it; an agent's zoom stays", () => {
  const size = [1920, 1080];
  const side = counted(listOf(["A", person("A", [1500, 200, 250, 320])]), size, 3).held;
  const p = planWindow({ frame: "whole", zoom: 1.6, size, held: side });
  assert.equal(p.zoom, 1.6);
  assert.ok(p.pan > 0.9, `pan ${p.pan}`);
  const wide = counted(listOf(["A", person("A", [100, 200, 250, 320])], ["B", person("B", [1550, 200, 250, 320])]), size, 3).held;
  const q = planWindow({ frame: "whole", zoom: 1.6, size, held: wide });
  assert.ok(q.zoom < 1.6, `zoom ${q.zoom}`);
  const r = planWindow({ frame: "whole", zoom: 1.6, zoomSet: true, size, held: wide });
  assert.equal(r.zoom, 1.6);
  assert.deepEqual(r.cut.length > 0, true);
});

test("faces: in the frame on the film's clock (the source's second through speed, the slow move, a band cut to its height), and a text box on them by the part it reaches", () => {
  const size = [1280, 720];
  const l = listOf(["A", person("A", [540, 100, 200, 260], 20)]);
  // fill from the middle: k = 1920/720, the crop's left (3414 − 1080) / 2
  const m = framed({ list: l, place: { frame: "fill", size }, from: 4, seconds: 2, speed: 0.5 });
  assert.equal(m[0].t, 4);
  assert.equal(m.length, 10);   // the clip's two seconds take one of the source
  assert.equal(m[5].t, 5);
  near(m[0].step, 0.2, 1e-9);
  near(m[0].boxes[0].box[0], 540 * (1920 / 720) - (3414 - 1080) / 2, 1);
  near(m[0].boxes[0].box[1], 100 * (1920 / 720), 1);
  // a band at 1×: 1080 × 608 in the middle of the frame
  assert.deepEqual(bandOf({ zoom: 1, size }), [656, 1264]);
  const w = framed({ list: l, place: { frame: "whole", zoom: 1, size }, from: 0, seconds: 2, band: bandOf({ zoom: 1, size }) });
  near(w[0].boxes[0].box[1], 656 + 100 * 1080 / 1280, 1);
  // a text over the eyes, over the mouth, under the chin
  const face = [{ t: 0, step: 0.5, boxes: [{ who: "A", box: [300, 400, 400, 500] }] }];
  assert.equal(textOn([200, 500, 600, 100], face).nose, 0.5);
  assert.equal(textOn([200, 780, 600, 100], face).mouth, 0.5);
  assert.equal(textOn([200, 830, 600, 100], face).lip, 0.5);
  assert.equal(textOn([200, 880, 600, 100], face).chin, 0.5);
  assert.equal(textOn([200, 950, 600, 100], face).seconds, 0);
});

test("faces: a text on the hair or forehead is not on the eyes or nose (the review: a box ending 100 px above the eyes scored as the nose, weight 100); one reaching down into the eyes is", () => {
  // no feat: the eyes' top at 38 % of the box, y 590
  const face = [{ t: 0, step: 0.5, boxes: [{ who: "A", box: [300, 400, 400, 500] }] }];
  const above = textOn([200, 390, 600, 100], face);
  assert.deepEqual([above.hair, above.nose, above.seconds], [0.5, 0, 0.5]);
  assert.equal(above.cost, 0.25);
  assert.equal(textOn([200, 500, 600, 120], face).nose, 0.5);
  // the model's eyes, nose and mouth: a text from the head's top to 10 px above the eyes
  const feat = [{ t: 0, step: 0.1, boxes: [{ who: "Jeanette Epps", box: [540, 84, 210, 272], feat: [558, 180, 165, 140] }] }];
  assert.equal(textOn([100, 60, 900, 110], feat).hair, 0.1);
  assert.equal(textOn([100, 60, 900, 130], feat).nose, 0.1);
  // beside the features (an ear, the side of the head) is the hair's kind, not the eyes
  assert.deepEqual(partsOn([730, 190, 60, 50], [540, 84, 210, 272], [558, 180, 165, 140]), ["hair"]);
});

test("build with faces: a face off the middle moves the fill to it and the hook off it, each said; --no-faces and no faces build the same short; faces of another stretch are left out and said", { skip: (!ffmpeg && "no ffmpeg") || (!zones && "no platform-zones beside") || (!fs.existsSync(path.join(here, "..", "..", "layout", "tools", "place.mjs")) && "no layout beside") }, () => {
  const dir = tmp();
  try {
    const { work, comp, build } = short(dir);
    const beatsFile = path.join(work, "beats.json"), cfg = JSON.parse(fs.readFileSync(beatsFile, "utf8"));
    cfg.beats[0].frame = "fill"; cfg.beats[0].people = true;
    fs.writeFileSync(beatsFile, JSON.stringify(cfg));
    let r = build();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const plain = fs.readFileSync(path.join(comp, "index.html"), "utf8"), clip = fs.readFileSync(path.join(comp, "assets", "clips", "a.mp4"));
    // the faces as `faces` writes them: a face high up and at the right of the 1280×720 source
    const src = cfg.beats[0].source, st = fs.statSync(src), taken = 2.5;
    fs.mkdirSync(path.join(work, "faces"), { recursive: true });
    const key = JSON.stringify({ file: src, stamp: `${st.size}:${Math.round(st.mtimeMs)}`, at: 0.5, taken });
    const faces = (k) => ({ key: k, source: [1280, 720], step: 0.1, taken, faces: listOf(["A", person("A", [1000, 40, 200, 260], 25)]).faces });
    fs.writeFileSync(path.join(work, "faces", "a.json"), JSON.stringify(faces(key)));
    r = build();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /a: the crop moved to the faces \(A\)/);
    assert.match(r.stdout, /the hook: it lay on a face in a/);
    assert.match(JSON.parse(fs.readFileSync(path.join(comp, "assets", "clips", "a.json"), "utf8")).how, /"x":\d+/);
    assert.match(fs.readFileSync(path.join(comp, "index.html"), "utf8"), /<div id="hook-in" class="hook" style="font-size: \d+px; left: \d+px; width: \d+px; top: \d+px;">/);
    // skipped: the short as without faces, byte for byte
    r = build("--no-faces");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(fs.readFileSync(path.join(comp, "index.html"), "utf8"), plain);
    assert.ok(fs.readFileSync(path.join(comp, "assets", "clips", "a.mp4")).equals(clip));
    // faces of another stretch: left out, said
    fs.writeFileSync(path.join(work, "faces", "a.json"), JSON.stringify(faces(key.replace('"at":0.5', '"at":1'))));
    r = build();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /the faces of a are of another stretch/);
    assert.equal(fs.readFileSync(path.join(comp, "index.html"), "utf8"), plain);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("faces: no beat marked people sends nothing and says so", { skip: !ffmpeg && "no ffmpeg" }, () => {
  const dir = tmp();
  try {
    const { work } = short(dir);
    const r = spawnSync(process.execPath, [path.join(here, "short.mjs"), "faces", work], { encoding: "utf8", cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /No beat is marked "people": true .*nothing sent/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("faces through a stand-in frame tool: the last beat's stretch is the one build takes (to the film's end, past the \"to\" written), its faces in px of the source, and build uses them", { skip: (!ffmpeg && "no ffmpeg") || (!zones && "no platform-zones beside") }, () => {
  const dir = tmp();
  try {
    const { work, comp, build } = short(dir);
    const beatsFile = path.join(work, "beats.json"), cfg = JSON.parse(fs.readFileSync(beatsFile, "utf8"));
    const end = JSON.parse(fs.readFileSync(path.join(work, "clock.json"), "utf8")).end;
    cfg.beats[1].to = +end.toFixed(2); cfg.beats[1].people = true;   // build stretches it 0.7 s past the last word
    fs.writeFileSync(beatsFile, JSON.stringify(cfg));
    // the stand-in: a face at the right of whatever stretch it is given, every tenth of its seconds
    const fake = path.join(dir, "frame.mjs");
    fs.writeFileSync(fake, `import fs from "node:fs"; import { spawnSync } from "node:child_process";
const a = process.argv.slice(2), out = a[a.indexOf("--faces") + 1];
if (!a.includes("--every-shot")) process.exit(2);
const p = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height:format=duration", "-of", "json", a[0]], { encoding: "utf8" }).stdout);
const [w, h] = [p.streams[0].width, p.streams[0].height], d = Number(p.format.duration);
const faces = []; for (let t = 0; t < d - 0.05; t += 0.1) faces.push({ t: +t.toFixed(1), boxes: [{ who: "A", box: [Math.round(w * 0.78), Math.round(h * 0.05), Math.round(w * 0.15), Math.round(h * 0.35)] }] });
fs.writeFileSync(out, JSON.stringify({ size: [w, h], step: 0.1, by: "model", cost: 0.001, shots: [{ start: 0, end: d, kind: "broll" }], faces }));`);
    const env = { ...process.env, FRAME_TOOL: fake };
    let r = spawnSync(process.execPath, [path.join(here, "short.mjs"), "faces", work], { encoding: "utf8", cwd: dir, env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /b: 1 person \(A\)/);
    const list = JSON.parse(fs.readFileSync(path.join(work, "faces", "b.json"), "utf8"));
    near(list.taken, end + 0.7 - 2.5, 0.02);
    assert.deepEqual(list.source, [1280, 720]);
    near(list.faces[0].boxes[0].box[0], 0.78 * 1280, 2);
    // kept: nothing sent again
    r = spawnSync(process.execPath, [path.join(here, "short.mjs"), "faces", work], { encoding: "utf8", cwd: dir, env });
    assert.match(r.stdout, /kept from before, nothing spent/);
    cfg.beats[1].frame = "fill";
    fs.writeFileSync(beatsFile, JSON.stringify(cfg));
    r = build();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /another stretch/);
    assert.match(r.stdout, /b: the crop moved to the faces \(A\): from the middle it cut it/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The review's beat b7 (a video call, 1280×720): two faces far apart, one high, one low; built as a
// fill they need a band, whose zoom the captions' top limits.
test("build with faces: a first build and a rebuild are the same byte for byte, also where an earlier build without faces left its captions' area (the review's b7)", { skip: (!ffmpeg && "no ffmpeg") || (!zones && "no platform-zones beside") || (!captionsHere && "no captions beside") || (!fs.existsSync(path.join(here, "..", "..", "layout", "tools", "place.mjs")) && "no layout beside") }, () => {
  const dir = tmp();
  try {
    const { work, comp, src, withCaptions } = short(dir);
    const beatsFile = path.join(work, "beats.json"), cfg = JSON.parse(fs.readFileSync(beatsFile, "utf8"));
    cfg.beats[0].frame = "fill"; cfg.beats[0].people = true;
    fs.writeFileSync(beatsFile, JSON.stringify(cfg));
    // a build without faces first, in a composition of its own: its captions' area stays there
    const old = path.join(dir, "old");
    let r = withCaptions(old);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const st = fs.statSync(src), taken = 2.5;
    const key = JSON.stringify({ file: src, stamp: `${st.size}:${Math.round(st.mtimeMs)}`, at: 0.5, taken });
    fs.mkdirSync(path.join(work, "faces"), { recursive: true });
    fs.writeFileSync(path.join(work, "faces", "a.json"), JSON.stringify({ key, source: [1280, 720], step: 0.1, taken,
      faces: listOf(["Man with beard and glasses", person("M", [1009, 70, 139, 171], 25)], ["CM S Ingram", person("I", [564, 420, 135, 165], 25)]).faces }));
    r = withCaptions(comp);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const first = filesOf(comp), said = r.stdout.split("\n").filter((l) => /^ {2}(a|the captions|the hook)\b/.test(l));
    r = withCaptions(comp);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(filesOf(comp), first, "a rebuild with nothing changed writes what the first build wrote");
    assert.deepEqual(r.stdout.split("\n").filter((l) => /^ {2}(a|the captions|the hook)\b/.test(l)), said);
    r = withCaptions(old);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const a = filesOf(old);
    for (const f of Object.keys(first)) if (!f.startsWith("assets/voice")) assert.equal(a[f], first[f], `${f}: as the first build wrote it`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
