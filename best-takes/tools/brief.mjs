// brief.md: what the agent reads before it writes cut.json. The rules of a good cut (the same
// rules the model of `propose` gets), the format, and every word of every video, numbered.

import { clock } from "./lib/media.mjs";

// --target: a cut longer than its target is trimmed to it as long as that leaves out at most this
// share of the clean cut (rules 1–7, nothing dropped for the length). Up to half, what stays is the
// recording with its weaker parts out, its thread intact; beyond, most of what was said goes and
// the rest is scattered sentences stitched into a story, against rule 4, which no human editor is
// asked to do either: a short script written from what was said, recorded anew, is the answer.
export const TRIM_AT_MOST = 0.5;
// how fast a script is spoken: narrated-short/references/script.md counts 90–100 words in 35–46 s
export const WORDS_A_SECOND = 2.4;
// the longest clean cut that is still trimmed to the target
export const trimmable = (target) => Math.round(target / (1 - TRIM_AT_MOST));

// what check says of a cut longer than the target; null when it is not
export function overTarget(duration, target) {
  if (!target || duration <= target + 0.5) return null;
  if ((duration - target) / duration <= TRIM_AT_MOST) {
    return `the cut is ${duration.toFixed(1)} s long, ${(duration - target).toFixed(1)} s over the ${target} s it should be at most: drop what repeats first, then the weakest parts; keep the opening and the ending`;
  }
  return `the cut is ${duration.toFixed(1)} s long and should be at most ${target} s: that would leave out more than half of what it says, which is no longer a matter of cutting, so do not thin it out but ask the person (SKILL.md, step 4) whether you write a script of ${target} s spoken, about ${Math.round(target * WORDS_A_SECOND)} words, from what they said, to record again, or cut it to the strongest parts anyway`;
}

// voice the transcribe skill found no words for, even heard again (its "unwritten"): an item of
// its own in the words, so that its time never reads as a pause between the words around it
export const UNWRITTEN = "speech not written down";
export const shown = (w) => (w.kind === "filler" ? `(${w.text.replace(/[,.;:!?]+$/, "")})`
  : w.kind === "unwritten" ? `(${UNWRITTEN}, ${(w.end - w.start).toFixed(1)} s)` : w.text);

