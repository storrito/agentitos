---
name: freeze-cutout
description: Makes a clip freeze for a moment while its subject pops out (the background black and white, the subject in colour with a sticker outline, a little larger), then run on; for the first seconds of a short, and as other skills' hook effect.
license: MIT
metadata:
  title: "Freeze and pop"
  title-de: "Einfrieren und hervorheben"
  summary: "Your clip stops for a blink, its subject jumps out of the picture with an outline, and the clip runs on: an opening the eye cannot miss."
  summary-de: "Dein Clip hält einen Wimpernschlag an, das Motiv springt mit einer Kontur aus dem Bild, und der Clip läuft weiter: ein Einstieg, den das Auge nicht übersieht."
  ask: "Upload the clip and tell me what in it should pop out (the car, the robot, the product)."
  ask-de: "Lade den Clip hoch und sag mir, was darin hervorspringen soll (das Auto, der Roboter, das Produkt)."
  placeholder: "A clip and its subject"
  placeholder-de: "Ein Clip und sein Motiv"
  inputs: "video"
---

# freeze-cutout

`<skill>` is the folder of this file. Run `node <skill>/tools/cutout.mjs …` from your working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

## What it needs

Node 20+, ffmpeg and OpenRouter for the mask (an image model, 7 to 14 cents a picture): `OPENROUTER_API_KEY`, or on a Sprite the gateway's OpenRouter connection. When something is missing, say so in one sentence; never install it.

## The freeze

The clip comes as a line `video: uploads/<file>`, or from the skill you work for. Your folder: `cutout/<name>/`.

### 1. The moment

The freeze shows one frame for most of a second, so choose it: the subject **big, sharp and whole** in the picture, nothing in front of it (no dust, spray, hand), not at the very start (0.2 s of clip before it, 1.2 s after it; 1 s after it for `soft`). Look at the clip's first seconds as frames before you decide, two a second:

```bash
mkdir -p cutout/<name>
ffmpeg -v error -y -i <clip> -t 3 -vf "fps=2,scale=270:-2,tile=6x1" -frames:v 1 cutout/<name>/strip.jpg
```

No such moment: say so and leave the clip as it is. A freeze on a half-hidden subject is worse than none.

### 2. Make it

```bash
node <skill>/tools/cutout.mjs <clip> artifacts/<name>-pop.mp4 --at <seconds> --subject "<what pops, in a few words>" --work cutout/<name>
```

- `--subject`: what the eye should take for the subject, as you would point at it: "the yellow robot", "the red truck". Left out, the model takes what it thinks is the main thing.
- `--style soft`: a shorter, smaller pop with a thinner outline (0.45 s, 1.12 times) instead of `strong` (0.7 s, 1.2 times), for a calm film.
- `--region band`: for a clip that lies as a band over a blurred copy of itself, look in the band only; `--region x,y,w,h`: look there, when the picture holds more than the footage. Without it the whole frame is looked at. The tool's line says where it looked.

The clip keeps its length and its frame rate: the freeze takes its time out of the end. **It comes out without sound**: the effect is for footage that lies under a voice; a clip whose own sound matters is not for it. The mask is kept in the work folder; the same frame and subject again cost nothing. A clip larger than 2560×1440 is refused: scale it down first.

The model marks everything but the subject green, so a subject that is itself bright green cannot be cut out this way.

### 3. Look at it

Look at `cutout/<name>/cutout-check.jpg`, the frozen frame at the pop's largest:

- the outline runs around the subject only: no person, floor, second thing or piece of background inside;
- nothing of the subject is cut off;
- the subject is sharp and large enough to be worth it.

Not so: another `--at`, a more exact `--subject`, or no freeze. Never out with a wrong cutout.

### 4. Show it

One sentence and the clip:

```hiccup
[:div
 [:p "The robot pops out at 0:01, then the clip runs on."]
 [:button {:open "artifacts/atlas-pop.mp4"} "Watch ↗"] " "
 [:button {:class "primary" :send "The freeze is good"} "Looks good"]
 [:p [:small "Type what to change: another moment, a softer pop."]]]
```

## For another skill

A skill runs the tool as a program, never imports its code: `FREEZE_CUTOUT` naming `tools/cutout.mjs`, else `<skill>/../freeze-cutout/tools/cutout.mjs` beside it, else `/home/sprite/skills/freeze-cutout/tools/cutout.mjs`. It passes the clip, the output, `--at`, `--subject`, `--work` and, for its band clips, `--region band`; exit 0 means the output is written (and, unless the line says otherwise, `cutout-check.jpg` lies in the work folder for its agent to look at); any other end, with one sentence on stdout, means there is no output and the plain clip is used. Without the tool such a skill says: "The freeze needs agentitos' freeze-cutout skill beside this one (or FREEZE_CUTOUT naming its tools/cutout.mjs)."

## UI in the chat

Short messages in the person's language. A ```hiccup block in your answer becomes part of the page. EDN hiccup, data only. `:send "text"` on a button sends that text as the person's next message; `:open "artifacts/<file>"` shows that file beside the chat.

- One question per block, buttons for the likely answers when a click is the whole answer, and a line that they can type anything else. Several picks from one list: checkboxes and one button whose `:send` holds `{checked}`. Several questions that must all be answered before you go on, none depending on another: one block, a group of radio buttons per question (own `:name`, every `:value` saying what it answers, at most four groups) and one button whose `:send` holds `{checked}`. One question after the other only when it depends on the answer before, or on work the person should see first.
- A button only where a click makes you act at once. Never one that only leads to your next question: they type what to change.
- The button that moves on gets `:class "primary"`; a button that opens an artifact ends with " ↗".
- Never a token, a path of `cutout/` or a raw error in the chat.
