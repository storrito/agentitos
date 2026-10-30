---
name: story-stickers
description: Turn a picture or a video into an Instagram Story with Instagram's own stickers (link, poll, question, quiz, countdown, emoji slider, mention, hashtag, location), tappable, exactly where the person saw them. A picture the person brings is laid out on the 9:16 Story in HTML, a video (one the person brings or a HyperFrames film of launch-video, clips, …) is rendered without the stickers; a HyperFrames preview shows the Story with Storrito's real stickers, and Storrito publishes it with them. No tools: HTML, a HyperFrames preview and Storrito's procedures from the REPL. Use when someone wants a Story from their photo or video, with a link to a shop or a page, a poll, a countdown or another sticker. A Story designed from a web page in the brand's look is story-from-link.
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

There are no tools in this skill: you write the Story as HTML, a HyperFrames preview shows it with Storrito's real stickers, and Storrito publishes it (a video through publish-video), refusing what would make the post fail. Full reference: [README.md](README.md).

## How it works

A sticker is never drawn into the picture or the video. Storrito gets the picture or the video and the stickers as its `<insta-…>` elements, lays them over it and gives them to Instagram as real stickers, so that a link opens and a poll counts. Storrito renders them with the same components the HyperFrames preview loads, so the preview is what the Story will look like.

- **A picture** (a photo, a graphic the person brings): one Story frame, laid out in HTML (step 2), no rendering of your own. Several pictures: one frame each, in their order.
- **A video**: rendered or brought without stickers, the stickers go over it; the person sees them over the whole video in a preview, and you check every moment (step 4), then publish (step 5).

- A sticker shows for the whole Story, from the first to the last second. Place it where the picture or the film has nothing that matters: no text, no face, no product under it.
- One sticker that asks for a tap (poll, question, quiz, slider, countdown) per Story gets the most answers; a link sticker can come with it.
- A video is 1080×1920 and at most 60 s; a picture best 1080 px wide or more.
- Do what was asked: one picture and a link make one frame with a link sticker. No text the person did not ask for, no extra frames, no invented captions; a line of text only when they want one, in their words.

## 1. The stickers: a band, and flexbox in it

Choose a **band** of the frame where the picture or the film has nothing that matters, all the time: only background may lie in it (a colour, a gradient, a photo, calm footage); no text, no subtitles, no graphic, logo, icon or SVG, no face, no product, no picture-in-picture, nothing that moves through it. In a film you make, plan the band with the scenes and keep it free for the whole length; in a picture or a video the person brings, find it on the picture or the sheet of its moments (step 4). Then write `stickers/<name>/layer.html` (`<name>` a short name of the Story): one flexbox over the band, the stickers in it, the browser spaces them:

```html
<div style="position:absolute;left:60px;right:60px;top:1350px;bottom:300px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px">
<insta-link url="https://example.com/shop" text="Zum Shop"></insta-link>
<insta-poll question="Schon probiert?" options='["Ja","Noch nicht"]' color="pink"></insta-poll>
</div>
```

- `top` and `bottom` set the band; it stays inside Instagram's safe zone: `top` 250 px or more, `bottom` 300 px or more, `left` and `right` 60 px or more (platform-zones' `zones instagram-story` has the exact box).
- Make it tall enough for what goes in, with 40 px between stickers: a link, hashtag, mention or location is 177 px tall (its width follows the text, "Shop Now" 605 px); a poll 768 px wide and 566 / 728 / 890 px tall with 2 / 3 / 4 options; a question 771 × 454; a quiz 771 wide, 541 / 709 / 877 tall; a countdown 693 × 433; an emoji slider 818 wide, 262 tall without a question, 467 with one.
- To one side: `align-items:flex-start` (left) or `flex-end` (right) and the band's `left` / `right`; two stickers side by side: `flex-direction:row`.
- A turn for a sticker, `style="transform:rotate(-3deg)"` (−6 to 6 looks placed by hand); a smaller one, `transform:scale(0.85)` (not below 0.75: hard to tap).
- Attribute values with `"` go in single quotes, as `options` above.
- Only a sticker that must sit on an exact spot (over a button the picture shows) is placed alone by its centre: `<insta-link … style="position:absolute;left:540px;top:1470px;width:max-content;transform:translate(-50%,-50%)">` (`width:max-content` always, else Storrito warns that it is squeezed).

