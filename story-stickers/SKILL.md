---
name: story-stickers
description: Turns a picture or video the person brings, or a HyperFrames film, into an Instagram Story with Instagram's tappable stickers (link, poll, countdown, music, …), previewed and then scheduled through Storrito.
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

No tools: you write the Story as HTML, a HyperFrames preview shows it with Storrito's real stickers, and Storrito publishes it (a video through publish-video), refusing what would make the post fail. `<skill>` is the folder this file is in. Full reference: [README.md](README.md).

## How it works

A sticker is never drawn into the picture or the video, never faked with a picture or a "link in bio" text: Storrito gets the picture or video and the stickers as `<insta-…>` elements and gives them to Instagram as real stickers (a link opens, a poll counts). The preview loads the same components, so it shows what the Story will look like.

- **A picture**: one Story frame laid out in HTML (step 2), nothing rendered by you. Several pictures: one frame each, in their order.
- **A video**: rendered or brought without stickers; the person sees the stickers over the whole video in the preview, you make sure the band stays free (step 4), then publish (step 5).
- A sticker shows for the whole Story, first to last second: only where nothing matters (no text, face or product under it).
- One sticker that asks for a tap (poll, question, quiz, slider, countdown) per Story gets the most answers; a link sticker can come with it.
- A video is 1080×1920 and at most 60 s; a picture best 1080 px wide or more.
- A picture or video the person brings: do only what was asked. One picture and a link make one frame with a link sticker; no text, frames or captions they did not ask for; a line of text only when they want one, in their words. (A film you make for another skill follows that skill.)
- A link sticker's `url` is the person's page or one they named; never invent one.
- Music is Instagram's music sticker with a song the person picks, never one you guess: "Music" below.

## 1. The stickers: a band, and flexbox in it

Choose a **band** where the picture or film never shows anything the viewer must see or read: no text or subtitles, face, product, logo, picture-in-picture, content. Background, texture and decorative motion may lie behind. In a film you make, plan the band with the scenes and keep it free for the whole length; in a picture or video the person brings, find it on the picture or its moments (step 4). Write `stickers/<name>/layer.html` (`<name>` a short name of the Story): one flexbox over the band, the browser spaces the stickers:

```html
<div style="position:absolute;left:60px;right:60px;top:1350px;bottom:300px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px">
<insta-link url="https://example.com/shop" text="Zum Shop"></insta-link>
<insta-poll question="Schon probiert?" options='["Ja","Noch nicht"]' color="pink"></insta-poll>
</div>
```

- `top`/`bottom` set the band, inside Instagram's safe zone: `top` 250 px or more, `bottom` 300 px or more, `left`/`right` 60 px or more (platform-zones' `zones instagram-story` has the exact box).
- Tall enough for its stickers, 40 px between them: link, hashtag, mention, location 177 px tall (width follows the text, "Shop Now" 605 px); poll 768 wide, 566 / 728 / 890 tall with 2 / 3 / 4 options; question 771 × 454; quiz 771 wide, 541 / 709 / 877 tall; countdown 693 × 433; emoji slider 818 wide, 262 tall without a question, 467 with one; music `simple` 201 tall (width follows the song, about 640), `album-art` 561 × 705, `vinyl` 561 × 688.
- To one side: `align-items:flex-start` (left) or `flex-end` (right) and the band's `left`/`right`; two side by side: `flex-direction:row`.
- A turn: `style="transform:rotate(-3deg)"` (−6 to 6 looks placed by hand); smaller: `transform:scale(0.85)` (not below 0.75: hard to tap).
- Attribute values with `"` go in single quotes, as `options` above.
- Only a sticker that must sit on an exact spot (over a button the picture shows) is placed alone by its centre: `<insta-link … style="position:absolute;left:540px;top:1470px;width:max-content;transform:translate(-50%,-50%)">` (`width:max-content` always, else Storrito warns it is squeezed).

| element | attributes | look |
| --- | --- | --- |
| `insta-link` | `url` (https), `text` (1–3 words: "Zum Shop", "Read more") | `design`: default, gray, black, rainbow (invisible: see the reference) |
| `insta-poll` | `question`, `options` (JSON list of 2–4) | `color`: black, pink, lavender, purple, orange, green, blue |
| `insta-question` | `question` | `color`: white, black, pink, lavender, purple, orange, green, blue |
| `insta-quiz` | `question`, `options` (2–4), `correct-answer` (0-based) | `color`: as poll |
| `insta-countdown` | `title`, `end-time` (UTC, `2026-11-01T17:00:00Z`, after the Story goes out) | `color`: black, white, purple, red, orange, yellow, green, blue |
| `insta-emoji-slider` | `question`, `emoji` | `color` |
| `insta-mention`, `insta-hashtag` | `username`, `hashtag` | `design`: default, gray, rainbow |
| `insta-location` | `location` | `design`: default, gray, black, orange, rainbow |
| `insta-music` | `search-term`, `track-id`, `start-ms`: as the person's pick gives them, never written yourself | `design`: simple, album-art, vinyl, invisible (the song plays, a tappable area instead of a visual) |

