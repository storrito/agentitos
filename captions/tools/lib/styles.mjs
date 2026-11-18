// The caption styles: data, not code, so that a new look is a new entry here. Each says how the
// words are grouped (how many at once, where a group breaks), how they look and how they move.
// The fonts are those HyperFrames embeds by itself when it renders (Montserrat, Poppins, Inter,
// Oswald, League Gothic, Archivo Black, Outfit …); a brand's font comes from its DESIGN.md.
//
//   group:  words / chars at most per group; pause (s) from which a group breaks; minimum time on
//           screen (s); lines at most; gap (s between a group's end and the next one's start:
//           0 in a style that is cut in and cut out, else a frame may show no caption); even
//           (a phrase too long for one group is cut by length, not into equal counts of words:
//           fewer words left alone; every style of up to five words. The two that set whole
//           phrases, clean and subtitle, gain nothing by it and keep the equal counts)
//   look:   font, weight, size (px for a frame whose short side is 1080), case, colours, stroke,
//           shadow, box; gap (the room between words: the active word grows by `grow` into it)
//           color: the words; accent: the word being said (a brand's primary colour replaces
//           it); highlight: the key words; wait: the words not yet said (active "fill")
//           lineBox: the colour of a box each line has for itself, with linePad ([above and
//           below, left and right] in em) and lineRadius
//           keyFont, keyWeight, keyItalic, keyScale: the key words in another typeface, larger
//           groupKey: a caption that holds a key word stands whole in the key colour
//           brand: which colour takes a brand's primary: "accent" (the default: the word being
//           said), "key" (the key words, in a style where no word lights up), "both"
//           ownFont: the style is its typeface; a brand gives it its colour, never its font
//   motion: in (how a group or a word appears: punch, rise, fade, wipe, cut; a group never
//           starts transparent and at a smaller size both: a frame would show no caption), active (how the word
//           being said stands out: color-scale, pill, dim-after, fill, none), out (how a group
//           goes: fade, wipe, cut)
//
// Where the looks come from: 198 published Shorts with captions (talking heads, podcast clips,
// screens with a face, narrated explainers; 2026-11-17), each one's captions classed by look.
// references/styles.md has the counts and says which style fits which video.
//
// A style's font and weight have their characters' widths in widths.mjs (for captions the caller
// placed: whether a group fits its lines): measure a new font there.

