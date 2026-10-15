// Kinetic typography — builds the lyric lockups as DOM and one paused GSAP timeline.
// Layout is measured with canvas text metrics (fonts must be loaded first), so it
// fits any frame size. Every random choice is seeded from the word index.
//
// Bundled by tools/build.mjs (esbuild, IIFE, global `KineticType`).

import { palettesOf, worldOf, createSignals } from "./signals.js";
import { makeGraphics, graphicsCss, TALL, WIDE } from "./graphics.js";

const GOTHIC = '"League Gothic"';
const SERIF = '"Instrument Serif"';
const STUB = 80; // the mow exit: % of the letter box above the cut
const LH = 0.86; // gothic line box (em)
const CHECK_EM = 0.95; // checklist box + gap (em of the line)

// the mower of the "mow" exit: a push mower seen from the side, facing right, drawn flat in
// the lockup's colours like the other graphics; wheels on the lawn at y 96 of 100
const MOWER_SVG = `<svg viewBox="0 0 170 100" width="100%" height="100%" overflow="visible">
<g class="mw-body">
<path class="mw-ink" d="M10 34 L40 40 Q44 41 44 46 L44 74 Q44 79 39 79 L14 76 Q9 75 9 70 L8 39 Q8 33 10 34 Z" fill-opacity=".28"/>
<path class="mw-line" d="M50 66 L12 8"/>
<path class="mw-line" d="M3 13 L21 3"/>
<path class="mw-acc" d="M44 86 L44 70 Q46 61 58 60 L138 60 Q152 62 158 76 L158 86 Z"/>
<rect class="mw-ink" x="44" y="83" width="114" height="5" rx="2.5" fill-opacity=".55"/>
<rect class="mw-ink" x="80" y="38" width="40" height="24" rx="5"/>
<rect class="mw-acc" x="88" y="31" width="24" height="9" rx="3"/>
<path class="mw-line mw-thin" d="M84 46 L116 46 M84 53 L116 53"/>
<path class="mw-line mw-thin" d="M80 44 L58 30"/>
</g>
<g class="mw-wheel"><circle class="mw-ink" cx="60" cy="86" r="10"/><circle class="mw-acc" cx="60" cy="86" r="3.6"/><rect class="mw-acc" x="58.8" y="77.5" width="2.4" height="5" rx="1.2"/></g>
<g class="mw-wheel"><circle class="mw-ink" cx="144" cy="87" r="9"/><circle class="mw-acc" cx="144" cy="87" r="3.2"/><rect class="mw-acc" x="142.8" y="79.2" width="2.4" height="4.4" rx="1.2"/></g>
</svg>`;

function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };

const SOFT_FX = new Set(["whisper"]);
// effects that reveal letters from below a baseline mask; everything else may glow / fly freely
const MASKED_FX = new Set(["mask", "wave"]);

