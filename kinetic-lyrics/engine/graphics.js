// The graphics under a phrase beyond the five charts of type.js (gauge, compare, growth, split,
// units): numbers that are times, dates, places, ranks and measures, and pictures for the shape
// of an argument (versus, cause, cycle …), a moment of the conversation (said, verdict, notify …)
// and plain images (target, lock, summit, place …).
//
// Each kind builds an SVG of vw × vh and animates it on the shared paused timeline between Tw
// (its word is about to be spoken) and end (the phrase is about to leave). Only tweens and
// sets: the player seeks, and a seek suppresses callbacks, so nothing may depend on onUpdate.
//
// A graphic takes the fields of a staged chart: value, base, parts [{label, value}], focus,
// label, unit (what each one means is in GRAPHIC_DOC).

export const NUMBER_KINDS = ["clock", "calendar", "countdown", "timeline", "route", "speed", "temperature", "rank", "ratio", "rating", "trend", "battery", "pie"];
export const TOPIC_KINDS = ["versus", "cause", "cycle", "steps", "balance", "overlap", "fork", "said", "thought", "verdict", "warning", "notify", "target", "lock", "search", "puzzle", "summit", "place"];
export const GRAPHIC_KINDS = [...NUMBER_KINDS, ...TOPIC_KINDS];
// kinds that need a square-ish box (more height under the phrase), kinds that need the width
export const TALL = new Set(["clock", "calendar", "countdown", "speed", "temperature", "rank", "pie", "cycle", "balance", "overlap", "fork", "thought", "verdict", "warning", "target", "lock", "summit", "place", "said", "versus", "cause", "notify", "search", "puzzle"]);
export const WIDE = new Set(["timeline", "route", "versus", "cause", "steps", "notify", "search", "puzzle", "overlap", "balance", "ratio", "cycle"]);

// for the direction (tools/llm-annotate.mjs): what each kind shows and which fields it reads
export const GRAPHIC_DOC = `  clock   = a clock face: value = the time of day in hours (17.5 = half past five), the hands turn to it;
            with unit "min" or "h" a duration instead, a slice of the dial fills (value in that unit)
  calendar = a calendar page, the number flips up to value; label = the month or what is counted ("März", "Tage")
  countdown = a ring runs out around value; unit = what is counted ("Sekunden", "Tage")
  timeline = a line with points in time: parts = 2–5 {label: what happened, value: the year}; focus = the point this phrase is about
  route   = a line from one place to another: parts = 2 {label: place, value: 0}; value = the distance (0 if not said), unit = "km"
  speed   = a speedometer, the needle swings to value; base = the end of the scale (or null), unit = "km/h"
  temperature = a thermometer fills to value °C, cold blue to hot red
  rank    = a podium, the place value (1, 2, 3) lights up; label = who or what
  ratio   = value of base people light up ("jeder Fünfte": value 1, base 5)
  rating  = stars fill to value; base = the number of stars (5)
  trend   = an arrow shoots up or down, value = the change in percent (+20, -30)
  battery = a battery charges or runs down to value % (energy, exhaustion)
  pie     = a ring fills to value % (a share as a whole, where gauge is a bar)
  versus  = two things face off: parts = 2 {label}
  cause   = an arrow from cause to effect: parts = 2 {label: cause}, {label: effect}
  cycle   = things that lead to each other in a circle: parts = 2–5 {label}
  steps   = stairs, one step per stage: parts = 2–5 {label}; focus = the step this phrase is about
  balance = a scale tips to the heavier side: parts = 2 {label, value: weight}
  overlap = two circles meet: parts = 2 {label}; label = what they share
  fork    = the road splits: parts = 2 {label}; focus = the way taken (or null)
  said    = a speech bubble: label = the words in it (2–6), unit = who said it
  thought = a thought bubble: label = the thought (2–6 words, or "")
  verdict = a big tick (value 1) or cross (value 0); label = the verdict ("richtig", "Mythos")
  warning = a warning sign blinks; label = the warning ("Achtung")
  notify  = a phone notification slides in: unit = the app or sender, label = the message (2–8 words)
  target  = an arrow hits the bull's-eye; label = the goal
  lock    = a padlock locks (value 1) or opens (value 0); label = what is locked or unlocked
  search  = a search bar, label is typed into it
  puzzle  = two pieces snap together: parts = 2 {label}
  summit  = a mountain, a flag goes up on top; label = what was reached
  place   = a pin drops onto a map; label = the place`;

export function graphicsCss({ GOTHIC, SERIF }) {
  return `
  .ky-gt { fill: var(--ink); font-family: ${GOTHIC}, "Oswald", sans-serif; text-transform: uppercase; }
  .ky-gt-hi { fill: var(--accent); }
  .ky-gi { fill:none; stroke: var(--ink); stroke-linecap:round; stroke-linejoin:round; }
  .ky-gi-soft { fill:none; stroke: var(--ink); stroke-opacity:.3; stroke-linecap:round; stroke-linejoin:round; }
  .ky-ga { fill:none; stroke: var(--accent); stroke-linecap:round; stroke-linejoin:round; }
  .ky-gf { fill: var(--accent); }
  .ky-gk { fill: var(--ink); }
  .ky-gsoft { fill: var(--ink); fill-opacity:.14; }
  .ky-gpanel { fill: var(--ink); fill-opacity:.1; stroke: var(--ink); stroke-opacity:.45; }
  .ky-gbad { fill:none; stroke: #ff5a4f; stroke-linecap:round; stroke-linejoin:round; }
  .ky-gbad-f { fill: #ff5a4f; }
  .ky-gtxt { fill: var(--ink); font-family: ${SERIF}, serif; font-style: italic; }
  .ky-light .ky-gpanel { fill-opacity:.06; }
`;
}

