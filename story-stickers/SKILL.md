---
name: story-stickers
description: Put Instagram's own stickers (link, poll, question, quiz, countdown, emoji slider, mention, hashtag, location) on a video Story: written as Storrito's sticker elements, checked by Storrito, shown over the film in the HyperFrames preview, then published through Storrito, which lays the real, tappable stickers over the video. No tools: the elements, the preview scene and Storrito's procedures from the REPL. Use when a Story video (made with HyperFrames by launch-video, clips or by hand, or one the person brings) needs a link to a shop, a poll, a countdown or another sticker.
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

There are no tools in this skill: you write the stickers as HTML, Storrito checks them and shows a picture, and publish-video publishes the Story. Full reference: [README.md](README.md).

## How it works

A sticker is never drawn into the video. The video is rendered without stickers; Storrito gets the video and the stickers as its `<insta-…>` elements, lays them over it and gives them to Instagram as real stickers, so that a link opens and a poll counts. Storrito renders them with the same components the preview shows, so what the person sees in the preview is what the Story will look like.

- A sticker shows for the whole Story, from the first to the last second. Place it where the film has nothing that matters, all the time: no text, no face, no product under it.
- One sticker that asks for a tap (poll, question, quiz, slider, countdown) per Story gets the most answers; a link sticker can come with it.
- The video is 1080×1920 and at most 60 s.

## 1. The stickers

Write `stickers/<name>/layer.html` (`<name>` the film's short name): one element per line, each placed by its centre `x`, `y` in px of the 1080×1920 frame, with exactly this style:

```html
<insta-poll question="Schon probiert?" options='["Ja","Noch nicht"]' color="pink" style="position:absolute;left:540px;top:1050px;width:max-content;transform:translate(-50%,-50%)"></insta-poll>
<insta-link url="https://example.com/shop" text="Zum Shop" style="position:absolute;left:540px;top:1470px;width:max-content;transform:translate(-50%,-50%) rotate(-3deg)"></insta-link>
```

- `width:max-content` always: without it a sticker is squeezed into the room right of its `left` (Storrito warns).
- A turn goes after the translation, `rotate(-3deg)` (−6 to 6 looks placed by hand); a size after it, `scale(0.9)` (0.3–2).
- Keep each sticker inside Instagram's safe zone: 250 px from the top, 300 px from the bottom, 60 px from the sides (platform-zones' `zones instagram-story` has the exact box). Leave 40 px between stickers.
- Attribute values with `"` go in single quotes, as `options` above.

| element | attributes |
| --- | --- |
| `insta-link` | `url` (https), `text` (1–3 words: "Zum Shop", "Read more") |
| `insta-poll` | `question`, `options` (JSON list of 2–4), `color`: black pink lavender purple orange green blue |
| `insta-question` | `question`, `color` (as poll, or white) |
| `insta-quiz` | `question`, `options` (2–4), `correct-answer` (0-based) |
| `insta-countdown` | `title`, `end-time` (UTC, `2026-11-01T17:00:00Z`, after the Story goes out), `color`: black white purple red orange yellow green blue |
| `insta-emoji-slider` | `question`, `emoji` |
| `insta-mention`, `insta-hashtag`, `insta-location` | `username`, `hashtag`, `location` |

Storrito's full reference (every attribute, its default and the sizes): https://storrito.com/documentation/api/v1/story-components.md, read it with `fetch`.

## 2. Check

In the REPL (`eval`), with the layer's text:

```clojure
(storrito/check-instagram-story {:html (str "<insta-story>" layer "</insta-story>")})
```

answers each sticker's box, the `warnings` (outside the safe zone, on another sticker, squeezed, an attribute it does not know) and a `previewUrl`: a picture of the Story with its stickers. Fix every warning in `layer.html` and check again. Once the video is uploaded (step 4), check with it, `(str "<insta-story src=\"" url "\">" layer "</insta-story>")`: the picture then shows the video's first frame under the stickers. Show that picture in the chat.

An attribute that would make the post fail is an error with what to change. When Storrito says the procedure does not exist (an older Storrito), use `storrito/create-draft` with the same HTML, `storrito/status-draft` for its `previewUrl`, then `storrito/delete-draft`.

