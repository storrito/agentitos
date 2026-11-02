---
name: launch-video
description: Turns a product link, feature, script or brief into a HyperFrames launch or promo video (SaaS promo, feature reveal, demo, site tour) for Reels, TikTok, Shorts, feeds or YouTube, in the brand's look.
license: MIT
metadata:
  title: "Launch video"
  title-de: "Launch-Video"
  summary: "A launch or promo video for your product, made from its website, for Reels, TikTok, Shorts and the feeds: real screens, your brand, music and voice."
  summary-de: "Ein Launch- oder Promo-Video für dein Produkt, aus seiner Website gemacht, für Reels, TikTok, Shorts und die Feeds: echte Screens, deine Marke, Musik und Stimme."
  ask: "Paste the link of your product or feature (or a script or a few lines about it) and say where the video goes: Reels, TikTok, Shorts, YouTube … I suggest three stories, you pick one, and you see a preview before anything is rendered."
  ask-de: "Füg den Link zu deinem Produkt oder Feature ein (oder ein Skript oder ein paar Zeilen dazu) und sag, wo das Video hinsoll: Reels, TikTok, Shorts, YouTube … Ich schlage dir drei Geschichten vor, du wählst eine, und du siehst eine Vorschau, bevor etwas gerendert wird."
  placeholder: "A link, and where it goes"
  placeholder-de: "Ein Link, und wo es hingeht"
  inputs: "image, video"
  templates: [hyperframes]
---

# launch-video

You run in rragent: chat on the left, artifacts beside it. `<skill>` is this file's folder. Run `node <skill>/tools/launch.mjs …` from your working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

This skill is a thin layer over **HyperFrames' own guides**, adding the platforms' zones, the brand kit, and voice, music and pictures through OpenRouter. Where this file and the guides disagree, this file wins.

## What it needs

Node 20+, ffmpeg, the HyperFrames CLI (the `hyperframes` template needs it too), agentitos' `platform-zones`, `captions`, `transcribe` and (for a brand without a kit) `brand-kit` beside this skill, and OpenRouter: `OPENROUTER_API_KEY`, or on a Sprite the gateway's connection (the tool finds it). No HeyGen account, nothing to `npm install`. Something missing: say so in one sentence, never install it.

## The guides

`node <skill>/tools/launch.mjs guides` prints where HyperFrames' guides are (those of the CLI that renders). Read each when its step comes: before planning `hyperframes/SKILL.md`, `references/types/launch.md`, `references/story.md`, `references/spec.md` (vertical film: `references/types/vertical.md`); while building `references/format.md`, `references/motion.md`, `references/look.md`, `references/sound.md`; before the preview `references/review.md`. Here:

- `/name` is `<guides>/<name>/SKILL.md` (`/media-use`, `/hyperframes-cli`). `/hyperframes-registry` is not on the machine: `hyperframes catalog --json` searches it, `hyperframes add <name>` installs a block.
- `npx hyperframes …` / `hyperframes …` is the command on `guides`' last line (`hyperframes` on the PATH, else `node <its path>`). Always pass the project folder `artifacts/<name>/composition`; elsewhere it finds no `index.html`.
- **Zones:** every number about where text may sit (vertical.md's 168 and 1330 px, "the 80% title-safe box", "600–700 px from the bottom" for captions) is replaced by `zones`. Text under the apps' buttons is found only by `<skill>/tools/launch.mjs check`.
- **Media:** voice, music and pictures from this skill, never HeyGen. Sound effects and logos from media-use (no account): `hyperframes media-use resolve --type sfx --intent "…" --project <composition>` and `--type logo`. No avatar, HeyGen voice clone or catalog music: say so when asked, offer what is here.
- **Studio, the desktop app, Framey, `publish`, `usage`:** not here. Preview = the player beside the chat; render = the `render` tool.
- **Checks:** rragent's template leaves `hyperframes check` to the render; here it runs before the first preview and after a layout or timing change (step 7), and `snapshot --review` sheets come with the stills of every beat.
- `STORYLINES.md`, `SPEC.md`, `REVIEW.md` go into your work folder, never into the project (they would show as artifacts).

## From the link to the video, all in the chat

Input: a link (product, feature, launch post), a script or a few lines, maybe screenshots or a screen recording (`uploads/…`). Your files: `launch/<name>/` (`<name>`: short slug, lowercase letters, digits, dashes). Project: `artifacts/<name>/`, HyperFrames project `artifacts/<name>/composition/`, video `artifacts/<name>.mp4`. Every message: one or two sentences and a hiccup block, in the person's language. Decide what you can and say what you decided; ask only what only they can answer.

### 1. The source and the brand

Say in one sentence that you are reading their site, then:

```bash
hyperframes capture <url> --json -o launch/<name>/capture   # --skip-vision when it asks for a key
```

It saves screens, text, colours, fonts, pictures. Gather the facts: what the product does, real numbers, real labels, the call to action. Real UI only (launch.md): the product's own screens from the capture or uploads; one you cannot get becomes a labelled placeholder, and you say so. Only a screen behind a sign-in is worth asking for: ask once, naming the screen per beat.

Brand: `brand/DESIGN.md` exists → take it. Else (`<brand-kit>` = `<skill>/../brand-kit`) `node <brand-kit>/tools/site.mjs <their site> launch/<name>/site`, then `node <brand-kit>/tools/kit.mjs draft launch/<name>/site brand`, and say in one line that the film uses the brand drafted from their site. Its colours, fonts (the font files under `brand/` as `@font-face` in `assets/fonts/`, see format.md) and logo are the film's; the accent rationed as story.md §7 says.

### 2. The frame and its zones

Reels, TikTok, Shorts, Stories → 9:16; feeds → 4:5 or 1:1; YouTube → 16:9; none named → 9:16 for the usual vertical platforms. Different frames at once (Reels and YouTube): one film per frame; build the needed one first, offer the other recomposed, not squeezed.

```bash
node <skill>/tools/launch.mjs zones launch/<name> [reels tiktok …] [--frame 4:5]
```

prints the frame's size, the **safe box** (every word, the product, faces, the logo stay inside), the **centred** box (the safe box even about the frame's middle), the **wide** stretch at the top of a vertical frame, where captions end, what each app covers, where a feed crops. Then create the project once with the `project` tool (`create`, name `<name>`, kind `hyperframes`), before anything is written into `artifacts/<name>/composition/`.

