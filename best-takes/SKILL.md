---
name: best-takes
description: Cut one or more raw recordings of someone talking to camera down to the best takes, without slips, repeats, "äh"s or talk about the recording, and even out the loudness between the takes and the videos; show the cut as a HyperFrames preview, ask the person whether it is right, change it until it is, then render the video with subtitles. Use for talking-head clips, product demos, tutorials and vlogs filmed in several attempts, on a phone or a camera.
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

You run in rragent: the chat on the left, the artifacts beside it. `<skill>` below is the folder this file is in. Run the tools as `node <skill>/tools/…` from your working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

## What it needs

Node 20+, ffmpeg, the HyperFrames CLI (the `hyperframes` template needs it too) and OpenRouter: `OPENROUTER_API_KEY` in the environment, or, on a Sprite, the gateway's OpenRouter connection (the tools find it at `http://sprite.internal`; an rragent agent there often has no key of its own). The words come from ElevenLabs Scribe ("äh" included, names spelled right), and Gemini watches the videos and proposes the cut, about two cents a minute of recording in all. Nothing to `npm install`. When something is missing, say so in one sentence instead of installing it yourself.

## From the recordings to the video, all in the chat

The person attaches one video or several (several attempts at the same thing, or parts of one story); their message names each as a line `video: uploads/<file>`. You cut it to the best takes and even out the loudness on your own, **show the cut as a preview beside the chat and ask whether it is right**, change it until it is, and only then render. Before the preview, ask nothing: what they wrote with the upload (a length, "the hook first", a format) goes into the cut; everything else you decide and say what you decided.

Keep every message short: one or two sentences and a hiccup block (see "UI in the chat"). Speak the person's language. Your files: `takes/<name>/` for this cut (`<name>` a short slug of the topic, lowercase letters, digits and dashes). The artifacts: the project `artifacts/<name>/`, the preview, and at the end the video `artifacts/<name>.mp4` with its subtitles.

### 1. The recordings

Say in one sentence that you are listening to the recordings. Then

```bash
node <skill>/tools/takes.mjs new takes/<name> uploads/<file> [uploads/<file2> …] [--target 60] [--aspect 9:16]
```

