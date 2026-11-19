---
name: best-takes
description: Cut one or several raw talking-to-camera recordings, or a voice recorded alone, to the best takes (no slips, repeats, ähs or recording talk), loudness evened; a video agreed as a HyperFrames preview, then rendered with subtitles, a voice as the clean narration with every word's time.
license: MIT
metadata:
  title: "Best takes"
  title-de: "Beste Takes"
  summary: "Your recordings cut to the best takes: slips, repeats and ums out, every part equally loud; a preview first, then the video, or the clean voice."
  summary-de: "Deine Aufnahmen auf die besten Takes geschnitten: Versprecher, Wiederholungen und Ähs raus, alles gleich laut; erst eine Vorschau, dann das Video oder die saubere Sprachaufnahme."
  ask: "Upload your video or your voice recording, or several recordings of the same thing. I cut it to the best takes, take out slips, ums and repeated sentences and even out the loudness. You see or hear it first and tell me whether it is right."
  ask-de: "Lade dein Video oder deine Sprachaufnahme hoch, oder mehrere Aufnahmen zum selben Thema. Ich schneide sie auf die besten Takes, nehme Versprecher, Ähs und wiederholte Sätze raus und gleiche die Lautstärke an. Du siehst oder hörst es zuerst und sagst mir, ob es so passt."
  placeholder: "Upload a video or a voice recording"
  placeholder-de: "Video oder Sprachaufnahme hochladen"
  inputs: "video, audio"
  templates: [hyperframes]
---

# best-takes

You run in rragent: chat left, artifacts beside it. `<skill>` is this file's folder. Run the tools as `node <skill>/tools/…` from your working directory; never change files in `<skill>`. Full reference: [README.md](README.md).

## What it needs

Node 20+, ffmpeg, the HyperFrames CLI (not for a voice alone), agentitos' `transcribe` skill beside this one, for the faces its `clips` and `layout` skills, for b-roll its `b-roll` skill, and OpenRouter: `OPENROUTER_API_KEY`, or on a Sprite the gateway's connection (found at `http://sprite.internal`; an rragent agent there often has no key). Words from ElevenLabs Scribe ("äh" included), the cut proposed by Gemini watching the videos: about two cents a minute of recording. Nothing to `npm install`; when something is missing, say so in one sentence, never install it.

## From the recordings to the video, all in the chat

The person attaches one or several videos (attempts at the same thing, or parts of one story), each named in their message as `video: uploads/<file>`. Cut and level on your own, **show the cut as a preview and ask whether it is right**, change it until it is, only then render. Before the preview ask nothing: what they wrote (a length, "the hook first", a format) goes into the cut; the rest you decide and say what you decided.

Messages: one or two sentences and a hiccup block, in the person's language. Files: `takes/<name>/` (`<name>` a short slug of the topic: lowercase letters, digits, dashes). Artifacts: the project `artifacts/<name>/`, at the end `artifacts/<name>.mp4` with its subtitles.

### 1. The recordings

Say in one sentence that you are listening to the recordings. Then

```bash
node <skill>/tools/takes.mjs new takes/<name> uploads/<file> [uploads/<file2> …] [--target 60] [--aspect 9:16]
```

orders the videos by recording time (`--order given` keeps yours), transcribes every word with its time ("äh"s and noises included), measures loudness and writes `takes/<name>/source/brief.md`: the rules of a good cut and every word, numbered. A few seconds per minute of video. `--target` (seconds) when they asked for a length, `--aspect` (`9:16`, `1:1`, `4:5`, `16:9`; else the video's own) when they asked for a format.

A voice recorded alone (`audio: uploads/<file>`: MP3, M4A, WAV, or a video file without a picture) goes the same way: all recordings of one cut are videos, or all are sound alone. It has no picture, so a pause over a second inside a keep is cut and the tool lays the room's own quiet between the stretches instead (0.42 s after a sentence, 0.2 s inside one).

`(speech not written down, 1.7 s)` in the words is voice the speech model wrote no words for, even when heard again: nearly always an attempt it skipped. It is never a pause; the brief's rule 2 says what to do with it.

### 2. The cut

```bash
node <skill>/tools/takes.mjs propose takes/<name>
```

Gemini watches the videos (or listens to the voice) and the numbered words and proposes the keeps, every retry left out and why, and where something is shown in silence: `takes/<name>/proposal.json` (the format of `cut.json`), printed. Half a minute, a few cents.

Then read all of `takes/<name>/source/brief.md` and write `takes/<name>/cut.json`: the proposal where it keeps to the brief's rules, changed where not. The model judges the delivery; you check the content against the words: nothing lost (facts, names, numbers), no talk about the recording kept, whole sentences, a keep starting or ending on a stray "und," moved to the next word, no keep across speech not written down unless it holds the start of the kept attempt (`"unwritten": "keep"`). For a voice alone, give a keep that begins a new part `"breath": 1` (a second of the room's quiet before it).