The numbers go into SPEC.md's OUTPUT line and are the grid: titles, cards and captions centred on the frame, at most the centred box's width, never centred in the safe box (in a vertical frame its middle lies left of the frame's). Only something meant for one side (a corner label) takes the safe box's edge. Read "Laying out a frame" in `<skill>/../platform-zones/SKILL.md` before laying out the beats, and start each from its pattern in `<skill>/../platform-zones/references/layouts.md` (hook + talking head, big number, product with callouts, screencast + face, end card, …). Only ground, texture and the rest of a picture run under what the apps cover. The hook's words and the face also stay inside the feed's crop.

A target is an Instagram Story: do "An Instagram Story" below before the storylines.

### 3. Three storylines, one pick

By story.md: the one thing, then three storylines that are three different films, each with its name, first two seconds, beats, look and sound in a line; your recommendation first. Write them into `launch/<name>/STORYLINES.md` and show them, a button each (recommended one `:class "primary"`), with one assumption line: length as a range, frame and platforms, voice or music only, and costs (a voice about 4–8 cents per 30 s, music 4–8 cents, a generated picture a few cents; nothing from HeyGen). Stop until they pick. They asked for no questions ("just make it"): take your recommendation, name the others in a line each.

### 4. The spec

`launch/<name>/SPEC.md` by spec.md: every adjective a number, the shots by frame, the BANNED line. OUTPUT: `HyperFrames, <W> x <H>, 30 fps; safe box <x, y, w, h>; for <platforms>`.

### 5. The sound

A film over about 15 s gets music and sound effects on its visible actions (sound.md); a voice only when the person asked for one or the storyline is narrated.

- **Voice:** read `<skill>/references/voice-and-captions.md` before writing the script (`script.json`, choosing the voice, `voice`, then `captions`).
- **Music:** `node <skill>/tools/launch.mjs music launch/<name> artifacts/<name>/composition --prompt "<feel, tempo, instruments, from the storyline's sound line>" --seconds <the film's length>` composes it with Google's Lyria 3 into `assets/music.mp3`, faded at the end. Once the film has its `<audio id="music">` (step 6), `hyperframes beats artifacts/<name>/composition` finds its beats; the payoff and the mark land on strong ones. The person's own track always comes first.
- **Sound effects:** `hyperframes media-use resolve --type sfx --intent "<soft mouse click>" --project artifacts/<name>/composition` (free, Openverse), only where something happens on screen (sound.md §4).

### 6. The film

Say in one sentence that the preview is coming, and build `artifacts/<name>/composition/` by the guides: `index.html` as root at the frame's size (`data-width`, `data-height`, the viewport, `html` and `body`), id `main`, timeline `window.__timelines["main"]`; one scene per sub-composition in `compositions/`, media in `assets/`. Replace the template's example content and variables; keep variables only for what the person may want to change (headline, call to action). Voice lines and music are `<audio>` elements in the root, each with an `id`. With a voice, add its captions (voice-and-captions.md).

**Pictures** no source has (a world's ground, an object the story needs): `node <skill>/tools/launch.mjs image artifacts/<name>/composition/assets/<file>.png --prompt "…" --ratio <9:16>` (Gemini; `--ref` passes a picture to follow). Never for the product's screens, its logo or a real person.

### 7. Check and review, before the preview

```bash
hyperframes lint artifacts/<name>/composition             # while building, seconds
node <skill>/tools/launch.mjs check launch/<name> artifacts/<name>/composition
```

`check` names every text the apps would cover (when, where, under which app's buttons): a ✗ is always fixed by moving it out. A `!` is text in the safe box's margin, where no app lays anything: it may stay when the layout needs it. Then HyperFrames' gate and review (review.md), each with the project folder: `hyperframes check artifacts/<name>/composition --json` (minutes), `hyperframes snapshot artifacts/<name>/composition --review`, and stills of every beat, `hyperframes snapshot artifacts/<name>/composition --at <every beat's moment> --no-end -o launch/<name>/stills`. Then `node <skill>/tools/launch.mjs draw launch/<name> launch/<name>/stills` draws the zones over every still: look at each for what no check reads (a word inside a screenshot, a face, the product's button under red). Write `launch/<name>/REVIEW.md` as review.md says; fix the P0s.

### 8. Ask whether it is right

One message: the storyline in a line, the length, the platforms the zones are for, what you measured and what you only looked at (the sound was measured, not heard), and **whether it is right**: "Looks good" (`:class "primary"`) and "Show the preview ↗", with a line that they can type what to change.

### 9. Changes

They name a moment ("at 0:07 the text is too small", "another voice", "more energy"): change the scene, script or music, run `check` again, ask again as in step 8 with one sentence on what changed. "For TikTok and Shorts" / "a Story": `zones` again with those platforms, move what the new zones ask for, `captions` again. "Square" / "for YouTube": a film of its own in the other frame (step 2).

### 10. The video

Only after their "looks good": say in one sentence that you are rendering, render with the `render` tool, name `<name>` (writes `artifacts/<name>.mp4`), then `node <skill>/tools/launch.mjs finish artifacts/<name>.mp4` brings it to −14 LUFS, the platforms' loudness. Say in one sentence that it is ready, with the download link, and offer a button "Publish it": then follow agentitos' **publish-video** (beside this skill) with the video; it checks it, writes the texts with video-descriptions and schedules through Storrito. Never call Storrito's schedule procedures yourself.

`remember` the person's platforms, voice and caption style for the next film.

## An Instagram Story

A Story can carry Instagram's own stickers: a link to the page, a poll, a question, a countdown. Ask once which fits (the likely one ticked: a link when there is a page; "none" is an answer too). Then read `<skill>/references/instagram-story.md` before planning the scenes (the free band, story-stickers). Never draw a sticker, a "link in bio" or an arrow to a link into the Story's video: Storrito lays the real stickers over it.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; an `input` is a checkbox or radio button, and `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block, comma-separated; `:open "artifacts/<name>"` shows the preview. Links, pictures, audio and videos point at `https://…`, `artifacts/…` or `uploads/…`. No text fields: for a change they type.

- One question per block, buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else. Several picks from one list (accounts, platforms, moments): checkboxes and one button. Several questions that must all be answered before you can go on, none depending on another's answer: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`, or checkboxes), each its own `:name`, at most four groups, one button whose `:send` holds `{checked}`; every `:value` says what it answers ("YouTube: public"). An answer that leaves a group out: ask again for that group only. One question after the other only when it depends on the answer before or on work the person should see first. Nothing ticked where the choice is the person's; the likely answer ticked where it is yours to propose.
- The button that moves on gets `:class "primary"`; the others stay plain.
- Never a token, a path of `launch/` or a raw error in the chat.

The storylines:

```hiccup
[:div
 [:p "Three ways to tell it, 25–35 s, 9:16 for Reels, TikTok and Shorts, music and sound, no voice:"]
 [:ol
  [:li [:strong "Monday, 9:00"] " — a social media manager with 14 stories to post; one drag into the calendar and the week is planned. Opens on the overflowing to-do list."]
  [:li [:strong "The story builds itself"] " — one link turns into a finished story, frame by frame, in one continuous zoom."]
  [:li [:strong "Before / after"] " — the old way as a pile of tabs, then the same week in one view."]]
 [:button {:class "primary" :send "Take story 1"} "1 (my pick)"] " "
 [:button {:send "Take story 2"} "2"] " "
 [:button {:send "Take story 3"} "3"]
 [:p [:small "My pick: a real moment people know. Or tell me what to change: a voice, another length, other platforms."]]]
```

## Rules

- Real UI, real numbers, the person's own words: nothing the source does not say.
- Change the scenes, the script or the music and build again; never patch a rendered video.
