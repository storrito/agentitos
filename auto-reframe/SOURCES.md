# Third-party components and provenance

The release archive contains only the skill's own Python code, docs, examples and tests. It contains **no model weights, source footage or copied third-party implementation**.

## Runtime dependencies

- OpenCV / contrib: https://github.com/opencv/opencv and https://github.com/opencv/opencv_contrib
  - CSRT is consumed through `cv2.TrackerCSRT_create`, not copied into this repository.
  - Wheel: `opencv-contrib-python-headless`, 4.x. Upstream dependencies retain their own licenses.
- NumPy: https://numpy.org/
- ffmpeg / ffprobe: https://ffmpeg.org/
  - An external ffmpeg build with `libx264` is required; the licensing of that build is the operator's responsibility.

## Optional MobileNet-SSD car detector

Source repository: https://github.com/chuanqi305/MobileNet-SSD

Pinned commit: `bb17b6c3eef36d80be441ae8e5339be66e8e3b7a`

| Downloaded name | Upstream file | Bytes | SHA-256 |
|---|---|---:|---|
| deploy.prototxt | deploy.prototxt | 44667 | 2d180f723b3109e21f8287f6b3c691390d07b60eed998327cd3259ffa0e50608 |
| model.caffemodel | mobilenet_iter_73000.caffemodel | 23306119 | 52eed8be80522c152a17fb56740de705b79881bde1a167e0e747310523685fc7 |

`tools/fetch_models.py` is an explicit opt-in download using these immutable URLs, expected sizes and hashes. `reframe.py` verifies the hashes again before loading. The weights are not included in Git/the skill ZIP and are **not relicensed under the skill's MIT license**. The download source and a checksum are not a commercial-use permission; check original model/training-data rights for your intended deployment. If that is not acceptable, use the generic CSRT path or substitute a separately licensed detector in a future implementation.

## Source video and test media

The development workflow used user-provided motorsport video. None of it is bundled with this skill. Tests generate a small deterministic textured moving rectangle locally. Example seed numbers only illustrate the coordinate convention and have no universal meaning.
