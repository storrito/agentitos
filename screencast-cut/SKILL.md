---
name: screencast-cut
description: Cut a screencast recorded from several sources at the same time (the screen, the webcam, a phone's screen or camera, the microphone; rragent's screencast recorder) into one video that shows where the action is. The sources are put on one clock, the voice is cleaned, the shot switches between screen, phone and face and zooms in on what changes, waits play as timelapses, every result is held long enough to see, the agent's own record says when a message was sent and a post went live, and secrets on screen (a token in a link, keys, e-mail addresses) are blurred; show it as a HyperFrames preview, change it by the moment the person names, then render it with captions. Use for product demos, tutorials and walkthroughs recorded with screen, webcam and phone together.
license: MIT
metadata:
  title: "Screencast cut"
  title-de: "Screencast-Schnitt"
  summary: "Your screen, webcam and phone recording cut into one video: always showing where the action is, waits sped up, secrets blurred."
  summary-de: "Deine Aufnahme von Bildschirm, Webcam und Handy in einem Video: immer dort, wo etwas passiert, Wartezeiten gerafft, Geheimes verpixelt."
  ask: "Record your screencast with the recorder (screen, webcam, phone, microphone), or tell me which recording to use. I cut it into one video that switches to where the action is and zooms in, speed up the waits and blur what must not be seen. You see a preview first."
  ask-de: "Nimm deinen Screencast mit dem Recorder auf (Bildschirm, Webcam, Handy, Mikrofon), oder sag mir, welche Aufnahme ich nehmen soll. Ich schneide sie zu einem Video, das immer dorthin wechselt und zoomt, wo etwas passiert, raffe die Wartezeiten und verpixle, was niemand sehen soll. Du siehst zuerst eine Vorschau."
  placeholder: "Which recording?"
  placeholder-de: "Welche Aufnahme?"
  inputs: ""
  templates: [hyperframes]
---

# screencast-cut

You run in rragent: the chat on the left, the artifacts beside it. `<skill>` below is the folder this file is in. Run the tool as `node <skill>/tools/screencast.mjs …` from your working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

## What it needs

Node 22+, ffmpeg, the HyperFrames CLI (the `hyperframes` template needs it too), and OpenRouter: `OPENROUTER_API_KEY`, or on a Sprite the gateway's OpenRouter connection, which the tool finds by itself. The words come from rragent's `transcribe` tool; the look for secrets costs a few cents. Nothing to `npm install`. When something is missing, say so in one sentence instead of installing it yourself.

## From the recording to the video, all in the chat

