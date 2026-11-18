// node --test tools/test.mjs: what b-roll makes of the layout skill's answer for a beat beside the
// person (lib/beside.mjs asks agentitos' layout, its `beside` command) in the frames b-roll makes,
// and that a broll.json of before "beside" builds as it did. No model, no browser: platform-zones
// and layout (beside this skill) give the zones and the fields, ffmpeg makes a picture.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { besideLayout, frameFace, NEEDS_LAYOUT, SOFT_FROM, MATERIAL_LEAST } from "./lib/beside.mjs";
import { rectOf, readBox, personMotion, holePolygon } from "./lib/render.mjs";
import { zones } from "./lib/zones.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, "broll.mjs");
const FRAMES = [[1080, 1920, ["reels"]], [1080, 1920, []], [1080, 1350, []], [1080, 1080, []], [1280, 720, ["youtube"]], [1920, 1080, []]];

const inside = ([x, y, w, h], [X, Y, W, H], slack = 1) => x >= X - slack && y >= Y - slack && x + w <= X + W + slack && y + h <= Y + H + slack;
const apart = ([x, y, w, h], [X, Y, W, H], slack = 1) => x + w <= X + slack || X + W <= x + slack || y + h <= Y + slack || Y + H <= y + slack;
const bottomFree = (z) => z.safe[1] + z.safe[3];

// a face of a medium shot (15 % of the frame's height) and of a close-up (40 %), in px of a
// source of the frame's size
const medium = (W, H) => [W / 2 - 0.06 * H, 0.3 * H, 0.12 * H, 0.15 * H];
const closeUp = (W, H) => [W / 2 - 0.15 * H, 0.36 * H, 0.3 * H, 0.4 * H];
// where captions stand without b-roll, as agentitos' captions writes it (area.json): two lines of
// hormozi at the bottom of the centred box
const captionsOf = (z, W, H) => { const [x, y, w, h] = z.centred, u = Math.min(W, H) / 1080; return { left: x, width: w, bottom: y + h, top: Math.round(y + h - 202 * u), size: Math.round(96 * u), lines: 2 }; };

