# b-roll

B-roll for videos in which someone talks to camera: at the words that name something, that thing on the screen, as it is said. The person's product page, the post or the article they quote, a number as a card, their own photos, screenshots and clips. The agent chooses the moments and the pictures from the words (the rules are in the brief the tool writes); the tool places every beat on its word, frames it for the platforms, keeps what must be read clear of the apps' buttons and of the captions, warns about what looks wrong, and takes a sheet of frames of every beat to look at. The b-roll is a [HyperFrames](https://hyperframes.heygen.com) sub-composition mounted under the captions, so the person sees it in the player before anything is rendered.

It is an agent of its own (upload a video and its pictures, get it back with b-roll, see [SKILL.md](SKILL.md)) and the b-roll step of [best-takes](../best-takes/) and [clips](../clips/): `takes.mjs broll` mounts it on the cut's words.

```
node tools/broll.mjs words <video> <dir>
node tools/broll.mjs brief <words.json> <dir> [<picture, video or folder> …]
node tools/broll.mjs shot <url> <file.png> [--desktop] [--from 900] [--height 640]
node tools/broll.mjs build <broll.json> <words.json> <composition>/broll [--size 1080x1920] [--platform reels,tiktok] [--brand brand/DESIGN.md]
node tools/broll.mjs project <video> <broll.json> <words.json> <composition> [--captions hormozi] [--platform …]
node tools/broll.mjs sheet <composition> [--out sheet.jpg]
node tools/broll.mjs face <video> <file.jpg> [--at 12.5]
node --test tools/test.mjs
```

Needs Node 20+, ffmpeg, the HyperFrames CLI (snapshots for `sheet`), agentitos' [platform-zones](../platform-zones/) beside it, for `shot` agentitos' [page-shot](../page-shot/), for `words` agentitos' [transcribe](../transcribe/) and OpenRouter (`OPENROUTER_API_KEY`, or on a Sprite the gateway's `openrouter` connection), for `project --captions` agentitos' [captions](../captions/). No npm packages.

## Where it came from

The rules follow what works in the b-roll of creators who cut fast talking-head videos, as Louise de Sadeleer's [b-roll-finder](https://github.com/louisedesadeleer/b-roll-finder) wrote them down: illustrate the point, not the keyword; land on the word, never before; join beats closer than a flash; mostly real, checkably right things (receipts, the product, the number) rather than vibe clips; never memes picked by an agent; look at every cut before the person does. This skill keeps the rules and leaves the sourcing from YouTube out: for the accounts of businesses that publish through Storrito, only material they may use.

## The steps

- **`words`** runs agentitos' transcribe (ElevenLabs Scribe v2 through OpenRouter) and writes `{width, height, duration, words: [{i, text, start, end}]}`: the words alone, numbered, fillers and noises left out. best-takes' `edit.json` is such a file, with the cut's word numbers and times.
- **`brief`** writes `brief.md`: the rules of good b-roll (what to show for what kind of sentence, the rhythm, the frames), the format of `broll.json`, the material (each picture and video with its size and shape, each `shot` with its source), and every word numbered, a line per sentence.
- **`shot`** runs agentitos' [page-shot](../page-shot/) (`PAGE_SHOT`, else `../page-shot`, else `/home/sprite/skills/page-shot`): a page as a phone shows it (`--desktop` as a laptop, `--from` further down, `--height` more or less), its cookie banner clicked away and its animations at their end; a post on X as its card. Beside the picture, page-shot's `<file>.png.json` names the source, which `build` takes for `"credit": true` and to show it to be read.
- **`build`** places the beats and writes the sub-composition (below), `beats.json` (each beat's times, what is said, its picture) and prints the clip to mount.
- **`project`** writes a whole host composition: the video with its sound, the b-roll over it, and with `--captions <style>` agentitos' captions on top (marked by its model when the words carry no marks yet).
- **`face`** writes a frame of the video in its own pixels with a grid every 100 px, to read the face's box off for `"face"`, and prints the `"source"` size to write beside it.
- **`sheet`** runs `hyperframes snapshot` on the composition at every beat (0.3 s before it, its middle, 0.3 s after it) and tiles the frames into one picture, a row per beat, black where there is no frame.

## Placing the beats

- **Start**: `at` is the word that names the thing; the beat starts 0.05 s after the word starts, never before it.
- **End**: `until` (the last word, +0.2 s), or `seconds`, else the end of the sentence (a pause of 0.8 s ends one too), at least 2 s and at most 4 s after the start.
- **Joins**: beats are sorted by start. One that runs into the next ends where it starts; one less than 1.2 s before the next runs on to it (a flash of the face between two beats looks like a mistake); the last runs on to the end when less than 0.8 s would be left.
- **Gone words**: a beat whose `at` word is not in the words (best-takes cut it out) is left out, and the build says so.
- **Warnings (⚠)**:
  - a beat under 1.2 s, or one to be read under 2.5 s;
  - a still over 6 s, or more than one beat over 5 s;
  - a picture enlarged more than 1.6× to fill, or 2.5× shown whole;
  - something to be read shrunk under 45 % (its text too small on a phone) or enlarged over 2.2×;
  - a video too short for its beat from its `from`;
  - b-roll over more than half the video.

## Frames

- **`beside`** shares the frame: the material in one field, the person in the other, one geometry per video and frame whatever the material (`tools/lib/beside.mjs`, the one place of this rule; its answer carries the names of the layout skill's `beside` command, which will give it once merged). Tall and square frames, from the bottom up: the face at 22 % of the frame's height (`FACE_TARGET`: published Shorts show 18 %, the owner wanted the person a little larger; where the video would have to be enlarged over 1.25 of its own pixels for it, only as far as it stays sharp, and not under 18 % for that) ends 24 px above what the apps cover at the bottom; above it 35 % of its height for the hair; above that, with captions, their band (as high as their block can be: two lines where the style sets two), which they move onto while the beat shows; the material gets the rest, from the safe box's top, over the safe width, 24 px above the band. Only when that is under 18 % of the frame's height does the face give way, never under 12 %, and the build says so. 1080×1920, the usual apps, hormozi, a close-up: material x 60–888, y 250–620; captions x 192–888, y 644–846 (moved 594 px up); the face 422 px (22 %) at y 994–1416, the person's card 600 px wide; without captions the material reaches to y 822. Wide frames (a sketch, not measured): the person on the left third, filled by the video when the face then still fits, else the face at its target; the material on the rest of the safe box, above the captions, which stay. The person's video is scaled and shifted to that (enlarged twice at most; over 1.25 of its own pixels it is said to look soft). A close-up, whose face would be too large at the field's width, shows as a card, the panel around it. A number is set to its field's size; a picture is fitted into it, rounded, over a blurred copy or the brand's colours. The face comes from `"face"` in `broll.json` (px of the source video, `"source"` its size, else the frame's; the host fills the frame with it), else it is assumed in the upper third, in the middle, and the build says so. The proportions come from a layout study of 240 Shorts (a face under a screen in 66 % of the frames that show both).
- **`fill`** covers the frame (`object-fit: cover`).
- **`whole`** fits the whole picture into the frame, over a blurred, darkened copy of itself (for a video, a blurred still of it). A picture low enough sits above the captions' band, not behind it.
- **`read`** fits it into platform-zones' centred box (the box the apps leave free, even about the frame's middle) less a band of 320 px (on a frame whose short side is 1080) at its bottom, where the captions' lowest lines sit, with rounded corners and a shadow, over a blurred copy, or with a brand kit over a gradient of its colours.
- **Default fit**: a number and what `shot` took are `beside`. Any other picture is `fill` when its shape is within 25 % of the frame's, else `whole`. A fit written out means what it meant before `beside`; a number with any fit but `beside` is the card over the whole frame.
- **`credit`** sets the source in small type under a picture to be read (else at the top of the captions' band).
- **Number cards** over the whole frame (`"fit": "fill"`): the card sits in the read box, the number as big as fits in one line, in the brand's primary colour on its darkest one (white where the contrast is too low; the brand's display font), with a short label under it.

