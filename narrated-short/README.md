# narrated-short

A story and footage of its subject → a narrated 9:16 short with nobody on camera: a voice tells the story in a few sentences, a clip of the subject runs under every sentence, a text hook stands on the first seconds, a comparison card shows the one number that astonishes, captions carry every word, music lies under it. For news, facts and explainers.

> Agents: start with [`SKILL.md`](SKILL.md).

```bash
L=../launch-video/tools/launch.mjs
node $L zones short/astrobee tiktok --frame 9:16                              # where the apps' buttons are
node $L voice short/astrobee short/astrobee/script.json artifacts/astrobee/composition
node tools/short.mjs clock short/astrobee                                     # every sentence and word on the film's clock
node tools/short.mjs faces short/astrobee                                     # the faces of the beats marked "people" (clips, OpenRouter)
node tools/short.mjs build short/astrobee artifacts/astrobee/composition --platform tiktok
node $L music short/astrobee artifacts/astrobee/composition --prompt "…" --seconds 26
node tools/short.mjs build short/astrobee artifacts/astrobee/composition --platform tiktok   # again: the music under the voice
node tools/short.mjs sheet short/astrobee artifacts/astrobee/composition      # stills at the moments that matter
node --test tools/test.mjs                                                    # the music's level under the voice, the faces' geometry, no request to a model (19 tests)
```

Requirements: Node 20+, ffmpeg (with ffprobe) and the HyperFrames CLI (`RRAGENT_HYPERFRAMES`, `HYPERFRAMES`, else `hyperframes` on the PATH); no npm packages, no model of its own. The other skills beside it, each found through its name in the environment, else beside this folder, else in `/home/sprite/skills/`: platform-zones (`PLATFORM_ZONES`), captions (`CAPTIONS_TOOL`), freeze-cutout (`FREEZE_CUTOUT`, only for a freeze), clips (`FRAME_TOOL`, its `frame.mjs`, only for `faces`) and layout (`LAYOUT_TOOL`, its `place.mjs`, only where a text lies on a face), and launch-video with transcribe for the voice and the music, which need OpenRouter. It makes almost nothing itself that another skill of the collection already does:

| what | from |
| --- | --- |
| the sources, judged on contact sheets | [footage](../footage/), or any video file |
| the voice, a line a sentence, every word timed and heard back | [launch-video](../launch-video/) `voice` (with [transcribe](../transcribe/)) |
| the music | launch-video `music` |
| the captions, the key words in colour, phrases as cards of their own (`boxes`) | [captions](../captions/) `build` |
| the first beat's freeze with the subject cut out (`freeze`) | [freeze-cutout](../freeze-cutout/), when it is there |
| where text may stand | [platform-zones](../platform-zones/) `zones` |
| the faces of a beat with people, over time, with their eyes, nose and mouth | [clips](../clips/) `frame.mjs --faces --every-shot` |
| one place for the captions and the hook's, off every face of every beat | [layout](../layout/) `place.mjs text` |
| text under the apps' buttons | launch-video `check` |
| the loudness of the finished video | launch-video `finish` |
| the texts and the publishing | [video-descriptions](../video-descriptions/), [publish-video](../publish-video/) |

What is its own: the film's clock, the clips under the words, and the composition with the hook text, the card, the credit and the handle.

## The four commands

