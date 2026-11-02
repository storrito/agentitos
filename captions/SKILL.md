---
name: captions
description: Burn word-timed captions (Hormozi, karaoke pill, wipe, clean) into a video, key words in colour, clear of the apps' buttons, previewed then rendered with an .srt; also other skills' captions step.
license: MIT
metadata:
  title: "Captions"
  title-de: "Untertitel"
  summary: "Captions for your video, word by word in the rhythm of the speech: Hormozi, karaoke, wipe or clean, the key words in colour."
  summary-de: "Untertitel für dein Video, Wort für Wort im Takt der Sprache: Hormozi, Karaoke, Wipe oder schlicht, die wichtigen Wörter in Farbe."
  ask: "Upload a video with someone speaking. I put the words on it as they are said, in the style you pick, the key words in colour. You see a preview first."
  ask-de: "Lade ein Video hoch, in dem jemand spricht. Ich setze die Wörter so ins Bild, wie sie gesagt werden, im Stil deiner Wahl, die wichtigen Wörter in Farbe. Du siehst zuerst eine Vorschau."
  placeholder: "Upload a video"
  placeholder-de: "Video hochladen"
  inputs: "video"
  templates: [hyperframes]
---

# captions

You run in rragent: chat left, artifacts beside it. `<skill>` is this file's folder. Run `node <skill>/tools/captions.mjs …` from your working directory; never change files in `<skill>`. Full reference: [README.md](README.md).

## What it needs

Node 20+, ffmpeg, the HyperFrames CLI, agentitos' `platform-zones` (where the apps' buttons are) and `transcribe` skills beside this one, and OpenRouter: `OPENROUTER_API_KEY`, or on a Sprite the gateway's connection (found at `http://sprite.internal`; an rragent agent there often has no key). Words from ElevenLabs Scribe, key words picked by a model: well under a cent a minute. Nothing to `npm install`; when something is missing, say so in one sentence, never install it.

## From the video to the captioned video, all in the chat

The person attaches a video, named in their message as `video: uploads/<file>`. Files: `captions/<name>/` (`<name>` a short slug of the topic: lowercase letters, digits, dashes). Artifacts: the project `artifacts/<name>/`, at the end `artifacts/<name>.mp4` and `artifacts/<name>.srt`. Messages: one or two sentences and a hiccup block, in the person's language.

1. **The words.** `node <skill>/tools/captions.mjs transcribe uploads/<file> captions/<name>/words.json`. Read them: fix a misspelt name (the product, a person) in `words.json` yourself, keeping the times.
2. **The style.** Ask which one, one button each (`node <skill>/tools/captions.mjs styles` lists them): **Hormozi** (one to three big words in capitals, the word being said in colour, for punchy reels), **Karaoke pill** (the word being said on a coloured pill), **Wipe** (each word wiped in, said words dim), **Clean subtitles** (whole phrases on a soft box, for explainers and interviews). Say in a sentence which fits the video's tone, but mark none as recommended. A brand kit (`brand/DESIGN.md` in the working directory) gives its colour and font: say so.
3. **The key words.** `node <skill>/tools/captions.mjs mark captions/<name>/words.json` (`--product "<name>"` when the video is about a product): a model picks about one word in eight (numbers, names, the key word of a claim, a call to action). Check its choice; set `"highlight": true` in `words.json` where it missed one.
4. **The preview.** Make the project once with the `project` tool: `create`, name `<name>`, kind `hyperframes`. Then
   ```
   node <skill>/tools/captions.mjs project uploads/<file> captions/<name>/words.json artifacts/<name>/composition --style <style> [--brand brand/DESIGN.md]
   ```
   The video becomes the host composition, the captions a sub-composition (`composition/captions/`), placed for any frame from 16:9 to 9:16, clear of what the apps lay over it; the player beside the chat reloads by itself. When the person said where the video goes, add `--platform reels` (or `tiktok`, `shorts`, `story`, several with commas); otherwise the frame's usual platforms count together, and the tool says which. For another frame than the video's (a wide video for a reel): `--size 1080x1920` with `--fit cover` (fill, cut at the edges) or `--fit contain` (bars), and say which. Ask whether it is right: "Looks good" (`:class "primary"`), "Another style", "Change words", and the button that shows the preview.
5. **Changes.** Another style, key word or spelling: change `words.json` or the option and run `project` again.
6. **The video.** After their yes: the `render` tool with `<name>` makes `artifacts/<name>.mp4`; then `node <skill>/tools/captions.mjs srt captions/<name>/words.json artifacts/<name>.srt` writes the subtitles for the platforms' own captions. Say in one sentence that it is ready, with the download links.

`remember` the style and product name the person chose and use them for the next video without asking.

## Captions for another skill

A skill with its own timed words calls `mark` and `build` on them instead of transcribing: read `<skill>/references/other-skills.md` before doing so.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; an `input` is a checkbox or radio button, and `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block, comma-separated; `:open "artifacts/<name>"` shows the preview. Links and videos point at `https://…`, `artifacts/…` or `uploads/…`. No text fields: for a change they type.

- One question per block, buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else. Several picks from one list (accounts, platforms, moments): checkboxes and one button. Several independent questions that must all be answered before you go on: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`, or checkboxes), each its own `:name`, at most four groups, one button whose `:send` holds `{checked}`; every `:value` says what it answers ("YouTube: public"). An answer missing a group: ask again for that group only. One question after the other only when it depends on the answer before or on work the person should see first. Nothing ticked where the choice is the person's; the likely answer ticked where it is yours to propose.
- The button that moves on gets `:class "primary"`; alternative answers (the styles) stay plain.
- Never a token, a `captions/` path or a raw error in the chat.

The style:

```hiccup
[:div
 [:p "Which style should the captions have?"]
 [:button {:send "Captions in the Hormozi style"} "Hormozi"] " "
 [:button {:send "Captions as a karaoke pill"} "Karaoke pill"] " "
 [:button {:send "Captions with a wipe"} "Wipe"] " "
 [:button {:send "Clean subtitles"} "Clean"]
 [:p [:small "Hormozi: big words in capitals, for punchy reels. Karaoke: the word being said on a pill. Wipe: words wiped in as they are said. Clean: whole phrases on a soft box."]]]
```

## Rules

- The words are timed by the voice: never move a time by hand; to fix a word, change only its text.
- Change `words.json` or an option and build again; never edit the built `index.html` by hand.
- The preview first, the render only after the person's yes.
