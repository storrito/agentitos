// Time signals derived from the plan, shared by the 3D world and the typography.
// Pure functions of time. Levels are pre-sampled into tables so per-frame cost
// stays tiny; phases are integrals of speed so motion stays continuous.

export const PALETTES = {
  //        deep        mid         accent      glow        ink (text)
  night:   ["#04050c", "#141a3e", "#8fa8ff", "#d6deff", "#f2f0ea"],
  dark:    ["#030304", "#131219", "#b9b2d0", "#7d7a92", "#e9e6ef"],
  dawn:    ["#0b0712", "#3b1f4f", "#ffb38a", "#ffe0c2", "#fff4ea"],
  electric:["#04030c", "#1d0b42", "#3ff2ff", "#ff4df0", "#f4fbff"],
  cool:    ["#03070d", "#0e2438", "#7fd4ff", "#d2f0ff", "#eef8ff"],
  ocean:   ["#020a10", "#073449", "#3fe0cc", "#b4fff4", "#effffc"],
  violet:  ["#07040f", "#2b1452", "#b48dff", "#ffd3ff", "#f8f1ff"],
  rose:    ["#0e0409", "#4c1029", "#ff5d8f", "#ffc6d6", "#fff1f4"],
  ember:   ["#0b0302", "#4d1407", "#ff7a2f", "#ffd38f", "#fff3e6"],
  gold:    ["#0b0803", "#4b3309", "#ffcf5a", "#fff2c6", "#fffaf0"],
};

