---
name: auto-reframe
description: Crop a wide local video to 9:16 or square following one chosen non-speaking subject (car, athlete, product) on the CPU, offline, with a tracking preview to check; for Reels, Stories, TikTok, Shorts.
license: MIT
metadata:
  title: "Auto reframe"
  title-de: "Auto-Reframing"
  summary: "Follow a selected subject and turn wide footage into a calm vertical crop, with a visual tracking check."
  summary-de: "Ein ausgewähltes Motiv verfolgen und breite Videos ruhig ins Hochformat schneiden – mit visueller Tracking-Kontrolle."
  ask: "Upload a video and tell me which subject should stay in frame. I make a short tracking preview first."
  ask-de: "Lade ein Video hoch und sag mir, welches Motiv im Bild bleiben soll. Ich erstelle zuerst eine kurze Tracking-Vorschau."
  placeholder: "Upload a video and describe the subject"
  placeholder-de: "Video hochladen und das Motiv beschreiben"
  inputs: "video"
---

# auto-reframe

`<skill>` is this folder, an independent Python slice. Run its tools from the caller's working directory; put all media, environments and jobs into the caller's `work/`, never into `<skill>`. Do not modify the shared scripts while making a video.

## What this is, and is not

**Cropping**, not outpainting: it follows one selected subject and discards the sides. It cannot keep several widely separated cars in one narrow crop, and does not synthesize scenery, remove overlays, add subtitles or publish. Keep original aspect and perspective: never squeeze the video.

People talking (podcast, interview, talk) are not this skill's: agentitos' clips frames them on whoever speaks (`clips/tools/frame.mjs`). This one is for a subject that moves without speaking (a car, an athlete, an animal, a product).

Tracking is CPU CSRT from a manually selected first box; optional MobileNet-SSD corrections are **for cars only**. No network during tracking/rendering. An external VLM may provide a seed, but is not needed or included.

## Setup

Needs Python 3.10+, ffmpeg/ffprobe with H.264 encoding, NumPy and OpenCV **contrib**. Ask the operator to install missing dependencies, or install them only when setup is explicitly authorized. Use a clean environment; never mix several OpenCV wheels.

```bash
python3 -m venv work/auto-reframe-venv
work/auto-reframe-venv/bin/pip install -r <skill>/requirements.txt
work/auto-reframe-venv/bin/python <skill>/tools/reframe.py doctor
```

For optional car corrections, explicitly download the pinned, checksum-verified model (about 23 MB). Weights are NOT included or covered by the skill's MIT license; check upstream rights before use:

```bash
work/auto-reframe-venv/bin/python <skill>/tools/fetch_models.py --dest work/models/auto-reframe
```

Below, `<python>` is this environment's Python.

## Workflow

### 1. Source and subject

Use a local video the person may use. Downloading (YouTube, proxies, credentials) is a separate task; add no secrets or network calls to this skill. Ask only what is missing: the subject and, for a long video, the time range. For an unambiguous single subject, choose it and say so.

Default delivery 1080×1920, 9:16. First test 3–8 seconds at 30 fps; keep 60 fps only when footage and deliverable justify it.

### 2. Inspect the normalized first frame

```bash
<python> <skill>/tools/reframe.py inspect input.mp4 --start 14.85 --out work/reframe-inspect
```

Read `work/reframe-inspect/first-frame.jpg`. Select **x,y,width,height in that image's pixels**: not a normalized 0–1000 box, not x1,y1,x2,y2. Never reuse a box from another shot or resolution. If two subjects are plausible, show this frame and ask which one.

### 3. Build a short preview

The numbers are from the documented sample; take the real box from the current first frame:

```bash
<python> <skill>/tools/reframe.py run input.mp4 \
  --start 14.85 --duration 5 --bbox 704,416,195,121 \
  --size 1080x1920 --fps 30 --out work/reframe-preview
```

For a car, optional periodic local re-detection repairs pose/scale drift:

```bash
<python> <skill>/tools/reframe.py run input.mp4 \
  --start 14.85 --duration 5 --bbox 704,416,195,121 \
  --detector car-ssd --models work/models/auto-reframe --detector-rate 5 \
  --hsv 75,100,65,255,45,255 --min-color-fraction 0.02 \
  --out work/reframe-car-preview
```

The HSV example is for a turquoise car, not a default. Never guess a color gate for an arbitrary subject; white cars may be dark in shade, and similar cars can pass the same gate.

### 4. Camera cuts and uncertain tracking

Automatic cuts are a conservative heuristic, not ground truth: inspect reported cuts. A cut resets tracker and smoothing; without a new manual seed the job marks `cut_unseeded`, centers/holds the crop and requires review. Never pretend to know the same subject in the new shot.

For several shots, give `--seeds work/seeds.json` instead of `--bbox`:

```json
{"seeds":[
  {"time":0,"bbox":[704,416,195,121]},
  {"time":2.5,"bbox":[800,300,180,120],"cut":true}
]}
```

Times are local to the selected segment, not the original episode; `frame` may replace `time`. `cut:true` forces a camera-cut boundary; a seed without it re-initializes a lost subject inside a continuous shot. Do not carry identity across a shot without checking it. Use `--no-cut-detection` only after verifying one uncut shot.

### 5. Review, then deliver

Always read `qa.json` **and** inspect `contact-sheet.jpg` and `diagnostic.mp4`:

- Green box: accepted tracker/detector box. White frame: output crop. Orange status: unknown/rejected tracking.
- Verify it stays the **same subject**, especially through occlusion, front-to-side pose changes and close neighbors.
- Check crop clipping, long lost intervals, false/missed cuts and real camera motion.
- `mechanical_checks_passed` is NOT publication approval: every job sets `human_identity_review_required: true` and `ready_to_publish: false`. A 100% box-inside-crop number validates the predicted boxes, not that they are the right subject.
- Never hide failures by switching cars, stretching the picture or generating background.

When tracking drifts: shorten the shot, add an explicit seed, adjust the car gate, or say it needs a stronger detector/re-identification. Never claim fully automatic whole-episode reliability. More smoothing may lag fast action: check visibility. An object wider than the crop cannot fully fit.

After the preview is approved, run the chosen clip(s), inspect again, and deliver `vertical.mp4`. Montage, voiceover, subtitles, intro or outro belong to a downstream editing skill. This skill never schedules or publishes.

## Outputs and exit status

Each `--out` must be a new or empty directory. Outputs:
- `source.mp4`: normalized short working copy with source audio.
- `vertical.mp4`: full-height crop, no synthesized pixels.
- `diagnostic.mp4`: original wide view with boxes, crop and status.
- `contact-sheet.jpg`, `tracking.json`, `qa.json`, `seeds.used.json`, `status.json`.

Exit **0**: mechanical checks passed, still needs identity review. Exit **2**: preview produced, review required (boxes lost/clipped). Exit **1**: error; never claim a finished export. `--track-only` skips rendering. Re-render a job without tracking again:

```bash
<python> <skill>/tools/reframe.py render work/reframe-preview
```

## Tests and reference

```bash
<python> -m unittest discover -s <skill>/tests -v
```

[README.md](README.md): configuration, CPU performance, limitations, licensing.
