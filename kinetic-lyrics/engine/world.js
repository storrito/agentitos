// Kinetic world — the illustrative layer behind the typography, drawn with Canvas 2D on the
// CPU (no WebGL): it renders in a fraction of the time a software-rasterised 3D scene takes.
// Everything is a pure function of (plan, time): no clocks, no frame history.
//
// The look follows the former three.js world: per-world backgrounds from noise textures made
// once at mount and only moved and tinted per frame, motifs projected with a simple pinhole
// camera, additive light on a separate layer, and a bloom from down- and up-scaled copies.
//
// Bundled by tools/build.mjs (esbuild, IIFE, global `KineticWorld`).

import { createSignals } from "./signals.js";

// ---------------------------------------------------------------- helpers

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, k) => a + (b - a) * k;
const mixc = (a, b, k) => [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)];
const mulc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const rgba = (c, a = 1) => `rgba(${Math.round(clamp01(c[0]) * 255)},${Math.round(clamp01(c[1]) * 255)},${Math.round(clamp01(c[2]) * 255)},${clamp01(a).toFixed(3)})`;
const fract = (x) => x - Math.floor(x);

// value noise, as the shaders had it
function hash12(x, y) {
  let p3x = fract(x * 0.1031), p3y = fract(y * 0.1031), p3z = fract(x * 0.1031);
  const d = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
  p3x += d; p3y += d; p3z += d;
  return fract((p3x + p3y) * p3z);
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash12(ix, iy), b = hash12(ix + 1, iy), c = hash12(ix, iy + 1), d = hash12(ix + 1, iy + 1);
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}
function fbm(x, y, oct = 5) {
  let v = 0, a = 0.5;
  for (let i = 0; i < oct; i++) {
    v += a * vnoise(x, y);
    const nx = 1.6 * x - 1.2 * y, ny = 1.2 * x + 1.6 * y;
    x = nx; y = ny; a *= 0.5;
  }
  return v;
}

function canvasOf(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  // willReadFrequently keeps the canvas in CPU memory: Skia's software raster, no GPU emulation
  const g = c.getContext("2d", { willReadFrequently: true });
  return [c, g];
}

