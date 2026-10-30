---
name: story-stickers
description: Put Instagram's own stickers (link, poll, question, quiz, countdown, emoji slider, mention, hashtag, location) on a video Story: placed and checked with Storrito's sticker components, shown over the film in the HyperFrames preview and over the finished video's frames, then published through Storrito, which lays the real, tappable stickers over the video. Use when a Story video (made with HyperFrames by launch-video, clips or by hand, or one the person brings) needs a link to a shop, a poll, a countdown or another sticker.
license: MIT
metadata:
  title: "Stickers on a video Story"
  title-de: "Sticker auf einer Video-Story"
  summary: "Instagram's link, poll, countdown and other stickers on your Story video, tappable, exactly where you saw them."
  summary-de: "Instagrams Link-, Umfrage-, Countdown- und andere Sticker auf deinem Story-Video, antippbar, genau dort, wo du sie gesehen hast."
  ask: "Attach your Story video (9:16) and say which sticker it needs: a link to your shop, a poll, a countdown … I show you where it sits, then schedule the Story."
  ask-de: "Hänge dein Story-Video (9:16) an und sag, welchen Sticker es braucht: einen Link zu deinem Shop, eine Umfrage, einen Countdown … Ich zeige dir, wo er sitzt, und plane dann die Story ein."
  placeholder: "Which sticker, and where?"
  placeholder-de: "Welcher Sticker, und wo?"
  inputs: "video"
---

# story-stickers

`<skill>` below is the folder this file is in. Run the tools as `node <skill>/tools/stickers.mjs …` from your own working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

## Setup (once per machine)

```bash
cd <skill> && npm install
```

It needs Node 20+ and the network (Storrito, its sticker components); `build` also needs ffmpeg and Chrome (`CHROME`, or `google-chrome`/`chromium` on the PATH), `layer`, `check` and `mount` do not. agentitos' `platform-zones` skill beside this one says where Instagram covers a Story; agentitos' `publish-video` beside it publishes the Story. When something is missing, say so in one sentence instead of installing it yourself.

## How it works

A sticker is never drawn into the video. The video is rendered without stickers; Storrito gets the video and the stickers as its `<insta-…>` elements and lays them over it, so that Instagram makes them tappable (a link opens, a poll counts). This skill places the stickers once, in `stickers.json`, each by its centre: the layer places them in CSS (`left`/`top`, `width:max-content`, `translate(-50%,-50%)`), which Storrito reads exactly as the browser shows it. Storrito measures and checks them with the components it renders with, and every picture you show (the HyperFrames preview, the frames of the finished video) is what the Story will look like.

- A sticker shows for the whole Story, from the first to the last second. Place it where the film has nothing that matters, all the time: no text, no face, no product under it.
- One sticker that asks for a tap (poll, question, quiz, slider, countdown) per Story gets the most answers; a link sticker can come with it.
- The video must be 1080×1920; Storrito takes up to 60 s for a Story.

## 1. The stickers

