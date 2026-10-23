# captions

Word-timed captions for videos: each word appears as it is said, in one of several **styles**, the key words in a colour of their own, placed clear of the buttons TikTok, Reels and Shorts lay over a vertical video, in a brand's colour and font when there is a brand kit. The captions are a [HyperFrames](https://hyperframes.heygen.com) sub-composition that any host composition mounts as one clip, so the person sees them in the player before anything is rendered; an `.srt` for the platforms' own captions comes beside the video.

It is an agent of its own (upload a video, get it back with captions, see [SKILL.md](SKILL.md)) and the captions step of the other agents of this collection: a skill with its own timed words (best-takes: the cut's words, timed in the cut) calls `build` and mounts the result.

```
node tools/captions.mjs styles
node tools/captions.mjs transcribe <video> <words.json>
node tools/captions.mjs mark <words.json> [--product "Storrito"]
node tools/captions.mjs build <words.json> <composition>/captions --style hormozi [--size 1080x1920] [--brand brand/DESIGN.md]
node tools/captions.mjs project <video> <words.json> <composition> --style karaoke
node tools/captions.mjs srt <words.json> <file.srt>
```

Needs Node 20+, ffmpeg (for `transcribe`, `project`) and OpenRouter (for `transcribe`, `mark`): `OPENROUTER_API_KEY`, or on a Sprite the gateway's `openrouter` connection (`tools/lib/openrouter.mjs` asks `http://sprite.internal/v1/gateway/list`); no npm packages. The models are OpenRouter's only.

## Words

`words.json` is `{"width": 1080, "height": 1920, "duration": 61.2, "words": [{"text": "Hello", "start": 0.12, "end": 0.48, "highlight": true}, …]}`, or the array of words alone; times in seconds, in the video the captions go on (after every cut: a skill that cuts maps its words onto the cut first).

- **`transcribe`** takes the words from **ElevenLabs Scribe v2** through OpenRouter (`tools/lib/asr.mjs`, the same as best-takes': 10-minute pieces with an overlap, 20 ms timings, about half a cent a minute). Fillers ("äh", "um") and noises stay out of the captions. Three or more words in a row squeezed into under 60 ms each are left out too: Scribe now and then writes a sentence twice and the copy lands in such a run, which would show the sentence twice.
- **`mark`** sends the numbered words to **Claude Haiku 5.5** through OpenRouter (`--model` for another) and sets `"highlight": true` on the few that should stand out: numbers with their units, product and brand names (`--product` names the one that matters), the key word of a claim or a punchline, a call to action; about one word in eight, never two neighbours. This is what Storrito's [content workflow](https://github.com/storrito/tool-content-workflow) does with its transcript (`:highlight? true`), here with an OpenRouter model.

## Styles

Styles are data (`tools/lib/styles.mjs`): how words group, how they look, how they move. A new look is a new entry.

| style | look | group | motion |
| --- | --- | --- | --- |
| `hormozi` | Montserrat 900, capitals, white with a black stroke; the word being said yellow and a little bigger, key words green | 1–3 words | the group pops in, the active word lights up, the group cuts out |
| `karaoke` | Poppins 800, sentence case; the word being said on a violet pill, key words yellow | 3–4 words | the group rises in, the pill moves from word to word, the group fades |
| `wipe` | Poppins 800, capitals; each word wiped in as it is said, said words dim, key words gold | up to 4 words | after Storrito's `caption-clip-wipe` ([tool-shortform-subtitles](https://github.com/storrito/tool-shortform-subtitles)) |
| `clean` | Inter 600, sentence case, on a soft dark box | whole phrases, up to 2 lines | fade in and out |

The fonts are among those HyperFrames embeds by itself when it renders (Montserrat, Poppins, Inter, Oswald, League Gothic, Archivo Black, Outfit, …): no font files to ship, and the render on a clean machine looks like the preview. With `--brand brand/DESIGN.md` (from brand-kit) the brand's `primary` colour becomes the accent, and its display font (`typography.headline-display.fontFamily`) the captions' font: one served by Google is linked, one given as files is copied beside the captions and declared with `@font-face`.

### Groups and timing (`tools/lib/group.mjs`)

- First the phrases: a group never runs over the end of a sentence, a pause (0.25–0.45 s by style) or a comma once it is half full.
- A phrase too long for one group is split into groups of about equal size: "Let me show | how it works.", not "Let me show how | it works."; never past the style's words or characters.
- A group appears when its first word is said and stays 0.35 s after its last, at least the style's minimum (0.5–1 s) when there is room, never into the next group (20 ms apart). Only one group is ever on screen.
- The word being said is active from its start to the next word's start, so a short pause inside a group leaves no gap.

### Placement (`tools/lib/styles.mjs`, `placement`)

- 9:16: the group's lower edge at 30 % of the height from the bottom, at most 78 % of the width wide: above the platforms' caption and buttons, clear of the buttons on the right. About the 650 px of the content workflow at 1920 high.
- 4:5 and 1:1: 14 % from the bottom, 84 % wide. 16:9: 9 % from the bottom, 80 % wide.
- The styles' sizes are for a frame whose short side is 1080 px and scale with the short side, so a 1920×1080 frame gets the same type as a 1080×1920 one, a 3840×2160 frame twice as big.
- `project --size 1080x1920` puts a wide video into a vertical frame (and the other way round): `--fit cover` (the default) fills the frame and cuts the video at its edges, `--fit contain` fits it in with bars; the captions are placed for the frame, not for the video.
- Each group is set at the style's size and shrinks (to 55 % at most) until it fits its lines and no word is wider than its room. The words are inline blocks between spaces with `text-wrap: balance`, so the lines balance and no word is left alone on the second.

### The sub-composition (`tools/lib/render.mjs`)

- `build` writes `<folder>/index.html` and prints the clip to put into the host composition: `<div id="captions" data-composition-id="captions" data-composition-src="captions/index.html" data-start="0" data-duration="…" data-track-index="9" data-track-kind="captions" data-width="…" data-height="…">`.
- The file follows the sub-composition rules of the HyperFrames core skill: everything the runtime needs (style, root, script) inside the `<template>`, the root styled by `#root`, the host slot, the root and the timeline all with the id `captions`.
- The groups, words and times are written into the file. The script builds the words, waits for the fonts (`document.fonts.ready`), fits each group, then registers one paused GSAP timeline. Deterministic: no random, no clock.
- Every group is set hidden at its end (`tl.set`), whatever its exit; an exit never starts before the last word is fully in and said.
- `project` writes a whole host composition, the video as one clip with its sound and the captions mounted: what the captions agent shows and renders.

## Subtitle files (`tools/lib/srt.mjs`)

`srt` writes cues to the usual rules of readable subtitles: at most two lines of 42 characters broken near the middle, a new cue at the end of a sentence or a pause of 0.6 s, at least 0.8 s and at most 6 s on screen, long enough to read at 17 characters a second where the next cue leaves room.

## What it does not do (yet)

- Emoji above key words (the content workflow's `caption-emoji-pop`): the render machine has no colour-emoji font, so they would come out as boxes; it needs an emoji font shipped with the captions.
- A still of each style for the chat: the style buttons describe them in words.