for (const [W, H, platforms] of FRAMES) {
  const name = `${W}×${H}${platforms.length ? ` (${platforms.join(",")})` : ""}`;
  const z = zones(W, H, platforms);
  const frame = [0, 0, W, H];
  const wide = W > H;

  for (const cap of [null, captionsOf(z, W, H)]) for (const [shot, face] of [["medium shot", medium(W, H)], ["close-up", closeUp(W, H)]]) {
    test(`${name}, ${shot}${cap ? ", captions" : ""}: fields in the frame and apart, the face whole above the apps, the captions clear of it`, () => {
      const L = besideLayout({ width: W, height: H, face, captions: cap, platforms });
      const M = L.material.field, P = L.speaker;
      for (const box of [M, P.field, P.card]) assert.ok(inside(box, frame), `${box} in the frame`);
      assert.ok(inside(M, z.safe) || inside(M, z.wide), `material ${M} in what the apps leave free`);
      assert.ok(M[3] >= MATERIAL_LEAST * H - 1, `the material's field ${M[3]} high enough`);
      assert.ok(inside(P.card, P.field), `card ${P.card} in ${P.field}`);
      assert.ok(apart(M, P.card), `material ${M} and person ${P.card} overlap`);
      assert.ok(inside(P.face, P.card), `face ${P.face} whole in ${P.card}`);
      assert.ok(P.face[1] + P.face[3] <= bottomFree(z) + 1, `chin ${P.face[1] + P.face[3]} above ${bottomFree(z)}`);
      assert.equal(L.side, wide);
      // nothing fails, no need is unmet (a soft finding, as a feed's crop cutting the material, is
      // a warning to read)
      const C0 = L.placement.candidates[L.candidate - 1];
      assert.ok(!C0.problems.some((q) => q.level !== "soft"), L.warnings.join("; "));
      assert.equal(L.warnings.length, C0.problems.length);
      // the host's video: the face lands where the field says (scale, then the shift)
      const f = frameFace(face, null, W, H).box;
      assert.ok(Math.abs(P.left + P.scale * f[0] - P.face[0]) <= 2 && Math.abs(P.top + P.scale * f[1] - P.face[1]) <= 2, "the host's transform puts the face on its place");
      if (cap) {
        const C = L.captions;
        assert.ok(apart(M, C.box), `material ${M} and captions ${C.box} overlap`);
        assert.ok(apart(C.box, P.face), "the captions clear of the face");
        assert.deepEqual([C.box[1] - cap.top, C.box[0] - cap.left], [C.shift.y, C.shift.x], "the shift moves the captions onto their box");
        if (!wide) {
          assert.equal(C.where, "seam");
          assert.ok(C.box[1] >= M[1] + M[3] - 1, "the captions under the material");
          assert.ok(inside(C.box, z.safe), `band ${C.box} in the safe box`);
        } else assert.deepEqual([C.where, C.shift], ["stay", { x: 0, y: 0 }]);
      } else assert.equal(L.captions, null);
    });
  }

  test(`${name}: the same layout for every material, with captions the material shorter, the person the same`, () => {
    const a = besideLayout({ width: W, height: H, platforms, face: medium(W, H) });
    const b = besideLayout({ width: W, height: H, platforms, face: medium(W, H), captions: captionsOf(z, W, H) });
    assert.ok(b.material.field[3] < a.material.field[3]);
    if (!wide) assert.deepEqual(a.speaker.face, b.speaker.face);
  });

  test(`${name}: an odd face (at an edge, very large, tiny, none) still gives fields in the frame`, () => {
    for (const face of [[0, 0, 0.1 * W, 0.1 * H], [W - 50, H - 50, 400, 400], [0, 0, W, H], [W / 2, H / 2, 4, 4], [-200, -300, 0.5 * W, 0.5 * H], null, "x"]) {
      for (const cap of [null, captionsOf(z, W, H)]) {
        const L = besideLayout({ width: W, height: H, platforms, face, captions: cap });
        const P = L.speaker;
        for (const box of [L.material.field, P.field, P.card]) assert.ok(inside(box, frame), `${JSON.stringify(face)}: ${box} in the frame`);
        assert.ok(inside(P.card, P.field), `${JSON.stringify(face)}: card ${P.card} in ${P.field}`);
        assert.ok(apart(L.material.field, P.card), `${JSON.stringify(face)}: material and person overlap`);
        assert.ok(Number.isFinite(P.scale) && P.scale > 0 && Number.isFinite(P.left) && Number.isFinite(P.top));
        assert.ok(P.card[2] > 0 && P.card[3] > 0, `${JSON.stringify(face)}: the person shows`);
      }
    }
  });

  test(`${name}: no face: the usual framing, said`, () => {
    const L = besideLayout({ width: W, height: H, platforms });
    assert.equal(L.speaker.assumed, true);
  });

  test(`${name}: a picture beside the person fits into the material's field`, () => {
    const layout = besideLayout({ width: W, height: H, platforms, face: medium(W, H) });
    for (const [w, h] of [[1170, 2532], [1920, 1080], [800, 800]]) {
      const r = rectOf({ fit: "beside", w, h, layout }, { width: W, height: H, zones: z });
      assert.ok(inside([r.x, r.y, r.w, r.h], layout.material.field), `${w}×${h}`);
    }
  });

  test(`${name}: the panel's hole is the whole frame at the start, the card at the end, inside the moving video in between`, () => {
    for (const face of [medium(W, H), closeUp(W, H)]) {
      const L = besideLayout({ width: W, height: H, platforms, face, captions: captionsOf(z, W, H) });
      const P = L.speaker;
      const poly = holePolygon(W, H, L, 28);
      const terms = [...poly.matchAll(/calc\(([-\d.]+)px \+ ([-\d.]+)px \* var\(--p\) \+ ([-\d.]+)px \* var\(--p\) \* var\(--p\)\)/g)].map((m) => m.slice(1, 4).map(Number));
      assert.ok(terms.length >= 8 && terms.length % 2 === 0);
      const box = (p) => {
        const v = terms.map(([a, b, c]) => a + b * p + c * p * p), xs = v.filter((_, i) => i % 2 === 0), ys = v.filter((_, i) => i % 2 === 1);
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
      };
      const b0 = box(0);
      assert.ok(b0.every((v, i) => Math.abs(v - frame[i]) < 0.5), `at the start ${b0}`);
      const b1 = box(1), [x, y, w, h] = P.card;
      assert.ok(inside([x, y, w, h], b1, 0.5) && inside(b1, [x - 29, y - 29, w + 58, h + 58]), `at the end ${b1} for ${P.card}`);
      for (const p of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const s = 1 + (P.scale - 1) * p, video = [P.left * p, P.top * p, W * s, H * s];
        const hole = box(p), seen = [Math.max(0, hole[0]), Math.max(0, hole[1])];
        const clipped = [seen[0], seen[1], Math.min(W, hole[0] + hole[2]) - seen[0], Math.min(H, hole[1] + hole[3]) - seen[1]];
        assert.ok(inside(clipped, video, 1), `p ${p}: the hole ${clipped.map(Math.round)} inside the video ${video.map(Math.round)}`);
      }
    }
  });
}