| element | attributes |
| --- | --- |
| `insta-link` | `url` (https), `text` (1–3 words: "Zum Shop", "Read more") |
| `insta-poll` | `question`, `options` (JSON list of 2–4), `color`: black pink lavender purple orange green blue |
| `insta-question` | `question`, `color` (as poll, or white) |
| `insta-quiz` | `question`, `options` (2–4), `correct-answer` (0-based) |
| `insta-countdown` | `title`, `end-time` (UTC, `2026-11-01T17:00:00Z`, after the Story goes out), `color`: black white purple red orange yellow green blue |
| `insta-emoji-slider` | `question`, `emoji` |
| `insta-mention`, `insta-hashtag`, `insta-location` | `username`, `hashtag`, `location` |

**The look.** Most stickers come in a few designs (`design` on link, mention, hashtag, location; `color` on poll, question, quiz, countdown, emoji slider). Never ask before the first picture: choose yourself, name it in half a sentence with the picture, and offer the likely others as buttons under it.

- `default` (the white pill) unless the sticker sits on something very bright, where `black` (link, location) or `gray` reads better; `rainbow` only for playful content.
- Poll, question, quiz: the Instagram colour nearest the brand's (a brand kit's primary colour), else `pink` or `purple` on a calm picture.
- The buttons offer two or three designs that suit this picture ("Black", "Gray", "Rainbow" for a link), each `:send "The link sticker in black"`: change `design`, copy it into the scene, show the new snapshot. Never more than one round of them unless the person asks.

