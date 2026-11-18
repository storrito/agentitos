// node --test tools/test.mjs: where a beat beside the person goes (lib/beside.mjs) for the frames
// b-roll makes, and that a broll.json of before "beside" builds as it did. No model, no browser:
// platform-zones (beside this skill) gives the zones, ffmpeg makes a picture.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { besideLayout, assumedFace, frameFace, HAIR, FACE_TARGET, FACE_LEAST, MATERIAL_LEAST } from "./lib/beside.mjs";
import { rectOf, readBox, personMotion, holePolygon } from "./lib/render.mjs";
import { zones } from "./lib/zones.mjs";

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), "broll.mjs");
const FRAMES = [[1080, 1920, ["reels"]], [1080, 1920, []], [1080, 1350, []], [1080, 1080, []], [1280, 720, ["youtube"]], [1920, 1080, []]];

const inside = ([x, y, w, h], [X, Y, W, H], slack = 1) => x >= X - slack && y >= Y - slack && x + w <= X + W + slack && y + h <= Y + H + slack;
const apart = ([x, y, w, h], [X, Y, W, H]) => x + w <= X || X + W <= x || y + h <= Y || Y + H <= y;
const bottomFree = (z) => z.safe[1] + z.safe[3];

// a face of a medium shot (15 % of the frame's height) and of a close-up (40 %), in px of a
// source of the frame's size
const medium = (W, H) => [W / 2 - 0.06 * H, 0.3 * H, 0.12 * H, 0.15 * H];
const closeUp = (W, H) => [W / 2 - 0.15 * H, 0.36 * H, 0.3 * H, 0.4 * H];
// where captions stand without b-roll, as agentitos' captions says it (area.json): two lines of
// hormozi at the bottom of the centred box
const captionsOf = (z, W, H) => { const [x, y, w, h] = z.centred, u = Math.min(W, H) / 1080; return { left: x, width: w, bottom: y + h, top: Math.round(y + h - 202 * u), size: Math.round(96 * u) }; };

