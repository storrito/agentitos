# best-takes

Cuts one or more raw recordings of someone talking to camera down to **the best take of every part**: false starts, sentences said twice, "äh"s and talk about the recording ("let the AI cut this") come out, long pauses get shorter, and every take and every video plays **at the same loudness**. The cut is a [HyperFrames](https://hyperframes.heygen.com) project, so the person sees it as a preview before anything is rendered; the render is that same project.

> Agents: start with [`SKILL.md`](SKILL.md). It is written for [rragent](https://github.com/storrito/rragent): the preview is a project of its `hyperframes` template, the video comes from its `render` tool.

```bash
node tools/takes.mjs new takes/kameras uploads/take-1.mp4 uploads/take-2.mov   # words, "äh"s, levels → source/brief.md
node tools/takes.mjs propose takes/kameras                                     # a model watches and proposes → proposal.json
# write takes/kameras/cut.json (see below); the project tool: create kameras, kind hyperframes
node tools/takes.mjs build takes/kameras --out artifacts/kameras/composition   # the preview beside the chat
node tools/takes.mjs check takes/kameras                                       # the cut as text, what is left out, levels, problems
# the render tool: kameras → artifacts/kameras.mp4
node tools/takes.mjs finish takes/kameras artifacts/kameras.mp4                # at −14 LUFS, and kameras.srt
```

Outside rragent the same works with any HyperFrames project folder: `--out <project>/composition`, then `hyperframes render` in that folder.

Requirements: Node 20+, ffmpeg, the HyperFrames CLI (`hyperframes` on the PATH, else `npx hyperframes@0.8.146`), OpenRouter for the transcription by ElevenLabs Scribe and for `propose`: `OPENROUTER_API_KEY`, or on a Sprite the gateway's `openrouter` connection (`tools/lib/openrouter.mjs` asks `http://sprite.internal/v1/gateway/list`; through it the sound goes in 5-minute pieces of MP3, which the gateway takes, instead of 10-minute FLAC). No npm dependencies.

## How it works

1. **`new`** makes each video playable in the browser and by the renderer (H.264 + AAC in MP4: a hard link when it is one, else remuxed or transcoded, e.g. an iPhone's HEVC), orders the videos by their recording time, and transcribes them with **ElevenLabs Scribe v2** through OpenRouter: word for word as spoken, fillers ("äh", "ähm", "mm") as words of their own, noises as events ("[Kamera klackert]"), word times to 20 ms with the real pauses between the words. About 0.4 ¢ a minute.

   Scribe sometimes squeezes words that follow a long noise into 40 ms, or stretches a word over a pause; `retime` (in `tools/lib/voice.mjs`) puts such words back where the voice is, from a 10 ms energy envelope. Each video's momentary loudness (EBU R128, ffmpeg's `ebur128`) is kept for the build. The result is `source/words.json` and `source/brief.md`: the rules of a good cut and every word, numbered.
2. **`propose`** sends the videos (360p, 4 fps, small) and the numbered words to **Gemini 4 Argon** through OpenRouter and asks for the keeps, the retries it left out and why, and where something is shown in silence. The words alone cannot say which of two attempts is *said* better, or that a silence is someone holding a camera into the picture; a model that watches can. About 1.8 ¢ a minute. The agent checks the proposal against the brief and writes `cut.json`.
3. **`build`** turns the word ranges into pieces of the source videos:
   - a cut goes into the quiet between two words: just before the voice sets in, never more than half the pause back; between words that touch, at the quietest 10 ms;
   - fillers inside a kept range are cut out; a pause over `--pause` (1 s) follows the picture (`tools/lib/motion.mjs`: the share of pixels that change, four times a second): where it stands still it is shortened to about 0.3 s, a jump cut; where it moves (over 0.2 % of the pixels, runs under 2 s apart joined) that part stays, muted, up to 2.5 s as it is, longer ones in a third of their time (2–6 s, at most ×10, `data-playback-rate`), a timelapse; a keep with `"pauses": "keep"` plays its pauses as they are; a wait listed in `"waits"` is never cut away (see cut.json);
   - pieces that follow each other in their video play as one; all lengths are whole frames;
   - **the loudness**: the pieces of one take (same video, forward, of one keep or under 5 s apart) are measured together (gated like EBU R128 integrated loudness) and get one gain to −16 LUFS, so the level evens out between takes and videos without jumping inside a take.

   The project has one `<video>` clip per piece, edge to edge on one track (`data-start`, `data-duration`, `data-media-start`), its gain as a `gain` stage of `data-fx-chain` (two stages above +12 dB), 10 ms fades as a volume lane against clicks, and all of them in an `<hf-audio-group>` bus with a high-pass at 75 Hz, a gentle compressor and a true-peak ceiling. Nothing is rendered for the preview: the player plays the pieces straight from the videos, and rragent's pane shows the project and loads it again after every build.
4. **`check`** lists the cut as it plays, what it leaves out, the levels, and what to look at: pieces under 0.6 s left over by a cut, takes raised by more than 15 dB (their room noise rises too), a cut longer than `--target`, and HyperFrames' own lint.
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
| `keep[].why` | for the agent and the person |
| `fixes` | the subtitles' spelling by word number; `""` drops a word from the text, not from the cut |
| `waits` | word numbers that end a sentence announcing a wait ("let's wait until then"): the pause after it, inside a keep or up to the next keep, plays as a wait (a timelapse of 3–5 s when the picture moves, else 3 s held before the cut) instead of being cut away |

The keeps play in their order.

## Captions in the picture

`takes.mjs captions <dir> --style hormozi|karaoke|wipe|clean [--product …] [--brand brand/DESIGN.md] [--platform reels,tiktok]` (the platforms the video goes to: the captions keep clear of what they lay over it; kept in settings.json for every build, `build --platform` too) hands the cut's own words (timed in the cut, `fixes` applied) to agentitos' [captions](../captions/) skill: its `mark` lets a model pick the key words, which `cut.json` keeps as `"captions": {"style": "hormozi", "highlight": [word numbers]}`; from then on every `build` writes `captions.json` beside `cut.json`, runs the captions skill's `build` into `<out>/captions/` and mounts the sub-composition on top of the cut. `--off` takes them out. The tool looks for the captions skill at `CAPTIONS_TOOL`, beside this skill (`../captions`, a checkout of the collection), and in the machine's clone of the skills (`/home/sprite/skills/captions`).

## Settings

Given to `new` or `build`, kept in `source/settings.json`: `--out`, `--title`, `--lang`, `--aspect source|9:16|16:9|1:1|4:5`, `--fit cover|contain`, `--target <s>`, `--pause <s>`, `--loudness <LUFS>`, `--fps`, `--order recorded|given`, `--model <OpenRouter id>`.

## Why these models

Tested in October 2026 on a German 1:46 recording with three retries, fillers and meta talk:

| | fillers | names | timing | cost |
| --- | --- | --- | --- | --- |
| ElevenLabs Scribe v2 | all (äh, ähm, mm) and noises | Pentax Spotmatic, Voigtländer | 20 ms, real pauses; now and then squeezed next to a noise (repaired) | 0.6 ¢ |
| Gemini 3.5 Transcribe | some | right | tenths of a second | 0.9 ¢ |
| AssemblyAI Universal 3.6 Pro | none, even with `disfluencies` | right | ms | 0.9 ¢ |
| Parakeet (local, HyperFrames) | none | "Pentag Spot Matic" | words touch each other | free |

For the proposal, Gemini 4 Argon found all three retries and both pieces of meta talk, kept the goodbye and marked the silence where a viewfinder is shown (11 s, 3 ¢); Gemini 3.8 Flash missed a retry in one of two runs and split ranges around fillers.
