---
name: captions
description: Burn word-timed captions into a video in one of twelve styles (Hormozi, bold words, impact, karaoke, label, editorial, subtitles …), key words in colour, clear of the apps' buttons, previewed then rendered with an .srt; also other skills' captions step.
license: MIT
metadata:
  title: "Captions"
  title-de: "Untertitel"
  summary: "Captions for your video, word by word in the rhythm of the speech, in one of twelve styles from loud Hormozi capitals to quiet subtitles, the key words in colour."
  summary-de: "Untertitel für dein Video, Wort für Wort im Takt der Sprache, in einem von zwölf Stilen von lauten Hormozi-Versalien bis zu ruhigen Untertiteln, die wichtigen Wörter in Farbe."
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

1. **The words.** `node <skill>/tools/captions.mjs transcribe uploads/<file> captions/<name>/words.json`. Read them: fix a misspelt name (the product, a person) in `words.json` yourself, keeping the times. A word too long for a line (a German compound of some 16 letters or more) is set smaller than the rest: put a soft hyphen (`\u00ad`) into its text where it may break ("Verwaltungs\u00adwissenschaft"), and it breaks there with a hyphen instead.
2. **The style.** Read `<skill>/references/styles.md` before asking: what each of the twelve styles looks like and which ones videos of this kind carry. Copy `<skill>/references/styles.jpg` (every style on the same frame) to `uploads/caption-styles.jpg` and ask which one with the block under "UI in the chat": the picture, one button a style in three rows. Say in a sentence which styles videos of this kind usually carry (a podcast clip, a talking head, a screen with a face, a narrated video), but mark none as recommended. A brand kit (`brand/DESIGN.md` in the working directory) gives its colour and font: say so.
3. **The key words.** `node <skill>/tools/captions.mjs mark captions/<name>/words.json` (`--product "<name>"` when the video is about a product): a model picks about one word in eight (numbers, names, the key word of a claim, a call to action). Check its choice; set `"highlight": true` in `words.json` where it missed one.
   **Cards, only when they are asked for.** A spoken phrase can stand as a card of its own: a box, an emoji in front, its numbers in colour, on screen while it is said. `node <skill>/tools/captions.mjs box captions/<name>/words.json "📏 32 centimetres wide" "🛰️ Space Station"`: the phrases as they are said, two to four words, an emoji in front when one fits; `--clear` takes them away. Only when the person asks for cards or boxes (or the skill you work for does): captions without them are the rule, and never every key word a card. One or two a quarter minute at most.
4. **The preview.** Make the project once with the `project` tool: `create`, name `<name>`, kind `hyperframes`. Then
   ```
   node <skill>/tools/captions.mjs project uploads/<file> captions/<name>/words.json artifacts/<name>/composition --style <style> [--brand brand/DESIGN.md]
   ```
   The video becomes the host composition, the captions a sub-composition (`composition/captions/`), placed for any frame from 16:9 to 9:16, clear of what the apps lay over it; the player beside the chat reloads by itself. When the person said where the video goes, add `--platform reels` (or `tiktok`, `shorts`, `story`, several with commas); otherwise the frame's usual platforms count together, and the tool says which. For another frame than the video's (a wide video for a reel): `--size 1080x1920` with `--fit cover` (fill, cut at the edges) or `--fit contain` (bars), and say which. Ask whether it is right: "Looks good" (`:class "primary"`) and "Show the preview ↗" (`:open "artifacts/<name>"`; a button that opens an artifact ends its text with " ↗"); under them one line: for another style or other key words they name it ("Impact instead", "Storrito in colour").
5. **Changes.** Another style, key word, card or spelling: change `words.json` (or `box` again) or the option and run `project` again. Another place for the captions: "Where the captions go" below.
6. **The video.** After their yes: the `render` tool with `<name>` makes `artifacts/<name>.mp4`; then `node <skill>/tools/captions.mjs srt captions/<name>/words.json artifacts/<name>.srt` writes the subtitles for the platforms' own captions. Say in one sentence that it is ready, with the download links.

`remember` the style and product name the person chose and use them for the next video without asking.

## Where the captions go

`build` and `project` set the captions where the apps leave room: the lowest line on the bottom of the platforms' safe box, centred on the frame, in the style's size, two lines at most. The tool never looks at the picture and never chooses another place. A caller that knows a better one (the person names it, you saw it on a frame of the video, a skill laid the frame out) says where, in px of the frame. Each option alone or with the others; what is not given stays as above:

