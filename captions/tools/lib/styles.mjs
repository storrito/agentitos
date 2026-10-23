// The caption styles: data, not code, so that a new look is a new entry here. Each says how the
// words are grouped (how many at once, where a group breaks), how they look and how they move.
// The fonts are those HyperFrames embeds by itself when it renders (Montserrat, Poppins, Inter,
// Oswald, League Gothic, Archivo Black, Outfit …); a brand's font comes from its DESIGN.md.
//
//   group:  words / chars at most per group; pause (s) from which a group breaks; minimum time on
//           screen (s); lines at most
//   look:   font, weight, size (px for a frame whose short side is 1080), case, colours, stroke,
//           shadow, box; gap (the room between words: the active word grows by `grow` into it)
//   motion: in (how a group or a word appears), active (how the word being said stands out),
//           out (how a group goes)

export const STYLES = {
  hormozi: {
    label: "Hormozi",
    about: "One to three words, big, bold and in capitals, the word being said in a bright colour: the punchy look of talking-head reels.",
    group: { words: 3, chars: 22, pause: 0.25, min: 0.5, lines: 2 },
    look: { font: "Montserrat", weight: 900, size: 96, case: "upper", color: "#FFFFFF", accent: "#FFE500", highlight: "#3CFF5A",
      stroke: 9, strokeColor: "#000000", shadow: "0 8px 0 rgba(0,0,0,0.85)", spacing: "0.01em", lineHeight: 1.05, gap: "0.32em", grow: 1.08 },
    motion: { in: "pop", active: "color-scale", out: "cut" },
  },
  karaoke: {
    label: "Karaoke pill",
    about: "Three or four words in a row; the word being said sits on a coloured pill, the others wait in white.",
    group: { words: 4, chars: 26, pause: 0.3, min: 0.7, lines: 2 },
    look: { font: "Poppins", weight: 800, size: 72, case: "none", color: "#FFFFFF", accent: "#7C3AED", highlight: "#FFE500",
      stroke: 0, strokeColor: "#000000", shadow: "0 4px 18px rgba(0,0,0,0.55)", spacing: "0", lineHeight: 1.15, pill: true },
    motion: { in: "rise", active: "pill", out: "fade" },
  },
  wipe: {
    label: "Wipe",
    about: "Up to four words in capitals, each wiped in as it is said; said words dim, key words turn gold (the look of Storrito's content workflow).",
    group: { words: 4, chars: 24, pause: 0.25, min: 0.6, lines: 2 },
    look: { font: "Poppins", weight: 800, size: 76, case: "upper", color: "#FFFFFF", accent: "#FFFFFF", highlight: "#FFD700", dim: "rgba(255,255,255,0.62)",
      stroke: 0, strokeColor: "#000000", shadow: "0 4px 0 rgba(0,0,0,0.82), 0 12px 30px rgba(0,0,0,0.78)", spacing: "0.02em", lineHeight: 1.08 },
    motion: { in: "wipe", active: "dim-after", out: "wipe" },
  },
  clean: {
    label: "Clean subtitles",
    about: "Whole phrases of up to two lines in sentence case on a soft dark box at the bottom: calm, readable, for explainers and interviews.",
    group: { words: 9, chars: 64, pause: 0.45, min: 1.0, lines: 2 },
    look: { font: "Inter", weight: 600, size: 52, case: "none", color: "#FFFFFF", accent: "#FFFFFF", highlight: "#FFE500",
      stroke: 0, strokeColor: "#000000", shadow: "none", spacing: "0", lineHeight: 1.3, box: "rgba(0,0,0,0.62)" },
    motion: { in: "fade", active: "none", out: "fade" },
  },
};

export function style(name) {
  const s = STYLES[name];
  if (!s) throw new Error(`There is no caption style "${name}"; there are ${Object.keys(STYLES).join(", ")}.`);
  return structuredClone(s);
}
