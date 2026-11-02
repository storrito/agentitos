---
name: story-intros
description: Turns a content plan (a sheet, a file or a list of topics) into a series of animated text Stories for Instagram, each opening with one of four word intros and carrying a link sticker, previewed side by side.
license: MIT
metadata:
  title: "Motion Stories from a content plan"
  title-de: "Motion-Stories aus einem Contentplan"
  summary: "Your content plan as a series of animated Instagram Stories: each opens with a word animation, tells its topic with its own illustration and carries a link sticker."
  summary-de: "Dein Contentplan als Serie animierter Instagram-Stories: jede beginnt mit einer Wort-Animation, erzählt ihr Thema mit eigener Illustration und trägt einen Link-Sticker."
  ask: "Share your content plan (a Google Sheet, a file or a list of topics) and the link the Stories point to. I suggest an intro and a look per Story and show you the first one."
  ask-de: "Teile deinen Contentplan (Google Sheet, Datei oder eine Liste von Themen) und den Link, auf den die Stories zeigen. Ich schlage pro Story ein Intro und einen Look vor und zeige dir die erste."
  placeholder: "Content plan and link…"
  placeholder-de: "Contentplan und Link…"
  inputs: ""
---

# story-intros

`<skill>` is this file's folder. Run the tool as `node <skill>/tools/story.mjs` from your own working directory; never change the files in `<skill>`. Full reference: [README.md](README.md).

Each Story is a 1080×1920 HyperFrames film of 16.60 s: one of four word intros (stamp→orbit, stack→fan, slide→lock, echo→collapse) lands in the first sentence, four scenes follow (headline, body text, an illustration of the topic), the last with the call to action; Instagram's link sticker sits in a band at the bottom the whole time and is laid over the video by Storrito, never drawn into it.

## 1. The plan

- A Google Sheet or another service: if it is not connected, give the person its sign-in link first, before anything else. Read only; never change the plan. A file (CSV, XLSX, JSON) or a list in the chat works too.
- One Story per row the person picks, named `<NN>-<slug>` in posting order (`01-scheduling`). Common columns: the topic and title are the brief, the hook is the wording to start from, the link is the sticker's `url`. A date is planning, never text on screen.
- Only what the plan says: no figures, results, tests or promises it does not have. A drawn chart or app screen is an illustration, labelled as an example when it shows numbers, never passed off as the product.

## 2. What the person decides first

One block (see "UI in the chat"): which rows (checkboxes, all ticked), the link when the plan has none, music (none, or their file, copied unchanged). The brand's colours and fonts come from `brand/DESIGN.md` when there is one (agentitos' brand-kit). Then a table, one line per Story: the intro sentence (2–8 words), the intro, the palette, the illustration's idea. Read `<skill>/references/intros.md` before choosing the intros: which one fits which words, and their limits. Give each Story its own palette and illustration within one family; never the same picture eleven times.

## 3. The first Story, then the rest

1. Create the project (`project` tool, `{"action": "create", "name": "<name>", "kind": "hyperframes"}`) and delete its `composition/index.html`: the preview then shows the Stories side by side.
2. Per Story a config as `<skill>/examples/creative-practice.json` (name, title, language, mode, introCopy, echoKey for echo, colors bg/ink/accent/panel, headline, four bodyBeats, cta, link url/text/design, musicFile), then `node <skill>/tools/story.mjs new <config.json> artifacts/<name>`. It writes `composition/<NN>-<slug>/` and `stickers/<NN>-<slug>/layer.html` once and refuses an existing folder.
3. What it writes is a start, not a draft to show: draw each scene's illustration into its `.topic-illustration` (SVG or HTML, animated on the `rest` timeline), move text and change the hierarchy where the topic needs it. Keep the intro's markup and `assets/series-intro.js` as they are.
4. Show the first Story (a picture for the chat: `hyperframes snapshot artifacts/<name>/composition/<NN>-<slug> --at 3.2 --no-end -o uploads/<name>-<NN>`, which writes `frame-00-at-3.2s.png`) and wait for the person's yes on intro and look before building the others.
5. Everything to be read stays within x 60–1020, y 250–1470; y 1470–1620 is the sticker's band, free of text, faces and products for the whole 16.60 s. Check each Story: `hyperframes check artifacts/<name>/composition/<NN>-<slug> --json --caption-zone "x0=.055556;y0=.765625;x1=.944444;y1=.84375;severity=error;seek=.1,.2,.3,.45,.6,.7,.8,.9"` and fix every `caption_zone_collision`. platform-zones' "Laying out a frame" holds the rules for text: no eyebrow, no counters, dates or a plain URL on screen; the link is the sticker.
6. The sticker follows story-stickers (look, which stickers the account has): after a change of `stickers/<NN>-<slug>/layer.html` copy its lines into the Story's `compositions/story-stickers.html`.

## 4. Render and publish: only when asked

The preview is the deliverable. Render with the `render` tool and publish with agentitos' publish-video and `--stickers stickers/<NN>-<slug>/layer.html` only after the person asks for it; never a schedule, a Storrito draft or a change of the plan without their yes.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; `:open "artifacts/…"` shows a preview. Links and pictures point at `https://…`, `artifacts/…` or `uploads/…`. An `input` is a checkbox or a radio button; `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block. No text fields: for a link or a question they type.

- One question per block, buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else. Several picks from one list: checkboxes and one button. Several questions that must all be answered before you can go on, none depending on another's answer: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`), own `:name` each, at most four groups, one button whose `:send` holds `{checked}`; every `:value` says what it answers. One after the other only when a question depends on the answer before, or on work the person should see first.
- The button that moves on gets `:class "primary"`; alternative answers stay plain. A button that opens a page ends its text with " ↗".
- Never a token, a working path or a raw error in the chat.

The first Story, its snapshot beside the question:

```hiccup
[:div
 [:img {:src "uploads/plan-01/frame-00-at-3.2s.png" :style {:width "180px" :aspect-ratio "9 / 16" :border-radius "8px"}}]
 [:p "Story 1 opens with the orbit: the words turn once in a ring, then land in the sentence. Build the other ten in this style?"]
 [:button {:class "primary" :send "Yes, build the other Stories"} "Yes, build the rest"] " "
 [:button {:open "artifacts/plan"} "Play the preview ↗"]
 [:p [:small "Or tell me what to change."]]]
```