Write `stickers/<name>/stickers.json` (`<name>` the film's short name). `x` and `y` are the sticker's centre in px of the 1080×1920 frame; `rotate` (degrees, a few at most: −6 to 6 looks placed by hand) and `scale` (0.3–2) are optional.

```json
{
  "stickers": [
    {"type": "link", "url": "https://example.com/shop", "text": "Zum Shop", "x": 540, "y": 1380, "rotate": -4},
    {"type": "poll", "question": "Schon probiert?", "options": ["Ja", "Noch nicht"], "color": "pink", "x": 540, "y": 900}
  ]
}
```

| type | fields |
| --- | --- |
| `link` | `url` (https), `text` (1–3 words: "Zum Shop", "Read more") |
| `poll` | `question`, `options` (2–4), `color`: black pink lavender purple orange green blue |
| `question` | `question`, `color` (as poll, or white) |
| `quiz` | `question`, `options` (2–4), `correct-answer` (0-based) |
| `countdown` | `title`, `end-time` (UTC, `2026-11-01T17:00:00Z`, after the Story goes out), `color`: black white purple red orange yellow green blue |
| `slider` | `question`, `emoji` |
| `mention`, `hashtag`, `location` | `username`, `hashtag`, `location` |

Where: ask platform-zones (`node <platform-zones>/tools/zones.mjs zones instagram-story --size 1080x1920 --json`) for the safe box and keep each sticker inside it; leave room between stickers. In a film you made, put the stickers where its scenes leave space, and keep the film's text and faces out of that place for the whole length.

## 2. The layer, checked by Storrito

```bash
node <skill>/tools/stickers.mjs layer stickers/<name>/stickers.json
node <skill>/tools/stickers.mjs check stickers/<name> [--video <the video's temp-blob url>]
```

`layer` writes `stickers/<name>/layer.html`, the layer Storrito gets, without a browser. `check` hands it to Storrito's `check-instagram-story` (nothing is posted or saved) and prints each sticker's box and Storrito's warnings: a sticker outside Instagram's safe zone, on another sticker, an attribute it does not know. Move the sticker in `stickers.json`, write the layer and check again until nothing is left. When `check` says Storrito has no check yet, or cannot reach Storrito, `build` (step 4) checks in Chrome instead.

Without the tools, in rragent's REPL: write the same elements yourself, each `style="position:absolute;left:<x>px;top:<y>px;width:max-content;transform:translate(-50%,-50%)"` (a rotation after the translation: `… translate(-50%,-50%) rotate(-4deg)`), and check them with `(storrito/check-instagram-story {:html "<insta-story>…</insta-story>"})`. Never leave out `width:max-content`: a sticker placed at `left:540px` without it is laid out squeezed into the 540 px right of it.

## 3. In the HyperFrames preview (a film you are making)

```bash
node <skill>/tools/stickers.mjs mount stickers/<name> <project>
```

writes `compositions/story-stickers.html` into the HyperFrames project (`<project>` is the folder with its `index.html`; in rragent `artifacts/<name>/composition`) and mounts it over the film, its host marked `data-preview-only` (the film must be 1080×1920): the preview shows the Story as Instagram will, with Storrito's real stickers. Mount again after a change of the layer.

**The render:** rragent's `render` tool leaves elements marked `data-preview-only` out of the video by itself. The HyperFrames CLI or Studio does not: there run `node <skill>/tools/stickers.mjs unmount <project>` before the render. A video with the stickers drawn in would show them twice: when the frames of `build --video` show a sticker twice, unmount and render again.

## 4. Pictures over the finished video

```bash
node <skill>/tools/stickers.mjs build stickers/<name>/stickers.json --video <film.mp4> [--at 1,4.5,9]
```

shows the stickers over four frames of the rendered video (or the moments of `--at`) for the chat, measured with Storrito's components and checked by platform-zones: ✗ under Instagram's bar or reply field or on another sticker, ⚠ in the safe zone's margin or close to another. It writes the layer too. Look at the pictures yourself: a sticker on the film's text or on a face is a ✗ no tool sees.

## 5. Publish

The finished video goes to agentitos' publish-video as every video does (its SKILL.md: `check`, `prepare` when it says so, `accounts`), with the layer for the Instagram Story targets:

```bash
node <publish-video>/tools/publish.mjs publish publish/<name> --to instagram/<account>/story --at <ISO time> --stickers stickers/<name>/layer.html
```

The stickers go only on Story targets; publish-video refuses `--stickers` without one. Storrito's `warnings` (stickers on each other, outside the safe zone) come back in its output: tell the person in one sentence. A Story already scheduled with other stickers is refused until `cancel` takes it back.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; `:open "artifacts/…"` shows a preview. Links and pictures point at `https://…`, `artifacts/…` or `uploads/…`. An `input` is a checkbox or a radio button; `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block. There are no text fields: for a link or a question they type.

- One question per block, buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else. Several picks from one list: checkboxes and one button. Several questions that must all be answered before you can go on, none depending on another's answer: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`), each with its own `:name`, at most four groups, and one button whose `:send` holds `{checked}`; every `:value` says what it answers. One after the other only when a question depends on the answer before, or on work the person should see first.
- The button that moves on gets `:class "primary"`; buttons that are alternative answers stay plain. A button that opens a page ends its text with " ↗".
- Never put a token, an id the person does not need or a raw error into the chat.

The stickers over the video:

```hiccup
[:div
 [:div {:style {:display "grid" :grid-template-columns "repeat(auto-fill, minmax(96px, 1fr))" :gap "8px"}}
  [:img {:src "uploads/stickers-launch/mvuvwmnw/01.jpg" :style {:width "100%" :aspect-ratio "9 / 16" :border-radius "8px"}}]
  [:img {:src "uploads/stickers-launch/mvuvwmnw/02.jpg" :style {:width "100%" :aspect-ratio "9 / 16" :border-radius "8px"}}]
  [:img {:src "uploads/stickers-launch/mvuvwmnw/03.jpg" :style {:width "100%" :aspect-ratio "9 / 16" :border-radius "8px"}}]]
 [:p "The link sticker sits under the product for the whole Story. Good like this?"]
 [:button {:class "primary" :send "The stickers are good"} "Looks good"]
 [:p [:small "Or tell me where to move it."]]]
```

## Rules

- Stickers only through Storrito's `<insta-…>` elements: never draw one into the video, never fake one with a picture.
- A link sticker's `url` is the person's page or one they named; never invent one.
- Change `stickers.json`, then `layer` (or `build`) and `mount` again; never edit `layer.html` or the mounted scene by hand.
- The video goes out without the stickers: rragent's render leaves `data-preview-only` out, elsewhere `unmount` first.