// what captions' build wrote for two lines of hormozi in 1080×1920 for Reels (area.json)
const REELS_CAPTIONS = { left: 120, width: 840, top: 1298, bottom: 1500, size: 96, lines: 2 };

test("the owner's close-up (1080×1920, Reels, two caption lines): the face 22 %, the person's card about 600 px wide", () => {
  const L = besideLayout({ width: 1080, height: 1920, face: [280, 700, 560, 760], source: [1080, 1920], captions: REELS_CAPTIONS, platforms: ["reels"] });
  assert.ok(Math.abs(L.speaker.facePct - 22) <= 0.3, `face ${L.speaker.facePct} %`);
  assert.ok(Math.abs(L.speaker.card[2] - 600) <= 15, `card ${L.speaker.card}`);
  assert.equal(L.captions.where, "seam");
  assert.ok(apart(L.captions.box, L.speaker.face) && apart(L.captions.box, L.material.field));
  // the captions stand on the panel: the person's card begins under them (the command's own
  // window begins at the seam, under their lower line), with the face whole in it
  assert.equal(L.speaker.card[1], L.captions.box[1] + L.captions.box[3]);
  assert.ok(apart(L.captions.box, L.speaker.card), `captions ${L.captions.box} over the card ${L.speaker.card}`);
  assert.ok(inside(L.speaker.face, L.speaker.card), `face ${L.speaker.face} in ${L.speaker.card}`);
  assert.ok(L.placement.candidates[L.candidate - 1].speaker.window[1] < L.speaker.card[1], "the command's window begins higher");
  assert.equal(L.warnings.length, 0, L.warnings.join("; "));
  // the call that gave it: the owner's settings, the captions' area, the person filling the frame
  const call = L.call.join(" ");
  for (const part of ["--frame 1080x1920", "--platform reels", "--source 1080x1920", "--face 280,700,560,760", "--caption-area 120,840,1298,1500,96,2", "--text caption:2", "--before 1,0,0", "beside.wish=0.22", "beside.face=0.18", "beside.faceUpTo=2", "weights.enlarge.softFrom=1.25"]) assert.ok(call.includes(part), `${part} in ${call}`);
  assert.equal(L.placement.kind, "beside");
  assert.equal(L.placement.candidates[L.candidate - 1].speaker.shape, "rect");
});

test("a medium shot stays sharp in every frame: not enlarged over 1.25 of its pixels for the wish, and not under 18 %; said", () => {
  for (const [W, H] of [[1080, 1920], [1080, 1350], [1080, 1080], [1280, 720], [1920, 1080]]) {
    const L = besideLayout({ width: W, height: H, face: medium(W, H) });
    const f = frameFace(medium(W, H), null, W, H);
    assert.ok(L.speaker.scale * f.cover <= SOFT_FROM + 1e-3, `${W}×${H}: enlarged ${L.speaker.scale}`);
    assert.ok(L.speaker.facePct >= 18 - 0.1 && L.speaker.facePct < 22, `${W}×${H}: face ${L.speaker.facePct} %`);
    assert.equal(L.warnings.length, 0, L.warnings.join("; "));
    assert.ok(L.notes.some((x) => /22 %.*asked for/.test(x)), L.notes.join("; "));
  }
});

