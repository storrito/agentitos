---
name: b-roll
description: Show what someone talks about at the moment they say it (b-roll, cutaways) in a video of a person talking to camera; their product's page, the post or article they quote, a number as a card, their own photos, screenshots and clips. Choose the moments from the words, place each on its word, frame it clear of the platforms' buttons and the captions, check every beat on a sheet of frames, show it as a HyperFrames preview, agree on it in the chat, then render. Also the b-roll step of best-takes and clips (offered once their cut is agreed). Use for talking-head clips, explainers, product videos and podcast clips that only show a face.
license: MIT
metadata:
  title: "B-roll"
  title-de: "B-Roll"
  summary: "What you talk about, on screen as you say it: your page, the post you quote, the number, your own pictures."
  summary-de: "Was du erzählst, im Bild, während du es sagst: deine Seite, der Post, den du zitierst, die Zahl, deine eigenen Bilder."
  ask: "Upload a video in which you talk, and the pictures, screenshots or clips that go with it (a link to your page or to a post works too). I show them at the moments you mention them. You see the plan and a preview first."
  ask-de: "Lade ein Video hoch, in dem du sprichst, und die Bilder, Screenshots oder Clips, die dazu passen (ein Link zu deiner Seite oder zu einem Post geht auch). Ich zeige sie genau dann, wenn du davon sprichst. Du siehst zuerst den Plan und eine Vorschau."
  placeholder: "Upload a video"
  placeholder-de: "Video hochladen"
  inputs: "video, image"
  templates: [hyperframes]
---

# b-roll

You run in rragent: the chat on the left, the artifacts beside it. `<skill>` below is the folder this file is in. Run the tool as `node <skill>/tools/broll.mjs …` from your working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

## What it needs

Node 20+, ffmpeg, the HyperFrames CLI (the `hyperframes` template needs it too), agentitos' `transcribe` skill (the words), `page-shot` (pictures of pages and posts), `platform-zones` (where the apps' buttons are) and, for captions, `captions` beside this one, and OpenRouter for the words: `OPENROUTER_API_KEY`, or on a Sprite the gateway's OpenRouter connection (found at `http://sprite.internal`). Nothing to `npm install`. When something is missing, say so in one sentence instead of installing it yourself.

## What b-roll is here

You choose the moments and what shows; the tool places each beat on its word, frames it, keeps what must be read clear of the apps' buttons and the captions, and warns about what looks wrong. The rules of good b-roll are in the brief the tool writes (`brief.md`): read it every time. In short: show what the sentence is about, not its keyword; on the word, never before it; 2–4 s a beat; fewer, right ones (no b-roll is better than wrong b-roll); a feeling, a joke or a metaphor gets none.

What can be shown, from where:

