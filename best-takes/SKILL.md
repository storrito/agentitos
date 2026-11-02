---
name: best-takes
description: Cut one or several raw talking-to-camera recordings to the best takes (no slips, repeats, ähs or recording talk), loudness evened, agreed as a HyperFrames preview, then rendered with subtitles.
license: MIT
metadata:
  title: "Best takes"
  title-de: "Beste Takes"
  summary: "Your recordings cut to the best takes: slips, repeats and ums out, every part equally loud; a preview first, then the video."
  summary-de: "Deine Aufnahmen auf die besten Takes geschnitten: Versprecher, Wiederholungen und Ähs raus, alles gleich laut; erst eine Vorschau, dann das Video."
  ask: "Upload your video, or several recordings of the same thing. I cut it to the best takes, take out slips, ums and repeated sentences and even out the loudness. You see a preview first and tell me whether it is right."
  ask-de: "Lade dein Video hoch, oder mehrere Aufnahmen zum selben Thema. Ich schneide es auf die besten Takes, nehme Versprecher, Ähs und wiederholte Sätze raus und gleiche die Lautstärke an. Du siehst zuerst eine Vorschau und sagst mir, ob es so passt."
  placeholder: "Upload a video"
  placeholder-de: "Video hochladen"
  inputs: "video"
  templates: [hyperframes]
---

# best-takes

You run in rragent: chat left, artifacts beside it. `<skill>` is this file's folder. Run the tools as `node <skill>/tools/…` from your working directory; never change files in `<skill>`. Full reference: [README.md](README.md).

## What it needs

Node 20+, ffmpeg, the HyperFrames CLI, agentitos' `transcribe` skill beside this one, and OpenRouter: `OPENROUTER_API_KEY`, or on a Sprite the gateway's connection (found at `http://sprite.internal`; an rragent agent there often has no key). Words from ElevenLabs Scribe ("äh" included), the cut proposed by Gemini watching the videos: about two cents a minute of recording. Nothing to `npm install`; when something is missing, say so in one sentence, never install it.

## From the recordings to the video, all in the chat

The person attaches one or several videos (attempts at the same thing, or parts of one story), each named in their message as `video: uploads/<file>`. Cut and level on your own, **show the cut as a preview and ask whether it is right**, change it until it is, only then render. Before the preview ask nothing: what they wrote (a length, "the hook first", a format) goes into the cut; the rest you decide and say what you decided.

Messages: one or two sentences and a hiccup block, in the person's language. Files: `takes/<name>/` (`<name>` a short slug of the topic: lowercase letters, digits, dashes). Artifacts: the project `artifacts/<name>/`, at the end `artifacts/<name>.mp4` with its subtitles.

### 1. The recordings

Say in one sentence that you are listening to the recordings. Then

```bash
node <skill>/tools/takes.mjs new takes/<name> uploads/<file> [uploads/<file2> …] [--target 60] [--aspect 9:16]
```

