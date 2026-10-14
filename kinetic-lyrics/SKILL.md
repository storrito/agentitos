---
name: kinetic-lyrics
description: Turn a clip of people talking (podcast, interview, talk; video or audio) or any spoken audio into a kinetic-typography video where every word appears big as it is said, animated by meaning over a world of light; renders on the CPU, no graphics card needed. Use for vertical shorts for Reels, TikTok, Stories or Shorts from podcast clips, lyric videos, podcast audiograms, or cutting the best highlight out of a long episode.
license: MIT
metadata:
  title: "Kinetic shorts"
  title-de: "Kinetic Shorts"
  summary: "A vertical short from a podcast or interview clip: every spoken word big on screen, with effects and the speakers' names."
  summary-de: "Ein Hochkant-Short aus einem Podcast- oder Interview-Clip: jedes gesprochene Wort groß im Bild, mit Effekten und den Namen der Sprecher."
  ask: "Let's set up your short together: say hi and I'll ask you step by step, while your settings take shape on the right. Or attach a clip of people talking right away (a podcast, an interview or a talk, as a video or just the sound)."
  ask-de: "Lass uns deinen Short gemeinsam einrichten: Schreib „Los“, dann frage ich dich Schritt für Schritt, und rechts entstehen deine Einstellungen. Oder hänge gleich einen Clip an, in dem Menschen sprechen (Podcast, Interview oder Vortrag, als Video oder nur den Ton)."
  placeholder: "Say “go”, attach a clip, or tell me about it"
  placeholder-de: "Schreib „Los“, hänge einen Clip an oder erzähl mir davon"
  inputs: "video,audio"
---

# kinetic-lyrics

`<skill>` below is the folder this file is in. Run the tools as `node <skill>/tools/…` from your own working directory; every path you pass is yours. Never change or patch the files in `<skill>`: they are shared by every video. The one file you copy out is the interview page (below). Full reference: [README.md](README.md).

## Setup (once per machine)

```bash
cd <skill> && npm install                     # node 20+, ffmpeg on the PATH
```

With `OPENROUTER_API_KEY` in the environment, the words and who speaks them come from Gemini 3.5 Transcribe through OpenRouter: nothing else to install. Without it, transcription runs on this machine and needs Parakeet (`npx hyperframes models install parakeet`), speaker detection `<skill>/.venv` with sherpa-onnx and the models in `<skill>/models/diarize/`, gap repair `whisper-cli` (see README). When something is missing, say so in one sentence instead of installing it yourself, unless you are the operator's setup agent.

## Setting it up together (when the chat shows artifacts)

When your harness shows the files of `artifacts/` beside the chat (pchat does), a short is set up on a page there, not in the chat. The page does the asking: the person chooses everything on it at once, in any order, and changes anything instantly, without you. You get only real work, as messages from the page: the clip as soon as a source is picked, then one "build the preview" with all settings. Keep the chat short: never ask there what the page asks.

**The page.** On your first answer, copy `<skill>/interview/setup.html` to `artifacts/<name>-setup.html`, `<name>` a short slug of the topic (or `short-1`). It draws itself from the JSON in its `<script type="application/json" id="state">`; change only that JSON, always the whole block, never the rest of the page:

```json
{"lang": "de", "phase": "setup", "answers": {"quelle": null, "welt": null, "format": null, "titel": null, "sprecher": null, "farben": null, "abspann": null, "posten": null},
 "video": null, "speakers": null, "accounts": [], "project": null, "note": ""}
```

- `lang`: the language of the chat, `de` or `en`.
- `accounts`: before your first answer, look up the accounts the person can post to through the connections your harness gives you, as `[{"id": "…", "label": "Instagram @name"}]`; none, `[]`.
- `note`: what you are doing right now, a few words ("Ich transkribiere den Clip"), shown while you work; `""` at the end of every turn.
- `answers.quelle`: you write it once the clip is there: a short label ("EDELTALK · Kuchen-Krimi, 63 s"); `video`: `true` for a video, `false` for sound only; `speakers`: how many voices the transcript has (the page offers a colour for each).
- `phase`: `setup`, then `building` while you build, `preview` once the preview is built; `project`: `<name>` once `artifacts/<name>/` holds the built short.
- The other answers the page sends you with "build the preview"; write them in (see below). Once the short is built, the page reads what it has from the short itself (`composition/settings.json`, written by every build): you no longer keep those answers.

The page polls whether you work and keeps everything not yet sent in the browser, so your writes (which reload it) lose nothing.

**Keep the page in front.** The right side shows the artifact changed last, and the short's folder is an artifact too. So until the preview is built, work outside `artifacts/`: the clip, the transcript, the brief and the staging go to `shorts/<name>/` (`short.mjs new shorts/<name> <clip>` etc.). And in every turn, write the page last, as a command of its own.

**The messages and what you do:**