// Each world has its own palette per mood – same keys, same 5 slots:
// [ground, ground shade, accent, glow / light accent, ink (text)].
// Light worlds (editorial, geometry) use a light ground and dark ink.
export const WORLDS = {
  cosmos: { light: false, palettes: PALETTES },
  aurora: {
    light: false,
    palettes: {
      night:    ["#0c0a2a", "#3a2a8f", "#7fd8ff", "#ffc2f0", "#ffffff"],
      dark:     ["#0d0c16", "#2c2b47", "#b9b4ff", "#e6e2ff", "#ffffff"],
      dawn:     ["#2a0f3a", "#c2457a", "#ffb36b", "#ffe3b8", "#ffffff"],
      electric: ["#0a0638", "#5b1fd1", "#00e5ff", "#ff5ad9", "#ffffff"],
      cool:     ["#071a3a", "#1f5fbf", "#8ad8ff", "#d6f3ff", "#ffffff"],
      ocean:    ["#032a33", "#0f8a8a", "#7dffe0", "#d4fff6", "#ffffff"],
      violet:   ["#1a0b45", "#7a3df0", "#ffa6f2", "#ffe0fb", "#ffffff"],
      rose:     ["#3a0a2a", "#e0457b", "#ffd166", "#ffe6ef", "#ffffff"],
      ember:    ["#3a0d05", "#e8541e", "#ffd166", "#fff0d6", "#ffffff"],
      gold:     ["#2e1c05", "#d99a1e", "#fff1a8", "#fffaf0", "#ffffff"],
    },
  },
  editorial: {
    light: true,
    palettes: {
      night:    ["#f3efe6", "#e4ddcf", "#1f3fbf", "#9fb0ec", "#14161c"],
      dark:     ["#ecebe8", "#d9d7d2", "#2b2b30", "#8d8c95", "#121214"],
      dawn:     ["#f6efe6", "#ead9c8", "#d9481e", "#f2b39a", "#1b1512"],
      electric: ["#eef1f2", "#d8e0e3", "#0047ff", "#7fa3ff", "#0d1220"],
      cool:     ["#eef2f4", "#d6e1e7", "#1f6f9f", "#9cc6dd", "#0f1a22"],
      ocean:    ["#eef3f0", "#d5e4dd", "#0d7a64", "#8fcfbf", "#0e1c18"],
      violet:   ["#f2eff5", "#e0d8ea", "#5b2bd1", "#b9a3f0", "#16121f"],
      rose:     ["#f7eeee", "#ecd6d8", "#d1234e", "#f0a3b4", "#1f1214"],
      ember:    ["#f7efe8", "#ecd8c6", "#e0480f", "#f5b08d", "#20140e"],
      gold:     ["#f6f1e2", "#e9dfc2", "#b07a00", "#e8cf8a", "#1d1709"],
    },
  },
  geometry: {
    light: true,
    palettes: {
      night:    ["#dfe4f2", "#c3cbe6", "#3b5bff", "#ffffff", "#141a33"],
      dark:     ["#e2e2e4", "#c7c7cc", "#3a3a44", "#ffffff", "#141418"],
      dawn:     ["#f6e2d8", "#eccab9", "#ff6a3d", "#ffffff", "#2a1610"],
      electric: ["#dfe9ff", "#c2d4ff", "#2f5bff", "#ff4fd8", "#0d1430"],
      cool:     ["#dcebf2", "#bcd8e6", "#1f7fbf", "#ffffff", "#0e1e29"],
      ocean:    ["#d9efe9", "#b8e0d6", "#0f9e83", "#ffffff", "#0b221d"],
      violet:   ["#e8e0f7", "#d3c4f0", "#7a3df0", "#ffffff", "#1b1230"],
      rose:     ["#f7dfe4", "#efc4cd", "#e8336b", "#ffffff", "#2a1218"],
      ember:    ["#f8e2d4", "#f0c7ad", "#f05a1a", "#ffffff", "#2a150a"],
      gold:     ["#f6ecd2", "#ecdcaa", "#e0a400", "#ffffff", "#271c05"],
    },
  },
};
// bokeh: warm, filmic dark grounds with soft out-of-focus lights; neon: near-black with
// saturated electric light lines. Both are dark, so they also work screened over footage.
WORLDS.bokeh = {
  light: false,
  palettes: {
    night:    ["#07070c", "#1d1a2a", "#9fb4ff", "#ffe0b8", "#f6f1ea"],
    dark:     ["#060506", "#181417", "#c9b9a8", "#8d8077", "#efe9e2"],
    dawn:     ["#0d0709", "#3a1d1f", "#ffb07a", "#ffe2bf", "#fff4ea"],
    electric: ["#07060d", "#24123a", "#8fd0ff", "#ff9ad5", "#f6f6ff"],
    cool:     ["#05080b", "#132430", "#8cc7e6", "#e2f2ff", "#eef6fb"],
    ocean:    ["#04090a", "#0f2b2c", "#6fd9c4", "#d6fff2", "#effcf8"],
    violet:   ["#08060c", "#2a1838", "#c7a3ff", "#ffd9f0", "#f8f2ff"],
    rose:     ["#0d0608", "#3d1520", "#ff8aa8", "#ffd7c2", "#fff2f2"],
    ember:    ["#0c0604", "#3e1a0a", "#ff9a4a", "#ffe0a6", "#fff4e8"],
    gold:     ["#0b0905", "#3a2c0e", "#ffcf6a", "#fff0c8", "#fffaf0"],
  },
};
WORLDS.neon = {
  light: false,
  palettes: {
    night:    ["#02030a", "#0b1240", "#4d8bff", "#7ff0ff", "#f2f6ff"],
    dark:     ["#020203", "#101016", "#a5a8c8", "#5ef2ff", "#eef0f6"],
    dawn:     ["#07030a", "#2a0b30", "#ff7a59", "#ffd04d", "#fff4ee"],
    electric: ["#020110", "#170a40", "#2ff6ff", "#ff3df2", "#f4fbff"],
    cool:     ["#01060c", "#062238", "#38c8ff", "#a8f3ff", "#eef8ff"],
    ocean:    ["#01080a", "#033038", "#14ffd0", "#7affff", "#effffc"],
    violet:   ["#05020d", "#200a4a", "#a35cff", "#ff7af0", "#f8f1ff"],
    rose:     ["#0b0207", "#3d0626", "#ff3d8b", "#ffb0e0", "#fff0f6"],
    ember:    ["#0a0200", "#3d0c00", "#ff5a14", "#ffd23d", "#fff3e6"],
    gold:     ["#080600", "#332300", "#ffc400", "#fff27a", "#fffaf0"],
  },
};
// noir: cool, desaturated grounds, pale light – crime, mystery, history, investigation
WORLDS.noir = {
  light: false,
  palettes: {
    night:    ["#030407", "#232a3a", "#9fb2d8", "#dfe6f2", "#f1f2f4"],
    dark:     ["#030303", "#232326", "#c2c0c8", "#8e8c96", "#ecebee"],
    dawn:     ["#060405", "#33282a", "#e8b49a", "#f4e2d4", "#f8f2ee"],
    electric: ["#030308", "#1e2238", "#8fd4ff", "#e1f2ff", "#f2f6fa"],
    cool:     ["#020406", "#1c2933", "#8fc0d8", "#dceef6", "#eef4f7"],
    ocean:    ["#020505", "#18292a", "#86cfc2", "#d8f2ec", "#eef6f4"],
    violet:   ["#040306", "#262036", "#b7a6dc", "#e8e0f6", "#f4f1f8"],
    rose:     ["#060304", "#33202a", "#e29aac", "#f4dde3", "#f8f0f2"],
    ember:    ["#060302", "#36231a", "#e8a070", "#f6dcc4", "#f8f1ea"],
    gold:     ["#050403", "#332c1c", "#e6c47a", "#f6ecd0", "#f9f6ee"],
  },
};
export const worldOf = (plan) => WORLDS[plan.world] || WORLDS.cosmos;
export const palettesOf = (plan) => worldOf(plan).palettes;

