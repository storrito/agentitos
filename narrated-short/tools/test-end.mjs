// The end of a short and its first beat's freeze, on a made-up short (two tones over a test
// picture, built without captions): a build without "handle" (left out, null, "") shows no name and
// leaves nothing in its place, one with it is as before; a freeze without room: freeze-cutout's own
// sentence passed on in one line (its refusal comes before any model call). No request, no key;
// build needs platform-zones beside.
//
//   node --test tools/test-end.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const zones = fs.existsSync(path.join(here, "..", "..", "platform-zones", "tools", "zones.mjs")) || process.env.PLATFORM_ZONES;
const cutoutTool = path.join(here, "..", "..", "freeze-cutout", "tools", "cutout.mjs");
const run = (args) => { const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "narrated-short-end-"));
const filesOf = (dir) => Object.fromEntries(fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort().map((f) => [f, crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex")]));
const buildSkip = { skip: (!ffmpeg && "no ffmpeg") || (!zones && "no platform-zones beside") };

function line(file, hz, db, seconds = 2) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  run(["-f", "lavfi", "-i", `sine=frequency=${hz}:sample_rate=44100:duration=${seconds}`, "-af", `volume=${db}dB,adelay=300,apad=pad_dur=0.4`, "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k", file]);
}

// a short of two lines over a test picture, its clock set; beats(extra, first) writes its beats.json
// (`extra` over the top level, `first` over the first beat) and build(comp) builds it into `comp`
function short(dir, env = {}) {
  const work = path.join(dir, "work"), voice = path.join(dir, "voice");
  fs.mkdirSync(work, { recursive: true });
  const ws = (from, n) => Array.from({ length: n }, (_, k) => ({ text: `w${k}`, start: +(from + k * 0.4).toFixed(2), end: +(from + k * 0.4 + 0.35).toFixed(2) }));
  line(path.join(voice, "assets", "voice", "s1.mp3"), 300, -2);
  line(path.join(voice, "assets", "voice", "s2.mp3"), 450, -6);
  fs.writeFileSync(path.join(work, "voice.json"), JSON.stringify({ model: "test", voice: "tone", lines: [
    { id: "s1", text: "one", file: "assets/voice/s1.mp3", duration: 2.7, words: ws(0.3, 5) },
    { id: "s2", text: "two", file: "assets/voice/s2.mp3", duration: 2.7, words: ws(0.3, 5) },
  ] }));
  const src = path.join(dir, "source.mp4");
  run(["-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=8", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", src]);
  const node = (args) => spawnSync(process.execPath, [path.join(here, "short.mjs"), ...args], { encoding: "utf8", cwd: dir, env: { ...process.env, ...env } });
  const ck = node(["clock", work]);
  assert.equal(ck.status, 0, ck.stdout + ck.stderr);
  const end = JSON.parse(fs.readFileSync(path.join(work, "clock.json"), "utf8")).end;
  return {
    end,
    beats: (extra = {}, first = {}) => fs.writeFileSync(path.join(work, "beats.json"), JSON.stringify({ credit: "Test footage", handle: "@test", hook: { text: "TWO TONES", key: "TONES" },
      beats: [{ id: "a", from: 0, to: 2.5, source: src, at: 0.5, ...first }, { id: "b", from: 2.5, to: +(end + 0.7).toFixed(2), source: src, at: 3 }], ...extra }, (k, v) => (v === undefined ? undefined : v))),
    build: (comp, ...more) => {
      if (!fs.existsSync(path.join(comp, "assets", "voice"))) fs.cpSync(path.join(voice, "assets", "voice"), path.join(comp, "assets", "voice"), { recursive: true });
      return node(["build", work, comp, "--no-captions", "--platform", "tiktok", ...more]);
    },
  };
}
const html = (comp) => fs.readFileSync(path.join(comp, "index.html"), "utf8");

test("build without \"handle\" (left out, null, \"\"): no name at the end, no element, tween or style for it, the card's warning about it gone; the three alike; one with it as before", buildSkip, () => {
  const dir = tmp();
  try {
    const s = short(dir);
    // a card that stands where the handle comes
    const total = +(s.end + 0.7).toFixed(2);
    const compare = { at: 2.6, for: +(total - 0.5 - 2.6).toFixed(2), rows: [["Tone", 2, "2 kHz"], ["Hum", 1, "1 kHz"]] };
    s.beats({ compare });
    const withComp = path.join(dir, "with");
    let r = s.build(withComp);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const withHtml = html(withComp);
    // the handle as it has always been: its element at the end, its pop, its style
    const el = withHtml.match(/ {6}<div id="handle" class="clip layer" data-start="([\d.]+)" data-duration="([\d.]+)" data-track-index="12"><div id="handle-in" class="pill handle">@test<\/div><\/div>\n/);
    assert.ok(el, withHtml);
    assert.equal(+(+el[1] + +el[2]).toFixed(2), total);
    const tween = `      tl.fromTo("#handle-in", { autoAlpha: 0, scale: 0.8 }, { autoAlpha: 1, scale: 1, duration: 0.35, ease: "back.out(2.2)" }, ${el[1]});\n`;
    assert.ok(withHtml.includes(tween));
    const style = withHtml.match(/ {6}\.handle \{ top: \d+px; font-size: 40px; font-weight: 900; letter-spacing: 2px; color: #0a0e14; background: #[0-9a-f]+; padding: 14px 36px; \}\n/)?.[0];
    assert.ok(style);
    assert.match(r.stdout, /! the comparison card stands until [\d.]+ s, the handle comes at [\d.]+ s in the same place: end the card earlier/);
    assert.doesNotMatch(r.stdout, /no handle/);

    const without = {};
    for (const [name, handle] of [["absent", undefined], ["null", null], ["empty", ""], ["blank", "  "]]) {
      s.beats({ compare, handle });
      const comp = path.join(dir, name);
      r = s.build(comp);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const h = html(comp);
      // nothing of the handle, and nothing else changed: the page is the one with it, less its three lines
      assert.doesNotMatch(h, /handle/);
      assert.equal(h, withHtml.replace(el[0], "").replace(tween, "").replace(style, ""));
      assert.match(r.stdout, /, no handle at the end; text placed for /);
      assert.doesNotMatch(r.stdout, /the handle comes/);
      without[name] = filesOf(comp);
    }
    assert.deepEqual(without.null, without.absent);
    assert.deepEqual(without.empty, without.absent);
    assert.deepEqual(without.blank, without.absent);
    // only the page differs from the build with it: the clips are the same
    const w = filesOf(withComp);
    for (const f of Object.keys(w)) if (f !== "index.html") assert.equal(without.absent[f], w[f], f);

    // a handle that is no text: one sentence that says what to do, nothing built
    s.beats({ handle: 42 });
    r = s.build(path.join(dir, "number"));
    assert.equal(r.status, 1);
    assert.equal(r.stdout.trim(), `${path.join("work", "beats.json")}: "handle" is the account's @name as text, shown at the end; leave it out for none.`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("build: freeze-cutout's refusal of a freeze without room reaches the agent unchanged, in one line, and the plain clip is used; a freeze it takes is used", { skip: buildSkip.skip || (!fs.existsSync(cutoutTool) && "no freeze-cutout beside") }, () => {
  const dir = tmp();
  try {
    // the reviewer's case: the first beat 0 to 2.5 s, a freeze 1.33 s in (its refusal comes before any model call)
    const s = short(dir);
    const comp = path.join(dir, "composition");
    s.beats({}, { freeze: 1.33 });
    let r = s.build(comp);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const said = spawnSync(process.execPath, [cutoutTool, path.join(comp, "assets", "clips", "a.mp4"), path.join(dir, "pop.mp4"), "--at", "1.33", "--work", dir], { encoding: "utf8", env: { ...process.env, OPENROUTER_API_KEY: "" }, timeout: 60e3 });
    assert.equal(said.status, 1, said.stdout + said.stderr);
    const sentence = said.stdout.trim();
    assert.equal(sentence.split("\n").length, 1);
    assert.ok(r.stdout.includes(`  ! a: no freeze (${sentence}); the plain clip is used\n`), r.stdout);
    assert.match(html(comp), /src="assets\/clips\/a\.mp4"/);

    // a stand-in that takes the freeze: the frozen clip is used, and said
    const stand = path.join(dir, "cutout.mjs");
    fs.writeFileSync(stand, `import fs from "node:fs";\nconst a = process.argv.slice(2);\nfs.copyFileSync(a[0], a[1]);\n`);
    const t = short(path.join(dir, "taken"), { FREEZE_CUTOUT: stand }), comp2 = path.join(dir, "taken", "composition");
    t.beats({}, { freeze: 1.2 });
    r = t.build(comp2);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /  a: freezes at 1\.2 s; look at /);
    assert.match(html(comp2), /src="assets\/clips\/a-pop\.mp4"/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the freeze's room as the agent reads it: 1.2 s before the beat's end (1 s soft), not the 1.1 s it said before", () => {
  const beats = fs.readFileSync(path.join(here, "..", "references", "beats.md"), "utf8");
  assert.ok(beats.includes("0.2 s or more into the beat and 1.2 s before its end (1 s with `\"pop\": \"soft\"`)"));
});
