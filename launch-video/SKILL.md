---
name: launch-video
description: Turn a product's website, a feature, a pasted script or a brief into a launch or promo video for social media (Reels, TikTok, Shorts, Stories, the feeds, YouTube, LinkedIn, X) with HyperFrames, by HyperFrames' own current guides for story, look, motion and review; every word and the product kept clear of the apps' buttons for the platforms it goes to (agentitos' platform-zones), in the brand's look (brand kit), with voice, music and pictures through OpenRouter instead of a HeyGen account. Shown as a preview, agreed in the chat, then rendered. Use for SaaS promos, feature reveals, product demos, app and company launches, site tours.
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

You run in rragent: the chat on the left, the artifacts beside it. `<skill>` below is the folder this file is in. Run its tool as `node <skill>/tools/launch.mjs …` from your working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

This skill is a thin layer over **HyperFrames' own guides**, which say how a good film is told, looks, moves and is reviewed. It adds what they leave to HeyGen or to a generic frame: the platforms' zones, the brand kit, and voice, music and pictures through OpenRouter. Where this file and the guides disagree, this file wins.

## What it needs

Node 20+, ffmpeg, the HyperFrames CLI (the `hyperframes` template needs it too), agentitos' `platform-zones` and `captions` skills beside this one (where the apps' buttons are; the captions), `brand-kit` beside it for a brand without a kit, and OpenRouter: `OPENROUTER_API_KEY`, or on a Sprite the gateway's OpenRouter connection, which the tool finds by itself. No HeyGen account. Nothing to `npm install`. When something is missing, say so in one sentence instead of installing it yourself.

## The guides

```bash
node <skill>/tools/launch.mjs guides
```

prints where HyperFrames' guides are on this machine: the ones its CLI carries, of the version that renders. Read, before planning: `hyperframes/SKILL.md` (the contract, the work loop), `references/types/launch.md`, `references/story.md`, `references/spec.md`; for a vertical film `references/types/vertical.md`; while building `references/format.md`, `references/motion.md`, `references/look.md`, `references/sound.md`; before the preview `references/review.md`. Read each when its step comes, not all at once. How to read them here:

- A `/name` in them is the guide `<guides>/<name>/SKILL.md` (`/media-use`, `/hyperframes-cli`). `/hyperframes-registry` is not on the machine: `hyperframes catalog --json` searches the registry, `hyperframes add <name>` installs a block.
- `npx hyperframes …` (and `hyperframes …` here) is the command `guides` prints on its last line: the CLI of this machine, `hyperframes` when it is on the PATH, else `node <its path>`. Always give it the project folder, `artifacts/<name>/composition`: run from elsewhere it finds no `index.html`.
- **The zones:** every number about where text may sit (vertical.md's 168 and 1330 px, "the 80% title-safe box", "600–700 px from the bottom" for captions) is replaced by this skill's `zones`. HyperFrames' check sees text under the apps' buttons only through `<skill>/tools/launch.mjs check`.
- **Media:** voice, music and pictures come from this skill, never HeyGen. Sound effects and logos come from media-use, which needs no account: `hyperframes media-use resolve --type sfx --intent "…" --project <composition>` and `--type logo`. No avatar, no HeyGen voice clone, no catalog music: say so when asked, and offer what is here.
- **Studio, the desktop app, Framey, `publish`, `usage`:** not here. The preview is the player beside the chat, the render is the `render` tool.
- **Checking and looking:** rragent's template leaves `hyperframes check` to the render; for this skill it runs before the first preview and after a change of layout or timing (step 7), and HyperFrames' `snapshot --review` sheets come with the stills of every beat.
- **Planning files:** `STORYLINES.md`, `SPEC.md`, `REVIEW.md` go into your work folder, not into the project, so they never show as artifacts.

## From the link to the video, all in the chat

The person gives a link (a product, a feature, a launch post), a script or a few lines, maybe their own screenshots or a screen recording (`uploads/…`). Your files: `launch/<name>/` (`<name>` a short slug of the product or feature: lowercase letters, digits and dashes). The project: `artifacts/<name>/`, its HyperFrames project `artifacts/<name>/composition/`. The video at the end: `artifacts/<name>.mp4`. Keep every message short: one or two sentences and a hiccup block. Speak the person's language. Decide what you can and say what you decided; ask only what only they can answer.

### 1. The source and the brand

Tell them in one sentence that you are reading their site, then:

```bash
hyperframes capture <url> --json -o launch/<name>/capture   # --skip-vision when it asks for a key
```

It saves the page's screens, text, colours, fonts and pictures. Read what it says, look at the screenshots, and gather the facts: what the product does, real numbers, real labels, the call to action. Real UI only (launch.md): the product's own screens from the capture or their uploads; a screen you cannot get becomes a labelled placeholder, and you say so. A screen behind a sign-in is the one thing worth asking for: ask once, naming the screen per beat.

The brand: `brand/DESIGN.md` exists → take it. Else draft it with agentitos' brand-kit (`node <brand-kit>/tools/site.mjs <their site> launch/<name>/site`, then `node <brand-kit>/tools/kit.mjs draft launch/<name>/site brand`; `<brand-kit>` is `<skill>/../brand-kit`) and say in one line that the film uses the brand drafted from their site. Its colours, its fonts (the font files under `brand/`, as `@font-face` in `assets/fonts/`, see format.md) and its logo are the film's; the accent is rationed as story.md §7 says.

### 2. Where it goes: the frame and its zones

The platforms the person named decide the frame: Reels, TikTok, Shorts, Stories → 9:16; the feeds → 4:5 or 1:1; YouTube → 16:9. They named none: 9:16 for the usual vertical platforms together. Different frames at once (Reels and YouTube): one film per frame; build the one they need first and offer the other, recomposed, not squeezed.

```bash
node <skill>/tools/launch.mjs zones launch/<name> [reels tiktok …] [--frame 4:5]
```

prints the frame's size, the **safe box** (every word, the product, faces and the logo stay inside), the **centred** box (the safe box even about the frame's middle), the **wide** stretch at the top of a vertical frame, where the captions end, what each app covers, and where a feed crops the film. Then make the project, once, with the `project` tool (`create`, name `<name>`, kind `hyperframes`): everything the next steps write into `artifacts/<name>/composition/` needs it to exist first. These numbers go into SPEC.md's OUTPUT line and are the layout's grid: centre titles, cards and captions on the frame, at most the centred box's width, never in the safe box: in a vertical frame the buttons sit on the right, so the safe box's middle lies left of the frame's and text centred in it looks off. Only something meant to sit on one side (a label in a corner) takes the safe box's edge. Lay out every beat by platform-zones' rules ("Laying out a frame" in `<skill>/../platform-zones/SKILL.md`) and start each from the matching pattern in `<skill>/../platform-zones/references/layouts.md` (hook + talking head, big number, product with callouts, screencast + face, end card, …). Only ground, texture and the rest of a picture run under what the apps cover. The hook's words and the face also stay inside the feed's crop.

