// The table of what the platforms do with sound and the master it answers with (no ffmpeg, no
// network).  node --test voice-sound/tools/test-targets.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PLATFORMS, MASTERS, STANDARDS, REASONS, DEFAULTS, CHECKED, resolve, resolveAll, targets, list, format, formatList } from "./lib/targets.mjs";

// platform-zones' file, read as text (a skill imports no other skill's code), when it is beside this one
const ZONES = new URL("../../platform-zones/tools/lib/platforms.mjs", import.meta.url);
const zonesHere = fs.existsSync(ZONES);

test("every id and alias of platform-zones resolves here to the same platform", { skip: !zonesHere && "platform-zones is not beside this skill" }, () => {
  const src = fs.readFileSync(ZONES, "utf8");
  const found = [...src.matchAll(/id: "([^"]+)", name: "[^"]*", aliases: \[([^\]]*)\]/g)];
  assert.ok(found.length >= 14, "platform-zones' entries are read");
  for (const [, id, aliases] of found) {
    assert.equal(resolve(id)?.id, id, id);
    for (const a of [...aliases.matchAll(/"([^"]+)"/g)].map((m) => m[1])) assert.equal(resolve(a)?.id, id, `${a} → ${id}`);
  }
});

test("the ids, the aliases and the two for sound alone", () => {
  assert.deepEqual(PLATFORMS.map((p) => p.id), ["instagram-reels", "instagram-story", "instagram-feed", "tiktok", "youtube-shorts", "youtube", "facebook-reels", "facebook-story", "facebook-feed", "snapchat-story", "snapchat-spotlight", "pinterest", "linkedin", "x", "apple-podcasts", "spotify"]);
  assert.equal(resolve("Podcast").id, "apple-podcasts");
  assert.equal(resolve("podcasts").id, "apple-podcasts");
  assert.equal(resolve("SPOTIFY").id, "spotify");
  assert.equal(resolve("nope"), null);
  assert.deepEqual(resolveAll(["reels", "instagram", "instagram-reels"]).map((p) => p.id), ["instagram-reels"]);
  assert.deepEqual(PLATFORMS.filter((p) => p.kind === "sound").map((p) => p.id), ["apple-podcasts", "spotify"]);
});

test("none named gives the video master, for the usual platforms, saying why", () => {
  const t = targets();
  assert.equal(t.kind, "video");
  assert.equal(t.fallback, true);
  assert.match(t.why, /platform-zones/);
  assert.deepEqual(t.platforms.map((p) => p.id), DEFAULTS);
  assert.deepEqual(t.master, {
    kind: "video", lufs: -14, toleranceLu: 1, truePeakDbtp: { aim: -1.5, max: -1 },
    rangeLu: { aim: 5, warn: 7 }, shortTermOverLu: 5, sampleRateHz: 48000, channels: 2,
    voice: "the same in both channels", codec: "AAC-LC", minKbps: 192, peaksAfterEncoding: true,
  });
  assert.equal(t.second, null);
  assert.equal(t.checked, CHECKED);
  assert.deepEqual(t.reasons, REASONS.video);
  assert.equal(t.reasons.length, 4);
  assert.ok(t.reasons.some((r) => /−16 to −20/.test(r)), "the standards for speech are named as quieter");
});

test("only podcasts gives −16 LUFS and −1 dBTP, with the note on one channel", () => {
  for (const names of [["podcast"], ["spotify"], ["apple-podcasts", "spotify"]]) {
    const t = targets(names);
    assert.equal(t.kind, "sound", names.join(" "));
    assert.equal(t.master.lufs, -16);
    assert.equal(t.master.toleranceLu, 1);
    assert.deepEqual(t.master.truePeakDbtp, { aim: -1, max: -1 });
    assert.equal(t.master.sampleRateHz, 48000);
    assert.equal(t.master.minKbps, 192);
    assert.equal(t.second, null);
    assert.ok(t.reasons.some((r) => /3 LU louder/.test(r) && /two channels/.test(r)));
    assert.equal(t.fallback, false);
  }
});

