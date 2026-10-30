---
name: story-stickers
description: Turn a picture or a video into an Instagram Story with Instagram's own stickers (link, poll, question, quiz, countdown, emoji slider, mention, hashtag, location), tappable, exactly where the person saw them. A picture the person brings is laid out on the 9:16 Story in HTML, a video (one the person brings or a HyperFrames film of launch-video, clips, …) is rendered without the stickers; Storrito checks the Story, shows a picture of it and publishes it with the real stickers. No tools: HTML and Storrito's procedures from the REPL. Use when someone wants a Story from their photo or video, with a link to a shop or a page, a poll, a countdown or another sticker. A Story designed from a web page in the brand's look is story-from-link.
license: MIT
metadata:
  title: "Story from a picture or video"
  title-de: "Story aus einem Bild oder Video"
  summary: "Your picture or video as an Instagram Story, with Instagram's link, poll, countdown and other stickers, tappable."
  summary-de: "Dein Bild oder Video als Instagram-Story, mit Instagrams Link-, Umfrage-, Countdown- und anderen Stickern, antippbar."
  ask: "Attach your picture or Story video and say which sticker it needs: a link to your shop, a poll, a countdown … I show you the Story, then schedule it."
  ask-de: "Hänge dein Bild oder dein Story-Video an und sag, welchen Sticker es braucht: einen Link zu deinem Shop, eine Umfrage, einen Countdown … Ich zeige dir die Story und plane sie dann ein."
  placeholder: "Which sticker, and where?"
  placeholder-de: "Welcher Sticker, und wo?"
  inputs: "image, video"
---

# story-stickers

There are no tools in this skill: you write the Story as HTML, Storrito checks it and shows a picture of it, and Storrito publishes it (a video through publish-video). Full reference: [README.md](README.md).

## How it works

A sticker is never drawn into the picture or the video. Storrito gets the picture or the video and the stickers as its `<insta-…>` elements, lays them over it and gives them to Instagram as real stickers, so that a link opens and a poll counts. Storrito renders them with the same components its check shows, so the picture of the check is what the Story will look like.

- **A picture** (a photo, a graphic the person brings): one Story frame, laid out in HTML (step 2), no rendering of your own. Several pictures: one frame each, in their order.
- **A video**: rendered or brought without stickers, the stickers go over it (steps 4 and 5).

- A sticker shows for the whole Story, from the first to the last second. Place it where the picture or the film has nothing that matters: no text, no face, no product under it.
- One sticker that asks for a tap (poll, question, quiz, slider, countdown) per Story gets the most answers; a link sticker can come with it.
- A video is 1080×1920 and at most 60 s; a picture best 1080 px wide or more.
- Do what was asked: one picture and a link make one frame with a link sticker. No text the person did not ask for, no extra frames, no invented captions; a line of text only when they want one, in their words.

## 1. The stickers

Write `stickers/<name>/layer.html` (`<name>` a short name of the Story): one element per line, each placed by its centre `x`, `y` in px of the 1080×1920 frame, with exactly this style:

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

## 2. A picture

Upload it to Storrito first (bash, `<bytes>` from `stat -c%s`, the content type `image/jpeg` or `image/png`):

```clojure
(def upload (storrito/create-temp-blob-upload-url {:tempBlobUuid (str (random-uuid)) :contentType "image/jpeg" :contentLengthBytes <bytes>}))
```

```bash
curl -sS -T <picture> -H 'Content-Type: image/jpeg' '<uploadUrl>'
```

Its `:url` is the picture's. Its size (`ffprobe -v error -show_entries stream=width,height -of csv=p=0 <picture>`) decides the layout:

- **Nearly 9:16** (width ÷ height from 0.5 to 0.62): it fills the frame, `object-fit:cover`; `object-position` keeps what matters (`center 30%`).
- **Anything else** (square, landscape, a wider portrait): the whole picture across the width, centred, over a blurred enlargement of itself:

```html
<insta-story>
<img src="<url>" style="position:absolute;inset:0;width:1080px;height:1920px;object-fit:cover;filter:blur(40px) brightness(.7);transform:scale(1.15)">
<img src="<url>" style="position:absolute;left:0;top:50%;width:1080px;transform:translateY(-50%)">
<!-- a line of text only when asked: -->
<p style="position:absolute;left:60px;right:60px;top:330px;margin:0;text-align:center;font:700 72px 'Instagram Sans Condensed';color:#fff;text-shadow:0 4px 16px rgba(0,0,0,.6)">…</p>
<!-- the lines of layer.html -->
</insta-story>
```

