# narrated-short

A story and footage of its subject → a narrated 9:16 short with nobody on camera: a voice tells the story in a few sentences, a clip of the subject runs under every sentence, a text hook stands on the first seconds, a comparison card shows the one number that astonishes, captions carry every word, music lies under it. For news, facts and explainers.

> Agents: start with [`SKILL.md`](SKILL.md).

```bash
L=../launch-video/tools/launch.mjs
node $L zones short/astrobee tiktok --frame 9:16                              # where the apps' buttons are
node $L voice short/astrobee short/astrobee/script.json artifacts/astrobee/composition
node tools/short.mjs clock short/astrobee                                     # every sentence and word on the film's clock
node tools/short.mjs build short/astrobee artifacts/astrobee/composition --platform tiktok
node $L music short/astrobee artifacts/astrobee/composition --prompt "…" --seconds 26
node tools/short.mjs build short/astrobee artifacts/astrobee/composition --platform tiktok   # again: the music under the voice
node tools/short.mjs sheet short/astrobee artifacts/astrobee/composition      # stills at the moments that matter
```

Requirements: Node 20+, ffmpeg (with ffprobe) and the HyperFrames CLI; no npm packages, no model of its own. It makes almost nothing itself that another skill of the collection already does:

| what | from |
| --- | --- |
| the sources, judged on contact sheets | footage (its own pull request), or any video file |
| the voice, a line a sentence, every word timed and heard back | [launch-video](../launch-video/) `voice` (with [transcribe](../transcribe/)) |
| the music | launch-video `music` |
| the captions, the key words in colour | [captions](../captions/) `build` |
| where text may stand | [platform-zones](../platform-zones/) `zones` |
| text under the apps' buttons | launch-video `check` |
| the loudness of the finished video | launch-video `finish` |
| the texts and the publishing | [video-descriptions](../video-descriptions/), [publish-video](../publish-video/) |

What is its own: the film's clock, the clips under the words, and the composition with the hook text, the card, the credit and the handle.

## The three commands

**`clock <work> [--gap 0.3]`** reads `<work>/voice.json` (launch-video's) and places the lines: a line's file ends in silence of a different length each time, so the next line is placed by the words, its first word `--gap` seconds after the last word of the line before, and a line plays up to a quarter second past its last word. `<work>/clock.json` holds every line (`at`, `duration`, `start`, `end`) and every word with its time in the film; the command prints them.

**`build <work> <composition> [--platform …] [--style hormozi] [--no-captions]`** reads `<work>/beats.json` (the format: [references/beats.md](references/beats.md)) and

- cuts one clip per beat with one ffmpeg each into `<composition>/assets/clips/` (1080×1920, 30 fps, a keyframe a second, since sparse ones froze frames in a render); a clip whose beat did not change is kept. `whole` lays the wide frame as a band over a blurred, darkened copy of itself, 1.6 times larger on the first beat; black bars burnt into a source are found (`cropdetect`, only a stable, even crop) and cut away.
- checks every clip for what needs no judgement: near black (the peak of the frames' mean luma under 12), shorter than its beat, standing still for more than half of it, the first beat starting on a dark frame, and one of the source's own cuts inside the stretch (from the footage skill's `sources.json`).
- writes `<work>/words.json` from the clock, without the words spoken under the comparison card and with the beats' `keys` marked, and has captions `build` make `<composition>/captions/` from it.
- writes `<composition>/index.html`: a `<video>` per beat with a slow move, the voice's lines as `<audio id="vo-<id>">` where the clock places them (as launch-video does, so its `words` and `captions` work on the film too), the music at 0.16 under the voice and down to nothing at the end, the hook text, the card, the credit, the handle, the captions mounted.

The text stands where platform-zones says so for the platforms named: the credit at the top of the wide stretch above the apps' buttons, the hook text, the card and the handle under it, the captions (by captions itself) at the bottom of the centred box. The accent is the brand kit's primary colour when the working directory has `brand/DESIGN.md`.

**`sheet <work> <composition>`** takes stills of the composition with `hyperframes snapshot` (the hook, each beat at its start and middle, the card, the end) and lays them on `<work>/sheet.jpg`, for the agent's quality round ([references/quality.md](references/quality.md)).

## Where the rules come from

The form is that of a pilot account that posted three such videos a day and measured them: the first frame proves the first sentence, a text hook of two to five words, one text on screen at a time, a comparison within the same kind on a sentence of its own, the ending that asks for the share, no end card so the video loops. The pilot's own pipeline did the same with Python, a GPU and its own captions; this skill keeps the form and leaves the work to the collection's tools. Not carried over yet: the freeze of the first beat with the subject cut out (a mask from an image model), which would be a skill of its own.

## In rragent

The project is made with the `project` tool (kind `hyperframes`); the person sees every build in the player beside the chat and says yes to it before the `render` tool makes `artifacts/<name>.mp4`. On a Sprite (4 GB) a 25 s short renders in about a minute and a half.
