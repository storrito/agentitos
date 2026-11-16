# freeze-cutout

A clip → the same clip with a freeze: for most of a second the picture stops, the background turns black and white and darker, the subject keeps its colour, grows a little and gets a sticker outline, then the clip runs on while the effect fades. Made for the first seconds of a short: the eye knows at once what the video is about.

> Agents: start with [`SKILL.md`](SKILL.md).

```bash
node tools/cutout.mjs clip.mp4 clip-pop.mp4 --at 1.2 --subject "the robot"          # strong: 0.7 s, 1.2 times, a thick outline
node tools/cutout.mjs clip.mp4 clip-pop.mp4 --at 1.2 --subject "the robot" --style soft   # 0.45 s, 1.12 times, thinner
```

Requirements: Node 20+, ffmpeg (with ffprobe), OpenRouter: `OPENROUTER_API_KEY`, or on a Sprite the gateway's `openrouter` connection (`tools/lib/openrouter.mjs`). No npm packages.

## How it works

1. **The clip on one clock.** The clip is read at its own frame rate as a constant one (a fraction such as 30000/1001 stays what it is; a clip with a changing rate is filled to it), in the turn it is shown in (a phone's clip stored lying is taken upright). Every frame is counted on that clock, so the output has as many frames as the clip has on it.
2. **The frames.** The frame at `--at` and the few after it are read as raw pictures.
3. **Where to look.** The whole frame; `--region x,y,w,h`; or `--region band`, the sharp band of a clip that lies over a blurred copy of itself (the two rows where the picture changes hardest, one in each half, at least 15 % of the height apart; none found: the whole frame). The tool says which it took.
4. **The mask.** An image model (`google/gemini-3.1-flash-image`, `CUTOUT_MODEL` names another) gets that picture, as a JPEG of at most 1536 px, and the order to return it unchanged with everything but the subject painted pure green. Where the answer is much greener than red and blue is background; the rest is the subject. So the mask only says *where*: the pixels shown are the clip's own, nothing the model drew. A subject that is itself bright green is lost this way.
5. **One clean shape.** Specks are removed (an opening of two steps), the largest blob and blobs a fifth of it or more are kept, holes are filled. A mask that covers under 2 % or over 80 % of the picture is no subject: the model is asked once more, then the tool gives up with one sentence and writes no output. When the way to the model fails (no OpenRouter, a refused request) it says that instead, and does not ask twice for what cannot change.
6. **The effect**, per frame, in plain JavaScript on the raw pixels: the background as grey at three quarters of its brightness; an outline of 16 px (11 for `soft`, for a frame whose short side is 1080 px) around the mask in red; the subject's own pixels, more saturated and sharpened, on top; all of it grown about the subject's middle by a sine over the pop's time. The effect comes in over 0.08 s and goes out over 0.25 s while the picture already moves again.
7. **The clip.** Head, effect and the rest are joined in one encode (H.264, a keyframe a second), written beside the output and moved onto its name only when it is whole. The freeze takes the pop's time out of the clip's end. The way to RGB and back must not change the colours, or the frames of the effect differ from the frames around them. Which pair of conversions does that depends on the clip's marks and on the ffmpeg at hand, so the tool tries three pairs on the frozen frame itself and takes the one that brings it back closest (measured on a clip marked bt709 and on unmarked ones, with an ffmpeg of 2021 and one of 2025: the first frame of the effect, at strength 0, is the clip's own frame within 44 to 46 dB, as much as the way through RGB costs; the wrong pair gave 25). The clip keeps its colour marks. 8-bit clips; an HDR clip was not tried.

The clip comes out **without sound**: it is footage for under a voice.

The mask is kept as `<work>/cutout-<key>.png` (the key: the picture, the model, the subject), so another style or a second build asks no model. `<work>/cutout-check.jpg` is the frozen frame at the pop's largest, for the agent's eyes: no tool can tell whether the outline holds the right thing. In a test with a region set by hand the model kept a piece of wall with the subject, plausible by size, wrong by eye.

## Measured

On a Sprite (8 CPUs, 4 GB), a 5.5 s clip of 1080×1920: under a minute with the model's answer, a few seconds with the mask kept. The model's picture cost $0.136 for a band of 1080×973 and $0.068 for a frame of 1280×720 (sent at full size then; it is sent at 1536 px at most now).

Memory (on a laptop, 8 encoder threads): the tool itself holds the frames of the effect's end, about 200 MB for 1080×1920; the encode takes about 0.8 GB for 1080×1920 and 2.7 GB for 3840×2160, whatever the clip's length. So a clip above 2560×1440 is refused: a Sprite has 4 GB.

## Where it comes from

The effect is that of a pilot account that tested it against a plain opening on the same days (two pop styles, `strong` kept): Python with numpy, scipy and Pillow there. Here the same steps without packages.

## From another skill

A folder never imports another's code: a skill runs this tool as a program, found through `FREEZE_CUTOUT` (the path of `tools/cutout.mjs`), else beside it (`../freeze-cutout/tools/cutout.mjs`), else in the machine's clone (`/home/sprite/skills/freeze-cutout/tools/cutout.mjs`). Exit 0: the output is written. Anything else: one sentence on stdout, no output (the mask, once paid for, stays in the work folder), and the caller goes on with the plain clip.