test("a small face is enlarged twice at most, and that is said", () => {
  const L = besideLayout({ width: 1080, height: 1920, face: [500, 600, 60, 80] });
  assert.ok(L.speaker.scale <= 2 + 1e-3, `×${L.speaker.scale}`);
  assert.ok(L.warnings.some((x) => /enlarged/.test(x)), L.warnings.join("; "));
});

test("without agentitos' layout the build stops with one sentence", () => {
  // b-roll alone, with platform-zones named, and no layout beside it or named
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "broll-nolayout-"));
  try {
    fs.cpSync(path.dirname(HERE), path.join(tmp, "b-roll"), { recursive: true });
    const words = Array.from({ length: 20 }, (_, i) => ({ i, text: "word", start: i * 0.4, end: i * 0.4 + 0.3 }));
    fs.writeFileSync(path.join(tmp, "words.json"), JSON.stringify({ width: 1080, height: 1920, duration: 8, words }));
    fs.writeFileSync(path.join(tmp, "broll.json"), JSON.stringify({ beats: [{ at: 2, until: 6, number: "3×" }] }));
    const env = { ...process.env, PLATFORM_ZONES: path.join(path.dirname(HERE), "..", "platform-zones", "tools", "zones.mjs") };
    delete env.LAYOUT;
    const r = spawnSync(process.execPath, [path.join(tmp, "b-roll", "tools", "broll.mjs"), "build", "broll.json", "words.json", "out"], { encoding: "utf8", cwd: tmp, env });
    if (fs.existsSync("/home/sprite/skills/layout/tools/place.mjs")) return;   // (the machine's clone would be found)
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(r.stdout.trim(), `✗ ${NEEDS_LAYOUT}`);
    assert.ok(!fs.existsSync(path.join(tmp, "out")), "nothing built");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("a face in the source's pixels lands in the frame as the host fills it", () => {
  const f = frameFace([1000, 400, 400, 500], [2160, 3840], 1080, 1920);
  assert.deepEqual(f.box, [500, 200, 200, 250]);
  const g = frameFace([700, 100, 200, 220], [1920, 1080], 1080, 1920);   // a wide video cut to 9:16
  assert.ok(Math.abs(g.cover - 1920 / 1080) < 1e-9 && Math.abs(g.box[0] - (700 * g.cover - (1920 * g.cover - 1080) / 2)) < 1e-9);
});

test("the person moves in and out once over beats that touch, the captions with them; set in place next to a beat over the whole frame", () => {
  const L = { speaker: { left: 10, top: 20, scale: 0.5 }, captions: { shift: { x: 0, y: -600 } } };
  const beat = (n, start, end, fit, enter, leave) => ({ n, start, end, duration: end - start, fit, enter, leave, layout: L, moveIn: 0.5, moveOut: 0.5 });
  assert.equal(personMotion([beat(1, 1, 3, "fill")]), null);
  const s = personMotion([beat(1, 1, 3, "beside", "move", "cut"), beat(2, 3, 5, "beside", "cut", "move"), beat(3, 8, 10, "beside", "move", "cut"), beat(4, 10, 12, "fill")]);
  assert.equal((s.match(/fromTo\(el/g) || []).length, 3, s);        // in at 1, out before 5, in at 8
  assert.match(s, /tl\.set\(el, \{ x: 0, y: 0, scale: 1 \}, 10\)/);   // back under the full-frame beat
  // the captions change place unseen at each move's middle (their way leads across the face):
  // out, set, in again; beside the cut at 10 they are set at once
  assert.equal((s.match(/fromTo\(cap, \{ opacity: 1 \}, \{ opacity: 0, duration: 0\.15/g) || []).length, 3, s);
  assert.equal((s.match(/fromTo\(cap, \{ opacity: 0 \}, \{ opacity: 1, duration: 0\.15/g) || []).length, 3, s);
  assert.match(s, /tl\.set\(cap, \{ x: 0, y: -600 \}, 1\.25\)/);       // in at 1 to 1.5
  assert.match(s, /tl\.set\(cap, \{ x: 0, y: 0 \}, 4\.75\)/);          // out at 4.5 to 5
  assert.match(s, /tl\.set\(cap, \{ x: 0, y: -600 \}, 8\.25\)/);
  assert.match(s, /if \(cap\) tl\.set\(cap, \{ x: 0, y: 0 \}, 10\);/);
  assert.doesNotMatch(s, /fromTo\(cap, \{ x:/);                       // never travelled
});

test("readBox and the old fits are as before", () => {
  const z = zones(1080, 1920, []);
  const [x, y, w, h] = readBox({ width: 1080, height: 1920, zones: z });
  assert.deepEqual([x, y, w], z.centred.slice(0, 3));
  assert.equal(h, z.centred[3] - 320);
  assert.deepEqual(rectOf({ fit: "fill", w: 1080, h: 1920 }, { width: 1080, height: 1920, zones: z }), { x: 0, y: 0, w: 1080, h: 1920, scale: 1 });
});

test("an old broll.json builds as before; a number and a page are beside the person unless told otherwise", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "broll-test-"));
  try {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=1080x1920", "-frames:v", "1", path.join(tmp, "photo.png")]);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=white:s=1170x1800", "-frames:v", "1", path.join(tmp, "page.png")]);
    fs.writeFileSync(path.join(tmp, "page.png.json"), JSON.stringify({ kind: "page", url: "https://example.com" }));
    const words = Array.from({ length: 80 }, (_, i) => ({ i, text: i % 8 === 7 ? "end." : "word", start: i * 0.4, end: i * 0.4 + 0.3 }));
    fs.writeFileSync(path.join(tmp, "words.json"), JSON.stringify({ width: 1080, height: 1920, duration: 32, words }));
    const build = (beats, dir) => {
      fs.writeFileSync(path.join(tmp, `${dir}.json`), JSON.stringify({ beats }));
      const r = spawnSync(process.execPath, [TOOL, "build", path.join(tmp, `${dir}.json`), path.join(tmp, "words.json"), path.join(tmp, dir)], { encoding: "utf8", cwd: tmp });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      return { said: r.stdout, beats: JSON.parse(fs.readFileSync(path.join(tmp, dir, "beats.json"), "utf8")).beats, html: fs.readFileSync(path.join(tmp, dir, "index.html"), "utf8") };
    };
    // fits written out: what they were
    const old = build([
      { at: 2, until: 6, show: "photo.png", fit: "fill" },
      { at: 20, until: 26, show: "page.png", fit: "read" },
      { at: 40, until: 45, number: "+300 %", fit: "fill" },
      { at: 60, until: 64, show: "photo.png" },
    ], "old");
    assert.deepEqual(old.beats.map((b) => b.fit), ["fill", "read", "fill", "fill"]);
    assert.doesNotMatch(old.html, /class="clip broll-(panel|field)"|\.broll-panel/);
    assert.match(old.html, /class="clip broll-card"/);
    assert.doesNotMatch(old.said, /broll-person-motion/);
    // nothing written: a number and what shot took go beside the person, a photo fills
    const now = build([{ at: 2, until: 6, number: "3×" }, { at: 20, until: 26, show: "page.png" }, { at: 60, until: 64, show: "photo.png" }], "now");
    assert.deepEqual(now.beats.map((b) => b.fit), ["beside", "beside", "fill"]);
    assert.match(now.html, /broll-panel/);
    assert.match(now.said, /<script id="broll-person-motion">/);
    assert.match(now.said, /the face is assumed/);
    // the layout skill's answer kept beside the build, to look at; none where no beat is beside
    assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, "now", "placement.json"), "utf8")).speaker.assumed, true);
    assert.ok(!fs.existsSync(path.join(tmp, "old", "placement.json")));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
