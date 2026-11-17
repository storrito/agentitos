# captions

Word-timed captions for videos: each word appears as it is said, in one of several **styles**, the key words in a colour of their own, placed clear of what TikTok, Reels, Shorts and the other apps lay over the video (agentitos' platform-zones), in a brand's colour and font when there is a brand kit. The captions are a [HyperFrames](https://hyperframes.heygen.com) sub-composition that any host composition mounts as one clip, so the person sees them in the player before anything is rendered; an `.srt` for the platforms' own captions comes beside the video.

It is an agent of its own (upload a video, get it back with captions, see [SKILL.md](SKILL.md)) and the captions step of the other agents of this collection: a skill with its own timed words (best-takes: the cut's words, timed in the cut) calls `build` and mounts the result.

```
node tools/captions.mjs styles
node tools/captions.mjs transcribe <video> <words.json>
node tools/captions.mjs mark <words.json> [--product "Storrito"]
node tools/captions.mjs box <words.json> "📏 32 centimetres wide"     # only when cards are asked for: a phrase as a box of its own
node tools/captions.mjs build <words.json> <composition>/captions --style hormozi [--size 1080x1920] [--platform reels,tiktok] [--brand brand/DESIGN.md]
node tools/captions.mjs build <words.json> <composition>/captions --style clean --size 1920x1080 --x 704 --y 930 --max-width 1120 --align left   # another place than the safe box's bottom
node tools/captions.mjs project <video> <words.json> <composition> --style karaoke
node tools/captions.mjs srt <words.json> <file.srt>
node --test tools/test.mjs                                           # where the captions go, and that nothing changed for captions nobody placed; no request
```

Needs Node 20+, agentitos' [platform-zones](../platform-zones/) beside it (where the captions go) and, for `transcribe`, agentitos' [transcribe](../transcribe/) (or `TRANSCRIBE` naming its `tools/transcribe.mjs`), ffmpeg (for `transcribe`, `project`) and OpenRouter (for `transcribe`, `mark`): `OPENROUTER_API_KEY`, or on a Sprite the gateway's `openrouter` connection (`tools/lib/openrouter.mjs` asks `http://sprite.internal/v1/gateway/list`); no npm packages. The models are OpenRouter's only.

## Words

`words.json` is `{"width": 1080, "height": 1920, "duration": 61.2, "words": [{"text": "Hello", "start": 0.12, "end": 0.48, "highlight": true}, …]}`, or the array of words alone; times in seconds, in the video the captions go on (after every cut: a skill that cuts maps its words onto the cut first).

- **`transcribe`** takes the words from **ElevenLabs Scribe v2** through OpenRouter, run by agentitos' [transcribe](../transcribe/) skill (`tools/lib/transcribe.mjs` finds it; the same words as best-takes': 10-minute pieces with an overlap, 20 ms timings, about half a cent a minute). Fillers ("äh", "um") and noises stay out of the captions. Three or more words in a row squeezed into under 60 ms each are left out too: Scribe now and then writes a sentence twice and the copy lands in such a run, which would show the sentence twice.
- **`mark`** sends the numbered words to **Claude Haiku 5.5** through OpenRouter (`--model` for another) and sets `"highlight": true` on the few that should stand out: numbers with their units, product and brand names (`--product` names the one that matters), the key word of a claim or a punchline, a call to action; about one word in eight, never two neighbours. This is what Storrito's [content workflow](https://github.com/storrito/tool-content-workflow) does with its transcript (`:highlight? true`), here with an OpenRouter model.
- **`box`** makes spoken phrases cards of their own, for whoever asks for them: `box <words.json> "📏 32 centimetres wide" "🛰️ Space Station"`. A phrase is words as they are said (the first place it is said and is not yet in a box); a first token without a letter or a digit is its emoji. The words get the same `"box"`, the first the `"icon"`. In the captions such a run is one group whatever the style's size, on a dark card with a border in the style's key colour, the emoji in front, its numbers in the key colour, the word being said marked as the style does it. A phrase is one card: said again with `box`, its card stays and only its emoji changes. `--drop "<phrase>"` takes one card away, `--clear` all; without phrases the boxes there are listed; a phrase that could not be boxed is named and the tool ends with 1. **Nothing is boxed unless it is asked for:** words without `box` are grouped exactly as before (checked against the grouping of the version before, 1,600 random word lists over the four styles), so captions built by other skills do not change. The emoji needs a colour-emoji font on the machine that renders (the Sprites have Noto Color Emoji, seen in a preview on 2026-11-12); a card without an emoji needs none.

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

### Placement (agentitos' [platform-zones](../platform-zones/))

- The captions keep clear of what the apps lay over the video: `build` and `project` ask platform-zones for the frame (`tools/lib/zones.mjs`: `PLATFORM_ZONES`, else `../platform-zones` beside this skill, else `/home/sprite/skills/platform-zones`) and set the captions in its centred box (the safe box even about the frame's middle): their lowest line at its bottom, centred on the frame, never wider, unless the caller names another place (below). This skill keeps no numbers of its own.
- `--platform reels,tiktok` names where the video goes (`node ../platform-zones/tools/zones.mjs list` names them all). Without it, the usual platforms of the frame together: in 9:16 Reels, Stories, TikTok, Shorts and Facebook Reels, the lowest line at 1440 px of 1920, centred, at most 696 px wide (840 for Reels alone), clear of the buttons' column on the right; in 4:5 and 1:1 the feeds; in 16:9 YouTube and the feeds.
- Each build says for which platforms it placed them.
- The styles' sizes are for a frame whose short side is 1080 px and scale with the short side, so a 1920×1080 frame gets the same type as a 1080×1920 one, a 3840×2160 frame twice as big.
- `project --size 1080x1920` puts a wide video into a vertical frame (and the other way round): `--fit cover` (the default) fills the frame and cuts the video at its edges, `--fit contain` fits it in with bars; the captions are placed for the frame, not for the video.
- Each group is set at the style's size and shrinks (to 55 % at most) until it fits its lines and no word is wider than its room. The words are inline blocks between spaces with `text-wrap: balance`, so the lines balance and no word is left alone on the second.

### Another place, named by the caller

The bottom of the safe box is wrong for some pictures: in a close selfie it is the speaker's chin and the free picture is the wall above the head; in a 16:9 frame with the speaker as a tall panel on the left the captions belong in the free area on the right, left-aligned, sometimes much larger. The tool cannot see that and does not try: it places the captions, whoever looked at the frames (an agent, a layout tool) decides where. `build` and `project` take the place in px of the frame, each option on its own; what is not given stays as above, and without any of them the built file is byte for byte what it was before there were options (`tools/test.mjs` builds both and compares).

| option | what it sets | when a caller needs it |
| --- | --- | --- |
| `--y <px>` | the y, from the frame's top, at which the lowest line ends (a style's box ends there, its padding included) | the safe box's bottom lies on what must be seen: a chin, a product, a screen's lower edge |
| `--x <px>` | where the captions' area starts from the left; without it the area is centred on the frame | the free area lies at one side |
| `--max-width <px>` | how wide the area is; without it the centred box's width, or with `--x` up to the centred box's right edge | the free area is narrower or wider than the centred box |
| `--align left\|centre\|right` | the lines in the area (default centre); left or right, a style's box and a card stand at that edge and end where their longest line ends, and a group pops in from that edge | the area begins beside something (a panel, a list): every group starts at the same edge |
| `--font-size <px>` | the type's size in px of the frame instead of the style's (not `--size`, the frame's); the stroke and a card's border grow with it | the area is much larger or smaller than the strip the styles are made for |
| `--lines 1\|2` | how many lines a group may have (default 2) | the area is low: a strip of wall above a head, a bar under a screen |

- **The safe box is said, not enforced.** The tool answers where it put the captions (`Placed where asked: the lowest line ends at y 440, centred in x 192–888 (at most 696 px wide), one line of 60 px type.`) and asks platform-zones' own `check` about that area (as high as its lines at that size): inside the safe box, or the stretch above the buttons, of the platforms it names, or one line beginning with `!`: how far past which edge, and what the apps lay there. The file is built all the same; captions under an app's buttons are the commonest mistake, but the place is the caller's.
- **A size that is named is kept.** A style's groups are made for two lines of its size in the centred box and lean on the shrinking above; in one line, a narrow area or larger type they would shrink to the least and still break into another line. So where the caller placed the captions, a group holds no more characters than fit its lines: at the size given with `--font-size`, else at the least the style's size shrinks to. A character counts as the style's `advance` em (`tools/lib/styles.mjs`: measured in Chrome on German and English groups, nine in ten are narrower; 0.54 em for `clean`, 0.77 for `hormozi`), a style's box as 1 em of padding. Only where that is less than the style's own groups are they cut anew, and then by length, not by words (`tools/lib/group.mjs`): a phrase into the fewest groups that fit, about equally long ("wie ihr eure | Instagram-Storys | für die ganze | Woche vorplant." in a 696 px line of 60 px type; by words the same phrase fell into seven groups, three of a single short word). Captions that are only moved (`--y`, `--align`) keep the style's groups.
- Seen on stills of two real cases (2026-11-17): a close selfie in 9:16 with `--style clean --y 440 --max-width 696 --font-size 60 --lines 1` (one line on the wall above the head, every group at 60 px), and a 16:9 frame with the speaker as a panel on the left with `--style clean --x 704 --y 930 --max-width 1120 --align left`.

### The sub-composition (`tools/lib/render.mjs`)

- `build` writes `<folder>/index.html` and prints the clip to put into the host composition: `<div id="captions" data-composition-id="captions" data-composition-src="captions/index.html" data-start="0" data-duration="…" data-track-index="9" data-track-kind="captions" data-width="…" data-height="…">`.
- The file follows the sub-composition rules of the HyperFrames core skill: everything the runtime needs (style, root, script) inside the `<template>`, the root styled by `#root`, the host slot, the root and the timeline all with the id `captions`.
- The groups, words and times are written into the file. The script builds the words, waits for the fonts (`document.fonts.ready`), fits each group, then registers one paused GSAP timeline. Deterministic: no random, no clock.
- Every group is set hidden at its end (`tl.set`), whatever its exit; an exit never starts before the last word is fully in and said.
- `project` writes a whole host composition, the video as one clip with its sound and the captions mounted: what the captions agent shows and renders.

## Subtitle files (`tools/lib/srt.mjs`)

`srt` writes cues to the usual rules of readable subtitles: at most two lines of 42 characters broken near the middle, a new cue at the end of a sentence or a pause of 0.6 s, at least 0.8 s and at most 6 s on screen, long enough to read at 17 characters a second where the next cue leaves room.

## What it does not do (yet)

- Choose where the captions go: it knows what the apps cover, not what the picture shows.
- Captions that start at a top edge or stand in the middle of an area's height, and more than two lines: they always end on a y and grow upwards.
- Keep a word with a hyphen in one piece: one that is wider than its area ("Instagram-Storys" in very large type) breaks at the hyphen instead of shrinking.
- Pass the place on from the skills that call `build` for their own videos (best-takes, narrated-short, screencast-cut, launch-video): their captions end on the safe box's bottom.

- Emoji above key words (the content workflow's `caption-emoji-pop`): the render machine has no colour-emoji font, so they would come out as boxes; it needs an emoji font shipped with the captions.
- A still of each style for the chat: the style buttons describe them in words.