## The sub-composition (`tools/lib/render.mjs`)

- **The files**: `build` writes `<folder>/index.html` and `<folder>/assets/`.
- **Pictures**: PNG, JPEG and WebP are linked as they are; other formats (HEIC from an iPhone) become JPEG.
- **Videos**: linked when they are H.264 in MP4, else made so. Their sound is dropped: b-roll plays muted under the voice.
- **The mount**: `<div id="broll" data-composition-id="broll" data-composition-src="broll/index.html" data-start="0" data-duration="…" data-track-index="5" …>`. Put it before the captions' mount: the later element is painted on top.
- **Inside the file**: everything the runtime needs is inside its `<template>`, following the HyperFrames core skill's sub-composition rules. The root is styled by `#root`; the host slot, the root and the timeline all have the id `broll`. Every beat is a clip of its own, a picture or a muted `<video>` with `data-media-start`, its blurred background another.
- **The person beside**: a beat beside the person is an opaque panel holding the material, cut out by a `clip-path` polygon around a rounded hole. The person moves into their field over 0.5 s (`power2.inOut`) and back at the end; the hole travels with the video on the same time and ease, from the whole frame to the card: it is the part of the video that ends in the card, carried by the video's own scale and shift, so the video is never seen through the panel. Its corners are polynomials in one CSS variable, `--p`, which GSAP tweens: seek-safe, no callbacks. The material rises in once the hole has left its field and sinks out before it grows back. A sub-composition's timeline cannot reach the host's elements, so the host moves the person: its video clips sit in one untimed `<div id="broll-person">`, and `build` prints a `<script id="broll-person-motion">` for after the host's timeline script, which adds GSAP transforms of that wrapper (scale and shift from the top left), and of the captions' mount `#captions` (a shift onto the band), to the host's timeline. Beats that touch keep everything in place; next to a beat over the whole frame the person is set in place unseen. `project` and best-takes both do this.
- **Captions**: with `--captions-area <captions folder>` (`project` and best-takes pass it; agentitos' captions writes `area.json` beside its `index.html`) the layout keeps their band and the host's captions move onto it while a beat is beside the person. Without it they stay where they are, which beside the person is over the face.
- **Motion**: the cut in and out of a beat over the whole frame is hard. Pictures that fill the frame or are shown whole move in by 1.5 % a second (6 % at most), by a GSAP `scale` tween the browser renders sub-pixel: no stutter, unlike ffmpeg's `zoompan`. A number pops in. Nothing else moves.

## In best-takes and clips

`takes.mjs broll <dir> <broll.json>` keeps the file in `cut.json` (`"broll"`); every build writes the cut's words (`broll.words.json`: the brief's word numbers, timed in the cut), runs `build` into the composition's `broll/` and mounts it under the captions. A new cut moves every beat with its word. `--off` takes it out.

## What it does not do (yet)

- **Footage from the web**: no YouTube or stock search; the person brings their footage, the tool takes pictures of pages and posts.
- **Posts of other networks**: only posts on X are taken as cards; for Instagram, TikTok or LinkedIn the person brings a screenshot.
- **Motion graphics for an idea** (a chart, a process): only the number card.
- **Its own sound**: the b-roll is always muted.
- **Finding the face itself**: the agent reads it off `face`'s grid.