- **The person's own material**: the photos, screenshots and clips they upload. The best b-roll there is: ask for it by name when a moment needs it ("a photo of your shop for 0:12").
- **A page**: `shot <url> <file.png>` takes it as a phone shows it (`--desktop` as a laptop, `--from 900` further down), with a cookie banner clicked away and animations at their end. Their own website (the brand kit's `url`), an article or a study the words name.
- **A post on X**: `shot <link to the post> <file.png>` takes its card. A post on Instagram, TikTok or LinkedIn: ask for a screenshot.
- **A number**: a card in the brand's colours (`"number"`), no material needed.
- **A picture made by a model**: only when the person asks for one; agentitos' launch-video makes it (`launch.mjs image`).

Never download other people's videos or photos from the web: their use needs their owner's permission. A post or an article shown as a screenshot, with its source (`"credit": true`), is a quote.

## From the video to the video with b-roll, all in the chat

The person attaches a video and perhaps pictures and clips; their message names each as a line `video: uploads/<file>` or `image: uploads/<file>`. Your files: `broll/<name>/` (`<name>` a short slug of the topic, lowercase letters, digits and dashes). The artifacts: the project `artifacts/<name>/`, the preview, and at the end the video `artifacts/<name>.mp4`. Keep every message short: one or two sentences and a hiccup block. Speak the person's language. Before the preview, ask nothing: decide, and say what you decided.

1. **The words.** Say in one sentence that you are listening to the video. `node <skill>/tools/broll.mjs words uploads/<file> broll/<name>`. Fix a misheard name in `broll/<name>/words.json` yourself, keeping the times.
2. **The brief.** `node <skill>/tools/broll.mjs brief broll/<name>/words.json broll/<name> [uploads/<picture> …]` (every picture and clip the person brought). Read `broll/<name>/brief.md`, all of it.
3. **The material.** For each moment worth showing, find the thing: among the uploads; a page or a post with `shot` (the links in the person's message, their website from `brand/DESIGN.md`); a number. Look at every picture you took (`Read` it): a banner still in the way, a login wall, a site's notice that it blocks automated visits, an error page or an empty page is no b-roll; take it again (`--from`, `--desktop`), or ask the person for a screenshot of it.
4. **The plan.** Write `broll/<name>/broll.json` as the brief says, with a `"why"` for every beat.
5. **The preview.** Make the project once, with the `project` tool: `create`, name `<name>`, kind `hyperframes`. Then
   ```bash
   node <skill>/tools/broll.mjs project uploads/<file> broll/<name>/broll.json broll/<name>/words.json artifacts/<name>/composition [--captions <style>] [--platform reels,tiktok]
   node <skill>/tools/broll.mjs sheet artifacts/<name>/composition --out broll/<name>/sheet.jpg
   ```
   `project` builds the video with its b-roll (and captions, when the person wants them; the styles are agentitos' captions'); it lists every beat and warns (⚠). `sheet` takes the preview at every beat: a row each, just before it, its middle, just after it. **Look at the sheet** row by row: the middle shows the thing the words name, whole where it must be, nothing to be read under the captions; no watermark, burned-in subtitles or stranger's name; before and after, the face or the next beat. Fix what is wrong in `broll.json` and run both again; fix a ⚠ unless you have a reason not to.
6. **Ask whether it is right.** One message: the beats as a list, each with its time, what is said, what shows (a small picture of it) and the why, a checkbox each, all ticked (they are your proposal); one button that keeps the ticked ones (primary, its `:send` with `{checked}`), the button that shows the preview, and a line that they can type what to change. Name, in one sentence, a moment that would gain from their own material ("a photo of your shop would fit at 0:12"). Do not show them the sheet.
7. **Changes.** Change `broll.json` and run `project` and `sheet` again, then ask again in one sentence. Typical wishes:

   | They say | You do |
   | --- | --- |
   | unticks beats | take them out of `broll.json` |
   | "Longer" / "shorter at 0:20" | `"until"` a later or earlier word, or `"seconds"` |
   | "Earlier" / "later" | `"at"` another word (never before the word that names it) |
   | "Show all of it" / "it is cut off" | `"fit": "whole"` |
   | "I can't read it" | `"fit": "read"`, or a narrower `shot` (the part that matters) |
   | uploads a picture for a moment | a beat with it at that moment's word |
   | "No source" / "with source" | `"credit"` out or in |
   | "Captions too" / "another style" | `project … --captions <style>` |

8. **The video.** Only after their yes. Tell them in one sentence that you are rendering it now. Render with the `render` tool, name `<name>`: it writes `artifacts/<name>.mp4`. Say in one sentence that it is ready, with the download link and a button "Publish it"; to publish, follow agentitos' **publish-video** with `artifacts/<name>.mp4`.

The conversation goes on: `remember` what they want every time ("no sources", "my numbers in green", a caption style) and use it for the next video without asking.

## For another skill: best-takes and clips

best-takes (and clips, which cuts through best-takes) offers b-roll once the person agreed to the cut, when its words name things that can be shown (a product, a page, a post, a number). The words are the cut's own, with the word numbers of the brief: `takes/<name>/edit.json`.

```bash
node <skill>/tools/broll.mjs brief takes/<name>/edit.json takes/<name>/broll [uploads/<picture> …]
# take pages and posts with `shot`, look at them, write takes/<name>/broll/broll.json
node <best-takes>/tools/takes.mjs broll takes/<name> takes/<name>/broll/broll.json
node <skill>/tools/broll.mjs sheet artifacts/<name>/composition --out takes/<name>/broll/sheet.jpg
```

`takes.mjs broll` keeps the file in `cut.json` and builds again: every later build mounts the b-roll under the captions, on the cut's word numbers, so a beat stays on its word when the cut changes, and one whose word was cut out is left out (the build says so). `--off` takes it out. Then look at the sheet and ask as in step 6.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; an `input` is a checkbox or a radio button, and `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block, comma-separated; `:open "artifacts/<name>"` shows the preview. Links, pictures and videos point at `https://…`, `artifacts/…` or `uploads/…`. There are no text fields: for a change they type.

- One question per block, buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else. Several picks from one list (beats, accounts, platforms): checkboxes and one button. Several questions that must all be answered before you can go on, none depending on another's answer: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`, or checkboxes), each with its own `:name`, at most four groups, and one button whose `:send` holds `{checked}`; every `:value` says what it answers, as they arrive in one line. An answer that leaves a group out is asked again for that group only. Ask one after the other only when a question depends on the answer before, or on work the person should see first. Nothing ticked where the choice is the person's; the likely answer ticked where it is yours to propose.
- The button that moves on gets `:class "primary"`; the others stay plain. A button that opens an artifact ends its text with " ↗".
- A button's text says what happens; its `:send` reads as the person's answer.
- Never put a token, a word number, a path of `broll/` or `takes/`, or a raw error into the chat. The pictures of the beats are in the project: `artifacts/<name>/composition/broll/assets/…` (`beats.json` there names each beat's).

The plan with the preview:

```hiccup
[:div
 [:p "Four moments where I show what you are talking about:"]
 [:label [:input {:type "checkbox" :name "beats" :value "0:03 your page" :checked true}]
  " " [:strong "0:03"] " „…our new booking page…“ → your booking page "
  [:img {:src "artifacts/booking/composition/broll/assets/01.png" :style {:height "64px" :vertical-align "middle"}}]] [:br]
 [:label [:input {:type "checkbox" :name "beats" :value "0:12 the number" :checked true}]
  " " [:strong "0:12"] " „…three times as many bookings…“ → the card " [:em "3×"]] [:br]
 [:label [:input {:type "checkbox" :name "beats" :value "0:21 Anna's post" :checked true}]
  " " [:strong "0:21"] " „…as Anna wrote…“ → her post, with her name as source"] [:br]
 [:p [:button {:class "primary" :send "Keep these: {checked}"} "Keep the ticked ones"] " "
  [:button {:open "artifacts/booking"} "Show the preview ↗"]]
 [:p [:small "A photo of your shop would fit at 0:30: upload it and I put it there. Or tell me what should be different."]]]
```

## Rules

- On the word, never before it; show the point, not the keyword; fewer, right ones.
- Only material the person may use; never other people's videos or photos from the web.
- Look at every picture you took and at the sheet before the person sees anything.
- Change `broll.json` and build again; never edit a built `index.html` by hand.
- The preview first, the render only after the person's yes.