for (const [W, H, platforms] of FRAMES) {
  const name = `${W}×${H}${platforms.length ? ` (${platforms.join(",")})` : ""}`;
  const z = zones(W, H, platforms);
  const frame = [0, 0, W, H];
  const wide = W / H > 1.2;

  for (const cap of [null, captionsOf(z, W, H)]) for (const [shot, face] of [["medium shot", medium(W, H)], ["close-up", closeUp(W, H)]]) {
    test(`${name}, ${shot}${cap ? ", captions" : ""}: fields in the frame and apart, the face whole at its target`, () => {
      const L = besideLayout({ width: W, height: H, zones: z, face, captions: cap });
      const M = L.material.field, P = L.speaker;
      for (const box of [M, P.field, P.card]) assert.ok(inside(box, frame), `${box} in the frame`);
      assert.ok(inside(M, z.safe), `material ${M} in safe ${z.safe}`);
      assert.ok(M[3] >= (wide ? 0.3 : MATERIAL_LEAST) * H - 1, `the material's field ${M[3]} high enough`);
      assert.ok(inside(P.card, P.field), `card ${P.card} in ${P.field}`);
      assert.ok(apart(M, P.card), `material ${M} and person ${P.card} overlap`);
      assert.ok(inside(P.face, P.card), `face ${P.face} whole in ${P.card}`);
      assert.ok(P.face[1] + P.face[3] <= bottomFree(z) + 1, `chin ${P.face[1] + P.face[3]} above ${bottomFree(z)}`);
      assert.ok(P.face[1] - HAIR * P.face[3] >= P.card[1] - 1, "room for the hair above the face");
      assert.ok(P.facePct >= FACE_LEAST * 100 - 0.1, `face ${P.facePct} %`);
      if (!wide) assert.ok(Math.abs(P.face[3] - FACE_TARGET * H) <= 2 || L.notes.some((x) => /gives way/.test(x)), `face ${P.face[3]} at the target ${FACE_TARGET * H}`);
      assert.equal(L.warnings.length, 0, L.warnings.join("; "));
      if (cap) {
        const C = L.captions;
        assert.ok(apart(M, C.box), `material ${M} and captions ${C.box} overlap`);
        assert.ok(apart(C.box, P.face), "the captions clear of the face");
        if (!wide) {
          // on the seam: under the material, over the person's field, the hair's room under them
          assert.equal(C.where, "seam");
          assert.equal(cap.bottom + C.shift.y, C.box[1] + C.box[3]);
          assert.ok(C.box[1] >= M[1] + M[3], "the captions under the material");
          assert.ok(P.face[1] - HAIR * P.face[3] >= C.box[1] + C.box[3] - 1, "the hair's room between captions and face");
          assert.ok(inside(C.box, z.safe), `band ${C.box} in the safe box`);
        } else assert.deepEqual([C.where, C.shift], ["stay", { x: 0, y: 0 }]);
      }
    });
  }

  test(`${name}: the same layout for every material, with captions the material shorter, the person the same`, () => {
    const a = besideLayout({ width: W, height: H, zones: z, face: medium(W, H) });
    const b = besideLayout({ width: W, height: H, zones: z, face: medium(W, H), captions: captionsOf(z, W, H) });
    assert.ok(b.material.field[3] < a.material.field[3]);
    if (!wide) assert.deepEqual(a.speaker.face, b.speaker.face);
  });

  test(`${name}: an odd face (at an edge, very large, tiny, none) still gives fields in the frame`, () => {
    for (const face of [[0, 0, 0.1 * W, 0.1 * H], [W - 50, H - 50, 400, 400], [0, 0, W, H], [W / 2, H / 2, 4, 4], [-200, -300, 0.5 * W, 0.5 * H], null, "x"]) {
      for (const cap of [null, captionsOf(z, W, H)]) {
        const L = besideLayout({ width: W, height: H, zones: z, face, captions: cap });
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
    const L = besideLayout({ width: W, height: H, zones: z });
    assert.equal(L.speaker.assumed, true);
  });

  test(`${name}: a picture beside the person fits into the material's field`, () => {
    const layout = besideLayout({ width: W, height: H, zones: z, face: medium(W, H) });
    for (const [w, h] of [[1170, 2532], [1920, 1080], [800, 800]]) {
      const r = rectOf({ fit: "beside", w, h, layout }, { width: W, height: H, zones: z });
      assert.ok(inside([r.x, r.y, r.w, r.h], layout.material.field), `${w}×${h}`);
    }
  });

  test(`${name}: the panel's hole is the whole frame at the start, the card at the end, inside the moving video in between`, () => {
    for (const face of [medium(W, H), closeUp(W, H)]) {
      const L = besideLayout({ width: W, height: H, zones: z, face, captions: captionsOf(z, W, H) });
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

test("1080×1920, the usual apps, hormozi captions, the take's close-up: the numbers of the layout", () => {
  const z = zones(1080, 1920, []);
  const L = besideLayout({ width: 1080, height: 1920, zones: z, face: [280, 700, 560, 760], source: [1080, 1920], captions: { left: 192, width: 696, top: 1238, bottom: 1440, size: 96 } });
  assert.deepEqual(L.speaker.face, [413, 1070, 255, 346]);      // 18 %, ending above the bottom zone (1440 less 24)
  assert.deepEqual(L.captions.box, [192, 747, 696, 202]);       // two lines on the seam, 121 px of hair's room under them
  assert.deepEqual(L.material.field, [60, 250, 828, 473]);      // from the safe box's top to 24 px above them
  assert.equal(L.speaker.card[1], 949);
});

test("the face gives way to the material, not under 12 %, and says so", () => {
  // a low captions' band leaves the material too little: the face gives way
  const z = zones(1080, 1920, []);
  const L = besideLayout({ width: 1080, height: 1920, zones: z, face: [440, 600, 200, 288], captions: { left: 192, width: 696, top: 900, bottom: 1440 } });
  assert.ok(L.speaker.face[3] < FACE_TARGET * 1920 && L.speaker.face[3] >= FACE_LEAST * 1920 - 1);
  assert.ok(L.notes.some((x) => /gives way/.test(x)));
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
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
