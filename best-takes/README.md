# best-takes

Cuts one or more raw recordings of someone talking to camera, or a voice recorded alone, down to **the best take of every part**: false starts, sentences said twice, "äh"s and talk about the recording ("let the AI cut this") come out, long pauses get shorter, and every take and every video plays **at the same loudness**. The cut of a video is a [HyperFrames](https://hyperframes.heygen.com) project, so the person sees it as a preview before anything is rendered; the render is that same project. The cut of a voice alone is the clean narration as one file with every word's time in it ([below](#a-voice-alone)).

> Agents: start with [`SKILL.md`](SKILL.md). It is written for [rragent](https://github.com/storrito/rragent): the preview is a project of its `hyperframes` template, the video comes from its `render` tool.

```bash
node tools/takes.mjs new takes/kameras uploads/take-1.mp4 uploads/take-2.mov   # words, "äh"s, levels → source/brief.md
node tools/takes.mjs propose takes/kameras                                     # a model watches and proposes → proposal.json
# write takes/kameras/cut.json (see below); the project tool: create kameras, kind hyperframes
node tools/takes.mjs build takes/kameras --out artifacts/kameras/composition   # the preview beside the chat
node tools/takes.mjs check takes/kameras                                       # the cut as text, what is left out, levels, problems
# the render tool: kameras → artifacts/kameras.mp4
node tools/takes.mjs finish takes/kameras artifacts/kameras.mp4                # at −14 LUFS, and kameras.srt
node --test tools/test.mjs                                                     # the cut's voice, the pauses, speech not written down, a voice alone; no request
```

A voice alone: `takes.mjs new takes/talk uploads/voice.mp3`, `propose`, `cut.json`, then `build takes/talk --out artifacts/talk.m4a` and `check`; nothing to render.

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
   - **the loudness**: the pieces of one take (same video, forward, of one keep or under 5 s apart) are measured together (gated like EBU R128 integrated loudness) and get one gain to −14 LUFS, so the level evens out between takes and videos without jumping inside a take.

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
| `keep[].why` | for the agent and the person |
| `fixes` | the subtitles' spelling by word number; `""` drops a word from the text, not from the cut |
| `waits` | word numbers that end a sentence announcing a wait ("let's wait until then"): the pause after it, inside a keep or up to the next keep, plays as a wait (a timelapse of 3–5 s when the picture moves, else 3 s held before the cut) instead of being cut away |
| `keep[].unwritten` | `"keep"`: the speech not written down inside it plays as recorded (it holds the start of the kept attempt, or a word the model left out); `"cut"`: it is cut out. Without either, a keep that holds one is an error of `build` |
| `keep[].breath` | a voice alone: seconds of the room's quiet before this keep (a new part: about 1) |

The keeps play in their order.

## Speech not written down

ElevenLabs Scribe now and then leaves out whole attempts of a sentence read with retries, and the first words of the attempt that stays: of seven transcriptions of a six-minute narration (2026-11-18) four were complete, three left out 18, 27 and 132 of its 641 words. Their time then lay between written words as if it were a pause: the brief showed one sentence with pauses of 1.3, 1.7 and 4.8 s between its words, which came from the first, second and fourth attempt; the proposal kept ranges across four such places, and `build` would have spliced the sentence out of three attempts and cut the spoken retries as pauses.

The transcribe skill now finds voice that no word covers, hears it again alone and writes its words in (137 of those 177 words came back, for 1.4 cents); what stays without words it lists as `"unwritten"`. `new` makes each such stretch an item of the words, kind `"unwritten"`, shown in the brief and to the proposal as `(speech not written down, 1.7 s)` where it lies, never as a pause. The brief's rule 2 says what it is and that a keep never runs across one, except where the words after it begin in the middle of a sentence: then it holds the start of the kept attempt ("Three of four" before "testers liked the new layout."), and the keep says `"unwritten": "keep"`, which plays it as recorded. `build` refuses a keep that holds one without `"unwritten"`, `check` names each one that plays (its words are in no subtitle) and each one cut. On the worst of the seven transcriptions, once filled in (4 stretches left), the proposal kept no range across one that was another attempt, and marked the two that held the start of the kept attempt; it lost one word (in a stretch it left out, before a sentence begun in its middle) and the words the transcript still lacked, which no stretch shows (a neighbour Scribe drew over them). A transcribe skill of before this, without `"unwritten"`, is said once by `new`.

## A voice alone

`new` takes an MP3, an M4A, a WAV, or a video file without a picture stream (`lib/media.mjs`' `probe` says `audio: true`), as it takes a video: the copy in `source/` is the file itself, `NN.<its extension>`. All recordings of one cut are videos, or all are sound alone. The brief says "Recording" and "sound alone", and the proposal listens to the sound (MP3 at 32 kbit/s, without the file's tags) instead of watching a video.

- **Pauses**: there is no picture to measure, so a pause over `--pause` (1 s) inside a keep is cut (`check` says "cut: sound alone, a breath of the room's quiet in its place"); `"pauses": "keep"` plays them as they are; an announced wait plays 3 s of its own sound before the cut.
- **The joins**: a video's pieces join hard (a jump cut, 10 ms fades), which leaves about a quarter of a second of the recording's own quiet between two stretches. A voice alone gets the breath a cutter of narration gives: where two stretches that were not one in the recording meet, the room's own quiet, taken from the quietest three seconds of the recording that hold no voice (blocks of 0.25 s, the window whose loudest block is quietest; without three such seconds the longest quiet there is, down to a quarter of a second, digital silence only where the room has nothing else, and silence where no quarter second is free of voice), an announced wait being the pause itself, 0.42 s after a sentence, 0.2 s inside one, and a keep's `"breath"` before it (seconds; a new part about 1), at the level of the take before it. On the narration below the largest step between two samples within 5 ms of any of the 82 joins was −32.7 dBFS, the largest in the middle of the quiet −35.9 dBFS: no click.
- **`build`** writes no HyperFrames project: `voice.cut.m4a` (the pieces and the quiet, each take at its level, then rumble filtered out at 75 Hz, a compressor 3:1 from −20 dBFS and a limiter 3 dB under full scale, the gain measured and corrected up to three times to `--loudness`, −14 LUFS; without the files' tags), `voice.cut.srt`, and `edit.json` with `"audio": true`, `"voice"`, `"loudness": {lufs, peak}`, the pieces (`"quiet": true` for the room's quiet) and every kept word timed in the voice. `--out <file>.m4a` copies the voice and its subtitles there (rragent: `artifacts/<name>.m4a`). `check` lists the quiet among the pieces and needs no HyperFrames; `finish`, `captions` and `broll` say in one sentence that there is no picture.

Measured on 2026-11-18 on a six-minute narration read with retries (5:51, MP3), as an agent goes through the steps: `new` 19.9 s ($0.022; this transcription was complete, nothing to hear again), `propose` 26.9 s ($0.047), `build` 7 to 14 s, `check` under a second. The proposal kept every sentence from its last complete attempt but one: the first two words of an attempt that breaks off, put before the last attempt of the sentence, which the agent's `cut.json` left out. The cut came to 2:47.2 and 421 words at −14.5 LUFS, true peak −1.4 dBTP; against a cut made by hand from another transcription of the same recording (422 words) the kept text differs only where the two transcriptions spell the same words differently (a number in digits or in words, a verb heard in another tense): four places, no false start kept and nothing lost.

## Captions in the picture

`takes.mjs captions <dir> --style <a style of captions: hormozi, bold, karaoke, wipe, label, editorial, clean, …> [--product …] [--brand brand/DESIGN.md] [--platform reels,tiktok]` (the platforms the video goes to: the captions keep clear of what they lay over it; kept in settings.json for every build, `build --platform` too) hands the cut's own words (timed in the cut, `fixes` applied) to agentitos' [captions](../captions/) skill: its `mark` lets a model pick the key words, which `cut.json` keeps as `"captions": {"style": "hormozi", "highlight": [word numbers]}`; from then on every `build` writes `captions.json` beside `cut.json`, runs the captions skill's `build` into `<out>/captions/` and mounts the sub-composition on top of the cut. `--off` takes them out. The tool looks for the captions skill at `CAPTIONS_TOOL`, beside this skill (`../captions`, a checkout of the collection), and in the machine's clone of the skills (`/home/sprite/skills/captions`).


## B-roll

`takes.mjs broll <dir> <broll.json>` (`--off` takes it out) keeps the file in `cut.json` (`"broll"`); from then on every `build` writes the cut's words to `broll.words.json` beside `cut.json` (the word numbers of the brief, timed in the cut), runs agentitos' [b-roll](../b-roll/) skill's `build` into `<out>/broll/` with the frame, `--platform` and the brand, and mounts its sub-composition over the pieces, under the captions. When a beat shows beside the person, the pieces sit in one `<div id="broll-person">` and b-roll's script (`<script id="broll-person-motion">`, after the main timeline's) moves that wrapper into the person's field; with captions, b-roll gets `--captions-area <out>/captions/area.json` and the same script moves the captions onto the band between the material and the person. A beat whose word the cut left out is dropped, and the build says so. The tool looks for the b-roll skill at `BROLL_TOOL`, beside this skill (`../b-roll`) and in the machine's clone (`/home/sprite/skills/b-roll`). The agent writes `broll.json` from the b-roll skill's brief on `edit.json`.
## Settings

Given to `new` or `build`, kept in `source/settings.json`: `--out`, `--title`, `--lang`, `--aspect source|9:16|16:9|1:1|4:5`, `--fit cover|contain`, `--target <s>`, `--pause <s>`, `--pauses picture|tight`, `--hook "…"`, `--brand <DESIGN.md>`, `--loudness <LUFS>`, `--fps`, `--order recorded|given`, `--model <OpenRouter id>`.

- **`--target <s>`**: the longest the cut should be. The brief's rule 8 has the first cut keep to the other rules alone (only slips, repeats, fillers and talk about the recording out); `check` then compares that cut with the target (see `check` above).
- **`--pauses tight`**: every pause over 0.4 s (or `--pause`) inside a keep goes, whatever the picture shows, down to the breath the cut points leave (about a quarter of a second): the pace of a reel, for a talking head or a moment cut from a long talk (agentitos' [clips](../clips/) sets it). The default, `picture`, keeps a pause over `--pause` where its picture moves clearly more than while speaking (a screencast's click, a thing held into a camera) and cuts the rest.
- **`--punch on`**: at a jump cut inside a take (the same video, a stretch left out) the picture goes 12 % closer, or back out, closer when the piece holds a key word of the captions: the cut looks meant and the key word lands closer. A piece that follows on without a cut keeps its size. `source/still.json` (`{"01.mp4": [[from, to], …]}`, seconds of that video) names pictures never to go closer on (clips writes it for B-roll shown whole). Default off.
- **`--hook "…"`**: a card over the start that says what the viewer gets, for a video whose first line does not (6 words or fewer, one `*word*` in the brand's colour): white with dark type, in the brand's display font (`--brand`, else the captions' brand, else Inter), on the first frame already, centred at the top of platform-zones' centred box for `--platform`; it stays until the cut's first sentence ends (2–5 s) and fades out. `--hook ""` takes it out.

## Why these models

Tested in October 2026 on a German 1:46 recording with three retries, fillers and meta talk:

| | fillers | names | timing | cost |
| --- | --- | --- | --- | --- |
| ElevenLabs Scribe v2 | all (äh, ähm, mm) and noises | Pentax Spotmatic, Voigtländer | 20 ms, real pauses; now and then squeezed next to a noise (repaired) | 0.6 ¢ |
| Gemini 3.5 Transcribe | some | right | tenths of a second | 0.9 ¢ |
| AssemblyAI Universal 3.6 Pro | none, even with `disfluencies` | right | ms | 0.9 ¢ |
| Parakeet (local, HyperFrames) | none | "Pentag Spot Matic" | words touch each other | free |

For the proposal, Gemini 4 Argon found all three retries and both pieces of meta talk, kept the goodbye and marked the silence where a viewfinder is shown (11 s, 3 ¢); Gemini 3.8 Flash missed a retry in one of two runs and split ranges around fillers.
