// Concept lexicon: maps word stems (EN + DE) to a visual concept.
// A concept drives three things at once:
//   fx     – how the word itself animates (typography engine)
//   motif  – which illustrative layer the 3D world brings in (three.js engine)
//   mood   – palette family the scene drifts toward
//
// Matching is prefix-based on the lower-cased, accent-folded word, so "falling",
// "fallen", "fällt" all hit "fall"/"fäll". Keep stems >= 3 chars to avoid noise.

export const CONCEPTS = {
  rise: {
    fx: "rise", motif: "ascend", mood: "dawn",
    stems: ["rise", "rising", "rose", "up", "fly", "flew", "flying", "soar", "climb", "lift", "high", "float", "above", "heaven",
      "steig", "flieg", "flog", "hoch", "höher", "oben", "aufwärts", "schweb", "himmel"],
    exact: ["up", "auf"],
  },
  fall: {
    fx: "drop", motif: "rain", mood: "cool",
    stems: ["fall", "fell", "down", "drop", "sink", "sank", "gravity", "tear", "crash", "collaps",
      "fall", "fäll", "fiel", "sturz", "stürz", "sink", "unten", "tropf", "träne"],
    exact: ["down", "ab"],
  },
  rain: {
    fx: "drop", motif: "rain", mood: "cool",
    stems: ["rain", "storm", "cry", "cried", "regen", "wein", "sturm"],
  },
  fire: {
    fx: "flicker", motif: "embers", mood: "ember",
    stems: ["fire", "burn", "flame", "blaze", "heat", "hot", "ash", "smoke", "ignit",
      "feuer", "brenn", "brann", "flamm", "glut", "heiß", "asche", "rauch"],
  },
  light: {
    fx: "glow", motif: "sun", mood: "gold",
    stems: ["light", "bright", "shine", "shining", "sun", "glow", "gold", "dawn", "day",
      "licht", "hell", "leucht", "sonne", "strahl", "glanz", "gold", "morgen"],
  },
  stars: {
    fx: "sparkle", motif: "stars", mood: "night",
    stems: ["star", "galax", "cosmos", "universe", "space", "planet", "moon",
      "stern", "galax", "kosmos", "weltall", "mond", "all"],
    exact: ["all"],
  },
  dark: {
    fx: "fog", motif: "fog", mood: "dark",
    stems: ["dark", "night", "shadow", "black", "alone", "lonely", "cold", "empty", "lost", "silence", "void", "nothing",
      "dunkel", "nacht", "schatten", "schwarz", "allein", "einsam", "kalt", "leer", "verlor", "stille", "nichts"],
  },
  quiet: {
    fx: "whisper", motif: "fog", mood: "dark",
    stems: ["whisper", "quiet", "soft", "gentle", "silent", "small", "little", "hush", "slow",
      "flüster", "leise", "sanft", "zart", "klein", "still", "langsam"],
  },
  loud: {
    fx: "slam", motif: "shock", mood: "electric",
    stems: ["loud", "scream", "shout", "roar", "big", "huge", "giant", "everything", "boom", "bang", "never", "forever",
      "laut", "schrei", "brüll", "groß", "riesig", "alles", "niemals", "nie", "immer"],
  },
  electric: {
    fx: "glitch", motif: "lightning", mood: "electric",
    stems: ["electric", "energy", "spark", "thunder", "lightning", "alive", "wild", "power", "volt", "neon",
      "elektr", "energie", "funke", "donner", "blitz", "lebendig", "wild", "kraft", "strom"],
  },
  water: {
    fx: "wave", motif: "waves", mood: "ocean",
    stems: ["ocean", "sea", "wave", "water", "river", "tide", "drown", "swim", "deep", "flow", "shore",
      "ozean", "meer", "welle", "wasser", "fluss", "flut", "ertrink", "schwimm", "tief", "ström", "ufer"],
  },
  time: {
    fx: "spin", motif: "rings", mood: "violet",
    stems: ["time", "clock", "spin", "turn", "around", "circle", "again", "round", "orbit", "cycle", "endless", "moment", "second",
      "zeit", "uhr", "dreh", "kreis", "wieder", "rund", "endlos", "moment", "sekunde"],
  },
  world: {
    fx: "spin", motif: "planet", mood: "ocean",
    stems: ["world", "earth", "globe", "home", "welt", "erde", "heimat", "zuhause"],
  },
  love: {
    fx: "pulse", motif: "heartbeat", mood: "rose",
    stems: ["love", "heart", "kiss", "hold", "touch", "embrace", "together", "beat", "breath", "name",
      "lieb", "herz", "kuss", "küss", "halt", "berühr", "umarm", "zusammen", "atem", "dein", "name"],
  },
  break: {
    fx: "shatter", motif: "shards", mood: "electric",
    stems: ["break", "broke", "shatter", "crack", "tear", "split", "glass", "pieces", "apart", "destroy",
      "brech", "brich", "brach", "zerbr", "zerspl", "riss", "glas", "scherb", "kaputt", "zerstör"],
  },
  city: {
    fx: "flash", motif: "grid", mood: "electric",
    stems: ["city", "street", "road", "highway", "town", "lights", "neon", "drive", "car",
      "stadt", "straße", "strasse", "autobahn", "lichter", "fahr"],
  },
  speed: {
    fx: "streak", motif: "warp", mood: "electric",
    stems: ["run", "fast", "rush", "race", "speed", "go", "now", "chase", "escape", "faster", "car", "lap", "drive", "driving", "brake", "throttle", "motor", "track",
      "lauf", "renn", "schnell", "eil", "jetzt", "los", "flucht", "hinein", "auto", "fahr", "brems", "motorrad", "runde", "strecke"],
    exact: ["go", "now"],
  },
  // ---- non-poetic content (podcasts, explainers, social posts) ----
  growth: {
    fx: "grow", motif: "chart", mood: "gold",
    stems: ["grow", "growth", "increase", "scale", "double", "triple", "boost", "improve", "progress", "expand", "faster", "more",
      "wachs", "wuchs", "verdoppel", "verdreifach", "skalier", "verbesser", "fortschritt", "mehr", "zunehm"],
    exact: ["more", "mehr"],
  },
  money: {
    fx: "flash", motif: "chart", mood: "gold",
    stems: ["money", "revenue", "profit", "dollar", "euro", "price", "cost", "sales", "budget", "invest", "pay", "paid", "cash", "income", "salary", "rich",
      "geld", "umsatz", "gewinn", "preis", "kosten", "verkauf", "budget", "investi", "bezahl", "gehalt", "einkommen", "reich"],
  },
  tech: {
    fx: "glitch", motif: "network", mood: "electric",
    stems: ["data", "software", "code", "coding", "model", "algorithm", "computer", "digital", "internet", "tech", "app", "automat", "robot", "machine", "online", "platform", "chatgpt", "claude",
      "daten", "technolog", "digital", "programm", "maschine", "plattform", "automatis"],
    exact: ["ai", "ki", "api"],
  },
  idea: {
    fx: "glow", motif: "sun", mood: "gold",
    stems: ["idea", "insight", "realiz", "realis", "understand", "learn", "discover", "imagine", "creative", "solution", "secret", "lesson",
      "idee", "erkenn", "versteh", "lern", "entdeck", "kreativ", "lösung", "geheimnis", "lektion"],
  },
  people: {
    fx: "pulse", motif: "network", mood: "rose",
    stems: ["people", "team", "community", "everyone", "everybody", "customer", "user", "human", "friend", "family", "audience", "followers",
      "menschen", "leute", "gemeinschaft", "kunde", "nutzer", "freund", "familie", "publikum"],
  },
  problem: {
    fx: "slam", motif: "shock", mood: "ember",
    stems: ["problem", "risk", "fail", "mistake", "wrong", "danger", "crisis", "struggle", "burnout", "stress", "pain", "worst", "stop", "quit",
      "risiko", "fehler", "scheiter", "falsch", "gefahr", "krise", "stress", "schmerz", "schlimm", "aufhör"],
  },
  success: {
    fx: "glow", motif: "sun", mood: "gold",
    stems: ["success", "win", "won", "achiev", "best", "great", "amazing", "incredible", "huge", "finally", "proud", "perfect",
      "erfolg", "gewonn", "geschafft", "schaff", "best", "großartig", "unglaublich", "endlich", "stolz", "perfekt"],
  },
  // numbers are detected by numberOf(), not by stems; listed so staging can pick it
  number: { fx: "count", motif: "chart", mood: "gold", stems: [] },
  eye: {
    fx: "blink", motif: "rings", mood: "cool",
    stems: ["eye", "blink", "look", "watch", "stare", "see", "seen", "notice", "spot", "observ",
      "auge", "blinz", "blick", "schau", "starr", "sieh", "seh", "beobacht", "bemerk"],
  },
  secret: {
    fx: "redact", motif: "fog", mood: "dark",
    stems: ["secret", "lie", "lying", "liar", "hide", "hidden", "spy", "cia", "conspir", "classified", "truth", "fake",
      "geheim", "lüge", "lüg", "versteck", "spion", "verschwör", "wahrheit"],
  },
  animal: {
    fx: "bounce", motif: "ascend", mood: "dawn",
    stems: ["dog", "cat", "animal", "pet", "puppy", "horse", "bird", "breed", "walk",
      "hund", "katze", "tier", "pferd", "vogel", "welpe", "rasse", "gassi"],
  },
  body: {
    fx: "pulse", motif: "heartbeat", mood: "ocean",
    stems: ["body", "brain", "health", "cortisol", "hormone", "sleep", "stress", "blood", "muscle", "exercise", "illness", "immune", "lifespan",
      "körper", "gehirn", "gesund", "hormon", "schlaf", "blut", "muskel", "krank", "venen"],
  },
  sky: {
    fx: "rise", motif: "clouds", mood: "dawn",
    stems: ["sky", "cloud", "wind", "air", "breathe", "dream", "free", "wing",
      "wolke", "luft", "traum", "träum", "frei", "flügel"],
  },
};