A recording of rragent's screencast recorder arrives as a message like `New recording in artifacts/recordings/2026-10-23T11-04-56: phone-screen.webm (the phone's screen), screen.webm (the screen), webcam.webm (the webcam)`. When the person asks for a video of it ("make a short of it", "cut this"), you do the steps below on your own, **show the cut as a preview and ask whether it is right**, change it until it is, and only then render. Before the preview, ask nothing: what they asked for (a length, a format, "with captions") goes into the cut; everything else you decide and say what you decided.

Keep every message short: one or two sentences and a hiccup block (see "UI in the chat"). Speak the person's language. Your files: `screencast/<name>/` (`<name>` a short slug of the topic, lowercase letters, digits and dashes). The artifacts: the project `artifacts/<name>/`, the preview, and at the end the video `artifacts/<name>.mp4` with its subtitles.

### 1. The sources

Say in one sentence that you are getting the recording ready. Then

```bash
node <skill>/tools/screencast.mjs new screencast/<name> artifacts/recordings/<time> [--frame 9:16]
```

turns every source into a video the preview plays well, puts them on one clock (recording.json's start times, made exact by their sound), takes the clearest microphone as the voice and cleans it, measures where each picture moves, and reads what the agent did meanwhile (this bot's conversation: the messages sent, the tools called, the answers). A few minutes for a few minutes of recording. `--frame`: `9:16` (the default, for Reels, Stories, TikTok), `16:9`, `1:1`, `4:5`.

### 2. The words

The names a speech model mishears are the ones that matter in a demo (the product, the account). So first gather them: the accounts you know from this conversation (with Storrito connected: `storrito/list-instagram-users` in the REPL), the product, the brand, the people. Then call the **`transcribe` tool** with `file: screencast/<name>/source/voice.m4a`, `words: true`, `names: "<the names, comma-separated>"`, `out: notes/screencast-<name>/voice.md`, and pass its words on:

```bash
node <skill>/tools/screencast.mjs words screencast/<name> artifacts/notes/screencast-<name>/voice.words.json
```

(When your `transcribe` tool has no `words` yet: `node <skill>/tools/screencast.mjs transcribe screencast/<name>` instead, ElevenLabs Scribe without the names; fix a misheard name with `"fixes"` in cut.json.) It writes `screencast/<name>/source/brief.md`: the rules of a good screencast cut, what the agent did when, every sentence with how much each source moves, and every word, numbered.

### 3. The cut

```bash
node <skill>/tools/screencast.mjs propose screencast/<name>
```

drafts `screencast/<name>/proposal.json`: every sentence a keep, its view by what moves, waits where a picture moves or the agent works between two sentences, a hold after "posted", "there it is". It keeps everything and has no story yet. Read `screencast/<name>/source/brief.md`, all of it, and write `screencast/<name>/cut.json` from the proposal: **the result first as a hook** (a few seconds: the post on the phone, the finished page), then the steps in order, then the proof, then a short end; slips, repeats and talk about the recording out; the views where the action is; every wait in `"waits"`; `"hold": 2.5` after a result; `"label"`s when the steps help the viewer; `"fixes"` for a word still spelled wrong.

### 4. The preview

Say in one sentence that the preview is coming. Make the project once, with the `project` tool: `create`, name `<name>`, kind `hyperframes`. Then

```bash
node <skill>/tools/screencast.mjs build screencast/<name> --out artifacts/<name>/composition --title "…"
node <skill>/tools/screencast.mjs privacy screencast/<name>
node <skill>/tools/screencast.mjs check screencast/<name>
```

`build` turns `cut.json` into the project: every piece a shot of its source, zoomed in on where the picture changes, the webcam beside it in a circle; the voice cut in the quiet between words, every take at one level; waits played fast with a badge; labels; the captions' band kept free. `privacy` has a model look at every shot of a screen for what must not be readable (a link with a token, keys, passwords, e-mail addresses, private chats, a phone's notifications) and builds again with a blur over each: **always run it before the person sees the preview**, and again after a change that shows other parts of the screens (check says so). `check` prints the cut as it plays and what to fix: a ✗ always, a ⚠ unless you have a reason (say it).

### 5. Ask whether it is right

One message: how long it was and is now, the story in one line (hook, steps, result), which views it uses, what is sped up, what is blurred, then **ask whether it is right**, with "Looks good" (primary), "Change something", and the button that shows the preview.

### 6. Changes

The person names moments of the preview ("at 0:23 it's cut off", "0:41 should show the phone"). For each:

```bash
node <skill>/tools/screencast.mjs at screencast/<name> 0:23
```

says which piece and keep play there, from where in the recording, in which view, with which words. Change that keep in `cut.json`, build, check (and privacy, when check asks), and ask again as in step 5, saying in one sentence what changed. Typical wishes:

| They say | You do |
| --- | --- |
| "… is cut off" / "too fast at the end" | `"hold": 1.5` (or more) on that keep; when check says the next words follow right after, end the keep a word later |
| "Longer waits should be time-lapses" | the last word before the wait into `"waits"` |
| "Show the phone when …" / "show my face" | `"view": "phone-screen"` / `"face"` on that keep |
| "Too zoomed in" / "zoom on the chat" | `"zoom": "off"` / a box `[x0, y0, x1, y1]` in 0–1 of the source (look at a frame first) |
| "Show that it arrived on the phone" | a keep on the phone's screen after the words, with `"hold"`, or a wait that shows it |
| "Start with …" | move that keep to the top |
| "Longer than a minute is fine" / "at most 45 s" | keep more / drop the weakest keeps first, keep the hook and the proof |
| "That doesn't need to be blurred" | `"off": true` on it in `screencast/<name>/privacy.json`, build |
| "Blur that too" | add it to `privacy.json` `"found"`: `{"source": "screen", "from": <s>, "to": <s>, "what": "…", "box": [x0, y0, x1, y1]}` (times of the recording, the box in 0–1), build |
| "Vertical" / "wide" | `build … --frame 9:16` / `--frame 16:9`, then privacy again |
| "Music under it" | `"music": {"file": "<path>", "volume": 0.3}` in cut.json: lower while someone speaks |
| "Captions" / "another caption style" | `screencast.mjs captions screencast/<name> --style hormozi` (styles: hormozi, karaoke, wipe, clean) |

### Captions in the picture

When they ask for captions, or the cut is for a reel and they said nothing against it, offer them once, the styles as buttons (none marked): **Hormozi**, **Karaoke pill**, **Wipe**, **Clean subtitles**. Then `node <skill>/tools/screencast.mjs captions screencast/<name> --style <style> [--product "<name>"]`: a model marks the key words, the captions go into the band the layout keeps free, in the brand's colour and font when there is a `brand/DESIGN.md`. It uses agentitos' captions skill beside this one; when it is missing, say so.

### 7. The video

Only after their "looks good", and only when `privacy` ran on the cut as it is now. Tell them in one sentence that you are rendering it. Render with the `render` tool, name `<name>`: it writes `artifacts/<name>.mp4`. Then

```bash
node <skill>/tools/screencast.mjs finish screencast/<name> artifacts/<name>.mp4
```

brings it to −14 LUFS, the loudness the platforms play at, and writes `artifacts/<name>.srt`. When it says the video is from before the last build, render again. Say in one sentence that it is ready, with the download links. Publishing it is a step of its own: only when they ask.

### 8. The next recording

`remember` what the person wants every time (a format, a caption style, "my face small", the names) and use it for the next recording without asking. A new recording gets a new `<name>`.

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
  [:li "Blurred: the login link in the address bar."]]
 [:p "Is it right like this?"]
 [:button {:class "primary" :send "The cut is good, make the video"} "Looks good"] " "
 [:button {:send "I want to change something in the cut"} "Change something"] " "
 [:button {:open "artifacts/storrito-demo"} "Show the preview"]
 [:p [:small "Or tell me what should be different, with the moment of the preview: „at 0:23 …“."]]]
```

## Rules

- Never lose content the person said matters; when unsure whether something is a slip, keep it and say so.
- Never show the person a preview, and never render, before `privacy` ran on the cut as it is.
- Change `cut.json`, `privacy.json` or an option and build again; never edit the built `index.html` by hand.
- The preview first, the render only after the person's yes; publishing only when they ask.
