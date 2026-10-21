// Colours as numbers: parsing, contrast after WCAG, mixing, and grouping the colours a page
// shows into the few that make its look.

export function parse(value) {
  const s = String(value || "").trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map((v) => (v.endsWith("%") ? parseFloat(v) / 100 : Number(v)));
    return { r, g, b, a };
  }
  if (s === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (s === "black") return { r: 0, g: 0, b: 0, a: 1 };
  return null;
}

export const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();

const channel = (v) => {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export function luminance(c) {
  c = typeof c === "string" ? parse(c) : c;
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

export function mix(a, b, t) {
  a = typeof a === "string" ? parse(a) : a;
  b = typeof b === "string" ? parse(b) : b;
  return hex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
}

// the text colour that reads best on `bg`: white or the given dark one
export function onColor(bg, dark = "#111111", light = "#FFFFFF") {
  return contrast(bg, light) >= contrast(bg, dark) ? light : dark;
}

export function hsl(c) {
  c = typeof c === "string" ? parse(c) : c;
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

// a colour with a hue of its own, not a grey, not nearly white or black
export const chromatic = (c) => {
  const { s, l } = hsl(c);
  return s > 0.22 && l > 0.12 && l < 0.92;
};

// CIE76 distance in Lab: under ~12 two colours look the same at a glance
function lab(c) {
  c = typeof c === "string" ? parse(c) : c;
  const [r, g, b] = [channel(c.r), channel(c.g), channel(c.b)];
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export function distance(a, b) {
  const [l1, a1, b1] = lab(a), [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

// [{hex, weight, roles}] → the same, colours that look alike merged into the heaviest one
export function group(colors, near = 12) {
  const out = [];
  for (const c of [...colors].sort((a, b) => b.weight - a.weight)) {
    const same = out.find((o) => distance(o.hex, c.hex) < near);
    if (!same) { out.push({ hex: c.hex.toUpperCase(), weight: c.weight, roles: { ...c.roles } }); continue; }
    same.weight += c.weight;
    for (const [k, v] of Object.entries(c.roles || {})) same.roles[k] = (same.roles[k] || 0) + v;
  }
  return out;
}