// one line per sentence or after a pause, each word with its number: [41]Die [42]erste …
export function takesText(clips, words) {
  const lines = [];
  for (const c of Object.values(clips)) {
    lines.push("", `## ${c.audio ? "Recording" : "Video"} ${c.n} · ${c.from} · ${clock(c.duration, false)}${c.audio ? " · sound alone" : ""}${c.created ? ` · recorded ${c.created.replace("T", " ").slice(0, 16)}` : ""}`, "");
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
   **\`(${UNWRITTEN}, 1.7 s)\`** marks voice the speech model wrote no words for, even
   when heard again: nearly always an attempt it skipped, a sentence started over. The words
   before and after it may belong to different attempts ("The" of the first, "new app opens"
   of the third): **a keep never runs across one** unless it belongs to the attempt you keep.
   Start the keep after it, at the first word of the attempt that follows. Where the words
   after it begin in the middle of a sentence ("testers liked the new layout." after it,
   "Three of four" missing), it holds the start of that attempt:
   start the keep on it and give the keep \`"unwritten": "keep"\`, which plays it as recorded.
3. **Nothing about the recording itself**, unless it is meant for the viewer: "I'll just
   start", "let the AI cut this", "let's see what the AI makes of it", counting in, talking to
   someone behind the camera. A greeting or a goodbye to the viewer stays.
4. **Never lose content.** Facts, names, numbers with their units, product names, a
   punchline, what the next sentence refers to. Keep a unit together: "fünfzig Millimeter
   Objektiv mit Lichtstärke eins zu eins Komma vier" is one piece. When unsure whether two
   sentences are a retry or two different points, keep both and say so.
5. **Few, whole pieces.** Ranges of whole sentences. Fillers ("äh", "ähm") inside a kept range
   are cut out by the tool, long pauses shortened: **never split a range around them**. A piece of one or two words between cuts sounds chopped: take the whole phrase.
${settings.audio ? `6. **Pauses are breaths.** There is no picture: a pause over ${settings.pause ?? 1} s inside a keep is cut,
   and between the stretches that play the tool lays the room's own quiet, a breath. A
   silence that belongs to what is said (a beat before a punchline) is yours to mark:
   \`"pauses": "keep"\` on its keep (all its pauses then play as they are).` : `6. **Pauses follow the picture.** A pause that moves no more than the picture while the person
   speaks (a face, the hand holding the phone) the tool cuts; where something moves clearly
   more (a thing held into the picture, a click, a page that loads) it keeps that part, muted,
   a long one as a timelapse. A silent moment worth seeing that it cannot measure (a look, a
   reaction, a thing held still) is yours to mark: \`"pauses": "keep"\` on its keep (all its
   pauses then play as they are).`}
7. **A wait the speaker announces stays a wait.** "Let's wait until then", "wir warten kurz",
   "un momento", in any language: what follows is the time passing, and the viewer should feel
   it. Put the number of the announcing sentence's last word into \`"waits"\`; the tool then
   never cuts that pause away: ${settings.audio ? "it plays 3 s of it as recorded before the cut" : `a picture that moves (a clock, a progress bar) plays as a
   timelapse of 3–5 s, a still one holds 3 s before the cut`}. This works inside a keep and
   between two keeps (the pause up to the next keep's first word).${settings.target ? `
8. **The length.** It should be at most ${settings.target} s, but the first cut keeps to rules
   1–7 alone and drops nothing for the length. Then, by that cut's length: up to
   ${trimmable(settings.target)} s, first drop what repeats, then the weakest parts; keep the opening and the
   ending. Longer than ${trimmable(settings.target)} s, ${settings.target} s would leave out more than half of what is said:
   that is no cut, so leave it as it is; the person decides.` : ""}

The order of the keeps is the order they play: normally the order they were said. Put a part
first only when the person asks for it (e.g. a strong sentence as a hook).`;
}

export function brief(clips, words, settings) {
  const several = Object.keys(clips).length > 1;
  settings = { ...settings, audio: Object.values(clips).every((c) => c.audio) };
  const unwritten = words.some((w) => w.kind === "unwritten");
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
- **Pauses** ${settings.audio ? `longer than ${settings.pause} s inside a keep are cut; there is no picture to look at.` : settings.pauses === "tight" ? `longer than ${settings.pause} s inside a keep are cut to a breath, whatever the picture
  shows (tight).` : `longer than ${settings.pause} s inside a keep: where the picture moves no more than
  while the person speaks they are cut to about 0.3 s; where something moves clearly more (4×,
  on a screen any movement), that part stays, muted, up to 2.5 s as it is, longer in about a
  third of its time (2–6 s, at most ×10). \`check\` says for each pause what it did and why.`}
  \`"pauses": "keep"\` plays them as they are.
- **Cut points** go into the quiet just before and after the kept words.${settings.audio ? `
- **Breaths**: where the cut joins two stretches that were not one in the recording (a pause
  cut, the next keep), it lays the room's own quiet between them (the quietest three seconds
  of the recording): 0.42 s after a sentence, 0.2 s inside one, on top of the quiet the cut
  points leave. Before a keep that begins a new part, give it \`"breath": 1\` (seconds).` : ""}${unwritten ? `
- **Speech not written down** inside a keep is an error of \`build\` until the keep says what
  it is: \`"unwritten": "cut"\` when you are sure it is no speech of the cut (a cough, someone
  else), \`"unwritten": "keep"\` when it belongs to the sentence (a word the model left out).` : ""}
- **Loudness**: each take is measured and brought to the same level (${settings.loudness} LUFS
  before the bus, ${settings.final} LUFS in ${settings.audio ? "the cut's voice" : "the rendered video"}). For a part that should be quieter
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
  pause after each plays as a wait (rule 7).${settings.audio ? `
- \`breath\` (optional, on a keep): seconds of the room's quiet before it, for a new part.` : ""}${unwritten ? `
- \`unwritten\` (optional, on a keep): \`"cut"\` or \`"keep"\` for the speech not written down
  inside it; better, end the keep before it.` : ""}

## The words
${takesText(clips, words)}
`;
}