**Music.** In rragent the person picks the song with the `music_pick` tool, never you: call it with `sectionMs`, how long the song plays (15000 for a picture, which becomes a 15 s video with music; a video's length in ms, at most 60000), and give its link as a card (`[:a {:href "<link>"} "Pick the song ↗"]`). They search the song like in Storrito's editor and drag where it starts; tell them in the same sentence to pick it with the account the Story goes to (the page's account select), since Storrito finds the song again with that account. Then wait: the choice comes back as a message with the `<insta-music search-term=… track-id=… start-ms=…>` element. Put it into the layer as it is, only `design` added, and show the preview; the preview shows the song's name on a gray cover, the Story the real cover. One music sticker per Story. Without `music_pick` (another agent): ask the person which song and write `<insta-music search-term="<title> <artist>">`; Storrito takes the first song it finds.

Before a sticker goes into the layer, read `<skill>/references/accounts.md`: Instagram does not offer every sticker to every account, and Storrito refuses a Story with one the account lacks.

**The look.** Never ask before the first picture: choose yourself, name it in half a sentence with the picture, offer the likely others as buttons under it.

- `default` (the white pill) unless the sticker sits on something very bright: then `black` (link, location) or `gray`; `rainbow` only for playful content.
- Poll, question, quiz: the Instagram colour nearest the brand's (a brand kit's primary colour), else `pink` or `purple` on a calm picture.
- Choose once, by these rules, before the first snapshot, and show that one: no second guess of your own on contrast or colour after you have seen it.
- Two or three designs that suit this picture as buttons ("Black", "Gray", "Rainbow" for a link), each `:send "The link sticker in black"`: change `design`, copy it into the scene, show the new snapshot. One round only unless the person asks.

Storrito's full reference (every attribute, its default, the sizes): https://storrito.com/documentation/api/v1/story-components.md, `fetch` it only for an attribute the table above does not have.

## 2. A picture

Upload it to Storrito first (`<bytes>` from `stat -c%s`, content type `image/jpeg` or `image/png`):

```clojure
(def upload (storrito/create-temp-blob-upload-url {:tempBlobUuid (str (random-uuid)) :contentType "image/jpeg" :contentLengthBytes <bytes>}))
```

```bash
curl -sS -T <picture> -H 'Content-Type: image/jpeg' '<uploadUrl>'
```

Its `:url` is the picture's. Its size (`ffprobe -v error -show_entries stream=width,height -of csv=p=0 <picture>`) decides the layout:

- **Nearly 9:16** (width ÷ height 0.5 to 0.62): it fills the frame, `object-fit:cover`; `object-position` keeps what matters (`center 30%`).
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

The filled frame: the same without the blurred `<div>`, the picture `style="position:absolute;inset:0;width:1080px;height:1920px;object-fit:cover"`. Put the band where the picture is calm: below or above a landscape picture, on the blurred part. Fonts that always load: `Instagram Sans Condensed`, `Roboto`, `AvenyT`, `Noto Color Emoji`. This HTML is the Story: keep it in the REPL, `(def story-htmls ["<insta-story>…</insta-story>"])` (one per frame, in order), show it (step 3), schedule it (step 5).

## 3. The preview beside the chat

The person sees the Story in a HyperFrames preview with Storrito's real stickers, never a description of it. In rragent create the project first, with the `project` tool (`{"action": "create", "name": "<name>", "kind": "hyperframes"}`), before anything goes into `artifacts/<name>/`; pictures you make to look at (sheets, maps) go to `uploads/`, never into the project. The preview is never rendered: it only shows.

Read `<skill>/references/preview.md` before writing the preview: the scene `compositions/story-stickers.html` (the lines of `layer.html` plus Storrito's components) and an `index.html` with what goes under the stickers (the elements inside the picture's `<insta-story>`, or the video), the scene mounted over it as the root's first child, marked `data-preview-only`. No `<insta-story>` anywhere in the preview: its black box hides the picture.

- **A film you are making** is its own project: mount the scene into it at the start, so you design around the stickers.
- **Several Stories** (several pictures, a test set, the frames of one Story): one project, each Story its own composition in `composition/<NN>-<slug>/` (`01`, `02`, … in posting order) with its own `index.html` and `compositions/story-stickers.html`, and delete `composition/index.html`: then the preview shows them side by side, each titled by its `<title>`. Never chain several Stories in one timeline.
- Open the preview beside the chat (`:open "artifacts/<name>"`); a picture for the chat: `npx hyperframes snapshot --at 1 --no-end -o uploads/<name>-preview` in `composition/` (several Stories: in each `composition/<NN>-<slug>/`, to `uploads/<name>-<NN>`).
- After a change of `layer.html`, copy its lines into the scene again.
- No README in the project: the Story is its HTML.
- rragent's `render` leaves `data-preview-only` elements out of a film's video; the HyperFrames CLI or Studio does not: there take the host out before the render.

## 4. Is the band free, the whole time?

Look at the preview first: a sticker on a face, text or the product is wrong, and a band too small for its stickers spills over both its edges.

**A picture without a line of text**: the snapshot is the whole check. No `hyperframes check`, no sheets: one snapshot after each change, looked at once.

**Text in a film you make, or a picture's line of text**: HyperFrames checks it against the band, given in fractions of the frame (`left/1080`, `top/1920`, `1 - right/1080`, `1 - bottom/1920`):

```bash
npx hyperframes check --json --caption-zone "x0=<left/1080>;y0=<top/1920>;x1=<1-right/1080>;y1=<1-bottom/1920>;severity=error;seek=.5,1"
```

Every `caption_zone_collision` names the text, its moment and its box: move the text out of the band, or the band.

**A video's pixels** (burned-in subtitles, a face, a picture-in-picture, the product), every moment: always for a video the person brings; for a film you made only when footage you do not know frame by frame runs under the band (a stock clip with people or text); a band kept free by design needs only `--caption-zone`. Read `<skill>/references/video-moments.md` before checking a video's pixels: the ffmpeg commands for the sheets of moments and the occupancy map, how to choose the band from them, and what to offer when no band is free (say so; re-rendering a film you made only after the person's yes).

Show the moments or the map in the chat with the preview and say in one sentence what the band keeps clear of ("below the subtitles, left of the webcam"). A video Story is never shown with one frame alone.

## 5. Publish

Only after the person's yes. Ask what has more than one answer in one block (see "UI in the chat"): the account (`(storrito/list-social-accounts {})`: those whose `postTypes` have `schedule-instagram-story`, and only those that have the Story's stickers, see `references/accounts.md`; one: take it; none or `disconnected`: `(storrito/create-connect-link {…})` makes a link), the time ("Now", "Today 18:00", "Tomorrow 9:00"; the time zone only when you cannot tell), Facebook when the account has a page (`facebookDestinations`), or a draft in Storrito's gallery instead.

**A picture**: Storrito's procedures in the REPL. Give each frame and account a UUID and remember it first, so a retry posts nothing twice (Storrito answers a known UUID with the post it has):

```clojure
(def plan (vec (for [account ["mybrand"] [n html] (map-indexed vector story-htmls)]
                 {:account account :n (inc n) :html html :uuid (str (random-uuid))})))
(remember {:story "<name>" :plan (mapv #(dissoc % :html) plan)})
(mapv (fn [{:keys [account html uuid]}]
        (storrito/schedule-instagram-story {:html html :instagramUsername account :storyPostUuid uuid
                                            :date "2026-10-22T16:00:00Z"}))   ; leave :date out for now
      plan)
```

- Storrito refuses what would make the post fail (a link without https, a poll with one answer, an unknown username, a sticker the account lacks: `<skill>/references/accounts.md`) with what to change. Its `warnings` (stickers on each other, CSS it cannot show, an unknown attribute) come with a post already scheduled: `cancel-instagram-story`, fix, schedule again with new UUIDs.
- Several frames go out in their order with the same time. Facebook too: `:shareToFacebook true :facebookDestinationId <id>`; a picture made with AI: `:aiGenerated true`.
- A draft: `(storrito/create-draft {:html html :draftUuid uuid :name "<name>" :folderName "Stories"})`.
- `(storrito/status-instagram-story {:storyPostUuid uuid})` (`status-draft`) once rendered, usually within a minute; `cancel-instagram-story` (`delete-draft`) takes it back. Tell the person in one sentence what is scheduled when and where.

**A video**: the finished video goes to agentitos' publish-video as every video does (its SKILL.md: `check`, `prepare` when it says so, `accounts`), with the layer for the Instagram Story targets:

```bash
node <publish-video>/tools/publish.mjs publish publish/<name> --to instagram/<account>/story --at <ISO time> --stickers stickers/<name>/layer.html
```

The stickers go only on Story targets. Storrito's `warnings` come back in its output: tell the person in one sentence. A Story already scheduled with other stickers is refused until `cancel` takes it back.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; `:open "artifacts/…"` shows a preview. Links and pictures point at `https://…`, `artifacts/…` or `uploads/…`. An `input` is a checkbox or a radio button; `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block. No text fields: for a link or a question they type.

- One question per block, buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else. Several picks from one list: checkboxes and one button. Several questions that must all be answered before you can go on, none depending on another's answer: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`), own `:name` each, at most four groups, one button whose `:send` holds `{checked}`; every `:value` says what it answers. One after the other only when a question depends on the answer before, or on work the person should see first.
- The button that moves on gets `:class "primary"`; alternative answers stay plain. A button that opens a page ends its text with " ↗".
- Never a token, an id the person does not need or a raw error in the chat.

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