1. `Quelle: <link>` / `Quelle: Google Drive` / a clip attached in the chat: get the clip (a link with the tools at hand, Google Drive through the person's connection; for a long episode cut the best minute with `highlight.mjs`, say which in `answers.quelle`), then `short.mjs new shorts/<name> <clip>`, read the words, the brief, and write the staging, all right away: the person goes on choosing meanwhile, and the preview is quick once they are done. Write `answers.quelle` and `video` into the page.
2. `Vorschau bauen – Welt: … · Format: … · Titel: … · Sprecher: … · Abspann: … · Posten: …`: write the answers into the page with `phase: "building"`. Then `bin/new <name> hyperframes`, move `shorts/<name>/source` into `artifacts/<name>/`, and build there with the settings (`short.mjs build artifacts/<name> --world … --aspect … --title … --subtitle … --names … --cta … --handle …`), check it (`short.mjs check`), fix errors. Then `phase: "preview"`, `project: "<name>"`, `note: ""`. Do not render: the page shows the preview in the HyperFrames player and has its own "render" button. If this message comes while the clip is still on its way, finish the clip first. Say in one sentence that the preview is there.
3. After the preview the page changes the short itself: the player shows a change at once, and the skill's action `apply` (`actions.json`, `tools/apply.mjs`: build with the settings, check, remove the outdated video) builds it in, run by pchat without you. A line `(Action on the page: apply on <name>, done: …)` above the person's next message tells you; the settings are in `artifacts/<name>/source/settings.json`, so do not build again for it. To apply settings yourself the same way: `bin/action kinetic-lyrics apply <name> '{"settings": {"world": "noir", "title": "…"}}'`.
4. `Das Video ist gut, bitte posten auf: …`: the person has rendered and watched the video (`artifacts/<name>.mp4`); post it there.
5. `Ich möchte ein Konto zum Posten verbinden.`: help in the chat, then put the account into `accounts`.

How the answers become settings (the page sends them in the chat's language):

| answer | as the page sends it | becomes |
| --- | --- | --- |
| `welt` | a world, or "passend gewählt" / "picked to fit" (write `"auto"`, choose one in the staging and write its name back) | `--world` |
| `format` | `9:16`, `4:5`, `1:1`, `16:9` | `--aspect` |
| `titel` | `Show` or `Show · Untertitel`, or "keiner" / "none" (write `""`) | `--title`, `--subtitle` |
| `sprecher` | `Anna, Ben` in the order they first speak (A, B, …), "ohne Namen" (write `""`), "nach dem Transkript" (write `"später"`: ask in the chat once you know who speaks) | `--names "A=Anna,B=Ben"` |
| `farben` | `A=#ff5a36,B=#4fc3f7`, or "passend zur Welt" / "the world's" (write `"auto"`) | `--colors "A=#ff5a36,B=#4fc3f7"`, for `auto` `--colors ""` |
| `abspann` | `Folge uns · @handle`, or "keiner" (write `""`) | `--cta`, `--handle` |
| `posten` | account labels, or "nur herunterladen" (write `"download"`) | where it goes after the person has seen it |

Over video the dark worlds (`cosmos`, `aurora`, `bokeh`, `neon`, `noir`) lay their light on the footage; the light ones (`editorial`, `geometry`) put it into a frame on paper or in the studio, with dark type below it. The colour scheme comes with the world, each speaker's colour can be chosen (`--colors`), and the fonts are the engine's own (League Gothic, Instrument Serif): when someone asks for other fonts, say so in one sentence. Post only after the person has seen the rendered video and asked for it.

## A short from a clip (the main use)

The person brings a clip of people talking and gets a vertical short: every spoken word appears big the moment it is said, over the clip's own footage (or a world of light for audio only), with effects on the words that carry the point and the speakers' names. Work in one folder per short, `<dir>`; it may already exist (made by your harness).

1. `node <skill>/tools/short.mjs new <dir> <clip>` writes down every word with its timing into `<dir>/source/`. It takes a minute or two; say so before you start.
2. Read the words (`<dir>/source/transcript.json`). Through OpenRouter they already say who speaks (`speaker` A, B, …): run `node <skill>/tools/short.mjs brief <dir>`. Without speakers, decide how many people speak and run `node <skill>/tools/short.mjs brief <dir> --speakers <n>`, which works out who speaks when. The brief goes to `<dir>/source/brief.md`. Read the whole brief: it is your direction for this one video, with the vocabulary of the engine, the rules and the numbered words.
3. Direct the video: write the staging the brief asks for into `<dir>/source/staging.json`, all words, as one JSON file. You choose the world, the hook (a short headline in the language of the clip), the phrases, the words that get an effect and the marks. Respell words the speech recognition clearly misheard, under `fixes`.
4. `node <skill>/tools/short.mjs build <dir>` builds the HyperFrames project into `<dir>/composition/`. If the staging has a mistake, the message names the field; fix the file and build again.
5. `node <skill>/tools/short.mjs check <dir> 4,15` plays it through and lists what a viewer would notice. Fix the errors (✗) in the staging; the warnings (⚠) are mostly words read quickly. The seconds you name become pictures in `<dir>/stills/<t>.png`, which you can show.
6. The video file: `npx hyperframes render` in `<dir>/composition/` (or your harness's render command). It takes a few minutes for a minute of clip; say so.

Without the interview, show the first version before you ask anything. Then ask what you could not know: the speakers' names as they should appear (`--names "A=Anna,B=Ben"`; A is who speaks first) and the show's name for the top line (`--title`). Settings stay with the short, so the next step keeps them: `--title`, `--subtitle`, `--hook`, `--world`, `--names`, `--colors "A=#ff5a36"`, `--aspect 9:16` (the default, or `1:1`, `4:5`, `16:9`), `--cta "…" --handle @name` for an end card.

Offer a different world as a choice, with the reason: `bokeh` (warm lights, for people, health, comedy), `neon` (a glowing grid, for tech, sport, speed), `noir` (light through blinds, for crime, secrets, psychology), `cosmos` (night sky, for big ideas), `aurora` (colour fields, for motivation), `editorial` (paper, for business, education) and `geometry` (a studio, for products, explainers), these two with the clip in a frame.

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
