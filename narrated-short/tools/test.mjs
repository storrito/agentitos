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
import { spawnSync, spawn } from "node:child_process";
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

test("build: the music's volume times its lane lays it 17 LU under the voice, --under another distance, the summary says it", { skip: (!ffmpeg && "no ffmpeg") || (!zones && "no platform-zones beside") }, () => {
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
      // HyperFrames plays the music at the track's volume × its lane: that product lies `under` LU
      // under the voice from the start to the last word, and is 0 at the end (the lane holding the
      // volume a second time played it at volume², about 19 dB too low: 2026-11-19)
      const lane = JSON.parse(tag.match(/data-automation="([^"]*)"/)[1].replace(/&quot;/g, '"')).lanes[0].points;
      assert.equal(lane.length, 3);
      assert.equal(lane[0].t, 0);
      assert.ok(lane[1].t > lane[0].t && lane[2].t > lane[1].t, JSON.stringify(lane));
      for (const p of lane.slice(0, 2)) {
        const scaled = path.join(dir, "scaled.wav");
        run(["-i", music, "-af", `volume=${volume * p.v}`, scaled]);
        near(voice - plain(scaled), under, 0.5);
      }
      assert.equal(volume * lane[2].v, 0);
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
import { counted, planWindow, noseZoom, framed, onOf, shown, bandOf, sane, looking, talksIn } from "./lib/faces.mjs";
// What a text lies on is agentitos' layout's measure, run as build runs it: the moments (faces in the
// frame on the film's clock, as framed gives them) as one shot, the box measured where it stands
const layoutTool = path.join(here, "..", "..", "layout", "tools", "place.mjs"), layoutHere = fs.existsSync(layoutTool);
function measured(box, moments, start, end) {
  const dir = tmp();
  try {
    const tracks = new Map();
    for (const m of moments) for (const f of m.boxes) {
      if (!tracks.has(f.who)) tracks.set(f.who, { who: f.who, track: [] });
      tracks.get(f.who).track.push({ t: m.t, box: f.box, ...(f.feat ? { feat: f.feat } : {}) });
    }
    const ts = moments.map((m) => m.t), step = moments[0]?.step || 0.1;
    fs.writeFileSync(path.join(dir, "shots.json"), JSON.stringify({ shots: [{ start: Math.min(...ts), end: Math.max(...ts) + step, faces: [...tracks.values()], room: null }] }));
    fs.writeFileSync(path.join(dir, "boxes.json"), JSON.stringify([{ name: "t", box, ...(start != null ? { start } : {}), ...(end != null ? { end } : {}) }]));
    const r = spawnSync(process.execPath, [layoutTool, "text", dir, "--frame", "1080x1920", "--shots", path.join(dir, "shots.json"), "--measure", path.join(dir, "boxes.json")], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(fs.readFileSync(path.join(dir, "measure.json"), "utf8")).boxes[0];
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
// a person over a beat: one box at every tenth of a second
const person = (who, box, n = 30) => Array.from({ length: n }, (_, k) => ({ t: +(k * 0.1).toFixed(1), box }));
const listOf = (...people) => {
  const by = new Map();
  for (const [who, moments] of people) for (const m of moments) { if (!by.has(m.t)) by.set(m.t, []); by.get(m.t).push({ who, box: m.box }); }
  return { step: 0.1, faces: [...by.entries()].sort((a, b) => a[0] - b[0]).map(([t, boxes]) => ({ t, boxes })) };
};

test("faces: who the picture shows: not a face seen in under a quarter of the beat, not one of another size than the main face's or a speck", () => {
  const l = listOf(["A", person("A", [2400, 400, 600, 800])], ["B", person("B", [600, 500, 260, 340])], ["C", person("C", [100, 400, 600, 800], 6)], ["D", person("D", [3000, 1500, 60, 80])], ["E", person("E", [1200, 400, 450, 600])]);
  const { main, held, small } = counted(l, [3840, 2160], 3);
  assert.equal(main.who, "A");
  assert.deepEqual(held.map((p) => p.who), ["A", "E"]);
  assert.deepEqual(small.map((p) => p.who).sort(), ["B", "C", "D"]);
});

test("faces: a fill from the middle that cuts a face off the middle moves to it; one that holds it stays; the agent's pan stands and is said", () => {
  const size = [3840, 2160];
  const a = counted(listOf(["A", person("A", [2700, 400, 500, 650])]), size, 3);
  const p = planWindow({ frame: "fill", size, people: a });
  assert.equal(p.changed, true);
  assert.match(p.said, /the crop moved to the faces \(A\)/);
  const win = shown({ frame: "fill", x: p.x, size });
  assert.ok(win[0] <= 2700 - 60 && win[1] >= 3200 + 60, `the window ${win} holds the face`);
  // in the middle: nothing changes
  const mid = planWindow({ frame: "fill", size, people: counted(listOf(["A", person("A", [1700, 400, 440, 600])]), size, 3) });
  assert.equal(mid.changed, false);
  assert.match(mid.said, /in the picture as it is/);
  // the agent's pan: kept, and said that it cuts
  const own = planWindow({ frame: "fill", pan: 0, panSet: true, size, people: a });
  assert.equal(own.changed, false);
  assert.deepEqual(own.cut, ["A"]);
});

test("faces: two people wider apart than a fill's window and than a crop: the whole picture as a band, as large as holds both; never larger than keeps their eyes and noses above the captions", () => {
  const size = [3840, 2160];
  const two = counted(listOf(["A", person("A", [500, 600, 500, 650])], ["B", person("B", [2600, 600, 500, 650])]), size, 3);
  const p = planWindow({ frame: "fill", size, people: two });
  assert.equal(p.frame, "whole");
  assert.ok(p.zoom > 1 && p.zoom < 1.8, `zoom ${p.zoom}`);
  const win = shown({ frame: "whole", zoom: p.zoom, pan: p.pan, size });
  assert.ok(win[0] <= 440 && win[1] >= 3160, `the band's window ${win} holds both`);
  // the same two, low in the picture: the band only as large as keeps their noses (and 24 px) above y 1238
  const low = counted(listOf(["A", person("A", [500, 1300, 500, 650])], ["B", person("B", [2600, 1300, 500, 650])]), size, 3);
  const c = planWindow({ frame: "fill", size, people: low, captions: [180, 1238, 720, 202] });
  assert.equal(c.frame, "whole");
  assert.ok(c.zoom < p.zoom, `zoom ${c.zoom}: smaller than the width alone allows`);
  const nose = 1300 + (0.38 + 0.7 * 0.48) * 650;
  near(960 + (nose - 1080) * (1080 * c.zoom / 3840) * 1.04 + 24, 1238, 4);
  assert.equal(noseZoom(low.held, size, null), Infinity);
});

test("faces: the first beat's own 1.6x band moves to a face at its side, and becomes smaller where the face needs it; an agent's zoom stays", () => {
  const size = [1920, 1080];
  const side = counted(listOf(["A", person("A", [1500, 200, 250, 320])]), size, 3);
  const p = planWindow({ frame: "whole", zoom: 1.6, size, people: side });
  assert.equal(p.zoom, 1.6);
  assert.ok(p.pan > 0.9, `pan ${p.pan}`);
  const wide = counted(listOf(["A", person("A", [100, 200, 250, 320])], ["B", person("B", [1550, 200, 250, 320])]), size, 3);
  const q = planWindow({ frame: "whole", zoom: 1.6, size, people: wide });
  assert.ok(q.zoom < 1.6, `zoom ${q.zoom}`);
  const r = planWindow({ frame: "whole", zoom: 1.6, zoomSet: true, size, people: wide });
  assert.equal(r.zoom, 1.6);
  assert.deepEqual(r.cut.length > 0, true);
});

// the review's and the author's beats, their faces as `faces` found them (medians, px of the source)
const moving = (from, to, n = 28) => Array.from({ length: n }, (_, k) => ({ t: +(k * 0.1).toFixed(1), box: from.box.map((v, j) => Math.round(v + ((to.box[j] - v) * k) / (n - 1))), feat: from.feat.map((v, j) => Math.round(v + ((to.feat[j] - v) * k) / (n - 1))) }));
const listWith = (...people) => {
  const by = new Map();
  for (const [who, moments] of people) for (const m of moments) { if (!by.has(m.t)) by.set(m.t, []); by.get(m.t).push({ who, box: m.box, ...(m.feat ? { feat: m.feat } : {}), ...(m.looks ? { looks: m.looks } : {}) }); }
  return { step: 0.1, faces: [...by.entries()].sort((a, b) => a[0] - b[0]).map(([t, boxes]) => ({ t, boxes })) };
};
const CAPTIONS = [180, 1238, 720, 202];   // captions' area for TikTok, hormozi, two lines of 96 px
test("faces: the picture gives way in its order: a fill on the main face's eyes, nose and mouth (the review's b3, the author's crew4 b3), a crop placed high (the review's b7), a band last (crew4 b5)", () => {
  // the review's b3, a panel (1280×720): the speaker, and a blurred woman at a laptop 53 % as tall behind him
  const b3 = counted(listOf(["grey-haired man", person("M", [610, 143, 234, 240], 14)], ["woman at laptop", person("W", [274, 14, 96, 127], 14)]), [1280, 720], 1.44);
  assert.deepEqual(b3.held.map((p) => p.who), ["grey-haired man"]);
  const p3 = planWindow({ frame: "fill", size: [1280, 720], people: b3, captions: CAPTIONS, crop: () => assert.fail("no crop where the fill shows him") });
  assert.deepEqual([p3.frame, p3.changed], ["fill", false]);
  assert.match(p3.said, /the faces \(grey-haired man\) are in the picture as it is; an ear cut; a face in the background cut \(woman at laptop\)/);
  // the author's crew4 b3: a masked man in close-up, 34 % of the width, moving left: the fill on his eyes, nose and mouth
  const masked = counted(listWith(["man in black polo wearing mask", moving({ box: [1124, 386, 1264, 1296], feat: [1350, 880, 808, 622] }, { box: [862, 392, 1354, 1476], feat: [1106, 954, 868, 708] })]), [3840, 2160], 2.76);
  // (his nose, low in the picture, would lie under the captions: the fill is raised a little, at its size)
  const pm = planWindow({ frame: "fill", size: [3840, 2160], people: masked, captions: CAPTIONS });
  assert.match(pm.said, /the crop moved to the faces \(man in black polo wearing mask\): from the middle it cut it; close-up kept, an ear cut; raised \d+ px/);
  assert.equal(pm.frame, "crop");
  near(pm.box.at[2] / pm.box.src[2], 1920 / 2160, 0.01);
  assert.ok(1920 - pm.box.at[3] < 200, `raised ${1920 - pm.box.at[3]} px`);
  const wm = shown({ ...pm, size: [3840, 2160] });
  assert.ok(wm[0] <= 1106 && wm[1] >= 2158, `the fill ${wm} shows his eyes, nose and mouth`);
  // without captions it stays a fill
  assert.equal(planWindow({ frame: "fill", size: [3840, 2160], people: masked }).frame, "fill");
  // the review's b7, a video call: two faces far apart; layout's 1:1 crop (its candidate as place gave it)
  const b7 = counted(listOf(["Man with beard and glasses", person("M", [1009, 70, 139, 171], 17)], ["CM S Ingram", person("I", [564, 420, 135, 165], 17)]), [1280, 720], 1.73);
  const square = { fit: "crop", crop: "1:1", scale: 1.5, left: -804, top: 101.9, window: [0, 101.9, 1080, 1080] };
  const p7 = planWindow({ frame: "fill", size: [1280, 720], people: b7, captions: CAPTIONS, crop: () => square });
  assert.equal(p7.frame, "crop");
  assert.deepEqual(p7.box, { src: [536, 0, 720, 720], at: [0, 102, 1080, 1080] });
  assert.match(p7.said, /a 1:1 crop placed high instead/);
  // without layout: the band
  assert.equal(planWindow({ frame: "fill", size: [1280, 720], people: b7, captions: CAPTIONS }).frame, "whole");
  // the author's crew4 b5: two women side by side, the smaller 78 % as tall: both count; no crop holds them: the band
  const b5 = counted(listOf(["woman with short grey hair", person("G", [800, 990, 1022, 970], 32)], ["woman with short curly hair", person("C", [2300, 394, 856, 756], 32)]), [3840, 2160], 3.17);
  assert.equal(b5.held.length, 2);
  const p5 = planWindow({ frame: "fill", size: [3840, 2160], people: b5, captions: CAPTIONS, crop: () => null });
  assert.equal(p5.frame, "whole");
  assert.equal(p5.flag, true);
  assert.match(p5.said, /the whole picture as a band, [\d.]+ times larger, their eyes above the captions; \d+ % of the frame blurred ground, the faces \d+ and \d+ px; to show them larger: a "pan" on the one the words are about \(it cuts the other\), or another stretch where they stand closer$/);
});

test("faces: a passer-by counts by the time he is there (crew4 b5: a man seen in a quarter of the beat widened the band of two women); a second person there for most of the beat still counts", () => {
  const size = [3840, 2160];
  const women = [["woman with short grey hair", person("G", [480, 962, 1428, 1004], 32)], ["woman with short curly hair", person("C", [1620, 302, 1752, 1016], 32)]];
  const passer = (n) => ["man in black jacket", person("P", [2700, 300, 1100, 1142], n)];
  const b5 = counted(listOf(...women, passer(8)), size, 3.17);
  assert.deepEqual(b5.held.map((p) => p.who), women.map((w) => w[0]));
  assert.deepEqual(b5.small.map((p) => [p.who, p.why]), [["man in black jacket", "passing"]]);
  const p = planWindow({ frame: "fill", size, people: b5, captions: CAPTIONS, crop: () => null });
  assert.equal(p.frame, "whole");
  assert.match(p.said, /a fill would cut woman with short grey hair, woman with short curly hair .*; a passer-by not held \(man in black jacket\)$/);
  // the same man there for most of the beat counts, and the band must hold him: smaller
  const stays = counted(listOf(...women, passer(30)), size, 3.17);
  assert.equal(stays.held.length, 3);
  const q = planWindow({ frame: "fill", size, people: stays, captions: CAPTIONS, crop: () => null });
  assert.ok(q.zoom < p.zoom, `${q.zoom} with him, ${p.zoom} without`);
  assert.doesNotMatch(q.said, /passer-by/);
});

test("faces: one who enters late and stays to the beat's end counts (the review's h1: a woman seen from a cut 1.7 s in, 43 % of the beat); a passer-by gone again, one there only for the last half second, or one who leaves before the end does not", () => {
  const size = [3840, 2160], seconds = 2.83;
  const from = (t0, t1, box) => Array.from({ length: Math.round((t1 - t0) / 0.1) + 1 }, (_, k) => ({ t: +(t0 + k * 0.1).toFixed(3), box }));
  const main = ["Samantha Cristoforetti", from(0, 2.8, [1500, 500, 380, 488])];
  const late = (who, t0, t1, h = 488) => [who, from(t0, t1, [2600, 520, 300, h])];
  const of = (...ps) => counted(listOf(...ps), size, seconds);
  // the review's h1 as tall as the main face: held, though seen in 43 % of the moments
  const h1 = of(main, late("Jessica Watkins", 1.718, 2.818));
  assert.deepEqual(h1.held.map((p) => p.who), ["Samantha Cristoforetti", "Jessica Watkins"]);
  // as she is (62 % as tall): not held, and not for her time: beside them, too small
  assert.deepEqual(of(main, late("Jessica Watkins", 1.718, 2.818, 304)).small.map((p) => [p.who, p.why]), [["Jessica Watkins", "side"]]);
  // crew4 b5's passer-by (the first 0.7 s), one in the last half second, one who leaves at 2.3 s after 43 %: passers-by
  for (const [t0, t1] of [[0, 0.7], [2.3, 2.8], [1.1, 2.3]]) assert.deepEqual(of(main, late("X", t0, t1)).small.map((p) => [p.who, p.why]), [["X", "passing"]], `${t0}–${t1}`);
  // one who stays to the end with a break of half a second in it: from the break on, too short
  assert.deepEqual(of(main, ["X", [...from(1.2, 1.9, [2600, 520, 300, 488]), ...from(2.4, 2.8, [2600, 520, 300, 488])]]).small.map((p) => p.why), ["passing"]);
});

test("faces: a face cut beside the ones that count is said as such, with what shows it (a pan that holds it with them, else \"frame\": \"whole\"), \"in the background\" only one small against the main face (the review's b9: four walking side by side, the fourth called a face in the background)", () => {
  const size = [3840, 2160];
  const b9 = counted(listOf(["woman with curly hair", person("A", [1482, 800, 270, 288], 17)], ["woman with short hair", person("B", [1858, 780, 300, 330], 17)],
    ["tall man", person("C", [2380, 820, 260, 234], 17)], ["man on the right", person("D", [3090, 830, 230, 220], 17)]), size, 1.69);
  assert.deepEqual(b9.small.map((p) => [p.who, p.why]), [["man on the right", "side"]]);
  const p = planWindow({ frame: "fill", size, people: b9 });
  assert.equal(p.frame, "fill");
  assert.match(p.said, /the crop moved to the faces \(woman with curly hair, woman with short hair, tall man\).*; the 3 faces that count held, the one at the side cut \(man on the right: 67 % as tall as the largest, too small to count; to show it: "frame": "whole" keeps everyone, a "pan" towards the right cuts another\)/);
  assert.doesNotMatch(p.said, /background/);
  // the fourth closer to them, so that one fill holds all four: the pan that does, which shows him with them
  const near4 = counted(listOf(["A", person("A", [1500, 800, 270, 288], 17)], ["B", person("B", [1800, 780, 300, 330], 17)], ["D", person("D", [2450, 830, 230, 220], 17)]), size, 1.69);
  const q = planWindow({ frame: "fill", size, people: near4 });
  const pan = Number(q.said.match(/to show it: "pan": ([\d.]+) holds it with them, "frame": "whole" keeps everyone\)/)?.[1]);
  assert.ok(pan > 0.5 && pan < 0.7, q.said);
  const win = shown({ frame: "fill", pan, size });
  assert.ok(win[0] <= 1500 + 0.18 * 270 && win[1] >= 2450 + 0.82 * 230, `the pan's window ${win} holds all four`);
  const own = planWindow({ frame: "fill", pan, panSet: true, size, people: near4 });
  assert.deepEqual(own.cut, []);
  // the same man half as tall as the largest, behind them: in the background
  const far = counted(listOf(["woman with short hair", person("B", [1858, 780, 300, 330], 17)], ["man on the right", person("D", [3090, 830, 150, 160], 17)]), size, 1.69);
  assert.match(planWindow({ frame: "fill", size, people: far }).said, /a face in the background cut \(man on the right\)/);
});

test("faces: a fill whose eyes would lie under the captions is raised over the ground, at the same size (the review's b7, CM S Ingram alone)", () => {
  const low = counted(listOf(["CM S Ingram", person("I", [564, 420, 135, 165], 17)]), [1280, 720], 1.73);
  const p = planWindow({ frame: "fill", size: [1280, 720], people: low, captions: CAPTIONS });
  assert.equal(p.frame, "crop");
  const [, , , h] = p.box.at;
  near(p.box.at[2] / p.box.src[2], 1920 / 720, 0.02);   // the fill's scale
  assert.match(p.said, /raised (\d+) px, so that the captions lie on no eyes or nose/);
  const lift = 1920 - h, nose = 420 + (0.38 + 0.7 * 0.48) * 165;
  assert.ok(960 + (nose * 1920 / 720 - lift - 960) * 1.04 + 24 <= 1238 + 2, `lifted ${lift}`);
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
});

test("faces: what a text lies on is layout's answer, weighed by this skill's rules: the worst part of a moment counts, by the beats and the seconds asked; the mouth or lower lip of who talks into the camera in its beat is as hard as the eyes, the same person's in another beat is not", () => {
  const m = (t, shot, ...on) => ({ t, dt: 0.5, shot, on: on.map(([who, part]) => ({ who, part })) });
  const answer = { moments: [m(0, 0, ["A", "chin"], ["B", "nose"]), m(0.5, 0, ["A", "hair"]), m(1, 1, ["A", "lip"]), m(1.5, 1, ["A", "mouth"], ["B", "chin"])] };
  const all = onOf(answer);
  assert.deepEqual([all.seconds, all.nose, all.hair, all.lip, all.mouth, all.chin, all.talk, all.hard], [2, 0.5, 0.5, 0.5, 0.5, 0, 0, 0.5]);
  assert.equal(all.cost, 50 + 0.25 + 0.5 + 1);
  assert.deepEqual([onOf(answer, { shots: [1] }).seconds, onOf(answer, { from: 0.5, to: 1.5 }).seconds], [1, 1]);
  const talking = onOf(answer, { talks: { 1: "A" } });
  assert.deepEqual([talking.talk, talking.lip, talking.mouth, talking.hard], [1, 0, 0, 1.5]);
  assert.equal(onOf(answer, { talks: { 0: "A" } }).talk, 0);
  // no answer: on nothing
  assert.equal(onOf(null).seconds, 0);
});

test("faces: layout's measure as build reads it: the eyes, the mouth, the lower lip, the chin of a head known by its box; the hair or forehead above the model's eyes is not the eyes, a text reaching down into them is", { skip: !layoutHere && "no layout beside" }, () => {
  const face = [{ t: 0, step: 0.5, boxes: [{ who: "A", box: [300, 400, 400, 500] }] }];
  assert.equal(onOf(measured([200, 600, 600, 100], face)).nose, 0.5);
  assert.equal(onOf(measured([200, 780, 600, 50], face)).mouth, 0.5);
  assert.equal(onOf(measured([200, 830, 600, 100], face)).lip, 0.5);
  assert.equal(onOf(measured([200, 880, 600, 100], face)).chin, 0.5);
  assert.equal(onOf(measured([200, 950, 600, 100], face)).seconds, 0);
  const feat = [{ t: 0, step: 0.1, boxes: [{ who: "Jeanette Epps", box: [540, 84, 210, 272], feat: [558, 180, 165, 140] }] }];
  const above = onOf(measured([100, 60, 900, 110], feat));
  assert.deepEqual([above.hair, above.nose, above.cost], [0.1, 0, 0.05]);
  assert.equal(onOf(measured([100, 60, 900, 130], feat)).nose, 0.1);
});

test("faces: a head known by its box alone: its eyes begin 15 % down it and may begin from 6 % (layout's border, decided: measure-box-only), not at 38 % as narrated-short's own copy had it; captions whose top is at a quarter of it lie on the eyes, and the seconds say that its eyes are not known", { skip: !layoutHere && "no layout beside" }, () => {
  const head = [{ t: 0, step: 0.5, boxes: [{ who: "A", box: [300, 400, 400, 500] }] }];
  const quarter = onOf(measured([200, 525, 600, 100], head));
  assert.deepEqual([quarter.nose, quarter.hair, quarter.unknown, quarter.hard], [0.5, 0, 0.5, 0.5]);
  // above 15 % the forehead, from 6 % on where the eyes may begin
  const brow = onOf(measured([200, 440, 600, 30], head));
  assert.deepEqual([brow.hair, brow.maybe, brow.nose], [0.5, 0.5, 0]);
});

test("faces: text beside the eyes, nose and mouth (an ear, the side of the head) is the hair's kind, not the eyes, as before the measure was layout's (the review: a head x 800–1100, its features 860–1040, captions ending at x 840 at eye height were 'nose')", { skip: !layoutHere && "no layout beside" }, () => {
  const head = [{ t: 0, step: 0.5, boxes: [{ who: "A", box: [800, 400, 300, 400], feat: [860, 520, 180, 220] }] }];
  const side = measured([0, 560, 840, 80], head);
  assert.deepEqual([side.moments[0].on[0].part, side.moments[0].on[0].beside], ["nose", true]);
  const o = onOf(side);
  assert.deepEqual([o.hair, o.nose, o.hard], [0.5, 0, 0]);
  // across the features: the eyes
  assert.equal(onOf(measured([0, 560, 870, 80], head)).nose, 0.5);
  // beside the mouth of one who talks into the camera: the hair too, not the talking mouth
  assert.equal(onOf(measured([0, 690, 840, 40], head), { talks: { 0: "A" } }).hard, 0);
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
    fs.writeFileSync(path.join(work, "faces", "a.json"), JSON.stringify({ ...faces(key), faces: listOf(["A", person("A", [1000, 0, 200, 260], 25)]).faces }));
    r = build();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /a: the crop moved to the faces \(A\)/);
    assert.match(r.stdout, /the hook: it reached the eyes in a \(the eyes or nose [\d.]+ s.*\), at every size; below the chin instead/);
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
    // (since the picture gives way in its order: a 1:1 crop placed high, by layout's place)
    assert.match(r.stdout, /a: a fill would cut .*: a 1:1 crop placed high instead/);
    assert.match(JSON.parse(fs.readFileSync(path.join(comp, "assets", "clips", "a.json"), "utf8")).how, /"frame":"crop"/);
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

test("faces: a box that cannot be a face is left out (the review's stand-in answers: no size, turned inside out, larger than the picture); a face partly past the edge stays", () => {
  const list = { faces: [0, 0.1].map((t) => ({ t, boxes: [{ who: "zero", box: [100, 100, 0, 0] }, { who: "neg", box: [900, 300, -200, -100] }, { who: "giant", box: [-5000, -5000, 99999, 99999] },
    { who: "whole", box: [0, 0, 1280, 720] }, { who: "edge", box: [1180, 100, 160, 200] }, { who: "A", box: [500, 100, 200, 260] }] })) };
  const { list: kept, dropped } = sane(list, [1280, 720]);
  assert.deepEqual(kept.faces[0].boxes.map((b) => b.who), ["edge", "A"]);
  assert.deepEqual([...dropped.entries()], [["zero", 2], ["neg", 2], ["giant", 2], ["whole", 2]]);
});

// the faces file `faces` writes for beat a of the test short (1280×720, a stretch of 2.5 s)
const facesFile = (work, src, ...people) => {
  const st = fs.statSync(src), taken = 2.5;
  fs.mkdirSync(path.join(work, "faces"), { recursive: true });
  fs.writeFileSync(path.join(work, "faces", "a.json"), JSON.stringify({ key: JSON.stringify({ file: src, stamp: `${st.size}:${Math.round(st.mtimeMs)}`, at: 0.5, taken }), source: [1280, 720], step: 0.1, taken, faces: listOf(...people).faces }));
};
test("build with faces: the captions never get smaller for one beat's face, and a box that cannot be a face moves nothing (the review: 96 px became 77 and 62 for b7 alone, and a stand-in's giant box moved them too)", { skip: (!ffmpeg && "no ffmpeg") || (!zones && "no platform-zones beside") || (!captionsHere && "no captions beside") || (!fs.existsSync(path.join(here, "..", "..", "layout", "tools", "place.mjs")) && "no layout beside") }, () => {
  const dir = tmp();
  try {
    const { work, comp, src, withCaptions } = short(dir);
    const beatsFile = path.join(work, "beats.json"), cfg = JSON.parse(fs.readFileSync(beatsFile, "utf8"));
    cfg.beats[0].frame = "fill"; cfg.beats[0].people = true;
    fs.writeFileSync(beatsFile, JSON.stringify(cfg));
    let r = withCaptions(comp);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const plain = filesOf(comp), size = JSON.parse(fs.readFileSync(path.join(comp, "captions", "area.json"), "utf8")).size;
    // the review's giant box: left out and said, the short as without faces
    facesFile(work, src, ["giant", person("giant", [-5000, -5000, 99999, 99999], 25)]);
    r = withCaptions(comp);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /a: the face box of "giant" cannot be a face at 25 moment\(s\)/);
    assert.deepEqual(filesOf(comp), plain);
    // the review's b7, the face of CM S Ingram, lower in the picture, in a band whose zoom the agent
    // set (so that the picture does not give way): its eyes lie where the captions stand
    cfg.beats[0].frame = "whole"; cfg.beats[0].zoom = 1.6;
    fs.writeFileSync(beatsFile, JSON.stringify(cfg));
    facesFile(work, src, ["CM S Ingram", person("I", [564, 560, 135, 150], 25)]);
    r = withCaptions(comp);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /the captions: they lay on a face in a \(the eyes or nose [\d.]+ s[^)]*\) where they stood; .* of 96 px, their size/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(comp, "captions", "area.json"), "utf8")).size, size, "the captions keep their size");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("build with faces: a raised fill goes over into the ground below it, no hard line where it ends (crew4 b3, raised 90 px); a crop placed high is cut as before", { skip: (!ffmpeg && "no ffmpeg") || (!zones && "no platform-zones beside") || (!captionsHere && "no captions beside") || (!fs.existsSync(path.join(here, "..", "..", "layout", "tools", "place.mjs")) && "no layout beside") }, () => {
  const dir = tmp();
  try {
    const { work, comp, src, withCaptions } = short(dir);
    const beatsFile = path.join(work, "beats.json"), cfg = JSON.parse(fs.readFileSync(beatsFile, "utf8"));
    cfg.beats[0].frame = "fill"; cfg.beats[0].people = true;
    fs.writeFileSync(beatsFile, JSON.stringify(cfg));
    // the review's CM S Ingram alone, low in the picture: the fill is raised
    facesFile(work, src, ["CM S Ingram", person("I", [564, 420, 135, 165], 25)]);
    const r = withCaptions(comp);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const lift = Number(r.stdout.match(/a: .*raised (\d+) px/)[1]);
    const how = JSON.parse(JSON.parse(fs.readFileSync(path.join(comp, "assets", "clips", "a.json"), "utf8")).how);
    assert.equal(how.box.fade, 96);
    // a frame of the clip, row by row: the mean step from one row to the next, over the frame's width
    const g = spawnSync("ffmpeg", ["-v", "error", "-ss", "1", "-i", path.join(comp, "assets", "clips", "a.mp4"), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 1 << 24 }).stdout;
    const row = (y) => g.subarray(y * 1080, (y + 1) * 1080);
    const step = (y) => row(y).reduce((n, v, x) => n + Math.abs(v - row(y + 1)[x]), 0) / 1080;
    const end = 1920 - lift;
    // where the picture ends it meets the ground as the ground's own rows meet (testsrc2's bright
    // pattern against its dark blur: a step of tens before); 96 rows up it is the picture itself
    assert.ok(step(end - 1) < 3, `a step of ${step(end - 1).toFixed(1)} where the raised picture ends`);
    assert.ok(Math.abs(row(end - 1).reduce((n, v) => n + v, 0) - row(end).reduce((n, v) => n + v, 0)) / 1080 < 3);
    const picture = row(end - 100).reduce((n, v) => n + v, 0) / 1080, ground = row(end + 4).reduce((n, v) => n + v, 0) / 1080;
    assert.ok(picture - ground > 20, `the picture ${picture.toFixed(0)} above the fade, the ground ${ground.toFixed(0)}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// the author's epps2: the first beat a fill on Jeanette Epps (1280×720), her face as `faces` found it
const epps = (dy = 0) => ["Jeanette Epps", Array.from({ length: 25 }, (_, k) => ({ t: +(k * 0.1).toFixed(1), box: [544, 84 + dy, 205, 272], feat: [563, 177 + dy, 159, 142] }))];
const facesWith = (work, src, ...people) => {
  const st = fs.statSync(src), taken = 2.5;
  fs.mkdirSync(path.join(work, "faces"), { recursive: true });
  fs.writeFileSync(path.join(work, "faces", "a.json"), JSON.stringify({ key: JSON.stringify({ file: src, stamp: `${st.size}:${Math.round(st.mtimeMs)}`, at: 0.5, taken }), source: [1280, 720], step: 0.1, taken, faces: listWith(...people).faces }));
};
const hookTag = (comp) => fs.readFileSync(path.join(comp, "index.html"), "utf8").match(/<div id="hook-in"[^>]*>/)[0];
test("build with faces: the hook may lie on hair or a forehead (epps2 stays at the top); where it reaches the eyes it gets smaller first; where no size and no place clear of the faces is left beside the captions, it stays and a ! says so", { skip: (!ffmpeg && "no ffmpeg") || (!zones && "no platform-zones beside") || (!captionsHere && "no captions beside") || (!fs.existsSync(path.join(here, "..", "..", "layout", "tools", "place.mjs")) && "no layout beside") }, () => {
  const dir = tmp();
  try {
    const { work, comp, src, withCaptions } = short(dir);
    const beatsFile = path.join(work, "beats.json"), cfg = JSON.parse(fs.readFileSync(beatsFile, "utf8"));
    cfg.hook = { text: "YEARS OF TRAINING", key: "YEARS" };
    cfg.beats[0].frame = "fill"; cfg.beats[0].people = true;
    fs.writeFileSync(beatsFile, JSON.stringify(cfg));
    let r = withCaptions(comp);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const plain = hookTag(comp);
    assert.match(plain, /style="font-size: 104px;"/);
    // epps2: the two lines end on her forehead, above the eyes: they stay
    facesWith(work, src, epps());
    r = withCaptions(comp);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /the hook lies on the hair or forehead [\d.]+ s in a, not the eyes: it may/);
    assert.equal(hookTag(comp), plain);
    // her face 20 px higher in the picture: at 104 and 96 px the lines reach the eyes, smaller ones do not
    facesWith(work, src, epps(-20));
    r = withCaptions(comp);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const px = Number(r.stdout.match(/the hook: it reached the eyes in a \(the eyes or nose [\d.]+ s[^)]*\) at 104 px; (\d+) px instead, at the top/)?.[1]);
    assert.ok(px >= 60 && px <= 88, r.stdout);
    assert.equal(hookTag(comp), plain.replace("104px", `${px}px`));
    // a close face from the top of the picture: the hook reaches its eyes at every size, and below its
    // chin it would stand on the captions
    facesWith(work, src, ["close", Array.from({ length: 25 }, (_, k) => ({ t: +(k * 0.1).toFixed(1), box: [500, 0, 280, 380], feat: [530, 20, 220, 280] }))]);
    r = withCaptions(comp);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /! the hook: it reached the eyes in a \(the eyes or nose [\d.]+ s\), at every size, and agentitos' layout's place for it lies on the captions or directly above them: it stands where it stood: a shorter hook, or another first beat/);
    assert.equal(hookTag(comp), plain);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Jeanette Epps' interview (the author's epps2) lower in the picture: in the fill her eyes and nose
// stay above the captions, her lower lip reaches into them; the model says where she looks
const talking = (looks, dy = 140) => ["Jeanette Epps", epps(dy)[1].map((m) => ({ ...m, ...(looks ? { looks } : {}) }))];
// layout's measure gone wrong (decided: measure-fallback): the captions and the hook stand as without
// faces, and one sentence says that the step needs layout and what failed, in the build's words
const SAID = /the faces step needs agentitos' layout beside this skill to keep the captions and the hook off the faces, and (.+): they stand as they would without faces/;
test("faces: layout not found: the sentence says the step needs it and that it is not found", async () => {
  const { measureFault, measureSaid } = await import("./lib/faces.mjs");
  for (const said of [measureSaid(measureFault(null)), measureSaid(measureFault("/x/place.mjs", { error: { code: "ENOENT" } }, 120))])
    assert.equal(said.match(SAID)?.[1], "agentitos' layout is not found beside this skill (nor named by LAYOUT_TOOL)");
});
// a build whose hook reaches the eyes (it gets smaller with the measure) with a layout whose measure misbehaves
function withBadMeasure(mode, env = {}) {
  const dir = tmp(), fake = path.join(dir, "fake-layout.mjs");
  fs.writeFileSync(fake, `import { spawnSync } from "node:child_process";
const a = process.argv.slice(2);
if (a.includes("--measure")) { if (${JSON.stringify(mode)} === "hang") await new Promise((r) => setTimeout(r, 20000)); console.log("(nonsense)"); process.exit(1); }
process.exit(spawnSync(process.execPath, [${JSON.stringify(layoutTool)}, ...a], { stdio: "inherit" }).status ?? 1);
`);
  const keep = { ...process.env };
  try {
    const { work, comp, src, withCaptions } = short(dir);
    const beatsFile = path.join(work, "beats.json"), cfg = JSON.parse(fs.readFileSync(beatsFile, "utf8"));
    cfg.hook = { text: "YEARS OF TRAINING", key: "YEARS" };
    cfg.beats[0].frame = "fill"; cfg.beats[0].people = true;
    fs.writeFileSync(beatsFile, JSON.stringify(cfg));
    let r = withCaptions(comp);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const plain = hookTag(comp);
    facesWith(work, src, epps(-20));
    Object.assign(process.env, { LAYOUT_TOOL: fake, ...env });
    r = withCaptions(comp);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(hookTag(comp), plain);
    assert.doesNotMatch(r.stdout, /nonsense/);
    return r.stdout.match(SAID)?.[1];
  } finally { process.env = keep; fs.rmSync(dir, { recursive: true, force: true }); }
}
const badSkip = { skip: (!ffmpeg && "no ffmpeg") || (!zones && "no platform-zones beside") || (!captionsHere && "no captions beside") || (!layoutHere && "no layout beside") };
test("build with faces: layout's measure gives no answer in time: the hook stands as without faces (at 104 px, where the measure made it smaller), and the sentence says no answer came", badSkip, () => {
  assert.equal(withBadMeasure("hang", { NARRATED_SHORT_MEASURE_LIMIT: "2" }), "agentitos' layout gave no answer within 2 s");
});
test("build with faces: layout's measure answers what cannot be read: the hook stands as without faces, and the sentence says so, never the tool's own output", badSkip, () => {
  assert.equal(withBadMeasure("nonsense"), "agentitos' layout gave an answer that could not be read (it ended with exit 1)");
});

test("faces: a speaker who looks into the camera keeps the mouth clear: it weighs as the eyes under a text, and a fill is raised for it; one who looks aside, or whose faces say nothing of it, keeps the relaxed rule", () => {
  const size = [1280, 720], at = (looks) => counted(listWith(talking(looks)), size, 2.5);
  assert.deepEqual(looking(at("camera"), 2.5), { who: "Jeanette Epps", share: 1 });
  assert.equal(looking(at("left"), 2.5), null);
  assert.deepEqual(looking(at(null), 2.5), { who: "Jeanette Epps", unknown: true });
  // looking aside for most of the beat: no
  const half = counted(listWith(["A", epps(140)[1].map((m, k) => ({ ...m, looks: k < 10 ? "camera" : "right" }))]), size, 2.5);
  assert.equal(looking(half, 2.5), null);
  // the fill as it is lays the captions on her lower lip, not her eyes or nose: the same fill
  const plain = planWindow({ frame: "fill", size, people: at("camera"), captions: CAPTIONS });
  assert.deepEqual([plain.frame, plain.changed], ["fill", false]);
  // talking, it is raised until her mouth is clear of them, at the same size
  const raised = planWindow({ frame: "fill", size, people: talksIn(at("camera")), captions: CAPTIONS });
  assert.equal(raised.frame, "crop");
  assert.match(raised.said, /raised (\d+) px, so that the captions lie on no eyes or nose or the mouth of who talks/);
  const lift = 1920 - raised.box.at[3], mouth = (177 + 140 + 1.15 * 142) * 1920 / 720;
  assert.ok(960 + (mouth - lift - 960) * 1.04 + 24 <= 1238 + 2, `raised ${lift}`);
  // a text on her lower lip: "lip" (weight 1) for a face that does not talk, "talk" (as the eyes) for one that does
  if (!layoutHere) return;
  const moments = framed({ list: listWith(talking("camera")), place: { frame: "fill", size }, from: 0, seconds: 2.5 }), on = measured(CAPTIONS, moments);
  const quiet = onOf(on), loud = onOf(on, { talks: { 0: "Jeanette Epps" } });
  assert.ok(quiet.lip > 0 && quiet.hard === 0 && quiet.cost < 10, JSON.stringify(quiet));
  assert.ok(loud.talk > 0 && loud.hard === loud.talk && loud.cost >= 100 * loud.talk, JSON.stringify(loud));
});

test("build with faces: an interview's speaker to the camera, large in a fill, is raised clear of the captions and the line says why; faces of before (no looks) build as before and, where the captions lie on her mouth, say that where she looks is not known; one who looks aside builds as before", { skip: (!ffmpeg && "no ffmpeg") || (!zones && "no platform-zones beside") || (!captionsHere && "no captions beside") || (!fs.existsSync(path.join(here, "..", "..", "layout", "tools", "place.mjs")) && "no layout beside") }, () => {
  const dir = tmp();
  try {
    const { work, comp, src, withCaptions } = short(dir);
    const beatsFile = path.join(work, "beats.json"), cfg = JSON.parse(fs.readFileSync(beatsFile, "utf8"));
    cfg.beats[0].frame = "fill"; cfg.beats[0].people = true;
    fs.writeFileSync(beatsFile, JSON.stringify(cfg));
    facesWith(work, src, talking("left"));
    let r = withCaptions(comp);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const aside = filesOf(comp);
    assert.match(r.stdout, /a: the faces \(Jeanette Epps\) are in the picture as it is\n/);
    assert.match(r.stdout, /the captions lie on the lower lip [\d.]+ s in a, no eyes or nose: nobody shown speaks, they may/);
    // faces of before: the same short, and the line says what is not known
    facesWith(work, src, talking(null));
    r = withCaptions(comp);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(filesOf(comp), aside);
    assert.match(r.stdout, /a: the faces \(Jeanette Epps\) are in the picture as it is\n/);
    assert.match(r.stdout, /the captions lie on the mouth of Jeanette Epps in a: whether it looks into the camera is not known \(faces found before they said so; node \S+ faces \S+ --again asks anew, and the mouth of one who does is kept clear like the eyes\)/);
    // she looks into the camera: raised, said, and the captions lie on no mouth
    facesWith(work, src, talking("camera"));
    r = withCaptions(comp);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /a: the faces \(Jeanette Epps\) are in the picture as it is; raised \d+ px, so that the captions lie on no eyes or nose or the mouth of who talks \(the ground below it\); Jeanette Epps looks into the camera \(100 % of the beat, the face 38 % of the frame's height\): the captions and the hook keep off the mouth as off the eyes/);
    assert.doesNotMatch(r.stdout, /lower lip|the mouth of one who/);
    assert.match(JSON.parse(fs.readFileSync(path.join(comp, "assets", "clips", "a.json"), "utf8")).how, /"frame":"crop"/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The review's stand-in for OpenRouter (its fake.mjs): an HTTP 500, an answer that is no JSON, one
// that never comes; and a refused connection. Each ends as "built as without faces", exit 0, with
// what went wrong in its sentence, never Node's version; a beat and the step each have a limit.
test("faces, unattended: a server error, an unreadable answer, a refused connection and no answer each say what went wrong and build as without faces; no answer costs a beat its limit and the step its own", { skip: (!ffmpeg && "no ffmpeg") || (!fs.existsSync(path.join(here, "..", "..", "clips", "tools", "frame.mjs")) && "no clips beside") }, async () => {
  const dir = tmp();
  const fake = path.join(dir, "fake.mjs");
  fs.writeFileSync(fake, `import http from "node:http";
const mode = process.argv[2], port = Number(process.argv[3]);
http.createServer((req, res) => { req.resume(); req.on("end", () => {
  if (req.url.endsWith("/key")) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ data: { limit: null, usage: 0 } })); }
  if (mode === "hang") return;
  if (mode === "500") { res.writeHead(500, { "content-type": "application/json" }); return res.end('{"error":"down"}'); }
  res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ choices: [{ message: { content: "this is not json at all" } }], usage: { cost: 0 } }));
}); }).listen(port, "127.0.0.1", () => console.log("ready"));`);
  const serve = (mode, port) => new Promise((ok) => { const p = spawn(process.execPath, [fake, mode, String(port)]); p.stdout.once("data", () => ok(p)); });
  try {
    const { work } = short(dir);
    const beatsFile = path.join(work, "beats.json"), cfg = JSON.parse(fs.readFileSync(beatsFile, "utf8"));
    cfg.beats[0].people = true;
    fs.writeFileSync(beatsFile, JSON.stringify(cfg));
    const faces = (port, env = {}) => spawnSync(process.execPath, [path.join(here, "short.mjs"), "faces", work, "--again"], { encoding: "utf8", cwd: dir, env: { ...process.env, OPENROUTER_API_KEY: "test", OPENROUTER_BASE_URL: `http://127.0.0.1:${port}`, ...env } });
    for (const [mode, said] of [["garbage", /! a: no faces \(the model's answer could not be read \(Unexpected token[^)]*\)\); built as without faces/], ["500", /! a: no faces \(OpenRouter 500: \{"error":"down"\}\); built as without faces/]]) {
      const server = await serve(mode, 18571);
      try {
        const r = faces(18571);
        assert.equal(r.status, 0, r.stdout + r.stderr);
        assert.match(r.stdout, said);
        assert.doesNotMatch(r.stdout, /Node\.js v/);
      } finally { server.kill(); }
    }
    let r = faces(18572);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /! a: no faces \(OpenRouter could not be reached \(ECONNREFUSED\)\); built as without faces/);
    // no answer: the beat is stopped at its limit; a second beat finds the step's time spent
    cfg.beats[1].people = true;
    fs.writeFileSync(beatsFile, JSON.stringify(cfg));
    const server = await serve("hang", 18573);
    try {
      const t0 = Date.now();
      r = faces(18573, { FACES_BEAT_SECONDS: "8", FACES_STEP_SECONDS: "15" });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /! a: no faces \(it took longer than 8 s it may take and was stopped\); built as without faces/);
      assert.match(r.stdout, /! b: (no faces \(it took longer than [\d]+ s it may take and was stopped\); built as without faces|not sent, the step has had its 15 s)/);
      assert.ok(Date.now() - t0 < 40e3, `${Date.now() - t0} ms`);
    } finally { server.kill(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- a beat whose "frame" is left out (2026-11-20, decision short-band): the largest picture that
// holds every face that counts whole, the band only where nothing else does; "whole" written stays the band
const SIZE4K = [3840, 2160];
const wholeIn = (rect, people) => people.held.every((p) => p.boxes.every((b) => b[0] >= rect[0] - 1 && b[0] + b[2] <= rect[0] + rect[2] + 1 && b[1] >= rect[1] - 1 && b[1] + b[3] <= rect[1] + rect[3] + 1));
test("no \"frame\": two people a fill holds whole get the fill, moved to them (the run's b8: a band of 74 and 81 px over 68 % ground before); \"frame\": \"whole\" stays the band", () => {
  const b8 = counted(listWith(["woman with short hair", person("S", [1888, 570, 216, 254], 47).map((m) => ({ ...m, feat: [1968, 680, 134, 158] }))], ["woman with curly hair", person("C", [2398, 584, 246, 272], 47).map((m) => ({ ...m, feat: [2394, 696, 142, 152] }))]), SIZE4K, 4.67);
  assert.equal(b8.held.length, 2);
  const p = planWindow({ frame: "whole", size: SIZE4K, people: b8, captions: CAPTIONS, crop: () => assert.fail("no crop where a fill holds them"), silent: true });
  assert.equal(p.frame, "fill");
  const win = shown({ ...p, size: SIZE4K });
  assert.ok(wholeIn([win[0], 0, win[1] - win[0], 2160], b8), `the fill ${win} holds both whole`);
  assert.match(p.said, /^no "frame", so the largest picture that holds woman with short hair, woman with curly hair whole: a fill, moved to them \(the faces 226 and 242 px; as the band 71 and 77 px over 68 % ground; "frame": "whole" for the band\)$/);
  // written: the band, as before
  const band = planWindow({ frame: "whole", size: SIZE4K, people: b8, captions: CAPTIONS });
  assert.deepEqual([band.frame, band.zoom, band.changed], ["whole", 1, false]);
});

test("no \"frame\": four people no fill holds, low in the picture, get layout's 1:1 placed high (the run's b10); the crop must hold every box whole, else the band", () => {
  const four = counted(listOf(...[[600, "A"], [1100, "B"], [1600, "C"], [2300, "D"]].map(([x, who]) => [who, person(who, [x, 1700, 150, 200], 34)])), SIZE4K, 3.4);
  assert.equal(four.held.length, 4);
  const square = { fit: "crop", crop: "1:1", scale: 0.5, left: -0.5 * 480, top: 100, window: [0, 100, 1080, 1080] };
  const p = planWindow({ frame: "whole", size: SIZE4K, people: four, captions: CAPTIONS, crop: () => square, silent: true });
  assert.equal(p.frame, "crop");
  assert.deepEqual(p.box, { src: [480, 0, 2160, 2160], at: [0, 100, 1080, 1080] });
  assert.match(p.said, /a 1:1 crop placed high \(the faces 100 to 100 px, 44 % ground; a fill would cut one of them; as the band 56 to 56 px over 68 % ground; "frame": "whole" for the band\)/);
  // a crop that cuts one of them (D past its right edge): not taken
  const tight = { ...square, left: -0.5 * 700 };
  const q = planWindow({ frame: "whole", size: SIZE4K, people: four, captions: CAPTIONS, crop: () => tight, silent: true });
  assert.equal(q.frame, "whole");
  assert.ok(wholeIn(((w) => [w[0], 0, w[1] - w[0], 2160])(shown({ ...q, size: SIZE4K })), four));
  // the same four higher up (the run's b10): a band at 1.8x and more is larger than any 1:1 of them, so the band, unmarked, and no stretch for a 1:1 named
  const high = counted(listOf(...[[600, "A"], [1100, "B"], [1600, "C"], [2300, "D"]].map(([x, who]) => [who, person(who, [x, 600, 150, 200], 34)])), SIZE4K, 3.4);
  const h = planWindow({ frame: "whole", size: SIZE4K, people: high, captions: CAPTIONS, crop: () => square, silent: true });
  assert.equal(h.frame, "whole");
  assert.ok(h.zoom > 1.8 && h.flag === false, `zoom ${h.zoom}, flag ${h.flag}`);
  assert.match(h.said, /\d+ % of the frame blurred ground, the faces 112 to 112 px; to show them larger: "frame": "fill" with a "pan" on the one the words are about \(it cuts the others\), or another stretch where they stand closer$/);
});

test("no \"frame\": a pair only the band holds keeps the band (never a fill on one of them), and its line says the cost and the ways out, with the seconds of the clip where they stand closer (the run's b9)", () => {
  // crew4's two women, the curly one nearer in the stretch's first 0.5 s
  const near = (t) => (t < 0.5 ? [1500, 394, 856, 756] : [2300, 394, 856, 756]);
  const pair = counted(listOf(["woman with short grey hair", person("G", [800, 990, 1022, 970], 32)], ["woman with short curly hair", person("C", null, 32).map((m) => ({ ...m, box: near(m.t) }))]), SIZE4K, 3.17);
  const p = planWindow({ frame: "whole", size: SIZE4K, people: pair, captions: CAPTIONS, crop: () => null, silent: true, at: 7.4 });
  assert.equal(p.frame, "whole");
  assert.equal(p.flag, true);
  assert.ok(wholeIn(((w) => [w[0], 0, w[1] - w[0], 2160])(shown({ ...p, size: SIZE4K })), pair));
  assert.match(p.said, /^no "frame", so the largest picture that holds woman with short grey hair, woman with short curly hair whole is the band, [\d.]+ times larger \(they stand \d+ % of the width\): \d+ % of the frame blurred ground, the faces \d+ and \d+ px; to show them larger: "frame": "fill" with a "pan" on the one the words are about \(it cuts the other\), or another stretch where they stand closer \(at the source's 7\.4-7\.9 s, inside this beat's stretch, they stand within 2160 px, where a 1:1 crop holds them\)$/);
  // never smaller than the band it had (1x, or the first beat's own)
  assert.ok(p.zoom >= 1);
  const first = planWindow({ frame: "whole", zoom: 1.6, size: SIZE4K, people: pair, captions: CAPTIONS, crop: () => null, silent: true });
  assert.ok(first.zoom >= planWindow({ frame: "whole", zoom: 1.6, size: SIZE4K, people: pair, captions: CAPTIONS }).zoom);
  // a fill written: the same band, its line the same cost with a "pan" as the way out
  const fill = planWindow({ frame: "fill", size: SIZE4K, people: pair, captions: CAPTIONS, crop: () => null, at: 7.4 });
  assert.deepEqual([fill.frame, fill.zoom, fill.pan], [p.frame, p.zoom, p.pan]);
  assert.match(fill.said, /; \d+ % of the frame blurred ground, the faces \d+ and \d+ px; to show them larger: a "pan" on the one the words are about \(it cuts the other\), or another stretch where they stand closer \(at the source's 7\.4-7\.9 s/);
});

// the faces file `faces` writes for a beat of the test short
const facesOf = (work, src, beat, at, taken, ...people) => {
  const st = fs.statSync(src);
  fs.mkdirSync(path.join(work, "faces"), { recursive: true });
  fs.writeFileSync(path.join(work, "faces", `${beat}.json`), JSON.stringify({ key: JSON.stringify({ file: src, stamp: `${st.size}:${Math.round(st.mtimeMs)}`, at, taken }), source: [1280, 720], step: 0.1, taken, faces: listOf(...people).faces }));
};
const noteOf = (comp, id) => JSON.parse(JSON.parse(fs.readFileSync(path.join(comp, "assets", "clips", `${id}.json`), "utf8")).how);
const layoutBeside = fs.existsSync(path.join(here, "..", "..", "layout", "tools", "place.mjs"));
test("build: a beat with faces and no \"frame\" gets the fill that holds them, a rebuild equals it; \"frame\": \"whole\" is the band as without faces; a beat without faces and without \"frame\" says what its band costs; a fill takes a \"pan\" without faces", { skip: (!ffmpeg && "no ffmpeg") || (!zones && "no platform-zones beside") || (!layoutBeside && "no layout beside") }, () => {
  const dir = tmp();
  try {
    const { work, comp, src, build } = short(dir);
    const beatsFile = path.join(work, "beats.json"), cfg = JSON.parse(fs.readFileSync(beatsFile, "utf8"));
    // no faces: both beats are bands, and each says what it costs (the first at its own 1.6x)
    let r = build();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /! a: no "frame" and no faces known: the whole picture as a band, 49 % of the frame blurred ground; to show its subject larger: "people": true where it shows a face \(faces places it\), or "frame": "fill" with a "pan" on the subject \(0 the left, 1 the right\); "frame": "whole" keeps the band/);
    assert.match(r.stdout, /! b: no "frame" and no faces known: the whole picture as a band, 68 % of the frame blurred ground/);
    const bandB = noteOf(comp, "b");
    assert.deepEqual([bandB.frame, bandB.zoom], ["whole", 1]);
    // --no-faces: no such line (the step is left out on purpose)
    assert.doesNotMatch(build("--no-faces").stdout, /no faces known/);
    // a face high at the right of b: the fill moved to it, the face whole
    const b = cfg.beats[1], taken = Math.round((b.to - b.from) * 1000) / 1000;
    cfg.beats[1].people = true;
    fs.writeFileSync(beatsFile, JSON.stringify(cfg));
    assert.match(build().stdout, /! b: no "frame" and no faces known: .*node .*short\.mjs faces .* \(its faces place it\)/);
    facesOf(work, src, "b", 3, taken, ["A", person("A", [1000, 40, 200, 260], Math.round(taken * 10))]);
    r = build();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\n {2}b: no "frame", so the largest picture that holds A whole: a fill, moved to them \(the face 693 px; as the band 219 px over 68 % ground; "frame": "whole" for the band\)/);
    const filled = noteOf(comp, "b");
    assert.equal(filled.frame, "fill");
    assert.ok(filled.x > 0 && (filled.x / (1920 / 720)) <= 1000 && ((filled.x + 1080) / (1920 / 720)) >= 1200, `the fill at x ${filled.x} holds the face whole`);
    const first = filesOf(comp);
    r = build();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(filesOf(comp), first, "a rebuild writes what the first build wrote");
    // written "whole": the band, as without faces
    cfg.beats[1].frame = "whole";
    fs.writeFileSync(beatsFile, JSON.stringify(cfg));
    r = build();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(noteOf(comp, "b"), bandB);
    assert.doesNotMatch(r.stdout, /b: no "frame"/);
    // a fill with a "pan" and no faces: the pan stands (before, it was cut from the middle)
    fs.rmSync(path.join(work, "faces"), { recursive: true });
    for (const [pan, x] of [[0, 0], [1, 3414 - 1080]]) {
      cfg.beats[1] = { ...cfg.beats[1], frame: "fill", pan };
      fs.writeFileSync(beatsFile, JSON.stringify(cfg));
      r = build();
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(noteOf(comp, "b").x, x);
    }
    // without a pan: from the middle, as it always was
    delete cfg.beats[1].pan;
    fs.writeFileSync(beatsFile, JSON.stringify(cfg));
    assert.equal(build().status, 0);
    assert.equal(noteOf(comp, "b").x, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("build: where layout's measure fails, or layout is not beside, a beat with faces and no \"frame\" stays the band, as before, said in one sentence", { skip: (!ffmpeg && "no ffmpeg") || (!zones && "no platform-zones beside") || (!layoutBeside && "no layout beside") }, () => {
  const dir = tmp();
  try {
    const { work, comp, src, build } = short(dir);
    const beatsFile = path.join(work, "beats.json"), cfg = JSON.parse(fs.readFileSync(beatsFile, "utf8"));
    const b = cfg.beats[1], taken = Math.round((b.to - b.from) * 1000) / 1000;
    cfg.beats[1].people = true;
    fs.writeFileSync(beatsFile, JSON.stringify(cfg));
    let r = build("--no-faces");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const before = filesOf(comp);
    facesOf(work, src, "b", 3, taken, ["A", person("A", [1000, 40, 200, 260], Math.round(taken * 10))]);
    // layout's place works, its measure does not
    const stub = path.join(dir, "place.mjs");
    fs.writeFileSync(stub, `import { spawnSync } from "node:child_process";
if (process.argv[2] === "text") { console.log("the measure broke"); process.exit(1); }
process.exit(spawnSync(process.execPath, [${JSON.stringify(path.join(here, "..", "..", "layout", "tools", "place.mjs"))}, ...process.argv.slice(2)], { stdio: "inherit" }).status);`);
    r = spawnSync(process.execPath, [path.join(here, "short.mjs"), "build", work, comp, "--no-captions", "--platform", "tiktok"], { encoding: "utf8", cwd: dir, env: { ...process.env, LAYOUT_TOOL: stub } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /! the beat b without "frame" stays the band, as before: a larger picture of their faces needs agentitos' layout's measure, and it failed/);
    assert.deepEqual([noteOf(comp, "b").frame, noteOf(comp, "b").zoom], ["whole", 1]);
    assert.deepEqual(filesOf(comp)["assets/clips/b.mp4"], before["assets/clips/b.mp4"]);
    // no layout beside: a copy of this skill alone with platform-zones
    const alone = path.join(dir, "skills");
    fs.cpSync(path.join(here), path.join(alone, "narrated-short", "tools"), { recursive: true });
    fs.symlinkSync(path.resolve(here, "..", "..", "platform-zones"), path.join(alone, "platform-zones"));
    r = spawnSync(process.execPath, [path.join(alone, "narrated-short", "tools", "short.mjs"), "build", work, comp, "--no-captions", "--platform", "tiktok"], { encoding: "utf8", cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /! the beat b without "frame" stays the band, as before: a larger picture of their faces needs agentitos' layout beside this skill to keep the captions off them/);
    assert.deepEqual([noteOf(comp, "b").frame, noteOf(comp, "b").zoom], ["whole", 1]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 2026-11-20, decided from the pair passerby-sheet: a picture chosen for a beat without "frame" cuts
// no face through that the source shows whole; one that does not count may be left out whole
test("no \"frame\": a face that does not count is held whole or left out, never cut through (r1's h1: the fill from the middle cut Jessica Watkins, 62 % as tall, 1.1 s; a fill moved to both holds both at the same size)", () => {
  const sam = [...Array.from({ length: 17 }, (_, k) => ({ t: +(k * 0.1).toFixed(1), box: [1816, 508, 476, 602], feat: [1828, 660, 288, 366] })),
    ...Array.from({ length: 11 }, (_, k) => ({ t: +((17 + k) * 0.1).toFixed(1), box: [1958, 576, 216, 270], feat: [1998, 680, 138, 130] }))];
  const jess = Array.from({ length: 11 }, (_, k) => ({ t: +((17 + k) * 0.1).toFixed(1), box: [2404 + 6 * k, 594, 276 - 3 * k, 306], feat: [2454 + 5 * k, 710, 176 - 2 * k, 148] }));
  const h1 = counted(listWith(["Samantha Cristoforetti", sam], ["Jessica Watkins", jess]), SIZE4K, 2.83);
  assert.deepEqual([h1.held.map((p) => p.who), h1.small.map((p) => p.who)], [["Samantha Cristoforetti"], ["Jessica Watkins"]]);
  const p = planWindow({ frame: "whole", zoom: 1.6, size: SIZE4K, people: h1, captions: CAPTIONS, crop: () => assert.fail("no crop where a fill holds both"), silent: true });
  assert.equal(p.frame, "fill");
  const win = shown({ ...p, size: SIZE4K });
  assert.ok(win[0] <= 1816 && win[1] >= 2712, `the fill ${win} holds both whole`);
  assert.match(p.said, /^no "frame", so the largest picture that holds Samantha Cristoforetti whole: a fill, moved to them \(the face \d+ px; .*\); a fill would have cut Jessica Watkins at the frame's side: the picture is moved/);
  // a fill written: as on main, from the middle (she is cut there, said as the one at the side)
  assert.equal(planWindow({ frame: "fill", size: SIZE4K, people: h1, captions: CAPTIONS }).x, null);
});

test("no \"frame\": a pair that counts and a third face too far for one fill with them, which every fill on the pair would cut through: the 1:1 instead, nobody cut", () => {
  const trio = counted(listOf(["A", person("A", [1300, 1700, 170, 200], 30)], ["B", person("B", [2180, 1700, 170, 200], 30)], ["C", person("C", [2390, 1720, 200, 124], 30)]), SIZE4K, 3);
  assert.deepEqual([trio.held.map((p) => p.who), trio.small.map((p) => p.who)], [["A", "B"], ["C"]]);
  const square = { fit: "crop", crop: "1:1", scale: 0.5, left: -0.5 * 900, top: 100, window: [0, 100, 1080, 1080] };
  const p = planWindow({ frame: "whole", size: SIZE4K, people: trio, captions: CAPTIONS, crop: () => square, silent: true });
  assert.equal(p.frame, "crop");
  assert.deepEqual(p.box.src, [900, 0, 2160, 2160]);
  assert.match(p.said, /a 1:1 crop placed high .*; a fill would have cut C at the frame's side: the 1:1 instead/);
  // without the third: the fill on the pair, as before
  const pair = counted(listOf(["A", person("A", [1300, 1700, 170, 200], 30)], ["B", person("B", [2180, 1700, 170, 200], 30)]), SIZE4K, 3);
  assert.equal(planWindow({ frame: "whole", size: SIZE4K, people: pair, captions: CAPTIONS, crop: () => square, silent: true }).frame, "fill");
  // a face the source's edge cuts is no reason: it is cut in every picture
  const edge = counted(listOf(["A", person("A", [1300, 1700, 170, 200], 30)], ["B", person("B", [2180, 1700, 170, 200], 30)], ["C", person("C", [3740, 1720, 200, 124], 30)]), SIZE4K, 3);
  assert.equal(planWindow({ frame: "whole", size: SIZE4K, people: edge, captions: CAPTIONS, crop: () => square, silent: true }).frame, "fill");
});
