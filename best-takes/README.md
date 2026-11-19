# best-takes

Cuts one or more raw recordings of someone talking to camera down to **the best take of every part**: false starts, sentences said twice, "äh"s and talk about the recording ("let the AI cut this") come out, long pauses get shorter, and every take and every video plays **at the same loudness**. The cut is a [HyperFrames](https://hyperframes.heygen.com) project, so the person sees it as a preview before anything is rendered; the render is that same project.

> Agents: start with [`SKILL.md`](SKILL.md). It is written for [rragent](https://github.com/storrito/rragent): the preview is a project of its `hyperframes` template, the video comes from its `render` tool.

```bash
node tools/takes.mjs new takes/kameras uploads/take-1.mp4 uploads/take-2.mov   # words, "äh"s, levels → source/brief.md
node tools/takes.mjs propose takes/kameras                                     # a model watches and proposes → proposal.json
# write takes/kameras/cut.json (see below); the project tool: create kameras, kind hyperframes
node tools/takes.mjs build takes/kameras --out artifacts/kameras/composition   # the preview beside the chat
node tools/takes.mjs faces takes/kameras                                       # every face over time (clips' framing; --grid / --eye: your own boxes)
node tools/takes.mjs place takes/kameras                                       # the picture and the text against the faces (layout) → place.json, placed.sheet.jpg
node tools/takes.mjs check takes/kameras                                       # the cut as text, what is left out, levels, problems
# the render tool: kameras → artifacts/kameras.mp4
node tools/takes.mjs finish takes/kameras artifacts/kameras.mp4                # at −14 LUFS, and kameras.srt
node --test tools/test.mjs                                                     # the cut's voice, the pauses; no request
```

Outside rragent the same works with any HyperFrames project folder: `--out <project>/composition`, then `hyperframes render` in that folder.

Requirements: Node 20+, ffmpeg, the HyperFrames CLI (`hyperframes` on the PATH, else `npx hyperframes@0.8.221`), agentitos' [transcribe](../transcribe/) beside it (or `TRANSCRIBE` naming its `tools/transcribe.mjs`) for the transcription by ElevenLabs Scribe, for b-roll agentitos' [b-roll](../b-roll/) (or `BROLL_TOOL`), OpenRouter for it and for `propose`: `OPENROUTER_API_KEY`, or on a Sprite the gateway's `openrouter` connection (`openrouter.mjs` asks `http://sprite.internal/v1/gateway/list`; through it transcribe sends the sound in 5-minute pieces of MP3, which the gateway takes, instead of 10-minute FLAC). No npm dependencies.

## How it works

1. **`new`** makes each video playable in the browser and by the renderer (H.264 + AAC in MP4: a hard link when it is one, else remuxed or transcoded, e.g. an iPhone's HEVC), orders the videos by their recording time, and transcribes them with **ElevenLabs Scribe v2** through OpenRouter: word for word as spoken, fillers ("äh", "ähm", "mm") as words of their own, noises as events ("[Kamera klackert]"), word times to 20 ms with the real pauses between the words. About 0.4 ¢ a minute.

   Scribe sometimes squeezes words that follow a long noise into 40 ms, or stretches a word over a pause; `retime` (in `tools/lib/voice.mjs`) puts such words back where the voice is, from a 10 ms energy envelope. Each video's momentary loudness (EBU R128, ffmpeg's `ebur128`) is kept for the build. The result is `source/words.json` and `source/brief.md`: the rules of a good cut and every word, numbered.
2. **`propose`** sends the videos (360p, 4 fps, small) and the numbered words to **Gemini 4 Argon** through OpenRouter and asks for the keeps, the retries it left out and why, and where something is shown in silence. The words alone cannot say which of two attempts is *said* better, or that a silence is someone holding a camera into the picture; a model that watches can. About 1.8 ¢ a minute. The agent checks the proposal against the brief and writes `cut.json`.
3. **`build`** turns the word ranges into pieces of the source videos:
   - a cut goes into the quiet between two words: just before the voice sets in, never more than half the pause back; between words that touch, at the quietest 10 ms;
   - fillers inside a kept range are cut out; a pause over `--pause` (1 s) follows the picture (`tools/lib/motion.mjs`: the share of pixels that change, four times a second) against how much the same video moves while the person speaks (the median over the keeps' words): where it moves no more than 4 times that, it is shortened to about 0.3 s, a jump cut; where it moves more (and over 0.2 % of the pixels, runs under 2 s apart joined) that part stays, muted, up to 2.5 s as it is, longer ones in a third of their time (2–6 s, at most ×10, `data-playback-rate`), a timelapse. A phone in the hand moves 7–9 % all the time, so its pauses go; a screen about 0.03 %, so there any movement counts, as before; a keep with `"pauses": "keep"` plays its pauses as they are; a wait listed in `"waits"` is never cut away (see cut.json);
   - pieces that follow each other in their video play as one; all lengths are whole frames;
   - **the loudness**: the pieces of one take (same video, forward, of one keep or under 5 s apart) are measured together (gated like EBU R128 integrated loudness) and get one gain to −16 LUFS, so the level evens out between takes and videos without jumping inside a take.

   The project has one `<video>` clip per piece, edge to edge on one track (`data-start`, `data-duration`, `data-media-start`), its gain as a `gain` stage of `data-fx-chain` (two stages above +12 dB), 10 ms fades as a volume lane against clicks, and all of them in an `<hf-audio-group>` bus with a high-pass at 75 Hz, a gentle compressor and a true-peak ceiling. Nothing is rendered for the preview: the player plays the pieces straight from the videos, and rragent's pane shows the project and loads it again after every build.
   `build` also writes the cut's voice as one file, `takes/<name>/voice.cut.m4a` (each take at its level, silence where a piece only shows something; `tools/lib/tracks.mjs`), named as `"voice"` in `edit.json`, whose `"words"` are timed in the cut: together they are what another skill needs to set its own pictures to this voice. It is as long as the cut and made again only when the cut changed.
4. **`check`** lists the cut as it plays, what it leaves out, the levels, and what to look at: pieces under 0.6 s left over by a cut, takes raised by more than 15 dB (their room noise rises too), a cut longer than `--target`, and HyperFrames' own lint. A cut over its target is a trim while reaching the target leaves out at most half of it (`TRIM_AT_MOST` in `tools/brief.mjs`): drop what repeats, then the weakest parts. Beyond that `check` says it is no matter of cutting and names the words a script of the target would have (2.4 a second, as narrated-short counts): the agent asks whether to write that script from what was said, to record again, or to cut to the strongest parts anyway.
5. **The render** is rragent's `render` tool, `hyperframes render` of the project (about 1.5× the cut's length on 8 cores). **`finish`** then brings the whole to `--loudness` (−14 LUFS) with a gain and a limiter 2 dB under full scale, measured and corrected once, the picture copied; a video at the level already stays as it is. It refuses a video whose length is not the cut's (rendered before the last build), and writes subtitles of the cut's words (`.srt`, with the spelling of `fixes`).

## cut.json

```json
{
  "keep": [
    {"words": "15-106", "why": "intro and the first camera"},
    {"words": "110-130", "pauses": "keep", "why": "turns the camera slowly to show the battery compartment"},
    {"words": "134-159", "why": "the second attempt at 'die Belichtung einstellen'"},
    {"words": "201", "gain": -2, "why": "goodbye"}
  ],
  "fixes": {"59": "M42", "60": ""}
}
```

| key | what |
| --- | --- |
| `keep[].words` | a range of word numbers from the brief, both ends included, or one number; never across two videos |
| `keep[].pauses` | `"keep"`: its pauses play as they are, no jump cut, no timelapse |
| `keep[].sounds` | `"keep"`: fillers in it stay (a "hm" that is an answer) |
| `keep[].gain` | dB on top of the evened-out level |
| `keep[].again` | `true`: it plays words another keep plays too (a line said later that opens the video as its hook, heard again where it was said); without it a word in two keeps is an error. A word number then stands for two places: the captions mark both, b-roll's beats (`takes.mjs broll`) sit on the later one |
| `keep[].why` | for the agent and the person |
| `fixes` | the subtitles' spelling by word number; `""` drops a word from the text, not from the cut |
| `waits` | word numbers that end a sentence announcing a wait ("let's wait until then"): the pause after it, inside a keep or up to the next keep, plays as a wait (a timelapse of 3–5 s when the picture moves, else 3 s held before the cut) instead of being cut away |

The keeps play in their order.

## Captions in the picture

`takes.mjs captions <dir> --style <a style of captions: hormozi, bold, karaoke, wipe, label, editorial, clean, …> [--product …] [--brand brand/DESIGN.md] [--platform reels,tiktok]` (the platforms the video goes to: the captions keep clear of what they lay over it; kept in settings.json for every build, `build --platform` too) hands the cut's own words (timed in the cut, `fixes` applied) to agentitos' [captions](../captions/) skill: its `mark` lets a model pick the key words, which `cut.json` keeps as `"captions": {"style": "hormozi", "highlight": [word numbers]}`; from then on every `build` writes `captions.json` beside `cut.json`, runs the captions skill's `build` into `<out>/captions/` and mounts the sub-composition on top of the cut. `--off` takes them out. The tool looks for the captions skill at `CAPTIONS_TOOL`, beside this skill (`../captions`, a checkout of the collection), and in the machine's clone of the skills (`/home/sprite/skills/captions`).


## B-roll

`takes.mjs broll <dir> <broll.json>` (`--off` takes it out) keeps the file in `cut.json` (`"broll"`); from then on every `build` writes the cut's words to `broll.words.json` beside `cut.json` (the word numbers of the brief, timed in the cut), runs agentitos' [b-roll](../b-roll/) skill's `build` into `<out>/broll/` with the frame, `--platform` and the brand, and mounts its sub-composition over the pieces, under the captions. When a beat shows beside the person, the pieces sit in one `<div id="broll-person">` and b-roll's script (`<script id="broll-person-motion">`, after the main timeline's) moves that wrapper into the person's field; with captions, b-roll gets `--captions-area <out>/captions/area.json` and the same script moves the captions onto the band between the material and the person. A beat whose word the cut left out is dropped, and the build says so. The tool looks for the b-roll skill at `BROLL_TOOL`, beside this skill (`../b-roll`) and in the machine's clone (`/home/sprite/skills/b-roll`). The agent writes `broll.json` from the b-roll skill's brief on `edit.json`.
## The faces, the picture and the text, on its own

Where no other skill framed the videos (clips does, and hands over `place.json` and `source/faces.json`), best-takes knew no face: the captions stood on the safe box's bottom and the hook at the top, whatever lay there. Two steps give it the same care, with clips' and layout's tools run as programs:

- **`takes.mjs faces <dir>`** runs agentitos' [clips](../clips/) `tools/frame.mjs <video> <words> --faces <dir>/source/NN.faces.json` on each video (`FRAME_TOOL` names it, else beside this skill, else the machine's clone): the video's shots, a model's stills with every face, its eyes, nose and mouth (Gemini 3.8 Flash, the same request clips frames with, the video small and without its tags), checked, and clips' tracker between the stills, ten times a second; every face in the video's own pixels and seconds. Measured on four 50 s takes (2026-11-19): 2.1 to 3.0 cents and 40 to 100 s each (on a laptop under load, at the lowest priority). Kept: `faces` again only with `--again`, which also drops the model's answer of before (`source/NN.people.json`) and asks afresh; a run that reads an answer again says that nothing was spent. A video in which a face shows less than half the time is said with a `✗` (the model missed the person, or there is none: the boxes by eye then), and `place` and `check` say so where the faces known cover less than half of the cut. Boxes the model gives that end before they start, or lie mostly outside the picture, are left out; `--eye` refuses a box that is no face's (a speck, outside the picture, far wider than tall). Where no model may see a video: `--grid` writes five grid pictures over what the cut keeps (layout's `grid`), the agent reads the face's box off each, `--eye [<video>@]<second>:x,y,w,h` hands them in: no request, the same tracker between them (16 s for 30 s of video), the eyes, nose and mouth from the head's proportions.
- **`takes.mjs place <dir>`** (free, a few seconds) places each video in the frame and the text over the whole cut by agentitos' [layout](../layout/) (`LAYOUT_TOOL`, beside, the clone):
  - the picture: a video of the frame's shape (within 15 %, as clips frames only wider footage) covers it as it is; a wider one is placed by layout's `place` from its face over the seconds the cut keeps (`--face-track`, a moment every half second): of its candidates that pass (✓ or !: no hard problem, so enlarged 2× at most) the one whose face comes nearest the usual size of a person's take, as large as it gets up to 34 % of the frame's height (the upper end of the middle half in published Shorts; the box as found), layout's order among equals: on the review's 720p interview the 4:5 crop at 1.875× (the face 30 %) before the square band at 1.5× (24 %; 14 % by a box read from the hairline); `--picture [<video>:]<N>|cover` takes another (each candidate is printed with its mark, the enlargement, the face's size and the reason for its mark, the first three are on the sheet, layout's whole answer is in `placement/NN/placement.json`);
  - the text: every video the cut shows is one shot of layout's `text`, on one clock (each video after the one before), its faces drawn through its picture, only at the seconds the cut keeps of it; `room` is how much of the picture lies below the frame (raised that far it needs no ground). layout answers one place for the captions (the built style's ink as the area, as clips takes it), how far each video's picture goes up (`--raise head|mouth|full`), the hook's place over its seconds; `--caption-y`, `--font-size`, `--lines`, `--lift [<video>:]<px>`, `--hook-kind text|card` fix one choice each, kept in `place.json`'s `fixed`;
  - where a picture leaves part of the frame bare (a band, an inset, raised), one still of the video, blurred and darker, is its ground (`source/NN.ground.jpg`, an `<img>` in the composition while that video's pieces play: a second video element for every piece would pass the 75 a page plays);
  - it writes `place.json` (`"by": "takes place"`, `caption`, `hook`, `raise`, `picture` per video: `scale`, `left`, `top` in px of the frame, `lift`, `fit`, `ground`; `fixed`; `for`, what the cut, the caption style, the hook and the frame were) and `source/faces.json` (the faces in the frame as placed, as clips writes it), then `placed.sheet.jpg` (a row per video: the frame as placed at the first and last second the cut keeps and where its face is lowest and highest; the captions yellow, the hook cyan, the faces red), and builds again. A build after a change of the cut, the caption style, the hook or the frame says that `place` is due again.

The build draws each piece where its picture stands (`left`, `top`, `width`, `height`, raised by `lift`) and grows a punch-in about the same point of the frame as before; a picture that leaves the frame bare goes closer inside its own edges (a `clip-path` of the part of the frame it filled). Without `picture` (clips' `place.json`, or none) every piece covers the frame, centred, as before: one path for both.

[`references/place.md`](references/place.md) says what the agent changes when.

## Settings

Given to `new` or `build`, kept in `source/settings.json`: `--out`, `--title`, `--lang`, `--aspect source|9:16|16:9|1:1|4:5`, `--fit cover|contain`, `--target <s>`, `--pause <s>`, `--pauses picture|tight`, `--hook "…"`, `--brand <DESIGN.md>`, `--loudness <LUFS>`, `--fps`, `--order recorded|given`, `--model <OpenRouter id>`.

- **`--target <s>`**: the longest the cut should be. The brief's rule 8 has the first cut keep to the other rules alone (only slips, repeats, fillers and talk about the recording out); `check` then compares that cut with the target (see `check` above).
- **`--pauses tight`**: every pause over 0.4 s (or `--pause`) inside a keep goes, whatever the picture shows, down to the breath the cut points leave (about a quarter of a second): the pace of a reel, for a talking head or a moment cut from a long talk (agentitos' [clips](../clips/) sets it). The default, `picture`, keeps a pause over `--pause` where its picture moves clearly more than while speaking (a screencast's click, a thing held into a camera) and cuts the rest.
- **`--punch on`**: at a jump cut inside a take (the same video, a stretch left out) the picture goes 12 % closer, or back out, closer when the piece holds a key word of the captions: the cut looks meant and the key word lands closer. A piece that follows on without a cut keeps its size. `source/still.json` (`{"01.mp4": [[from, to], …]}`, seconds of that video) names pictures never to go closer on (clips writes it for B-roll shown whole). Default off.
- **`--hook "…"`**: a hook over the start that says what the viewer gets, for a video whose first line does not (6 words or fewer, one `*word*` in the brand's colour), in the brand's display font (`--brand`, else the captions' brand, else Inter), on the first frame already; it stays until the cut's first sentence ends (2–5 s) and fades out. Where `place.json` puts it: a short text in big white type with a dark edge, or a white card with dark type, in its box; without one a card centred at the top of platform-zones' centred box for `--platform`. `--hook ""` takes it out.
- **`place.json`** beside `cut.json`, written by a skill that laid the frame out against the faces (clips' `place`, by agentitos' layout), or by this skill's own `place` (with `picture`): `{"caption": {"y": 1440, "max-width": 696, "font-size": 77, "lines": 1}, "hook": {"kind": "text", "box": [x, y, w, h], "font": 96, "until": 2.4}}`. `build` hands `caption` to the captions skill as its placement options (`--y`, `--max-width`, `--font-size`, `--lines`, `--x`, `--align`) and puts the hook into `hook`'s box (`until`: earlier than the first sentence's end, where a cut leaves it no place). Without it, everything stands where it stood before.
- **`source/faces.json`**, written by the skill that framed the videos (clips' `place`): `{"01.mp4": {"size": [1080, 1920], "faces": [{"t": 0.1, "boxes": [{"who": "guest", "box": [x, y, w, h], "feat": [x, y, w, h]}]}, …]}}` (`feat`: the eyes, nose and mouth, where known), every face in px of that video's frame, about ten times a second. With it a punch-in (`--punch on`) never undoes where the text was placed: every face over the captions keeps its nose line (70 % down `feat`, the eyes, nose and mouth), its lip line (88 % down: the middle of the mouth) and its mouth line (`feat`'s bottom and 15 % of its height more, for an open mouth's lower lip and a head that tips between two stills; without `feat` the head's proportions, 38–86 % of the box) above the captions' top where they were above it, and no lower where they were below it; it grows from below a third from the top where a chin would otherwise be pushed into the captions (never so that the eyes go under the apps' top bar; with `place.json`'s `"raise"` `head` or `mouth` never so that a head inside the frame goes over its top, and not lower for a chin where the frame cuts the head already; with `head` not even for the lines: the piece then goes less close or stays). A face whose box is 45 % of the frame's height or more over the piece gets no punch-in at all (published Shorts: hairline to chin 26 %, the middle half 23–34 %; a talk show's tight close-up is 48–57 %, and closer pushes every line of it towards the captions and the edges). Where the lines and the eyes leave no such origin, the piece goes 6 % closer instead, or stays as it is, and `build` says which (`Punch: piece N at … stays as it is`); `edit.json` keeps each piece's `scale` and `origin`. `check` names text that lies on a face with the part and its seconds: on the nose or eyes, on the mouth (both lips: a ✗ for captions), on the lower lip, on the chin, on the hair above a head (said in one line); a hook anywhere on a face is a ⚠. The captions' area is the built style's line with the ink of its outline and shadow below it. `edit.json`'s `text` holds the captions' area, its groups' times and the hook's box.

## Why these models

Tested in October 2026 on a German 1:46 recording with three retries, fillers and meta talk:

| | fillers | names | timing | cost |
| --- | --- | --- | --- | --- |
| ElevenLabs Scribe v2 | all (äh, ähm, mm) and noises | Pentax Spotmatic, Voigtländer | 20 ms, real pauses; now and then squeezed next to a noise (repaired) | 0.6 ¢ |
| Gemini 3.5 Transcribe | some | right | tenths of a second | 0.9 ¢ |
| AssemblyAI Universal 3.6 Pro | none, even with `disfluencies` | right | ms | 0.9 ¢ |
| Parakeet (local, HyperFrames) | none | "Pentag Spot Matic" | words touch each other | free |

For the proposal, Gemini 4 Argon found all three retries and both pieces of meta talk, kept the goodbye and marked the silence where a viewfinder is shown (11 s, 3 ¢); Gemini 3.8 Flash missed a retry in one of two runs and split ranges around fillers.
