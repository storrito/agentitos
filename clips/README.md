# clips

One long video in, finished vertical shorts out, **in the video's own look**: the speaker's footage cut to the moment, framed 9:16 on whoever speaks, pauses and "äh"s cut, every clip at the same level, captions, and a hook card where the first line does not hook. The moments are the ones that **stand alone**: one idea, a cold open, a clean end, nothing that leans on the rest of the video, 20 to 59 seconds.

> Agents: start with [`SKILL.md`](SKILL.md). It is written for [rragent](https://github.com/storrito/rragent): the previews are a project of its `hyperframes` template, the shorts are published with agentitos' [publish-video](../publish-video/) through Storrito.

```bash
node tools/episode.mjs fetch https://www.youtube.com/watch?v=… work/episode   # every word, its time and speaker
node tools/episode.mjs moments work/episode                                   # what is inside, the moments, the ideas to record anew
node tools/clips.mjs prepare work/episode work/01 412-431 \
  --out artifacts/clips/composition/01-posting --platform reels,tiktok,shorts --hook "Daily posting *hurt* us"
node ../best-takes/tools/takes.mjs build work/01/takes                        # the preview
node ../best-takes/tools/takes.mjs captions work/01/takes --style hormozi
node ../best-takes/tools/takes.mjs check work/01/takes
node tools/clips.mjs render work/01 work/out/01.mp4                          # the video at −14 LUFS, and 01.srt
```

Requirements: Node 20+, ffmpeg, the HyperFrames CLI (for the render), OpenRouter (`OPENROUTER_API_KEY`, or on a Sprite the gateway's `openrouter` connection), and agentitos' [best-takes](../best-takes/), [captions](../captions/) and [platform-zones](../platform-zones/) beside this skill. yt-dlp from the PATH, else downloaded once into `~/.cache/agentitos/`. No npm dependencies.

## How it works

1. **`episode.mjs fetch`** reads a link's facts with yt-dlp, takes its sound and writes down every word with its time and speaker (Gemini 3.5 Transcribe through OpenRouter, in 5-minute pieces side by side: an hour in about a minute, a few cents); without OpenRouter it takes YouTube's own captions, without speakers. A file goes the same way, its sound written down as it is. `sentences.txt` numbers the sentences (they end at . ! ? and where the voice changes).
2. **`episode.mjs moments`** has Gemini 3.8 Flash read `sentences.txt` once (about ten cents an hour), so that the agent's chat does not carry the whole video through every later step. Its rubric is [Melvynx' `/clips`](https://github.com/Melvynx/video-agent-skills) (MIT):
   - what the video holds: claims, stories, numbers, mistakes, how-tos, answers. Under four in all it is too thin for clips;
   - each moment a range of whole sentences, at most 59 s (it fits every post type Storrito offers), scored 0–2 on five points: a **cold** open that works as a hook in its first three seconds, **one** idea, a clean **end** after the payoff, leaning on nothing outside it (**alone**), and its **length** (2 from 20 s, 1 from 15 s; the tool counts this one). Under 7 of 10 a moment is listed as `weak`;
   - a hook for the screen (6 words or fewer, never a label) where the opening is weak;
   - the ideas too spread out over the video to cut, worth recording anew.

   `moments.json`: `{ inventory, moments: [{ first, last, kind, title, why, score, points, weak, hook, crosstalk, start, end, seconds, opening, link }], ideas }`, best first.
3. **`episode.mjs cut`** downloads only the stretch (up to 4K: a 9:16 window of a wide shot is a third of its width) with a breath of air around it, or cuts it from the file.
4. **`frame.mjs`** cuts footage wider than the frame to it, on whoever speaks: Gemini 3.8 Flash watches the clip once (about a cent) and names the camera shots and, in each, every face with the voice it speaks with; the window sits on the face of the voice heard most, a turn under 1.5 s (a "ja", a laugh) moves nothing, a reaction shot shows who it shows, cuts snap to the footage's own (ffmpeg scene changes). What a window would cut apart is shown whole, above the captions over a blurred, darker copy of itself: B-roll (a photo, archive footage, a place, a document, a screen; Gemini names each shot's kind and the box that must stay visible) and a picture split into feeds side by side. Two who speak, too far apart for one window, go one above the other (two panels from the top, the captions on the lower one's chest): a split screen of two voices always, one shot of both while they talk back and forth (three turns or more of under five seconds). Without OpenRouter the footage stays centred. The windows are kept in `framed.json`, each shot's middle beside its frame in `framed.sheet.jpg`; `clips.mjs reframe <clip> --whole <s>` / `--follow <s>` (one window on who speaks, never two above each other) changes a shot's kind without asking the model again and keeps the edit.
5. **`clips.mjs prepare`** runs the three above for one moment and hands the framed clip to [best-takes](../best-takes/) (`takes.mjs new --aspect 9:16 --pauses tight`): ElevenLabs Scribe writes the clip's words again, word-exact, "äh"s included; every pause over 0.4 s goes whatever the picture shows; one keep of the whole moment goes into `takes/cut.json`, from the first word heard whole to the last (the cut's air may hold the tail of the sentence before). From there the edit is best-takes': `build` (with `--hook` for the card), `captions`, `check`.
6. **`clips.mjs render`** renders the built preview with HyperFrames (6 Mbit/s) and runs best-takes' `finish`: −14 LUFS, a true-peak limit, the subtitles as `.srt` beside the video.

`kinetic-lyrics` uses the same `episode.mjs` and `frame.mjs` (its `tools/` run them from here) and puts every word big on screen instead.

## Limits

- A clip is only as good as its moment: a video full of "as we saw", "this slide" gives few clips and more ideas to record anew.
- The framing follows faces and voices and shows B-roll, photos and split screens whole, smaller, above the captions; a picture in a picture is cut as one picture.
- Only material the person may use.