### 3. Three storylines, one pick

Follow story.md: the one thing, then three storylines that are three different films, each with its name, its first two seconds, its beats, its look and its sound in a line; your recommendation first. Write them into `launch/<name>/STORYLINES.md` and show them in the chat, one button each (the recommended one `:class "primary"`), with one assumption line: the length as a range, the frame and platforms, voice or music only, and what costs money (a voice about 4–8 cents per 30 s, music 4–8 cents, a generated picture a few cents; nothing from HeyGen). Then stop until they pick. When they asked for no questions ("just make it"), take your recommendation and name the others in a line each.

### 4. The spec

Write `launch/<name>/SPEC.md` by spec.md: every adjective a number, the shots by frame, the BANNED line. OUTPUT: `HyperFrames, <W> x <H>, 30 fps; safe box <x, y, w, h>; for <platforms>`.

### 5. The sound

A film over about 15 s gets music and sound effects on its visible actions (sound.md); a voice only when the person asked for one or the storyline is narrated.

- **The voice.** Write the lines into `launch/<name>/script.json`: `{"voice": "sarah", "lines": [{"id": "hook", "text": "…"}, …]}`, one line per beat, in the person's language, the product's name as they write it. `node <skill>/tools/launch.mjs voices` lists the speech models with their price and voices (default: ElevenLabs v3, voice "sarah"; Gemini TTS and others take `"instructions"` for the delivery). When the voice matters to them, `sample launch/<name> --text "<the hook>" --voices a,b,c --out uploads/voices-<name>` lets them choose by ear (an `[:audio]` each). Then

  ```bash
  node <skill>/tools/launch.mjs voice launch/<name> launch/<name>/script.json artifacts/<name>/composition
  ```

  speaks every line into `assets/voice/<id>.mp3` and writes each word's time into `launch/<name>/voice.json`: the voice is the film's clock, and each beat starts on the word that says it. A line said wrong: change its text and run it again; only that line is spoken again.
- **The music.** `node <skill>/tools/launch.mjs music launch/<name> artifacts/<name>/composition --prompt "<feel, tempo, instruments, from the storyline's sound line>" --seconds <the film's length>` composes it with Google's Lyria 3 into `assets/music.mp3`, faded at the end. Once the film has its `<audio id="music">` (step 6), `hyperframes beats artifacts/<name>/composition` finds its beats, and the payoff and the mark land on strong ones. The person's own track always comes first.
- **Sound effects:** `hyperframes media-use resolve --type sfx --intent "<soft mouse click>" --project artifacts/<name>/composition` (free, Openverse), only where something happens on screen (sound.md §4).

### 6. The film

Say in one sentence that the preview is coming, and build `artifacts/<name>/composition/` by the guides: `index.html` as the root, at the frame's size (`data-width`, `data-height`, the viewport, `html` and `body`), id `main`, its timeline `window.__timelines["main"]`; one scene per sub-composition in `compositions/`, the media in `assets/`. Replace the template's example content and its variables, or keep variables only for what the person may want to change (the headline, the call to action). The voice's lines and the music are `<audio>` elements in the root, each with an `id`.

