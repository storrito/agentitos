---
name: screencast-cut
description: Cut a screencast recorded from several sources at once (screen, webcam, phone, mic; rragent's recorder) into one video that zooms to the action and speeds up waits; preview, change, render with captions.
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

You run in rragent: chat left, artifacts beside it. `<skill>` is this file's folder. Run `node <skill>/tools/screencast.mjs …` from your working directory; never change files in `<skill>`. `node <skill>/tools/screencast.mjs --help` lists every command and option. Full reference: [README.md](README.md), only when this file, `--help` and the tool's own output leave a question open.

Every file you read stays in the conversation and slows each later step. So: don't read the tool's source (`<skill>/tools/`) to learn how to use it, its output says what comes next and what to fix; only when it does not do what it should. The build makes the whole composition, so the HyperFrames, platform-zones and media-use skills and their references are not needed here: don't read them.

## What it needs

Node 20+, ffmpeg, the HyperFrames CLI, agentitos' `platform-zones` and `captions` skills beside this one, and OpenRouter (`OPENROUTER_API_KEY`, or on a Sprite the gateway's connection, found by itself) for the webcam face and the captions' key words, well under a cent. The words come from rragent's `transcribe` tool. Nothing to `npm install`; when something is missing, say so in one sentence.

## From the recording to the video

A recording arrives as a message like `New recording in artifacts/recordings/2026-10-23T11-04-56: screen.webm (the screen), webcam.webm (the webcam)`. When the person asks for a video of it, do the steps on your own, show a preview, change it until they like it, then render. Before the preview ask nothing: what they asked for (a length, a format) goes in, the rest you decide and say in a line.

Messages: one or two sentences and a hiccup block, in their language. Files: `screencast/<name>/` (`<name>` a short slug); the project `artifacts/<name>/`; at the end `artifacts/<name>.mp4`.

### 1. The sources

First, in a message of its own, say that you are getting the recording ready and it takes a minute or two. Then, as a command of its own:

```bash
node <skill>/tools/screencast.mjs new screencast/<name> artifacts/recordings/<time> [artifacts/recordings/<time2> …] [--frame 9:16]
```

It puts the sources on one clock, cleans the voice, measures movement and finds the webcam face. `--frame` 9:16 (default), 16:9, 1:1, 4:5. **Several recordings** for one video (the person stopped and recorded again): all their folders in the order they were recorded, in one `new`; never join them yourself.

It converts about a minute of three sources in 30 s. Your bash stops a command after a few minutes: for recordings over five minutes in all, run it in the background (`mkdir -p screencast/<name> && nohup node <skill>/tools/screencast.mjs new … > screencast/<name>/new.log 2>&1 &`) and read the log's end every minute until it says "Next". Meanwhile only the log: no frames or probes of the recording of your own, the sheets (step 3) show what you need. A `new` that was cut off goes on where it stopped when you run the same command again.

### 2. The words

Call the **`transcribe` tool** with `file: screencast/<name>/source/voice.m4a`, `words: true`, `names:` the product, brand, accounts and people that may be said, `out: notes/screencast-<name>/voice.md`, then

```bash
node <skill>/tools/screencast.mjs words screencast/<name> artifacts/notes/screencast-<name>/voice.words.json
```

