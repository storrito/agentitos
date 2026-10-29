---
name: screencast-cut
description: Cut a screencast recorded from several sources at the same time (the screen, the webcam, a phone's screen or camera, the microphone; rragent's screencast recorder) into one video that shows where the action is. The sources are put on one clock, the voice is cleaned, the shot switches between screen, phone and face and zooms in on what changes, waits play as timelapses, and every result is held long enough to see; show it as a HyperFrames preview, change it by the moment the person names, then render it with captions. Use for product demos, tutorials and walkthroughs recorded with screen, webcam and phone together.
license: MIT
metadata:
  title: "Screencast cut"
  title-de: "Screencast-Schnitt"
  summary: "Your screen, webcam and phone recording cut into one video: always showing where the action is, zoomed in, waits sped up."
  summary-de: "Deine Aufnahme von Bildschirm, Webcam und Handy in einem Video: immer dort, wo etwas passiert, herangezoomt, Wartezeiten gerafft."
  ask: "Record your screencast with the recorder (screen, webcam, phone, microphone), or tell me which recording to use. I cut it into one video that switches to where the action is and zooms in and speed up the waits. You see a preview first."
  ask-de: "Nimm deinen Screencast mit dem Recorder auf (Bildschirm, Webcam, Handy, Mikrofon), oder sag mir, welche Aufnahme ich nehmen soll. Ich schneide sie zu einem Video, das immer dorthin wechselt und zoomt, wo etwas passiert, und raffe die Wartezeiten. Du siehst zuerst eine Vorschau."
  placeholder: "Which recording?"
  placeholder-de: "Welche Aufnahme?"
  inputs: ""
  templates: [hyperframes]
---

# screencast-cut

You run in rragent: the chat on the left, the artifacts beside it. `<skill>` below is the folder this file is in. Run the tool as `node <skill>/tools/screencast.mjs …` from your working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

## What it needs

Node 20+, ffmpeg, the HyperFrames CLI, agentitos' `platform-zones` and `captions` skills beside this one, and OpenRouter (`OPENROUTER_API_KEY`, or on a Sprite the gateway's connection, found by itself) for the face in the webcam and the captions' key words, well under a cent. The words come from rragent's `transcribe` tool. Nothing to `npm install`; when something is missing, say so in one sentence.

## From the recording to the video

A recording arrives as a message like `New recording in artifacts/recordings/2026-10-23T11-04-56: screen.webm (the screen), webcam.webm (the webcam)`. When the person asks for a video of it, do the steps on your own, show a preview, change it until they like it, then render. Before the preview ask nothing: what they asked for (a length, a format) goes in, the rest you decide and say in a line.

Short messages in their language, one or two sentences and a hiccup block. Your files: `screencast/<name>/` (`<name>` a short slug); the project `artifacts/<name>/`; at the end `artifacts/<name>.mp4`.

### 1. The sources

First tell them in a message of its own that you are getting the recording ready and it takes a minute or two. Then, as a command of its own:

```bash
node <skill>/tools/screencast.mjs new screencast/<name> artifacts/recordings/<time> [--frame 9:16]
```

It puts the sources on one clock, cleans the voice, measures where each picture moves and finds the face in the webcam. `--frame` 9:16 (default), 16:9, 1:1, 4:5.

### 2. The words

Call the **`transcribe` tool** with `file: screencast/<name>/source/voice.m4a`, `words: true`, `names:` the product, brand, accounts and people that may be said, `out: notes/screencast-<name>/voice.md`, then

```bash
node <skill>/tools/screencast.mjs words screencast/<name> artifacts/notes/screencast-<name>/voice.words.json
```

(Without `words` in your transcribe tool: `screencast.mjs transcribe screencast/<name>`.) It writes `source/brief.md`: every sentence with its word numbers and how much each source moves.

### 3. The cut

```bash
node <skill>/tools/screencast.mjs propose screencast/<name>
node <skill>/tools/screencast.mjs sheets screencast/<name> --proposal
```

`propose` makes every sentence a keep (`proposal.json`); `sheets` makes one image per keep with every source at its first, middle and last moment, the screens with a line every tenth. Read the brief and the sheets and write `screencast/<name>/cut.json`:

- **The story:** the result first as a short hook (`"hook": true`, kept in its place later too), then the steps, then the proof; slips, repeats and talk about the recording out. `"waits"`: the last word before something takes time (an agent working, an upload), played fast. `"hold": 2.5` after a result.
- **`"zoom"`:** the part of the screen the words are about and that must be readable, `[x0, y0, x1, y1]` in 0–1 off the sheet's grid: the field being typed in, the answer, the list being picked from. The tool makes that part as large as the safe area allows and shows the rest of the screen around it, under the apps' buttons too, so a tight box is right. When what matters moves within a keep, split the keep at that word. No zoom shows the whole screen, small in 9:16.
- **`"view"`** only where it is not the screen: `phone-screen` when the words are about the phone, `face` for a sentence or two at most (an opening line, the last words). The screen is what people came for.
- `"label"` where a step title helps ("01 · Upload").

