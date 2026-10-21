# Validation of this extraction (v0.1.0)

These checks were actually executed on the extracted code, not just on the earlier prototype.

## Environment

- Linux, Python 3.14.8
- NumPy 2.5.4
- opencv-contrib-python-headless 4.14.0.94
- ffmpeg 8.0.1, H.264 encoder available
- 8 logical CPUs, approximately 3.8 GiB RAM; no CUDA GPU required

`requirements-tested.txt` records those exact Python package versions. Other platforms/Python versions have not been validated in this extraction.

## Automated tests

Command:

```bash
python -m unittest discover -s auto-reframe/tests -v
```

**12 tests passed**, including a silent synthetic-video decode → tracking → crop → H.264 export; explicit camera-cut seed reset; an automatically detected cut without a seed producing review-required status; non-destructive output handling; finite and bounded crop paths; invalid input/geometry; unknown intervals.

## Model download

The opt-in downloader was run into a caller-owned validation folder. Both files were fetched from the pinned upstream commit and passed SHA-256/length validation. No weights are included in this archive.

## Real clip smoke test

A five-second, 1920×1080 motorsport shot from the user's existing source was processed by the new CLI, independently of the old hardcoded script:

- Initial subject selected manually; optional car detector and turquoise appearance gate.
- Normalized tracking/rendering at 30 fps.
- Test export 360×640 with source audio; 5.0 seconds.
- 150 decoded frames; accepted boxes in all 150 frames.
- All 150 predicted boxes fully inside the crop; no detected cuts or mechanically uncertain intervals in this test.
- Approximately **34.5 tracking frames/s**, including decode/resizing/detection and excluding normalization/final encoding.
- Export dimensions/duration checked with ffprobe; contact sheet visually reviewed.

This is one selected easy/medium shot, **not a comprehensive identity benchmark**. `identity_verified` remains false in the machine output, and publication always requires visual review. No source video or render from that clip is bundled. Known failed prototype shots (fast drive-bys, occlusion, rapid zoom out) are documented in README rather than presented as solved.

## Not claimed

- No guarantee of correct identity throughout arbitrary footage.
- No GPU/VLM/SAM implementation.
- No generated background or simultaneous multi-subject reframing.
- No automatic publication or licensing clearance for the source footage/model.