// Function words get the small italic serif treatment and never carry a concept.
export const STOPWORDS = new Set(`
a an the and or but so of to in on at by for from with as is are was were be been am it its it's this that these those
i me my mine you your yours he him his she her we us our they them their what which who whom when where why how
not no do does did done have has had will would can could should shall may might must just than then there here
if into onto over under like about up out off too very
der die das den dem des ein eine einen einem einer und oder aber so von zu im in an am auf aus bei mit nach für
ist sind war waren bin bist sein es ich mich mir du dich dir er sie ihn ihr wir uns ihr euch was wer wie wo wann
nicht kein keine noch nur dann da hier wenn als ob doch ja nein schon auch sehr wird werden hat haben hatte
`.split(/\s+/).filter(Boolean));

// Function words that still carry meaning strongly enough to be animated.
export const MEANINGFUL_STOP = new Set(["up", "down", "never", "all", "now", "go", "auf", "ab", "nie", "alles"]);

// A phrase prefers to break *before* these (they open a new clause).
export const CLAUSE_OPENERS = new Set(["and", "but", "so", "that", "when", "where", "because", "while", "until", "und", "aber", "dass", "weil", "wenn", "als", "bis", "doch"]);

const fold = (s) => s.toLowerCase().normalize("NFC");

export function keyOf(text) {
  return fold(text).replace(/[^\p{L}\p{N}'’]+/gu, "").replace(/[’]/g, "'");
}

export function conceptOf(key) {
  if (!key || key.length < 2) return null;
  let best = null;
  let bestLen = 0;
  for (const [name, c] of Object.entries(CONCEPTS)) {
    if (c.exact && c.exact.includes(key)) {
      if (key.length + 100 > bestLen) { best = name; bestLen = key.length + 100; }
      continue;
    }
    for (const stem of c.stems) {
      if (stem.length < 3 && key !== stem) continue;
      if (key.startsWith(stem) && stem.length > bestLen) {
        // Guard short stems against long unrelated words ("all" vs "allow").
        if (stem.length <= 3 && key.length > stem.length + 3) continue;
        best = name;
        bestLen = stem.length;
      }
    }
  }
  return best;
}

// Numbers get their own treatment: digits count up. Returns {value, decimals, prefix, suffix}
// for tokens like "40%", "$3.5", "1,000", "10x"; years (1900–2100) are left alone.
export function numberOf(text) {
  const m = String(text).match(/^([$€£]?)(\d{1,3}(?:[,.]\d{3})+|\d+(?:[.,]\d+)?)(%|x|k|m|€|\$)?[.,!?:;]*$/i);
  if (!m) return null;
  const rawNum = m[2];
  const grouped = /^\d{1,3}([,.]\d{3})+$/.test(rawNum);
  const value = grouped ? Number(rawNum.replace(/[,.]/g, "")) : Number(rawNum.replace(",", "."));
  if (!Number.isFinite(value)) return null;
  if (!m[1] && !m[3] && value >= 1900 && value <= 2100 && !rawNum.includes(".")) return null;
  const decimals = grouped ? 0 : (rawNum.split(/[.,]/)[1] || "").length;
  // keep the speaker's separators: "10.000" / "3,5" (German) count up as such, not as "10,000" / "3.5"
  const sep = grouped ? rawNum.match(/[,.]/)[0] : decimals ? rawNum.match(/[,.]/)[0] : "";
  return { value, decimals, grouped, sep, prefix: m[1] || "", suffix: m[3] || "" };
}