**`clock <work> [--gap 0.3]`** reads `<work>/voice.json` (launch-video's) and places the lines: a line's file starts and ends in silence of a different length each time, so a line is placed by its words, its first word `--gap` seconds after the last word of the line before; it is played from just before its first word (`from`, a place in its file) to a quarter second past its last, and ends a hundredth before the next begins. `<work>/clock.json` holds every line (`at`, `from`, `duration`, `start`, `end`) and every word with its time in the film; the command prints them.

**`faces <work> [--all] [--again]`** sends each beat marked `"people": true` (every beat with `--all`) to agentitos' clips: the stretch its clip takes, cut at most 1080 lines high, without sound and without the file's tags, into `<work>/faces/<id>.mp4`, and `frame.mjs --faces --every-shot` on it (a model's stills with the eyes, nose and mouth, a tracker between them; `--every-shot` because the model calls footage of a crew at work b-roll, two of six such stretches on 2026-11-19). `<work>/faces/<id>.json` holds every face in px of the source, as shown, with the stretch it is of; a beat whose stretch did not change keeps it (`--again` asks anew), a beat no longer marked loses it. Measured on eleven beats of public footage (2026-11-19): 0.3 to 1.5 cents and 6 to 32 s a beat (8 s on footage with nobody in it). A beat it cannot do (no OpenRouter, the clip too large for the gateway, an HTTP error, an answer it cannot read, no answer) is said in a line with what went wrong and built as without faces, exit 0. A beat may take 90 s (three times the slowest measured), the step 6 minutes in all (twenty beats at the measured mean of 18 s); the beats not sent by then are built as without faces, and `faces` again sends them (`FACES_BEAT_SECONDS`, `FACES_STEP_SECONDS` set other limits, for a test).

**`build <work> <composition> [--platform …] [--style hormozi] [--no-captions] [--under 17] [--no-faces]`** reads `<work>/beats.json` (the format: [references/beats.md](references/beats.md)) and

- reads everything first (the beats, the tools it needs, every source), so nothing is cut for beats that cannot be built.
- cuts one clip per beat with one ffmpeg each into `<composition>/assets/clips/` (1080×1920, 30 fps, a keyframe a second, since sparse ones froze frames in a render); a clip is kept while its beat, its source (size and time of the file) and the way clips are cut did not change, with what was measured on it; a cut that fails leaves no clip behind; clips of beats that are gone are removed. `whole` lays the wide frame as a band over a blurred, darkened copy of itself, 1.6 times larger on the first beat; black bars burnt into a source are found (`cropdetect`, only a stable, even crop) and cut away.
- checks every clip for what needs no judgement: near black (the peak of the frames' mean luma under 12 for a band over its darkened copy, under 24 for a full picture, whose black is 16), shorter than its beat, standing still for more than half of it (also when it stands to its end), the first beat starting on a dark frame, and one of the source's own cuts inside the stretch (from the footage skill's `sources.json`).
- writes `<work>/words.json` from the clock, without the words spoken under the comparison card and with the beats' `keys` marked, and has captions `build` make `<composition>/captions/` from it.
- writes `<composition>/index.html`: a `<video>` per beat with a slow move, the voice's lines as `<audio id="vo-<id>">` where the clock places them (entered at `data-media-start`, so launch-video's `words` would not place them right: the captions come from this skill's clock), the music 17 LU (`--under`) under the voice, both measured, and down to nothing at the end, the hook text, the card, the credit, the handle, the captions mounted.

Where a beat's faces are known (`faces`, not `--no-faces`, and of the stretch the beat takes now), `build` also places the beat against them (`tools/lib/faces.mjs`). Boxes that cannot be faces (no size, mostly outside the picture, the whole picture) are left out. The faces that count are the main face (the tallest seen in half the beat or more) and any other seen in half of it at 70 % of its height or more (a passer-by is not: crew4's b5, a man seen in a quarter of the beat as he passes, widened the picture of two women; the review's b3: a woman at a laptop 53 % as tall behind the speaker must not count; crew4's b5: two women side by side, 78 %, must both), 4 % of the source's height at least. A face that does not count and is cut is said by why: in the background where it is under 60 % of the main face's height, at the side where it is larger (the review's b9: a fourth man walking beside three, 67 %), a passer-by where it is seen too briefly. In a narrated short nobody shown speaks, so text may lie on a mouth or a chin; only eyes and noses must stay clear. A `fill` goes, in this order, to: a fill that shows their eyes, nose and mouth (from the middle, else moved; an ear, the back of a head or a face in the background may be cut; where the middle shows the main face's, it stays a fill), raised at its size over the ground where eyes or noses would lie under the captions (its last 96 px go over into the ground, an eased ramp, so that no hard line shows where it ends) (captions' `area.json`, built before the clips); a 4:5 or 1:1 crop that holds them, placed high (agentitos' layout `place`, its best such candidate that holds every face, taken where its eyes and noses clear the captions); the whole picture as a band last, as large as holds them all with their noses above the captions' top. The first beat's own 1.6× band moves its window to them, or becomes smaller. `zoom` and `pan` the agent gave stand, with a `!` where they cut a face's eyes, nose or mouth. Then the faces go into the frame as the clip shows them (the source's second through `speed`, the band or crop and its blurred edges, the slow move of every clip) and the usual places of the captions (captions' area) and of the hook are checked against them over their seconds, by the part they overlap (the hair or forehead, the eyes or nose, the mouth, the lower lip, the chin, from the model's eyes, nose and mouth). Where the captions lie on eyes or a nose, agentitos' layout `text` gets every beat as a shot with its faces (never raised) and gives one place for the captions of the whole short, asked at their own size (smaller only where several beats' faces pay for it: smaller type costs as much as the longest beat wholly on the eyes or nose, and more the smaller it gets), taken only where it lies on them less (weighed eyes and nose 100, mouth 2, lower lip 1, hair 0.5, chin 0.2 a second); the captions are built again with layout's options. The hook may lie on hair or a forehead; where it reaches eyes, a nose or a mouth it is set smaller in its place first (its sizes down to 60 px), then in layout's place for it (with the captions where they stand), refused where that lies on the captions or within the hook's height (200 px at least) above or below them; else it stays where it stood, with a `!`. Every step says per beat what it did and why. Without faces, `build` writes the same files byte for byte as before (checked on 2026-11-19: a short without the step, one with `--no-faces`, and one whose faces step found none: 22, 22 and 19 files identical to the build of main).

The text stands where platform-zones says so for the platforms named: the credit at the top of the wide stretch above the apps' buttons, the hook text, the card and the handle under it, the captions (by captions itself) at the bottom of the centred box. The accent is the brand kit's primary colour when the working directory has `brand/DESIGN.md`.

**`sheet <work> <composition>`** takes stills of the composition with `hyperframes snapshot` (the first frame, the hook at 1.2 s and just after it, the freeze at its largest, each beat at its start and middle, the card, every box, the end; a moment less than a quarter second after another is left out) and lays them on `<work>/sheet.jpg`, for the agent's quality round ([references/quality.md](references/quality.md)).

## Where the rules come from

The form is that of a pilot account that posted three such videos a day and measured them: the first frame proves the first sentence, a text hook of two to five words, one text on screen at a time, a comparison within the same kind on a sentence of its own, the ending that asks for the share, no end card so the video loops. The pilot's own pipeline did the same with Python, a GPU and its own captions; this skill keeps the form and leaves the work to the collection's tools. The freeze of the first beat with the subject cut out is a skill of its own, freeze-cutout, which `build` runs on the first beat when the beat asks for it; the pilot's boxes around a spoken phrase are an option of captions, which `build` asks for with the beats' `boxes`.

## In rragent

The project is made with the `project` tool (kind `hyperframes`); the person sees every build in the player beside the chat and says yes to it before the `render` tool makes `artifacts/<name>.mp4`. On a Sprite (4 GB) a 25 s short renders in about a minute and a half.