- **Captions**, when there is a voice (most watch muted): `node <skill>/tools/launch.mjs captions launch/<name> artifacts/<name>/composition --style <hormozi|karaoke|wipe|clean> [--mark --product "<name>"]` puts the voice's words, timed where the root plays them, into `composition/captions/` by agentitos' captions skill, placed for the platforms; mount the line it prints once, as the root's last child. After moving a line of the voice, run it again (the key words marked before stay marked while the words are the same; `--mark` marks anew).
- **Pictures** the film needs and no source has (a world's ground, an object the story needs): `node <skill>/tools/launch.mjs image artifacts/<name>/composition/assets/<file>.png --prompt "…" --ratio <9:16>` (Gemini; `--ref` passes a picture to follow). Never for the product's screens, its logo or a real person.

### 7. Check and review, before the preview

```bash
hyperframes lint artifacts/<name>/composition             # while building, seconds
node <skill>/tools/launch.mjs check launch/<name> artifacts/<name>/composition
```

`check` finds every text the apps would cover, with when, where and under which app's buttons: move it out from under them (a ✗ is always fixed). A `!` is text in the safe box's margin, where no app lays anything: it may stay when the layout needs it. Then HyperFrames' own gate and review (review.md), each with the project folder: `hyperframes check artifacts/<name>/composition --json` (minutes), `hyperframes snapshot artifacts/<name>/composition --review`, and the stills of every beat for the zones, `hyperframes snapshot artifacts/<name>/composition --at <every beat's moment> --no-end -o launch/<name>/stills`. Then

```bash
node <skill>/tools/launch.mjs draw launch/<name> launch/<name>/stills
```

draws the zones over every still: look at each for what no check reads (a word inside a screenshot, a face, the product's button under red). Write `launch/<name>/REVIEW.md` as review.md says; fix the P0s.

### 8. Ask whether it is right

One message: the storyline in a line, the length, the platforms the zones are for, what you measured and what you only looked at (the sound was measured, not heard), and **whether it is right**: "Looks good" (`:class "primary"`) and the button that shows the preview ("Show the preview ↗"), with a line that they can type what to change.

### 9. Changes

They name a moment ("at 0:07 the text is too small", "another voice", "more energy"). Change the scene, the script or the music, run `check` again, and ask again as in step 8, saying in one sentence what changed. "For TikTok and Shorts" / "a Story": `zones` again with those platforms, move what the new zones ask for, `captions` again. "Square" / "for YouTube": a film of its own in the other frame (step 2).

### 10. The video

Only after their "looks good": say in one sentence that you are rendering it, render with the `render` tool and name `<name>` (it writes `artifacts/<name>.mp4`), then

```bash
node <skill>/tools/launch.mjs finish artifacts/<name>.mp4
```

brings it to −14 LUFS, the loudness the platforms play at. Say in one sentence that it is ready, with the download link. Offer to publish it with a button "Publish it": then follow agentitos' **publish-video** (beside this skill) with the video; it checks it, writes the texts with video-descriptions and schedules it through Storrito. Never call Storrito's schedule procedures yourself.

`remember` the person's platforms, voice and caption style for the next film.

## An Instagram Story

When one of the targets is an Instagram Story, it can carry Instagram's own stickers: a link to the page, a poll, a question, a countdown. Ask once which one fits (the likely one ticked: a link when there is a page to go to; "none" is an answer too). Then follow agentitos' **story-stickers** (`<skill>/../story-stickers/SKILL.md`, on a Sprite else `/home/sprite/skills/story-stickers/SKILL.md`): the stickers as Storrito's elements in `stickers/<name>/layer.html`, checked with `storrito/check-instagram-story` (its picture goes into the chat), in the preview as a `data-preview-only` scene, published with publish-video's `--stickers`.

- Keep a band free for them in the film, planned with the scenes (a link sticker needs about 180 px of height, a poll about 570): no text, no captions, no face and no product in it for the whole length. The stickers go into a flexbox over that band.
- Never draw a sticker, a "link in bio" or an arrow to a link into the Story's video: Storrito lays the real stickers over it, and Instagram makes them tappable.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; an `input` is a checkbox or a radio button, and `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block, comma-separated; `:open "artifacts/<name>"` shows the preview. Links, pictures, audio and videos point at `https://…`, `artifacts/…` or `uploads/…`. There are no text fields: for a change they type.

- One question per block, buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else. Several picks from one list (accounts, platforms, moments): checkboxes and one button. Several questions that must all be answered before you can go on, none depending on another's answer: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`, or checkboxes), each with its own `:name`, at most four groups, and one button whose `:send` holds `{checked}`; every `:value` says what it answers ("YouTube: public"), as they arrive in one line. An answer that leaves a group out is asked again for that group only. Ask one after the other only when a question depends on the answer before, or on work the person should see first. Nothing ticked where the choice is the person's; the likely answer ticked where it is yours to propose.
- The button that moves on gets `:class "primary"`; the others stay plain.
- Never put a token, a path of `launch/` or a raw error into the chat.

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
- Every word and the product clear of the apps' buttons of the platforms it goes to, text centred on the frame; `check` before every preview.
- The preview first, the render only after the person's yes; publishing only when they ask.
- Change the scenes, the script or the music and build again; never patch a rendered video.
