// Finishing layer: film grain plus a preset-specific HUD.
//   lyric   – title, running timecode, current concept, progress
//   podcast – show title / subtitle, speaker chip per turn, audiogram, progress
//   social  – hook headline (whole video), progress bar, call-to-action end card
// Bundled as `KineticOverlay`. build() returns { timeline, draw(t) }; draw paints the
// canvas parts (audiogram) for time t and is called from hf-seek like the 3D world.

import { palettesOf, worldOf } from "./signals.js";

const LABEL = {
  rise: "ASCEND", fall: "GRAVITY", rain: "RAIN", fire: "EMBERS", light: "LIGHT", stars: "STARFIELD", dark: "DARKNESS",
  quiet: "HUSH", loud: "IMPACT", electric: "CHARGE", water: "TIDE", time: "ORBIT", world: "WORLD", love: "PULSE",
  break: "FRACTURE", city: "GRID", speed: "VELOCITY", sky: "ATMOSPHERE", growth: "GROWTH", money: "VALUE", tech: "SIGNAL",
  idea: "INSIGHT", people: "PEOPLE", problem: "FRICTION", success: "WIN", number: "DATA",
};

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; parent.appendChild(e); return e; };
const tc = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`; };
const moodAt = (plan, t) => { let m = plan.moodTrack[0]?.mood || "night"; for (const k of plan.moodTrack) if (k.t <= t) m = k.mood; return m; };

export function build(root, plan, gsap) {
  const PALETTES = palettesOf(plan);
  const LIGHT = worldOf(plan).light;
  const W = plan.width, H = plan.height, u = Math.min(W, H);
  const tl = gsap.timeline({ paused: true });
  const r = rng(plan.seed * 31 + 5);
  const preset = plan.preset || "lyric";
  root.classList.add(`ko-${preset}`);
  if (plan.portrait) root.classList.add("ko-root-tall");
  if (LIGHT) root.classList.add("ko-light");

  // ---- grain: one seeded noise tile, jumped around in steps (deterministic flicker)
  const tile = 256;
  const cv = document.createElement("canvas"); cv.width = cv.height = tile;
  const c2 = cv.getContext("2d"); const img = c2.createImageData(tile, tile);
  for (let i = 0; i < tile * tile; i++) { const v = Math.floor(r() * 255); img.data.set([v, v, v, 255], i * 4); }
  c2.putImageData(img, 0, 0);
  const grain = el("div", "ko-grain", root);
  grain.style.backgroundImage = `url(${cv.toDataURL()})`;
  const steps = Math.floor(plan.duration * 24);
  tl.fromTo(grain, { backgroundPosition: "0px 0px" }, { backgroundPosition: `${steps * 137}px ${steps * 89}px`, duration: plan.duration, ease: `steps(${steps})` }, 0);

  const hud = el("div", "ko-hud", root);
  hud.style.fontSize = `${Math.round(u * 0.0165)}px`;
  if (preset !== "social") tl.fromTo(hud, { opacity: 0 }, { opacity: 1, duration: 0.8, ease: "power2.out" }, 0.1);
  tl.to(hud, { opacity: 0, duration: 0.6, ease: "power2.in" }, plan.duration - 0.7);

  const ctx = document.createElement("canvas").getContext("2d");
  const measure = (text, size) => { ctx.font = `400 ${size}px "League Gothic"`; return ctx.measureText(text).width; };

  let drawWave = null;

  if (preset === "lyric") {
    const tlft = el("div", "ko-tl", hud);
    el("span", "ko-dot", tlft);
    el("span", "", tlft, (plan.title || "untitled transcript").toUpperCase());
    el("div", "ko-tr", hud, `${plan.words.length} WORDS · ${plan.phrases.length} PHRASES`);
    const blft = el("div", "ko-bl", hud);
    const time = el("span", "ko-time", blft, tc(0));
    el("span", "ko-sep", blft, " / " + tc(plan.duration));
    const brgt = el("div", "ko-br", hud);
    const concept = el("span", "ko-concept", brgt, "");
    const fill = el("div", "ko-fill", el("div", "ko-bar", hud));
    tl.fromTo(fill, { scaleX: 0 }, { scaleX: 1, duration: plan.duration, ease: "none" }, 0);
    for (let t = 0.1; t < plan.duration; t += 0.1) tl.set(time, { textContent: tc(t) }, t);
    // concept label follows the phrase; letters scramble in
    const glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let last = "";
    plan.phrases.forEach((ph, pi) => {
      const c = ph.concepts[0];
      const label = c ? `${LABEL[c] || c.toUpperCase()} — ${String(pi + 1).padStart(2, "0")}` : `${String(pi + 1).padStart(2, "0")}`;
      if (label === last) return;
      last = label;
      const pal = PALETTES[ph.mood] || PALETTES.night;
      tl.set(brgt, { color: pal[2] }, ph.tIn);
      for (let k = 0; k <= 6; k++) {
        const s = label.split("").map((ch, i) => (ch === " " || i < (label.length * k) / 6 ? ch : glyphs[Math.floor(r() * glyphs.length)])).join("");
        tl.set(concept, { textContent: s }, ph.tIn + k * 0.035);
      }
    });
  }

  if (preset === "podcast") {
    const tlft = el("div", "ko-tl ko-show", hud);
    el("span", "ko-dot", tlft);
    const tt = el("div", "ko-showtext", tlft);
    el("div", "ko-showtitle", tt, (plan.title || "Podcast").toUpperCase());
    if (plan.subtitle) el("div", "ko-showsub", tt, plan.subtitle);
    const fill = el("div", "ko-fill", el("div", "ko-bar", hud));
    tl.fromTo(fill, { scaleX: 0 }, { scaleX: 1, duration: plan.duration, ease: "none" }, 0);
    // one chip per speaker turn, sliding in where the voice changes
    const chipBox = el("div", "ko-chips", hud);
    chipBox.style.fontSize = `${Math.round(u * 0.034)}px`;
    // over footage the chip sits right above the type, where the shade begins (a lower third)
    if (plan.video && plan.portrait) {
      const [a, b] = plan.video.shade;
      chipBox.style.left = "7%";
      chipBox.style.bottom = `${((1 - (a + (b - a) * 0.55)) * 100 + 0.6).toFixed(1)}%`;
    }
    const spk = Object.fromEntries((plan.speakers || []).map((s) => [s.id, s]));
    (plan.turns || []).forEach((turn, i) => {
      const s = spk[turn.speaker];
      if (!s) return;
      const chip = el("div", "ko-chip", chipBox);
      chip.style.setProperty("--spk", s.color);
      el("span", "ko-chipdot", chip);
      el("span", "ko-chipname", chip, s.name.toUpperCase());
      const until = (plan.turns[i + 1]?.t ?? plan.duration) - 0.02;
      tl.fromTo(chip, { yPercent: 110, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.35, ease: "expo.out" }, Math.max(0, turn.t - 0.1));
      tl.to(chip, { yPercent: -110, opacity: 0, duration: 0.22, ease: "power2.in" }, Math.max(turn.t + 0.3, until - 0.2));
    });
  }

  if (preset === "podcast" && plan.style?.audiogram && plan.bands) {
    // audiogram: mirrored bars driven by the voice's frequency bands, in the speaker's colour
    const wave = el("canvas", "ko-wave", hud);
    const ww = Math.round(W * 0.9), wh = Math.round(H * (plan.portrait ? 0.07 : 0.1));
    wave.width = ww; wave.height = wh;
    const g = wave.getContext("2d");
    const { fps, n, data } = plan.bands;
    const frames = Math.floor(data.length / n);
    const val = (f, b) => (f < 0 || f >= frames ? 0 : parseInt(data[f * n + b], 36) / 35);
    const spk = Object.fromEntries((plan.speakers || []).map((s) => [s.id, s.color]));
    const colorAt = (t) => { let c = null; for (const tr of plan.turns || []) if (tr.t <= t) c = spk[tr.speaker]; return c || (PALETTES[moodAt(plan, t)] || PALETTES.night)[2]; };
    const BARS = 64;
    drawWave = (t) => {
      g.clearRect(0, 0, ww, wh);
      const x = t * fps, f = Math.floor(x), k = x - f;
      const col = colorAt(t);
      const fadeIn = Math.min(1, t / 0.6), fadeOut = Math.min(1, Math.max(0, (plan.duration - 0.4 - t) / 0.5));
      g.globalAlpha = fadeIn * fadeOut;
      g.fillStyle = col;
      g.shadowColor = col; g.shadowBlur = LIGHT ? 0 : wh * 0.18;
      const bw = ww / BARS;
      for (let i = 0; i < BARS; i++) {
        // fold the bands symmetric around the centre: lows in the middle
        const pos = Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2);
        const bf = pos * (n - 1), b0 = Math.floor(bf), bk = bf - b0, b1 = Math.min(n - 1, b0 + 1);
        const at = (ff) => val(ff, b0) * (1 - bk) + val(ff, b1) * bk;
        let v = at(f) * (1 - k) + at(f + 1) * k;
        v = 0.04 + v * (1 - pos * 0.35);
        const h = Math.max(wh * 0.04, v * wh * 0.92);
        const xx = i * bw + bw * 0.22, w = bw * 0.56;
        g.beginPath();
        g.roundRect(xx, (wh - h) / 2, w, h, w / 2);
        g.fill();
      }
    };
  }

  if (preset === "social") {
    // hook headline: an accent card at the top, there for the whole video
    if (plan.hook) {
      const box = el("div", "ko-hook", hud);
      const card = el("div", "ko-hookcard", box);
      const text = plan.hook.toUpperCase();
      // up to two balanced lines, sized to the card width
      const words = text.split(/\s+/);
      let lines = [text];
      if (words.length > 2 && measure(text, 100) > 900) {
        let best = 1, bestDiff = 1e9;
        for (let i = 1; i < words.length; i++) {
          const d = Math.abs(measure(words.slice(0, i).join(" "), 100) - measure(words.slice(i).join(" "), 100));
          if (d < bestDiff) { bestDiff = d; best = i; }
        }
        lines = [words.slice(0, best).join(" "), words.slice(best).join(" ")];
      }
      const maxW = W * 0.74;
      const size = Math.min(H * 0.052, ...lines.map((l) => (maxW / measure(l, 100)) * 100));
      card.style.fontSize = `${size.toFixed(1)}px`;
      const pal = PALETTES[plan.moodTrack[0]?.mood] || PALETTES.night;
      card.style.setProperty("--hookbg", pal[2]);
      card.style.setProperty("--hookink", pal[0]);
      const spans = [];
      lines.forEach((l) => {
        const ln = el("div", "ko-hookline", card);
        l.split(" ").forEach((w) => spans.push(el("span", "ko-hookword", el("span", "ko-hookmask", ln), w)));
      });
      // already readable on frame 0 (thumbnail); a small settle gives it life
      tl.fromTo(card, { scale: 1.06, rotation: -3 }, { scale: 1, rotation: -1.5, duration: 0.6, ease: "expo.out" }, 0);
      // the card takes the colour of each passage
      plan.moodTrack.slice(1).forEach((m) => {
        const p = PALETTES[m.mood] || PALETTES.night;
        tl.to(card, { "--hookbg": p[2], "--hookink": p[0], duration: 0.6, ease: "power1.inOut" }, m.t);
      });
      if (plan.cta) tl.to(box, { opacity: 0, y: -H * 0.02, duration: 0.4, ease: "power2.in" }, plan.cta.start - 0.1);
    }
    const bar = el("div", "ko-sbar", hud);
    const fill = el("div", "ko-sfill", bar);
    tl.fromTo(fill, { scaleX: 0 }, { scaleX: 1, duration: plan.cta ? plan.cta.start : plan.duration, ease: "none" }, 0);
  }

  // ---- call to action (any preset, typically social)
  if (plan.cta && (plan.cta.text || plan.cta.handle)) {
    const t0 = plan.cta.start;
    const pal = PALETTES[plan.moodTrack[plan.moodTrack.length - 1]?.mood] || PALETTES.night;
    const veil = el("div", "ko-veil", root);
    const card = el("div", "ko-cta", root);
    card.style.setProperty("--accent", pal[2]);
    let words = [];
    if (plan.cta.text) {
      const t = el("div", "ko-ctatext", card);
      const size = Math.min(u * 0.16, (W * 0.78 / measure(plan.cta.text.toUpperCase(), 100)) * 100);
      t.style.fontSize = `${size.toFixed(1)}px`;
      words = plan.cta.text.toUpperCase().split(/\s+/).map((w) => el("span", "ko-ctaword", el("span", "ko-hookmask", t), w));
    }
    let handle = null;
    if (plan.cta.handle) {
      handle = el("div", "ko-handle", card, plan.cta.handle);
      handle.style.fontSize = `${Math.round(u * 0.045)}px`;
    }
    // the card does not exist for the viewer (or the layout audit) before its moment
    tl.set(card, { autoAlpha: 0 }, 0);
    tl.set(card, { autoAlpha: 1 }, t0 - 0.1);
    tl.fromTo(veil, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.out" }, t0 - 0.1);
    if (words.length) tl.fromTo(words, { yPercent: 115 }, { yPercent: 0, duration: 0.55, ease: "expo.out", stagger: 0.07 }, t0);
    if (handle) tl.fromTo(handle, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: "back.out(2.4)" }, t0 + 0.35);
    if (handle) tl.to(handle, { scale: 1.06, duration: 0.18, ease: "power2.out", yoyo: true, repeat: 1 }, t0 + 1.1);
  }

  return { timeline: tl, draw: (t) => { if (drawWave) drawWave(t); } };
}

export const CSS = /* css */ `
  .ko-grain { position:absolute; inset:-2px; opacity:.085; mix-blend-mode: overlay; pointer-events:none; background-repeat: repeat; }
  .ko-hud { position:absolute; inset:0; font-family: "JetBrains Mono", monospace; letter-spacing:.14em; color: rgba(250,247,240,.8); text-shadow: 0 0 .6em rgba(0,0,0,.6); pointer-events:none; }
  .ko-hud > div, .ko-hud > canvas { position:absolute; white-space:nowrap; }
  .ko-tl { left:5%; top:5%; display:flex; align-items:center; gap:.8em; }
  .ko-dot { display:block; width:.55em; height:.55em; border-radius:50%; background: currentColor; box-shadow: 0 0 .8em currentColor; flex: none; }
  .ko-tr { right:5%; top:5%; }
  .ko-bl { left:5%; bottom:5%; } .ko-time { color: rgba(250,248,240,.9); }
  .ko-br { right:5%; bottom:5%; font-weight:700; }
  .ko-bar { left:5%; right:5%; bottom:3.2%; height:1px; background: rgba(255,255,255,.12); }
  .ko-fill { width:100%; height:100%; background: rgba(255,255,255,.55); transform-origin: 0 50%; }

  /* podcast */
  .ko-showtext { display:flex; flex-direction:column; gap:.35em; }
  .ko-showtitle { font-weight:700; }
  .ko-showsub { font-family: "Instrument Serif", serif; font-style: italic; letter-spacing: 0; font-size: 1.5em; color: rgba(250,247,240,.72); }
  .ko-podcast .ko-bar { bottom: 2.6%; }
  .ko-chips { left:5%; bottom: 15.5%; height: 1.5em; width: 60%; overflow: hidden; }
  .ko-podcast.ko-root-tall .ko-chips { bottom: 12%; }
  .ko-chip { position:absolute; left:0; bottom:0; display:flex; align-items:center; gap:.45em; font-family: "League Gothic", sans-serif;
    letter-spacing:.06em; color: var(--spk); text-shadow: 0 0 .5em color-mix(in srgb, var(--spk) 45%, transparent); }
  .ko-chipdot { display:block; width:.36em; height:.36em; border-radius:50%; background: var(--spk); box-shadow: 0 0 .6em var(--spk); }
  .ko-wave { left:5%; bottom: 4.5%; width: 90%; }

  /* social */
  .ko-hook { left:0; right:0; top: 9.5%; display:flex; justify-content:center; }
  .ko-hookcard { background: var(--hookbg); color: var(--hookink); font-family: "League Gothic", sans-serif; letter-spacing:.01em; text-shadow:none;
    line-height: .92; padding: .16em .32em .12em; border-radius: .08em; transform-origin: 0 50%; text-align:center;
    box-shadow: 0 .3em 1.2em rgba(0,0,0,.45); }
  .ko-hookline { display:flex; justify-content:center; gap:.22em; white-space:nowrap; }
  .ko-hookmask { display:inline-block; overflow:hidden; padding:.04em .02em 0; margin:-.04em -.02em 0; }
  .ko-hookword, .ko-ctaword { display:inline-block; }
  .ko-sbar { left: 13%; right: 13%; top: 7.2%; height: .32em; border-radius:.2em; background: rgba(255,255,255,.18); overflow:hidden; }
  .ko-sfill { width:100%; height:100%; background: rgba(255,255,255,.9); transform-origin: 0 50%; }

  /* light worlds */
  .ko-light .ko-grain { mix-blend-mode: multiply; opacity: .07; }
  .ko-light .ko-hud { color: rgba(18,18,24,.78); text-shadow: none; }
  .ko-light .ko-time { color: rgba(18,18,24,.9); }
  .ko-light .ko-dot { box-shadow: none; }
  .ko-light .ko-showsub { color: rgba(18,18,24,.65); }
  .ko-light .ko-bar { background: rgba(0,0,0,.12); } .ko-light .ko-fill { background: rgba(0,0,0,.6); }
  .ko-light .ko-sbar { background: rgba(0,0,0,.12); } .ko-light .ko-sfill { background: rgba(0,0,0,.75); }
  .ko-light .ko-chip { text-shadow: none; filter: saturate(1.3) brightness(.62); }
  .ko-light .ko-veil { background: radial-gradient(ellipse at 50% 50%, rgba(252,250,246,.82), rgba(244,240,232,.95)); }
  .ko-light .ko-ctatext { color: #14141a; text-shadow: none; }

  /* call to action */
  .ko-veil { position:absolute; inset:0; background: radial-gradient(ellipse at 50% 50%, rgba(0,0,0,.55), rgba(0,0,0,.82)); opacity:0; }
  .ko-cta { position:absolute; inset:0; visibility:hidden; display:flex; flex-direction:column; align-items:center; justify-content:center; gap: 2.4vh; }
  .ko-ctatext { display:flex; gap:.2em; font-family: "League Gothic", sans-serif; color: #fbf7ef; line-height:.9;
    text-shadow: 0 0 .3em color-mix(in srgb, var(--accent) 50%, transparent); }
  .ko-handle { font-family: "JetBrains Mono", monospace; font-weight:700; letter-spacing:.06em; color: #0b0812; background: var(--accent);
    padding: .35em .8em; border-radius: 2em; opacity:0; box-shadow: 0 0 1.4em color-mix(in srgb, var(--accent) 60%, transparent); }
`;