- `--y <px>`: the y, counted from the frame's top, at which the lowest line ends. Needed when the safe box's bottom lies on what must be seen: in a close selfie it is the chin, and the free picture is the wall above the head.
- `--x <px>` and `--max-width <px>`: where the captions' area starts from the left and how wide it is. Needed when the free area lies at one side: the speaker as a tall panel on the left of a 16:9 frame, a screen beside the face. `--max-width` alone stays centred on the frame; `--x` alone reaches to the right edge of the platforms' centred box.
- `--align left|centre|right`: the lines inside that area. Left (or right) when the area begins beside something, so that every group starts at the same edge; for captions centred on the frame, leave it out.
- `--font-size <px>`: the type's size instead of the style's (`--size` is the frame's size). Needed when the area is much larger or smaller than the strip the styles are made for: the free half of a wide frame carries type twice as large. In a width, in lines or at a size of your own the groups are cut so that each stands in its lines at the type's size; a word wider than a line stands alone and smaller (with a short word beside it that would only flash by), and the tool names it: give more width or a smaller size when it matters.
- `--lines 1|2`: one line when the area is low: a strip of wall above a head, a bar under a screen.

The tool answers where it put them and whether that is inside the safe box of the platforms; a line that begins with `!` says how far the area leaves it (or the frame) and what the apps lay there. It builds all the same: the place is the caller's. The area holds a style's box whole, its padding too. A card (`box`) is never cut to an area: it keeps its words together and may take another line.

## Captions for another skill

A skill with its own timed words calls `mark` and `build` on them instead of transcribing: read `<skill>/references/other-skills.md` before doing so.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; an `input` is a checkbox or radio button, and `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block, comma-separated; `:open "artifacts/<name>"` shows the preview. Links and videos point at `https://…`, `artifacts/…` or `uploads/…`. No text fields: for a change they type.

- One question per block, buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else. Several picks from one list (accounts, platforms, moments): checkboxes and one button. Several independent questions that must all be answered before you go on: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`, or checkboxes), each its own `:name`, at most four groups, one button whose `:send` holds `{checked}`; every `:value` says what it answers ("YouTube: public"). An answer missing a group: ask again for that group only. One question after the other only when it depends on the answer before or on work the person should see first. Nothing ticked where the choice is the person's; the likely answer ticked where it is yours to propose.
- The button that moves on gets `:class "primary"`; alternative answers (the styles) stay plain.
- Never a token, a `captions/` path or a raw error in the chat.

The style (the rows as in the picture; the last line is yours: what videos of this kind usually carry):

```hiccup
[:div
 [:p "Which style should the captions have?"]
 [:img {:src "uploads/caption-styles.jpg" :alt "The twelve caption styles on the same frame" :style {:max-width "100%"}}]
 [:p [:small "Loud"] [:br]
  [:button {:send "Captions in the style Hormozi"} "Hormozi"] " "
  [:button {:send "Captions in the style Outline"} "Outline"] " "
  [:button {:send "Captions in the style Impact"} "Impact"] " "
  [:button {:send "Captions in the style One word"} "One word"]]
 [:p [:small "Following the voice"] [:br]
  [:button {:send "Captions in the style Karaoke pill"} "Karaoke pill"] " "
  [:button {:send "Captions in the style Karaoke fill"} "Karaoke fill"] " "
  [:button {:send "Captions in the style Wipe"} "Wipe"] " "
  [:button {:send "Captions in the style Label"} "Label"]]
 [:p [:small "Calm"] [:br]
  [:button {:send "Captions in the style Bold words"} "Bold words"] " "
  [:button {:send "Captions in the style Editorial"} "Editorial"] " "
  [:button {:send "Captions in the style Plain subtitles"} "Plain subtitles"] " "
  [:button {:send "Captions in the style Clean subtitles"} "Clean subtitles"]]
 [:p [:small "Podcast clips mostly carry Bold words or Impact. Something else in mind? Describe it."]]]
```

The styles' names stay as they are in every language. What `--style` takes for each: Hormozi `hormozi`, Outline `outline`, Impact `impact`, One word `single`, Karaoke pill `karaoke`, Karaoke fill `fill`, Wipe `wipe`, Label `label`, Bold words `bold`, Editorial `editorial`, Plain subtitles `subtitle`, Clean subtitles `clean`.

## Rules

- The words are timed by the voice: never move a time by hand; to fix a word, change only its text.
- Change `words.json` or an option and build again; never edit the built `index.html` by hand.
- The preview first, the render only after the person's yes.