test("a video platform and a podcast one give the video master and a second for the podcast", () => {
  const t = targets(["tiktok", "podcast"]);
  assert.equal(t.kind, "mixed");
  assert.equal(t.master.lufs, -14);
  assert.deepEqual(t.master.truePeakDbtp, { aim: -1.5, max: -1 });
  assert.equal(t.second.lufs, -16);
  assert.match(t.reasons.at(-1), /second master: −16 LUFS/);
  assert.deepEqual(t.platforms.map((p) => p.id), ["tiktok", "apple-podcasts"]);
});

test("an unknown name is one sentence naming the platforms", () => {
  assert.throws(() => targets(["youtube", "myspace"]), (e) => e.message.startsWith(`There is no platform "myspace": instagram-reels, `) && e.message.endsWith("spotify."));
});

test("every part has a basis from the four; a known one has its source", () => {
  for (const p of PLATFORMS) {
    for (const part of ["playback", "upload"]) {
      const e = p[part];
      assert.ok(["official", "measured", "ads", "unknown"].includes(e.basis), `${p.id} ${part}: ${e.basis}`);
      assert.ok(e.what.length > 0, `${p.id} ${part} says what`);
      if (e.basis !== "unknown") assert.ok(e.sources.length >= 1, `${p.id} ${part} has a source`);
      for (const s of e.sources) assert.match(s, /^https:\/\//);
      // unknown gives no number of its own, except what a named source quotes (Snapchat's agencies)
      const keys = part === "playback" ? ["lufs", "modes"] : ["lufs", "toleranceLu", "truePeakDbtp", "kbps", "sampleRatesHz", "codecs"];
      if (e.basis === "unknown" && !e.sources.length) for (const k of keys) assert.equal(e[k], null, `${p.id} ${part}.${k}`);
    }
    const all = [...p.playback.sources, ...p.upload.sources];
    if (p.playback.basis !== "unknown" || p.upload.basis !== "unknown") assert.ok(all.length >= 1, p.id);
    assert.ok(["video", "sound"].includes(p.kind));
  }
  for (const s of STANDARDS) assert.match(s.source, /^https:\/\//);
});

test("the table holds exactly the researched numbers", () => {
  const nums = (p) => ({
    play: [p.playback.basis, p.playback.normalises, p.playback.lufs, p.playback.modes],
    up: [p.upload.basis, p.upload.codecs, p.upload.sampleRatesHz, p.upload.kbps, p.upload.lufs, p.upload.toleranceLu, p.upload.truePeakDbtp],
  });
  const meta = { play: ["official", "yes", null, null], up: ["unknown", null, null, null, null, null, null] };
  const yt = ["official", ["AAC-LC", "Opus"], [48000], { mono: [128, 128], stereo: [384, 384] }, null, null, null];
  const snap = { play: ["unknown", "unknown", null, null], up: ["unknown", ["PCM", "AAC"], [48000], { stereo: [192, null] }, -16, null, null] };
  const none = ["unknown", "unknown", null, null];
  const want = {
    "instagram-reels": meta, "instagram-story": meta, "facebook-reels": meta, "facebook-story": meta, "facebook-feed": meta,
    "instagram-feed": { play: none, up: meta.up },
    tiktok: { play: none, up: ["unknown", null, null, null, null, null, null] },
    "youtube-shorts": { play: none, up: yt },
    youtube: { play: ["measured", "down", -14, null], up: yt },
    "snapchat-story": snap, "snapchat-spotlight": snap,
    pinterest: { play: none, up: ["official", ["AAC", "PCM"], null, null, null, null, null] },
    linkedin: { play: none, up: ["ads", ["AAC", "MPEG-4"], null, null, null, null, null] },
    x: { play: none, up: ["official", ["AAC-LC"], null, { mono: [128, null], stereo: [128, null] }, null, null, null] },
    "apple-podcasts": { play: none, up: ["official", ["AAC"], [44100, 48000], { mono: [64, 128], stereo: [128, 256] }, -16, 1, -1] },
    spotify: { play: ["official", "up and down", -14, { loud: -11, normal: -14, quiet: -19 }], up: ["official", null, null, null, -14, null, -1] },
  };
  assert.deepEqual(Object.fromEntries(PLATFORMS.map((p) => [p.id, nums(p)])), want);
  assert.deepEqual(MASTERS.sound.truePeakDbtp, { aim: -1, max: -1 });
  assert.deepEqual(STANDARDS.map((s) => s.lufs), [[-20, -16], { speech: -18, music: -16 }]);

  // and no number in the sentences that the research does not hold
  const allowed = new Set([1, 1.5, 2, 3, 4, 5, 7, 11, 14, 16, 18, 19, 20, 44.1, 48, 64, 77, 128, 192, 256, 384, 1008, 2023, 2024]);
  const texts = [
    ...PLATFORMS.flatMap((p) => [p.playback.what, p.upload.what, p.note || ""]),
    ...REASONS.video, ...REASONS.sound, REASONS.mixed, ...STANDARDS.flatMap((s) => [s.name, s.says]),
  ];
  for (const t of texts) for (const m of t.matchAll(/\d+(?:\.\d+)?/g)) assert.ok(allowed.has(Number(m[0])), `${m[0]} in “${t}”`);
});

test("what targets() gives is a copy: changing it leaves the table alone", () => {
  const t = targets(["youtube"]);
  t.master.lufs = 0;
  t.platforms[0].playback.lufs = 0;
  assert.equal(targets(["youtube"]).master.lufs, -14);
  assert.equal(resolve("youtube").playback.lufs, -14);
});

test("the text for an agent: the master first, a line per platform with its basis, the reasons", () => {
  const text = format(targets());
  const lines = text.split("\n");
  assert.equal(lines[0], "Master for video: −14 LUFS ±1 LU, true peak −1.5 dBTP, at most −1 dBTP after encoding");
  assert.match(lines[1], /48 kHz, two channels with the voice the same in both, AAC-LC at 192 kbit\/s or more/);
  assert.match(text, /none named, so the vertical apps/);
  assert.match(text, /\n {2}youtube +plays \(measured\): turns louder sound down to about −14 LUFS/);
  assert.match(text, /\n {2}tiktok +plays \(unknown\): .*; upload \(unknown\): /);
  assert.match(text, /\nWhy:\n {2}−14 LUFS: YouTube/);
  assert.doesNotMatch(text, /(^|[\s(“])-\d/, "minus signs are written as −");

  assert.equal(format(targets(["podcast"])).split("\n")[0], "Master for sound alone: −16 LUFS ±1 LU, true peak at most −1 dBTP after encoding");
  const mixed = format(targets(["reels", "spotify"])).split("\n");
  assert.equal(mixed[0], "Master for video (and a podcast): −14 LUFS ±1 LU, true peak −1.5 dBTP, at most −1 dBTP after encoding");
  assert.equal(mixed[2], "  Second master, the podcast file: −16 LUFS ±1 LU, true peak at most −1 dBTP after encoding");
});

test("the listing names every platform with its aliases and bases", () => {
  const l = list();
  assert.equal(l.platforms.length, PLATFORMS.length);
  assert.deepEqual(l.defaults, DEFAULTS);
  const text = formatList(l);
  assert.match(text.split("\n")[0], /^The platforms \(checked 2026-11-19\):$/);
  for (const p of PLATFORMS) assert.match(text, new RegExp(`\\n  ${p.id} +${p.name.replace(/[()]/g, "\\$&")} \\(${p.kind}\\): playback ${p.playback.basis}, upload ${p.upload.basis}`));
  assert.match(text, /apple-podcasts .*also: podcast, podcasts/);
  assert.match(text, /Basis: official = the platform's own page; measured = /);
});