Captions (clean subtitles), the face in a circle, the blurred screen behind the shot and a slow speaker played a little faster come by themselves.

### 4. The preview

Make the project once with the `project` tool (`create`, name `<name>`, kind `hyperframes`), then

```bash
node <skill>/tools/screencast.mjs build screencast/<name> --out artifacts/<name>/composition --title "…" [--platform reels]
node <skill>/tools/screencast.mjs check screencast/<name>
```

Fix every ✗, and each ⚠ unless you have a reason. Look at two or three screen moments with `frame` (below): is what the words are about large and readable?

### 5. Ask whether it is right

One message: how long it was and is now, the story in one line, what is sped up; "Looks good" (primary), "Show the preview ↗", and a line that they can type what to change with the moment ("at 0:23 …").

### 6. Changes

For a moment they name, `screencast.mjs at screencast/<name> 0:23` says which keep plays there; `frame screencast/<name> 0:23` saves that moment's source with a grid and the shot's zoom in red. Change the keep in `cut.json`, build, check, ask again in one sentence.

| They say | You do |
| --- | --- |
| "Too small" / "show more of …" / "zoom on …" | a tighter or other `"zoom"` on that keep, from `frame` |
| "… is cut off" / "too fast at the end" | `"hold": 1.5` on that keep, or end it a word later |
| "Faster" / "slower" / "as I spoke" | `build … --speed 1.3` / `--speed 1.1` / `--speed 1` (by default the build speeds a slow speaker up to 1.2× by itself and says so; the voice keeps its pitch) |
| "Show the phone" / "show my face" | `"view": "phone-screen"` / `"face"` on that keep |
| "Hide my face here" | `"circle": false` on that keep: the screen takes its room too |
| "No background" / "plain background" | `"background": "plain"` in cut.json (the brand's colours) |
| "Other captions" / "no captions" | `screencast.mjs captions screencast/<name> --style hormozi` (karaoke, wipe, clean) / `--off` |
| "Longer waits as time-lapses" | the last word before it into `"waits"` |
| "Start with …" | move that keep to the top |
| "Vertical" / "square" / "for TikTok" | `build … --frame 9:16` / `1:1` / `--platform tiktok` |
| "Hide that" (a password on screen) | a `"zoom"` past it, or another `"view"` |
| "Music under it" | `"music": {"file": "<path>", "volume": 0.3}` |

### 7. The video

Only after their "looks good". Render with the `render` tool, name `<name>` (→ `artifacts/<name>.mp4`), then

```bash
node <skill>/tools/screencast.mjs finish screencast/<name> artifacts/<name>.mp4
```

(−14 LUFS, and the `.srt`). When it says the video is from before the last build, render again. Then the download links in one sentence; publishing only when they ask.

`remember` what they want every time (a speed, a caption style, "my face small") and use it for their next recording.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; `:open "artifacts/<name>"` shows the preview. Links and videos point at `https://…`, `artifacts/…` or `uploads/…`. There are no text fields: for a change they type.

- One question per block, buttons for the likely answers, and a hint that they can type anything else, a moment of the preview included ("at 0:23 …").
- The button that moves on gets `:class "primary"`; the others stay plain.
- Never put a token, a word number, a path of `screencast/` or a raw error into the chat.

The question after the preview:

```hiccup
[:div
 [:p [:strong "4:22 → 1:08"] " · screen, phone and you"]
 [:ul
  [:li "Opens with the reel on your phone, then: the question to the agent, the upload, the prompt, the reel and the story going live."]
  [:li "The agent's work and the posting play 10× faster; the waits on the phone 6×."]
  [:li "Zoomed in on the chat and the Storrito page; the phone shown whole."]]
 [:p "Is it right like this?"]
 [:button {:class "primary" :send "The cut is good, make the video"} "Looks good"] " "
 [:button {:open "artifacts/storrito-demo"} "Show the preview ↗"]
 [:p [:small "Or tell me what should be different, with the moment of the preview: „at 0:23 …“."]]]
```

## Rules

- Never lose content the person said matters; when unsure whether something is a slip, keep it and say so.
- Change `cut.json` or an option and build again; never edit the built `index.html` by hand.
- When the tool cannot do what they ask, say so in a sentence and offer the nearest it can; never copy or patch its files.
- The preview first, the render only after the person's yes; publishing only when they ask.