| sticker | designs |
| --- | --- |
| `insta-link` | `design`: default, gray, black, rainbow (invisible: see the reference) |
| `insta-hashtag`, `insta-mention` | `design`: default, gray, rainbow |
| `insta-location` | `design`: default, gray, black, orange, rainbow |
| `insta-poll`, `insta-quiz` | `color`: black, pink, lavender, purple, orange, green, blue |
| `insta-question` | `color`: white, black, pink, lavender, purple, orange, green, blue |
| `insta-countdown` | `color`: black, white, purple, red, orange, yellow, green, blue |

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
<div style="position:absolute;inset:0;background:url(<url>) center/cover;filter:blur(40px) brightness(.7);transform:scale(1.15)"></div>
<img src="<url>" style="position:absolute;left:0;top:50%;width:1080px;transform:translateY(-50%)">
<!-- a line of text only when asked: -->
<p style="position:absolute;left:60px;right:60px;top:330px;margin:0;text-align:center;font:700 72px 'Instagram Sans Condensed';color:#fff;text-shadow:0 4px 16px rgba(0,0,0,.6)">…</p>
<!-- the lines of layer.html -->
</insta-story>
```

The filled frame is the same without the blurred `<div>`, the picture `style="position:absolute;inset:0;width:1080px;height:1920px;object-fit:cover"`. Put the band where the picture is calm: below or above a landscape picture, on the blurred part, it covers nothing. Fonts that always load: `Instagram Sans Condensed`, `Roboto`, `AvenyT`, `Noto Color Emoji`. This HTML is the Story: keep it in the REPL, `(def story-htmls ["<insta-story>…</insta-story>"])` (one per frame, in their order), show it (step 3) and schedule it (step 5).

## 3. The preview beside the chat

The person sees the Story in a HyperFrames preview with Storrito's real stickers, never a description of it. In rragent make the project first, with the `project` tool (`{"action": "create", "name": "<name>", "kind": "hyperframes"}`), before anything else goes into `artifacts/<name>/`; pictures you make to look at (sheets, maps) go to `uploads/`, never into the project. The preview is never rendered: it only shows.

Write `compositions/story-stickers.html` into it (`artifacts/<name>/composition/`):

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

and an `index.html` with what goes under the stickers, the scene mounted over it as the root's first child, marked `data-preview-only` (`<duration>`: a picture 5, a video its length from `ffprobe -v error -show_entries format=duration -of csv=p=0 <video>`):

```html
<!doctype html>
<html>
  <head><meta charset="utf-8"><script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <style>html, body { margin: 0; width: 1080px; height: 1920px; background: #000; overflow: hidden; }</style></head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="<duration>" data-width="1080" data-height="1920">
      <div id="story-stickers" data-preview-only data-composition-id="story-stickers" data-composition-src="compositions/story-stickers.html" data-start="0" data-duration="<duration>" data-track-index="99" data-track-kind="graphics" data-width="1080" data-height="1920" style="z-index:1000"></div>
      <!-- a picture: the elements of its Story HTML (step 2), each with class="clip" data-start="0" data-duration="<duration>" and a z-index, the picture copied in as picture.jpg -->
      <!-- a video the person brings: -->
      <video id="story-video" class="clip" data-start="0" data-duration="<duration>" data-has-audio="true" src="video.mp4" style="position:absolute;left:0;top:0;width:1080px;height:1920px;object-fit:cover;z-index:1"></video>
    </div>
    <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
  </body>
</html>
```

`data-has-audio="true"` when the video has sound, else `muted`. **A film you are making** is its own project: mount the scene into it at the start, so that you design around the stickers. Open the preview beside the chat (`:open "artifacts/<name>"`); a picture for the chat: `npx hyperframes snapshot --at 1 --no-end -o uploads/<name>-preview` in `composition/`. After a change of `layer.html`, copy its lines into the scene again. rragent's `render` leaves elements marked `data-preview-only` out of a film's video; the HyperFrames CLI or Studio does not: there take the host out before the render.

## 4. Is the band free, the whole time?

Look at the preview yourself first: a sticker on a face, on text or on the product is wrong, and a band too small for its stickers spills over both of its edges.

**Text in a film you make or a picture's line of text**: HyperFrames checks it against the band. Give the band in fractions of the frame (`left/1080`, `top/1920`, `1 - right/1080`, `1 - bottom/1920`):

```bash
npx hyperframes check --json --caption-zone "x0=<left/1080>;y0=<top/1920>;x1=<1-right/1080>;y1=<1-bottom/1920>;severity=error;seek=.5,1"
```

Every `caption_zone_collision` names the text, its moment and its box: move the text out of the band, or the band.

**A video's pixels** (subtitles burned in, a face, a picture-in-picture, the product), every moment of it. Always for a video the person brings: nobody planned it around the band. For a film you made, only when footage you do not know frame by frame runs under the band (a stock clip with people or text in it); a band you kept free by design needs no more than `--caption-zone`.

```bash
# the moments: 2 a second, the ones that look alike left out, the band and the safe zone drawn, 30 to a sheet
ffmpeg -v error -y -i <video> -vf "fps=2,mpdecimate=hi=64*12:lo=64*5:frac=0.33,drawbox=x=<left>:y=<top>:w=<1080-left-right>:h=<1920-top-bottom>:color=red@0.9:t=8,drawbox=x=60:y=250:w=960:h=1370:color=yellow@0.8:t=3,scale=180:-1,tile=6x5" -vsync vfr uploads/<name>-moments-%d.jpg
# the occupancy map: everything that ever showed up, one picture (busy footage like water lights up everywhere: then trust the moments)
ffmpeg -v error -y -i <video> -vf "fps=5,scale=540:-1,format=gray,edgedetect=low=0.2:high=0.5,lagfun=decay=1,drawbox=x=<left/2>:y=<top/2>:w=<(1080-left-right)/2>:h=<(1920-top-bottom)/2>:color=white@1:t=2" -update 1 uploads/<name>-map.png
```

Start with the map: it shows in one picture where text and insets ever were (light); a band on dark is free. When it shows no clear free band (busy footage lights up everywhere, or the video is full), decide from the moments yourself: each tile is a moment that differs from the one before, so a subtitle that stands half a second is there. Choose the band that covers least of what matters (text, faces, the product) in all of them, and check it on every sheet: nothing that matters in the red band in any tile. No band covers nothing: say so and offer what is possible. A film you made yourself comes first: offer to move its text and elements out of a band and render it again (it changes the film the person agreed to, so ask). Else the stickers smaller (`scale(0.85)`, not below 0.75), fewer of them, the video made smaller with a free strip, or a sticker over something the person accepts.

Show the moments or the map in the chat with the preview and say in one sentence what the band keeps clear of ("below the subtitles, left of the webcam").

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

Storrito refuses what would make the post fail (a link without https, a poll with one answer, an unknown username …) with what to change; its `warnings` (stickers on each other, CSS it cannot show, an attribute it does not know) come with a post already scheduled: then `cancel-instagram-story`, fix, schedule again with new UUIDs. Several frames go out in their order with the same time. Facebook too: `:shareToFacebook true :facebookDestinationId <id>`; a picture made with AI: `:aiGenerated true`. A draft: `(storrito/create-draft {:html html :draftUuid uuid :name "<name>" :folderName "Stories"})`. Then `(storrito/status-instagram-story {:storyPostUuid uuid})` (`status-draft`) once it is rendered, usually within a minute; `cancel-instagram-story` (`delete-draft`) takes it back. Tell the person in one sentence what is scheduled when and where.

**A video**: the finished video goes to agentitos' publish-video as every video does (its SKILL.md: `check`, `prepare` when it says so, `accounts`), with the layer for the Instagram Story targets:

```bash
node <publish-video>/tools/publish.mjs publish publish/<name> --to instagram/<account>/story --at <ISO time> --stickers stickers/<name>/layer.html
```

The stickers go only on Story targets. Storrito's `warnings` come back in its output: tell the person in one sentence. A Story already scheduled with other stickers is refused until `cancel` takes it back.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; `:open "artifacts/…"` shows a preview. Links and pictures point at `https://…`, `artifacts/…` or `uploads/…`. An `input` is a checkbox or a radio button; `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block. There are no text fields: for a link or a question they type.

- One question per block, buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else. Several picks from one list: checkboxes and one button. Several questions that must all be answered before you can go on, none depending on another's answer: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`), each with its own `:name`, at most four groups, and one button whose `:send` holds `{checked}`; every `:value` says what it answers. One after the other only when a question depends on the answer before, or on work the person should see first.
- The button that moves on gets `:class "primary"`; buttons that are alternative answers stay plain. A button that opens a page ends its text with " ↗".
- Never put a token, an id the person does not need or a raw error into the chat.

A video Story: the sheet of its moments and the preview beside the chat:

```hiccup
[:div
 [:img {:src "uploads/launch-moments-1.jpg" :style {:width "100%" :border-radius "8px"}}]
 [:p "The link sticker sits below the subtitles and left of the webcam, in every moment of the video. Good like this?"]
 [:button {:class "primary" :send "The stickers are good"} "Looks good"] " "
 [:button {:open "artifacts/launch"} "Play the preview ↗"]
 [:p [:small "Or tell me where to move it."]]]
```

A picture Story (the preview's snapshot), the chosen design named and the others one click away:

```hiccup
[:div
 [:img {:src "uploads/parrot-preview/frame-00-at-1s.png" :style {:width "180px" :aspect-ratio "9 / 16" :border-radius "8px"}}]
 [:p "The link sticker sits above the parrot, in white: it stands out on the dark background. Good like this?"]
 [:button {:class "primary" :send "The story is good"} "Looks good"] " "
 [:button {:send "The link sticker in black"} "Black"] " "
 [:button {:send "The link sticker in gray"} "Gray"] " "
 [:button {:send "The link sticker in rainbow"} "Rainbow"]
 [:p [:small "Or tell me where to move it."]]]
```

## Rules

- Stickers only through Storrito's `<insta-…>` elements: never draw one into the picture or the video, never fake one with a picture or a "link in bio" text in a Story.
- Only what was asked: one picture is one frame; no text, frames or captions the person did not ask for.
- A link sticker's `url` is the person's page or one they named; never invent one.
- The stickers in one flexbox over a band that is free the whole time: the preview, `check --caption-zone` for text you place, the moments and the map for a video's pixels.
- A video goes out without the stickers: rragent's render leaves `data-preview-only` out, elsewhere take the host out first.
- A video Story is shown with its preview and its moments, never with one frame alone: no sticker on subtitles, text, a face or a picture-in-picture at any moment.