export function makeGraphics({ f1, esc, clamp, withUnit, fmtNum, DE }) {
  // a path that draws itself: dashoffset 1 → 0
  const P = (d, cls, sw, extra = "") => `<path class="${cls}" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1" stroke-width="${f1(sw)}" d="${d}" ${extra}/>`;
  const T = (x, y, size, txt, cls = "ky-lbl", anchor = "middle", extra = "") =>
    `<text class="${cls}" x="${f1(x)}" y="${f1(y)}" font-size="${f1(size)}" text-anchor="${anchor}" ${extra}>${esc(txt)}</text>`;
  // the font size at which a text fits a width (k = average glyph width in em)
  const fit = (txt, maxW, maxSize, k = 0.46) => Math.max(8, Math.min(maxSize, maxW / (Math.max(1, String(txt).length) * k)));
  // a label on up to two lines (split at the space nearest the middle)
  const lines2 = (txt) => {
    const t = String(txt), sp = [...t.matchAll(/ /g)].map((m) => m.index);
    if (t.length < 11 || !sp.length) return [t];
    const at = sp.reduce((a, b) => (Math.abs(b - t.length / 2) < Math.abs(a - t.length / 2) ? b : a));
    return [t.slice(0, at), t.slice(at + 1)];
  };
  const T2 = (x, y, size, txt, cls, anchor = "middle") => {
    const ls = lines2(txt), y0 = y - ((ls.length - 1) * size * 0.95) / 2;
    return `<text class="${cls}" x="${f1(x)}" y="${f1(y0)}" font-size="${f1(size)}" text-anchor="${anchor}">${ls.map((l, k) => `<tspan x="${f1(x)}" dy="${k ? f1(size * 0.95) : 0}">${esc(l)}</tspan>`).join("")}</text>`;
  };
  const longest = (txt) => Math.max(...lines2(txt).map((l) => l.length));
  const draw = (tl, els, at, dur, ease = "power2.inOut") =>
    tl.fromTo(els, { attr: { "stroke-dashoffset": 1 } }, { attr: { "stroke-dashoffset": 0 }, duration: dur, ease }, at);
  const pop = (tl, els, at, dur = 0.35, ease = "back.out(2.4)", stagger = 0) =>
    tl.fromTo(els, { scale: 0, opacity: 0, transformOrigin: "50% 50%" }, { scale: 1, opacity: 1, duration: dur, ease, stagger }, at);
  const fade = (tl, els, at, dur = 0.3, stagger = 0) => tl.fromTo(els, { opacity: 0 }, { opacity: 1, duration: dur, ease: "power1.out", stagger }, at);
  // a number that counts up in steps of text (set, not tweened: a seek must land on it)
  const countText = (tl, el, to, at, dur, fmt) => {
    const steps = Math.max(6, Math.round(dur * 24));
    for (let k = 0; k <= steps; k++) {
      const p = 1 - Math.pow(1 - k / steps, 3);
      tl.set(el, { textContent: fmt(k === steps ? to : to * p) + "​" }, at + (k / steps) * dur);
    }
  };
  const arc = (cx, cy, r, a0, a1) => {
    // degrees, 0 = up, clockwise
    const p = (a) => [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${f1(x0)} ${f1(y0)} A${f1(r)} ${f1(r)} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${f1(x1)} ${f1(y1)}`;
  };
  const circlePath = (cx, cy, r) => `M${f1(cx)} ${f1(cy - r)} A${f1(r)} ${f1(r)} 0 1 1 ${f1(cx - 0.01)} ${f1(cy - r)}`;
  const partsOf = (v, min, max) => (v.parts || []).slice(0, max).concat(Array.from({ length: Math.max(0, min - (v.parts || []).length) }, () => ({ label: "", value: 0 })));
  const person = (s) => `<circle cx="${f1(s / 2)}" cy="${f1(s * 0.24)}" r="${f1(s * 0.17)}"/><path d="M${f1(s * 0.16)} ${f1(s)} V${f1(s * 0.74)} A${f1(s * 0.34)} ${f1(s * 0.3)} 0 0 1 ${f1(s * 0.84)} ${f1(s * 0.74)} V${f1(s)} Z"/>`;
  const star = (cx, cy, R) => {
    let d = "";
    for (let k = 0; k < 10; k++) {
      const a = (k * 36 - 90) * Math.PI / 180, rr = k % 2 ? R * 0.45 : R;
      d += `${k ? "L" : "M"}${f1(cx + rr * Math.cos(a))} ${f1(cy + rr * Math.sin(a))}`;
    }
    return d + "Z";
  };
  // an icon on the left, its big text on the right (most single-value graphics)
  const side = (vw, vh, R) => {
    const cx = Math.min(vw * 0.3, R * 1.25), x0 = cx + R + vh * 0.12;
    return { cx, x0, tw: Math.max(vw - x0, vw * 0.3) };
  };

  const K = {
    // ------------------------------------------------------------ numbers
    clock(v, vw, vh, fs) {
      const R = Math.min(vh * 0.44, vw * 0.24), { cx, x0, tw } = side(vw, vh, R), cy = vh * 0.5, sw = Math.max(3, R * 0.07);
      const dur = v.unit === "min" || v.unit === "h";
      const ticks = Array.from({ length: 12 }, (_, k) => {
        const a = (k * 30 * Math.PI) / 180, r0 = R * (k % 3 ? 0.84 : 0.76);
        return `<line class="ky-gi" stroke-width="${f1(sw * (k % 3 ? 0.5 : 0.9))}" x1="${f1(cx + r0 * Math.sin(a))}" y1="${f1(cy - r0 * Math.cos(a))}" x2="${f1(cx + R * 0.92 * Math.sin(a))}" y2="${f1(cy - R * 0.92 * Math.cos(a))}"/>`;
      }).join("");
      const frac = dur ? clamp(v.value / (v.unit === "min" ? 60 : 12), 0, 1) : 0;
      // h with its fraction (5.5 = half past five: the hour hand halfway between 5 and 6)
      const h = ((v.value % 12) + 12) % 12, m = (v.value % 1) * 60;
      const hh = Math.floor(v.value), mm = Math.round((v.value - hh) * 60);
      const txt = dur ? withUnit(v.value, v.unit === "min" ? (DE ? "Min." : "min") : (DE ? "Std." : "h")) : `${hh}:${String(mm).padStart(2, "0")}`;
      const big = fit(txt, tw, vh * 0.42, 0.5);
      return {
        html: `<circle class="ky-gsoft" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(R)}"/>`
          + (dur ? `<circle class="ky-gslice" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(R * 0.45)}" fill="none" stroke="var(--accent)" stroke-opacity=".85" stroke-width="${f1(R * 0.9)}" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1" transform="rotate(-90 ${f1(cx)} ${f1(cy)})"/>` : "")
          + `<circle class="ky-gi" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(R)}" stroke-width="${f1(sw)}"/>${ticks}`
          + `<line class="ky-hand-h ky-gi" stroke-width="${f1(sw * 1.4)}" x1="${f1(cx)}" y1="${f1(cy)}" x2="${f1(cx)}" y2="${f1(cy - R * 0.5)}"/>`
          + `<line class="ky-hand-m ky-ga" stroke-width="${f1(sw)}" x1="${f1(cx)}" y1="${f1(cy)}" x2="${f1(cx)}" y2="${f1(cy - R * 0.78)}"/>`
          + `<circle class="ky-gf" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(sw * 1.3)}"/>`
          + T(x0, cy + big * 0.35, big, txt, "ky-gt ky-gt-hi ky-g-big", "start")
          + (v.label ? T(x0, cy + big * 0.35 + fs * 1.3, fs, v.label, "ky-lbl", "start") : ""),
        anim(tl, q, qa, Tw, end) {
          const D = clamp(end - Tw, 0.5, 1.6), o = `${f1(cx)} ${f1(cy)}`;
          if (dur) draw(tl, q(".ky-gslice"), Tw, D, "power2.out");
          tl.fromTo(q(".ky-hand-m"), { rotation: 0, svgOrigin: o }, { rotation: dur ? frac * 360 : Math.floor(h) * 360 + m * 6, svgOrigin: o, duration: D, ease: "power2.inOut" }, Tw);
          tl.fromTo(q(".ky-hand-h"), { rotation: 0, svgOrigin: o }, { rotation: dur ? frac * 30 : h * 30, svgOrigin: o, duration: D, ease: "power2.inOut" }, Tw);
          fade(tl, qa(".ky-g-big, .ky-lbl"), Tw + D * 0.5, 0.35);
        },
      };
    },
    calendar(v, vw, vh, fs) {
      const ph = vh * 0.9, pw = ph * 0.86, x = (vw - pw) / 2, y = vh * 0.05, hb = ph * 0.26, rx = pw * 0.08;
      const n = Math.round(v.value), big = fit(String(n), pw * 0.8, ph * 0.5, 0.5);
      return {
        html: `<g class="ky-page"><rect class="ky-gpanel" x="${f1(x)}" y="${f1(y)}" width="${f1(pw)}" height="${f1(ph)}" rx="${f1(rx)}" stroke-width="2"/>`
          + `<path class="ky-gf" d="M${f1(x)} ${f1(y + rx)} Q${f1(x)} ${f1(y)} ${f1(x + rx)} ${f1(y)} H${f1(x + pw - rx)} Q${f1(x + pw)} ${f1(y)} ${f1(x + pw)} ${f1(y + rx)} V${f1(y + hb)} H${f1(x)} Z"/>`
          + [0.3, 0.7].map((k) => `<rect class="ky-gk" x="${f1(x + pw * k - pw * 0.03)}" y="${f1(y - ph * 0.06)}" width="${f1(pw * 0.06)}" height="${f1(ph * 0.12)}" rx="${f1(pw * 0.03)}"/>`).join("")
          + (v.label ? T(x + pw / 2, y + hb * 0.7, fit(v.label, pw * 0.85, hb * 0.6, 0.5), v.label, "ky-gt", "middle", 'style="fill:var(--markink, #111)"') : "")
          + T(x + pw / 2, y + hb + (ph - hb) / 2 + big * 0.36, big, "1", "ky-gt ky-gt-hi ky-g-num")
          + `</g><rect class="ky-gpanel ky-g-leaf" x="${f1(x)}" y="${f1(y + hb)}" width="${f1(pw)}" height="${f1(ph - hb)}" rx="${f1(rx)}" stroke-width="2" opacity="0"/>`,
        anim(tl, q, qa, Tw, end) {
          const D = clamp(end - Tw, 0.5, 1.4);
          pop(tl, q(".ky-page"), Tw - 0.1, 0.35, "back.out(1.8)");
          countText(tl, q(".ky-g-num"), n, Tw + 0.15, D * 0.75, (x) => String(Math.max(1, Math.round(x))));
          // the last page tears off upward when the number lands
          tl.fromTo(q(".ky-g-leaf"), { opacity: 0.9, y: 0, rotation: 0 }, { opacity: 0, y: -vh * 0.4, rotation: -14, transformOrigin: "0% 0%", duration: 0.45, ease: "power2.in" }, Tw + 0.15 + D * 0.75);
        },
      };
    },
    countdown(v, vw, vh, fs) {
      const R = Math.min(vh * 0.44, vw * 0.3), cx = vw / 2, cy = vh / 2, sw = R * 0.16;
      const big = fit(fmtNum(v.value), R * 1.3, R * 0.7, 0.5);
      return {
        html: `<circle class="ky-gi-soft" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(R)}" stroke-width="${f1(sw)}"/>`
          + `<path class="ky-ga ky-g-ring" d="${circlePath(cx, cy, R)}" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="0" stroke-width="${f1(sw)}"/>`
          + T(cx, cy + big * 0.3, big, fmtNum(v.value), "ky-gt ky-gt-hi ky-g-num")
          + (v.unit ? T(cx, cy + big * 0.3 + fs * 1.1, fs * 0.9, v.unit.toUpperCase(), "ky-lbl") : ""),
        anim(tl, q, qa, Tw, end) {
          const D = clamp(end - Tw, 0.6, 2.2);
          pop(tl, qa(".ky-g-num"), Tw - 0.1, 0.35);
          tl.fromTo(q(".ky-g-ring"), { attr: { "stroke-dashoffset": 0 } }, { attr: { "stroke-dashoffset": -0.92 }, duration: D, ease: "none" }, Tw);
          tl.fromTo(q(".ky-g-num"), { scale: 1, transformOrigin: "50% 50%" }, { scale: 1.12, duration: 0.12, yoyo: true, repeat: 1, ease: "power2.out" }, Tw + D - 0.25);
        },
      };
    },
    timeline(v, vw, vh, fs) {
      const ps = partsOf(v, 2, 5), y = vh * 0.48, pad = vw * 0.08, vals = ps.map((p) => p.value);
      const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
      const xs = ps.map((p, k) => (hi > lo ? pad + ((p.value - lo) / span) * (vw - pad * 2) : pad + (k / Math.max(1, ps.length - 1)) * (vw - pad * 2)));
      const fo = v.focus != null && v.focus < ps.length ? v.focus : ps.length - 1, sw = Math.max(3, fs * 0.16);
      const cap = Math.min(fs * 1.05, ...ps.map((p) => fit(p.label, (vw - pad * 2) / ps.length, fs * 1.05, 0.42)));
      return {
        html: P(`M${f1(pad * 0.4)} ${f1(y)} H${f1(vw - pad * 0.4)}`, "ky-gi ky-g-line", sw)
          + ps.map((p, k) => `<g class="ky-g-pt"><circle class="${k === fo ? "ky-gf" : "ky-gk"}" cx="${f1(xs[k])}" cy="${f1(y)}" r="${f1(sw * (k === fo ? 2.6 : 1.8))}"/>`
            + T(xs[k], y - fs * 0.9, fs * (k === fo ? 1.3 : 1.05), p.value ? String(p.value) : "", k === fo ? "ky-lbl ky-lbl-hi" : "ky-lbl")
            + T(xs[k], y + cap * 1.9, cap, p.label, "ky-cap2") + `</g>`).join(""),
        anim(tl, q, qa, Tw, end) {
          const D = clamp(end - Tw, 0.6, 1.6);
          draw(tl, q(".ky-g-line"), Tw - 0.1, D, "power1.inOut");
          qa(".ky-g-pt").forEach((g, k) => pop(tl, g, Tw - 0.1 + D * ((xs[k] - pad * 0.4) / (vw - pad * 0.8)), 0.35));
        },
      };
    },
    route(v, vw, vh, fs) {
      const [a, b] = partsOf(v, 2, 2), x0 = vw * 0.1, x1 = vw * 0.9, y = vh * 0.66, top = vh * 0.12, sw = Math.max(3, fs * 0.16);
      const d = `M${f1(x0)} ${f1(y)} Q${f1(vw / 2)} ${f1(top - vh * 0.1)} ${f1(x1)} ${f1(y)}`;
      // the dot's way along the curve, as keyframes (no callbacks)
      const pts = Array.from({ length: 21 }, (_, k) => { const t = k / 20, u = 1 - t; return [u * u * x0 + 2 * u * t * (vw / 2) + t * t * x1, u * u * y + 2 * u * t * (top - vh * 0.1) + t * t * y]; });
      const cap = Math.min(fit(a.label, vw * 0.4, fs * 1.2, 0.42), fit(b.label, vw * 0.4, fs * 1.2, 0.42));
      const dist = v.value > 0 ? withUnit(v.value, v.unit || "km") : "";
      return {
        html: `<path class="ky-gi-soft" d="${d}" stroke-width="${f1(sw * 0.6)}" stroke-dasharray="${f1(sw * 1.5)} ${f1(sw * 1.5)}"/>`
          + P(d, "ky-ga ky-g-way", sw)
          + [[x0, a], [x1, b]].map(([x, p], k) => `<g class="ky-g-end"><circle class="${k ? "ky-gf" : "ky-gk"}" cx="${f1(x)}" cy="${f1(y)}" r="${f1(sw * 2.2)}"/>${T(x, y + cap * 1.8, cap, p.label, "ky-cap2")}</g>`).join("")
          + `<circle class="ky-gf ky-g-dot" cx="${f1(x0)}" cy="${f1(y)}" r="${f1(sw * 1.6)}"/>`
          + (dist ? T(vw / 2, top + fs * 0.4, fs * 1.3, dist, "ky-lbl ky-lbl-hi ky-g-dist") : ""),
        anim(tl, q, qa, Tw, end) {
          const D = clamp(end - Tw, 0.7, 1.2);
          pop(tl, qa(".ky-g-end")[0], Tw - 0.2, 0.3);
          draw(tl, q(".ky-g-way"), Tw, D, "power1.inOut");
          tl.to(q(".ky-g-dot"), { keyframes: pts.slice(1).map(([x, yy]) => ({ attr: { cx: x, cy: yy }, duration: D / 20, ease: "none" })) }, Tw);
          pop(tl, qa(".ky-g-end")[1], Tw + D - 0.1, 0.35);
          if (dist) countText(tl, q(".ky-g-dist"), v.value, Tw, D, (x) => withUnit(Math.round(x), v.unit || "km"));
        },
      };
    },
    speed(v, vw, vh, fs) {
      const R = Math.min(vh * 0.8, vw * 0.3), cx = Math.min(vw * 0.32, R * 1.15), cy = vh * 0.88, sw = R * 0.12, x0 = cx + R + vh * 0.1;
      const nice = (x) => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, x)))); return Math.ceil((x * 1.25) / p) * p; };
      const max = v.base > 0 ? v.base : nice(v.value), frac = clamp(v.value / max, 0, 1);
      const ticks = Array.from({ length: 11 }, (_, k) => {
        const a = (-90 + k * 18) * Math.PI / 180, r0 = R * (k % 5 ? 0.78 : 0.7);
        return `<line class="ky-gi" stroke-width="${f1(sw * (k % 5 ? 0.18 : 0.3))}" x1="${f1(cx + r0 * Math.sin(a))}" y1="${f1(cy - r0 * Math.cos(a))}" x2="${f1(cx + R * 0.86 * Math.sin(a))}" y2="${f1(cy - R * 0.86 * Math.cos(a))}"/>`;
      }).join("");
      const big = fit(withUnit(v.value, v.unit), Math.max(vw - x0, vw * 0.3), vh * 0.42, 0.5);
      return {
        html: `<path class="ky-gi-soft" d="${arc(cx, cy, R, -90, 90)}" stroke-width="${f1(sw)}"/>`
          + P(arc(cx, cy, R, -90, 90), "ky-ga ky-g-fill", sw) + ticks
          + `<line class="ky-ga ky-g-needle" stroke-width="${f1(sw * 0.35)}" x1="${f1(cx)}" y1="${f1(cy)}" x2="${f1(cx)}" y2="${f1(cy - R * 0.82)}"/>`
          + `<circle class="ky-gf" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(sw * 0.6)}"/>`
          + T(x0, vh * 0.6 + big * 0.35, big, withUnit(v.value, v.unit), "ky-gt ky-gt-hi ky-g-num", "start"),
        anim(tl, q, qa, Tw, end) {
          const D = clamp(end - Tw, 0.5, 1.2), o = `${f1(cx)} ${f1(cy)}`, a = -90 + frac * 180;
          tl.fromTo(q(".ky-g-needle"), { rotation: -90, svgOrigin: o }, { rotation: Math.min(95, a + 9), svgOrigin: o, duration: D * 0.7, ease: "power3.out" }, Tw);
          tl.to(q(".ky-g-needle"), { rotation: a, svgOrigin: o, duration: D * 0.3, ease: "sine.inOut" }, Tw + D * 0.7);
          for (let k = 0; k < 4; k++) tl.to(q(".ky-g-needle"), { rotation: a + (k % 2 ? -1.5 : 1.5), svgOrigin: o, duration: 0.06, ease: "none" }, Tw + D + k * 0.06);
          tl.fromTo(q(".ky-g-fill"), { attr: { "stroke-dashoffset": 1 } }, { attr: { "stroke-dashoffset": 1 - frac }, duration: D, ease: "power3.out" }, Tw);
          countText(tl, q(".ky-g-num"), v.value, Tw, D * 0.8, (x) => withUnit(Math.round(x), v.unit));
        },
      };
    },
    temperature(v, vw, vh, fs) {
      const th = vh * 0.92, tw2 = th * 0.16, R = tw2 * 0.95, { cx, x0, tw } = side(vw, vh, R), top = vh * 0.04, bot = top + th - R * 1.6;
      const lv = clamp((v.value + 20) / 65, 0.04, 1), ly = bot - (bot - top - tw2 / 2) * lv;
      const col = v.value < 5 ? "#6ec6ff" : v.value < 25 ? "var(--accent)" : "#ff5a3c";
      const txt = `${fmtNum(v.value)} °C`, big = fit(txt, tw, vh * 0.4, 0.5);
      return {
        html: `<rect class="ky-gpanel" x="${f1(cx - tw2 / 2)}" y="${f1(top)}" width="${f1(tw2)}" height="${f1(th - R)}" rx="${f1(tw2 / 2)}" stroke-width="2"/>`
          + `<circle class="ky-gpanel" cx="${f1(cx)}" cy="${f1(top + th - R)}" r="${f1(R)}" stroke-width="2"/>`
          + `<rect class="ky-g-merc" x="${f1(cx - tw2 * 0.28)}" y="${f1(ly)}" width="${f1(tw2 * 0.56)}" height="${f1(top + th - R - ly)}" rx="${f1(tw2 * 0.28)}" style="fill:${col}"/>`
          + `<circle class="ky-g-bulb" cx="${f1(cx)}" cy="${f1(top + th - R)}" r="${f1(R * 0.7)}" style="fill:${col}"/>`
          + T(x0, vh * 0.5 + big * 0.35, big, txt, "ky-gt ky-g-num", "start", `style="fill:${col}"`),
        anim(tl, q, qa, Tw, end) {
          const D = clamp(end - Tw, 0.6, 1.4);
          pop(tl, q(".ky-g-bulb"), Tw - 0.15, 0.3);
          tl.fromTo(q(".ky-g-merc"), { scaleY: 0, transformOrigin: "50% 100%" }, { scaleY: 1, duration: D, ease: "power2.out" }, Tw);
          countText(tl, q(".ky-g-num"), v.value, Tw, D, (x) => `${Math.round(x)} °C`);
        },
      };
    },
    rank(v, vw, vh, fs) {
      const place = Math.max(1, Math.round(v.value)), bw = Math.min(vw * 0.26, vh * 0.5), base = vh * 0.96, cx = vw / 2;
      const steps = [[2, cx - bw, 0.45], [1, cx, 0.68], [3, cx + bw, 0.3]];
      const lab = v.label ? fit(v.label, vw * 0.9, fs * 1.2, 0.42) : 0;
      return {
        html: steps.map(([n, x, h]) => `<g class="ky-g-step"><rect class="${n === place ? "ky-gf" : "ky-gsoft"}" x="${f1(x - bw / 2 + 2)}" y="${f1(base - vh * h)}" width="${f1(bw - 4)}" height="${f1(vh * h)}" rx="${f1(bw * 0.05)}"/>`
          + T(x, base - vh * h + bw * 0.42, bw * 0.4, String(n), n === place ? "ky-gt" : "ky-gt", "middle", n === place ? 'style="fill:var(--markink, #111)"' : 'style="opacity:.5"') + `</g>`).join("")
          + (place > 3 ? T(cx, vh * 0.3, vh * 0.32, `#${place}`, "ky-gt ky-gt-hi ky-g-badge") : "")
          + (v.label && place <= 3 ? T(steps.find((s) => s[0] === place)[1], base - vh * steps.find((s) => s[0] === place)[2] - lab * 0.5, lab, v.label, "ky-cap2 ky-g-who") : ""),
        anim(tl, q, qa, Tw, end) {
          const g = qa(".ky-g-step");
          [0, 2, 1].forEach((k, j) => tl.fromTo(g[k], { scaleY: 0, transformOrigin: "50% 100%" }, { scaleY: 1, duration: 0.4, ease: "back.out(1.6)" }, Tw - 0.2 + j * 0.15));
          if (q(".ky-g-badge")) pop(tl, q(".ky-g-badge"), Tw + 0.3, 0.4);
          if (q(".ky-g-who")) tl.fromTo(q(".ky-g-who"), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" }, Tw + 0.45);
        },
      };
    },
    ratio(v, vw, vh, fs) {
      const n = clamp(Math.round(v.base || 5), 2, 12), k = clamp(Math.round(v.value), 0, n);
      const lblH = fs * 1.6, cell = Math.min((vh - lblH) * 0.95, vw / n), s = cell * 0.82, gx = (vw - n * cell) / 2 + (cell - s) / 2, gy = (vh - lblH - s) / 2;
      const txt = DE ? `${k} von ${n}` : `${k} in ${n}`;
      let g = "";
      for (let j = 0; j < n; j++) g += `<g transform="translate(${f1(gx + j * cell)} ${f1(gy)})"><g class="ky-ghostu ky-g-p">${person(s)}</g>${j < k ? `<g class="ky-unit ky-g-on">${person(s)}</g>` : ""}</g>`;
      return {
        html: g + T(vw / 2, vh - fs * 0.3, fs * 1.1, txt, "ky-lbl ky-lbl-hi ky-g-txt"),
        anim(tl, q, qa, Tw, end) {
          pop(tl, qa(".ky-g-p"), Tw - 0.2, 0.3, "back.out(2)", 0.04);
          pop(tl, qa(".ky-g-on"), Tw + 0.2 + n * 0.04, 0.35, "back.out(3)", 0.08);
          fade(tl, q(".ky-g-txt"), Tw + 0.3 + n * 0.04);
        },
      };
    },
    rating(v, vw, vh, fs) {
      const n = clamp(Math.round(v.base || 5), 3, 10), val = clamp(v.value, 0, n), txt = fmtNum(val);
      const tw = fit(txt, vw * 0.25, vh * 0.5, 0.5) * txt.length * 0.55, R = Math.min(vh * 0.4, (vw - tw - fs) / n / 2.1), gap = R * 2.15;
      const x0 = (vw - (n * gap + tw + fs)) / 2 + R, cy = vh / 2;
      let g = "";
      for (let j = 0; j < n; j++) {
        const cx = x0 + j * gap, f = clamp(val - j, 0, 1);
        g += `<path class="ky-gsoft" d="${star(cx, cy, R)}"/>`;
        if (f > 0) g += `<clipPath id="kyst${j}${Math.round(vw)}"><rect class="ky-g-clip" x="${f1(cx - R)}" y="${f1(cy - R)}" width="0" height="${f1(R * 2)}" data-w="${f1(R * 2 * f)}"/></clipPath><path class="ky-gf" clip-path="url(#kyst${j}${Math.round(vw)})" d="${star(cx, cy, R)}"/>`;
      }
      return {
        html: g + T(x0 + n * gap - R + fs * 0.5, cy + vh * 0.16, Math.min(vh * 0.5, fit(txt, vw * 0.25, vh * 0.5, 0.5)), txt, "ky-gt ky-gt-hi ky-g-txt", "start"),
        anim(tl, q, qa, Tw, end) {
          qa(".ky-g-clip").forEach((c, j) => tl.fromTo(c, { attr: { width: 0 } }, { attr: { width: +c.getAttribute("data-w") }, duration: 0.22, ease: "power1.out" }, Tw + j * 0.14));
          pop(tl, q(".ky-g-txt"), Tw + n * 0.1, 0.35);
        },
      };
    },
    trend(v, vw, vh, fs) {
      const up = v.value >= 0, R = vh * 0.46, { cx, x0, tw } = side(vw, vh, R), sw = Math.max(4, R * 0.13);
      const ya = up ? vh * 0.9 : vh * 0.1, yb = up ? vh * 0.12 : vh * 0.88, xa = cx - R, xb = cx + R * 0.9;
      const d = `M${f1(xa)} ${f1(ya)} L${f1(cx - R * 0.25)} ${f1((ya + yb) / 2 + (up ? 1 : -1) * vh * 0.08)} L${f1(cx + R * 0.15)} ${f1((ya + yb) / 2 + (up ? -1 : 1) * vh * 0.06)} L${f1(xb)} ${f1(yb)}`;
      const ang = Math.atan2(yb - ((ya + yb) / 2 + (up ? -1 : 1) * vh * 0.06), xb - (cx + R * 0.15)), hl = sw * 3;
      const head = `M${f1(xb - hl * Math.cos(ang - 0.5))} ${f1(yb - hl * Math.sin(ang - 0.5))} L${f1(xb)} ${f1(yb)} L${f1(xb - hl * Math.cos(ang + 0.5))} ${f1(yb - hl * Math.sin(ang + 0.5))}`;
      const txt = `${up ? "+" : "−"}${fmtNum(Math.abs(v.value))}%`, big = fit(txt, tw, vh * 0.5, 0.5);
      return {
        html: P(d, up ? "ky-ga ky-g-line" : "ky-gbad ky-g-line", sw) + `<path class="${up ? "ky-ga" : "ky-gbad"} ky-g-head" d="${head}" stroke-width="${f1(sw)}" opacity="0"/>`
          + T(x0, vh * 0.5 + big * 0.35, big, txt, up ? "ky-gt ky-gt-hi ky-g-num" : "ky-gt ky-g-num", "start", up ? "" : 'style="fill:#ff5a4f"'),
        anim(tl, q, qa, Tw, end) {
          draw(tl, q(".ky-g-line"), Tw - 0.1, 0.45, "power3.in");
          tl.fromTo(q(".ky-g-head"), { opacity: 0 }, { opacity: 1, duration: 0.05 }, Tw + 0.33);
          countText(tl, q(".ky-g-num"), Math.abs(v.value), Tw, 0.6, (x) => `${up ? "+" : "−"}${fmtNum(Math.round(x))}%`);
        },
      };
    },
    battery(v, vw, vh, fs) {
      const bh = vh * 0.62, bw = Math.min(vw * 0.5, bh * 2.1), x = vw * 0.06, y = (vh - bh) / 2, pad = bh * 0.1, n = 5, val = clamp(v.value, 0, 100);
      const low = val <= 20, lit = Math.max(val > 0 ? 1 : 0, Math.round((val / 100) * n)), cw = (bw - pad * (n + 1)) / n;
      const txt = `${fmtNum(val)}%`, big = fit(txt, vw - (x + bw + bh * 0.4), vh * 0.5, 0.5);
      let cells = "";
      for (let j = 0; j < n; j++) cells += `<rect class="${j < lit ? (low ? "ky-gbad-f" : "ky-gf") : "ky-gsoft"} ${j < lit ? "ky-g-cell" : ""}" x="${f1(x + pad + j * (cw + pad))}" y="${f1(y + pad)}" width="${f1(cw)}" height="${f1(bh - pad * 2)}" rx="${f1(pad * 0.4)}"/>`;
      return {
        html: `<rect class="ky-gi" x="${f1(x)}" y="${f1(y)}" width="${f1(bw)}" height="${f1(bh)}" rx="${f1(bh * 0.14)}" stroke-width="${f1(Math.max(3, bh * 0.05))}"/>`
          + `<rect class="ky-gk" x="${f1(x + bw + bh * 0.04)}" y="${f1(y + bh * 0.3)}" width="${f1(bh * 0.1)}" height="${f1(bh * 0.4)}" rx="${f1(bh * 0.04)}"/>` + cells
          + T(x + bw + bh * 0.4, vh / 2 + big * 0.35, big, txt, low ? "ky-gt ky-g-num" : "ky-gt ky-gt-hi ky-g-num", "start", low ? 'style="fill:#ff5a4f"' : ""),
        anim(tl, q, qa, Tw, end) {
          const c = qa(".ky-g-cell");
          fade(tl, c, Tw - 0.1, 0.12, 0.12);
          if (low && c.length) for (let k = 0; k < 4; k++) tl.to(c[c.length - 1], { opacity: k % 2 ? 1 : 0.15, duration: 0.01 }, Tw + 0.3 + k * 0.18);
          countText(tl, q(".ky-g-num"), val, Tw - 0.1, Math.max(0.3, lit * 0.12), (x) => `${fmtNum(Math.round(x))}%`);
        },
      };
    },
    pie(v, vw, vh, fs) {
      const R = Math.min(vh * 0.4, vw * 0.3), cx = vw / 2, cy = vh / 2, sw = R * 0.28, frac = clamp(v.value / 100, 0, 1);
      const txt = `${fmtNum(v.value)}%`, big = fit(txt, R * 1.2, R * 0.6, 0.5);
      return {
        html: `<circle class="ky-gi-soft" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(R)}" stroke-width="${f1(sw)}"/>`
          + P(circlePath(cx, cy, R), "ky-ga ky-g-arc", sw, 'stroke-linecap="butt"')
          + T(cx, cy + big * 0.35, big, txt, "ky-gt ky-gt-hi ky-g-num"),
        anim(tl, q, qa, Tw, end) {
          const D = clamp(end - Tw, 0.5, 1.2);
          tl.fromTo(q(".ky-g-arc"), { attr: { "stroke-dashoffset": 1 } }, { attr: { "stroke-dashoffset": 1 - frac }, duration: D, ease: "power2.out" }, Tw);
          countText(tl, q(".ky-g-num"), v.value, Tw, D, (x) => `${fmtNum(Math.round(x))}%`);
        },
      };
    },

    // ------------------------------------------------------------ the shape of an argument
    versus(v, vw, vh, fs) {
      const [a, b] = partsOf(v, 2, 2), R = Math.min(vh * 0.3, vw * 0.07), cy = vh / 2;
      // side by side in a wide box, one above the other in a narrow one
      const stack = vw < vh * 2.4, Rs = Math.min(vh * 0.12, vw * 0.08);
      const size = stack ? Math.min(fit(a.label, vw * 0.9, vh * 0.3, 0.44), fit(b.label, vw * 0.9, vh * 0.3, 0.44))
        : Math.min(fit(a.label, vw * 0.38, vh * 0.42, 0.44), fit(b.label, vw * 0.38, vh * 0.42, 0.44));
      const rr = stack ? Rs : R;
      return {
        html: (stack
          ? T(vw / 2, cy - rr * 1.3, size, a.label, "ky-gt ky-g-a") + T(vw / 2, cy + rr * 1.3 + size * 0.75, size, b.label, "ky-gt ky-g-b")
          : T(vw / 2 - R * 1.5, cy + size * 0.35, size, a.label, "ky-gt ky-g-a", "end") + T(vw / 2 + R * 1.5, cy + size * 0.35, size, b.label, "ky-gt ky-g-b", "start"))
          + `<g class="ky-g-vs"><circle class="ky-gf" cx="${f1(vw / 2)}" cy="${f1(cy)}" r="${f1(rr)}"/>${T(vw / 2, cy + rr * 0.32, rr * 0.9, "VS", "ky-gt", "middle", 'style="fill:var(--markink, #111)"')}</g>`,
        anim(tl, q, qa, Tw, end) {
          const off = stack ? { y: -vh * 0.3 } : { x: -vw * 0.3 }, off2 = stack ? { y: vh * 0.3 } : { x: vw * 0.3 };
          tl.fromTo(q(".ky-g-a"), { ...off, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, Tw - 0.2);
          tl.fromTo(q(".ky-g-b"), { ...off2, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, Tw - 0.1);
          tl.fromTo(q(".ky-g-vs"), { scale: 2.6, opacity: 0, transformOrigin: "50% 50%" }, { scale: 1, opacity: 1, duration: 0.3, ease: "power4.in" }, Tw + 0.2);
          tl.fromTo(qa(".ky-g-a, .ky-g-b"), { x: 0 }, { x: 3, duration: 0.04, yoyo: true, repeat: 3, ease: "none" }, Tw + 0.5);
        },
      };
    },
    cause(v, vw, vh, fs) {
      const [a, b] = partsOf(v, 2, 2), stack = vw < vh * 2.4, cy = vh / 2;
      const size = stack ? Math.min(fit(a.label, vw * 0.9, vh * 0.26, 0.44), fit(b.label, vw * 0.9, vh * 0.26, 0.44))
        : Math.min(fit(a.label, vw * 0.36, vh * 0.4, 0.44), fit(b.label, vw * 0.36, vh * 0.4, 0.44));
      const sw = Math.max(4, size * 0.09), hl = sw * 3;
      // the arrow: across between the two, or down from the cause to the effect
      const [ax, ay, bx, by] = stack ? [vw / 2, size * 0.95, vw / 2, vh - size * 1.15] : [vw * 0.4 + sw, cy, vw * 0.6 - sw * 2, cy];
      const head = stack ? `M${f1(bx - hl)} ${f1(by - hl)} L${f1(bx)} ${f1(by)} L${f1(bx + hl)} ${f1(by - hl)}` : `M${f1(bx - hl)} ${f1(by - hl)} L${f1(bx)} ${f1(by)} L${f1(bx - hl)} ${f1(by + hl)}`;
      return {
        html: (stack ? T(vw / 2, size * 0.75, size, a.label, "ky-gt ky-g-a") : T(vw * 0.4 - sw, cy + size * 0.35, size, a.label, "ky-gt ky-g-a", "end"))
          + P(`M${f1(ax)} ${f1(ay)} L${f1(bx)} ${f1(by)}`, "ky-ga ky-g-arrow", sw)
          + `<path class="ky-ga ky-g-head" d="${head}" stroke-width="${f1(sw)}" opacity="0"/>`
          + (stack ? T(vw / 2, vh - size * 0.1, size, b.label, "ky-gt ky-gt-hi ky-g-b") : T(vw * 0.6, cy + size * 0.35, size, b.label, "ky-gt ky-gt-hi ky-g-b", "start")),
        anim(tl, q, qa, Tw, end) {
          const D = clamp(end - Tw, 0.6, 1.2);
          fade(tl, q(".ky-g-a"), Tw - 0.2, 0.3);
          draw(tl, q(".ky-g-arrow"), Tw + 0.1, D * 0.45, "power2.in");
          tl.fromTo(q(".ky-g-head"), { opacity: 0 }, { opacity: 1, duration: 0.05 }, Tw + 0.1 + D * 0.42);
          tl.fromTo(q(".ky-g-b"), { opacity: 0, scale: 1.5, transformOrigin: stack ? "50% 50%" : "0% 50%" }, { opacity: 1, scale: 1, duration: 0.3, ease: "power3.out" }, Tw + 0.1 + D * 0.45);
        },
      };
    },
    cycle(v, vw, vh, fs) {
      const ps = partsOf(v, 2, 5), n = ps.length, R = Math.min(vh * 0.36, vw * 0.24), cx = vw / 2, cy = vh / 2, sw = Math.max(3, fs * 0.14);
      const pos = ps.map((_, k) => { const a = (k / n) * Math.PI * 2; return [cx + R * Math.sin(a), cy - R * Math.cos(a)]; });
      const cap = Math.min(...ps.map((p) => fit("x".repeat(longest(p.label)), Math.min(R * 1.6, vw / 3), fs * 1.5, 0.44)));
      const arrows = ps.map((_, k) => {
        const a0 = (k / n) * 360 + 360 / n * 0.28, a1 = ((k + 1) / n) * 360 - 360 / n * 0.28;
        const e = (a1 * Math.PI) / 180, hl = sw * 2.6, tx = Math.cos(e), ty = Math.sin(e), ex = cx + R * Math.sin(e), ey = cy - R * Math.cos(e);
        return P(arc(cx, cy, R, a0, a1), "ky-ga ky-g-arc", sw) + `<path class="ky-ga ky-g-head" opacity="0" stroke-width="${f1(sw)}" d="M${f1(ex - hl * tx - hl * 0.7 * ty)} ${f1(ey - hl * ty + hl * 0.7 * tx)} L${f1(ex)} ${f1(ey)} L${f1(ex - hl * tx + hl * 0.7 * ty)} ${f1(ey - hl * ty - hl * 0.7 * tx)}"/>`;
      }).join("");
      return {
        html: arrows + ps.map((p, k) => `<g class="ky-g-node">${T2(pos[k][0], pos[k][1] + cap * 0.35, cap, p.label, "ky-gt")}</g>`).join("")
          + `<circle class="ky-gf ky-g-dot" cx="${f1(cx)}" cy="${f1(cy - R)}" r="${f1(sw * 1.6)}" opacity="0"/>`,
        anim(tl, q, qa, Tw, end) {
          const D = clamp(end - Tw, 0.8, 2.4), nodes = qa(".ky-g-node"), arcs = qa(".ky-g-arc"), heads = qa(".ky-g-head"), step = Math.min(0.35, D / (n * 2));
          nodes.forEach((g, k) => {
            pop(tl, g, Tw - 0.2 + k * step * 2, 0.3);
            draw(tl, arcs[k], Tw - 0.2 + k * step * 2 + step, step, "none");
            tl.fromTo(heads[k], { opacity: 0 }, { opacity: 1, duration: 0.02 }, Tw - 0.2 + k * step * 2 + step * 2);
          });
          const t0 = Tw - 0.2 + n * step * 2;
          tl.fromTo(q(".ky-g-dot"), { opacity: 0 }, { opacity: 1, duration: 0.1 }, t0);
          tl.fromTo(q(".ky-g-dot"), { rotation: 0, svgOrigin: `${f1(cx)} ${f1(cy)}` }, { rotation: 720, svgOrigin: `${f1(cx)} ${f1(cy)}`, duration: 2.4, ease: "none" }, t0);
        },
      };
    },
    steps(v, vw, vh, fs) {
      const ps = partsOf(v, 2, 5), n = ps.length, w = vw / n, sh = (vh * 0.6) / n, cap = Math.min(...ps.map((p) => fit(p.label, w * 0.9, fs * 1.15, 0.44)));
      const fo = v.focus != null && v.focus < n ? v.focus : n - 1;
      return {
        html: ps.map((p, k) => { const h = sh * (k + 1), y = vh - h; return `<g class="ky-g-step"><rect class="${k === fo ? "ky-gf" : "ky-gsoft"}" x="${f1(k * w + 2)}" y="${f1(y)}" width="${f1(w - 4)}" height="${f1(h)}" rx="${f1(w * 0.04)}"/>${T(k * w + w / 2, y - cap * 0.45, cap, p.label, k === fo ? "ky-gt ky-gt-hi" : "ky-gt")}</g>`; }).join("")
          + `<circle class="ky-gk ky-g-dot" cx="${f1(w / 2)}" cy="${f1(vh - sh - cap * 1.6)}" r="${f1(Math.max(4, fs * 0.25))}" opacity="0"/>`,
        anim(tl, q, qa, Tw, end) {
          const g = qa(".ky-g-step"), step = Math.min(0.3, clamp(end - Tw, 0.6, 1.6) / n);
          g.forEach((s, k) => tl.fromTo(s, { scaleY: 0, opacity: 0, transformOrigin: "50% 100%" }, { scaleY: 1, opacity: 1, duration: 0.3, ease: "back.out(1.6)" }, Tw - 0.2 + k * step));
          const dot = q(".ky-g-dot"), t0 = Tw - 0.2 + n * step;
          tl.fromTo(dot, { opacity: 0 }, { opacity: 1, duration: 0.1 }, t0);
          for (let k = 1; k <= fo; k++) {
            tl.to(dot, { attr: { cx: k * w + w / 2 }, duration: 0.22, ease: "none" }, t0 + (k - 1) * 0.24);
            tl.to(dot, { attr: { cy: vh - sh * (k + 1) - cap * 1.6 }, duration: 0.22, ease: "back.out(3)" }, t0 + (k - 1) * 0.24);
          }
        },
      };
    },
    balance(v, vw, vh, fs) {
      const [a, b] = partsOf(v, 2, 2), cx = vw / 2, py = vh * 0.18, L = Math.min(vw * 0.32, vh * 0.9), sw = Math.max(3, fs * 0.16);
      const wa = a.value || 1, wb = b.value || 1, ang = wa === wb ? 0 : clamp((wb - wa) / Math.max(wa, wb), -1, 1) * 14;
      const drop = vh * 0.38, pr = L * 0.42, cap = Math.min(fit(a.label, pr * 2, fs * 1.3, 0.44), fit(b.label, pr * 2, fs * 1.3, 0.44));
      const pan = (sx, p, cls) => `<g class="${cls}"><path class="ky-gi" stroke-width="${f1(sw * 0.6)}" d="M${f1(sx)} ${f1(py)} L${f1(sx - pr * 0.8)} ${f1(py + drop)} M${f1(sx)} ${f1(py)} L${f1(sx + pr * 0.8)} ${f1(py + drop)}"/>`
        + `<path class="ky-gf" d="M${f1(sx - pr)} ${f1(py + drop)} Q${f1(sx)} ${f1(py + drop + pr * 0.45)} ${f1(sx + pr)} ${f1(py + drop)} Z"/>${T(sx, py + drop + pr * 0.45 + cap * 1.2, cap, p.label, "ky-gt")}</g>`;
      return {
        html: `<path class="ky-gk" d="M${f1(cx - vh * 0.12)} ${f1(vh)} L${f1(cx)} ${f1(py)} L${f1(cx + vh * 0.12)} ${f1(vh)} Z" opacity=".35"/>`
          + `<line class="ky-gi ky-g-beam" stroke-width="${f1(sw)}" x1="${f1(cx - L)}" y1="${f1(py)}" x2="${f1(cx + L)}" y2="${f1(py)}"/>`
          + pan(cx - L, a, "ky-g-pa") + pan(cx + L, b, "ky-g-pb") + `<circle class="ky-gf" cx="${f1(cx)}" cy="${f1(py)}" r="${f1(sw * 1.4)}"/>`,
        anim(tl, q, qa, Tw, end) {
          const o = `${f1(cx)} ${f1(py)}`, seq = [[-ang * 0.5, 0.35], [ang * 1.35, 0.4], [ang * 0.85, 0.3], [ang, 0.3]];
          fade(tl, qa(".ky-g-pa, .ky-g-pb, .ky-g-beam"), Tw - 0.25, 0.25);
          let t = Tw;
          for (const [a2, d] of seq) {
            const yy = L * Math.sin((a2 * Math.PI) / 180);
            tl.to(q(".ky-g-beam"), { rotation: a2, svgOrigin: o, duration: d, ease: "sine.inOut" }, t);
            tl.to(q(".ky-g-pa"), { y: -yy, duration: d, ease: "sine.inOut" }, t);
            tl.to(q(".ky-g-pb"), { y: yy, duration: d, ease: "sine.inOut" }, t);
            t += d;
          }
        },
      };
    },
    overlap(v, vw, vh, fs) {
      const [a, b] = partsOf(v, 2, 2), R = Math.min(vh * 0.46, vw * 0.24), cy = vh / 2, d = R * 0.65, ca = vw / 2 - d, cb = vw / 2 + d;
      const cap = Math.min(fit(a.label, R * 1.1, fs * 1.25, 0.44), fit(b.label, R * 1.1, fs * 1.25, 0.44)), id = `kyov${Math.round(vw)}${Math.round(vh)}`;
      return {
        html: `<clipPath id="${id}"><circle cx="${f1(ca)}" cy="${f1(cy)}" r="${f1(R)}"/></clipPath>`
          + `<g class="ky-g-ca"><circle class="ky-gsoft" cx="${f1(ca)}" cy="${f1(cy)}" r="${f1(R)}"/><circle class="ky-gi" cx="${f1(ca)}" cy="${f1(cy)}" r="${f1(R)}" stroke-width="2"/>${T(ca - R * 0.4, cy + cap * 0.35, cap, a.label, "ky-gt")}</g>`
          + `<g class="ky-g-cb"><circle class="ky-gsoft" cx="${f1(cb)}" cy="${f1(cy)}" r="${f1(R)}"/><circle class="ky-gi" cx="${f1(cb)}" cy="${f1(cy)}" r="${f1(R)}" stroke-width="2"/>${T(cb + R * 0.4, cy + cap * 0.35, cap, b.label, "ky-gt")}</g>`
          + `<circle class="ky-gf ky-g-mid" clip-path="url(#${id})" cx="${f1(cb)}" cy="${f1(cy)}" r="${f1(R)}" opacity="0"/>`
          + (v.label ? T(vw / 2, cy + fs * 0.35, fit(v.label, (2 * R - 2 * d) * 0.9, fs, 0.6), v.label, "ky-lbl ky-g-mtxt", "middle", 'style="fill:var(--markink, #111);fill-opacity:1;font-weight:700"') : ""),
        anim(tl, q, qa, Tw, end) {
          tl.fromTo(q(".ky-g-ca"), { x: -R * 0.9, opacity: 0 }, { x: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, Tw - 0.2);
          tl.fromTo(q(".ky-g-cb"), { x: R * 0.9, opacity: 0 }, { x: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, Tw - 0.2);
          tl.fromTo(q(".ky-g-mid"), { opacity: 0 }, { opacity: 0.95, duration: 0.3, ease: "power1.out" }, Tw + 0.4);
          if (q(".ky-g-mtxt")) fade(tl, q(".ky-g-mtxt"), Tw + 0.55);
        },
      };
    },
    fork(v, vw, vh, fs) {
      const [a, b] = partsOf(v, 2, 2), cx = vw / 2, sw = Math.max(5, vh * 0.05), split = vh * 0.55, ex = Math.min(vw * 0.32, vh * 0.9), ey = vh * 0.12;
      const fo = v.focus === 0 || v.focus === 1 ? v.focus : null, cap = Math.min(fit(a.label, vw * 0.3, fs * 1.3, 0.44), fit(b.label, vw * 0.3, fs * 1.3, 0.44));
      const br = (dir) => `M${f1(cx)} ${f1(split)} C${f1(cx)} ${f1(split - vh * 0.2)} ${f1(cx + dir * ex)} ${f1(ey + vh * 0.2)} ${f1(cx + dir * ex)} ${f1(ey)}`;
      return {
        html: P(`M${f1(cx)} ${f1(vh)} V${f1(split)}`, "ky-gi ky-g-stem", sw)
          + P(br(-1), fo === 0 ? "ky-ga ky-g-br" : fo === 1 ? "ky-gi-soft ky-g-br" : "ky-gi ky-g-br", sw)
          + P(br(1), fo === 1 ? "ky-ga ky-g-br" : fo === 0 ? "ky-gi-soft ky-g-br" : "ky-gi ky-g-br", sw)
          + T(cx - ex, ey - cap * 0.6, cap, a.label, fo === 0 ? "ky-gt ky-gt-hi ky-g-lab" : "ky-gt ky-g-lab")
          + T(cx + ex, ey - cap * 0.6, cap, b.label, fo === 1 ? "ky-gt ky-gt-hi ky-g-lab" : "ky-gt ky-g-lab"),
        anim(tl, q, qa, Tw, end) {
          draw(tl, q(".ky-g-stem"), Tw - 0.25, 0.3, "power1.in");
          draw(tl, qa(".ky-g-br"), Tw + 0.05, 0.45, "power1.out");
          fade(tl, qa(".ky-g-lab"), Tw + 0.4, 0.3, 0.1);
        },
      };
    },

    // ------------------------------------------------------------ moments of the conversation
    said(v, vw, vh, fs) {
      const txt = v.label || "…", bw = Math.min(vw * 0.9, vh * 2.6), bh = vh * 0.66, x = (vw - bw) / 2, y = vh * 0.02, r = bh * 0.3;
      const size = fit(txt, bw * 0.86, bh * 0.42, 0.42);
      return {
        html: `<g class="ky-g-bub"><path class="ky-gpanel" stroke-width="2" d="M${f1(x + r)} ${f1(y)} H${f1(x + bw - r)} Q${f1(x + bw)} ${f1(y)} ${f1(x + bw)} ${f1(y + r)} V${f1(y + bh - r)} Q${f1(x + bw)} ${f1(y + bh)} ${f1(x + bw - r)} ${f1(y + bh)} H${f1(x + bw * 0.3)} L${f1(x + bw * 0.16)} ${f1(y + bh + vh * 0.26)} L${f1(x + bw * 0.2)} ${f1(y + bh)} H${f1(x + r)} Q${f1(x)} ${f1(y + bh)} ${f1(x)} ${f1(y + bh - r)} V${f1(y + r)} Q${f1(x)} ${f1(y)} ${f1(x + r)} ${f1(y)} Z"/>`
          + T(vw / 2, y + bh / 2 + size * 0.32, size, `„${txt}“`, "ky-gtxt") + `</g>`
          + (v.unit ? T(x + bw * 0.3, y + bh + vh * 0.2, fs * 0.95, v.unit.toUpperCase(), "ky-lbl ky-g-who", "start") : ""),
        anim(tl, q, qa, Tw, end) {
          tl.fromTo(q(".ky-g-bub"), { scale: 0, opacity: 0, transformOrigin: "18% 100%" }, { scale: 1, opacity: 1, duration: 0.4, ease: "back.out(2.2)" }, Tw - 0.15);
          if (q(".ky-g-who")) fade(tl, q(".ky-g-who"), Tw + 0.2);
        },
      };
    },
    thought(v, vw, vh, fs) {
      const txt = v.label || "", cw = Math.min(vw * 0.8, vh * 2.2), ch = vh * 0.6, cx = vw / 2, cy = ch / 2 + vh * 0.02, size = txt ? fit(txt, cw * 0.72, ch * 0.32, 0.42) : 0;
      const puffs = Array.from({ length: 9 }, (_, k) => { const a = (k / 9) * Math.PI * 2; return `<ellipse cx="${f1(cx + cw * 0.4 * Math.cos(a))}" cy="${f1(cy + ch * 0.36 * Math.sin(a))}" rx="${f1(cw * 0.16)}" ry="${f1(ch * 0.24)}"/>`; }).join("");
      return {
        html: `<g class="ky-g-cloud"><g class="ky-gpanel" style="stroke:none;fill-opacity:.16">${puffs}<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(cw * 0.42)}" ry="${f1(ch * 0.38)}"/></g>`
          + (txt ? T(cx, cy + size * 0.32, size, txt, "ky-gtxt") : [-1, 0, 1].map((k) => `<circle class="ky-gk ky-g-dot3" cx="${f1(cx + k * ch * 0.18)}" cy="${f1(cy)}" r="${f1(ch * 0.06)}"/>`).join("")) + `</g>`
          + [0.07, 0.045, 0.03].map((s, k) => `<circle class="ky-gsoft ky-g-trail" style="fill-opacity:.3" cx="${f1(cx - cw * (0.22 + k * 0.07))}" cy="${f1(ch + vh * (0.08 + k * 0.1))}" r="${f1(vh * s)}"/>`).reverse().join(""),
        anim(tl, q, qa, Tw, end) {
          pop(tl, qa(".ky-g-trail"), Tw - 0.3, 0.2, "back.out(2)", 0.1);
          tl.fromTo(q(".ky-g-cloud"), { scale: 0, opacity: 0, transformOrigin: "30% 90%" }, { scale: 1, opacity: 1, duration: 0.4, ease: "back.out(1.8)" }, Tw);
          qa(".ky-g-dot3").forEach((d, k) => tl.fromTo(d, { opacity: 0.2 }, { opacity: 1, duration: 0.2, yoyo: true, repeat: 5, ease: "sine.inOut" }, Tw + 0.4 + k * 0.15));
        },
      };
    },
    verdict(v, vw, vh, fs) {
      const ok = v.value !== 0, R = vh * 0.44, { cx, x0, tw } = side(vw, vh, R), cy = vh / 2, sw = R * 0.18;
      const mark = ok ? `M${f1(cx - R * 0.48)} ${f1(cy + R * 0.02)} L${f1(cx - R * 0.12)} ${f1(cy + R * 0.38)} L${f1(cx + R * 0.52)} ${f1(cy - R * 0.4)}`
        : `M${f1(cx - R * 0.4)} ${f1(cy - R * 0.4)} L${f1(cx + R * 0.4)} ${f1(cy + R * 0.4)} M${f1(cx + R * 0.4)} ${f1(cy - R * 0.4)} L${f1(cx - R * 0.4)} ${f1(cy + R * 0.4)}`;
      const txt = v.label || "", big = txt ? fit(txt, tw, vh * 0.46, 0.44) : 0;
      return {
        html: `<g class="ky-g-stamp"><circle class="${ok ? "ky-ga" : "ky-gbad"}" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(R)}" stroke-width="${f1(sw * 0.45)}"/></g>`
          + P(mark, ok ? "ky-ga ky-g-mark" : "ky-gbad ky-g-mark", sw)
          + (txt ? T(x0, cy + big * 0.35, big, txt, ok ? "ky-gt ky-gt-hi ky-g-txt" : "ky-gt ky-g-txt", "start", ok ? "" : 'style="fill:#ff5a4f"') : ""),
        anim(tl, q, qa, Tw, end) {
          tl.fromTo(q(".ky-g-stamp"), { scale: 1.8, opacity: 0, transformOrigin: "50% 50%" }, { scale: 1, opacity: 1, duration: 0.25, ease: "power4.in" }, Tw - 0.15);
          draw(tl, q(".ky-g-mark"), Tw + 0.1, 0.35, "power2.out");
          if (q(".ky-g-txt")) tl.fromTo(q(".ky-g-txt"), { opacity: 0, x: -12 }, { opacity: 1, x: 0, duration: 0.3, ease: "power2.out" }, Tw + 0.3);
        },
      };
    },
    warning(v, vw, vh, fs) {
      const R = vh * 0.5, { cx, x0, tw } = side(vw, vh, R * 0.95), top = vh * 0.04, bot = vh * 0.96, sw = Math.max(4, R * 0.1);
      const tri = `M${f1(cx)} ${f1(top)} L${f1(cx + R)} ${f1(bot)} L${f1(cx - R)} ${f1(bot)} Z`;
      const txt = v.label || "", big = txt ? fit(txt, tw, vh * 0.46, 0.44) : 0;
      return {
        html: `<g class="ky-g-sign"><path class="ky-gf" d="${tri}" opacity=".2"/><path class="ky-ga" d="${tri}" stroke-width="${f1(sw)}"/>`
          + `<rect class="ky-gf" x="${f1(cx - sw * 0.6)}" y="${f1(top + (bot - top) * 0.32)}" width="${f1(sw * 1.2)}" height="${f1((bot - top) * 0.36)}" rx="${f1(sw * 0.5)}"/>`
          + `<circle class="ky-gf" cx="${f1(cx)}" cy="${f1(top + (bot - top) * 0.8)}" r="${f1(sw * 0.75)}"/></g>`
          + (txt ? T(x0, vh / 2 + big * 0.35, big, txt, "ky-gt ky-gt-hi ky-g-txt", "start") : ""),
        anim(tl, q, qa, Tw, end) {
          pop(tl, q(".ky-g-sign"), Tw - 0.15, 0.3);
          [0.2, 1, 0.2, 1].forEach((o, k) => tl.to(q(".ky-g-sign"), { opacity: o, duration: 0.01 }, Tw + 0.3 + k * 0.16));
          if (q(".ky-g-txt")) fade(tl, q(".ky-g-txt"), Tw + 0.25, 0.25);
        },
      };
    },
    notify(v, vw, vh, fs) {
      const cw = Math.min(vw * 0.94, vh * 3.6), ch = vh * 0.62, x = (vw - cw) / 2, y = vh * 0.18, ic = ch * 0.5, msg = v.label || "", app = (v.unit || (DE ? "Nachricht" : "Message")).toUpperCase();
      const size = fit(msg, cw - ic - ch * 0.55, ch * 0.3, 0.42);
      return {
        html: `<g class="ky-g-card"><rect class="ky-gpanel" x="${f1(x)}" y="${f1(y)}" width="${f1(cw)}" height="${f1(ch)}" rx="${f1(ch * 0.22)}" stroke-width="2"/>`
          + `<rect class="ky-gf" x="${f1(x + ch * 0.2)}" y="${f1(y + (ch - ic) / 2)}" width="${f1(ic)}" height="${f1(ic)}" rx="${f1(ic * 0.24)}"/>`
          + `<path class="ky-gi" stroke-width="${f1(ic * 0.07)}" style="stroke:var(--markink, #111)" d="M${f1(x + ch * 0.2 + ic * 0.22)} ${f1(y + ch / 2 - ic * 0.12)} L${f1(x + ch * 0.2 + ic * 0.5)} ${f1(y + ch / 2 + ic * 0.08)} L${f1(x + ch * 0.2 + ic * 0.78)} ${f1(y + ch / 2 - ic * 0.12)}"/>`
          + T(x + ch * 0.35 + ic, y + ch * 0.36, Math.min(fs * 0.85, ch * 0.2), app, "ky-lbl", "start")
          + T(x + ch * 0.35 + ic, y + ch * 0.36 + size * 1.25, size, msg, "ky-gtxt", "start") + `</g>`,
        anim(tl, q, qa, Tw, end) {
          tl.fromTo(q(".ky-g-card"), { y: -vh * 0.5, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "back.out(1.5)" }, Tw - 0.2);
          for (let k = 0; k < 6; k++) tl.to(q(".ky-g-card"), { x: k === 5 ? 0 : k % 2 ? -4 : 4, duration: 0.04, ease: "none" }, Tw + 0.35 + k * 0.04 + (k > 2 ? 0.12 : 0));
        },
      };
    },

    // ------------------------------------------------------------ pictures
    target(v, vw, vh, fs) {
      const R = vh * 0.46, { cx, x0, tw } = side(vw, vh, R), cy = vh / 2, sw = Math.max(3, R * 0.05);
      const txt = v.label || "", big = txt ? fit(txt, tw, vh * 0.42, 0.44) : 0;
      return {
        html: `<g class="ky-g-board">${[1, 0.68, 0.36].map((k, j) => `<circle class="${j % 2 ? "ky-gsoft" : "ky-gpanel"}" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(R * k)}" stroke-width="2"/>`).join("")}<circle class="ky-gf" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(R * 0.14)}"/></g>`
          + `<g class="ky-g-arrow"><line class="ky-gi" stroke-width="${f1(sw)}" x1="${f1(cx)}" y1="${f1(cy)}" x2="${f1(cx + R * 0.9)}" y2="${f1(cy - R * 0.9)}"/>`
          + `<path class="ky-gf" d="M${f1(cx + R * 0.72)} ${f1(cy - R * 0.94)} L${f1(cx + R * 0.98)} ${f1(cy - R * 1.12)} L${f1(cx + R * 0.94)} ${f1(cy - R * 0.86)} Z"/></g>`
          + (txt ? T(x0 + R * 0.2, cy + big * 0.35, big, txt, "ky-gt ky-gt-hi ky-g-txt", "start") : ""),
        anim(tl, q, qa, Tw, end) {
          pop(tl, q(".ky-g-board"), Tw - 0.25, 0.3);
          tl.fromTo(q(".ky-g-arrow"), { x: R * 1.6, y: -R * 1.6, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.3, ease: "power3.in" }, Tw + 0.05);
          tl.fromTo(q(".ky-g-board"), { x: 0 }, { x: 4, duration: 0.04, yoyo: true, repeat: 3, ease: "none" }, Tw + 0.35);
          if (q(".ky-g-txt")) fade(tl, q(".ky-g-txt"), Tw + 0.35);
        },
      };
    },
    lock(v, vw, vh, fs) {
      const closes = v.value !== 0, bh = vh * 0.5, bw = bh * 1.15, R = bw / 2, { cx, x0, tw } = side(vw, vh, R), by = vh * 0.46, sw = bw * 0.13;
      const shackle = `M${f1(cx - bw * 0.3)} ${f1(by)} V${f1(by - bh * 0.3)} A${f1(bw * 0.3)} ${f1(bw * 0.3)} 0 0 1 ${f1(cx + bw * 0.3)} ${f1(by - bh * 0.3)} V${f1(by)}`;
      const txt = v.label || "", big = txt ? fit(txt, tw, vh * 0.42, 0.44) : 0, lift = bh * 0.32;
      return {
        html: `<path class="ky-gi ky-g-shackle" stroke-width="${f1(sw)}" d="${shackle}"/>`
          + `<rect class="ky-gf ky-g-body" x="${f1(cx - bw / 2)}" y="${f1(by)}" width="${f1(bw)}" height="${f1(bh)}" rx="${f1(bw * 0.14)}"/>`
          + `<circle class="ky-gk" style="fill:var(--markink, #111)" cx="${f1(cx)}" cy="${f1(by + bh * 0.42)}" r="${f1(bw * 0.09)}"/>`
          + (txt ? T(x0, vh / 2 + big * 0.35, big, txt, "ky-gt ky-gt-hi ky-g-txt", "start") : ""),
        anim(tl, q, qa, Tw, end) {
          pop(tl, qa(".ky-g-body"), Tw - 0.25, 0.3);
          tl.fromTo(q(".ky-g-shackle"), { y: closes ? -lift : 0, opacity: 0 }, { y: closes ? -lift : 0, opacity: 1, duration: 0.15 }, Tw - 0.2);
          tl.to(q(".ky-g-shackle"), { y: closes ? 0 : -lift, rotation: closes ? 0 : -18, svgOrigin: `${f1(cx + bw * 0.3)} ${f1(by)}`, duration: 0.2, ease: closes ? "power4.in" : "back.out(2)" }, Tw + 0.25);
          tl.fromTo(q(".ky-g-body"), { scale: 1, transformOrigin: "50% 50%" }, { scale: 1.06, duration: 0.07, yoyo: true, repeat: 1 }, Tw + 0.45);
          if (q(".ky-g-txt")) fade(tl, q(".ky-g-txt"), Tw + 0.45);
        },
      };
    },
    search(v, vw, vh, fs) {
      const txt = v.label || "", bw = vw * 0.94, bh = vh * 0.5, x = (vw - bw) / 2, y = (vh - bh) / 2, R = bh * 0.22, mx = x + bh * 0.55, my = y + bh / 2;
      const size = fit(txt, bw - bh * 1.4, bh * 0.42, 0.42);
      return {
        html: `<rect class="ky-gpanel" x="${f1(x)}" y="${f1(y)}" width="${f1(bw)}" height="${f1(bh)}" rx="${f1(bh / 2)}" stroke-width="2"/>`
          + `<g class="ky-g-lens"><circle class="ky-ga" cx="${f1(mx - R * 0.2)}" cy="${f1(my - R * 0.2)}" r="${f1(R)}" stroke-width="${f1(R * 0.3)}"/><line class="ky-ga" stroke-width="${f1(R * 0.34)}" x1="${f1(mx + R * 0.5)}" y1="${f1(my + R * 0.5)}" x2="${f1(mx + R * 1.1)}" y2="${f1(my + R * 1.1)}"/></g>`
          + T(x + bh * 1.1, my + size * 0.33, size, "", "ky-gtxt ky-g-typed", "start")
          + `<rect class="ky-gf ky-g-caret" x="${f1(x + bh * 1.1)}" y="${f1(my - size * 0.45)}" width="${f1(Math.max(2, size * 0.07))}" height="${f1(size * 0.9)}" opacity="0"/>`,
        anim(tl, q, qa, Tw, end) {
          const typed = q(".ky-g-typed"), caret = q(".ky-g-caret"), n = txt.length, step = clamp((clamp(end - Tw, 0.6, 1.6) * 0.7) / Math.max(1, n), 0.03, 0.08);
          tl.fromTo(caret, { opacity: 0 }, { opacity: 1, duration: 0.01 }, Tw - 0.2);
          for (let k = 1; k <= n; k++) {
            tl.set(typed, { textContent: txt.slice(0, k) + "​" }, Tw + k * step);
            // the caret follows the text, measured when the frame is drawn
            tl.set(caret, { attr: { x: () => x + bh * 1.1 + (typed.getComputedTextLength ? typed.getComputedTextLength() : 0) + 3 } }, Tw + k * step + 0.001);
          }
          tl.fromTo(q(".ky-g-lens"), { scale: 1, transformOrigin: "50% 50%" }, { scale: 1.25, duration: 0.15, yoyo: true, repeat: 1, ease: "power2.out" }, Tw + n * step + 0.1);
        },
      };
    },
    puzzle(v, vw, vh, fs) {
      const [a, b] = partsOf(v, 2, 2), s = Math.min(vh * 0.8, vw * 0.36), y = (vh - s) / 2, k = s * 0.18, cx = vw / 2;
      // A: square with a knob out on its right; B: square with the matching hole on its left
      const knob = (x) => `L${f1(x)} ${f1(y + s * 0.35)} C${f1(x + k * 1.6)} ${f1(y + s * 0.2)} ${f1(x + k * 1.6)} ${f1(y + s * 0.8)} ${f1(x)} ${f1(y + s * 0.65)}`;
      const pa = `M${f1(cx - s)} ${f1(y)} H${f1(cx)} ${knob(cx)} L${f1(cx)} ${f1(y + s)} H${f1(cx - s)} Z`;
      const pbFixed = `M${f1(cx)} ${f1(y)} H${f1(cx + s)} V${f1(y + s)} H${f1(cx)} L${f1(cx)} ${f1(y + s * 0.65)} C${f1(cx + k * 1.6)} ${f1(y + s * 0.8)} ${f1(cx + k * 1.6)} ${f1(y + s * 0.2)} ${f1(cx)} ${f1(y + s * 0.35)} Z`;
      const cap = Math.min(fit(a.label, s * 0.8, fs * 1.3, 0.44), fit(b.label, s * 0.8, fs * 1.3, 0.44));
      return {
        html: `<g class="ky-g-pa"><path class="ky-gsoft" style="fill-opacity:.3" d="${pa}"/><path class="ky-gi" stroke-width="2" d="${pa}"/>${T(cx - s / 2, y + s / 2 + cap * 0.35, cap, a.label, "ky-gt")}</g>`
          + `<g class="ky-g-pb"><path class="ky-gf" d="${pbFixed}"/>${T(cx + s / 2 + k * 0.6, y + s / 2 + cap * 0.35, cap, b.label, "ky-gt", "middle", 'style="fill:var(--markink, #111)"')}</g>`,
        anim(tl, q, qa, Tw, end) {
          tl.fromTo(q(".ky-g-pa"), { x: -s * 0.5, rotation: -8, opacity: 0, transformOrigin: "50% 50%" }, { x: -s * 0.08, rotation: 0, opacity: 1, duration: 0.4, ease: "power2.out" }, Tw - 0.2);
          tl.fromTo(q(".ky-g-pb"), { x: s * 0.5, rotation: 8, opacity: 0, transformOrigin: "50% 50%" }, { x: s * 0.08, rotation: 0, opacity: 1, duration: 0.4, ease: "power2.out" }, Tw - 0.15);
          tl.to(q(".ky-g-pa"), { x: 0, duration: 0.14, ease: "power4.in" }, Tw + 0.35);
          tl.to(q(".ky-g-pb"), { x: 0, duration: 0.14, ease: "power4.in" }, Tw + 0.35);
          tl.fromTo(qa(".ky-g-pa, .ky-g-pb"), { scale: 1 }, { scale: 1.04, duration: 0.06, yoyo: true, repeat: 1, transformOrigin: "50% 50%" }, Tw + 0.49);
        },
      };
    },
    summit(v, vw, vh, fs) {
      const w = Math.min(vw * 0.7, vh * 1.8), x0 = (vw - w) / 2, base = vh * 0.96, px = x0 + w * 0.55, py = vh * 0.2, sw = Math.max(3, fs * 0.16);
      const ridge = `M${f1(x0)} ${f1(base)} L${f1(x0 + w * 0.22)} ${f1(vh * 0.55)} L${f1(x0 + w * 0.34)} ${f1(vh * 0.66)} L${f1(px)} ${f1(py)} L${f1(x0 + w * 0.78)} ${f1(vh * 0.6)} L${f1(x0 + w)} ${f1(base)}`;
      const txt = v.label || "", cap = txt ? fit(txt, vw * 0.4, fs * 1.4, 0.44) : 0, fh = vh * 0.18;
      return {
        html: `<path class="ky-gsoft" d="${ridge} Z"/>` + P(ridge, "ky-gi ky-g-ridge", sw)
          + `<g class="ky-g-flag"><line class="ky-gi" stroke-width="${f1(sw * 0.7)}" x1="${f1(px)}" y1="${f1(py)}" x2="${f1(px)}" y2="${f1(py - fh * 1.3)}"/><path class="ky-gf ky-g-cloth" d="M${f1(px)} ${f1(py - fh * 1.3)} L${f1(px + fh)} ${f1(py - fh * 1.0)} L${f1(px)} ${f1(py - fh * 0.7)} Z"/></g>`
          + (txt ? T(px + fh * 1.3, py - fh * 0.85 + cap * 0.35, cap, txt, "ky-gt ky-gt-hi ky-g-txt", "start") : ""),
        anim(tl, q, qa, Tw, end) {
          draw(tl, q(".ky-g-ridge"), Tw - 0.3, 0.6, "power1.inOut");
          tl.fromTo(q(".ky-g-flag"), { scaleY: 0, transformOrigin: "50% 100%" }, { scaleY: 1, duration: 0.3, ease: "back.out(2.5)" }, Tw + 0.3);
          tl.fromTo(q(".ky-g-cloth"), { skewY: 0 }, { skewY: 8, duration: 0.3, yoyo: true, repeat: 3, ease: "sine.inOut", transformOrigin: "0% 50%" }, Tw + 0.6);
          if (q(".ky-g-txt")) fade(tl, q(".ky-g-txt"), Tw + 0.5);
        },
      };
    },
    place(v, vw, vh, fs) {
      const cx = vw * 0.38, cy = vh * 0.8, pw = vh * 0.34, ph = vh * 0.62, txt = v.label || "", cap = txt ? fit(txt, vw * 0.5, vh * 0.34, 0.44) : 0;
      let dots = "";
      for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 14; gx++) {
        const x = vw * 0.04 + gx * vw * 0.07, y = vh * 0.15 + gy * vh * 0.18, d = Math.hypot((x - cx) / vw, (y - cy) / vh);
        if (d < 0.55) dots += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(Math.max(1.5, vh * 0.012))}"/>`;
      }
      const pin = `M${f1(cx)} ${f1(cy)} C${f1(cx - pw * 0.2)} ${f1(cy - ph * 0.35)} ${f1(cx - pw / 2)} ${f1(cy - ph * 0.55)} ${f1(cx - pw / 2)} ${f1(cy - ph * 0.72)} A${f1(pw / 2)} ${f1(pw / 2)} 0 1 1 ${f1(cx + pw / 2)} ${f1(cy - ph * 0.72)} C${f1(cx + pw / 2)} ${f1(cy - ph * 0.55)} ${f1(cx + pw * 0.2)} ${f1(cy - ph * 0.35)} ${f1(cx)} ${f1(cy)} Z`;
      return {
        html: `<g class="ky-gsoft ky-g-map" style="fill-opacity:.35">${dots}</g>`
          + `<ellipse class="ky-ga ky-g-ring" cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(pw * 0.5)}" ry="${f1(pw * 0.16)}" stroke-width="2" opacity="0"/>`
          + `<g class="ky-g-pin"><path class="ky-gf" d="${pin}"/><circle class="ky-gk" style="fill:var(--markink, #111)" cx="${f1(cx)}" cy="${f1(cy - ph * 0.72)}" r="${f1(pw * 0.17)}"/></g>`
          + (txt ? T(cx + pw * 0.75, cy - ph * 0.55 + cap * 0.35, cap, txt, "ky-gt ky-gt-hi ky-g-txt", "start") : ""),
        anim(tl, q, qa, Tw, end) {
          fade(tl, q(".ky-g-map"), Tw - 0.3, 0.4);
          tl.fromTo(q(".ky-g-pin"), { y: -vh * 0.9, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "bounce.out" }, Tw - 0.05);
          tl.fromTo(q(".ky-g-ring"), { opacity: 0.9, scale: 0.3, transformOrigin: "50% 50%" }, { opacity: 0, scale: 2.2, duration: 0.7, ease: "power2.out" }, Tw + 0.2);
          if (q(".ky-g-txt")) tl.fromTo(q(".ky-g-txt"), { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.3, ease: "power2.out" }, Tw + 0.35);
        },
      };
    },
  };

  return {
    has: (kind) => kind in K,
    // fills svg with the graphic, returns what animate needs
    build(svg, viz, vw, vh, fs) {
      const g = K[viz.kind](viz, vw, vh, fs);
      svg.innerHTML = g.html;
      return { anim: g.anim, q: (s) => svg.querySelector(s), qa: (s) => Array.from(svg.querySelectorAll(s)) };
    },
    animate(tl, built, Tw, end) {
      built.anim(tl, built.q, built.qa, Tw, end);
    },
  };
}
