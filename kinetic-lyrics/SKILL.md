---
name: kinetic-lyrics
description: Turn a clip of people talking (podcast, interview, talk; video or audio) or any spoken audio into a kinetic-typography video where every word appears big as it is said, animated by meaning over a three.js world of light. Use for vertical shorts for Reels, TikTok, Stories or Shorts from podcast clips, lyric videos, podcast audiograms, or cutting the best highlight out of a long episode.
license: MIT
metadata:
  title: "Kinetic shorts"
  title-de: "Kinetic Shorts"
  summary: "A vertical short from a podcast or interview clip: every spoken word big on screen, with effects and the speakers' names."
  summary-de: "Ein Hochkant-Short aus einem Podcast- oder Interview-Clip: jedes gesprochene Wort groß im Bild, mit Effekten und den Namen der Sprecher."
  ask: "Attach a clip of people talking: a podcast, an interview or a talk, as a video or just the sound. I'll turn it into a vertical short."
  ask-de: "Hänge einen Clip an, in dem Menschen sprechen: einen Podcast, ein Interview oder einen Vortrag, als Video oder nur den Ton. Ich mache daraus einen Hochkant-Short."
  placeholder: "Attach a clip, or tell me about it"
  placeholder-de: "Hänge einen Clip an oder erzähl mir davon"
  inputs: "video,audio"
---

# kinetic-lyrics

`<skill>` below is the folder this file is in. Run the tools as `node <skill>/tools/…` from your own working directory; every path you pass is yours. Never change, copy or patch the files in `<skill>`: they are shared by every video. Full reference: [README.md](README.md).

## Setup (once per machine)

```bash
cd <skill> && npm install                     # node 20+, ffmpeg on the PATH
npx hyperframes models install parakeet       # word-level speech recognition
```

Speaker detection needs `<skill>/.venv` with sherpa-onnx and the models in `<skill>/models/diarize/`; fixing recognition gaps needs `whisper-cli` (see README). When something is missing, say so in one sentence instead of installing it yourself, unless you are the operator's setup agent.

## A short from a clip (the main use)

The person brings a clip of people talking and gets a vertical short: every spoken word appears big the moment it is said, over the clip's own footage (or a world of light for audio only), with effects on the words that carry the point and the speakers' names. Work in one folder per short, `<dir>`; it may already exist (made by your harness).

1. `node <skill>/tools/short.mjs new <dir> <clip>` writes down every word with its timing into `<dir>/source/`. It takes a minute or two; say so before you start.
2. Read the words (`<dir>/source/transcript.json`) and decide how many people speak. Then `node <skill>/tools/short.mjs brief <dir> --speakers <n>` works out who speaks when and writes `<dir>/source/brief.md`. Read the whole brief: it is your direction for this one video, with the vocabulary of the engine, the rules and the numbered words.
3. Direct the video: write the staging the brief asks for into `<dir>/source/staging.json`, all words, as one JSON file. You choose the world, the hook (a short headline in the language of the clip), the phrases, the words that get an effect and the marks. Respell words the speech recognition clearly misheard, under `fixes`.
4. `node <skill>/tools/short.mjs build <dir>` builds the HyperFrames project into `<dir>/composition/`. If the staging has a mistake, the message names the field; fix the file and build again.
5. `node <skill>/tools/short.mjs check <dir> 4,15` plays it through and lists what a viewer would notice. Fix the errors (✗) in the staging; the warnings (⚠) are mostly words read quickly. The seconds you name become pictures in `<dir>/stills/<t>.png`, which you can show.
6. The video file: `npx hyperframes render` in `<dir>/composition/` (or your harness's render command). It takes a few minutes for a minute of clip; say so.

Show the first version before you ask anything. Then ask what you could not know: the speakers' names as they should appear (`--names "A=Anna,B=Ben"`; A is who speaks first) and the show's name for the top line (`--title`). Settings stay with the short, so the next step keeps them: `--title`, `--subtitle`, `--hook`, `--world`, `--names`, `--aspect 9:16` (the default, or `1:1`, `4:5`, `16:9`), `--cta "…" --handle @name` for an end card, `--keywords` (only the key words big, the sentence small) or `--full-text` (every word big, the default).

Offer a different world as a choice, with the reason: `bokeh` (warm lights, for people, health, comedy), `neon` (a glowing grid, for tech, sport, speed), `noir` (light through blinds, for crime, secrets, psychology), `cosmos` (night sky, for big ideas), `aurora` (colour fields, for motivation).

For a change to a word, an effect or a phrase, change the staging and build again; never edit the files in `composition/` by hand, the next build replaces them. When a wish needs an effect the brief does not offer, say so in one sentence. Only clips the person may use: when they say it is someone else's material, say once that publishing needs the rights holder's permission.

## Other uses

`tools/build.mjs` takes any word-timed transcript directly, with presets `lyric` (music, big gestures, 16:9), `podcast` and `social` (9:16, hook card, CTA):

```bash
node <skill>/tools/build.mjs transcript.json --audio voice.wav --preset lyric|podcast|social \
  [--aspect 9:16] [--world …] [--title "…"] [--staging-brief brief.md --staging staging.json] --out <project>
```

- A long episode, best 40–75 s: `node <skill>/tools/highlight.mjs <episode> --out <dir> [--hint "…"]`, then build.
- Audio only, no transcript: `npx hyperframes transcribe audio.wav -e parakeet`.
- Check any built project: `node <skill>/tools/qa.mjs <project> [--frames 5,12.5]` (exit 1 on errors).

## Rules

- Everything stays deterministic: no `Date.now()`, `Math.random()` or network in compositions.
- Change transcript overrides, the staging or `plan.json` and rebuild; never hand-edit generated `compositions/*.html` or `assets/engine/*`.
- When working on the engine itself (not a video), follow [AGENTS.md](AGENTS.md) for the HyperFrames rules.