### 3. The preview

Say in one sentence that the preview is coming. Make the project once with the `project` tool: `create`, name `<name>`, kind `hyperframes`. Then

```bash
node <skill>/tools/takes.mjs build takes/<name> --out artifacts/<name>/composition --title "…"
node <skill>/tools/takes.mjs check takes/<name>
```

The title is the topic in the person's words. `build` cuts between words, evens each take's level and handles pauses over a second by the picture: moving no more than while the person speaks (a face, a hand-held phone) → jump cut; something moving clearly more (a thing held into the picture, a click, a page loading) → kept muted, a long one as a timelapse (up to ×10); a silent moment worth seeing that it cannot measure (a look, a reaction) is yours to keep with `"pauses": "keep"` on its keep. A wait the speaker announces ("let's wait until then", any language) never goes (a timelapse when the picture moves, else held 3 s before the cut): the proposal lists it in `"waits"`; check that it did and add the sentence's last word yourself when not. The player beside the chat reloads after every build; nothing is rendered. It also writes the cut's voice as one file, `takes/<name>/voice.cut.m4a`: with the words of `takes/<name>/edit.json`, timed in the cut, that is what another skill takes when its pictures are to follow this voice. `check` prints the cut piece by piece with the words, what it leaves out, each pause with what it did and why, the levels and problems: fix every ✗ in `cut.json` and build again; fix a ⚠ unless you have a reason (a short piece that is a whole keep, like "Tschüss.", is fine). Where a skill that framed the videos left `source/faces.json` and `place.json` (clips does), the captions and the hook stand where `place.json` says and `check` names text that lies on a face; that skill's own step (clips' `place`) changes it, never an edit of `place.json` by hand.

### 3b. The faces, and where the picture and the text go

On your own (no other skill framed the videos), after the first build:

```bash
node <skill>/tools/takes.mjs faces takes/<name>
node <skill>/tools/takes.mjs place takes/<name>
```

`faces` finds every face of each video over time (a model on stills of it, followed between them): 2 to 4 cents and 40 to 100 s for a take of a minute, once per recording. `place` (free, a few seconds; it builds again) keeps an upright video as it is, places a wide one by layout's order for a speaker (covering the frame where that is enlarged 2× at most with the face's eyes, nose and mouth inside, else cropped around the speaker), sets the captions in one place clear of the face, raises the picture where a chin would reach into them, puts the hook on no face, and writes `takes/<name>/placed.sheet.jpg` with layout's first three pictures: look at it and choose. Run `place` again after a change of the cut, the caption style or the hook (build and check say so). Where the person does not want their video seen by a model, or `faces` finds no face in a take of a person: the faces by your own eyes (`faces --grid`, then `--eye`), as `<skill>/references/place.md` says. Skipped, the captions stand on the safe box's bottom and the hook at the top whatever is there, unchecked against the face: say so. Read `<skill>/references/place.md` before you change what `place` chose or answer a ✗ it prints.

**A voice alone** has no project and no render: no `project` tool, and

```bash
node <skill>/tools/takes.mjs build takes/<name> --out artifacts/<name>.m4a
node <skill>/tools/takes.mjs check takes/<name>
```

writes the cut's voice at −14 LUFS (`takes/<name>/voice.cut.m4a`, copied to `artifacts/<name>.m4a` with its subtitles `artifacts/<name>.srt`) and every kept word with its time in that voice in `takes/<name>/edit.json`. That file is the preview and the result: in step 4 the person hears it (`[:audio {:src "artifacts/<name>.m4a" :controls true}]` in place of the preview button), and after their yes you give the download links of the voice and the subtitles; there is nothing to render, and captions in the picture and b-roll need a picture. The voice with edit.json's words is what another skill lays its pictures under.

### 4. Ask whether it is right

One message: length before and now, what you left out in plain words (each retry and why, the talk about the recording, the ähs, pauses cut, stretches played faster), what the levels did ("the second video was 11 dB quieter, now both sound the same"), then **ask whether it is right**: "Looks good" (primary), "Show the preview ↗" (a voice alone: its player), and a line that they can type what to change. Mention a ⚠ you left on purpose (a take raised a lot, whose room noise rises with it).

When `check` says the length is no longer a matter of cutting (the target would leave out more than half of the cut), do not cut it shorter on your own: ask instead, the two lengths and two buttons, as in "Too long to cut" below. After "a script to record": write it in the chat, in their own words and language, one sentence a line, within the words `check` named, and say in one sentence that a new recording of it goes through this skill again; no tool is needed. After "the strongest parts": cut by the brief's rule 8, build, check, and ask as above, naming in plain words what was left out.

### 5. Changes

Read `<skill>/references/changes.md` before making a change they ask for. Change `cut.json` (or a setting), build again with the same `--out` (the preview updates by itself), check, and ask again as in step 4, saying in one sentence what changed.

