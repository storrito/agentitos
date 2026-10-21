# auto-reframe

A small, self-contained **CPU-only object-aware crop** for vertical video. Built from a practical 16:9 → 9:16 motorsport editing workflow, extracted into a reusable Agent Skill for [agentitos](https://github.com/storrito/agentitos).

Agents start with [`SKILL.md`](SKILL.md). No other skill is imported. There is no GPU, SAM, PyTorch, VLM, inference API or cloud account requirement.

**Scope:** select one subject, track it, compute a calm crop and export a diagnostic view. This is not generative outpainting and cannot preserve all subjects in a wide group. Automatic tracking does not establish identity.

## Files

```text
auto-reframe/
├── SKILL.md
├── README.md
├── LICENSE
├── requirements.txt
├── SOURCES.md
├── tools/
│   ├── reframe.py
│   └── fetch_models.py
├── tests/
│   └── test_reframe.py
└── examples/
    ├── seeds.json
    └── README.md
```

## Install

Python 3.10+ and ffmpeg/ffprobe with `libx264` on the PATH. A fresh environment avoids conflicts between OpenCV wheels:

```bash
python3 -m venv work/auto-reframe-venv
work/auto-reframe-venv/bin/pip install -r auto-reframe/requirements.txt
PY=work/auto-reframe-venv/bin/python
$PY auto-reframe/tools/reframe.py doctor
```

The `opencv-contrib-python-headless` wheel contains CSRT. Do not also install `opencv-python` or `opencv-python-headless` in the same environment. Headless wheels do not need a desktop UI. On Windows use the venv's `Scripts/python.exe` and put ffmpeg on PATH; the scripts themselves use portable `pathlib`/subprocess argument lists, but Windows was not tested in this extraction.

## Quick start

1. Export the first frame **at the selected source time**:

```bash
$PY auto-reframe/tools/reframe.py inspect input.mp4 --start 14.85 --out work/inspect-car
```

2. Choose a box from `first-frame.jpg`. Coordinates are x,y,width,height in the normalized source, not x1,y1,x2,y2 or 0–1000 normalized coordinates.

3. Run a short test. These numbers are an example, not a default subject:

```bash
$PY auto-reframe/tools/reframe.py run input.mp4 \
  --start 14.85 --duration 5 --bbox 704,416,195,121 \
  --size 1080x1920 --fps 30 --threads 2 \
  --out work/car-test
```

4. Review the **same subject** in `diagnostic.mp4`, not just green status flags. Compare `vertical.mp4`, `contact-sheet.jpg` and `qa.json`. Only then process a longer range.

The output directory must be empty. Source files are never overwritten. There is no automatic download or publication.

## Optional car re-detection

CSRT alone can drift during front/side/rear pose changes. The optional MobileNet-SSD detector periodically corrects the box in a nearby ROI. It is a lightweight legacy car detector, not a modern re-identification system.

Download pinned model files explicitly (about 23 MB, SHA-256 checked):

```bash
$PY auto-reframe/tools/fetch_models.py --dest work/models/auto-reframe
$PY auto-reframe/tools/reframe.py run input.mp4 \
  --start 14.85 --duration 5 --bbox 704,416,195,121 \
  --detector car-ssd --models work/models/auto-reframe \
  --detector-rate 5 --hsv 75,100,65,255,45,255 --min-color-fraction 0.02 \
  --out work/car-detected
```

HSV uses OpenCV's **H 0..179, S/V 0..255**, ordered H-min,H-max,S-min,S-max,V-min,V-max. The example gate is turquoise. With no gate, detections are selected by class, confidence and proximity only, increasing the risk of identity swaps. Gates do not prove identity either. Wrong lighting thresholds can reject the correct car; white vehicles in shade are a known case.

The main tracker works without model files. No network access occurs during a run, and the detector explicitly uses the OpenCV CPU backend. External model rights are separate: see [`SOURCES.md`](SOURCES.md).

## Shot-aware seeds

```bash
$PY auto-reframe/tools/reframe.py run input.mp4 \
  --start 20 --duration 8 --seeds work/seeds.json --out work/multiple-shots
```

```json
{"seeds":[
  {"time":0,"bbox":[704,416,195,121]},
  {"frame":75,"bbox":[800,300,180,120],"cut":true}
]}
```

At 30 fps, frame 75 is local time 2.5 seconds. All times/frames are relative to the extracted segment. A first seed at frame 0 is required. A detected or forced cut resets object state and smoothing. Unseeded shots are marked uncertain; the tool does not carry an identity through a cut. Explicit seeds are also useful after occlusion. The automatic cut heuristic may miss similar-looking cuts or flag flashes/fast pans: inspect it, or process verified uncut shots individually. `--no-cut-detection` is not a general workaround for bad results.

## Camera behavior

- A full-height floating-point crop is used, e.g. 607.5×1080 source pixels for exact 1080×1920 output from 1920×1080 input.
- Fractional affine resampling avoids the visible integer stepping of a moving `crop=x` filter.
- Center estimates are median filtered and symmetrically smoothed per shot, with a short look-ahead. This is an **offline** editor, not a streaming/live tracker.
- The camera holds inside a deadband, then moves with bounded velocity and commanded acceleration.
- Physical frame boundaries can change observed acceleration; QA reports the actual values. The tool does not claim every boundary clamp meets the acceleration target.
- Smoothness and subject coverage can conflict. The tool reports clipped boxes rather than silently teleporting the crop.
- There is no smoothing across a camera cut. A cut can legitimately jump to a new crop.
- Only short tracking gaps are interpolated. Long gaps hold the last center (an entirely unseeded shot holds the frame center).

### Main options

| Option | Default | Meaning |
|---|---:|---|
| `--duration` | required | Selected seconds, not the whole episode by accident |
| `--start` | 0 | Source seconds |
| `--size` | 1080x1920 | Any even target dimensions that fit a full-height crop |
| `--fps` | 30 | Normalized tracking/render rate; 1–120 |
| `--track-width` | 960 | CPU processing width, no upscale beyond source width |
| `--threads` | 2 | OpenCV/ffmpeg thread budget |
| `--deadband` | .06 | Fraction of crop width, not full source width |
| `--max-speed` | .167 | Source widths per second |
| `--max-accel` | .417 | Source widths per second squared |
| `--max-gap` | .35 | Maximum short gap to interpolate, seconds |
| `--detector` | none | `none` or `car-ssd`; not a generic subject detector |
| `--detector-rate` | 5 | Corrections per second; detector is also tried on rejection |
| `--detect-threshold` | .35 | Car confidence threshold |
| `--hsv` | none | Optional appearance gate for car detections |
| `--no-cut-detection` | false | Only for a verified uncut shot |
| `--track-only` | false | Save analysis without rendering |

Full options: `python tools/reframe.py run --help`.

## QA, exit codes and artifacts

- **0:** mechanical checks passed. A human/agent must still verify identity before use.
- **2:** review required (lost/unseeded tracking or partial boxes); previews and reports are still produced.
- **1:** error. Do not treat a partial file as an export.

`ready_to_publish` is always false, `human_identity_review_required` always true. `valid` means a box passed local checks; it does not mean the object is semantically correct.

| File | Purpose |
|---|---|
| `source.mp4` | CFR normalized working copy, square pixels, available source audio |
| `vertical.mp4` | H.264/AAC export; audio mapping is optional, silent sources work |
| `diagnostic.mp4` | Wide view, green current boxes, white crop, orange uncertainty |
| `contact-sheet.jpg` | Grid of up to six samples |
| `tracking.json` | Per-frame boxes, states, cuts and floating crop positions |
| `qa.json` | Coverage among valid boxes, uncertainty/clipping intervals, motion/performance |
| `seeds.used.json` | Reproducible local-frame seeds |
| `status.json` | Job state |

Re-render from cached data without tracking again:

```bash
$PY auto-reframe/tools/reframe.py render work/car-test
```

The cropped export preserves source content after scaling/cropping/encoding; it is not a bit-identical or lossless copy. Broadcast overlays get cropped with the picture. This tool does not automatically redesign or remove them. No synthesized scenery or extra objects are introduced.

## Performance and limitations

The original prototypes processed selected 1080p/60fps racing shots at roughly 39–44 tracking frames/s on an 8-logical-CPU, approximately 4 GB RAM machine using 960px CSRT plus periodic detector corrections. That **excluded rendering** and is not a universal benchmark. Consult each extracted version's own `qa.json`; normalization, FPS, detector, CPU and shot difficulty change performance. Processing is two-pass and streaming, without retaining every full frame in RAM.

Observed failures include fast front-to-rear drive-bys, occlusion, rapid zoom-out, similar neighboring vehicles and undetected identity drift despite a successful CSRT flag. The extracted skill is **v0.1**, not a guaranteed whole-episode auto-editor. It needs per-shot selection and visual review. SAM masks are not required for simple single-subject crops; a stronger detector/re-identification component may be appropriate for hard scenes.

## Tests

```bash
$PY -m unittest discover -s auto-reframe/tests -v
```

Tests cover short smoothing arrays, shot resets, unknown intervals, impossible geometry, CLI input validation, synthetic source normalization, a silent-video end-to-end render and an explicitly seeded synthetic cut. No remote API or copyrighted sample media is required. Optional model fetching is explicit and is not performed by the tests.

## Add to agentitos

Copy the entire `auto-reframe/` folder to the repository root, next to `kinetic-lyrics/`. Add this row to the repository's Agents table:

```markdown
| [auto-reframe](auto-reframe/) | Wide video → calm subject-following vertical crop on the CPU, with local tracking, optional car re-detection and a diagnostic review. |
```

No changes to other folders, package manifests or shared engines are required. A harness can load this folder's `SKILL.md`; register it according to that harness's skill mechanism. Merely copying the files does not guarantee a live chat client's slash menu refreshes immediately.

## License

Skill code and documentation: MIT, [`LICENSE`](LICENSE). Dependencies and optional pretrained detector files retain their own licenses. No source video, credentials, model weights, virtualenv or node_modules are included in the release archive.