## 3. In the HyperFrames preview (a film you are making)

Write `compositions/story-stickers.html` into the project (in rragent `artifacts/<name>/composition/`):

```html
<template>
  <style>
    #story-stickers { position: absolute; inset: 0; pointer-events: none; }
  </style>
  <div id="story-stickers" data-composition-id="story-stickers" data-width="1080" data-height="1920" data-layout-allow-overlap>
    <!-- the lines of stickers/<name>/layer.html -->
  </div>
  <script>
    (function () {
      if (!window.customElements.get("insta-story") && !document.querySelector("script[data-story-stickers]")) {
        var s = document.createElement("script");
        s.src = "https://c1.storrito.com/js/insta-components.js";
        s.setAttribute("data-story-stickers", "");
        document.head.appendChild(s);
      }
      window.__timelines["story-stickers"] = gsap.timeline({ paused: true });
    })();
  </script>
</template>
```

and mount it over the whole film as the root's first child in `index.html`, marked `data-preview-only`:

```html
<div id="story-stickers" data-preview-only data-composition-id="story-stickers" data-composition-src="compositions/story-stickers.html" data-start="0" data-duration="<the root's data-duration>" data-track-index="99" data-track-kind="graphics" data-width="1080" data-height="1920" style="z-index:1000"></div>
```

The preview shows the Story as Instagram will. rragent's `render` leaves elements marked `data-preview-only` out of the video; the HyperFrames CLI or Studio does not: there take the host out before the render. A video with the stickers drawn in would show them twice. After a change of `layer.html`, copy its lines into the scene again.

## 4. Publish

The finished video goes to agentitos' publish-video as every video does (its SKILL.md: `check`, `prepare` when it says so, `accounts`), with the layer for the Instagram Story targets:

```bash
node <publish-video>/tools/publish.mjs publish publish/<name> --to instagram/<account>/story --at <ISO time> --stickers stickers/<name>/layer.html
```

The stickers go only on Story targets. Storrito's `warnings` come back in its output: tell the person in one sentence. A Story already scheduled with other stickers is refused until `cancel` takes it back.

For the check with the video before that: `(storrito/create-temp-blob-upload-url {:tempBlobUuid (str (random-uuid)) :contentType "video/mp4" :contentLengthBytes <bytes>})`, then `curl -sS -T <video> -H 'Content-Type: video/mp4' '<uploadUrl>'` in bash; its `url` is the video's.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; `:open "artifacts/…"` shows a preview. Links and pictures point at `https://…`, `artifacts/…` or `uploads/…`. An `input` is a checkbox or a radio button; `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block. There are no text fields: for a link or a question they type.

- One question per block, buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else. Several picks from one list: checkboxes and one button. Several questions that must all be answered before you can go on, none depending on another's answer: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`), each with its own `:name`, at most four groups, and one button whose `:send` holds `{checked}`; every `:value` says what it answers. One after the other only when a question depends on the answer before, or on work the person should see first.
- The button that moves on gets `:class "primary"`; buttons that are alternative answers stay plain. A button that opens a page ends its text with " ↗".
- Never put a token, an id the person does not need or a raw error into the chat.

The Story with its stickers (Storrito's `previewUrl`):

```hiccup
[:div
 [:img {:src "https://acme.storrito.com/temp-blob/…" :style {:width "180px" :aspect-ratio "9 / 16" :border-radius "8px"}}]
 [:p "The poll sits under the title, the link below it, for the whole Story. Good like this?"]
 [:button {:class "primary" :send "The stickers are good"} "Looks good"]
 [:p [:small "Or tell me where to move them."]]]
```

## Rules

- Stickers only through Storrito's `<insta-…>` elements: never draw one into the video, never fake one with a picture or a "link in bio" text in a Story.
- A link sticker's `url` is the person's page or one they named; never invent one.
- Every sticker `width:max-content` and placed by its centre; no warning of `check-instagram-story` left unless the person wants it so.
- The video goes out without the stickers: rragent's render leaves `data-preview-only` out, elsewhere take the host out first.
