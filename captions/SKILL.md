---
name: captions
description: Burn word-timed captions into a video in one of several styles (Hormozi, karaoke pill, wipe, clean subtitles), with the key words standing out, placed clear of the platforms' buttons (agentitos' platform-zones), in the brand's colour and font when there is a brand kit; show them as a HyperFrames preview, agree on them in the chat, then render, with an .srt beside the video. Also the captions step of other skills (best-takes, …): they call its tool on their own words.
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

You run in rragent: the chat on the left, the artifacts beside it. `<skill>` below is the folder this file is in. Run the tool as `node <skill>/tools/captions.mjs …` from your working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

## What it needs

Node 20+, agentitos' `platform-zones` skill beside this one (where the apps' buttons are), ffmpeg, the HyperFrames CLI (the `hyperframes` template needs it too) and OpenRouter: `OPENROUTER_API_KEY` in the environment, or, on a Sprite, the gateway's OpenRouter connection (the tools find it at `http://sprite.internal`; an rragent agent there often has no key of its own). The words come from ElevenLabs Scribe, a model picks the words that stand out, both through OpenRouter, well under a cent a minute. Nothing to `npm install`. When something is missing, say so in one sentence instead of installing it yourself.

## From the video to the captioned video, all in the chat

The person attaches a video; their message names it as a line `video: uploads/<file>`. Your files: `captions/<name>/` (`<name>` a short slug of the topic, lowercase letters, digits and dashes). The artifacts: the project `artifacts/<name>/`, the preview, and at the end the video `artifacts/<name>.mp4` with `artifacts/<name>.srt`. Keep every message short: one or two sentences and a hiccup block. Speak the person's language.

1. **The words.** `node <skill>/tools/captions.mjs transcribe uploads/<file> captions/<name>/words.json`. Read the words: a name spelled wrong (the product, a person) you fix in `words.json` yourself, keeping the times.
2. **The style.** Ask which one, one button each (`node <skill>/tools/captions.mjs styles` lists them with what they look like): **Hormozi** (one to three big words in capitals, the word being said in colour, for punchy reels), **Karaoke pill** (the word being said on a coloured pill), **Wipe** (each word wiped in, said words dim), **Clean subtitles** (whole phrases on a soft box, for explainers and interviews). Say in a sentence which fits the video's tone, but mark none as recommended. A brand kit in the working directory (`brand/DESIGN.md`) gives its colour and font: say so.
3. **The key words.** `node <skill>/tools/captions.mjs mark captions/<name>/words.json` (with `--product "<name>"` when the video is about a product): a model picks about one word in eight to stand out (numbers, names, the key word of a claim, a call to action). Look at its choice; change `"highlight": true` in `words.json` where it missed one.
4. **The preview.** Make the project once, with the `project` tool: `create`, name `<name>`, kind `hyperframes`. Then
   ```
   node <skill>/tools/captions.mjs project uploads/<file> captions/<name>/words.json artifacts/<name>/composition --style <style> [--brand brand/DESIGN.md]
   ```
   It writes the video as the host composition and the captions as a sub-composition (`composition/captions/`); the player beside the chat loads again by itself. Every frame works, from 16:9 to 9:16: the captions are placed and sized for it, clear of what the apps lay over the video. When the person said where the video goes, add `--platform reels` (or `tiktok`, `shorts`, `story`, several with commas); otherwise the usual platforms of the frame count together, and the tool says which. For another frame than the video's (a wide video for a reel), add `--size 1080x1920` and `--fit cover` (fill, cut at the edges) or `--fit contain` (with bars), and say which. Ask whether it is right: "Looks good" (`:class "primary"`), "Another style", "Change words", and the button that shows the preview.
5. **Changes.** Another style, another key word, a word spelled differently: change `words.json` or the option and run `project` again.
6. **The video.** After their yes: the `render` tool with `<name>` makes `artifacts/<name>.mp4`; then `node <skill>/tools/captions.mjs srt captions/<name>/words.json artifacts/<name>.srt` writes the subtitles for the platforms' own captions. Say in one sentence that it is ready, with the download links.

The conversation goes on: `remember` the style and the product name the person chose and use them for the next video without asking.

## Captions for another skill

A skill that has its own timed words (best-takes has the cut's words, timed in the cut) calls the tool without transcribing: it writes `{"width", "height", "duration", "words": [{"text", "start", "end", "highlight"}]}`, runs `mark` on it if it wants key words, then `build <words.json> <composition>/captions --style <style> [--platform <where it goes>]`, and puts the clip the tool prints into its host composition. The words must be timed in the video the captions go on, after every cut.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; `:open "artifacts/<name>"` shows the preview. Links and videos point at `https://…`, `artifacts/…` or `uploads/…`. There are no text fields: for a change they type.

- One question per block, buttons for the likely answers, and a hint that they can type anything else.
- The button that moves on gets `:class "primary"`; buttons that are alternative answers (the styles) stay plain.
- Never put a token, a path of `captions/` or a raw error into the chat.

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
