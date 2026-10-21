# Seed example

`seeds.json` illustrates two manual selections in a 1920×1080 normalized source. It is not a working configuration for arbitrary footage; no video is included.

- `time: 0` means the first frame of the segment after `--start` extraction.
- Coordinates are `[left, top, width, height]`, in pixels from `inspect/first-frame.jpg`.
- `cut: true` means the second seed starts a new shot and the crop can jump at that boundary.
- A seed without `cut: true` can re-initialize the tracker inside one shot.
- Alternatively use integer `frame` indices at the job's normalized `--fps`.

Single-subject generic preview:

```bash
python auto-reframe/tools/reframe.py run input.mp4 \
  --start 0 --duration 5 --bbox 100,100,160,120 --out work/my-preview
```

Choose those coordinates from your actual first frame. For difficult clips split at camera cuts, inspect every shot and review the diagnostic output. A single initial box is not sufficient to guarantee identity across an entire program.
