# freeze-cutout

A clip → the same clip with a freeze: for most of a second the picture stops, the background turns black and white and darker, the subject keeps its colour, grows a little and gets a sticker outline, then the clip runs on while the effect fades. Made for the first seconds of a short: the eye knows at once what the video is about.

> Agents: start with [`SKILL.md`](SKILL.md).

```bash
node tools/cutout.mjs clip.mp4 clip-pop.mp4 --at 1.2 --subject "the robot"          # strong: 0.7 s, 1.2 times, a thick outline
node tools/cutout.mjs clip.mp4 clip-pop.mp4 --at 1.2 --subject "the robot" --style soft   # 0.45 s, 1.12 times, thinner
```

Requirements: Node 20+, ffmpeg (with ffprobe), OpenRouter: `OPENROUTER_API_KEY`, or on a Sprite the gateway's `openrouter` connection (`tools/lib/openrouter.mjs`). No npm packages.

## How it works

1. **The frame.** The frame at `--at` and the few after it are read as raw pictures.
2. **Where to look.** `--region`, else the sharp band of a clip that lies over a blurred copy of itself (the two rows where the picture changes hardest, in the upper and the lower half), else the whole frame.
3. **The mask.** An image model (`google/gemini-3.1-flash-image`, `CUTOUT_MODEL` names another) gets that picture and the order to return it unchanged with everything but the subject painted pure green. Where the answer is much greener than red and blue is background; the rest is the subject. So the mask only says *where*: the pixels shown are the clip's own, nothing the model drew.
4. **One clean shape.** Specks are removed (an opening of two steps), the largest blob and blobs a fifth of it or more are kept, holes are filled. A mask that covers under 2 % or over 80 % of the picture is no subject: the model is asked once more, then the tool gives up with one sentence and writes nothing.
5. **The effect**, per frame, in plain JavaScript on the raw pixels: the background as grey at three quarters of its brightness; an outline of 16 px (11 for `soft`, for a frame 1080 px wide) around the mask in red; the subject's own pixels, more saturated and sharpened, on top; all of it grown about the subject's middle by a sine over the pop's time. The effect comes in over 0.08 s and goes out over 0.25 s while the picture already moves again.
6. **The clip.** Head, effect and the rest are joined in one encode (H.264, a keyframe a second). The freeze takes the pop's time out of the clip's end, so the clip is as long as before, frame for frame.

The mask is kept as `<work>/cutout-<key>.png` (the key: the picture, the model, the subject), so another style or a second build asks no model. `<work>/cutout-check.jpg` is the frozen frame at the pop's largest, for the agent's eyes: no tool can tell whether the outline holds the right thing.

## Measured

On a Sprite (8 CPUs, 4 GB), a 5.5 s clip of 1080×1920: under a minute with the model's answer, a few seconds with the mask kept. The model's picture cost $0.136 for a band of 1080×973; smaller pictures cost less.

## Where it comes from

The effect is that of a pilot account that tested it against a plain opening on the same days (two pop styles, `strong` kept): Python with numpy, scipy and Pillow there. Here the same steps without packages.

## From another skill

A folder never imports another's code: a skill runs this tool as a program, found through `FREEZE_CUTOUT` (the path of `tools/cutout.mjs`), else beside it (`../freeze-cutout/tools/cutout.mjs`), else in the machine's clone (`/home/sprite/skills/freeze-cutout/tools/cutout.mjs`). Exit 0: the output is written. Exit 1: one sentence on stdout, nothing written, the caller goes on with the plain clip.