The filled frame is the same without the blurred `<img>`, the picture `style="position:absolute;inset:0;width:1080px;height:1920px;object-fit:cover"`. Put the stickers where the picture is calm (on the blurred band above or below a landscape picture, it covers nothing). Fonts that always load: `Instagram Sans Condensed`, `Roboto`, `AvenyT`, `Noto Color Emoji`. This HTML is the Story: keep it in the REPL, `(def story-htmls ["<insta-story>…</insta-story>"])` (one per frame, in their order), check it (step 3) and schedule it (step 5).

## 3. Check

In the REPL (`eval`), with the layer's text:

```clojure
(storrito/check-instagram-story {:html (str "<insta-story>" layer "</insta-story>")})
```

(for a picture: the whole HTML of step 2) answers each sticker's box, the `warnings` (outside the safe zone, on another sticker, squeezed, an attribute it does not know) and a `previewUrl`: a picture of the Story with its stickers. Fix every warning in `layer.html` and check again. Show the `previewUrl` in the chat: it is what Instagram will show. Once a video is uploaded (step 5), check with it, `(str "<insta-story src=\"" url "\">" layer "</insta-story>")`: the picture then shows the video's first frame under the stickers. Show that picture in the chat.

An attribute that would make the post fail is an error with what to change. When Storrito says the procedure does not exist (an older Storrito), use `storrito/create-draft` with the same HTML, `storrito/status-draft` for its `previewUrl`, then `storrito/delete-draft`.

## 4. In the HyperFrames preview (a film you are making)

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

## 5. Publish

Only after the person's yes. Ask what has more than one answer in one block (see "UI in the chat"): the account (`(storrito/list-social-accounts {})`: those whose `postTypes` have `schedule-instagram-story`; one: take it; none or `disconnected`: `(storrito/create-connect-link {…})` makes a link), the time ("Now", "Today 18:00", "Tomorrow 9:00"; the time zone only when you cannot tell), Facebook when the account has a page (`facebookDestinations`), or a draft in Storrito's gallery instead.

**A picture**: Storrito's procedures in the REPL. Give each frame and account a UUID and remember it first, so that a retry posts nothing twice (Storrito answers a known UUID with the post it has):

```clojure
(def plan (vec (for [account ["mybrand"] [n html] (map-indexed vector story-htmls)]
                 {:account account :n (inc n) :html html :uuid (str (random-uuid))})))
(remember {:story "<name>" :plan (mapv #(dissoc % :html) plan)})
(mapv (fn [{:keys [account html uuid]}]
        (storrito/schedule-instagram-story {:html html :instagramUsername account :storyPostUuid uuid
                                            :date "2026-10-22T16:00:00Z"}))   ; leave :date out for now
      plan)
```

Several frames go out in their order with the same time. Facebook too: `:shareToFacebook true :facebookDestinationId <id>`; a picture made with AI: `:aiGenerated true`. A draft: `(storrito/create-draft {:html html :draftUuid uuid :name "<name>" :folderName "Stories"})`. Then `(storrito/status-instagram-story {:storyPostUuid uuid})` (`status-draft`) once it is rendered, usually within a minute; `cancel-instagram-story` (`delete-draft`) takes it back. Tell the person in one sentence what is scheduled when and where.

**A video**: the finished video goes to agentitos' publish-video as every video does (its SKILL.md: `check`, `prepare` when it says so, `accounts`), with the layer for the Instagram Story targets:

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

- Stickers only through Storrito's `<insta-…>` elements: never draw one into the picture or the video, never fake one with a picture or a "link in bio" text in a Story.
- Only what was asked: one picture is one frame; no text, frames or captions the person did not ask for.
- A link sticker's `url` is the person's page or one they named; never invent one.
- Every sticker `width:max-content` and placed by its centre; no warning of `check-instagram-story` left unless the person wants it so.
- A video goes out without the stickers: rragent's render leaves `data-preview-only` out, elsewhere take the host out first.