// a grey texture as white with alpha = f(x, y) in 0..1
function alphaTexture(w, h, f) {
  const [c, g] = canvasOf(w, h);
  const img = g.createImageData(c.width, c.height);
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const i = (y * c.width + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.round(clamp01(f(x / c.width, y / c.height)) * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------- mount

export function mount(canvas, plan) {
  const W = plan.width, H = plan.height, aspect = W / H;
  const rnd = mulberry32(plan.seed * 9973 + 17);
  const S = createSignals(plan);
  const ctx = canvas.getContext("2d", { willReadFrequently: true, alpha: false });

  const WORLD = plan.world || "cosmos";
  const INK = WORLD === "editorial", STUDIO = WORLD === "geometry", AURORA = WORLD === "aurora";
  const BOKEH = WORLD === "bokeh", NEON = WORLD === "neon", NOIR = WORLD === "noir";
  const VIDEO = !!plan.video;
  const CAM_MOVE = plan.style?.drift ?? 1;

  // camera: the short side keeps a 40° field of view, as before
  const CAM_Z = 10;
  const vfov = aspect >= 1 ? (40 * Math.PI) / 180 : 2 * Math.atan(Math.tan((20 * Math.PI) / 180) / aspect);
  const halfH = Math.tan(vfov / 2) * CAM_Z, halfW = halfH * aspect;
  const U = Math.min(halfW, halfH);
  const VY = VIDEO ? -halfH * 0.42 : 0, VS = VIDEO ? 0.68 : 1;
  let cam = { x: 0, y: 0, z: CAM_Z, zoom: 1, roll: 0 };
  const F0 = (H / 2) / halfH * CAM_Z; // pixels per world unit at distance 1
  // world point → screen; null behind the camera. s = pixels per world unit at that depth
  function proj(x, y, z) {
    const d = cam.z - z;
    if (d < 0.2) return null;
    const s = (F0 * cam.zoom) / d;
    let px = (x - cam.x) * s, py = (y - cam.y) * s;
    if (cam.roll) { const c = Math.cos(cam.roll), n = Math.sin(cam.roll); [px, py] = [px * c - py * n, px * n + py * c]; }
    return { x: W / 2 + px, y: H / 2 - py, s, d };
  }

  // ------------------------------------------------ layers
  const [fx, fg] = canvasOf(W, H); // additive light (motifs), black = nothing
  const BL = [4, 8, 16].map((k) => canvasOf(W / k, H / k)); // bloom pyramid
  const [inv, ig] = INK ? canvasOf(W, H) : [null, null];

  // tinted sprites, cached by quantised colour
  const spriteCache = new Map();
  function sprite(kind, c) {
    const q = (v) => Math.round(clamp01(v) * 23);
    const key = `${kind}${q(c[0])},${q(c[1])},${q(c[2])}`;
    let s = spriteCache.get(key);
    if (s) return s;
    const R = kind === "disc" ? 96 : 48;
    const [cv, g] = canvasOf(R * 2, R * 2);
    const col = [q(c[0]) / 23, q(c[1]) / 23, q(c[2]) / 23];
    const gr = g.createRadialGradient(R, R, 0, R, R, R);
    if (kind === "disc") {
      // an out-of-focus light: a flat disc with a brighter rim
      gr.addColorStop(0, rgba(col, 0.55)); gr.addColorStop(0.7, rgba(col, 0.55));
      gr.addColorStop(0.86, rgba(col, 0.95)); gr.addColorStop(0.95, rgba(col, 0.75)); gr.addColorStop(1, rgba(col, 0));
    } else {
      gr.addColorStop(0, rgba(col, 1)); gr.addColorStop(0.25, rgba(col, 0.55)); gr.addColorStop(0.6, rgba(col, 0.12)); gr.addColorStop(1, rgba(col, 0));
    }
    g.fillStyle = gr; g.fillRect(0, 0, R * 2, R * 2);
    s = cv;
    if (spriteCache.size > 600) spriteCache.clear();
    spriteCache.set(key, s);
    return s;
  }

  // ------------------------------------------------ textures, made once
  const TW = 200, TH = Math.round(200 / aspect);
  const asp = (x, y) => [(x - 0.5) * aspect / Math.max(Math.min(1, aspect), 0.6), (y - 0.5) / Math.max(Math.min(1, aspect), 0.6)];
  // cosmos nebula: domain-warped fbm (the former shader at t = 0)
  const nebulaN = (u, v) => {
    const [x, y] = asp(u, v);
    const qx = fbm(x * 1.3, y * 1.3, 4), qy = fbm(x * 1.3 + 5.2, y * 1.3 + 1.3, 4);
    const rx = fbm(x * 1.6 + 2.2 * qx + 1.7, y * 1.6 + 2.2 * qy + 9.2, 4), ry = fbm(x * 1.6 + 2.2 * qx + 8.3, y * 1.6 + 2.2 * qy + 2.8, 4);
    return fbm(x * 1.7 + 2.4 * rx, y * 1.7 + 2.4 * ry, 4);
  };
  const tex = {};
  if (WORLD === "cosmos") {
    const vals = new Float32Array(TW * TH);
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) vals[y * TW + x] = nebulaN(x / TW, y / TH);
    const at = (u, v) => vals[Math.min(TH - 1, Math.floor(v * TH)) * TW + Math.min(TW - 1, Math.floor(u * TW))];
    tex.mid = alphaTexture(TW, TH, (u, v) => smooth(0.25, 0.95, at(u, v)));
    tex.hi = alphaTexture(TW, TH, (u, v) => Math.pow(smooth(0.55, 1, at(u, v)), 3));
  }
  if (WORLD === "cosmos" || NOIR || AURORA) tex.cloud = alphaTexture(TW * 2, TH * 2, (u, v) => { const [x, y] = asp(u, v); return smooth(0.42, 0.9, fbm(x * 2.2, y * 2.2)); });
  if (NOIR) tex.haze = alphaTexture(TW, TH, (u, v) => { const [x, y] = asp(u, v); return 0.6 + 0.4 * fbm(x * 2, y * 2); });
  if (INK) {
    const pw = Math.round(W / 2), ph = Math.round(H / 2);
    tex.mottle = alphaTexture(TW, TH, (u, v) => { const x = u * aspect, y = v; return clamp01(0.55 + (fbm(x * 3.2, y * 3.2) * 0.5 + fbm(x * 11, y * 11) * 0.25) * 0.6); });
    // paper fibre: fine streaks in two directions, as a grey to multiply with
    const [c, g] = canvasOf(pw, ph);
    const img = g.createImageData(pw, ph);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const u = (x / pw) * aspect, v = y / ph;
      const fib = vnoise(u * 420, v * 160) * 0.5 + vnoise(u * 160, v * 520) * 0.5;
      const k = Math.round(255 * (1 - (fib - 0.5) * 0.035 * 2.2));
      const i = (y * pw + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, k); img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    tex.fibre = c;
  }
  // vignette (black, alpha by distance)
  // in frame coordinates (0..1 on both axes), the x distance weighted 1.25, as the shaders had it
  const vignette = (strength, r0, r1) => {
    const [c, g] = canvasOf(W / 4, H / 4);
    g.scale(c.width / 1.25, c.height);
    const gr = g.createRadialGradient(0.625, 0.5, 0, 0.625, 0.5, r1);
    for (let i = 0; i <= 8; i++) {
      const o = r0 / r1 + (1 - r0 / r1) * (i / 8);
      gr.addColorStop(o, `rgba(0,0,0,${(strength * smooth(0, 1, i / 8)).toFixed(3)})`);
    }
    gr.addColorStop(0, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 1.25, 1);
    return c;
  };
  const VIG = vignette(STUDIO ? 0.16 : AURORA ? 0.35 : BOKEH ? 0.5 : NEON ? 0.4 : NOIR ? 0.6 : INK ? 0.07 : 0.55, 0.45, 1.25);

  // ------------------------------------------------ motif data (seeded once)
  // particles: dust / embers / rising / rain / warp / stars
  const NP = 1400, P = [];
  for (let i = 0; i < NP; i++) P.push([rnd(), rnd(), rnd(), rnd()]);
  const NS = 420, SK = [];
  for (let i = 0; i < NS; i++) SK.push([rnd(), rnd(), rnd(), rnd()]);
  const box = { x: halfW * 2.4, y: halfH * 2.4 };
  const wrapc = (v, h) => ((((v + h) % (2 * h)) + 2 * h) % (2 * h)) - h;
  function particlePos(s, ph, out) {
    const sp = 0.45 + s[3] * 1.1;
    let x = (s[0] * 2 - 1) * box.x, y = (s[1] * 2 - 1) * box.y, z = mix(-34, 7.5, s[2]);
    x += Math.sin(ph.t * 0.21 * sp + s[3] * 31) * 0.35; y += Math.cos(ph.t * 0.17 * sp + s[0] * 23) * 0.35;
    y = wrapc(y - ph.rain * sp * 1.3 + ph.rise * sp * 0.9, box.y);
    x = wrapc(x - ph.rain * sp * 0.18, box.x);
    z = -34 + ((((z + 34 + ph.warp * sp * 2.2) % 41.5) + 41.5) % 41.5);
    const a = ph.swirl * (0.15 + 0.6 / (1 + Math.hypot(x, y) * 0.25));
    const c = Math.cos(a), n = Math.sin(a);
    [x, y] = [x * c - y * n, x * n + y * c];
    x *= 1 + ph.shock * 0.25 * (1 - s[2]); y *= 1 + ph.shock * 0.25 * (1 - s[2]);
    out.x = x; out.y = y; out.z = z; out.sp = sp;
    return out;
  }
  // bokeh discs
  const BK = [];
  for (let i = 0; i < 70; i++) BK.push([rnd(), rnd(), rnd(), rnd()]);
  // rings
  const ringDefs = [[1.0, 0.0105], [1.24, 0.006], [1.52, 0.0045], [0.82, 0.004]];
  // planet: dots on a sphere with land from noise
  const R = U * 1.55, PL = [];
  {
    const N = 1700, golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = golden * i;
      const n = [Math.cos(th) * r, y, Math.sin(th) * r];
      const land = smooth(0.48, 0.62, fbm(Math.atan2(n[2], n[0]) * 1.6 + 3, n[1] * 2.6 + 3));
      PL.push({ n, land });
    }
  }
  // shards
  const breakEvents = plan.events.filter((e) => e.motif === "shards").map((e) => {
    const w = plan.words[e.word];
    return { t: w.start + Math.min(0.35, (w.end - w.start) * 0.6), strength: e.strength };
  });
  const SH = [];
  for (let i = 0; i < 120; i++) {
    const a = rnd() * Math.PI * 2, el = (rnd() - 0.5) * 1.2;
    SH.push({
      p0: [(rnd() - 0.5) * U * 1.6, (rnd() - 0.5) * U * 0.7, (rnd() - 0.5) * 0.8],
      v: [Math.cos(a) * (2 + rnd() * 7), Math.sin(a) * (1 + rnd() * 5) + el, 1 + rnd() * 4.5],
      r: [rnd() * 6, rnd() * 6, rnd() * 6], w: [rnd() * 8 - 4, rnd() * 8 - 4, rnd() * 8 - 4],
      s: U * (0.05 + rnd() ** 2 * 0.22),
    });
  }
  // lightning: midpoint-displaced polylines
  const BOLTS = [];
  for (let b = 0; b < 5; b++) {
    let pts = [[(rnd() - 0.5) * halfW * 1.6, halfH * 1.3, -6 - rnd() * 6], [(rnd() - 0.5) * halfW * 1.4, -halfH * 1.3, -6 - rnd() * 6]];
    let disp = halfH * 0.5;
    for (let it = 0; it < 6; it++) {
      const out = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], c = pts[i + 1];
        const m = [(a[0] + c[0]) / 2 + (rnd() - 0.5) * disp, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2 + (rnd() - 0.5) * disp * 0.3];
        out.push(a, m);
      }
      out.push(pts[pts.length - 1]);
      pts = out; disp *= 0.55;
    }
    BOLTS.push(pts);
  }
  // chart: an upward-trending walk
  const CH = [];
  {
    let y = 0;
    for (let i = 0; i < 90; i++) {
      const x = i / 89;
      y += (rnd() - 0.32) * 0.05;
      CH.push([x, Math.max(0, 0.08 + x * x * 0.75 + y * 0.6 + Math.sin(x * 9) * 0.03)]);
    }
  }
  // network: nodes on a shell, nearest-neighbour links
  const NET = [], LINKS = [];
  {
    for (let i = 0; i < 120; i++) {
      const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1), rr = U * (1.35 + rnd() * 0.5);
      NET.push({ p: [Math.sin(ph) * Math.cos(th) * rr * 1.5, Math.cos(ph) * rr * 0.85, Math.sin(ph) * Math.sin(th) * rr * 0.6], s: rnd() });
    }
    NET.forEach((a, i) => {
      const near = NET.map((b, j) => [(a.p[0] - b.p[0]) ** 2 + (a.p[1] - b.p[1]) ** 2 + (a.p[2] - b.p[2]) ** 2, j]).filter(([, j]) => j !== i).sort((x, y) => x[0] - y[0]).slice(0, 3);
      for (const [, j] of near) if (j > i) LINKS.push([i, j]);
    });
  }
  // skyline towers
  const TOWERS = [];
  for (let i = 0; i < 46; i++) {
    const w = 1.2 + rnd() * 2.6, h = 1.5 + rnd() ** 2.2 * 9;
    TOWERS.push({ x: (i / 45 - 0.5) * 120 + (rnd() - 0.5) * 2, z: -46 - rnd() * 12, w, h, seed: rnd() * 100 });
  }
  TOWERS.sort((a, b) => a.z - b.z);
  // studio objects
  const STUDIO_OBJS = [];
  if (STUDIO) for (let i = 0; i < 15; i++) {
    STUDIO_OBJS.push({
      kind: i % 8, a: (i / 15) * Math.PI * 2 + (rnd() - 0.5) * 0.35, z: -1.2 - rnd() * 3.6, s: U * (0.1 + rnd() * 0.13), slot: i % 4,
      rx: rnd() * 6, ry: rnd() * 6, wx: (rnd() - 0.5) * 0.6, wy: 0.15 + rnd() * 0.35, bob: rnd() * 6, sp: 0.6 + rnd() * 0.8,
    });
  }

  // rotate a vector by Euler angles (x, then y, then z)
  function rot(v, ax, ay, az) {
    let [x, y, z] = v;
    let c = Math.cos(ax), s = Math.sin(ax); [y, z] = [y * c - z * s, y * s + z * c];
    c = Math.cos(ay); s = Math.sin(ay); [x, z] = [x * c + z * s, -x * s + z * c];
    c = Math.cos(az); s = Math.sin(az); [x, y] = [x * c - y * s, x * s + y * c];
    return [x, y, z];
  }

  // ------------------------------------------------ backgrounds
  function tinted(texture, col, alpha, dx = 0, dy = 0, scale = 1.15) {
    if (alpha <= 0.002) return;
    const [c, g] = tintBuf(texture);
    g.globalCompositeOperation = "copy"; g.drawImage(texture, 0, 0);
    g.globalCompositeOperation = "source-in"; g.fillStyle = rgba(col); g.fillRect(0, 0, c.width, c.height);
    ctx.globalAlpha = clamp01(alpha);
    const w = W * scale, h = H * scale;
    ctx.drawImage(c, (W - w) / 2 + dx, (H - h) / 2 + dy, w, h);
    ctx.globalAlpha = 1;
  }
  const tintBufs = new Map();
  function tintBuf(texture) {
    const k = `${texture.width}x${texture.height}`;
    if (!tintBufs.has(k)) tintBufs.set(k, canvasOf(texture.width, texture.height));
    return tintBufs.get(k);
  }
  function radial(g, x, y, r, col, a, stops = [[0, 1], [1, 0]]) {
    if (a <= 0.002 || r <= 0) return;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    for (const [o, k] of stops) gr.addColorStop(o, rgba(col, a * k));
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // p-space of the shaders (y up, short side ~1) → pixels
  const SPX = Math.max(Math.min(W, H), 0.6 * H);
  const px = (x) => W / 2 + x * SPX, py = (y) => H / 2 - y * SPX;

  function background(t, pal, L, fade) {
    const [c0, c1, c2, c3] = pal;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = rgba(c0); ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    const sunY = L.sunY;
    if (NOIR) {
      // a dark room cut by slanted light through blinds; light / idea words open them wider.
      // The beams and their slats are drawn small (they are soft) and added onto the room.
      const tt = t * 0.05, [bc, bg] = BL[0], k = W / bc.width;
      bg.globalCompositeOperation = "source-over"; bg.fillStyle = "#000"; bg.fillRect(0, 0, bc.width, bc.height);
      bg.save(); bg.scale(1 / k, 1 / k); bg.translate(W / 2, H / 2); bg.rotate(-0.52);
      const beam = (cx, wd, a) => {
        const g = bg.createLinearGradient(cx - wd, 0, cx + wd, 0), col = mixc(c1, c3, 0.25);
        g.addColorStop(0, rgba(col, 0)); g.addColorStop(0.5, rgba(col, a)); g.addColorStop(1, rgba(col, 0));
        bg.fillStyle = g; bg.fillRect(cx - wd, -H * 1.5, wd * 2, H * 3);
      };
      bg.globalCompositeOperation = "lighter";
      const kb = (0.32 + L.flash * 0.3 + L.pulse * 0.05) * fade;
      beam(SPX * (0.35 * Math.sin(tt * 1.3) + 0.15), SPX * 0.55, 0.9 * kb);
      beam(-SPX * (0.55 + 0.2 * Math.cos(tt)), SPX * 0.35, 0.45 * kb);
      // slats: darker bands across the light, fewer as the light opens up
      const dark = 0.55 * (1 - L.sun * 0.5), per = (Math.PI * 2 / 26) * SPX, off = ((tt * 2) / 26) * SPX;
      bg.globalCompositeOperation = "multiply"; bg.fillStyle = rgba([1 - dark, 1 - dark, 1 - dark]);
      for (let y = -H * 1.5 - (off % per); y < H * 1.5; y += per) bg.fillRect(-W * 1.5, y, W * 3, per * 0.45);
      bg.restore();
      bg.globalCompositeOperation = "multiply";
      bg.drawImage(tex.haze, 0, 0, bc.width, bc.height);
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(bc, 0, 0, W, H);
    } else if (NEON) {
      // near-black, a glowing horizon over the grid floor, faint scanlines
      const g = ctx.createLinearGradient(0, py(0.9), 0, py(-0.35));
      g.addColorStop(0, rgba(c0, 0)); g.addColorStop(1, rgba(mulc(c1, 0.55), 1));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const hy = py(-0.28), hz = mixc(c2, c3, 0.35), k = (0.32 + L.pulse * 0.08 + L.flash * 0.2) * fade;
      const hg = ctx.createLinearGradient(0, hy - SPX * 0.3, 0, hy + SPX * 0.3);
      hg.addColorStop(0, rgba(hz, 0)); hg.addColorStop(0.47, rgba(hz, k * 0.4)); hg.addColorStop(0.5, rgba(hz, k)); hg.addColorStop(0.53, rgba(hz, k * 0.4)); hg.addColorStop(1, rgba(hz, 0));
      ctx.fillStyle = hg; ctx.fillRect(0, hy - SPX * 0.3, W, SPX * 0.6);
      radial(ctx, px(0), py(sunY), SPX * 0.9, c3, L.sun * 0.1 * fade);
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = "rgba(0,0,0,0.16)";
      for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 2);
    } else if (BOKEH) {
      // a warm, filmic dark room – soft light pools that drift very slowly
      const tt = t * 0.03;
      const g = ctx.createLinearGradient(0, H, 0, 0);
      g.addColorStop(0, rgba(c0, 0)); g.addColorStop(0.75, rgba(mulc(c1, 0.6), 0.9));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      radial(ctx, px(Math.sin(tt * 2) * 0.5), py(-0.35), SPX * 0.95, c2, 0.07 * fade * (1 + L.pulse * 0.05));
      radial(ctx, px(Math.cos(tt * 1.7) * 0.55), py(0.4), SPX * 0.8, c3, 0.05 * fade);
      radial(ctx, px(0), py(sunY), SPX * 0.7, c3, L.sun * 0.1 * fade);
    } else if (STUDIO) {
      // seamless backdrop, light from above, soft floor shade
      ctx.globalCompositeOperation = "source-over";
      const g = ctx.createLinearGradient(0, H, 0, H * 0.28);
      g.addColorStop(0, rgba(c1)); g.addColorStop(1, rgba(c0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      radial(ctx, W / 2, H * 0.36, Math.max(W, H) * 0.55, mixc(c0, [1, 1, 1], 0.55), 0.65, [[0, 1], [0.5, 0.45], [1, 0]]);
      ctx.globalCompositeOperation = "lighter";
      radial(ctx, W / 2, H * 0.36, Math.max(W, H) * 0.45, c2, L.sun * 0.08);
    } else if (AURORA) {
      // drifting colour fields and soft light bands
      ctx.globalCompositeOperation = "source-over";
      const tt = t * 0.06;
      const field = (x, y, r, col, a) => radial(ctx, px(x), py(y), SPX * r, col, a, [[0, 1], [0.5, 0.6], [1, 0]]);
      field(Math.sin(tt * 1.3) * 0.45, Math.cos(tt * 1.1) * 0.3 + 0.12, 1.3, c1, 0.85);
      field(Math.cos(tt * 0.9 + 2) * 0.5, Math.sin(tt * 1.2 + 1) * 0.35 - 0.18, 1.15, mixc(c1, c2, 0.4), 0.4);
      field(Math.sin(tt * 0.7 + 4) * 0.42, Math.cos(tt * 0.8 + 3) * 0.4, 1.0, mixc(c1, c3, 0.2), 0.16);
      ctx.globalCompositeOperation = "lighter";
      // light bands: narrow curtains swaying sideways, brightest at the top
      for (let i = 0; i < 4; i++) {
        const x = px(Math.sin(tt * 2 + i * 1.7) * 0.6 + (i - 1.5) * 0.35), w = SPX * 0.05;
        const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
        g.addColorStop(0, rgba(c2, 0)); g.addColorStop(0.5, rgba(c2, 0.1 * fade)); g.addColorStop(1, rgba(c2, 0));
        ctx.fillStyle = g; ctx.fillRect(x - w, 0, w * 2, py(0.1));
        const fadeOut = ctx.createLinearGradient(0, py(0.1), 0, py(-0.7));
        fadeOut.addColorStop(0, rgba(c2, 0.1 * fade)); fadeOut.addColorStop(1, rgba(c2, 0));
        ctx.save(); ctx.beginPath(); ctx.rect(x - w, py(0.1), w * 2, py(-0.7) - py(0.1)); ctx.clip();
        ctx.fillStyle = g; ctx.globalAlpha = 0.5; ctx.fillRect(x - w, py(0.1), w * 2, py(-0.7) - py(0.1)); ctx.restore();
      }
      tinted(tex.cloud, c3, 0.08 * fade, Math.sin(tt) * 40, Math.cos(tt) * 30, 1.3);
      radial(ctx, px(0), py(sunY), SPX * 0.8, c3, L.sun * 0.16 * fade);
      if (L.flash > 0.01) { ctx.fillStyle = rgba(c3, L.flash * 0.15); ctx.fillRect(0, 0, W, H); }
      if (L.fog > 0.01) { ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = rgba(c0, L.fog * 0.4); ctx.fillRect(0, 0, W, H); }
    } else if (!INK) {
      // cosmos: the nebula drifts, highlights breathe, clouds pass, a light source rises
      const tt = t * 0.035, cy = L.camY;
      tinted(tex.mid, c1, 0.9 * fade, Math.sin(tt) * W * 0.03, (Math.cos(tt * 0.8) * 0.02 + cy * 0.01) * H, 1.18 + Math.sin(tt * 0.5) * 0.03);
      tinted(tex.hi, c2, 0.45 * fade, Math.cos(tt * 0.9) * W * 0.035, Math.sin(tt) * H * 0.02, 1.22);
      tinted(tex.cloud, mixc(mulc(c1, 1.25), c3, 0.16), L.cloud * 0.55 * fade, ((t * 0.05 * SPX) % (W * 0.3)) - W * 0.15, 0, 1.4);
      const sx = px(0), sy = py(sunY);
      radial(ctx, sx, sy, SPX * 0.8, c3, L.sun * 0.12 * fade, [[0, 1], [0.25, 0.3], [1, 0]]);
      radial(ctx, sx, sy, SPX * 1.6, c2, L.sun * 0.06 * fade);
      if (L.horizon > 0.01) {
        const hy = py(-0.16), g = ctx.createLinearGradient(0, hy - SPX * 0.15, 0, hy + SPX * 0.15);
        g.addColorStop(0, rgba(c2, 0)); g.addColorStop(0.5, rgba(c2, L.horizon * 0.55 * fade)); g.addColorStop(1, rgba(c2, 0));
        ctx.fillStyle = g; ctx.fillRect(0, hy - SPX * 0.15, W, SPX * 0.3);
      }
      if (L.warpBg > 0.01) radial(ctx, W / 2, H / 2, Math.max(W, H) * 0.9, c2, L.warpBg * 0.18 * fade, [[0, 0], [0.4, 0], [1, 1]]);
      if (L.flash > 0.01) { ctx.fillStyle = rgba(mixc(c2, [1, 1, 1], 0.4), L.flash * 0.22); ctx.fillRect(0, 0, W, H); }
      if (L.fog > 0.01) {
        // fog: desaturate and sink
        ctx.globalCompositeOperation = "saturation"; ctx.fillStyle = `rgba(128,128,128,${(L.fog * 0.65).toFixed(3)})`; ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = rgba(c0, L.fog * 0.35); ctx.fillRect(0, 0, W, H);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    if (!STUDIO) ctx.drawImage(VIG, 0, 0, W, H);
  }

  // ------------------------------------------------ motifs (additive, on fx)
  const tmp = { x: 0, y: 0, z: 0, sp: 1 };
  function dot(g, p, size, col, a) {
    if (!p || a <= 0.004) return;
    const r = Math.max(0.6, size);
    g.globalAlpha = clamp01(a);
    if (r < 1.6) { g.fillStyle = rgba(col); g.fillRect(p.x - r, p.y - r, r * 2, r * 2); }
    else { const s = r * 1.6; g.drawImage(sprite("dot", col), p.x - s, p.y - s, s * 2, s * 2); }
  }
  function polyline(g, pts, col, a, width) {
    if (a <= 0.004) return;
    g.globalAlpha = clamp01(a); g.strokeStyle = rgba(col); g.lineWidth = width;
    g.beginPath();
    let on = false;
    for (const p of pts) { if (!p) { on = false; continue; } if (on) g.lineTo(p.x, p.y); else { g.moveTo(p.x, p.y); on = true; } }
    g.stroke();
  }

  function motifs(t, pal, L, fade) {
    const [, c1, c2, c3] = pal;
    const g = fg;
    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "lighter";
    const ph = { t, rain: S.phase("rain", t), rise: S.phase("rise", t), warp: S.phase("warp", t), swirl: S.phase("swirl", t), shock: L.shock };
    const presence = STUDIO ? 0 : AURORA ? 0.3 : INK ? 0.55 : NOIR ? 0.45 : 1;

    // sun: core, halo and slowly turning rays behind the type
    if (L.sun > 0.002) {
      const p = proj(0, VIDEO ? halfH * (-1.1 + 0.55 * smooth(0, 1, L.sun)) : halfH * (-0.5 + 1.25 * smooth(0, 1, L.sun)), -14);
      if (p) {
        const r = (halfW + halfH) * 1.2 * p.s, a = L.sun * 0.75 * fade;
        radial(g, p.x, p.y, r * 0.5, c3, a * 0.55, [[0, 1], [0.05, 0.9], [0.12, 0.35], [1, 0]]);
        radial(g, p.x, p.y, r, c3, a * 0.18);
        g.save(); g.translate(p.x, p.y); g.rotate(t * 0.02);
        for (let i = 0; i < 14; i++) {
          const ang = (i / 14) * Math.PI * 2, len = r * (0.55 + 0.35 * Math.abs(Math.sin(i * 7.3 + t * 0.25)));
          const gr = g.createLinearGradient(0, 0, Math.cos(ang) * len, Math.sin(ang) * len);
          gr.addColorStop(0, rgba(c2, 0)); gr.addColorStop(0.12, rgba(c2, a * 0.18)); gr.addColorStop(1, rgba(c2, 0));
          g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0);
          g.lineTo(Math.cos(ang - 0.035) * len, Math.sin(ang - 0.035) * len); g.lineTo(Math.cos(ang + 0.035) * len, Math.sin(ang + 0.035) * len);
          g.closePath(); g.fill();
        }
        g.restore();
      }
    }

    // bokeh world: big out-of-focus lights, drifting up; brighter on light / warmth / heartbeat
    if (BOKEH) {
      const glowUp = Math.min(1, L.sun + L.heartbeat * 0.8 + L.pulse * 0.3 + L.embers * 0.5);
      const bx = halfW * 1.5, by = halfH * 1.35;
      for (const s of BK) {
        const sp = 0.35 + s[3] * 0.9;
        const z = mix(-14, 3, s[2]);
        const y = wrapc((s[1] * 2 - 1) * by + t * 0.08 * sp + ph.rise * 0.25 * sp, by);
        const x = (s[0] * 2 - 1) * bx + Math.sin(t * 0.11 * sp + s[3] * 20) * 0.6;
        const p = proj(x, y, z);
        if (!p) continue;
        const defocus = Math.abs(p.d - 11) / 9;
        const size = Math.min((H / 1080) * (60 + s[3] * 120) * (0.6 + defocus) * 12 / p.d, (H / 1080) * 240) / 2;
        const tw = 0.75 + 0.25 * Math.sin(t * (0.6 + s[3]) + s[0] * 40);
        const a = fade * (0.1 + 0.16 * s[2]) * tw * (1 + glowUp * 1.4) / (0.7 + defocus * 0.8) * smooth(0.5, 2.5, p.d) * 0.85;
        const col = mixc(mixc(c2, c3, s[1]), [1, 0.78, 0.5], s[0] > 0.62 ? 0.6 : 0);
        g.globalAlpha = clamp01(a);
        g.drawImage(sprite("disc", col), p.x - size, p.y - size, size * 2, size * 2);
      }
    }

    // particles
    if (presence > 0) {
      const stars = AURORA ? L.stars * 0.3 : Math.max(L.stars, 0.25);
      const pf = H / 1080;
      for (const s of P) {
        const q = particlePos(s, ph, tmp);
        const p = proj(q.x, q.y, q.z);
        if (!p || p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40) continue;
        const tw = 0.55 + 0.45 * Math.sin(t * (1.5 + s[3] * 4) + s[0] * 60);
        const star = s[3] > 0.82 ? stars : 0;
        const size = Math.min(((1.4 + s[3] * 2.6) * (1 + L.pulse * 0.35) + star * 3.5 * tw + L.embers * s[2] * 2) * (pf * 36 / Math.max(p.d, 1)), pf * 42) * 0.5;
        let a = (0.22 + 0.55 * s[2]) * (1 - L.fog * 0.55) * (0.75 + 0.25 * tw) * smooth(48, 6, p.d) * smooth(0.2, 1.2, p.d);
        a *= 1 + star * 2 * tw;
        a *= mix(1, 0.6 + 0.9 * fract(Math.sin(Math.floor(t * 14 + s[3] * 50) * 12.9) * 43758), L.embers * 0.6) * fade * presence;
        const ember = mixc([1, 0.42, 0.12], [1, 0.8, 0.45], s[0]);
        const col = mixc(mixc(c3, c2, s[0] * 0.7), ember, L.embers * (s[1] > 0.35 ? 1 : 0));
        dot(g, p, size, col, a * 1.5);
        if (star > 0.05 && size > 1.2) {
          // a little cross of light on the brightest stars
          g.globalAlpha = clamp01(a * star * 0.8); g.fillStyle = rgba(col);
          g.fillRect(p.x - size * 3, p.y - 0.6, size * 6, 1.2); g.fillRect(p.x - 0.6, p.y - size * 3, 1.2, size * 6);
        }
      }
      // streaks: rain and warp lines along the same motion field
      const lvl = Math.max(L.rain * 0.9, NEON ? Math.max(L.warp, 0.16) : L.warp, Math.max(L.ascend, L.embers * 0.7) * 0.35);
      if (lvl > 0.01) {
        const warp = NEON ? Math.max(L.warp, 0.16) : L.warp, rise = Math.max(L.ascend, L.embers * 0.7);
        g.lineWidth = 1.4 * pf; g.lineCap = "round";
        for (const s of SK) {
          if (s[1] < 0.45) continue;
          const q = particlePos(s, ph, tmp);
          const d = [-0.18 * L.rain * q.sp, (1.3 * L.rain - 0.9 * rise) * q.sp, -2.2 * warp * q.sp];
          const k = 0.35 + 0.9 * warp;
          const a0 = proj(q.x, q.y, q.z), a1 = proj(q.x + d[0] * k, q.y + d[1] * k, q.z + d[2] * k);
          if (!a0 || !a1) continue;
          const a = lvl * (0.25 + 0.75 * s[2]) * smooth(40, 4, a0.d) * fade * presence * 0.8;
          if (a < 0.01) continue;
          const gr = g.createLinearGradient(a0.x, a0.y, a1.x, a1.y);
          const col = mixc(c3, c2, s[0]);
          gr.addColorStop(0, rgba(col, a)); gr.addColorStop(1, rgba(col, a * 0.1));
          g.globalAlpha = 1; g.strokeStyle = gr; g.beginPath(); g.moveTo(a0.x, a0.y); g.lineTo(a1.x, a1.y); g.stroke();
        }
      }
    }

    // rings: tilted orbits that turn, clock ticks, satellites (time / spin / around)
    if (L.rings > 0.002 && !STUDIO) {
      const sw = ph.swirl, scale = (1.05 + 0.3 * smooth(0, 1, L.rings)) * VS;
      const cz = -4.5;
      ringDefs.forEach(([r, tube], i) => {
        const ax = 1.15 + Math.sin(t * 0.3 + i) * 0.25 + i * 0.32, ay = sw * (0.35 + i * 0.22) * (i % 2 ? -1 : 1), az = i * 0.6;
        const pts = [];
        for (let k = 0; k <= 96; k++) {
          const a = (k / 96) * Math.PI * 2;
          const v = rot([Math.cos(a) * r * U * 0.95 * scale, Math.sin(a) * r * U * 0.95 * scale, 0], ax, ay, az);
          pts.push(proj(v[0], v[1] + VY, v[2] + cz));
        }
        const col = i % 2 ? c2 : c3, a = L.rings * fade * 0.75;
        const wpx = Math.max(1, tube * U * 2.2 * scale * (F0 / (CAM_Z - cz)) * 2);
        polyline(g, pts, col, a * 0.12, wpx * 3);
        polyline(g, pts, col, a * 0.8, wpx);
        // satellite on the first three rings
        if (i < 3) {
          const sa = sw * (1.1 + i * 0.5) + i * 2;
          const v = rot([Math.cos(sa) * r * U * 0.95 * scale, Math.sin(sa) * r * U * 0.95 * scale, 0], ax, ay, az);
          const p = proj(v[0], v[1] + VY, v[2] + cz);
          dot(g, p, U * 0.028 * scale * (p ? p.s : 0) * 1.6, mulc(c3, 1.4), L.rings * fade);
        }
      });
      // clock ticks, facing the camera
      g.globalAlpha = clamp01(L.rings * fade * 0.6); g.strokeStyle = rgba(mulc(c3, 0.9)); g.lineWidth = 1.5 * (H / 1080);
      g.beginPath();
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2 - sw * 0.15, r0 = U * 1.72 * scale, r1 = r0 + U * scale * (i % 5 === 0 ? 0.12 : 0.05);
        const p0 = proj(Math.cos(a) * r0, Math.sin(a) * r0 + VY, cz), p1 = proj(Math.cos(a) * r1, Math.sin(a) * r1 + VY, cz);
        if (p0 && p1) { g.moveTo(p0.x, p0.y); g.lineTo(p1.x, p1.y); }
      }
      g.stroke();
    }

    // planet: a dotted globe with land and an atmosphere rim (world / earth / home)
    if (L.planet > 0.002 && !STUDIO) {
      const cy = -R * 1.62 + smooth(0, 1, L.planet) * R * 0.62 - S.phase("ascend", t) * 0.15, cz = -4;
      const ry = t * 0.12, rz = 0.32;
      for (const d of PL) {
        const n = rot(d.n, 0, ry, rz);
        const p = proj(n[0] * R, n[1] * R + cy, n[2] * R + cz);
        if (!p) continue;
        const facing = clamp01(n[2]);
        const a = L.planet * (0.12 + facing * 0.9) * (0.35 + d.land * 0.9) * fade;
        if (a < 0.02) continue;
        const sz = (1.6 + d.land * 2.2) * (H / 1080) * 0.9;
        g.globalAlpha = clamp01(a); g.fillStyle = rgba(mixc(c2, c3, d.land));
        g.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
      }
      const c = proj(0, cy, cz);
      if (c) {
        const rp = R * c.s;
        const gr = g.createRadialGradient(c.x, c.y, rp * 0.82, c.x, c.y, rp * 1.1);
        gr.addColorStop(0, rgba(c2, 0)); gr.addColorStop(0.62, rgba(c2, 0.55 * L.planet * fade)); gr.addColorStop(1, rgba(c2, 0));
        g.globalAlpha = 1; g.fillStyle = gr; g.fillRect(c.x - rp * 1.2, c.y - rp * 1.2, rp * 2.4, rp * 2.4);
      }
    }

    // waves: a sea of dots on interfering sines (ocean / water)
    if (L.waves > 0.002 && !STUDIO) {
      const uPh = t + S.phase("rain", t) * 0.2, y0 = -halfH * 0.75 - 1.2, NX = 84, NZ = 34;
      for (let zi = 0; zi < NZ; zi++) {
        const zz = Math.pow(zi / (NZ - 1), 1.35), z = 7 - zz * 42;
        for (let xi = 0; xi < NX; xi++) {
          const x = (xi / (NX - 1) - 0.5) * 60;
          const h = Math.sin(x * 0.32 + uPh * 1.6) * 0.45 + Math.sin(z * 0.42 - uPh * 1.25 + x * 0.12) * 0.55 + Math.sin((x + z) * 0.9 + uPh * 2.7) * 0.14;
          const p = proj(x, y0 + h * (0.5 + L.waves * 1.1), z);
          if (!p || p.x < 0 || p.x > W || p.y < 0 || p.y > H) continue;
          const a = L.waves * L.waves * smooth(48, 6, p.d) * smooth(0.5, 3, p.d) * (0.55 + 0.45 * smooth(-0.6, 0.9, h)) * fade * 0.9;
          if (a < 0.02) continue;
          const sz = Math.max(1, (H / 1080) * (70 + h * 30) / p.d * 0.5);
          g.globalAlpha = clamp01(a); g.fillStyle = rgba(mixc(c2, c3, smooth(0.2, 1, h)));
          g.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
        }
      }
    }

    // neon grid floor and skyline (city / street); in the neon world the floor is the world itself
    const gridLevel = NEON ? Math.max(L.grid, VIDEO ? 0.38 : 0.62) : L.grid;
    if (gridLevel > 0.002 && !STUDIO) {
      const fy = -halfH * 0.7 - 0.4, gph = S.phase("warp", t) + t * (NEON ? 1.1 : 0.4);
      const zFar = -75, zNear = 8;
      g.lineWidth = 1.6 * (H / 1080);
      // lines across (constant z), rolling towards the camera
      for (let k = 0; k < 40; k++) {
        const z = zNear - ((k * 2.2 + (gph * 4) % 2.2 + 2.2) % (zNear - zFar));
        const depth = clamp01((8 - z) / 70), a = (1 - depth) ** 2 * gridLevel * fade * 0.8;
        const p0 = proj(-60, fy, z), p1 = proj(60, fy, z);
        if (p0 && p1) polyline(g, [p0, p1], c3, a, g.lineWidth);
      }
      // lines along (constant x), fading into the distance
      for (let k = -27; k <= 27; k++) {
        const x = k * 2.2;
        const seg = [];
        for (let z = zNear; z >= zFar; z -= 8) seg.push([proj(x, fy, z), clamp01((8 - z) / 70)]);
        for (let i = 0; i < seg.length - 1; i++) {
          const [a0, d0] = seg[i], [a1] = seg[i + 1];
          if (a0 && a1) polyline(g, [a0, a1], c2, (1 - d0) ** 2 * gridLevel * fade * 0.8, g.lineWidth);
        }
      }
      if (L.grid > 0.002) {
        // skyline: towers with lit windows, far behind the floor
        g.globalAlpha = 1;
        for (const tw of TOWERS) {
          const a0 = proj(tw.x - tw.w / 2, fy + tw.h, tw.z), a1 = proj(tw.x + tw.w / 2, fy, tw.z);
          if (!a0 || !a1 || a1.x < 0 || a0.x > W) continue;
          g.globalCompositeOperation = "source-over";
          g.globalAlpha = clamp01(L.grid * fade); g.fillStyle = rgba(mulc(c1, 0.18));
          g.fillRect(a0.x, a0.y, a1.x - a0.x, a1.y - a0.y);
          g.globalCompositeOperation = "lighter";
          g.fillStyle = rgba(c2, 0.5); g.fillRect(a0.x, a0.y, a1.x - a0.x, Math.max(1, (a1.y - a0.y) * 0.01));
          const cols = Math.max(1, Math.floor(tw.w * 2.2)), rows = Math.max(1, Math.floor(tw.h * 2.6));
          const cw = (a1.x - a0.x) / cols, rh = (a1.y - a0.y) / rows;
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const hsh = hash12(c + tw.seed, r + tw.seed * 1.3);
            if (hsh < 0.62) continue;
            g.globalAlpha = clamp01(L.grid * fade * 0.55);
            g.fillStyle = rgba(mixc(c3, c2, hash12(c + 3, r + tw.seed)));
            g.fillRect(a0.x + c * cw + cw * 0.3, a0.y + r * rh + rh * 0.3, cw * 0.45, rh * 0.42);
          }
        }
      }
    }

    // pulse rings: heartbeat / shockwave rings from the centre
    if (!STUDIO) {
      const cyp = proj(0, VY, -1.5);
      for (const pz of S.pulses(t, 8)) {
        const age = t - pz.t;
        if (age < 0 || age > 3 || !cyp) continue;
        const speed = mix(0.55, 1.5, pz.kind), r = (age * speed + 0.05) * H * (CAM_Z / (CAM_Z + 1.5));
        const w = (mix(0.006, 0.022, pz.kind) + age * 0.012) * H;
        const a = (1 - smooth(0, mix(2.2, 1.4, pz.kind), age)) * pz.amp * 0.9 * fade;
        const col = mixc(c2, c3, pz.kind * 0.6);
        for (const [k, m] of [[2.2, 0.25], [1, 0.6], [0.4, 1]]) {
          g.globalAlpha = clamp01(a * m); g.strokeStyle = rgba(col); g.lineWidth = Math.max(1, w * k);
          g.beginPath(); g.arc(cyp.x, cyp.y, r, 0, Math.PI * 2); g.stroke();
        }
      }
    }

    // shards: glass flying apart on "break"
    let best = null;
    for (const b of breakEvents) if (t >= b.t - 0.05 && t < b.t + 3.2) best = b;
    if (best && !STUDIO) {
      const age = Math.max(0, t - best.t);
      const lvl = (1 - smooth(1.4, 3.1, age)) * smooth(-0.05, 0.03, t - best.t) * best.strength * fade;
      const k = 1 - Math.exp(-age * 2.2);
      for (const d of SH) {
        const c = [d.p0[0] + d.v[0] * k * 1.1, d.p0[1] + d.v[1] * k * 1.1 - age * age * 0.9, d.p0[2] + d.v[2] * k * 1.1];
        const ax = d.r[0] + d.w[0] * age, ay = d.r[1] + d.w[1] * age, az = d.r[2] + d.w[2] * age;
        const tri = [[-0.5, -0.4, 0], [0.55, -0.3, 0], [-0.05, 0.6, 0]].map((v) => {
          const r = rot(v, ax, ay, az);
          return proj(c[0] + r[0] * d.s, c[1] + r[1] * d.s, c[2] + r[2] * d.s);
        });
        if (tri.some((p) => !p)) continue;
        const nz = Math.abs(rot([0, 0, 1], ax, ay, az)[2]);
        const glint = Math.pow(1 - nz, 2) * 0.9 + Math.pow(nz, 24) * 1.2;
        g.globalAlpha = clamp01(lvl * (0.1 + glint * 0.8));
        g.fillStyle = rgba(mixc(c2, c3, glint * 0.4));
        g.beginPath(); g.moveTo(tri[0].x, tri[0].y); g.lineTo(tri[1].x, tri[1].y); g.lineTo(tri[2].x, tri[2].y); g.closePath(); g.fill();
      }
    }

    // lightning: deterministic flicker windows
    const lt = L.lightning;
    if (lt > 0.05 && !STUDIO) BOLTS.forEach((pts, i) => {
      const slot = Math.floor(t * 15 + i * 3.3);
      const hsh = Math.abs(Math.sin(slot * 12.9898 + i * 78.233) * 43758.5453) % 1;
      if (hsh <= 1 - lt * 0.28) return;
      const pp = pts.map((v) => proj(v[0], v[1], v[2]));
      const col = mulc(i % 2 ? c3 : c2, 1.6);
      polyline(g, pp, col, lt * fade * 0.25, 10 * (H / 1080));
      polyline(g, pp, col, lt * fade * 0.6, 3.5 * (H / 1080));
      polyline(g, pp, [1, 1, 1], lt * fade, 1.4 * (H / 1080));
    });

    // chart: a rising curve that draws itself over ~1.8 s, area below, a quiet grid
    if (L.chart > 0.002 && !STUDIO) {
      const prog = smooth(0, 1.8, S.since("chart", t));
      const cw = halfW * 1.7 * VS, chh = halfH * 0.62 * VS, oy = VIDEO ? VY : -halfH * 0.18, cz = -5;
      const P2 = (x, v) => proj((x - 0.5) * cw, oy + v * chh - chh * 0.5, cz);
      const a = L.chart * fade;
      for (let k = 0; k <= 4; k++) {
        const p0 = P2(0, k / 4), p1 = P2(1, k / 4);
        polyline(g, [p0, p1], c3, a * 0.12, 1.2 * (H / 1080));
      }
      const n = Math.max(2, Math.round(prog * (CH.length - 1)) + 1);
      const pts = CH.slice(0, n).map(([x, v]) => P2(x, v));
      if (pts.every(Boolean)) {
        const base = P2(0, 0);
        g.globalAlpha = clamp01(a * 0.5);
        const gr = g.createLinearGradient(0, pts.reduce((m, p) => Math.min(m, p.y), H), 0, base.y);
        gr.addColorStop(0, rgba(c2, 0.35)); gr.addColorStop(1, rgba(c2, 0));
        g.fillStyle = gr; g.beginPath(); g.moveTo(pts[0].x, base.y);
        for (const p of pts) g.lineTo(p.x, p.y);
        g.lineTo(pts[pts.length - 1].x, base.y); g.closePath(); g.fill();
        polyline(g, pts, c2, a * 0.35, 9 * (H / 1080));
        polyline(g, pts, mixc(c2, c3, 0.3), a, 3 * (H / 1080));
        dot(g, pts[pts.length - 1], 7 * (H / 1080), c3, a * (prog < 1 ? 1 : 0.6));
      }
    }

    // network: nodes on a slowly turning shell, links between neighbours (tech / people)
    if (L.network > 0.002 && !STUDIO) {
      const sc = (0.85 + 0.15 * smooth(0, 1, L.network)) * VS, ay = t * 0.12, ax = Math.sin(t * 0.1) * 0.15, cz = -5;
      const pp = NET.map((nd) => { const v = rot(nd.p, ax, ay, 0); return proj(v[0] * sc, v[1] * sc + VY, v[2] * sc + cz); });
      g.lineWidth = 1.2 * (H / 1080); g.strokeStyle = rgba(c2);
      for (const [i, j] of LINKS) {
        const a = pp[i], b = pp[j];
        if (!a || !b) continue;
        g.globalAlpha = clamp01(0.45 * L.network * fade * smooth(26, 8, (a.d + b.d) / 2));
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
      NET.forEach((nd, i) => {
        const pulse = Math.pow(0.5 + 0.5 * Math.sin(t * 2.2 + nd.s * 40), 6);
        dot(g, pp[i], (3 + pulse * 7) * (H / 1080) * 0.5, mixc(c2, c3, 0.5), (0.55 + pulse) * L.network * fade);
      });
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  // ------------------------------------------------ studio (geometry world): matte objects, soft shadows
  function studio(t, pal, L, fade) {
    const sw = S.phase("swirl", t), lift = S.phase("rise", t) * 0.7 - S.phase("rain", t) * 0.5;
    const rx = halfW * 1.38, ry = halfH * 1.12, push = 1 + L.shock * 0.18;
    const slotCol = [pal[2], pal[3], pal[1], mulc(pal[2], 0.28)];
    const light = 1 + L.sun * 0.45 + L.flash * 0.3;
    const objs = STUDIO_OBJS.map((d) => {
      const a = d.a + sw * 0.3;
      const y0 = Math.sin(a) * ry * push + Math.sin(t * 0.55 * d.sp + d.bob) * 0.16;
      const pos = [Math.cos(a) * rx * push, wrapc(y0 + lift * d.sp, halfH * 1.6), d.z];
      const beat = L.heartbeat * Math.max(0, Math.sin(t * 7.5)) * 0.08;
      const s = d.s * (1 + L.chart * 0.28 + L.pulse * 0.05 + beat) * (0.85 + 0.15 * fade);
      return { d, pos, s, rotA: d.rx + t * d.wx + L.shock * 0.6, rotB: d.ry + t * d.wy * (1 + L.rings * 2.5), col: slotCol[d.slot] };
    }).sort((a, b) => a.pos[2] - b.pos[2]);
    for (const o of objs) {
      const p = proj(o.pos[0], o.pos[1], o.pos[2]);
      if (!p) continue;
      const r = o.s * p.s;
      // soft shadow on the backdrop, down and to the right of the key light
      const sx = p.x + r * 0.55, sy = p.y + r * 0.75;
      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 1.5);
      sg.addColorStop(0, "rgba(0,0,0,0.16)"); sg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = sg; ctx.fillRect(sx - r * 1.5, sy - r * 1.5, r * 3, r * 3);
      drawSolid(o, p, r, light);
    }
  }
  // a matte solid seen from the front: shading by a key light from the upper left
  function drawSolid(o, p, r, light) {
    const g = ctx, col = o.col, k = o.d.kind;
    const lit = (v) => mixc(mulc(col, 0.55), mixc(col, [1, 1, 1], 0.25), v * Math.min(1.2, light) / 1.2);
    const shade = (x0, y0, x1, y1) => {
      const gr = g.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, rgba(lit(1))); gr.addColorStop(1, rgba(lit(0.15)));
      return gr;
    };
    g.save(); g.translate(p.x, p.y);
    if (k === 0) { // sphere
      const gr = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.05, 0, 0, r);
      gr.addColorStop(0, rgba(lit(1))); gr.addColorStop(1, rgba(lit(0.12)));
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    } else if (k === 1 || k === 7) { // torus, thin ring: an ellipse band tilted by the rotation
      const tilt = Math.abs(Math.cos(o.rotA)) * 0.85 + 0.15, th = k === 1 ? 0.3 : 0.12;
      g.rotate(o.rotB * 0.5);
      g.lineWidth = r * th * 1.4; g.strokeStyle = shade(-r, -r, r, r);
      g.beginPath(); g.ellipse(0, 0, r * 0.75, r * 0.75 * tilt, 0, 0, Math.PI * 2); g.stroke();
    } else if (k === 2) { // capsule
      g.rotate(o.rotA); const w = r * 0.5, h = r * 0.95;
      g.fillStyle = shade(-w, -h, w, h); g.beginPath();
      g.arc(0, -h + w, w, Math.PI, 0); g.arc(0, h - w, w, 0, Math.PI); g.closePath(); g.fill();
    } else if (k === 3) { // cone
      g.rotate(o.rotA * 0.4);
      g.fillStyle = shade(-r, -r, r * 0.6, r); g.beginPath();
      g.moveTo(0, -r * 0.8); g.lineTo(r * 0.85, r * 0.7); g.ellipse(0, r * 0.7, r * 0.85, r * 0.22, 0, 0, Math.PI); g.closePath(); g.fill();
    } else if (k === 4) { // cylinder
      g.rotate(o.rotA * 0.3); const w = r * 0.75, h = r * 0.3;
      g.fillStyle = shade(-w, 0, w, 0); g.fillRect(-w, -h, w * 2, h * 2);
      g.beginPath(); g.ellipse(0, h, w, w * 0.3, 0, 0, Math.PI); g.fill();
      g.fillStyle = rgba(lit(0.95)); g.beginPath(); g.ellipse(0, -h, w, w * 0.3, 0, 0, Math.PI * 2); g.fill();
    } else { // icosahedron / octahedron: facets with flat shading
      const n = k === 5 ? 6 : 4;
      g.rotate(o.rotB * 0.6);
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        const v = 0.35 + 0.65 * clamp01(0.5 - 0.5 * Math.cos((a0 + a1) / 2 + o.rotB * 0.6 + 2.3));
        g.fillStyle = rgba(lit(v));
        g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a0) * r, Math.sin(a0) * r); g.lineTo(Math.cos(a1) * r, Math.sin(a1) * r); g.closePath(); g.fill();
      }
    }
    g.restore();
  }

  // ------------------------------------------------ bloom: blurred copies of the light, added back
  function bloom(target, strength, radius) {
    if (strength <= 0.01) return;
    let src = fx;
    for (const [i, [c, g]] of BL.entries()) {
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "medium";
      g.globalCompositeOperation = "copy"; g.drawImage(src, 0, 0, c.width, c.height);
      // a soft threshold, as the bloom pass had: squaring keeps the bright light, drops the faint
      if (i === 0) { g.globalCompositeOperation = "multiply"; g.drawImage(c, 0, 0); g.drawImage(c, 0, 0); g.globalCompositeOperation = "lighter"; g.drawImage(c, 0, 0); }
      src = c;
    }
    target.globalCompositeOperation = "lighter";
    target.imageSmoothingEnabled = true; target.imageSmoothingQuality = "high";
    const w = [0.5, 0.65, 0.8].map((k) => k * strength * (0.6 + radius));
    BL.forEach(([c], i) => { target.globalAlpha = clamp01(w[i]); target.drawImage(c, 0, 0, W, H); });
    target.globalAlpha = 1;
    target.globalCompositeOperation = "source-over";
  }

  // ------------------------------------------------ frame
  function renderAt(time) {
    const t = Math.max(0, Math.min(plan.duration, time));
    const L = S.levels(t);
    let pal = S.paletteRGB(t);
    const fadeIn = plan.preset === "social" ? 1 : smooth(0, 0.9, t);
    const fade = fadeIn * (1 - smooth(plan.duration - 0.6, plan.duration, t));

    // camera: drift, kicks on hero words, shake on shocks and lightning
    const shake = L.shock * 0.06 + L.lightning * 0.02;
    cam = {
      x: Math.sin(t * 0.13) * 0.55 + Math.sin(t * 37.1) * shake,
      y: Math.sin(t * 0.09 + 1) * 0.35 + Math.cos(t * 31.7) * shake,
      z: CAM_Z - L.kick * 0.2 * CAM_MOVE - L.warp * 1.2,
      zoom: 1 / (1 + L.warp * 0.18 - L.kick * 0.03 * CAM_MOVE),
      roll: Math.sin(t * 0.07) * 0.012 + L.rings * Math.sin(t * 0.6) * 0.02,
    };

    const sunY = (() => {
      const y = VIDEO ? halfH * (-1.1 + 0.55 * smooth(0, 1, L.sun)) : halfH * (-0.5 + 1.25 * smooth(0, 1, L.sun));
      return ((y * (CAM_Z / (CAM_Z + 14))) / halfH) * 0.5;
    })();
    const BG = { ...L, sunY, sun: L.sun * 0.7, cloud: Math.max(L.clouds, L.ascend * 0.5), horizon: Math.max(L.grid, L.waves * 0.8), camY: S.phase("ascend", t), warpBg: L.warp };
    // the studio backdrop never goes black; over footage only aurora and noir keep half their ground
    const bgFade = VIDEO ? (AURORA || NOIR ? fade * 0.5 : 0) : STUDIO ? 1 : fade;

    if (INK) {
      // the paper from the ground colours, then light becomes ink: the motif colours turn into
      // their complement against the paper, so that paper × (1 − colour) lands on the accent ink
      paper(pal);
      const p0 = pal[0];
      pal = [pal[0], ...pal.slice(1, 4).map((c) => c.map((v, i) => clamp01(1 - v / Math.max(p0[i], 0.05)))), pal[4]];
      motifs(t, pal, L, fade);
      bloom(fg, 0.22 + L.pulse * 0.08, 0.35); // ink bleed, not glow
      fg.globalCompositeOperation = "lighter"; fg.globalAlpha = 0.6; fg.drawImage(fx, 0, 0);
      fg.globalAlpha = 1; fg.globalCompositeOperation = "source-over";
      // paper × (1 − 0.93 · light): white minus the light, multiplied onto the paper
      ig.globalCompositeOperation = "source-over"; ig.fillStyle = "#fff"; ig.fillRect(0, 0, W, H);
      ig.globalCompositeOperation = "difference"; ig.globalAlpha = 0.93 * fade;
      ig.drawImage(fx, 0, 0); ig.globalAlpha = 1;
      ctx.globalCompositeOperation = "multiply"; ctx.drawImage(inv, 0, 0);
      ctx.globalCompositeOperation = "source-over";
    } else {
      if (bgFade > 0.001) {
        background(t, pal, BG, bgFade);
        if (bgFade < 1 && !STUDIO) { ctx.fillStyle = `rgba(0,0,0,${(1 - bgFade).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
      } else { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); }
      if (STUDIO) studio(t, pal, L, fade);
      else {
        motifs(t, pal, L, fade);
        ctx.globalCompositeOperation = "lighter"; ctx.drawImage(fx, 0, 0); ctx.globalCompositeOperation = "source-over";
        let st = 0.55 + L.pulse * 0.15 + L.sun * 0.25 + L.shock * 0.25 + L.lightning * 0.2;
        if (AURORA) st *= 0.8;
        bloom(ctx, st, 0.5 + L.sun * 0.15);
      }
    }
    // glitch: horizontal bands slip sideways on "electric" words
    const gl = Math.min(1, L.glitch);
    if (gl > 0.02) {
      const f = Math.floor(t * 18), bands = 28, bh = H / bands;
      for (let b = 0; b < bands; b++) {
        const h = Math.abs(Math.sin((b + f * 3) * 12.9898 + f * 78.233) * 43758.5453) % 1;
        if (h < 1 - gl * 0.35) continue;
        const dx = ((Math.abs(Math.sin(b * 1.7 * 12.9898) * 43758.5453) % 1) - 0.5) * 0.06 * gl * W;
        ctx.drawImage(canvas, 0, b * bh, W, bh, dx, b * bh, W, bh);
      }
    }
  }

  function paper(pal) {
    // paper from the ground colours: mottled between the two, fibre multiplied in, a faint vignette
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = rgba(pal[1]); ctx.fillRect(0, 0, W, H);
    tinted(tex.mottle, pal[0], 1, 0, 0, 1);
    ctx.globalCompositeOperation = "multiply"; ctx.drawImage(tex.fibre, 0, 0, W, H);
    ctx.globalCompositeOperation = "source-over"; ctx.drawImage(VIG, 0, 0, W, H);
  }

  return { renderAt, signals: S };
}