### Captions in the picture

When they ask for captions in the picture ("Untertitel ins Bild", "like Hormozi"), or the cut is for a reel and they said nothing against it, offer them once, the styles as buttons (none marked): **Hormozi** (one to three big words in capitals, the word being said in colour), **Bold words** (two or three bold words, white, nothing behind them), **Karaoke pill**, **Wipe**, **Label** (a white box a line, the words turn black as they are said), **Editorial** (quiet, the key words in a serif italic), **Clean subtitles** (whole phrases on a soft box, for explainers). As `--style` they are `hormozi`, `bold`, `karaoke`, `wipe`, `label`, `editorial`, `clean`; a person who names another look gets it from captions' other styles (`outline`, `impact`, `single`, `fill`, `subtitle`). Then

```bash
node <skill>/tools/takes.mjs captions takes/<name> --style <style> [--product "<name>"] [--brand brand/DESIGN.md] [--platform <reels, tiktok, shorts, story, …>]
```

marks key words with a model, keeps style and marks in `cut.json` (`"captions"`) and builds again; placed for any frame from 16:9 to 9:16. Another style: same command, other `--style`; a key word too many or too few: edit `captions.highlight` (word numbers) in `cut.json` and build; out again: `--off`. It needs agentitos' captions skill beside this one; when missing, say so.

### B-roll: what they talk about, on screen

When the person agreed to the cut and its words name things that can be shown (their product, a page, a post they quote, a number), offer once, before you render: in the message after their yes, one sentence naming two or three of those moments, with "Render it" (primary) and "Show what I talk about" (plain); when they ask for it themselves ("show the app when I mention it", "b-roll"), go straight on. Then follow agentitos' **b-roll** skill (`<skill>/../b-roll/SKILL.md`, on a Sprite else `/home/sprite/skills/b-roll/SKILL.md`), its "For another skill": its brief on `takes/<name>/edit.json`, the pictures it takes and you look at, `takes/<name>/broll/broll.json`, then

```bash
node <skill>/tools/takes.mjs broll takes/<name> takes/<name>/broll/broll.json
```

keeps it in `cut.json` and builds again: the b-roll is mounted under the captions on the cut's word numbers, so every later build keeps each beat on its word (one whose word is cut out is left out, and the build says so; its ⚠ lines are b-roll's). `--off` takes it out. Look at its sheet, then ask as its step 6 says. When the b-roll skill is missing, say so.

### 6. The video

Only after their "looks good" (and the b-roll question, when there was one). Say in one sentence that you are rendering it (about 1.5× the cut's length). Render with the `render` tool, name `<name>` (→ `artifacts/<name>.mp4`, progress in the pane). Then

```bash
node <skill>/tools/takes.mjs finish takes/<name> artifacts/<name>.mp4
```

brings it to −14 LUFS, the loudness Instagram, TikTok and YouTube play at (`--loudness` at build time for another), and writes `artifacts/<name>.srt`; it prints length, size and loudness. When it says the video is from before the last build, render again. Then say in one sentence that it is ready, with the download links and a button "Publish it". To publish, follow agentitos' **publish-video** (beside this skill) with `artifacts/<name>.mp4`; never call Storrito's schedule procedures yourself.

### 7. The next recording

`remember` what the person wants every time (a format, a length, "keep my intro") and apply it to the next upload without asking. A new topic gets a new `<name>`.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; an `input` is a checkbox or radio button, and `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block, comma-separated; `:open "artifacts/<name>"` shows the preview. Links and videos point at `https://…`, `artifacts/…` or `uploads/…`. No text fields: for a change they type.

- One question per block, buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else. Several picks from one list (accounts, platforms, moments): checkboxes and one button. Several independent questions that must all be answered before you go on: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`, or checkboxes), each its own `:name`, at most four groups, one button whose `:send` holds `{checked}`; every `:value` says what it answers ("YouTube: public"). An answer missing a group: ask again for that group only. One question after the other only when it depends on the answer before or on work the person should see first. Nothing ticked where the choice is the person's; the likely answer ticked where it is yours to propose.
- A button only where a click makes you act at once. Never one that only leads to your next question ("Change something"): they type what to change.
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

Too long to cut (`check` says the target would leave out more than half):

```hiccup
[:div
 [:p "Without slips and repeats it is " [:strong "2:10"] "; " [:strong "0:45"] " would leave out more than half of what you said."]
 [:p "Shall I write a 45-second script from it for you to record again, or cut it to the strongest parts anyway?"]
 [:button {:class "primary" :send "Write me a 45-second script from what I said, to record again"} "A 45 s script to record"] " "
 [:button {:send "Cut it to the strongest parts anyway"} "Cut to the strongest parts"]
 [:p [:small "Or tell me what else you have in mind."]]]
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