(Without `words` in your transcribe tool: `screencast.mjs transcribe screencast/<name>`, which needs agentitos' `transcribe` skill beside this one.) It writes `source/brief.md`: every sentence with its word numbers and how much each source moves.

### 3. The cut

```bash
node <skill>/tools/screencast.mjs propose screencast/<name>
node <skill>/tools/screencast.mjs sheets screencast/<name> --proposal
```

`propose` makes every sentence a keep (`proposal.json`); `sheets` makes one image per keep with every source at its first, middle and last moment, screens with a line every tenth. Read the brief and the sheets yourself (no subagent: it reads them again from scratch and takes longer) and write `screencast/<name>/cut.json`:

- **The story:** the result first as a short hook (`"hook": true`, stays in its place later too), then the steps, then the proof. The hook is a whole sentence from its first word, without a slip or a restart in it: a few seconds longer rather than one that starts mid-sentence; slips, repeats and talk about the recording out. The hook is something that works and is seen: never a limitation or what is missing ("the music sticker is missing" was turned down as an opening), which goes later, briefly, where it happens. A take that went wrong (the person says so, or it ends in an error) is left out whole. `"waits"`: the last word before something takes time (an agent working, an upload), played fast. `"hold": 2.5` after a result.
- **`"zoom"`:** the part of the screen the words are about and that must be readable, `[x0, y0, x1, y1]` in 0–1 off the sheet's grid (the field being typed in, the answer, the list being picked from). The tool enlarges it as far as the safe area allows (up to twice its pixels) and shows the rest around it, under the apps' buttons too, so a tight box is right: around the content, never the page's empty margins beside it, but the content whole: the first and last letters of its lines inside the box (letters cut off at the left were turned down). When what matters moves within a keep, split the keep at that word. No zoom shows the whole screen, small in 9:16.
- **A phone's screen:** shown whole, `"zoom": "off"`, the phone's bars and the app's buttons included: they show it is the real app on a real phone. With `"circle": false` it takes the frame's whole height above the captions: when they want the phone larger, that is the answer, not a zoom that cuts its bars off. A zoom on a phone only when the person asks for one.
- **What happens without words** (a box ticked, a button pressed, a result coming in while the person is quiet): a keep by its time, `{"at": "7:01.5-7:06", "zoom": [...], "why": "…"}`, the picture alone. Find the moment with the brief's "moves" column and `frame`.
- **`"view"`** only where it is not the screen: `phone-screen` when the words are about the phone, `face` for a sentence or two at most (an opening line, the last words). The screen is what people came for.
- **`"show"`:** another video instead of the recording while a keep's words play: the finished result (the posted Story, the rendered video) or a clip the person gives, where the recording shows something else (a wrong tap, another Story, the way back). `"show": {"file": "uploads/….mp4", "from": 0, "sound": 0.8}`: its picture whole over the keep, the keep's long pauses cut, a `"hold"` after the words lets it play on; its sound only with `"sound"` (0–1), quiet under the first words and rising to that level by the keep's last word. A Story's music is added by Instagram: only the posted Story (downloaded or recorded on the phone) has it; when that is what they want to hear, ask them for the file.
- `"label"` where a step title helps ("01 · Upload").

Captions (clean subtitles), the face in a circle, the blurred screen behind the shot and a slow speaker played a little faster come by themselves.

### 4. The preview

Make the project once with the `project` tool (`create`, name `<name>`, kind `hyperframes`), then

```bash
node <skill>/tools/screencast.mjs build screencast/<name> --out artifacts/<name>/composition --title "…" [--platform reels]
node <skill>/tools/screencast.mjs check screencast/<name>
```

Fix every ✗, and each ⚠ unless you have a reason. Look at two or three screen moments with `frame` (step 6): is what the words are about large and readable? Before you ask (step 5), once, in `artifacts/<name>/composition`, with its long output filtered:

```bash
npx hyperframes check --json 2>/dev/null | jq -c '{ok, problems: [.. | objects | select(.severity? == "error" or .severity? == "warning") | {code, severity, message, time}] | unique_by(.code, .time)}'
```

Fix its errors (text hidden under the face circle, a label off the frame). No `hyperframes snapshot --review` and no rounds of snapshots: `frame` and the check are the review.

The cut lives in `cut.json`: no notes files (SPEC.md, REVIEW.md, a README) in the project or beside it.

### 5. Ask whether it is right

One message: length before and now, the story in one line, what is sped up; "Looks good" (primary), "Show the preview ↗", and a line that they can type what to change with the moment ("at 0:23 …").

### 6. Changes

For a moment they name, `screencast.mjs at screencast/<name> 0:23` says which keep plays there; `frame screencast/<name> 0:23` saves that moment's source with a grid and the shot's zoom in red. Read `<skill>/references/changes.md` before changing the cut. Change the keep in `cut.json`, build, check, ask again in one sentence.

### 7. The video

Only after their "looks good". Render with the `render` tool, name `<name>` (→ `artifacts/<name>.mp4`), then

```bash
node <skill>/tools/screencast.mjs finish screencast/<name> artifacts/<name>.mp4
```

(−14 LUFS, and the `.srt`). When it says the video is from before the last build, render again. Then the download links in one sentence and a button "Publish it": to publish, follow agentitos' **publish-video** with `artifacts/<name>.mp4`; never call Storrito's schedule procedures yourself.

`remember` what they want every time (a speed, a caption style, "my face small") and use it for their next recording.

## An Instagram Story

When one of the targets is an Instagram Story, it can carry Instagram's own stickers: a link to the page, a poll, a question, a countdown. Ask once which one fits (the likely one ticked: a link when there is a page to go to; "none" is an answer too). Then read `<skill>/references/instagram-story.md` before planning the scenes and adding the stickers. Never draw a sticker, a "link in bio" or an arrow to a link into the Story's video: Storrito lays the real stickers over it, and Instagram makes them tappable.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; an `input` is a checkbox or radio button, and `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block, comma-separated; `:open "artifacts/<name>"` shows the preview. Links and videos point at `https://…`, `artifacts/…` or `uploads/…`. No text fields: for a change they type.

- One question per block, buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else, a moment of the preview included ("at 0:23 …"). Several picks from one list (accounts, platforms, moments): checkboxes and one button. Several independent questions that must all be answered before you go on: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`, or checkboxes), each its own `:name`, at most four groups, one button whose `:send` holds `{checked}`; every `:value` says what it answers ("YouTube: public"). An answer missing a group: ask again for that group only. One question after the other only when it depends on the answer before or on work the person should see first. Nothing ticked where the choice is the person's; the likely answer ticked where it is yours to propose.
- The button that moves on gets `:class "primary"`; the others stay plain.
- Never a token, a word number, a `screencast/` path or a raw error in the chat.

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
- When the tool cannot do what they ask, say so in a sentence and offer the nearest it can; never copy or patch its files. The nearest keeps everything they asked to keep: never drop a sentence or a step they named in its place.
- Publishing only when they ask.