puts the videos in the order they were recorded (from their files' recording time; `--order given` keeps yours), writes down every word with its time, "äh"s and noises included, measures each video's loudness, and writes `takes/<name>/source/brief.md`: the rules of a good cut and every word, numbered. A minute of video takes a few seconds. `--target` when they asked for a length (seconds), `--aspect` when they asked for a format (`9:16`, `1:1`, `4:5`, `16:9`; else the video's own).

### 2. The cut

```bash
node <skill>/tools/takes.mjs propose takes/<name>
```

sends the videos, small, and the numbered words to Gemini, which watches and listens: it proposes the ranges to keep, names every retry it left out and why, and where something is shown in silence. Half a minute, a few cents. It writes `takes/<name>/proposal.json` in the format of `cut.json` and prints it.

Then read `takes/<name>/source/brief.md`, all of it, and write `takes/<name>/cut.json`: the proposal when it keeps to the brief's rules, else changed where it does not. The model judges the delivery, which the words cannot show; you check the content against the words: nothing lost (facts, names, numbers), no talk about the recording kept, whole sentences, a keep that starts or ends on a stray "und," moved to the next word.

### 3. The preview

Say in one sentence that the preview is coming. Make the project once, with the `project` tool: `create`, name `<name>`, kind `hyperframes`. Then

```bash
node <skill>/tools/takes.mjs build takes/<name> --out artifacts/<name>/composition --title "…"
node <skill>/tools/takes.mjs check takes/<name>
```

`build` turns `cut.json` into the project's composition: every kept piece a clip of the original video, cut in the quiet between two words, each take's level brought to the others', short fades against clicks. Every pause over a second follows the picture: where it stands still the pause is cut (a jump cut), where it moves (a click, a page loading, scrolling) that part stays, muted, and a long one plays faster (a timelapse, up to ×10); `check` lists both. A wait the speaker announces ("let's wait until then", in any language) never goes: the proposal lists it in `"waits"` (check that it did, and add the sentence's last word yourself when it did not), and the build plays it as a timelapse when the picture moves, else holds 3 s before the cut, so the viewer feels the time pass. Nothing is rendered: the player beside the chat plays the pieces straight from the videos and loads again by itself after every build. The title is the topic in the person's words. `check` prints the cut as it plays (piece by piece, with the words), what it leaves out, the levels, and problems: fix every ✗ in `cut.json` and build again; fix a ⚠ unless you have a reason not to (a short piece that is a whole keep, like "Tschüss.", is fine).

### 4. Ask whether it is right

One message: how long it was and is now, what you left out in plain words (each retry and why, the talk about the recording, "the ähs", the pauses cut and the stretches played faster), and what the levels did ("the second video was 11 dB quieter, now both sound the same"), then **ask whether it is right**, with "Looks good" (primary) and the button that shows the preview ("Show the preview ↗"), and a line that they can type what to change. Mention a ⚠ you left on purpose (a take raised a lot, whose room noise rises with it).

### 5. Changes

They say what is wrong; change `cut.json` (or a setting) and build again with the same `--out`: the preview updates by itself. Then check, and ask again as in step 4, saying in one sentence what changed. Typical wishes:

| They say | You do |
| --- | --- |
| "Put back the sentence about …" | find its words in the brief, add or widen a keep |
| "Take the first attempt of …" | swap the two ranges in `cut.json` |
| "Shorter" / "at most 30 s" | `build … --target 30`, drop the weakest parts first, keep the opening and the end |
| "Start with …" | move that keep to the top |
| "The pauses are too short / too long" | `--pause 1.5` (only pauses over 1.5 s are touched), or `"pauses": "keep"` on that keep (its pauses play as they are) |
| "Tighter" / "faster, like a reel" | `--pauses tight`: every pause over 0.4 s goes (with `--pause 0.7` only those over 0.7 s), whatever the picture shows (a talking head; not for a demo whose waits show something) |
| "A hook at the start" | `--hook "Three words that promise"` (6 words or fewer, one `*word*` stands out): a card at the top until the first sentence ends; `--hook ""` takes it out |
| "It looks as if no time passed" / "the wait is gone" | add the last word of the sentence that announces the wait to `"waits"` |
| "That wait / that silence is too long" | it is a pause whose picture moves a little: look at it in `check`; drop it from its keep by ending the keep before it and starting the next after it |
| "That part is too quiet / loud" | `"gain": 3` / `"gain": -3` on its keep |
| "Vertical" / "square" | `--aspect 9:16` / `--aspect 1:1` (with `--fit contain` the whole picture stays, with bars) |
| a word in the subtitles is wrong | `"fixes": {"57": "Pentax"}` |
| "Captions in the picture" / "another caption style" | `takes.mjs captions takes/<name> --style hormozi` (see "Captions in the picture") |

### Captions in the picture

When they ask for captions in the picture ("Untertitel ins Bild", "captions like Hormozi"), or the cut is for a reel and they said nothing against it, offer them once, with the styles as buttons (none marked): **Hormozi** (one to three big words in capitals, the word being said in colour), **Karaoke pill**, **Wipe**, **Clean subtitles** (whole phrases on a soft box, for explainers). Then

```bash
node <skill>/tools/takes.mjs captions takes/<name> --style <style> [--product "<name>"] [--brand brand/DESIGN.md] [--platform <where it goes: reels, tiktok, shorts, story, …>]
```

marks the key words with a model, keeps style and marks in `cut.json` (`"captions"`) and builds again: the preview shows them, on the cut's own words, placed for the frame (16:9 to 9:16). Another style: the same command with another `--style`; a key word too many or too few: edit `cut.json` `captions.highlight` (word numbers) and build; out again: `--off`. It uses agentitos' captions skill beside this one; when it is missing, say so.

### 6. The video

Only after their "looks good". Tell them in one sentence that you are rendering it now (about one and a half times the cut's length). Render with the `render` tool, name `<name>`: it writes `artifacts/<name>.mp4`, the pane shows its progress. Then

```bash
node <skill>/tools/takes.mjs finish takes/<name> artifacts/<name>.mp4
```

brings the whole to −14 LUFS, the loudness Instagram, TikTok and YouTube play at (`--loudness` at build time for another), and writes the subtitles beside it, `artifacts/<name>.srt`. It prints the length, the size and the measured loudness; when it says the video is from before the last build, render again. The video shows beside the chat by itself; say in one sentence that it is ready, with the download links and a button "Publish it". To publish, follow agentitos' **publish-video** (beside this skill) with `artifacts/<name>.mp4`: it checks the video, writes the texts with video-descriptions and schedules it through Storrito; never call Storrito's schedule procedures yourself.

### 7. The next recording

The conversation goes on: `remember` what the person wants every time (a format, a length, "keep my intro") and use it for the next upload without asking. A new topic gets a new `<name>`.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; an `input` is a checkbox or a radio button, and `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block, comma-separated; `:open "artifacts/<name>"` shows the preview. Links and videos point at `https://…`, `artifacts/…` or `uploads/…`. There are no text fields: for a change they type.

- One question per block, buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else. Several picks from one list (accounts, platforms, moments): checkboxes and one button. Several questions that must all be answered before you can go on, none depending on another's answer: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`, or checkboxes), each with its own `:name`, at most four groups, and one button whose `:send` holds `{checked}`; every `:value` says what it answers ("YouTube: public"), as they arrive in one line. An answer that leaves a group out is asked again for that group only. Ask one after the other only when a question depends on the answer before, or on work the person should see first. Nothing ticked where the choice is the person's; the likely answer ticked where it is yours to propose.
- The button that moves on gets `:class "primary"`; the others stay plain.
- A button's text says what happens; its `:send` reads as the person's answer ("The cut is good").
- Never put a token, a word number, a path of `takes/` or a raw error into the chat.

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
- The preview first, the render only after the person's yes.
- Only material the person may use; when it is someone else's, say once that publishing needs its owner's permission.