orders the videos by recording time (`--order given` keeps yours), transcribes every word with its time ("äh"s and noises included), measures loudness and writes `takes/<name>/source/brief.md`: the rules of a good cut and every word, numbered. A few seconds per minute of video. `--target` (seconds) when they asked for a length, `--aspect` (`9:16`, `1:1`, `4:5`, `16:9`; else the video's own) when they asked for a format.

### 2. The cut

```bash
node <skill>/tools/takes.mjs propose takes/<name>
```

Gemini watches the videos and the numbered words and proposes the keeps, every retry left out and why, and where something is shown in silence: `takes/<name>/proposal.json` (the format of `cut.json`), printed. Half a minute, a few cents.

Then read all of `takes/<name>/source/brief.md` and write `takes/<name>/cut.json`: the proposal where it keeps to the brief's rules, changed where not. The model judges the delivery; you check the content against the words: nothing lost (facts, names, numbers), no talk about the recording kept, whole sentences, a keep starting or ending on a stray "und," moved to the next word.

### 3. The preview

Say in one sentence that the preview is coming. Make the project once with the `project` tool: `create`, name `<name>`, kind `hyperframes`. Then

```bash
node <skill>/tools/takes.mjs build takes/<name> --out artifacts/<name>/composition --title "…"
node <skill>/tools/takes.mjs check takes/<name>
```

The title is the topic in the person's words. `build` cuts between words, evens each take's level and handles pauses over a second by the picture: still → jump cut; moving (a click, a page loading) → kept muted, a long one as a timelapse (up to ×10). A wait the speaker announces ("let's wait until then", any language) never goes (a timelapse when the picture moves, else held 3 s before the cut): the proposal lists it in `"waits"`; check that it did and add the sentence's last word yourself when not. The player beside the chat reloads after every build; nothing is rendered. `check` prints the cut piece by piece with the words, what it leaves out, the levels and problems: fix every ✗ in `cut.json` and build again; fix a ⚠ unless you have a reason (a short piece that is a whole keep, like "Tschüss.", is fine).

### 4. Ask whether it is right

One message: length before and now, what you left out in plain words (each retry and why, the talk about the recording, the ähs, pauses cut, stretches played faster), what the levels did ("the second video was 11 dB quieter, now both sound the same"), then **ask whether it is right**: "Looks good" (primary), "Show the preview ↗", and a line that they can type what to change. Mention a ⚠ you left on purpose (a take raised a lot, whose room noise rises with it).

### 5. Changes

Read `<skill>/references/changes.md` before making a change they ask for. Change `cut.json` (or a setting), build again with the same `--out` (the preview updates by itself), check, and ask again as in step 4, saying in one sentence what changed.

### Captions in the picture

When they ask for captions in the picture ("Untertitel ins Bild", "like Hormozi"), or the cut is for a reel and they said nothing against it, offer them once, the styles as buttons (none marked): **Hormozi** (one to three big words in capitals, the word being said in colour), **Karaoke pill**, **Wipe**, **Clean subtitles** (whole phrases on a soft box, for explainers). Then

```bash
node <skill>/tools/takes.mjs captions takes/<name> --style <style> [--product "<name>"] [--brand brand/DESIGN.md] [--platform <reels, tiktok, shorts, story, …>]
```

marks key words with a model, keeps style and marks in `cut.json` (`"captions"`) and builds again; placed for any frame from 16:9 to 9:16. Another style: same command, other `--style`; a key word too many or too few: edit `captions.highlight` (word numbers) in `cut.json` and build; out again: `--off`. It needs agentitos' captions skill beside this one; when missing, say so.

### 6. The video

Only after their "looks good". Say in one sentence that you are rendering it (about 1.5× the cut's length). Render with the `render` tool, name `<name>` (→ `artifacts/<name>.mp4`, progress in the pane). Then

```bash
node <skill>/tools/takes.mjs finish takes/<name> artifacts/<name>.mp4
```

brings it to −14 LUFS, the loudness Instagram, TikTok and YouTube play at (`--loudness` at build time for another), and writes `artifacts/<name>.srt`; it prints length, size and loudness. When it says the video is from before the last build, render again. Then say in one sentence that it is ready, with the download links and a button "Publish it". To publish, follow agentitos' **publish-video** (beside this skill) with `artifacts/<name>.mp4`; never call Storrito's schedule procedures yourself.

### 7. The next recording

`remember` what the person wants every time (a format, a length, "keep my intro") and apply it to the next upload without asking. A new topic gets a new `<name>`.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; an `input` is a checkbox or radio button, and `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block, comma-separated; `:open "artifacts/<name>"` shows the preview. Links and videos point at `https://…`, `artifacts/…` or `uploads/…`. No text fields: for a change they type.

- One question per block, buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else. Several picks from one list (accounts, platforms, moments): checkboxes and one button. Several independent questions that must all be answered before you go on: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`, or checkboxes), each its own `:name`, at most four groups, one button whose `:send` holds `{checked}`; every `:value` says what it answers ("YouTube: public"). An answer missing a group: ask again for that group only. One question after the other only when it depends on the answer before or on work the person should see first. Nothing ticked where the choice is the person's; the likely answer ticked where it is yours to propose.
- The button that moves on gets `:class "primary"`; the others stay plain.
- A button's text says what happens; its `:send` reads as the person's answer ("The cut is good").
- Never a token, a word number, a `takes/` path or a raw error in the chat.

The question after the preview:

```hiccup
[:div
 [:p [:strong "1:46 → 1:13"] " · from two recordings"]
 [:ul
  [:li "Left out: the start (" [:em "„Ich lass die AI das gleich schneiden“"] ") and the ending about the AI, the goodbye stays."]
  [:li "Two sentences you said twice: the second, fluent one stays."]
  [:li "Seven „ähs“ and five long pauses are out; the login plays three times as fast."]
  [:li "The second recording was 11 dB quieter: now both are equally loud."]]
 [:p "Is it right like this?"]
 [:button {:class "primary" :send "The cut is good, make the video"} "Looks good"] " "
 [:button {:open "artifacts/kameras"} "Show the preview ↗"]
 [:p [:small "Or tell me what should be different."]]]
```

The finished video:

```hiccup
[:div
 [:p "Your video is ready: 1:13, at the loudness the platforms play."]
 [:a {:href "artifacts/kameras.mp4" :download "kameras.mp4"} "Download the video"] " · "
 [:a {:href "artifacts/kameras.srt" :download "kameras.srt"} "Subtitles (SRT)"]
 [:p [:button {:send "Publish the video"} "Publish it"]]]
```

## Rules

- Never lose content: when unsure whether something is a retry, keep both and say so.
- Change `cut.json` or a setting and build again; never edit the built `index.html` by hand.
- Only material the person may use; when it is someone else's, say once that publishing needs its owner's permission.