const MOTIFS = ["ascend", "rain", "embers", "sun", "stars", "fog", "shock", "lightning", "waves", "rings", "planet", "heartbeat", "shards", "grid", "warp", "clouds", "chart", "network"];
// transient motifs decay quickly after the word instead of sustaining to phrase end
const TRANSIENT = { shock: 0.55, lightning: 0.9, shards: 2.4 };

const RATE = 60;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
// palettes in linear-ish space for three.js, raw sRGB for CSS
const rgbOf = (pals) => Object.fromEntries(Object.entries(pals).map(([k, v]) => [k, v.map(hexToRgb)]));

export function createSignals(plan) {
  const PAL_RGB = rgbOf(palettesOf(plan));
  const N = Math.ceil(plan.duration * RATE) + 2;
  const tables = Object.fromEntries(MOTIFS.map((m) => [m, new Float32Array(N)]));
  const pulseT = new Float32Array(N), kickT = new Float32Array(N), glitchT = new Float32Array(N), flashT = new Float32Array(N);

  for (const ev of plan.events) {
    const tab = tables[ev.motif];
    if (!tab) continue;
    const tr = TRANSIENT[ev.motif];
    const i0 = Math.max(0, Math.floor((ev.t0 - 0.3) * RATE));
    const i1 = Math.min(N - 1, Math.ceil((tr ? ev.t0 + tr * 4 : ev.t1 + 1.8) * RATE));
    for (let i = i0; i <= i1; i++) {
      const t = i / RATE;
      let v;
      if (tr) v = t < ev.t0 ? smooth(ev.t0 - 0.06, ev.t0, t) : Math.exp(-(t - ev.t0) / tr);
      else v = smooth(ev.t0 - 0.2, ev.t0 + 0.55, t) * (1 - smooth(ev.t1, ev.t1 + 1.7, t));
      v *= ev.strength;
      if (v > tab[i]) tab[i] = v;
    }
    if (ev.concept === "electric") {
      for (let i = Math.max(0, Math.floor(ev.t0 * RATE)); i < Math.min(N, (ev.t0 + 0.7) * RATE); i++) {
        glitchT[i] = Math.max(glitchT[i], Math.exp(-(i / RATE - ev.t0) / 0.25));
      }
    }
  }
  // stars are always faintly present; dark scenes bring fog
  for (let i = 0; i < N; i++) tables.stars[i] = Math.max(tables.stars[i], 0.18);

  // the soft ripple behind a hero word only where its effect lands with a hit or a burst:
  // a whispered, fogged or opened word gets no shockwave
  const RIPPLE_FX = new Set(["slam", "shatter", "drop", "pulse", "glow"]);

  // rhythmic energy from word onsets
  // Fast speech has 3–4 words a second: pulsing on every one reads as a nervous zoom.
  // Every word only breathes a little; stressed words pulse, at most every 1.4 s;
  // the camera kick is reserved for hero words, at most every 2.4 s.
  const heroOnsets = [];
  let lastStrong = -9, lastKick = -9;
  for (const w of plan.words) {
    const strong = (w.hero || w.emphasis >= 0.65) && w.start - lastStrong >= 1.4;
    if (strong) lastStrong = w.start;
    const kick = w.hero && w.start - lastKick >= 2.4;
    if (kick) lastKick = w.start;
    const a = strong ? 0.3 + w.emphasis * 0.6 : 0.05 + w.emphasis * 0.1;
    const i0 = Math.floor(w.start * RATE);
    for (let i = i0; i < Math.min(N, i0 + RATE * 1.6); i++) {
      const dt = i / RATE - w.start;
      // a soft attack instead of a jump: the pulse swells in over ~80 ms
      const env = Math.min(1, dt / 0.08) * Math.exp(-dt * (strong ? 3.2 : 6));
      pulseT[i] = Math.max(pulseT[i], a * env);
      if (kick) kickT[i] = Math.max(kickT[i], Math.min(1, dt / 0.12) * Math.exp(-dt * 2.6));
    }
    if (w.hero && RIPPLE_FX.has(w.fx)) heroOnsets.push({ t: w.start, e: w.emphasis });
  }
  for (let i = 0; i < N; i++) flashT[i] = Math.max(tables.lightning[i] * 0.6 * ((i * 7) % 5 === 0 ? 1 : 0.35), tables.shock[i] * 0.5);

  // integrated phases
  const speed = {
    rain: (L) => 0.05 + 5.5 * L.rain,
    rise: (L) => 0.02 + 2.6 * Math.max(L.ascend, L.embers * 0.8),
    warp: (L) => 0.12 + 11 * L.warp + 1.6 * L.grid,
    swirl: (L) => 0.025 + 1.5 * L.rings + 0.35 * L.planet,
    ascend: (L) => 3 * L.ascend,
  };
  const phases = Object.fromEntries(Object.keys(speed).map((k) => [k, new Float32Array(N)]));
  const Lrow = {};
  for (let i = 1; i < N; i++) {
    for (const m of MOTIFS) Lrow[m] = tables[m][i];
    for (const k in speed) phases[k][i] = phases[k][i - 1] + speed[k](Lrow) / RATE;
  }

  const sample = (tab, t) => {
    const x = Math.max(0, Math.min(N - 1.001, t * RATE));
    const i = Math.floor(x), f = x - i;
    return tab[i] * (1 - f) + tab[i + 1] * f;
  };

  // pulses: love = double heartbeat, shock = one hard ring, hero = soft ripple
  const pulses = [];
  for (const ev of plan.events) {
    if (ev.motif === "heartbeat") { pulses.push({ t: ev.t0, amp: ev.strength, kind: 0 }, { t: ev.t0 + 0.3, amp: ev.strength * 0.7, kind: 0 }); }
    if (ev.motif === "shock") pulses.push({ t: ev.t0, amp: ev.strength * 0.8, kind: 1 });
  }
  for (const h of heroOnsets) if (h.e >= 0.8 && !pulses.some((p) => Math.abs(p.t - h.t) < 0.6)) pulses.push({ t: h.t, amp: 0.16, kind: 0.4 });
  pulses.sort((a, b) => a.t - b.t);
  // calmer presets (podcast) get quieter rings
  const presence = plan.style?.world ?? 1;
  for (const p of pulses) p.amp *= Math.min(1, presence * 1.2);

  // onset times per motif, for motifs that "build" from their first appearance (chart)
  const starts = {};
  for (const ev of plan.events) (starts[ev.motif] ||= []).push(ev.t0);
  for (const k in starts) starts[k].sort((a, b) => a - b);

  return {
    // seconds since the current run of a motif began (a run = events closer than 2.5 s)
    since(motif, t) {
      const st = starts[motif];
      if (!st) return Infinity;
      let run = null;
      for (let i = 0; i < st.length && st[i] <= t; i++) if (run === null || st[i] - st[i - 1] > 2.5) run = st[i];
      return run === null ? Infinity : t - run;
    },
    levels(t) {
      const L = {};
      for (const m of MOTIFS) L[m] = sample(tables[m], t);
      L.pulse = sample(pulseT, t);
      L.kick = sample(kickT, t);
      L.glitch = sample(glitchT, t);
      L.flash = sample(flashT, t);
      L.spin = L.rings;
      return L;
    },
    phase(name, t) { return sample(phases[name], t); },
    pulses(t, max) {
      const live = pulses.filter((p) => p.t <= t && t - p.t < 3);
      return live.slice(-max);
    },
    // palette at time t, crossfaded between moods (1.2 s)
    paletteRGB(t) {
      const mt = plan.moodTrack;
      let i = 0;
      while (i + 1 < mt.length && mt[i + 1].t <= t) i++;
      const cur = PAL_RGB[mt[i].mood] || PAL_RGB.night;
      const prev = i > 0 ? PAL_RGB[mt[i - 1].mood] || PAL_RGB.night : cur;
      // aurora mixes saturated, often complementary fields: a long blend passes through grey
      const len = plan.world === "aurora" ? 0.45 : 1.05;
      const k = i > 0 ? smooth(mt[i].t - 0.15, mt[i].t + len, t) : 1;
      return cur.map((c, j) => c.map((v, n) => prev[j][n] * (1 - k) + v * k));
    },
    palette(t, out) {
      const p = this.paletteRGB(t);
      out.c0.setRGB(...p[0], "srgb"); out.c1.setRGB(...p[1], "srgb"); out.c2.setRGB(...p[2], "srgb"); out.c3.setRGB(...p[3], "srgb");
    },
  };
}