export function build(root, plan, gsap) {
  const PALETTES = palettesOf(plan);
  const LIGHT = worldOf(plan).light;
  const W = plan.width, H = plan.height;
  const portrait = plan.portrait;
  const preset = plan.preset || "lyric";
  // safe box [x0, y0, x1, y1] as frame fractions: lyric = title-safe; podcast keeps clear of the
  // speaker chip + audiogram; social keeps clear of the hook card and the platform UI
  // (caption/username block at the bottom, action rail on the right).
  const SAFE = {
    lyric: [0.1, 0.13, 0.9, 0.87],
    podcast: portrait ? [0.07, 0.15, 0.93, 0.8] : [0.08, 0.13, 0.92, 0.78],
    social: portrait ? [0.07, plan.hook ? 0.24 : 0.14, 0.85, 0.72] : [0.08, plan.hook ? 0.24 : 0.14, 0.92, 0.82],
  }[preset] || [0.1, 0.13, 0.9, 0.87];
  // over footage the type keeps to the darkened band below the speaker (see build.mjs, plan.video)
  // (short-form: clear of the platform UI – caption/username block at the bottom, action rail right)
  // in a frame (a light world) the type keeps below it, or beside it in landscape
  if (plan.video?.frame) {
    const [, , fx1, fy1] = plan.video.frame;
    if (W > H * 1.2) SAFE[0] = Math.max(SAFE[0], fx1 + 0.04);
    else SAFE[1] = Math.max(SAFE[1], fy1 + 0.045);
    if (portrait) { SAFE[0] = 0.07; SAFE[2] = 0.88; SAFE[3] = 0.8; }
  } else if (plan.video) {
    SAFE[1] = Math.max(SAFE[1], plan.video.shade[0] + (plan.video.shade[1] - plan.video.shade[0]) * 0.55);
    if (portrait) { SAFE[0] = 0.07; SAFE[2] = 0.88; SAFE[3] = 0.78; }
  }
  const drift = plan.style?.drift ?? 1;
  // a lockup breathes while it is up (push-in up to +4 %, pulses on strong words): lay it out in
  // a box narrow enough that the grown lockup still stays inside the safe area
  { const ix = ((SAFE[2] - SAFE[0]) * (0.04 * drift + 0.04)) / 2; SAFE[0] += ix; SAFE[2] -= ix; }
  const safeW = W * (SAFE[2] - SAFE[0]), safeH = H * (SAFE[3] - SAFE[1]);
  const speakerColor = Object.fromEntries((plan.speakers || []).map((s) => [s.id, s.color]));
  const S = createSignals(plan);
  const ctx = document.createElement("canvas").getContext("2d");
  const measure = (text, style, size) => {
    ctx.font = style === "serif" ? `italic 400 ${size}px ${SERIF}` : `400 ${size}px ${GOTHIC}`;
    return ctx.measureText(text).width;
  };
  const tl = gsap.timeline({ paused: true });
  const words = plan.words;

  const styleOf = (w) => (w.role === "fn" && !w.hero ? "serif" : SOFT_FX.has(w.fx) ? "serif" : "gothic");
  const textOf = (w, style) => (style === "gothic" ? w.display.toUpperCase() : w.display.toLowerCase() === "i" ? "I" : w.display);

  // ------------------------------------------------------------ layout
  // A line is a list of tokens {w, style, k}; k = size factor relative to the line size.
  function tokens(ws, fnK = 0.56) {
    return ws.map((w) => {
      const style = styleOf(w);
      return { w, style, k: style === "serif" ? (w.role === "fn" ? fnK : w.fx === "whisper" ? 0.62 : 0.78) : 1 };
    });
  }
  function width100(line) {
    let sum = 0;
    line.forEach((tk, i) => {
      const m = measure(textOf(tk.w, tk.style), tk.style, 100 * tk.k);
      // a circled word keeps room for its circle, which is wider than the word (see noteSvg)
      sum += m + (tk.w.note === "circle" ? m * 0.12 + 40 * tk.k : 0);
      if (i) sum += 100 * 0.2 * Math.min(tk.k, line[i - 1].k);
    });
    return sum;
  }
  function fit(line, targetW, cap) {
    const w = width100(line) || 1;
    return Math.min(cap, (targetW / w) * 100);
  }

  function layoutPhrase(ph) {
    const ws = ph.words.map((i) => words[i]);
    const hero = ph.hero != null ? words[ph.hero] : null;
    let lines = []; // {tokens, size, align, dx}
    const blockW = portrait || ph.layout === "quote" ? safeW : Math.min(safeW, safeH * (ph.layout === "block" ? 1.05 : 1.5));
    // a data graphic sits under the text and takes its share of the height; over footage the type
    // has only the dark band below the speaker, and a share of it would leave a clock no bigger
    // than a line of text: at least a share of the frame, as long as the text keeps most of the band
    const vk = ph.viz != null ? words[ph.viz].viz.kind : null;
    const tall = vk === "growth" || TALL.has(vk);
    const vizH = !vk ? 0 : tall
      ? Math.min(Math.max(safeH * (portrait ? 0.26 : 0.34), H * 0.11), safeH * 0.42)
      : Math.min(Math.max(safeH * (portrait ? 0.17 : 0.19), H * 0.07), safeH * 0.3);
    const availH = safeH - (vizH ? vizH + H * 0.03 : 0);

    if (ph.layout === "list" && ph.items) {
      // checklist: one item per line, flush left behind a checkbox
      const its = ph.items.map((ids) => tokens(ids.map((i) => words[i]), 0.62));
      const size = Math.min(...its.map((t) => Math.min(availH * 0.22, (blockW * 0.8) / (width100(t) / 100 + CHECK_EM))));
      its.forEach((t) => lines.push({ tokens: t, size, align: "left", check: true }));
    } else if (ph.layout === "quote") {
      // a quotation: the whole sentence, balanced over 1–4 lines at one size
      const total = ws.reduce((n, w) => n + w.display.length + 1, 0);
      const nLines = clamp(Math.round(total / (portrait ? 15 : 24)), 1, 4);
      const groups = [];
      let acc = 0, cur = [];
      for (const w of ws) {
        cur.push(w); acc += w.display.length + 1;
        if (acc >= (total / nLines) * (groups.length + 1) && groups.length < nLines - 1) { groups.push(cur); cur = []; }
      }
      if (cur.length) groups.push(cur);
      const toks = groups.map((g) => tokens(g, 0.72));
      const size = Math.min(...toks.map((t) => fit(t, blockW * 0.9, (availH * 0.82) / toks.length / LH)));
      toks.forEach((t) => lines.push({ tokens: t, size, align: "center" }));
    } else if (ph.layout === "hero" && hero) {
      const hi = ws.indexOf(hero);
      const pre = ws.slice(0, hi), post = ws.slice(hi + 1);
      const heroLine = tokens([hero]);
      // a marker adds ~0.1em on each side: leave it room
      const heroSize = fit(heroLine, (portrait ? safeW * 0.98 : safeW * 0.8) * (hero.mark ? 0.9 : 1), safeH * (portrait ? 0.4 : 0.62));
      const small = (arr) => {
        // the words around the hero still have to read on a phone: ~40% of the hero, not a footnote
        const t = tokens(arr, 0.9).map((tk) => ({ ...tk, k: tk.style === "serif" ? 1 : 0.82 }));
        return { tokens: t, size: Math.min(heroSize * 0.42, fit(t, safeW * 0.9, H)), align: "center" };
      };
      if (pre.length) lines.push(small(pre));
      lines.push({ tokens: heroLine, size: heroSize, align: "center", hero: true });
      if (post.length) lines.push(small(post));
    } else if (ph.layout === "inline" || (ph.layout === "split" && ws.length < 3)) {
      let t = tokens(ws, 0.62);
      let size = fit(t, safeW, safeH * 0.3);
      if (size < H * 0.11 && ws.length > 2) {
        // two balanced lines
        const total = ws.reduce((n, w) => n + w.display.length, 0);
        let acc = 0, cut = 1;
        for (let i = 0; i < ws.length; i++) { acc += ws[i].display.length; if (acc >= total / 2) { cut = Math.max(1, i + 1); break; } }
        const a = tokens(ws.slice(0, cut), 0.62), b = tokens(ws.slice(cut), 0.62);
        size = Math.min(fit(a, safeW, safeH * 0.3), fit(b, safeW, safeH * 0.3));
        lines.push({ tokens: a, size, align: "center" }, { tokens: b, size, align: "center" });
      } else lines.push({ tokens: t, size, align: "center" });
    } else if (ph.layout === "split") {
      const half = Math.ceil(ws.length / 2);
      const a = tokens(ws.slice(0, half)), b = tokens(ws.slice(half));
      const sa = fit(a, safeW * 0.62, safeH * 0.34), sb = fit(b, safeW * 0.7, safeH * 0.42);
      lines.push({ tokens: a, size: sa, align: "left" }, { tokens: b, size: sb, align: "right" });
    } else {
      // block / cascade: function words ride along with the next content word
      const groups = [];
      let pending = [];
      for (const w of ws) {
        if (w.role === "fn" && !w.hero) { pending.push(w); continue; }
        groups.push([...pending, w]); pending = [];
      }
      if (pending.length) { if (groups.length) groups[groups.length - 1].push(...pending); else groups.push(pending); }
      // merge very short groups on wide frames so the block stays readable
      const maxLines = portrait ? 5 : 4;
      while (groups.length > maxLines) {
        let best = 0, bestLen = 1e9;
        for (let i = 0; i < groups.length - 1; i++) {
          const len = groups[i].concat(groups[i + 1]).reduce((n, w) => n + w.display.length, 0);
          if (len < bestLen) { bestLen = len; best = i; }
        }
        groups.splice(best, 2, groups[best].concat(groups[best + 1]));
      }
      // no orphans: a lone short word ("one", "work") joins its neighbour – the next line,
      // or the previous one at the end – so it never stands apart from what it belongs to
      for (let i = 0; i < groups.length && groups.length > 1; i++) {
        const g = groups[i];
        if (g.length !== 1 || g[0].display.length > 7 || g[0].hero) continue;
        const j = i < groups.length - 1 ? i + 1 : i - 1;
        if (groups[j].length > 3) continue;
        groups.splice(Math.min(i, j), 2, i < j ? g.concat(groups[j]) : groups[j].concat(g));
        i = -1; // re-scan after a merge
      }
      const cascade = ph.layout === "cascade";
      groups.forEach((g, i) => {
        const t = tokens(g);
        const isHero = g.includes(hero);
        const emph = Math.max(...g.map((w) => w.emphasis));
        const cap = safeH * (isHero ? 0.42 : 0.16 + emph * 0.18);
        const target = cascade ? blockW * (isHero ? 0.95 : 0.62 + emph * 0.25) : blockW;
        // cascade = one staircase from top-left to bottom-right, so the eye follows it down
        lines.push({ tokens: t, size: fit(t, target, cap), align: cascade ? "left" : "center", hero: isHero, step: cascade ? i / Math.max(1, groups.length - 1) : null });
      });
    }

    // vertical fit
    const totalH = lines.reduce((n, l) => n + l.size * (LH + 0.1), 0) + (lines.length - 1) * H * 0.012;
    const k = totalH > availH ? availH / totalH : 1;
    lines.forEach((l) => (l.size *= k));
    // floor: no word smaller than ~5.5% of the short frame side. Small tokens grow first;
    // if that makes a line too wide, the whole line shrinks back to fit.
    const minPx = Math.min(W, H) * (portrait ? 0.052 : 0.056);
    const lineW = (l) => (width100(l.tokens) / 100 + (l.check ? CHECK_EM : 0)) * l.size;
    for (const l of lines) {
      for (let pass = 0; pass < 3; pass++) {
        l.tokens = l.tokens.map((tk) => ({ ...tk, k: Math.min(1, Math.max(tk.k, minPx / l.size)) }));
        const over = lineW(l) / (safeW * (portrait ? 0.98 : 0.92));
        if (over <= 1) break;
        l.size /= over;
      }
    }
    const maxLineW = Math.max(...lines.map(lineW));
    let bw = Math.max(maxLineW, ph.layout === "split" ? safeW * 0.85 : 0);
    if (ph.layout === "cascade" && lines.length > 1) {
      // widen the block a little so the steps are visible even when the lines are equally long
      bw = Math.min(safeW, Math.max(bw, maxLineW * 1.18));
      lines.forEach((l) => (l.indent = l.step != null ? (bw - lineW(l)) * l.step : 0));
    }
    // wide graphics (two sides, a line, labels in a row) take the full width they may have
    const vizW = vizH ? Math.min(safeW * (portrait ? 0.9 : 0.62), WIDE.has(vk) ? safeW : Math.max(bw, safeW * (vk === "growth" || vk === "split" ? 0.56 : 0.42))) : 0;
    return { lines, blockW: Math.max(bw, vizW), vizW, vizH };
  }


  // ------------------------------------------------------------ graphics (SVG, px viewBoxes)
  const NS = "http://www.w3.org/2000/svg";
  const svgEl = (parent, w, h, cls) => {
    const host = el("div", cls, parent);
    host.innerHTML = `<svg xmlns="${NS}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}"></svg>`;
    return { host, svg: host.firstChild };
  };
  const f1 = (v) => v.toFixed(1);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  // chart figures in the transcript's own format: 258.000 € / €258,000
  const DE = plan.lang === "de";
  const fmtNum = (v) => {
    const r = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
    const [a, b] = String(r).split(".");
    const g = a.replace(/\B(?=(\d{3})+(?!\d))/g, DE ? "." : ",");
    return b ? g + (DE ? "," : ".") + b : g;
  };
  const withUnit = (v, unit = "") =>
    unit === "€" ? (DE ? `${fmtNum(v)} €` : `€${fmtNum(v)}`) : unit === "$" ? `$${fmtNum(v)}` : unit === "%" ? `${fmtNum(v)}%` : `${fmtNum(v)}${unit ? " " + unit : ""}`;
  // the graphics beyond the five charts below (engine/graphics.js)
  const G = makeGraphics({ f1, esc, clamp, withUnit, fmtNum, DE });

  // checklist box with a tick that draws itself
  function checkBox(ln) {
    const box = el("span", "ky-check", ln);
    box.innerHTML = `<svg xmlns="${NS}" viewBox="0 0 100 100"><rect class="ky-cb" x="7" y="7" width="86" height="86" rx="18"/>`
      + `<path class="ky-tick" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1" d="M22 52 L42 72 L80 28"/></svg>`;
    return { el: box, tick: box.querySelector(".ky-tick") };
  }

  // hand-drawn circle / underline / strike, in the word's own pixel space
  function noteSvg(wd, w, kind, size, tw, marked) {
    const r = rng(w.i * 7 + 3);
    const th = size * LH;
    const px = size * 0.34 + tw * 0.08, py = size * 0.38;
    const W2 = tw + 2 * px, H2 = th + 2 * py;
    const { host, svg } = svgEl(wd, W2, H2, `ky-note ky-note-${kind}`);
    Object.assign(host.style, { left: `${f1(-px)}px`, top: `${f1(-py)}px` });
    if (marked) wd.style.setProperty("--note", "var(--ink)");
    const ds = [];
    if (kind === "circle") {
      // around a marker the circle has to clear the marker's box, not just the letters
      const cx = px + tw / 2, cy = py + th * 0.5, rx = tw / 2 + size * (marked ? 0.24 : 0.18), ry = th / 2 + size * (marked ? 0.14 : 0.07);
      const a0 = -2.5 + r() * 0.4, sweep = Math.PI * 2 * 1.1, ph0 = r() * 6, tilt = (r() - 0.5) * 0.08;
      let d = "";
      for (let k = 0; k <= 72; k++) {
        const t = k / 72, a = a0 + t * sweep;
        const kk = 1 + 0.035 * Math.sin(t * 9 + ph0) + 0.06 * t;
        const x = rx * kk * Math.cos(a), y = ry * kk * Math.sin(a);
        d += `${k ? "L" : "M"}${f1(cx + x * Math.cos(tilt) - y * Math.sin(tilt))} ${f1(cy + x * Math.sin(tilt) + y * Math.cos(tilt))}`;
      }
      ds.push([d, Math.max(2.5, size * 0.04)]);
    } else if (kind === "underline") {
      const y = py + th * (marked ? 1.08 : 0.98), x0 = px - Math.min(tw * 0.04, size * 0.14), x1 = px + tw + Math.min(tw * 0.04, size * 0.14);
      ds.push([`M${f1(x0)} ${f1(y)} C${f1(px + tw * 0.3)} ${f1(y + size * 0.05)} ${f1(px + tw * 0.65)} ${f1(y - size * 0.05)} ${f1(x1)} ${f1(y - size * 0.02)}`, Math.max(2.5, size * 0.045)]);
      ds.push([`M${f1(px + tw * 0.12)} ${f1(y + size * 0.11)} Q${f1(px + tw * 0.55)} ${f1(y + size * 0.06)} ${f1(px + tw * 0.92)} ${f1(y + size * 0.1)}`, Math.max(2, size * 0.032)]);
    } else {
      const y = py + th * 0.52, x0 = px - Math.min(tw * 0.06, size * 0.18), x1 = px + tw + Math.min(tw * 0.06, size * 0.18);
      ds.push([`M${f1(x0)} ${f1(y + size * 0.04)} C${f1(px + tw * 0.35)} ${f1(y + size * 0.01)} ${f1(px + tw * 0.7)} ${f1(y - size * 0.03)} ${f1(x1)} ${f1(y - size * 0.05)}`, Math.max(3, size * 0.07)]);
    }
    svg.innerHTML = ds.map(([d, sw]) => `<path pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1" stroke-width="${f1(sw)}" d="${d}"/>`).join("");
    return { el: host, paths: Array.from(svg.querySelectorAll("path")) };
  }

  // data graphic under the phrase
  function vizSvg(lk, viz, vw, vh, pi) {
    const { host, svg } = svgEl(lk, vw, vh, `ky-viz ky-viz-${viz.kind}`);
    const fs = clamp(vh * 0.19, 14, 36);
    const out = { el: host, kind: viz.kind, viz, vw, vh };
    if (viz.kind === "gauge") {
      const n = 20, bh = Math.min(vh * 0.42, vw * 0.075), y = vh * 0.4 - bh / 2, gap = Math.min(bh * 0.22, vw * 0.008);
      const sw = (vw - gap * (n - 1)) / n;
      const segs = Array.from({ length: n }, (_, k) => `<rect x="${f1(k * (sw + gap))}" y="${f1(y)}" width="${f1(sw)}" height="${f1(bh)}" rx="${f1(Math.min(sw, bh) * 0.22)}"/>`).join("");
      const ly = y + bh + fs * 1.35;
      svg.innerHTML = `<defs><clipPath id="kyclip${pi}"><rect class="ky-clip" x="0" y="0" width="0" height="${f1(vh)}"/></clipPath></defs>`
        + `<g class="ky-track">${segs}</g><g class="ky-fill" clip-path="url(#kyclip${pi})">${segs}</g>`
        + `<text class="ky-lbl" x="0" y="${f1(ly)}" font-size="${f1(fs)}">0</text>`
        + `<text class="ky-lbl" x="${f1(vw / 2)}" y="${f1(ly)}" font-size="${f1(fs)}" text-anchor="middle">50</text>`
        + `<text class="ky-lbl" x="${f1(vw)}" y="${f1(ly)}" font-size="${f1(fs)}" text-anchor="end">100%</text>`;
      out.clip = svg.querySelector(".ky-clip");
      out.full = vw * clamp(viz.value / 100, 0, 1);
    } else if (viz.kind === "compare") {
      const v = viz.value, lw = fs * 2.6, x0 = lw + fs * 0.7, L = vw - x0;
      const b1 = v >= 1 ? L / v : L, b2 = v >= 1 ? L : L * v;
      const bh = vh * 0.36, y1 = vh * 0.06, y2 = vh * 0.56, rx = bh * 0.18;
      const lbl = (x) => (Number.isInteger(x) ? String(x) : x === 0.5 ? "½" : x.toFixed(1)) + "×";
      svg.innerHTML = `<text class="ky-lbl" x="${f1(lw)}" y="${f1(y1 + bh * 0.5 + fs * 0.36)}" font-size="${f1(fs)}" text-anchor="end">1×</text>`
        + `<text class="ky-lbl ky-lbl-hi" x="${f1(lw)}" y="${f1(y2 + bh * 0.5 + fs * 0.42)}" font-size="${f1(fs * 1.25)}" text-anchor="end">${lbl(v)}</text>`
        + `<rect class="ky-bar0" x="${f1(x0)}" y="${f1(y1)}" width="0" height="${f1(bh)}" rx="${f1(rx)}"/>`
        + `<rect class="ky-ghost" x="${f1(x0)}" y="${f1(y2)}" width="${f1(b1)}" height="${f1(bh)}" rx="${f1(rx)}"/>`
        + `<rect class="ky-bar1" x="${f1(x0)}" y="${f1(y2)}" width="0" height="${f1(bh)}" rx="${f1(rx)}"/>`;
      Object.assign(out, { b1, b2, bar0: svg.querySelector(".ky-bar0"), bar1: svg.querySelector(".ky-bar1"), ghost: svg.querySelector(".ky-ghost"), hi: svg.querySelector(".ky-lbl-hi") });
    } else if (viz.kind === "growth") {
      // compound growth: the curve bends upward, the straight line is what went in
      const gs = clamp(vh * 0.1, 14, 34);
      const endTxt = withUnit(viz.value, viz.unit), baseTxt = viz.base > 0 && viz.base < viz.value ? withUnit(viz.base, viz.unit) : null;
      const lblW = Math.max(endTxt.length * 1.25, (baseTxt || "").length) * gs * 0.62 + gs * 0.7;
      const pw = vw - lblW, top = gs * 0.9, bot = vh - gs * 1.7, ch = bot - top;
      const k = 3.2, fx = (x) => (Math.exp(k * x) - 1) / (Math.exp(k) - 1);
      const pts = Array.from({ length: 49 }, (_, j) => [(j / 48) * pw, bot - ch * fx(j / 48)]);
      const d = "M" + pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join(" L");
      const by = baseTxt ? bot - (ch * viz.base) / viz.value : 0;
      const sw = Math.max(3, gs * 0.2);
      svg.innerHTML = `<defs><clipPath id="kyclip${pi}"><rect class="ky-clip" x="-${f1(sw)}" y="-${f1(sw)}" width="0" height="${f1(vh + sw * 2)}"/></clipPath></defs>`
        + `<line class="ky-axis" x1="0" y1="${f1(bot)}" x2="${f1(pw)}" y2="${f1(bot)}" stroke-width="${f1(sw * 0.5)}"/>`
        + `<g clip-path="url(#kyclip${pi})"><path class="ky-area" d="${d} L${f1(pw)} ${f1(bot)} L0 ${f1(bot)} Z"/>`
        + (baseTxt ? `<path class="ky-baseline" d="M0 ${f1(bot)} L${f1(pw)} ${f1(by)}" stroke-width="${f1(sw * 0.6)}" stroke-dasharray="${f1(sw * 1.6)} ${f1(sw * 1.4)}"/>` : "")
        + `</g><path class="ky-curve" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1" d="${d}" stroke-width="${f1(sw)}"/>`
        + `<circle class="ky-dot" cx="${f1(pw)}" cy="${f1(top)}" r="${f1(sw * 1.5)}"/>`
        + `<text class="ky-lbl ky-lbl-hi ky-end" x="${f1(pw + gs * 0.6)}" y="${f1(top + gs * 0.45)}" font-size="${f1(gs * 1.25)}">${esc(endTxt)}</text>`
        + (baseTxt && by - top > gs * 1.7 ? `<text class="ky-lbl ky-end" x="${f1(pw + gs * 0.6)}" y="${f1(by + gs * 0.35)}" font-size="${f1(gs)}">${esc(baseTxt)}</text>` : "")
        + `<text class="ky-lbl" x="0" y="${f1(bot + gs * 1.35)}" font-size="${f1(gs * 0.85)}">0</text>`
        + (viz.label ? `<text class="ky-lbl" x="${f1(pw)}" y="${f1(bot + gs * 1.35)}" font-size="${f1(gs * 0.85)}" text-anchor="end">${esc(viz.label.toUpperCase())}</text>` : "");
      Object.assign(out, { clip: svg.querySelector(".ky-clip"), curve: svg.querySelector(".ky-curve"), dot: svg.querySelector(".ky-dot"), ends: Array.from(svg.querySelectorAll(".ky-end")), full: vw + sw * 2 });
    } else if (viz.kind === "split") {
      // one bar, the parts of a whole; the part the phrase talks about in the accent
      const parts = viz.parts, tot = parts.reduce((a, p) => a + p.value, 0);
      const gap = Math.max(3, vw * 0.006), bh = vh * 0.26, y = vh * 0.38, n = parts.length;
      const usable = vw - gap * (n - 1);
      const hi = viz.focus != null && viz.focus < n ? viz.focus : n - 1;
      let x = 0;
      const segs = parts.map((p, j) => { const w = (usable * p.value) / tot, sg = { x, w, p, j }; x += w + gap; return sg; });
      svg.innerHTML = segs.map((g) => `<rect class="ky-seg${g.j === hi ? " ky-seg-hi" : ""}" x="${f1(g.x)}" y="${f1(y)}" width="0" height="${f1(bh)}" rx="${f1(bh * 0.16)}" data-w="${f1(g.w)}"/>`).join("")
        + segs.map((g) => {
          const end = n > 1 && g.j === n - 1, tx = end ? g.x + g.w : g.x, anchor = end ? "end" : "start";
          return `<text class="ky-lbl ky-seglbl${g.j === hi ? " ky-lbl-hi" : ""}" x="${f1(tx)}" y="${f1(y - fs * 0.45)}" font-size="${f1(fs * 1.1)}" text-anchor="${anchor}">${esc(withUnit(g.p.value, viz.unit))}</text>`
            + `<text class="ky-cap2 ky-seglbl" x="${f1(tx)}" y="${f1(y + bh + fs * 1.15)}" font-size="${f1(fs * 1.05)}" text-anchor="${anchor}">${esc(g.p.label)}</text>`;
        }).join("");
      Object.assign(out, { segs: Array.from(svg.querySelectorAll(".ky-seg")), lbls: Array.from(svg.querySelectorAll(".ky-seglbl")) });
    } else if (G.has(viz.kind)) {
      out.g = G.build(svg, viz, vw, vh, fs);
    } else {
      const n = Math.round(viz.value), rows = n <= 12 ? 1 : n <= 24 ? 2 : 3, cols = Math.ceil(n / rows);
      const cell = Math.min(vh / rows, vw / cols), s = cell * 0.8;
      const gx = (vw - cols * cell) / 2 + (cell - s) / 2, gy = (vh - rows * cell) / 2 + (cell - s) / 2;
      const shape = {
        person: `<circle cx="${f1(s / 2)}" cy="${f1(s * 0.24)}" r="${f1(s * 0.17)}"/><path d="M${f1(s * 0.16)} ${f1(s)} V${f1(s * 0.74)} A${f1(s * 0.34)} ${f1(s * 0.3)} 0 0 1 ${f1(s * 0.84)} ${f1(s * 0.74)} V${f1(s)} Z"/>`,
        day: `<rect x="${f1(s * 0.06)}" y="${f1(s * 0.1)}" width="${f1(s * 0.88)}" height="${f1(s * 0.84)}" rx="${f1(s * 0.14)}"/>`,
        tick: `<rect x="${f1(s * 0.36)}" y="${f1(s * 0.06)}" width="${f1(s * 0.28)}" height="${f1(s * 0.88)}" rx="${f1(s * 0.14)}"/>`,
      }[viz.icon] || `<circle cx="${f1(s / 2)}" cy="${f1(s / 2)}" r="${f1(s * 0.36)}"/>`;
      let g = "";
      for (let k = 0; k < n; k++) {
        const x = gx + (k % cols) * cell, y = gy + Math.floor(k / cols) * cell;
        g += `<g transform="translate(${f1(x)} ${f1(y)})"><g class="ky-ghostu">${shape}</g><g class="ky-unit">${shape}</g></g>`;
      }
      svg.innerHTML = g;
      out.units = Array.from(svg.querySelectorAll(".ky-unit"));
    }
    return out;
  }

  // ------------------------------------------------------------ DOM
  if (LIGHT) root.classList.add("ky-light");
  if (plan.video && !plan.video.frame) root.classList.add("ky-video");
  const scrim = el("div", "ky-scrim", root);
  const stage = el("div", "ky-stage", root);
  const px = (v) => `${Math.round(v)}px`;
  stage.style.setProperty("--sx0", px(W * SAFE[0])); stage.style.setProperty("--sy0", px(H * SAFE[1]));
  stage.style.setProperty("--sx1", px(W * (1 - SAFE[2]))); stage.style.setProperty("--sy1", px(H * (1 - SAFE[3])));
  scrim.style.setProperty("--scx", `${(((SAFE[0] + SAFE[2]) / 2) * 100).toFixed(1)}%`);
  scrim.style.setProperty("--scy", `${(((SAFE[1] + SAFE[3]) / 2) * 100).toFixed(1)}%`);
  const phraseEls = [];

  plan.phrases.forEach((ph) => {
    const pal = PALETTES[ph.mood] || PALETTES.night;
    const box = el("div", "ky-ph", stage);
    box.dataset.ph = ph.id;
    box.style.setProperty("--ink", pal[4]);
    box.style.setProperty("--accent", pal[2]);
    box.style.setProperty("--glow", pal[3]);
    if (ph.speaker != null && speakerColor[ph.speaker]) box.style.setProperty("--accent", speakerColor[ph.speaker]);
    box.style.setProperty("--markink", pal[0]);
    const lk = el("div", "ky-lk", box);
    const halo = el("div", "ky-halo", lk); // local veil: the world dims right behind the words, wherever they stand
    const qmark = ph.layout === "quote" ? el("div", "ky-qmark", lk) : null;
    if (qmark) qmark.textContent = "\u201C";
    const { lines, blockW, vizW, vizH } = layoutPhrase(ph);
    lk.style.width = `${Math.ceil(blockW)}px`;
    // horizontal placement variety on wide frames
    if (!portrait && ph.layout !== "hero" && ph.layout !== "inline" && ph.layout !== "quote") {
      const slack = Math.max(0, safeW - blockW) / 2;
      const dx = ph.align === "left" ? -slack * 0.7 : ph.align === "right" ? slack * 0.7 : 0;
      box.style.setProperty("--dx", `${dx.toFixed(1)}px`);
    }
    const wordEls = [];
    lines.forEach((line, li) => {
      const ln = el("div", `ky-ln ky-${line.align}${line.hero ? " ky-heroline" : ""}`, lk);
      ln.style.fontSize = `${line.size.toFixed(2)}px`;
      const check = line.check ? checkBox(ln) : null;
      if (line.indent) ln.style.paddingLeft = `${line.indent.toFixed(1)}px`;
      // breathing room where a marker or a pen mark would touch the line above
      const prevNote = li > 0 && lines[li - 1].tokens.some((tk) => tk.w.note);
      if (li > 0 && (prevNote || line.tokens.some((tk) => tk.w.mark && tk.style === "gothic"))) ln.style.marginTop = "0.1em";
      line.tokens.forEach((tk) => {
        const fx = tk.w.fx || (tk.w.role === "fn" ? "soft" : ph.enter);
        const masked = MASKED_FX.has(fx);
        const marked = tk.w.mark && tk.style === "gothic";
        const wd = el("div", `ky-w ky-${tk.style}${tk.w.hero && !marked ? " ky-hero" : ""}${tk.w.role === "fn" ? " ky-fn" : ""}${masked ? "" : " ky-free"}${marked ? " ky-marked" : ""}`, ln);
        wd.style.fontSize = `${tk.k}em`;
        wd.dataset.w = tk.w.i;
        const marker = marked ? el("i", "ky-marker", wd) : null;
        const mk = el("div", "ky-mk", wd);
        const txt = textOf(tk.w, tk.style);
        const chars = [];
        if (fx === "count") {
          // the number counts up inside one span; fixed width so the line doesn't jitter
          const ch = el("span", "ky-ch ky-num", mk); ch.textContent = txt; chars.push(ch);
          ch.style.width = `${(measure(txt, "gothic", 100) / 100).toFixed(3)}em`;
        } else for (const c of Array.from(txt)) { const ch = el("span", "ky-ch", mk); ch.textContent = c; chars.push(ch); }
        const we = { w: tk.w, wd, mk, chars, marker, size: line.size * tk.k, style: tk.style, txt };
        if (check && tk === line.tokens[0]) we.check = { ...check, endAt: line.tokens[line.tokens.length - 1].w.end }; // the item's first word owns the box
        if (tk.w.note) {
          const tw = measure(txt, tk.style, we.size) + (tk.style === "gothic" ? we.size * 0.012 * txt.length : 0); // + letter-spacing
          // an underline above another line would run into it: circle the word instead –
          // unless the circle (about 1.1 × the word + 0.4 em) would not fit the frame
          const wide = tw * 1.1 + we.size * 0.4 > safeW;
          let kind = tk.w.note;
          if (kind === "underline" && li < lines.length - 1 && !wide) kind = "circle";
          if (kind === "circle" && wide) kind = "underline";
          we.note = noteSvg(wd, tk.w, kind, we.size, tw, marked);
          we.note.kind = kind;
        }
        wordEls.push(we);
      });
    });
    const viz = ph.viz != null ? vizSvg(lk, words[ph.viz].viz, vizW, vizH, ph.index) : null;
    if (qmark) qmark.style.fontSize = `${(lines[0].size * 1.5).toFixed(1)}px`;
    phraseEls.push({ ph, box, lk, wordEls, viz, halo, qmark });
  });

  // ------------------------------------------------------------ motion
  const E = { out: "expo.out", in: "power2.in" };

  // How long each effect needs before the word is readable. Effects start that much
  // *before* the spoken onset, so legibility – not the first pixel – hits the beat.
  const LEAD = {
    soft: 0.1, mask: 0.1, rise: 0.24, drop: 0.32, flicker: 0.1, glow: 0.08, sparkle: 0.16, fog: 0.24, whisper: 0.16,
    slam: 0.06, glitch: 0.04, wave: 0.1, snap: 0.06, spin: 0.2, pulse: 0.1, shatter: 0.05, flash: 0.08, streak: 0.12, depth: 0.2, blur: 0.12,
    blink: 0.1, redact: 0.14, bounce: 0.14, window: 0.2,
    grow: 0.2, shrink: 0.08, type: 0.06, scramble: 0.08, tremble: 0.08, assemble: 0.3, freeze: 0.08, echo: 0.1,
  };
  // seconds until a word is whole, per effect (schedule + QA)
  const READY_AT = {
    soft: 0.3, mask: 0.38, rise: 0.85, drop: 0.55, flicker: 0.42, glow: 0.2, sparkle: 0.3, fog: 0.85, whisper: 0.3, slam: 0.25,
    glitch: 0.45, wave: 0.38, spin: 0.45, pulse: 0.35, shatter: 0.2, flash: 0.55, streak: 0.35, depth: 0.7, blur: 0.4, count: 0.45, snap: 0.14,
    blink: 0.22, redact: 0.4, bounce: 0.45, window: 0.3,
    grow: 0.85, shrink: 0.25, type: 0.1, scramble: 0.2, tremble: 0.2, assemble: 0.8, freeze: 0.2, echo: 0.3,
  };
  const fxOf = (w, ph) => w.fx || (w.role === "fn" ? "soft" : ph.enter);
  const baseAppear = (ph) => {
    const first = words[ph.words[0]];
    return Math.max(0, Math.min(ph.tIn, first.start - (LEAD[fxOf(first, ph)] ?? 0.1)));
  };
  // Schedule all lockups in order, so two never share the screen: a phrase leaves as the next
  // one is due, but the last word gets a minimum read; when fast speech makes that impossible
  // the old phrase does a quick fade and the new one waits for it (a beat at most).
  // The mower exit: one mower per line, in reading order. Each follows its line's words in,
  // its blade (the deck's front edge) reaching a word's first letter MOW_LAG after the word
  // starts to appear, and starts only when the line above is done. Planned with the
  // schedule, so the next lockup knows when the last cut falls.
  const MOW_LAG = 0.3, MOW_OFF = 0.2; // its lag behind a word, the drive off the line after the last cut
  const offsetIn = (node, anc) => {
    let x = 0, y = 0;
    for (let n = node; n && n !== anc; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
    return { x, y };
  };
  function mowPlan({ ph, lk, wordEls }, show) {
    const rows = [];
    wordEls.forEach((we) => {
      const ln = we.wd.parentElement;
      if (!rows.length || rows[rows.length - 1].ln !== ln) rows.push({ ln, wes: [] });
      rows[rows.length - 1].wes.push(we);
    });
    const appear = (w) => Math.max(show, w.start - (LEAD[fxOf(w, ph)] ?? 0.1)) + MOW_LAG;
    const vmax = W * 1.6;
    let prev = -Infinity;
    rows.forEach((row) => {
      const size = Math.max(...row.wes.map((we) => we.size)) || H * 0.08;
      row.mh = clamp(size * 0.85, H * 0.05, H * 0.16);
      row.mw = row.mh * 1.7;
      row.blade = row.mw * 0.9;
      row.lawn = offsetIn(row.ln, lk).y + row.ln.offsetHeight * 0.98;
      const chars = row.wes.flatMap((we) => we.chars);
      const left = offsetIn(chars[0], lk).x, last = chars[chars.length - 1];
      const right = offsetIn(last, lk).x + last.offsetWidth;
      row.x0 = left - row.mw * 0.95;
      const start = Math.max(appear(row.wes[0].w), prev + 0.05);
      const path = [{ x: row.x0 + row.blade, t: start }];
      const step = (x, t) => { const p = path[path.length - 1]; if (x > p.x) path.push({ x, t: Math.max(t, p.t + (x - p.x) / vmax) }); };
      row.wes.forEach((we) => step(offsetIn(we.chars[0], lk).x, appear(we.w)));
      step(right + row.mw * 0.15, start + 0.35);
      row.path = path;
      row.end = prev = path[path.length - 1].t;
    });
    return { rows, start: rows[0].path[0].t, end: prev };
  }

  const SCHED = new Map();
  const MOWS = new Map(); // the mower plans, apart from the schedule the QA reads
  {
    let prevGone = 0;
    plan.phrases.forEach((ph, pi) => {
      const next = plan.phrases[pi + 1];
      const show = Math.max(baseAppear(ph), prevGone);
      const last = words[ph.words[ph.words.length - 1]];
      // the last word must be whole and readable for a moment before the lockup goes
      const lastReady = Math.max(show, last.start - (LEAD[fxOf(last, ph)] ?? 0.1)) + (READY_AT[fxOf(last, ph)] ?? 0.4) + 0.2; // + letter stagger
      let minExit = Math.max(last.start + 0.35, lastReady + 0.3);
      let xs, xd, squeezed = false, fastLast = false;
      if (ph.exit === "mow" && next) {
        // the mowers follow the letters in, line by line; the next lockup waits for them
        const mow = mowPlan(phraseEls[pi], show);
        xs = mow.start;
        xd = mow.end + MOW_OFF - xs;
        SCHED.set(ph.id, { show, xs, xd, squeezed, fastLast });
        MOWS.set(ph.id, mow);
        prevGone = mow.end + MOW_OFF * 0.7;
        return;
      }
      if (!next) {
        xd = plan.cta ? 0.35 : 0.75;
        xs = Math.max(minExit, plan.cta ? plan.cta.start - 0.3 : plan.duration - 0.95);
      } else {
        const nextAt = baseAppear(next);
        // fast speech leaves a quick exit; a real pause before the next lockup lets it be seen
        xd = clamp((nextAt - ph.end) * 0.8 + 0.18, 0.2, nextAt - ph.end > 0.9 ? 0.5 : 0.36);
        // burning and falling need a moment; without the time for it the phrase fades (below)
        if (ph.exit === "burn" || ph.exit === "fall") xd = Math.max(xd, 0.65);
        // a short gap is no pause worth showing: an empty frame for a few tenths reads as a flicker
        xs = (nextAt - ph.tOut < 0.8 ? nextAt + 0.02 : ph.tOut) - xd;
        if (xs < minExit) {
          // no time for the word's own effect: it snaps in (~0.15 s) and stays until the next
          // lockup arrives – which waits up to 0.3 s for it, so the word gets ~0.45 s to be read
          fastLast = true;
          xd = 0.14;
          xs = Math.max(last.start + 0.4, nextAt - xd, Math.min(last.start + 0.55, nextAt + 0.3 - xd));
          squeezed = true;
        }
        xs = Math.max(show + 0.3, xs);
      }
      SCHED.set(ph.id, { show, xs, xd, squeezed, fastLast });
      prevGone = xs + xd * 0.7; // mostly faded is enough – blur hides the rest
    });
  }
  const appearAt = (ph) => SCHED.get(ph.id).show;

  // QA: when each word is fully drawn (approx. per effect), and the phrase schedule
  const READY = READY_AT;
  const QA = { words: [] };
  function enterWord(we, ph) {
    const { w, wd, chars } = we;
    const r = rng(w.i + 1);
    // a squeezed lockup's last word skips its effect and snaps in, so it can still be read
    const fx = SCHED.get(ph.id)?.fastLast && w.i === ph.words[ph.words.length - 1] ? "snap" : fxOf(w, ph);
    const T = Math.max(appearAt(ph), w.start - (LEAD[fx] ?? 0.1));
    const D = clamp(w.end - w.start, 0.28, 0.75);
    // GSAP can't interpolate CSS variables: tween between resolved palette colours
    const pal = PALETTES[ph.mood] || PALETTES.night;
    const C = { accent: (ph.speaker != null && speakerColor[ph.speaker]) || pal[2], glow: pal[3], ink: pal[4], deep: pal[0] };
    // letter stagger: long words must still be whole within ~0.25 s, or fast speech moves on first
    const st = Math.min(0.035, D * 0.6 / Math.max(1, chars.length), 0.22 / Math.max(1, chars.length));
    const shuffled = chars.map((c) => [r(), c]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    // effects that reveal letter by letter are whole only after the stagger
    // typing and decoding: one letter after another at their own pace (see the cases below)
    const typeStep = clamp((w.end - w.start) * 0.8 / Math.max(1, chars.length), 0.035, 0.075);
    const perLetter = ["mask", "whisper", "drop", "flicker", "sparkle", "wave", "spin", "bounce"].includes(fx) ? st * (fx === "bounce" ? 1.4 : 1) * Math.max(0, chars.length - 1)
      : fx === "type" ? typeStep * Math.max(0, chars.length - 1) : fx === "scramble" ? 0.05 * Math.max(0, chars.length - 1) : 0;
    QA.words.push({ i: w.i, phrase: ph.id, fx, ready: +(T + (READY[fx] ?? 0.4) + perLetter).toFixed(3), exit: ph.exitAt });
    we.T = T;

    // active-word colour: content words flash the accent while spoken, the hero keeps it
    // (kept on the word, so a copy of its letters can follow, as the mow exit's pieces do)
    const tint = (from, to, at) => { tl.fromTo(wd, from, to, at); (we.tints ||= []).push([from, to, at]); };
    if (we.marker) {
      // marker sweep behind the word as it is spoken; the word turns dark on it
      tl.fromTo(we.marker, { scaleX: 0 }, { scaleX: 1, duration: 0.32, ease: "power3.out" }, Math.max(T, w.start - 0.04));
      tint({ color: C.ink }, { color: C.deep, duration: 0.2, ease: "power1.out" }, Math.max(T, w.start + 0.04));
    } else if (w.role !== "fn" && !ph.calm) {
      // (a calm phrase sits over a graphic with words of its own: no word of it lights up)
      if (w.hero) tint({ color: C.glow }, { color: C.accent, duration: 0.6, ease: "power2.out" }, T);
      else tint({ color: C.accent }, { color: C.ink, duration: 0.7, ease: "power1.inOut" }, w.end + 0.05);
    }

    // marked words: effects act on the letters, the marker stays a clean shape
    const tgt = we.marker ? we.mk : wd;
    switch (fx) {
      case "soft":
        tl.fromTo(tgt, { opacity: 0, y: "0.25em", filter: "blur(10px)" }, { opacity: 0.82, y: 0, filter: "blur(0px)", duration: 0.45, ease: "power3.out" }, T);
        break;
      case "rise":
        // balloons let go: every letter floats up from below at its own pace, swaying, and the
        // word keeps drifting a little higher (marked words hold still, or they leave the marker)
        chars.forEach((c) => {
          const at = T + r() * 0.3, dur = 0.85 + r() * 0.3, sway = (r() - 0.5) * 0.24;
          tl.fromTo(c, { y: `${(1.1 + r() * 0.7).toFixed(2)}em`, opacity: 0 }, { y: 0, opacity: 1, duration: dur, ease: "sine.out" }, at);
          tl.fromTo(c, { x: `${sway.toFixed(3)}em`, rotation: (r() - 0.5) * 24 }, { x: 0, rotation: 0, duration: dur, ease: "back.out(1.6)" }, at);
        });
        if (!we.marker) tl.fromTo(tgt, { y: 0 }, { y: "-0.22em", duration: Math.max(0.6, ph.tOut - T), ease: "sine.inOut" }, T);
        break;
      case "drop":
        tl.fromTo(shuffled, { y: () => -(0.6 + r() * 0.8) * we.size, rotation: () => (r() - 0.5) * 40, opacity: 0 },
          { y: 0, rotation: 0, opacity: 1, duration: 0.6, ease: "bounce.out", stagger: st }, T);
        break;
      case "flicker": {
        // firelight: the letters catch from the bottom like flames, then keep licking and
        // glowing warm while the word is up
        const hold = Math.max(T + 1, ph.exitAt ?? ph.tOut);
        tl.fromTo(chars, { scaleY: 0, opacity: 0, transformOrigin: "50% 100%" }, { scaleY: 1, opacity: 1, duration: 0.45, ease: "back.out(2.2)", stagger: st }, T);
        chars.forEach((c, ci) => {
          for (let t = T + 0.4 + ci * st; t < hold; t += 0.09 + r() * 0.09) {
            tl.to(c, { scaleY: 0.93 + r() * 0.14, skewX: (r() - 0.5) * 7, opacity: 0.72 + r() * 0.28, duration: 0.09, ease: "sine.inOut" }, t);
          }
        });
        tl.fromTo(tgt, { textShadow: "0 0 0.05em rgba(255,150,50,1), 0 0 0.7em rgba(255,90,20,0.95)" },
          { textShadow: "0 -0.04em 0.05em rgba(255,150,50,0.75), 0 -0.1em 0.4em rgba(255,90,20,0.55)", duration: 1.2, ease: "power2.out" }, T);
        break;
      }
      case "glow":
        tl.fromTo(tgt, { opacity: 0, filter: "blur(6px) brightness(2.2)" }, { opacity: 1, filter: "blur(0px) brightness(2.2)", duration: 0.16, ease: "power2.out" }, T);
        tl.to(tgt, { filter: "blur(0px) brightness(1)", duration: 0.9, ease: "power2.out" }, T + 0.16);
        tl.fromTo(tgt, { scale: 1.18 }, { scale: 1, duration: 0.7, ease: "expo.out" }, T);
        tl.fromTo(tgt, { textShadow: `0 0 0.6em ${C.glow}` }, { textShadow: `0 0 0.22em ${C.accent}`, duration: 1.4, ease: "power2.out" }, T);
        break;
      case "sparkle": {
        tl.fromTo(shuffled, { opacity: 0, scale: 0.2 }, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(3)", stagger: st }, T);
        for (let k = 0; k < 4; k++) {
          const sp = el("i", "ky-spark", wd); // pure shape, not text
          sp.style.left = `${(8 + r() * 84).toFixed(1)}%`;
          sp.style.top = `${(r() > 0.5 ? -12 - r() * 18 : 92 + r() * 14).toFixed(1)}%`;
          sp.style.fontSize = `${(0.12 + r() * 0.12).toFixed(3)}em`;
          const at = T + 0.1 + k * 0.11;
          tl.fromTo(sp, { scale: 0, rotation: -90, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: 0.35, ease: "back.out(2.5)" }, at);
          tl.to(sp, { scale: 0, opacity: 0, rotation: 90, duration: 0.5, ease: "power2.in" }, at + 0.55 + r() * 0.4);
        }
        break;
      }
      case "fog": {
        // letters loom out of a fog bank one by one, grey before they are whole, while a veil
        // of mist drifts across the word and thins out
        const veil = el("i", "ky-fogveil", wd);
        tl.fromTo(veil, { xPercent: -30, opacity: 0 }, { xPercent: 22, opacity: 0.75, duration: 1.1, ease: "sine.inOut" }, T);
        tl.to(veil, { xPercent: 45, opacity: 0, duration: 1.3, ease: "sine.in" }, T + 1.1);
        shuffled.forEach((c, k) => {
          const at = T + (k / Math.max(1, chars.length - 1)) * 0.45 + r() * 0.15;
          tl.fromTo(c, { opacity: 0, filter: "blur(14px) saturate(0)", scale: 1.12 },
            { opacity: 1, filter: "blur(0px) saturate(1)", scale: 1, duration: 0.7 + r() * 0.3, ease: "power1.out" }, at);
        });
        break;
      }
      case "whisper":
        // small and hushed: the letters are breathed in one after another, no glow, kept airy
        tl.set(tgt, { textShadow: "none", letterSpacing: "0.12em" }, T);
        tl.fromTo(chars, { opacity: 0, y: "0.18em" }, { opacity: 0.78, y: 0, duration: 0.5, ease: "sine.out", stagger: st * 1.6 }, T);
        break;
      case "slam":
        tl.fromTo(tgt, { scale: 2.6, opacity: 0, filter: "blur(10px)" }, { scale: 1, opacity: 1, filter: "blur(0px)", duration: 0.32, ease: "power4.out" }, T);
        shake(phraseEls.find((p) => p.ph.id === ph.id).lk, T + 0.26, 0.35, we.size * 0.03, r);
        break;
      case "glitch": {
        tl.fromTo(tgt, { opacity: 0 }, { opacity: 1, duration: 0.05 }, T);
        tl.fromTo(tgt, { textShadow: "-0.08em 0 #ff2a6d, 0.08em 0 #2af0ff" }, { textShadow: "0em 0 #ff2a6d, 0em 0 #2af0ff", duration: 0.55, ease: "steps(8)" }, T);
        for (let k = 0; k < 8; k++) tl.set(tgt, { x: k === 7 ? 0 : (r() - 0.5) * we.size * 0.18, skewX: k === 7 ? 0 : (r() - 0.5) * 20 }, T + k * 0.05);
        tl.fromTo(shuffled, { opacity: 0 }, { opacity: 1, duration: 0.01, stagger: 0.03 }, T);
        break;
      }
      case "wave": {
        // the letters roll in on a crest, then a wave keeps running through the word
        tl.fromTo(chars, { yPercent: 115, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.6, ease: E.out, stagger: st * 1.6 }, T);
        const hold = (ph.exitAt ?? ph.tOut) - 0.3;
        for (let t0 = T + 0.45; t0 + chars.length * 0.07 < hold; t0 += 1.1) {
          chars.forEach((c, ci) => {
            const at = t0 + ci * 0.07;
            tl.to(c, { y: "-0.2em", rotation: -6, duration: 0.2, ease: "sine.out" }, at);
            tl.to(c, { y: 0, rotation: 0, duration: 0.26, ease: "sine.in" }, at + 0.2);
          });
        }
        break;
      }
      case "spin":
        tl.fromTo(chars, { rotationY: -100, opacity: 0, transformOrigin: "50% 50% -0.3em" },
          { rotationY: 0, opacity: 1, duration: 0.6, ease: "back.out(1.6)", stagger: st }, T);
        if (w.hero) tl.fromTo(tgt, { rotationX: 0 }, { rotationX: 360, duration: 0.9, ease: "power3.inOut" }, T + D + 0.15);
        break;
      case "pulse":
        tl.fromTo(tgt, { scale: 0.55, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(2.2)" }, T);
        [[0.06, 0.1], [0.1, 0.05]].forEach(([amp, at], k) => { // a heartbeat, not a jump: big hero words would leave the frame
          const t0 = T + 0.45 + k * 0.3;
          tl.to(tgt, { scale: 1 + amp, duration: 0.09, ease: "power2.out" }, t0);
          tl.to(tgt, { scale: 1, duration: 0.22, ease: "power2.in" }, t0 + 0.09);
        });
        break;
      case "shatter": {
        tl.fromTo(tgt, { scale: 1.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.22, ease: "power4.out" }, T);
        const tb = w.start + Math.min(0.35, (w.end - w.start) * 0.6);
        tl.to(chars, {
          x: () => (r() - 0.5) * we.size * 2.2, y: () => (r() - 0.3) * we.size * 1.4, rotation: () => (r() - 0.5) * 140,
          opacity: 0, filter: "blur(4px)", duration: 1.4, ease: "expo.out", stagger: 0.008,
        }, tb + 0.12);
        tl.fromTo(tgt, { textShadow: `0 0 0.4em ${C.accent}` }, { textShadow: `0 0 0em ${C.accent}`, duration: 0.6 }, tb);
        shake(phraseEls.find((p) => p.ph.id === ph.id).lk, tb, 0.3, we.size * 0.04, r);
        break;
      }
      case "flash": {
        // neon switching on: every tube stutters into life at its own moment, glowing hard;
        // a while later one letter buzzes off and on again
        tl.fromTo(tgt, { textShadow: `0 0 0.04em #fff, 0 0 0.2em ${C.accent}, 0 0 0.6em ${C.accent}` },
          { textShadow: `0 0 0.02em #fff, 0 0 0.14em ${C.accent}, 0 0 0.4em ${C.accent}`, duration: 1.2, ease: "power1.out" }, T + 0.3);
        shuffled.forEach((c) => {
          tl.fromTo(c, { opacity: 0 }, { opacity: 0.1, duration: 0.01 }, T);
          let at = T + r() * 0.3;
          for (const o of [1, 0.15, 1, 0.35, 1]) { tl.set(c, { opacity: o }, at); at += 0.03 + r() * 0.04; }
        });
        const tb = T + 1.05;
        if (tb < (ph.exitAt ?? Infinity) - 0.35) {
          const c = chars[Math.floor(r() * chars.length)];
          [0.15, 1, 0.3, 1].forEach((o, j) => tl.set(c, { opacity: o }, tb + j * 0.05));
        }
        break;
      }
      case "streak":
        tl.fromTo(tgt, { x: -W * 0.4, skewX: -28, opacity: 0, filter: "blur(16px)" }, { x: 0, skewX: 0, opacity: 1, filter: "blur(0px)", duration: 0.5, ease: "expo.out" }, T);
        break;
      case "depth":
        // rises from far below the horizon, lying flat, and stands up as it arrives
        // (its own perspective: the stage's does not reach through the lockup's nesting)
        tl.fromTo(tgt, { z: -we.size * 22, y: "0.8em", rotationX: 72, opacity: 0, filter: "blur(6px)", transformPerspective: we.size * 8 },
          { z: 0, y: 0, rotationX: 0, opacity: 1, filter: "blur(0px)", duration: 0.9, ease: "power2.out" }, T);
        break;
      case "blur":
        tl.fromTo(tgt, { opacity: 0, scale: 1.12, filter: "blur(18px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.55, ease: "power3.out" }, T);
        break;
      case "count": {
        // number counts up from 0 while it is spoken, then lands with a small punch
        const n = w.num;
        tl.fromTo(chars, { yPercent: 115, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.45, ease: E.out }, T);
        if (n) {
          // the final value must land (and be readable) before the phrase leaves
          const dur = Math.max(0.3, Math.min(clamp(w.end - w.start + 0.25, 0.5, 1.1), (ph.exitAt ?? Infinity) - T - 0.25));
          const fmt = (v) => {
            let s = v.toFixed(n.decimals);
            if (n.grouped) s = String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, n.sep || ",");
            else if (n.sep === ",") s = s.replace(".", ",");
            return `${n.prefix}${s}${n.suffix}`.toUpperCase();
          };
          const steps = Math.max(6, Math.round(dur * 30));
          for (let k = 0; k <= steps; k++) {
            const p = 1 - Math.pow(1 - k / steps, 3);
            // GSAP tweens numeric-looking strings as numbers ("258.000" → 258): a zero-width
            // space keeps every step a plain string that is set verbatim
            tl.set(chars[0], { textContent: (k === steps ? we.txt : fmt(n.value * p)) + "\u200B" }, T + (k / steps) * dur);
          }
          tl.fromTo(tgt, { scale: 1 }, { scale: 1.08, duration: 0.1, ease: "power2.out", yoyo: true, repeat: 1 }, T + dur);
        }
        break;
      }
      case "blink": {
        // an eye opening, then one deliberate blink while the word is held (eye, look, watch)
        tl.fromTo(tgt, { scaleY: 0.04, opacity: 0, transformOrigin: "50% 55%" }, { scaleY: 1, opacity: 1, duration: 0.22, ease: "power3.out" }, T);
        const tb = Math.min(T + 0.75, (ph.exitAt ?? Infinity) - 0.45);
        if (tb > T + 0.35) {
          tl.to(tgt, { scaleY: 0.06, duration: 0.07, ease: "power2.in" }, tb);
          tl.to(tgt, { scaleY: 1, duration: 0.14, ease: "power2.out" }, tb + 0.07);
        }
        break;
      }
      case "redact": {
        // declassified: a censor bar sweeps over the empty slot, the word appears under it,
        // the bar pulls away to the right (secret, lie, hidden, CIA)
        const bar = el("i", "ky-redact", wd);
        tl.fromTo(bar, { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: 0.16, ease: "power3.out" }, T);
        tl.fromTo(chars, { opacity: 0 }, { opacity: 1, duration: 0.01 }, T + 0.16);
        tl.to(bar, { scaleX: 0, transformOrigin: "100% 50%", duration: 0.24, ease: "power3.in" }, T + 0.16 + Math.min(0.14, D * 0.3));
        break;
      }
      case "bounce": {
        // the letters jump up from the line one after another and land with a squash; while
        // the word is up, now and then one hops again (animals, play, joy)
        chars.forEach((c, ci) => {
          const at = T + ci * st * 1.4;
          tl.fromTo(c, { y: 0, scale: 0.2, opacity: 0, transformOrigin: "50% 100%" }, { y: "-0.5em", scale: 1, opacity: 1, duration: 0.2, ease: "power2.out" }, at);
          tl.to(c, { y: 0, duration: 0.19, ease: "power2.in" }, at + 0.2);
          tl.fromTo(c, { scaleX: 1.2, scaleY: 0.75 }, { scaleX: 1, scaleY: 1, duration: 0.32, ease: "back.out(3)", immediateRender: false }, at + 0.39);
        });
        const hold = (ph.exitAt ?? ph.tOut) - 0.4;
        for (let t = T + 0.95; t < hold; t += 0.5 + r() * 0.35) {
          const c = chars[Math.floor(r() * chars.length)];
          tl.to(c, { y: "-0.24em", duration: 0.14, ease: "power2.out" }, t);
          tl.to(c, { y: 0, duration: 0.14, ease: "power2.in" }, t + 0.14);
        }
        break;
      }
      case "grow": {
        // grows from a seedling at the baseline to full size, overshoots a little, and keeps
        // growing slowly while it is up (growth, more, rising numbers)
        tl.fromTo(tgt, { scale: 0.08, opacity: 0, transformOrigin: "50% 100%" }, { scale: 1.1, opacity: 1, duration: 0.8, ease: "sine.inOut" }, T);
        tl.to(tgt, { scale: 1, duration: 0.3, ease: "sine.inOut" }, T + 0.8);
        tl.to(tgt, { scale: 1.08, duration: Math.max(0.6, (ph.exitAt ?? ph.tOut) - T - 1.1), ease: "sine.inOut" }, T + 1.1);
        break;
      }
      case "shrink": {
        // appears at full size, then deflates in two steps and dims a little (less, smaller, losing)
        tl.fromTo(tgt, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "power1.out" }, T);
        tl.fromTo(tgt, { scale: 1.12, transformOrigin: "50% 100%" }, { scale: 0.86, duration: 0.3, ease: "power2.in" }, T + 0.35);
        tl.to(tgt, { scale: 0.7, opacity: 0.8, duration: 0.4, ease: "power2.in" }, T + 0.85);
        break;
      }
      case "type": {
        // typed out letter by letter behind a blinking caret (writing, a message, an email, AI)
        const caret = el("i", "ky-caret", wd);
        tl.fromTo(caret, { opacity: 0 }, { opacity: 1, duration: 0.01 }, T - 0.12);
        chars.forEach((c, ci) => {
          const at = T + ci * typeStep;
          tl.fromTo(c, { opacity: 0 }, { opacity: 1, duration: 0.01 }, at);
          // the caret's place is read when the frame is drawn, after the fonts have loaded
          tl.set(caret, { x: () => c.offsetLeft + c.offsetWidth }, at);
        });
        const done = T + chars.length * typeStep;
        for (let k = 0; k < 6; k++) tl.set(caret, { opacity: k % 2 ? 1 : 0 }, done + 0.08 + k * 0.26);
        break;
      }
      case "scramble": {
        // random characters rattle through each letter until it locks, left to right
        // (code, a password, decoding, figuring something out)
        const GLYPHS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789#%&$?";
        chars.forEach((c, ci) => {
          const real = c.textContent;
          c.style.width = `${(measure(real, "gothic", 100) / 100).toFixed(3)}em`; // no jitter of the line
          c.style.textAlign = "center";
          tl.fromTo(c, { opacity: 0 }, { opacity: 1, duration: 0.01 }, T);
          const lock = T + 0.12 + ci * 0.05;
          for (let t = T; t < lock; t += 0.045) tl.set(c, { textContent: GLYPHS[Math.floor(r() * GLYPHS.length)] + "​" }, t);
          tl.set(c, { textContent: real }, lock);
          tl.fromTo(c, { textShadow: `0 0 0.35em ${C.glow}` }, { textShadow: `0 0 0em ${C.glow}`, duration: 0.35, ease: "power1.out", immediateRender: false }, lock);
        });
        break;
      }
      case "tremble": {
        // the letters keep trembling, each on its own, while the word is up (fear, nerves, panic, cold)
        tl.fromTo(tgt, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "power1.out" }, T);
        const hold = (ph.exitAt ?? ph.tOut) - 0.1;
        chars.forEach((c) => {
          for (let t = T + r() * 0.05; t < hold; t += 0.045 + r() * 0.03) {
            tl.to(c, { x: (r() - 0.5) * we.size * 0.06, y: (r() - 0.5) * we.size * 0.06, rotation: (r() - 0.5) * 7, duration: 0.04, ease: "none" }, t);
          }
        });
        break;
      }
      case "assemble": {
        // the letters fly in from all around and snap together, then the word gives a small
        // click (a team, together, building, connecting)
        shuffled.forEach((c, k) => {
          const at = T + k * 0.03;
          tl.fromTo(c, { x: (r() - 0.5) * we.size * 4, y: (r() - 0.5) * we.size * 2.4, rotation: (r() - 0.5) * 160, scale: 0.6, opacity: 0 },
            { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, duration: 0.55, ease: "power3.out" }, at);
        });
        const snap = T + 0.55 + chars.length * 0.03;
        tl.fromTo(tgt, { scale: 1 }, { scale: 1.06, duration: 0.08, ease: "power2.out", yoyo: true, repeat: 1 }, snap);
        break;
      }
      case "freeze": {
        // frost creeps over the word: the letters turn icy and stiff, crystals grow at the
        // edges, then a short crack as it freezes solid (cold, ice, frozen, standing still)
        tl.fromTo(tgt, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "power1.out" }, T);
        tl.to(chars, { color: "#dff4ff", textShadow: "0 0 0.25em rgba(150,215,255,0.9)", duration: 0.7, ease: "power1.in", stagger: 0.03 }, T + 0.15);
        for (let k = 0; k < 5; k++) {
          const ice = el("i", "ky-ice", wd);
          ice.style.left = `${(4 + k * 22 + r() * 8).toFixed(1)}%`;
          ice.style.top = `${(k % 2 ? -10 - r() * 14 : 84 + r() * 10).toFixed(1)}%`;
          ice.style.fontSize = `${(0.22 + r() * 0.14).toFixed(3)}em`;
          tl.fromTo(ice, { scale: 0, rotation: -45, opacity: 0 }, { scale: 1, rotation: 0, opacity: 0.95, duration: 0.5, ease: "power2.out" }, T + 0.3 + k * 0.08);
        }
        const crack = T + 0.95;
        if (crack < (ph.exitAt ?? Infinity) - 0.2) {
          tl.to(tgt, { x: we.size * 0.025, duration: 0.03, ease: "none" }, crack);
          tl.to(tgt, { x: -we.size * 0.02, duration: 0.03, ease: "none" }, crack + 0.03);
          tl.to(tgt, { x: 0, duration: 0.04, ease: "none" }, crack + 0.06);
          tl.fromTo(tgt, { filter: "brightness(1.6)" }, { filter: "brightness(1)", duration: 0.3, ease: "power2.out", immediateRender: false }, crack);
        }
        break;
      }
      case "echo": {
        // the word lands, then pale copies of it ring out and fade, again and again
        // (echo, again, over and over, repeating)
        tl.fromTo(tgt, { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.25, ease: "power2.out" }, T);
        const text = chars.map((c) => c.textContent).join("");
        for (let k = 0; k < 3; k++) {
          const copy = el("span", "ky-echo", wd);
          copy.textContent = text;
          const at = T + 0.3 + k * 0.28;
          tl.fromTo(copy, { opacity: 0.5, scale: 1, transformOrigin: "50% 55%" }, { opacity: 0, scale: 1.45 + k * 0.1, duration: 0.85, ease: "power2.out" }, at);
        }
        break;
      }
      case "window": {
        // the word is the window: it splits down the middle as the next word comes and both
        // halves swing open on their outer hinges, towards the viewer, light pouring through the gap
        const mid = Math.ceil(chars.length / 2);
        const halves = [el("span", "ky-half", we.mk), el("span", "ky-half", we.mk)];
        chars.forEach((c, ci) => halves[ci < mid ? 0 : 1].append(c));
        wd.style.margin = "0 .12em"; // the near edges grow as they swing out
        const gap = el("i", "ky-gap", wd);
        const open = Math.max(T + 0.45, w.end - 0.04);
        tl.fromTo(tgt, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2)" }, T);
        halves.forEach((h, k) => {
          const dir = k ? 1 : -1, at = open + k * 0.03;
          const hinge = { rotationY: 0, transformOrigin: k ? "100% 50%" : "0% 50%", transformPerspective: we.size * 6 };
          tl.fromTo(h, hinge, { rotationY: dir * 68, duration: 0.42, ease: "power3.out" }, at);
          tl.to(h, { rotationY: dir * 50, duration: 0.5, ease: "back.out(2)" }, at + 0.42);
        });
        tl.fromTo(gap, { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 0.35, ease: "power2.out" }, open);
        tl.to(gap, { opacity: 0.35, duration: 0.9, ease: "power1.inOut" }, open + 0.35);
        tl.fromTo(tgt, { textShadow: `0 0 0.6em ${C.glow}` }, { textShadow: `0 0 0.22em ${C.accent}`, duration: 0.9, ease: "power2.out" }, open + 0.05);
        if (ph.exitAt != null) tl.to(gap, { opacity: 0, duration: 0.2, ease: "power1.in" }, ph.exitAt);
        break;
      }
      case "snap":
        tl.fromTo(chars, { yPercent: 40, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.14, ease: "power2.out" }, T);
        break;
      case "mask":
      default:
        tl.fromTo(chars, { yPercent: 115, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.6, ease: E.out, stagger: st }, T);
        break;
    }
    // checklist: the box pops in with the item, the tick lands as the item is finished
    if (we.check) {
      tl.fromTo(we.check.el, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: "back.out(2.2)" }, T - 0.04);
      const tAt = Math.min(Math.max(T + 0.12, we.check.endAt - 0.06), (ph.exitAt ?? Infinity) - 0.4);
      tl.fromTo(we.check.tick, { attr: { "stroke-dashoffset": 1 } }, { attr: { "stroke-dashoffset": 0 }, duration: 0.26, ease: "power2.out" }, tAt);
    }
    // hand-drawn notes: circle/underline while the word is spoken, strike once it has been said
    if (we.note) {
      const strike = we.note.kind === "strike";
      const dur = strike ? 0.3 : we.note.kind === "circle" ? 0.55 : 0.45;
      let at = strike ? Math.max(T + 0.18, w.end - 0.1) : Math.max(T + 0.06, w.start + 0.04);
      at = Math.max(T, Math.min(at, (ph.exitAt ?? Infinity) - dur - 0.25));
      tl.fromTo(we.note.paths, { attr: { "stroke-dashoffset": 1 } }, { attr: { "stroke-dashoffset": 0 }, duration: dur, ease: "power2.inOut", stagger: dur * 0.7 }, at);
      if (strike) tl.to(tgt, { opacity: 0.45, duration: 0.3, ease: "power1.out" }, at + 0.12);
    }
    // repeated word grows ("higher, higher")
    if (w.repeat) tl.fromTo(wd, { scale: 0.9 }, { scale: 1.06, duration: 1.2, ease: "power2.out" }, T);
  }

  function shake(target, at, dur, amp, r) {
    const n = Math.round(dur / 0.04);
    for (let k = 0; k <= n; k++) {
      const f = 1 - k / n;
      tl.set(target, { x: k === n ? 0 : (r() - 0.5) * 2 * amp * f, y: k === n ? 0 : (r() - 0.5) * 2 * amp * f }, at + k * 0.04);
    }
  }

  function animateViz(vz, ph, tShow, xs) {
    const w = words[ph.viz];
    const Tw = Math.max(tShow, w.start - 0.1);
    const end = xs - 0.25; // everything has landed before the phrase leaves
    tl.fromTo(vz.el, { opacity: 0, y: vz.vh * 0.18 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, Math.max(tShow, Tw - 0.3));
    if (vz.kind === "gauge") {
      const dur = Math.max(0.3, Math.min(clamp(w.end - w.start + 0.25, 0.5, 1.1), end - Tw));
      tl.fromTo(vz.clip, { attr: { width: 0 } }, { attr: { width: vz.full }, duration: dur, ease: "power2.out" }, Tw);
    } else if (vz.kind === "compare") {
      tl.fromTo(vz.bar0, { attr: { width: 0 } }, { attr: { width: vz.b1 }, duration: 0.45, ease: "power3.out" }, Math.max(tShow, Tw - 0.3));
      tl.fromTo(vz.bar1, { attr: { width: 0 } }, { attr: { width: vz.b1 }, duration: 0.4, ease: "power3.out" }, Math.max(tShow, Tw - 0.2));
      const t2 = Math.max(Tw + 0.1, tShow + 0.3);
      tl.to(vz.bar1, { attr: { width: vz.b2 }, duration: Math.max(0.3, Math.min(0.8, end - t2)), ease: "expo.out" }, t2);
      tl.fromTo(vz.hi, { opacity: 0.3 }, { opacity: 1, duration: 0.3 }, t2);
      tl.to(vz.ghost, { opacity: 0, duration: 0.3 }, t2 + 0.2);
    } else if (vz.kind === "growth") {
      // the curve draws itself while the number is spoken, the end value lands with the dot
      const dur = Math.max(0.6, Math.min(2, end - Tw - 0.35));
      tl.fromTo(vz.curve, { attr: { "stroke-dashoffset": 1 } }, { attr: { "stroke-dashoffset": 0 }, duration: dur, ease: "sine.inOut" }, Tw);
      tl.fromTo(vz.clip, { attr: { width: 0 } }, { attr: { width: vz.full }, duration: dur, ease: "sine.inOut" }, Tw);
      tl.fromTo(vz.dot, { scale: 0, transformOrigin: "50% 50%" }, { scale: 1, duration: 0.3, ease: "back.out(3)" }, Tw + dur - 0.08);
      tl.fromTo(vz.ends, { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.35, ease: "power2.out", stagger: 0.1 }, Tw + dur - 0.1);
    } else if (vz.kind === "split") {
      vz.segs.forEach((sg, j) => tl.fromTo(sg, { attr: { width: 0 } }, { attr: { width: +sg.getAttribute("data-w") }, duration: 0.5, ease: "power3.out" }, Tw + j * 0.2));
      tl.fromTo(vz.lbls, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out", stagger: 0.08 }, Tw + 0.15);
    } else if (vz.g) {
      G.animate(tl, vz.g, Tw, end);
    } else {
      const n = vz.units.length;
      const total = Math.max(0.3, Math.min(clamp(0.04 * n + 0.3, 0.4, 1.2), end - Tw));
      tl.fromTo(vz.units, { scale: 0, opacity: 0, transformOrigin: "50% 50%" },
        { scale: 1, opacity: 1, duration: 0.3, ease: "back.out(2)", stagger: n > 1 ? Math.max(0, total - 0.3) / (n - 1) : 0 }, Tw);
    }
  }

  // A push mower drives along each line as planned (mowPlan): every letter it passes is cut
  // off just above the baseline, the stubble stays, and the cut-off part is thrown out behind it.
  function mowExit(lk, mow, r) {
    mow.rows.forEach((row) => {
      const { mh, mw, blade, path, end } = row;
      const mower = el("div", "ky-mower", lk);
      Object.assign(mower.style, { width: px(mw), height: px(mh), top: px(row.lawn - mh * 0.96) });
      mower.innerHTML = MOWER_SVG;
      const t0 = path[0].t;
      // a letter is cut when the blade reaches its middle
      const bladeAt = (x) => {
        for (let k = 1; k < path.length; k++) {
          const a = path[k - 1], b = path[k];
          if (x <= b.x) return a.t + ((x - a.x) / (b.x - a.x)) * (b.t - a.t);
        }
        return end;
      };
      tl.set(mower, { x: row.x0 }, t0);
      path.slice(1).forEach((p, k) => tl.to(mower, { x: p.x - blade, duration: p.t - path[k].t, ease: "none" }, path[k].t));
      const last = path[path.length - 1], before = path[path.length - 2] || path[0];
      const v = (last.x - before.x) / Math.max(0.05, last.t - before.t);
      tl.to(mower, { x: last.x - blade + v * MOW_OFF, duration: MOW_OFF, ease: "none" }, end);
      tl.fromTo(mower, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.12, ease: "power1.out" }, t0);
      tl.to(mower, { autoAlpha: 0, duration: 0.14, ease: "power1.in" }, end + MOW_OFF - 0.14);
      const dur = end + MOW_OFF - t0;
      const body = mower.querySelector(".mw-body"), wheels = mower.querySelectorAll(".mw-wheel");
      const hops = Math.max(1, Math.round(dur / 0.08));
      tl.fromTo(body, { y: 0 }, { y: -mh * 0.03, duration: dur / hops / 2, ease: "sine.inOut", yoyo: true, repeat: hops * 2 - 1 }, t0);
      tl.fromTo(wheels, { rotation: 0 }, { rotation: 900 * dur, transformOrigin: "50% 50%", duration: dur, ease: "none" }, t0);
      row.wes.forEach((we) => we.chars.forEach((ch) => {
        const at = offsetIn(ch, lk);
        const t = bladeAt(at.x + ch.offsetWidth / 2);
        const c = ch.textContent;
        if (!c.trim() || ch.classList.contains("ky-num")) { tl.to(ch, { opacity: 0, duration: 0.08 }, t); return; }
        // at the cut the letter gives way to two copies of it beside it: the stubble below the
        // cut stays, the top above it flies off (copies in boxes that hide the rest: a clip-path
        // on the letter, or a turning child in it, leaves dark corners in Chrome's layers)
        const h = ch.offsetHeight * STUB / 100;
        const copy = (cls, top, height, shift) => {
          const box = el("div", `${we.wd.className.replace(/\bky-w\b/, "")} ky-piece ${cls}`, lk);
          Object.assign(box.style, { fontSize: px(we.size), left: `calc(${px(at.x)} - .3em)`, top, width: `calc(${px(ch.offsetWidth)} + .6em)`, height });
          const sp = el("span", null, box);
          sp.textContent = c;
          sp.style.top = shift;
          (we.tints || []).forEach(([from, to, at0]) => tl.fromTo(box, from, to, at0));
          tl.set(box, { autoAlpha: 1 }, t);
          return box;
        };
        copy("ky-stub", px(at.y + h), `calc(${px(ch.offsetHeight - h)} + .3em)`, px(-h));
        const hi = copy("ky-top", `calc(${px(at.y)} - .3em)`, `calc(${px(h)} + .3em)`, ".3em");
        tl.set(ch, { autoAlpha: 0 }, t);
        const s = we.size, fly = 0.5 + r() * 0.25;
        tl.to(hi, { x: -s * (0.25 + r() * 0.55), rotation: -(15 + r() * 65), duration: fly, ease: "power1.out" }, t);
        tl.to(hi, { y: -s * (0.12 + r() * 0.25), duration: fly * 0.35, ease: "power2.out" }, t);
        tl.to(hi, { y: s * 0.45, duration: fly * 0.65, ease: "power2.in" }, t + fly * 0.35);
        tl.to(hi, { autoAlpha: 0, duration: 0.18 }, t + Math.min(fly * 0.4, Math.max(0, end + MOW_OFF - 0.2 - t)));
      }));
    });
  }

  phraseEls.forEach(({ ph: phrase, box, lk, wordEls, viz, halo, qmark }, pi) => {
    let ph = phrase;
    const r = rng(1000 + pi);
    const next = plan.phrases[pi + 1];
    const life = ph.tOut - ph.tIn;
    // box visibility window
    const tShow = appearAt(ph);
    tl.set(box, { autoAlpha: 1 }, tShow);
    tl.fromTo(halo, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: "power1.out" }, tShow);
    if (qmark) tl.fromTo(qmark, { opacity: 0, scale: 0.4, rotation: -12 }, { opacity: 1, scale: 1, rotation: 0, duration: 0.5, ease: "back.out(2)" }, tShow);
    // the lockup lives in a slow 3D drift: push in, slight turn, tilt
    const ascend = ph.concepts.includes("rise") || ph.concepts.includes("sky");
    tl.fromTo(lk,
      { scale: 1 - 0.06 * drift, rotation: ph.tilt * 0.4, rotationY: (r() - 0.5) * 10 * drift, y: ascend ? H * 0.04 * drift : 0 },
      { scale: 1 + 0.04 * drift, rotation: ph.tilt, rotationY: (r() - 0.5) * 6 * drift, y: ascend ? -H * 0.05 * drift : 0, duration: life + 0.4, ease: "sine.inOut" }, tShow);
    // exit timing comes from the schedule above; squeezed exits fade in place
    const { xs, xd, squeezed } = SCHED.get(ph.id);
    if (squeezed) ph = { ...ph, exit: "fade" };
    if (!next) ph = { ...ph, exit: "blur" };
    wordEls.forEach((we) => enterWord(we, { ...phrase, exitAt: xs }));
    if (viz) {
      animateViz(viz, phrase, tShow, xs);
      // exits that only move letters take the graphic out with them
      if (["lift", "scatter", "mow", "burn", "fall"].includes(ph.exit)) tl.to(viz.el, { opacity: 0, y: -viz.vh * 0.2, duration: xd, ease: E.in }, xs);
    }
    const allChars = wordEls.flatMap((we) => we.chars);
    switch (ph.exit) {
      case "fade":
        tl.to(lk, { opacity: 0, filter: "blur(8px)", duration: xd, ease: "power1.in" }, xs);
        break;
      case "zoom":
        tl.to(lk, { scale: 1.9, opacity: 0, filter: "blur(16px)", duration: xd + 0.1, ease: E.in }, xs);
        break;
      case "blur":
        tl.to(lk, { opacity: 0, filter: "blur(24px)", letterSpacing: "0.2em", duration: xd, ease: E.in }, xs);
        break;
      case "scatter":
        tl.to(wordEls.map((we) => we.wd), {
          x: () => (r() - 0.5) * W * 0.25, y: () => (r() - 0.5) * H * 0.2, opacity: 0, filter: "blur(10px)", duration: xd + 0.1, ease: E.in, stagger: 0.015,
        }, xs);
        break;
      case "mow":
        mowExit(lk, MOWS.get(ph.id), r);
        break;
      case "burn": {
        // a fuse runs through the letters left to right: each glows hot, chars to black and
        // crumbles to ash rising away, embers drift up
        const n = allChars.length, run = xd * 0.45, each = xd - run;
        allChars.forEach((c, k) => {
          const at = xs + (k / Math.max(1, n - 1)) * run;
          tl.to(c, { color: "#ffcf7a", textShadow: "0 0 0.25em #ff7a1a, 0 -0.12em 0.5em #ff3d00", duration: each * 0.35, ease: "power1.in" }, at);
          tl.to(c, { color: "#2a140a", textShadow: "0 -0.1em 0.3em rgba(255,80,0,0.4)", duration: each * 0.25, ease: "none" }, at + each * 0.35);
          tl.to(c, { opacity: 0, y: "-0.5em", scale: 0.7, filter: "blur(3px)", duration: each * 0.4, ease: "power1.in" }, at + each * 0.6);
        });
        wordEls.forEach((we) => {
          for (let k = 0; k < 4; k++) {
            const ember = el("i", "ky-ember", we.wd);
            ember.style.left = `${(10 + r() * 80).toFixed(1)}%`;
            ember.style.fontSize = `${(0.06 + r() * 0.06).toFixed(3)}em`;
            const at = xs + r() * run;
            tl.fromTo(ember, { opacity: 0, y: 0, x: 0 }, { opacity: 1, duration: 0.08, immediateRender: false }, at);
            tl.to(ember, { y: -we.size * (0.8 + r() * 0.8), x: (r() - 0.5) * we.size * 0.4, opacity: 0, duration: xd * 0.9, ease: "power1.out" }, at + 0.08);
          }
        });
        break;
      }
      case "fall": {
        // gravity takes over: the letters drop away one by one, tumbling, out of the frame
        allChars.forEach((c) => {
          const at = xs + r() * xd * 0.4;
          tl.to(c, { y: H * (0.35 + r() * 0.2), rotation: (r() - 0.5) * 90, duration: xd * 0.6, ease: "power2.in" }, at);
          tl.to(c, { opacity: 0, duration: xd * 0.25, ease: "power1.in" }, at + xd * 0.35);
        });
        break;
      }
      case "lift":
      default:
        tl.to(allChars, { yPercent: -110, opacity: 0, duration: xd, ease: "power3.in", stagger: Math.min(0.012, 0.2 / allChars.length) }, xs);
        tl.to(lk, { filter: "blur(6px)", duration: xd, ease: E.in }, xs + 0.1);
        break;
    }
    // the halo goes with the lockup; under the mowers it stays until the last line is cut
    const hd = ph.exit === "mow" ? Math.min(xd, 0.4) : xd;
    tl.to(halo, { opacity: 0, duration: hd, ease: "power1.in" }, xs + xd - hd);
    tl.set(box, { autoAlpha: 0 }, xs + xd + 0.04);
  });

  QA.phrases = plan.phrases.map((ph) => ({ id: ph.id, ...SCHED.get(ph.id) }));
  return { timeline: tl, signals: S, qa: QA };
}

export const CSS = /* css */ `
  .ky-stage { position:absolute; inset:0; perspective: 1600px; perspective-origin: 50% 46%; overflow:hidden; }
  .ky-scrim { position:absolute; inset:0; background: radial-gradient(ellipse 55% 48% at var(--scx, 50%) var(--scy, 50%), rgba(0,0,0,.5), rgba(0,0,0,.12) 60%, rgba(0,0,0,0) 80%); }
  .ky-ph { position:absolute; inset: var(--sy0, 0) var(--sx1, 0) var(--sy1, 0) var(--sx0, 0); display:flex; align-items:center; justify-content:center; visibility:hidden; opacity:0;
    transform-style: preserve-3d; color: var(--ink); filter: drop-shadow(0 .04em .5em rgba(0,0,0,.55)); }
  .ky-lk { position:relative; display:flex; flex-direction:column; align-items:stretch; gap: 1.2vh; transform-style: preserve-3d;
    margin-left: calc(var(--dx, 0px) * 2); will-change: transform, filter; }
  .ky-ln { display:flex; align-items:baseline; justify-content:center; gap: .2em; white-space:nowrap; line-height:${LH}; transform-style: preserve-3d; }
  .ky-ln.ky-left { justify-content:flex-start; } .ky-ln.ky-right { justify-content:flex-end; }
  .ky-w { position:relative; display:inline-block; transform-style: preserve-3d; will-change: transform, opacity; }
  .ky-mk { display:inline-block; clip-path: inset(-1.5em -1.5em 0 -1.5em); padding: .06em .05em .05em; margin: -.06em -.05em -.05em; }
  .ky-ch { display:inline-block; will-change: transform, opacity; backface-visibility: hidden; }
  .ky-ice { position:absolute; width:1em; height:1em; display:block; pointer-events:none; opacity:0; background: #e8f7ff;
    clip-path: polygon(50% 0, 56% 38%, 93% 25%, 62% 50%, 93% 75%, 56% 62%, 50% 100%, 44% 62%, 7% 75%, 38% 50%, 7% 25%, 44% 38%);
    filter: drop-shadow(0 0 .25em rgba(150,215,255,.9)); }
  .ky-echo { position:absolute; left:0; right:0; top:.06em; text-align:center; white-space:pre; pointer-events:none; opacity:0; }
  .ky-ember { position:absolute; top:40%; width:1em; height:1em; border-radius:50%; display:block; pointer-events:none; opacity:0;
    background: #ffb347; box-shadow: 0 0 .6em .2em rgba(255,110,20,.8); }
  .ky-caret { position:absolute; left:0; top:.08em; bottom:.06em; width:.06em; display:block; pointer-events:none; opacity:0;
    background: var(--accent); border-radius:.02em; }
  .ky-half { display:inline-block; transform-style: preserve-3d; }
  .ky-gap { position:absolute; left:36%; right:36%; top:-.22em; bottom:-.22em; display:block; pointer-events:none; z-index:-1; opacity:0;
    background: radial-gradient(ellipse 50% 50% at 50% 50%, color-mix(in srgb, #fff 75%, var(--glow, #fff)), color-mix(in srgb, var(--glow, #fff) 40%, transparent) 45%, transparent 75%);
    filter: blur(.08em); }
  .ky-mower { position:absolute; left:0; visibility:hidden; opacity:0; z-index:3; }
  .ky-mower svg { display:block; overflow:visible; }
  .ky-mower .mw-acc { fill: var(--accent); }
  .ky-mower .mw-ink { fill: var(--ink); }
  .ky-mower .mw-line { fill:none; stroke: var(--ink); stroke-width: 5; stroke-linecap: round; }
  .ky-mower .mw-thin { stroke: var(--accent); stroke-width: 2.4; }
  :not(.ky-light) > .ky-stage .ky-mower svg { filter: drop-shadow(0 0 .35em color-mix(in srgb, var(--accent) 45%, transparent)); }
  .ky-piece { position:absolute; overflow:hidden; visibility:hidden; opacity:0; line-height:${LH}; }
  .ky-piece > span { position:absolute; left:.3em; }
  .ky-gothic { font-family: ${GOTHIC}, "Oswald", sans-serif; font-weight:400; letter-spacing: .012em; text-transform: none;
    text-shadow: 0 0 .35em color-mix(in srgb, var(--accent) 22%, transparent); }
  .ky-serif { font-family: ${SERIF}, "Playfair Display", serif; font-style: italic; font-weight:400; letter-spacing: 0; line-height: 1; }
  .ky-free .ky-mk { clip-path: none; }
  .ky-serif .ky-mk { padding: .12em .14em .22em; margin: -.12em -.14em -.22em; }
  .ky-fn { opacity:.82; }
  .ky-hero { color: var(--accent); text-shadow: 0 0 .22em color-mix(in srgb, var(--accent) 55%, transparent); }
  .ky-video .ky-scrim { display: none; } /* the footage band already darkens behind the type */
  /* light worlds: dark ink on paper/studio – no dark halos, a light veil instead of a dark scrim */
  .ky-light .ky-scrim { background: radial-gradient(ellipse 55% 48% at var(--scx, 50%) var(--scy, 50%), rgba(255,255,255,.38), rgba(255,255,255,0) 75%); }
  .ky-light .ky-ph { filter: none; }
  .ky-light .ky-gothic { text-shadow: none; }
  .ky-light .ky-hero { text-shadow: none; }
  .ky-light .ky-w { text-shadow: none !important; } /* fx glows are light; on paper they would read as smudges */
  .ky-light .ky-marker { box-shadow: none; }
  .ky-marker { position:absolute; left:-.1em; right:-.1em; top:-.03em; bottom:-.04em; background: var(--accent); border-radius:.06em;
    transform-origin: 0 50%; transform: skewX(-6deg); z-index:0; box-shadow: 0 0 .5em color-mix(in srgb, var(--accent) 45%, transparent); }
  .ky-marked .ky-mk { position:relative; z-index:1; }
  .ky-marked { text-shadow: none; }
  .ky-num { text-align:center; }
  .ky-qmark { position:absolute; left:-.32em; top:-.42em; line-height:1; font-family: ${SERIF}, serif; color: var(--accent); opacity:.9; pointer-events:none; }
  /* tinted with the palette's own deep tone, so it reads as shade, not as a grey smudge */
  .ky-halo { position:absolute; inset:-34% -20%; pointer-events:none;
    background: radial-gradient(closest-side, color-mix(in srgb, var(--markink) 58%, transparent),
      color-mix(in srgb, var(--markink) 34%, transparent) 45%, color-mix(in srgb, var(--markink) 12%, transparent) 75%, transparent); }
  .ky-light .ky-halo { background: radial-gradient(closest-side, rgba(255,255,255,.62), rgba(255,255,255,.34) 55%, rgba(255,255,255,0)); }
  /* checklist */
  .ky-check { display:inline-block; width:.62em; height:.62em; margin-right:.33em; align-self:center; flex:none; }
  .ky-check svg { width:100%; height:100%; overflow:visible; display:block; }
  .ky-cb { fill:none; stroke: var(--ink); stroke-opacity:.55; stroke-width:8; }
  .ky-tick { fill:none; stroke: var(--accent); stroke-width:15; stroke-linecap:round; stroke-linejoin:round; }
  /* hand-drawn notes */
  .ky-note { position:absolute; pointer-events:none; z-index:2; line-height:0; }
  .ky-note svg { overflow:visible; display:block; }
  .ky-note path { fill:none; stroke: var(--note, var(--accent)); stroke-linecap:round; stroke-linejoin:round; }
  .ky-note-underline { z-index:0; }
  /* data graphics */
  .ky-viz { align-self:center; margin-top: 3vh; line-height:0; }
  .ky-viz svg { overflow:visible; display:block; }
  .ky-track rect, .ky-ghostu { fill: var(--ink); fill-opacity:.14; }
  .ky-fill rect, .ky-bar1, .ky-unit { fill: var(--accent); }
  .ky-bar0 { fill: var(--ink); fill-opacity:.45; }
  .ky-ghost { fill:none; stroke: var(--ink); stroke-opacity:.4; stroke-width:2; stroke-dasharray: 6 6; }
  .ky-lbl { fill: var(--ink); fill-opacity:.7; font-family: "JetBrains Mono", ui-monospace, monospace; letter-spacing:.04em; }
  .ky-lbl-hi { fill: var(--accent); fill-opacity:1; font-weight:700; }
  .ky-cap2 { fill: var(--ink); fill-opacity:.8; font-family: "Instrument Serif", serif; font-style: italic; }
  .ky-axis { stroke: var(--ink); stroke-opacity:.3; }
  .ky-area { fill: var(--accent); fill-opacity:.14; }
  .ky-curve { fill:none; stroke: var(--accent); stroke-linecap: round; stroke-linejoin: round; }
  .ky-baseline { fill:none; stroke: var(--ink); stroke-opacity:.55; stroke-linecap: round; }
  .ky-dot { fill: var(--accent); }
  .ky-seg { fill: var(--ink); fill-opacity:.22; }
  .ky-seg-hi { fill: var(--accent); fill-opacity:1; }
${graphicsCss({ GOTHIC, SERIF })}
  :not(.ky-light) > .ky-stage .ky-note svg, :not(.ky-light) > .ky-stage .ky-viz svg { filter: drop-shadow(0 0 .35em color-mix(in srgb, var(--accent) 45%, transparent)); }
  .ky-redact { position:absolute; left:-.06em; right:-.06em; top:.08em; bottom:.04em; display:block; pointer-events:none;
    background: var(--ink, #f2f0ea); transform: scaleX(0); }
  .ky-fogveil { position:absolute; left:-35%; right:-35%; top:-25%; bottom:-25%; display:block; pointer-events:none; opacity:0;
    background: radial-gradient(ellipse 50% 50% at 50% 50%, color-mix(in srgb, var(--ink, #f2f0ea) 55%, transparent), transparent 72%);
    filter: blur(.12em); }
  .ky-spark { position:absolute; width:1em; height:1em; display:block; pointer-events:none; background: var(--glow);
    clip-path: polygon(50% 0, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0 50%, 39% 39%);
    filter: drop-shadow(0 0 .3em var(--accent)); }
`;