export const STYLES = {
  hormozi: {
    label: "Hormozi",
    about: "One to three words, big, bold and in capitals, the word being said in a bright colour: the punchy look of talking-head reels.",
    group: { words: 3, chars: 22, pause: 0.25, min: 0.5, lines: 2, gap: 0, even: true },
    look: { font: "Montserrat", weight: 900, size: 96, case: "upper", color: "#FFFFFF", accent: "#FFE500", highlight: "#3CFF5A",
      stroke: 9, strokeColor: "#000000", shadow: "0 8px 0 rgba(0,0,0,0.85)", spacing: "0.01em", lineHeight: 1.05, gap: "0.32em", grow: 1.08 },
    motion: { in: "punch", active: "color-scale", out: "cut" },
  },
  karaoke: {
    label: "Karaoke pill",
    about: "Three or four words in a row; the word being said sits on a coloured pill, the others wait in white.",
    group: { words: 4, chars: 26, pause: 0.3, min: 0.7, lines: 2, even: true },
    look: { font: "Poppins", weight: 800, size: 72, case: "none", color: "#FFFFFF", accent: "#7C3AED", highlight: "#FFE500",
      stroke: 0, strokeColor: "#000000", shadow: "0 4px 18px rgba(0,0,0,0.55)", spacing: "0", lineHeight: 1.15, pill: true },
    motion: { in: "rise", active: "pill", out: "fade" },
  },
  wipe: {
    label: "Wipe",
    about: "Up to four words in capitals, each wiped in as it is said; said words dim, key words turn gold (the look of Storrito's content workflow).",
    group: { words: 4, chars: 24, pause: 0.25, min: 0.6, lines: 2, even: true },
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
  bold: {
    label: "Bold words",
    about: "Two or three bold words in sentence case, white with a soft shadow, nothing behind them and nothing moving; key words in colour. What most podcast clips and talking heads carry.",
    group: { words: 3, chars: 20, pause: 0.25, min: 0.5, lines: 2, gap: 0, even: true },
    look: { font: "Montserrat", weight: 700, size: 66, case: "none", color: "#FFFFFF", accent: "#FFFFFF", highlight: "#FFE500",
      stroke: 0, strokeColor: "#000000", shadow: "0 2px 4px rgba(0,0,0,0.8), 0 0 12px rgba(0,0,0,0.5), 0 0 28px rgba(0,0,0,0.4)", spacing: "0", lineHeight: 1.15, gap: "0", brand: "key" },
    motion: { in: "cut", active: "none", out: "cut" },
  },
  outline: {
    label: "Outline",
    about: "One to three heavy words in sentence case, white with a thick black outline and a drop shadow, key words in colour; each caption punches in, no word lights up. Reads on any picture: maps, games, screen recordings.",
    group: { words: 3, chars: 20, pause: 0.25, min: 0.5, lines: 2, gap: 0, even: true },
    look: { font: "Montserrat", weight: 900, size: 72, case: "none", color: "#FFFFFF", accent: "#FFFFFF", highlight: "#FFE500",
      stroke: 13, strokeColor: "#000000", shadow: "0 6px 0 rgba(0,0,0,0.9)", spacing: "0", lineHeight: 1.16, gap: "0.04em", brand: "key" },
    motion: { in: "punch", active: "none", out: "cut" },
  },
  impact: {
    label: "Impact",
    about: "Two or three words in tall narrow capitals with a dark edge; a caption that holds a key word stands whole in lime, the others in white. The look of sports and podcast clips.",
    group: { words: 3, chars: 18, pause: 0.25, min: 0.5, lines: 2, gap: 0, even: true },
    look: { font: "League Gothic", weight: 400, size: 100, case: "upper", color: "#FFFFFF", accent: "#C8FF1A", highlight: "#C8FF1A", groupKey: true,
      stroke: 6, strokeColor: "#000000", shadow: "0 5px 0 rgba(0,0,0,0.75), 0 8px 22px rgba(0,0,0,0.55)", spacing: "0.02em", lineHeight: 1.02, gap: "0.04em", brand: "key", ownFont: true },
    motion: { in: "cut", active: "none", out: "cut" },
  },
  single: {
    label: "One word",
    about: "One word at a time, big and heavy, punching in the moment it is said; key words in colour. Fast and loud, for hooks and quick cuts.",
    group: { words: 1, chars: 14, pause: 0.2, min: 0.25, lines: 1, gap: 0 },
    look: { font: "Montserrat", weight: 900, size: 116, case: "none", color: "#FFFFFF", accent: "#FFFFFF", highlight: "#FFE500",
      stroke: 0, strokeColor: "#000000", shadow: "0 0 4px rgba(0,0,0,0.7), 0 5px 0 rgba(0,0,0,0.55), 0 10px 28px rgba(0,0,0,0.6)", spacing: "-0.01em", lineHeight: 1.05, brand: "key" },
    motion: { in: "punch", active: "none", out: "cut" },
  },
  fill: {
    label: "Karaoke fill",
    about: "Four or five words on two lines; they wait dim, the one being said lights up in colour and stays white behind it, so the line fills as it is spoken.",
    group: { words: 5, chars: 30, pause: 0.3, min: 0.8, lines: 2, even: true },
    look: { font: "Poppins", weight: 800, size: 70, case: "none", color: "#FFFFFF", wait: "rgba(255,255,255,0.45)", accent: "#FFE500", highlight: "#FFE500",
      stroke: 0, strokeColor: "#000000", shadow: "0 2px 2px rgba(0,0,0,0.8), 0 0 10px rgba(0,0,0,0.55), 0 0 28px rgba(0,0,0,0.4)", spacing: "0", lineHeight: 1.18, brand: "both" },
    motion: { in: "rise", active: "fill", out: "fade" },
  },
  label: {
    label: "Label",
    about: "Each line on a white box of its own, as the apps' own text looks; the words wait in grey and turn black as they are said, key words in colour.",
    group: { words: 5, chars: 30, pause: 0.3, min: 0.8, lines: 2, gap: 0, even: true },
    look: { font: "Poppins", weight: 600, size: 58, case: "none", color: "#141414", wait: "#8F8F8F", accent: "#141414", highlight: "#2563EB",
      stroke: 0, strokeColor: "#000000", shadow: "none", spacing: "0", lineHeight: 1.42, lineBox: "#FFFFFF", linePad: [0.1, 0.4], lineRadius: "0.24em", brand: "key" },
    motion: { in: "cut", active: "fill", out: "cut" },
  },
  editorial: {
    label: "Editorial",
    about: "Three to five words in a quiet sans, sentence case, the key words in a larger serif italic. Calm and deliberate, for essays, advice and interviews.",
    group: { words: 5, chars: 32, pause: 0.3, min: 0.8, lines: 2, even: true },
    look: { font: "Inter", weight: 500, size: 60, case: "none", color: "#FFFFFF", accent: "#FFFFFF", highlight: "#FFF1C2",
      keyFont: "Playfair Display", keyWeight: 600, keyItalic: true, keyScale: 1.24,
      stroke: 0, strokeColor: "#000000", shadow: "0 0 2px rgba(0,0,0,0.9), 0 1px 4px rgba(0,0,0,0.8), 0 2px 16px rgba(0,0,0,0.65)", spacing: "0", lineHeight: 1.3, brand: "key" },
    motion: { in: "fade", active: "none", out: "fade" },
  },
  subtitle: {
    label: "Plain subtitles",
    about: "Whole phrases of up to two lines in sentence case, white with a thin dark edge and no box: the classic subtitle, quiet under any picture.",
    group: { words: 8, chars: 56, pause: 0.45, min: 1.0, lines: 2, gap: 0 },
    look: { font: "Inter", weight: 600, size: 54, case: "none", color: "#FFFFFF", accent: "#FFFFFF", highlight: "#FFE500",
      stroke: 5, strokeColor: "rgba(0,0,0,0.9)", shadow: "0 2px 5px rgba(0,0,0,0.8)", spacing: "0", lineHeight: 1.25, gap: "0", brand: "key" },
    motion: { in: "cut", active: "none", out: "cut" },
  },
};

export function style(name) {
  const s = STYLES[name];
  if (!s) throw new Error(`There is no caption style "${name}"; there are ${Object.keys(STYLES).join(", ")}.`);
  return structuredClone(s);
}
