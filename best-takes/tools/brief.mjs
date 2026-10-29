// brief.md: what the agent reads before it writes cut.json. The rules of a good cut (the same
// rules the model of `propose` gets), the format, and every word of every video, numbered.

import { clock } from "./lib/media.mjs";

export const shown = (w) => (w.kind === "filler" ? `(${w.text.replace(/[,.;:!?]+$/, "")})` : w.text);

// one line per sentence or after a pause, each word with its number: [41]Die [42]erste …
export function takesText(clips, words) {
  const lines = [];
  for (const c of Object.values(clips)) {
    lines.push("", `## Video ${c.n} · ${c.from} · ${clock(c.duration, false)}${c.created ? ` · recorded ${c.created.replace("T", " ").slice(0, 16)}` : ""}`, "");
    let line = [], prev = null;
    const flush = () => { if (line.length) lines.push(line.join(" ")); line = []; };
    for (const w of words.filter((x) => x.clip === c.n)) {
      const gap = prev ? w.start - prev.end : w.start;
      if (!line.length || gap >= 0.6 || /[.!?]$/.test(prev?.text || "")) {
        flush();
        line.push(`[${clock(w.start)}${prev && gap >= 1 ? ` · ${gap.toFixed(1)} s pause` : ""}]`);
      }
      line.push(`[${w.i}]${shown(w)}`);
      prev = w;
    }
    flush();
  }
  return lines.join("\n");
}

export function rules(several, settings) {
  return `The person recorded something, often in several attempts, and wants the version a viewer
should see: **the best take of every part, in the order of the story, without slips.**

1. **The best take of every part.** People repeat a sentence until it works: "die, ähm,
   Belichtung, die Belichtung einstellen". Keep the **last complete, fluent** attempt; leave
   out the attempts before it. An earlier attempt wins only when it is clearly better (the
   later one breaks off, or slips itself). Two attempts that say different things are no
   retries: keep both.${several ? `
   Across videos: a later video is often a new attempt at the same thing (the videos are in
   the order they were recorded). Compare them and take the best take of each part from
   wherever it is.` : ""}
2. **No slips.** Leave out false starts and abandoned sentences ("zwei Komma achter Brenn –"),
   stutters and doubled words ("die die"), a sentence started over. Cut **between words**,
   never inside one.
3. **Nothing about the recording itself**, unless it is meant for the viewer: "I'll just
   start", "let the AI cut this", "let's see what the AI makes of it", counting in, talking to
   someone behind the camera. A greeting or a goodbye to the viewer stays.
4. **Never lose content.** Facts, names, numbers with their units, product names, a
   punchline, what the next sentence refers to. Keep a unit together: "fünfzig Millimeter
   Objektiv mit Lichtstärke eins zu eins Komma vier" is one piece. When unsure whether two
   sentences are a retry or two different points, keep both and say so.
5. **Few, whole pieces.** Ranges of whole sentences. Fillers ("äh", "ähm") inside a kept range
   are cut out by the tool, long pauses shortened: **never split a range around them**. A piece of one or two words between cuts sounds chopped: take the whole phrase.
6. **Pauses follow the picture.** The tool looks at every pause: where the picture stands still
   it cuts (a jump cut), where it moves (a click, a page that loads, scrolling) it keeps that
   part, muted, and a long one plays faster (a timelapse). Leave pauses to it. Only when a
   silence must play at its own speed although it is long (a camera held into the picture and
   turned slowly, a reaction) does that keep get \`"pauses": "keep"\`.
7. **A wait the speaker announces stays a wait.** "Let's wait until then", "wir warten kurz",
   "un momento", in any language: what follows is the time passing, and the viewer should feel
   it. Put the number of the announcing sentence's last word into \`"waits"\`; the tool then
   never cuts that pause away: a picture that moves (a clock, a progress bar) plays as a
   timelapse of 3–5 s, a still one holds 3 s before the cut. This works inside a keep and
   between two keeps (the pause up to the next keep's first word).${settings.target ? `
8. **The length.** It should be at most ${settings.target} s. First drop what repeats, then the
   weakest parts; keep the opening and the ending.` : ""}

The order of the keeps is the order they play: normally the order they were said. Put a part
first only when the person asks for it (e.g. a strong sentence as a hook).`;
}

export function brief(clips, words, settings) {
  const several = Object.keys(clips).length > 1;
  return `# Directing the cut

You choose which words stay, the tool finds the cut points in the sound. Read all of this,
then write \`cut.json\` next to \`source/\`.

## What a good cut is

${rules(several, settings)}

## What the tool does by itself

- **Fillers** \`(äh)\`, \`(ähm)\`, \`(mm)\` are cut out of every kept range. When one is a real
  word ("hm" as an answer), give that keep \`"sounds": "keep"\`.
- **Events** like \`[Kamera klackert]\` are noises, not speech: they stay where they are, inside
  a kept range they play along.
- **Pauses** ${settings.pauses === "tight" ? `longer than ${settings.pause} s inside a keep are cut to a breath, whatever the picture
  shows (tight).` : `longer than ${settings.pause} s inside a keep: where the picture stands still they
  are cut to about 0.3 s; where it moves, that part stays, muted, up to 2.5 s as it is, longer
  in about a third of its time (2–6 s, at most ×10).`} \`"pauses": "keep"\` plays them as they are.
- **Cut points** go into the quiet just before and after the kept words.
- **Loudness**: each take is measured and brought to the same level (${settings.loudness} LUFS
  before the bus, ${settings.final} LUFS in the rendered video). For a part that should be quieter
  or louder on purpose, give its keep \`"gain": -3\` (dB, on top).

## cut.json

\`\`\`json
{
  "keep": [
    {"words": "15-131", "why": "intro and the first two cameras"},
    {"words": "136-161", "pauses": "keep", "why": "the second attempt at 'die Belichtung'; turns the camera slowly to show the viewfinder"},
    {"words": "173-194", "why": "the retry of the lens; the first breaks off at 'Brenn'"},
    {"words": "208", "why": "goodbye"}
  ],
  "fixes": {"105": "X-700", "106": ""},
  "waits": [189]
}
\`\`\`

- \`words\`: a range of the numbers below, first and last included (or one number). One video per
  range: a range never runs into the next video.
- \`why\` is for you and the person; say it for every keep that leaves a retry behind.
- \`fixes\` (optional): the spelling the subtitles should show, by number; "" drops a word from
  the text. It changes the subtitles, not the cut.
- \`waits\` (optional): the numbers of the last words of sentences that announce a wait; the
  pause after each plays as a wait (rule 7).

## The words
${takesText(clips, words)}
`;
}
